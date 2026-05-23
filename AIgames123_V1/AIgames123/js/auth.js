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

    // 이메일 회원에게만 비밀번호 변경 섹션 표시
    const isEmailUser = currentUser.app_metadata?.provider === 'email';
    const pwSection   = document.getElementById('changePasswordSection');
    if (pwSection) pwSection.style.display = isEmailUser ? 'block' : 'none';

    fetchMyGames();
}

function _renderPublicProfile(userId, userName) {
    DOM.mainContent.style.display          = 'none';
    DOM.profileContent.style.display       = 'none';
    DOM.publicProfileContent.style.display = 'block';
    DOM.searchContainer.style.visibility   = 'hidden';
    if (DOM.publicProfileName) DOM.publicProfileName.textContent = userName;

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
        case 'main':    _renderMain(state.tag || '');                       break;
        case 'profile': _renderProfile();                                   break;
        case 'user':    _renderPublicProfile(state.userId, state.userName); break;
        default:        _renderMain('');
    }
});

// ════════════════════════════════════
//  인증 UI 업데이트
// ════════════════════════════════════

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
//  로그인 / 회원가입 모달
// ════════════════════════════════════

function initAuthModal() {
    const modal        = document.getElementById('authModal');
    const closeBtn     = document.getElementById('closeAuth');
    const tabs         = document.querySelectorAll('.auth-tab');
    const loginPanel   = document.getElementById('loginPanel');
    const signupPanel  = document.getElementById('signupPanel');

    if (!modal) return;

    // ── 탭 전환 ──
    function switchTab(tabName) {
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
        loginPanel.style.display  = tabName === 'login'  ? 'block' : 'none';
        signupPanel.style.display = tabName === 'signup' ? 'block' : 'none';
    }

    tabs.forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));

    // 패널 내 "로그인 / 회원가입" 텍스트 링크 전환
    modal.addEventListener('click', (e) => {
        const link = e.target.closest('.auth-link[data-switch]');
        if (link) switchTab(link.dataset.switch);
    });

    // ── 모달 열기 / 닫기 ──
    closeBtn?.addEventListener('click', _closeAuthModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) _closeAuthModal(); });

    // ── GitHub 로그인 ──
    document.getElementById('githubLoginBtn')?.addEventListener('click', () => {
        supabaseClient.auth.signInWithOAuth({ provider: 'github' });
    });

    // ── 이메일 로그인 ──
    document.getElementById('emailLoginBtn')?.addEventListener('click', _handleEmailLogin);
    document.getElementById('loginPassword')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') _handleEmailLogin();
    });

    // ── 이메일 회원가입 ──
    document.getElementById('emailSignupBtn')?.addEventListener('click', _handleEmailSignup);
    document.getElementById('signupPasswordConfirm')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') _handleEmailSignup();
    });
}

function _closeAuthModal() {
    const modal = document.getElementById('authModal');
    modal?.classList.remove('active');
}

async function _handleEmailLogin() {
    const email    = document.getElementById('loginEmail')?.value.trim();
    const password = document.getElementById('loginPassword')?.value;
    const btn      = document.getElementById('emailLoginBtn');

    if (!email || !password) return alert('이메일과 비밀번호를 입력해주세요.');

    btn.disabled    = true;
    btn.textContent = '로그인 중...';
    try {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        _closeAuthModal();
    } catch (err) {
        const msg = err.message === 'Invalid login credentials'
            ? '이메일 또는 비밀번호가 올바르지 않습니다.'
            : err.message;
        alert('로그인 실패: ' + msg);
    } finally {
        btn.disabled    = false;
        btn.textContent = '이메일로 로그인';
    }
}

async function _handleEmailSignup() {
    const email    = document.getElementById('signupEmail')?.value.trim();
    const name     = document.getElementById('signupName')?.value.trim();
    const password = document.getElementById('signupPassword')?.value;
    const confirm  = document.getElementById('signupPasswordConfirm')?.value;
    const btn      = document.getElementById('emailSignupBtn');

    if (!email || !name || !password) return alert('모든 항목을 입력해주세요.');
    if (password.length < 8)          return alert('비밀번호는 8자 이상이어야 합니다.');
    if (password !== confirm)          return alert('비밀번호가 일치하지 않습니다.');

    btn.disabled    = true;
    btn.textContent = '가입 중...';
    try {
        const { data, error } = await supabaseClient.auth.signUp({
            email,
            password,
            options: { data: { custom_name: name } },
        });
        if (error) throw error;

        // 이미 가입된 이메일 (identities 배열이 비어 있음)
        if (data.user && data.user.identities?.length === 0) {
            alert('이미 가입된 이메일입니다. 로그인 탭에서 로그인해주세요.');
            return;
        }

        if (data.session) {
            // 이메일 확인 비활성화 상태 → 즉시 로그인
            _closeAuthModal();
            alert(`환영합니다, ${name}님! 🎮`);
        } else {
            // 이메일 확인 필요
            _closeAuthModal();
            alert('가입 완료! 입력하신 이메일로 인증 링크가 발송되었습니다.\n메일을 확인하고 링크를 클릭하면 로그인할 수 있습니다.');
        }
    } catch (err) {
        alert('회원가입 실패: ' + err.message);
    } finally {
        btn.disabled    = false;
        btn.textContent = '회원가입';
    }
}

// 전역에서 모달 열기 (app.js loginBtn 이벤트용)
window.openAuthModal = (tab = 'login') => {
    const modal = document.getElementById('authModal');
    if (!modal) return;
    // 탭 초기화
    document.querySelectorAll('.auth-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('loginPanel').style.display  = tab === 'login'  ? 'block' : 'none';
    document.getElementById('signupPanel').style.display = tab === 'signup' ? 'block' : 'none';
    modal.classList.add('active');
};

// ════════════════════════════════════
//  비밀번호 변경 (이메일 유저 전용)
// ════════════════════════════════════

function initChangePassword() {
    document.getElementById('changePasswordBtn')?.addEventListener('click', async () => {
        const newPw  = document.getElementById('newPasswordInput')?.value;
        const confirm = document.getElementById('newPasswordConfirm')?.value;
        const btn    = document.getElementById('changePasswordBtn');

        if (!newPw)            return alert('새 비밀번호를 입력해주세요.');
        if (newPw.length < 8)  return alert('비밀번호는 8자 이상이어야 합니다.');
        if (newPw !== confirm)  return alert('비밀번호가 일치하지 않습니다.');

        btn.disabled    = true;
        btn.textContent = '변경 중...';
        try {
            const { error } = await supabaseClient.auth.updateUser({ password: newPw });
            if (error) throw error;
            alert('비밀번호가 변경되었습니다.');
            document.getElementById('newPasswordInput').value  = '';
            document.getElementById('newPasswordConfirm').value = '';
        } catch (err) {
            alert('변경 실패: ' + err.message);
        } finally {
            btn.disabled    = false;
            btn.textContent = '변경하기';
        }
    });
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
