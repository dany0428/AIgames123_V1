document.addEventListener('DOMContentLoaded', () => {

    // DOM 캐시 초기화 (config.js) — 이후 모든 파일에서 DOM.xxx 사용
    initDOMCache();

    // 로그인 / 로그아웃
    DOM.loginBtn?.addEventListener('click', () =>
        supabaseClient.auth.signInWithOAuth({ provider: 'github' }));
    DOM.logoutBtn?.addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        alert('로그아웃 되었습니다.');
        window.location.href = '/';
    });

    // 로고 클릭 → 메인, 유저 이름 클릭 → 프로필
    document.getElementById('homeLogo')?.addEventListener('click', showMainContent);
    DOM.userInfo?.addEventListener('click', showProfileContent);

    // 정렬 드롭다운
    DOM.sortDropdown?.addEventListener('change', () => {
        currentSort = DOM.sortDropdown.value;
        fetchGames(DOM.searchInput?.value.trim() || '', currentTag);
    });

    // 닉네임 저장
    document.getElementById('saveProfileBtn')?.addEventListener('click', async (e) => {
        const btn     = e.currentTarget;
        const newName = DOM.profileNameInput?.value.trim();
        if (!newName) return alert('닉네임을 입력해주세요.');
        btn.disabled    = true;
        btn.textContent = '저장 중...';
        try {
            const { data, error } = await supabaseClient.auth.updateUser({ data: { custom_name: newName } });
            if (error) throw error;
            alert('닉네임이 성공적으로 변경되었습니다!');
            updateAuthUI(data.user);
            showProfileContent();
        } catch (err) {
            alert('변경 실패: ' + err.message);
        } finally {
            btn.disabled    = false;
            btn.textContent = '저장하기';
        }
    });

    // UI 모듈 초기화
    initUploadModal();
    initEditModal();
    initSidebar();
    initPlayer();
    initFileInputs();
    initSearch();
    initProfileAvatar();
    initDpad();

    // 인증 → 완료 후 현재 URL에 맞는 화면으로 라우팅
    initAuth().then(handleRoute);
});
