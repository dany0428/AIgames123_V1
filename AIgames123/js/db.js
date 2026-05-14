// ════════════════════════════════════
//  태그 사이드바 렌더 (fetchGames 데이터 재활용 — 별도 DB 호출 없음)
// ════════════════════════════════════

function renderTagSidebar(games) {
    if (!DOM.genreList) return;
    const allTags = new Set();
    games.forEach(g => {
        if (g.tags) g.tags.split(',').forEach(t => { if (t.trim()) allTags.add(t.trim()); });
    });
    const items = [`<li class="genre-item ${currentTag === '' ? 'active' : ''}" onclick="filterByTag('')">All Games</li>`];
    Array.from(allTags).sort().forEach(tag => {
        items.push(`<li class="genre-item ${currentTag === tag ? 'active' : ''}" onclick="filterByTag('${tag}')"># ${tag}</li>`);
    });
    DOM.genreList.innerHTML = items.join('');
}

// ════════════════════════════════════
//  게임 목록 조회 (태그 사이드바 동시 처리)
// ════════════════════════════════════

async function fetchGames(searchTerm = '', tagFilter = '') {
    try {
        const sortCol = currentSort || 'view_count';
        let query = supabaseClient.from('games').select('*')
            .order(sortCol, { ascending: false })
            .order('created_at', { ascending: false })
            .range(0, 49);
        if (searchTerm) query = query.ilike('name', `%${searchTerm}%`);
        if (tagFilter)  query = query.ilike('tags', `%${tagFilter}%`);

        const { data, error } = await query;
        if (error) throw error;
        renderGames(data, DOM.gameGrid, false);
        renderTagSidebar(data); // ✅ 별도 DB 호출 없이 같은 데이터로 태그 렌더
    } catch (err) { console.error('데이터 로드 실패:', err.message); }
}

// ════════════════════════════════════
//  내 게임 목록
// ════════════════════════════════════

async function fetchMyGames() {
    if (!currentUser) return;
    try {
        const { data, error } = await supabaseClient.from('games').select('*')
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: false });
        if (error) throw error;
        const totalViews = data.reduce((sum, g) => sum + (g.view_count || 0), 0);
        if (DOM.statTotalGames) DOM.statTotalGames.textContent = `${data.length}개`;
        if (DOM.statTotalViews) DOM.statTotalViews.textContent = `${totalViews}회`;
        renderGames(data, DOM.myGameGrid, true);
    } catch (err) { console.error('내 게임 로드 실패:', err.message); }
}

// ════════════════════════════════════
//  태그 필터
// ════════════════════════════════════

window.filterByTag = (tag) => {
    currentTag = tag;
    if (typeof _pushTagHistory === 'function') _pushTagHistory(tag);
    // auth.js의 _renderMain 재활용 — 화면 전환 코드 중복 제거
    _renderMain(tag);
    if (DOM.searchInput) DOM.searchInput.value = '';
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.remove('active');
};

// ════════════════════════════════════
//  게임 삭제
// ════════════════════════════════════

window.deleteGame = async (gameId, event) => {
    if (event) event.stopPropagation();
    if (!confirm('정말 이 게임을 삭제하시겠습니까?\n삭제된 데이터는 복구할 수 없습니다.')) return;
    try {
        const { error } = await supabaseClient.from('games').delete().eq('id', gameId);
        if (error) throw error;
        alert('게임이 삭제되었습니다.');
        DOM.playerModal.classList.remove('active');
        document.body.style.overflow = '';
        DOM.gameFrame.srcdoc = '';
        if (DOM.deleteGameBtn) DOM.deleteGameBtn.style.display = 'none';
        DOM.profileContent.style.display === 'block' ? fetchMyGames() : fetchGames();
    } catch (err) { alert('오류가 발생했습니다: ' + err.message); }
};

// ════════════════════════════════════
//  추천 (upvote)
// ════════════════════════════════════

window.handleUpvote = async (gameId, currentCount) => {
    const voteKey = `voted_${gameId}`;
    if (localStorage.getItem(voteKey)) return alert('이미 이 게임에 추천을 누르셨습니다!');

    try {
        const nextCount = (Number(currentCount) || 0) + 1;
        const { error } = await supabaseClient.from('games')
            .update({ upvotes: nextCount }).eq('id', gameId);
        if (error) throw error;

        if (DOM.upvoteCount) DOM.upvoteCount.textContent = nextCount;
        if (DOM.upvoteBtn)   DOM.upvoteBtn.classList.add('voted');
        localStorage.setItem(voteKey, 'up');

        // 백그라운드 목록 갱신 (UI 블로킹 없이)
        DOM.profileContent.style.display === 'block' ? fetchMyGames()
            : fetchGames(DOM.searchInput?.value.trim() || '', currentTag);
    } catch (err) {
        alert('추천 업데이트 실패 😢\n원인: ' + err.message);
    }
};

// ════════════════════════════════════
//  게임 카드 렌더
// ════════════════════════════════════

function renderGames(gameList, targetGrid, isProfile = false) {
    if (!targetGrid) return;
    if (!gameList.length) {
        targetGrid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:#888;padding:2rem;">목록이 비어있습니다. 😢</p>';
        return;
    }

    // DocumentFragment로 한 번에 DOM 반영 (리플로우 최소화)
    const fragment = document.createDocumentFragment();
    gameList.forEach(game => {
        const card = document.createElement('div');
        card.className = 'game-card';

        const safeUpvotes  = game.upvotes || 0;
        const viewCount    = game.view_count || 0;
        const uploaderId   = game.user_id || null;
        const safeName     = (game.name || 'Untitled').replace(/'/g, "\\'");
        const safeUploader = (game.uploader_name || '익명의 게이머').replace(/'/g, "\\'");
        const safeAvatar   = (game.uploader_avatar || '').replace(/'/g, '%27');

        card.onclick = () => openGame(game.id, game.file_url, safeName, viewCount, uploaderId, safeUploader, safeUpvotes, safeAvatar);

        const thumbnailContent = game.thumbnail_url
            ? `<img src="${game.thumbnail_url}" alt="${game.name}" class="game-thumb-img" loading="lazy">`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="50"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="8" cy="12" r="2"/><path d="M15 9v6M12 12h6"/></svg>`;

        const tagsHtml = game.tags
            ? `<div class="card-tags">${game.tags.split(',').slice(0, 3).map(t => `<span class="tag-badge">${t.trim()}</span>`).join('')}</div>`
            : '';

        const profileActionsHtml = isProfile ? `
            <div class="profile-card-actions">
                <button class="action-btn edit-btn" onclick="openEditModal(${game.id},'${safeName}','${game.tags||''}',event)" title="정보 수정">✏️</button>
                <button class="action-btn del-btn"  onclick="deleteGame(${game.id},event)" title="게임 삭제">🗑️</button>
            </div>` : '';

        card.innerHTML = `
            <div class="game-thumbnail">
                ${thumbnailContent}
                ${profileActionsHtml}
                <div class="card-badges"><span class="view-badge">👁️ ${viewCount}</span></div>
            </div>
            <div class="game-info">
                <h3 class="game-title">${game.name}</h3>
                ${tagsHtml}
            </div>`;
        fragment.appendChild(card);
    });

    targetGrid.innerHTML = '';
    targetGrid.appendChild(fragment);
}

// ════════════════════════════════════
//  게임 모달 열기
// ════════════════════════════════════

window.openGame = async (id, url, name, currentViewCount, uploaderId, uploaderName, upvotes, uploaderAvatar) => {
    // UI 즉시 업데이트
    if (DOM.playerTitle)  DOM.playerTitle.textContent  = name;
    if (DOM.uploaderName) DOM.uploaderName.textContent = uploaderName;

    // 업로더 아바타
    if (DOM.uploaderAvatarImg && DOM.uploaderAvatarFallback) {
        if (uploaderAvatar) {
            DOM.uploaderAvatarImg.src          = uploaderAvatar;
            DOM.uploaderAvatarImg.style.display    = 'block';
            DOM.uploaderAvatarFallback.style.display = 'none';
        } else {
            DOM.uploaderAvatarImg.style.display    = 'none';
            DOM.uploaderAvatarFallback.style.display = 'block';
        }
    }

    // 업로더 프로필 클릭
    if (DOM.uploaderProfileBtn) {
        DOM.uploaderProfileBtn.onclick = () => uploaderId && uploaderId !== 'null'
            ? showPublicProfile(uploaderId, uploaderName)
            : alert('오래 전 업로드 된 게임이라 프로필을 확인할 수 없습니다. 😢');
    }

    // 추천 버튼
    if (DOM.upvoteCount) DOM.upvoteCount.textContent = upvotes;
    if (DOM.upvoteBtn) {
        DOM.upvoteBtn.classList.toggle('voted', localStorage.getItem(`voted_${id}`) === 'up');
        DOM.upvoteBtn.onclick = () => handleUpvote(id, upvotes);
    }

    // 삭제 버튼
    if (DOM.deleteGameBtn) {
        const isOwner = currentUser && currentUser.id === uploaderId;
        DOM.deleteGameBtn.style.display = isOwner ? 'block' : 'none';
        DOM.deleteGameBtn.onclick = isOwner ? () => deleteGame(id, null) : null;
    }

    // 모달 열기
    DOM.playerModal.classList.add('active');
    document.body.style.overflow = 'hidden';
    if (DOM.gameFrame)   DOM.gameFrame.style.display  = 'block';
    if (DOM.placeholder) DOM.placeholder.style.display = 'none';

    const viewportMeta = '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">';
    DOM.gameFrame.srcdoc = `${viewportMeta}<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#333;">게임을 불러오는 중입니다...</div>`;

    // 조회수 업데이트 + 게임 파일 fetch를 병렬 실행 ✅
    const [, gameResult] = await Promise.allSettled([
        supabaseClient.from('games').update({ view_count: currentViewCount + 1 }).eq('id', id),
        fetch(url).then(r => { if (!r.ok) throw new Error('게임을 불러올 수 없습니다.'); return r.text(); })
    ]);

    if (gameResult.status === 'fulfilled') {
        DOM.gameFrame.srcdoc = viewportMeta + gameResult.value;
    } else {
        DOM.gameFrame.srcdoc = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:red;">문제가 발생했습니다.</div>';
        console.error(gameResult.reason);
    }

    // 목록 백그라운드 갱신
    DOM.profileContent.style.display === 'block' ? fetchMyGames()
        : fetchGames(DOM.searchInput?.value.trim() || '', currentTag);
};

// ════════════════════════════════════
//  수정 모달 열기
// ════════════════════════════════════

window.openEditModal = (gameId, name, tags, event) => {
    event.stopPropagation();
    editingGameId = gameId;
    document.getElementById('editGameName').value = name;

    const editTagSelector = document.getElementById('editTagSelector');
    if (editTagSelector) {
        const existing = (!tags || tags === 'undefined')
            ? [] : tags.split(',').map(t => t.trim().toLowerCase());
        editTagSelector.querySelectorAll('.tag-option').forEach(btn => {
            btn.classList.toggle('selected', existing.includes(btn.dataset.tag.toLowerCase()));
        });
    }
    document.getElementById('editModal').classList.add('active');
};
