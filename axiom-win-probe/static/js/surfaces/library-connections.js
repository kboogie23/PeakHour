// Library source, folder and rescan workflows.

async function connectDjOweDemoLibrary() {
    closeLibrarySourcePicker();
    showMusicIntakeOverlay({ indexed: 0, total: 0, folderName: 'DJ OWE + Free Edits', stage: 'Loading Demo Library', message: 'Temporary session only: no saving or export. Add your own tracks after the demo loads.' });
    try {
        if (typeof window.AXIOM_BROWSER_LOAD_DJOWE_DEMO_LIBRARY !== 'function') {
            throw new Error('DJ OWE demo music is unavailable in this browser.');
        }
        const result = await window.AXIOM_BROWSER_LOAD_DJOWE_DEMO_LIBRARY();
        const tracks = Array.isArray(result?.tracks) ? result.tracks : [];
        const total = Number(result?.count || tracks.length || 0);
        window.AXIOM_STREAMING_TRACKS = tracks;
        window.AXIOM_STREAMING_MODE = true;
        document.body.classList.add('streaming-discovery-mode');
        completeMusicIntakeOverlay({ indexed: total, total, folderName: 'DJ OWE + Free Edits', stage: 'Demo Library Ready', message: result?.message || `${total.toLocaleString()} DJ OWE and Free edits loaded. Add up to 500 of your tracks on top.` });
        if (typeof updateLibraryCount === 'function') updateLibraryCount(total);
        if (typeof setLibraryConnectionState === 'function') setLibraryConnectionState(total);
        await loadLibraryStats();
        runSearch();
        showToast(result?.message || 'DJ OWE demo library loaded.');
        openSetBrief(false);
        return result;
    } catch (error) {
        completeMusicIntakeOverlay({ indexed: 0, total: 0, folderName: 'DJ OWE + Free Edits', stage: 'Demo Library Paused', message: error.message || 'DJ OWE demo library could not load.' });
        showToast(error.message || 'DJ OWE demo library could not load.', true);
        return null;
    }
}

function axiomLibraryResetBlocksIntake() {
    const gate = typeof window.getAxiomLibraryResetGate === 'function'
        ? window.getAxiomLibraryResetGate()
        : { pending: false, blocked: false, message: '' };
    if (!gate.pending && !gate.blocked) return false;
    const message = gate.message || 'Finish or cancel Reset Library before adding music.';
    showToast(message, true);
    const hud = document.getElementById('master-hud');
    if (hud && !hud.classList.contains('active') && typeof toggleMasterHud === 'function') toggleMasterHud();
    if (typeof setSettingsCategory === 'function') setSettingsCategory('library');
    return true;
}

async function openLibrarySourcePicker() {
    if (axiomLibraryResetBlocksIntake()) return false;
    closeAxiomArrival(true);
    closeLibrarySourcePicker();
    const modal = document.createElement('div');
    modal.id = 'library-source-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'library-source-choice-title');
    modal.innerHTML = `
      <div class="library-source-choice-panel">
        <header class="library-source-choice-head">
          <div>
            <p class="library-source-choice-eyebrow">Music Source</p>
            <h3 id="library-source-choice-title" class="library-source-choice-title">Choose Music Source</h3>
            <p class="library-source-choice-intro">Select how you want to bring your music and performance data into AXIOM.</p>
          </div>
          <button type="button" class="library-source-choice-close" onclick="closeLibrarySourcePicker()" aria-label="Close music source chooser">Close</button>
        </header>

        <div class="library-source-choice-grid" role="group" aria-label="Available music sources">
          <section class="library-source-choice">
            <div class="library-source-choice-icon" aria-hidden="true">
              <img src="/static/icons/folder-open.svg" alt="">
            </div>
            <h4>Music Folder</h4>
            <p class="library-source-choice-copy">Scan playable music from this Mac or an external drive.</p>
            <p class="library-source-choice-readonly is-spacer" aria-hidden="true">Local folder access</p>
            <button id="folder-path-open" class="library-source-choice-action" type="button" onclick="requestMusicFolderAccess('music folder on this Mac or an external drive')">Select Music Folder</button>
          </section>

          <section class="library-source-choice">
            <div class="library-source-choice-icon" aria-hidden="true">
              <img src="/static/icons/audio-waveform.svg" alt="">
            </div>
            <h4>Serato Database V2</h4>
            <p class="library-source-choice-copy">Bring in crates, BPM, key, year, cues, and history.</p>
            <p class="library-source-choice-readonly">Database is read-only</p>
            <button id="serato-database-v2-open" class="library-source-choice-action" type="button" onclick="startSeratoDatabaseFlowFromSource()">Select Database V2</button>
          </section>
        </div>

        <p class="library-source-choice-trust">Read-only connection — your music and Serato files stay untouched.</p>
      </div>`;
    mountAxiomConnectionDialog(modal);
    modal.addEventListener('click', event => { if (event.target === modal) closeLibrarySourcePicker(); });
}

    async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 45000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const resp = await fetch(url, { ...options, signal: controller.signal });
        const data = await resp.json().catch(() => ({}));
        return { resp, data };
    } finally {
            clearTimeout(timer);
        }
    }

let axiomNativePickerRequestId = 0;
const axiomNativePickerCallbacks = {};

window.__AXIOM_NATIVE_PICKER_RESULT = function(requestId, payload = {}) {
    const callback = axiomNativePickerCallbacks[requestId];
    if (!callback) return;
    delete axiomNativePickerCallbacks[requestId];
    if (payload.success === false) {
        const error = new Error(payload.message || payload.error || 'Selection cancelled.');
        error.payload = payload;
        if (payload.cancelled) error.cancelled = true;
        callback.reject(error);
        return;
    }
    callback.resolve(payload);
};

function hasAxiomNativePicker() {
    return Boolean(window.webkit?.messageHandlers?.axiomNative?.postMessage);
}

function axiomNativePick(action, timeoutMs = 300000, signal, payload = {}) {
    if (!hasAxiomNativePicker()) return Promise.reject(new Error('Native picker is not available in this window.'));
    const requestId = `picker-${Date.now()}-${++axiomNativePickerRequestId}`;
    return new Promise((resolve, reject) => {
        const cancel = () => {
            const error = new Error('Selection cancelled.');
            error.cancelled = true;
            axiomNativePickerCallbacks[requestId]?.reject(error);
            delete axiomNativePickerCallbacks[requestId];
        };
        const timer = setTimeout(() => {
            delete axiomNativePickerCallbacks[requestId];
            signal?.removeEventListener('abort', cancel);
            const error = new Error('Native picker did not respond in time.');
            error.nativeTimeout = true;
            reject(error);
        }, timeoutMs);
        axiomNativePickerCallbacks[requestId] = {
            resolve: payload => {
                clearTimeout(timer);
                signal?.removeEventListener('abort', cancel);
                resolve(payload);
            },
            reject: error => {
                clearTimeout(timer);
                signal?.removeEventListener('abort', cancel);
                reject(error);
            }
        };
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) { cancel(); return; }
        try {
            window.webkit.messageHandlers.axiomNative.postMessage({ ...payload, action, requestId });
        } catch (error) {
            clearTimeout(timer);
            signal?.removeEventListener('abort', cancel);
            delete axiomNativePickerCallbacks[requestId];
            reject(error);
        }
    });
}

async function pickSeratoDatabasePath() {
    if (hasAxiomNativePicker()) {
        try {
            const picked = await axiomNativePick('chooseSeratoDatabase');
            return { database_path: picked.path, database_name: picked.name || 'database V2', native_picker: true };
        } catch (error) {
            if (error.cancelled || error.nativeTimeout) throw error;
            console.warn('AXIOM native Serato picker fallback:', error);
        }
    }
    const picked = await fetchJsonWithTimeout('/api/library/choose_serato_database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
    }, 300000);
    if (!picked.resp.ok || picked.data.success === false) {
        const error = new Error(picked.data.error || picked.data.message || 'Serato database selection paused.');
        error.payload = picked.data;
        if (picked.data.cancelled) error.cancelled = true;
        throw error;
    }
    return picked.data;
}

async function pickMusicFolderPath(signal) {
    if (hasAxiomNativePicker()) {
        try {
            const picked = await axiomNativePick('chooseMusicFolder', 300000, signal);
            return { folder_path: picked.path, folder_name: picked.name || 'Music Library', native_picker: true };
        } catch (error) {
            if (error.cancelled || error.nativeTimeout) throw error;
            console.warn('AXIOM native folder picker fallback:', error);
        }
    }
    const resp = await fetch('/api/library/choose_folder', {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.success) {
        const error = new Error(data.message || data.error || 'AXIOM could not open the Mac folder picker.');
        error.payload = data;
        if (data.cancelled) error.cancelled = true;
        throw error;
    }
    return data;
}

async function startSeratoDatabaseFlowFromSource() {
    closeLibrarySourcePicker();
    showToast('Opening AXIOM Serato database picker...');
    return connectSeratoByChoosingDatabase();
}

async function startSeratoFolderFlowFromSource() {
    closeLibrarySourcePicker();
    showToast('Opening AXIOM music folder picker...');
    return requestMusicFolderAccess('the music folder on your external hard drive');
}

async function startSeratoAutoDetectFromSource() {
    closeLibrarySourcePicker();
    return connectPrimarySeratoLibrary();
}

function startSeratoManualPathFromSource() {
    closeLibrarySourcePicker();
    showManualSeratoDatabasePrompt();
}

function showSeratoSourceOptions() {
    closeLibrarySourcePicker();
    document.getElementById('serato-source-options-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'serato-source-options-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:316;display:flex;align-items:center;justify-content:center;padding:20px;';
    modal.innerHTML = `
      <div style="width:min(570px,94vw);background:#080b09;border:1px solid rgba(163,255,0,.58);box-shadow:0 24px 80px rgba(0,0,0,.62);padding:28px;">
        <p style="margin:0 0 8px;color:var(--accent);font-size:9px;font-weight:900;letter-spacing:.16em;text-transform:uppercase;">Serato Source</p>
        <h3 style="margin:0;color:#fff;font-family:'Bebas Neue';font-size:34px;letter-spacing:0;">CHOOSE HOW SERATO CONNECTS</h3>
        <p style="margin:8px 0 18px;color:rgba(255,255,255,.62);font-size:12px;line-height:1.55;">
          If your Serato library or songs live on an external hard drive, choose the exact <strong style="color:#fff;">database V2</strong> file or choose the music folder directly. AXIOM reads only and keeps Serato/audio untouched.
        </p>
        <div style="display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:18px;">
          <button id="serato-source-auto" type="button" style="width:100%;background:var(--accent);border:1px solid var(--accent);color:#000;font-family:'Bebas Neue';font-size:14px;letter-spacing:2px;padding:13px 20px;cursor:pointer;text-align:left;">CONNECT SERATO</button>
          <button id="serato-source-folder" type="button" style="width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.18);color:#fff;font-family:'Bebas Neue';font-size:14px;letter-spacing:2px;padding:13px 20px;cursor:pointer;text-align:left;">CHOOSE MUSIC FOLDER ON HARD DRIVE</button>
          <button id="serato-source-manual" type="button" style="width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.18);color:#fff;font-family:'Bebas Neue';font-size:14px;letter-spacing:2px;padding:13px 20px;cursor:pointer;text-align:left;">PASTE SERATO DATABASE PATH</button>
          <button id="serato-source-db" type="button" style="width:100%;background:transparent;border:1px solid rgba(255,255,255,.14);color:rgba(255,255,255,.78);font-family:'Bebas Neue';font-size:14px;letter-spacing:2px;padding:13px 20px;cursor:pointer;text-align:left;">CHOOSE DATABASE V2 MANUALLY</button>
        </div>
        <div style="display:flex;justify-content:flex-end;">
          <button type="button" onclick="document.getElementById('serato-source-options-modal')?.remove()" style="background:transparent;border:1px solid rgba(255,255,255,.16);color:rgba(255,255,255,.62);font-family:'Bebas Neue';font-size:13px;letter-spacing:2px;padding:10px 20px;cursor:pointer;">CLOSE</button>
        </div>
      </div>`;
    mountAxiomConnectionDialog(modal);
    modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
    document.getElementById('serato-source-db')?.addEventListener('click', async () => {
        modal.remove();
        await connectSeratoByChoosingDatabase();
    }, { once: true });
    document.getElementById('serato-source-folder')?.addEventListener('click', async () => {
        modal.remove();
        await requestMusicFolderAccess('the music folder on your external hard drive');
    }, { once: true });
    document.getElementById('serato-source-manual')?.addEventListener('click', () => {
        modal.remove();
        showManualSeratoDatabasePrompt();
    }, { once: true });
    document.getElementById('serato-source-auto')?.addEventListener('click', async () => {
        modal.remove();
        await connectPrimarySeratoLibrary();
    }, { once: true });
}

async function showAxiomDiagnostics() {
    document.getElementById('axiom-diagnostics-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'axiom-diagnostics-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:318;display:flex;align-items:center;justify-content:center;padding:20px;';
    modal.innerHTML = `
      <div style="width:min(680px,94vw);max-height:min(760px,calc(100vh - 40px));overflow:auto;background:#080b09;border:1px solid rgba(163,255,0,.5);box-shadow:0 24px 80px rgba(0,0,0,.62);padding:28px;">
        <p style="margin:0 0 8px;color:var(--accent);font-size:9px;font-weight:900;letter-spacing:.16em;text-transform:uppercase;">Diagnostics</p>
        <h3 style="margin:0;color:#fff;font-family:'Bebas Neue';font-size:34px;letter-spacing:0;">AXIOM CONNECTION CHECK</h3>
        <pre id="axiom-diagnostics-output" style="white-space:pre-wrap;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.78);font-size:11px;line-height:1.5;padding:16px;margin:16px 0 18px;max-height:420px;overflow:auto;">Running diagnostics...</pre>
        <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
          <button type="button" onclick="showAxiomDiagnostics()" style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.18);color:#fff;font-family:'Bebas Neue';font-size:13px;letter-spacing:2px;padding:10px 20px;cursor:pointer;">REFRESH</button>
          <button type="button" onclick="document.getElementById('axiom-diagnostics-modal')?.remove()" style="background:var(--accent);border:1px solid var(--accent);color:#000;font-family:'Bebas Neue';font-size:13px;letter-spacing:2px;padding:10px 20px;cursor:pointer;">CLOSE</button>
        </div>
      </div>`;
    mountAxiomConnectionDialog(modal);
    try {
        const resp = await fetch('/api/app/diagnostics');
        const data = await resp.json().catch(() => ({}));
        const output = document.getElementById('axiom-diagnostics-output');
        if (output) output.textContent = JSON.stringify(data, null, 2);
        if (!resp.ok || data.success === false) showToast(data.error || 'Diagnostics could not complete.', true);
    } catch (error) {
        const output = document.getElementById('axiom-diagnostics-output');
        if (output) output.textContent = error.message || 'Diagnostics could not reach AXIOM.';
        showToast('Diagnostics could not reach AXIOM.', true);
    }
}

function showSeratoConnectionRecovery(error = {}, context = {}) {
    document.getElementById('serato-connection-recovery-modal')?.remove();
    const message = escapeHtml(error.message || error.error || 'AXIOM could not find usable Serato tracks automatically.');
    const modal = document.createElement('div');
    modal.id = 'serato-connection-recovery-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.86);z-index:316;display:flex;align-items:center;justify-content:center;padding:20px;';
    modal.innerHTML = `
      <div style="width:min(570px,94vw);background:#080b09;border:1px solid rgba(163,255,0,.58);box-shadow:0 24px 80px rgba(0,0,0,.62);padding:28px;">
        <p style="margin:0 0 8px;color:var(--accent);font-size:9px;font-weight:900;letter-spacing:.16em;text-transform:uppercase;">Serato Needs A Path</p>
        <h3 style="margin:0;color:#fff;font-family:'Bebas Neue';font-size:34px;letter-spacing:0;">POINT AXIOM AT THE DRIVE</h3>
        <p style="margin:8px 0 18px;color:rgba(255,255,255,.62);font-size:12px;line-height:1.55;">
          ${message} If your Serato or music lives on an external hard drive, choose the exact <strong style="color:#fff;">database V2</strong> file or the folder that holds your songs. AXIOM reads only and keeps Serato/audio untouched.
        </p>
        <div style="display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:18px;">
          <button id="serato-recovery-db" type="button" style="width:100%;background:var(--accent);border:1px solid var(--accent);color:#000;font-family:'Bebas Neue';font-size:14px;letter-spacing:2px;padding:13px 20px;cursor:pointer;text-align:left;">CHOOSE SERATO DATABASE V2</button>
          <button id="serato-recovery-folder" type="button" style="width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.18);color:#fff;font-family:'Bebas Neue';font-size:14px;letter-spacing:2px;padding:13px 20px;cursor:pointer;text-align:left;">CHOOSE MUSIC FOLDER ON HARD DRIVE</button>
          <button id="serato-recovery-manual" type="button" style="width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.18);color:#fff;font-family:'Bebas Neue';font-size:14px;letter-spacing:2px;padding:13px 20px;cursor:pointer;text-align:left;">PASTE SERATO DATABASE PATH</button>
        </div>
        <div style="display:flex;justify-content:flex-end;">
          <button type="button" onclick="document.getElementById('serato-connection-recovery-modal')?.remove()" style="background:transparent;border:1px solid rgba(255,255,255,.16);color:rgba(255,255,255,.62);font-family:'Bebas Neue';font-size:13px;letter-spacing:2px;padding:10px 20px;cursor:pointer;">CLOSE</button>
        </div>
      </div>`;
    mountAxiomConnectionDialog(modal);
    modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
    document.getElementById('serato-recovery-db')?.addEventListener('click', async () => {
        modal.remove();
        await connectSeratoByChoosingDatabase();
    }, { once: true });
    document.getElementById('serato-recovery-folder')?.addEventListener('click', async () => {
        modal.remove();
        await requestMusicFolderAccess('the music folder on your external hard drive');
    }, { once: true });
    document.getElementById('serato-recovery-manual')?.addEventListener('click', () => {
        modal.remove();
        showManualSeratoDatabasePrompt();
    }, { once: true });
}

async function connectSeratoWithPayload(payload = {}, timeoutMs = 45000) {
    const { resp, data } = await fetchJsonWithTimeout('/api/library/connect_serato/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }, Math.min(timeoutMs, 15000));
    if (!resp.ok || data.success === false) {
        const error = new Error(data.error || data.message || 'Serato connection paused.');
        error.payload = data;
        throw error;
    }
    const jobId = String(data.job_id || data.job?.job_id || '');
    if (!jobId) return data;
    const stageLabels = {
        accepted: 'Serato Import Accepted',
        preparing: 'Preparing Serato Import',
        reading_crates: 'Reading Serato Crates',
        opening_database: 'Opening Database V2',
        reading_tracks: 'Reading Serato Tracks',
        reading_history: 'Matching Serato History',
        loading_axiom_library: 'Opening AXIOM Library',
        merging_tracks: 'Merging Serato Records',
        building_index: 'Building AXIOM Index',
        saving_axiom_library: 'Saving AXIOM Library'
    };
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const statusResult = await fetchJsonWithTimeout(`/api/library/connect_serato/status/${encodeURIComponent(jobId)}`, {
            cache: 'no-store'
        }, 10000);
        const statusData = statusResult.data || {};
        if (!statusResult.resp.ok || statusData.success === false) {
            const error = new Error(statusData.error || 'Serato connection status was lost.');
            error.payload = statusData;
            throw error;
        }
        const job = statusData.job || {};
        updateMusicIntakeOverlay({
            indexed: Number(job.processed || 0),
            total: Number(job.total || 0),
            progress: Number(job.progress || 0),
            indeterminate: job.indeterminate === true,
            folderName: 'Serato',
            stage: stageLabels[job.phase] || 'Connecting Serato',
            message: job.message || 'AXIOM is reading database V2 locally. Serato and source audio stay untouched.'
        });
        if (job.status === 'complete') return job.result || job;
        if (job.status === 'failed') {
            const error = new Error(job.error || job.result?.error || 'Serato connection paused.');
            error.payload = job.result || job;
            throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 400));
    }
    const error = new Error('Serato is still working but the progress window timed out. Try again to reconnect to the current import.');
    error.payload = { job_id: jobId, timed_out: true };
    throw error;
}

async function connectSeratoByChoosingDatabase() {
    try {
        showToast('Choose database V2 from your _Serato_ folder or external drive.');
        const picked = await pickSeratoDatabasePath();
        showMusicIntakeOverlay({ indexed: 0, total: 0, folderName: 'Serato', stage: 'Reading Serato Database', message: 'AXIOM is reading database V2 locally. Source audio and Serato stay untouched.' });
        const data = await connectSeratoWithPayload({ database_path: picked.database_path }, 300000);
        completeMusicIntakeOverlay({ indexed: Number(data.total_tracks || data.scanned_count || 0), total: Number(data.total_tracks || data.scanned_count || 0), folderName: 'Serato', stage: 'Serato Library Ready', message: data.message || 'Serato connected.' });
        showToast(data.message || 'Serato connected.');
        setLibraryConnectionState(Number(data.total_tracks || data.scanned_count || 0), { openLibrary: true });
        await loadLibraryStats();
        await runSearch();
        if (data?.requires_music_folder_for_playback) promptSeratoPlaybackUnlock(data);
        return data;
    } catch (error) {
        if (error.cancelled || error.payload?.cancelled) {
            completeMusicIntakeOverlay({ indexed: 0, total: 0, folderName: 'Serato', stage: 'Selection Cancelled', message: 'No Serato database was chosen.' });
            return null;
        }
        completeMusicIntakeOverlay({ indexed: 0, total: 0, folderName: 'Serato', stage: 'Serato Connection Paused', message: error.message || 'AXIOM could not read Serato.' });
        showSeratoConnectionRecovery(error.payload || error, { source: 'manual_database' });
        showToast(error.message || 'Serato connection paused.', true);
        return null;
    }
}

async function connectSeratoFromManualPath(databasePath) {
    const cleanPath = normalizeFolderPathInput(databasePath);
    if (!cleanPath) {
        showManualSeratoDatabasePrompt('', 'Paste the full path to the file named database V2.');
        return null;
    }
    try {
        showMusicIntakeOverlay({
            indexed: 0,
            total: 0,
            folderName: 'Serato',
            stage: 'Reading Serato Database',
            message: 'AXIOM is reading the pasted database V2 path locally.'
        });
        const data = await connectSeratoWithPayload({ database_path: cleanPath }, 300000);
        completeMusicIntakeOverlay({
            indexed: Number(data.total_tracks || data.scanned_count || 0),
            total: Number(data.total_tracks || data.scanned_count || 0),
            folderName: 'Serato',
            stage: 'Serato Library Ready',
            message: data.message || 'Serato connected.'
        });
        showToast(data.message || 'Serato connected.');
        setLibraryConnectionState(Number(data.total_tracks || data.scanned_count || 0), { openLibrary: true });
        await loadLibraryStats();
        await runSearch();
        if (data?.requires_music_folder_for_playback) promptSeratoPlaybackUnlock(data);
        document.getElementById('serato-manual-path-modal')?.remove();
        return data;
    } catch (error) {
        completeMusicIntakeOverlay({
            indexed: 0,
            total: 0,
            folderName: 'Serato',
            stage: 'Serato Connection Paused',
            message: error.message || 'AXIOM could not read that database path.'
        });
        showManualSeratoDatabasePrompt(cleanPath, error.message || error.payload?.error || 'AXIOM could not read that database path.');
        showToast(error.message || 'Serato connection paused.', true);
        return null;
    }
}

function showManualSeratoDatabasePrompt(prefill = '', errorMessage = '') {
    document.getElementById('serato-manual-path-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'serato-manual-path-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:320;display:flex;align-items:center;justify-content:center;padding:20px;';
    modal.innerHTML = `
      <div style="width:min(620px,94vw);background:#080b09;border:1px solid rgba(163,255,0,.58);box-shadow:0 24px 80px rgba(0,0,0,.62);padding:28px;">
        <p style="margin:0 0 8px;color:var(--accent);font-size:9px;font-weight:900;letter-spacing:.16em;text-transform:uppercase;">Manual Serato Path</p>
        <h3 style="margin:0;color:#fff;font-family:'Bebas Neue';font-size:34px;letter-spacing:0;">PASTE DATABASE V2 PATH</h3>
        <p style="margin:8px 0 16px;color:rgba(255,255,255,.62);font-size:12px;line-height:1.55;">
          In Finder, locate the file named <strong style="color:#fff;">database V2</strong> inside your <strong style="color:#fff;">_Serato_</strong> folder. Paste its full path here. AXIOM reads it only.
        </p>
        <input id="serato-manual-path-input" type="text" value="${escapeHtml(prefill)}" placeholder="/Volumes/Your Drive/_Serato_/database V2" style="width:100%;background:#111;border:1px solid ${errorMessage ? '#ef4444' : 'rgba(255,255,255,.18)'};color:#fff;font-size:12px;padding:14px 16px;outline:none;box-sizing:border-box;">
        <div id="serato-manual-path-status" style="min-height:18px;margin:10px 0 18px;color:${errorMessage ? '#ef4444' : 'rgba(255,255,255,.48)'};font-size:10px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;">${escapeHtml(errorMessage || 'Tip: drag the database V2 file from Finder into Terminal to see its full path, then paste it here.')}</div>
        <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
          <button type="button" onclick="document.getElementById('serato-manual-path-modal')?.remove()" style="background:transparent;border:1px solid rgba(255,255,255,.16);color:rgba(255,255,255,.62);font-family:'Bebas Neue';font-size:13px;letter-spacing:2px;padding:10px 20px;cursor:pointer;">CANCEL</button>
          <button type="button" onclick="connectSeratoFromManualPath(document.getElementById('serato-manual-path-input')?.value || '')" style="background:var(--accent);border:1px solid var(--accent);color:#000;font-family:'Bebas Neue';font-size:13px;letter-spacing:2px;padding:10px 22px;cursor:pointer;">CONNECT SERATO</button>
        </div>
      </div>`;
    mountAxiomConnectionDialog(modal);
    modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
    setTimeout(() => document.getElementById('serato-manual-path-input')?.focus(), 50);
}

async function connectPrimarySeratoLibrary() {
    closeLibrarySourcePicker();
    let seratoHeartbeat = null;
    try {
        showMusicIntakeOverlay({ indexed: 0, total: 0, folderName: 'Serato', stage: 'Connecting Serato', message: 'Reading Serato locally. Source files stay untouched.' });
        seratoHeartbeat = setInterval(() => {
            if (Date.now() - Number(musicIntakeState.updatedAt || 0) < 10000) return;
            updateMusicIntakeOverlay({
                folderName: 'Serato',
                stage: 'Still Reading Serato',
                message: 'Large Serato libraries can take a little longer. AXIOM is still working locally; no music is being uploaded.'
            });
        }, 5000);
        let data;
        if (typeof window.AXIOM_BROWSER_CONNECT_SERATO_LIBRARY === 'function' && 'showDirectoryPicker' in window) {
            data = await window.AXIOM_BROWSER_CONNECT_SERATO_LIBRARY();
        } else if (typeof window.AXIOM_BROWSER_CONNECT_SERATO_DATABASE_FILE === 'function') {
            data = await connectSeratoDatabaseFileFallback();
        } else {
            data = await connectSeratoWithPayload({}, 300000);
        }
        completeMusicIntakeOverlay({ indexed: Number(data.total_tracks || data.scanned_count || 0), total: Number(data.total_tracks || data.scanned_count || 0), folderName: 'Serato', stage: 'Serato Library Ready', message: data.message || 'Serato connected.' });
        showToast(data.message || 'Serato connected.');
        setLibraryConnectionState(Number(data.total_tracks || data.scanned_count || 0), { openLibrary: true });
        await loadLibraryStats();
        await runSearch();
        if (window.AXIOM_WEB_PREVIEW && data?.requires_music_folder_for_playback) {
            promptSeratoPlaybackUnlock(data);
        }
        return data;
    } catch (error) {
        completeMusicIntakeOverlay({ indexed: 0, total: 0, folderName: 'Serato', stage: 'Serato Connection Paused', message: error.message || 'AXIOM could not read Serato.' });
        showSeratoConnectionRecovery(error.payload || error, { source: 'auto_serato' });
        showToast(error.message || 'Serato connection paused.', true);
        return null;
    } finally {
        if (seratoHeartbeat) clearInterval(seratoHeartbeat);
    }
}

function promptSeratoPlaybackUnlock(data = {}) {
    document.getElementById('serato-playback-unlock-modal')?.remove();
    const total = Number(data.original_track_count || data.scanned_count || data.total_tracks || 0);
    const loaded = Number(data.total_tracks || 0);
    const modal = document.createElement('div');
    modal.id = 'serato-playback-unlock-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.82);z-index:315;display:flex;align-items:center;justify-content:center;padding:20px;';
    modal.innerHTML = `
      <div style="width:min(560px,94vw);background:#080b09;border:1px solid rgba(163,255,0,.58);box-shadow:0 24px 80px rgba(0,0,0,.62);padding:28px;">
        <p style="margin:0 0 8px;color:var(--accent);font-size:9px;font-weight:900;letter-spacing:.16em;text-transform:uppercase;">Serato Connected</p>
        <h3 style="margin:0;color:#fff;font-family:'Bebas Neue';font-size:34px;letter-spacing:0;">PLAYLISTS READY · LISTENING NEEDS FILES</h3>
        <p style="margin:8px 0 18px;color:rgba(255,255,255,.62);font-size:12px;line-height:1.55;">
          AXIOM found your Serato library${total ? ` with ${total.toLocaleString()} songs` : ''}. You can build playlists from that Serato information now. To listen to previews inside AXIOM, choose the music folder where those songs live. Your music stays on your computer and Serato stays untouched.
        </p>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:18px;">
          <div style="border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);padding:14px;">
            <strong style="display:block;color:var(--accent);font-family:'Bebas Neue';font-size:26px;line-height:1;">${loaded.toLocaleString()}</strong>
            <span style="display:block;color:rgba(255,255,255,.48);font-size:9px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;">Songs found in Serato</span>
          </div>
          <div style="border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);padding:14px;">
            <strong style="display:block;color:#fff;font-family:'Bebas Neue';font-size:26px;line-height:1;">NEXT</strong>
            <span style="display:block;color:rgba(255,255,255,.48);font-size:9px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;">Music folder unlocks listening</span>
          </div>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;align-items:center;">
          <button type="button" onclick="document.getElementById('serato-playback-unlock-modal')?.remove()" style="background:transparent;border:1px solid rgba(255,255,255,.16);color:rgba(255,255,255,.62);font-family:'Bebas Neue';font-size:13px;letter-spacing:2px;padding:11px 20px;cursor:pointer;">LATER</button>
          <button type="button" id="serato-playback-folder-btn" style="background:var(--accent);border:1px solid var(--accent);color:#000;font-family:'Bebas Neue';font-size:14px;letter-spacing:2px;padding:12px 24px;cursor:pointer;">CHOOSE MUSIC FOLDER</button>
        </div>
      </div>`;
    mountAxiomConnectionDialog(modal);
    modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
    document.getElementById('serato-playback-folder-btn')?.addEventListener('click', async () => {
        modal.remove();
        await requestMusicFolderAccess('the music folder that contains your Serato tracks');
    }, { once: true });
}

function connectSeratoDatabaseFileFallback() {
    return new Promise((resolve, reject) => {
        updateMusicIntakeOverlay({
            indexed: 0,
            total: 0,
            folderName: 'Serato',
            stage: 'Choose Serato Database',
            message: 'Choose the database V2 file inside your _Serato_ folder. AXIOM reads it locally and uploads no music.'
        });
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '';
        input.style.display = 'none';
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            input.remove();
            if (!file) {
                reject(new Error('Serato database selection was cancelled.'));
                return;
            }
            try {
                updateMusicIntakeOverlay({
                    indexed: 0,
                    total: 0,
                    folderName: 'Serato',
                    stage: 'Reading Serato Database',
                    message: `Reading ${file.name || 'database V2'} locally. Source files stay untouched.`
                });
                resolve(await window.AXIOM_BROWSER_CONNECT_SERATO_DATABASE_FILE(file));
            } catch (error) {
                reject(error);
            }
        }, { once: true });
        input.addEventListener('cancel', () => {
            input.remove();
            reject(new Error('Serato database selection was cancelled.'));
        }, { once: true });
        document.body.appendChild(input);
        input.click();
    });
}

function chooseDjSourceFile(source) {
    const input = document.getElementById('dj-source-file-upload');
    if (!input) return;
    input.dataset.source = source;
    input.accept = source === 'rekordbox' ? '.xml,text/xml' : '.csv,text/csv';
    input.value = '';
    input.click();
}

async function handleDjSourceFileUpload(event) {
    const input = event.target;
    const file = input.files?.[0];
    const source = input.dataset.source || '';
    if (!file || !source) return;
    closeLibrarySourcePicker();
    try {
        showMusicIntakeOverlay({ indexed: 0, total: 0, folderName: source, stage: `Reading ${source}`, message: 'AXIOM is reading the exported library data locally.' });
        let data;
        if (typeof window.AXIOM_BROWSER_CONNECT_DJ_FILE === 'function') {
            data = await window.AXIOM_BROWSER_CONNECT_DJ_FILE(file, source);
        } else {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('source', source);
            const resp = await fetch('/api/library/connect_dj_source', { method: 'POST', body: formData });
            data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success === false) throw new Error(data.error || data.message || `${source} connection paused.`);
        }
        completeMusicIntakeOverlay({ indexed: Number(data.total_tracks || data.scanned_count || 0), total: Number(data.total_tracks || data.scanned_count || 0), folderName: source, stage: `${source} Ready`, message: data.message || 'DJ library data connected.' });
        showToast(data.message || `${source} connected.`);
        await loadLibraryStats();
        runSearch();
    } catch (error) {
        completeMusicIntakeOverlay({ indexed: 0, total: 0, folderName: source, stage: `${source} Connection Paused`, message: error.message || 'AXIOM could not read that export.' });
        showToast(error.message || `${source} connection paused.`, true);
    } finally {
        input.value = '';
    }
}

function normalizeFolderPathInput(value) {
    let path = String(value || '').trim();
    if ((path.startsWith("'") && path.endsWith("'")) || (path.startsWith('"') && path.endsWith('"'))) {
        path = path.slice(1, -1).trim();
    }
    path = path.replace(/\\ /g, ' ');
    if (path.startsWith('file://')) {
        try {
            path = decodeURIComponent(new URL(path).pathname);
        } catch (_) {
            path = path.replace(/^file:\/\//, '');
        }
    } else {
        try {
            path = decodeURIComponent(path);
        } catch (_) { }
    }
    if (path.length > 1) path = path.replace(/\/+$/, '');
    return path;
}

async function requestMusicFolderAccess(folderName = 'music folder') {
    if (axiomLibraryResetBlocksIntake()) return false;
    if (!document.getElementById('library-source-modal')) {
        await openLibrarySourcePicker();
    }
    return openFolderForLibrary();
}

function showFolderPathPrompt(prefill, folderName) {
    const reveal = () => {
        const manual = document.getElementById('library-source-folder-manual');
        const input = document.getElementById('folder-path-input');
        const status = document.getElementById('folder-path-status');
        if (manual) {
            manual.classList.remove('hidden');
            manual.style.display = 'grid';
        }
        if (input) input.value = normalizeFolderPathInput(prefill || input.value || '');
        if (status) status.innerText = `Paste the full path to ${folderName || 'your music folder'}, then add it. External drives usually start with /Volumes/.`;
        setTimeout(() => {
            if (input && window.matchMedia('(min-width: 761px)').matches) input.focus();
        }, 30);
    };
    if (document.getElementById('library-source-modal')) {
        reveal();
        return;
    }
    openLibrarySourcePicker().then(reveal);
}

function getAxiomConnectionHelpMessage() {
    if (window.location.protocol === 'file:') {
        return 'Open AXIOM DJ from Applications. This file preview cannot connect your music library.';
    }
    return 'AXIOM is not running. Quit this browser tab, open AXIOM DJ from Applications, then connect your music library.';
}

let axiomMusicFolderSelection = null;
window.cancelAxiomMusicFolderSelection = function () {
    const selection = axiomMusicFolderSelection;
    axiomMusicFolderSelection = null;
    selection?.abort();
};

async function openFolderForLibrary() {
    if (axiomMusicFolderSelection) return false;
    const selection = new AbortController();
    axiomMusicFolderSelection = selection;
    const input = document.getElementById('folder-path-input');
    const openBtn = document.getElementById('folder-path-open');
    const status = document.getElementById('folder-path-status');
    const openBtnLabel = openBtn?.innerText || 'ADD MUSIC FOLDER';
    if (openBtn) {
        openBtn.disabled = true;
        openBtn.style.opacity = '0.7';
        openBtn.style.cursor = 'wait';
        openBtn.innerText = 'OPENING FOLDER PICKER...';
    }
    if (status) {
        status.style.color = 'var(--accent)';
        status.innerText = 'Choose the folder that contains your music collection.';
    }
    try {
        const data = await pickMusicFolderPath(selection.signal);
        // Closing the chooser invalidates any late native or HTTP result.
        if (selection.signal.aborted) return false;
        const fullPath = normalizeFolderPathInput(data.folder_path);
        if (input) {
            input.value = fullPath;
            input.style.borderColor = 'var(--accent)';
        }
        axiomMusicFolderSelection = null;
        await addFolder(fullPath, data.folder_name || 'music library');
        return true;
    } catch (err) {
        if (selection.signal.aborted || err.cancelled || err.payload?.cancelled) {
            if (status) {
                status.style.color = '#777';
                status.innerText = 'Folder selection cancelled.';
            }
            return false;
        }
        const message = err.nativeTimeout
            ? 'The Mac folder picker did not respond. Paste the folder path below, then click Add Music Folder.'
            : (err.message || getAxiomConnectionHelpMessage());
        if (status) {
            status.style.color = '#ef4444';
            status.innerText = message;
        }
        showToast(message, true);
        return false;
    } finally {
        if (axiomMusicFolderSelection === selection) axiomMusicFolderSelection = null;
        if (openBtn && document.body.contains(openBtn)) {
            openBtn.disabled = false;
            openBtn.style.opacity = '1';
            openBtn.style.cursor = 'pointer';
            openBtn.innerText = openBtnLabel;
        }
    }
}

async function confirmFolderPath() {
    const input = document.getElementById('folder-path-input');
    if (!input) return;
    let fullPath = normalizeFolderPathInput(input.value);
    if (!fullPath) {
        input.style.borderColor = '#ef4444';
        return;
    }
    const parts = fullPath.replace(/\\/g, '/').split('/');
    const folderName = parts[parts.length - 1] || 'folder';
    input.value = fullPath;
    await addFolder(fullPath, folderName);
}

async function watchLibraryTagEnrichment(jobId) {
    window.axiomTagEnrichmentJob = jobId;
    const deadline = Date.now() + 30 * 60 * 1000;
    while (window.axiomTagEnrichmentJob === jobId && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        if (window.axiomTagEnrichmentJob !== jobId) return;
        try {
            const resp = await fetch(`/api/library/add_folder/status/${encodeURIComponent(jobId)}`);
            const data = await resp.json();
            if (!resp.ok || !data.success) throw new Error('Track details could not refresh.');
            if (data.status === 'complete') {
                refreshLibrary();
                showToast(data.enrichment_warning || 'Track details are ready. Source audio stays untouched.');
                return;
            }
            if (data.status === 'failed') {
                showToast(data.error || 'Track details paused. Open Library Health to retry.', true);
                return;
            }
        } catch (error) {
            showToast('Background track details paused. Open Library Health to retry.', true);
            return;
        }
    }
}

async function waitForAddFolderJob(jobId, statusEl, folderName) {
    const performanceMessages = [
        'Building harmonic pathways...',
        'Detecting energy signatures...',
        'Organizing performance layers...',
        'Preparing intelligent crate search...',
        'Protecting source audio while AXIOM analyzes...'
    ];
    let messageIndex = 0;
    let libraryReadyShown = false;
    const startedAt = Date.now();
    while (true) {
        await new Promise(resolve => setTimeout(resolve, 1200));
        const resp = await fetch(`/api/library/add_folder/status/${encodeURIComponent(jobId)}`);
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.success) {
            throw new Error(data.error || 'Library connection paused. Your music remains protected.');
        }
        const processed = Number(data.processed || 0);
        const foldersSeen = Number(data.folders_seen || 0);
        const total = Number(data.total || data.total_tracks || data.scanned_count || 0);
        const elapsedSeconds = Math.max(0, Number(data.elapsed_seconds || Math.floor((Date.now() - startedAt) / 1000)));
        const liveMessage = data.message || performanceMessages[messageIndex % performanceMessages.length];
        const liveDetail = processed > 0
            ? `${processed.toLocaleString()} tracks indexed from ${foldersSeen.toLocaleString()} folders · ${elapsedSeconds}s live`
            : `${foldersSeen.toLocaleString()} folders checked · ${elapsedSeconds}s live`;
        if (statusEl) {
            statusEl.style.color = 'var(--accent)';
            statusEl.innerText = `${liveMessage} · ${liveDetail}`;
        }
        updateMusicIntakeOverlay({
            indexed: processed,
            total,
            foldersSeen,
            folderName,
            stage: data.worker_alive === false ? 'Drive Scan Paused' : 'Drive Scan Live',
            message: `${liveDetail}. AXIOM is reading metadata while source audio stays untouched.`
        });
        messageIndex++;
        if (data.status === 'complete') return data.result || data;
        if (data.status === 'failed') {
            throw new Error(data.error || data.result?.error || 'Library connection paused. Your music remains protected.');
        }
        if (data.library_ready === true && data.ready_result && !libraryReadyShown) {
            libraryReadyShown = true;
            const ready = { ...data.ready_result, enrichment_in_progress: data.status !== 'complete' };
            if (ready.total_tracks != null) {
                updateLibraryCount(ready.total_tracks);
                setLibraryConnectionState(ready.total_tracks);
            }
            libraryHasTracks = Number(ready.total_tracks || 0) > 0;
            refreshLibrary();
            watchLibraryTagEnrichment(jobId);
            return ready;
        }
    }
}

function clearLibraryConnectionErrorNotification() {
    const libraryError = /could not fully access that location|library connection (?:paused|stopped)|music load paused/i;
    const player = document.getElementById('audio-player');
    player?.querySelectorAll('.player-notification-surface').forEach(surface => {
        const message = surface.querySelector('strong')?.textContent || surface.textContent || '';
        if (libraryError.test(message)) surface.remove();
    });
    if (player && !player.querySelector('.player-notification-surface')) {
        clearTimeout(player._axiomNotificationTimer);
        clearTimeout(player._axiomNotificationExitTimer);
        player.classList.remove('player-notification-active', 'player-notification-error', 'player-notification-leaving');
    }
    document.querySelectorAll('#toast-container [data-toast-key]').forEach(toast => {
        if (libraryError.test(toast.textContent || '')) toast.remove();
    });
}

function showLibraryConnectionComplete(modal, data, folderName) {
    clearLibraryConnectionErrorNotification();
    const totalTracks = Number(data.total_tracks || 0);
    const addedTracks = Number(data.added_count || 0);
    const scannedTracks = Number(data.scanned_count || addedTracks || 0);
    const folderLabel = folderName || 'Music Library';
    const enriching = data.enrichment_in_progress === true;
    showToast(data.message || `Library ready. ${totalTracks.toLocaleString()} tracks prepared. Source audio remains untouched.`);

    if (!modal) {
        return;
    }

    modal.innerHTML = `
        <div style="position:relative;background:
                radial-gradient(circle at 20% 0%, rgba(57,255,20,0.18), transparent 32%),
                linear-gradient(145deg,#071308 0%,#0b0d0f 48%,#111 100%);
            border:1px solid rgba(57,255,20,0.72);padding:42px;width:680px;max-width:92vw;
            box-shadow:0 0 50px rgba(57,255,20,0.22), inset 0 0 40px rgba(255,255,255,0.03);
            overflow:hidden;">
            <div style="position:absolute;inset:0;background:
                linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px);
                background-size:28px 28px;opacity:.35;pointer-events:none;"></div>
            <div style="position:relative;z-index:1;">
                <p style="font-family:'Barlow';font-size:9px;color:var(--accent);letter-spacing:3px;text-transform:uppercase;margin-bottom:8px;">LIBRARY READY</p>
                <h3 style="font-family:'Bebas Neue';font-size:46px;line-height:.92;color:#fff;letter-spacing:2px;margin-bottom:10px;">
                    ${escapeHtml(folderLabel)} CONNECTED
                </h3>
                <p style="font-family:'Barlow';font-size:13px;color:#cfd6cc;margin-bottom:24px;line-height:1.7;max-width:560px;">
                    ${enriching
                      ? 'Your tracks are searchable now. AXIOM is reading BPM, key, year and duration in the background while you keep working. Your source audio remains untouched.'
                      : 'Performance intelligence is prepared. Search, era filters, harmonic pathways, and set-building suggestions are ready. Your source audio remains untouched.'}
                </p>
                <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:26px;">
                    <div style="background:rgba(255,255,255,0.055);border:1px solid rgba(255,255,255,0.1);padding:16px;">
                        <div style="font-family:'Bebas Neue';font-size:34px;color:var(--accent);line-height:1;">${totalTracks.toLocaleString()}</div>
                        <div style="font-family:'Barlow';font-size:9px;color:#9aa19a;letter-spacing:2px;text-transform:uppercase;">Tracks Ready</div>
                    </div>
                    <div style="background:rgba(255,255,255,0.055);border:1px solid rgba(255,255,255,0.1);padding:16px;">
                        <div style="font-family:'Bebas Neue';font-size:34px;color:#fff;line-height:1;">${addedTracks.toLocaleString()}</div>
                        <div style="font-family:'Barlow';font-size:9px;color:#9aa19a;letter-spacing:2px;text-transform:uppercase;">New Records</div>
                    </div>
                    <div style="background:rgba(57,255,20,0.08);border:1px solid rgba(57,255,20,0.22);padding:16px;">
                        <div style="font-family:'Bebas Neue';font-size:34px;color:#fff;line-height:1;">${scannedTracks.toLocaleString()}</div>
                        <div style="font-family:'Barlow';font-size:9px;color:#9aa19a;letter-spacing:2px;text-transform:uppercase;">${enriching ? 'Index Ready' : 'Analyzed Safely'}</div>
                    </div>
                </div>
                <div style="display:flex;gap:12px;justify-content:flex-end;align-items:center;">
                    <button id="library-ready-build"
                        style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.18);color:#fff;font-family:'Bebas Neue';font-size:14px;letter-spacing:2px;padding:13px 26px;cursor:pointer;">
                        BUILD SET
                    </button>
                    <button id="library-ready-enter"
                        style="background:linear-gradient(135deg,var(--accent),#9CFF00);border:none;color:#000;font-family:'Bebas Neue';font-size:15px;letter-spacing:2px;padding:14px 32px;cursor:pointer;box-shadow:0 0 26px rgba(57,255,20,0.3);">
                        ENTER LIBRARY
                    </button>
                </div>
                <div style="margin-top:18px;font-family:'Barlow';font-size:9px;color:#39FF14;letter-spacing:2px;text-transform:uppercase;">
                    ${enriching ? 'Metadata finishing in background' : 'Protected performance layer active'}
                </div>
            </div>
        </div>`;
    modal.firstElementChild?.classList.add('axiom-connection-dialog-panel');
    modal.classList.remove('music-intake-source-suspended');
    modal.removeAttribute('aria-hidden');
    syncAxiomConnectionDialogState();

    const enterBtn = document.getElementById('library-ready-enter');
    const buildBtn = document.getElementById('library-ready-build');
    if (enterBtn) {
        enterBtn.onclick = async () => {
            modal.remove();
            showTab('library');
            await runSearch();
            const search = document.getElementById('main-search');
            if (search) search.focus();
        };
    }
    if (buildBtn) {
        buildBtn.onclick = async () => {
            modal.remove();
            startNewSet();
            await runSearch();
        };
    }
}

async function addFolder(folderPath, folderName, options = {}) {
    if (axiomLibraryResetBlocksIntake()) return false;
    clearLibraryConnectionErrorNotification();
    const modal = document.getElementById('library-source-modal');
    const input = document.getElementById('folder-path-input');
    const confirmBtn = document.getElementById('folder-path-confirm');
    const status = document.getElementById('folder-path-status');
    let libraryConnectionCompleted = false;
    const normalizedPath = normalizeFolderPathInput(folderPath);
    if (input && normalizedPath) input.value = normalizedPath;
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.style.opacity = '0.65';
        confirmBtn.style.cursor = 'wait';
        confirmBtn.innerText = 'CONNECTING...';
    }
    if (status) {
        status.style.color = 'var(--accent)';
        status.innerText = 'Preparing protected performance layer...';
    }
    // The progress board replaces the source chooser while AXIOM is working.
    // Keeping both mounted visibly was the cause of the overlapping modal UI.
    modal?.classList.add('music-intake-source-suspended');
    modal?.setAttribute('aria-hidden', 'true');
    showToast(`Building performance intelligence for ${folderName || 'library'}...`);
    showMusicIntakeOverlay({
        folderName: folderName || 'Music Library',
        stage: 'Loading Music',
        title: `${folderName || 'Music Library'} Index`,
        message: 'AXIOM is preparing track metadata for Library, Studio, and Magic Set.'
    });
    try {
        const resp = await fetch('/api/library/add_folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                folder_path: normalizedPath,
                async: true,
                confirmed_music_preflight: Boolean(options.confirmedMusicPreflight),
                excluded: Array.isArray(options.excludedFolders) ? options.excludedFolders : undefined
            })
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            const message = err.error || 'AXIOM could not fully access that location. Check permissions or choose another library.';
            if (err.needs_music_preflight) {
                const exclusions = (err.recommended_exclusions || [])
                    .map(item => item.path)
                    .filter(Boolean);
                const skippedFiles = Number(err.skipped_supported_file_count || 0);
                const reviewMessage = exclusions.length
                    ? `AXIOM found ${exclusions.length} sample, backup, or test folder${exclusions.length === 1 ? '' : 's'} inside Music. Skip those ${skippedFiles.toLocaleString()} supported file${skippedFiles === 1 ? '' : 's'} and continue?`
                    : (err.message || 'AXIOM found utility folders inside Music. Continue with the suggested exclusions?');
                completeMusicIntakeOverlay({
                    folderName: folderName || 'Music Library',
                    stage: 'Review Music Folder',
                    message: err.message || reviewMessage
                });
                const confirmed = await showAxiomConfirm(
                    'Review Music Folder',
                    reviewMessage,
                    'SKIP UTILITY FOLDERS AND CONTINUE',
                    'warning'
                );
                if (confirmed) {
                    return await addFolder(normalizedPath, folderName, {
                        confirmedMusicPreflight: true,
                        excludedFolders: exclusions
                    });
                }
                if (status) {
                    status.style.color = '#ef4444';
                    status.innerText = 'Music folder review cancelled. Choose a narrower folder or continue with exclusions.';
                }
                showToast('Music folder review cancelled. Source audio untouched.', true);
                return false;
            }
            completeMusicIntakeOverlay({
                folderName: folderName || 'Music Library',
                stage: 'Music Load Paused',
                message
            });
            if (status) {
                status.style.color = '#ef4444';
                status.innerText = message;
            }
            if (input) input.style.borderColor = '#ef4444';
            showToast(message, true);
            return false;
        }
        let data = await resp.json();
        if (data.browser_preview && data.needs_browser_folder_picker) {
            const message = data.message || data.error || 'Choose the folder so AXIOM can read the browser-approved music files.';
            if (status) {
                status.style.color = 'var(--accent)';
                status.innerText = message;
            }
            if (input) input.style.borderColor = 'var(--accent)';
            showToast(message, true);
            if (typeof window !== 'undefined' && typeof window.AXIOM_BROWSER_OPEN_FOLDER_FOR_LIBRARY === 'function') {
                return await window.AXIOM_BROWSER_OPEN_FOLDER_FOR_LIBRARY();
            }
            if (typeof openFolderForLibrary === 'function') {
                return await openFolderForLibrary();
            }
            return false;
        }
        if (data.success === false) {
            const message = data.message || data.error || 'AXIOM could not fully access that location. Check permissions or choose another library.';
            completeMusicIntakeOverlay({
                folderName: folderName || 'Music Library',
                stage: 'Music Load Paused',
                message
            });
            if (status) {
                status.style.color = '#ef4444';
                status.innerText = message;
            }
            if (input) input.style.borderColor = '#ef4444';
            showToast(message, true);
            return false;
        }
        if (data.job_id) {
            if (status) {
                status.style.color = 'var(--accent)';
                status.innerText = 'Library connection started. Source audio remains untouched.';
            }
            data = await waitForAddFolderJob(data.job_id, status, folderName);
        }
        if ((data.scanned_count || 0) === 0) {
            const message = data.message || 'No supported music files were found in that folder. Choose the folder that contains your music collection.';
            completeMusicIntakeOverlay({
                indexed: 0,
                total: Number(data.total_tracks || 0),
                folderName: folderName || 'Music Library',
                stage: 'No Music Found',
                message
            });
            if (status) {
                status.style.color = '#ef4444';
                status.innerText = message;
            }
            if (input) input.style.borderColor = '#ef4444';
            showToast(message, true);
            if (data.total_tracks != null) {
                updateLibraryCount(data.total_tracks);
                setLibraryConnectionState(data.total_tracks);
            }
            if (!libraryHasTracks && isLibraryTabVisible()) {
                renderLibraryConnectionPrompt();
            }
            return false;
        }
        if (data.total_tracks != null) {
            updateLibraryCount(data.total_tracks);
            setLibraryConnectionState(data.total_tracks);
        }
        if (!data.enrichment_in_progress && libraryNeedsBpmRepair(data)) {
            completeMusicIntakeOverlay({
                indexed: data.total_tracks || data.scanned_count || data.added_count || 0,
                total: data.total_tracks || data.scanned_count || data.added_count || 0,
                folderName: folderName || 'Music Library',
                stage: 'BPM Repair Needed',
                message: 'Music loaded. Open Library Health so AXIOM can repair BPM in its own cache.'
            });
            if (status) {
                status.style.color = 'var(--accent)';
                status.innerText = 'Music loaded. Opening Library Health for BPM repair...';
            }
            libraryConnectionCompleted = true;
            hideMusicIntakeOverlay();
            if (modal) modal.remove();
            openBpmRepairFromLibrary(data);
            return true;
        }
        setLibraryConnectionState(data.total_tracks || data.scanned_count || data.added_count || 0, { openLibrary: true });
        completeMusicIntakeOverlay({
            indexed: data.total_tracks || data.scanned_count || data.added_count || 0,
            total: data.total_tracks || data.scanned_count || data.added_count || 0,
            folderName: folderName || 'Music Library',
            stage: 'Library Ready',
            message: data.enrichment_in_progress ? 'Your tracks are searchable now. Track details are finishing in the background.' : 'Search, Studio building, and Magic Set suggestions are ready.'
        });
        if (status) {
            status.style.color = 'var(--accent)';
            status.innerText = 'Library ready. Preparing your next step...';
        }
        await runSearch();
        libraryConnectionCompleted = true;
        hideMusicIntakeOverlay();
        modal?.classList.remove('music-intake-source-suspended');
        modal?.removeAttribute('aria-hidden');
        syncAxiomConnectionDialogState();
        showLibraryConnectionComplete(modal, data, folderName);
        return true;
    } catch (err) {
        const message = 'AXIOM could not fully access that location. Your library remains protected.';
        completeMusicIntakeOverlay({
            indexed: 0,
            total: 0,
            folderName: folderName || 'Music Library',
            stage: 'Music Load Paused',
            message
        });
        if (status) {
            status.style.color = '#ef4444';
            status.innerText = message;
        }
        showToast(message, true);
        return false;
    } finally {
        if (!libraryConnectionCompleted && modal && document.body.contains(modal)) {
            hideMusicIntakeOverlay();
            modal.classList.remove('music-intake-source-suspended');
            modal.removeAttribute('aria-hidden');
            syncAxiomConnectionDialogState();
        }
        if (confirmBtn && document.body.contains(confirmBtn)) {
            confirmBtn.disabled = false;
            confirmBtn.style.opacity = '1';
            confirmBtn.style.cursor = 'pointer';
            confirmBtn.innerText = 'ADD MUSIC FOLDER';
        }
    }
}

// ========== FEATURE 2: RESCAN LIBRARY ==========

async function rescanLibrary() {
    const btn = document.getElementById('btn-rescan');
    const btnText = document.getElementById('rescan-btn-text');
    const spinner = document.getElementById('rescan-spinner');

    btn.disabled = true;
    btn.style.opacity = '0.7';
    btn.style.cursor = 'not-allowed';
    btnText.innerText = 'ANALYZING...';
    spinner.classList.remove('hidden');

    try {
        const resp = await fetch('/api/library/rescan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            showToast(err.error || 'Performance analysis paused. Your library remains protected.', true);
            return;
        }
        const data = await resp.json();
        const removed = data.removed_count || 0;
        const broken = data.broken_tracks || [];

        updateLibraryCount(data.total_tracks);
        setLibraryConnectionState(data.total_tracks);
        if (removed > 0) runSearch();

        if (removed === 0) {
            showToast('Library ready. Source audio remains untouched.');
        } else {
            showToastWithAction(
                `Library ready. ${removed} unavailable track${removed !== 1 ? 's' : ''} removed from view.`,
                'View Report',
                () => openRescanReport(removed, broken)
            );
        }
    } catch (err) {
        showToast('Performance analysis paused. Your library remains protected.', true);
    } finally {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
        btnText.innerText = 'RESCAN LIBRARY';
        spinner.classList.add('hidden');
    }
}

function showToastWithAction(msg, actionLabel, actionFn) {
    const displayMessage = typeof playerNotificationMessage === 'function'
        ? playerNotificationMessage(msg)
        : String(msg || '').trim();
    if (typeof showPlayerNotification === 'function' && showPlayerNotification(displayMessage, {
        actionLabel,
        actionFn,
        duration: playerNotificationDuration(displayMessage, true),
    })) return;
    const toast = document.createElement('div');
    toast.className = 'glass px-6 py-4 rounded-xl border border-axiom-accent/50 text-axiom-accent text-[11px] font-black uppercase tracking-widest shadow-lg transition-all duration-300';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.gap = '12px';
    const message = document.createElement('span');
    message.innerText = displayMessage;
    toast.appendChild(message);
    const actionBtn = document.createElement('button');
    actionBtn.innerText = actionLabel;
    actionBtn.style.cssText = 'background:var(--accent); color:#000; border:none; padding:4px 12px; font-family:Bebas Neue; font-size:11px; letter-spacing:1px; cursor:pointer; border-radius:4px; flex-shrink:0;';
    actionBtn.onclick = () => { toast.remove(); actionFn(); };
    toast.appendChild(actionBtn);
    const dismissBtn = document.createElement('button');
    dismissBtn.innerText = '×';
    dismissBtn.setAttribute('aria-label', 'Dismiss notification');
    dismissBtn.setAttribute('title', 'Dismiss notification');
    dismissBtn.style.cssText = 'width:28px; height:28px; flex:0 0 28px; border:1px solid currentColor; border-radius:3px; background:rgba(0,0,0,.28); color:inherit; font-size:20px; line-height:1; cursor:pointer;';
    dismissBtn.onclick = () => toast.remove();
    toast.appendChild(dismissBtn);
    document.getElementById('toast-container').appendChild(toast);
}

function openRescanReport(removedCount, brokenTracks) {
    document.getElementById('rescan-report-title').innerText = `${removedCount} BROKEN TRACK${removedCount !== 1 ? 'S' : ''} REMOVED`;
    const list = document.getElementById('rescan-report-list');
    if (!brokenTracks || brokenTracks.length === 0) {
        list.innerHTML = '<p style="color:#555; font-size:12px; text-align:center; padding:40px 0;">No detail available.</p>';
    } else {
        list.innerHTML = brokenTracks.map((t, i) => `
            <div style="border-bottom:1px solid #1a1a1a; padding:14px 0; display:flex; justify-content:space-between; align-items:center; gap:20px;">
                <div style="overflow:hidden;">
                    <p style="color:#fff; font-size:11px; font-weight:900; letter-spacing:1px; text-transform:uppercase; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(t.path || 'Unknown path')}</p>
                    <p style="color:#ef4444; font-size:9px; letter-spacing:1px; text-transform:uppercase; margin-top:3px;">${escapeHtml(t.error || 'Unknown error')}</p>
                </div>
                <span style="font-family:'Bebas Neue'; font-size:10px; color:#555; flex-shrink:0;">#${i + 1}</span>
            </div>
        `).join('');
    }
    const modal = document.getElementById('rescan-report-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
}

function closeRescanModal() {
    const modal = document.getElementById('rescan-report-modal');
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

// Close rescan modal on backdrop click (deferred — modal HTML is after this script tag)
