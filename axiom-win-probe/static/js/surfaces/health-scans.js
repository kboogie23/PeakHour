    // Health server-owned scan orchestration, progress, and cache-only fixes.
    function healthScopeSummaryText(summary = {}) {
        const count = key => Math.max(0, Number(summary[key] || 0)).toLocaleString();
        return `${count('checked')} tracks checked: ${count('already_healthy')} already complete for these checks, ${count('repaired')} repaired, ${count('skipped')} skipped, and ${count('needs_attention')} still need attention.`;
    }

    function renderHealthScopeSummary(job = {}) {
        const panel = document.getElementById('health-scope-summary');
        if (!panel) return;
        panel.classList.toggle('hidden', !job.scope_summary);
        if (!job.scope_summary) return;
        for (const key of ['checked', 'already_healthy', 'repaired', 'skipped', 'needs_attention']) {
            setHealthText(`health-scope-${key}`, Math.max(0, Number(job.scope_summary[key] || 0)).toLocaleString());
        }
    }

    function unifiedHealthIsActive(job = lastUnifiedHealthJob || {}) {
        return ['starting', 'running', 'stopping'].includes(String(job?.status || '').toLowerCase());
    }

    function unifiedHealthIsAnalysisOnly(job = {}) {
        const lanes = Array.isArray(job?.lanes) ? job.lanes.map(lane => String(lane || '')) : [];
        return lanes.length > 0 && lanes.every(lane => ['missing_bpm', 'missing_key'].includes(lane));
    }

    function normalizeUnifiedHealthJob(job = {}) {
        const next = { ...(job || {}) };
        const previous = lastUnifiedHealthJob || {};
        const sameJob = next.status !== 'idle' && (
            (next.job_id && next.job_id === previous.job_id)
            || (!previous.job_id && previous.status === 'starting')
            || (!next.job_id && next.status !== 'starting')
        );
        // Sparse status responses must not discard the accepted repair scope.
        for (const key of ['job_id', 'lanes', 'scope', 'scope_paths', 'scope_track_count', 'preparation_filter', 'flow', 'client_queue']) {
            if (next[key] === undefined && sameJob) next[key] = previous[key];
            if (Array.isArray(next[key])) next[key] = next[key].slice();
        }
        const previousStart = sameJob ? previous.started_at_ms : 0;
        const parsedStart = next.started_at ? Date.parse(next.started_at) : 0;
        next.started_at_ms = previousStart || (Number.isFinite(parsedStart) ? parsedStart : 0) || Date.now();
        next.flow = String(next.flow || 'library');
        next.client_queue = Array.isArray(next.client_queue) ? next.client_queue : [];
        return next;
    }

    function unifiedHealthCompletedEventId(event = {}) {
        return [
            String(event.completed_at || ''),
            String(event.lane || ''),
            String(event.path || ''),
            String(event.title || ''),
        ].join('|');
    }

    function unifiedHealthCompletedStatus(event = {}) {
        const lane = String(event.lane || '');
        if (lane === 'audio' || lane === 'missing_bpm' || lane === 'missing_key') {
            return 'BPM and key analysis completed and saved';
        }
        if (lane === 'year' || lane === 'missing_year') {
            return 'Year check completed and saved';
        }
        return 'Track check completed and saved';
    }

    function paintUnifiedHealthCompletedStages(stage = -1) {
        const stageboard = document.getElementById('health-approved-stageboard');
        if (!stageboard) return;
        const normalizedStage = Number(stage);
        stageboard.querySelectorAll('span').forEach((span, index) => {
            const img = span.querySelector('img');
            const done = normalizedStage >= 5 || index < normalizedStage;
            const active = normalizedStage >= 0 && normalizedStage < 5 && index === normalizedStage;
            span.className = done ? 'done' : active ? 'active' : '';
            if (img) {
                img.src = done ? '/static/icons/check.svg' : `/static/icons/${span.dataset.stageIcon || 'check'}.svg`;
                img.classList.remove('animate-spin', 'health-approved-stage-spinner');
            }
        });
    }

    function startNextUnifiedHealthCompletedPresentation() {
        if (unifiedHealthPresentationTimer || !unifiedHealthPresentationQueue.length) return;
        unifiedHealthPresentedEvent = unifiedHealthPresentationQueue.shift();
        unifiedHealthPresentationStage = 0;
        setHealthText('health-approved-working-title', unifiedHealthPresentedEvent?.title || 'Completed track');
        setHealthText('health-approved-working-artist', unifiedHealthPresentedEvent?.artist || 'Unknown Artist');
        setHealthText('health-approved-working-status', unifiedHealthCompletedStatus(unifiedHealthPresentedEvent));
        const stageboard = document.getElementById('health-approved-stageboard');
        if (stageboard) {
            stageboard.dataset.completedPresentation = 'true';
            stageboard.dataset.stageProgress = '0';
        }
        document.getElementById('health-approved-waveform')?.classList.remove('opacity-50');
        paintUnifiedHealthCompletedStages(0);

        const advance = () => {
            if (unifiedHealthPresentationStage < 4) {
                unifiedHealthPresentationStage += 1;
                if (stageboard) stageboard.dataset.stageProgress = String(unifiedHealthPresentationStage);
                paintUnifiedHealthCompletedStages(unifiedHealthPresentationStage);
                unifiedHealthPresentationTimer = window.setTimeout(advance, 140);
                return;
            }
            unifiedHealthPresentationStage = 5;
            if (stageboard) stageboard.dataset.stageProgress = '5';
            paintUnifiedHealthCompletedStages(5);
            unifiedHealthPresentationTimer = window.setTimeout(() => {
                unifiedHealthPresentationTimer = null;
                startNextUnifiedHealthCompletedPresentation();
            }, 180);
        };
        unifiedHealthPresentationTimer = window.setTimeout(advance, 140);
    }

    function resetUnifiedHealthCompletedPresentations(jobId = '') {
        if (unifiedHealthPresentationTimer) window.clearTimeout(unifiedHealthPresentationTimer);
        unifiedHealthPresentationTimer = null;
        unifiedHealthPresentationJobId = String(jobId || '');
        unifiedHealthPresentedEvent = null;
        unifiedHealthPresentationStage = -1;
        unifiedHealthPresentationQueue = [];
        unifiedHealthPresentationSeen = new Set();
        paintUnifiedHealthCompletedStages(-1);
    }

    function syncUnifiedHealthCompletedPresentations(job = {}) {
        const jobId = String(job.job_id || '');
        if (jobId !== unifiedHealthPresentationJobId) resetUnifiedHealthCompletedPresentations(jobId);
        if (unifiedHealthPresentationTimer) window.clearTimeout(unifiedHealthPresentationTimer);
        unifiedHealthPresentationTimer = null;
        unifiedHealthPresentationQueue = [];
        const completed = (job.recent_events || []).filter(event => event?.completed_at && event.outcome !== 'blocked');
        unifiedHealthPresentedEvent = completed.at(-1) || null;
    }

    function stopUnifiedHealthActivityHeartbeat() {
        if (unifiedHealthActivityTimer) {
            window.clearInterval(unifiedHealthActivityTimer);
            unifiedHealthActivityTimer = null;
        }
        unifiedHealthActivityFrame = 0;
    }

    function tickUnifiedHealthActivityHeartbeat() {
        const active = unifiedHealthIsActive(lastUnifiedHealthJob || {});
        if (!active) {
            stopUnifiedHealthActivityHeartbeat();
            return;
        }
        unifiedHealthActivityFrame = (unifiedHealthActivityFrame + 1) % 5;
        const frame = String(unifiedHealthActivityFrame);
        const consolePanel = document.querySelector('.health-approved-console');
        if (consolePanel) consolePanel.dataset.healthActivityFrame = frame;
        const workerAlive = lastUnifiedHealthJob?.worker_alive !== false;
        setHealthText(
            'health-approved-worker-state',
            workerAlive
                ? 'Working'
                : 'Scan paused unexpectedly'
        );
        const elapsed = Math.max(0, Math.floor((Date.now() - Number(lastUnifiedHealthJob.started_at_ms || Date.now())) / 1000));
        setHealthText('health-approved-elapsed', `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`);
    }

    function ensureUnifiedHealthActivityHeartbeat() {
        if (!unifiedHealthIsActive(lastUnifiedHealthJob || {})) {
            stopUnifiedHealthActivityHeartbeat();
            return;
        }
        if (!unifiedHealthActivityTimer) {
            tickUnifiedHealthActivityHeartbeat();
            unifiedHealthActivityTimer = window.setInterval(tickUnifiedHealthActivityHeartbeat, 650);
        }
    }

    function updateLibraryPreparationRowScanStates(job = {}) {
        const cacheVerified = String(job?.cache_verification || '').toLowerCase() === 'verified';
        const lanes = Array.isArray(job.lanes) ? job.lanes : [];
        const scansKey = lanes.includes('missing_key');
        const activePaths = new Set(
            (Array.isArray(job.active_actions) ? job.active_actions : [])
                .filter(action => scansKey && String(action?.lane || '') === 'audio' && action?.path)
                .map(action => String(action.path))
        );
        const rows = Array.from(document.querySelectorAll('#search-results .library-track-card[data-path]'));
        rows.forEach(row => {
            const path = String(row.dataset.path || '');
            const scanning = activePaths.has(path);
            const keyCell = row.querySelector('.library-key-cell');
            const keyButton = keyCell?.querySelector('.camelot-pill');
            const keyCaption = keyCell?.querySelector('small');
            row.classList.toggle('library-key-scan-active', scanning);
            row.setAttribute('aria-busy', scanning ? 'true' : 'false');
            keyCell?.classList.toggle('is-key-scanning', scanning);
            if (scanning && keyButton && !normalizeCamelotKey(keyButton.textContent || '')) {
                keyButton.textContent = 'Scanning';
                keyButton.disabled = true;
                if (keyCaption) keyCaption.textContent = 'KEY SCAN';
            } else if (!scanning && keyButton?.disabled) {
                const cached = trackVisualCache.get(path) || {};
                const key = normalizeCamelotKey(cached.camelot || cached.key || cached.key_raw || '');
                keyButton.disabled = false;
                keyButton.textContent = key || 'Find';
                if (keyCaption) keyCaption.textContent = 'KEY';
            }
        });

        if (!cacheVerified) return;
        (Array.isArray(job.recent_events) ? job.recent_events : []).forEach(event => {
            const path = String(event?.path || '');
            const key = normalizeCamelotKey(event?.camelot || '');
            if (!path || !key) return;
            const eventId = `${path}:${event.completed_at || key}`;
            if (libraryPreparationCompletedScanEvents.has(eventId)) return;
            libraryPreparationCompletedScanEvents.add(eventId);
            const current = trackVisualCache.get(path) || { path };
            const updated = {
                ...current,
                bpm: Number(event.bpm || current.bpm || 0),
                camelot: key,
                key_raw: key,
                key_estimated: Boolean(event.key_estimated),
                key_confidence: Number(event.key_confidence || 0),
            };
            trackVisualCache.set(path, updated);
            const row = document.querySelector(`#search-results .library-track-card[data-path="${cssEscapeValue(path)}"]`);
            if (!row) return;
            row.classList.remove('library-key-scan-active');
            row.querySelector('.library-key-cell')?.classList.remove('is-key-scanning');
            updateVisibleLibraryPreparationRow(path, updated);
            row.classList.add('library-key-scan-complete');
            libraryPreparationLastVisualCompletionAt = Date.now();
            window.setTimeout(() => row.classList.remove('library-key-scan-complete'), 1100);
        });
    }

    function formatHealthProgressPercent(percent = 0) {
        const value = Math.max(0, Math.min(100, Number(percent) || 0));
        if (value > 0 && value < 0.01) return '<0.01%';
        if (value > 0 && value < 1) return `${value.toFixed(2)}%`;
        if (value >= 1 && value < 10) return `${value.toFixed(1)}%`;
        return `${Math.round(value)}%`;
    }

    function unifiedHealthProgressSnapshot(job = {}) {
        const status = String(job?.status || '').toLowerCase();
        const totals = job?.totals || {};
        const total = Math.max(0, Number(job?.total_steps || 0));
        const processed = Math.max(0, Number(job?.processed_steps || totals.checked || 0));
        const stillMissing = Math.max(0, Number(totals.still_missing || 0));
        const cacheVerification = String(job?.cache_verification || '').toLowerCase();
        const active = unifiedHealthIsActive(job);
        const analysed = active ? Math.max(0, Number(job.batch_completed_steps || 0)) : 0;
        const ratio = total > 0 ? Math.max(0, Math.min(1, (processed + analysed) / total)) : 0;
        const verifiedCompletion = status === 'complete'
            && cacheVerification === 'verified'
            && total > 0
            && processed > 0
            && stillMissing === 0;
        let percent = ratio * 100;
        if (active) percent = Math.min(99.9, percent);
        else if (!verifiedCompletion) percent = Math.min(99, percent);
        return {
            status,
            total,
            processed,
            checked: processed + analysed,
            awaitingSave: analysed,
            stillMissing,
            verifiedCompletion,
            percent,
        };
    }

    function updateUnifiedHealthProgress(job = {}) {
        const nextJob = normalizeUnifiedHealthJob(job);
        lastUnifiedHealthJob = nextJob;
        const active = unifiedHealthIsActive(nextJob);
        if (active) ensureUnifiedHealthActivityHeartbeat();
        else stopUnifiedHealthActivityHeartbeat();
        if (!active) captureAxiomHealthJobReceipt(nextJob);
        if (active) healthScanReceiptDismissed = false;
        window.axiomUnifiedHealthProgressOwnsBanner = active;
        updateLibraryPreparationRowScanStates(nextJob);
        if (typeof updateLibraryTrackPreparationFromJob === 'function') updateLibraryTrackPreparationFromJob(nextJob);
        const progress = unifiedHealthProgressSnapshot(nextJob);
        const { total, processed, percent } = progress;
        const totals = nextJob.totals || {};
        const cacheVerified = String(nextJob.cache_verification || '').toLowerCase() === 'verified';
        const status = String(nextJob.status || 'running').replace(/_/g, ' ').toUpperCase();
        const action = (nextJob.active_actions || []).at(-1);
        const message = active && action ? `${action.title} · ${action.detail || nextJob.message || 'Working'}` : nextJob.message || 'Health is working through your library. Source audio stays untouched.';
        const progressTitle = active
            ? 'Health repair running'
            : progress.status === 'no_work' && progress.stillMissing === 0
                ? 'Health lane clear'
                : progress.status === 'stopped'
                ? 'Health scan stopped'
                : progress.status === 'needs_review' && unifiedHealthIsAnalysisOnly(nextJob)
                    ? 'Scan finished · values not found'
                : progress.verifiedCompletion
                    ? 'Health repair finished'
                    : 'Health repair needs review';
        updateHealthProgressMetrics({
            matched: processed,
            ready: total,
            fixed: cacheVerified ? Number(totals.fixed || 0) + Number(totals.estimated || 0) : 0,
            remaining: Number(totals.still_missing || 0),
        }, true);
        setHealthProgressState(percent, progressTitle, message, status, { owner: 'unified', active });
        if (active && !processed && !nextJob.batch_completed_steps) setHealthText('health-top-scan-percent', 'Preparing');
        renderHealthApprovedWorking(nextJob);
        renderHealthApprovedResults();
        const stopped = ['stopped', 'failed'].includes(String(nextJob.status || '').toLowerCase());
        const hasResults = !active && Boolean(nextJob.status && nextJob.status !== 'idle');
        document.getElementById('health-scan-pause-button')?.classList.toggle('hidden', !active);
        document.getElementById('health-scan-stop-button')?.classList.toggle('hidden', !active && !Number(nextJob.year_retries?.pending || 0));
        document.getElementById('btn-inline-rescan-stop')?.classList.toggle('hidden', !active);
        document.getElementById('health-scan-resume-button')?.classList.toggle('hidden', !stopped);
        document.getElementById('health-scan-results-button')?.classList.toggle('hidden', !hasResults);
        return nextJob;
    }

    async function pollUnifiedHealthStatus() {
        if (unifiedHealthPollTimer) {
            window.clearTimeout(unifiedHealthPollTimer);
            unifiedHealthPollTimer = null;
        }
        try {
            const resp = await fetch('/api/library/unified_health/status', { cache: 'no-store' });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success !== true) throw new Error(data.error || data.message || 'Health repair status failed');
            let job = data.job;
            if (!job || !['idle', 'starting', 'running', 'stopping', 'complete', 'no_work', 'needs_review', 'stopped', 'failed', 'error'].includes(job.status)) {
                throw new Error('Health returned an incomplete scan status.');
            }
            if (job.status === 'idle' && startUnifiedHealthScan.recovering) {
                startUnifiedHealthScan.recovering = false;
                return updateUnifiedHealthProgress({ ...lastUnifiedHealthJob, status: 'needs_review',
                    message: 'No active scan was found on the server. Start the scan again when ready.' });
            }
            if (job.status === 'idle' && unifiedHealthIsActive()) {
                throw new Error('The active scan status is unavailable.');
            }
            startUnifiedHealthScan.recovering = false;
            const completionSignature = `${job.job_id || ''}:${job.status}`;
            const alreadyFinished = pollUnifiedHealthStatus.completedSignature === completionSignature;
            job = updateUnifiedHealthProgress(job) || job;
            if (job.status === 'idle' || alreadyFinished) {
                if (Number(job.year_retries?.pending || 0) > 0) {
                    unifiedHealthPollTimer = window.setTimeout(pollUnifiedHealthStatus, 15000);
                }
                return job;
            }
            if (unifiedHealthIsActive(job)) {
                unifiedHealthPollTimer = window.setTimeout(pollUnifiedHealthStatus, 850);
                return job;
            }
            const finalStatus = job.status;
            stopHealthProgressPulse(finalStatus);
            const progress = unifiedHealthProgressSnapshot(job);

            let displayPercent = progress.percent;
            let displayTitle = progress.verifiedCompletion
                ? 'Health repair complete'
                : 'Health repair needs review';
            let displayKicker = finalStatus.toUpperCase().replace(/_/g, ' ');

            if (finalStatus === 'no_work') {
                displayTitle = progress.stillMissing > 0
                    ? 'Health Scan Blocked: Reconnect Required'
                    : 'Health Lane is Clear';
            } else if (finalStatus === 'needs_review') {
                displayTitle = unifiedHealthIsAnalysisOnly(job)
                    ? 'Scan Finished: Values Not Found'
                    : 'Scan Paused: Review Required';
            } else if (finalStatus === 'stopped') {
                displayTitle = 'Health Scan Stopped';
            } else if (finalStatus === 'failed' || finalStatus === 'error') {
                displayTitle = 'Health Scan Failed';
            }

            setHealthProgressState(
                displayPercent,
                displayTitle,
                job.message || 'Health repair finished. Refreshing the Health snapshot now.',
                displayKicker,
                { owner: 'unified', active: false }
            );

            await runLibraryHealthCheck({ force: true, silent: true, skipProgress: true });

            const libraryVisible = !document.getElementById('tab-content-library')?.classList.contains('hidden');
            let libraryPreparationHandoff = null;
            if (libraryVisible && typeof runSearch === 'function') {
                const revealDelay = Math.max(0, 900 - (Date.now() - libraryPreparationLastVisualCompletionAt));
                if (revealDelay > 0 && libraryPreparationLastVisualCompletionAt > 0) {
                    await new Promise(resolve => window.setTimeout(resolve, revealDelay));
                }
                libraryPreparationHandoff = ['selected_tracks', 'preparation_filter'].includes(String(job.scope || ''))
                    ? await advanceLibraryPreparationAfterScan(job)
                    : (await runSearch(), null);
            }
            if (typeof renderLibraryPreparationScanReceipt === 'function') {
                renderLibraryPreparationScanReceipt(job);
            }

            updateHealthRepairCenter(
                currentHealthSummary,
                displayTitle,
                job.message || 'Health repair finished. Review any remaining rows below.'
            );
            showToast(libraryPreparationHandoff?.message || job.message || 'Health repair finished. Source audio untouched.');
            pollUnifiedHealthStatus.completedSignature = completionSignature;
            if (Number(job.year_retries?.pending || 0) > 0) {
                unifiedHealthPollTimer = window.setTimeout(pollUnifiedHealthStatus, 15000);
            }
            return job;
        } catch (err) {
            stopUnifiedHealthActivityHeartbeat();
            window.axiomUnifiedHealthProgressOwnsBanner = false;
            stopHealthProgressPulse('error');
            const stillActive = startUnifiedHealthScan.recovering || unifiedHealthIsActive() || Number(lastUnifiedHealthJob?.year_retries?.pending || 0) > 0;
            const detail = stillActive
                ? 'The scan may still be running. Reconnecting to its status; no new scan will start.'
                : 'Scan results could not be verified. Refresh Health to try again.';
            setHealthProgressState(0, 'Health status unavailable', detail, 'CONNECTION LOST', { owner: 'unified', active: false });
            setHealthText('health-approved-worker-state', 'Status unavailable');
            if (stillActive) unifiedHealthPollTimer = window.setTimeout(pollUnifiedHealthStatus, 3000);
            showToast(`${err.message || 'Health repair status failed'} ${detail}`, true);
            return null;
        }
    }

    function startHealthReviewDemoScan(finalLanes = [], laneLabel = 'Health', triggerBtn = null, options = {}) {
        if (healthReviewDemoTimer) {
            window.clearTimeout(healthReviewDemoTimer);
            healthReviewDemoTimer = null;
        }
        const requestedPaths = new Set((Array.isArray(options?.paths) ? options.paths : []).map(path => String(path || '')));
        const queue = currentHealthTracks.filter(track =>
            track.health_review_fixture
            && finalLanes.includes(track.fKey)
            && (!requestedPaths.size || requestedPaths.has(String(track.path || '')))
        );
        const total = queue.length;
        const startedAt = new Date().toISOString();
        const completedEvents = [];
        const flow = String(options?.flow || 'library');
        const requestScope = {
            scope: options.scope || (requestedPaths.size ? 'selected_tracks' : options.preparationFilter ? 'preparation_filter' : 'full_library'),
            scope_paths: Array.from(requestedPaths),
            preparation_filter: String(options.preparationFilter || ''),
        };
        const clientQueue = healthApprovedQueueSnapshot(queue.map(track => track.path));
        const stepInterval = Math.max(500, Number(options?.intervalMs || 650));
        setAxiomButtonBusy(triggerBtn, true, 'Starting...');
        setHealthProgressMetricLabels('Checked', 'Queued', 'Fixed', 'Still Missing');
        updateHealthProgressMetrics({ matched: 0, ready: total, fixed: 0, remaining: healthSummarySnapshot().repair_ready }, true);

        if (!total) {
            lastUnifiedHealthJob = {
                status: 'no_work',
                started_at: startedAt,
                processed_steps: 0,
                total_steps: 0,
                lanes: finalLanes,
                flow,
                ...requestScope,
                client_queue: clientQueue,
                counts: { ...currentHealthSummary },
                totals: { checked: 0, fixed: 0, estimated: 0, unresolved: 0, still_missing: healthSummarySnapshot().repair_ready },
                active_actions: [],
                recent_events: [],
                message: `The demo ${laneLabel} queue is already clear.`,
            };
            updateUnifiedHealthProgress(lastUnifiedHealthJob);
            setHealthTopScanBanner(false);
            setAxiomButtonBusy(triggerBtn, false);
            showToast(`Demo ${laneLabel} queue is already clear.`);
            return lastUnifiedHealthJob;
        }

        lastUnifiedHealthJob = {
            status: 'starting',
            started_at: startedAt,
            processed_steps: 0,
            total_steps: total,
            lanes: finalLanes,
            flow,
            ...requestScope,
            client_queue: clientQueue,
            counts: { ...currentHealthSummary },
            totals: { checked: 0, fixed: 0, estimated: 0, unresolved: 0, still_missing: healthSummarySnapshot().repair_ready },
            active_actions: [{
                lane: queue[0].fKey.replace('missing_', ''),
                path: queue[0].path,
                title: queue[0].title,
                artist: queue[0].artist,
                detail: `Preparing demo ${laneLabel} repair`,
            }],
            recent_events: [],
            message: `Demo ${laneLabel} repair accepted. Source audio stays untouched.`,
        };
        updateUnifiedHealthProgress(lastUnifiedHealthJob);
        setAxiomButtonBusy(triggerBtn, false);
        showToast(`Demo ${laneLabel} repair started. No library or audio files will change.`);

        let processed = 0;
        const runNextDemoStep = () => {
            const track = queue[processed];
            if (!track) return;
            const issueKey = track.fKey;
            const lane = issueKey.replace('missing_', '');
            currentHealthTracks = currentHealthTracks.filter(item => item !== track);
            visibleHealthTracks = visibleHealthTracks.filter(item => item !== track);
            currentHealthSummary = {
                ...currentHealthSummary,
                [issueKey]: Math.max(0, Number(currentHealthSummary?.[issueKey] || 0) - 1),
            };
            completedEvents.push({
                lane: healthIssueMetaForKey(issueKey).hType,
                path: track.path,
                title: track.title,
                artist: track.artist,
                detail: 'Demo repair completed inside the review fixture.',
                outcome: 'fixed',
                completed_at: new Date().toISOString(),
            });
            processed += 1;
            const complete = processed >= total;
            const nextTrack = queue[processed];
            lastUnifiedHealthJob = {
                ...lastUnifiedHealthJob,
                status: complete ? 'complete' : 'running',
                processed_steps: processed,
                counts: { ...currentHealthSummary },
                totals: {
                    checked: processed,
                    fixed: processed,
                    estimated: 0,
                    unresolved: 0,
                    still_missing: healthSummarySnapshot().repair_ready,
                },
                active_actions: nextTrack ? [{
                    lane: nextTrack.fKey.replace('missing_', ''),
                    path: nextTrack.path,
                    title: nextTrack.title,
                    artist: nextTrack.artist,
                    detail: `Checking demo ${nextTrack.fKey.replace('missing_', '').toUpperCase()} intelligence`,
                }] : [],
                recent_events: completedEvents.slice(),
                message: complete
                    ? `Demo ${laneLabel} repair complete. Checked ${processed}; fixed ${processed}; ${healthSummarySnapshot().repair_ready} still missing.`
                    : `Fixed ${track.title}. Moving to the next demo ${lane.toUpperCase()} track.`,
            };
            setHealthSnapshotState('ready');
            updateHealthRepairCenter(currentHealthSummary, complete ? 'Demo Repair Complete' : 'Demo Repair Running', lastUnifiedHealthJob.message);
            updateHealthSelectionUI();
            updateUnifiedHealthProgress(lastUnifiedHealthJob);
            if (complete) {
                healthReviewDemoTimer = null;
                stopHealthProgressPulse('complete');
                setHealthTopScanBanner(false);
                setHealthApprovedResultsTab('completed');
                showToast(`Demo ${laneLabel} repair complete: ${processed} fixed, ${healthSummarySnapshot().repair_ready} still missing.`);
                return;
            }
            healthReviewDemoTimer = window.setTimeout(runNextDemoStep, stepInterval);
        };
        healthReviewDemoTimer = window.setTimeout(runNextDemoStep, stepInterval);
        return lastUnifiedHealthJob;
    }

    async function startUnifiedHealthScan(lane = '', triggerBtn = null, requestedPaths = [], options = {}) {
        // A lost reply is not a failed worker. Reconcile with the server before
        // allowing another POST, including repeated clicks on a different lane.
        if (startUnifiedHealthScan.recovering || startUnifiedHealthScan.submitting) {
            showToast('Checking the existing scan. No second scan will start.');
            if (!startUnifiedHealthScan.submitting) await pollUnifiedHealthStatus();
            return null;
        }
        const allowed = ['missing_bpm', 'missing_key', 'missing_year'];
        const requestedLaneList = (Array.isArray(lane) ? lane : [lane])
            .map(value => String(value || '').trim())
            .filter(value => allowed.includes(value));
        const lanes = requestedLaneList.length
            ? Array.from(new Set(requestedLaneList))
            : allowed.filter(key => Number(currentHealthSummary?.[key] || 0) > 0);
        const finalLanes = lanes.length ? lanes : allowed;
        const laneLabel = finalLanes.length === 1
            ? healthIssueMetaForKey(finalLanes[0]).hType.replace('Missing ', '')
            : 'All Health';
        const flow = String(options?.flow || (Array.isArray(requestedPaths) && requestedPaths.length ? 'new_music' : 'library'));
        const preparationFilter = String(options?.preparationFilter || '').trim().toLowerCase();
        const scope = String(options?.scope || (requestedPaths?.length ? 'selected_tracks' : preparationFilter ? 'preparation_filter' : 'full_library'));
        const validPaths = Array.isArray(requestedPaths) && requestedPaths.every(path => typeof path === 'string' && path.trim());
        const validFilter = !preparationFilter || ['missing_metadata', 'missing_bpm_or_key', 'missing_bpm', 'missing_key', 'missing_year', 'missing_both'].includes(preparationFilter);
        if (!validPaths || !validFilter
            || !['selected_tracks', 'preparation_filter', 'full_library'].includes(scope)
            || (scope === 'selected_tracks' && !requestedPaths.length)
            || (scope === 'preparation_filter' && (!preparationFilter || requestedPaths.length))
            || (scope === 'full_library' && (requestedPaths.length || preparationFilter))
            || (flow === 'new_music' && scope !== 'selected_tracks')) {
            showToast('The original Health scan scope is unavailable. Select the tracks or filter again before starting.', true);
            return null;
        }
        const requestScope = {
            lanes: finalLanes.slice(), scope, scope_paths: requestedPaths.slice(),
            scope_track_count: requestedPaths.length, preparation_filter: preparationFilter, flow,
        };
        const clientQueue = healthApprovedQueueSnapshot(requestedPaths);
        const modalOnly = Boolean(options?.modalOnly);
        if (!modalOnly) healthScanReceiptDismissed = false;
        if (axiomReviewMode() === 'health') {
            const requestedPathSet = new Set((Array.isArray(requestedPaths) ? requestedPaths : []).map(path => String(path || '')));
            const matchingReviewFixtureTracks = currentHealthTracks.filter(track =>
                track.health_review_fixture
                && finalLanes.includes(track.fKey)
                && (!requestedPathSet.size || requestedPathSet.has(String(track.path || '')))
            );
            if (matchingReviewFixtureTracks.length) {
                return startHealthReviewDemoScan(finalLanes, laneLabel, triggerBtn, {
                    flow, paths: requestScope.scope_paths, scope, preparationFilter,
                });
            }
        }
        setAxiomButtonBusy(triggerBtn, true, 'Starting...');
        if (!modalOnly) {
            window.axiomUnifiedHealthProgressOwnsBanner = true;
            setHealthProgressMetricLabels('Checked', 'Queued', 'Fixed', 'Still Missing');
            updateHealthProgressMetrics({}, true);
            setHealthProgressState(0, `Starting ${laneLabel} scan...`, 'Reading the library and preparing the scan.', 'STARTING', { owner: 'unified', active: true });
            updateUnifiedHealthProgress({
                status: 'starting',
                started_at: new Date().toISOString(),
                ...requestScope,
                client_queue: clientQueue,
                total_steps: Math.max(0, finalLanes.reduce((sum, key) => sum + Number(currentHealthSummary?.[key] || 0), 0)),
                processed_steps: 0,
                totals: { checked: 0, fixed: 0, estimated: 0, unresolved: 0, still_missing: healthSummarySnapshot().repair_ready },
                counts: { ...currentHealthSummary },
                message: `AXIOM accepted the ${laneLabel} repair and is preparing the first track.`,
                active_actions: [],
            });
        }
        startUnifiedHealthScan.submitting = true;
        try {
            const resp = await fetch('/api/library/unified_health/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lanes: finalLanes,
                    counts: {
                        missing_bpm: Number(currentHealthSummary?.missing_bpm || 0),
                        missing_key: Number(currentHealthSummary?.missing_key || 0),
                        missing_year: Number(currentHealthSummary?.missing_year || 0),
                    },
                    paths: requestScope.scope_paths,
                    scope,
                    preparation_filter: preparationFilter,
                    flow,
                })
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success !== true || !data.job
                || !['starting', 'running', 'stopping', 'complete', 'no_work', 'needs_review', 'stopped', 'failed', 'error'].includes(data.job.status)) {
                const error = new Error(data.error || data.message || 'Health scan could not start');
                error.startRejected = resp.status >= 400 && resp.status < 500 && data.success === false;
                throw error;
            }
            if (modalOnly) {
                updateLibraryTrackPreparationFromJob(data.job || {});
                pollLibraryTrackPreparationStatus(String(data.job?.job_id || ''));
            } else {
                updateUnifiedHealthProgress(data.job || {});
                showToast(`${laneLabel} scan started. Keep AXIOM open.`);
                pollUnifiedHealthStatus();
            }
            return data.job || null;
        } catch (err) {
            if (!err.startRejected) {
                startUnifiedHealthScan.recovering = true;
                updateUnifiedHealthProgress({ status: 'starting', ...requestScope, client_queue: clientQueue,
                    message: 'Start response lost. Checking whether the scan is running; no second scan will start.' });
                await pollUnifiedHealthStatus();
                return null;
            }
            if (!modalOnly) {
                window.axiomUnifiedHealthProgressOwnsBanner = false;
                stopHealthProgressPulse('error');
                const failedJob = {
                    status: 'failed',
                    started_at: new Date().toISOString(),
                    ...requestScope,
                    client_queue: clientQueue,
                    total_steps: Math.max(0, finalLanes.reduce((sum, key) => sum + Number(currentHealthSummary?.[key] || 0), 0)),
                    processed_steps: 0,
                    totals: {
                        checked: 0,
                        fixed: 0,
                        estimated: 0,
                        unresolved: 0,
                        still_missing: healthSummarySnapshot().repair_ready,
                    },
                    counts: { ...currentHealthSummary },
                    message: err.message || 'Health scan could not start. No completion was claimed and no source audio was changed.',
                    active_actions: [],
                };
                updateUnifiedHealthProgress(failedJob);
                showToast(err.message || 'Health scan could not start', true);
            }
            return null;
        } finally {
            startUnifiedHealthScan.submitting = false;
            setAxiomButtonBusy(triggerBtn, false);
        }
    }

    async function stopUnifiedHealthScan() {
        if (axiomReviewMode() === 'health' && healthReviewDemoTimer) {
            window.clearTimeout(healthReviewDemoTimer);
            healthReviewDemoTimer = null;
            lastUnifiedHealthJob = {
                ...(lastUnifiedHealthJob || {}),
                status: 'stopped',
                active_actions: [],
                message: 'Demo Health repair stopped safely. Completed demo results remain visible.',
            };
            updateUnifiedHealthProgress(lastUnifiedHealthJob);
            stopHealthProgressPulse('stopped');
            setHealthTopScanBanner(false);
            showToast('Demo Health repair stopped safely.');
            return;
        }
        if (!unifiedHealthIsActive() && !Number(lastUnifiedHealthJob?.year_retries?.pending || 0)) {
            window.axiomUnifiedHealthProgressOwnsBanner = false;
            setHealthTopScanBanner(false);
            return;
        }
        try {
            setHealthProgressState(96, 'Stopping now...', 'AXIOM will not start or save another unfinished track.', 'STOPPING', { owner: 'unified' });
            const resp = await fetch('/api/library/unified_health/stop', { method: 'POST' });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success !== true || !data.job || typeof data.job.status !== 'string') throw new Error(data.error || data.message || 'Could not confirm the Health stop request.');
            updateUnifiedHealthProgress(data.job);
            pollUnifiedHealthStatus();
            showToast(data.job.status === 'stopped' ? 'Health stopped. Completed work remains saved.' : 'Health status refreshed.');
        } catch (err) {
            stopUnifiedHealthActivityHeartbeat();
            window.axiomUnifiedHealthProgressOwnsBanner = false;
            stopHealthProgressPulse('error');
            setHealthProgressState(0, 'Stop not confirmed', 'The scan may still be running. Checking its status now.', 'CONNECTION LOST', { owner: 'unified', active: false });
            pollUnifiedHealthStatus();
            showToast(err.message || 'Could not confirm the Health stop request.', true);
        }
    }

    async function resumeUnifiedHealthScan(triggerBtn = null) {
        const previous = lastUnifiedHealthJob || {};
        const previousLanes = Array.isArray(previous.lanes) ? previous.lanes.slice() : [];
        if (!previousLanes.length || previousLanes.some(lane => !['missing_bpm', 'missing_key', 'missing_year'].includes(lane))
            || !['selected_tracks', 'preparation_filter', 'full_library'].includes(previous.scope)
            || (previous.scope === 'selected_tracks' && !Array.isArray(previous.scope_paths))) {
            showToast('The original Health scan scope is unavailable. Select the tracks or filter again before resuming.', true);
            return null;
        }
        const button = triggerBtn || document.getElementById('health-scan-resume-button');
        return startUnifiedHealthScan(previousLanes, button, previous.scope_paths || [], {
            scope: previous.scope,
            preparationFilter: previous.preparation_filter || '',
            flow: previous.flow || 'library',
        });
    }

    function showUnifiedHealthResults() {
        window.AxiomHealthCockpit?.open('inbox');
        if (lastUnifiedHealthJob) {
            lastUnifiedHealthJob = normalizeUnifiedHealthJob(lastUnifiedHealthJob);
            renderHealthApprovedResults();
            renderHealthApprovedWorking(lastUnifiedHealthJob);
        }
        const review = document.getElementById('health-repair-review');
        if (review && !review.classList.contains('hidden') && review.innerText.trim()) {
            review.scrollIntoView({ behavior: 'smooth', block: 'center' });
            showToast('Showing latest Health repair results.');
            return;
        }
        const events = lastUnifiedHealthJob?.recent_events || [];
        if (events.length) {
            setHealthApprovedResultsTab('completed');
            document.querySelector('.health-approved-results')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            showToast('Showing completed Health events.');
            return;
        }
        openHealthRepairReport();
    }

    async function runHealthLaneScan(lane, triggerBtn = null) {
        if (!['missing_bpm', 'missing_key', 'missing_year'].includes(lane)) return null;
        return startUnifiedHealthScan(lane, triggerBtn);
    }

    function updateHealthProgressMetrics(counts = {}, visible = true) {
        const box = document.getElementById('health-progress-metrics');
        if (!box) return;
        const values = {
            matched: Number(counts.matched || 0),
            ready: Number(counts.ready || 0),
            fixed: Number(counts.fixed || 0),
            remaining: Number(counts.remaining || 0)
        };
        setHealthText('health-progress-matched', values.matched.toLocaleString());
        setHealthText('health-progress-ready', values.ready.toLocaleString());
        setHealthText('health-progress-fixed', values.fixed.toLocaleString());
        setHealthText('health-progress-remaining', values.remaining.toLocaleString());
        box.classList.toggle('hidden', !visible);
    }

    function setHealthProgressMetricLabels(first = 'Checked', second = 'Found', third = 'Fixed', fourth = 'Still Missing') {
        setHealthText('health-progress-matched-label', first);
        setHealthText('health-progress-ready-label', second);
        setHealthText('health-progress-fixed-label', third);
        setHealthText('health-progress-remaining-label', fourth);
    }

    function seratoHealthAggregate(results = {}, applied = false) {
        if (results?.all?.summary) {
            const summary = results.all.summary || {};
            return {
                matched: Number(summary.serato_matches || 0),
                ready: Number(summary.metadata_updates_ready || summary.ready_to_update || 0),
                fixed: Number(summary.metadata_updates_applied || summary.updated || 0)
            };
        }
        const entries = ['bpm', 'key', 'year'].map(key => results?.[key]).filter(Boolean);
        return entries.reduce((total, result) => {
            total.matched += seratoHealthMatchCount(result);
            total.ready += seratoHealthReadyCount(result);
            total.fixed += seratoHealthUpdatedCount(result);
            return total;
        }, { matched: 0, ready: 0, fixed: 0 });
    }

    function healthRepairDelta(before = {}, after = {}, key = 'missing_bpm') {
        return Math.max(0, Number(before?.[key] || 0) - Number(after?.[key] || 0));
    }

    function showHealthRepairReceipt(beforeSummary = {}, afterSummary = {}, results = {}, sourceLabel = 'Health Repair') {
        ensureHealthProgressAtTop();
        currentHealthRepairReview = null;
        const container = document.getElementById('health-progress-container');
        const review = document.getElementById('health-repair-review');
        if (!container || !review) return;
        const before = healthSummarySnapshot(beforeSummary);
        const after = healthSummarySnapshot(afterSummary);
        const aggregate = seratoHealthAggregate(results, true);
        const rows = [
            { label: 'Missing BPM', before: before.missing_bpm, after: after.missing_bpm, fixed: healthRepairDelta(before, after, 'missing_bpm'), detail: 'Tempo blockers reduced' },
            { label: 'Missing Key', before: before.missing_key, after: after.missing_key, fixed: healthRepairDelta(before, after, 'missing_key'), detail: 'Harmonic blockers reduced' },
            { label: 'Missing Year', before: before.missing_year, after: after.missing_year, fixed: healthRepairDelta(before, after, 'missing_year'), detail: 'Era blockers reduced' },
            { label: 'Missing Files', before: before.missing_file, after: after.missing_file, fixed: healthRepairDelta(before, after, 'missing_file'), detail: 'Needs reconnect if still present' }
        ];
        const totalDropped = rows.reduce((sum, row) => sum + row.fixed, 0);
        updateHealthProgressMetrics({
            matched: aggregate.matched,
            ready: aggregate.ready,
            fixed: aggregate.fixed || totalDropped,
            remaining: after.total_blockers
        }, true);
        review.innerHTML = `
          <div class="health-repair-head">
            <div>
              <div class="health-repair-kicker">${escapeHtml(sourceLabel)} Receipt</div>
              <div class="health-repair-title">${totalDropped.toLocaleString()} visible Health blocker${totalDropped === 1 ? '' : 's'} cleared after refresh.</div>
              <div class="health-repair-subtitle">Before: ${before.total_blockers.toLocaleString()} blockers. After: ${after.total_blockers.toLocaleString()} blockers. AXIOM cache updated only; source audio and Serato database untouched.</div>
            </div>
            <div class="health-repair-actions">
              <button type="button" onclick="hideHealthRepairReview()">Close</button>
            </div>
          </div>
          <div class="health-repair-list">
            ${rows.map(row => `
              <div class="health-repair-row">
                <div class="health-repair-row-main">
                  <strong>${escapeHtml(row.label)}</strong>
                  <span>${row.before.toLocaleString()} before -> ${row.after.toLocaleString()} after</span>
                  <small>${escapeHtml(row.detail)}</small>
                </div>
                <div class="health-repair-row-result">
                  <b>${row.fixed.toLocaleString()}</b>
                  <small>Cleared</small>
                </div>
              </div>
            `).join('')}
          </div>
        `;
        container.classList.remove('hidden');
        review.classList.remove('hidden');
    }

    function showCompleteHealthRepairReport(beforeSummary, afterSummary, outcomes = []) {
        ensureHealthProgressAtTop();
        currentHealthRepairReview = null;
        const review = document.getElementById('health-repair-review');
        if (!review) return;
        const before = healthSummarySnapshot(beforeSummary);
        const after = healthSummarySnapshot(afterSummary);
        const fixed = outcomes.reduce((total, outcome) => total + Number(outcome?.fixed || 0), 0);
        const suggestions = outcomes.reduce((total, outcome) => total + Number(outcome?.suggested || 0), 0);
        const unresolved = outcomes.reduce((total, outcome) => total + Number(outcome?.unresolved || 0), 0);
        const detailRows = outcomes.map(outcome => {
            const results = Array.isArray(outcome?.results) ? outcome.results : [];
            return `
                <div class="health-repair-group">
                    <div class="health-repair-kicker">${escapeHtml(healthRepairLabel(outcome.type))} Results</div>
                    <div class="health-repair-title">Checked ${Number(outcome.processed || 0).toLocaleString()} · Fixed ${Number(outcome.fixed || 0).toLocaleString()} · Suggestions ${Number(outcome.suggested || 0).toLocaleString()} · Review ${Number(outcome.unresolved || 0).toLocaleString()}</div>
                    <div class="health-repair-list">${renderHealthRepairRows(results, outcome.type)}</div>
                </div>
            `;
        }).join('');
        review.innerHTML = `
            <div class="health-repair-head">
                <div>
                    <div class="health-repair-kicker">Scan &amp; Improve Receipt</div>
                    <div class="health-repair-title">${fixed.toLocaleString()} fixed · ${suggestions.toLocaleString()} year suggestion${suggestions === 1 ? '' : 's'} ready · ${unresolved.toLocaleString()} need another source</div>
                    <div class="health-repair-subtitle">Health blockers: ${before.total_blockers.toLocaleString()} before -> ${after.total_blockers.toLocaleString()} after. AXIOM used local analysis and music sources first. Source audio stayed untouched.</div>
                </div>
                <div class="health-repair-actions">
                    ${suggestions > 0 ? '<button type="button" class="primary" onclick="applyAllYearSuggestions(this)">Apply Year Suggestions</button>' : ''}
                    ${after.total_blockers > 0 ? '<button type="button" onclick="syncSeratoLibraryFolderToAxiom(this)">Choose Database V2</button>' : ''}
                    <button type="button" onclick="hideHealthRepairReview()">Close</button>
                </div>
            </div>
            ${detailRows || '<div class="health-repair-list"><div class="health-repair-row"><div><strong>No metadata blockers</strong><span>Nothing needed repair.</span></div><div class="health-repair-result">Ready</div></div></div>'}
        `;
        document.getElementById('health-progress-container')?.classList.remove('hidden');
        review.classList.remove('hidden');
    }

    const HEALTH_UNIFIED_LANES = [
        { key: 'missing_bpm', type: 'Missing BPM', label: 'BPM' },
        { key: 'missing_key', type: 'Missing Key', label: 'Key' },
        { key: 'missing_year', type: 'Missing Year', label: 'Year' },
    ];

    function setHealthFilter(filter) {
        activeHealthFilter = filter;
        resetHealthViewScroll();
        updateHealthPriorityPanel();
        showToast(`Focusing: ${filter.replace('_', ' ').toUpperCase()}`);

        const map = {
            'missing_file': 'missing-file',
            'missing_bpm': 'missing-bpm',
            'missing_key': 'missing-key',
            'missing_year': 'missing-year',
            'all': 'all'
        };

        if (map[filter] !== 'all') {
            toggleAccordion(map[filter], true);
            // Scroll the opened section inside the Health pane, not the whole app.
            const target = document.getElementById(`acc-${map[filter]}`);
            const container = document.getElementById('health-view');
            if (target && container) {
                setTimeout(() => {
                    resetHealthViewScroll();
                    const top = target.offsetTop - container.offsetTop - 8;
                    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
                }, 80);
            }
        } else {
            // Open every section that actually has issues, leave Year Rescan as-is.
            ['missing-file', 'missing-bpm', 'missing-key', 'missing-year'].forEach(id => {
                const countEl = document.getElementById(`acc-count-${id}`);
                const body = document.getElementById(`body-${id}`);
                const icon = document.getElementById(`icon-${id}`);
                if (countEl && parseInt(countEl.innerText) > 0 && body) {
                    body.classList.remove('hidden');
                    if (icon) icon.style.transform = 'rotate(180deg)';
                }
            });
        }
    }

    function toggleAccordion(id, forceOpen = false) {
        const ids = ['year-rescan', 'missing-file', 'missing-bpm', 'missing-key', 'missing-year'];
        if (forceOpen) {
            ids.forEach(aid => {
                const body = document.getElementById(`body-${aid}`);
                const icon = document.getElementById(`icon-${aid}`);
                if (!body || !icon) return;
                if (aid === id) {
                    body.classList.remove('hidden');
                    icon.style.transform = 'rotate(180deg)';
                } else {
                    body.classList.add('hidden');
                    icon.style.transform = 'rotate(0deg)';
                }
            });
            return;
        }

        const body = document.getElementById(`body-${id}`);
        const icon = document.getElementById(`icon-${id}`);
        if (!body) return;

        if (body.classList.contains('hidden')) {
            body.classList.remove('hidden');
            if (icon) icon.style.transform = 'rotate(180deg)';
        } else {
            body.classList.add('hidden');
            if (icon) icon.style.transform = 'rotate(0deg)';
        }
    }

    function updateHealthSelectionUI() {
        const batchBar = document.getElementById('batch-health-actions');
        const countLabel = document.getElementById('selected-count');

        visibleHealthTracks = []; // Used by click handlers for rendered rows only.

        const groups = {
            'Missing File': document.getElementById('body-missing-file'),
            'Missing BPM': document.getElementById('body-missing-bpm'),
            'Missing Key': document.getElementById('body-missing-key'),
            'Missing Year': document.getElementById('body-missing-year')
        };
        const renderedCounts = {
            'Missing File': 0, 'Missing BPM': 0, 'Missing Key': 0, 'Missing Year': 0
        };

        Object.values(groups).forEach(el => { if (el) el.innerHTML = ''; });
        let hHtml = { 'Missing File': '', 'Missing BPM': '', 'Missing Key': '', 'Missing Year': '' };

        const tracksByType = currentHealthTracks.reduce((acc, track) => {
            if (acc[track.hType]) acc[track.hType].push(track);
            return acc;
        }, { 'Missing File': [], 'Missing BPM': [], 'Missing Key': [], 'Missing Year': [] });

        Object.keys(groups).forEach(key => {
            (tracksByType[key] || []).slice(0, HEALTH_RENDER_LIMIT).forEach((track) => {
                const index = visibleHealthTracks.length;
                visibleHealthTracks.push(track);
                hHtml[key] += renderHealthIssue(track, track.hType, track.hColor, index);
                renderedCounts[key]++;
            });
        });

        Object.keys(groups).forEach(key => {
            const summaryKey = HEALTH_TYPE_KEYS[key];
            const totalCount = Number(currentHealthSummary[summaryKey] ?? (tracksByType[key] || []).length);
            const availableCount = (tracksByType[key] || []).length;
            const hiddenCount = Math.max(0, totalCount - renderedCounts[key]);
            if (hiddenCount > 0) {
                hHtml[key] += `
                    <div class="health-window-note text-center py-4 text-white/45 text-[10px] font-black uppercase tracking-widest border border-white/10 bg-white/[0.03] rounded-lg">
                        Showing ${renderedCounts[key].toLocaleString()} of ${totalCount.toLocaleString()}. Use the scan buttons to repair the next batch, then refresh.
                    </div>
                `;
            } else if (currentHealthTruncated[summaryKey] && availableCount > renderedCounts[key]) {
                hHtml[key] += `
                    <div class="health-window-note text-center py-4 text-white/45 text-[10px] font-black uppercase tracking-widest border border-white/10 bg-white/[0.03] rounded-lg">
                        Showing a focused batch first so the browser stays responsive.
                    </div>
                `;
            }
        });

        Object.keys(groups).forEach(key => {
            if (groups[key]) {
                const summaryKey = HEALTH_TYPE_KEYS[key];
                const totalCount = Number(currentHealthSummary[summaryKey] ?? renderedCounts[key]);
                if (totalCount === 0) {
                    groups[key].innerHTML = `<div class="text-center py-8 text-white/40 text-[10px] font-black uppercase">No ${key} issues found.</div>`;
                } else {
                    groups[key].innerHTML = hHtml[key];
                }
                const countElId = `acc-count-${key.toLowerCase().replace(' ', '-')}`;
                const countEl = document.getElementById(countElId);
                if (countEl) countEl.innerText = totalCount.toLocaleString();
            }
        });

        if (selectedHealthPaths.size > 0) {
            batchBar.classList.remove('hidden');
            countLabel.innerText = selectedHealthPaths.size;
        } else {
            batchBar.classList.add('hidden');
        }
        updateHealthPriorityPanel();
        renderHealthInboxDetail();
    }

    function removeHealthTrackFromView(path, issueKeys = null) {
        const keySet = issueKeys ? new Set(Array.isArray(issueKeys) ? issueKeys : [issueKeys]) : null;
        const removedTracks = currentHealthTracks.filter(track => track.path === path && (!keySet || keySet.has(track.fKey)));
        currentHealthTracks = currentHealthTracks.filter(track => !(track.path === path && (!keySet || keySet.has(track.fKey))));
        visibleHealthTracks = visibleHealthTracks.filter(track => !(track.path === path && (!keySet || keySet.has(track.fKey))));
        removedTracks.forEach(track => {
            if (!track.fKey) return;
            currentHealthSummary = {
                ...currentHealthSummary,
                [track.fKey]: Math.max(0, Number(currentHealthSummary?.[track.fKey] || 0) - 1)
            };
        });
        if (!currentHealthTracks.some(track => track.path === path)) selectedHealthPaths.delete(path);
        updateHealthSelectionUI();
    }

    async function quickFixTrack(path, button = null) {
        if (!path) return;
        setAxiomButtonBusy(button, true, 'Refreshing...');
        removeHealthTrackFromView(path, ['missing_bpm', 'missing_key']);
        showToast('Checking embedded BPM/key tags. Source audio untouched.');
        try {
            const resp = await fetch('/api/library/fix_track', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, action: 'rescan' })
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success === false) throw new Error(data.message || data.error || 'Quick fix paused');
            showToast(data.message || 'Performance intelligence refreshed. Source audio remains untouched.');
            loadLibraryStats();
            if (!document.getElementById('tab-content-library').classList.contains('hidden')) runSearch();
            setTimeout(runLibraryHealthCheck, 600);
        } catch (err) {
            showToast(err.message || 'Quick fix paused. Source audio remains protected.', true);
            runLibraryHealthCheck();
        } finally {
            setAxiomButtonBusy(button, false);
        }
    }

    async function fetchHealthYear(path, button = null) {
        if (!path) return;
        const track = currentHealthTracks.find(t => t.path === path) || {};
        const filename = (track.path || path || '').split('/').pop();
        showToast('Looking up release year. Source audio untouched.');
        setAxiomButtonBusy(button, true, 'Looking up...');
        try {
            const lookup = await fetch('/api/library/fetch_year', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path,
                    title: track.title || '',
                    artist: track.artist || '',
                    filename
                })
            });
            const result = await lookup.json().catch(() => ({}));
            if (result.transient_error) {
                showToast(result.message || 'Year lookup paused. AXIOM will retry this track later.');
                return;
            }
            if (!lookup.ok || !result.year) throw new Error(result.error || 'AXIOM could not confidently identify a release year.');
            if (result.requires_review) {
                Object.assign(track, {
                    suggested_year: Number(result.year),
                    suggested_year_source: result.source || 'catalog_suggestion',
                    suggested_year_confidence: Number(result.confidence || 0),
                    suggested_year_title: result.matched_title || '',
                    suggested_year_artist: result.matched_artist || '',
                    suggested_year_reason: result.suggestion_reason || 'Review this title-only match before applying it.'
                });
                showHealthRepairReview({
                    type: 'Missing Year',
                    batchSize: 1,
                    processed: 1,
                    fixed: 0,
                    unresolved: 1,
                    remaining: healthSummaryCount('missing_year'),
                    results: [{
                        ...result,
                        path,
                        title: track.title || filename,
                        artist: track.artist || '',
                        suggested_year: Number(result.year),
                        year: null,
                    }],
                });
                renderHealthInboxDetail();
                showToast(`Likely year ${result.year} found. Review the match and use it from the report.`);
                return;
            }

            const update = await fetch('/api/library/update_year', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(healthYearUpdatePayload(path, {
                    year: result.year,
                    source: result.source || 'catalog_lookup',
                    approximate: Boolean(result.approximate),
                    confidence: result.confidence,
                    suggestion_reason: result.suggestion_reason || '',
                }))
            });
            const saved = await update.json().catch(() => ({}));
            if (completeNonAppliedHealthYearOutcome(path, saved)) return;
            if (!update.ok || saved.success === false) throw new Error(saved.message || 'Year update paused');

            const updatedYear = Number(saved.track?.year || result.year);
            propagateTrackMetadata(path, { year: updatedYear, release_year: updatedYear }, saved.track || null);
            removeHealthTrackFromView(path, 'missing_year');
            showToast(saved.message || `Release year set to ${updatedYear}. Source audio remains untouched.`);
            loadLibraryStats();
            setTimeout(runLibraryHealthCheck, 600);
        } catch (err) {
            showToast(err.message || 'Year lookup paused. Source audio remains protected.', true);
        } finally {
            setAxiomButtonBusy(button, false);
        }
    }

    function healthYearTrack(path) {
        return currentHealthTracks.find(track => track.path === path)
            || currentHealthRepairReview?.results?.find(track => track.path === path)
            || {};
    }

    function healthYearUpdatePayload(path, extra = {}) {
        const track = healthYearTrack(path);
        return {
            path,
            title: track.title || '',
            artist: track.artist || '',
            health_context: true,
            ...extra,
        };
    }

    function completeNonAppliedHealthYearOutcome(path, response = {}) {
        if (!['moved_to_missing_files', 'stale_removed'].includes(response.outcome)) return false;
        removeHealthTrackFromView(path, 'missing_year');
        advanceYearSuggestionReview(path);
        showToast(response.message || 'Health moved past this stale year blocker.');
        runLibraryHealthCheck({ force: true });
        return true;
    }

    function advanceYearSuggestionReview(path) {
        if (currentHealthRepairReview?.type === 'Missing Year') {
            const results = currentHealthRepairReview.results.filter(item => item.path !== path);
            showHealthRepairReview({
                ...currentHealthRepairReview,
                fixed: currentHealthRepairReview.fixed + 1,
                unresolved: Math.max(0, currentHealthRepairReview.unresolved - 1),
                remaining: healthSummaryCount('missing_year'),
                suggested: Math.max(0, currentHealthRepairReview.suggested - 1),
                results,
            });
            window.requestAnimationFrame(() => {
                document.querySelector('#health-repair-review [data-year-suggestion="true"]')?.focus();
            });
            return;
        }

        document.querySelectorAll('#health-repair-review [data-health-year-path]').forEach(row => {
            if (row.getAttribute('data-health-year-path') === path) row.remove();
        });
    }

    async function applyYearSuggestion(path, year, button = null) {
        setAxiomButtonBusy(button, true, `<span>Applying ${Number(year)}</span>`);
        try {
            const update = await fetch('/api/library/update_year', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(healthYearUpdatePayload(path, {
                    year,
                    source: 'catalog_suggestion_approved',
                }))
            });
            const saved = await update.json().catch(() => ({}));
            if (completeNonAppliedHealthYearOutcome(path, saved)) return;
            if (!update.ok || saved.success === false) {
                throw new Error(saved.message || 'Suggested year could not be applied.');
            }
            propagateTrackMetadata(path, { year, release_year: year }, saved.track || null);
            removeHealthTrackFromView(path, 'missing_year');
            currentHealthSummary.year_suggestions_ready = Math.max(0, Number(currentHealthSummary.year_suggestions_ready || 0) - 1);
            advanceYearSuggestionReview(path);
            const remaining = healthSummaryCount('missing_year');
            updateHealthRepairCenter(currentHealthSummary, 'Year Applied', `${remaining.toLocaleString()} missing year blocker${remaining === 1 ? '' : 's'} remain. The next available suggestion is ready below.`);
            showToast(`Applied ${year}. Missing Year is now ${remaining}. Source audio untouched.`);
            loadLibraryStats();
        } catch (err) {
            showToast(err.message || 'Suggested year could not be applied.', true);
        } finally {
            setAxiomButtonBusy(button, false);
        }
    }

    async function applyAllYearSuggestions(button = null) {
        setAxiomButtonBusy(button, true, 'Applying...');
        try {
            const response = await fetch('/api/library/apply_year_suggestions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.success === false) {
                showToast(data.message || 'Year suggestions could not be applied.', true);
                return;
            }
            const appliedPaths = new Set((data.results || []).map(item => item.path).filter(Boolean));
            if (appliedPaths.size) {
                currentHealthTracks = currentHealthTracks.filter(track => !(
                    track.fKey === 'missing_year' && appliedPaths.has(track.path)
                ));
                currentHealthSummary = {
                    ...currentHealthSummary,
                    missing_year: Math.max(0, healthSummaryCount('missing_year') - appliedPaths.size),
                    year_suggestions_ready: 0,
                };
                appliedPaths.forEach(path => selectedHealthPaths.delete(path));
                updateHealthSelectionUI();
            }
            currentHealthRepairReview = null;
            document.getElementById('health-repair-review')?.classList.add('hidden');
            showToast(data.message || 'Year suggestions applied inside AXIOM.');
            const refreshed = await runLibraryHealthCheck({ force: true });
            updateHealthRepairCenter(refreshed?.summary || currentHealthSummary, 'Suggestions Applied', `${Number(data.updated || 0).toLocaleString()} reviewable year suggestion${Number(data.updated || 0) === 1 ? '' : 's'} applied inside AXIOM cache.`);
        } catch (err) {
            showToast(err.message || 'Year suggestions could not be applied.', true);
        } finally {
            setAxiomButtonBusy(button, false);
        }
    }

    async function saveManualYear(path, button = null) {
        const inputId = `manual-year-${String(path || '').replace(/[^a-z0-9]/gi, '')}`;
        const input = document.getElementById(inputId);
        const rawYear = (input?.value || '').trim();
        const yearMatch = rawYear.match(/\b(19\d{2}|20\d{2}|21\d{2})\b/);
        const year = yearMatch ? Number(yearMatch[1]) : 0;
        const maxYear = new Date().getFullYear() + 1;
        if (!year || year < 1900 || year > maxYear) {
            showToast(`Enter a year between 1900 and ${maxYear}.`, true);
            return;
        }

        setAxiomButtonBusy(button, true, 'Saving...');
        showToast('Saving release year...');
        try {
            const update = await fetch('/api/library/update_year', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(healthYearUpdatePayload(path, { year }))
            });
            const saved = await update.json().catch(() => ({}));
            if (completeNonAppliedHealthYearOutcome(path, saved)) return;
            if (!update.ok || saved.success === false) throw new Error(saved.message || 'Year update paused');

            const updatedYear = Number(saved.track?.year || year);
            propagateTrackMetadata(path, { year: updatedYear, release_year: updatedYear }, saved.track || null);

            removeHealthTrackFromView(path, 'missing_year');
            advanceYearSuggestionReview(path);
            showToast(saved.message || `Release year set to ${updatedYear}. Source audio remains untouched.`);
            loadLibraryStats();
        } catch (err) {
            showToast(err.message || 'Year update paused. Source audio remains protected.', true);
        } finally {
            setAxiomButtonBusy(button, false);
        }
    }

    async function saveHealthInboxManualYear(path, button = null) {
        const inputId = `health-inbox-year-${String(path || '').replace(/[^a-z0-9]/gi, '')}`;
        const input = document.getElementById(inputId);
        const rawYear = (input?.value || '').trim();
        const yearMatch = rawYear.match(/\b(19\d{2}|20\d{2}|21\d{2})\b/);
        const year = yearMatch ? Number(yearMatch[1]) : 0;
        const maxYear = new Date().getFullYear() + 1;
        if (!year || year < 1900 || year > maxYear) {
            showToast(`Enter a year between 1900 and ${maxYear}.`, true);
            return;
        }

        if (Number(input?.dataset?.suggestedYear || 0) === year) {
            return applyYearSuggestion(path, year, button);
        }

        setAxiomButtonBusy(button, true, 'Saving...');
        showToast('Saving release year...');
        try {
            const update = await fetch('/api/library/update_year', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(healthYearUpdatePayload(path, { year }))
            });
            const saved = await update.json().catch(() => ({}));
            if (completeNonAppliedHealthYearOutcome(path, saved)) return;
            if (!update.ok || saved.success === false) throw new Error(saved.message || 'Year update paused');

            const updatedYear = Number(saved.track?.year || year);
            propagateTrackMetadata(path, { year: updatedYear, release_year: updatedYear }, saved.track || null);
            removeHealthTrackFromView(path, 'missing_year');
            advanceYearSuggestionReview(path);
            showToast(saved.message || `Release year set to ${updatedYear}. Source audio remains untouched.`);
            loadLibraryStats();
        } catch (err) {
            showToast(err.message || 'Year update paused. Source audio remains protected.', true);
        } finally {
            setAxiomButtonBusy(button, false);
        }
    }

    async function saveHealthInboxManualBPM(path, button = null) {
        const inputId = `health-inbox-bpm-${String(path || '').replace(/[^a-z0-9]/gi, '')}`;
        const input = document.getElementById(inputId);
        const rawBpm = (input?.value || '').trim();
        const bpm = parseFloat(rawBpm);
        if (!bpm || bpm <= 0) return showToast("AXIOM could not confirm that BPM.", true);

        setAxiomButtonBusy(button, true, 'Saving...');
        try {
            const resp = await fetch('/api/library/update_bpm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, bpm })
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success === false) throw new Error(data.message || 'BPM update failed');

            propagateTrackMetadata(path, { bpm }, data.track || null);
            removeHealthTrackFromView(path, 'missing_bpm');
            showToast(data.message || "BPM intelligence updated. Source audio remains untouched.");
            loadLibraryStats();
            if (!document.getElementById('tab-content-library').classList.contains('hidden')) runSearch();
            runLibraryHealthCheck({ force: false });
        } catch (err) {
            showToast(err.message || 'BPM intelligence could not be updated. Source audio remains protected.', true);
        } finally {
            setAxiomButtonBusy(button, false);
        }
    }

    async function saveHealthInboxManualKey(path, button = null) {
        const inputId = `health-inbox-key-${String(path || '').replace(/[^a-z0-9]/gi, '')}`;
        const input = document.getElementById(inputId);
        const key = (input?.value || '').trim().toUpperCase();
        if (!key || !/^(1[0-2]|[1-9])[AB]$/.test(key)) return showToast("Enter a valid Camelot key (e.g. 8A, 12B).", true);

        setAxiomButtonBusy(button, true, 'Saving...');
        try {
            const resp = await fetch('/api/library/update_key', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, key })
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success === false) throw new Error(data.message || 'Key update failed');

            propagateTrackMetadata(path, { key }, data.track || null);
            removeHealthTrackFromView(path, 'missing_key');
            showToast(data.message || "Key intelligence updated. Source audio remains untouched.");
            loadLibraryStats();
            if (!document.getElementById('tab-content-library').classList.contains('hidden')) runSearch();
            runLibraryHealthCheck({ force: false });
        } catch (err) {
            showToast(err.message || 'Key intelligence could not be updated. Source audio remains protected.', true);
        } finally {
            setAxiomButtonBusy(button, false);
        }
    }
