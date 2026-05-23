// ════════════════════════════════════════════════════════
//  admin.js — AI Games Arcade 관리자 패널
//
//  보안 원칙:
//   1. 인증: Supabase 세션 (auth.uid() 존재 여부)
//   2. 권한: admins 테이블 DB 조회 — RLS가 본인 레코드만 허용
//      → 클라이언트가 admins 테이블을 위조할 수 없음
//   3. 삭제 등 파괴적 작업은 Supabase RLS "admin delete" 정책이 서버에서 재검증
//   4. 모든 관리 작업은 admin_logs 테이블에 기록
//   5. 삭제 시 게임 이름 직접 입력으로 이중 확인
// ════════════════════════════════════════════════════════

'use strict';

let _adminUser = null;
let _allGames  = [];

// ────────────────────────────────────
//  HTML 이스케이프 (XSS 방지)
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
//  접근 검증 — 2단계
// ────────────────────────────────────

async function checkAdminAccess() {
    const spinner = document.getElementById('accessSpinner');
    const icon    = document.getElementById('accessIcon');
    const title   = document.getElementById('accessTitle');
    const msg     = document.getElementById('accessMsg');
    const backBtn = document.getElementById('accessBackBtn');

    try {
        // 1단계: 로그인 세션 확인
        const { data: { session }, error: sErr } = await supabaseClient.auth.getSession();
        if (sErr || !session) {
            _showAccessDenied(icon, title, msg, backBtn, '로그인이 필요합니다.', spinner);
            return false;
        }
        _adminUser = session.user;

        // 2단계: DB admins 테이블에서 권한 확인
        //   RLS "self check only" 정책 덕분에
        //   본인 레코드만 조회 가능 → 다른 유저 레코드 위조 불가
        const { data, error: aErr } = await supabaseClient
            .from('admins')
            .select('user_id, added_at')
            .eq('user_id', _adminUser.id)
            .maybeSingle();   // 없으면 null 반환 (에러 아님)

        if (aErr) {
            console.error('Admin check error:', aErr.message);
            _showAccessDenied(icon, title, msg, backBtn, '권한 확인 중 오류가 발생했습니다.', spinner);
            return false;
        }

        if (!data) {
            _showAccessDenied(icon, title, msg, backBtn, '관리자 권한이 없습니다.', spinner);
            return false;
        }

        // 인증 성공
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
        _showAccessDenied(icon, title, msg, backBtn, '예기치 못한 오류: ' + err.message, spinner);
        return false;
    }
}

function _showAccessDenied(icon, title, msg, backBtn, reason, spinner) {
    spinner.style.display = 'none';
    icon.textContent      = '🚫';
    title.textContent     = '접근 불가';
    msg.textContent       = reason;
    backBtn.style.display = 'inline-block';
}

// ────────────────────────────────────
//  관리 작업 로깅
// ────────────────────────────────────

async function logAction(action, targetType, targetId, details = {}) {
    const { error } = await supabaseClient.from('admin_logs').insert([{
        admin_id:    _adminUser.id,
        action,
        target_type: targetType,
        target_id:   String(targetId),
        details,
    }]);
    if (error) console.warn('로그 기록 실패:', error.message);
}

// ────────────────────────────────────
//  통계 로드
// ────────────────────────────────────

async function loadStats() {
    const [gRes, lRes] = await Promise.allSettled([
        supabaseClient.from('games').select('id, view_count, upvotes'),
        supabaseClient.from('admin_logs').select('id', { count: 'exact', head: true }),
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
}

// ────────────────────────────────────
//  게임 목록
// ────────────────────────────────────

async function loadGames() {
    document.getElementById('gamesTableBody').innerHTML =
        '<tr><td colspan="8" class="tbl-loading">불러오는 중...</td></tr>';

    const { data, error } = await supabaseClient
        .from('games')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        document.getElementById('gamesTableBody').innerHTML =
            `<tr><td colspan="8" class="tbl-error">로드 실패: ${esc(error.message)}</td></tr>`;
        return;
    }

    _allGames = data || [];
    _renderGamesTable(_allGames);
}

function _renderGamesTable(games) {
    const badge = document.getElementById('gameCountBadge');
    const tbody = document.getElementById('gamesTableBody');

    badge.textContent = `총 ${games.length}개`;

    if (!games.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="tbl-empty">게임이 없습니다.</td></tr>';
        return;
    }

    tbody.innerHTML = games.map(g => {
        const thumb = g.thumbnail_url
            ? `<img src="${esc(g.thumbnail_url)}" class="tbl-thumb" alt="" loading="lazy">`
            : `<div class="tbl-thumb-empty">🎮</div>`;

        const tags = (g.tags || '').split(',').filter(Boolean)
            .map(t => `<span class="tbl-tag">${esc(t.trim())}</span>`).join('');

        const date = new Date(g.created_at).toLocaleDateString('ko-KR', {
            year: 'numeric', month: '2-digit', day: '2-digit',
        });

        // data-* 속성으로 전달 (onclick 인라인 함수 대신 이벤트 위임 사용)
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
                <button class="tbl-del-btn" data-action="delete-game">삭제</button>
              </td>
            </tr>`;
    }).join('');
}

// 이벤트 위임 — 테이블에서 삭제 버튼 클릭 감지
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

// 검색 필터
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
            `${filtered.length} / ${_allGames.length}개`;
    }
}

// ────────────────────────────────────
//  삭제 확인 모달 (이름 재입력 방식)
// ────────────────────────────────────

let _pendingDeleteId   = null;
let _pendingDeleteName = null;

function _openDeleteConfirm(gameId, gameName) {
    _pendingDeleteId   = gameId;
    _pendingDeleteName = gameName;

    document.getElementById('confirmMsg').textContent          = `업로더의 게임 데이터가 영구적으로 삭제됩니다.`;
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
    okBtn.textContent = '삭제 중...';

    try {
        // Supabase RLS "admin delete" 정책이 서버에서 권한 재검증
        const { error } = await supabaseClient
            .from('games')
            .delete()
            .eq('id', gameId);

        if (error) throw error;

        // 삭제 기록
        await logAction('DELETE_GAME', 'game', gameId, { name: gameName });

        await Promise.all([loadGames(), loadStats()]);

    } catch (err) {
        alert('삭제 실패: ' + err.message);
    } finally {
        okBtn.disabled    = false;
        okBtn.textContent = '삭제 확인';
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
//  관리자 목록
// ────────────────────────────────────

async function loadAdmins() {
    const tbody = document.getElementById('adminsTableBody');
    tbody.innerHTML = '<tr><td colspan="2" class="tbl-loading">불러오는 중...</td></tr>';

    // RLS: 본인 레코드만 반환됨
    const { data, error } = await supabaseClient
        .from('admins')
        .select('user_id, added_at');

    if (error || !data?.length) {
        tbody.innerHTML = '<tr><td colspan="2" class="tbl-empty">데이터 없음</td></tr>';
        return;
    }

    tbody.innerHTML = data.map(a => `
        <tr>
          <td><code class="uid-code">${esc(a.user_id)}</code></td>
          <td class="tbl-date">${new Date(a.added_at).toLocaleString('ko-KR')}</td>
        </tr>`).join('');
}

// ────────────────────────────────────
//  활동 로그
// ────────────────────────────────────

async function loadLogs() {
    const tbody  = document.getElementById('logsTableBody');
    const badge  = document.getElementById('logCountBadge');
    tbody.innerHTML = '<tr><td colspan="5" class="tbl-loading">불러오는 중...</td></tr>';

    const { data, error } = await supabaseClient
        .from('admin_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300);

    if (error) {
        tbody.innerHTML = `<tr><td colspan="5" class="tbl-error">로드 실패: ${esc(error.message)}</td></tr>`;
        return;
    }

    const logs = data || [];
    badge.textContent = `최근 ${logs.length}건`;

    if (!logs.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="tbl-empty">로그 없음</td></tr>';
        return;
    }

    const ACTION_META = {
        DELETE_GAME: { label: '🗑️ 게임 삭제', color: '#ef4444' },
    };

    tbody.innerHTML = logs.map(l => {
        const meta = ACTION_META[l.action] ?? { label: esc(l.action), color: '#a78bfa' };
        const details = l.details ? esc(JSON.stringify(l.details)) : '-';
        return `
            <tr>
              <td class="tbl-date">${new Date(l.created_at).toLocaleString('ko-KR')}</td>
              <td><code class="uid-code short">${esc((l.admin_id || '').slice(0, 12))}…</code></td>
              <td><span class="log-action" style="color:${meta.color};">${meta.label}</span></td>
              <td class="tbl-small">${esc(l.target_type || '-')} / ${esc(l.target_id || '-')}</td>
              <td class="tbl-small">${details}</td>
            </tr>`;
    }).join('');
}

// ────────────────────────────────────
//  탭 전환
// ────────────────────────────────────

function _initTabs() {
    let logsLoaded   = false;
    let adminsLoaded = false;

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const name = btn.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
            btn.classList.add('active');
            document.getElementById(`tab-${name}`).style.display = 'block';

            // 탭 첫 진입 시 데이터 로드
            if (name === 'admins' && !adminsLoaded) { loadAdmins(); adminsLoaded = true; }
            if (name === 'logs'   && !logsLoaded)   { loadLogs();   logsLoaded   = true; }
        });
    });
}

// ────────────────────────────────────
//  초기화
// ────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    const isAdmin = await checkAdminAccess();
    if (!isAdmin) return;

    _initTabs();
    _initConfirmModal();
    _initGamesTableEvents();

    // 로그아웃
    document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
        if (!confirm('로그아웃 하시겠습니까?')) return;
        await supabaseClient.auth.signOut();
        window.location.href = '/';
    });

    // 검색
    let _searchTimer;
    document.getElementById('gameSearch').addEventListener('input', (e) => {
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(() => _filterGames(e.target.value), 200);
    });

    // 새로고침 버튼
    document.getElementById('refreshGamesBtn').addEventListener('click', loadGames);
    document.getElementById('refreshLogsBtn').addEventListener('click', loadLogs);

    // 데이터 초기 로드
    await Promise.all([loadStats(), loadGames()]);
});
