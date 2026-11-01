    let playlistHistory = [];
    let currentPlaylist = [];
    let currentRoutePlaylist = [];
    let activeStudioView = 'manual';
    let bpmChartInstance = null;
    let graphDots = [];
    let anchorTargetDot = null; // single green dot for one-click set generation
    let activeModifiers = {};
	    let activeLibModifiers = {};
	    let modalRootFilter = '';
	    let modalSuggestionSort = 'transition';
	    let modalIntentLane = 'best';
	    let modalShowUsedTracks = false;
    let libRootFilter = '';
    let modalTargetIndex = -1;
    let modalInsertionIndex = -1;
    let selectedSuggestionData = null;
    let sortableList = null;
    let currentAnchorTrack = null;
    let graphModeOpen = false;
    let magicSetStudioCtaReady = false;
    let graphAnchorIndex = -1;
    let magicPointHoverState = null;
    let magicPointHoverHideTimer = null;
    let currentPlayingPath = null;
    let performanceAnchorTrack = null;
    let performanceCuedTrack = null;
    let performanceSuggestions = [];
    let performanceTimeline = [];
    let performanceReceiptPreviewTracks = null;
    let performanceNotes = [];
    let performanceRefineHistory = [];
    let performanceHiddenPaths = new Set();
    let performanceRejectedFamilies = new Set();
    let performanceSessionPlayedFamilies = new Set();
    let performanceRejectedGenres = new Set();
    let performanceRejectedRoots = new Set();
    let performancePreferredGenres = new Set();
    let performancePreferredRoots = new Set();
    let performancePreferredEras = new Set();
    let performanceSelectedSuggestionPath = '';
    let performanceTempoIntent = '';
    let performancePlayingBpmOverride = 0;
    let performancePlayingBpmDraft = '';
    let performanceLaneLock = '';
    let performanceRescueMode = false;
    let performanceSafePicks = false;
    let performanceCleanOnly = false;
    let performanceDigDeeper = false;
    let performanceArtistCooldown = true;
    let performanceExcludeKinds = new Set();
    let performanceFeedbackCounts = {
      choices: 0,
      liked: 0,
      hidden: 0,
      tooOld: 0,
      wrongGenre: 0,
      energyUp: 0,
      energyDown: 0,
      doubleTime: 0,
      halfTime: 0,
      laneLock: 0,
      rescue: 0,
      excludes: 0,
      notes: 0
    };
    let performanceEnergyIntent = '';
    let performanceMinYear = 0;
    let performanceYearMode = '';
    let performanceAssistPreferences = {};
    let performanceTimelineCollapsed = true;
    let performanceSuggestionRequestId = 0;
    let performanceSuggestionAbortController = null;
    let performanceSuggestionShuffleSeed = 0;
    let performanceSuggestionTempo = null;
    let performanceLiveTempoPending = null;
    let performanceGigProfileTrackRequest = null;
    let performanceSessionVersion = 1;
    const PERFORMANCE_COACH_INSIGHTS_KEY = 'axiomPerformanceCoachInsights.v1';
    let performanceCoachInsightsEnabled = localStorage.getItem(PERFORMANCE_COACH_INSIGHTS_KEY) === 'on';
    let performanceReceiptTab = 'session';
    let performanceReceiptRecordId = '';
    let performanceReceiptTimelineExpanded = true;
    let performancePlayingBpmDebounceTimer = null;
    // The visible DJ Auto control remains user-controlled. The native shell
    // also has a separate, persisted fresh-event watcher for Auto Live Assist.
    let performanceSeratoEnabled = false;
    let performanceSeratoPolling = false;
    let performanceSeratoPollingStartedAt = 0;
    let performanceSeratoPollingGeneration = 0;
    let performanceSeratoNextPollAt = 0;
    let performanceLiveTrackRenderSignature = '';
    // The native watcher must catch the first real deck load quickly. These
    // polls only read the bridge; backend fresh_event ownership still decides
    // whether recommendations and Live Assist may update.
    const PERFORMANCE_LIVE_POLL_ACTIVE_MS = 500;
    const PERFORMANCE_LIVE_POLL_WAITING_MS = 500;
    const PERFORMANCE_LIVE_POLL_IDLE_MS = 12000;
    let performanceSeratoLastKey = '';
    let performanceLiveTrackIdentityKey = '';
    let performanceLiveTrackLoadMarker = '';
    let performanceSeratoLastTrack = null;
    let performanceLiveTrackStartedAt = 0;
    let performanceLiveTrackQualifiedKey = '';
    const PERFORMANCE_PLAYED_THRESHOLD_SECONDS = 60;
    let performanceSeratoPollTimer = null;
    let performanceLiveSourceLabel = 'DJ software';
    let performanceLiveProvider = '';
    let performanceNativeLastControlPollAt = 0;
    const PERFORMANCE_NATIVE_CONTROL_POLL_MS = 2500;
    const PERFORMANCE_AUTO_LIVE_ASSIST_KEY = 'axiomPerformanceAutoLiveAssist.v1';
    const PERFORMANCE_NOW_PLAYING_COLOUR_KEY = 'axiomPerformanceNowPlayingColour.v1';
    const PERFORMANCE_LAYOUT_KEY = 'axiomPerformanceLayout.v1';
    const PERFORMANCE_COMPACT_MAX_WIDTH = 1512;
    const PERFORMANCE_COMPACT_MAX_HEIGHT = 900;
    const PERFORMANCE_LIVE_ASSIST_OPEN_ACK_TIMEOUT_MS = 2200;
    const PERFORMANCE_LIVE_ASSIST_OPEN_MAX_ATTEMPTS = 3;
    let performanceAutoLiveAssistDjSessionToken = '';
    let performanceAutoLiveAssistOpenedEventId = '';
    let performanceLayoutResizeFrame = 0;

    function performanceLayoutPreference() {
      const stored = String(localStorage.getItem(PERFORMANCE_LAYOUT_KEY) || 'auto').trim().toLowerCase();
      return ['auto', 'full', 'compact'].includes(stored) ? stored : 'auto';
    }

    function performanceLayoutShouldCompact() {
      const viewportWidth = Math.round(window.visualViewport?.width || window.innerWidth || document.documentElement.clientWidth || 0);
      const viewportHeight = Math.round(window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 0);
      return viewportWidth <= PERFORMANCE_COMPACT_MAX_WIDTH || viewportHeight <= PERFORMANCE_COMPACT_MAX_HEIGHT;
    }

    function applyPerformanceLayoutPreference() {
      const preference = performanceLayoutPreference();
      const compact = preference === 'compact' || (preference === 'auto' && performanceLayoutShouldCompact());
      const resolved = compact ? 'compact' : 'full';
      const performanceTab = document.getElementById('tab-content-performance');
      const switcher = document.getElementById('performance-layout-switch');

      document.body.classList.toggle('performance-layout-compact', compact);
      document.body.classList.toggle('performance-layout-full', !compact);
      performanceTab?.classList.toggle('performance-layout-compact', compact);
      performanceTab?.classList.toggle('performance-layout-full', !compact);
      performanceTab?.setAttribute('data-performance-layout-preference', preference);
      performanceTab?.setAttribute('data-performance-layout-resolved', resolved);

      if (switcher) {
        switcher.dataset.resolved = resolved;
        switcher.setAttribute('aria-label', `Performance layout. ${preference === 'auto' ? `Auto selected, currently ${resolved}` : `${resolved} selected`}.`);
      }

      document.querySelectorAll('[data-performance-layout]').forEach(button => {
        const active = button.dataset.performanceLayout === preference;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
        if (button.dataset.performanceLayout === 'auto') {
          button.title = `Auto is using ${resolved} view`;
        }
      });

      return resolved;
    }

    function performanceSetLayoutPreference(mode = 'auto') {
      const preference = ['auto', 'full', 'compact'].includes(String(mode).toLowerCase())
        ? String(mode).toLowerCase()
        : 'auto';
      localStorage.setItem(PERFORMANCE_LAYOUT_KEY, preference);
      const resolved = applyPerformanceLayoutPreference();
      showToast(`Performance view: ${preference === 'auto' ? `Auto (${resolved})` : resolved}.`);
    }

    function performanceHandleLayoutResize() {
      if (performanceLayoutPreference() !== 'auto') return;
      cancelAnimationFrame(performanceLayoutResizeFrame);
      performanceLayoutResizeFrame = requestAnimationFrame(applyPerformanceLayoutPreference);
    }

    window.addEventListener('resize', performanceHandleLayoutResize, { passive: true });
    window.visualViewport?.addEventListener('resize', performanceHandleLayoutResize, { passive: true });
    let performanceAutoLiveAssistPendingEventId = '';
    let performanceAutoLiveAssistSuppressedSessionToken = '';
    let performanceAutoLiveAssistWindowOpen = false;
    let performanceLiveAssistOpenRequestSerial = 0;
    const performanceLiveAssistOpenRequests = new Map();
    let performanceGigProfiles = [];
    let performanceGigProfileId = '';
    let performanceGigProfileEnabled = false;
    let performanceGigProfileOnlySelected = false;
    let performanceGigProfileColorsEnabled = true;
    let performanceGigProfileTrackCache = [];
    let performanceGigProfileKeys = new Set();
    let performanceGigProfileTrackCacheId = '';
    let performanceDjProfileSources = [];
    let performanceDjProfileSourcesLoaded = false;
    let performanceDjProfileSourcesLoading = false;
    let performanceDjProfileSourcesPromise = null;
    let performanceDjProfileSourcesError = '';
    let performanceGigProfileControlVersion = 0;
    let performanceGigProfileControlPollTimer = null;
    let performanceGigProfileControlApplying = false;
    let performanceLiveAssistControlVersion = 0;
    let performanceLiveAssistControlPolling = false;
    let performanceLiveAssistControlPollStartedAt = 0;
    let performanceLiveAssistControlPollGeneration = 0;
    let performanceLiveAssistRefreshVersion = 0;
    let performanceLiveAssistResetBaselineVersion = 0;
    let performanceLiveAssistTargetBpmVersion = 0;
    let performanceTempoResetVersion = 0;
    const PERFORMANCE_GIG_PROFILES_STORAGE_KEY = 'axiomPerformanceGigProfiles';
    const PERFORMANCE_GIG_PROFILE_ACTIVE_KEY = 'axiomPerformanceGigProfileActive';
    const PERFORMANCE_GIG_PROFILE_COLORS_KEY = 'axiomPerformanceGigProfileColors';
    const PERFORMANCE_LIVE_CRATES_PROFILE_ID = 'gig-live-assist-crates';
    const trackVisualCache = new Map();
    const libraryPreparationCompletedScanEvents = new Set();
    let libraryPreparationLastVisualCompletionAt = 0;
    let libOffset = 0;
    let modalOffset = 0;
    let libSuggestionRequestId = 0;
    let modalSuggestionRequestId = 0;
    let modalSuggestionRotationStep = 0;
    let matchingAnchorIntroActive = false;
    let matchingResultsRevealTimer = null;
    const MATCHING_ANCHOR_INTRO_KEY = 'axiomMatchingAnchorIntroSeen';
    const modalLockedSuggestions = new Map();
    const modalSkippedSuggestionPaths = new Set();
    const DEFAULT_SET_BRIEF = Object.freeze({
      enabled: false,
      intention: 'party',
	      purpose: 'live_set',
	      duration: 60,
	      energyJourney: 'build',
	      era: 'All',
	      planningStyle: 'guided',
	      audience: 'mixed_adult',
	      setting: 'club',
	      lyrics: 'clean_preferred',
	      soundFocus: 'open_format'
	    });
    const BUILD_THE_NIGHT_PRESETS = Object.freeze({
      party: {
        intention: 'party',
	    purpose: 'live_set',
        duration: 60,
        energyJourney: 'build',
        planningStyle: 'guided',
        audience: 'mixed_adult',
        setting: 'club',
        lyrics: 'clean_preferred',
        soundFocus: 'open_format',
        era: 'All'
      },
	      wedding: {
	        intention: 'wedding',
	        purpose: 'live_set',
	        duration: 90,
	        energyJourney: 'waves',
	        planningStyle: 'guided',
	        audience: 'all_ages',
	        setting: 'wedding',
	        lyrics: 'clean_preferred',
	        soundFocus: 'classic_wedding',
	        era: 'All'
	      },
      open_format: {
        intention: 'open_format',
	    purpose: 'live_set',
        duration: 90,
        energyJourney: 'stay_up',
        planningStyle: 'guided',
        audience: 'under_40',
        setting: 'club',
        lyrics: 'explicit_allowed',
        soundFocus: 'urban_electronic_top40',
        era: 'All'
      },
      family_friendly: {
        intention: 'family_friendly',
        purpose: 'live_set',
        duration: 90,
        energyJourney: 'build',
        planningStyle: 'guided',
        audience: 'all_ages',
        setting: 'corporate',
        lyrics: 'clean_only',
        soundFocus: 'open_format',
        era: 'All'
      },
      global: {
        intention: 'global',
        purpose: 'live_set',
        duration: 90,
        energyJourney: 'waves',
        planningStyle: 'guided',
        audience: 'mixed_adult',
        setting: 'private_party',
        lyrics: 'clean_preferred',
        soundFocus: 'global',
        era: 'All'
      },
      club_peak: {
        intention: 'club_peak',
        duration: 60,
        energyJourney: 'finish_strong',
        planningStyle: 'guided',
        audience: 'adult_18',
        setting: 'club',
        lyrics: 'after_dark',
        soundFocus: 'electronic_top40',
        era: 'All'
      },
      youtube: {
        intention: 'youtube',
        duration: 60,
        energyJourney: 'build',
        planningStyle: 'fixed',
        audience: 'mixed_adult',
        setting: 'youtube',
        lyrics: 'clean_preferred',
        soundFocus: 'youtube_series',
        era: 'All'
      }
    });
    let currentSetBrief = { ...DEFAULT_SET_BRIEF };
    const LIBRARY_BRIEF_SETUP_KEY = 'axiomLibraryBriefSetupExpandedV1';
    let libraryBriefSetupExpanded = localStorage.getItem(LIBRARY_BRIEF_SETUP_KEY) === 'true';
    let libraryBriefActivePanel = libraryBriefSetupExpanded ? 'setup' : '';
    let libraryBriefPanelHideTimer = null;
    let libraryBriefSetupCloseTimer = null;
    let libraryPreparationCloseTimer = null;
    let libraryMatchingSongsMotionTimer = null;
    let setBriefEditingExisting = false;
    let setBriefEditSnapshot = null;
    let setBriefProofTimer = null;
    let setBriefProofRequestId = 0;
    let crateReadRequestId = 0;
    let latestCrateRead = null;

    // ========== GENRE BRAIN v2 (FULL) ==========
    const GENRE_BRAIN = {
      // Urban Pillar
      "ratchet": { pillar: "URBAN-WEAPON", root: "Urban", velocity: "Z-10", texture: "Dangerous", energy: "Peak" },
      "trap": { pillar: "URBAN-WEAPON", root: "Urban", velocity: "Z-09", texture: "Dangerous", energy: "Peak" },
      "west coast": { pillar: "URBAN-WEAPON", root: "Urban", velocity: "Z-08", texture: "Matte", energy: "Peak" },
      "jersey": { pillar: "URBAN-WEAPON", root: "Urban", velocity: "Z-08", texture: "Metallic", energy: "Peak" },
      "jeresy": { pillar: "URBAN-WEAPON", root: "Urban", velocity: "Z-08", texture: "Metallic", energy: "Peak", typo: "jersey" },
      "poly rap": { pillar: "URBAN-WEAPON", root: "Urban", velocity: "Z-08", texture: "Matte", energy: "Peak" },

      "rnb rap": { pillar: "URBAN-HYBRID", root: "Urban", velocity: "Z-06", texture: "Glossy", energy: "Mid" },
      "crossover": { pillar: "URBAN-HYBRID", root: "Urban", velocity: "Z-07", texture: "Glossy", energy: "Mid" },

      "rnb": { pillar: "URBAN-SMOOTH", root: "Urban", velocity: "Z-03", texture: "Matte", energy: "Low" },
      "alternative rnb": { pillar: "URBAN-SMOOTH", root: "Urban", velocity: "Z-04", texture: "Glossy", energy: "Low" },
      "funk": { pillar: "URBAN-SMOOTH", root: "Urban", velocity: "Z-04", texture: "Glossy", energy: "Low" },
      "gospel": { pillar: "URBAN-SMOOTH", root: "Urban", velocity: "Z-01", texture: "Matte", energy: "Low" },

      // Pop Pillars
      "top 40": { pillar: "POP-HYBRID", root: "Pop", velocity: "Z-06", texture: "Glossy", energy: "Mid" },
      "pop": { pillar: "POP-HYBRID", root: "Pop", velocity: "Z-06", texture: "Glossy", energy: "Mid" },
      "dance pop": { pillar: "POP-WEAPON", root: "Pop", velocity: "Z-08", texture: "Metallic", energy: "Peak" },
      "pop rap": { pillar: "POP-HYBRID", root: "Pop", velocity: "Z-05", texture: "Matte", energy: "Mid" },
      "pop ballad": { pillar: "POP-SMOOTH", root: "Pop", velocity: "Z-02", texture: "Warm", energy: "Low" },
      "synthpop": { pillar: "POP-WEAPON", root: "Pop", velocity: "Z-07", texture: "Glossy", energy: "Peak" },
      "britpop": { pillar: "POP-HYBRID", root: "Pop", velocity: "Z-05", texture: "Matte", energy: "Mid" },
      "k-pop": { pillar: "POP-WEAPON", root: "Pop", velocity: "Z-08", texture: "Metallic", energy: "Peak" },

      // Global Pillar
      "afro house": { pillar: "AFRO", root: "Global", velocity: "Z-08", texture: "Matte", energy: "Peak" },
      "afrohouse": { pillar: "AFRO", root: "Global", velocity: "Z-08", texture: "Matte", energy: "Peak", typo: "afro house" },
      "amapiano": { pillar: "AFRO", root: "Global", velocity: "Z-06", texture: "Matte", energy: "Mid" },
      "shatta": { pillar: "AFRO", root: "Global", velocity: "Z-07", texture: "Organic", energy: "Mid" },

      "moombahton": { pillar: "MOOMBAH", root: "Global", velocity: "Z-08", texture: "Neon", energy: "Peak" },
      "moombah": { pillar: "MOOMBAH", root: "Global", velocity: "Z-08", texture: "Neon", energy: "Peak" },
      "baile": { pillar: "MOOMBAH", root: "Global", velocity: "Z-07", texture: "Glossy", energy: "Mid" },
      "latin": { pillar: "MOOMBAH", root: "Global", velocity: "Z-06", texture: "Glossy", energy: "Mid" },

      "reggae": { pillar: "ISLAND", root: "Global", velocity: "Z-03", texture: "Warm", energy: "Low" },
      "island reggae": { pillar: "ISLAND", root: "Global", velocity: "Z-04", texture: "Organic", energy: "Low" },
      "reggae-nz": { pillar: "ISLAND", root: "Global", velocity: "Z-04", texture: "Organic", energy: "Low" },
      "reggae-fob": { pillar: "ISLAND", root: "Global", velocity: "Z-04", texture: "Organic", energy: "Low" },
      "samoa": { pillar: "ISLAND", root: "Global", velocity: "Z-04", texture: "Warm", energy: "Low" },
      "tonga": { pillar: "ISLAND", root: "Global", velocity: "Z-04", texture: "Warm", energy: "Low" },
      "poly": { pillar: "ISLAND", root: "Global", velocity: "Z-04", texture: "Warm", energy: "Low" },
      "island rnb": { pillar: "ISLAND", root: "Global", velocity: "Z-05", texture: "Glossy", energy: "Mid" },

      "punjabi": { pillar: "WORLD-TECH", root: "Global", velocity: "Z-08", texture: "Metallic", energy: "Peak" },
      "arab": { pillar: "WORLD-TECH", root: "Global", velocity: "Z-07", texture: "Metallic", energy: "Mid" },
      "asian": { pillar: "WORLD-TECH", root: "Global", velocity: "Z-06", texture: "Metallic", energy: "Mid" },
      "thailand song": { pillar: "WORLD-TECH", root: "Global", velocity: "Z-06", texture: "Metallic", energy: "Mid" },

      // Electronic Pillar
      "edm": { pillar: "ELECTRO-PEAK", root: "Electronic", velocity: "Z-10", texture: "Metallic", energy: "Peak" },
      "drum n bass": { pillar: "ELECTRO-PEAK", root: "Electronic", velocity: "Z-10", texture: "Sharp", energy: "Peak" },
      "riddim": { pillar: "ELECTRO-PEAK", root: "Electronic", velocity: "Z-09", texture: "Dangerous", energy: "Peak" },

      "house": { pillar: "ELECTRO-FLOW", root: "Electronic", velocity: "Z-07", texture: "Glossy", energy: "Mid" },
      "nu disco": { pillar: "ELECTRO-FLOW", root: "Electronic", velocity: "Z-06", texture: "Chrome", energy: "Mid" },
      "garage": { pillar: "ELECTRO-FLOW", root: "Electronic", velocity: "Z-08", texture: "Metallic", energy: "Peak" },

      "deep house": { pillar: "ELECTRO-LOW", root: "Electronic", velocity: "Z-04", texture: "Deep Black", energy: "Low" },
      "indie": { pillar: "ELECTRO-LOW", root: "Electronic", velocity: "Z-02", texture: "Matte", energy: "Low" },

      // Utility Pillar
      "opener": { pillar: "INIT", root: "Utility", velocity: "INIT", texture: "Matte", energy: "Low" },
      "set starter": { pillar: "INIT", root: "Utility", velocity: "INIT", texture: "Matte", energy: "Low" },
      "transition": { pillar: "BRIDGE", root: "Utility", velocity: "BRIDGE", texture: "Metallic", energy: "Mid" },
      "tools": { pillar: "BRIDGE", root: "Utility", velocity: "BRIDGE", texture: "Metallic", energy: "Mid" },
      "tool": { pillar: "BRIDGE", root: "Utility", velocity: "BRIDGE", texture: "Metallic", energy: "Mid" },
      "sound fx": { pillar: "SIGNAL", root: "Utility", velocity: "SIGNAL", texture: "Glossy", energy: "Mid" },
      "fx": { pillar: "SIGNAL", root: "Utility", velocity: "SIGNAL", texture: "Glossy", energy: "Mid" },
      "stinger": { pillar: "SIGNAL", root: "Utility", velocity: "SIGNAL", texture: "Glossy", energy: "Mid" }
    };

    function getGenreBrain(genreStr) {
      if (!genreStr) return null;
      const normalized = genreStr.toLowerCase().trim();
      if (normalized.includes("alternative rnb")) return GENRE_BRAIN["alternative rnb"];
      if (GENRE_BRAIN[normalized]) return GENRE_BRAIN[normalized];
      const matchedKey = Object.keys(GENRE_BRAIN)
        .sort((a, b) => b.length - a.length)
        .find(key => normalized.includes(key));
      return matchedKey ? GENRE_BRAIN[matchedKey] : null;
    }

    // Build pillar → root reverse lookup from GENRE_BRAIN
    const PILLAR_ROOT_MAP = {};
    for (const entry of Object.values(GENRE_BRAIN)) {
      if (entry.pillar && entry.root) PILLAR_ROOT_MAP[entry.pillar] = entry.root;
    }

    // Get root from a track/suggestion object. The cache and studio API do not
    // always agree on metadata names, so normalize every known source.
    function getRootFromSuggestion(s) {
      if (!s) return null;
      const directRoot = s.dna_root || s.root || s.dnaRoot;
      if (directRoot) return String(directRoot).trim();

      const pillar = s.dna_pillar || s.pillar || s.dnaPillar;
      if (pillar && PILLAR_ROOT_MAP[String(pillar).trim()]) return PILLAR_ROOT_MAP[String(pillar).trim()];

      const b = getGenreBrain(s.genre || s.dna_genre || s.category);
      if (b) return b.root;

      const haystack = `${s.genre || ''} ${s.folder || ''} ${s.path || ''} ${s.filename || ''} ${s.title || ''}`.toLowerCase();
      const pathRootTokens = {
        Urban: ['hip hop', 'rnb', 'r&b', 'rap', 'funk', 'gospel', 'ratchet', 'trap'],
        Global: ['african', 'afro', 'amapiano', 'latin', 'reggae', 'dancehall', 'moomba', 'baile', 'punjabi', 'island', 'poly', 'arab', 'asian'],
        Electronic: ['edm', 'house', 'techno', 'garage', 'drum n bass', 'dnb', 'electronic', 'nu disco', 'deep house'],
        Pop: ['top 40', 'pop', 'dance pop', 'pop rap', 'pop ballad', 'synthpop', 'britpop', 'k-pop'],
        Utility: ['opener', 'starter', 'transition', 'tool', 'tools', 'sound fx', 'stinger', 'utility']
      };

      for (const [root, tokens] of Object.entries(pathRootTokens)) {
        if (tokens.some(token => haystack.includes(token))) return root;
      }

      return null;
    }

    function filterByRoot(items, rootFilter) {
      if (!rootFilter) return items;
      const wanted = rootFilter.toLowerCase();
      return items.filter(item => {
        const root = getRootFromSuggestion(item);
        return root && root.toLowerCase() === wanted;
      });
    }

    function getEnergyClass(energy) {
      switch(energy) {
        case 'Peak': return 'energy-Peak';
        case 'Mid': return 'energy-Mid';
        case 'Low': return 'energy-Low';
        default: return 'energy-Unknown';
      }
    }

    // AXIOM SESSION MEMORY
    let previewedTracks = new Set();
    let smartLinksFontScale = 1;

    let mainSearchResults = [];
    let studioSearchResults = [];
    let savedPlaylists = [];
    let selectedPlaylistId = null;
    let editingPlaylistId = null;
    let playlistListenIndex = -1;
    const PLAYLISTS_STORAGE_KEY = 'axiomSavedPlaylists';
    const EXPORT_HISTORY_STORAGE_KEY = 'axiomBrowserExportHistory';

    // -- Favorites --
    let favoritesTracks = [];
    const FAVORITES_STORAGE_KEY = 'axiomFavorites';

    const audioEl = document.getElementById('main-player');
    let nativePlayerState = { has_track: false, playing: false, current_time: 0, duration: 0, path: '', deck: 'main', ended: false };
    let nativePlayerPoll = null;
    let nativeEndedHandledForPath = '';
    let nativeTransportCommandToken = 0;
    let nativeTransportPending = null;

    // -- Utilities --
