// Supabase 설정 (본인의 프로젝트 URL과 anon key로 교체하세요)
const SUPABASE_URL = 'https://bpaqjmwzdxdgitlwmamp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwYXFqbXd6ZHhkZ2l0bHdtYW1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyOTczMDMsImV4cCI6MjA4ODg3MzMwM30.7MVzlcoc3p46_b5jEn1aUr5LE2kF3EWlF89fqBH1MSM';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Vercel 배포 URL (본인의 Vercel 프로젝트 주소로 교체)
const VERCEL_BASE_URL = 'https://a-igames123-v1.vercel.app/';

document.addEventListener('DOMContentLoaded', () => {
    const gameGrid = document.getElementById('gameGrid');
    const gameFrame = document.getElementById('gameFrame');
    const placeholder = document.getElementById('placeholder');
    const playerModal = document.getElementById('playerModal');
    const uploadModal = document.getElementById('uploadModal');
    
    const uploadBtn = document.getElementById('uploadBtn');
    const closeUpload = document.getElementById('closeUpload');
    const closePlayer = document.getElementById('closePlayer');
    
    const submitGameBtn = document.getElementById('submitGame');
    const gameNameInput = document.getElementById('gameName');
    const gameFolderInput = document.getElementById('gameFolder');

    // 게임 목록 가져오기
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

    // 목록 렌더링
    function renderGames(gameList) {
        if (!gameGrid) return;
        gameGrid.innerHTML = gameList.map(game => `
            <div class="game-card" onclick="openGame('${game.file_url}', '${game.name}')">
                <div class="game-thumbnail">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="50">
                        <rect x="2" y="6" width="20" height="12" rx="2"/>
                        <circle cx="8" cy="12" r="2"/>
                        <path d="M15 9v6M12 12h6"/>
                    </svg>
                    <span class="ai-badge">Online</span>
                </div>
                <div class="game-info">
                    <h3 class="game-title">${game.name}</h3>
                </div>
            </div>
        `).join('');
    }

    // 업로드 버튼 이벤트
    if (submitGameBtn) {
        submitGameBtn.onclick = async () => {
            const name = gameNameInput.value.trim();
            const folder = gameFolderInput.value.trim();

            if (!name || !folder) {
                return alert("게임 이름과 Vercel 폴더명을 입력해주세요!");
            }

            submitGameBtn.innerText = "저장 중...";
            submitGameBtn.disabled = true;

            try {
                // Vercel에서 실행될 URL 구성
                const gameUrl = `${VERCEL_BASE_URL}/games/${folder}/index.html`;

                // DB 저장
                const { error: dbError } = await supabaseClient
                    .from('games')
                    .insert([{ 
                        id: Date.now(), 
                        name: name, 
                        file_url: gameUrl 
                    }]);

                if (dbError) throw dbError;

                alert("게임 등록 성공! 이제 게임을 즐기세요.");
                uploadModal.classList.remove('active');
                gameNameInput.value = '';
                gameFolderInput.value = '';
                fetchGames(); 
            } catch (error) {
                alert("오류 발생: " + error.message);
            } finally {
                submitGameBtn.innerText = "Save Game";
                submitGameBtn.disabled = false;
            }
        };
    }

    // 게임 플레이 함수
    window.openGame = (url, name) => {
        document.getElementById('playerTitle').textContent = name;
        playerModal.classList.add('active');
        
        gameFrame.src = url; 
        gameFrame.style.display = 'block';
        placeholder.style.display = 'none';
    };

    // 모달 제어 이벤트
    uploadBtn.onclick = () => uploadModal.classList.add('active');
    closeUpload.onclick = () => uploadModal.classList.remove('active');
    closePlayer.onclick = () => {
        playerModal.classList.remove('active');
        gameFrame.src = ""; 
    };

    fetchGames();
});
