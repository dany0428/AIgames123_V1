// ════════════════════════════════════════════════════════
//  admin.js — AI Games Arcade Admin Panel
//
//  Security model:
//   1. Authentication: Supabase session (auth.uid() presence)
//   2. Authorization:  DB lookup against `admins` table — RLS allows only
//                      the caller's own row → clients cannot forge admin status.
//   3. Destructive actions are re-verified by Supabase RLS "admin delete"
//      policy on the server.
//   4. Every admin action is recorded in `admin_logs`.
//   5. Deletions require typing the game name to confirm (double-check).
// ════════════════════════════════════════════════════════

'use strict';

let _adminUser = null;
let _allGames  = [];

// ────────────────────────────────────
//  HTML escape (XSS protection)
// ────────────────────────────────────

function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ────────────────────────────────────
//  Access check — 2 stages
// ────────────────────────────────────

async function checkAdminAccess() {
    const spinner = document.getElementById('accessSpinner');
    const icon    = document.getElementById('accessIcon');
    const title   = document.getElementById('accessTitle');
    const msg     = document.getElementById('accessMsg');
    const backBtn = document.getElementById('accessBackBtn');

    try {
        // Stage 1: session check
        const { data: { session }, error: sErr } = await supabaseClient.auth.getSession();
        if (sErr || !session) {
            _showAccessDenied(icon, title, msg, backBtn, 'Login required.', spinner);
            return false;
        }
        _adminUser = session.user;

        // Stage 2: admins-table membership check.
        // The "self check only" RLS policy guarantees this query can only
        // return the caller's own row, so other users' rows cannot be forged.
        const { data, error: aErr } = await supabaseClient
            .from('admins')
            .select('user_id, added_at')
            .eq('user_id', _adminUser.id)
            .maybeSingle();   // returns null if no row (not an error)

        if (aErr) {
            console.error('Admin check error:', aErr.message);
            _showAccessDenied(icon, title, msg, backBtn, 'Error verifying permissions.', spinner);
            return false;
        }

        if (!data) {
            _showAccessDenied(icon, title, msg, backBtn, 'You do not have admin privileges.', spinner);
            return false;
        }

        // Access granted
        spinner.style.display = 'none';
        document.getElementById('accessScreen').style.display = 'none';
        document.getElementById('adminApp').style.display     = 'block';

        const name = _adminUser.user_metadata?.custom_name
            || _adminUser.user_metadata?.preferred_username
            || _adminUser.user_metadata?.full_name
            || _adminUser.email;
        document.getElementById('adminUserName').textContent = name;

        return true;

    } catch (err) {
        _showAccessDenied(icon, title, msg, backBtn, 'Unexpected error: ' + err.message, spinner);
        return false;
    }
}

function _showAccessDenied(icon, title, msg, backBtn, reason, spinner) {
    spinner.style.display = 'none';
    icon.textContent      = '🚫';
    title.textContent     = 'Access Denied';
    msg.textContent       = reason;
    backBtn.style.display = 'inline-block';
}

// ────────────────────────────────────
//  Action logging
// ────────────────────────────────────

async function logAction(action, targetType, targetId, details = {}) {
    const { error } = await supabaseClient.from('admin_logs').insert([{
        admin_id:    _adminUser.id,
        action,
        target_type: targetType,
        target_id:   String(targetId),
        details,
    }]);
    if (error) console.warn('Log write failed:', error.message);
}

// ────────────────────────────────────
//  Stats loader
// ────────────────────────────────────

async function loadStats() {
    const [gRes, lRes, rRes] = await Promise.allSettled([
        supabaseClient.from('games').select('id, view_count, upvotes'),
        supabaseClient.from('admin_logs').select('id', { count: 'exact', head: true }),
        supabaseClient.from('reports').select('id', { count: 'exact', head: true })
            .eq('status', 'pending'),
    ]);

    if (gRes.status === 'fulfilled' && gRes.value.data) {
        const games = gRes.value.data;
        const views   = games.reduce((s, g) => s + (g.view_count || 0), 0);
        const upvotes = games.reduce((s, g) => s + (g.upvotes    || 0), 0);
        document.getElementById('statGames').textContent   = games.length.toLocaleString();
        document.getElementById('statViews').textContent   = views.toLocaleString();
        document.getElementById('statUpvotes').textContent = upvotes.toLocaleString();
    }

    if (lRes.status === 'fulfilled') {
        document.getElementById('statLogs').textContent = (lRes.value.count ?? 0).toLocaleString();
    }

    // Open-reports count powers BOTH the stat card and the tab badge.
    if (rRes.status === 'fulfilled') {
        const n = rRes.value.count ?? 0;
        document.getElementById('statReports').textContent = n.toLocaleString();
        const badge = document.getElementById('reportsBadge');
        if (badge) {
            badge.textContent = n;
            badge.style.display = n > 0 ? 'inline-block' : 'none';
        }
    }
}

// ────────────────────────────────────
//  Games list
// ────────────────────────────────────

async function loadGames() {
    document.getElementById('gamesTableBody').innerHTML =
        '<tr><td colspan="8" class="tbl-loading">Loading...</td></tr>';

    const { data, error } = await supabaseClient
        .from('games')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        document.getElementById('gamesTableBody').innerHTML =
            `<tr><td colspan="8" class="tbl-error">Load failed: ${esc(error.message)}</td></tr>`;
        return;
    }

    _allGames = data || [];
    _renderGamesTable(_allGames);
}

function _renderGamesTable(games) {
    const badge = document.getElementById('gameCountBadge');
    const tbody = document.getElementById('gamesTableBody');

    badge.textContent = `${games.length} total`;

    if (!games.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="tbl-empty">No games found.</td></tr>';
        return;
    }

    tbody.innerHTML = games.map(g => {
        const thumb = g.thumbnail_url
            ? `<img src="${esc(g.thumbnail_url)}" class="tbl-thumb" alt="" loading="lazy">`
            : `<div class="tbl-thumb-empty">🎮</div>`;

        const tags = (g.tags || '').split(',').filter(Boolean)
            .map(t => `<span class="tbl-tag">${esc(t.trim())}</span>`).join('');

        const date = new Date(g.created_at).toLocaleDateString('en-US', {
            year: 'numeric', month: '2-digit', day: '2-digit',
        });

        // game id + name are carried via data-* attrs; click is bound by delegation
        // (see _initGamesTableEvents) — avoids one onclick listener per row.
        return `
            <tr data-game-id="${esc(String(g.id))}" data-game-name="${esc(g.name)}">
              <td>${thumb}</td>
              <td><span class="tbl-game-name">${esc(g.name)}</span></td>
              <td><span class="tbl-uploader">${esc(g.uploader_name || '-')}</span></td>
              <td><div class="tbl-tags">${tags || '-'}</div></td>
              <td class="tbl-num">${(g.view_count || 0).toLocaleString()}</td>
              <td class="tbl-num">${(g.upvotes    || 0).toLocaleString()}</td>
              <td class="tbl-date">${date}</td>
              <td>
                <button class="tbl-del-btn" data-action="delete-game">Delete</button>
              </td>
            </tr>`;
    }).join('');
}

// Event delegation — single listener on tbody catches all delete-button clicks
function _initGamesTableEvents() {
    document.getElementById('gamesTableBody').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="delete-game"]');
        if (!btn) return;
        const row  = btn.closest('tr');
        const id   = row?.dataset.gameId;
        const name = row?.dataset.gameName;
        if (id && name) _openDeleteConfirm(id, name);
    });
}

// Search filter — client-side, runs over the cached _allGames list
function _filterGames(q) {
    const query = q.toLowerCase().trim();
    const filtered = query
        ? _allGames.filter(g =>
            (g.name           || '').toLowerCase().includes(query) ||
            (g.uploader_name  || '').toLowerCase().includes(query) ||
            (g.tags           || '').toLowerCase().includes(query))
        : _allGames;
    _renderGamesTable(filtered);
    if (query) {
        document.getElementById('gameCountBadge').textContent =
            `${filtered.length} of ${_allGames.length}`;
    }
}

// ────────────────────────────────────
//  Delete confirmation modal (name re-entry)
// ────────────────────────────────────

let _pendingDeleteId   = null;
let _pendingDeleteName = null;

function _openDeleteConfirm(gameId, gameName) {
    _pendingDeleteId   = gameId;
    _pendingDeleteName = gameName;

    document.getElementById('confirmMsg').textContent          = `The uploader's game data will be permanently deleted.`;
    document.getElementById('confirmVerifyTarget').textContent = gameName;
    document.getElementById('confirmVerifyInput').value        = '';
    document.getElementById('confirmOkBtn').disabled           = true;
    document.getElementById('confirmMismatch').style.display   = 'none';

    document.getElementById('confirmOverlay').classList.add('active');
    setTimeout(() => document.getElementById('confirmVerifyInput').focus(), 100);
}

function _closeDeleteConfirm() {
    document.getElementById('confirmOverlay').classList.remove('active');
    _pendingDeleteId   = null;
    _pendingDeleteName = null;
}

async function _executeDelete() {
    if (!_pendingDeleteId || !_pendingDeleteName) return;

    const gameId   = _pendingDeleteId;
    const gameName = _pendingDeleteName;
    _closeDeleteConfirm();

    const okBtn = document.getElementById('confirmOkBtn');
    okBtn.disabled    = true;
    okBtn.textContent = 'Deleting...';

    try {
        // RLS "admin delete" re-verifies privileges on the server side
        const { error } = await supabaseClient
            .from('games')
            .delete()
            .eq('id', gameId);

        if (error) throw error;

        // Audit log
        await logAction('DELETE_GAME', 'game', gameId, { name: gameName });

        await Promise.all([loadGames(), loadStats()]);

    } catch (err) {
        notify.error(friendlyError(err, 'Could not delete the game.'), err);
    } finally {
        okBtn.disabled    = false;
        okBtn.textContent = 'Confirm Delete';
    }
}

function _initConfirmModal() {
    const input     = document.getElementById('confirmVerifyInput');
    const okBtn     = document.getElementById('confirmOkBtn');
    const mismatch  = document.getElementById('confirmMismatch');
    const overlay   = document.getElementById('confirmOverlay');

    input.addEventListener('input', () => {
        const match = input.value === _pendingDeleteName;
        okBtn.disabled = !match;
        mismatch.style.display = input.value.length > 0 && !match ? 'block' : 'none';
    });

    okBtn.addEventListener('click', _executeDelete);

    document.getElementById('confirmCancelBtn').addEventListener('click', _closeDeleteConfirm);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) _closeDeleteConfirm();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('active')) _closeDeleteConfirm();
    });
}

// ────────────────────────────────────
//  Admins list
// ────────────────────────────────────

async function loadAdmins() {
    const tbody = document.getElementById('adminsTableBody');
    tbody.innerHTML = '<tr><td colspan="2" class="tbl-loading">Loading...</td></tr>';

    // RLS returns only the caller's own row
    const { data, error } = await supabaseClient
        .from('admins')
        .select('user_id, added_at');

    if (error || !data?.length) {
        tbody.innerHTML = '<tr><td colspan="2" class="tbl-empty">No data</td></tr>';
        return;
    }

    tbody.innerHTML = data.map(a => `
        <tr>
          <td><code class="uid-code">${esc(a.user_id)}</code></td>
          <td class="tbl-date">${new Date(a.added_at).toLocaleString('en-US')}</td>
        </tr>`).join('');
}

// ────────────────────────────────────
//  Activity logs
// ────────────────────────────────────

async function loadLogs() {
    const tbody  = document.getElementById('logsTableBody');
    const badge  = document.getElementById('logCountBadge');
    tbody.innerHTML = '<tr><td colspan="5" class="tbl-loading">Loading...</td></tr>';

    const { data, error } = await supabaseClient
        .from('admin_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300);

    if (error) {
        tbody.innerHTML = `<tr><td colspan="5" class="tbl-error">Load failed: ${esc(error.message)}</td></tr>`;
        return;
    }

    const logs = data || [];
    badge.textContent = `Last ${logs.length}`;

    if (!logs.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="tbl-empty">No logs</td></tr>';
        return;
    }

    const ACTION_META = {
        DELETE_GAME: { label: '🗑️ Delete Game', color: '#ef4444' },
    };

    tbody.innerHTML = logs.map(l => {
        const meta = ACTION_META[l.action] ?? { label: esc(l.action), color: '#a78bfa' };
        const details = l.details ? esc(JSON.stringify(l.details)) : '-';
        return `
            <tr>
              <td class="tbl-date">${new Date(l.created_at).toLocaleString('en-US')}</td>
              <td><code class="uid-code short">${esc((l.admin_id || '').slice(0, 12))}…</code></td>
              <td><span class="log-action" style="color:${meta.color};">${meta.label}</span></td>
              <td class="tbl-small">${esc(l.target_type || '-')} / ${esc(l.target_id || '-')}</td>
              <td class="tbl-small">${details}</td>
            </tr>`;
    }).join('');
}

// ────────────────────────────────────
//  Reports (moderation queue)
// ────────────────────────────────────

// Current filter selection — persists between manual refreshes
let _reportStatusFilter = 'pending';

const REASON_LABEL = {
    copyright: 'Copyright',
    adult:     'Adult',
    violence:  'Violence',
    spam:      'Spam',
    other:     'Other',
};

async function loadReports() {
    const tbody = document.getElementById('reportsTableBody');
    const badge = document.getElementById('reportsCountBadge');
    tbody.innerHTML = '<tr><td colspan="7" class="tbl-loading">Loading...</td></tr>';

    // Build query — join the related game info so we can display thumbnail/name.
    // PostgREST embedding syntax for joining.
    let query = supabaseClient
        .from('reports')
        .select('id, game_id, reporter_id, reason, details, status, review_note, reviewed_at, created_at, games(id,name,thumbnail_url,uploader_name,file_url)')
        .order('created_at', { ascending: false })
        .limit(200);

    if (_reportStatusFilter !== 'all') {
        query = query.eq('status', _reportStatusFilter);
    }

    const { data, error } = await query;

    if (error) {
        tbody.innerHTML = `<tr><td colspan="7" class="tbl-error">Load failed: ${esc(error.message)}</td></tr>`;
        return;
    }

    const reports = data || [];
    badge.textContent = `${reports.length} ${_reportStatusFilter === 'all' ? 'total' : _reportStatusFilter}`;

    if (!reports.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="tbl-empty">No reports in this view.</td></tr>';
        return;
    }

    tbody.innerHTML = reports.map(r => {
        const game = r.games || {};
        const gameName    = esc(game.name || '(deleted game)');
        const uploader    = esc(game.uploader_name || '-');
        const thumb       = game.thumbnail_url
            ? `<img src="${esc(game.thumbnail_url)}" alt="" loading="lazy">`
            : `<div class="tbl-thumb-empty">🎮</div>`;
        const reasonLabel = REASON_LABEL[r.reason] || esc(r.reason);
        const details     = r.details ? esc(r.details) : '<em style="color:#475569;">(no details)</em>';
        const reporterId  = esc((r.reporter_id || '').slice(0, 8)) + '…';
        const date        = new Date(r.created_at).toLocaleString('en-US', {
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        });
        const status      = r.status;
        const gameId      = r.game_id;

        // Action buttons differ by status:
        //   pending  → Mark Reviewed, Dismiss, Delete Game
        //   reviewed → Dismiss, Delete Game
        //   actioned/dismissed → (read-only) View Game
        let actions = '';
        if (status === 'pending' || status === 'reviewed') {
            actions = `
                <button class="report-action-btn" data-action="dismiss" data-report-id="${r.id}">Dismiss</button>
                <button class="report-action-btn danger" data-action="delete-game" data-report-id="${r.id}" data-game-id="${gameId}" data-game-name="${gameName}">Delete Game</button>
            `;
            if (status === 'pending') {
                actions = `<button class="report-action-btn success" data-action="reviewed" data-report-id="${r.id}">Mark Reviewed</button>` + actions;
            }
        } else if (game.id) {
            actions = `<a class="report-action-btn" href="/?game=${gameId}" target="_blank" rel="noopener">View</a>`;
        } else {
            actions = '<span class="tbl-small">—</span>';
        }

        return `
            <tr data-report-id="${r.id}">
              <td class="tbl-date">${esc(date)}</td>
              <td>
                <div class="report-game-cell">
                  ${thumb}
                  <div class="report-game-info">
                    <span class="report-game-info-name">${gameName}</span>
                    <span class="report-game-info-uploader">by ${uploader}</span>
                  </div>
                </div>
              </td>
              <td><span class="report-reason-chip ${esc(r.reason)}">${esc(reasonLabel)}</span></td>
              <td class="report-details-cell">${details}</td>
              <td><code class="uid-code short">${reporterId}</code></td>
              <td><span class="report-status-chip ${esc(status)}">${esc(status)}</span></td>
              <td>
                <div class="report-actions-cell">${actions}</div>
              </td>
            </tr>`;
    }).join('');
}

// Event delegation for report action buttons + filter pills + refresh.
// Single listener on tbody handles all the per-row buttons.
function _initReportsEvents() {
    const tbody = document.getElementById('reportsTableBody');
    if (!tbody) return;

    tbody.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action   = btn.dataset.action;
        const reportId = btn.dataset.reportId;
        if (!reportId) return;

        // Disable to prevent double-clicks
        btn.disabled = true;
        const original = btn.textContent;
        btn.textContent = '…';

        try {
            if (action === 'reviewed' || action === 'dismiss') {
                const newStatus = action === 'reviewed' ? 'reviewed' : 'dismissed';
                const note      = action === 'dismiss'
                    ? (prompt('Optional: reason for dismissing this report (leave blank to skip)') || null)
                    : null;
                const { error } = await supabaseClient.rpc('review_report', {
                    report_id:  Number(reportId),
                    new_status: newStatus,
                    note,
                });
                if (error) throw error;
                await Promise.all([loadReports(), loadStats()]);

            } else if (action === 'delete-game') {
                const gameId   = btn.dataset.gameId;
                const gameName = btn.dataset.gameName;
                if (!confirm(`Permanently DELETE the game "${gameName}"?\n\nThis cannot be undone. The report will be marked as "actioned".`)) {
                    btn.disabled = false;
                    btn.textContent = original;
                    return;
                }

                // Delete the game (admin-delete RLS policy permits this)
                const { error: delErr } = await supabaseClient
                    .from('games').delete().eq('id', gameId);
                if (delErr) throw delErr;

                // Audit-log it (best-effort)
                await supabaseClient.from('admin_logs').insert([{
                    admin_id:    _adminUser.id,
                    action:      'DELETE_GAME',
                    target_type: 'game',
                    target_id:   String(gameId),
                    details:     { name: gameName, via_report: Number(reportId) },
                }]);

                // Mark report as actioned
                const { error: rErr } = await supabaseClient.rpc('review_report', {
                    report_id:  Number(reportId),
                    new_status: 'actioned',
                    note:       `Game deleted by admin: "${gameName}"`,
                });
                if (rErr) console.warn('review_report failed:', rErr.message);

                await Promise.all([loadReports(), loadStats(), loadGames()]);
            }
        } catch (err) {
            alert('Action failed: ' + (err.message || err));
            btn.disabled = false;
            btn.textContent = original;
        }
    });

    // Filter pill clicks
    document.getElementById('reportStatusFilter')?.addEventListener('click', (e) => {
        const pill = e.target.closest('.report-pill');
        if (!pill) return;
        document.querySelectorAll('.report-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        _reportStatusFilter = pill.dataset.status;
        loadReports();
    });

    // Refresh button
    document.getElementById('refreshReportsBtn')?.addEventListener('click', () => {
        loadReports();
        loadStats();
    });
}

// ────────────────────────────────────
//  Tab switching — admins/logs/reports load on first activation only
// ────────────────────────────────────

function _initTabs() {
    let logsLoaded    = false;
    let adminsLoaded  = false;
    let reportsLoaded = false;

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const name = btn.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
            btn.classList.add('active');
            document.getElementById(`tab-${name}`).style.display = 'block';

            // lazy-load tab data on first entry
            if (name === 'admins'  && !adminsLoaded)  { loadAdmins();  adminsLoaded  = true; }
            if (name === 'logs'    && !logsLoaded)    { loadLogs();    logsLoaded    = true; }
            if (name === 'reports' && !reportsLoaded) { loadReports(); reportsLoaded = true; }
        });
    });
}

// ────────────────────────────────────
//  Boot
// ────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    const isAdmin = await checkAdminAccess();
    if (!isAdmin) return;

    _initTabs();
    _initConfirmModal();
    _initGamesTableEvents();
    _initReportsEvents();

    // Logout
    document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
        if (!confirm('Log out?')) return;
        await supabaseClient.auth.signOut();
        window.location.href = '/';
    });

    // Search (debounced 200ms)
    let _searchTimer;
    document.getElementById('gameSearch').addEventListener('input', (e) => {
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(() => _filterGames(e.target.value), 200);
    });

    // Refresh buttons
    document.getElementById('refreshGamesBtn').addEventListener('click', loadGames);
    document.getElementById('refreshLogsBtn').addEventListener('click', loadLogs);

    // Initial data load (parallel)
    await Promise.all([loadStats(), loadGames()]);
});
