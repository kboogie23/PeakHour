(() => {
  const SOURCE_STORAGE_KEY = 'axiomRecordPoolSources.v1';
  const DOWNLOADS_STORAGE_KEY = 'axiomRecordPoolDownloadsFolder.v1';
  const PROVIDER_FALLBACK = [
    { id: 'bpm_supreme', name: 'BPM Supreme', url: 'https://bpmsupreme.com/' },
    { id: 'djcity', name: 'DJcity', url: 'https://www.djcity.com/' },
    { id: 'heavy_hits', name: 'Heavy Hits', url: 'https://heavyhits.com/' },
    { id: 'mymp3pool', name: 'MyMP3Pool', url: 'https://mp3poolonline.com/' },
    { id: 'dms', name: 'DMS', url: 'https://www.directmusicservice.com/' },
  ];
  const state = {
    providers: PROVIDER_FALLBACK.slice(),
    enabled: {},
    checked: {},
    downloadsFolder: '',
    selectedResultIndex: -1,
    candidates: [],
    selectedCandidateIndex: 0,
    watchStartedAt: 0,
    pollTimer: null,
    polling: false,
    reviewFixture: false,
    resolvedProvider: '',
  };

  function sourcePreferences() {
    try {
      const stored = JSON.parse(localStorage.getItem(SOURCE_STORAGE_KEY) || '{}');
      return stored && typeof stored === 'object' ? stored : {};
    } catch (_) {
      return {};
    }
  }

  function syncEnabledProviders() {
    const stored = sourcePreferences();
    state.enabled = Object.fromEntries(state.providers.map(provider => [
      provider.id,
      stored[provider.id] !== false,
    ]));
  }

  function saveEnabledProviders() {
    localStorage.setItem(SOURCE_STORAGE_KEY, JSON.stringify(state.enabled));
  }

  function missingResultIndexes() {
    const rows = Array.isArray(libraryGapPayload?.results) ? libraryGapPayload.results : [];
    return rows.map((item, index) => ({ item, index })).filter(({ item }) => (
      item.status === 'not_found' || item.status === 'resolved_local'
    ));
  }

  function unresolvedCount() {
    return (libraryGapPayload?.results || []).filter(item => item.status === 'not_found').length;
  }

  function selectedResult() {
    return libraryGapPayload?.results?.[state.selectedResultIndex] || null;
  }

  function requestedCopy(item = selectedResult()) {
    const request = item?.requested || {};
    return {
      title: request.title || request.raw || 'Missing Track',
      artist: request.artist || 'Requested Track',
      version: (item?.requested_versions || []).join(' / ') || 'Original / Clean',
    };
  }

  function formatDuration(value) {
    const seconds = Math.max(0, Math.round(Number(value) || 0));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function providerById(id) {
    return state.providers.find(provider => provider.id === id) || null;
  }

  function enabledProviders() {
    return state.providers.filter(provider => state.enabled[provider.id] !== false);
  }

  function copySearchRequest(text) {
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    const input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    try { document.execCommand('copy'); } catch (_) {}
    input.remove();
  }

  function ensureWorkspace() {
    let workspace = document.getElementById('library-gap-recovery');
    if (workspace) return workspace;
    workspace = document.createElement('section');
    workspace.id = 'library-gap-recovery';
    workspace.className = 'library-gap-recovery hidden';
    workspace.setAttribute('aria-hidden', 'true');
    document.getElementById('main-content-wrapper')?.appendChild(workspace);
    return workspace;
  }

  function sidebarMarkup() {
    const rows = missingResultIndexes();
    return `
      <aside class="gap-recovery-sidebar" aria-label="Missing track requests">
        <strong>${unresolvedCount()} Track${unresolvedCount() === 1 ? '' : 's'} Needed</strong>
        <div class="gap-recovery-request-list">
          ${rows.map(({ item, index }) => {
            const copy = requestedCopy(item);
            const resolved = item.status === 'resolved_local';
            return `
              <div class="gap-recovery-request ${index === state.selectedResultIndex ? 'active' : ''} ${resolved ? 'resolved' : ''}">
                <button type="button" class="gap-recovery-request-select" onclick="selectLibraryGapRecoveryRequest(${index})">
                  <span class="gap-recovery-request-dot" aria-hidden="true"></span>
                  <span><b>${escapeHtml(copy.title)}</b><small>${escapeHtml(copy.artist)}</small></span>
                  ${resolved ? '<img src="/static/icons/check-circle.svg" alt="Resolved">' : ''}
                </button>
                <button type="button" class="gap-recovery-request-remove" aria-label="Remove ${escapeHtml(copy.title)} from this list" title="Remove from this list" onclick="removeLibraryGapRecoveryRequest(event, ${index})">&times;</button>
              </div>
            `;
          }).join('')}
        </div>
      </aside>
    `;
  }

  function progressMarkup(hasCandidates) {
    if (!hasCandidates) return '';
    return `
      <div class="gap-recovery-progress" aria-label="Replacement progress">
        <span class="complete"><b>1</b> Download Detected</span>
        <i></i>
        <span class="active"><b>2</b> Review Version</span>
        <i></i>
        <span><b>3</b> Replace Placeholder</span>
      </div>
    `;
  }

  function providerRowsMarkup() {
    return state.providers.map(provider => {
      const enabled = state.enabled[provider.id] !== false;
      return `
        <div class="gap-recovery-provider ${enabled ? '' : 'disabled'}">
          <img src="/static/icons/disc-3.svg" alt="">
          <strong>${escapeHtml(provider.name)}</strong>
          <span>${enabled ? 'Browser Handoff' : 'Turned Off'}</span>
          <button type="button" ${enabled ? '' : 'disabled'} onclick="openRecordPoolSearch('${escapeHtml(provider.id)}')">Open Search</button>
        </div>
      `;
    }).join('');
  }

  function candidateRowsMarkup() {
    return state.candidates.map((candidate, index) => `
      <button type="button" class="gap-recovery-candidate ${index === state.selectedCandidateIndex ? 'selected' : ''}" onclick="selectLibraryGapRecoveryCandidate(${index})">
        <span class="gap-recovery-play" onclick="previewLibraryGapRecoveryCandidate(event, ${index})"><img src="/static/icons/disc-3.svg" alt="Preview"></span>
        <span class="gap-recovery-candidate-copy"><b>${escapeHtml(candidate.title || 'Unknown Title')}</b><small>${escapeHtml(candidate.artist || 'Unknown Artist')}</small></span>
        <img class="gap-recovery-wave" src="/static/icons/audio-waveform.svg" alt="Audio preview waveform">
        <span class="gap-recovery-metric">${Number(candidate.bpm || 0) ? `${Number(candidate.bpm).toFixed(Number(candidate.bpm) % 1 ? 1 : 0)} BPM` : '— BPM'}</span>
        <span class="gap-recovery-metric">${escapeHtml(candidate.camelot || '—')}</span>
        <span class="gap-recovery-metric">${formatDuration(candidate.duration_sec)}</span>
        <span class="gap-recovery-match">${escapeHtml(candidate.match_label || (index === 0 ? 'Best Match' : 'Possible Match'))}</span>
      </button>
    `).join('');
  }

  function initialPanelMarkup(copy) {
    const checkedCount = Object.values(state.checked).filter(Boolean).length;
    const activeCount = enabledProviders().length;
    return `
      <div class="gap-recovery-track-head">
        <span class="gap-recovery-missing-dot"></span>
        <div><h2>${escapeHtml(copy.title)}</h2><p>${escapeHtml(copy.artist)}</p><small>Requested Version: <b>${escapeHtml(copy.version)}</b></small></div>
      </div>
      <div class="gap-recovery-not-found"><span></span>Not In Your Library Yet</div>
      <div class="gap-recovery-divider"></div>
      <div class="gap-recovery-search-head">
        <div><strong>Search Record Pools</strong><span>Open your own connected pools for this exact request.</span></div>
        <button type="button" onclick="searchEnabledRecordPools()">Search Record Pools</button>
      </div>
      <p class="gap-recovery-checked">${checkedCount} of ${activeCount} enabled pool${activeCount === 1 ? '' : 's'} opened</p>
      <div class="gap-recovery-provider-list">${providerRowsMarkup()}</div>
      <div class="gap-recovery-watch">
        <img src="/static/icons/file-up.svg" alt="">
        <div><strong>${state.watchStartedAt ? 'Watching Downloads' : 'Ready To Watch Downloads'}</strong><span>${escapeHtml(state.downloadsFolder || 'Choose the folder where downloads arrive.')}</span></div>
        <button type="button" onclick="chooseLibraryGapDownloadsFolder()">Manage Downloads Folder</button>
      </div>
      <div class="gap-recovery-footer-actions">
        <button type="button" title="Check your Downloads folder for a finished copy of this song" onclick="pollLibraryGapRecoveryCandidates(true)">Check Downloads</button>
        <button type="button" class="skip" title="Leave this song on the missing list and move to the next request" onclick="keepLibraryGapPlaceholder()">Skip This Song</button>
        <button type="button" class="push" title="Save the missing-song list for later and carry on with the songs AXIOM found" onclick="continueLibraryGapWithoutMissingTracks()">Carry On Without Missing Songs</button>
      </div>
    `;
  }

  function detectedPanelMarkup(copy) {
    const selected = state.candidates[state.selectedCandidateIndex] || state.candidates[0] || {};
    return `
      <div class="gap-recovery-track-head compact">
        <span class="gap-recovery-missing-dot"></span>
        <div><h2>${escapeHtml(copy.title)}</h2><p>${escapeHtml(copy.artist)}</p><small>Requested Version: <b>${escapeHtml(copy.version)}</b></small></div>
      </div>
      <div class="gap-recovery-divider"></div>
      <div class="gap-recovery-detected-head"><strong>Download Detected — ${state.candidates.length} Possible Version${state.candidates.length === 1 ? '' : 's'}</strong><span>Preview the local files AXIOM found. Nothing changes until you choose one.</span></div>
      <div class="gap-recovery-candidates">${candidateRowsMarkup()}</div>
      <div class="gap-recovery-detected-lower">
        <div class="gap-recovery-source-receipt"><img src="/static/icons/file-up.svg" alt=""><span><b>${state.resolvedProvider ? `Downloaded after ${escapeHtml(state.resolvedProvider)}` : 'Completed local download detected'}</b><small>Checked locally. Source file untouched.</small></span><button type="button" onclick="searchAnotherRecordPool()">Search Another Pool</button></div>
        <div class="gap-recovery-confirm">
          <img src="/static/icons/check-circle.svg" alt="">
          <div><strong>Ready To Replace Placeholder</strong><span>${escapeHtml(selected.title || copy.title)} will replace the missing request in this set.</span></div>
          <button type="button" class="primary" onclick="confirmLibraryGapRecoveryVersion()">Use This Version</button>
          <button type="button" onclick="keepLibraryGapRecoveryAlternate()">Keep As Alternate</button>
          <button type="button" class="wrong" onclick="rejectLibraryGapRecoveryCandidate()">Not The Right Track</button>
        </div>
      </div>
      <div class="gap-recovery-resolution-summary"><b>${state.candidates.length ? '1 track ready to resolve' : 'No track selected'}</b><span>·</span><strong>${unresolvedCount()} track${unresolvedCount() === 1 ? '' : 's'} still needed</strong></div>
    `;
  }

  function renderWorkspace() {
    const workspace = ensureWorkspace();
    const item = selectedResult();
    if (!item) {
      workspace.innerHTML = '<div class="gap-recovery-empty"><strong>No Missing Tracks</strong><button onclick="closeLibraryGapRecovery()">Back To Results</button></div>';
      return;
    }
    const copy = requestedCopy(item);
    const hasCandidates = state.candidates.length > 0;
    const savedDownloadList = typeof getLibraryGapDownloadList === 'function' ? getLibraryGapDownloadList() : null;
    workspace.innerHTML = `
      <div class="gap-recovery-shell">
        <header class="gap-recovery-header">
          <div class="gap-recovery-title"><span>Playlist Check</span><i>/</i><strong>Missing Tracks</strong></div>
          <div class="gap-recovery-header-actions">
            <button type="button" class="gap-recovery-back" aria-label="Back to Paste A Playlist" title="Return to the playlist paste and results window" onclick="backToLibraryGapResults()">Back To Paste A Playlist</button>
            <button id="gap-recovery-save-list" type="button" class="gap-recovery-save-list ${savedDownloadList ? 'saved' : ''}" onclick="${savedDownloadList ? 'openLibraryGapDownloadList()' : 'saveLibraryGapDownloadList()'}">${savedDownloadList ? `Saved ${savedDownloadList.tracks.length} · View List` : 'Save Download List'}</button>
            <button type="button" class="gap-recovery-settings" onclick="openRecordPoolSettings()">Music Sources</button>
          </div>
        </header>
        ${progressMarkup(hasCandidates)}
        <div class="gap-recovery-layout ${hasCandidates ? 'has-candidates' : ''}">
          ${sidebarMarkup()}
          <main class="gap-recovery-main">${hasCandidates ? detectedPanelMarkup(copy) : initialPanelMarkup(copy)}</main>
        </div>
      </div>
    `;
  }

  function reviewCandidates() {
    return [
      { path: 'preview://recovery-september-clean', title: 'September (Original Clean)', artist: 'Earth, Wind & Fire', bpm: 120, camelot: '8A', duration_sec: 215, confidence: .98, match_label: 'Best Match' },
      { path: 'preview://recovery-september-intro', title: 'September (DJ Intro Clean)', artist: 'Earth, Wind & Fire', bpm: 120, camelot: '8A', duration_sec: 242, confidence: .92, match_label: 'Intro' },
      { path: 'preview://recovery-september-dirty', title: 'September (Extended Dirty)', artist: 'Earth, Wind & Fire', bpm: 120, camelot: '8A', duration_sec: 314, confidence: .89, match_label: 'Dirty' },
    ];
  }

  async function loadSettings() {
    try {
      const response = await fetch('/api/library/gap-recovery/settings');
      const payload = await response.json();
      if (response.ok && payload.success) {
        state.providers = Array.isArray(payload.providers) && payload.providers.length ? payload.providers : PROVIDER_FALLBACK.slice();
        state.downloadsFolder = localStorage.getItem(DOWNLOADS_STORAGE_KEY) || payload.downloads_folder || '';
      }
    } catch (_) {
      state.providers = PROVIDER_FALLBACK.slice();
      state.downloadsFolder = localStorage.getItem(DOWNLOADS_STORAGE_KEY) || '';
    }
    syncEnabledProviders();
  }

  window.openLibraryGapRecovery = async function openLibraryGapRecovery(options = {}) {
    const missing = missingResultIndexes();
    const firstUnresolved = missing.find(({ item }) => item.status === 'not_found') || missing[0];
    if (!firstUnresolved) {
      showToast('Every song in this list already has a local version.');
      return;
    }
    closeLibraryGapBuilder?.();
    closeLibraryGapWorkspace?.();
    await loadSettings();
    state.selectedResultIndex = firstUnresolved.index;
    state.candidates = [];
    state.selectedCandidateIndex = 0;
    state.reviewFixture = axiomReviewMode?.() === 'library-gap-checker';
    if (state.reviewFixture && !state.downloadsFolder) state.downloadsFolder = '/Users/user/Downloads';
    if (options.reviewDetected) {
      state.candidates = reviewCandidates();
      state.watchStartedAt = Date.now();
      state.checked.djcity = true;
      state.resolvedProvider = 'DJcity';
    }
    const workspace = ensureWorkspace();
    workspace.classList.remove('hidden');
    workspace.setAttribute('aria-hidden', 'false');
    document.body.classList.add('library-gap-recovery-active');
    renderWorkspace();
  };

  window.closeLibraryGapRecovery = function closeLibraryGapRecovery() {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
    const workspace = document.getElementById('library-gap-recovery');
    workspace?.classList.add('hidden');
    workspace?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('library-gap-recovery-active');
  };

  window.backToLibraryGapResults = function backToLibraryGapResults() {
    closeLibraryGapRecovery();
    openLibraryGapWorkspace();
  };

  window.selectLibraryGapRecoveryRequest = function selectLibraryGapRecoveryRequest(index) {
    state.selectedResultIndex = Number(index);
    state.candidates = [];
    state.selectedCandidateIndex = 0;
    renderWorkspace();
  };

  window.removeLibraryGapRecoveryRequest = function removeLibraryGapRecoveryRequest(event, index) {
    event?.preventDefault();
    event?.stopPropagation();
    const rows = Array.isArray(libraryGapPayload?.results) ? libraryGapPayload.results : [];
    const rowIndex = Number(index);
    const item = rows[rowIndex];
    if (!item) return;

    const copy = requestedCopy(item);
    const removedSelected = rowIndex === state.selectedResultIndex;
    rows.splice(rowIndex, 1);
    libraryGapPayload.counts = {
      ...(libraryGapPayload.counts || {}),
      in_library: rows.filter(row => row.status === 'in_library' || row.status === 'resolved_local').length,
      possible_match: rows.filter(row => row.status === 'possible_match').length,
      not_found: rows.filter(row => row.status === 'not_found').length,
    };

    if (state.selectedResultIndex > rowIndex) state.selectedResultIndex -= 1;
    const remaining = missingResultIndexes();
    if (!remaining.length) {
      state.selectedResultIndex = -1;
    } else if (removedSelected || !remaining.some(row => row.index === state.selectedResultIndex)) {
      state.selectedResultIndex = (remaining.find(row => row.index >= rowIndex) || remaining[remaining.length - 1]).index;
    }

    if (removedSelected) {
      state.candidates = [];
      state.selectedCandidateIndex = 0;
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
    renderLibraryGapPayload(libraryGapPayload);
    renderWorkspace();
    showToast(`${copy.title} removed from this request list.`);
  };

  window.searchEnabledRecordPools = function searchEnabledRecordPools() {
    const first = enabledProviders()[0];
    if (!first) {
      showToast('Turn on at least one Music Source first.', true);
      openRecordPoolSettings();
      return;
    }
    openRecordPoolSearch(first.id);
  };

  window.openRecordPoolSearch = async function openRecordPoolSearch(providerId) {
    const provider = providerById(providerId);
    if (!provider || state.enabled[providerId] === false) return;
    const copy = requestedCopy();
    const query = `${copy.artist} - ${copy.title}`;
    await copySearchRequest(query);
    state.checked[providerId] = true;
    state.resolvedProvider = provider.name;
    if (!state.watchStartedAt) state.watchStartedAt = Date.now();
    renderWorkspace();
    openAxiomExternalUrl(provider.url, `${provider.name} search`, { sameWindow: false });
    showToast(`${query} copied. Sign in to ${provider.name}, paste the search, preview, and download your version.`);
    startPolling();
  };

  function startPolling() {
    clearInterval(state.pollTimer);
    if (state.reviewFixture) return;
    pollLibraryGapRecoveryCandidates(false);
    state.pollTimer = setInterval(() => pollLibraryGapRecoveryCandidates(false), 2500);
  }

  window.pollLibraryGapRecoveryCandidates = async function pollLibraryGapRecoveryCandidates(announce = false) {
    if (state.reviewFixture) {
      if (!state.candidates.length) state.candidates = reviewCandidates();
      if (!state.watchStartedAt) state.watchStartedAt = Date.now();
      renderWorkspace();
      if (announce) showToast(`${state.candidates.length} possible local versions ready to preview.`);
      return;
    }
    if (state.polling) return;
    if (!state.downloadsFolder) {
      if (announce) showToast('Choose the Downloads folder your record pools use first.', true);
      return;
    }
    const copy = requestedCopy();
    state.polling = true;
    try {
      const response = await fetch('/api/library/gap-recovery/candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder: state.downloadsFolder,
          title: copy.title,
          artist: copy.artist,
          since: state.watchStartedAt ? (state.watchStartedAt / 1000) - 300 : (Date.now() / 1000) - 86400,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Downloads could not be checked.');
      const next = Array.isArray(payload.candidates) ? payload.candidates : [];
      const previousSignature = state.candidates.map(item => item.path).join('|');
      const nextSignature = next.map(item => item.path).join('|');
      if (nextSignature !== previousSignature) {
        state.candidates = next;
        state.selectedCandidateIndex = 0;
        renderWorkspace();
        if (next.length) showToast(`${next.length} possible downloaded version${next.length === 1 ? '' : 's'} found. Preview before replacing the placeholder.`);
      } else if (announce) {
        showToast(next.length ? `${next.length} possible version${next.length === 1 ? '' : 's'} ready.` : 'No completed matching download found yet.');
      }
    } catch (error) {
      if (announce) showToast(error.message || 'Downloads could not be checked.', true);
    } finally {
      state.polling = false;
    }
  };

  window.selectLibraryGapRecoveryCandidate = function selectLibraryGapRecoveryCandidate(index) {
    state.selectedCandidateIndex = Math.max(0, Math.min(Number(index) || 0, state.candidates.length - 1));
    renderWorkspace();
  };

  window.previewLibraryGapRecoveryCandidate = function previewLibraryGapRecoveryCandidate(event, index) {
    event?.stopPropagation();
    selectLibraryGapRecoveryCandidate(index);
    const candidate = state.candidates[state.selectedCandidateIndex];
    if (!candidate) return;
    if (state.reviewFixture || String(candidate.path || '').startsWith('preview://')) {
      document.getElementById('ap-title').textContent = candidate.title || 'Version Preview';
      document.getElementById('ap-artist').textContent = candidate.artist || '';
      document.getElementById('ap-time').textContent = '0:42';
      document.getElementById('ap-duration').textContent = formatDuration(candidate.duration_sec);
      document.body.classList.add('has-playing');
      showToast(`Previewing ${candidate.title}.`);
      return;
    }
    playAudioFile(candidate.path, candidate.title, candidate.artist, candidate.bpm, candidate.camelot, candidate.energy, event, candidate.genre);
  };

  window.confirmLibraryGapRecoveryVersion = async function confirmLibraryGapRecoveryVersion() {
    const candidate = state.candidates[state.selectedCandidateIndex];
    const item = selectedResult();
    if (!candidate || !item) return;
    let track = { ...candidate };
    try {
      if (!state.reviewFixture && !String(candidate.path || '').startsWith('preview://')) {
        const response = await fetch('/api/library/gap-recovery/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: candidate.path, folder: state.downloadsFolder }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) throw new Error(payload.error || 'That version could not be confirmed.');
        track = payload.track;
      }
      item.status = 'resolved_local';
      item.versions = [{ ...track, recovered_from: state.resolvedProvider || 'Record Pool Download' }];
      item.version_count = 1;
      item.requested_version_confirmed = true;
      item.recovered_from = state.resolvedProvider || 'Record Pool Download';
      libraryGapPayload.counts.not_found = Math.max(0, Number(libraryGapPayload.counts.not_found || 0) - 1);
      libraryGapPayload.counts.in_library = Number(libraryGapPayload.counts.in_library || 0) + 1;
      renderLibraryGapPayload(libraryGapPayload);
      state.candidates = [];
      clearInterval(state.pollTimer);
      state.pollTimer = null;
      const next = missingResultIndexes().find(({ item: row }) => row.status === 'not_found');
      if (next) state.selectedResultIndex = next.index;
      renderWorkspace();
      showToast(`${track.title || 'Downloaded version'} will replace the placeholder when you build the set.`);
    } catch (error) {
      showToast(error.message || 'That version could not be used.', true);
    }
  };

  window.keepLibraryGapRecoveryAlternate = function keepLibraryGapRecoveryAlternate() {
    const candidate = state.candidates[state.selectedCandidateIndex];
    const item = selectedResult();
    if (!candidate || !item) return;
    item.recovery_alternates = [...(item.recovery_alternates || []), candidate];
    showToast(`${candidate.title || 'Version'} kept as an alternate. The placeholder is still unresolved.`);
  };

  window.rejectLibraryGapRecoveryCandidate = function rejectLibraryGapRecoveryCandidate() {
    if (!state.candidates.length) return;
    state.candidates.splice(state.selectedCandidateIndex, 1);
    state.selectedCandidateIndex = Math.max(0, Math.min(state.selectedCandidateIndex, state.candidates.length - 1));
    renderWorkspace();
    showToast(state.candidates.length ? 'That version was removed from this review.' : 'No version selected. The placeholder remains.');
  };

  window.searchAnotherRecordPool = function searchAnotherRecordPool() {
    state.candidates = [];
    state.selectedCandidateIndex = 0;
    renderWorkspace();
  };

  window.keepLibraryGapPlaceholder = function keepLibraryGapPlaceholder() {
    const rows = missingResultIndexes().filter(({ item }) => item.status === 'not_found');
    const current = rows.findIndex(({ index }) => index === state.selectedResultIndex);
    const next = rows[current + 1] || rows[0];
    if (next && next.index !== state.selectedResultIndex) {
      state.selectedResultIndex = next.index;
      state.candidates = [];
      renderWorkspace();
      return;
    }
    continueLibraryGapRecoveryToBuilder();
  };

  window.continueLibraryGapRecoveryToBuilder = function continueLibraryGapRecoveryToBuilder() {
    closeLibraryGapRecovery();
    openLibraryGapBuilder();
  };

  window.chooseLibraryGapDownloadsFolder = async function chooseLibraryGapDownloadsFolder() {
    try {
      let picked;
      if (state.reviewFixture) {
        picked = { path: '/Users/user/Downloads', name: 'Downloads' };
      } else if (typeof hasAxiomNativePicker === 'function' && hasAxiomNativePicker()) {
        picked = await axiomNativePick('chooseDownloadsFolder');
      } else {
        const fallback = await pickMusicFolderPath();
        picked = { path: fallback.folder_path, name: fallback.folder_name };
      }
      if (!picked?.path) return;
      state.downloadsFolder = picked.path;
      localStorage.setItem(DOWNLOADS_STORAGE_KEY, picked.path);
      renderWorkspace();
      showToast(`Watching ${picked.name || picked.path} for completed downloads.`);
    } catch (error) {
      if (!error?.cancelled) showToast(error?.message || 'Downloads folder selection paused.', true);
    }
  };

  window.openRecordPoolSettings = function openRecordPoolSettings() {
    syncEnabledProviders();
    document.getElementById('record-pool-settings-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'record-pool-settings-modal';
    modal.className = 'record-pool-settings-modal';
    modal.innerHTML = `
      <div class="record-pool-settings-shell" role="dialog" aria-modal="true" aria-labelledby="record-pool-settings-title">
        <header><div><span>Library · Music Sources</span><h2 id="record-pool-settings-title">Your Record Pools</h2><p>AXIOM opens each provider in your normal browser. Your login stays with the provider and is never stored by AXIOM.</p></div><button type="button" onclick="closeRecordPoolSettings()">Close</button></header>
        <div class="record-pool-settings-list">
          ${state.providers.map(provider => `
            <div class="record-pool-settings-row">
              <img src="/static/icons/disc-3.svg" alt="">
              <div><strong>${escapeHtml(provider.name)}</strong><span>Browser handoff · provider login</span></div>
              <button type="button" class="settings-toggle ${state.enabled[provider.id] !== false ? 'on' : ''}" aria-label="Use ${escapeHtml(provider.name)} for missing-track searches" aria-pressed="${state.enabled[provider.id] !== false ? 'true' : 'false'}" onclick="toggleRecordPoolSource('${escapeHtml(provider.id)}', this)"><span></span></button>
              <button type="button" aria-label="Open ${escapeHtml(provider.name)} website" onclick="openAxiomExternalUrl('${escapeHtml(provider.url)}', '${escapeHtml(provider.name)}')">Open Website</button>
            </div>
          `).join('')}
        </div>
        <footer><div><strong>Download Detection</strong><span>${escapeHtml(state.downloadsFolder || 'Default Downloads folder')}</span></div><button type="button" onclick="chooseLibraryGapDownloadsFolder()">Choose Folder</button></footer>
      </div>
    `;
    modal.addEventListener('click', event => { if (event.target === modal) closeRecordPoolSettings(); });
    document.body.appendChild(modal);
  };

  window.closeRecordPoolSettings = function closeRecordPoolSettings() {
    document.getElementById('record-pool-settings-modal')?.remove();
    renderWorkspace();
  };

  window.toggleRecordPoolSource = function toggleRecordPoolSource(providerId, button) {
    state.enabled[providerId] = !(state.enabled[providerId] !== false);
    saveEnabledProviders();
    const enabled = state.enabled[providerId] !== false;
    button?.classList.toggle('on', enabled);
    button?.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  };
})();
