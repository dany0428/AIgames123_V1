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
        notify.success('Game deleted.');
        DOM.playerModal.classList.remove('active');
        document.body.style.overflow = '';
        DOM.gameFrame.srcdoc = '';
        _revokePlayerBlobUrls();
        if (DOM.deleteGameBtn) DOM.deleteGameBtn.style.display = 'none';

        cache.invalidateTags();   // a game was removed — refresh tag list
        DOM.profileContent.style.display === 'block' ? fetchMyGames() : fetchGames();
    } catch (err) {
        notify.error(friendlyError(err, 'Could not delete game.'), err);
    }
};

// ════════════════════════════════════
//  Upvote — server-side single-vote enforcement
//
//  SECURITY: the old localStorage-only flag was trivially bypassable
//  (clear storage → upvote infinitely). This version calls a server-
//  side RPC `toggle_upvote(game_id)` that:
//    • Requires auth.uid() (rejected for anonymous)
//    • Inserts/deletes a row in `game_upvotes(user_id, game_id)`
//      with UNIQUE(user_id, game_id), so each user can upvote a
//      game exactly once.
//    • Returns the resulting upvote count atomically.
//
//  If the RPC does not exist yet (migration not applied), falls back
//  to the optimistic-UI behavior so the app keeps working.
// ════════════════════════════════════

// ════════════════════════════════════════════════════════
//  Upvote handler
//
//  Two paths depending on auth state:
//
//  1. LOGGED-IN USERS → toggle_upvote RPC
//     Server uses the game_upvotes table for cross-device dedup
//     (one vote per user across all their devices). Source of truth.
//
//  2. ANONYMOUS USERS → anon_upvote RPC with delta ±1
//     Server trusts the client's delta. Dedup is client-side via
//     localStorage. Trivially bypassable (clear cookies / use another
//     browser / use a bot), but acceptable for a casual games site.
//
//  Both paths share the same localStorage key `voted_<id>` so UI state
//  is consistent and the user's vote persists across modal opens.
// ════════════════════════════════════════════════════════

window.handleUpvote = async (gameId, currentCount) => {
    const voteKey  = `voted_${gameId}`;
    const hasVoted = localStorage.getItem(voteKey) === 'up';

    // Optimistic UI update (rolled back on error)
    const nextCount = hasVoted
        ? Math.max(0, (Number(currentCount) || 0) - 1)
        : (Number(currentCount) || 0) + 1;

    if (DOM.upvoteCount) DOM.upvoteCount.textContent = nextCount;
    if (DOM.upvoteBtn) {
        DOM.upvoteBtn.classList.toggle('voted', !hasVoted);
        DOM.upvoteBtn.onclick = () => handleUpvote(gameId, nextCount);
    }

    const cached = cache._gameListCache.find(g => String(g.id) === String(gameId));
    if (cached) cached.upvotes = nextCount;

    try {
        let returnedCount = null;

        if (currentUser) {
            // Authenticated path — server-side dedup via game_upvotes table
            const { data, error } = await supabaseClient
                .rpc('toggle_upvote', { p_game_id: gameId });

            if (error) {
                if (/function .*toggle_upvote.* does not exist/i.test(error.message)) {
                    console.warn('toggle_upvote RPC missing — falling back to legacy UPDATE.');
                    const { error: legacyErr } = await supabaseClient
                        .from('games').update({ upvotes: nextCount }).eq('id', gameId);
                    if (legacyErr) throw legacyErr;
                } else {
                    throw error;
                }
            }
            if (typeof data === 'number') returnedCount = data;

        } else {
            // Anonymous path — server applies the delta we send.
            // localStorage is the only dedup; clearing it lets the user
            // vote again, which is the intended trade-off for this design.
            const delta = hasVoted ? -1 : 1;
            const { data, error } = await supabaseClient
                .rpc('anon_upvote', { p_game_id: gameId, p_delta: delta });

            if (error) {
                if (/function .*anon_upvote.* does not exist/i.test(error.message)) {
                    notify.warn('Anonymous voting not yet enabled. Please log in.');
                    throw error;
                }
                throw error;
            }
            if (typeof data === 'number') returnedCount = data;
        }

        // Sync the badge with the authoritative count if RPC returned one
        if (returnedCount !== null) {
            if (DOM.upvoteCount) DOM.upvoteCount.textContent = returnedCount;
            if (cached) cached.upvotes = returnedCount;
        }

        // Keep the card's DOM data-upvotes attribute in sync too, so that
        // closing the modal and reopening the same card picks up the fresh
        // count (and so the optimistic delta isn't lost on page nav).
        const finalCount = returnedCount !== null ? returnedCount : nextCount;
        document
            .querySelectorAll(`.game-card[data-id="${gameId}"]`)
            .forEach(card => { card.dataset.upvotes = finalCount; });

        if (hasVoted) localStorage.removeItem(voteKey);
        else          localStorage.setItem(voteKey, 'up');
    } catch (err) {
        // Rollback UI
        if (DOM.upvoteCount) DOM.upvoteCount.textContent = currentCount;
        if (DOM.upvoteBtn) {
            DOM.upvoteBtn.classList.toggle('voted', hasVoted);
            DOM.upvoteBtn.onclick = () => handleUpvote(gameId, currentCount);
        }
        if (cached) cached.upvotes = Number(currentCount) || 0;
        notify.error(friendlyError(err, 'Could not update your vote.'), err);
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
//  Game-side defensive shim
//
//  Because we allow `same-origin` on the game iframe (required for
//  localStorage to work), the game's JS technically shares an origin
//  with the parent app. This shim is prepended to every game's HTML
//  to raise the bar for trivial exfiltration of parent state.
//
//  It IS NOT a true security boundary — a determined attacker can
//  always recover references to the parent. The genuine protection
//  is the iframe sandbox + careful policy on what we put in
//  parent localStorage. Move games to a separate origin if you need
//  a real boundary.
// ════════════════════════════════════
const _GAME_DEFENSIVE_SHIM = `<script>
(function(){
  'use strict';
  try {
    // Sever the most obvious parent-access paths. Games very rarely
    // need to call window.parent, and never need to read it from inside
    // an embedded play context, so we replace these with the iframe's
    // own window. Anything that tries to walk up to the embedder will
    // just loop back to itself.
    var w = window;
    try { Object.defineProperty(w, 'parent', { get:function(){ return w; }, configurable:false }); } catch(e){}
    try { Object.defineProperty(w, 'top',    { get:function(){ return w; }, configurable:false }); } catch(e){}
    try { Object.defineProperty(w, 'opener', { get:function(){ return null; }, configurable:false }); } catch(e){}

    // Suppress noisy 'storage' events that fire in the iframe when the
    // parent app writes to localStorage. (Same origin → events propagate.)
    // Games that listen for storage events for THEIR OWN keys still work
    // because the shim only filters out keys that don't look game-owned;
    // here we filter parent-app keys with a known prefix.
    var PARENT_KEY_PREFIXES = ['sb-', 'voted_', 'uploaderSync:'];
    w.addEventListener('storage', function(e){
      for (var i=0; i<PARENT_KEY_PREFIXES.length; i++) {
        if (e.key && e.key.indexOf(PARENT_KEY_PREFIXES[i]) === 0) {
          e.stopImmediatePropagation();
          return;
        }
      }
    }, true);
  } catch (e) { /* shim failure is non-fatal — game still loads */ }
})();
<\/script>`;

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
        DOM.gameFrame.srcdoc = viewportMeta + _GAME_DEFENSIVE_SHIM + wasmPatch + html;

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
                card.dataset.description || '',
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
            d.description || '',
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
        const description = _esc(game.description || '');

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

        // ZIP file-type badge: shown ONLY on the user's own profile grid,
        // i.e. when renderGames was called with isProfile=true (myGameGrid).
        // The public main grid (gameGrid) and other users' profile grids
        // (publicGameGrid) never show this badge.
        const typeBadge = (isProfile && game.file_type === 'zip')
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
                 data-description="${description}"
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

window.openGame = async (id, url, name, currentViewCount, uploaderId, uploaderName, upvotes, uploaderAvatar, fileType, description) => {
    // Always revoke any blobs from a previous game first
    _revokePlayerBlobUrls();

    // Expose the current game's id globally so the report modal can
    // pick it up when the user clicks the ⚠️ Report button.
    window.currentPlayerGameId = id;

    // Reset the report button to its default look — last game's
    // "✓ Reported" state shouldn't carry over to the next game.
    const reportBtnEl = document.getElementById('reportBtn');
    if (reportBtnEl) {
        reportBtnEl.classList.remove('reported');
        reportBtnEl.textContent = '⚠️ Report';
    }

    // Immediate UI update
    if (DOM.playerTitle)  DOM.playerTitle.textContent  = name;
    if (DOM.uploaderName) DOM.uploaderName.textContent = uploaderName;

    // Game description — body goes into #gameDescriptionBody; the parent
    // wrapper (#gameDescription) is shown/hidden as a unit so the
    // "Description" label disappears when there's nothing to show.
    // textContent (not innerHTML) is XSS-safe; CSS white-space:pre-wrap
    // makes line breaks render naturally.
    if (DOM.gameDescription) {
        const desc = (description || '').trim();
        if (desc) {
            if (DOM.gameDescriptionBody) DOM.gameDescriptionBody.textContent = desc;
            DOM.gameDescription.style.display = 'block';
        } else {
            if (DOM.gameDescriptionBody) DOM.gameDescriptionBody.textContent = '';
            DOM.gameDescription.style.display = 'none';
        }
    }

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
            : notify.warn('This game was uploaded long ago — uploader profile is unavailable.');
    }

    // Upvote button
    // Stale-count fix: after the user upvotes, the card's data-upvotes
    // attribute stays at the old value. If they close and reopen the same
    // game, we'd otherwise display the stale count. cache._gameListCache
    // is kept in sync by handleUpvote(), so prefer that when present.
    let displayUpvotes = upvotes;
    const cachedGame = cache._gameListCache?.find(g => String(g.id) === String(id));
    if (cachedGame && typeof cachedGame.upvotes === 'number') {
        displayUpvotes = cachedGame.upvotes;
    }
    if (DOM.upvoteCount) DOM.upvoteCount.textContent = displayUpvotes;
    if (DOM.upvoteBtn) {
        DOM.upvoteBtn.classList.toggle('voted', localStorage.getItem(`voted_${id}`) === 'up');
        DOM.upvoteBtn.onclick = () => handleUpvote(id, displayUpvotes);
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

    // ════════════════════════════════════════════════════════
    // URL validation: rejects javascript:, data:, http:, URLs pointing
    // at this app's own origin (sandbox-escape vector), and anything
    // outside the Supabase storage bucket. Without this check, an
    // attacker who can write to `games.file_url` (e.g. via the broad
    // "누구나 조회수 증가 가능" RLS policy) could redirect the player
    // iframe to malicious content.
    // ════════════════════════════════════════════════════════
    try {
        assertSafeGameUrl(url);
    } catch (err) {
        DOM.gameFrame.srcdoc = `${viewportMeta}<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:red;font-family:sans-serif;padding:2rem;text-align:center;">Refused to load game: ${_esc(err.message)}</div>`;
        console.error('Blocked game load:', err.message, url);
        return;
    }

    // View-count update + game-file fetch in parallel.
    // Uses the `increment_view_count` RPC for an atomic SQL-side
    // increment (avoids the read-modify-write race that lets two
    // concurrent viewers overwrite each other's increment). If the
    // RPC doesn't exist yet, falls back to the legacy UPDATE so the
    // page keeps working until the migration is applied.
    const incrementCall = supabaseClient
        .rpc('increment_view_count', { p_game_id: id })
        .then(({ error }) => {
            if (error && /function .*increment_view_count.* does not exist/i.test(error.message)) {
                return supabaseClient
                    .from('games')
                    .update({ view_count: currentViewCount + 1 })
                    .eq('id', id);
            }
            return { error };
        });

    const [, gameResult] = await Promise.allSettled([
        incrementCall,
        fetch(url).then(r => { if (!r.ok) throw new Error('Could not load game.'); return r.arrayBuffer(); }),
    ]);

    if (gameResult.status === 'fulfilled') {
        const buffer = gameResult.value;
        const type   = fileType || 'html';

        if (type === 'zip') {
            await _loadZipGame(buffer);
        } else {
            const text = new TextDecoder('utf-8').decode(buffer);
            // Shim is prepended BEFORE the game's HTML so its IIFE runs
            // before any game script touches window.parent / storage events.
            DOM.gameFrame.srcdoc = viewportMeta + _GAME_DEFENSIVE_SHIM + text;
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

window.openEditModal = (gameId, name, tags, description, event) => {
    if (event) event.stopPropagation();
    editingGameId = gameId;
    document.getElementById('editGameName').value = name;

    const descInput = document.getElementById('editGameDescription');
    if (descInput) descInput.value = description || '';

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


// ════════════════════════════════════════════════════════
//  SEO helpers — slug generation, permalink push, meta tag updates
//
//  When a game is opened we:
//    1. Push /game/<id>-<slug> to the URL bar (deep-linkable)
//    2. Rewrite <title> and <meta> tags so social-share previews
//       (Twitter/Discord/Slack/Reddit) show the actual game info
//  When the player closes we restore the site defaults.
// ════════════════════════════════════════════════════════

// Stable, lowercase, ASCII-safe slug. Used in URL paths and the sitemap.
// Must match the slugify logic in /api/sitemap.js exactly.
function _slugify(name) {
    return String(name || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60);
}

// Snapshot the homepage defaults so we can restore them when the modal closes.
const _SEO_DEFAULTS = {
    title:       document.title,
    description: document.querySelector('meta[name="description"]')?.content || '',
    ogTitle:     document.querySelector('meta[property="og:title"]')?.content || '',
    ogDesc:      document.querySelector('meta[property="og:description"]')?.content || '',
    ogUrl:       document.querySelector('meta[property="og:url"]')?.content || '',
    ogImage:     document.querySelector('meta[property="og:image"]')?.content || '',
    twTitle:     document.querySelector('meta[name="twitter:title"]')?.content || '',
    twDesc:      document.querySelector('meta[name="twitter:description"]')?.content || '',
    twImage:     document.querySelector('meta[name="twitter:image"]')?.content || '',
    canonical:   document.querySelector('link[rel="canonical"]')?.href || '',
};

function _setMeta(selector, attr, value) {
    const el = document.querySelector(selector);
    if (el && value) el.setAttribute(attr, value);
}

// Apply game-specific meta. Description falls back to a generic line if
// the game didn't supply one (most don't on first upload).
function _applyGameMeta(game, gameUrl) {
    const title = `${game.name} — AIgames123`;
    const desc  = (game.description && game.description.trim())
        ? game.description.trim().slice(0, 160)
        : `Play "${game.name}" — an AI-generated game on AIgames123. Free, instant, in your browser.`;
    const img   = game.thumbnail_url || _SEO_DEFAULTS.ogImage;

    document.title = title;
    _setMeta('meta[name="description"]',      'content', desc);
    _setMeta('meta[property="og:title"]',     'content', title);
    _setMeta('meta[property="og:description"]', 'content', desc);
    _setMeta('meta[property="og:url"]',       'content', gameUrl);
    _setMeta('meta[property="og:image"]',     'content', img);
    _setMeta('meta[name="twitter:title"]',    'content', title);
    _setMeta('meta[name="twitter:description"]', 'content', desc);
    _setMeta('meta[name="twitter:image"]',    'content', img);
    _setMeta('link[rel="canonical"]',         'href',    gameUrl);
}

// Restore the homepage defaults (called on modal close).
function _restoreSiteMeta() {
    document.title = _SEO_DEFAULTS.title;
    _setMeta('meta[name="description"]',         'content', _SEO_DEFAULTS.description);
    _setMeta('meta[property="og:title"]',        'content', _SEO_DEFAULTS.ogTitle);
    _setMeta('meta[property="og:description"]',  'content', _SEO_DEFAULTS.ogDesc);
    _setMeta('meta[property="og:url"]',          'content', _SEO_DEFAULTS.ogUrl);
    _setMeta('meta[property="og:image"]',        'content', _SEO_DEFAULTS.ogImage);
    _setMeta('meta[name="twitter:title"]',       'content', _SEO_DEFAULTS.twTitle);
    _setMeta('meta[name="twitter:description"]', 'content', _SEO_DEFAULTS.twDesc);
    _setMeta('meta[name="twitter:image"]',       'content', _SEO_DEFAULTS.twImage);
    _setMeta('link[rel="canonical"]',            'href',    _SEO_DEFAULTS.canonical);
}

// Public helper: open a game by id only (used by /game/:slug routes).
// Fetches the row from Supabase, then delegates to window.openGame().
window.openGameById = async (id) => {
    try {
        const { data, error } = await supabaseClient
            .from('games')
            .select('*')
            .eq('id', id)
            .single();
        if (error || !data) {
            notify.warn('Game not found.');
            return;
        }
        window.openGame(
            data.id,
            data.file_url,
            data.name,
            Number(data.view_count) || 0,
            data.user_id || null,
            data.uploader_name || 'Anonymous',
            Number(data.upvotes) || 0,
            data.uploader_avatar || '',
            data.file_type || 'html',
            data.description || '',
        );
    } catch (err) {
        notify.error(friendlyError(err, 'Could not load that game.'), err);
    }
};

// Hook into openGame: after it's called by anyone, update URL + meta.
// We wrap rather than modify the original to keep the existing signature.
const _originalOpenGame = window.openGame;
window.openGame = function patchedOpenGame(id, url, name, viewCount, uploaderId, uploaderName, upvotes, uploaderAvatar, fileType, description) {
    // Push permalink URL (only if we're not already at it — avoid history spam)
    const slug = _slugify(name);
    const targetPath = slug ? `/game/${id}-${slug}` : `/game/${id}`;
    if (window.location.pathname !== targetPath) {
        history.pushState({ page: 'game', id }, '', targetPath);
    }
    // Update meta tags for social sharing
    _applyGameMeta(
        { name, description, thumbnail_url: null },
        `https://aigames123.com${targetPath}`,
    );
    // Delegate to the original implementation
    return _originalOpenGame.call(this, id, url, name, viewCount, uploaderId, uploaderName, upvotes, uploaderAvatar, fileType, description);
};

// When the player modal closes, restore the site's default meta + URL.
// We wire this onto the existing close logic by listening for clicks on
// closePlayer + ESC key in app.js, but the simplest approach is to watch
// the modal's class changes via MutationObserver.
(function _watchPlayerModalForClose() {
    const modal = document.getElementById('playerModal');
    if (!modal) return;
    let wasActive = modal.classList.contains('active');
    const obs = new MutationObserver(() => {
        const isActive = modal.classList.contains('active');
        if (wasActive && !isActive) {
            // Modal just closed
            _restoreSiteMeta();
            // Only pop back to home if we came from a /game/ URL via history nav.
            // If user is on /game/123-xxx and closes the player, push them
            // back to home so they aren't stuck on a deep-link with no game.
            if (window.location.pathname.startsWith('/game/')) {
                history.pushState({ page: 'main', tag: '' }, '', '/');
            }
        }
        wasActive = isActive;
    });
    obs.observe(modal, { attributes: true, attributeFilter: ['class'] });
})();
