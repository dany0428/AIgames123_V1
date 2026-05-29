// ════════════════════════════════════
//  Internal render functions (no history manipulation)
// ════════════════════════════════════

// Cached defaults to avoid re-creating large data URI strings
const DEFAULT_AVATAR_SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%233b2d5a'/%3E%3Ctext x='50' y='50' font-size='55' text-anchor='middle' dominant-baseline='central'%3E%F0%9F%91%A4%3C/text%3E%3C/svg%3E";

// Helper — resolves the best display name from user_metadata once
function _resolveDisplayName(user) {
    const m = user?.user_metadata || {};
    return m.custom_name || m.preferred_username || m.full_name || 'Gamer';
}

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

    const name   = _resolveDisplayName(currentUser);
    const avatar = currentUser.user_metadata.custom_avatar
        || currentUser.user_metadata.avatar_url
        || DEFAULT_AVATAR_SVG;

    if (DOM.profileAvatar)      DOM.profileAvatar.src              = avatar;
    if (DOM.avatarPreview)      DOM.avatarPreview.src              = avatar;
    if (DOM.profileDisplayName) DOM.profileDisplayName.textContent = name;
    if (DOM.profileNameInput)   DOM.profileNameInput.value         = name;
    if (DOM.profileEmail)       DOM.profileEmail.textContent       = currentUser.email || '';

    // Show password-change section only to email-provider users
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
//  URL router
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
        const userName = params.get('name') || 'Gamer';
        history.replaceState({ page: 'user', userId, userName }, '', path + window.location.search);
        _renderPublicProfile(userId, userName);
    } else if (path.startsWith('/game/')) {
        // Game permalink format: /game/<id>-<slug> or /game/<id>
        // Parse the leading numeric id (everything up to the first non-digit).
        const slugPart = path.split('/game/')[1] || '';
        const m = slugPart.match(/^(\d+)/);
        if (m) {
            const gameId = Number(m[1]);
            // Render the main grid in the background, then open the player.
            // openGameById() fetches metadata from Supabase since we only
            // have the id from the URL.
            _renderMain('');
            // Wait one tick so DOM is ready before opening modal
            setTimeout(() => window.openGameById?.(gameId), 0);
        } else {
            // Malformed URL — fall back to home
            history.replaceState({ page: 'main', tag: '' }, '', '/');
            _renderMain('');
        }
    } else {
        history.replaceState({ page: 'main', tag }, '', tag ? `/?tag=${encodeURIComponent(tag)}` : '/');
        _renderMain(tag);
    }
}

// ════════════════════════════════════
//  Public navigation (pushState)
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
//  Back / Forward button
// ════════════════════════════════════

window.addEventListener('popstate', (e) => {
    const state = e.state;
    if (!state) {
        // No state — could be initial navigation or back to root
        const path = window.location.pathname;
        if (path.startsWith('/game/')) {
            // User navigated forward to a /game/ URL — re-handle the route
            handleRoute();
        } else {
            _renderMain('');
        }
        return;
    }
    switch (state.page) {
        case 'main':    _renderMain(state.tag || '');                       break;
        case 'profile': _renderProfile();                                   break;
        case 'user':    _renderPublicProfile(state.userId, state.userName); break;
        case 'game':    window.openGameById?.(state.id);                    break;
        default:        _renderMain('');
    }
});

// ════════════════════════════════════
//  Auth UI updates
// ════════════════════════════════════

let _authInitializing = true;

// Sync user's name/avatar to all their games — only when changed.
// Avoids an UPDATE-all-rows query on every page load.
function _syncUploaderInfoIfChanged(user) {
    const name   = _resolveDisplayName(user);
    const avatar = user.user_metadata.custom_avatar
        || user.user_metadata.avatar_url || '';

    const key   = `uploaderSync:${user.id}`;
    const prev  = localStorage.getItem(key);
    const curr  = `${name}|${avatar}`;
    if (prev === curr) return;       // nothing changed — skip the DB write

    supabaseClient.from('games')
        .update({ uploader_name: name, uploader_avatar: avatar })
        .eq('user_id', user.id)
        .then(({ error }) => {
            if (error) console.warn('Uploader sync failed:', error.message);
            else       localStorage.setItem(key, curr);
        });
}

function updateAuthUI(user) {
    const prevUser = currentUser;
    currentUser    = user;

    if (user) {
        if (DOM.loginBtn)  DOM.loginBtn.style.display  = 'none';
        if (DOM.logoutBtn) DOM.logoutBtn.style.display = 'block';
        if (DOM.uploadBtn) DOM.uploadBtn.style.display = 'block';
        if (DOM.userInfo) {
            DOM.userInfo.style.display = 'block';
            DOM.userInfo.textContent   = _resolveDisplayName(user);
        }
        // Sync uploader info in background — only if name/avatar changed
        if (!prevUser) _syncUploaderInfoIfChanged(user);
    } else {
        if (DOM.loginBtn)  DOM.loginBtn.style.display  = 'block';
        if (DOM.logoutBtn) DOM.logoutBtn.style.display = 'none';
        if (DOM.uploadBtn) DOM.uploadBtn.style.display = 'none';
        if (DOM.userInfo)  DOM.userInfo.style.display  = 'none';

        // During initial load we let handleRoute() do the first render
        // to avoid a duplicate fetchGames() call.
        //
        // Don't force-redirect to main if the user is currently on a
        // PUBLIC route — /user/<id> (someone's profile) and /game/<id>
        // (a game permalink) work fine without auth. Without this guard,
        // Supabase's INITIAL_SESSION onAuthStateChange event fires right
        // after bootstrap and wipes out the URL the visitor came in with.
        if (!_authInitializing) {
            const path = window.location.pathname;
            const onPublicRoute = path.startsWith('/user/') || path.startsWith('/game/');
            if (!onPublicRoute) {
                history.replaceState({ page: 'main', tag: '' }, '', '/');
                _renderMain('');
            }
        }
    }

    // Re-fetch only on a real auth change (not on the initial bootstrap)
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
//  Login / signup modal
// ════════════════════════════════════

function initAuthModal() {
    const modal       = document.getElementById('authModal');
    const closeBtn    = document.getElementById('closeAuth');
    const tabs        = document.querySelectorAll('.auth-tab');
    const loginPanel  = document.getElementById('loginPanel');
    const signupPanel = document.getElementById('signupPanel');

    if (!modal) return;

    function switchTab(tabName) {
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
        loginPanel.style.display  = tabName === 'login'  ? 'block' : 'none';
        signupPanel.style.display = tabName === 'signup' ? 'block' : 'none';
    }

    tabs.forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));

    // Inline "switch to login/signup" links inside the panels
    modal.addEventListener('click', (e) => {
        const link = e.target.closest('.auth-link[data-switch]');
        if (link) switchTab(link.dataset.switch);
    });

    closeBtn?.addEventListener('click', _closeAuthModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) _closeAuthModal(); });

    // GitHub OAuth
    document.getElementById('githubLoginBtn')?.addEventListener('click', () => {
        supabaseClient.auth.signInWithOAuth({ provider: 'github' });
    });

    // Email login
    document.getElementById('emailLoginBtn')?.addEventListener('click', _handleEmailLogin);
    document.getElementById('loginPassword')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') _handleEmailLogin();
    });

    // Email signup
    document.getElementById('emailSignupBtn')?.addEventListener('click', _handleEmailSignup);
    document.getElementById('signupPasswordConfirm')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') _handleEmailSignup();
    });
}

function _closeAuthModal() {
    document.getElementById('authModal')?.classList.remove('active');
}

async function _handleEmailLogin() {
    const email    = document.getElementById('loginEmail')?.value.trim();
    const password = document.getElementById('loginPassword')?.value;
    const btn      = document.getElementById('emailLoginBtn');

    if (!email || !password) { notify.warn('Please enter your email and password.'); return; }
    if (!SECURITY.EMAIL_REGEX.test(email)) {
        notify.warn('That email address looks malformed.'); return;
    }
    if (password.length > SECURITY.MAX_PASSWORD_LEN) {
        notify.warn(`Password is too long (max ${SECURITY.MAX_PASSWORD_LEN} chars).`); return;
    }

    btn.disabled    = true;
    btn.textContent = 'Logging in...';
    try {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        _closeAuthModal();
    } catch (err) {
        // Avoid leaking whether the email exists — generic message for any auth error
        notify.error(friendlyError(err, 'Login failed.'), err);
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Login with Email';
    }
}

// Password policy:
//   - 8+ chars (configurable in SECURITY)
//   - at least one letter AND one digit (cheap baseline against trivial picks)
//   - rejects super-long inputs (bcrypt 72-byte truncation + DoS)
function _validatePassword(pw) {
    if (typeof pw !== 'string' || pw.length < SECURITY.MIN_PASSWORD_LEN) {
        return `Password must be at least ${SECURITY.MIN_PASSWORD_LEN} characters.`;
    }
    if (pw.length > SECURITY.MAX_PASSWORD_LEN) {
        return `Password is too long (max ${SECURITY.MAX_PASSWORD_LEN} characters).`;
    }
    if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
        return 'Password must contain at least one letter and one number.';
    }
    return null;
}

async function _handleEmailSignup() {
    const email    = document.getElementById('signupEmail')?.value.trim();
    const name     = document.getElementById('signupName')?.value.trim();
    const password = document.getElementById('signupPassword')?.value;
    const confirm  = document.getElementById('signupPasswordConfirm')?.value;
    const btn      = document.getElementById('emailSignupBtn');

    if (!email || !name || !password) { notify.warn('Please fill out all fields.'); return; }
    // Terms/Privacy agreement is mandatory for new accounts (COPPA + legal protection).
    // The checkbox is part of the signup form — gate the submission on it.
    const agreeBox = document.getElementById('signupAgree');
    if (agreeBox && !agreeBox.checked) {
        notify.warn('Please confirm you are at least 13 and agree to the Terms & Privacy Policy.');
        return;
    }
    if (!SECURITY.EMAIL_REGEX.test(email)) {
        notify.warn('That email address looks malformed.'); return;
    }
    if (name.length > SECURITY.MAX_DISPLAY_NAME_LEN) {
        notify.warn(`Display name is too long (max ${SECURITY.MAX_DISPLAY_NAME_LEN} chars).`); return;
    }
    // Reject control chars and HTML markers in display name — defense in depth
    // (rendering paths escape via _esc, but invisible/control bytes are pointless).
    if (/[\x00-\x1f<>"']/.test(name)) {
        notify.warn('Display name contains invalid characters.'); return;
    }
    const pwErr = _validatePassword(password);
    if (pwErr) { notify.warn(pwErr); return; }
    if (password !== confirm) { notify.warn('Passwords do not match.'); return; }

    btn.disabled    = true;
    btn.textContent = 'Signing up...';
    try {
        const { data, error } = await supabaseClient.auth.signUp({
            email,
            password,
            options: { data: { custom_name: name } },
        });
        if (error) throw error;

        // Email already registered (empty identities array)
        if (data.user && data.user.identities?.length === 0) {
            notify.warn('This email is already registered. Please log in using the Login tab.');
            return;
        }

        if (data.session) {
            // Email confirmation disabled → user is logged in immediately
            _closeAuthModal();
            notify.success(`Welcome, ${name}! 🎮`);
        } else {
            // Email confirmation required
            _closeAuthModal();
            notify.success('Account created! Check your email for a verification link.', { duration: 6000 });
        }
    } catch (err) {
        notify.error(friendlyError(err, 'Sign-up failed.'), err);
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Sign Up';
    }
}

// Open the auth modal — called by the login button in app.js
window.openAuthModal = (tab = 'login') => {
    const modal = document.getElementById('authModal');
    if (!modal) return;
    document.querySelectorAll('.auth-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('loginPanel').style.display  = tab === 'login'  ? 'block' : 'none';
    document.getElementById('signupPanel').style.display = tab === 'signup' ? 'block' : 'none';
    modal.classList.add('active');
};

// ════════════════════════════════════
//  Change password (email users only)
// ════════════════════════════════════

function initChangePassword() {
    document.getElementById('changePasswordBtn')?.addEventListener('click', async () => {
        const newPw   = document.getElementById('newPasswordInput')?.value;
        const confirm = document.getElementById('newPasswordConfirm')?.value;
        const btn     = document.getElementById('changePasswordBtn');

        if (!newPw) { notify.warn('Please enter a new password.'); return; }
        const pwErr = _validatePassword(newPw);
        if (pwErr) { notify.warn(pwErr); return; }
        if (newPw !== confirm) { notify.warn('Passwords do not match.'); return; }

        btn.disabled    = true;
        btn.textContent = 'Updating...';
        try {
            const { error } = await supabaseClient.auth.updateUser({ password: newPw });
            if (error) throw error;
            notify.success('Password updated.');
            document.getElementById('newPasswordInput').value   = '';
            document.getElementById('newPasswordConfirm').value = '';
        } catch (err) {
            notify.error(friendlyError(err, 'Could not update password.'), err);
        } finally {
            btn.disabled    = false;
            btn.textContent = 'Change';
        }
    });
}

// ════════════════════════════════════
//  Other user's game list
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
        console.error('Failed to load user games:', err.message);
    }
}
