// Localhost-only AXIOM review and UI preview fixtures.
// Loaded upfront after the runtime shell so review URLs keep working without
// leaving demo state mixed into the production shell file.

function showHelpButtonScaleReview() {
    document.getElementById('music-intake-overlay')?.remove();
    document.getElementById('axiom-arrival-overlay')?.remove();
    document.body.classList.add('help-button-review-mode');
    document.getElementById('help-button-scale-review')?.remove();

    const review = document.createElement('section');
    review.id = 'help-button-scale-review';
    review.setAttribute('aria-label', 'AXIOM Help button scale review');
    review.innerHTML = `
      <header class="help-button-review-header">
        <div>
          <span>AXIOM UI SYSTEM</span>
          <h1>HELP BUTTON SCALE</h1>
          <p>One approved visual language, scaled to fit the space each page already owns.</p>
        </div>
        <div class="help-button-review-key">
          <span><i class="positive"></i> Guidance / positive</span>
          <span><i class="neutral"></i> Neutral utility</span>
          <span><i class="attention"></i> Needs attention</span>
          <span><i class="danger"></i> Destructive</span>
        </div>
      </header>

      <div class="help-button-review-grid">
        <article class="help-button-review-card feature-card">
          <div class="help-button-review-copy">
            <span>LIBRARY</span>
            <h2>Feature Help</h2>
            <p>Keeps the larger Library footprint filled without changing the approved colour, font, or proportions.</p>
            <dl>
              <div><dt>Size</dt><dd>185 × 74</dd></div>
              <div><dt>Ratio</dt><dd>2.5 : 1</dd></div>
              <div><dt>Use</dt><dd>Feature header</dd></div>
            </dl>
          </div>
          <div class="help-button-review-stage large-stage">
            <button onclick="openLibraryGuide(true)" class="axiom-help-btn axiom-help-btn--feature" type="button">Help</button>
          </div>
        </article>

        <article class="help-button-review-card">
          <div class="help-button-review-copy">
            <span>STUDIO</span>
            <h2>Compact Help</h2>
            <p>Fits the Studio command bar while keeping the same approved visual identity.</p>
            <dl>
              <div><dt>Size</dt><dd>100 × 40</dd></div>
              <div><dt>Ratio</dt><dd>2.5 : 1</dd></div>
              <div><dt>Use</dt><dd>Command bar</dd></div>
            </dl>
          </div>
          <div class="help-button-review-stage">
            <div class="help-button-review-actions">
              <button class="help-peer-btn positive" type="button">Save Set</button>
              <button class="help-peer-btn neutral" type="button">Export</button>
              <button class="help-peer-btn more" type="button" aria-label="More set actions">...</button>
              <button onclick="openStudioGuide(true)" class="axiom-help-btn axiom-help-btn--compact" type="button">Help</button>
            </div>
          </div>
        </article>

        <article class="help-button-review-card">
          <div class="help-button-review-copy">
            <span>MATCHING SONGS</span>
            <h2>Approved Reference</h2>
            <p>The original approved size and styling. Every other Help size is calculated from this control.</p>
            <dl>
              <div><dt>Size</dt><dd>100 × 40</dd></div>
              <div><dt>Ratio</dt><dd>2.5 : 1</dd></div>
              <div><dt>Use</dt><dd>Modal header</dd></div>
            </dl>
          </div>
          <div class="help-button-review-stage">
            <div class="help-button-review-actions">
              <button onclick="openSmartListGuide(true)" class="axiom-help-btn axiom-help-btn--compact" type="button">Help</button>
              <button class="help-peer-btn neutral" type="button">Close ×</button>
            </div>
          </div>
        </article>

        <article class="help-button-review-card semantic-card">
          <div class="help-button-review-copy">
            <span>BUTTON MEANING</span>
            <h2>Colour Follows The Action</h2>
            <p>Buttons can share placement and height without pretending every action means the same thing.</p>
          </div>
          <div class="help-button-review-stage semantic-stage">
            <button class="help-peer-btn positive" type="button">Scan Health</button>
            <button class="help-peer-btn neutral" type="button">View Report</button>
            <button class="help-peer-btn attention" type="button">Review Issues</button>
            <button class="help-peer-btn danger" type="button">Clear Library</button>
          </div>
        </article>
      </div>
    `;
    document.body.appendChild(review);
}

const MAGIC_SET_REVIEW_JOURNEYS = {
    magic: [
        [0, 98], [4, 100], [8, 102], [12, 101], [16, 104], [20, 106],
        [24, 108], [28, 110], [32, 113], [36, 116], [40, 120], [44, 124],
        [48, 128], [52, 132], [56, 136], [59.8, 138], [60, 70], [64, 72],
        [68, 74], [72, 77], [76, 80], [80, 83], [84, 86], [88, 89],
        [92, 92], [96, 95], [100, 98], [104, 101], [108, 104], [112, 107],
        [116, 110], [120, 112],
    ],
    around: [
        [0, 101], [5, 100], [10, 102], [15, 101], [20, 104], [25, 102],
        [30, 106], [35, 108], [40, 111], [45, 115], [50, 120], [55, 126],
        [60, 132], [65, 138], [65.2, 70], [70, 73], [75, 77], [80, 82],
        [85, 87], [90, 92], [95, 97], [100, 102], [105, 106], [110, 110],
        [115, 114], [120, 118],
    ],
};

let magicSetReviewBuildMode = 'magic';

function magicSetReviewBpmAt(minute, mode = magicSetReviewBuildMode) {
    const route = MAGIC_SET_REVIEW_JOURNEYS[mode] || MAGIC_SET_REVIEW_JOURNEYS.magic;
    const setLen = Math.max(30, Number(document.getElementById('set-length-selector')?.value || 120));
    const referenceMinute = (Number(minute || 0) / setLen) * 120;
    const exact = route.find(point => Math.abs(point[0] - referenceMinute) < 0.001);
    if (exact) return exact[1];
    for (let index = 1; index < route.length; index += 1) {
        const previous = route[index - 1];
        const next = route[index];
        if (referenceMinute > next[0]) continue;
        const span = next[0] - previous[0];
        if (span <= 0.25 || Math.abs(next[1] - previous[1]) >= 45) return next[1];
        const progress = Math.max(0, Math.min(1, (referenceMinute - previous[0]) / span));
        return Math.round((previous[1] + ((next[1] - previous[1]) * progress)) * 10) / 10;
    }
    return route[route.length - 1][1];
}

function createMagicSetReviewTracks(mode = 'magic') {
    const setLen = Math.max(30, Number(document.getElementById('set-length-selector')?.value || 120));
    const avgDuration = Math.max(1, Number(document.getElementById('avg-duration-selector')?.value || 2));
    const targetCount = Math.max(1, Math.min(100, Math.round(setLen / avgDuration)));
    const titles = [
        'TOOT IT UP - MARKCUTZ THROWBACK INTRO (DIRTY)', 'SEPTEMBER', 'THIS WILL BE',
        'CRAZY IN LOVE', 'LEVITATING', 'YEAH!', 'DANCING QUEEN', 'I WANNA DANCE',
        'UPTOWN FUNK', 'LOW', 'MR. BRIGHTSIDE', 'SIGNED, SEALED, DELIVERED',
    ];
    const artists = [
        'BIG BOOGIE', 'EARTH, WIND & FIRE', 'NATALIE COLE', 'BEYONCE', 'DUA LIPA',
        'USHER', 'ABBA', 'WHITNEY HOUSTON', 'MARK RONSON', 'FLO RIDA',
        'THE KILLERS', 'STEVIE WONDER',
    ];
    const camelot = ['4A', '5A', '6A', '7A', '8A', '9A', '10A', '11A', '12A', '1A', '2A', '3A'];
    return Array.from({ length: targetCount }, (_, index) => {
        const minute = targetCount === 1 ? 0 : (setLen * index) / (targetCount - 1);
        const phase = index / Math.max(1, targetCount - 1);
        return {
            title: titles[index % titles.length],
            artist: artists[index % artists.length],
            path: `preview://magic-set-${mode}-${index + 1}`,
            artwork: '/static/axiom-mark.png',
            bpm: magicSetReviewBpmAt(minute, mode),
            camelot: camelot[index % camelot.length],
            energy: phase < 0.2 ? 'Low' : (phase < 0.72 ? 'Mid' : 'Peak'),
            duration_min: avgDuration,
            duration_sec: avgDuration * 60,
            year: 2025,
            genre: 'Open Format',
        };
    });
}

async function populateMagicSetReviewFixture(mode = 'magic') {
    magicSetReviewBuildMode = mode === 'around' ? 'around' : 'magic';
    libraryHasTracks = true;
    document.getElementById('music-intake-overlay')?.remove();
    document.getElementById('axiom-arrival-overlay')?.remove();
    document.getElementById('master-hud')?.classList.remove('active');
    currentPlaylist = createMagicSetReviewTracks(magicSetReviewBuildMode);
    currentRoutePlaylist = [];
    activeStudioView = 'manual';
    graphDots = [];
    anchorTargetDot = null;
    graphAnchorIndex = -1;
    magicSetStudioCtaReady = true;
    updateLibraryCount(currentPlaylist.length);
    document.getElementById('set-brief-view')?.classList.add('hidden');
    document.getElementById('studio-start-view')?.classList.add('hidden');
    document.getElementById('studio-active-view')?.classList.remove('hidden');
    showTab('studio');
    setGraphMode(true);
    renderPlaylist(currentPlaylist);
    initSortable();
    updateStudioToolsAvailability();
    await recalculateAudit();
    updateGraphTimeline();
    updateMagicSetScoreCard(magicSetReviewBuildMode === 'around' ? 86 : 83);
    const scoreDisplay = document.getElementById('set-score-display');
    if (scoreDisplay) scoreDisplay.textContent = magicSetReviewBuildMode === 'around' ? '86' : '83';
    const previewTrack = currentPlaylist[0];
    const playerTitle = document.getElementById('ap-title');
    const playerArtist = document.getElementById('ap-artist');
    if (previewTrack && playerTitle && playerArtist) {
        playerTitle.textContent = previewTrack.title;
        playerArtist.textContent = previewTrack.artist;
    }
    updateMagicSetStudioCta();
    window.setTimeout(() => {
        document.getElementById('music-intake-overlay')?.remove();
        document.getElementById('axiom-arrival-overlay')?.remove();
        document.getElementById('master-hud')?.classList.remove('active');
    }, 250);
}

let axiomUiPreviewStarted = false;

async function runAxiomUiPreviewFixture() {
    const reviewMode = axiomReviewMode();
    const uiPreviewMode = axiomUiPreviewMode();
    if (!reviewMode && !uiPreviewMode) return;
    if (axiomUiPreviewStarted) return;
    axiomUiPreviewStarted = true;
    const previewParams = new URLSearchParams(window.location.search);
    const previewTheme = previewParams.get('theme');
    const studioDawReviewMode = previewParams.get('studio_daw');
    const shouldOpenStudioDawReview = studioDawReviewMode === '1' || studioDawReviewMode === 'direct';
    const liteProOnlyReview = isAxiomLite() && (
        reviewMode === 'performance'
        || reviewMode === 'license-access'
        || shouldOpenStudioDawReview
        || ['license-key', 'license-get-access', 'dialog-djay', 'dialog-djay-complete', 'performance-providers'].includes(uiPreviewMode)
        || String(uiPreviewMode || '').startsWith('performance-')
        || String(uiPreviewMode || '').startsWith('djay-')
    );
    if (liteProOnlyReview) {
        window.setTimeout(() => {
            document.getElementById('music-intake-overlay')?.remove();
            document.getElementById('axiom-arrival-overlay')?.remove();
            closeAxiomReleaseSplash('later');
            if (typeof openLiteProInfo === 'function') openLiteProInfo();
        }, 80);
        return;
    }
    if (reviewMode === 'first-login' || uiPreviewMode === 'first-login') {
        document.getElementById('first-login-preview')?.removeAttribute('hidden');
        setFirstLoginPreviewMode('signin');
        return;
    }
    const clearStudioDawReviewOverlays = () => {
        document.getElementById('music-intake-overlay')?.remove();
        document.getElementById('axiom-arrival-overlay')?.remove();
        document.getElementById('master-hud')?.classList.remove('active');
        closeAxiomReleaseSplash('later');
    };
    const openStudioDawReviewDirectly = () => {
        if (!shouldOpenStudioDawReview) return;
        [0, 250, 750, 1500].forEach(delay => window.setTimeout(clearStudioDawReviewOverlays, delay));
        const dawMode = previewParams.get('daw_mode') === 'edit' ? 'edit' : 'mixtape';
        let attempts = 0;
        const openWhenReady = () => {
            clearStudioDawReviewOverlays();
            attempts += 1;
            if (window.AxiomStudioDaw?.showStudioDawSetProject && Array.isArray(currentPlaylist) && currentPlaylist.length) {
                window.AxiomStudioDaw.showStudioDawSetProject(currentPlaylist, dawMode);
                window.setTimeout(clearStudioDawReviewOverlays, 150);
                return;
            }
            if (attempts < 50) window.setTimeout(openWhenReady, 100);
        };
        window.setTimeout(openWhenReady, 80);
    };
    if (previewTheme === 'day' || previewTheme === 'light') {
        applyAxiomTheme('day');
    } else if (previewTheme === 'night' || previewTheme === 'dark' || shouldOpenStudioDawReview) {
        applyAxiomTheme('dark');
    }
    // This review mode uses copied real media and an isolated runtime. Keep the
    // local review bypass, but do not inject any demo tracks or UI state.
    if (reviewMode === 'real-data-audit' || reviewMode === 'entrance') return;
    const mode = uiPreviewMode
        || (['studio-active', 'anchor-selection'].includes(reviewMode) ? 'studio-toolbar' : '');
    if (mode === 'echo-out') {
        window.setTimeout(() => {
            document.getElementById('axiom-arrival-overlay')?.remove();
            document.getElementById('master-hud')?.classList.remove('active');
            closeAxiomReleaseSplash('later');
            AxiomStudioDaw.newBlankProject();
            const project=AxiomStudioDaw.activeProject;
            project.title='Echo Out workflow preview (no audio)';
            project.arrangementClips=[{id:'echo-review-clip',path:'preview://echo-out',title:'Example audio - UI preview only',sectionId:'left-deck',trackIndex:0,bpm:120,key:'8A',timelineStartBeat:0,timelineDurationBeats:32,sourceStartBeat:0,sourceDurationBeats:32,sourceDurationSeconds:16}];
            if(previewParams.get('clips')==='multiple'){
                const first=project.arrangementClips[0];first.timelineDurationBeats=16;first.sourceDurationBeats=16;
                project.arrangementClips.push({...first,id:'echo-review-second',title:'Second clip - UI preview only',timelineStartBeat:16},
                    {...first,id:'echo-review-right',title:'Other deck - UI preview only',sectionId:'right-deck',timelineStartBeat:24,timelineDurationBeats:8,sourceDurationBeats:8});
            }
            AxiomStudioDaw.refreshArrangement();
            AxiomStudioDaw.setRange('left-deck',24,32);
            showToast('UI preview only. Right-click the selected bars and choose Echo Out.');
        },1800);
        return;
    }
    if (mode === 'key-sync-preparation') {
        window.setTimeout(() => {
            document.getElementById('axiom-arrival-overlay')?.remove();
            document.getElementById('master-hud')?.classList.remove('active');
            closeAxiomReleaseSplash('later');
            AxiomStudioDaw.newBlankProject();
            const banner=document.getElementById('daw-preparation-status');
            banner.hidden=false;
            document.getElementById('daw-preparation-message').textContent='Preparing audio…';
            document.getElementById('daw-preparation-message').title='UI preview only — playback preparation status. No audio is being processed.';
        }, 1800);
        return;
    }
    if (mode === 'sweep-audio') {
        window.setTimeout(() => {
            document.getElementById('axiom-arrival-overlay')?.remove();
            document.getElementById('master-hud')?.classList.remove('active');
            closeAxiomReleaseSplash('later');
            AxiomStudioDaw.newBlankProject();
            AxiomDawSweeps.open();
        }, 1800);
        return;
    }
    if (['health-scan-start', 'health-scan-working', 'health-scan-receipt', 'health-scan-stopped'].includes(mode)) {
        const finished = mode === 'health-scan-receipt';
        const stopped = mode === 'health-scan-stopped';
        const working = mode === 'health-scan-working';
        const mount = () => {
            document.getElementById('axiom-arrival-overlay')?.remove();
            document.getElementById('master-hud')?.classList.remove('active');
            document.body.classList.remove('axiom-start-mode');
            libraryHasTracks = true;
            showTab('health');
            const job = {
                job_id: `preview-${mode}`, review_only: true, status: finished ? 'complete' : stopped ? 'stopped' : 'running',
                work_stage: working ? 'analysis' : 'inventory', worker_alive: !finished && !stopped,
                started_at: new Date(Date.now() - (working ? 28000 : 1000)).toISOString(),
                total_steps: 40, processed_steps: finished ? 40 : working || stopped ? 10 : 0,
                processed_tracks: finished ? 40 : working || stopped ? 10 : 0,
                batch_completed_steps: working ? 5 : 0, cache_verification: finished || working || stopped ? 'verified' : 'not_started',
                totals: {checked: finished ? 40 : working || stopped ? 10 : 0, fixed: finished ? 40 : working || stopped ? 10 : 0, estimated: 0, unresolved: 0, still_missing: finished ? 0 : working || stopped ? 30 : 40},
                scope_summary: {checked:1000, already_healthy:960, repaired:finished ? 40 : working || stopped ? 10 : 0, skipped:0, needs_attention:finished ? 0 : working || stopped ? 30 : 40},
                active_actions: finished || stopped ? [] : [{title: working ? 'Night Signal' : 'Checking 1,000 library tracks', detail: working ? 'Comparing key evidence across the beginning, middle and end.' : 'Finding tracks that already have BPM, key and year.'}],
                message: 'UI preview only. Invented scan data; no library changes.', recent_events: [], lanes:['missing_key'],
            };
            updateUnifiedHealthProgress(job);
            const consolePanel = document.querySelector('.health-approved-console');
            if (consolePanel && !document.getElementById('health-scan-preview-notice')) {
                const notice = document.createElement('p'); notice.id = 'health-scan-preview-notice';
                notice.textContent = job.message; consolePanel.prepend(notice);
            }
        };
        mount(); window.setTimeout(mount, 500);
        return;
    }
    if (reviewMode === 'license-access' || mode === 'license-key' || mode === 'license-get-access') {
        // Local-only, serial-free approval fixture for both production access
        // states. It never validates, stores, or submits credentials.
        document.body.classList.add('license-access-review');
        libraryHasTracks = false;
        currentPlaylist = [];
        currentRoutePlaylist = [];
        updateLibraryCount(0);
        document.getElementById('axiom-arrival-overlay')?.remove();
        showConnectMusicView();
        const accessView = mode === 'license-get-access' ? 'checkout' : 'activate';
        const fixture = {
            required: true,
            usable: false,
            configured: true,
            status: 'guest_preview',
            access_tier: 'guest_preview',
            preview_usable: true,
            activation_required_before_library: true,
            preferred_access_view: accessView,
            email: '',
            device_label: 'Review Mac',
        };
        closeAxiomReleaseSplash('later');
        document.getElementById('update-modal')?.classList.remove('active');
        openLicenseModal(fixture, true);
        setLicenseAccessView(accessView);
        selectAxiomPlan('yearly');
        window.setTimeout(() => {
            document.getElementById('axiom-arrival-overlay')?.remove();
            showConnectMusicView();
            openLicenseModal(fixture, true);
            setLicenseAccessView(accessView);
            selectAxiomPlan('yearly');
        }, 500);
        window.setTimeout(() => {
            closeAxiomReleaseSplash('later');
            document.getElementById('update-modal')?.classList.remove('active');
            openLicenseModal(fixture, true);
            setLicenseAccessView(accessView);
            selectAxiomPlan('yearly');
        }, 1400);
        return;
    }
    if (reviewMode === 'help-center') {
        libraryHasTracks = true;
        localStorage.setItem(getAxiomWalkthroughKey('axiomWalkthroughV2Seen'), 'true');
        document.getElementById('music-intake-overlay')?.remove();
        document.getElementById('axiom-arrival-overlay')?.remove();
        showTab('library');
        window.setTimeout(() => {
            openUniversalHelp({ query: 'I am DJing an event and need to figure out what music fits' });
        }, 120);
        return;
    }
    if (reviewMode === 'help-buttons') {
        showHelpButtonScaleReview();
        return;
    }
    if (reviewMode === 'loading-screen') {
        // The Loading Screen approval route uses the same installed-update
        // composition that ships in the app. Keep the live version/release
        // payload so the review is an exact deployment preview, not mock copy.
        document.getElementById('music-intake-overlay')?.remove();
        try {
            const response = await fetch('/api/app/version');
            const data = await response.json();
            if (!response.ok || data.success === false) throw new Error(data.error || 'Version unavailable');
            openAxiomReleaseSplash({
                ...data,
                packaged: true,
                splash_mode: 'update',
            });
        } catch (error) {
            console.warn('[AXIOM] Loading Screen review could not read release data:', error);
        }
        return;
    }
    if (reviewMode === 'first-launch-empty') {
        // Repeatable first-PKG-launch review: use the real Quick Start over the
        // real zero-track connection screen without seeding or touching music.
        libraryHasTracks = false;
        currentPlaylist = [];
        currentRoutePlaylist = [];
        updateLibraryCount(0);
        showConnectMusicView();
        showAxiomArrival(true);
        return;
    }
    if (reviewMode === 'quick-start') {
        // Approval URLs must be repeatable: completing or skipping the tour can
        // reveal Axiom Start, while a refresh always returns reviewers to step 1.
        libraryHasTracks = true;
        currentPlaylist = [];
        currentRoutePlaylist = [];
        updateLibraryCount(18);
        showAxiomStart();
        showAxiomArrival(true);
        return;
    }
    if (reviewMode === 'studio-start') {
        // Keep the approved Axiom Start review address repeatable even when the
        // local development cache is empty. This fixture changes UI state only;
        // it never seeds, writes, or modifies a music library.
        libraryHasTracks = true;
        currentPlaylist = [];
        currentRoutePlaylist = [];
        updateLibraryCount(18);
        document.getElementById('music-intake-overlay')?.remove();
        document.getElementById('axiom-arrival-overlay')?.remove();
        showAxiomStart();
        return;
    }
    if (reviewMode === 'magic-set') {
        await populateMagicSetReviewFixture('magic');
        return;
    }
    if (reviewMode === 'health') {
        // Repeatable browser-only Health trial. It deliberately does not read or
        // write the real library so delayed API responses cannot replace the
        // dummy queues while a reviewer is testing the workflow.
        libraryHasTracks = true;
        localStorage.setItem(getAxiomWalkthroughKey('axiomWalkthroughV2Seen'), 'true');
        document.getElementById('music-intake-overlay')?.remove();
        document.getElementById('axiom-arrival-overlay')?.remove();
        showTab('health');
        {
            const metadataCleanupPreview = String(uiPreviewMode || '').startsWith('metadata-cleanup')
                || ['health-title-cleanup', 'health-artist-cleanup', 'health-cleanup-sandbox'].includes(String(uiPreviewMode || ''));
            const healthBand = new URLSearchParams(window.location.search).get('health_band');
            const healthStressLarge = new URLSearchParams(window.location.search).get('health_stress') === 'large';
            const repairDemoEnabled = Boolean(healthBand || healthStressLarge || !metadataCleanupPreview);
            const reviewTracks = repairDemoEnabled ? [
                {
                    path: '/tmp/bronze-room-intro.mp3',
                    filename: 'bronze-room-intro.mp3',
                    title: 'Bronze Room (Clean Intro)',
                    artist: 'Demo Signal',
                    bpm: 0,
                    camelot: '8A',
                    year: 2019,
                    fKey: 'missing_bpm',
                    hType: 'Missing BPM',
                    health_review_fixture: true,
                },
                {
                    path: '/tmp/city-lights-club-mix.mp3',
                    filename: 'city-lights-club-mix.mp3',
                    title: 'City Lights (Club Mix)',
                    artist: 'North Avenue',
                    bpm: 0,
                    camelot: '9A',
                    year: 2021,
                    fKey: 'missing_bpm',
                    hType: 'Missing BPM',
                    health_review_fixture: true,
                },
                {
                    path: '/tmp/midnight-transit-remix.mp3',
                    filename: 'midnight-transit-remix.mp3',
                    title: 'Midnight Transit (Remix)',
                    artist: 'Static Motion',
                    bpm: 0,
                    camelot: '10A',
                    year: 2016,
                    fKey: 'missing_bpm',
                    hType: 'Missing BPM',
                    health_review_fixture: true,
                },
                {
                    path: '/tmp/take-me-higher-extended-mix.mp3',
                    filename: 'take-me-higher-extended-mix.mp3',
                    title: 'Take Me Higher (Extended Mix)',
                    artist: 'Miguel Campbell',
                    bpm: 124,
                    camelot: '',
                    year: 2012,
                    fKey: 'missing_key',
                    hType: 'Missing Key',
                    health_review_fixture: true,
                },
                {
                    path: '/tmp/riverside-vocal-edit.mp3',
                    filename: 'riverside-vocal-edit.mp3',
                    title: 'Riverside (Vocal Edit)',
                    artist: 'Harbour Lines',
                    bpm: 126,
                    camelot: '',
                    year: 2020,
                    fKey: 'missing_key',
                    hType: 'Missing Key',
                    health_review_fixture: true,
                },
                {
                    path: '/tmp/neon-sunday-extended.mp3',
                    filename: 'neon-sunday-extended.mp3',
                    title: 'Neon Sunday (Extended)',
                    artist: 'Weekend Circuit',
                    bpm: 118,
                    camelot: '',
                    year: 2018,
                    fKey: 'missing_key',
                    hType: 'Missing Key',
                    health_review_fixture: true,
                },
                {
                    path: '/tmp/night-drive-extended-mix.mp3',
                    filename: 'night-drive-extended-mix.mp3',
                    title: 'Night Drive (Extended Mix)',
                    artist: 'Massane',
                    bpm: 100,
                    camelot: '',
                    year: 2022,
                    fKey: 'key_review',
                    hType: 'Key Review',
                    key_analysis_reason: 'Insufficient harmonic clarity',
                    key_analysis_next_action: 'Review manually or retry scan',
                    health_review_fixture: true,
                },
            ] : [];
            const reviewHealthProfiles = {
                baseline: { health_eligible_tracks: 500, health_unique_affected_tracks: 5, health_issue_rate_percent: 1, health_overall_state: 'baseline' },
                healthy: { health_eligible_tracks: 1000, health_unique_affected_tracks: 50, health_issue_rate_percent: 5, health_overall_state: 'healthy' },
                attention: { health_eligible_tracks: 1000, health_unique_affected_tracks: 100, health_issue_rate_percent: 10, health_overall_state: 'attention' },
                bad: { health_eligible_tracks: 1000, health_unique_affected_tracks: 200, health_issue_rate_percent: 20, health_overall_state: 'bad' },
            };
            const reviewHealthProfile = reviewHealthProfiles[healthBand] || {
                health_eligible_tracks: 24,
                health_review_library_tracks: 24,
                health_unique_affected_tracks: repairDemoEnabled ? 6 : 0,
                health_issue_rate_percent: repairDemoEnabled ? 25 : 0,
                health_overall_state: repairDemoEnabled ? 'bad' : 'baseline',
            };
            currentHealthSummary = {
                ...currentHealthSummary,
                missing_file: 0,
                missing_bpm: repairDemoEnabled ? 3 : 0,
                missing_key: repairDemoEnabled ? 3 : 0,
                missing_year: 0,
                bpm_review: 0,
                key_review: repairDemoEnabled ? 1 : 0,
                health_baseline_minimum_tracks: 1000,
                health_green_max_percent: 5,
                health_orange_max_percent: 15,
                ...reviewHealthProfile,
            };
            currentHealthTracks = reviewTracks;
            visibleHealthTracks = reviewTracks.slice();
            const reviewNewMusicTracks = [reviewTracks[0], reviewTracks[3], reviewTracks[6]];
            currentHealthNewMusic = repairDemoEnabled ? {
                batch_id: 'health-review-new-music',
                added_at: new Date(Date.now() - (8 * 60 * 1000)).toISOString(),
                source: 'music_folder',
                fallback: false,
                total: reviewNewMusicTracks.length,
                ready: 0,
                needs_prep: 2,
                review: 1,
                counts: { missing_bpm: 1, missing_key: 1, key_review: 1, missing_year: 0, missing_file: 0 },
                paths: reviewNewMusicTracks.map(track => track.path),
                samples: reviewNewMusicTracks.map(track => ({ ...track })),
                source_audio_untouched: true,
            } : {};
            activeHealthInboxItem = repairDemoEnabled ? 'missing_bpm' : '';
            lastHealthCheckAt = Date.now();
            setHealthSnapshotState('ready');
            updateLibraryCount(reviewHealthProfile.health_eligible_tracks);
            lastUnifiedHealthJob = {
                status: 'idle',
                processed_steps: 0,
                total_steps: repairDemoEnabled ? 6 : 0,
                lanes: repairDemoEnabled ? ['missing_bpm', 'missing_key'] : [],
                counts: { missing_bpm: repairDemoEnabled ? 3 : 0, missing_key: repairDemoEnabled ? 3 : 0, missing_year: 0 },
                totals: { checked: 0, fixed: 0, estimated: 0, unresolved: 0, still_missing: repairDemoEnabled ? 6 : 0 },
                active_actions: [],
                recent_events: [],
                message: repairDemoEnabled
                    ? 'Choose Missing BPM or Missing Key to run the safe browser-only demo.'
                    : 'Metadata cleanup preview is ready. Repair-demo rows are disabled for this review.',
            };
            if (healthStressLarge) {
                currentHealthSummary = {
                    ...currentHealthSummary,
                    missing_bpm: 25146,
                    missing_key: 25147,
                    health_unique_affected_tracks: 50293,
                    health_eligible_tracks: 50317,
                    health_review_library_tracks: 50317,
                };
                lastUnifiedHealthJob = {
                    ...lastUnifiedHealthJob,
                    status: 'running',
                    flow: 'library',
                    processed_steps: 27,
                    total_steps: 50317,
                    started_at_ms: Date.now() - (5 * 60 * 1000 + 58 * 1000),
                    totals: { checked: 27, fixed: 0, estimated: 0, unresolved: 27, still_missing: 50290 },
                    active_actions: [{ title: '(DJ OWE) 4BATZ - ACT II DATE AT 8 (INTRO) (CLEAN)', artist: 'Unknown Artist', lane: 'missing_key' }],
                    recent_events: [],
                    message: 'Large-library Health stress fixture. Source audio stays untouched.',
                };
            }
            if (uiPreviewMode === 'health-session-receipt') {
                currentHealthSummary.health_eligible_tracks = 72;
                currentHealthSummary.health_review_library_tracks = 72;
                updateLibraryCount(72);
                seedAxiomSessionReceiptPreview();
                activeHealthApprovedResultsTab = 'completed';
                lastUnifiedHealthJob = {
                    ...lastUnifiedHealthJob,
                    status: 'complete',
                    processed_steps: 3,
                    total_steps: 6,
                    totals: { checked: 3, fixed: 3, estimated: 0, unresolved: 0, still_missing: 3 },
                    message: 'Session work saved. Three Health items still need attention.',
                };
            }
            currentHealthCleanupAudit = healthReviewCleanupDemoAudit();
            healthCleanupAuditLoadedAt = Date.now();
            updateHealthCleanupPanel(currentHealthCleanupAudit);
            updateHealthRepairCenter(
                currentHealthSummary,
                'Library Health',
                repairDemoEnabled
                    ? 'This browser-only trial has three missing BPM tracks and three missing-key tracks ready to repair.'
                    : 'This browser-only metadata cleanup review keeps repair queues clear so title and artist cleanup can be inspected by itself.'
            );
            renderHealthInboxDetail();
            renderHealthApprovedWorking(lastUnifiedHealthJob);
            if (uiPreviewMode === 'health-session-receipt') setHealthApprovedResultsTab('completed');
            const reviewSetBuildingCount = ['stingers', 'transitions', 'sound_effects', 'mixtapes']
                .reduce((total, key) => total + Number(currentHealthCleanupAudit?.summary?.[key] || 0), 0);
            setHealthText('health-inbox-set-building-count', reviewSetBuildingCount.toLocaleString());
            setHealthTopScanBanner(false);
            if (new URLSearchParams(window.location.search).get('health_set') === 'expanded') {
                toggleHealthApprovedSetBuilding(true);
            }
            document.getElementById('health-progress-container')?.classList.add('hidden');
            const openBeatgridDoctorReview = () => {
                if (uiPreviewMode !== 'beatgrid-doctor') return;
                window.AxiomHealthCockpit?.openDoctor?.();
            };
            openBeatgridDoctorReview();
            if (metadataCleanupPreview || uiPreviewMode === 'health-restore-bin') {
                if (uiPreviewMode === 'health-restore-bin') {
                    await openHealthRestoreBin();
                } else if (uiPreviewMode === 'health-cleanup-sandbox') {
                    await openHealthCleanupSandboxWorkbench({ openRules: true });
                } else if (uiPreviewMode === 'health-artist-cleanup') {
                    await window.reviewHealthUtilityCategory?.('artist_format');
                } else {
                    await window.reviewHealthUtilityCategory?.('title_cleanup');
                }
                setTimeout(async () => {
                    document.getElementById('axiom-arrival-overlay')?.remove();
                    document.body.classList.remove('axiom-start-mode');
                    if (uiPreviewMode === 'health-restore-bin') {
                        await openHealthRestoreBin();
                    } else if (uiPreviewMode === 'health-cleanup-sandbox') {
                        await openHealthCleanupSandboxWorkbench({ openRules: true });
                    } else if (uiPreviewMode === 'health-artist-cleanup') {
                        await window.reviewHealthUtilityCategory?.('artist_format');
                    } else {
                        await window.reviewHealthUtilityCategory?.('title_cleanup');
                    }
                }, 500);
            } else {
                setTimeout(() => {
                    document.getElementById('axiom-arrival-overlay')?.remove();
                    document.body.classList.remove('axiom-start-mode');
                    if (uiPreviewMode === 'library-guide-day') {
                        showTab('library');
                        setTimeout(() => openLibraryGuide(true), 120);
                        return;
                    }
                    showTab('health');
                    updateHealthRepairCenter(
                        currentHealthSummary,
                        'Library Health',
                        repairDemoEnabled
                            ? 'This browser-only trial has three missing BPM tracks and three missing-key tracks ready to repair.'
                            : 'This browser-only metadata cleanup review keeps repair queues clear so title and artist cleanup can be inspected by itself.'
                    );
                    renderHealthInboxDetail();
                    renderHealthApprovedWorking(lastUnifiedHealthJob);
                    openBeatgridDoctorReview();
                    if (uiPreviewMode === 'health-session-receipt') setHealthApprovedResultsTab('completed');
                    if (healthStressLarge) {
                        window.clearInterval(window.axiomHealthStressPreviewTimer);
                        window.axiomHealthStressPreviewTimer = window.setInterval(() => {
                            renderHealthApprovedWorking(lastUnifiedHealthJob);
                        }, 850);
                    }
                    if (uiPreviewMode === 'health-active' && !healthStressLarge) {
                        window.setTimeout(() => startHealthReviewDemoScan(
                            ['missing_bpm', 'missing_key'],
                            'BPM & Key',
                            null,
                            { flow: 'new_music', intervalMs: 2400 }
                        ), 180);
                    }
                }, 500);
            }
        }
        if (uiPreviewMode === 'health-year-evidence') {
            document.getElementById('health-release-year-csv-review-note')?.classList.remove('hidden');
            await window.showReleaseYearTestLibrary?.();
        }
        return;
    }
    if (['serato-naming', 'djay-naming', 'serato-receipt', 'djay-receipt'].includes(reviewMode)
        && ['127.0.0.1', 'localhost'].includes(window.location.hostname)) {
        document.getElementById('axiom-arrival-overlay')?.remove();
        document.getElementById('music-intake-overlay')?.remove();
        const djay = reviewMode.startsWith('djay');
        if (reviewMode.endsWith('naming')) {
            showAxiomDjExportName({destination:djay ? 'djay' : 'serato', trackCount:24, orderSource:'Harmonic Route', defaultValue:'Late Night Set', copy:`Quit ${djay ? 'djay Pro' : 'Serato DJ Pro'} before export. Your music files stay untouched.`, confirmText:djay ? 'Add To djay Pro' : 'Add To Serato'});
        } else {
            showSeratoExportSuccess({exported_tracks:24, total_tracks:24, missing_tracks:0, delivery_verified:true, serato_library_registered:!djay, database_readback_verified:true, serato_playlist_name:'Late Night Set', djay_playlist_name:'Late Night Set', order_source:'Harmonic Route', target:djay ? 'djay' : 'serato'}, 'Late Night Set', djay ? 'djay' : 'serato');
        }
        return;
    }
    if (['music-intake', 'music-intake-complete', 'music-intake-recovery'].includes(reviewMode)) {
        // Local-only approval state for the real source-to-index transition.
        // It mounts the same production surfaces without scanning or writing a
        // music library, so overlap and packaged-viewport regressions are visible.
        libraryHasTracks = false;
        document.getElementById('axiom-arrival-overlay')?.remove();
        showConnectMusicView();
        await openLibrarySourcePicker();
        const sourceModal = document.getElementById('library-source-modal');
        sourceModal?.classList.add('music-intake-source-suspended');
        sourceModal?.setAttribute('aria-hidden', 'true');
        if (reviewMode === 'music-intake-recovery') {
            showSeratoConnectionRecovery({
                message: 'Activate AXIOM before you connect your Serato library. Your 14 days begin only after activation.'
            }, { source: 'review_fixture' });
        } else {
            showMusicIntakeOverlay({
                indexed: 2325,
                total: 9688,
                folderName: 'Music Library',
                stage: 'Building Performance Intelligence',
                title: 'Music Index',
                message: 'AXIOM is reading BPM, key, year, energy, and playable track links.'
            });
            updateMusicIntakeOverlay({
                indexed: 2325,
                total: 9688,
                folderName: 'Music Library',
                stage: 'Building Performance Intelligence'
            });
            if (reviewMode === 'music-intake-complete') {
                completeMusicIntakeOverlay({indexed:9688, total:9688, folderName:'Music Library', stage:'Library Ready', message:'Your tracks are searchable now. Track details are finishing in the background.'});
            }
        }
        return;
    }
    if (reviewMode === 'library-source') {
        // Local-only approval fixture for the production two-source chooser.
        // It opens the real modal without invoking a picker or touching a library.
        document.getElementById('axiom-arrival-overlay')?.remove();
        showTab('library');
        if (uiPreviewMode === 'serato-connect-progress') {
            showMusicIntakeOverlay({
                indexed: 0,
                total: 0,
                progress: 0,
                indeterminate: true,
                folderName: 'Serato',
                stage: 'Opening Database V2',
                title: 'Serato Library Index',
                message: 'Opening database V2 and counting its track records... 4s elapsed.'
            });
            window.setTimeout(() => updateMusicIntakeOverlay({
                indexed: 12640,
                total: 50293,
                progress: 23,
                indeterminate: false,
                folderName: 'Serato',
                stage: 'Reading Serato Tracks',
                title: 'Serato Library Index',
                message: 'Reading Serato track 12,640 of 50,293... 12,118 usable local tracks found.'
            }), 1200);
            window.setTimeout(() => updateMusicIntakeOverlay({
                indexed: 50293,
                total: 50293,
                progress: 88,
                indeterminate: false,
                folderName: 'Serato',
                stage: 'Merging Serato Records',
                title: 'Serato Library Index',
                message: 'Merging completed Serato records into AXIOM...'
            }), 2800);
            return;
        }
        await openLibrarySourcePicker();
        return;
    }
    if (reviewMode === 'performance') {
        // Direct approval route for the real Performance workspace. Keep DJ
        // bridge polling paused so review does not impersonate a connected
        // Serato or djay Pro session.
        libraryHasTracks = true;
        document.getElementById('music-intake-overlay')?.remove();
        document.getElementById('axiom-arrival-overlay')?.remove();
        performanceSeratoEnabled = false;
        if (typeof performanceStopSeratoBridge === 'function') performanceStopSeratoBridge();
        performanceCleanOnly = false;
        performanceTimeline = [];
        performanceAnchorTrack = normalizeModalTrackMetadata({
            path: '/tmp/axiom-performance-review-anchor.mp3',
            title: 'Dangerous City (Clean)',
            artist: 'DVSN and Ty Dolla Sign',
            bpm: 100,
            camelot: '5B',
            energy: 'Mid',
            year: 2020,
            explicit: false,
        });
        performanceSuggestions = performanceFilteredSuggestions([
            {
                path: '/tmp/axiom-performance-review-clean.mp3',
                title: 'Rocking That Thing (Clean Intro)',
                artist: 'The Dream',
                bpm: 100,
                camelot: '5B',
                energy: 'Mid',
                year: 2009,
                explicit: false,
            },
            {
                path: '/tmp/axiom-performance-review-dirty.mp3',
                title: 'Yiken (Dirty Short Edit)',
                artist: 'Priceless Da Roc',
                bpm: 100,
                camelot: '6B',
                energy: 'Peak',
                year: 2024,
                explicit: true,
            },
            {
                path: '/tmp/axiom-performance-review-unknown.mp3',
                title: 'Summer Signal (Original Mix)',
                artist: 'Mira Lane',
                bpm: 100,
                camelot: '4B',
                energy: 'Mid',
                year: 2022,
            },
        ], { limit: 16 });
        if (new URLSearchParams(window.location.search).get('ui_preview') === 'performance-deck-tempo') {
          performancePlayingBpmOverride = 0;
          performanceTempoIntent = '';
          performanceAnchorTrack = {
            path: '/tmp/axiom-performance-review-deck-tempo.mp3',
            title: 'Deck Tempo Review', artist: 'AXIOM Test',
            bpm: 120, native_bpm: 120, playing_bpm: 60,
            live_provider: 'djay', connected_from: 'djay_live',
            source_label: 'djay Pro (review)', deck_bpm_status: 'following',
          };
          performanceSuggestions = performanceFilteredSuggestions([60, 62, 120, 128, 130].map(bpm => ({
            path: `/tmp/axiom-performance-review-tempo-${bpm}.mp3`,
            title: `Tempo Review ${bpm}`, artist: `Review Artist ${bpm}`, bpm,
          })));
        }
        if (new URLSearchParams(window.location.search).get('ui_preview') === 'performance-session-ledger') {
          const receiptSeed = [
            ['Dangerous City (Clean)', 'DVSN and Ty Dolla Sign', 100, 'R&B', 2020, 12],
            ['Rocking That Thing (Clean Intro)', 'The Dream', 100, 'R&B', 2009, 8],
            ['Summer Signal (Original Mix)', 'Mira Lane', 103, 'House', 2022, 1],
            ['Night Window', 'North Avenue', 106, 'House', 2024, 0],
            ['Hold The Floor', 'Static Motion', 109, 'Hip-Hop', 2018, 17],
            ['Open Late', 'Harbour Lines', 112, 'R&B', 2023, 2],
            ['Room To Move', 'Weekend Circuit', 116, 'House', 2025, 0],
            ['Final Approach', 'Lowkey Hustle', 118, 'Hip-Hop', 2017, 9],
          ];
          performanceTimeline = receiptSeed.map((item, index) => ({
            path: `/tmp/axiom-performance-receipt-${index + 1}.mp3`,
            title: item[0], artist: item[1], bpm: item[2], genre: item[3], year: item[4], play_count: item[5],
            played_at: new Date(Date.now() - (receiptSeed.length - index) * 126000).toISOString(),
          }));
          performanceReceiptPreviewTracks = performanceTimeline.map(track => ({ ...track }));
          performanceAnchorTrack = performanceTimeline[0];
        }
        switchTab('performance');
        renderPerformanceMode();
        if (new URLSearchParams(window.location.search).get('ui_preview') === 'performance-session-ledger') {
          openPerformanceSessionReceipt();
        }
        // Startup restoration can finish after the review fixture mounts.
        // Reassert this local-only approval state once so Day Mode inspection
        // never falls back to AXIOM Start while the UI is being judged.
        setTimeout(() => {
            document.getElementById('axiom-arrival-overlay')?.remove();
            document.body.classList.remove('axiom-start-mode');
            switchTab('performance');
            renderPerformanceMode();
            if (new URLSearchParams(window.location.search).get('ui_preview') === 'performance-session-ledger') {
              openPerformanceSessionReceipt();
            }
        }, 500);
        return;
    }
    if (reviewMode === 'playlists') {
        libraryHasTracks = true;
        document.getElementById('music-intake-overlay')?.remove();
        document.getElementById('axiom-arrival-overlay')?.remove();
        switchTab('playlists');
        await refreshPlaylistsView();
        return;
    }
    if (reviewMode === 'settings') {
        libraryHasTracks = true;
        document.getElementById('music-intake-overlay')?.remove();
        document.getElementById('axiom-arrival-overlay')?.remove();
        switchTab('library');
        const settingsHud = document.getElementById('master-hud');
        if (settingsHud && !settingsHud.classList.contains('active')) toggleMasterHud();
        if (uiPreviewMode === 'djay-export-error' && ['127.0.0.1', 'localhost'].includes(window.location.hostname)) {
            closeMasterHud();
            showDjayExportFailure('LOCAL REVIEW EXAMPLE — not a customer diagnosis.\n\nAXIOM could not safely read this djay playlist record. Your djay library was not changed. Use M3U export to save this set.\n\nCompatibility detail: Unrecognised playlist archive token 255');
        }
        if (uiPreviewMode === 'djay-export-receipt-warning' && ['127.0.0.1', 'localhost'].includes(window.location.hostname)) {
            closeMasterHud();
            showSeratoExportSuccess({target:'djay', djay_playlist_name:'LOCAL REVIEW EXAMPLE',
                exported_tracks:4, total_tracks:10, missing_tracks:1, duplicate_tracks:2, not_in_djay_tracks:3,
                delivery_verified:true, order_source:'Live order',
                report_warning:'Local preview only; no library was changed. The playlist was saved and verified, but its CSV report could not be saved. You do not need to export again.'
            }, 'LOCAL REVIEW EXAMPLE', 'djay');
        }
        // Label-only fixtures for local Settings styling; never change access.
        if (['127.0.0.1', 'localhost'].includes(window.location.hostname)
            && ['settings-guest', 'settings-lifetime'].includes(uiPreviewMode)) {
            window.setTimeout(() => {
                const pill = document.getElementById('license-status-pill');
                if (!pill) return;
                const lifetime = uiPreviewMode === 'settings-lifetime';
                pill.textContent = lifetime ? 'Lifetime' : 'Guest 500';
                pill.classList.add('active');
                pill.classList.remove('warning');
                pill.style.display = 'inline-flex';
                pill.dataset.settingsLabelPreview = lifetime ? 'lifetime' : 'guest';
            }, 1000);
        }
        return;
    }
    if (reviewMode === 'library-state-audit') {
        const libraryStatePreview = new URLSearchParams(window.location.search).get('ui_preview') || '';
        const libraryTrackPrepStress = libraryStatePreview === 'library-track-prep-stress';
        libraryHasTracks = true;
        currentPlaylist = [];
        currentRoutePlaylist = [];
        currentSetBrief = { ...DEFAULT_SET_BRIEF };
        activeEra = 'All';
        activeLibraryBpmFilter = 'all';
        activeLibraryRootFilter = '';
        activeLibraryPreparationFilter = libraryTrackPrepStress ? 'missing_metadata' : 'all';
        activeLibraryPreparationSort = libraryTrackPrepStress ? 'missing_first' : 'default';
        activeLibraryBriefLane = 'best';
        activeLibModifiers = {};
        libRootFilter = '';
        currentAnchorTrack = null;
        document.getElementById('music-intake-overlay')?.remove();
        document.getElementById('axiom-arrival-overlay')?.remove();
        const reviewSearchInput = document.getElementById('main-search');
        if (reviewSearchInput) reviewSearchInput.value = '';
        localStorage.setItem(
          LIBRARY_MATCHING_SONGS_KEY,
          libraryStatePreview === 'library-setup-matching-off' ? 'off' : 'on'
        );
        libraryBriefActivePanel = libraryTrackPrepStress ? 'preparation' : '';
        libraryBriefSetupExpanded = false;
        localStorage.setItem(LIBRARY_BRIEF_SETUP_KEY, 'false');
        switchTab('library');
        applyLibraryMatchingSongsPreference();
        const reviewTracks = libraryGapReviewTracks();
        mainSearchResults = reviewTracks.slice();
        const reviewLibraryTotal = libraryTrackPrepStress ? 38372 : reviewTracks.length;
        const reviewFilteredTotal = libraryTrackPrepStress ? 36817 : reviewTracks.length;
        updateLibraryCount(reviewLibraryTotal);
        resetLibraryResultWindow();
        renderLibraryResults(reviewTracks, { total_tracks: reviewFilteredTotal, visible_tracks: reviewTracks.length });
        renderLibraryBriefLens(reviewTracks);
        return;
    }
    if (reviewMode === 'library-gap-checker') {
        libraryHasTracks = true;
        currentPlaylist = [];
        currentRoutePlaylist = [];
        document.getElementById('music-intake-overlay')?.remove();
        document.getElementById('axiom-arrival-overlay')?.remove();
        switchTab('library');
        document.body.classList.add('library-matching-songs-disabled');
        const reviewTracks = libraryGapReviewTracks();
        mainSearchResults = reviewTracks.slice();
        updateLibraryCount(23226);
        resetLibraryResultWindow();
        renderLibraryResults(reviewTracks, { total_tracks: 23226, visible_tracks: reviewTracks.length });
        renderLibraryBriefLens(reviewTracks);
        setLibraryRailMode('gap');
        const gapInput = document.getElementById('library-gap-input');
        const gapPreview = new URLSearchParams(window.location.search).get('ui_preview') || '';
        if (!gapPreview) {
          if (gapInput) gapInput.value = '';
          libraryGapPayload = null;
          document.getElementById('library-gap-summary')?.classList.add('hidden');
          document.getElementById('library-gap-actions')?.classList.add('hidden');
          const gapResults = document.getElementById('library-gap-results');
          if (gapResults) gapResults.replaceChildren();
          const spotifyReceipt = document.getElementById('library-gap-spotify-receipt');
          if (spotifyReceipt) {
            spotifyReceipt.replaceChildren();
            spotifyReceipt.classList.add('hidden');
          }
          libraryGapStatus('Ready To Check', 'Paste your songs or import your Spotify playlist. The list starts empty.', '');
          return;
        }
        if (gapInput) gapInput.value = 'Red Red Wine - UB40\nSeptember - Earth, Wind & Fire\nLose Yourself (Clean Intro) - Eminem\nAround The World - Daft Punk\nCrazy In Love - Beyonce\nLevitating - Dua Lipa\nGood As Hell - Lizzo';
        if (gapPreview === 'spotify-source-switcher') {
          if (gapInput) gapInput.value = 'Red Red Wine - UB40\nSeptember - Earth, Wind & Fire\nLevitating - Dua Lipa\nAround The World - Daft Punk\nLose Yourself - Eminem';
          setLibraryGapInputSource('spotify', { focus: false });
          const spotifyPreviewInput = document.getElementById('library-gap-spotify-url');
          if (spotifyPreviewInput) spotifyPreviewInput.value = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
          updateLibraryGapSpotifyInputState();
          gapInput?.blur();
          libraryGapStatus('Ready To Check', 'Add songs from any source, then AXIOM will compare the combined list with your Library.', '');
          return;
        }
        const studioAppendPreview = gapPreview === 'set-builder-studio-append';
        const gapPayload = gapPreview === 'set-builder-many-pending' || studioAppendPreview
          ? libraryGapSetBuilderManyPendingPreviewPayload()
          : gapPreview === 'set-builder-preview'
            ? libraryGapSetBuilderPreviewPayload()
            : libraryGapReviewPayload();
        if (gapPreview === 'record-pool-recovery' || gapPreview === 'record-pool-recovery-detected') {
          const september = gapPayload.results.find(item => item.requested?.title === 'September');
          const levitating = gapPayload.results.find(item => item.requested?.title === 'Levitating');
          if (september) Object.assign(september, { status: 'not_found', versions: [], version_count: 0, requested_version_confirmed: false });
          if (levitating) Object.assign(levitating, { status: 'in_library', versions: [{ path: 'preview://gap-levitating-clean', title: 'Levitating (Clean)', artist: 'Dua Lipa', bpm: 103, camelot: '6A', year: 2020, genre: 'Pop' }], version_count: 1, requested_version_confirmed: true });
          gapPayload.counts = { in_library: 3, possible_match: 2, not_found: 2 };
        }
        if (studioAppendPreview) {
          currentPlaylist = [
            { path: 'preview://studio-existing-opener', title: 'Existing Studio Opener', artist: 'AXIOM Fixture', bpm: 96, camelot: '8A', genre: 'Open Format' },
            { path: 'preview://studio-existing-build', title: 'Existing Studio Build', artist: 'AXIOM Fixture', bpm: 102, camelot: '9A', genre: 'Open Format' },
          ];
          editingPlaylistId = null;
          selectedPlaylistId = null;
        }
        renderLibraryGapPayload(gapPayload);
        if (gapPreview === 'record-pool-recovery' || gapPreview === 'record-pool-recovery-detected') {
          window.setTimeout(() => openLibraryGapRecovery({
            reviewDetected: gapPreview === 'record-pool-recovery-detected'
          }), 80);
        }
        if (gapPreview === 'set-builder-preview' || gapPreview === 'set-builder-many-pending' || studioAppendPreview) {
          libraryGapBuilderOpenVersionsRow = 0;
          window.setTimeout(() => openLibraryGapBuilder(), 80);
        }
        return;
    }
    if (reviewMode === 'library') {
        // Keep the Library approval fixture independent from temporary Studio
        // review state so Matching Songs has real candidates to display.
        const forceLibraryReviewVisible = () => {
            document.body.classList.remove('studio-daw-mode-active');
            document.getElementById('studio-daw-shell')?.classList.add('hidden');
            document.getElementById('studio-daw-shell')?.setAttribute('aria-hidden', 'true');
            document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
            document.getElementById('tab-content-library')?.classList.remove('hidden');
            document.getElementById('connect-music-view')?.classList.add('hidden');
            document.body.classList.remove('library-empty', 'connect-music-stage');
            window.axiomVisibleTab = 'library';
            document.querySelectorAll('#axiom-sidebar .axiom-sidebar-nav-item').forEach(button => {
                const active = button.id === 'tab-btn-library';
                button.dataset.navState = active ? 'active' : 'inactive';
                if (active) {
                    button.className = 'axiom-sidebar-nav-item w-full flex items-center justify-between px-10 py-5 bg-gradient-to-r from-axiom-accent/20 to-transparent border-l-4 border-axiom-accent text-axiom-accent font-black uppercase text-xs tracking-[0.2em] transition-all group';
                } else if (button.id) {
                    button.className = 'axiom-sidebar-nav-item w-full flex items-center justify-between px-10 py-5 bg-transparent border-l-4 border-transparent text-white/40 hover:text-white hover:bg-white/5 font-black uppercase text-xs tracking-[0.2em] transition-all group';
                }
            });
        };
        libraryHasTracks = true;
        currentPlaylist = [];
        currentRoutePlaylist = [];
        document.getElementById('music-intake-overlay')?.remove();
        document.getElementById('axiom-arrival-overlay')?.remove();
        document.body.classList.remove('library-empty', 'connect-music-stage');
        document.getElementById('connect-music-view')?.classList.add('hidden');
        switchTab('library');
        resetLibraryResultWindow();
        await runSearch();
        let libraryRows = Array.from(document.querySelectorAll('#search-results .library-track-card[data-path]'));
        if (!libraryRows.length) {
            const reviewTracks = libraryGapReviewTracks();
            mainSearchResults = reviewTracks.slice();
            updateLibraryCount(reviewTracks.length);
            resetLibraryResultWindow();
            renderLibraryResults(reviewTracks, { total_tracks: reviewTracks.length, visible_tracks: reviewTracks.length });
            renderLibraryBriefLens(reviewTracks);
            document.body.classList.remove('library-empty', 'connect-music-stage');
            document.getElementById('connect-music-view')?.classList.add('hidden');
            libraryRows = Array.from(document.querySelectorAll('#search-results .library-track-card[data-path]'));
        }
        const preferredReviewAnchors = ['Transition Sample One', 'Late Night R&B DJ Mix', 'September'];
        const firstLibraryRow = preferredReviewAnchors
            .map(title => libraryRows.find(row => row.querySelector('.library-track-title')?.textContent?.includes(title)))
            .find(Boolean) || libraryRows[0];
        const firstLibraryTrack = firstLibraryRow
            ? trackVisualCache.get(firstLibraryRow.dataset.path || '')
            : null;
        if (firstLibraryRow && firstLibraryTrack) {
            currentAnchorTrack = normalizeModalTrackMetadata({ ...firstLibraryTrack });
            highlightLibraryTrack(firstLibraryRow);
            libOffset = 0;
            await fetchLibSuggestions(false);
            firstLibraryRow.scrollIntoView({ block: 'nearest' });
        }
        forceLibraryReviewVisible();
        [100, 400, 900].forEach(delay => window.setTimeout(forceLibraryReviewVisible, delay));
        return;
    }
    if (reviewMode === 'favourites') {
        // Direct design-review route for the real Favourites drawer. Populate
        // it from the current read-only Library results only when the isolated
        // preview has no saved favourites, so the complete card hierarchy is
        // visible without writing review data back to the user's collection.
        libraryHasTracks = true;
        document.getElementById('music-intake-overlay')?.remove();
        document.getElementById('axiom-arrival-overlay')?.remove();
        showTab('playlists');
        await loadFavorites();
        if (!favoritesTracks.length) {
            resetLibraryResultWindow();
            await runSearch();
            const reviewFavorites = Array.from(document.querySelectorAll('#search-results .library-track-card[data-path]'))
                .slice(0, 4)
                .map(row => trackVisualCache.get(row.dataset.path || ''))
                .filter(Boolean)
                .map(track => ({
                    path: track.path,
                    title: track.title || track.filename || '',
                    artist: track.artist || '',
                    bpm: track.bpm || 0,
                    camelot: track.camelot || '',
                    energy: track.energy || '',
                    genre: track.genre || '',
                }));
            favoritesTracks = reviewFavorites;
            _refreshFavoritesNav();
        }
        openFavoritesPanel();
        return;
    }
    if (mode === 'dialog-serato') {
        showAxiomConfirm(
            'Name Your Serato Crate',
            'AXIOM will create a Serato crate handoff for this set. Source audio and the Serato database stay untouched.',
            'ADD TO SERATO',
            'primary'
        );
        return;
    }
    if (mode === 'dialog-djay') {
        showAxiomConfirm(
            'Name Your djay Playlist',
            'Fully quit djay Pro first. AXIOM will back up its library, add this playlist under My Collection, then reopen djay Pro.',
            'ADD TO DJAY PRO',
            'primary'
        );
        return;
    }
    if (mode === 'dialog-serato-complete' || mode === 'dialog-djay-complete') {
        const djayMode = mode === 'dialog-djay-complete';
        showSeratoExportSuccess({
            exported_tracks: 24,
            total_tracks: 24,
            missing_tracks: 0,
            duplicate_tracks: 0,
            order_source: 'Harmonic Route',
            crate_path: '/Users/DJ/Music/_Serato_/Subcrates/AXIOM TEST.crate',
            browser_serato_crate_written: true,
            browser_root_written: true,
            browser_root_written_path: '/Users/DJ/Music/_Serato_/Subcrates/AXIOM TEST.crate',
            djay_playlist_name: 'AXIOM TEST',
            target: djayMode ? 'djay' : 'serato',
            djay_reopened: djayMode,
        }, 'AXIOM TEST', djayMode ? 'djay' : 'serato');
        return;
    }
    if (mode === 'performance-providers') {
        const applyProviderFixture = async (attempt = 0) => {
            showTab('performance');
            performanceSeratoEnabled = false;
            if (typeof performanceStopSeratoBridge === 'function') performanceStopSeratoBridge();
            performanceGigProfileControlVersion = Number.MAX_SAFE_INTEGER;
            performanceLiveAssistControlVersion = Number.MAX_SAFE_INTEGER;
            if (performanceGigProfileControlPollTimer) {
                clearInterval(performanceGigProfileControlPollTimer);
                performanceGigProfileControlPollTimer = null;
            }
            if (!performanceAnchorTrack || !performanceSuggestions.length) {
                try {
                    const response = await fetch('/api/library/search?q=');
                    const payload = await response.json();
                    const tracks = (Array.isArray(payload?.tracks) ? payload.tracks : [])
                        .slice(0, 5)
                        .map(normalizeModalTrackMetadata);
                    if (tracks.length > 1) {
                        performanceAnchorTrack = {
                            ...tracks[0],
                            live_provider: 'serato',
                            connected_from: 'serato_live',
                            source_label: 'Serato DJ Pro',
                        };
                        performanceSuggestions = tracks.slice(1);
                    }
                } catch (error) {
                    console.warn('[AXIOM] Performance provider fixture could not read tracks:', error);
                }
            }
            if ((!performanceAnchorTrack || !performanceSuggestions.length) && attempt < 24) {
                setTimeout(() => applyProviderFixture(attempt + 1), 250);
                return;
            }
            performanceLiveProvider = 'serato';
            if (performanceAnchorTrack) {
                performanceAnchorTrack = {
                    ...performanceAnchorTrack,
                    live_provider: 'serato',
                    connected_from: 'serato_live',
                    source_label: 'Serato DJ Pro',
                };
            }
            const seratoTracks = performanceSuggestions.slice(0, 2).map(track => ({
                ...track,
                serato_profile_sources: ['SERATO SCREEN GATE'],
                djay_profile_sources: [],
            }));
            const lockSeratoProfileState = () => {
                performanceGigProfiles = [{
                    id: 'screen-gate-serato',
                    name: 'SERATO QA',
                    sourceIds: ['screen-gate-serato-source'],
                }];
                performanceGigProfileId = 'screen-gate-serato';
                performanceDjProfileSources = [{
                    id: 'screen-gate-serato-source',
                    name: 'SERATO QA',
                    leaf_name: 'SERATO QA',
                    path_parts: ['SERATO QA'],
                    provider: 'serato',
                    provider_label: 'Serato DJ Pro',
                }];
                performanceDjProfileSourcesLoaded = true;
                performanceGigProfileEnabled = Boolean(seratoTracks.length);
                performanceGigProfileColorsEnabled = true;
                performanceGigProfileTrackCache = seratoTracks;
                performanceGigProfileKeys = new Set(seratoTracks.map(performanceTrackKey).filter(Boolean));
                performanceGigProfileTrackCacheId = 'screen-gate-serato';
                renderPerformanceMode();
            };
            lockSeratoProfileState();
            window.clearInterval(window.__axiomPerformanceProviderFixtureTimer);
            window.__axiomPerformanceProviderFixtureTimer = window.setInterval(lockSeratoProfileState, 750);
        };
        setTimeout(() => applyProviderFixture(), 350);
        return;
    }
    if (mode === 'magic-flip') {
        const fixtureBpms = [
            100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140,
            70, 74, 78, 82, 86, 90, 94, 98, 102, 106, 110,
        ];
        currentPlaylist = fixtureBpms.map((bpm, index) => ({
            title: index === 11 ? 'HALF-TIME FLIP' : `SCREEN GATE TRACK ${index + 1}`,
            artist: 'AXIOM CONTROLLED FIXTURE',
            path: `preview://magic-flip-${index}`,
            bpm,
            camelot: '4A',
            energy: index < 11 ? 'Peak' : 'Mid',
            duration_min: 2,
        }));
        currentRoutePlaylist = [];
        activeStudioView = 'manual';
        graphDots = [];
        anchorTargetDot = null;
        graphAnchorIndex = -1;
        magicSetStudioCtaReady = true;
        document.getElementById('set-length-selector').value = '60';
        document.getElementById('avg-duration-selector').value = '2';
        document.getElementById('studio-start-view')?.classList.add('hidden');
        document.getElementById('studio-active-view')?.classList.remove('hidden');
        showTab('studio');
        setGraphMode(true);
        renderPlaylist(currentPlaylist);
        initSortable();
        updateStudioToolsAvailability();
        await recalculateAudit();
        updateGraphTimeline();
        updateMagicSetStudioCta();
        return;
    }
    if (mode === 'library') {
        showMusicIntakeOverlay({
            indexed: 7342,
            total: 16127,
            folderName: 'DJ Library',
            stage: 'Matching BPM',
            title: 'Building AXIOM Index',
            message: 'AXIOM is reading tempo, key, and set links while your music stays untouched.'
        });
        return;
    }
    if (mode === 'studio-real-music') {
        currentSetBrief = normalizeSetBrief({ ...setBriefWithIntentionDefaults(currentSetBrief, 'open_format'), energyJourney: 'build' });
        let tracks = [];
        try {
            const response = await fetch('/api/library/search?q=');
            const payload = await response.json();
            if (response.ok && Array.isArray(payload.tracks)) tracks = payload.tracks.slice(0, 12);
        } catch (error) {
            tracks = [];
        }
        document.getElementById('music-intake-overlay')?.remove();
        document.getElementById('axiom-arrival-overlay')?.remove();
        document.getElementById('master-hud')?.classList.remove('active');
        if (!tracks.length) {
            libraryHasTracks = false;
            currentPlaylist = [];
            currentRoutePlaylist = [];
            showConnectMusicView();
            showToast('No real AXIOM library tracks are available yet. Connect or scan a music folder first.', true);
            return;
        }
        libraryHasTracks = true;
        currentPlaylist = tracks.slice(0, 8);
        currentRoutePlaylist = [];
        activeStudioView = 'manual';
        document.getElementById('connect-music-view')?.classList.add('hidden');
        document.getElementById('set-brief-view')?.classList.add('hidden');
        document.getElementById('studio-start-view')?.classList.add('hidden');
        document.getElementById('studio-active-view')?.classList.remove('hidden');
        showTab('studio');
        renderPlaylist(currentPlaylist);
        initSortable();
        updateStudioToolsAvailability();
        await recalculateAudit();
        openStudioDawReviewDirectly();
        return;
    }
    if (mode !== 'studio-added' && mode !== 'studio-toolbar') return;
    if (previewParams.get('studio_autosave_review') === '1' && window.AxiomStudioAutosave?.hasRecovery) {
        libraryHasTracks = true;
        clearStudioDawReviewOverlays();
        if (window.AxiomStudioAutosave.hasWorkingSet()) {
            showStudioWorkspace();
            initSortable();
            await recalculateAudit();
        } else {
            showAxiomStart({ allowReviewNavigation: true });
        }
        return;
    }
    currentSetBrief = normalizeSetBrief({ ...setBriefWithIntentionDefaults(currentSetBrief, 'wedding'), energyJourney: 'build' });
    let tracks = [];
    try {
        const response = await fetch('/api/library/search?q=');
        const payload = await response.json();
        if (response.ok && Array.isArray(payload.tracks)) tracks = payload.tracks.slice(0, 12);
    } catch (error) {
        tracks = [];
    }
    if (!tracks.length) {
        tracks = [
            ['September', 'Earth, Wind & Fire'], ['This Will Be', 'Natalie Cole'], ['Crazy In Love', 'Beyonce'],
            ['Levitating', 'Dua Lipa'], ['Yeah!', 'Usher'], ['Dancing Queen', 'ABBA'],
            ['I Wanna Dance', 'Whitney Houston'], ['Uptown Funk', 'Mark Ronson'], ['Low', 'Flo Rida'],
            ['Mr. Brightside', 'The Killers'], ['Perfect', 'Ed Sheeran'], ['Signed, Sealed, Delivered', 'Stevie Wonder']
        ].map(([title, artist], index) => ({ title, artist, path: `preview://${index}`, artwork: '/static/axiom-mark.png' }));
    }
    if (mode === 'studio-toolbar') {
        libraryHasTracks = true;
        clearStudioDawReviewOverlays();
        currentPlaylist = tracks.slice(0, 8).map((track, index) => {
            const base = { ...track };
            if (index > 2) {
                const previewBpm = 92 + index * 8;
                return { ...base, bpm: previewBpm, duration_sec: base.duration_sec || 180, duration: base.duration || base.duration_sec || 180 };
            }
            const basePath = base.path || `preview://studio-toolbar-${index}`;
            const title = base.title || 'Untitled Track';
            const artist = base.artist || 'Unknown Artist';
            const previewBpm = 92 + index * 8;
            const altTitle = /\(/.test(title) ? title.replace(/\([^)]*\)/, '(Intro Edit)') : `${title} (Intro Edit)`;
            return {
                ...base,
                path: basePath,
                bpm: previewBpm,
                duration_sec: base.duration_sec || 180,
                duration: base.duration || base.duration_sec || 180,
                available_versions: [
                    { ...base, path: basePath, title, artist, bpm: previewBpm, duration_sec: base.duration_sec || 180, duration: base.duration || base.duration_sec || 180 },
                    {
                        ...base,
                        path: `${basePath}::intro-edit`,
                        title: altTitle,
                        artist,
                        bpm: previewBpm,
                        camelot: base.camelot || `${index + 2}A`,
                        genre: base.genre || 'Open Format',
                        duration_sec: base.duration_sec || 180,
                    },
                ],
                selected_version_index: 0,
                version_count: 2,
            };
        });
        currentRoutePlaylist = [];
        activeStudioView = 'manual';
        document.getElementById('set-brief-view')?.classList.add('hidden');
        document.getElementById('studio-start-view')?.classList.add('hidden');
        document.getElementById('studio-active-view')?.classList.remove('hidden');
        showTab('studio');
        renderPlaylist(currentPlaylist);
        initSortable();
        updateStudioToolsAvailability();
        await recalculateAudit();
        const notificationPreview = previewParams.get('notification_preview');
        if (notificationPreview === 'working') {
            window.setTimeout(() => showToast('Exporting 24 tracks to Studio. Source audio untouched.'), 220);
        } else if (notificationPreview === 'bpm-halved') {
            window.setTimeout(() => showPlayerNotification('BPM HALVED · 140 → 70 · AXIOM UPDATED', { duration: 10000 }), 220);
        } else if (notificationPreview === 'important') {
            window.setTimeout(() => showToast('Performance Mode needs Accessibility permission to follow new deck loads.', true), 220);
        }
        if (reviewMode === 'anchor-selection') openModal(0);
        openStudioDawReviewDirectly();
        return;
    }
    const addedTrack = tracks[tracks.length - 1];
    showStudioTrackAddedPulse(addedTrack, tracks.length, tracks);
}

Object.assign(window, {
    populateMagicSetReviewFixture,
    runAxiomUiPreviewFixture,
});
