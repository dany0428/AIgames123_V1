const PRESET_TAGS = [
    'Action','Adventure','RPG','FPS','Puzzle',
    'Strategy','Simulation','Sports','Horror','Racing',
    'Platform','Arcade','Card','Board','Idle',
    'Casual','Shooter','Fighting','Survival','Music',
];

// ════════════════════════════════════
//  공유 태그 선택기 빌더 (중복 코드 제거)
// ════════════════════════════════════

function buildTagSelector(container) {
    if (!container) return;
    container.innerHTML = PRESET_TAGS
        .map(tag => `<button type="button" class="tag-option" data-tag="${tag}">${tag}</button>`)
        .join('');
    container.addEventListener('click', (e) => {
        const btn = e.target.closest('.tag-option');
        if (btn) btn.classList.toggle('selected');
    });
}

function getSelectedTags(container) {
    if (!container) return '';
    return Array.from(container.querySelectorAll('.tag-option.selected'))
        .map(b => b.dataset.tag).join(', ');
}

function clearTagSelector(container) {
    container?.querySelectorAll('.tag-option.selected')
        .forEach(b => b.classList.remove('selected'));
}

// ════════════════════════════════════
//  업로드 모달
// ════════════════════════════════════

function initUploadModal() {
    const uploadModal        = document.getElementById('uploadModal');
    const submitGameBtn      = document.getElementById('submitGame');
    const gameNameInput      = document.getElementById('gameName');
    const gameFileInput      = document.getElementById('gameFileInput');
    const thumbnailFileInput = document.getElementById('thumbnailFileInput');
    const tagSelector        = document.getElementById('tagSelector');
    const fileTypeTabs       = document.getElementById('fileTypeTabs');

    buildTagSelector(tagSelector);

    // ── 파일 타입 탭 전환 ──
    let selectedFileType = 'html';
    fileTypeTabs?.addEventListener('click', (e) => {
        const tab = e.target.closest('.file-type-tab');
        if (!tab) return;
        selectedFileType = tab.dataset.type;
        fileTypeTabs.querySelectorAll('.file-type-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        // accept 속성 변경
        if (selectedFileType === 'zip') {
            gameFileInput.accept = '.zip';
        } else {
            gameFileInput.accept = '.html';
        }
        gameFileInput.value = '';
        document.getElementById('gameFileName').textContent = '파일을 선택하세요';
    });

    if (DOM.uploadBtn) DOM.uploadBtn.onclick = () => {
        if (!currentUser) return alert('로그인이 필요합니다.');
        uploadModal.classList.add('active');
    };
    document.getElementById('closeUpload').onclick = () => uploadModal.classList.remove('active');

    if (!submitGameBtn) return;
    submitGameBtn.onclick = async () => {
        if (!currentUser) return alert('로그인이 필요합니다!');
        const name      = gameNameInput.value.trim();
        const tags      = getSelectedTags(tagSelector);
        const file      = gameFileInput.files[0];
        const thumbFile = thumbnailFileInput.files[0];
        if (!name || !file) return alert('게임 이름과 게임 파일은 필수입니다!');

        submitGameBtn.textContent = '업로드 중...';
        submitGameBtn.disabled    = true;
        try {
            // 파일명 sanitize: 한글·공백·특수문자 → _ (Storage key 오류 방지)
            const sanitizeName = (n) => n
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/[^\w.\-]/g, '_').replace(/_+/g, '_');

            const fileType = selectedFileType; // 'html' | 'zip'
            let gameUrl;

            if (fileType === 'zip') {
                // ── ZIP 업로드: 파일 그대로 Storage에 저장 ──
                const fileName = `${Date.now()}_${sanitizeName(file.name)}`;
                const { error: uploadErr } = await supabaseClient.storage
                    .from('game-files').upload(fileName, file, { contentType: 'application/zip', upsert: true });
                if (uploadErr) throw uploadErr;
                gameUrl = supabaseClient.storage.from('game-files').getPublicUrl(fileName).data.publicUrl;
            } else {
                // ── HTML 업로드 ──
                const htmlText = await file.text();
                const blob     = new Blob([htmlText], { type: 'text/html; charset=utf-8' });
                const fileName = `${Date.now()}_${sanitizeName(file.name)}`;
                const { error: uploadErr } = await supabaseClient.storage
                    .from('game-files').upload(fileName, blob, { contentType: 'text/html; charset=utf-8', upsert: true });
                if (uploadErr) throw uploadErr;
                gameUrl = supabaseClient.storage.from('game-files').getPublicUrl(fileName).data.publicUrl;
            }

            // ── 썸네일 ──
            let thumbUrl = null;
            if (thumbFile) {
                const thumbName = `${Date.now()}_thumb_${sanitizeName(thumbFile.name)}`;
                const { error: thumbErr } = await supabaseClient.storage
                    .from('game-files').upload(thumbName, thumbFile, { upsert: true });
                if (thumbErr) throw thumbErr;
                thumbUrl = supabaseClient.storage.from('game-files').getPublicUrl(thumbName).data.publicUrl;
            }

            const uploaderName = currentUser.user_metadata.custom_name
                || currentUser.user_metadata.preferred_username
                || currentUser.user_metadata.full_name || '게이머';

            const { error: dbErr } = await supabaseClient.from('games').insert([{
                name,
                file_url:        gameUrl,
                file_type:       fileType,
                thumbnail_url:   thumbUrl,
                tags,
                view_count:      0,
                upvotes:         0,
                user_id:         currentUser.id,
                uploader_name:   uploaderName,
                uploader_avatar: currentUser.user_metadata.custom_avatar
                    || currentUser.user_metadata.avatar_url || null,
            }]);
            if (dbErr) throw dbErr;

            alert('업로드 성공!');
            uploadModal.classList.remove('active');
            gameNameInput.value = '';
            clearTagSelector(tagSelector);
            gameFileInput.value = '';
            thumbnailFileInput.value = '';
            document.getElementById('gameFileName').textContent = '파일을 선택하세요';

            DOM.profileContent.style.display === 'block' ? fetchMyGames() : fetchGames();
        } catch (err) {
            alert('오류 발생: ' + err.message);
        } finally {
            submitGameBtn.textContent = 'Launch Game';
            submitGameBtn.disabled    = false;
        }
    };
}


// ════════════════════════════════════
//  수정 모달
// ════════════════════════════════════

function initEditModal() {
    const editModal      = document.getElementById('editModal');
    const submitEditGame = document.getElementById('submitEditGame');
    const editTagSelector = document.getElementById('editTagSelector');

    buildTagSelector(editTagSelector); // 공유 빌더 사용 ✅

    document.getElementById('closeEdit').onclick = () => editModal.classList.remove('active');

    if (!submitEditGame) return;
    submitEditGame.onclick = async () => {
        const newName = document.getElementById('editGameName').value.trim();
        const newTags = getSelectedTags(editTagSelector);
        if (!newName) return alert('게임 이름을 입력해주세요.');

        submitEditGame.disabled    = true;
        submitEditGame.textContent = '저장 중...';
        try {
            const { error } = await supabaseClient.from('games')
                .update({ name: newName, tags: newTags }).eq('id', editingGameId);
            if (error) throw error;
            alert('정보가 수정되었습니다.');
            editModal.classList.remove('active');
            fetchMyGames();
        } catch (err) {
            alert('수정 실패: ' + err.message);
        } finally {
            submitEditGame.disabled    = false;
            submitEditGame.textContent = '저장하기';
        }
    };
}

// ════════════════════════════════════
//  사이드바
// ════════════════════════════════════

function initSidebar() {
    const menuBtn     = document.getElementById('menuBtn');
    const sidebar     = document.getElementById('sidebar');
    const closeSidebar = document.getElementById('closeSidebar');
    if (!sidebar) return;

    menuBtn?.addEventListener('click',  () => sidebar.classList.add('active'));
    closeSidebar?.addEventListener('click', () => sidebar.classList.remove('active'));
    document.addEventListener('click', (e) => {
        if (sidebar.classList.contains('active')
            && !sidebar.contains(e.target)
            && !menuBtn?.contains(e.target)) {
            sidebar.classList.remove('active');
        }
    });
}

// ════════════════════════════════════
//  게임 플레이어 (닫기/전체화면)
// ════════════════════════════════════

// ════════════════════════════════════
//  게임 플레이어 (닫기/전체화면/맞추기)
// ════════════════════════════════════

function initPlayer() {
    const fullscreenBtn  = document.getElementById('fullscreenBtn');
    const exitFsFloatBtn = document.getElementById('exitFsFloatBtn');
    const fitBtn         = document.getElementById('fitBtn');
    const closePlayer    = document.getElementById('closePlayer');
    const playerModal    = document.querySelector('.player-modal');
    const modalOverlay   = document.getElementById('playerModal');

    // ── 스케일 상태 ──
    let currentScale = 1;

    // ── 게임 스케일 조정 ──
    // iframe 내부 콘텐츠가 컨테이너보다 넓을 때 자동/수동으로 축소
    function applyScale(scale) {
        const wrapper   = DOM.gameScaleWrapper;
        const frame     = DOM.gameFrame;
        const container = wrapper?.parentElement;
        if (!wrapper || !frame || !container) return;

        currentScale = scale;

        if (scale >= 1) {
            // 원본 크기
            wrapper.style.cssText = 'width:100%; height:100%; overflow:hidden;';
            frame.style.cssText   = 'width:100%; height:100%; border:none; background:#fff;';
            if (fitBtn) fitBtn.textContent = '⊡ 맞추기';
        } else {
            // 스케일 다운: wrapper를 실제 게임 픽셀 크기로 키우고 transform으로 축소
            const containerW = container.clientWidth;
            const containerH = container.clientHeight;
            const gameW = Math.round(containerW / scale);
            const gameH = Math.round(containerH / scale);

            wrapper.style.cssText = `
                width:${gameW}px;
                height:${gameH}px;
                transform:scale(${scale});
                transform-origin:top left;
                overflow:hidden;
                flex-shrink:0;
            `;
            frame.style.cssText = `
                width:100%;
                height:100%;
                border:none;
                background:#fff;
                display:block;
            `;
            if (fitBtn) fitBtn.textContent = `⊡ ${Math.round(scale * 100)}%`;
        }
    }

    // iframe 로드 후 콘텐츠 너비 자동 감지 (same-origin srcdoc 게임만 가능)
    function tryAutoScale() {
        const wrapper   = DOM.gameScaleWrapper;
        const frame     = DOM.gameFrame;
        const container = wrapper?.parentElement;
        if (!wrapper || !frame || !container) return;

        try {
            const doc = frame.contentDocument;
            if (!doc?.documentElement) return;

            const contentW = doc.documentElement.scrollWidth || doc.body?.scrollWidth || 0;
            const containerW = container.clientWidth;

            if (contentW > containerW + 8) {
                const scale = Math.max(0.3, containerW / contentW);
                applyScale(parseFloat(scale.toFixed(3)));
            }
        } catch {
            // cross-origin → 자동 감지 불가, 수동 맞추기 버튼 사용
        }
    }

    DOM.gameFrame?.addEventListener('load', () => {
        // 로드 후 약간 대기해서 게임이 DOM 초기화를 마치도록
        setTimeout(tryAutoScale, 400);
    });

    // 맞추기 버튼: 100% → 75% → 60% → 50% → 100% 순환
    const SCALE_STEPS = [1, 0.75, 0.6, 0.5];
    fitBtn?.addEventListener('click', () => {
        const idx      = SCALE_STEPS.indexOf(currentScale);
        const nextScale = SCALE_STEPS[(idx + 1) % SCALE_STEPS.length];
        applyScale(nextScale);
    });

    // ── 전체화면 ──
    const isMobileLike = () =>
        window.matchMedia('(pointer: coarse)').matches ||
        navigator.maxTouchPoints > 0 ||
        !document.fullscreenEnabled;

    function enterPseudoFullscreen() {
        playerModal?.classList.add('pseudo-fullscreen');
        modalOverlay?.classList.add('pseudo-fullscreen-overlay');
        if (fullscreenBtn)  fullscreenBtn.textContent  = '전체화면';
        if (exitFsFloatBtn) exitFsFloatBtn.style.display = 'flex';
    }

    function exitPseudoFullscreen() {
        playerModal?.classList.remove('pseudo-fullscreen');
        modalOverlay?.classList.remove('pseudo-fullscreen-overlay');
        if (fullscreenBtn)  fullscreenBtn.textContent    = '전체화면';
        if (exitFsFloatBtn) exitFsFloatBtn.style.display = 'none';
    }

    fullscreenBtn?.addEventListener('click', () => {
        if (isMobileLike()) {
            playerModal?.classList.contains('pseudo-fullscreen')
                ? exitPseudoFullscreen()
                : enterPseudoFullscreen();
        } else {
            if (!document.fullscreenElement) {
                const target = document.querySelector('.game-frame-container') || DOM.gameFrame;
                (target.requestFullscreen || target.webkitRequestFullscreen)?.call(target);
            } else {
                (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
            }
        }
    });

    // 플로팅 해제 버튼 (pseudo-fullscreen 중 항상 보임)
    exitFsFloatBtn?.addEventListener('click', exitPseudoFullscreen);

    // 데스크탑 전체화면 Esc 감지
    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement && fullscreenBtn) {
            fullscreenBtn.textContent = '전체화면';
        }
    });

    // ── 닫기 ──
    function closePlayerModal() {
        exitPseudoFullscreen();
        applyScale(1);
        currentScale = 1;
        DOM.playerModal.classList.remove('active');
        document.body.style.overflow = '';
        DOM.gameFrame.srcdoc = '';
        DOM.gameFrame.src    = '';
        DOM.gameFrame.style.display = 'none';
        if (DOM.deleteGameBtn) DOM.deleteGameBtn.style.display = 'none';
    }

    closePlayer?.addEventListener('click', closePlayerModal);

    // Android 뒤로가기 처리
    window.addEventListener('popstate', () => {
        if (playerModal?.classList.contains('pseudo-fullscreen')) {
            exitPseudoFullscreen();
        }
    });
}

// ════════════════════════════════════
//  파일 입력 레이블
// ════════════════════════════════════

function initFileInputs() {
    [['gameFileInput','gameFileName'], ['thumbnailFileInput','thumbnailFileName']].forEach(([inputId, labelId]) => {
        const input = document.getElementById(inputId);
        const label = document.getElementById(labelId);
        if (input && label) input.onchange = e => { label.textContent = e.target.files[0]?.name || ''; };
    });
}

// ════════════════════════════════════
//  검색 디바운스
// ════════════════════════════════════

function initSearch() {
    if (!DOM.searchInput) return;
    let timer;
    DOM.searchInput.addEventListener('input', (e) => {
        clearTimeout(timer);
        timer = setTimeout(() => fetchGames(e.target.value.trim(), currentTag), 300);
    });
}

// ════════════════════════════════════
//  모바일 가상 D-pad
// ════════════════════════════════════

const KEY_CODES = { ArrowUp:38, ArrowDown:40, ArrowLeft:37, ArrowRight:39, Space:32, Enter:13, Escape:27 };

function initDpad() {
    if (!DOM.dpadOverlay || !DOM.gameFrame) return;
    const isTouch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    if (!isTouch) return;
    DOM.dpadOverlay.classList.add('active');

    function sendKey(type, key, code) {
        try {
            const opts = { key, code, keyCode: KEY_CODES[code] || 0, bubbles: true, cancelable: true };
            DOM.gameFrame.contentWindow?.dispatchEvent(new KeyboardEvent(type, opts));
            DOM.gameFrame.contentWindow?.document.dispatchEvent(new KeyboardEvent(type, opts));
        } catch (_) { /* cross-origin 무시 */ }
    }

    DOM.dpadOverlay.querySelectorAll('[data-key]').forEach(btn => {
        const { key, code } = btn.dataset;
        const press   = e => { e.preventDefault(); btn.classList.add('pressed');    sendKey('keydown', key, code); };
        const release = e => { e.preventDefault(); btn.classList.remove('pressed'); sendKey('keyup',   key, code); };
        btn.addEventListener('touchstart',  press,   { passive: false });
        btn.addEventListener('touchend',    release, { passive: false });
        btn.addEventListener('touchcancel', release, { passive: false });
        btn.addEventListener('mousedown',   press);
        btn.addEventListener('mouseup',     release);
        btn.addEventListener('mouseleave',  release);
    });
}

// ════════════════════════════════════
//  프로필 아바타 업로드
// ════════════════════════════════════

async function uploadAvatar(file) {
    if (!currentUser) throw new Error('로그인이 필요합니다.');
    const ext      = file.name.split('.').pop();
    const fileName = `avatars/${currentUser.id}_${Date.now()}.${ext}`;

    const { error: upErr } = await supabaseClient.storage
        .from('game-files').upload(fileName, file, { upsert: true });
    if (upErr) throw upErr;

    const { data: { publicUrl } } = supabaseClient.storage.from('game-files').getPublicUrl(fileName);

    const { data, error: metaErr } = await supabaseClient.auth.updateUser({ data: { custom_avatar: publicUrl } });
    if (metaErr) throw metaErr;

    if (DOM.profileAvatar) DOM.profileAvatar.src = publicUrl;
    if (DOM.avatarPreview) DOM.avatarPreview.src = publicUrl;

    // 게임 목록 아바타 동기화 (백그라운드)
    supabaseClient.from('games').update({ uploader_avatar: publicUrl })
        .eq('user_id', currentUser.id)
        .then(({ error }) => { if (error) console.warn('아바타 동기화 실패:', error.message); });

    updateAuthUI(data.user);
    return publicUrl;
}

function initProfileAvatar() {
    const headerTrigger = document.getElementById('avatarUploadTrigger');
    const headerInput   = document.getElementById('avatarFileInputHeader');
    const headerOverlay = headerTrigger?.querySelector('.avatar-edit-overlay');

    if (headerTrigger && headerInput) {
        headerTrigger.addEventListener('click', () => headerInput.click());
        headerInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file || !currentUser) return;
            if (headerOverlay) headerOverlay.textContent = '업로드 중...';
            try {
                await uploadAvatar(file);
                alert('프로필 사진이 변경되었습니다! 🎉');
            } catch (err) {
                alert('업로드 실패: ' + err.message);
            } finally {
                if (headerOverlay) headerOverlay.textContent = '사진 변경';
                headerInput.value = '';
            }
        });
    }

    const pickBtn   = document.getElementById('avatarPickBtn');
    const fileInput = document.getElementById('avatarFileInput');
    let selectedFile = null;

    pickBtn?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', (e) => {
        selectedFile = e.target.files[0];
        if (!selectedFile) return;
        const reader = new FileReader();
        reader.onload = ev => { if (DOM.avatarPreview) DOM.avatarPreview.src = ev.target.result; };
        reader.readAsDataURL(selectedFile);
    });

    const saveBtn = document.getElementById('saveAvatarBtn');
    saveBtn?.addEventListener('click', async () => {
        if (!selectedFile) return alert('먼저 사진을 선택해주세요.');
        if (!currentUser) return alert('로그인이 필요합니다.');
        saveBtn.disabled    = true;
        saveBtn.textContent = '저장 중...';
        try {
            await uploadAvatar(selectedFile);
            selectedFile = null;
            if (fileInput) fileInput.value = '';
            alert('프로필 사진이 저장되었습니다! 🎉');
        } catch (err) {
            alert('업로드 실패: ' + err.message);
        } finally {
            saveBtn.disabled    = false;
            saveBtn.textContent = '저장하기';
        }
    });
}
