function updateAuthUI(user) {
    const prevUser = currentUser;
    currentUser = user;

    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const uploadBtn = document.getElementById('uploadBtn');
    const userInfo = document.getElementById('userInfo');
    const searchInput = document.getElementById('searchInput');

    if (user) {
        if(loginBtn) loginBtn.style.display = 'none';
        if(logoutBtn) logoutBtn.style.display = 'block';
        if(uploadBtn) uploadBtn.style.display = 'block';
        if(userInfo) {
            userInfo.style.display = 'block';
            const userName = user.user_metadata.custom_name || user.user_metadata.preferred_username || user.user_metadata.full_name || '게이머';
            userInfo.textContent = `${userName}님`;
        }

        // ✨ 로그인 시 내 모든 게임의 uploader_name과 uploader_avatar를 최신 값으로 동기화
        if (!prevUser) {
            const currentName = user.user_metadata.custom_name || user.user_metadata.preferred_username || user.user_metadata.full_name || '게이머';
            const currentAvatar = user.user_metadata.custom_avatar || user.user_metadata.avatar_url || '';
            supabaseClient
                .from('games')
                .update({ uploader_name: currentName, uploader_avatar: currentAvatar })
                .eq('user_id', user.id)
                .then(({ error }) => {
                    if (error) console.warn('uploader 동기화 실패:', error.message);
                });
        }
    } else {
        if(loginBtn) loginBtn.style.display = 'block';
        if(logoutBtn) logoutBtn.style.display = 'none';
        if(uploadBtn) uploadBtn.style.display = 'none';
        if(userInfo) userInfo.style.display = 'none';
        showMainContent();
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

function showMainContent() {
    const mainContent = document.getElementById('mainContent');
    const profileContent = document.getElementById('profileContent');
    const publicProfileContent = document.getElementById('publicProfileContent');
    const searchContainer = document.getElementById('searchContainer');

    mainContent.style.display = 'block';
    profileContent.style.display = 'none';
    if (publicProfileContent) publicProfileContent.style.display = 'none';
    searchContainer.style.visibility = 'visible';

    // ✨ 태그 필터·섹션 타이틀 초기화
    currentTag = '';
    const sectionTitle = document.getElementById('sectionTitle');
    if (sectionTitle) sectionTitle.textContent = 'Popular Games';
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = '';

    fetchGames();
}

function showProfileContent() {
    if (!currentUser) return;
    const mainContent = document.getElementById('mainContent');
    const profileContent = document.getElementById('profileContent');
    const publicProfileContent = document.getElementById('publicProfileContent');
    const searchContainer = document.getElementById('searchContainer');

    mainContent.style.display = 'none';
    profileContent.style.display = 'block';
    if (publicProfileContent) publicProfileContent.style.display = 'none';
    searchContainer.style.visibility = 'hidden';

    const currentName = currentUser.user_metadata.custom_name || currentUser.user_metadata.preferred_username || currentUser.user_metadata.full_name || '게이머';
    // ✨ [버그수정] custom_avatar(직접 업로드)를 우선 읽고, 없으면 GitHub avatar_url 사용
    const avatarUrl = currentUser.user_metadata.custom_avatar || currentUser.user_metadata.avatar_url || 'https://via.placeholder.com/100';

    if(document.getElementById('profileAvatar')) document.getElementById('profileAvatar').src = avatarUrl;
    if(document.getElementById('avatarPreview')) document.getElementById('avatarPreview').src = avatarUrl; // 설정 카드 미리보기도 동기화
    if(document.getElementById('profileDisplayName')) document.getElementById('profileDisplayName').textContent = currentName;
    if(document.getElementById('profileNameInput')) document.getElementById('profileNameInput').value = currentName;
    if(document.getElementById('profileEmail')) document.getElementById('profileEmail').textContent = currentUser.email || 'No email provided';

    fetchMyGames();
}

// ✨ 타인의 프로필을 보여주는 함수
window.showPublicProfile = (userId, userName) => {
    const mainContent = document.getElementById('mainContent');
    const profileContent = document.getElementById('profileContent');
    const publicProfileContent = document.getElementById('publicProfileContent');
    const searchContainer = document.getElementById('searchContainer');

    mainContent.style.display = 'none';
    profileContent.style.display = 'none';
    if (publicProfileContent) publicProfileContent.style.display = 'block';
    if (searchContainer) searchContainer.style.visibility = 'hidden';

    const nameEl = document.getElementById('publicProfileName');
    if (nameEl) nameEl.textContent = userName;

    fetchPublicGames(userId);

    const playerModal = document.getElementById('playerModal');
    const gameFrame = document.getElementById('gameFrame');
    if (playerModal) playerModal.classList.remove('active');
    if (gameFrame) gameFrame.srcdoc = "";
    document.body.style.overflow = '';
};

// ✨ 타인이 올린 게임 목록 가져오기
async function fetchPublicGames(userId) {
    const publicGameGrid = document.getElementById('publicGameGrid');
    try {
        const { data, error } = await supabaseClient.from('games').select('*').eq('user_id', userId).order('created_at', { ascending: false });
        if (error) throw error;
        renderGames(data, publicGameGrid, false);
    } catch (error) { console.error('유저 게임 로드 실패:', error.message); }
}
