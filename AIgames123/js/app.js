// ════════════════════════════════════════════════════════
//  app.js — AI Games Arcade entry point
//  Wires DOM events on load; delegates module initialization to ui.js/auth.js.
// ════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {

    // Cache DOM nodes once (defined in config.js) — all later modules read via DOM.xxx
    initDOMCache();

    // Login button → open auth modal
    DOM.loginBtn?.addEventListener('click', () => window.openAuthModal('login'));

    // Logout
    DOM.logoutBtn?.addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        notify.success('Logged out.');
        window.location.href = '/';
    });

    // Logo → main; user name → profile
    document.getElementById('homeLogo')?.addEventListener('click', showMainContent);
    DOM.userInfo?.addEventListener('click', showProfileContent);

    // Sort dropdown
    DOM.sortDropdown?.addEventListener('change', () => {
        currentSort = DOM.sortDropdown.value;
        fetchGames(DOM.searchInput?.value.trim() || '', currentTag);
    });

    // Save display name
    document.getElementById('saveProfileBtn')?.addEventListener('click', async (e) => {
        const btn     = e.currentTarget;
        const newName = DOM.profileNameInput?.value.trim();
        if (!newName) return notify.warn('Please enter a display name.');
        btn.disabled    = true;
        btn.textContent = 'Saving...';
        try {
            const { data, error } = await supabaseClient.auth.updateUser({ data: { custom_name: newName } });
            if (error) throw error;
            notify.success('Display name updated!');
            updateAuthUI(data.user);
            showProfileContent();
        } catch (err) {
            notify.error(friendlyError(err, 'Could not update display name.'), err);
        } finally {
            btn.disabled    = false;
            btn.textContent = 'Save';
        }
    });

    // Module initialization (ui.js)
    initUploadModal();
    initEditModal();
    initSidebar();
    initPlayer();
    initFileInputs();
    initSearch();
    initProfileAvatar();
    initDpad();
    initJoystick();
    initReport();

    // Auth modal (auth.js)
    initAuthModal();
    initChangePassword();

    // Bootstrap auth, then route to the URL's view.
    // OPTIMIZATION: initAuth() internally calls updateAuthUI(null) with a bootstrap
    // flag that suppresses an initial _renderMain(), so only the .then(handleRoute)
    // below renders the grid once instead of twice.
    initAuth().then(handleRoute);
});
