/* Shared audio player transport, selection, and cockpit keyboard controls. */
    const AXIOM_PREVIEW_PLAYER_CONTEXTS = {
      browse: 'library-studio-preview',
      daw: 'studio-daw-preview',
    };
    const AXIOM_PREVIEW_PLAYER_LABELS = {
      [AXIOM_PREVIEW_PLAYER_CONTEXTS.browse]: {
        label: 'Library / Studio Preview',
        emptyTitle: 'No Track Selected',
        emptyArtist: 'Add music, then choose a song to preview',
        deck: 'main',
      },
      [AXIOM_PREVIEW_PLAYER_CONTEXTS.daw]: {
        label: 'Studio DAW Preview',
        emptyTitle: 'No DAW Clip Selected',
        emptyArtist: 'Choose an arrangement clip to preview inside Studio DAW',
        deck: 'studio-daw',
      },
    };
    let axiomPreviewPlayerContext = AXIOM_PREVIEW_PLAYER_CONTEXTS.browse;
    const axiomPreviewPlayerSnapshots = {
      [AXIOM_PREVIEW_PLAYER_CONTEXTS.browse]: {},
      [AXIOM_PREVIEW_PLAYER_CONTEXTS.daw]: {},
    };

    function normalizeAxiomPreviewPlayerContext(context) {
      const value = String(context || '').toLowerCase();
      if (value === 'daw' || value === 'studio-daw' || value === AXIOM_PREVIEW_PLAYER_CONTEXTS.daw) return AXIOM_PREVIEW_PLAYER_CONTEXTS.daw;
      return AXIOM_PREVIEW_PLAYER_CONTEXTS.browse;
    }

    function axiomPreviewContextFromDeck(deck) {
      const value = String(deck || '').toLowerCase();
      if (value.includes('studio-daw') || value === 'daw') return AXIOM_PREVIEW_PLAYER_CONTEXTS.daw;
      return AXIOM_PREVIEW_PLAYER_CONTEXTS.browse;
    }

    function inferAxiomPreviewPlayerContext(options = {}) {
      if (options.context) return normalizeAxiomPreviewPlayerContext(options.context);
      if (window.axiomVisibleTab && window.axiomVisibleTab !== 'studio') return AXIOM_PREVIEW_PLAYER_CONTEXTS.browse;
      const dawShell = document.getElementById('studio-daw-shell');
      const dawVisible = Boolean(dawShell && !dawShell.classList.contains('hidden') && dawShell.getAttribute('aria-hidden') !== 'true' && !dawShell.closest?.('.hidden, [aria-hidden="true"]'));
      return dawVisible || (!dawShell && document.body.classList.contains('studio-daw-mode-active'))
        ? AXIOM_PREVIEW_PLAYER_CONTEXTS.daw
        : AXIOM_PREVIEW_PLAYER_CONTEXTS.browse;
    }

    function updateAxiomPreviewSnapshot(context, patch = {}) {
      const key = normalizeAxiomPreviewPlayerContext(context);
      axiomPreviewPlayerSnapshots[key] = {
        ...(axiomPreviewPlayerSnapshots[key] || {}),
        ...patch,
      };
      return axiomPreviewPlayerSnapshots[key];
    }

    function syncAxiomPreviewPlayerChrome() {
      const config = AXIOM_PREVIEW_PLAYER_LABELS[axiomPreviewPlayerContext] || AXIOM_PREVIEW_PLAYER_LABELS[AXIOM_PREVIEW_PLAYER_CONTEXTS.browse];
      const snapshot = axiomPreviewPlayerSnapshots[axiomPreviewPlayerContext] || {};
      const title = snapshot.title || '';
      const artist = snapshot.artist || '';
      const contextLabel = document.getElementById('ap-context');
      const titleEl = document.getElementById('ap-title');
      const artistEl = document.getElementById('ap-artist');
      const player = document.getElementById('audio-player');
      if (player) player.dataset.previewContext = axiomPreviewPlayerContext;
      if (contextLabel) contextLabel.textContent = config.label;
      if (titleEl) titleEl.innerText = title || config.emptyTitle;
      if (artistEl) artistEl.innerText = artist || config.emptyArtist;
    }

    function clearAxiomPreviewTransportState() {
      const audio = document.getElementById('main-player');
      try {
        audio?.pause();
        audio?.removeAttribute('src');
        audio?.load?.();
      } catch (_) {}
      browserAudioFallbackActive = false;
      browserAudioFallbackTrack = null;
      nativePlayerState = {
        ...nativePlayerState,
        has_track: false,
        playing: false,
        path: '',
        title: '',
        artist: '',
        deck: AXIOM_PREVIEW_PLAYER_LABELS[axiomPreviewPlayerContext]?.deck || 'main',
        current_time: 0,
        duration: 0,
        ended: false,
      };
      currentPlayingPath = null;
      currentAnchorTrack = null;
      updateAxiomPreviewSnapshot(axiomPreviewPlayerContext, { path: '', title: '', artist: '' });
      document.getElementById('ap-progress').style.width = '0%';
      document.getElementById('ap-time').innerText = '0:00';
      document.getElementById('ap-duration').innerText = '0:00';
      document.body.classList.remove('has-playing');
      highlightPlayingTrack('');
    }

    function setAxiomPreviewPlayerContext(context, options = {}) {
      const nextContext = normalizeAxiomPreviewPlayerContext(context);
      const previousContext = axiomPreviewPlayerContext;
      const contextChanged = previousContext !== nextContext;
      // The native preview and the DAW Web Audio transport are separate
      // engines. Giving Library the controls must also release DAW playback,
      // including a pending prepare whose completion must not reclaim them.
      // A deliberate export is not a preview and retains its own lifecycle.
      const dawTransport = window.AxiomArrangement;
      if (nextContext === AXIOM_PREVIEW_PLAYER_CONTEXTS.browse && !dawTransport?.rendering && (dawTransport?.playing || dawTransport?.loading)) {
        dawTransport.stop(false, 'preview-context-handoff');
      }
      if (nextContext === AXIOM_PREVIEW_PLAYER_CONTEXTS.browse) {
        window.AxiomStems?.stop?.();
        window.AxiomBeatPreview?.stop?.();
      }
      if ((contextChanged || options.reset === true) && options.stopCurrent !== false) {
        if (typeof nativeAudioRequest === 'function') {
          const transportToken = beginNativeTransportCommand(false);
          window.__axiomLatestPreviewToken = '';
          nativeAudioRequest('/api/audio/stop', { reason: options.reason || `preview_context_${nextContext}` }, { transportToken }).catch(() => {});
        }
        clearAxiomPreviewTransportState();
        if(options.reset === true) updateAxiomPreviewSnapshot(nextContext, {path:'',title:'',artist:''});
      }
      axiomPreviewPlayerContext = nextContext;
      document.body.dataset.axiomPreviewContext = nextContext;
      document.body.classList.toggle('studio-daw-preview-active', nextContext === AXIOM_PREVIEW_PLAYER_CONTEXTS.daw);
      if (contextChanged || options.render !== false) syncAxiomPreviewPlayerChrome();
      syncMainPlayerControls();
      return nextContext;
    }

    function beginNativeTransportCommand(playing, state = {}) {
      const token = ++nativeTransportCommandToken;
      nativeTransportPending = { token, playing: Boolean(playing) };
      applyNativePlayerState({ ...state, playing: Boolean(playing) }, { previewContext: state.preview_context || state.context || axiomPreviewPlayerContext });
      return token;
    }

    function applyNativePlayerState(state = {}, options = {}) {
      const nextState = { ...state };
      const hasPreviewContext = Object.prototype.hasOwnProperty.call(nextState, 'preview_context');
      const hasDeck = Object.prototype.hasOwnProperty.call(nextState, 'deck') && nextState.deck;
      const nextContext = normalizeAxiomPreviewPlayerContext(
        options.previewContext || (hasPreviewContext ? nextState.preview_context : '') || (hasDeck ? axiomPreviewContextFromDeck(nextState.deck) : axiomPreviewPlayerContext)
      );
      nextState.preview_context = nextContext;
      if (nativeTransportPending && !options.authoritativeTransport) {
        // A 500 ms status poll or an older play response must not undo the
        // user's latest Space-bar command while that command is in flight.
        nextState.playing = nativeTransportPending.playing;
      }
      nativePlayerState = { ...nativePlayerState, ...nextState };
      if (
        options.authoritativeTransport
        && nativeTransportPending
        && options.transportToken === nativeTransportPending.token
      ) {
        nativeTransportPending = null;
      }
      const duration = Number(nativePlayerState.duration || 0);
      const current = Number(nativePlayerState.current_time || 0);
      const pct = duration > 0 ? Math.min(100, Math.max(0, (current / duration) * 100)) : 0;
      document.getElementById('ap-progress').style.width = `${pct}%`;
      document.getElementById('ap-time').innerText = formatTime(current);
      document.getElementById('ap-duration').innerText = duration > 0 ? formatTime(duration) : '0:00';
      const modalAnchorTime = document.getElementById('modal-anchor-time');
      if (modalAnchorTime && String(nativePlayerState.path || '') === String(currentAnchorTrack?.path || '')) {
        modalAnchorTime.innerText = `${formatTime(current)} / ${duration > 0 ? formatTime(duration) : formatTrackDuration(currentAnchorTrack || {})}`;
      }
      const snapshotPatch = {
        playing: Boolean(nextState.playing),
        current_time: current,
        duration,
      };
      ['path', 'title', 'artist'].forEach(key => {
        if (Object.prototype.hasOwnProperty.call(nextState, key)) snapshotPatch[key] = nextState[key] || '';
      });
      updateAxiomPreviewSnapshot(nextContext, snapshotPatch);
      if (nextContext === axiomPreviewPlayerContext) syncAxiomPreviewPlayerChrome();
      syncMainPlayerControls();
      syncHealthCleanupPreviewButtons();
      if (document.getElementById('library-gap-builder')) syncLibraryGapBuilderPreviewUi();
      if (!document.getElementById('studio-version-overlay')?.classList.contains('hidden')) syncStudioVersionPreviewUi();
      if (nativePlayerState.ended && nativePlayerState.path && nativeEndedHandledForPath !== nativePlayerState.path) {
        nativeEndedHandledForPath = nativePlayerState.path;
        handleNativeAudioEnded();
      }
    }

    let nativeAudioCommandQueue = Promise.resolve();
    function nativeAudioRequest(endpoint, payload = {}, options = {}) {
      // The backend and streaming player must receive stop/play in user order.
      // Response tokens alone cannot prevent a late stop from silencing a new song.
      const command = nativeAudioCommandQueue.then(() => performNativeAudioRequest(endpoint, payload, options));
      nativeAudioCommandQueue = command.catch(() => {});
      return command;
    }

    async function performNativeAudioRequest(endpoint, payload = {}, options = {}) {
      const requestGeneration = nativeTransportCommandToken;
      const applyResponse = (state = {}) => {
        if (requestGeneration !== nativeTransportCommandToken) return state;
        if (options.transportToken && options.transportToken !== nativeTransportCommandToken) {
          return state;
        }
        applyNativePlayerState(state, {
          authoritativeTransport: Boolean(options.transportToken),
          transportToken: options.transportToken || 0,
          previewContext: options.previewContext || options.context,
        });
        return state;
      };
      if (browserAudioFallbackNativeUnavailable && endpoint.endsWith('/play') && payload.path) {
        return applyResponse(await startBrowserAudioFallback(payload, { transportToken: options.transportToken || 0, previewContext: options.previewContext || options.context }));
      }
      const browserFallback = await browserAudioFallbackRequest(endpoint, payload);
      if (browserFallback?.handled) {
        return applyResponse(browserFallback.state || browserFallback);
      }
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.success === false) {
        const err = new Error(data.error || 'Native audio command failed');
        Object.assign(err, data);
        throw err;
      }
      return applyResponse(data);
    }

    function handleBrowserFolderPlaybackError(err, title = 'this saved track') {
      if (!err?.needs_browser_folder) return false;
      showToast(err.message || `Reconnect your browser music folder before playing "${title}".`, true);
      if (typeof requestMusicFolderAccess === 'function') {
        requestMusicFolderAccess('Saved Browser Set');
      }
      return true;
    }

    function handleMissingSourcePlaybackError(err) {
      if (!err?.needs_relink && err?.code !== 'missing_source') return false;
      const message = 'This project audio is unavailable on this Mac. Relink it in Project Audio or remove it from the draft.';
      const openProjectAudio = () => {
        if (window.AxiomDawAssets?.open) window.AxiomDawAssets.open();
        else showToast(message, true);
      };
      if (typeof showPlayerNotification === 'function' && window.AxiomStudioDaw?.activeProject) {
        showPlayerNotification(message, { isError: true, actionLabel: 'OPEN PROJECT AUDIO', actionFn: openProjectAudio });
      } else {
        showToast(message, true);
      }
      return true;
    }

    let browserAudioFallbackActive = false;
    let browserAudioFallbackTrack = null;
    let browserAudioFallbackNativeUnavailable = false;

    function nativeAudioUnavailableForBrowserFallback(err) {
      return /Native audio engine unavailable|AVFoundation|No module named 'Foundation'/i.test(String(err?.message || err || ''));
    }

    function browserAudioFallbackState(extra = {}) {
      const duration = Number.isFinite(audioEl?.duration) ? Number(audioEl.duration || 0) : 0;
      const currentTime = Number.isFinite(audioEl?.currentTime) ? Number(audioEl.currentTime || 0) : 0;
      const path = browserAudioFallbackTrack?.path || '';
      return {
        success: true,
        available: true,
        browser_fallback: true,
        has_track: browserAudioFallbackActive && Boolean(path),
        playing: browserAudioFallbackActive && Boolean(audioEl && !audioEl.paused && !audioEl.ended),
        path,
        title: browserAudioFallbackTrack?.title || '',
        artist: browserAudioFallbackTrack?.artist || '',
        deck: browserAudioFallbackTrack?.deck || 'main',
        preview_context: browserAudioFallbackTrack?.preview_context || axiomPreviewPlayerContext,
        current_time: currentTime,
        duration,
        ended: Boolean(audioEl?.ended),
        volume: Number(audioEl?.volume ?? nativePlayerState.volume ?? 1),
        ...extra,
      };
    }

    function browserAudioFallbackHasMedia() {
      const src = audioEl?.currentSrc || audioEl?.src || audioEl?.getAttribute?.('src') || '';
      return Boolean(
        audioEl
        && src
        && (browserAudioFallbackActive || browserAudioFallbackTrack || !audioEl.paused || Number(audioEl.currentTime || 0) > 0)
      );
    }

    async function startBrowserAudioFallback(payload = {}, options = {}) {
      if (!audioEl) throw new Error('Browser audio player unavailable');
      const path = String(payload.path || '');
      if (!path) throw new Error('Path required');
      const startTime = Math.max(0, Number(payload.start_time ?? options.startTimeSeconds ?? 0) || 0);

      browserAudioFallbackActive = true;
      browserAudioFallbackTrack = {
        path,
        title: payload.title || '',
        artist: payload.artist || '',
        deck: payload.deck || 'main',
        preview_context: normalizeAxiomPreviewPlayerContext(payload.preview_context || options.previewContext || options.context),
      };
      audioEl.pause();
      audioEl.src = `/api/library/stream?path=${encodeURIComponent(path)}`;
      audioEl.volume = Number(nativePlayerState.volume ?? audioEl.volume ?? 1);
      await new Promise(resolve => {
        if (audioEl.readyState >= 1) {
          resolve();
          return;
        }
        const done = () => resolve();
        audioEl.addEventListener('loadedmetadata', done, { once: true });
        setTimeout(done, 900);
      });
      if (startTime > 0) audioEl.currentTime = startTime;
      audioEl.onended = () => {
        applyNativePlayerState(browserAudioFallbackState({
          playing: false,
          ended: true,
        }), { authoritativeTransport: true, transportToken: nativeTransportCommandToken });
      };
      audioEl.onerror = () => {
        const mediaError = audioEl.error?.message || audioEl.error?.code || 'Browser could not play this audio file';
        console.warn('[AXIOM] browser audio fallback failed:', mediaError);
      };
      await audioEl.play();
      const state = browserAudioFallbackState({ playing: true, ended: false });
      applyNativePlayerState(state, {
        authoritativeTransport: true,
        transportToken: options.transportToken || nativeTransportCommandToken,
      });
      startNativePlayerPolling();
      syncMainPlayerControls();
      return state;
    }

    async function browserAudioFallbackRequest(endpoint, payload = {}) {
      if (!browserAudioFallbackActive && !browserAudioFallbackHasMedia()) return { handled: false };
      if (endpoint.endsWith('/status')) return { handled: true, state: browserAudioFallbackState() };
      if (endpoint.endsWith('/pause')) {
        audioEl?.pause();
        return { handled: true, state: browserAudioFallbackState({ playing: false }) };
      }
      if (endpoint.endsWith('/resume')) {
        await audioEl?.play();
        return { handled: true, state: browserAudioFallbackState({ playing: true, ended: false }) };
      }
      if (endpoint.endsWith('/stop')) {
        audioEl?.pause();
        audioEl?.removeAttribute('src');
        audioEl?.load?.();
        browserAudioFallbackActive = false;
        browserAudioFallbackTrack = null;
        return { handled: true, state: browserAudioFallbackState({ has_track: false, playing: false, path: '', ended: false }) };
      }
      if (endpoint.endsWith('/seek')) {
        if (audioEl) audioEl.currentTime = Math.max(0, Number(payload.seconds || 0));
        return { handled: true, state: browserAudioFallbackState() };
      }
      if (endpoint.endsWith('/seek_relative')) {
        if (audioEl) audioEl.currentTime = Math.max(0, Number(audioEl.currentTime || 0) + Number(payload.delta || 0));
        return { handled: true, state: browserAudioFallbackState() };
      }
      if (endpoint.endsWith('/volume')) {
        if (audioEl) audioEl.volume = Math.max(0, Math.min(1, Number(payload.volume || 0)));
        return { handled: true, state: browserAudioFallbackState() };
      }
      return { handled: false };
    }

    async function setNativeVolume(value) {
      try {
        await nativeAudioRequest('/api/audio/volume', { volume: parseFloat(value) || 0 });
      } catch (err) {
        console.warn('[AXIOM] native volume failed:', err);
      }
    }

    function startNativePlayerPolling() {
      if (nativePlayerPoll) return;
      nativePlayerPoll = setInterval(async () => {
        const pollGeneration = nativeTransportCommandToken;
        const applyPoll = state => {
          if (pollGeneration === nativeTransportCommandToken && !nativeTransportPending) applyNativePlayerState(state);
        };
        try {
          if (browserAudioFallbackHasMedia()) {
            applyPoll(browserAudioFallbackState());
            return;
          }
          const resp = await fetch('/api/audio/status');
          if (!resp.ok) return;
          const data = await resp.json();
          applyPoll(data);
        } catch (err) {
          console.warn('[AXIOM] native audio status failed:', err);
        }
      }, 500);
    }

    async function playAudioFile(path, title, artist, bpm, camelot, energy, e, genre, options = {}) {
      if (window.AxiomWindowsVideoPreview?.enabled && window.AxiomWindowsVideoPreview.isVideo(path)) {
        if (e) e.stopPropagation();
        return window.AxiomWindowsVideoPreview.open(path, title, { artist, bpm, camelot, energy, genre });
      }
      if (e) e.stopPropagation();
      if (!path || path === 'null' || path === 'undefined') {
        showToast("Audio file not available locally", true);
        return;
      }
      const playerContext = setAxiomPreviewPlayerContext(inferAxiomPreviewPlayerContext(options), { stopCurrent: false });
      const playerDeck = AXIOM_PREVIEW_PLAYER_LABELS[playerContext]?.deck || 'main';
      const requestToken = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      window.__axiomLatestPreviewToken = requestToken;
      document.querySelectorAll('audio:not(#main-player)').forEach(el => {
          el.pause();
          el.removeAttribute('src');
          el.volume = 1.0;
      });
      if (window.axiomVisibleTab === 'library') prepareLibraryMatchingForAnchor(path);
      const cachedTrack = trackVisualCache.get(path) || {};
      currentAnchorTrack = normalizeModalTrackMetadata({ ...cachedTrack, path, title, artist, bpm, camelot, energy, genre: genre || cachedTrack.genre || '' });
      cacheTrackVisual(currentAnchorTrack);
      updateAxiomPreviewSnapshot(playerContext, {
        path,
        title,
        artist,
        bpm,
        camelot,
        energy,
        genre: genre || cachedTrack.genre || '',
      });
      syncAxiomPreviewPlayerChrome();
      currentPlayingPath = path;
      document.body.classList.add('has-playing');
      highlightPlayingTrack(path);
      const transportToken = beginNativeTransportCommand(true, {
        has_track: true,
        path,
        deck: playerDeck,
        title,
        artist,
        preview_context: playerContext,
        ended: false,
        current_time: 0,
      });
      const panel = document.getElementById('smart-links-panel');
      panel.classList.remove('vibe-peak', 'vibe-draining', 'vibe-neutral');
      if (energy === 'Peak') panel.classList.add('vibe-peak');
      else panel.classList.add('vibe-neutral');
      panel.classList.add('active');
      scheduleSmartLinkRefresh();
      nativeEndedHandledForPath = '';
      nativeAudioRequest('/api/audio/play', { path, title, artist, deck: playerDeck, preview_context: playerContext, start_time: options.startTimeSeconds }, { transportToken, previewContext: playerContext })
        .then(() => {
          if (window.__axiomLatestPreviewToken !== requestToken || transportToken !== nativeTransportCommandToken) return;
          startNativePlayerPolling();
          syncMainPlayerControls();
        })
        .catch(async (err) => {
          if (window.__axiomLatestPreviewToken !== requestToken || transportToken !== nativeTransportCommandToken) return;
          console.error(`[AXIOM] Native audio failed for "${title}" | path: ${path}`, err);
          const errMessage = String(err?.message || '');
          if (/play\(\) request was interrupted|interrupted by a call to pause|interrupted by a new load request|superseded/i.test(errMessage)) {
            console.warn(`[AXIOM] Ignored interrupted playback request for "${title}"`);
            return;
          }
          if (nativeAudioUnavailableForBrowserFallback(err)) {
            browserAudioFallbackNativeUnavailable = true;
            try {
              await startBrowserAudioFallback({ path, title, artist, deck: playerDeck, preview_context: playerContext, start_time: options.startTimeSeconds }, { transportToken, previewContext: playerContext });
              return;
            } catch (fallbackErr) {
              console.warn(`[AXIOM] Browser audio fallback failed for "${title}"`, fallbackErr);
            }
          }
          if (transportToken === nativeTransportCommandToken) {
            currentPlayingPath = null;
            applyNativePlayerState({
              has_track: false,
              playing: false,
              path: '',
              ended: false,
              current_time: 0,
              duration: 0,
            }, { authoritativeTransport: true, transportToken });
            highlightPlayingTrack('');
          }
          if (handleBrowserFolderPlaybackError(err, title)) return;
          if (handleMissingSourcePlaybackError(err)) return;
          showToast(`Cannot play audio: "${title}" — ${err.message}`, true);
        });
    }

    let highlightedPlayingPath = '';

    function activateFocusDeckRow(event) {
      if (!event || event.target !== event.currentTarget) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        event.currentTarget.click();
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        movePlayerSelectionByKeyboard(event.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (!['Home', 'End'].includes(event.key)) return;
      const scope = event.currentTarget.closest('#search-results, #lib-suggestions-list, #active-playlist-container');
      if (!scope) return;
      const rows = Array.from(scope.querySelectorAll('.axiom-focus-deck-row:not([hidden])'));
      const index = rows.indexOf(event.currentTarget);
      if (index < 0 || !rows.length) return;
      event.preventDefault();
      const nextIndex = event.key === 'Home' ? 0
        : event.key === 'End' ? rows.length - 1
          : event.key === 'ArrowUp' ? Math.max(0, index - 1)
            : Math.min(rows.length - 1, index + 1);
      const nextRow = rows[nextIndex];
      setFocusDeckSelection(nextRow, scope);
      nextRow?.focus({ preventScroll: true });
      nextRow?.scrollIntoView({ block: 'nearest' });
    }

    function setFocusDeckSelection(row, scopeSelector, options = {}) {
      const target = row?.closest?.('.axiom-focus-deck-row');
      const scope = typeof scopeSelector === 'string' ? document.querySelector(scopeSelector) : scopeSelector;
      if (!target || !scope) return target || null;
      scope.querySelectorAll('.axiom-focus-deck-row.selected, .axiom-focus-deck-row.active-suggestion').forEach(item => {
        if (item === target) return;
        item.classList.remove('selected', 'active-suggestion');
        item.setAttribute('aria-current', 'false');
      });
      target.classList.add('selected');
      target.classList.toggle('active-suggestion', Boolean(options.activeSuggestion));
      target.setAttribute('aria-current', 'true');
      return target;
    }

    function highlightPlayingTrack(path) {
      const paths = [highlightedPlayingPath, path].filter(Boolean);
      const selectors = paths.map(item => `[data-path="${cssEscapeValue(item)}"]`).join(',');
      if (selectors) {
        document.querySelectorAll(selectors).forEach(row => {
          row.classList.toggle('playing-track', row.dataset.path === path);
          row.classList.toggle('library-track-playing', row.dataset.path === path && row.classList.contains('library-track-card'));
        });
      }
      highlightedPlayingPath = path || '';
    }

    function highlightLibraryTrack(el) {
        setFocusDeckSelection(el, '#search-results');
    }

    function highlightPlaylistTrack(el) {
        setFocusDeckSelection(el, '#active-playlist-container');
        requestAnimationFrame(() => {
          syncStudioSpineToBpmColumn();
          requestAnimationFrame(syncStudioSpineToBpmColumn);
        });
    }

    function syncMainPlayerControls() {
      const hasSource = Boolean(nativePlayerState.has_track || nativePlayerState.path || currentPlayingPath);
      const isPlaying = Boolean(nativePlayerState.playing);
      document.getElementById('play-icon')?.classList.toggle('hidden', isPlaying);
      document.getElementById('pause-icon')?.classList.toggle('hidden', !isPlaying);
      document.getElementById('modal-play-icon')?.classList.toggle('hidden', isPlaying);
      document.getElementById('modal-pause-icon')?.classList.toggle('hidden', !isPlaying);
      document.body.classList.toggle('has-playing', isPlaying || Boolean(hasSource && currentPlayingPath && !nativePlayerState.ended));
    }

    async function startVisibleTrackFromPlayer() {
      const candidates = [
        '#active-playlist-container .playlist-row.selected[data-path]',
        '#search-results .vampire-row.selected[data-path]',
        '#active-playlist-container .playlist-row[data-path]',
        '#search-results .vampire-row[data-path]',
        '#lib-suggestions-list .vampire-row[data-path]'
      ];
      const row = candidates.map(selector => document.querySelector(selector)).find(Boolean);
      const path = row?.dataset?.path;
      if (!path) {
        showToast('Select a track first.', true);
        return false;
      }

      const setTrack = (getActiveSetList() || []).find(t => t.path === path);
      const cachedTrack = trackVisualCache.get(path) || setTrack || {};
      const title = cachedTrack.title || row.querySelector('.library-track-title, .recommendation-title, .studio-row-title')?.innerText?.trim() || 'Unknown Title';
      const artist = cachedTrack.artist || row.querySelector('.library-track-artist, .recommendation-artist, .studio-row-artist')?.innerText?.trim() || 'Unknown Artist';
      await playAudioFile(path, title, artist, parseFloat(cachedTrack.bpm) || 0, cachedTrack.camelot || '', cachedTrack.energy || '', null, cachedTrack.genre || '');
      if (row.classList.contains('playlist-row')) highlightPlaylistTrack(row);
      if (row.classList.contains('vampire-row')) row.classList.add('selected');
      return true;
    }

    let playerToggleCommandPending = false;

    async function togglePlay() {
      if(inferAxiomPreviewPlayerContext() === AXIOM_PREVIEW_PLAYER_CONTEXTS.daw && window.AxiomArrangement) {window.AxiomArrangement.toggle();return;}
      if (inferAxiomPreviewPlayerContext() === AXIOM_PREVIEW_PLAYER_CONTEXTS.daw && window.AxiomStems?.playing) {
        window.AxiomStems.stop();
        return;
      }
      if(inferAxiomPreviewPlayerContext() === AXIOM_PREVIEW_PLAYER_CONTEXTS.daw && window.AxiomStudioDaw?.selectedStemClip && window.AxiomStems) {
        window.AxiomStudioDaw.playOrToggle(); return;
      }
      if (playerToggleCommandPending) return false;
      playerToggleCommandPending = true;
      try {
        if (!nativePlayerState.has_track && !currentPlayingPath) {
          return await startVisibleTrackFromPlayer();
        }
        const fallbackIsPlaying = Boolean(browserAudioFallbackHasMedia() && audioEl && !audioEl.paused && !audioEl.ended);
        const effectivePlaying = nativeTransportPending?.playing ?? (fallbackIsPlaying || nativePlayerState.playing);
        const shouldPlay = !Boolean(effectivePlaying);
        const transportToken = beginNativeTransportCommand(shouldPlay, { preview_context: axiomPreviewPlayerContext });
        if (!shouldPlay) {
          await nativeAudioRequest('/api/audio/pause', {}, { transportToken, previewContext: axiomPreviewPlayerContext });
        } else {
          await nativeAudioRequest('/api/audio/resume', {}, { transportToken, previewContext: axiomPreviewPlayerContext });
          startNativePlayerPolling();
        }
        return true;
      } catch (err) {
        showToast(`Playback control failed: ${err.message}`, true);
        return false;
      } finally {
        playerToggleCommandPending = false;
        syncMainPlayerControls();
      }
    }

    async function skipAudioRelative(seconds) {
      const delta = Number(seconds);
      if (!Number.isFinite(delta) || delta === 0) return false;
      if (!nativePlayerState.has_track && !currentPlayingPath && !browserAudioFallbackHasMedia()) {
        showToast('Select a track first.', true);
        return false;
      }
      try {
        await nativeAudioRequest('/api/audio/seek_relative', { delta });
        return true;
      } catch (err) {
        showToast(`Seek failed: ${err.message}`, true);
        return false;
      }
    }

    async function stopAxiomAudioPlayback(reason = 'manual_stop') {
      const transportToken = beginNativeTransportCommand(false, {
        has_track: false,
        playing: false,
        path: '',
        ended: false,
        current_time: 0,
        duration: 0,
        preview_context: axiomPreviewPlayerContext,
      });
      try {
        await nativeAudioRequest('/api/audio/stop', { reason }, { transportToken, previewContext: axiomPreviewPlayerContext });
      } catch (err) {
        if (transportToken !== nativeTransportCommandToken) return;
        const audio = document.getElementById('main-player');
        try {
          audio?.pause();
          audio?.removeAttribute('src');
          audio?.load?.();
        } catch (_) {}
        applyNativePlayerState({
          has_track: false,
          playing: false,
          path: '',
          ended: false,
          current_time: 0,
          duration: 0,
        }, { authoritativeTransport: true, transportToken });
      }
      if (transportToken !== nativeTransportCommandToken) return;
      currentPlayingPath = null;
      document.getElementById('ap-progress').style.width = '0%';
      document.getElementById('ap-time').innerText = '0:00';
      document.body.classList.remove('has-playing');
      highlightPlayingTrack('');
      syncMainPlayerControls();
      return false;
    }

    window.stopAxiomAudioPlayback = stopAxiomAudioPlayback;
    window.setAxiomPreviewPlayerContext = setAxiomPreviewPlayerContext;
    window.getAxiomPreviewPlayerContext = () => axiomPreviewPlayerContext;
    window.AXIOM_PREVIEW_PLAYER_CONTEXTS = Object.freeze({ ...AXIOM_PREVIEW_PLAYER_CONTEXTS });
    setAxiomPreviewPlayerContext(AXIOM_PREVIEW_PLAYER_CONTEXTS.browse, { stopCurrent: false });

    function addCurrentToPlaylist() {
      // Matching Songs keeps the set anchor separate from the preview. The
      // bottom player's action must follow its preview, not that anchor.
      const snapshot = axiomPreviewPlayerSnapshots[axiomPreviewPlayerContext] || {};
      const nativeContext = nativePlayerState.preview_context || axiomPreviewContextFromDeck(nativePlayerState.deck);
      const nativePreview = nativeContext === axiomPreviewPlayerContext ? nativePlayerState : {};
      const path = snapshot.path || nativePreview.path || (nativeContext === axiomPreviewPlayerContext ? currentPlayingPath : null);
      if (!path) {
        showToast("No track playing.", true);
        return;
      }
      const selected = typeof selectedSuggestionData !== 'undefined' && selectedSuggestionData?.path === path ? selectedSuggestionData : null;
      const cached = trackVisualCache.get(path);
      const anchor = currentAnchorTrack?.path === path ? currentAnchorTrack : null;
      const preview = snapshot.path === path ? snapshot : nativePreview;
      const t = normalizeModalTrackMetadata({ ...(selected || cached || anchor || preview), path });
      if (window.AxiomDawFinder?.active) return window.AxiomDawFinder.add(t);
      const modal = document.getElementById('replacement-modal');
      if (modal && !modal.classList.contains('hidden') && axiomPreviewPlayerContext === AXIOM_PREVIEW_PLAYER_CONTEXTS.browse) {
        selectedSuggestionData = t;
        return executeModalAction('add_after_anchor');
      }
      // The player action is explicitly a Studio set-list action. When the
      // DAW preview is active, do not route the track into the open project
      // or reject it; append it to the existing Studio set instead.
      return addTrackFromLibrary(t.path, t.title, t.artist, t.bpm, t.camelot, t.energy, t.genre, { forceStudioSet: true });
    }

    function keyboardPlayerTargetIsEditable(target) {
      if (!(target instanceof Element)) return false;
      return Boolean(target.closest('input, textarea, select, option, [contenteditable="true"], [role="slider"]'));
    }

    function keyboardPlayerRowGroups() {
      const modal = document.getElementById('replacement-modal');
      const modalOpen = modal && !modal.classList.contains('hidden');
      const definitions = modalOpen
        ? [{ id: 'matching', container: '#modal-suggestions-list', rows: '.anchor-suggestion-row[data-path]' }]
        : [
            { id: 'studio', container: '#active-playlist-container', rows: '.playlist-row[data-path]' },
            { id: 'library', container: '#search-results', rows: '.library-track-card[data-path]' },
            { id: 'library-matches', container: '#lib-suggestions-list', rows: '.recommendation-card[data-path]' },
            { id: 'playlists', container: '#playlist-listen-tracks', rows: '.playlist-listen-row[data-path]' }
          ];

      return definitions.map(definition => {
        const container = document.querySelector(definition.container);
        const rows = container ? Array.from(container.querySelectorAll(definition.rows)).filter(row => row.getClientRects().length > 0) : [];
        return { ...definition, container, rows };
      }).filter(group => group.container && group.container.getClientRects().length > 0 && group.rows.length > 0);
    }

    function keyboardPlayerTrackFromRow(row, group) {
      const path = row?.dataset?.path || '';
      if (!path) return null;
      if (group?.id === 'matching') {
        const suggestionIndex = Number(String(row.id || '').replace('sugg-', ''));
        const listIndex = Number.isFinite(suggestionIndex) && suggestionIndex >= window.lastSuggestions.length
          ? suggestionIndex - modalOffset
          : suggestionIndex;
        return normalizeModalTrackMetadata(window.lastSuggestions?.[listIndex] || trackVisualCache.get(path) || { path });
      }
      if (group?.id === 'playlists') {
        const rowIndex = group.rows.indexOf(row);
        return normalizeModalTrackMetadata(getSelectedPlaylist()?.tracks?.[rowIndex] || trackVisualCache.get(path) || { path });
      }
      const activeSetTrack = (getActiveSetList() || []).find(track => track.path === path);
      const cachedTrack = trackVisualCache.get(path) || activeSetTrack || {};
      return normalizeModalTrackMetadata({
        ...cachedTrack,
        path,
        title: cachedTrack.title || row.querySelector('.library-track-title, .recommendation-title, .studio-row-title, .anchor-suggestion-title')?.textContent?.trim() || 'Unknown Title',
        artist: cachedTrack.artist || row.querySelector('.library-track-artist, .recommendation-artist, .studio-row-artist, .anchor-suggestion-artist')?.textContent?.trim() || 'Unknown Artist'
      });
    }

    function selectKeyboardPlayerRow(row, group) {
      if (!row || !group) return;
      if (group.id === 'matching') {
        const suggestionIndex = Number(String(row.id || '').replace('sugg-', ''));
        selectSuggestion(Number.isFinite(suggestionIndex) ? suggestionIndex : group.rows.indexOf(row));
      } else if (group.id === 'studio') {
        highlightPlaylistTrack(row);
      } else if (group.id === 'library') {
        highlightLibraryTrack(row);
      } else if (group.id === 'library-matches') {
        setFocusDeckSelection(row, group.container);
      } else {
        group.container.querySelectorAll('.selected').forEach(item => item.classList.remove('selected'));
        row.classList.add('selected');
      }
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      row.focus({ preventScroll: true });
    }

    async function movePlayerSelectionByKeyboard(direction) {
      const groups = keyboardPlayerRowGroups();
      if (!groups.length) return false;
      const isPlaying = Boolean(nativePlayerState.playing);
      const path = currentPlayingPath || nativePlayerState.path || '';
      const selectedGroup = groups.find(group => group.rows.some(row => row.classList.contains('selected') || row.classList.contains('active-suggestion')));
      const playingGroup = groups.find(group => group.rows.some(row => row.dataset.path === path || row.classList.contains('playing-track')));
      const group = isPlaying ? (playingGroup || selectedGroup || groups[0]) : (selectedGroup || playingGroup || groups[0]);
      const selectedRow = group.rows.find(row => row.classList.contains('selected') || row.classList.contains('active-suggestion'));
      const playingRow = group.rows.find(row => row.dataset.path === path || row.classList.contains('playing-track'));
      const anchorRow = isPlaying ? (playingRow || selectedRow) : (selectedRow || playingRow);
      const currentIndex = anchorRow ? group.rows.indexOf(anchorRow) : (direction > 0 ? -1 : group.rows.length);
      const nextIndex = Math.max(0, Math.min(group.rows.length - 1, currentIndex + direction));
      const nextRow = group.rows[nextIndex];
      if (!nextRow || nextRow === anchorRow) return true;

      selectKeyboardPlayerRow(nextRow, group);
      if (!isPlaying) return true;

      const track = keyboardPlayerTrackFromRow(nextRow, group);
      if (!track?.path) return true;
      if (group.id === 'matching') {
        const suggestionIndex = Number(String(nextRow.id || '').replace('sugg-', ''));
        await playAndSelectSuggestion(null, Number.isFinite(suggestionIndex) ? suggestionIndex : nextIndex, track.path, track.title, track.artist, track.bpm || 0, track.camelot || '', track.energy || '', track.genre || '', track.year || '');
      } else if (group.id === 'playlists') {
        playSavedPlaylistTrack(nextIndex);
      } else {
        await playAudioFile(track.path, track.title || 'Unknown Title', track.artist || 'Unknown Artist', parseFloat(track.bpm) || 0, track.camelot || '', track.energy || '', null, track.genre || '');
        if (group.id === 'studio') highlightPlaylistTrack(nextRow);
        else if (group.id === 'library') highlightLibraryTrack(nextRow);
        else if (group.id === 'library-matches') setFocusDeckSelection(nextRow, group.container);
      }
      return true;
    }

    function focusAxiomSongSearchInput(input) {
      if (!input) return false;
      input.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      input.focus({ preventScroll: true });
      input.select();
      return true;
    }

    function focusAxiomSongSearch() {
      const matchingSongs = document.getElementById('replacement-modal');
      if (matchingSongs && !matchingSongs.classList.contains('hidden')) {
        return focusAxiomSongSearchInput(document.getElementById('modal-search'));
      }

      const visibleTab = String(window.axiomVisibleTab || '');
      if (visibleTab === 'library') {
        return focusAxiomSongSearchInput(document.getElementById('main-search'));
      }
      if (visibleTab !== 'studio') return false;

      // Studio keeps the working set in memory while Library supplies the
      // searchable catalogue. Cmd+F moves straight to that search without
      // clearing, replacing, or rebuilding the current set.
      switchTab('library');
      requestAnimationFrame(() => requestAnimationFrame(() => {
        focusAxiomSongSearchInput(document.getElementById('main-search'));
      }));
      return true;
    }

    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && String(e.key || '').toLowerCase() === 'f') {
        if (e.repeat || !focusAxiomSongSearch()) return;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (keyboardPlayerTargetIsEditable(e.target)) return;
        e.preventDefault();
        undoLastAction();
        return;
      }
      if (e.code === 'Space') {
        if (e.repeat || keyboardPlayerTargetIsEditable(e.target)) return;
        // Space is the cockpit-wide transport shortcut. Prevent the browser's
        // focused-button activation so an artwork/play button cannot replay the
        // track instead of pausing it. Buttons remain keyboard-operable with Enter.
        e.preventDefault();
        const modal = document.getElementById('replacement-modal');
        if (modal && !modal.classList.contains('hidden')) {
            toggleModalPlay();
        } else {
            togglePlay();
        }
        return;
      }
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        if (e.defaultPrevented) return;
        if (keyboardPlayerTargetIsEditable(e.target)) return;
        e.preventDefault();
        movePlayerSelectionByKeyboard(e.key === 'ArrowUp' ? -1 : 1);
      }
    });

    function handleNativeAudioEnded() {
      if (nativePlayerState.deck === 'modal'
          || axiomPreviewContextFromDeck(nativePlayerState.deck) === AXIOM_PREVIEW_PLAYER_CONTEXTS.daw
          || normalizeAxiomPreviewPlayerContext(nativePlayerState.preview_context) === AXIOM_PREVIEW_PLAYER_CONTEXTS.daw) {
        document.body.classList.remove('has-playing');
        syncMainPlayerControls();
        return;
      }
      const playlistsTab = document.getElementById('tab-content-playlists');
      if (playlistsTab && !playlistsTab.classList.contains('hidden')) {
        playNextSavedPlaylistTrack();
      } else {
        const toggle = document.getElementById('studio-autoplay-toggle');
        if (toggle && toggle.checked) {
          const list = getActiveSetList();
          if (list && list.length > 0) {
            const currentIndex = list.findIndex(t => t.path === currentPlayingPath);
            if (currentIndex !== -1 && currentIndex < list.length - 1) {
              const nextTrack = list[currentIndex + 1];
              playAudioFile(nextTrack.path, nextTrack.title || 'Unknown Title', nextTrack.artist || 'Unknown Artist', parseFloat(nextTrack.bpm) || 0, nextTrack.camelot || '', nextTrack.energy || '', null, nextTrack.genre || '');
              highlightPlaylistTrack(document.querySelector(`[data-path="${CSS.escape(nextTrack.path)}"]`));
              return;
            }
          }
        }
        // No auto-next: restore the appealing idle state for library night mode
        document.body.classList.remove('has-playing');
        syncMainPlayerControls();
      }
    }

    async function seekAudio(e) {
      if (!nativePlayerState.duration) return;
      const rect = document.getElementById('progress-container').getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      try {
        await nativeAudioRequest('/api/audio/seek', { seconds: pct * nativePlayerState.duration });
      } catch (err) {
        showToast(`Seek failed: ${err.message}`, true);
      }
    }
