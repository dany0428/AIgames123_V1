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
    const fullscreenBtn = document.getElementById('fullscreenBtn'); // 전체화면 버튼
    
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
                .order('created_at', { ascending: false })
                .range(0, 19);
            
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
                const htmlText = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target.result);
                    reader.onerror = (e) => reject(new Error("파일 읽기 실패"));
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

                const { data: { publicUrl } } = supabaseClient.storage
                    .from('game-files')
                    .getPublicUrl(fileName);

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
                if (gameFileName) gameFileName.textContent = '';
                fetchGames(); 
            } catch (error) {
                alert("오류 발생: " + error.message);
            } finally {
                submitGameBtn.innerText = "Launch Game";
                submitGameBtn.disabled = false;
            }
        };
    }

    // 5. 게임 플레이 함수 (글로벌 등록 - srcdoc 방식 유지)
    window.openGame = async (url, name) => {
        document.getElementById('playerTitle').textContent = name;
        playerModal.classList.add('active');
        
        // iframe 화면 활성화 및 로딩 UI
        gameFrame.style.display = 'block';
        if (placeholder) placeholder.style.display = 'none';
        gameFrame.srcdoc = '<div style="display:flex; justify-content:center; align-items:center; height:100vh; font-family:sans-serif; color:black;">게임을 불러오는 중입니다...</div>';

        try {
            // URL 주소를 바로 넣지 않고, HTML 코드를 텍스트로 가져와서 주입 (기존 방식)
            const response = await fetch(url);
            if (!response.ok) throw new Error('게임을 불러올 수 없습니다.');
            
            const htmlContent = await response.text();
            
            // src 대신 srcdoc에 HTML 텍스트를 직접 삽입하여 브라우저가 렌더링하도록 유도
            gameFrame.srcdoc = htmlContent;
        } catch (error) {
            console.error('게임 로드 실패:', error);
            gameFrame.srcdoc = '<div style="display:flex; justify-content:center; align-items:center; height:100vh; color:red;">게임을 실행하는 데 문제가 발생했습니다.</div>';
        }
    };

    // 전체화면 기능 이벤트
    if (fullscreenBtn) {
        fullscreenBtn.onclick = () => {
            if (gameFrame
