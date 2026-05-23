// ── Supabase 클라이언트 ──
const SUPABASE_URL      = 'https://bpaqjmwzdxdgitlwmamp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwYXFqbXd6ZHhkZ2l0bHdtYW1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyOTczMDMsImV4cCI6MjA4ODg3MzMwM30.7MVzlcoc3p46_b5jEn1aUr5LE2kF3EWlF89fqBH1MSM';
const supabaseClient    = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    realtime: { enabled: false },   // 실시간 기능 미사용 → WebSocket 연결 차단
    global: { fetch: fetch.bind(globalThis) },
});

// ── 앱 전역 상태 ──
let currentUser  = null;
let currentTag   = '';
let currentSort  = 'view_count';
let editingGameId = null;

// ── DOM 캐시 (반복 getElementById 제거) ──
// DOMContentLoaded 이후 한 번만 채워집니다
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
