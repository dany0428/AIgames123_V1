async function fetchAndRenderTags() {
    const genreList = document.getElementById('genreList');
    try {
        const { data, error } = await supabaseClient.from('games').select('tags');
        if (!error) {
            const allTags = new Set();
            data.forEach(game => {
                if (game.tags) game.tags.split(',').forEach(tag => { if (tag.trim()) allTags.add(tag.trim()); });
            });
            let tagsHtml = `<li class="genre-item ${currentTag === '' ? 'active' : ''}" onclick="filterByTag('')">All Games</li>`;
            Array.from(allTags).sort().forEach(tag => { tagsHtml += `<li class="genre-item ${currentTag === tag ? 'active' : ''}" onclick="filterByTag('${tag}')"># ${tag}</li>`; });
            if(genreList) genreList.innerHTML = tagsHtml;
        }
    } catch (error) {}
}

async function fetchGames(searchTerm = '', tagFilter = '') {
    const gameGrid = document.getElementById('gameGrid');
    try {
        let query = supabaseClient.from('games').select('*').order('view_count', { ascending: false }).order('created_at', { ascending: false }).range(0, 49);
        if (searchTerm) query = query.ilike('name', `%${searchTerm}%`);
        if (tagFilter) query = query.ilike('tags', `%${tagFilter}%`);

        const { data, error } = await query;
        if (error) throw error;
        renderGames(data, gameGrid, false);
        fetchAndRenderTags();
    } catch (error) { console.error('데이터 로드 실패:', error.message); }
}

async function fetchMyGames() {
    const myGameGrid = document.getElementById('myGameGrid');
    try {
        const { data, error } = await supabaseClient.from('games').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false });
        if (error) throw error;
        let totalViews = 0;
        data.forEach(game => { totalViews += (game.view_count || 0); });
        if(document.getElementById('statTotalGames')) document.getElementById('statTotalGames').textContent = `${data.length}개`;
        if(document.getElementById('statTotalViews')) document.getElementById('statTotalViews').textContent = `${totalViews}회`;
        renderGames(data, myGameGrid, true);
    } catch (error) { console.error('내 게임 로드 실패:', error.message); }
}

window.filterByTag = (tag) => {
    currentTag = tag;
    showMainContent();
    const sectionTitle = document.getElementById('sectionTitle');
    const searchInput = document.getElementById('searchInput');
    const sidebar = document.getElementById('sidebar');
    if(sectionTitle) sectionTitle.textContent = tag ? `#${tag} Games` : 'Popular Games';
    if (searchInput) searchInput.value = '';
    if(sidebar) sidebar.classList.remove('active');
    fetchGames('', tag);
};

window.deleteGame = async (gameId, event) => {
    if(event) event.stopPropagation();
    if (!confirm("정말 이 게임을 삭제하시겠습니까?\n삭제된 데이터는 복구할 수 없습니다.")) return;
    const playerModal = document.getElementById('playerModal');
    const gameFrame = document.getElementById('gameFrame');
    const deleteGameBtn = document.getElementById('deleteGameBtn');
    const profileContent = document.getElementById('profileContent');
    try {
        const { error } = await supabaseClient.from('games').delete().eq('id', gameId);
        if (error) throw error;
        alert("게임이 삭제되었습니다.");
        playerModal.classList.remove('active');
        gameFrame.srcdoc = "";
        if (deleteGameBtn) deleteGameBtn.style.display = 'none';
        if (profileContent.style.display === 'block') fetchMyGames();
        else fetchGames();
    } catch (error) { alert("오류가 발생했습니다: " + error.message); }
};

// ✨ 투표(추천/비추천) 전역 함수
window.handleUpvote = async (gameId, currentCount) => {
    const voteKey = `voted_${gameId}`;

    // 1. 이미 투표했는지 확인
    if (localStorage.getItem(voteKey)) {
        return alert("이미 이 게임에 추천을 누르셨습니다!");
    }

    try {
        // 2. 혹시나 글자로 넘어왔을 경우를 대비해 확실한 숫자로 변환합니다!
        const safeCurrentCount = Number(currentCount) || 0;
        const nextCount = safeCurrentCount + 1;

        // 3. Supabase 데이터베이스 업데이트
        const { error } = await supabaseClient
            .from('games')
            .update({ upvotes: nextCount })
            .eq('id', gameId);

        if (error) throw error; // 에러가 나면 아래 catch 블록으로 던집니다.

        // 4. 성공했다면 화면의 숫자와 버튼 색상을 즉시 바꿉니다.
        const countSpan = document.getElementById('upvoteCount');
        if (countSpan) countSpan.textContent = nextCount;

        const upBtn = document.getElementById('upvoteBtn');
        if (upBtn) upBtn.classList.add('voted');

        // 5. 내 컴퓨터(브라우저)에 투표 완료 기록 저장
        localStorage.setItem(voteKey, 'up');

        // 6. 닫았을 때 목록에도 반영되도록 백그라운드 새로고침
        const profileContent = document.getElementById('profileContent');
        if (profileContent && profileContent.style.display === 'block') {
            if (typeof fetchMyGames === 'function') fetchMyGames();
        } else {
            const searchInput = document.getElementById('searchInput');
            if (typeof fetchGames === 'function') {
                fetchGames(searchInput ? searchInput.value.trim() : '', currentTag);
            }
        }

    } catch (error) {
        // ✨ 만약 실패한다면 무슨 이유 때문에 실패했는지 화면에 확실히 띄워줍니다!
        alert("추천 업데이트 실패 😢\n원인: " + error.message);
        console.error("추천 에러 상세:", error);
    }
};

function renderGames(gameList, targetGrid, isProfile = false) {
    if (!targetGrid) return;
    if (gameList.length === 0) {
        targetGrid.innerHTML = '<p style="grid-column: 1 / -1; text-align: center; color: #888; padding: 2rem;">목록이 비어있습니다. 😢</p>';
        return;
    }

    targetGrid.innerHTML = gameList.map(game => {
        const thumbnailContent = game.thumbnail_url
            ? `<img src="${game.thumbnail_url}" alt="${game.name}" class="game-thumb-img">`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="50"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="8" cy="12" r="2"/><path d="M15 9v6M12 12h6"/></svg>`;

        const viewCount = game.view_count || 0;
        const uploaderId = game.user_id ? `'${game.user_id}'` : 'null';

        // ✨ 에러 방지 강화: 데이터가 비어있어도 절대 에러 나지 않게!
        const safeName = (game.name || 'Untitled').replace(/'/g, "\\'");
        const isMyGame = currentUser && currentUser.id === game.user_id;

        // 데이터베이스에 uploader_name이 비어있더라도, 내 게임이면 현재 내 닉네임을 끌어옴!
        let uploaderNameRaw = game.uploader_name;
        if (!uploaderNameRaw && isMyGame) {
            uploaderNameRaw = currentUser.user_metadata.custom_name || currentUser.user_metadata.preferred_username || currentUser.user_metadata.full_name;
        }

        const safeUploader = (uploaderNameRaw || '익명의 게이머').replace(/'/g, "\\'");
        const safeUpvotes = game.upvotes || 0;

        let tagsHtml = '';
        if (game.tags) {
            const tagsArray = game.tags.split(',').slice(0, 3);
            tagsHtml = `<div class="card-tags">` + tagsArray.map(t => `<span class="tag-badge">${t.trim()}</span>`).join('') + `</div>`;
        }

        let profileActionsHtml = '';
        if (isProfile) {
            profileActionsHtml = `
            <div class="profile-card-actions">
                <button class="action-btn edit-btn" onclick="openEditModal(${game.id}, '${safeName}', '${game.tags || ''}', event)" title="정보 수정">✏️</button>
                <button class="action-btn del-btn" onclick="deleteGame(${game.id}, event)" title="게임 삭제">🗑️</button>
            </div>`;
        }

        // onclick에 safeUpvotes를 적용
        return `
        <div class="game-card" onclick="openGame(${game.id}, '${game.file_url}', '${safeName}', ${viewCount}, ${uploaderId}, '${safeUploader}', ${safeUpvotes})">
            <div class="game-thumbnail">
                ${thumbnailContent}
                ${profileActionsHtml}
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

// ✨ 게임 모달 열기 (업로더 정보 바인딩)
// ✨ 절대 에러가 나지 않는 초강력 방어형 openGame 함수
window.openGame = async (id, url, name, currentViewCount, uploaderId, uploaderName, upvotes) => {

    // 1. HTML에 해당 ID가 "있을 때만" 텍스트를 바꿉니다! (여기서 에러가 났었습니다)
    const titleEl = document.getElementById('playerTitle');
    if (titleEl) titleEl.textContent = name;

    const uploaderEl = document.getElementById('uploaderName');
    if (uploaderEl) uploaderEl.textContent = uploaderName;

    // 2. 글자 대신 '프로필 영역 전체'를 클릭했을 때 넘어가도록 변경!
    const uploaderProfileBtn = document.getElementById('uploaderProfileBtn');
    if (uploaderProfileBtn) {
        uploaderProfileBtn.onclick = () => {
            if (uploaderId && uploaderId !== 'null') {
                showPublicProfile(uploaderId, uploaderName);
            } else {
                alert("오래 전 업로드 된 게임이라 프로필을 확인할 수 없습니다. 😢");
            }
        };
    }

    const upCountEl = document.getElementById('upvoteCount');
    if (upCountEl) upCountEl.textContent = upvotes;

    const upBtn = document.getElementById('upvoteBtn');
    const pastVote = localStorage.getItem(`voted_${id}`);

    if (upBtn) {
        upBtn.classList.remove('voted');
        if (pastVote === 'up') upBtn.classList.add('voted');
        upBtn.onclick = () => handleUpvote(id, upvotes);
    }

    // 2. 모달창 및 UI 요소들
    const playerModal = document.getElementById('playerModal');
    const gameFrame = document.getElementById('gameFrame');
    const placeholder = document.getElementById('placeholder');
    const deleteGameBtn = document.getElementById('deleteGameBtn');

    // 모달창 띄우기
    if (playerModal) playerModal.classList.add('active');
    if (gameFrame) gameFrame.style.display = 'block';
    if (placeholder) placeholder.style.display = 'none';

    // 삭제 버튼 로직
    if (deleteGameBtn) {
        if (currentUser && currentUser.id === uploaderId) {
            deleteGameBtn.style.display = 'block';
            deleteGameBtn.onclick = () => deleteGame(id, null);
        } else {
            deleteGameBtn.style.display = 'none';
            deleteGameBtn.onclick = null;
        }
    }

    const viewportMeta = '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
    if (gameFrame) {
        gameFrame.srcdoc = `${viewportMeta}<div style="display:flex; justify-content:center; align-items:center; height:100vh; font-family:sans-serif; color:black;">게임을 불러오는 중입니다...</div>`;
    }

    try {
        // 조회수 증가 및 목록 갱신
        supabaseClient.from('games').update({ view_count: currentViewCount + 1 }).eq('id', id).then(({ error }) => {
            const profileContent = document.getElementById('profileContent');
            if (profileContent && profileContent.style.display === 'block') {
                fetchMyGames();
            } else {
                const searchInput = document.getElementById('searchInput');
                fetchGames(searchInput ? searchInput.value.trim() : '', currentTag);
            }
        });

        // 게임 HTML 파일 가져오기
        const response = await fetch(url);
        if (!response.ok) throw new Error('게임을 불러올 수 없습니다.');
        const htmlContent = await response.text();

        if (gameFrame) gameFrame.srcdoc = viewportMeta + htmlContent;
    } catch (error) {
        if (gameFrame) gameFrame.srcdoc = '<div style="display:flex; justify-content:center; align-items:center; height:100vh; color:red;">문제가 발생했습니다.</div>';
        console.error(error);
    }
};

window.openEditModal = (gameId, name, tags, event) => {
    event.stopPropagation();
    editingGameId = gameId;
    document.getElementById('editGameName').value = name;
    document.getElementById('editGameTags').value = tags === 'undefined' ? '' : tags;
    document.getElementById('editModal').classList.add('active');
}