    // Studio ordering, CSV intake, Set Brief, and Library brief scoring.
    async function optimizePlaylistOrder() {
        if (optimizePlaylistOrder.busy) return;
        if (currentPlaylist.length < STUDIO_MANUAL_BUILD_MIN_TRACKS) {
            showToast(`Add at least ${STUDIO_MANUAL_BUILD_MIN_TRACKS} songs before using Suggest Order.`, true);
            return;
        }
        const btn = document.getElementById('btn-optimize');
        const workingSet = currentPlaylist;
        const routeSet = currentRoutePlaylist;
        const editingId = editingPlaylistId;
        const requestedSet = JSON.stringify({ playlist: workingSet, route: routeSet });
        optimizePlaylistOrder.busy = true;
        const originalText = btn.innerHTML;
        btn.classList.add('is-selected', 'is-calculating');
        btn.setAttribute('aria-busy', 'true');
        btn.innerHTML = '<span>Optimizing...</span>';
        try {
            const resp = await fetch('/api/studio/optimize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playlist: workingSet })
            });
            const data = await resp.json();
            if (!resp.ok || !Array.isArray(data.optimized)) throw new Error(data.error || 'Optimization failed');
            if (currentPlaylist !== workingSet || currentRoutePlaylist !== routeSet
                || editingPlaylistId !== editingId
                || requestedSet !== JSON.stringify({ playlist: currentPlaylist, route: currentRoutePlaylist })) {
                showToast('Your Working Set changed while Suggest Order was running. Your edits were kept; suggest again to use them.');
                return;
            }
            if (data.optimized) {
                currentRoutePlaylist = dedupePlaylistTracks(data.optimized);
                setStudioView('route');
                const removed = data.removed_duplicates || (data.optimized.length - currentRoutePlaylist.length);
                showToast(removed > 0 ? `Harmonic Flow Optimized — removed ${removed} duplicate${removed === 1 ? '' : 's'}` : "Harmonic Flow Optimized");
            }
        } catch (e) {
            showToast("Optimization failed", true);
        } finally {
            optimizePlaylistOrder.busy = false;
            btn.innerHTML = originalText;
            btn.classList.remove('is-selected', 'is-calculating');
            btn.removeAttribute('aria-busy');
        }
    }

    function isHarmonicMatch(t1, t2) {
        if (!t1 || !t2) return false;
        const c1 = t1.camelot;
        const c2 = t2.camelot;
        if (!c1 || !c2) return false;
        if (c1 === c2) return true;
        try {
            const n1 = parseInt(c1.slice(0, -1)); const l1 = c1.slice(-1);
            const n2 = parseInt(c2.slice(0, -1)); const l2 = c2.slice(-1);
            if (isNaN(n1) || isNaN(n2)) return false;
            const diff = Math.abs(n1 - n2);
            if (l1 === l2 && (diff === 1 || diff === 11)) return true;
            if (n1 === n2 && l1 !== l2) return true;
        } catch(e) {}
        return false;
    }

    function loadSetFromLocal() {
      if (!requirePaidStudioFeature('Load Set')) return;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = event => {
          try {
            const loadedData = JSON.parse(event.target.result);
            if (Array.isArray(loadedData) && loadedData.length
                && loadedData.every(track => track && typeof track === 'object' && !Array.isArray(track))) {
              if (window.AxiomStudioAutosave?.archiveCurrent() === false) return;
              const record = upsertSavedPlaylist(file.name.replace(/\.json$/i, ''), loadedData, {
                forceNew: true, setBrief: { ...DEFAULT_SET_BRIEF }
              });
              if (!record) throw new Error('No usable tracks were found in this backup.');
              currentPlaylist = JSON.parse(JSON.stringify(record.tracks));
              currentRoutePlaylist = [];
              editingPlaylistId = record.id;
              currentSetBrief = normalizeSetBrief(record.setBrief);
              activeStudioView = 'manual';
              resetModalSuggestionDecisions();
              magicSetStudioCtaReady = false;
              setGraphMode(false);
              setStudioView('manual');
              applySetBriefToStudioControls();
              document.getElementById('studio-start-view').classList.add('hidden');
              document.getElementById('studio-active-view').classList.remove('hidden');
              if (typeof initSortable === "function") initSortable();
              updateStudioToolsAvailability();
              if (typeof recalculateAudit === "function") recalculateAudit();
              showToast(`Loaded: ${file.name}`);
            } else {
              showToast('Choose a nonempty AXIOM set backup.', true);
            }
          } catch (err) {
            showToast(err.message || 'Error reading file', true);
          }
        };
        reader.onerror = () => showToast('The set backup could not be read.', true);
        reader.readAsText(file);
      };
      input.click();
    }

    function clearSet() {
      showClearSetConfirm(() => {
        if (window.AxiomStudioAutosave?.archiveCurrent() === false) {
          showToast('Set was not cleared because its recovery copy could not be saved. Use Save Set or Backup Set before trying again.', true);
          return;
        }
        editingPlaylistId = null;
        currentPlaylist = [];
        currentRoutePlaylist = [];
        currentAnchorTrack = null;
        selectedSuggestionData = null;
        activeStudioView = 'manual';
        currentSetBrief = { ...DEFAULT_SET_BRIEF };
        resetModalSuggestionDecisions();
        magicSetStudioCtaReady = false;
        setGraphMode(false);

        if (typeof graphDots !== 'undefined') graphDots = [];
        anchorTargetDot = null;
        graphAnchorIndex = -1;
        window.AxiomStudioAutosave?.checkpoint();
        const _genBtn = document.getElementById('btn-generate-from-anchor');
        if (_genBtn) _genBtn.classList.add('hidden');
        showAxiomStart({ allowReviewNavigation: true });
        showToast('Set cleared');
      });
    }

    let studioCsvRequestId = 0;
    let studioCsvImportData = null;
    let studioCsvPreviousFocus = null;

    function setCSVImportLoading(isLoading) {
      const spinner = document.getElementById('upload-spinner');
      const uploadText = document.getElementById('upload-text');
      if (spinner) spinner.classList.toggle('hidden', !isLoading);
      if (uploadText) uploadText.textContent = isLoading ? 'Importing...' : 'Upload CSV';
      const modal = document.getElementById('csv-path-modal');
      if (!modal) return;
      modal.setAttribute('aria-busy', isLoading ? 'true' : 'false');
      modal.querySelectorAll('[data-csv-import-control]').forEach(button => { button.disabled = isLoading; });
      const status = modal.querySelector('#csv-import-status');
      if (isLoading && status) {
        status.textContent = 'Matching your performance against your AXIOM library…';
        status.dataset.state = 'working';
      }
    }

    function csvNeedsLibraryMessage() {
      return 'Add a music folder first. CSV import matches your CSV against songs in your AXIOM library.';
    }

    function updateCsvBuildAvailability() {
      const enabled = libraryHasTracks === true;
      document.querySelectorAll('.requires-library').forEach((element) => {
        element.classList.toggle('hidden', !enabled);
        element.setAttribute('aria-hidden', enabled ? 'false' : 'true');
        if ('disabled' in element) element.disabled = !enabled;
      });
      if (!enabled && studioStartPathSelection === 'room') {
        selectStudioStartPath('fresh');
      }
      document.body.classList.toggle('csv-tools-locked', !enabled);
    }

    function ensureLibraryBeforeCsv() {
      if (libraryHasTracks === true) return true;
      showTab('library');
      renderLibraryConnectionPrompt();
      showToast(csvNeedsLibraryMessage(), true);
      return false;
    }

    function applyImportedCSVData(data) {
      currentPlaylist = Array.isArray(data.playlist) ? data.playlist : [];
      currentSetBrief = { ...DEFAULT_SET_BRIEF };
      resetModalSuggestionDecisions();
      magicSetStudioCtaReady = false;
      document.getElementById('studio-start-view').classList.add('hidden');
      document.getElementById('studio-active-view').classList.remove('hidden');
      initSortable();
      updateStudioToolsAvailability();
      renderPlaylist(data.audit?.transitions || []);
      renderMetrics(data.audit || { metrics: { set_score: 0, bpm_flow: [], energy_curve: [] } });
      if (data.stats) {
        const sourceLabel = data.stats.source_type === 'serato_history' ? 'Serato history' : 'CSV';
        const missing = Number(data.stats.unlinked_tracks || 0);
        showToast(`${sourceLabel} loaded: ${data.stats.linked_tracks}/${data.stats.parsed_tracks} tracks linked${missing ? ` · ${missing} need review` : ''}`);
      } else {
        showToast(`Imported ${currentPlaylist.length} tracks successfully`);
      }
    }

    async function triggerCSVUpload() {
      if (!ensureLibraryBeforeCsv()) return;
      openCSVImportDialog();
    }

    async function chooseStudioCsvFile() {
      if (!ensureLibraryBeforeCsv()) return;
      const pickerRequestId = studioCsvRequestId;
      if (typeof hasAxiomNativePicker === 'function' && hasAxiomNativePicker()) {
        clearTimeout(window.__axiomCsvPreviewFallbackTimer);
        try {
          const picked = await axiomNativePick('chooseStudioCsv', 300000);
          if (pickerRequestId !== studioCsvRequestId) return;
          setCSVImportFile(picked.name);
          const formData = new FormData();
          formData.append('file', new Blob([picked.csv_text], { type: 'text/csv' }), picked.name);
          await importCSVFormData(formData);
        } catch (error) {
          if (!error.cancelled && pickerRequestId === studioCsvRequestId) showCSVImportError(error);
        }
        return;
      }
      const input = document.getElementById('csv-upload');
      if (!input) {
        showToast('CSV import is not ready yet.', true);
        return;
      }
      input.value = '';
      input.click();
      clearTimeout(window.__axiomCsvPreviewFallbackTimer);
    }

    function closeCSVPathModal() {
      const modal = document.getElementById('csv-path-modal');
      if (modal) modal.remove();
      studioCsvRequestId += 1;
      studioCsvImportData = null;
      setCSVImportLoading(false);
      document.removeEventListener('keydown', handleCSVPathModalKeydown);
      if (studioCsvPreviousFocus?.isConnected) studioCsvPreviousFocus.focus();
    }

    function handleCSVPathModalKeydown(event) {
      if (event.key === 'Escape') closeCSVPathModal();
      if (event.key === 'Enter' && event.target?.id === 'csv-path-input') {
        event.preventDefault();
        submitCSVPathModal();
      }
      if (event.key === 'Tab') {
        const controls = Array.from(document.querySelectorAll('#csv-path-modal button:not(:disabled), #csv-path-modal input, #csv-path-modal summary')).filter(control => control.getClientRects().length);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); }
      }
    }

    function submitCSVPathModal() {
      if (!ensureLibraryBeforeCsv()) {
        closeCSVPathModal();
        return;
      }
      if (window.AXIOM_WEB_PREVIEW) {
        closeCSVPathModal();
        showToast('Browser mode needs you to choose the CSV file directly.', true);
        triggerCSVUpload();
        return;
      }
      const input = document.getElementById('csv-path-input');
      const csvPath = input?.value?.trim();
      if (!csvPath) {
        showToast('Paste the full CSV path to import this performance.', true);
        input?.focus();
        return;
      }
      importCSVFromPath(csvPath);
    }

    function openCSVPathImport() {
      openCSVImportDialog(true);
    }

    function openCSVImportDialog(showPath = false) {
      if (!ensureLibraryBeforeCsv()) return;
      closeCSVPathModal();
      studioCsvPreviousFocus = document.activeElement;
      ensureAxiomRecordVaultStyles();
      if (!document.querySelector('link[data-studio-csv-style]')) {
        const style = document.createElement('link');
        style.rel = 'stylesheet'; style.dataset.studioCsvStyle = '1';
        style.href = axiomRecordVaultStaticUrl('css/surfaces/studio-csv-import.css');
        document.head.appendChild(style);
      }
      const modal = document.createElement('div');
      modal.id = 'csv-path-modal';
      modal.className = 'axiom-dialog-overlay record-vault-export vault-csv';
      modal.innerHTML = `
        <div class="axiom-dialog-card vault-export-card" role="dialog" aria-modal="true" aria-labelledby="csv-import-title">
          <div class="vault-brand"><b>AXIOM<small>PRO</small></b><span>PERFORMANCE / CSV IMPORT</span></div>
          <button class="axiom-dialog-close" type="button" aria-label="Close CSV import" onclick="closeCSVPathModal()">×</button>
          <div class="vault-export-layout"><div class="vault-export-copy">
            <p class="vault-export-kicker">YOUR SET. BACK IN THE STUDIO.</p>
            <h2 id="csv-import-title">IMPORT YOUR<br /><em>PERFORMANCE</em></h2>
            <p class="vault-export-description">Bring in a CSV from your DJ software. AXIOM links the songs to your library so you can refine the set.</p>
            <div class="csv-import-file"><img src="${axiomRecordVaultStaticUrl('icons/folder-open.svg')}" alt="" /><div><span>PERFORMANCE FILE</span><strong id="csv-import-filename">Choose your CSV export</strong><small>Serato History and DJ playlist CSVs</small></div></div>
            <p id="csv-import-status" class="csv-import-status" role="status" aria-live="polite">Your original music stays untouched.</p>
            <div id="csv-import-summary" class="vault-export-summary" hidden></div>
            <div class="axiom-dialog-actions"><button class="axiom-dialog-btn" type="button" onclick="closeCSVPathModal()">Cancel</button><button id="csv-import-choose" class="axiom-dialog-btn primary" data-csv-import-control type="button" onclick="chooseStudioCsvFile()">Choose CSV</button><button id="csv-import-open" class="axiom-dialog-btn primary" type="button" onclick="finishCSVImport()" hidden>Open in Studio</button></div>
            <details class="csv-import-path" ${showPath ? 'open' : ''}><summary>Have the file path instead?</summary><label class="vault-name-field" for="csv-path-input">CSV file path</label><input id="csv-path-input" type="text" class="axiom-dialog-input" placeholder="/Users/you/Desktop/your-set.csv" autocomplete="off" /><button class="axiom-dialog-btn" data-csv-import-control type="button" onclick="submitCSVPathModal()">Load this path</button></details>
          </div><div class="vault-export-art csv-import-art" aria-hidden="true"><img src="${axiomRecordVaultStaticUrl('assets/record-vault/crate.png')}" alt="" /><span>COLLECT. PREPARE. PLAY.</span></div></div>
        </div>
      `;
      document.body.appendChild(modal);
      document.addEventListener('keydown', handleCSVPathModalKeydown);
      setTimeout(() => {
        document.getElementById(showPath ? 'csv-path-input' : 'csv-import-choose')?.focus();
      }, 50);
    }

    function setCSVImportFile(name) {
      studioCsvImportData = null;
      const label = document.getElementById('csv-import-filename');
      if (label) label.textContent = name || 'Choose your CSV export';
      const summary = document.getElementById('csv-import-summary');
      if (summary) summary.hidden = true;
      const open = document.getElementById('csv-import-open');
      if (open) open.hidden = true;
      const choose = document.getElementById('csv-import-choose');
      if (choose) { choose.textContent = 'Choose CSV'; choose.classList.add('primary'); }
    }

    function showCSVImportResult(data) {
      if (!document.getElementById('csv-path-modal')) { applyImportedCSVData(data); return; }
      studioCsvImportData = data;
      const stats = data.stats || {};
      const parsed = Number(stats.parsed_tracks || data.playlist?.length || 0);
      const linked = Number(stats.linked_tracks || 0);
      const missing = Number(stats.unlinked_tracks || 0);
      const summary = document.getElementById('csv-import-summary');
      summary.hidden = false;
      summary.innerHTML = `<div><strong>${parsed.toLocaleString()}</strong><span>TRACKS FOUND</span></div><div><strong>${linked.toLocaleString()}</strong><span>LINKED TO LIBRARY</span></div><div><strong>${missing.toLocaleString()}</strong><span>NEED REVIEW</span></div>`;
      const status = document.getElementById('csv-import-status');
      status.textContent = missing ? `${missing} track${missing === 1 ? '' : 's'} could not be linked. You can review them in Studio.` : 'Your performance is ready to open in Studio.';
      status.dataset.state = 'complete';
      document.getElementById('csv-import-choose').textContent = 'Change CSV';
      document.getElementById('csv-import-choose').classList.remove('primary');
      document.getElementById('csv-import-open').hidden = false;
    }

    function finishCSVImport() {
      if (!studioCsvImportData) return;
      const data = studioCsvImportData;
      closeCSVPathModal();
      applyImportedCSVData(data);
    }

    // Source-only desktop design fixture. The installed app never enters it.
    window.addEventListener('load', () => {
      const mode = axiomUiPreviewMode();
      if (!['csv-import', 'csv-import-complete'].includes(mode)) return;
      window.setTimeout(() => {
        document.getElementById('music-intake-overlay')?.remove();
        document.getElementById('axiom-arrival-overlay')?.remove();
        document.getElementById('master-hud')?.classList.remove('active');
        closeAxiomReleaseSplash('later');
        libraryHasTracks = true;
        openCSVImportDialog();
        if (mode === 'csv-import-complete') {
          setCSVImportFile('Friday Night — Performance.csv');
          const playlist = Array.from({length:24}, (_, index) => ({title:`Performance Track ${index + 1}`, artist:'Review Artist', path:`preview://csv-review-${index}`, bpm:100 + index, camelot:'8A'}));
          showCSVImportResult({playlist, stats:{parsed_tracks:24, linked_tracks:22, unlinked_tracks:2, source_type:'serato_history'}});
        }
      }, 1000);
    });

    function showCSVImportError(error) {
      const status = document.getElementById('csv-import-status');
      if (status) { status.textContent = error.message || 'CSV import could not complete.'; status.dataset.state = 'error'; }
      else showToast(error.message || 'CSV import could not complete.', true);
    }

    async function importCSVFromPath(csvPath) {
      if (!ensureLibraryBeforeCsv()) return;
      const requestId = ++studioCsvRequestId;
      setCSVImportFile(csvPath.split(/[\\/]/).pop());
      setCSVImportLoading(true);
      try {
        const resp = await fetch('/api/studio/upload_csv_path', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: csvPath })
        });
        const data = await resp.json();
        if (requestId !== studioCsvRequestId) return;
        if (data.error) throw new Error(data.error);
        showCSVImportResult(data);
      } catch (err) {
        if (requestId === studioCsvRequestId) showCSVImportError(err);
      } finally {
        if (requestId === studioCsvRequestId) setCSVImportLoading(false);
      }
    }

    async function handleCSVUpload(event) {
      if (!ensureLibraryBeforeCsv()) {
        event.target.value = '';
        return;
      }
      const file = event.target.files[0];
      if (!file) return;
      clearTimeout(window.__axiomCsvPreviewFallbackTimer);
      setCSVImportFile(file.name);
      const formData = new FormData();
      formData.append("file", file);
      try {
        await importCSVFormData(formData);
      } finally {
        event.target.value = '';
      }
    }

    async function importCSVFormData(formData) {
      const requestId = ++studioCsvRequestId;
      setCSVImportLoading(true);
      try {
        const resp = await fetch('/api/studio/upload_csv', { method: 'POST', body: formData });
        const data = await resp.json();
        if (requestId !== studioCsvRequestId) return;
        if (data.error) throw new Error(data.error);
        showCSVImportResult(data);
      } catch (err) {
        if (requestId === studioCsvRequestId) showCSVImportError(err);
      } finally {
        if (requestId === studioCsvRequestId) setCSVImportLoading(false);
      }
    }

    function normalizeSetBrief(value = {}) {
      const intentions = new Set(['opener', 'warmup', 'party', 'club_peak', 'wedding', 'closing', 'open_format', 'youtube', 'family_friendly', 'global']);
      const purposes = new Set(['live_set', 'content_mix']);
      const journeys = new Set(['build', 'stay_up', 'waves', 'finish_strong']);
      const planningStyles = new Set(['loose', 'guided', 'fixed']);
      const eras = new Set(['All', 'Recent', '2k Era', '2010s', 'The 90s', 'Retro 2']);
      const audiences = new Set(['all_ages', 'adult_18', 'under_40', 'mixed_adult']);
      const settings = new Set(['club', 'bar', 'private_party', 'youtube', 'wedding', 'corporate']);
      const lyricsModes = new Set(['clean_only', 'clean_preferred', 'explicit_allowed', 'after_dark']);
	      const soundFocuses = new Set(['open_format', 'urban_electronic_top40', 'urban', 'electronic_top40', 'youtube_series', 'classic_wedding', 'global_wedding', 'global']);
      const duration = [30, 60, 90, 120].includes(Number(value.duration)) ? Number(value.duration) : 60;
      const intention = intentions.has(value.intention) ? value.intention : 'party';
      const defaultSetting = intention === 'youtube' ? 'youtube' : (intention === 'wedding' ? 'wedding' : (intention === 'family_friendly' ? 'corporate' : (intention === 'global' ? 'private_party' : 'club')));
      const defaultLyrics = intention === 'family_friendly' ? 'clean_only' : (intention === 'wedding' ? 'clean_preferred' : (intention === 'open_format' ? 'explicit_allowed' : 'clean_preferred'));
	      const defaultSound = intention === 'youtube' ? 'youtube_series' : (intention === 'wedding' ? 'classic_wedding' : (intention === 'open_format' ? 'urban_electronic_top40' : (intention === 'global' ? 'global' : 'open_format')));
      return {
        enabled: Boolean(value.enabled),
        intention,
        purpose: purposes.has(value.purpose) ? value.purpose : 'live_set',
        duration,
        energyJourney: journeys.has(value.energyJourney) ? value.energyJourney : 'build',
        era: eras.has(value.era) ? value.era : 'All',
        planningStyle: planningStyles.has(value.planningStyle) ? value.planningStyle : 'guided',
        audience: audiences.has(value.audience) ? value.audience : (intention === 'open_format' ? 'under_40' : 'mixed_adult'),
        setting: settings.has(value.setting) ? value.setting : defaultSetting,
        lyrics: lyricsModes.has(value.lyrics) ? value.lyrics : defaultLyrics,
        soundFocus: soundFocuses.has(value.soundFocus) ? value.soundFocus : defaultSound
      };
    }

    function setBriefPayload() {
      return normalizeSetBrief(currentSetBrief);
    }

    function setBriefRuntimePayload() {
      const brief = setBriefPayload();
      const estimatedTracks = Math.max(1, Math.round(Number(brief.duration || 60) / 2.5));
      const builtTracks = Math.max(currentPlaylist.length, currentRoutePlaylist.length);
      return { ...brief, progress: Math.max(0, Math.min(1, builtTracks / estimatedTracks)) };
    }

    function renderTrackRoleEvidence(track = {}) {
      const label = String(track.axiom_role || '').trim();
      const confidence = String(track.role_confidence || '').trim();
      const score = Number(track.role_score || 0);
      if (!label || !confidence || !score) return '';
      const reasons = Array.isArray(track.role_reasons) ? track.role_reasons.filter(Boolean) : [];
      const tone = confidence === 'Possible fit' ? 'is-possible' : (confidence === 'Explore' ? 'is-explore' : '');
      const title = reasons.length ? reasons.join(' | ') : `${label} fit based on available library evidence`;
      return `<span class="axiom-role-fit ${tone}" title="${escapeHtml(title)}">${escapeHtml(label)} · ${escapeHtml(confidence)} ${score}</span>`;
    }

    function setBriefLabel(group, value) {
      const labels = {
	        intention: {
	          opener: 'Opener',
	          warmup: 'Warm-Up',
	          party: 'Party',
	          club_peak: 'Club Peak',
	          wedding: 'Wedding',
	          closing: 'Closing Run',
	          open_format: 'Open Format',
	          youtube: 'Content Mix',
	          family_friendly: 'Family-Friendly',
	          global: 'Global'
	        },
	        purpose: {
	          live_set: 'Live Set',
	          content_mix: 'Content Mix'
	        },
        energyJourney: {
          build: 'Build Gradually',
          stay_up: 'Stay Up',
          waves: 'Peaks + Breathers',
          finish_strong: 'Finish Strong'
        },
        planningStyle: {
          loose: 'Loose Ideas',
          guided: 'Guided Route',
          fixed: 'Detailed Plan'
        },
	        era: {
	          All: 'Mixed Eras',
	          Recent: 'Mostly Current',
	          '2k Era': '2K Era',
	          '2010s': '2010-2016 Era',
	          'The 90s': 'The 90s',
	          'Retro 2': 'Classic Throwbacks'
	        },
	        audience: {
	          all_ages: 'All Ages',
	          adult_18: '18+',
	          under_40: '18+ Under 40',
	          mixed_adult: 'Mixed Adult'
	        },
	        setting: {
	          club: 'Club',
	          bar: 'Bar',
	          private_party: 'Private Party',
	          youtube: 'YouTube',
	          wedding: 'Wedding',
	          corporate: 'Corporate'
	        },
	        lyrics: {
	          clean_only: 'Clean Only',
	          clean_preferred: 'Clean Preferred',
	          explicit_allowed: 'Explicit Allowed',
	          after_dark: 'After Dark'
	        },
		        soundFocus: {
		          open_format: 'Open Format',
		          urban_electronic_top40: 'Urban + Electronic + Top 40',
	          urban: 'R&B / Urban',
		          electronic_top40: 'Electronic + Top 40',
		          youtube_series: 'Series Identity',
		          classic_wedding: 'Classic Reception',
	          global_wedding: 'Global / Afro / Latin',
	          global: 'Global Journey'
	        }
		      };
	      return labels[group]?.[value] || String(value || '');
	    }

	    function setBriefWithIntentionDefaults(base = currentSetBrief, intention = 'party') {
	      const next = { ...base, enabled: true, intention };
	      if (intention === 'open_format') {
	        next.audience = 'under_40';
	        next.setting = 'club';
	        next.lyrics = 'explicit_allowed';
	        next.soundFocus = 'urban_electronic_top40';
	      } else if (intention === 'family_friendly') {
	        next.audience = 'all_ages';
	        next.setting = 'corporate';
	        next.lyrics = 'clean_only';
	        next.soundFocus = 'open_format';
	      } else if (intention === 'global') {
	        next.audience = 'mixed_adult';
	        next.setting = 'private_party';
	        next.lyrics = next.lyrics === 'after_dark' ? 'clean_preferred' : next.lyrics;
	        next.soundFocus = 'global';
	      } else if (intention === 'club_peak') {
	        next.audience = 'adult_18';
	        next.setting = 'club';
	        next.lyrics = 'after_dark';
	        next.soundFocus = 'electronic_top40';
	      } else if (intention === 'youtube') {
	        next.audience = 'mixed_adult';
	        next.setting = 'youtube';
	        next.soundFocus = 'youtube_series';
	        next.lyrics = next.lyrics === 'after_dark' ? 'explicit_allowed' : next.lyrics;
	      } else if (intention === 'wedding') {
	        next.audience = 'all_ages';
	        next.setting = 'wedding';
	        next.lyrics = ['explicit_allowed', 'after_dark'].includes(next.lyrics) ? 'clean_preferred' : next.lyrics;
	        next.soundFocus = next.soundFocus === 'global_wedding' ? 'global_wedding' : 'classic_wedding';
	      } else {
	        if (next.setting === 'wedding' || next.setting === 'youtube') next.setting = intention === 'party' ? 'private_party' : 'club';
	        if (next.audience === 'all_ages' && ['party', 'closing'].includes(intention)) next.audience = 'mixed_adult';
	        if (next.lyrics === 'after_dark' && !['club_peak', 'open_format'].includes(intention)) next.lyrics = 'clean_preferred';
	        if (['classic_wedding', 'global_wedding', 'youtube_series', 'global'].includes(next.soundFocus)) next.soundFocus = 'open_format';
	      }
	      return normalizeSetBrief(next);
	    }

    function libraryBriefConfig(brief = setBriefPayload()) {
      const intention = brief.intention || 'party';
      const base = {
        opener: {
          title: 'Opener Mode',
          copy: 'Find clean first-impression songs. Set the room without spending your biggest records.',
          lanes: [['best', 'Best Fits'], ['warm', 'Set The Tone'], ['singalong', 'Familiar'], ['dancefloor', 'Lift Later'], ['risks', 'Too Much Early']]
        },
        warmup: {
          title: 'Warm-Up Mode',
          copy: 'Find groove, familiarity, and restraint. Build trust before pressure.',
          lanes: [['best', 'Best Fits'], ['warm', 'Warm Groove'], ['singalong', 'Familiar'], ['dancefloor', 'Lift Later'], ['risks', 'Too Hot Early']]
        },
	        party: {
	          title: 'Party Mode',
	          copy: 'Familiar records with easy energy that can move into a proper dancefloor.',
	          lanes: [['best', 'Best Fits'], ['singalong', 'Singalong'], ['dancefloor', 'Dancefloor Ready'], ['peak', 'Peak Party'], ['closing', 'Final Run']]
	        },
	        open_format: {
	          title: 'Open Format Mode',
	          copy: 'Find urban, electronic, Top 40, and throwback records that can cross genres without losing the room.',
	          lanes: [['best', 'Best Fits'], ['start', 'Start Room'], ['urban', 'Urban Weapons'], ['electronic', 'House Lift'], ['top40', 'Top 40 Anchors'], ['bridge', 'Switch-Up Bridges'], ['peak', 'Peak Open Format'], ['risks', 'Wrong Room']]
	        },
	        family_friendly: {
	          title: 'Family-Friendly Mode',
	          copy: 'Find meaning-safe records for family rooms, schools, community events, and daytime sets. A clean edit alone is not treated as proof.',
	          lanes: [['best', 'Best Fits'], ['warm', 'Welcome'], ['singalong', 'Familiar'], ['dancefloor', 'Family Floor'], ['closing', 'Finale'], ['risks', 'Meaning Risk']]
	        },
	        global: {
	          title: 'Global Mode',
	          copy: 'Build a focused international journey through Afrobeats, Amapiano, Dancehall, Soca, Reggaeton, Latin, and crossover sounds.',
	          lanes: [['best', 'Best Fits'], ['global', 'Global Lanes'], ['warm', 'Warm Entry'], ['dancefloor', 'Dancefloor'], ['bridge', 'Crossovers'], ['peak', 'Global Peak'], ['risks', 'Wrong Lane']]
	        },
	        youtube: {
	          title: 'YouTube Mix Series Mode',
	          copy: 'Find tracks that support a repeatable episode identity, skill showcase, controlled switch-ups, and a strong first impression for video viewers.',
	          lanes: [['best', 'Best Fits'], ['series', 'Series Fit'], ['anchor', 'Episode Anchors'], ['skill', 'Skill Showcase'], ['bridge', 'Controlled Switch-Ups'], ['peak', 'Finale'], ['risks', 'Too Random']]
	        },
	        club_peak: {
	          title: 'Club Peak Mode',
	          copy: 'Find high-energy records, strong drops, and tracks that keep the room up.',
	          lanes: [['best', 'Best Fits'], ['dancefloor', 'Drive'], ['peak', 'Peak Weapons'], ['warm', 'Breathers'], ['risks', 'Too Soft']]
	        },
	        wedding: {
	          title: 'Wedding Set Mode',
	          copy: brief.soundFocus === 'global_wedding'
	            ? 'Find clean wedding-safe songs with intentional Afro, Latin, island, and international moments.'
	            : 'Find clean, familiar, mixed-era reception songs first. Global/Latin records need wedding proof unless you choose the global wedding style.',
	          lanes: brief.soundFocus === 'global_wedding'
	            ? [['best', 'Best Fits'], ['global', 'Global Moments'], ['warm', 'Warm Up'], ['singalong', 'Singalong'], ['dancefloor', 'Dancefloor Later'], ['peak', 'Peak Party'], ['closing', 'Closing'], ['risks', 'Risky Early']]
	            : [['best', 'Best Fits'], ['warm', 'Warm Up'], ['singalong', 'Singalong'], ['dancefloor', 'Dancefloor Later'], ['peak', 'Peak Party'], ['closing', 'Closing'], ['risks', 'Risky Early']]
	        },
        closing: {
          title: 'Closing Run Mode',
          copy: 'Find memorable last songs, singalongs, and records that leave the room with a feeling.',
          lanes: [['best', 'Best Fits'], ['singalong', 'Anthems'], ['closing', 'Last Song'], ['warm', 'Come Down'], ['peak', 'Final Lift']]
        }
      };
      const selected = base[intention] || base.party;
      if (brief.purpose !== 'content_mix') return selected;
      return {
        title: `${selected.title} · Content Mix`,
        copy: `${selected.copy} Content mode also prioritizes an immediate hook, repeatable episode identity, controlled switch-ups, and a strong finish.`,
        lanes: [['best', 'Best Fits'], ['series', 'Series Fit'], ['anchor', 'Episode Anchors'], ['skill', 'Skill Showcase'], ['bridge', 'Controlled Switch-Ups'], ['peak', 'Finale'], ['risks', 'Too Random']]
      };
    }

    function syncLibraryPresentationState() {
      const setupOpen = libraryBriefActivePanel === 'setup';
      const matchingOpen = libraryMatchingSongsEnabled();
      const steelMode = setupOpen;
      const library = document.getElementById('tab-content-library');
      document.body.classList.toggle('library-setup-open', setupOpen);
      document.body.classList.toggle('library-steel-mode', steelMode);
      if (library) {
        library.dataset.librarySetup = setupOpen ? 'open' : 'closed';
        library.dataset.libraryMatching = matchingOpen ? 'open' : 'closed';
        library.dataset.librarySteel = steelMode ? 'active' : 'inactive';
      }
    }

    function syncLibraryBriefPanelMotion(drawerOpen = false) {
      const settings = document.getElementById('library-brief-settings');
      if (!settings) return;
      clearTimeout(libraryBriefPanelHideTimer);
      if (drawerOpen) {
        const wasHidden = settings.classList.contains('hidden');
        settings.classList.remove('hidden');
        settings.dataset.libraryPanelMotion = wasHidden ? 'opening' : 'open';
        if (wasHidden) {
          requestAnimationFrame(() => requestAnimationFrame(() => {
            if (libraryBriefActivePanel) settings.dataset.libraryPanelMotion = 'open';
          }));
        }
        return;
      }
      if (settings.classList.contains('hidden')) {
        settings.dataset.libraryPanelMotion = 'closed';
        return;
      }
      settings.dataset.libraryPanelMotion = 'closing';
      libraryBriefPanelHideTimer = setTimeout(() => {
        if (libraryBriefActivePanel) return;
        settings.classList.add('hidden');
        settings.dataset.libraryPanelMotion = 'closed';
      }, 300);
    }

    function librarySetupSelectedLabel(id, fallback = '') {
      const select = document.getElementById(id);
      if (!select) return fallback;
      return select.options?.[select.selectedIndex]?.textContent?.trim() || fallback;
    }

    function ensureLibrarySetupGroups() {
      const grid = document.querySelector('#library-brief-settings .library-brief-control-grid');
      if (!grid || grid.dataset.librarySetupGrouped === 'true') return;
      const fieldById = new Map(
        [...grid.querySelectorAll(':scope > .library-bpm-filter-wrap')]
          .map((field) => [field.querySelector('select')?.id, field])
          .filter(([id]) => Boolean(id))
      );
      const groups = [
        { key: 'vibe', label: 'Vibe', fields: ['library-brief-intention', 'library-brief-lyrics', 'library-brief-sound'] },
        { key: 'room', label: 'Room', fields: ['library-brief-purpose', 'library-brief-audience', 'library-brief-setting'] },
        { key: 'range', label: 'Range', fields: ['library-bpm-filter', 'library-era-filter', 'library-root-filter'] }
      ];
      groups.forEach((group) => {
        const details = document.createElement('details');
        details.className = 'library-setup-control-group';
        details.dataset.librarySetupGroup = group.key;
        const summary = document.createElement('summary');
        summary.innerHTML = `<strong>${group.label}</strong><img src="/static/icons/chevron-down.svg" alt="">`;
        const controls = document.createElement('div');
        controls.className = 'library-setup-control-group-fields';
        group.fields.forEach((id) => {
          const field = fieldById.get(id);
          if (field) controls.appendChild(field);
        });
        details.addEventListener('toggle', () => {
          if (!details.open) return;
          grid.querySelectorAll('.library-setup-control-group[open]').forEach((sibling) => {
            if (sibling !== details) sibling.removeAttribute('open');
          });
        });
        details.append(summary, controls);
        grid.appendChild(details);
      });
      grid.dataset.librarySetupGrouped = 'true';
    }

    function renderLibrarySetupOverview(visibleTracks = null) {
      ensureLibrarySetupGroups();
      const selected = (id, fallback) => librarySetupSelectedLabel(id, fallback);
      const primary = [
        selected('library-brief-intention', 'Party Mode'),
        selected('library-brief-purpose', 'Live Set'),
        selected('library-brief-audience', 'Mixed Adult'),
        selected('library-brief-setting', 'Club')
      ];
      const secondary = [
        selected('library-brief-lyrics', 'Clean Preferred'),
        selected('library-brief-sound', 'Open Format'),
        selected('library-bpm-filter', 'All Speeds'),
        selected('library-era-filter', 'All Eras'),
        selected('library-root-filter', 'All Roots')
      ];
      const primaryNode = document.getElementById('library-setup-summary-primary');
      const secondaryNode = document.getElementById('library-setup-summary-secondary');
      if (primaryNode) primaryNode.textContent = primary.join(' · ');
      if (secondaryNode) secondaryNode.textContent = secondary.join(' · ');
      const count = Array.isArray(visibleTracks)
        ? visibleTracks.length
        : document.querySelectorAll('#search-results > .library-track-card').length;
      const countNode = document.getElementById('library-setup-fit-count');
      const viewButton = document.getElementById('library-setup-view-tracks');
      const countLabel = `${count.toLocaleString()} Track${count === 1 ? '' : 's'}`;
      if (countNode) countNode.textContent = countLabel;
      if (viewButton) viewButton.textContent = `View ${countLabel}`;
      const health = document.getElementById('library-setup-health-value');
      if (health) {
        const issueCount = ['missing_file', 'missing_bpm', 'missing_key', 'missing_year']
          .reduce((total, key) => total + Math.max(0, Number(currentHealthSummary?.[key] || 0)), 0);
        health.textContent = issueCount ? `${issueCount.toLocaleString()} To Review` : 'Clear';
        health.dataset.state = issueCount ? 'review' : 'clear';
      }
    }

    function focusLibrarySetupTracks() {
      const results = document.getElementById('search-results');
      const firstTrack = results?.querySelector('.library-track-card');
      (firstTrack || results)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      firstTrack?.focus?.({ preventScroll: true });
    }

    function renderLibraryBriefLens(visibleTracks = null) {
      const lens = document.getElementById('library-brief-lens');
      if (!lens) return;
      const brief = setBriefPayload();
      const config = libraryBriefConfig(brief);
      const laneKeys = new Set(config.lanes.map(([key]) => key));
      if (!laneKeys.has(activeLibraryBriefLane)) activeLibraryBriefLane = 'best';
      const kicker = document.getElementById('library-brief-kicker');
      const title = document.getElementById('library-brief-title');
      const copy = document.getElementById('library-brief-copy');
      const chips = document.getElementById('library-brief-chips');
      const select = document.getElementById('library-brief-intention');
      const purposeSelect = document.getElementById('library-brief-purpose');
      const audienceSelect = document.getElementById('library-brief-audience');
      const settingSelect = document.getElementById('library-brief-setting');
      const lyricsSelect = document.getElementById('library-brief-lyrics');
      const soundSelect = document.getElementById('library-brief-sound');
      const settings = document.getElementById('library-brief-settings');
      const preparationToolbar = document.getElementById('library-preparation-toolbar');
      const collapse = document.getElementById('library-brief-collapse');
      const preparationToggle = document.getElementById('library-preparation-toggle');
      const freshRotate = document.getElementById('library-fresh-rotate');
      const activeSummary = document.getElementById('library-brief-active-summary');
      const recentlyAdded = libraryRecentlyAddedActive();
      renderLibrarySetupOverview(visibleTracks);
      if (select) {
        const intentionOptions = [
          ['party', 'Party Mode'],
          ['wedding', 'Wedding'],
          ['club_peak', 'Club'],
          ['family_friendly', 'Family-Friendly'],
          ['open_format', 'Open Format'],
          ['global', 'Global']
        ];
        // Room Rescue and saved sets also use opener, warmup, closing and
        // content briefs. Rendering must preserve that normalized intention.
        if (!intentionOptions.some(([value]) => value === brief.intention)) {
          intentionOptions.push([brief.intention, setBriefLabel('intention', brief.intention)]);
        }
        const allowedIntentions = new Set(intentionOptions.map(([value]) => value));
        intentionOptions.forEach(([value, label]) => {
          if (![...select.options].some((option) => option.value === value)) {
            select.add(new Option(label, value));
          }
        });
        [...select.options].forEach((option) => {
          if (option.value && !allowedIntentions.has(option.value)) {
            option.remove();
          }
        });
        if (select.value !== brief.intention) select.value = brief.intention;
        const selectedOption = [...select.options].find((option) => option.value === select.value);
        select.closest('.library-bpm-filter-wrap')?.setAttribute('data-brief-display', selectedOption?.textContent || setBriefLabel('intention', brief.intention) || 'Please Choose One');
      }
      if (purposeSelect && purposeSelect.value !== brief.purpose) purposeSelect.value = brief.purpose;
      if (audienceSelect && audienceSelect.value !== brief.audience) audienceSelect.value = brief.audience;
      if (settingSelect && settingSelect.value !== brief.setting) settingSelect.value = brief.setting;
      if (lyricsSelect && lyricsSelect.value !== brief.lyrics) lyricsSelect.value = brief.lyrics;
      if (soundSelect && soundSelect.value !== brief.soundFocus) soundSelect.value = brief.soundFocus;
      const drawerOpen = libraryBriefActivePanel === 'setup' || libraryBriefActivePanel === 'preparation';
      const preparationOpen = libraryBriefActivePanel === 'preparation';
      if (lens) lens.dataset.libraryBriefPanel = libraryBriefActivePanel || 'closed';
      syncLibraryPreparationLayoutContract();
      syncLibraryBriefPanelMotion(drawerOpen);
      document.querySelector('#library-brief-settings .library-brief-control-grid')?.classList.toggle('hidden', libraryBriefActivePanel !== 'setup');
      if (preparationToolbar) preparationToolbar.classList.toggle('hidden', libraryBriefActivePanel !== 'preparation');
      if (collapse) {
        const setupOpen = libraryBriefActivePanel === 'setup';
        const collapseLabel = collapse.querySelector('[data-library-action-label]');
        if (collapseLabel) collapseLabel.textContent = setupOpen ? 'Hide Setup' : 'Show Setup';
        collapse.setAttribute('aria-expanded', setupOpen ? 'true' : 'false');
      }
      if (preparationToggle) {
        const preparationLabel = preparationToggle.querySelector('[data-library-action-label]');
        if (preparationLabel) preparationLabel.textContent = preparationOpen ? 'Back To Library' : 'Track Prep';
        preparationToggle.setAttribute('aria-label', preparationOpen ? 'Back To Library' : 'Track Preparation');
        preparationToggle.setAttribute('aria-expanded', preparationOpen ? 'true' : 'false');
      }
      if (freshRotate) {
        freshRotate.title = 'Start a fresh result round for this brief without changing the room settings.';
      }
      if (activeSummary) {
        activeSummary.textContent = brief.enabled
          ? [
              setBriefLabel('intention', brief.intention),
	          setBriefLabel('purpose', brief.purpose),
              `${brief.duration} Min`,
              setBriefLabel('energyJourney', brief.energyJourney),
              setBriefLabel('planningStyle', brief.planningStyle),
              setBriefLabel('audience', brief.audience),
              setBriefLabel('setting', brief.setting),
              setBriefLabel('lyrics', brief.lyrics),
              setBriefLabel('soundFocus', brief.soundFocus),
              setBriefLabel('era', brief.era)
            ].join(' / ')
          : 'Choose Best Fits, Singalong, Dancefloor Ready, Peak Party, or Final Run to rank the Library instantly.';
      }
      if (kicker) kicker.textContent = preparationOpen
        ? 'Track Prep'
        : recentlyAdded ? 'Library View'
        : brief.enabled ? `${setBriefLabel('intention', brief.intention)} Set Prep` : 'Set Prep Ready';
      if (title) title.textContent = preparationOpen ? '' : (recentlyAdded ? 'Recently Added' : (brief.enabled ? config.title : 'Choose Your Set'));
      if (libraryBriefActivePanel === 'setup') {
        if (kicker) kicker.textContent = 'Set Prep Ready';
        if (title) title.textContent = 'Your Set';
      }
      if (copy) {
        if (recentlyAdded) {
          copy.textContent = 'Newest tracks AXIOM has indexed are shown first. This is the same Library cache used by Track Prep and Health.';
        } else if (!brief.enabled) {
          copy.textContent = 'Choose a decision above to start instant ranking, or adjust the room settings here first.';
        } else if (Array.isArray(visibleTracks) && visibleTracks.length) {
          const lane = activeLibraryBriefLane || 'best';
          const strong = visibleTracks.filter(track => (libraryBriefScores(track, brief)[lane] || 0) >= 34).length;
          const strictCopy = visibleTracks.length < 8
            ? `Only ${visibleTracks.length.toLocaleString()} track${visibleTracks.length === 1 ? '' : 's'} match every active setting. AXIOM did not widen your brief.`
            : `${strong.toLocaleString()} strong ${setBriefLabel('intention', brief.intention).toLowerCase()} fit${strong === 1 ? '' : 's'} in this view.`;
          copy.textContent = `${config.copy} ${strictCopy} Fresh Picks rotates the view without changing your brief.`;
        } else if (Array.isArray(visibleTracks)) {
          copy.textContent = `No tracks match every active ${setBriefLabel('intention', brief.intention).toLowerCase()} setting. AXIOM kept the brief intact instead of filling Library with unrelated music.`;
        } else {
          copy.textContent = `${config.copy} Fresh Picks rotates recently shown songs when this brief is used again.`;
        }
      }
      if (chips) {
        const laneNotes = {
          best: 'Strongest fit for this set',
          warm: 'Ease into the room',
          start: 'Open with the right tone',
          singalong: 'Familiar records people know',
          dancefloor: 'Ready to move the room',
          drive: 'Keep the room moving',
          peak: 'Highest-energy party records',
          closing: 'Strong finish and last songs',
          global: 'International and crossover fits',
          urban: 'Urban records for this moment',
          electronic: 'Electronic lift and momentum',
          top40: 'Recognisable mainstream anchors',
          bridge: 'Switch genres without losing flow',
          series: 'Fits the identity of this mix',
          anchor: 'Records that define the journey',
          skill: 'Space for performance moments',
          risks: 'Tracks to treat carefully'
        };
        const canClearLane = document.querySelector('meta[name="axiom-edition"]')?.content === 'pro';
        const allMusicActive = !brief.enabled && activeEra === 'All' && activeLibraryBpmFilter === 'all' && !activeLibraryRootFilter;
        const allMusicOption = canClearLane ? `
          <button type="button" role="menuitemradio" aria-checked="${allMusicActive ? 'true' : 'false'}" class="library-brief-chip button--small ${allMusicActive ? 'active' : ''}" onclick="setLibraryBriefLane('all')">
            <span class="library-brief-chip-index">ALL</span>
            <span class="library-brief-chip-copy"><strong>All Music</strong><small>No Set Prep filters; keep your search</small></span>
            <span class="library-brief-chip-state">${allMusicActive ? 'Active' : ''}</span>
          </button>` : '';
        chips.innerHTML = allMusicOption + config.lanes.map(([key, label], index) => {
          const active = brief.enabled && activeLibraryBriefLane === key;
          const note = active && canClearLane ? 'Click again to turn off' : (laneNotes[key] || 'Rank the Library for this moment');
          return `
          <button type="button" role="menuitemradio" aria-checked="${active ? 'true' : 'false'}" class="library-brief-chip button--small ${active ? 'active' : ''}" onclick="setLibraryBriefLane('${key}')">
            <span class="library-brief-chip-index">${String(index + 1).padStart(2, '0')}</span>
            <span class="library-brief-chip-copy">
              <strong>${escapeHtml(label)}</strong>
              <small>${escapeHtml(note)}</small>
            </span>
            <span class="library-brief-chip-state">${active ? 'Active' : ''}</span>
          </button>`;
        }).join('');
      }
      syncLibraryPreparationMenus();
      if (!preparationOpen) closeLibraryPreparationMenus();
      syncLibraryRecentlyAddedControl();
      syncLibraryPresentationState();
      renderLibrarySetPrepFilterStatus(preparationOpen);
    }

    function librarySetPrepFilterLabels() {
      const labels = [];
      const brief = setBriefPayload();
      if (brief.enabled) labels.push(setBriefLabel('intention', brief.intention) || 'Set Prep');
      if (activeLibraryBpmFilter !== 'all') labels.push(document.getElementById('library-bpm-filter')?.selectedOptions?.[0]?.textContent || activeLibraryBpmFilter);
      if (activeEra !== 'All') labels.push(document.getElementById('library-era-filter')?.selectedOptions?.[0]?.textContent || activeEra);
      if (activeLibraryRootFilter) labels.push(`${activeLibraryRootFilter} Root`);
      return labels.filter(Boolean);
    }

    function renderLibrarySetPrepFilterStatus(preparationOpen = libraryBriefActivePanel === 'preparation') {
      const labels = librarySetPrepFilterLabels();
      const compact = document.getElementById('library-brief-filter-status');
      const inherited = document.getElementById('library-preparation-inherited-filters');
      const markup = labels.length ? `
        <span class="library-filter-status-label"><b>Active:</b> ${labels.map(escapeHtml).join(' / ')}</span>
        <button class="library-filter-status-clear" type="button" onclick="resetLibrarySetPrep(this)">Clear Set Prep</button>
      ` : '';
      if (compact) {
        compact.hidden = preparationOpen || !labels.length;
        compact.innerHTML = markup;
      }
      if (inherited) {
        inherited.hidden = !preparationOpen || !labels.length;
        inherited.innerHTML = labels.length ? `
          <div><b>Track Prep is using your Set Prep filters</b><span>${labels.map(escapeHtml).join(' / ')}</span></div>
          <button type="button" onclick="resetLibrarySetPrep(this)">Clear Set Prep</button>
        ` : '';
      }
    }

    async function resetLibrarySetPrep(button = null) {
      setAxiomButtonBusy(button, true, 'Clearing...');
      currentSetBrief = normalizeSetBrief({ ...DEFAULT_SET_BRIEF });
      activeLibraryBriefLane = 'best';
      activeEra = 'All';
      activeLibraryBpmFilter = 'all';
      activeLibraryRootFilter = '';
      const intention = document.getElementById('library-brief-intention');
      const bpm = document.getElementById('library-bpm-filter');
      const era = document.getElementById('library-era-filter');
      const root = document.getElementById('library-root-filter');
      if (intention) intention.value = currentSetBrief.intention;
      if (bpm) bpm.value = 'all';
      if (era) era.value = 'All';
      if (root) root.value = '';
      resetLibraryResultWindow();
      renderStudioSetBriefBar();
      renderLibraryBriefLens();
      try {
        await runSearch();
        showToast('Set Prep filters cleared.');
      } finally {
        setAxiomButtonBusy(button, false);
      }
    }

    function toggleLibraryBriefActions(forceState = null) {
      const lens = document.getElementById('library-brief-lens');
      const toggle = document.getElementById('library-brief-actions-toggle');
      if (!lens || !toggle) return;
      const expanded = lens.dataset.libraryActionsExpanded !== 'false';
      const nextExpanded = forceState == null ? !expanded : Boolean(forceState);
      lens.dataset.libraryActionsExpanded = nextExpanded ? 'true' : 'false';
      toggle.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
      const icon = toggle.querySelector('img');
      if (icon) icon.src = nextExpanded ? '/static/icons/chevron-up.svg' : '/static/icons/chevron-down.svg';
    }

    function setLibraryBriefLane(lane = 'best') {
      leaveLibraryRecentlyAddedMode();
      document.getElementById('library-brief-lane-dropdown')?.removeAttribute('open');
      const canClearLane = document.querySelector('meta[name="axiom-edition"]')?.content === 'pro';
      if (canClearLane && lane === 'all') return resetLibrarySetPrep();
      if (canClearLane && setBriefPayload().enabled && activeLibraryBriefLane === lane) {
        currentSetBrief = normalizeSetBrief({ ...currentSetBrief, enabled: false });
        resetLibraryResultWindow();
        renderStudioSetBriefBar();
        renderLibraryBriefLens();
        return runSearch();
      }
      if (!setBriefPayload().enabled) {
        currentSetBrief = normalizeSetBrief({ ...currentSetBrief, enabled: true });
        beginLibraryFreshBuild('library-lane');
        renderStudioSetBriefBar();
      }
      activeLibraryBriefLane = lane || 'best';
      resetLibraryResultWindow();
      renderLibraryBriefLens();
      runSearch();
    }

    function toggleLibraryBriefSetup(forceState = null) {
      const setupOpen = libraryBriefActivePanel === 'setup';
      const nextOpen = forceState == null ? !setupOpen : Boolean(forceState);
      const leftRecentlyAdded = nextOpen && leaveLibraryRecentlyAddedMode();
      clearTimeout(libraryBriefSetupCloseTimer);
      document.body.classList.remove('library-setup-closing');

      if (setupOpen && !nextOpen) {
        const settings = document.getElementById('library-brief-settings');
        document.body.classList.add('library-setup-closing');
        if (settings) settings.dataset.libraryPanelMotion = 'closing';
        libraryBriefSetupCloseTimer = setTimeout(() => {
          libraryBriefActivePanel = '';
          libraryBriefSetupExpanded = false;
          localStorage.setItem(LIBRARY_BRIEF_SETUP_KEY, 'false');
          if (settings) {
            settings.classList.add('hidden');
            settings.dataset.libraryPanelMotion = 'closed';
          }
          document.body.classList.remove('library-setup-closing');
          renderLibraryBriefLens();
        }, 280);
        return;
      }

      libraryBriefActivePanel = nextOpen ? 'setup' : '';
      libraryBriefSetupExpanded = nextOpen;
      localStorage.setItem(LIBRARY_BRIEF_SETUP_KEY, libraryBriefSetupExpanded ? 'true' : 'false');
      renderLibraryBriefLens();
      if (leftRecentlyAdded) {
        resetLibraryResultWindow();
        runSearch();
      }
    }

    function toggleLibraryPreparationPanel(forceState = null, button = null) {
      const preparationOpen = libraryBriefActivePanel === 'preparation';
      const nextOpen = forceState == null ? !preparationOpen : Boolean(forceState);

      clearTimeout(libraryPreparationCloseTimer);
      document.body.classList.remove('library-preparation-closing');

      if (preparationOpen && !nextOpen) {
        returnToAllLibraryTracks(button);
        return;
      }

      libraryBriefActivePanel = nextOpen ? 'preparation' : '';
      libraryBriefSetupExpanded = false;
      localStorage.setItem(LIBRARY_BRIEF_SETUP_KEY, 'false');
      document.getElementById('library-brief-lane-dropdown')?.removeAttribute('open');
      renderLibraryBriefLens();
      if (nextOpen && !['missing_metadata', 'missing_file'].includes(activeLibraryPreparationFilter)) {
        activeLibraryPreparationFilter = 'missing_metadata';
        activeLibraryPreparationSort = 'missing_first';
        const preparationSelect = document.getElementById('library-preparation-filter');
        const sortSelect = document.getElementById('library-preparation-sort');
        if (preparationSelect) preparationSelect.value = activeLibraryPreparationFilter;
        if (sortSelect) sortSelect.value = activeLibraryPreparationSort;
        resetLibraryResultWindow();
        runSearch();
      }
      if (nextOpen && typeof restoreLibraryPreparationScanReceipt === 'function') {
        restoreLibraryPreparationScanReceipt();
      }
    }

	    function setLibraryBriefIntention(intention = 'party') {
	      leaveLibraryRecentlyAddedMode();
	      currentSetBrief = setBriefWithIntentionDefaults(currentSetBrief, intention);
	      beginLibraryFreshBuild('library-intention');
	      activeLibraryBriefLane = 'best';
	      renderStudioSetBriefBar();
	      resetLibraryResultWindow();
      renderLibraryBriefLens();
      runSearch();
    }

    function setLibraryBriefField(field, value) {
      leaveLibraryRecentlyAddedMode();
      currentSetBrief = normalizeSetBrief({ ...currentSetBrief, enabled: true, [field]: value });
      beginLibraryFreshBuild('library-field');
      activeLibraryBriefLane = 'best';
      renderStudioSetBriefBar();
      resetLibraryResultWindow();
      renderLibraryBriefLens();
      runSearch();
    }

    function toggleLibraryBriefLens(forceState = null) {
      const nextEnabled = forceState == null ? !setBriefPayload().enabled : Boolean(forceState);
      currentSetBrief = normalizeSetBrief({ ...currentSetBrief, enabled: nextEnabled });
      if (nextEnabled) beginLibraryFreshBuild('library-toggle');
      activeLibraryBriefLane = 'best';
      renderStudioSetBriefBar();
      resetLibraryResultWindow();
      renderLibraryBriefLens();
      runSearch();
    }

    function libraryTrackText(track = {}) {
      return [
        track.title, track.artist, track.genre, track.energy, track.folder, track.comments,
        track.grouping, track.label, track.dna_pillar, track.velocity, track.texture,
        ...(Array.isArray(track.serato_crates) ? track.serato_crates : []),
        ...(Array.isArray(track.crate_names) ? track.crate_names : []),
        ...(Array.isArray(track.playlist_names) ? track.playlist_names : []),
        ...(Array.isArray(track.source_playlists) ? track.source_playlists : [])
      ].filter(Boolean).join(' ').toLowerCase();
    }

    const LIBRARY_ERA_RANGES = [
      [1950, 1975, 'Retro One'],
      [1975, 1990, 'Retro 2'],
      [1990, 2000, 'The 90s'],
      [2000, 2010, '2k Era'],
      [2010, 2017, '2010s'],
      [2017, 2020, 'Pre-Covid'],
      [2020, 2022, 'Post-Covid'],
      [2022, 2024, 'Old'],
      [2024, 2026, 'Recent'],
      [2026, 2100, 'New']
    ];

    function libraryTrackEraValue(track = {}) {
      const rawOverride = String(track.era_override || '').trim().toLowerCase();
      const overrideMatch = LIBRARY_ERA_RANGES.map(([, , era]) => era)
        .find(era => era.toLowerCase() === rawOverride);
      if (overrideMatch) return overrideMatch;
      const rawYear = String(track.year || track.release_year || track.releaseYear || track.date || '');
      const match = rawYear.match(/\b(19|20)\d{2}\b/);
      const year = match ? Number(match[0]) : 0;
      if (year) {
        const range = LIBRARY_ERA_RANGES.find(([start, end]) => year >= start && year < end);
        return range ? range[2] : 'Unknown';
      }
      const rawEra = String(track.era || '').trim().toLowerCase();
      return LIBRARY_ERA_RANGES.map(([, , era]) => era).concat('Unknown')
        .find(era => era.toLowerCase() === rawEra) || 'Unknown';
    }

    function trackBpmValue(track = {}) {
      const bpm = Number(track.bpm || track.tempo || 0);
      return Number.isFinite(bpm) ? bpm : 0;
    }

    function textHasAny(text = '', words = []) {
      return words.some(word => text.includes(word));
    }

    function trackPlayEvidenceValue(track = {}) {
      const values = [track.play_count, track.history_play_count, track.plays, track.playcount, track.serato_play_count];
      for (const value of values) {
        const count = Number(value || 0);
        if (Number.isFinite(count) && count > 0) return count;
      }
      return 0;
    }

    function trackCrateEvidenceValues(track = {}) {
      const values = [
        ...(Array.isArray(track.serato_crates) ? track.serato_crates : []),
        ...(Array.isArray(track.crate_names) ? track.crate_names : []),
        ...(Array.isArray(track.playlist_names) ? track.playlist_names : []),
        ...(Array.isArray(track.source_playlists) ? track.source_playlists : [])
      ];
      return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
    }

    function libraryTrackEvidence(track = {}) {
      const crateNames = trackCrateEvidenceValues(track);
      const text = libraryTrackText(track);
      const crateText = crateNames.join(' ').toLowerCase();
      const playCount = trackPlayEvidenceValue(track);
      const polySignal = textHasAny(`${text} ${crateText}`, ['poly', 'polynesian', 'pasifika', 'pacific', 'island', 'samoan', 'tongan', 'fijian', 'maori']);
      const weddingProof = textHasAny(`${text} ${crateText}`, ['wedding', 'reception', 'first dance', 'dinner', 'family', 'all ages', 'clean', 'radio edit']);
      return {
        playCount,
        crateCount: crateNames.length,
        polySignal,
        weddingProof,
        userProven: playCount >= 8 || crateNames.length >= 3
      };
    }

    function trackEnergyValue(track = {}, text = libraryTrackText(track)) {
      if (textHasAny(text, ['peak', 'weapon', 'club', 'banger', 'drive', 'high', 'ultra'])) return 4;
      if (textHasAny(text, ['lift', 'party', 'dance', 'bounce'])) return 3;
      if (textHasAny(text, ['mid', 'groove', 'warm', 'smooth'])) return 2;
      if (textHasAny(text, ['low', 'chill', 'lounge', 'intro', 'dinner'])) return 1;
      const bpm = trackBpmValue(track);
      if (bpm >= 124) return 4;
      if (bpm >= 108) return 3;
      if (bpm >= 82) return 2;
      return 1;
    }

    function libraryBriefScores(track = {}, brief = setBriefPayload()) {
      const text = libraryTrackText(track);
      const bpm = trackBpmValue(track);
      const energy = trackEnergyValue(track, text);
      const roleScore = Number(track.role_score || 0);
      const evidence = libraryTrackEvidence(track);
      const explicitSignal = textHasAny(text, ['explicit', 'dirty', 'uncensored', 'redrum', 'adult', 'after dark']);
      const cleanSignal = textHasAny(text, ['clean', 'radio edit', 'super clean', 'family', 'all ages']);
	  const familyMeaningRisk = textHasAny(text, [
	    'explicit', 'dirty', 'uncensored', 'adult', 'after dark', 'nsfw',
	    'wap', 'my type', 'my neck my back', 'sex', 'sexual', 'strip', 'stripper',
	    'booty', 'pussy', 'dick', 'bitch', 'hoe', 'whore', 'fuck', 'nasty', 'freak', 'twerk'
	  ]);
	  const familyMeaningProof = textHasAny(text, [
	    'family friendly', 'family-friendly', 'all ages', 'all-ages', 'school', 'kids',
	    'community', 'corporate', 'daytime', 'radio friendly', 'radio-friendly'
	  ]);
      const lyricRisk = explicitSignal && (brief.lyrics === 'clean_only' || brief.setting === 'corporate' || brief.audience === 'all_ages') ? 44
        : explicitSignal && (brief.lyrics === 'clean_preferred' || brief.setting === 'wedding') ? 20
          : 0;
      const weddingSafeSignal = textHasAny(text, [
        'clean', 'radio edit', 'wedding', 'reception', 'family', 'all ages', 'crowd pleaser',
        'classic', 'throwback', 'motown', 'disco', 'funk', 'soul', 'love', 'first dance'
      ]);
      const weddingAdultRisk = brief.intention === 'wedding' && textHasAny(text, [
        'megan thee stallion', 'meg thee stallion', 'cardi b', 'sexyy red',
        'kodak black',
        'wap', 'body', 'savage', 'thot', 'twerk', 'strip', 'stripper', 'hot girl',
        'pussy', ' a$$', 'big booty', 'bitch', 'hoe', 'fuck', 'nasty', 'freak', 'drill', 'trap'
      ]);
      const adultTitleSignal = textHasAny(text, [
        'bad ass', 'badass', 'bitch', 'bitches', 'hoe', 'thot', 'twerk', 'strip',
        'stripper', 'pussy', ' a$$', 'ass ', 'fuck', 'nasty', 'freak', 'wap'
      ]);
	      const singalongProofSignal = textHasAny(text, [
	        'singalong', 'sing-along', 'sing along', 'karaoke', 'chant', 'call and response',
	        'crowd pleaser', 'anthem', 'classic', 'throwback', 'motown', 'disco', 'funk',
	        'abba', 'queen', 'whitney', 'ed sheeran', 'bruno mars', 'beyonce', 'usher'
	      ]);
	      const globalWeddingSignal = textHasAny(text, [
	        'latin', 'reggaeton', 'dembow', 'bachata', 'salsa', 'merengue', 'cumbia',
	        'afro', 'afrobeats', 'afrobeat', 'amapiano', 'afro house', 'dancehall',
	        'soca', 'moombahton', 'moombah', 'kuduro', 'island', 'world', 'global'
	      ]);
	      const globalWeddingProofSignal = textHasAny(text, ['danza kuduro', 'gasolina'])
	        || (globalWeddingSignal && (evidence.weddingProof || evidence.userProven));
      const crowdMemorySignal = textHasAny(text, [
        'wedding', 'reception', 'first dance', 'love', 'perfect', 'marry',
        'can\'t help', 'all of me', 'don\'t stop', 'sweet caroline', 'mr. brightside'
      ]);
      const userCrowdProof = evidence.userProven || evidence.weddingProof || evidence.playCount >= 8 || evidence.crateCount >= 3;
      const top40ProofSignal = textHasAny(text, ['top 40', 'top40', 'chart', 'billboard', 'viral', 'tiktok', 'radio hit', 'crowd pleaser']);
      const seriesProofSignal = textHasAny(text, ['signature', 'series', 'brand', 'intro', 'theme', 'episode'])
        || (evidence.userProven && (bpm || track.camelot || track.key || track.initial_key));
      const warm = (bpm >= 70 && bpm <= 108 ? 30 : 0) + (energy <= 2 ? 22 : 0) + (textHasAny(text, ['warm', 'soul', 'r&b', 'rnb', 'reggae', 'lounge', 'dinner', 'smooth', 'intro', 'acoustic']) ? 22 : 0);
      const singalong = Math.max(0,
        (singalongProofSignal ? 38 : 0)
        + (crowdMemorySignal ? 30 : 0)
        + (userCrowdProof && textHasAny(text, ['pop', 'top 40', 'top40', 'chart', 'radio', 'single']) ? 18 : 0)
        + (bpm >= 80 && bpm <= 124 && (singalongProofSignal || crowdMemorySignal || userCrowdProof) ? 12 : 0)
        - (adultTitleSignal && !singalongProofSignal && !crowdMemorySignal && !evidence.userProven ? 34 : 0)
      );
	      const dancefloor = (bpm >= 92 && bpm <= 128 ? 28 : 0) + (energy >= 3 ? 24 : 0) + (textHasAny(text, ['dance', 'party', 'club', 'pop', 'hip hop', 'r&b', 'house', 'afro', 'island', 'bounce']) ? 24 : 0);
	      const global = (globalWeddingSignal ? 42 : 0)
	        + (bpm >= 90 && bpm <= 126 ? 14 : 0)
	        + (energy >= 2 && energy <= 4 ? 12 : 0)
	        + (globalWeddingProofSignal ? 24 : 0);
      const peak = (bpm >= 116 ? 24 : 0) + (energy >= 4 ? 34 : 0) + (textHasAny(text, ['peak', 'weapon', 'banger', 'club', 'main room', 'festival', 'drop']) ? 28 : 0);
      const closing = (textHasAny(text, ['closing', 'last song', 'one more', 'final', 'end of the night', 'don\'t stop', 'tonight', 'dreams', 'home', 'good life']) ? 36 : 0)
        + (singalong * 0.45)
        + (energy >= 2 && energy <= 4 ? 14 : 0);
      const urban = (textHasAny(text, ['hip hop', 'hip-hop', 'rap', 'trap', 'r&b', 'rnb', 'afro', 'afrobeats', 'dancehall', 'amapiano', 'jersey', 'drill', 'urban', 'island', 'poly']) ? 38 : 0)
        + (bpm >= 70 && bpm <= 112 ? 16 : 0)
        + (energy >= 2 ? 10 : 0);
      const electronic = (textHasAny(text, ['house', 'tech house', 'edm', 'dance', 'electro', 'electronic', 'remix', 'club mix', 'festival', 'main room', 'garage']) ? 38 : 0)
        + (bpm >= 118 && bpm <= 132 ? 20 : 0)
        + (energy >= 3 ? 14 : 0);
      const top40 = (top40ProofSignal ? 36 : (textHasAny(text, ['radio', 'pop', 'single']) ? 22 : 0))
        + (singalong * 0.3)
        + (bpm >= 90 && bpm <= 128 ? 10 : 0);
      const bridge = (Math.min(urban, 42) * 0.35)
        + (Math.min(electronic, 42) * 0.35)
        + (bpm >= 95 && bpm <= 124 ? 20 : 0)
        + (textHasAny(text, ['transition', 'blend', 'mash', 'edit', 'bootleg', 'remix', 'intro', 'quick']) ? 22 : 0);
      const start = (warm * 0.55) + (top40 * 0.25) + (urban * 0.12) + (energy <= 3 ? 16 : 0);
      const series = (top40 * 0.22) + (urban * 0.2) + (electronic * 0.2) + (singalong * 0.22) + (seriesProofSignal ? 28 : 0);
      const anchor = (top40 * 0.35) + (singalong * 0.28) + (dancefloor * 0.18) + (urban * 0.1) + (electronic * 0.1);
      const skill = (bridge * 0.4) + (peak * 0.18) + (dancefloor * 0.14) + ((track.camelot || track.key || track.initial_key) ? 12 : 0) + (bpm ? 8 : 0);
      const urbanWeaponProof = userCrowdProof || peak >= 46 || dancefloor >= 50 || textHasAny(text, ['weapon', 'banger', 'club', 'main room']);
      const top40AnchorProof = top40ProofSignal && (singalong >= 42 || dancefloor >= 48 || userCrowdProof);
      const crowdFamiliarProof = singalong >= 42 || crowdMemorySignal || userCrowdProof || (top40ProofSignal && evidence.playCount >= 4);
      const weddingCleanProof = cleanSignal || evidence.weddingProof || textHasAny(text, ['radio edit', 'clean edit', 'super clean', 'family', 'all ages']);
      const seriesFitProof = seriesProofSignal || (userCrowdProof && (bridge >= 34 || skill >= 34));
      const soundFocusBonus = brief.soundFocus === 'urban_electronic_top40' ? (urban + electronic + top40) * 0.08
        : brief.soundFocus === 'urban' ? urban * 0.16
          : brief.soundFocus === 'electronic_top40' ? (electronic + top40) * 0.1
            : brief.soundFocus === 'youtube_series' ? series * 0.12
	              : brief.soundFocus === 'global' ? global * 0.2
	                : 0;
      const explicitClubUseful = explicitSignal && (brief.lyrics === 'explicit_allowed' || brief.lyrics === 'after_dark') && ['club', 'bar'].includes(brief.setting) && (urbanWeaponProof || peak >= 46 || dancefloor >= 50);
      const explicitClubBonus = explicitClubUseful ? 12 : 0;
      const cleanRequiredBonus = cleanSignal && (brief.lyrics === 'clean_only' || brief.lyrics === 'clean_preferred') ? 10 : 0;
	      const classicWeddingGlobalRisk = brief.intention === 'wedding'
	        && brief.soundFocus !== 'global_wedding'
	        && globalWeddingSignal
	        && !globalWeddingProofSignal
	        ? 30
	        : 0;
	      const risks = lyricRisk
	        + (weddingAdultRisk ? 48 : 0)
	        + (brief.intention === 'wedding' && (peak >= 48 || bpm >= 130) ? 28 : 0)
	        + classicWeddingGlobalRisk
        + (brief.intention === 'club_peak' && energy <= 1 ? 26 : 0)
        + (adultTitleSignal && (brief.lyrics === 'clean_only' || brief.lyrics === 'clean_preferred') ? 24 : 0)
        + (adultTitleSignal && brief.intention === 'open_format' && !userCrowdProof ? 12 : 0)
        + (brief.intention === 'open_format' && textHasAny(text, ['dinner', 'lounge', 'first dance', 'ceremony']) ? 20 : 0)
        + (brief.intention === 'youtube' && textHasAny(text, ['random', 'novelty', 'karaoke', 'background']) ? 28 : 0)
	    + (brief.intention === 'family_friendly' && familyMeaningRisk ? 100 : 0)
	    + (brief.intention === 'global' && !globalWeddingSignal ? 34 : 0)
        + (textHasAny(text, ['hardstyle', 'dubstep', 'techno', 'trap', 'drill']) && !['explicit_allowed', 'after_dark'].includes(brief.lyrics) ? 18 : 0);
      let best = Math.round(roleScore + warm * 0.18 + singalong * 0.24 + dancefloor * 0.2 + closing * 0.1 + soundFocusBonus + cleanRequiredBonus + explicitClubBonus - risks * 0.18);
	      if (brief.intention === 'wedding') {
	        const globalBonus = brief.soundFocus === 'global_wedding' ? global * 0.34 : (globalWeddingProofSignal ? global * 0.08 : 0);
	        best = Math.round(roleScore + warm * 0.24 + singalong * 0.34 + dancefloor * 0.14 + closing * 0.12 + globalBonus + (weddingSafeSignal ? 18 : 0) - risks * 0.62);
      } else if (brief.intention === 'open_format') {
        best = Math.round(roleScore * 0.45 + urban * 0.28 + electronic * 0.26 + top40 * 0.26 + bridge * 0.18 + dancefloor * 0.14 + peak * 0.1 + soundFocusBonus + explicitClubBonus + cleanRequiredBonus - risks * 0.34);
      } else if (brief.intention === 'youtube') {
        best = Math.round(roleScore * 0.38 + series * 0.32 + anchor * 0.24 + skill * 0.24 + bridge * 0.14 + soundFocusBonus + cleanRequiredBonus - risks * 0.28);
	  } else if (brief.intention === 'family_friendly') {
	    best = Math.round(roleScore * 0.38 + warm * 0.22 + singalong * 0.28 + dancefloor * 0.16 + (familyMeaningProof ? 34 : 0) - risks * 0.8);
	  } else if (brief.intention === 'global') {
	    best = Math.round(roleScore * 0.4 + global * 0.48 + dancefloor * 0.16 + bridge * 0.14 + peak * 0.08 - risks * 0.48);
      }
      return {
	        best, warm, singalong, dancefloor, peak, closing, global, risks,
        start, urban, electronic, top40, bridge, series, anchor, skill,
        lyricRisk, explicitOk: explicitClubBonus ? 1 : 0, cleanSignal: cleanSignal ? 1 : 0,
	        weddingProof: evidence.weddingProof ? 1 : 0, userProven: evidence.userProven ? 1 : 0, polyFit: evidence.polySignal ? 1 : 0, globalWedding: globalWeddingSignal ? 1 : 0, globalWeddingProof: globalWeddingProofSignal ? 1 : 0,
	        familyMeaningRisk: familyMeaningRisk ? 1 : 0, familyMeaningProof: familyMeaningProof ? 1 : 0,
        adultTitle: adultTitleSignal ? 1 : 0, urbanWeaponProof: urbanWeaponProof ? 1 : 0,
        top40AnchorProof: top40AnchorProof ? 1 : 0, crowdFamiliarProof: crowdFamiliarProof ? 1 : 0,
        weddingCleanProof: weddingCleanProof ? 1 : 0, seriesFitProof: seriesFitProof ? 1 : 0
      };
    }

    function libraryBriefEligibility(track = {}, brief = setBriefPayload()) {
      const normalized = normalizeSetBrief(brief);
      if (!normalized.enabled) return { eligible: true, reasons: [] };
      const reasons = [];
      const text = libraryTrackText(track);
      const root = String(getRootFromSuggestion(track) || '').trim();
      const evidence = libraryTrackEvidence(track);
      const energy = trackEnergyValue(track, text);
      const trackEra = libraryTrackEraValue(track);
      const explicitSignal = textHasAny(text, ['explicit', 'dirty', 'uncensored', 'adult', 'after dark']);
      const cleanSignal = textHasAny(text, ['clean', 'radio edit', 'super clean', 'family', 'all ages']);
	  const familyMeaningRisk = textHasAny(text, [
	    'explicit', 'dirty', 'uncensored', 'adult', 'after dark', 'nsfw',
	    'wap', 'my type', 'my neck my back', 'sex', 'sexual', 'strip', 'stripper',
	    'booty', 'pussy', 'dick', 'bitch', 'hoe', 'whore', 'fuck', 'nasty', 'freak', 'twerk'
	  ]);
      const urbanCrossover = textHasAny(text, ['rnb', 'r&b', 'hip hop', 'rap', 'soul', 'funk', 'gospel', 'urban', 'pop rap']);
      const top40Crossover = textHasAny(text, ['top 40', 'pop', 'dance pop', 'radio', 'mainstream', 'crossover']);
      const bridgeUtility = root === 'Utility' || textHasAny(text, ['transition', 'bridge', 'mash', 'bootleg', 'intro', 'quick']);

      if (normalized.era !== 'All' && trackEra !== normalized.era) reasons.push(`Outside ${setBriefLabel('era', normalized.era)}`);
      if (normalized.lyrics === 'clean_only' && explicitSignal && !cleanSignal) reasons.push('Not clean-only safe');
	  if (normalized.intention === 'family_friendly' && familyMeaningRisk) reasons.push('Meaning-risk title or library label');
	  if (normalized.intention === 'global' && root !== 'Global' && !textHasAny(text, ['afro', 'amapiano', 'dancehall', 'soca', 'reggaeton', 'latin', 'global', 'world', 'island', 'punjabi', 'arab'])) reasons.push('Outside the selected Global sound');
      if ((normalized.audience === 'all_ages' || ['wedding', 'corporate'].includes(normalized.setting)) && explicitSignal && !cleanSignal) reasons.push('Wrong lyrics for this room');

      if (normalized.intention === 'wedding' || normalized.setting === 'wedding') {
        if (normalized.soundFocus !== 'global_wedding' && root === 'Global') reasons.push('Global lane not selected');
      }

      if (normalized.soundFocus === 'urban') {
        if (['Electronic', 'Global'].includes(root)) reasons.push('Outside R&B / Urban sound');
        if (root === 'Pop' && !urbanCrossover && !bridgeUtility) reasons.push('Outside R&B / Urban sound');
      } else if (normalized.soundFocus === 'electronic_top40') {
        if (root === 'Global') reasons.push('Outside Electronic / Top 40 sound');
        if (root === 'Urban' && !top40Crossover && !bridgeUtility) reasons.push('Outside Electronic / Top 40 sound');
      } else if (normalized.soundFocus === 'urban_electronic_top40') {
        if (root === 'Global' && !bridgeUtility) reasons.push('Outside Urban / Electronic / Top 40 sound');
      }

      if (normalized.intention === 'opener' && energy >= 4 && !bridgeUtility) reasons.push('Too much for an opener');
      if (normalized.intention === 'warmup' && energy >= 4 && !bridgeUtility) reasons.push('Too hot for warm-up');
      if (normalized.intention === 'club_peak' && energy <= 1) reasons.push('Too soft for club peak');

      return {
        eligible: reasons.length === 0,
        reasons,
        root,
        era: trackEra,
        weddingProof: Boolean(evidence.weddingProof),
        userProven: Boolean(evidence.userProven)
      };
    }

	    function libraryBriefDecoratedTracks(tracks = [], brief = setBriefPayload(), query = '') {
	      const lane = activeLibraryBriefLane || 'best';
	      return (Array.isArray(tracks) ? tracks : []).map(track => {
	        const scores = libraryBriefScores(track, brief);
	        const laneScore = Number(scores[lane] || scores.best || 0);
	        const freshness = libraryFreshnessMeta(track, brief, query);
	        const displayScore = laneScore + Number(freshness.lift || 0) - Number(freshness.penalty || 0);
	        const eligibility = libraryBriefEligibility(track, brief);
	        return { track, scores, laneScore, displayScore, freshness, eligibility };
	      });
	    }

	    function sortLibraryBriefDecorated(a, b) {
	      const aDisplay = Number(a.displayScore ?? a.laneScore ?? 0);
	      const bDisplay = Number(b.displayScore ?? b.laneScore ?? 0);
	      if (bDisplay !== aDisplay) return bDisplay - aDisplay;
	      if (b.laneScore !== a.laneScore) return b.laneScore - a.laneScore;
	      const aBest = Number(a.scores.best || 0);
	      const bBest = Number(b.scores.best || 0);
	      if (bBest !== aBest) return bBest - aBest;
	      return (Number(b.track.role_score || 0) - Number(a.track.role_score || 0)) || String(a.track.title || '').localeCompare(String(b.track.title || ''));
    }

    function weddingReceptionFit(item, level = 'strong') {
      const { scores, laneScore } = item;
      const lane = activeLibraryBriefLane || 'best';
      if (lane === 'risks') return Number(scores.risks || 0) >= 34;
      if (Number(scores.risks || 0) >= 58) return false;
      const cleanReceptionProof = Boolean(scores.weddingCleanProof || scores.cleanSignal);
      const familiarButNeedsProof = Boolean(scores.crowdFamiliarProof || scores.userProven);
	      const laneCanExploreProofGaps = ['singalong', 'dancefloor', 'closing', 'global'].includes(lane);
      if (level === 'strong') {
        return laneScore >= 34 && Number(scores.risks || 0) < 34 && (cleanReceptionProof || (laneCanExploreProofGaps && familiarButNeedsProof));
      }
      return laneScore >= 24 && Number(scores.risks || 0) < 34 && (cleanReceptionProof || (laneCanExploreProofGaps && familiarButNeedsProof));
    }

	    function applyLibraryBriefLensToTracks(tracks = [], query = '') {
	      const brief = setBriefPayload();
	      renderLibraryBriefLens();
	      // A typed search is an explicit request for a known track, artist, or
	      // metadata value. Keep those real library matches visible even when
	      // the active Set Brief would not ordinarily recommend them.
	      if (String(query || '').trim()) {
	        activeLibraryEligibilitySummary = {
	          source: Array.isArray(tracks) ? tracks.length : 0,
	          eligible: Array.isArray(tracks) ? tracks.length : 0,
	          rejected: 0
	        };
	        return Array.isArray(tracks) ? tracks : [];
	      }
	      if (!brief.enabled || !Array.isArray(tracks)) {
	        activeLibraryEligibilitySummary = { source: Array.isArray(tracks) ? tracks.length : 0, eligible: Array.isArray(tracks) ? tracks.length : 0, rejected: 0 };
	        return tracks;
	      }
	      const lane = activeLibraryBriefLane || 'best';
	      const allDecorated = libraryBriefDecoratedTracks(tracks, brief, query).sort(sortLibraryBriefDecorated);
	      const decorated = allDecorated.filter(item => item.eligibility?.eligible !== false);
      activeLibraryEligibilitySummary = {
        source: allDecorated.length,
        eligible: decorated.length,
        rejected: Math.max(0, allDecorated.length - decorated.length)
      };
      if (lane === 'risks') {
        return decorated.filter(item => Number(item.scores.risks || 0) >= 34).map(item => item.track);
      }
      if (brief.intention === 'wedding') {
	        const proofLevel = brief.planningStyle === 'loose' ? 'potential' : 'strong';
	        return decorated.filter(item => weddingReceptionFit(item, proofLevel)).map(item => item.track);
      }
	      const baseThreshold = ['opener', 'warmup'].includes(brief.intention) ? 28 : 30;
	      const threshold = brief.planningStyle === 'loose' ? Math.max(22, baseThreshold - 5)
	        : brief.planningStyle === 'fixed' ? baseThreshold + 6
	          : baseThreshold;
      const missionFits = decorated.filter(item => {
        const risk = Number(item.scores.risks || 0);
        if (risk >= 58) return false;
        return item.laneScore >= threshold;
      });
	      return missionFits.map(item => item.track);
    }

    function libraryBriefBadges(track = {}) {
      const brief = setBriefPayload();
      if (!brief.enabled) return [];
      const scores = libraryBriefScores(track, brief);
      const evidence = libraryTrackEvidence(track);
      const lane = activeLibraryBriefLane || 'best';
      const badges = [];
      const pushBadge = (label, tone = '') => {
        if (!label || badges.some(badge => badge.label === label)) return;
        badges.push({ label, tone });
      };
      const strongWarm = scores.warm >= 42;
      const strongSingalong = scores.singalong >= 42;
      const strongDancefloor = scores.dancefloor >= 46;
      const strongPeak = scores.peak >= 46;
      const strongClosing = scores.closing >= 42;
      const strongBest = scores.best >= 34;
      if (scores.adultTitle && !scores.userProven && (brief.lyrics === 'clean_only' || brief.lyrics === 'clean_preferred' || brief.setting === 'wedding')) pushBadge('Know Your Crowd', 'is-risk');
      if (brief.intention === 'wedding' && scores.risks >= 34) badges.push({ label: scores.risks >= 58 ? 'After Dark Only' : 'Know Your Crowd', tone: 'is-risk' });
      if (brief.lyrics === 'clean_only' && scores.lyricRisk >= 34) pushBadge('Needs Clean Version', 'is-risk');
      else if ((brief.lyrics === 'explicit_allowed' || brief.lyrics === 'after_dark') && scores.explicitOk) pushBadge(brief.lyrics === 'after_dark' ? 'After Dark Weapon' : 'Club Version OK', 'is-proof');
      if (brief.intention === 'open_format') {
        if ((activeLibraryBriefLane || 'best') === 'urban' && scores.urban >= 38) pushBadge(scores.urbanWeaponProof ? 'Urban Weapon' : (scores.adultTitle ? 'After Dark Record' : 'Urban Fit'), scores.urbanWeaponProof ? '' : 'is-later');
        else if ((activeLibraryBriefLane || 'best') === 'electronic' && scores.electronic >= 38) pushBadge('House Lift', 'is-later');
        else if ((activeLibraryBriefLane || 'best') === 'top40' && scores.top40 >= 36) pushBadge(scores.top40AnchorProof ? 'Top 40 Anchor' : 'Top 40 Fit', scores.top40AnchorProof ? '' : 'is-later');
        else if ((activeLibraryBriefLane || 'best') === 'bridge' && scores.bridge >= 34) pushBadge('Urban To House Bridge');
        else if ((activeLibraryBriefLane || 'best') === 'start' && scores.start >= 34) pushBadge('Start The Room');
        else if (strongPeak) pushBadge('Peak Open Format', 'is-later');
        else if (scores.urban >= 38) pushBadge(scores.urbanWeaponProof ? 'Urban Weapon' : (scores.adultTitle ? 'After Dark Record' : 'Urban Fit'), scores.urbanWeaponProof ? '' : 'is-later');
        else if (scores.electronic >= 38) pushBadge('Electronic Lift', 'is-later');
        else if (scores.top40 >= 36) pushBadge(scores.crowdFamiliarProof ? 'Crowd Familiar' : 'Top 40 Fit', scores.crowdFamiliarProof ? '' : 'is-later');
        else if (scores.bridge >= 34) pushBadge('Switch-Up Bridge');
        else if (scores.risks >= 34) pushBadge('Wrong Room', 'is-risk');
      } else if (brief.intention === 'youtube') {
        if ((activeLibraryBriefLane || 'best') === 'skill' && scores.skill >= 34) pushBadge('Skill Showcase', 'is-proof');
        else if ((activeLibraryBriefLane || 'best') === 'anchor' && scores.anchor >= 34) pushBadge('Episode Anchor');
        else if ((activeLibraryBriefLane || 'best') === 'bridge' && scores.bridge >= 34) pushBadge('Controlled Switch-Up');
        else if (scores.series >= 34) pushBadge(scores.seriesFitProof ? 'Series Fit' : 'Needs Series Proof', scores.seriesFitProof ? '' : 'is-risk');
        else if (scores.anchor >= 34) pushBadge('Strong First 10');
        else if (scores.skill >= 34) pushBadge('Transition Flex', 'is-proof');
        else if (strongPeak) pushBadge('Finale Moment', 'is-later');
        else if (scores.risks >= 34) pushBadge('Too Random', 'is-risk');
      } else if (brief.intention === 'club_peak') {
        if (strongPeak) pushBadge(lane === 'peak' ? 'Peak Weapon' : 'Peak Ready', 'is-later');
        else if (strongDancefloor) pushBadge(lane === 'peak' ? 'Peak Builder' : 'Drive', 'is-later');
        else if (strongWarm) pushBadge(lane === 'warm' ? 'Breather' : 'Warm-Up Only', lane === 'peak' || lane === 'best' ? 'is-risk' : '');
        else if (scores.risks >= 34 || scores.best < 24) pushBadge('Too Soft', 'is-risk');
      } else if (brief.intention === 'warmup') {
        if (scores.risks >= 34 || strongPeak) pushBadge('Too Hot Early', 'is-risk');
        else if (strongWarm) pushBadge('Warm-Up Fit');
        else if (strongSingalong) pushBadge('Familiar Opener');
        else if (strongDancefloor) pushBadge('Save For Later', 'is-later');
      } else if (brief.intention === 'opener') {
        if (scores.risks >= 34 || strongPeak) pushBadge('Too Much Early', 'is-risk');
        else if (strongWarm || strongBest) pushBadge('Clean Opener');
        else if (strongSingalong) pushBadge('Familiar Start');
        else if (strongDancefloor) pushBadge('Lift Later', 'is-later');
	      } else if (brief.intention === 'wedding') {
	        if (scores.risks >= 58) pushBadge('Not Reception Safe', 'is-risk');
	        else if (brief.soundFocus === 'global_wedding' && scores.global >= 34 && scores.globalWeddingProof) pushBadge('Global Wedding Moment', 'is-proof');
	        else if (brief.soundFocus === 'global_wedding' && scores.global >= 34) pushBadge('Global Wedding Maybe', 'is-later');
	        else if (evidence.weddingProof && scores.weddingCleanProof && (strongSingalong || strongBest)) pushBadge('Wedding Safe');
	        else if (strongSingalong && scores.weddingCleanProof) pushBadge('Family Friendly');
	        else if (strongSingalong) pushBadge('Needs Clean Proof', 'is-risk');
	        else if (strongDancefloor) pushBadge('Dancefloor Later', 'is-later');
	        else if (strongPeak) pushBadge('After Dark Only', 'is-risk');
      } else if (brief.intention === 'closing') {
        if (strongClosing) pushBadge(lane === 'closing' ? 'Closing Song' : 'Final Singalong');
        else if (strongSingalong) pushBadge('Last 20 Minutes');
        else if (strongPeak) pushBadge(lane === 'peak' ? 'Final Lift' : 'Better Earlier', 'is-later');
        else if (strongWarm) pushBadge('Come Down');
      } else {
        const era = String(brief.era || '');
        const throwbackEra = ['Retro', '90s', '2k'].some(token => era.includes(token));
        if (strongSingalong && throwbackEra) pushBadge('Throwback Fit');
        else if (strongSingalong) pushBadge('Singalong Potential');
        else if (strongDancefloor) pushBadge('Dancefloor Ready', 'is-later');
        else if (strongPeak) pushBadge('Peak Party', 'is-later');
        else if (strongClosing) pushBadge('Final Run');
        else if (strongWarm) pushBadge('Room Builder');
      }
      if (evidence.polySignal && (evidence.playCount >= 5 || evidence.crateCount >= 2)) pushBadge('Poly Crowd Fit', 'is-proof');
      if (evidence.userProven) pushBadge('User Proven', 'is-proof');
	      if (brief.intention === 'wedding' && scores.globalWedding && brief.soundFocus !== 'global_wedding' && !scores.globalWeddingProof && scores.risks < 58) pushBadge('Use Global Wedding Style', 'is-risk');
	      if (brief.intention === 'wedding' && evidence.polySignal && evidence.userProven && !evidence.weddingProof && scores.risks < 34) pushBadge('Needs Wedding Proof', 'is-risk');
      const weddingFitAllowed = brief.intention !== 'wedding' || (evidence.weddingProof && scores.risks < 34);
      if (!badges.length && strongBest && weddingFitAllowed && !(brief.intention === 'wedding' && scores.risks >= 34)) pushBadge(`${setBriefLabel('intention', brief.intention)} Fit`);
      if (scores.risks >= 34 && brief.intention !== 'wedding') pushBadge(brief.intention === 'club_peak' ? 'Check Peak Timing' : 'Check Timing', 'is-risk');
      return badges.slice(0, 3);
    }

    function renderLibraryBriefBadges(track = {}) {
      const badges = libraryBriefBadges(track);
      const strip = libraryBriefReasonStrip(track);
      if (!badges.length && !strip.length) return '';
      return `
        <div class="library-fit-stack">
          ${badges.length ? `<div class="library-fit-row">${badges.map(badge => `<span class="library-fit-badge ${badge.tone}">${escapeHtml(badge.label)}</span>`).join('')}</div>` : ''}
          ${strip.length ? `<div class="library-mission-reason-strip" title="${escapeHtml(strip.join(' | '))}">${strip.map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div>` : ''}
        </div>`;
    }

    function libraryBriefReasonStrip(track = {}) {
      const brief = setBriefPayload();
      if (!brief.enabled) return [];
      const scores = libraryBriefScores(track, brief);
      const evidence = libraryTrackEvidence(track);
      const lane = activeLibraryBriefLane || 'best';
      const reasons = [];
      const pushReason = (label) => {
        if (!label || reasons.includes(label)) return;
        reasons.push(label);
      };
      const bpm = trackBpmValue(track);
      const key = String(track.camelot || track.key || track.initial_key || '').trim().toUpperCase();

      if (lane !== 'best') pushReason(setBriefLaneLabel(lane));
      else if (brief.intention === 'wedding') {
        if (scores.singalong >= 42) pushReason('Singalong');
        else if (scores.warm >= 42) pushReason('Warm Up');
        else if (scores.dancefloor >= 46) pushReason('Dancefloor Later');
      } else if (brief.intention === 'open_format') {
        if (scores.urban >= 38) pushReason('Urban Fit');
        if (scores.electronic >= 38) pushReason('House Lift');
        if (scores.top40 >= 36) pushReason('Top 40 Anchor');
        if (!reasons.length && scores.bridge >= 34) pushReason('Switch-Up Bridge');
      } else if (brief.intention === 'family_friendly') {
        if (scores.familyMeaningProof) pushReason('Meaning Safe');
        else if (scores.singalong >= 42) pushReason('Familiar');
        else if (scores.warm >= 42) pushReason('Welcome');
      } else if (brief.intention === 'global') {
        if (scores.global >= 34) pushReason('Global Lane');
        if (scores.dancefloor >= 46) pushReason('Dancefloor');
        if (scores.bridge >= 34) pushReason('Crossover');
      } else if (scores.best >= 34) {
        pushReason(`${setBriefLabel('intention', brief.intention)} Fit`);
      }

      if (scores.cleanSignal || scores.weddingCleanProof) pushReason(brief.lyrics === 'clean_only' ? 'Clean Proof' : 'Clean/Radioplay');
      else if (brief.lyrics === 'explicit_allowed' && scores.explicitOk) pushReason('Club Version OK');
      if (evidence.userProven) pushReason('User Proven');
      else if (evidence.weddingProof) pushReason('Crate Proof');
      if (scores.risks >= 34) pushReason(scores.risks >= 58 ? 'High Risk' : 'Check Timing');
      if (bpm) pushReason(`${Math.round(bpm)} BPM`);
      if (key) pushReason(`${key} Key`);
      return reasons.slice(0, 5);
    }

    function setBriefLaneLabel(lane = '') {
      const labels = {
        best: 'Best Fit',
        start: 'Start Room',
        warm: 'Warm Up',
        singalong: 'Singalong',
        dancefloor: 'Dancefloor',
        closing: 'Closing',
        urban: 'Urban',
        electronic: 'House Lift',
        top40: 'Top 40',
        bridge: 'Bridge',
        peak: 'Peak',
        global: 'Global',
        risks: 'Risk Review',
        series: 'Series Fit',
        anchor: 'Anchor',
        skill: 'Skill'
      };
      return labels[lane] || String(lane || '').replace(/_/g, ' ');
    }

    const ROOM_RESCUE_GIGS = Object.freeze({
      nightclub: {
        label: 'Nightclub',
        moments: [
          {
            id: 'doors_opening',
            label: 'Doors Opening',
            direction: 'Start familiar and controlled. Raise the energy after song three.',
            brief: { intention: 'warmup', energyJourney: 'build', audience: 'adult_18', setting: 'club', lyrics: 'explicit_allowed', soundFocus: 'open_format' }
          },
          {
            id: 'room_filling',
            label: 'Room Filling',
            direction: 'Give the room a clear rhythm now, then move into stronger records.',
            brief: { intention: 'party', energyJourney: 'build', audience: 'adult_18', setting: 'club', lyrics: 'explicit_allowed', soundFocus: 'open_format' }
          },
          {
            id: 'already_busy',
            label: 'Already Busy',
            direction: 'Meet the room at full energy. Lead with proven dancefloor records.',
            brief: { intention: 'club_peak', energyJourney: 'stay_up', audience: 'adult_18', setting: 'club', lyrics: 'after_dark', soundFocus: 'electronic_top40' }
          }
        ]
      },
      private_event: {
        label: 'Private Event',
        moments: [
          {
            id: 'background_music',
            label: 'Background Music',
            direction: 'Keep it familiar, easy, and social. Leave room for conversation.',
            brief: { intention: 'warmup', energyJourney: 'build', audience: 'mixed_adult', setting: 'private_party', lyrics: 'clean_preferred', soundFocus: 'open_format' }
          },
          {
            id: 'celebration',
            label: 'Celebration',
            direction: 'Start with recognisable records and build toward a shared moment.',
            brief: { intention: 'party', energyJourney: 'waves', audience: 'mixed_adult', setting: 'private_party', lyrics: 'clean_preferred', soundFocus: 'open_format' }
          },
          {
            id: 'ready_to_party',
            label: 'Ready To Party',
            direction: 'Open with a confident crowd record and keep the next songs moving.',
            brief: { intention: 'party', energyJourney: 'stay_up', audience: 'mixed_adult', setting: 'private_party', lyrics: 'explicit_allowed', soundFocus: 'open_format' }
          }
        ]
      },
      wedding: {
        label: 'Wedding',
        moments: [
          {
            id: 'guests_arriving',
            label: 'Guests Arriving',
            direction: 'Welcome the room with warm, familiar records that suit every generation.',
            brief: { intention: 'wedding', energyJourney: 'build', audience: 'all_ages', setting: 'wedding', lyrics: 'clean_only', soundFocus: 'classic_wedding' }
          },
          {
            id: 'dinner',
            label: 'Dinner',
            direction: 'Keep the energy polished and recognisable without taking over the room.',
            brief: { intention: 'wedding', energyJourney: 'build', audience: 'all_ages', setting: 'wedding', lyrics: 'clean_only', soundFocus: 'classic_wedding' }
          },
          {
            id: 'dancefloor',
            label: 'Dancefloor',
            direction: 'Lead with reception-safe favourites, then build into stronger singalongs.',
            brief: { intention: 'wedding', energyJourney: 'stay_up', audience: 'all_ages', setting: 'wedding', lyrics: 'clean_only', soundFocus: 'classic_wedding' }
          }
        ]
      }
    });
