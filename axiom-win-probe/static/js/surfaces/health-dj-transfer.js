    let currentHealthDjTransferPreview = null;
    let currentHealthBeatgridDoctorPreview = null;
    let currentHealthBeatgridDoctorReceipt = null;
    let currentHealthBeatgridDoctorApply = null;
    let currentHealthBeatgridDoctorWriterProof = null;
    let currentHealthBeatgridDoctorDjayWriterProof = null;
    let currentHealthBeatgridDoctorTestPack = null;
    let currentHealthBeatgridDoctorDjayTestPack = null;
    let currentHealthBeatgridDoctorSeratoLiveTest = null;
    let currentHealthBeatgridDoctorDjayLiveTest = null;
    let currentHealthBeatgridDoctorRunMode = 'idle';
    let healthDjTransferBusy = false;
    let healthDjTransferTask = 'playlists';
    let healthDjTransferCountMessage = 'Not checked yet.';
    let healthBeatgridDoctorTestLimit = 10;
    let healthBeatgridDoctorTarget = 'serato';
    let healthBeatgridLibraryState = null;
    let healthBeatgridFullSendPending = null;
    let healthBeatgridLibraryBackupLocation = null;
    let healthBeatgridLibraryError = '';
    let healthBeatgridLibraryTimer = null;
    let healthBeatgridLibraryRows = [];
    let healthBeatgridLibrarySongsPage = { offset: 0, loaded: false, busy: false };
    const healthBeatgridLibrarySelectedSongs = new Set();
    const healthBeatgridPickedSongs = new Map();
    let healthBeatgridCandidateQuery = '';
    let healthBeatgridCandidateRows = [];
    let healthBeatgridCandidateError = '';
    let healthBeatgridCandidateTimer = null;
    let healthBeatgridCandidateEpoch = 0;
    let healthBeatgridLibraryBannerOwned = false;
    let healthBeatgridLibraryBannerHandler = null;
    let healthBeatgridLibraryEpoch = 0;
    const healthDjTransferSelectedSources = new Set();
    const healthDjTransferConfirmedPaths = new Set();
    let healthDjTransferPathPage = 0;

    function healthTransferReviewablePaths(data = currentHealthDjTransferPreview) {
        return (data?.play_count_review_rows || data?.samples || []).filter(row =>
            !row.ambiguous && row.path && row.match_source === 'relative_path_review'
            && Number.isInteger(row.serato_play_count) && Number.isInteger(row.djay_play_count)
            && row.serato_play_count > row.djay_play_count && row.serato_play_count <= 2147483647);
    }

    function healthDjTransferCountStatus(data = currentHealthDjTransferPreview) {
        const summary = data?.summary || {};
        const reviewable = healthTransferReviewablePaths(data);
        const confirmed = reviewable.filter(row => healthDjTransferConfirmedPaths.has(row.path)).length;
        const ready = (Number(summary.play_counts_ready) || 0) + confirmed;
        const excluded = reviewable.length - confirmed;
        return {
            ready, excluded,
            result: ready ? `${ready.toLocaleString()} ${ready === 1 ? 'track is' : 'tracks are'} ready to copy`
                : summary.play_count_differences ? 'Track locations need review'
                    : summary.serato_matches ? 'No higher Serato counts to copy' : 'No matching tracks',
            status: ready ? "Copy Serato play counts into djay's Plays column. Audio and cues stay unchanged."
                : 'Your library has not been changed.',
            exclusion: excluded ? `${excluded.toLocaleString()} unconfirmed ${excluded === 1 ? 'match is' : 'matches are'} excluded.` : '',
        };
    }

    function pageHealthTransferPaths(delta) {
        if (healthDjTransferBusy) return;
        const pages = Math.ceil(healthTransferReviewablePaths().length / 40);
        healthDjTransferPathPage = Math.max(0, Math.min(pages - 1, healthDjTransferPathPage + delta));
        if (currentHealthDjTransferPreview) renderHealthDjTransferPreview(currentHealthDjTransferPreview);
        healthDjTransferControls(false);
        document.getElementById('health-transfer-path-review')?.setAttribute('open', '');
    }

    function confirmAllHealthTransferPaths(input) {
        if (healthDjTransferBusy) return;
        healthTransferReviewablePaths().forEach(row => {
            if (input.checked) healthDjTransferConfirmedPaths.add(row.path);
            else healthDjTransferConfirmedPaths.delete(row.path);
        });
        renderHealthDjTransferPreview(currentHealthDjTransferPreview);
        healthDjTransferControls(false);
        document.getElementById('health-transfer-path-review')?.setAttribute('open', '');
    }

    function confirmHealthTransferPath(input) {
        if (healthDjTransferBusy) return;
        if (!healthTransferReviewablePaths().some(row => row.path === input.value)) return;
        if (input.checked) healthDjTransferConfirmedPaths.add(input.value);
        else healthDjTransferConfirmedPaths.delete(input.value);
        healthDjTransferControls(false);
    }
    let healthDjTransferDirection = 'djay-serato';
    let healthDjTransferPlaylistStep = 'choose';
    let healthDjTransferPlaylistReceipt = null;
    let healthDjTransferPlaylistError = '';
    let healthDjTransferSearch = '';
    let healthDjTransferLocationsConfirmed = false;

    function confirmHealthPlaylistLocations(input) {
        if (healthDjTransferBusy) return;
        healthDjTransferLocationsConfirmed = input.checked;
        healthDjTransferControls(false);
    }

    function healthDjTransferSources(data = currentHealthDjTransferPreview) {
        return healthDjTransferDirection === 'serato-djay' ? (data?.serato_sources || []) : (data?.sources || []);
    }

    function healthDjTransferBrandRoute(source, destination, reversible = false) {
        const brand = name => name === 'Serato'
            ? '<img src="/static/brands/serato-dj-pro.svg" alt="Serato DJ Pro" class="health-transfer-brand-serato">'
            : '<span class="health-transfer-brand-djay"><img src="/static/brands/djay-wordmark.png" alt="djay"><b>Pro</b></span>';
        return `<div class="health-transfer-route"><div><small>From</small>${brand(source)}</div>
            ${reversible ? '<button type="button" class="health-transfer-direction" aria-label="Reverse transfer direction" title="Reverse transfer direction" onclick="reverseHealthDjTransferDirection()"><img src="/static/icons/rotate-cw.svg" alt=""></button>' : '<img class="health-transfer-route-arrow" src="/static/icons/arrow-right.svg" alt="to">'}
            <div><small>To</small>${brand(destination)}</div></div>`;
    }

    function healthDjTransferPendingPanel(task, message = 'Refresh Library to load crates and playlists from both DJ libraries.') {
        if (task === 'playlists') {
            const toSerato = healthDjTransferDirection === 'djay-serato';
            return `${healthDjTransferBrandRoute(toSerato ? 'djay Pro' : 'Serato', toSerato ? 'Serato' : 'djay Pro', true)}<p class="health-transfer-note">${escapeHtml(message)}</p>`;
        }
        if (task === 'plays') return '';
        return `<p>${{plays: 'Serato to djay Pro', bpm: '50-70 BPM in AXIOM'}[task]}</p><p>${escapeHtml(message)}</p>`;
    }

    function reverseHealthDjTransferDirection() {
        if (healthDjTransferBusy) return;
        healthDjTransferDirection = healthDjTransferDirection === 'djay-serato' ? 'serato-djay' : 'djay-serato';
        resetHealthPlaylistTransfer();
    }

    function resetHealthPlaylistTransfer() {
        if (healthDjTransferBusy) return;
        healthDjTransferPlaylistStep = 'choose';
        healthDjTransferPlaylistReceipt = null;
        healthDjTransferPlaylistError = '';
        healthDjTransferSearch = '';
        healthDjTransferLocationsConfirmed = false;
        healthDjTransferSelectedSources.clear();
        if (currentHealthDjTransferPreview) renderHealthDjTransferPreview(currentHealthDjTransferPreview);
        else {
            const detail = document.getElementById('health-dj-transfer-detail');
            if (detail) detail.innerHTML = healthDjTransferPendingPanel('playlists');
        }
        healthDjTransferControls(false);
    }

    function filterHealthTransferPlaylists(value) {
        healthDjTransferSearch = value;
        let visible = 0;
        document.querySelectorAll('[data-transfer-playlist-name]').forEach(row => {
            row.hidden = !row.dataset.transferPlaylistName.includes(value.trim().toLocaleLowerCase());
            if (!row.hidden) visible += 1;
        });
        const empty = document.getElementById('health-transfer-search-empty');
        if (empty) empty.hidden = visible > 0;
    }

    function selectAllHealthTransferPlaylists(input) {
        if (healthDjTransferBusy) return;
        healthDjTransferSources().filter(source => source.matched_track_count).forEach(source => {
            if (input.checked) healthDjTransferSelectedSources.add(source.id);
            else healthDjTransferSelectedSources.delete(source.id);
        });
        document.querySelectorAll('input[name="health-transfer-source"]').forEach(box => {
            box.checked = healthDjTransferSelectedSources.has(box.value);
        });
        refreshHealthPlaylistLocations();
        healthDjTransferControls(false);
    }

    function healthPlaylistLocationChecks() {
        const mappings = healthDjTransferSources().filter(source => healthDjTransferSelectedSources.has(source.id))
            .flatMap(source => source.location_mappings || []);
        return mappings.length ? `<details class="health-transfer-disclosure"><summary>${mappings.length} file locations to confirm</summary><div class="health-transfer-table">${mappings.map(row => `<p>${escapeHtml(row.serato_path)}<br>${escapeHtml(row.djay_path)}</p>`).join('')}</div></details><label class="health-transfer-path-choice"><input type="checkbox" onchange="confirmHealthPlaylistLocations(this)" ${healthDjTransferLocationsConfirmed ? 'checked' : ''}>These matched locations are the same music files</label>` : '';
    }

    function refreshHealthPlaylistLocations() {
        healthDjTransferLocationsConfirmed = false;
        const locations = document.getElementById('health-transfer-location-check');
        if (locations) locations.innerHTML = healthPlaylistLocationChecks();
    }

    function chooseHealthPlaylistTransfer() {
        if (healthDjTransferBusy) return;
        if (healthDjTransferPlaylistStep === 'complete') resetHealthPlaylistTransfer();
        document.querySelector('#health-dj-transfer-detail input[type="search"]')?.focus();
    }

    function healthDjTransferPlaylistPanel(data) {
        const toSerato = healthDjTransferDirection === 'djay-serato';
        const sourceApp = toSerato ? 'djay Pro' : 'Serato';
        const destination = toSerato ? 'Serato' : 'djay Pro';
        const sources = healthDjTransferSources(data);
        const supported = toSerato || data.serato_to_djay_enabled || !!window.axiomDjTransferReview;
        const step = healthDjTransferPlaylistStep;
        const route = healthDjTransferBrandRoute(sourceApp, destination, step === 'choose');
        const steps = `<ol class="health-transfer-steps" aria-label="Transfer steps">
            <li ${step === 'choose' ? 'aria-current="step"' : ''}><button id="health-transfer-choose" type="button" onclick="chooseHealthPlaylistTransfer()"><span>1</span>Choose playlists</button></li>
            <li ${step === 'complete' ? 'aria-current="step"' : ''}><button id="health-dj-transfer-export" type="button" class="health-transfer-send" onclick="exportDjayLibraryToSerato()" title="Transfer selected playlists to ${destination}"><span>2</span>Transfer now</button></li>
        </ol>`;
        let panel;
        if (step === 'complete') {
            const receipt = healthDjTransferPlaylistReceipt || {};
            panel = `<div class="health-transfer-done"><img src="/static/icons/check-circle.svg" alt=""><div><h3>${receipt.demo ? 'Example complete' : 'Export verified'}</h3><p>${receipt.demo ? 'Your real library was not changed.' : `Open ${destination} to use your ${toSerato ? 'crates' : 'playlists in My Collection'}.`}</p></div></div>
                <div class="health-transfer-receipt-line"><strong>${receipt.playlists || 0}</strong> ${receipt.playlists === 1 ? 'playlist' : 'playlists'} <span>/</span> <strong>${receipt.entries || 0}</strong> playlist ${receipt.entries === 1 ? 'entry' : 'entries'}</div>
                ${receipt.skipped ? `<p class="health-transfer-warning">${receipt.skipped} unavailable entries were skipped.</p>` : ''}
                <details class="health-transfer-disclosure"><summary>Transfer receipt</summary><ul>${(receipt.results || []).map(row => `<li>${escapeHtml(row.source_name)}: ${row.exported_tracks || 0} entries${row.missing_tracks ? `, ${row.missing_tracks} unavailable` : ''}</li>`).join('')}</ul></details>
                <div class="health-transfer-footer"><span>${receipt.demo ? 'Interactive example' : 'Audio files unchanged'}</span><button class="health-transfer-primary" type="button" onclick="resetHealthPlaylistTransfer()">Choose More Playlists</button></div>`;
        } else if (!supported) {
            panel = '<div class="health-transfer-empty"><img src="/static/icons/lock-keyhole.svg" alt=""><h3>Compatibility testing</h3><p>Serato to djay playlist transfer is not enabled yet.</p></div>';
        } else {
            panel = `<div class="health-transfer-heading"><h3>Your ${sourceApp} playlists</h3><span>${sources.length} ${sources.length === 1 ? 'playlist' : 'playlists'}</span><p>Playlist membership only. Cues, tags, keys and play counts are not included.</p></div>
                <p class="health-transfer-note">${window.axiomDjTransferReview ? 'Example only. No DJ library will be changed.' : toSerato ? 'Quit your DJ apps before transferring. AXIOM verifies each playlist in Serato and reuses an identical previous transfer.' : 'Quit your DJ apps first. Only tracks already in djay My Collection are included. Identical transfers are not added twice.'}</p>
                <div id="health-transfer-location-check">${healthPlaylistLocationChecks()}</div>
                <div class="health-transfer-picker-bar"><label class="health-transfer-select-all"><input id="health-transfer-select-all" type="checkbox" onchange="selectAllHealthTransferPlaylists(this)">All playlists</label><input type="search" aria-label="Search playlists" placeholder="Search playlists" value="${escapeHtml(healthDjTransferSearch)}" oninput="filterHealthTransferPlaylists(this.value)"></div>
                <div class="health-transfer-sources">${sources.map(item => `<label data-transfer-playlist-name="${escapeHtml(String(item.name || '').toLocaleLowerCase())}" ${String(item.name || '').toLocaleLowerCase().includes(healthDjTransferSearch.trim().toLocaleLowerCase()) ? '' : 'hidden'}><input type="checkbox" name="health-transfer-source" value="${escapeHtml(item.id)}" data-unavailable="${!item.matched_track_count}" ${item.matched_track_count ? '' : 'disabled'} ${healthDjTransferSelectedSources.has(item.id) ? 'checked' : ''} onchange="selectHealthDjTransferSource(this)"><img src="/static/icons/folder-open.svg" alt=""><span>${escapeHtml(item.name || 'Untitled playlist')}</span><small>${item.matched_track_count} ${item.matched_track_count === 1 ? 'track' : 'tracks'}${item.track_count > item.matched_track_count ? ` / ${item.track_count - item.matched_track_count} unmatched` : ''}</small></label>`).join('') || '<p class="health-transfer-note">No playlists found in this library.</p>'}</div>
                <p id="health-transfer-search-empty" class="health-transfer-note" ${!healthDjTransferSearch.trim() || sources.some(item => String(item.name || '').toLocaleLowerCase().includes(healthDjTransferSearch.trim().toLocaleLowerCase())) ? 'hidden' : ''}>No playlists match your search.</p>
                <div class="health-transfer-footer"><span id="health-transfer-selection-count">No playlists selected</span></div>`;
        }
        return `${route}${steps}<p id="health-transfer-progress" class="health-transfer-progress" role="status" aria-live="polite" hidden></p>${healthDjTransferPlaylistError ? `<p class="health-transfer-warning" role="alert">${escapeHtml(healthDjTransferPlaylistError)}</p>` : ''}${panel}`;
    }

    function selectHealthDjTransferTask(task) {
        if (healthDjTransferBusy || !['plays', 'playlists', 'grids'].includes(task)) return;
        const bay = document.getElementById(`health-section-body-${task === 'grids' ? 'doctor' : 'transfer'}`);
        const panel = document.getElementById('health-dj-transfer-detail');
        if (bay && panel) bay.appendChild?.(panel);
        if (task === 'grids' && task === healthDjTransferTask && document.getElementById('health-dj-transfer-detail')?.children.length) {
            healthDjTransferControls(false);
            return;
        }
        healthDjTransferTask = task;
        ['plays', 'playlists', 'grids'].forEach(key => {
            const tab = document.getElementById(`health-transfer-tab-${key}`);
            if (!tab) return;
            tab.setAttribute('aria-selected', String(key === task));
            tab.tabIndex = key === task ? 0 : -1;
        });
        const detail = document.getElementById('health-dj-transfer-detail');
        detail?.setAttribute('aria-labelledby', `health-transfer-tab-${task}`);
        if (currentHealthDjTransferPreview) renderHealthDjTransferPreview(currentHealthDjTransferPreview);
        else if (task === 'grids' && detail) detail.innerHTML = healthBeatgridDoctorPanel();
        else if (detail) detail.innerHTML = healthDjTransferPendingPanel(task, task === 'playlists'
            ? 'Refresh Library to load crates and playlists from both DJ libraries.' : 'Not checked yet.');
        healthDjTransferControls(false);
        if (task === 'grids' && !window.axiomDjTransferReview && !healthBeatgridLibraryState) {
            void pollBeatgridLibrary(healthBeatgridDoctorTarget);
        }
    }

    function healthDjTransferTabKeydown(event) {
        const keys = ['playlists', 'plays', 'grids'];
        const index = keys.indexOf(healthDjTransferTask);
        const next = {ArrowRight: (index + 1) % keys.length, ArrowLeft: (index + keys.length - 1) % keys.length, Home: 0, End: keys.length - 1}[event.key];
        if (next === undefined || healthDjTransferBusy) return;
        event.preventDefault();
        event.stopPropagation();
        selectHealthDjTransferTask(keys[next]);
        document.getElementById(`health-transfer-tab-${keys[next]}`)?.focus();
    }

    function selectHealthDjTransferSource(input) {
        if (healthDjTransferBusy) return;
        if (input.checked) healthDjTransferSelectedSources.add(input.value);
        else healthDjTransferSelectedSources.delete(input.value);
        refreshHealthPlaylistLocations();
        healthDjTransferControls(false);
    }

    function healthDjTransferControls(busy) {
        healthDjTransferBusy = busy;
        const backupSlot = document.getElementById('health-beatgrid-toolbar-backups');
        if (backupSlot) {
            const backupControls = document.getElementById('health-dj-transfer-detail')?.querySelector?.('.health-beatgrid-backups');
            if (backupControls) backupSlot.replaceChildren(backupControls);
        }
        const beatgridControlGrid = document.getElementById('health-beatgrid-control-grid');
        if (beatgridControlGrid) beatgridControlGrid.hidden = healthDjTransferTask !== 'grids';
        document.getElementById('health-section-transfer')?.classList?.toggle('beatgrids-active', healthDjTransferTask === 'grids');
        const refresh = document.getElementById('health-dj-transfer-grid-refresh');
        if (refresh) refresh.disabled = busy || !!healthBeatgridLibraryState?.rollback_required;
        const transferRefresh = document.getElementById('health-dj-transfer-preview');
        if (transferRefresh) transferRefresh.hidden = healthDjTransferTask === 'grids';
        const countPending = document.getElementById('health-transfer-count-pending');
        if (countPending) countPending.hidden = healthDjTransferTask !== 'plays' || !!currentHealthDjTransferPreview;
        const countPendingStatus = document.getElementById('health-transfer-count-pending-status');
        if (countPendingStatus) countPendingStatus.textContent = healthDjTransferCountMessage;
        const gridExport = document.getElementById('health-dj-transfer-grid-export');
        if (gridExport) {
            gridExport.hidden = healthDjTransferTask !== 'grids';
            gridExport.disabled = busy || !!window.axiomDjTransferReview || !!healthBeatgridLibraryState?.rollback_required;
        }
        const restore = document.getElementById('health-beatgrid-library-recover');
        if (restore) restore.disabled = busy;
        const recoveryReceipt = document.getElementById('health-beatgrid-library-receipt');
        if (recoveryReceipt) recoveryReceipt.disabled = busy;
        document.querySelectorAll('#health-section-transfer button').forEach(button => {
            button.setAttribute('data-axiom-cta-skip', 'true');
        });
        [5, 7, 10].forEach(limit => {
            const button = document.getElementById(`health-dj-transfer-grid-test-${limit}`);
            if (!button) return;
            button.disabled = busy;
            button.setAttribute('aria-pressed', String(limit === healthBeatgridDoctorTestLimit));
        });
        ['serato', 'djay', 'both'].forEach(target => {
            const button = document.getElementById(`health-dj-transfer-grid-target-${target}`);
            if (!button) return;
            button.hidden = target === 'both' && !window.axiomDjTransferReview;
            button.disabled = busy;
            button.setAttribute('aria-pressed', String(target === healthBeatgridDoctorTarget));
        });
        ['plays', 'playlists', 'grids'].forEach(key => {
            const tab = document.getElementById(`health-transfer-tab-${key}`);
            if (tab) tab.disabled = busy;
        });
        ['preview', 'copy', 'bpm', 'export', 'grid-doctor', 'grid-handoff', 'grid-full', 'grid-receipt', 'grid-apply', 'grid-proof', 'grid-djay-proof', 'grid-pack', 'grid-djay-pack'].forEach(action => {
            const button = document.getElementById(`health-dj-transfer-${action}`);
            if (!button) return;
            button.disabled = busy || (action !== 'preview' && (!currentHealthDjTransferPreview || window.axiomDjTransferReview));
            if (action === 'preview' && healthDjTransferTask === 'grids' && !window.axiomDjTransferReview) {
                button.disabled ||= !!healthBeatgridLibraryState?.rollback_required;
            }
            if (action === 'copy') button.disabled = busy || !healthDjTransferCountStatus().ready;
            if (action === 'bpm' && !currentHealthDjTransferPreview?.summary?.bpm_guard_candidates) button.disabled = true;
            if (action === 'export' && !healthDjTransferSelectedSources.size) button.disabled = true;
            if (action === 'grid-doctor') button.disabled = busy || window.axiomDjTransferReview;
            if (action === 'grid-handoff') button.disabled = busy || window.axiomDjTransferReview || !currentHealthBeatgridDoctorPreview?.preview_token;
            if (action === 'grid-full') button.disabled = busy || window.axiomDjTransferReview || !currentHealthBeatgridDoctorPreview?.preview_token;
            if (action === 'grid-receipt') button.disabled = busy || window.axiomDjTransferReview || !currentHealthBeatgridDoctorPreview?.preview_token;
            if (action === 'grid-apply') button.disabled = busy || window.axiomDjTransferReview || !currentHealthBeatgridDoctorPreview?.preview_token;
            if (action === 'grid-proof') button.disabled = busy || window.axiomDjTransferReview || !currentHealthBeatgridDoctorApply?.success;
            if (action === 'grid-djay-proof') button.disabled = busy || window.axiomDjTransferReview || !currentHealthBeatgridDoctorApply?.success;
            if (action === 'grid-pack') button.disabled = busy || window.axiomDjTransferReview || !currentHealthBeatgridDoctorWriterProof?.success;
            if (action === 'grid-djay-pack') button.disabled = busy || window.axiomDjTransferReview || !currentHealthBeatgridDoctorDjayWriterProof?.success;
            if (!window.axiomDjTransferReview && ['grid-handoff', 'grid-full', 'grid-receipt'].includes(action)) {
                const state = healthBeatgridLibraryState;
                const sample = state?.scan_scope === 'test';
                const gridsOnly = state?.operation === 'export-djay-grids';
                button.disabled = busy || !['complete', 'published'].includes(state?.status);
                if (action === 'grid-receipt') button.disabled = busy || !state?.receipt_path;
                else if (!(action === 'grid-full' && sample)) button.disabled ||=
                    Number(state?.repair || 0) <= Number(state?.repaired_this_scan || 0) &&
                    !(Number(state?.attention || 0) > 0 && !sample && !gridsOnly);
                if (action === 'grid-full' || action === 'grid-handoff') {
                    const label = action === 'grid-full' ? 'Send to Full Library'
                        : gridsOnly ? 'Send Test Grids' : 'Run Test Batch';
                    const text = button.querySelector?.('span');
                    if (text) text.textContent = label;
                    else button.textContent = label;
                }
                if (action === 'grid-handoff') button.disabled ||= healthBeatgridLibrarySelectedSongs.size > healthBeatgridDoctorTestLimit;
            }
        });
        document.querySelectorAll('input[name="health-transfer-source"]').forEach(input => {
            input.disabled = busy || input.dataset.unavailable === 'true';
        });
        const available = healthDjTransferSources().filter(source => source.matched_track_count);
        const selected = available.filter(source => healthDjTransferSelectedSources.has(source.id)).length;
        const all = document.getElementById('health-transfer-select-all');
        if (all) { all.checked = selected > 0 && selected === available.length; all.indeterminate = selected > 0 && selected < available.length; all.disabled = busy || !available.length; }
        const counter = document.getElementById('health-transfer-selection-count');
        if (counter) counter.textContent = `${selected} ${selected === 1 ? 'playlist' : 'playlists'} selected`;
        const playlistSupported = healthDjTransferDirection === 'djay-serato' || currentHealthDjTransferPreview?.serato_to_djay_enabled || !!window.axiomDjTransferReview;
        const choose = document.getElementById('health-transfer-choose');
        if (choose) choose.disabled = busy;
        const send = document.getElementById('health-dj-transfer-export');
        const pathMatches = healthTransferReviewablePaths();
        const confirmAll = document.getElementById('health-transfer-paths-all');
        if (confirmAll) {
            const checked = pathMatches.filter(row => healthDjTransferConfirmedPaths.has(row.path)).length;
            confirmAll.checked = !!pathMatches.length && checked === pathMatches.length;
            confirmAll.indeterminate = checked > 0 && checked < pathMatches.length;
            confirmAll.disabled = busy;
        }
        const countButton = document.getElementById('health-dj-transfer-copy');
        const countStatus = healthDjTransferCountStatus();
        if (countButton) {
            const count = countStatus.ready;
            countButton.textContent = count ? `Copy ${count.toLocaleString()} Play ${count === 1 ? 'Count' : 'Counts'} to djay` : 'Confirm File Locations First';
        }
        if (currentHealthDjTransferPreview && healthDjTransferTask === 'plays') {
            for (const [id, copy] of [['health-transfer-count-result', countStatus.result],
                ['health-transfer-count-status', countStatus.status], ['health-transfer-count-excluded', countStatus.exclusion]]) {
                const node = document.getElementById(id);
                if (node) { node.textContent = copy; node.hidden = !copy; }
            }
        }
        document.querySelectorAll('#health-dj-transfer-detail .health-transfer-path-choice input[type="checkbox"]').forEach(input => { input.disabled = busy; });
        const needsLocations = healthDjTransferSources().some(source => healthDjTransferSelectedSources.has(source.id) && source.location_mappings?.length);
        if (send) {
            send.disabled = busy || healthDjTransferPlaylistStep === 'complete' || !selected || !playlistSupported || (needsLocations && !healthDjTransferLocationsConfirmed);
            send.setAttribute('aria-busy', String(busy && healthDjTransferTask === 'playlists'));
            send.title = busy ? 'Transfer running. Please wait.' : healthDjTransferPlaylistStep === 'complete' ? 'Transfer complete'
                : !selected ? 'Select playlists to transfer'
                : needsLocations && !healthDjTransferLocationsConfirmed ? 'Confirm the matched file locations below first'
                : !playlistSupported ? 'This transfer direction is not available' : 'Transfer selected playlists now';
        }
        document.querySelectorAll('#health-dj-transfer-detail .health-transfer-direction, #health-dj-transfer-detail input[type="search"]').forEach(node => { node.disabled = busy; });
        document.querySelectorAll('#health-dj-transfer-detail .health-transfer-target button, [data-beatgrid-backup-action]').forEach(node => { node.disabled = busy; });
        document.querySelectorAll('[data-beatgrid-song-path]').forEach(input => {
            input.disabled = busy || (!input.checked && healthBeatgridLibrarySelectedSongs.size >= healthBeatgridDoctorTestLimit);
        });
        document.querySelectorAll('[data-beatgrid-mark-checked]').forEach(button => { button.disabled = busy; });
    }

    function beatgridLibrarySongRow(row) {
        const label = healthBeatgridDoctorTarget === 'serato' ? 'Crates' : 'Playlists';
        const location = row.collections_unavailable ? `${label} unavailable`
            : Array.isArray(row.collections) ? row.collections.length
                ? `${label}: ${row.collections.join('; ')}`
                : healthBeatgridDoctorTarget === 'serato' ? 'All tracks' : 'My Collection'
            : '';
        const tempo = Number(row.bpm || row.after_bpm) ? `${Number(row.bpm || row.after_bpm).toFixed(1)} BPM` : '';
        const metadata = [row.artist, tempo].filter(Boolean).join(' / ');
        const songFilter = healthBeatgridLibrarySongsPage.filter || beatgridLibraryDefaultFilter();
        const selectable = (songFilter === 'repair' ||
            (songFilter === 'attention' && healthBeatgridLibraryState?.scan_scope !== 'test' &&
                healthBeatgridLibraryState?.operation !== 'export-djay-grids')) &&
            (row.status === 'repair' || row.review_kind === 'attention') && typeof row.path === 'string' && !healthDjTransferBusy;
        const title = escapeHtml(row.title || row.path);
        const heading = selectable ? `<label class="health-beatgrid-song-choice"><input type="checkbox"
            data-beatgrid-song-path="${escapeHtml(row.path)}" aria-label="Select ${title} for test batch"
            ${healthBeatgridLibrarySelectedSongs.has(row.path) ? 'checked' : ''}
            onchange="selectBeatgridLibraryTestSong(this)"><strong>${title}</strong></label>` : `<strong>${title}</strong>`;
        const checkable = songFilter === 'attention' && row.status === 'review' && row.review_kind === 'attention' &&
            /^[a-f0-9]{64}$/.test(row._attention_revision || '') &&
            ['complete', 'published'].includes(healthBeatgridLibraryState?.status);
        const checked = checkable ? `<button type="button" class="health-transfer-direction"
            data-beatgrid-mark-checked="${escapeHtml(row.path)}" title="Mark checked"
            aria-label="Mark ${title} checked" ${healthDjTransferBusy ? 'disabled' : ''}
            onclick="markBeatgridAttentionChecked(this, event)"><img src="/static/icons/check.svg" alt=""></button>` : '';
        const pickup = Number(row.pickup_beats_ungridded);
        const pickupWarning = Number.isInteger(pickup) && pickup > 0
            ? `${pickup} pickup beat${pickup === 1 ? '' : 's'} before bar one cannot be gridded in Serato.` : '';
        const taskReason = songFilter === 'bar_one' ? row.musical_start_confirmed
            ? 'Check START against a downbeat in bars 1-5 or bar 9.' : 'Confirm the musical START before setting bar 1.'
            : songFilter === 'labels' ? 'Review generic or missing cue names; existing cue positions are preserved.'
            : ['alignment','bpm'].includes(songFilter) ? (row.issues || []).join('; ') : '';
        return `<li class="health-beatgrid-song"><div class="health-beatgrid-song-heading">${heading}${checked}</div>${metadata ? `<small>${escapeHtml(metadata)}</small>` : ''}${location ? `<small>${escapeHtml(location)}</small>` : ''}${pickupWarning ? `<small>${pickupWarning}</small>` : ''}${taskReason ? `<small>${escapeHtml(taskReason)}</small>` : ''}${row.review_reason ? `<small>${escapeHtml(row.review_reason)}</small>` : ''}</li>`;
    }

    async function markBeatgridAttentionChecked(button, event) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (healthDjTransferBusy || window.axiomDjTransferReview ||
            !['complete', 'published'].includes(healthBeatgridLibraryState?.status)) return;
        const row = healthBeatgridLibraryRows.find(row => row.path === button.dataset.beatgridMarkChecked &&
            row.review_kind === 'attention' && row._attention_revision);
        if (!row) return;
        const provider = healthBeatgridDoctorTarget;
        const epoch = healthBeatgridLibraryEpoch;
        const run = healthBeatgridLibraryState.run_id;
        healthDjTransferControls(true);
        try {
            const data = await postBeatgridDoctorStep('/api/library/health/beatgrid_doctor/library_mark_checked',
                {provider, run_id: run, rows: [{path: row.path, revision: row._attention_revision}]},
                'Could not mark this song checked.');
            if (provider !== healthBeatgridDoctorTarget || epoch !== healthBeatgridLibraryEpoch ||
                run !== healthBeatgridLibraryState?.run_id) return;
            if (data.audit?.run_id !== run || data.audit?.provider !== provider ||
                !['complete', 'published'].includes(data.audit?.status) ||
                !Number.isInteger(data.audit?.attention_checked) || data.audit.attention_checked < 1)
                throw new Error('The checked-song reminder could not be verified. Refresh the scan.');
            healthBeatgridLibraryState = data.audit;
            healthBeatgridLibraryError = '';
            const total = Number(data.audit?.attention) || 0;
            const offset = Math.min(healthBeatgridLibrarySongsPage.offset,
                Math.max(0, Math.floor((total - 1) / 20) * 20));
            healthBeatgridLibrarySongsPage.loaded = false;
            await showBeatgridLibrarySongs(offset);
        } catch (error) {
            if (provider === healthBeatgridDoctorTarget && epoch === healthBeatgridLibraryEpoch)
                healthBeatgridLibraryError = error.message;
        } finally {
            if (provider === healthBeatgridDoctorTarget && epoch === healthBeatgridLibraryEpoch) paintBeatgridLibrary();
        }
    }

    function selectBeatgridLibraryTestSong(input) {
        const path = input.dataset.beatgridSongPath;
        if (healthDjTransferBusy || !path || !healthBeatgridLibraryRows.some(row => row.path === path &&
            (row.status === 'repair' || row.review_kind === 'attention'))) return;
        if (input.checked && healthBeatgridLibrarySelectedSongs.size < healthBeatgridDoctorTestLimit) healthBeatgridLibrarySelectedSongs.add(path);
        else if (!input.checked) healthBeatgridLibrarySelectedSongs.delete(path);
        input.checked = healthBeatgridLibrarySelectedSongs.has(path);
        const selection = document.getElementById('health-beatgrid-test-selection');
        if (selection) selection.textContent = beatgridLibrarySelectionLabel();
        healthDjTransferControls(false);
    }

    function beatgridLibrarySelectionLabel() {
        const selected = healthBeatgridLibrarySelectedSongs.size;
        return selected ? `${selected} of ${healthBeatgridDoctorTestLimit} test songs selected`
            : `Automatic sample: up to ${healthBeatgridDoctorTestLimit} songs`;
    }

    function beatgridCandidatePicker() {
        const chosen = [...healthBeatgridPickedSongs.entries()];
        const maximum = window.AxiomHealthDoctor?.selectedScope() ? 300 : healthBeatgridDoctorTestLimit;
        return `<div class="health-beatgrid-candidate-picker">
            <label for="health-beatgrid-candidate-search">${maximum === 300 ? 'Selected songs' : 'Test songs'} <span>${chosen.length} / ${maximum}</span></label>
            <input id="health-beatgrid-candidate-search" type="search" autocomplete="off" value="${escapeHtml(healthBeatgridCandidateQuery)}"
                placeholder="Find songs in your DJ library" oninput="searchBeatgridCandidates(this.value)" aria-controls="health-beatgrid-candidate-results">
            ${chosen.length ? `<ul class="health-beatgrid-picked">${chosen.map(([path, song]) => `<li><span>${escapeHtml(song.title || path)}</span><button type="button" data-beatgrid-remove-path="${escapeHtml(path)}" aria-label="Remove ${escapeHtml(song.title || path)}" title="Remove song" onclick="removeBeatgridCandidate(this.dataset.beatgridRemovePath)"><img src="/static/icons/x.svg" alt=""></button></li>`).join('')}</ul>` : ''}
            <ul id="health-beatgrid-candidate-results" class="health-beatgrid-candidates" aria-live="polite">
                ${healthBeatgridCandidateRows.map(row => `<li><label><input type="checkbox" data-beatgrid-candidate-path="${escapeHtml(row.path)}" ${healthBeatgridPickedSongs.has(row.path) ? 'checked' : ''} ${!healthBeatgridPickedSongs.has(row.path) && chosen.length >= maximum ? 'disabled' : ''} onchange="toggleBeatgridCandidate(this)"><span><strong>${escapeHtml(row.title || row.path)}</strong>${row.artist ? `<small>${escapeHtml(row.artist)}</small>` : ''}</span></label></li>`).join('')}
            </ul>${healthBeatgridCandidateError ? `<small role="alert">${escapeHtml(healthBeatgridCandidateError)}</small>` : ''}
        </div>`;
    }

    function paintBeatgridCandidates() {
        const picker = document.querySelector('#health-dj-transfer-detail .health-beatgrid-candidate-picker');
        if (!picker) return;
        const focused = document.activeElement?.id === 'health-beatgrid-candidate-search';
        const position = focused ? document.activeElement.selectionStart : null;
        picker.outerHTML = beatgridCandidatePicker();
        if (focused) {
            const search = document.getElementById('health-beatgrid-candidate-search');
            search?.focus();
            if (Number.isInteger(position)) search?.setSelectionRange(position, position);
        }
        healthDjTransferControls(healthDjTransferBusy);
    }

    function searchBeatgridCandidates(value) {
        healthBeatgridCandidateQuery = value;
        healthBeatgridCandidateRows = [];
        healthBeatgridCandidateError = '';
        clearTimeout(healthBeatgridCandidateTimer);
        const epoch = ++healthBeatgridCandidateEpoch;
        if (value.trim().length < 2 || healthDjTransferBusy) { paintBeatgridCandidates(); return; }
        healthBeatgridCandidateTimer = setTimeout(async () => {
            try {
                const query = new URLSearchParams({provider:healthBeatgridDoctorTarget, q:value.trim(),
                    operation:healthBeatgridDoctorTarget === 'serato' && healthBeatgridLibraryState?.operation === 'export-djay-grids'
                        ? 'export-djay-grids' : 'cleanup'});
                const response = await fetch(beatgridDoctorEndpoint(`/api/library/health/beatgrid_doctor/library_candidates?${query}`));
                const data = await response.json();
                if (!response.ok || !data.success) throw new Error(data.error || 'Could not find songs.');
                if (epoch !== healthBeatgridCandidateEpoch) return;
                healthBeatgridCandidateRows = Array.isArray(data.rows) ? data.rows : [];
            } catch (error) {
                if (epoch !== healthBeatgridCandidateEpoch) return;
                healthBeatgridCandidateError = error.message;
            }
            paintBeatgridCandidates();
        }, 250);
    }

    function toggleBeatgridCandidate(input) {
        const path = input.dataset.beatgridCandidatePath;
        const song = healthBeatgridCandidateRows.find(row => row.path === path);
        if (!path || !song) return;
        if (input.checked && healthBeatgridPickedSongs.size < (window.AxiomHealthDoctor?.selectedScope() ? 300 : healthBeatgridDoctorTestLimit))
            healthBeatgridPickedSongs.set(path, song);
        else if (!input.checked) healthBeatgridPickedSongs.delete(path);
        paintBeatgridCandidates();
    }

    function removeBeatgridCandidate(path) {
        healthBeatgridPickedSongs.delete(path);
        paintBeatgridCandidates();
    }

    function beatgridLibraryDefaultFilter() {
        const state = healthBeatgridLibraryState;
        return state?.status === 'published' ? Number(state.written) > 0 ? 'published'
            : Number(state.review_collection_entries) > 0 ? 'collection' : 'published' : 'repair';
    }

    function showBeatgridReviewCollection(event) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        selectBeatgridLibrarySongsFilter('collection');
        const results = document.getElementById('health-beatgrid-library-results');
        if (results) results.open = true;
    }

    function healthBeatgridLibraryPanel() {
        const state = healthBeatgridLibraryState;
        const name = healthBeatgridDoctorTarget === 'djay' ? 'djay Pro' : 'Serato';
        const count = value => Math.max(0, Number(value) || 0).toLocaleString();
        const active = ['starting', 'running', 'publishing', 'recovering'].includes(state?.status);
        const sample = state?.scan_scope === 'test';
        const gridsOnly = state?.operation === 'export-djay-grids';
        const backup = healthBeatgridLibraryBackupLocation || state?.backup_location;
        const free = Number(backup?.free_bytes);
        const storage = backup?.available === false ? 'Drive unavailable'
            : Number.isFinite(free) && free > 0 ? `${(free / 1024**3).toFixed(1)} GB free` : '';
        const limit = backup?.system_drive && backup?.available !== false ? '8 GB backup limit' : '';
        const label = state?.status === 'published' ? Number(state.written) > 0
            ? gridsOnly ? `${count(state.written)} beatgrids sent to Serato` : `${count(state.written)} songs fixed in ${name}` : `Batch finished in ${name}`
            : state?.status === 'publishing' ? `${count(state.written)} of ${count(state.repair_total)} songs fixed`
            : state?.status === 'recovering' ? `Restoring previous grids in ${name}`
            : state?.last_recovery?.rollback_verified ? `${count(state.last_recovery.restored)} songs restored in ${name}`
            : state?.status === 'restored' ? `Previous grids restored in ${name}`
            : state?.status === 'starting' ? `Reading your ${name} library`
            : state?.status === 'running' ? `${count(state.checked)} of ${count(state.total)} songs checked`
            : state?.status === 'complete' ? `${count(state.checked)} ${sample ? 'sample songs' : 'songs'} checked`
            : state?.status === 'cancelled' ? `Scan stopped after ${count(state.checked)} songs`
            : state?.status === 'outdated' ? 'Library scan needs refreshing before cleanup'
            : ['failed', 'publish_failed'].includes(state?.status) ? 'Cleanup needs attention'
            : 'Clean beatgrids in your DJ library';
        const page = healthBeatgridLibrarySongsPage;
        const songFilter = page.filter || beatgridLibraryDefaultFilter();
        const rows = songFilter === 'published' ? state?.published_rows || [] : healthBeatgridLibraryRows;
        const unavailable = Number(state?.unavailable) || 0;
        const attention = Number(state?.attention ?? Math.max(0, Number(state?.review || 0) - unavailable));
        const songTotal = Number(['alignment','bpm','bar_one','labels'].includes(songFilter) ? state?.task_review_counts?.[songFilter] : songFilter === 'published' ? state?.written
            : songFilter === 'collection' ? state?.review_collection_entries
            : songFilter === 'attention' ? attention : songFilter === 'unavailable' ? unavailable
            : Math.max(0, Number(state?.repair || 0) - Number(state?.repaired_this_scan || 0))) || 0;
        const songLabel = songFilter === 'published' ? `${count(state?.written)} ${gridsOnly ? 'sent grids' : 'fixed songs'}`
            : ['alignment','bpm','bar_one','labels'].includes(songFilter) ? `${{alignment:'Alignment',bpm:'BPM',bar_one:'Bar 1',labels:'Cue labels'}[songFilter]} review`
            : songFilter === 'collection' ? `${count(state?.review_collection_entries)} songs to check`
            : songFilter === 'attention' ? 'Beatgrids to check'
            : songFilter === 'unavailable' ? 'Could not check or fix'
            : gridsOnly ? 'Songs with grids ready to send' : 'Songs to repair';
        const metric = (kind, icon, title, description, value, suffix = '') => `<div class="health-beatgrid-metric ${kind}">
            <img src="/static/icons/${icon}.svg" alt=""><span><strong>${title}</strong><small>${description}</small></span>
            <b>${count(value)}</b>${suffix ? `<small class="health-beatgrid-metric-suffix">${suffix}</small>` : ''}</div>`;
        const pending = Math.max(0, Number(state?.repair || 0) - Number(state?.repaired_this_scan || 0));
        return `<div class="health-beatgrid-overview-grid">
            <section class="health-beatgrid-summary" aria-label="Beatgrid Doctor status">
                <h3>Beatgrid Doctor</h3>
                <p class="health-transfer-result" aria-live="polite">${gridsOnly && state?.status === 'published' && Number(state.written) > 0 ? `<strong>${count(state.written)}</strong> beatgrids sent to Serato` : escapeHtml(label)}</p>
                ${gridsOnly ? '<p>djay Pro to Serato: beatgrids and BPM only. Existing crates, cues and play counts stay unchanged.</p>' : ''}
                ${sample && ['complete', 'published'].includes(state?.status) ? `<p>${count(state.checked)} songs in this test sample; the full library has not been checked.${attention ? ' Sample songs needing review remain here; existing review crates and playlists are unchanged.' : ''}</p>` : ''}
                ${!state || state.status === 'idle' ? '<p>Check your library, keep good grids, and repair misplaced beats and BPM. Audio and cue points are preserved.</p>' : ''}
                <div class="health-beatgrid-backups">
                    <img class="health-beatgrid-backup-icon" src="/static/icons/database.svg" alt=""><span title="${escapeHtml(backup?.path || '')}"><strong>${escapeHtml(backup?.label || 'This Mac')}</strong><small>${[storage, limit].filter(Boolean).map(escapeHtml).join(' | ')}</small></span>
                    <div class="health-beatgrid-backup-tools">
                        <button type="button" class="health-transfer-direction" data-beatgrid-backup-action="choose" title="Choose backup folder" aria-label="Choose backup folder" ${active ? 'disabled' : ''} onclick="chooseBeatgridBackupLocation('choose', event)"><img src="/static/icons/folder-open.svg" alt=""></button>
                        ${backup?.custom ? `<button type="button" class="health-transfer-direction" data-beatgrid-backup-action="default" title="Use this Mac for backups" aria-label="Use this Mac for backups" ${active ? 'disabled' : ''} onclick="chooseBeatgridBackupLocation('default', event)"><img src="/static/icons/rotate-cw.svg" alt=""></button>` : ''}
                    </div>
                </div>
                ${healthBeatgridDoctorTarget === 'serato' ? '<div class="health-beatgrid-export-row"><button id="health-dj-transfer-grid-export" class="health-transfer-secondary" data-axiom-cta-skip="true" type="button" onclick="exportDjayBeatgrids(event)"><img src="/static/icons/arrow-right.svg" alt="">Export Grids</button><span>Send checked beatgrids from djay Pro to Serato in your library.</span></div>' : ''}
            </section>
            <section class="health-beatgrid-breakdown" aria-label="Results breakdown">
                <header><img src="/static/icons/sliders-horizontal.svg" alt=""><h3>Results Breakdown</h3><small>Beatgrid scan and transfer status</small></header>
                <div class="health-beatgrid-metrics">
                    ${metric('clean', 'check-circle', state?.requested_tasks?.length === 1 && state.requested_tasks[0] === 'labels' ? 'Named cues' : state?.requested_tasks ? 'Timing passed' : 'Already clean', state?.requested_tasks ? 'Other preparation tasks can still need review.' : 'Tracks with correct beatgrids (no changes needed).', state?.clean, 'left unchanged')}
                    ${metric('ready', 'file-up', gridsOnly ? 'Grids ready to send' : 'Repairs found', gridsOnly ? `Valid beatgrids ready to transfer to ${name}.` : 'Tracks ready for beatgrid repair.', pending)}
                    ${metric('unavailable', 'circle-alert', 'Could not check or fix', 'Tracks that could not be analysed or fixed.', unavailable, 'left unchanged')}
                    ${attention ? metric('attention', 'circle-alert', 'Needs a closer check', 'Tracks needing review after automatic treatment.', attention) : ''}
                    ${metric('sent', 'play', gridsOnly ? 'Sent grids' : 'Fixed songs', gridsOnly ? `Beatgrids successfully sent to ${name}.` : `Beatgrids successfully fixed in ${name}.`, state?.written)}
                </div>
            </section>
        </div>
            ${state?.status !== 'published' ? `<details class="health-beatgrid-candidate-disclosure"><summary>Choose test songs</summary>${beatgridCandidatePicker()}</details>` : ''}
            ${state?.status === 'published' && state.review_collection_name ? `<div class="health-transfer-review-list">
                <div><span>${escapeHtml(state.review_collection_name)}</span><button type="button" class="health-transfer-secondary" data-axiom-cta-skip="true" ${active ? 'disabled' : ''} onclick="showBeatgridReviewCollection(event)">View ${count(state.review_collection_entries)} ${Number(state.review_collection_entries) === 1 ? 'song' : 'songs'}</button></div>
            </div>` : ''}
            ${state?.attention_collection_sync?.status === 'unavailable' ? '<p role="alert">The review crate could not be synced with AXIOM. Refresh before the next batch.</p>' : ''}
            ${['publishing', 'recovering'].includes(state?.status) ? '<p>Keep your DJ software closed until this finishes.</p>' : ''}
            ${state?.rollback_required && !active ? '<button type="button" class="health-transfer-secondary" id="health-beatgrid-library-recover" data-axiom-cta-skip="true" onclick="recoverBeatgridLibrary()">Restore Previous Grids</button>' : ''}
            ${state?.receipt_path && !active && !['complete', 'published'].includes(state.status) ? '<button type="button" class="health-transfer-secondary" id="health-beatgrid-library-receipt" data-axiom-cta-skip="true" onclick="exportBeatgridLibraryReceipt()">Export Receipt</button>' : ''}
            ${['complete', 'published'].includes(state?.status) ? `<details id="health-beatgrid-library-results" class="health-transfer-disclosure"><summary onclick="showBeatgridLibrarySongs()"><img src="/static/icons/clipboard.svg" alt=""><strong>${songLabel}</strong><small>View the list of ${count(songTotal)} ${songTotal === 1 ? 'track' : 'tracks'} ${songFilter === 'published' ? `sent to ${name}` : 'in this batch'}.</small><img class="health-beatgrid-results-chevron" src="/static/icons/chevron-down.svg" alt=""></summary>
                ${Number(state.review) || Object.values(state.task_review_counts || {}).some(value => value > 0) || state.status === 'published' ? `<label class="health-transfer-inline-field health-beatgrid-song-filter">Show <select aria-label="Doctor song list" onchange="selectBeatgridLibrarySongsFilter(this.value)">
                    <option value="${state.status === 'published' ? 'published' : 'repair'}" ${songFilter === (state.status === 'published' ? 'published' : 'repair') ? 'selected' : ''}>${state.status === 'published' ? 'Fixed songs' : 'Songs to repair'}</option>
                    ${state.status === 'published' ? `<option value="repair" ${songFilter === 'repair' ? 'selected' : ''}>Remaining repairs (${count(Number(state.repair || 0) - Number(state.repaired_this_scan || 0))})</option>` : ''}
                    ${state.status === 'published' && state.review_collection_name ? `<option value="collection" ${songFilter === 'collection' ? 'selected' : ''}>${healthBeatgridDoctorTarget === 'djay' ? 'Review playlist' : 'Review crate'} (${count(state.review_collection_entries)})</option>` : ''}
                    ${attention || songFilter === 'attention' ? `<option value="attention" ${songFilter === 'attention' ? 'selected' : ''}>Beatgrids to check (${count(attention)})</option>` : ''}
                    ${unavailable ? `<option value="unavailable" ${songFilter === 'unavailable' ? 'selected' : ''}>Could not check or fix (${count(unavailable)})</option>` : ''}
                    ${Object.entries(state?.task_review_counts || {}).filter(([, total]) => total > 0).map(([task, total]) => `<option value="${escapeHtml(task)}" ${songFilter === task ? 'selected' : ''}>${escapeHtml({alignment:'Alignment',bpm:'BPM',bar_one:'Bar 1',labels:'Cue labels'}[task] || task)} review (${count(total)})</option>`).join('')}
                </select></label>` : ''}
                ${songFilter === 'repair' || songFilter === 'attention' ? `<p id="health-beatgrid-test-selection" aria-live="polite">${beatgridLibrarySelectionLabel()}</p>` : ''}
                ${rows.length ? `<ul>${rows.map(beatgridLibrarySongRow).join('')}</ul>` : `<p id="health-beatgrid-library-songs">${healthBeatgridLibraryError ? 'Song list unavailable.' : page.loaded ? 'No songs in this batch.' : 'Loading songs...'}</p>`}
                ${songTotal > 20 ? `<nav class="health-beatgrid-song-pages" aria-label="Song list pages">
                    <button type="button" title="Previous songs" aria-label="Previous songs" ${page.busy || page.offset === 0 ? 'disabled' : ''} onclick="showBeatgridLibrarySongs(${Math.max(0, page.offset - 20)}, event)"><img src="/static/icons/arrow-right.svg" alt="" class="health-beatgrid-previous"></button>
                    <span aria-live="polite">${count(page.offset + (rows.length ? 1 : 0))}-${count(page.offset + rows.length)} of ${count(songTotal)}</span>
                    <button type="button" title="Next songs" aria-label="Next songs" ${page.busy || !page.loaded || page.offset + rows.length >= songTotal ? 'disabled' : ''} onclick="showBeatgridLibrarySongs(${page.offset + 20}, event)"><img src="/static/icons/arrow-right.svg" alt=""></button>
                </nav>` : ''}
            </details>` : ''}
            ${healthBeatgridLibraryError || state?.error ? `<p role="alert">${escapeHtml(healthBeatgridLibraryError || state.error)}</p>` : ''}`;
    }

    function paintBeatgridLibrary() {
        window.AxiomHealthDoctor?.progress(healthBeatgridLibraryState);
        if (healthDjTransferTask === 'grids') {
            const detail = document.getElementById('health-dj-transfer-detail');
            if (detail) {
                const resultsOpen = document.getElementById('health-beatgrid-library-results')?.open;
                const candidatesOpen = detail.querySelector?.('.health-beatgrid-candidate-disclosure')?.open;
                detail.innerHTML = healthBeatgridLibraryPanel();
                const results = document.getElementById('health-beatgrid-library-results');
                if (results && resultsOpen) results.open = true;
                const candidates = detail.querySelector?.('.health-beatgrid-candidate-disclosure');
                if (candidates && candidatesOpen) candidates.open = true;
            }
        }
        const state = healthBeatgridLibraryState;
        const active = ['starting', 'running', 'publishing', 'recovering'].includes(state?.status);
        healthDjTransferControls(active);
        window.AxiomHealthCockpit?.updateBackgroundJob({active,
            title: active ? 'Beatgrid Doctor working' : ['complete', 'published'].includes(state?.status) ? 'Beatgrid Doctor finished' : 'Queue idle',
            copy: active ? `${Number(state?.checked || 0).toLocaleString()} of ${Number(state?.total || 0).toLocaleString()} songs checked. Open Doctor for progress.`
                : ['complete', 'published'].includes(state?.status) ? 'Open Doctor to review this batch and export its receipt.' : 'Choose a Health tool to begin.'});
        if (active) {
            const publishing = state.status === 'publishing';
            const recovering = state.status === 'recovering';
            const current = Number(publishing ? state.written : state.checked) || 0;
            const total = Number(publishing ? state.repair_total : state.total) || 0;
            setHealthTopScanBanner(true, recovering ? 'BEATGRID DOCTOR IS RESTORING' : publishing ? 'BEATGRID DOCTOR IS REPAIRING' : 'BEATGRID DOCTOR IS CHECKING',
                recovering ? 'Restoring previous grids from verified backups. Audio stays unchanged.'
                    : `${current.toLocaleString()}${total ? ` of ${total.toLocaleString()}` : ''} songs. Audio stays unchanged.`,
                recovering ? 'RESTORING' : publishing ? 'REPAIRING' : 'CHECKING', recovering ? 0 : total ? Math.min(100, current / total * 100) : 0);
            const stop = document.getElementById('health-top-scan-status');
            if (stop) {
                if (!healthBeatgridLibraryBannerOwned) healthBeatgridLibraryBannerHandler = stop.onclick;
                stop.onclick = stopBeatgridLibraryScan;
                stop.disabled = publishing || recovering;
                stop.textContent = recovering ? 'RESTORING' : publishing ? 'REPAIRING' : 'STOP SAFELY';
                stop.setAttribute('aria-label', recovering ? 'Restoring; wait for previous grids to be restored'
                    : publishing ? 'Repairing; wait for cleanup to finish' : 'Stop the Beatgrid Doctor scan safely');
            }
            healthBeatgridLibraryBannerOwned = true;
        } else if (healthBeatgridLibraryBannerOwned) {
            setHealthTopScanBanner(false);
            const stop = document.getElementById('health-top-scan-status');
            if (stop) {
                stop.onclick = healthBeatgridLibraryBannerHandler;
                stop.disabled = false;
            }
            healthBeatgridLibraryBannerOwned = false;
        }
    }

    async function stopBeatgridLibraryScan() {
        if (!['starting', 'running'].includes(healthBeatgridLibraryState?.status)) return;
        healthBeatgridFullSendPending = null;
        try {
            await postBeatgridDoctorStep('/api/library/health/beatgrid_doctor/library_cancel',
                {provider: healthBeatgridDoctorTarget}, 'Could not stop the library scan.');
            await pollBeatgridLibrary(healthBeatgridDoctorTarget);
        } catch (error) {
            healthBeatgridLibraryError = error.message;
            paintBeatgridLibrary();
        }
    }

    async function pollBeatgridLibrary(provider) {
        const epoch = healthBeatgridLibraryEpoch;
        clearTimeout(healthBeatgridLibraryTimer);
        try {
            const response = await fetch(beatgridDoctorEndpoint(`/api/library/health/beatgrid_doctor/library_status?provider=${provider}`));
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Could not read cleanup progress.');
            if (provider !== healthBeatgridDoctorTarget || epoch !== healthBeatgridLibraryEpoch) return;
            if (healthBeatgridLibraryState?.run_id && data.audit?.run_id !== healthBeatgridLibraryState.run_id) healthBeatgridLibrarySelectedSongs.clear();
            healthBeatgridLibraryState = data.audit?.status ? data.audit : null;
            healthBeatgridLibraryBackupLocation = data.audit?.backup_location || null;
            healthBeatgridLibraryError = '';
            paintBeatgridLibrary();
            if (['starting', 'running', 'publishing', 'recovering'].includes(data.audit?.status)) {
                healthBeatgridLibraryTimer = setTimeout(() => pollBeatgridLibrary(provider), 1000);
            } else if (healthBeatgridFullSendPending?.provider === provider) {
                const pending = healthBeatgridFullSendPending;
                healthBeatgridFullSendPending = null;
                if (data.audit?.status === 'complete' && data.audit?.operation === pending.operation &&
                    Number(data.audit?.repair || 0) > Number(data.audit?.repaired_this_scan || 0)) {
                    void publishBeatgridLibrary({mode:'full'});
                }
            }
        } catch (error) {
            if (provider !== healthBeatgridDoctorTarget || epoch !== healthBeatgridLibraryEpoch) return;
            healthBeatgridLibraryError = error.message;
            paintBeatgridLibrary();
            // A lost response is not a stopped job. Reconnect instead of starting another write.
            if (['starting', 'running', 'publishing', 'recovering'].includes(healthBeatgridLibraryState?.status)) {
                healthBeatgridLibraryTimer = setTimeout(() => pollBeatgridLibrary(provider), 3000);
            }
        }
    }

    async function scanBeatgridLibrary(options = {}) {
        if (healthDjTransferBusy) return;
        if (healthDjTransferTask !== 'grids') selectHealthDjTransferTask('grids');
        const provider = healthBeatgridDoctorTarget;
        const picked = options.scope === 'full' ? [] : options.paths || [...healthBeatgridPickedSongs.keys()];
        healthBeatgridLibraryEpoch += 1;
        healthBeatgridLibraryError = '';
        healthBeatgridLibraryRows = [];
        healthBeatgridLibrarySelectedSongs.clear();
        healthBeatgridLibrarySongsPage = { offset: 0, loaded: false, busy: false };
        healthDjTransferControls(true);
        try {
            const data = await postBeatgridDoctorStep('/api/library/health/beatgrid_doctor/library_scan',
                {provider, scope: ['full', 'selection'].includes(options.scope) ? options.scope : 'test', limit: healthBeatgridDoctorTestLimit,
                    ...(options.operation ? {operation:options.operation} : {}),
                    ...(options.tasks ? {tasks:options.tasks} : {}),
                    ...(options.verification ? {verification:options.verification} : {}),
                    ...(options.source_ids ? {source_ids:options.source_ids} : {}),
                    ...(options.folder ? {folder:options.folder} : {}),
                    ...(picked.length ? {paths:picked} : {})},
                'Could not check your DJ library.');
            healthBeatgridLibraryState = data.audit;
            paintBeatgridLibrary();
            await pollBeatgridLibrary(provider);
        } catch (error) {
            healthBeatgridLibraryError = error.message;
            healthBeatgridFullSendPending = null;
            healthDjTransferControls(false);
            const detail = document.getElementById('health-dj-transfer-detail');
            if (detail) detail.innerHTML = healthBeatgridLibraryPanel();
        }
    }

    // The full-library check can start directly; writing still requires the
    // existing preview, closed-app checks and exact repair confirmation.
    async function startBeatgridDoctorScan() {
        if (window.axiomDjTransferReview || healthDjTransferBusy || healthBeatgridLibraryState?.rollback_required) return;
        const scope = document.getElementById('health-beatgrid-scan-scope')?.value === 'full' ? 'full' : 'test';
        return scanBeatgridLibrary({scope});
    }
    window.startBeatgridDoctorScan = startBeatgridDoctorScan;
    window.scanBeatgridLibrary = scanBeatgridLibrary;
    window.publishBeatgridLibrary = publishBeatgridLibrary;

    async function exportDjayBeatgrids(event = null) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (healthDjTransferBusy || window.axiomDjTransferReview || healthBeatgridLibraryState?.rollback_required) return;
        selectBeatgridDoctorTarget('serato');
        await scanBeatgridLibrary({operation:'export-djay-grids'});
    }

    async function showBeatgridLibrarySongs(offset = null, event = null) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (!['complete', 'published'].includes(healthBeatgridLibraryState?.status)) return;
        const page = healthBeatgridLibrarySongsPage;
        const filter = page.filter || beatgridLibraryDefaultFilter();
        const published = filter === 'published';
        const requestedOffset = offset === null ? page.offset : offset;
        if (page.busy || !Number.isInteger(requestedOffset) || requestedOffset < 0 ||
            (page.loaded && requestedOffset === page.offset)) return;
        page.busy = true;
        document.querySelectorAll('.health-beatgrid-song-pages button').forEach(button => { button.disabled = true; });
        const provider = healthBeatgridDoctorTarget;
        const epoch = healthBeatgridLibraryEpoch;
        const job = healthBeatgridLibraryState?.publish_job_id;
        const run = healthBeatgridLibraryState?.run_id;
        try {
            const response = await fetch(beatgridDoctorEndpoint(`/api/library/health/beatgrid_doctor/library_results?provider=${provider}&status=${filter}&offset=${requestedOffset}&limit=20`));
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Could not read the song list.');
            if (provider !== healthBeatgridDoctorTarget || epoch !== healthBeatgridLibraryEpoch ||
                page !== healthBeatgridLibrarySongsPage || run !== healthBeatgridLibraryState?.run_id ||
                job !== healthBeatgridLibraryState?.publish_job_id ||
                (data.audit?.publish_job_id && data.audit.publish_job_id !== job) ||
                (data.audit?.run_id && data.audit.run_id !== run)) return;
            if (!Array.isArray(data.rows)) throw new Error('Could not read the song list.');
            page.offset = requestedOffset;
            page.loaded = true;
            healthBeatgridLibraryError = '';
            if (published) {
                healthBeatgridLibraryState.published_rows = data.rows;
            } else healthBeatgridLibraryRows = data.rows;
            if (filter === 'collection') {
                healthBeatgridLibraryState.review_collection_entries = data.audit.review_collection_entries;
                healthBeatgridLibraryState.review_collection_name = data.audit.review_collection_name;
            }
        } catch (error) {
            if (provider !== healthBeatgridDoctorTarget || epoch !== healthBeatgridLibraryEpoch ||
                page !== healthBeatgridLibrarySongsPage) return;
            healthBeatgridLibraryError = error.message;
        } finally {
            page.busy = false;
            if (provider === healthBeatgridDoctorTarget && epoch === healthBeatgridLibraryEpoch &&
                page === healthBeatgridLibrarySongsPage) paintBeatgridLibrary();
        }
    }

    function selectBeatgridLibrarySongsFilter(filter) {
        const state = healthBeatgridLibraryState;
        const allowed = ['repair', ...(state?.status === 'published' ? ['published'] : []),
            ...(state?.status === 'published' && state.review_collection_name ? ['collection'] : []), 'attention', 'unavailable', 'alignment', 'bpm', 'bar_one', 'labels'];
        if (!['complete', 'published'].includes(state?.status) || !allowed.includes(filter)) return;
        healthBeatgridLibraryRows = [];
        healthBeatgridLibrarySongsPage = { filter, offset: 0, loaded: false, busy: false };
        paintBeatgridLibrary();
        showBeatgridLibrarySongs();
    }

    async function chooseBeatgridBackupLocation(mode, event) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (healthDjTransferBusy) return;
        const provider = healthBeatgridDoctorTarget;
        healthBeatgridLibraryEpoch += 1;
        healthBeatgridLibrarySongsPage = { offset: 0, loaded: false, busy: false };
        clearTimeout(healthBeatgridLibraryTimer);
        healthDjTransferControls(true);
        healthBeatgridLibraryError = '';
        try {
            const data = await postBeatgridDoctorStep('/api/library/health/beatgrid_doctor/library_backup_location',
                {provider, mode}, 'Could not select the backup location.');
            if (provider !== healthBeatgridDoctorTarget) return;
            healthBeatgridLibraryState = data.audit?.status ? data.audit : null;
            healthBeatgridLibraryBackupLocation = data.audit?.backup_location || null;
        } catch (error) {
            healthBeatgridLibraryError = error.message;
        } finally {
            paintBeatgridLibrary();
        }
    }

    async function publishBeatgridLibrary(options = {}) {
        if (healthDjTransferBusy || !['complete', 'published'].includes(healthBeatgridLibraryState?.status)) return;
        if (options.mode === 'full' && healthBeatgridLibraryState?.scan_scope === 'test') {
            healthBeatgridFullSendPending = {provider:healthBeatgridDoctorTarget, operation:healthBeatgridLibraryState.operation};
            await scanBeatgridLibrary({scope: 'full', operation:healthBeatgridLibraryState.operation});
            return;
        }
        const provider = healthBeatgridDoctorTarget;
        healthBeatgridLibraryEpoch += 1;
        healthBeatgridLibrarySongsPage = { ...healthBeatgridLibrarySongsPage, busy: false };
        const name = provider === 'serato' ? 'Serato' : 'djay Pro';
        const gridsOnly = healthBeatgridLibraryState?.operation === 'export-djay-grids';
        healthDjTransferControls(true);
        healthBeatgridLibraryError = '';
        try {
            const mode = options.mode === 'full' ? 'full' : 'test';
            const selection = mode === 'test' && healthBeatgridLibrarySelectedSongs.size
                ? {paths: [...healthBeatgridLibrarySelectedSongs]} : {};
            const preview = await postBeatgridDoctorStep('/api/library/health/beatgrid_doctor/library_prepare',
                {provider, mode, limit: healthBeatgridDoctorTestLimit, ...selection},
                'Could not prepare the cleanup.');
            const backupSize = preview.backup_bytes >= 1024**3 ? `${(preview.backup_bytes / 1024**3).toFixed(1)} GB`
                : `${Math.max(1, preview.backup_bytes / 1024**2).toFixed(0)} MB`;
            const repairs = Number(preview.repair_ready ?? preview.ready) || 0;
            const reviews = Number(preview.review_collection_entries) || 0;
            const reviewCopy = preview.review_collection_name
                ? ` ${reviews.toLocaleString()} ${reviews === 1 ? 'song' : 'songs'} will be in "${preview.review_collection_name}" to check.` : '';
            const approved = await showAxiomConfirm(gridsOnly ? `Send ${repairs.toLocaleString()} beatgrids to Serato`
                : repairs > 0 ? `Fix ${repairs.toLocaleString()} songs in ${name}` : `Run batch in ${name}`,
                `${gridsOnly ? 'Send verified djay beatgrids and BPM to the same files in Serato. Existing crates, cues, play counts and audio are preserved.' : `This changes beatgrids and BPM in ${name} only. Clean tracks, audio and cue points are preserved.`}${reviewCopy} Verified backups need ${backupSize} at ${preview.backup_location?.label || 'This Mac'}. Close both DJ apps before continuing.`,
                gridsOnly ? 'SEND GRIDS' : repairs > 0 ? 'FIX SONGS' : 'RUN BATCH', 'primary', 'transfer');
            if (!approved) return;
            const data = await postBeatgridDoctorStep('/api/library/health/beatgrid_doctor/library_publish',
                {provider, job_id: preview.job_id, preview_token: preview.preview_token, confirmed: true},
                'Could not publish the cleanup.');
            healthBeatgridLibraryState = data.audit;
            healthBeatgridLibrarySelectedSongs.clear();
            healthBeatgridLibraryRows = [];
            healthBeatgridLibrarySongsPage = { offset: 0, loaded: false, busy: false };
            await pollBeatgridLibrary(provider);
        } catch (error) {
            healthBeatgridLibraryError = error.message;
        } finally {
            paintBeatgridLibrary();
        }
    }

    async function recoverBeatgridLibrary() {
        if (healthDjTransferBusy || !healthBeatgridLibraryState?.rollback_required) return;
        const provider = healthBeatgridDoctorTarget;
        const name = provider === 'serato' ? 'Serato' : 'djay Pro';
        healthBeatgridLibraryEpoch += 1;
        healthBeatgridLibrarySongsPage = { ...healthBeatgridLibrarySongsPage, busy: false };
        clearTimeout(healthBeatgridLibraryTimer);
        healthDjTransferControls(true);
        healthBeatgridLibraryError = '';
        try {
            const preview = await postBeatgridDoctorStep('/api/library/health/beatgrid_doctor/library_recovery_preview',
                {provider}, 'Could not verify the saved backups.');
            const approved = await showAxiomConfirm(`Restore ${preview.ready.toLocaleString()} songs in ${name}`,
                'Restore the grids and BPM from before the interrupted cleanup. Audio and cue points are preserved. Close both DJ apps before continuing.',
                'RESTORE GRIDS', 'primary', 'transfer');
            if (!approved) return;
            const data = await postBeatgridDoctorStep('/api/library/health/beatgrid_doctor/library_recover',
                {provider, preview_token: preview.preview_token, confirmed: true}, 'Could not restore the previous grids.');
            healthBeatgridLibraryState = data.audit;
            await pollBeatgridLibrary(provider);
        } catch (error) {
            healthBeatgridLibraryError = error.message;
        } finally {
            paintBeatgridLibrary();
        }
    }

    function exportBeatgridLibraryReceipt() {
        if (!healthBeatgridLibraryState?.receipt_path) return;
        const link = document.createElement('a');
        link.href = beatgridDoctorEndpoint(`/api/library/health/beatgrid_doctor/library_receipt?provider=${healthBeatgridDoctorTarget}`);
        link.download = 'axiom-beatgrid-doctor-receipt.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
    }

    function healthBeatgridDoctorPanel() {
        if (!window.axiomDjTransferReview) return healthBeatgridLibraryPanel();
        const data = currentHealthBeatgridDoctorPreview;
        const number = value => Math.max(0, Number(value) || 0).toLocaleString();
        if (!data) {
            return `<h3 class="health-detail-title">Beatgrid Doctor</h3>
                <p class="health-transfer-result">Fix beatgrids before they hit your DJ software</p>
                <p>AXIOM checks your playlist, finds grids that start in the wrong place or drift off the beat, then prepares a cleaner handoff for Serato or djay so sync lands where DJs expect it. Your music files stay untouched, and anything uncertain is shown for review first.</p>
                <p class="health-transfer-note">Use Refresh Library above to run the Beatgrid Doctor audit. Test and full batch buttons appear beside it when the audit has clean grids ready.</p>`;
        }
        const summary = data.summary || {};
        const operator = data.operator_summary || {};
        const issues = data.issue_breakdown || [];
        const reviewQueue = data.review_queue || [];
        const tracks = data.tracks || [];
        const sources = data.sources || [];
        const reference = data.serato_reference || {};
        const referenceSummary = reference.summary || {};
        const referenceTracks = reference.tracks || [];
        const receipt = currentHealthBeatgridDoctorReceipt;
        const applied = currentHealthBeatgridDoctorApply;
        const proof = currentHealthBeatgridDoctorWriterProof;
        const djayProof = currentHealthBeatgridDoctorDjayWriterProof;
        const testPack = currentHealthBeatgridDoctorTestPack;
        const djayTestPack = currentHealthBeatgridDoctorDjayTestPack;
        const seratoLiveTest = currentHealthBeatgridDoctorSeratoLiveTest;
        const djayLiveTest = currentHealthBeatgridDoctorDjayLiveTest;
        const modernProof = testPack?.modern_serato_crate_proof;
        const review = Number(summary.needs_review) || 0;
        const evidenceLimit = Math.max(1, Number(data.evidence_display_limit) || 25);
        const rows = tracks.slice(0, evidenceLimit);
        const queueRows = reviewQueue.slice(0, 12);
        const selectedTestLimit = beatgridDoctorTestBatchLimit();
        const testBatchCount = Math.min(selectedTestLimit, Number(summary.sync_ready_grids) || 0);
        const fullBatchCount = Number(summary.sync_ready_grids) || 0;
        const flaggedTransferCount = Number(applied?.summary?.flagged_transfer_ready || 0);
        const fullBatchStaged = currentHealthBeatgridDoctorRunMode === 'full' && !!applied?.success && !!receipt;
        const targetLabel = beatgridDoctorTargetLabel();
        const sourceSummary = sources.map(source => `${source.name || 'THIS ONE'} (${number(source.matched_track_count)} ${Number(source.matched_track_count) === 1 ? 'track' : 'tracks'})`).join(' / ') || 'Selected playlist';
        const selectedPackRows = healthBeatgridDoctorTarget === 'djay'
            ? (djayLiveTest?.rows || djayTestPack?.rows)
            : (seratoLiveTest?.test_pack?.rows || testPack?.rows || djayLiveTest?.rows || djayTestPack?.rows);
        const packRows = (selectedPackRows || []).filter(row => row.status === 'written').slice(0, selectedTestLimit);
        const previewRows = tracks.filter(row => (row.sync_evidence || {}).sync_ready).slice(0, selectedTestLimit).map(row => ({
            title: row.title || row.path || 'Untitled',
            artist: row.artist || '',
            status: 'queued',
            provider: row.provider || row.grid_mode || 'Beatgrid Doctor',
        }));
        const displayRows = packRows.length ? packRows : previewRows;
        const testWritten = healthBeatgridDoctorTarget === 'serato'
            ? Number(seratoLiveTest?.summary?.visible_crate_tracks || testPack?.summary?.written || 0)
            : healthBeatgridDoctorTarget === 'djay'
                ? Number(djayLiveTest?.summary?.written || djayTestPack?.summary?.written || 0)
                : Math.max(
                    Number(seratoLiveTest?.summary?.visible_crate_tracks || testPack?.summary?.written || 0),
                    Number(djayLiveTest?.summary?.written || djayTestPack?.summary?.written || 0)
                );
        const testReady = !!(testPack?.success || djayTestPack?.success || seratoLiveTest?.success || djayLiveTest?.success);
        const liveTestReady = !!(seratoLiveTest?.success || djayLiveTest?.success);
        const seratoCrateName = seratoLiveTest?.crate_name || modernProof?.crate_name || 'test 1 Doctor feature';
        const userHeadline = fullBatchStaged ? 'Full batch staged' : liveTestReady ? 'Open your DJ software' : testReady ? 'Test batch ready' : 'Audit complete';
        const userResult = fullBatchStaged
            ? `${number(fullBatchCount)} ${fullBatchCount === 1 ? 'grid is' : 'grids are'} staged for ${targetLabel}`
            : testReady
            ? `${number(testWritten)} ${testWritten === 1 ? 'song was' : 'songs were'} prepared for checking`
            : `${number(testBatchCount)} ${testBatchCount === 1 ? 'song is' : 'songs are'} ready for a test batch`;
        const startCueSummary = (start) => {
            if (!start || !start.cue_found) return '';
            const label = start.label || 'START';
            const state = start.grid_aligned ? 'aligned' : 'review';
            const beat = Number(start.nearest_grid_beat);
            const bar = Number(start.nearest_grid_bar);
            const offset = start.grid_aligned && Number.isFinite(beat) && beat > 0
                ? `, ${Number.isFinite(bar) ? number(bar) + ' bars' : number(beat) + ' beats'} later`
                : '';
            return ` / ${escapeHtml(label)} ${escapeHtml(state)}${escapeHtml(offset)}`;
        };
        const testReadyNote = fullBatchStaged
            ? 'The full clean-grid plan is saved in AXIOM with a receipt. Live DJ-library publishing stays guarded until AXIOM can back up, write, read back and roll back the destination library.'
            : liveTestReady
            ? `Open ${seratoLiveTest && djayLiveTest ? 'Serato or djay' : seratoLiveTest ? 'Serato' : 'djay'} and check the visible ${seratoLiveTest && djayLiveTest ? 'test crate/playlist' : seratoLiveTest ? 'test crate' : 'test playlist'} named test 1 Doctor feature.`
            : testReady
            ? djayTestPack
                ? 'djay grid metadata was proved in a safe AXIOM library. The next guarded product step is publishing those same corrected grids into a visible djay test playlist.'
                : 'Open the test crate or imported copied tracks, check the grids, then run the full batch if the result feels trustworthy.'
            : 'Run Test Batch to create copied test tracks. Nothing live is changed until a later reviewed publishing step.';
        return `<h3 class="health-detail-title">Beatgrid Doctor</h3>
            <p class="health-transfer-result">${userResult}</p>
            <div class="health-transfer-review-list">
                <div><span>Status</span><span>${escapeHtml(userHeadline)}</span></div>
                <div><span>Fix target</span><span>${escapeHtml(targetLabel)}</span></div>
                <div><span>Source</span><span>${escapeHtml(sourceSummary)}</span></div>
                <div><span>Test batch</span><span>${testReady ? `${number(testWritten)} prepared` : `${number(testBatchCount)} waiting for Run Test Batch`}</span></div>
                <div><span>Full batch</span><span>${fullBatchStaged ? `${number(fullBatchCount)} clean-grid plans staged` : fullBatchCount ? `${number(fullBatchCount)} sync-ready grids available after the test feels right` : 'No full batch ready yet'}</span></div>
                ${flaggedTransferCount ? `<div><span>Flagged but included</span><span>${number(flaggedTransferCount)} sync-ready ${flaggedTransferCount === 1 ? 'track' : 'tracks'} will transfer with a warning</span></div>` : ''}
                ${testPack ? `<div><span>Serato test crate</span><span>${escapeHtml(seratoCrateName)} / ${number(testPack.summary?.verified_crate_tracks)} tracks verified</span></div>` : ''}
                ${djayTestPack ? `<div><span>djay test pack</span><span>${number(djayTestPack.summary?.readback_verified)} grids read back</span></div>` : ''}
                ${seratoLiveTest ? `<div><span>Visible Serato crate</span><span>${escapeHtml((seratoLiveTest.serato_lookup || [seratoLiveTest.crate_name || 'test 1 Doctor feature'])[0])}</span></div>` : ''}
                ${djayLiveTest ? `<div><span>Visible djay playlist</span><span>${escapeHtml(djayLiveTest.playlist_name || 'test 1 Doctor feature')}</span></div>` : ''}
                ${receipt ? `<div><span>Receipt</span><span>Saved and ready to export</span></div>` : ''}
            </div>
            <p class="health-transfer-note">${escapeHtml(testReadyNote)}</p>
            <details class="health-transfer-disclosure"><summary>${testReady ? `View ${number(displayRows.length)} test songs` : `Preview ${number(displayRows.length)} songs in the test batch`}</summary>
                <div class="health-transfer-review-list">${displayRows.map(row => `<div><span>${escapeHtml(row.title || 'Untitled')}<small>${escapeHtml(row.artist || row.provider || '')}</small></span><span>${testReady ? 'Prepared' : 'Ready'}<small>${escapeHtml(row.copy_path || row.provider || '')}</small></span></div>`).join('') || '<div><span>No test songs ready yet</span><span>Run the audit first</span></div>'}</div>
            </details>
            <details class="health-transfer-disclosure"><summary>Advanced Doctor Evidence</summary>
                <p>${number(summary.analysis_found)} had djay analysis. ${number(summary.fluid_grids)} fluid grids, ${number(summary.straight_grids)} straight grids, ${number(summary.manual_edits)} with manual edits.</p>
                <p>${number(summary.sync_ready_grids)} sync-ready beatgrids; ${number(summary.sync_review_grids)} need timing review before sync/transfer.</p>
                ${summary.playable_start_cues ? `<p>${number(summary.playable_start_cues)} START cue ${Number(summary.playable_start_cues) === 1 ? 'signal was' : 'signals were'} found. ${number(summary.playable_start_aligned)} align with the playable grid; ${number(summary.playable_start_off_bar)} are on beat but off bar; ${number(summary.playable_start_conflicts)} need review.</p>` : ''}
                ${summary.bar_phase_corrections ? `<p>${number(summary.bar_phase_corrections)} syncable ${Number(summary.bar_phase_corrections) === 1 ? 'grid needs' : 'grids need'} START/bar correction before handoff.</p>` : ''}
                <p>${number(summary.plan_preserve)} ready to preserve, ${number(summary.plan_repair)} need repair planning, ${number(summary.plan_review)} need DJ review before a clean-grid transfer.</p>
                <p>${number(summary.serato_reference_tracks)} tracks found in ${escapeHtml(reference.name || 'AXIOM CORRECT BEATGRIDS')}; ${number(summary.serato_reference_locked)} are locked clean-grid references. ${number(summary.serato_reference_matches)} selected djay tracks match that reference.</p>
                <p>Serato to djay plan: ${number(referenceSummary.preserve)} preserve, ${number(referenceSummary.repair)} repair, ${number(referenceSummary.review)} review. ${number(referenceSummary.path_matched)} local files matched, ${number(referenceSummary.embedded_grids_readable)} embedded Serato grids readable.</p>
                ${applied ? `<div class="health-transfer-review-list"><div><span>Clean-grid cache saved</span><span>${number(applied.summary?.clean_grid_items_saved)} plans</span></div><div><span>Serato grids captured</span><span>${number(applied.summary?.serato_clean_grid_items_saved)} readable grids / ${number(applied.summary?.serato_locked_grid_items_saved)} locked</span></div><div><span>AXIOM BPM corrected</span><span>${number(applied.summary?.axiom_bpm_updated)} from grid timing</span></div><div><span>Transfers now use</span><span>AXIOM clean-grid cache</span></div></div>` : ''}
                ${proof ? `<div class="health-transfer-review-list"><div><span>Serato writer proof</span><span>${proof.success ? 'Passed' : 'Failed'}</span></div><div><span>Read-back</span><span>${number(proof.summary?.readback_anchors)} anchors / ${proof.summary?.readback_bpm ? escapeHtml(proof.summary.readback_bpm) : '-'} BPM</span></div><div><span>Rollback</span><span>${proof.summary?.rollback_verified ? 'Verified' : 'Not verified'}</span></div></div>` : ''}
                ${djayProof ? `<div class="health-transfer-review-list"><div><span>djay writer proof</span><span>${djayProof.success ? 'Passed' : 'Failed'}</span></div><div><span>Read-back</span><span>${number(djayProof.summary?.readback_beats)} beats / ${escapeHtml(djayProof.summary?.readback_mode || '-')}</span></div><div><span>Rollback</span><span>${djayProof.summary?.rollback_verified ? 'Verified' : 'Not verified'}</span></div></div>` : ''}
                ${testPack ? `<div class="health-transfer-review-list"><div><span>Clean Serato handoff pack</span><span>${number(testPack.summary?.written)} copied tracks written / ${number(testPack.summary?.verified_crate_tracks)} legacy crate tracks verified</span></div><div><span>Modern Serato proof</span><span>${modernProof?.success ? `${number(modernProof.verified_tracks)} root.sqlite tracks verified on a copied database` : escapeHtml(modernProof?.message || 'Not checked')}</span></div><div><span>Skipped</span><span>${number(testPack.summary?.skipped)} unsupported or missing / ${number(testPack.summary?.failed)} failed</span></div><div><span>Disk guard</span><span>Keeping latest ${number(testPack.retention?.keep || 5)} copied handoff packs${testPack.retention?.removed ? `; removed ${number(testPack.retention.removed)} old ${Number(testPack.retention.removed) === 1 ? 'pack' : 'packs'}` : ''}</span></div><div><span>Import playlist</span><span>${escapeHtml(testPack.playlist_path || '')}</span></div><div><span>Disposable crate</span><span>${escapeHtml(testPack.disposable_crate_path || '')}</span></div><div><span>Import folder</span><span>${escapeHtml(testPack.tracks_root || '')}</span></div></div>` : ''}
                ${djayTestPack ? `<div class="health-transfer-review-list"><div><span>Clean djay proof pack</span><span>${number(djayTestPack.summary?.written)} copied tracks written / ${number(djayTestPack.summary?.readback_verified)} grids read back</span></div><div><span>Disposable djay library</span><span>${escapeHtml(djayTestPack.djay_library_path || '')}</span></div><div><span>Skipped</span><span>${number(djayTestPack.summary?.skipped)} missing / ${number(djayTestPack.summary?.failed)} failed</span></div><div><span>Disk guard</span><span>Keeping latest ${number(djayTestPack.retention?.keep || 5)} copied djay packs${djayTestPack.retention?.removed ? `; removed ${number(djayTestPack.retention.removed)} old ${Number(djayTestPack.retention.removed) === 1 ? 'pack' : 'packs'}` : ''}</span></div><div><span>Audio playlist only</span><span>${escapeHtml(djayTestPack.playlist_path || '')}</span></div><div><span>Copied audio tracks</span><span>${escapeHtml(djayTestPack.tracks_root || '')}</span></div></div>` : ''}
                ${seratoLiveTest ? `<div class="health-transfer-review-list"><div><span>Visible Serato crate</span><span>${number(seratoLiveTest.summary?.visible_crate_tracks)} copied tracks</span></div><div><span>Find it in Serato</span><span>${escapeHtml((seratoLiveTest.serato_lookup || [seratoLiveTest.crate_name || 'test 1 Doctor feature']).join(' / '))}</span></div><div><span>Receipt</span><span>${escapeHtml(seratoLiveTest.receipt_path || '')}</span></div></div>` : ''}
                ${djayLiveTest ? `<div class="health-transfer-review-list"><div><span>Visible djay playlist</span><span>${escapeHtml(djayLiveTest.playlist_name || 'test 1 Doctor feature')}</span></div><div><span>Clean grids written</span><span>${number(djayLiveTest.summary?.written)} tracks / ${number(djayLiveTest.summary?.readback_verified)} read back</span></div><div><span>Backups</span><span>${escapeHtml(djayLiveTest.backup_root || '')}</span></div><div><span>Receipt</span><span>${escapeHtml(djayLiveTest.receipt_path || '')}</span></div></div>` : ''}
                <div class="health-transfer-review-list">${sources.map(source => `<div><span>${escapeHtml(source.name || 'THIS ONE')}</span><span>${number(source.matched_track_count)} matched ${Number(source.matched_track_count) === 1 ? 'track' : 'tracks'}</span></div>`).join('') || '<div><span>THIS ONE</span><span>No matching playlist found</span></div>'}</div>
                ${issues.length ? `<div class="health-transfer-review-list">${issues.map(issue => `<div><span>${escapeHtml(issue.label || issue.key)}</span><span>${number(issue.count)}</span></div>`).join('')}</div>` : ''}
                <div class="health-transfer-review-list">${queueRows.map(row => { const plan = row.plan || {}; return `<div><span>${escapeHtml(row.title || 'Untitled')}<small>${escapeHtml(row.artist || '')}</small></span><span>${escapeHtml(plan.label || 'Review')}<small>${escapeHtml(plan.reason || (row.reasons || []).join(' '))}</small></span></div>`; }).join('') || '<div><span>No urgent review items</span><span>Clean-grid evidence can be preserved later</span></div>'}</div>
                ${review > queueRows.length ? `<p>Showing ${number(queueRows.length)} review examples. The full review queue is saved in the receipt.</p>` : ''}
                <div class="health-transfer-table" tabindex="0" role="region" aria-label="Serato corrected beatgrid reference"><table><thead><tr><th>Track</th><th>BPM</th><th>Key</th><th>Grid</th><th>Serato → djay Plan</th></tr></thead><tbody>
                ${referenceTracks.slice(0, 40).map(row => { const plan = row.clean_plan || {}; return `<tr><td><strong>${escapeHtml(row.title || row.file_name || 'Untitled')}</strong><small>${escapeHtml(row.artist || row.filename || '')}</small></td><td>${row.bpm ? escapeHtml(row.bpm) : '-'}</td><td>${escapeHtml(row.key || '-')}</td><td>${row.is_beatgrid_locked ? 'Locked' : 'Unlocked'}<small>${row.path_matched ? 'local file matched' : 'path needs match'} / ${escapeHtml(row.embedded_serato_grid_status || 'not checked')}</small></td><td>${escapeHtml(plan.label || 'Review')}<small>${escapeHtml(plan.reason || '')}</small></td></tr>`; }).join('') || '<tr><td colspan="5">No Serato reference crate found yet.</td></tr>'}
                </tbody></table></div>
                <div class="health-transfer-table" tabindex="0" role="region" aria-label="Beatgrid Doctor evidence"><table><thead><tr><th>Track</th><th>Grid</th><th>BPM</th><th>Reference</th><th>Plan</th><th>Verdict</th></tr></thead><tbody>
                ${rows.map(row => { const plan = row.clean_plan || {}; const start = row.playable_start || {}; const sync = row.sync_evidence || {}; return `<tr><td><strong>${escapeHtml(row.title || row.path || 'Untitled')}</strong><small>${escapeHtml(row.artist || row.extension || '')}</small></td><td>${escapeHtml(row.grid_mode || 'unknown')}<small>${number(row.beat_count)} beats / ${escapeHtml(sync.sync_ready ? 'sync-ready' : 'sync review')}${row.manual_edits_present ? ' / manual edits' : ''}${startCueSummary(start)}</small></td><td>${row.analysis_bpm ? escapeHtml(row.analysis_bpm) : '-'}${row.djay_bpm ? `<small>djay ${escapeHtml(row.djay_bpm)}</small>` : ''}</td><td>${row.serato_reference_locked ? 'Locked Serato match' : row.serato_reference_status === 'matched_unlocked_reference' ? 'Serato match' : 'No reference'}${row.serato_reference_bpm ? `<small>${escapeHtml(row.serato_reference_bpm)} BPM ${escapeHtml(row.serato_reference_key || '')}</small>` : ''}</td><td>${escapeHtml(plan.label || 'Review')}<small>${escapeHtml(plan.reason || '')}</small></td><td>${escapeHtml(row.verdict || 'needs_review')}<small>${escapeHtml((row.reasons || []).join(' '))}</small></td></tr>`; }).join('') || '<tr><td colspan="6">No tracks were available for grid review.</td></tr>'}
                </tbody></table></div>
                ${tracks.length > rows.length ? `<p>Showing ${number(rows.length)} of ${number(tracks.length)} tracks.</p>` : ''}
                ${receipt ? `<div class="health-transfer-review-list"><div><span>Test receipt ready</span><span>${escapeHtml(receipt.receipt_id || '')}</span></div><div><span>Saved to</span><span>${escapeHtml(receipt.receipt_path || '')}</span></div><div><span>Human receipt</span><span>${escapeHtml(receipt.receipt?.human_receipt?.headline || 'Summary saved')}</span></div></div>` : ''}
                <div class="health-transfer-footer"><button id="health-dj-transfer-grid-apply" class="health-transfer-primary" type="button" onclick="applyBeatgridDoctorCleanCache()">Apply Clean Grid to AXIOM</button><button id="health-dj-transfer-grid-proof" class="health-transfer-primary" type="button" onclick="proveBeatgridDoctorSeratoWriter()">Prove Serato Writer</button><button id="health-dj-transfer-grid-djay-proof" class="health-transfer-primary" type="button" onclick="proveBeatgridDoctorDjayWriter()">Prove djay Writer</button><button id="health-dj-transfer-grid-pack" class="health-transfer-primary" type="button" onclick="createBeatgridDoctorSeratoTestPack()">Create Serato Test Pack</button><button id="health-dj-transfer-grid-djay-pack" class="health-transfer-primary" type="button" onclick="createBeatgridDoctorDjayTestPack()">Create djay Test Pack</button></div>
            </details>
            <p class="health-transfer-note">Live Serato and djay libraries stay protected during this test flow.</p>`;
    }

    function beatgridDoctorTestBatchLimit() {
        return healthBeatgridDoctorTestLimit;
    }

    function beatgridDoctorTargetLabel() {
        if (healthBeatgridDoctorTarget === 'serato') return 'Serato only';
        if (healthBeatgridDoctorTarget === 'djay') return 'djay only';
        return 'Serato and djay';
    }

    function selectBeatgridDoctorTestLimit(limit, event = null) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        const requested = Number(limit);
        healthBeatgridDoctorTestLimit = [5, 7, 10].includes(requested) ? requested : 10;
        while (healthBeatgridPickedSongs.size > healthBeatgridDoctorTestLimit)
            healthBeatgridPickedSongs.delete([...healthBeatgridPickedSongs.keys()].at(-1));
        if (!window.axiomDjTransferReview) {
            paintBeatgridLibrary();
            return;
        }
        if (currentHealthDjTransferPreview) renderHealthDjTransferPreview(currentHealthDjTransferPreview);
        else {
            const detail = document.getElementById('health-dj-transfer-detail');
            if (detail) detail.innerHTML = healthBeatgridDoctorPanel();
        }
        healthDjTransferControls(false);
    }

    function selectBeatgridDoctorTarget(target, event = null) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (healthDjTransferBusy) return;
        if (!['serato', 'djay', 'both'].includes(target)) return;
        if (!window.axiomDjTransferReview && target === 'both') return;
        window.AxiomHealthDoctor?.syncProvider(target);
        if (target !== healthBeatgridDoctorTarget) {
            healthBeatgridFullSendPending = null;
            healthBeatgridDoctorTarget = target;
            healthBeatgridLibraryEpoch += 1;
            healthBeatgridLibraryState = null;
            healthBeatgridLibraryBackupLocation = null;
            healthBeatgridLibraryRows = [];
            healthBeatgridLibrarySelectedSongs.clear();
            healthBeatgridPickedSongs.clear();
            healthBeatgridCandidateQuery = '';
            healthBeatgridCandidateRows = [];
            healthBeatgridCandidateError = '';
            clearTimeout(healthBeatgridCandidateTimer);
            healthBeatgridCandidateEpoch += 1;
            healthBeatgridLibrarySongsPage = { offset: 0, loaded: false, busy: false };
            healthBeatgridLibraryError = '';
            clearTimeout(healthBeatgridLibraryTimer);
            currentHealthBeatgridDoctorReceipt = null;
            currentHealthBeatgridDoctorTestPack = null;
            currentHealthBeatgridDoctorDjayTestPack = null;
            currentHealthBeatgridDoctorSeratoLiveTest = null;
            currentHealthBeatgridDoctorDjayLiveTest = null;
            currentHealthBeatgridDoctorRunMode = 'idle';
        }
        if (currentHealthDjTransferPreview) renderHealthDjTransferPreview(currentHealthDjTransferPreview);
        else {
            const detail = document.getElementById('health-dj-transfer-detail');
            if (detail) detail.innerHTML = healthBeatgridDoctorPanel();
        }
        healthDjTransferControls(false);
        if (!window.axiomDjTransferReview) void pollBeatgridLibrary(healthBeatgridDoctorTarget);
    }

    function beatgridDoctorEndpoint(path) {
        try {
            const query = new URLSearchParams(window.location.search);
            if (window.location.hostname === '127.0.0.1' && query.get('review') === 'health'
                && query.get('ui_preview') === 'beatgrid-doctor') {
                return `${path}${path.includes('?') ? '&' : '?'}review=health&ui_preview=beatgrid-doctor`;
            }
        } catch (error) {}
        return path;
    }

    function renderHealthDjTransferPreview(data) {
        currentHealthDjTransferPreview = data;
        const detail = document.getElementById('health-dj-transfer-detail');
        if (!detail) return;
        const number = value => Math.max(0, Number(value) || 0).toLocaleString();
        const summary = data.summary || {};
        const rows = data.samples || [];
        const bpm = data.bpm_guard_samples || [];
        const errors = [...(data.serato?.errors || []), ...(data.djay?.errors || [])];
        const trackDetails = `<details class="health-transfer-disclosure"><summary>Track details (${number(summary.serato_matches)})</summary>
            <p>Higher totals are preserved, never added together. Showing ${number(rows.length)} of ${number(summary.serato_matches)} matches.</p>
            <div class="health-transfer-table" tabindex="0" role="region" aria-label="Play count comparison"><table><thead><tr><th>Track</th><th>Serato</th><th>djay</th><th>Proposed</th><th>Match</th></tr></thead><tbody>
            ${rows.map(row => `<tr><td><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.artist || '')}</small></td><td>${number(row.serato_play_count)}</td><td>${number(row.djay_play_count)}</td><td>${row.ambiguous ? '-' : number(row.proposed_play_count)}</td><td>${row.ambiguous ? 'Conflict' : row.match_source === 'exact_path' ? 'Exact path' : 'Review file location'}</td></tr>`).join('') || '<tr><td colspan="5">No stored play-count matches found. Serato 4 library data is required for this preview.</td></tr>'}
            </tbody></table></div><p>Uncertain locations and conflicts require review.</p><p>Local Mac only. iCloud play-count syncing has not been verified.</p></details>`;
        let content;
        if (healthDjTransferTask === 'playlists') {
            content = healthDjTransferPlaylistPanel(data);
        } else if (healthDjTransferTask === 'grids') {
            content = healthBeatgridDoctorPanel();
        } else if (healthDjTransferTask === 'bpm') {
            const protectedRows = data.bpm_guard_protected || [];
            content = `<h3 class="health-detail-title">BPM Guard</h3>
                <p class="health-transfer-result">${number(summary.bpm_guard_candidates)} ${summary.bpm_guard_candidates === 1 ? 'track' : 'tracks'} to review</p>
                <p>AXIOM only. djay BPM stays unchanged.</p>
                <p>${number(summary.bpm_guard_protected)} protected tempos${summary.bpm_guard_doubled ? ` / ${number(summary.bpm_guard_doubled)} doubled in the latest comparison` : ''}</p>
                ${bpm.length ? `<details class="health-transfer-disclosure"><summary>Track details</summary><ul>${bpm.map(row => `<li>${escapeHtml(row.title)}: ${number(row.current_bpm)} to ${number(row.corrected_bpm)} BPM</li>`).join('')}</ul></details>` : ''}
                ${protectedRows.length ? `<details class="health-transfer-disclosure"><summary>Protected tracks</summary><ul>${protectedRows.map(row => `<li>${escapeHtml(row.title || row.path)}: ${number(row.approved_bpm)} BPM${row.doubled ? ` / djay shows ${number(row.observed_bpm)}` : ''}</li>`).join('')}</ul></details>` : ''}
                <button id="health-dj-transfer-bpm" class="health-transfer-primary" type="button" onclick="applyDjayBpmGuard()">Approve & Protect Tempos</button>`;
        } else {
            const countStatus = healthDjTransferCountStatus(data);
            const ready = countStatus.ready;
            const reviewable = healthTransferReviewablePaths(data);
            const uncertain = reviewable.length;
            const pages = Math.max(1, Math.ceil(uncertain / 40));
            healthDjTransferPathPage = Math.min(healthDjTransferPathPage, pages - 1);
            const reviewRows = reviewable.slice(healthDjTransferPathPage * 40, (healthDjTransferPathPage + 1) * 40);
            content = `${healthDjTransferBrandRoute('Serato', 'djay Pro')}<h3 class="health-detail-title">Bring your play counts with you</h3>
                <p id="health-transfer-count-result" class="health-transfer-result" aria-live="polite">${countStatus.result}</p>
                <p id="health-transfer-count-status" class="health-transfer-status">${countStatus.status}</p>
                <p id="health-transfer-count-excluded" ${countStatus.excluded ? '' : 'hidden'}>${countStatus.exclusion}</p>
                ${uncertain ? `<details id="health-transfer-path-review" class="health-transfer-disclosure"><summary>Confirm ${number(uncertain)} file locations</summary><p>Only confirm when both locations refer to the same file and edit.</p>
                    <label class="health-transfer-path-choice"><input id="health-transfer-paths-all" type="checkbox" onchange="confirmAllHealthTransferPaths(this)"><span>I confirm all ${number(uncertain)} matched file locations</span></label>
                    ${reviewRows.map(row => `<label class="health-transfer-path-choice"><input type="checkbox" value="${escapeHtml(row.path)}" ${healthDjTransferConfirmedPaths.has(row.path) ? 'checked' : ''} onchange="confirmHealthTransferPath(this)"><span>${escapeHtml(row.title)}<small>Serato: ${escapeHtml(row.serato_relative_path || '')}<br>djay: ${escapeHtml(row.path)}</small></span></label>`).join('')}
                    ${pages > 1 ? `<div class="health-transfer-footer"><button type="button" ${healthDjTransferPathPage === 0 ? 'disabled' : ''} onclick="pageHealthTransferPaths(-1)">Previous</button><span>${healthDjTransferPathPage + 1} of ${pages}</span><button type="button" ${healthDjTransferPathPage + 1 >= pages ? 'disabled' : ''} onclick="pageHealthTransferPaths(1)">Next</button></div>` : ''}</details>` : ''}
                ${ready || uncertain ? '<button id="health-dj-transfer-copy" class="health-transfer-primary" type="button" onclick="copySeratoPlaysToDjay()">Copy Play Counts to djay</button>' : ''}
                ${trackDetails}`;
        }
        detail.innerHTML = `${window.axiomDjTransferReview ? '<span class="health-transfer-sample"><span></span>Interactive example <small>No library changes</small></span>' : ''}${content}
            ${errors.length ? `<details class="health-transfer-disclosure"><summary>Library read warnings (${number(errors.length)})</summary><p role="alert">${errors.map(escapeHtml).join('; ')}</p></details>` : ''}`;
    }

    async function previewHealthDjTransfer() {
        if (healthDjTransferBusy) return;
        if (healthDjTransferTask === 'grids') {
            return previewBeatgridDoctor();
        }
        healthDjTransferConfirmedPaths.clear();
        healthDjTransferPathPage = 0;
        window.AxiomHealthCockpit?.open('transfer');
        healthDjTransferControls(true);
        healthDjTransferPlaylistStep = 'choose';
        healthDjTransferPlaylistReceipt = null;
        healthDjTransferPlaylistError = '';
        healthDjTransferLocationsConfirmed = false;
        if (healthDjTransferTask === 'plays') healthDjTransferCountMessage = 'Reading DJ libraries...';
        const detail = document.getElementById('health-dj-transfer-detail');
        if (detail) detail.innerHTML = healthDjTransferPendingPanel(healthDjTransferTask,
            healthDjTransferTask === 'playlists' ? 'Reading Serato crates and djay playlists...' : 'Reading Serato and djay play counts...');
        try {
            if (window.axiomDjTransferReview) {
                renderHealthDjTransferPreview(window.axiomDjTransferReview);
                return;
            }
            const response = await fetch('/api/library/health/dj_transfer/preview');
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Could not compare DJ libraries.');
            const available = new Set(healthDjTransferSources(data).filter(source => source.matched_track_count).map(source => source.id));
            healthDjTransferSelectedSources.forEach(id => { if (!available.has(id)) healthDjTransferSelectedSources.delete(id); });
            renderHealthDjTransferPreview(data);
            if (healthDjTransferTask === 'playlists' && healthTransferSavedJob()) {
                healthDjTransferControls(false);
                await exportDjayLibraryToSerato();
            }
        } catch (error) {
            currentHealthDjTransferPreview = null;
            if (healthDjTransferTask === 'plays') healthDjTransferCountMessage = error.message;
            if (detail) detail.innerHTML = healthDjTransferPendingPanel(healthDjTransferTask, error.message);
            showToast(error.message);
        } finally {
            healthDjTransferControls(false);
        }
    }

    async function previewBeatgridDoctor() {
        if (!window.axiomDjTransferReview) return scanBeatgridLibrary();
        if (healthDjTransferBusy || window.axiomDjTransferReview) return;
        if (healthDjTransferTask !== 'grids') selectHealthDjTransferTask('grids');
        const detail = document.getElementById('health-dj-transfer-detail');
        healthDjTransferControls(true);
        if (detail) detail.textContent = 'Reading djay beatgrid evidence...';
        try {
            const selected = healthDjTransferSources().filter(source => healthDjTransferSelectedSources.has(source.id) && source.matched_track_count);
            const payload = selected.length
                ? {source_ids: selected.map(source => source.id)}
                : {playlist_name: 'AXIOM BEATGRID Feature'};
            const response = await fetch(beatgridDoctorEndpoint('/api/library/health/beatgrid_doctor/preview'), {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Beatgrid Doctor could not read the playlist.');
            currentHealthBeatgridDoctorPreview = data;
            currentHealthBeatgridDoctorReceipt = null;
            currentHealthBeatgridDoctorApply = null;
            currentHealthBeatgridDoctorWriterProof = null;
            currentHealthBeatgridDoctorDjayWriterProof = null;
            currentHealthBeatgridDoctorTestPack = null;
            currentHealthBeatgridDoctorDjayTestPack = null;
            currentHealthBeatgridDoctorSeratoLiveTest = null;
            currentHealthBeatgridDoctorDjayLiveTest = null;
            currentHealthBeatgridDoctorRunMode = 'idle';
            if (currentHealthDjTransferPreview) renderHealthDjTransferPreview(currentHealthDjTransferPreview);
            else if (detail) detail.innerHTML = healthBeatgridDoctorPanel();
        } catch (error) {
            if (detail) detail.textContent = error.message;
            showToast(error.message);
        } finally {
            healthDjTransferControls(false);
        }
    }

    function beatgridDoctorPayload() {
        const selected = healthDjTransferSources().filter(source => healthDjTransferSelectedSources.has(source.id) && source.matched_track_count);
        const payload = selected.length
            ? {source_ids: selected.map(source => source.id)}
            : {playlist_name: currentHealthBeatgridDoctorPreview?.playlist_name || 'AXIOM BEATGRID Feature'};
        if (currentHealthBeatgridDoctorPreview?.preview_token) payload.preview_token = currentHealthBeatgridDoctorPreview.preview_token;
        return payload;
    }

    function beatgridDoctorReceiptPayload() {
        const payload = beatgridDoctorPayload();
        const handoffArtifacts = {};
        if (currentHealthBeatgridDoctorTestPack?.pack_root) {
            handoffArtifacts.serato_test_pack = currentHealthBeatgridDoctorTestPack;
        }
        if (currentHealthBeatgridDoctorDjayTestPack?.pack_root) {
            handoffArtifacts.djay_test_pack = currentHealthBeatgridDoctorDjayTestPack;
        }
        if (currentHealthBeatgridDoctorSeratoLiveTest?.receipt_path) {
            handoffArtifacts.serato_live_test_crate = currentHealthBeatgridDoctorSeratoLiveTest;
        }
        if (currentHealthBeatgridDoctorDjayLiveTest?.receipt_path) {
            handoffArtifacts.djay_live_test_playlist = currentHealthBeatgridDoctorDjayLiveTest;
        }
        if (Object.keys(handoffArtifacts).length) payload.handoff_artifacts = handoffArtifacts;
        return payload;
    }

    async function postBeatgridDoctorStep(path, payload, fallbackError) {
        const response = await fetch(beatgridDoctorEndpoint(path), {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload || {})
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            if (healthDjTransferIsDjSoftwareOpen(data)) await showHealthDjSoftwareOpenWarning(data);
            throw new Error(data.error || fallbackError);
        }
        return data;
    }

    async function prepareBeatgridDoctorTestReceipt() {
        if (!window.axiomDjTransferReview) return exportBeatgridLibraryReceipt();
        if (healthDjTransferBusy || window.axiomDjTransferReview || !currentHealthBeatgridDoctorPreview?.preview_token) return;
        if (healthDjTransferTask !== 'grids') selectHealthDjTransferTask('grids');
        healthDjTransferControls(true);
        const detail = document.getElementById('health-dj-transfer-detail');
        try {
            const data = await postBeatgridDoctorStep('/api/library/health/beatgrid_doctor/prepare_test',
                beatgridDoctorReceiptPayload(), 'Beatgrid Doctor could not prepare a test receipt.');
            currentHealthBeatgridDoctorReceipt = {
                receipt_id: data.receipt_id,
                receipt_path: data.receipt_path,
                receipt: data.receipt
            };
            if (currentHealthDjTransferPreview) renderHealthDjTransferPreview(currentHealthDjTransferPreview);
            else if (detail) detail.innerHTML = healthBeatgridDoctorPanel();
            showToast('Beatgrid Doctor test receipt prepared.');
        } catch (error) {
            if (detail) detail.innerHTML = healthBeatgridDoctorPanel();
            showToast(error.message || 'Beatgrid Doctor test receipt failed.');
        } finally {
            healthDjTransferControls(false);
        }
    }

    async function applyBeatgridDoctorCleanCache() {
        if (healthDjTransferBusy || window.axiomDjTransferReview || !currentHealthBeatgridDoctorPreview?.preview_token) return;
        if (healthDjTransferTask !== 'grids') selectHealthDjTransferTask('grids');
        healthDjTransferControls(true);
        const detail = document.getElementById('health-dj-transfer-detail');
        try {
            const data = await postBeatgridDoctorStep('/api/library/health/beatgrid_doctor/apply_clean_cache',
                beatgridDoctorPayload(), 'Beatgrid Doctor could not apply clean grids.');
            currentHealthBeatgridDoctorApply = data;
            currentHealthBeatgridDoctorWriterProof = null;
            currentHealthBeatgridDoctorDjayWriterProof = null;
            currentHealthBeatgridDoctorTestPack = null;
            currentHealthBeatgridDoctorDjayTestPack = null;
            currentHealthBeatgridDoctorSeratoLiveTest = null;
            currentHealthBeatgridDoctorDjayLiveTest = null;
            if (currentHealthDjTransferPreview) renderHealthDjTransferPreview(currentHealthDjTransferPreview);
            else if (detail) detail.innerHTML = healthBeatgridDoctorPanel();
            showToast(data.message || 'Beatgrid Doctor clean-grid cache saved.');
        } catch (error) {
            if (detail) detail.innerHTML = healthBeatgridDoctorPanel();
            showToast(error.message || 'Beatgrid Doctor clean-grid apply failed.');
        } finally {
            healthDjTransferControls(false);
        }
    }

    async function proveBeatgridDoctorSeratoWriter() {
        if (healthDjTransferBusy || window.axiomDjTransferReview || !currentHealthBeatgridDoctorApply?.success) return;
        if (healthDjTransferTask !== 'grids') selectHealthDjTransferTask('grids');
        healthDjTransferControls(true);
        const detail = document.getElementById('health-dj-transfer-detail');
        try {
            const data = await postBeatgridDoctorStep('/api/library/health/beatgrid_doctor/serato_writer_proof',
                {}, 'Beatgrid Doctor could not prove the Serato writer.');
            currentHealthBeatgridDoctorWriterProof = data;
            currentHealthBeatgridDoctorTestPack = null;
            currentHealthBeatgridDoctorDjayTestPack = null;
            if (currentHealthDjTransferPreview) renderHealthDjTransferPreview(currentHealthDjTransferPreview);
            else if (detail) detail.innerHTML = healthBeatgridDoctorPanel();
            showToast(data.message || 'Serato writer proof passed.');
        } catch (error) {
            if (detail) detail.innerHTML = healthBeatgridDoctorPanel();
            showToast(error.message || 'Serato writer proof failed.');
        } finally {
            healthDjTransferControls(false);
        }
    }

    async function proveBeatgridDoctorDjayWriter() {
        if (healthDjTransferBusy || window.axiomDjTransferReview || !currentHealthBeatgridDoctorApply?.success) return;
        if (healthDjTransferTask !== 'grids') selectHealthDjTransferTask('grids');
        healthDjTransferControls(true);
        const detail = document.getElementById('health-dj-transfer-detail');
        try {
            const data = await postBeatgridDoctorStep('/api/library/health/beatgrid_doctor/djay_writer_proof',
                {}, 'Beatgrid Doctor could not prove the djay writer.');
            currentHealthBeatgridDoctorDjayWriterProof = data;
            currentHealthBeatgridDoctorDjayTestPack = null;
            if (currentHealthDjTransferPreview) renderHealthDjTransferPreview(currentHealthDjTransferPreview);
            else if (detail) detail.innerHTML = healthBeatgridDoctorPanel();
            showToast(data.message || 'djay writer proof passed.');
        } catch (error) {
            if (detail) detail.innerHTML = healthBeatgridDoctorPanel();
            showToast(error.message || 'djay writer proof failed.');
        } finally {
            healthDjTransferControls(false);
        }
    }

    async function createBeatgridDoctorSeratoTestPack(limit = 10) {
        if (healthDjTransferBusy || window.axiomDjTransferReview || !currentHealthBeatgridDoctorWriterProof?.success) return;
        if (healthDjTransferTask !== 'grids') selectHealthDjTransferTask('grids');
        healthDjTransferControls(true);
        const detail = document.getElementById('health-dj-transfer-detail');
        try {
            const data = await postBeatgridDoctorStep('/api/library/health/beatgrid_doctor/serato_test_pack',
                {limit}, 'Beatgrid Doctor could not create the Serato test pack.');
            currentHealthBeatgridDoctorTestPack = data;
            currentHealthBeatgridDoctorSeratoLiveTest = null;
            if (currentHealthDjTransferPreview) renderHealthDjTransferPreview(currentHealthDjTransferPreview);
            else if (detail) detail.innerHTML = healthBeatgridDoctorPanel();
            showToast(data.message || 'Serato test pack prepared.');
        } catch (error) {
            if (detail) detail.innerHTML = healthBeatgridDoctorPanel();
            showToast(error.message || 'Serato test pack failed.');
        } finally {
            healthDjTransferControls(false);
        }
    }

    async function createBeatgridDoctorDjayTestPack(limit = 10) {
        if (healthDjTransferBusy || window.axiomDjTransferReview || !currentHealthBeatgridDoctorDjayWriterProof?.success) return;
        if (healthDjTransferTask !== 'grids') selectHealthDjTransferTask('grids');
        healthDjTransferControls(true);
        const detail = document.getElementById('health-dj-transfer-detail');
        try {
            const data = await postBeatgridDoctorStep('/api/library/health/beatgrid_doctor/djay_test_pack',
                {limit}, 'Beatgrid Doctor could not create the djay test pack.');
            currentHealthBeatgridDoctorDjayTestPack = data;
            currentHealthBeatgridDoctorDjayLiveTest = null;
            if (currentHealthDjTransferPreview) renderHealthDjTransferPreview(currentHealthDjTransferPreview);
            else if (detail) detail.innerHTML = healthBeatgridDoctorPanel();
            showToast(data.message || 'djay test pack prepared.');
        } catch (error) {
            if (detail) detail.innerHTML = healthBeatgridDoctorPanel();
            showToast(error.message || 'djay test pack failed.');
        } finally {
            healthDjTransferControls(false);
        }
    }

    async function prepareCleanBeatgridHandoff(options = {}) {
        if (!window.axiomDjTransferReview) return publishBeatgridLibrary(options);
        if (healthDjTransferBusy || window.axiomDjTransferReview || !currentHealthBeatgridDoctorPreview?.preview_token) return;
        if (healthDjTransferTask !== 'grids') selectHealthDjTransferTask('grids');
        const mode = options?.mode === 'full' ? 'full' : 'test';
        const limit = beatgridDoctorTestBatchLimit();
        const wantsSerato = healthBeatgridDoctorTarget === 'serato' || healthBeatgridDoctorTarget === 'both';
        const wantsDjay = healthBeatgridDoctorTarget === 'djay' || healthBeatgridDoctorTarget === 'both';
        healthDjTransferControls(true);
        const detail = document.getElementById('health-dj-transfer-detail');
        try {
            if (detail) detail.textContent = mode === 'full'
                ? `Preparing full clean Beatgrid Doctor batch for ${beatgridDoctorTargetLabel()}...`
                : `Preparing Beatgrid Doctor test batch for ${beatgridDoctorTargetLabel()}...`;
            if (!currentHealthBeatgridDoctorApply?.success) {
                currentHealthBeatgridDoctorApply = await postBeatgridDoctorStep(
                    '/api/library/health/beatgrid_doctor/apply_clean_cache',
                    beatgridDoctorPayload(),
                    'Beatgrid Doctor could not save the clean-grid cache.'
                );
            }
            if (wantsSerato && detail) detail.textContent = 'Verifying Serato clean-grid writer on disposable files...';
            if (wantsSerato && !currentHealthBeatgridDoctorWriterProof?.success) {
                currentHealthBeatgridDoctorWriterProof = await postBeatgridDoctorStep(
                    '/api/library/health/beatgrid_doctor/serato_writer_proof',
                    {},
                    'Beatgrid Doctor could not verify the Serato writer.'
                );
            }
            if (wantsDjay && detail) detail.textContent = 'Verifying djay clean-grid writer on a disposable library...';
            if (wantsDjay && !currentHealthBeatgridDoctorDjayWriterProof?.success) {
                currentHealthBeatgridDoctorDjayWriterProof = await postBeatgridDoctorStep(
                    '/api/library/health/beatgrid_doctor/djay_writer_proof',
                    {},
                    'Beatgrid Doctor could not verify the djay writer.'
                );
            }
            if (mode === 'full') {
                currentHealthBeatgridDoctorTestPack = null;
                currentHealthBeatgridDoctorDjayTestPack = null;
                currentHealthBeatgridDoctorSeratoLiveTest = null;
                currentHealthBeatgridDoctorDjayLiveTest = null;
            }
            if (mode !== 'full' && wantsSerato) {
                if (detail) detail.textContent = 'Creating visible Serato test crate...';
                currentHealthBeatgridDoctorSeratoLiveTest = await postBeatgridDoctorStep(
                    '/api/library/health/beatgrid_doctor/serato_live_test_crate',
                    {limit},
                    'Beatgrid Doctor could not create the visible Serato test crate.'
                );
                currentHealthBeatgridDoctorTestPack = currentHealthBeatgridDoctorSeratoLiveTest.test_pack || null;
            } else {
                currentHealthBeatgridDoctorTestPack = null;
                currentHealthBeatgridDoctorSeratoLiveTest = null;
            }
            if (mode !== 'full' && wantsDjay) {
                if (detail) detail.textContent = 'Creating visible djay test playlist...';
                currentHealthBeatgridDoctorDjayLiveTest = await postBeatgridDoctorStep(
                    '/api/library/health/beatgrid_doctor/djay_live_test_playlist',
                    {limit},
                    'Beatgrid Doctor could not create the visible djay test playlist.'
                );
                currentHealthBeatgridDoctorDjayTestPack = null;
            } else {
                currentHealthBeatgridDoctorDjayTestPack = null;
                currentHealthBeatgridDoctorDjayLiveTest = null;
            }
            if (detail) detail.textContent = 'Saving Beatgrid Doctor receipt...';
            const receipt = await postBeatgridDoctorStep(
                '/api/library/health/beatgrid_doctor/prepare_test',
                beatgridDoctorReceiptPayload(),
                'Beatgrid Doctor could not save the handoff receipt.'
            );
            currentHealthBeatgridDoctorReceipt = {
                receipt_id: receipt.receipt_id,
                receipt_path: receipt.receipt_path,
                receipt: receipt.receipt
            };
            currentHealthBeatgridDoctorRunMode = mode;
            if (currentHealthDjTransferPreview) renderHealthDjTransferPreview(currentHealthDjTransferPreview);
            else if (detail) detail.innerHTML = healthBeatgridDoctorPanel();
            showToast(mode === 'full'
                ? 'Full clean-grid batch staged. Receipt saved for the destination publish step.'
                : 'Test batch created. Open the selected DJ software and check test 1 Doctor feature.');
        } catch (error) {
            if (currentHealthDjTransferPreview) renderHealthDjTransferPreview(currentHealthDjTransferPreview);
            else if (detail) detail.innerHTML = healthBeatgridDoctorPanel();
            showToast(error.message || 'Clean DJ handoff could not be prepared.');
        } finally {
            healthDjTransferControls(false);
        }
    }

    async function healthDjTransferApply(action, payload = {}) {
        if (healthDjTransferBusy || !currentHealthDjTransferPreview || window.axiomDjTransferReview) return;
        const preview = currentHealthDjTransferPreview;
        healthDjTransferControls(true);
        const detail = document.getElementById('health-dj-transfer-detail');
        try {
            if (action === 'apply_bpm_guard') {
                if (!preview.summary?.bpm_guard_candidates) return;
                const approved = await showAxiomConfirm('Protect BPM in AXIOM',
                    `Approve the suggested tempos for ${preview.summary.bpm_guard_candidates} tracks and protect them across AXIOM rescans? djay stays unchanged.`,
                    'Approve & Protect', 'primary', 'health-bpm');
                if (!approved) return;
                if (currentHealthDjTransferPreview !== preview) throw new Error('The comparison changed. Use REFRESH LIBRARY before applying.');
            }
            const options = {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({preview_token: preview.preview_token,
                    bpm_preview_token: action === 'apply_bpm_guard' ? preview.bpm_preview_token : undefined, ...payload})
            };
            let response;
            if (action === 'mirror_serato_plays') response = await fetch('/api/library/health/dj_transfer/mirror_serato_plays', options);
            else if (action === 'apply_bpm_guard') response = await fetch('/api/library/health/dj_transfer/apply_bpm_guard', options);
            else throw new Error('Unknown DJ transfer action. No changes were made.');
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || data.errors?.join('; ') || 'DJ transfer did not complete.');
            showToast(data.message);
            if (detail) detail.textContent = data.message + ' Preview again for current counts.';
            currentHealthDjTransferPreview = null;
        } catch (error) {
            showToast(error.message);
            if (detail) {
                const notice = document.createElement('p');
                notice.setAttribute('role', 'alert');
                notice.textContent = error.message;
                detail.prepend(notice);
            }
        } finally {
            healthDjTransferControls(false);
        }
    }

    function mirrorSeratoPlaysIntoAxiom() {
        return healthDjTransferApply('mirror_serato_plays');
    }

    async function copySeratoPlaysToDjay() {
        const preview = currentHealthDjTransferPreview;
        const count = healthDjTransferCountStatus(preview).ready;
        if (healthDjTransferBusy || !count) return;
        const confirmedPaths = healthTransferReviewablePaths(preview).filter(row => healthDjTransferConfirmedPaths.has(row.path)).map(row => row.path);
        const previewToken = preview.preview_token;
        healthDjTransferControls(true);
        const detail = document.getElementById('health-dj-transfer-detail');
        try {
            const approved = await showAxiomConfirm('Copy Play Counts to djay',
                `${window.axiomDjTransferReview ? 'Example only. No library changes.\n\n' : 'Quit Serato, djay and Lexicon before continuing.\n\n'}Copy play counts for ${count.toLocaleString()} ${count === 1 ? 'track' : 'tracks'} into djay? Higher totals are preserved. Audio and cues stay unchanged.`,
                window.axiomDjTransferReview ? 'Try Example' : 'Copy Play Counts', 'primary', 'transfer');
            if (!approved) return;
            if (currentHealthDjTransferPreview !== preview || preview.preview_token !== previewToken) {
                throw new Error('The comparison changed. Use REFRESH LIBRARY before copying.');
            }
            if (window.axiomDjTransferReview) {
                detail.innerHTML = `${healthDjTransferBrandRoute('Serato', 'djay Pro')}<div class="health-transfer-done"><img src="/static/icons/check-circle.svg" alt=""><div><h3>Example complete</h3><p>The sample track now shows 60 plays in djay.</p></div></div><p class="health-transfer-note">This was a demonstration. Your real library was not changed.</p>`;
                currentHealthDjTransferPreview = null;
                return;
            }
            detail.textContent = 'Copying play counts. Keep your DJ apps closed...';
            const response = await fetch('/api/library/health/dj_transfer/copy_serato_plays_to_djay', {
                method: 'POST', headers: {'Content-Type': 'application/json', 'X-AXIOM-DJ-Publish': 'play-counts'},
                body: JSON.stringify({preview_token: previewToken, confirmed_paths: confirmedPaths, confirm: 'COPY SERATO PLAY COUNTS TO DJAY'})
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                if (healthDjTransferIsDjSoftwareOpen(data)) await showHealthDjSoftwareOpenWarning(data);
                throw new Error(data.error || 'Copy did not complete.');
            }
            if (data.database_readback_verified !== true || !Number.isInteger(data.updated) || data.updated !== count) {
                throw new Error('The copied totals could not be fully verified. Use REFRESH LIBRARY before trying again.');
            }
            detail.innerHTML = `${healthDjTransferBrandRoute('Serato', 'djay Pro')}<div class="health-transfer-done"><img src="/static/icons/check-circle.svg" alt=""><div><h3>${data.updated ? 'Play counts copied' : 'Nothing to copy'}</h3><p>${escapeHtml(data.message)}</p></div></div><p class="health-transfer-note">Audio, cues, BPM and Serato remain unchanged.</p>`;
            currentHealthDjTransferPreview = null;
        } catch (error) {
            if (currentHealthDjTransferPreview) renderHealthDjTransferPreview(currentHealthDjTransferPreview);
            const notice = document.createElement('p');
            notice.setAttribute('role', 'alert');
            notice.textContent = error.message;
            detail.prepend(notice);
        } finally {
            healthDjTransferControls(false);
        }
    }

    function applyDjayBpmGuard() {
        return healthDjTransferApply('apply_bpm_guard');
    }

    function healthDjTransferIsDjSoftwareOpen(data) {
        return !!(data && (data.dj_software_open || data.serato_must_quit || data.djay_must_quit));
    }

    async function showHealthDjSoftwareOpenWarning(data = {}) {
        const message = data.error || 'DJ software open detected. Close your DJ software, then run this again.';
        const detail = data.detail && data.detail !== message ? `\n\n${data.detail}` : '';
        if (typeof showAxiomConfirm === 'function') {
            await showAxiomConfirm('DJ Software Open Detected', `${message}${detail}`, 'OK', 'primary', 'transfer');
        } else if (typeof showToast === 'function') {
            showToast(message, true);
        }
    }

    Object.assign(window, {
        previewBeatgridDoctor,
        showBeatgridLibrarySongs,
        selectBeatgridLibrarySongsFilter,
        markBeatgridAttentionChecked,
        chooseBeatgridBackupLocation,
        recoverBeatgridLibrary,
        exportBeatgridLibraryReceipt,
        exportDjayBeatgrids,
        prepareBeatgridDoctorTestReceipt,
        applyBeatgridDoctorCleanCache,
        proveBeatgridDoctorSeratoWriter,
        proveBeatgridDoctorDjayWriter,
        createBeatgridDoctorSeratoTestPack,
        createBeatgridDoctorDjayTestPack,
        prepareCleanBeatgridHandoff,
        selectBeatgridDoctorTestLimit,
        selectBeatgridLibraryTestSong,
        selectBeatgridDoctorTarget,
    });

    if (typeof document.addEventListener === 'function') {
        document.addEventListener('click', event => {
            const button = event.target?.closest?.('#health-dj-transfer-grid-doctor, #health-dj-transfer-grid-handoff, #health-dj-transfer-grid-full, #health-dj-transfer-grid-receipt, #health-dj-transfer-grid-apply, #health-dj-transfer-grid-proof, #health-dj-transfer-grid-djay-proof, #health-dj-transfer-grid-pack, #health-dj-transfer-grid-djay-pack');
            if (!button) return;
            event.preventDefault();
            event.stopPropagation();
            if (button.id === 'health-dj-transfer-grid-handoff') prepareCleanBeatgridHandoff();
            else if (button.id === 'health-dj-transfer-grid-full') prepareCleanBeatgridHandoff({mode: 'full'});
            else if (button.id === 'health-dj-transfer-grid-receipt') prepareBeatgridDoctorTestReceipt();
            else if (button.id === 'health-dj-transfer-grid-apply') applyBeatgridDoctorCleanCache();
            else if (button.id === 'health-dj-transfer-grid-proof') proveBeatgridDoctorSeratoWriter();
            else if (button.id === 'health-dj-transfer-grid-djay-proof') proveBeatgridDoctorDjayWriter();
            else if (button.id === 'health-dj-transfer-grid-pack') createBeatgridDoctorSeratoTestPack();
            else if (button.id === 'health-dj-transfer-grid-djay-pack') createBeatgridDoctorDjayTestPack();
            else previewBeatgridDoctor();
        }, true);
    }

    let healthTransferRememberedJob = null;
    const healthTransferJobKey = 'axiomPendingPlaylistTransferV1';
    function healthTransferSavedJob(value) {
        if (arguments.length) healthTransferRememberedJob = value;
        try {
            if (arguments.length) {
                if (value) window.localStorage?.setItem(healthTransferJobKey, JSON.stringify(value));
                else window.localStorage?.removeItem(healthTransferJobKey);
                return value;
            }
            const saved = healthTransferRememberedJob || JSON.parse(window.localStorage?.getItem(healthTransferJobKey) || 'null');
            return saved && /^[a-zA-Z0-9_-]{16,80}$/.test(saved.id) && Array.isArray(saved.source_ids)
                && ['djay-serato', 'serato-djay'].includes(saved.direction) ? saved : null;
        } catch (_) { return healthTransferRememberedJob; }
    }

    async function healthTransferRequest(url, options, progress, pending) {
        const identifier = pending?.id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
        const payload = JSON.parse(options.body);
        healthTransferSavedJob({id: identifier, source_ids: payload.source_ids, direction: healthDjTransferDirection});
        const statusUrl = `/api/library/health/dj_transfer/jobs/${encodeURIComponent(identifier)}`;
        let job = null;
        if (!pending) {
            try {
                const response = await fetch(url, {...options, body: JSON.stringify({...payload, background: true, request_id: identifier})});
                const data = await response.json();
                if (!data.job) {
                    healthTransferSavedJob(null);
                    return {ok: response.ok, json: async () => data};
                }
                job = data.job;
            } catch (_) {
                // The server may already be writing. Recover by GET; never resend POST.
                if (progress) progress.textContent = 'Reconnecting to the transfer. Checking its saved progress…';
            }
        }
        let connectionFailures = 0;
        while (true) {
            if (job) {
                if (job.id !== identifier) throw new Error('The transfer receipt did not match this request. Check the destination before retrying.');
                if (['complete', 'failed', 'interrupted'].includes(job.status)) {
                    if (job.status !== 'interrupted') healthTransferSavedJob(null);
                    const result = job.result || {success: false, error: job.error || 'The transfer stopped before verification.', completed: job.results || []};
                    return {ok: job.status === 'complete', json: async () => result};
                }
                if (progress) progress.textContent = `${job.completed || 0} of ${job.total || payload.source_ids.length} playlists verified. ${job.phase || 'Transferring…'} Keep your DJ apps closed.`;
                await new Promise(resolve => window.setTimeout(resolve, 1000));
            }
            try {
                const response = await fetch(statusUrl);
                const data = await response.json();
                if (!response.ok || !data.job) throw new Error(data.error || 'Transfer status unavailable.');
                job = data.job;
                connectionFailures = 0;
            } catch (_) {
                connectionFailures += 1;
                if (connectionFailures >= 3) throw new Error('AXIOM lost contact with the transfer. It may still be running. Use Transfer now to check the saved result; AXIOM will not start it again. Keep your DJ apps closed.');
                if (progress) progress.textContent = 'Reconnecting to the transfer. Your selection will not be sent twice…';
                await new Promise(resolve => window.setTimeout(resolve, 1000));
            }
        }
    }

    async function exportDjayLibraryToSerato() {
        if (healthDjTransferBusy || healthDjTransferPlaylistStep === 'complete' || !currentHealthDjTransferPreview) return;
        if (healthDjTransferDirection !== 'djay-serato' && !currentHealthDjTransferPreview.serato_to_djay_enabled && !window.axiomDjTransferReview) return;
        const pending = window.axiomDjTransferReview ? null : healthTransferSavedJob();
        if (pending) {
            healthDjTransferDirection = pending.direction;
            healthDjTransferSelectedSources.clear();
            pending.source_ids.forEach(id => healthDjTransferSelectedSources.add(id));
        }
        const selected = pending ? pending.source_ids.map(id => healthDjTransferSources().find(source => source.id === id) || {id, matched_track_count: 1})
            : healthDjTransferSources().filter(source => healthDjTransferSelectedSources.has(source.id) && source.matched_track_count);
        if (!selected.length) return;
        if (!pending && selected.some(source => source.location_mappings?.length) && !healthDjTransferLocationsConfirmed) return;
        healthDjTransferPlaylistError = '';
        renderHealthDjTransferPreview(currentHealthDjTransferPreview);
        healthDjTransferControls(true);
        const progress = document.getElementById('health-transfer-progress');
        if (progress) {
            progress.hidden = false;
            progress.classList?.add('is-running');
            progress.textContent = `Transferring ${selected.length} ${selected.length === 1 ? 'playlist' : 'playlists'} to ${healthDjTransferDirection === 'djay-serato' ? 'Serato' : 'djay Pro'}… Checking the destination and verifying delivery. Keep your DJ apps closed.`;
            progress.scrollIntoView?.({block: 'nearest'});
        }
        // The worker owns the transfer; the screen only follows its saved progress.
        // Never cancel or repeat a library write because an HTTP response was lost.
        const slowNotice = typeof setTimeout === 'function' ? setTimeout(() => {
            if (progress && healthDjTransferBusy) progress.textContent = 'The transfer is taking longer than usual. AXIOM is still waiting for the destination result. Keep your DJ apps closed and do not start another transfer.';
        }, 30000) : null;
        let results = [];
        try {
            if (window.axiomDjTransferReview) {
                await new Promise(resolve => window.setTimeout(resolve, 900));
                results = selected.map(source => ({source_name: source.name, exported_tracks: source.matched_track_count, missing_tracks: source.track_count - source.matched_track_count, delivery_verified: true}));
            } else {
                const toSerato = healthDjTransferDirection === 'djay-serato';
                const options = {
                    method: 'POST', headers: {'Content-Type': 'application/json', 'X-AXIOM-DJ-Publish': 'playlists'},
                    body: JSON.stringify({preview_token: currentHealthDjTransferPreview.preview_token,
                        confirm_relative_paths: healthDjTransferLocationsConfirmed,
                        source_ids: selected.map(source => source.id), confirm: toSerato ? 'EXPORT DJAY PLAYLISTS TO SERATO CRATES' : 'COPY SERATO PLAYLISTS TO DJAY'})
                };
                const response = await healthTransferRequest(toSerato
                    ? '/api/library/health/dj_transfer/export_djay_to_serato'
                    : '/api/library/health/dj_transfer/export_serato_to_djay', options, progress, pending);
                const data = await response.json();
                const returnedResults = data.results || data.completed || [];
                if (!Array.isArray(returnedResults) || returnedResults.some(row => !row || typeof row !== 'object')) {
                    throw new Error('The destination returned an unreadable transfer receipt. Check the destination before retrying.');
                }
                results = returnedResults;
                if (!response.ok || !data.success) {
                    if (healthDjTransferIsDjSoftwareOpen(data)) await showHealthDjSoftwareOpenWarning(data);
                    throw new Error(data.error || data.errors?.join('; ') || 'Export did not complete.');
                }
                const verifiedIds = new Set(results.map(row => row.source_id));
                if (results.length !== selected.length || verifiedIds.size !== selected.length
                    || selected.some(source => !verifiedIds.has(source.id))
                    || results.some(row => row.delivery_verified !== true || !Number.isInteger(row.exported_tracks) || row.exported_tracks < 1)) {
                    throw new Error('The destination could not be fully verified. Check the export before retrying.');
                }
            }
            healthDjTransferPlaylistReceipt = {demo: !!window.axiomDjTransferReview, playlists: results.length,
                entries: results.reduce((total, row) => total + (Number(row.exported_tracks) || 0), 0),
                skipped: results.reduce((total, row) => total + (Number(row.missing_tracks) || 0), 0), results};
            healthDjTransferPlaylistStep = 'complete';
        } catch (error) {
            const verified = results.filter(row => row.delivery_verified === true && selected.some(source => source.id === row.source_id)).length;
            healthDjTransferPlaylistError = `${verified ? `${verified} ${verified === 1 ? 'playlist was' : 'playlists were'} verified before this warning. ` : ''}${error.message}`;
        } finally {
            if (slowNotice !== null) clearTimeout(slowNotice);
            renderHealthDjTransferPreview(currentHealthDjTransferPreview);
            healthDjTransferControls(false);
            document.getElementById('health-dj-transfer-detail')?.focus();
            document.querySelector('#health-dj-transfer-detail .health-transfer-warning, #health-dj-transfer-detail .health-transfer-done')?.scrollIntoView?.({block: 'nearest'});
        }
    }

    Object.assign(window, {
        pageHealthTransferPaths,
        confirmAllHealthTransferPaths,
        confirmHealthTransferPath,
        selectAllHealthTransferPlaylists,
        chooseHealthPlaylistTransfer,
        selectHealthDjTransferTask,
        healthDjTransferTabKeydown,
        selectHealthDjTransferSource,
        previewHealthDjTransfer,
        previewBeatgridDoctor,
        prepareBeatgridDoctorTestReceipt,
        applyBeatgridDoctorCleanCache,
        proveBeatgridDoctorSeratoWriter,
        proveBeatgridDoctorDjayWriter,
        createBeatgridDoctorSeratoTestPack,
        createBeatgridDoctorDjayTestPack,
        prepareCleanBeatgridHandoff,
        mirrorSeratoPlaysIntoAxiom,
        copySeratoPlaysToDjay,
        applyDjayBpmGuard,
        exportDjayLibraryToSerato,
    });

    function loadHealthDjTransferReview() {
        const query = new URLSearchParams(location.search);
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)
            || query.get('review') !== 'health' || query.get('ui_preview') !== 'health-transfer') return;
        if (typeof axiomReviewMode === 'function' && axiomReviewMode() !== 'health') return;
        window.axiomDjTransferReview = {
            success: true, preview_token: 'browser-fixture',
            djay: {library_tracks: 3, errors: []}, serato: {errors: []},
            summary: {serato_matches: 3, play_count_differences: 2, play_counts_ready: 1, bpm_guard_candidates: 1},
            samples: [
                {title: 'Sample track with 60 Serato plays', artist: 'Review Artist', serato_play_count: 60, djay_play_count: 0, proposed_play_count: 60, match_source: 'exact_path'},
                {title: 'Sample track with an uncertain location', artist: 'Review Artist', serato_play_count: 30, djay_play_count: 2, proposed_play_count: 30, match_source: 'relative_path_review'},
                {title: 'Keep the higher djay count', artist: 'Review Artist', serato_play_count: 30, djay_play_count: 45, proposed_play_count: 45, match_source: 'exact_path'}
            ],
            bpm_guard_samples: [{title: 'Sample slow-tempo track', current_bpm: 120, corrected_bpm: 60}],
            sources: [
                {id: 'sample-friday', name: 'Friday Night', matched_track_count: 3, track_count: 3},
                {id: 'sample-warmup', name: 'Warm-Up', matched_track_count: 2, track_count: 2},
                {id: 'sample-late', name: 'Late Set', matched_track_count: 1, track_count: 1}
            ],
            serato_sources: [
                {id: 'sample-serato-open', name: 'Open Format', matched_track_count: 3, track_count: 3},
                {id: 'sample-serato-classics', name: 'Club Classics', matched_track_count: 2, track_count: 2}
            ]
        };
        window.setTimeout(() => {
            healthDjTransferDirection = query.get('transfer_direction') === 'serato-djay' ? 'serato-djay' : 'djay-serato';
            renderHealthDjTransferPreview(window.axiomDjTransferReview);
            selectHealthDjTransferTask('playlists');
            window.AxiomHealthCockpit?.open('transfer', {scroll: true});
        }, 1000);
    }
    if (document.readyState === 'complete') loadHealthDjTransferReview();
    else window.addEventListener('load', loadHealthDjTransferReview, {once: true});
