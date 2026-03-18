const SUPABASE_URL = 'https://bpaqjmwzdxdgitlwmamp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwYXFqbXd6ZHhkZ2l0bHdtYW1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyOTczMDMsImV4cCI6MjA4ODg3MzMwM30.7MVzlcoc3p46_b5jEn1aUr5LE2kF3EWlF89fqBH1MSM';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.addEventListener('DOMContentLoaded', () => {
    const gameGrid = document.getElementById('gameGrid');
    const gameFrame = document.getElementById('gameFrame');
    const placeholder = document.getElementById('placeholder');
    const playerModal = document.getElementById('playerModal');
    const uploadModal = document.getElementById('uploadModal');
    
    const searchInput = document.getElementById('searchInput'); // 검색창 요소 가져오기
    const uploadBtn = document.getElementById('uploadBtn');
    const closeUpload = document.getElementById('closeUpload');
    const closePlayer = document.getElementById('closePlayer');
    const fullscreenBtn = document.getElementById('fullscreenBtn'); 
    
    const gameFileInput = document.getElementById('gameFileInput');
    const gameFileName = document.getElementById('gameFileName');
    const thumbnailFileInput = document.getElementById('thumbnailFileInput');
    const thumbnailFileName = document.getElementById('thumbnailFileName');   
    
    const submitGameBtn = document.getElementById('submitGame');
    const gameNameInput = document.getElementById('gameName');

    // 2. 게임 목록 가져오기 (검색어 파라미터 추가)
    async function fetchGames(searchTerm = '') {
        try {
            let query = supabaseClient
                .from('games')
                .select('*')
                .order('view_count', { ascending: false })
                .order('created_at', { ascending: false })
                .range(0, 19);
            
            // 검색어가 있으면 이름(name) 컬럼에서 검색어가 포함된 것만 필터링
            if (searchTerm) {
                query = query.ilike('name', `%${searchTerm}%`);
            }

            const { data, error } = await query;
            
            if (error) throw error;
            renderGames(data);
        } catch (error) {
            console.error('데이터 로드 실패:', error.message);
        }
    }

    // 3. 목록 렌더링
    function renderGames(gameList) {
        if (!gameGrid) return;
        
        // 검색 결과가 없을 때 처리
        if (gameList.length === 0) {
            gameGrid.innerHTML = '<p style="grid-column: 1 / -1; text-align: center; color: #888; padding: 2rem;">검색 결과가 없습니다. 😢</p>';
            return;
        }

        gameGrid.innerHTML = gameList.map(game => {
            const thumbnailContent = game.thumbnail_url 
                ? `<img src="${game.thumbnail_url}" alt="${game.name}" class="game-thumb-img">`
                : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="50">
                        <rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="8" cy="12" r="2"/><path d="M15 9v6M12 12h6"/>
                   </svg>`;

            const viewCount = game.view_count || 0;

            return `
            <div class="game-card" onclick="openGame(${game.id}, '${game.file_url}', '${game.name}', ${viewCount})">
                <div class="game-thumbnail">
                    ${thumbnailContent}
                    <div class="card-badges">
                        <span class="view-badge">👁️ ${viewCount}</span>
                        <span class="ai-badge">Online</span>
                    </div>
                </div>
                <div class="game-info">
                    <h3 class="game-title">${game.name}</h3>
                </div>
            </div>
            `;
        }).join('');
    }

    // 4. 업로드 버튼 이벤트
    if (submitGameBtn) {
        submitGameBtn.onclick = async () => {
            const name = gameNameInput.value.trim();
            const file = gameFileInput.files[0];
            const thumbFile = thumbnailFileInput.files[0];

            if (!name || !file) {
                return alert("게임 이름과 HTML 파일은 필수입니다!");
            }

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

                const { error: uploadError } = await supabaseClient.storage
                    .from('game-files')
                    .upload(fileName, blob, { contentType: 'text/html; charset=utf-8', upsert: true });

                if (uploadError) throw uploadError;

                const { data: { publicUrl: gamePublicUrl } } = supabaseClient.storage
                    .from('game-files')
                    .getPublicUrl(fileName);

                let thumbPublicUrl = null;
                if (thumbFile) {
                    const thumbName = `${Date.now()}_thumb_${thumbFile.name}`;
                    const { error: thumbError } = await supabaseClient.storage
                        .from('game-files')
                        .upload(thumbName, thumbFile, { upsert: true });
                    
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
                        view_count: 0 
                    }]);

                if (dbError) throw dbError;

                alert("업로드 성공! 이제 게임을 즐기세요.");
                uploadModal.classList.remove('active');
                
                gameNameInput.value = '';
                gameFileInput.value = '';
                thumbnailFileInput.value = '';
                if (gameFileName) gameFileName.textContent = '';
                if (thumbnailFileName) thumbnailFileName.textContent = '';
                
                // 업로드 후 검색창 초기화 및 전체 목록 다시 불러오기
                if (searchInput) searchInput.value = '';
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
            supabaseClient
                .from('games')
                .update({ view_count: currentViewCount + 1 })
                .eq('id', id)
                .then(({ error }) => {
                    // 검색어가 입력된 상태라면 검색어를 유지하면서 새로고침
                    const currentSearch = searchInput ? searchInput.value.trim() : '';
                    if (!error) fetchGames(currentSearch); 
                });

            const response = await fetch(url);
            if (!response.ok) throw new Error('게임을 불러올 수 없습니다.');
            
            const htmlContent = await response.text();
            gameFrame.srcdoc = viewportMeta + htmlContent;
            
        } catch (error) {
            console.error('게임 로드 실패:', error);
            gameFrame.srcdoc = '<div style="display:flex; justify-content:center; align-items:center; height:100vh; color:red;">게임을 실행하는 데 문제가 발생했습니다.</div>';
        }
    };

    // 6. 이벤트 리스너 모음
    if (fullscreenBtn) {
        fullscreenBtn.onclick = () => {
            if (gameFrame.requestFullscreen) gameFrame.requestFullscreen();
            else if (gameFrame.webkitRequestFullscreen) gameFrame.webkitRequestFullscreen();
            else if (gameFrame.msRequestFullscreen) gameFrame.msRequestFullscreen();
        };
    }

    if (uploadBtn) uploadBtn.onclick = () => uploadModal.classList.add('active');
    if (closeUpload) closeUpload.onclick = () => uploadModal.classList.remove('active');
    
    if (closePlayer) {
        closePlayer.onclick = () => {
            playerModal.classList.remove('active');
            gameFrame.srcdoc = ""; 
        };
    }

    if (gameFileInput) gameFileInput.onchange = (e) => { if (gameFileName) gameFileName.textContent = e.target.files[0]?.name || ''; };
    if (thumbnailFileInput) thumbnailFileInput.onchange = (e) => { if (thumbnailFileName) thumbnailFileName.textContent = e.target.files[0]?.name || ''; };

    // ✨ 검색창 실시간 검색 이벤트 추가
    let searchTimeout;
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout); // 이전 타이머 취소
            searchTimeout = setTimeout(() => {
                const searchTerm = e.target.value.trim();
                fetchGames(searchTerm); // 0.3초 뒤에 검색 실행
            }, 300);
        });
    }

    // 앱 시작 시 전체 게임 목록 불러오기
    fetchGames();
});
