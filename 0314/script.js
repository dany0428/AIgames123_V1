// 1. Supabase 설정 (본인의 정보로 교체하세요)
const SUPABASE_URL = 'https://bpaqjmwzdxdgitlwmamp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwYXFqbXd6ZHhkZ2l0bHdtYW1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyOTczMDMsImV4cCI6MjA4ODg3MzMwM30.7MVzlcoc3p46_b5jEn1aUr5LE2kF3EWlF89fqBH1MSM';
const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.addEventListener('DOMContentLoaded', () => {
    
    // DOM 요소들 가져오기
    const gameGrid = document.getElementById('gameGrid');
    const gameFrame = document.getElementById('gameFrame');
    const placeholder = document.getElementById('placeholder');
    const playerModal = document.getElementById('playerModal');
    const uploadModal = document.getElementById('uploadModal');
    
    const uploadBtn = document.getElementById('uploadBtn');
    const closeUpload = document.getElementById('closeUpload');
    const closePlayer = document.getElementById('closePlayer');
    
    const gameFileInput = document.getElementById('gameFileInput');
    const gameFileName = document.getElementById('gameFileName');
    const submitGameBtn = document.getElementById('submitGame');

    // --- [기능 1: 게임 목록 가져오기] ---
    async function fetchGames() {
        try {
            const { data, error } = await supabaseClient
                .from('games')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            renderGames(data);
        } catch (error) {
            console.error('데이터 로드 실패:', error.message);
        }
    }

    // --- [기능 2: 화면에 게임 리스트 렌더링] ---
    function renderGames(gameList) {
        if (!gameGrid) return;
        gameGrid.innerHTML = gameList.map(game => `
            <div class="game-card" onclick="openGame('${game.file_url}', '${game.name}')">
                <div class="game-thumbnail">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="50">
                        <rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="8" cy="12" r="2"/><path d="M15 9v6M12 12h6"/>
                    </svg>
                    <span class="ai-badge">Online</span>
                </div>
                <div class="game-info">
                    <h3 class="game-title">${game.name}</h3>
                </div>
            </div>
        `).join('');
    }

    // --- [기능 3: 게임 업로드 로직] ---
    if (submitGameBtn) {
        submitGameBtn.addEventListener('click', async () => {
            const nameInput = document.getElementById('gameName');
            const name = nameInput.value.trim();
            const file = gameFileInput.files[0];

            if (!name || !file) {
                return alert("게임 이름과 HTML 파일을 모두 입력해주세요!");
            }

            submitGameBtn.innerText = "업로드 중...";
            submitGameBtn.disabled = true;

            try {
                // A. Storage 업로드
                const fileName = `${Date.now()}_${file.name}`;
                const { data: uploadData, error: uploadError } = await supabaseClient.storage
                    .from('game-files')
                    .upload(fileName, file);

                if (uploadError) throw uploadError;

                // B. 공개 URL 가져오기
                const { data: { publicUrl } } = supabaseClient.storage
                    .from('game-files')
                    .getPublicUrl(fileName);

                // C. Database 저장
                const { error: dbError } = await supabaseClient
                    .from('games')
                    .insert([{ name: name, file_url: publicUrl }]);

                if (dbError) throw dbError;

                alert("성공적으로 업로드되었습니다!");
                uploadModal.classList.remove('active');
                
                // 초기화
                nameInput.value = '';
                gameFileInput.value = '';
                gameFileName.textContent = '';
                fetchGames(); 
            } catch (error) {
                alert("오류 발생: " + error.message);
            } finally {
                submitGameBtn.innerText = "Launch Game";
                submitGameBtn.disabled = false;
            }
        });
    }

    // --- [기능 4: 게임 모달 제어] ---
    window.openGame = (url, name) => {
        const playerTitle = document.getElementById('playerTitle');
        if (playerTitle) playerTitle.textContent = name;
        
        playerModal.classList.add('active');
        gameFrame.src = url;
        gameFrame.style.display = 'block';
        placeholder.style.display = 'none';
    };

    // 파일 선택 시 이름 업데이트
    if (gameFileInput) {
        gameFileInput.addEventListener('change', (e) => {
            gameFileName.textContent = e.target.files[0]?.name || '';
        });
    }

    // 버튼 클릭 이벤트 바인딩 (안전하게 처리)
    if (uploadBtn) {
        uploadBtn.addEventListener('click', () => {
            uploadModal.classList.add('active');
        });
    }

    if (closeUpload) {
        closeUpload.addEventListener('click', () => {
            uploadModal.classList.remove('active');
        });
    }

    if (closePlayer) {
        closePlayer.addEventListener('click', () => {
            playerModal.classList.remove('active');
            gameFrame.src = ""; // 게임 중단
        });
    }

    // 초기 데이터 로드 호출
    fetchGames();
});
