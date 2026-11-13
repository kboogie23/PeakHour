    // Health repair reports, issue actions, Core Audio, and cache maintenance.
    function healthRepairLabel(type) {
        if (type === 'Missing BPM') return 'BPM';
        if (type === 'Missing Key') return 'Keys';
        if (type === 'Missing Year') return 'Years';
        return 'Repair';
    }

    function healthRepairResultText(item, type) {
        if (type === 'Missing BPM') {
            const bpm = Number(item.after_bpm || 0);
            return bpm > 0 ? `${bpm.toFixed(1)} BPM` : 'No BPM Found';
        }
        if (type === 'Missing Key') return item.after_key || 'No Key Found';
        if (type === 'Missing Year') {
            if (item.outcome_state === 'provider_timeout' || item.outcome_state === 'retry_pending') return 'Awaiting Retry';
            if (item.outcome_state === 'reviewed_no_match') return 'Reviewed · No Match';
            if (item.outcome_state === 'missing_metadata') return 'Missing Artist / Title';
            if (item.outcome_state === 'year_not_applicable') return 'Year Not Applicable';
            if (item.outcome_state === 'file_disconnected') return 'File Disconnected';
            if (item.year && item.estimated) return `Estimated ${item.year}`;
            if (item.year) return `${item.year}`;
            if (item.suggested_year) return `Suggested ${item.suggested_year}`;
            return 'No Year Found';
        }
        return item.updated ? 'Updated' : 'Needs Review';
    }

    function healthRepairMetaText(item, type) {
        if (type === 'Missing BPM') {
            const source = item.bpm_source ? ` · Source ${item.bpm_source.replaceAll('_', ' ')}` : '';
            const confidence = item.bpm_confidence ? ` · ${item.bpm_confidence}% confidence` : '';
            const reason = item.reason ? ` · Reason: ${item.reason}` : '';
            const next = item.next_action ? ` · Next: ${item.next_action}` : '';
            return `${item.message || 'Checked BPM'} · Before ${item.before_bpm || '--'} -> After ${item.after_bpm || '--'}${source}${confidence}${reason}${next}`;
        }
        if (type === 'Missing Key') {
            const fileType = item.file_type ? ` · File ${item.file_type}` : '';
            // Detection confidence and estimate provenance remain backend diagnostics.
            if (item.after_key) return `Key saved · Before ${item.before_key || '--'} -> After ${item.after_key}${fileType}`;
            const reason = item.reason ? ` · Reason: ${item.reason}` : '';
            const next = item.next_action ? ` · Next: ${item.next_action}` : '';
            return `No key found${fileType}${reason}${next}`;
        }
        if (type === 'Missing Year') {
            const outcome = item.outcome_state ? ` · State ${healthYearStateLabel(item.outcome_state)}` : '';
            const confidence = item.confidence ? ` · ${item.confidence}%` : '';
            const source = item.source ? ` · Source ${String(item.source).replace('_', ' ')}` : '';
            const search = item.normalized_title ? ` · Searched ${item.normalized_artist ? `${item.normalized_artist} - ` : ''}${item.normalized_title}` : '';
            const reason = item.reason ? ` · Reason: ${item.reason}` : '';
            const next = item.next_action ? ` · Next: ${item.next_action}` : '';
            const suggestion = item.suggested_year
                ? `Likely ${item.suggested_year}: ${item.matched_title || item.normalized_title || 'title match'}${item.matched_artist ? ` by ${item.matched_artist}` : ''}${confidence}${source}. ${item.suggestion_reason || ''}`
                : '';
            if (suggestion) return `${suggestion}${search}${outcome}${next}`;
            if (item.estimated && item.year) {
                return `AXIOM applied a review-grade estimate from ${String(item.source || 'the strongest available clue').replaceAll('_', ' ')}${confidence}${search}.`;
            }
            return item.matched_title
                ? `Matched ${item.matched_title}${confidence}${source}${search}`
                : `${item.message || item.error || 'No confident match'}${search}${outcome}${reason}${next}`;
        }
        return item.message || '';
    }

    function renderHealthRepairRows(results = [], type = '') {
        if (!results.length) {
            const isAnalysis = type === 'Missing BPM' || type === 'Missing Key';
            return `
                <div class="health-repair-row">
                    <div>
                        <strong>No track details returned</strong>
                        <span>AXIOM finished the batch but did not receive row-level details.</span>
                    </div>
                    <div class="health-repair-result">${isAnalysis ? 'No Result' : 'Review Later'}</div>
                </div>
            `;
        }

        const orderedResults = type === 'Missing Year'
            ? [...results].sort((a, b) => Number(Boolean(b.suggested_year)) - Number(Boolean(a.suggested_year)))
            : results;
        return orderedResults.slice(0, 50).map(item => {
            const title = escapeHtml(item.title || (item.path || '').split(/[\\/]/).pop() || 'Unknown Track');
            const artist = escapeHtml(item.artist || 'Unknown Artist');
            const resultText = escapeHtml(healthRepairResultText(item, type));
            const metaText = escapeHtml(healthRepairMetaText(item, type));
            const suggestionAction = type === 'Missing Year' && item.suggested_year && item.path
                ? `<button type="button" data-year-suggestion="true" onclick="applyYearSuggestion('${escapeJs(item.path)}', ${Number(item.suggested_year)}, this)">Use ${Number(item.suggested_year)}</button>`
                : '';
            const warning = item.bpm_timing_warning
                ? `<div class="health-repair-warning">${escapeHtml(item.bpm_timing_warning)}</div>`
                : '';
            return `
                <div class="health-repair-row" data-health-year-path="${escapeHtml(item.path || '')}">
                    <div>
                        <strong>${title}</strong>
                        <span>${artist} · ${metaText}</span>
                    </div>
                    <div class="health-repair-result">${resultText}${suggestionAction}
                        ${item.path ? `<button type="button" data-health-file="${escapeHtml(item.path)}" onclick="revealHealthFile(this.dataset.healthFile, this)">Reveal in Finder</button>` : ''}
                        ${type === 'Missing Year' && !item.year && item.path ? `<button type="button" class="health-detail-action danger" onclick="removeSingleHealthReviewTrack('${escapeJs(item.path)}', this)">Remove from AXIOM</button>` : ''}</div>
                    ${warning}
                </div>
            `;
        }).join('');
    }

    function hideHealthRepairReview() {
        currentHealthRepairReview = null;
        document.getElementById('health-repair-review')?.classList.add('hidden');
    }

    function openHealthRepairReport() {
        const review = document.getElementById('health-repair-review');
        if (review && !review.classList.contains('hidden') && review.innerText.trim()) {
            review.scrollIntoView({ behavior: 'smooth', block: 'center' });
            showToast('Showing latest repair batch report.');
            return;
        }
        showToast('Run a BPM, key, or year repair batch first. The report appears here after AXIOM checks tracks.', true);
    }

    function closeBrowserParityModal() {
        document.getElementById('browser-parity-modal')?.remove();
    }

    function parityLabel(name) {
        return String(name || '')
            .replace(/_/g, ' ')
            .replace(/\b\w/g, ch => ch.toUpperCase());
    }

    function renderBrowserParityModal(data) {
        const existing = document.getElementById('browser-parity-modal');
        if (existing) existing.remove();

        const checks = Array.isArray(data?.checks) ? data.checks : [];
        const limits = Array.isArray(data?.limitations) ? data.limitations : [];
        const passed = checks.filter(check => check.ok).length;
        const total = checks.length;
        const statusCopy = data?.success
            ? 'Browser checks passed for the currently connected library.'
            : 'Some browser checks need a connected music folder or a repair pass.';
        const overlay = document.createElement('div');
        overlay.id = 'browser-parity-modal';
        overlay.className = 'browser-parity-modal';
        overlay.innerHTML = `
            <div class="browser-parity-panel" role="dialog" aria-modal="true" aria-labelledby="browser-parity-title">
                <div class="browser-parity-head">
                    <div>
                        <div class="browser-parity-kicker">PEAK HOUR Browser Check</div>
                        <div id="browser-parity-title" class="browser-parity-title">Parity Check</div>
                        <div class="browser-parity-copy">${escapeHtml(data?.message || statusCopy)}</div>
                        <div class="browser-parity-copy">${data?.sampled ? `Checked ${Number(data.sampled).toLocaleString()} sample songs` : 'No songs checked'}${data?.elapsed_ms !== undefined ? ` · ${Number(data.elapsed_ms).toLocaleString()} ms` : ''}</div>
                    </div>
                    <button type="button" class="browser-parity-close" onclick="closeBrowserParityModal()" aria-label="Close browser parity report">x</button>
                </div>
                <div class="browser-parity-stats">
                    <div class="browser-parity-stat">
                        <strong>${passed}/${total || 0}</strong>
                        <span>Systems Passing</span>
                    </div>
                    <div class="browser-parity-stat">
                        <strong>${Number(data?.total_tracks || 0).toLocaleString()}</strong>
                        <span>Tracks Indexed</span>
                    </div>
                    <div class="browser-parity-stat">
                        <strong>${Number(data?.playable_tracks || 0).toLocaleString()}</strong>
                        <span>Playable Tracks</span>
                    </div>
                </div>
                <div class="browser-parity-list">
                    ${checks.map(check => `
                        <div class="browser-parity-row">
                            <div><span class="browser-parity-badge ${check.ok ? '' : 'warn'}">${check.ok ? 'Pass' : 'Check'}</span></div>
                            <div>
                                <strong>${escapeHtml(parityLabel(check.name))}</strong>
                                <span>${escapeHtml(check.detail || '')}</span>
                            </div>
                        </div>
                    `).join('') || `
                        <div class="browser-parity-row">
                            <div><span class="browser-parity-badge warn">Check</span></div>
                            <div>
                                <strong>No Report</strong>
                                <span>PEAK HOUR could not read the browser check details from this session.</span>
                            </div>
                        </div>
                    `}
                </div>
                <div class="browser-parity-kicker">Browser Limits</div>
                <div class="browser-parity-limits">
                    ${limits.map(limit => `<div class="browser-parity-limit">${escapeHtml(limit)}</div>`).join('') || `<div class="browser-parity-limit">No browser-specific limits reported.</div>`}
                </div>
            </div>
        `;
        overlay.addEventListener('click', event => {
            if (event.target === overlay) closeBrowserParityModal();
        });
        document.body.appendChild(overlay);
    }

    async function runBrowserParityCheck() {
        showToast('Running PEAK HOUR browser check...');
        try {
            const resp = await fetch('/api/browser/self_test', { method: 'POST' });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success === false && !Array.isArray(data.checks)) {
                throw new Error(data.error || data.message || 'Browser check failed');
            }
            renderBrowserParityModal(data);
        } catch (err) {
            renderBrowserParityModal({
                success: false,
                total_tracks: typeof allTracks !== 'undefined' && Array.isArray(allTracks) ? allTracks.length : 0,
                playable_tracks: 0,
                checks: [
                    {
                        name: 'browser_check',
                        ok: false,
                        detail: 'PEAK HOUR did not answer the browser check. Restart PEAK HOUR and run the check again.'
                    }
                ],
                limitations: [
                    'Folder choosing, playback, and DJ software handoff need PEAK HOUR itself to be running.'
                ],
                message: err?.message || 'Browser check could not complete.'
            });
            showToast('Browser check needs attention.', true);
        }
    }

    function showHealthRepairReview({ type, batchSize, processed, fixed, unresolved, remaining, results = [], retryMisses = false, suggested = null, estimated = 0, staleRowsRemoved = 0, seratoMatched = 0, djayMatched = 0 }) {
        const review = document.getElementById('health-repair-review');
        if (!review) return;
        const label = healthRepairLabel(type);
        const isYear = type === 'Missing Year';
        const isAnalysis = type === 'Missing BPM' || type === 'Missing Key';
        const suggestionCount = isYear
            ? (suggested === null ? results.filter(item => Number(item.suggested_year || 0) > 0).length : Number(suggested || 0))
            : 0;
        const noMatchCount = isYear ? Math.max(0, Number(unresolved || 0) - suggestionCount) : Number(unresolved || 0);
        currentHealthRepairReview = {
            type,
            batchSize,
            processed: Number(processed || 0),
            fixed: Number(fixed || 0),
            unresolved: Number(unresolved || 0),
            remaining: Number(remaining || 0),
            results: Array.isArray(results) ? results : [],
            retryMisses,
            suggested: suggestionCount,
            estimated: Number(estimated || 0),
            staleRowsRemoved: Number(staleRowsRemoved || 0),
            seratoMatched: Number(seratoMatched || 0),
            djayMatched: Number(djayMatched || 0),
        };
        const remainingText = Number(remaining || 0) > 0
            ? isAnalysis
                ? `${Number(remaining || 0).toLocaleString()} returned no usable ${type === 'Missing BPM' ? 'BPM' : 'key'} candidate.`
                : `${Number(remaining || 0).toLocaleString()} still need another clue.`
            : 'No more known tracks left in this group.';
        const djEvidenceCopy = Number(seratoMatched || 0) || Number(djayMatched || 0)
            ? `Exact-file DJ evidence: Serato ${Number(seratoMatched || 0).toLocaleString()} · djay Pro ${Number(djayMatched || 0).toLocaleString()}. `
            : '';
        const reviewCopy = djEvidenceCopy + (isAnalysis
            ? 'AXIOM applied the strongest available BPM/key candidate to every readable song. Any remaining item has no usable candidate or is disconnected; edit the value manually when needed. No per-track approval is required.'
            : type === 'Missing Year'
                ? `${Number(estimated || 0).toLocaleString()} review-grade estimate${Number(estimated || 0) === 1 ? '' : 's'} applied inside AXIOM. ${suggestionCount.toLocaleString()} suggestion${suggestionCount === 1 ? '' : 's'} remain for review. ${noMatchCount.toLocaleString()} track${noMatchCount === 1 ? '' : 's'} still need another source.`
                : 'Rows that say "No BPM Found", "No Key Found", or "No Year Found" were checked but still need review or manual entry.');
        const reviewTitle = isAnalysis
            ? `Checked ${Number(processed || 0).toLocaleString()} track${Number(processed || 0) === 1 ? '' : 's'} · Updated ${Number(fixed || 0).toLocaleString()} · No Usable Result ${Number(unresolved || 0).toLocaleString()}`
            : isYear
            ? `Years fixed ${Number(fixed || 0).toLocaleString()} · Suggestions ready ${suggestionCount.toLocaleString()} · Stale rows removed ${Number(staleRowsRemoved || 0).toLocaleString()} · Still unresolved ${Number(remaining || 0).toLocaleString()}`
            : `Checked ${Number(processed || 0).toLocaleString()} track${Number(processed || 0) === 1 ? '' : 's'} · Updated ${Number(fixed || 0).toLocaleString()} · Needs Review ${Number(unresolved || 0).toLocaleString()}`;

        review.innerHTML = `
            <div class="health-repair-head">
                <div>
                    <div class="health-repair-kicker">${escapeHtml(label)} ${isAnalysis ? 'Batch Results' : 'Batch Review'}</div>
                    <div class="health-repair-title">${reviewTitle}</div>
                    <div class="health-repair-subtitle">${remainingText} ${escapeHtml(reviewCopy)} Source audio stayed untouched.</div>
                </div>
                <div class="health-repair-actions">
                    ${suggestionCount ? `<button type="button" class="primary" onclick="applyAllYearSuggestions(this)">Apply ${suggestionCount.toLocaleString()} Suggestion${suggestionCount === 1 ? '' : 's'}</button>` : ''}
                    ${Number(remaining || 0) > 0 ? '<button type="button" onclick="syncSeratoLibraryFolderToAxiom(this)">Choose Database V2</button>' : ''}
                    <button type="button" onclick="hideHealthRepairReview()">Close</button>
                </div>
            </div>
            <div class="health-repair-list">${renderHealthRepairRows(results, type)}</div>
        `;
        review.classList.remove('hidden');
    }

    function handleHealthItemClick(event, index) {
        const path = visibleHealthTracks[index]?.path;
        if (!path) return;

        // Prevent selection if clicking a button inside the row
        if (event.target.closest('button') || event.target.closest('input')) return;

        if (event.shiftKey && lastSelectedHealthIndex !== -1) {
            const start = Math.min(index, lastSelectedHealthIndex);
            const end = Math.max(index, lastSelectedHealthIndex);
            for (let i = start; i <= end; i++) {
                if (visibleHealthTracks[i]?.path) selectedHealthPaths.add(visibleHealthTracks[i].path);
            }
        } else {
            if (selectedHealthPaths.has(path)) {
                selectedHealthPaths.delete(path);
            } else {
                selectedHealthPaths.add(path);
            }
            lastSelectedHealthIndex = index;
        }
        updateHealthSelectionUI();
    }

    function healthYearStateLabel(state = '') {
        return ({
            confirmed: 'Confirmed',
            approximate: 'Approximate',
            suggested: 'Suggested',
            reviewed_no_match: 'Reviewed · No Match',
            missing_metadata: 'Missing Artist / Title',
            local_unreleased: 'Local / Unreleased',
            provider_timeout: 'Provider Timeout',
            retry_pending: 'Awaiting Retry',
            year_not_applicable: 'Year Not Applicable',
            file_disconnected: 'File Disconnected',
            not_checked: 'Ready To Check',
        })[String(state || '')] || 'Ready To Check';
    }

    function renderHealthIssue(track, type, color, index) {
        const colorClasses = {
            'red': 'border-red-500/30 text-red-500',
            'green': 'border-green-500/30 text-green-500',
            'blue': 'border-blue-500/30 text-blue-500',
            'amber': 'border-amber-400/30 text-amber-300'
        };
        const isSelected = selectedHealthPaths.has(track.path);
        const safePath = escapeJs(track.path || '');
        const safePathHtml = escapeHtml(track.path || '');
        const safeTitle = escapeHtml(track.title || track.filename || 'Unknown Track');
        const safeInputId = String(track.path || '').replace(/[^a-z0-9]/gi, '');

        return `
            <div onclick="handleHealthItemClick(event, ${index})"
                 data-path="${safePathHtml}"
                 class="health-item glass p-3 flex items-center justify-between border-l-4 ${colorClasses[color]} cursor-pointer select-none transition-all ${isSelected ? 'bg-axiom-accent/10 border-axiom-accent' : 'hover:bg-white/5'}">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1">
                        <span class="text-[8px] font-black uppercase px-2 py-0.5 bg-black border ${colorClasses[color]}">${type}</span>
                        <span class="text-white text-[11px] font-bold truncate">${safeTitle}</span>
                        ${type === 'Missing Year' ? `<span class="text-[8px] font-black uppercase px-2 py-0.5 rounded border border-amber-400/25 text-amber-200" title="${escapeHtml(track.year_health_reason || track.suggested_year_reason || 'Ready for a release-year check.')}">${escapeHtml(healthYearStateLabel(track.year_health_state || (track.suggested_year ? 'suggested' : 'not_checked')))}</span>` : ''}
                    </div>
                    <div class="text-[9px] text-axiom-muted truncate font-mono">${safePathHtml}</div>
                </div>
                <div class="flex items-center gap-2 ml-4">
                    ${type === 'Missing BPM' ? `
                        <div class="flex items-center bg-black border border-white/10 rounded px-2 mr-2" title="Enter BPM manually. Source audio remains untouched.">
                            <input type="number" id="manual-bpm-${safeInputId}" placeholder="BPM" class="w-12 bg-transparent text-[10px] text-axiom-accent font-black py-1 outline-none">
                            <button onclick="saveManualBPM('${safePath}', this)" class="text-[8px] font-black text-axiom-accent ml-1 hover:underline">SET</button>
                        </div>
                    ` : ''}

                    ${type === 'Missing BPM' || type === 'Missing Key' ? `
                        <button onclick="quickFixTrack('${safePath}', this)" class="px-3 py-2 bg-axiom-accent/15 border border-axiom-accent/30 text-axiom-accent text-[8px] font-black uppercase rounded-lg hover:bg-axiom-accent hover:text-black transition-all" title="Refresh BPM and key together. Source audio remains untouched.">
                            Quick Fix
                        </button>
                    ` : ''}

                    ${type === 'Missing Year' ? `
                        <div class="flex items-center bg-black border border-amber-400/25 rounded px-2 mr-2" title="Enter release year manually. Source audio remains untouched.">
                            <input type="number" id="manual-year-${safeInputId}" value="${Number(track.suggested_year || 0) || ''}" placeholder="Year" min="1900" max="2100" class="w-14 bg-transparent text-[10px] text-amber-300 font-black py-1 outline-none">
                            <button onclick="saveManualYear('${safePath}', this)" class="px-3 py-2 ml-2 bg-amber-300 text-black text-[8px] font-black uppercase rounded hover:brightness-110">Set Year</button>
                        </div>
                        ${track.suggested_year ? `
                            <button onclick="applyYearSuggestion('${safePath}', ${Number(track.suggested_year)}, this)" class="px-3 py-2 bg-axiom-accent text-black text-[8px] font-black uppercase rounded hover:brightness-110" title="${escapeHtml(track.suggested_year_reason || 'Apply the strongest title match inside AXIOM.')}">
                                Use ${Number(track.suggested_year)}
                            </button>
                        ` : ''}
                        <button onclick="fetchHealthYear('${safePath}', this)" class="px-3 py-2 bg-amber-400/15 border border-amber-400/30 text-amber-300 text-[8px] font-black uppercase rounded-lg hover:bg-amber-300 hover:text-black transition-all" title="Find release year and rebuild era inside AXIOM. Source audio remains untouched.">
                            Find year
                        </button>
                    ` : ''}

                    <button type="button" data-health-file="${safePathHtml}" onclick="event.stopPropagation(); revealHealthFile(this.dataset.healthFile, this)" class="health-reveal-file">Reveal in Finder</button>
                    ${track.bpm > 0 && type === 'Missing BPM' ? `
                        <button onclick="fixTrack('${safePath}', 'double_bpm', this)" class="px-2 py-1 bg-white/5 text-[9px] font-black uppercase rounded hover:bg-axiom-accent hover:text-black transition-all" title="Double BPM inside AXIOM only.">x2</button>
                        <button onclick="fixTrack('${safePath}', 'halve_bpm', this)" class="px-2 py-1 bg-white/5 text-[9px] font-black uppercase rounded hover:bg-axiom-accent hover:text-black transition-all" title="Halve BPM inside AXIOM only.">/2</button>
                    ` : ''}

                    ${type === 'Missing File' ? `
                        <button onclick="event.stopPropagation(); removeSingleMissingFileFromAxiom('${safePath}')" class="px-3 py-2 bg-red-500/15 border border-red-400/30 text-red-300 text-[8px] font-black uppercase rounded-lg hover:bg-red-400 hover:text-black transition-all" title="Remove this missing entry from AXIOM's cache only. Source audio and Serato stay untouched.">
                            Remove From AXIOM
                        </button>
                    ` : `
                        <button onclick="event.stopPropagation(); removeSingleHealthReviewTrack('${safePath}', this)" class="px-3 py-2 bg-orange-500/15 border border-orange-400/30 text-orange-300 text-[8px] font-black uppercase rounded-lg hover:bg-orange-400 hover:text-black transition-all" title="Remove from AXIOM until restored from Restore Bin. The file stays on your disk.">
                            Remove From AXIOM
                        </button>
                    `}
                    ${type === 'Missing BPM' || type === 'Missing Key' || type === 'Missing Year' ? `
                        <button onclick="event.stopPropagation(); ignoreHealthIssue('${safePath}', '${track.fKey}', this)" class="px-3 py-2 bg-axiom-accent/15 border border-axiom-accent/30 text-axiom-accent text-[8px] font-black uppercase rounded-lg hover:bg-axiom-accent hover:text-black transition-all" title="Remove this warning from Health. The track stays in AXIOM.">
                            Remove From Health
                        </button>
                    ` : ''}
                    <button onclick="event.stopPropagation(); confirmBanFolder('${safePath}')" class="p-2 hover:bg-red-500/20 rounded-lg transition-all text-red-500 group" title="Ban Parent Folder: Add this folder to the blacklist and remove all its tracks.">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/></svg>
                    </button>
                </div>
            </div>
        `;
    }

    async function batchBanSelected() {
        if (batchBanSelected.busy || !selectedHealthPaths.size) return;
        batchBanSelected.busy = true;
        const paths = Array.from(selectedHealthPaths);
        const progContainer = document.getElementById('health-progress-container');
        const progBar = document.getElementById('health-progress-bar');
        const progPercent = document.getElementById('health-progress-percent');
        const progLabel = document.getElementById('health-progress-label');
        try {
            const confirmed = await showAxiomConfirm('Exclude Selected Folders',
                `Exclude the parent folders of ${paths.length} selected tracks from AXIOM? All tracks in those folders leave AXIOM's index. Files on disk and DJ libraries stay unchanged.`,
                'Exclude Folders', 'danger');
            if (!confirmed) return;
            if (progContainer) progContainer.classList.remove('hidden');
            if (progBar) progBar.style.width = '0%';
            if (progPercent) progPercent.innerText = '0%';
            if (progLabel) progLabel.innerText = `Excluding ${paths.length} selected folder sources...`;
            let count = 0;
            let failed = 0;
            for (const p of paths) {
                try {
                    const response = await fetch('/api/library/ban_folder', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: p })
                    });
                    const data = await response.json();
                    if (!response.ok || data.success !== true) throw new Error(data.error || 'Folder exclusion failed.');
                    selectedHealthPaths.delete(p);
                } catch (error) {
                    failed++;
                }
                count++;
                const pct = Math.round((count / Math.max(1, paths.length)) * 100);
                if (progBar) progBar.style.width = `${pct}%`;
                if (progPercent) progPercent.innerText = `${pct}%`;
                if (progLabel) progLabel.innerText = `Processed ${count}/${paths.length} folder requests...`;
            }
            showToast(`${count - failed} folder requests completed${failed ? `; ${failed} failed and remain selected` : ''}.`, failed > 0);
            runLibraryHealthCheck();
            loadLibraryStats();
        } catch (error) {
            showToast(error.message || 'Folder exclusion failed.', true);
        } finally {
            batchBanSelected.busy = false;
            progContainer?.classList.add('hidden');
        }
    }

    async function ignoreHealthIssue(path, issue, triggerBtn = null) {
        if (!issue) return;
        setAxiomButtonBusy(triggerBtn, true, 'Removing...');
        try {
            const track = currentHealthTracks.find(item => item.path === path) || {};
            const resp = await fetch('/api/library/ignore_health_issue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path,
                    issue,
                    title: track.title || '',
                    artist: track.artist || '',
                })
            });
            const data = await resp.json();
            if (data.outcome === 'stale_removed') {
                showToast(data.message || 'Stale Health row removed.');
                selectedHealthPaths.delete(path);
                removeHealthTrackFromView(path, issue);
                runLibraryHealthCheck({ force: true });
                return;
            }
            if (!resp.ok) throw new Error(data.error || 'Could not accept issue');
            showToast(data.message || 'Health issue accepted');
            selectedHealthPaths.delete(path);
            removeHealthTrackFromView(path, issue);
            runLibraryHealthCheck();
        } catch (err) {
            showToast(err.message || 'Accept failed', true);
        } finally {
            setAxiomButtonBusy(triggerBtn, false);
        }
    }

    // Reviewed title/artist publishing is separate from AXIOM-only cleanup.
    function metadataPublishStatusLabel(status = '') {
        const labels = {
            publish_ready: 'Empty Tags', conflict: 'Different Tags', already_current: 'Already Matches',
            unsupported_format: 'Protected Format', missing_file: 'Missing File', read_only: 'Read Only',
            unresolved: 'Needs Review', error: 'Error', published: 'Published', failed: 'Skipped',
            rolled_back: 'Rolled Back'
        };
        return labels[status] || String(status || 'Checked').replace(/_/g, ' ');
    }

    function renderHealthMetadataPublishState(data = {}) {
        latestMetadataPublishState = { ...latestMetadataPublishState, ...data };
        data = latestMetadataPublishState;
        const container = document.getElementById('health-review-container');
        if (!container) return;
        const status = String(data.status || 'idle');
        const busy = ['previewing', 'publishing', 'rolling_back'].includes(status);
        const preview = Object.keys(data.preview_summary || {}).length ? data.preview_summary : (data.summary || {});
        const outcome = data.summary || {};
        const ready = Number(preview.publish_ready || 0);
        const conflicts = Number(preview.conflict || 0);
        const already = Number(preview.already_current || 0);
        const blocked = Number(preview.unsupported_format || 0);
        const unavailable = Number(preview.missing_file || 0) + Number(preview.read_only || 0)
            + Number(preview.unresolved || 0) + Number(preview.error || 0);
        const progress = Number(data.progress || 0);
        const total = Number(data.total || 0);
        const rows = (Array.isArray(data.results) && data.results.length) ? data.results : (data.samples || []);
        const titleEl = document.getElementById('health-review-title');
        const copyEl = document.getElementById('health-review-copy');
        const badge = document.getElementById('health-review-ready-badge');
        const statusCopy = {
            previewing: ['Checking DJ Metadata', `Reading ${progress.toLocaleString()} of ${total.toLocaleString()} reviewed tracks. Nothing is changing.`],
            ready: ['DJ Publish Preview', 'Review empty tags, existing conflicts, protected formats, and already-matching files before publishing.'],
            publishing: ['Publishing Clean Metadata', `Verifying and writing ${progress.toLocaleString()} of ${total.toLocaleString()} supported files.`],
            complete: ['DJ Metadata Publish Complete', 'Clean titles and artists are now in standard file tags. Refresh metadata in your DJ software.'],
            partial: ['DJ Metadata Publish Completed With Skips', 'Verified files were published; unsafe, changed, or unavailable files stayed untouched.'],
            rolling_back: ['Rolling Back DJ Metadata', `Restoring exact pre-publish files: ${progress.toLocaleString()} of ${total.toLocaleString()}.`],
            rolled_back: ['DJ Metadata Publish Rolled Back', 'The exact pre-publish files were restored from AXIOM backups.'],
            rollback_partial: ['Rollback Completed With Skips', 'Files changed after publishing were protected and left untouched.'],
            error: ['DJ Metadata Publish Paused', data.error || 'AXIOM stopped before it could safely finish.']
        }[status] || ['DJ Metadata Publish', 'Preview reviewed Title/Artist cleanups before making them visible in DJ software.'];
        if (titleEl) titleEl.textContent = statusCopy[0];
        if (copyEl) copyEl.textContent = statusCopy[1];
        if (badge) {
            badge.classList.toggle('hidden', status === 'idle');
            badge.textContent = busy ? `${progress.toLocaleString()} / ${total.toLocaleString()}` : metadataPublishStatusLabel(status);
        }
        container.setAttribute('aria-busy', busy ? 'true' : 'false');
        container.innerHTML = `
            <div class="health-clean-review" data-metadata-publish-status="${escapeHtml(status)}">
                <section class="health-clean-review-summary" aria-label="DJ metadata publish totals">
                    <div class="health-clean-review-stat ready"><img src="/static/icons/check-circle.svg" alt="" aria-hidden="true"><div><span>Empty Tags</span><strong>${ready.toLocaleString()}</strong><small>Safe first writes</small></div></div>
                    <div class="health-clean-review-stat"><img src="/static/icons/rotate-cw.svg" alt="" aria-hidden="true"><div><span>Conflicts</span><strong>${conflicts.toLocaleString()}</strong><small>Separate approval</small></div></div>
                    <div class="health-clean-review-stat"><img src="/static/icons/check-circle.svg" alt="" aria-hidden="true"><div><span>Already Set</span><strong>${already.toLocaleString()}</strong><small>Nothing to write</small></div></div>
                    <div class="health-clean-review-stat"><img src="/static/icons/check.svg" alt="" aria-hidden="true"><div><span>Protected</span><strong>${(blocked + unavailable).toLocaleString()}</strong><small>Left untouched</small></div></div>
                </section>
                <section class="health-clean-review-list" aria-label="DJ metadata publish preview">
                    <div class="health-clean-review-receipt-columns health-clean-review-receipt-grid" aria-hidden="true"><span>Track</span><span>File Tags</span><span>AXIOM</span></div>
                    ${rows.slice(0, 40).map(row => `
                        <div class="health-clean-review-row health-clean-review-receipt-grid">
                            <div class="health-clean-review-track"><strong>${escapeHtml(row.title || 'Unknown Track')}</strong><small>${escapeHtml(row.artist || 'Unknown Artist')}</small></div>
                            <div class="health-clean-review-value"><strong>${escapeHtml(metadataPublishStatusLabel(row.status))}</strong><small>${escapeHtml([row.current_artist, row.current_title].filter(Boolean).join(' - ') || row.reason || 'No standard values')}</small></div>
                            <div class="health-clean-review-value metadata-publish-value"><strong>${escapeHtml(row.artist || '')}</strong><small>${escapeHtml(row.title || '')}</small></div>
                        </div>`).join('') || '<div class="health-review-loading"><strong>No reviewed rows returned yet</strong><p>Run the preview again after applying a Title or Artist cleanup.</p></div>'}
                </section>
                <section class="health-clean-review-proof">
                    <div><img src="/static/icons/check.svg" alt="" aria-hidden="true"><span><strong>Audio stream protected</strong><small>MP3, FLAC, M4A, and MP4 only. WAV, AIFF, and AAC stay blocked.</small></span></div>
                    <div><img src="/static/icons/rotate-cw.svg" alt="" aria-hidden="true"><span><strong>Backup and rollback</strong><small>Every file is backed up and rechecked after preview before replacement.</small></span></div>
                </section>
                ${['complete', 'partial', 'rolled_back', 'rollback_partial'].includes(status) ? `<div class="health-clean-review-trustline" role="status"><img src="/static/icons/check-circle.svg" alt="" aria-hidden="true"><span>${status.startsWith('rollback') ? `${Number(outcome.rolled_back || 0).toLocaleString()} restored.` : `${Number(outcome.published || 0).toLocaleString()} published, ${Number(outcome.failed || 0).toLocaleString()} skipped.`} In Serato choose Re-scan File Info. In djay Pro refresh the local track metadata.</span></div>` : ''}
                <div class="health-clean-review-actions">
                    <button class="health-clean-review-button" type="button" onclick="showTab('health')" ${busy ? 'disabled' : ''}>Back to Health</button>
                    <button class="health-clean-review-button" type="button" onclick="startMetadataPublishPreview(this)" ${busy ? 'disabled' : ''}>Refresh Preview</button>
                    <button class="health-clean-review-button" type="button" onclick="confirmMetadataPublishRollback(this)" ${busy || !(data.rollback_available || data.recovery_available) ? 'disabled' : ''}>Roll Back Last Publish</button>
                    <span class="spacer"></span>
                    <button class="health-clean-review-button primary" type="button" onclick="confirmMetadataPublish(false, this)" ${status === 'ready' && ready > 0 ? '' : 'disabled'}>Publish ${ready.toLocaleString()} Empty Tags</button>
                    <button class="health-clean-review-button" type="button" onclick="confirmMetadataPublish(true, this)" ${status === 'ready' && conflicts > 0 ? '' : 'disabled'}>Review And Publish ${conflicts.toLocaleString()} Conflicts</button>
                </div>
            </div>`;
    }

    async function pollMetadataPublishStatus() {
        if (metadataPublishPollTimer) clearTimeout(metadataPublishPollTimer);
        metadataPublishPollTimer = null;
        try {
            const response = await fetch('/api/library/metadata_publish/status', { cache: 'no-store' });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.success !== true || !['idle', 'previewing', 'ready', 'publishing', 'complete', 'partial', 'rolling_back', 'rolled_back', 'rollback_partial', 'error'].includes(data.status)) {
                throw new Error(data.error || 'Title/Artist Publish status unavailable');
            }
            pollMetadataPublishStatus.working = ['previewing', 'publishing', 'rolling_back'].includes(data.status);
            pollMetadataPublishStatus.reconnecting = false;
            renderHealthMetadataPublishState(data);
            if (['previewing', 'publishing', 'rolling_back'].includes(data.status)) {
                metadataPublishPollTimer = setTimeout(pollMetadataPublishStatus, 650);
            }
            return data;
        } catch (error) {
            const message = 'Connection lost. Checking the existing Title/Artist Publish job; no changes will be submitted again.';
            const status = document.getElementById('health-review-copy');
            if (status) status.textContent = message;
            if (!pollMetadataPublishStatus.reconnecting) showToast(message, true);
            pollMetadataPublishStatus.reconnecting = true;
            metadataPublishPollTimer = setTimeout(pollMetadataPublishStatus, 5000);
            return null;
        }
    }

    async function startMetadataPublishPreview(triggerBtn = null) {
        if (pollMetadataPublishStatus.reconnecting || pollMetadataPublishStatus.working) return pollMetadataPublishStatus();
        if (!(await ensureAxiomLicenseUsable('Title and Artist Publish'))) return;
        setAxiomButtonBusy(triggerBtn, true, 'Previewing...');
        renderHealthMetadataPublishState({ status: 'previewing', progress: 0, total: metadataPublishReviewPaths.length });
        pollMetadataPublishStatus.working = true;
        try {
            const response = await fetch('/api/library/metadata_publish/preview', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paths: metadataPublishReviewPaths })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.success !== true || typeof data.status !== 'string') {
                const error = new Error(data.error || 'DJ metadata preview failed');
                error.requestRejected = response.status >= 400 && response.status < 500 && data.success === false;
                throw error;
            }
            pollMetadataPublishStatus.working = ['previewing', 'publishing', 'rolling_back'].includes(data.status);
            renderHealthMetadataPublishState(data);
            pollMetadataPublishStatus();
        } catch (error) {
            showToast(error.requestRejected ? error.message : 'Response lost. Checking the existing job before reporting an outcome.', true);
            await pollMetadataPublishStatus();
        } finally {
            setAxiomButtonBusy(triggerBtn, false);
        }
    }

    async function confirmMetadataPublish(includeConflicts = false, triggerBtn = null) {
        if (pollMetadataPublishStatus.reconnecting || pollMetadataPublishStatus.working) return pollMetadataPublishStatus();
        const typed = await showAxiomTextPrompt({
            kicker: 'External Metadata Change',
            title: includeConflicts ? 'Replace Existing Title And Artist Tags' : 'Publish Empty Title And Artist Tags',
            copy: `${includeConflicts ? 'Existing standard title or artist tags will be replaced by your reviewed AXIOM values. ' : ''}Fully quit Serato DJ Pro and djay Pro first. AXIOM creates a full backup, verifies the audio stream, and leaves both DJ databases untouched. Type PUBLISH CLEAN TITLES AND ARTISTS to continue.`,
            defaultValue: '', placeholder: 'PUBLISH CLEAN TITLES AND ARTISTS', confirmText: 'Publish To DJ Software'
        });
        if (!typed) return;
        if (typed !== 'PUBLISH CLEAN TITLES AND ARTISTS') return showToast('Confirmation did not match. No metadata changed.', true);
        setAxiomButtonBusy(triggerBtn, true, 'Publishing...');
        pollMetadataPublishStatus.working = true;
        try {
            const response = await fetch('/api/library/metadata_publish/apply', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirmation: typed, include_conflicts: includeConflicts })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.success !== true || typeof data.status !== 'string') {
                const error = new Error(data.error || 'DJ metadata publish failed');
                error.requestRejected = response.status >= 400 && response.status < 500 && data.success === false;
                throw error;
            }
            pollMetadataPublishStatus.working = ['previewing', 'publishing', 'rolling_back'].includes(data.status);
            renderHealthMetadataPublishState(data);
            pollMetadataPublishStatus();
        } catch (error) {
            showToast(error.requestRejected ? error.message : 'Response lost. Checking the existing job before reporting an outcome.', true);
            await pollMetadataPublishStatus();
        } finally {
            setAxiomButtonBusy(triggerBtn, false);
        }
    }

    async function confirmMetadataPublishRollback(triggerBtn = null) {
        if (pollMetadataPublishStatus.reconnecting || pollMetadataPublishStatus.working) return pollMetadataPublishStatus();
        const typed = await showAxiomTextPrompt({
            kicker: 'Metadata Rollback', title: 'Restore Pre-Publish Files',
            copy: 'Fully quit Serato DJ Pro and djay Pro first. AXIOM will restore the exact full-file backups from the latest Title/Artist Publish. Type ROLL BACK TITLE ARTIST PUBLISH to continue.',
            defaultValue: '', placeholder: 'ROLL BACK TITLE ARTIST PUBLISH', confirmText: 'Roll Back'
        });
        if (!typed) return;
        if (typed !== 'ROLL BACK TITLE ARTIST PUBLISH') return showToast('Confirmation did not match. Nothing changed.', true);
        setAxiomButtonBusy(triggerBtn, true, 'Rolling Back...');
        pollMetadataPublishStatus.working = true;
        try {
            const response = await fetch('/api/library/metadata_publish/rollback', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirmation: typed })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.success !== true || typeof data.status !== 'string') {
                const error = new Error(data.error || 'DJ metadata rollback failed');
                error.requestRejected = response.status >= 400 && response.status < 500 && data.success === false;
                throw error;
            }
            pollMetadataPublishStatus.working = ['previewing', 'publishing', 'rolling_back'].includes(data.status);
            renderHealthMetadataPublishState(data);
            pollMetadataPublishStatus();
        } catch (error) {
            showToast(error.requestRejected ? error.message : 'Response lost. Checking the existing job before reporting an outcome.', true);
            await pollMetadataPublishStatus();
        } finally {
            setAxiomButtonBusy(triggerBtn, false);
        }
    }

    async function clearAllDisplayedIssues(triggerBtn = null) {
        const eligible = (visibleHealthTracks || []).filter(t => t.fKey && t.fKey !== 'missing_file');
        if (eligible.length === 0) return showToast('No BPM/Key/Year issues currently displayed.', true);

        const confirmed = await showAxiomConfirm(
            "Accept All Issues",
            "This will accept all currently displayed health issues (Missing BPM/Key/Year). These tracks will remain in your library but disappear from this list. Proceed?"
        );
        if (!confirmed) return;
        setAxiomButtonBusy(triggerBtn, true, 'Clearing...');
        let total = 0;
        let failed = 0;
        let lastError = '';

        try {
            const groups = {};
            for (const track of eligible) {
                (groups[track.fKey] ||= []).push(track.path);
            }

            showToast(`Accepting ${eligible.length} displayed health issue${eligible.length === 1 ? '' : 's'}...`);
            for (const [issue, paths] of Object.entries(groups)) {
                try {
                    const resp = await fetch('/api/library/ignore_health_issue', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ paths, issue })
                    });
                    const data = await resp.json().catch(() => ({}));
                    if (resp.ok) {
                        total += data.count || paths.length;
                    } else {
                        failed += paths.length;
                        lastError = data.error || data.message || `Could not accept ${paths.length} ${issue === 'missing_year' ? 'year' : 'metadata'} issue${paths.length === 1 ? '' : 's'}.`;
                    }
                } catch (err) {
                    failed += paths.length;
                    lastError = err?.message || lastError || 'Unable to update Health issues right now.';
                }
            }

            if (failed > 0) {
                showToast(`Accepted ${total.toLocaleString()} / ${eligible.length.toLocaleString()} issues. ${failed.toLocaleString()} failed.${lastError ? ` Last issue: ${lastError}` : ''}`, true);
            } else {
                showToast(`Cleared ${total} issues`);
            }
            runLibraryHealthCheck();
        } catch (err) {
            showToast(err.message || 'Accept all issues failed', true);
        } finally {
            setAxiomButtonBusy(triggerBtn, false);
        }
    }

    async function batchIgnoreSelectedHealthIssues(triggerBtn = null) {
        const selected = currentHealthTracks.filter(t => selectedHealthPaths.has(t.path));
        if (selected.length === 0) return;
        const byIssue = selected.reduce((acc, track) => {
            if (!track.fKey || track.fKey === 'missing_file') return acc;
            (acc[track.fKey] ||= []).push(track.path);
            return acc;
        }, {});
        const issueGroups = Object.entries(byIssue);
        if (issueGroups.length === 0) return showToast('Only BPM/key/year issues can be accepted. Missing files need relocate, remove, or ban.', true);
        const confirmed = await showAxiomConfirm("Accept Metadata Gaps", `Hide ${selected.length} selected unresolved health issue${selected.length === 1 ? '' : 's'}? Tracks stay in the library and can still play.`, "ACCEPT", "primary");
        if (!confirmed) return;
        setAxiomButtonBusy(triggerBtn, true, 'Accepting...');

        let accepted = 0;
        let failed = 0;

        try {
            showToast(`Accepting ${selected.length} selected metadata gap${selected.length === 1 ? '' : 's'}...`);
            for (const [issue, paths] of issueGroups) {
                try {
                    const resp = await fetch('/api/library/ignore_health_issue', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ paths, issue })
                    });
                    const data = await resp.json().catch(() => ({}));
                    if (resp.ok) accepted += data.count || paths.length;
                    else failed += paths.length;
                } catch (err) {
                    failed += paths.length;
                }
            }
            selectedHealthPaths.clear();
            if (failed > 0) {
                showToast(`Accepted ${accepted.toLocaleString()} / ${selected.length.toLocaleString()} selected gaps. ${failed.toLocaleString()} failed.`, true);
            } else {
                showToast(`Accepted ${accepted} unresolved issue${accepted === 1 ? '' : 's'}.`);
            }
            runLibraryHealthCheck();
        } catch (err) {
            showToast(err.message || 'Accept selected issue failed', true);
        } finally {
            setAxiomButtonBusy(triggerBtn, false);
        }
    }

    async function relocateLibrary() {
        const missing = currentHealthTracks.filter(t => t.hType === 'Missing File');
        if (missing.length === 0) return showToast("No missing files detected. Relocation only needed for 'Missing File' errors.");

        const firstMissing = missing[0].path;
        const oldRoot = prompt("Axiom found a missing path. Enter the PART of the path that is different on this computer:", firstMissing.split('/').slice(0, 4).join('/'));
        if (!oldRoot) return;

        const newRoot = prompt("Enter the NEW path where that folder lives now (e.g. /Volumes/EXT_DRIVE/Music):");
        if (!newRoot) return;

        const confirmed = await showAxiomConfirm("Relocate Library", `This will surgically update all tracks by replacing "${oldRoot}" with "${newRoot}". This keeps all your BPM/Key/DNA data perfectly intact. Proceed?`, "RELOCATE", "primary");
        if (!confirmed) return;

        showToast('Relocating cached paths. Source audio untouched.');
        try {
            const resp = await fetch('/api/library/remap_root', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ old_root: oldRoot, new_root: newRoot })
            });
            const data = await resp.json();
            if (!resp.ok || data.success !== true) throw new Error(data.error || 'Relocation did not complete.');
            showToast(data.message);
            runLibraryHealthCheck();
        } catch (err) {
            showToast(err.message || 'Relocation failed', true);
        }
    }

    async function removeSingleMissingFileFromAxiom(path) {
        if (!path) return;
        return purgeMissingFiles([path]);
    }

    async function purgeMissingFiles(paths = null) {
        const selectedPaths = Array.isArray(paths) ? paths.filter(Boolean) : null;
        const missingCount = selectedPaths?.length || healthInboxIssueCount('missing_file');
        if (!missingCount) return showToast('No missing files are waiting to be removed.');
        const single = selectedPaths?.length === 1;
        const confirmed = await showAxiomConfirm(
            single ? 'Remove This Missing Track From AXIOM' : 'Remove Missing Tracks From AXIOM',
            single
                ? `Remove this missing track from AXIOM's library cache? Source audio and connected DJ libraries stay untouched, and the entry can be restored from Health.`
                : `Remove ${missingCount.toLocaleString()} missing track${missingCount === 1 ? '' : 's'} from AXIOM's library cache? Source audio and connected DJ libraries stay untouched, and the entries can be restored from Health.`,
            single ? 'REMOVE TRACK FROM AXIOM' : `REMOVE ${missingCount.toLocaleString()} FROM AXIOM`,
            'danger'
        );
        if (!confirmed) return;

        const healthReviewPaths = new Set(['/tmp/axiom-preview-track.mp3']);
        if (axiomReviewMode() === 'health' && selectedPaths?.every(path => healthReviewPaths.has(path))) {
            currentHealthSummary = { ...currentHealthSummary, missing_file: 0 };
            adjustHealthReviewAffectedCount(-missingCount);
            currentHealthTracks = currentHealthTracks.filter(track => !healthReviewPaths.has(track.path));
            visibleHealthTracks = visibleHealthTracks.filter(track => !healthReviewPaths.has(track.path));
            updateHealthRepairCenter(currentHealthSummary, 'Triage Command Centre', 'The preview issue was removed from AXIOM. Source audio stayed untouched.');
            renderHealthInboxDetail();
            showToast('Preview track removed from AXIOM. Source audio untouched.');
            return;
        }

        const button = document.getElementById('health-purge-missing');
        setAxiomButtonBusy(button, true, '<span>Removing...</span>');
        showToast('Removing missing entries from AXIOM. Source audio untouched.');
        try {
            const resp = await fetch('/api/library/purge_missing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(selectedPaths ? { paths: selectedPaths } : {})
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success === false) throw new Error(data.error || data.message || 'Missing-file removal failed');

            currentHealthSummary = { ...currentHealthSummary, missing_file: Number(data.remaining_missing || 0) };
            const removedPaths = new Set((data.removed_paths || selectedPaths || []).filter(Boolean));
            if (removedPaths.size) {
                currentHealthTracks = currentHealthTracks.filter(track => !(track.fKey === 'missing_file' && removedPaths.has(track.path)));
                visibleHealthTracks = visibleHealthTracks.filter(track => !(track.fKey === 'missing_file' && removedPaths.has(track.path)));
            } else if (!selectedPaths) {
                currentHealthTracks = currentHealthTracks.filter(track => track.fKey !== 'missing_file');
                visibleHealthTracks = visibleHealthTracks.filter(track => track.fKey !== 'missing_file');
            }
            selectedHealthPaths.clear();
            lastHealthCheckAt = 0;
            currentRemovedFromAxiomBin = data.bin || null;
            removedFromAxiomBinLoadedAt = Date.now();
            updateRemovedFromAxiomBinPanel(currentRemovedFromAxiomBin);
            updateHealthSelectionUI();
            await runLibraryHealthCheck({ force: true });
            await loadLibraryStats(false);

            const finalMissing = healthInboxIssueCount('missing_file');
            if (finalMissing !== Number(data.remaining_missing || 0)) {
                throw new Error('Health did not refresh to the confirmed missing-file count.');
            }
            showToast(data.message || `${Number(data.purged_count || 0).toLocaleString()} missing tracks removed from AXIOM. Source audio untouched.`);
        } catch (err) {
            showToast(err.message || "Missing-file removal failed", true);
        } finally {
            setAxiomButtonBusy(button, false);
        }
    }

    function applyCoreAudioStatus(data = {}) {
        const button = document.getElementById('btn-coreaudio-loud');
        const text = document.getElementById('coreaudio-status-text');
        if (!button || !text) return;
        const ready = data.status === 'ok';
        button.classList.toggle('status-ok', ready);
        button.classList.toggle('status-error', !ready);
        text.textContent = ready ? 'Audio Ready' : 'Check & Repair Audio';
        button.setAttribute('aria-label', ready
            ? 'Core Audio is ready. Check again.'
            : 'Check and repair Core Audio');
    }

    async function refreshCoreAudioDriver(triggerBtn = null) {
        const button = triggerBtn || document.getElementById('btn-coreaudio-loud');
        setAxiomButtonBusy(button, true, 'Checking Audio...');
        try {
            const resp = await fetch('/api/performance/refresh_audio', { method: 'POST' });
            const data = await resp.json().catch(() => ({}));
            applyCoreAudioStatus(data);
            if (!resp.ok || data.success === false) {
                throw new Error(data.message || data.error || 'Audio repair paused.');
            }
            showToast(data.message || 'Audio checked and ready.');
        } catch (err) {
            console.error("Audio refresh error:", err);
            showToast(err.message || 'Audio repair paused.', true);
        } finally {
            setAxiomButtonBusy(button, false);
        }
    }

    let coreAudioPollerActive = false;
    async function pollCoreAudioStatus() {
        if (coreAudioPollerActive) return;
        coreAudioPollerActive = true;
        try {
            const resp = await fetch('/api/performance/coreaudio_status');
            if (resp.ok) {
                const data = await resp.json();
                applyCoreAudioStatus(data);
            }
        } catch (err) {
            // ignore network errors on poll
        } finally {
            coreAudioPollerActive = false;
        }
    }
    if (document.querySelector('meta[name="axiom-edition"]')?.content !== 'lite') {
    setTimeout(pollCoreAudioStatus, 250);
    setInterval(pollCoreAudioStatus, 5000);

    let djayRoutingPollerActive = false;
    setInterval(async () => {
        if (djayRoutingPollerActive) return;
        djayRoutingPollerActive = true;
        try {
            const resp = await fetch('/api/performance/prep_djay_routing', { method: 'POST' });
            if (resp.ok) {
                const data = await resp.json().catch(() => ({}));
                if (data.success && data.modified) {
                    showToast("DJAY SYNC: " + data.message, true);
                }
            }
        } catch (err) {
            // Silently fail background sync to avoid spamming the UI
        } finally {
            djayRoutingPollerActive = false;
        }
    }, 10000);
    }

    const AXIOM_LIBRARY_RESET_BLOCK_KEY = 'axiom-library-reset-block-v1';
    let axiomLibraryResetGate = { pending: false, blocked: false, message: '' };
    try {
        const savedResetBlock = JSON.parse(sessionStorage.getItem(AXIOM_LIBRARY_RESET_BLOCK_KEY) || 'null');
        if (savedResetBlock?.blocked) axiomLibraryResetGate = { pending: false, blocked: true, message: String(savedResetBlock.message || '') };
    } catch (_) { }

    function syncAxiomLibraryResetGate() {
        const locked = Boolean(axiomLibraryResetGate.pending || axiomLibraryResetGate.blocked);
        const message = axiomLibraryResetGate.message || (axiomLibraryResetGate.pending
            ? 'Resetting the AXIOM Library. Add Music will return after the empty cache is verified.'
            : 'Reset Library did not finish. Retry the reset or keep the current library before adding music.');
        document.body?.toggleAttribute('data-library-reset-blocked', locked);
        [
            'btn-settings-library-add', 'entrance-add-music', 'health-new-music-add',
            'connect-music-folder-cta', 'folder-path-open', 'library-choose-music-source'
        ].forEach(id => {
            const button = document.getElementById(id);
            if (!button) return;
            button.disabled = locked;
            button.setAttribute('aria-disabled', String(locked));
            button.title = locked ? message : '';
        });
        const status = document.getElementById('settings-library-reset-status');
        const title = document.getElementById('settings-library-reset-status-title');
        const copy = document.getElementById('settings-library-reset-status-copy');
        const cancel = document.getElementById('btn-settings-library-reset-cancel');
        if (status) status.hidden = !locked;
        if (title) title.textContent = axiomLibraryResetGate.pending ? 'Resetting AXIOM Library' : 'Library reset needs attention';
        if (copy) copy.textContent = message;
        if (cancel) cancel.hidden = axiomLibraryResetGate.pending;
        try {
            if (axiomLibraryResetGate.blocked) {
                sessionStorage.setItem(AXIOM_LIBRARY_RESET_BLOCK_KEY, JSON.stringify({ blocked: true, message }));
            } else {
                sessionStorage.removeItem(AXIOM_LIBRARY_RESET_BLOCK_KEY);
            }
        } catch (_) { }
    }

    function setAxiomLibraryResetGate(next = {}) {
        axiomLibraryResetGate = {
            pending: Boolean(next.pending),
            blocked: Boolean(next.blocked),
            message: String(next.message || '')
        };
        syncAxiomLibraryResetGate();
    }

    window.getAxiomLibraryResetGate = () => ({ ...axiomLibraryResetGate });
    window.cancelAxiomLibraryResetBlock = function () {
        setAxiomLibraryResetGate({ pending: false, blocked: false, message: '' });
        showToast('Reset cancelled. Your current AXIOM Library remains available.');
    };
    window.setTimeout(syncAxiomLibraryResetGate, 0);

    async function resetAxiomLibraryIndex(triggerButton = null) {
        const confirmed = await showAxiomConfirm(
            "Reset AXIOM Library",
            "This creates a recovery backup, then clears AXIOM's Library cache, Health results, and year lookup cache. AXIOM keeps the seven newest automatic reset backups. You will need to reconnect your music before running Health again. Music files, Serato, djay Pro, saved sets, and source audio stay untouched.",
            "RESET AXIOM LIBRARY",
            "danger"
        );
        if (!confirmed) return;

        const resetButton = triggerButton || document.getElementById('btn-settings-library-reset');
        setAxiomButtonBusy(resetButton, true, 'Clearing...');
        setAxiomLibraryResetGate({
            pending: true,
            blocked: false,
            message: 'Stopping active Library and Health work, then verifying an empty AXIOM cache.'
        });
        showToast("Resetting AXIOM's library index. Source audio untouched.");
        try {
            const resp = await fetch('/api/library/reset_index', { method: 'POST' });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success === false || data.verified_empty !== true) {
                throw new Error(data.error || data.message || "Reset failed");
            }

            updateLibraryCount(0);
            setLibraryConnectionState(0);
            currentHealthTracks = [];
            visibleHealthTracks = [];
            currentHealthSummary = { missing_file: 0, missing_bpm: 0, missing_key: 0, missing_year: 0 };
            selectedHealthPaths.clear();
            lastHealthCheckAt = 0;
            updateHealthPriorityPanel();
            updateHealthRepairCenter(currentHealthSummary, 'AXIOM Library Cleared', 'The AXIOM cache is blank and ready for you to add music again. Source audio stayed untouched.');
            await runLibraryHealthCheck({ force: true, announceProgress: false });

            const results = document.getElementById('search-results');
            if (results) results.innerHTML = '';
            const suggestions = document.getElementById('lib-suggestions-list');
            if (suggestions) suggestions.innerHTML = '';

            showToast(data.message || "AXIOM library and Health cache cleared. Source audio untouched.");
            closeMasterHud();
            showTab('library');
            renderLibraryConnectionPrompt();
            setAxiomLibraryResetGate({ pending: false, blocked: false, message: '' });
            showToast("Blank AXIOM Library ready. Choose a music source to begin again.");
        } catch (err) {
            const message = err.message || "Library reset paused. Your music remains protected.";
            setAxiomLibraryResetGate({ pending: false, blocked: true, message });
            showToast(message, true);
        } finally {
            setAxiomButtonBusy(resetButton, false);
        }
    }

    function formatAxiomStorageBytes(bytes = 0) {
        const value = Math.max(0, Number(bytes) || 0);
        if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(value >= 10 * 1024 ** 3 ? 1 : 2)} GB`;
        if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(value >= 10 * 1024 ** 2 ? 1 : 2)} MB`;
        if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
        return `${value} B`;
    }

    async function clearAxiomGeneratedCache(triggerButton = null) {
        const confirmed = await showAxiomConfirm(
            "Clear AXIOM Generated Cache",
            "This clears unused temporary previews, prepared Studio audio, managed stems, internal export backups and legacy AXIOM backup folders. Audio in use stays cached. BPM, key, year, cues, saved sets, source audio, Serato and djay Pro stay untouched.",
            "CLEAR GENERATED CACHE",
            "danger"
        );
        if (!confirmed) return;
        const button = triggerButton || document.getElementById('health-clear-generated-cache');
        setAxiomButtonBusy(button, true, 'Clearing...');
        showToast('Clearing AXIOM generated cache. Library intelligence stays intact.');
        try {
            const resp = await fetch('/api/library/generated_cache/clear', { method: 'POST' });
            const data = await resp.json().catch(() => ({}));
            const freed = formatAxiomStorageBytes(data.bytes_freed);
            const busy = Math.max(0, Number(data.busy_entries) || 0);
            const summary = `${freed} removed.${busy ? ` ${busy} active audio cache ${busy === 1 ? 'entry kept' : 'entries kept'}; clear again after playback or preparation finishes.` : ''}`;
            if (!resp.ok || data.success === false || data.library_cache_preserved !== true || data.year_cache_preserved !== true) {
                throw new Error(`${summary} ${data.error || data.message || 'Generated cache cleanup could not be verified.'}`);
            }
            updateHealthRepairCenter(currentHealthSummary, 'AXIOM Generated Cache Cleared', `${summary} BPM, key, year and saved sets stayed intact.`);
            showToast(`AXIOM generated cache cleared. ${summary}`);
        } catch (err) {
            showToast(err.message || 'Generated cache cleanup paused. Library intelligence remains protected.', true);
        } finally {
            setAxiomButtonBusy(button, false);
        }
    }
    window.clearAxiomGeneratedCache = clearAxiomGeneratedCache;

    async function removeHealthReviewTracks(scope, triggerBtn = null, explicitPaths = null) {
        if (removeHealthReviewTracks.busy) return;
        const review = currentHealthCleanupReview;
        const navigation = window.axiomTabNavigationVersion;
        const visibleMetadataIndexes = new Set((review?.samples || [])
            .map((track, index) => ({index, changed: healthCleanupResolvedPreview(track, index, review).changed}))
            .filter(row => row.changed).slice(0, 120).map(row => row.index));
        const rows = Array.isArray(explicitPaths)
            ? currentHealthTracks.filter(track => explicitPaths.includes(track.path))
            : scope === 'metadata'
            ? healthCleanupSelectedIndexes(review).filter(index => visibleMetadataIndexes.has(index)).map(index => review.samples[index])
            : scope === 'selected'
                ? currentHealthTracks.filter(track => selectedHealthPaths.has(track.path))
                : currentHealthTracks.filter(track => track.fKey === scope).slice(0, 25);
        const paths = [...new Set(rows.map(track => track?.path).filter(Boolean))];
        if (!paths.length) return;
        removeHealthReviewTracks.busy = true;
        setAxiomButtonBusy(triggerBtn, true, 'Review removal...');
        try {
            const confirmed = await showAxiomConfirm('Remove from AXIOM only',
                `Remove ${paths.length.toLocaleString()} selected track${paths.length === 1 ? '' : 's'} from AXIOM? They stay out of future imports until restored. Your music files stay on disk. Serato and djay stay unchanged. Restore Bin can bring the entries back.`,
                'Remove from AXIOM', 'danger', 'metadata');
            if (!confirmed) return;
            if (window.axiomTabNavigationVersion !== navigation || (scope === 'metadata' && currentHealthCleanupReview !== review)) {
                throw new Error('The review changed. Select the tracks again before removing them.');
            }
            if (axiomReviewMode() === 'health') {
                showToast('Example only. No real tracks were removed.');
                return;
            }
            setAxiomButtonBusy(triggerBtn, true, 'Removing...');
            const response = await fetch('/api/library/health/remove_tracks', {
                method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({paths}),
            });
            const result = await response.json();
            const removed = new Set(result.removed_paths || []);
            if (!response.ok || !result.success || result.count !== paths.length || removed.size !== paths.length || paths.some(path => !removed.has(path))) {
                throw new Error(result.error || 'AXIOM could not confirm the full removal. Refresh Health before trying again.');
            }
            currentRemovedFromAxiomBin = result.bin || null;
            removedFromAxiomBinLoadedAt = Date.now();
            updateRemovedFromAxiomBinPanel(currentRemovedFromAxiomBin);
            paths.forEach(path => selectedHealthPaths.delete(path));
            currentHealthTracks = currentHealthTracks.filter(track => !removed.has(track.path));
            currentHealthCleanupAudit = null;
            healthCleanupAuditLoadedAt = 0;
            lastHealthCheckAt = 0;
            if (window.axiomTabNavigationVersion === navigation) {
                currentHealthCleanupReview = null;
                showTab('health');
            }
            await loadLibraryStats(false);
            await runLibraryHealthCheck({force: true, announceProgress: false});
            showToast(result.message);
        } catch (error) {
            showToast(error.message || 'Unable to remove these AXIOM entries.', true);
        } finally {
            removeHealthReviewTracks.busy = false;
            setAxiomButtonBusy(triggerBtn, false);
        }
    }

    function removeSingleHealthReviewTrack(path, triggerBtn = null) {
        if (!currentHealthTracks.some(track => track.path === path)) {
            showToast('This track is no longer in the Health review. Refresh before removing it.', true);
            return;
        }
        return removeHealthReviewTracks('selected', triggerBtn, [path]);
    }

    async function removeTrackFromIndex(path, triggerBtn = null) {
        const confirmed = await showAxiomConfirm("Remove Track", "Are you sure you want to remove this specific track from the index? The file will not be deleted, but it won't show up in Axiom searches until your next full library scan.", "REMOVE", "danger");
        if (!confirmed) return;
        const track = currentHealthTracks.find(item => item.path === path) || {};
        setAxiomButtonBusy(triggerBtn, true, 'Removing...');
        try {
            const resp = await fetch('/api/library/remove_track', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path,
                    title: track.title || '',
                    artist: track.artist || '',
                })
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success === false || Number(data.removed_count || 0) < 1) {
                throw new Error(data.error || data.message || 'AXIOM did not confirm the removal.');
            }
            removeHealthTrackFromView(path);
            currentRemovedFromAxiomBin = data.bin || null;
            removedFromAxiomBinLoadedAt = Date.now();
            updateRemovedFromAxiomBinPanel(currentRemovedFromAxiomBin);
            lastHealthCheckAt = 0;
            const refreshed = await runLibraryHealthCheck({ force: true, announceProgress: false });
            if (currentHealthTracks.some(item => item.path === path)) {
                throw new Error('The track was saved as removed but Health still returned it.');
            }
            await loadLibraryStats(false);
            showToast(data.message || 'Track removed from AXIOM. Source audio untouched.');
        } catch (err) {
            showToast(err.message || "Removal failed", true);
        } finally {
            setAxiomButtonBusy(triggerBtn, false);
        }
    }

    async function confirmBanFolder(path) {
        const confirmed = await showAxiomConfirm("Blacklist Folder", "You are about to add this folder to the 'Shotgun' ban list. All tracks in this folder will be removed from your index PERMANENTLY.", "BAN FOLDER", "danger");
        if (confirmed) banFolder(path);
    }

    async function banFolder(path) {
        showToast('Banning folder from AXIOM index. Source audio untouched.');
        try {
            const resp = await fetch('/api/library/ban_folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path })
            });
            const data = await resp.json();
            showToast(data.message);
            runLibraryHealthCheck();
            loadLibraryStats();
        } catch (err) {
            showToast("Ban failed", true);
        }
    }

    async function saveManualBPM(path, button = null) {
        const id = path.replace(/[^a-z0-9]/gi, '');
        const input = document.getElementById(`manual-bpm-${id}`);
        const bpm = parseFloat(input.value);
        if (!bpm || bpm <= 0) return showToast("AXIOM could not confirm that BPM.", true);
        setAxiomButtonBusy(button, true, 'Saving...');

        try {
            const resp = await fetch('/api/library/update_bpm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, bpm })
            });
            const data = await resp.json();
            if (data.success) {
                propagateTrackMetadata(path, { bpm }, data.track || null);
                removeHealthTrackFromView(path, 'missing_bpm');
                showToast("BPM intelligence updated. Source audio remains untouched.");
                loadLibraryStats();
                if (!document.getElementById('tab-content-library').classList.contains('hidden')) runSearch();
                runLibraryHealthCheck();
            }
        } catch (err) {
            showToast("BPM intelligence could not be updated. Source audio remains protected.", true);
        } finally {
            setAxiomButtonBusy(button, false);
        }
    }

    async function fixTrack(path, action, triggerBtn = null) {
        setAxiomButtonBusy(triggerBtn, true, 'Fixing...');
        try {
            const resp = await fetch('/api/library/fix_track', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, action })
            });
            const data = await resp.json();
            if (data.success) {
                if (data.track) {
                    propagateTrackMetadata(path, data.track, data.track);
                    removeHealthTrackFromView(path, ['missing_bpm', 'missing_key', 'missing_year']);
                    if (!document.getElementById('tab-content-library').classList.contains('hidden')) runSearch();
                }
                showToast(data.message);
                runLibraryHealthCheck(); // Refresh
                loadLibraryStats();
            } else {
                showToast(data.error || "AXIOM could not refresh that track. Source audio remains protected.", true);
            }
        } catch (err) {
            showToast("Performance analysis paused. Your library remains protected.", true);
        } finally {
            setAxiomButtonBusy(triggerBtn, false);
        }
    }
