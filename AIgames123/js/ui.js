// ✨ 업로드 모달에서 사용할 사전 정의 태그 목록
const PRESET_TAGS = [
    'Action', 'Adventure', 'RPG', 'FPS', 'Puzzle',
    'Strategy', 'Simulation', 'Sports', 'Horror', 'Racing',
    'Platform', 'Arcade', 'Card', 'Board', 'Idle',
    'Casual', 'Shooter', 'Fighting', 'Survival', 'Music'
];

function initUploadModal() {
    const uploadBtn = document.getElementById('uploadBtn');
    const uploadModal = document.getElementById('uploadModal');
    const closeUpload = document.getElementById('closeUpload');
    const submitGameBtn = document.getElementById('submitGame');
    const gameNameInput = document.getElementById('gameName');
    const gameFileInput = document.getElementById('gameFileInput');
    const thumbnailFileInput = document.getElementById('thumbnailFileInput');
    const profileContent = document.getElementById('profileContent');
    const tagSelector = document.getElementById('tagSelector');

    // ✨ 태그 선택기 렌더링
    if (tagSelector) {
        tagSelector.innerHTML = PRESET_TAGS.map(tag =>
            `<button type="button" class="tag-option" data-tag="${tag}">${tag}</button>`
        ).join('');

        // 클릭 토글
        tagSelector.addEventListener('click', (e) => {
            const btn = e.target.closest('.tag-option');
            if (!btn) return;
            btn.classList.toggle('selected');
        });
    }

    // 선택된 태그를 쉼표로 구분된 문자열로 반환하는 헬퍼
    function getSelectedTags() {
        if (!tagSelector) return '';
        return Array.from(tagSelector.querySelectorAll('.tag-option.selected'))
            .map(btn => btn.dataset.tag)
            .join(', ');
    }

    // 태그 선택 초기화
    function clearTagSelector() {
        if (!tagSelector) return;
        tagSelector.querySelectorAll('.tag-option.selected').forEach(btn => btn.classList.remove('selected'));
    }

    if (uploadBtn) uploadBtn.onclick = () => {
        if (!currentUser) return alert("로그인이 필요합니다.");
        uploadModal.classList.add('active');
    };
    if (closeUpload) closeUpload.onclick = () => uploadModal.classList.remove('active');

    if (submitGameBtn) {
        submitGameBtn.onclick = async () => {
            if (!currentUser) return alert("로그인이 필요합니다!");
            const name = gameNameInput.value.trim();
            const tags = getSelectedTags(); // ✨ 텍스트 입력 대신 선택된 태그 사용
            const file = gameFileInput.files[0];
            const thumbFile = thumbnailFileInput.files[0];

            if (!name || !file) return alert("게임 이름과 HTML 파일은 필수입니다!");
            submitGameBtn.innerText = "업로드 중...";
            submitGameBtn.disabled = true;

            try {
                const htmlText = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target.result);
                    reader.onerror = (e) => reject(new Error("파일 읽기 실패"));
                    reader.readAsText(file, "UTF-8");
                });
                const blob = new Blob([htmlText], { type: 'text/html; charset=utf-8' });
                const fileName = `${Date.now()}_${file.name}`;

                const { error: uploadError } = await supabaseClient.storage.from('game-files').upload(fileName, blob, { contentType: 'text/html; charset=utf-8', upsert: true });
                if (uploadError) throw uploadError;
                const { data: { publicUrl: gamePublicUrl } } = supabaseClient.storage.from('game-files').getPublicUrl(fileName);

                let thumbPublicUrl = null;
                if (thumbFile) {
                    const thumbName = `${Date.now()}_thumb_${thumbFile.name}`;
                    const { error: thumbError } = await supabaseClient.storage.from('game-files').upload(thumbName, thumbFile, { upsert: true });
                    if (thumbError) throw thumbError;
                    const { data: thumbData } = supabaseClient.storage.from('game-files').getPublicUrl(thumbName);
                    thumbPublicUrl = thumbData.publicUrl;
                }

                const currentName = currentUser.user_metadata.custom_name || currentUser.user_metadata.preferred_username || currentUser.user_metadata.full_name || '게이머';

                const { error: dbError } = await supabaseClient.from('games').insert([{
                    id: Date.now(),
                    name: name,
                    file_url: gamePublicUrl,
                    thumbnail_url: thumbPublicUrl,
                    tags: tags,
                    view_count: 0,
                    user_id: currentUser.id,
                    uploader_name: currentName,
                    upvotes: 0
                }]);
                if (dbError) throw dbError;

                alert("업로드 성공!");
                uploadModal.classList.remove('active');

                // ✨ 폼 초기화 (태그 선택기 포함)
                gameNameInput.value = '';
                clearTagSelector();
                gameFileInput.value = '';
                thumbnailFileInput.value = '';

                if (profileContent.style.display === 'block') fetchMyGames();
                else fetchGames();
            } catch (error) { alert("오류 발생: " + error.message); }
            finally { submitGameBtn.innerText = "Launch Game"; submitGameBtn.disabled = false; }
        };
    }
}

function initEditModal() {
    const editModal = document.getElementById('editModal');
    const closeEdit = document.getElementById('closeEdit');
    const submitEditGame = document.getElementById('submitEditGame');
    const editTagSelector = document.getElementById('editTagSelector');

    // ✨ 수정 모달 태그 선택기 렌더링
    if (editTagSelector) {
        editTagSelector.innerHTML = PRESET_TAGS.map(tag =>
            `<button type="button" class="tag-option" data-tag="${tag}">${tag}</button>`
        ).join('');

        editTagSelector.addEventListener('click', (e) => {
            const btn = e.target.closest('.tag-option');
            if (!btn) return;
            btn.classList.toggle('selected');
        });
    }

    if(closeEdit) closeEdit.onclick = () => editModal.classList.remove('active');
    if(submitEditGame) {
        submitEditGame.onclick = async () => {
            const newName = document.getElementById('editGameName').value.trim();
            // 선택된 태그를 쉼표로 묶어서 가져옴
            const newTags = editTagSelector
                ? Array.from(editTagSelector.querySelectorAll('.tag-option.selected'))
                    .map(btn => btn.dataset.tag).join(', ')
                : '';
            if(!newName) return alert("게임 이름을 입력해주세요.");
            submitEditGame.disabled = true;
            submitEditGame.textContent = "저장 중...";
            try {
                const { error } = await supabaseClient.from('games').update({ name: newName, tags: newTags }).eq('id', editingGameId);
                if (error) throw error;
                alert("정보가 수정되었습니다.");
                editModal.classList.remove('active');
                fetchMyGames();
            } catch(error) { alert("수정 실패: " + error.message); }
            finally { submitEditGame.disabled = false; submitEditGame.textContent = "저장하기"; }
        }
    }
}

function initSidebar() {
    const menuBtn = document.getElementById('menuBtn');
    const sidebar = document.getElementById('sidebar');
    const closeSidebar = document.getElementById('closeSidebar');

    if (menuBtn) menuBtn.addEventListener('click', () => sidebar.classList.add('active'));
    if (closeSidebar) closeSidebar.addEventListener('click', () => sidebar.classList.remove('active'));
    document.addEventListener('click', (e) => {
        if (sidebar && menuBtn && sidebar.classList.contains('active') && !sidebar.contains(e.target) && !menuBtn.contains(e.target)) sidebar.classList.remove('active');
    });
}

function initPlayer() {
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const closePlayer = document.getElementById('closePlayer');
    const gameFrame = document.getElementById('gameFrame');
    const deleteGameBtn = document.getElementById('deleteGameBtn');
    const playerModal = document.getElementById('playerModal');

    if (fullscreenBtn) fullscreenBtn.onclick = () => {
        if (gameFrame.requestFullscreen) gameFrame.requestFullscreen();
        else if (gameFrame.webkitRequestFullscreen) gameFrame.webkitRequestFullscreen();
        else if (gameFrame.msRequestFullscreen) gameFrame.msRequestFullscreen();
    };

    if (closePlayer) closePlayer.onclick = () => {
        playerModal.classList.remove('active');
        document.body.style.overflow = ''; // 모달 닫힐 때 배경 스크롤 복원
        gameFrame.srcdoc = "";
        if(deleteGameBtn) deleteGameBtn.style.display = 'none';
    };
}

function initFileInputs() {
    if(document.getElementById('gameFileInput')) document.getElementById('gameFileInput').onchange = (e) => { document.getElementById('gameFileName').textContent = e.target.files[0]?.name || ''; };
    if(document.getElementById('thumbnailFileInput')) document.getElementById('thumbnailFileInput').onchange = (e) => { document.getElementById('thumbnailFileName').textContent = e.target.files[0]?.name || ''; };
}

function initSearch() {
    const searchInput = document.getElementById('searchInput');
    let searchTimeout;
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                const searchTerm = e.target.value.trim();
                fetchGames(searchTerm, currentTag);
            }, 300);
        });
    }
}

// ✨ 프로필 아바타 업로드
function initProfileAvatar() {
    const trigger = document.getElementById('avatarUploadTrigger');
    const fileInput = document.getElementById('avatarFileInput');
    if (!trigger || !fileInput) return;

    trigger.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file || !currentUser) return;

        const originalOverlay = trigger.querySelector('.avatar-edit-overlay');
        if (originalOverlay) originalOverlay.textContent = '업로드 중...';

        try {
            const ext = file.name.split('.').pop();
            const fileName = `avatars/${currentUser.id}_${Date.now()}.${ext}`;

            // Supabase Storage에 업로드
            const { error: uploadError } = await supabaseClient.storage
                .from('game-files')
                .upload(fileName, file, { upsert: true });
            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabaseClient.storage
                .from('game-files')
                .getPublicUrl(fileName);

            // user_metadata에 custom_avatar로 저장
            const { data, error: updateError } = await supabaseClient.auth.updateUser({
                data: { custom_avatar: publicUrl }
            });
            if (updateError) throw updateError;

            // 화면 즉시 반영
            const profileAvatar = document.getElementById('profileAvatar');
            if (profileAvatar) profileAvatar.src = publicUrl;

            // 내 모든 게임의 uploader_avatar도 업데이트
            await supabaseClient.from('games')
                .update({ uploader_avatar: publicUrl })
                .eq('user_id', currentUser.id);

            updateAuthUI(data.user);
            alert('프로필 사진이 변경되었습니다! 🎉');
        } catch (err) {
            alert('업로드 실패: ' + err.message);
        } finally {
            if (originalOverlay) originalOverlay.textContent = '📷 변경';
            fileInput.value = '';
        }
    });
}
