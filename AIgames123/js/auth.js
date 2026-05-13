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
    if (publicProfileContent) publicProfileContent.style.display = 'none'; // 타인 프로필 숨김
    searchContainer.style.visibility = 'visible';
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
    if (publicProfileContent) publicProfileContent.style.display = 'none'; // 타인 프로필 숨김
    searchContainer.style.visibility = 'hidden';

    const currentName = currentUser.user_metadata.custom_name || currentUser.user_metadata.preferred_username || currentUser.user_metadata.full_name || '게이머';
    const avatarUrl = currentUser.user_metadata.avatar_url || 'https://via.placeholder.com/100';

    if(document.getElementById('profileAvatar')) document.getElementById('profileAvatar').src = avatarUrl;
    if(document.getElementById('profileDisplayName')) document.getElementById('profileDisplayName').textContent = currentName;
    if(document.getElementById('profileNameInput')) document.getElementById('profileNameInput').value = currentName;
    if(document.getElementById('profileEmail')) document.getElementById('profileEmail').textContent = currentUser.email || 'No email provided';

    fetchMyGames();
}

// ✨ (새로 추가) 타인의 프로필을 보여주는 함수
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

    // 프로필로 이동하면서 플레이어 모달창은 닫기
    const playerModal = document.getElementById('playerModal');
    const gameFrame = document.getElementById('gameFrame');
    if (playerModal) playerModal.classList.remove('active');
    if (gameFrame) gameFrame.srcdoc = "";
};

// ✨ (새로 추가) 타인이 올린 게임 목록 가져오기
async function fetchPublicGames(userId) {
    const publicGameGrid = document.getElementById('publicGameGrid');
    try {
        const { data, error } = await supabaseClient.from('games').select('*').eq('user_id', userId).order('created_at', { ascending: false });
        if (error) throw error;
        // 타인의 프로필이므로 수정/삭제 버튼이 안 보이게 false를 넘깁니다.
        renderGames(data, publicGameGrid, false);
    } catch (error) { console.error('유저 게임 로드 실패:', error.message); }
}