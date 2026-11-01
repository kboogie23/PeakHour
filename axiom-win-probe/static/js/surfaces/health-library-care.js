    // Health genre cleanup, restore bin, snapshots, and library-care summaries.
    let healthCleanupReviewFixturePromise = null;

    async function runAxiomHealthCleanupReviewFixture() {
        if (!['127.0.0.1', 'localhost'].includes(window.location.hostname)
            || axiomReviewMode() !== 'health') return false;
        const mode = axiomUiPreviewMode();
        const fixtures = {
            'health-cleanup-owner': {
                src: '/static/js/features/health-cleanup-owner-review.js?v=20261009-1',
                mount: 'mountHealthCleanupOwnerReview',
            },
            'health-cleanup-batch': {
                src: '/static/js/features/health-cleanup-batch-preview.js?v=20261009-3',
                mount: 'mountHealthCleanupBatchPreview',
            },
        };
        const fixture = fixtures[mode];
        if (!fixture) return false;
        if (!healthCleanupReviewFixturePromise) {
            healthCleanupReviewFixturePromise = (async () => {
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = fixture.src;
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
                await window[fixture.mount]();
                return true;
            })().catch(error => {
                healthCleanupReviewFixturePromise = null;
                throw error;
            });
        }
        return healthCleanupReviewFixturePromise;
    }
    function openHealthSmartCleanupOneTrackGroups() {
        const panel = document.getElementById('health-smart-cleanup-panel');
        if (!panel) return;
        healthSmartCleanupWorkflowActive = true;
        healthSmartCleanupLimit = 1;
        healthSmartCleanupSelectedRoot = '';
        healthSmartCleanupActiveLabels = healthGenreSmartCleanupClaimedLabels(healthSmartCleanupLimit);
        panel.classList.remove('hidden');
        healthGenreRenderSmartSuggestions(healthSmartCleanupLimit);
        renderHealthInboxDetail();
        const nextPanel = document.getElementById('health-smart-cleanup-panel');
        if (nextPanel) {
            nextPanel.classList.remove('hidden');
            healthGenreRenderSmartSuggestions(healthSmartCleanupLimit);
            nextPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    function healthGenreRenderSmartSuggestions(limit = 10) {
        const panel = document.getElementById('health-smart-cleanup-panel');
        if (!panel) return;
        healthSmartCleanupWorkflowActive = true;
        healthSmartCleanupLimit = limit;
        const dismissedCount = healthSmartCleanupDismissedLabels.size;
        const suggestions = healthGenreBuildSmartSuggestions(limit);
        healthSmartCleanupActiveLabels = healthGenreSmartCleanupClaimedLabels(limit);
        const grouped = suggestions.reduce((acc, item) => {
            if (!acc[item.root]) acc[item.root] = [];
            acc[item.root].push(item);
            return acc;
        }, {});
        const rootOrder = ['Local Music', 'Mashup / Edits', 'Global', 'Urban', 'Electronic', 'Pop', 'Utility'];
        const totalTracks = suggestions.reduce((sum, item) => sum + item.count, 0);
        const visibleRootOrder = healthSmartCleanupSelectedRoot ? [] : rootOrder;
        const groups = visibleRootOrder
            .filter(root => grouped[root]?.length)
            .map(root => {
                const items = grouped[root];
                const groupTracks = items.reduce((sum, item) => sum + item.count, 0);
                const selected = healthSmartCleanupSelectedRoot === root;
                const sampleNames = items.slice(0, 4).map(item => escapeHtml(item.label)).join(' / ');
                return `
                    <section class="health-smart-cleanup-group ${selected ? 'is-selected' : ''}">
                        <header>
                            <button type="button" class="health-smart-cleanup-lane-open" onclick="healthSmartCleanupPickRoot('${escapeHtml(root)}')">
                                <span>
                                    <strong>${escapeHtml(root)}</strong>
                                    <small>${items.length.toLocaleString()} one-track label${items.length === 1 ? '' : 's'} · ${groupTracks.toLocaleString()} track${groupTracks === 1 ? '' : 's'}</small>
                                </span>
                                <em>Choose lane</em>
                            </button>
                        </header>
                        <div class="health-smart-cleanup-lane-summary">${sampleNames || 'No labels in this lane.'}${items.length > 4 ? ` + ${(items.length - 4).toLocaleString()} more` : ''}</div>
                    </section>`;
            }).join('');
        const selectedItems = healthSmartCleanupSelectedRoot ? (grouped[healthSmartCleanupSelectedRoot] || []) : [];
        const selectedTracks = selectedItems.reduce((sum, item) => sum + item.count, 0);
        const targetOptions = healthSmartCleanupCleanLabelOptions(healthSmartCleanupSelectedRoot)
            .map(label => `<button type="button" data-health-smart-target="${escapeHtml(label)}" onclick="document.getElementById('health-smart-cleanup-target-custom').value = '${escapeJs(label)}'; healthGenreSmartSelectionChanged();">${escapeHtml(label)}</button>`)
            .join('');
        const labelChecklist = selectedItems
            .slice()
            .sort((a, b) => a.label.localeCompare(b.label))
            .map(item => `
                <label class="health-smart-cleanup-tick-row">
                    <input type="checkbox" data-health-smart-source-label value="${escapeHtml(item.label)}" checked onchange="healthGenreSmartSelectionChanged()">
                    <span>${escapeHtml(item.label)}</span>
                    <b>${Number(item.count || 0).toLocaleString()}</b>
                    <button type="button" onclick="event.preventDefault(); event.stopPropagation(); healthSmartCleanupDismissLabel('${escapeJs(item.label)}')">Dismiss</button>
                </label>`)
            .join('');
        const refinePanel = healthSmartCleanupSelectedRoot ? `
            <div class="health-smart-cleanup-refine">
                <span>
                    <strong>Choose the clean label</strong>
                    <small>${selectedItems.length.toLocaleString()} one-track label${selectedItems.length === 1 ? '' : 's'} in ${escapeHtml(healthSmartCleanupSelectedRoot)} are ready. Untick anything that does not belong, then choose or type the label they should share.</small>
                </span>
                <div class="health-smart-cleanup-refine-grid">
                    <div class="health-smart-cleanup-tick-box">
                        <div><strong>Tick labels for this batch</strong><button type="button" onclick="document.querySelectorAll('[data-health-smart-source-label]').forEach(input => input.checked = true); healthGenreSmartSelectionChanged();">Tick All</button><button type="button" onclick="document.querySelectorAll('[data-health-smart-source-label]').forEach(input => input.checked = false); healthGenreSmartSelectionChanged();">Clear</button></div>
                        ${labelChecklist || '<span class="health-smart-cleanup-empty">No labels waiting in this root.</span>'}
                    </div>
                    <label>
                        <span>Clean genre label</span>
                        <div class="health-smart-cleanup-target-buttons">${targetOptions}</div>
                        <input id="health-smart-cleanup-target-custom" type="text" oninput="healthGenreSmartSelectionChanged()" placeholder="e.g. Mashups, Afrobeats, RNB, Local">
                    </label>
                </div>
            </div>` : '';
        const applyZone = healthSmartCleanupSelectedRoot ? `
            <div class="health-smart-cleanup-apply-zone">
                <span><strong>Step 3 of 3 · Review and save</strong><small id="health-smart-cleanup-apply-copy">Choose the clean genre label to finish this root lane.</small></span>
                <button id="health-smart-cleanup-apply" type="button" class="health-detail-action primary" onclick="applyHealthSmartCleanup()">Choose a Clean Label</button>
            </div>` : '';
        panel.innerHTML = `
            <div class="health-smart-cleanup-head">
                <span>
                    <b class="health-smart-cleanup-stage">Step ${healthSmartCleanupSelectedRoot ? '2' : '1'} of 3</b>
                    <strong>${healthSmartCleanupSelectedRoot ? `Clean ${escapeHtml(healthSmartCleanupSelectedRoot)}` : 'Choose a root lane'}</strong>
                    <small>${healthSmartCleanupSelectedRoot ? 'Review only this lane, then choose the clean label those tracks should share.' : 'AXIOM grouped the one-track genres for you. Pick one lane to clean at a time.'}</small>
                </span>
                <div>
                    ${healthSmartCleanupSelectedRoot ? '<button type="button" class="health-smart-cleanup-nav" onclick="healthSmartCleanupBackToRoots()">Back to Lanes</button>' : ''}
                    <button type="button" class="health-smart-cleanup-exit" onclick="cancelHealthSmartCleanup()">Exit Smart Cleanup</button>
                    ${dismissedCount ? `<button type="button" class="health-smart-cleanup-restore" onclick="healthSmartCleanupRestoreDismissed()">Restore ${dismissedCount.toLocaleString()} Dismissed</button>` : ''}
                </div>
            </div>
            <div id="health-smart-cleanup-summary" class="health-genre-preview health-genre-outcome-preview"><strong>${suggestions.length.toLocaleString()} labels · ${totalTracks.toLocaleString()} tracks</strong>${healthSmartCleanupSelectedRoot ? ` in ${escapeHtml(healthSmartCleanupSelectedRoot)}` : ' ready across the root lanes below'}.</div>
            ${healthSmartCleanupSelectedRoot ? '' : `<div class="health-smart-cleanup-groups">${groups || '<div class="health-smart-cleanup-empty">No one-track labels have a confident root suggestion right now.</div>'}</div>`}
            ${refinePanel}
            ${applyZone}`;
        healthGenreSmartSelectionChanged();
    }

    function openHealthSmartCleanup() {
        const panel = document.getElementById('health-smart-cleanup-panel');
        if (!panel) return;
        healthSmartCleanupWorkflowActive = true;
        healthSmartCleanupLimit = 10;
        healthSmartCleanupSelectedRoot = '';
        healthSmartCleanupActiveLabels = healthGenreSmartCleanupClaimedLabels(healthSmartCleanupLimit);
        healthSmartCleanupExpandedRoots = new Set();
        panel.classList.remove('hidden');
        healthGenreRenderSmartSuggestions(10);
        renderHealthInboxDetail();
        const nextPanel = document.getElementById('health-smart-cleanup-panel');
        if (nextPanel) {
            nextPanel.classList.remove('hidden');
            healthGenreRenderSmartSuggestions(10);
            nextPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    function cancelHealthSmartCleanup() {
        healthSmartCleanupWorkflowActive = false;
        healthSmartCleanupActiveLabels = new Set();
        healthSmartCleanupExpandedRoots = new Set();
        healthSmartCleanupSelectedRoot = '';
        renderHealthInboxDetail();
    }

    function healthGenreSmartSelectionChanged() {
        const summary = document.getElementById('health-smart-cleanup-summary');
        const apply = document.getElementById('health-smart-cleanup-apply');
        const suggestions = healthGenreBuildSmartSuggestions(healthSmartCleanupLimit);
        const checkedLabels = new Set(Array.from(document.querySelectorAll('[data-health-smart-source-label]:checked')).map(input => String(input.value || '').trim()));
        const selected = suggestions.filter(item => item.root === healthSmartCleanupSelectedRoot && checkedLabels.has(item.label));
        const totalTracks = selected.reduce((sum, item) => sum + item.count, 0);
        const targetGenre = String(document.getElementById('health-smart-cleanup-target-custom')?.value || '').trim();
        document.querySelectorAll('[data-health-smart-target]').forEach(button => {
            button.classList.toggle('is-selected', String(button.dataset.healthSmartTarget || '').toLowerCase() === targetGenre.toLowerCase());
        });
        if (summary) {
            summary.innerHTML = healthSmartCleanupSelectedRoot
                ? `<strong>${escapeHtml(healthSmartCleanupSelectedRoot)}</strong> selected: ${selected.length.toLocaleString()} one-track labels / ${totalTracks.toLocaleString()} tracks${targetGenre ? ` will merge into <b>${escapeHtml(targetGenre)}</b>` : ' need a clean genre label next'}.`
                : `<strong>${suggestions.length.toLocaleString()} one-track labels grouped</strong>. Pick a root lane to continue.`;
        }
        const finalStep = document.getElementById('health-smart-cleanup-final-step');
        const applyCopy = document.getElementById('health-smart-cleanup-apply-copy');
        if (applyCopy) {
            applyCopy.textContent = healthSmartCleanupSelectedRoot && targetGenre
                ? `${selected.length.toLocaleString()} one-track labels / ${totalTracks.toLocaleString()} tracks in ${healthSmartCleanupSelectedRoot} will merge into ${targetGenre}.`
                : 'Choose the clean genre label to finish this root lane.';
        }
        if (apply) {
            apply.disabled = !selected.length || !targetGenre;
            apply.classList.toggle('is-disabled', apply.disabled);
            apply.textContent = selected.length && targetGenre ? `Save ${healthSmartCleanupSelectedRoot} Cleanup` : 'Choose a Clean Label';
        }
    }

    async function applyHealthSmartCleanup() {
        const suggestions = healthGenreBuildSmartSuggestions(healthSmartCleanupLimit);
        const checkedLabels = new Set(Array.from(document.querySelectorAll('[data-health-smart-source-label]:checked')).map(input => String(input.value || '').trim()));
        const selected = suggestions.filter(item => item.root === healthSmartCleanupSelectedRoot && checkedLabels.has(item.label));
        const targetGenre = String(document.getElementById('health-smart-cleanup-target-custom')?.value || '').trim();
        if (!selected.length || !healthSmartCleanupSelectedRoot) return showToast('Pick a root lane to clean first.', true);
        if (!targetGenre) return showToast('Choose or type the clean genre label for this root batch.', true);
        const totalTracks = selected.reduce((sum, item) => sum + item.count, 0);
        const labels = selected.map(item => item.label);
        const confirmed = await showAxiomConfirm(
            'Apply Root Cleanup Batch',
            `Merge ${selected.length.toLocaleString()} one-track label${selected.length === 1 ? '' : 's'} in ${healthSmartCleanupSelectedRoot} into ${targetGenre}, covering ${totalTracks.toLocaleString()} track${totalTracks === 1 ? '' : 's'}? Source files and DJ libraries stay untouched.`,
            'APPLY ROOT BATCH',
            'primary'
        );
        if (!confirmed) return;
        const button = document.getElementById('health-smart-cleanup-apply');
        setAxiomButtonBusy(button, true, '<span>Applying...</span>');
        try {
            const data = await runRootIntelligenceUpdate('/api/library/genres/batch_rename', {source_genres: labels, target_genre: targetGenre, target_root: healthSmartCleanupSelectedRoot});
            const updated = Number(data.count || 0);
            healthSmartCleanupWorkflowActive = false;
            healthSmartCleanupActiveLabels = new Set();
            healthSmartCleanupExpandedRoots = new Set();
            healthSmartCleanupSelectedRoot = '';
            currentHealthGenreSummary = null;
            healthGenreSummaryLoadedAt = 0;
            if (typeof trackVisualCache?.clear === 'function') trackVisualCache.clear();
            await loadHealthGenreSummary({ force: true });
            await runLibraryHealthCheck({ force: true, silent: true, skipProgress: true });
            if (!document.getElementById('tab-content-library')?.classList.contains('hidden')) runSearch();
            showToast(`${updated.toLocaleString()} tracks updated in ${targetGenre}. Start the next root batch when ready.`);
        } catch (error) {
            showToast(error.message || 'Smart cleanup failed', true);
        } finally {
            setAxiomButtonBusy(button, false);
        }
    }

    function renderHealthGenreDetail() {
        const data = currentHealthGenreSummary;
        const genres = data?.genres || [];
        const roots = data?.roots || [];
        if (healthSmartCleanupWorkflowActive) {
            window.setTimeout(() => {
                const panel = document.getElementById('health-smart-cleanup-panel');
                if (!panel || !healthSmartCleanupWorkflowActive) return;
                panel.classList.remove('hidden');
                healthGenreRenderSmartSuggestions(healthSmartCleanupLimit);
            }, 0);
        }
        const destinationRoots = ['Local Music', 'Urban', 'Global', 'Mashup / Edits', 'Electronic', 'Pop', 'Utility'];
        const destinationOptions = ['<option value="">Choose destination root</option>'].concat(destinationRoots.map(root => `<option value="${escapeHtml(root)}">${escapeHtml(root)}</option>`)).join('');
        const sourceRootOptions = ['<option value="">Choose current root</option>'].concat(roots.map(item => `<option value="${escapeHtml(item.label)}">${escapeHtml(item.label)} · ${Number(item.count || 0).toLocaleString()}</option>`)).join('');
        const smartClaimedGenres = genres.filter(item => healthSmartCleanupWorkflowActive && (healthSmartCleanupActiveLabels.has(item.label) || Number(item.count || 0) <= healthSmartCleanupLimit));
        const visibleGenres = genres.filter(item => !smartClaimedGenres.includes(item));
        const hiddenSmartCount = smartClaimedGenres.length;
        const hiddenSmartTracks = smartClaimedGenres.reduce((sum, item) => sum + Number(item.count || 0), 0);
        const genrePickRows = visibleGenres.map(item => {
            const count = Number(item.count || 0);
            const samples = (item.samples || []).slice(0, 2).map(track => escapeHtml(track.title || track.filename || 'Unknown Track')).join(' · ') || 'No sample available';
            return `
                <label class="health-genre-pick-row ${count <= 1 ? 'is-one-off' : ''}">
                    <input type="checkbox" data-health-genre-bulk value="${escapeHtml(item.label)}" onchange="healthGenreBulkSelectionChanged()">
                    <span>
                        <strong>${escapeHtml(item.label)}</strong>
                        <small>${samples}</small>
                    </span>
                    <b>${count.toLocaleString()}</b>
                </label>`;
        }).join('');
        return `
            <span class="health-detail-state healthy">Genre Cleanup</span>
            <h3 class="health-detail-title">${healthUpgradePreviewMode ? 'Smart Genre Control Room' : 'Genre &amp; Root Manager'}</h3>
            <p class="health-detail-copy">${healthUpgradePreviewMode ? 'Turn scattered genre labels into clean DJ-friendly lanes without working through one endless list.' : 'Bulk cleanup is outcome-first: tick messy labels, choose the lane they belong in, then apply only after the preview says exactly what will happen.'}</p>
            ${healthUpgradePreviewMode ? `
                <div class="health-upgrade-preview-hero">
                    <div>
                        <span>Genre cleanup</span>
                        <strong>Clean the library by root lane, not by endless genre lists.</strong>
                        <small>One-track labels get grouped into lanes first. You choose a lane, batch-label the genuine clutter, then repeat until that root is clean.</small>
                    </div>
                    <div class="health-upgrade-preview-stats">
                        <b>${genres.filter(item => Number(item.count || 0) <= 1).length.toLocaleString()}</b><span>one-track labels</span>
                        <b>${genres.filter(item => Number(item.count || 0) > 1 && Number(item.count || 0) < 50).length.toLocaleString()}</b><span>next-phase groups</span>
                    </div>
                </div>` : ''}
            ${!healthSmartCleanupWorkflowActive ? `<div class="health-smart-cleanup-callout">
                <span><strong>Smart cleanup</strong><small>AXIOM grouped tiny genre labels into root lanes. Choose one lane, then give its tracks one clean label.</small></span>
                <div class="health-smart-cleanup-cta-row">
                    <button type="button" onclick="openHealthSmartCleanupOneTrackGroups()">Start Cleanup</button>
                </div>
            </div>` : ''}
            <div id="health-smart-cleanup-panel" class="health-smart-cleanup-panel hidden"></div>
            <details class="health-manual-cleanup-drawer">
                <summary>
                    <span>
                        <strong>Manual genre cleanup tools</strong>
                        <small>Open this only when you want the older freeform label-moving workflow.</small>
                    </span>
                    <b>Open Manual Tools</b>
                </summary>
            <div class="health-genre-bulk-panel health-genre-bulk-panel-redesign">
                <div class="health-genre-bulk-head">
                    <span><strong>Bulk genre cleanup mission</strong><small>Built for moving lots of tiny labels into the correct DJ root lane without accidental defaults.</small></span>
                    <button type="button" onclick="document.querySelectorAll('[data-health-genre-bulk]').forEach(input => input.checked = false); healthGenreBulkSelectionChanged();">Clear Ticks</button>
                </div>
                <div class="health-genre-outcome-board">
                    <label>
                        <span>Destination root lane</span>
                        <select id="health-genre-bulk-root" onchange="healthGenreBulkSelectionChanged()">${destinationOptions}</select>
                    </label>
                    <label>
                        <span>Optional clean genre label</span>
                        <input id="health-genre-target" type="text" oninput="healthGenreBulkSelectionChanged()" placeholder="Leave blank to keep each selected genre name">
                    </label>
                    <button id="health-genre-apply" onclick="applyHealthGenreBatch()" class="health-detail-action primary is-disabled" type="button" disabled>Apply Reviewed Outcome</button>
                </div>
                <div id="health-genre-bulk-preview" class="health-genre-preview health-genre-outcome-preview"><strong>Step 1:</strong> tick the messy genre labels you want to clean. Nothing can apply until at least one label is selected.</div>
                ${hiddenSmartCount ? `<div class="health-smart-cleanup-claimed"><strong>${hiddenSmartCount.toLocaleString()} tiny labels / ${hiddenSmartTracks.toLocaleString()} tracks are in Smart Cleanup</strong><span>Finish or cancel that workflow to bring them back to this manual list.</span><button type="button" onclick="cancelHealthSmartCleanup()">Cancel Smart Cleanup</button></div>` : ''}
                <div class="health-genre-pick-list">${genrePickRows || '<div class="health-detail-list-row"><div><strong>No genres found</strong><span>Connect a local or DJ library first.</span></div><div></div><b>0</b></div>'}</div>
            </div>
            </details>
            <div class="health-root-advanced-panel">
                <div class="health-genre-bulk-head">
                    <span><strong>Advanced root lane move</strong><small>Use this only when an entire existing root lane needs to move. For one-off labels, use the mission above.</small></span>
                </div>
                <div class="health-genre-root-grid">
                    <label class="library-bpm-filter-wrap">
                        <span>Current root lane</span>
                        <select id="health-root-source" onchange="healthRootSelectionChanged()">${sourceRootOptions}</select>
                    </label>
                    <label class="library-bpm-filter-wrap">
                        <span>Move into root</span>
                        <select id="health-root-target">${destinationOptions}</select>
                    </label>
                    <label class="library-bpm-filter-wrap">
                        <span>Optional genre label</span>
                        <input id="health-root-genre" type="text" placeholder="e.g. Afrobeats, RNB, Rap">
                    </label>
                    <button id="health-root-apply" onclick="applyHealthRootBatch()" class="health-detail-action primary" type="button">Move Entire Root</button>
                </div>
                <div id="health-root-preview" class="health-genre-preview">Choose a root lane to preview the affected tracks.</div>
                <div class="health-detail-list">
                    ${roots.slice(0, 6).map(item => `<div class="health-detail-list-row"><div><strong>${escapeHtml(item.label)}</strong><span>Current AXIOM root lane</span></div><div><span>${(item.samples || []).slice(0, 2).map(track => escapeHtml(track.title || track.filename || 'Unknown Track')).join(' · ') || 'No sample available'}</span></div><b>${Number(item.count || 0).toLocaleString()}</b></div>`).join('') || '<div class="health-detail-list-row"><div><strong>No roots found</strong><span>Connect a local or DJ library first.</span></div><div></div><b>0</b></div>'}
                </div>
            </div>
            <p class="health-detail-footnote">This updates AXIOM cache and recommendation labels only. Audio tags, source files, Serato, and djay remain untouched.</p>
        `;
    }

    async function loadHealthGenreSummary(options = {}) {
        const force = options.force === true;
        if (!force && currentHealthGenreSummary && Date.now() - healthGenreSummaryLoadedAt < HEALTH_AUTO_REFRESH_MS) {
            renderHealthInboxDetail();
            return currentHealthGenreSummary;
        }
        if (healthGenreSummaryInFlight) return healthGenreSummaryInFlight;
        healthGenreSummaryInFlight = (async () => {
            try {
                const resp = await fetch('/api/library/genres');
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok || data.success === false) throw new Error(data.error || data.message || 'Genre summary failed');
                currentHealthGenreSummary = data;
                healthGenreSummaryLoadedAt = Date.now();
                const countEl = document.getElementById('health-genre-count');
                if (countEl) countEl.textContent = Number(data.genre_count || 0).toLocaleString();
                renderHealthInboxDetail();
                return data;
            } catch (err) {
                showToast(err.message || 'Genre summary failed', true);
                return currentHealthGenreSummary;
            } finally {
                healthGenreSummaryInFlight = null;
            }
        })();
        return healthGenreSummaryInFlight;
    }

    async function applyHealthGenreBatch() {
        const targetGenre = String(document.getElementById('health-genre-target')?.value || '').trim();
        const targetRoot = String(document.getElementById('health-genre-bulk-root')?.value || '').trim();
        const sourceGenres = Array.from(document.querySelectorAll('[data-health-genre-bulk]:checked')).map(input => String(input.value || '').trim()).filter(Boolean);
        const selectedGenres = (currentHealthGenreSummary?.genres || []).filter(item => sourceGenres.includes(item.label));
        if (!sourceGenres.length) return showToast('Tick one or more genre labels first.', true);
        if (!targetRoot) return showToast('Choose the destination root lane first. AXIOM will not guess.', true);
        const count = selectedGenres.reduce((sum, item) => sum + Number(item.count || 0), 0);
        const labelCopy = targetGenre ? ` and rename them to "${targetGenre}"` : ' while keeping their current genre labels';
        const confirmed = await showAxiomConfirm(
            'Review Bulk Genre Cleanup',
            `Move ${count.toLocaleString()} track${count === 1 ? '' : 's'} across ${sourceGenres.length.toLocaleString()} genre label${sourceGenres.length === 1 ? '' : 's'} into "${targetRoot}"${labelCopy}? Source files and DJ libraries stay untouched.`,
            'APPLY REVIEWED OUTCOME',
            'primary'
        );
        if (!confirmed) return;

        const button = document.getElementById('health-genre-apply');
        setAxiomButtonBusy(button, true, '<span>Applying...</span>');
        try {
            const data = await runRootIntelligenceUpdate('/api/library/genres/batch_rename', {source_genres: sourceGenres, source_genre: sourceGenres[0] || '', target_genre: targetGenre, target_root: targetRoot});
            currentHealthGenreSummary = null;
            healthGenreSummaryLoadedAt = 0;
            if (typeof trackVisualCache?.clear === 'function') trackVisualCache.clear();
            await loadHealthGenreSummary({ force: true });
            await runLibraryHealthCheck({ force: true, silent: true, skipProgress: true });
            if (!document.getElementById('tab-content-library')?.classList.contains('hidden')) runSearch();
            showToast(data.message || 'Genre cleanup saved. Source audio untouched.');
        } catch (err) {
            showToast(err.message || 'Genre cleanup failed', true);
        } finally {
            setAxiomButtonBusy(button, false);
            healthGenreBulkSelectionChanged();
        }
    }

    async function applyHealthRootBatch() {
        const sourceRoot = String(document.getElementById('health-root-source')?.value || '').trim();
        const targetRoot = String(document.getElementById('health-root-target')?.value || '').trim();
        const targetGenre = String(document.getElementById('health-root-genre')?.value || '').trim();
        const selected = (currentHealthGenreSummary?.roots || []).find(item => item.label === sourceRoot);
        if (!sourceRoot || !targetRoot) return showToast('Choose a current root lane and the root lane it should move into.', true);
        const count = Number(selected?.count || 0);
        const labelCopy = targetGenre ? ` and label them "${targetGenre}"` : '';
        const confirmed = await showAxiomConfirm(
            'Bulk Move Root Lane',
            `Move ${count.toLocaleString()} track${count === 1 ? '' : 's'} from "${sourceRoot}" to "${targetRoot}"${labelCopy} inside AXIOM? Source files and DJ libraries stay untouched.`,
            'MOVE ROOT LANE',
            'primary'
        );
        if (!confirmed) return;

        const button = document.getElementById('health-root-apply');
        setAxiomButtonBusy(button, true, '<span>Applying...</span>');
        try {
            const data = await runRootIntelligenceUpdate('/api/library/roots/batch_update', {source_root: sourceRoot, target_root: targetRoot, target_genre: targetGenre});
            currentHealthGenreSummary = null;
            healthGenreSummaryLoadedAt = 0;
            if (typeof trackVisualCache?.clear === 'function') trackVisualCache.clear();
            await loadHealthGenreSummary({ force: true });
            await runLibraryHealthCheck({ force: true, silent: true, skipProgress: true });
            if (!document.getElementById('tab-content-library')?.classList.contains('hidden')) runSearch();
            showToast(data.message || 'Root lane updated. Source audio untouched.');
        } catch (err) {
            showToast(err.message || 'Root batch failed', true);
        } finally {
            setAxiomButtonBusy(button, false);
        }
    }

    function renderHealthInboxDetail() {
        const detail = document.getElementById('health-inbox-detail');
        if (!detail) return;
        if (HEALTH_CLEANUP_CATEGORIES[activeHealthInboxItem]?.canExclude) {
            detail.classList.add('hidden');
            detail.innerHTML = '';
            detail.__axiomHealthInboxMarkup = '';
            return;
        }
        if (activeHealthInboxItem === 'title_cleanup' || activeHealthInboxItem === 'artist_format') {
            activeHealthInboxItem = healthApprovedCurrentTaskKey();
        }
        if (!healthHasAuthoritativeSnapshot()) {
            detail.classList.remove('hidden');
            detail.dataset.healthDetail = activeHealthInboxItem || '';
            renderHealthSnapshotPendingState();
            return;
        }
        if (!window.AxiomHealthCockpit && HEALTH_ISSUE_META[activeHealthInboxItem] && healthInboxIssueCount(activeHealthInboxItem) <= 0) {
            activeHealthInboxItem = healthPendingRepairTaskKey();
        }
        if (!activeHealthInboxItem) {
            detail.classList.add('hidden');
            detail.removeAttribute('data-health-detail');
            detail.innerHTML = '';
            detail.__axiomHealthInboxMarkup = '';
            document.querySelectorAll('[data-health-item]').forEach(button => button.classList.remove('active'));
            renderHealthApprovedWorkspace();
            return;
        }
        detail.classList.remove('hidden');
        detail.dataset.healthDetail = activeHealthInboxItem;
        const issueCountIds = {
            missing_file: 'health-stat-missing-file',
            missing_bpm: 'health-stat-missing-bpm',
            missing_key: 'health-stat-missing-key',
            missing_year: 'health-stat-missing-year',
            bpm_review: 'health-stat-bpm-review',
            key_review: 'health-stat-key-review',
        };
        Object.entries(issueCountIds).forEach(([key, id]) => {
            const countEl = document.getElementById(id);
            if (countEl) countEl.textContent = healthInboxIssueCount(key).toLocaleString();
        });
        document.querySelectorAll('[data-health-item]').forEach(button => {
            button.classList.toggle('active', button.dataset.healthItem === activeHealthInboxItem);
        });

        const attentionCount = healthInboxAttentionCount();
        const attentionEl = document.getElementById('health-inbox-attention-count');
        const totalEl = document.getElementById('health-stat-total');
        if (attentionEl) attentionEl.textContent = attentionCount.toLocaleString();
        if (totalEl) totalEl.textContent = healthInboxBlockerCount().toLocaleString();
        const reviewEl = document.getElementById('health-inbox-review-count');
        if (reviewEl) reviewEl.textContent = (healthInboxIssueCount('bpm_review') + healthInboxIssueCount('key_review')).toLocaleString();
        const checkedEl = document.getElementById('health-inbox-last-checked');
        if (checkedEl) checkedEl.textContent = lastHealthCheckAt ? 'Just Now' : 'Not Yet';
        if (axiomReviewMode() === 'health') {
            const simulatedTrackCount = new Set(
                currentHealthTracks
                    .filter(track => track.health_review_fixture)
                    .map(track => track.path || track.filename || track.title)
            ).size;
            if (simulatedTrackCount > 0) setHealthText('health-inbox-track-total', simulatedTrackCount.toLocaleString());
        }

        let detailMarkup = '';
        if (HEALTH_ISSUE_META[activeHealthInboxItem]) {
            detailMarkup = renderHealthIssueDetail(activeHealthInboxItem);
        } else if (HEALTH_REVIEW_META[activeHealthInboxItem]) {
            detailMarkup = renderHealthReviewDetail(activeHealthInboxItem);
        } else if (HEALTH_CLEANUP_CATEGORIES[activeHealthInboxItem]) {
            detailMarkup = renderHealthUtilityDetail(activeHealthInboxItem);
        } else if (activeHealthInboxItem === 'genres') {
            detailMarkup = renderHealthGenreDetail();
        } else if (activeHealthInboxItem === 'restore') {
            detailMarkup = renderHealthRestoreDetail();
        }
        // Several cache-only Health helpers finish independently after the main
        // snapshot. Do not tear down and recreate an unchanged detail panel for
        // each response; that restarted controls and made the page visibly
        // stutter even though the Health result itself had not changed.
        if (detailMarkup && detail.__axiomHealthInboxMarkup !== detailMarkup) {
            detail.innerHTML = detailMarkup;
            detail.__axiomHealthInboxMarkup = detailMarkup;
        }
        renderHealthApprovedWorkspace();
    }

    function removedFromAxiomCategoryLabel(category) {
        if (category === 'missing_files') return 'Missing Files';
        if (category === 'manual') return 'Manual Removes';
        if (category === 'health_review') return 'Health Review';
        if (category === 'duplicates') return 'Duplicate Resolver';
        return HEALTH_CLEANUP_CATEGORIES[category]?.label || String(category || 'Removed Tracks');
    }

    function updateRemovedFromAxiomBinPanel(data = currentRemovedFromAxiomBin) {
        const total = Number(data?.total || 0);
        const inboxCountEl = document.getElementById('health-removed-bin-total');
        const titleEl = document.getElementById('health-removed-bin-title');
        const copyEl = document.getElementById('health-removed-bin-copy');
        const listEl = document.getElementById('health-removed-bin-list');
        if (inboxCountEl) inboxCountEl.textContent = total.toLocaleString();
        if (titleEl) titleEl.textContent = total > 0 ? `${total.toLocaleString()} Track${total === 1 ? '' : 's'} In Restore Bin` : 'Nothing Removed Yet';
        if (copyEl) {
            copyEl.textContent = total > 0
                ? 'Restore a removed category back into AXIOM cache. Source audio and Serato stay untouched.'
                : 'Tracks removed from AXIOM appear here for restore. Your audio files stay on disk.';
        }
        renderHealthInboxDetail();
        if (!listEl) return;
        const summary = data?.summary || {};
        const samples = data?.samples || {};
        const categories = Object.entries(summary)
            .filter(([, count]) => Number(count || 0) > 0)
            .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0));
        if (!categories.length) {
            listEl.innerHTML = '<div class="health-removed-bin-card"><span>Restore Bin</span><strong>0</strong><small>No AXIOM-only removals are waiting to restore.</small></div>';
            return;
        }
        listEl.innerHTML = categories.map(([category, count]) => {
            const sample = samples?.[category]?.[0] || {};
            const sampleText = sample.title
                ? `${sample.title}${sample.artist ? ` - ${sample.artist}` : ''}`
                : 'Most recent removed track is ready to restore.';
            return `
                <div class="health-removed-bin-card">
                    <span>${escapeHtml(removedFromAxiomCategoryLabel(category))}</span>
                    <strong>${Number(count || 0).toLocaleString()}</strong>
                    <small>${escapeHtml(sampleText)}</small>
                    <button onclick="restoreRemovedFromAxiomCategory('${escapeJs(category)}')" type="button">Restore ${escapeHtml(removedFromAxiomCategoryLabel(category))}</button>
                </div>
            `;
        }).join('');
    }

    async function loadRemovedFromAxiomBin(options = {}) {
        const force = options.force === true;
        if (!force && currentRemovedFromAxiomBin && Date.now() - removedFromAxiomBinLoadedAt < HEALTH_AUTO_REFRESH_MS) {
            updateRemovedFromAxiomBinPanel();
            return currentRemovedFromAxiomBin;
        }
        if (removedFromAxiomBinInFlight) return removedFromAxiomBinInFlight;
        const refreshBtn = document.getElementById('health-removed-bin-refresh');
        removedFromAxiomBinInFlight = (async () => {
            setAxiomButtonBusy(refreshBtn, true, '<span>Checking...</span>');
            try {
                const resp = await fetch('/api/library/removed_from_axiom');
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok || data.success === false) throw new Error(data.error || data.message || 'Removed bin failed');
                currentRemovedFromAxiomBin = data;
                removedFromAxiomBinLoadedAt = Date.now();
                updateRemovedFromAxiomBinPanel(data);
                if (force) showToast('Removed From AXIOM bin refreshed.');
                return data;
            } catch (err) {
                showToast(err.message || 'Removed bin failed', true);
                updateRemovedFromAxiomBinPanel(currentRemovedFromAxiomBin);
                return currentRemovedFromAxiomBin;
            } finally {
                setAxiomButtonBusy(refreshBtn, false);
                removedFromAxiomBinInFlight = null;
            }
        })();
        return removedFromAxiomBinInFlight;
    }

    async function restoreRemovedFromAxiomCategory(category) {
        const label = removedFromAxiomCategoryLabel(category);
        const count = Number(currentRemovedFromAxiomBin?.summary?.[category] || 0);
        if (!count) return showToast(`No ${label.toLowerCase()} to restore.`, true);
        const confirmed = await showAxiomConfirm(
            `Restore ${label}`,
            `Restore ${count.toLocaleString()} removed ${label.toLowerCase()} back into AXIOM's library index? Source audio and Serato stay untouched.`,
            'RESTORE TO AXIOM',
            'primary'
        );
        if (!confirmed) return;
        showToast(`Restoring ${label.toLowerCase()} to AXIOM index...`);
        try {
            const resp = await fetch('/api/library/removed_from_axiom/restore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ category, scope: 'category' })
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success === false) throw new Error(data.error || data.message || 'Restore failed');
            currentRemovedFromAxiomBin = data.bin || null;
            removedFromAxiomBinLoadedAt = Date.now();
            updateRemovedFromAxiomBinPanel(currentRemovedFromAxiomBin);
            currentHealthCleanupAudit = null;
            healthCleanupAuditLoadedAt = 0;
            await loadHealthUtilityAudit({ force: true });
            loadLibraryStats();
            showToast(data.message || 'Restored to AXIOM index. Source audio untouched.');
        } catch (err) {
            showToast(err.message || 'Restore failed', true);
        }
    }

    function healthRestoreDemoData() {
        const items = [
            {
                id: 'restore-demo-signal-fire',
                path: '/Music/AXIOM Trial/Signal Fire.mp3',
                title: 'Signal Fire',
                artist: 'Original Artist',
                category: 'duplicates',
                reason: 'Lower-quality duplicate row hidden; the FLAC best copy remains active in AXIOM.',
                removed_at: '2026-08-21T00:31:00Z',
                extension: 'mp3',
                bitrate: 320,
                source_audio_untouched: true,
            },
            {
                id: 'restore-demo-city-lights',
                path: '/Music/AXIOM Trial/City Lights 192.mp3',
                title: 'City Lights (Club Mix)',
                artist: 'North Avenue',
                category: 'duplicates',
                reason: 'Extra 192 kbps AXIOM row hidden; the prepared 320 kbps copy remains active.',
                removed_at: '2026-08-21T00:30:00Z',
                extension: 'mp3',
                bitrate: 192,
                source_audio_untouched: true,
            },
            {
                id: 'restore-demo-air-horn',
                path: '/Music/AXIOM Trial/Air Horn Sweep.wav',
                title: 'Air Horn Sweep',
                artist: 'DJ Tools',
                category: 'sound_effects',
                reason: 'Hidden from the AXIOM library view during reviewed Sound FX cleanup.',
                removed_at: '2026-08-21T00:26:00Z',
                extension: 'wav',
                bitrate: 0,
                source_audio_untouched: true,
            },
        ];
        return healthRestoreDataFromItems(items, true);
    }

    function healthRestoreItems(data = currentRemovedFromAxiomBin) {
        if (Array.isArray(data?.items)) return data.items;
        const seen = new Set();
        return Object.values(data?.samples || {}).flat().filter(item => {
            const key = String(item?.id || item?.path || '');
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function healthRestoreDataFromItems(items = [], demo = false) {
        const summary = items.reduce((counts, item) => {
            const category = String(item?.category || 'manual');
            counts[category] = Number(counts[category] || 0) + 1;
            return counts;
        }, {});
        const samples = items.reduce((groups, item) => {
            const category = String(item?.category || 'manual');
            (groups[category] ||= []).push(item);
            return groups;
        }, {});
        return {
            success: true,
            total: items.length,
            summary,
            samples,
            items,
            health_review_restore_fixture: demo,
            source_audio_untouched: true,
            serato_database_untouched: true,
        };
    }

    function healthRestoreVisibleItems() {
        const items = healthRestoreItems();
        return currentHealthRestoreFilter === 'all'
            ? items
            : items.filter(item => String(item.category || 'manual') === currentHealthRestoreFilter);
    }

    function healthRestoreRemovedWhen(value) {
        const date = new Date(value || '');
        if (Number.isNaN(date.getTime())) return 'Recently hidden';
        return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
    }

    function setHealthRestoreFilter(category = 'all') {
        currentHealthRestoreFilter = category;
        renderHealthRestoreBin();
    }

    function toggleHealthRestoreSelection(id, selected) {
        if (selected) selectedHealthRestoreIds.add(String(id));
        else selectedHealthRestoreIds.delete(String(id));
        updateHealthRestoreSelectionUi();
    }

    function toggleAllHealthRestoreSelections(selected) {
        healthRestoreVisibleItems().forEach(item => {
            const id = String(item.id || item.path || '');
            if (!id) return;
            if (selected) selectedHealthRestoreIds.add(id);
            else selectedHealthRestoreIds.delete(id);
        });
        renderHealthRestoreBin();
    }

    function clearHealthRestoreSelection() {
        selectedHealthRestoreIds.clear();
        renderHealthRestoreBin();
    }

    function updateHealthRestoreSelectionUi() {
        const visible = healthRestoreVisibleItems();
        const selectedVisible = visible.filter(item => selectedHealthRestoreIds.has(String(item.id || item.path || '')));
        document.querySelectorAll('[data-health-restore-id]').forEach(row => {
            const id = String(row.getAttribute('data-health-restore-id') || '');
            row.dataset.selected = selectedHealthRestoreIds.has(id) ? 'true' : 'false';
        });
        const selectedTotal = document.getElementById('health-restore-selected-total');
        if (selectedTotal) selectedTotal.textContent = selectedHealthRestoreIds.size.toLocaleString();
        const apply = document.getElementById('health-restore-selected-button');
        if (apply) {
            apply.disabled = selectedHealthRestoreIds.size === 0;
            apply.textContent = selectedHealthRestoreIds.size === 1
                ? 'Restore 1 AXIOM Row'
                : `Restore ${selectedHealthRestoreIds.size.toLocaleString()} AXIOM Rows`;
        }
        const all = document.getElementById('health-restore-select-all');
        if (all) {
            all.checked = visible.length > 0 && selectedVisible.length === visible.length;
            all.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visible.length;
        }
    }

    function renderHealthRestoreBin() {
        const container = document.getElementById('health-review-container');
        if (!container) return;
        const titleEl = document.getElementById('health-review-title');
        const copyEl = document.getElementById('health-review-copy');
        const badge = document.getElementById('health-review-ready-badge');
        const items = healthRestoreItems();
        const visible = healthRestoreVisibleItems();
        const categories = Object.entries(currentRemovedFromAxiomBin?.summary || {})
            .filter(([, count]) => Number(count || 0) > 0)
            .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0));
        const selectedCount = selectedHealthRestoreIds.size;
        if (titleEl) titleEl.textContent = 'Restore Bin';
        if (copyEl) copyEl.textContent = 'These are AXIOM library rows hidden by cleanup. Every audio file is still on your Mac.';
        if (badge) {
            badge.textContent = `${items.length.toLocaleString()} AXIOM row${items.length === 1 ? '' : 's'} recoverable`;
            badge.classList.remove('hidden');
        }
        container.setAttribute('aria-busy', 'false');

        const rows = visible.map(item => {
            const id = String(item.id || item.path || '');
            const selected = selectedHealthRestoreIds.has(id);
            const format = String(item.extension || '').toUpperCase();
            const bitrate = Number(item.bitrate || 0);
            const formatCopy = [format, bitrate ? `${bitrate.toLocaleString()} kbps` : ''].filter(Boolean).join(' · ');
            return `
                <div class="health-restore-row health-restore-grid" data-health-restore-id="${escapeHtml(id)}" data-selected="${selected ? 'true' : 'false'}">
                    <input class="health-clean-review-check" type="checkbox" ${selected ? 'checked' : ''} onchange="toggleHealthRestoreSelection('${escapeJs(id)}', this.checked)" aria-label="Select ${escapeHtml(item.title || 'Unknown Track')} for restore">
                    <div class="health-restore-track"><strong>${escapeHtml(item.title || 'Unknown Track')}</strong><small>${escapeHtml(item.artist || 'Unknown Artist')}${formatCopy ? ` · ${escapeHtml(formatCopy)}` : ''} · ${escapeHtml(item.path || '')}</small></div>
                    <div class="health-restore-source"><strong>${escapeHtml(removedFromAxiomCategoryLabel(item.category))}</strong><small>${escapeHtml(healthRestoreRemovedWhen(item.removed_at))}</small></div>
                    <div class="health-restore-reason">${escapeHtml(item.reason || 'Removed from AXIOM index.')}<b>Audio stays on your Mac</b></div>
                    <button class="health-restore-one" type="button" onclick="restoreHealthRestoreBin({ ids: ['${escapeJs(id)}'] }, this)">Restore row</button>
                </div>`;
        }).join('');

        const filters = [
            `<button class="health-restore-filter ${currentHealthRestoreFilter === 'all' ? 'active' : ''}" type="button" onclick="setHealthRestoreFilter('all')">All ${items.length.toLocaleString()}</button>`,
            ...categories.map(([category, count]) => `<button class="health-restore-filter ${currentHealthRestoreFilter === category ? 'active' : ''}" type="button" onclick="setHealthRestoreFilter('${escapeJs(category)}')">${escapeHtml(removedFromAxiomCategoryLabel(category))} ${Number(count || 0).toLocaleString()}</button>`),
        ].join('');

        container.innerHTML = `
            <div class="health-clean-review">
                <section class="health-restore-trust" aria-label="Restore Bin safety">
                    <div><img src="/static/icons/rotate-cw.svg" alt="" aria-hidden="true"><span><strong>AXIOM rows are recoverable</strong><small>Restore one row, a selection, or the entire queue.</small></span></div>
                    <div><img src="/static/icons/check-circle.svg" alt="" aria-hidden="true"><span><strong>Active best copies stay safe</strong><small>Restore returns only the hidden AXIOM row.</small></span></div>
                    <div class="zero-audio"><img src="/static/icons/audio-waveform.svg" alt="" aria-hidden="true"><span><strong>0 audio files deleted</strong><small>Nothing was moved, copied, renamed, or changed on disk.</small></span></div>
                </section>
                <section class="health-clean-review-summary" aria-label="Restore Bin totals">
                    <div class="health-clean-review-stat ready"><img src="/static/icons/rotate-cw.svg" alt="" aria-hidden="true"><div><span>Recoverable</span><strong>${items.length.toLocaleString()}</strong><small>Hidden AXIOM rows</small></div></div>
                    <div class="health-clean-review-stat"><img src="/static/icons/check-circle.svg" alt="" aria-hidden="true"><div><span>Selected</span><strong id="health-restore-selected-total">${selectedCount.toLocaleString()}</strong><small>Ready to restore</small></div></div>
                    <div class="health-clean-review-stat"><img src="/static/icons/audio-waveform.svg" alt="" aria-hidden="true"><div><span>Audio Changed</span><strong>0</strong><small>Source files untouched</small></div></div>
                </section>
                <div class="health-restore-filter-bar"><span>Show</span>${filters}</div>
                <section class="health-clean-review-list" aria-label="Recoverable AXIOM rows">
                    <div class="health-restore-columns health-restore-grid" aria-hidden="true">
                        <input id="health-restore-select-all" class="health-clean-review-check" type="checkbox" onchange="toggleAllHealthRestoreSelections(this.checked)" aria-label="Select all visible restore rows">
                        <span>Track</span><span>Hidden by</span><span>Why it was hidden</span><span>Restore one</span>
                    </div>
                    ${rows || '<div class="duplicate-review-empty"><img src="/static/icons/check-circle.svg" alt="" aria-hidden="true"><div><strong>No recoverable rows in this view</strong><p>Nothing is waiting here. Audio files remain on your Mac.</p></div></div>'}
                </section>
                <section id="health-restore-progress" class="health-restore-progress hidden" aria-live="polite">
                    <div class="health-restore-progress-head"><span id="health-restore-progress-copy">Restore accepted. Returning AXIOM rows to the library view.</span><strong id="health-restore-progress-count">Working</strong></div>
                    <div class="health-restore-progress-track"><span id="health-restore-progress-bar" style="width:32%"></span></div>
                </section>
                <div class="health-clean-review-actions">
                    <button class="health-clean-review-button" type="button" onclick="showTab('health')">Back</button>
                    <button class="health-clean-review-button link" type="button" onclick="toggleAllHealthRestoreSelections(true)" ${visible.length ? '' : 'disabled'}>Select visible</button>
                    <button class="health-clean-review-button link" type="button" onclick="clearHealthRestoreSelection()" ${selectedCount ? '' : 'disabled'}>Clear selection</button>
                    <button class="health-clean-review-button" type="button" onclick="restoreHealthRestoreBin({ scope: 'all' }, this)" ${items.length ? '' : 'disabled'}>Restore everything</button>
                    <span class="spacer"></span>
                    <button id="health-restore-selected-button" class="health-clean-review-button primary" type="button" onclick="restoreHealthRestoreBin({ ids: Array.from(selectedHealthRestoreIds) }, this)" ${selectedCount ? '' : 'disabled'}>${selectedCount === 1 ? 'Restore 1 AXIOM Row' : `Restore ${selectedCount.toLocaleString()} AXIOM Rows`}</button>
                </div>
            </div>`;
        container.scrollTop = 0;
        updateHealthRestoreSelectionUi();
    }

    function setHealthRestoreProgress(visible, copy = '', done = 0, total = 0) {
        const panel = document.getElementById('health-restore-progress');
        if (!panel) return;
        panel.classList.toggle('hidden', !visible);
        const copyEl = document.getElementById('health-restore-progress-copy');
        const countEl = document.getElementById('health-restore-progress-count');
        const bar = document.getElementById('health-restore-progress-bar');
        if (copyEl && copy) copyEl.textContent = copy;
        if (countEl) countEl.textContent = total ? `${Math.min(done, total).toLocaleString()} of ${total.toLocaleString()}` : 'Working';
        if (bar) bar.style.width = `${total ? Math.max(6, Math.min(100, (done / total) * 100)) : 32}%`;
    }

    function renderHealthRestoreReceipt(result = {}, requestedItems = []) {
        const container = document.getElementById('health-review-container');
        if (!container) return;
        const restored = Number(result.cache_rows_restored ?? result.count ?? 0);
        const skipped = Number(result.skipped_existing || 0);
        const requested = Number(result.requested ?? requestedItems.length ?? 0);
        const pending = Number(result.bin?.total ?? currentRemovedFromAxiomBin?.total ?? 0);
        const rows = Array.isArray(result.results) && result.results.length ? result.results : requestedItems.map(item => ({ ...item, outcome: 'restored' }));
        currentHealthRestoreReceipt = { result, requestedItems };
        const titleEl = document.getElementById('health-review-title');
        const copyEl = document.getElementById('health-review-copy');
        const badge = document.getElementById('health-review-ready-badge');
        if (titleEl) titleEl.textContent = restored ? 'AXIOM Rows Restored' : 'Restore Checked';
        if (copyEl) copyEl.textContent = 'The receipt below shows exactly what returned to AXIOM and what stayed unchanged.';
        if (badge) badge.textContent = '0 audio files changed';
        container.innerHTML = `
            <div class="health-clean-review">
                <section class="duplicate-outcome-hero" aria-live="polite">
                    <div class="duplicate-outcome-lead"><img src="/static/icons/check-circle.svg" alt="" aria-hidden="true"><div><h3>${restored.toLocaleString()} AXIOM row${restored === 1 ? '' : 's'} restored</h3><p>Checked ${requested.toLocaleString()} · Restored ${restored.toLocaleString()} · Already visible ${skipped.toLocaleString()} · Pending ${pending.toLocaleString()}</p></div></div>
                    <div class="duplicate-outcome-facts">
                        <div class="duplicate-outcome-fact safe"><strong>${restored.toLocaleString()}</strong><span>AXIOM rows restored</span></div>
                        <div class="duplicate-outcome-fact"><strong>${pending.toLocaleString()}</strong><span>Still in Restore Bin</span></div>
                        <div class="duplicate-outcome-fact safe"><strong>0</strong><span>Audio files changed</span></div>
                    </div>
                </section>
                <section class="health-restore-receipt-list" aria-label="Restore receipt">
                    ${rows.map(item => `
                        <div class="health-restore-receipt-row">
                            <div><strong>${escapeHtml(item.title || 'Unknown Track')}</strong><small>${escapeHtml(item.artist || 'Unknown Artist')} · ${escapeHtml(item.path || '')}</small></div>
                            <span>${item.outcome === 'already_visible' ? 'This row was already active in AXIOM, so no duplicate row was added.' : item.outcome === 'missing_path' ? 'This snapshot had no usable path and could not be restored.' : 'This library row is visible in AXIOM again. The source audio was never changed.'}</span>
                            <b>${item.outcome === 'already_visible' ? 'Already visible' : item.outcome === 'missing_path' ? 'Needs review' : 'Restored'}</b>
                        </div>`).join('')}
                </section>
                <section class="health-clean-review-proof">
                    <div><img src="/static/icons/check-circle.svg" alt="" aria-hidden="true"><span><strong>${result.demo ? 'Browser fixture only' : 'AXIOM cache updated'}</strong><small>Only recoverable AXIOM rows changed state.</small></span></div>
                    <div><img src="/static/icons/audio-waveform.svg" alt="" aria-hidden="true"><span><strong>0 audio files changed</strong><small>Source audio, Serato, and djay Pro stayed untouched.</small></span></div>
                </section>
                <div class="health-clean-review-actions">
                    <button class="health-clean-review-button" type="button" onclick="showTab('health')">Back to Health</button>
                    <button class="health-clean-review-button" type="button" onclick="renderHealthRestoreBin()">View Remaining ${pending.toLocaleString()}</button>
                    ${result.demo ? '<button class="health-clean-review-button link" type="button" onclick="resetHealthRestoreBinDemo()">Reset Demo</button>' : ''}
                </div>
            </div>`;
        container.scrollTop = 0;
    }

    async function restoreHealthRestoreBin(options = {}, triggerBtn = null) {
        const allItems = healthRestoreItems();
        const ids = Array.isArray(options.ids) ? options.ids.map(String) : [];
        const selected = options.scope === 'all'
            ? allItems
            : allItems.filter(item => ids.includes(String(item.id || item.path || '')));
        if (!selected.length) return showToast('Choose at least one AXIOM row to restore.', true);
        const count = selected.length;
        const confirmed = await showAxiomConfirm(
            `Restore ${count.toLocaleString()} AXIOM Row${count === 1 ? '' : 's'}`,
            `This returns ${count.toLocaleString()} library row${count === 1 ? '' : 's'} to AXIOM view. Audio files are not copied, moved, renamed, or changed.`,
            count === allItems.length ? 'RESTORE EVERYTHING' : 'RESTORE TO AXIOM',
            'primary'
        );
        if (!confirmed) return;
        setAxiomButtonBusy(triggerBtn, true, 'Restoring...');
        document.querySelectorAll('[data-health-restore-id] input, .health-restore-one').forEach(control => { control.disabled = true; });
        setHealthRestoreProgress(true, `Restore accepted. Returning ${count.toLocaleString()} AXIOM row${count === 1 ? '' : 's'} to the library view.`, 0, count);

        if (currentRemovedFromAxiomBin?.health_review_restore_fixture) {
            let done = 0;
            const runNext = () => {
                done += 1;
                const item = selected[Math.min(done - 1, selected.length - 1)];
                setHealthRestoreProgress(true, `Restoring ${item.title || 'AXIOM row'} — source audio stays untouched.`, done, count);
                if (done < count) {
                    healthRestoreDemoTimer = window.setTimeout(runNext, 360);
                    return;
                }
                healthRestoreDemoTimer = null;
                const restoredIds = new Set(selected.map(item => String(item.id || item.path || '')));
                const remaining = allItems.filter(item => !restoredIds.has(String(item.id || item.path || '')));
                currentRemovedFromAxiomBin = healthRestoreDataFromItems(remaining, true);
                selectedHealthRestoreIds = new Set(remaining.map(item => String(item.id || item.path || '')));
                const result = {
                    success: true,
                    requested: count,
                    cache_rows_restored: count,
                    skipped_existing: 0,
                    audio_files_deleted: 0,
                    source_files_changed: 0,
                    results: selected.map(item => ({ ...item, outcome: 'restored' })),
                    bin: currentRemovedFromAxiomBin,
                    demo: true,
                };
                renderHealthRestoreReceipt(result, selected);
                showToast(`${count.toLocaleString()} AXIOM row${count === 1 ? '' : 's'} restored. 0 audio files changed.`);
            };
            healthRestoreDemoTimer = window.setTimeout(runNext, 320);
            return;
        }

        try {
            const response = await fetch('/api/library/removed_from_axiom/restore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(options.scope === 'all' ? { scope: 'all' } : { ids }),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || result.success === false) throw new Error(result.error || result.message || 'Restore failed');
            currentRemovedFromAxiomBin = result.bin || healthRestoreDataFromItems([], false);
            removedFromAxiomBinLoadedAt = Date.now();
            selectedHealthRestoreIds = new Set(healthRestoreItems().map(item => String(item.id || item.path || '')));
            renderHealthRestoreReceipt(result, selected);
            currentHealthCleanupAudit = null;
            healthCleanupAuditLoadedAt = 0;
            loadLibraryStats();
            showToast(result.message || `${Number(result.cache_rows_restored || 0).toLocaleString()} AXIOM rows restored. 0 audio files changed.`);
        } catch (error) {
            setHealthRestoreProgress(true, error.message || 'Restore failed. No AXIOM rows or audio files changed.', 0, count);
            document.querySelectorAll('[data-health-restore-id] input, .health-restore-one').forEach(control => { control.disabled = false; });
            showToast(error.message || 'Restore failed', true);
        } finally {
            setAxiomButtonBusy(triggerBtn, false);
            if (!modalOnly && unifiedHealthIsActive(lastUnifiedHealthJob || {})) {
                renderHealthApprovedWorking(lastUnifiedHealthJob);
            }
        }
    }

    function resetHealthRestoreBinDemo() {
        if (healthRestoreDemoTimer) window.clearTimeout(healthRestoreDemoTimer);
        healthRestoreDemoTimer = null;
        currentRemovedFromAxiomBin = healthRestoreDemoData();
        currentHealthRestoreFilter = 'all';
        selectedHealthRestoreIds = new Set(healthRestoreItems().map(item => String(item.id || item.path || '')));
        currentHealthRestoreReceipt = null;
        renderHealthRestoreBin();
    }

    async function openHealthRestoreBin(triggerBtn = null) {
        setAxiomButtonBusy(triggerBtn, true, 'Opening...');
        showTab('health-review');
        const titleEl = document.getElementById('health-review-title');
        const copyEl = document.getElementById('health-review-copy');
        const badge = document.getElementById('health-review-ready-badge');
        const container = document.getElementById('health-review-container');
        if (titleEl) titleEl.textContent = 'Restore Bin';
        if (copyEl) copyEl.textContent = 'Request accepted. Reading recoverable AXIOM rows.';
        if (badge) badge.classList.add('hidden');
        if (container) {
            container.setAttribute('aria-busy', 'true');
            container.innerHTML = '<div class="health-review-loading"><strong>Restore Bin request accepted</strong><p>AXIOM is reading its recovery snapshots. Source audio stays untouched.</p></div>';
        }
        try {
            if (axiomReviewMode() === 'health') {
                await new Promise(resolve => window.setTimeout(resolve, 240));
                resetHealthRestoreBinDemo();
                return;
            }
            const data = await loadRemovedFromAxiomBin({ force: true });
            currentRemovedFromAxiomBin = data || healthRestoreDataFromItems([], false);
            currentHealthRestoreFilter = 'all';
            selectedHealthRestoreIds = new Set(healthRestoreItems().map(item => String(item.id || item.path || '')));
            currentHealthRestoreReceipt = null;
            renderHealthRestoreBin();
        } finally {
            setAxiomButtonBusy(triggerBtn, false);
        }
    }

    function healthSummaryCount(key) {
        return Number(currentHealthSummary?.[key] || 0);
    }

    function healthSummarySnapshot(summary = currentHealthSummary || {}) {
        const snap = {
            missing_file: Number(summary?.missing_file || 0),
            missing_bpm: Number(summary?.missing_bpm || 0),
            missing_key: Number(summary?.missing_key || 0),
            missing_year: Number(summary?.missing_year || 0),
            bpm_review: Number(summary?.bpm_review || 0),
            key_review: Number(summary?.key_review || 0),
        };
        snap.repair_ready = snap.missing_bpm + snap.missing_key + snap.missing_year;
        snap.review_ready = snap.bpm_review + snap.key_review;
        snap.bpm_attention = snap.missing_bpm + snap.bpm_review;
        snap.key_attention = snap.missing_key + snap.key_review;
        snap.total_blockers = snap.missing_file + snap.repair_ready + snap.review_ready;
        return snap;
    }

    function renderHealthNewMusicIntake() {
        const batch = currentHealthNewMusic || {};
        const total = Number(batch.total || 0);
        const ready = Number(batch.ready || 0);
        const needsPrep = Number(batch.needs_prep || 0);
        const review = Number(batch.review || 0);
        const sourceLabels = {
            library_scan: 'Library scan',
            music_folder: 'Music folder',
            serato: 'Serato library',
            djay: 'djay Pro library',
            recent_files: 'Recent files',
        };
        const source = sourceLabels[String(batch.source || '').toLowerCase()] || 'AXIOM library';
        const addedDate = batch.added_at ? new Date(batch.added_at) : null;
        const addedLabel = addedDate && Number.isFinite(addedDate.getTime())
            ? addedDate.toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
            : '';
        const intake = document.getElementById('health-new-music-intake');
        if (intake) intake.classList.toggle('is-empty', total === 0);
        setHealthText('health-new-music-title', total ? `${total.toLocaleString()} New Track${total === 1 ? '' : 's'}` : 'No New Music Waiting');
        setHealthText('health-new-music-copy', total
            ? `${source}${addedLabel ? ` · ${addedLabel}` : ''}. AXIOM has already sorted this batch into ready, preparation, and review.`
            : 'Add music and AXIOM will automatically collect the newest batch here for one complete Health check.');
        setHealthText('health-new-music-ready', ready.toLocaleString());
        setHealthText('health-new-music-prepare', needsPrep.toLocaleString());
        setHealthText('health-new-music-review', review.toLocaleString());
        const paths = Array.isArray(batch.paths) ? batch.paths : [];
        const check = document.getElementById('health-new-music-check');
        const prepare = document.getElementById('health-new-music-prepare-button');
        if (check) {
            check.disabled = paths.length === 0;
            check.textContent = total ? `Review ${total.toLocaleString()} Track${total === 1 ? '' : 's'}` : 'Review Batch';
        }
        if (prepare) {
            prepare.disabled = paths.length === 0 || needsPrep === 0;
            prepare.textContent = needsPrep
                ? `Prepare ${needsPrep.toLocaleString()} Track${needsPrep === 1 ? '' : 's'}`
                : 'Batch Is Ready';
        }
    }

    async function checkNewMusicAcrossHealth(button) {
        const paths = Array.isArray(currentHealthNewMusic?.paths) ? currentHealthNewMusic.paths : [];
        if (!paths.length) return showToast('No recent music batch is available yet.', true);
        showTab('era-review');
        const title = document.getElementById('era-review-title');
        const copy = document.getElementById('era-review-copy');
        if (title) title.textContent = 'New Music Health Review';
        if (copy) copy.textContent = 'Checking the latest batch across title, artist, BPM, key, year, duplicates, file connection, and era placement.';
        return runConnectedHealthCheck(paths, button, {
            connected_health_source: 'new_music',
            new_music_batch_id: String(currentHealthNewMusic?.batch_id || ''),
            new_music_batch_total: Number(currentHealthNewMusic?.total || paths.length),
        });
    }

    function prepareNewMusicBatch(button) {
        const paths = Array.isArray(currentHealthNewMusic?.paths) ? currentHealthNewMusic.paths : [];
        if (!paths.length) return showToast('No recent music batch is available yet.', true);
        return startUnifiedHealthScan('', button, paths, { flow: 'new_music' });
    }

    function overallHealthSnapshot(summary = currentHealthSummary || {}) {
        const eligible = Math.max(0, Number(summary?.health_eligible_tracks || 0));
        const affected = Math.max(0, Number(summary?.health_unique_affected_tracks || 0));
        const minimum = Math.max(1, Number(summary?.health_baseline_minimum_tracks || 1000));
        const greenMax = Number(summary?.health_green_max_percent ?? 5);
        const orangeMax = Number(summary?.health_orange_max_percent ?? 15);
        const computedRate = eligible > 0 ? (affected / eligible) * 100 : 0;
        const rate = Number.isFinite(Number(summary?.health_issue_rate_percent))
            ? Number(summary.health_issue_rate_percent)
            : computedRate;
        let state = String(summary?.health_overall_state || '').trim().toLowerCase();
        if (!['baseline', 'healthy', 'attention', 'bad'].includes(state)) {
            state = eligible < minimum
                ? 'baseline'
                : rate <= greenMax
                    ? 'healthy'
                    : rate <= orangeMax
                        ? 'attention'
                        : 'bad';
        }
        return { eligible, affected, minimum, rate, state };
    }

    function adjustHealthReviewAffectedCount(delta = 0) {
        if (axiomReviewMode() !== 'health') return;
        const overall = overallHealthSnapshot(currentHealthSummary);
        const affected = Math.max(0, overall.affected + Number(delta || 0));
        const rate = overall.eligible > 0 ? Number(((affected / overall.eligible) * 100).toFixed(2)) : 0;
        const state = overall.eligible < overall.minimum
            ? 'baseline'
            : rate <= Number(currentHealthSummary.health_green_max_percent ?? 5)
                ? 'healthy'
                : rate <= Number(currentHealthSummary.health_orange_max_percent ?? 15)
                    ? 'attention'
                    : 'bad';
        currentHealthSummary.health_unique_affected_tracks = affected;
        currentHealthSummary.health_issue_rate_percent = rate;
        currentHealthSummary.health_overall_state = state;
    }

    function setHealthText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    function healthHasAuthoritativeSnapshot() {
        const hasSummary = Object.keys(currentHealthSummary || {}).length > 0;
        return hasSummary && (lastHealthCheckAt > 0 || axiomReviewMode() === 'health');
    }

    function renderHealthSnapshotPendingState() {
        const shell = document.getElementById('health-inbox-app');
        if (!shell || healthHasAuthoritativeSnapshot()) return;
        const failed = healthSnapshotState === 'error';
        const loading = healthSnapshotState === 'loading';
        shell.dataset.healthSnapshotState = healthSnapshotState;
        shell.dataset.healthHasSnapshot = 'false';
        shell.setAttribute('aria-busy', loading ? 'true' : 'false');
        [
            'health-approved-improvements',
            'health-inbox-attention-count',
            'health-stat-total',
            'health-inbox-track-total',
            'health-stat-missing-file',
            'health-repair-bpm-count',
            'health-repair-key-count',
            'health-repair-year-count',
        ].forEach(id => setHealthText(id, '—'));
        setHealthText('health-readiness-title', failed ? 'Health Check Needs Attention' : loading ? 'Checking Your Library' : 'Scan Library Health');
        setHealthText('health-readiness-copy', failed
            ? (healthSnapshotError || 'Refresh Health to try the library check again.')
            : loading
                ? 'AXIOM is reading the latest Health snapshot. No completion will be claimed until the counts are ready.'
                : 'Start here on a new library. AXIOM will check missing files, BPM, key, year and review queues, then show what needs work.');
        setHealthText('health-inbox-last-checked', failed ? 'refresh failed' : loading ? 'checking now' : 'not scanned yet');
        setHealthText('health-approved-task-count', failed ? 'Counts unavailable' : loading ? 'Checking…' : 'Ready to scan');
        setHealthText('health-approved-working-title', failed ? 'Health check needs attention' : loading ? 'Checking Library Health' : 'Scan Health First');
        setHealthText('health-approved-working-artist', failed
            ? (healthSnapshotError || 'Refresh Health to try the library check again.')
            : loading
                ? 'Reading the latest AXIOM cache snapshot.'
                : 'No current Health snapshot has been built for this library yet.');
        setHealthText('health-approved-working-status', failed
            ? 'No completion claimed — current counts are unknown'
            : loading ? 'Counts will appear when the snapshot is ready' : 'Press Scan Health to build the first repair map');
        setHealthText('health-stat-total-label', loading ? 'repairs ready' : 'unknown until scan');
        const action = document.getElementById('health-approved-task-action');
        if (action) {
            action.disabled = loading;
            action.textContent = failed ? 'Retry Health' : loading ? 'Checking Health' : 'Scan Health';
        }
        const prepareButton = document.getElementById('health-prepare-library');
        if (prepareButton) {
            prepareButton.disabled = loading;
            prepareButton.dataset.healthAction = 'refresh';
            delete prepareButton.dataset.healthTarget;
            prepareButton.textContent = failed ? 'Retry Health' : loading ? 'Checking Library' : 'Scan Health';
            prepareButton.setAttribute('onclick', 'handleHealthReadinessPrimary(this)');
        }
        document.querySelectorAll('.health-approved-lanes [data-health-item]').forEach(button => {
            button.disabled = true;
        });
    }

    function setHealthSnapshotState(state, error = '') {
        healthSnapshotState = state;
        healthSnapshotError = error;
        const shell = document.getElementById('health-inbox-app');
        if (shell) {
            shell.dataset.healthSnapshotState = state;
            shell.dataset.healthHasSnapshot = healthHasAuthoritativeSnapshot() ? 'true' : 'false';
            shell.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
        }
        if (!healthHasAuthoritativeSnapshot()) renderHealthSnapshotPendingState();
    }

    function updateHealthRepairCenter(summary = currentHealthSummary || {}, state = null, copy = null) {
        const snap = healthSummarySnapshot(summary);
        const overall = overallHealthSnapshot(summary);
        const center = document.getElementById('health-repair-center');
        if (center) center.dataset.overallHealth = overall.state;
        const totalCard = document.querySelector('#health-repair-center .health-repair-center-card.ready');
        if (totalCard) totalCard.dataset.overallHealth = overall.state;
        if (overall.state === 'baseline') {
            setHealthText('health-overall-rate', 'Building Baseline');
            setHealthText('health-overall-detail', `${overall.eligible.toLocaleString()} / ${overall.minimum.toLocaleString()} eligible tracks`);
        } else {
            const label = overall.state === 'healthy' ? 'Healthy' : overall.state === 'attention' ? 'Needs Attention' : 'Bad';
            setHealthText('health-overall-rate', `${overall.rate.toFixed(1)}% Affected`);
            setHealthText('health-overall-detail', `${label} · ${overall.affected.toLocaleString()} of ${overall.eligible.toLocaleString()} tracks`);
        }
        setHealthText('health-repair-ready-count', snap.repair_ready.toLocaleString());
        setHealthText('health-repair-bpm-count', snap.bpm_attention.toLocaleString());
        setHealthText('health-repair-key-count', snap.key_attention.toLocaleString());
        setHealthText('health-repair-year-count', snap.missing_year.toLocaleString());
        document.getElementById('btn-fix-all-health')?.classList.toggle('hidden', snap.repair_ready <= 0);
        document.getElementById('health-repair-all-clear')?.classList.toggle('hidden', snap.repair_ready > 0);
        [
            ['bpm', snap.bpm_attention],
            ['key', snap.key_attention],
            ['year', snap.missing_year],
        ].forEach(([lane, count]) => {
            document.getElementById(`btn-fix-${lane}`)?.classList.toggle('hidden', count <= 0);
            document.getElementById(`health-repair-${lane}-clear`)?.classList.toggle('hidden', count > 0);
        });
        if (state) setHealthText('health-repair-center-state', state);
        if (copy) setHealthText('health-repair-center-copy', copy);
        const title = document.getElementById('health-repair-center-title');
        if (title) {
            const blockerCount = snap.total_blockers.toLocaleString();
            title.innerHTML = `<span class="overall-health-value">${blockerCount}</span> Improvement${snap.total_blockers === 1 ? '' : 's'} Needed`;
        }
        renderHealthApprovedWorkspace();
        renderHealthNewMusicIntake();
    }

    function healthIssueMetaForKey(key) {
        const map = {
            missing_file: { hType: 'Missing File', hColor: 'red' },
            missing_bpm: { hType: 'Missing BPM', hColor: 'green' },
            missing_key: { hType: 'Missing Key', hColor: 'blue' },
            missing_year: { hType: 'Missing Year', hColor: 'amber' },
            bpm_review: { hType: 'BPM Review', hColor: 'green' },
            key_review: { hType: 'Key Review', hColor: 'blue' },
        };
        return map[key] || { hType: 'Health Issue', hColor: 'amber' };
    }

    function normalizeHealthIssueTrack(track = {}, key = 'missing_file') {
        const base = typeof normalizeModalTrackMetadata === 'function'
            ? normalizeModalTrackMetadata(track || {})
            : { ...(track || {}) };
        const meta = healthIssueMetaForKey(key);
        const path = String(base.path || track.path || '');
        return {
            ...base,
            path,
            filename: base.filename || (path ? path.split('/').pop() : ''),
            title: base.title || base.name || base.filename || (path ? path.split('/').pop() : 'Unknown Track'),
            artist: base.artist || 'Unknown Artist',
            fKey: key,
            hType: meta.hType,
            hColor: meta.hColor,
        };
    }

    function healthPayloadSnapshot(data = {}) {
        return (data && typeof data.snapshot === 'object' && data.snapshot) ? data.snapshot : data;
    }

    function applyHealthPayload(data = {}) {
        const snapshot = healthPayloadSnapshot(data);
        const issues = snapshot.issues || {};
        const summary = { ...(snapshot.summary || {}) };
        const issueKeys = ['missing_file', 'missing_bpm', 'missing_key', 'missing_year', 'bpm_review', 'key_review'];
        const nextTracks = [];
        const affected = new Set();
        issueKeys.forEach(key => {
            const list = Array.isArray(issues[key]) ? issues[key] : [];
            if (!Number.isFinite(Number(summary[key]))) summary[key] = list.length;
            list.forEach(track => {
                const normalized = normalizeHealthIssueTrack(track, key);
                nextTracks.push(normalized);
                if (normalized.path) affected.add(normalized.path);
                else affected.add(`${key}:${normalized.title}:${normalized.artist}`);
            });
        });
        ['missing_file', 'missing_bpm', 'missing_key', 'missing_year', 'bpm_review', 'key_review', 'year_suggestions_ready'].forEach(key => {
            summary[key] = Math.max(0, Number(summary[key] || 0));
        });
        const totalFromPayload = Number(data.total || snapshot.total_tracks || snapshot.library_total_tracks || 0);
        const totalFromLibrary = (typeof allTracks !== 'undefined' && Array.isArray(allTracks)) ? allTracks.length : 0;
        const eligible = Math.max(0, Number(summary.health_eligible_tracks || totalFromPayload || totalFromLibrary || affected.size || 0));
        const uniqueAffected = Math.max(
            affected.size,
            Number(summary.health_unique_affected_tracks || 0),
            Math.min(eligible || Number.MAX_SAFE_INTEGER, healthSummarySnapshot(summary).total_blockers)
        );
        summary.health_eligible_tracks = eligible;
        summary.health_unique_affected_tracks = uniqueAffected;
        summary.health_issue_rate_percent = eligible > 0 ? Number(((uniqueAffected / eligible) * 100).toFixed(2)) : 0;
        if (!summary.health_overall_state) {
            summary.health_overall_state = eligible < Number(summary.health_baseline_minimum_tracks || 1000)
                ? 'baseline'
                : summary.health_issue_rate_percent <= Number(summary.health_green_max_percent ?? 5)
                    ? 'healthy'
                    : summary.health_issue_rate_percent <= Number(summary.health_orange_max_percent ?? 15)
                        ? 'attention'
                        : 'bad';
        }
        summary.health_baseline_minimum_tracks = Number(summary.health_baseline_minimum_tracks || 1000);
        currentHealthSummary = summary;
        currentHealthNewMusic = snapshot.new_music || {};
        currentHealthTracks = nextTracks;
        visibleHealthTracks = [];
        currentHealthTruncated = snapshot.truncated_issues || data.truncated_issues || {};
        selectedHealthPaths.clear();
        lastSelectedHealthIndex = -1;
        lastHealthCheckAt = Date.now();
        setHealthSnapshotState('ready');
        setHealthText('health-inbox-track-total', eligible.toLocaleString());
        setHealthText('health-stat-total-legacy', healthSummarySnapshot(summary).total_blockers.toLocaleString());
        setHealthText('health-stat-missing-file-legacy', summary.missing_file.toLocaleString());
        setHealthText('health-stat-missing-bpm-legacy', summary.missing_bpm.toLocaleString());
        setHealthText('health-stat-missing-key-legacy', summary.missing_key.toLocaleString());
        setHealthText('health-stat-missing-year-legacy', summary.missing_year.toLocaleString());
        updateHealthRepairCenter(summary, 'Library Health', healthSummarySnapshot(summary).total_blockers
            ? 'Health found repairable library issues. Pick a lane or run Scan All Health.'
            : 'Health is clear for the currently connected AXIOM library.');
        updateHealthSelectionUI();
        loadHealthUtilityAudit({ force: false });
        loadRemovedFromAxiomBin({ force: false });
        if (typeof loadHealthGenreSummary === 'function') loadHealthGenreSummary({ force: false });
        return { summary, tracks: nextTracks, snapshot };
    }

    function updateHealthPriorityPanel(summary = currentHealthSummary || {}) {
        const snap = healthSummarySnapshot(summary);
        const visibleCount = currentHealthTracks.length;
        setHealthText('health-priority-repair-count', snap.repair_ready.toLocaleString());
        setHealthText('health-priority-file-count', snap.missing_file.toLocaleString());
        setHealthText('health-priority-visible-count', visibleCount.toLocaleString());
        let title = 'Run Library Health';
        let copy = 'Refresh Health to see the safest repair order for your library. AXIOM will keep source audio untouched.';
        let label = 'Refresh Health';
        let action = (button) => runLibraryHealthCheck({ force: true, triggerBtn: button });
        if (snap.missing_file > 0) {
            title = 'Reconnect or remove missing files';
            copy = `${snap.missing_file.toLocaleString()} missing file${snap.missing_file === 1 ? '' : 's'} can break previews, exports, and set handoff. Review them before metadata repair.`;
            label = 'Review Missing Files';
            action = () => selectHealthInboxItem('missing_file');
        } else if (snap.missing_bpm > 0) {
            title = 'Fix missing BPM next';
            copy = `${snap.missing_bpm.toLocaleString()} track${snap.missing_bpm === 1 ? '' : 's'} need tempo intelligence. AXIOM will use trusted DJ data and local analysis without editing audio files.`;
            label = 'Scan BPM';
            action = (button) => startUnifiedHealthScan('missing_bpm', button);
        } else if (snap.missing_key > 0) {
            title = 'Fix missing keys';
            copy = `${snap.missing_key.toLocaleString()} track${snap.missing_key === 1 ? '' : 's'} need a Camelot key. AXIOM will assign its strongest detection and keep confidence as information.`;
            label = 'Scan Keys';
            action = (button) => startUnifiedHealthScan('missing_key', button);
        } else if (snap.missing_year > 0) {
            title = 'Fix missing years';
            copy = `${snap.missing_year.toLocaleString()} track${snap.missing_year === 1 ? '' : 's'} need release-year evidence for era control and Year Publish readiness.`;
            label = 'Scan Years';
            action = (button) => startUnifiedHealthScan('missing_year', button);
        } else if (Number(currentHealthCleanupAudit?.cleanable?.title_cleanup || 0) || Number(currentHealthCleanupAudit?.cleanable?.artist_format || 0)) {
            title = 'Clean display metadata';
            copy = 'Title cleanup and name-format candidates are ready inside Health. These are AXIOM-cache-only cleanup actions.';
            label = 'Open Cleanup';
            action = () => toggleHealthApprovedTools(true);
        } else {
            title = 'Health is clear';
            copy = 'No missing file, BPM, key, or year blockers are waiting in the current Health snapshot.';
            label = 'Refresh Again';
        }
        setHealthText('health-priority-title', title);
        setHealthText('health-priority-copy', copy);
        const button = document.getElementById('health-priority-action');
        if (button) {
            button.textContent = label;
            button.onclick = () => action(button);
        }
    }

    function healthRefreshButtons() {
        return [
            document.getElementById('btn-health-refresh'),
            document.getElementById('btn-health-refresh-legacy')
        ].filter(Boolean);
    }

    async function checkHealthAudioReadiness(trigger = null) {
        if (checkHealthAudioReadiness.loading) return;
        checkHealthAudioReadiness.loading = true;
        const status = document.getElementById('health-audio-check-status');
        if (status) { status.hidden = false; status.textContent = 'Loading songs for the audio check...'; }
        if (trigger) trigger.disabled = true;
        try {
            const response = await fetch('/api/library/health/audio_sources');
            const data = await response.json();
            if (!response.ok || !Array.isArray(data.tracks)) throw new Error(data.error || 'Could not load Library audio.');
            if (!data.tracks.length) throw new Error('Add music to the Library first.');
            if (status) { status.textContent = ''; status.hidden = true; }
            await window.AxiomAudioReadiness.review(data.tracks);
        } catch (error) {
            const message = error.message || 'Could not load Library audio. Try again.';
            if (status) { status.hidden = false; status.textContent = message; }
            showToast(message, true);
        } finally {
            checkHealthAudioReadiness.loading = false;
            if (trigger) trigger.disabled = false;
        }
    }

    async function runLibraryHealthCheck(options = {}) {
        const opts = typeof options === 'object' && options !== null ? options : {};
        const force = opts.force === true;
        const silent = opts.silent === true;
        const skipProgress = opts.skipProgress === true;
        if (!force && lastHealthCheckAt && Object.keys(currentHealthSummary || {}).length && Date.now() - lastHealthCheckAt < HEALTH_AUTO_REFRESH_MS) {
            setHealthSnapshotState('ready');
            updateHealthRepairCenter(currentHealthSummary);
            updateHealthSelectionUI();
            return { summary: currentHealthSummary, issues: currentHealthTracks };
        }
        if (healthCheckInFlight) return healthCheckInFlight;
        setHealthSnapshotState('loading');
        if (typeof renderHealthApprovedWorkspace === 'function') renderHealthApprovedWorkspace();
        if (healthScanPollTimer) {
            window.clearTimeout(healthScanPollTimer);
            healthScanPollTimer = null;
        }
        const buttons = opts.triggerBtn ? [opts.triggerBtn] : healthRefreshButtons();
        healthCheckInFlight = (async () => {
            buttons.forEach(button => setAxiomButtonBusy(button, true, 'Checking...'));
            if (!skipProgress) {
                setHealthProgressMetricLabels('Checked', 'Issues', 'Fixed', 'Still Missing');
                updateHealthProgressMetrics({}, false);
                setHealthProgressState(3, 'Checking Library Health...', 'AXIOM accepted the Health refresh and is reading the library cache. Source audio stays untouched.', 'CHECKING');
                startHealthProgressPulse('CHECKING HEALTH');
            }
            try {
                let url = `/api/library/health${force ? '?force=1' : ''}`;
                for (let attempt = 0; attempt < 180; attempt += 1) {
                    const reviewOnly = typeof axiomReviewMode === 'function' && axiomReviewMode() === 'health';
                    if (reviewOnly) await new Promise(resolve => window.setTimeout(resolve, 600));
                    const resp = reviewOnly
                        ? { ok: true, json: async () => ({ status: 'complete', summary: currentHealthSummary,
                            issues: Object.fromEntries(['missing_file', 'missing_bpm', 'missing_key', 'missing_year', 'bpm_review', 'key_review'].map(key => [key, currentHealthTracks.filter(track => track.fKey === key)])),
                            new_music: currentHealthNewMusic }) }
                        : await fetch(url, { cache: 'no-store' });
                    const data = await resp.json().catch(() => ({}));
                    if (!resp.ok || data.success === false) throw new Error(data.error || data.message || 'Health check failed');
                    const status = String(data.status || '').toLowerCase();
                    if (status === 'error' || status === 'failed') throw new Error(data.error || 'Health check failed. Previous results have been kept.');
                    if (!['complete', 'scanning', 'starting', 'running'].includes(status)) throw new Error('Health returned an incomplete scan status. Refresh Health to try again.');
                    const progress = Number(data.progress || 0);
                    const total = Number(data.total || 0);
                    const percent = total > 0 ? Math.min(99, Math.round((progress / total) * 100)) : Math.min(92, 6 + attempt);
                    if (status === 'complete' && data.stale !== true) {
                        const summary = data.summary || data.snapshot?.summary;
                        if (!summary || typeof summary !== 'object' || Array.isArray(summary)) throw new Error('Health results are incomplete. Previous results have been kept.');
                        const applied = applyHealthPayload(data);
                        if (!skipProgress) {
                            const blockerCount = healthSummarySnapshot(applied.summary).total_blockers;
                            setHealthProgressState(100, 'Health check complete', blockerCount > 0 ? `${blockerCount.toLocaleString()} issues found. Review the repair plan.` : 'No new issues found. Your library is healthy.', 'COMPLETE');
                            stopHealthProgressPulse('complete');
                        }
                        if (!silent) showToast(healthSummarySnapshot(applied.summary).total_blockers > 0 ? 'Health check complete. Your findings are ready.' : 'No new issues found. Your library is healthy.');
                        return applied;
                    }
                    if (!skipProgress) {
                        setHealthProgressState(percent, 'Checking Library Health...', total > 0
                            ? `Checked ${progress.toLocaleString()} of ${total.toLocaleString()} tracks.`
                            : 'Health is preparing the scan worker.', 'CHECKING');
                    }
                    url = '/api/library/health';
                    await new Promise(resolve => { healthScanPollTimer = window.setTimeout(resolve, 650); });
                }
                throw new Error('Health is still scanning. Keep AXIOM open and refresh again shortly.');
            } catch (err) {
                if (!skipProgress) stopHealthProgressPulse('error');
                if (healthHasAuthoritativeSnapshot()) {
                    setHealthSnapshotState('ready');
                } else {
                    setHealthSnapshotState('error', err.message || 'Health check failed');
                }
                showToast(err.message || 'Health check failed', true);
                return { summary: currentHealthSummary, issues: currentHealthTracks, error: err.message || 'Health check failed' };
            } finally {
                buttons.forEach(button => setAxiomButtonBusy(button, false));
                healthCheckInFlight = null;
                healthScanPollTimer = null;
                if (typeof renderHealthApprovedWorkspace === 'function') renderHealthApprovedWorkspace();
            }
        })();
        return healthCheckInFlight;
    }
