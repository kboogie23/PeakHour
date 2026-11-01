    // Health maintenance review, approved workspaces, and utility actions.
    async function loadHealthRecordings() {
        const container = document.getElementById('health-recordings-list');
        if (!container) return;
        container.textContent = 'Checking recordings…';
        try {
            const response = await fetch('/api/library/health/recordings');
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Unable to load recordings.');
            container.replaceChildren();
            for (const row of data.rows || []) {
                const element = document.createElement('div');
                element.className = 'health-detail-list-row';
                const copy = document.createElement('div');
                const title = document.createElement('strong');
                title.textContent = row.title;
                const detail = document.createElement('span');
                detail.textContent = `${row.classification.excluded ? 'Skipped' : 'Included'} · ${row.classification.reason}`;
                copy.append(title, detail);
                const select = document.createElement('select');
                select.setAttribute('aria-label', `Recording type for ${row.title}`);
                for (const [value, label] of [['auto', 'Automatic'], ['music', 'Individual song'], ['dj_mix', 'DJ mix'], ['live_recording', 'Live recording']]) {
                    select.add(new Option(label, value, false, value === row.override));
                }
                select.onchange = async () => {
                    select.disabled = true;
                    try {
                        const result = await fetch('/api/library/health/recordings', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ path: row.path, classification: select.value }),
                        });
                        const saved = await result.json();
                        if (!result.ok) throw new Error(saved.error || 'Unable to save recording type.');
                        await loadHealthRecordings();
                        await runLibraryHealthCheck();
                    } catch (error) {
                        select.value = row.override;
                        select.disabled = false;
                        showToast(error.message, true);
                    }
                };
                element.append(copy, select);
                container.append(element);
            }
            if (!data.rows?.length) container.textContent = 'No long recordings detected.';
        } catch (error) { container.textContent = error.message; }
    }

    function renderHealthUtilityReviewLoading(cfg) {
        const titleEl = document.getElementById('health-review-title');
        const copyEl = document.getElementById('health-review-copy');
        const container = document.getElementById('health-review-container');
        const badge = document.getElementById('health-review-ready-badge');
        if (titleEl) titleEl.innerText = cfg.label;
        if (copyEl) copyEl.innerText = 'Request accepted. Preparing the latest AXIOM-only review.';
        if (badge) badge.classList.add('hidden');
        if (container) {
            container.setAttribute('aria-busy', 'true');
            container.innerHTML = `
                <div class="health-review-loading">
                    <strong><span class="health-audit-spinner" aria-hidden="true"></span> Checking ${escapeHtml(cfg.label)}</strong>
                    <p id="health-title-scan-inline" role="status">Reading your library...</p>
                </div>
            `;
        }
    }

    function healthMaintenanceRequestIsCurrent(requestVersion, navigationVersion) {
        return Number(window.healthMaintenanceRequestVersion || 0) === requestVersion
            && Number(window.axiomTabNavigationVersion || 0) === navigationVersion
            && window.axiomVisibleTab === 'health-review';
    }

    if (typeof window.reviewHealthUtilityCategory !== 'function') {
        window.reviewHealthUtilityCategory = async function (category, options = {}) {
            options = options || {};
            const cfg = HEALTH_CLEANUP_CATEGORIES[category];
            if (!cfg) return;
            if (cfg.canExclude) {
                showTab('health');
                activeHealthInboxItem = category;
                toggleHealthApprovedSetBuilding(true);
                document.getElementById('health-set-review')?.scrollIntoView({behavior: 'smooth', block: 'start'});
                return;
            }
            if (cfg.reviewOnly) {
                showToast(`${cfg.label} are valid DJ tools. AXIOM keeps them available and no longer lists them as cleanup removals.`);
                showTab('health');
                return;
            }
            const requestVersion = Number(window.healthMaintenanceRequestVersion || 0) + 1;
            window.healthMaintenanceRequestVersion = requestVersion;
            currentHealthCleanupReview = { category, samples: [], total: 0, loading: true };
            updateHealthMetadataRulesButton(category);
            if (!healthMetadataRuleCategoryIsVisible(category)) toggleHealthMetadataRulesPanel(false);
            showTab('health-review');
            const navigationVersion = Number(window.axiomTabNavigationVersion || 0);
            renderHealthUtilityReviewLoading(cfg);
            const data = await loadHealthUtilityAudit({ force: options.force === true, afterCurrent: options.force === true });
            if (!healthMaintenanceRequestIsCurrent(requestVersion, navigationVersion)) return data;
            if (!data) {
                currentHealthCleanupReview = null;
                const container = document.getElementById('health-review-container');
                if (container) {
                    container.setAttribute('aria-busy', 'false');
                    container.innerHTML = '<div class="health-review-error"><strong>Review unavailable</strong><p>The review could not be loaded. Return to Health and try again.</p></div>';
                }
                return;
            }
            const samples = (data?.samples?.[category] || []).map(normalizeModalTrackMetadata);
            const isMetadataCleanup = cfg.canCleanNames || cfg.canPreviewCleanup;
            const categoryCount = isMetadataCleanup
                ? Number(data?.cleanable?.[category] || 0)
                : Number(data?.summary?.[category] || samples.length || 0);
            const total = Math.max(0, categoryCount - Number(data?.excluded?.[category] || 0));

            if (!samples.length) {
                showToast(`No ${cfg.label.toLowerCase()} candidates found.`);
                currentHealthCleanupReview = null;
                showTab('health');
                runLibraryHealthCheck({ force: false });
                return;
            }

            currentHealthCleanupReview = {
                category,
                samples,
                total,
                loading: false,
                selectedIndexes: samples.map((_track, index) => index),
            };

            const titleEl = document.getElementById('health-review-title');
            const copyEl = document.getElementById('health-review-copy');
            const container = document.getElementById('health-review-container');
            const badge = document.getElementById('health-review-ready-badge');

            if (titleEl) titleEl.innerText = cfg.label;
            if (copyEl) copyEl.innerText = category === 'title_cleanup'
                ? 'AXIOM found editor credits and version notes that can be separated more clearly.'
                : cfg.description || 'Review library maintenance candidates.';
            if (badge) {
                badge.textContent = `${total.toLocaleString()} suggestion${total === 1 ? '' : 's'} ready`;
                badge.classList.remove('hidden');
            }

            if (container) {
                container.setAttribute('aria-busy', 'false');
                const sampleCount = samples.length;
                const cleanableCount = Number(data?.cleanable?.[category] || 0);
                const canPreviewCleanup = cfg.canCleanNames || cfg.canPreviewCleanup;
                if (canPreviewCleanup) {
                    container.innerHTML = renderHealthMetadataCleanupReview(category, samples, total, cleanableCount);
                    updateHealthCleanupReviewSelection();
                    syncHealthCleanupPreviewButtons();
                    showToast(`${cfg.label} review ready. Source audio untouched.`);
                    return data;
                }
                const individualRemovalRows = cfg.canExclude ? `
                    <div class="grid gap-2 mt-4">
                        ${samples.slice(0, 12).map(track => `
                            <div class="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 items-center px-4 py-3 rounded-xl border border-white/10 bg-black/28 hover:bg-black/40 transition-all">
                                <div class="min-w-0">
                                    <div class="text-white text-[12px] font-black uppercase tracking-widest truncate">${escapeHtml(track.title || track.filename || 'Unknown Track')}</div>
                                    <div class="text-white/45 text-[10px] font-bold uppercase tracking-widest truncate">${escapeHtml(track.artist || 'Unknown Artist')} · ${escapeHtml(track.path || '')}</div>
                                </div>
                                <button onclick="event.stopPropagation(); playAudioFile('${escapeJs(track.path)}', '${escapeJs(track.title || '')}', '${escapeJs(track.artist || '')}', ${track.bpm || 0}, '${escapeJs(track.camelot || '')}', '${escapeJs(track.energy || '')}', event, '${escapeJs(track.genre || '')}')" class="w-8 h-8 rounded-full bg-axiom-accent/20 flex items-center justify-center text-axiom-accent hover:bg-axiom-accent hover:text-black transition-all" title="Play Track">
                                    <svg class="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                </button>
                                <button onclick="removeSingleHealthUtilityFromAxiom('${category}', '${escapeJs(track.path || '')}', this)" class="px-3 py-2 rounded-lg bg-red-500/15 border border-red-400/35 text-red-300 text-[10px] font-black uppercase tracking-[0.12em] hover:bg-red-400 hover:text-black transition-all" type="button" ${track.path ? '' : 'disabled'}>Remove</button>
                            </div>
                        `).join('')}
                    </div>
                ` : '';
                const actionButtons = cfg.canExclude ? `
                    <div class="flex gap-4 flex-wrap mt-6 pt-6 border-t border-white/10">
                    <button onclick="setHealthUtilityExclusionForReview('${category}', true, this)" class="px-6 py-3 rounded-xl bg-axiom-accent text-black text-[10px] font-black uppercase tracking-[0.14em] hover:brightness-110 transition-all" type="button">Exclude Sample From Sets</button>
                    <button onclick="setHealthUtilityExclusionForReview('${category}', false, this)" class="px-6 py-3 rounded-xl bg-white/5 border border-white/10 text-white/70 text-[10px] font-black uppercase tracking-[0.14em] hover:border-axiom-accent/45 hover:text-axiom-accent transition-all" type="button">Restore Sample</button>
                        <button onclick="removeHealthUtilityFromAxiom('${category}', 'sample', this)" class="px-6 py-3 rounded-xl bg-orange-500/15 border border-orange-400/35 text-orange-300 text-[10px] font-black uppercase tracking-[0.14em] hover:bg-orange-400 hover:text-black transition-all" type="button">Remove Sample From AXIOM</button>
                        <button onclick="removeHealthUtilityFromAxiom('${category}', 'all_candidates', this)" class="px-6 py-3 rounded-xl bg-red-500/15 border border-red-400/35 text-red-300 text-[10px] font-black uppercase tracking-[0.14em] hover:bg-red-400 hover:text-black transition-all" type="button">Remove All ${escapeHtml(cfg.label)}</button>
                    </div>
                ` : (cfg.canCleanNames || cfg.canCleanTitles) ? `
                    <div class="flex gap-4 flex-wrap mt-6 pt-6 border-t border-white/10">
                        <button onclick="setHealthUtilityMetadataCleanupForReview('${category}', true, 'sample', this)" class="px-6 py-3 rounded-xl bg-axiom-accent text-black text-[10px] font-black uppercase tracking-[0.14em] hover:brightness-110 transition-all shadow-[0_0_20px_rgba(var(--axiom-accent-rgb), 0.3)]" type="button">${escapeHtml(cfg.applyLabel || 'Apply Cleanup Sample')}</button>
                        <button onclick="setHealthUtilityMetadataCleanupForReview('${category}', true, 'all_candidates', this)" class="px-6 py-3 rounded-xl bg-axiom-accent/20 border border-axiom-accent/40 text-axiom-accent text-[10px] font-black uppercase tracking-[0.14em] hover:bg-axiom-accent hover:text-black transition-all" type="button">Apply All ${escapeHtml(cfg.label)}</button>
                        <button onclick="setHealthUtilityMetadataCleanupForReview('${category}', false, 'sample', this)" class="px-6 py-3 rounded-xl bg-white/5 border border-white/10 text-white/70 text-[10px] font-black uppercase tracking-[0.14em] hover:border-axiom-accent/45 hover:text-axiom-accent transition-all" type="button">${escapeHtml(cfg.restoreLabel || 'Restore Cleanup')}</button>
                    </div>
                ` : '';

                container.innerHTML = `
                    <div class="max-w-4xl">
                        <div class="px-6 py-5 mb-6 rounded-2xl border border-axiom-accent/25 bg-axiom-accent/5 text-left">
                            <div class="text-white text-base font-black uppercase tracking-[0.1em]">${escapeHtml(cfg.label)} · ${total.toLocaleString()} candidate${total === 1 ? '' : 's'}</div>
                            <div class="text-white/50 text-[11px] font-bold uppercase tracking-widest mt-1">Showing ${sampleCount.toLocaleString()} safe review sample${sampleCount === 1 ? '' : 's'}. AXIOM has not changed source audio or Serato data.</div>
                            ${canPreviewCleanup ? `<div class="text-axiom-accent/80 text-[11px] font-black uppercase tracking-widest mt-1">${cleanableCount.toLocaleString()} candidate${cleanableCount === 1 ? '' : 's'} have a proposed cache cleanup.</div>` : ''}
                        </div>
                        ${individualRemovalRows}
                        ${actionButtons}
                    </div>
                `;
            }
            showToast(`${cfg.label} review ready. Source audio untouched.`);
        };
    }

    if (typeof window.removeHealthUtilityFromAxiom !== 'function') {
        window.removeHealthUtilityFromAxiom = async function (category, scope = 'sample', triggerBtn = null) {
            const cfg = HEALTH_CLEANUP_CATEGORIES[category];
            const review = currentHealthCleanupReview;
            if (!cfg?.canExclude) return;
            const samplePaths = (review?.category === category ? review.samples || [] : [])
                .map(track => track.path)
                .filter(Boolean);
            const total = Number(currentHealthCleanupAudit?.summary?.[category] || review?.total || samplePaths.length || 0);
            const removingAll = scope === 'all_candidates';
            if (!removingAll && !samplePaths.length) return showToast(`No ${cfg.label.toLowerCase()} sample is selected.`, true);

            const targetCount = removingAll ? total : samplePaths.length;
            const confirmed = await showAxiomConfirm(
                removingAll ? `Remove All ${cfg.label}` : `Remove ${cfg.label} Sample`,
                removingAll
                    ? `Remove all ${targetCount.toLocaleString()} detected ${cfg.label.toLowerCase()} from AXIOM's library index? Your audio files and Serato database will not be touched. A future full rescan may find those files again.`
                    : `Remove the visible ${targetCount.toLocaleString()} reviewed ${cfg.label.toLowerCase()} sample from AXIOM's library index? Your audio files and Serato database will not be touched.`,
                removingAll ? 'REMOVE ALL FROM AXIOM' : 'REMOVE FROM AXIOM',
                'danger'
            );
            if (!confirmed) return;
            setAxiomButtonBusy(triggerBtn, true, '<span>Removing...</span>');

            showToast(removingAll ? `Removing ${cfg.label.toLowerCase()} from AXIOM index...` : 'Removing review sample from AXIOM index...');
            try {
                const resp = await fetch('/api/library/utility_remove_from_index', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        category,
                        scope: removingAll ? 'all_candidates' : 'sample',
                        paths: removingAll ? [] : samplePaths
                    })
                });
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok || data.success === false) throw new Error(data.error || data.message || 'AXIOM index removal failed');
                showToast(data.message || 'Removed from AXIOM index. Source audio untouched.');
                currentHealthCleanupAudit = null;
                healthCleanupAuditLoadedAt = 0;
                currentRemovedFromAxiomBin = null;
                removedFromAxiomBinLoadedAt = 0;
                await loadRemovedFromAxiomBin({ force: true });
                loadLibraryStats();
                if (data.count > 0) {
                    const nextAudit = await loadHealthUtilityAudit({ force: true });
                    const remaining = Number(nextAudit?.summary?.[category] || 0);
                    if (remaining > 0) {
                        reviewHealthUtilityCategory(category);
                    } else {
                        showTab('health');
                        runLibraryHealthCheck({ force: false });
                    }
                } else {
                    loadHealthUtilityAudit({ force: true });
                }
            } catch (err) {
                showToast(err.message || 'AXIOM index removal failed', true);
            } finally {
                setAxiomButtonBusy(triggerBtn, false);
            }
        };
    }

    if (typeof window.removeSingleHealthUtilityFromAxiom !== 'function') {
        window.removeSingleHealthUtilityFromAxiom = async function (category, path, triggerBtn = null) {
            const cfg = HEALTH_CLEANUP_CATEGORIES[category];
            if (!cfg?.canExclude || !path) return;
            const confirmed = await showAxiomConfirm(
                `Remove ${cfg.label} Track`,
                `Remove this ${cfg.label.toLowerCase()} candidate from AXIOM's library index? Source audio and Serato data will not be touched.`,
                'REMOVE FROM AXIOM',
                'danger'
            );
            if (!confirmed) return;
            setAxiomButtonBusy(triggerBtn, true, '<span>Removing...</span>');
            showToast(`Removing 1 ${cfg.label.toLowerCase()} candidate from AXIOM index...`);
            try {
                const resp = await fetch('/api/library/utility_remove_from_index', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ category, scope: 'sample', paths: [path] })
                });
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok || data.success === false) throw new Error(data.error || data.message || 'AXIOM index removal failed');
                showToast(data.message || 'Removed from AXIOM index. Source audio untouched.');
                currentHealthCleanupAudit = null;
                healthCleanupAuditLoadedAt = 0;
                currentRemovedFromAxiomBin = null;
                removedFromAxiomBinLoadedAt = 0;
                await loadRemovedFromAxiomBin({ force: true });
                await loadHealthUtilityAudit({ force: true });
                loadLibraryStats();
                if (currentHealthCleanupReview?.category === category) {
                    reviewHealthUtilityCategory(category);
                } else {
                    renderHealthInboxDetail();
                }
            } catch (err) {
                showToast(err.message || 'AXIOM index removal failed', true);
            } finally {
                setAxiomButtonBusy(triggerBtn, false);
            }
        };
    }

    window.reviewNextHealthMetadataCleanup = async function (category, triggerBtn = null, force = false) {
        if (triggerBtn?.disabled) return;
        setAxiomButtonBusy(triggerBtn, true, 'Loading next review...');
        try {
            await reviewHealthUtilityCategory(category, { force });
        } finally {
            setAxiomButtonBusy(triggerBtn, false);
        }
    };

    async function runHealthReviewMetadataCleanupDemo(category, apply = true, scope = 'sample', triggerBtn = null) {
        const review = currentHealthCleanupReview;
        const selectedIndexes = scope === 'all_candidates'
            ? (review?.samples || []).map((_track, index) => index)
            : healthCleanupSelectedIndexes(review);
        const samples = (review?.samples || [])
            .filter((track, index) => selectedIndexes.includes(index) && track.health_review_cleanup_fixture);
        if (!samples.length) return false;
        const cfg = HEALTH_CLEANUP_CATEGORIES[category];
        const actionLabel = apply ? 'Applying' : 'Restoring';
        setAxiomButtonBusy(triggerBtn, true, `${actionLabel} 0/${samples.length}`);
        for (let index = 0; index < samples.length; index += 1) {
            if (triggerBtn) triggerBtn.textContent = `${actionLabel} ${index + 1}/${samples.length}`;
            await new Promise(resolve => window.setTimeout(resolve, 500));
        }

        if (apply) {
            const selectedPaths = new Set(samples.map(track => track.path));
            const remainingSamples = (currentHealthCleanupAudit?.samples?.[category] || [])
                .filter(track => !selectedPaths.has(track.path));
            currentHealthCleanupAudit.summary[category] = remainingSamples.length;
            currentHealthCleanupAudit.cleanable[category] = remainingSamples.length;
            currentHealthCleanupAudit.samples[category] = remainingSamples;
        } else {
            currentHealthCleanupAudit = healthReviewCleanupDemoAudit();
        }
        healthCleanupAuditLoadedAt = Date.now();
        updateHealthCleanupPanel(currentHealthCleanupAudit);
        setAxiomButtonBusy(triggerBtn, false);
        renderHealthMetadataCleanupReceipt(category, samples, {
            applied: apply,
            count: samples.length,
            checked: samples.length,
            pending: apply ? Math.max(0, Number(currentHealthCleanupAudit?.summary?.[category] || 0)) : 0,
            demo: true,
        });
        if (apply) {
            recordAxiomSessionActivity(category === 'artist_format' ? 'artist' : 'title', samples.length, {
                key: `cleanup-demo:${category}:${Date.now()}`,
                trackIds: samples.map(track => track.path).filter(Boolean),
            });
        }
        showToast(`Demo ${cfg?.label || 'metadata'} ${apply ? 'cleanup' : 'restore'} complete: ${samples.length} processed.`);
        return true;
    }

    if (typeof window.setHealthUtilityMetadataCleanupForReview !== 'function') {
        window.setHealthUtilityMetadataCleanupForReview = async function (category, apply = true, scope = 'sample', triggerBtn = null) {
            const cfg = HEALTH_CLEANUP_CATEGORIES[category];
            const review = currentHealthCleanupReview;
            if (!(cfg?.canCleanNames || cfg?.canCleanTitles) || !review || review.category !== category) return;
            const selectedIndexes = healthCleanupSelectedIndexes(review);
            const selectedSamples = (review.samples || []).filter((_track, index) => selectedIndexes.includes(index));
            let paths = apply ? selectedSamples.map(track => track.path).filter(Boolean) : (review.receiptPaths || []);
            let expectedValues = selectedSamples.map(track => ({ path: track.path, title: track.title || '', artist: track.artist || '' }));
            const excludedPaths = (review.samples || []).filter((_track, index) => !selectedIndexes.includes(index)).map(track => track.path);
            let rulesSignature = review.review_rules_signature || '';
            const selectedPathSet = new Set(paths);
            const customOverrides = Object.entries(healthCleanupCustomOverrides(review))
                .filter(([path]) => selectedPathSet.has(path))
                .map(([path, override]) => ({ path, title: override.title, artist: override.artist }));
            const cleanupNoun = cfg.cleanupNoun || 'metadata cleanup';
            const applyingAll = apply && scope === 'all_candidates';
            const demo = axiomReviewMode() === 'health' && review.samples?.some(track => track.health_review_cleanup_fixture);
            if (applyingAll && !demo) {
                setAxiomButtonBusy(triggerBtn, true, 'Checking...');
                try {
                    const response = await fetch('/api/library/utility_metadata_preview', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ category, excluded_paths: excludedPaths, expected_values: expectedValues })
                    });
                    const plan = await response.json();
                    if (!response.ok || plan.success === false) {
                        const error = new Error(plan.error || 'Refresh this review.');
                        error.reviewRequired = Boolean(plan.review_required);
                        throw error;
                    }
                    if (currentHealthCleanupReview !== review) return;
                    const expectedByPath = new Map((plan.expected_values || []).map(row => [row.path, row]));
                    // Selected custom proposals retain their exact reviewed before values.
                    expectedValues.forEach(row => { if (customOverrides.some(edit => edit.path === row.path)) expectedByPath.set(row.path, row); });
                    expectedValues = [...expectedByPath.values()];
                    paths = expectedValues.map(row => row.path);
                    rulesSignature = plan.review_rules_signature;
                } catch (error) {
                    showHealthCleanupReviewFailure(error, category, review);
                    return;
                } finally { setAxiomButtonBusy(triggerBtn, false); }
            }
            if (!paths.length && !demo) return showToast(`No ${cleanupNoun} tracks are selected.`, true);

            const targetCount = demo && applyingAll ? review.total : paths.length;
            const confirmed = await showAxiomConfirm(
                apply ? (applyingAll ? `Apply All ${cfg.label}` : `Apply Selected ${cfg.label}`) : 'Undo Last Cleanup Batch',
                apply
                    ? (applyingAll
                        ? `Clean all ${targetCount.toLocaleString()} detected ${cleanupNoun} candidates inside AXIOM cache only? Source audio and Serato stay untouched.`
                        : `Clean the selected ${targetCount.toLocaleString()} ${cleanupNoun} track${targetCount === 1 ? '' : 's'} inside AXIOM cache only? Source audio and Serato stay untouched.`)
                    : `Undo the last saved batch for ${targetCount.toLocaleString()} ${cleanupNoun} track${targetCount === 1 ? '' : 's'}? Their values from immediately before that batch will be restored. Source audio stays untouched.`,
                apply ? (applyingAll ? 'CLEAN ALL CANDIDATES' : 'CLEAN SELECTED') : 'UNDO LAST BATCH',
                'primary',
                'metadata'
            );
            if (!confirmed) return;

            if (axiomReviewMode() === 'health' && review.samples?.some(track => track.health_review_cleanup_fixture)) {
                return runHealthReviewMetadataCleanupDemo(category, apply, scope, triggerBtn);
            }

            showToast(apply ? (applyingAll ? 'Cleaning all display metadata in AXIOM cache...' : 'Cleaning display metadata in AXIOM cache...') : 'Restoring display metadata...');
            setAxiomButtonBusy(triggerBtn, true, apply ? 'Applying...' : 'Restoring...');
            try {
                const resp = await fetch('/api/library/utility_metadata_cleanup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ category, paths, apply, scope, excluded_paths: apply ? excludedPaths : [],
                        custom_overrides: apply ? customOverrides : [],
                        expected_values: apply ? expectedValues : undefined,
                        review_rules_signature: apply ? rulesSignature : undefined,
                        batch_id: apply ? undefined : review.receiptBatchId })
                });
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok || data.success === false) {
                    const error = new Error(data.error || data.message || 'Metadata cleanup failed');
                    error.reviewRequired = Boolean(data.review_required);
                    throw error;
                }
                showToast(data.message || 'Metadata cleanup updated. Source audio untouched.');
                currentHealthCleanupAudit = null;
                healthCleanupAuditLoadedAt = 0;
                const completedSamples = (data.tracks || []).map(track => ({
                    path: track.path, title: track.before?.title || '', artist: track.before?.artist || '',
                    cleanup_preview: { title: track.title || '', artist: track.artist || '' }
                }));
                review.receiptPaths = apply ? completedSamples.map(track => track.path) : [];
                review.receiptBatchId = apply ? data.batch_id : '';
                if (apply) {
                    recordAxiomSessionActivity(category === 'artist_format' ? 'artist' : 'title', Number(data.count || 0), {
                        key: `cleanup:${category}:${Date.now()}`,
                        trackIds: completedSamples.map(track => track.path).filter(Boolean),
                    });
                }
                const nextAudit = await loadHealthUtilityAudit({ force: true, afterCurrent: true });
                const remainingValue = nextAudit?.summary?.[category];
                const remaining = remainingValue == null ? NaN : Number(remainingValue);
                renderHealthMetadataCleanupReceipt(category, completedSamples, {
                    applied: apply,
                    count: Number(data.count || 0),
                    checked: targetCount,
                    pending: Number.isFinite(remaining) ? Math.max(0, remaining) : null,
                    remainingVerified: Number.isFinite(remaining),
                    demo: false,
                    serverValues: true,
                    batch_id: apply ? data.batch_id : '',
                });
                loadLibraryStats();
            } catch (err) {
                showHealthCleanupReviewFailure(err, category, review);
            } finally {
                setAxiomButtonBusy(triggerBtn, false);
            }
        };
    }

    if (typeof window.setHealthUtilityNameCleanupForReview !== 'function') {
        window.setHealthUtilityNameCleanupForReview = async function (category, apply = true, scope = 'sample', triggerBtn = null) {
            return setHealthUtilityMetadataCleanupForReview(category, apply, scope, triggerBtn);
        };
    }

    if (typeof window.setHealthUtilityExclusionForReview !== 'function') {
        window.setHealthUtilityExclusionForReview = async function (category, excluded = true, triggerBtn = null) {
            const cfg = HEALTH_CLEANUP_CATEGORIES[category];
            const review = currentHealthCleanupReview;
            if (!cfg?.canExclude || !review || review.category !== category) return;
            const paths = (review.samples || []).map(track => track.path).filter(Boolean);
            if (!paths.length) return showToast('No utility review sample is selected.', true);
            const confirmed = await showAxiomConfirm(
                excluded ? 'Exclude Utility Sample' : 'Restore Utility Sample',
                excluded
                    ? `Hide these ${paths.length} reviewed ${cfg.label.toLowerCase()} from normal Studio set-building? They will stay in Library and source audio stays untouched.`
                    : `Restore these ${paths.length} reviewed ${cfg.label.toLowerCase()} to normal Studio set-building? Source audio stays untouched.`,
                excluded ? 'EXCLUDE SAMPLE' : 'RESTORE SAMPLE',
                excluded ? 'primary' : 'primary'
            );
            if (!confirmed) return;
            setAxiomButtonBusy(triggerBtn, true, excluded ? 'Excluding...' : 'Restoring...');
            showToast(excluded ? 'Excluding utility sample from set-building...' : 'Restoring utility sample...');
            try {
                const resp = await fetch('/api/library/utility_exclusion', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ category, paths, excluded })
                });
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok || data.success === false) throw new Error(data.error || data.message || 'Utility exclusion failed');
                showToast(data.message || 'Utility review updated. Source audio untouched.');
                currentHealthCleanupAudit = null;
                healthCleanupAuditLoadedAt = 0;
                reviewHealthUtilityCategory(category);
                loadLibraryStats();
            } catch (err) {
                showToast(err.message || 'Utility exclusion failed', true);
            } finally {
                setAxiomButtonBusy(triggerBtn, false);
            }
        };
    }

    const HEALTH_ISSUE_META = {
        missing_file: {
            label: 'Missing Files',
            singular: 'missing file',
            description: 'AXIOM cannot find these tracks, so they can break previews, exports, and live set decisions.'
        },
        missing_bpm: {
            label: 'Missing BPM',
            singular: 'BPM issue',
            description: 'These tracks need tempo intelligence before AXIOM can trust them for set order, half-time moves, and live recommendations.'
        },
        missing_key: {
            label: 'Missing Key',
            singular: 'key issue',
            description: 'These tracks are missing harmonic key data, so AXIOM has less confidence when planning cleaner transitions.'
        },
        missing_year: {
            label: 'Missing Year',
            singular: 'year issue',
            description: 'Check a suggestion or enter the year you know. Save once to keep the correction in AXIOM.'
        }
    };

    const HEALTH_ISSUE_GUIDANCE = {
        missing_file: {
            why: 'A missing file can look usable until you need to preview, export, or play it.',
            next: 'Reconnect the drive first. Remove from AXIOM only when the track is truly gone.'
        },
        missing_bpm: {
            why: 'BPM is the backbone for build-ups, resets, half-time, and safe live jumps.',
            next: 'Scan BPM to check tags, Serato, djay Pro, filenames, and local audio analysis in one pass.'
        },
        missing_key: {
            why: 'Key helps AXIOM spot cleaner blends and avoid rough harmonic clashes.',
            next: 'Scan Keys to reuse DJ analysis first, then save AXIOM\'s strongest Camelot detection. Confidence never blocks assignment.'
        },
        missing_year: {
            why: 'Year lets AXIOM steer era, freshness, nostalgia, and age-sensitive crowds.',
            next: 'Scan a small batch and review the report before trusting era filters.'
        }
    };

    const HEALTH_REVIEW_META = {
        bpm_review: {
            label: 'BPM Review',
            prefix: 'bpm',
            issue: 'missing_bpm',
            description: 'AXIOM checked these files but could not confirm one stable BPM without guessing.'
        },
        key_review: {
            label: 'Key Review',
            prefix: 'key',
            issue: 'missing_key',
            description: 'AXIOM checked these files but could not confirm one reliable Camelot key without guessing.'
        }
    };

    function healthDetailGuidanceHtml(why = '', next = '') {
        const blocks = [
            ['Why it matters', why],
            ['Next move', next]
        ].filter(([, copy]) => copy);
        if (!blocks.length) return '';
        return `
            <div class="health-detail-guidance">
                ${blocks.map(([label, copy]) => `
                    <div class="health-detail-guidance-card">
                        <span>${escapeHtml(label)}</span>
                        <strong>${escapeHtml(copy)}</strong>
                    </div>
                `).join('')}
            </div>
        `;
    }

    function healthInboxIssueCount(key) {
        return Number(currentHealthSummary?.[key] || 0);
    }

    function healthInboxAttentionCount() {
        return Object.keys(HEALTH_ISSUE_META).filter(key => healthInboxIssueCount(key) > 0).length;
    }

    function healthInboxBlockerCount() {
        return Object.keys(HEALTH_ISSUE_META)
            .reduce((sum, key) => sum + healthInboxIssueCount(key), 0);
    }

    const HEALTH_REPAIR_TASK_ORDER = ['missing_file', 'missing_bpm', 'missing_key', 'missing_year'];

    function healthPendingRepairTaskKey(preferred = activeHealthInboxItem) {
        if (HEALTH_APPROVED_TASKS[preferred] && healthInboxIssueCount(preferred) > 0) return preferred;
        return HEALTH_REPAIR_TASK_ORDER.find(key => healthInboxIssueCount(key) > 0) || '';
    }

    function selectHealthInboxItem(item) {
        window.AxiomHealthCockpit?.selectItem(item);
        if (HEALTH_CLEANUP_CATEGORIES[item]?.canExclude) {
            activeHealthInboxItem = item;
            renderHealthInboxDetail();
            renderHealthApprovedSetCategory(item);
            return;
        }
        if (item === 'title_cleanup' || item === 'artist_format') {
            return openHealthMetadataReview(item);
        }
        activeHealthInboxItem = item;
        document.querySelectorAll('[data-health-item]').forEach(button => {
            button.classList.toggle('active', button.dataset.healthItem === item);
        });
        const workspace = {
            genres: 'organisation',
            title_cleanup: 'metadata',
            artist_format: 'metadata',
        }[item];
        if (workspace) setHealthWorkspaceGroupActive(workspace);
        renderHealthInboxDetail();
        renderHealthApprovedWorkspace();
        if (HEALTH_CLEANUP_CATEGORIES[item]) renderHealthApprovedSetCategory(item);
        document.getElementById('health-inbox-detail')?.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function openHealthMetadataReview(category, trigger = null, event = null) {
        window.AxiomHealthCockpit?.open('metadata');
        event?.stopPropagation?.();
        if (category !== 'title_cleanup' && category !== 'artist_format') return;
        setHealthWorkspaceGroupActive('metadata');
        if (activeHealthInboxItem === 'title_cleanup' || activeHealthInboxItem === 'artist_format') {
            activeHealthInboxItem = healthApprovedCurrentTaskKey();
        }
        return reviewHealthUtilityCategory(category, trigger);
    }

    function setHealthWorkspaceGroupActive(workspace) {
        window.AxiomHealthCockpit?.open(workspace);
        document.querySelectorAll('#health-approved-tools [data-health-workspace]').forEach(group => {
            const active = group.dataset.healthWorkspace === workspace;
            group.classList.toggle('active', active);
            group.tabIndex = active ? 0 : -1;
            if (active) group.setAttribute('aria-current', 'true');
            else group.removeAttribute('aria-current');
        });
    }

    function selectHealthWorkspaceGroup(workspace, group = null, event = null) {
        setHealthWorkspaceGroupActive(workspace);
        const selectedGroup = group || document.querySelector(`#health-approved-tools [data-health-workspace="${workspace}"]`);
        if (!event?.target?.closest?.('button')) selectedGroup?.focus({ preventScroll: true });
    }

    function handleHealthWorkspaceGroupKeydown(event) {
        const direction = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
        if (!direction) return;
        const groups = Array.from(document.querySelectorAll('#health-approved-tools [data-health-workspace]'));
        const currentGroup = event.currentTarget?.closest?.('[data-health-workspace]');
        const currentIndex = groups.indexOf(currentGroup);
        if (currentIndex < 0 || groups.length < 2) return;
        event.preventDefault();
        event.stopPropagation();
        const nextIndex = (currentIndex + direction + groups.length) % groups.length;
        const nextGroup = groups[nextIndex];
        selectHealthWorkspaceGroup(nextGroup.dataset.healthWorkspace, nextGroup);
    }

    function openHealthInboxWorkspace(item) {
        if (window.AxiomHealthCockpit) {
            selectHealthInboxItem(item);
            document.querySelector('#health-cockpit details[open] #health-inbox-detail')?.scrollIntoView({behavior: 'smooth', block: 'nearest'});
            return;
        }
        const tools = document.getElementById('health-approved-tools');
        if (!tools) return;
        tools.classList.remove('hidden');
        selectHealthInboxItem(item);
        const selectedTask = tools.querySelector(`[data-health-item="${item}"]`);
        const reviewDetail = HEALTH_REVIEW_META[item]
            ? document.getElementById('health-inbox-detail')
            : null;
        const scrollTarget = selectedTask || reviewDetail || tools;
        const healthView = document.getElementById('health-view');
        if (healthView) {
            const targetTop = reviewDetail
                ? tools.offsetTop + reviewDetail.offsetTop
                : tools.offsetTop;
            healthView.scrollTop = Math.max(0, targetTop - 12);
        } else {
            scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        selectedTask?.focus();
    }

    const HEALTH_APPROVED_TASKS = {
        missing_file: {
            title: 'Missing Files',
            copy: 'Reconnect moved music before relying on previews, exports, or live set decisions.',
            action: 'Reconnect Music',
            tone: 'danger',
        },
        missing_bpm: {
            title: 'Missing BPM',
            copy: 'Accurate tempo helps AXIOM build safer movement, cleaner set flow, and more reliable Performance suggestions.',
            action: 'Review BPM Queue',
            tone: '',
        },
        missing_key: {
            title: 'Missing Key',
            copy: 'Accurate keys help create smoother mixes, better harmonic transitions, and more reliable set suggestions.',
            action: 'Review Key Queue',
            tone: 'key',
        },
        missing_year: {
            title: 'Missing Year',
            copy: 'Release year tightens era control, freshness decisions, and the timeline of the set.',
            action: 'Review Year Queue',
            tone: 'year',
        },
    };

    function healthApprovedCurrentTaskKey() {
        return healthPendingRepairTaskKey() || 'missing_bpm';
    }

    function healthApprovedTrackTotalText() {
        return document.getElementById('health-inbox-track-total')?.textContent?.trim() || '0';
    }

    function resetHealthReadinessActions() {
        const primary = document.getElementById('health-prepare-library');
        const secondary = document.getElementById('health-readiness-secondary');
        const rerun = document.getElementById('health-readiness-rerun');
        const lastReceipt = document.getElementById('health-readiness-last-receipt');
        const nextCopy = document.getElementById('health-readiness-next-copy');
        if (primary) {
            primary.dataset.healthAction = 'scan';
            delete primary.dataset.healthTarget;
        }
        if (secondary) {
            secondary.dataset.healthAction = 'plan';
            delete secondary.dataset.healthTarget;
            secondary.textContent = 'Review Repair Plan';
        }
        rerun?.classList.add('hidden');
        lastReceipt?.classList.toggle('hidden', !(healthScanReceiptDismissed && healthJobHasFinished(lastUnifiedHealthJob)));
        nextCopy?.classList.add('hidden');
        setHealthText('health-stat-total-label', 'repairs ready');
    }

    function healthJobHasFinished(job = null) {
        return ['complete', 'needs_review', 'no_work', 'stopped', 'failed', 'error']
            .includes(String(job?.status || '').toLowerCase());
    }

    function healthPresentedJob() {
        return healthScanReceiptDismissed && healthJobHasFinished(lastUnifiedHealthJob)
            ? null
            : lastUnifiedHealthJob;
    }

    function dismissHealthScanReceipt() {
        if (!healthJobHasFinished(lastUnifiedHealthJob)) return;
        healthScanReceiptDismissed = true;
        resetHealthReadinessActions();
        renderHealthApprovedWorkspace();
        resetHealthViewScroll();
    }

    function restoreHealthScanReceipt() {
        if (!healthJobHasFinished(lastUnifiedHealthJob)) return;
        healthScanReceiptDismissed = false;
        renderHealthApprovedWorkspace();
        resetHealthViewScroll();
        window.AxiomHealthCockpit?.sessionTab('receipt');
    }

    function focusHealthReceipt() {
        window.AxiomHealthCockpit?.sessionTab('receipt');
        setHealthApprovedResultsTab('completed');
        document.querySelector('.health-approved-results')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function handleHealthReadinessPrimary(button = null) {
        const action = button?.dataset?.healthAction || 'scan';
        if (action === 'refresh') return startUnifiedHealthScan(['missing_bpm', 'missing_key', 'missing_year'], button);
        if (action === 'studio') return showStudioLaunchView({ allowReviewNavigation: true });
        if (action === 'workspace') return openHealthInboxWorkspace(button?.dataset?.healthTarget || healthApprovedCurrentTaskKey());
        if (action === 'plan') return reviewHealthPreparationPlan();
        if (action === 'receipt') return focusHealthReceipt();
        return startUnifiedHealthScan(['missing_bpm', 'missing_key', 'missing_year'], button);
    }

    function handleHealthReadinessSecondary(button = null) {
        const action = button?.dataset?.healthAction || 'plan';
        if (action === 'workspace') return openHealthInboxWorkspace(button?.dataset?.healthTarget || healthApprovedCurrentTaskKey());
        if (action === 'receipt') return focusHealthReceipt();
        return reviewHealthPreparationPlan();
    }

    function renderHealthPreparationPlan(snapshot = {}, trackCount = 0) {
        const panel = document.getElementById('health-readiness-plan');
        const lanes = document.getElementById('health-readiness-plan-lanes');
        const start = document.getElementById('health-readiness-plan-start');
        if (!panel || !lanes || !start) return;
        const entries = [
            { key: 'missing_bpm', label: 'Missing BPM', count: Number(snapshot.missing_bpm || 0), note: 'Check for a trusted tempo' },
            { key: 'missing_key', label: 'Missing Key', count: Number(snapshot.missing_key || 0), note: 'Check for a trusted Camelot key' },
            { key: 'missing_year', label: 'Missing Year', count: Number(snapshot.missing_year || 0), note: 'Find and save release year' },
            { key: 'bpm_review', label: 'BPM Review', count: Number(snapshot.bpm_review || 0), note: 'Needs your decision; separate from repairs' },
            { key: 'key_review', label: 'Key Review', count: Number(snapshot.key_review || 0), note: 'Needs your decision; separate from repairs' },
            { key: 'missing_file', label: 'Missing Files', count: Number(snapshot.missing_file || 0), note: 'Reconnect before repair' },
        ].filter(entry => entry.count > 0);
        const repairCount = Math.max(0, Number(snapshot.repair_ready || 0));
        const reviewCount = Math.max(0, Number(snapshot.review_ready || 0));
        const missingFiles = Math.max(0, Number(snapshot.missing_file || 0));
        const separate = [
            reviewCount > 0 ? `${reviewCount.toLocaleString()} review decision${reviewCount === 1 ? '' : 's'}` : '',
            missingFiles > 0 ? `${missingFiles.toLocaleString()} missing file${missingFiles === 1 ? '' : 's'}` : '',
        ].filter(Boolean).join(' and ');
        const blockerCount = entries.reduce((total, entry) => total + entry.count, 0);
        const summary = document.getElementById('health-readiness-plan-summary');
        if (summary) {
            summary.textContent = blockerCount > 0
                ? `${repairCount.toLocaleString()} repair check${repairCount === 1 ? '' : 's'} ready across ${Number(trackCount || 0).toLocaleString()} track${Number(trackCount) === 1 ? '' : 's'}.${separate ? ` Separate attention: ${separate}.` : ''}`
                : 'No preparation fixes are waiting in the current Health snapshot.';
        }
        lanes.innerHTML = entries.map(entry => `
            <div class="health-readiness-plan-lane ${entry.key}">
                <span>${escapeHtml(entry.label)}</span>
                <strong>${entry.count.toLocaleString()}</strong>
                <small>${escapeHtml(entry.note)}</small>
            </div>
        `).join('') || '<div class="health-readiness-plan-empty">Your current Health snapshot is clear.</div>';
        start.disabled = repairCount <= 0;
        start.textContent = repairCount > 0
            ? `Start ${repairCount.toLocaleString()} Repair${repairCount === 1 ? '' : 's'}`
            : snapshot.missing_file > 0 ? 'Reconnect Missing Files First' : snapshot.review_ready > 0 ? 'Review Decisions Needed' : 'Library Health Up To Date';
    }

    function closeHealthPreparationPlan(restoreFocus = true) {
        const panel = document.getElementById('health-readiness-plan');
        if (!panel) return;
        panel.classList.add('hidden');
        panel.setAttribute('aria-hidden', 'true');
        if (restoreFocus) document.getElementById('health-readiness-secondary')?.focus();
    }

    function startHealthPreparationFromPlan(button = null) {
        closeHealthPreparationPlan(false);
        return startUnifiedHealthScan('', button);
    }

    function renderHealthApprovedWorkspace() {
        if (!document.getElementById('health-approved-improvements')) return;
        if (!healthHasAuthoritativeSnapshot()) {
            renderHealthSnapshotPendingState();
            return;
        }
        const shell = document.getElementById('health-inbox-app');
        if (shell) {
            shell.dataset.healthSnapshotState = healthSnapshotState;
            shell.dataset.healthHasSnapshot = 'true';
            shell.setAttribute('aria-busy', healthSnapshotState === 'loading' ? 'true' : 'false');
        }
        document.querySelectorAll('.health-approved-lanes [data-health-item]').forEach(button => {
            button.disabled = false;
        });
        const snap = healthSummarySnapshot(currentHealthSummary);
        setHealthText('health-approved-improvements', snap.repair_ready.toLocaleString());
        setHealthText('health-approved-improvements-label', snap.repair_ready === 1 ? 'repair' : 'repairs');
        setHealthText('health-stat-total', snap.repair_ready.toLocaleString());
        setHealthText('health-stat-total-label', 'repairs ready');
        setHealthText('health-inbox-attention-count', snap.review_ready.toLocaleString());
        setHealthText('health-inbox-attention-label', snap.review_ready === 1 ? 'needs your review' : 'need your review');
        setHealthText('health-inbox-last-checked', healthSnapshotState === 'loading'
            ? 'refreshing now'
            : lastHealthCheckAt ? 'today, just now' : 'not yet');
        setHealthText('health-stat-missing-file', snap.missing_file.toLocaleString());
        setHealthText('health-repair-bpm-count', snap.bpm_attention.toLocaleString());
        setHealthText('health-repair-key-count', snap.key_attention.toLocaleString());
        setHealthText('health-repair-year-count', snap.missing_year.toLocaleString());
        const readinessTrackCount = Math.max(
            0,
            Number(currentHealthSummary?.health_unique_affected_tracks || 0),
            new Set((currentHealthTracks || []).map(track => String(track?.path || '')).filter(Boolean)).size
        );
        renderHealthPreparationPlan(snap, readinessTrackCount);
        const presentedJob = healthPresentedJob();
        const readinessJobStatus = String(presentedJob?.status || '').toLowerCase();
        const readinessJobActive = unifiedHealthIsActive(presentedJob || {});
        const readinessJobFinished = healthJobHasFinished(presentedJob);
        if (!readinessJobActive && !readinessJobFinished) {
            const repairTitle = `${snap.repair_ready.toLocaleString()} Repair${snap.repair_ready === 1 ? '' : 's'}`;
            const reviewTitle = `${snap.review_ready.toLocaleString()} Review${snap.review_ready === 1 ? '' : 's'}`;
            const reconnectTitle = `${snap.missing_file.toLocaleString()} Missing Track${snap.missing_file === 1 ? '' : 's'}`;
            const readinessTitle = snap.repair_ready > 0 && snap.review_ready > 0
                ? `${repairTitle} + ${reviewTitle}`
                : snap.repair_ready > 0
                    ? `${repairTitle} Ready`
                    : snap.review_ready > 0
                        ? `${reviewTitle} Needs You`
                        : snap.missing_file > 0
                            ? `Reconnect ${reconnectTitle}`
                            : 'Your Library Is Healthy';
            const readinessParts = [];
            if (snap.repair_ready > 0) readinessParts.push(`${snap.repair_ready.toLocaleString()} can be repaired now`);
            if (snap.review_ready > 0) readinessParts.push(`${snap.review_ready.toLocaleString()} ${snap.review_ready === 1 ? 'needs' : 'need'} your DJ decision`);
            if (snap.missing_file > 0) readinessParts.push(`${snap.missing_file.toLocaleString()} ${snap.missing_file === 1 ? 'needs' : 'need'} reconnecting`);
            setHealthText('health-readiness-title', readinessTitle);
            setHealthText('health-readiness-copy', readinessParts.length
                ? `Across ${readinessTrackCount.toLocaleString()} affected track${readinessTrackCount === 1 ? '' : 's'}, ${readinessParts.join(', ')}. Review the plan before AXIOM starts.`
                : 'No issues found in your last Health check. Check again whenever you need.');
        }
        const prepareButton = document.getElementById('health-prepare-library');
        const secondaryButton = document.getElementById('health-readiness-secondary');
        if (prepareButton) {
            if (!readinessJobFinished) resetHealthReadinessActions();
            if (healthSnapshotState === 'loading') {
                prepareButton.disabled = true;
                prepareButton.textContent = 'Checking Health';
            } else if (readinessJobActive) {
                prepareButton.disabled = true;
                prepareButton.textContent = 'Fixing Health';
            } else if (!readinessJobFinished) {
                prepareButton.disabled = healthSnapshotState === 'loading';
                if (snap.repair_ready > 0) {
                    prepareButton.dataset.healthAction = 'plan';
                    delete prepareButton.dataset.healthTarget;
                    prepareButton.textContent = 'Fix Health';
                } else if (snap.missing_file > 0) {
                    prepareButton.dataset.healthAction = 'workspace';
                    prepareButton.dataset.healthTarget = 'missing_file';
                    prepareButton.textContent = 'Fix Health';
                } else if (snap.review_ready > 0) {
                    prepareButton.dataset.healthAction = 'workspace';
                    prepareButton.dataset.healthTarget = snap.bpm_review > 0 ? 'bpm_review' : 'key_review';
                    prepareButton.textContent = 'Fix Health';
                } else {
                    prepareButton.dataset.healthAction = 'refresh';
                    delete prepareButton.dataset.healthTarget;
                    prepareButton.textContent = 'Check Health Again';
                }
            }
        }
        if (secondaryButton && !readinessJobFinished) {
            const showReviewAction = snap.review_ready > 0 && (snap.repair_ready > 0 || snap.missing_file > 0);
            secondaryButton.classList.toggle('hidden', !showReviewAction);
            if (showReviewAction) {
                secondaryButton.dataset.healthAction = 'workspace';
                secondaryButton.dataset.healthTarget = snap.bpm_review > 0 ? 'bpm_review' : 'key_review';
                secondaryButton.textContent = `Review ${snap.review_ready.toLocaleString()} Track${snap.review_ready === 1 ? '' : 's'}`;
            }
        }

        const taskKey = healthApprovedCurrentTaskKey();
        const task = HEALTH_APPROVED_TASKS[taskKey];
        const count = Number(currentHealthSummary?.[taskKey] || 0);
        setHealthText('health-approved-task-title', task.title);
        setHealthText('health-approved-task-count', `${count.toLocaleString()} Item${count === 1 ? '' : 's'}`);
        setHealthText('health-approved-task-copy', task.copy);
        const action = document.getElementById('health-approved-task-action');
        if (action) {
            action.disabled = false;
            action.textContent = count > 0 ? task.action : 'Refresh Health';
            action.className = `health-approved-primary ${count > 0 ? task.tone : ''}`.trim();
        }

        document.querySelectorAll('.health-approved-lanes [data-health-item]').forEach(button => {
            button.classList.toggle('active', button.dataset.healthItem === taskKey);
        });
        renderHealthApprovedResults();
        renderHealthApprovedWorking(presentedJob || null);
        renderHealthNewMusicIntake();
    }

    async function runHealthApprovedSelectedAction() {
        const taskKey = healthApprovedCurrentTaskKey();
        const count = Number(currentHealthSummary?.[taskKey] || 0);
        if (!count) return runLibraryHealthCheck({ force: true });
        if (taskKey === 'missing_file') return relocateLibrary();
        const triggerBtn = document.getElementById('health-approved-task-action');
        return runHealthLaneScan(taskKey, triggerBtn);
    }

    function handleHealthApprovedLaneClick(lane, event, triggerBtn = null) {
        const reviewLane = { missing_bpm: 'bpm_review', missing_key: 'key_review' }[lane];
        if (reviewLane && healthInboxIssueCount(lane) === 0 && healthInboxIssueCount(reviewLane) > 0) {
            selectHealthInboxItem(reviewLane);
            return;
        }
        selectHealthInboxItem(lane);
        if (!triggerBtn && event && event.currentTarget) {
            triggerBtn = event.currentTarget;
        }
        return runHealthLaneScan(lane, triggerBtn);
    }

    function toggleHealthApprovedChecks() {
        const detail = document.getElementById('health-approved-checks');
        const icon = document.getElementById('health-approved-checks-chevron');
        if (!detail) return;
        const opening = detail.classList.contains('hidden');
        detail.classList.toggle('hidden', !opening);
        if (icon) icon.src = opening ? '/static/icons/chevron-up.svg' : '/static/icons/chevron-down.svg';
    }

    function toggleHealthApprovedTools(forceOpen = null) {
        if (window.AxiomHealthCockpit) return window.AxiomHealthCockpit.open('organisation', {scroll: forceOpen !== false});
        const tools = document.getElementById('health-approved-tools');
        if (!tools) return;
        tools.classList.remove('hidden', 'collapsed');
        renderHealthInboxDetail();
        if (forceOpen !== false) tools.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function reviewHealthPreparationPlan() {
        const panel = document.getElementById('health-readiness-plan');
        if (!panel) return;
        panel.classList.remove('hidden');
        panel.setAttribute('aria-hidden', 'false');
        panel.focus({ preventScroll: true });
    }

    function toggleHealthApprovedSetBuilding(forceOpen = null) {
        const detail = document.getElementById('health-approved-set-detail');
        const icon = document.getElementById('health-approved-set-chevron');
        const toggle = document.querySelector('.health-approved-set-summary');
        if (!detail) return;
        const opening = forceOpen === null ? detail.classList.contains('hidden') : Boolean(forceOpen);
        detail.classList.toggle('hidden', !opening);
        toggle?.setAttribute('aria-expanded', opening ? 'true' : 'false');
        if (icon) icon.src = opening ? '/static/icons/chevron-up.svg' : '/static/icons/chevron-down.svg';
        if (opening) {
            const category = HEALTH_CLEANUP_CATEGORIES[activeHealthInboxItem]?.canExclude ? activeHealthInboxItem : 'stingers';
            activeHealthInboxItem = category;
            renderHealthInboxDetail();
            document.querySelectorAll('.health-approved-set-tabs [data-health-item]').forEach(button => {
                button.classList.toggle('active', button.dataset.healthItem === category);
            });
            renderHealthApprovedSetCategory(category);
        }
    }

    const healthSetReview = {category: '', view: 'pending', offset: 0, data: null, selected: new Set(), all: false, request: 0, busy: false, receipt: '', demo: null, reviewing: false};

    function healthSetIsDemo() {
        return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname) && axiomReviewMode() === 'health';
    }

    function healthSetDemoRows() {
        if (!healthSetReview.demo) {
            healthSetReview.demo = [
                ...Array.from({length: 28}, (_, i) => ({category: 'sound_effects', title: `${i % 2 ? 'Snare' : 'Kick'} ${String(i + 1).padStart(3, '0')}`, artist: 'Demo sample pack', duration_sec: 2, audit_reason: 'Short drum hit · 0:02 long'})),
                {category: 'stingers', title: 'Station ID — Evening Show', artist: 'Demo DJ', duration_sec: 9, audit_reason: 'Title includes “station id” · 0:09 long'},
                {category: 'transitions', title: 'Club Bridge (128 to 100 BPM Transition)', artist: 'Demo DJ', duration_sec: 185, audit_reason: 'Title lists a BPM change: 128 → 100. Listen to confirm.'},
                {category: 'mixtapes', title: 'Saturday Night DJ Mix', artist: 'Demo DJ', duration_sec: 3600, audit_reason: 'Title includes “DJ mix” · 60:00 long'},
            ].map((row, i) => ({...row, path: `/tmp/axiom-tool-review-${i}.mp3`, state: 'pending'}));
        }
        return healthSetReview.demo;
    }

    function healthSetDemoPage(category, view, offset) {
        const all = healthSetDemoRows();
        const counts = {};
        for (const key of ['stingers', 'transitions', 'sound_effects', 'mixtapes']) {
            counts[key] = {pending: 0, excluded: 0, kept: 0};
            all.filter(r => r.category === key && r.state !== 'removed').forEach(r => counts[key][r.state]++);
        }
        const rows = all.filter(r => r.category === category && r.state === view);
        offset = Math.max(0, Math.min(offset, rows.length ? Math.floor((rows.length - 1) / 25) * 25 : 0));
        return {category, view, offset, total: rows.length, limit: 25, rows: rows.slice(offset, offset + 25), counts, demo: true};
    }

    async function renderHealthApprovedSetCategory(category, view = 'pending', offset = 0) {
        if (!HEALTH_CLEANUP_CATEGORIES[category]?.canExclude || healthSetReview.busy) return;
        const content = document.getElementById('health-approved-set-content');
        if (!content) return;
        const version = ++healthSetReview.request;
        Object.assign(healthSetReview, {category, view, offset, data: null, all: false, selected: new Set()});
        content.setAttribute('aria-busy', 'true');
        content.textContent = 'Checking your library for this category…';
        try {
            let data;
            if (healthSetIsDemo()) data = healthSetDemoPage(category, view, offset);
            else {
                const response = await fetch(`/api/library/utility_audit?category=${encodeURIComponent(category)}&view=${view}&offset=${offset}`, {cache: 'no-store'});
                data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Unable to load review.');
            }
            if (version !== healthSetReview.request) return;
            healthSetReview.data = data;
            healthSetReview.offset = data.offset;
            drawHealthSetReview();
        } catch (error) {
            if (version !== healthSetReview.request) return;
            content.textContent = `${error.message} Choose the category again to retry.`;
        } finally { if (version === healthSetReview.request) content.setAttribute('aria-busy', 'false'); }
    }

    function drawHealthSetReview() {
        const s = healthSetReview, data = s.data;
        const content = document.getElementById('health-approved-set-content');
        if (!data || !content) return;
        const config = HEALTH_CLEANUP_CATEGORIES[s.category];
        const counts = data.counts[s.category];
        let totalPending = 0;
        for (const [category, totals] of Object.entries(data.counts)) {
            totalPending += totals.pending;
            const node = document.getElementById(HEALTH_CLEANUP_CATEGORIES[category].countId);
            if (node) node.textContent = totals.pending.toLocaleString();
            if (currentHealthCleanupAudit?.summary) {
                currentHealthCleanupAudit.summary[category] = totals.pending + totals.excluded;
                currentHealthCleanupAudit.excluded ??= {};
                currentHealthCleanupAudit.excluded[category] = totals.excluded;
            }
        }
        setHealthText('health-inbox-set-building-count', totalPending.toLocaleString());
        document.querySelectorAll('.health-approved-set-tabs [data-health-item]').forEach(button => {
            const active = button.dataset.healthItem === s.category;
            button.classList.toggle('active', active);
            button.setAttribute('aria-selected', String(active));
        });
        const selectedCount = s.all ? data.total : s.selected.size;
        const disabled = s.busy ? 'disabled' : '';
        const action = (label, value, index = null) => `<button type="button" ${disabled} onclick="applyHealthSetDecision('${value}', ${index === null ? 'null' : index})">${label}</button>`;
        const bulkDisabled = !selectedCount || s.busy ? 'disabled' : '';
        content.innerHTML = `
            <div class="health-set-intro"><h4>${escapeHtml(config.label)}</h4><p>${escapeHtml(config.description)}</p></div>
            ${data.demo ? '<p class="health-set-demo">Local preview · example tracks only. No library or music files change.</p>' : ''}
            <div class="health-set-views" aria-label="Review status">
                ${[['pending', 'To review'], ['excluded', 'Hidden from sets'], ['kept', 'Kept as songs']].map(([view, label]) => `<button type="button" ${disabled} aria-pressed="${s.view === view}" onclick="renderHealthApprovedSetCategory('${s.category}', '${view}')">${label} <b>${counts[view].toLocaleString()}</b></button>`).join('')}
                <button type="button" ${disabled} onclick="healthSetOpenRestoreBin()">Restore Bin</button>
            </div>
            ${s.receipt ? `<p class="health-set-receipt" role="status">${escapeHtml(s.receipt)}</p>` : ''}
            ${s.view === 'pending' && data.total ? `<div class="health-set-quick"><div><strong>${data.total.toLocaleString()} ${data.total === 1 ? 'track' : 'tracks'} found</strong><p>Remove this category from AXIOM in one go. Your music files stay on disk.</p></div><button class="health-set-primary" type="button" ${disabled} onclick="healthSetRemoveCategory()">Remove all ${data.total.toLocaleString()} from AXIOM</button></div>` : ''}
            ${data.rows.length ? `<details class="health-set-individual" ${s.reviewing ? 'open' : ''} ontoggle="healthSetReview.reviewing = this.open"><summary>Review tracks first (optional) · ${data.total.toLocaleString()}</summary><div class="health-set-selection">
                <label><input type="checkbox" ${disabled} ${data.rows.every(r => s.all || s.selected.has(r.path)) ? 'checked' : ''} onchange="healthSetSelectPage(this.checked)"> Select this page (${data.rows.length})</label>
                ${s.view === 'pending' && data.total > data.rows.length ? `<button type="button" ${disabled} onclick="healthSetSelectAll()">Select all ${data.total.toLocaleString()} in this category</button>` : ''}
                <strong>${selectedCount.toLocaleString()} selected</strong>
                <button type="button" ${disabled} onclick="healthSetSelectPage(false)">Clear selection</button>
            </div>
            <div class="health-set-bulk">
                ${s.view === 'pending' ? `<button type="button" ${bulkDisabled} onclick="applyHealthSetDecision('keep')">Keep selected as songs</button><button type="button" ${bulkDisabled} onclick="applyHealthSetDecision('exclude')">Hide selected from sets</button>` : ''}
                ${s.view === 'excluded' ? `<button type="button" ${bulkDisabled} onclick="applyHealthSetDecision('restore')">Restore selected to sets</button>` : ''}
                ${s.view === 'kept' ? `<button type="button" ${bulkDisabled} onclick="applyHealthSetDecision('reset')">Review selected again</button>` : `<button class="health-set-remove" type="button" ${bulkDisabled} onclick="applyHealthSetDecision('remove')">Remove selected from AXIOM</button>`}
            </div>
            <div class="health-set-rows">${data.rows.map((row, index) => `<article class="health-set-row">
                <label class="health-set-track"><input type="checkbox" ${disabled} ${s.all || s.selected.has(row.path) ? 'checked' : ''} aria-label="Select ${escapeHtml(row.title)}" onchange="healthSetSelectRow(${index}, this.checked)"><span><strong>${escapeHtml(row.title)}</strong><span>${escapeHtml(row.artist)}</span></span></label>
                <p class="health-set-reason">${escapeHtml(row.audit_reason)}</p>
                <details class="health-set-path"><summary>File location</summary><p>${escapeHtml(row.path)}</p></details>
                <div class="health-set-row-actions">
                    <button type="button" ${disabled} onclick="healthSetListen(${index})">Listen</button>
                    ${s.view === 'pending' ? action('Keep as song', 'keep', index) + action('Hide from sets', 'exclude', index) : s.view === 'excluded' ? action('Restore to sets', 'restore', index) : action('Review again', 'reset', index)}
                    ${s.view !== 'kept' ? action('Remove from AXIOM', 'remove', index) : ''}
                </div>
            </article>`).join('')}</div>
            <div class="health-set-pages"><button type="button" ${s.busy || !data.offset ? 'disabled' : ''} onclick="renderHealthApprovedSetCategory('${s.category}', '${s.view}', ${Math.max(0, data.offset - data.limit)})">Previous</button><span>${data.offset + 1}–${data.offset + data.rows.length} of ${data.total.toLocaleString()}</span><button type="button" ${s.busy || data.offset + data.rows.length >= data.total ? 'disabled' : ''} onclick="renderHealthApprovedSetCategory('${s.category}', '${s.view}', ${data.offset + data.limit})">Next</button></div></details>` : `<div class="health-set-empty"><strong>${s.view === 'pending' ? 'Nothing left to review here.' : 'No tracks in this list.'}</strong><p>${s.view === 'pending' ? 'Choose another category, or check your hidden and kept tracks above.' : 'Your saved choices will appear here.'}</p></div>`}
            <p class="health-set-safety">Hide from sets keeps a track in Library. Remove from AXIOM moves its library entry to Restore Bin. Neither action deletes your music file or changes your DJ software.</p>`;
    }

    function healthSetRemoveCategory() {
        healthSetReview.all = true;
        return applyHealthSetDecision('remove');
    }

    function healthSetSelectPage(checked) {
        healthSetReview.all = false;
        healthSetReview.selected = new Set(checked ? healthSetReview.data.rows.map(r => r.path) : []);
        drawHealthSetReview();
    }
    function healthSetSelectAll() { healthSetReview.all = true; drawHealthSetReview(); }
    function healthSetSelectRow(index, checked) {
        const s = healthSetReview;
        if (s.all) { s.all = false; s.selected = new Set(s.data.rows.map(r => r.path)); }
        const path = s.data.rows[index]?.path;
        if (path) checked ? s.selected.add(path) : s.selected.delete(path);
        drawHealthSetReview();
    }
    function healthSetListen(index) {
        const row = healthSetReview.data?.rows[index];
        if (!row) return;
        if (healthSetIsDemo()) return showToast('Example track only. Listen plays your real file in the full library.');
        playAudioFile(row.path, row.title, row.artist);
    }
    function healthSetOpenRestoreBin() {
        if (healthSetIsDemo()) {
            const removed = healthSetDemoRows().filter(r => r.state === 'removed');
            if (!removed.length) return showToast('The preview Restore Bin is empty.');
            showAxiomConfirm('Restore preview tracks', `Restore ${removed.length} example tracks to this review? No real files change.`, 'Restore', 'primary').then(ok => {
                if (!ok) return;
                removed.forEach(row => row.state = 'pending');
                healthSetReview.receipt = `${removed.length} example tracks restored.`;
                renderHealthApprovedSetCategory(healthSetReview.category, 'pending');
            });
            return;
        }
        openHealthRestoreBin();
    }

    async function applyHealthSetDecision(action, index = null) {
        const s = healthSetReview;
        if (s.busy || !s.data) return;
        const category = s.category, view = s.view, offset = s.offset, revision = s.data.revision;
        const all = index === null && s.all;
        const paths = index === null ? [...s.selected] : [s.data.rows[index]?.path].filter(Boolean);
        const count = all ? s.data.total : paths.length;
        if (!count) return;
        s.busy = true;
        drawHealthSetReview();
        try {
            if (action === 'remove' || (count > 1 && action === 'exclude')) {
                const ok = await showAxiomConfirm(action === 'remove' ? 'Remove from AXIOM' : 'Hide from set suggestions', action === 'remove'
                    ? `Remove ${count.toLocaleString()} selected tracks from AXIOM’s Library? Restore Bin can bring them back. Your music files stay on disk and your DJ software stays unchanged.`
                    : `Hide ${count.toLocaleString()} selected tracks from normal set suggestions? They stay in Library and you can restore them at any time.`, action === 'remove' ? 'Remove from AXIOM' : 'Hide from sets', action === 'remove' ? 'danger' : 'primary');
                if (!ok) return;
            }
            let result;
            if (healthSetIsDemo()) {
                const targets = healthSetDemoRows().filter(r => all ? r.category === category && r.state === 'pending' : paths.includes(r.path));
                targets.forEach(row => row.state = ({keep: 'kept', restore: 'kept', exclude: 'excluded', reset: 'pending', remove: 'removed'})[action]);
                result = {count: targets.length, message: `${targets.length} example tracks ${action === 'remove' ? 'moved to Restore Bin' : action === 'exclude' ? 'hidden from sets' : action === 'reset' ? 'returned to review' : 'kept as songs'}. No real files changed.`};
            } else {
                const response = await fetch('/api/library/utility_exclusion', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({category, action, paths, ...(all ? {scope: 'all_pending', revision} : {})})});
                result = await response.json();
                if (!response.ok || !result.success) throw new Error(result.error || 'Unable to save your choices.');
                currentRemovedFromAxiomBin = null;
                removedFromAxiomBinLoadedAt = 0;
                if (typeof loadLibraryStats === 'function') loadLibraryStats(false);
            }
            s.receipt = result.message + (result.skipped ? ` ${result.skipped} changed tracks were left alone; review again.` : '');
            s.busy = false;
            await renderHealthApprovedSetCategory(category, view, offset);
        } catch (error) { s.receipt = error.message; }
        finally { s.busy = false; drawHealthSetReview(); }
    }

    function setHealthApprovedResultsTab() {
        activeHealthApprovedResultsTab = 'completed';
        renderHealthApprovedResults();
    }

    function renderHealthApprovedResults() {
        const panel = document.getElementById('health-approved-results-panel');
        if (!panel) return;
        const receipt = panel.closest('.health-approved-results');
        if (receipt) receipt.dataset.resultsTab = activeHealthApprovedResultsTab;
        const receiptSnapshot = axiomSessionReceiptSnapshot();
        updateAxiomSessionReceiptHeader(receiptSnapshot);
        const markup = renderAxiomSessionReceiptLedger(receiptSnapshot);
        // Polling can run more than once a second. Preserve the existing DOM when
        // the visible result has not changed so focus, scroll position, and visual
        // effects remain steady instead of restarting on every status response.
        if (panel.__axiomHealthApprovedMarkup === markup) return;
        panel.innerHTML = markup;
        panel.__axiomHealthApprovedMarkup = markup;
    }

    function healthApprovedQueueSnapshot(paths = []) {
        const wanted = new Set((Array.isArray(paths) ? paths : []).map(path => String(path || '')));
        return (Array.isArray(currentHealthTracks) ? currentHealthTracks : [])
            .filter(track => !wanted.size || wanted.has(String(track?.path || '')))
            .slice(0, 12)
            .map(track => ({
                path: String(track?.path || ''),
                title: String(track?.title || track?.filename || 'Unknown track'),
                artist: String(track?.artist || 'Unknown artist'),
                bpm: Number(track?.bpm || 0),
                camelot: String(track?.camelot || track?.key || ''),
            }));
    }

    function renderHealthApprovedActiveQueue(job = {}, active = false) {
        const panel = document.getElementById('health-approved-active-queue');
        if (!panel) return;
        const flow = String(job?.flow || 'library');
        const queue = Array.isArray(job?.client_queue) ? job.client_queue.slice(0, 12) : [];
        if (flow !== 'new_music' || !queue.length) {
            panel.innerHTML = '';
            panel.classList.add('hidden');
            return;
        }
        const processed = Math.max(0, Number(job?.processed_steps || job?.totals?.checked || 0));
        const activePath = String((job?.active_actions || []).slice(-1)[0]?.path || '');
        const eventsByPath = new Map((job?.recent_events || [])
            .filter(event => event?.path)
            .map(event => [String(event.path), event]));
        panel.classList.remove('hidden');
        panel.innerHTML = `
            <table>
                <thead><tr><th>#</th><th>Track</th><th>Artist</th><th>Status</th><th>BPM</th><th>Key</th><th>Action</th></tr></thead>
                <tbody>${queue.map((track, index) => {
                    const event = eventsByPath.get(String(track.path || ''));
                    const rowActive = active && (activePath ? activePath === String(track.path || '') : index === Math.min(processed, queue.length - 1));
                    const completed = Boolean(event) || index < processed;
                    const needsReview = completed && ['review', 'needs_review', 'unresolved'].includes(String(event?.status || event?.result || '').toLowerCase());
                    const status = needsReview ? 'Needs Review' : completed ? 'Checked' : rowActive ? 'Processing' : 'Queued';
                    const icon = completed ? 'check-circle' : rowActive ? 'rotate-cw' : 'check-circle';
                    return `
                        <tr class="${rowActive ? 'active' : ''} ${completed ? 'completed' : ''} ${needsReview ? 'needs-review' : ''}">
                            <td><img src="/static/icons/${icon}.svg" alt="" aria-hidden="true"><span>${index + 1}</span></td>
                            <td><strong>${escapeHtml(track.title || 'Unknown track')}</strong></td>
                            <td>${escapeHtml(track.artist || 'Unknown artist')}</td>
                            <td><span class="health-approved-queue-status">${status}</span></td>
                            <td>${Number(track.bpm || 0) > 0 ? Number(track.bpm).toFixed(1) : '&mdash;'}</td>
                            <td>${escapeHtml(track.camelot || '') || '&mdash;'}</td>
                            <td>${needsReview ? '<button type="button" onclick="openHealthInboxWorkspace(\'bpm_review\')">Review</button>' : '&mdash;'}</td>
                        </tr>`;
                }).join('')}</tbody>
            </table>
            <small class="health-approved-queue-foot">Showing ${queue.length.toLocaleString()} of ${Math.max(queue.length, Number(job?.total_steps || queue.length)).toLocaleString()} tracks</small>`;
    }

    function renderHealthApprovedWorking(job = null) {
        // An idle engine legitimately returns no current job.
        job = job || {};
        const active = unifiedHealthIsActive(job || {});
        if (active) ensureUnifiedHealthActivityHeartbeat();
        else stopUnifiedHealthActivityHeartbeat();
        const activityFrame = active ? String(unifiedHealthActivityFrame % 4) : '0';
        syncUnifiedHealthCompletedPresentations(job || {});
        const completedEvent = unifiedHealthPresentedEvent;
        const finalStatus = String(job?.status || '').toLowerCase();
        const finished = ['complete', 'needs_review', 'no_work', 'stopped', 'failed', 'error'].includes(finalStatus);
        const consolePanel = document.querySelector('.health-approved-console');
        const healthFlow = String(job?.flow || 'library');
        if (consolePanel) {
            consolePanel.dataset.healthJobState = active ? 'active' : finished ? 'finished' : 'idle';
            consolePanel.dataset.healthFlow = healthFlow;
            consolePanel.dataset.healthActivityFrame = activityFrame;
        }
        const shell = document.getElementById('health-inbox-app');
        if (shell) {
            shell.dataset.healthJobState = active ? 'active' : finished ? 'finished' : 'idle';
            shell.dataset.healthFlow = healthFlow;
        }
        const idleHealthNeedsAction = Number(healthSummarySnapshot(currentHealthSummary).total_blockers || 0) > 0;
        setHealthText('health-readiness-live-title', active ? 'BPM & Key' : finished ? 'Scan Receipt' : 'Library Health');
        setHealthText('health-readiness-live-state', active ? 'Live repair progress' : finished ? 'Saved in AXIOM' : idleHealthNeedsAction ? 'Repair plan ready' : 'Up to date');
        const finalTitles = {
            complete: 'Health Scan Complete',
            needs_review: 'Health Scan Finished',
            no_work: 'Health Lane Clear',
            stopped: 'Health Scan Stopped Safely',
            failed: 'Health Scan Paused',
            error: 'Health Scan Paused',
        };
        const action = active ? (job.active_actions || []).at(-1) : null;
        const stageTitles = { inventory: 'Checking your library', metadata: 'Checking saved metadata', audio: 'Preparing audio analysis', analysis: 'Finding missing information', saving: 'Saving and verifying results' };
        const title = active ? action?.title || stageTitles[job.work_stage] || 'Starting your scan' : completedEvent?.title || finalTitles[finalStatus] || 'No active scan';
        const lane = completedEvent?.lane || '';
        const laneLabel = lane === 'missing_key' || lane === 'key' ? 'Key analysis completed and saved'
            : lane === 'missing_bpm' || lane === 'audio' ? 'BPM and key analysis completed and saved'
            : lane === 'missing_year' || lane === 'year' ? 'Year check completed and saved'
            : finalStatus === 'complete' ? 'All selected checks completed'
            : finalStatus === 'needs_review' ? 'Completed · review is still required'
            : finalStatus === 'no_work' ? 'Nothing was pending in this lane'
            : finalStatus === 'stopped' ? 'Completed work was saved'
            : ['failed', 'error'].includes(finalStatus) ? 'Completed work was saved · retry available'
            : active ? 'Background worker active · completed tracks will appear here'
            : 'Ready for a trusted Health check';
        setHealthText('health-approved-working-title', title);
        setHealthText('health-approved-working-artist', active ? action?.detail || job.message || 'Reading your library and preparing the scan.' : completedEvent?.artist || job?.message || 'Choose a Health lane to begin.');
        setHealthText('health-approved-working-status', active ? stageTitles[job.work_stage] || 'Preparing your scan' : laneLabel);
        setHealthText('health-approved-track-label', active ? 'Working now' : 'Last saved');
        setHealthText('health-approved-working-kicker', healthFlow === 'new_music' ? 'New Music Inbox' : 'Health Repair');
        setHealthText('health-approved-working-heading', healthFlow === 'new_music' ? 'Inline Batch Console' : 'Live Repair Console');
        const engines = job.engine_metrics || {};
        const engineCopy = Number(engines.rust_batches || 0) > 0
            ? ` Rust: ${Number(engines.rust_dsp_tracks || 0)} DSP tracks · ${Number(engines.rust_key_results || 0)} native key results · ${Number(engines.shared_pcm_tracks || 0)} shared audio bundles · ${Number(engines.pcm_fallback_tracks || 0)} audio fallbacks.` : '';
        setHealthText('health-approved-working-copy', (active ? 'Audio and Year checks run independently. Finished checks are saved and verified regularly.' : 'Confirmed results and estimates remain separate; folder/file dates do not verify an original release year.') + engineCopy);
        const workerAlive = job?.worker_alive !== false;
        const workerState = document.getElementById('health-approved-worker-state');
        const workerFailed = ['failed', 'error'].includes(finalStatus) || (active && !workerAlive);
        setHealthText('health-approved-worker-state', active
            ? workerAlive
                ? 'Working'
                : 'Scan paused unexpectedly'
            : workerFailed
                ? 'Scan paused unexpectedly'
            : finished
                ? 'Finished'
                : 'Ready');
        workerState?.classList.toggle('failed', workerFailed);
        const counts = job?.counts || {};
        const totals = job?.totals || {};
        const processed = Math.max(0, Number(job?.processed_steps || totals.checked || 0));
        const total = Math.max(processed, Number(job?.total_steps || 0));
        const reportedPending = Number(totals.still_missing);
        const pending = Number.isFinite(reportedPending)
            ? Math.max(0, reportedPending)
            : active
                ? Math.max(0, total - processed)
                : Math.max(0, Number(counts.missing_bpm || 0) + Number(counts.missing_key || 0) + Number(counts.missing_year || 0));
        const fixed = Math.max(0, Number(totals.fixed || 0) + Number(totals.estimated || 0));
        const needsInput = Math.max(0, Number(totals.unresolved || 0));
        const couldNotAccess = Math.max(0, Number(totals.blocked || totals.missing_file || 0));
        const progress = unifiedHealthProgressSnapshot(job);
        const percent = progress.percent;
        const started = Number(job?.started_at_ms || Date.parse(job?.started_at || '') || 0);
        const observedEnd = finished ? Date.parse(job.completed_at || job.updated_at || '') || Date.now() : Date.now();
        const elapsedSeconds = started ? Math.max(0, Math.floor((observedEnd - started) / 1000)) : 0;
        setHealthText('health-approved-elapsed', `${String(Math.floor(elapsedSeconds / 60)).padStart(2,'0')}:${String(elapsedSeconds % 60).padStart(2,'0')}`);
        setHealthText('health-approved-remaining-time', active && percent > 0 ? `~${Math.max(1, Math.round((elapsedSeconds / percent) * (100 - percent)))}s` : '--:--');
        setHealthText('health-approved-remaining', `${pending.toLocaleString()} pending`);
        setHealthText('health-approved-checks-progress', `${progress.checked.toLocaleString()} of ${total.toLocaleString()} checked · ${fixed.toLocaleString()} saved · ${progress.awaitingSave.toLocaleString()} awaiting save`);
        setHealthText('health-top-scan-checks', `${progress.checked.toLocaleString()} of ${total.toLocaleString()} checked · ${fixed.toLocaleString()} saved`);
        setHealthText('health-approved-metric-queued', total.toLocaleString());
        setHealthText('health-approved-metric-checked', processed.toLocaleString());
        setHealthText('health-approved-metric-fixed', fixed.toLocaleString());
        setHealthText('health-approved-metric-fixed-detail', `${Number(totals.fixed || 0).toLocaleString()} confirmed · ${Number(totals.estimated || 0).toLocaleString()} estimated`);
        setHealthText('health-approved-metric-review', needsInput.toLocaleString());
        setHealthText('health-approved-metric-pending', pending.toLocaleString());
        setHealthText('health-approved-progress-percent', active && !processed && !job.batch_completed_steps ? 'Preparing' : formatHealthProgressPercent(percent));
        renderHealthScopeSummary(job);
        if (active) {
            const prepareButton = document.getElementById('health-prepare-library');
            resetHealthReadinessActions();
            if (prepareButton) {
                prepareButton.disabled = true;
                prepareButton.textContent = 'Fixing Health';
            }
            setHealthText('health-readiness-title', 'AXIOM Is Fixing What\'s Missing');
            setHealthText('health-readiness-copy', 'Server-owned repair is in progress. AXIOM is checking your tracks using trusted audio analysis and saving verified results in its own library intelligence.');
        } else if (finished) {
            const finishedCleanly = ['complete', 'needs_review', 'no_work'].includes(finalStatus);
            // still_missing already includes unresolved checks. Prefer the
            // server's distinct-track count when a scoped receipt is available.
            const scopedAttention = Number(job.scope_summary?.needs_attention);
            const receiptAttention = Number.isFinite(scopedAttention)
                ? Math.max(0, scopedAttention)
                : Math.max(pending, needsInput, couldNotAccess);
            const librarySnapshot = healthSummarySnapshot(currentHealthSummary);
            const libraryNeedsAction = librarySnapshot.total_blockers > 0;
            const prepareButton = document.getElementById('health-prepare-library');
            const secondaryButton = document.getElementById('health-readiness-secondary');
            const rerunButton = document.getElementById('health-readiness-rerun');
            const nextCopy = document.getElementById('health-readiness-next-copy');
            if (prepareButton) {
                prepareButton.disabled = false;
                if (!finishedCleanly) {
                    prepareButton.dataset.healthAction = 'scan';
                    delete prepareButton.dataset.healthTarget;
                    prepareButton.textContent = 'Retry Health';
                } else if (libraryNeedsAction || receiptAttention > 0) {
                    prepareButton.dataset.healthAction = librarySnapshot.repair_ready > 0 ? 'plan' : 'workspace';
                    prepareButton.dataset.healthTarget = librarySnapshot.missing_file > 0 ? 'missing_file'
                        : librarySnapshot.bpm_review > 0 ? 'bpm_review'
                        : librarySnapshot.key_review > 0 ? 'key_review' : healthApprovedCurrentTaskKey();
                    prepareButton.textContent = 'Fix Health';
                } else {
                    prepareButton.dataset.healthAction = 'refresh';
                    delete prepareButton.dataset.healthTarget;
                    prepareButton.textContent = 'Check Health Again';
                }
            }
            if (secondaryButton) {
                secondaryButton.classList.remove('hidden');
                secondaryButton.dataset.healthAction = 'receipt';
                secondaryButton.dataset.healthTarget = 'completed';
                secondaryButton.textContent = fixed > 0
                    ? `View ${fixed.toLocaleString()} Fix${fixed === 1 ? '' : 'es'}`
                    : 'View Scan Receipt';
            }
            document.getElementById('health-readiness-last-receipt')?.classList.add('hidden');
            if (rerunButton) {
                rerunButton.classList.toggle('hidden', !finishedCleanly);
            }
            if (nextCopy) {
                nextCopy.textContent = !finishedCleanly
                    ? 'Next: retry the interrupted Health check'
                    : libraryNeedsAction || receiptAttention > 0
                        ? 'Next: continue with the remaining Health issues'
                        : 'Next: put your repaired library to work';
                nextCopy.classList.remove('hidden');
            }
            setHealthText('health-approved-improvements', fixed.toLocaleString());
            setHealthText('health-approved-improvements-label', fixed === 1 ? 'fix saved' : 'fixes saved');
            setHealthText('health-stat-total', fixed.toLocaleString());
            setHealthText('health-stat-total-label', 'fixes saved');
            setHealthText('health-inbox-track-total', total.toLocaleString());
            setHealthText('health-inbox-attention-count', receiptAttention.toLocaleString());
            setHealthText('health-inbox-attention-label', Number.isFinite(scopedAttention)
                ? (receiptAttention === 1 ? 'track needs your review' : 'tracks need your review')
                : (receiptAttention === 1 ? 'check needs your review' : 'checks need your review'));
            setHealthText('health-readiness-title', finishedCleanly
                ? (fixed > 0 ? `${fixed.toLocaleString()} Fix${fixed === 1 ? '' : 'es'} Saved` : 'Health Check Finished')
                : finalTitles[finalStatus]);
            setHealthText('health-readiness-copy', finishedCleanly
                ? receiptAttention > 0
                    ? `${processed.toLocaleString()} repair checks completed. ${fixed.toLocaleString()} fixes saved in AXIOM. ${receiptAttention.toLocaleString()} ${Number.isFinite(scopedAttention) ? 'tracks' : 'checks'} still need attention.`
                    : `${processed.toLocaleString()} repair checks completed. ${fixed.toLocaleString()} fixes saved in AXIOM. ${libraryNeedsAction ? 'Other library issues still need attention.' : 'Nothing needs your attention.'}`
                : (job?.message || 'Completed work remains saved in AXIOM. Review the receipt before retrying.'));
        }
        if (job.scope_summary) {
            setHealthText('health-readiness-copy', healthScopeSummaryText(job.scope_summary));
            setHealthText('health-inbox-track-total', Number(job.scope_summary.checked || 0).toLocaleString());
        }
        const bar = document.getElementById('health-approved-inline-bar');
        if (bar) bar.style.width = `${percent}%`;

        const waveform = document.getElementById('health-approved-waveform');
        if (waveform) {
            waveform.classList.remove('animate-pulse');
            waveform.classList.toggle('opacity-50', !active && !completedEvent);
            waveform.classList.toggle('health-scan-pulse', active);
        }

        const stageboard = document.getElementById('health-approved-stageboard');
        if (stageboard) {
            const stage = active ? ({ inventory: 0, metadata: 1, audio: 2, analysis: 3, saving: 4 }[job.work_stage] ?? 0) : finalStatus === 'complete' ? 5 : -1;
            stageboard.dataset.healthLive = String(active);
            stageboard.dataset.completedPresentation = 'false';
            stageboard.dataset.stageProgress = String(stage);
            paintUnifiedHealthCompletedStages(stage);
        }
        renderHealthApprovedActiveQueue(job || {}, active);
    }

    function healthInboxTrackTable(tracks = [], issueKey = 'missing_file') {
        const total = healthInboxIssueCount(issueKey);
        const rows = tracks.slice(0, 5);
        if (!rows.length) {
            return '<div class="health-detail-list"><div class="health-detail-list-row"><div><strong>No affected tracks</strong><span>This Health task is clear.</span></div><div></div><b>Ready</b></div></div>';
        }
        const isMissingFile = issueKey === 'missing_file';
        if (issueKey === 'missing_bpm') {
            return `
                <div class="health-bpm-ledger" role="table" aria-label="Tracks missing BPM">
                    <div class="health-bpm-ledger-head" role="row">
                        <span aria-hidden="true"></span>
                        <span role="columnheader">Track</span>
                        <span aria-hidden="true"></span>
                        <span role="columnheader">BPM</span>
                        <span role="columnheader">Action</span>
                    </div>
                    ${rows.map((track, index) => {
                        const path = String(track.path || 'Unknown location');
                        const safePath = escapeJs(path);
                        const bpmInputId = `health-inbox-bpm-${String(path || '').replace(/[^a-z0-9]/gi, '')}`;
                        return `
                            <div class="health-bpm-ledger-row" role="row">
                                <span class="health-bpm-row-number" aria-label="Row ${index + 1}">${String(index + 1).padStart(2, '0')}</span>
                                <div class="health-bpm-track" role="cell">
                                    <strong>${escapeHtml(track.title || track.filename || 'Unknown Track')}</strong>
                                    <span>${escapeHtml(track.artist || 'Unknown Artist')}</span>
                                    <small>${escapeHtml(path)}</small>
                                </div>
                                <span class="health-detail-badge" role="cell">BPM Missing</span>
                                <label class="health-bpm-input" for="${bpmInputId}" role="cell">
                                    <span>BPM</span>
                                    <input id="${bpmInputId}" type="number" placeholder="BPM" inputmode="decimal" aria-label="BPM for ${escapeHtml(track.title || track.filename || 'track')}">
                                </label>
                                <div class="health-bpm-row-actions" role="cell">
                                    <button onclick="saveHealthInboxManualBPM('${safePath}', this)" class="health-detail-action primary" type="button">Set BPM</button>
                                    <button onclick="ignoreHealthIssue('${safePath}', 'missing_bpm', this)" class="health-detail-action health-bpm-remove" type="button">Remove From Health</button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
                <div class="health-detail-footer"><span>Showing ${rows.length.toLocaleString()} of ${total.toLocaleString()}</span><span>Refresh after reconnecting a drive.</span></div>
            `;
        }
        return `
            <table class="health-detail-table ${issueKey === 'missing_year' ? 'health-year-review-table' : ''}">
                <thead><tr><th style="width:28%">Track</th><th style="width:34%">Last Location</th><th style="width:14%">Status</th><th style="width:24%">Action</th></tr></thead>
                <tbody>
                    ${rows.map(track => {
                        const path = String(track.path || 'Unknown location');
                        const external = path.startsWith('/Volumes/');
                        const safePath = escapeJs(path);
                        const yearInputId = `health-inbox-year-${String(path || '').replace(/[^a-z0-9]/gi, '')}`;
                        let action = '';
                        if (isMissingFile) {
                            action = `<button onclick="removeSingleMissingFileFromAxiom('${safePath}')" class="health-detail-action danger" type="button">Remove</button>`;
                        } else if (issueKey === 'missing_year') {
                            const suggestedYear = Number(track.suggested_year || 0);
                            action = `
                                <div class="health-year-row-actions">
                                    <div class="health-year-entry">
                                        <input id="${yearInputId}" type="number" value="${suggestedYear || ''}" placeholder="Year" min="1900" max="2100" aria-label="Release year for ${escapeHtml(track.title || 'this track')}" data-suggested-year="${suggestedYear}" onkeydown="if(event.key === 'Enter') { event.preventDefault(); this.nextElementSibling.click(); }">
                                        <button onclick="saveHealthInboxManualYear('${safePath}', this)" class="health-detail-action primary" type="button">Save Year</button>
                                    </div>
                                    <div class="health-year-secondary">
                                        <button onclick="fetchHealthYear('${safePath}', this)" class="health-detail-action" type="button">Find year</button>
                                        <button data-health-file="${escapeHtml(path)}" onclick="revealHealthFile(this.dataset.healthFile, this)" class="health-detail-action" type="button">Reveal in Finder</button>
                                        <details class="health-year-more"><summary>More</summary><div><button onclick="removeSingleHealthReviewTrack('${safePath}', this)" class="health-detail-action danger" type="button">Remove from AXIOM</button><button onclick="ignoreHealthIssue('${safePath}', 'missing_year', this)" class="health-detail-action" type="button">Remove From Health</button></div></details>
                                    </div>
                                </div>
                            `;
                        } else if (issueKey === 'missing_bpm') {
                            const bpmInputId = `health-inbox-bpm-${String(path || '').replace(/[^a-z0-9]/gi, '')}`;
                            action = `
                                <div class="flex gap-2 items-center justify-end flex-wrap">
                                    <div class="flex items-center bg-black border border-axiom-accent/25 rounded px-2" title="Enter BPM manually. Source audio remains untouched.">
                                        <input id="${bpmInputId}" type="number" placeholder="BPM" class="w-14 bg-transparent text-[10px] text-axiom-accent font-black py-2 outline-none">
                                        <button onclick="saveHealthInboxManualBPM('${safePath}', this)" class="health-detail-action primary ml-2" type="button">SET BPM</button>
                                    </div>
                                    <button onclick="ignoreHealthIssue('${safePath}', 'missing_bpm', this)" class="health-detail-action" type="button">Remove From Health</button>
                                </div>
                            `;
                        } else if (issueKey === 'missing_key') {
                            const keyInputId = `health-inbox-key-${String(path || '').replace(/[^a-z0-9]/gi, '')}`;
                            action = `
                                <div class="flex gap-2 items-center justify-end flex-wrap">
                                    <div class="flex items-center bg-black border border-axiom-accent/25 rounded px-2" title="Enter Camelot key manually. Source audio remains untouched.">
                                        <input id="${keyInputId}" type="text" placeholder="Key (e.g. 8A)" class="w-20 bg-transparent text-[10px] text-axiom-accent font-black py-2 outline-none uppercase">
                                        <button onclick="saveHealthInboxManualKey('${safePath}', this)" class="health-detail-action primary ml-2" type="button">SET KEY</button>
                                    </div>
                                    <button onclick="ignoreHealthIssue('${safePath}', 'missing_key', this)" class="health-detail-action" type="button">Remove From Health</button>
                                </div>
                            `;
                        } else {
                            action = `<button onclick="ignoreHealthIssue('${safePath}', '${escapeJs(issueKey)}', this)" class="health-detail-action" type="button">Remove From Health</button>`;
                        }
                        const yearResearchStatus = track.year_research_status || '';
                        const yearHealthState = track.year_health_state || (track.suggested_year ? 'suggested' : 'not_checked');
                        const yearResearchLabel = yearResearchStatus === 'catalogue_year'
                            ? 'Research Candidate'
                            : yearResearchStatus === 'verified'
                                ? 'Research Verified'
                                : yearResearchStatus === 'unresolved'
                                    ? 'Research Unresolved'
                                    : '';
                        const researchedYear = track.year_research_original_release_year || track.year_research_release_year || track.year_research_candidate_year || '';
                        const statusLabel = isMissingFile
                            ? (external ? 'Drive Or File Missing' : 'File Not Found')
                            : (issueKey === 'missing_year'
                                ? `${yearResearchLabel || healthYearStateLabel(yearHealthState)}${researchedYear ? ` · ${Number(researchedYear)}` : track.suggested_year ? ` · ${Number(track.suggested_year)}` : ''}`
                                : issueKey === 'missing_bpm'
                                    ? 'BPM Missing'
                                    : issueKey === 'missing_key'
                                        ? 'Key Missing'
                                        : 'Health Warning');
                        const statusReason = issueKey === 'missing_year'
                            ? (track.year_research_notes || track.year_health_reason || track.suggested_year_reason || 'Ready for a release-year check.')
                            : '';
                        return `
                            <tr>
                                <td><span class="health-detail-track-title">${escapeHtml(track.title || track.filename || 'Unknown Track')}</span><span class="health-detail-track-sub">${escapeHtml(track.artist || 'Unknown Artist')}</span></td>
                                <td><span class="health-detail-path">${escapeHtml(path)}</span></td>
                                <td><span class="health-detail-badge" title="${escapeHtml(statusReason)}">${escapeHtml(statusLabel)}</span></td>
                                <td>${action}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
            <div class="health-detail-footer"><span>Showing ${rows.length.toLocaleString()} of ${total.toLocaleString()}</span><span>${issueKey === 'missing_year' ? 'Saved in AXIOM. Music tags stay untouched.' : 'Refresh after reconnecting a drive.'}</span></div>
        `;
    }

    function renderHealthIssueDetail(issueKey) {
        const meta = HEALTH_ISSUE_META[issueKey];
        const count = healthInboxIssueCount(issueKey);
        const tracks = currentHealthTracks.filter(track => track.fKey === issueKey);
        const healthy = count === 0;
        let actions = '';
        let trust = 'AXIOM updates its cache only. Source audio stays untouched.';

        if (issueKey === 'missing_file' && healthy) {
            return `<div class="health-files-clear" role="status">
                <img src="/static/icons/check-circle.svg" alt="">
                <div><h3 class="health-detail-title">No missing files</h3>
                <p class="health-detail-copy">All indexed tracks were found at the last check.</p></div>
                <span class="health-files-status">Up to date</span>
            </div>`;
        }

        if (issueKey === 'missing_file' && count > 0) {
            return `<div class="health-files-heading">
                <div><h3 class="health-detail-title">${count.toLocaleString()} missing ${count === 1 ? 'track' : 'tracks'}</h3>
                <p class="health-detail-copy">Reconnect the drive or folder containing these tracks.</p></div>
                <div class="health-detail-actions">
                    <button data-axiom-cta-skip="true" onclick="relocateLibrary()" class="health-detail-action primary" type="button"><img src="/static/icons/folder-open.svg" alt="">Reconnect Music</button>
                    <button id="health-purge-missing" data-axiom-cta-skip="true" onclick="purgeMissingFiles()" class="health-detail-action danger" type="button"><img src="/static/icons/x.svg" alt="">Remove ${count.toLocaleString()} From AXIOM</button>
                </div>
                </div>
                <p class="health-detail-trust">Removal affects AXIOM only. Source audio and connected DJ libraries stay untouched.</p>
                ${healthInboxTrackTable(tracks, issueKey)}`;
        } else if (issueKey === 'missing_year' && count > 0) {
            const suggestionCount = tracks.filter(track => Number(track.suggested_year || 0) > 0).length;
            actions = `<div class="health-detail-actions"><button onclick="startReleaseYearResearch(this)" class="health-detail-action primary" type="button">Find Missing Years</button>${suggestionCount ? `<button onclick="applyAllYearSuggestions(this)" class="health-detail-action" type="button">Update ${suggestionCount} Suggested Year${suggestionCount === 1 ? '' : 's'}</button>` : ''}<button onclick="openHealthRepairReport()" class="health-detail-action" type="button">View Repair Report</button></div>`;
        } else if (issueKey === 'missing_key' && count > 0) {
            actions = healthKeyAnalysisBatchAction();
        }

        if (issueKey === 'missing_bpm' && count > 0) {
            return `
                <div class="health-bpm-service-head">
                    <div class="health-bpm-service-copy">
                        <h3 class="health-detail-title"><span>${count.toLocaleString()}</span> ${escapeHtml(meta.label)}</h3>
                        <p class="health-detail-copy">${escapeHtml(meta.description)}</p>
                    </div>
                    ${actions}
                </div>
                ${healthDetailGuidanceHtml(HEALTH_ISSUE_GUIDANCE[issueKey]?.why, HEALTH_ISSUE_GUIDANCE[issueKey]?.next)}
                <p class="health-detail-trust">${escapeHtml(trust)}</p>
                ${healthInboxTrackTable(tracks, issueKey)}
            `;
        }

        return `
            <span class="health-detail-state ${healthy ? 'healthy' : 'danger'}">${healthy ? 'Ready' : 'Needs Attention'}</span>
            <h3 class="health-detail-title">${count > 0 ? `<span class="${issueKey === 'missing_file' ? 'danger' : ''}">${count.toLocaleString()}</span> ` : ''}${escapeHtml(meta.label)}</h3>
            <p class="health-detail-copy">${escapeHtml(healthy ? `No ${meta.singular}s are waiting for attention.` : meta.description)}</p>
            ${healthy ? healthDetailGuidanceHtml('This lane is clear, so AXIOM can use this data for set-building decisions.', 'Check again after adding new music or reconnecting a drive.') : healthDetailGuidanceHtml(HEALTH_ISSUE_GUIDANCE[issueKey]?.why, HEALTH_ISSUE_GUIDANCE[issueKey]?.next)}
            ${actions}
            <p class="health-detail-trust">${escapeHtml(trust)}</p>
            ${healthInboxTrackTable(tracks, issueKey)}
        `;
    }

    function renderHealthReviewDetail(issueKey) {
        const meta = HEALTH_REVIEW_META[issueKey];
        const count = healthInboxIssueCount(issueKey);
        const tracks = currentHealthTracks.filter(track => track.fKey === issueKey).slice(0, 25);
        const rows = tracks.map(track => {
            const reason = track[`${meta.prefix}_analysis_reason`] || 'AXIOM did not confirm a trusted result.';
            const nextAction = track[`${meta.prefix}_analysis_next_action`] || 'Review this track before retrying analysis.';
            return `
                <div class="health-detail-list-row">
                    <div>
                        <strong>${escapeHtml(track.title || track.filename || 'Unknown Track')}</strong>
                        <span>${escapeHtml(track.artist || 'Unknown Artist')}</span>
                    </div>
                    <div>
                        <strong>${escapeHtml(reason)}</strong>
                        <span>${escapeHtml(nextAction)}</span>
                    </div>
                    <button onclick="ignoreHealthIssue('${escapeJs(track.path || '')}', '${escapeJs(meta.issue)}', this)" class="health-detail-action" type="button">Dismiss</button>
                </div>
            `;
        }).join('');
        return `
            <span class="health-detail-state ${count ? '' : 'healthy'}">Analysis Review</span>
            <h3 class="health-detail-title">${count.toLocaleString()} ${escapeHtml(meta.label)}</h3>
            <p class="health-detail-copy">${escapeHtml(count ? meta.description : 'No tracks are waiting for review in this lane.')}</p>
            ${healthDetailGuidanceHtml('These tracks are removed from the automatic scan loop after a complete unchanged-file check.', 'Read the recorded reason. AXIOM will automatically reconsider a track when the file or analysis engine changes.')}
            <p class="health-detail-trust">No BPM or key was invented. Source audio and connected DJ libraries remain untouched.</p>
            ${issueKey === 'key_review' && count > 0 ? healthKeyAnalysisBatchAction() : ''}
            ${tracks.length ? `<div class="health-detail-actions"><button onclick="removeHealthReviewTracks('${escapeJs(issueKey)}', this)" class="health-detail-action danger" type="button">Remove These ${tracks.length.toLocaleString()} from AXIOM</button></div>` : ''}
            <div class="health-detail-list">${rows || '<div class="health-detail-list-row"><div><strong>No review outcomes</strong><span>This review lane is clear.</span></div><div></div><b>Ready</b></div>'}</div>
            <div class="health-detail-footer"><span>Showing ${tracks.length.toLocaleString()} of ${count.toLocaleString()}</span><span>Each reason is stored in the AXIOM cache.</span></div>
        `;
    }

    function healthKeyAnalysisBatchAction() {
        return `<div class="health-detail-actions"><button onclick="downloadLibraryKeyAnalysisBatch(this)" class="health-detail-action primary" type="button"><img src="/static/icons/file-up.svg" alt="">Create DJ Analysis Batch</button></div>
            <p class="health-detail-copy">Import the batch into Serato or djay and analyze those tracks, then return to AXIOM and scan Health again. Your music and DJ libraries stay unchanged by AXIOM.</p>`;
    }

    function renderHealthUtilityDetail(category) {
        const config = HEALTH_CLEANUP_CATEGORIES[category];
        const summary = currentHealthCleanupAudit?.summary || {};
        const excluded = currentHealthCleanupAudit?.excluded || {};
        const samples = currentHealthCleanupAudit?.samples?.[category] || [];
        const count = Number(summary[category] || 0);
        const excludedCount = Number(excluded[category] || 0);
        const isMetadata = category === 'title_cleanup' || category === 'artist_format';
        const canRemoveFromAxiom = Boolean(config?.canExclude);
        const previewRows = samples.slice(0, 5).map(track => `
            <div class="health-detail-list-row">
                <div><strong>${escapeHtml(track.title || track.filename || 'Unknown Track')}</strong><span>${escapeHtml(track.artist || 'Unknown Artist')}</span></div>
                <div><strong>${escapeHtml(track.audit_reason || config.description || 'Review candidate')}</strong><span>${escapeHtml(track.path || '')}</span></div>
                ${canRemoveFromAxiom && track.path ? `<button onclick="removeSingleHealthUtilityFromAxiom('${escapeJs(category)}', '${escapeJs(track.path)}', this)" class="health-detail-action danger" type="button">Remove</button>` : `<b>${isMetadata ? 'Review' : (track.set_build_excluded ? 'Excluded' : 'Included')}</b>`}
            </div>
        `).join('');
        const actionLabel = isMetadata ? `Review ${config.label}` : `Review ${config.label} Tracks`;
        const whyCopy = isMetadata
            ? 'Cleaner labels make search, exports, and set notes easier to trust.'
            : 'These files may be useful tools, but they can pollute Magic Set if AXIOM treats them like full songs.';
        const nextCopy = count
            ? (isMetadata ? 'Review the sample before applying display cleanup.' : 'Review the batch and exclude tools from set-building when they should not become song picks.')
            : 'Nothing needs work here right now.';
        return `
            <span class="health-detail-state ${count ? '' : 'healthy'}">${isMetadata ? 'Maintenance' : 'Set Building'}</span>
            <h3 class="health-detail-title">${count.toLocaleString()} ${escapeHtml(config.label)}</h3>
            <p class="health-detail-copy">${escapeHtml(config.description || '')}</p>
            ${healthDetailGuidanceHtml(whyCopy, nextCopy)}
            <div class="health-detail-actions">
                <button onclick="reviewHealthUtilityCategory('${escapeJs(category)}', this)" class="health-detail-action primary" type="button" ${count ? '' : 'disabled'}>${escapeHtml(actionLabel)}</button>
                ${canRemoveFromAxiom ? `<button onclick="removeHealthUtilityFromAxiom('${escapeJs(category)}', 'all_candidates', this)" class="health-detail-action danger" type="button" ${count ? '' : 'disabled'}>Remove All ${escapeHtml(config.label)}</button>` : ''}
                <button onclick="loadHealthUtilityAudit({ force: true }, this)" class="health-detail-action" type="button">Refresh Review</button>
            </div>
            <p class="health-detail-trust">${isMetadata ? 'Cleanup changes AXIOM display metadata only.' : `${excludedCount.toLocaleString()} already excluded. Excluded tracks stay searchable and are not deleted.`} Source audio and DJ libraries stay untouched.</p>
            <div class="health-detail-list">${previewRows || '<div class="health-detail-list-row"><div><strong>No candidates found</strong><span>This category is clear.</span></div><div></div><b>Ready</b></div>'}</div>
            <div class="health-detail-footer"><span>Showing ${Math.min(samples.length, 5).toLocaleString()} of ${count.toLocaleString()}</span><span>Open Review to work with a focused batch.</span></div>
        `;
    }

    function renderHealthRestoreDetail() {
        const summary = currentRemovedFromAxiomBin?.summary || {};
        const total = Number(currentRemovedFromAxiomBin?.total || 0);
        const rows = Object.entries(summary)
            .filter(([, count]) => Number(count || 0) > 0)
            .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
            .map(([category, count]) => `
                <div class="health-detail-list-row">
                    <div><strong>${escapeHtml(removedFromAxiomCategoryLabel(category))}</strong><span>Removed from AXIOM cache only.</span></div>
                    <div><span>Restore this category to make its tracks available in AXIOM again.</span></div>
                    <button onclick="restoreRemovedFromAxiomCategory('${escapeJs(category)}', this)" class="health-detail-action" type="button">Restore ${Number(count || 0).toLocaleString()}</button>
                </div>
            `).join('');
        return `
            <span class="health-detail-state ${total ? '' : 'healthy'}">Maintenance</span>
            <h3 class="health-detail-title">Restore Bin</h3>
            <p class="health-detail-copy">${total ? `${total.toLocaleString()} tracks can be restored to AXIOM.` : 'Nothing is waiting to be restored.'}</p>
            ${healthDetailGuidanceHtml('Restore Bin is your safety net after AXIOM-only cleanup.', total ? 'Restore a category when a removed track should be searchable or usable again.' : 'Keep working. Nothing has been removed from AXIOM cache.')}
            <p class="health-detail-trust">Restoring changes AXIOM's cache only. Source audio and DJ libraries stay untouched.</p>
            <div class="health-detail-list">${rows || '<div class="health-detail-list-row"><div><strong>Restore Bin Empty</strong><span>No AXIOM-only removals are waiting.</span></div><div></div><b>Ready</b></div>'}</div>
        `;
    }

    function healthGenreSelectionChanged() {
        const source = document.getElementById('health-genre-source')?.value || '';
        const genre = (currentHealthGenreSummary?.genres || []).find(item => item.label === source);
        const preview = document.getElementById('health-genre-preview');
        if (!preview) return;
        const samples = genre?.samples || [];
        preview.innerHTML = genre
            ? `<strong>${Number(genre.count || 0).toLocaleString()} tracks</strong> currently use ${escapeHtml(genre.label)}.${samples.length ? ` Sample: ${samples.slice(0, 3).map(track => escapeHtml(track.title || track.filename || 'Unknown Track')).join(' · ')}` : ''}`
            : 'Choose a genre to preview the affected tracks.';
    }

    function healthGenreBulkSelectionChanged() {
        const checked = Array.from(document.querySelectorAll('[data-health-genre-bulk]:checked'));
        const preview = document.getElementById('health-genre-bulk-preview');
        const apply = document.getElementById('health-genre-apply');
        const rootSelect = document.getElementById('health-genre-bulk-root');
        const targetInput = document.getElementById('health-genre-target');
        const targetRoot = String(rootSelect?.value || '').trim();
        const targetGenre = String(targetInput?.value || '').trim();
        const selectedLabels = checked.map(input => String(input.value || '').trim()).filter(Boolean);
        const selectedGenres = (currentHealthGenreSummary?.genres || []).filter(item => selectedLabels.includes(item.label));
        const count = selectedGenres.reduce((sum, item) => sum + Number(item.count || 0), 0);
        if (preview) {
            if (!selectedLabels.length) {
                preview.innerHTML = '<strong>Step 1:</strong> tick the messy genre labels you want to clean. Nothing can apply until at least one label is selected.';
            } else if (!targetRoot) {
                preview.innerHTML = `<strong>${selectedLabels.length.toLocaleString()} labels selected</strong> (${count.toLocaleString()} tracks). Step 2: choose the destination root lane. AXIOM will not guess.`;
            } else if (targetGenre) {
                preview.innerHTML = `<strong>Ready:</strong> ${selectedLabels.length.toLocaleString()} labels / ${count.toLocaleString()} tracks will move to <b>${escapeHtml(targetRoot)}</b> and be renamed <b>${escapeHtml(targetGenre)}</b>.`;
            } else {
                preview.innerHTML = `<strong>Ready:</strong> ${selectedLabels.length.toLocaleString()} labels / ${count.toLocaleString()} tracks will move to <b>${escapeHtml(targetRoot)}</b> and keep their current genre names.`;
            }
        }
        if (apply) {
            apply.disabled = !selectedLabels.length || !targetRoot;
            apply.classList.toggle('is-disabled', apply.disabled);
        }
    }

    function healthRootSelectionChanged() {
        const source = document.getElementById('health-root-source')?.value || '';
        const root = (currentHealthGenreSummary?.roots || []).find(item => item.label === source);
        const preview = document.getElementById('health-root-preview');
        if (!preview) return;
        const samples = root?.samples || [];
        preview.innerHTML = root
            ? `<strong>${Number(root.count || 0).toLocaleString()} tracks</strong> currently sit in the ${escapeHtml(root.label)} root lane.${samples.length ? ` Sample: ${samples.slice(0, 3).map(track => escapeHtml(track.title || track.filename || 'Unknown Track')).join(' · ')}` : ''}`
            : 'Choose a root lane to preview the affected tracks.';
    }


    function healthGenreRootSuggestionForLabel(label, count = 0) {
        const raw = String(label || '').trim();
        const value = raw.toLowerCase().replace(/&/g, ' and ');
        const compact = value.replace(/[^a-z0-9]+/g, ' ').trim();
        const has = (...terms) => terms.some(term => compact.includes(term));
        const exact = (...terms) => terms.some(term => compact === term);
        if (!raw) return null;
        if (has('new zealand', 'aotearoa', 'polynesian', 'pacific', 'samoan', 'samoa', 'tongan', 'tonga', 'maori', 'kiwi') || exact('nz', 'poly')) {
            return { root: 'Local Music', confidence: 96, reason: 'Local/NZ/Poly label language' };
        }
        if (has('soundcloud', 'refreshed', 'bootleg', 'mashup', 'mash up', 'edit pack', 'edits pack', 'quick hit', 'transition', 'blend', 'refix')) {
            return { root: 'Mashup / Edits', confidence: 92, reason: 'Edit, bootleg, refresh, or SoundCloud-style label' };
        }
        if (has('afro', 'african', 'amapiano', 'latin', 'reggaeton', 'dancehall', 'soca', 'baile', 'moomba', 'riddim', 'island', 'caribbean', 'international')) {
            return { root: 'Global', confidence: 90, reason: 'Global, Latin, African, island, or crossover label' };
        }
        if (has('rnb', 'r and b', 'hip hop', 'hiphop', 'rap', 'east coast', 'west coast', 'uk', 'drill', 'grime', 'jersey', 'ratchet', 'trap')) {
            return { root: 'Urban', confidence: 88, reason: 'Urban, rap, hip-hop, RNB, or regional rap label' };
        }
        if (has('edm', 'electronic', 'house', 'tech house', 'deep house', 'club', 'dance', 'trance', 'dubstep', 'dnb', 'drum and bass')) {
            return { root: 'Electronic', confidence: 84, reason: 'Electronic, dance, club, or house label' };
        }
        if (has('top 40', 'top40', 'pop', 'charts', 'radio', 'mainstream')) {
            return { root: 'Pop', confidence: 84, reason: 'Pop, chart, Top 40, or radio label' };
        }
        if (has('retro', 'disco', 'throwback', 'old school', 'oldies', '70s', '80s', '90s', '2000s')) {
            return { root: 'Utility', confidence: 74, reason: 'Era/library-use label rather than a music root' };
        }
        if (count <= 1) return { root: 'Utility', confidence: 48, reason: 'One-off label with no strong root signal' };
        return null;
    }

    function healthGenreBuildSmartSuggestions(limit = 10) {
        const genres = currentHealthGenreSummary?.genres || [];
        return genres
            .map(item => {
                const count = Number(item.count || 0);
                const suggestion = healthGenreRootSuggestionForLabel(item.label, count);
                if (!suggestion || count > limit || healthSmartCleanupDismissedLabels.has(item.label)) return null;
                return {
                    label: item.label,
                    count,
                    samples: item.samples || [],
                    root: suggestion.root,
                    confidence: suggestion.confidence,
                    reason: suggestion.reason,
                };
            })
            .filter(Boolean)
            .sort((a, b) => (b.confidence - a.confidence) || (a.count - b.count) || a.label.localeCompare(b.label));
    }

    function healthSmartCleanupSaveDismissedLabels() {
        try {
            localStorage.setItem('axiomDismissedSmartCleanupGenres', JSON.stringify(Array.from(healthSmartCleanupDismissedLabels)));
        } catch (error) {
            // Non-blocking: cleanup dismissal is a UI preference.
        }
    }

    function healthSmartCleanupDismissLabel(label) {
        const cleanLabel = String(label || '').trim();
        if (!cleanLabel) return;
        healthSmartCleanupDismissedLabels.add(cleanLabel);
        healthSmartCleanupSaveDismissedLabels();
        showToast(`${cleanLabel} dismissed from Smart Cleanup.`);
        healthGenreRenderSmartSuggestions(healthSmartCleanupLimit);
    }

    function healthSmartCleanupRestoreDismissed() {
        healthSmartCleanupDismissedLabels = new Set();
        healthSmartCleanupSaveDismissedLabels();
        showToast('Dismissed Smart Cleanup genres restored.');
        healthGenreRenderSmartSuggestions(healthSmartCleanupLimit);
    }

    function healthGenreSmartCleanupClaimedLabels(limit = healthSmartCleanupLimit) {
        return new Set((currentHealthGenreSummary?.genres || [])
            .filter(item => Number(item.count || 0) <= limit)
            .map(item => item.label));
    }

    function healthSmartCleanupPickRoot(root) {
        healthSmartCleanupSelectedRoot = root || '';
        healthGenreRenderSmartSuggestions(healthSmartCleanupLimit);
    }

    function healthSmartCleanupBackToRoots() {
        healthSmartCleanupSelectedRoot = '';
        healthGenreRenderSmartSuggestions(healthSmartCleanupLimit);
    }

    function healthSmartCleanupCleanLabelOptions(root) {
        const map = {
            'Local Music': ['LOCAL MUSIC', 'NZ', 'POLY', 'PACIFIC'],
            'Mashup / Edits': ['MASHUPS', 'EDITS', 'BOOTLEGS', 'TRANSITIONS'],
            Global: ['GLOBAL', 'AFROBEATS', 'LATIN', 'DANCEHALL', 'AFRICAN'],
            Urban: ['RNB', 'RAP', 'HIP HOP', 'URBAN'],
            Electronic: ['ELECTRONIC', 'EDM', 'HOUSE', 'DANCE'],
            Pop: ['POP', 'TOP 40', 'DANCE POP'],
            Utility: ['UTILITY', 'RETRO', 'DISCO', 'THROWBACK']
        };
        return map[root] || ['CLEAN GENRE'];
    }
