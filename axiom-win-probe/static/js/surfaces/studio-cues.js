    // Studio Matching Songs interaction, AXIOM cues, and guarded Serato cue handoff.
    function shouldShowMatchingAnchorIntro() {
      const forcedReview = ['127.0.0.1', 'localhost'].includes(window.location.hostname)
        && new URLSearchParams(window.location.search).get('matching_intro') === '1';
      const version = String(document.getElementById('release-splash-version')?.textContent || 'current').trim();
      return forcedReview || localStorage.getItem(`${MATCHING_ANCHOR_INTRO_KEY}:${version}`) !== 'true';
    }

    function prepareMatchingSongsAnchorIntro(active = false) {
      const modal = document.getElementById('replacement-modal');
      matchingAnchorIntroActive = Boolean(active);
      // The walkthrough may call attention to Current Song, but it must never
      // block the already-selected anchor or the first suggestion request.
      modal?.classList.remove('anchor-intro-pending', 'anchor-intro-revealed');
    }

    async function revealMatchingSongsAnchorIntro() {
      if (!matchingAnchorIntroActive) return;
      matchingAnchorIntroActive = false;
      const version = String(document.getElementById('release-splash-version')?.textContent || 'current').trim();
      localStorage.setItem(`${MATCHING_ANCHOR_INTRO_KEY}:${version}`, 'true');
      const modal = document.getElementById('replacement-modal');
      const listEl = document.getElementById('modal-suggestions-list');
      const countEl = document.getElementById('modal-results-count');
      modal?.classList.remove('anchor-intro-pending');
      modal?.classList.add('anchor-intro-revealed');
      if (countEl && !Array.isArray(window.lastSuggestions)) countEl.textContent = 'Finding matches...';
      setTimeout(() => modal?.classList.remove('anchor-intro-revealed'), 720);
      if (!Array.isArray(window.lastSuggestions) || window.lastSuggestions.length === 0) {
        if (listEl) listEl.innerHTML = '';
        await fetchSuggestions(false, { selectFirst: false, progressiveReveal: true });
      }
    }

    function openModal(index) {
      const targetList = getActiveSetList();
      const track = targetList[index];

      let manualIndex = currentPlaylist.findIndex(t => t.path === track.path);
      if (manualIndex === -1) manualIndex = index;

      modalTargetIndex = manualIndex;
      modalInsertionIndex = manualIndex + 1;
      modalOffset = 0;
      modalSuggestionRotationStep = 0;
      document.getElementById('modal-search').value = '';
      const brief = setBriefPayload();
      const eraSelect = document.getElementById('mod-era');
      if (brief.enabled && eraSelect && eraSelect.value === 'All') eraSelect.value = brief.era;
      const intentOptions = anchorIntentOptions(brief);
      modalIntentLane = intentOptions.some(([key]) => key === activeLibraryBriefLane)
        ? activeLibraryBriefLane
        : (intentOptions[0]?.[0] || 'best');
      currentAnchorTrack = normalizeModalTrackMetadata({ ...(trackVisualCache.get(track.path) || {}), path: track.path, title: track.title, artist: track.artist, bpm: track.bpm, camelot: track.camelot || track.key_raw, energy: track.energy, genre: track.genre || '' });
      updateAnchorHero(currentAnchorTrack);
      loadModalAnchorCues(track.path);
      updateLiveTransitionPanel(null);
      const modal = document.getElementById('replacement-modal');
      document.getElementById('btn-action-add').classList.remove('hidden');
      document.getElementById('btn-action-replace').classList.remove('hidden');
      modal.classList.remove('hidden');
      syncModifierMenu();
      renderModalSuggestionDecisionState();
      setTimeout(() => modal.classList.remove('opacity-0'), 10);
      const introduceAnchor = shouldShowMatchingAnchorIntro();
      prepareMatchingSongsAnchorIntro(introduceAnchor);
      fetchSuggestions(false, { selectFirst: false, progressiveReveal: introduceAnchor });
      setHelpButtonAttention('btn-matching-guide', smartListGuideStorageKey(), true);
    }

    function closeModal() {
      const modal = document.getElementById('replacement-modal');
      clearTimeout(matchingResultsRevealTimer);
      matchingAnchorIntroActive = false;
      modal.classList.remove('anchor-intro-pending', 'anchor-intro-revealed');
      document.getElementById('modal-suggestions-list')?.classList.remove('anchor-results-entering');
      modal.classList.add('opacity-0');
      setTimeout(() => modal.classList.add('hidden'), 300);
      closeWorkflowGuide('smart-list-guide-popover');
      const mAudio = document.getElementById('modal-player');
      mAudio.pause();
      mAudio.onerror = null;
      mAudio.src = '';
      if (nativePlayerState.deck === 'modal') {
        nativeAudioRequest('/api/audio/stop').catch(() => {});
      }
      document.getElementById('modal-play-icon').classList.remove('hidden');
      document.getElementById('modal-pause-icon').classList.add('hidden');
      selectedSuggestionData = null;
      clearActiveModifiers({ refresh: false, announce: false });
    }

    async function toggleModalPlay() {
      if (!nativePlayerState.has_track || playerToggleCommandPending) return false;
      playerToggleCommandPending = true;
      try {
        const shouldPlay = !Boolean(nativeTransportPending?.playing ?? nativePlayerState.playing);
        const transportToken = beginNativeTransportCommand(shouldPlay);
        if (!shouldPlay) {
          await nativeAudioRequest('/api/audio/pause', {}, { transportToken });
        } else {
          await nativeAudioRequest('/api/audio/resume', {}, { transportToken });
          startNativePlayerPolling();
        }
        return true;
      } catch (err) {
        showToast(`Preview control failed: ${err.message}`, true);
        return false;
      } finally {
        playerToggleCommandPending = false;
        syncMainPlayerControls();
      }
    }

    async function skipModalAudio(seconds) {
      return skipAudioRelative(seconds);
    }

    async function playAndSelectSuggestion(e, index, path, title, artist, bpm, camelot, energy, genre = '', year = '') {
      if (e) e.stopPropagation();
      const requestToken = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      window.__axiomLatestModalPreviewToken = requestToken;
      const row = document.getElementById(`sugg-${index}`);
      setFocusDeckSelection(row, '#modal-suggestions-list', { activeSuggestion: true });
      const cachedTrack = trackVisualCache.get(path) || {};
      selectedSuggestionData = normalizeModalTrackMetadata({ ...cachedTrack, path, title, artist, bpm, camelot, energy, genre, year });
      cacheTrackVisual(selectedSuggestionData);
      renderAnchorTransitionBoard(currentAnchorTrack || {}, window.lastSuggestions || []);
      updateLiveTransitionPanel(selectedSuggestionData);
      // Load sidecar cues for this track into the modal UI
      loadModalCues(path);
      nativeEndedHandledForPath = '';
      document.getElementById('modal-play-icon').classList.add('hidden');
      document.getElementById('modal-pause-icon').classList.remove('hidden');
      previewedTracks.add(path);
      if (row) row.classList.add('played');
      const transportToken = beginNativeTransportCommand(true, {
        has_track: true,
        path,
        deck: 'modal',
        ended: false,
        current_time: 0,
      });
      nativeAudioRequest('/api/audio/play', { path, title, artist, deck: 'modal' }, { transportToken })
        .then(() => {
          if (window.__axiomLatestModalPreviewToken !== requestToken) return;
          startNativePlayerPolling();
        })
        .catch((err) => {
          if (window.__axiomLatestModalPreviewToken !== requestToken) return;
          console.error(`[AXIOM] Native modal preview failed for "${title}" | path: ${path}`, err);
          if (handleBrowserFolderPlaybackError(err, title)) return;
          const errMessage = String(err?.message || '');
          if (/play\(\) request was interrupted|interrupted by a call to pause|interrupted by a new load request|superseded/i.test(errMessage)) {
            console.warn(`[AXIOM] Ignored interrupted modal preview request for "${title}"`);
            return;
          }
          showToast(`Cannot preview audio: "${title}" — ${err.message}`, true);
        });
    }

    function resetAndFetchSuggestions() {
      modalOffset = 0;
      fetchSuggestions(false);
    }

    // ===== Modal Cues: Load, render, add, save =====
    let modalCues = [];
    let modalCurrentTrackPath = null;
    let modalCueSource = 'fallback';

    function fmtTime(ms) {
      const s = Math.floor(ms / 1000);
      const m = Math.floor(s / 60);
      const sec = s % 60;
      return `${m}:${sec.toString().padStart(2,'0')}`;
    }

    async function loadModalCues(trackPath) {
      modalCurrentTrackPath = trackPath;
      modalCues = [];
      modalCueSource = 'fallback';
      try {
        const resp = await fetch(`/api/cues/get?path=${encodeURIComponent(trackPath)}`);
        if (resp.ok) {
          const data = await resp.json();
          modalCues = data.cues || [];
          modalCueSource = data.cue_source || (modalCues.length ? 'axiom' : 'fallback');
        }
      } catch (e) {
        console.warn('Failed to load cues', e);
      }
      renderModalCues();
      updateLiveTransitionPanel(selectedSuggestionData);
    }

    function renderModalCues() {
      renderAnchorTransitionBoard(currentAnchorTrack || {}, window.lastSuggestions || []);
    }

    function jumpModalCue(index) {
      const activeTrack = currentAnchorTrack || {};
      const slots = modalDisplayCueSlots(modalAnchorCues, activeTrack, modalAnchorCueSource);
      const cue = slots[index];
      if (!cue || !activeTrack?.path) return;

      const playAnchorCue = async () => {
        try {
          await nativeAudioRequest('/api/audio/play', {
            path: activeTrack.path,
            title: activeTrack.title || 'Anchor',
            artist: activeTrack.artist || '',
            deck: 'modal',
            start_time: (cue.time_ms || 0) / 1000
          });
          startNativePlayerPolling();
        } catch (err) {
          if (handleBrowserFolderPlaybackError(err, activeTrack.title || 'Anchor')) return;
          showToast(`Cannot load Set Starter audio: "${activeTrack.title || 'Set Starter'}"`, true);
          return;
        }
        document.getElementById('modal-play-icon').classList.add('hidden');
        document.getElementById('modal-pause-icon').classList.remove('hidden');
      };

      playAnchorCue();
    }

    async function saveAnchorCuesToAxiom(message = 'CUE POINTS SAVED IN AXIOM', { allowEmpty = false } = {}) {
      if (!currentAnchorTrack?.path) return showToast('Choose a track first.', true);
      const payload = {
        path: currentAnchorTrack.path,
        cues: allowEmpty && !modalAnchorCues.length ? [] : axiomCuePayload(modalAnchorCues, currentAnchorTrack)
      };
      try {
        const resp = await fetch('/api/cues/save', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) return showToast(data.error || 'Cue points could not be saved.', true);
        modalAnchorCues = data.cues || [];
        modalAnchorCueSource = modalAnchorCues.length ? 'axiom' : 'fallback';
        renderModalCues();
        showToast(message);
      } catch (error) {
        showToast('Cue points could not be saved.', true);
      }
    }

    async function previewSeratoCuePublish(triggerBtn = null) {
      if (!currentAnchorTrack?.path) return showToast('Choose a Matching Songs anchor first.', true);
      if (modalAnchorCueSource !== 'axiom') return showToast('Save an editable AXIOM cue set first.', true);
      if (!/\.mp3$/i.test(String(currentAnchorTrack.path))) {
        return showToast('Serato cue publishing is currently protected to MP3 files only.', true);
      }
      if (!(await ensureAxiomLicenseUsable('Serato cue publish'))) return;
      setAxiomButtonBusy(triggerBtn, true, 'Checking...');
      try {
        const response = await fetch('/api/cues/publish/preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: currentAnchorTrack.path })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) throw new Error(data.error || 'Serato cue preview failed');
        latestSeratoCuePublishState = data;
        const item = data.item || {};
        if (item.status === 'already_current') {
          showToast('SERATO CUES ALREADY MATCH AXIOM');
          return;
        }
        if (!['publish_ready', 'conflict'].includes(item.status)) {
          throw new Error(item.reason || 'This track is not safe for Serato cue publishing.');
        }
        const conflict = item.status === 'conflict';
        const currentCount = Array.isArray(item.current_cues) ? item.current_cues.length : 0;
        const nextCount = Array.isArray(item.axiom_cues) ? item.axiom_cues.length : 0;
        const typed = await showAxiomTextPrompt({
          kicker: 'Serato Cue Handoff',
          title: conflict ? 'Replace Existing Serato Cues' : 'Publish AXIOM Cues To Serato',
          copy: conflict
            ? `Fully quit Serato DJ Pro and djay Pro first. This MP3 already has ${currentCount} different Serato cue point${currentCount === 1 ? '' : 's'}. AXIOM will replace only those cue slots with your ${nextCount} reviewed AXIOM cues, preserve non-cue Serato metadata, create a full backup, and verify the audio stream. Type PUBLISH AXIOM CUES TO SERATO to continue.`
            : `Fully quit Serato DJ Pro and djay Pro first. AXIOM will add ${nextCount} reviewed cue point${nextCount === 1 ? '' : 's'} to this MP3, preserve non-cue Serato metadata, create a full backup, and verify the audio stream. Type PUBLISH AXIOM CUES TO SERATO to continue.`,
          defaultValue: '', placeholder: 'PUBLISH AXIOM CUES TO SERATO', confirmText: 'Publish Cues'
        });
        if (!typed) return;
        if (typed !== 'PUBLISH AXIOM CUES TO SERATO') return showToast('Confirmation did not match. No cue tags changed.', true);
        setAxiomButtonBusy(triggerBtn, true, 'Publishing...');
        const applyResponse = await fetch('/api/cues/publish/apply', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmation: typed, include_conflict: conflict })
        });
        const applied = await applyResponse.json().catch(() => ({}));
        if (!applyResponse.ok || applied.success === false) throw new Error(applied.error || 'Serato cue publish failed');
        latestSeratoCuePublishState = applied;
        updateModalCueHeader();
        showToast(`${nextCount} AXIOM CUE POINT${nextCount === 1 ? '' : 'S'} PUBLISHED TO THE MP3. RELOAD IT IN SERATO.`);
      } catch (error) {
        showToast(error.message || 'Serato cue publish paused safely.', true);
      } finally {
        setAxiomButtonBusy(triggerBtn, false);
      }
    }

    async function rollbackSeratoCuePublish(triggerBtn = null) {
      const typed = await showAxiomTextPrompt({
        kicker: 'Serato Cue Rollback', title: 'Restore Previous Cue Tags',
        copy: 'Fully quit Serato DJ Pro and djay Pro first. AXIOM will restore the exact MP3 backup from before the latest cue publish. Type ROLL BACK SERATO CUES to continue.',
        defaultValue: '', placeholder: 'ROLL BACK SERATO CUES', confirmText: 'Roll Back Cues'
      });
      if (!typed) return;
      if (typed !== 'ROLL BACK SERATO CUES') return showToast('Confirmation did not match. Nothing changed.', true);
      setAxiomButtonBusy(triggerBtn, true, 'Rolling Back...');
      try {
        const response = await fetch('/api/cues/publish/rollback', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmation: typed })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) throw new Error(data.error || 'Serato cue rollback failed');
        latestSeratoCuePublishState = data;
        updateModalCueHeader();
        showToast('PREVIOUS SERATO CUE TAGS RESTORED. RELOAD THE TRACK IN SERATO.');
      } catch (error) {
        showToast(error.message || 'Serato cue rollback paused safely.', true);
      } finally {
        setAxiomButtonBusy(triggerBtn, false);
      }
    }

    function copyDisplayedCuesToAxiom() {
      modalAnchorCues = axiomCuePayload(modalAnchorCues, currentAnchorTrack || {});
      modalAnchorCueSource = 'axiom';
      saveAnchorCuesToAxiom(`${modalAnchorCues.length} CUE POINT${modalAnchorCues.length === 1 ? '' : 'S'} SAVED IN AXIOM`);
    }

    function setModalAnchorCue(ev, index) {
      ev?.preventDefault();
      ev?.stopPropagation();
      const slots = axiomCuePayload(modalAnchorCues, currentAnchorTrack || {});
      const anchorPath = String(currentAnchorTrack?.path || '');
      const isAnchorPreview = String(nativePlayerState.path || '') === anchorPath;
      const currentMs = isAnchorPreview
        ? Math.max(0, Math.round(Number(nativePlayerState.current_time || 0) * 1000))
        : Number(slots[index]?.time_ms || 0);
      slots[index] = {
        ...(slots[index] || {}),
        label: slots[index]?.label || `CUE ${index + 1}`,
        time_ms: currentMs,
        color: slots[index]?.color || MODAL_CUE_COLORS[index],
        type: slots[index]?.type || 'Hot Cue',
        source: 'axiom',
        source_label: 'AXIOM'
      };
      modalAnchorCues = slots.slice(0, 4);
      modalAnchorCueSource = 'axiom';
      saveAnchorCuesToAxiom(`${slots[index].label} SET AT ${cueTimeLabel(slots[index])}`);
    }

    function renameModalAnchorCue(ev, index) {
      ev?.preventDefault();
      ev?.stopPropagation();
      if (modalAnchorCueSource !== 'axiom') return;
      const cue = modalAnchorCues[index];
      if (!cue) return;
      const nextLabel = window.prompt('Name this cue point', String(cue.label || `CUE ${index + 1}`));
      if (nextLabel === null) return;
      const normalizedLabel = nextLabel.trim().slice(0, 32);
      if (!normalizedLabel) return showToast('Cue name cannot be empty.', true);
      modalAnchorCues[index] = {
        ...cue,
        label: normalizedLabel,
        source: 'axiom',
        source_label: 'AXIOM'
      };
      saveAnchorCuesToAxiom(`CUE NAMED ${normalizedLabel}`);
    }

    function deleteModalCue(ev, index) {
      ev.preventDefault();
      ev.stopPropagation();
      if (isImportedDjCueSource(modalAnchorCueSource)) return;
      modalAnchorCues.splice(index, 1);
      if (!modalAnchorCues.length) modalAnchorCueSource = 'fallback';
      saveAnchorCuesToAxiom('CUE POINT REMOVED FROM AXIOM', { allowEmpty: true });
    }

    function addModalCue() {
      const label = document.getElementById('modal-new-cue-label').value.trim();
      const time_ms = Math.max(0, Math.floor((nativePlayerState.current_time || 0) * 1000));
      modalCues.push({ time_ms, label: label || `CUE ${modalCues.length + 1}` });
      renderModalCues();
    }

    async function saveModalCues() {
      const saves = [];
      if (currentAnchorTrack?.path && !isImportedDjCueSource(modalAnchorCueSource)) {
        saves.push({ path: currentAnchorTrack.path, cues: axiomCuePayload(modalAnchorCues, currentAnchorTrack) });
      }
      if (modalCurrentTrackPath && !isImportedDjCueSource(modalCueSource)) {
        saves.push({ path: modalCurrentTrackPath, cues: axiomCuePayload(modalCues, selectedSuggestionData || {}) });
      }
      if (!saves.length) return showToast('DJ SOFTWARE CUES ARE DISPLAYED READ-ONLY IN AXIOM');
      try {
        for (const payload of saves) {
          const resp = await fetch('/api/cues/save', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (!resp.ok) {
            const err = await resp.json().catch(()=>({}));
            return showToast(err.error || 'Failed to save cues', true);
          }
        }
        showToast('CUE POINTS SAVED IN AXIOM');
      } catch (e) {
        showToast('Failed to save cues', true);
      }
    }

    async function saveSelectedSuggestionForLater() {
      const track = normalizeModalTrackMetadata(selectedSuggestionData || {});
      if (!track.path) {
        showToast('Choose a matching song first.', true);
        return;
      }
      if (favoritesHasTrack(track)) {
        showToast(`Already saved for later: ${track.title || 'Matching song'}`, true);
        return;
      }
      await addToFavorites(track);
      const button = document.getElementById('modal-save-for-later-btn');
      if (button) {
        button.textContent = 'Saved For Later';
        button.classList.add('active');
      }
    }

    // ===== Backups modal =====
    function openBackupsModal() {
      const modal = document.getElementById('backups-modal');
      modal.classList.remove('hidden');
      if (!modal.open && typeof modal.showModal === 'function') modal.showModal();
      setTimeout(() => modal.classList.remove('opacity-0'), 10);
    }

    function closeBackupsModal() {
      const modal = document.getElementById('backups-modal');
      modal.classList.add('opacity-0');
      if (modal.open && typeof modal.close === 'function') modal.close();
      modal.classList.add('hidden');
    }

    window.openBackupsModal = openBackupsModal;
    window.closeBackupsModal = closeBackupsModal;
    document.getElementById('backups-modal')?.addEventListener('close', event => {
      event.currentTarget.classList.add('opacity-0', 'hidden');
    });

    function exportIntelligencePack() {
      if (!axiomLicenseState?.usable && axiomLicenseState?.required) {
        openLicenseModal({ ...axiomLicenseState, message: 'Activate AXIOM before exporting intelligence packs.' }, true);
        return;
      }
      window.open('/api/intelligence/export', '_blank', 'noopener');
      showToast('AXIOM intelligence export started. Music files are not included.');
    }

    async function importIntelligencePack(input) {
      const file = input?.files?.[0];
      if (!file) return;
      const form = new FormData();
      form.append('file', file);
      showToast('Importing AXIOM intelligence pack...');
      try {
        const resp = await fetch('/api/intelligence/import', {
          method: 'POST',
          body: form
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.success === false) {
          throw new Error(data.error || 'Import failed');
        }
        updateLibraryCount(data.total_tracks || 0);
        setLibraryConnectionState(data.total_tracks || 0);
        showToast(data.message || 'AXIOM intelligence imported.');
        if (data.missing_paths > 0) {
          showToast(`${data.missing_paths} imported track paths need relocation on this Mac.`, true);
        }
        runSearch();
      } catch (err) {
        showToast(err.message || 'Import failed.', true);
      } finally {
        if (input) input.value = '';
      }
    }

    async function loadBackupsForSelected() {
      const sel = document.getElementById('backup-target-file');
      const fname = sel.value;
      const listEl = document.getElementById('backups-list');
      listEl.innerHTML = '<div class="spinner" style="width:24px;height:24px;border-width:3px"></div>';
      try {
        const resp = await fetch(`/api/backups/list?file=${encodeURIComponent(fname)}`);
        if (!resp.ok) {
          const err = await resp.json().catch(()=>({}));
          listEl.innerHTML = `<div class="text-red-400">${err.error || 'Failed to list backups'}</div>`;
          return;
        }
        const data = await resp.json();
        const backups = data.backups || [];
        if (backups.length === 0) {
          listEl.innerHTML = '<div class="text-white/40">No backups found.</div>';
          return;
        }
        listEl.innerHTML = '';
        backups.forEach(b => {
          const row = document.createElement('div');
          row.style.display = 'flex'; row.style.justifyContent = 'space-between'; row.style.alignItems = 'center';
          row.style.padding = '8px 0';
          const nameSpan = document.createElement('span');
          nameSpan.style.color = '#ddd'; nameSpan.innerText = b.replace(/^.*\//, '');
          const btn = document.createElement('button');
          btn.className = 'px-3 py-1 rounded bg-red-600 text-white/90';
          btn.innerText = 'Restore';
          btn.onclick = async () => {
            if (!confirm('Restore this backup? This will overwrite current file.')) return;
            try {
              const res = await fetch('/api/backups/restore', {
                method: 'POST', headers: { 'Content-Type':'application/json' },
                body: JSON.stringify({ file: fname, backup: nameSpan.innerText })
              });
              const jr = await res.json().catch(()=>({}));
              if (!res.ok) return showToast(jr.error || 'Restore failed', true);
              showToast('Restore successful');
              closeBackupsModal();
            } catch (e) {
              showToast('Restore failed', true);
            }
          };
          row.appendChild(nameSpan);
          row.appendChild(btn);
          listEl.appendChild(row);
        });
      } catch (e) {
        listEl.innerHTML = `<div class="text-red-400">${e.message}</div>`;
      }
    }

    function handleModifierMenu(value) {
      const menu = document.getElementById('mod-action-menu');
      if (value === 'clear_modifiers') {
        clearActiveModifiers();
      } else if (value) {
        toggleModifier(value);
      }
      if (menu) menu.value = '';
    }

    function clearActiveModifiers(options = {}) {
      const { refresh = true, announce = true } = options;
      const active = Object.keys(activeModifiers).filter(key => activeModifiers[key]);
      active.forEach(key => {
        activeModifiers[key] = false;
        syncModifierButton(key);
      });
      syncModifierMenu();
      if (refresh && active.length) resetAndFetchSuggestions();
      if (announce && active.length) showToast('Mix Tools cleared.');
    }

    function toggleModifier(mod) {
      activeModifiers[mod] = !activeModifiers[mod];

      if (activeModifiers[mod] && mod === 'mood_lift') {
        activeModifiers.mood_drop = false;
        syncModifierButton('mood_drop');
      }
      if (activeModifiers[mod] && mod === 'mood_drop') {
        activeModifiers.mood_lift = false;
        syncModifierButton('mood_lift');
      }

      syncModifierButton(mod);
      syncModifierMenu();
      resetAndFetchSuggestions();
    }

    function syncModifierButton(mod) {
      const btn = document.getElementById(`mod-${mod}`);
      if (!btn) return;
      if (activeModifiers[mod]) {
        btn.classList.add('bg-axiom-accent/20', 'text-axiom-accent', 'border-axiom-accent');
      } else {
        btn.classList.remove('bg-axiom-accent/20', 'text-axiom-accent', 'border-axiom-accent');
      }
    }

    function syncModifierMenu() {
      const menu = document.getElementById('mod-action-menu');
      if (!menu) return;
      const active = Object.entries(activeModifiers)
        .filter(([_, enabled]) => enabled)
        .map(([key]) => key);
      const label = menu.querySelector('option[value=""]');
      const clear = menu.querySelector('option[value="clear_modifiers"]');
      const labels = {
        mood_lift: 'Lift',
        mood_drop: 'Drop',
        bpm_half: '1/2 BPM',
        bpm_double: '2x BPM',
        key_shift: 'Key Shift'
      };
      if (label) label.textContent = active.length ? `Mix Tools (${active.length} active)` : 'Mix Tools';
      if (clear) clear.disabled = active.length === 0;
      Object.entries(labels).forEach(([key, text]) => {
        const option = menu.querySelector(`option[value="${key}"]`);
        if (option) option.textContent = activeModifiers[key] ? `${text} - On` : text;
      });
      menu.classList.toggle('bg-axiom-accent/20', active.length > 0);
      menu.classList.toggle('text-axiom-accent', active.length > 0);
      menu.classList.toggle('border-axiom-accent', active.length > 0);
    }

    function selectSuggestion(i) {
      const dataIndex = i >= window.lastSuggestions.length ? i - modalOffset : i;
      const nextSuggestion = window.lastSuggestions[dataIndex] || window.lastSuggestions[0];
      if (!nextSuggestion) return;
      selectedSuggestionData = normalizeModalTrackMetadata({ ...(trackVisualCache.get(nextSuggestion.path) || {}), ...nextSuggestion });
      cacheTrackVisual(selectedSuggestionData);
      updateLiveTransitionPanel(selectedSuggestionData);
      document.querySelectorAll('#modal-suggestions-list .sugg-row, #modal-suggestions-list .anchor-suggestion-row').forEach(r => {
        r.classList.remove('border-axiom-accent');
        r.classList.add('border-white/10');
      });
      const activeRow = document.getElementById(`sugg-${i}`);
      if (activeRow) {
        setFocusDeckSelection(activeRow, '#modal-suggestions-list', { activeSuggestion: true });
        activeRow.classList.remove('border-white/10');
      }
      renderAnchorTransitionBoard(currentAnchorTrack || {}, window.lastSuggestions || []);
      document.querySelectorAll('#btn-action-replace, #btn-action-before, #btn-action-after').forEach(b => {
        b.disabled = false;
        b.classList.remove('opacity-50', 'cursor-not-allowed');
        b.classList.replace('bg-white/5', 'bg-axiom-accent');
        b.classList.replace('text-white/20', 'text-black');
      });
    }

    async function fetchSuggestions(append = false, options = {}) {
      const requestId = ++modalSuggestionRequestId;
      const listEl = document.getElementById('modal-suggestions-list');
      const preservedScrollTop = options.preserveScroll ? listEl.scrollTop : 0;
      if (!append) {
        document.getElementById('modal-spinner').classList.remove('hidden');
        listEl.innerHTML = '';
        const loadBtn = document.getElementById('modal-load-more');
        if (loadBtn) loadBtn.remove();
      } else {
        const loadBtn = document.getElementById('modal-load-more');
        if (loadBtn) loadBtn.innerText = 'Loading...';
      }
      const count = parseInt(document.getElementById('mod-count').value || 50);
      const modalBrief = setBriefRuntimePayload();
      const needsIntentRank = modalBrief.enabled && Boolean(modalIntentLane);
      const needsClientSort = Boolean(modalRootFilter) || modalSuggestionSort !== 'transition' || needsIntentRank;
      const requestedCount = needsClientSort ? Math.max(count * 6, 100) : count;
      const era = document.getElementById('mod-era').value || "All";
      try {
        const requestModifiers = {
          ...activeModifiers,
          bpm_window: Number(document.getElementById('mod-bpm-window')?.value || 3)
        };
        const modalBody = {
          anchor: currentAnchorTrack || currentPlaylist[modalTargetIndex],
          modifiers: requestModifiers,
          set_brief: modalBrief,
          limit: requestedCount,
          offset: modalOffset,
          era: era,
          blacklist: [
            ...getUsedTrackBlacklist([currentAnchorTrack || currentPlaylist[modalTargetIndex]]),
            ...modalSkippedSuggestionPaths
          ]
        };
        if (modalRootFilter && modalRootFilter !== "") modalBody.dna_root = modalRootFilter;
        const resp = await fetch('/api/studio/suggestions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(modalBody)
        });
        const data = await resp.json();
        if (requestId !== modalSuggestionRequestId) return;
        let items = (data.suggestions || [])
          .map(normalizeModalTrackMetadata)
          .filter(item => modalBpmValue(item) && modalSuggestionIsAllowed(item) && !modalSkippedSuggestionPaths.has(item.path));
        let total = data.total || 0;

        // Client-side root filter using dna_pillar (server field) with genre as fallback
        if (modalRootFilter && modalRootFilter !== '') {
          items = filterByRoot(items, modalRootFilter);
          total = items.length;
        }

        items = rankModalSuggestionsByIntent(items, modalBrief);
        items = sortModalSuggestions(items);
        if (!append) {
          const lockedItems = currentLockedModalSuggestions();
          const lockedPaths = new Set(lockedItems.map(track => track.path));
          items = items.filter(track => !lockedPaths.has(track.path));
          if (options.softRotate) items = softlyRotateModalSuggestions(items, options.softRotate);
          items = [...lockedItems, ...items];
        }
        items = items.slice(0, count);

        if (items.length === 0 && !append) {
          const usedHint = modalShowUsedTracks ? '' : '<br><span class="text-[10px] text-white/35">Used Studio tracks are hidden. Use Show Used if you want to inspect duplicates.</span>';
          listEl.innerHTML = `<p class="text-axiom-muted font-bold text-center mt-10 text-sm uppercase">No ${modalRootFilter || ''} matches found${usedHint}</p>`;
          const countEl = document.getElementById('modal-results-count');
          if (countEl) countEl.innerText = '0 results';
          window.lastSuggestions = [];
          renderAnchorTransitionBoard(currentAnchorTrack || {}, []);
        } else {
          const progressiveReveal = !append && Boolean(options.progressiveReveal);
          const htmlStr = items.map((s, i) => {
            s = normalizeModalTrackMetadata(s);
            cacheTrackVisual(s);
            const isPlayed = previewedTracks.has(`${window.location.origin}/api/library/stream?path=${encodeURIComponent(s.path)}`);
            const keyClass = camelotClass(s.camelot);
            const match = modalSuggestionMatch(s);
            const root = modalRootName(s);
            const isLocked = modalLockedSuggestions.has(s.path);
            const tags = [isLocked ? 'Kept' : '', s.axiom_role || '', root, s.era || formatTrackYear(s), s.genre || '', modalTrackEnergy(s)].filter(Boolean).slice(0, 3);
            const safePath = escapeJs(s.path);
            const safeTitle = escapeJs(s.title);
            const safeArtist = escapeJs(s.artist);
            const safeCamelot = escapeJs(s.camelot || '');
            const safeEnergy = escapeJs(s.energy || '');
            const safeGenre = escapeJs(s.genre || '');
            const safeYear = escapeJs(s.year || s.release_year || '');
            return `
                    <div onclick="playAndSelectSuggestion(event, ${i + modalOffset}, '${safePath}', '${safeTitle}', '${safeArtist}', ${s.bpm || 0}, '${safeCamelot}', '${safeEnergy}', '${safeGenre}', '${safeYear}')" id="sugg-${i + modalOffset}" class="vampire-row anchor-suggestion-row axiom-focus-deck-row ${progressiveReveal ? 'anchor-result-reveal' : ''} ${isPlayed ? 'played' : ''} ${isLocked ? 'locked-suggestion' : ''}" ${progressiveReveal ? `style="--anchor-reveal-delay:${i * 65}ms"` : ''} data-path="${escapeHtml(s.path)}" tabindex="0" onkeydown="activateFocusDeckRow(event)">
                        ${renderFocusDeckMarker()}
                        <button onclick="playAndSelectSuggestion(event, ${i + modalOffset}, '${safePath}', '${safeTitle}', '${safeArtist}', ${s.bpm || 0}, '${safeCamelot}', '${safeEnergy}', '${safeGenre}', '${safeYear}')" class="anchor-suggestion-play" type="button" title="Preview suggestion">
                          <svg class="w-3 h-3 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                        </button>
                        ${renderModalArtwork(s, 'anchor-suggestion-art')}
                        <div class="min-w-0">
                          <p class="anchor-suggestion-title">${escapeHtml(s.title || 'Unknown Title')}</p>
                          <p class="anchor-suggestion-artist">${escapeHtml(s.artist || 'Unknown Artist')}</p>
                          <div class="anchor-suggestion-tags">
                            ${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}
                          </div>
                          ${renderTrackRoleEvidence(s)}
                        </div>
                        <div class="anchor-suggestion-metric anchor-suggestion-bpm">
                          <strong class="cursor-pointer" onclick="event.stopPropagation(); promptSetBpm('${safePath}', ${s.bpm || 0})" aria-label="Click to edit BPM">${s.bpm ? Math.round(parseFloat(s.bpm)) : '--'}</strong>
                          <span>BPM</span>
                          <div class="anchor-suggestion-bpm-tools">
                            ${s.bpm ? `
                              <button onclick="event.stopPropagation(); adjustBpm('${safePath}', ${s.bpm}, 'half')" title="Halve BPM">Half</button>
                              <button onclick="event.stopPropagation(); adjustBpm('${safePath}', ${s.bpm}, 'double')" title="Double BPM">Double</button>
                              <button onclick="event.stopPropagation(); promptSetBpm('${safePath}', ${s.bpm})" title="Edit BPM" style="border-color:rgba(255,255,255,0.3);">Edit</button>
                            ` : `
                              <button onclick="event.stopPropagation(); promptSetBpm('${safePath}', 0)" title="Set BPM" style="width:100%;border-color:rgba(234,179,8,0.5);color:#EAB308;">Set</button>
                            `}
                          </div>
                        </div>
                        <div class="anchor-suggestion-key">
                          <strong class="${keyClass}">${escapeHtml(s.camelot || '--')}</strong>
                          <span>Key</span>
                        </div>
                        <div class="anchor-suggestion-match">
                          <strong>${match.pct}</strong>
                          <span>${match.label}</span>
                        </div>
                        <button id="btn-add-${i + modalOffset}" onclick="event.stopPropagation(); selectedSuggestionData=normalizeModalTrackMetadata({...(trackVisualCache.get('${safePath}') || {}), path:'${safePath}',title:'${safeTitle}',artist:'${safeArtist}',bpm:${s.bpm || 0},camelot:'${safeCamelot}',energy:'${safeEnergy}',genre:'${safeGenre}',year:'${safeYear}'}); updateLiveTransitionPanel(selectedSuggestionData); executeModalAction('add_after_anchor'); triggerSilverFlash('btn-add-${i + modalOffset}')" class="anchor-suggestion-add" type="button">Add</button>
                        <div class="anchor-decision-actions">
                          <button onclick="toggleModalSuggestionLock(event, '${safePath}')" class="anchor-decision-btn ${isLocked ? 'active' : ''}" type="button" title="${isLocked ? 'Remove from kept matches' : 'Keep through matching-song refreshes'}">${isLocked ? 'Kept' : 'Keep'}</button>
                          <button onclick="skipModalSuggestion(event, '${safePath}')" class="anchor-decision-btn skip" type="button" title="Hide for this set">Hide</button>
                          <button onclick="event.stopPropagation(); toggleFavorite({path:'${safePath}',title:'${safeTitle}',artist:'${safeArtist}',bpm:${s.bpm || 0},camelot:'${safeCamelot}',energy:'${safeEnergy}',genre:'${safeGenre}'})" class="anchor-decision-btn ${favoritesHasTrack(s) ? 'active' : ''}" data-fav-path="${escapeHtml(s.path)}" title="${favoritesHasTrack(s) ? 'Remove from saved songs' : 'Save for later'}" type="button">${favoritesHasTrack(s) ? 'Saved' : 'Save'}</button>
                        </div>
                    </div>
                `;
          }).join('');
          if (append) {
            listEl.insertAdjacentHTML('beforeend', htmlStr);
            window.lastSuggestions = window.lastSuggestions.concat(items);
          } else {
            listEl.innerHTML = htmlStr;
            window.lastSuggestions = items;
          }
          if (progressiveReveal) {
            clearTimeout(matchingResultsRevealTimer);
            listEl.classList.remove('anchor-results-entering');
            void listEl.offsetWidth;
            listEl.classList.add('anchor-results-entering');
            matchingResultsRevealTimer = setTimeout(
              () => listEl.classList.remove('anchor-results-entering'),
              Math.min(items.length, 20) * 65 + 620
            );
          }
          renderAnchorTransitionBoard(currentAnchorTrack || {}, window.lastSuggestions || []);
          const countEl = document.getElementById('modal-results-count');
          if (countEl) {
            const intentLabel = anchorIntentOptions(modalBrief).find(([key]) => key === modalIntentLane)?.[1] || 'Best Fits';
            countEl.innerText = modalBrief.enabled
              ? `${items.length} ${intentLabel} result${items.length === 1 ? '' : 's'}`
              : `${items.length} result${items.length === 1 ? '' : 's'}`;
          }
          const loadBtn = document.getElementById('modal-load-more');
          if (loadBtn) loadBtn.remove();
          if (!modalRootFilter && modalSuggestionSort === 'transition' && modalOffset + count < total) {
            listEl.insertAdjacentHTML('beforeend', `
                        <button id="modal-load-more" onclick="modalOffset += ${count}; fetchSuggestions(true)" class="w-full py-4 mt-4 text-[10px] font-black uppercase tracking-widest text-white/50 border border-white/5 hover:bg-white/5 hover:text-white rounded-lg transition-all">Load More Tracks (${total - (modalOffset + count)} remaining)</button>
                    `);
          }
          if (!append && items.length > 0 && options.selectFirst !== false) {
            selectSuggestion(0);
          }
          renderModalSuggestionDecisionState();
          if (!append && options.preserveScroll) listEl.scrollTop = preservedScrollTop;
        }
      } finally {
        if (!append && requestId === modalSuggestionRequestId) document.getElementById('modal-spinner').classList.add('hidden');
      }
    }

    function setModalAnchorFromPlaylist(index) {
      const track = currentPlaylist[index];
      if (!track) return;
      modalTargetIndex = index;
      modalInsertionIndex = index + 1;
      currentAnchorTrack = normalizeModalTrackMetadata({
        ...(trackVisualCache.get(track.path) || {}),
        ...track,
        camelot: track.camelot || track.key_raw,
        genre: track.genre || ''
      });
      cacheTrackVisual(currentAnchorTrack);
    }

    async function executeModalAction(type) {
      if (!selectedSuggestionData) return;
      const selectedTrack = {
        ...selectedSuggestionData,
        genre: selectedSuggestionData.genre || ''
      };
      const selectedDecisionPath = selectedTrack.path;
      const ignoreIndex = type === 'replace' ? modalTargetIndex : -1;
      const duplicateIndex = currentPlaylist.findIndex((track, index) =>
        index !== ignoreIndex && trackIdentity(track) === trackIdentity(selectedTrack)
      );
      if (duplicateIndex !== -1) {
        showToast(`Already in set: ${selectedTrack.title}`, true);
        return;
      }
      saveHistory();
      const tName = selectedTrack.title;
      let newAnchorIndex = modalTargetIndex;
      let shouldClose = true;
      if (type === 'replace') {
        currentPlaylist[modalTargetIndex] = selectedTrack;
        newAnchorIndex = modalTargetIndex;
        showToast(`Replaced with ${tName}`);
      }
      else if (type === 'insert_before') {
        currentPlaylist.splice(modalTargetIndex, 0, selectedTrack);
        newAnchorIndex = modalTargetIndex;
        showToast(`Inserted ${tName} Before`);
      }
      else if (type === 'insert_after') {
        currentPlaylist.splice(modalTargetIndex + 1, 0, selectedTrack);
        newAnchorIndex = modalTargetIndex + 1;
        showToast(`Inserted ${tName} After`);
      }
      else if (type === 'add_after_anchor') {
        const insertAt = Math.max(modalTargetIndex + 1, 0);
        currentPlaylist.splice(insertAt, 0, selectedTrack);
        newAnchorIndex = insertAt;
        shouldClose = false;
        showToast(`Added ${tName}. It is now the Current Song.`);
      }
      const wasEmpty = currentPlaylist.length === 1 && (type === 'insert_before' || type === 'insert_after' || type === 'add_after_anchor');
      activeStudioView = 'manual';
      modalLockedSuggestions.delete(selectedDecisionPath);
      modalSkippedSuggestionPaths.delete(selectedDecisionPath);
      renderModalSuggestionDecisionState();
      syncEditingPlaylistIfNeeded();
      showStudioTrackAddedPulse(selectedTrack, currentPlaylist.length);
      if (wasEmpty) {
        document.getElementById('studio-start-view')?.classList.add('hidden');
        document.getElementById('studio-active-view')?.classList.remove('hidden');
      }
      if (shouldClose) {
        setModalAnchorFromPlaylist(newAnchorIndex);
        closeModal();
        showTab('studio');
      } else {
        setModalAnchorFromPlaylist(newAnchorIndex);
        updateAnchorHero(currentAnchorTrack);
        // Cue discovery may read slow external disks. Adding a song and
        // refreshing matches must not wait for that read-only lookup.
        loadModalAnchorCues(currentAnchorTrack.path);
        showTab('studio');
      }
      updateStudioToolsAvailability();
      recalculateAudit();
      if (!shouldClose) {
        selectedSuggestionData = null;
        updateLiveTransitionPanel(null);
        modalOffset = 0;
        modalSuggestionRotationStep += 1;
        fetchSuggestions(false, {
          selectFirst: false,
          softRotate: modalSuggestionRotationStep
        });
      }
    }
