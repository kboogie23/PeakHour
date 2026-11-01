/* Health owns selection and tasks; the existing Doctor owns guarded delivery. */
(() => {
    'use strict';
    const state = {provider: 'djay', scope: 'full', sources: [], selected: new Set(), folder: null, epoch: 0};
    let latestAudit = null;
    const byId = id => document.getElementById(id);
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const fixture = () => ['localhost', '127.0.0.1'].includes(location.hostname) &&
        new URLSearchParams(location.search).get('review') === 'health' &&
        new URLSearchParams(location.search).get('ui_preview') === 'beatgrid-doctor';
    function endpoint(action) {
        const path = `/api/library/health/beatgrid_doctor/${action}`;
        return fixture() ? `${path}?review=health&ui_preview=beatgrid-doctor` : path;
    }
    function note(message) { if (byId('health-doctor-scope-note')) byId('health-doctor-scope-note').textContent = message; }
    function mount(container) {
        container.innerHTML = `<section id="health-doctor-setup" aria-label="Choose music and preparation tasks">
            <p>Check one collection or your whole library. Apply supported corrections together; review uncertain songs separately.</p>
            <div class="health-doctor-fields">
                <label>DJ library<select id="health-doctor-provider" onchange="AxiomHealthDoctor.provider(this.value)"><option value="djay">djay Pro</option><option value="serato">Serato</option></select></label>
                <label>Music<select id="health-doctor-scope" onchange="AxiomHealthDoctor.scope(this.value)"><option value="full">Entire library</option><option value="collections">Crates / playlists</option><option value="folder">Music folder</option><option value="selected">Selected songs</option></select></label>
                <label>Verification<select id="health-doctor-verification"><option value="sampled">Quick check: start, middle, end</option><option value="complete">Check every section</option></select></label>
            </div>
            <div id="health-doctor-sources" hidden></div>
            <button id="health-doctor-folder" class="health-transfer-secondary" type="button" hidden onclick="AxiomHealthDoctor.folder()">Add Music Folder</button>
            <fieldset class="health-doctor-tasks"><legend>Work to check</legend>
                <label><input type="checkbox" name="health-doctor-task" value="alignment" checked>Beat alignment</label>
                <label><input type="checkbox" name="health-doctor-task" value="bpm">BPM corrections</label>
                <label><input type="checkbox" name="health-doctor-task" value="bar_one">Downbeat / bar 1</label>
                <label><input type="checkbox" name="health-doctor-task" value="labels">Cue-label review</label>
            </fieldset>
            <p id="health-doctor-scope-note" role="status">Alignment includes tempo checking. Corrections require reliable evidence; cue-label review preserves existing cues.</p>
            <button id="health-doctor-check" class="health-transfer-primary" type="button" onclick="AxiomHealthDoctor.check()">Check Beatgrids</button>
            <div id="health-doctor-summary" aria-live="polite"></div>
        </section>`;
    }
    function syncProvider(value) {
        if (!['djay', 'serato'].includes(value)) return;
        const changed = state.provider !== value;
        if (changed) {
            state.provider = value; state.sources = []; state.selected.clear(); state.folder = null; state.epoch++;
            latestAudit = null;
            if (byId('health-doctor-summary')) byId('health-doctor-summary').textContent = '';
        }
        if (byId('health-doctor-provider')) byId('health-doctor-provider').value = value;
        if (changed) void scope(state.scope);
    }
    function provider(value) {
        if (!['djay', 'serato'].includes(value)) return;
        syncProvider(value);
        window.selectBeatgridDoctorTarget?.(value);
    }
    async function scope(value) {
        if (!['full', 'collections', 'folder', 'selected'].includes(value)) return;
        state.scope = value;
        const host = byId('health-doctor-sources');
        host.hidden = value !== 'collections';
        byId('health-doctor-folder').hidden = value !== 'folder';
        if (value === 'selected') note('Choose songs in the Doctor song picker below, then check this selection.');
        else if (value === 'folder') note(state.folder || 'Choose a folder and its subfolders. Songs missing from the chosen DJ library are reported separately.');
        else if (value === 'full') note('Check the entire chosen DJ library. Unchanged results can be reused.');
        if (value !== 'collections') return;
        const epoch = ++state.epoch;
        host.textContent = 'Reading collections…';
        try {
            const response = await fetch(`${endpoint('library_sources')}${fixture() ? '&' : '?'}provider=${state.provider}`);
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Collections could not be read.');
            if (epoch !== state.epoch || state.scope !== 'collections') return;
            state.sources = data.sources;
            host.innerHTML = data.sources.length ? data.sources.map(source => `<label><input type="checkbox" value="${escape(source.id)}" ${state.selected.has(source.id) ? 'checked' : ''} onchange="AxiomHealthDoctor.select(this.value,this.checked)">${escape(source.name)} <small>${Number(source.matched_track_count || 0).toLocaleString()} of ${Number(source.track_count ?? source.matched_track_count ?? 0).toLocaleString()} available</small></label>`).join('') : '<p>No crates or playlists are available in this library.</p>';
            note('Choose one or several collections. Shared songs are checked once.');
        } catch (error) { if (epoch === state.epoch) host.textContent = error.message; }
    }
    async function folder() {
        const button = byId('health-doctor-folder'); button.disabled = true;
        try {
            const response = await fetch(endpoint('library_scope'), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({provider:state.provider,pick_folder:true})});
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Folder could not be checked.');
            if (data.cancelled) return;
            state.folder = data.selection.folder;
            note(`${data.selection.selected_tracks.toLocaleString()} songs in ${state.folder}. ${data.selection.not_in_dj_library.toLocaleString()} music files need adding to ${state.provider === 'djay' ? 'djay' : 'Serato'} before their DJ grids can be checked.`);
        } catch (error) { note(error.message); }
        finally { button.disabled = false; }
    }
    async function check() {
        const tasks = [...document.querySelectorAll('input[name="health-doctor-task"]:checked')].map(input => input.value);
        if (!tasks.length) return note('Choose at least one preparation task.');
        if (state.scope === 'collections' && !state.selected.size) return note('Choose a crate or playlist first.');
        if (state.scope === 'folder' && !state.folder) return note('Add a music folder first.');
        window.selectBeatgridDoctorTarget?.(state.provider);
        const options = {scope: state.scope === 'full' ? 'full' : 'selection',
            tasks, verification:byId('health-doctor-verification').value};
        if (state.scope === 'collections') options.source_ids = [...state.selected];
        if (state.scope === 'folder') options.folder = state.folder;
        await window.scanBeatgridLibrary?.(options);
    }
    function progress(audit) {
        const host = byId('health-doctor-summary'); if (!host || !audit) return;
        latestAudit = audit;
        if (audit.scope_selection?.unavailable_memberships) note(`${Number(audit.scope_selection.unavailable_memberships).toLocaleString()} collection entries have no available local music and are excluded from this check.`);
        const active = ['starting','running','publishing','recovering'].includes(audit.status);
        for (const control of byId('health-doctor-setup').querySelectorAll('input,select,button')) control.disabled = active;
        const count = value => Math.max(0,Number(value)||0).toLocaleString();
        const labelsOnly = audit.requested_tasks?.length === 1 && audit.requested_tasks[0] === 'labels';
        host.textContent = active ? `${count(audit.checked)} of ${count(audit.total)} checked.` :
            audit.status === 'complete' ? `${count(audit.clean)} ${labelsOnly ? 'have named cues' : 'passed timing checks'}. ${count(audit.repair)} repair candidates. ${count(audit.review)} need review. ${count(audit.fully_verified)} passed every requested task. ${count(audit.reused)} saved results reused.` :
            audit.status === 'published' ? `${count(audit.written)} delivered to ${audit.provider === 'djay' ? 'djay' : 'Serato'}. Other requested tasks may still need review.` : '';
        const labels = {bar_one:'Bar 1',labels:'Cue labels',bpm:'BPM',alignment:'Alignment'};
        if (['complete','published'].includes(audit.status)) {
            const remaining = Math.max(0, Number(audit.repair || 0) - Number(audit.repaired_this_scan || 0));
            if (remaining) {
                const repair = document.createElement('button');
                repair.type = 'button'; repair.className = 'health-transfer-primary';
                repair.textContent = `Review ${count(remaining)} repairs`;
                repair.onclick = () => window.publishBeatgridLibrary?.({mode:'full'});
                host.appendChild(repair);
            }
            for (const [task, total] of Object.entries(audit.task_review_counts || {})) {
                if (!total || !labels[task]) continue;
                const button = document.createElement('button');
                button.type = 'button'; button.className = 'health-transfer-secondary';
                button.textContent = `Review ${labels[task]} (${count(total)})`;
                button.onclick = () => {
                    window.selectBeatgridLibrarySongsFilter?.(task);
                    const results = byId('health-beatgrid-library-results');
                    if (results) results.open = true;
                };
                host.appendChild(button);
            }
            const backup = document.createElement('button');
            backup.type = 'button'; backup.className = 'health-transfer-secondary';
            backup.textContent = `Backups: ${audit.backup_location?.label || 'This Mac'}`;
            backup.onclick = () => window.chooseBeatgridBackupLocation?.();
            host.appendChild(backup);
            if (audit.receipt_path) {
                const receipt = document.createElement('button');
                receipt.type = 'button'; receipt.className = 'health-transfer-secondary';
                receipt.textContent = 'Export Receipt';
                receipt.onclick = () => window.exportBeatgridLibraryReceipt?.();
                host.appendChild(receipt);
            }
        }
        if (audit.rollback_required) {
            const restore = document.createElement('button');
            restore.type = 'button'; restore.className = 'health-transfer-secondary';
            restore.textContent = 'Review grid recovery';
            restore.onclick = () => window.recoverBeatgridLibrary?.();
            host.appendChild(restore);
        }
        const chip = byId('health-section-status-doctor');
        if (chip) chip.textContent = active ? 'Checking' : audit.status === 'complete' ? `${count(audit.repair)} repair candidates` : 'Check beatgrids';
    }
    function statusLabel() {
        if (!latestAudit) return 'Check beatgrids';
        if (['starting','running','publishing','recovering'].includes(latestAudit.status)) return 'Checking';
        return latestAudit.status === 'complete' ? `${Number(latestAudit.repair || 0).toLocaleString()} repair candidates` : 'Check beatgrids';
    }
    window.AxiomHealthDoctor = {mount, provider, syncProvider, scope, folder, check, progress, statusLabel,
        selectedScope:() => state.scope === 'selected',
        select:(id, checked) => checked ? state.selected.add(id) : state.selected.delete(id)};
})();
