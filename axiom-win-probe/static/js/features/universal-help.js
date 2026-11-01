(function () {
  'use strict';

  const HELP_LOG_KEY = 'axiomHelpSearchLog.v1';
  const HELP_LOG_LIMIT = 40;
  const LITE_HIDDEN_HELP_FEATURES = new Set(['performance', 'djay-export']);
  const LITE_PRO_INFO_FEATURE = {
    id: 'lite-pro-info',
    surface: 'AXIOM Pro',
    title: 'Learn About AXIOM Pro',
    description: 'Performance, Live Assist, DAW tools, and direct djay Pro export are included in AXIOM Pro.',
    actionLabel: 'Open Pro Features',
    phrases: ['performance mode', 'live assist', 'export to djay', 'send to djay', 'djay pro handoff', 'daw tools'],
    keywords: ['performance', 'live', 'assist', 'djay', 'algoriddim', 'daw', 'recording', 'broadcast'],
    action: 'lite-pro-info'
  };
  let activeHelpSurface = '';
  const HELP_FEATURES = [
    {
      id: 'room-rescue',
      surface: 'Studio',
      title: 'Find Music For This Event',
      description: 'Choose the type of gig and what the room needs now. AXIOM finds five real songs to start from.',
      actionLabel: 'Open Room Rescue',
      phrases: ['what music fits', 'music for an event', 'what should i play', 'not sure what to play', 'need music for', 'figure out what music'],
      keywords: ['event', 'gig', 'wedding', 'nightclub', 'crowd', 'room', 'curation', 'curate', 'vibe', 'music fits', 'djing'],
      action: 'room-rescue'
    },
    {
      id: 'library-search',
      surface: 'Library',
      title: 'Find A Song In My Library',
      description: 'Search your connected music by title, artist, era, genre, BPM, key, or folder.',
      actionLabel: 'Open Library Search',
      phrases: ['find a song', 'search my music', 'look for a track', 'find music in my library'],
      keywords: ['find', 'search', 'song', 'track', 'artist', 'library', 'folder'],
      action: 'library-search'
    },
    {
      id: 'matching-songs',
      surface: 'Library',
      title: 'Find Songs That Mix Together',
      description: 'Use a selected song as the anchor and see compatible choices for what could play next.',
      actionLabel: 'Open Matching Songs',
      phrases: ['songs that mix', 'what goes next', 'matching songs', 'similar songs', 'works with this song'],
      keywords: ['match', 'matching', 'compatible', 'transition', 'next song', 'mix together'],
      action: 'matching-songs'
    },
    {
      id: 'magic-set',
      surface: 'Studio',
      title: 'Draft A Complete Set',
      description: 'Use Magic Set to build a full BPM and energy journey, then refine the result in Studio.',
      actionLabel: 'Open Magic Set',
      phrases: ['build a full set', 'make a whole set', 'create a dj set', 'magic set', 'automatic set'],
      keywords: ['full set', 'whole set', 'automatic', 'journey', 'setlist', 'magic'],
      action: 'magic-set'
    },
    {
      id: 'studio-build',
      surface: 'Studio',
      title: 'Build Or Reorder A Set',
      description: 'Add tracks, drag the order, inspect the flow, and save the working set.',
      actionLabel: 'Open Studio',
      phrases: ['build a set', 'reorder my set', 'change track order', 'organize my set'],
      keywords: ['build', 'reorder', 'arrange', 'sequence', 'flow', 'set'],
      action: 'studio'
    },
    {
      id: 'cue-points',
      surface: 'Studio',
      title: 'Prepare Cue Points',
      description: 'Open Studio to inspect matching-song mix moments and prepare cue information for supported DJ handoffs.',
      actionLabel: 'Open Studio',
      phrases: ['add cue points', 'make cue points', 'prepare cue points', 'hot cues'],
      keywords: ['cue', 'cues', 'cuepoint', 'cuepoints', 'hotcue', 'mix point'],
      action: 'studio'
    },
    {
      id: 'health-analysis',
      surface: 'Health',
      title: 'Fix Missing BPM Or Key',
      description: 'Scan for trusted BPM and Camelot key information. Unresolved tracks stay clearly unresolved.',
      actionLabel: 'Open Health',
      phrases: ['missing bpm', 'missing key', 'scan bpm', 'scan key', 'wrong bpm', 'wrong key'],
      keywords: ['bpm', 'tempo', 'camelot', 'key', 'analysis', 'analyze', 'analyse'],
      action: 'health'
    },
    {
      id: 'health-metadata',
      surface: 'Health',
      title: 'Fix Years, Titles Or Artists',
      description: 'Review release years and title or artist cleanup before applying changes inside AXIOM.',
      actionLabel: 'Open Metadata Health',
      phrases: ['fix release years', 'fix titles', 'fix artist names', 'clean metadata', 'missing year', 'unknown artist'],
      keywords: ['year', 'years', 'title', 'titles', 'artist', 'artists', 'metadata', 'cleanup', 'unknown'],
      action: 'health'
    },
    {
      id: 'duplicates',
      surface: 'Health',
      title: 'Find Duplicate Tracks',
      description: 'Compare likely duplicate files in Health before choosing what should be kept or removed.',
      actionLabel: 'Open Duplicate Resolver',
      phrases: ['find duplicates', 'duplicate songs', 'same song twice', 'remove duplicates'],
      keywords: ['duplicate', 'duplicates', 'copies', 'twice', 'dedupe'],
      action: 'health'
    },
    {
      id: 'playlists',
      surface: 'Playlists',
      title: 'Open A Saved Set',
      description: 'Find saved sets, favourites, and Download Later tracks in Playlists.',
      actionLabel: 'Open Playlists',
      phrases: ['saved set', 'saved playlist', 'open my playlist', 'find my set'],
      keywords: ['playlist', 'playlists', 'saved', 'favourites', 'favorites', 'download later'],
      action: 'playlists'
    },
    {
      id: 'performance',
      surface: 'Performance',
      title: 'Get Live Next-Song Recommendations',
      description: 'Use the installed app to follow your deck BPM and get compatible options while playing.',
      actionLabel: 'Open Performance',
      phrases: ['what should i play next live', 'live recommendations', 'follow deck bpm', 'help during a gig', 'live assist'],
      keywords: ['performance', 'live', 'deck', 'playing now', 'recommendation', 'rescue'],
      action: 'performance'
    },
    {
      id: 'serato-export',
      surface: 'Export',
      title: 'Send A Set To Serato',
      description: 'Open the Serato handoff and review exactly what AXIOM will export.',
      actionLabel: 'Open Serato Handoff',
      phrases: ['export to serato', 'send to serato', 'serato crate'],
      keywords: ['serato', 'crate', 'handoff'],
      action: 'export-serato'
    },
    {
      id: 'djay-export',
      surface: 'Export',
      title: 'Send A Set To djay Pro',
      description: 'Open the djay Pro handoff and review the playlist delivery options.',
      actionLabel: 'Open djay Pro Handoff',
      phrases: ['export to djay', 'send to djay', 'djay pro playlist'],
      keywords: ['djay', 'algoriddim', 'handoff'],
      action: 'export-djay'
    },
    {
      id: 'rekordbox-export',
      surface: 'Export',
      title: 'Export For Rekordbox',
      description: 'Open the Rekordbox XML handoff and review the export before creating it.',
      actionLabel: 'Open Rekordbox Handoff',
      phrases: ['export to rekordbox', 'send to rekordbox', 'rekordbox xml'],
      keywords: ['rekordbox', 'xml', 'handoff'],
      action: 'export-rekordbox'
    },
    {
      id: 'connect-music',
      surface: 'Library',
      title: 'Connect My Music',
      description: 'Choose a music folder or supported DJ library so AXIOM can see your tracks.',
      actionLabel: 'Choose Music Source',
      phrases: ['add my music', 'connect my library', 'choose music source', 'import my tracks'],
      keywords: ['connect', 'import', 'add music', 'source', 'scan folder'],
      action: 'connect-music'
    }
  ];

  const STOP_WORDS = new Set(['a', 'an', 'and', 'are', 'can', 'do', 'for', 'how', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'the', 'this', 'to', 'want', 'with']);

  function isLiteHelpEdition() {
    return typeof isAxiomLite === 'function' && isAxiomLite();
  }

  function availableHelpFeatures() {
    return isLiteHelpEdition()
      ? [...HELP_FEATURES.filter(feature => !LITE_HIDDEN_HELP_FEATURES.has(feature.id)), LITE_PRO_INFO_FEATURE]
      : HELP_FEATURES;
  }

  function escapeHelpHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function normalizeHelpQuery(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function helpQueryTokens(value) {
    return normalizeHelpQuery(value)
      .split(' ')
      .filter(token => token.length > 1 && !STOP_WORDS.has(token));
  }

  function scoreHelpFeature(query, feature) {
    const normalized = normalizeHelpQuery(query);
    const queryTokens = new Set(helpQueryTokens(normalized));
    let score = 0;
    let phraseMatch = false;

    feature.phrases.forEach((phrase) => {
      const normalizedPhrase = normalizeHelpQuery(phrase);
      if (normalizedPhrase && normalized.includes(normalizedPhrase)) {
        score += 12 + normalizedPhrase.split(' ').length;
        phraseMatch = true;
      }
    });

    feature.keywords.forEach((keyword) => {
      const normalizedKeyword = normalizeHelpQuery(keyword);
      if (!normalizedKeyword) return;
      if (normalizedKeyword.includes(' ')) {
        if (normalized.includes(normalizedKeyword)) score += 6;
        return;
      }
      if (queryTokens.has(normalizedKeyword)) score += 3;
    });

    helpQueryTokens(`${feature.title} ${feature.surface}`).forEach((token) => {
      if (queryTokens.has(token)) score += 1;
    });

    return { feature, score, phraseMatch };
  }

  function matchUniversalHelpQuery(query) {
    const normalized = normalizeHelpQuery(query);
    if (normalized.length < 2) return { status: 'empty', results: [] };

    const ranked = availableHelpFeatures()
      .map(feature => scoreHelpFeature(normalized, feature))
      .filter(result => result.score > 0)
      .sort((a, b) => b.score - a.score || a.feature.title.localeCompare(b.feature.title));

    if (!ranked.length || ranked[0].score < 3) return { status: 'none', results: [] };
    const top = ranked[0];
    const secondScore = ranked[1]?.score || 0;
    const confident = top.phraseMatch || top.score >= 12 || (top.score >= 7 && top.score - secondScore >= 3);
    return {
      status: confident ? 'confident' : 'uncertain',
      results: (confident ? ranked.slice(0, 1) : ranked.slice(0, 3)).map(result => ({
        ...result.feature,
        score: result.score
      }))
    };
  }

  function readHelpSearchLog() {
    try {
      const value = JSON.parse(localStorage.getItem(HELP_LOG_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (_) {
      return [];
    }
  }

  function writeHelpSearchLog(query, result) {
    const normalized = normalizeHelpQuery(query);
    if (!normalized) return;
    const next = readHelpSearchLog().filter(item => normalizeHelpQuery(item.query) !== normalized);
    next.unshift({
      query: String(query).trim().slice(0, 240),
      status: result.status,
      matches: result.results.map(item => item.id).slice(0, 3),
      searchedAt: new Date().toISOString()
    });
    try {
      localStorage.setItem(HELP_LOG_KEY, JSON.stringify(next.slice(0, HELP_LOG_LIMIT)));
    } catch (_) {}
    renderUniversalHelpGaps();
  }

  function helpSurfaceOptions() {
    const options = [
      ['Library', 'Find, preview, and prepare music.', 'library-search'],
      ['Studio', 'Build, order, and shape a set.', 'studio-build'],
      ['Health', 'Repair analysis and metadata gaps.', 'health-analysis'],
      ['Playlists', 'Return to saved sets and favourites.', 'playlists']
    ];
    if (!isLiteHelpEdition()) {
      options.push(['Performance', 'Get calm next-song options while live.', 'performance']);
    }
    return options;
  }

  function helpResultRow(feature, bestMatch = false) {
    return `
      <article class="axiom-help-result${bestMatch ? ' is-best' : ''}">
        <div class="axiom-help-result-copy">
          <span>${escapeHelpHtml(feature.surface)}${bestMatch ? ' / Best match' : ''}</span>
          <strong>${escapeHelpHtml(feature.title)}</strong>
          <p>${escapeHelpHtml(feature.description)}</p>
        </div>
        <button type="button" onclick="goToUniversalHelpFeature('${escapeHelpHtml(feature.id)}')">
          ${escapeHelpHtml(feature.actionLabel)} <span aria-hidden="true">&rarr;</span>
        </button>
      </article>
    `;
  }

  function renderUniversalHelpResults(result, query = '') {
    const heading = document.getElementById('axiom-help-results-heading');
    const results = document.getElementById('axiom-help-results');
    if (!heading || !results) return;

    if (result.status === 'empty') {
      heading.textContent = 'Browse AXIOM';
      results.innerHTML = helpSurfaceOptions().map(([surface, description, id]) => {
        const feature = availableHelpFeatures().find(item => item.id === id);
        return helpResultRow({ ...feature, title: surface, description, actionLabel: `Open ${surface}` });
      }).join('');
      return;
    }

    if (result.status === 'none') {
      heading.textContent = 'No honest match';
      results.innerHTML = `
        <div class="axiom-help-no-match" role="status">
          <strong>AXIOM does not have a feature that clearly matches this request yet.</strong>
          <p>Nothing has been opened or changed. Submit the search to save it privately on this Mac as a feature gap.</p>
        </div>
      `;
      return;
    }

    heading.textContent = result.status === 'confident' ? 'Best match' : 'These may help';
    results.innerHTML = result.results.map((feature, index) => helpResultRow(feature, result.status === 'confident' && index === 0)).join('');
  }

  function renderUniversalHelpGaps() {
    const list = document.getElementById('axiom-help-gap-list');
    const count = document.getElementById('axiom-help-gap-count');
    if (!list || !count) return;
    const gaps = readHelpSearchLog().filter(item => item.status !== 'confident');
    count.textContent = String(gaps.length);
    list.innerHTML = gaps.length
      ? gaps.slice(0, 10).map(item => `<li>${escapeHelpHtml(item.query)}</li>`).join('')
      : '<li class="is-empty">No unmatched searches saved on this Mac.</li>';
  }

  function ensureUniversalHelpOverlay() {
    let overlay = document.getElementById('axiom-universal-help');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'axiom-universal-help';
    overlay.className = 'axiom-universal-help-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <section class="axiom-universal-help-panel" role="dialog" aria-modal="true" aria-labelledby="axiom-universal-help-title">
        <header class="axiom-universal-help-head">
          <div>
            <span>AXIOM Help</span>
            <h2 id="axiom-universal-help-title">What do you need to do?</h2>
            <p>Describe the problem in your own words. You do not need to know the feature name.</p>
          </div>
          <button type="button" class="axiom-universal-help-close" onclick="closeUniversalHelp()" aria-label="Close AXIOM Help">&times;</button>
        </header>

        <form class="axiom-help-search" onsubmit="submitUniversalHelpSearch(event)">
          <label for="axiom-help-search-input">Describe your goal</label>
          <div>
            <input id="axiom-help-search-input" type="search" maxlength="240" autocomplete="off" placeholder="Example: I am DJing an event and need to know what music fits" oninput="previewUniversalHelpSearch(this.value)">
            <button type="submit">Find Help</button>
          </div>
        </form>

        <div class="axiom-help-tour-callout">
          <div>
            <span>Guided walkthrough</span>
            <strong>Tour every AXIOM surface</strong>
            <p>Replay ${isLiteHelpEdition() ? 'Library, Studio, Health, and Playlists' : 'Library, Studio, Health, Playlists, and Performance'} whenever you need a reset.</p>
          </div>
          <div class="axiom-help-tour-actions">
            <button id="axiom-help-context-action" class="secondary" type="button" onclick="startUniversalHelpContextWalkthrough()" hidden>Open This Screen's Walkthrough</button>
            <button type="button" onclick="startUniversalHelpWalkthrough()">Full AXIOM Tour <span aria-hidden="true">&rarr;</span></button>
          </div>
        </div>

        <section class="axiom-help-results-section" aria-live="polite">
          <h3 id="axiom-help-results-heading">Browse AXIOM</h3>
          <div id="axiom-help-results" class="axiom-help-results"></div>
        </section>

        <footer class="axiom-help-local-footer">
          <span>Help searches stay on this Mac. Nothing is sent to a server.</span>
          <button type="button" onclick="toggleUniversalHelpGaps()" aria-expanded="false">Search gaps <b id="axiom-help-gap-count">0</b></button>
        </footer>
        <section id="axiom-help-gaps" class="axiom-help-gaps" hidden>
          <div>
            <strong>Unmatched searches on this Mac</strong>
            <button type="button" onclick="clearUniversalHelpGaps()">Clear</button>
          </div>
          <ul id="axiom-help-gap-list"></ul>
        </section>
      </section>
    `;
    overlay.addEventListener('click', event => {
      if (event.target === overlay) closeUniversalHelp();
    });
    document.body.appendChild(overlay);
    renderUniversalHelpResults({ status: 'empty', results: [] });
    renderUniversalHelpGaps();
    return overlay;
  }

  function openUniversalHelp(options = {}) {
    if (typeof closeMasterHud === 'function') closeMasterHud();
    const overlay = ensureUniversalHelpOverlay();
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('axiom-help-open');
    activeHelpSurface = options.surface === 'library' ? 'library' : '';
    const contextAction = document.getElementById('axiom-help-context-action');
    if (contextAction) {
      contextAction.hidden = activeHelpSurface !== 'library';
      contextAction.textContent = activeHelpSurface === 'library' ? 'Library Walkthrough' : "Open This Screen's Walkthrough";
    }
    const input = document.getElementById('axiom-help-search-input');
    if (typeof options.query === 'string') {
      input.value = options.query;
      renderUniversalHelpResults(matchUniversalHelpQuery(options.query), options.query);
    }
    requestAnimationFrame(() => input?.focus());
  }

  function closeUniversalHelp() {
    const overlay = document.getElementById('axiom-universal-help');
    overlay?.classList.remove('active');
    overlay?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('axiom-help-open');
  }

  function previewUniversalHelpSearch(query) {
    renderUniversalHelpResults(matchUniversalHelpQuery(query), query);
  }

  function submitUniversalHelpSearch(event) {
    event?.preventDefault();
    const input = document.getElementById('axiom-help-search-input');
    const query = input?.value || '';
    const result = matchUniversalHelpQuery(query);
    renderUniversalHelpResults(result, query);
    if (result.status !== 'empty') writeHelpSearchLog(query, result);
  }

  function startUniversalHelpWalkthrough() {
    closeUniversalHelp();
    if (typeof showAxiomArrival === 'function') showAxiomArrival(true);
  }

  function startUniversalHelpContextWalkthrough() {
    const surface = activeHelpSurface;
    closeUniversalHelp();
    if (surface === 'library' && typeof openLibraryGuide === 'function') {
      openLibraryGuide(true);
      return;
    }
    startUniversalHelpWalkthrough();
  }

  function navigateToHelpFeature(feature) {
    switch (feature.action) {
      case 'room-rescue':
        showStudioWorkspace();
        selectStudioStartPath('room');
        openSetBrief(false);
        break;
      case 'library-search':
        showTab('library');
        setTimeout(() => document.getElementById('main-search')?.focus(), 120);
        break;
      case 'matching-songs':
        showTab('library');
        setTimeout(() => openLibraryGuide(true, 'smart'), 120);
        break;
      case 'studio':
        showStudioWorkspace();
        break;
      case 'magic-set':
        openMagicSetWorkspace();
        break;
      case 'health':
        showTab('health');
        break;
      case 'playlists':
        showTab('playlists');
        break;
      case 'performance':
        showTab('performance');
        break;
      case 'export-serato':
        openSidebarExport('serato');
        break;
      case 'export-djay':
        openSidebarExport('djay');
        break;
      case 'export-rekordbox':
        openSidebarExport('xml');
        break;
      case 'connect-music':
        showTab('library');
        setTimeout(() => openLibrarySourcePicker(), 100);
        break;
      case 'lite-pro-info':
        if (typeof openLiteProInfo === 'function') openLiteProInfo();
        break;
      default:
        throw new Error('This Help destination is not available.');
    }
  }

  function goToUniversalHelpFeature(featureId) {
    const feature = availableHelpFeatures().find(item => item.id === featureId);
    if (!feature) {
      if (typeof showToast === 'function') showToast('That Help destination is not available.', true);
      return;
    }
    const query = document.getElementById('axiom-help-search-input')?.value || '';
    if (query.trim()) writeHelpSearchLog(query, { status: 'confident', results: [feature] });
    closeUniversalHelp();
    try {
      navigateToHelpFeature(feature);
    } catch (error) {
      if (typeof showToast === 'function') showToast(error.message || 'That Help destination could not open.', true);
    }
  }

  function toggleUniversalHelpGaps() {
    const panel = document.getElementById('axiom-help-gaps');
    const button = document.querySelector('.axiom-help-local-footer button');
    if (!panel) return;
    panel.hidden = !panel.hidden;
    button?.setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
    if (!panel.hidden) renderUniversalHelpGaps();
  }

  function clearUniversalHelpGaps() {
    const confident = readHelpSearchLog().filter(item => item.status === 'confident');
    try {
      localStorage.setItem(HELP_LOG_KEY, JSON.stringify(confident.slice(0, HELP_LOG_LIMIT)));
    } catch (_) {}
    renderUniversalHelpGaps();
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.getElementById('axiom-universal-help')?.classList.contains('active')) {
      closeUniversalHelp();
    }
  });

  Object.assign(window, {
    openUniversalHelp,
    closeUniversalHelp,
    previewUniversalHelpSearch,
    submitUniversalHelpSearch,
    startUniversalHelpWalkthrough,
    startUniversalHelpContextWalkthrough,
    goToUniversalHelpFeature,
    toggleUniversalHelpGaps,
    clearUniversalHelpGaps,
    matchUniversalHelpQuery
  });
})();
