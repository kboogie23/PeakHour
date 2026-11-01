    // Health Serato library-selection and cache-import workflows.
    let pendingSeratoMetadataKind = 'bpm';

    async function syncSeratoLibraryToAxiom() {
      if (!(await ensureAxiomLicenseUsable('Sync Serato library'))) return;
      promptSeratoMetadataCSV('all');
    }

    async function restoreMusicFolderBeforeSeratoRepair() {
      if (typeof window.AXIOM_BROWSER_RESTORE_FOLDER !== 'function') return true;
      setHealthProgressState(
        8,
        'Checking AXIOM music folder before Serato repair...',
        'If Chrome still remembers your folder permission, AXIOM will restore the library index before matching Serato BPM/key/year data.',
        'CHECK'
      );
      const result = await window.AXIOM_BROWSER_RESTORE_FOLDER({ requestPermission: true }).catch(err => ({
        success: false,
        message: err?.message || 'Music folder restore did not complete.'
      }));
      if (result?.success) {
        const total = Number(result.total_tracks || 0);
        setHealthProgressState(
          16,
          result.restored ? 'Music folder restored. Serato repair can continue.' : 'Music folder connected. Serato repair can continue.',
          total ? `${total.toLocaleString()} AXIOM tracks are available for Serato matching.` : 'AXIOM has a music folder connection for matching.',
          result.restored ? 'RESTORED' : 'READY'
        );
        return true;
      }
      setHealthProgressState(
        100,
        'Reconnect your music folder before Serato repair.',
        result?.message || 'AXIOM needs the music folder connected so Serato BPM/key/year data can be matched safely.',
        'ACTION'
      );
      showToast(result?.message || 'Reconnect your music folder before Serato repair.', true);
      return false;
    }

    function seratoHealthReadyCount(result) {
      return Number(result?.summary?.ready_to_update || result?.summary?.metadata_updates_ready || 0);
    }

    function seratoHealthUpdatedCount(result) {
      return Number(result?.summary?.updated || result?.summary?.metadata_updates_applied || 0);
    }

    function seratoHealthMatchCount(result) {
      return Number(result?.summary?.serato_matches || 0) + Number(result?.summary?.tag_matches || 0);
    }

    function showInstalledSeratoHealthReview(results = {}, applied = false) {
      const container = document.getElementById('health-progress-container');
      const review = document.getElementById('health-repair-review');
      const label = document.getElementById('health-progress-label');
      const bar = document.getElementById('health-progress-bar');
      const pct = document.getElementById('health-progress-percent');
      if (!container || !review) return;

      const bpmCount = applied ? seratoHealthUpdatedCount(results.bpm) : seratoHealthReadyCount(results.bpm);
      const keyCount = applied ? seratoHealthUpdatedCount(results.key) : seratoHealthReadyCount(results.key);
      const yearCount = applied ? seratoHealthUpdatedCount(results.year) : seratoHealthReadyCount(results.year);
      const total = bpmCount + keyCount + yearCount;
      const matched = seratoHealthMatchCount(results.bpm) + seratoHealthMatchCount(results.key) + seratoHealthMatchCount(results.year);
      const rows = [
        { label: 'BPM', value: bpmCount, detail: applied ? 'BPMs updated in AXIOM' : 'BPMs ready from Serato' },
        { label: 'Key', value: keyCount, detail: applied ? 'Keys updated in AXIOM' : 'Keys ready from Serato' },
        { label: 'Year', value: yearCount, detail: applied ? 'Years updated in AXIOM' : 'Years ready from Serato/tags' },
      ];

      if (label) label.innerText = applied ? 'Serato Health fixes applied.' : 'Serato Health preview ready.';
      if (bar) bar.style.width = '100%';
      if (pct) pct.innerText = '100%';

      review.innerHTML = `
        <div class="health-repair-head">
          <div>
            <div class="health-repair-kicker">Installed App Serato Repair</div>
            <div class="health-repair-title">${applied ? `Fixed ${total.toLocaleString()} AXIOM value${total === 1 ? '' : 's'} from Serato.` : `${total.toLocaleString()} AXIOM value${total === 1 ? '' : 's'} can be fixed from Serato.`}</div>
            <div class="health-repair-subtitle">Matched ${matched.toLocaleString()} Serato/tag rows. Source audio and Serato database untouched.</div>
          </div>
          <div class="health-repair-actions">
            <button type="button" onclick="hideHealthRepairReview()">Close</button>
          </div>
        </div>
        <div class="health-repair-list">
          ${rows.map(row => `
            <div class="health-repair-row">
              <div class="health-repair-row-main">
                <strong>${row.label}</strong>
                <span>${row.detail}</span>
                <small>AXIOM cache only</small>
              </div>
              <div class="health-repair-row-result">
                <b>${row.value.toLocaleString()}</b>
                <small>${applied ? 'Updated' : 'Ready'}</small>
              </div>
            </div>
          `).join('')}
        </div>
      `;
      container.classList.remove('hidden');
      review.classList.remove('hidden');
    }

    async function syncSeratoLibraryFolderToAxiom(triggerBtn = null) {
      if (!(await ensureAxiomLicenseUsable('Sync Serato library'))) return;
      const button = triggerBtn || null;
      if (!window.AXIOM_WEB_PREVIEW) {
        const connected = await connectSeratoByChoosingDatabase();
        if (connected) {
            setAxiomButtonBusy(button, true, 'Connecting...');
          showToast('Serato database V2 connected. Refreshing Library Health with its BPM, key, year, crates, and MP4 paths.');
          await runLibraryHealthCheck({ force: true });
            setAxiomButtonBusy(button, false);
        }
        return;
      }
      if (!(await restoreMusicFolderBeforeSeratoRepair())) return;
      setAxiomButtonBusy(button, true, 'Connecting...');
      if ('showDirectoryPicker' in window) {
        try {
          showToast('Choose your _Serato_ folder. AXIOM reads database V2 only; it does not upload your music.');
          const directoryHandle = await window.showDirectoryPicker({ mode: 'read' });
          window.AXIOM_BROWSER_SET_SERATO_DIRECTORY_HANDLE?.(directoryHandle);
          const selection = await seratoSelectionFromDirectoryHandle(directoryHandle);
          await runSeratoLibrarySync([selection.databaseFile], selection);
            setAxiomButtonBusy(button, false);
          return;
        } catch (err) {
            setAxiomButtonBusy(button, false);
          if (err?.name === 'AbortError') return;
          showToast(err.message || 'AXIOM could not read database V2 from that Serato folder.', true);
          return;
        }
      }
      const input = document.getElementById('serato-folder-upload');
      if (!input) {
        showToast('Serato library repair is not ready yet.', true);
        setAxiomButtonBusy(button, false);
        return;
      }
      showToast('Choose the file named database V2 inside your _Serato_ folder. AXIOM updates AXIOM only.');
      input.value = '';
      input.click();
      setAxiomButtonBusy(button, false);
    }

    function promptSeratoMetadataCSV(kind = 'bpm') {
      pendingSeratoMetadataKind = kind;
      const input = document.getElementById('serato-metadata-csv-upload');
      if (!input) {
        showToast('Serato CSV import is not ready yet.', true);
        return;
      }
      const label = kind === 'all' ? 'BPM, key, and year' : kind.toUpperCase();
      showToast(`Backup CSV mode: choose a Serato CSV export with ${label} data.`);
      input.value = '';
      input.click();
    }

    function formatHealthProgressElapsed(startedAt) {
      const totalSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return minutes ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${totalSeconds}s`;
    }

    function updateHealthProgressStageboard(activeStage = 'connect', completedStages = [], modeLabel = 'Health Repair Active') {
      const board = document.getElementById('health-progress-stageboard');
      const mode = document.getElementById('health-progress-stage-mode');
      if (!board) return;
      const done = new Set(completedStages || []);
      board.querySelectorAll('[data-health-stage]').forEach(stageEl => {
        const stage = stageEl.dataset.healthStage;
        stageEl.classList.toggle('active', stage === activeStage);
        stageEl.classList.toggle('done', done.has(stage));
      });
      if (mode) mode.textContent = modeLabel;
      board.classList.remove('hidden');
    }

    function resetHealthProgressStageboard() {
      const board = document.getElementById('health-progress-stageboard');
      if (!board) return;
      board.querySelectorAll('[data-health-stage]').forEach(stageEl => {
        stageEl.classList.remove('active', 'done');
      });
      board.classList.add('hidden');
    }

    function ensureHealthProgressAtTop() {
      const progress = document.getElementById('health-progress-container');
      const repairCenter = document.getElementById('health-repair-center');
      if (!progress || !repairCenter) return;
      if (progress.previousElementSibling !== repairCenter) {
        repairCenter.insertAdjacentElement('afterend', progress);
      }
    }

    function setHealthLiveHeadline(title = 'Health Scan Live', copy = 'AXIOM is working through the selected Health lane. Source audio stays untouched.', status = 'Working') {
      ensureHealthProgressAtTop();
      setHealthText('health-live-headline-title', title);
      setHealthText('health-live-headline-copy', copy);
      setHealthText('health-live-headline-status', status);
    }

    function setHealthTopScanBanner(active = true, title = 'AXIOM IS SCANNING HEALTH', copy = 'AXIOM is actively checking Health data. Source audio stays untouched.', status = 'WORKING', percent = 0) {
      const banner = document.getElementById('health-top-scan-banner');
      const titleEl = document.getElementById('health-top-scan-title');
      const copyEl = document.getElementById('health-top-scan-copy');
      const statusEl = document.getElementById('health-top-scan-status');
      const bar = document.getElementById('health-top-scan-bar');
      if (!banner) return;
      banner.classList.toggle('hidden', !active);
      document.body.classList.toggle('health-scan-banner-active', Boolean(active));
      if (!active) {
        banner.classList.remove('health-banner-yielding');
        return;
      }
      installHealthBannerPointerYield();
      if (titleEl) titleEl.textContent = title;
      if (copyEl) copyEl.textContent = copy;
      if (statusEl) {
        statusEl.textContent = 'STOP SAFELY';
        statusEl.setAttribute('aria-label', `Stop safely · ${status}`);
      }
      if (bar) {
        const nextPercent = Math.max(0, Math.min(100, Number(percent) || 0));
        bar.style.width = `${nextPercent}%`;
        bar.style.minWidth = nextPercent > 0 ? '2px' : '0';
        setHealthText('health-top-scan-percent', formatHealthProgressPercent(nextPercent));
      }
    }

    function installHealthBannerPointerYield() {
      if (window.axiomHealthBannerPointerYieldInstalled) return;
      window.axiomHealthBannerPointerYieldInstalled = true;
      const interactive = 'button, a[href], input, select, textarea, summary, [role="button"], [onclick]';
      document.addEventListener('pointermove', event => {
        if (event.pointerType === 'touch') return;
        const banner = document.getElementById('health-top-scan-banner');
        if (!banner || banner.classList.contains('hidden')) return;
        const box = banner.getBoundingClientRect();
        const inside = event.clientX >= box.left && event.clientX <= box.right
          && event.clientY >= box.top && event.clientY <= box.bottom;
        if (!inside) {
          banner.classList.remove('health-banner-yielding');
          return;
        }
        // Keep the hidden region stable until the pointer leaves: toggling
        // pointer-events must not cause enter/leave flicker over the control.
        if (banner.classList.contains('health-banner-yielding')) return;
        const ownControl = event.target?.closest?.('button, a, input, [role="button"]');
        if (ownControl && banner.contains(ownControl)) return;
        const coveredControl = document.elementsFromPoint(event.clientX, event.clientY)
          .find(node => !banner.contains(node) && node.closest?.(interactive));
        if (coveredControl) banner.classList.add('health-banner-yielding');
      }, { passive: true, capture: true });
      document.addEventListener('pointerleave', () => {
        document.getElementById('health-top-scan-banner')?.classList.remove('health-banner-yielding');
      });
    }

    function stopHealthProgressPulse(finalStatus = '') {
      window.axiomHealthProgressActive = finalStatus === 'running';
      const unifiedOwnsBanner = Boolean(window.axiomUnifiedHealthProgressOwnsBanner);
      if (window.axiomHealthProgressPulse && (!unifiedOwnsBanner || finalStatus === 'running')) {
        window.clearInterval(window.axiomHealthProgressPulse);
        window.axiomHealthProgressPulse = null;
      }
      const container = document.getElementById('health-progress-container');
      const live = document.getElementById('health-progress-live-time');
      if (container && finalStatus !== 'running' && !unifiedOwnsBanner) {
        container.classList.add('hidden');
        container.classList.add('is-complete');
        container.dataset.healthProgressState = 'complete';
        container.style.display = 'none';
        container.classList.remove('is-running', 'top-banner-only');
      }
      if (live && finalStatus) live.textContent = finalStatus;
      if (finalStatus !== 'running' && !unifiedOwnsBanner) setHealthWorkingBanner(false);
      if (finalStatus !== 'running' && !unifiedOwnsBanner) setHealthTopScanBanner(false);
      if (finalStatus !== 'running' && !unifiedOwnsBanner) document.body.classList.remove('health-scan-banner-active');
    }

    function startHealthProgressPulse(status = 'WORKING') {
      stopHealthProgressPulse('running');
      ensureHealthProgressAtTop();
      const liveContainer = document.getElementById('health-progress-container');
      if (liveContainer) {
        liveContainer.style.display = '';
        liveContainer.classList.remove('hidden', 'is-complete', 'health-progress-complete');
        liveContainer.dataset.healthProgressState = 'running';
        liveContainer.classList.add('top-banner-only');
      }
      const startedAt = Date.now();
      const statusUpper = String(status || 'WORKING').toUpperCase();
      const workingTitle = statusUpper.includes('YEAR')
        ? 'AXIOM IS SCANNING YEARS'
        : statusUpper.includes('KEY')
          ? 'AXIOM IS SCANNING KEYS'
          : statusUpper.includes('BPM')
            ? 'AXIOM IS SCANNING BPM'
            : statusUpper.includes('CHECK')
              ? 'AXIOM IS CHECKING HEALTH'
            : statusUpper.includes('AUTO')
              ? 'AXIOM IS READING SERATO'
              : statusUpper.includes('APPLY')
                ? 'AXIOM IS APPLYING FIXES'
                : 'AXIOM IS REPAIRING HEALTH';
      const workingCopy = statusUpper.includes('KEY')
        ? 'AXIOM is checking exact-path Serato and djay Pro keys, tags, filename hints, then strict audio agreement. Conflicts are never guessed.'
        : statusUpper.includes('BPM')
          ? 'AXIOM is checking exact-path Serato and djay Pro BPM, tags, filename hints, then deeper tempo analysis.'
        : statusUpper.includes('YEAR')
            ? 'Year lookup is active. AXIOM is checking music sources and title cleanup, then updating AXIOM cache only.'
            : statusUpper.includes('CHECK')
              ? 'AXIOM is counting missing files, BPM, key, and year records. This check does not repair or change them.'
            : 'Keep this open. The moving timer means Health is still working.';
      const tick = () => {
        const elapsed = formatHealthProgressElapsed(startedAt);
        const live = document.getElementById('health-progress-live-time');
        const container = document.getElementById('health-progress-container');
        const detailEl = document.getElementById('health-progress-detail');
        const pill = detailEl?.querySelector('.serato-progress-pill');
        if (container) container.classList.add('is-running');
        if (live) live.textContent = `Running ${elapsed}`;
        setHealthLiveHeadline(workingTitle, workingCopy, `${status} ${elapsed}`);
        // The server-status poll owns the fixed top banner. Writing a second,
        // different title here every 900ms made the banner flicker between
        // SCANNING and WORKING while the same job was running.
        setHealthWorkingBanner(true, workingTitle, workingCopy, `${status} ${elapsed}`);
        if (pill) pill.innerHTML = `<span class="serato-progress-pulse"></span>${escapeHtml(status)} ${escapeHtml(elapsed)}`;
      };
      tick();
      window.axiomHealthProgressPulse = window.setInterval(tick, 900);
      return () => stopHealthProgressPulse();
    }

    function setHealthWorkingBanner(active = true, title = 'AXIOM IS REPAIRING', copy = 'Keep this open. The moving timer means Health is still working.', status = 'WORKING') {
      const banner = document.getElementById('health-working-banner');
      const titleEl = document.getElementById('health-working-title');
      const copyEl = document.getElementById('health-working-copy');
      const statusEl = document.getElementById('health-working-status');
      if (!banner) return;
      banner.classList.toggle('hidden', !active);
      if (!active) return;
      if (titleEl) titleEl.textContent = title;
      if (copyEl) copyEl.textContent = copy;
      if (statusEl) statusEl.textContent = status;
    }

    function setHealthProgressState(percent, label, detail = '', status = 'WORKING', options = {}) {
      const progressOwner = String(options?.owner || 'general');
      if (window.axiomUnifiedHealthProgressOwnsBanner && progressOwner !== 'unified') return;
      const container = document.getElementById('health-progress-container');
      const bar = document.getElementById('health-progress-bar');
      const pct = document.getElementById('health-progress-percent');
      const labelEl = document.getElementById('health-progress-label');
      const detailEl = document.getElementById('health-progress-detail');
      const nextPercent = Math.max(0, Math.min(100, Number(percent) || 0));
      const terminalStatus = ['complete', 'completed', 'needs_review', 'no_work', 'stopped', 'failed', 'error', 'cancelled'].includes(String(status).trim().toLowerCase().replace(/\s+/g, '_'));
      const progressActive = typeof options?.active === 'boolean' ? options.active : (nextPercent > 0 && nextPercent < 100);
      if (options?.active === false || terminalStatus) {
        stopHealthProgressPulse(status);
        window.axiomHealthProgressActive = false;
        container?.classList.remove('is-running');
        container?.classList.add('hidden');
        setHealthTopScanBanner(false);
        setHealthWorkingBanner(false);
        document.body.classList.remove('health-scan-banner-active');
        return;
      }
      const isComplete = nextPercent >= 100;
      if (isComplete) {
        window.axiomHealthProgressActive = false;
        if (window.axiomHealthProgressCompletionHideTimer) {
          window.clearTimeout(window.axiomHealthProgressCompletionHideTimer);
          window.axiomHealthProgressCompletionHideTimer = null;
        }
        if (bar) bar.style.width = '0%';
        if (pct) pct.innerText = '';
        if (labelEl) labelEl.innerText = '';
        if (detailEl) {
          detailEl.classList.add('hidden');
          detailEl.innerHTML = '';
        }
        if (container) {
          container.classList.add('hidden', 'is-complete', 'health-progress-complete');
          container.classList.remove('is-running', 'top-banner-only');
          container.dataset.healthProgressState = 'complete';
          container.setAttribute('aria-hidden', 'true');
          container.dataset.retiredHealthProgressLayer = 'true';
          container.style.setProperty('display', 'none', 'important');
          container.style.setProperty('visibility', 'hidden', 'important');
          container.style.setProperty('pointer-events', 'none', 'important');
        }
        setHealthTopScanBanner(false);
        setHealthWorkingBanner(false);
        document.body.classList.remove('health-scan-banner-active');
        guardHealthProgressReceiptOverlay();
        return;
      }
      if (!isComplete) {
        window.axiomHealthProgressActive = true;
        if (window.axiomHealthProgressCompletionHideTimer) {
          window.clearTimeout(window.axiomHealthProgressCompletionHideTimer);
          window.axiomHealthProgressCompletionHideTimer = null;
        }
        ensureHealthProgressAtTop();
        if (container) {
          container.style.display = '';
          container.classList.remove('hidden', 'is-complete', 'health-progress-complete');
          container.dataset.healthProgressState = 'running';
        }
      }
      if (bar) {
        bar.style.width = `${nextPercent}%`;
        bar.style.minWidth = nextPercent > 0 ? '2px' : '0';
      }
      if (pct) pct.innerText = formatHealthProgressPercent(nextPercent);
      if (labelEl && label) labelEl.innerText = label;
      if (container) container.classList.toggle('is-running', progressActive);
      setHealthLiveHeadline(
        nextPercent < 100 ? 'AXIOM IS WORKING HEALTH' : 'HEALTH SCAN RECEIPT READY',
        detail || 'Health is working through your library. Keep this open until the receipt appears.',
        status
      );
      setHealthWorkingBanner(
        progressActive,
        nextPercent < 1 ? 'AXIOM IS STARTING HEALTH' : 'AXIOM IS REPAIRING',
        detail || 'Health is working through your library. Keep this open until the receipt appears.',
        status
      );
      setHealthTopScanBanner(
        progressActive,
        nextPercent < 1 ? 'AXIOM IS STARTING HEALTH' : 'AXIOM IS WORKING HEALTH',
        detail || 'Health is working through your library. Keep this open until the receipt appears.',
        `${status} ${formatHealthProgressPercent(nextPercent)}`,
        nextPercent
      );
      if (isComplete) {
        window.axiomHealthProgressActive = false;
        setHealthTopScanBanner(false);
        setHealthWorkingBanner(false);
        if (container) {
          container.classList.add('hidden');
          container.classList.add('is-complete');
          container.dataset.healthProgressState = 'complete';
          container.style.display = 'none';
          container.classList.remove('is-running', 'top-banner-only');
        }
        document.body.classList.remove('health-scan-banner-active');
      }
      if (detailEl) {
        if (detail) {
          const complete = nextPercent >= 100;
          detailEl.innerHTML = `
            <div>
              <strong>${escapeHtml(label || 'Serato repair running')}</strong>
              <span>${escapeHtml(detail)}</span>
            </div>
            <div class="serato-progress-pill">${complete ? '' : '<span class="serato-progress-pulse"></span>'}${escapeHtml(status)}</div>
          `;
          detailEl.classList.remove('hidden');
        } else {
          detailEl.classList.add('hidden');
          detailEl.innerHTML = '';
        }
      }
      guardHealthProgressReceiptOverlay();
    }

    function guardHealthProgressReceiptOverlay() {
      if (window.axiomUnifiedHealthProgressOwnsBanner) return;
      const container = document.getElementById('health-progress-container');
      if (!container) return;
      const title = document.getElementById('health-live-headline-title')?.textContent || '';
      const status = document.getElementById('health-live-headline-status')?.textContent || '';
      const label = document.getElementById('health-progress-label')?.textContent || '';
      const percent = parseInt(document.getElementById('health-progress-percent')?.textContent || '0', 10) || 0;
      const receiptText = `${title} ${status} ${label}`.toLowerCase();
      const isReceipt = percent >= 100 || receiptText.includes('complete') || receiptText.includes('receipt ready');
      if (!isReceipt) return;
      window.axiomHealthProgressActive = false;
      container.classList.add('hidden', 'is-complete', 'health-progress-complete');
      container.dataset.healthProgressState = 'complete';
      container.style.display = 'none';
      container.classList.remove('is-running', 'top-banner-only');
      document.body.classList.remove('health-scan-banner-active');
      setHealthTopScanBanner(false);
      setHealthWorkingBanner(false);
    }

    function installHealthProgressReceiptGuard() {
      if (window.axiomHealthProgressReceiptGuardInstalled) return;
      const container = document.getElementById('health-progress-container');
      if (!container || typeof MutationObserver === 'undefined') return;
      window.axiomHealthProgressReceiptGuardInstalled = true;
      const observer = new MutationObserver(() => {
        window.requestAnimationFrame(guardHealthProgressReceiptOverlay);
      });
      observer.observe(container, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });
      guardHealthProgressReceiptOverlay();
    }

    window.setTimeout(installHealthProgressReceiptGuard, 0);

    function seratoSyncSummaryLine(data = {}, applied = false) {
      const summary = data.summary || {};
      const parsed = Number(summary.parsed_tracks || 0);
      const matched = Number(summary.serato_matches || 0);
      const ready = Number(summary.metadata_updates_ready || 0);
      const fixed = Number(summary.metadata_updates_applied || 0);
      const bpm = Number(applied ? summary.bpm_updated : summary.bpm_ready || 0);
      const key = Number(applied ? summary.key_updated : summary.key_ready || 0);
      const year = Number(applied ? summary.year_updated : summary.year_ready || 0);
      const total = applied ? fixed : ready;
      return [
        parsed ? `${parsed.toLocaleString()} Serato rows scanned` : '',
        matched ? `${matched.toLocaleString()} matched AXIOM tracks` : '',
        `${total.toLocaleString()} ${applied ? 'values fixed' : 'values ready'}`,
        `BPM ${bpm.toLocaleString()}`,
        `Key ${key.toLocaleString()}`,
        `Year ${year.toLocaleString()}`
      ].filter(Boolean).join(' · ');
    }

    function startSeratoSyncProgressTicker(mode = 'preview') {
      const startedAt = Date.now();
      const elapsedLabel = (elapsed) => {
        const totalSeconds = Math.max(1, Math.round(elapsed / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return minutes ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${totalSeconds}s`;
      };
      const stages = mode === 'apply'
        ? [
            { at: 0, pct: 61, label: 'Starting Serato sync into AXIOM...', detail: 'AXIOM is preparing Serato BPM, key, and year details for your library.' },
            { at: 15000, pct: 64, label: 'Syncing Serato details into AXIOM...', detail: (elapsed) => `Keep this tab open. AXIOM is syncing Serato BPM, key, and track details into your AXIOM library. Running ${elapsedLabel(elapsed)}.` },
            { at: 60000, pct: 67, label: 'Still syncing your AXIOM library...', detail: (elapsed) => `Large libraries can take several minutes. The moving timer means AXIOM is still working. Running ${elapsedLabel(elapsed)}.` },
            { at: 120000, pct: 70, label: 'Saving Serato BPM, key, and year details...', detail: (elapsed) => `Use the AXIOM Refresh button to check dropping Health numbers. Do not reload the browser tab. Running ${elapsedLabel(elapsed)}.` },
            { at: 240000, pct: 74, label: 'Working through a large library sync...', detail: (elapsed) => `AXIOM is continuing the Serato-to-AXIOM sync. This can take longer with thousands of tracks. Running ${elapsedLabel(elapsed)}.` },
            { at: 420000, pct: 78, label: 'Large library sync still running...', detail: (elapsed) => `Keep this tab open. If Health numbers drop after AXIOM Refresh, the sync is working. Running ${elapsedLabel(elapsed)}.` },
            { at: 660000, pct: 82, label: 'Still syncing Serato into AXIOM...', detail: (elapsed) => `This is a long library sync, not a failed scan. Use AXIOM Refresh to check progress; do not reload the tab. Running ${elapsedLabel(elapsed)}.` },
            { at: 900000, pct: 86, label: 'Final large-library sync stage...', detail: (elapsed) => `AXIOM is still finishing Serato details inside your AXIOM library. If Chrome asks, choose Wait. Running ${elapsedLabel(elapsed)}.` },
            { at: 1200000, pct: 90, label: 'Still finishing the Serato sync...', detail: (elapsed) => `This library is taking longer than expected, but AXIOM may still complete if the timer is moving. Running ${elapsedLabel(elapsed)}.` }
          ]
        : [
            { at: 0, pct: 28, label: 'Streaming Serato database V2 in safe browser batches...', detail: 'AXIOM is streaming the Serato database locally. No music files are uploaded.' },
            { at: 2200, pct: 38, label: 'Scanning Serato rows for BPM, key, and year...', detail: 'Large Serato libraries can take a moment. This means the repair is still working.' },
            { at: 5600, pct: 48, label: 'Matching Serato rows to your AXIOM library...', detail: 'AXIOM is comparing Serato track data with your connected music folder.' },
            { at: 9800, pct: 58, label: 'Still scanning Serato safely...', detail: 'No need to refresh. AXIOM will show the values found as soon as this pass finishes.' }
          ];
      let activeStage = -1;
      const tick = () => {
        const elapsed = Date.now() - startedAt;
        const nextIndex = stages.reduce((current, stage, index) => elapsed >= stage.at ? index : current, 0);
        if (nextIndex !== activeStage) {
          activeStage = nextIndex;
          const stage = stages[nextIndex];
          const detail = typeof stage.detail === 'function' ? stage.detail(elapsed) : stage.detail;
          setHealthProgressState(stage.pct, stage.label, detail, `${Math.max(1, Math.round(elapsed / 1000))}S`);
        } else {
          const stage = stages[nextIndex];
          const detail = typeof stage.detail === 'function' ? stage.detail(elapsed) : '';
          const detailEl = document.getElementById('health-progress-detail');
          const span = detailEl?.querySelector('span:not(.serato-progress-pulse)');
          if (span && detail) span.textContent = detail;
          const pill = detailEl?.querySelector('.serato-progress-pill');
          if (pill) pill.innerHTML = `<span class="serato-progress-pulse"></span>${Math.max(1, Math.round(elapsed / 1000))}S`;
        }
      };
      tick();
      const interval = window.setInterval(tick, 900);
      return () => window.clearInterval(interval);
    }

    function showSeratoLibrarySyncReview(data, applied = false) {
      const container = document.getElementById('health-progress-container');
      const review = document.getElementById('health-repair-review');
      const label = document.getElementById('health-progress-label');
      const bar = document.getElementById('health-progress-bar');
      const pct = document.getElementById('health-progress-percent');
      const detail = document.getElementById('health-progress-detail');
      if (!container || !review) return;

      const summary = data.summary || {};
      const readyValues = Number(summary.metadata_updates_ready || 0);
      const appliedValues = Number(summary.metadata_updates_applied || 0);
      const readyRows = Number(summary.ready_to_update || 0);
      const updatedRows = Number(summary.updated || 0);
      const matchedRows = Number(summary.serato_matches || 0);
      const bpmCount = Number(applied ? summary.bpm_updated : summary.bpm_ready || 0);
      const keyCount = Number(applied ? summary.key_updated : summary.key_ready || 0);
      const yearCount = Number(applied ? summary.year_updated : summary.year_ready || 0);
      const rows = Array.isArray(data.preview_rows) ? data.preview_rows : [];
      const actionCopy = applied
        ? `Fixed ${appliedValues.toLocaleString()} Library Health value${appliedValues === 1 ? '' : 's'} from Serato.`
        : `${readyValues.toLocaleString()} Serato BPM/key/year value${readyValues === 1 ? '' : 's'} can improve Library Health.`;

      if (label) label.innerText = applied ? 'Library Health improved from Serato.' : 'Serato Library Health preview ready.';
      if (bar) bar.style.width = '100%';
      if (pct) pct.innerText = '100%';
      if (detail) {
        detail.innerHTML = `
          <div>
            <strong>${applied ? 'Serato fixes applied' : 'Serato scan finished'}</strong>
            <span>${escapeHtml(seratoSyncSummaryLine(data, applied))}</span>
          </div>
          <div class="serato-progress-pill">${applied ? 'FIXED' : 'READY'}</div>
        `;
        detail.classList.remove('hidden');
      }

      const rowHtml = rows.length
        ? rows.map(row => {
            const title = escapeHtml(row.title || 'Unknown Track');
            const artist = escapeHtml(row.artist || '');
            const message = escapeHtml(row.message || '');
            const fields = Array.isArray(row.updated_fields) && row.updated_fields.length
              ? row.updated_fields.map(field => field.toUpperCase()).join(', ')
              : (row.status === 'already_correct' ? 'Already OK' : 'Review');
            const bpm = row.serato_bpm ? `BPM ${escapeHtml(formatBpmValue(row.serato_bpm))}` : '';
            const key = row.serato_key ? `KEY ${escapeHtml(row.serato_key)}` : '';
            const year = row.serato_year ? `YEAR ${escapeHtml(row.serato_year)}` : '';
            const values = [bpm, key, year].filter(Boolean).join(' · ') || fields;
            return `
              <div class="health-repair-row">
                <div class="health-repair-row-main">
                  <strong>${title}</strong>
                  <span>${artist || 'Unknown Artist'}</span>
                  <small>${message}</small>
                </div>
                <div class="health-repair-row-result">
                  <b>${values}</b>
                  <small>${escapeHtml(fields)}</small>
                </div>
              </div>
            `;
          }).join('')
        : `<div class="text-center py-6 text-white/50 text-[10px] font-black uppercase">No preview rows returned.</div>`;

      review.innerHTML = `
        <div class="health-repair-head">
          <div>
            <div class="health-repair-kicker">Library Health Repair</div>
            <div class="health-repair-title">${escapeHtml(actionCopy)}</div>
            <div class="health-repair-subtitle">Matched ${matchedRows.toLocaleString()} rows. Ready rows: ${readyRows.toLocaleString()}. Updated rows: ${updatedRows.toLocaleString()}. BPM ${bpmCount.toLocaleString()} · Key ${keyCount.toLocaleString()} · Year ${yearCount.toLocaleString()}. Source audio and Serato database untouched.</div>
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

    function showSeratoMetadataReview(kind, data, applied = false) {
      if (kind === 'all') return showSeratoLibrarySyncReview(data, applied);
      if (kind === 'key') return showSeratoKeyImportReview(data, applied);
      if (kind === 'year') return showSeratoYearImportReview(data, applied);
      return showSeratoBpmImportReview(data, applied);
    }

    async function uploadSeratoMetadataCSV(file, kind, apply = false) {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('kind', kind);
      formData.append('apply', apply ? 'true' : 'false');
      const resp = await fetch('/api/library/import_serato_metadata_csv', { method: 'POST', body: formData });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.success === false) throw new Error(data.error || data.message || 'Serato CSV import failed');
      return data;
    }

    function seratoBrowserFilePath(file = {}) {
      return String(file.webkitRelativePath || file.relativePath || file.name || '');
    }

    function attachSeratoRelativePath(file, relativePath) {
      try {
        Object.defineProperty(file, 'relativePath', {
          value: relativePath,
          configurable: true
        });
      } catch (_) {
        try { file.relativePath = relativePath; } catch (_) {}
      }
      return file;
    }

    async function countSeratoCratesFromDirectoryHandle(directoryHandle) {
      try {
        const subcrates = await directoryHandle.getDirectoryHandle('Subcrates');
        let count = 0;
        for await (const [, handle] of subcrates.entries()) {
          if (handle.kind === 'file' && String(handle.name || '').toLowerCase().endsWith('.crate')) count += 1;
        }
        return count;
      } catch (_) {
        return 0;
      }
    }

    async function seratoSelectionFromDirectoryHandle(directoryHandle) {
      let fileHandle = null;
      try {
        fileHandle = await directoryHandle.getFileHandle('database V2');
      } catch (_) {
        try {
          fileHandle = await directoryHandle.getFileHandle('database V2.backup');
        } catch (_) {}
      }
      if (!fileHandle) {
        throw new Error('That folder does not contain Serato database V2. Choose your _Serato_ folder.');
      }
      const file = attachSeratoRelativePath(await fileHandle.getFile(), `${directoryHandle.name || '_Serato_'}/${fileHandle.name}`);
      const crateCount = await countSeratoCratesFromDirectoryHandle(directoryHandle);
      return {
        databaseFile: file,
        crateCount,
        selectedCount: 1,
        ignoredCount: 0,
        sourceLabel: 'Serato database V2'
      };
    }

    function filterSeratoFolderFiles(files = [], suppliedSelection = null) {
      if (suppliedSelection?.databaseFile) {
        return suppliedSelection;
      }
      const allFiles = Array.from(files || []).filter(Boolean);
      const databaseFile = allFiles.find(file => {
        const path = seratoBrowserFilePath(file).toLowerCase();
        return path.endsWith('/database v2') || path === 'database v2' || path.endsWith('/database v2.backup') || path === 'database v2.backup';
      });
      const crateCount = allFiles.reduce((total, file) => {
        const path = seratoBrowserFilePath(file).toLowerCase();
        return total + (path.endsWith('.crate') ? 1 : 0);
      }, 0);
      return {
        databaseFile,
        crateCount,
        selectedCount: allFiles.length,
        ignoredCount: Math.max(0, allFiles.length - (databaseFile ? 1 : 0))
      };
    }

    async function uploadSeratoLibraryFolder(files, apply = false, suppliedSelection = null) {
      const selection = filterSeratoFolderFiles(files, suppliedSelection);
      if (!selection.databaseFile) {
        throw new Error('Choose the Serato database V2 file or your _Serato_ folder.');
      }
      const formData = new FormData();
      formData.append('files', selection.databaseFile);
      formData.append('apply', apply ? 'true' : 'false');
      formData.append('crate_count', String(selection.crateCount || 0));
      formData.append('selected_file_count', String(selection.selectedCount || 0));
      formData.append('ignored_file_count', String(selection.ignoredCount || 0));
      const resp = await fetch('/api/library/import_serato_folder', { method: 'POST', body: formData });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.success === false) throw new Error(data.error || data.message || 'Serato folder sync failed');
      return data;
    }

    async function runSeratoLibrarySync(files, suppliedSelection = null) {
      if (!files.length) return;
      if (seratoLibrarySyncInFlight) {
        showToast('Serato repair is already running. Let this scan finish first.', true);
        return;
      }
      seratoLibrarySyncInFlight = true;
      const seratoBtn = document.getElementById('btn-sync-serato-library');
      const originalSeratoBtnHtml = seratoBtn ? seratoBtn.innerHTML : '';
      if (seratoBtn) {
        seratoBtn.disabled = true;
        seratoBtn.style.opacity = '0.68';
        seratoBtn.innerHTML = '<span>SAFE SCAN...</span>';
      }
      const progContainer = document.getElementById('health-progress-container');
      progContainer?.classList.remove('hidden');
      hideHealthRepairReview();
      const selection = filterSeratoFolderFiles(files, suppliedSelection);
      const beforeSummary = healthSummarySnapshot(currentHealthSummary);
      updateHealthRepairCenter(currentHealthSummary, 'Serato Scan Running', 'AXIOM is reading database V2 locally, matching rows, and preparing a safe AXIOM-cache repair.');
      updateHealthProgressMetrics({ remaining: beforeSummary.total_blockers }, true);
      let stopProgressTicker = null;
      setHealthProgressState(
        selection.databaseFile ? 24 : 12,
        selection.databaseFile ? 'Preparing Serato Library Health repair...' : 'Looking for Serato database V2...',
        selection.databaseFile
          ? 'AXIOM found database V2 and is about to stream it locally in safe browser batches.'
          : 'Choose the Serato database V2 file inside your _Serato_ folder.',
        selection.databaseFile ? 'READY' : 'CHECK'
      );
      try {
        stopProgressTicker = startSeratoSyncProgressTicker('preview');
        const preview = await uploadSeratoLibraryFolder(files, false, selection);
        stopProgressTicker?.();
        stopProgressTicker = null;
        showSeratoLibrarySyncReview(preview, false);
        const ready = Number(preview.summary?.metadata_updates_ready || 0);
        updateHealthProgressMetrics({
          matched: Number(preview.summary?.serato_matches || 0),
          ready,
          fixed: 0,
          remaining: beforeSummary.total_blockers
        }, true);
        updateHealthRepairCenter(currentHealthSummary, 'Preview Ready', `${ready.toLocaleString()} Serato BPM/key/year value${ready === 1 ? '' : 's'} can improve AXIOM Health.`);
        if (preview.warning) showToast(preview.warning);
        if (ready <= 0) {
          showToast(preview.message || 'Serato folder checked. No BPM/key/year values need updating.', true);
          return;
        }
        const confirmed = await showAxiomConfirm(
          'Ready To Sync Serato',
          `AXIOM found ${ready.toLocaleString()} Serato BPM, key, and year detail${ready === 1 ? '' : 's'} that can improve your AXIOM library. Sync these details into AXIOM now? Your music files stay as they are.`,
          'SYNC TO AXIOM',
          'primary'
        );
        if (!confirmed) return;
        stopProgressTicker = startSeratoSyncProgressTicker('apply');
        const applied = await uploadSeratoLibraryFolder(files, true, selection);
        stopProgressTicker?.();
        stopProgressTicker = null;
        showSeratoLibrarySyncReview(applied, true);
        updateHealthProgressMetrics({
          matched: Number(applied.summary?.serato_matches || 0),
          ready,
          fixed: Number(applied.summary?.metadata_updates_applied || 0),
          remaining: beforeSummary.total_blockers
        }, true);
        showToast(applied.message || 'Library Health improved from Serato.');
        loadLibraryStats();
        if (!document.getElementById('tab-content-library')?.classList.contains('hidden')) runSearch();
        setHealthProgressState(
          96,
          'Refreshing Health numbers after Serato repair...',
          `${seratoSyncSummaryLine(applied, true)}. AXIOM is updating the visible missing BPM/key/year totals now.`,
          'REFRESH'
        );
        const refreshed = await runLibraryHealthCheck({ force: true });
        const afterSummary = healthSummarySnapshot(refreshed?.summary || currentHealthSummary);
        updateHealthRepairCenter(afterSummary, 'Repair Complete', 'AXIOM refreshed Health after the Serato repair. The receipt shows what visibly dropped.');
        setHealthProgressState(
          100,
          'Health numbers updated after Serato repair.',
          `${seratoSyncSummaryLine(applied, true)}. The cards above now reflect the latest AXIOM cache.`,
          'DONE'
        );
        showHealthRepairReceipt(beforeSummary, afterSummary, { all: applied }, 'Serato Library Repair');
      } catch (err) {
        stopProgressTicker?.();
        stopProgressTicker = null;
        updateHealthRepairCenter(currentHealthSummary, 'Serato Repair Paused', 'Serato repair did not finish. Nothing was changed unless AXIOM already showed a completed receipt.');
        setHealthProgressState(
          100,
          err.message || 'Serato folder sync paused.',
          'Nothing was changed unless AXIOM already showed a completed repair summary.',
          'CHECK'
        );
        showToast(err.message || 'Serato folder sync paused. Nothing was changed.', true);
      } finally {
        stopProgressTicker?.();
        seratoLibrarySyncInFlight = false;
        if (seratoBtn) {
          seratoBtn.disabled = false;
          seratoBtn.style.opacity = '1';
          seratoBtn.innerHTML = originalSeratoBtnHtml;
        }
      }
    }

    async function handleSeratoFolderUpload(event) {
      const files = Array.from(event.target.files || []);
      try {
        await runSeratoLibrarySync(files);
      } finally {
        event.target.value = '';
      }
    }

    // Explicit Serato/djay transfer workflows and local review fixtures.
    window.syncSeratoLibraryToAxiom = syncSeratoLibraryToAxiom;
    window.syncSeratoLibraryFolderToAxiom = syncSeratoLibraryFolderToAxiom;
    window.handleSeratoFolderUpload = handleSeratoFolderUpload;
    window.showSeratoLibrarySyncReview = showSeratoLibrarySyncReview;

    async function handleSeratoMetadataCSVUpload(event) {
      const file = event.target.files[0];
      if (!file) return;
      const kind = pendingSeratoMetadataKind || 'bpm';
      const label = kind === 'all' ? 'Library Metadata' : kind === 'key' ? 'Keys' : kind === 'year' ? 'Years' : 'BPMs';
      const applyLabel = kind === 'all' ? 'SYNC LIBRARY' : `APPLY ${label.toUpperCase()}`;
      const progContainer = document.getElementById('health-progress-container');
      const progBar = document.getElementById('health-progress-bar');
      const progPercent = document.getElementById('health-progress-percent');
      const progLabel = document.getElementById('health-progress-label');
      progContainer?.classList.remove('hidden');
      hideHealthRepairReview();
      if (progBar) progBar.style.width = '35%';
      if (progPercent) progPercent.innerText = '35%';
      if (progLabel) progLabel.innerText = `Reading Serato CSV ${label}...`;
      try {
        const preview = await uploadSeratoMetadataCSV(file, kind, false);
        showSeratoMetadataReview(kind, preview, false);
        const ready = kind === 'all'
          ? Number(preview.summary?.metadata_updates_ready || 0)
          : Number(preview.summary?.ready_to_update || 0);
        if (preview.warning) showToast(preview.warning, true);
        if (ready <= 0) {
          showToast(`Serato CSV checked. No ${label} ready to update.`, true);
          return;
        }
        const confirmed = await showAxiomConfirm(
          `Import Serato ${label}`,
          `AXIOM found ${ready.toLocaleString()} ${label} value${ready === 1 ? '' : 's'} from this Serato CSV that can improve AXIOM. Apply now? Source audio and Serato stay untouched.`,
          applyLabel,
          'primary'
        );
        if (!confirmed) return;
        if (progBar) progBar.style.width = '74%';
        if (progPercent) progPercent.innerText = '74%';
        if (progLabel) progLabel.innerText = `Applying Serato CSV ${label} to AXIOM cache...`;
        const applied = await uploadSeratoMetadataCSV(file, kind, true);
        showSeratoMetadataReview(kind, applied, true);
        showToast(applied.message || `Serato CSV ${label} imported into AXIOM.`);
        loadLibraryStats();
        if (!document.getElementById('tab-content-library')?.classList.contains('hidden')) runSearch();
        setTimeout(runLibraryHealthCheck, 600);
      } catch (err) {
        if (progBar) progBar.style.width = '100%';
        if (progPercent) progPercent.innerText = '100%';
        if (progLabel) progLabel.innerText = err.message || 'Serato CSV import paused.';
        showToast(err.message || 'Serato CSV import paused. Nothing was changed.', true);
      } finally {
        event.target.value = '';
      }
    }
