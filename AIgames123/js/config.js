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
    MAX_DESCRIPTION_LEN:  1000,   // game description (matches DB CHECK)

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
        'gameDescription',   // NEW: description block inside player modal
    ];
    ids.forEach(id => { DOM[id] = document.getElementById(id); });
}

// ════════════════════════════════════════════════════════
//  Toast notification system
//
//  Replaces alert() everywhere. Non-blocking, auto-dismissing,
//  visually consistent. Variants: info | success | warn | error.
//  Usage:
//      notify('Game uploaded!');                     // info
//      notify.success('Saved!');
//      notify.error('Upload failed', err);           // err is logged to console
//      notify.warn('Please log in first.');
// ════════════════════════════════════════════════════════

const _TOAST_CONTAINER_ID = 'app-toast-container';

function _ensureToastContainer() {
    let el = document.getElementById(_TOAST_CONTAINER_ID);
    if (!el) {
        el = document.createElement('div');
        el.id = _TOAST_CONTAINER_ID;
        // Inline styles so toasts work even if CSS fails to load
        el.style.cssText =
            'position:fixed;top:1.2rem;right:1.2rem;z-index:99999;' +
            'display:flex;flex-direction:column;gap:0.6rem;pointer-events:none;' +
            'max-width:min(420px, calc(100vw - 2rem));';
        document.body.appendChild(el);
    }
    return el;
}

function notify(message, variant = 'info', { duration = 3500, error = null } = {}) {
    if (error) console.error('[' + variant + ']', message, error);
    const container = _ensureToastContainer();

    const toast = document.createElement('div');
    const palette = {
        info:    { bg: '#1e293b', border: '#3b82f6', icon: 'ℹ️' },
        success: { bg: '#064e3b', border: '#10b981', icon: '✅' },
        warn:    { bg: '#451a03', border: '#f59e0b', icon: '⚠️' },
        error:   { bg: '#450a0a', border: '#ef4444', icon: '❌' },
    }[variant] || { bg: '#1e293b', border: '#3b82f6', icon: 'ℹ️' };

    toast.style.cssText =
        `background:${palette.bg};color:#f1f5f9;border-left:4px solid ${palette.border};` +
        'padding:0.85rem 1.1rem;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,0.35);' +
        'font-family:system-ui,-apple-system,sans-serif;font-size:0.9rem;line-height:1.45;' +
        'pointer-events:auto;cursor:pointer;display:flex;gap:0.6rem;align-items:flex-start;' +
        'animation:toastIn 0.25s ease-out;max-width:100%;word-wrap:break-word;';

    // Inject keyframes once
    if (!document.getElementById('app-toast-keyframes')) {
        const style = document.createElement('style');
        style.id = 'app-toast-keyframes';
        style.textContent =
            '@keyframes toastIn{from{transform:translateX(110%);opacity:0;}to{transform:translateX(0);opacity:1;}}' +
            '@keyframes toastOut{from{transform:translateX(0);opacity:1;}to{transform:translateX(110%);opacity:0;}}';
        document.head.appendChild(style);
    }

    toast.innerHTML =
        `<span style="font-size:1.1rem;flex-shrink:0;">${palette.icon}</span>` +
        `<span style="flex:1;white-space:pre-wrap;">${_escForToast(message)}</span>`;

    // Click to dismiss
    const dismiss = () => {
        toast.style.animation = 'toastOut 0.2s ease-in forwards';
        setTimeout(() => toast.remove(), 220);
    };
    toast.addEventListener('click', dismiss);
    container.appendChild(toast);

    if (duration > 0) setTimeout(dismiss, duration);
    return toast;
}

// Local HTML-escape — config.js can't depend on db.js's _esc(),
// so a tiny inline version sits here.
function _escForToast(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

notify.info    = (msg, opts) => notify(msg, 'info',    opts);
notify.success = (msg, opts) => notify(msg, 'success', opts);
notify.warn    = (msg, opts) => notify(msg, 'warn',    opts);
notify.error   = (msg, err)  => notify(msg, 'error',   { error: err, duration: 5000 });


// ════════════════════════════════════════════════════════
//  Error message mapper
//
//  Translates raw Supabase/network/Postgres errors into
//  user-facing language. Anything unmapped falls back to
//  a generic "Something went wrong" — the original error
//  is preserved in console.error for debugging.
// ════════════════════════════════════════════════════════

function friendlyError(err, contextHint = '') {
    if (!err) return 'Something went wrong.';
    const msg = (err.message || err.error_description || err.error || String(err)).toLowerCase();

    // Auth
    if (msg.includes('invalid login credentials'))     return 'Invalid email or password.';
    if (msg.includes('email not confirmed'))           return 'Please confirm your email first (check your inbox).';
    if (msg.includes('user already registered'))       return 'This email is already registered. Try logging in.';
    if (msg.includes('email rate limit exceeded'))     return 'Too many emails sent. Please wait a few minutes.';
    if (msg.includes('weak password'))                 return 'Password is too weak. Try something longer with letters and numbers.';
    if (msg.includes('signups not allowed'))           return 'Sign-up is currently disabled.';
    if (msg.includes('jwt expired'))                   return 'Your session expired. Please log in again.';

    // Postgres / Supabase
    if (msg.includes('row-level security')
        || msg.includes('violates row-level security')
        || msg.includes('permission denied'))          return "You don't have permission to do this.";
    if (msg.includes('duplicate key')
        || msg.includes('already exists'))             return 'That already exists.';
    if (msg.includes('check constraint')
        || msg.includes('violates check'))             return 'That input is not allowed (too long or invalid).';
    if (msg.includes('foreign key'))                   return "This action references something that doesn't exist.";
    if (msg.includes('login required'))                return 'Please log in first.';

    // Storage
    if (msg.includes('payload too large')
        || msg.includes('object too large'))           return 'That file is too large.';
    if (msg.includes('mime type not supported'))       return 'That file type is not allowed.';
    if (msg.includes('bucket not found'))              return 'Storage bucket is unavailable. Please try again later.';

    // Network
    if (msg.includes('failed to fetch')
        || msg.includes('networkerror'))               return 'Network connection failed. Check your internet.';
    if (msg.includes('timeout'))                       return 'Request timed out. Please try again.';

    // Generic fallback
    return contextHint
        ? `${contextHint} Please try again.`
        : 'Something went wrong. Please try again.';
}


// ════════════════════════════════════════════════════════
//  Image compressor
//
//  Resizes + re-encodes images via Canvas before upload.
//  Reduces storage cost, speeds up loads, normalizes formats.
//  Returns a new File (compressed) — caller can fall back to
//  the original if compression fails or yields a larger file.
// ════════════════════════════════════════════════════════

const IMAGE_PRESETS = {
    thumbnail: { maxWidth: 800, maxHeight: 800, quality: 0.85, mime: 'image/webp' },
    avatar:    { maxWidth: 256, maxHeight: 256, quality: 0.90, mime: 'image/webp' },
};

async function compressImage(file, presetName = 'thumbnail') {
    const preset = IMAGE_PRESETS[presetName] || IMAGE_PRESETS.thumbnail;

    // GIFs are animated — compressing strips animation. Pass through unchanged.
    if (file.type === 'image/gif') return file;

    // Tiny files (< 100KB) are likely already optimized — skip.
    if (file.size < 100 * 1024) return file;

    try {
        const bitmap = await createImageBitmap(file);
        const { width, height } = bitmap;

        // Compute scaled dimensions preserving aspect ratio
        const scale = Math.min(preset.maxWidth / width, preset.maxHeight / height, 1);
        const w = Math.round(width  * scale);
        const h = Math.round(height * scale);

        // Use OffscreenCanvas where available, fallback to HTMLCanvasElement
        let canvas, ctx;
        if (typeof OffscreenCanvas !== 'undefined') {
            canvas = new OffscreenCanvas(w, h);
            ctx = canvas.getContext('2d');
        } else {
            canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            ctx = canvas.getContext('2d');
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close?.();

        const blob = canvas.convertToBlob
            ? await canvas.convertToBlob({ type: preset.mime, quality: preset.quality })
            : await new Promise(res => canvas.toBlob(res, preset.mime, preset.quality));

        if (!blob) return file;

        // If compression actually made it larger (rare, but possible for already-optimized PNGs),
        // keep the original. Otherwise return the compressed version.
        if (blob.size >= file.size) return file;

        // Rename so the extension matches the new MIME
        const ext = preset.mime === 'image/webp' ? 'webp'
                  : preset.mime === 'image/jpeg' ? 'jpg' : 'png';
        const baseName = file.name.replace(/\.[^.]+$/, '');
        return new File([blob], `${baseName}.${ext}`, { type: preset.mime, lastModified: Date.now() });
    } catch (err) {
        // Compression failure is non-fatal — return original
        console.warn('Image compression failed, using original:', err);
        return file;
    }
}
