    // Library readiness, contextual guides, and source-connection states.
    let libraryHasTracks = null;
    let libraryBpmRepairPrompted = false;
    const LIBRARY_GUIDE_STORAGE_KEY = 'axiomLibraryGuideSeen.v2';
    const STUDIO_GUIDE_STORAGE_KEY = 'axiomStudioGuideSeen.v2';
    const HELP_ATTENTION_CLASS = 'axiom-help-needs-attention';
    const LIBRARY_GUIDE_STEPS = [
      {
        path: 'anchor',
        label: 'Anchor Track',
        title: 'Pick The First Song',
        body: 'Choose the song that starts the set and sets the vibe you are going for. AXIOM uses this track as the anchor, also known as the Set Starter, and builds everything else around that song.'
      },
      {
        path: 'smart',
        label: 'Recommendations',
        title: 'Recommendations Section',
        body: 'This section suggests songs that could work with the track you are currently playing or have selected inside Library.\n\nAXIOM compares speed, key, timeline era, folder organization, and sound so you can spot strong ideas for the next track.'
      },
      {
        path: 'listen',
        label: 'Search, Listen, Add',
        title: 'Find The Right Starter',
        body: 'Use search when the songs shown are not what you want for your anchor track.\n\nIf you already know the feel, era, speed, artist, or folder you want, find it instantly in the search bar.\n\nImportant: add your full music library into AXIOM so the software can suggest better ideas and help you build stronger sets.'
      },
      {
        path: 'studio',
        label: 'Studio Ready?',
        title: 'Build And Refine The Set',
        body: 'Once the anchor song is chosen, move into Studio.\n\nBuild your set song by song, or let Magic Set draft a full set for you automatically.\n\nThen keep the strong picks and manually swap out anything that does not fit.'
      }
    ];
    let activeLibraryGuideStep = 0;

    function setHelpButtonAttention(buttonId, storageKey, eligible = true) {
      const button = document.getElementById(buttonId);
      if (!button) return false;
      const needsAttention = eligible && localStorage.getItem(storageKey) !== 'true';
      button.classList.toggle(HELP_ATTENTION_CLASS, needsAttention);
      return needsAttention;
    }

    function acknowledgeHelpButton(buttonId, storageKey) {
      localStorage.setItem(storageKey, 'true');
      document.getElementById(buttonId)?.classList.remove(HELP_ATTENTION_CLASS);
    }

    function smartListGuideStorageKey() {
      const version = String(document.getElementById('release-splash-version')?.textContent || 'current').trim();
      return `axiomSmartListGuideSeen:${version}:v2`;
    }

    function isLibraryTabVisible() {
      const libraryTab = document.getElementById('tab-content-library');
      return !!libraryTab && !libraryTab.classList.contains('hidden');
    }

    function isStudioTabVisible() {
      const studioTab = document.getElementById('tab-content-studio');
      return !!studioTab && !studioTab.classList.contains('hidden');
    }

    function setLibraryGuidePath(path = 'anchor') {
      const stepIndex = LIBRARY_GUIDE_STEPS.findIndex((step) => step.path === path);
      activeLibraryGuideStep = stepIndex >= 0 ? stepIndex : 0;
      renderLibraryGuideStep();
    }

    function renderLibraryGuideStep() {
      const guide = LIBRARY_GUIDE_STEPS[activeLibraryGuideStep] || LIBRARY_GUIDE_STEPS[0];
      const stepNumber = document.getElementById('library-guide-step-number');
      const stepLabel = document.getElementById('library-guide-step-label');
      const stepProgress = document.getElementById('library-guide-step-progress');
      const title = document.getElementById('library-guide-detail-title');
      const body = document.getElementById('library-guide-detail-body');
      const backBtn = document.getElementById('library-guide-back-btn');
      const nextBtn = document.getElementById('library-guide-next-btn');

      if (stepNumber) stepNumber.innerText = String(activeLibraryGuideStep + 1);
      if (stepLabel) stepLabel.innerText = guide.label;
      if (stepProgress) stepProgress.innerText = `Step ${activeLibraryGuideStep + 1} of ${LIBRARY_GUIDE_STEPS.length}`;
      if (title) title.innerText = guide.title;
      if (body) body.innerText = guide.body;
      if (backBtn) backBtn.disabled = activeLibraryGuideStep === 0;
      if (nextBtn) nextBtn.innerText = activeLibraryGuideStep >= LIBRARY_GUIDE_STEPS.length - 1 ? 'Open Studio' : 'Next';
    }

    function moveLibraryGuideStep(direction = 1) {
      const nextStep = activeLibraryGuideStep + direction;
      if (nextStep >= LIBRARY_GUIDE_STEPS.length) {
        openStudioFromLibraryGuide();
        return;
      }
      activeLibraryGuideStep = Math.max(0, Math.min(LIBRARY_GUIDE_STEPS.length - 1, nextStep));
      renderLibraryGuideStep();
    }

    function openLibraryGuide(force = false, path = 'anchor') {
      if (!force && localStorage.getItem(LIBRARY_GUIDE_STORAGE_KEY) === 'true') return;
      if (!force && libraryHasTracks === false) return;
      acknowledgeHelpButton('btn-library-guide', LIBRARY_GUIDE_STORAGE_KEY);
      setLibraryGuidePath(path);
      renderWorkflowGuide({
        id: 'library-guide-popover',
        kicker: 'Library Walkthrough',
        title: 'Find The Vibe Of Your Set',
        startHint: 'Click here for help',
        items: LIBRARY_GUIDE_STEPS.map(step => ({
          title: step.label,
          body: `${step.title}\n\n${step.body}`
        })),
        primaryLabel: 'Open Studio',
        primaryAction: 'openStudioFromLibraryGuide()'
      });
    }

    function closeLibraryGuide() {
      document.getElementById('library-guide-modal')?.classList.remove('active');
      closeWorkflowGuide('library-guide-popover');
    }

    function openStudioFromLibraryGuide() {
      closeLibraryGuide();
      showTab('studio');
    }

    const workflowGuideRevealTimers = new Map();

    function clearWorkflowGuideRevealTimers(id) {
      const timers = workflowGuideRevealTimers.get(id) || [];
      timers.forEach(timer => clearTimeout(timer));
      workflowGuideRevealTimers.delete(id);
    }

    function clearMatchingGuideRevealTimers() {
      clearWorkflowGuideRevealTimers('smart-list-guide-popover');
    }

    function closeWorkflowGuide(id) {
      clearWorkflowGuideRevealTimers(id);
      document.getElementById(id)?.remove();
    }

    function toggleWorkflowGuideDetail(id) {
      const overlay = document.getElementById(id);
      if (!overlay) return;
      clearWorkflowGuideRevealTimers(id);
      const details = overlay.querySelectorAll('.workflow-detail');
      const shouldOpen = Array.from(details).some(detail => detail.classList.contains('collapsed'));
      details.forEach(detail => detail.classList.toggle('collapsed', !shouldOpen));
      overlay.querySelectorAll('.workflow-item').forEach(item => {
        item.classList.toggle('active', shouldOpen);
        item.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
      });
      const btn = overlay.querySelector('.workflow-more-btn');
      if (btn) btn.innerText = shouldOpen ? 'Less Detail' : 'More Detail';
    }

    function revealWorkflowGuideSequence(id) {
      const overlay = document.getElementById(id);
      if (!overlay || overlay.classList.contains('workflow-sequence-started')) return;
      overlay.classList.add('workflow-sequence-started');
      clearWorkflowGuideRevealTimers(id);
      const items = Array.from(overlay.querySelectorAll('.workflow-item'));
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
      const timers = [];
      items[0]?.classList.remove('workflow-item-attention');
      items.forEach((item, index) => {
        const timer = setTimeout(() => {
          item.querySelector('.workflow-detail')?.classList.remove('collapsed');
          item.classList.add('active', 'workflow-reveal-detail');
          item.setAttribute('aria-expanded', 'true');
          if (index === items.length - 1) {
            const moreButton = overlay.querySelector('.workflow-more-btn');
            if (moreButton) moreButton.innerText = 'Less Detail';
            workflowGuideRevealTimers.delete(id);
          }
        }, reduceMotion ? 0 : index * 430);
        timers.push(timer);
      });
      workflowGuideRevealTimers.set(id, timers);
    }

    function toggleWorkflowGuideItem(id, index) {
      const overlay = document.getElementById(id);
      if (!overlay) return;
      const item = overlay.querySelector(`[data-workflow-index="${index}"]`);
      const detail = item?.querySelector('.workflow-detail');
      if (!item || !detail) return;
      const shouldOpen = detail.classList.contains('collapsed');
      detail.classList.toggle('collapsed', !shouldOpen);
      item.classList.toggle('active', shouldOpen);
      item.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
      const allDetails = Array.from(overlay.querySelectorAll('.workflow-detail'));
      const btn = overlay.querySelector('.workflow-more-btn');
      if (btn) btn.innerText = allDetails.every(d => !d.classList.contains('collapsed')) ? 'Less Detail' : 'More Detail';
    }

    function renderWorkflowGuide({ id, kicker, title, items, startHint = '', primaryLabel = 'Got It', primaryAction = '', secondaryLabel = 'Close' }) {
      closeWorkflowGuide(id);
      const overlay = document.createElement('div');
      overlay.id = id;
      overlay.className = 'workflow-popover active';
      overlay.innerHTML = `
        <div class="workflow-card" role="dialog" aria-modal="false" aria-labelledby="${id}-title">
          <div class="workflow-head">
            <div>
              <p class="workflow-kicker">${escapeHtml(kicker)}</p>
              <h2 class="workflow-title" id="${id}-title">${escapeHtml(title)}</h2>
            </div>
            <button type="button" class="workflow-close" onclick="closeWorkflowGuide('${id}')" aria-label="Close ${escapeHtml(title)} guide">×</button>
          </div>
          <div class="workflow-list">
            ${items.map((item, index) => {
              const action = item.action || (index === 0
                ? `revealWorkflowGuideSequence('${id}')`
                : `toggleWorkflowGuideItem('${id}', ${index})`);
              return `
              <div class="workflow-item ${item.attention ? 'workflow-item-attention' : ''}" data-workflow-index="${index}" role="button" tabindex="0" aria-expanded="false" onclick="${action}" onkeydown="if(event.key === 'Enter' || event.key === ' '){ event.preventDefault(); ${action}; }">
                <span>${index + 1}</span>
                <div>
                  <strong>${escapeHtml(item.title)}</strong>
                  ${index === 0 && startHint ? `<small class="workflow-start-hint">${escapeHtml(startHint)}</small>` : ''}
                  <p class="workflow-detail collapsed">${escapeHtml(item.body)}</p>
                </div>
              </div>
            `;}).join('')}
          </div>
          <div class="workflow-actions">
            <button type="button" class="secondary" onclick="closeWorkflowGuide('${id}')">${escapeHtml(secondaryLabel)}</button>
            <button type="button" class="secondary workflow-more-btn" onclick="toggleWorkflowGuideDetail('${id}')">More Detail</button>
            <button type="button" class="primary" onclick="${primaryAction || `closeWorkflowGuide('${id}')`}">${escapeHtml(primaryLabel)}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    function openStudioGuide(force = false) {
      if (!force && localStorage.getItem(STUDIO_GUIDE_STORAGE_KEY) === 'true') return;
      acknowledgeHelpButton('btn-studio-guide', STUDIO_GUIDE_STORAGE_KEY);
      renderWorkflowGuide({
        id: 'studio-guide-popover',
        kicker: 'Studio Walkthrough',
        title: 'Build The Set',
        startHint: 'Click here for help',
        items: [
          { title: 'Add The First 5 Songs', body: 'Start by choosing at least five songs yourself. This tells AXIOM you have a real manual build, not just an empty workspace.\n\nThose first choices give the software enough direction to understand the kind of set you are building.' },
          { title: 'Manual Build', body: 'Manual Build is your own working order. Once it unlocks, you can drag songs, listen through the run, open Matching Songs from any song, and keep shaping the set by hand.' },
          { title: 'Suggest Order', body: 'Suggest Order appears beside Manual Build after five songs are in the set.\n\nClick it when you want AXIOM to reorder those same songs into a cleaner harmonic route without changing your source audio.' },
          { title: 'Magic Set', body: 'Use Magic Set in the Studio toolbar when you want AXIOM to draft a full set automatically.\n\nYou can still replace anything manually after AXIOM builds the journey.' }
        ],
        primaryLabel: 'Start Building'
      });
    }

    function maybeShowStudioGuide() {
      setHelpButtonAttention(
        'btn-studio-guide',
        STUDIO_GUIDE_STORAGE_KEY,
        isStudioTabVisible() && studioHasWorkingTracks()
      );
    }

    function openSmartListGuide(force = false) {
      const key = smartListGuideStorageKey();
      if (!force && localStorage.getItem(key) === 'true') return;
      acknowledgeHelpButton('btn-matching-guide', key);
      const introduceAnchor = matchingAnchorIntroActive;
      renderWorkflowGuide({
        id: 'smart-list-guide-popover',
        kicker: 'Matching Songs Walkthrough',
        title: 'Matching Songs',
        items: [
          {
            title: 'Current Song',
            body: 'This is the anchor track. AXIOM uses it as the reference for songs that can work before or after it.',
            attention: introduceAnchor,
            action: introduceAnchor ? 'revealMatchingSongsGuideSequence()' : ''
          },
          { title: 'Matching Songs', body: 'The list shows possible next songs using BPM, key, root, era, and transition feel.' },
          { title: 'Preview First', body: 'Click a matching song to hear it and inspect the live transition panel before adding it.' },
          { title: 'Build The Run', body: 'Keep building, replace the current song, save a match for later, or return to your set.' }
        ],
        primaryLabel: 'Find Matching Songs',
        primaryAction: introduceAnchor ? 'continueFromMatchingSongsGuide()' : ''
      });
    }

    function revealMatchingSongsGuideSequence() {
      revealWorkflowGuideSequence('smart-list-guide-popover');
    }

    function continueFromMatchingSongsGuide() {
      closeWorkflowGuide('smart-list-guide-popover');
      revealMatchingSongsAnchorIntro();
    }

    function maybeShowLibraryGuide() {
      setHelpButtonAttention(
        'btn-library-guide',
        LIBRARY_GUIDE_STORAGE_KEY,
        isLibraryTabVisible() && libraryHasTracks === true
      );
    }

    function clearLegacyLibraryConnectionPrompt() {
      const results = document.getElementById('search-results');
      const title = results?.querySelector('.library-empty-title')?.textContent || '';
      if (/connect your dj library/i.test(title)) results.replaceChildren();
    }

    function setLibraryConnectionState(totalTracks, options = {}) {
      const count = Number(totalTracks || 0);
      const connectView = document.getElementById('connect-music-view');
      const wasConnecting = !!connectView && !connectView.classList.contains('hidden');
      libraryHasTracks = count > 0;
      document.body.classList.toggle('library-empty', !libraryHasTracks);
      updateCsvBuildAvailability();
      if (window.AxiomDawFinder?.active) {
        // A project can outlive its Library connection. Keep its Add journey
        // open so reconnecting music does not send the DJ through Start again.
        connectView?.classList.add('hidden');
        document.body.classList.remove('connect-music-stage');
        maybeShowLibraryGuide();
        return;
      }
      syncMusicConnectionViews();
      if (!libraryHasTracks) {
        showConnectMusicView();
      } else if (options.openLibrary === true) {
        clearLegacyLibraryConnectionPrompt();
        document.getElementById('connect-music-view')?.classList.add('hidden');
        document.body.classList.remove('library-empty', 'connect-music-stage');
        switchTab('library');
      } else if (wasConnecting) {
        showStudioLaunchView();
      }
      maybeShowLibraryGuide();
    }

    function trackHasUsableBpm(track = {}) {
      const bpm = parseFloat(track.bpm || 0);
      return Number.isFinite(bpm) && bpm > 0;
    }

    function getLibraryTotalFromPayload(data = {}) {
      return Number(data.library_total_tracks ?? data.total_tracks ?? 0);
    }

    function getLibraryBpmReadyFromPayload(data = {}) {
      if (data.bpm_ready_tracks != null) return Number(data.bpm_ready_tracks || 0);
      const tracks = Array.isArray(data.tracks) ? data.tracks : [];
      return tracks.filter(trackHasUsableBpm).length;
    }

    function libraryNeedsBpmRepair(data = {}) {
      if (data.bpm_repair_needed === true) return true;
      const total = getLibraryTotalFromPayload(data);
      const bpmReady = getLibraryBpmReadyFromPayload(data);
      return total > 0 && bpmReady <= 0;
    }

    function openBpmRepairFromLibrary(data = {}) {
      if (libraryBpmRepairPrompted) return;
      libraryBpmRepairPrompted = true;
      closeLibraryGuide();
      showTab('health');
      setTimeout(() => {
        if (typeof setHealthFilter === 'function') setHealthFilter('missing_bpm');
        if (typeof runLibraryHealthCheck === 'function') runLibraryHealthCheck();
        if (typeof resetHealthViewScroll === 'function') resetHealthViewScroll();
      }, 120);
      const missing = Number(data.missing_bpm_tracks || getLibraryTotalFromPayload(data) || 0);
      showToast(`${missing} tracks need BPM repair before they can appear in Library. Source audio remains untouched.`);
    }

    function renderLibraryBpmRepairPrompt(context = {}) {
      const results = document.getElementById('search-results');
      if (!results) return;
      const total = Number(context.library_total_tracks || context.total_tracks || 0);
      const missing = Number(context.missing_bpm_tracks || total || 0);
      results.innerHTML = `
        <section class="library-empty-state">
          <div class="library-empty-copy">
            <div class="library-empty-kicker">Music Loaded</div>
            <h2 class="library-empty-title">BPM Repair Needed</h2>
            <p class="library-empty-body">
              AXIOM found ${total.toLocaleString()} track${total === 1 ? '' : 's'}, but ${missing.toLocaleString()} need BPM before they can appear in Library, Studio, and Magic Set. Source audio stays untouched.
            </p>
            <div class="library-empty-actions">
              <button class="library-empty-primary" onclick="showTab('health'); setTimeout(() => { if (typeof setHealthFilter === 'function') setHealthFilter('missing_bpm'); if (typeof runLibraryHealthCheck === 'function') runLibraryHealthCheck({ force: true }); }, 120);">Open Library Health</button>
              <button class="library-empty-secondary" onclick="openLibrarySourcePicker()">Choose Different Source</button>
            </div>
            <div class="library-empty-note">AXIOM repairs metadata in its own cache. Your music files and DJ software library stay untouched.</div>
          </div>
          <div class="library-empty-orbit" aria-hidden="true">
            <div class="library-empty-drop">
              BPM
              <span>Health repair</span>
            </div>
          </div>
        </section>
      `;

      const suggestions = document.getElementById('lib-suggestions-list');
      if (suggestions) {
        suggestions.innerHTML = `
          <div class="mt-10 rounded-2xl border border-axiom-accent/20 bg-axiom-accent/10 p-6 text-center">
            <p class="text-[10px] font-black uppercase tracking-[0.22em] text-axiom-accent mb-3">Library Health Needed</p>
            <p class="text-xs font-bold text-white/55 leading-relaxed">Repair BPM first so AXIOM can rank, search, and suggest songs properly.</p>
          </div>
        `;
      }
    }

    function handleLibraryBpmReadiness(data = {}, navigate = true) {
      const total = getLibraryTotalFromPayload(data);
      if (total || data.total_tracks != null || data.library_total_tracks != null) setLibraryConnectionState(total);
      if (libraryNeedsBpmRepair(data)) {
        if (navigate) openBpmRepairFromLibrary(data);
        return !navigate;
      }
      return true;
    }

    function renderLibraryConnectionPrompt() {
      if (window.AxiomDawFinder?.active) {
        window.AxiomDawFinder.showEmptyLibrary();
        return;
      }
      const results = document.getElementById('search-results');
      if (libraryHasTracks === true) {
        clearLegacyLibraryConnectionPrompt();
        return;
      }
      if (results) results.replaceChildren();
      const suggestions = document.getElementById('lib-suggestions-list');
      if (suggestions) suggestions.replaceChildren();
      showConnectMusicView();
    }

    function renderLibraryNoMatches(context = {}) {
      const results = document.getElementById('search-results');
      if (!results) return;
      const rawMatches = Number(context.raw_search_matches || 0);
      const hiddenMatches = Number(context.hidden_by_library_filters || 0);
      const hiddenByBrief = Number(context.hidden_by_set_brief || 0);
      const brief = setBriefPayload();
      const activeLaneKey = activeLibraryBriefLane || 'best';
      const activeLaneLabel = libraryBriefConfig(brief).lanes.find(([key]) => key === activeLaneKey)?.[1] || 'Set Prep';
      const safeLaneLabel = escapeHtml(activeLaneLabel);
      const bpmFilterActive = Boolean(context.active_bpm_filter?.enabled);
      const eraFilter = context.active_era_filter || activeEra || 'All';
      const safeEra = escapeHtml(eraFilter);
      const preparationOpen = libraryBriefActivePanel === 'preparation' && activeLibraryPreparationFilter !== 'all';
      const preparationCopy = activeLibraryPreparationFilter === 'missing_file'
        ? 'No missing files were found. Your Library has nothing to fix in this view.'
        : activeLibraryPreparationFilter === 'missing_year'
          ? 'No tracks are missing Year. Your Library has nothing to fix in this view.'
          : activeLibraryPreparationFilter === 'missing_bpm'
            ? 'No tracks are missing BPM. Your Library has nothing to fix in this view.'
            : activeLibraryPreparationFilter === 'missing_key'
              ? 'No tracks are missing Key. Your Library has nothing to fix in this view.'
              : 'No tracks are missing BPM, Key, or Year. Your Library has nothing to fix in this view.';
      const filterCopy = preparationOpen
        ? preparationCopy
        : brief.enabled && hiddenByBrief > 0
        ? `${hiddenByBrief.toLocaleString()} visible track${hiddenByBrief === 1 ? ' does' : 's do'} not meet the ${safeLaneLabel} rules for this ${setBriefLabel('intention', brief.intention).toLowerCase()} set. Recently Added is off; choose another Set Prep option or return to the full Library.`
        : rawMatches > 0
        ? `${rawMatches} matching track${rawMatches === 1 ? ' exists' : 's exist'}, but ${hiddenMatches || rawMatches} ${hiddenMatches === 1 || (!hiddenMatches && rawMatches === 1) ? 'is' : 'are'} hidden by ${bpmFilterActive ? 'BPM' : 'Library'} filters${eraFilter && eraFilter !== 'All' ? ` and the ${safeEra} era view` : ''}.`
        : 'Try a title, artist, BPM, key, era, folder, or root.';
      const actionCopy = preparationOpen
        ? ''
        : brief.enabled && hiddenByBrief > 0
        ? `<button class="library-empty-primary mt-5" onclick="toggleLibraryBriefLens(false)">Show Normal Library</button>`
        : rawMatches > 0
        ? `<button class="library-empty-primary mt-5" onclick="clearLibrarySearchFilters()">Clear Filters</button>`
        : '';
      results.innerHTML = `
        <div class="library-no-results">
          <div>
            <p class="text-axiom-accent mb-3${preparationOpen ? ' library-track-prep-complete-title' : ''}">${preparationOpen ? 'Track Prep Complete' : brief.enabled && hiddenByBrief > 0 ? `No ${safeLaneLabel} Matches` : 'No Matching Records'}</p>
            <p class="text-[11px] normal-case tracking-normal text-white/40">${filterCopy}</p>
            ${actionCopy}
          </div>
        </div>
      `;
    }

    async function loadLibraryStats(navigateToRepair = true) {
      const reviewMode = axiomReviewMode();
      const entranceReadyReview = new URLSearchParams(location.search).get('entrance_library') === 'ready'
        && (window.__axiomEntranceSession?.fixture === true || ['studio-start', 'quick-start'].includes(reviewMode));
      if (entranceReadyReview || ['library', 'library-gap-checker', 'library-state-audit'].includes(reviewMode)) {
        libraryHasTracks = true;
        updateLibraryCount(entranceReadyReview || ['library', 'library-state-audit'].includes(reviewMode) ? libraryGapReviewTracks().length : 23226);
        document.body.classList.remove('library-empty', 'connect-music-stage');
        document.getElementById('connect-music-view')?.classList.add('hidden');
        return;
      }
      if (['studio-active', 'anchor-selection'].includes(reviewMode)) {
        libraryHasTracks = true;
        updateLibraryCount(0);
        document.body.classList.remove('library-empty', 'connect-music-stage');
        document.getElementById('connect-music-view')?.classList.add('hidden');
        return;
      }
      try {
        const resp = await fetch('/api/library/stats');
        if (!resp.ok) return;
        const data = await resp.json();
        const totalTracks = getLibraryTotalFromPayload(data);
        if (data.total_tracks != null || data.library_total_tracks != null) {
          updateLibraryCount(totalTracks);
          const isReady = handleLibraryBpmReadiness(data, navigateToRepair);
          if (!libraryHasTracks && isLibraryTabVisible()) renderLibraryConnectionPrompt();
          if (!isReady) return;
        }
      } catch (_) { }
    }

	    let activeEra = 'All';
	    let activeLibraryBpmFilter = 'all';
	    let activeLibraryRootFilter = '';
	    let activeLibraryPreparationFilter = 'all';
	    let activeLibraryPreparationSort = 'default';
        let activeLibraryTopSortStack = [];
	    let lastLibraryPreparationReceiptJob = null;
	    let activeLibraryPreparationFilteredTotal = 0;
	    const LIBRARY_PREPARATION_RECEIPT_KEY = 'axiomLibraryPreparationReceiptV1';
	    let activeLibraryBriefLane = 'best';
	    let activeLibraryEligibilitySummary = { source: 0, eligible: 0, rejected: 0 };
	    const LIBRARY_FRESHNESS_KEY = 'axiomLibraryFreshnessV1';
	    const LIBRARY_FRESHNESS_BUILD_KEY = 'axiomLibraryFreshnessBuildOrdinal';
	    const LIBRARY_FRESHNESS_WINDOW = 8;
	    const LIBRARY_RESULT_STEP = 40;
	    const LIBRARY_RESULT_MAX = 400;
	    let activeLibraryResultLimit = LIBRARY_RESULT_STEP;
	    let activeLibraryQuerySignature = '';
	    let activeLibraryFreshBuildOrdinal = Number(localStorage.getItem(LIBRARY_FRESHNESS_BUILD_KEY) || 0) || 0;
	    let activeLibraryFreshBuildToken = '';
	    let activeLibraryExposureSignature = '';
	    const libraryBatchBpmSelection = new Set();
	    let librarySearchTimer = null;
      let librarySearchRequestId = 0;
      let librarySearchAbortController = null;
      let seratoLibrarySyncInFlight = false;

      function syncLibraryBatchSelectionUi() {
        const toolbar = document.getElementById('library-batch-bpm-toolbar');
        const count = libraryBatchBpmSelection.size;
        toolbar?.classList.toggle('hidden', count === 0);
        const countNode = document.getElementById('library-batch-bpm-count');
        if (countNode) countNode.textContent = count.toLocaleString();

        document.querySelectorAll('#search-results .library-track-card[data-path]').forEach(row => {
          const selected = libraryBatchBpmSelection.has(String(row.dataset.path || ''));
          row.classList.toggle('batch-selected', selected);
          row.setAttribute('aria-selected', selected ? 'true' : 'false');
          const button = row.querySelector('.library-batch-selector');
          if (button) button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
      }

      function clearLibraryBatchSelection(options = {}) {
        libraryBatchBpmSelection.clear();
        if (options.render !== false) syncLibraryBatchSelectionUi();
      }

      function toggleLibraryBatchBpmSelection(path) {
        const cleanPath = String(path || '').trim();
        if (!cleanPath) return;
        if (libraryBatchBpmSelection.has(cleanPath)) libraryBatchBpmSelection.delete(cleanPath);
        else libraryBatchBpmSelection.add(cleanPath);
        syncLibraryBatchSelectionUi();
      }

      function selectAllShownLibraryTracks() {
        document.querySelectorAll('#search-results .library-track-card[data-path][data-batch-select-ready="true"]').forEach(row => {
          const path = String(row.dataset.path || '').trim();
          if (path) libraryBatchBpmSelection.add(path);
        });
        syncLibraryBatchSelectionUi();
      }

      async function addSelectedLibraryTracksToStudio(button) {
        const paths = Array.from(libraryBatchBpmSelection);
        if (!paths.length) return;

        const selectedTracks = paths
          .map(path => normalizeModalTrackMetadata({ ...(trackVisualCache.get(path) || {}), path }))
          .filter(track => track.path && track.source_connected !== false);
        const additions = [];
        let duplicateCount = 0;
        selectedTracks.forEach(track => {
          if (studioHasTrack(track) || additions.some(existing => trackMatchesIdentity(existing, track))) {
            duplicateCount += 1;
            return;
          }
          additions.push(track);
        });

        if (!additions.length) {
          showToast(duplicateCount ? 'Those selected tracks are already in Studio.' : 'No connected selected tracks can be added to Studio.', true);
          return;
        }

        const preparationPaths = additions
          .filter(track => Number(track.bpm || 0) <= 0 || !String(track.camelot || '').trim())
          .map(track => track.path);
        if (preparationPaths.length) {
          const confirmed = await showAxiomConfirm(
            'Prepare Selected Tracks',
            `${preparationPaths.length.toLocaleString()} selected track${preparationPaths.length === 1 ? ' is' : 's are'} missing BPM or key. AXIOM can add the selection to Studio now and prepare those tracks in the background. Source audio stays untouched.`,
            `Prepare & Add ${additions.length.toLocaleString()}`,
            'primary',
            'health-all'
          );
          if (!confirmed) return;
        }

        setAxiomButtonBusy(button, true, 'Adding...');
        try {
          const wasEmpty = currentPlaylist.length === 0;
          saveHistory();
          currentPlaylist = dedupePlaylistTracks(currentPlaylist.concat(additions));
          syncEditingPlaylistIfNeeded();
          activeStudioView = 'manual';
          clearLibraryBatchSelection({ render: false });
          if (wasEmpty) {
            document.getElementById('studio-start-view')?.classList.add('hidden');
            document.getElementById('studio-active-view')?.classList.remove('hidden');
          }
          renderPlaylist(currentPlaylist);
          showStudioWorkspace();
          updateStudioToolsAvailability();
          initSortable();
          recalculateAudit();
          const duplicateCopy = duplicateCount ? `; ${duplicateCount} already in Studio` : '';
          showToast(`Added ${additions.length.toLocaleString()} selected track${additions.length === 1 ? '' : 's'} to Studio${duplicateCopy}.`);
          showStudioTrackAddedPulse({
            title: `${additions.length.toLocaleString()} selected Library track${additions.length === 1 ? '' : 's'}`,
            artist: 'Added To Studio'
          }, currentPlaylist.length, currentPlaylist);
          if (preparationPaths.length) startUnifiedHealthScan('', null, preparationPaths);
        } finally {
          setAxiomButtonBusy(button, false);
          syncLibraryBatchSelectionUi();
        }
      }

      async function batchHalfSelectedLibraryBpm(button) {
        // Keep the established one-click batch receipt wording stable.
        // HALVING BPM FOR ${paths.length.toLocaleString()} remains the half-time receipt.
        // The completed receipt remains: HALVED · AXIOM UPDATED.
        return batchAdjustSelectedLibraryBpm(button, 'half');
      }

      async function batchDoubleSelectedLibraryBpm(button) {
        return batchAdjustSelectedLibraryBpm(button, 'double');
      }

      async function batchAdjustSelectedLibraryBpm(button, action = 'half') {
        const paths = Array.from(libraryBatchBpmSelection);
        if (!paths.length || !['half', 'double'].includes(action)) return;
        const label = action === 'half' ? 'Half' : 'Double';
        const confirmed = await showAxiomConfirm(
          `${label} Selected BPM Values`,
          `AXIOM will ${action === 'half' ? 'halve' : 'double'} the BPM for ${paths.length.toLocaleString()} selected track${paths.length === 1 ? '' : 's'} and refresh its energy classification. This changes AXIOM intelligence only; source audio stays untouched.`,
          `${label} BPM For ${paths.length.toLocaleString()} Track${paths.length === 1 ? '' : 's'}`,
          'primary'
        );
        if (!confirmed) return;

        setAxiomButtonBusy(button, true, action === 'half' ? 'Halving...' : 'Doubling...');
        showToast(action === 'half'
          ? `HALVING BPM FOR ${paths.length.toLocaleString()} TRACK${paths.length === 1 ? '' : 'S'}`
          : `DOUBLING BPM FOR ${paths.length.toLocaleString()} TRACK${paths.length === 1 ? '' : 'S'}`);
        try {
          const response = await fetch('/api/library/batch_adjust_bpm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths, action })
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || !data.success) {
            showToast(data.error || 'The selected BPM values could not be changed. Source audio remains protected.', true);
            return;
          }

          (data.results || []).forEach(result => {
            if (result.status !== 'updated') return;
            propagateTrackMetadata(result.path, { bpm: result.after_bpm, energy: result.energy });
          });
          clearLibraryBatchSelection({ render: false });
          const updatedCount = Number(data.updated_count || 0);
          const skipped = Number(data.skipped_count || 0);
          showToast(`${updatedCount.toLocaleString()} BPM VALUE${updatedCount === 1 ? '' : 'S'} ${action === 'half' ? 'HALVED' : 'DOUBLED'} · AXIOM UPDATED${skipped ? ` · ${skipped.toLocaleString()} SKIPPED` : ''}`);
          loadLibraryStats();
          await runSearch();
          if (!document.getElementById('replacement-modal')?.classList.contains('hidden')) fetchSuggestions(false);
          if (document.getElementById('lib-suggestions-list')?.innerHTML.trim() !== '') resetAndFetchLibSuggestions();
          initSortable();
          recalculateAudit();
        } catch (error) {
          console.error(`Batch ${label} BPM error:`, error);
          showToast('The selected BPM values could not be changed. Source audio remains protected.', true);
        } finally {
          setAxiomButtonBusy(button, false);
          syncLibraryBatchSelectionUi();
        }
      }

	    function loadLibraryFreshnessStore() {
	      try {
	        const parsed = JSON.parse(localStorage.getItem(LIBRARY_FRESHNESS_KEY) || '{}');
	        if (parsed && typeof parsed === 'object') return parsed;
	      } catch (_) {}
	      return { missions: {} };
	    }

	    function saveLibraryFreshnessStore(store) {
	      try {
	        localStorage.setItem(LIBRARY_FRESHNESS_KEY, JSON.stringify(store));
	      } catch (_) {}
	    }

	    function libraryTrackFreshnessIdentity(track = {}) {
	      const path = String(track.path || track.browser_file || '').trim();
	      if (path) return path;
	      return `${track.artist || 'unknown'}::${track.title || track.filename || 'track'}`.toLowerCase();
	    }

	    function libraryFreshnessMissionKey(brief = setBriefPayload()) {
	      const normalized = normalizeSetBrief(brief);
	      return [
	        normalized.intention,
	        normalized.audience,
	        normalized.setting,
	        normalized.lyrics,
	        normalized.soundFocus,
	        normalized.energyJourney,
	        normalized.planningStyle
	      ].join(':');
	    }

	    function beginLibraryFreshBuild(reason = 'build') {
	      activeLibraryFreshBuildOrdinal += 1;
	      activeLibraryFreshBuildToken = `${reason}:${activeLibraryFreshBuildOrdinal}:${Date.now()}`;
	      activeLibraryExposureSignature = '';
	      localStorage.setItem(LIBRARY_FRESHNESS_BUILD_KEY, String(activeLibraryFreshBuildOrdinal));
	      return activeLibraryFreshBuildToken;
	    }

	    function libraryFreshnessMeta(track = {}, brief = setBriefPayload(), query = '') {
	      if (query || !normalizeSetBrief(brief).enabled) return { penalty: 0, lift: 0, count: 0, lastBuild: 0 };
	      if (!activeLibraryFreshBuildOrdinal) beginLibraryFreshBuild('library');
	      const identity = libraryTrackFreshnessIdentity(track);
	      const missionKey = libraryFreshnessMissionKey(brief);
	      const store = loadLibraryFreshnessStore();
	      const entry = store.missions?.[missionKey]?.exposures?.[identity] || {};
	      const count = Number(entry.count || 0);
	      const lastBuild = Number(entry.lastBuild || 0);
	      const distance = lastBuild ? Math.max(0, activeLibraryFreshBuildOrdinal - lastBuild) : 999;
	      const recentPenalty = distance === 0 ? 12 : (distance <= LIBRARY_FRESHNESS_WINDOW ? Math.max(0, 24 - distance * 3) : 0);
	      const countPenalty = Math.min(18, count * 5);
	      const penalty = Math.min(42, recentPenalty + countPenalty);
	      const lift = count ? 0 : ((hashString(`${missionKey}:${activeLibraryFreshBuildOrdinal}:${identity}`) % 1000) / 1000) * 12;
	      return { penalty, lift, count, lastBuild };
	    }

	    function rememberLibraryFreshness(tracks = [], brief = setBriefPayload(), query = '') {
	      if (query || !normalizeSetBrief(brief).enabled || !Array.isArray(tracks) || !tracks.length) return;
	      if (!activeLibraryFreshBuildOrdinal) beginLibraryFreshBuild('library');
	      const missionKey = libraryFreshnessMissionKey(brief);
	      const identities = tracks.slice(0, LIBRARY_RESULT_STEP).map(libraryTrackFreshnessIdentity).filter(Boolean);
	      const signature = `${activeLibraryFreshBuildToken}|${missionKey}|${activeLibraryBriefLane}|${identities.join('|')}`;
	      if (!identities.length || signature === activeLibraryExposureSignature) return;
	      activeLibraryExposureSignature = signature;
	      const store = loadLibraryFreshnessStore();
	      store.missions = store.missions || {};
	      const mission = store.missions[missionKey] || { exposures: {} };
	      mission.exposures = mission.exposures || {};
	      const now = new Date().toISOString();
	      identities.forEach((identity, index) => {
	        const previous = mission.exposures[identity] || {};
	        mission.exposures[identity] = {
	          count: Math.min(99, Number(previous.count || 0) + 1),
	          lastBuild: activeLibraryFreshBuildOrdinal,
	          lastSeenAt: now,
	          lastLane: activeLibraryBriefLane || 'best',
	          lastRank: index + 1
	        };
	      });
	      const kept = Object.entries(mission.exposures)
	        .sort((a, b) => Number(b[1].lastBuild || 0) - Number(a[1].lastBuild || 0))
	        .slice(0, 600);
	      mission.exposures = Object.fromEntries(kept);
	      store.missions[missionKey] = mission;
	      saveLibraryFreshnessStore(store);
	    }

	    let activeLibraryFreshOrder = null;
	    async function rotateLibraryFreshBuild() {
	      leaveLibraryRecentlyAddedMode();
	      beginLibraryFreshBuild('manual');
	      activeLibraryFreshOrder = {
	        seed: String(activeLibraryFreshBuildOrdinal),
	        previous: mainSearchResults.slice(0, LIBRARY_RESULT_STEP).map(track => AxiomLibrarySort.freshHash(AxiomLibrarySort.freshIdentity(track)))
	      };
	      activeLibraryTopSortStack = [];
	      syncLibraryTopSortControls();
	      resetLibraryResultWindow();
	      renderLibraryBriefLens();
	      await runSearch();
	      showToast(mainSearchResults.length ? 'Fresh Picks: a new selection, with your current filters kept.' : 'No tracks match your current filters. Clear a filter to explore more music.');
	    }
