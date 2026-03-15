// 1. Supabase 설정 (본인의 정보로 교체하세요)
const SUPABASE_URL = 'https://bpaqjmwzdxdgitlwmamp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwYXFqbXd6ZHhkZ2l0bHdtYW1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyOTczMDMsImV4cCI6MjA4ODg3MzMwM30.7MVzlcoc3p46_b5jEn1aUr5LE2kF3EWlF89fqBH1MSM';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.addEventListener('DOMContentLoaded', () => {
    // DOM 요소들
    const gameGrid = document.getElementById('gameGrid');
    const gameFrame = document.getElementById('gameFrame');
    const placeholder = document.getElementById('placeholder');
    const playerModal = document.getElementById('playerModal');
    const uploadModal = document.getElementById('uploadModal');
    
    const uploadBtn = document.getElementById('uploadBtn');
    const closeUpload = document.getElementById('closeUpload');
    const closePlayer = document.getElementById('closePlayer');
    const fullscreenBtn = document.getElementById('fullscreenBtn'); 
    
    const gameFileInput = document.getElementById('gameFileInput');
    const gameFileName = document.getElementById('gameFileName');
    const thumbnailFileInput = document.getElementById('thumbnailFileInput'); // 썸네일 input
    const thumbnailFileName = document.getElementById('thumbnailFileName');   // 썸네일 이름 표시
    
    const submitGameBtn = document.getElementById('submitGame');
    const gameNameInput = document.getElementById('gameName');

    // 2. 게임 목록 가져오기
    async function fetchGames() {
        try {
            const { data, error } = await supabaseClient
                .from('games')
                .select('*')
                .order('created_at', { ascending: false })
                .range(0, 19);
            
            if (error) throw error;
            renderGames(data);
        } catch (error) {
            console.error('데이터 로드 실패:', error.message);
        }
    }

    // 3. 목록 렌더링 (썸네일 반영)
    function renderGames(gameList) {
        if (!gameGrid) return;
        gameGrid.innerHTML = gameList.map(game => {
            // 썸네일 이미지가 있으면 이미지 태그를, 없으면 기본 아이콘을 출력
            const thumbnailContent = game.thumbnail_url 
                ? `<img src="${game.thumbnail_url}" alt="${game.name}" class="game-thumb-img">`
                : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="50">
                        <rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="8" cy="12" r="2"/><path d="M15 9v6M12 12h6"/>
                   </svg>`;

            return `
            <div class="game-card" onclick="openGame('${game.file_url}', '${game.name}')">
                <div class="game-thumbnail">
                    ${thumbnailContent}
                    <span class="ai-badge">Online</span>
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
                // A. 게임 HTML 파일 업로드
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
                    .upload(fileName, blob, {
                        contentType: 'text/html; charset=utf-8',
                        upsert: true
                    });

                if (uploadError) throw uploadError;

                const { data: { publicUrl: gamePublicUrl } } = supabaseClient.storage
                    .from('game-files')
                    .getPublicUrl(fileName);

                // B. 썸네일 이미지 파일 업로드 (선택 사항)
                let thumbPublicUrl = null;
                if (thumbFile) {
                    const thumbName = `${Date.now()}_thumb_${thumbFile.name}`;
                    const { error: thumbError } = await supabaseClient.storage
                        .from('game-files')
                        .upload(thumbName, thumbFile, {
                            upsert: true
                        });
                    
                    if (thumbError) throw thumbError;

                    const { data: thumbData } = supabaseClient.storage
                        .from('game-files')
                        .getPublicUrl(thumbName);
                        
                    thumbPublicUrl = thumbData.publicUrl;
                }

                // C. Database 저장 (thumbnail_url 추가)
                const { error: dbError } = await supabaseClient
                    .from('games')
                    .insert([{ 
                        id: Date.now(), 
                        name: name, 
                        file_url: gamePublicUrl,
                        thumbnail_url: thumbPublicUrl 
                    }]);

                if (dbError) throw dbError;

                alert("업로드 성공! 이제 게임을 즐기세요.");
                uploadModal.classList.remove('active');
                
                // 입력폼 초기화
                gameNameInput.value = '';
                gameFileInput.value = '';
                thumbnailFileInput.value = '';
                if (gameFileName) gameFileName.textContent = '';
                if (thumbnailFileName) thumbnailFileName.textContent = '';
                
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

    // 5. 게임 플레이 함수 (srcdoc 방식 유지)
    window.openGame = async (url, name) => {
        document.getElementById('playerTitle').textContent = name;
        playerModal.classList.add('active');
        
        gameFrame.style.display = 'block';
        if (placeholder) placeholder.style.display = 'none';
        gameFrame.srcdoc = '<div style="display:flex; justify-content:center; align-items:center; height:100vh; font-family:sans-serif; color:black;">게임을 불러오는 중입니다...</div>';

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('게임을 불러올 수 없습니다.');
            
            const htmlContent = await response.text();
            gameFrame.srcdoc = htmlContent;
        } catch (error) {
            console.error('게임 로드 실패:', error);
            gameFrame.srcdoc = '<div style="display:flex; justify-content:center; align-items:center; height:100vh; color:red;">게임을 실행하는 데 문제가 발생했습니다.</div>';
        }
    };

    // 전체화면 기능 이벤트
    if (fullscreenBtn) {
        fullscreenBtn.onclick = () => {
            if (gameFrame.requestFullscreen) {
                gameFrame.requestFullscreen();
            } else if (gameFrame.webkitRequestFullscreen) { 
                gameFrame.webkitRequestFullscreen();
            } else if (gameFrame.msRequestFullscreen) { 
                gameFrame.msRequestFullscreen();
            }
        };
    }

    // 6. 모달 제어 및 파일 이름 표시 이벤트
    if (uploadBtn) uploadBtn.onclick = () => uploadModal.classList.add('active');
    if (closeUpload) closeUpload.onclick = () => uploadModal.classList.remove('active');
    
    if (closePlayer) {
        closePlayer.onclick = () => {
            playerModal.classList.remove('active');
            gameFrame.srcdoc = ""; 
        };
    }

    if (gameFileInput) {
        gameFileInput.onchange = (e) => {
            if (gameFileName) gameFileName.textContent = e.target.files[0]?.name || '';
        };
    }

    if (thumbnailFileInput) {
        thumbnailFileInput.onchange = (e) => {
            if (thumbnailFileName) thumbnailFileName.textContent = e.target.files[0]?.name || '';
        };
    }

    fetchGames();
});
