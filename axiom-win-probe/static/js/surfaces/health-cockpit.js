/* Health presentation only: preserve the existing controls, IDs and scan engines. */
(function () {
    'use strict';
    const byId = id => document.getElementById(id);
    const body = key => byId(`health-section-body-${key}`);
    const itemSections = {stingers: 'detox', transitions: 'detox', sound_effects: 'detox', mixtapes: 'detox', genres: 'organisation', title_cleanup: 'metadata', artist_format: 'metadata', missing_year: 'era', missing_file: 'files', missing_bpm: 'bpm', missing_key: 'bpm', bpm_review: 'bpm', key_review: 'bpm'};
    const move = (selector, target) => {
        const node = document.querySelector(selector);
        if (node && target && node.parentElement !== target) target.appendChild(node);
        return node;
    };
    const setText = (id, value) => {
        const node = byId(id);
        if (node && node.textContent !== String(value)) node.textContent = String(value);
    };
    const number = id => Number((byId(id)?.textContent || '0').replace(/[^\d]/g, '')) || 0;
    const text = id => byId(id)?.textContent?.trim() || '';
    let mounted = false;
    let selectedGroup = 'all';
    let lastSessionState = '';
    let backgroundJob = null;
    function updateBackgroundJob(job) { backgroundJob = job; if (mounted) sync(); }
    const groups = [
        ['cleanup', 'Clean up', ['detox', 'organisation', 'files', 'cache']],
        ['details', 'Fix details', ['metadata', 'era', 'bpm', 'doctor']],
        ['sync', 'Sync to DJ software', ['refresh', 'transfer', 'connections']],
        ['ready', 'Ready to play', ['audio', 'inbox']]
    ];

    function filterTools(group) {
        if (group) selectedGroup = group;
        const query = (byId('health-cockpit-search')?.value || '').trim().toLowerCase();
        document.querySelectorAll('[data-health-group-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.healthGroupFilter === selectedGroup)));
        document.querySelectorAll('[data-health-side-group]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.healthSideGroup === selectedGroup)));
        document.querySelectorAll('[data-health-section]').forEach(section => {
            section.hidden = (selectedGroup !== 'all' && section.dataset.healthGroup !== selectedGroup) || !section.querySelector('summary').textContent.toLowerCase().includes(query);
        });
        document.querySelectorAll('.health-cockpit-tool-group').forEach(groupNode => { groupNode.hidden = ![...groupNode.querySelectorAll('[data-health-section]')].some(section => !section.hidden); });
    }
    function expandTools(button) {
        const expand = button.dataset.expanded !== 'true';
        document.querySelectorAll('[data-health-section]').forEach(section => { if (!section.hidden) section.open = expand; });
        button.dataset.expanded = String(expand); button.textContent = expand ? 'Collapse all' : 'Expand all';
    }
    function sessionTab(key) {
        if (!['queue', 'receipt', 'publish'].includes(key)) return;
        document.querySelectorAll('[data-health-session-tab]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.healthSessionTab === key)));
        ['queue', 'receipt', 'publish'].forEach(name => { byId(`health-cockpit-session-${name}`).hidden = name !== key; });
    }
    function showProgress() {
        const live = byId('health-cockpit-live');
        if (!live.hidden) {
            live.dataset.expanded = 'true';
            const button = byId('health-cockpit-scan-details');
            button.setAttribute('aria-expanded', 'true'); button.textContent = 'Hide details';
            live.scrollIntoView({behavior: 'smooth', block: 'nearest'});
        } else sessionTab('receipt');
    }
    function openDoctor() {
        open('doctor', {scroll: true});
        if (typeof selectHealthDjTransferTask === 'function') selectHealthDjTransferTask('grids');
        move('#health-dj-transfer-detail', body('doctor'));
        window.selectBeatgridDoctorTarget?.(byId('health-doctor-provider')?.value || 'djay');
    }

    function open(key, options = {}) {
        const section = byId(`health-section-${key}`);
        if (!section) return;
        if (section.hidden) {
            byId('health-cockpit-search').value = '';
            filterTools(section.dataset.healthGroup);
        }
        section.open = true;
        if (options.detail) move('#health-inbox-detail', body(key));
        if (options.scroll) section.scrollIntoView({behavior: 'smooth', block: 'nearest'});
    }

    function selectItem(item) {
        if (!mounted) return;
        const key = itemSections[item];
        if (key) open(key, {detail: !['detox', 'metadata'].includes(key)});
        if (key === 'detox') body('detox').dataset.reviewing = 'true';
    }

    function chip(key, count, noun = 'items', empty = 'Ready') {
        const node = byId(`health-section-status-${key}`);
        if (!node) return;
        const label = count === null ? empty : count > 0 ? `${count.toLocaleString()} ${count === 1 ? noun.replace(/s$/, '') : noun}` : empty;
        const tone = count === null ? 'neutral' : count > 0 ? 'attention' : 'ready';
        setText(node.id, label);
        if (node.dataset.tone !== tone) node.dataset.tone = tone;
    }

    function sync() {
        if (!mounted) return;
        const shell = byId('health-inbox-app');
        const known = shell.dataset.healthHasSnapshot === 'true';
        if (known) {
            chip('detox', number('health-inbox-set-building-count'), 'candidates');
            chip('metadata', number('health-cleanup-title-cleanup') + number('health-cleanup-artist-format'), 'checks');
            chip('era', number('health-repair-year-count'), 'missing years');
            chip('files', number('health-stat-missing-file'), 'missing');
            chip('bpm', number('health-repair-bpm-count') + number('health-repair-key-count'), 'checks');
            chip('inbox', number('health-new-music-prepare') + number('health-new-music-review'), 'to prepare');
            setText('health-cockpit-detox-review', `Review ${number('health-inbox-set-building-count')} candidates`);
        }
        chip('organisation', null, '', 'Open tools');
        chip('refresh', null, '', 'Optional');
        chip('audio', null, '', 'Check audio');
        chip('connections', null, '', 'Optional');
        chip('transfer', null, '', 'Preview');
        chip('cache', null, '', 'Open tools');
        chip('doctor', null, '', window.AxiomHealthDoctor?.statusLabel() || 'Check beatgrids');
        const job = typeof lastUnifiedHealthJob === 'undefined' ? {} : lastUnifiedHealthJob || {};
        const finished = shell.dataset.healthJobState === 'finished';
        const needs = known && typeof healthSummarySnapshot === 'function' ? healthSummarySnapshot().total_blockers : finished ? Number(job.totals?.still_missing ?? job.totals?.unresolved ?? 0) : number('health-stat-total') + number('health-inbox-attention-count') + number('health-stat-missing-file');
        const icon = byId('health-cockpit-health-icon');
        const iconPath = `/static/icons/${(known || finished) && !needs ? 'check-circle' : 'circle-alert'}.svg`;
        if (icon && icon.getAttribute('src') !== iconPath) icon.setAttribute('src', iconPath);
        if (icon) icon.dataset.tone = (known || finished) && !needs ? 'ready' : 'attention';
        setText('health-cockpit-metric-repairs', text('health-stat-total'));
        setText('health-cockpit-hero-count', text('health-stat-total'));
        setText('health-cockpit-hero-label', text('health-stat-total-label') || 'Repair checks');
        setText('health-cockpit-metric-repairs-label', text('health-stat-total-label') || 'Repairs needed');
        setText('health-cockpit-metric-tracks', text('health-inbox-track-total'));
        setText('health-cockpit-metric-review', text('health-inbox-attention-count'));
        setText('health-cockpit-metric-time', text('health-inbox-last-checked'));
        syncMastheadScan();

        const scanActive = shell.dataset.healthJobState === 'active';
        const batch = typeof healthMetadataBatch === 'undefined' ? {} : healthMetadataBatch;
        const batchActive = ['previewing', 'planning', 'backing_up', 'publishing', 'rolling_back'].includes(batch.state);
        syncBatchPublishGate({known, batchActive});
        const research = typeof releaseYearResearchJob === 'undefined' ? {} : releaseYearResearchJob;
        const researchActive = ['starting', 'running'].includes(research.status);
        const live = byId('health-cockpit-live');
        live.hidden = !scanActive && !batchActive && !researchActive;
        byId('health-cockpit-overview').hidden = !live.hidden;
        byId('health-cockpit-morph').dataset.state = live.hidden ? 'overview' : 'working';
        byId('health-cockpit-live-console').hidden = !scanActive;
        byId('health-cockpit-scan-details').hidden = !scanActive;
        const extra = byId('health-cockpit-other-progress');
        extra.hidden = !batchActive && !researchActive;
        if (batchActive || researchActive) setText(extra.id, [batchActive ? text('health-batch-status') : '', researchActive ? text('health-release-year-research-status') : ''].filter(Boolean).join(' · '));
        setText('health-cockpit-live-label', scanActive ? 'Scan running' : batchActive ? 'Updating DJ files' : 'Finding original years');
        const doctorActive = backgroundJob?.active === true;
        const sessionState = scanActive || batchActive || researchActive || doctorActive ? 'active' : shell.dataset.healthJobState || 'idle';
        if (sessionState !== lastSessionState) {
            if (sessionState === 'active') sessionTab('queue');
            else if (sessionState === 'finished') sessionTab('receipt');
            lastSessionState = sessionState;
        }
        setText('health-cockpit-queue-title', scanActive ? 'Health scan running' : batchActive ? 'Publishing reviewed tags' : researchActive ? 'Year research running' : backgroundJob?.title || 'Queue idle');
        setText('health-cockpit-queue-copy', scanActive ? text('health-approved-working-status') || 'Checking your library. Source audio stays unchanged.' : batchActive || researchActive ? extra.textContent : backgroundJob?.copy || (finished ? 'Scan finished. Results are in your receipt.' : 'Choose a Health tool to begin.'));
        byId('health-cockpit-queue-stop').hidden = !scanActive;
        // A receipt stays accessible after the live-only summary disappears.
        const receipt = document.querySelector('.health-approved-results');
        if (receipt && shell.dataset.healthJobState === 'finished') receipt.classList.add('health-cockpit-receipt');
    }

    function syncMastheadScan() {
        const mastheadButton = byId('health-cockpit-scan-health');
        if (!mastheadButton) return;
        const primary = byId('health-prepare-library');
        const note = byId('health-cockpit-scan-note');
        const action = 'refresh';
        mastheadButton.dataset.healthAction = action;
        delete mastheadButton.dataset.healthTarget;
        mastheadButton.disabled = Boolean(primary?.disabled);
        mastheadButton.textContent = 'Scan Health';
        if (!note) return;
        const noteByAction = {
            refresh: 'Check for new issues. Your files stay unchanged.',
            plan: 'Review the repair plan before AXIOM starts.',
            workspace: 'Open the tracks that still need attention.'
        };
        note.textContent = mastheadButton.disabled ? 'Health is working on your library.' : noteByAction[action] || 'Run Health before publishing tags.';
    }

    function syncBatchPublishGate(state = {}) {
        const shell = byId('health-inbox-app');
        const batchPanel = byId('health-batch-panel');
        if (!shell || !batchPanel) return false;
        const forcedLocked = new URLSearchParams(location.search).get('health_publish_locked') === '1';
        const known = forcedLocked ? false : typeof state.known === 'boolean' ? state.known : shell.dataset.healthHasSnapshot === 'true';
        const batchActive = Boolean(state.batchActive);
        const locked = !known;
        batchPanel.dataset.healthPublishLocked = String(locked);
        batchPanel.setAttribute('aria-disabled', String(locked));
        const start = byId('health-batch-start');
        if (start) start.disabled = locked || batchActive || start.dataset.healthBatchBusy === 'true';
        const status = byId('health-batch-status');
        if (status && locked && !batchActive) status.textContent = 'Run Scan Health first. Publishing unlocks after Health saves results.';
        return !locked;
    }

    function scanHealth(button) {
        const trigger = button || byId('health-cockpit-scan-health');
        if (typeof handleHealthReadinessPrimary === 'function') {
            return handleHealthReadinessPrimary(trigger);
        }
        if (typeof runLibraryHealthCheck === 'function') {
            return runLibraryHealthCheck({force: true, triggerBtn: trigger});
        }
        return undefined;
    }

    function mount() {
        if (mounted || !byId('health-cockpit')) return;
        const shell = byId('health-inbox-app');
        const sidebar = document.createElement('nav'); sidebar.id = 'health-workspace-sidebar'; sidebar.setAttribute('aria-label', 'Health workspace navigation');
        sidebar.innerHTML = '<small>Library Health</small>' + [['all','Overview','heart-pulse','13'],['cleanup','Clean up','trash-2','4'],['details','Fix details','sliders-horizontal','4'],['sync','Sync to DJ','arrow-right','3'],['ready','Ready to play','play','2']].map(([key,label,icon,count]) => `<button type="button" data-health-side-group="${key}" aria-pressed="${key === 'all'}" onclick="AxiomHealthCockpit.filterTools('${key}');document.getElementById('health-view').scrollTo({top:0,behavior:'smooth'})"><img src="/static/icons/${icon}.svg" alt=""><span>${label}</span><small>${count}</small></button>`).join('') + '<hr><small>This session</small><button type="button" onclick="AxiomHealthCockpit.sessionTab(\'queue\')"><img src="/static/icons/arrow-right.svg" alt=""><span>Background queue</span></button><button type="button" onclick="AxiomHealthCockpit.sessionTab(\'receipt\')"><img src="/static/icons/rotate-cw.svg" alt=""><span>Session history</span></button><button type="button" onclick="toggleMasterHud()"><img src="/static/icons/settings.svg" alt=""><span>Settings</span></button><button class="health-workspace-back" type="button" onclick="showTab(\'library\')">Back to PEAK HOUR</button><div class="health-workspace-pledge"><strong>Your music.<br>Untouched.</strong><p>Health repairs stay in AXIOM until you publish.</p></div>';
        sidebar.querySelectorAll('button').forEach(button => button.setAttribute('data-axiom-cta-skip','true'));
        byId('axiom-sidebar').appendChild(sidebar);
        const appbar = document.createElement('header'); appbar.id = 'health-workspace-appbar';
        appbar.innerHTML = '<button type="button" class="health-workspace-wordmark" onclick="showAxiomStart()" aria-label="Open PEAK HOUR workspaces">PEAK HOUR</button><span class="health-workspace-context"><img src="/static/icons/heart-pulse.svg" alt="">Health workspace</span><div><button type="button" onclick="AxiomHealthCockpit.sessionTab(\'receipt\')"><img src="/static/icons/rotate-cw.svg" alt="">History</button><button type="button" onclick="toggleTheme()">Day / Night</button><button type="button" onclick="toggleMasterHud()"><img src="/static/icons/settings.svg" alt="">Settings</button></div>';
        appbar.querySelectorAll('button').forEach(button => button.setAttribute('data-axiom-cta-skip','true'));
        document.body.appendChild(appbar);
        const syncWorkspace = () => document.body.classList.toggle('health-workspace-active', !byId('health-view').classList.contains('hidden'));
        new MutationObserver(syncWorkspace).observe(byId('health-view'), {attributes: true, attributeFilter: ['class']});
        syncWorkspace();
        const overview = byId('health-cockpit-overview');
        const header = move('.health-readiness-header', overview);
        header.classList.add('health-cockpit-bay');
        const icon = document.createElement('img');
        icon.id = 'health-cockpit-health-icon'; icon.src = '/static/icons/circle-alert.svg'; icon.alt = '';
        header.querySelector('.health-readiness-copy').prepend(icon);
        const hero = document.createElement('div'); hero.className = 'health-cockpit-hero'; hero.innerHTML = '<strong id="health-cockpit-hero-count">—</strong><small id="health-cockpit-hero-label">Repair checks</small>';
        header.querySelector('.health-readiness-copy').prepend(hero);
        const topline = document.createElement('div'); topline.className = 'health-cockpit-overview-topline'; topline.textContent = 'Library overview'; header.prepend(topline);
        const metrics = document.createElement('div');
        metrics.className = 'health-cockpit-metrics';
        metrics.innerHTML = '<span><strong id="health-cockpit-metric-repairs">—</strong><small id="health-cockpit-metric-repairs-label">Repairs needed</small></span><span><strong id="health-cockpit-metric-tracks">—</strong><small>Tracks checked</small></span><span><strong id="health-cockpit-metric-review">—</strong><small>Need review</small></span><span><small>Last checked</small><strong id="health-cockpit-metric-time">Checking</strong></span>';
        header.appendChild(metrics);
        const pledge = document.createElement('div'); pledge.className = 'health-cockpit-safety-strip'; pledge.innerHTML = '<span>Source audio unchanged</span><span>Review before repair</span><span>Separate publish confirmation</span>'; header.appendChild(pledge);
        const batch = move('#health-batch-panel', overview);
        if (batch) {
            batch.classList.add('health-cockpit-bay');
            batch.querySelector('.health-batch-kicker').textContent = 'After Health Scan';
            batch.querySelector('h3').textContent = 'Publish to DJ software';
            batch.querySelector('.health-batch-intro').textContent = 'Use this after Health has scanned and saved values. It publishes verified missing BPM, key and year tags; it is not the Health scan.';
            const brands = document.createElement('div');
            brands.className = 'health-cockpit-brands';
            brands.innerHTML = '<img src="/static/brands/serato-dj-pro.svg" alt="Serato DJ Pro"><span><img src="/static/brands/djay-wordmark.png" alt="djay"><b>Pro</b></span>';
            batch.querySelector('.health-batch-heading').appendChild(brands);
            move('#health-batch-panel', byId('health-cockpit-session-publish'));
            ['#health-batch-history', '#health-batch-rollback'].forEach(selector => move(selector, byId('health-cockpit-session-publish')));
            body('refresh').innerHTML = '<p>Preview verified BPM, key and year values before publishing.</p><button type="button" onclick="AxiomHealthCockpit.sessionTab(\'publish\')">Open publish panel</button>';
        }
        move('#health-readiness-plan', byId('health-cockpit-plan'));
        // Keep the existing tools container as the common ancestor for its selectors.
        const tools = byId('health-approved-tools');
        byId('health-cockpit-tools-column').appendChild(tools);
        tools.appendChild(byId('health-cockpit-sections'));
        ['organisation', 'metadata', 'era', 'transfer'].forEach(key => move(`[data-health-workspace="${key}"]`, body(key)));
        move('#health-dj-transfer-detail', body('transfer'));
        move('#health-recordings', body('detox'));
        const detox = move('#health-set-review', body('detox'));
        body('detox').prepend(detox);
        const detoxOverview = document.createElement('div');
        detoxOverview.className = 'health-cockpit-detox-overview';
        detoxOverview.innerHTML = '<div class="health-cockpit-detox-intro"><strong>Keep your library focused.</strong><p>Filter FX, drum samples, drops, long mixes and tempo transition edits out of your song picks. Your audio files stay safe.</p><button type="button" onclick="healthSetOpenRestoreBin()">Restore Bin</button></div><div id="health-cockpit-detox-categories"><span>Identified candidates</span></div><div class="health-cockpit-detox-actions"><button id="health-cockpit-detox-review" type="button" class="primary" onclick="AxiomHealthCockpit.reviewDetox()">Review candidates</button><p>Keep remixes, acapella intros and outros in your library.</p></div>';
        body('detox').prepend(detoxOverview);
        move('.health-approved-set-tabs', byId('health-cockpit-detox-categories'));
        const back = document.createElement('button');
        back.className = 'health-cockpit-detox-back'; back.type = 'button'; back.textContent = 'Back to categories';
        back.onclick = () => { body('detox').dataset.reviewing = 'false'; };
        detox.prepend(back);
        // The outer accordion owns disclosure; keep the original review controls mounted.
        byId('health-approved-set-detail').classList.remove('hidden');
        move('#health-inbox-item-missing_file', body('files'));
        const lanes = move('#health-repair-center', body('bpm'));
        body('bpm').classList.add('health-approved-lanes');
        body('era').classList.add('health-approved-lanes');
        move('#health-inbox-item-missing_year', body('era'));
        ['#health-release-year-research-panel', '#health-release-year-csv-panel', '#year-publish-panel'].forEach(selector => move(selector, body('era')));
        move('[aria-label="Full audio verification"]', body('audio'));
        move('#health-source-connections', body('connections'));
        move('.health-generated-cache-connection', body('cache'));
        window.AxiomHealthDoctor?.mount(body('doctor'));
        move('#health-new-music-intake', body('inbox'));
        move('.health-approved-results', byId('health-cockpit-session-receipt'));
        move('.health-approved-console', byId('health-cockpit-live-console'));
        move('#health-inbox-detail', body('files'));
        move('.health-inbox-activity', byId('health-cockpit'));
        shell.classList.add('health-cockpit-mounted');
        let index = 0;
        groups.forEach(([key, label, sections]) => {
            const group = document.createElement('section'); group.className = 'health-cockpit-tool-group';
            const heading = document.createElement('h3'); heading.textContent = label;
            group.appendChild(heading); byId('health-cockpit-sections').appendChild(group);
            sections.forEach(name => {
                const section = byId(`health-section-${name}`); if (!section) return;
                section.dataset.healthGroup = key;
                section.querySelector('.health-cockpit-number').textContent = String(++index).padStart(2, '0');
                group.appendChild(section);
            });
        });
        // Preserve Stop Safely in the live face when the overview is hidden.
        move('#health-readiness-stop', byId('health-cockpit-live').querySelector('header'));
        move('#health-readiness-rerun', byId('health-cockpit-session-receipt'));
        move('#health-readiness-last-receipt', byId('health-cockpit-session-receipt'));
        mounted = true;
        document.querySelectorAll('[data-health-section]').forEach(section => {
            section.addEventListener('toggle', () => {
                if (!section.open) return;
                const key = section.dataset.healthSection;
                if (key === 'detox') {
                    byId('health-approved-set-detail').classList.remove('hidden');
                    const selected = typeof activeHealthInboxItem !== 'undefined' && ['stingers', 'transitions', 'sound_effects', 'mixtapes'].includes(activeHealthInboxItem) ? activeHealthInboxItem : 'stingers';
                    renderHealthApprovedSetCategory(selected);
                }
                if (key === 'files') selectHealthInboxItem('missing_file');
                if (key === 'doctor') openDoctor();
            });
        });
        // Watch displayed counters only; never start work or replace backend progress.
        let queued = false;
        const observer = new MutationObserver(() => {
            if (queued) return;
            queued = true;
            queueMicrotask(() => { queued = false; observer.disconnect(); sync(); observe(); });
        });
        const observe = () => observer.observe(shell, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-health-job-state', 'data-health-has-snapshot']});
        sync(); observe();
        if (new URLSearchParams(location.search).get('health_set') === 'expanded') open('detox');
    }
    function reviewDetox() {
        body('detox').dataset.reviewing = 'true';
        const categories = ['stingers', 'transitions', 'sound_effects', 'mixtapes'];
        const selected = categories.sort((a, b) => number(`health-cleanup-${b.replace('_', '-')}`) - number(`health-cleanup-${a.replace('_', '-')}`))[0];
        selectHealthInboxItem(selected);
    }
    function toggleScanDetails(button) {
        const expanded = button.getAttribute('aria-expanded') !== 'true';
        button.setAttribute('aria-expanded', String(expanded));
        button.textContent = expanded ? 'Hide details' : 'Scan details';
        byId('health-cockpit-live').dataset.expanded = String(expanded);
    }
    window.AxiomHealthCockpit = {open, selectItem, sync, reviewDetox, toggleScanDetails, scanHealth, syncBatchPublishGate, filterTools, expandTools, sessionTab, showProgress, openDoctor, updateBackgroundJob};
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once: true});
    else mount();
})();
