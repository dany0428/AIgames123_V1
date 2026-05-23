// ── Supabase client ──
const SUPABASE_URL      = 'https://bpaqjmwzdxdgitlwmamp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwYXFqbXd6ZHhkZ2l0bHdtYW1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyOTczMDMsImV4cCI6MjA4ODg3MzMwM30.7MVzlcoc3p46_b5jEn1aUr5LE2kF3EWlF89fqBH1MSM';
const supabaseClient    = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    realtime: { enabled: false },   // realtime disabled → blocks WebSocket connections
    global:   { fetch: fetch.bind(globalThis) },
});

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
