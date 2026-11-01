    // Shared settings panel and Performance recording configuration.
    function filterSettingsRows(query = '') {
      const hud = document.getElementById('master-hud');
      if (!hud) return;
      const needle = String(query || '').trim().toLowerCase();
      hud.querySelectorAll('.settings-item').forEach(item => {
        const haystack = `${item.dataset.settingsSearch || ''} ${item.textContent || ''}`.toLowerCase();
        item.classList.toggle('settings-search-hidden', Boolean(needle) && !haystack.includes(needle));
      });
      const footer = document.getElementById('settings-footer-status');
      if (footer) footer.textContent = needle ? `Showing settings matching “${query.trim()}”.` : 'Settings are applied automatically.';
    }

    function setSettingsCategory(category = 'all', trigger = null) {
      const allowed = new Set(['all', 'library', 'workflow', 'interface', 'system']);
      const next = allowed.has(category) ? category : 'all';
      const hud = document.getElementById('master-hud');
      if (!hud) return;
      hud.dataset.settingsCategory = next;
      hud.querySelectorAll('.settings-tab').forEach(button => {
        const active = button.dataset.settingsCategory === next;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      const input = document.getElementById('settings-search-input');
      filterSettingsRows(input?.value || '');
      if (trigger) trigger.blur();
    }

    function renderRecordingSaveDirectory(saveDirectory = '') {
      const destination = String(saveDirectory || '~/Desktop').trim() || '~/Desktop';
      ['recording-save-directory', 'performance-recording-save-location'].forEach(id => {
        const element = document.getElementById(id);
        if (!element) return;
        element.textContent = destination;
        element.title = destination;
      });
    }

    async function loadPerformanceRecordingDestination() {
      try {
        const response = await fetch('/api/performance/recording/settings');
        const payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.error || 'Recording destination unavailable');
        renderRecordingSaveDirectory(payload.save_directory);
      } catch (_error) {
        renderRecordingSaveDirectory('~/Desktop');
      }
    }

    async function loadSetRecordingSettings() {
      const providerSelect = document.getElementById('recording-provider-select');
      const sourceModeSelect = document.getElementById('recording-source-mode-select');
      const deviceSelect = document.getElementById('recording-device-select');
      const formatSelect = document.getElementById('recording-format-select');
      const broadcastSelect = document.getElementById('recording-broadcast-select');
      const pairSelect = document.getElementById('recording-channel-pair-select');
      const confirmPairButton = document.getElementById('recording-confirm-pair-button');
      const resultEl = document.getElementById('recording-test-result');
      if (!providerSelect || !sourceModeSelect || !deviceSelect || !formatSelect || !broadcastSelect || !pairSelect || !confirmPairButton || !resultEl) return;
      const provider = providerSelect.value || 'auto';
      const requestedMode = sourceModeSelect.value || 'application';
      deviceSelect.disabled = true;
      try {
        const settingsResponse = await fetch('/api/performance/recording/settings');
        const settingsPayload = await settingsResponse.json();
        const savedMode = settingsPayload.settings?.source_mode === 'device' ? 'device' : 'application';
        const sourceMode = sourceModeSelect.dataset.touched === 'true' ? requestedMode : savedMode;
        sourceModeSelect.value = sourceMode;
        const sourcesResponse = await fetch(`/api/performance/recording/sources?provider=${encodeURIComponent(provider)}&source_mode=${encodeURIComponent(sourceMode)}`);
        const sourcesPayload = await sourcesResponse.json();
        const sources = sourceMode === 'application'
          ? (Array.isArray(sourcesPayload.applications) ? sourcesPayload.applications.map(item => ({ id: item.bundle_id, name: item.name, recommended: true })) : [])
          : (Array.isArray(sourcesPayload.devices) ? sourcesPayload.devices.map(item => ({ id: item.name, name: item.name, recommended: item.recommended })) : []);
        deviceSelect.innerHTML = '';
        sources.forEach(device => {
          const option = document.createElement('option');
          option.value = device.id;
          option.textContent = `${device.name}${device.recommended ? ' - recommended' : ''}`;
          deviceSelect.appendChild(option);
        });
        if (!sources.length) {
          const option = document.createElement('option');
          option.value = '';
          option.textContent = sourcesPayload.error || (sourceMode === 'application' ? 'Open Serato or djay Pro' : 'No safe controller inputs found');
          deviceSelect.appendChild(option);
        }
        const savedDevice = sourceMode === 'application'
          ? settingsPayload.settings?.application_bundle_ids?.[provider]
          : settingsPayload.settings?.device_names?.[provider];
        const selectedSource = savedDevice || sourcesPayload.selected_source_id || '';
        if (selectedSource && sources.some(device => device.id === selectedSource)) deviceSelect.value = selectedSource;
        formatSelect.value = settingsPayload.settings?.format === 'mp3' ? 'mp3' : 'wav';
        broadcastSelect.classList.remove('hidden');
        broadcastSelect.disabled = !sourcesPayload.broadcast_available;
        broadcastSelect.value = settingsPayload.settings?.broadcast_enabled && sourcesPayload.broadcast_available ? 'on' : 'off';
        broadcastSelect.options[0].textContent = !sourcesPayload.broadcast_available
          ? 'AXIOM Broadcast Driver Needed'
          : 'Streaming Feed Off';
        const profile = sourceMode === 'device' && sourcesPayload.capture_profile && typeof sourcesPayload.capture_profile === 'object'
          ? sourcesPayload.capture_profile
          : null;
        window.axiomRecordingCaptureProfile = profile;
        const pairs = Array.isArray(profile?.available_pairs) ? profile.available_pairs : [];
        pairSelect.innerHTML = '';
        pairs.forEach(pair => {
          const option = document.createElement('option');
          option.value = `${pair.left_channel}:${pair.right_channel}`;
          option.textContent = pair.channel_label || `Channels ${Number(pair.left_channel) + 1}/${Number(pair.right_channel) + 1}`;
          pairSelect.appendChild(option);
        });
        const activePairValue = profile ? `${profile.left_channel}:${profile.right_channel}` : '';
        if (activePairValue && pairs.some(pair => `${pair.left_channel}:${pair.right_channel}` === activePairValue)) pairSelect.value = activePairValue;
        const needsPairChoice = sourceMode === 'device' && pairs.length > 1;
        pairSelect.classList.toggle('hidden', !needsPairChoice);
        confirmPairButton.classList.toggle('hidden', !needsPairChoice);
        confirmPairButton.disabled = Boolean(profile?.confirmed);
        confirmPairButton.textContent = profile?.confirmed ? 'Pair Confirmed' : 'Confirm Pair';
        renderRecordingSaveDirectory(settingsPayload.save_directory);
        resultEl.dataset.signal = 'idle';
        resultEl.textContent = sourcesPayload.permission_required
          ? 'Mac audio permission needed'
          : (sourcesPayload.calibration_required ? 'Test and confirm controller pair' : 'Ready To Test');
      } catch (error) {
        deviceSelect.innerHTML = '<option value="">Recording unavailable</option>';
        resultEl.dataset.signal = 'none';
        resultEl.textContent = 'Could not load inputs';
      } finally {
        deviceSelect.disabled = false;
      }
    }

    async function handleRecordingSourceChange() {
      await saveSetRecordingSettings();
      await loadSetRecordingSettings();
    }

    function selectedRecordingPair() {
      const raw = document.getElementById('recording-channel-pair-select')?.value || '';
      const [left, right] = raw.split(':').map(value => Number.parseInt(value, 10));
      if (!Number.isInteger(left) || !Number.isInteger(right) || right !== left + 1) return null;
      return { left_channel: left, right_channel: right };
    }

    function markRecordingPairUnconfirmed() {
      const button = document.getElementById('recording-confirm-pair-button');
      const result = document.getElementById('recording-test-result');
      if (button) {
        button.disabled = false;
        button.textContent = 'Confirm Pair';
      }
      if (result) {
        result.dataset.signal = 'idle';
        result.textContent = 'Play audio, then test this pair';
      }
    }

    async function confirmSetRecordingPair() {
      const profile = window.axiomRecordingCaptureProfile;
      const pair = selectedRecordingPair();
      const result = document.getElementById('recording-test-result');
      if (!profile?.device_key || !pair || !result) return;
      if (!['healthy', 'loud', 'clipping'].includes(result.dataset.signal || '')) {
        result.dataset.signal = 'none';
        result.textContent = 'Test a live signal before confirming';
        return;
      }
      const label = document.getElementById('recording-channel-pair-select')?.selectedOptions?.[0]?.textContent || '';
      try {
        const response = await fetch('/api/performance/recording/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_capture_pair: { ...pair, device_key: profile.device_key, channel_label: label } }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.error || 'Pair could not be confirmed');
        result.dataset.signal = 'healthy';
        result.textContent = `${label} confirmed for this controller`;
        await loadSetRecordingSettings();
      } catch (error) {
        result.dataset.signal = 'none';
        result.textContent = error.message || 'Pair could not be confirmed';
      }
    }

    async function saveSetRecordingSettings() {
      const provider = document.getElementById('recording-provider-select')?.value || 'auto';
      const sourceMode = document.getElementById('recording-source-mode-select')?.value || 'application';
      const deviceName = document.getElementById('recording-device-select')?.value || '';
      const format = document.getElementById('recording-format-select')?.value || 'wav';
      const broadcastEnabled = document.getElementById('recording-broadcast-select')?.value === 'on';
      const footer = document.getElementById('settings-footer-status');
      try {
        const response = await fetch('/api/performance/recording/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider,
            source_mode: sourceMode,
            application_bundle_id: sourceMode === 'application' ? deviceName : undefined,
            device_name: sourceMode === 'device' ? deviceName : undefined,
            format,
            broadcast_enabled: broadcastEnabled,
          }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.error || 'Settings could not be saved');
        renderRecordingSaveDirectory(payload.save_directory);
        if (footer) footer.textContent = `${deviceName || 'Recording source'} selected. ${format.toUpperCase()} recordings will save to ${payload.save_directory || '~/Desktop'}.${broadcastEnabled ? ' The same clean feed will be available as AXIOM Broadcast.' : ''}`;
      } catch (error) {
        if (footer) footer.textContent = `Recording settings could not be saved: ${error.message}`;
      }
    }

    async function testSetRecordingInput() {
      const button = document.getElementById('recording-test-button');
      const resultEl = document.getElementById('recording-test-result');
      if (!button || !resultEl) return;
      await saveSetRecordingSettings();
      button.disabled = true;
      button.textContent = 'Listening...';
      resultEl.dataset.signal = 'idle';
      resultEl.textContent = 'Play audio now';
      try {
        const provider = document.getElementById('recording-provider-select')?.value || 'auto';
        const sourceMode = document.getElementById('recording-source-mode-select')?.value || 'application';
        const sourceId = document.getElementById('recording-device-select')?.value || '';
        const pair = sourceMode === 'device' ? selectedRecordingPair() : null;
        const response = await fetch('/api/performance/recording/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, source_mode: sourceMode, source_id: sourceId, ...(pair || {}) }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.error || 'Input test failed');
        const signal = payload.signal || {};
        resultEl.dataset.signal = signal.signal || 'none';
        resultEl.textContent = signal.dbfs == null ? signal.label || 'No signal' : `${signal.label} ${signal.dbfs} dB`;
      } catch (error) {
        resultEl.dataset.signal = 'none';
        resultEl.textContent = error.message || 'No signal';
      } finally {
        button.disabled = false;
        button.textContent = 'Test Signal';
      }
    }

    function toggleMasterHud() {
        const hud = document.getElementById('master-hud');
        const opening = !hud.classList.contains('active');
        hud.classList.toggle('active');
        if (opening) {
          setSettingsCategory('all');
          if (typeof isAxiomLite !== 'function' || !isAxiomLite()) {
            if (typeof checkPerformanceAccessibilityStatus === 'function') checkPerformanceAccessibilityStatus();
            loadSetRecordingSettings();
          }
          requestAnimationFrame(() => document.querySelector('#master-hud .settings-close')?.focus());
        }
    }

    function openLiteProInfo() {
      const hud = document.getElementById('master-hud');
      const card = document.getElementById('lite-pro-info-settings-item');
      if (!hud || !card) return false;
      if (!hud.classList.contains('active')) toggleMasterHud();
      setSettingsCategory('all');
      const input = document.getElementById('settings-search-input');
      if (input) input.value = '';
      filterSettingsRows('');
      requestAnimationFrame(() => {
        card.scrollIntoView({ block: 'center', behavior: 'smooth' });
        card.focus({ preventScroll: true });
        card.classList.add('settings-item-highlighted');
        setTimeout(() => card.classList.remove('settings-item-highlighted'), 1800);
      });
      return true;
    }

    function openAxiomPrivacyPolicy() {
      return openAxiomExternalUrl('https://djowe.com/privacy', 'privacy policy');
    }

    function closeMasterHud() {
      document.getElementById('master-hud')?.classList.remove('active');
    }

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && document.getElementById('master-hud')?.classList.contains('active')) {
        closeMasterHud();
      }
    });

    function openSettingsLibraryHealth() {
      closeMasterHud();
      showTab('health');
    }
