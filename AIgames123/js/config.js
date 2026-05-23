// ── Supabase client ──
const SUPABASE_URL      = 'https://bpaqjmwzdxdgitlwmamp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwYXFqbXd6ZHhkZ2l0bHdtYW1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyOTczMDMsImV4cCI6MjA4ODg3MzMwM30.7MVzlcoc3p46_b5jEn1aUr5LE2kF3EWlF89fqBH1MSM';
const supabaseClient    = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    realtime: { enabled: false },   // realtime disabled → blocks WebSocket connections
    global:   { fetch: fetch.bind(globalThis) },
});

// ════════════════════════════════════════════════════════
//  SECURITY CONSTANTS
//
//  These caps are CLIENT-SIDE guards; they improve UX and provide
//  defense-in-depth but are NOT the primary defense. Authoritative
//  limits MUST also be enforced in Supabase Storage policies (file
//  size) and the database (column lengths, RLS).
// ════════════════════════════════════════════════════════

const SECURITY = {
    // File size caps (bytes)
    MAX_GAME_FILE_BYTES:  50 * 1024 * 1024,   //  50 MB — html/zip games
    MAX_THUMB_BYTES:       5 * 1024 * 1024,   //   5 MB — game thumbnails
    MAX_AVATAR_BYTES:      2 * 1024 * 1024,   //   2 MB — profile avatars

    // Game-file URL allowlist: file_url MUST be served from the project's
    // Supabase storage bucket. Rejects javascript:, data:, http:, and any
    // URL pointing at the parent app's own origin (sandbox-escape vector).
    ALLOWED_GAME_URL_PREFIX: `${SUPABASE_URL}/storage/v1/object/public/`,

    // Accepted image MIME magic-byte signatures (first 4 bytes hex)
    IMAGE_MAGIC_BYTES: {
        png:  '89504e47',
        jpg:  'ffd8ff',          // JPEG
        gif:  '47494638',        // GIF8
        webp: '52494646',        // RIFF (followed by WEBP at offset 8)
    },

    // Tag/name length caps
    MAX_GAME_NAME_LEN: 80,
    MAX_TAG_LIST_LEN:  200,
    MAX_DISPLAY_NAME_LEN: 32,

    // Password policy
    MIN_PASSWORD_LEN: 8,
    MAX_PASSWORD_LEN: 128,   // bcrypt has a practical 72-byte limit; cap to prevent abuse

    // Strict email format (RFC 5322 simplified, no comments/quoted-locals)
    EMAIL_REGEX: /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/,
};

// Validate a game-file URL before handing it to fetch() or iframe.src.
// Throws on any URL that isn't a normal https:// URL inside the Supabase
// storage bucket — blocks javascript:, data:, file:, http://, and any
// attacker-supplied URL pointing at the embedding app's own origin.
function assertSafeGameUrl(url) {
    if (typeof url !== 'string' || url.length === 0 || url.length > 2048) {
        throw new Error('Invalid game URL.');
    }
    let parsed;
    try { parsed = new URL(url); }
    catch { throw new Error('Malformed game URL.'); }

    if (parsed.protocol !== 'https:') {
        throw new Error('Game URL must use https.');
    }
    if (parsed.origin === window.location.origin) {
        // Sandbox-escape guard: prevents file_url from pointing at the
        // embedding app, which would let user-uploaded JS escape sandboxing.
        throw new Error('Game URL cannot share the app origin.');
    }
    if (!url.startsWith(SECURITY.ALLOWED_GAME_URL_PREFIX)) {
        throw new Error('Game URL is not from a trusted storage bucket.');
    }
    return url;
}

// Read the first N bytes of a File as a hex string. Used to verify
// image magic bytes — the `accept="image/*"` attribute is trivially
// bypassable by setting Content-Type manually, so we re-check on-disk.
async function readFileMagicHex(file, byteCount = 4) {
    const buf  = await file.slice(0, byteCount).arrayBuffer();
    const view = new Uint8Array(buf);
    let hex = '';
    for (let i = 0; i < view.length; i++) hex += view[i].toString(16).padStart(2, '0');
    return hex;
}

// Verify a file's bytes start with a recognized image signature.
// Returns true on match, false otherwise. Caller decides how strict to be.
async function isRealImageFile(file) {
    if (!file || file.size === 0) return false;
    const hex = (await readFileMagicHex(file, 8)).toLowerCase();
    if (hex.startsWith(SECURITY.IMAGE_MAGIC_BYTES.png))  return true;
    if (hex.startsWith(SECURITY.IMAGE_MAGIC_BYTES.jpg))  return true;
    if (hex.startsWith(SECURITY.IMAGE_MAGIC_BYTES.gif))  return true;
    if (hex.startsWith(SECURITY.IMAGE_MAGIC_BYTES.webp)) {
        // WebP needs a secondary check at offset 8 for "WEBP"
        const tail = await file.slice(8, 12).text();
        return tail === 'WEBP';
    }
    return false;
}

// ── Global app state ──
let currentUser   = null;
let currentTag    = '';
let currentSort   = 'view_count';
let editingGameId = null;

// ── Client-side caches (performance) ──
// `_tagCache` stores the full set of tags across all games. The sidebar is
// rebuilt from this instead of re-querying every game's tag column on
// every search/sort/filter operation.
const cache = {
    _tagCache:      null,   // Array<string> | null   — sorted distinct tags
    _tagCacheTime:  0,      // last refresh epoch ms
    _gameListCache: [],     // Array<game>           — currently rendered games (for optimistic UI updates)
    invalidateTags() { this._tagCache = null; this._tagCacheTime = 0; },
};

// ── DOM cache — populated once on DOMContentLoaded ──
// Eliminates repeated getElementById calls in hot paths.
const DOM = {};
function initDOMCache() {
    const ids = [
        'mainContent', 'profileContent', 'publicProfileContent',
        'searchContainer', 'searchInput', 'sectionTitle', 'sortDropdown',
        'gameGrid', 'myGameGrid', 'publicGameGrid', 'genreList',
        'playerModal', 'gameFrame', 'gameScaleWrapper', 'placeholder', 'deleteGameBtn',
        'playerTitle', 'uploaderName', 'uploaderAvatarImg', 'uploaderAvatarFallback',
        'uploaderProfileBtn', 'upvoteBtn', 'upvoteCount',
        'loginBtn', 'logoutBtn', 'uploadBtn', 'userInfo',
        'profileAvatar', 'avatarPreview', 'profileDisplayName',
        'profileNameInput', 'profileEmail', 'statTotalGames', 'statTotalViews',
        'publicProfileName', 'dpadOverlay',
        'fitBtn', 'exitFsFloatBtn',
    ];
    ids.forEach(id => { DOM[id] = document.getElementById(id); });
}
