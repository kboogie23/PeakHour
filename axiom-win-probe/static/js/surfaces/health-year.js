    // Full-library missing-tag publishing: one confirmation per batch.
    let healthMetadataBatch = {};
    let healthMetadataBatchTimer = null;
    let healthMetadataAwaitingConfirmation = false;
    let healthMetadataReviewState = null;

    function healthMetadataPublishReady() {
        if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('health_publish_locked') === '1') return false;
        const shell = document.getElementById('health-inbox-app');
        if (!shell) return true;
        if (!shell.dataset || typeof shell.dataset.healthHasSnapshot === 'undefined') return true;
        return shell.dataset?.healthHasSnapshot === 'true';
    }

    function syncHealthMetadataPublishGate(busy = false) {
        const ready = healthMetadataPublishReady();
        const start = document.getElementById('health-batch-start');
        if (start) {
            if (!start.dataset) start.dataset = {};
            start.dataset.healthBatchBusy = String(Boolean(busy || healthMetadataAwaitingConfirmation));
            start.disabled = !ready || busy || healthMetadataAwaitingConfirmation;
        }
        if (typeof window !== 'undefined') window.AxiomHealthCockpit?.syncBatchPublishGate?.({known: ready, batchActive: busy || healthMetadataAwaitingConfirmation});
        return ready;
    }

    function renderHealthMetadataBatch(data) {
        const finished = healthMetadataBatch.state !== data.state && ['complete', 'rolled_back', 'rollback_partial'].includes(data.state);
        healthMetadataBatch = data;
        if (data.id && typeof window !== 'undefined') window.AxiomHealthCockpit?.open('refresh');
        const busy = ['previewing', 'planning', 'backing_up', 'publishing', 'rolling_back'].includes(data.state);
        const labels = {previewing: 'Checking existing file tags', ready: 'Library checked', planning: 'Resolving missing BPM, key and original-song years', backing_up: 'Backing up the full batch before publishing', publishing: 'Publishing and verifying file tags', complete: 'Batch finished', interrupted: 'Batch interrupted; backups retained', failed: 'Batch could not start', rolling_back: 'Restoring the full batch', rolled_back: 'Batch metadata restored', rollback_partial: 'Rollback finished with exceptions'};
        const status = document.getElementById('health-batch-status');
        if (status) status.textContent = `${data.demo ? 'Local preview — no files changed. ' : ''}${labels[data.state] || 'Ready to check your full library.'}${data.total ? ` · ${Number(data.progress || 0).toLocaleString()} / ${Number(data.total).toLocaleString()} files` : ''}${data.error ? ` · ${data.error}` : ''}`;
        const counts = data.summary || {};
        const summary = document.getElementById('health-batch-summary');
        if (summary) summary.textContent = `${Number(counts.published || 0).toLocaleString()} files updated${counts.rolled_back ? ` · ${Number(counts.rolled_back).toLocaleString()} files restored` : ''} · ${Number(counts.already_complete || 0).toLocaleString()} already complete · ${Number(data.exception_files || 0).toLocaleString()} ${data.exception_files === 1 ? 'file' : 'files'} with exceptions`;
        syncHealthMetadataPublishGate(busy);
        const history = document.getElementById('health-batch-history-button');
        if (history) history.disabled = busy || healthMetadataAwaitingConfirmation;
        const choice = document.getElementById('health-batch-history');
        if (choice) choice.disabled = busy || healthMetadataAwaitingConfirmation;
        const rollback = document.getElementById('health-batch-rollback');
        rollback?.classList.toggle('hidden', !data.rollback_available);
        if (rollback) rollback.disabled = busy;
        const report = document.getElementById('health-batch-report');
        report?.classList.toggle('hidden', !data.id || busy || data.demo);
        if (report && data.id) report.href = `/api/library/health_publish/report?job_id=${encodeURIComponent(data.id)}`;
        document.getElementById('health-batch-refresh')?.classList.toggle('hidden', !counts.published);
        if (finished && !data.demo) {
            if (typeof loadLibraryStats === 'function') loadLibraryStats(false);
            if (typeof runLibraryHealthCheck === 'function') runLibraryHealthCheck({force: true, silent: true, skipProgress: true});
        }
    }

    async function healthMetadataRequest(action, body) {
        const localReview = typeof window !== 'undefined' && window.location
            && ['127.0.0.1', 'localhost', '::1'].includes(window.location.hostname)
            && new URLSearchParams(window.location.search).get('review') === 'health';
        if (localReview) {
            if (action === 'history') return {success: true, jobs: healthMetadataReviewState ? [{...healthMetadataReviewState, created: Date.now() / 1000}] : []};
            if (action === 'preview') healthMetadataReviewState = {success: true, demo: true, id: 'local-demo', state: 'ready', total: 24, progress: 24, summary: {needs_update: 6, already_complete: 18}, exception_files: 0};
            if (action === 'apply') healthMetadataReviewState = {...healthMetadataReviewState, state: 'complete', summary: {published: 5, already_complete: 18, exception: 1}, exception_files: 1, rollback_available: true};
            if (action === 'rollback') healthMetadataReviewState = {...healthMetadataReviewState, state: 'rolled_back', summary: {rolled_back: 5, already_complete: 18, exception: 1}, rollback_available: false};
            return healthMetadataReviewState || {success: true, demo: true, state: 'idle', total: 0, summary: {}};
        }
        const response = await fetch(`/api/library/health_publish/${action}`, body ? {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)
        } : undefined);
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'The batch request failed.');
        return data;
    }

    async function showHealthMetadataHistory() {
        window.AxiomHealthCockpit?.open('refresh', {scroll: true});
        try {
            const data = await healthMetadataRequest('history');
            const select = document.getElementById('health-batch-history');
            select.replaceChildren();
            for (const job of data.jobs || []) {
                const option = document.createElement('option');
                option.value = job.id;
                option.textContent = `${new Date(job.created * 1000).toLocaleString()} · ${job.total.toLocaleString()} files · ${job.state.replaceAll('_', ' ')}`;
                select.appendChild(option);
            }
            select.classList.toggle('hidden', !data.jobs?.length);
            healthMetadataBatch = {id: data.jobs?.[0]?.id};
            await pollHealthMetadataBatch();
        } catch (error) { showToast(error.message, true); }
    }

    async function pollHealthMetadataBatch() {
        clearTimeout(healthMetadataBatchTimer);
        try {
            const data = await healthMetadataRequest(`status${healthMetadataBatch.id ? `?job_id=${encodeURIComponent(healthMetadataBatch.id)}` : ''}`);
            renderHealthMetadataBatch(data);
            if (data.state === 'ready' && healthMetadataAwaitingConfirmation) {
                healthMetadataAwaitingConfirmation = false;
                const needs = Number(data.summary?.needs_update || 0);
                if (!needs) { renderHealthMetadataBatch(data); return; }
                const confirmed = await showAxiomConfirm('Update missing BPM, Key & Year',
                    `${needs.toLocaleString()} tracks have missing information. Quit Serato and djay first. AXIOM will back up every track it changes, then fill the gaps across the whole batch. Existing BPM, key and year stay as they are. Edits and mashups use the original leading song’s year when the match is clear. Anything uncertain stays unchanged and is listed in your results. Your audio stays unchanged, and you can undo the batch. Refresh your DJ software afterward; keys still need a separate scan in djay.`,
                    'Update Full Batch', 'primary');
                if (!confirmed) { renderHealthMetadataBatch(data); return; }
                const started = await healthMetadataRequest('apply', {job_id: data.id, confirmation: 'UPDATE MISSING BPM KEY YEAR'});
                renderHealthMetadataBatch(started);
                healthMetadataBatchTimer = setTimeout(pollHealthMetadataBatch, 1200);
            } else if (['previewing', 'planning', 'backing_up', 'publishing', 'rolling_back'].includes(data.state)) {
                healthMetadataBatchTimer = setTimeout(pollHealthMetadataBatch, 1200);
            }
        } catch (error) {
            showToast(error.message, true);
            if (healthMetadataBatch.id && ['previewing', 'planning', 'backing_up', 'publishing', 'rolling_back'].includes(healthMetadataBatch.state)) {
                // Losing the status connection must not offer a second batch
                // while the original continues on the server.
                healthMetadataBatchTimer = setTimeout(pollHealthMetadataBatch, 5000);
                return;
            }
            healthMetadataAwaitingConfirmation = false;
            const button = document.getElementById('health-batch-start');
            if (button) button.disabled = false;
        }
    }

    async function startHealthMetadataBatch(button) {
        if (!syncHealthMetadataPublishGate(false)) {
            if (typeof showToast === 'function') showToast('Run Scan Health first. Publishing unlocks after Health saves results.', true);
            return;
        }
        if (button) button.disabled = true;
        try {
            const data = await healthMetadataRequest('preview', {});
            healthMetadataAwaitingConfirmation = true;
            renderHealthMetadataBatch(data);
            await pollHealthMetadataBatch();
        } catch (error) {
            healthMetadataAwaitingConfirmation = false;
            if (button) button.disabled = false;
            showToast(error.message, true);
        }
    }

    async function rollbackHealthMetadataBatch() {
        const jobId = healthMetadataBatch.id;
        if (!jobId || !await showAxiomConfirm('Roll back the full batch', 'Undo AXIOM’s BPM, key and year updates using verified backups. Unchanged files are restored exactly. Newer cues and other tags are kept. Changed audio or edits to the published fields are left untouched and reported as exceptions. Quit Serato and djay first.', 'Restore Full Batch', 'primary')) return;
        try {
            renderHealthMetadataBatch(await healthMetadataRequest('rollback', {job_id: jobId, confirmation: 'ROLL BACK FULL BATCH'}));
            await pollHealthMetadataBatch();
        } catch (error) { showToast(error.message, true); }
    }

    // Health Year publishing review and read-only Serato metadata imports.
    let yearPublishPollTimer = null;
    let latestYearPublishState = {};

    function closeYearPublishPanel() {
        document.getElementById('year-publish-panel')?.classList.add('hidden');
        if (yearPublishPollTimer) clearTimeout(yearPublishPollTimer);
        yearPublishPollTimer = null;
    }

    function setYearPublishCount(id, value) {
        const node = document.getElementById(id);
        if (node) node.textContent = Number(value || 0).toLocaleString();
    }

    function formatYearPublishCount(value) {
        return Number(value || 0).toLocaleString();
    }

    function yearPublishStatusLabel(status) {
        const labels = {
            publish_ready: 'Ready',
            conflict: 'Conflict',
            already_current: 'Already Set',
            estimated: 'Estimated Only',
            unsupported_format: 'Protected Format',
            missing_file: 'Missing File',
            read_only: 'Read Only',
            error: 'Error',
            unverified_source: 'Unverified',
            no_verified_year: 'No Verified Year',
            published: 'Published',
            failed: 'Skipped',
            rollback_ready: 'Rollback Ready',
            rolled_back: 'Rolled Back'
        };
        return labels[status] || String(status || 'Checked').replace(/_/g, ' ');
    }

    function yearPublishTone(status) {
        const value = String(status || '');
        if (['publish_ready', 'published', 'rolled_back'].includes(value)) return 'ready';
        if (['conflict'].includes(value)) return 'conflict';
        if (['unsupported_format', 'estimated'].includes(value)) return 'blocked';
        if (['missing_file', 'read_only', 'error', 'unverified_source', 'no_verified_year', 'failed'].includes(value)) return 'unavailable';
        return '';
    }

    function yearPublishActionButton(label, onclick, enabled, extraClass = '') {
        return `<button class="year-publish-card-action ${extraClass}" onclick="${onclick}" type="button" ${enabled ? '' : 'disabled'}>${escapeHtml(label)}</button>`;
    }

    function renderYearPublishResolution(data, counts) {
        const container = document.getElementById('year-publish-resolution');
        if (!container) return;
        const status = String(data.status || 'idle');
        const busy = ['previewing', 'publishing', 'rolling_back'].includes(status);
        const readyToAct = status === 'ready' && !busy;
        const ready = Number(counts.ready || 0);
        const conflicts = Number(counts.conflicts || 0);
        const already = Number(counts.already || 0);
        const estimated = Number(counts.estimated || 0);
        const blocked = Number(counts.blocked || 0);
        const unavailable = Number(counts.unavailable || 0);

        const cards = [
            {
                tone: 'ready',
                count: ready,
                title: 'Missing year tags',
                copy: ready
                    ? `${formatYearPublishCount(ready)} supported files have a verified AXIOM year and an empty standard year tag.`
                    : 'No supported blank year tags are ready to publish right now.',
                next: 'Writes only the release-year field and stores rollback receipts.',
                action: yearPublishActionButton(ready ? `Resolve ${formatYearPublishCount(ready)}` : 'Nothing Ready', 'confirmYearPublish(false, this)', readyToAct && ready > 0, 'primary')
            },
            {
                tone: 'conflict',
                count: conflicts,
                title: 'Existing tag conflicts',
                copy: conflicts
                    ? `${formatYearPublishCount(conflicts)} files already have a different year in the file tag.`
                    : 'No file tag conflicts were found in this preview.',
                next: 'Only use this when AXIOM verified year should replace the current file year.',
                action: yearPublishActionButton(conflicts ? `Resolve ${formatYearPublishCount(conflicts)} Conflicts` : 'No Conflicts', 'confirmYearPublish(true, this)', readyToAct && conflicts > 0, 'conflict')
            },
            {
                tone: 'ready',
                count: already,
                title: 'Already fixed',
                copy: already
                    ? `${formatYearPublishCount(already)} file tags already match AXIOM. There is nothing more to write.`
                    : 'No already-matching file tags were reported yet.',
                next: 'If Serato still looks blank, select the tracks there and choose Re-scan File Info.',
                action: yearPublishActionButton('Open Year Scan', "startUnifiedHealthScan('missing_year', this)", !busy, '')
            },
            {
                tone: 'blocked',
                count: estimated,
                title: 'Estimated AXIOM years',
                copy: estimated
                    ? `${formatYearPublishCount(estimated)} years are useful inside AXIOM but not verified enough for file tags.`
                    : 'No estimated-only years were found.',
                next: 'Run Scan Years to try to promote estimates into verified Health data.',
                action: yearPublishActionButton(estimated ? 'Scan Years' : 'Scan Years Anyway', "startUnifiedHealthScan('missing_year', this)", !busy, '')
            },
            {
                tone: 'blocked',
                count: blocked,
                title: 'Protected formats',
                copy: blocked
                    ? `${formatYearPublishCount(blocked)} WAV, AIFF, AAC or unsupported files stay protected from tag writes.`
                    : 'No blocked-format tracks were found in this preview.',
                next: 'Use a Serato handoff/report or create supported copies if those files need DJ-software visibility.',
                action: yearPublishActionButton(blocked ? 'Create Serato Handoff' : 'No Handoff Needed', 'exportYearFixesToSerato(this, true)', !busy && blocked > 0, '')
            },
            {
                tone: 'unavailable',
                count: unavailable,
                title: 'Needs Health repair',
                copy: unavailable
                    ? `${formatYearPublishCount(unavailable)} rows need a drive reconnect, verified year, permission fix, or source repair before publishing.`
                    : 'No missing, read-only, unverified, or unavailable rows were found.',
                next: 'Reconnect drives, run Scan Years, then refresh this preview.',
                action: yearPublishActionButton(unavailable ? 'Repair Years' : 'Refresh Preview', unavailable ? "startUnifiedHealthScan('missing_year', this)" : 'startYearPublishPreview(this)', !busy, '')
            }
        ];

        container.innerHTML = cards.map(card => `
            <article class="year-publish-resolve-card ${card.tone}">
                <b>${formatYearPublishCount(card.count)}</b>
                <strong>${escapeHtml(card.title)}</strong>
                <p>${escapeHtml(card.copy)}</p>
                <small>${escapeHtml(card.next)}</small>
                ${card.action}
            </article>
        `).join('');
    }

    function renderYearPublishSamples(data = {}) {
        const container = document.getElementById('year-publish-samples');
        if (!container) return;
        const rows = (Array.isArray(data.results) && data.results.length)
            ? data.results
            : (Array.isArray(data.samples) ? data.samples : []);
        if (!rows.length) {
            container.innerHTML = `
                <div class="year-publish-samples-head">
                    <span>Preview examples</span>
                    <span>Run preview to see examples for each repair category</span>
                </div>
            `;
            return;
        }
        const visibleRows = rows.slice(0, 14);
        container.innerHTML = `
            <div class="year-publish-samples-head">
                <span>Preview examples</span>
                <span>Showing ${formatYearPublishCount(visibleRows.length)} of ${formatYearPublishCount(rows.length)} returned examples</span>
            </div>
            ${visibleRows.map(row => {
                const status = String(row.status || row.result || '');
                const tone = yearPublishTone(status);
                const title = row.title || (row.path ? String(row.path).split('/').pop() : '') || 'Unknown Track';
                const artist = row.artist || 'Unknown Artist';
                const year = row.year || row.published_year || row.target_year || '';
                const currentYear = row.current_year || row.previous_year || '';
                const extension = row.extension || (row.path ? String(row.path).split('.').pop() : '');
                const reason = row.reason || row.error || 'Checked by Year Publish.';
                const yearLine = currentYear && year
                    ? `File ${currentYear} -> AXIOM ${year}`
                    : year
                        ? `AXIOM ${year}`
                        : currentYear
                            ? `File ${currentYear}`
                            : extension
                                ? String(extension).toUpperCase()
                                : 'No year value';
                return `
                    <div class="year-publish-sample-row">
                        <div class="year-publish-sample-track">
                            <strong>${escapeHtml(title)}</strong>
                            <span>${escapeHtml(artist)}</span>
                        </div>
                        <span class="year-publish-sample-status ${tone}">${escapeHtml(yearPublishStatusLabel(status))}</span>
                        <div class="year-publish-sample-reason">
                            <strong>${escapeHtml(yearLine)}</strong>
                            <span>${escapeHtml(reason)}</span>
                        </div>
                    </div>
                `;
            }).join('')}
        `;
    }

    function renderYearPublishState(data = {}) {
        latestYearPublishState = { ...latestYearPublishState, ...data };
        data = latestYearPublishState;
        const panel = document.getElementById('year-publish-panel');
        if (!panel) return;
        panel.classList.remove('hidden');
        const status = String(data.status || 'idle');
        const busy = ['previewing', 'publishing', 'rolling_back'].includes(status);
        const preview = Object.keys(data.preview_summary || {}).length ? data.preview_summary : (data.summary || {});
        const outcome = data.summary || {};
        const ready = Number(preview.publish_ready || 0);
        const conflicts = Number(preview.conflict || 0);
        const unavailable = Number(preview.missing_file || 0)
          + Number(preview.read_only || 0)
          + Number(preview.error || 0)
          + Number(preview.unverified_source || 0)
          + Number(preview.no_verified_year || 0);
        const counts = {
            ready,
            conflicts,
            already: Number(preview.already_current || 0),
            estimated: Number(preview.estimated || 0),
            blocked: Number(preview.unsupported_format || 0),
            unavailable
        };
        panel.classList.toggle('is-busy', busy);
        panel.dataset.yearPublishStatus = status;
        setYearPublishCount('year-publish-ready', ready);
        setYearPublishCount('year-publish-conflicts', conflicts);
        setYearPublishCount('year-publish-current', preview.already_current);
        setYearPublishCount('year-publish-estimated', preview.estimated);
        setYearPublishCount('year-publish-blocked', preview.unsupported_format);
        setYearPublishCount('year-publish-unavailable', unavailable);

        const progress = Number(data.progress || 0);
        const total = Number(data.total || 0);
        const percent = total > 0 ? Math.min(100, Math.round((progress / total) * 100)) : (busy ? 3 : 0);
        const bar = document.getElementById('year-publish-progress-bar');
        if (bar) bar.style.width = `${percent}%`;

        const title = document.getElementById('year-publish-title');
        const copy = document.getElementById('year-publish-copy');
        const result = document.getElementById('year-publish-result');
        const safeButton = document.getElementById('year-publish-safe-button');
        const conflictButton = document.getElementById('year-publish-conflict-button');
        const rollbackButton = document.getElementById('year-publish-rollback-button');
        const refreshButton = document.getElementById('year-publish-refresh-button');

        const previewingCopy = total > 0
            ? `Reading ${progress.toLocaleString()} of ${total.toLocaleString()} library records. No files are changing.`
            : 'Preparing the safe preview now. No files are changing.';
        const publishingCopy = total > 0
            ? `Writing one standard year field at a time: ${progress.toLocaleString()} of ${total.toLocaleString()}.`
            : 'Starting the publish job and writing only the standard release-year field.';
        const rollbackCopy = total > 0
            ? `Restoring previous year fields: ${progress.toLocaleString()} of ${total.toLocaleString()}.`
            : 'Starting rollback from AXIOM receipts.';
        const statusText = {
            idle: ['Preview Verified Years', 'AXIOM will inspect standard file tags only. Nothing changes until you review, choose the category, and confirm.'],
            previewing: ['Checking Standard Year Tags', previewingCopy],
            ready: ['Verified Year Fixes Ready', 'Use the cards below to resolve missing tags, approve conflicts separately, repair unavailable rows, or hand protected formats to Serato.'],
            publishing: ['Publishing Verified Years', publishingCopy],
            complete: ['Year Publish Complete', 'Verified years are now in standard file metadata. AXIOM did not edit Serato or djay databases.'],
            partial: ['Year Publish Completed With Skips', 'Safe writes completed; files that changed, failed verification or became unavailable were left untouched.'],
            rolling_back: ['Rolling Back Year Publish', rollbackCopy],
            rolled_back: ['Year Publish Rolled Back', 'The previous standard year fields were restored from AXIOM receipts.'],
            rollback_partial: ['Rollback Completed With Skips', 'Files changed since publishing were protected and left untouched.'],
            error: ['Year Publish Paused', data.error || 'AXIOM stopped before it could safely complete this job.']
        }[status] || ['Year Tag Publisher', 'Review verified release-year tags before publishing.'];
        if (title) title.textContent = statusText[0];
        if (copy) copy.textContent = statusText[1];
        if (copy && data.scope === 'reviewed_batch') copy.textContent += ' Scope: the reviewed research batch only.';

        if (safeButton) {
            safeButton.disabled = status !== 'ready' || ready < 1;
            safeButton.textContent = ready ? `Resolve ${ready.toLocaleString()} Missing Tags` : 'No Missing Tags Ready';
        }
        if (conflictButton) {
            conflictButton.disabled = status !== 'ready' || conflicts < 1;
            conflictButton.textContent = conflicts
              ? `Resolve ${conflicts.toLocaleString()} Conflicts Too`
              : 'No Conflicts';
        }
        if (rollbackButton) rollbackButton.disabled = busy || !(data.rollback_available || data.recovery_available);
        if (refreshButton) refreshButton.disabled = busy;
        renderYearPublishResolution(data, counts);
        renderYearPublishSamples(data);

        if (result) {
            if (status === 'ready') {
                result.innerHTML = `<strong>${ready.toLocaleString()} can be resolved now.</strong> Conflicts need the separate approval button because they replace an existing file year. Estimated years, protected formats, and unavailable rows stay safe until you repair or hand them off.`;
            } else if (['complete', 'partial'].includes(status)) {
                result.innerHTML = `<strong>${Number(outcome.published || 0).toLocaleString()} published - ${Number(outcome.failed || 0).toLocaleString()} skipped.</strong> In Serato, select these tracks and choose <strong>Re-scan File Info</strong>. For djay Pro local files, refresh or re-add the files; AXIOM has not edited djay's database.`;
            } else if (['rolled_back', 'rollback_partial'].includes(status)) {
                result.innerHTML = `<strong>${Number(outcome.rolled_back || 0).toLocaleString()} restored - ${Number(outcome.failed || 0).toLocaleString()} protected.</strong> Re-scan file info in the DJ software to display the restored year.`;
            } else if (busy) {
                result.textContent = total > 0
                    ? `${progress.toLocaleString()} of ${total.toLocaleString()} checked. Keep AXIOM open until this finishes.`
                    : 'AXIOM accepted the job and is preparing the safe worker. Keep AXIOM open.';
            } else if (status === 'error') {
                result.textContent = data.error || 'Year Publish stopped safely.';
            }
        }
    }

    async function pollYearPublishStatus() {
        if (yearPublishPollTimer) clearTimeout(yearPublishPollTimer);
        yearPublishPollTimer = null;
        try {
            const response = await fetch('/api/library/year_publish/status', { cache: 'no-store' });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.success !== true || !['idle', 'previewing', 'ready', 'publishing', 'complete', 'partial', 'rolling_back', 'rolled_back', 'rollback_partial', 'error'].includes(data.status)) {
                throw new Error(data.error || 'Year Publish status unavailable');
            }
            pollYearPublishStatus.working = ['previewing', 'publishing', 'rolling_back'].includes(data.status);
            pollYearPublishStatus.reconnecting = false;
            renderYearPublishState(data);
            if (['previewing', 'publishing', 'rolling_back'].includes(data.status)) {
                yearPublishPollTimer = setTimeout(pollYearPublishStatus, 650);
            }
            return data;
        } catch (error) {
            const message = 'Connection lost. Checking the existing Year Publish job; no changes will be submitted again.';
            const status = document.getElementById('year-publish-result');
            if (status) status.textContent = message;
            if (!pollYearPublishStatus.reconnecting) showToast(message, true);
            pollYearPublishStatus.reconnecting = true;
            yearPublishPollTimer = setTimeout(pollYearPublishStatus, 5000);
            return null;
        }
    }

    async function startYearPublishPreview(triggerBtn = null, selectedPaths = null) {
        if (pollYearPublishStatus.reconnecting || pollYearPublishStatus.working) return pollYearPublishStatus();
        setHealthWorkspaceGroupActive('era');
        const startBtn = triggerBtn || document.getElementById('btn-year-publish') || document.getElementById('year-publish-refresh-button');
        if (startBtn?.id === 'year-publish-refresh-button' && selectedPaths === null) {
            selectedPaths = latestYearPublishState.selected_paths || null;
        }
        if (selectedPaths !== null && (!Array.isArray(selectedPaths) || !selectedPaths.length)) {
            showToast('No reviewed tracks are selected. No publish preview was started.', true);
            return;
        }
        setAxiomButtonBusy(startBtn, true, 'Previewing...');
        if (!(await ensureAxiomLicenseUsable('Year Publish'))) {
            setAxiomButtonBusy(startBtn, false);
            return;
        }
        document.getElementById('year-publish-panel')?.classList.remove('hidden');
        document.getElementById('year-publish-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        renderYearPublishState({
            ...latestYearPublishState,
            status: 'previewing',
            progress: 0,
            total: Number(latestYearPublishState.total || 0)
        });
        pollYearPublishStatus.working = true;
        try {
            const response = await fetch('/api/library/year_publish/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(selectedPaths === null ? {} : {paths: selectedPaths})
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.success !== true || typeof data.status !== 'string') {
                const error = new Error(data.error || 'Year Publish preview failed');
                error.requestRejected = response.status >= 400 && response.status < 500 && data.success === false;
                throw error;
            }
            pollYearPublishStatus.working = ['previewing', 'publishing', 'rolling_back'].includes(data.status);
            renderYearPublishState(data);
            pollYearPublishStatus();
        } catch (err) {
            showToast(err.requestRejected ? err.message : 'Response lost. Checking the existing job before reporting an outcome.', true);
            await pollYearPublishStatus();
        } finally {
            setAxiomButtonBusy(startBtn, false);
        }
    }

    async function confirmYearPublish(includeConflicts = false, triggerBtn = null) {
        if (pollYearPublishStatus.reconnecting || pollYearPublishStatus.working) return pollYearPublishStatus();
        const actionBtn = triggerBtn || (includeConflicts ? document.getElementById('year-publish-conflict-button') : document.getElementById('year-publish-safe-button'));
        setAxiomButtonBusy(actionBtn, true, 'Confirming...');
        const typed = await showAxiomTextPrompt({
            kicker: 'External Metadata Change',
            title: includeConflicts ? 'Publish Years And Replace Conflicts' : 'Publish Missing Year Tags',
            copy: `${includeConflicts ? 'This includes verified AXIOM years that differ from existing file tags. ' : ''}Fully quit Serato DJ Pro and djay Pro first. AXIOM changes only the standard release-year field and records a rollback receipt. Type PUBLISH VERIFIED YEARS to continue.`,
            defaultValue: '',
            placeholder: 'PUBLISH VERIFIED YEARS',
            confirmText: 'Publish Years'
        });
        if (!typed) {
            setAxiomButtonBusy(actionBtn, false);
            return;
        }
        if (typed !== 'PUBLISH VERIFIED YEARS') {
            showToast('Confirmation did not match. No metadata changed.', true);
            setAxiomButtonBusy(actionBtn, false);
            return;
        }
        const pendingPreview = latestYearPublishState.preview_summary || latestYearPublishState.summary || {};
        const pendingTotal = Number(pendingPreview.publish_ready || 0) + (includeConflicts ? Number(pendingPreview.conflict || 0) : 0);
        renderYearPublishState({
            ...latestYearPublishState,
            status: 'publishing',
            progress: 0,
            total: pendingTotal
        });
        pollYearPublishStatus.working = true;
        try {
            const response = await fetch('/api/library/year_publish/apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirmation: typed, include_conflicts: includeConflicts })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.success !== true || typeof data.status !== 'string') {
                const error = new Error(data.error || 'Year Publish failed');
                error.requestRejected = response.status >= 400 && response.status < 500 && data.success === false;
                throw error;
            }
            pollYearPublishStatus.working = ['previewing', 'publishing', 'rolling_back'].includes(data.status);
            renderYearPublishState(data);
            pollYearPublishStatus();
        } catch (err) {
            showToast(err.requestRejected ? err.message : 'Response lost. Checking the existing job before reporting an outcome.', true);
            await pollYearPublishStatus();
        } finally {
            setAxiomButtonBusy(actionBtn, false);
        }
    }

    async function confirmYearPublishRollback(triggerBtn = null) {
        if (pollYearPublishStatus.reconnecting || pollYearPublishStatus.working) return pollYearPublishStatus();
        const rollbackBtn = triggerBtn || document.getElementById('year-publish-rollback-button');
        setAxiomButtonBusy(rollbackBtn, true, 'Rolling Back...');
        const typed = await showAxiomTextPrompt({
            kicker: 'Metadata Rollback',
            title: 'Restore Previous Year Tags',
            copy: 'Fully quit Serato DJ Pro and djay Pro first. AXIOM will restore the previous standard year fields from the latest publish receipt. Type ROLL BACK YEAR PUBLISH to continue.',
            defaultValue: '',
            placeholder: 'ROLL BACK YEAR PUBLISH',
            confirmText: 'Roll Back'
        });
        if (!typed) {
            setAxiomButtonBusy(rollbackBtn, false);
            return;
        }
        if (typed !== 'ROLL BACK YEAR PUBLISH') {
            showToast('Confirmation did not match. No metadata changed.', true);
            setAxiomButtonBusy(rollbackBtn, false);
            return;
        }
        renderYearPublishState({
            ...latestYearPublishState,
            status: 'rolling_back',
            progress: 0,
            total: Number(latestYearPublishState.total || 0)
        });
        pollYearPublishStatus.working = true;
        try {
            const response = await fetch('/api/library/year_publish/rollback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirmation: typed })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.success !== true || typeof data.status !== 'string') {
                const error = new Error(data.error || 'Year Publish rollback failed');
                error.requestRejected = response.status >= 400 && response.status < 500 && data.success === false;
                throw error;
            }
            pollYearPublishStatus.working = ['previewing', 'publishing', 'rolling_back'].includes(data.status);
            renderYearPublishState(data);
            pollYearPublishStatus();
        } catch (err) {
            showToast(err.requestRejected ? err.message : 'Response lost. Checking the existing job before reporting an outcome.', true);
            await pollYearPublishStatus();
        } finally {
            setAxiomButtonBusy(rollbackBtn, false);
        }
    }

    async function exportYearFixesToSerato(triggerBtn = null, includeAllYearReady = false) {
        if (!(await ensureAxiomLicenseUsable('Serato year handoff'))) return;
        const defaultName = includeAllYearReady ? 'AXIOM YEAR HEALTH HANDOFF' : 'AXIOM YEAR FIXES';
        const crateName = await showAxiomTextPrompt({
            kicker: 'Serato Handoff',
            title: 'Name Your Year-Fix Crate',
            copy: includeAllYearReady
                ? 'Fully quit Serato first. AXIOM will create a handoff/report for tracks with usable AXIOM years, including protected formats that cannot receive safe tag writes.'
                : 'Fully quit Serato first. AXIOM will place the year-ready tracks in this crate, then reopen Serato safely.',
            defaultValue: defaultName,
            placeholder: 'Serato crate name...',
            confirmText: 'Add To Serato'
        });
        if (!crateName) return;
        const browserDelivery = await prepareAxiomBrowserSeratoDelivery();

        const btn = triggerBtn || document.getElementById('btn-export-years-serato');
        const originalText = btn ? btn.innerHTML : '';
        if (btn) btn.disabled = true;
        setAxiomButtonBusy(btn, true, 'Sending...');
        showToast('Creating and verifying your Serato playlist. Audio files and their tags stay unchanged.');

        try {
            const resp = await fetch('/api/library/export_year_fixes_serato', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: crateName, include_all_year_ready: includeAllYearReady })
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success !== true || data.delivery_verified !== true || !(Number(data.exported_tracks) > 0)) {
                throw new Error(data.error || data.message || 'Serato year handoff could not be verified. Check the destination before retrying.');
            }

            await deliverAxiomBrowserSeratoPlaylist(data, browserDelivery);
            downloadAxiomBrowserExportFiles(data);
            showToast(!data.browser_download
                ? `${data.serato_library_registered ? 'Serato playlist registered' : 'Serato crate file saved'} with ${Number(data.exported_tracks || 0).toLocaleString()} tracks. Years are in the CSV report; file tags are unchanged. ${data.serato_opened ? 'Serato opened automatically.' : 'Open Serato to check it.'}`
                : data.browser_root_written
                    ? `Year playlist ready inside ${data.browser_root_delivery?.folder_name || 'your music folder'} for Serato import.`
                    : `Year playlist downloaded for ${data.exported_tracks || 0} tracks. Move the MUSIC_FOLDER_ROOT M3U8 before importing it.`);
            showSeratoExportSuccess(data, crateName);
        } catch (err) {
            showToast(err.message || 'Serato year handoff paused. Source audio remains protected.', true);
        } finally {
            setAxiomButtonBusy(btn, false);
            if (btn) {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }
    }

    function seratoYearImportStatusLabel(status) {
        const labels = {
            ready_to_update: 'Ready',
            updated: 'Updated',
            already_correct: 'Already OK',
            conflict_existing_year: 'Conflict',
            no_match: 'No Match',
            ambiguous_match: 'Review',
            duplicate_match: 'Duplicate',
            skipped_no_year: 'No Year'
        };
        return labels[status] || status || 'Checked';
    }

    function showSeratoYearImportReview(data, applied = false) {
        const container = document.getElementById('health-progress-container');
        const review = document.getElementById('health-repair-review');
        const label = document.getElementById('health-progress-label');
        const bar = document.getElementById('health-progress-bar');
        const pct = document.getElementById('health-progress-percent');
        if (!container || !review) return;

        const summary = data.summary || {};
        const ready = Number(summary.ready_to_update || 0);
        const updated = Number(summary.updated || 0);
        const matched = ready + Number(summary.already_correct || 0) + Number(summary.conflict_existing_year || 0) + updated;
        const noMatch = Number(summary.no_match || 0) + Number(summary.ambiguous_match || 0);
        const noYear = Number(summary.no_year || 0);
        const rows = Array.isArray(data.preview_rows) ? data.preview_rows : [];
        const actionCopy = applied
            ? `Imported ${updated.toLocaleString()} Serato year${updated === 1 ? '' : 's'} into AXIOM.`
            : `${ready.toLocaleString()} AXIOM track${ready === 1 ? '' : 's'} can receive Serato years.`;

        if (label) label.innerText = applied ? 'Serato year import applied.' : 'Serato year import preview ready.';
        if (bar) bar.style.width = '100%';
        if (pct) pct.innerText = '100%';

        const rowHtml = rows.length
            ? rows.map(row => {
                const status = escapeHtml(seratoYearImportStatusLabel(row.status));
                const title = escapeHtml(row.title || 'Unknown Track');
                const artist = escapeHtml(row.artist || '');
                const message = escapeHtml(row.message || '');
                const year = escapeHtml(row.serato_year || '');
                const axiomYear = escapeHtml(row.axiom_year || '');
                return `
                    <div class="health-repair-row">
                        <div class="health-repair-row-main">
                            <strong>${title}</strong>
                            <span>${artist || 'Unknown Artist'}</span>
                            <small>${message}</small>
                        </div>
                        <div class="health-repair-row-result">
                            <b>${year || '-'}</b>
                            <small>${axiomYear ? `AXIOM ${axiomYear}` : status}</small>
                        </div>
                    </div>
                `;
            }).join('')
            : `<div class="text-center py-6 text-white/50 text-[10px] font-black uppercase">No preview rows returned.</div>`;

        review.innerHTML = `
            <div class="health-repair-head">
                <div>
                    <div class="health-repair-kicker">Serato Year Scan</div>
                    <div class="health-repair-title">${escapeHtml(actionCopy)}</div>
                    <div class="health-repair-subtitle">Matched ${matched.toLocaleString()} rows. ${noMatch.toLocaleString()} did not match AXIOM. ${noYear.toLocaleString()} rows had no usable year. Source audio and Serato database untouched.</div>
                </div>
                <div class="health-repair-actions">
                    <button type="button" onclick="hideHealthRepairReview()">Close</button>
                </div>
            </div>
            <div class="health-repair-list">${rowHtml}</div>
        `;
        container.classList.remove('hidden');
        review.classList.remove('hidden');
    }

    function seratoBpmImportStatusLabel(status) {
        const labels = {
            ready_to_update: 'Ready',
            updated: 'Updated',
            already_correct: 'Already OK',
            conflict_existing_bpm: 'Conflict',
            no_match: 'No Match',
            ambiguous_serato_match: 'Review'
        };
        return labels[status] || status || 'Checked';
    }

    function formatBpmValue(value) {
        const bpm = Number(value || 0);
        if (!Number.isFinite(bpm) || bpm <= 0) return '-';
        return bpm % 1 === 0 ? String(Math.round(bpm)) : bpm.toFixed(1);
    }

    function showSeratoBpmImportReview(data, applied = false) {
        const container = document.getElementById('health-progress-container');
        const review = document.getElementById('health-repair-review');
        const label = document.getElementById('health-progress-label');
        const bar = document.getElementById('health-progress-bar');
        const pct = document.getElementById('health-progress-percent');
        if (!container || !review) return;

        const summary = data.summary || {};
        const ready = Number(summary.ready_to_update || 0);
        const updated = Number(summary.updated || 0);
        const matched = ready + Number(summary.already_correct || 0) + Number(summary.conflict_existing_bpm || 0) + updated;
        const noMatch = Number(summary.no_match || 0) + Number(summary.ambiguous_serato_match || 0);
        const rows = Array.isArray(data.preview_rows) ? data.preview_rows : [];
        const actionCopy = applied
            ? `Imported ${updated.toLocaleString()} Serato BPM${updated === 1 ? '' : 's'} into AXIOM.`
            : `${ready.toLocaleString()} AXIOM BPM${ready === 1 ? '' : 's'} can be updated from Serato.`;

        if (label) label.innerText = applied ? 'Serato BPM import applied.' : 'Serato BPM import preview ready.';
        if (bar) bar.style.width = '100%';
        if (pct) pct.innerText = '100%';

        const rowHtml = rows.length
            ? rows.map(row => {
                const status = escapeHtml(seratoBpmImportStatusLabel(row.status));
                const title = escapeHtml(row.title || 'Unknown Track');
                const artist = escapeHtml(row.artist || '');
                const message = escapeHtml(row.message || '');
                const warning = escapeHtml(row.warning || '');
                const seratoBpm = escapeHtml(formatBpmValue(row.serato_bpm));
                const axiomBpm = escapeHtml(formatBpmValue(row.axiom_bpm));
                return `
                    <div class="health-repair-row">
                        <div class="health-repair-row-main">
                            <strong>${title}</strong>
                            <span>${artist || 'Unknown Artist'}</span>
                            <small>${message}${warning ? ` ${warning}` : ''}</small>
                        </div>
                        <div class="health-repair-row-result">
                            <b>${seratoBpm}</b>
                            <small>${axiomBpm !== '-' ? `AXIOM ${axiomBpm}` : status}</small>
                        </div>
                    </div>
                `;
            }).join('')
            : `<div class="text-center py-6 text-white/50 text-[10px] font-black uppercase">No preview rows returned.</div>`;

        review.innerHTML = `
            <div class="health-repair-head">
                <div>
                    <div class="health-repair-kicker">Serato BPM Scan</div>
                    <div class="health-repair-title">${escapeHtml(actionCopy)}</div>
                    <div class="health-repair-subtitle">Matched ${matched.toLocaleString()} rows. ${noMatch.toLocaleString()} did not match AXIOM. Source audio and Serato database untouched.</div>
                </div>
                <div class="health-repair-actions">
                    <button type="button" onclick="hideHealthRepairReview()">Close</button>
                </div>
            </div>
            <div class="health-repair-list">${rowHtml}</div>
        `;
        container.classList.remove('hidden');
        review.classList.remove('hidden');
    }

    async function callAutoSeratoBpmPull(apply = false) {
        const resp = await fetch('/api/library/pull_serato_bpms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                apply,
                overwrite_existing: true,
                bpm_tolerance: 0.5,
                limit: 10000
            })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.success === false) {
            throw new Error(data.error || data.message || 'Pull BPMs from Serato failed');
        }
        return data;
    }

    async function pullBpmsFromSeratoToAxiom() {
        if (!(await ensureAxiomLicenseUsable('Pull BPMs from Serato'))) return;
        if (window.AXIOM_WEB_PREVIEW) {
            promptSeratoMetadataCSV('bpm');
            return;
        }

        const btn = document.getElementById('btn-import-serato-bpms');
        const originalText = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span>Scanning...</span>';
        }

        const progContainer = document.getElementById('health-progress-container');
        const progBar = document.getElementById('health-progress-bar');
        const progPercent = document.getElementById('health-progress-percent');
        const progLabel = document.getElementById('health-progress-label');
        progContainer?.classList.remove('hidden');
        hideHealthRepairReview();
        if (progBar) progBar.style.width = '25%';
        if (progPercent) progPercent.innerText = '25%';
        if (progLabel) progLabel.innerText = 'Reading trusted Serato BPMs...';
        showToast('Reading Serato BPMs. Source audio and Serato stay untouched.');

        try {
            const preview = await callAutoSeratoBpmPull(false);
            showSeratoBpmImportReview(preview, false);
            const ready = Number(preview.summary?.ready_to_update || 0);
            const seratoMatches = Number(preview.summary?.serato_matches || 0);
            if (preview.warning) showToast(preview.warning, true);
            if (ready <= 0) {
                showToast(`Scan finished. Serato BPM matches: ${seratoMatches.toLocaleString()}. No AXIOM BPMs need updating.`, true);
                return;
            }

            const confirmed = await showAxiomConfirm(
                'Pull BPMs From Serato',
                `AXIOM found ${ready.toLocaleString()} BPM${ready === 1 ? '' : 's'} that can be updated from Serato. Apply to AXIOM cache now? Source audio and Serato database stay untouched.`,
                'APPLY BPMs',
                'primary'
            );
            if (!confirmed) return;

            if (btn) btn.innerHTML = '<span>Importing...</span>';
            if (progBar) progBar.style.width = '74%';
            if (progPercent) progPercent.innerText = '74%';
            if (progLabel) progLabel.innerText = 'Updating AXIOM BPM cache only...';

            const applied = await callAutoSeratoBpmPull(true);
            showSeratoBpmImportReview(applied, true);
            showToast(applied.message || 'BPMs imported into AXIOM. Source audio untouched. Serato database untouched.');
            loadLibraryStats();
            setTimeout(runLibraryHealthCheck, 600);
        } catch (err) {
            if (progBar) progBar.style.width = '100%';
            if (progPercent) progPercent.innerText = '100%';
            if (progLabel) progLabel.innerText = err.message || 'Pull BPMs from Serato paused.';
            showToast(err.message || 'Pull BPMs from Serato paused. Nothing was changed.', true);
        } finally {
            if (btn) {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }
    }

    function seratoKeyImportStatusLabel(status) {
        const labels = {
            ready_to_update: 'Ready',
            updated: 'Updated',
            already_correct: 'Already OK',
            conflict_existing_key: 'Conflict',
            no_match: 'No Match',
            ambiguous_serato_match: 'Review'
        };
        return labels[status] || status || 'Checked';
    }

    function showSeratoKeyImportReview(data, applied = false) {
        const container = document.getElementById('health-progress-container');
        const review = document.getElementById('health-repair-review');
        const label = document.getElementById('health-progress-label');
        const bar = document.getElementById('health-progress-bar');
        const pct = document.getElementById('health-progress-percent');
        if (!container || !review) return;

        const summary = data.summary || {};
        const ready = Number(summary.ready_to_update || 0);
        const updated = Number(summary.updated || 0);
        const matched = ready + Number(summary.already_correct || 0) + Number(summary.conflict_existing_key || 0) + updated;
        const noMatch = Number(summary.no_match || 0) + Number(summary.ambiguous_serato_match || 0);
        const rows = Array.isArray(data.preview_rows) ? data.preview_rows : [];
        const actionCopy = applied
            ? `Imported ${updated.toLocaleString()} Serato key${updated === 1 ? '' : 's'} into AXIOM.`
            : `${ready.toLocaleString()} AXIOM key${ready === 1 ? '' : 's'} can be updated from Serato.`;

        if (label) label.innerText = applied ? 'Serato key import applied.' : 'Serato key import preview ready.';
        if (bar) bar.style.width = '100%';
        if (pct) pct.innerText = '100%';

        const rowHtml = rows.length
            ? rows.map(row => {
                const status = escapeHtml(seratoKeyImportStatusLabel(row.status));
                const title = escapeHtml(row.title || 'Unknown Track');
                const artist = escapeHtml(row.artist || '');
                const message = escapeHtml(row.message || '');
                const seratoKey = escapeHtml(row.serato_key || '-');
                const axiomKey = escapeHtml(row.axiom_key || '');
                const rawKey = row.serato_raw_key && row.serato_raw_key !== row.serato_key
                    ? `Serato ${escapeHtml(row.serato_raw_key)}`
                    : '';
                return `
                    <div class="health-repair-row">
                        <div class="health-repair-row-main">
                            <strong>${title}</strong>
                            <span>${artist || 'Unknown Artist'}</span>
                            <small>${message}${rawKey ? ` ${rawKey}` : ''}</small>
                        </div>
                        <div class="health-repair-row-result">
                            <b>${seratoKey}</b>
                            <small>${axiomKey ? `AXIOM ${axiomKey}` : status}</small>
                        </div>
                    </div>
                `;
            }).join('')
            : `<div class="text-center py-6 text-white/50 text-[10px] font-black uppercase">No preview rows returned.</div>`;

        review.innerHTML = `
            <div class="health-repair-head">
                <div>
                    <div class="health-repair-kicker">Serato Key Scan</div>
                    <div class="health-repair-title">${escapeHtml(actionCopy)}</div>
                    <div class="health-repair-subtitle">Matched ${matched.toLocaleString()} rows. ${noMatch.toLocaleString()} did not match AXIOM. Source audio and Serato database untouched.</div>
                </div>
                <div class="health-repair-actions">
                    <button type="button" onclick="hideHealthRepairReview()">Close</button>
                </div>
            </div>
            <div class="health-repair-list">${rowHtml}</div>
        `;
        container.classList.remove('hidden');
        review.classList.remove('hidden');
    }

    async function callAutoSeratoKeyPull(apply = false) {
        const resp = await fetch('/api/library/pull_serato_keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                apply,
                overwrite_existing: true,
                limit: 10000
            })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.success === false) {
            throw new Error(data.error || data.message || 'Pull keys from Serato failed');
        }
        return data;
    }

    async function pullKeysFromSeratoToAxiom() {
        if (!(await ensureAxiomLicenseUsable('Pull keys from Serato'))) return;
        if (window.AXIOM_WEB_PREVIEW) {
            promptSeratoMetadataCSV('key');
            return;
        }

        const btn = document.getElementById('btn-import-serato-keys');
        const originalText = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span>Scanning...</span>';
        }

        const progContainer = document.getElementById('health-progress-container');
        const progBar = document.getElementById('health-progress-bar');
        const progPercent = document.getElementById('health-progress-percent');
        const progLabel = document.getElementById('health-progress-label');
        progContainer?.classList.remove('hidden');
        hideHealthRepairReview();
        if (progBar) progBar.style.width = '25%';
        if (progPercent) progPercent.innerText = '25%';
        if (progLabel) progLabel.innerText = 'Reading trusted Serato keys...';
        showToast('Reading Serato keys. Source audio and Serato stay untouched.');

        try {
            const preview = await callAutoSeratoKeyPull(false);
            showSeratoKeyImportReview(preview, false);
            const ready = Number(preview.summary?.ready_to_update || 0);
            const seratoMatches = Number(preview.summary?.serato_matches || 0);
            if (preview.warning) showToast(preview.warning, true);
            if (ready <= 0) {
                showToast(`Scan finished. Serato key matches: ${seratoMatches.toLocaleString()}. No AXIOM keys need updating.`, true);
                return;
            }

            const confirmed = await showAxiomConfirm(
                'Pull Keys From Serato',
                `AXIOM found ${ready.toLocaleString()} key${ready === 1 ? '' : 's'} that can be updated from Serato. Apply to AXIOM cache now? Source audio and Serato database stay untouched.`,
                'APPLY KEYS',
                'primary'
            );
            if (!confirmed) return;

            if (btn) btn.innerHTML = '<span>Importing...</span>';
            if (progBar) progBar.style.width = '74%';
            if (progPercent) progPercent.innerText = '74%';
            if (progLabel) progLabel.innerText = 'Updating AXIOM key cache only...';

            const applied = await callAutoSeratoKeyPull(true);
            showSeratoKeyImportReview(applied, true);
            showToast(applied.message || 'Keys imported into AXIOM. Source audio untouched. Serato database untouched.');
            loadLibraryStats();
            setTimeout(runLibraryHealthCheck, 600);
        } catch (err) {
            if (progBar) progBar.style.width = '100%';
            if (progPercent) progPercent.innerText = '100%';
            if (progLabel) progLabel.innerText = err.message || 'Pull keys from Serato paused.';
            showToast(err.message || 'Pull keys from Serato paused. Nothing was changed.', true);
        } finally {
            if (btn) {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }
    }

    async function callSeratoYearImport(csvPath, apply = false) {
        const resp = await fetch('/api/library/import_serato_years', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                csv_path: csvPath,
                apply,
                overwrite_existing: false
            })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.success === false) {
            throw new Error(data.error || data.message || 'Serato year scan failed');
        }
        return data;
    }

    async function callAutoSeratoYearPull(apply = false) {
        const resp = await fetch('/api/library/pull_serato_years', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                apply,
                include_tags: true,
                overwrite_existing: false,
                limit: 10000
            })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.success === false) {
            throw new Error(data.error || data.message || 'Pull years from Serato failed');
        }
        return data;
    }

    async function pullYearsFromSeratoToAxiom() {
        if (!(await ensureAxiomLicenseUsable('Pull years from Serato'))) return;
        if (window.AXIOM_WEB_PREVIEW) {
            promptSeratoMetadataCSV('year');
            return;
        }

        const btn = document.getElementById('btn-import-serato-years');
        const originalText = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span>Scanning...</span>';
        }

        const progContainer = document.getElementById('health-progress-container');
        const progBar = document.getElementById('health-progress-bar');
        const progPercent = document.getElementById('health-progress-percent');
        const progLabel = document.getElementById('health-progress-label');
        progContainer?.classList.remove('hidden');
        hideHealthRepairReview();
        if (progBar) progBar.style.width = '25%';
        if (progPercent) progPercent.innerText = '25%';
        if (progLabel) progLabel.innerText = 'Reading Serato years and music tags...';
        showToast('Reading Serato database and music tags. Source audio and Serato stay untouched.');

        try {
            const preview = await callAutoSeratoYearPull(false);
            showSeratoYearImportReview(preview, false);
            const ready = Number(preview.summary?.ready_to_update || 0);
            const seratoMatches = Number(preview.summary?.serato_matches || 0);
            const tagMatches = Number(preview.summary?.tag_matches || 0);
            if (preview.warning) showToast(preview.warning, true);
            if (ready <= 0) {
                showToast(`Scan finished. Serato matches: ${seratoMatches.toLocaleString()}. Tag matches: ${tagMatches.toLocaleString()}. No missing AXIOM years ready to import.`, true);
                return;
            }

            const confirmed = await showAxiomConfirm(
                'Pull Years From Serato',
                `AXIOM found ${ready.toLocaleString()} missing release year${ready === 1 ? '' : 's'} from Serato/music tags. Apply to AXIOM cache now? Source audio and Serato database stay untouched.`,
                'APPLY TO AXIOM',
                'primary'
            );
            if (!confirmed) return;

            if (btn) btn.innerHTML = '<span>Importing...</span>';
            if (progBar) progBar.style.width = '74%';
            if (progPercent) progPercent.innerText = '74%';
            if (progLabel) progLabel.innerText = 'Updating AXIOM cache only...';

            const applied = await callAutoSeratoYearPull(true);
            showSeratoYearImportReview(applied, true);
            showToast(applied.message || 'Years imported into AXIOM. Source audio untouched. Serato database untouched.');
            loadLibraryStats();
            setTimeout(runLibraryHealthCheck, 600);
        } catch (err) {
            if (progBar) progBar.style.width = '100%';
            if (progPercent) progPercent.innerText = '100%';
            if (progLabel) progLabel.innerText = err.message || 'Pull years from Serato paused.';
            showToast(err.message || 'Pull years from Serato paused. Nothing was changed.', true);
        } finally {
            if (btn) {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }
    }

    let lastSeratoYearImportPath = '';
    let lastSeratoYearImportReady = 0;

    function readSeratoYearImportPath() {
        return (document.getElementById('serato-year-csv-path')?.value || '').trim();
    }

    async function previewSeratoYearImportFromPanel() {
        if (!(await ensureAxiomLicenseUsable('Serato year import'))) return;
        if (window.AXIOM_WEB_PREVIEW) {
            showToast('Browser mode cannot read pasted Serato CSV paths. Use Upload CSV to choose the file directly.', true);
            return;
        }
        const csvPath = readSeratoYearImportPath();
        if (!csvPath || !csvPath.toLowerCase().includes('.csv')) {
            showToast('Paste a Serato CSV file path first.', true);
            return;
        }

        const btn = document.getElementById('btn-preview-serato-years');
        const applyBtn = document.getElementById('btn-apply-serato-years');
        const originalText = btn ? btn.innerHTML : '';
        if (applyBtn) applyBtn.classList.add('hidden');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = 'Scanning...';
        }

        const progContainer = document.getElementById('health-progress-container');
        const progBar = document.getElementById('health-progress-bar');
        const progPercent = document.getElementById('health-progress-percent');
        const progLabel = document.getElementById('health-progress-label');
        progContainer?.classList.remove('hidden');
        hideHealthRepairReview();
        if (progBar) progBar.style.width = '35%';
        if (progPercent) progPercent.innerText = '35%';
        if (progLabel) progLabel.innerText = 'Scanning Serato CSV for usable years...';
        showToast('Scanning Serato CSV. AXIOM is reading only.');

        try {
            const preview = await callSeratoYearImport(csvPath, false);
            lastSeratoYearImportPath = csvPath;
            lastSeratoYearImportReady = Number(preview.summary?.ready_to_update || 0);
            showSeratoYearImportReview(preview, false);
            if (lastSeratoYearImportReady > 0) {
                if (applyBtn) {
                    applyBtn.classList.remove('hidden');
                    applyBtn.textContent = `Apply ${lastSeratoYearImportReady.toLocaleString()}`;
                }
                showToast(`Preview ready: ${lastSeratoYearImportReady.toLocaleString()} AXIOM year${lastSeratoYearImportReady === 1 ? '' : 's'} can be imported.`);
            } else {
                showToast('Serato scan finished, but no AXIOM missing years were ready to import.', true);
            }
        } catch (err) {
            if (progBar) progBar.style.width = '100%';
            if (progPercent) progPercent.innerText = '100%';
            if (progLabel) progLabel.innerText = err.message || 'Serato year scan paused.';
            showToast(err.message || 'Serato year scan paused. Nothing was changed.', true);
        } finally {
            if (btn) {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }
    }

    async function applySeratoYearImportFromPanel() {
        if (!(await ensureAxiomLicenseUsable('Serato year import'))) return;
        const csvPath = lastSeratoYearImportPath || readSeratoYearImportPath();
        if (!csvPath || lastSeratoYearImportReady <= 0) {
            showToast('Preview Serato years before applying.', true);
            return;
        }

        const confirmed = await showAxiomConfirm(
            'Import Serato Years',
            `Import ${lastSeratoYearImportReady.toLocaleString()} missing release year${lastSeratoYearImportReady === 1 ? '' : 's'} from this Serato CSV into AXIOM? Source audio and Serato database stay untouched.`,
            'IMPORT YEARS',
            'primary'
        );
        if (!confirmed) return;

        const btn = document.getElementById('btn-apply-serato-years');
        const originalText = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = 'Importing...';
        }
        const progBar = document.getElementById('health-progress-bar');
        const progPercent = document.getElementById('health-progress-percent');
        const progLabel = document.getElementById('health-progress-label');
        if (progBar) progBar.style.width = '72%';
        if (progPercent) progPercent.innerText = '72%';
        if (progLabel) progLabel.innerText = 'Updating AXIOM year cache only...';

        try {
            const applied = await callSeratoYearImport(csvPath, true);
            showSeratoYearImportReview(applied, true);
            const updated = Number(applied.summary?.updated || 0);
            lastSeratoYearImportReady = 0;
            if (btn) btn.classList.add('hidden');
            showToast(applied.message || `Imported ${updated.toLocaleString()} Serato years into AXIOM. Source audio untouched.`);
            loadLibraryStats();
            setTimeout(runLibraryHealthCheck, 600);
        } catch (err) {
            if (progBar) progBar.style.width = '100%';
            if (progPercent) progPercent.innerText = '100%';
            if (progLabel) progLabel.innerText = err.message || 'Serato year import paused.';
            showToast(err.message || 'Serato year import paused. Nothing was changed.', true);
        } finally {
            if (btn) {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }
    }

    let releaseYearCsvFile = null;
    let releaseYearCsvPreview = null;
    let releaseYearCsvBusy = false;

    function openReleaseYearCsvImport(event) {
        event?.stopPropagation?.();
        const panel = document.getElementById('health-release-year-csv-panel');
        panel?.classList.remove('hidden');
        panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (event) chooseReleaseYearCsvFile();
    }

    function closeReleaseYearCsvImport() {
        document.getElementById('health-release-year-csv-panel')?.classList.add('hidden');
    }

    async function chooseReleaseYearCsvFile() {
        if (releaseYearCsvBusy) return;
        if (typeof hasAxiomNativePicker === 'function' && hasAxiomNativePicker()) {
            try {
                const picked = await axiomNativePick('chooseReleaseYearCsv', 300000);
                releaseYearCsvFile = { name: picked.name, size: picked.size, text: async () => picked.csv_text };
                releaseYearCsvPreview = null;
                await previewReleaseYearCsv(releaseYearCsvFile, false);
            } catch (error) {
                if (!error.cancelled) showToast(error.message || 'Could not open the CSV picker.', true);
            }
            return;
        }
        const input = document.getElementById('health-release-year-csv-file');
        if (!input || releaseYearCsvBusy) return;
        input.value = '';
        try {
            if (typeof input.showPicker === 'function') input.showPicker();
            else input.click();
        } catch (error) {
            // Some WebKit builds expose showPicker but reject it in a native
            // window. The direct click is still a user-gesture-safe fallback.
            input.click();
        }
    }

    async function releaseYearCsvPayload(csvText, apply = false) {
        return {
            csv_text: csvText,
            csv_name: releaseYearCsvFile?.name || 'uploaded CSV',
            apply: apply ? 'true' : 'false',
            overwrite_existing: document.getElementById('health-release-year-csv-overwrite')?.checked ? 'true' : 'false',
            include_candidate_years: document.getElementById('health-release-year-csv-candidates')?.checked ? 'true' : 'false'
        };
    }

    function releaseYearCsvSummary(summary = {}, applied = false) {
        const parts = [
            `${Number(applied ? summary.updated : summary.total_rows || 0).toLocaleString()} ${applied ? 'updated' : 'CSV rows'}`,
            `${Number(summary.ready_to_update || 0).toLocaleString()} ready`,
            `${Number(summary.already_correct || 0).toLocaleString()} already set`,
            `${Number(summary.conflict_existing_year || 0).toLocaleString()} conflicts`,
            `${Number(summary.no_match || 0).toLocaleString()} unmatched`
        ];
        if (Number(summary.ambiguous_match || 0)) parts.push(`${Number(summary.ambiguous_match).toLocaleString()} ambiguous`);
        if (Number(summary.candidate_year_available || 0)) parts.push(`${Number(summary.candidate_year_available).toLocaleString()} candidate years available`);
        return parts.join(' · ');
    }

    async function invalidateReleaseYearCsvPreview() {
        if (releaseYearCsvFile && !releaseYearCsvBusy) {
            await previewReleaseYearCsv(releaseYearCsvFile, false);
        }
    }

    function renderReleaseYearCsvReview(data = {}, applied = false) {
        releaseYearCsvPreview = data;
        const status = document.getElementById('health-release-year-csv-status');
        const results = document.getElementById('health-release-year-csv-results');
        const applyButton = document.getElementById('health-release-year-csv-apply');
        const summary = data.summary || {};
        const ready = Number(summary.ready_to_update || 0);
        const rows = Array.isArray(data.preview_rows) ? data.preview_rows : [];
        if (status) {
            status.innerHTML = `<strong class="text-lime-200">${escapeHtml(applied ? 'Import complete' : 'Preview ready')}</strong><span class="ml-2">${escapeHtml(data.message || releaseYearCsvSummary(summary, applied))}</span><div class="mt-1 text-white/50">${escapeHtml(releaseYearCsvSummary(summary, applied))}. AXIOM cache only: source audio and DJ databases untouched.</div>`;
        }
        if (applyButton) {
            applyButton.disabled = applied || ready <= 0;
            applyButton.textContent = applied ? 'Years applied' : ready > 0
                ? `Apply ${ready.toLocaleString()} ${ready === 1 ? 'year' : 'years'} to AXIOM`
                : 'Apply years to AXIOM';
            if (!applied && ready <= 0 && status) status.innerHTML += '<div>No matching tracks need an update. Apply will be available when the preview has ready matches.</div>';
        }
        if (!results) return;
        results.innerHTML = rows.slice(0, 24).map(row => {
            const rowStatus = String(row.status || 'checked').replace(/_/g, ' ');
            const year = row.serato_year || row.release_year || '';
            const current = row.axiom_year || '';
            const title = row.title || 'Unknown Track';
            const artist = row.artist || '';
            return `<div class="flex flex-col gap-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[10px] md:flex-row md:items-center md:justify-between"><span class="min-w-0 truncate text-white"><strong>${escapeHtml(title)}</strong>${artist ? ` <span class="text-white/50">— ${escapeHtml(artist)}</span>` : ''}</span><span class="shrink-0 text-lime-200">${escapeHtml(current ? `${current} → ${year || '—'}` : (year || '—'))} · ${escapeHtml(rowStatus)}</span><span class="text-white/45">${escapeHtml(row.message || '')}</span></div>`;
        }).join('');
    }

    async function previewReleaseYearCsv(file = releaseYearCsvFile, apply = false) {
        if (!file || releaseYearCsvBusy) return;
        releaseYearCsvBusy = true;
        releaseYearCsvPreview = null;
        const status = document.getElementById('health-release-year-csv-status');
        const choose = document.getElementById('health-release-year-csv-choose');
        const applyButton = document.getElementById('health-release-year-csv-apply');
        if (choose) choose.disabled = true;
        ['health-release-year-csv-overwrite', 'health-release-year-csv-candidates'].forEach(id => { const input = document.getElementById(id); if (input) input.disabled = true; });
        if (applyButton) {
            applyButton.disabled = true;
            applyButton.textContent = apply ? 'Applying years…' : 'Checking matches…';
        }
        const results = document.getElementById('health-release-year-csv-results');
        if (results) results.innerHTML = '';
        if (status) status.textContent = `${apply ? 'Applying' : 'Reading'} ${file.name || 'release year CSV'}...`;
        try {
            if (!/\.csv$/i.test(file.name || '')) throw new Error('Choose a .csv file to preview release years.');
            if (file.size > 10 * 1024 * 1024) throw new Error('CSV files are limited to 10 MB. Split the export into smaller batches.');
            const csvText = typeof file.text === 'function'
                ? await file.text()
                : await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result || ''));
                    reader.onerror = () => reject(new Error('AXIOM could not read that CSV from the native file picker.'));
                    reader.readAsText(file);
                });
            const resp = await fetch('/api/library/import_release_years_csv', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(await releaseYearCsvPayload(csvText, apply))
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success === false) throw new Error(data.error || data.message || 'Release year CSV import failed.');
            renderReleaseYearCsvReview(data, apply);
            if (apply) {
                showToast(data.message || 'Release years imported into AXIOM. Source audio untouched.');
                loadLibraryStats();
                setTimeout(runLibraryHealthCheck, 600);
            } else if (Number(data.summary?.ready_to_update || 0) <= 0) {
                showToast('CSV preview finished, but no AXIOM rows are ready to update.', true);
            } else {
                showToast(`Preview ready: ${Number(data.summary.ready_to_update).toLocaleString()} release years can be imported.`);
            }
        } catch (err) {
            if (applyButton) applyButton.textContent = 'Apply years to AXIOM';
            if (status) status.textContent = err.message || 'Release year CSV import paused. Nothing was changed.';
            showToast(err.message || 'Release year CSV import paused. Nothing was changed.', true);
        } finally {
            releaseYearCsvBusy = false;
            if (choose) choose.disabled = false;
            ['health-release-year-csv-overwrite', 'health-release-year-csv-candidates'].forEach(id => { const input = document.getElementById(id); if (input) input.disabled = false; });
        }
    }

    async function handleReleaseYearCsvSelected(event) {
        if (releaseYearCsvBusy || !event?.target?.files?.[0]) return;
        releaseYearCsvFile = event?.target?.files?.[0] || null;
        releaseYearCsvPreview = null;
        if (releaseYearCsvFile) {
            openReleaseYearCsvImport();
            await previewReleaseYearCsv(releaseYearCsvFile, false);
        }
        if (event?.target) event.target.value = '';
    }

    function bindReleaseYearCsvDropzone() {
        const zone = document.getElementById('health-release-year-csv-dropzone');
        const input = document.getElementById('health-release-year-csv-file');
        if (!zone || !input || zone.dataset.bound === 'true') return;
        zone.dataset.bound = 'true';
        const choose = () => chooseReleaseYearCsvFile();
        zone.addEventListener('click', choose);
        zone.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); }
        });
        zone.addEventListener('dragover', event => { event.preventDefault(); zone.classList.add('is-dragging'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('is-dragging'));
        zone.addEventListener('drop', event => {
            event.preventDefault();
            zone.classList.remove('is-dragging');
            const file = event.dataTransfer?.files?.[0];
            if (!file || releaseYearCsvBusy) return;
            if (!/\.csv$/i.test(file.name || '') && file.type !== 'text/csv') {
                showToast('Choose a CSV file for the release year import.', true);
                return;
            }
            releaseYearCsvFile = file;
            releaseYearCsvPreview = null;
            previewReleaseYearCsv(file, false);
        });
    }

    async function applyReleaseYearCsvImport() {
        if (releaseYearCsvBusy) return;
        if (!releaseYearCsvFile || !releaseYearCsvPreview) {
            showToast('Choose and preview a release year CSV first.', true);
            return;
        }
        const ready = Number(releaseYearCsvPreview.summary?.ready_to_update || 0);
        if (ready <= 0) return;
        const confirmedPreview = releaseYearCsvPreview;
        const confirmed = await showAxiomConfirm(
            'Apply Release Years',
            `Apply ${ready.toLocaleString()} release year${ready === 1 ? '' : 's'} from ${releaseYearCsvFile.name || 'this CSV'} to AXIOM cache? Source audio, file tags, Serato, and djay stay untouched.`,
            'APPLY TO AXIOM',
            'primary'
        );
        if (!confirmed) return;
        if (confirmedPreview !== releaseYearCsvPreview) {
            showToast('The preview changed. Review the latest matches before applying.', true);
            return;
        }
        await previewReleaseYearCsv(releaseYearCsvFile, true);
    }

    let releaseYearResearchPollTimer = null;
    let releaseYearResearchResults = [];
    let releaseYearResearchJob = {};
    let releaseYearRefinementNotifiedJob = '';
    let releaseYearRefinementDismissedJob = '';
    let releaseYearRefinementDismissedStatus = '';

    function closeYearRefinementNotice() {
        releaseYearRefinementDismissedJob = releaseYearResearchJob.job_id || '';
        releaseYearRefinementDismissedStatus = releaseYearResearchJob.status || '';
        document.getElementById('health-year-refinement-notice')?.classList.add('hidden');
        document.body?.classList.remove('year-refinement-notice-active');
    }

    function openYearRefinementReceipt() {
        closeYearRefinementNotice();
        showTab('health');
        openReleaseYearResearch();
        if (releaseYearResearchJob.fixture) renderReleaseYearResearchJob(releaseYearResearchJob);
        else viewSavedReleaseYearResearch();
    }

    function renderYearRefinementNotice(job) {
        if (!job.apply_verified || (releaseYearRefinementDismissedJob === job.job_id && releaseYearRefinementDismissedStatus === job.status)) return;
        let notice = document.getElementById('health-year-refinement-notice');
        if (!notice) {
            notice = document.createElement('section');
            notice.id = 'health-year-refinement-notice';
            notice.setAttribute('role', 'status');
            notice.setAttribute('aria-live', 'polite');
            notice.innerHTML = '<div class="year-refinement-notice-copy"><strong id="year-refinement-notice-title"></strong><p id="year-refinement-notice-copy"></p><progress id="year-refinement-notice-progress" max="100" value="0" aria-label="Year search progress"></progress></div><div class="year-refinement-notice-actions"><button id="year-refinement-notice-receipt" type="button" onclick="openYearRefinementReceipt()">Review receipt</button><button id="year-refinement-notice-stop" type="button" onclick="cancelReleaseYearResearch()">Stop</button><button class="year-refinement-notice-dismiss" type="button" onclick="closeYearRefinementNotice()" aria-label="Dismiss year notification">Dismiss</button></div>';
            document.body.appendChild(notice);
        }
        const running = ['starting', 'running'].includes(job.status);
        const summary = job.apply_summary || {};
        const updated = Number(summary.updated || 0), review = Number(summary.needs_review || 0), correct = Number(summary.already_correct || 0);
        const title = running ? (job.message?.startsWith('Saving') ? 'Saving verified years...' : 'Finding and fixing years...')
            : job.status === 'completed' ? `${job.fixture ? 'Example: ' : ''}${updated.toLocaleString()} song${updated === 1 ? '' : 's'} updated`
            : job.status === 'cancelled' ? 'Year search stopped' : 'Year search needs attention';
        const copy = running ? `${Number(job.progress || 0).toLocaleString()} of ${Number(job.total || 0).toLocaleString()} checked. Verified years will be saved in AXIOM.`
            : job.status === 'completed' ? [correct ? `${correct.toLocaleString()} already correct` : '', review ? `${review.toLocaleString()} need review` : '', job.fixture ? 'Preview only. Your library is unchanged.' : 'Saved in AXIOM. Music file tags unchanged.'].filter(Boolean).join(' · ')
            : 'Open the receipt to see what finished and what needs attention. No uncertain years were applied.';
        notice.classList.remove('hidden');
        document.body?.classList.add('year-refinement-notice-active');
        document.getElementById('year-refinement-notice-title').textContent = title;
        document.getElementById('year-refinement-notice-copy').textContent = copy;
        const progress = document.getElementById('year-refinement-notice-progress');
        progress.value = Number(job.total) ? Number(job.progress || 0) / Number(job.total) * 100 : 0;
        progress.classList.toggle('hidden', !running);
        document.getElementById('year-refinement-notice-stop').classList.toggle('hidden', !running);
        document.getElementById('year-refinement-notice-receipt').classList.toggle('hidden', running);
    }

    function releaseYearResearchHandoffPaths() {
        if (releaseYearResearchJob.fixture || ['starting', 'running'].includes(releaseYearResearchJob.status)) return [];
        return Array.from(new Set(releaseYearResearchResults.filter(row =>
            !row.fixture && row.status === 'verified' && row.release_year && row.path
            && ['applied', 'already_correct'].includes(row.apply_status)
        ).map(row => row.path)));
    }

    async function previewReleaseYearResearchPublish(trigger = null) {
        const paths = releaseYearResearchHandoffPaths();
        if (!paths.length) {
            showToast('Apply verified years to AXIOM first. Groupings and unresolved evidence are not exact-year publish candidates.', true);
            return;
        }
        await startYearPublishPreview(trigger, paths);
    }

    function releaseYearResearchSelectedPaths() {
        try {
            if (typeof selectedHealthPaths !== 'undefined' && selectedHealthPaths?.size) {
                return Array.from(selectedHealthPaths).filter(Boolean);
            }
        } catch (_) {}
        return [];
    }

    let releaseYearResearchPositionPending = false;

    function positionReleaseYearResearch() {
        const panel = document.getElementById('health-release-year-research-panel');
        const positionPanel = () => {
            if (panel?.classList.contains('hidden')) return;
            const viewport = document.getElementById('health-view');
            if (viewport?.contains?.(panel)) {
                viewport.scrollTop += panel.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 16;
            } else panel?.scrollIntoView({ behavior: 'auto', block: 'start' });
        };
        if (window.requestAnimationFrame) window.requestAnimationFrame(() => window.requestAnimationFrame(positionPanel));
        else positionPanel();
    }

    function openReleaseYearResearch() {
        window.AxiomHealthCockpit?.open('era');
        const panel = document.getElementById('health-release-year-research-panel');
        panel?.classList.remove('hidden');
        // Position after evidence is rendered so a taller result table cannot
        // anchor the viewport at its bottom and hide the title/actions.
        releaseYearResearchPositionPending = true;
        positionReleaseYearResearch();
    }

    function closeReleaseYearResearch() {
        if (!releaseYearResearchJob.apply_verified) {
            if (releaseYearResearchPollTimer) clearTimeout(releaseYearResearchPollTimer);
            releaseYearResearchPollTimer = null;
        }
        releaseYearResearchPositionPending = false;
        document.getElementById('health-release-year-research-panel')?.classList.add('hidden');
    }

    function renderReleaseYearResearchJob(job = {}) {
        const status = document.getElementById('health-release-year-research-status');
        const resultsNode = document.getElementById('health-release-year-research-results');
        const applyButton = document.getElementById('health-release-year-research-apply');
        const results = Array.isArray(job.results) ? job.results : [];
        releaseYearResearchResults = results;
        const summary = job.summary || {};
        const counts = Object.entries(summary).map(([key, value]) => `${Number(value || 0).toLocaleString()} ${key.replace(/_/g, ' ')}`).join(' · ');
        if (status) {
            const progress = Number(job.total || 0) ? ` · ${Number(job.progress || 0).toLocaleString()} of ${Number(job.total || 0).toLocaleString()}` : '';
            status.textContent = `${job.message || 'Preparing release-year research...'}${progress}${counts ? ` · ${counts}` : ''}${job.era_scope ? ` · AXIOM Era: ${job.era_scope}` : ''}${job.genre_scope ? ` · Genre: ${job.genre_scope}` : ''}${job.folder_scope ? ` · Folder: ${job.folder_scope}` : ''}${job.editor_query ? ` · DJ/editor text: ${job.editor_query}` : ''}${job.remaining_outside_batch ? ` · ${job.remaining_outside_batch} outside this batch` : ''}`;
            if (job.year_basis === 'original_song') status.textContent += ' · Researching the original song timeline';
            const detail = document.getElementById('health-release-year-research-detail');
            if (detail) detail.textContent = status.textContent;
            if (job.fixture) status.textContent = `${results.length.toLocaleString()} example songs. Your library is unchanged.`;
            else if (['starting', 'running'].includes(job.status)) status.textContent = `${job.cancel_requested ? 'Stopping after the current song' : 'Finding years'}${progress}.`;
            else if (['ready_to_apply', 'needs_review', 'completed'].includes(job.status)) status.textContent = `${results.length.toLocaleString()} song${results.length === 1 ? '' : 's'} checked. Review the matches below.`;
            if (job.apply_verified && job.status === 'completed' && !job.fixture) {
                const saved = job.apply_summary || {};
                status.textContent = `${Number(saved.updated || 0).toLocaleString()} updated · ${Number(saved.already_correct || 0).toLocaleString()} already correct · ${Number(saved.needs_review || 0).toLocaleString()} need review. Saved in AXIOM.`;
            }
        }
        releaseYearResearchJob = job;
        const receiptTitle = document.getElementById('health-year-results-title');
        const receiptCopy = document.getElementById('health-year-results-copy');
        if (receiptTitle) receiptTitle.textContent = job.apply_verified ? 'Year Receipt' : 'Year Results';
        if (receiptCopy) receiptCopy.textContent = job.apply_verified
            ? 'See the years saved and the songs that still need review.'
            : 'Review the years found. Apply verified matches to AXIOM.';
        renderYearRefinementNotice(job);
        document.getElementById('health-release-year-research-next-era')?.classList.toggle('hidden', !(job.era_scope || job.genre_scope || job.editor_query || job.folder_scope) || !job.remaining_outside_batch || ['starting','running'].includes(job.status));
        document.getElementById('health-release-year-research-resume')?.classList.toggle('hidden', !job.resumable);
        document.getElementById('health-release-year-research-stop')?.classList.toggle('hidden', !['starting', 'running'].includes(job.status));
        const verified = results.filter(row => row.status === 'verified' && row.release_year && row.axiom_track_id && row.apply_status === 'ready' && !row.fixture);
        if (applyButton) {
            applyButton.classList.toggle('hidden', verified.length === 0 || ['starting', 'running'].includes(job.status));
            applyButton.textContent = `Apply Verified Years (${verified.length.toLocaleString()})`;
        }
        const handoffPaths = releaseYearResearchHandoffPaths();
        const handoffButton = document.getElementById('health-release-year-research-publish');
        if (handoffButton) {
            handoffButton.disabled = !handoffPaths.length;
            handoffButton.textContent = handoffPaths.length ? `Preview DJ year handoff (${handoffPaths.length})` : 'Preview DJ year handoff';
        }
        const eraExport = document.getElementById('health-era-batch-export');
        if (eraExport) eraExport.disabled = !handoffPaths.length;
        const eraExportStatus = document.getElementById('health-era-export-status');
        if (eraExportStatus) eraExportStatus.textContent = job.fixture
            ? 'Example batch only. File publishing is disabled.'
            : handoffPaths.length
                ? `${handoffPaths.length.toLocaleString()} verified year${handoffPaths.length === 1 ? '' : 's'} ready for this batch's file-tag preview.`
                : 'Apply verified years to AXIOM to enable this batch\'s export.';
        const handoffCopy = document.getElementById('health-release-year-research-handoff-copy');
        if (handoffCopy) handoffCopy.textContent = job.fixture
            ? 'Example evidence only. No file tags or DJ libraries can be changed from this batch.'
            : handoffPaths.length
                ? `${handoffPaths.length} reviewed year${handoffPaths.length === 1 ? '' : 's'} in AXIOM can be checked against file tags. Preview separates missing tags, conflicts, matching tags and blocked files; nothing is published automatically.`
                : 'Apply verified results to AXIOM before previewing this batch for DJ software. AXIOM Era groups and uncertain years remain useful in Live Assist without publishing an exact year.';
        if (!resultsNode) return;
        if (!results.length) { resultsNode.textContent = 'No completed evidence rows yet.'; return; }
        const sourceLinks = sources => (sources || []).filter(source => /^https?:\/\//i.test(source?.url || '')).map(source =>
            `<a href="${escapeHtml(source.url)}" onclick="event.preventDefault();openAxiomExternalUrl(this.href, 'research source');" target="_blank" rel="noopener noreferrer">${escapeHtml(source.publisher || 'Source')}</a>`).join('<br>');
        const eraLabel = era => typeof AXIOMLiveAssistSimilarity !== 'undefined' ? AXIOMLiveAssistSimilarity.eraLabel(era) || era : era;
        const rows = results.map(row => {
            const confidence = `Match: ${row.match_confidence || 'unknown'} · Year: ${row.year_confidence || 'unknown'}`;
            const links = [sourceLinks(row.original_sources), sourceLinks(row.sources)].filter(Boolean).join('<br>');
            const proposedYear = row.release_year || (job.year_basis === 'original_song' ? row.original_release_year : row.candidate_year) || '';
            const label = row.fixture || job.fixture ? 'Example only'
                : row.apply_status === 'applied' ? 'Saved in AXIOM'
                : row.apply_status === 'already_correct' ? 'Already correct'
                : row.needs_attention ? 'Paused · Needs attention'
                : row.era_fit === 'conflict' || row.apply_status === 'era_conflict' ? 'Check era'
                : row.status === 'verified' && row.apply_status === 'ready' && row.release_year && row.axiom_track_id ? 'Verified'
                : proposedYear ? 'Needs review' : 'Year not found';
            return `<tr><th scope="row"><strong>${escapeHtml(row.title || 'Unavailable track')}</strong><span>${escapeHtml(row.artist || '')}</span><details><summary>Details</summary><p>${escapeHtml(row.notes || '')}</p><p>MusicBrainz original year: ${escapeHtml(String(row.original_release_year || 'Unresolved'))}</p><p>Catalogue candidate year: ${escapeHtml(String(row.candidate_year || 'Unresolved'))}</p><p>AXIOM Era: ${escapeHtml(eraLabel(row.era_context || '') || 'Not grouped')} · ${escapeHtml(row.era_fit === 'conflict' ? 'Outside group — review' : row.era_fit === 'fits' ? 'Fits group; check evidence' : 'Year unresolved')}</p><p>Version: ${escapeHtml((row.version_type || 'unknown').replace(/_/g, ' '))}</p><p>${escapeHtml(confidence)}</p><p>${links || 'No source link'}</p><p>AXIOM ID: ${escapeHtml(row.axiom_track_id || '')}</p><p>${escapeHtml((row.apply_status || 'not_applied').replace(/_/g, ' '))} · ${escapeHtml((row.status || '').replace(/_/g, ' '))}</p>${row.release_year ? `<p>Verified release year: ${escapeHtml(String(row.release_year))}</p>` : ''}</details></th><td>${escapeHtml(String(row.existing_year || '—'))}</td><td>${escapeHtml(String(proposedYear || '—'))}</td><td>${escapeHtml(label)}</td></tr>`;
        }).join('');
        resultsNode.innerHTML = `<div class="health-research-table-scroll" tabindex="0" role="region" aria-label="Release-year evidence table"><table class="health-research-table health-year-results-table"><caption>${results.length} song${results.length === 1 ? '' : 's'}${job.fixture ? ' · Example data' : ''}</caption><thead><tr><th scope="col">Song</th><th scope="col">Existing year</th><th scope="col">Suggested year</th><th scope="col">Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
        if (releaseYearResearchPositionPending) {
            releaseYearResearchPositionPending = false;
            positionReleaseYearResearch();
        }
    }

    async function continueEraReleaseYearResearch(trigger = null) {
        if (!(releaseYearResearchJob.era_scope || releaseYearResearchJob.genre_scope || releaseYearResearchJob.editor_query || releaseYearResearchJob.folder_scope)) return;
        await startReleaseYearResearch(trigger, true, {paths:[],era_scope:releaseYearResearchJob.era_scope || '',genre_scope:releaseYearResearchJob.genre_scope || '',editor_query:releaseYearResearchJob.editor_query || '',folder_scope:releaseYearResearchJob.folder_scope || '',year_basis:releaseYearResearchJob.year_basis || 'recording_version',apply_verified:releaseYearResearchJob.apply_verified === true});
    }

    async function resumeReleaseYearResearch() {
        try {
            const response = await fetch('/api/library/year_research/resume', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ job_id: releaseYearResearchJob.job_id })
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Could not resume research.');
            renderReleaseYearResearchJob(payload.job);
            if (releaseYearResearchPollTimer) clearTimeout(releaseYearResearchPollTimer);
            releaseYearResearchPollTimer = setTimeout(pollReleaseYearResearch, 250);
        } catch (err) { showToast(err.message, true); }
    }

    async function showReleaseYearTestLibrary() {
        if (releaseYearResearchPollTimer) clearTimeout(releaseYearResearchPollTimer);
        releaseYearResearchPollTimer = null;
        try {
            const response = await fetch('/api/library/year_research/test_library');
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Test library unavailable.');
            openReleaseYearResearch();
            renderReleaseYearResearchJob(payload.job);
        } catch (err) { showToast(err.message, true); }
    }

    async function viewSavedReleaseYearResearch() {
        openReleaseYearResearch();
        if (releaseYearResearchPollTimer) clearTimeout(releaseYearResearchPollTimer);
        await pollReleaseYearResearch();
    }

    async function pollReleaseYearResearch() {
        if (releaseYearResearchPollTimer) clearTimeout(releaseYearResearchPollTimer);
        releaseYearResearchPollTimer = null;
        try {
            const response = await fetch('/api/library/year_research/status');
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload.success !== true || !payload.job || typeof payload.job.status !== 'string') throw new Error(payload.error || 'Release-year research status is unavailable.');
            const job = payload.job;
            renderReleaseYearResearchJob(job);
            if (['starting', 'running'].includes(job.status)) {
                releaseYearResearchPollTimer = setTimeout(pollReleaseYearResearch, 700);
            } else {
                releaseYearResearchPollTimer = null;
                if (job.apply_verified && job.status === 'completed' && releaseYearRefinementNotifiedJob !== job.job_id) {
                    releaseYearRefinementNotifiedJob = job.job_id;
                    const changed = (job.results || []).filter(row => row.apply_status === 'applied').map(row => ({path:row.path,year:row.release_year,year_estimated:false,year_health_state:'confirmed'}));
                    if (typeof refreshLiveAssistEraPlacements === 'function') refreshLiveAssistEraPlacements(changed);
                    if (typeof refreshEraRefinementAfterFix === 'function') refreshEraRefinementAfterFix(job);
                    loadLibraryStats(false);
                    setTimeout(runLibraryHealthCheck, 600);
                }
                if (!job.apply_verified && (job.status === 'ready_to_apply' || job.status === 'needs_review')) {
                    showToast('Release-year research finished. Review the evidence before applying verified results.');
                }
            }
        } catch (err) {
            releaseYearResearchPollTimer = null;
            const status = document.getElementById('health-release-year-research-status');
            const message = `${err.message || 'Release-year research status is unavailable.'} Research may still be running. Reopen saved research to reconnect, or press Stop.`;
            if (status) status.textContent = message;
            showToast(message, true);
        }
    }

    async function startReleaseYearResearch(trigger = null, restart = false, refinement = null) {
        if (!refinement?.apply_verified) openReleaseYearResearch();
        else {
            releaseYearRefinementDismissedJob = '';
            document.getElementById('health-release-year-research-panel')?.classList.add('hidden');
            releaseYearResearchPositionPending = false;
        }
        if (restart && !await showAxiomConfirm('Start a new research batch', 'Replace the saved batch queue? Completed evidence stays in AXIOM cache.', 'NEW BATCH', 'primary')) return;
        if (trigger) trigger.disabled = true;
        const paths = refinement ? refinement.paths || [] : releaseYearResearchSelectedPaths();
        const status = document.getElementById('health-release-year-research-status');
        if (status) status.textContent = paths.length ? `Researching ${paths.length.toLocaleString()} selected track${paths.length === 1 ? '' : 's'}...` : refinement ? 'Researching the matching songs...' : 'Researching the Missing Year batch...';
        try {
            const response = await fetch('/api/library/year_research/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paths, scope: refinement?.genre_scope || refinement?.editor_query || refinement?.folder_scope ? 'refinement_filter' : refinement?.era_scope ? 'axiom_era' : paths.length ? 'selected' : 'missing_year', era_scope: refinement?.era_scope || '', genre_scope:refinement?.genre_scope || '',editor_query:refinement?.editor_query || '',folder_scope:refinement?.folder_scope || '',year_basis:refinement?.year_basis || 'recording_version', apply_verified:refinement?.apply_verified === true,retry_held:refinement?.retry_held === true,limit: 500, restart })
            });
            const payload = await response.json().catch(() => ({}));
            if (response.status === 409 && payload.job) { renderReleaseYearResearchJob(payload.job); return; }
            if (!response.ok || payload.success === false) throw new Error(payload.error || 'Could not start release-year research.');
            renderReleaseYearResearchJob(payload.job || {});
            if (releaseYearResearchPollTimer) clearTimeout(releaseYearResearchPollTimer);
            releaseYearResearchPollTimer = setTimeout(pollReleaseYearResearch, 250);
        } catch (err) {
            if (status) status.textContent = err.message || 'Release-year research was not started.';
            showToast(err.message || 'Release-year research was not started.', true);
        } finally {
            if (trigger) trigger.disabled = false;
        }
    }

    async function cancelReleaseYearResearch() {
        if (cancelReleaseYearResearch.busy || !['starting', 'running'].includes(releaseYearResearchJob?.status)) return;
        cancelReleaseYearResearch.busy = true;
        try {
            const response = await fetch('/api/library/year_research/cancel', { method: 'POST' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload.success !== true || !payload.job || typeof payload.job.status !== 'string') throw new Error(payload.error || 'Could not confirm the stop request. Research may still be running.');
            renderReleaseYearResearchJob(payload.job);
            if (releaseYearResearchPollTimer) clearTimeout(releaseYearResearchPollTimer);
            releaseYearResearchPollTimer = null;
            if (['starting', 'running'].includes(payload.job.status)) {
                releaseYearResearchPollTimer = setTimeout(pollReleaseYearResearch, 700);
            }
            showToast(payload.cancelled === true ? 'Stopping release-year research after the current row.' : (payload.job.message || 'Research status refreshed.'));
        } catch (err) {
            showToast(err.message || 'Could not confirm the stop request. Research may still be running.', true);
        } finally {
            cancelReleaseYearResearch.busy = false;
        }
    }

    async function applyReleaseYearResearchResults() {
        if (applyReleaseYearResearchResults.busy) return;
        const jobId = releaseYearResearchJob.job_id;
        const trackIds = releaseYearResearchResults.filter(row => row.status === 'verified' && row.release_year && row.apply_status === 'ready' && !row.fixture).map(row => row.axiom_track_id).filter(Boolean);
        if (!trackIds.length) {
            showToast('No verified release-year results are ready to apply.', true);
            return;
        }
        applyReleaseYearResearchResults.busy = true;
        try {
            const confirmed = await showAxiomConfirm(
                'Apply Verified Years',
                `Apply ${trackIds.length.toLocaleString()} verified release year${trackIds.length === 1 ? '' : 's'} to AXIOM cache? Existing manual locks and changed files will be skipped. Source audio and file tags stay untouched.`,
                'APPLY VERIFIED',
                'primary'
            );
            if (!confirmed) return;
            if (!jobId || releaseYearResearchJob.job_id !== jobId) throw new Error('The research batch changed. Review the current results before applying.');
            const response = await fetch('/api/library/year_research/apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ track_ids: trackIds, job_id: jobId })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload.success !== true) throw new Error(payload.error || 'Verified year apply could not be confirmed. Refresh the research results before retrying.');
            if (typeof refreshLiveAssistEraPlacements === 'function') refreshLiveAssistEraPlacements(payload.results || []);
            showToast(payload.message || 'Verified release years applied to AXIOM cache.');
            loadLibraryStats();
            setTimeout(runLibraryHealthCheck, 600);
            await pollReleaseYearResearch();
        } catch (err) {
            showToast(err.message || 'Verified year apply could not be confirmed. Refresh the research results before retrying.', true);
        } finally {
            applyReleaseYearResearchResults.busy = false;
        }
    }

    function releaseYearResearchCsvCell(value) {
        const text = String(value ?? '');
        return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    function exportReleaseYearResearchCsv() {
        if (!releaseYearResearchResults.length) {
            showToast('Run release-year research before exporting a CSV.', true);
            return;
        }
        const header = [
            'File URL', 'Title', 'Artist', 'Original Release Year', 'Release Year',
            'Candidate / Catalogue Year', 'Version Type', 'Verification Status',
            'Research Source', 'Source URL', 'Notes', 'AXIOM Track ID', 'Existing Year', 'Match Confidence', 'Year Confidence', 'Apply Status', 'AXIOM Era', 'Era Evidence Fit'
        ];
        const rows = releaseYearResearchResults.map(row => {
            const sources = Array.isArray(row.original_sources) && row.original_sources.length
                ? row.original_sources
                : Array.isArray(row.sources) ? row.sources : [];
            const source = sources[0] || {};
            const originalYear = row.original_release_year || '';
            return [
                row.path || '', row.title || '', row.artist || '', originalYear,
                row.release_year || '', row.candidate_year || '', row.version_type || '',
                row.status || '', source.publisher || '', source.url || '', row.notes || '',
                row.axiom_track_id || '', row.existing_year || '', row.match_confidence || '', row.year_confidence || '', row.apply_status || '', row.era_context || '', row.era_fit || ''
            ].map(releaseYearResearchCsvCell).join(',');
        });
        const filename = `AXIOM_RELEASE_YEAR_RESEARCH_${new Date().toISOString().slice(0, 10)}.csv`;
        if (typeof downloadAxiomBrowserFile === 'function') {
            downloadAxiomBrowserFile(filename, [header.join(','), ...rows].join('\n'), 'text/csv;charset=utf-8');
        } else {
            const blob = new Blob([[header.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        }
        showToast('Research CSV exported. Original Release Year is AXIOM-owned evidence; source audio stays untouched.');
    }

    async function importSeratoYearsToAxiom() {
        const panel = document.getElementById('serato-year-import-panel');
        panel?.classList.toggle('hidden');
        document.getElementById('serato-year-csv-path')?.focus();
    }

    window.importSeratoYearsToAxiom = importSeratoYearsToAxiom;
    window.pullYearsFromSeratoToAxiom = pullYearsFromSeratoToAxiom;
    window.pullBpmsFromSeratoToAxiom = pullBpmsFromSeratoToAxiom;
    window.pullKeysFromSeratoToAxiom = pullKeysFromSeratoToAxiom;
    window.showSeratoYearImportReview = showSeratoYearImportReview;
    window.showSeratoBpmImportReview = showSeratoBpmImportReview;
    window.showSeratoKeyImportReview = showSeratoKeyImportReview;
    window.previewSeratoYearImportFromPanel = previewSeratoYearImportFromPanel;
    window.applySeratoYearImportFromPanel = applySeratoYearImportFromPanel;
    window.openReleaseYearCsvImport = openReleaseYearCsvImport;
    window.closeReleaseYearCsvImport = closeReleaseYearCsvImport;
    window.chooseReleaseYearCsvFile = chooseReleaseYearCsvFile;
    window.handleReleaseYearCsvSelected = handleReleaseYearCsvSelected;
    window.applyReleaseYearCsvImport = applyReleaseYearCsvImport;
    window.invalidateReleaseYearCsvPreview = invalidateReleaseYearCsvPreview;
    window.startReleaseYearResearch = startReleaseYearResearch;
    window.resumeReleaseYearResearch = resumeReleaseYearResearch;
    window.showReleaseYearTestLibrary = showReleaseYearTestLibrary;
    window.viewSavedReleaseYearResearch = viewSavedReleaseYearResearch;
    window.cancelReleaseYearResearch = cancelReleaseYearResearch;
    window.closeReleaseYearResearch = closeReleaseYearResearch;
    window.applyReleaseYearResearchResults = applyReleaseYearResearchResults;
    window.previewReleaseYearResearchPublish = previewReleaseYearResearchPublish;
    window.exportReleaseYearResearchCsv = exportReleaseYearResearchCsv;
    bindReleaseYearCsvDropzone();
