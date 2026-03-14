// 1. Supabase 설정 (본인의 정보로 교체하세요)
const SUPABASE_URL = 'https://bpaqjmwzdxdgitlwmamp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwYXFqbXd6ZHhkZ2l0bHdtYW1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyOTczMDMsImV4cCI6MjA4ODg3MzMwM30.7MVzlcoc3p46_b5jEn1aUr5LE2kF3EWlF89fqBH1MSM';
const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// DOM Elements
const gameGrid = document.getElementById('gameGrid');
const gameFrame = document.getElementById('gameFrame');
const placeholder = document.getElementById('placeholder');
const playerModal = document.getElementById('playerModal');
const uploadModal = document.getElementById('uploadModal');
const gameFileInput = document.getElementById('gameFileInput');

// 2. DB에서 게임 목록 불러오기
async function fetchGames() {
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) console.error('Error fetching games:', error);
  else renderGames(data);
}

// 3. 게임 목록 렌더링
function renderGames(gameList) {
  gameGrid.innerHTML = gameList.map(game => `
    <div class="game-card" onclick="openGame('${game.file_url}', '${game.name}')">
      <div class="game-thumbnail">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="50">
          <rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="8" cy="12" r="2"/><path d="M15 9v6M12 12h6"/>
        </svg>
        <span class="ai-badge">Stored in DB</span>
      </div>
      <div class="game-info">
        <h3 class="game-title">${game.name}</h3>
      </div>
    </div>
  `).join('');
}

// 4. 실제 게임 업로드 (파일 + DB 저장)
document.getElementById('submitGame').addEventListener('click', async () => {
  const name = document.getElementById('gameName').value.trim();
  const file = gameFileInput.files[0];

  if (!name || !file) return alert("필드 정보를 모두 입력해주세요!");

  // 로딩 상태 표시 (버튼 비활성화 추천)
  const submitBtn = document.getElementById('submitGame');
  submitBtn.innerText = "Uploading...";
  submitBtn.disabled = true;

  try {
    // A. Storage에 파일 업로드
    const fileName = `${Date.now()}_${file.name}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('game-files')
      .upload(fileName, file);

    if (uploadError) throw uploadError;

    // B. Public URL 가져오기
    const { data: { publicUrl } } = supabase.storage
      .from('game-files')
      .getPublicUrl(fileName);

    // C. DB에 게임 정보 삽입
    const { error: dbError } = await supabase
      .from('games')
      .insert([{ name: name, file_url: publicUrl }]);

    if (dbError) throw dbError;

    alert("업로드 성공!");
    uploadModal.classList.remove('active');
    fetchGames(); // 목록 갱신
  } catch (error) {
    alert(error.message);
  } finally {
    submitBtn.innerText = "Launch Game";
    submitBtn.disabled = false;
  }
});

// 5. 게임 실행
window.openGame = (url, name) => {
  document.getElementById('playerTitle').textContent = name;
  playerModal.classList.add('active');
  gameFrame.src = url;
  gameFrame.style.display = 'block';
  placeholder.style.display = 'none';
};

// 닫기 및 초기화 로직 (이전과 동일)
document.getElementById('closePlayer').addEventListener('click', () => {
  playerModal.classList.remove('active');
  gameFrame.src = "";
});

// 초기 데이터 로드
fetchGames();