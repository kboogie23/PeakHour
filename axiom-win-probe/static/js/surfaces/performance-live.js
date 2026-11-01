    // Performance DJ bridge, gig profile, and Live Assist synchronization.
    let performanceSessionStartedAt = Date.now();
    function performanceAutoLiveAssistEnabled() {
      if (window.__AXIOM_NATIVE_LIVE_ASSIST_SMOKE_ACTIVE__ === true) return true;
      return localStorage.getItem(PERFORMANCE_AUTO_LIVE_ASSIST_KEY) !== 'off';
    }

    let performanceAccessibilityPollTimer = null;
    let performanceAccessibilityPollAttempts = 0;
    let performanceAccessibilityAppName = 'AXIOM';
    function formatAccessibilityTimestamp(value = 0) {
      const t = Number(value || 0);
      if (!Number.isFinite(t) || t <= 0) return 'Never';
      const parsed = new Date(t * 1000);
      if (!Number.isFinite(parsed.getTime())) return 'Never';
      return parsed.toLocaleString([], {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    }

    window.__AXIOM_NATIVE_ACCESSIBILITY_STATUS = function (detail = {}) {
      const row = document.getElementById('settings-performance-accessibility');
      const status = document.getElementById('settings-performance-accessibility-status');
      const copy = document.getElementById('settings-performance-accessibility-copy');
      const diagnostics = document.getElementById('settings-performance-accessibility-diagnostics');
      const nativeAvailable = detail.available !== false && isAxiomNativeShell();
      const trusted = detail.trusted === true;
      const listenerActive = detail.listenerActive === true;
      const accessAndListenerActive = trusted && listenerActive;
      performanceAccessibilityAppName = String(detail.permissionApp || 'AXIOM');
      const searchAccess = document.getElementById('performance-search-access');
      if (searchAccess) {
        searchAccess.hidden = !nativeAvailable || accessAndListenerActive;
        searchAccess.style.display = searchAccess.hidden ? 'none' : '';
        searchAccess.textContent = trusted ? 'Check Command-F connection' : 'Allow Mac access';
        searchAccess.title = trusted
          ? 'AXIOM is reconnecting Command-F automatically. Click to check now.'
          : `Performance is already on. Allow ${performanceAccessibilityAppName} in macOS Accessibility once for Command-F. AXIOM connects automatically when macOS grants access.`;
        searchAccess.onclick = trusted ? checkPerformanceAccessibilityStatus : openPerformanceAccessibilitySettings;
      }
      if (accessAndListenerActive) {
        clearTimeout(performanceAccessibilityPollTimer);
        performanceAccessibilityPollTimer = null;
        performanceAccessibilityPollAttempts = 0;
      }
      row?.classList.toggle('hidden', !nativeAvailable);
      if (status) {
        status.textContent = accessAndListenerActive
          ? 'Mac Search Access Active'
          : trusted ? 'Command-F reconnecting' : 'One-time Mac access needed';
      }
      if (copy) {
        copy.textContent = accessAndListenerActive
          ? 'Live Assist can move away automatically when you search in Serato or djay Pro.'
          : trusted
            ? 'Mac access is granted. AXIOM is reconnecting Command-F automatically.'
            : `Performance Mode is already on. Allow ${performanceAccessibilityAppName} in macOS Accessibility for Command-F. AXIOM connects automatically when macOS grants access; keep the app open.`;
      }
      if (diagnostics) {
        const detectedDj = String(detail.detectedDj || '').trim() || 'Not detected';
        const detectedBundle = String(detail.detectedDjBundleId || '').trim();
        diagnostics.innerHTML = [
          `macOS access: ${trusted ? 'granted' : 'missing'}`,
          `Command+F listener: ${listenerActive ? 'active' : 'inactive'}`,
          `DJ software detected: ${detectedDj}${detectedBundle ? ` (${detectedBundle})` : ''}`,
          `Last real Command+F received: ${formatAccessibilityTimestamp(detail.lastCmdFReceived)}`,
          `Last Live Assist restoration: ${formatAccessibilityTimestamp(detail.lastLiveAssistRestore)}`,
        ].join('<br>');
      }
    };
    function checkPerformanceAccessibilityStatus() {
      const nativeBridge = window.webkit?.messageHandlers?.axiomNative;
      if (!nativeBridge?.postMessage) return;
      nativeBridge.postMessage({ action: 'checkAccessibilityPermission' });
    }
    function openPerformanceAccessibilitySettings() {
      const nativeBridge = window.webkit?.messageHandlers?.axiomNative;
      if (!nativeBridge?.postMessage) {
        showToast('Mac Search Access is available in the installed AXIOM app.', true);
        return;
      }
      nativeBridge.postMessage({ action: 'openAccessibilitySettings' });
      showToast(`Allow ${performanceAccessibilityAppName} in macOS Accessibility, then return here. Keep AXIOM open; Command-F connects automatically when macOS grants access.`);
      clearTimeout(performanceAccessibilityPollTimer);
      performanceAccessibilityPollAttempts = 0;
      const pollForGrant = () => {
        performanceAccessibilityPollAttempts += 1;
        checkPerformanceAccessibilityStatus();
        if (performanceAccessibilityPollAttempts < 30) {
          performanceAccessibilityPollTimer = window.setTimeout(pollForGrant, 2000);
        }
      };
      performanceAccessibilityPollTimer = window.setTimeout(pollForGrant, 1200);
    }
    function quitAxiomApp() {
      const nativeBridge = window.webkit?.messageHandlers?.axiomNative;
      if (!nativeBridge?.postMessage) {
        showToast('Quit AXIOM is available in the installed app.', true);
        return;
      }
      nativeBridge.postMessage({ action: 'quitAxiom' });
      showToast('Quitting AXIOM...');
    }
    function applyPerformanceAutoLiveAssistPreference() {
      const enabled = performanceAutoLiveAssistEnabled();
      const toggle = document.getElementById('tab-auto-live-assist');
      const status = document.getElementById('settings-auto-live-assist-status');
      if (toggle) toggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
      if (status) status.textContent = `Automatic Live Assist ${enabled ? 'On' : 'Off'}`;
      if (isAxiomNativeShell()) checkPerformanceAccessibilityStatus();
      return enabled;
    }
    function togglePerformanceAutoLiveAssist() {
      const enabled = !performanceAutoLiveAssistEnabled();
      localStorage.setItem(PERFORMANCE_AUTO_LIVE_ASSIST_KEY, enabled ? 'on' : 'off');
      applyPerformanceAutoLiveAssistPreference();
      if (enabled && isAxiomNativeShell()) performancePollSeratoBridge(true).catch(() => {});
      showToast(`Automatic Live Assist ${enabled ? 'on' : 'off'}.`);
    }
    function performanceResetProviderScopedState() {
      performanceGigProfileTrackRequest = null;
      performanceDjProfileSources = [];
      performanceDjProfileSourcesLoaded = false;
      performanceDjProfileSourcesError = '';
      performanceGigProfileTrackCache = [];
      performanceGigProfileKeys = new Set();
      performanceGigProfileTrackCacheId = '';
      performanceSuggestions = [];
    }

    async function performanceHandleAutoLiveAssist(data = {}) {
      // The backend is the single owner of DJ-software event freshness. A
      // persisted Playing Now row must never reopen or repopulate Live Assist.
      const reportedTrack = data?.track && typeof data.track === 'object' ? data.track : null;
      const hasUsableTrack = Boolean(reportedTrack && (
        reportedTrack.path
        || reportedTrack.title
        || reportedTrack.name
        || reportedTrack.id
      ));
      if (
        !isAxiomNativeShell()
        || !performanceAutoLiveAssistEnabled()
        || !hasUsableTrack
        || data.fresh_event !== true
      ) return;
      const sessionToken = String(data.dj_session_token || '');
      const eventId = String(data.event_id || '');
      if (!sessionToken || performanceAutoLiveAssistSuppressedSessionToken === sessionToken) return;
      performanceAutoLiveAssistDjSessionToken = sessionToken;
      if (
        (eventId && performanceAutoLiveAssistOpenedEventId === eventId)
        || (eventId && performanceAutoLiveAssistPendingEventId === eventId)
      ) return;
      performanceAutoLiveAssistPendingEventId = eventId;
      switchTab('performance');
      renderPerformanceMode();
      let opened = false;
      try {
        opened = await showAxiomLiveAssist({
          auto: true,
          minimizeMain: true,
          djSessionToken: sessionToken,
        });
      } finally {
        if (performanceAutoLiveAssistPendingEventId === eventId) {
          performanceAutoLiveAssistPendingEventId = '';
        }
      }
      if (!opened) return;
      performanceAutoLiveAssistOpenedEventId = eventId;
      performanceAutoLiveAssistWindowOpen = performanceAutoLiveAssistSuppressedSessionToken !== sessionToken;
    }

    window.__AXIOM_LIVE_ASSIST_OPENED = function (detail = {}) {
      const requestId = String(detail.requestId || '');
      const pending = performanceLiveAssistOpenRequests.get(requestId);
      if (!pending) return;
      pending.settle(true);
    };

    window.__AXIOM_LIVE_ASSIST_SEARCH_HIDDEN = function () {
      // Cmd+F in Serato or djay temporarily moves only the native panel out of
      // the way. Performance Mode and its provider session remain active, and
      // the next backend-confirmed fresh deck load may open the panel again.
      performanceAutoLiveAssistWindowOpen = false;
      performanceAutoLiveAssistOpenedEventId = '';
      if (
        performanceAutoLiveAssistDjSessionToken
        && performanceAutoLiveAssistSuppressedSessionToken === performanceAutoLiveAssistDjSessionToken
      ) {
        performanceAutoLiveAssistSuppressedSessionToken = '';
      }
    };

    window.__AXIOM_LIVE_ASSIST_CLOSED = function () {
      performanceAutoLiveAssistWindowOpen = false;
      performanceAutoLiveAssistOpenedEventId = '';
      if (performanceAutoLiveAssistDjSessionToken) {
        performanceAutoLiveAssistSuppressedSessionToken = performanceAutoLiveAssistDjSessionToken;
      }
    };
    function performanceRequestNativeLiveAssistOpen(nativeBridge, payload = {}) {
      return new Promise(resolve => {
        const requestId = `live-assist-${Date.now()}-${++performanceLiveAssistOpenRequestSerial}`;
        let settled = false;
        const settle = success => {
          if (settled) return;
          settled = true;
          const pending = performanceLiveAssistOpenRequests.get(requestId);
          if (pending?.timer) clearTimeout(pending.timer);
          performanceLiveAssistOpenRequests.delete(requestId);
          resolve(Boolean(success));
        };
        const timer = setTimeout(() => settle(false), PERFORMANCE_LIVE_ASSIST_OPEN_ACK_TIMEOUT_MS);
        performanceLiveAssistOpenRequests.set(requestId, { settle, timer });
        try {
          nativeBridge.postMessage({
            ...payload,
            requestId,
            expanded: true,
          });
        } catch (error) {
          console.error('[AXIOM] Native Live Assist open request failed:', error);
          settle(false);
        }
      });
    }

    async function performanceOpenNativeLiveAssist(nativeBridge, payload = {}) {
      for (let attempt = 1; attempt <= PERFORMANCE_LIVE_ASSIST_OPEN_MAX_ATTEMPTS; attempt += 1) {
        if (await performanceRequestNativeLiveAssistOpen(nativeBridge, payload)) return true;
        if (attempt < PERFORMANCE_LIVE_ASSIST_OPEN_MAX_ATTEMPTS) {
          await new Promise(resolve => setTimeout(resolve, 180));
        }
      }
      console.error('[AXIOM] Native Live Assist did not acknowledge opening after retries.');
      return false;
    }

    function performanceRememberLivePlayedTrack(track = {}) {
      // Recommendation exclusion starts with observed playback. The session
      // report keeps its separate 60-second qualification rule.
      performanceTrackIdentityValues(track).forEach(key => performanceSessionPlayedFamilies.add(key));
    }

    function performanceMergeLiveHistory(history = [], currentTrack = null) {
      if (!Array.isArray(history) || !history.length) return 0;
      const currentKey = currentTrack ? performanceTrackKey(currentTrack) : '';
      let added = 0;
      history.forEach(rawTrack => {
        const normalized = performanceNormalizeLiveTrack(rawTrack || {});
        const key = performanceTrackKey(normalized);
        if (!key || (currentKey && key === currentKey)) return;
        if (normalized.is_live || normalized.end_time === -1 || normalized.end_time === 0) return;
        // An explicit reset must not import the previous session's DJ history.
        if (typeof performanceSessionStartedAt !== 'undefined' && performanceSessionStartedAt) {
          const end = Number(normalized.end_time || 0);
          const endedAt = end > 1e11 ? end : end * 1000;
          if (!Number.isFinite(endedAt) || endedAt <= performanceSessionStartedAt) return;
        }
        const historySource = `${normalized.live_provider || 'dj'}_session_history`;
        const playedSeconds = performanceTrackPlayDurationSeconds(normalized);
        if (playedSeconds > 0) performanceRememberLivePlayedTrack(normalized);
        if (playedSeconds <= PERFORMANCE_PLAYED_THRESHOLD_SECONDS) return;
        const didAdd = performanceAddTimelineTrack({
          ...normalized,
          source: historySource,
          played_from: historySource
        });
        if (didAdd) {
          performanceRememberPreference(normalized, 'history');
          added += 1;
        }
      });
      if (added) {
        renderPerformanceTimeline();
        renderPerformanceAudit();
        renderPerformanceRefines();
      }
      return added;
    }

    async function performancePollSeratoBridge(force = false) {
      const nativeAutoWatch = isAxiomNativeShell() && performanceAutoLiveAssistEnabled();
      if (!performanceSeratoEnabled && !nativeAutoWatch) return;
      const now = Date.now();
      if (!force && now < performanceSeratoNextPollAt) return;
      if (performanceSeratoPolling) {
        if (now - performanceSeratoPollingStartedAt < 10000) return;
        performanceSeratoPollingGeneration += 1;
        performanceSeratoPolling = false;
        console.warn('[AXIOM] Recovered a stale DJ live request.');
      }
      const visible = !document.getElementById('tab-content-performance')?.classList.contains('hidden');
      if (!visible && !force && !nativeAutoWatch) return;
      const pollGeneration = ++performanceSeratoPollingGeneration;
      const sessionVersion = performanceSessionVersion;
      performanceSeratoPolling = true;
      performanceSeratoPollingStartedAt = now;
      performanceSeratoNextPollAt = now + PERFORMANCE_LIVE_POLL_ACTIVE_MS;
      try {
        const data = await performanceReadSeratoBridgePayload();
        if (sessionVersion !== performanceSessionVersion) return;
        if (!data?.success || !data.track) {
          performanceSeratoNextPollAt = Date.now() + (
            nativeAutoWatch
              ? PERFORMANCE_LIVE_POLL_WAITING_MS
              : PERFORMANCE_LIVE_POLL_IDLE_MS
          );
          if (!data?.process_discovery_transient) {
            // Bridge diagnostics remain available in the backend/logs. They
            // must not replace the user-facing Now Playing surface.
            performanceSetSeratoStatus('', false);
          }
          return;
        }
        const isNewLiveTrackLoad = data.fresh_event === true;
        const track = performanceNormalizeLiveTrack({
          ...data.track,
          live_provider: data.track.live_provider || data.provider,
          source_label: data.track.source_label || data.source_label,
        }, { preservePlayingBpm: !isNewLiveTrackLoad });
        const key = performanceTrackKey(track);
        // The backend owns fresh-event detection because it can distinguish a
        // real deck load from a persisted Playing Now/history row. Never let a
        // changing local row marker rebuild an otherwise unchanged list.
        const sourceLabel = track.source_label || data.source_label || 'DJ software';
        const sourceCopy = track.live_provider === 'djay' ? 'now playing' : (track.deck ? `deck ${track.deck}` : 'history');
        performanceLiveSourceLabel = sourceLabel;
        const nextLiveProvider = track.live_provider || data.provider || '';
        const liveProviderChanged = nextLiveProvider !== performanceLiveProvider;
        if (liveProviderChanged) performanceResetProviderScopedState();
        performanceLiveProvider = nextLiveProvider;
        performanceSeratoLastTrack = track;
        let historyAdded = 0;
        let autoLiveAssistOpen = null;
        if (key && isNewLiveTrackLoad) {
          performanceLiveTrackRenderSignature = performanceLiveTrackDisplaySignature(track);
          if (performancePlayingBpmOverride) {
            performancePlayingBpmOverride = 0;
            performancePlayingBpmDraft = '';
            performanceTempoResetVersion += 1;
            const targetInput = document.getElementById('performance-playing-bpm-input');
            if (targetInput) targetInput.value = '';
            performancePublishTargetBpm(0);
          }
          performanceSeratoLastKey = key;
          performanceLiveTrackStartedAt = Date.now();
          performanceLiveTrackQualifiedKey = '';
          performanceSetAnchor(track, 'live');
          // Start the acknowledged native open before optional playlist/profile
          // hydration. A slow DJ database must never hold the pop-up behind it.
          autoLiveAssistOpen = performanceHandleAutoLiveAssist(data);
          showToast(`${sourceLabel} live: ${track.title || 'Track'}`);
        }
        historyAdded = performanceMergeLiveHistory(data.history || [], track);
        if (key && isNewLiveTrackLoad) {
          await autoLiveAssistOpen;
        } else {
          const liveIdentity = performanceLiveTrackIdentity(track).key;
          const anchorIdentity = performanceAnchorTrack
            ? performanceLiveTrackIdentity(performanceAnchorTrack).key
            : '';
          if (liveIdentity && liveIdentity === anchorIdentity) {
            const nextAnchorTrack = normalizeModalTrackMetadata({
              ...performanceAnchorTrack,
              ...track,
            });
            const nextRenderSignature = performanceLiveTrackDisplaySignature(nextAnchorTrack);
            performanceAnchorTrack = nextAnchorTrack;
            currentAnchorTrack = nextAnchorTrack;
            cacheTrackVisual(nextAnchorTrack);
            if (nextRenderSignature !== performanceLiveTrackRenderSignature) {
              performanceLiveTrackRenderSignature = nextRenderSignature;
              renderPerformanceNow();
            }
          }
          if (
            key
            && performanceLiveTrackStartedAt
            && performanceLiveTrackQualifiedKey !== key
            && Date.now() - performanceLiveTrackStartedAt > PERFORMANCE_PLAYED_THRESHOLD_SECONDS * 1000
          ) {
            performanceLiveTrackQualifiedKey = key;
            if (performanceAddTimelineTrack(track)) {
              renderPerformanceTimeline();
              renderPerformanceAudit();
              await performanceFetchSuggestions();
            }
          }
          renderPerformanceSignals();
          if (
            performanceAnchorTrack
            && liveIdentity && liveIdentity === anchorIdentity
            && performanceLiveTempoNeedsRefresh()
          ) {
            await performanceFetchSuggestions();
          }
          if (historyAdded) renderPerformanceSuggestions();
        }
        performanceSetSeratoStatus(`${sourceLabel}: ${sourceCopy} · ${track.title || 'live track'}`, true);
        renderPerformanceGigProfileControl();
      } catch (err) {
        performanceSetSeratoStatus('', false);
        console.error('DJ live bridge failed:', err);
      } finally {
        if (pollGeneration === performanceSeratoPollingGeneration) {
          performanceSeratoPolling = false;
          performanceSeratoPollingStartedAt = 0;
        }
      }
    }

    async function performanceReadSeratoBridgePayload() {
      const nativeSmokeActive = window.__AXIOM_NATIVE_LIVE_ASSIST_SMOKE_ACTIVE__ === true;
      const nativeSmokePayload = window.__AXIOM_NATIVE_LIVE_ASSIST_TEST_PAYLOAD__;
      if (nativeSmokePayload && typeof nativeSmokePayload === 'object') {
        delete window.__AXIOM_NATIVE_LIVE_ASSIST_TEST_PAYLOAD__;
        return JSON.parse(JSON.stringify(nativeSmokePayload));
      }
      // The extracted-app release journey must be deterministic even when
      // Serato or djay Pro is running on the build Mac. Once its one-shot
      // fixture has been consumed, do not let a real deck event contaminate
      // the smoke sequence or minimize the main window during manual reopen.
      if (nativeSmokeActive) {
        return {
          success: false,
          active: false,
          smoke_waiting: true,
          error: 'Native Live Assist smoke is waiting for its next fixture.',
        };
      }
      const browserLiveBridge = typeof window.AXIOM_BROWSER_PERFORMANCE_SERATO_LIVE === 'function'
        ? window.AXIOM_BROWSER_PERFORMANCE_SERATO_LIVE
        : null;
      try {
        const { resp, data } = await fetchJsonWithTimeout(
          '/api/performance/dj/live',
          { cache: 'no-store' },
          6000,
        );
        if (resp.ok && data?.success) return data;
        if (browserLiveBridge) return await browserLiveBridge({ server_error: data?.error || `Server bridge unavailable (${resp.status})` });
        return data;
      } catch (err) {
        if (browserLiveBridge) return await browserLiveBridge({ server_error: err?.message || 'Desktop bridge unavailable' });
        throw err;
      }
    }

    function performanceStartSeratoBridge() {
      performanceSetSeratoStatus('', performanceSeratoEnabled);
      if (!performanceSeratoEnabled) return;
      performancePollSeratoBridge(true);
      // The native WebKit shell owns the live bridge cadence through its
      // watchdog. Starting the browser interval there as well caused Serato
      // and djay Pro to be polled by two independent clocks.
      if (isAxiomNativeShell()) return;
      if (performanceSeratoPollTimer) return;
      performanceSeratoPollTimer = setInterval(() => performancePollSeratoBridge(false), 3200);
    }

    function performanceStopSeratoBridge() {
      if (performanceSeratoPollTimer) {
        clearInterval(performanceSeratoPollTimer);
        performanceSeratoPollTimer = null;
      }
      performanceSeratoNextPollAt = 0;
    }

    function performanceToggleSeratoBridge() {
      if (performanceSeratoEnabled
          && typeof window.AXIOM_BROWSER_REQUEST_PERFORMANCE_SERATO_ACCESS === 'function'
          && window.AXIOM_BROWSER_PERFORMANCE_SERATO_NEEDS_ACCESS?.()) {
        performanceSetSeratoStatus('Serato auto: choose your _Serato_ folder to read live history', false);
        window.AXIOM_BROWSER_REQUEST_PERFORMANCE_SERATO_ACCESS()
          .then(() => performancePollSeratoBridge(true))
          .catch(err => performanceSetSeratoStatus(err?.message || 'Serato folder access was not granted', false));
        return;
      }
      performanceSeratoEnabled = !performanceSeratoEnabled;
      if (performanceSeratoEnabled) {
        if (typeof window.AXIOM_BROWSER_REQUEST_PERFORMANCE_SERATO_ACCESS === 'function'
            && window.AXIOM_BROWSER_PERFORMANCE_SERATO_NEEDS_ACCESS?.()) {
          performanceSetSeratoStatus('Serato auto: choose your _Serato_ folder to read live history', false);
          window.AXIOM_BROWSER_REQUEST_PERFORMANCE_SERATO_ACCESS()
            .then(() => performanceStartSeratoBridge())
            .catch(err => performanceSetSeratoStatus(err?.message || 'Serato folder access was not granted', false));
          return;
        }
        performanceStartSeratoBridge();
      } else {
        performanceStopSeratoBridge();
      }
      performanceSetSeratoStatus('', performanceSeratoEnabled);
    }

    function performanceSetAnchor(track = {}, source = 'manual') {
      const normalized = normalizeModalTrackMetadata(track || {});
      if (!normalized.path && !normalized.title) {
        showToast('Choose a current track first.', true);
        return;
      }
      if (performanceCuedTrack && performanceTrackKey(performanceCuedTrack) === performanceTrackKey(normalized)) {
        performanceCuedTrack = null;
      }
      performanceAnchorTrack = normalized;
      if (source === 'live') performanceRememberLivePlayedTrack(normalized);
      currentAnchorTrack = normalized;
      cacheTrackVisual(normalized);
      renderPerformanceMode();
      performanceFetchSuggestions();
      if (source === 'manual') showToast(`Performance anchor set: ${normalized.title || 'Track'}`);
    }

    function performanceCueSuggestion(path) {
      const track = performanceSuggestionForPath(path);
      if (!track) return;
      performanceCuedTrack = normalizeModalTrackMetadata(track);
      cacheTrackVisual(performanceCuedTrack);
      renderPerformanceCuedNext();
      renderPerformanceSuggestions();
      showToast(`Cued next: ${performanceCuedTrack.title || 'Track'}`);
    }

    function performanceClearCue() {
      if (!performanceCuedTrack) {
        showToast('No cued Performance track to clear.', true);
        return;
      }
      performanceCuedTrack = null;
      renderPerformanceCuedNext();
      renderPerformanceSuggestions();
      showToast('Cued next cleared.');
    }

    function performancePlayCuedTrack() {
      if (!performanceCuedTrack) {
        showToast('Cue a Performance suggestion first.', true);
        return;
      }
      const next = normalizeModalTrackMetadata(performanceCuedTrack);
      performanceCuedTrack = null;
      performanceRememberPreference(next, 'choice');
      performanceSetAnchor(next, 'choice');
      showToast(`Playing cued next: ${next.title || 'Track'}`);
    }

    function performanceUsePlayingTrack() {
      const visiblePlayingRow = document.querySelector('.playing-track[data-path], .library-track-playing[data-path]');
      const visiblePlayingPath = visiblePlayingRow?.dataset?.path || '';
      const playerTitle = document.getElementById('ap-title')?.textContent?.trim() || '';
      const playerArtist = document.getElementById('ap-artist')?.textContent?.trim() || '';
      const playingPath = currentPlayingPath || visiblePlayingPath || currentAnchorTrack?.path || '';
      const cachedPlaying = playingPath ? (trackVisualCache.get(playingPath) || {}) : {};
      const playing = {
        ...(currentAnchorTrack || {}),
        ...cachedPlaying,
        path: playingPath || cachedPlaying.path || currentAnchorTrack?.path || '',
        title: cachedPlaying.title || currentAnchorTrack?.title || playerTitle,
        artist: cachedPlaying.artist || currentAnchorTrack?.artist || playerArtist
      };
      if (!playing || (!playing.path && !playing.title)) {
        showToast('Preview or select a track first, then use it in Performance Mode.', true);
        return;
      }
      performanceSetAnchor(playing, 'manual');
    }

    function performanceAddTimelineTrack(track = performanceAnchorTrack) {
      const normalized = normalizeModalTrackMetadata(track || {});
      const key = performanceTrackKey(normalized);
      if (!key) return false;
      if (performanceTimeline.some(item => performanceTrackKey(item) === key)) return false;
      performanceTimeline.push({
        ...normalized,
        played_at: new Date().toISOString()
      });
      performanceTrackIdentityValues(normalized).forEach(familyKey => {
        performanceSessionPlayedFamilies.add(familyKey);
      });
      performanceSuggestions = performanceSuggestions.filter(item => !performanceWasPlayed(item));
      if (
        performanceSelectedSuggestionPath
        && !performanceSuggestions.some(item => String(item.path || '') === performanceSelectedSuggestionPath)
      ) {
        performanceSelectedSuggestionPath = '';
      }
      queuePerformanceLiveAssistStateSync();
      return true;
    }

    function performanceMarkCurrentPlayed() {
      if (!performanceAnchorTrack) {
        showToast('Set a current Performance track first.', true);
        return;
      }
      const added = performanceAddTimelineTrack(performanceAnchorTrack);
      renderPerformanceTimeline();
      renderPerformanceAudit();
      performanceFetchSuggestions();
      showToast(added ? 'Added current track to live timeline.' : 'That track is already in the live timeline.');
    }

    function performanceChooseSuggestion(path) {
      const next = performanceSuggestionForPath(path);
      if (!next) return;
      performanceCuedTrack = null;
      performanceRememberPreference(next, 'choice');
      performanceSetAnchor(next, 'choice');
      showToast(`Next move selected: ${next.title || 'Track'}`);
    }

    function performancePreviewSuggestion(path) {
      const track = performanceSuggestionForPath(path);
      if (!track) return;
      playAudioFile(track.path, track.title || 'Unknown Title', track.artist || 'Unknown Artist', track.bpm || 0, track.camelot || '', track.energy || '', null, track.genre || '');
    }

    function performanceRefineSnapshot(label = 'refine') {
      return {
        label,
        hiddenPaths: [...performanceHiddenPaths],
        rejectedFamilies: [...performanceRejectedFamilies],
        rejectedGenres: [...performanceRejectedGenres],
        rejectedRoots: [...performanceRejectedRoots],
        preferredGenres: [...performancePreferredGenres],
        preferredRoots: [...performancePreferredRoots],
        preferredEras: [...performancePreferredEras],
        energyIntent: performanceEnergyIntent,
        tempoIntent: performanceTempoIntent,
        laneLock: performanceLaneLock,
        rescueMode: performanceRescueMode,
        safePicks: performanceSafePicks,
        cleanOnly: performanceCleanOnly,
        digDeeper: performanceDigDeeper,
        artistCooldown: performanceArtistCooldown,
        excludeKinds: [...performanceExcludeKinds],
        minYear: performanceMinYear,
        feedbackCounts: { ...performanceFeedbackCounts }
      };
    }

    function performanceRememberRefineState(label = 'refine') {
      performanceRefineHistory.push(performanceRefineSnapshot(label));
      if (performanceRefineHistory.length > 12) performanceRefineHistory.shift();
    }

    function performanceApplyRefineSnapshot(snapshot = null) {
      if (!snapshot) return false;
      performanceHiddenPaths = new Set(snapshot.hiddenPaths || []);
      performanceRejectedFamilies = new Set([
        ...performanceRejectedFamilies,
        ...(snapshot.rejectedFamilies || []),
      ]);
      performanceRejectedGenres = new Set(snapshot.rejectedGenres || []);
      performanceRejectedRoots = new Set(snapshot.rejectedRoots || []);
      performancePreferredGenres = new Set(snapshot.preferredGenres || []);
      performancePreferredRoots = new Set(snapshot.preferredRoots || []);
      performancePreferredEras = new Set(snapshot.preferredEras || []);
      performanceEnergyIntent = snapshot.energyIntent || '';
      performanceTempoIntent = snapshot.tempoIntent || '';
      performanceLaneLock = snapshot.laneLock || '';
      performanceRescueMode = Boolean(snapshot.rescueMode);
      performanceSafePicks = Boolean(snapshot.safePicks);
      performanceCleanOnly = Boolean(snapshot.cleanOnly);
      performanceDigDeeper = Boolean(snapshot.digDeeper);
      performanceArtistCooldown = snapshot.artistCooldown !== false;
      performanceExcludeKinds = new Set(snapshot.excludeKinds || []);
      performanceMinYear = snapshot.minYear || 0;
      performanceFeedbackCounts = { ...performanceFeedbackCounts, ...(snapshot.feedbackCounts || {}) };
      return true;
    }

    function performanceUndoRefine() {
      const snapshot = performanceRefineHistory.pop();
      if (!snapshot || !performanceApplyRefineSnapshot(snapshot)) {
        showToast('No Performance refine to undo.', true);
        renderPerformanceRefines();
        return;
      }
      renderPerformanceRefines();
      performanceFetchSuggestions();
      showToast(`Undid ${snapshot.label || 'last refine'}.`);
    }

    function performanceSetEnergyIntent(intent = '') {
      performanceRememberRefineState('energy');
      performanceEnergyIntent = performanceEnergyIntent === intent ? '' : intent;
      if (performanceEnergyIntent === 'up') performanceFeedbackCounts.energyUp += 1;
      if (performanceEnergyIntent === 'down') performanceFeedbackCounts.energyDown += 1;
      renderPerformanceRefines();
      performanceFetchSuggestions();
    }

    function performanceSetTempoIntent(intent = '') {
      performanceRememberRefineState('tempo');
      if (performancePlayingBpmOverride) {
        performancePlayingBpmOverride = 0;
        performancePlayingBpmDraft = '';
        performanceTempoResetVersion += 1;
        const input = document.getElementById('performance-playing-bpm-input');
        if (input) input.value = '';
      }
      performanceTempoIntent = performanceTempoIntent === intent ? '' : intent;
      performancePublishTargetBpm(0);
      if (performanceTempoIntent === 'double') performanceFeedbackCounts.doubleTime += 1;
      if (performanceTempoIntent === 'half') performanceFeedbackCounts.halfTime += 1;
      renderPerformanceRefines();
      renderPerformanceSignals();
      performanceFetchSuggestions();
    }

    function performanceSetLaneLock(lane = '') {
      performanceRememberRefineState('lane lock');
      performanceLaneLock = performanceLaneLock === lane ? '' : lane;
      if (performanceLaneLock) performanceFeedbackCounts.laneLock += 1;
      renderPerformanceRefines();
      performanceFetchSuggestions();
    }

    function performanceToggleExclude(kind = '') {
      if (!kind) return;
      performanceRememberRefineState(`no ${kind}`);
      if (performanceExcludeKinds.has(kind)) {
        performanceExcludeKinds.delete(kind);
      } else {
        performanceExcludeKinds.add(kind);
        performanceFeedbackCounts.excludes += 1;
      }
      renderPerformanceRefines();
      performanceFetchSuggestions();
    }

    function performanceToggleArtistCooldown() {
      performanceRememberRefineState('artist repeat guard');
      performanceArtistCooldown = !performanceArtistCooldown;
      renderPerformanceRefines();
      performanceFetchSuggestions();
      showToast(performanceArtistCooldown ? 'Recent artist repeat guard on.' : 'Recent artist repeats allowed.');
    }

    function performanceToggleSafePicks() {
      performanceRememberRefineState('safe picks');
      performanceSafePicks = !performanceSafePicks;
      renderPerformanceRefines();
      performanceFetchSuggestions();
      showToast(performanceSafePicks ? 'Safe Picks on.' : 'Safe Picks off.');
    }

    function performanceToggleCleanOnly() {
      performanceRememberRefineState('clean music only');
      performanceCleanOnly = !performanceCleanOnly;
      renderPerformanceRefines();
      performanceFetchSuggestions();
      showToast(performanceCleanOnly
        ? 'Clean Music Only on. Dirty, explicit, and unclassified tracks are excluded.'
        : 'Clean Music Only off.');
    }

    function performanceToggleDigDeeper() {
      performanceRememberRefineState('dig deeper');
      performanceDigDeeper = !performanceDigDeeper;
      renderPerformanceRefines();
      performanceFetchSuggestions();
      showToast(performanceDigDeeper ? 'Dig Deeper on.' : 'Dig Deeper off.');
    }

    function performanceToggleRescueMode() {
      performanceRememberRefineState('rescue');
      performanceRescueMode = !performanceRescueMode;
      if (performanceRescueMode) performanceFeedbackCounts.rescue += 1;
      renderPerformanceRefines();
      performanceFetchSuggestions();
      showToast(performanceRescueMode ? 'Rescue Mode on.' : 'Rescue Mode off.');
    }

    function performancePreferNewer(year = 0) {
      performanceRememberRefineState('too old');
      const parsedYear = parseInt(year, 10);
      if (parsedYear > 0) {
        performanceMinYear = Math.max(performanceMinYear || 0, parsedYear + 1);
      } else {
        const anchorYear = performanceTrackYear(performanceAnchorTrack || {});
        performanceMinYear = Math.max(performanceMinYear || 0, anchorYear || 2015);
      }
      renderPerformanceRefines();
      performanceFetchSuggestions();
    }

    function performanceRejectSuggestion(path, reason = 'hide') {
      const track = performanceSuggestionForPath(path);
      if (!track) return;
      performanceRememberRefineState(reason === 'genre' ? 'wrong genre' : (reason === 'old' ? 'too old' : 'hide'));
      if (reason === 'genre') {
        const genre = String(track.genre || '').trim().toLowerCase();
        performanceHiddenPaths.add(String(track.path || ''));
        if (genre) performanceRejectedGenres.add(genre);
        performanceFeedbackCounts.wrongGenre += 1;
        showToast(genre ? `${track.genre} reduced from Performance suggestions.` : 'That suggestion hidden.');
      } else if (reason === 'old') {
        const year = performanceTrackYear(track);
        performanceMinYear = Math.max(performanceMinYear || 0, year ? year + 1 : 2015);
        performanceFeedbackCounts.tooOld += 1;
        showToast('Older tracks reduced.');
      } else {
        performanceRejectTrackFamily(track);
        performanceFeedbackCounts.hidden += 1;
        showToast(`Rejected for this session: ${track.title || 'Suggestion'}`);
      }
      if (performanceSelectedSuggestionPath === String(track.path || '')) performanceSelectedSuggestionPath = '';
      renderPerformanceRefines();
      performanceFetchSuggestions();
    }

    function performanceMoreLikeThis(path) {
      const track = performanceSuggestionForPath(path);
      if (!track) return;
      performanceRememberRefineState('more like this');
      performanceRememberPreference(track, 'liked');
      renderPerformanceRefines();
      performanceFetchSuggestions();
      showToast(`More like: ${track.title || 'Track'}`);
    }

    function performanceMoreThisEra(path) {
      const track = performanceSuggestionForPath(path);
      if (!track) return;
      const era = performanceTrackEraKey(track);
      if (!era) {
        showToast('That track needs a release year before AXIOM can follow its era.', true);
        return;
      }
      performanceRememberRefineState('more this era');
      performancePreferredEras.add(era);
      performanceFeedbackCounts.liked += 1;
      renderPerformanceRefines();
      performanceFetchSuggestions();
      showToast(`More ${era} music.`);
    }

    function performanceMoreThisGenre(path) {
      const track = performanceSuggestionForPath(path);
      if (!track) return;
      const genre = performanceTrackGenre(track).toLowerCase();
      if (!genre) {
        showToast('That track needs a genre before AXIOM can follow it.', true);
        return;
      }
      performanceRememberRefineState('more this genre');
      performancePreferredGenres.add(genre);
      performanceFeedbackCounts.liked += 1;
      renderPerformanceRefines();
      performanceFetchSuggestions();
      showToast(`More ${performanceTrackGenre(track)}.`);
    }

    function loadPerformanceGigProfiles() {
      let liveProfileReplacementId = '';
      try {
        const raw = localStorage.getItem(PERFORMANCE_GIG_PROFILES_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        performanceGigProfiles = Array.isArray(parsed)
          ? parsed.filter(profile => profile && profile.id && profile.name).map(profile => ({
              ...profile,
              sourceIds: Array.isArray(profile.sourceIds)
                ? profile.sourceIds.filter(Boolean)
                : (Array.isArray(profile.seratoSourceIds) ? profile.seratoSourceIds.filter(Boolean) : [])
            }))
          : [];
        const liveProfile = performanceGigProfiles.find(profile => profile.id === PERFORMANCE_LIVE_CRATES_PROFILE_ID);
        if (liveProfile) {
          const savedMatch = performanceGigProfiles.find(profile => {
            if (profile.id === PERFORMANCE_LIVE_CRATES_PROFILE_ID) return false;
            return String(profile.name || '').trim().toLowerCase() === String(liveProfile.name || '').trim().toLowerCase();
          });
          if (savedMatch) {
            liveProfileReplacementId = savedMatch.id;
            performanceGigProfiles = performanceGigProfiles.filter(profile => profile.id !== PERFORMANCE_LIVE_CRATES_PROFILE_ID);
          }
        }
      } catch (_) {
        performanceGigProfiles = [];
      }
      try {
        const active = JSON.parse(localStorage.getItem(PERFORMANCE_GIG_PROFILE_ACTIVE_KEY) || '{}');
        const activeId = active.id === PERFORMANCE_LIVE_CRATES_PROFILE_ID && liveProfileReplacementId
          ? liveProfileReplacementId
          : active.id;
        performanceGigProfileId = performanceGigProfiles.some(profile => profile.id === activeId)
          ? activeId
          : (performanceGigProfiles[0]?.id || '');
        performanceGigProfileEnabled = Boolean(active.enabled && performanceGigProfileId);
      } catch (_) {
        performanceGigProfileId = performanceGigProfiles[0]?.id || '';
        performanceGigProfileEnabled = false;
      }
      performanceGigProfileColorsEnabled = localStorage.getItem(PERFORMANCE_GIG_PROFILE_COLORS_KEY) !== 'false';
      const activeProfile = currentPerformanceGigProfile();
      const hasSelectedSources = Boolean(
        performanceGigProfileEnabled
        && Array.isArray(activeProfile?.sourceIds)
        && activeProfile.sourceIds.some(Boolean)
      );
      if (hasSelectedSources) {
        loadPerformanceDjProfileSources()
          .then(() => refreshPerformanceGigProfileTrackCache({ force: true }))
          .catch(() => renderPerformanceGigProfileControl());
      } else {
        performanceGigProfileTrackCache = [];
        performanceGigProfileKeys = new Set();
        performanceGigProfileTrackCacheId = '';
        renderPerformanceGigProfileControl();
      }
      ensurePerformanceGigProfileControlSync();
    }

    function persistPerformanceGigProfiles() {
      localStorage.setItem(PERFORMANCE_GIG_PROFILES_STORAGE_KEY, JSON.stringify(performanceGigProfiles));
      localStorage.setItem(PERFORMANCE_GIG_PROFILE_ACTIVE_KEY, JSON.stringify({
        id: performanceGigProfileId,
        enabled: performanceGigProfileEnabled
      }));
      localStorage.setItem(PERFORMANCE_GIG_PROFILE_COLORS_KEY, performanceGigProfileColorsEnabled ? 'true' : 'false');
    }

    async function performancePollGigProfileControl() {
      if (isAxiomWebPreview() || performanceGigProfileControlApplying) return;
      performanceGigProfileControlApplying = true;
      try {
        const response = await fetch('/api/performance/gig_profile/selection', { cache: 'no-store' });
        const payload = await response.json().catch(() => ({}));
        const version = Number(payload.version || 0);
        if (!response.ok || !version || version <= performanceGigProfileControlVersion) return;
        performanceGigProfileControlVersion = version;
        performanceGigProfileColorsEnabled = payload.colors_enabled !== false;
        const sourceIds = Array.isArray(payload.source_ids) ? payload.source_ids.filter(Boolean) : [];
        const incomingProfileId = String(payload.profile_id || '').trim();
        const controlProfileId = incomingProfileId || PERFORMANCE_LIVE_CRATES_PROFILE_ID;
        const existingIndex = performanceGigProfiles.findIndex(profile => profile.id === controlProfileId);
        if (!sourceIds.length) {
          if (existingIndex >= 0) performanceGigProfiles.splice(existingIndex, 1);
          if (performanceGigProfileId === PERFORMANCE_LIVE_CRATES_PROFILE_ID) {
            performanceGigProfileId = performanceGigProfiles[0]?.id || '';
            performanceGigProfileEnabled = false;
          }
          performanceGigProfileOnlySelected = false;
          performanceGigProfileTrackCache = [];
          performanceGigProfileKeys = new Set();
          performanceGigProfileTrackCacheId = '';
          persistPerformanceGigProfiles();
          renderPerformanceGigProfileControl();
          queuePerformanceLiveAssistStateSync();
          if (performanceAnchorTrack) performanceFetchSuggestions();
          return;
        }
        await loadPerformanceDjProfileSources({ force: true });
        const previous = existingIndex >= 0 ? performanceGigProfiles[existingIndex] : null;
        const incomingName = String(payload.name || 'Live Crates');
        const savedProfile = performanceGigProfiles.find(profile => profile.id === controlProfileId) || null;
        const now = new Date().toISOString();
        const profile = {
          ...(savedProfile || previous || {}),
          id: controlProfileId,
          name: incomingName || savedProfile?.name || previous?.name || 'Live Crates',
          sourceIds: [...sourceIds],
          createdAt: savedProfile?.createdAt || previous?.createdAt || now,
          updatedAt: now,
        };
        const profileIndex = performanceGigProfiles.findIndex(item => item.id === profile.id);
        if (profileIndex >= 0) performanceGigProfiles.splice(profileIndex, 1, profile);
        else performanceGigProfiles.unshift(profile);
        performanceGigProfileId = profile.id;
        performanceGigProfileEnabled = payload.enabled !== false;
        performanceGigProfileOnlySelected = Boolean(payload.only_selected && performanceGigProfileEnabled);
        persistPerformanceGigProfiles();
        renderPerformanceGigProfileControl();
        await refreshPerformanceGigProfileTrackCache({ force: true });
        queuePerformanceLiveAssistStateSync();
        if (performanceAnchorTrack) await performanceFetchSuggestions();
        showToast(payload.enabled !== false
          ? `${profile.name} is now feeding Live Assist.`
          : `${profile.name} is paused. Usual recommendations stay on.`);
      } catch (error) {
        console.warn('[AXIOM] Live Assist Gig Profile control unavailable:', error);
      } finally {
        performanceGigProfileControlApplying = false;
      }
    }

    function ensurePerformanceGigProfileControlSync() {
      if (performanceGigProfileControlPollTimer || isAxiomWebPreview()) return;
      performancePollGigProfileControl();
      performancePollLiveAssistControl();
      performanceGigProfileControlPollTimer = setInterval(() => {
        performancePollGigProfileControl();
        // In the installed app the native watchdog is the one recurring owner
        // of Live Assist control polling. Browser sessions retain this shared
        // coordinator so neither surface loses functionality.
        if (!isAxiomNativeShell()) performancePollLiveAssistControl();
      }, 2500);
    }

    function performanceApplyLiveAssistFeedback(payload = {}) {
      const action = String(payload.action || payload.feedback_action || '');
      if (!action) return false;
      if (action === 'played') return false;
      const incoming = normalizeModalTrackMetadata(payload.track || payload.feedback_track || {});
      const path = String(incoming.path || '');
      if (path && !performanceSuggestionForPath(path)) cacheTrackVisual(incoming);
      if (action === 'reject') performanceRejectSuggestion(path, 'hide');
      else if (action === 'too_old') performanceRejectSuggestion(path, 'old');
      else if (action === 'wrong_genre') performanceRejectSuggestion(path, 'genre');
      else if (action === 'more_like') performanceMoreLikeThis(path);
      else if (action === 'more_era') performanceMoreThisEra(path);
      else if (action === 'more_genre') performanceMoreThisGenre(path);
      else return false;
      return true;
    }

    function performanceMergeLiveAssistLedger(payload = {}) {
      const ledger = payload.session_ledger && typeof payload.session_ledger === 'object'
        ? payload.session_ledger
        : {};
      const incomingSessionVersion = Number(
        ledger.session_version || payload.session_version || performanceSessionVersion
      );
      if (incomingSessionVersion < performanceSessionVersion) return;
      if (incomingSessionVersion > performanceSessionVersion) {
        performanceSessionVersion = incomingSessionVersion;
        performanceSessionPlayedFamilies.clear();
        performanceRejectedFamilies.clear();
        performanceTimeline = [];
      }
      (Array.isArray(ledger.rejected_families) ? ledger.rejected_families : [])
        .forEach(key => performanceRejectedFamilies.add(String(key || '').toLowerCase()));
      (Array.isArray(ledger.played_families) ? ledger.played_families : [])
        .forEach(key => performanceSessionPlayedFamilies.add(String(key || '').toLowerCase()));
    }

    async function performancePublishTargetBpm(targetBpm = 0) {
      if (isAxiomWebPreview()) return;
      const bpm = Number(targetBpm || 0);
      const payload = {
        session_version: performanceSessionVersion,
        tempo_intent: performanceTempoIntent,
      };
      if (Number.isFinite(bpm) && bpm >= 30 && bpm <= 300) payload.target_bpm = Number(bpm.toFixed(1));
      else payload.clear_target_bpm = true;
      try {
        await fetch('/api/performance/live_assist/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        console.warn('[AXIOM] Target BPM sync unavailable:', error);
      }
    }

    async function performancePollLiveAssistControl() {
      if (isAxiomWebPreview()) return false;
      const now = Date.now();
      if (performanceLiveAssistControlPolling) {
        if (now - performanceLiveAssistControlPollStartedAt < 10000) return false;
        performanceLiveAssistControlPollGeneration += 1;
        performanceLiveAssistControlPolling = false;
        console.warn('[AXIOM] Recovered a stale Live Assist control request.');
      }
      const pollGeneration = ++performanceLiveAssistControlPollGeneration;
      const sessionVersion = performanceSessionVersion;
      performanceLiveAssistControlPolling = true;
      performanceLiveAssistControlPollStartedAt = now;
      let refreshedRecommendations = false;
      try {
        const { resp: response, data: payload } = await fetchJsonWithTimeout(
          '/api/performance/live_assist/control',
          { cache: 'no-store' },
          6000,
        );
        const version = Number(payload.version || 0);
        if (sessionVersion !== performanceSessionVersion
          || Number(payload.session_version || sessionVersion) < performanceSessionVersion) return false;
        const refreshVersion = Number(payload.refresh_version || 0);
        const hasPendingRefresh = refreshVersion > performanceLiveAssistRefreshVersion;
        if (
          !response.ok
          || !version
          || (version <= performanceLiveAssistControlVersion && !hasPendingRefresh)
        ) return false;
        const previousVersion = performanceLiveAssistControlVersion;
        performanceLiveAssistControlVersion = Math.max(performanceLiveAssistControlVersion, version);
        performanceMergeLiveAssistLedger(payload);
        const nextIntent = ['half', 'double'].includes(payload.tempo_intent) ? payload.tempo_intent : '';
        const targetBpmVersion = Number(payload.target_bpm_version || 0);
        if (targetBpmVersion > performanceLiveAssistTargetBpmVersion) {
          performanceLiveAssistTargetBpmVersion = targetBpmVersion;
          const incomingTargetBpm = Number(payload.target_bpm || 0);
          performancePlayingBpmOverride = Number.isFinite(incomingTargetBpm)
            && incomingTargetBpm >= 30
            && incomingTargetBpm <= 300
            ? incomingTargetBpm
            : 0;
          performancePlayingBpmDraft = performancePlayingBpmOverride
            ? performanceBpmDisplay(performancePlayingBpmOverride)
            : '';
          const targetInput = document.getElementById('performance-playing-bpm-input');
          if (targetInput && document.activeElement !== targetInput) targetInput.value = performancePlayingBpmDraft;
          renderPerformanceSignals();
          renderPerformanceSuggestions();
        }
        const resetBaselineVersion = Number(payload.reset_baseline_version || 0);
        if (resetBaselineVersion > performanceLiveAssistResetBaselineVersion) {
          performanceLiveAssistResetBaselineVersion = resetBaselineVersion;
          performancePlayingBpmOverride = 0;
          performancePlayingBpmDraft = '';
          performanceTempoResetVersion += 1;
          if (performancePlayingBpmDebounceTimer) clearTimeout(performancePlayingBpmDebounceTimer);
          performancePlayingBpmDebounceTimer = null;
          const input = document.getElementById('performance-playing-bpm-input');
          if (input) input.value = '';
          renderPerformanceSignals();
        }
        const events = Array.isArray(payload.events) ? payload.events : [];
        events
          .filter(event => Number(event?.version || 0) > previousVersion)
          .filter(event => Number(event?.session_version || performanceSessionVersion) === performanceSessionVersion)
          .forEach(event => performanceApplyLiveAssistFeedback(event));
        performanceTempoIntent = nextIntent;
        if (payload.assist_preferences) performanceAssistPreferences = payload.assist_preferences;
        if (Object.prototype.hasOwnProperty.call(payload, 'year_mode')) performanceYearMode = ['new', 'old'].includes(payload.year_mode) ? payload.year_mode : '';
        renderPerformanceRefines();
        if (refreshVersion > performanceLiveAssistRefreshVersion) {
          const refreshed = await performanceFetchSuggestions({ reshuffle: true });
          if (!refreshed) return false;
          performanceLiveAssistRefreshVersion = refreshVersion;
          refreshedRecommendations = true;
          showToast(resetBaselineVersion > 0
            ? 'Performance refreshed at the current BPM.'
            : 'Performance recommendations refreshed.');
        }
      } catch (error) {
        console.warn('[AXIOM] Live Assist tempo control unavailable:', error);
      } finally {
        if (pollGeneration === performanceLiveAssistControlPollGeneration) {
          performanceLiveAssistControlPolling = false;
          performanceLiveAssistControlPollStartedAt = 0;
        }
      }
      return refreshedRecommendations;
    }

    function currentPerformanceGigProfile() {
      return performanceGigProfiles.find(profile => profile.id === performanceGigProfileId) || null;
    }

    function performanceActiveDjProfileSources(sources = performanceDjProfileSources, provider = '') {
      const activeProvider = ['serato', 'djay'].includes(provider) ? provider : '';
      return activeProvider ? sources.filter(source => source.provider === activeProvider) : sources;
    }

    function performanceDjProfileSourceSelectable(source = {}) {
      return Number(source.matched_track_count || 0) > 0 || Number(source.track_count || 0) > 0;
    }

    function performanceLiveProviderDjProfileSources(sources = performanceDjProfileSources) {
      const provider = ['serato', 'djay'].includes(performanceLiveProvider) ? performanceLiveProvider : '';
      return provider ? sources.filter(source => source.provider === provider) : sources;
    }

    function performanceActiveGigProfileSourceIds(profile = currentPerformanceGigProfile()) {
      const sourceIds = Array.isArray(profile?.sourceIds) ? profile.sourceIds.filter(Boolean) : [];
      const provider = ['serato', 'djay'].includes(performanceLiveProvider) ? performanceLiveProvider : '';
      if (!provider || !performanceDjProfileSources.length) return sourceIds;
      const allowed = new Set(performanceActiveDjProfileSources(performanceDjProfileSources, provider).map(source => source.id));
      return sourceIds.filter(sourceId => allowed.has(sourceId));
    }

    async function loadPerformanceDjProfileSources({ force = false } = {}) {
      if (isAxiomWebPreview()) {
        performanceDjProfileSources = [];
        performanceDjProfileSourcesLoaded = true;
        return [];
      }
      if (performanceDjProfileSourcesPromise) return performanceDjProfileSourcesPromise;
      if (performanceDjProfileSourcesLoaded && !force) return performanceDjProfileSources;
      performanceDjProfileSourcesLoading = true;
      performanceDjProfileSourcesError = '';
      performanceDjProfileSourcesPromise = (async () => {
        try {
          const { resp: response, data: payload } = await fetchJsonWithTimeout(
            '/api/performance/gig_profile/sources?summary=1', { cache: 'no-store' }, 60000);
          if (!response.ok || payload.success === false) throw new Error(payload.error || 'DJ playlists could not be read.');
          performanceDjProfileSources = Array.isArray(payload.sources) ? payload.sources : [];
          performanceDjProfileSourcesLoaded = true;
          return performanceDjProfileSources;
        } catch (error) {
          performanceDjProfileSourcesLoaded = false;
          performanceDjProfileSourcesError = error.message || 'DJ playlists could not be read.';
          return [];
        } finally {
          performanceDjProfileSourcesLoading = false;
          performanceDjProfileSourcesPromise = null;
          renderPerformanceGigProfileControl();
        }
      })();
      return performanceDjProfileSourcesPromise;
    }

    function performanceGigProfileTracks(profile = currentPerformanceGigProfile()) {
      return profile && profile.id === performanceGigProfileId ? performanceGigProfileTrackCache : [];
    }

    async function refreshPerformanceGigProfileTrackCache({ force = false } = {}) {
      const profile = currentPerformanceGigProfile();
      if (profile && performanceLiveProvider && !performanceDjProfileSourcesLoaded) await loadPerformanceDjProfileSources();
      const sourceIds = performanceActiveGigProfileSourceIds(profile);
      const cacheId = profile ? `${profile.id}:${performanceLiveProvider || 'all'}:${sourceIds.slice().sort().join('|')}` : '';
      if (profile !== currentPerformanceGigProfile()) return refreshPerformanceGigProfileTrackCache();
      if (!profile || !sourceIds.length) {
        performanceGigProfileTrackRequest = null;
        performanceGigProfileTrackCache = [];
        performanceGigProfileKeys = new Set();
        performanceGigProfileTrackCacheId = cacheId;
        renderPerformanceGigProfileControl();
        return [];
      }
      if (performanceGigProfileTrackRequest?.cacheId === cacheId) return performanceGigProfileTrackRequest.promise;
      if (!force && performanceGigProfileTrackCacheId === cacheId) return performanceGigProfileTrackCache;
      performanceGigProfileTrackCacheId = '';
      renderPerformanceGigProfileControl();
      const request = { cacheId, promise: null };
      performanceGigProfileTrackRequest = request;
      request.promise = (async () => {
        const stillCurrent = () => performanceGigProfileTrackRequest === request
          && currentPerformanceGigProfile()?.id === profile.id
          && cacheId === `${profile.id}:${performanceLiveProvider || 'all'}:${performanceActiveGigProfileSourceIds(profile).slice().sort().join('|')}`;
        try {
          const { resp: response, data: payload } = await fetchJsonWithTimeout('/api/performance/gig_profile/tracks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_ids: sourceIds, live_assist: true }),
          }, 60000);
          if (!stillCurrent()) return [];
          if (!response.ok || payload.success === false) throw new Error(payload.error || 'Profile tracks could not be matched.');
          performanceGigProfileTrackCache = (Array.isArray(payload.tracks) ? payload.tracks : [])
            .map(normalizeModalTrackMetadata);
          performanceGigProfileKeys = new Set(performanceGigProfileTrackCache.map(performanceTrackKey).filter(Boolean));
          performanceGigProfileTrackCacheId = cacheId;
        } catch (error) {
          if (!stillCurrent()) return [];
          performanceGigProfileTrackCache = [];
          performanceGigProfileKeys = new Set();
          // A failed read is not an empty playlist. Leave it retryable.
          performanceGigProfileTrackCacheId = '';
          performanceDjProfileSourcesError = 'Selected playlists could not finish loading. Refresh to retry.';
          showToast(performanceDjProfileSourcesError, true);
        }
        renderPerformanceGigProfileControl();
        return performanceGigProfileTrackCache;
      })().finally(() => {
        if (performanceGigProfileTrackRequest === request) performanceGigProfileTrackRequest = null;
      });
      return request.promise;
    }

    function performanceTrackInGigProfile(track = {}) {
      return Boolean(performanceGigProfileEnabled && performanceGigProfileKeys.has(performanceTrackKey(track)));
    }

    function performanceTrackGigProfileProviders(track = {}) {
      if (!performanceTrackInGigProfile(track)) return [];
      const key = performanceTrackKey(track);
      const matched = performanceGigProfileTrackCache.find(item => performanceTrackKey(item) === key) || track;
      const providers = [];
      if (Array.isArray(matched.serato_profile_sources) && matched.serato_profile_sources.length) providers.push('serato');
      if (Array.isArray(matched.djay_profile_sources) && matched.djay_profile_sources.length) providers.push('djay');
      return providers;
    }

    function performanceTrackGigProfileTone(track = {}) {
      const providers = performanceTrackGigProfileProviders(track);
      if (providers.length > 1) return 'mixed';
      return providers[0] || '';
    }

    function performanceGigProfileSourceSummary(profile = currentPerformanceGigProfile()) {
      if (!profile) {
        if (performanceLiveProvider === 'serato') return 'Choose the Serato crates for this gig.';
        if (performanceLiveProvider === 'djay') return 'Choose the djay Pro playlists for this gig.';
        return 'Choose Serato crates or djay Pro playlists for this gig.';
      }
      const sourceIds = performanceActiveGigProfileSourceIds(profile);
      const selectedSources = sourceIds.map(id => performanceDjProfileSources.find(item => item.id === id)).filter(Boolean);
      const providers = [...new Set(selectedSources.map(source => source.provider_label).filter(Boolean))];
      const providerCopy = providers.length ? ` · ${providers.join(' + ')}` : '';
      const trackCount = performanceGigProfileTracks(profile).length;
      if (!performanceGigProfileTrackCacheId && sourceIds.length) return `Matching ${sourceIds.length} DJ source${sourceIds.length === 1 ? '' : 's'}...`;
      if (!trackCount && sourceIds.length) return `${sourceIds.length} source${sourceIds.length === 1 ? '' : 's'} · no matching AXIOM tracks${providerCopy}`;
      return `${trackCount} matched track${trackCount === 1 ? '' : 's'} · ${sourceIds.length} source${sourceIds.length === 1 ? '' : 's'}${providerCopy}`;
    }

    function renderPerformanceGigProfileControl() {
      const root = document.getElementById('performance-gig-profile');
      const select = document.getElementById('performance-gig-profile-select');
      const toggle = document.getElementById('performance-gig-profile-toggle');
      const onlySelected = document.getElementById('performance-gig-profile-only-selected');
      const colors = document.getElementById('performance-gig-profile-colors');
      const summary = document.getElementById('performance-gig-profile-summary');
      if (!root || !select || !toggle || !onlySelected || !colors || !summary) return;
      const profile = currentPerformanceGigProfile();
      const selectedSources = (profile?.sourceIds || [])
        .map(id => performanceDjProfileSources.find(source => source.id === id))
        .filter(Boolean);
      const profileProviders = new Set(selectedSources.map(source => source.provider).filter(Boolean));
      const connectedProvider = ['serato', 'djay'].includes(performanceLiveProvider) ? performanceLiveProvider : '';
      const providerTone = connectedProvider
        || (profileProviders.size > 1 ? 'mixed' : [...profileProviders][0] || '');
      select.innerHTML = performanceGigProfiles.length
        ? performanceGigProfiles.map(profile => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)}</option>`).join('')
        : '<option value="">No profile prepared</option>';
      select.value = performanceGigProfileId;
      select.disabled = !performanceGigProfiles.length;
      toggle.textContent = performanceGigProfileEnabled ? 'On' : 'Off';
      toggle.classList.toggle('active', performanceGigProfileEnabled);
      onlySelected.classList.toggle('active', performanceGigProfileEnabled && performanceGigProfileOnlySelected);
      onlySelected.setAttribute('aria-pressed', performanceGigProfileEnabled && performanceGigProfileOnlySelected ? 'true' : 'false');
      const colorsLabel = colors.querySelector('span');
      if (colorsLabel) colorsLabel.textContent = performanceGigProfileColorsEnabled ? 'On' : 'Off';
      else colors.textContent = performanceGigProfileColorsEnabled ? 'Track Colours On' : 'Track Colours Off';
      colors.classList.toggle('active', performanceGigProfileColorsEnabled);
      colors.setAttribute('aria-pressed', performanceGigProfileColorsEnabled ? 'true' : 'false');
      root.classList.toggle('is-active', performanceGigProfileEnabled);
      root.classList.toggle('is-exclusive', performanceGigProfileEnabled && performanceGigProfileOnlySelected);
      root.classList.toggle('provider-serato', providerTone === 'serato');
      root.classList.toggle('provider-djay', providerTone === 'djay');
      root.classList.toggle('provider-mixed', providerTone === 'mixed');
      const connectionCopy = connectedProvider === 'serato'
        ? 'SERATO CONNECTED · '
        : (connectedProvider === 'djay' ? 'DJAY PRO CONNECTED · ' : '');
      const sourceModeCopy = performanceGigProfileEnabled && performanceGigProfileOnlySelected
        ? 'ONLY SELECTED · '
        : '';
      summary.textContent = `${connectionCopy}${sourceModeCopy}${performanceGigProfileSourceSummary()}`;
    }

    async function performanceSelectGigProfile(id) {
      performanceGigProfileId = performanceGigProfiles.some(profile => profile.id === id) ? id : '';
      if (!performanceGigProfileId) {
        performanceGigProfileEnabled = false;
        performanceGigProfileOnlySelected = false;
      }
      persistPerformanceGigProfiles();
      renderPerformanceGigProfileControl();
      await refreshPerformanceGigProfileTrackCache({ force: true });
      renderPerformanceRefines();
      queuePerformanceLiveAssistStateSync();
      if (performanceAnchorTrack) performanceFetchSuggestions();
    }

    async function performanceToggleGigProfile() {
      if (!performanceGigProfiles.length || !performanceGigProfileId) {
        openPerformanceGigProfileManager();
        return;
      }
      performanceGigProfileEnabled = !performanceGigProfileEnabled;
      if (!performanceGigProfileEnabled) performanceGigProfileOnlySelected = false;
      persistPerformanceGigProfiles();
      renderPerformanceGigProfileControl();
      renderPerformanceRefines();
      if (performanceGigProfileEnabled) await refreshPerformanceGigProfileTrackCache();
      await performancePushLiveCratesControl();
      queuePerformanceLiveAssistStateSync();
      if (performanceAnchorTrack) performanceFetchSuggestions();
      showToast(performanceGigProfileEnabled
          ? `${currentPerformanceGigProfile()?.name || 'Gig Profile'} is feeding Live Assist.`
          : 'Gig Profile paused. Usual recommendations stay on.');
    }

    async function performanceToggleGigProfileOnlySelected() {
      const profile = currentPerformanceGigProfile();
      const sourceIds = performanceActiveGigProfileSourceIds(profile);
      if (!profile || !sourceIds.length) {
        openPerformanceGigProfileManager();
        showToast('Choose at least one Serato crate or djay Pro playlist first.', true);
        return;
      }
      performanceGigProfileOnlySelected = !performanceGigProfileOnlySelected;
      if (performanceGigProfileOnlySelected) {
        performanceGigProfileEnabled = true;
        await refreshPerformanceGigProfileTrackCache();
      }
      renderPerformanceGigProfileControl();
      renderPerformanceRefines();
      await performancePushLiveCratesControl();
      queuePerformanceLiveAssistStateSync();
      if (performanceAnchorTrack) await performanceFetchSuggestions();
      showToast(performanceGigProfileOnlySelected
        ? 'Only selected playlists will be recommended for this Performance session.'
        : 'Usual AXIOM recommendations are back alongside Live Crates.');
    }

    async function performancePushLiveCratesControl() {
      const profile = currentPerformanceGigProfile();
      if (profile?.id !== PERFORMANCE_LIVE_CRATES_PROFILE_ID) return;
      try {
        const response = await fetch('/api/performance/gig_profile/selection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_ids: Array.isArray(profile.sourceIds) ? profile.sourceIds : [],
            enabled: performanceGigProfileEnabled,
            only_selected: performanceGigProfileOnlySelected,
            colors_enabled: performanceGigProfileColorsEnabled,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (response.ok && payload.version) performanceGigProfileControlVersion = Number(payload.version);
      } catch (error) {
        console.warn('[AXIOM] Gig Profile control sync unavailable:', error);
      }
    }

    async function performanceToggleGigProfileColors() {
      performanceGigProfileColorsEnabled = !performanceGigProfileColorsEnabled;
      persistPerformanceGigProfiles();
      renderPerformanceGigProfileControl();
      renderPerformanceSuggestions();
      await performancePushLiveCratesControl();
      queuePerformanceLiveAssistStateSync();
      showToast(performanceGigProfileColorsEnabled
        ? 'Serato and djay Pro track colours are on.'
        : 'Track colours are off. Gig Profile recommendations stay active.');
    }

    function closePerformanceGigProfileManager() {
      document.getElementById('performance-gig-profile-modal')?.remove();
    }

    function performanceDjProfileSourceParts(source = {}) {
      const parts = Array.isArray(source.path_parts)
        ? source.path_parts.map(part => String(part || '').trim()).filter(Boolean)
        : String(source.name || '').split('/').map(part => part.trim()).filter(Boolean);
      return parts.length ? parts : [String(source.leaf_name || source.name || 'Untitled Source')];
    }

    function performanceBuildDjProfileSourceForest(sources = []) {
      const providers = new Map();
      sources.forEach(source => {
        const provider = String(source.provider || 'library');
        if (!providers.has(provider)) {
          providers.set(provider, {
            provider,
            label: source.provider_label || 'DJ Library',
            roots: new Map(),
          });
        }
        let children = providers.get(provider).roots;
        performanceDjProfileSourceParts(source).forEach((part, index, parts) => {
          if (!children.has(part)) children.set(part, { label: part, source: null, children: new Map() });
          const node = children.get(part);
          if (index === parts.length - 1) node.source = source;
          children = node.children;
        });
      });
      return [...providers.values()].sort((left, right) => left.label.localeCompare(right.label));
    }

    function performanceDjProfileNodeSearch(node) {
      return [
        node.label,
        node.source?.provider_label,
        node.source?.name,
        ...[...node.children.values()].map(performanceDjProfileNodeSearch),
      ].filter(Boolean).join(' ').toLowerCase();
    }

    function performanceDjProfileNodeSelected(node, selectedIds) {
      if (node.source && selectedIds.has(node.source.id)) return true;
      return [...node.children.values()].some(child => performanceDjProfileNodeSelected(child, selectedIds));
    }

    function performanceDjProfileNodeSelectableIds(node) {
      const ids = [];
      if (node.source && performanceDjProfileSourceSelectable(node.source)) ids.push(node.source.id);
      node.children.forEach(child => ids.push(...performanceDjProfileNodeSelectableIds(child)));
      return ids;
    }

    function renderPerformanceDjProfileSourceNode(node, selectedIds, depth = 0) {
      const children = [...node.children.values()]
        .map(child => renderPerformanceDjProfileSourceNode(child, selectedIds, depth + 1))
        .join('');
      const source = node.source;
      const matched = Number(source?.matched_track_count || 0);
      const total = Number(source?.track_count || 0);
      const disabled = source && !performanceDjProfileSourceSelectable(source);
      const selectableIds = performanceDjProfileNodeSelectableIds(node);
      const selectedCount = selectableIds.filter(id => selectedIds.has(id)).length;
      const allSelected = selectableIds.length > 0 && selectedCount === selectableIds.length;
      const partiallySelected = selectedCount > 0 && !allSelected;
      const checkbox = children
        ? `<input type="checkbox" data-gig-dj-branch-ids="${escapeHtml(JSON.stringify(selectableIds))}" data-indeterminate="${partiallySelected ? 'true' : 'false'}" onclick="event.stopPropagation()" ${allSelected ? 'checked' : ''} ${selectableIds.length ? '' : 'disabled'}>`
        : `<input type="checkbox" data-gig-dj-source-id="${escapeHtml(source.id)}" onclick="event.stopPropagation()" ${selectedIds.has(source.id) ? 'checked' : ''} ${disabled ? 'disabled' : ''}>`;
      const count = children
        ? `<small data-gig-dj-branch-count style="color:${source?.provider === 'djay' ? '#ffad63' : '#69c5ff'};font-size:8px;font-weight:900;text-align:right;">${selectedCount}/${selectableIds.length} selected</small>`
        : `<small style="color:${source?.provider === 'djay' ? '#ffad63' : '#69c5ff'};font-size:8px;font-weight:900;text-align:right;">${matched}/${total}</small>`;
      const row = `<span data-gig-dj-source-row data-gig-dj-source-search="${escapeHtml(`${source?.provider_label || ''} ${source?.name || node.label}`.toLowerCase())}" style="display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;min-height:40px;padding-left:${depth * 14}px;opacity:${disabled ? '.45' : '1'};">
        ${checkbox}<strong style="min-width:0;color:#fff;font-size:11px;font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(node.label)}</strong>${count}
      </span>`;
      if (!children) return `<label style="display:block;border-bottom:1px solid rgba(255,255,255,.07);cursor:${disabled ? 'not-allowed' : 'pointer'};">${row}</label>`;
      return `<details data-gig-dj-source-branch data-gig-dj-source-search="${escapeHtml(performanceDjProfileNodeSearch(node))}" style="border-bottom:1px solid rgba(255,255,255,.06);">
        <summary style="list-style:none;cursor:pointer;">${row}</summary>${children}
      </details>`;
    }

    function renderPerformanceDjProfileSourceTree(sources, selectedIds) {
      return performanceBuildDjProfileSourceForest(performanceActiveDjProfileSources(sources)).map(provider => {
        const children = [...provider.roots.values()]
          .map(node => renderPerformanceDjProfileSourceNode(node, selectedIds, 0))
          .join('');
        return `<details data-gig-dj-source-branch data-gig-dj-source-search="${escapeHtml(`${provider.label} ${[...provider.roots.values()].map(performanceDjProfileNodeSearch).join(' ')}`.toLowerCase())}" open style="border:1px solid rgba(255,255,255,.09);margin-top:8px;">
          <summary style="list-style:none;padding:10px 12px;color:${provider.provider === 'djay' ? '#ffad63' : '#69c5ff'};font-size:9px;font-weight:900;text-transform:uppercase;cursor:pointer;background:rgba(255,255,255,.035);">${escapeHtml(provider.label)} · ${provider.roots.size} top-level</summary>
          ${children}
        </details>`;
      }).join('');
    }

    function refreshPerformanceDjProfileBranchStates(modal) {
      const selectedIds = modal?.gigProfileSelectedIds || new Set();
      modal?.querySelectorAll('[data-gig-dj-source-id]').forEach(input => {
        input.checked = selectedIds.has(input.getAttribute('data-gig-dj-source-id'));
      });
      modal?.querySelectorAll('[data-gig-dj-branch-ids]').forEach(input => {
        let sourceIds = [];
        try { sourceIds = JSON.parse(input.getAttribute('data-gig-dj-branch-ids') || '[]'); } catch (_) {}
        const selectedCount = sourceIds.filter(id => selectedIds.has(id)).length;
        input.checked = sourceIds.length > 0 && selectedCount === sourceIds.length;
        input.indeterminate = selectedCount > 0 && selectedCount < sourceIds.length;
        const count = input.closest('[data-gig-dj-source-row]')?.querySelector('[data-gig-dj-branch-count]');
        if (count) count.textContent = `${selectedCount}/${sourceIds.length} selected`;
      });
      const selectionCount = modal?.querySelector('[data-gig-dj-selection-count]');
      if (selectionCount) selectionCount.textContent = `${selectedIds.size} selected`;
    }

    function performanceBulkSelectDjProfileSources(selectAll = true) {
      const modal = document.getElementById('performance-gig-profile-modal');
      if (!modal) return;
      const activeIds = performanceActiveDjProfileSources()
        .filter(performanceDjProfileSourceSelectable)
        .map(source => source.id);
      if (selectAll) activeIds.forEach(sourceId => modal.gigProfileSelectedIds.add(sourceId));
      else activeIds.forEach(sourceId => modal.gigProfileSelectedIds.delete(sourceId));
      refreshPerformanceDjProfileBranchStates(modal);
    }

    function filterPerformanceDjProfileSources(query = '') {
      const wanted = String(query || '').trim().toLowerCase();
      document.querySelectorAll('[data-gig-dj-source-row]').forEach(row => {
        const matches = !wanted || String(row.getAttribute('data-gig-dj-source-search') || '').includes(wanted);
        row.style.display = matches ? 'grid' : 'none';
      });
      document.querySelectorAll('[data-gig-dj-source-branch]').forEach(branch => {
        const matches = !wanted || String(branch.getAttribute('data-gig-dj-source-search') || '').includes(wanted);
        branch.hidden = !matches;
        if (wanted && matches) branch.open = true;
      });
    }

    async function refreshPerformanceGigProfileManagerSources() {
      const editingId = String(document.getElementById('gig-profile-existing')?.value || performanceGigProfileId || '');
      await loadPerformanceDjProfileSources({ force: true });
      if (editingId && editingId === performanceGigProfileId) {
        await refreshPerformanceGigProfileTrackCache({ force: true });
      }
      openPerformanceGigProfileManager(editingId);
    }

    async function openPerformanceGigProfileManager(profileId = performanceGigProfileId) {
      await loadPerformanceDjProfileSources();
      closePerformanceGigProfileManager();
      const existing = performanceGigProfiles.find(profile => profile.id === profileId) || null;
      if (existing) performanceGigProfileId = existing.id;
      const selectedIds = new Set(Array.isArray(existing?.sourceIds) ? existing.sourceIds.filter(Boolean) : []);
      const activeSourceLabel = 'Serato crates and djay Pro playlists';
      const sourceRows = performanceActiveDjProfileSources().length
        ? renderPerformanceDjProfileSourceTree(performanceDjProfileSources, selectedIds)
        : `<p style="color:rgba(255,255,255,.48);font-size:10px;font-weight:800;line-height:1.5;">${escapeHtml(performanceDjProfileSourcesError || `No ${activeSourceLabel} were found. Open your DJ app once, then refresh sources.`)}</p>`;
      const profileOptions = performanceGigProfiles.map(profile => `<option value="${escapeHtml(profile.id)}" ${profile.id === existing?.id ? 'selected' : ''}>${escapeHtml(profile.name)}</option>`).join('');
      const modal = document.createElement('div');
      modal.id = 'performance-gig-profile-modal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:12000;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;padding:20px;';
      modal.innerHTML = `
        <section style="width:min(680px,96vw);max-height:min(760px,calc(100vh - 40px));overflow:hidden;background:#080b09;border:1px solid rgba(163,255,0,.5);box-shadow:0 24px 80px rgba(0,0,0,.65);display:flex;flex-direction:column;">
          <header style="display:flex;justify-content:space-between;gap:18px;padding:22px;border-bottom:1px solid rgba(255,255,255,.09);">
            <div><p style="margin:0;color:var(--accent);font-size:9px;font-weight:900;text-transform:uppercase;">Live Crates</p><h3 style="margin:6px 0 0;color:#fff;font-family:'Bebas Neue';font-size:34px;letter-spacing:0;">PLAYLISTS</h3></div>
            <button type="button" onclick="closePerformanceGigProfileManager()" title="Close" style="border:0;background:transparent;color:#fff;font-size:24px;cursor:pointer;">&times;</button>
          </header>
          <div style="padding:22px;overflow-y:auto;display:grid;gap:18px;">
            ${performanceGigProfiles.length ? `<label style="display:grid;gap:7px;color:rgba(255,255,255,.5);font-size:9px;font-weight:900;text-transform:uppercase;">Edit Profile<select id="gig-profile-existing" onchange="openPerformanceGigProfileManager(this.value)" style="border:1px solid rgba(255,255,255,.14);background:#000;color:#fff;padding:11px;"><option value="">Create New Profile</option>${profileOptions}</select></label>` : ''}
            <label style="display:grid;gap:7px;color:rgba(255,255,255,.5);font-size:9px;font-weight:900;text-transform:uppercase;">Profile Name<input id="gig-profile-name" value="${escapeHtml(existing?.name || '')}" placeholder="Wedding Reception, Friday Room, Dinner Set..." style="border:1px solid rgba(255,255,255,.14);background:#000;color:#fff;padding:12px;font-size:12px;font-weight:800;"></label>
            <div><div style="display:flex;align-items:end;justify-content:space-between;gap:10px;margin-bottom:8px;"><div><p style="margin:0;color:#fff;font-size:10px;font-weight:900;text-transform:uppercase;">Saved Room Profile Sources</p><small style="color:rgba(255,255,255,.45);font-size:8px;font-weight:800;">Choose the ${escapeHtml(activeSourceLabel)} for this room.</small></div><button type="button" onclick="refreshPerformanceGigProfileManagerSources()" class="performance-mini-btn">Refresh</button></div><input type="search" oninput="filterPerformanceDjProfileSources(this.value)" placeholder="Search ${escapeHtml(activeSourceLabel)}" style="width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.14);background:#000;color:#fff;padding:11px;margin-bottom:6px;font-size:11px;font-weight:800;"><div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin:6px 0 2px;"><small data-gig-dj-selection-count style="color:rgba(255,255,255,.52);font-size:8px;font-weight:900;text-transform:uppercase;">${selectedIds.size} selected</small><div style="display:flex;gap:6px;"><button type="button" onclick="performanceBulkSelectDjProfileSources(true)" class="performance-mini-btn">Select all</button><button type="button" onclick="performanceBulkSelectDjProfileSources(false)" class="performance-mini-btn">Clear all</button></div></div>${sourceRows}</div>
          </div>
          <footer style="display:flex;justify-content:space-between;gap:10px;padding:18px 22px;border-top:1px solid rgba(255,255,255,.09);">
            <div style="display:flex;gap:8px;">${existing ? '<button type="button" onclick="deletePerformanceGigProfile()" class="performance-action secondary">Delete</button>' : ''}<button type="button" onclick="openPerformanceGigProfileManager('')" class="performance-action secondary">New Profile</button></div>
            <button type="button" onclick="savePerformanceGigProfile('${escapeJs(existing?.id || '')}')" class="performance-action">Save & Use</button>
          </footer>
        </section>`;
      document.body.appendChild(modal);
      modal.gigProfileSelectedIds = new Set(selectedIds);
      refreshPerformanceDjProfileBranchStates(modal);
      modal.addEventListener('change', event => {
        const branchInput = event.target.closest('[data-gig-dj-branch-ids]');
        const sourceInput = event.target.closest('[data-gig-dj-source-id]');
        if (!branchInput && !sourceInput) return;
        if (branchInput) {
          let sourceIds = [];
          try { sourceIds = JSON.parse(branchInput.getAttribute('data-gig-dj-branch-ids') || '[]'); } catch (_) {}
          sourceIds.forEach(sourceId => {
            if (branchInput.checked) modal.gigProfileSelectedIds.add(sourceId);
            else modal.gigProfileSelectedIds.delete(sourceId);
          });
        } else {
          const sourceId = sourceInput.getAttribute('data-gig-dj-source-id');
          if (sourceInput.checked) modal.gigProfileSelectedIds.add(sourceId);
          else modal.gigProfileSelectedIds.delete(sourceId);
        }
        refreshPerformanceDjProfileBranchStates(modal);
      });
      modal.addEventListener('click', event => { if (event.target === modal) closePerformanceGigProfileManager(); });
      document.getElementById('gig-profile-name')?.focus();
    }

    async function savePerformanceGigProfile(existingId = '') {
      const name = String(document.getElementById('gig-profile-name')?.value || '').trim();
      const modal = document.getElementById('performance-gig-profile-modal');
      const sourceIds = [...(modal?.gigProfileSelectedIds || [])];
      if (!name) {
        showToast('Name this Gig Profile first.', true);
        return;
      }
      if (!sourceIds.length) {
        showToast('Choose at least one Serato crate or djay Pro playlist.', true);
        return;
      }
      const previous = performanceGigProfiles.find(profile => profile.id === existingId);
      const record = {
        id: previous?.id || `gig-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name,
        sourceIds,
        createdAt: previous?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const index = performanceGigProfiles.findIndex(profile => profile.id === record.id);
      if (index >= 0) performanceGigProfiles.splice(index, 1, record);
      else performanceGigProfiles.unshift(record);
      performanceGigProfileId = record.id;
      performanceGigProfileEnabled = true;
      persistPerformanceGigProfiles();
      closePerformanceGigProfileManager();
      renderPerformanceGigProfileControl();
      await refreshPerformanceGigProfileTrackCache({ force: true });
      renderPerformanceRefines();
      if (performanceAnchorTrack) performanceFetchSuggestions();
      queuePerformanceLiveAssistStateSync();
      showToast(`${record.name} is now feeding Live Assist from your DJ playlists.`);
    }

    function deletePerformanceGigProfile() {
      const profile = currentPerformanceGigProfile();
      if (!profile || !confirm(`Delete Gig Profile "${profile.name}"? Serato crates and djay Pro playlists stay untouched.`)) return;
      performanceGigProfiles = performanceGigProfiles.filter(item => item.id !== profile.id);
      performanceGigProfileId = performanceGigProfiles[0]?.id || '';
      performanceGigProfileEnabled = false;
      performanceGigProfileOnlySelected = false;
      performanceGigProfileTrackCache = [];
      performanceGigProfileKeys = new Set();
      performanceGigProfileTrackCacheId = '';
      persistPerformanceGigProfiles();
      closePerformanceGigProfileManager();
      renderPerformanceGigProfileControl();
      queuePerformanceLiveAssistStateSync();
      if (performanceAnchorTrack) performanceFetchSuggestions();
      showToast('Gig Profile deleted. Your Serato and djay Pro playlists were kept.');
    }

    function performanceTrackProviderTone(track = {}) {
      const normalized = normalizeModalTrackMetadata(track || {});
      const explicitLiveProvider = String(
        normalized.live_provider
        || track.live_provider
        || normalized.active_provider
        || track.active_provider
        || ''
      ).trim().toLowerCase();
      if (explicitLiveProvider === 'djay' || explicitLiveProvider === 'serato') {
        return explicitLiveProvider;
      }
      const connectedProvider = String(
        normalized.connected_from || track.connected_from || ''
      ).trim().toLowerCase();
      if (connectedProvider.includes('djay')) return 'djay';
      if (connectedProvider.includes('serato')) return 'serato';
      const providerText = [
        normalized.source,
        track.source,
        normalized.source_label,
        track.source_label,
      ].map(value => String(value || '').trim().toLowerCase()).join(' ');
      if (providerText.includes('djay')) return 'djay';
      if (providerText.includes('serato')) return 'serato';
      return '';
    }

    function performanceLiveTrackDisplaySignature(track = {}) {
      const normalized = normalizeModalTrackMetadata(track || {});
      return JSON.stringify([
        performanceTrackProviderTone(normalized),
        normalized.path || '',
        normalized.title || '',
        normalized.artist || '',
        Number(normalized.bpm || normalized.serato_bpm || 0),
        Number(normalized.playing_bpm || normalized.serato_playing_bpm || 0),
        Number(normalized.native_bpm || normalized.track_bpm || 0),
        normalized.deck_bpm_status || '',
        normalized.camelot || normalized.key || '',
        normalized.energy || '',
        normalized.genre || '',
        normalized.year || normalized.release_year || '',
        normalized.deck || '',
      ]);
    }

    function performanceLiveAssistTrackPayload(track = {}) {
      const normalized = normalizeModalTrackMetadata(track || {});
      const match = modalSuggestionMatch(normalized);
      const gigProfileProviders = performanceTrackGigProfileProviders(normalized);
      return {
        path: normalized.path || '',
        filename: normalized.filename || '',
        title: normalized.title || '',
        artist: normalized.artist || '',
        bpm: normalized.playing_bpm || normalized.serato_playing_bpm || normalized.bpm || normalized.serato_bpm || '',
        native_bpm: normalized.native_bpm || normalized.track_bpm || normalized.bpm || '',
        playing_bpm: normalized.playing_bpm || normalized.serato_playing_bpm || '',
        camelot: normalized.camelot || normalized.key || '',
        key: normalized.key || normalized.camelot || '',
        genre: normalized.genre || '',
        root: performanceTrackRoot(normalized),
        era_override: AXIOMLiveAssistSimilarity.eraName(normalized.era_override),
        effective_era: AXIOMLiveAssistSimilarity.eraFor(normalized),
        year: normalized.year || normalized.release_year || '',
        energy: normalized.energy || modalTrackEnergy(normalized) || '',
        fit: match.label || normalized.fit_label || 'Fit',
        confidence: match.confidence || 0,
        live_provider: performanceTrackProviderTone(normalized),
        connected_from: normalized.connected_from || '',
        source_label: normalized.source_label || '',
        gig_profile: performanceTrackInGigProfile(normalized),
        gig_profile_name: performanceTrackInGigProfile(normalized) ? (currentPerformanceGigProfile()?.name || 'Gig Profile') : '',
        gig_profile_providers: gigProfileProviders,
        dj_track_colors: normalized.dj_track_colors || {},
      };
    }

    function performanceLiveAssistSnapshot(total = performanceSuggestions.length) {
      const bpmContext = performanceLiveBpmContext();
      const profile = currentPerformanceGigProfile();
      const sourceIds = performanceActiveGigProfileSourceIds(profile);
      const providers = [...new Set(sourceIds
        .map(id => performanceDjProfileSources.find(source => source.id === id)?.provider)
        .filter(Boolean))];
      return {
        loaded: Boolean(performanceAnchorTrack && performanceSuggestions.length),
        now_playing_colour_preference: performanceNowPlayingColourPreference(),
        anchor: performanceAnchorTrack ? performanceLiveAssistTrackPayload(performanceAnchorTrack) : null,
        suggestions: performanceSuggestions.map(performanceLiveAssistTrackPayload),
        total,
        gig_profile: {
          enabled: performanceGigProfileEnabled,
          only_selected: performanceGigProfileEnabled && performanceGigProfileOnlySelected,
          id: performanceGigProfileId,
          name: profile?.name || '',
          tracks: performanceGigProfileTrackCache.length,
          sources: sourceIds.length,
          source_ids: sourceIds,
          providers,
          live_provider: performanceLiveProvider,
          colors_enabled: performanceGigProfileColorsEnabled,
          profiles: performanceGigProfiles
            .filter(item => item?.id && item?.name)
            .map(item => ({
              id: item.id,
              name: item.name,
              source_ids: Array.isArray(item.sourceIds) ? item.sourceIds.filter(Boolean) : [],
              created_at: item.createdAt || '',
              updated_at: item.updatedAt || '',
            })),
        },
        tempo_intent: performanceTempoIntent,
        tempo_reset_version: performanceTempoResetVersion,
        session_version: performanceSessionVersion,
        session_ledger: {
          rejected_families: [...performanceRejectedFamilies],
          played_families: [...performanceSessionPlayedFamilies],
        },
        status: performanceAnchorTrack
          ? `${performanceSuggestions.length} Performance Mode recommendation${performanceSuggestions.length === 1 ? '' : 's'} loaded${performanceGigProfileOnlySelected ? ' from selected playlists only' : ''}`
          : (performanceGigProfileEnabled
              ? `${currentPerformanceGigProfile()?.name || 'Gig Profile'} ready with ${performanceGigProfileTrackCache.length} matched DJ-library track${performanceGigProfileTrackCache.length === 1 ? '' : 's'}. Play a track in Serato or djay Pro to start recommendations.`
              : 'Choose a Gig Profile, then play a track in Serato or djay Pro.'),
        bpm_context: {
          native_bpm: bpmContext.nativeBpm || '',
          manual_bpm: bpmContext.manualBpm || '',
          live_bpm: bpmContext.liveBpm || '',
          playing_bpm: bpmContext.playingBpm || '',
          target_bpm: bpmContext.targetBpm || '',
          bpm_source: bpmContext.bpmSource || '',
          source_label: bpmContext.sourceLabel || '',
          lane_label: bpmContext.laneLabel || '',
        },
        updated_at: new Date().toISOString(),
      };
    }

    let performanceLiveAssistWarmTimer = null;
    let performanceLiveAssistLastSyncSignature = '';
    let performanceLiveAssistLastSyncAt = 0;
    let performanceLiveAssistSyncInFlight = null;
    let performanceLiveAssistSyncStartedAt = 0;
    let performanceLiveAssistSyncGeneration = 0;
    let performanceLiveAssistSyncPending = false;
    let performanceNativeTickInFlight = false;
    let performanceNativeTickStartedAt = 0;
    let performanceNativeTickGeneration = 0;

    function performanceLiveAssistSyncSignature(snapshot = {}) {
      const { updated_at: ignoredUpdatedAt, ...stableSnapshot } = snapshot;
      return JSON.stringify(stableSnapshot);
    }

    async function syncPerformanceLiveAssistState(
      total = performanceSuggestions.length,
      { force = false } = {},
    ) {
      // Approval/review fixtures are visual-only and must never enter the
      // production Live Assist state shared with the native pop-up.
      if (isAxiomWebPreview() || axiomReviewMode() || axiomUiPreviewMode()) return null;
      const snapshot = performanceLiveAssistSnapshot(total);
      const signature = performanceLiveAssistSyncSignature(snapshot);
      if (!force && signature === performanceLiveAssistLastSyncSignature) return null;
      if (performanceLiveAssistSyncInFlight) {
        if (Date.now() - performanceLiveAssistSyncStartedAt < 10000) {
          performanceLiveAssistSyncPending = true;
          return performanceLiveAssistSyncInFlight;
        }
        performanceLiveAssistSyncGeneration += 1;
        performanceLiveAssistSyncInFlight = null;
        performanceLiveAssistSyncPending = false;
        console.warn('[AXIOM] Recovered a stale Live Assist state sync.');
      }
      const syncGeneration = ++performanceLiveAssistSyncGeneration;
      performanceLiveAssistSyncStartedAt = Date.now();
      const syncPromise = (async () => {
        try {
          const { resp: response, data: payload } = await fetchJsonWithTimeout(
            '/api/performance/live_assist/state',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(snapshot),
              keepalive: true,
            },
            6000,
          );
          if (!response.ok || syncGeneration !== performanceLiveAssistSyncGeneration) return null;
          const contentChanged = signature !== performanceLiveAssistLastSyncSignature;
          performanceLiveAssistLastSyncSignature = signature;
          performanceLiveAssistLastSyncAt = Date.now();
          // Heartbeats keep the server warm without waking the list again.
          if (!contentChanged) return payload;
          const version = Number(payload?.version || 0);
          // Separate native WKWebViews may not deliver storage/channel events.
          // All channels carry the same accepted version to avoid duplicate reads.
          try {
            window.webkit?.messageHandlers?.axiomNative?.postMessage?.({ action: 'liveAssistStateUpdated', version });
          } catch (error) {}
          try {
            const stamp = JSON.stringify({ version });
            window.localStorage?.setItem('axiom-live-assist-updated', stamp);
            if ('BroadcastChannel' in window) {
              const channel = new BroadcastChannel('axiom-live-assist');
              channel.postMessage({ type: 'performance-state-updated', version, stamp });
              channel.close();
            }
          } catch (error) {}
          return payload;
        } catch (error) {
          console.warn('[AXIOM] Live Assist state sync failed:', error);
          return null;
        }
      })();
      performanceLiveAssistSyncInFlight = syncPromise;
      try {
        return await syncPromise;
      } finally {
        if (syncGeneration === performanceLiveAssistSyncGeneration) {
          performanceLiveAssistSyncInFlight = null;
          performanceLiveAssistSyncStartedAt = 0;
          if (performanceLiveAssistSyncPending) {
            performanceLiveAssistSyncPending = false;
            queueMicrotask(() => syncPerformanceLiveAssistState().catch(() => {}));
          }
        }
      }
    }

    function queuePerformanceLiveAssistStateSync(total = performanceSuggestions.length) {
      ensurePerformanceLiveAssistWarmSync();
      syncPerformanceLiveAssistState(total).catch(() => {});
    }

    function ensurePerformanceLiveAssistWarmSync() {
      if (
        performanceLiveAssistWarmTimer
        || isAxiomWebPreview()
        || axiomReviewMode()
        || axiomUiPreviewMode()
      ) return;
      performanceLiveAssistWarmTimer = setInterval(() => {
        syncPerformanceLiveAssistState(
          performanceAnchorTrack ? performanceSuggestions.length : 0,
          { force: true },
        ).catch(() => {});
      }, 15000);
    }

    async function performanceNativeLiveAssistTick() {
      if (isAxiomWebPreview() || axiomReviewMode() || axiomUiPreviewMode()) return;
      const now = Date.now();
      if (performanceNativeTickInFlight) {
        if (now - performanceNativeTickStartedAt < 15000) return;
        performanceNativeTickGeneration += 1;
        performanceNativeTickInFlight = false;
        console.warn('[AXIOM] Native watchdog recovered a stale Performance tick.');
      }
      const tickGeneration = ++performanceNativeTickGeneration;
      performanceNativeTickInFlight = true;
      performanceNativeTickStartedAt = now;
      try {
        // Deck detection owns the fast native cadence. Control messages keep
        // their existing slower cadence so no second refresh loop is created.
        await performancePollSeratoBridge(false);
        const controlDue = Date.now() - performanceNativeLastControlPollAt >= PERFORMANCE_NATIVE_CONTROL_POLL_MS;
        if (controlDue) {
          performanceNativeLastControlPollAt = Date.now();
          await performancePollLiveAssistControl();
        }
        if (Date.now() - performanceLiveAssistLastSyncAt >= 15000) {
          await syncPerformanceLiveAssistState(
            performanceAnchorTrack ? performanceSuggestions.length : 0,
            { force: true },
          );
        }
      } finally {
        if (tickGeneration === performanceNativeTickGeneration) {
          performanceNativeTickInFlight = false;
          performanceNativeTickStartedAt = 0;
        }
      }
    }

    async function performanceNativeLiveAssistRefresh() {
      if (isAxiomWebPreview()) return;
      const refreshedFromControl = await performancePollLiveAssistControl();
      performancePollSeratoBridge(true).catch(() => {});
      if (performanceAnchorTrack && !refreshedFromControl) await performanceFetchSuggestions();
      await syncPerformanceLiveAssistState(
        performanceAnchorTrack ? performanceSuggestions.length : 0,
        { force: true },
      );
    }

    async function showAxiomLiveAssist(options = {}) {
      if (!requireAxiomInstalledApp('AXIOM Live Assist')) return false;
      ensurePerformanceLiveAssistWarmSync();
      const liveAssistPath = `/live_assist_window?open=${Date.now()}`;
      const nativeBridge = window.webkit?.messageHandlers?.axiomNative;
      let opened = false;
      if (nativeBridge?.postMessage) {
        opened = await performanceOpenNativeLiveAssist(nativeBridge, {
          action: 'openLiveAssist',
          path: liveAssistPath,
          auto: Boolean(options.auto),
          minimizeMain: Boolean(options.minimizeMain),
          djSessionToken: String(options.djSessionToken || ''),
        });
      } else {
        // Windows: without the macOS edge-docked panel, a collapsed popup is a blank window
        // with a tab at its edge; AXIOM's own ?popup flag opens it expanded.
        const popup = window.open(`${liveAssistPath}&popup=1`, 'axiom-live-assist', 'width=438,height=690');
        opened = Boolean(popup);
        if (opened && typeof popup.focus === 'function') popup.focus();
      }
      if (!opened) {
        if (!options.auto) showToast('Live Assist could not open. Try again.');
        return false;
      }
      if (!options.auto) {
        // A deliberate reopen starts owning Live Assist again for the current
        // DJ session. Otherwise an earlier close-suppression token prevents
        // later fresh tracks from reaching the native manual-minimize hold.
        performanceAutoLiveAssistSuppressedSessionToken = '';
      }
      performanceAutoLiveAssistWindowOpen = true;
      await syncPerformanceLiveAssistState(performanceSuggestions.length, { force: true });
      if (!options.auto) showToast('Live Assist opens in its own floating AXIOM window.');
      return true;
    }
