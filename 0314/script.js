// 1. Supabase 설정 (본인의 정보로 교체하세요)
const SUPABASE_URL = 'https://bpaqjmwzdxdgitlwmamp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwYXFqbXd6ZHhkZ2l0bHdtYW1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyOTczMDMsImV4cCI6MjA4ODg3MzMwM30.7MVzlcoc3p46_b5jEn1aUr5LE2kF3EWlF89fqBH1MSM';
// 여기서 'supabase' 대신 'supabaseClient'라는 이름을 사용합니다.
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
    
    const gameFileInput = document.getElementById('gameFileInput');
    const gameFileName = document.getElementById('gameFileName');
    const submitGameBtn = document.getElementById('submitGame');
    const gameNameInput = document.getElementById('gameName');

    // 2. 게임 목록 가져오기
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

    // 3. 목록 렌더링
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

    // 4. 업로드 버튼 이벤트
if (submitGameBtn) {
        submitGameBtn.onclick = async () => {
            const name = gameNameInput.value.trim();
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
    .upload(fileName, file, {
        contentType: 'text/html; charset=utf-8', // ★ 인코딩 설정을 추가합니다!
        upsert: true
    });

                if (uploadError) throw uploadError;

                // B. 공개 URL 가져오기
                const { data: { publicUrl } } = supabaseClient.storage
                    .from('game-files')
                    .getPublicUrl(fileName);

                // C. Database 저장 (★이 부분이 수정된 곳입니다★)
                const { error: dbError } = await supabaseClient
                    .from('games')
                    .insert([{ 
                        id: Date.now(), // 고유 ID 부여
                        name: name, 
                        file_url: publicUrl 
                    }]);

                if (dbError) throw dbError;

                alert("업로드 성공!");
                // ... (이후 초기화 로직)
            } catch (error) {
                alert("오류 발생: " + error.message);
            } finally {
                submitGameBtn.innerText = "Launch Game";
                submitGameBtn.disabled = false;
            }
        };
    }

    // 5. 게임 플레이 함수 (글로벌 등록)
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

    gameFileInput.onchange = (e) => {
        gameFileName.textContent = e.target.files[0]?.name || '';
    };

    fetchGames();
});
