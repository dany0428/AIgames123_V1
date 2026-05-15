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
//  ZIP 게임 로더 (JSZip 사용)
// ════════════════════════════════════

async function _loadZipGame(buffer) {
    try {
        const zip   = await JSZip.loadAsync(buffer);
        const files = Object.keys(zip.files);

        // ── Flash(.swf) 감지 → Ruffle 전용 플레이어로 처리 ──
        const swfFiles = files.filter(f => f.toLowerCase().endsWith('.swf') && !zip.files[f].dir);
        if (swfFiles.length > 0) {
            await _loadSwfGame(zip, swfFiles[0]);
            return;
        }

        // ── wasm 감지 → 새 탭으로 열기 (COOP/COEP 필요) ──
        const hasWasm = files.some(f => f.toLowerCase().endsWith('.wasm') && !zip.files[f].dir);
        if (hasWasm) {
            await _loadWasmGame(zip, files);
            return;
        }

        // index.html 위치 찾기 (루트 또는 서브폴더)
        let entryPath = files.find(f => f === 'index.html')
            || files.find(f => f.endsWith('/index.html') && !zip.files[f].dir)
            || files.find(f => f.endsWith('.html') && !zip.files[f].dir);

        if (!entryPath) {
            DOM.gameFrame.srcdoc = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:red;text-align:center;padding:2rem;">ZIP 안에 index.html 파일을 찾을 수 없습니다.<br>ZIP 루트에 index.html이 있는지 확인해주세요.</div>';
            return;
        }

        // 기준 폴더 (서브폴더에 있는 경우 상대경로 처리용)
        const baseDir = entryPath.includes('/') ? entryPath.substring(0, entryPath.lastIndexOf('/') + 1) : '';

        // 모든 파일을 blob URL로 변환
        const urlMap = {};
        await Promise.all(
            files
                .filter(f => !zip.files[f].dir)
                .map(async (f) => {
                    const blob = await zip.files[f].async('blob');
                    urlMap[f]  = URL.createObjectURL(blob);
                    // baseDir 기준 상대경로도 등록
                    if (baseDir && f.startsWith(baseDir)) {
                        urlMap[f.slice(baseDir.length)] = urlMap[f];
                    }
                })
        );

        // index.html 텍스트 읽기 → 에셋 경로를 blob URL로 교체
        let html = await zip.files[entryPath].async('string');

        // src, href, url() 등을 blob URL로 교체
        html = html.replace(
            /((?:src|href|data-src)\s*=\s*["'])([^"'#?][^"']*)(?=["'])/gi,
            (match, prefix, path) => {
                const resolved = urlMap[path] || urlMap[baseDir + path];
                return resolved ? prefix + resolved : match;
            }
        );
        html = html.replace(
            /url\(['"]?([^'")(]+)['"]?\)/gi,
            (match, path) => {
                const resolved = urlMap[path] || urlMap[baseDir + path];
                return resolved ? `url('${resolved}')` : match;
            }
        );

        // wasm 파일 MIME 타입 픽스: fetch 인터셉터 주입
        const wasmFiles = Object.entries(urlMap)
            .filter(([k]) => k.endsWith('.wasm'))
            .map(([k, v]) => `"${k.split('/').pop()}":"${v}"`)
            .join(',');

        const wasmPatch = wasmFiles ? `
<script>
(function(){
  const _wasmMap = {${wasmFiles}};
  const _origFetch = window.fetch;
  window.fetch = function(input, init) {
    const url = typeof input === 'string' ? input : (input.url || '');
    const name = url.split('/').pop().split('?')[0];
    if(_wasmMap[name]) return _origFetch(_wasmMap[name], init);
    return _origFetch(input, init);
  };
})();
<\/script>` : '';

        const viewportMeta = '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">';
        DOM.gameFrame.srcdoc = viewportMeta + wasmPatch + html;

    } catch (err) {
        DOM.gameFrame.srcdoc = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:red;padding:2rem;">ZIP 로드 실패: ${err.message}</div>`;
        console.error('ZIP load error:', err);
    }
}

// ════════════════════════════════════
//  Flash(.swf) → Ruffle 에뮬레이터 로더
// ════════════════════════════════════

async function _loadSwfGame(zip, swfPath) {
    try {
        // swf 파일을 blob URL로 변환
        const swfBlob = await zip.files[swfPath].async('blob');
        const swfUrl  = URL.createObjectURL(swfBlob);

        const viewportMeta = '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">';

        // Ruffle CDN 주입 → swf blob URL을 직접 로드
        const ruffleHtml = `${viewportMeta}
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body { width:100%; height:100%; background:#000; overflow:hidden; }
    ruffle-player { width:100%; height:100%; display:block; }
    #loading {
      position:fixed; inset:0; display:flex; flex-direction:column;
      align-items:center; justify-content:center; background:#111;
      color:#a78bfa; font-family:sans-serif; gap:1rem;
    }
    .spinner {
      width:40px; height:40px; border:4px solid #3b2d5a;
      border-top-color:#8b5cf6; border-radius:50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform:rotate(360deg); } }
  </style>
</head>
<body>
  <div id="loading">
    <div class="spinner"></div>
    <span>Flash 게임 로딩 중... (Ruffle)</span>
  </div>
  <script>
    window.RufflePlayer = window.RufflePlayer || {};
    window.RufflePlayer.config = {
      autoplay: 'on',
      unmuteOverlay: 'hidden',
      scale: 'showAll',
      backgroundColor: '#000000',
    };
  <\/script>
  <script src="https://unpkg.com/@ruffle-rs/ruffle"></script>
  <script>
    window.addEventListener('load', () => {
      const ruffle = window.RufflePlayer.newest();
      const player = ruffle.createPlayer();
      player.style.width  = '100%';
      player.style.height = '100%';
      document.body.appendChild(player);
      player.load('${swfUrl}').then(() => {
        document.getElementById('loading').style.display = 'none';
      }).catch(err => {
        document.getElementById('loading').innerHTML =
          '<span style="color:red">SWF 로드 실패: ' + err.message + '</span>';
      });
    });
  <\/script>
</body>
</html>`;

        DOM.gameFrame.srcdoc = ruffleHtml;

    } catch (err) {
        DOM.gameFrame.srcdoc = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:red;padding:2rem;">Flash 로드 실패: ${err.message}</div>`;
        console.error('SWF load error:', err);
    }
}

// ════════════════════════════════════
//  WASM 게임 → 새 탭 로더
//  (SharedArrayBuffer는 COOP/COEP 필요 → srcdoc 불가)
// ════════════════════════════════════

async function _loadWasmGame(zip, files) {
    // 로딩 중 안내 메시지
    DOM.gameFrame.srcdoc = `
<html><body style="margin:0;background:#111;display:flex;flex-direction:column;
align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#a78bfa;gap:1.2rem;">
  <div style="width:44px;height:44px;border:4px solid #3b2d5a;border-top-color:#8b5cf6;
    border-radius:50%;animation:spin .8s linear infinite;"></div>
  <p style="font-size:1rem;">WASM 게임 파일 압축 해제 중...</p>
  <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
</body></html>`;

    try {
        // 모든 파일을 blob URL로 변환
        const urlMap = {};
        const baseDir = (() => {
            const entry = files.find(f => f === 'index.html')
                || files.find(f => f.endsWith('/index.html') && !zip.files[f].dir)
                || files.find(f => f.endsWith('.html') && !zip.files[f].dir) || '';
            return entry.includes('/') ? entry.substring(0, entry.lastIndexOf('/') + 1) : '';
        })();

        await Promise.all(
            files.filter(f => !zip.files[f].dir).map(async (f) => {
                const data = await zip.files[f].async('arraybuffer');
                // wasm은 정확한 MIME 타입으로 blob 생성
                const mime = f.endsWith('.wasm') ? 'application/wasm'
                    : f.endsWith('.js')          ? 'application/javascript'
                    : f.endsWith('.html')        ? 'text/html'
                    : 'application/octet-stream';
                const blob = new Blob([data], { type: mime });
                urlMap[f] = URL.createObjectURL(blob);
                if (baseDir && f.startsWith(baseDir)) {
                    urlMap[f.slice(baseDir.length)] = urlMap[f];
                }
            })
        );

        const entryPath = files.find(f => f === 'index.html')
            || files.find(f => f.endsWith('/index.html') && !zip.files[f].dir)
            || files.find(f => f.endsWith('.html') && !zip.files[f].dir);

        if (!entryPath) throw new Error('index.html을 찾을 수 없습니다.');

        // index.html 읽어서 에셋 경로 교체
        const dec  = new TextDecoder('utf-8');
        const data = await zip.files[entryPath].async('arraybuffer');
        let html   = dec.decode(data);

        html = html.replace(
            /((?:src|href|data-src)\s*=\s*["'])([^"'#?][^"']*)(?=["'])/gi,
            (m, pre, path) => { const r = urlMap[path] || urlMap[baseDir + path]; return r ? pre + r : m; }
        );
        html = html.replace(
            /url\(['"]?([^'")(]+)['"]?\)/gi,
            (m, path) => { const r = urlMap[path] || urlMap[baseDir + path]; return r ? `url('${r}')` : m; }
        );
        // JS import / fetch 경로 교체
        html = html.replace(
            /(["'])([^"']+\.(?:js|wasm))(\1)/g,
            (m, q, path, q2) => { const r = urlMap[path] || urlMap[baseDir + path]; return r ? q + r + q2 : m; }
        );

        // blob URL 생성
        const pageBlob = new Blob([html], { type: 'text/html' });
        const pageUrl  = URL.createObjectURL(pageBlob);

        // await 이후엔 팝업 차단됨 → iframe 안에 버튼을 보여줘서 사용자가 직접 클릭하게 유도
        DOM.gameFrame.srcdoc = `<!DOCTYPE html>
<html><body style="margin:0;background:#111;display:flex;flex-direction:column;
align-items:center;justify-content:center;height:100vh;font-family:sans-serif;
color:#a78bfa;gap:1.2rem;text-align:center;padding:2rem;">
  <div style="font-size:3rem;">🎮</div>
  <p style="font-size:1.15rem;font-weight:bold;color:#fff;">WASM 게임 준비 완료!</p>
  <p style="color:#888;font-size:0.88rem;">아래 버튼을 클릭하면 새 탭에서 게임이 실행됩니다.</p>
  <a href="${pageUrl}" target="_blank"
    style="margin-top:.5rem;padding:.8rem 2rem;background:#7c3aed;border:none;
    color:#fff;border-radius:10px;cursor:pointer;font-size:1rem;font-weight:600;
    text-decoration:none;display:inline-block;transition:background .2s;"
    onmouseover="this.style.background='#6d28d9'"
    onmouseout="this.style.background='#7c3aed'">▶ 게임 시작 (새 탭)</a>
  <p style="color:#555;font-size:0.78rem;margin-top:.5rem;">팝업 차단 시 주소창 오른쪽의 팝업 허용 버튼을 눌러주세요.</p>
</body></html>`;
    } catch (err) {
        DOM.gameFrame.srcdoc = `<div style="display:flex;align-items:center;justify-content:center;
height:100vh;font-family:sans-serif;color:red;padding:2rem;text-align:center;">
WASM 로드 실패: ${err.message}</div>`;
        console.error('WASM load error:', err);
    }
}

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
        const fileType     = game.file_type || 'html';

        card.onclick = () => openGame(game.id, game.file_url, safeName, viewCount, uploaderId, safeUploader, safeUpvotes, safeAvatar, fileType);

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

        const typeBadge = fileType === 'zip'
            ? `<span class="view-badge" style="background:rgba(16,185,129,0.8);">📦 ZIP</span>`
            : '';

        card.innerHTML = `
            <div class="game-thumbnail">
                ${thumbnailContent}
                ${profileActionsHtml}
                <div class="card-badges">${typeBadge}<span class="view-badge">👁️ ${viewCount}</span></div>
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

window.openGame = async (id, url, name, currentViewCount, uploaderId, uploaderName, upvotes, uploaderAvatar, fileType) => {
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
        fetch(url).then(r => { if (!r.ok) throw new Error('게임을 불러올 수 없습니다.'); return r.arrayBuffer(); })
    ]);

    if (gameResult.status === 'fulfilled') {
        const buffer = gameResult.value;
        const type   = fileType || 'html';

        if (type === 'zip') {
            await _loadZipGame(buffer);
        } else {
            const text = new TextDecoder('utf-8').decode(buffer);
            DOM.gameFrame.srcdoc = viewportMeta + text;
        }
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
