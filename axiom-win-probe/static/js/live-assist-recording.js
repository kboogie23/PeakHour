// Live Assist recording, refinement controls, events, and native readiness.
    let recordingState = { status: 'idle', recording: false, elapsed_seconds: 0, signal_level: 0, signal: 'none' };
    let recordingSources = { applications: [], devices: [], source_mode: 'application', ready: false, error: '' };
    let recordingSourceMode = 'application';
    let recordingPreviewStarted = 0;
    let recordingControlBusy = false;
    let recordingPollInFlight = false;
    let recordingStateEpoch = 0;
    let recordingReceiptPath = '';
    let recordingObservedActiveThisWindow = false;
    let recordingSignalTest = null;

    function recordingMeterReading(peak) {
      if (typeof peak !== 'number' || !Number.isFinite(peak) || peak <= -60) {
        return { value: -60, percent: 0, text: 'No signal', signal: 'none' };
      }
      const value = Math.max(-60, Math.min(0, peak));
      return { value, percent: (value + 60) / 60 * 100, text: `${value.toFixed(1)} dBFS`, signal: value >= -1 ? 'clipping' : value >= -6 ? 'loud' : 'healthy' };
    }

    function renderRecordingMeter() {
      const meter = document.getElementById('record-signal-meter');
      if (!meter) return;
      const active = isSetRecordingActive();
      const tested = !active && recordingSignalTest && Date.now() < recordingSignalTest.expires;
      const peak = active ? recordingState.peak_dbfs : tested ? recordingSignalTest.peak : LIVE_ASSIST_PREVIEW_MODE ? -12.4 : null;
      const reading = recordingMeterReading(peak);
      meter.style.setProperty('--signal-percent', `${reading.percent}%`);
      meter.dataset.signal = reading.signal;
      meter.setAttribute('aria-valuenow', String(reading.value));
      meter.setAttribute('aria-valuetext', reading.text);
      document.getElementById('record-signal-value').textContent = reading.text;
      document.getElementById('record-signal-mode').textContent = LIVE_ASSIST_PREVIEW_MODE ? 'Demo peak' : tested ? 'Test peak' : 'Input peak';
    }

    function formatRecordingTime(seconds = 0) {
      const total = Math.max(0, Math.floor(Number(seconds) || 0));
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const secs = total % 60;
      return hours
        ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
        : `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    function activeRecordingProvider() {
      const provider = String(state.gigProfile?.live_provider || state.anchor?.raw?.live_provider || '').toLowerCase();
      if (provider.includes('djay')) return 'djay';
      if (provider.includes('serato')) return 'serato';
      return 'auto';
    }

    function isSetRecordingActive(payload = recordingState) {
      return Boolean(payload?.recording || payload?.status === 'recording' || payload?.status === 'stopping');
    }

    function renderRecordingControl() {
      renderRecordingMeter();
      const active = isSetRecordingActive();
      const elapsed = Number(recordingState.elapsed_seconds || 0);
      const level = Math.max(0, Math.min(1, Number(recordingState.signal_level || 0)));
      const activeBars = active ? Math.ceil(level * 5) : 0;
      setRecordButton.classList.toggle('recording', active);
      setRecordButton.classList.toggle('stopping', recordingState.status === 'stopping');
      setRecordButton.dataset.signal = recordingState.signal || 'none';
      setRecordButton.disabled = recordingControlBusy || recordingState.status === 'stopping';
      setRecordButton.setAttribute('aria-pressed', active ? 'true' : 'false');
      setRecordButton.setAttribute('aria-label', active ? 'Stop and save this DJ set recording' : 'Start recording this DJ set');
      setRecordTime.textContent = formatRecordingTime(elapsed);
      setRecordButton.querySelectorAll('.set-record-meter i').forEach((bar, index) => {
        bar.classList.toggle('active', index < activeBars);
      });
    }

    function recordingOptionsForMode(mode = recordingSourceMode) {
      if (mode === 'device') {
        return (recordingSources.devices || []).map(item => ({ id: item.name, label: item.name }));
      }
      return (recordingSources.applications || []).map(item => ({ id: item.bundle_id, label: item.name }));
    }

    function renderRecordingDrawer() {
      document.querySelectorAll('[data-record-source-mode]').forEach(button => {
        button.setAttribute('aria-pressed', button.dataset.recordSourceMode === recordingSourceMode ? 'true' : 'false');
      });
      const options = recordingOptionsForMode();
      const preferred = recordingSourceMode === recordingSources.source_mode ? recordingSources.selected_source_id : '';
      const previous = setRecordSource.value;
      setRecordSource.innerHTML = '';
      options.forEach(item => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.label;
        setRecordSource.appendChild(option);
      });
      if (!options.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = recordingSourceMode === 'application' ? 'Open Serato or djay Pro' : 'Connect a controller / interface';
        setRecordSource.appendChild(option);
      }
      if (options.some(item => item.id === previous)) setRecordSource.value = previous;
      else if (options.some(item => item.id === preferred)) setRecordSource.value = preferred;
      setRecordBroadcast.disabled = !recordingSources.broadcast_available;
      setRecordBroadcast.value = recordingSources.broadcast_enabled && recordingSources.broadcast_available ? 'on' : 'off';
      setRecordBroadcast.options[0].textContent = recordingSources.broadcast_available ? 'Off' : 'Broadcast driver needed';
      const ready = Boolean(setRecordSource.value);
      let message = '';
      if (recordingSourceMode === 'application') {
        message = ready
          ? `${setRecordSource.options[setRecordSource.selectedIndex]?.textContent || 'DJ software'} is selected. Test Signal checks Mac recording access before your set.`
          : (recordingSources.error || 'Open Serato or djay Pro. First use may require Screen & System Audio Recording access.');
      } else {
        message = ready
          ? `${setRecordSource.value} is ready. Play through the controller, then test the signal.`
          : 'Connect a controller Record, Mix or Master output. The MacBook microphone is excluded.';
      }
      if (ready && setRecordBroadcast.value === 'on') {
        message += ' The same clean feed will be available to streaming apps as AXIOM Broadcast.';
      } else if (recordingSources.broadcast_restart_required) {
        message += ' AXIOM Broadcast is installed but not active yet. Keep recording without Broadcast, finish any audio work, then restart your Mac when convenient.';
      } else if (!recordingSources.broadcast_available) {
        message += ' AXIOM Broadcast needs its macOS audio driver installed on this Mac.';
      }
      if (recordingState.status === 'failed' && recordingState.error) {
        const recoveryPath = String(recordingState.recovery_path || '').trim();
        message = recoveryPath
          ? `${recordingState.error} Recovery file: ${recoveryPath}`
          : recordingState.error;
      }
      setRecordReady.dataset.ready = ready ? 'true' : 'false';
      setRecordReady.textContent = message;
      setRecordReady.hidden = ready && recordingState.status !== 'failed' && recordingSources.broadcast_available;
      const saveDirectory = String(recordingSources.save_directory || '~/Desktop').trim() || '~/Desktop';
      setRecordSaveDirectory.textContent = saveDirectory;
      setRecordSaveDirectory.title = saveDirectory;
      setRecordStart.disabled = !ready || recordingControlBusy || isSetRecordingActive();
      setRecordTest.disabled = !ready || recordingControlBusy;
    }

    async function loadRecordingSources(mode = recordingSourceMode) {
      const provider = activeRecordingProvider();
      if (LIVE_ASSIST_PREVIEW_MODE) {
        recordingSources = {
          success: true,
          provider: provider === 'auto' ? 'serato' : provider,
          source_mode: recordingSourceMode,
          selected_source_id: recordingSourceMode === 'application' ? 'com.serato.seratodj' : 'DDJ-REV7 Record',
          applications: [
            { bundle_id: 'com.serato.seratodj', name: 'Serato DJ Pro' },
            { bundle_id: 'com.algoriddim.djay-pro-mac', name: 'djay Pro' },
          ],
          devices: [
            { name: 'DDJ-REV7 Record', recommended: true },
            { name: 'Club Mixer REC OUT', recommended: true },
          ],
          broadcast_available: true,
          broadcast_enabled: true,
          broadcast_device_name: 'AXIOM Broadcast',
          ready: true,
          format: setRecordFormat.value || 'wav',
          save_directory: '/Users/dj/Desktop',
          error: '',
        };
        renderRecordingDrawer();
        return recordingSources;
      }
      const params = new URLSearchParams({ provider, source_mode: mode });
      const response = await fetch(`/api/performance/recording/sources?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Recording sources could not be loaded');
      recordingSources = payload;
      recordingSourceMode = payload.source_mode === 'device' ? 'device' : 'application';
      setRecordFormat.value = payload.format === 'mp3' ? 'mp3' : 'wav';
      renderRecordingDrawer();
      return payload;
    }

    async function openRecordingDrawer() {
      if (performanceCoachRail) performanceCoachRail.hidden = true;
      setRecordReceipt.hidden = true;
      setRecordDrawer.hidden = false;
      document.body.classList.add('recording-drawer-open');
      setRecordReady.dataset.ready = 'false';
      setRecordReady.textContent = 'Checking safe recording sources...';
      try {
        const initialSources = await loadRecordingSources();
        if (initialSources?.source_mode === 'device' && !(initialSources.devices || []).length) {
          // A disconnected controller must not strand a saved device choice.
          // Fall back to the open DJ application's internal audio without
          // requesting microphone access or touching the recording engine.
          await loadRecordingSources('application');
        }
      } catch (error) {
        setRecordReady.textContent = error.message;
        setRecordStart.disabled = true;
        setRecordTest.disabled = true;
      }
    }

    function closeRecordingDrawer() {
      setRecordDrawer.hidden = true;
      document.body.classList.remove('recording-drawer-open');
    }

    async function saveRecordingChoice() {
      if (LIVE_ASSIST_PREVIEW_MODE) return;
      const payload = {
        provider: activeRecordingProvider(),
        source_mode: recordingSourceMode,
        format: setRecordFormat.value,
        broadcast_enabled: setRecordBroadcast.value === 'on',
      };
      if (recordingSourceMode === 'application') payload.application_bundle_id = setRecordSource.value;
      else payload.device_name = setRecordSource.value;
      const response = await fetch('/api/performance/recording/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Recording choice could not be saved');
      recordingSources = {
        ...recordingSources,
        broadcast_enabled: Boolean(result.settings?.broadcast_enabled),
      };
    }

    async function testRecordingSource() {
      if (recordingControlBusy || !setRecordSource.value) return;
      recordingControlBusy = true;
      setRecordTest.textContent = 'Listening...';
      renderRecordingDrawer();
      setRecordReady.hidden = false;
      setRecordReady.dataset.ready = 'false';
      setRecordReady.textContent = 'Play audio now. AXIOM is listening for three seconds.';
      try {
        await saveRecordingChoice();
        let payload;
        if (LIVE_ASSIST_PREVIEW_MODE) {
          await new Promise(resolve => window.setTimeout(resolve, 650));
          payload = { success: true, signal: { signal: 'healthy', label: 'Signal healthy', dbfs: -12.4 } };
        } else {
          const response = await fetch('/api/performance/recording/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              provider: activeRecordingProvider(),
              source_mode: recordingSourceMode,
              source_id: setRecordSource.value,
            }),
          });
          payload = await response.json();
          if (!response.ok || !payload.success) throw new Error(payload.error || 'Signal test failed');
        }
        const signal = payload.signal || {};
        recordingSignalTest = { peak: signal.dbfs, expires: Date.now() + 5000 };
        recordingState = { ...recordingState, status: 'idle', recording: false, error: '' };
        renderRecordingControl();
        setRecordReady.dataset.ready = signal.signal === 'none' ? 'false' : 'true';
        setRecordReady.textContent = signal.dbfs == null ? signal.label : `${signal.label} · ${signal.dbfs} dB · ready to record`;
      } catch (error) {
        setRecordReady.dataset.ready = 'false';
        setRecordReady.textContent = error.message;
      } finally {
        recordingControlBusy = false;
        setRecordTest.textContent = 'Test Signal';
        setRecordTest.disabled = !setRecordSource.value;
        setRecordStart.disabled = !setRecordSource.value;
      }
    }

    function showRecordingReceipt(payload = recordingState) {
      const savedPath = String(payload.saved_path || '');
      if (!savedPath || savedPath === recordingReceiptPath) return;
      recordingReceiptPath = savedPath;
      const savedName = savedPath.split(/[\\/]/).pop() || 'Set recording saved';
      setRecordReceiptName.textContent = savedName;
      setRecordReceiptMeta.textContent = `${formatRecordingTime(payload.elapsed_seconds)} · ${String(payload.format || 'wav').toUpperCase()} · ${savedPath}`;
      setRecordReceiptMeta.title = savedPath;
      setRecordReceipt.hidden = false;
      setRecordDrawer.hidden = true;
      document.body.classList.add('recording-drawer-open');
    }

    async function startSetRecording() {
      await recordGainSave;
      if (recordGainError) { setStatus('Save the recording level before starting.', true); return; }
      if (recordingControlBusy || !setRecordSource.value) return;
      recordingControlBusy = true;
      recordingStateEpoch += 1;
      renderRecordingDrawer();
      try {
        await saveRecordingChoice();
        if (LIVE_ASSIST_PREVIEW_MODE) {
          recordingPreviewStarted = Date.now();
          recordingState = {
            status: 'recording', recording: true, elapsed_seconds: 0, signal_level: 0.58, peak_dbfs: -25.2, signal: 'healthy',
            source_mode: recordingSourceMode, source_label: setRecordSource.options[setRecordSource.selectedIndex]?.textContent || setRecordSource.value,
            format: setRecordFormat.value,
          };
        } else {
          setRecordReady.dataset.ready = 'false';
          setRecordReady.textContent = recordingSourceMode === 'device'
            ? 'Preparing controller audio and starting recording...'
            : 'Preparing DJ audio and starting recording...';
          recordingState = await fetchJson('/api/performance/recording/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              provider: activeRecordingProvider(),
              source_mode: recordingSourceMode,
              source_id: setRecordSource.value,
            }),
          });
        }
        recordingReceiptPath = '';
        recordingObservedActiveThisWindow = true;
        closeRecordingDrawer();
        const controllerWarning = String(recordingState.controller_setup_error || '').trim();
        setStatus(controllerWarning
          ? `Recording started, but controller setup needs attention: ${controllerWarning}`
          : `Recording ${recordingState.source_label || recordingState.device_name || 'the selected source'}${recordingState.broadcasting ? ' and sharing it as AXIOM Broadcast' : ''}. Press Record Set again to stop and save.`);
      } catch (error) {
        recordingState = { ...recordingState, status: 'failed', recording: false, error: error.message };
        setRecordDrawer.hidden = false;
        document.body.classList.add('recording-drawer-open');
        setRecordReady.dataset.ready = 'false';
        setRecordReady.textContent = error.message;
      } finally {
        recordingControlBusy = false;
        renderRecordingControl();
        renderRecordingDrawer();
      }
    }

    async function pollRecordingStatus() {
      if (LIVE_ASSIST_PREVIEW_MODE) {
        if (recordingState.recording) {
          const elapsed = Math.floor((Date.now() - recordingPreviewStarted) / 1000);
          const level = Math.max(0.08, Math.min(0.94, 0.5 + Math.sin(Date.now() / 170) * 0.34));
          recordingState = { ...recordingState, elapsed_seconds: elapsed, signal_level: level, peak_dbfs: level * 60 - 60, signal: level > 0.9 ? 'loud' : 'healthy' };
        }
        renderRecordingControl();
        return;
      }
      if (recordingControlBusy || recordingPollInFlight) return;
      const requestEpoch = recordingStateEpoch;
      recordingPollInFlight = true;
      try {
        const payload = await fetchJson('/api/performance/recording/status', { timeoutMs: 3000 });
        if (recordingControlBusy || requestEpoch !== recordingStateEpoch) return;
        recordingState = payload;
        if (isSetRecordingActive(recordingState)) recordingObservedActiveThisWindow = true;
        if (recordingState.status === 'saved') {
          if (recordingObservedActiveThisWindow) showRecordingReceipt(recordingState);
          else recordingReceiptPath = String(recordingState.saved_path || '');
        }
        if (recordingState.status === 'failed' && recordingObservedActiveThisWindow) {
          recordingObservedActiveThisWindow = false;
          // A native permission decision may arrive after Start returns. Keep
          // the failure visible once, without repeatedly opening system settings.
          await openRecordingDrawer();
        }
        renderRecordingControl();
      } catch (_) {
        setRecordButton.dataset.signal = 'unavailable';
      } finally {
        recordingPollInFlight = false;
      }
    }

    async function stopSetRecording() {
      if (recordingControlBusy) return;
      recordingControlBusy = true;
      recordingStateEpoch += 1;
      recordingState = { ...recordingState, status: 'stopping', recording: false };
      renderRecordingControl();
      try {
        if (LIVE_ASSIST_PREVIEW_MODE) {
          recordingState = { ...recordingState, status: 'saved', recording: false, saved_path: '/Users/dj/Desktop/AXIOM Set — Saturday Night.wav' };
          setStatus('AXIOM Set — Saturday Night.wav saved to Desktop.');
        } else {
          recordingState = await fetchJson('/api/performance/recording/stop', { method: 'POST' });
          if (recordingState.status === 'saved') {
            const savedName = String(recordingState.saved_path || '').split(/[\\/]/).pop();
            setStatus(`${savedName || 'Your set'} saved to Desktop.${recordingState.error ? ` ${recordingState.error}` : ''}`);
          }
        }
        showRecordingReceipt(recordingState);
      } catch (error) {
        setStatus(`Set recording could not stop: ${error.message}`, true);
      } finally {
        recordingControlBusy = false;
        renderRecordingControl();
      }
    }

    async function toggleSetRecording() {
      if (recordingControlBusy || recordingState.status === 'stopping') return;
      if (isSetRecordingActive()) {
        await stopSetRecording();
        return;
      }
      if (!LIVE_ASSIST_PREVIEW_MODE) {
        recordingControlBusy = true;
        recordingStateEpoch += 1;
        renderRecordingControl();
        try {
          recordingState = await fetchJson('/api/performance/recording/status', { timeoutMs: 3000 });
        } catch (_) {
          // If status cannot be refreshed, preserve the normal setup recovery.
        } finally {
          recordingControlBusy = false;
          renderRecordingControl();
        }
        if (recordingState.status === 'stopping') return;
        if (isSetRecordingActive()) {
          await stopSetRecording();
          return;
        }
      }
      // Record is the primary action. Only show setup when the selected source
      // actually needs attention; each press discovers fresh devices/access.
      recordingControlBusy = true;
      recordingStateEpoch += 1;
      renderRecordingControl();
      try {
        let sources = await loadRecordingSources('');
        if (sources.source_mode === 'device' && !(sources.devices || []).length) {
          sources = await loadRecordingSources('application');
        } else if (sources.source_mode === 'application' && !(sources.applications || []).length && !sources.permission_required) {
          sources = await loadRecordingSources('device');
        }
        if (!sources.ready) {
          recordingControlBusy = false;
          await openRecordingDrawer();
          return;
        }
      } catch (error) {
        recordingState = { ...recordingState, status: 'failed', recording: false, error: error.message };
        recordingControlBusy = false;
        await openRecordingDrawer();
        return;
      } finally {
        recordingControlBusy = false;
        renderRecordingControl();
      }
      await startSetRecording();
    }

    function handleRecordingControlClick(event) {
      if (event.shiftKey) return openRecordingDrawer();
      return toggleSetRecording();
    }

    function handleRecordingControlMenu(event) {
      event.preventDefault();
      return openRecordingDrawer();
    }

    setRecordButton.title = 'Click to start or stop recording. Right-click or Shift-click for Recording Level and setup.';
    setRecordButton.addEventListener('click', handleRecordingControlClick);
    setRecordButton.addEventListener('contextmenu', handleRecordingControlMenu);
    setRecordButton.addEventListener('keydown', event => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        handleRecordingControlMenu(event);
      }
    });
    document.getElementById('set-record-close').addEventListener('click', closeRecordingDrawer);
    document.getElementById('set-record-receipt-close').addEventListener('click', () => {
      setRecordReceipt.hidden = true;
      document.body.classList.remove('recording-drawer-open');
    });
    document.querySelectorAll('[data-record-source-mode]').forEach(button => {
      button.addEventListener('click', async () => {
        recordingSourceMode = button.dataset.recordSourceMode === 'device' ? 'device' : 'application';
        setRecordReady.dataset.ready = 'false';
        setRecordReady.textContent = recordingSourceMode === 'device'
          ? 'Checking connected controller and interface inputs...'
          : 'Checking running DJ software...';
        setRecordStart.disabled = true;
        setRecordTest.disabled = true;
        renderRecordingDrawer();
        try {
          await loadRecordingSources(recordingSourceMode);
        } catch (error) {
          setRecordReady.dataset.ready = 'false';
          setRecordReady.textContent = error.message;
        }
      });
    });
    setRecordSource.addEventListener('change', renderRecordingDrawer);
    setRecordFormat.addEventListener('change', saveRecordingChoice);
    setRecordBroadcast.addEventListener('change', async () => {
      recordingSources.broadcast_enabled = setRecordBroadcast.value === 'on';
      await saveRecordingChoice();
      renderRecordingDrawer();
    });
    setRecordTest.addEventListener('click', testRecordingSource);
    setRecordStart.addEventListener('click', startSetRecording);
    document.getElementById('set-record-play').addEventListener('click', async () => {
      if (LIVE_ASSIST_PREVIEW_MODE) return setStatus('Opening the saved set recording.');
      await fetchJson('/api/performance/recording/play', { method: 'POST' });
    });
    document.getElementById('set-record-reveal').addEventListener('click', async () => {
      if (LIVE_ASSIST_PREVIEW_MODE) return setStatus('Opening the saved set in Finder.');
      await fetchJson('/api/performance/recording/reveal', { method: 'POST' });
    });
    window.setInterval(pollRecordingStatus, 500);
    pollRecordingStatus();
    if (LIVE_ASSIST_PREVIEW_MODE && LIVE_ASSIST_QUERY.get('recording_setup') === '1') openRecordingDrawer();

    gigProfileButton.addEventListener('click', () => toggleGigProfileMenu());
    document.getElementById('assist-only-selected').addEventListener('click', () => {
      document.getElementById('gig-profile-only-selected').click();
    });
    document.getElementById('gig-profile-close').addEventListener('click', () => toggleGigProfileMenu(false));
    document.getElementById('gig-profile-refresh').addEventListener('click', refreshGigProfileSources);
    document.getElementById('gig-profile-apply').addEventListener('click', () => applyGigProfileSelection(true));
    document.getElementById('gig-profile-load').addEventListener('click', loadSavedGigProfile);
    document.getElementById('gig-profile-save').addEventListener('click', openGigProfileSavePanel);
    document.getElementById('gig-profile-save-confirm').addEventListener('click', saveCurrentGigProfile);
    document.getElementById('gig-profile-save-cancel').addEventListener('click', closeGigProfileSavePanel);
    gigProfileName.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        saveCurrentGigProfile();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeGigProfileSavePanel();
        gigProfileSaveButton.focus();
      }
    });
    gigProfileSaved.addEventListener('change', () => {
      state.gigProfileActiveSavedId = gigProfileSaved.value;
      gigProfileLoadButton.disabled = !gigProfileSaved.value;
    });
    document.getElementById('gig-profile-enabled').addEventListener('click', async () => {
      if (!state.gigProfileEnabled && !state.gigProfileSelectedIds.size) {
        setStatus('Choose at least one Serato crate or djay Pro playlist first.', true);
        return;
      }
      state.gigProfileEnabled = !state.gigProfileEnabled;
      if (!state.gigProfileEnabled) state.gigProfileOnlySelected = false;
      state.gigProfileEnabledExplicit = true;
      renderGigProfileButton();
      await applyGigProfileSelection(false);
    });
    document.getElementById('gig-profile-only-selected').addEventListener('click', async () => {
      if (!state.gigProfileSelectedIds.size) {
        setStatus('Choose at least one Serato crate or djay Pro playlist first.', true);
        return;
      }
      state.gigProfileOnlySelected = !state.gigProfileOnlySelected;
      if (state.gigProfileOnlySelected) state.gigProfileEnabled = true;
      state.gigProfileEnabledExplicit = true;
      renderGigProfileButton();
      await applyGigProfileSelection(false);
    });
    document.getElementById('gig-profile-colors').addEventListener('click', async () => {
      state.gigProfileColorsEnabled = !state.gigProfileColorsEnabled;
      renderGigProfileButton();
      await applyGigProfileSelection(false);
      render();
    });
    document.getElementById('gig-profile-select-all').addEventListener('click', () => {
      activeGigProfileSources()
        .filter(gigProfileSourceSelectable)
        .forEach(source => state.gigProfileSelectedIds.add(source.id));
      state.gigProfileActiveSavedId = '';
      state.gigProfileEnabled = state.gigProfileSelectedIds.size > 0;
      state.gigProfileEnabledExplicit = false;
      state.gigProfileMenuDirty = true;
      refreshGigProfileCheckboxState();
    });
    document.getElementById('gig-profile-clear').addEventListener('click', () => {
      const activeIds = new Set(activeGigProfileSources().map(source => source.id));
      state.gigProfileSelectedIds = new Set(
        [...state.gigProfileSelectedIds].filter(sourceId => !activeIds.has(sourceId))
      );
      if (!state.gigProfileSelectedIds.size) state.gigProfileOnlySelected = false;
      state.gigProfileActiveSavedId = '';
      state.gigProfileEnabled = state.gigProfileSelectedIds.size > 0;
      state.gigProfileEnabledExplicit = false;
      state.gigProfileMenuDirty = true;
      refreshGigProfileCheckboxState();
    });
    gigProfileSearch.addEventListener('input', renderGigProfileSources);
    function syncGigProfileCheckboxState(input) {
      const sourceId = input?.getAttribute('data-gig-profile-source-id');
      if (!sourceId) return;
      if (input.checked) state.gigProfileSelectedIds.add(sourceId);
      else state.gigProfileSelectedIds.delete(sourceId);
      state.gigProfileActiveSavedId = '';
      state.gigProfileEnabled = state.gigProfileSelectedIds.size > 0;
      state.gigProfileEnabledExplicit = false;
      state.gigProfileMenuDirty = true;
      refreshGigProfileCheckboxState();
    }
    gigProfileSources.addEventListener('change', event => {
      const branchInput = event.target.closest('[data-gig-profile-branch-ids]');
      if (branchInput) {
        let sourceIds = [];
        try { sourceIds = JSON.parse(branchInput.getAttribute('data-gig-profile-branch-ids') || '[]'); } catch (_) {}
        sourceIds.forEach(sourceId => {
          if (branchInput.checked) state.gigProfileSelectedIds.add(sourceId);
          else state.gigProfileSelectedIds.delete(sourceId);
        });
        state.gigProfileActiveSavedId = '';
        state.gigProfileEnabled = state.gigProfileSelectedIds.size > 0;
        state.gigProfileEnabledExplicit = false;
        state.gigProfileMenuDirty = true;
        refreshGigProfileCheckboxState();
        return;
      }
      const input = event.target.closest('[data-gig-profile-source-id]');
      if (!input) return;
      syncGigProfileCheckboxState(input);
    });
    gigProfileSources.addEventListener('click', event => {
      if (event.target.closest('[data-gig-profile-source-id], [data-gig-profile-branch-ids]')) event.stopPropagation();
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && state.gigProfileMenuOpen) toggleGigProfileMenu(false);
      const target = event.target;
      const isTypingSurface = target?.closest?.('input, textarea, select, [contenteditable="true"], #gig-profile-menu, #more-like-menu');
      if (isTypingSurface) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        moveRecommendationSelection(event.key === 'ArrowDown' ? 1 : -1);
      }
    });

    pinButton.addEventListener('click', () => {
      state.pinned = !state.pinned;
      pinButton.classList.toggle('active', state.pinned);
      setStatus(state.pinned ? 'Native panel is floating above your DJ software.' : 'Panel can be hidden.');
    });

    async function setTempoIntent(intent) {
      const nextIntent = state.tempoIntent === intent ? '' : intent;
      state.tempoIntent = nextIntent;
      state.bpmOverride = '';
      state.bpmDraft = '';
      render();
      const anchorBpm = liveAssistTempoSourceBpm();
      const targetBpm = nextIntent === 'half' ? anchorBpm / 2 : nextIntent === 'double' ? anchorBpm * 2 : anchorBpm;
      setStatus(nextIntent
        ? `Loading AXIOM fits around ${targetBpm.toFixed(1)} BPM...`
        : 'Returning to the current BPM lane...');
      try {
        await fetchJson('/api/performance/live_assist/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_version: state.lastSessionVersion || 1,
            tempo_intent: nextIntent,
            clear_target_bpm: true,
            refresh_recommendations: true,
          }),
        });
        postNativeAssistAction('refreshLiveAssistRecommendations');
      } catch (error) {
        setStatus(`Tempo lane could not be changed: ${error.message}`, true);
      }
    }

    async function requestRecommendationRefresh({ resetBpm = false } = {}) {
      if (resetBpm) {
        state.tempoIntent = '';
        state.bpmOverride = '';
        state.bpmDraft = '';
        render();
      }
      if (LIVE_ASSIST_PREVIEW_MODE) {
        refreshLiveAssistPreviewRecommendations();
        return;
      }
      setStatus(resetBpm
        ? 'Refreshing AXIOM fits at the deck current playing BPM...'
        : 'Repopulating Performance recommendations...');
      state.refreshPending = true;
      try {
        await fetchJson('/api/performance/live_assist/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_version: state.lastSessionVersion || 1,
            tempo_intent: resetBpm ? '' : state.tempoIntent,
            reset_baseline: resetBpm,
            refresh_recommendations: true,
          }),
        });
        postNativeAssistAction('refreshLiveAssistRecommendations');
      } catch (error) {
        state.refreshPending = false;
        setStatus(`Recommendations could not be refreshed: ${error.message}`, true);
      }
    }

    async function resetTempoBaseline() {
      await requestRecommendationRefresh({ resetBpm: true });
    }

    halfButton.addEventListener('click', () => setTempoIntent('half'));
    doubleButton.addEventListener('click', () => setTempoIntent('double'));
    refreshButton.addEventListener('click', resetTempoBaseline);
    document.getElementById('assist-anchor-refresh').addEventListener('click', () => requestRecommendationRefresh());
    refreshBpmButton.addEventListener('click', () => {
      refreshMenu.hidden = true;
      refreshPlusButton.setAttribute('aria-expanded', 'false');
      resetTempoBaseline();
    });
    refreshPlusButton.addEventListener('click', event => {
      event.stopPropagation();
      refreshMenu.hidden = !refreshMenu.hidden;
      event.currentTarget.setAttribute('aria-expanded', refreshMenu.hidden ? 'false' : 'true');
    });

    function selectedLiveRefineTrack() {
      const track = selectedSuggestion();
      if (!track) {
        setStatus('Select Playing Now or a recommendation, then choose a Live Assist refine action.', true);
        return null;
      }
      return track;
    }

    function applyMoreEnergyFeedback() { toggleAssistYearMode('new'); }
    function applyTooNewFeedback() { toggleAssistYearMode('old'); }

    document.querySelectorAll('[data-assist-year-step]').forEach(button => {
      button.addEventListener('click', () => {
        const step = ((state.moreLike || state.yearRange)?.span_years || 2) + 1;
        shiftAssistYearRange(Number(button.dataset.assistYearStep) < 0 ? -step : step);
      });
    });
    document.getElementById('assist-year-span').addEventListener('change', event => resizeAssistYearRange(Number(event.target.value)));
    document.getElementById('assist-reset-year-range').addEventListener('click', () => {
      if (state.moreLike) {
        state.moreLike = AXIOMLiveAssistSimilarity.reset(state.moreLike);
      }
      state.yearRange = null;
      state.yearMode = '';
      sendSessionFeedback('year_range', {});
      render();
      setStatus(state.moreLike ? `Following ${AXIOMLiveAssistSimilarity.description(state.moreLike)}` : 'Year range cleared.');
    });

    function applyGenreFlipFeedback() {
      if (state.genreFlipGenres.length) {
        state.genreFlipGenres = [];
        sendSessionFeedback("genre_flip", {});
        render();
        setStatus('Genre Flip is off. Live Assist returned to the current genre lane.');
        return;
      }
      const track = selectedLiveRefineTrack();
      if (!track) return;
      const anchor = normalizeTrack(state.anchor || {});
      const sourceGenre = track.genre || anchor.genre || liveAssistGenreText(track);
      state.genreFlipGenres = liveAssistComplementaryGenres(sourceGenre);
      state.preferredGenre = '';
      state.moreLike = null;
      sendSessionFeedback('genre_flip', track);
      render();
      setStatus(`Genre Flip is on. AXIOM is lifting complementary lanes: ${state.genreFlipGenres.join(', ')}.`);
    }

    energyButton.addEventListener('click', applyMoreEnergyFeedback);
    newButton.addEventListener('click', applyTooNewFeedback);
    genreFlipButton.addEventListener('click', applyGenreFlipFeedback);
    document.getElementById('old-button').addEventListener('click', () => applySelectedFeedback('too_old'));
    document.getElementById('genre-button').addEventListener('click', () => applySelectedFeedback('wrong_genre'));
    document.getElementById('like-button').addEventListener('click', () => applySelectedFeedback('more_like'));
    cleanOnlyButton.addEventListener('click', () => {
      state.cleanOnly = !state.cleanOnly;
      try {
        localStorage.setItem(LIVE_ASSIST_CLEAN_ONLY_KEY, state.cleanOnly ? '1' : '0');
      } catch (_) {}
      render();
      setStatus(state.cleanOnly
        ? 'Family Friendly Only is on. Live Assist is showing verified clean, radio-safe recommendations only.'
        : 'Dirty Music Allowed. Live Assist can suggest the normal Performance pool, including explicit or dirty versions.');
    });
    document.getElementById('more-era-button').addEventListener('click', () => {
      document.getElementById('more-like-menu').hidden = true;
      document.getElementById('like-plus-button').setAttribute('aria-expanded', 'false');
      applySelectedFeedback('more_era');
    });
    document.getElementById('more-genre-button').addEventListener('click', () => {
      document.getElementById('more-like-menu').hidden = true;
      document.getElementById('like-plus-button').setAttribute('aria-expanded', 'false');
      applySelectedFeedback('more_genre');
    });
    document.getElementById('like-plus-button').addEventListener('click', event => {
      event.stopPropagation();
      const menu = document.getElementById('more-like-menu');
      menu.hidden = !menu.hidden;
      event.currentTarget.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
    });
    document.addEventListener('click', event => {
      if (!event.target.closest('.more-like-control')) {
        document.getElementById('more-like-menu').hidden = true;
        document.getElementById('like-plus-button').setAttribute('aria-expanded', 'false');
      }
      if (!event.target.closest('.refresh-control')) {
        refreshMenu.hidden = true;
        refreshPlusButton.setAttribute('aria-expanded', 'false');
      }
    });

    if ('BroadcastChannel' in window) {
      const channel = new BroadcastChannel('axiom-live-assist');
      channel.addEventListener('message', event => {
        if (event.data?.type === 'performance-state-updated') requestPerformanceStateRefresh(event.data.version);
      });
    }

    window.addEventListener('storage', event => {
      if (event.key === 'axiom-live-assist-updated') {
        let version = 0;
        try { version = JSON.parse(event.newValue)?.version || 0; } catch (error) {}
        requestPerformanceStateRefresh(version);
      }
      if (event.key === PERFORMANCE_COACH_INSIGHTS_KEY) {
        state.coachInsightsEnabled = event.newValue === 'on';
        renderCoachInsightsControl();
      }
      if ((event.key === GIG_PROFILE_STORAGE_KEY || event.key === GIG_PROFILE_ACTIVE_KEY) && !state.gigProfileProfilesFromPerformance) {
        loadSavedGigProfiles();
      }
    });

    coachInsightsToggle?.addEventListener('click', () => {
      setCoachInsightsEnabled(!state.coachInsightsEnabled);
      document.getElementById('more-like-menu').hidden = true;
      document.getElementById('like-plus-button').setAttribute('aria-expanded', 'false');
    });

    window.__AXIOM_NATIVE_DRAG_RESULT = (success, message = '') => {
      assistDragging = false;
      setStatus(message || (success ? 'Track sent to the DJ deck.' : 'Track drag cancelled.'), !success && Boolean(message));
    };

    const activationBar = document.getElementById('performance-activation-bar');
    activationBar.addEventListener('click', expandLiveAssistWindow);
    activationBar.addEventListener('keydown', event => {
      if (!['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      expandLiveAssistWindow();
    });
    document.getElementById('collapse-assist-button').addEventListener('click', collapseLiveAssistWindow);

    list.addEventListener('mousedown', event => {
      if (event.button !== 0) return;
      if (event.target.closest('button')) return;
      const row = event.target.closest('.track[draggable="true"]');
      const path = row?.dataset?.path;
      if (!path) return;
      const nativeBridge = window.webkit?.messageHandlers?.axiomNative;
      if (nativeBridge?.postMessage) {
        assistDragging = true;
        nativeBridge.postMessage({ action: 'prepareTrackDrag', path, title: row.querySelector('.track-title')?.textContent || '' });
      }
    });

    list.addEventListener('click', event => {
      const rejectButton = event.target.closest('[data-reject-path]');
      if (rejectButton) {
        event.preventDefault();
        event.stopPropagation();
        state.selectedPath = rejectButton.getAttribute('data-reject-path');
        state.selectedPlayingTrackKey = '';
        applySelectedFeedback('reject');
        return;
      }
      if (event.target.closest('[data-keep-path]')) return;
      const row = event.target.closest('.track');
      if (!row?.dataset?.path) return;
      state.selectedPath = row.dataset.path;
      state.selectedPlayingTrackKey = '';
      render();
      setStatus('Recommendation selected. Choose a feedback action or drag it to a deck.');
    });

    list.addEventListener('keydown', event => {
      if (!['Enter', ' '].includes(event.key)) return;
      if (event.target.closest('[data-keep-path]')) return;
      const row = event.target.closest('.track');
      if (!row?.dataset?.path) return;
      event.preventDefault();
      state.selectedPath = row.dataset.path;
      state.selectedPlayingTrackKey = '';
      render();
    });

    list.addEventListener('pointerover', event => {
      const row = event.target.closest('.track[draggable="true"]');
      const path = row?.dataset?.path;
      const nativeBridge = window.webkit?.messageHandlers?.axiomNative;
      if (path && nativeBridge?.postMessage) {
        nativeBridge.postMessage({ action: 'prepareTrackDrag', path, title: row.querySelector('.track-title')?.textContent || '' });
      }
    });

    list.addEventListener('pointerout', event => {
      const row = event.target.closest('.track[draggable="true"]');
      if (!row || row.contains(event.relatedTarget)) return;
      const nativeBridge = window.webkit?.messageHandlers?.axiomNative;
      if (nativeBridge?.postMessage) {
        nativeBridge.postMessage({ action: 'clearTrackDrag' });
      }
    });

    list.addEventListener('dragstart', event => {
      const row = event.target.closest('.track[draggable="true"]');
      const path = row?.dataset?.path;
      if (!path || !event.dataTransfer) return;
      const fileUrl = fileUrlForPath(path);
      const filename = path.split('/').pop() || 'track';
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('text/uri-list', fileUrl);
      event.dataTransfer.setData('text/plain', path);
      event.dataTransfer.setData('DownloadURL', `application/octet-stream:${filename}:${fileUrl}`);
    });

    loadSavedGigProfiles();
    window.webkit?.messageHandlers?.axiomNative?.postMessage?.({
      action: 'clientReady',
      stage: 'live-assist',
    });
    loadPerformanceState();
    if (LIVE_ASSIST_PREVIEW_MODE && LIVE_ASSIST_QUERY.get('coach_popout') === '1') {
      performanceCoachRail.hidden = false;
    }
