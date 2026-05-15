// ════════════════════════════════════
//  내부 렌더 함수 (history 조작 없음)
// ════════════════════════════════════

function _renderMain(tag = '') {
    currentTag = tag;
    DOM.mainContent.style.display          = 'block';
    DOM.profileContent.style.display       = 'none';
    DOM.publicProfileContent.style.display = 'none';
    DOM.searchContainer.style.visibility   = 'visible';
    DOM.sectionTitle.textContent = tag ? `#${tag} Games` : 'Popular Games';
    if (!tag && DOM.searchInput) DOM.searchInput.value = '';
    if (DOM.sortDropdown) DOM.sortDropdown.value = currentSort;
    fetchGames('', tag);
}

function _renderProfile() {
    if (!currentUser) return;
    DOM.mainContent.style.display          = 'none';
    DOM.profileContent.style.display       = 'block';
    DOM.publicProfileContent.style.display = 'none';
    DOM.searchContainer.style.visibility   = 'hidden';

    const name   = currentUser.user_metadata.custom_name
        || currentUser.user_metadata.preferred_username
        || currentUser.user_metadata.full_name || '게이머';
    const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%233b2d5a'/%3E%3Ctext y='.9em' font-size='60' x='20'%3E%F0%9F%91%A4%3C/text%3E%3C/svg%3E";
    const avatar = currentUser.user_metadata.custom_avatar
        || currentUser.user_metadata.avatar_url
        || DEFAULT_AVATAR;

    if (DOM.profileAvatar)      DOM.profileAvatar.src              = avatar;
    if (DOM.avatarPreview)      DOM.avatarPreview.src              = avatar;
    if (DOM.profileDisplayName) DOM.profileDisplayName.textContent = name;
    if (DOM.profileNameInput)   DOM.profileNameInput.value         = name;
    if (DOM.profileEmail)       DOM.profileEmail.textContent       = currentUser.email || '';
    fetchMyGames();
}

function _renderPublicProfile(userId, userName) {
    DOM.mainContent.style.display          = 'none';
    DOM.profileContent.style.display       = 'none';
    DOM.publicProfileContent.style.display = 'block';
    DOM.searchContainer.style.visibility   = 'hidden';
    if (DOM.publicProfileName) DOM.publicProfileName.textContent = userName;

    // 열려있는 플레이어 모달 닫기
    DOM.playerModal.classList.remove('active');
    DOM.gameFrame.srcdoc = '';
    document.body.style.overflow = '';
    fetchPublicGames(userId);
}

// ════════════════════════════════════
//  URL 라우터
// ════════════════════════════════════

function handleRoute() {
    const path   = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    const tag    = params.get('tag') || '';

    if (path.startsWith('/profile')) {
        history.replaceState({ page: 'profile' }, '', '/profile');
        _renderProfile();
    } else if (path.startsWith('/user/')) {
        const userId   = decodeURIComponent(path.split('/user/')[1] || '');
        const userName = params.get('name') || '게이머';
        history.replaceState({ page: 'user', userId, userName }, '', path + window.location.search);
        _renderPublicProfile(userId, userName);
    } else {
        history.replaceState({ page: 'main', tag }, '', tag ? `/?tag=${encodeURIComponent(tag)}` : '/');
        _renderMain(tag);
    }
}

// ════════════════════════════════════
//  공개 네비게이션 (pushState)
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

// filterByTag용 pushState (db.js에서 호출)
window._pushTagHistory = (tag) => {
    history.pushState(
        { page: 'main', tag },
        '',
        tag ? `/?tag=${encodeURIComponent(tag)}` : '/'
    );
};

// ════════════════════════════════════
//  뒤로 / 앞으로 버튼
// ════════════════════════════════════

window.addEventListener('popstate', (e) => {
    const state = e.state;
    if (!state) { _renderMain(''); return; }
    switch (state.page) {
        case 'main':    _renderMain(state.tag || '');                    break;
        case 'profile': _renderProfile();                                break;
        case 'user':    _renderPublicProfile(state.userId, state.userName); break;
        default:        _renderMain('');
    }
});

// ════════════════════════════════════
//  인증
// ════════════════════════════════════

// 최초 initAuth 완료 전까지 true → updateAuthUI의 fetchGames 중복 호출 방지
let _authInitializing = true;

function updateAuthUI(user) {
    const prevUser = currentUser;
    currentUser    = user;

    if (user) {
        if (DOM.loginBtn)  DOM.loginBtn.style.display  = 'none';
        if (DOM.logoutBtn) DOM.logoutBtn.style.display = 'block';
        if (DOM.uploadBtn) DOM.uploadBtn.style.display = 'block';
        if (DOM.userInfo) {
            DOM.userInfo.style.display = 'block';
            DOM.userInfo.textContent   = `${
                user.user_metadata.custom_name
                || user.user_metadata.preferred_username
                || user.user_metadata.full_name || '게이머'
            }님`;
        }
        // 로그인 시 게임 업로더 정보 동기화 (백그라운드)
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
        if (DOM.loginBtn)  DOM.loginBtn.style.display  = 'block';
        if (DOM.logoutBtn) DOM.logoutBtn.style.display = 'none';
        if (DOM.uploadBtn) DOM.uploadBtn.style.display = 'none';
        if (DOM.userInfo)  DOM.userInfo.style.display  = 'none';
        history.replaceState({ page: 'main', tag: '' }, '', '/');
        _renderMain('');
    }

    // 초기 로딩 중엔 handleRoute가 fetchGames를 호출하므로 중복 방지
    if (!_authInitializing && prevUser !== user) {
        fetchGames(DOM.searchInput ? DOM.searchInput.value.trim() : '', currentTag);
    }
}

async function initAuth() {
    _authInitializing = true;
    const { data: { session } } = await supabaseClient.auth.getSession();
    updateAuthUI(session?.user);
    _authInitializing = false;
    supabaseClient.auth.onAuthStateChange((_event, session) => updateAuthUI(session?.user));
}

// ════════════════════════════════════
//  타인 게임 목록 조회
// ════════════════════════════════════

async function fetchPublicGames(userId) {
    try {
        const { data, error } = await supabaseClient
            .from('games').select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        renderGames(data, DOM.publicGameGrid, false);
    } catch (err) {
        console.error('유저 게임 로드 실패:', err.message);
    }
}
