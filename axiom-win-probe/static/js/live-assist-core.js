// Live Assist state, rendering, recommendations, and polling.

    window.__AXIOM_NATIVE_ACCESSIBILITY_STATUS = function (detail = {}) {
      const button = document.getElementById('assist-search-access');
      const notice = document.getElementById('assist-mac-access');
      const status = document.getElementById('assist-mac-access-status');
      if (!button || !notice || !status) return;
      const connected = detail.trusted === true && detail.listenerActive === true;
      status.textContent = detail.available === false ? 'Command-F access requires the installed app'
        : connected ? ''
        : detail.trusted === true ? 'Mac access approved. Reconnect Command-F.'
        : `Allow ${String(detail.permissionApp || 'AXIOM')} in Accessibility to use Command-F.`;
      notice.hidden = connected;
      button.hidden = detail.available === false || (detail.trusted === true && detail.listenerActive === true);
      button.textContent = detail.trusted === true ? 'Reconnect' : 'Allow access';
      button.title = detail.trusted === true
        ? 'Retry the Command-F listener and check its current Mac access.'
        : `Allow ${String(detail.permissionApp || 'AXIOM')} in macOS Accessibility for Command-F. Keep AXIOM open; it connects automatically when macOS grants access.`;
      button.onclick = () => window.webkit?.messageHandlers?.axiomNative?.postMessage({
        action: detail.trusted === true ? 'checkAccessibilityPermission' : 'openAccessibilitySettings',
      });
    };

    // Exercise the native permission states only in an explicit local browser review.
    function applyLiveAssistAccessReview(query, context) {
      if (!context.preview || context.nativeShell
          || !['127.0.0.1', 'localhost', '[::1]'].includes(context.hostname)) return false;
      const access = query.get('mac_access');
      if (!['required', 'reconnect', 'connected'].includes(access)) return false;
      window.__AXIOM_NATIVE_ACCESSIBILITY_STATUS({
        available: true,
        permissionApp: 'AXIOM PRO',
        trusted: access !== 'required',
        listenerActive: access === 'connected',
      });
      return true;
    }

    const state = {
      anchor: null,
      selectedPlayingTrackKey: '',
      suggestions: [],
      gigProfile: {},
      bpmOverride: '',
      bpmDraft: '',
      bpmContext: {},
      tempoIntent: '',
      minYear: 0,
      maxYear: 0,
      rejectedGenres: new Set(),
      preferredGenre: '',
      moreLike: null,
      yearRange: null,
      similarityMode: 'auto',
      preferredDJEra: '',
      preferredEra: 0,
      wrongGenrePath: '',
      wrongGenreName: '',
      genreFlipGenres: [],
      energyBoost: false,
      yearMode: '',
      cleanOnly: false,
      hiddenPaths: new Set(),
      hiddenFamilies: new Set(),
      playedFamilies: new Set(),
      selectedPath: '',
      pinned: true,
      loading: false,
      lastLivePath: '',
      lastSnapshotVersion: 0,
      lastSessionVersion: 0,
      lastTempoResetVersion: 0,
      lastPayloadSignature: '',
      lastSuggestionSignature: '',
      refreshPending: false,
      pollTimer: null,
      gigProfileSources: [],
      gigProfileSelectedIds: new Set(),
      gigProfileMenuOpen: false,
      gigProfileMenuDirty: false,
      gigProfileSourcesLoaded: false,
      gigProfileSourcesLoading: false,
      gigProfileEnabled: false,
      gigProfileEnabledExplicit: false,
      gigProfileOnlySelected: false,
      gigProfileColorsEnabled: true,
      djTrackPosition: 'top',
      gigProfileSavedProfiles: [],
      gigProfileActiveSavedId: '',
      gigProfileProfilesFromPerformance: false,
      nowPlayingColourPreference: 'auto',
      coachInsightsEnabled: false,
      coachPromptUntil: 0,
      coachLastPromptAt: 0,
      coachLastAnchorKey: '',
      coachPromptTimer: null,
    };

    const GIG_PROFILE_STORAGE_KEY = 'axiomPerformanceGigProfiles';
    const GIG_PROFILE_ACTIVE_KEY = 'axiomPerformanceGigProfileActive';
    const GIG_PROFILE_LIVE_CRATES_ID = 'gig-live-assist-crates';
    const LIVE_ASSIST_CLEAN_ONLY_KEY = 'axiomLiveAssistCleanOnly';
    const LIVE_ASSIST_DJ_TRACK_POSITION_KEY = 'axiomLiveAssistDJTrackPosition.v1';
    const PERFORMANCE_COACH_INSIGHTS_KEY = 'axiomPerformanceCoachInsights.v1';
    const PERFORMANCE_COACH_COOLDOWN_MS = 5 * 60 * 1000;
    const PERFORMANCE_COACH_VISIBLE_MS = 10000;
    const LIVE_ASSIST_QUERY = new URLSearchParams(window.location.search);
    const LIVE_ASSIST_NATIVE_SHELL = Boolean(window.webkit?.messageHandlers?.axiomNative?.postMessage);
    const LIVE_ASSIST_LAYOUT_KEY = 'axiomLiveAssistLayout.v1';
    document.body.classList.toggle('native-shell', LIVE_ASSIST_NATIVE_SHELL);
    // Preview fixtures are allowed only in a normal browser approval route.
    // The installed native panel must always render shared production state.
    const LIVE_ASSIST_PREVIEW_MODE = LIVE_ASSIST_QUERY.has('preview') && !LIVE_ASSIST_NATIVE_SHELL;
    applyLiveAssistAccessReview(LIVE_ASSIST_QUERY, {
      preview: LIVE_ASSIST_PREVIEW_MODE,
      nativeShell: LIVE_ASSIST_NATIVE_SHELL,
      hostname: location.hostname,
    });
    const LIVE_ASSIST_PLAYLIST_STYLE = String(LIVE_ASSIST_QUERY.get('playlist_style') || 'matching_songs').trim();
    const LIVE_ASSIST_POPUP_STYLE = String(LIVE_ASSIST_QUERY.get('popup_style') || 'matching_songs').trim();

    const list = document.getElementById('list');
    let liveAssistListMarkup = null;
    const statusEl = document.getElementById('assist-announcer');
    const setRecordButton = document.getElementById('set-record-button');
    const setRecordTime = document.getElementById('set-record-time');
    const setRecordDrawer = document.getElementById('set-record-drawer');
    const setRecordSource = document.getElementById('set-record-source');
    const setRecordFormat = document.getElementById('set-record-format');
    const setRecordBroadcast = document.getElementById('set-record-broadcast');
    const setRecordSaveDirectory = document.getElementById('set-record-save-directory');
    const setRecordReady = document.getElementById('set-record-ready');
    const setRecordStart = document.getElementById('set-record-start');
    const setRecordTest = document.getElementById('set-record-test');
    const setRecordReceipt = document.getElementById('set-record-receipt');
    const setRecordReceiptName = document.getElementById('set-record-receipt-name');
    const setRecordReceiptMeta = document.getElementById('set-record-receipt-meta');
    const coachInsightsToggle = document.getElementById('coach-insights-toggle');
    const performanceCoachRail = document.getElementById('performance-coach-rail');
    const pinButton = document.getElementById('pin-button');
    const halfButton = document.getElementById('half-button');
    const doubleButton = document.getElementById('double-button');
    const refreshButton = document.getElementById('refresh-button');
    const refreshPlusButton = document.getElementById('refresh-plus-button');
    const refreshMenu = document.getElementById('refresh-menu');
    const refreshBpmButton = document.getElementById('refresh-bpm-button');
    const cleanOnlyButton = document.getElementById('clean-only-button');
    const energyButton = document.getElementById('energy-button');
    const newButton = document.getElementById('new-button');
    const genreFlipButton = document.getElementById('genre-flip-button');
    const gigProfileButton = document.getElementById('gig-profile-button');
    const gigProfileMenu = document.getElementById('gig-profile-menu');
    const gigProfileSearch = document.getElementById('gig-profile-search');
    const gigProfileSources = document.getElementById('gig-profile-sources');
    const gigProfileSelectionCount = document.getElementById('gig-profile-selection-count');
    const gigProfileSaved = document.getElementById('gig-profile-saved');
    const gigProfileSavePanel = document.getElementById('gig-profile-save-panel');
    const gigProfileName = document.getElementById('gig-profile-name');
    const gigProfileLoadButton = document.getElementById('gig-profile-load');
    const gigProfileSaveButton = document.getElementById('gig-profile-save');
    const assistNowPlaying = document.querySelector('.assist-now-playing');
    const assistLayoutSelect = document.getElementById('assist-layout-select');

    try {
      state.cleanOnly = localStorage.getItem(LIVE_ASSIST_CLEAN_ONLY_KEY) === '1';
      state.djTrackPosition = localStorage.getItem(LIVE_ASSIST_DJ_TRACK_POSITION_KEY) === 'bottom' ? 'bottom' : 'top';
      state.coachInsightsEnabled = localStorage.getItem(PERFORMANCE_COACH_INSIGHTS_KEY) === 'on';
    } catch (_) {
      state.cleanOnly = false;
      state.coachInsightsEnabled = false;
    }
    if (LIVE_ASSIST_PREVIEW_MODE || LIVE_ASSIST_QUERY.has('popup')) {
      document.body.dataset.assistMode = 'expanded';
    }

    if (LIVE_ASSIST_PLAYLIST_STYLE !== 'classic') {
      document.body.dataset.playlistStyle = 'matching-songs';
    }

    if (LIVE_ASSIST_POPUP_STYLE !== 'classic') {
      document.body.dataset.popupStyle = 'matching-songs';
    }

    function normalizeNowPlayingColourPreference(value = 'auto') {
      const preference = String(value || 'auto').trim().toLowerCase();
      return ['auto', 'axiom', 'serato', 'djay'].includes(preference) ? preference : 'auto';
    }

    function applyAssistNowPlayingColour(track = null) {
      const preference = normalizeNowPlayingColourPreference(state.nowPlayingColourPreference);
      const liveProvider = String(
        track?.raw?.live_provider
        || track?.raw?.active_provider
        || state.gigProfile.live_provider
        || ''
      ).trim().toLowerCase();
      // A connected provider owns its branding, including on restored windows.
      const provider = ['djay', 'serato'].includes(liveProvider)
        ? liveProvider
        : (preference === 'auto' ? 'axiom' : preference);
      const previousProvider = assistNowPlaying.dataset.provider || '';
      assistNowPlaying.classList.remove('provider-axiom', 'provider-serato', 'provider-djay');
      assistNowPlaying.classList.add(`provider-${provider}`);
      document.body.classList.remove('provider-axiom', 'provider-serato', 'provider-djay');
      document.body.classList.add(`provider-${provider}`);
      assistNowPlaying.dataset.provider = provider;
      if (provider !== previousProvider) {
        const nativeBridge = window.webkit?.messageHandlers?.axiomNative;
        nativeBridge?.postMessage?.({
          action: 'clientLog',
          level: 'info',
          message: `Live Assist Now Playing provider tone: ${provider}.`,
          stage: 'live-assist-provider-tone',
        });
      }
      return provider;
    }

    function postNativeAssistAction(action) {
      const nativeBridge = window.webkit?.messageHandlers?.axiomNative;
      if (nativeBridge?.postMessage) {
        nativeBridge.postMessage({ action });
        return true;
      }
      return false;
    }

    function normalizeAssistLayout(value = 'auto') {
      const layout = String(value || 'auto').trim().toLowerCase();
      return ['auto', 'full', 'compact'].includes(layout) ? layout : 'auto';
    }

    function browserResolvedAssistLayout(preference = 'auto') {
      const normalized = normalizeAssistLayout(preference);
      if (normalized !== 'auto') return normalized;
      return window.innerWidth <= 420 || window.innerHeight <= 620
        ? 'compact'
        : 'full';
    }

    function renderAssistLayout(preference = 'auto', resolved = '') {
      const normalized = normalizeAssistLayout(preference);
      const nextResolved = ['full', 'compact'].includes(resolved)
        ? resolved
        : browserResolvedAssistLayout(normalized);
      document.body.dataset.assistLayoutPreference = normalized;
      document.body.dataset.assistLayoutResolved = nextResolved;
      if (assistLayoutSelect) assistLayoutSelect.value = normalized;
    }

    function setAssistLayoutPreference(preference = 'auto', notifyNative = true) {
      const normalized = normalizeAssistLayout(preference);
      renderAssistLayout(normalized);
      try {
        localStorage.setItem(LIVE_ASSIST_LAYOUT_KEY, normalized);
      } catch (_) {}
      if (notifyNative) {
        window.webkit?.messageHandlers?.axiomNative?.postMessage?.({
          action: 'setLiveAssistLayout',
          layout: normalized,
        });
      }
    }

    window.__AXIOM_SET_ASSIST_LAYOUT_RESOLVED = (preference = 'auto', resolved = '') => {
      renderAssistLayout(preference, resolved);
    };

    let initialAssistLayout = normalizeAssistLayout(LIVE_ASSIST_QUERY.get('layout') || 'auto');
    if (!LIVE_ASSIST_QUERY.has('layout')) {
      try {
        initialAssistLayout = normalizeAssistLayout(localStorage.getItem(LIVE_ASSIST_LAYOUT_KEY) || 'auto');
      } catch (_) {}
    }
    setAssistLayoutPreference(initialAssistLayout, LIVE_ASSIST_NATIVE_SHELL);
    assistLayoutSelect?.addEventListener('change', event => {
      setAssistLayoutPreference(event.currentTarget.value, true);
    });
    window.addEventListener('resize', () => {
      if (document.body.dataset.assistLayoutPreference !== 'auto' || LIVE_ASSIST_NATIVE_SHELL) return;
      renderAssistLayout('auto');
    });

    function formatBpm(value) {
      const bpm = Number(value || 0);
      return Number.isFinite(bpm) && bpm > 0 ? bpm.toFixed(1) : '';
    }

    function setAssistMode(mode = 'collapsed') {
      const nextMode = mode === 'expanded' ? 'expanded' : 'collapsed';
      document.body.dataset.assistMode = nextMode;
      if (!LIVE_ASSIST_NATIVE_SHELL) {
        document.body.classList.remove('assist-entering');
        void document.body.offsetHeight;
        document.body.classList.add('assist-entering');
      }
      if (nextMode === 'collapsed') {
        refreshMenu.hidden = true;
        refreshPlusButton.setAttribute('aria-expanded', 'false');
        gigProfileMenu.hidden = true;
        state.gigProfileMenuOpen = false;
      }
      // A hidden native view may throttle timers. Opening it is an immediate
      // data request, independent of the next scheduled background poll.
      if (nextMode === 'expanded' && !LIVE_ASSIST_PREVIEW_MODE) requestPerformanceStateRefresh();
    }

    window.__AXIOM_SET_ASSIST_MODE = (mode) => setAssistMode(mode);

    function expandLiveAssistWindow() {
      if (!postNativeAssistAction('expandLiveAssist')) setAssistMode('expanded');
    }

    function collapseLiveAssistWindow() {
      if (!postNativeAssistAction('collapseLiveAssist')) setAssistMode('collapsed');
    }

    function hideLiveAssistWindow() {
      if (postNativeAssistAction('hideLiveAssist')) return;
      window.close();
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[char]));
    }

    let liveAssistPreviewBatches = [];
    let liveAssistPreviewBatch = 0;

    function seedLiveAssistPreviewIfNeeded() {
      if (!LIVE_ASSIST_PREVIEW_MODE || state.anchor || state.suggestions.length) return;
      const previewName = String(LIVE_ASSIST_QUERY.get('preview') || '').toLowerCase();
      const requestedProvider = String(LIVE_ASSIST_QUERY.get('provider') || '').toLowerCase();
      const previewProvider = requestedProvider === 'none' || requestedProvider === 'axiom' || previewName.includes('neutral') || previewName.includes('no_dj') || previewName.includes('non_connected')
        ? 'axiom'
        : requestedProvider === 'djay' || previewName.includes('djay')
        ? 'djay'
        : 'serato';
      const isDjayPreview = previewProvider === 'djay';
      const isSeratoPreview = previewProvider === 'serato';
      const isConnectedPreview = isDjayPreview || isSeratoPreview;
      const providerDisplayName = isDjayPreview ? 'djay Pro' : isSeratoPreview ? 'Serato DJ Pro' : 'AXIOM';
      const providerSourceName = isDjayPreview ? 'djay Playlists' : isSeratoPreview ? 'Serato Crates' : 'AXIOM Library';
      state.anchor = {
        path: `/preview/deck/${previewProvider}-current-track.mp3`,
        title: isConnectedPreview ? `${providerDisplayName} Deck Track` : 'Current Deck Track',
        artist: isConnectedPreview ? `${providerDisplayName} Preview` : 'AXIOM Preview',
        bpm: isDjayPreview ? 128 : isSeratoPreview ? 100 : 101,
        camelot: isDjayPreview ? '2A' : isSeratoPreview ? '8A' : '9A',
        genre: isDjayPreview ? 'EDM' : isSeratoPreview ? 'Hip Hop' : 'Top 40',
        year: 2018,
        raw: { live_provider: isConnectedPreview ? previewProvider : '', energy: isDjayPreview ? 'peak' : 'mid' },
      };
      state.suggestions = [
        {
          path: '/preview/recommendations/clean-energy-fit.mp3',
          title: isConnectedPreview ? `${providerDisplayName} Playlist Energy Fit` : 'Clean Energy Fit',
          artist: 'Preview Artist',
          bpm: 101,
          camelot: '8A',
          genre: 'Hip Hop',
          year: 2016,
          clean: true,
          gig_profile: isConnectedPreview,
          gig_profile_name: isConnectedPreview ? providerSourceName : '',
          gig_profile_providers: isConnectedPreview ? [previewProvider] : [],
          dj_track_colors: isConnectedPreview ? { [previewProvider]: { name: 'Pink', hex: '#ff375f' } } : {},
          raw: { energy: 'high', version: 'Clean Edit' },
        },
        {
          path: '/preview/recommendations/rnb-genre-flip.mp3',
          title: 'Library RNB Genre Flip',
          artist: 'Preview Artist',
          bpm: 99,
          camelot: '9A',
          genre: 'RNB',
          year: 2014,
          clean: true,
          raw: { energy: 'mid', version: 'Radio Edit' },
        },
        {
          path: '/preview/recommendations/older-party-fit.mp3',
          title: 'Library Older Party Fit',
          artist: 'Preview Artist',
          bpm: 98,
          camelot: '8B',
          genre: 'Dancehall',
          year: 2010,
          clean: true,
          raw: { energy: 'peak', version: 'Clean Intro' },
        },
      ];
      // Populated design-review fixture: sample metadata, never real music paths.
      const populatedReview = previewName.includes('list')
        && ['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname)
        && (LIVE_ASSIST_QUERY.has('review') || LIVE_ASSIST_QUERY.has('ui_preview'));
      if (populatedReview) {
        Object.assign(state.anchor, {
          title: 'No Diggity', artist: 'Blackstreet', bpm: 100, camelot: '8A',
          genre: 'Hip Hop', year: 1996,
        });
        const similarityReview = previewName.includes('tyga') || previewName.includes('usher');
        if (similarityReview) Object.assign(state.anchor, previewName.includes('tyga')
          ? {title:'Pop It Off',artist:'Tyga',bpm:100,genre:'WEST COAST',root:'Urban',year:2024}
          : {title:'Yeah!',artist:'Usher',bpm:100,genre:'RNB',root:'Urban',year:2004});
        const eraReview = previewName === 'usher-era-list';
        if (eraReview) Object.assign(state.anchor, {year:2026,era_override:'2k Era'});
        const sampleSongs = eraReview ? [
          ['Artist match · approved 2000s edit', 'Usher', 102, '8A', 'RNB', 2026, '2k Era'],
          ['Artist match · 2000s', 'Usher', 99, '8A', 'RNB', 2003],
          ['Approved era · missing year', 'Sample Artist', 100, '8A', 'RNB', 0, '2k Era'],
          ['Other artist · 2000s', 'Sample Artist', 100, '8A', 'RNB', 2008],
          ['Artist match · 1990s', 'Usher', 101, '8A', 'RNB', 1997],
          ['Other artist · 1990s', 'Sample Artist', 100, '8A', 'RNB', 1995],
          ['Related root · 1990s', 'Sample Artist', 100, '8A', 'Hip Hop', 1996],
          ['Modern song · excluded from 2000s', 'Sample Artist', 100, '8A', 'RNB', 2026],
          ['Wrong root · 1990s', 'Sample Artist', 100, '8A', 'Dancehall', 1996],
        ] : similarityReview ? [
          ['Other artist · current range', 'Sample Artist', 100, '8A', state.anchor.genre, state.anchor.year],
          ['Artist match · newest year', state.anchor.artist, 102, '8A', state.anchor.genre, state.anchor.year],
          ['Artist match · middle year', `${state.anchor.artist} feat. Sample Guest`, 99, '8A', state.anchor.genre, state.anchor.year - 1],
          ['Artist match · oldest year', state.anchor.artist, 104, '8A', state.anchor.genre, state.anchor.year - 2],
          ['Artist match · previous range', state.anchor.artist, 101, '8A', state.anchor.genre, state.anchor.year - 3],
          ['Other artist · previous range', 'Sample Artist', 100, '8A', state.anchor.genre, state.anchor.year - 5],
          ['Artist match · two ranges back', state.anchor.artist, 100, '8A', state.anchor.genre, state.anchor.year - 6],
          ['Related root · previous range', state.anchor.artist, 100, '8A', 'Hip Hop', state.anchor.year - 4],
          ['Related root · two ranges back', 'Sample Artist', 99, '8A', 'RNB', state.anchor.year - 7],
          ['Related root · older range', state.anchor.artist, 100, '8A', 'Hip Hop', state.anchor.year - 9],
          ['Artist match · wrong genre', state.anchor.artist, 100, '8A', 'Dancehall', state.anchor.year],
          ['Artist match · missing year', state.anchor.artist, 100, '8A', state.anchor.genre, 0],
        ] : [
          ['Return of the Mack', 'Mark Morrison', 96, '8A', 'RNB', 1996],
          ['This Is How We Do It', 'Montell Jordan', 104, '8B', 'RNB', 1995],
          ['Family Affair', 'Mary J. Blige', 93, '8A', 'RNB', 2001],
          ['Hey Mr. D.J.', 'Zhane', 101, '8A', 'RNB', 1993],
          ['Let Me Blow Ya Mind', 'Eve feat. Gwen Stefani', 90, '9A', 'Hip Hop', 2001],
          ['Rock Your Body', 'Justin Timberlake', 100, '8B', 'Pop', 2002],
          ['Hot in Herre', 'Nelly', 107, '9A', 'Hip Hop', 2002],
          ['Yeah!', 'Usher feat. Lil Jon & Ludacris', 105, '8A', 'RNB', 2004],
          ['Get Busy', 'Sean Paul', 100, '8A', 'Dancehall', 2003],
          ['Love Like This', 'Faith Evans', 100, '8B', 'RNB', 1998],
          ['U Know What\'s Up', 'Donell Jones', 103, '9A', 'RNB', 1999],
          ['Be Faithful', 'Fatman Scoop', 101, '8A', 'Hip Hop', 1999],
          ['Ride Wit Me', 'Nelly', 101, '8B', 'Hip Hop', 2000],
          ['Crazy in Love', 'Beyonce feat. Jay-Z', 99, '9A', 'RNB', 2003],
          ['Work It', 'Missy Elliott', 102, '8A', 'Hip Hop', 2002],
          ['Pon de Replay', 'Rihanna', 100, '8B', 'Dancehall', 2005],
        ];
        state.suggestions = sampleSongs.map(([title, artist, bpm, camelot, genre, year, era_override], index) => ({
          path: `/preview/recommendations/design-list-${index + 1}.mp3`,
          title, artist, bpm, camelot, genre, year, era_override, clean: true,
          root: similarityReview ? (genre === 'Dancehall' ? 'Global' : 'Urban') : '',
          gig_profile: isConnectedPreview && index < 10,
          gig_profile_name: isConnectedPreview && index < 10 ? providerSourceName : '',
          gig_profile_providers: isConnectedPreview && index < 10 ? [previewProvider] : [],
          raw: { energy: index % 3 === 0 ? 'high' : 'mid', version: 'Clean Intro' },
        }));
        setStatus('Design preview: sample songs and illustrative metadata.');
      }
      // Finite sample batches for the browser workflow; never used by native playback.
      liveAssistPreviewBatches = populatedReview
        ? [state.suggestions, [...state.suggestions.slice(5), ...state.suggestions.slice(0, 5)]]
        : [state.suggestions, ...[
        ['Playlist Fresh Groove', 'Library RNB Warm Up', 'Library Dancehall Classic'],
        ['Playlist Late Night Fit', 'Library RNB Throwback', 'Library Party Starter'],
      ].map((titles, batch) => state.suggestions.map((track, index) => ({
        ...track,
        path: `/preview/recommendations/batch-${batch + 2}-${index + 1}.mp3`,
        title: titles[index],
        year: index === 0 ? 2023 + batch : track.year,
      })))];
      state.selectedPath = state.suggestions[0].path;
      state.gigProfile = {
        enabled: isConnectedPreview,
        only_selected: false,
        name: isConnectedPreview ? providerSourceName : 'Library',
        sources: isDjayPreview ? 4 : isSeratoPreview ? 7 : 0,
        tracks: isConnectedPreview ? 570 : 0,
        providers: isConnectedPreview ? [previewProvider] : [],
        live_provider: isConnectedPreview ? previewProvider : '',
      };
      state.gigProfileSelectedIds = isConnectedPreview ? new Set([`preview-${previewProvider}`]) : new Set();
      state.gigProfileEnabled = isConnectedPreview;
      if (!populatedReview) setStatus('');
    }

    function refreshLiveAssistPreviewRecommendations() {
      if (!LIVE_ASSIST_PREVIEW_MODE) return;
      seedLiveAssistPreviewIfNeeded();
      let rows = [];
      for (let attempt = 0; attempt < liveAssistPreviewBatches.length; attempt++) {
        liveAssistPreviewBatch = (liveAssistPreviewBatch + 1) % liveAssistPreviewBatches.length;
        state.suggestions = liveAssistPreviewBatches[liveAssistPreviewBatch];
        rows = filteredSuggestions();
        if (rows.length) break;
      }
      state.selectedPath = rows[0]?.path || '';
      state.refreshPending = false;
      render();
      setStatus(rows.length
        ? `Sample recommendations · batch ${liveAssistPreviewBatch + 1} of ${liveAssistPreviewBatches.length}.`
        : 'No sample songs match the current filters. Try another filter or reload the preview to reset rejected songs.');
    }

    function asNumber(value) {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }

    function trackYear(track = {}) {
      const year = parseInt(track.year || track.release_year || '', 10);
      return Number.isFinite(year) && year > 1900 ? year : 0;
    }

    function genreColourRgb(genre = '') {
      const text = String(genre || '').toLowerCase();
      if (/r\s*&\s*b|rnb|r n b/.test(text)) return '255, 95, 132';
      if (/retro|throwback|old\s*school|classic/.test(text)) return '42, 210, 190';
      if (/hip\s*-?hop|rap|trap|drill|ratchet|west\s*coast|east\s*coast/.test(text)) return '255, 138, 31';
      if (/dancehall|reggae|afro|amapiano|latin|global/.test(text)) return '163, 255, 0';
      if (/house|techno|edm|electronic|garage|dnb|drum|dance/.test(text)) return '255, 218, 38';
      if (/pop|top\s*40|mainstream/.test(text)) return '34, 167, 255';
      return '163, 255, 0';
    }

    function trackBpm(track = {}) {
      return asNumber(track.bpm || track.tempo || track.detected_bpm);
    }

    function liveAssistTempoSourceBpm() {
      return asNumber(state.bpmContext.live_bpm)
        || asNumber(state.anchor?.playing_bpm || state.anchor?.serato_playing_bpm)
        || trackBpm(state.anchor || {});
    }

    function normalizeTrack(track = {}) {
      return {
        path: String(track.path || track.file_path || track.filename || ''),
        title: String(track.title || track.name || track.filename || 'Unknown Title'),
        artist: String(track.artist || track.album_artist || 'Unknown Artist'),
        bpm: trackBpm(track),
        camelot: String(track.camelot || track.key || ''),
        genre: String(track.genre || ''),
        root: AXIOMLiveAssistSimilarity.rootFor(track),
        era_override: AXIOMLiveAssistSimilarity.eraName(track.era_override || track.raw?.era_override),
        effective_era: AXIOMLiveAssistSimilarity.eraFor(track),
        year: trackYear(track),
        year_estimated: Boolean(track.year_estimated ?? track.raw?.year_estimated),
        year_health_state: track.year_health_state || track.raw?.year_health_state || '',
        fit: String(track.match_label || track.fit_label || track.role_label || 'Fit'),
        gigProfile: Boolean(track.gig_profile ?? track.gigProfile),
        gigProfileName: String(track.gig_profile_name || track.gigProfileName || ''),
        gigProfileProviders: Array.isArray(track.gig_profile_providers) ? track.gig_profile_providers : (track.gigProfileProviders || []),
        dj_track_colors: track.dj_track_colors || track.raw?.dj_track_colors || {},
        raw: track.raw || track,
      };
    }

    function songFamilyTitle(value = '') {
      let clean = String(value || '').trim().toLowerCase();
      clean = clean.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_/g, ' ');
      clean = clean.replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' ');
      clean = clean.replace(/\b(feat|ft|featuring)\.?\b.*$/i, ' ');
      const versionWords = /\b(intro|outro|clean|dirty|explicit|radio|edit|remix|refix|rework|bootleg|mashup|transition|quick|short|long|extended|acap|acapella|instrumental|single|video|snipz|kidcutup|mrefresh|mfresh|markcutz|break|redrum|starter|throwback|version|club|mix)\b/i;
      const parts = clean.split(/\s+-\s+/);
      if (parts.length > 1 && parts.slice(1).some(part => versionWords.test(part))) clean = parts[0];
      clean = clean.replace(/\b(clean|dirty|explicit|intro|outro|radio|edit|remix|refix|rework|bootleg|mashup|transition|quick|short|long|extended|acap|acapella|instrumental|single|video|version|club|mix|hd|hq|xxx)\b/gi, ' ');
      return clean.replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
    }

    function trackFamilyKeys(track = {}) {
      const normalized = normalizeTrack(track);
      const artist = String(normalized.artist || '').toLowerCase()
        .replace(/\b(feat|ft|featuring)\.?\b.*$/i, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
      const filename = String(normalized.path || '').split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || '';
      const titles = [normalized.title, filename];
      const dashParts = filename.split(/\s+-\s+/);
      if (dashParts.length > 1) titles.push(dashParts.slice(1).join(' - '));
      const keys = [];
      titles.forEach(value => {
        const title = songFamilyTitle(value);
        if (!title) return;
        keys.push(`song::${title}`);
        if (artist) keys.push(`song::${artist}::${title}`);
        const compact = title.replace(/\s+/g, '');
        if (compact.length >= 6) {
          keys.push(`songcompact::${compact}`);
          if (artist) keys.push(`songcompact::${artist.replace(/\s+/g, '')}::${compact}`);
        }
      });
      return [...new Set(keys)];
    }

    function trackFamilyHidden(track = {}) {
      return [String(track.path || '').toLowerCase(), ...trackFamilyKeys(track)].some(key => (
        state.hiddenFamilies.has(key) || state.playedFamilies.has(key)
      ));
    }

    function rememberLiveAssistPlayingTrack(track = {}) {
      const provider = String(track.raw?.live_provider || track.live_provider || '').toLowerCase();
      if (!['serato', 'djay'].includes(provider)) return;
      [String(track.path || '').toLowerCase(), ...trackFamilyKeys(track)]
        .filter(Boolean).forEach(key => state.playedFamilies.add(key));
    }

    function isLocalTrackPath(path) {
      const value = String(path || '').trim();
      return value.startsWith('/') || value.startsWith('file://');
    }

    function fileUrlForPath(path) {
      const value = String(path || '').trim();
      if (value.startsWith('file://')) return value;
      return `file://${value.split('/').map((part, index) => index ? encodeURIComponent(part) : '').join('/')}`;
    }

    function setStatus(text, warn = false) {
      if (!statusEl) return;
      statusEl.textContent = text;
      statusEl.classList.toggle('warn', warn);
    }

    function gigProfileProviderTone() {
      const liveProvider = String(state.anchor?.raw?.live_provider || state.gigProfile.live_provider || '');
      if (liveProvider === 'serato' || liveProvider === 'djay') return liveProvider;
      const providers = new Set(Array.isArray(state.gigProfile.providers) ? state.gigProfile.providers : []);
      if (providers.size > 1) return 'mixed';
      return [...providers][0] || '';
    }

    function activeGigProfileProvider() {
      const provider = String(state.anchor?.raw?.live_provider || state.gigProfile.live_provider || '').toLowerCase();
      return provider === 'serato' || provider === 'djay' ? provider : '';
    }

    function activeGigProfileSources() {
      const provider = activeGigProfileProvider();
      return provider
        ? state.gigProfileSources.filter(source => source.provider === provider)
        : state.gigProfileSources;
    }

    function activeGigProfileSelectedIds() {
      const provider = activeGigProfileProvider();
      if (!provider || !state.gigProfileSources.length) return [...state.gigProfileSelectedIds];
      const allowed = new Set(activeGigProfileSources().map(source => source.id));
      return [...state.gigProfileSelectedIds].filter(sourceId => allowed.has(sourceId));
    }

    function normalizeSavedGigProfiles(profiles = []) {
      return (Array.isArray(profiles) ? profiles : [])
        .filter(profile => profile?.id && profile?.name)
        .map(profile => ({
          ...profile,
          sourceIds: Array.isArray(profile.sourceIds)
            ? profile.sourceIds.filter(Boolean)
            : (Array.isArray(profile.source_ids) ? profile.source_ids.filter(Boolean) : []),
        }));
    }

    function loadSavedGigProfiles(profiles = null) {
      try {
        const parsed = Array.isArray(profiles)
          ? profiles
          : JSON.parse(localStorage.getItem(GIG_PROFILE_STORAGE_KEY) || '[]');
        state.gigProfileSavedProfiles = normalizeSavedGigProfiles(parsed);
      } catch (_) {
        state.gigProfileSavedProfiles = [];
      }
      if (!state.gigProfileSavedProfiles.some(profile => profile.id === state.gigProfileActiveSavedId)) {
        state.gigProfileActiveSavedId = '';
      }
      renderSavedGigProfiles();
    }

    function renderSavedGigProfiles() {
      const presetOptions = [
        '<option value="">GIG PRESETS</option>',
        ...state.gigProfileSavedProfiles.map(profile => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)}</option>`),
      ];
      gigProfileSaved.innerHTML = presetOptions.join('');
      if (!state.gigProfileSavedProfiles.length) {
        gigProfileSaved.disabled = true;
        gigProfileLoadButton.disabled = true;
        state.gigProfileActiveSavedId = '';
        gigProfileSaved.value = '';
        return;
      }
      gigProfileSaved.disabled = false;
      gigProfileSaved.value = state.gigProfileActiveSavedId || '';
      gigProfileLoadButton.disabled = !gigProfileSaved.value;
    }

    function closeGigProfileSavePanel() {
      gigProfileSavePanel.hidden = true;
      gigProfileSaveButton.setAttribute('aria-expanded', 'false');
      gigProfileName.value = '';
    }

    function openGigProfileSavePanel() {
      if (!state.gigProfileSelectedIds.size) {
        setStatus('Choose at least one Serato crate or djay Pro playlist first.', true);
        return;
      }
      const suggestedName = state.gigProfileSavedProfiles.find(profile => profile.id === state.gigProfileActiveSavedId)?.name || '';
      gigProfileName.value = suggestedName;
      gigProfileSavePanel.hidden = false;
      gigProfileSaveButton.setAttribute('aria-expanded', 'true');
      requestAnimationFrame(() => {
        gigProfileName.focus();
        gigProfileName.select();
      });
      setStatus('Name this preset, then press Save.');
    }

    async function loadSavedGigProfile() {
      const profile = state.gigProfileSavedProfiles.find(item => item.id === gigProfileSaved.value);
      if (!profile) {
        setStatus('Choose or save a gig preset first, then load it here.', true);
        return;
      }
      closeGigProfileSavePanel();
      state.gigProfileActiveSavedId = profile.id;
      state.gigProfileSelectedIds = new Set(profile.sourceIds || []);
      state.gigProfileEnabled = state.gigProfileSelectedIds.size > 0;
      state.gigProfileEnabledExplicit = false;
      state.gigProfileMenuDirty = true;
      renderGigProfileSources();
      await applyGigProfileSelection(false);
    }

    async function saveCurrentGigProfile() {
      if (!state.gigProfileSelectedIds.size) {
        setStatus('Choose at least one Serato crate or djay Pro playlist first.', true);
        return;
      }
      const name = String(gigProfileName.value || '').trim();
      if (!name) {
        setStatus('Enter a name for this gig preset.', true);
        gigProfileName.focus();
        return;
      }
      const existing = state.gigProfileSavedProfiles.find(profile => profile.name.toLowerCase() === name.toLowerCase());
      const profile = {
        id: existing?.id || `gig-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name,
        sourceIds: [...state.gigProfileSelectedIds],
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const stored = (() => {
        try {
          const parsed = JSON.parse(localStorage.getItem(GIG_PROFILE_STORAGE_KEY) || '[]');
          return Array.isArray(parsed) ? parsed : [];
        } catch (_) { return []; }
      })();
      const index = stored.findIndex(item => item?.id === profile.id);
      if (index >= 0) stored.splice(index, 1, profile);
      else stored.unshift(profile);
      localStorage.setItem(GIG_PROFILE_STORAGE_KEY, JSON.stringify(stored));
      localStorage.setItem(GIG_PROFILE_ACTIVE_KEY, JSON.stringify({ id: profile.id, enabled: true }));
      state.gigProfileActiveSavedId = profile.id;
      loadSavedGigProfiles();
      closeGigProfileSavePanel();
      await applyGigProfileSelection(false);
      setStatus(`${profile.name} saved and ready for this room.`);
    }

    function gigProfileSourceParts(source = {}) {
      const parts = Array.isArray(source.path_parts)
        ? source.path_parts.map(part => String(part || '').trim()).filter(Boolean)
        : String(source.name || '').split('/').map(part => part.trim()).filter(Boolean);
      return parts.length ? parts : [String(source.leaf_name || source.name || 'Untitled Source')];
    }

    function buildGigProfileSourceForest(sources = []) {
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
        gigProfileSourceParts(source).forEach((part, index, parts) => {
          const duplicateLeaf = index === parts.length - 1 && children.get(part)?.source
            && children.get(part).source.id !== source.id;
          const key = duplicateLeaf ? `${part}\x00${source.id}` : part;
          if (!children.has(key)) children.set(key, { label: part, children: new Map(), source: null });
          const node = children.get(key);
          if (index === parts.length - 1) node.source = source;
          children = node.children;
        });
      });
      return [...providers.values()].sort((left, right) => left.label.localeCompare(right.label));
    }

    function gigProfileNodeHasSelected(node) {
      if (node.source && state.gigProfileSelectedIds.has(node.source.id)) return true;
      return [...node.children.values()].some(gigProfileNodeHasSelected);
    }

    function gigProfileNodeSelectableIds(node) {
      const ids = [];
      if (node.source && gigProfileSourceSelectable(node.source)) ids.push(node.source.id);
      node.children.forEach(child => ids.push(...gigProfileNodeSelectableIds(child)));
      return ids;
    }

    function gigProfileSourceSelectable(source) {
      return Number(source.matched_track_count || 0) > 0
        || Number(source.track_count || 0) > 0;
    }

    function renderGigProfileSourceControl(source, label, className, depth) {
      const matched = Number(source.matched_track_count || 0);
      const total = Number(source.track_count || 0);
      const disabled = !gigProfileSourceSelectable(source);
      return `
        <span class="${className} provider-${escapeHtml(source.provider || '')}${disabled ? ' is-unmatched' : ''}" style="--tree-depth:${depth}">
          <input type="checkbox" data-gig-profile-source-id="${escapeHtml(source.id)}" ${state.gigProfileSelectedIds.has(source.id) ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
          <strong>${escapeHtml(label || source.leaf_name || source.name || 'Untitled Source')}</strong>
          <small>${LIVE_ASSIST_PREVIEW_MODE ? `${total} tracks · Preview` : `${matched}/${total}`}</small>
        </span>`;
    }

    function renderGigProfileTreeNode(node, wanted = '', depth = 0, parentKey = '', reversed = false) {
      const branchKey = `${parentKey}/${node.label}`;
      const ownSearch = `${node.label} ${node.source?.provider_label || ''} ${node.source?.name || ''}`.toLowerCase();
      const childNodes = [...node.children.values()];
      if (reversed) childNodes.reverse();
      const childHtml = childNodes
        .map(child => renderGigProfileTreeNode(child, ownSearch.includes(wanted) ? '' : wanted, depth + 1, branchKey, reversed))
        .filter(Boolean)
        .join('');
      if (wanted && !ownSearch.includes(wanted) && !childHtml) return '';
      if (!childHtml && node.source) {
        const control = renderGigProfileSourceControl(node.source, node.label, 'gig-profile-source gig-profile-leaf', depth);
        return `<label>${control}</label>`;
      }
      const open = Boolean(wanted);
      const selectableIds = gigProfileNodeSelectableIds(node);
      const selectedCount = selectableIds.filter(id => state.gigProfileSelectedIds.has(id)).length;
      const allSelected = selectableIds.length > 0 && selectedCount === selectableIds.length;
      const partiallySelected = selectedCount > 0 && !allSelected;
      const head = `<span class="gig-profile-branch-head${selectableIds.length ? '' : ' is-unmatched'}" style="--tree-depth:${depth}">
        <input type="checkbox" aria-label="Select folder ${escapeHtml(node.label)}" data-gig-profile-branch-ids="${escapeHtml(JSON.stringify(selectableIds))}" data-indeterminate="${partiallySelected ? 'true' : 'false'}" ${allSelected ? 'checked' : ''} ${selectableIds.length ? '' : 'disabled'}>
        <strong>${escapeHtml(node.label)}</strong>
        <small>${selectedCount}/${selectableIds.length} selected</small>
      </span>`;
      return `<details class="gig-profile-branch" data-gig-tree-key="${escapeHtml(branchKey)}" ${open ? 'open' : ''}><summary>${head}</summary>${childHtml}</details>`;
    }

    function renderGigProfileButton() {
      const selectedCount = state.gigProfileSelectedIds.size || Number(state.gigProfile.sources || 0);
      const checkedCount = gigProfileSources.querySelectorAll('input[data-gig-profile-source-id]:checked').length;
      const displayedEnabled = state.gigProfileEnabled
        || (state.gigProfileMenuDirty && checkedCount > 0 && !state.gigProfileEnabledExplicit);
      const activeProfile = state.gigProfileSavedProfiles.find(profile => profile.id === state.gigProfileActiveSavedId);
      const profileName = String(activeProfile?.name || state.gigProfile.name || '').trim();
      const sourceName = profileName || (selectedCount ? 'Selected Crates' : 'Crates');
      const sourceLabel = `Playlists / ${sourceName}`;
      gigProfileButton.setAttribute('aria-expanded', String(Boolean(state.gigProfileMenuOpen)));
      gigProfileButton.textContent = state.gigProfileMenuOpen ? 'Live Playlists' : selectedCount ? `${sourceLabel} · ${selectedCount}` : sourceLabel;
      if (document.body.classList.contains('assist-owner-layout')) {
        gigProfileButton.textContent = state.gigProfileMenuOpen ? 'Live Playlists' : sourceLabel;
        const chevron = document.createElement('img');
        chevron.src = '/static/icons/chevron-down.svg';
        chevron.alt = '';
        chevron.setAttribute('aria-hidden', 'true');
        gigProfileButton.append(chevron);
      }
      gigProfileButton.title = displayedEnabled ? `${sourceLabel} is feeding Live Assist` : `${sourceLabel} is paused`;
      const provider = gigProfileProviderTone();
      gigProfileButton.classList.toggle('provider-serato', provider === 'serato');
      gigProfileButton.classList.toggle('provider-djay', provider === 'djay');
      gigProfileButton.classList.toggle('provider-mixed', provider === 'mixed');
      gigProfileButton.classList.toggle('active', displayedEnabled);
      const enabledButton = document.getElementById('gig-profile-enabled');
      enabledButton.textContent = 'Use live playlists';
      enabledButton.dataset.state = displayedEnabled ? 'On' : 'Off';
      enabledButton.setAttribute('aria-pressed', String(Boolean(displayedEnabled)));
      enabledButton.classList.toggle('active', displayedEnabled);
      const colorsButton = document.getElementById('gig-profile-colors');
      colorsButton.textContent = 'Track colours';
      colorsButton.dataset.state = state.gigProfileColorsEnabled ? 'On' : 'Off';
      colorsButton.setAttribute('aria-pressed', String(Boolean(state.gigProfileColorsEnabled)));
      colorsButton.classList.toggle('active', state.gigProfileColorsEnabled);
      const onlySelectedButton = document.getElementById('gig-profile-only-selected');
      const onlySelectedActive = displayedEnabled && state.gigProfileOnlySelected;
      onlySelectedButton.dataset.state = onlySelectedActive ? 'On' : 'Off';
      onlySelectedButton.classList.toggle('active', onlySelectedActive);
      onlySelectedButton.setAttribute('aria-pressed', onlySelectedActive ? 'true' : 'false');
      const assistOnlySelectedButton = document.getElementById('assist-only-selected');
      assistOnlySelectedButton.classList.toggle('active', onlySelectedActive);
      assistOnlySelectedButton.setAttribute('aria-pressed', onlySelectedActive ? 'true' : 'false');
    }

    function renderGigProfileSources() {
      if (typeof renderApprovedPlaylists === 'function' && renderApprovedPlaylists()) return;
      const wanted = String(gigProfileSearch.value || '').trim().toLowerCase();
      const previousScrollTop = gigProfileSources.scrollTop;
      const openKeys = new Set(
        [...gigProfileSources.querySelectorAll('details[open][data-gig-tree-key]')]
          .map(details => details.getAttribute('data-gig-tree-key'))
          .filter(Boolean)
      );
      const visibleSources = activeGigProfileSources();
      const activeProvider = activeGigProfileProvider();
      gigProfileSearch.placeholder = activeProvider === 'serato'
        ? 'Search Serato crates'
        : activeProvider === 'djay'
          ? 'Search djay Pro playlists'
          : 'Search Serato and djay Pro';
      const providerHtml = buildGigProfileSourceForest(visibleSources).map(provider => {
        const tree = [...provider.roots.values()]
          .map(node => renderGigProfileTreeNode(node, wanted, 0, provider.provider))
          .filter(Boolean)
          .join('');
        if (!tree) return '';
        return `<details class="gig-profile-provider" data-gig-tree-key="provider:${escapeHtml(provider.provider)}" open>
          <summary class="gig-profile-provider-head provider-${escapeHtml(provider.provider)}">
            <span>${escapeHtml(provider.label)}</span>
            <small>${provider.roots.size} top-level</small>
          </summary>
          ${tree}
        </details>`;
      }).filter(Boolean).join('');
      if (!providerHtml) {
        gigProfileSources.innerHTML = `<div class="gig-profile-empty">${state.gigProfileSourcesLoading ? 'Reading DJ playlists...' : 'No matching crates or playlists.'}</div>`;
      } else {
        gigProfileSources.innerHTML = providerHtml;
      }
      gigProfileSources.querySelectorAll('[data-gig-profile-branch-ids]').forEach(input => {
        input.indeterminate = input.getAttribute('data-indeterminate') === 'true';
      });
      if (!wanted && openKeys.size) {
        gigProfileSources.querySelectorAll('details[data-gig-tree-key]').forEach(details => {
          details.open = openKeys.has(details.getAttribute('data-gig-tree-key'));
        });
      }
      gigProfileSources.scrollTop = previousScrollTop;
      const provider = activeGigProfileProvider();
      gigProfileSelectionCount.textContent = `${activeGigProfileSelectedIds().length} selected${provider ? ` · ${provider === 'djay' ? 'djay Pro' : 'Serato'}` : ''}`;
      renderGigProfileButton();
    }

    function refreshGigProfileCheckboxState() {
      gigProfileSources.querySelectorAll('[data-gig-profile-source-id]').forEach(input => {
        input.checked = state.gigProfileSelectedIds.has(input.getAttribute('data-gig-profile-source-id'));
      });
      gigProfileSources.querySelectorAll('[data-gig-profile-branch-ids]').forEach(input => {
        let sourceIds = [];
        try { sourceIds = JSON.parse(input.getAttribute('data-gig-profile-branch-ids') || '[]'); } catch (_) {}
        const selectedCount = sourceIds.filter(sourceId => state.gigProfileSelectedIds.has(sourceId)).length;
        input.checked = sourceIds.length > 0 && selectedCount === sourceIds.length;
        input.indeterminate = selectedCount > 0 && selectedCount < sourceIds.length;
        input.setAttribute('data-indeterminate', input.indeterminate ? 'true' : 'false');
        const count = input.closest('.gig-profile-branch-head')?.querySelector('small');
        if (count) count.textContent = `${selectedCount}/${sourceIds.length} selected`;
      });
      const provider = activeGigProfileProvider();
      gigProfileSelectionCount.textContent = `${activeGigProfileSelectedIds().length} selected${provider ? ` · ${provider === 'djay' ? 'djay Pro' : 'Serato'}` : ''}`;
      renderGigProfileButton();
    }

    async function loadGigProfileSources(force = false) {
      if (state.gigProfileSourcesLoading) return;
      if (LIVE_ASSIST_PREVIEW_MODE && LIVE_ASSIST_QUERY.get('preview')?.includes('list')
          && ['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname)
          && state.gigProfileSourcesLoaded) {
        renderGigProfileSources();
        return;
      }
      if (state.gigProfileSourcesLoaded && !force) {
        renderGigProfileSources();
        return;
      }
      state.gigProfileSourcesLoading = true;
      renderGigProfileSources();
      try {
        const payload = await fetchJson('/api/performance/gig_profile/sources?summary=1', { cache: 'no-store', timeoutMs: 60000 });
        state.gigProfileSources = Array.isArray(payload.sources) ? payload.sources : [];
        if (
          LIVE_ASSIST_PREVIEW_MODE
          && LIVE_ASSIST_QUERY.get('preset_test') === '1'
          && (
            !state.gigProfileSelectedIds.size
            || [...state.gigProfileSelectedIds].every(sourceId => String(sourceId).startsWith('preview-'))
          )
          && state.gigProfileSources.length
        ) {
          // Local browser-review fixture only: production and native windows
          // must always use the DJ sources the user actually selected.
          state.gigProfileSelectedIds = new Set([state.gigProfileSources[0].id]);
          state.gigProfileEnabled = true;
        }
        state.gigProfileSourcesLoaded = true;
      } catch (error) {
        setStatus(`Gig Profile sources unavailable: ${error.message}`, true);
      } finally {
        state.gigProfileSourcesLoading = false;
        renderGigProfileSources();
      }
    }

    async function refreshGigProfileSources() {
      state.gigProfileChoosing = true;
      gigProfileSearch.value = '';
      gigProfileSearch.hidden = false;
      document.getElementById('gig-profile-refresh').hidden = false;
      document.getElementById('gig-profile-apply').textContent = 'Add Playlists';
      await loadGigProfileSources(true);
      setStatus('DJ playlists refreshed. Choose playlists, then Apply Playlists.');
      gigProfileSearch.focus();
    }

    async function toggleGigProfileMenu(forceOpen = null) {
      state.gigProfileMenuOpen = forceOpen === null ? !state.gigProfileMenuOpen : Boolean(forceOpen);
      gigProfileMenu.hidden = !state.gigProfileMenuOpen;
      renderGigProfileButton();
      if (!state.gigProfileMenuOpen) {
        closeGigProfileSavePanel();
        return;
      }
      state.gigProfileMenuDirty = false;
      const hasAppliedSources = state.gigProfileSelectedIds.size > 0 || Number(state.gigProfile?.sources || 0) > 0;
      state.gigProfileChoosing = LIVE_ASSIST_QUERY.has('popup') && !hasAppliedSources;
      gigProfileSearch.value = '';
      document.getElementById('assist-playlist-settings').open = false;
      await loadGigProfileSources();
      gigProfileSearch.focus();
    }

    async function applyGigProfileSelection(closeMenu = true) {
      if (state.gigProfileChoosing && typeof finishApprovedPlaylistAdd === 'function') { finishApprovedPlaylistAdd(); return; }
      const applyButton = document.getElementById('gig-profile-apply');
      const checkedIds = activeGigProfileSelectedIds();
      state.gigProfileSelectedIds = new Set(checkedIds);
      if (!state.gigProfileEnabledExplicit) state.gigProfileEnabled = checkedIds.length > 0;
      if (!checkedIds.length || !state.gigProfileEnabled) state.gigProfileOnlySelected = false;
      if (LIVE_ASSIST_PREVIEW_MODE) {
        state.gigProfile = {
          ...state.gigProfile, enabled: state.gigProfileEnabled,
          only_selected: state.gigProfileOnlySelected, sources: checkedIds.length,
          source_ids: checkedIds, providers: [...new Set(activeGigProfileSources().filter(source => checkedIds.includes(source.id)).map(source => source.provider))],
        };
        state.gigProfileMenuDirty = false;
        state.gigProfileEnabledExplicit = false;
        renderGigProfileButton();
        setStatus(`Preview: ${checkedIds.length} playlists selected. Your live set is unchanged.`);
        if (closeMenu) await toggleGigProfileMenu(false);
        return;
      }
      applyButton.disabled = true;
      applyButton.textContent = 'Applying...';
      applyButton.classList.add('is-applying');
      try {
        const payload = await fetchJson('/api/performance/gig_profile/selection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_ids: [...state.gigProfileSelectedIds],
            enabled: state.gigProfileEnabled,
            only_selected: state.gigProfileOnlySelected,
            colors_enabled: state.gigProfileColorsEnabled,
            profile_id: state.gigProfileActiveSavedId,
            name: state.gigProfileSavedProfiles.find(profile => profile.id === state.gigProfileActiveSavedId)?.name || '',
          }),
          timeoutMs: 60000,
        });
        state.gigProfile = {
          ...state.gigProfile,
          enabled: Boolean(payload.enabled),
          only_selected: Boolean(payload.only_selected),
          name: String(payload.name || 'Live Crates'),
          sources: payload.source_ids?.length || 0,
          source_ids: payload.source_ids || [],
          providers: payload.providers || [],
          tracks: Number(payload.matched_tracks || 0),
        };
        state.gigProfileSelectedIds = new Set(payload.source_ids || []);
        state.gigProfileEnabled = Boolean(payload.enabled);
        state.gigProfileOnlySelected = Boolean(payload.only_selected && payload.enabled);
        state.gigProfileColorsEnabled = payload.colors_enabled !== false;
        state.gigProfileMenuDirty = false;
        state.gigProfileEnabledExplicit = false;
        renderGigProfileButton();
        setStatus(payload.enabled
          ? (payload.only_selected
            ? `${payload.name} is the only recommendation source with ${payload.matched_tracks || 0} matched tracks.`
            : `${payload.name} added above the usual AXIOM recommendations with ${payload.matched_tracks || 0} matched tracks.`)
          : (payload.source_ids?.length
            ? 'Gig Profile is off. Crate choices are saved and usual AXIOM recommendations remain on.'
            : 'Gig Profile cleared. Usual AXIOM recommendations remain on.'));
        if (closeMenu) await toggleGigProfileMenu(false);
      } catch (error) {
        setStatus(`Gig Profile could not be applied: ${error.message}`, true);
      } finally {
        applyButton.disabled = false;
        applyButton.classList.remove('is-applying');
        applyButton.textContent = 'Apply Playlists';
      }
    }

    window.__AXIOM_TOGGLE_GIG_PROFILE_MENU = toggleGigProfileMenu;
    window.__AXIOM_REFRESH_GIG_PROFILE_SOURCES = refreshGigProfileSources;
    window.__AXIOM_APPLY_GIG_PROFILE_SELECTION = applyGigProfileSelection;

    function liveAssistTrackCleanClassification(track = {}) {
      const raw = track.raw && typeof track.raw === 'object' ? track.raw : {};
      const read = field => {
        const value = Object.prototype.hasOwnProperty.call(track, field) ? track[field] : raw[field];
        if (Array.isArray(value)) return value.join(' ');
        return value == null ? '' : String(value);
      };
      const hasBooleanState = (fields, expected) => fields.some(field => {
        const value = Object.prototype.hasOwnProperty.call(track, field) ? track[field] : raw[field];
        return value === expected;
      });
      const explicitFields = ['explicit', 'is_explicit', 'content_explicit'];
      const cleanFields = ['clean', 'is_clean', 'radio_safe', 'family_safe'];
      const structuredVersion = [
        read('version'),
        read('version_name'),
        read('edit_type'),
        read('mix_name'),
        read('content_rating'),
        read('lyrics_mode'),
        ...explicitFields.map(read),
        ...cleanFields.map(read),
      ].filter(Boolean).join(' ').toLowerCase();
      const visibleVersion = [
        read('title'),
        read('name'),
        read('filename'),
        read('category'),
        read('tags'),
        read('comments'),
      ].filter(Boolean).join(' ').toLowerCase();
      const explicitMarker = /\b(explicit|uncensored|uncut|xxx|adult version)\b/.test(`${structuredVersion} ${visibleVersion}`)
        || /(?:^|[\(\[\{_\-])\s*dirty\s*(?:[\)\]\}_\-]|$)/.test(visibleVersion)
        || /\bdirty\s+(?:edit|version|intro|outro|short|extended)\b/.test(visibleVersion);
      if (hasBooleanState(explicitFields, true) || explicitMarker) return 'explicit';
      const structuredCleanMarker = /\b(clean|radio safe|family safe|censored|all ages)\b/.test(structuredVersion);
      const visibleCleanMarker = /\b(clean\s+(?:edit|version|intro|outro|short|extended)|radio\s+(?:edit|version|clean)|censored|family friendly|all ages)\b/.test(visibleVersion)
        || /(?:^|[\(\[\{_\-])\s*clean\s*(?:[\)\]\}_\-]|$)/.test(visibleVersion);
      if (hasBooleanState(cleanFields, true) || hasBooleanState(explicitFields, false) || structuredCleanMarker || visibleCleanMarker) return 'clean';
      return 'unknown';
    }

    function liveAssistTrackIsVerifiedClean(track = {}) {
      return liveAssistTrackCleanClassification(track) === 'clean';
    }

    function liveAssistEnergyRank(track = {}) {
      const raw = track.raw && typeof track.raw === 'object' ? track.raw : {};
      const text = [
        track.energy,
        raw.energy,
        track.category,
        raw.category,
        track.title,
        raw.title,
        raw.filename,
      ].filter(Boolean).join(' ').toLowerCase();
      if (/\b(peak|high|hype|banger|anthem|club|party|main room|primetime)\b/.test(text)) return 3;
      if (/\b(mid|medium|warm|groove|bounce)\b/.test(text)) return 2;
      if (/\b(low|slow|warmup|chill|cooldown|mellow)\b/.test(text)) return 1;
      return 0;
    }

    function liveAssistGenreText(track = {}) {
      const raw = track.raw && typeof track.raw === 'object' ? track.raw : {};
      return [
        track.genre,
        raw.genre,
        raw.dna_genre,
        raw.root_genre,
        raw.category,
        raw.axiom_role,
      ].filter(Boolean).join(' ').toLowerCase();
    }

    function liveAssistGenreMatches(track = {}, genres = []) {
      const text = liveAssistGenreText(track);
      return genres.some(genre => text.includes(String(genre || '').toLowerCase()));
    }

    function liveAssistComplementaryGenres(genre = '') {
      const text = String(genre || '').toLowerCase();
      if (/\b(rnb|r&b|r n b|soul|slow jam|slowjam)\b/.test(text)) return ['hip hop', 'afro', 'dancehall', 'pop'];
      if (/\b(hip hop|rap|trap|drill|jersey)\b/.test(text)) return ['rnb', 'dancehall', 'afro', 'pop'];
      if (/\b(dancehall|afro|afrobeats|amapiano)\b/.test(text)) return ['hip hop', 'rnb', 'latin', 'pop'];
      if (/\b(house|dance|edm|club|garage)\b/.test(text)) return ['pop', 'latin', 'afro', 'rnb'];
      if (/\b(latin|reggaeton|dembow)\b/.test(text)) return ['dancehall', 'afro', 'hip hop', 'pop'];
      if (/\b(pop|top 40|chart)\b/.test(text)) return ['rnb', 'dance', 'hip hop', 'house'];
      return ['rnb', 'pop', 'dance', 'hip hop'];
    }

    function setLiveAssistDJTrackPosition(position) {
      state.djTrackPosition = position === 'bottom' ? 'bottom' : 'top';
      try { localStorage.setItem(LIVE_ASSIST_DJ_TRACK_POSITION_KEY, state.djTrackPosition); } catch (_) {}
      render();
    }

    function filteredSuggestions() {
      const guidedBpm = asNumber(state.bpmOverride);
      const anchorBpm = liveAssistTempoSourceBpm();
      const targetBpm = guidedBpm
        || (state.tempoIntent === 'half' && anchorBpm ? anchorBpm / 2 : 0)
        || (state.tempoIntent === 'double' && anchorBpm ? anchorBpm * 2 : 0)
        || anchorBpm;
      const liveAnchor = state.anchor?.live_provider || state.anchor?.raw?.live_provider
        || ['djay_live', 'serato_live'].includes(state.anchor?.connected_from || state.anchor?.raw?.connected_from);
      if (liveAnchor && !targetBpm) return [];
      const eligible = state.suggestions
        .map(normalizeTrack)
        .filter(track => track.path && !state.hiddenPaths.has(track.path))
        .filter(track => !trackFamilyHidden(track))
        .filter(track => !state.moreLike || AXIOMLiveAssistSimilarity.matches(track, state.moreLike)
          || AXIOMLiveAssistSimilarity.matchesRoot(track, state.moreLike))
        .filter(track => !state.yearRange || AXIOMLiveAssistSimilarity.matchesRange(track, state.yearRange))
        .filter(track => !state.cleanOnly || liveAssistTrackIsVerifiedClean(track))
        .filter(track => !state.gigProfileOnlySelected || !LIVE_ASSIST_PREVIEW_MODE || track.gigProfile)
        .filter(track => {
          if (!targetBpm) return true;
          return track.bpm > 0 && Math.abs(track.bpm - targetBpm) <= 5;
        })
        .filter(track => state.yearMode !== 'new' || track.year >= 2022)
        .filter(track => state.yearMode !== 'old' || (track.year > 0 && trackYear(state.anchor || {}) > 0 && track.year <= trackYear(state.anchor) - 5))
        .filter(track => !state.minYear || (track.year && track.year >= state.minYear))
        .filter(track => !state.maxYear || (track.year && track.year <= state.maxYear))
        .filter(track => !track.genre || !state.rejectedGenres.has(track.genre.toLowerCase()));
      const seenFamilies = new Set();
      return (state.moreLike ? AXIOMLiveAssistSimilarity.chooseTier(eligible, state.moreLike) : eligible).sort((left, right) => {
          if (state.moreLike) {
            const genre = Number(AXIOMLiveAssistSimilarity.matches(right, state.moreLike))
              - Number(AXIOMLiveAssistSimilarity.matches(left, state.moreLike));
            if (genre) return genre;
            const artist = Number(AXIOMLiveAssistSimilarity.sameArtist(right, state.moreLike))
              - Number(AXIOMLiveAssistSimilarity.sameArtist(left, state.moreLike));
            if (artist) return artist;
          }
          // Source grouping outranks refinements. Each group keeps its own
          // fit/tempo ordering, with DJ tracks together at the chosen end.
          if (left.gigProfile !== right.gigProfile) {
            const djFirst = state.djTrackPosition !== 'bottom';
            return left.gigProfile === djFirst ? -1 : 1;
          }
          if (state.genreFlipGenres.length) {
            const l = liveAssistGenreMatches(left, state.genreFlipGenres) ? 1 : 0;
            const r = liveAssistGenreMatches(right, state.genreFlipGenres) ? 1 : 0;
            if (l !== r) return r - l;
          }
          if (state.energyBoost) {
            const energyDistance = liveAssistEnergyRank(right) - liveAssistEnergyRank(left);
            if (energyDistance) return energyDistance;
          }
          if (targetBpm) {
            const leftDistance = Math.abs((left.bpm || targetBpm) - targetBpm);
            const rightDistance = Math.abs((right.bpm || targetBpm) - targetBpm);
            if (leftDistance !== rightDistance) return leftDistance - rightDistance;
          }
          if (state.preferredDJEra) {
            const l = AXIOMLiveAssistSimilarity.eraFor(left) === state.preferredDJEra ? 1 : 0;
            const r = AXIOMLiveAssistSimilarity.eraFor(right) === state.preferredDJEra ? 1 : 0;
            if (l !== r) return r - l;
          }
          if (state.preferredEra) {
            const l = left.year ? Math.abs(left.year - state.preferredEra - 5) : 9999;
            const r = right.year ? Math.abs(right.year - state.preferredEra - 5) : 9999;
            if (l !== r) return l - r;
          }
          if (!state.preferredGenre) return 0;
          const l = left.genre.toLowerCase() === state.preferredGenre ? 1 : 0;
          const r = right.genre.toLowerCase() === state.preferredGenre ? 1 : 0;
          return r - l;
        }).filter(track => {
          // Defend the actual visible list as well as the main-window pool.
          const keys = [String(track.path || '').toLowerCase(), ...trackFamilyKeys(track)].filter(Boolean);
          if (keys.some(key => seenFamilies.has(key))) return false;
          keys.forEach(key => seenFamilies.add(key));
          return true;
        });
    }

    function selectedSuggestion(rows = filteredSuggestions()) {
      if (state.selectedPlayingTrackKey && state.selectedPlayingTrackKey === playingTrackSelectionKey()) return normalizeTrack(state.anchor);
      return rows.find(track => track.path === state.selectedPath) || null;
    }

    function playingTrackSelectionKey() {
      return state.anchor ? (state.anchor.path || `${state.anchor.title || ''}:${state.anchor.artist || ''}`) : '';
    }

    function moveRecommendationSelection(direction = 1) {
      const rows = filteredSuggestions();
      if (!rows.length) {
        setStatus('No recommendations to move through yet.', true);
        return;
      }
      const currentIndex = rows.findIndex(track => track.path === state.selectedPath);
      const nextIndex = currentIndex < 0
        ? (direction > 0 ? 0 : rows.length - 1)
        : Math.max(0, Math.min(rows.length - 1, currentIndex + direction));
      const nextTrack = rows[nextIndex];
      if (!nextTrack) return;
      state.selectedPath = nextTrack.path;
      state.selectedPlayingTrackKey = '';
      render();
      window.requestAnimationFrame(() => {
        list.querySelector('.track.selected')?.scrollIntoView({
          block: 'nearest',
          inline: 'nearest',
        });
      });
    }

    function renderFeedbackControls(rows = filteredSuggestions()) {
      const playingSelected = Boolean(state.selectedPlayingTrackKey && state.selectedPlayingTrackKey === playingTrackSelectionKey());
      const hasSelection = playingSelected || Boolean(selectedSuggestion(rows));
      assistNowPlaying.classList.toggle('selected', playingSelected);
      document.getElementById('assist-anchor-action').setAttribute('aria-pressed', String(playingSelected));
      ['old-button', 'genre-button', 'like-button', 'energy-button', 'new-button', 'genre-flip-button', 'more-era-button', 'more-genre-button'].forEach(id => {
        const button = document.getElementById(id);
        const canClearActiveState = button?.classList.contains('active') || button?.getAttribute('aria-expanded') === 'true';
        button.disabled = !['energy-button', 'new-button'].includes(id) && !hasSelection && !canClearActiveState;
      });
      document.getElementById('like-plus-button').disabled = false;
    }

    function renderCoachInsightsControl() {
      if (!coachInsightsToggle) return;
      coachInsightsToggle.setAttribute('aria-checked', state.coachInsightsEnabled ? 'true' : 'false');
      const label = coachInsightsToggle.querySelector('b');
      if (label) label.textContent = state.coachInsightsEnabled ? 'On' : 'Off';
      if (!state.coachInsightsEnabled) {
        if (performanceCoachRail) performanceCoachRail.hidden = true;
        postNativeCoachPrompt('hideCoachPrompt');
      }
    }

    function postNativeCoachPrompt(action, title = '', detail = '') {
      const nativeBridge = window.webkit?.messageHandlers?.axiomNative;
      if (!nativeBridge?.postMessage) return false;
      nativeBridge.postMessage({ action, title, detail });
      return true;
    }

    function setCoachInsightsEnabled(enabled) {
      state.coachInsightsEnabled = Boolean(enabled);
      if (!state.coachInsightsEnabled) {
        state.coachPromptUntil = 0;
        if (state.coachPromptTimer) clearTimeout(state.coachPromptTimer);
        state.coachPromptTimer = null;
      }
      try {
        localStorage.setItem(PERFORMANCE_COACH_INSIGHTS_KEY, state.coachInsightsEnabled ? 'on' : 'off');
      } catch (_) {}
      renderCoachInsightsControl();
    }

    function maybeShowPerformanceCoachPrompt() { /* Approved history coach is polled independently. */ }

    function renderAssistRecommendations(markup) {
      // Compare generated markup, not serialized DOM: Maybe Next updates its
      // buttons in place. Tempo/status updates must preserve row focus and scroll.
      if (markup === liveAssistListMarkup) return;
      list.innerHTML = markup;
      liveAssistListMarkup = markup;
    }

    function render() {
      renderCoachInsightsControl();
      renderApprovedAssist();
      pinButton.classList.toggle('active', state.pinned);
      halfButton.classList.toggle('active', state.tempoIntent === 'half');
      doubleButton.classList.toggle('active', state.tempoIntent === 'double');
      halfButton.setAttribute('aria-pressed', String(state.tempoIntent === 'half'));
      doubleButton.setAttribute('aria-pressed', String(state.tempoIntent === 'double'));
      const followingDeck = Boolean(state.bpmContext.live_bpm && !state.bpmContext.manual_bpm && !state.tempoIntent);
      refreshButton.classList.toggle('active', followingDeck);
      refreshButton.setAttribute('aria-pressed', followingDeck ? 'true' : 'false');
      refreshButton.title = followingDeck
        ? `Automatically following deck: ${formatBpm(state.bpmContext.live_bpm)} BPM`
        : 'Return to the current deck tempo; follows automatically when available';
      const activeRange = state.moreLike || state.yearRange;
      const rows = filteredSuggestions();
      const yearDirection = activeRange?.direction || state.yearMode;
      energyButton.classList.toggle('active', yearDirection === 'new');
      energyButton.setAttribute('aria-pressed', String(yearDirection === 'new'));
      newButton.classList.toggle('active', yearDirection === 'old');
      newButton.setAttribute('aria-pressed', String(yearDirection === 'old'));
      ['old', 'new'].forEach(direction => {
        const steps = document.getElementById(`assist-year-${direction}-steps`);
        if (steps) steps.hidden = (activeRange?.navigation || yearDirection) !== direction;
      });
      document.querySelectorAll('[data-assist-year-step]').forEach(button => {
        const years = (activeRange?.span_years || 2) + 1;
        const direction = Number(button.dataset.assistYearStep) < 0 ? 'older' : 'newer';
        button.setAttribute('aria-label', activeRange?.mode === 'era' ? `Move one AXIOM Era ${direction}` : `Move release range ${years} years ${direction}`);
      });
      genreFlipButton.classList.toggle('active', Boolean(state.genreFlipGenres.length));
      document.getElementById('old-button').classList.toggle('active', Boolean(state.minYear));
      document.getElementById('genre-button').classList.toggle('active', Boolean(state.rejectedGenres.size));
      document.getElementById('like-button').classList.toggle('active', Boolean(state.moreLike));
      document.getElementById('like-button').setAttribute('aria-pressed', String(Boolean(state.moreLike)));
      document.getElementById('like-button').title = state.moreLike
        ? `Following ${AXIOMLiveAssistSimilarity.description(state.moreLike)}. Click to turn off.`
        : 'Follow the selected artist and genre using AXIOM’s corrected timeline';
      const similaritySummary = document.getElementById('assist-similarity-summary');
      if (similaritySummary) {
        similaritySummary.hidden = false;
        const rootFallback = state.moreLike?.root && rows.some(track => !AXIOMLiveAssistSimilarity.matches(track, state.moreLike));
        const rangeLabel = rootFallback
          ? `${state.moreLike.artist} first · ${state.moreLike.root} root · ${AXIOMLiveAssistSimilarity.rangeLabel(state.moreLike)} · Few ${state.moreLike.genre} matches`
          : state.moreLike
          ? `Following ${AXIOMLiveAssistSimilarity.description(state.moreLike)}`
          : activeRange ? `${activeRange.mode === 'era' ? 'AXIOM Era' : 'Release years'} ${AXIOMLiveAssistSimilarity.rangeLabel(activeRange)}` : 'Follows AXIOM’s saved song years automatically.';
        document.getElementById('assist-similarity-label').textContent = rangeLabel + (activeRange?.direction === 'new'
          ? ` · Past starting ${activeRange.mode === 'era' ? 'era' : 'range'}: ${AXIOMLiveAssistSimilarity.referenceLabel(activeRange)}` : '');
        const eraOnly=activeRange?.mode==='era';
        document.getElementById('assist-similarity-label').textContent += eraOnly ? ' · Original year unconfirmed' : '';
        document.getElementById('assist-year-lookback').hidden = false;
        document.getElementById('assist-year-span').disabled = eraOnly;
        document.getElementById('assist-year-span').title = eraOnly ? 'Year ranges become available when Health confirms the original year. Using the approved AXIOM Era for now.' : 'Look back from the song’s timeline year';
        document.getElementById('assist-year-span').value = String(activeRange?.span_years || 2);
        document.getElementById('assist-reset-year-range').textContent = activeRange?.mode === 'era' ? 'Reset era' : 'Reset years';
        document.getElementById('assist-reset-year-range').hidden = !activeRange?.navigation;
      }
      document.getElementById('more-era-button').classList.toggle('active', Boolean(state.preferredEra || state.preferredDJEra));
      document.getElementById('more-genre-button').classList.toggle('active', Boolean(state.preferredGenre));
      cleanOnlyButton.classList.toggle('active', state.cleanOnly);
      cleanOnlyButton.setAttribute('aria-pressed', state.cleanOnly ? 'true' : 'false');
      cleanOnlyButton.textContent = state.cleanOnly ? 'Family friendly' : 'Dirty music suggested';
      renderGigProfileButton();

      if (state.selectedPath && !rows.some(track => track.path === state.selectedPath)) state.selectedPath = '';
      renderFeedbackControls(rows);
      if (!state.anchor) {
        assistNowPlaying.hidden = true;
        applyAssistNowPlayingColour(null);
        document.getElementById('assist-anchor-source').textContent = '';
        document.getElementById('assist-anchor-title').textContent = '';
        document.getElementById('assist-anchor-meta').textContent = '';
        renderAssistRecommendations('<div class="empty">Load recommendations in Performance Mode. Live Assist will follow automatically.</div>');
        return;
      }
      assistNowPlaying.hidden = false;
      const anchor = normalizeTrack(state.anchor);
      applyAssistNowPlayingColour(anchor);
      const anchorProvider = String(anchor.raw?.live_provider || anchor.raw?.connected_from || state.gigProfile.live_provider || '').toLowerCase();
      const providerLogo = document.getElementById('assist-provider-logo');
      if (providerLogo) {
        const provider = anchorProvider.includes('djay') ? 'djay' : anchorProvider.includes('serato') ? 'serato' : '';
        providerLogo.hidden = !provider;
        if (provider) {
          providerLogo.src = provider === 'djay' ? '/static/brands/djay-wordmark.png' : '/static/brands/serato-dj-pro.svg';
          providerLogo.alt = provider === 'djay' ? 'djay Pro' : 'Serato DJ Pro';
        }
      }
      document.getElementById('assist-anchor-source').textContent = anchorProvider.includes('djay')
        ? 'Playing now · djay Pro'
        : (anchorProvider.includes('serato') ? 'Playing now · Serato DJ Pro' : 'Playing now');
      document.getElementById('assist-anchor-title').textContent = anchor.title;
      document.getElementById('assist-anchor-meta').textContent = [
        anchor.artist,
        Number(anchor.raw?.native_bpm || anchor.bpm) ? `${formatBpm(anchor.raw?.native_bpm || anchor.bpm)} BPM` : '',
        anchor.genre,
        anchor.era_override ? AXIOMLiveAssistSimilarity.displayPlacement(anchor) : '',
      ].filter(Boolean).join(' · ');
      if (!rows.length) {
        const missingLiveTempo = (state.anchor?.live_provider || state.anchor?.raw?.live_provider
          || ['djay_live', 'serato_live'].includes(state.anchor?.connected_from || state.anchor?.raw?.connected_from))
          && !liveAssistTempoSourceBpm() && !asNumber(state.bpmOverride);
        renderAssistRecommendations(missingLiveTempo
          ? '<div class="empty">Waiting for the current track tempo. Suggestions will resume automatically.</div>'
          : state.moreLike
          ? `<div class="empty">No matching tracks for ${escapeHtml(AXIOMLiveAssistSimilarity.description(state.moreLike))}${state.moreLike.root ? ` or its ${escapeHtml(state.moreLike.root)} root` : ''} at this tempo. Use + / − to move the era or year range, or turn More Like This off.</div>`
          : state.cleanOnly
          ? '<div class="empty">Family Friendly Only is on. No verified clean or radio-safe recommendations fit this live move.</div>'
          : state.gigProfile.enabled && state.gigProfile.only_selected
          ? '<div class="empty">No selected-playlist tracks fit this live move. Adjust Live Crates, BPM, or a refine control.</div>'
          : '<div class="empty">No Performance Mode recommendations in this view. Clear a mini filter or choose another current track in Performance Mode.</div>');
        return;
      }
      let previousGroup = '';
      renderAssistRecommendations(rows.map(track => {
        const group = track.gigProfile ? 'playlist' : 'library';
        const heading = group !== previousGroup && rows.some(row => row.gigProfile)
          ? `<div class="assist-source-heading" data-source-group="${group}">${escapeHtml(group === 'playlist' ? (state.gigProfile.name || 'Selected Playlists') : 'AXIOM Library')}</div>` : '';
        previousGroup = group;
        const providerTone = track.gigProfileProviders.length > 1 ? 'mixed' : (track.gigProfileProviders[0] || '');
        const providerClass = state.gigProfileColorsEnabled && track.gigProfile && providerTone ? ` gig-${providerTone}` : '';
        const artist = String(track.artist || 'Unknown Artist').trim();
        const metaParts = [
          track.bpm ? `${Math.round(track.bpm)} BPM` : '',
          AXIOMLiveAssistSimilarity.displayPlacement(track),
        ].filter(Boolean);
        const genre = String(track.genre || '').trim();
        const metaHtml = [
          ...metaParts.map(part => `<span class="track-meta-part">${escapeHtml(part)}</span>`),
          genre ? `<span class="track-genre-chip" style="--genre-rgb:${genreColourRgb(genre)}">${escapeHtml(genre)}</span>` : '',
        ].filter(Boolean).join('');
        const draggable = isLocalTrackPath(track.path);
        const selected = track.path === state.selectedPath;
        return `
          ${heading}<div role="button" tabindex="0" aria-pressed="${selected ? 'true' : 'false'}" class="track${providerClass}${selected ? ' selected' : ''}" data-source-group="${group}" data-path="${escapeHtml(track.path)}" draggable="${draggable}" title="${draggable ? 'Drag to a DJ deck, or click to select' : 'Select this recommendation'}">
            <button class="song-add" type="button" data-keep-path="${escapeHtml(track.path)}" aria-label="Add ${escapeHtml(track.title)} to Maybe Next">+</button>
            <span class="track-copy">
              <strong class="track-title" title="${escapeHtml(track.title)}">${escapeHtml(track.title)}</strong>
              <span class="track-artist" title="${escapeHtml(artist)}">${escapeHtml(artist)}</span>
              <span class="track-meta-parts">${metaHtml}</span>
            </span>
            ${`<div class="track-fit"><button class="track-reject" type="button" data-reject-path="${escapeHtml(track.path)}" title="Reject this song for this session" aria-label="Reject ${escapeHtml(track.title)}">&times;</button></div>`}
          </div>
        `;
      }).join(''));
      renderAssistKeepButtons();
    }

    async function fetchJson(url, options = {}) {
      const controller = new AbortController();
      const { timeoutMs = 2500, ...fetchOptions } = options;
      let timeout;
      const deadline = new Promise((resolve, reject) => {
        timeout = setTimeout(() => {
          const error = new Error('Live Assist request timed out.');
          error.name = 'TimeoutError';
          // Settle even if WebKit does not deliver the abort rejection.
          reject(error);
          controller.abort();
        }, timeoutMs);
      });
      const request = (async () => {
        const response = await fetch(url, {
          ...fetchOptions,
          signal: controller.signal,
          headers: {
            ...(fetchOptions.headers || {}),
            'Cache-Control': 'no-store',
          },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        // Keep the deadline active through the body read. A stalled snapshot
        // must release state.loading so the next scheduled poll can recover.
        return await response.json();
      })();
      try {
        return await Promise.race([request, deadline]);
      } finally {
        clearTimeout(timeout);
      }
    }

    function suggestionSignature(anchor, suggestions = []) {
      const anchorKey = anchor?.path || `${anchor?.title || ''}:${anchor?.artist || ''}`;
      const suggestionKey = suggestions
        .map(track => `${track.path || track.file_path || track.filename || ''}:${track.title || ''}`)
        .join('|');
      return `${anchorKey}::${suggestions.length}::${suggestionKey}`;
    }

    function stableLiveAssistBpmSignature(value) {
      const bpm = Number(value || 0);
      if (!Number.isFinite(bpm) || bpm <= 0) return '';
      return Number(bpm.toFixed(1));
    }

    function performancePayloadSignature(payload = {}) {
      const anchor = payload.anchor || {};
      const ledger = payload.session_ledger || {};
      const context = payload.bpm_context || {};
      const profile = payload.gig_profile || {};
      return JSON.stringify({
        session: payload.session_version || 1,
        anchor: [anchor.path, anchor.title, anchor.artist, stableLiveAssistBpmSignature(anchor.bpm), anchor.camelot,
          stableLiveAssistBpmSignature(anchor.native_bpm), anchor.genre, anchor.year, anchor.year_estimated, anchor.year_health_state, anchor.era_override, anchor.effective_era, anchor.root, anchor.live_provider, anchor.dj_track_colors],
        suggestions: (payload.suggestions || []).map(track => [
          track.path,
          track.title,
          track.artist,
          stableLiveAssistBpmSignature(track.bpm),
          track.camelot,
          track.fit,
          track.gig_profile,
          track.genre,
          track.year,
          track.year_estimated, track.year_health_state, track.era_override, track.effective_era, track.root,
          track.gig_profile_providers,
        ]),
        rejected: ledger.rejected_families || [],
        played: ledger.played_families || [],
        tempoIntent: payload.tempo_intent || '',
        tempoReset: payload.tempo_reset_version || 0,
        bpm: [
          stableLiveAssistBpmSignature(context.native_bpm),
          stableLiveAssistBpmSignature(context.manual_bpm),
          stableLiveAssistBpmSignature(context.live_bpm),
          stableLiveAssistBpmSignature(context.playing_bpm),
          stableLiveAssistBpmSignature(context.target_bpm),
          context.bpm_source,
        ],
        gigProfile: [
          profile.enabled,
          profile.only_selected,
          profile.id,
          profile.name,
          profile.colors_enabled,
          ...(profile.source_ids || []),
        ],
        nowPlayingColourPreference: payload.now_playing_colour_preference || 'auto',
        gigProfiles: (profile.profiles || []).map(item => [
          item.id,
          item.name,
          ...(item.source_ids || []),
        ]),
        status: payload.status || '',
      });
    }

    function requestPerformanceStateRefresh(version = 0) {
      const incomingVersion = Number(version) || 0;
      if (incomingVersion && incomingVersion <= (state.lastSnapshotVersion || 0)) return;
      if (state.loading) {
        if (incomingVersion) {
          state.snapshotRefreshPendingVersion = Math.max(state.snapshotRefreshPendingVersion || 0, incomingVersion);
        } else state.snapshotRefreshPending = true;
        return;
      }
      return loadPerformanceState();
    }
    window.__AXIOM_REFRESH_ASSIST_STATE = requestPerformanceStateRefresh;

    async function loadPerformanceState() {
      if (LIVE_ASSIST_PREVIEW_MODE) {
        seedLiveAssistPreviewIfNeeded();
        render();
        return;
      }
      if (state.loading) return;
      if (typeof assistDragging !== 'undefined' && assistDragging) { schedulePerformancePoll(); return; }
      if (state.pollTimer) clearTimeout(state.pollTimer);
      state.snapshotRefreshPendingVersion = 0;
      state.loading = true;
      try {
        const payload = await fetchJson(`/api/performance/live_assist/state?t=${Date.now()}`, { cache: 'no-store' });
        if (Number(payload.session_version || 1) < (state.lastSessionVersion || 1)) return;
        if (typeof assistDragging !== 'undefined' && assistDragging) return;
        if (!state.lastSessionVersion && !LIVE_ASSIST_PREVIEW_MODE) {
          const control = await fetchJson('/api/performance/live_assist/control', {cache:'no-store'});
          if (Number(control.session_version || 1) === Number(payload.session_version || 1)) {
            const p = control.assist_preferences || {};
            state.yearMode = ['new','old'].includes(control.year_mode) ? control.year_mode : '';
            state.minYear = Number(p.min_year)||0; state.preferredGenre=p.preferred_genre||'';
            state.moreLike = AXIOMLiveAssistSimilarity.normalize(p.more_like);
            state.yearRange = AXIOMLiveAssistSimilarity.normalizeRange(p.year_range);
            state.similarityMode = 'auto';
            state.preferredDJEra = p.preferred_dj_era || '';
            state.preferredEra=Number(p.preferred_era)||0; state.genreFlipGenres=p.genre_flip||[];
            state.wrongGenreName=p.wrong_genre||''; state.wrongGenrePath=p.wrong_path||'';
            if(state.wrongGenreName)state.rejectedGenres.add(state.wrongGenreName);
            if(state.wrongGenrePath)state.hiddenPaths.add(state.wrongGenrePath);
          }
        }
        const nextVersion = Number(payload.version || 0);
        const payloadSignature = performancePayloadSignature(payload);
        if (payloadSignature === state.lastPayloadSignature) {
          if (nextVersion > state.lastSnapshotVersion) {
            state.lastSnapshotVersion = nextVersion;
            if (state.refreshPending) {
              state.refreshPending = false;
              setStatus('Refresh complete. The strongest fits remained in this order.');
            }
          }
          return;
        }
        const nextAnchor = payload.anchor ? normalizeTrack(payload.anchor) : null;
        const nextPath = nextAnchor?.path || `${nextAnchor?.title || ''}:${nextAnchor?.artist || ''}`;
        const nextSuggestions = Array.isArray(payload.suggestions) ? payload.suggestions : [];
        const nextSignature = suggestionSignature(nextAnchor, nextSuggestions);
        const nextSessionVersion = Number(payload.session_version || 1);
        if (state.lastSessionVersion && nextSessionVersion !== state.lastSessionVersion) {
          state.hiddenPaths.clear();
          state.hiddenFamilies.clear();
          state.playedFamilies.clear();
          state.rejectedGenres.clear();
          state.preferredGenre = '';
          state.moreLike = null;
          state.yearRange = null;
          state.preferredEra = 0;
          state.preferredDJEra = '';
          state.wrongGenrePath = '';
          state.wrongGenreName = '';
          state.genreFlipGenres = [];
          state.minYear = 0;
          state.maxYear = 0;
          state.yearMode = '';
          state.selectedPath = '';
        }
        state.lastSessionVersion = nextSessionVersion;
        const sessionLedger = payload.session_ledger && typeof payload.session_ledger === 'object'
          ? payload.session_ledger
          : {};
        (Array.isArray(sessionLedger.rejected_families) ? sessionLedger.rejected_families : [])
          .forEach(key => state.hiddenFamilies.add(String(key || '').toLowerCase()));
        (Array.isArray(sessionLedger.played_families) ? sessionLedger.played_families : [])
          .forEach(key => state.playedFamilies.add(String(key || '').toLowerCase()));
        if (nextPath !== state.lastLivePath) state.selectedPlayingTrackKey = '';
        state.lastLivePath = nextPath;
        state.lastSuggestionSignature = nextSignature;
        state.refreshPending = false;
        state.anchor = nextAnchor;
        if (nextAnchor) rememberLiveAssistPlayingTrack(nextAnchor);
        state.suggestions = nextSuggestions;
        if(state.moreLike){
          const reference=[nextAnchor,...nextSuggestions].find(track=>track?.path===state.moreLike.path);
          if(reference){
            const updated=AXIOMLiveAssistSimilarity.followMetadata(state.moreLike,reference);
            if(updated!==state.moreLike){state.moreLike=updated;sendSessionFeedback('year_range',{});}
          }
        }
        maybeShowPerformanceCoachPrompt(nextAnchor);
        state.nowPlayingColourPreference = normalizeNowPlayingColourPreference(
          payload.now_playing_colour_preference
        );
        state.bpmContext = payload.bpm_context && typeof payload.bpm_context === 'object'
          ? payload.bpm_context
          : {};
        if (state.bpmContext.manual_bpm) {
          state.bpmOverride = formatBpm(state.bpmContext.manual_bpm);
        }
        state.tempoIntent = ['half', 'double'].includes(payload.tempo_intent) ? payload.tempo_intent : '';
        const nextTempoResetVersion = Number(payload.tempo_reset_version || 0);
        if (nextTempoResetVersion > state.lastTempoResetVersion) {
          state.lastTempoResetVersion = nextTempoResetVersion;
          state.bpmOverride = '';
          state.bpmDraft = '';
        }
        const incomingGigProfile = payload.gig_profile && typeof payload.gig_profile === 'object' ? payload.gig_profile : {};
        if (Array.isArray(incomingGigProfile.profiles)) {
          state.gigProfileProfilesFromPerformance = true;
          loadSavedGigProfiles(incomingGigProfile.profiles);
          const incomingProfileId = String(incomingGigProfile.id || '');
          if (state.gigProfileSavedProfiles.some(profile => profile.id === incomingProfileId)) {
            state.gigProfileActiveSavedId = incomingProfileId;
            renderSavedGigProfiles();
          }
        }
        const incomingSourceIds = Array.isArray(incomingGigProfile.source_ids)
          ? incomingGigProfile.source_ids.filter(Boolean)
          : [];
        const preserveAppliedSelection = state.gigProfileSelectedIds.size > 0 && !incomingSourceIds.length;
        state.gigProfile = preserveAppliedSelection
          ? {
              ...state.gigProfile,
              live_provider: incomingGigProfile.live_provider || state.gigProfile.live_provider || '',
            }
          : incomingGigProfile;
        if (!state.gigProfileMenuDirty) {
          state.gigProfileEnabled = Boolean(state.gigProfile.enabled);
          state.gigProfileOnlySelected = Boolean(state.gigProfile.only_selected && state.gigProfile.enabled);
          state.gigProfileColorsEnabled = state.gigProfile.colors_enabled !== false;
          if (Array.isArray(state.gigProfile.source_ids)) {
            state.gigProfileSelectedIds = new Set(state.gigProfile.source_ids.filter(Boolean));
          }
          if (state.gigProfileMenuOpen) renderGigProfileSources();
        }
        if (state.anchor) {
          const profileCopy = state.gigProfile.enabled && state.gigProfile.name
            ? ` · ${state.gigProfile.name}${state.gigProfile.only_selected ? ' only' : ' on'}`
            : '';
          setStatus((payload.status || `Showing ${state.suggestions.length} Performance Mode recommendations.`) + profileCopy);
        } else if (state.gigProfile.enabled && state.gigProfile.name) {
          const trackCount = Number(state.gigProfile.tracks || 0);
          setStatus(state.gigProfile.only_selected
            ? `${state.gigProfile.name} ready with ${trackCount} matched DJ-library tracks. Only these playlists will be recommended.`
            : `${state.gigProfile.name} ready with ${trackCount} matched DJ-library tracks. Usual AXIOM recommendations stay on.`);
        } else {
          setStatus(payload.status || 'Load Performance Mode recommendations first.', true);
        }
        render();
        // A failed render must retry this snapshot on the next poll.
        state.lastPayloadSignature = payloadSignature;
        state.lastSnapshotVersion = nextVersion;
      } catch (error) {
        setStatus(`Performance Mode snapshot unavailable: ${error.message}`, true);
        render();
      } finally {
        state.loading = false;
        const newerSnapshotPending = (state.snapshotRefreshPendingVersion || 0) > (state.lastSnapshotVersion || 0);
        state.snapshotRefreshPendingVersion = 0;
        if (state.snapshotRefreshPending || newerSnapshotPending) {
          state.snapshotRefreshPending = false;
          if (state.pollTimer) clearTimeout(state.pollTimer);
          state.pollTimer = setTimeout(loadPerformanceState, 0);
        } else schedulePerformancePoll();
      }
    }

    function schedulePerformancePoll() {
      if (state.pollTimer) clearTimeout(state.pollTimer);
      const delay = state.anchor && state.suggestions.length ? 2500 : 1200;
      state.pollTimer = setTimeout(loadPerformanceState, delay);
    }

    function feedbackTrackPayload(track = {}) {
      const normalized = normalizeTrack(track);
      return {
        path: normalized.path,
        title: normalized.title,
        artist: normalized.artist,
        genre: normalized.genre,
        year: normalized.year,
        year_estimated: normalized.year_estimated,
        year_health_state: normalized.year_health_state,
        era_override: normalized.era_override,
        effective_era: normalized.effective_era,
        root: normalized.root,
        bpm: normalized.bpm,
        camelot: normalized.camelot,
      };
    }

    function assistRefinementPreferences() {
      return {min_year:state.minYear,wrong_genre:state.wrongGenreName,wrong_path:state.wrongGenrePath,
        preferred_genre:state.preferredGenre,preferred_era:state.preferredEra,genre_flip:state.genreFlipGenres,
        more_like:state.moreLike || null, year_range:state.yearRange || null,
        grouping_mode:state.similarityMode,preferred_dj_era:state.preferredDJEra || ''};
    }

    async function sendSessionFeedback(action, track) {
      if (!action || LIVE_ASSIST_PREVIEW_MODE) return;
      const soft = !["reject", "played"].includes(action);
      try {
        await fetchJson('/api/performance/live_assist/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_version: state.lastSessionVersion || 1,
            tempo_intent: state.tempoIntent,
            ...(soft ? { year_mode: state.yearMode || '' } : {}),
            ...(soft ? { assist_preferences: assistRefinementPreferences(), refresh_recommendations: true } : {
              feedback_action: action, feedback_track: feedbackTrackPayload(track), family_keys: trackFamilyKeys(track),
            }),
          }),
        });
        postNativeAssistAction('processLiveAssistControl');
      } catch (error) {
        setStatus(`Performance feedback could not be applied: ${error.message}`, true);
      }
    }

    function applySelectedFeedback(action, trackOverride = null) {
      if (action === 'more_like' && state.moreLike) {
        state.moreLike = null;
        sendSessionFeedback(action, {});
        render();
        setStatus('More Like This is off. Artist, genre and year scope cleared.');
        return;
      }
      const track = trackOverride || selectedSuggestion();
      if (!track) {
        if (action === 'too_old' && state.minYear) {
          state.minYear = 0;
          sendSessionFeedback(action, {});
          render();
          setStatus('Too Old is off. Live Assist returned to the normal year range.');
          return;
        }
        if (action === 'wrong_genre' && (state.wrongGenrePath || state.rejectedGenres.size)) {
          if (state.wrongGenreName) state.rejectedGenres.delete(state.wrongGenreName);
          if (state.wrongGenrePath) state.hiddenPaths.delete(state.wrongGenrePath);
          state.wrongGenrePath = '';
          state.wrongGenreName = '';
          sendSessionFeedback(action, {});
          render();
          setStatus('Wrong Genre is off. Hidden genre recommendations can return.');
          return;
        }
        if (action === 'more_genre' && state.preferredGenre) {
          state.preferredGenre = '';
          sendSessionFeedback(action, {});
          render();
          setStatus('More This Genre is off. Live Assist returned to normal genre ranking.');
          return;
        }
        if (action === 'more_era' && (state.preferredEra || state.preferredDJEra)) {
          state.preferredEra = 0;
          state.preferredDJEra = '';
          sendSessionFeedback(action, {});
          render();
          setStatus('More This Era is off. Live Assist returned to normal era ranking.');
          return;
        }
        setStatus('Select Playing Now or a recommendation first.', true);
        return;
      }
      if (action === 'reject') {
        trackFamilyKeys(track).forEach(key => state.hiddenFamilies.add(key));
        state.selectedPath = '';
        setStatus(`${track.title} rejected for this Performance session.`);
      } else if (action === 'too_old') {
        if (state.minYear) {
          state.minYear = 0;
          setStatus('Too Old is off. Live Assist returned to the normal year range.');
        } else {
        state.minYear = Math.max(state.minYear, track.year ? track.year + 1 : new Date().getFullYear() - 15);
        setStatus('Older tracks reduced for this Performance session.');
        }
      } else if (action === 'wrong_genre') {
        const genreKey = track.genre ? track.genre.toLowerCase() : '';
        const isSameWrongGenre = Boolean(state.wrongGenreName || state.wrongGenrePath);
        if (isSameWrongGenre) {
          if (state.wrongGenreName) state.rejectedGenres.delete(state.wrongGenreName);
          if (state.wrongGenrePath) state.hiddenPaths.delete(state.wrongGenrePath);
          state.wrongGenreName = '';
          state.wrongGenrePath = '';
          setStatus('Wrong Genre is off. Hidden genre recommendations can return.');
        } else {
          if (state.wrongGenreName) state.rejectedGenres.delete(state.wrongGenreName);
          if (state.wrongGenrePath) state.hiddenPaths.delete(state.wrongGenrePath);
          if (genreKey) state.rejectedGenres.add(genreKey);
          if (track.path) state.hiddenPaths.add(track.path);
          state.wrongGenreName = genreKey;
          state.wrongGenrePath = track.path || '';
          setStatus(track.genre ? `${track.genre} reduced for this Performance session.` : `${track.title} hidden.`);
        }
      } else if (action === 'more_like') {
        const scope = AXIOMLiveAssistSimilarity.fromTrack(track, state.yearRange?.span_years || 2);
        if (!scope) {
          setStatus('More Like This needs an artist, genre and a usable year or approved AXIOM Era. Review this song in Health.', true);
          return;
        }
        state.moreLike = scope;
        state.yearRange = null;
        // The new scoped range replaces conflicting broad era/genre controls.
        state.preferredGenre = '';
        state.preferredEra = 0;
        state.preferredDJEra = '';
        state.genreFlipGenres = [];
        state.yearMode = '';
        state.minYear = 0;
        state.maxYear = 0;
        setStatus(`Following ${AXIOMLiveAssistSimilarity.description(scope)}. More Old moves this ${scope.mode === 'era' ? 'era group' : 'range'} earlier.`);
      } else if (action === 'more_genre') {
        const genreKey = track.genre ? track.genre.toLowerCase() : '';
        state.moreLike = null;
        if (state.preferredGenre && (!trackOverride || state.preferredGenre === genreKey)) {
          state.preferredGenre = '';
          setStatus('More This Genre is off. Live Assist returned to normal genre ranking.');
        } else {
          state.preferredGenre = genreKey || state.preferredGenre;
          setStatus(action === 'more_genre' && track.genre ? `More ${track.genre}.` : `More like ${track.title}.`);
        }
      } else if (action === 'more_era') {
        state.moreLike = null;
        const decade = track.year ? Math.floor(track.year / 10) * 10 : 0;
        if (state.preferredEra || state.preferredDJEra) {
          state.preferredEra = 0;
          state.preferredDJEra = '';
          setStatus('More This Era is off. Live Assist returned to normal era ranking.');
        } else {
          if (AXIOMLiveAssistSimilarity.eraFor(track)) {
            state.preferredDJEra = AXIOMLiveAssistSimilarity.eraFor(track);
            setStatus(state.preferredDJEra ? `More music from ${AXIOMLiveAssistSimilarity.eraLabel(state.preferredDJEra)}.` : 'Choose this track’s AXIOM Era in Health first.', !state.preferredDJEra);
          } else {
            state.preferredEra = decade;
            setStatus(decade ? `More music from ${decade}s.` : 'Following this track era where release years are available.');
          }
        }
      }
      render();
      sendSessionFeedback(action, track);
    }
