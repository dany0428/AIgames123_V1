// ════════════════════════════════════════════════════════
//  db.js — Game data layer + rendering
//
//  Key optimizations vs the original:
//   • Tag sidebar uses a cached distinct-tag list instead of re-querying
//     every game's `tags` column on every fetch.
//   • Game grid uses event delegation (1 listener) instead of N onclick
//     handlers per card.
//   • Upvote is purely optimistic — no list re-fetch on success.
//   • Blob URLs from the ZIP loader are tracked and revoked when the
//     player closes, preventing leak-on-replay.
//   • HTML asset-path rewriting in ZIP uses a single combined regex pass.
// ════════════════════════════════════════════════════════

// HTML escape — prevents XSS in user-supplied fields (name, tags, etc.)
function _esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ════════════════════════════════════
//  Tag sidebar — driven by cache.
//  refreshTagCache() fires only when needed (first load + after mutations).
// ════════════════════════════════════

async function refreshTagCache() {
    try {
        const { data, error } = await supabaseClient.from('games').select('tags');
        if (error) throw error;
        const set = new Set();
        for (const g of data || []) {
            if (!g.tags) continue;
            for (const t of g.tags.split(',')) {
                const trimmed = t.trim();
                if (trimmed) set.add(trimmed);
            }
        }
        cache._tagCache     = Array.from(set).sort();
        cache._tagCacheTime = Date.now();
    } catch (err) {
        console.warn('Tag cache refresh failed:', err.message);
        cache._tagCache = cache._tagCache || [];
    }
}

function renderTagSidebar() {
    if (!DOM.genreList) return;
    const tags = cache._tagCache || [];
    const items = [`<li class="genre-item ${currentTag === '' ? 'active' : ''}" data-tag="">All Games</li>`];
    for (const tag of tags) {
        const safe = _esc(tag);
        items.push(`<li class="genre-item ${currentTag === tag ? 'active' : ''}" data-tag="${safe}"># ${safe}</li>`);
    }
    DOM.genreList.innerHTML = items.join('');
}

// Delegate tag-click on the genre list (one listener replaces N inline onclicks)
function _initTagSidebarDelegation() {
    if (!DOM.genreList || DOM.genreList._delegated) return;
    DOM.genreList.addEventListener('click', (e) => {
        const li = e.target.closest('.genre-item');
        if (!li) return;
        window.filterByTag(li.dataset.tag || '');
    });
    DOM.genreList._delegated = true;
}

// ════════════════════════════════════
//  Game list query — now a SINGLE query.
//  Tag sidebar is rebuilt from cache without an extra round-trip.
// ════════════════════════════════════

async function fetchGames(searchTerm = '', tagFilter = '') {
    _initTagSidebarDelegation();
    try {
        const sortCol = currentSort || 'view_count';
        let query = supabaseClient.from('games').select('*')
            .order(sortCol,      { ascending: false })
            .order('created_at', { ascending: false })
            .range(0, 49);
        if (searchTerm) query = query.ilike('name', `%${searchTerm}%`);
        if (tagFilter)  query = query.ilike('tags', `%${tagFilter}%`);

        // If we have no tag cache yet, refresh it in parallel.
        // Otherwise, only refetch tags lazily (>5 minutes old) so the
        // sidebar stays roughly fresh without a per-query DB hit.
        const tagAgeMs = Date.now() - cache._tagCacheTime;
        const tagsStale = !cache._tagCache || tagAgeMs > 5 * 60 * 1000;

        const promises = [query];
        if (tagsStale) promises.push(refreshTagCache());

        const [gamesResult] = await Promise.all(promises);
        if (gamesResult.error) throw gamesResult.error;

        cache._gameListCache = gamesResult.data || [];
        renderGames(cache._gameListCache, DOM.gameGrid, false);
        renderTagSidebar();
    } catch (err) {
        console.error('Failed to load games:', err.message);
    }
}

// ════════════════════════════════════
//  My games list
// ════════════════════════════════════

async function fetchMyGames() {
    if (!currentUser) return;
    try {
        const { data, error } = await supabaseClient.from('games').select('*')
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: false });
        if (error) throw error;
        const totalViews = data.reduce((sum, g) => sum + (g.view_count || 0), 0);
        if (DOM.statTotalGames) DOM.statTotalGames.textContent = data.length;
        if (DOM.statTotalViews) DOM.statTotalViews.textContent = totalViews;
        renderGames(data, DOM.myGameGrid, true);
    } catch (err) {
        console.error('Failed to load my games:', err.message);
    }
}

// ════════════════════════════════════
//  Tag filter
// ════════════════════════════════════

window.filterByTag = (tag) => {
    currentTag = tag;
    if (typeof _pushTagHistory === 'function') _pushTagHistory(tag);
    _renderMain(tag);
    if (DOM.searchInput) DOM.searchInput.value = '';
    document.getElementById('sidebar')?.classList.remove('active');
};

// ════════════════════════════════════
//  Game delete
// ════════════════════════════════════

window.deleteGame = async (gameId, event) => {
    if (event) event.stopPropagation();
    if (!confirm('Are you sure you want to delete this game?\nThis cannot be undone.')) return;
    try {
        const { error } = await supabaseClient.from('games').delete().eq('id', gameId);
        if (error) throw error;
        alert('Game deleted.');
        DOM.playerModal.classList.remove('active');
        document.body.style.overflow = '';
        DOM.gameFrame.srcdoc = '';
        _revokePlayerBlobUrls();
        if (DOM.deleteGameBtn) DOM.deleteGameBtn.style.display = 'none';

        cache.invalidateTags();   // a game was removed — refresh tag list
        DOM.profileContent.style.display === 'block' ? fetchMyGames() : fetchGames();
    } catch (err) {
        alert('Error: ' + err.message);
    }
};

// ════════════════════════════════════
//  Upvote — fully optimistic, no list re-fetch on success
// ════════════════════════════════════

window.handleUpvote = async (gameId, currentCount) => {
    const voteKey  = `voted_${gameId}`;
    const hasVoted = localStorage.getItem(voteKey) === 'up';

    // Optimistic UI update
    const nextCount = hasVoted
        ? Math.max(0, (Number(currentCount) || 0) - 1)
        : (Number(currentCount) || 0) + 1;

    if (DOM.upvoteCount) DOM.upvoteCount.textContent = nextCount;
    if (DOM.upvoteBtn) {
        DOM.upvoteBtn.classList.toggle('voted', !hasVoted);
        DOM.upvoteBtn.onclick = () => handleUpvote(gameId, nextCount);
    }

    // Update the cached row so a list re-render shows the new count
    const cached = cache._gameListCache.find(g => String(g.id) === String(gameId));
    if (cached) cached.upvotes = nextCount;

    try {
        const { error } = await supabaseClient
            .from('games')
            .update({ upvotes: nextCount })
            .eq('id', gameId);
        if (error) throw error;

        // Toggle localStorage flag
        if (hasVoted) localStorage.removeItem(voteKey);
        else          localStorage.setItem(voteKey, 'up');

        // NOTE: intentionally NOT re-fetching the list here.
        // The local cache is in sync; the next natural fetchGames()
        // (search, sort change, etc.) will pull authoritative counts.
    } catch (err) {
        // Rollback UI
        if (DOM.upvoteCount) DOM.upvoteCount.textContent = currentCount;
        if (DOM.upvoteBtn) {
            DOM.upvoteBtn.classList.toggle('voted', hasVoted);
            DOM.upvoteBtn.onclick = () => handleUpvote(gameId, currentCount);
        }
        if (cached) cached.upvotes = Number(currentCount) || 0;
        alert('Failed to update vote 😢\nReason: ' + err.message);
    }
};

// ════════════════════════════════════
//  Blob URL tracking — revoked when player closes (memory leak fix)
// ════════════════════════════════════

let _activeBlobUrls = [];
function _trackBlobUrl(url) { _activeBlobUrls.push(url); return url; }
function _revokePlayerBlobUrls() {
    for (const u of _activeBlobUrls) {
        try { URL.revokeObjectURL(u); } catch (_) { /* ignore */ }
    }
    _activeBlobUrls = [];
}
// Expose for ui.js closePlayerModal
window._revokePlayerBlobUrls = _revokePlayerBlobUrls;

// ════════════════════════════════════
//  ZIP game loader (JSZip)
// ════════════════════════════════════

// Combined replacement table — single regex pass instead of 2-3 passes
// over the entire HTML body.
//
// Captures:
//   group 1 = attribute prefix       (e.g. src="    href='    data-src=")
//   group 2 = attribute value path   (when group 1 matched)
//   group 3 = url(...) path
//
// Strategy: one regex, branch in the callback.
function _rewriteHtmlAssets(html, urlMap, baseDir) {
    const resolve = (path) => urlMap[path] || urlMap[baseDir + path] || null;
    return html.replace(
        /((?:src|href|data-src)\s*=\s*["'])([^"'#?][^"']*)(?=["'])|url\(['"]?([^'")(]+)['"]?\)/gi,
        (match, attrPrefix, attrPath, urlPath) => {
            if (attrPrefix) {
                const r = resolve(attrPath);
                return r ? attrPrefix + r : match;
            }
            const r = resolve(urlPath);
            return r ? `url('${r}')` : match;
        },
    );
}

async function _loadZipGame(buffer) {
    try {
        const zip   = await JSZip.loadAsync(buffer);
        const files = Object.keys(zip.files);

        // Flash (.swf) → dedicated Ruffle player
        const swfFiles = files.filter(f => f.toLowerCase().endsWith('.swf') && !zip.files[f].dir);
        if (swfFiles.length > 0) {
            await _loadSwfGame(zip, swfFiles[0]);
            return;
        }

        // WASM → open in a new tab (needs COOP/COEP that srcdoc can't provide)
        const hasWasm = files.some(f => f.toLowerCase().endsWith('.wasm') && !zip.files[f].dir);
        if (hasWasm) {
            await _loadWasmGame(zip, files);
            return;
        }

        // Locate index.html (root, then any subfolder, then any .html)
        const entryPath = files.find(f => f === 'index.html')
            || files.find(f => f.endsWith('/index.html') && !zip.files[f].dir)
            || files.find(f => f.endsWith('.html') && !zip.files[f].dir);

        if (!entryPath) {
            DOM.gameFrame.srcdoc = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:red;text-align:center;padding:2rem;">No index.html found inside the ZIP.<br>Make sure index.html is at the ZIP root.</div>';
            return;
        }

        // Base dir for resolving relative paths
        const baseDir = entryPath.includes('/') ? entryPath.substring(0, entryPath.lastIndexOf('/') + 1) : '';

        // Convert every file to a blob URL in parallel
        const urlMap = {};
        await Promise.all(
            files
                .filter(f => !zip.files[f].dir)
                .map(async (f) => {
                    const blob = await zip.files[f].async('blob');
                    const url  = _trackBlobUrl(URL.createObjectURL(blob));
                    urlMap[f]  = url;
                    if (baseDir && f.startsWith(baseDir)) {
                        urlMap[f.slice(baseDir.length)] = url;
                    }
                }),
        );

        // Read entry HTML and rewrite asset paths in a single pass
        let html = await zip.files[entryPath].async('string');
        html = _rewriteHtmlAssets(html, urlMap, baseDir);

        // wasm MIME-type fixup via fetch interceptor (when wasm modules are loaded by JS)
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
        DOM.gameFrame.srcdoc = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:red;padding:2rem;">Failed to load ZIP: ${_esc(err.message)}</div>`;
        console.error('ZIP load error:', err);
    }
}

// ════════════════════════════════════
//  Flash (.swf) → Ruffle emulator loader
// ════════════════════════════════════

async function _loadSwfGame(zip, swfPath) {
    try {
        const swfBlob = await zip.files[swfPath].async('blob');
        const swfUrl  = _trackBlobUrl(URL.createObjectURL(swfBlob));

        const viewportMeta = '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">';

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
    <span>Loading Flash game... (Ruffle)</span>
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
          '<span style="color:red">SWF load failed: ' + err.message + '</span>';
      });
    });
  <\/script>
</body>
</html>`;

        DOM.gameFrame.srcdoc = ruffleHtml;

    } catch (err) {
        DOM.gameFrame.srcdoc = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:red;padding:2rem;">Failed to load Flash game: ${_esc(err.message)}</div>`;
        console.error('SWF load error:', err);
    }
}

// ════════════════════════════════════
//  WASM game → open in a new tab
//  (SharedArrayBuffer requires COOP/COEP, which srcdoc cannot grant)
// ════════════════════════════════════

async function _loadWasmGame(zip, files) {
    // Loading message inside the iframe
    DOM.gameFrame.srcdoc = `
<html><body style="margin:0;background:#111;display:flex;flex-direction:column;
align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#a78bfa;gap:1.2rem;">
  <div style="width:44px;height:44px;border:4px solid #3b2d5a;border-top-color:#8b5cf6;
    border-radius:50%;animation:spin .8s linear infinite;"></div>
  <p style="font-size:1rem;">Extracting WASM game files...</p>
  <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
</body></html>`;

    try {
        // Locate entry once
        const entryPath = files.find(f => f === 'index.html')
            || files.find(f => f.endsWith('/index.html') && !zip.files[f].dir)
            || files.find(f => f.endsWith('.html') && !zip.files[f].dir);
        if (!entryPath) throw new Error('index.html not found.');

        const baseDir = entryPath.includes('/')
            ? entryPath.substring(0, entryPath.lastIndexOf('/') + 1)
            : '';

        // Pre-compute MIME lookup to avoid per-file conditional chains
        const mimeFor = (path) => {
            if (path.endsWith('.wasm'))  return 'application/wasm';
            if (path.endsWith('.js'))    return 'application/javascript';
            if (path.endsWith('.html'))  return 'text/html';
            return 'application/octet-stream';
        };

        const urlMap = {};
        await Promise.all(
            files.filter(f => !zip.files[f].dir).map(async (f) => {
                const data = await zip.files[f].async('arraybuffer');
                const blob = new Blob([data], { type: mimeFor(f) });
                const url  = _trackBlobUrl(URL.createObjectURL(blob));
                urlMap[f]  = url;
                if (baseDir && f.startsWith(baseDir)) {
                    urlMap[f.slice(baseDir.length)] = url;
                }
            }),
        );

        // Read & rewrite the entry HTML — single regex pass for attrs + url()
        const data = await zip.files[entryPath].async('arraybuffer');
        let html   = new TextDecoder('utf-8').decode(data);
        html = _rewriteHtmlAssets(html, urlMap, baseDir);

        // Additional pass for raw "*.js"/"*.wasm" strings (e.g. JS import paths)
        html = html.replace(
            /(["'])([^"']+\.(?:js|wasm))(\1)/g,
            (m, q, path, q2) => {
                const r = urlMap[path] || urlMap[baseDir + path];
                return r ? q + r + q2 : m;
            },
        );

        const pageBlob = new Blob([html], { type: 'text/html' });
        const pageUrl  = _trackBlobUrl(URL.createObjectURL(pageBlob));

        // Popup is blocked after `await` — present a user-click launch button instead
        DOM.gameFrame.srcdoc = `<!DOCTYPE html>
<html><body style="margin:0;background:#111;display:flex;flex-direction:column;
align-items:center;justify-content:center;height:100vh;font-family:sans-serif;
color:#a78bfa;gap:1.2rem;text-align:center;padding:2rem;">
  <div style="font-size:3rem;">🎮</div>
  <p style="font-size:1.15rem;font-weight:bold;color:#fff;">WASM game ready!</p>
  <p style="color:#888;font-size:0.88rem;">Click the button below to launch in a new tab.</p>
  <a href="${pageUrl}" target="_blank"
    style="margin-top:.5rem;padding:.8rem 2rem;background:#7c3aed;border:none;
    color:#fff;border-radius:10px;cursor:pointer;font-size:1rem;font-weight:600;
    text-decoration:none;display:inline-block;transition:background .2s;"
    onmouseover="this.style.background='#6d28d9'"
    onmouseout="this.style.background='#7c3aed'">▶ Launch Game (new tab)</a>
  <p style="color:#555;font-size:0.78rem;margin-top:.5rem;">If blocked, please allow pop-ups for this site.</p>
</body></html>`;
    } catch (err) {
        DOM.gameFrame.srcdoc = `<div style="display:flex;align-items:center;justify-content:center;
height:100vh;font-family:sans-serif;color:red;padding:2rem;text-align:center;">
Failed to load WASM game: ${_esc(err.message)}</div>`;
        console.error('WASM load error:', err);
    }
}

// ════════════════════════════════════
//  Game card rendering — event delegation, no per-card listeners
// ════════════════════════════════════

// Per-grid delegation flag — initialize lazily once per grid element
function _initGridDelegation(grid, isProfile) {
    if (!grid || grid._delegated) return;

    grid.addEventListener('click', (e) => {
        // Edit / delete buttons take priority
        const editBtn = e.target.closest('[data-action="edit"]');
        if (editBtn) {
            e.stopPropagation();
            const card = editBtn.closest('.game-card');
            window.openEditModal(
                Number(card.dataset.id),
                card.dataset.name,
                card.dataset.tags || '',
                e,
            );
            return;
        }
        const delBtn = e.target.closest('[data-action="delete"]');
        if (delBtn) {
            e.stopPropagation();
            window.deleteGame(Number(delBtn.closest('.game-card').dataset.id), e);
            return;
        }

        // Card body click → open game
        const card = e.target.closest('.game-card');
        if (!card) return;
        const d = card.dataset;
        window.openGame(
            Number(d.id),
            d.url,
            d.name,
            Number(d.viewCount || 0),
            d.uploaderId || null,
            d.uploader,
            Number(d.upvotes || 0),
            d.uploaderAvatar || '',
            d.fileType || 'html',
        );
    });

    grid._delegated   = true;
    grid._isProfile   = isProfile;
}

function renderGames(gameList, targetGrid, isProfile = false) {
    if (!targetGrid) return;
    _initGridDelegation(targetGrid, isProfile);

    if (!gameList.length) {
        targetGrid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:#888;padding:2rem;">No games here yet. 😢</p>';
        return;
    }

    // Build HTML as a single string then assign once — avoids appendChild churn
    const parts = new Array(gameList.length);
    for (let i = 0; i < gameList.length; i++) {
        const game = gameList[i];
        const safeUpvotes = game.upvotes    || 0;
        const viewCount   = game.view_count || 0;
        const uploaderId  = game.user_id    || '';
        const name        = _esc(game.name || 'Untitled');
        const uploader    = _esc(game.uploader_name || 'Anonymous Gamer');
        const avatar      = _esc(game.uploader_avatar || '');
        const fileType    = _esc(game.file_type || 'html');
        const tags        = _esc(game.tags || '');
        const url         = _esc(game.file_url || '');

        const thumbnailContent = game.thumbnail_url
            ? `<img src="${_esc(game.thumbnail_url)}" alt="${name}" class="game-thumb-img" loading="lazy">`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="50"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="8" cy="12" r="2"/><path d="M15 9v6M12 12h6"/></svg>`;

        let tagsHtml = '';
        if (game.tags) {
            const tagParts = game.tags.split(',').slice(0, 3);
            tagsHtml = '<div class="card-tags">';
            for (const t of tagParts) tagsHtml += `<span class="tag-badge">${_esc(t.trim())}</span>`;
            tagsHtml += '</div>';
        }

        const profileActionsHtml = isProfile
            ? `<div class="profile-card-actions">
                 <button class="action-btn edit-btn" data-action="edit" title="Edit info">✏️</button>
                 <button class="action-btn del-btn"  data-action="delete" title="Delete game">🗑️</button>
               </div>`
            : '';

        const typeBadge = (game.file_type === 'zip')
            ? `<span class="view-badge" style="background:rgba(16,185,129,0.8);">📦 ZIP</span>`
            : '';

        // Show upvote badge only when sort = upvotes
        const upvoteBadge = currentSort === 'upvotes'
            ? `<span class="view-badge upvote-card-badge">👍 ${safeUpvotes}</span>`
            : '';

        parts[i] = `
            <div class="game-card"
                 data-id="${_esc(game.id)}"
                 data-url="${url}"
                 data-name="${name}"
                 data-uploader="${uploader}"
                 data-uploader-id="${_esc(uploaderId)}"
                 data-uploader-avatar="${avatar}"
                 data-tags="${tags}"
                 data-file-type="${fileType}"
                 data-view-count="${viewCount}"
                 data-upvotes="${safeUpvotes}">
                <div class="game-thumbnail">
                    ${thumbnailContent}
                    ${profileActionsHtml}
                    <div class="card-badges">
                        ${typeBadge}
                        ${upvoteBadge}
                        <span class="view-badge">👁️ ${viewCount}</span>
                    </div>
                </div>
                <div class="game-info">
                    <h3 class="game-title">${name}</h3>
                    ${tagsHtml}
                </div>
            </div>`;
    }
    targetGrid.innerHTML = parts.join('');
}

// ════════════════════════════════════
//  Open game modal
// ════════════════════════════════════

window.openGame = async (id, url, name, currentViewCount, uploaderId, uploaderName, upvotes, uploaderAvatar, fileType) => {
    // Always revoke any blobs from a previous game first
    _revokePlayerBlobUrls();

    // Immediate UI update
    if (DOM.playerTitle)  DOM.playerTitle.textContent  = name;
    if (DOM.uploaderName) DOM.uploaderName.textContent = uploaderName;

    // Uploader avatar
    if (DOM.uploaderAvatarImg && DOM.uploaderAvatarFallback) {
        if (uploaderAvatar) {
            DOM.uploaderAvatarImg.src               = uploaderAvatar;
            DOM.uploaderAvatarImg.style.display     = 'block';
            DOM.uploaderAvatarFallback.style.display = 'none';
        } else {
            DOM.uploaderAvatarImg.style.display     = 'none';
            DOM.uploaderAvatarFallback.style.display = 'block';
        }
    }

    // Uploader profile click
    if (DOM.uploaderProfileBtn) {
        DOM.uploaderProfileBtn.onclick = () => uploaderId && uploaderId !== 'null'
            ? showPublicProfile(uploaderId, uploaderName)
            : alert("This game was uploaded long ago — uploader profile is unavailable. 😢");
    }

    // Upvote button
    if (DOM.upvoteCount) DOM.upvoteCount.textContent = upvotes;
    if (DOM.upvoteBtn) {
        DOM.upvoteBtn.classList.toggle('voted', localStorage.getItem(`voted_${id}`) === 'up');
        DOM.upvoteBtn.onclick = () => handleUpvote(id, upvotes);
    }

    // Delete button — only visible to owner
    if (DOM.deleteGameBtn) {
        const isOwner = currentUser && currentUser.id === uploaderId;
        DOM.deleteGameBtn.style.display = isOwner ? 'block' : 'none';
        DOM.deleteGameBtn.onclick = isOwner ? () => deleteGame(id, null) : null;
    }

    // Open modal
    DOM.playerModal.classList.add('active');
    document.body.style.overflow = 'hidden';
    if (DOM.gameFrame)   DOM.gameFrame.style.display   = 'block';
    if (DOM.placeholder) DOM.placeholder.style.display = 'none';

    const viewportMeta = '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">';
    DOM.gameFrame.srcdoc = `${viewportMeta}<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#333;">Loading game...</div>`;

    // View-count update + game-file fetch in parallel
    const [, gameResult] = await Promise.allSettled([
        supabaseClient.from('games').update({ view_count: currentViewCount + 1 }).eq('id', id),
        fetch(url).then(r => { if (!r.ok) throw new Error('Could not load game.'); return r.arrayBuffer(); }),
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
        DOM.gameFrame.srcdoc = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:red;">Something went wrong.</div>';
        console.error(gameResult.reason);
    }

    // Update the cached game's view count (no re-fetch needed)
    const cached = cache._gameListCache.find(g => String(g.id) === String(id));
    if (cached) cached.view_count = currentViewCount + 1;
};

// ════════════════════════════════════
//  Open edit modal
// ════════════════════════════════════

window.openEditModal = (gameId, name, tags, event) => {
    if (event) event.stopPropagation();
    editingGameId = gameId;
    document.getElementById('editGameName').value = name;

    const editTagSelector = document.getElementById('editTagSelector');
    if (editTagSelector) {
        const existing = (!tags || tags === 'undefined')
            ? new Set()
            : new Set(tags.split(',').map(t => t.trim().toLowerCase()));
        editTagSelector.querySelectorAll('.tag-option').forEach(btn => {
            btn.classList.toggle('selected', existing.has(btn.dataset.tag.toLowerCase()));
        });
    }
    document.getElementById('editModal').classList.add('active');
};
