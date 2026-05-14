// ════════════════════════════════════
//  내부 렌더 함수 (history 조작 없음)
// ════════════════════════════════════

function _renderMain(tag) {
    tag = tag || '';
    const mainContent          = document.getElementById('mainContent');
    const profileContent       = document.getElementById('profileContent');
    const publicProfileContent = document.getElementById('publicProfileContent');
    const searchContainer      = document.getElementById('searchContainer');

    if (mainContent)          mainContent.style.display          = 'block';
    if (profileContent)       profileContent.style.display       = 'none';
    if (publicProfileContent) publicProfileContent.style.display = 'none';
    if (searchContainer)      searchContainer.style.visibility   = 'visible';

    currentTag = tag;

    const sectionTitle = document.getElementById('sectionTitle');
    if (sectionTitle) sectionTitle.textContent = tag ? `#${tag} Games` : 'Popular Games';

    const searchInput = document.getElementById('searchInput');
    if (!tag && searchInput) searchInput.value = '';

    const sortDropdown = document.getElementById('sortDropdown');
    if (sortDropdown) sortDropdown.value = currentSort || 'view_count';

    fetchGames('', tag);
    if (typeof fetchAndRenderTags === 'function') fetchAndRenderTags();
}

function _renderProfile() {
    if (!currentUser) return;

    const mainContent          = document.getElementById('mainContent');
    const profileContent       = document.getElementById('profileContent');
    const publicProfileContent = document.getElementById('publicProfileContent');
    const searchContainer      = document.getElementById('searchContainer');

    if (mainContent)          mainContent.style.display          = 'none';
    if (profileContent)       profileContent.style.display       = 'block';
    if (publicProfileContent) publicProfileContent.style.display = 'none';
    if (searchContainer)      searchContainer.style.visibility   = 'hidden';

    const currentName = currentUser.user_metadata.custom_name
        || currentUser.user_metadata.preferred_username
        || currentUser.user_metadata.full_name || '게이머';
    const avatarUrl = currentUser.user_metadata.custom_avatar
        || currentUser.user_metadata.avatar_url
        || 'https://via.placeholder.com/100';

    const el = id => document.getElementById(id);
    if (el('profileAvatar'))      el('profileAvatar').src              = avatarUrl;
    if (el('avatarPreview'))      el('avatarPreview').src              = avatarUrl;
    if (el('profileDisplayName')) el('profileDisplayName').textContent = currentName;
    if (el('profileNameInput'))   el('profileNameInput').value         = currentName;
    if (el('profileEmail'))       el('profileEmail').textContent       = currentUser.email || '';

    fetchMyGames();
}

function _renderPublicProfile(userId, userName) {
    const mainContent          = document.getElementById('mainContent');
    const profileContent       = document.getElementById('profileContent');
    const publicProfileContent = document.getElementById('publicProfileContent');
    const searchContainer      = document.getElementById('searchContainer');

    if (mainContent)          mainContent.style.display          = 'none';
    if (profileContent)       profileContent.style.display       = 'none';
    if (publicProfileContent) publicProfileContent.style.display = 'block';
    if (searchContainer)      searchContainer.style.visibility   = 'hidden';

    const nameEl = document.getElementById('publicProfileName');
    if (nameEl) nameEl.textContent = userName;

    // 플레이어 모달 닫기
    const playerModal = document.getElementById('playerModal');
    const gameFrame   = document.getElementById('gameFrame');
    if (playerModal) playerModal.classList.remove('active');
    if (gameFrame)   gameFrame.srcdoc = '';
    document.body.style.overflow = '';

    fetchPublicGames(userId);
}

// ════════════════════════════════════
//  URL 라우터
// ════════════════════════════════════

// 현재 URL을 읽어 알맞은 화면을 렌더 (replaceState — 히스토리 오염 없음)
function handleRoute() {
    const path   = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    const tag    = params.get('tag') || '';

    if (path.startsWith('/profile')) {
        // /profile → 내 프로필
        history.replaceState({ page: 'profile' }, '', '/profile');
        _renderProfile();
    } else if (path.startsWith('/user/')) {
        // /user/:userId
        const userId   = decodeURIComponent(path.split('/user/')[1] || '');
        const userName = params.get('name') || '게이머';
        history.replaceState({ page: 'user', userId, userName }, '', path + window.location.search);
        _renderPublicProfile(userId, userName);
    } else {
        // / 또는 /?tag=xxx
        history.replaceState({ page: 'main', tag }, '', tag ? `/?tag=${encodeURIComponent(tag)}` : '/');
        _renderMain(tag);
    }
}

// ════════════════════════════════════
//  공개 네비게이션 함수 (pushState)
// ════════════════════════════════════

function showMainContent() {
    history.pushState({ page: 'main', tag: '' }, '', '/');
    _renderMain('');
}

function showProfileContent() {
    if (!currentUser) return;
    history.pushState({ page: 'profile' }, '', '/profile');
    _renderProfile();
}

window.showPublicProfile = (userId, userName) => {
    history.pushState(
        { page: 'user', userId, userName },
        '',
        `/user/${encodeURIComponent(userId)}?name=${encodeURIComponent(userName)}`
    );
    _renderPublicProfile(userId, userName);
};

// filterByTag는 db.js에서 호출 — 여기서 pushState
window._pushTagHistory = (tag) => {
    history.pushState(
        { page: 'main', tag },
        '',
        tag ? `/?tag=${encodeURIComponent(tag)}` : '/'
    );
};

// ════════════════════════════════════
//  브라우저 뒤로 / 앞으로 버튼
// ════════════════════════════════════

window.addEventListener('popstate', (e) => {
    const state = e.state;
    if (!state) { _renderMain(''); return; }

    switch (state.page) {
        case 'main':
            currentTag = state.tag || '';
            _renderMain(currentTag);
            break;
        case 'profile':
            _renderProfile();
            break;
        case 'user':
            _renderPublicProfile(state.userId, state.userName);
            break;
        default:
            _renderMain('');
    }
});

// ════════════════════════════════════
//  인증
// ════════════════════════════════════

function updateAuthUI(user) {
    const prevUser = currentUser;
    currentUser    = user;

    const loginBtn    = document.getElementById('loginBtn');
    const logoutBtn   = document.getElementById('logoutBtn');
    const uploadBtn   = document.getElementById('uploadBtn');
    const userInfo    = document.getElementById('userInfo');
    const searchInput = document.getElementById('searchInput');

    if (user) {
        if (loginBtn)  loginBtn.style.display  = 'none';
        if (logoutBtn) logoutBtn.style.display  = 'block';
        if (uploadBtn) uploadBtn.style.display  = 'block';
        if (userInfo) {
            userInfo.style.display = 'block';
            const userName = user.user_metadata.custom_name
                || user.user_metadata.preferred_username
                || user.user_metadata.full_name || '게이머';
            userInfo.textContent = `${userName}님`;
        }
        // 로그인 시 게임 업로더 정보 동기화
        if (!prevUser) {
            const name   = user.user_metadata.custom_name
                || user.user_metadata.preferred_username
                || user.user_metadata.full_name || '게이머';
            const avatar = user.user_metadata.custom_avatar
                || user.user_metadata.avatar_url || '';
            supabaseClient.from('games')
                .update({ uploader_name: name, uploader_avatar: avatar })
                .eq('user_id', user.id)
                .then(({ error }) => {
                    if (error) console.warn('uploader 동기화 실패:', error.message);
                });
        }
    } else {
        if (loginBtn)  loginBtn.style.display  = 'block';
        if (logoutBtn) logoutBtn.style.display  = 'none';
        if (uploadBtn) uploadBtn.style.display  = 'none';
        if (userInfo)  userInfo.style.display   = 'none';
        // 로그아웃 → 메인으로 (history 오염 없이 replace)
        history.replaceState({ page: 'main', tag: '' }, '', '/');
        _renderMain('');
    }

    if (prevUser !== user && typeof fetchGames === 'function') {
        fetchGames(searchInput ? searchInput.value.trim() : '', currentTag);
    }
}

async function initAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    updateAuthUI(session?.user);
    supabaseClient.auth.onAuthStateChange((_event, session) => updateAuthUI(session?.user));
}

// ════════════════════════════════════
//  타인 게임 목록 조회
// ════════════════════════════════════

async function fetchPublicGames(userId) {
    const publicGameGrid = document.getElementById('publicGameGrid');
    try {
        const { data, error } = await supabaseClient
            .from('games').select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        renderGames(data, publicGameGrid, false);
    } catch (error) {
        console.error('유저 게임 로드 실패:', error.message);
    }
}
