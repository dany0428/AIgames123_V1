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
// --- script.js 내 submitGameBtn.onclick 함수 내부 수정 ---

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
            // [해결책] 파일을 읽어서 'UTF-8' 바이너리 데이터(Blob)로 재생성합니다.
            // 이렇게 하면 한글 깨짐과 MIME 타입 문제를 동시에 잡을 수 있습니다.
            const reader = new FileReader();
            
            reader.onload = async (e) => {
                const text = e.target.result;
                const blob = new Blob([text], { type: 'text/html; charset=utf-8' });
                const fileName = `${Date.now()}_${file.name}`;

                // A. Storage 업로드 (Blob 데이터 전송)
                const { error: uploadError } = await supabaseClient.storage
                    .from('game-files')
                    .upload(fileName, blob, {
                        contentType: 'text/html; charset=utf-8',
                        upsert: true
                    });

                if (uploadError) throw uploadError;

                // B. URL 가져오기
                const { data: { publicUrl } } = supabaseClient.storage
                    .from('game-files')
                    .getPublicUrl(fileName);

                // C. Database 저장
                const { error: dbError } = await supabaseClient
                    .from('games')
                    .insert([{ 
                        id: Date.now(), 
                        name: name, 
                        file_url: publicUrl 
                    }]);

                if (dbError) throw dbError;

                alert("업로드 성공! 이제 게임을 즐기세요.");
                uploadModal.classList.remove('active');
                gameNameInput.value = '';
                gameFileInput.value = '';
                gameFileName.textContent = '';
                fetchGames(); 
            };

            // 파일을 텍스트로 읽기 시작
            reader.readAsText(file, "UTF-8");

        } catch (error) {
            alert("오류 발생: " + error.message);
        } finally {
            submitGameBtn.innerText = "Launch Game";
            submitGameBtn.disabled = false;
        }
    };
}

    // 5. 게임 플레이 함수 (글로벌 등록)
// script.js 내 openGame 함수 수정
window.openGame = (url, name) => {
    document.getElementById('playerTitle').textContent = name;
    playerModal.classList.add('active');
    
    // 주소를 바로 넣지 않고, 브라우저가 HTML로 해석하도록 유도
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
