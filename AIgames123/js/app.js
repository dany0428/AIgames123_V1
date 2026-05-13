// ── 진입점 ──
document.addEventListener('DOMContentLoaded', () => {

    // 로그인 / 로그아웃 버튼
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    if (loginBtn) loginBtn.onclick = async () => await supabaseClient.auth.signInWithOAuth({ provider: 'github' });
    if (logoutBtn) logoutBtn.onclick = async () => {
        await supabaseClient.auth.signOut();
        alert("로그아웃 되었습니다.");
        window.location.reload();
    };

    // 홈 로고 / 유저 정보 클릭
    const homeLogo = document.getElementById('homeLogo');
    const userInfo = document.getElementById('userInfo');
    if (homeLogo) homeLogo.addEventListener('click', showMainContent);
    if (userInfo) userInfo.addEventListener('click', showProfileContent);

    // ✨ 정렬 드롭다운
    const sortDropdown = document.getElementById('sortDropdown');
    if (sortDropdown) {
        sortDropdown.addEventListener('change', () => {
            currentSort = sortDropdown.value;
            const searchInput = document.getElementById('searchInput');
            fetchGames(searchInput ? searchInput.value.trim() : '', currentTag);
        });
    }

    // 닉네임 저장 버튼
    const saveProfileBtn = document.getElementById('saveProfileBtn');
    if(saveProfileBtn) {
        saveProfileBtn.onclick = async () => {
            const newName = document.getElementById('profileNameInput').value.trim();
            if(!newName) return alert("닉네임을 입력해주세요.");
            saveProfileBtn.disabled = true;
            saveProfileBtn.textContent = "저장 중...";
            try {
                const { data, error } = await supabaseClient.auth.updateUser({ data: { custom_name: newName } });
                if (error) throw error;
                alert("닉네임이 성공적으로 변경되었습니다!");
                updateAuthUI(data.user);
                showProfileContent();
            } catch (error) { alert("변경 실패: " + error.message); }
            finally { saveProfileBtn.disabled = false; saveProfileBtn.textContent = "저장하기"; }
        }
    }

    // 각 모듈 초기화 (ui.js)
    initUploadModal();
    initEditModal();
    initSidebar();
    initPlayer();
    initFileInputs();
    initSearch();
    initProfileAvatar();

    // 인증 초기화 (auth.js) → 완료 후 메인 화면 표시
    initAuth();
    showMainContent();
});
