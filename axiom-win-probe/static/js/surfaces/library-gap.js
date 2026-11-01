    // Library Gap Check, missing-song review, and set-builder handoff.
    const WORKING_SET_ANIMATION_KEY = 'axiomWorkingSetAddAnimation.v1';
    const WORKING_SET_SESSION_HIDDEN_KEY = 'axiomWorkingSetAnimationSessionHidden.v1';
    const WORKING_SET_SESSION_COUNT_KEY = 'axiomWorkingSetAnimationSessionCount.v1';
    const MATCHING_SONGS_POSITION_KEY = 'axiomMatchingSongsButtonPosition.v1';
    const LIBRARY_MATCHING_SONGS_KEY = 'axiomLibraryMatchingSongs.v1';
    const LIBRARY_GAP_FREE_USES = 5;
    const LIBRARY_GAP_PACK_SIZE = 5;
    const LIBRARY_GAP_USAGE_KEY = 'axiomLitePastePlaylistUsage.v1';
    const LIBRARY_GAP_REQUIRED_CONFIRMATION_LIMIT = 3;
    let libraryRailMode = 'matching';
    let libraryGapPayload = null;
    let libraryGapLastFocus = null;
    let libraryGapBuilderLastFocus = null;
    let libraryGapBuilderSelections = {};
    let libraryGapBuilderExcluded = new Set();
    let libraryGapBuilderOpenVersionsRow = -1;
    let libraryGapSearchActiveIndex = -1;
    let libraryGapSearchResults = [];
    let libraryGapBuilderPreviewTimer = null;
    let libraryGapBuilderPreview = {
      rowIndex: -1,
      versionIndex: -1,
      path: '',
      title: '',
      artist: '',
      duration: 0,
      currentTime: 0,
      playing: false,
      fixture: false,
    };

    function libraryGapPurchaseState() {
      let value = {};
      try { value = JSON.parse(localStorage.getItem(LIBRARY_GAP_USAGE_KEY) || '{}') || {}; } catch (_) { value = {}; }
      return {
        freeUsed: Math.max(0, Math.min(LIBRARY_GAP_FREE_USES, Number(value.freeUsed) || 0)),
        purchasedCredits: Math.max(0, Number(value.purchasedCredits) || 0),
        processedTransactions: Array.isArray(value.processedTransactions)
          ? value.processedTransactions.map((id) => String(id || '')).filter(Boolean).slice(-100)
          : [],
      };
    }

    function saveLibraryGapPurchaseState(state = {}) {
      localStorage.setItem(LIBRARY_GAP_USAGE_KEY, JSON.stringify({
        freeUsed: Math.max(0, Math.min(LIBRARY_GAP_FREE_USES, Number(state.freeUsed) || 0)),
        purchasedCredits: Math.max(0, Number(state.purchasedCredits) || 0),
        processedTransactions: Array.isArray(state.processedTransactions)
          ? state.processedTransactions.map((id) => String(id || '')).filter(Boolean).slice(-100)
          : [],
      }));
    }

    function libraryGapHasPasteCredit() {
      if (typeof isAxiomLite !== 'function' || !isAxiomLite()) return true;
      const state = libraryGapPurchaseState();
      return state.freeUsed < LIBRARY_GAP_FREE_USES || state.purchasedCredits > 0;
    }

    function requestLibraryGapPastePackPurchase() {
      const nativeBridge = window.webkit?.messageHandlers?.axiomNative;
      if (nativeBridge?.postMessage && window.__AXIOM_NATIVE_STOREKIT_READY === true) {
        nativeBridge.postMessage({ action: 'purchaseAxiomProduct', productId: 'com.axiomdj.lite.paste5' });
        showToast('Apple purchase sheet requested for 5 more Paste a Playlist checks.', false, { important: true });
        return true;
      }
      showToast('App Store purchase setup is not available in this test build. The $5 Paste a Playlist pack will be available in the Mac App Store version of AXIOM Lite.', true, { important: true });
      return false;
    }

    function showLibraryGapPasteLimit() {
      const message = `You have used your ${LIBRARY_GAP_FREE_USES} free Paste a Playlist checks. Buy ${LIBRARY_GAP_PACK_SIZE} more for $5 in AXIOM Lite.`;
      if (typeof showToastWithAction === 'function') {
        showToastWithAction(message, 'Buy 5 More — $5', requestLibraryGapPastePackPurchase);
      } else {
        showToast(message, true, { important: true });
      }
      return false;
    }

    function consumeLibraryGapPasteCredit() {
      if (typeof isAxiomLite !== 'function' || !isAxiomLite()) return true;
      const state = libraryGapPurchaseState();
      if (state.freeUsed < LIBRARY_GAP_FREE_USES) state.freeUsed += 1;
      else if (state.purchasedCredits > 0) state.purchasedCredits -= 1;
      else return showLibraryGapPasteLimit();
      saveLibraryGapPurchaseState(state);
      return true;
    }

    window.__AXIOM_LITE_PASTE_PACK_PURCHASED = function(payload = {}) {
      if (typeof isAxiomLite !== 'function' || !isAxiomLite() || payload.verified !== true || !payload.transactionId) return false;
      const state = libraryGapPurchaseState();
      const transactionId = String(payload.transactionId);
      if (state.processedTransactions.includes(transactionId)) return false;
      state.purchasedCredits += LIBRARY_GAP_PACK_SIZE;
      state.processedTransactions.push(transactionId);
      saveLibraryGapPurchaseState(state);
      showToast(`${LIBRARY_GAP_PACK_SIZE} more Paste a Playlist checks are ready.`, false, { important: true });
      return true;
    };

    window.__AXIOM_NATIVE_STOREKIT_PURCHASE_FAILED = function(message) {
      showToast(String(message || 'The AXIOM Lite purchase could not be completed.'), true, { important: true });
    };

    function ensureLibraryGapWorkspace() {
      let workspace = document.getElementById('library-gap-workspace');
      if (workspace) return workspace;
      workspace = document.createElement('div');
      workspace.id = 'library-gap-workspace';
      workspace.className = 'library-gap-workspace hidden';
      workspace.setAttribute('aria-hidden', 'true');
      workspace.innerHTML = `
        <div class="library-gap-workspace-shell" role="dialog" aria-modal="true" aria-labelledby="library-gap-workspace-title" aria-describedby="library-gap-workspace-description">
          <header class="library-gap-workspace-head">
            <div>
              <span>Source Switcher</span>
              <h2 id="library-gap-workspace-title">Paste A <em>Playlist</em></h2>
              <p id="library-gap-workspace-description">Import a song list, YouTube video, Apple Music or Spotify playlist. Find the music you own and save the rest to buy.</p>
              <p id="library-gap-entitlement-copy" class="library-gap-entitlement-copy" role="status"></p>
            </div>
            <div class="library-gap-workspace-head-actions">
              <span>Your music<br>works harder</span>
              <button type="button" class="library-gap-close" aria-label="Close Paste a Playlist" onclick="closeLibraryGapWorkspace()"><small>Close</small><img src="/static/icons/x.svg" alt=""></button>
            </div>
          </header>
          <div class="library-gap-workspace-grid">
            <section class="library-gap-input-column" aria-labelledby="library-gap-input-title">
              <div class="library-gap-section-heading">
                <span class="library-gap-step-number" aria-hidden="true">1</span>
                <div><strong id="library-gap-input-title">Add Your Songs</strong><span>Choose how you want to import your playlist.</span></div>
              </div>
              <div class="library-gap-source-switcher" role="group" aria-label="Choose playlist source">
                <button id="library-gap-source-paste" type="button" class="library-gap-source-button is-active" data-library-gap-source="paste" aria-pressed="true" onclick="setLibraryGapInputSource('paste')">
                  <img src="/static/icons/clipboard.svg" alt=""> <span>Paste Songs</span>
                </button>
                <button id="library-gap-upload-button" type="button" class="library-gap-source-button" data-library-gap-source="upload" aria-pressed="false" onclick="setLibraryGapInputSource('upload'); document.getElementById('library-gap-file').click()">
                  <img src="/static/icons/file-up.svg" alt=""> <span>Upload File</span>
                </button>
                <button id="library-gap-spotify-toggle" type="button" class="library-gap-source-button library-gap-spotify-toggle" data-library-gap-source="spotify" aria-expanded="false" aria-pressed="false" aria-controls="library-gap-spotify-panel" onclick="setLibraryGapInputSource('spotify')">
                  <img src="/static/icons/spotify.svg" alt=""> <span>Spotify Link</span>
                </button>
                <button type="button" class="library-gap-source-button" data-library-gap-source="apple" aria-pressed="false" onclick="setLibraryGapInputSource('apple')"><img src="/static/icons/apple-music.png" alt=""><span>Apple Music</span></button>
                <button type="button" class="library-gap-source-button" data-library-gap-source="youtube" aria-pressed="false" onclick="setLibraryGapInputSource('youtube')"><img src="/static/icons/youtube.svg" alt=""><span>YouTube</span></button>
              </div>
              <div id="library-gap-youtube-panel" class="hidden library-gap-link-panel">
                <label for="library-gap-youtube-url">YouTube video link</label>
                <input id="library-gap-youtube-url" type="url" autocomplete="off" placeholder="Paste YouTube video link..." onkeydown="if(event.key==='Enter'){event.preventDefault();runLibraryGapCheck()}">
                <p>Read the video's music credits and description tracklist, then find those songs in your Library.</p>
                <p id="library-gap-youtube-receipt" role="status"></p>
              </div>
              <div id="library-gap-apple-panel" class="hidden library-gap-link-panel">
                <label id="library-gap-apple-label" for="library-gap-apple-url">Apple Music playlist link</label>
                <input id="library-gap-apple-url" type="url" autocomplete="off" placeholder="Paste Apple Music playlist link..." onkeydown="if(event.key==='Enter'){event.preventDefault();runLibraryGapCheck()}">
                <p id="library-gap-apple-help"></p>
                <p id="library-gap-apple-receipt" role="status"></p>
              </div>
              <label for="library-gap-input" class="sr-only">Songs to check</label>
              <textarea id="library-gap-input" placeholder="Red Red Wine - UB40&#10;September - Earth, Wind &amp; Fire&#10;Levitating - Dua Lipa&#10;Around The World - Daft Punk&#10;Lose Yourself - Eminem" oninput="updateLibraryGapInputCount()"></textarea>
              <input id="library-gap-file" type="file" accept=".csv,.txt,.md,text/csv,text/plain,text/markdown" class="hidden" onchange="handleLibraryGapFile(this)">
              <div id="library-gap-spotify-panel" class="library-gap-spotify-panel hidden">
                <label for="library-gap-spotify-url" class="sr-only">Spotify playlist link</label>
                <img src="/static/icons/spotify.svg" alt="" aria-hidden="true">
                <input id="library-gap-spotify-url" type="url" inputmode="url" autocomplete="off" placeholder="Paste Spotify playlist link..." oninput="updateLibraryGapSpotifyInputState()" onkeydown="if(event.key === 'Enter'){ event.preventDefault(); runLibraryGapCheck(); }">
              </div>
              <div id="library-gap-spotify-feedback" class="library-gap-spotify-feedback hidden" aria-live="polite">
                <p id="library-gap-spotify-state">Paste a public Spotify playlist link, then press Check My Library. Existing songs stay in the list.</p>
                <div id="library-gap-spotify-receipt" class="library-gap-spotify-receipt hidden"></div>
              </div>
              <div class="library-gap-input-footer">
                <p id="library-gap-source-helper" class="library-gap-source-helper">Paste one song per line. AXIOM keeps your existing list intact.</p>
                <span id="library-gap-input-count">0 songs</span>
              </div>
              <button id="library-gap-check-button" type="button" class="library-gap-primary" onclick="runLibraryGapCheck()"><span>Check My Library</span><img src="/static/icons/arrow-right.svg" alt=""></button>
              <p class="library-gap-trust"><img src="/static/icons/lock-keyhole.svg" alt=""><span>Your library stays safe</span><small>AXIOM reads its Library cache only. No files are changed.</small></p>
            </section>
            <section class="library-gap-results-column" aria-labelledby="library-gap-results-title">
              <div class="library-gap-section-heading">
                <span class="library-gap-step-number" aria-hidden="true">2</span>
                <div><strong id="library-gap-results-title">Review Results</strong><span>See what is ready, what needs review, and what's still missing.</span></div>
              </div>
              <div id="library-gap-summary" class="library-gap-summary hidden"></div>
              <div id="library-gap-status" class="library-gap-status is-ready" aria-live="polite">
                <img src="/static/icons/check-circle.svg" alt="" aria-hidden="true">
                <strong>Ready To Check</strong>
                <span>Add songs from any source, then AXIOM will compare the combined list with your Library.</span>
              </div>
              <div id="library-gap-results" class="library-gap-results"></div>
              <div id="library-gap-actions" class="library-gap-actions hidden">
                <button id="library-gap-clear-button" type="button" class="library-gap-clear-button" onclick="clearLibraryGapInput()"><img src="/static/icons/trash-2.svg" alt=""> Clear All</button>
                <button id="library-gap-buy-list" type="button" class="library-gap-clear-button hidden" onclick="saveLibraryGapBuyList()">Save Missing To Buy</button>
                <button id="library-gap-recovery-launch" type="button" class="library-gap-recovery-launch" onclick="openLibraryGapRecovery()">Search Outside AXIOM For Missing Songs</button>
                <button id="library-gap-builder-launch" type="button" class="library-gap-builder-launch" onclick="openLibraryGapBuilder()"><span>Build Full Set</span><img src="/static/icons/arrow-right.svg" alt=""></button>
              </div>
            </section>
          </div>
        </div>
      `;
      workspace.addEventListener('click', event => {
        if (event.target === workspace) closeLibraryGapWorkspace();
      });
      workspace.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeLibraryGapWorkspace();
      });
      const entitlementCopy = workspace.querySelector('#library-gap-entitlement-copy');
      if (entitlementCopy) {
        entitlementCopy.textContent = typeof isAxiomLite === 'function' && isAxiomLite()
          ? 'AXIOM Lite includes 5 free checks. Buy 5 more for $5 in the Mac App Store.'
          : 'Unlimited Paste a Playlist checks in AXIOM Pro.';
      }
      document.body.appendChild(workspace);
      return workspace;
    }

    function openLibraryGapWorkspace() {
      if (!libraryGapHasPasteCredit()) return showLibraryGapPasteLimit();
      const workspace = ensureLibraryGapWorkspace();
      libraryGapLastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      libraryRailMode = 'gap';
      document.body.classList.add('library-gap-check-active');
      workspace.classList.remove('hidden');
      workspace.classList.remove('has-results');
      workspace.setAttribute('aria-hidden', 'false');
      document.querySelectorAll('.library-gap-launch').forEach(button => button.setAttribute('aria-expanded', 'true'));
      window.setTimeout(() => {
        const activeSource = document.querySelector('[data-library-gap-source].is-active')?.dataset.libraryGapSource;
        const focusTarget = ['spotify','apple','youtube'].includes(activeSource)
          ? document.getElementById(`library-gap-${activeSource}-url`)
          : document.getElementById('library-gap-input');
        focusTarget?.focus({ preventScroll: true });
        document.querySelector('.library-gap-workspace-shell')?.scrollTo?.(0, 0);
        updateLibraryGapSpotifyInputState();
      }, 40);
    }

    function closeLibraryGapWorkspace() {
      const workspace = document.getElementById('library-gap-workspace');
      if (!workspace || workspace.classList.contains('hidden')) return;
      workspace.classList.add('hidden');
      workspace.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('library-gap-check-active');
      document.querySelectorAll('.library-gap-launch').forEach(button => button.setAttribute('aria-expanded', 'false'));
      libraryRailMode = 'matching';
      libraryGapLastFocus?.focus?.();
    }

    function setLibraryRailMode(mode = 'matching') {
      if (mode === 'gap') {
        openLibraryGapWorkspace();
        return;
      }
      closeLibraryGapWorkspace();
    }

    function libraryGapStatus(title, detail, state = '') {
      const status = document.getElementById('library-gap-status');
      if (!status) return;
      const ready = !state && String(title || '').toLowerCase() === 'ready to check';
      status.className = `library-gap-status ${ready ? 'is-ready' : state ? `is-${state}` : ''}`.trim();
      status.innerHTML = `${ready ? '<img src="/static/icons/check-circle.svg" alt="" aria-hidden="true">' : ''}<strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span>`;
    }

    function updateLibraryGapInputCount() {
      const input = document.getElementById('library-gap-input');
      const count = document.getElementById('library-gap-input-count');
      if (!input || !count) return 0;
      const lines = String(input.value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      count.textContent = `${lines.length.toLocaleString()} ${lines.length === 1 ? 'song' : 'songs'}`;
      return lines.length;
    }

    function clearLibraryGapInput() {
      const input = document.getElementById('library-gap-input');
      const spotify = document.getElementById('library-gap-spotify-url');
      const summary = document.getElementById('library-gap-summary');
      const results = document.getElementById('library-gap-results');
      const actions = document.getElementById('library-gap-actions');
      if (input) input.value = '';
      if (spotify) spotify.value = '';
      clearLibraryGapLinkMetadata();
      updateLibraryGapSpotifyInputState();
      updateLibraryGapInputCount();
      libraryGapPayload = null;
      summary?.classList.add('hidden');
      actions?.classList.add('hidden');
      results?.replaceChildren();
      document.getElementById('library-gap-workspace')?.classList.remove('has-results');
      libraryGapStatus('Ready To Check', 'Add songs from any source, then AXIOM will compare the combined list with your Library.', '');
      input?.focus({ preventScroll: true });
    }

    function libraryGapStatusLabel(status = '') {
      if (status === 'in_library' || status === 'resolved_local') return 'Found';
      if (status === 'possible_match') return 'Needs Review';
      return 'Missing';
    }

    function renderLibraryGapPayload(payload = {}) {
      libraryGapPayload = payload;
      document.getElementById('library-gap-workspace')?.classList.add('has-results');
      libraryGapBuilderSelections = {};
      libraryGapBuilderExcluded = new Set();
      const counts = payload.counts || {};
      const summary = document.getElementById('library-gap-summary');
      const results = document.getElementById('library-gap-results');
      const actions = document.getElementById('library-gap-actions');
      const recoveryLaunch = document.getElementById('library-gap-recovery-launch');
      const builderLaunch = document.getElementById('library-gap-builder-launch');
      if (summary) {
        summary.classList.remove('hidden');
        summary.innerHTML = `
          <div class="found"><strong>${Number(counts.in_library || 0).toLocaleString()}</strong><span>Found</span><small>In your library</small></div>
          <div class="review"><strong>${Number(counts.possible_match || 0).toLocaleString()}</strong><span>Needs Review</span><small>Possible matches</small></div>
          <div class="missing"><strong>${Number(counts.not_found || 0).toLocaleString()}</strong><span>Missing</span><small>Not in your library</small></div>
        `;
      }
      const rows = Array.isArray(payload.results) ? payload.results : [];
      const missingCount = Number(counts.not_found || 0);
      document.getElementById('library-gap-buy-list')?.classList.toggle('hidden', missingCount === 0);
      if (recoveryLaunch) {
        recoveryLaunch.classList.toggle('hidden', missingCount === 0);
        recoveryLaunch.textContent = `Search Outside AXIOM For ${missingCount.toLocaleString()} Missing Song${missingCount === 1 ? '' : 's'}`;
        recoveryLaunch.setAttribute('aria-label', `Search other music sources for ${missingCount.toLocaleString()} song${missingCount === 1 ? '' : 's'} missing from your pasted list`);
      }
      if (builderLaunch) {
        builderLaunch.innerHTML = missingCount
          ? '<span>Build Full Set</span><img src="/static/icons/arrow-right.svg" alt="">'
          : '<span>Use Matched Tracks</span><img src="/static/icons/arrow-right.svg" alt="">';
        builderLaunch.setAttribute(
          'aria-label',
          missingCount
            ? `Build the full ${rows.length.toLocaleString()} song request in Studio, including ${missingCount.toLocaleString()} missing placeholder${missingCount === 1 ? '' : 's'}`
            : `Open ${rows.length.toLocaleString()} matched song${rows.length === 1 ? '' : 's'} in Studio`
        );
      }
      if (results) {
        results.innerHTML = rows.slice(0, 8).map((item, index) => {
          const requested = item.requested || {};
          const firstVersion = Array.isArray(item.versions) ? item.versions[0] : null;
          const versionWarning = item.status === 'in_library' && item.requested_version_confirmed === false
            ? 'Base song found; requested version not confirmed'
            : '';
          const detail = versionWarning
            || (firstVersion ? `${firstVersion.artist || 'Unknown Artist'} · ${item.version_count || 1} version${Number(item.version_count || 1) === 1 ? '' : 's'}` : 'No confident local match');
          const requestedTitle = requested.title || requested.raw || 'Unknown Song';
          const displayTitle = requestedTitle;
          const displayArtist = requested.artist || firstVersion?.artist || 'Unknown Artist';
          const artworkTrack = firstVersion || { ...requested, path: '' };
          const artwork = String(artworkTrack.path || '').startsWith('preview://')
            ? generatedTrackArtwork(artworkTrack)
            : getTrackArtwork(artworkTrack) || generatedTrackArtwork(artworkTrack);
          const actionLabel = item.status === 'not_found' ? 'Find this song' : 'Choose a version';
          const statusIcon = item.status === 'possible_match' || item.status === 'not_found'
            ? '/static/icons/circle-alert.svg'
            : '/static/icons/check-circle.svg';
          return `
            <div class="library-gap-result" data-status="${escapeHtml(item.status)}">
              <div class="library-gap-result-art"><img src="${escapeHtml(artwork)}" alt="${escapeHtml(displayTitle)} artwork" onerror="this.src='/static/axiom-mark.png';this.onerror=null;"></div>
              <div class="library-gap-result-copy">
                <strong>${escapeHtml(displayTitle)}</strong>
                <span>${escapeHtml(displayArtist)}</span>
              </div>
              <div class="library-gap-result-meta">
                <strong><img src="${statusIcon}" alt="">${libraryGapStatusLabel(item.status)}</strong>
                <span>${escapeHtml(detail)}</span>
              </div>
              <button type="button" class="library-gap-result-action" title="${escapeHtml(actionLabel)}" aria-label="${escapeHtml(actionLabel)} for ${escapeHtml(displayTitle)}" onclick="openLibraryGapResultAction(${index})"><img src="/static/icons/ellipsis.svg" alt=""></button>
            </div>
          `;
        }).join('');
      }
      actions?.classList.toggle('hidden', rows.length === 0);
      libraryGapStatus(
        `${rows.length.toLocaleString()} Songs Checked`,
        `${Number(counts.in_library || 0).toLocaleString()} found, ${Number(counts.possible_match || 0).toLocaleString()} to review, ${Number(counts.not_found || 0).toLocaleString()} missing. Source audio untouched.`
      );
      updateLibraryGapInputCount();
    }

    function openLibraryGapResultAction(index = -1) {
      const item = libraryGapPayload?.results?.[Number(index)] || {};
      if (item.status === 'not_found') {
        openLibraryGapRecovery();
        return;
      }
      libraryGapBuilderOpenVersionsRow = Number(index);
      openLibraryGapBuilder();
    }

    async function runLibraryGapCheck() {
      const input = document.getElementById('library-gap-input');
      const button = document.getElementById('library-gap-check-button');
      const spotifyPanel = document.getElementById('library-gap-spotify-panel');
      const spotifyMode = Boolean(spotifyPanel && !spotifyPanel.classList.contains('hidden'));
      const applePanel = document.getElementById('library-gap-apple-panel');
      const appleMode = Boolean(applePanel && !applePanel.classList.contains('hidden'));
      const youtubePanel = document.getElementById('library-gap-youtube-panel');
      const youtubeMode = Boolean(youtubePanel && !youtubePanel.classList.contains('hidden'));
      let text = String(input?.value || '').trim();
      if (!text && !spotifyMode && !appleMode && !youtubeMode) {
        libraryGapStatus('Paste Songs First', 'Add one song per line, paste a table, or upload a CSV or text file.', 'error');
        input?.focus();
        return;
      }
      if (button) {
        button.disabled = true;
        button.textContent = spotifyMode ? 'Adding Spotify Songs...' : 'Checking Library...';
      }
      try {
        if (youtubeMode || (!appleMode && !spotifyMode && isLibraryGapYouTubeLink(text))) {
          if (button) button.textContent = 'Reading YouTube Songs...';
          if (!await importLibraryGapYouTubeVideo(youtubeMode ? '' : text)) return;
          text = String(input?.value || '').trim();
        }
        if (appleMode) {
          if (button) button.textContent = 'Reading Playlist...';
          if (!await importLibraryGapApplePlaylist()) return;
          text = String(input?.value || '').trim();
        }
        if (spotifyMode) {
          const imported = await importLibraryGapSpotifyPlaylist();
          if (!imported) return;
          text = String(input?.value || '').trim();
        }
        if (!text) {
          libraryGapStatus('No Songs Found In That Playlist', 'Try another public Spotify playlist link.', 'error');
          return;
        }
        if (button) button.textContent = 'Checking Library...';
        libraryGapStatus('Checking Library', 'Comparing your list with AXIOM\'s indexed Library cache.', 'working');
        const response = await fetch('/api/library/gap-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.success === false) throw new Error(payload.error || 'Library check could not finish.');
        if (payload.truncated) throw new Error('This list contains more than 1,000 unique songs. Split it into smaller lists so every song is checked.');
        if (!consumeLibraryGapPasteCredit()) return;
        if (input && Array.isArray(payload.songs)) {
          input.value = payload.songs.map(song => song.artist ? `${song.artist} - ${song.title}` : song.title).join('\n');
        }
        renderLibraryGapPayload(payload);
      } catch (error) {
        libraryGapStatus('Could Not Check The List', error?.message || 'Try again.', 'error');
      } finally {
        if (button) {
          button.disabled = false;
          button.innerHTML = '<span>Check My Library</span><img src="/static/icons/arrow-right.svg" alt="">';
        }
      }
    }

    async function handleLibraryGapFile(input) {
      const file = input?.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const response = await fetch('/api/library/playlist/parse', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
        const parsed = await response.json();
        if (!response.ok || !parsed.success) throw new Error(parsed.error || 'Could not read this song list.');
        const songText = parsed.songs.map(song=>song.artist ? `${song.artist} - ${song.title}` : song.title).join('\n');
        const textarea = document.getElementById('library-gap-input');
        if (textarea) textarea.value = mergeLibraryGapSongLists(textarea.value, songText).text;
        libraryGapStatus('List Loaded', `${file.name} is ready to check.`, 'working');
        await runLibraryGapCheck();
      } catch (error) {
        libraryGapStatus('Could Not Read That File', error.message || 'Use a CSV, TXT, or Markdown file.', 'error');
      } finally {
        input.value = '';
      }
    }

    function setLibraryGapInputSource(mode = 'paste', options = {}) {
      const panel = document.getElementById('library-gap-spotify-panel');
      const feedback = document.getElementById('library-gap-spotify-feedback');
      const helper = document.getElementById('library-gap-source-helper');
      const normalized = ['paste', 'upload', 'spotify', 'apple', 'youtube'].includes(mode) ? mode : 'paste';
      const spotifyMode = normalized === 'spotify';
      document.querySelectorAll('[data-library-gap-source]').forEach(button => {
        const active = button.dataset.libraryGapSource === normalized;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      panel?.classList.toggle('hidden', !spotifyMode);
      feedback?.classList.toggle('hidden', !spotifyMode);
      const spotifyToggle = document.getElementById('library-gap-spotify-toggle');
      spotifyToggle?.setAttribute('aria-expanded', spotifyMode ? 'true' : 'false');
      configureLibraryGapLinkSource(normalized);
      if (helper) {
        helper.textContent = spotifyMode
          ? 'Paste a public playlist link. Spotify songs will be added without replacing this list.'
          : normalized === 'upload'
            ? 'Choose a CSV, TXT, or Markdown file. Its songs will load into the list below.'
            : 'Paste one song per line. AXIOM keeps your existing list intact.';
      }
      if (spotifyMode && options.focus !== false) {
        window.setTimeout(() => {
          updateLibraryGapSpotifyInputState();
          document.getElementById('library-gap-spotify-url')?.focus({ preventScroll: true });
          document.querySelector('.library-gap-workspace-shell')?.scrollTo?.(0, 0);
        }, 30);
      } else if (normalized === 'paste' && options.focus !== false) {
        document.getElementById('library-gap-input')?.focus({ preventScroll: true });
      }
      if (normalized === 'youtube') {
        if (helper) helper.textContent = 'Credits and tracklists are merged without duplicate songs. Review the versions before building your set.';
        if (options.focus !== false) document.getElementById('library-gap-youtube-url')?.focus();
      }
      if (normalized === 'apple') {
        if (helper) helper.textContent = 'Songs are merged into your list. Repeat imports do not add duplicates.';
        if (options.focus !== false) document.getElementById('library-gap-apple-url')?.focus();
      }
      return normalized;
    }

    function toggleLibraryGapSpotifyImport(forceOpen = null) {
      const panel = document.getElementById('library-gap-spotify-panel');
      const currentlyOpen = Boolean(panel && !panel.classList.contains('hidden'));
      const shouldOpen = forceOpen === null ? !currentlyOpen : Boolean(forceOpen);
      setLibraryGapInputSource(shouldOpen ? 'spotify' : 'paste');
    }

    function libraryGapSongLineKey(line = '') {
      const normalized = String(line || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
      const parts = normalized.split(/\s+[-–—]\s+/).filter(Boolean);
      const clean = value => value.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      return parts.length === 2 ? parts.map(clean).sort().join(' :: ') : clean(normalized);
    }

    function mergeLibraryGapSongLists(existingText = '', importedText = '') {
      const existingLines = String(existingText || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const importedLines = String(importedText || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const mergedLines = [];
      const seen = new Set();
      existingLines.forEach(line => {
        const key = libraryGapSongLineKey(line);
        if (!key || seen.has(key)) return;
        seen.add(key);
        mergedLines.push(line);
      });
      let addedCount = 0;
      let skippedCount = 0;
      importedLines.forEach(line => {
        const key = libraryGapSongLineKey(line);
        if (!key || seen.has(key)) {
          skippedCount += 1;
          return;
        }
        seen.add(key);
        mergedLines.push(line);
        addedCount += 1;
      });
      return { text: mergedLines.join('\n'), addedCount, skippedCount };
    }

    function updateLibraryGapSpotifyInputState() {
      const input = document.getElementById('library-gap-spotify-url');
      if (!input) return false;
      const link = String(input.value || '').trim();
      const valid = /^https:\/\/(?:www\.)?open\.spotify\.com\/playlist\/[A-Za-z0-9]+(?:[/?#].*)?$/.test(link) || /^spotify:playlist:[A-Za-z0-9]+$/.test(link);
      input.classList.toggle('has-value', Boolean(link));
      input.classList.toggle('is-valid', valid);
      input.classList.toggle('is-invalid', Boolean(link) && !valid);
      input.setAttribute('aria-invalid', Boolean(link) && !valid ? 'true' : 'false');
      return valid;
    }

    function renderLibraryGapSpotifyReceipt(spotify = {}) {
      const receipt = document.getElementById('library-gap-spotify-receipt');
      if (!receipt) return;
      receipt.replaceChildren();
      const copy = document.createElement('span');
      const importedCount = Number(spotify.imported_count || 0);
      const addedCount = Number.isFinite(Number(spotify.added_count)) ? Number(spotify.added_count) : importedCount;
      const skippedCount = Number(spotify.skipped_count || 0);
      const playlistName = spotify.playlist_name || 'Spotify Playlist';
      if (importedCount > 0 && addedCount === 0 && skippedCount >= importedCount) {
        copy.textContent = `Playlist already imported. All ${importedCount.toLocaleString()} Spotify song${importedCount === 1 ? '' : 's'} from ${playlistName} are already in your current list. Nothing was duplicated.`;
      } else {
        copy.textContent = `${addedCount.toLocaleString()} new Spotify song${addedCount === 1 ? '' : 's'} added to your current list from ${playlistName}.${skippedCount ? ` ${skippedCount.toLocaleString()} song${skippedCount === 1 ? ' was' : 's were'} already in your list and ${skippedCount === 1 ? 'was' : 'were'} not duplicated.` : ''}`;
      }
      receipt.appendChild(copy);
      const url = String(spotify.playlist_url || '');
      if (/^https:\/\/open\.spotify\.com\/playlist\/[A-Za-z0-9]+$/.test(url)) {
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = 'Open In Spotify';
        receipt.appendChild(link);
      }
      receipt.classList.remove('hidden');
    }

    async function importLibraryGapSpotifyPlaylist() {
      const input = document.getElementById('library-gap-spotify-url');
      const link = String(input?.value || '').trim();
      if (!/^https:\/\/(?:www\.)?open\.spotify\.com\/playlist\/[A-Za-z0-9]+(?:[/?#].*)?$/.test(link) && !/^spotify:playlist:[A-Za-z0-9]+$/.test(link)) {
        libraryGapStatus('Paste A Spotify Playlist Link', 'Use the playlist share link, not a song, album, or artist link.', 'error');
        input?.focus();
        return null;
      }
      libraryGapStatus('Adding Spotify Songs', 'Reading the playlist song names and adding them to your current list.', 'working');
      try {
        const response = await fetch('/api/library/spotify/playlist-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: link })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.success === false) throw new Error(payload.error || 'Spotify playlist import could not finish.');
        const textarea = document.getElementById('library-gap-input');
        const existingText = String(textarea?.value || '');
        const merged = mergeLibraryGapSongLists(existingText, payload.imported_text || '');
        if (textarea) textarea.value = merged.text;
        rememberLibraryGapLink(payload.spotify || {}, []);
        renderLibraryGapSpotifyReceipt({ ...(payload.spotify || {}), added_count: merged.addedCount, skipped_count: merged.skippedCount });
        return payload;
      } catch (error) {
        libraryGapStatus('Spotify Playlist Not Imported', error?.message || 'Try again.', 'error');
        return null;
      }
    }

    function openLibraryGapResults() {
      const rows = Array.isArray(libraryGapPayload?.results) ? libraryGapPayload.results : [];
      if (!rows.length) return;
      document.getElementById('library-gap-results-modal')?.remove();
      const modal = document.createElement('div');
      modal.id = 'library-gap-results-modal';
      modal.className = 'library-gap-results-modal';
      modal.innerHTML = `
        <div class="library-gap-results-modal-shell" role="dialog" aria-modal="true" aria-labelledby="library-gap-results-modal-title">
          <div class="library-gap-results-modal-head">
            <h2 id="library-gap-results-modal-title">Song List Results</h2>
            <button type="button" onclick="document.getElementById('library-gap-results-modal')?.remove()">Close</button>
          </div>
          <div class="library-gap-results-modal-list">
            ${rows.map(item => {
              const requested = item.requested || {};
              const versions = (item.versions || []).map(version => version.title).filter(Boolean);
              const foundCopy = versions.length ? versions.join(' / ') : 'No local version confirmed';
              return `
                <div class="library-gap-results-modal-row">
                  <strong>${escapeHtml(requested.artist ? `${requested.title} — ${requested.artist}` : requested.title || requested.raw)}</strong>
                  <span class="status-${escapeHtml(item.status)}">${libraryGapStatusLabel(item.status)}</span>
                  <span>${escapeHtml(foundCopy)}</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
      modal.addEventListener('click', event => {
        if (event.target === modal) modal.remove();
      });
      document.body.appendChild(modal);
      modal.querySelector('button')?.focus();
    }

    function libraryGapBuilderRequestedLabel(item = {}) {
      const requested = item.requested || {};
      const title = requested.title || requested.raw || 'Unknown Song';
      return requested.artist ? `${title} — ${requested.artist}` : title;
    }

    function libraryGapBuilderNeedsDecision(item = {}) {
      return item.status === 'possible_match'
        || (item.status === 'in_library' && item.requested_version_confirmed === false);
    }

    function ensureLibraryGapBuilderSelections() {
      const rows = Array.isArray(libraryGapPayload?.results) ? libraryGapPayload.results : [];
      rows.forEach((item, index) => {
        if (libraryGapBuilderExcluded.has(index) || libraryGapBuilderSelections[index]) return;
        libraryGapBuilderSelections[index] = {
          versionIndex: 0,
          accepted: (item.status === 'in_library' || item.status === 'resolved_local') && !libraryGapBuilderNeedsDecision(item)
        };
      });
      return rows;
    }


    window.openLibraryGapSearch = function(index) {
      libraryGapSearchActiveIndex = index;
      libraryGapSearchResults = [];
      syncLibraryGapBuilderPreviewUi();
      setTimeout(() => document.getElementById('library-gap-search-input-' + index)?.focus(), 50);
    };

    window.runLibraryGapSearch = async function(index, query) {
      if (!query.trim()) {
        libraryGapSearchResults = [];
        syncLibraryGapBuilderPreviewUi();
        return;
      }
      try {
        const resp = await fetch(`/api/library/search?q=${encodeURIComponent(query)}&limit=10`);
        const data = await resp.json();
        libraryGapSearchResults = data.tracks || data.results || [];
        syncLibraryGapBuilderPreviewUi();
      } catch (e) {
        console.error('Search failed', e);
      }
    };

    window.selectLibraryGapSearchResult = function(index, trackIndex) {
      const track = libraryGapSearchResults[trackIndex];
      if (!track) return;
      const entries = libraryGapBuilderEntries();
      const row = entries.find(e => e.index === index)?.item;
      if (!row) return;
      row.status = 'match_found';
      row.versions = [track];
      libraryGapSearchActiveIndex = -1;
      libraryGapSearchResults = [];
      syncLibraryGapBuilderPreviewUi();
      refreshLibraryGapBuilderSummary();
    };

    window.closeLibraryGapSearch = function() {
      libraryGapSearchActiveIndex = -1;
      libraryGapSearchResults = [];
      syncLibraryGapBuilderPreviewUi();
    };

    function libraryGapBuilderEntries() {
      return ensureLibraryGapBuilderSelections()
        .map((item, index) => ({ item, index }))
        .filter(entry => !libraryGapBuilderExcluded.has(entry.index));
    }

    function libraryGapBuilderPendingCount() {
      return libraryGapBuilderEntries().filter(({ item, index }) => (
        libraryGapBuilderSelectionNeedsDecision(item, index) && !libraryGapBuilderSelections[index]?.accepted
      )).length;
    }

    function libraryGapBuilderCanUseSelectedVersions(pending = libraryGapBuilderPendingCount()) {
      return pending > LIBRARY_GAP_REQUIRED_CONFIRMATION_LIMIT;
    }

    function libraryGapBuilderSelectionNeedsDecision(item = {}, index = -1) {
      const selection = libraryGapBuilderSelections[index] || {};
      return libraryGapBuilderNeedsDecision(item) || Number(selection.versionIndex || 0) > 0;
    }

    function libraryGapBuilderVersionAt(rowIndex, versionIndex = null) {
      const item = libraryGapPayload?.results?.[rowIndex] || {};
      const versions = Array.isArray(item.versions) ? item.versions : [];
      const selectedIndex = versionIndex == null
        ? Number(libraryGapBuilderSelections[rowIndex]?.versionIndex || 0)
        : Number(versionIndex || 0);
      return versions[Math.max(0, Math.min(selectedIndex, Math.max(0, versions.length - 1)))] || null;
    }

    function libraryGapBuilderVersionMeta(version = {}) {
      const parts = [];
      const bpm = Number(version.bpm || 0);
      if (bpm) parts.push(`${bpm % 1 ? bpm.toFixed(1) : bpm.toFixed(0)} BPM`);
      if (version.camelot) parts.push(String(version.camelot));
      if (version.duration_sec) parts.push(formatTime(Number(version.duration_sec || 0)));
      if (version.genre) parts.push(String(version.genre));
      return parts.join(' · ') || 'Local audio version';
    }

    function setLibraryGapBuilderVersion(index, value) {
      ensureLibraryGapBuilderSelections();
      if (!libraryGapBuilderSelections[index]) return;
      const versionIndex = Math.max(0, Number.parseInt(value, 10) || 0);
      libraryGapBuilderSelections[index].versionIndex = versionIndex;
      const item = libraryGapPayload?.results?.[index] || {};
      libraryGapBuilderSelections[index].accepted = !libraryGapBuilderSelectionNeedsDecision(item, index);
      libraryGapBuilderOpenVersionsRow = -1;
      refreshLibraryGapBuilderRow(index);
      refreshLibraryGapBuilderSummary();
    }

    function libraryGapBuilderPreviewButtonMarkup(rowIndex, versionIndex, version = {}) {
      const path = String(version.path || '');
      const active = libraryGapBuilderPreview.path === path;
      const playing = active && libraryGapBuilderPreview.playing;
      const label = playing ? 'Pause preview' : `Preview ${version.title || 'this version'}`;
      return `
        <button type="button" class="library-gap-version-preview ${active ? 'is-active' : ''} ${playing ? 'is-playing' : ''}"
          data-library-gap-preview-path="${escapeHtml(path)}"
          aria-label="${escapeHtml(label)}"
          title="${escapeHtml(label)}"
          onclick="toggleLibraryGapBuilderVersionPreview(event, ${rowIndex}, ${versionIndex})">
          <img src="${playing ? '/static/icons/audio-waveform.svg' : '/static/icons/disc-3.svg'}" alt="" aria-hidden="true">
          <span>${playing ? 'Pause' : 'Preview'}</span>
        </button>
      `;
    }

    function libraryGapBuilderRowMarkup(item = {}, index = 0, displayIndex = index) {
      const selection = libraryGapBuilderSelections[index] || { versionIndex: 0, accepted: false };
      const versions = Array.isArray(item.versions) ? item.versions : [];
      const selectedIndex = Math.max(0, Math.min(Number(selection.versionIndex || 0), Math.max(0, versions.length - 1)));
      const selected = versions[selectedIndex] || {};
      const alternatives = versions
        .map((version, versionIndex) => ({ version, versionIndex }))
        .filter(entry => entry.versionIndex !== selectedIndex);
      const needsDecision = libraryGapBuilderSelectionNeedsDecision(item, index);
      const missing = item.status === 'not_found';
      const open = libraryGapBuilderOpenVersionsRow === index;
      return `
        <article class="library-gap-builder-row ${needsDecision ? 'needs-review' : ''} ${missing ? 'is-missing' : ''} ${!needsDecision && !missing && !alternatives.length ? 'is-compact' : ''}" data-library-gap-builder-row="${index}">
          <div class="library-gap-builder-row-number">${displayIndex + 1}</div>
          <div class="library-gap-builder-row-copy">
            <strong>${escapeHtml(libraryGapBuilderRequestedLabel(item))}</strong>
            ${missing ? (libraryGapSearchActiveIndex === index ? `
              <div class="library-gap-search-inline">
                <input type="text" id="library-gap-search-input-${index}" placeholder="Search library..." onkeydown="if(event.key==='Enter'){event.preventDefault();runLibraryGapSearch(${index}, this.value)}" style="width: 100%; padding: 4px 8px; margin-bottom: 8px; border-radius: 4px; border: 1px solid var(--border);">
                <div style="display: flex; gap: 8px; justify-content: flex-end;">
                  <button type="button" class="btn-secondary" onclick="closeLibraryGapSearch()" style="padding: 4px 12px; font-size: 12px;">Cancel</button>
                  <button type="button" class="btn-primary" onclick="runLibraryGapSearch(${index}, document.getElementById('library-gap-search-input-${index}').value)" style="padding: 4px 12px; font-size: 12px;">Search</button>
                </div>
                ${libraryGapSearchResults.length ? `
                  <ul class="library-gap-search-results" style="margin-top: 12px; list-style: none; padding: 0; display: flex; flex-direction: column; gap: 4px;">
                    ${libraryGapSearchResults.map((track, trackIndex) => `
                      <li>
                        <button type="button" onclick="selectLibraryGapSearchResult(${index}, ${trackIndex})" style="width: 100%; text-align: left; padding: 8px; border-radius: 4px; border: 1px solid var(--border); background: var(--surface); display: flex; flex-direction: column;">
                          <b style="font-size: 14px;">${escapeHtml(track.title)}</b>
                          <span style="font-size: 12px; opacity: 0.7;">${escapeHtml(track.artist)}</span>
                        </button>
                      </li>
                    `).join('')}
                  </ul>
                ` : ''}
              </div>
            ` : `
              <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <span class="library-gap-builder-missing-label">Missing · kept as a visible placeholder</span>
                <button type="button" class="btn-secondary" onclick="openLibraryGapSearch(${index})" style="padding: 4px 12px; font-size: 12px;">Search Library</button>
              </div>
            `) : `
              <span class="library-gap-version-label">Selected local version</span>
              <div class="library-gap-version-current ${open ? 'is-open' : ''}">
                ${libraryGapBuilderPreviewButtonMarkup(index, selectedIndex, selected)}
                <div class="library-gap-version-current-copy">
                  <b>${escapeHtml(selected.title || 'Unknown Title')}</b>
                  <span>${escapeHtml(selected.artist || 'Unknown Artist')}</span>
                  <small>${escapeHtml(libraryGapBuilderVersionMeta(selected))}</small>
                </div>
                <button type="button" class="library-gap-version-browse" aria-expanded="${open ? 'true' : 'false'}" aria-label="${alternatives.length ? `${open ? 'Hide' : 'Choose from'} ${alternatives.length} other edit${alternatives.length === 1 ? '' : 's'}` : 'Only edit available'}" ${alternatives.length ? '' : 'disabled'} onclick="toggleLibraryGapBuilderVersions(${index})">
                  ${alternatives.length ? (open ? 'Hide Other Edits' : 'Choose Different Edit') : 'Only Edit Available'}
                </button>
              </div>
              ${alternatives.length ? `
                <div class="library-gap-version-options ${open ? '' : 'hidden'}" aria-label="Other local edits for ${escapeHtml(libraryGapBuilderRequestedLabel(item))}">
                  ${alternatives.map(({ version, versionIndex }) => {
                    return `
                      <div class="library-gap-version-option">
                        ${libraryGapBuilderPreviewButtonMarkup(index, versionIndex, version)}
                        <button type="button" class="library-gap-version-option-copy" onclick="setLibraryGapBuilderVersion(${index}, ${versionIndex})">
                          <b>${escapeHtml(version.title || 'Unknown Title')}</b>
                          <span>${escapeHtml(version.artist || 'Unknown Artist')}</span>
                          <small>${escapeHtml(libraryGapBuilderVersionMeta(version))}</small>
                        </button>
                        <button type="button" class="library-gap-version-use" onclick="setLibraryGapBuilderVersion(${index}, ${versionIndex})">
                          Use Version
                        </button>
                      </div>
                    `;
                  }).join('')}
                </div>
              ` : ''}
              ${needsDecision ? `<button type="button" data-library-gap-confirm="${index}" class="library-gap-builder-decision ${selection.accepted ? 'is-confirmed' : ''}" aria-pressed="${selection.accepted ? 'true' : 'false'}" onclick="toggleLibraryGapBuilderMatch(${index})">${selection.accepted ? 'Match Confirmed' : 'Confirm This Match'}</button>` : `<span class="library-gap-builder-ready-label">Ready · strong local match</span>`}
            `}
          </div>
          ${needsDecision ? `
            <button type="button" class="library-gap-builder-remove" aria-label="Remove ${escapeHtml(libraryGapBuilderRequestedLabel(item))} from this set" title="Remove from this set" onclick="removeLibraryGapBuilderSong(${index})">&times;</button>
          ` : ''}
        </article>
      `;
    }

    function renderLibraryGapBuilderRows() {
      const list = document.querySelector('.library-gap-builder-list');
      if (!list) return;
      const entries = libraryGapBuilderEntries();
      list.innerHTML = entries.length
        ? entries.map(({ item, index }, displayIndex) => libraryGapBuilderRowMarkup(item, index, displayIndex)).join('')
        : '<div class="library-gap-builder-empty"><strong>No songs selected</strong><span>Return to the results to choose a different song list.</span></div>';
      syncLibraryGapBuilderPreviewUi();
    }

    function removeLibraryGapBuilderSong(index) {
      const item = libraryGapPayload?.results?.[index];
      if (!item || !libraryGapBuilderSelectionNeedsDecision(item, index)) return;
      if (libraryGapBuilderPreview.rowIndex === index) stopLibraryGapBuilderPreview();
      libraryGapBuilderExcluded.add(index);
      delete libraryGapBuilderSelections[index];
      if (libraryGapBuilderOpenVersionsRow === index) libraryGapBuilderOpenVersionsRow = -1;
      renderLibraryGapBuilderRows();
      refreshLibraryGapBuilderSummary();
      showToast(`${libraryGapBuilderRequestedLabel(item)} removed from this set.`);
    }

    function refreshLibraryGapBuilderRow(index) {
      const item = libraryGapPayload?.results?.[index];
      const row = document.querySelector(`[data-library-gap-builder-row="${index}"]`);
      if (!item || !row) return;
      const displayIndex = libraryGapBuilderEntries().findIndex(entry => entry.index === index);
      if (displayIndex < 0) return;
      row.outerHTML = libraryGapBuilderRowMarkup(item, index, displayIndex);
      syncLibraryGapBuilderPreviewUi();
    }

    function toggleLibraryGapBuilderVersions(index) {
      const previous = libraryGapBuilderOpenVersionsRow;
      libraryGapBuilderOpenVersionsRow = previous === index ? -1 : index;
      if (previous >= 0 && previous !== index) refreshLibraryGapBuilderRow(previous);
      refreshLibraryGapBuilderRow(index);
      if (libraryGapBuilderOpenVersionsRow === index) {
        window.setTimeout(() => document.querySelector(`[data-library-gap-builder-row="${index}"] .library-gap-version-options`)?.scrollIntoView({ block: 'nearest' }), 30);
      }
    }

    function clearLibraryGapBuilderPreviewTimer() {
      if (!libraryGapBuilderPreviewTimer) return;
      window.clearInterval(libraryGapBuilderPreviewTimer);
      libraryGapBuilderPreviewTimer = null;
    }

    function startLibraryGapBuilderFixturePreview() {
      clearLibraryGapBuilderPreviewTimer();
      libraryGapBuilderPreviewTimer = window.setInterval(() => {
        if (!libraryGapBuilderPreview.playing || !libraryGapBuilderPreview.fixture) return;
        libraryGapBuilderPreview.currentTime = Math.min(
          libraryGapBuilderPreview.duration,
          libraryGapBuilderPreview.currentTime + 0.5
        );
        if (libraryGapBuilderPreview.currentTime >= libraryGapBuilderPreview.duration) {
          libraryGapBuilderPreview.playing = false;
          clearLibraryGapBuilderPreviewTimer();
        }
        syncLibraryGapBuilderPreviewUi();
      }, 500);
    }

    function renderLibraryGapBuilderPreviewDeck() {
      const deck = document.getElementById('library-gap-builder-preview-deck');
      if (!deck) return;
      const active = Boolean(libraryGapBuilderPreview.path);
      if (!active) {
        deck.className = 'library-gap-builder-preview-deck is-empty';
        deck.innerHTML = `
          <img src="/static/icons/audio-waveform.svg" alt="" aria-hidden="true">
          <div><strong>Version Preview</strong><span>Play any local version above before you choose it.</span></div>
        `;
        return;
      }
      const duration = Math.max(0, Number(libraryGapBuilderPreview.duration || 0));
      const current = Math.max(0, Number(libraryGapBuilderPreview.currentTime || 0));
      const progress = duration ? Math.min(100, (current / duration) * 100) : 0;
      deck.className = `library-gap-builder-preview-deck ${libraryGapBuilderPreview.playing ? 'is-playing' : 'is-paused'}`;
      deck.innerHTML = `
        <button type="button" class="library-gap-preview-deck-toggle" aria-label="${libraryGapBuilderPreview.playing ? 'Pause version preview' : 'Resume version preview'}" onclick="toggleLibraryGapBuilderPreviewDeck()">
          <img src="${libraryGapBuilderPreview.playing ? '/static/icons/audio-waveform.svg' : '/static/icons/disc-3.svg'}" alt="" aria-hidden="true">
          <span>${libraryGapBuilderPreview.playing ? 'Pause' : 'Play'}</span>
        </button>
        <div class="library-gap-preview-deck-copy">
          <small>Now Previewing</small>
          <strong>${escapeHtml(libraryGapBuilderPreview.title || 'Local Version')}</strong>
          <span>${escapeHtml(libraryGapBuilderPreview.artist || 'Unknown Artist')}</span>
        </div>
        <img class="library-gap-preview-deck-wave" src="/static/icons/audio-waveform.svg" alt="" aria-hidden="true">
        <div class="library-gap-preview-deck-timeline">
          <span>${formatTime(current)}</span>
          <i><b style="width:${progress}%"></b></i>
          <span>${duration ? formatTime(duration) : '--:--'}</span>
        </div>
        <div class="library-gap-preview-deck-actions">
          <button type="button" onclick="stepLibraryGapBuilderPreview(-1)">Previous</button>
          <button type="button" onclick="stepLibraryGapBuilderPreview(1)">Next</button>
          <button type="button" aria-label="Skip preview forward 30 seconds" title="Skip forward 30 seconds" onclick="skipLibraryGapBuilderPreview(30)">+30 Sec</button>
          <button type="button" onclick="stopLibraryGapBuilderPreview()">Stop</button>
        </div>
      `;
    }

    function syncLibraryGapBuilderPreviewUi() {
      if (libraryGapBuilderPreview.path && !libraryGapBuilderPreview.fixture && nativePlayerState.path === libraryGapBuilderPreview.path) {
        libraryGapBuilderPreview.playing = Boolean(nativePlayerState.playing);
        libraryGapBuilderPreview.currentTime = Number(nativePlayerState.current_time || 0);
        libraryGapBuilderPreview.duration = Number(nativePlayerState.duration || libraryGapBuilderPreview.duration || 0);
      }
      document.querySelectorAll('[data-library-gap-preview-path]').forEach(button => {
        const active = button.dataset.libraryGapPreviewPath === libraryGapBuilderPreview.path;
        const playing = active && libraryGapBuilderPreview.playing;
        button.classList.toggle('is-active', active);
        button.classList.toggle('is-playing', playing);
        const image = button.querySelector('img');
        const label = button.querySelector('span');
        if (image) image.src = playing ? '/static/icons/audio-waveform.svg' : '/static/icons/disc-3.svg';
        if (label) label.textContent = playing ? 'Pause' : 'Preview';
        button.setAttribute('aria-label', playing ? 'Pause preview' : 'Preview this version');
      });
      renderLibraryGapBuilderPreviewDeck();
    }

    async function toggleLibraryGapBuilderVersionPreview(event, rowIndex, versionIndex) {
      event?.stopPropagation();
      const version = libraryGapBuilderVersionAt(rowIndex, versionIndex);
      if (!version?.path) {
        showToast('That local version is not available to preview.', true);
        return;
      }
      if (libraryGapBuilderPreview.path === version.path) {
        await toggleLibraryGapBuilderPreviewDeck();
        return;
      }
      clearLibraryGapBuilderPreviewTimer();
      libraryGapBuilderPreview = {
        rowIndex,
        versionIndex,
        path: version.path,
        title: version.title || 'Local Version',
        artist: version.artist || 'Unknown Artist',
        duration: Number(version.duration_sec || 180),
        currentTime: 0,
        playing: true,
        fixture: String(version.path).startsWith('preview://'),
      };
      syncLibraryGapBuilderPreviewUi();
      if (libraryGapBuilderPreview.fixture) {
        startLibraryGapBuilderFixturePreview();
        showToast(`Previewing ${libraryGapBuilderPreview.title}.`);
        return;
      }
      await playAudioFile(version.path, version.title, version.artist, version.bpm, version.camelot, version.energy, event, version.genre);
      syncLibraryGapBuilderPreviewUi();
    }

    async function toggleLibraryGapBuilderPreviewDeck() {
      if (!libraryGapBuilderPreview.path) return;
      if (libraryGapBuilderPreview.fixture) {
        if (!libraryGapBuilderPreview.playing && libraryGapBuilderPreview.currentTime >= libraryGapBuilderPreview.duration) {
          libraryGapBuilderPreview.currentTime = 0;
        }
        libraryGapBuilderPreview.playing = !libraryGapBuilderPreview.playing;
        if (libraryGapBuilderPreview.playing) startLibraryGapBuilderFixturePreview();
        else clearLibraryGapBuilderPreviewTimer();
        syncLibraryGapBuilderPreviewUi();
        return;
      }
      try {
        const endpoint = libraryGapBuilderPreview.playing ? '/api/audio/pause' : '/api/audio/resume';
        await nativeAudioRequest(endpoint);
      } catch (error) {
        showToast(error?.message || 'Preview control failed.', true);
      }
      syncLibraryGapBuilderPreviewUi();
    }

    async function stopLibraryGapBuilderPreview(reset = true) {
      const previous = { ...libraryGapBuilderPreview };
      clearLibraryGapBuilderPreviewTimer();
      libraryGapBuilderPreview.playing = false;
      if (!previous.fixture && previous.path && nativePlayerState.path === previous.path) {
        nativeAudioRequest('/api/audio/stop').catch(() => {});
      }
      if (reset) {
        libraryGapBuilderPreview = { rowIndex: -1, versionIndex: -1, path: '', title: '', artist: '', duration: 0, currentTime: 0, playing: false, fixture: false };
      }
      syncLibraryGapBuilderPreviewUi();
    }

    function stepLibraryGapBuilderPreview(direction = 1) {
      const rowIndex = Number(libraryGapBuilderPreview.rowIndex);
      const item = libraryGapPayload?.results?.[rowIndex] || {};
      const versions = Array.isArray(item.versions) ? item.versions : [];
      if (!versions.length) return;
      const current = Math.max(0, Number(libraryGapBuilderPreview.versionIndex || 0));
      const next = (current + (direction < 0 ? -1 : 1) + versions.length) % versions.length;
      toggleLibraryGapBuilderVersionPreview(null, rowIndex, next);
    }

    async function skipLibraryGapBuilderPreview(seconds = 30) {
      if (!libraryGapBuilderPreview.path) return;
      const delta = Math.max(0, Number(seconds || 0));
      if (!delta) return;
      if (libraryGapBuilderPreview.fixture) {
        libraryGapBuilderPreview.currentTime = Math.min(
          libraryGapBuilderPreview.duration,
          libraryGapBuilderPreview.currentTime + delta
        );
        if (libraryGapBuilderPreview.currentTime >= libraryGapBuilderPreview.duration) {
          libraryGapBuilderPreview.playing = false;
          clearLibraryGapBuilderPreviewTimer();
        }
        syncLibraryGapBuilderPreviewUi();
        return;
      }
      try {
        await nativeAudioRequest('/api/audio/seek_relative', { delta });
      } catch (error) {
        showToast(error?.message || 'Preview skip failed.', true);
      }
      syncLibraryGapBuilderPreviewUi();
    }

    function toggleLibraryGapBuilderMatch(index) {
      ensureLibraryGapBuilderSelections();
      const selection = libraryGapBuilderSelections[index];
      if (!selection) return;
      selection.accepted = !selection.accepted;
      const button = document.querySelector(`[data-library-gap-confirm="${index}"]`);
      if (button) {
        button.classList.toggle('is-confirmed', selection.accepted);
        button.setAttribute('aria-pressed', selection.accepted ? 'true' : 'false');
        button.textContent = selection.accepted ? 'Match Confirmed' : 'Confirm This Match';
      }
      refreshLibraryGapBuilderSummary();
    }

    function libraryGapBuilderDestinationChanged() {
      const destination = document.querySelector('input[name="library-gap-destination"]:checked')?.value || 'existing';
      document.getElementById('library-gap-new-set-fields')?.classList.toggle('hidden', destination !== 'new');
      document.getElementById('library-gap-existing-set-fields')?.classList.toggle('hidden', destination !== 'existing');
      refreshLibraryGapBuilderSummary();
    }

    function refreshLibraryGapBuilderSummary() {
      const entries = libraryGapBuilderEntries();
      const rows = entries.map(entry => entry.item);
      const pending = libraryGapBuilderPendingCount();
      const canUseSelectedVersions = libraryGapBuilderCanUseSelectedVersions(pending);
      const missing = rows.filter(item => item.status === 'not_found').length;
      const available = rows.length - missing;
      const removed = libraryGapBuilderExcluded.size;
      const summary = document.getElementById('library-gap-builder-summary');
      const primary = document.getElementById('library-gap-builder-primary');
      const destination = document.querySelector('input[name="library-gap-destination"]:checked')?.value || 'existing';
      const existingId = document.getElementById('library-gap-existing-select')?.value || '';
      if (summary) {
        const trackLabel = missing
          ? `${available} TRACK${available === 1 ? '' : 'S'} FOUND · ${missing} MISSING`
          : `${rows.length} TRACK${rows.length === 1 ? '' : 'S'} FOUND`;
        const nextStep = canUseSelectedVersions || pending === 0
          ? 'Ready to send to Studio.'
          : `Confirm ${pending} match${pending === 1 ? '' : 'es'} to continue.`;
        summary.innerHTML = `
          <strong>${trackLabel}</strong>
          <span>${rows.length ? nextStep : 'No songs remain in this set.'}${removed ? ` ${removed} removed.` : ''}</span>
        `;
        summary.classList.toggle('is-ready', pending === 0 || canUseSelectedVersions);
      }
      if (primary) {
        primary.disabled = !rows.length || (pending > 0 && !canUseSelectedVersions);
        primary.textContent = !rows.length
          ? 'No Songs Selected'
          : pending > 0 && !canUseSelectedVersions
          ? `Confirm ${pending} Match${pending === 1 ? '' : 'es'} First`
          : destination === 'existing'
            ? existingId ? 'Add To Set And Open Studio' : 'Add To Studio'
            : 'Take Set To Studio';
      }
    }

    function closeLibraryGapBuilder() {
      const modal = document.getElementById('library-gap-builder');
      if (!modal) return;
      stopLibraryGapBuilderPreview();
      libraryGapBuilderOpenVersionsRow = -1;
      modal.remove();
      libraryGapBuilderLastFocus?.focus?.();
    }

    function openLibraryGapBuilder() {
      const entries = libraryGapBuilderEntries();
      if (!entries.length && !libraryGapBuilderExcluded.size) return;
      loadSavedPlaylists();
      libraryGapBuilderLastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      document.getElementById('library-gap-builder')?.remove();
      const existingOptions = savedPlaylists.filter(set => !['to-buy','download-later'].includes(set.kind)).map(set => (
        `<option value="${escapeHtml(set.id)}">${escapeHtml(set.name)} · ${set.tracks.length} tracks</option>`
      )).join('');
      const modal = document.createElement('div');
      modal.id = 'library-gap-builder';
      modal.className = 'library-gap-builder';
      modal.innerHTML = `
        <div class="library-gap-builder-shell" role="dialog" aria-modal="true" aria-labelledby="library-gap-builder-title" aria-describedby="library-gap-builder-copy">
          <header class="library-gap-builder-head">
            <div>
              <span>Library Gap Checker · Next Step</span>
              <h2 id="library-gap-builder-title">Build A Set From This List</h2>
              <p id="library-gap-builder-copy">Confirm uncertain versions, choose where the songs should go, then open the complete request in Studio.</p>
            </div>
            <button type="button" class="library-gap-close" onclick="closeLibraryGapBuilder()">Back To Results</button>
          </header>
          <div class="library-gap-builder-grid">
            <section class="library-gap-builder-review" aria-labelledby="library-gap-builder-review-title">
              <div class="library-gap-section-heading">
                <strong id="library-gap-builder-review-title">1. Confirm Song Versions</strong>
                <span>Strong matches are ready. Amber matches need your approval before AXIOM uses them.</span>
              </div>
              <div class="library-gap-builder-list">
                ${entries.length ? entries.map(({ item, index }, displayIndex) => libraryGapBuilderRowMarkup(item, index, displayIndex)).join('') : '<div class="library-gap-builder-empty"><strong>No songs selected</strong><span>Return to the results to choose a different song list.</span></div>'}
              </div>
              <div id="library-gap-builder-preview-deck" class="library-gap-builder-preview-deck is-empty" aria-live="polite"></div>
            </section>
            <aside class="library-gap-builder-options" aria-labelledby="library-gap-builder-options-title">
              <div class="library-gap-section-heading">
                <strong id="library-gap-builder-options-title">2. Choose The Outcome</strong>
                <span>Client order stays intact unless you ask AXIOM to suggest a DJ flow.</span>
              </div>
              <fieldset class="library-gap-builder-fieldset">
                <legend>Destination</legend>
                <label class="library-gap-builder-choice is-primary">
                  <input type="radio" name="library-gap-destination" value="new" onchange="libraryGapBuilderDestinationChanged()">
                  <span><strong>Create New Set</strong><small>Save it in Playlists and open it in Studio.</small></span>
                </label>
                <div id="library-gap-new-set-fields" class="library-gap-builder-fields hidden">
                  <label for="library-gap-set-name">Set name</label>
                  <input id="library-gap-set-name" type="text" value="Song List Set" maxlength="80">
                </div>
                <label class="library-gap-builder-choice">
                  <input type="radio" name="library-gap-destination" value="existing" checked onchange="libraryGapBuilderDestinationChanged()">
                  <span><strong>Add To Studio</strong><small>Keep your current songs and add only new ones. You can also choose a saved set.</small></span>
                </label>
                <div id="library-gap-existing-set-fields" class="library-gap-builder-fields">
                  <label for="library-gap-existing-select">Choose a saved set (optional)</label>
                  <select id="library-gap-existing-select" onchange="refreshLibraryGapBuilderSummary()">
                    <option value="">Current Studio Working List</option>
                    ${existingOptions}
                  </select>
                </div>
              </fieldset>
              <fieldset class="library-gap-builder-fieldset">
                <legend>Song Order</legend>
                <label class="library-gap-builder-choice">
                  <input type="radio" name="library-gap-order" value="client" checked>
                  <span><strong>Keep Pasted Order</strong><small>Best for client requests and planned moments.</small></span>
                </label>
                <label class="library-gap-builder-choice">
                  <input type="radio" name="library-gap-order" value="flow">
                  <span><strong>Arrange For DJ Flow</strong><small>Suggest a BPM and harmonic route. Missing songs stay visible at the end.</small></span>
                </label>
              </fieldset>
              <div id="library-gap-builder-summary" class="library-gap-builder-summary" aria-live="polite"></div>
              <button id="library-gap-builder-primary" type="button" class="library-gap-builder-primary" onclick="completeLibraryGapBuilder()">Take Set To Studio</button>
              <p class="library-gap-trust">Only AXIOM's set and Library cache are used. Source audio remains untouched.</p>
            </aside>
          </div>
        </div>
      `;
      modal.addEventListener('click', event => {
        if (event.target === modal) closeLibraryGapBuilder();
      });
      modal.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeLibraryGapBuilder();
      });
      document.body.appendChild(modal);
      refreshLibraryGapBuilderSummary();
      syncLibraryGapBuilderPreviewUi();
      window.setTimeout(() => modal.querySelector('select, input, button')?.focus(), 40);
    }

    function continueLibraryGapWithoutMissingTracks() {
      const rows = Array.isArray(libraryGapPayload?.results) ? libraryGapPayload.results : [];
      if (!rows.length) return;
      const missing = rows.filter(item => item.status === 'not_found');
      if (!missing.length) {
        window.closeLibraryGapRecovery?.();
        openLibraryGapBuilder();
        return;
      }

      const saveResult = saveLibraryGapDownloadList();
      const available = rows.filter(item => item.status !== 'not_found');
      if (!available.length) {
        window.closeLibraryGapRecovery?.();
        if (saveResult) {
          openLibraryGapDownloadList();
          showToast('No available tracks were added to Set Builder. Your missing songs are saved in Download Later.');
        } else {
          showToast('No available tracks can be added to Set Builder.', true);
        }
        return;
      }

      libraryGapPayload = {
        ...libraryGapPayload,
        results: available,
        counts: {
          ...(libraryGapPayload.counts || {}),
          in_library: available.filter(item => item.status === 'in_library' || item.status === 'resolved_local').length,
          possible_match: available.filter(item => item.status === 'possible_match').length,
          not_found: 0
        }
      };
      libraryGapBuilderSelections = {};
      libraryGapBuilderExcluded = new Set();
      window.closeLibraryGapRecovery?.();
      openLibraryGapBuilder();
      const savedCopy = saveResult
        ? ' Missing songs were saved in Playlists > Download Later.'
        : ' Missing songs were skipped.';
      showToast(`Continuing with ${available.length} available track${available.length === 1 ? '' : 's'}.${savedCopy}`);
    }

    function libraryGapBuilderTracks() {
      const entries = libraryGapBuilderEntries();
      return entries.map(({ item, index }, displayIndex) => {
        const requested = item.requested || {};
        if (item.status === 'not_found') {
          const missingKey = `${requested.artist || 'artist'}-${requested.title || requested.raw || `song-${index + 1}`}`
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || `song-${index + 1}`;
          return {
            path: `missing://library-gap/${missingKey}`,
            title: requested.title || requested.raw || 'Missing Song',
            artist: requested.artist || 'Requested Track',
            filename: '', bpm: 0, camelot: '', year: 0, genre: 'Missing Request', energy: '',
            _unlinked: true,
            missing_placeholder: true,
            requested_order: displayIndex + 1
          };
        }
        const versions = Array.isArray(item.versions) ? item.versions : [];
        const selection = libraryGapBuilderSelections[index] || { versionIndex: 0 };
        const selectedVersionIndex = Math.min(selection.versionIndex, Math.max(0, versions.length - 1));
        const version = versions[selectedVersionIndex] || {};
        return {
          ...version,
          path: version.path || `missing://library-gap-match-${index + 1}`,
          title: version.title || requested.title || 'Unknown Song',
          artist: version.artist || requested.artist || 'Unknown Artist',
          _unlinked: !version.path,
          missing_placeholder: !version.path,
          requested_order: displayIndex + 1,
          requested_title: requested.title || '',
          requested_artist: requested.artist || '',
          available_versions: versions.map(candidate => ({ ...candidate })),
          selected_version_index: selectedVersionIndex,
          version_count: versions.length
        };
      });
    }

    async function libraryGapArrangeForFlow(tracks = []) {
      const available = tracks.filter(track => !track.missing_placeholder);
      const missing = tracks.filter(track => track.missing_placeholder);
      if (available.length < 2) return available.concat(missing);
      const response = await fetch('/api/studio/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlist: available })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(payload.optimized)) throw new Error(payload.error || 'AXIOM could not suggest a DJ flow.');
      return dedupePlaylistTracks(payload.optimized).concat(missing);
    }

    async function openLibraryGapSetInStudio(tracks = [], playlistId = null, message = '') {
      editingPlaylistId = playlistId;
      selectedPlaylistId = playlistId;
      currentPlaylist = JSON.parse(JSON.stringify(tracks));
      currentRoutePlaylist = [];
      activeStudioView = 'manual';
      magicSetStudioCtaReady = false;
      resetModalSuggestionDecisions();
      if (typeof setGraphMode === 'function') setGraphMode(false);
      document.getElementById('set-brief-view')?.classList.add('hidden');
      document.getElementById('studio-start-view')?.classList.add('hidden');
      document.getElementById('studio-active-view')?.classList.remove('hidden');
      closeLibraryGapBuilder();
      closeLibraryGapWorkspace();
      showTab('studio');
      setStudioView('manual');
      applySetBriefToStudioControls();
      updateStudioToolsAvailability();
      initSortable();
      try { await recalculateAudit(); } catch (_) { renderPlaylist(); }
      showToast(message || `${tracks.length} requested songs opened in Studio.`);
    }

    async function completeLibraryGapBuilder() {
      const pending = libraryGapBuilderPendingCount();
      const canUseSelectedVersions = libraryGapBuilderCanUseSelectedVersions(pending);
      if (pending && !canUseSelectedVersions) {
        showToast(`Confirm ${pending} suggested match${pending === 1 ? '' : 'es'} first.`, true);
        return;
      }
      const selectedVersionsNotice = canUseSelectedVersions
        ? ` AXIOM used the selected local versions for ${pending} unconfirmed matches.`
        : '';
      const button = document.getElementById('library-gap-builder-primary');
      const destination = document.querySelector('input[name="library-gap-destination"]:checked')?.value || 'existing';
      const order = document.querySelector('input[name="library-gap-order"]:checked')?.value || 'client';
      const originalTracks = libraryGapBuilderTracks();
      try {
        if (button) {
          button.disabled = true;
          button.textContent = order === 'flow' ? 'Arranging DJ Flow...' : 'Building Set...';
        }
        // Studio is the set-building workspace, so matched and missing-request
        // rows must arrive immediately. Full-file decode checks belong at the
        // later DAW/mixtape boundary and must not cancel this Studio handoff.
        const tracks = order === 'flow' ? await libraryGapArrangeForFlow(originalTracks) : originalTracks;
        if (destination === 'existing') {
          loadSavedPlaylists();
          const id = document.getElementById('library-gap-existing-select')?.value || '';
          if (!id) {
            const studioTrackCount = Array.isArray(currentPlaylist) ? currentPlaylist.length : 0;
            const combined = dedupePlaylistTracks([...(Array.isArray(currentPlaylist) ? currentPlaylist : []), ...tracks]);
            const addedCount = combined.length - studioTrackCount;
            await openLibraryGapSetInStudio(
              combined,
              null,
              studioTrackCount
                ? `${addedCount} new song${addedCount === 1 ? '' : 's'} added after ${studioTrackCount} existing Studio track${studioTrackCount === 1 ? '' : 's'}.${selectedVersionsNotice}`
                : `${tracks.length} song${tracks.length === 1 ? '' : 's'} opened in Studio. Saved sets unchanged.${selectedVersionsNotice}`
            );
            return;
          }
          const set = savedPlaylists.find(item => item.id === id);
          if (!set) throw new Error('Choose the saved set you want to update.');
          const existingTrackCount = Array.isArray(set.tracks) ? set.tracks.length : 0;
          const combined = prepareTracksForPlaylistSave([...(set.tracks || []), ...tracks]);
          const addedCount = Math.max(0, combined.length - existingTrackCount);
          set.tracks = combined;
          set.updatedAt = new Date().toISOString();
          persistSavedPlaylists();
          refreshPlaylistsView();
          await openLibraryGapSetInStudio(
            combined,
            set.id,
            addedCount
              ? `${addedCount} new requested song${addedCount === 1 ? '' : 's'} added to ${set.name}.${selectedVersionsNotice}`
              : `${set.name} already contained every selected song from this list.${selectedVersionsNotice}`
          );
          return;
        }
        const name = String(document.getElementById('library-gap-set-name')?.value || '').trim() || `Song List Set ${savedPlaylists.length + 1}`;
        editingPlaylistId = null;
        currentSetBrief = normalizeSetBrief(DEFAULT_SET_BRIEF);
        const record = upsertSavedPlaylist(name, tracks);
        if (!record) throw new Error('AXIOM could not create that set.');
        await openLibraryGapSetInStudio(record.tracks, record.id, `${record.name} created with ${record.tracks.length} requested songs.${selectedVersionsNotice}`);
      } catch (error) {
        showToast(error?.message || 'AXIOM could not build that set.', true);
        refreshLibraryGapBuilderSummary();
      }
    }

    function libraryGapReviewPayload() {
      return {
        counts: { in_library: 3, possible_match: 2, not_found: 2 },
        results: [
          { requested: { title: 'Red Red Wine', artist: 'UB40' }, status: 'in_library', version_count: 3, requested_version_confirmed: true, versions: [
            { path: 'preview://gap-red-red-wine-clean', title: 'Red Red Wine (Clean Intro)', artist: 'UB40', bpm: 89, camelot: '8A', year: 1983, genre: 'Reggae' },
            { path: 'preview://gap-red-red-wine-extended', title: 'Red Red Wine (Extended Edit)', artist: 'UB40', bpm: 89, camelot: '8A', year: 1983, genre: 'Reggae' },
            { path: 'preview://gap-red-red-wine-radio', title: 'Red Red Wine (Radio)', artist: 'UB40', bpm: 89, camelot: '8A', year: 1983, genre: 'Reggae' }
          ] },
          { requested: { title: 'September', artist: 'Earth, Wind & Fire' }, status: 'in_library', version_count: 2, requested_version_confirmed: true, versions: [
            { path: 'preview://gap-september-extended', title: 'September (Extended Edit)', artist: 'Earth, Wind & Fire', bpm: 126, camelot: '9A', year: 1978, genre: 'Disco' },
            { path: 'preview://gap-september-radio', title: 'September (Radio)', artist: 'Earth, Wind & Fire', bpm: 126, camelot: '9A', year: 1978, genre: 'Disco' }
          ] },
          { requested: { title: 'Lose Yourself (Clean Intro)', artist: 'Eminem' }, status: 'in_library', version_count: 1, requested_version_confirmed: false, versions: [{ path: 'preview://gap-lose-yourself-dirty', title: 'Lose Yourself (Dirty)', artist: 'Eminem', bpm: 86, camelot: '2A', year: 2002, genre: 'Hip Hop' }] },
          { requested: { title: 'Around The World', artist: 'Daft Punk' }, status: 'possible_match', version_count: 1, requested_version_confirmed: true, versions: [{ path: 'preview://gap-around-the-world-edit', title: 'Around The World (DJ Edit)', artist: 'Daft Punk', bpm: 121, camelot: '7A', year: 1997, genre: 'Electronic' }] },
          { requested: { title: 'Crazy In Love', artist: 'Beyonce' }, status: 'possible_match', version_count: 1, requested_version_confirmed: true, versions: [{ path: 'preview://gap-crazy-love-intro', title: 'Crazy Love (Intro)', artist: 'Beyonce', bpm: 100, camelot: '6A', year: 2003, genre: 'R&B' }] },
          { requested: { title: 'Levitating', artist: 'Dua Lipa' }, status: 'not_found', version_count: 0, requested_version_confirmed: false, versions: [] },
          { requested: { title: 'Good As Hell', artist: 'Lizzo' }, status: 'not_found', version_count: 0, requested_version_confirmed: false, versions: [] }
        ]
      };
    }

    function libraryGapSetBuilderPreviewPayload() {
      const exact = (title, artist, bpm, camelot, duration, genre = 'Open Format') => ({
        requested: { title, artist },
        status: 'in_library',
        version_count: 1,
        requested_version_confirmed: true,
        versions: [{
          path: `preview://set-builder-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          title,
          artist,
          bpm,
          camelot,
          duration_sec: duration,
          genre,
        }],
      });
      const results = [
        {
          requested: { title: 'Not Like Us (2024)', artist: 'Kendrick Lamar' },
          status: 'possible_match',
          version_count: 8,
          requested_version_confirmed: false,
          versions: [
            { path: 'preview://set-builder-not-like-us-intro', title: 'Not Like Us (Intro) With Hype', artist: '(DJ Owe) Kendrick Lamar', bpm: 101, camelot: '4A', duration_sec: 224, genre: 'Hip Hop' },
            { path: 'preview://set-builder-not-like-us-break-in', title: 'Not Like Us (DJ Carlo Kou Break In) (Dirty QH)', artist: 'Kendrick Lamar', bpm: 101, camelot: '4A', duration_sec: 198, genre: 'Hip Hop' },
            { path: 'preview://set-builder-not-like-us-clap', title: 'Not Like Us (Clap Intro) (Dirty) (VIP Edit)', artist: 'Kendrick Lamar', bpm: 101, camelot: '4A', duration_sec: 212, genre: 'Hip Hop' },
            { path: 'preview://set-builder-not-like-us-west', title: 'Not Like Us (West Coast Mega Blend) (Dirty)', artist: 'Kendrick Lamar', bpm: 101, camelot: '4A', duration_sec: 248, genre: 'Hip Hop' },
            { path: 'preview://set-builder-not-like-us-clean', title: 'Not Like Us (Clean Intro)', artist: 'Kendrick Lamar', bpm: 101, camelot: '4A', duration_sec: 208, genre: 'Hip Hop' },
            { path: 'preview://set-builder-not-like-us-short', title: 'Not Like Us (Short Edit) (Dirty)', artist: 'Kendrick Lamar', bpm: 101, camelot: '4A', duration_sec: 156, genre: 'Hip Hop' },
            { path: 'preview://set-builder-not-like-us-acap', title: 'Not Like Us (West Coast Acap Intro)', artist: 'Kendrick Lamar', bpm: 101, camelot: '4A', duration_sec: 232, genre: 'Hip Hop' },
            { path: 'preview://set-builder-not-like-us-mashup', title: 'Not Like Us X Paramedic (Mashup)', artist: 'Kendrick Lamar', bpm: 101, camelot: '4A', duration_sec: 205, genre: 'Mashup / Edits' },
          ],
        },
        {
          requested: { title: 'TV Off', artist: 'Kendrick Lamar' },
          status: 'in_library',
          version_count: 3,
          requested_version_confirmed: true,
          versions: [
            { path: 'preview://set-builder-tv-off-slam', title: 'TV Off (Slam Edit) (Dirty Extended)', artist: '(DJ Juan Cuba) Kendrick Lamar', bpm: 101, camelot: '4A', duration_sec: 216, genre: 'Hip Hop' },
            { path: 'preview://set-builder-tv-off-clean', title: 'TV Off (Clean Intro)', artist: 'Kendrick Lamar', bpm: 101, camelot: '4A', duration_sec: 194, genre: 'Hip Hop' },
            { path: 'preview://set-builder-tv-off-radio', title: 'TV Off (Radio Edit)', artist: 'Kendrick Lamar', bpm: 101, camelot: '4A', duration_sec: 182, genre: 'Hip Hop' },
          ],
        },
        {
          requested: { title: 'Million Dollar Baby (2024)', artist: 'Tommy Richman' },
          status: 'in_library',
          version_count: 2,
          requested_version_confirmed: true,
          versions: [
            { path: 'preview://set-builder-million-dollar-intro', title: 'Million Dollar Baby (Clean Intro)', artist: 'Tommy Richman', bpm: 138, camelot: '6A', duration_sec: 167, genre: 'R&B' },
            { path: 'preview://set-builder-million-dollar-extended', title: 'Million Dollar Baby (Extended)', artist: 'Tommy Richman', bpm: 138, camelot: '6A', duration_sec: 203, genre: 'R&B' },
          ],
        },
        exact('A Bar Song (Tipsy)', 'Shaboozey', 81, '6B', 171, 'Country'),
        exact('Espresso', 'Sabrina Carpenter', 104, '7B', 175, 'Pop'),
        exact('Birds Of A Feather', 'Billie Eilish', 105, '2B', 210, 'Pop'),
        exact('Good Luck, Babe!', 'Chappell Roan', 117, '6B', 218, 'Pop'),
        exact('Lose Control', 'Teddy Swims', 80, '3B', 210, 'Pop'),
        exact('Beautiful Things', 'Benson Boone', 105, '10B', 180, 'Pop'),
        exact('Too Sweet', 'Hozier', 117, '5A', 251, 'Pop'),
        exact('Texas Hold Em', 'Beyonce', 110, '8B', 233, 'Country'),
        exact('Houdini', 'Dua Lipa', 117, '7A', 185, 'Pop'),
        exact('Pink Pony Club', 'Chappell Roan', 107, '8B', 258, 'Pop'),
        exact('Stick Season', 'Noah Kahan', 118, '9B', 182, 'Pop'),
      ];
      return { counts: { in_library: 13, possible_match: 1, not_found: 0 }, results };
    }

    function libraryGapSetBuilderManyPendingPreviewPayload() {
      const payload = libraryGapSetBuilderPreviewPayload();
      payload.results.slice(0, 6).forEach(item => {
        item.status = 'possible_match';
        item.requested_version_confirmed = false;
      });
      payload.counts = { in_library: payload.results.length - 6, possible_match: 6, not_found: 0 };
      return payload;
    }

    const libraryGapPreparationReviewOverrides = new Map();

    function libraryGapReviewTracks() {
      const missionReview = new URLSearchParams(window.location.search).get('entrance_library') === 'ready'
        && ['studio-start', 'quick-start'].includes(axiomReviewMode());
      const tracks = missionReview ? [
        { path: 'preview://mission-wedding-1', title: 'September (Clean Wedding Classic)', artist: 'Earth Wind & Fire', bpm: 126, camelot: '11B', year: 1978, genre: 'Disco Wedding Crowd Pleaser', energy: 'Peak', play_count: 22, crate_names: ['Wedding Reception', 'All Ages', 'Clean Classics'], axiom_first_seen_at: '2026-09-20T08:54:00Z' },
        { path: 'preview://mission-wedding-2', title: 'Can\'t Help Falling In Love (First Dance Edit)', artist: 'Elvis Presley', bpm: 100, camelot: '6B', year: 1961, genre: 'First Dance Love Classic', energy: 'Low', play_count: 14, crate_names: ['Wedding Dinner', 'First Dance', 'Reception Safe'], axiom_first_seen_at: '2026-09-20T08:50:00Z' },
        { path: 'preview://mission-wedding-3', title: 'Uptown Funk (Radio Edit)', artist: 'Mark Ronson ft Bruno Mars', bpm: 115, camelot: '4A', year: 2014, genre: 'Clean Pop Funk', energy: 'Peak', play_count: 19, crate_names: ['Wedding Dancefloor', 'Top 40 Clean', 'Crowd Pleasers'], axiom_first_seen_at: '2026-09-20T08:47:00Z' },
        { path: 'preview://mission-family-1', title: 'Happy (Family Friendly Radio Edit)', artist: 'Pharrell Williams', bpm: 80, camelot: '8B', year: 2013, genre: 'Family Friendly Pop', energy: 'Mid', play_count: 17, crate_names: ['School Events', 'Corporate Clean', 'All Ages'], axiom_first_seen_at: '2026-09-20T08:43:00Z' },
        { path: 'preview://mission-family-2', title: 'I Wanna Dance With Somebody (Clean Classic)', artist: 'Whitney Houston', bpm: 119, camelot: '7B', year: 1987, genre: 'Clean Singalong Pop', energy: 'Peak', play_count: 24, crate_names: ['Family Friendly', 'Wedding Reception', 'Classic Singalong'], axiom_first_seen_at: '2026-09-20T08:39:00Z' },
        { path: 'preview://mission-open-1', title: 'Yeah! (Clean Intro)', artist: 'Usher ft Lil Jon & Ludacris', bpm: 105, camelot: '2A', year: 2004, genre: 'Clean Hip Hop Top 40', energy: 'Peak', play_count: 18, crate_names: ['Open Format', 'Urban Clean', 'Top 40 Anchors'], axiom_first_seen_at: '2026-09-20T08:35:00Z' },
        { path: 'preview://mission-open-2', title: 'One More Time (Club Mix)', artist: 'Daft Punk', bpm: 123, camelot: '7A', year: 2000, genre: 'House Electronic Dance', energy: 'Peak', play_count: 12, crate_names: ['Open Format', 'Electronic Lift', 'Dancefloor'], axiom_first_seen_at: '2026-09-20T08:30:00Z' },
        { path: 'preview://mission-open-3', title: 'No Diggity (Radio Edit Transition)', artist: 'Blackstreet', bpm: 92, camelot: '8A', year: 1996, genre: 'R&B Hip Hop Transition', energy: 'Mid', play_count: 11, crate_names: ['Open Format', 'Bridge Tools', 'Urban Clean'], axiom_first_seen_at: '2026-09-20T08:26:00Z' },
        { path: 'preview://mission-global-1', title: 'Danza Kuduro (Clean Global Anthem)', artist: 'Don Omar ft Lucenzo', bpm: 130, camelot: '9A', year: 2010, genre: 'Latin Global Dance', energy: 'Peak', play_count: 16, crate_names: ['Global', 'Wedding Reception', 'Latin Clean'], axiom_first_seen_at: '2026-09-20T08:20:00Z' },
        { path: 'preview://mission-global-2', title: 'Calm Down (Afrobeats Radio Edit)', artist: 'Rema', bpm: 107, camelot: '10A', year: 2022, genre: 'Afrobeats Global Crossover', energy: 'Mid', play_count: 13, crate_names: ['Global', 'Afrobeats', 'Clean Radio'], axiom_first_seen_at: '2026-09-20T08:16:00Z' },
        { path: 'preview://mission-global-3', title: 'Temperature (Clean Dancehall Classic)', artist: 'Sean Paul', bpm: 125, camelot: '4A', year: 2005, genre: 'Dancehall Global Party', energy: 'Peak', play_count: 15, crate_names: ['Global', 'Dancehall', 'Open Format'], axiom_first_seen_at: '2026-09-20T08:12:00Z' }
      ] : [
        { path: 'preview://library-gap-1', title: 'Dum, Dumb, And Dumber (Dirty)', artist: 'Lil Baby ft Future & Young Thug', bpm: 65, camelot: '2A', year: 2025, genre: 'Rap', energy: 'Mid', axiom_first_seen_at: '2026-08-30T09:54:00Z' },
        { path: 'preview://library-gap-2', title: 'For The Money (DJ Juan Cuba Blend)', artist: 'Rick Ross ft Pharrell', bpm: 103, camelot: '12A', year: 2025, genre: 'Latin', energy: 'Peak', axiom_first_seen_at: '2026-08-30T09:48:00Z' },
        { path: 'preview://library-gap-3', title: 'How Long Have You Been Away', artist: 'Kryptogr', bpm: 123, camelot: '9A', year: 2020, genre: 'Refreshed', energy: 'Mid', axiom_first_seen_at: '2026-08-29T21:15:00Z' },
        { path: 'preview://library-gap-4', title: "I Can't Stand The Rain (Revisit)", artist: 'Eruption', bpm: 110, camelot: '1A', year: 1970, genre: 'Retro', energy: 'Mid', axiom_first_seen_at: '2026-08-28T13:04:00Z' },
        { path: 'preview://library-gap-5', title: 'Obsessed', artist: 'Calvin Harris, Charlie Puth & Shenseea', bpm: 100, camelot: '12A', year: 2023, genre: 'Electronic', energy: 'Peak', axiom_first_seen_at: '2026-08-24T08:30:00Z' },
        { path: 'preview://library-gap-6', title: 'Birthday Sex (Uptempo Mix)', artist: 'Jeremih', bpm: 129, camelot: '7A', year: 2009, genre: 'R&B', energy: 'Peak', axiom_first_seen_at: '2026-08-20T11:18:00Z' },
        { path: 'preview://library-gap-7', title: 'Down On Me (Short Mix)', artist: 'Jeremih', bpm: 80, camelot: '7A', year: 2011, genre: 'R&B', energy: 'Low', axiom_first_seen_at: '2026-08-18T16:42:00Z' }
      ];
      if (new URLSearchParams(window.location.search).get('ui_preview') === 'library-preparation') {
        tracks[0] = { ...tracks[0], bpm: 0, camelot: '' };
        tracks[1] = { ...tracks[1], camelot: '' };
        tracks[2] = { ...tracks[2], bpm: 0 };
      }
      // Exercise the real scrolling layout without importing or changing music.
      if (['127.0.0.1', 'localhost'].includes(window.location.hostname)
          && axiomReviewMode() === 'library'
          && new URLSearchParams(window.location.search).get('ui_preview') === 'library-full') {
        const seed = tracks.slice();
        for (let index = tracks.length; index < 240; index += 1) {
          const track = seed[index % seed.length];
          tracks.push({ ...track, path: `preview://library-full-${index}`, title: `${track.title} · Layout Test ${index + 1}` });
        }
      }
      return tracks.map(track => ({ ...track, ...(libraryGapPreparationReviewOverrides.get(track.path) || {}) }));
    }

    function workingSetAddAnimationEnabled() {
      return localStorage.getItem(WORKING_SET_ANIMATION_KEY) !== 'off';
    }

    function setWorkingSetAddAnimation(value = 'on') {
      const enabled = value !== 'off';
      localStorage.setItem(WORKING_SET_ANIMATION_KEY, enabled ? 'on' : 'off');
      const select = document.getElementById('working-set-animation-select');
      if (select) select.value = enabled ? 'on' : 'off';
      if (!enabled) hideStudioAddedOverlay();
      showToast(`Working Set add animation ${enabled ? 'on' : 'off'}.`);
    }

    function hideWorkingSetAnimationForSession() {
      sessionStorage.setItem(WORKING_SET_SESSION_HIDDEN_KEY, 'true');
      hideStudioAddedOverlay();
      showToast('Working Set animation hidden until AXIOM is reopened.');
    }

    function matchingSongsButtonPosition() {
      return localStorage.getItem(MATCHING_SONGS_POSITION_KEY) === 'left' ? 'left' : 'right';
    }

    function setMatchingSongsButtonPosition(value = 'right') {
      const position = value === 'left' ? 'left' : 'right';
      localStorage.setItem(MATCHING_SONGS_POSITION_KEY, position);
      document.body.classList.toggle('matching-songs-left', position === 'left');
      const select = document.getElementById('matching-songs-position-select');
      if (select) select.value = position;
      if (typeof renderPlaylist === 'function') renderPlaylist();
      showToast(`Matching Songs buttons moved to the ${position}.`);
    }

    function libraryMatchingSongsEnabled() {
      return Boolean(window.__axiomDawMatchingContext?.forceMatching)
        || localStorage.getItem(LIBRARY_MATCHING_SONGS_KEY) === 'on';
    }

    function syncLibraryMatchingSongsPanelMotion(enabled, previousEnabled = enabled) {
      const panel = document.getElementById('smart-links-panel');
      if (!panel) return;
      clearTimeout(libraryMatchingSongsMotionTimer);
      if (enabled === previousEnabled) {
        panel.dataset.libraryMatchingMotion = enabled ? 'open' : 'closed';
        return;
      }
      if (enabled) {
        panel.dataset.libraryMatchingMotion = 'opening';
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (libraryMatchingSongsEnabled()) panel.dataset.libraryMatchingMotion = 'open';
        }));
        return;
      }
      panel.dataset.libraryMatchingMotion = 'closing';
      libraryMatchingSongsMotionTimer = setTimeout(() => {
        if (libraryMatchingSongsEnabled()) return;
        panel.dataset.libraryMatchingMotion = 'closed';
      }, 300);
    }

    function applyLibraryMatchingSongsPreference() {
      const enabled = libraryMatchingSongsEnabled();
      const previousEnabled = !document.body.classList.contains('library-matching-songs-disabled');
      const panel = document.getElementById('smart-links-panel');
      const toggle = document.getElementById('tab-library-matching-songs');
      const status = document.getElementById('settings-library-matching-status');
      if (panel) panel.setAttribute('aria-hidden', enabled || libraryRailMode === 'gap' ? 'false' : 'true');
      if (toggle) toggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
      if (status) status.textContent = `Library Matching Songs ${enabled ? 'On' : 'Off'}`;
      if (!enabled && previousEnabled) {
        syncLibraryMatchingSongsPanelMotion(false, true);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (!libraryMatchingSongsEnabled()) {
            document.body.classList.add('library-matching-songs-disabled');
          }
        }));
      } else {
        document.body.classList.toggle('library-matching-songs-disabled', !enabled);
        syncLibraryMatchingSongsPanelMotion(enabled, previousEnabled);
      }
      syncLibraryPresentationState();
      return enabled;
    }

    function toggleLibraryMatchingSongs() {
      if (window.AxiomDawFinder?.active) { window.AxiomDawFinder.end(); return; }
      const enabled = !libraryMatchingSongsEnabled();
      if (!enabled) window.__axiomDawMatchingContext = null;
      localStorage.setItem(LIBRARY_MATCHING_SONGS_KEY, enabled ? 'on' : 'off');
      applyLibraryMatchingSongsPreference();
      if (enabled && currentAnchorTrack) {
        resetAndFetchLibSuggestions();
      } else if (!enabled) {
        libSuggestionRequestId++;
        clearTimeout(smartLinkRefreshTimer);
      }
      showToast(`Library Matching Songs ${enabled ? 'shown' : 'hidden'}.`);
    }

    function initializeStudioDisplayPreferences() {
      const animationSelect = document.getElementById('working-set-animation-select');
      if (animationSelect) animationSelect.value = workingSetAddAnimationEnabled() ? 'on' : 'off';
      const position = matchingSongsButtonPosition();
      const matchingSelect = document.getElementById('matching-songs-position-select');
      if (matchingSelect) matchingSelect.value = position;
      document.body.classList.toggle('matching-songs-left', position === 'left');
      if (localStorage.getItem(LIBRARY_MATCHING_SONGS_KEY) == null) {
        localStorage.setItem(LIBRARY_MATCHING_SONGS_KEY, 'off');
      }
      applyLibraryMatchingSongsPreference();
      if (typeof isAxiomLite === 'function' && isAxiomLite()) return;
      if (localStorage.getItem(PERFORMANCE_AUTO_LIVE_ASSIST_KEY) == null) {
        localStorage.setItem(PERFORMANCE_AUTO_LIVE_ASSIST_KEY, 'on');
      }
      applyPerformanceAutoLiveAssistPreference();
      if (localStorage.getItem(PERFORMANCE_NOW_PLAYING_COLOUR_KEY) == null) {
        localStorage.setItem(PERFORMANCE_NOW_PLAYING_COLOUR_KEY, 'auto');
      }
      applyPerformanceNowPlayingColourPreference();
      if (localStorage.getItem(PERFORMANCE_LAYOUT_KEY) == null) {
        localStorage.setItem(PERFORMANCE_LAYOUT_KEY, 'auto');
      }
      applyPerformanceLayoutPreference();
    }

    function showStudioTrackAddedPulse(track = {}, count = 1) {
      if (!workingSetAddAnimationEnabled() || sessionStorage.getItem(WORKING_SET_SESSION_HIDDEN_KEY) === 'true') return;
      const previewTracks = arguments.length > 2 ? arguments[2] : null;
      const title = track?.title || track?.filename || 'Track';
      const isBatch = count > 1 && /tracks$/i.test(title);
      const addedThisTime = isBatch ? Math.max(1, parseInt(title, 10) || 1) : 1;
      const sessionAdds = Number(sessionStorage.getItem(WORKING_SET_SESSION_COUNT_KEY) || 0) + addedThisTime;
      sessionStorage.setItem(WORKING_SET_SESSION_COUNT_KEY, String(sessionAdds));
      const overlay = ensureStudioAddedOverlay();
      const sourceTracks = Array.isArray(previewTracks)
        ? previewTracks.filter(Boolean)
        : (Array.isArray(currentPlaylist) ? currentPlaylist.filter(Boolean) : []);
      const workingTracks = sourceTracks.length ? sourceTracks : [track];
      let sampledTracks = sampleStudioAddedTracks(workingTracks, 12);
      const trackIdentity = String(track?.path || track?.id || title).toLowerCase();
      let selectedIndex = sampledTracks.findIndex(item => String(item?.path || item?.id || item?.title || '').toLowerCase() === trackIdentity);
      if (selectedIndex < 0) selectedIndex = sampledTracks.length - 1;
      const mission = studioMissionName();
      const brief = setBriefPayload();
      const journey = brief.enabled ? setBriefLabel('energyJourney', brief.energyJourney) : 'Build Your Sequence';
      const addedCopy = isBatch
        ? `${title} are mapped across the set journey and ready to shape.`
        : `${title}${track?.artist ? ` by ${track.artist}` : ''} is in the set and ready for the next decision.`;

      document.getElementById('studio-added-title').textContent = mission;
      document.getElementById('studio-added-copy').textContent = addedCopy;
      document.getElementById('studio-added-mission').textContent = mission;
      document.getElementById('studio-added-journey').textContent = journey;
      document.getElementById('studio-added-count').textContent = `${Number(count || workingTracks.length).toLocaleString()} ${Number(count || workingTracks.length) === 1 ? 'Track' : 'Tracks'}`;
      document.getElementById('studio-added-session-hide')?.classList.toggle('visible', sessionAdds >= 5);
      document.getElementById('studio-added-tracks').innerHTML = sampledTracks.map((item, index) => {
        const artwork = getTrackArtwork(item) || '/static/axiom-mark.png';
        const itemTitle = item?.title || item?.filename || 'AXIOM Track';
        const artist = item?.artist || item?.genre || 'Ready in Studio';
        return `
          <article class="studio-added-track${index === selectedIndex ? ' is-new' : ''}">
            <img src="${escapeHtml(artwork)}" alt="${escapeHtml(itemTitle)} artwork" onerror="this.src='/static/axiom-mark.png';this.onerror=null;">
            <div class="studio-added-track-copy">
              <strong>${escapeHtml(itemTitle)}</strong>
              <small>${escapeHtml(artist)}</small>
            </div>
          </article>
        `;
      }).join('');

      clearTimeout(studioAddedHideTimer);
      overlay.classList.add('active');
      studioAddedHideTimer = setTimeout(hideStudioAddedOverlay, 4200);
    }

    window.AXIOM_MUSIC_INTAKE_START = showMusicIntakeOverlay;
    window.AXIOM_MUSIC_INTAKE_UPDATE = updateMusicIntakeOverlay;
    window.AXIOM_MUSIC_INTAKE_COMPLETE = completeMusicIntakeOverlay;
    window.AXIOM_STUDIO_ADDED_PREVIEW = showStudioTrackAddedPulse;
    document.addEventListener('DOMContentLoaded', initializeStudioDisplayPreferences);
