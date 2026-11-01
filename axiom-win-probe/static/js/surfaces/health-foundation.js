    // Health state, session receipts, cleanup review, and metadata-rule workflows.
    const HEALTH_RENDER_LIMIT = 80;
    const HEALTH_AUTO_REFRESH_MS = 60000;
    const HEALTH_TYPE_KEYS = {
        'Missing File': 'missing_file',
        'Missing BPM': 'missing_bpm',
        'Missing Key': 'missing_key',
        'Missing Year': 'missing_year'
    };
    let selectedHealthPaths = new Set();
    let lastSelectedHealthIndex = -1;
    let currentHealthTracks = [];
    let visibleHealthTracks = [];
    let currentHealthSummary = {};
    let currentHealthNewMusic = {};
    let currentHealthTruncated = {};
    let currentHealthRepairReview = null;
    let lastHealthCheckAt = 0;
    let healthSnapshotState = 'idle';
    let healthSnapshotError = '';
    let healthCheckInFlight = null;
    let activeHealthFilter = 'all';
    let currentHealthPriorityAction = 'refresh';
    let currentHealthCleanupAudit = null;
    let currentHealthCleanupReview = null;
    let metadataPublishReviewPaths = [];
    let metadataPublishPollTimer = null;
    let latestMetadataPublishState = {};
    let currentHealthCleanupPriorityAction = 'refresh';
    let healthCleanupAuditLoadedAt = 0;
    let healthCleanupAuditInFlight = null;
    let healthMetadataRules = [];
    let healthMetadataRulesLoaded = false;
    let healthMetadataRulesInFlight = null;
    let selectedHealthMetadataRuleId = '';
    const selectedHealthMetadataMergeIds = new Set();
    let healthCleanupRulesActiveTab = 'look';
    const HEALTH_CLEANUP_SAFETY_KEY = 'axiomHealthCleanupSafetyV1';
    const HEALTH_CLEANUP_SAFETY_DEFAULTS = {
        askLarge: true,
        threshold: 25,
        skipUnclear: true,
        protectedItems: [
            { name: '2Pac', type: 'phrase' },
            { name: 'AC/DC', type: 'phrase' },
            { name: 'Intro Tool 04', type: 'track' },
            { name: 'Wedding First Dance', type: 'track' },
        ],
    };
    let currentRemovedFromAxiomBin = null;
    let removedFromAxiomBinLoadedAt = 0;
    let removedFromAxiomBinInFlight = null;
    let currentHealthRestoreFilter = 'all';
    let selectedHealthRestoreIds = new Set();
    let currentHealthRestoreReceipt = null;
    let healthRestoreDemoTimer = null;
    let activeHealthInboxItem = 'missing_file';
    let activeHealthApprovedResultsTab = 'completed';
    let currentHealthGenreSummary = null;
    let healthGenreSummaryLoadedAt = 0;
    let healthGenreSummaryInFlight = null;
    let healthSmartCleanupWorkflowActive = false;
    let healthSmartCleanupLimit = 10;
    let healthSmartCleanupActiveLabels = new Set();
    let healthSmartCleanupExpandedRoots = new Set();
    let healthSmartCleanupSelectedRoot = '';
    const healthSidebarUpgradePreviewMode = new URLSearchParams(window.location.search).get('cache_bust') === 'health-sidebar-upgrade-preview';
    const healthUpgradePreviewMode = true;
    document.body.classList.add('health-upgrade-preview-mode');
    if (healthSidebarUpgradePreviewMode) document.body.classList.add('health-sidebar-upgrade-preview-mode');
    let healthSmartCleanupDismissedLabels = new Set();
    try {
        healthSmartCleanupDismissedLabels = new Set(JSON.parse(localStorage.getItem('axiomDismissedSmartCleanupGenres') || '[]'));
    } catch (error) {
        healthSmartCleanupDismissedLabels = new Set();
    }
    let healthScanPollTimer = null;
    let unifiedHealthPollTimer = null;
    let unifiedHealthActivityTimer = null;
    let unifiedHealthActivityFrame = 0;
    let unifiedHealthPresentationTimer = null;
    let unifiedHealthPresentationJobId = '';
    let unifiedHealthPresentedEvent = null;
    let unifiedHealthPresentationStage = -1;
    let unifiedHealthPresentationQueue = [];
    let unifiedHealthPresentationSeen = new Set();
    let healthReviewDemoTimer = null;
    let lastUnifiedHealthJob = null;
    let healthScanReceiptDismissed = false;

    const AXIOM_SESSION_ACTIVITY_META = {
        year: { label: 'Year Information', detail: 'Filled verified release years', icon: '/static/icons/database.svg', unit: 'tracks', order: 10 },
        year_estimate: { label: 'Year Estimates Ready', detail: 'Saved approximate years for review', icon: '/static/icons/database.svg', unit: 'tracks', order: 15 },
        title: { label: 'Titles Cleaned', detail: 'Removed version clutter and editor credits', icon: '/static/icons/sliders-horizontal.svg', unit: 'tracks', order: 20 },
        artist: { label: 'Artists Fixed', detail: 'Corrected artist placement', icon: '/static/icons/heart-pulse.svg', unit: 'tracks', order: 30 },
        duplicate: { label: 'Duplicates Resolved', detail: 'Best AXIOM copies kept', icon: '/static/icons/rotate-cw.svg', unit: 'rows', order: 40 },
        playlist: { label: 'Playlists Built', detail: 'Tracks arranged and saved', icon: '/static/icons/disc-3.svg', unit: 'sets', order: 50 },
        bpm: { label: 'BPM Information', detail: 'Filled trusted tempo intelligence', icon: '/static/icons/audio-waveform.svg', unit: 'tracks', order: 60 },
        key: { label: 'Key Information', detail: 'Filled trusted Camelot keys', icon: '/static/icons/zap.svg', unit: 'tracks', order: 70 },
        health: { label: 'Health Repairs', detail: 'Completed trusted library repairs', icon: '/static/icons/check-circle.svg', unit: 'tracks', order: 80 },
    };
    const axiomSessionReceipt = {
        startedAt: Date.now(),
        activities: new Map(),
        seen: new Set(),
        trackIds: new Set(),
        lastCelebratedTier: 0,
        navigationPending: false,
    };
    const AXIOM_HEALTH_ZONE_TABS = new Set(['health', 'health-review', 'duplicates', 'era-review']);
    const AXIOM_OUTSIDE_HEALTH_TABS = new Set(['library', 'studio', 'performance', 'playlists']);

    function axiomSessionActivityType(value = '') {
        const lane = String(value || '').toLowerCase();
        if (lane.includes('year')) return 'year';
        if (lane.includes('key') || lane.includes('camelot')) return 'key';
        if (lane.includes('bpm') || lane.includes('tempo')) return 'bpm';
        return 'health';
    }

    function recordAxiomSessionActivity(type, count = 1, options = {}) {
        const meta = AXIOM_SESSION_ACTIVITY_META[type] || AXIOM_SESSION_ACTIVITY_META.health;
        const safeCount = Math.max(0, Number(count || 0));
        if (!safeCount) return null;
        const key = String(options.key || `${type}:${Date.now()}:${safeCount}`);
        if (axiomSessionReceipt.seen.has(key)) return axiomSessionReceipt.activities.get(type) || null;
        axiomSessionReceipt.seen.add(key);

        const existing = axiomSessionReceipt.activities.get(type) || {
            type,
            count: 0,
            relatedCount: 0,
            label: meta.label,
            detail: meta.detail,
            icon: meta.icon,
            unit: meta.unit,
            order: meta.order,
            updatedAt: 0,
        };
        existing.count += safeCount;
        existing.relatedCount += Math.max(0, Number(options.relatedCount || 0));
        existing.detail = String(options.detail || existing.detail || meta.detail);
        existing.updatedAt = Number(options.timestamp || Date.now());
        axiomSessionReceipt.activities.set(type, existing);

        if (options.includeTrackImpact !== false) {
            const ids = Array.isArray(options.trackIds) ? options.trackIds.filter(Boolean).map(String) : [];
            ids.forEach(id => axiomSessionReceipt.trackIds.add(id));
            for (let index = ids.length; index < safeCount; index += 1) {
                axiomSessionReceipt.trackIds.add(`${key}:${index}`);
            }
        }
        if (activeHealthApprovedResultsTab === 'completed') renderHealthApprovedResults();
        return existing;
    }

    function axiomSessionReceiptSnapshot() {
        const entries = Array.from(axiomSessionReceipt.activities.values())
            .filter(entry => Number(entry.count || 0) > 0)
            .sort((a, b) => Number(a.order || 999) - Number(b.order || 999));
        const totalActions = entries.reduce((sum, entry) => sum + Number(entry.count || 0), 0);
        const tracksImproved = axiomSessionReceipt.trackIds.size;
        const libraryTotal = Math.max(
            tracksImproved,
            Number(currentHealthSummary?.health_eligible_tracks || 0),
            (typeof allTracks !== 'undefined' && Array.isArray(allTracks)) ? allTracks.length : 0,
        );
        const percent = libraryTotal > 0 ? Math.min(100, Math.round((tracksImproved / libraryTotal) * 100)) : 0;
        let tier = 0;
        if (percent >= 30 && tracksImproved >= 15) tier = 3;
        else if (percent >= 15 && tracksImproved >= 8) tier = 2;
        else if (percent >= 5 && tracksImproved >= 3) tier = 1;
        const tierLabels = ['Session Open', 'Good Work', 'Strong Session', 'Major Library Upgrade'];
        return { entries, totalActions, tracksImproved, libraryTotal, percent, tier, tierLabel: tierLabels[tier] };
    }

    function seedAxiomSessionReceiptPreview() {
        if (axiomUiPreviewMode() !== 'health-session-receipt' || axiomSessionReceipt.seen.size) return;
        const trackIds = Array.from({ length: 20 }, (_item, index) => `receipt-preview-track-${index + 1}`);
        const started = Date.now() - (6 * 60 * 1000);
        recordAxiomSessionActivity('year', 14, { key: 'preview:year', trackIds: trackIds.slice(0, 14), timestamp: started + 60000 });
        recordAxiomSessionActivity('title', 8, { key: 'preview:title', trackIds: trackIds.slice(0, 8), timestamp: started + 120000 });
        recordAxiomSessionActivity('artist', 3, { key: 'preview:artist', trackIds: trackIds.slice(14, 17), timestamp: started + 180000 });
        recordAxiomSessionActivity('duplicate', 6, { key: 'preview:duplicates', trackIds: trackIds.slice(14, 20), timestamp: started + 240000 });
        recordAxiomSessionActivity('playlist', 2, { key: 'preview:playlists', relatedCount: 31, includeTrackImpact: false, timestamp: started + 300000 });
    }

    function captureAxiomHealthJobReceipt(job = {}) {
        if (job.review_only) return;
        if (unifiedHealthIsActive(job)) return;
        const status = String(job.status || '').toLowerCase();
        if (!['complete', 'completed', 'needs_review', 'stopped'].includes(status)) return;
        const jobKey = String(job.job_id || job.id || job.started_at || 'health-job');
        const events = Array.isArray(job.recent_events) ? job.recent_events : [];
        events.forEach((event, index) => {
            const outcome = String(event.outcome || '').toLowerCase();
            if (!['fixed', 'estimated'].includes(outcome)) return;
            const baseType = axiomSessionActivityType(event.lane || event.detail || 'health');
            const type = outcome === 'estimated' && baseType === 'year' ? 'year_estimate' : baseType;
            const path = String(event.path || '');
            recordAxiomSessionActivity(type, 1, {
                key: `health:${jobKey}:${path || index}:${event.completed_at || ''}:${type}`,
                trackIds: path ? [path] : [],
                timestamp: Date.parse(event.completed_at || '') || Date.now(),
            });
        });
        if (!events.length) {
            const fixed = Math.max(0, Number(job.totals?.fixed || 0));
            const estimated = Math.max(0, Number(job.totals?.estimated || 0));
            if (fixed) recordAxiomSessionActivity('health', fixed, { key: `health:${jobKey}:aggregate` });
            if (estimated) recordAxiomSessionActivity('year_estimate', estimated, { key: `health:${jobKey}:estimated` });
        }
    }

    function formatAxiomSessionReceiptTime(timestamp) {
        try {
            return new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(new Date(Number(timestamp || Date.now())));
        } catch (_error) {
            return '';
        }
    }

    function renderAxiomSessionReceiptLedger(snapshot = axiomSessionReceiptSnapshot()) {
        const rows = snapshot.entries.map(entry => {
            const countLabel = `${Number(entry.count || 0).toLocaleString()} ${String(entry.unit || 'items').toUpperCase()}`;
            const detail = entry.type === 'playlist' && entry.relatedCount
                ? `${Number(entry.relatedCount).toLocaleString()} tracks arranged`
                : entry.detail;
            return `
                <div class="health-session-receipt-row">
                    <img src="${escapeHtml(entry.icon)}" alt="" aria-hidden="true">
                    <strong>${escapeHtml(entry.label)}</strong>
                    <b>${escapeHtml(countLabel)}</b>
                    <span>${escapeHtml(detail)}</span>
                    <time datetime="${new Date(entry.updatedAt).toISOString()}">${escapeHtml(formatAxiomSessionReceiptTime(entry.updatedAt))}</time>
                </div>`;
        }).join('');
        return `
            <div class="health-session-receipt-scroll" tabindex="0" aria-label="Completed AXIOM work this session">
                ${rows || '<div class="health-session-receipt-empty"><strong>Your session receipt is ready.</strong><span>Completed Health repairs, cleanups, duplicate decisions, and saved playlists will appear here while AXIOM stays open.</span></div>'}
            </div>
            <footer class="health-session-receipt-foot">
                <span><strong>${snapshot.totalActions.toLocaleString()}</strong><b>${snapshot.totalActions === 1 ? 'completed action' : 'completed actions'} across ${snapshot.tracksImproved.toLocaleString()} track${snapshot.tracksImproved === 1 ? '' : 's'}</b></span>
                <button id="health-session-receipt-expand" type="button" onclick="toggleAxiomSessionReceiptExpanded()">View Full Receipt <img src="/static/icons/chevron-down.svg" alt="" aria-hidden="true"></button>
            </footer>`;
    }

    function updateAxiomSessionReceiptHeader(snapshot = axiomSessionReceiptSnapshot()) {
        setHealthText('health-session-receipt-count', snapshot.totalActions.toLocaleString());
        setHealthText('health-session-tier-label', snapshot.tier ? `Tier ${snapshot.tier} · ${snapshot.tierLabel}` : snapshot.tierLabel);
        setHealthText('health-session-tier-percent', `${snapshot.percent.toLocaleString()}% of library improved`);
        const tier = document.getElementById('health-session-tier');
        if (tier) tier.dataset.tier = String(snapshot.tier);
    }

    function toggleAxiomSessionReceiptExpanded() {
        const receipt = document.querySelector('.health-approved-results');
        if (!receipt) return;
        const expanded = !receipt.classList.contains('receipt-expanded');
        receipt.classList.toggle('receipt-expanded', expanded);
        const button = document.getElementById('health-session-receipt-expand');
        if (button) {
            button.firstChild.textContent = expanded ? 'Collapse Receipt ' : 'View Full Receipt ';
            button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        }
    }

    function showAxiomSessionCelebration(nextTab, continueNavigation) {
        const snapshot = axiomSessionReceiptSnapshot();
        const currentTab = String(window.axiomVisibleTab || '');
        if (!AXIOM_HEALTH_ZONE_TABS.has(currentTab) || !AXIOM_OUTSIDE_HEALTH_TABS.has(nextTab) || !snapshot.tier) return false;
        if (snapshot.tier <= axiomSessionReceipt.lastCelebratedTier || axiomSessionReceipt.navigationPending) return false;
        axiomSessionReceipt.navigationPending = true;
        axiomSessionReceipt.lastCelebratedTier = snapshot.tier;
        document.getElementById('axiom-session-celebration')?.remove();
        const overlay = document.createElement('section');
        overlay.id = 'axiom-session-celebration';
        overlay.className = `axiom-session-celebration tier-${snapshot.tier}`;
        overlay.setAttribute('role', 'status');
        overlay.setAttribute('aria-live', 'polite');
        overlay.setAttribute('aria-atomic', 'true');
        overlay.innerHTML = `
            <div class="axiom-session-celebration-card">
                <img src="/static/icons/zap.svg" alt="" aria-hidden="true">
                <span>Session Milestone</span>
                <strong>${escapeHtml(snapshot.tierLabel)}</strong>
                <small>Tier ${snapshot.tier} · ${snapshot.tracksImproved.toLocaleString()} tracks improved</small>
                <i aria-hidden="true">${[1, 2, 3].map(level => `<b class="${level <= snapshot.tier ? 'active' : ''}"></b>`).join('')}</i>
            </div>`;
        const sidebarHost = window.matchMedia?.('(min-width: 761px)')?.matches
            ? document.querySelector('#axiom-sidebar .axiom-sidebar-nav')
            : null;
        const celebrationHost = sidebarHost || document.body;
        overlay.dataset.placement = sidebarHost ? 'sidebar' : 'mobile';
        celebrationHost.appendChild(overlay);
        window.requestAnimationFrame(() => overlay.classList.add('show'));
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        const holdMs = reducedMotion ? 900 : 1800;
        window.setTimeout(() => {
            overlay.classList.remove('show');
            window.setTimeout(() => overlay.remove(), reducedMotion ? 0 : 180);
            axiomSessionReceipt.navigationPending = false;
            continueNavigation();
        }, holdMs);
        return true;
    }

    const HEALTH_CLEANUP_CATEGORIES = {
        stingers: { countId: 'health-cleanup-stingers', label: 'Drops & Stingers', searchHint: 'stinger', canExclude: true, description: 'Spoken drops, station IDs and short stingers. Normal intro, outro and acapella edits stay available.' },
        transitions: { countId: 'health-cleanup-transitions', label: 'BPM Transitions', searchHint: 'transition', canExclude: true, description: 'Edits whose titles list a change between two different BPMs. Listen to confirm the change within the track.' },
        sound_effects: { countId: 'health-cleanup-sound-effects', label: 'FX & Drum Samples', searchHint: 'sound fx', canExclude: true, description: 'Short kicks, snares and other drum hits, plus clearly labelled sound effects.' },
        mixtapes: { countId: 'health-cleanup-mixtapes', label: 'Mixtapes & Long Mixes', searchHint: 'mixtape', canExclude: true, description: 'Continuous mixes, megamixes, podcasts, and long-form DJ recordings.' },
        acapellas: { countId: 'health-cleanup-acapellas', label: 'Acapellas / Intros / Outros', searchHint: 'acapella', canExclude: false, reviewOnly: true, description: 'Valid DJ edits and performance tools. AXIOM keeps these searchable and available instead of treating them as cleanup removals.' },
        title_cleanup: { countId: 'health-cleanup-title-cleanup', label: 'Title Cleanup', searchHint: 'dj edit', canPreviewCleanup: true, canCleanTitles: true, previewLabel: 'Preview Title Cleanup', applyLabel: 'Apply Title Cleanup Sample', restoreLabel: 'Restore Titles', cleanupNoun: 'title cleanup', description: 'Version notes or DJ/editor credits that may be cluttering titles.' },
        artist_format: { countId: 'health-cleanup-artist-format', label: 'Artist Cleanup', searchHint: 'artist credit', canCleanNames: true, applyLabel: 'Apply Artist Cleanups', restoreLabel: 'Restore Artists', cleanupNoun: 'artist cleanup', description: 'Remove version language from artist credits while preserving genuine artists and collaborators.' }
    };

    function healthReviewCleanupDemoAudit() {
        const titleSamples = [
            {
                path: '/tmp/music-junkie-slam-edit.mp3',
                filename: 'music-junkie-slam-edit.mp3',
                title: 'Signal Fire (Music Junkie Slam Edit)',
                artist: 'Original Artist',
                health_review_cleanup_fixture: true,
                cleanup_preview: { title: 'Signal Fire (Slam Edit)', artist: '(Music Junkie) Original Artist', title_changed: true, artist_changed: true, changed: true },
            },
            {
                path: '/tmp/night-shift-hook-first.mp3',
                filename: 'night-shift-hook-first.mp3',
                title: 'Lights Down (Night Shift Crew Hook First)',
                artist: 'Original Artist',
                health_review_cleanup_fixture: true,
                cleanup_preview: { title: 'Lights Down (Hook First)', artist: '(Night Shift Crew) Original Artist', title_changed: true, artist_changed: true, changed: true },
            },
            {
                path: '/tmp/dj-atlas-pella-out.mp3',
                filename: 'dj-atlas-pella-out.mp3',
                title: 'After Hours (Pella Out DJ Atlas)',
                artist: 'Original Artist',
                health_review_cleanup_fixture: true,
                cleanup_preview: { title: 'After Hours (Pella Out)', artist: '(DJ Atlas) Original Artist', title_changed: true, artist_changed: true, changed: true },
            },
        ];
        const artistSamples = [
            {
                path: '/tmp/music-junkie-artist-leak.mp3',
                filename: 'music-junkie-artist-leak.mp3',
                title: 'Signal Fire',
                artist: '(Music Junkie Slam Edit) Original Artist',
                health_review_cleanup_fixture: true,
                cleanup_preview: { title: 'Signal Fire', artist: '(Music Junkie) Original Artist', title_changed: false, artist_changed: true, changed: true },
            },
            {
                path: '/tmp/radio-edit-artist-leak.mp3',
                filename: 'radio-edit-artist-leak.mp3',
                title: 'Open Road',
                artist: 'Original Artist - Radio Edit',
                health_review_cleanup_fixture: true,
                cleanup_preview: { title: 'Open Road', artist: 'Original Artist', title_changed: false, artist_changed: true, changed: true },
            },
            {
                path: '/tmp/dj-owe-name-format.mp3',
                filename: 'dj-owe-name-format.mp3',
                title: 'First Light',
                artist: 'DJ_OWE',
                health_review_cleanup_fixture: true,
                cleanup_preview: { title: 'First Light', artist: '(Dj owe)', title_changed: false, artist_changed: true, changed: true },
            },
        ];
        return {
            summary: { stingers: 0, transitions: 0, sound_effects: 0, mixtapes: 0, acapellas: 0, title_cleanup: titleSamples.length, artist_format: artistSamples.length },
            excluded: { stingers: 0, transitions: 0, sound_effects: 0, mixtapes: 0, acapellas: 0, title_cleanup: 0, artist_format: 0 },
            cleanable: { title_cleanup: titleSamples.length, artist_format: artistSamples.length },
            samples: { stingers: [], transitions: [], sound_effects: [], mixtapes: [], acapellas: [], title_cleanup: titleSamples, artist_format: artistSamples },
            sample_limit: 12,
            source_audio_untouched: true,
            health_review_cleanup_fixture: true,
        };
    }

    if (typeof window.setHealthCleanupPriorityPanel !== 'function') {
        window.setHealthCleanupPriorityPanel = function ({ title, copy, actionLabel, action, excludeReady, cleanReady, totalReview }) {
            const titleEl = document.getElementById('health-cleanup-priority-title');
            const copyEl = document.getElementById('health-cleanup-priority-copy');
            const actionEl = document.getElementById('health-cleanup-priority-action');
            const excludeEl = document.getElementById('health-cleanup-priority-exclude');
            const cleanEl = document.getElementById('health-cleanup-priority-clean');
            const totalEl = document.getElementById('health-cleanup-priority-total');
            if (titleEl) titleEl.textContent = title || 'Run Utility Review';
            if (copyEl) copyEl.textContent = copy || 'Refresh the review to see cleanup candidates.';
            if (actionEl) actionEl.textContent = actionLabel || 'Refresh Review';
            if (excludeEl) excludeEl.textContent = Number(excludeReady || 0).toLocaleString();
            if (cleanEl) cleanEl.textContent = Number(cleanReady || 0).toLocaleString();
            if (totalEl) totalEl.textContent = Number(totalReview || 0).toLocaleString();
            currentHealthCleanupPriorityAction = action || 'refresh';
        };
    }

    if (typeof window.updateHealthCleanupPriorityPanel !== 'function') {
        window.updateHealthCleanupPriorityPanel = function (data = currentHealthCleanupAudit) {
            const summary = data?.summary || {};
            const excluded = data?.excluded || {};
            const cleanable = data?.cleanable || {};
            const stingersReady = Math.max(0, Number(summary.stingers || 0) - Number(excluded.stingers || 0));
            const transitionsReady = Math.max(0, Number(summary.transitions || 0) - Number(excluded.transitions || 0));
            const soundEffectsReady = Math.max(0, Number(summary.sound_effects || 0) - Number(excluded.sound_effects || 0));
            const mixtapesReady = Math.max(0, Number(summary.mixtapes || 0) - Number(excluded.mixtapes || 0));
            const acapellasReady = 0;
            const toolReady = transitionsReady + soundEffectsReady + mixtapesReady;
            const titleReady = Number(cleanable.title_cleanup || 0);
            const nameReady = Number(cleanable.artist_format || 0);
            const excludeReady = stingersReady + transitionsReady + soundEffectsReady + mixtapesReady;
            const cleanReady = titleReady + nameReady;
            const totalReview = Object.keys(summary).reduce((sum, cat) => {
                return sum + Math.max(0, Number(summary[cat] || 0) - Number(excluded[cat] || 0));
            }, 0);
            const base = { excludeReady, cleanReady, totalReview };

            if (stingersReady > 0) {
                return setHealthCleanupPriorityPanel({
                    ...base,
                    title: 'Hide stinger edits first',
                    copy: 'Stingers are useful live tools, but they can pollute normal set-building. Review and exclude the sample from Studio recommendations.',
                    actionLabel: 'Review Stingers',
                    action: 'review:stingers'
                });
            }
            if (toolReady > 0) {
                return setHealthCleanupPriorityPanel({
                    ...base,
                    title: 'Separate DJ tools next',
                    copy: 'Transitions, FX, samples, and long mixes should stay searchable while being kept out of normal set builds unless requested.',
                    actionLabel: 'Review Tools',
                    action: 'review:stingers'
                });
            }
            if (titleReady > 0) {
                return setHealthCleanupPriorityPanel({
                    ...base,
                    title: 'Clean title clutter',
                    copy: 'Some track titles look like they contain version notes or DJ/editor credits. AXIOM can preview cache-only title cleanup before applying.',
                    actionLabel: 'Review Titles',
                    action: 'review:title_cleanup'
                });
            }
            if (nameReady > 0) {
                return setHealthCleanupPriorityPanel({
                    ...base,
                    title: 'Standardise DJ names',
                    copy: 'Name-format candidates can be made consistent in AXIOM cache so search, comparison, and recommendations read cleaner.',
                    actionLabel: 'Review Names',
                    action: 'review:artist_format'
                });
            }
            if (totalReview > 0) {
                return setHealthCleanupPriorityPanel({
                    ...base,
                    title: 'Utility review is organised',
                    copy: 'AXIOM found candidates, but the urgent exclude and cleanup queues are clear. Open any category below for manual review.',
                    actionLabel: 'Refresh Review',
                    action: 'refresh'
                });
            }
            return setHealthCleanupPriorityPanel({
                ...base,
                title: 'Cleanup looks clear',
                copy: 'No stinger, DJ tool, title cleanup, or name-format candidates were found in the latest review.',
                actionLabel: 'Refresh Review',
                action: 'refresh'
            });
        };
    }

    if (typeof window.runHealthCleanupPriorityAction !== 'function') {
        window.runHealthCleanupPriorityAction = function () {
            const action = currentHealthCleanupPriorityAction || 'refresh';
            if (action.startsWith('review:')) {
                return reviewHealthUtilityCategory(action.split(':')[1]);
            }
            return loadHealthUtilityAudit({ force: true });
        };
    }

    if (typeof window.updateHealthCleanupPanel !== 'function') {
        window.updateHealthCleanupPanel = function (data = currentHealthCleanupAudit) {
            const summary = data?.summary || {};
            const excluded = data?.excluded || {};
            const cleanable = data?.cleanable || {};
            updateHealthCleanupPriorityPanel(data);
            Object.entries(HEALTH_CLEANUP_CATEGORIES).forEach(([key, cfg]) => {
                const isMetadataCleanup = cfg.canCleanNames || cfg.canPreviewCleanup;
                const count = Number((isMetadataCleanup ? cleanable[key] : summary[key]) || 0);
                const legacyCountEl = document.getElementById(`${cfg.countId}-legacy`);
                const countEl = document.getElementById(cfg.countId);
                const statusId = cfg.statusId || cfg.countId?.replace('health-cleanup-', 'health-cleanup-status-');
                const statusEl = document.getElementById(statusId);
                const buttonId = cfg.buttonId || ({
                    stingers: 'health-cleanup-review-stingers',
                    transitions: 'health-cleanup-review-tools',
                    sound_effects: 'health-cleanup-review-tools',
                    mixtapes: 'health-cleanup-review-tools',
                    title_cleanup: 'health-cleanup-review-title-cleanup',
                    artist_format: 'health-cleanup-review-artist-format',
                })[key];
                const btn = buttonId ? document.getElementById(buttonId) : null;
                if (countEl) countEl.textContent = count.toLocaleString();
                if (legacyCountEl && legacyCountEl !== countEl) legacyCountEl.textContent = count.toLocaleString();
                if (statusEl) {
                    const excludedCount = Number(excluded[key] || 0);
                    const cleanableCount = Number(cleanable[key] || 0);
                    const chips = [];
                    if (cfg.canExclude) {
                        chips.push(`<b class="${excludedCount > 0 ? 'active' : ''}">${excludedCount.toLocaleString()} excluded</b>`);
                    }
                    if (cfg.canCleanNames || cfg.canPreviewCleanup) {
                        chips.push(`<b class="${cleanableCount > 0 ? 'active' : ''}">${cleanableCount.toLocaleString()} cleanable</b>`);
                    }
                    statusEl.innerHTML = chips.join('');
                }
                if (btn) btn.disabled = count <= 0;
            });
            renderHealthInboxDetail();
        };
    }

    function beginHealthUtilityAuditProgress(options = {}) {
        window.healthUtilityAuditProgress?.dispose();
        const bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        const id = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
        document.getElementById('health-title-scan-banner')?.remove();
        const banner = document.createElement('section');
        banner.id = 'health-title-scan-banner';
        banner.dataset.state = 'running';
        banner.setAttribute('aria-label', 'Title and artist check');
        banner.setAttribute('role', 'status');
        banner.innerHTML = '<span class="health-audit-spinner" aria-hidden="true"></span><img class="health-audit-result-icon" src="/static/icons/check-circle.svg" alt="" hidden><div class="health-audit-copy"><strong></strong><small></small><progress aria-label="Tracks checked"></progress></div><span class="health-audit-time"></span><button type="button" aria-label="Dismiss scan result" hidden><img src="/static/icons/x.svg" alt=""></button>';
        document.body.appendChild(banner);
        const title = banner.querySelector('strong');
        const detail = banner.querySelector('small');
        const meter = banner.querySelector('progress');
        const elapsed = banner.querySelector('.health-audit-time');
        const close = banner.querySelector('button');
        const resultIcon = banner.querySelector('.health-audit-result-icon');
        const started = Date.now();
        let ended = false, disposed = false, polling = false, checked = 0, total = null;
        let timer = null, dismissTimer = null, navigationObserver = null, resizeObserver = null;
        let reservedSpace = 0, positionedTop = null;
        function dispose() {
            if (disposed) return;
            disposed = true;
            ended = true;
            window.clearInterval(timer);
            window.clearTimeout(dismissTimer);
            navigationObserver?.disconnect();
            resizeObserver?.disconnect();
            window.removeEventListener('resize', position);
            banner.remove();
            if (window.healthUtilityAuditProgress?.id === id) {
                document.body.classList.remove('health-title-audit-visible');
                document.body.style.removeProperty('--health-title-audit-space');
                window.healthUtilityAuditProgress = null;
            }
        }
        close.onclick = dispose;
        document.body.classList.add('health-title-audit-visible');
        let phase = 'Reading your library...';
        function position() {
            if (disposed) return;
            const other = document.getElementById('health-top-scan-banner');
            const bounds = other?.getBoundingClientRect();
            const nextTop = bounds?.height > 0 && bounds.bottom > 0 && !other.classList.contains('hidden')
                ? `${Math.ceil(bounds.bottom + 8)}px` : '';
            if (nextTop !== positionedTop) {
                banner.style.top = nextTop;
                positionedTop = nextTop;
            }
            const main = document.getElementById('main-content-wrapper');
            if (main) {
                const needed = Math.max(0, Math.ceil(banner.getBoundingClientRect().bottom - main.getBoundingClientRect().top + 12));
                // Progress text can wrap as counts change. Keep its reserved space stable until dismissal.
                if (needed > reservedSpace) {
                    reservedSpace = needed;
                    document.body.style.setProperty('--health-title-audit-space', `${reservedSpace}px`);
                }
            }
        }
        function paint() {
            if (ended || disposed) return;
            title.textContent = options.example ? 'Example: checking titles and artists' : 'Checking titles and artists';
            detail.textContent = total === null ? phase : `${checked.toLocaleString()} of ${total.toLocaleString()} tracks checked`;
            elapsed.textContent = `${Math.floor((Date.now() - started) / 1000)}s`;
            if (total !== null && total > 0) { meter.max = total; meter.value = checked; }
            else meter.removeAttribute('value');
            const inline = document.getElementById('health-title-scan-inline');
            if (inline) inline.textContent = `${detail.textContent} / ${elapsed.textContent}`;
        }
        function update(data) {
            if (ended) return;
            if (Number.isFinite(data.total)) total = Math.max(0, data.total);
            if (Number.isFinite(data.checked)) checked = Math.max(checked, Math.min(data.checked, total ?? data.checked));
            if (data.phase) phase = data.phase;
            paint();
        }
        timer = window.setInterval(async () => {
            paint();
            if (options.example || polling || ended) return;
            polling = true;
            try {
                const response = await fetch(`/api/library/utility_audit/progress?id=${id}`, { cache: 'no-store' });
                if (response.ok) update(await response.json());
            } catch (_) { /* The audit response remains the completion authority. */ }
            finally { polling = false; }
        }, 1000);
        window.addEventListener('resize', position);
        if (typeof ResizeObserver === 'function') {
            resizeObserver = new ResizeObserver(position);
            resizeObserver.observe(banner);
            const other = document.getElementById('health-top-scan-banner');
            if (other) resizeObserver.observe(other);
        }
        const activity = { id, update, dispose, finish(data, error) {
            if (ended) return;
            if (Number.isFinite(data?.checked_tracks)) update({ checked: data.checked_tracks, total: data.checked_tracks });
            ended = true;
            window.clearInterval(timer);
            banner.dataset.state = error ? 'error' : 'complete';
            title.textContent = error ? 'Title check interrupted' : 'Title and artist check complete';
            detail.textContent = error ? 'Results could not be confirmed. Try checking again.' : `${checked.toLocaleString()} tracks checked. ${options.example ? 'Example only.' : 'Your files are unchanged.'}`;
            elapsed.textContent = `${error ? 'Stopped after' : 'Completed in'} ${Math.floor((Date.now() - started) / 1000)}s`;
            resultIcon.src = error ? '/static/icons/circle-alert.svg' : '/static/icons/check-circle.svg';
            resultIcon.hidden = false;
            meter.hidden = true;
            close.hidden = false;
            const container = document.getElementById('health-review-container');
            container?.setAttribute('aria-busy', 'false');
            const inline = document.getElementById('health-title-scan-inline');
            if (inline) inline.textContent = detail.textContent;
            position();
            if (!error) dismissTimer = window.setTimeout(dispose, 5000);
            if (typeof MutationObserver === 'function') {
                const completedNavigation = window.axiomTabNavigationVersion;
                navigationObserver = new MutationObserver(() => {
                    if (window.axiomTabNavigationVersion !== completedNavigation) dispose();
                });
                document.querySelectorAll('.tab-content').forEach(tab => navigationObserver.observe(tab, { attributes: true, attributeFilter: ['class'] }));
            }
        }};
        window.healthUtilityAuditProgress = activity;
        paint();
        position();
        return activity;
    }

    if (typeof window.loadHealthUtilityAudit !== 'function') {
        window.loadHealthUtilityAudit = async function (options = {}) {
            const force = options.force === true;
            if (options.afterCurrent && healthCleanupAuditInFlight) {
                await healthCleanupAuditInFlight;
                healthCleanupAuditLoadedAt = 0;
            }
            if (axiomReviewMode() === 'health' && axiomUiPreviewMode() !== 'health-cleanup-sandbox') {
                if (axiomUiPreviewMode() === 'health-title-cleanup' && new URLSearchParams(window.location.search).get('audit_progress_demo') === '1' && !window.healthAuditDemoStarted) {
                    window.healthAuditDemoStarted = true;
                    const activity = beginHealthUtilityAuditProgress({ example: true });
                    activity.update({ total: 30000, checked: 0 });
                    for (let checked = 2000; checked <= 30000; checked += 2000) {
                        await new Promise(resolve => window.setTimeout(resolve, 1000));
                        activity.update({ total: 30000, checked });
                    }
                    activity.finish({ checked_tracks: 30000 });
                }
                if (!currentHealthCleanupAudit || force) currentHealthCleanupAudit = healthReviewCleanupDemoAudit();
                healthCleanupAuditLoadedAt = Date.now();
                updateHealthCleanupPanel(currentHealthCleanupAudit);
                if (force) showToast('Dummy cleanup review reset. No library or audio files changed.');
                return currentHealthCleanupAudit;
            }
            if (!force && currentHealthCleanupAudit && Date.now() - healthCleanupAuditLoadedAt < HEALTH_AUTO_REFRESH_MS) {
                updateHealthCleanupPanel();
                return currentHealthCleanupAudit;
            }
            if (healthCleanupAuditInFlight) return healthCleanupAuditInFlight;

            const refreshBtn = document.getElementById('health-cleanup-refresh');
            healthCleanupAuditInFlight = (async () => {
                setAxiomButtonBusy(refreshBtn, true, '<span>Reviewing...</span>');
                const activity = beginHealthUtilityAuditProgress();
                try {
                    for (let attempt = 0; attempt < 120; attempt += 1) {
                        const resp = await fetch(`/api/library/utility_audit?progress_id=${activity.id}`, { cache: 'no-store' });
                        const data = await resp.json().catch(() => ({}));
                        if (!resp.ok || data.success === false || data.error) {
                            throw new Error(data.error || data.message || 'Utility review failed. Previous findings have been kept.');
                        }
                        if (resp.status === 202 || data.status === 'building') {
                            if (refreshBtn) refreshBtn.innerHTML = '<span>Reviewing Library...</span>';
                            await new Promise(resolve => window.setTimeout(resolve, 500));
                            continue;
                        }
                        if (!resp.ok || data.success === false || data.error
                            || !data.summary || typeof data.summary !== 'object' || Array.isArray(data.summary)
                            || !data.samples || typeof data.samples !== 'object' || Array.isArray(data.samples)
                            || !['title_cleanup', 'artist_format'].every(key => Number.isFinite(data.summary[key]) && Array.isArray(data.samples[key]))
                            || !Object.values(data.summary).every(value => Number.isFinite(value) && value >= 0)
                            || !Object.values(data.samples).every(Array.isArray)) {
                            throw new Error(data.error || data.message || 'Utility review returned incomplete results. Previous findings have been kept.');
                        }
                        currentHealthCleanupAudit = data;
                        healthCleanupAuditLoadedAt = Date.now();
                        updateHealthCleanupPanel(data);
                        activity.finish(data);
                        if (force) showToast('Utility review refreshed. Source audio untouched.');
                        return data;
                    }
                    throw new Error('Utility review is still running. Keep using AXIOM and refresh this review shortly.');
                } catch (err) {
                    activity.finish(null, err);
                    showToast(err.message || 'Utility review failed', true);
                    return options.afterCurrent ? null : currentHealthCleanupAudit;
                } finally {
                    setAxiomButtonBusy(refreshBtn, false);
                    healthCleanupAuditInFlight = null;
                }
            })();
            return healthCleanupAuditInFlight;
        };
    }

    function showHealthCleanupReviewFailure(error, category, review) {
        if (!error.reviewRequired || currentHealthCleanupReview !== review
            || window.axiomVisibleTab !== 'health-review') {
            showToast(error.message || 'Metadata cleanup failed', true);
            return;
        }
        const navigationVersion = Number(window.axiomTabNavigationVersion || 0);
        const refreshReview = async () => {
            if (currentHealthCleanupReview !== review
                || Number(window.axiomTabNavigationVersion || 0) !== navigationVersion
                || window.axiomVisibleTab !== 'health-review') return;
            if (Object.keys(healthCleanupCustomOverrides(review)).length) {
                const confirmed = await showAxiomConfirm(
                    'Refresh Cleanup Review',
                    'Load the latest track values and suggestions? Your unsaved custom proposals will be replaced. Cancel keeps the current proposals. No cleanup is applied by refreshing.',
                    'REFRESH REVIEW', 'primary', 'metadata'
                );
                if (!confirmed || currentHealthCleanupReview !== review
                    || Number(window.axiomTabNavigationVersion || 0) !== navigationVersion) return;
            }
            await reviewHealthUtilityCategory(category, { force: true });
        };
        const shown = typeof showPlayerNotification === 'function' && showPlayerNotification(
            'Cleanup preview changed. No changes applied. Refresh the review before applying again.',
            { isError: true, actionLabel: 'Refresh review', actionFn: refreshReview }
        );
        if (!shown) showToast(error.message || 'Refresh this cleanup review before applying again.', true);
    }

    function healthCleanupComparisonValue(track, preview, proposed = false) {
        const artist = proposed ? (preview.artist || track.artist) : track.artist;
        const title = proposed ? (preview.title || track.title) : track.title;
        return `${artist || 'Unknown Artist'} — ${title || track.filename || 'Unknown Title'}`;
    }

    function healthCleanupDiffHtml(value, comparison) {
        const source = String(value || '');
        const otherGroups = new Set((String(comparison || '').match(/\([^)]*\)/g) || []).map(group => group.toLowerCase()));
        const matches = Array.from(source.matchAll(/\([^)]*\)/g));
        let cursor = 0;
        let changedGroups = 0;
        let html = '';
        matches.forEach(match => {
            const index = Number(match.index || 0);
            html += escapeHtml(source.slice(cursor, index));
            const group = match[0];
            if (!otherGroups.has(group.toLowerCase())) {
                html += `<mark>${escapeHtml(group)}</mark>`;
                changedGroups += 1;
            } else {
                html += escapeHtml(group);
            }
            cursor = index + group.length;
        });
        if (changedGroups > 0) return html + escapeHtml(source.slice(cursor));

        const other = String(comparison || '');
        let prefix = 0;
        while (prefix < source.length && prefix < other.length && source[prefix] === other[prefix]) prefix += 1;
        let suffix = 0;
        while (suffix < source.length - prefix && suffix < other.length - prefix
            && source[source.length - 1 - suffix] === other[other.length - 1 - suffix]) suffix += 1;
        if (prefix === source.length) return escapeHtml(source);
        const end = source.length - suffix;
        return `${escapeHtml(source.slice(0, prefix))}<mark>${escapeHtml(source.slice(prefix, end))}</mark>${escapeHtml(source.slice(end))}`;
    }

    function healthCleanupTrackLabel(track, preview) {
        const cleanTitle = String(preview?.title || track?.title || track?.filename || 'Unknown Track')
            .replace(/\s*\([^)]*\)\s*/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim();
        return cleanTitle || track?.filename || 'Unknown Track';
    }

    function healthCleanupWhyCopy(category, track, preview) {
        if (category === 'artist_format') {
            const before = String(track?.artist || '');
            const after = String(preview?.artist || '');
            if (/\b(?:slam edit|hook first|pella|club mix|radio edit|transition edit|jersey flip|bootleg|mashup|blend)\b/i.test(before)
                && !/\b(?:slam edit|hook first|pella|club mix|radio edit|transition edit|jersey flip|bootleg|mashup|blend)\b/i.test(after)) {
                return 'Removes song-version language from the artist credit.';
            }
            return 'Keeps the artist credit consistent without changing collaborators.';
        }
        const artistChanged = Boolean(preview?.artist_changed);
        const titleChanged = Boolean(preview?.title_changed);
        const beforeArtist = String(track?.artist || '');
        const afterArtist = String(preview?.artist || '');
        if (/\bunknown\s+artist\b/i.test(beforeArtist) && !/\bunknown\s+artist\b/i.test(afterArtist)) {
            return String(track?.audit_reason || 'Recovers the artist from the title and keeps the editor credit.');
        }
        if (artistChanged && titleChanged) return 'Moves the editor credit and keeps the version note with the song.';
        if (artistChanged) return 'Moves the editor credit into the artist display.';
        if (titleChanged) return 'Keeps the song version clear without losing it.';
        return 'Makes this title easier to read in AXIOM.';
    }

    function healthCleanupSelectedIndexes(review = currentHealthCleanupReview) {
        if (!review) return [];
        if (!Array.isArray(review.selectedIndexes)) {
            review.selectedIndexes = (review.samples || []).map((_track, index) => index);
        }
        return review.selectedIndexes.filter(index => index >= 0 && index < (review.samples || []).length);
    }

    function healthCleanupCustomOverrides(review = currentHealthCleanupReview) {
        if (!review) return {};
        if (!review.customOverrides || typeof review.customOverrides !== 'object') review.customOverrides = {};
        return review.customOverrides;
    }

    function healthCleanupResolvedPreview(track, index, review = currentHealthCleanupReview) {
        const automatic = track?.cleanup_preview || {};
        const custom = healthCleanupCustomOverrides(review)[String(track?.path || index)] || null;
        if (!custom) return automatic;
        return {
            ...automatic,
            title: custom.title,
            artist: custom.artist,
            title_changed: String(custom.title || '') !== String(track?.title || ''),
            artist_changed: String(custom.artist || '') !== String(track?.artist || ''),
            changed: String(custom.title || '') !== String(track?.title || '') || String(custom.artist || '') !== String(track?.artist || ''),
            custom_edit: true,
            rule_saved: Boolean(custom.ruleSaved),
        };
    }

    function healthCleanupCustomEditCount(review = currentHealthCleanupReview) {
        return Object.values(healthCleanupCustomOverrides(review)).filter(Boolean).length;
    }

    function healthCleanupApplyButtonCopy(selectedCount, review = currentHealthCleanupReview) {
        const selected = new Set(healthCleanupSelectedIndexes(review));
        const customCount = (review?.samples || []).reduce((count, track, index) => {
            if (!selected.has(index)) return count;
            return count + (healthCleanupCustomOverrides(review)[String(track?.path || index)] ? 1 : 0);
        }, 0);
        if (!customCount) return selectedCount === 1 ? 'Apply 1 Cleanup' : `Apply ${selectedCount.toLocaleString()} Cleanups`;
        const automaticCount = Math.max(0, selectedCount - customCount);
        if (!automaticCount) return customCount === 1 ? 'Apply 1 Custom Edit' : `Apply ${customCount.toLocaleString()} Custom Edits`;
        return `Apply ${automaticCount.toLocaleString()} Suggestions + ${customCount.toLocaleString()} Custom`;
    }

    function updateHealthCleanupReviewSelection() {
        const review = currentHealthCleanupReview;
        if (!review) return;
        const selected = new Set(healthCleanupSelectedIndexes(review));
        const selectedCount = selected.size;
        const selectedEl = document.getElementById('health-cleanup-selected-count');
        const applyBtn = document.getElementById('health-cleanup-apply-selected');
        const removeBtn = document.getElementById('health-cleanup-remove-selected');
        const allCheckbox = document.getElementById('health-cleanup-select-all');
        if (selectedEl) selectedEl.textContent = selectedCount.toLocaleString();
        if (removeBtn) removeBtn.disabled = selectedCount <= 0;
        if (applyBtn) {
            applyBtn.disabled = selectedCount <= 0;
            applyBtn.textContent = healthCleanupApplyButtonCopy(selectedCount, review);
        }
        if (allCheckbox) {
            allCheckbox.checked = selectedCount > 0 && selectedCount === (review.samples || []).length;
            allCheckbox.indeterminate = selectedCount > 0 && selectedCount < (review.samples || []).length;
        }
        document.querySelectorAll('[data-health-clean-review-index]').forEach(row => {
            const index = Number(row.dataset.healthCleanReviewIndex);
            row.dataset.selected = selected.has(index) ? 'true' : 'false';
        });
    }

    window.toggleHealthCleanupReviewSelection = function (index, checked) {
        const review = currentHealthCleanupReview;
        if (!review) return;
        const selected = new Set(healthCleanupSelectedIndexes(review));
        if (checked) selected.add(Number(index));
        else selected.delete(Number(index));
        review.selectedIndexes = Array.from(selected).sort((a, b) => a - b);
        updateHealthCleanupReviewSelection();
    };

    function healthCleanupCorrectionInput(index, field) {
        return document.getElementById(`health-cleanup-correction-${field}-${index}`);
    }

    function healthCleanupCorrectionValues(index) {
        return {
            title: String(healthCleanupCorrectionInput(index, 'title')?.value || '').replace(/\s+/g, ' ').trim(),
            artist: String(healthCleanupCorrectionInput(index, 'artist')?.value || '').replace(/\s+/g, ' ').trim(),
        };
    }

    window.updateHealthCleanupCorrectionPreview = function (index) {
        const track = currentHealthCleanupReview?.samples?.[Number(index)];
        const preview = document.getElementById(`health-cleanup-correction-preview-${index}`);
        if (!track || !preview) return;
        const values = healthCleanupCorrectionValues(index);
        preview.textContent = `${values.artist || 'Unknown Artist'} — ${values.title || 'Title required'}`;
    };

    function updateHealthCleanupCorrectionRow(index) {
        const review = currentHealthCleanupReview;
        const track = review?.samples?.[Number(index)];
        const row = document.querySelector(`[data-health-clean-review-index="${Number(index)}"]`);
        if (!track || !row) return;
        const preview = healthCleanupResolvedPreview(track, Number(index), review);
        const before = healthCleanupComparisonValue(track, preview, false);
        const after = healthCleanupComparisonValue(track, preview, true);
        const value = row.querySelector('[data-health-cleanup-proposal-value]');
        const badge = row.querySelector('[data-health-cleanup-custom-badge]');
        if (value) value.innerHTML = healthCleanupFieldComparison(track, preview);
        if (badge) {
            badge.hidden = !preview.custom_edit;
            badge.textContent = preview.rule_saved ? 'Edited by you · Rule saved' : 'Edited by you';
        }
        row.dataset.customEdit = preview.custom_edit ? 'true' : 'false';
        updateHealthCleanupReviewSelection();
    }

    window.saveHealthCleanupCorrection = function (index, options = {}) {
        const review = currentHealthCleanupReview;
        const track = review?.samples?.[Number(index)];
        if (!track) return null;
        const values = healthCleanupCorrectionValues(index);
        if (!values.title) {
            healthCleanupCorrectionInput(index, 'title')?.focus();
            showToast('Add the title AXIOM should use.', true);
            return null;
        }
        const key = String(track.path || index);
        const previous = healthCleanupCustomOverrides(review)[key] || {};
        healthCleanupCustomOverrides(review)[key] = { ...previous, ...values };
        if (!healthCleanupSelectedIndexes(review).includes(Number(index))) {
            review.selectedIndexes = [...healthCleanupSelectedIndexes(review), Number(index)].sort((a, b) => a - b);
            const checkbox = document.querySelector(`[data-health-clean-review-index="${Number(index)}"] .health-clean-review-check`);
            if (checkbox) checkbox.checked = true;
        }
        updateHealthCleanupCorrectionRow(Number(index));
        if (options.close !== false) closeHealthCleanupCorrection(Number(index));
        if (!options.silent) showToast('Custom proposal saved for this track. Nothing has been applied yet.');
        return healthCleanupCustomOverrides(review)[key];
    };

    window.closeHealthCleanupCorrection = function (index) {
        document.getElementById(`health-cleanup-correction-${index}`)?.remove();
        const trigger = document.querySelector(`[data-health-cleanup-edit-index="${Number(index)}"]`);
        trigger?.setAttribute?.('aria-expanded', 'false');
        trigger?.focus?.();
    };

    window.openHealthCleanupCorrection = function (index, trigger = null) {
        const review = currentHealthCleanupReview;
        const track = review?.samples?.[Number(index)];
        const row = document.querySelector(`[data-health-clean-review-index="${Number(index)}"]`);
        if (!track || !row) return;
        document.querySelectorAll('.health-cleanup-correction').forEach(editor => editor.remove());
        const preview = healthCleanupResolvedPreview(track, Number(index), review);
        const editor = document.createElement('section');
        editor.id = `health-cleanup-correction-${index}`;
        editor.className = 'health-cleanup-correction';
        editor.setAttribute('aria-label', `Fix proposal for ${healthCleanupTrackLabel(track, preview)}`);
        editor.innerHTML = `
            <header>
                <div><span>Fix this suggestion</span><strong>${escapeHtml(healthCleanupTrackLabel(track, preview))}</strong></div>
                <button type="button" onclick="closeHealthCleanupCorrection(${index})" aria-label="Close custom edit">Close</button>
            </header>
            <div class="health-cleanup-correction-fields">
                <label><span>Artist after cleanup</span><input id="health-cleanup-correction-artist-${index}" type="text" value="${escapeHtml(preview.artist || track.artist || '')}" oninput="updateHealthCleanupCorrectionPreview(${index})"></label>
                <label><span>Title after cleanup</span><input id="health-cleanup-correction-title-${index}" type="text" value="${escapeHtml(preview.title || track.title || '')}" oninput="updateHealthCleanupCorrectionPreview(${index})"></label>
            </div>
            <div class="health-cleanup-correction-preview"><span>Before</span><p>${escapeHtml(healthCleanupComparisonValue(track, preview, false))}</p><i aria-hidden="true">→</i><span>After</span><strong id="health-cleanup-correction-preview-${index}">${escapeHtml(healthCleanupComparisonValue(track, preview, true))}</strong></div>
            <div class="health-cleanup-correction-actions">
                <button class="primary" type="button" onclick="saveHealthCleanupCorrection(${index})">Use for this track</button>
                <button type="button" onclick="showHealthCleanupSimilarRule(${index})">Check similar tracks</button>
                <small>Nothing changes until you use the main Apply button.</small>
            </div>
            `;
        row.insertAdjacentElement('afterend', editor);
        window.updateHealthCleanupCorrectionPreview(Number(index));
        trigger?.setAttribute?.('aria-expanded', 'true');
        window.requestAnimationFrame(() => {
            editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
            healthCleanupCorrectionInput(Number(index), 'artist')?.focus();
        });
    };

    window.showHealthCleanupSimilarRule = async function (index) {
        const review = currentHealthCleanupReview;
        const track = review?.samples?.[Number(index)];
        const correction = saveHealthCleanupCorrection(Number(index), { close: false, silent: true });
        if (!track || !correction || review.similarPending) return;
        review.similarPending = true;
        showToast('Checking the full AXIOM library for this correction...');
        try {
            const response = await fetch('/api/library/utility_metadata_preview', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ category: review.category, exemplar: {
                    path: track.path, before: { title: track.title || '', artist: track.artist || '' }, after: correction
                } })
            });
            const plan = await response.json();
            if (!response.ok || plan.success === false) throw new Error(plan.error || 'Could not check similar tracks.');
            if (currentHealthCleanupReview !== review) return;
            const ready = plan.tracks || [];
            const possible = (plan.possible || []).map(row => ({ ...row, audit_reason: 'Possible shortened version: review before selecting.' }));
            const samples = [...ready, ...possible];
            currentHealthCleanupReview = { category: review.category, samples, total: samples.length,
                selectedIndexes: ready.map((_row, i) => i), review_rules_signature: plan.review_rules_signature,
                customOverrides: Object.fromEntries(samples.map(row => [row.path, row.cleanup_preview])) };
            document.getElementById('health-review-container').innerHTML = renderHealthMetadataCleanupReview(review.category, samples, samples.length, ready.length);
            const copy = document.getElementById('health-review-copy');
            if (copy) copy.textContent = `Checked ${Number(plan.checked || 0).toLocaleString()} library tracks · ${ready.length.toLocaleString()} ready · ${possible.length.toLocaleString()} need review`;
            const badge = document.getElementById('health-review-ready-badge');
            if (badge) badge.textContent = `${ready.length.toLocaleString()} ready · ${possible.length.toLocaleString()} need review`;
            updateHealthCleanupReviewSelection();
            syncHealthCleanupPreviewButtons();
            showToast(`${ready.length.toLocaleString()} matching corrections ready; ${possible.length.toLocaleString()} possible matches are unchecked.`);
        } catch (error) {
            showToast(error.message || 'Could not check similar tracks.', true);
        } finally { review.similarPending = false; }
    };

    window.toggleAllHealthCleanupReviewSelections = function (checked) {
        const review = currentHealthCleanupReview;
        if (!review) return;
        review.selectedIndexes = checked ? (review.samples || []).map((_track, index) => index) : [];
        document.querySelectorAll('.health-clean-review-row .health-clean-review-check').forEach(input => {
            input.checked = checked;
        });
        updateHealthCleanupReviewSelection();
    };

    function syncHealthCleanupPreviewButtons() {
        const review = currentHealthCleanupReview;
        document.querySelectorAll('[data-health-cleanup-audio-index]').forEach(button => {
            const track = review?.samples?.[Number(button.dataset.healthCleanupAudioIndex)] || {};
            const isCurrent = Boolean(track.path && currentPlayingPath === track.path);
            const isPlaying = Boolean(isCurrent && nativePlayerState.playing);
            button.classList.toggle('is-playing', isPlaying);
            button.setAttribute('aria-pressed', isPlaying ? 'true' : 'false');
            const label = button.querySelector('span');
            if (label) label.textContent = isPlaying ? 'Pause' : (isCurrent ? 'Resume' : 'Listen');
        });
    }

    window.previewHealthCleanupTrack = async function (index, triggerBtn) {
        const track = currentHealthCleanupReview?.samples?.[Number(index)];
        if (!track?.path || track.health_review_cleanup_fixture) {
            showToast('Audio preview is available for real library cleanup results.', true);
            return false;
        }
        if (currentPlayingPath === track.path) {
            await togglePlay();
        } else {
            await playAudioFile(
                track.path,
                track.title || track.filename || 'Unknown Track',
                track.artist || 'Unknown Artist',
                modalBpmValue(track),
                track.camelot || track.key || track.key_raw || '',
                track.energy || '',
                null,
                track.genre || ''
            );
        }
        syncHealthCleanupPreviewButtons();
        triggerBtn?.focus?.();
        return true;
    };

    function healthMetadataRuleCategoryIsVisible(category = currentHealthCleanupReview?.category) {
        return category === 'title_cleanup' || category === 'artist_format';
    }

    function updateHealthMetadataRulesButton(category = currentHealthCleanupReview?.category) {
        const button = document.getElementById('health-metadata-rules-button');
        if (!button) return;
        button.classList.toggle('hidden', !healthMetadataRuleCategoryIsVisible(category));
    }

    async function loadHealthMetadataRules(options = {}) {
        const force = options.force === true;
        if (!force && healthMetadataRulesLoaded) {
            renderHealthMetadataRules();
            return healthMetadataRules;
        }
        if (healthMetadataRulesInFlight) return healthMetadataRulesInFlight;
        const list = document.getElementById('health-metadata-rules-list');
        if (list) list.innerHTML = '<div class="health-metadata-rules-loading">Loading configured items…</div>';
        healthMetadataRulesInFlight = (async () => {
            try {
                const response = await fetch('/api/library/metadata_cleanup_rules', { cache: 'no-store' });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(data.error || 'Metadata rules could not be loaded.');
                healthMetadataRules = Array.isArray(data.rules) ? data.rules : [];
                healthMetadataRulesLoaded = true;
                renderHealthMetadataRules();
                return healthMetadataRules;
            } catch (error) {
                if (list) list.innerHTML = `<div class="health-metadata-rules-error"><strong>Rules unavailable</strong><p>${escapeHtml(error.message || 'Try again.')}</p><button type="button" onclick="loadHealthMetadataRules({ force: true })">Retry</button></div>`;
                return [];
            } finally {
                healthMetadataRulesInFlight = null;
            }
        })();
        return healthMetadataRulesInFlight;
    }

    function renderHealthMetadataRules() {
        const list = document.getElementById('health-metadata-rules-list');
        const summary = document.getElementById('health-metadata-rules-summary');
        if (!list || !summary || !healthMetadataRulesLoaded) return;
        const query = String(document.getElementById('health-metadata-rules-search')?.value || '').trim().toLowerCase();
        const filtered = healthMetadataRules.filter(rule => {
            if (!query) return true;
            return String(rule.name || '').toLowerCase().includes(query)
                || String(rule.designation || '').toLowerCase().includes(query);
        });
        const enabledCount = healthMetadataRules.filter(rule => rule.enabled).length;
        const artistCount = healthMetadataRules.filter(rule => rule.designation === 'artist').length;
        const toolCount = healthMetadataRules.filter(rule => rule.designation === 'tool').length;
        const mergedCount = healthMetadataRules.filter(rule => String(rule.canonical_name || '').trim()).length;
        summary.textContent = `${healthMetadataRules.length} saved cleanups · ${artistCount} names · ${toolCount} edit words · ${mergedCount} merged · ${enabledCount} on`;
        if (!filtered.length) {
            list.innerHTML = '<div class="health-metadata-rules-empty">No configured items match this filter.</div>';
            updateHealthMetadataMergePanel();
            return;
        }
        const renderGroup = (label, designation) => {
            const rows = filtered.filter(rule => rule.designation === designation);
            if (!rows.length) return '';
            return `<div class="health-metadata-rules-group-label">${escapeHtml(label)}</div>${rows.map(rule => {
            const ruleId = escapeHtml(rule.id || '');
            const ruleIdJs = escapeJs(rule.id || '');
            const mergeChecked = selectedHealthMetadataMergeIds.has(rule.id);
            const canonicalName = String(rule.canonical_name || '').trim();
            const aliasCount = Array.isArray(rule.aliases) ? rule.aliases.filter(Boolean).length : 0;
            const canonicalLabel = rule.designation === 'artist'
                ? healthCleanupBracketed(canonicalName, rule.brackets || 'round')
                : canonicalName;
            const canonicalMeta = canonicalName
                ? `<small class="health-metadata-rule-canonical">Shows as ${escapeHtml(canonicalLabel)}${aliasCount ? ` · ${aliasCount} aliases` : ''}</small>`
                : (aliasCount ? `<small class="health-metadata-rule-canonical">${aliasCount} aliases</small>` : '');
            const mergeControl = `<input class="health-metadata-rule-merge-check" type="checkbox" ${mergeChecked ? 'checked' : ''} aria-label="Select ${escapeHtml(rule.name || '')} for merge" onclick="event.stopPropagation()" onchange="toggleHealthMetadataRuleMerge('${ruleIdJs}', this.checked)">`;
            return `
                <article class="health-metadata-rule-row ${selectedHealthMetadataRuleId === rule.id ? 'selected' : ''}" data-rule-id="${ruleId}" data-enabled="${rule.enabled ? 'true' : 'false'}" tabindex="0" onclick="selectHealthMetadataRule('${ruleIdJs}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectHealthMetadataRule('${ruleIdJs}');}">
                    ${mergeControl}
                    <span class="health-metadata-rule-name"><strong>${escapeHtml(rule.name || '')}</strong>${canonicalMeta}</span>
                    <span class="health-metadata-rule-designation">${rule.designation === 'artist' ? 'Name' : 'Version'}</span>
                    <button type="button" aria-label="${rule.enabled ? 'Pause' : 'Turn on'} ${escapeHtml(rule.name || '')}" onclick="event.stopPropagation(); toggleHealthMetadataRuleEnabled('${ruleIdJs}', this)">${rule.enabled ? 'On' : 'Off'}</button>
                </article>
            `;
            }).join('')}`;
        };
        list.innerHTML = renderGroup('DJ / Producer / Editor Names', 'artist')
            + renderGroup('Edit & Version Words', 'tool');
        if (!selectedHealthMetadataRuleId || !healthMetadataRules.some(rule => rule.id === selectedHealthMetadataRuleId)) {
            selectedHealthMetadataRuleId = filtered[0]?.id || healthMetadataRules[0]?.id || '';
        }
        list.querySelectorAll('.health-metadata-rule-row').forEach(row => {
            row.classList.toggle('selected', row.dataset.ruleId === selectedHealthMetadataRuleId);
        });
        updateHealthMetadataMergePanel();
        populateHealthMetadataRuleEditor();
    }

    function selectedHealthMetadataRule() {
        return healthMetadataRules.find(rule => rule.id === selectedHealthMetadataRuleId) || null;
    }

    function healthCleanupBracketed(value, style = 'round') {
        let text = String(value || '').trim();
        const plainCredit = text.match(/^[\(\[\{]+\s*([^()\[\]{}]+?)\s*[\)\]\}]+$/);
        if (plainCredit) text = plainCredit[1].trim();
        const pairs = { '(': ')', '[': ']', '{': '}' };
        while (text && pairs[text[0]]) {
            const stack = [];
            let end = -1;
            for (let index = 0; index < text.length; index++) {
                const char = text[index];
                if (pairs[char]) stack.push(pairs[char]);
                else if (Object.values(pairs).includes(char)) {
                    if (!stack.length || stack.pop() !== char) break;
                    if (!stack.length) { end = index; break; }
                }
            }
            if (end !== text.length - 1) break;
            text = text.slice(1, -1).trim();
        }
        if (!text) return '';
        if (style === 'square') return `[${text}]`;
        if (style === 'none') return text;
        return `(${text})`;
    }

    function healthMetadataRuleAliases(rule) {
        return Array.isArray(rule?.aliases)
            ? rule.aliases.map(alias => String(alias || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
            : [];
    }

    function healthMetadataRuleCanonical(rule) {
        return String(rule?.canonical_name || rule?.name || '').replace(/\s+/g, ' ').trim();
    }

    function healthMetadataRuleAliasInputValues() {
        const value = String(document.getElementById('health-cleanup-rule-edit-aliases')?.value || '');
        const aliases = value.split(/[\n,]+/).map(alias => alias.replace(/\s+/g, ' ').trim()).filter(Boolean);
        return [...new Set(aliases.map(alias => alias.toLowerCase()))].map(key => aliases.find(alias => alias.toLowerCase() === key));
    }

    function updateHealthMetadataMergePanel() {
        const panel = document.getElementById('health-metadata-merge-panel');
        if (!panel) return;
        const selectedRules = healthMetadataRules.filter(rule => selectedHealthMetadataMergeIds.has(rule.id));
        const selectedTypes = [...new Set(selectedRules.map(rule => rule.designation))];
        const mergeReady = selectedRules.length >= 2 && selectedTypes.length === 1;
        const selectedType = selectedTypes[0] || 'artist';
        const title = document.getElementById('health-metadata-merge-title');
        const copy = document.getElementById('health-metadata-merge-copy');
        const input = document.getElementById('health-metadata-merge-name');
        const button = document.getElementById('health-metadata-merge-apply');
        if (title) title.textContent = selectedRules.length
            ? `${selectedRules.length.toLocaleString()} ${selectedType === 'tool' ? 'version words' : 'artist names'} selected`
            : 'Merge cleanup wording';
        if (copy) copy.textContent = selectedRules.length >= 2
            ? (selectedTypes.length === 1 ? selectedRules.map(rule => rule.name).join(', ') : 'Choose either names or version wording, not both at once.')
            : 'Select two or more names or two or more version words, then choose one display label.';
        if (input && document.activeElement !== input && selectedRules.length && !input.value) {
            input.value = healthMetadataRuleCanonical(selectedRules[0]);
        }
        if (button) button.disabled = !mergeReady;
        panel.dataset.ready = mergeReady ? 'true' : 'false';
        document.querySelectorAll('.health-metadata-rule-row').forEach(row => {
            row.classList.toggle('merge-selected', selectedHealthMetadataMergeIds.has(row.dataset.ruleId));
        });
    }

    function updateHealthCleanupRulePreview() {
        const rule = selectedHealthMetadataRule() || {};
        const wording = String(document.getElementById('health-cleanup-rule-edit-name')?.value || rule.name || 'DJ OWE').trim() || 'DJ OWE';
        const designation = document.getElementById('health-cleanup-rule-edit-designation')?.value || rule.designation || 'artist';
        const canonicalInput = document.getElementById('health-cleanup-rule-edit-canonical');
        const displayName = String(canonicalInput?.value || rule.canonical_name || wording).trim() || wording;
        const wrapped = healthCleanupBracketed(displayName, rule.brackets || 'round');
        const beforeTitle = designation === 'artist'
            ? `Title: Signal Fire (${wording} Slam Edit)`
            : `Title: Signal Fire ${healthCleanupBracketed(wording, 'round')}`;
        const beforeArtist = 'Artist: Original Artist';
        const afterTitle = designation === 'artist'
            ? 'Title: Signal Fire (Slam Edit)'
            : `Title: ${rule.version_position === 'before_title' ? `${wrapped} Signal Fire` : `Signal Fire ${wrapped}`}`;
        const afterArtist = designation === 'artist'
            ? `Artist: ${rule.artist_position === 'before_artist' ? `${wrapped} Original Artist` : `Original Artist ${wrapped}`}`
            : beforeArtist;
        setHealthText('health-cleanup-rule-before-title', beforeTitle);
        setHealthText('health-cleanup-rule-before-artist', beforeArtist);
        setHealthText('health-cleanup-rule-after-title', afterTitle);
        setHealthText('health-cleanup-rule-after-artist', afterArtist);
        const layoutAfter = `${rule.artist_position === 'before_artist' ? `${wrapped} Tupac` : `Tupac ${wrapped}`} – ${rule.version_position === 'before_title' ? `${healthCleanupBracketed('Acap Intro', rule.brackets || 'round')} Hit Em Up` : `Hit Em Up ${healthCleanupBracketed('Acap Intro', rule.brackets || 'round')}`}`;
        setHealthText('health-cleanup-layout-after', layoutAfter);
    }

    window.updateHealthCleanupRulePreview = updateHealthCleanupRulePreview;

    function populateHealthMetadataRuleEditor() {
        const rule = selectedHealthMetadataRule();
        if (!rule) return;
        const name = document.getElementById('health-cleanup-rule-edit-name');
        const canonical = document.getElementById('health-cleanup-rule-edit-canonical');
        const aliases = document.getElementById('health-cleanup-rule-edit-aliases');
        const designation = document.getElementById('health-cleanup-rule-edit-designation');
        const matchMode = document.getElementById('health-cleanup-rule-edit-match');
        const future = document.getElementById('health-cleanup-rule-edit-future');
        const layoutFuture = document.getElementById('health-cleanup-rule-layout-future');
        if (name && document.activeElement !== name) name.value = rule.name || '';
        if (canonical && document.activeElement !== canonical) canonical.value = rule.canonical_name || '';
        if (aliases && document.activeElement !== aliases) aliases.value = healthMetadataRuleAliases(rule).join(', ');
        if (designation) designation.value = rule.designation || 'artist';
        if (matchMode) matchMode.value = rule.match_mode || 'exact';
        if (future) future.checked = rule.apply_to_new !== false;
        if (layoutFuture) layoutFuture.checked = rule.apply_to_new !== false;
        document.querySelectorAll('[data-rule-choice]').forEach(button => {
            button.classList.toggle('selected', String(rule[button.dataset.ruleChoice] || '') === String(button.dataset.value || ''));
        });
        updateHealthCleanupRulePreview();
    }

    window.selectHealthMetadataRule = function (ruleId) {
        selectedHealthMetadataRuleId = String(ruleId || '');
        document.querySelectorAll('.health-metadata-rule-row').forEach(row => {
            row.classList.toggle('selected', row.dataset.ruleId === selectedHealthMetadataRuleId);
        });
        populateHealthMetadataRuleEditor();
    };

    window.toggleHealthMetadataRuleEnabled = async function (ruleId, trigger) {
        const rule = healthMetadataRules.find(item => item.id === ruleId);
        if (!rule) return;
        await saveHealthMetadataRule({ ...rule, enabled: !rule.enabled }, trigger);
    };

    window.toggleHealthMetadataRuleMerge = function (ruleId, checked) {
        const rule = healthMetadataRules.find(item => item.id === ruleId);
        if (!rule || rule.designation !== 'artist') return;
        if (checked) selectedHealthMetadataMergeIds.add(ruleId);
        else selectedHealthMetadataMergeIds.delete(ruleId);
        updateHealthMetadataMergePanel();
    };

    window.mergeSelectedHealthMetadataRules = async function (trigger = null) {
        const selectedRules = healthMetadataRules.filter(rule => selectedHealthMetadataMergeIds.has(rule.id));
        const selectedTypes = [...new Set(selectedRules.map(rule => rule.designation))];
        if (selectedRules.length < 2) return showToast('Select two or more cleanup rules to merge.', true);
        if (selectedTypes.length !== 1) return showToast('Merge artist names separately from version wording.', true);
        const designation = selectedTypes[0] || 'artist';
        const input = document.getElementById('health-metadata-merge-name');
        const canonicalName = String(input?.value || healthMetadataRuleCanonical(selectedRules[0])).replace(/\s+/g, ' ').trim();
        if (!canonicalName) {
            input?.focus();
            return showToast('Add the display label for this merged cleanup group.', true);
        }
        const aliasValues = [];
        selectedRules.forEach(rule => {
            aliasValues.push(rule.name, rule.canonical_name, ...healthMetadataRuleAliases(rule));
        });
        aliasValues.push(canonicalName);
        const aliases = [...new Map(aliasValues
            .map(alias => String(alias || '').replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .map(alias => [alias.toLowerCase(), alias])).values()];
        setAxiomButtonBusy(trigger, true, 'Merging...');
        try {
            let latestRules = healthMetadataRules;
            for (const rule of selectedRules) {
                const response = await fetch('/api/library/metadata_cleanup_rules', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...rule,
                        canonical_name: canonicalName,
                        aliases,
                        enabled: true,
                    }),
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(data.error || 'Cleanup rules could not be merged.');
                latestRules = Array.isArray(data.rules) ? data.rules : latestRules;
            }
            healthMetadataRules = latestRules;
            healthMetadataRulesLoaded = true;
            selectedHealthMetadataRuleId = selectedRules[0].id;
            renderHealthMetadataRules();
            await refreshHealthMetadataCleanupAfterRuleChange();
            const label = designation === 'artist' ? healthCleanupBracketed(canonicalName, 'round') : canonicalName;
            showToast(`Merged ${selectedRules.length.toLocaleString()} cleanup rules as ${label}.`);
        } catch (error) {
            showToast(error.message || 'Cleanup rules could not be merged.', true);
            await loadHealthMetadataRules({ force: true });
        } finally {
            setAxiomButtonBusy(trigger, false);
        }
    };

    window.setHealthMetadataRulesTab = function (tab = 'look', trigger = null) {
        healthCleanupRulesActiveTab = ['look', 'clean', 'safe'].includes(tab) ? tab : 'look';
        document.querySelectorAll('[data-cleanup-rules-tab]').forEach(button => {
            button.classList.toggle('active', button.dataset.cleanupRulesTab === healthCleanupRulesActiveTab);
        });
        document.querySelectorAll('[data-cleanup-rules-pane]').forEach(pane => {
            pane.classList.toggle('active', pane.dataset.cleanupRulesPane === healthCleanupRulesActiveTab);
        });
        const workbench = document.querySelector('.health-cleanup-rules-workbench');
        if (workbench) workbench.dataset.activeTab = healthCleanupRulesActiveTab;
        const helperCopy = {
            look: 'AXIOM will show you every change before anything is saved.',
            clean: 'Choose where your names and edit words should sit in your tracks.',
            safe: 'Choose what AXIOM must ask about and what it should always leave alone.',
        };
        setHealthText('health-cleanup-rules-helper', helperCopy[healthCleanupRulesActiveTab]);
        if (healthCleanupRulesActiveTab === 'safe') renderHealthCleanupSafety();
        else populateHealthMetadataRuleEditor();
        trigger?.focus?.();
    };

    window.selectHealthCleanupRuleChoice = function (trigger) {
        const rule = selectedHealthMetadataRule();
        if (!rule || !trigger?.dataset?.ruleChoice) return;
        rule[trigger.dataset.ruleChoice] = trigger.dataset.value;
        document.querySelectorAll(`[data-rule-choice="${CSS.escape(trigger.dataset.ruleChoice)}"]`).forEach(button => {
            button.classList.toggle('selected', button === trigger);
        });
        updateHealthCleanupRulePreview();
    };

    window.saveSelectedHealthMetadataRule = async function (trigger = null) {
        const rule = selectedHealthMetadataRule();
        if (!rule) return showToast('Choose a cleanup first.', true);
        const name = String(document.getElementById('health-cleanup-rule-edit-name')?.value || '').trim();
        if (!name) return showToast('Enter the wording AXIOM should look for.', true);
        const payload = {
            ...rule,
            name,
            designation: document.getElementById('health-cleanup-rule-edit-designation')?.value || rule.designation || 'artist',
            match_mode: document.getElementById('health-cleanup-rule-edit-match')?.value || rule.match_mode || 'exact',
            apply_to_new: Boolean(document.getElementById('health-cleanup-rule-edit-future')?.checked && document.getElementById('health-cleanup-rule-layout-future')?.checked),
            canonical_name: String(document.getElementById('health-cleanup-rule-edit-canonical')?.value || '').trim(),
            aliases: healthMetadataRuleAliasInputValues(),
        };
        const saved = await saveHealthMetadataRule(payload, trigger);
        if (saved) {
            selectedHealthMetadataRuleId = saved.id;
            renderHealthMetadataRules();
            showToast('Cleanup saved. Review matching tracks before applying it.');
        }
        return saved;
    };

    window.checkHealthMetadataRuleMatches = async function (trigger = null) {
        const saved = await saveSelectedHealthMetadataRule(trigger);
        if (!saved) return;
        const data = await loadHealthUtilityAudit({ force: true });
        const category = healthMetadataRuleCategoryIsVisible(currentHealthCleanupReview?.category)
            ? currentHealthCleanupReview.category
            : 'title_cleanup';
        const count = Number(data?.cleanable?.[category] || data?.summary?.[category] || 0);
        setHealthText('health-cleanup-rule-match-count', count.toLocaleString());
        showToast(`${count.toLocaleString()} matching cleanup track${count === 1 ? '' : 's'} found.`);
    };

    window.reviewHealthMetadataRuleMatches = async function () {
        const rule = selectedHealthMetadataRule();
        toggleHealthMetadataRulesPanel(false);
        if (axiomUiPreviewMode() === 'health-cleanup-sandbox') {
            await openHealthCleanupSandboxWorkbench({ openRules: false });
            return;
        }
        const category = healthMetadataRuleCategoryIsVisible(currentHealthCleanupReview?.category)
            ? currentHealthCleanupReview.category
            : (rule?.designation === 'artist' ? 'artist_format' : 'title_cleanup');
        await reviewHealthUtilityCategory(category);
    };

    window.openHealthCleanupSandboxWorkbench = async function ({ openRules = true } = {}) {
        currentHealthCleanupAudit = null;
        healthCleanupAuditLoadedAt = 0;
        const data = await loadHealthUtilityAudit({ force: true });
        const category = 'title_cleanup';
        const samples = (data?.samples?.[category] || []).map(normalizeModalTrackMetadata);
        const total = Math.max(0, Number(data?.cleanable?.[category] || samples.length || 0));
        currentHealthCleanupReview = {
            category,
            samples,
            total,
            loading: false,
            selectedIndexes: samples.map((_track, index) => index),
        };
        showTab('health-review');
        setHealthText('health-review-title', 'Title Cleanup');
        setHealthText('health-review-copy', 'AXIOM found editor credits and version notes that can be separated more clearly.');
        const badge = document.getElementById('health-review-ready-badge');
        if (badge) {
            badge.textContent = `${total.toLocaleString()} suggestions ready`;
            badge.classList.remove('hidden');
        }
        const container = document.getElementById('health-review-container');
        if (container) {
            container.setAttribute('aria-busy', 'false');
            container.innerHTML = renderHealthMetadataCleanupReview(category, samples, total, total);
        }
        updateHealthCleanupReviewSelection();
        syncHealthCleanupPreviewButtons();
        document.getElementById('health-metadata-rules-button')?.classList.remove('hidden');
        if (openRules) await toggleHealthMetadataRulesPanel(true);
        else await toggleHealthMetadataRulesPanel(false);
        updateLibraryCount(120);
        return data;
    };

    function loadHealthCleanupSafety() {
        try {
            const saved = JSON.parse(localStorage.getItem(HEALTH_CLEANUP_SAFETY_KEY) || 'null');
            return {
                ...HEALTH_CLEANUP_SAFETY_DEFAULTS,
                ...(saved && typeof saved === 'object' ? saved : {}),
                protectedItems: Array.isArray(saved?.protectedItems) ? saved.protectedItems : HEALTH_CLEANUP_SAFETY_DEFAULTS.protectedItems,
            };
        } catch (_error) {
            return { ...HEALTH_CLEANUP_SAFETY_DEFAULTS, protectedItems: [...HEALTH_CLEANUP_SAFETY_DEFAULTS.protectedItems] };
        }
    }

    function currentHealthCleanupSafetyFromControls() {
        const saved = loadHealthCleanupSafety();
        return {
            ...saved,
            askLarge: Boolean(document.getElementById('health-cleanup-safe-large')?.checked),
            threshold: Number(document.getElementById('health-cleanup-safe-threshold')?.value || saved.threshold || 25),
            skipUnclear: Boolean(document.getElementById('health-cleanup-safe-unclear')?.checked),
        };
    }

    window.renderHealthCleanupSafety = function () {
        const settings = loadHealthCleanupSafety();
        const askLarge = document.getElementById('health-cleanup-safe-large');
        const threshold = document.getElementById('health-cleanup-safe-threshold');
        const skipUnclear = document.getElementById('health-cleanup-safe-unclear');
        if (askLarge && document.activeElement !== askLarge) askLarge.checked = settings.askLarge !== false;
        if (threshold && document.activeElement !== threshold) threshold.value = String(settings.threshold || 25);
        if (skipUnclear && document.activeElement !== skipUnclear) skipUnclear.checked = settings.skipUnclear !== false;
        const live = currentHealthCleanupSafetyFromControls();
        const summary = document.getElementById('health-cleanup-safety-summary');
        if (summary) summary.innerHTML = `
            <div><span>Review every change</span><b>On</b></div>
            <div><span>Ask before large cleanups</span><b>${live.askLarge ? `${live.threshold}+ tracks` : 'Off'}</b></div>
            <div><span>Skip unclear matches</span><b>${live.skipUnclear ? 'On' : 'Off'}</b></div>
            <div><span>Protected items</span><b>${settings.protectedItems.length.toLocaleString()}</b></div>`;
        const list = document.getElementById('health-cleanup-safe-list');
        if (list) list.innerHTML = settings.protectedItems.map((item, index) => `
            <div><strong>${escapeHtml(item.name || '')}</strong><span>${item.type === 'track' ? 'One track' : 'Name or phrase'}</span><button type="button" onclick="removeHealthCleanupProtectedItem(${index})">Remove</button></div>`).join('');
        setHealthText('health-cleanup-safety-footer-copy', `Review every change · ${live.askLarge ? `Ask before ${live.threshold}+ tracks` : 'No batch pause'} · ${live.skipUnclear ? 'Skip unclear matches' : 'Include unclear matches'} · ${settings.protectedItems.length} protected items`);
    };

    window.addHealthCleanupProtectedItem = function () {
        const input = document.getElementById('health-cleanup-safe-name');
        const name = String(input?.value || '').trim();
        if (!name) return input?.focus();
        const settings = currentHealthCleanupSafetyFromControls();
        settings.protectedItems = [...settings.protectedItems, { name, type: document.getElementById('health-cleanup-safe-type')?.value || 'phrase' }];
        localStorage.setItem(HEALTH_CLEANUP_SAFETY_KEY, JSON.stringify(settings));
        if (input) input.value = '';
        renderHealthCleanupSafety();
    };

    window.removeHealthCleanupProtectedItem = function (index) {
        const settings = currentHealthCleanupSafetyFromControls();
        settings.protectedItems = settings.protectedItems.filter((_item, itemIndex) => itemIndex !== Number(index));
        localStorage.setItem(HEALTH_CLEANUP_SAFETY_KEY, JSON.stringify(settings));
        renderHealthCleanupSafety();
    };

    window.resetHealthCleanupSafety = function () {
        localStorage.setItem(HEALTH_CLEANUP_SAFETY_KEY, JSON.stringify(HEALTH_CLEANUP_SAFETY_DEFAULTS));
        renderHealthCleanupSafety();
        showToast('Cleanup safety choices reset. Locked protections remain on.');
    };

    window.saveHealthCleanupSafety = function (trigger = null) {
        const settings = currentHealthCleanupSafetyFromControls();
        localStorage.setItem(HEALTH_CLEANUP_SAFETY_KEY, JSON.stringify(settings));
        renderHealthCleanupSafety();
        showToast('Cleanup safety settings saved. Source audio and DJ libraries remain untouched.');
        trigger?.focus?.();
    };

    async function refreshHealthMetadataCleanupAfterRuleChange() {
        currentHealthCleanupAudit = null;
        healthCleanupAuditLoadedAt = 0;
        if (axiomReviewMode() === 'health' && axiomUiPreviewMode() !== 'health-cleanup-sandbox') return;
        const category = currentHealthCleanupReview?.category;
        await loadHealthUtilityAudit({ force: true });
        if (healthMetadataRuleCategoryIsVisible(category) && window.axiomVisibleTab === 'health-review') {
            await reviewHealthUtilityCategory(category);
        }
    }

    async function saveHealthMetadataRule(payload, trigger = null) {
        setAxiomButtonBusy(trigger, true, '<span>Saving…</span>');
        try {
            const response = await fetch('/api/library/metadata_cleanup_rules', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Metadata rule could not be saved.');
            healthMetadataRules = Array.isArray(data.rules) ? data.rules : healthMetadataRules;
            healthMetadataRulesLoaded = true;
            renderHealthMetadataRules();
            await refreshHealthMetadataCleanupAfterRuleChange();
            showToast('Metadata workflow updated. Source audio untouched.');
            return data.rule || null;
        } catch (error) {
            showToast(error.message || 'Metadata rule could not be saved.', true);
            await loadHealthMetadataRules({ force: true });
            return null;
        } finally {
            setAxiomButtonBusy(trigger, false);
        }
    }

    window.addHealthMetadataRule = async function () {
        const nameInput = document.getElementById('health-metadata-rule-name');
        const designationInput = document.getElementById('health-metadata-rule-designation');
        const button = document.getElementById('health-metadata-rule-add');
        const name = String(nameInput?.value || '').trim();
        if (!name) {
            nameInput?.focus();
            return showToast('Enter an Artist name or Tool phrase first.', true);
        }
        const saved = await saveHealthMetadataRule({
            name,
            designation: designationInput?.value || 'artist',
            enabled: true,
            match_mode: 'exact',
            apply_to_new: true,
            artist_position: 'after_artist',
            version_position: 'after_title',
            brackets: 'round',
            canonical_name: '',
            aliases: [],
        }, button);
        if (saved && nameInput) {
            selectedHealthMetadataRuleId = saved.id;
            nameInput.value = '';
            nameInput.focus();
            renderHealthMetadataRules();
        }
    };

    window.updateHealthMetadataRule = async function (ruleId) {
        const row = document.querySelector(`.health-metadata-rule-row[data-rule-id="${CSS.escape(String(ruleId || ''))}"]`);
        if (!row) return;
        const name = String(row.querySelector('.health-metadata-rule-value')?.value || '').trim();
        if (!name) {
            await deleteHealthMetadataRule(ruleId);
            return;
        }
        const designation = row.querySelector('.health-metadata-rule-type')?.value || 'artist';
        const enabled = Boolean(row.querySelector('.health-metadata-rule-switch input')?.checked);
        await saveHealthMetadataRule({ id: ruleId, name, designation, enabled });
    };

    window.deleteHealthMetadataRule = async function (ruleId) {
        const rule = healthMetadataRules.find(item => item.id === ruleId);
        if (!rule) return;
        const confirmed = await showAxiomConfirm(
            'Remove Metadata Rule',
            `Remove “${rule.name}” from Title Cleanup? AXIOM will stop recognising it as an ${rule.designation === 'artist' ? 'Artist' : 'Tool'}. Your source audio and DJ libraries stay untouched.`,
            'REMOVE RULE',
            'danger'
        );
        if (!confirmed) {
            renderHealthMetadataRules();
            return;
        }
        try {
            const response = await fetch('/api/library/metadata_cleanup_rules', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: ruleId }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Metadata rule could not be removed.');
            healthMetadataRules = Array.isArray(data.rules) ? data.rules : [];
            healthMetadataRulesLoaded = true;
            renderHealthMetadataRules();
            await refreshHealthMetadataCleanupAfterRuleChange();
            showToast(`“${rule.name}” removed from the metadata workflow.`);
        } catch (error) {
            showToast(error.message || 'Metadata rule could not be removed.', true);
        }
    };

    window.toggleHealthMetadataRulesPanel = async function (force) {
        const panel = document.getElementById('health-metadata-rules-panel');
        const button = document.getElementById('health-metadata-rules-button');
        if (!panel || !button) return;
        const open = typeof force === 'boolean' ? force : panel.classList.contains('hidden');
        panel.classList.toggle('hidden', !open);
        panel.setAttribute('aria-hidden', open ? 'false' : 'true');
        button.setAttribute('aria-expanded', open ? 'true' : 'false');
        document.getElementById('tab-content-health-review')?.classList.toggle('metadata-rules-open', open);
        if (open) {
            await loadHealthMetadataRules();
            setHealthMetadataRulesTab(healthCleanupRulesActiveTab || 'look');
            requestAnimationFrame(() => document.querySelector('[data-cleanup-rules-tab].active')?.focus());
        } else if (!button.classList.contains('hidden')) {
            button.focus();
        }
    };

    async function revealHealthFile(path, button) {
        if (!path) return;
        if (button) button.disabled = true;
        try {
            const response = await fetch('/api/library/reveal', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({path})});
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.message || 'Could not reveal this file.');
        } catch (error) { showToast(error.message, true); }
        finally { if (button) button.disabled = false; }
    }

    function healthCleanupFieldComparison(track, preview, proposed = true) {
        const artist = proposed ? preview.artist : track.artist;
        const title = proposed ? preview.title : track.title;
        const otherArtist = proposed ? track.artist : preview.artist;
        const otherTitle = proposed ? track.title : preview.title;
        return `<div class="health-cleanup-field"><small>ARTIST / DJ CREDIT</small><span>${healthCleanupDiffHtml(artist || '', otherArtist || '')}</span></div>
            <div class="health-cleanup-field"><small>TRACK TITLE / VERSION</small><span>${healthCleanupDiffHtml(title || '', otherTitle || '')}</span></div>`;
    }

    function renderHealthMetadataCleanupReview(category, samples = [], total = 0, cleanableCount = 0) {
        const cfg = HEALTH_CLEANUP_CATEGORIES[category] || {};
        const review = currentHealthCleanupReview;
        if (review) healthCleanupSelectedIndexes(review);
        const selected = new Set(healthCleanupSelectedIndexes(review));
        const previewRows = samples
            .map((track, index) => ({ track, index, preview: healthCleanupResolvedPreview(track, index, review) }))
            .filter(item => item.preview.changed);
        const visibleCount = previewRows.length;
        const allCount = Math.max(total, cleanableCount, visibleCount);
        return `
            <div class="health-clean-review" data-health-cleanup-category="${escapeHtml(category)}">
                <section class="health-clean-review-summary" aria-label="Cleanup review totals">
                    <div class="health-clean-review-stat ready">
                        <img src="/static/icons/check-circle.svg" alt="" aria-hidden="true">
                        <div><span>Found</span><strong>${allCount.toLocaleString()}</strong><small>Suggestions found</small></div>
                    </div>
                    <div class="health-clean-review-stat">
                        <img src="/static/icons/check-circle.svg" alt="" aria-hidden="true">
                        <div><span>Selected</span><strong id="health-cleanup-selected-count">${selected.size.toLocaleString()}</strong><small>Ready to apply</small></div>
                    </div>
                    <div class="health-clean-review-stat">
                        <img src="/static/icons/check-circle.svg" alt="" aria-hidden="true">
                        <div><span>Changed</span><strong id="health-cleanup-changed-count">0</strong><small>After you apply</small></div>
                    </div>
                </section>

                <section class="health-clean-review-list" aria-label="Cleanup suggestions">
                    <div class="health-clean-review-columns health-clean-review-grid" aria-hidden="true">
                        <input id="health-cleanup-select-all" class="health-clean-review-check" type="checkbox" ${selected.size === samples.length && samples.length ? 'checked' : ''} onchange="toggleAllHealthCleanupReviewSelections(this.checked)" aria-label="Select all cleanup suggestions">
                        <span>Track actions</span><span>Current</span><span>Proposed</span><span>Why</span>
                    </div>
                    ${previewRows.map(({ track, index, preview }) => {
                        const before = healthCleanupComparisonValue(track, preview, false);
                        const after = healthCleanupComparisonValue(track, preview, true);
                        const isSelected = selected.has(index);
                        const canPreviewAudio = Boolean(track.path && !track.health_review_cleanup_fixture);
                        return `
                            <div class="health-clean-review-row health-clean-review-grid" data-health-clean-review-index="${index}" data-selected="${isSelected ? 'true' : 'false'}" data-path="${escapeHtml(track.path || '')}">
                                <input class="health-clean-review-check" type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleHealthCleanupReviewSelection(${index}, this.checked)" aria-label="Include ${escapeHtml(healthCleanupTrackLabel(track, preview))}">
                                <div class="health-cleanup-track-actions"><button class="health-clean-review-preview-button" type="button" data-health-cleanup-audio-index="${index}" onclick="previewHealthCleanupTrack(${index}, this)" aria-label="Listen to ${escapeHtml(healthCleanupTrackLabel(track, preview))}" aria-pressed="false" ${canPreviewAudio ? '' : 'disabled title="Audio preview is available for real library tracks"'}>
                                    <img src="/static/icons/audio-waveform.svg" alt="" aria-hidden="true"><span>Listen</span>
                                </button>
                                <button class="health-clean-review-preview-button" type="button" data-health-file="${escapeHtml(track.path || '')}" onclick="revealHealthFile(this.dataset.healthFile, this)" ${canPreviewAudio ? '' : 'disabled'}>Reveal in Finder</button></div>
                                <div class="health-clean-review-value">${healthCleanupFieldComparison(track, preview, false)}</div>
                                <div class="health-clean-review-value proposed">
                                    <span data-health-cleanup-proposal-value>${healthCleanupFieldComparison(track, preview)}</span>
                                    <button class="health-cleanup-pencil" data-health-cleanup-edit-index="${index}" type="button" onclick="openHealthCleanupCorrection(${index}, this)" aria-label="Fix the proposed title and artist for ${escapeHtml(healthCleanupTrackLabel(track, preview))}" aria-expanded="false">
                                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4.2L19 9.2 14.8 5 4 15.8V20Zm11.7-16 4.3 4.3 1-1a1.4 1.4 0 0 0 0-2L18.7 3a1.4 1.4 0 0 0-2 0l-1 1Z"/></svg>
                                        <span>Edit</span>
                                    </button>
                                    <small data-health-cleanup-custom-badge ${preview.custom_edit ? '' : 'hidden'}>${preview.rule_saved ? 'Edited by you · Rule saved' : 'Edited by you'}</small>
                                </div>
                                <div class="health-clean-review-why">${escapeHtml(healthCleanupWhyCopy(category, track, preview))}</div>
                            </div>
                        `;
                    }).join('')}
                </section>

                <div class="health-clean-review-trustline" role="note">
                    <img src="/static/icons/check-circle.svg" alt="" aria-hidden="true">
                    <span>AXIOM cache only. Source audio, Serato, and djay Pro stay untouched. Completion totals appear after cleanup.</span>
                </div>

                <div class="health-clean-review-actions health-clean-review-decisions">
                    <button class="health-clean-review-button" type="button" onclick="currentHealthCleanupReview = null; showTab('health')">Back</button>
                    <button id="health-cleanup-remove-selected" class="health-clean-review-button" type="button" onclick="removeHealthReviewTracks('metadata', this)" ${selected.size ? '' : 'disabled'}><img src="/static/icons/x.svg" alt="" aria-hidden="true"><span>Remove Selected from AXIOM</span></button>
                    <details class="health-cleanup-more"><summary><span>MORE OPTIONS</span><img src="/static/icons/chevron-down.svg" alt="" aria-hidden="true"></summary><div>
                    <button class="health-clean-review-button" type="button" onclick="toggleHealthMetadataRulesPanel(true)">Merge Names / Versions</button>
                    ${allCount > visibleCount ? `<button class="health-clean-review-button link" type="button" onclick="setHealthUtilityMetadataCleanupForReview('${category}', true, 'all_candidates', this)">Apply all ${allCount.toLocaleString()}</button>` : ''}
                    </div></details>
                    <span class="spacer"></span>
                    <button id="health-cleanup-apply-selected" class="health-clean-review-button primary" type="button" onclick="setHealthUtilityMetadataCleanupForReview('${category}', true, 'sample', this)">${healthCleanupApplyButtonCopy(selected.size, review)}</button>
                </div>
            </div>
        `;
    }

    function renderHealthMetadataCleanupReceipt(category, samples = [], result = {}) {
        const container = document.getElementById('health-review-container');
        if (!container) return;
        const applied = result.applied !== false;
        const count = Math.max(0, Number(result.count || 0));
        const checked = Math.max(count, Number(result.checked || samples.length || 0));
        const remainingVerified = result.remainingVerified !== false && result.pending !== null;
        const pending = remainingVerified ? Math.max(0, Number(result.pending || 0)) : null;
        const remainingCopy = remainingVerified ? `${pending.toLocaleString()} files left` : 'Remaining files need a fresh check';
        const verb = applied ? 'Fixed' : 'Restored';
        const artistCleanup = category === 'artist_format';
        metadataPublishReviewPaths = applied && !result.demo
            ? samples.map(track => track.path).filter(Boolean)
            : [];
        const itemNoun = artistCleanup ? 'artist credit' : 'title';
        const titleEl = document.getElementById('health-review-title');
        const copyEl = document.getElementById('health-review-copy');
        const badge = document.getElementById('health-review-ready-badge');
        if (titleEl) titleEl.textContent = applied
            ? (artistCleanup ? 'Artist Cleanup Results' : 'Title Cleanup Results')
            : (artistCleanup ? 'Artists Restored' : 'Titles Restored');
        if (copyEl) copyEl.textContent = applied
            ? remainingCopy
            : 'The previous AXIOM cache values have been restored.';
        if (badge) {
            badge.classList.remove('hidden');
            badge.textContent = applied ? remainingCopy : `${verb} ${count.toLocaleString()}`;
        }
        container.setAttribute('aria-busy', 'false');
        container.innerHTML = `
            <div class="health-clean-review">
                <section class="health-clean-review-summary" aria-label="Cleanup completion totals">
                    <div class="health-clean-review-stat ready">
                        <img src="/static/icons/check-circle.svg" alt="" aria-hidden="true">
                        <div><span>Checked</span><strong>${checked.toLocaleString()}</strong><small>Processed safely</small></div>
                    </div>
                    <div class="health-clean-review-stat">
                        <img src="/static/icons/check-circle.svg" alt="" aria-hidden="true">
                        <div><span>${verb}</span><strong>${count.toLocaleString()}</strong><small>${applied ? 'Saved in AXIOM' : 'Previous values restored'}</small></div>
                    </div>
                    <div class="health-clean-review-stat">
                        <img src="/static/icons/check-circle.svg" alt="" aria-hidden="true">
                        <div><span>Files Left</span><strong>${remainingVerified ? pending.toLocaleString() : 'Unknown'}</strong><small>${remainingVerified ? (pending ? 'Still needs attention' : 'Verified by fresh review') : 'Refresh Health to check'}</small></div>
                    </div>
                </section>
                <section class="health-clean-review-receipt" aria-live="polite">
                    <div class="health-clean-review-receipt-head">
                        <div><h3>${applied ? remainingCopy : `${verb} ${count.toLocaleString()} ${itemNoun}${count === 1 ? '' : 's'}`}</h3><p>Checked ${checked.toLocaleString()} · ${verb} ${count.toLocaleString()} · ${remainingCopy}</p></div>
                    </div>
                    <div class="health-clean-review-list">
                        <div class="health-clean-review-receipt-columns health-clean-review-receipt-grid" aria-hidden="true">
                            <span>Track</span><span>Before</span><span>After</span>
                        </div>
                        ${samples.map(track => {
                            const preview = track.cleanup_preview || {};
                            const before = healthCleanupComparisonValue(track, preview, false);
                            const after = healthCleanupComparisonValue(track, preview, true);
                            return `
                                <div class="health-clean-review-row health-clean-review-receipt-grid">
                                    <div class="health-clean-review-track"><strong>${escapeHtml(healthCleanupTrackLabel(track, preview))}</strong><small>${escapeHtml(track.artist || 'Unknown Artist')}</small></div>
                                    <div class="health-clean-review-value">${healthCleanupDiffHtml(applied || result.serverValues ? before : after, applied || result.serverValues ? after : before)}</div>
                                    <div class="health-clean-review-value proposed">${healthCleanupDiffHtml(applied || result.serverValues ? after : before, applied || result.serverValues ? before : after)}</div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </section>
                <section class="health-clean-review-proof">
                    <div><img src="/static/icons/check-circle.svg" alt="" aria-hidden="true"><span><strong>${result.demo ? 'Browser fixture only' : 'AXIOM cache updated'}</strong><small>Source audio, Serato, and djay Pro were untouched.</small></span></div>
                    <div><img src="/static/icons/file-up.svg" alt="" aria-hidden="true"><span><strong>Receipt complete</strong><small>This page shows exactly what was checked, changed, and left pending.</small></span></div>
                </section>
                <div class="health-clean-review-actions">
                    <button class="health-clean-review-button" type="button" onclick="currentHealthCleanupReview = null; showTab('health')">Back to Health</button>
                    ${applied && (!remainingVerified || pending > 0) ? `<button class="health-clean-review-button primary" type="button" onclick="reviewNextHealthMetadataCleanup('${category}', this, ${!remainingVerified})">${remainingVerified ? `Review next ${Math.min(120, pending).toLocaleString()}` : 'Check remaining files'}</button>` : ''}
                    ${applied && count > 0 && (result.demo || result.batch_id) ? `<button class="health-clean-review-button" type="button" onclick="setHealthUtilityMetadataCleanupForReview('${category}', false, 'sample', this)">${artistCleanup ? 'Restore Artists' : 'Restore Titles'}</button>` : ''}
                    ${applied && !result.demo && metadataPublishReviewPaths.length ? '<button class="health-clean-review-button primary" type="button" onclick="startMetadataPublishPreview(this)">Preview DJ Publish</button>' : ''}
                    ${result.demo ? `<button class="health-clean-review-button" type="button" onclick="resetHealthReviewCleanupDemo('${category}')">Reset Demo</button>` : ''}
                </div>
            </div>
        `;
    }


    window.resetHealthReviewCleanupDemo = function (category = 'title_cleanup') {
        currentHealthCleanupAudit = healthReviewCleanupDemoAudit();
        healthCleanupAuditLoadedAt = Date.now();
        updateHealthCleanupPanel(currentHealthCleanupAudit);
        reviewHealthUtilityCategory(category);
    };
