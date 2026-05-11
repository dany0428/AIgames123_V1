const SUPABASE_URL = 'https://bpaqjmwzdxdgitlwmamp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwYXFqbXd6ZHhkZ2l0bHdtYW1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyOTczMDMsImV4cCI6MjA4ODg3MzMwM30.7MVzlcoc3p46_b5jEn1aUr5LE2kF3EWlF89fqBH1MSM';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.addEventListener('DOMContentLoaded', () => {
    let currentUser = null; 

    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const userInfo = document.getElementById('userInfo');
    const uploadBtn = document.getElementById('uploadBtn');

    function updateAuthUI(user) {
        currentUser = user;
        if (user) {
            if(loginBtn) loginBtn.style.display = 'none';
            if(logoutBtn) logoutBtn.style.display = 'block';
            if(uploadBtn) uploadBtn.style.display = 'block';
            if(userInfo) {
                userInfo.style.display = 'block';
                const userName = user.user_metadata.preferred_username || user.user_metadata.full_name || '게이머';
                userInfo.textContent = `${userName}님`;
            }
        } else {
            if(loginBtn) loginBtn.style.display = 'block';
            if(logoutBtn) logoutBtn.style.display = 'none';
            if(uploadBtn) uploadBtn.style.display = 'none';
            if(userInfo) userInfo.style.display = 'none';
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

    // DOM 요소들
    const gameGrid = document.getElementById('gameGrid');
    const gameFrame = document.getElementById('gameFrame');
    const placeholder = document.getElementById('placeholder');
    const playerModal = document.getElementById('playerModal');
    const uploadModal = document.getElementById('uploadModal');
    
    const homeLogo = document.getElementById('homeLogo'); 
    const searchInput = document.getElementById('searchInput');
    const menuBtn = document.getElementById('menuBtn');
    const sidebar = document.getElementById('sidebar');
    const closeSidebar = document.getElementById('closeSidebar');
    const genreList = document.getElementById('genreList');
    const sectionTitle = document.getElementById('sectionTitle');
    
    const closeUpload = document.getElementById('closeUpload');
    const closePlayer = document.getElementById('closePlayer');
    const fullscreenBtn = document.getElementById('fullscreenBtn'); 
    const submitGameBtn = document.getElementById('submitGame');
    const deleteGameBtn = document.getElementById('deleteGameBtn'); // 새로 추가된 삭제 버튼
    
    const gameNameInput = document.getElementById('gameName');
    const gameTagsInput = document.getElementById('gameTags');
    const gameFileInput = document.getElementById('gameFileInput');
    const gameFileName = document.getElementById('gameFileName');
    const thumbnailFileInput = document.getElementById('thumbnailFileInput');
    const thumbnailFileName = document.getElementById('thumbnailFileName');   

    let currentTag = '';

    async function fetchAndRenderTags() {
        try {
            const { data, error } = await supabaseClient.from('games').select('tags');
            if (error) throw error;

            const allTags = new Set();
            data.forEach(game => {
                if (game.tags) {
                    game.tags.split(',').forEach(tag => {
                        const t = tag.trim();
                        if (t) allTags.add(t);
                    });
                }
            });

            let tagsHtml = `<li class="genre-item ${currentTag === '' ? 'active' : ''}" onclick="filterByTag('')">All Games</li>`;
            Array.from(allTags).sort().forEach(tag => {
                tagsHtml += `<li class="genre-item ${currentTag === tag ? 'active' : ''}" onclick="filterByTag('${tag}')"># ${tag}</li>`;
            });
            if(genreList) genreList.innerHTML = tagsHtml;
        } catch (error) {}
    }

    async function fetchGames(searchTerm = '', tagFilter = '') {
        try {
            let query = supabaseClient
                .from('games')
                .select('*')
                .order('view_count', { ascending: false })
                .order('created_at', { ascending: false })
                .range(0, 49);
            
            if (searchTerm) query = query.ilike('name', `%${searchTerm}%`);
            if (tagFilter) query = query.ilike('tags', `%${tagFilter}%`); 

            const { data, error } = await query;
            if (error) throw error;
            
            renderGames(data);
            fetchAndRenderTags(); 
        } catch (error) {
            console.error('데이터 로드 실패:', error.message);
        }
    }

    window.filterByTag = (tag) => {
        currentTag = tag;
        if(sectionTitle) sectionTitle.textContent = tag ? `#${tag} Games` : 'Popular Games';
        if (searchInput) searchInput.value = ''; 
        if(sidebar) sidebar.classList.remove('active'); 
        fetchGames('', tag);
    };

    // ✨ 삭제 처리 로직
    window.deleteGame = async (gameId) => {
        if (!confirm("정말 이 게임을 삭제하시겠습니까?\n삭제된 데이터는 복구할 수 없습니다.")) return;

        try {
            const { error } = await supabaseClient.from('games').delete().eq('id', gameId);
            if (error) throw error;

            alert("게임이 삭제되었습니다.");
            
            // 삭제 후 모달창 닫기 및 화면 초기화
            playerModal.classList.remove('active');
            gameFrame.srcdoc = "";
            if (deleteGameBtn) deleteGameBtn.style.display = 'none';

            const currentSearch = searchInput ? searchInput.value.trim() : '';
            fetchGames(currentSearch, currentTag);
        } catch (error) {
            alert("삭제 권한이 없거나 오류가 발생했습니다: " + error.message);
            console.error(error);
        }
    };

    function renderGames(gameList) {
        if (!gameGrid) return;
        
        if (gameList.length === 0) {
            gameGrid.innerHTML = '<p style="grid-column: 1 / -1; text-align: center; color: #888; padding: 2rem;">해당하는 게임이 없습니다. 😢</p>';
            return;
        }

        gameGrid.innerHTML = gameList.map(game => {
            const thumbnailContent = game.thumbnail_url 
                ? `<img src="${game.thumbnail_url}" alt="${game.name}" class="game-thumb-img">`
                : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="50"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="8" cy="12" r="2"/><path d="M15 9v6M12 12h6"/></svg>`;

            const viewCount = game.view_count || 0;
            const uploaderId = game.user_id ? `'${game.user_id}'` : 'null'; // 업로더 ID 파라미터 전달 준비
            
            let tagsHtml = '';
            if (game.tags) {
                const tagsArray = game.tags.split(',').slice(0, 3);
                tagsHtml = `<div class="card-tags">` + tagsArray.map(t => `<span class="tag-badge">${t.trim()}</span>`).join('') + `</div>`;
            }

            // 휴지통 모양 아이콘 삭제!
            // openGame 함수에 uploaderId를 넘겨주도록 수정
            return `
            <div class="game-card" onclick="openGame(${game.id}, '${game.file_url}', '${game.name}', ${viewCount}, ${uploaderId})">
                <div class="game-thumbnail">
                    ${thumbnailContent}
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
                    id: Date.now(), 
                    name: name, 
                    file_url: gamePublicUrl,
                    thumbnail_url: thumbPublicUrl,
                    tags: tags,
                    view_count: 0, 
                    user_id: currentUser.id 
                }]);
                if (dbError) throw dbError;

                alert("업로드 성공!");
                uploadModal.classList.remove('active');
                
                gameNameInput.value = '';
                gameTagsInput.value = '';
                gameFileInput.value = '';
                thumbnailFileInput.value = '';
                if (gameFileName) gameFileName.textContent = '';
                if (thumbnailFileName) thumbnailFileName.textContent = '';
                
                if (searchInput) searchInput.value = '';
                currentTag = '';
                if(sectionTitle) sectionTitle.textContent = 'Popular Games';
                fetchGames(); 
            } catch (error) {
                alert("오류 발생: " + error.message);
                console.error(error);
            } finally {
                submitGameBtn.innerText = "Launch Game";
                submitGameBtn.disabled = false;
            }
        };
    }

    // ✨ 게임 열 때 로그인 정보 확인해서 버튼 보여주기
    window.openGame = async (id, url, name, currentViewCount, uploaderId) => {
        document.getElementById('playerTitle').textContent = name;
        playerModal.classList.add('active');
        gameFrame.style.display = 'block';
        if (placeholder) placeholder.style.display = 'none';

        // 내가 작성한 게임이면 우측 하단 삭제 버튼 보이기!
        if (deleteGameBtn) {
            if (currentUser && currentUser.id === uploaderId) {
                deleteGameBtn.style.display = 'block';
                deleteGameBtn.onclick = () => deleteGame(id);
            } else {
                deleteGameBtn.style.display = 'none';
                deleteGameBtn.onclick = null;
            }
        }
        
        const viewportMeta = '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
        gameFrame.srcdoc = `${viewportMeta}<div style="display:flex; justify-content:center; align-items:center; height:100vh; font-family:sans-serif; color:black;">게임을 불러오는 중입니다...</div>`;

        try {
            supabaseClient.from('games').update({ view_count: currentViewCount + 1 }).eq('id', id).then(({ error }) => {
                const currentSearch = searchInput ? searchInput.value.trim() : '';
                if (!error) fetchGames(currentSearch, currentTag); 
            });

            const response = await fetch(url);
            if (!response.ok) throw new Error('게임을 불러올 수 없습니다.');
            
            const htmlContent = await response.text();
            gameFrame.srcdoc = viewportMeta + htmlContent;
        } catch (error) {
            gameFrame.srcdoc = '<div style="display:flex; justify-content:center; align-items:center; height:100vh; color:red;">문제가 발생했습니다.</div>';
        }
    };

    if (homeLogo) homeLogo.addEventListener('click', () => {
        if (searchInput) searchInput.value = ''; 
        currentTag = '';
        if(sectionTitle) sectionTitle.textContent = 'Popular Games';
        fetchGames(); 
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    if (menuBtn) menuBtn.addEventListener('click', () => sidebar.classList.add('active'));
    if (closeSidebar) closeSidebar.addEventListener('click', () => sidebar.classList.remove('active'));

    document.addEventListener('click', (e) => {
        if (sidebar && menuBtn && sidebar.classList.contains('active') && !sidebar.contains(e.target) && !menuBtn.contains(e.target)) {
            sidebar.classList.remove('active');
        }
    });

    if (fullscreenBtn) fullscreenBtn.onclick = () => {
        if (gameFrame.requestFullscreen) gameFrame.requestFullscreen();
        else if (gameFrame.webkitRequestFullscreen) gameFrame.webkitRequestFullscreen();
        else if (gameFrame.msRequestFullscreen) gameFrame.msRequestFullscreen();
    };

    if (uploadBtn) uploadBtn.onclick = () => {
        if (!currentUser) return alert("로그인이 필요합니다.");
        uploadModal.classList.add('active');
    };
    if (closeUpload) closeUpload.onclick = () => uploadModal.classList.remove('active');
    
    if (closePlayer) closePlayer.onclick = () => { 
        playerModal.classList.remove('active'); 
        gameFrame.srcdoc = ""; 
        if(deleteGameBtn) deleteGameBtn.style.display = 'none'; // 창 닫을 때 버튼도 다시 숨기기
    };

    if (gameFileInput) gameFileInput.onchange = (e) => { if (gameFileName) gameFileName.textContent = e.target.files[0]?.name || ''; };
    if (thumbnailFileInput) thumbnailFileInput.onchange = (e) => { if (thumbnailFileName) thumbnailFileName.textContent = e.target.files[0]?.name || ''; };

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

    fetchGames();
});
