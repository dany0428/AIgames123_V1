const SUPABASE_URL = 'https://bpaqjmwzdxdgitlwmamp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwYXFqbXd6ZHhkZ2l0bHdtYW1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyOTczMDMsImV4cCI6MjA4ODg3MzMwM30.7MVzlcoc3p46_b5jEn1aUr5LE2kF3EWlF89fqBH1MSM';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.addEventListener('DOMContentLoaded', () => {
    let currentUser = null; 

    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const userInfo = document.getElementById('userInfo');
    const uploadBtn = document.getElementById('uploadBtn');
    const homeLogo = document.getElementById('homeLogo'); 
    const searchInput = document.getElementById('searchInput');
    const searchContainer = document.getElementById('searchContainer');
    
    const mainContent = document.getElementById('mainContent');
    const profileContent = document.getElementById('profileContent');

    // === 인증(Auth) UI 업데이트 (custom_name 우선 적용) ===
    function updateAuthUI(user) {
        const prevUser = currentUser;
        currentUser = user;
        
        if (user) {
            if(loginBtn) loginBtn.style.display = 'none';
            if(logoutBtn) logoutBtn.style.display = 'block';
            if(uploadBtn) uploadBtn.style.display = 'block';
            if(userInfo) {
                userInfo.style.display = 'block';
                // ✨ 깃허브 기본 이름보다 custom_name을 최우선으로 보여줍니다!
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
            const currentSearch = searchInput ? searchInput.value.trim() : '';
            fetchGames(currentSearch, currentTag);
        }
    }

    async function initAuth() {
        const { data: { session } } = await supabaseClient.auth.getSession();
        updateAuthUI(session?.user);

        supabaseClient.auth.onAuthStateChange((_event, session) => {
            updateAuthUI(session?.user);
        });
    }
    initAuth();

    if (loginBtn) loginBtn.onclick = async () => await supabaseClient.auth.signInWithOAuth({ provider: 'github' });
    if (logoutBtn) logoutBtn.onclick = async () => {
        await supabaseClient.auth.signOut();
        alert("로그아웃 되었습니다.");
        window.location.reload(); 
    };

    // === 화면 전환 로직 (프로필 화면 데이터 채우기) ===
    function showMainContent() {
        mainContent.style.display = 'block';
        profileContent.style.display = 'none';
        searchContainer.style.visibility = 'visible';
        fetchGames(); 
    }

    function showProfileContent() {
        if (!currentUser) return;
        mainContent.style.display = 'none';
        profileContent.style.display = 'block';
        searchContainer.style.visibility = 'hidden'; 
        
        // ✨ 프로필 화면 대시보드 정보 채우기
        const currentName = currentUser.user_metadata.custom_name || currentUser.user_metadata.preferred_username || currentUser.user_metadata.full_name || '게이머';
        const avatarUrl = currentUser.user_metadata.avatar_url || 'https://via.placeholder.com/100';
        
        document.getElementById('profileAvatar').src = avatarUrl;
        document.getElementById('profileDisplayName').textContent = currentName;
        document.getElementById('profileNameInput').value = currentName;
        document.getElementById('profileEmail').textContent = currentUser.email || 'No email provided';

        fetchMyGames(); // 내 게임 목록 및 통계 계산
    }

    if (homeLogo) homeLogo.addEventListener('click', showMainContent);
    if (userInfo) userInfo.addEventListener('click', showProfileContent);

    // ✨ 프로필 이름 영구 저장 로직
    const saveProfileBtn = document.getElementById('saveProfileBtn');
    if(saveProfileBtn) {
        saveProfileBtn.onclick = async () => {
            const newName = document.getElementById('profileNameInput').value.trim();
            if(!newName) return alert("닉네임을 입력해주세요.");
            
            saveProfileBtn.disabled = true;
            saveProfileBtn.textContent = "저장 중...";

            try {
                // preferred_username 대신 custom_name에 저장하여 깃허브 덮어쓰기 방지
                const { data, error } = await supabaseClient.auth.updateUser({
                    data: { custom_name: newName }
                });
                if (error) throw error;
                
                alert("닉네임이 성공적으로 변경되었습니다!");
                updateAuthUI(data.user);
                showProfileContent(); // 대시보드 화면 바로 갱신
            } catch (error) {
                alert("변경 실패: " + error.message);
            } finally {
                saveProfileBtn.disabled = false;
                saveProfileBtn.textContent = "저장하기";
            }
        }
    }


    const gameGrid = document.getElementById('gameGrid');
    const myGameGrid = document.getElementById('myGameGrid'); 
    const gameFrame = document.getElementById('gameFrame');
    const placeholder = document.getElementById('placeholder');
    const playerModal = document.getElementById('playerModal');
    
    const menuBtn = document.getElementById('menuBtn');
    const sidebar = document.getElementById('sidebar');
    const closeSidebar = document.getElementById('closeSidebar');
    const genreList = document.getElementById('genreList');
    const sectionTitle = document.getElementById('sectionTitle');
    const fullscreenBtn = document.getElementById('fullscreenBtn'); 
    const closePlayer = document.getElementById('closePlayer');
    const deleteGameBtn = document.getElementById('deleteGameBtn');

    let currentTag = '';

    async function fetchAndRenderTags() {
        try {
            const { data, error } = await supabaseClient.from('games').select('tags');
            if (!error) {
                const allTags = new Set();
                data.forEach(game => {
                    if (game.tags) game.tags.split(',').forEach(tag => { if (tag.trim()) allTags.add(tag.trim()); });
                });
                let tagsHtml = `<li class="genre-item ${currentTag === '' ? 'active' : ''}" onclick="filterByTag('')">All Games</li>`;
                Array.from(allTags).sort().forEach(tag => { tagsHtml += `<li class="genre-item ${currentTag === tag ? 'active' : ''}" onclick="filterByTag('${tag}')"># ${tag}</li>`; });
                if(genreList) genreList.innerHTML = tagsHtml;
            }
        } catch (error) {}
    }

    async function fetchGames(searchTerm = '', tagFilter = '') {
        try {
            let query = supabaseClient.from('games').select('*').order('view_count', { ascending: false }).order('created_at', { ascending: false }).range(0, 49);
            if (searchTerm) query = query.ilike('name', `%${searchTerm}%`);
            if (tagFilter) query = query.ilike('tags', `%${tagFilter}%`); 
            
            const { data, error } = await query;
            if (error) throw error;
            
            renderGames(data, gameGrid, false);
            fetchAndRenderTags(); 
        } catch (error) { console.error('데이터 로드 실패:', error.message); }
    }

    // ✨ 내 게임 목록 가져오기 및 통계(Stats) 계산
    async function fetchMyGames() {
        try {
            const { data, error } = await supabaseClient
                .from('games')
                .select('*')
                .eq('user_id', currentUser.id)
                .order('created_at', { ascending: false });
            
            if (error) throw error;

            // 통계 계산 로직 추가
            let totalViews = 0;
            data.forEach(game => { totalViews += (game.view_count || 0); });
            
            document.getElementById('statTotalGames').textContent = `${data.length}개`;
            document.getElementById('statTotalViews').textContent = `${totalViews}회`;

            renderGames(data, myGameGrid, true); 
        } catch (error) { console.error('내 게임 로드 실패:', error.message); }
    }

    window.filterByTag = (tag) => {
        currentTag = tag;
        showMainContent(); 
        if(sectionTitle) sectionTitle.textContent = tag ? `#${tag} Games` : 'Popular Games';
        if (searchInput) searchInput.value = ''; 
        if(sidebar) sidebar.classList.remove('active'); 
        fetchGames('', tag);
    };

    window.deleteGame = async (gameId, event) => {
        if(event) event.stopPropagation(); 
        if (!confirm("정말 이 게임을 삭제하시겠습니까?\n삭제된 데이터는 복구할 수 없습니다.")) return;

        try {
            const { error } = await supabaseClient.from('games').delete().eq('id', gameId);
            if (error) throw error;
            alert("게임이 삭제되었습니다.");
            
            playerModal.classList.remove('active');
            gameFrame.srcdoc = "";
            if (deleteGameBtn) deleteGameBtn.style.display = 'none';

            if (profileContent.style.display === 'block') fetchMyGames();
            else fetchGames();
        } catch (error) { alert("오류가 발생했습니다: " + error.message); }
    };

    const editModal = document.getElementById('editModal');
    const closeEdit = document.getElementById('closeEdit');
    const submitEditGame = document.getElementById('submitEditGame');
    let editingGameId = null;

    window.openEditModal = (gameId, name, tags, event) => {
        event.stopPropagation(); 
        editingGameId = gameId;
        document.getElementById('editGameName').value = name;
        document.getElementById('editGameTags').value = tags === 'undefined' ? '' : tags;
        editModal.classList.add('active');
    }

    if(closeEdit) closeEdit.onclick = () => editModal.classList.remove('active');

    if(submitEditGame) {
        submitEditGame.onclick = async () => {
            const newName = document.getElementById('editGameName').value.trim();
            const newTags = document.getElementById('editGameTags').value.trim();
            if(!newName) return alert("게임 이름을 입력해주세요.");

            submitEditGame.disabled = true;
            submitEditGame.textContent = "저장 중...";

            try {
                const { error } = await supabaseClient
                    .from('games')
                    .update({ name: newName, tags: newTags })
                    .eq('id', editingGameId);
                
                if (error) throw error;
                alert("정보가 수정되었습니다.");
                editModal.classList.remove('active');
                fetchMyGames(); 
            } catch(error) {
                alert("수정 실패: " + error.message);
            } finally {
                submitEditGame.disabled = false;
                submitEditGame.textContent = "저장하기";
            }
        }
    }

    function renderGames(gameList, targetGrid, isProfile = false) {
        if (!targetGrid) return;
        if (gameList.length === 0) {
            targetGrid.innerHTML = '<p style="grid-column: 1 / -1; text-align: center; color: #888; padding: 2rem;">아직 업로드한 게임이 없습니다. 😢</p>';
            return;
        }

        targetGrid.innerHTML = gameList.map(game => {
            const thumbnailContent = game.thumbnail_url 
                ? `<img src="${game.thumbnail_url}" alt="${game.name}" class="game-thumb-img">`
                : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="50"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="8" cy="12" r="2"/><path d="M15 9v6M12 12h6"/></svg>`;

            const viewCount = game.view_count || 0;
            const uploaderId = game.user_id ? `'${game.user_id}'` : 'null';
            
            let tagsHtml = '';
            if (game.tags) {
                const tagsArray = game.tags.split(',').slice(0, 3);
                tagsHtml = `<div class="card-tags">` + tagsArray.map(t => `<span class="tag-badge">${t.trim()}</span>`).join('') + `</div>`;
            }

            let profileActionsHtml = '';
            if (isProfile) {
                profileActionsHtml = `
                <div class="profile-card-actions">
                    <button class="action-btn edit-btn" onclick="openEditModal(${game.id}, '${game.name}', '${game.tags || ''}', event)" title="정보 수정">✏️</button>
                    <button class="action-btn del-btn" onclick="deleteGame(${game.id}, event)" title="게임 삭제">🗑️</button>
                </div>`;
            }

            return `
            <div class="game-card" onclick="openGame(${game.id}, '${game.file_url}', '${game.name}', ${viewCount}, ${uploaderId})">
                <div class="game-thumbnail">
                    ${thumbnailContent}
                    ${profileActionsHtml}
                    <div class="card-badges">
                        <span class="view-badge">👁️ ${viewCount}</span>
                    </div>
                </div>
                <div class="game-info">
                    <h3 class="game-title">${game.name}</h3>
                    ${tagsHtml}
                </div>
            </div>
            `;
        }).join('');
    }

    window.openGame = async (id, url, name, currentViewCount, uploaderId) => {
        document.getElementById('playerTitle').textContent = name;
        playerModal.classList.add('active');
        gameFrame.style.display = 'block';
        if (placeholder) placeholder.style.display = 'none';

        if (deleteGameBtn) {
            if (currentUser && currentUser.id === uploaderId) {
                deleteGameBtn.style.display = 'block';
                deleteGameBtn.onclick = () => deleteGame(id, null);
            } else {
                deleteGameBtn.style.display = 'none';
                deleteGameBtn.onclick = null;
            }
        }
        
        const viewportMeta = '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
        gameFrame.srcdoc = `${viewportMeta}<div style="display:flex; justify-content:center; align-items:center; height:100vh; font-family:sans-serif; color:black;">게임을 불러오는 중입니다...</div>`;

        try {
            supabaseClient.from('games').update({ view_count: currentViewCount + 1 }).eq('id', id).then(({ error }) => {
                if (profileContent.style.display === 'block') fetchMyGames();
                else fetchGames(searchInput ? searchInput.value.trim() : '', currentTag); 
            });

            const response = await fetch(url);
            if (!response.ok) throw new Error('게임을 불러올 수 없습니다.');
            const htmlContent = await response.text();
            gameFrame.srcdoc = viewportMeta + htmlContent;
        } catch (error) {
            gameFrame.srcdoc = '<div style="display:flex; justify-content:center; align-items:center; height:100vh; color:red;">문제가 발생했습니다.</div>';
        }
    };


    const uploadModal = document.getElementById('uploadModal');
    const closeUpload = document.getElementById('closeUpload');
    const submitGameBtn = document.getElementById('submitGame');
    const gameNameInput = document.getElementById('gameName');
    const gameTagsInput = document.getElementById('gameTags');
    const gameFileInput = document.getElementById('gameFileInput');
    const thumbnailFileInput = document.getElementById('thumbnailFileInput');

    if (uploadBtn) uploadBtn.onclick = () => {
        if (!currentUser) return alert("로그인이 필요합니다.");
        uploadModal.classList.add('active');
    };
    if (closeUpload) closeUpload.onclick = () => uploadModal.classList.remove('active');

    if (submitGameBtn) {
        submitGameBtn.onclick = async () => {
            if (!currentUser) return alert("로그인이 필요합니다!");
            const name = gameNameInput.value.trim();
            const tags = gameTagsInput.value.trim(); 
            const file = gameFileInput.files[0];
            const thumbFile = thumbnailFileInput.files[0];

            if (!name || !file) return alert("게임 이름과 HTML 파일은 필수입니다!");
            submitGameBtn.innerText = "업로드 중...";
            submitGameBtn.disabled = true;

            try {
                const htmlText = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target.result);
                    reader.onerror = (e) => reject(new Error("파일 읽기 실패"));
                    reader.readAsText(file, "UTF-8");
                });
                const blob = new Blob([htmlText], { type: 'text/html; charset=utf-8' });
                const fileName = `${Date.now()}_${file.name}`;

                const { error: uploadError } = await supabaseClient.storage.from('game-files').upload(fileName, blob, { contentType: 'text/html; charset=utf-8', upsert: true });
                if (uploadError) throw uploadError;
                const { data: { publicUrl: gamePublicUrl } } = supabaseClient.storage.from('game-files').getPublicUrl(fileName);

                let thumbPublicUrl = null;
                if (thumbFile) {
                    const thumbName = `${Date.now()}_thumb_${thumbFile.name}`;
                    const { error: thumbError } = await supabaseClient.storage.from('game-files').upload(thumbName, thumbFile, { upsert: true });
                    if (thumbError) throw thumbError;
                    const { data: thumbData } = supabaseClient.storage.from('game-files').getPublicUrl(thumbName);
                    thumbPublicUrl = thumbData.publicUrl;
                }

                const { error: dbError } = await supabaseClient.from('games').insert([{ 
                    id: Date.now(), name: name, file_url: gamePublicUrl, thumbnail_url: thumbPublicUrl, tags: tags, view_count: 0, user_id: currentUser.id 
                }]);
                if (dbError) throw dbError;

                alert("업로드 성공!");
                uploadModal.classList.remove('active');
                
                gameNameInput.value = ''; gameTagsInput.value = ''; gameFileInput.value = ''; thumbnailFileInput.value = '';
                
                if (profileContent.style.display === 'block') fetchMyGames();
                else fetchGames(); 
            } catch (error) { alert("오류 발생: " + error.message); } 
            finally { submitGameBtn.innerText = "Launch Game"; submitGameBtn.disabled = false; }
        };
    }

    if (menuBtn) menuBtn.addEventListener('click', () => sidebar.classList.add('active'));
    if (closeSidebar) closeSidebar.addEventListener('click', () => sidebar.classList.remove('active'));
    document.addEventListener('click', (e) => {
        if (sidebar && menuBtn && sidebar.classList.contains('active') && !sidebar.contains(e.target) && !menuBtn.contains(e.target)) sidebar.classList.remove('active');
    });

    if (fullscreenBtn) fullscreenBtn.onclick = () => {
        if (gameFrame.requestFullscreen) gameFrame.requestFullscreen();
        else if (gameFrame.webkitRequestFullscreen) gameFrame.webkitRequestFullscreen();
        else if (gameFrame.msRequestFullscreen) gameFrame.msRequestFullscreen();
    };
    
    if (closePlayer) closePlayer.onclick = () => { 
        playerModal.classList.remove('active'); 
        gameFrame.srcdoc = ""; 
        if(deleteGameBtn) deleteGameBtn.style.display = 'none'; 
    };
    
    if(document.getElementById('gameFileInput')) document.getElementById('gameFileInput').onchange = (e) => { document.getElementById('gameFileName').textContent = e.target.files[0]?.name || ''; };
    if(document.getElementById('thumbnailFileInput')) document.getElementById('thumbnailFileInput').onchange = (e) => { document.getElementById('thumbnailFileName').textContent = e.target.files[0]?.name || ''; };

    let searchTimeout;
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                const searchTerm = e.target.value.trim();
                fetchGames(searchTerm, currentTag);
            }, 300);
        });
    }

    showMainContent();
});
