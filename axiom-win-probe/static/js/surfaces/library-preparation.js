/* Library surface: batch preparation queues, receipts, and scan handoff. */
    function libraryTrackNeedsAudioPreparation(track = {}) {
      const bpm = Number(track.bpm || 0);
      const key = normalizeCamelotKey(track.camelot || track.key || track.key_raw || '');
      const year = Number(track.year || track.release_year || 0);
      return !Number.isFinite(bpm) || bpm <= 0 || !key || !Number.isFinite(year) || year < 1900;
    }

    function libraryPreparationRowsForDisplay(tracks = []) {
      const prepState = track => {
        if (track?.preparation_state && typeof track.preparation_state === 'object') {
          return track.preparation_state;
        }
        const missingFile = track.source_connected === false;
        const rawMissingBpm = !(Number(track.bpm || 0) > 0);
        const rawMissingKey = !normalizeCamelotKey(track.camelot || track.key || track.key_raw || '');
        const rawMissingYear = !(Number(track.year || track.release_year || 0) >= 1900);
        const reviewStatuses = new Set(['review', 'variable_tempo', 'unreadable', 'no_trusted_result']);
        const bpmReview = rawMissingBpm && reviewStatuses.has(String(track.bpm_analysis_status || ''));
        const keyReview = false;
        const missingBpm = rawMissingBpm && !bpmReview;
        const missingKey = rawMissingKey && !keyReview;
        return {
          missing_file: missingFile,
          missing_bpm_or_key: !missingFile && (rawMissingBpm || rawMissingKey),
          missing_metadata: !missingFile && (rawMissingBpm || rawMissingKey || rawMissingYear),
          missing_bpm: missingBpm,
          missing_key: missingKey,
          missing_year: rawMissingYear,
          missing_both: missingBpm && missingKey,
          bpm_review: bpmReview,
          key_review: keyReview,
          needs_review: bpmReview || keyReview,
          needs_prep: missingFile || missingBpm || missingKey || rawMissingYear,
          ready: !missingFile && !rawMissingBpm && !rawMissingKey && !rawMissingYear,
        };
      };
      let rows = Array.isArray(tracks) ? tracks.slice() : [];
      if (activeLibraryPreparationFilter !== 'all') {
        rows = rows.filter(track => Boolean(prepState(track)[activeLibraryPreparationFilter]));
      }
      const identity = track => `${track.artist || ''} ${track.title || ''}`.toLowerCase();
      if (activeLibraryPreparationSort === 'missing_first') {
        rows.sort((a, b) => {
          const aState = prepState(a);
          const bState = prepState(b);
          return (Number(bState.missing_bpm) + Number(bState.missing_key) + Number(bState.missing_year)) - (Number(aState.missing_bpm) + Number(aState.missing_key) + Number(aState.missing_year)) || identity(a).localeCompare(identity(b));
        });
      } else if (activeLibraryPreparationSort === 'bpm_asc' || activeLibraryPreparationSort === 'bpm_desc') {
        const direction = activeLibraryPreparationSort === 'bpm_desc' ? -1 : 1;
        rows.sort((a, b) => ((Number(a.bpm || 0) || 999) - (Number(b.bpm || 0) || 999)) * direction);
      } else if (activeLibraryPreparationSort === 'key') {
        rows.sort((a, b) => String(a.camelot || 'ZZ').localeCompare(String(b.camelot || 'ZZ'), undefined, { numeric: true }));
      } else if (activeLibraryPreparationSort === 'year') {
        rows.sort((a, b) => Number(b.year || 0) - Number(a.year || 0));
      } else if (activeLibraryPreparationSort === 'recent') {
        rows.sort((a, b) => {
          const aAdded = String(a.axiom_first_seen_at || a.added_at || '');
          const bAdded = String(b.axiom_first_seen_at || b.added_at || '');
          return bAdded.localeCompare(aAdded) || identity(a).localeCompare(identity(b));
        });
      }
      return rows;
    }

    function libraryPreparationScanButtonLabel(count = 0) {
      const total = Number(count || 0);
      const formatted = total.toLocaleString();
      if (activeLibraryPreparationFilter === 'missing_key') {
        return `Scan + Update ${formatted} Missing Key${total === 1 ? '' : 's'}`;
      }
      if (activeLibraryPreparationFilter === 'missing_bpm') {
        return `Scan + Update ${formatted} Missing BPM`;
      }
      if (activeLibraryPreparationFilter === 'missing_year') {
        return `Scan + Update ${formatted} Missing Year${total === 1 ? '' : 's'}`;
      }
      if (activeLibraryPreparationFilter === 'missing_both') {
        return `Scan + Update ${formatted} BPM + Key`;
      }
      if (activeLibraryPreparationFilter === 'missing_metadata') {
        return `Scan + Update ${formatted} Missing Metadata`;
      }
      if (activeLibraryPreparationFilter === 'missing_bpm_or_key') {
        return `Scan + Update ${formatted} Missing BPM or Key`;
      }
      return `Scan + Update ${formatted} Missing Value${total === 1 ? '' : 's'}`;
    }

    function libraryPreparationRequestedLanes() {
      if (activeLibraryPreparationFilter === 'missing_key') return ['missing_key'];
      if (activeLibraryPreparationFilter === 'missing_bpm') return ['missing_bpm'];
      if (activeLibraryPreparationFilter === 'missing_year') return ['missing_year'];
      if (activeLibraryPreparationFilter === 'missing_metadata') return ['missing_bpm', 'missing_key', 'missing_year'];
      return ['missing_bpm', 'missing_key'];
    }

    function libraryPreparationBatchLabel(count = 0) {
      const total = Number(count || 0).toLocaleString();
      if (activeLibraryPreparationFilter === 'missing_key') return `${total} missing-key track${Number(count) === 1 ? '' : 's'}`;
      if (activeLibraryPreparationFilter === 'missing_bpm') return `${total} missing-BPM track${Number(count) === 1 ? '' : 's'}`;
      if (activeLibraryPreparationFilter === 'missing_year') return `${total} missing-year track${Number(count) === 1 ? '' : 's'}`;
      if (activeLibraryPreparationFilter === 'missing_both') return `${total} track${Number(count) === 1 ? '' : 's'} missing BPM and key`;
      if (activeLibraryPreparationFilter === 'missing_bpm_or_key') return `${total} track${Number(count) === 1 ? '' : 's'} missing BPM or key`;
      if (activeLibraryPreparationFilter === 'missing_metadata') return `${total} track${Number(count) === 1 ? '' : 's'} missing BPM, key, or year`;
      return `${total} filtered track${Number(count) === 1 ? '' : 's'}`;
    }

    function libraryPreparationBatchUrl(limit = LIBRARY_RESULT_MAX) {
      const q = document.getElementById('main-search')?.value.trim().toLowerCase() || '';
      const brief = setBriefPayload();
      let url = `/api/library/search?q=${encodeURIComponent(q)}&era=${encodeURIComponent(activeEra)}`;
      if (!q && !brief.enabled) url = `/get-tracks?era=${encodeURIComponent(activeEra)}`;
      return appendLibraryPagingParams(
        appendLibraryPreparationParams(appendLibraryRootParams(appendLibraryBpmParams(url))),
        limit
      );
    }

    async function loadLibraryPreparationCounts() {
      const q = document.getElementById('main-search')?.value.trim().toLowerCase() || '';
      let url = q
        ? `/api/library/search?q=${encodeURIComponent(q)}&era=${encodeURIComponent(activeEra)}`
        : `/get-tracks?era=${encodeURIComponent(activeEra)}`;
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}preparation=needs_prep&sort=missing_first`;
      url = appendLibraryPagingParams(appendLibraryRootParams(appendLibraryBpmParams(url)), 1);
      const resp = await fetch(url, { cache: 'no-store' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.success === false) {
        throw new Error(data.error || 'Track Preparation could not refresh the remaining work.');
      }
      return data.preparation_counts || {};
    }

    function nextLibraryPreparationWork(counts = {}, currentFilter = activeLibraryPreparationFilter) {
      const countFor = filter => Math.max(0, Number(counts?.[filter] || 0));
      if (countFor('missing_file') > 0) {
        return { filter: 'missing_file', count: countFor('missing_file'), label: 'missing files' };
      }
      if (countFor('missing_metadata') > 0) {
        return {
          filter: 'missing_metadata',
          count: countFor('missing_metadata'),
          label: 'tracks missing BPM, key, or year',
        };
      }
      return { filter: 'all', count: 0, label: 'all tracks ready' };
    }

    async function advanceLibraryPreparationAfterScan(job = {}) {
      if (!['selected_tracks', 'preparation_filter'].includes(String(job.scope || ''))) {
        await runSearch();
        return { filter: activeLibraryPreparationFilter, count: activeLibraryPreparationFilteredTotal, label: '' };
      }
      const completedFilter = activeLibraryPreparationFilter;
      let next = { filter: completedFilter, count: activeLibraryPreparationFilteredTotal, label: '' };
      try {
        const counts = await loadLibraryPreparationCounts();
        next = nextLibraryPreparationWork(counts, completedFilter);
      } catch (error) {
        console.error('Track Preparation completion refresh failed:', error);
      }
      job.library_next_filter = next.filter;
      job.library_next_count = next.count;
      job.library_next_label = next.label;
      if (next.filter === 'all') {
        await returnToAllLibraryTracks(null, { preserveReceipt: true, silent: true });
        return { ...next, message: 'Track Preparation is complete. AXIOM returned you to the Library.' };
      }
      activeLibraryPreparationFilter = next.filter;
      activeLibraryPreparationSort = 'missing_first';
      const preparationSelect = document.getElementById('library-preparation-filter');
      const sortSelect = document.getElementById('library-preparation-sort');
      if (preparationSelect) preparationSelect.value = next.filter;
      if (sortSelect) sortSelect.value = 'missing_first';
      resetLibraryResultWindow();
      await runSearch();
      return {
        ...next,
        message: `Scan complete. Next: ${next.count.toLocaleString()} ${next.label}.`,
      };
    }

    function updateLibraryPreparationScanButton(tracks = [], context = {}) {
      const button = document.getElementById('library-preparation-scan-visible');
      if (!button) return;
      const missingFileMode = activeLibraryPreparationFilter === 'missing_file';
      const reviewMode = activeLibraryPreparationFilter === 'bpm_review';
      const missingFileRows = tracks.filter(track => track.source_connected === false);
      const missingFileCount = Math.max(Number(context.total || 0), Number(context.visible_tracks || 0), missingFileRows.length);
      button.classList.toggle('library-preparation-remove-missing', missingFileMode);
      button.dataset.missingCount = missingFileMode ? String(missingFileCount) : '';
      if (missingFileMode) {
        const unavailable = missingFileCount === 0 || Boolean(context.streaming_mode);
        button.hidden = unavailable;
        button.disabled = unavailable;
        button.title = missingFileCount ? 'Remove disconnected entries from AXIOM only. Source audio is untouched.' : '';
        button.textContent = unavailable ? '' : `Remove All ${missingFileCount.toLocaleString()} Missing Songs`;
        syncLibraryPreparationLayoutContract();
        return;
      }
      if (reviewMode) {
        const reviewCount = Math.max(0, Number(context.total || context.visible_tracks || tracks.length));
        const unavailable = reviewCount === 0;
        button.hidden = unavailable;
        button.disabled = unavailable;
        button.dataset.batchCount = String(reviewCount);
        button.title = reviewCount ? 'Open Health Review to inspect unresolved analysis and its next action.' : '';
        button.textContent = unavailable ? '' : `Review ${reviewCount.toLocaleString()} BPM Result${reviewCount === 1 ? '' : 's'}`;
        syncLibraryPreparationLayoutContract();
        return;
      }
      const repairable = tracks.filter(libraryTrackNeedsAudioPreparation);
      const fullFilteredBatch = ['missing_metadata', 'missing_bpm_or_key', 'missing_key', 'missing_bpm', 'missing_year', 'missing_both'].includes(activeLibraryPreparationFilter);
      const batchCount = fullFilteredBatch
        ? Math.max(0, Number(context.total || context.visible_tracks || repairable.length))
        : repairable.length;
      const unavailable = batchCount === 0 || Boolean(context.streaming_mode);
      button.hidden = unavailable;
      button.disabled = unavailable;
      button.dataset.batchCount = String(batchCount);
      button.title = batchCount ? 'Analyze the full filtered batch. AXIOM saves the best available BPM and key candidate for each readable song.' : '';
      button.textContent = unavailable ? '' : libraryPreparationScanButtonLabel(batchCount);
      syncLibraryPreparationLayoutContract();
    }

    function renderLibraryPreparationScanReceipt(job = null) {
      const receipt = document.getElementById('library-preparation-scan-receipt');
      if (!receipt) return;
      if (!job) {
        lastLibraryPreparationReceiptJob = null;
        try { localStorage.removeItem(LIBRARY_PREPARATION_RECEIPT_KEY); } catch (_) { }
        receipt.classList.add('hidden');
        return;
      }
      if (!['selected_tracks', 'preparation_filter'].includes(String(job.scope || ''))) return;
      lastLibraryPreparationReceiptJob = job;
      try {
        localStorage.setItem(LIBRARY_PREPARATION_RECEIPT_KEY, JSON.stringify({
          scope: job.scope,
          status: job.status,
          scope_track_count: job.scope_track_count,
          scope_paths: Array.isArray(job.scope_paths) ? job.scope_paths : [],
          processed_tracks: job.processed_tracks,
          cache_verification: job.cache_verification,
          totals: job.totals || {},
          year_retries: job.year_retries || {},
          library_next_filter: job.library_next_filter || '',
          library_next_count: Number(job.library_next_count || 0),
          library_next_label: job.library_next_label || '',
          recent_events: Array.isArray(job.recent_events) ? job.recent_events : [],
          updated_at: job.updated_at || new Date().toISOString(),
        }));
      } catch (_) { }
      const processedTracks = Number(job.processed_tracks ?? 0);
      const scanned = Number.isFinite(processedTracks) ? Math.max(0, Math.floor(processedTracks)) : 0;
      const cacheVerified = String(job.cache_verification || '').toLowerCase() === 'verified';
      const fixedValues = cacheVerified ? Math.max(0, Number(job.totals?.fixed || 0)) : 0;
      const estimatedValues = cacheVerified ? Math.max(0, Number(job.totals?.estimated || 0)) : 0;
      const savedValues = fixedValues + estimatedValues;
      const review = cacheVerified
        ? Math.max(0, Number(job.totals?.still_missing ?? Math.max(0, scanned - savedValues)))
        : Math.max(0, Number(job.totals?.still_missing ?? scanned));
      const nextFilter = String(job.library_next_filter || '');
      const nextCount = Math.max(0, Number(job.library_next_count || 0));
      const nextLabel = String(job.library_next_label || '').trim();
      const completionCopy = nextFilter === 'all'
        ? 'Track Preparation is complete. AXIOM returned you to the full Library.'
        : nextFilter && nextLabel
          ? `Next: ${nextCount.toLocaleString()} ${nextLabel}. The list moved to that work automatically.`
          : activeLibraryPreparationFilter === 'all'
            ? 'Choose a missing-information filter to continue, or use View All Tracks to return to the Library.'
            : `${activeLibraryPreparationFilteredTotal.toLocaleString()} track${activeLibraryPreparationFilteredTotal === 1 ? '' : 's'} remain in this preparation queue.`;
      const savedCopy = estimatedValues > 0
        ? `${fixedValues.toLocaleString()} verified and ${estimatedValues.toLocaleString()} estimated value${estimatedValues === 1 ? '' : 's'} saved`
        : `${fixedValues.toLocaleString()} value${fixedValues === 1 ? '' : 's'} saved`;
      const retryCount = Math.max(0, Number(job.year_retries?.pending || 0));
      const retryCopy = retryCount ? ` ${retryCount.toLocaleString()} waiting for automatic retry.` : '';
      document.getElementById('library-preparation-stop-retries')?.classList.toggle('hidden', !retryCount);
      setHealthText('library-preparation-receipt-title', savedValues > 0 ? 'Scan Finished — Results Saved' : 'Scan Finished — Attention Still Needed');
      setHealthText(
        'library-preparation-receipt-copy',
        `${scanned.toLocaleString()} track${scanned === 1 ? '' : 's'} checked. ${savedCopy}; ${review.toLocaleString()} still need attention.${retryCopy} ${completionCopy}`
      );
      setHealthText('library-preparation-receipt-scanned', scanned.toLocaleString());
      setHealthText('library-preparation-receipt-fixed', savedValues.toLocaleString());
      setHealthText('library-preparation-receipt-review', review.toLocaleString());
      const exportButton = document.getElementById('library-preparation-export-key-batch');
      const unresolvedKeyCount = Math.max(0, Number(activeLibraryPreparationFilteredTotal || 0));
      const canExportKeyBatch = activeLibraryPreparationFilter === 'missing_key' && unresolvedKeyCount > 0;
      if (exportButton) {
        exportButton.classList.toggle('hidden', !canExportKeyBatch);
        exportButton.textContent = `Create ${unresolvedKeyCount.toLocaleString()}-Track Serato/djay Analysis Batch`;
        exportButton.title = 'Downloads one M3U8. Import it into Serato or djay Pro, select all tracks, run analysis, then return to AXIOM and scan missing keys again.';
      }
      receipt.classList.remove('hidden');
    }

    async function downloadLibraryKeyAnalysisBatch(button = null) {
      setAxiomButtonBusy(button, true, 'Creating Batch...');
      try {
        const resp = await fetch('/api/library/export_key_analysis_batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ all_missing_key: true }),
        });
        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          throw new Error(data.error || 'The DJ analysis batch could not be created.');
        }
        const blob = await resp.blob();
        const disposition = resp.headers.get('Content-Disposition') || '';
        const filenameMatch = disposition.match(/filename\*?=(?:UTF-8''|\")?([^\";]+)/i);
        const filename = decodeURIComponent((filenameMatch?.[1] || `AXIOM_MISSING_KEYS_${Date.now()}.m3u8`).replace(/^\"|\"$/g, ''));
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        const count = Number(resp.headers.get('X-AXIOM-Track-Count') || 0);
        showToast(`${count} unresolved tracks exported. Import the M3U8 into Serato or djay Pro, analyze all, then run Scan + Update Missing Keys again.`);
      } catch (error) {
        showToast(error.message || 'The DJ analysis batch could not be created.', true);
      } finally {
        setAxiomButtonBusy(button, false);
      }
    }

    async function restoreLibraryPreparationScanReceipt() {
      try {
        const resp = await fetch('/api/library/unified_health/status', { cache: 'no-store' });
        const data = await resp.json().catch(() => ({}));
        const job = data.job || {};
        if (resp.ok && (Number(job.year_retries?.pending || 0) > 0 || unifiedHealthIsActive(job))) {
          if (!unifiedHealthPollTimer) unifiedHealthPollTimer = window.setTimeout(pollUnifiedHealthStatus, 1000);
        }
        const terminal = ['complete', 'needs_review', 'no_work', 'stopped'].includes(String(job.status || '').toLowerCase());
        if (resp.ok && terminal && ['selected_tracks', 'preparation_filter'].includes(String(job.scope || ''))) {
          renderLibraryPreparationScanReceipt(job);
          return job;
        }
      } catch (_) { }
      if (lastLibraryPreparationReceiptJob) {
        renderLibraryPreparationScanReceipt(lastLibraryPreparationReceiptJob);
        return lastLibraryPreparationReceiptJob;
      }
      try {
        const saved = JSON.parse(localStorage.getItem(LIBRARY_PREPARATION_RECEIPT_KEY) || 'null');
        if (saved && ['selected_tracks', 'preparation_filter'].includes(String(saved.scope || ''))) {
          renderLibraryPreparationScanReceipt(saved);
          return saved;
        }
      } catch (_) { }
      return null;
    }

    async function runLibraryPreparationPrimaryAction(button = null) {
      if (activeLibraryPreparationFilter === 'missing_file') {
        return removeAllMissingLibrarySongs(button);
      }
      if (activeLibraryPreparationFilter === 'bpm_review') {
        const reviewLane = activeLibraryPreparationFilter;
        showTab('health');
        window.setTimeout(() => selectHealthInboxItem(reviewLane), 0);
        return;
      }
      return scanVisibleLibraryPreparation(button);
    }

    async function removeAllMissingLibrarySongs(button = null) {
      const missingCount = Math.max(0, Number(button?.dataset?.missingCount || 0));
      if (!missingCount) return showToast('No missing songs are waiting to be removed.');
      const confirmed = await showAxiomConfirm(
        'Remove All Missing Songs From AXIOM',
        `Remove all ${missingCount.toLocaleString()} disconnected song${missingCount === 1 ? '' : 's'} from AXIOM's Library cache? No audio files or DJ software databases will be changed. Removed entries remain recoverable from Health's Restore Bin.`,
        `REMOVE ALL ${missingCount.toLocaleString()} MISSING SONGS`,
        'danger'
      );
      if (!confirmed) return;

      setAxiomButtonBusy(button, true, '<span>Removing Missing Songs...</span>');
      try {
        const resp = await fetch('/api/library/purge_missing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.success === false) throw new Error(data.error || data.message || 'Missing-song removal failed');
        lastHealthCheckAt = 0;
        await loadLibraryStats(false);
        await runSearch();
        showToast(data.message || `${Number(data.purged_count || 0).toLocaleString()} missing songs removed from AXIOM. Source audio untouched.`);
      } catch (error) {
        showToast(error.message || 'Missing-song removal failed.', true);
      } finally {
        setAxiomButtonBusy(button, false);
      }
    }

    async function scanVisibleLibraryPreparation(button = null) {
      const rows = Array.from(document.querySelectorAll('#search-results .library-track-card[data-path]'));
      const visiblePaths = rows
        .map(row => String(row.dataset.path || ''))
        .filter(path => path && libraryTrackNeedsAudioPreparation(trackVisualCache.get(path) || {}));
      const fullFilteredBatch = ['missing_metadata', 'missing_bpm_or_key', 'missing_key', 'missing_bpm', 'missing_year', 'missing_both'].includes(activeLibraryPreparationFilter);
      const expectedBatchCount = fullFilteredBatch
        ? Math.max(0, Number(button?.dataset?.batchCount || activeLibraryPreparationFilteredTotal || visiblePaths.length))
        : visiblePaths.length;
      if (!expectedBatchCount) return showToast('The filtered Library tracks already have BPM, Key, and Year.', true);
      const lanes = libraryPreparationRequestedLanes();
      const laneLabel = lanes.length === 1 && lanes[0] === 'missing_key'
        ? 'Missing Key'
        : lanes.length === 1 && lanes[0] === 'missing_bpm'
          ? 'Missing BPM'
          : lanes.length === 1 && lanes[0] === 'missing_year'
            ? 'Missing Year'
            : lanes.includes('missing_year')
              ? 'Missing BPM + Key + Year'
              : 'Missing BPM + Key';
      const confirmed = await showAxiomConfirm(
        `Scan + Update ${laneLabel}`,
        `AXIOM will analyze the full filtered batch of ${libraryPreparationBatchLabel(expectedBatchCount)} and save its strongest detected ${laneLabel.toLowerCase()} results. Source audio remains untouched.`,
        `Scan ${expectedBatchCount.toLocaleString()} Filtered Tracks`,
        'primary'
      );
      if (!confirmed) return;
      renderLibraryPreparationScanReceipt(null);
      setAxiomButtonBusy(button, true, 'Starting...');
      window.axiomUnifiedHealthProgressOwnsBanner = true;
      setHealthProgressMetricLabels('Checked', 'Queued', 'Fixed', 'Still Missing');
      updateHealthProgressMetrics({}, true);
      setHealthProgressState(
        1,
        `Preparing ${laneLabel} scan...`,
        `Scan accepted. Gathering ${expectedBatchCount.toLocaleString()} filtered track${expectedBatchCount === 1 ? '' : 's'} for the repair worker. Source audio stays untouched.`,
        'QUEUING',
        { owner: 'unified' }
      );
      startHealthProgressPulse(lanes.length === 1 && lanes.includes('missing_key') ? 'KEY SCAN' : lanes.length === 1 && lanes.includes('missing_bpm') ? 'BPM SCAN' : lanes.length === 1 && lanes.includes('missing_year') ? 'YEAR SCAN' : 'HEALTH SCAN');
      await new Promise(resolve => window.requestAnimationFrame(() => resolve()));

      let paths = visiblePaths.slice(0, LIBRARY_RESULT_MAX);
      if (fullFilteredBatch) {
        // The server owns the complete filtered queue. Do not derive the repair
        // scope from the 400-row Library render window: large libraries must be
        // repaired beyond whatever happens to be visible in the browser.
        paths = [];
      }
      if (!paths.length && !fullFilteredBatch) {
        window.axiomUnifiedHealthProgressOwnsBanner = false;
        stopHealthProgressPulse('complete');
        setAxiomButtonBusy(button, false);
        return showToast('The filtered Library tracks already have BPM, Key, and Year.');
      }
      return startUnifiedHealthScan(lanes, button, paths, {
        preparationFilter: fullFilteredBatch ? activeLibraryPreparationFilter : '',
      });
    }
