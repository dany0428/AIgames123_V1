const SUPABASE_URL = 'https://bpaqjmwzdxdgitlwmamp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwYXFqbXd6ZHhkZ2l0bHdtYW1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyOTczMDMsImV4cCI6MjA4ODg3MzMwM30.7MVzlcoc3p46_b5jEn1aUr5LE2kF3EWlF89fqBH1MSM';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.addEventListener('DOMContentLoaded', () => {
    const gameGrid = document.getElementById('gameGrid');
    const gameFrame = document.getElementById('gameFrame');
    const placeholder = document.getElementById('placeholder');
    const playerModal = document.getElementById('playerModal');
    const uploadModal = document.getElementById('uploadModal');
    
    // 네비게이션 및 사이드바 요소
    const homeLogo = document.getElementById('homeLogo'); 
    const searchInput = document.getElementById('searchInput');
    const menuBtn = document.getElementById('menuBtn');
    const sidebar = document.getElementById('sidebar');
    const closeSidebar = document.getElementById('closeSidebar');
    const genreList = document.getElementById('genreList');
    const sectionTitle = document.getElementById('sectionTitle');
    
    // 업로드 요소
    const uploadBtn = document.getElementById('uploadBtn');
    const closeUpload = document.getElementById('closeUpload');
    const closePlayer = document.getElementById('closePlayer');
    const fullscreenBtn = document.getElementById('fullscreenBtn'); 
    const submitGameBtn = document.getElementById('submitGame');
    const gameNameInput = document.getElementById('gameName');
    const gameTagsInput = document.getElementById('gameTags'); // 태그 입력 요소
    const gameFileInput = document.getElementById('gameFileInput');
    const gameFileName = document.getElementById('gameFileName');
    const thumbnailFileInput = document.getElementById('thumbnailFileInput');
    const thumbnailFileName = document.getElementById('thumbnailFileName');   

    // 현재 선택된 태그 상태 관리
    let currentTag = '';

    // 1. 전체 태그 목록 가져와서 사이드바에 렌더링
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

            // 사이드바 장르 목록 HTML 생성
            let tagsHtml = `<li class="genre-item ${currentTag === '' ? 'active' : ''}" onclick="filterByTag('')">All Games</li>`;
            Array.from(allTags).sort().forEach(tag => {
                tagsHtml += `<li class="genre-item ${currentTag === tag ? 'active' : ''}" onclick="filterByTag('${tag}')"># ${tag}</li>`;
            });
            genreList.innerHTML = tagsHtml;

        } catch (error) {
            console.error('태그 로드 실패:', error.message);
        }
    }

    // 2. 게임 목록 가져오기 (검색어 + 태그 필터링 결합)
    async function fetchGames(searchTerm = '', tagFilter = '') {
        try {
            let query = supabaseClient
                .from('games')
                .select('*')
                .order('view_count', { ascending: false })
                .order('created_at', { ascending: false })
                .range(0, 49); // 범위를 50개로 넉넉히 확장
            
            if (searchTerm) query = query.ilike('name', `%${searchTerm}%`);
            if (tagFilter) query = query.ilike('tags', `%${tagFilter}%`); // 태그 필터링 적용

            const { data, error } = await query;
            if (error) throw error;
            
            renderGames(data);
            fetchAndRenderTags(); // 게임 목록을 불러올 때 사이드바 태그도 최신화
        } catch (error) {
            console.error('데이터 로드 실패:', error.message);
        }
    }

    // 전역 함수로 태그 클릭 이벤트 등록
    window.filterByTag = (tag) => {
        currentTag = tag;
        sectionTitle.textContent = tag ? `#${tag} Games` : 'Popular Games';
        if (searchInput) searchInput.value = ''; // 태그 선택 시 검색어 초기화
        sidebar.classList.remove('active'); // 사이드바 닫기
        fetchGames('', tag);
    };

    // 3. 목록 렌더링
    function renderGames(gameList) {
        if (!gameGrid) return;
        
        if (gameList.length === 0) {
            gameGrid.innerHTML = '<p style="grid-column: 1 / -1; text-align: center; color: #888; padding: 2rem;">해당하는 게임이 없습니다. 😢</p>';
            return;
        }

        gameGrid.innerHTML = gameList.map(game => {
            const thumbnailContent = game.thumbnail_url 
                ? `<img src="${game.thumbnail_url}" alt="${game.name}" class="game-thumb-img">`
                : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="50">
                        <rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="8" cy="12" r="2"/><path d="M15 9v6M12 12h6"/>
                   </svg>`;

            const viewCount = game.view_count || 0;
            
            // 태그 뱃지 생성 로직
            let tagsHtml = '';
            if (game.tags) {
                const tagsArray = game.tags.split(',').slice(0, 3); // 카드에는 최대 3개까지만 표시
                tagsHtml = `<div class="card-tags">` + tagsArray.map(t => `<span class="tag-badge">${t.trim()}</span>`).join('') + `</div>`;
            }

            return `
            <div class="game-card" onclick="openGame(${game.id}, '${game.file_url}', '${game.name}', ${viewCount})">
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

    // 4. 업로드 로직 (tags 데이터베이스 삽입 추가)
    if (submitGameBtn) {
        submitGameBtn.onclick = async () => {
            const name = gameNameInput.value.trim();
            const tags = gameTagsInput.value.trim(); // 사용자가 입력한 태그
            const file = gameFileInput.files[0];
            const thumbFile = thumbnailFileInput.files[0];

            if (!name || !file) return alert("게임 이름과 HTML 파일은 필수입니다!");

            submitGameBtn.innerText = "업로드 중...";
            submitGameBtn.disabled = true;

            try {
                const htmlText = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target.result);
                    reader.onerror = (e) => reject(new Error("HTML 파일 읽기 실패"));
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

                const { error: dbError } = await supabaseClient
                    .from('games')
                    .insert([{ 
                        id: Date.now(), 
                        name: name, 
                        file_url: gamePublicUrl,
                        thumbnail_url: thumbPublicUrl,
                        tags: tags, // 태그 저장!
                        view_count: 0 
                    }]);

                if (dbError) throw dbError;

                alert("업로드 성공!");
                uploadModal.classList.remove('active');
                
                // 폼 초기화
                gameNameInput.value = '';
                gameTagsInput.value = '';
                gameFileInput.value = '';
                thumbnailFileInput.value = '';
                if (gameFileName) gameFileName.textContent = '';
                if (thumbnailFileName) thumbnailFileName.textContent = '';
                
                if (searchInput) searchInput.value = '';
                currentTag = '';
                sectionTitle.textContent = 'Popular Games';
                fetchGames(); 
            } catch (error) {
                alert("오류 발생: " + error.message);
            } finally {
                submitGameBtn.innerText = "Launch Game";
                submitGameBtn.disabled = false;
            }
        };
    }

    // 5. 게임 플레이 함수
    window.openGame = async (id, url, name, currentViewCount) => {
        document.getElementById('playerTitle').textContent = name;
        playerModal.classList.add('active');
        gameFrame.style.display = 'block';
        if (placeholder) placeholder.style.display = 'none';
        
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

    // 6. 이벤트 리스너들
    if (homeLogo) {
        homeLogo.addEventListener('click', () => {
            if (searchInput) searchInput.value = ''; 
            currentTag = '';
            sectionTitle.textContent = 'Popular Games';
            fetchGames(); 
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // 햄버거 메뉴 사이드바 제어 이벤트
    if (menuBtn) menuBtn.addEventListener('click', () => sidebar.classList.add('active'));
    if (closeSidebar) closeSidebar.addEventListener('click', () => sidebar.classList.remove('active'));

    // 배경 클릭 시 사이드바 닫기 (선택 사항)
    document.addEventListener('click', (e) => {
        if (sidebar.classList.contains('active') && !sidebar.contains(e.target) && !menuBtn.contains(e.target)) {
            sidebar.classList.remove('active');
        }
    });

    if (fullscreenBtn) {
        fullscreenBtn.onclick = () => {
            if (gameFrame.requestFullscreen) gameFrame.requestFullscreen();
            else if (gameFrame.webkitRequestFullscreen) gameFrame.webkitRequestFullscreen();
            else if (gameFrame.msRequestFullscreen) gameFrame.msRequestFullscreen();
        };
    }

    if (uploadBtn) uploadBtn.onclick = () => uploadModal.classList.add('active');
    if (closeUpload) closeUpload.onclick = () => uploadModal.classList.remove('active');
    if (closePlayer) closePlayer.onclick = () => { playerModal.classList.remove('active'); gameFrame.srcdoc = ""; };
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

    // 초기 로드
    fetchGames();
});
