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

            if (fileType === 'zip') {
                // ZIP upload: stored as-is
                const fileName = `${Date.now()}_${sanitizeName(file.name)}`;
                const { error: uploadErr } = await supabaseClient.storage
                    .from('game-files').upload(fileName, file, { contentType: 'application/zip', upsert: true });
                if (uploadErr) throw uploadErr;
                gameUrl = supabaseClient.storage.from('game-files').getPublicUrl(fileName).data.publicUrl;
            } else {
                // HTML upload
                const htmlText = await file.text();
                const blob     = new Blob([htmlText], { type: 'text/html; charset=utf-8' });
                const fileName = `${Date.now()}_${sanitizeName(file.name)}`;
                const { error: uploadErr } = await supabaseClient.storage
                    .from('game-files').upload(fileName, blob, { contentType: 'text/html; charset=utf-8', upsert: true });
                if (uploadErr) throw uploadErr;
                gameUrl = supabaseClient.storage.from('game-files').getPublicUrl(fileName).data.publicUrl;
            }

            // Thumbnail
            let thumbUrl = null;
            if (thumbFile) {
                const thumbName = `${Date.now()}_thumb_${sanitizeName(thumbFile.name)}`;
                const { error: thumbErr } = await supabaseClient.storage
                    .from('game-files').upload(thumbName, thumbFile, { upsert: true });
                if (thumbErr) throw thumbErr;
                thumbUrl = supabaseClient.storage.from('game-files').getPublicUrl(thumbName).data.publicUrl;
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
    function applyScale(scale) {
        const wrapper   = DOM.gameScaleWrapper;
        const frame     = DOM.gameFrame;
        const container = wrapper?.parentElement;
        if (!wrapper || !frame || !container) return;

        currentScale = scale;

        if (scale >= 1) {
            wrapper.style.cssText = 'width:100%; height:100%; overflow:hidden;';
            frame.style.cssText   = 'width:100%; height:100%; border:none; background:#fff;';
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

        try {
            const doc = frame.contentDocument;
            if (!doc?.documentElement) return;

            const contentW = doc.documentElement.scrollWidth  || doc.body?.scrollWidth  || 0;
            const contentH = doc.documentElement.scrollHeight || doc.body?.scrollHeight || 0;
            const containerW = container.clientWidth;
            const containerH = container.clientHeight;

            // No content size yet — game is still bootstrapping
            if (contentW < 50 || contentH < 50) return;

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

    // Re-fit on orientation change / window resize. iOS Safari fires both
    // `orientationchange` (legacy) and `resize` (modern) — we listen to
    // resize alone since that covers all cases, but debounce so we don't
    // thrash during the rotation animation.
    let _resizeTimer = null;
    window.addEventListener('resize', () => {
        if (!DOM.playerModal?.classList.contains('active')) return;
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(() => {
            // Reset scale first so the next measurement is against natural size,
            // then re-apply auto-scale based on the new container dimensions.
            applyScale(1);
            tryAutoScale();
        }, 250);
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
                const target = document.querySelector('.game-frame-container') || DOM.gameFrame;
                (target.requestFullscreen || target.webkitRequestFullscreen)?.call(target);
            } else {
                (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
            }
        }
    });

    exitFsFloatBtn?.addEventListener('click', exitPseudoFullscreen);

    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement && fullscreenBtn) {
            fullscreenBtn.textContent = 'Fullscreen';
        }
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

function initDpad() {
    if (!DOM.dpadOverlay || !DOM.gameFrame) return;
    const isTouch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    if (!isTouch) return;
    DOM.dpadOverlay.classList.add('active');

    // ════════════════════════════════════════════════════════
    // Toggle button — lets the user dismiss the D-pad when they
    // need to interact with the lower portion of the game. The
    // toggle button itself stays visible so they can bring it back.
    // Choice persists across the session via localStorage.
    // ════════════════════════════════════════════════════════
    const toggleBtn = document.getElementById('dpadToggleBtn');
    if (toggleBtn) {
        toggleBtn.classList.add('visible');

        const STORAGE_KEY = 'dpadHidden';
        let isHidden = false;
        try { isHidden = localStorage.getItem(STORAGE_KEY) === '1'; } catch (_) {}

        const applyHidden = (hidden) => {
            DOM.dpadOverlay.classList.toggle('hidden', hidden);
            toggleBtn.textContent = hidden ? '🎮' : '✕';
            toggleBtn.title       = hidden ? 'Show controller' : 'Hide controller';
        };
        applyHidden(isHidden);

        toggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            isHidden = !isHidden;
            try { localStorage.setItem(STORAGE_KEY, isHidden ? '1' : '0'); } catch (_) {}
            applyHidden(isHidden);
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
        .from('game-files').upload(fileName, uploadFile, { upsert: true, contentType: uploadFile.type || 'image/webp' });
    if (upErr) throw upErr;

    const { data: { publicUrl } } = supabaseClient.storage.from('game-files').getPublicUrl(fileName);

    const { data, error: metaErr } = await supabaseClient.auth.updateUser({ data: { custom_avatar: publicUrl } });
    if (metaErr) throw metaErr;

    if (DOM.profileAvatar) DOM.profileAvatar.src = publicUrl;
    if (DOM.avatarPreview) DOM.avatarPreview.src = publicUrl;

    // Sync avatar on the user's games (background)
    supabaseClient.from('games').update({ uploader_avatar: publicUrl })
        .eq('user_id', currentUser.id)
        .then(({ error }) => { if (error) console.warn('Avatar sync failed:', error.message); });

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
