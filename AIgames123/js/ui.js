const PRESET_TAGS = [
    'Action','Adventure','RPG','FPS','Puzzle',
    'Strategy','Simulation','Sports','Horror','Racing',
    'Platform','Arcade','Card','Board','Idle',
    'Casual','Shooter','Fighting','Survival','Music',
];

// ════════════════════════════════════
//  Shared tag-selector builder (no code duplication)
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
//  Upload modal
// ════════════════════════════════════

function initUploadModal() {
    const uploadModal        = document.getElementById('uploadModal');
    const submitGameBtn      = document.getElementById('submitGame');
    const gameNameInput      = document.getElementById('gameName');
    const gameDescInput      = document.getElementById('gameDescription_upload');   // NEW
    const gameFileInput      = document.getElementById('gameFileInput');
    const thumbnailFileInput = document.getElementById('thumbnailFileInput');
    const tagSelector        = document.getElementById('tagSelector');
    const fileTypeTabs       = document.getElementById('fileTypeTabs');

    buildTagSelector(tagSelector);

    // File-type tab switching
    let selectedFileType = 'html';
    fileTypeTabs?.addEventListener('click', (e) => {
        const tab = e.target.closest('.file-type-tab');
        if (!tab) return;
        selectedFileType = tab.dataset.type;
        fileTypeTabs.querySelectorAll('.file-type-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        gameFileInput.accept = selectedFileType === 'zip' ? '.zip' : '.html';
        gameFileInput.value = '';
        document.getElementById('gameFileName').textContent = 'Select a file';
    });

    if (DOM.uploadBtn) DOM.uploadBtn.onclick = () => {
        if (!currentUser) { notify.warn('Please log in first.'); return; }
        uploadModal.classList.add('active');
    };
    document.getElementById('closeUpload').onclick = () => uploadModal.classList.remove('active');

    if (!submitGameBtn) return;
    submitGameBtn.onclick = async () => {
        if (!currentUser) { notify.warn('Please log in first.'); return; }
        const name        = gameNameInput.value.trim();
        const description = (gameDescInput?.value || '').trim();   // NEW
        const tags        = getSelectedTags(tagSelector);
        const file        = gameFileInput.files[0];
        let thumbFile     = thumbnailFileInput.files[0];
        if (!name || !file) { notify.warn('Game name and game file are required.'); return; }

        // ════════════════════════════════════════════════════════
        // Input validation (client-side; matched by Storage policies)
        // ════════════════════════════════════════════════════════
        if (name.length > SECURITY.MAX_GAME_NAME_LEN) {
            notify.warn(`Game name is too long (max ${SECURITY.MAX_GAME_NAME_LEN} chars).`); return;
        }
        if (/[\x00-\x1f]/.test(name)) {
            notify.warn('Game name contains invalid characters.'); return;
        }
        if (description.length > SECURITY.MAX_DESCRIPTION_LEN) {
            notify.warn(`Description is too long (max ${SECURITY.MAX_DESCRIPTION_LEN} characters).`); return;
        }
        if (tags.length > SECURITY.MAX_TAG_LIST_LEN) {
            notify.warn('Too many tags selected.'); return;
        }

        // File-size cap: Supabase Storage will also enforce its own bucket
        // limit, but rejecting client-side gives a better error than a 413.
        if (file.size > SECURITY.MAX_GAME_FILE_BYTES) {
            notify.warn(`Game file is too large (max ${SECURITY.MAX_GAME_FILE_BYTES / 1024 / 1024} MB).`); return;
        }

        // File-type vs extension consistency check — defense in depth.
        // (The actual bytes are what get served; this just catches typos.)
        const ext = file.name.toLowerCase().split('.').pop();
        if (selectedFileType === 'zip' && ext !== 'zip') {
            notify.warn('Selected file type is ZIP, but the file is not a .zip.'); return;
        }
        if (selectedFileType === 'html' && ext !== 'html' && ext !== 'htm') {
            notify.warn('Selected file type is HTML, but the file is not an .html.'); return;
        }

        if (thumbFile) {
            if (thumbFile.size > SECURITY.MAX_THUMB_BYTES) {
                notify.warn(`Thumbnail is too large (max ${SECURITY.MAX_THUMB_BYTES / 1024 / 1024} MB).`); return;
            }
            // Verify magic bytes — `accept="image/*"` is trivially bypassable
            // by spoofing the Content-Type header.
            const ok = await isRealImageFile(thumbFile);
            if (!ok) { notify.warn('Thumbnail must be a real PNG, JPEG, GIF, or WebP image.'); return; }

            // Compress: scales down to ≤800x800 and re-encodes as WebP at q=0.85.
            // Animated GIFs are passed through unchanged. Tiny files are skipped.
            // If compression fails (browser limit / unsupported codec) the
            // original is used.
            const compressed = await compressImage(thumbFile, 'thumbnail');
            if (compressed !== thumbFile) {
                const saved = ((1 - compressed.size / thumbFile.size) * 100).toFixed(0);
                console.info(`Thumbnail compressed: ${thumbFile.size} → ${compressed.size} bytes (${saved}% smaller)`);
                thumbFile = compressed;
            }
        }

        submitGameBtn.textContent = 'Uploading...';
        submitGameBtn.disabled    = true;
        try {
            // Filename sanitization: strip diacritics & non-word chars to avoid Storage-key errors
            const sanitizeName = (n) => n
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/[^\w.\-]/g, '_').replace(/_+/g, '_');

            const fileType = selectedFileType; // 'html' | 'zip'
            let gameUrl;

            // cacheControl: 31536000 seconds = 1 year. Files keyed by
            // `${timestamp}_${sanitizedName}` are immutable in practice
            // (uploader can edit metadata but not replace the file), so
            // browsers and Supabase's CDN can cache them indefinitely.
            // This drastically cuts Storage egress: repeat plays of the
            // same game by the same user hit cache, not the origin.
            const STORAGE_CACHE = { cacheControl: '31536000', upsert: true };

            if (fileType === 'zip') {
                // ZIP upload: stored as-is
                const fileName = `${Date.now()}_${sanitizeName(file.name)}`;
                const { error: uploadErr } = await supabaseClient.storage
                    .from('game-files').upload(fileName, file, { ...STORAGE_CACHE, contentType: 'application/zip' });
                if (uploadErr) throw uploadErr;
                // Rewrite the Supabase storage URL to our CDN domain so all
                // future loads go through the cache instead of origin.
                gameUrl = toCdnUrl(
                    supabaseClient.storage.from('game-files').getPublicUrl(fileName).data.publicUrl
                );
            } else {
                // HTML upload
                const htmlText = await file.text();
                const blob     = new Blob([htmlText], { type: 'text/html; charset=utf-8' });
                const fileName = `${Date.now()}_${sanitizeName(file.name)}`;
                const { error: uploadErr } = await supabaseClient.storage
                    .from('game-files').upload(fileName, blob, { ...STORAGE_CACHE, contentType: 'text/html; charset=utf-8' });
                if (uploadErr) throw uploadErr;
                gameUrl = toCdnUrl(
                    supabaseClient.storage.from('game-files').getPublicUrl(fileName).data.publicUrl
                );
            }

            // Thumbnail
            let thumbUrl = null;
            if (thumbFile) {
                const thumbName = `${Date.now()}_thumb_${sanitizeName(thumbFile.name)}`;
                const { error: thumbErr } = await supabaseClient.storage
                    .from('game-files').upload(thumbName, thumbFile, STORAGE_CACHE);
                if (thumbErr) throw thumbErr;
                thumbUrl = toCdnUrl(
                    supabaseClient.storage.from('game-files').getPublicUrl(thumbName).data.publicUrl
                );
            }

            const m = currentUser.user_metadata || {};
            const uploaderName = m.custom_name || m.preferred_username || m.full_name || 'Gamer';

            const { error: dbErr } = await supabaseClient.from('games').insert([{
                name,
                description:     description || null,
                file_url:        gameUrl,
                file_type:       fileType,
                thumbnail_url:   thumbUrl,
                tags,
                view_count:      0,
                upvotes:         0,
                user_id:         currentUser.id,
                uploader_name:   uploaderName,
                uploader_avatar: m.custom_avatar || m.avatar_url || null,
            }]);
            if (dbErr) throw dbErr;

            notify.success('Upload successful! 🎉');
            uploadModal.classList.remove('active');
            gameNameInput.value = '';
            if (gameDescInput) gameDescInput.value = '';
            clearTagSelector(tagSelector);
            gameFileInput.value = '';
            thumbnailFileInput.value = '';
            document.getElementById('gameFileName').textContent = 'Select a file';

            // Invalidate tag cache — new tags may have been added
            cache.invalidateTags();

            DOM.profileContent.style.display === 'block' ? fetchMyGames() : fetchGames();
        } catch (err) {
            notify.error(friendlyError(err, 'Upload failed.'), err);
        } finally {
            submitGameBtn.textContent = 'Launch Game';
            submitGameBtn.disabled    = false;
        }
    };
}


// ════════════════════════════════════
//  Edit modal
// ════════════════════════════════════

function initEditModal() {
    const editModal       = document.getElementById('editModal');
    const submitEditGame  = document.getElementById('submitEditGame');
    const editTagSelector = document.getElementById('editTagSelector');

    buildTagSelector(editTagSelector);

    document.getElementById('closeEdit').onclick = () => editModal.classList.remove('active');

    if (!submitEditGame) return;
    submitEditGame.onclick = async () => {
        const newName = document.getElementById('editGameName').value.trim();
        const newDesc = (document.getElementById('editGameDescription')?.value || '').trim();
        const newTags = getSelectedTags(editTagSelector);
        if (!newName) { notify.warn('Please enter a game name.'); return; }
        if (newDesc.length > SECURITY.MAX_DESCRIPTION_LEN) {
            notify.warn(`Description is too long (max ${SECURITY.MAX_DESCRIPTION_LEN} characters).`);
            return;
        }

        submitEditGame.disabled    = true;
        submitEditGame.textContent = 'Saving...';
        try {
            const { error } = await supabaseClient.from('games')
                .update({
                    name: newName,
                    description: newDesc || null,
                    tags: newTags,
                })
                .eq('id', editingGameId);
            if (error) throw error;
            notify.success('Changes saved.');
            editModal.classList.remove('active');
            cache.invalidateTags();   // tag list may have changed
            fetchMyGames();
        } catch (err) {
            notify.error(friendlyError(err, 'Could not save changes.'), err);
        } finally {
            submitEditGame.disabled    = false;
            submitEditGame.textContent = 'Save';
        }
    };
}

// ════════════════════════════════════
//  Sidebar
// ════════════════════════════════════

function initSidebar() {
    const menuBtn      = document.getElementById('menuBtn');
    const sidebar      = document.getElementById('sidebar');
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
//  Game player (close / fullscreen / fit)
// ════════════════════════════════════

function initPlayer() {
    const fullscreenBtn  = document.getElementById('fullscreenBtn');
    const exitFsFloatBtn = document.getElementById('exitFsFloatBtn');
    const fitBtn         = document.getElementById('fitBtn');
    const closePlayer    = document.getElementById('closePlayer');
    const playerModal    = document.querySelector('.player-modal');
    const modalOverlay   = document.getElementById('playerModal');

    // Scale state
    let currentScale = 1;

    // Scale-adjust helper: when iframe content is wider than container,
    // scale down via CSS transform.
    //
    // Important: at scale = 1 we COMPLETELY clear the wrapper's and frame's
    // inline styles by setting them to ''. This lets the stylesheet
    // (`.game-scale-wrapper { width: 100%; height: 100% }` etc.) and any
    // active CSS rules (like `:fullscreen { ... !important }`) take over
    // unimpeded. Setting inline cssText to a string like 'width:100%' would
    // create plain inline styles that fight the !important rules during
    // fullscreen transitions.
    function applyScale(scale) {
        const wrapper   = DOM.gameScaleWrapper;
        const frame     = DOM.gameFrame;
        const container = wrapper?.parentElement;
        if (!wrapper || !frame || !container) return;

        currentScale = scale;

        if (scale >= 1) {
            // Hand sizing entirely back to CSS by clearing all inline styles
            wrapper.removeAttribute('style');
            frame.removeAttribute('style');
            // Make sure the iframe is visible (closePlayerModal sets it to none
            // when the modal closes, so we re-enable it whenever a game is shown)
            frame.style.display = 'block';
            if (fitBtn) fitBtn.textContent = '⊡ Fit';
        } else {
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

    // Auto-scale based on iframe content dimensions — fits the game
    // to the container by BOTH width and height. On mobile portrait,
    // many games are designed for landscape and would otherwise overflow
    // vertically; this picks the smaller scale factor of the two.
    function tryAutoScale() {
        const wrapper   = DOM.gameScaleWrapper;
        const frame     = DOM.gameFrame;
        const container = wrapper?.parentElement;
        if (!wrapper || !frame || !container) return;

        // When the container is in native fullscreen, CSS rules take over
        // sizing the game to fill the viewport (see :fullscreen rules in
        // component.css). Running our JS-based scaling here would fight
        // those rules and cause the game to render as a tiny rectangle.
        if (document.fullscreenElement === container ||
            document.webkitFullscreenElement === container) {
            return;
        }

        try {
            const doc = frame.contentDocument;
            if (!doc?.documentElement) return;

            const contentW = doc.documentElement.scrollWidth  || doc.body?.scrollWidth  || 0;
            const contentH = doc.documentElement.scrollHeight || doc.body?.scrollHeight || 0;
            const containerW = container.clientWidth;
            const containerH = container.clientHeight;

            // No content size yet — game is still bootstrapping
            if (contentW < 50 || contentH < 50) return;
            // Defensive: container hasn't been laid out yet (mid-transition)
            if (containerW < 50 || containerH < 50) return;

            const widthScale  = containerW / contentW;
            const heightScale = containerH / contentH;
            // Use the smaller of the two so the game fits without overflow.
            // Cap at 1× — never upscale (avoids blurry pixel-art games).
            const scale = Math.min(widthScale, heightScale, 1);

            // Only act if scaling is actually needed (>5% mismatch)
            if (scale < 0.95) {
                applyScale(parseFloat(Math.max(0.3, scale).toFixed(3)));
            }
        } catch {
            // cross-origin: cannot auto-measure, user can press the Fit button
        }
    }

    DOM.gameFrame?.addEventListener('load', () => {
        // Slight delay so the game can finish its own DOM init first
        setTimeout(tryAutoScale, 400);
    });

    // Re-fit on orientation change / window resize. Debounce long enough
    // that fullscreen enter/exit (which fires `resize`) has time for the
    // layout to settle before we measure. The dedicated fullscreenchange
    // handler does the recovery on fullscreen exits, so we suppress this
    // listener briefly around fullscreen transitions to avoid two
    // competing rescales fighting each other.
    let _resizeTimer = null;
    let _suppressResizeUntil = 0;
    window.addEventListener('resize', () => {
        if (!DOM.playerModal?.classList.contains('active')) return;
        // Don't re-scale while in native fullscreen — CSS handles sizing.
        if (document.fullscreenElement || document.webkitFullscreenElement) return;
        // Skip if we just exited fullscreen — the dedicated handler is on it.
        if (Date.now() < _suppressResizeUntil) return;
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(() => {
            applyScale(1);
            tryAutoScale();
        }, 300);
    });

    // Fit button cycle: 100% → 75% → 60% → 50% → 100%
    const SCALE_STEPS = [1, 0.75, 0.6, 0.5];
    fitBtn?.addEventListener('click', () => {
        const idx       = SCALE_STEPS.indexOf(currentScale);
        const nextScale = SCALE_STEPS[(idx + 1) % SCALE_STEPS.length];
        applyScale(nextScale);
    });

    // Fullscreen
    const isMobileLike = () =>
        window.matchMedia('(pointer: coarse)').matches ||
        navigator.maxTouchPoints > 0 ||
        !document.fullscreenEnabled;

    function enterPseudoFullscreen() {
        playerModal?.classList.add('pseudo-fullscreen');
        modalOverlay?.classList.add('pseudo-fullscreen-overlay');
        if (fullscreenBtn)  fullscreenBtn.textContent    = 'Fullscreen';
        if (exitFsFloatBtn) exitFsFloatBtn.style.display = 'flex';
        // Container size just changed dramatically — re-fit the game.
        setTimeout(() => { applyScale(1); tryAutoScale(); }, 80);
    }

    function exitPseudoFullscreen() {
        playerModal?.classList.remove('pseudo-fullscreen');
        modalOverlay?.classList.remove('pseudo-fullscreen-overlay');
        if (fullscreenBtn)  fullscreenBtn.textContent    = 'Fullscreen';
        if (exitFsFloatBtn) exitFsFloatBtn.style.display = 'none';
        setTimeout(() => { applyScale(1); tryAutoScale(); }, 80);
    }

    fullscreenBtn?.addEventListener('click', () => {
        if (isMobileLike()) {
            playerModal?.classList.contains('pseudo-fullscreen')
                ? exitPseudoFullscreen()
                : enterPseudoFullscreen();
        } else {
            if (!document.fullscreenElement) {
                // Reset any active CSS scale transform BEFORE entering
                // fullscreen — the CSS :fullscreen rules will then take
                // over sizing with a clean slate. Without this, the
                // wrapper keeps inline width/height from the pre-FS
                // container dimensions and renders as a tiny rectangle
                // on a black fullscreen background.
                applyScale(1);
                const target = document.querySelector('.game-frame-container') || DOM.gameFrame;
                const req = target.requestFullscreen || target.webkitRequestFullscreen;
                req?.call(target).catch(err => {
                    notify.error(friendlyError(err, 'Fullscreen failed.'), err);
                });
            } else {
                (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
            }
        }
    });

    exitFsFloatBtn?.addEventListener('click', exitPseudoFullscreen);

    function recoverFromFullscreenExit() {
        // Suppress the resize handler for a moment so it doesn't fight
        // this recovery sequence (resize also fires on fullscreen exit).
        _suppressResizeUntil = Date.now() + 1000;
        // Clear inline styles immediately so the stylesheet rules can take
        // over for sizing as the browser unwinds the fullscreen layout.
        applyScale(1);
        // Two frames + a buffer to let layout fully reflow.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            // Snap to clean state one more time after layout has settled.
            applyScale(1);
            // Only THEN consider auto-scaling. Skip if iframe content
            // unavailable (cross-origin) or container is still mid-reflow.
            setTimeout(tryAutoScale, 200);
        }));
    }

    document.addEventListener('fullscreenchange', () => {
        const inFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
        if (fullscreenBtn) {
            fullscreenBtn.textContent = inFs ? 'Exit FS' : 'Fullscreen';
        }
        if (!inFs) recoverFromFullscreenExit();
    });
    // Safari/older WebKit uses the prefixed event name
    document.addEventListener('webkitfullscreenchange', () => {
        const inFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
        if (!inFs) recoverFromFullscreenExit();
    });

    // Close player — also revokes blob URLs from ZIP loader (memory leak fix)
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
        if (typeof _revokePlayerBlobUrls === 'function') _revokePlayerBlobUrls();
    }

    closePlayer?.addEventListener('click', closePlayerModal);

    // Android back-button handling
    window.addEventListener('popstate', () => {
        if (playerModal?.classList.contains('pseudo-fullscreen')) {
            exitPseudoFullscreen();
        }
    });
}

// ════════════════════════════════════
//  File input labels
// ════════════════════════════════════

function initFileInputs() {
    [['gameFileInput','gameFileName'], ['thumbnailFileInput','thumbnailFileName']].forEach(([inputId, labelId]) => {
        const input = document.getElementById(inputId);
        const label = document.getElementById(labelId);
        if (input && label) input.onchange = e => { label.textContent = e.target.files[0]?.name || ''; };
    });
}

// ════════════════════════════════════
//  Search debounce
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
//  Mobile virtual D-pad
//  — uses Pointer Events to unify mouse + touch in 3 listeners per button
//    instead of the original 5 (touchstart/touchend/touchcancel/
//    mousedown/mouseup/mouseleave).
// ════════════════════════════════════

const KEY_CODES = { ArrowUp:38, ArrowDown:40, ArrowLeft:37, ArrowRight:39, Space:32, Enter:13, Escape:27 };

// ════════════════════════════════════
//  Virtual analog joystick
//
//  Pointer-driven knob inside a circular base. Maps the stick's
//  displacement vector to arrow-key events so games designed for
//  keyboard input "just work" with the joystick.
//
//  Behavior:
//   • Touch the base anywhere → stick jumps to that point (instant start)
//   • Drag → stick follows finger, clamped within base radius
//   • Release → stick eases back to center, all keys released
//   • A direction key fires when displacement passes DEAD_ZONE (35%)
//     and releases when it drops back below it. Diagonals fire both.
// ════════════════════════════════════
function initJoystick() {
    const base  = document.getElementById('joystickBase');
    const stick = document.getElementById('joystickStick');
    if (!base || !stick || !DOM.gameFrame) return;
    const isTouch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    if (!isTouch) return;

    const DEAD_ZONE = 0.35;   // 0–1 fraction of max radius before a direction is "on"
    const MAX_RATIO = 0.65;   // stick can travel up to this fraction of base radius

    let activePointerId = null;
    let baseRect = null;       // cached on pointerdown for fast updates
    const heldKeys = new Set(); // {'ArrowUp','ArrowLeft',…} currently pressed

    function sendKey(type, key) {
        try {
            const opts = { key, code: key, keyCode: KEY_CODES[key] || 0, bubbles: true, cancelable: true };
            DOM.gameFrame.contentWindow?.dispatchEvent(new KeyboardEvent(type, opts));
            DOM.gameFrame.contentWindow?.document.dispatchEvent(new KeyboardEvent(type, opts));
        } catch (_) { /* cross-origin — ignore */ }
    }

    function setKey(key, shouldBeDown) {
        const isDown = heldKeys.has(key);
        if (shouldBeDown && !isDown) { heldKeys.add(key);    sendKey('keydown', key); }
        else if (!shouldBeDown && isDown) { heldKeys.delete(key); sendKey('keyup',   key); }
    }

    function releaseAllKeys() {
        for (const k of Array.from(heldKeys)) setKey(k, false);
    }

    function updateStick(clientX, clientY) {
        if (!baseRect) return;
        const cx = baseRect.left + baseRect.width  / 2;
        const cy = baseRect.top  + baseRect.height / 2;
        const radius = baseRect.width / 2;
        const maxDist = radius * MAX_RATIO;

        let dx = clientX - cx;
        let dy = clientY - cy;
        const dist = Math.hypot(dx, dy);

        // Clamp to maxDist
        if (dist > maxDist) {
            const k = maxDist / dist;
            dx *= k; dy *= k;
        }

        stick.style.transform = `translate(${dx}px, ${dy}px)`;

        // Compute normalized displacement (0–1)
        const nx = dx / maxDist;
        const ny = dy / maxDist;

        // Update key states — fire opposing directions independently so
        // diagonal input (up+right etc.) works naturally.
        setKey('ArrowLeft',  nx < -DEAD_ZONE);
        setKey('ArrowRight', nx >  DEAD_ZONE);
        setKey('ArrowUp',    ny < -DEAD_ZONE);
        setKey('ArrowDown',  ny >  DEAD_ZONE);
    }

    base.addEventListener('pointerdown', (e) => {
        if (activePointerId !== null) return;
        e.preventDefault();
        activePointerId = e.pointerId;
        baseRect = base.getBoundingClientRect();
        base.setPointerCapture(e.pointerId);
        base.classList.add('active');
        updateStick(e.clientX, e.clientY);
    });

    base.addEventListener('pointermove', (e) => {
        if (e.pointerId !== activePointerId) return;
        e.preventDefault();
        updateStick(e.clientX, e.clientY);
    });

    const endDrag = (e) => {
        if (e.pointerId !== activePointerId) return;
        activePointerId = null;
        baseRect = null;
        base.classList.remove('active');
        stick.style.transform = '';   // snap back to center via CSS transition
        releaseAllKeys();
    };
    base.addEventListener('pointerup',     endDrag);
    base.addEventListener('pointercancel', endDrag);
    base.addEventListener('pointerleave',  endDrag);
}

function initDpad() {
    if (!DOM.dpadOverlay || !DOM.gameFrame) return;
    const isTouch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    if (!isTouch) return;
    DOM.dpadOverlay.classList.add('active');

    // ════════════════════════════════════════════════════════
    // Controller toggle button — cycles through three modes:
    //   1. dpad      — show D-pad        (icon: 🎮 → next is joystick)
    //   2. joystick  — show joystick     (icon: 🕹️ → next is hidden)
    //   3. hidden    — controller hidden (icon: ⊘ → next is dpad)
    // The user's choice persists across the session via localStorage.
    // ════════════════════════════════════════════════════════
    const toggleBtn = document.getElementById('dpadToggleBtn');
    if (toggleBtn) {
        toggleBtn.classList.add('visible');

        const STORAGE_KEY = 'controllerMode';
        const MODES = ['dpad', 'joystick', 'hidden'];
        const ICONS = { dpad: '🎮', joystick: '🕹️', hidden: '⊘' };
        const LABELS = {
            dpad:     'Controller: D-pad (tap for joystick)',
            joystick: 'Controller: joystick (tap to hide)',
            hidden:   'Controller hidden (tap to show D-pad)',
        };

        let mode = 'dpad';
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (MODES.includes(saved)) mode = saved;
        } catch (_) {}

        const applyMode = (m) => {
            DOM.dpadOverlay.classList.toggle('hidden',        m === 'hidden');
            DOM.dpadOverlay.classList.toggle('show-joystick', m === 'joystick');
            toggleBtn.textContent = ICONS[m];
            toggleBtn.title       = LABELS[m];
            toggleBtn.setAttribute('aria-label', LABELS[m]);
        };
        applyMode(mode);

        toggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
            try { localStorage.setItem(STORAGE_KEY, mode); } catch (_) {}
            applyMode(mode);
        });
    }

    function sendKey(type, key, code) {
        try {
            const opts = { key, code, keyCode: KEY_CODES[code] || 0, bubbles: true, cancelable: true };
            DOM.gameFrame.contentWindow?.dispatchEvent(new KeyboardEvent(type, opts));
            DOM.gameFrame.contentWindow?.document.dispatchEvent(new KeyboardEvent(type, opts));
        } catch (_) { /* cross-origin — ignore */ }
    }

    // Delegate pointer events on the overlay for single-listener efficiency
    const pressed = new Map();  // pointerId → btn

    DOM.dpadOverlay.addEventListener('pointerdown', (e) => {
        const btn = e.target.closest('[data-key]');
        if (!btn) return;
        e.preventDefault();
        btn.setPointerCapture?.(e.pointerId);
        btn.classList.add('pressed');
        pressed.set(e.pointerId, btn);
        sendKey('keydown', btn.dataset.key, btn.dataset.code);
    });

    const release = (e) => {
        const btn = pressed.get(e.pointerId);
        if (!btn) return;
        btn.classList.remove('pressed');
        sendKey('keyup', btn.dataset.key, btn.dataset.code);
        pressed.delete(e.pointerId);
    };

    DOM.dpadOverlay.addEventListener('pointerup',     release);
    DOM.dpadOverlay.addEventListener('pointercancel', release);
    DOM.dpadOverlay.addEventListener('pointerleave',  release);
}

// ════════════════════════════════════
//  Profile avatar upload
// ════════════════════════════════════

async function uploadAvatar(file) {
    if (!currentUser) throw new Error('You need to be logged in.');

    // ════════════════════════════════════════════════════════
    // Validate: real image (magic bytes), size cap, safe extension.
    // The `accept="image/*"` attribute on the input is trivially
    // bypassable, so all three checks happen JS-side regardless.
    // ════════════════════════════════════════════════════════
    if (file.size > SECURITY.MAX_AVATAR_BYTES) {
        throw new Error(`Avatar is too large (max ${SECURITY.MAX_AVATAR_BYTES / 1024 / 1024} MB).`);
    }
    const ok = await isRealImageFile(file);
    if (!ok) throw new Error('Avatar must be a real PNG, JPEG, GIF, or WebP image.');

    // Compress avatar: 256×256 max, WebP. Saves a lot of bandwidth
    // since avatars render at small sizes throughout the site.
    // Animated GIF avatars pass through unchanged.
    const compressed = await compressImage(file, 'avatar');
    const uploadFile = compressed;
    if (compressed !== file) {
        console.info(`Avatar compressed: ${file.size} → ${compressed.size} bytes`);
    }

    // Whitelist extension — the storage key must not contain attacker-controlled
    // characters that could land in a Storage URL path. (Same rationale as
    // sanitizeName in the game-upload flow.) Pick based on the compressed
    // file's MIME, not the original name.
    const MIME_EXT = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' };
    const ext      = MIME_EXT[uploadFile.type] || 'webp';
    const fileName = `avatars/${currentUser.id}_${Date.now()}.${ext}`;

    const { error: upErr } = await supabaseClient.storage
        .from('game-files').upload(fileName, uploadFile, {
            upsert: true,
            contentType: uploadFile.type || 'image/webp',
            cacheControl: '31536000',   // 1 year browser/CDN cache; new uploads use a fresh timestamped key
        });
    if (upErr) throw upErr;

    const { data: { publicUrl } } = supabaseClient.storage.from('game-files').getPublicUrl(fileName);
    const cdnUrl = toCdnUrl(publicUrl);

    const { data, error: metaErr } = await supabaseClient.auth.updateUser({ data: { custom_avatar: cdnUrl } });
    if (metaErr) throw metaErr;

    if (DOM.profileAvatar) DOM.profileAvatar.src = cdnUrl;
    if (DOM.avatarPreview) DOM.avatarPreview.src = cdnUrl;

    // Sync avatar on the user's games (background)
    supabaseClient.from('games').update({ uploader_avatar: cdnUrl })
        .eq('user_id', currentUser.id)
        .then(({ error }) => { if (error) console.warn('Avatar sync failed:', error.message); });

    updateAuthUI(data.user);
    return cdnUrl;
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
            if (headerOverlay) headerOverlay.textContent = 'Uploading...';
            try {
                await uploadAvatar(file);
                notify.success('Profile picture updated! 🎉');
            } catch (err) {
                notify.error(friendlyError(err, 'Could not update profile picture.'), err);
            } finally {
                if (headerOverlay) headerOverlay.textContent = 'Change photo';
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
        if (!selectedFile) { notify.warn('Please choose a photo first.'); return; }
        if (!currentUser) { notify.warn('Please log in first.'); return; }
        saveBtn.disabled    = true;
        saveBtn.textContent = 'Saving...';
        try {
            await uploadAvatar(selectedFile);
            selectedFile = null;
            if (fileInput) fileInput.value = '';
            notify.success('Profile picture saved! 🎉');
        } catch (err) {
            notify.error(friendlyError(err, 'Could not save profile picture.'), err);
        } finally {
            saveBtn.disabled    = false;
            saveBtn.textContent = 'Save';
        }
    });
}


// ════════════════════════════════════════════════════════
//  Report game modal
//
//  Flow:
//    1. User clicks ⚠️ Report in player footer
//    2. If not logged in → notify + open login modal, abort
//    3. Otherwise open the report modal pre-bound to the currently
//       playing game's id (captured at moment of click)
//    4. User picks a reason (radio) and optional details
//    5. submit_report RPC is called server-side
//    6. On success: button shows "Reported" state, modal closes
// ════════════════════════════════════════════════════════

// Tracks which game the modal currently targets. Set by the click
// handler each time the modal is opened.
let _reportTargetGameId = null;

function initReport() {
    const openBtn      = document.getElementById('reportBtn');
    const modal        = document.getElementById('reportModal');
    const closeBtn     = document.getElementById('closeReport');
    const submitBtn    = document.getElementById('submitReportBtn');
    const detailsInput = document.getElementById('reportDetails');
    if (!openBtn || !modal || !submitBtn) return;

    // Open: gate on auth + capture current game id
    openBtn.addEventListener('click', () => {
        if (!currentUser) {
            notify.warn('Please log in to report a game.');
            window.openAuthModal?.('login');
            return;
        }
        // window.currentPlayerGameId is set in db.js openGame()
        _reportTargetGameId = window.currentPlayerGameId || null;
        if (!_reportTargetGameId) {
            notify.error('Could not identify the game. Please reopen it and try again.');
            return;
        }

        // Reset form
        detailsInput.value = '';
        modal.querySelectorAll('input[name="reportReason"]').forEach(r => { r.checked = false; });
        submitBtn.disabled    = false;
        submitBtn.textContent = 'Submit Report';
        modal.classList.add('active');
    });

    // Close handlers
    closeBtn?.addEventListener('click', () => modal.classList.remove('active'));
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('active');
    });

    // Submit
    submitBtn.addEventListener('click', async () => {
        if (!currentUser) { notify.warn('Please log in first.'); return; }
        if (!_reportTargetGameId) { notify.error('Game id missing.'); return; }

        const reason = modal.querySelector('input[name="reportReason"]:checked')?.value;
        if (!reason) { notify.warn('Please pick a reason.'); return; }

        const details = (detailsInput.value || '').trim();
        if (details.length > 500) {
            notify.warn('Details too long (max 500 characters).');
            return;
        }

        submitBtn.disabled    = true;
        submitBtn.textContent = 'Submitting...';
        try {
            const { error } = await supabaseClient.rpc('submit_report', {
                p_game_id: _reportTargetGameId,
                p_reason:  reason,
                p_details: details || null,
            });
            if (error) throw error;

            notify.success('Report submitted. Thank you — moderators will review it.', { duration: 4500 });
            modal.classList.remove('active');

            // Visually mark the report button so the user knows it was received.
            // The server-side UNIQUE constraint also prevents duplicate open reports.
            openBtn.classList.add('reported');
            openBtn.textContent = '✓ Reported';
        } catch (err) {
            // Friendly mapping of the specific errors submit_report throws
            const msg = err.message || '';
            if (msg.includes('cannot report your own game')) {
                notify.warn("You can't report your own game.");
            } else if (msg.includes('already have a pending report')) {
                notify.warn('You already have a pending report for this game.');
                openBtn.classList.add('reported');
                openBtn.textContent = '✓ Reported';
                modal.classList.remove('active');
            } else if (msg.includes('Login required')) {
                notify.warn('Please log in to report a game.');
            } else {
                notify.error(friendlyError(err, 'Could not submit report.'), err);
            }
        } finally {
            // Only re-enable if still visible (i.e., not closed by success path)
            if (modal.classList.contains('active')) {
                submitBtn.disabled    = false;
                submitBtn.textContent = 'Submit Report';
            }
        }
    });

    // ESC to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) {
            modal.classList.remove('active');
        }
    });
}


// ════════════════════════════════════════════════════════
//  Share game modal
//
//  Opens when the user clicks 🔗 Share in the player footer.
//  No login required. The game's permalink is whatever is already
//  in the URL bar — openGame() pushes /game/<id>-<slug> there — so
//  we read window.location.href directly. The social buttons wrap
//  that URL in each platform's share-intent endpoint.
// ════════════════════════════════════════════════════════

function initShare() {
    const openBtn    = document.getElementById('shareBtn');
    const modal      = document.getElementById('shareModal');
    const closeBtn   = document.getElementById('closeShare');
    const linkInput  = document.getElementById('shareLinkInput');
    const copyBtn    = document.getElementById('shareCopyBtn');
    const titleEl    = document.getElementById('shareGameTitle');
    if (!openBtn || !modal) return;

    const twitterA   = document.getElementById('shareTwitter');
    const redditA    = document.getElementById('shareReddit');
    const facebookA  = document.getElementById('shareFacebook');

    openBtn.addEventListener('click', () => {
        // The permalink is the current URL (openGame already pushed it).
        // Fall back to building it from the game id if for some reason
        // we're not on a /game/ URL yet.
        let shareUrl = window.location.href;
        if (!shareUrl.includes('/game/') && window.currentPlayerGameId) {
            shareUrl = `${window.location.origin}/game/${window.currentPlayerGameId}`;
        }

        const gameName = DOM.playerTitle?.textContent?.trim() || 'this game';
        const shareText = `Play "${gameName}" on AIgames123 🎮`;

        titleEl.textContent = gameName;
        linkInput.value = shareUrl;

        // Build platform share-intent URLs
        const encUrl  = encodeURIComponent(shareUrl);
        const encText = encodeURIComponent(shareText);
        twitterA.href  = `https://twitter.com/intent/tweet?text=${encText}&url=${encUrl}`;
        redditA.href   = `https://www.reddit.com/submit?url=${encUrl}&title=${encText}`;
        facebookA.href = `https://www.facebook.com/sharer/sharer.php?u=${encUrl}`;

        // Reset copy button state
        copyBtn.textContent = 'Copy';
        copyBtn.classList.remove('copied');

        modal.classList.add('active');
    });

    // Copy link to clipboard
    copyBtn?.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(linkInput.value);
            copyBtn.textContent = '✓ Copied';
            copyBtn.classList.add('copied');
            setTimeout(() => {
                copyBtn.textContent = 'Copy';
                copyBtn.classList.remove('copied');
            }, 2000);
        } catch {
            // Fallback for older browsers / non-secure contexts: select the text
            linkInput.select();
            linkInput.setSelectionRange(0, 99999);
            try {
                document.execCommand('copy');
                copyBtn.textContent = '✓ Copied';
                copyBtn.classList.add('copied');
                setTimeout(() => {
                    copyBtn.textContent = 'Copy';
                    copyBtn.classList.remove('copied');
                }, 2000);
            } catch {
                notify.warn('Could not copy. Please select and copy the link manually.');
            }
        }
    });

    // Close handlers
    closeBtn?.addEventListener('click', () => modal.classList.remove('active'));
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('active');
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) {
            modal.classList.remove('active');
        }
    });
}
