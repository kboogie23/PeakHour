// Shared startup, theme, licensing, and connection-dialog foundations.
function tuckGraph() {
    const graph = document.getElementById('graph-container');
    if (graph) {
        graph.classList.toggle('graph-tucked');
        if (graph.classList.contains('graph-tucked')) {
            console.log("Graph Tucked - Focus Mode Active");
        } else {
            console.log("Graph Visible");
        }
    }
}


const mainDeck = document.getElementById('main-player');
const studioPreview = document.getElementById('modal-player');
let axiomWindowHeartbeatTimer = null;
let axiomWindowCloseSent = false;

const axiomEditionMeta = document.querySelector('meta[name="axiom-edition"]');
if (axiomEditionMeta?.content !== 'lite') {
    document.title = 'PEAK HOUR';
}

function axiomBeaconJson(url, payload = {}) {
    if (window.AXIOM_WEB_PREVIEW) return true;
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
        try {
            const blob = new Blob([body], { type: 'application/json' });
            if (navigator.sendBeacon(url, blob)) return true;
        } catch (err) {
            console.warn('[AXIOM] beacon failed:', err);
        }
    }
    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true
    }).catch(() => {});
    return false;
}

function stopAxiomPlaybackForWindowClose() {
    if (axiomWindowCloseSent) return;
    axiomWindowCloseSent = true;
    if (axiomWindowHeartbeatTimer) {
        clearInterval(axiomWindowHeartbeatTimer);
        axiomWindowHeartbeatTimer = null;
    }
    document.querySelectorAll('audio').forEach(el => {
        try {
            el.pause();
            el.removeAttribute('src');
            el.load?.();
        } catch (err) {}
    });
    if (nativePlayerPoll) {
        clearInterval(nativePlayerPoll);
        nativePlayerPoll = null;
    }
    nativePlayerState = { ...nativePlayerState, playing: false };
    document.body.classList.remove('has-playing');
    axiomBeaconJson('/api/audio/stop', { reason: 'window_close' });
    axiomBeaconJson('/api/app/window_closed', { reason: 'window_close' });
}

function startAxiomWindowHeartbeat() {
    if (isRawFilePreview() || axiomWindowHeartbeatTimer) return;
    axiomBeaconJson('/api/app/window_heartbeat', { state: 'open' });
    axiomWindowHeartbeatTimer = setInterval(() => {
        axiomBeaconJson('/api/app/window_heartbeat', { state: 'open' });
    }, 1500);
}

window.addEventListener('pagehide', stopAxiomPlaybackForWindowClose);
window.addEventListener('beforeunload', stopAxiomPlaybackForWindowClose);

if (studioPreview) {
    studioPreview.onplay = () => {
        document.querySelectorAll('audio').forEach(el => {
            if (el !== studioPreview) {
                el.pause();
                el.volume = 1.0;
            }
        });
        studioPreview.volume = 1.0;
        console.log("STUDIO PLAYBACK: All other audio killed");
        const currentSrc = studioPreview.src;
        previewedTracks.add(currentSrc);
    };
}

function refreshLibrary() {
    resetLibraryResultWindow();
    runSearch();
    console.log(`Filtered Library Refreshed: ${activeEra}`);
}

let axiomUiPreviewFixtureWait = null;

async function maybeStartAxiomUiPreview() {
    if (typeof runAxiomHealthCleanupReviewFixture === 'function'
        && await runAxiomHealthCleanupReviewFixture()) return true;
    if (typeof window.runAxiomUiPreviewFixture === 'function') {
        return window.runAxiomUiPreviewFixture();
    }
    if (!axiomReviewMode() && !axiomUiPreviewMode()) return false;
    if (!axiomUiPreviewFixtureWait) {
        axiomUiPreviewFixtureWait = new Promise(resolve => {
            const startedAt = Date.now();
            const waitForFixture = () => {
                if (typeof window.runAxiomUiPreviewFixture === 'function') {
                    resolve(window.runAxiomUiPreviewFixture());
                    return;
                }
                if (Date.now() - startedAt > 5000) {
                    console.warn('[AXIOM] Review fixture script did not load in time.');
                    resolve(false);
                    return;
                }
                setTimeout(waitForFixture, 25);
            };
            waitForFixture();
        });
    }
    return axiomUiPreviewFixtureWait;
}

document.addEventListener('DOMContentLoaded', () => {
    applyAxiomSurfaceMode();
    initStudioSignalAnimation();
    loadTheme();
    loadSmartLinksFontScale();
    loadAxiomVersion();
    setTimeout(maybeStartAxiomUiPreview, 800);
    if (isRawFilePreview()) {
        showRawFileLaunchWarning();
        return;
    }
    startAxiomWindowHeartbeat();
    applyAxiomAccessUi(window.AXIOM_ACCESS_CONTEXT?.mode === 'guest'
        ? { required: true, usable: true, status: 'guest_preview' }
        : (axiomLicenseState || {}));
    installAxiomDawAccessGuard();
    checkAxiomLicense(false);
    if (!isAxiomLite()) {
        reportAxiomLaunch(false);
        setTimeout(() => validateAxiomLicenseOnline(false), 2500);
        setInterval(() => validateAxiomLicenseOnline(false), 3 * 60 * 60 * 1000);
    }
    checkForAxiomUpdate(false);
});

function toggleTheme() {
    const nextMode = document.body.classList.contains('light-mode') ? 'dark' : 'light';
    applyAxiomTheme(nextMode);
    if (typeof recalculateAudit === 'function') recalculateAudit();
    if (typeof showToast === 'function') showToast(nextMode === 'light' ? 'Day mode on.' : 'Night mode on.');
}

function updateThemeIcons() {
    updateThemeToggleLabel();
}

let axiomUpdateState = null;
let axiomLicenseState = null;
let axiomReleaseSplashState = null;
let axiomExportUpgradeTarget = 'serato';
let axiomExportUpgradePlan = 'monthly';
let axiomExportUpgradeTrigger = null;

const AXIOM_FIRST_LAUNCH_FEATURE_DETAILS = [
    { title: 'Real-Time Assistance', description: 'AXIOM intelligence now works with you live in the booth.' },
    { title: 'Build The Full Set', description: 'Shape complete sets around BPM, energy and flow.' },
    { title: 'Smarter Magic Sets', description: 'Go beyond obvious bangers and predictable floor fillers.' },
    { title: 'Rediscover Your Music', description: 'Bring forgotten tracks from your own library back into play.' },
    { title: 'Drag Straight To Deck', description: 'Connect Serato DJ Pro or djay Pro and move tracks instantly.' },
    { title: 'Library Tools', description: 'Music Health, exports, playlists, no-cue crates and more.' },
];

// First public PRO 1.0 release: fa0d250a968067fd74bcb0e497a44f00d7be44b9.
// Keep this product tour separate from the current build’s engineering notes.
const AXIOM_PRO_1_0_RELEASE_FEATURE_DETAILS = [
    {
        "title": "Studio DAW",
        "brief": "Build mixtapes and edits with cleaner grid control.",
        "description": "Arrange tracks, trim and layer clips, save projects, and export finished audio. Clip body drags stay focused on moving the clip instead of accidentally opening the select-bars range tool, empty-lane drags still create snapped bar ranges, zoomed duplicate and drag moves can land small clips on finer visible grid lines, wider zoom levels keep larger moves on coarser musical lines, and zoomed-out clip starts render on the same grid math as the bar lines."
    },
    {
        "title": "Mixtape BPM Automation",
        "brief": "Shape flexible tempo maps for mixtape-style projects.",
        "description": "Mixtape mode now has a dedicated project BPM lane with compact and expanded views, drag or typed BPM marker editing, Command-Z undo and redo, and zoom-aware markers that stay aligned with the visible timeline."
    },
    {
        "title": "Playback Response",
        "brief": "Press Play with less startup waiting.",
        "description": "Normal playback now queues AXIOM Snap preparation in the background instead of making Play wait for that timing pass. Offline renders and exports still wait for final prepared timing."
    },
    {
        "title": "Stem Playback",
        "brief": "Stemmed clips wait calmly instead of falling back.",
        "description": "If separated stems are still being prepared, AXIOM keeps the stem mix, waits with a positive cyan/purple status, and avoids playing the original full clip as a fallback."
    },
    {
        "title": "Performance Mode + Live Assist",
        "brief": "Find the next track from your library while you play.",
        "description": "Live Assist follows Serato DJ Pro or djay Pro, uses selected playlists and crates, responds to tempo and track feedback, and keeps played tracks out of recommendations for the rest of the session."
    },
    {
        "title": "Live Recording",
        "brief": "Capture your set from a ready DJ audio source.",
        "description": "Start recording from a saved ready source, watch the level and timer, and retry visible permission or capture failures without restarting AXIOM."
    },
    {
        "title": "Music Library + Search",
        "brief": "Search by genre, era, BPM, and key together.",
        "description": "Find tracks across connected folders and DJ libraries, sort by BPM, key, and year, and move between Library, Track Prep, and the DAW without losing your place."
    },
    {
        "title": "Music Health",
        "brief": "Scan first, then publish verified tags when ready.",
        "description": "Health now puts the main Fix Health scan action in the masthead, keeps the motto beside it, and labels DJ software publishing as an after-scan step. Publish Verified Tags stays greyed out and blocked until Health has saved scan results, so users do not mistake Serato or djay publishing for the first health scan. Generated preview, internal export backup, legacy AXIOM backup, and rebuildable stem cache cleanup still preserves BPM, key, year, saved sets, source audio, Serato data, and djay data."
    },
    {
        "title": "Magic Set + Paste a Playlist",
        "brief": "Shape sets from your music or a pasted playlist.",
        "description": "Build a working set with AXIOM's matching tools, or paste a playlist and link its songs to your local library before saving or exporting."
    },
    {
        "title": "Samples, FX + Stems",
        "brief": "Bring samples and creative edits into the DAW.",
        "description": "Preview and reuse DAW samples, apply clip tools including reverse and reverb tails, and work with local stem separation without changing original audio files. Rebuildable generated assets stay AXIOM-owned so they can be cleaned without touching your music."
    },
    {
        "title": "DJ Software Handoffs",
        "brief": "Prepare sets for Serato and supported DJ workflows.",
        "description": "Export ordered playlists and Serato-safe crates from AXIOM. DJ software databases and source music remain read-only during ordinary preparation."
    },
    {
        "title": "Engine Ownership Access",
        "brief": "Bought engines keep working after a subscription ends.",
        "description": "The Mac app now recognizes separate engine ownership. A Studio DAW owner can continue opening, editing, saving, and exporting DAW projects without an active subscription, while unrelated engines stay locked."
    }
];

const AXIOM_LITE_FIRST_LAUNCH_FEATURE_DETAILS = [
    { title: 'Free Lite', description: 'Prepare music without a subscription or activation key.' },
    { title: 'Your Music Library', description: 'Browse and organise music from folders you choose.' },
    { title: 'Library Health', description: 'Review missing BPM, key and year information.' },
    { title: 'Magic Sets', description: 'Build a set around your music and the direction you choose.' },
    { title: 'Refine In Studio', description: 'Preview tracks and shape the order of your set.' },
    { title: 'Save And Export', description: 'Keep prepared sets and choose an export for your DJ workflow.' },
];

let studioSignalAnimationFrame = 0;

function initStudioSignalAnimation() {
    const canvas = document.getElementById('studio-signal-canvas');
    if (!canvas || canvas.dataset.ready === '1') return;
    canvas.dataset.ready = '1';
    const context = canvas.getContext('2d');
    if (!context) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const barSeeds = Array.from({ length: 88 }, (_, index) => ({
        phase: (index * 1.91) % 6.28,
        weight: 0.42 + ((index * 37) % 51) / 100,
    }));
    const particles = Array.from({ length: 22 }, (_, index) => ({
        x: 0.12 + ((index * 47) % 79) / 100,
        y: 0.14 + ((index * 31) % 48) / 100,
        size: 0.8 + (index % 3) * 0.55,
        phase: index * 0.73,
    }));
    let visible = false;

    const fitCanvas = () => {
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return false;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.max(1, Math.round(rect.width * ratio));
        const height = Math.max(1, Math.round(rect.height * ratio));
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        return true;
    };

    const draw = timestamp => {
        studioSignalAnimationFrame = 0;
        if (!fitCanvas()) return;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        const motionTime = reducedMotion.matches ? 1800 : timestamp;
        const cycle = (motionTime % 8000) / 8000;
        const centerX = width * 0.67;
        const centerY = height * 0.67;
        context.clearRect(0, 0, width, height);

        const glow = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.max(width, height) * 0.64);
        glow.addColorStop(0, 'rgba(163,255,0,0.16)');
        glow.addColorStop(0.45, 'rgba(96,180,0,0.07)');
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        context.fillStyle = glow;
        context.fillRect(0, 0, width, height);

        [0.18, 0.29, 0.41, 0.54, 0.69].forEach((scale, index) => {
            context.beginPath();
            context.arc(centerX, centerY, Math.min(width, height) * scale, 0, Math.PI * 2);
            context.strokeStyle = `rgba(163,255,0,${0.08 + index * 0.024})`;
            context.lineWidth = index === 2 ? 1.4 : 0.8;
            context.stroke();
        });

        particles.forEach(particle => {
            const pulse = 0.35 + (Math.sin((motionTime / 720) + particle.phase) + 1) * 0.28;
            context.beginPath();
            context.arc(width * particle.x, height * particle.y, particle.size, 0, Math.PI * 2);
            context.fillStyle = `rgba(${particle.phase % 2 > 1 ? '53,232,255' : '163,255,0'},${pulse})`;
            context.fill();
        });

        const horizon = height * 0.79;
        const barWidth = width / barSeeds.length;
        barSeeds.forEach((seed, index) => {
            const x = index * barWidth;
            const shape = Math.sin(index * 0.22 + motionTime / 720) * 0.36
                + Math.sin(index * 0.08 - motionTime / 1180) * 0.28
                + Math.sin(index * 0.47 + seed.phase) * 0.18;
            const lift = 20 + Math.abs(shape) * height * 0.24 + seed.weight * height * 0.09;
            const leftFade = Math.min(1, Math.max(0, (index / barSeeds.length - 0.02) / 0.18));
            context.fillStyle = `rgba(163,255,0,${0.28 + leftFade * 0.58})`;
            context.fillRect(x, horizon - lift, Math.max(1, barWidth * 0.28), lift);
        });

        const scanX = width * (0.08 + cycle * 0.86);
        const scanGlow = context.createLinearGradient(scanX - 22, 0, scanX + 22, 0);
        scanGlow.addColorStop(0, 'rgba(163,255,0,0)');
        scanGlow.addColorStop(0.5, 'rgba(190,255,75,0.72)');
        scanGlow.addColorStop(1, 'rgba(53,232,255,0)');
        context.fillStyle = scanGlow;
        context.fillRect(scanX - 22, height * 0.15, 44, height * 0.69);
        context.fillStyle = 'rgba(163,255,0,0.82)';
        context.fillRect(scanX, height * 0.15, 1, height * 0.69);

        context.strokeStyle = 'rgba(163,255,0,0.28)';
        context.beginPath();
        context.moveTo(0, horizon + 1);
        context.lineTo(width, horizon + 1);
        context.stroke();

        if (visible && !reducedMotion.matches) {
            studioSignalAnimationFrame = requestAnimationFrame(draw);
        }
    };

    const start = () => {
        if (studioSignalAnimationFrame) return;
        studioSignalAnimationFrame = requestAnimationFrame(draw);
    };
    const stop = () => {
        if (studioSignalAnimationFrame) cancelAnimationFrame(studioSignalAnimationFrame);
        studioSignalAnimationFrame = 0;
    };
    const observer = new IntersectionObserver(entries => {
        visible = Boolean(entries[0]?.isIntersecting);
        if (visible) start(); else stop();
    }, { threshold: 0.04 });
    observer.observe(canvas);
    new ResizeObserver(() => { if (visible) start(); }).observe(canvas);
    reducedMotion.addEventListener?.('change', () => { stop(); start(); });
}

function isRawFilePreview() {
    return window.location.protocol === 'file:';
}

function isAxiomWebPreview() {
    return Boolean(window.AXIOM_WEB_PREVIEW);
}

function isAxiomNativeShell() {
    return Boolean(window.webkit?.messageHandlers?.axiomNative?.postMessage);
}

function axiomExportUpgradeTargetConfig(target = 'serato') {
    const normalized = String(target || '').toLowerCase() === 'djay' ? 'djay' : 'serato';
    return normalized === 'djay'
        ? { id: 'djay', label: 'djay Pro', source: 'djay_pro' }
        : { id: 'serato', label: 'Serato', source: 'serato' };
}

function axiomExportUpgradeStoredEmail() {
    try {
        const stored = JSON.parse(localStorage.getItem('axiomWebLicense.v1') || '{}');
        return String(stored.email || stored.account_email || stored.accountEmail || '').trim().toLowerCase();
    } catch (_) {
        return '';
    }
}

function setAxiomExportUpgradeStatus(message = '', isError = false) {
    const status = document.getElementById('export-upgrade-status');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', isError);
}

function setAxiomExportUpgradeBusy(busy, label = '') {
    const checkout = document.getElementById('export-upgrade-checkout');
    const lead = document.getElementById('export-upgrade-lead');
    const plans = document.querySelectorAll('.export-upgrade-plan');
    [checkout, lead, ...plans].filter(Boolean).forEach(button => { button.disabled = Boolean(busy); });
    if (checkout) {
        checkout.textContent = busy ? (label || 'Opening Secure Checkout...') : (hasPaidAxiomEntitlement() ? 'Download AXIOM For Mac' : 'Subscribe And Continue');
    }
}

function selectAxiomExportUpgradePlan(plan = 'monthly') {
    axiomExportUpgradePlan = plan === 'yearly' ? 'yearly' : 'monthly';
    ['monthly', 'yearly'].forEach(id => {
        const button = document.getElementById(`export-upgrade-plan-${id}`);
        const selected = id === axiomExportUpgradePlan;
        button?.classList.toggle('selected', selected);
        button?.setAttribute('aria-checked', selected ? 'true' : 'false');
    });
}

function openAxiomExportUpgradeSplash(target = 'serato') {
    if (isAxiomLite()) {
        if (typeof openLiteProInfo === 'function') openLiteProInfo();
        return false;
    }
    if (!isAxiomWebPreview()) return false;
    const config = axiomExportUpgradeTargetConfig(target);
    const overlay = document.getElementById('export-upgrade-overlay');
    if (!overlay) return false;
    axiomExportUpgradeTarget = config.id;
    axiomExportUpgradeTrigger = document.activeElement;
    document.getElementById('export-upgrade-title').textContent = `Export To ${config.label} In The AXIOM App`;
    document.getElementById('export-upgrade-copy').textContent = `This ${config.label} handoff is available in the installed AXIOM app. Your prepared set remains saved here.`;
    document.getElementById('export-upgrade-visual-title').textContent = `Export To ${config.label}`;
    document.getElementById('export-upgrade-benefit-target').textContent = `Hand the playlist into ${config.label}`;
    document.getElementById('export-upgrade-plan-group').hidden = true;
    const checkout = document.getElementById('export-upgrade-checkout');
    const lead = document.getElementById('export-upgrade-lead');
    checkout.textContent = 'Got It';
    lead.hidden = true;
    const email = document.getElementById('export-upgrade-email');
    if (email) email.value = '';
    setAxiomExportUpgradeStatus('');
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('axiom-export-upgrade-open');
    if (typeof window.AXIOM_REPORT_USAGE_EVENT === 'function') {
        window.AXIOM_REPORT_USAGE_EVENT('export_attempted', { source: `axiom_export_upgrade_${config.source}` });
    }
    setTimeout(() => checkout?.focus(), 50);
    return false;
}

function closeAxiomExportUpgradeSplash() {
    const overlay = document.getElementById('export-upgrade-overlay');
    overlay?.classList.remove('active');
    overlay?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('axiom-export-upgrade-open');
    if (axiomExportUpgradeTrigger && typeof axiomExportUpgradeTrigger.focus === 'function') {
        axiomExportUpgradeTrigger.focus();
    }
    axiomExportUpgradeTrigger = null;
}

function validAxiomExportUpgradeEmail() {
    const input = document.getElementById('export-upgrade-email');
    const email = String(input?.value || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setAxiomExportUpgradeStatus('Enter a valid email so AXIOM can connect the export access.', true);
        input?.focus();
        return '';
    }
    return email;
}

async function storeAxiomExportUpgradeLead(email, intent = 'notify') {
    const config = axiomExportUpgradeTargetConfig(axiomExportUpgradeTarget);
    const response = await fetch('/api/track-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email,
            source: `axiom_export_upgrade_${config.source}_${intent}_${axiomExportUpgradePlan}`
        })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || 'Could not save export interest.');
    return data;
}

async function captureAxiomExportUpgradeInterest() {
    const email = validAxiomExportUpgradeEmail();
    if (!email) return;
    setAxiomExportUpgradeBusy(true, 'Saving Your Place...');
    setAxiomExportUpgradeStatus('Saving your export request...');
    try {
        await storeAxiomExportUpgradeLead(email, hasPaidAxiomEntitlement() ? 'paid_access' : 'notify');
        setAxiomExportUpgradeStatus(`You are on the Mac export list. Watch ${email}.`);
    } catch (err) {
        setAxiomExportUpgradeStatus(err?.message || 'Could not save export interest.', true);
    } finally {
        setAxiomExportUpgradeBusy(false);
    }
}

async function startAxiomExportUpgradeCheckout() {
    if (hasPaidAxiomEntitlement()) {
        setAxiomExportUpgradeStatus('Opening your AXIOM download...');
        window.location.assign('/api/axiom/download');
        return;
    }
    const email = validAxiomExportUpgradeEmail();
    if (!email) return;
    const config = axiomExportUpgradeTargetConfig(axiomExportUpgradeTarget);
    setAxiomExportUpgradeBusy(true);
    setAxiomExportUpgradeStatus('Opening secure AXIOM checkout...');
    try {
        await storeAxiomExportUpgradeLead(email, 'checkout').catch(() => null);
        const response = await fetch('/api/axiom/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                planId: axiomExportUpgradePlan,
                email,
                source: `axiom_export_upgrade_${config.source}`
            })
        });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401 && data.loginUrl) {
            window.location.assign(data.loginUrl);
            return;
        }
        if (!response.ok || !data.url) throw new Error(data.error || 'AXIOM checkout could not start.');
        window.location.assign(data.url);
    } catch (err) {
        setAxiomExportUpgradeStatus(err?.message || 'AXIOM checkout could not start.', true);
        setAxiomExportUpgradeBusy(false);
    }
}

function requireAxiomInstalledApp(featureName = 'this feature') {
    if (!isAxiomWebPreview()) return true;
    showToast(`${featureName} is available in the installed AXIOM app for subscribers.`, true);
    return false;
}

function applyAxiomSurfaceMode() {
    const webMode = isAxiomWebPreview();
    const nativeShell = Boolean(window.webkit?.messageHandlers?.axiomNative?.postMessage);
    document.body.classList.toggle('axiom-web-workbench', webMode);
    document.body.classList.toggle('axiom-installed-app', !webMode);
    document.body.classList.toggle('axiom-native-shell', nativeShell);
    document.querySelectorAll('[data-native-only]').forEach(el => {
        el.classList.toggle('hidden', webMode);
        el.setAttribute('aria-hidden', webMode ? 'true' : 'false');
    });
    document.getElementById('btn-export-favorites-serato')?.classList.toggle('hidden', webMode);
}

function axiomUiPreviewMode() {
    if (document.querySelector('meta[name="axiom-packaged"]')?.content === '1') return '';
    const localPreviewHost = ['127.0.0.1', 'localhost'].includes(window.location.hostname);
    return localPreviewHost ? new URLSearchParams(window.location.search).get('ui_preview') || '' : '';
}

function axiomReviewMode() {
    if (document.querySelector('meta[name="axiom-packaged"]')?.content === '1') return '';
    const localPreviewHost = ['127.0.0.1', 'localhost'].includes(window.location.hostname);
    return localPreviewHost ? new URLSearchParams(window.location.search).get('review') || '' : '';
}



function hasAxiomPriorLaunch() {
    if (localStorage.getItem('axiomReleaseSplashHasLaunched') === '1') return true;
    for (let index = 0; index < localStorage.length; index += 1) {
        if (String(localStorage.key(index) || '').startsWith('axiomReleaseSplashSeen:')) return true;
    }
    return false;
}

function axiomReleaseSplashMode(data, fixture, forcedPreview) {
    if (fixture?.splash_mode) return fixture.splash_mode;
    if (data.product_edition !== 'lite' && data.release?.splash_presentation !== 'sonic-2026') return 'update';
    return forcedPreview || hasAxiomPriorLaunch() ? 'update' : 'first';
}

function normalizeAxiomReleaseFeatures(features = []) {
    return (Array.isArray(features) ? features : []).map(feature => {
        if (typeof feature === 'string') return { title: feature, description: '' };
        return {
            title: String(feature?.title || '').trim(),
            brief: String(feature?.brief || '').trim(),
            description: String(feature?.description || '').trim(),
        };
    }).filter(feature => feature.title).slice(0, 24);
}

function axiomReleasePreviewFixture(mode = '') {
    if (mode === 'release-modern') {
        return {
            version: '1.0.4', build: 'design-preview', product_edition: 'pro', packaged: false,
            splash_mode: 'update', release: {
                title: 'AXIOM PRO 1.0.4 BETA', headline: 'Ready for your next set.', splash_presentation: 'sonic-2026',
                summary: 'A cleaner library. Faster results. More time for what you play.',
                features: [
                    { title: 'Library Health', brief: 'Check BPM, key, years and beatgrids across your library.', description: 'Fix missing BPM, key and years, and clean up titles in batches. Beatgrid Doctor checks tempo, alignment and bar 1 across your collections. Results that need review stay clearly marked. Existing cues are preserved, and publishing corrections uses a separate review and backup workflow.' },
                    { title: 'Performance Mode', brief: 'Live recommendations that follow your mix.', description: "Live Assist follows what's playing in Serato DJ Pro or djay Pro and recommends next tracks by BPM, key and energy. Prioritize your chosen crates and playlists, steer suggestions by genre and era, and keep played tracks out of the session's recommendations. Save requests in Maybe Next and drag local songs straight to a deck." },
                    { title: 'Export your sets to your DJ software', brief: 'Your set, in your chosen order.', description: 'Name your set and export your chosen track order as a Serato crate or djay Pro playlist. M3U8 and CSV exports give you additional handoff options. Direct exports guide you through closing your DJ app before delivery, while your original music stays unchanged.' },
                    { title: 'Paste a Playlist', brief: 'Find the songs you already own.', description: "Paste a playlist or song list and match it against your local library. Review possible matches, see what's missing, and save missing songs to Download Later. Turn matched tracks into a working set you can refine, save and export." },
                    { title: 'Studio DAW', brief: 'Create mixtapes, edits and mashups.', description: 'Arrange, trim and layer tracks on a musical timeline. Shape the tempo, balance your mix, and add samples and effects. Save your project to keep working later, then export finished audio as WAV or MP3. Your original music files stay unchanged.' },
                    { title: 'Build Better Sets', brief: 'Shape the flow. Keep your own taste.', description: "Find matching songs by BPM and key, and search your library by genre and era. Use Magic Set for a first draft or build around tracks you've already chosen. Preview songs, refine the order in Studio, and shape the energy before you play." },
                ],
            },
        };
    }
    if (mode === 'release-lite-first') {
        return { version: '1.0.0', build: 'lite-first-preview', product_edition: 'lite', splash_mode: 'first' };
    }
    const fixtureCounts = { release3: 3, release15: 15 };
    const count = fixtureCounts[mode];
    if (!count) return null;
    const featureTitles = [
        'Faster Health Updates',
        'More Accurate Year Data',
        'Faster BPM And Key Detection',
        'Clearer AXIOM Screens',
        'Better Set Building',
        'Simpler Workflow',
        'Stability Improvements',
        'Quicker Library Search',
        'Cleaner Set Exports',
        'Stronger Matching Songs',
        'Readable Live Recommendations',
        'Improved Playlist Control',
        'Safer Provider Handoffs',
        'Clearer Update Messages',
        'More Reliable Large Libraries',
    ];
    return {
        version: '1.0.2',
        build: `screen-gate-${count}`,
        packaged: true,
        splash_mode: 'update',
        release_notes_url: 'https://www.djowe.com/axiom',
        release: {
            title: 'Faster, Clearer AXIOM',
            summary: mode === 'release15'
                ? 'This stress preview deliberately uses a longer update summary and longer release notes to prove the splash remains readable and usable when a future build contains substantially more information.'
                : 'A focused update for a faster, clearer, and more reliable DJ workflow.',
            features: featureTitles.slice(0, count).map((title, index) => ({
                title,
                description: mode === 'release15'
                    ? `Release item ${index + 1} contains deliberately extended customer-facing detail. Every line must remain readable, separated from the next item, and available through the dedicated release-note scroll area without moving the Enter AXIOM action.`
                    : `Release item ${index + 1} remains fully readable at the supported AXIOM desktop size.`,
            })),
        },
    };
}

function openAxiomReleaseSplash(data = {}) {
    const splash = document.getElementById('release-splash');
    if (!splash) return;
    const version = String(data.version || '1.0.2').trim();
    const build = String(data.build || 'dev').trim();
    axiomReleaseSplashState = {
        ...data,
        seenKey: `axiomReleaseSplashSeen:${version}:${build}`
    };
    const liteLaunch = data.product_edition === 'lite';
    // The Pro welcome is a fixed Night Mode presentation. The underlying
    // cockpit keeps its selected theme, including after the welcome closes.
    splash.classList.toggle('release-splash-pro-night', !liteLaunch);
    const originalRelease = !liteLaunch && (data.release?.splash_presentation === 'original-1.0' || data.splash_mode === 'first');
    const updateLaunch = data.splash_mode === 'update' && !originalRelease;
    const sonicRelease = !liteLaunch && updateLaunch;
    splash.classList.toggle('release-sonic', sonicRelease);
    splash.classList.toggle('release-splash-pro-night', !liteLaunch && !sonicRelease);
    splash.querySelector('.release-splash-btn.primary')?.setAttribute?.('data-axiom-cta-skip', String(sonicRelease));
    const sonicVersion = document.getElementById('release-sonic-version');
    const sonicTitle = document.getElementById('release-sonic-title');
    const sonicSummary = document.getElementById('release-sonic-summary');
    const sonicBuild = document.getElementById('release-sonic-build-copy');
    const releaseLabel = String(data.release?.title || '');
    if (sonicVersion) sonicVersion.textContent = `${version}${/\bbeta\b/i.test(releaseLabel) && !/\bbeta\b/i.test(version) ? ' BETA' : ''}`;
    if (sonicTitle) sonicTitle.textContent = data.release?.headline || 'Ready for your next set.';
    if (sonicSummary) sonicSummary.textContent = data.release?.summary || 'A cleaner library. Faster results. More time for what you play.';
    if (sonicBuild) sonicBuild.textContent = `AXIOM PRO ${sonicVersion?.textContent || version} · Build ${build}`;
    const detailedRelease = updateLaunch || originalRelease;
    const showBusiness = detailedRelease;
    splash.classList.toggle('update-build', detailedRelease);
    const releaseFeatures = normalizeAxiomReleaseFeatures(data.release?.features);
    const businessItems = normalizeAxiomReleaseFeatures(data.release?.business).slice(0, 4);
    const features = originalRelease ? AXIOM_PRO_1_0_RELEASE_FEATURE_DETAILS
        : updateLaunch && releaseFeatures.length ? releaseFeatures
        : liteLaunch ? AXIOM_LITE_FIRST_LAUNCH_FEATURE_DETAILS : AXIOM_FIRST_LAUNCH_FEATURE_DETAILS;
    const headline = document.getElementById('release-splash-headline');
    const statement = splash.querySelector('.release-splash-statement');
    if (statement) {
        if (originalRelease) statement.textContent = `AXIOM PRO ${version}`;
        else if (updateLaunch) statement.textContent = String(data.release?.title || 'AXIOM PRO').trim();
        else statement.innerHTML = 'Faster.<br>Cleaner.<br>Ready.';
    }
    document.getElementById('release-splash-version').textContent = version;
    if (headline) {
        headline.textContent = updateLaunch
            ? sonicRelease ? 'What\u2019s new' : 'Software & Updates'
            : liteLaunch ? 'Welcome To AXIOM Lite' : 'Welcome To Axiom Pro';
    }
    const releaseTitle = document.getElementById('release-splash-title');
    if (releaseTitle) {
        releaseTitle.textContent = updateLaunch
            ? ''
            : liteLaunch ? 'Your music library. Your next DJ set.' : 'Your real-time music assistant for the booth.';
        releaseTitle.hidden = detailedRelease;
    }
    document.getElementById('release-splash-build').textContent = `Build ${build}`;
    // Restore the shared defaults too, so changing preview editions cannot
    // leave Lite copy in the Pro welcome or in a later update splash.
    const latest = splash.querySelector('.release-splash-latest');
    const identity = splash.querySelector('.release-splash-identity-copy');
    if (latest) latest.textContent = originalRelease ? `AXIOM PRO ${version}`
        : liteLaunch && !updateLaunch ? 'AXIOM Lite' : 'Latest Update';
    if (identity) identity.textContent = updateLaunch
        ? String(data.release?.summary || '').trim()
        : originalRelease ? 'Your real-time music assistant for the booth.'
        : liteLaunch ? 'Free music library organisation and DJ set preparation.'
        : 'A focused update for a faster, more accurate library.';
    let businessList = splash.querySelector('.release-splash-business');
    if (!businessList && identity) {
        businessList = document.createElement('div');
        businessList.className = 'release-splash-business';
        businessList.setAttribute('aria-label', 'AXIOM PRO access terms');
        identity.after(businessList);
    }
    if (businessList) {
        businessList.hidden = !showBusiness || !businessItems.length;
        businessList.replaceChildren(...(showBusiness ? businessItems.map(item => {
            const details = document.createElement('details');
            details.className = 'release-splash-business-item';
            const summary = document.createElement('summary');
            summary.textContent = item.title;
            const copy = document.createElement('div');
            if (item.brief) {
                const brief = document.createElement('strong');
                brief.textContent = item.brief;
                copy.append(brief);
            }
            if (item.description) {
                const description = document.createElement('p');
                description.textContent = item.description;
                copy.append(description);
            }
            let hovering = false;
            details.onmouseenter = () => { hovering = true; details.open = true; };
            details.onmouseleave = () => {
                hovering = false;
                if (!details.contains(document.activeElement)) details.open = false;
            };
            details.onfocusout = event => {
                if (!details.contains(event.relatedTarget)) details.open = false;
            };
            summary.onclick = event => { if (hovering) event.preventDefault(); };
            details.append(summary, copy);
            return details;
        }) : []));
    }
    const featureList = document.getElementById('release-splash-features');
    const studioTitles = new Set(['Mixtape BPM Automation', 'Playback Response', 'Stem Playback', 'Samples, FX + Stems']);
    const hasStudioGroup = detailedRelease && features.some(feature => feature.title === 'Studio DAW');
    const studioFeatures = hasStudioGroup ? features.filter(feature => studioTitles.has(feature.title)) : [];
    const visibleFeatures = studioFeatures.length
        ? [...features.filter(feature => feature.title !== 'Studio DAW' && !studioTitles.has(feature.title)),
            features.find(feature => feature.title === 'Studio DAW')]
        : features;
    featureList.replaceChildren(...visibleFeatures.map(feature => {
        const row = document.createElement('div');
        row.className = 'release-splash-feature';
        const copy = document.createElement('span');
        if (!detailedRelease) {
            const title = document.createElement('strong');
            title.textContent = feature.title;
            const description = document.createElement('span');
            description.textContent = feature.description;
            copy.append(title, description);
            row.append(copy);
            return row;
        }
        const details = document.createElement('details');
        details.className = 'release-splash-disclosure';
        const summary = document.createElement('summary');
        const title = document.createElement('strong');
        title.textContent = feature.title;
        summary.append(title);
        if (feature.brief) {
            const brief = document.createElement('span');
            brief.className = 'release-splash-brief';
            brief.textContent = feature.brief;
            summary.append(brief);
        }
        if (sonicRelease) {
            const more = document.createElement('span');
            more.className = 'release-sonic-more';
            more.textContent = 'Details';
            const icon = document.createElement('img');
            icon.src = '/static/icons/arrow-right.svg';
            icon.alt = '';
            more.append(icon);
            summary.append(more);
        }
        const description = document.createElement('p');
        description.className = 'release-splash-detail';
        description.textContent = feature.description;
        details.append(summary, description);
        // Native disclosure supports click, touch and keyboard; mouse hover
        // reveals the same content without changing the saved release copy.
        let hovering = false;
        row.onmouseenter = () => { if (!sonicRelease) { hovering = true; details.open = true; } };
        row.onmouseleave = () => {
            hovering = false;
            if (!sonicRelease && !row.contains(document.activeElement)) details.open = false;
        };
        row.onfocusout = event => {
            if (!sonicRelease && !row.contains(event.relatedTarget)) details.open = false;
        };
        summary.onclick = event => { if (hovering) event.preventDefault(); };
        copy.append(details);
        row.append(copy);
        if (feature.title === 'Studio DAW' && studioFeatures.length) {
            row.classList.add('release-splash-studio-group');
            const grouped = document.createElement('div');
            grouped.className = 'release-splash-studio-updates';
            studioFeatures.forEach(studioFeature => {
                const item = document.createElement('details');
                item.className = 'release-splash-studio-item';
                const itemSummary = document.createElement('summary');
                const itemTitle = document.createElement('strong');
                itemTitle.textContent = studioFeature.title;
                const itemBrief = document.createElement('span');
                itemBrief.textContent = studioFeature.brief;
                const itemDescription = document.createElement('p');
                itemDescription.textContent = studioFeature.description;
                itemSummary.append(itemTitle, itemBrief);
                item.append(itemSummary, itemDescription);
                grouped.append(item);
            });
            row.append(grouped);
        }
        return row;
    }));
    featureList.dataset.count = String(visibleFeatures.length);
    featureList.dataset.totalCount = String(features.length);
    splash.classList.toggle('release-splash-two-rows', sonicRelease && visibleFeatures.length > 3 && visibleFeatures.length <= 6);
    splash.classList.add('active');
    featureList.scrollTop = 0;
    requestAnimationFrame(() => {
        featureList.scrollTop = 0;
    });
    setTimeout(() => splash.querySelector('.release-splash-btn.primary')?.focus(), 60);
}

function handleAxiomReleaseScrollKey(event) {
    const list = event?.currentTarget;
    if (!list || event.target !== list) return;
    const page = Math.max(80, Math.round(list.clientHeight * 0.78));
    const keyMoves = {
        ArrowDown: 48,
        ArrowUp: -48,
        PageDown: page,
        PageUp: -page,
        ' ': page,
    };
    if (event.key === 'Home') {
        list.scrollTop = 0;
    } else if (event.key === 'End') {
        list.scrollTop = list.scrollHeight;
    } else if (Object.prototype.hasOwnProperty.call(keyMoves, event.key)) {
        list.scrollTop += keyMoves[event.key];
    } else {
        return;
    }
    event.preventDefault();
}

function maybeShowAxiomReleaseSplash(data = {}) {
    const previewMode = axiomUiPreviewMode();
    const fixture = axiomReleasePreviewFixture(previewMode);
    const entranceSplash = axiomReviewMode() === 'entrance' && (new URLSearchParams(location.search).get('entrance_flow') || '').includes('splash');
    const forcedPreview = previewMode === 'release' || Boolean(fixture) || entranceSplash;
    if (fixture) data = fixture;
    if (!forcedPreview && ['checking', 'required'].includes(document.documentElement.dataset.axiomLogin)) {
        window.__axiomPendingRelease = data;
        return;
    }
    if (!forcedPreview && (isRawFilePreview() || isAxiomWebPreview() || !data.packaged)) return;
    if (!document.querySelector('link[data-release-ownership-style]')) {
        const style = document.createElement('link');
        style.rel = 'stylesheet';
        const splashStyle = 'release-ownership-splash.css?v=20261006-night';
        style.href = typeof axiomRecordVaultStaticUrl === 'function'
            ? axiomRecordVaultStaticUrl(splashStyle) : `/static/${splashStyle}`;
        style.dataset.releaseOwnershipStyle = '1';
        document.head.append(style);
    }
    const seenKey = `axiomReleaseSplashSeen:${data.version || 'dev'}:${data.build || 'dev'}`;
    if (!forcedPreview && localStorage.getItem(seenKey) === '1') return;
    window.AxiomEntrance?.splashPending(true);
    const tryOpen = (attempt = 0) => {
        const modalBusy = document.getElementById('license-modal')?.classList.contains('active')
            || document.getElementById('update-modal')?.classList.contains('active')
            || document.body.classList.contains('license-locked');
        if (!forcedPreview && modalBusy && attempt < 20) {
            setTimeout(() => tryOpen(attempt + 1), 750);
            return;
        }
        if (!modalBusy || forcedPreview) {
            openAxiomReleaseSplash({
                ...data,
                splash_mode: axiomReleaseSplashMode(data, fixture, forcedPreview),
            });
        } else {
            window.AxiomEntrance?.splashPending(false);
        }
    };
    setTimeout(() => tryOpen(), forcedPreview ? 120 : 900);
}

function closeAxiomReleaseSplash(action = 'later') {
    const splash = document.getElementById('release-splash');
    splash?.classList.remove('active');
    if (axiomReleaseSplashState?.seenKey) localStorage.setItem(axiomReleaseSplashState.seenKey, '1');
    localStorage.setItem('axiomReleaseSplashHasLaunched', '1');
    window.AxiomEntrance?.splashPending(false);
    if (action === 'start' && typeof showTab === 'function') showTab('studio');
}


document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (document.getElementById('export-upgrade-overlay')?.classList.contains('active')) closeAxiomExportUpgradeSplash();
    if (document.getElementById('release-splash')?.classList.contains('active')) closeAxiomReleaseSplash('later');
    if (document.getElementById('studio-added-overlay')?.classList.contains('active')) hideStudioAddedOverlay();
});

document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('export-upgrade-overlay');
    overlay?.addEventListener('click', event => {
        if (event.target === overlay) closeAxiomExportUpgradeSplash();
    });
});

async function loadAxiomVersion() {
    const versionPill = document.getElementById('app-version-pill');
    const buildPill = document.getElementById('app-build-pill');
    try {
        const resp = await fetch(axiomUiPreviewMode() === 'release'
            ? '/api/app/version?ui_preview=release'
            : '/api/app/version');
        const data = await resp.json();
        if (!resp.ok || data.success === false) throw new Error(data.error || 'Version unavailable');
        const lite = data.product_edition === 'lite' || isAxiomLite();
        const editionName = lite ? 'AXIOM Lite' : 'AXIOM Pro';
        const releaseLabel = !lite && String(data.release?.title || '').trim();
        if (versionPill) versionPill.textContent = releaseLabel || `${editionName} ${data.version || 'dev'}`;
        if (buildPill && data.build) buildPill.textContent = data.build;
        const headerVersion = document.getElementById('settings-installed-version');
        const headerBuild = document.getElementById('settings-installed-build');
        if (headerVersion) headerVersion.textContent = releaseLabel || `${editionName} ${data.version || 'dev'}`;
        if (headerBuild && data.build) headerBuild.textContent = data.build;
        renderAxiomLiteMigration(data.lite_migration);
        if (axiomUiPreviewMode() === 'update-modern') {
            setTimeout(() => openUpdateModal(axiomUpdatePreviewFixture()), 120);
        } else {
            maybeShowAxiomReleaseSplash(data);
        }
    } catch (err) {
        if (versionPill && !versionPill.textContent.trim()) versionPill.textContent = 'Version unavailable';
    } finally {
        window.AxiomEntrance?.versionReady();
    }
}

function renderAxiomLiteMigration(migration = {}) {
    const item = document.getElementById('lite-migration-settings-item');
    const copy = document.getElementById('lite-migration-settings-copy');
    const button = document.getElementById('lite-migration-import-btn');
    if (!item) return;
    const available = Boolean(migration && migration.available);
    item.classList.toggle('hidden', !available);
    if (copy && available) {
        const count = Number(migration.track_count || 0);
        if (migration.imported_at) {
            copy.textContent = 'Lite library work has already been brought into Pro. Run this again only if Lite has newer prep work.';
        } else {
            copy.textContent = count > 0
            ? `Bring over ${count.toLocaleString()} Lite tracks, BPM/key/year Health work, cues, and saved sets. Your music files, Lite credits, and licenses stay untouched.`
            : 'Copy your AXIOM Lite library work into Pro. Your music files, Lite credits, and licenses stay untouched.';
        }
    }
    if (button) {
        button.disabled = !available;
        button.textContent = migration.imported_at ? 'Refresh From Lite' : 'Import Lite Work';
    }
}

async function refreshAxiomLiteMigration() {
    try {
        const resp = await fetch('/api/app/lite_migration/status');
        const data = await resp.json();
        if (!resp.ok || data.success === false) throw new Error(data.error || 'Lite migration unavailable');
        renderAxiomLiteMigration(data.migration);
        return data.migration || {};
    } catch (err) {
        console.warn('Lite migration check skipped:', err);
        renderAxiomLiteMigration({ available: false });
        return {};
    }
}

async function importAxiomLiteLibrary(button) {
    const migration = await refreshAxiomLiteMigration();
    if (!migration.available) {
        showToast('No AXIOM Lite library work was found on this Mac.', true);
        return;
    }
    const count = Number(migration.track_count || 0);
    const detail = count > 0 ? `${count.toLocaleString()} Lite tracks and Health work` : 'your Lite library work';
    if (!confirm(`Bring over ${detail} into Axiom Pro? Your music files, Lite credits, and licenses stay untouched.`)) return;
    if (typeof setAxiomButtonBusy === 'function') setAxiomButtonBusy(button, true, 'Importing...');
    try {
        const resp = await fetch('/api/app/lite_migration/import', { method: 'POST' });
        const data = await resp.json();
        if (!resp.ok || data.success === false) throw new Error(data.error || 'Lite import failed');
        renderAxiomLiteMigration(data.migration);
        showToast(data.message || 'AXIOM Lite library work imported.');
        setTimeout(() => window.location.reload(), 900);
    } catch (err) {
        showToast(err.message || 'Lite import failed.', true);
    } finally {
        if (typeof setAxiomButtonBusy === 'function') setAxiomButtonBusy(button, false);
    }
}

function isAxiomLite() {
    return document.querySelector('meta[name="axiom-edition"]')?.content === 'lite';
}

function formatAxiomLicenseLabel(data = axiomLicenseState || {}) {
    const status = (data.status || '').toLowerCase();
    if (status === 'free_lite') return 'Free Lite';
    if (!data.required) return 'Dev';
    const accessTier = String(data.access_tier || data.accessTier || window.AXIOM_ACCESS_CONTEXT?.tier || '').toLowerCase();
    if (accessTier === 'owned_engines') return 'Owned Engines';
    if (status === 'guest_preview' || accessTier === 'guest_preview') return 'Guest 500';
    if (accessTier === 'free_account') return 'Free 1000';
    if (status === 'terms_required') return 'Access Terms';
    if (status === 'trial') {
        const days = data.trial_days_left;
        if (days === 1) return 'Trial 1 Day';
        if (Number.isFinite(days)) return `Trial ${days} Days`;
        return 'Trial';
    }
    if (status === 'active') return 'Licensed';
    if (status === 'lifetime') return 'Lifetime';
    if (!data.usable) return 'Activate';
    return 'License';
}

function axiomDateIsActive(value) {
    if (!value) return false;
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date.getTime() >= Date.now();
}

function axiomOwnedEngineAccess(data = axiomLicenseState || {}) {
    const tier = String(data.access_tier || data.accessTier || '').toLowerCase();
    if (tier !== 'owned_engines') return null;
    const available = data.entitlements?.availableEngines;
    if (!available || typeof available !== 'object') return null;
    return available;
}

function axiomDawEntryAllowed() {
    if (isAxiomLite()) return false;
    if (axiomReviewMode() || axiomUiPreviewMode()) return true;
    return Boolean(axiomLicenseState?.status && window.AXIOM_ACCESS_CONTEXT?.canDaw === true);
}

function installAxiomDawAccessGuard() {
    const daw = window.AxiomStudioDaw;
    if (!daw || daw.__axiomAccessGuard) return;
    const entryMethods = new Set([
        'requestCurrentSet', 'openCurrentSet', 'openTrackByIndex',
        'showStudioDawProject', 'showStudioDawSetProject', 'newBlankProject',
        'restoreProject', 'revealProject'
    ]);
    const deny = () => {
        showToast('Studio DAW requires an active AXIOM PRO subscription or Studio DAW ownership.', true);
    };
    const guarded = Object.create(daw);
    Object.defineProperty(guarded, '__axiomAccessGuard', { value: true });
    for (const name of entryMethods) {
        const original = daw[name];
        if (typeof original !== 'function') continue;
        Object.defineProperty(guarded, name, {
            value: (...args) => axiomDawEntryAllowed() ? original.apply(daw, args) : deny()
        });
    }
    window.AxiomStudioDaw = guarded;
    for (const name of ['openStudioDawTrackMenu', 'openLibraryDawTrackMenu']) {
        const original = window[name];
        if (typeof original !== 'function') continue;
        window[name] = (...args) => axiomDawEntryAllowed() ? original(...args) : deny();
    }
}

function hasPaidAxiomEntitlement(data = axiomLicenseState || {}) {
    if (data.product_edition === 'lite' || isAxiomLite()) return false;
    const status = String(data.status || '').toLowerCase();
    const tokenTracks = Number(data.token_tracks_purchased ?? data.tokenTracksPurchased ?? 0) || 0;
    return Boolean(
        data.unlimited_tracks === true ||
        data.unlimitedTracks === true ||
        data.track_limit === null ||
        data.trackLimit === null ||
        tokenTracks > 0 ||
        /active_subscription|active_bundle|lifetime|lifetime_owned|offline_grace/.test(status) ||
        data.lifetime_purchased_at ||
        data.lifetimePurchasedAt ||
        axiomDateIsActive(data.current_period_end || data.currentPeriodEnd) ||
        axiomDateIsActive(data.bundle_ends_at || data.bundleEndsAt)
    );
}

function isFreeAxiomAccess(data = axiomLicenseState || {}) {
    // Lite is a permanent desktop edition, separate from the web preview tier.
    if (data.product_edition === 'lite' || isAxiomLite()) return false;
    if (axiomOwnedEngineAccess(data)) return false;
    const status = String(data.status || '').toLowerCase();
    if (hasPaidAxiomEntitlement(data)) return false;
    const accessTier = String(data.access_tier || data.accessTier || window.AXIOM_ACCESS_CONTEXT?.tier || '').toLowerCase();
    const accessMode = String(window.AXIOM_ACCESS_CONTEXT?.mode || '').toLowerCase();
    if (data.preview_usable === true || data.previewUsable === true) return true;
    if (accessMode === 'guest' || accessMode === 'free') return true;
    if (status === 'guest_preview' || accessTier === 'guest_preview' || accessTier === 'free_account') return true;
    if (!data.required || !data.usable) return false;
    return false;
}

function applyAxiomAccessUi(data = axiomLicenseState || {}) {
    if (isAxiomLite()) {
        document.body.classList.remove('axiom-free-access');
        window.AXIOM_ACCESS_CONTEXT = {
            mode: 'lite', tier: 'lite', canSaveSets: true, canExport: true,
            canSeratoExport: true, canPerformance: false, canDaw: false
        };
        applyAxiomSurfaceMode();
        return;
    }
    const localStudioReview = ['studio-active', 'anchor-selection'].includes(axiomReviewMode());
    const freeAccess = isFreeAxiomAccess(data) && !localStudioReview;
    const owned = axiomOwnedEngineAccess(data);
    document.body.classList.toggle('axiom-free-access', freeAccess);
    document.body.classList.toggle('axiom-owned-engines', Boolean(owned));
    window.AXIOM_ACCESS_CONTEXT = {
        ...(window.AXIOM_ACCESS_CONTEXT || {}),
        canSaveSets: owned ? owned.magic_set_paste === true : !freeAccess || !isAxiomWebPreview(),
        canExport: owned ? owned.magic_set_paste === true : !freeAccess || !isAxiomWebPreview(),
        canSeratoExport: !isAxiomWebPreview() && (owned ? owned.magic_set_paste === true : !freeAccess || hasPaidAxiomEntitlement(data)),
        canPerformance: !isAxiomWebPreview() && (owned ? owned.performance === true : !freeAccess),
        canHealth: owned ? owned.health === true : !freeAccess,
        canDaw: !isAxiomWebPreview() && (owned ? owned.studio_daw === true : !freeAccess),
        tier: owned ? 'owned' : freeAccess ? 'free' : hasPaidAxiomEntitlement(data) ? 'paid' : (window.AXIOM_ACCESS_CONTEXT?.tier || 'unknown')
    };
    applyAxiomSurfaceMode();
}

function requirePaidStudioFeature(featureName = 'this Studio feature') {
    if (window.AXIOM_ACCESS_CONTEXT?.tier === 'owned' && window.AXIOM_ACCESS_CONTEXT?.canSaveSets === false) {
        showToast(`${featureName} needs Magic Set + Paste a Playlist ownership or an AXIOM PRO subscription.`, true);
        return false;
    }
    if (!document.body.classList.contains('axiom-free-access')) return true;
    showToast(`${featureName} is available with paid AXIOM access. Free mode keeps Library and Studio building open.`, true);
    return false;
}

function renderAxiomLicense(data = axiomLicenseState || {}) {
    axiomLicenseState = data;
    applyAxiomAccessUi(data);
    const freeAccess = isFreeAxiomAccess(data);
    const previewUsable = Boolean(freeAccess || data.preview_usable === true || data.previewUsable === true);
    const activationBeforeLibrary = Boolean(data.activation_required_before_library || data.activationRequiredBeforeLibrary);
    const shouldLock = !axiomUiPreviewMode() && !axiomReviewMode()
        && !['checking', 'required'].includes(document.documentElement.dataset.axiomLogin) && Boolean(
        activationBeforeLibrary
        || (data.required && !data.usable && !previewUsable)
    );
    const pill = document.getElementById('license-status-pill');
    if (pill) {
        pill.textContent = formatAxiomLicenseLabel(data);
        pill.classList.toggle('active', Boolean(data.usable || previewUsable));
        pill.classList.toggle('warning', shouldLock);
        pill.style.display = data.required || isAxiomLite() ? 'inline-flex' : 'none';
    }
    document.body.classList.toggle('license-locked', shouldLock);
    if (shouldLock) {
        openLicenseModal(data, true);
    }
    window.AxiomEntrance?.licenseReady();
}

async function checkAxiomLicense(userInitiated = false) {
    if (isRawFilePreview()) {
        showRawFileLaunchWarning();
        return;
    }
    try {
        const resp = await fetch(userInitiated ? '/api/license/validate' : '/api/license/status', {
            method: userInitiated ? 'POST' : 'GET',
            headers: userInitiated ? { 'Content-Type': 'application/json' } : undefined,
            body: userInitiated ? JSON.stringify({
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
                locale: navigator.language || ''
            }) : undefined
        });
        const data = await resp.json();
        if (!resp.ok || data.success === false) throw new Error(data.error || 'License check failed');
        renderAxiomLicense(data);
        if (userInitiated) showToast(data.message || 'License checked.');
    } catch (err) {
        renderAxiomLicense({ required: true, usable: false, status: 'error', message: err.message || 'License check failed.' });
        if (userInitiated) showToast(err.message || 'License check failed.', true);
    }
}

async function validateAxiomLicenseOnline(userInitiated = false) {
    if (isRawFilePreview()) {
        showRawFileLaunchWarning();
        return false;
    }
    // Windows (windows-hide-mac.js sets this) with activation switched off: there is nothing to validate, and the server answers 400.
    if (window.PeakHourActivationOff === true && axiomLicenseState?.required === false) return Boolean(axiomLicenseState?.usable);
    try {
        const resp = await fetch('/api/license/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
                locale: navigator.language || ''
            })
        });
        const data = await resp.json();
        if (!resp.ok || data.success === false) throw new Error(data.error || 'License validation failed');
        renderAxiomLicense(data);
        if (userInitiated) showToast(data.message || 'License checked.');
        return Boolean(data.usable);
    } catch (err) {
        if (userInitiated) showToast(err.message || 'License validation failed.', true);
        return Boolean(axiomLicenseState?.usable);
    }
}

async function reportAxiomLaunch(force = false) {
    if (isRawFilePreview()) return false;
    const sessionKey = 'axiomLaunchReported';
    if (!force && sessionStorage.getItem(sessionKey) === '1') return true;
    try {
        const resp = await fetch('/api/app/launch_report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
                locale: navigator.language || ''
            })
        });
        const data = await resp.json();
        if (!resp.ok || data.success === false) throw new Error(data.error || 'Launch report failed');
        sessionStorage.setItem(sessionKey, '1');
        return Boolean(data.reported);
    } catch (err) {
        console.warn('AXIOM launch report skipped:', err);
        return false;
    }
}

async function ensureAxiomLicenseUsable(featureName = 'that feature') {
    // Local review fixtures must remain serial-free so UI and workflow checks
    // can exercise real controls. This never applies to installed/non-local AXIOM.
    if (['127.0.0.1', 'localhost'].includes(window.location.hostname) && (axiomReviewMode() || axiomUiPreviewMode())) return true;
    if (window.AXIOM_ACCESS_CONTEXT?.mode === 'guest' && /export|serato|intelligence|favorite/i.test(String(featureName || ''))) {
        if (window.AXIOM_REQUIRE_ACCOUNT_FEATURE) window.AXIOM_REQUIRE_ACCOUNT_FEATURE(featureName);
        return false;
    }
    if (!axiomLicenseState?.required) return true;
    if (axiomLicenseState?.usable) {
        validateAxiomLicenseOnline(false);
        return true;
    }
    await checkAxiomLicense(false);
    if (axiomLicenseState?.usable) return true;
    openLicenseModal({
        ...axiomLicenseState,
        message: axiomLicenseState?.message || `Activate AXIOM to use ${featureName}.`
    }, true);
    return false;
}

function isAxiomStoreDistribution(data = axiomUpdateState || {}) {
    return document.querySelector('meta[name="axiom-distribution"]')?.content === 'mac_app_store'
        || data.update_channel === 'mac_app_store';
}

async function fetchAxiomUpdatePayload() {
    if (isAxiomStoreDistribution()) return fetch('/api/app/check_update');
    if (isAxiomWebPreview()) return fetch('/api/axiom/update');
    return fetch('/api/app/check_update');
}

function axiomUpdatePreviewFixture() {
    return {
        title: 'AXIOM PRO 1.0.4 BETA', latest_version: '1.0.4 BETA',
        current_version: '1.0.3', design_preview: true,
        message: 'Download the latest AXIOM PRO for Mac. Quit AXIOM before running the installer. Your music, library and saved projects stay in place.',
        release_notes_url: 'https://www.djowe.com/axiom', download_url: 'https://www.djowe.com/axiom',
    };
}

async function checkForAxiomUpdate(userInitiated = false) {
    if (typeof axiomUiPreviewMode === 'function' && ['release-modern', 'release3', 'release15'].includes(axiomUiPreviewMode())) return;
    if (typeof axiomUiPreviewMode === 'function' && axiomUiPreviewMode() === 'update-modern') {
        if (userInitiated) openUpdateModal(axiomUpdatePreviewFixture());
        return;
    }
    try {
        const resp = await fetchAxiomUpdatePayload();
        const data = await resp.json();
        if (!resp.ok || data.success === false) throw new Error(data.error || 'Update check failed');
        axiomUpdateState = data;

        if (isAxiomStoreDistribution(data)) {
            closeUpdateModal();
            if (userInitiated) showToast(data.message || 'Manage AXIOM updates in the Mac App Store.', false, {important: true});
            return;
        }
        if (!data.updates_configured) {
            if (userInitiated) showToast('Update feed is not configured for this build.', true);
            return;
        }
        if (data.update_available) {
            openUpdateModal(data);
            return;
        }
        if (userInitiated) showToast('AXIOM is up to date.');
    } catch (err) {
        if (userInitiated) showToast(err.message || 'Update check failed.', true);
    }
}

function openUpdateModal(data = axiomUpdateState || {}) {
    if (isAxiomStoreDistribution() || isAxiomStoreDistribution(data)) {
        closeUpdateModal();
        return;
    }
    axiomUpdateState = data;
    const modal = document.getElementById('update-modal');
    const title = document.getElementById('update-modal-title');
    const kicker = document.getElementById('update-modal-kicker');
    const copy = document.getElementById('update-modal-copy');
    const notesBtn = document.getElementById('update-release-notes-btn');
    const downloadBtn = document.getElementById('update-download-btn');
    if (!modal) return;

    if (kicker) kicker.textContent = data.required ? 'Required Software Update' : 'Software Update';
    const updateVersion = document.getElementById('update-sonic-version');
    if (updateVersion) updateVersion.textContent = data.latest_version || '';
    if (title) title.textContent = data.title || `AXIOM ${data.latest_version || ''}`;
    if (copy) {
        const current = data.current_version ? `Current: ${data.current_version}. ` : '';
        const latest = data.latest_version ? `New: ${data.latest_version}. ` : '';
        copy.textContent = data.message || `${current}${latest}Download the newest AXIOM installer. Your library cache, settings, playlists, license, and music files stay outside the app bundle.`;
    }
    if (notesBtn) notesBtn.style.display = data.release_notes_url ? 'inline-flex' : 'none';
    if (downloadBtn) downloadBtn.style.display = data.download_url ? 'inline-flex' : 'none';
    modal.classList.add('active');
    setTimeout(() => (data.download_url ? downloadBtn : modal.querySelector('.update-modal-btn.secondary'))?.focus(), 60);
}

function closeUpdateModal() {
    document.getElementById('update-modal')?.classList.remove('active');
}

function openAxiomExternalUrl(rawUrl, label = 'link', options = {}) {
    const url = String(rawUrl || '').trim();
    if (!url) return false;

    let parsed;
    try {
        parsed = new URL(url, window.location.href);
    } catch (_) {
        showToast(`AXIOM could not open that ${label}.`, true);
        return false;
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        showToast(`AXIOM blocked an unsafe ${label}.`, true);
        return false;
    }

    const nativeBridge = window.webkit?.messageHandlers?.axiomNative;
    if (nativeBridge?.postMessage) {
        nativeBridge.postMessage({
            action: 'openExternal',
            url: parsed.href
        });
        return true;
    }

    if (options.sameWindow) {
        window.location.assign(parsed.href);
        return true;
    }

    const popup = window.open(parsed.href, '_blank', 'noopener,noreferrer');
    if (!popup) window.location.assign(parsed.href);
    return true;
}

function downloadAxiomUpdate() {
    if (typeof axiomUiPreviewMode === 'function' && axiomUiPreviewMode() === 'update-modern' && axiomUpdateState?.design_preview) {
        showToast('Design preview only. No download starts.');
        return;
    }
    if (isAxiomStoreDistribution()) {
        showToast('Manage AXIOM updates in the Mac App Store.', false, {important: true});
        return;
    }
    const url = axiomUpdateState?.download_url;
    if (!url) {
        showToast('No update download URL is configured.', true);
        return;
    }
    openAxiomExternalUrl(url, 'update download');
}

function openUpdateReleaseNotes() {
    const url = axiomUpdateState?.release_notes_url;
    if (!url) return;
    openAxiomExternalUrl(url, 'release notes');
}

let axiomLicenseAccessView = 'activate';

function setAxiomLicenseStatus(message = '', isError = false) {
    const status = document.getElementById('license-access-status');
    if (!status) return;
    status.textContent = String(message || '');
    status.classList.toggle('error', Boolean(isError));
}

function selectAxiomPlan(planId = 'yearly') {
    const allowedPlans = new Set(['monthly', 'yearly', 'lifetime']);
    const selectedPlan = allowedPlans.has(planId) ? planId : 'yearly';
    const planField = document.getElementById('license-plan');
    if (planField) planField.value = selectedPlan;
    document.querySelectorAll('[data-license-plan]').forEach(row => {
        row.setAttribute('aria-checked', row.dataset.licensePlan === selectedPlan ? 'true' : 'false');
    });
}

function setLicenseAccessView(view = 'activate', options = {}) {
    const nextView = view === 'checkout' ? 'checkout' : 'activate';
    const modal = document.getElementById('license-modal');
    const dock = modal?.querySelector('.license-access-dock');
    const activateTab = document.getElementById('license-activate-tab');
    const checkoutTab = document.getElementById('license-checkout-tab');
    const activatePanel = document.getElementById('license-activate-panel');
    const checkoutPanel = document.getElementById('license-checkout-panel');
    const title = document.getElementById('license-modal-title');
    const copy = document.getElementById('license-modal-copy');
    axiomLicenseAccessView = nextView;
    if (dock) dock.dataset.licenseView = nextView;
    if (activateTab) activateTab.setAttribute('aria-selected', nextView === 'activate' ? 'true' : 'false');
    if (checkoutTab) checkoutTab.setAttribute('aria-selected', nextView === 'checkout' ? 'true' : 'false');
    if (activatePanel) activatePanel.hidden = nextView !== 'activate';
    if (checkoutPanel) checkoutPanel.hidden = nextView !== 'checkout';

    if (!options.preserveCopy) {
        if (nextView === 'checkout') {
            if (title) title.textContent = 'Choose Your AXIOM Access';
            if (copy) copy.textContent = 'Pick the plan that fits how you work. Secure checkout opens on DJ OWE.';
        } else {
            if (title) title.textContent = 'Ready To Unlock AXIOM?';
            if (copy) copy.textContent = 'Your activation details are in your DJ OWE email. Enter them below to unlock your full library and features.';
        }
    }
    setAxiomLicenseStatus('');
}

function toggleAxiomLicenseKeyVisibility() {
    const keyField = document.getElementById('license-key');
    const revealBtn = document.getElementById('license-key-reveal');
    if (!keyField || !revealBtn) return;
    const revealing = keyField.type === 'password';
    keyField.type = revealing ? 'text' : 'password';
    revealBtn.textContent = revealing ? 'Hide' : 'Reveal';
    revealBtn.setAttribute('aria-pressed', revealing ? 'true' : 'false');
}

function showAxiomGuestPreview() {
    const previewUsable = Boolean(
        axiomLicenseState?.preview_usable
        || axiomLicenseState?.previewUsable
        || String(axiomLicenseState?.status || '').toLowerCase() === 'guest_preview'
        || String(axiomLicenseState?.access_tier || axiomLicenseState?.accessTier || '').toLowerCase() === 'guest_preview'
    );
    if (!previewUsable) {
        setAxiomLicenseStatus('Guest Preview is not available for this access state.', true);
        return;
    }
    document.getElementById('license-modal')?.classList.remove('active');
    document.body.classList.remove('license-locked');
}

function showRawFileLaunchWarning() {
    axiomLicenseState = {
        required: true,
        usable: false,
        status: 'wrong_launch',
        message: 'This is the raw AXIOM screen file. License keys, music loading, folder picking, and playback only work when AXIOM is running as the app.'
    };

    const modal = document.getElementById('license-modal');
    const kicker = document.getElementById('license-modal-kicker');
    const title = document.getElementById('license-modal-title');
    const copy = document.getElementById('license-modal-copy');
    const closeBtn = document.getElementById('license-close-btn');
    const activateBtn = document.getElementById('license-activate-btn');
    const tabs = document.getElementById('license-access-tabs');
    const accountGroup = document.getElementById('license-account-group');
    const keyGroup = document.getElementById('license-key-group');
    const guestBtn = document.getElementById('license-guest-btn');
    const separator = modal?.querySelector('.license-access-separator');
    const pill = document.getElementById('license-status-pill');

    document.body.classList.add('license-locked');
    setLicenseAccessView('activate', { preserveCopy: true });
    if (pill) {
        pill.textContent = 'Open App';
        pill.classList.add('warning');
        pill.style.display = 'inline-flex';
    }
    if (kicker) kicker.textContent = 'Wrong Launch';
    if (title) title.textContent = 'Open AXIOM From The App';
    if (copy) copy.textContent = axiomLicenseState.message;
    if (closeBtn) closeBtn.style.display = 'none';
    if (tabs) tabs.style.display = 'none';
    if (accountGroup) accountGroup.style.display = 'none';
    if (keyGroup) keyGroup.style.display = 'none';
    if (guestBtn) guestBtn.style.display = 'none';
    if (separator) separator.style.display = 'none';
    if (activateBtn) {
        activateBtn.disabled = false;
        activateBtn.textContent = 'Open Running AXIOM';
        activateBtn.onclick = openRunningAxiomFromFilePreview;
    }
    modal?.classList.add('active');
}

function openRunningAxiomFromFilePreview() {
    window.location.href = 'http://127.0.0.1:8080/?review=library&opened_from=file-preview';
}

function openLicenseModal(data = axiomLicenseState || {}, locked = false) {
    axiomLicenseState = data;
    const modal = document.getElementById('license-modal');
    const kicker = document.getElementById('license-modal-kicker');
    const title = document.getElementById('license-modal-title');
    const copy = document.getElementById('license-modal-copy');
    const closeBtn = document.getElementById('license-close-btn');
    const tabs = document.getElementById('license-access-tabs');
    const accountGroup = document.getElementById('license-account-group');
    const keyGroup = document.getElementById('license-key-group');
    const guestBtn = document.getElementById('license-guest-btn');
    const separator = modal?.querySelector('.license-access-separator');
    const emailField = document.getElementById('license-email');
    const keyField = document.getElementById('license-key');
    const deviceField = document.getElementById('license-device-label');
    const planField = document.getElementById('license-plan');
    const checkoutBtn = document.getElementById('license-checkout-btn');
    const activateBtn = document.getElementById('license-activate-btn');
    if (!modal) return;

    const status = (data.status || '').toLowerCase();
    const days = data.trial_days_left;
    if (emailField && data.email && !emailField.value) emailField.value = data.email;
    if (deviceField && !deviceField.value) deviceField.value = data.device_label || 'This Mac';
    if (keyField) {
        keyField.type = 'password';
        keyField.style.display = 'block';
    }
    document.getElementById('license-key-reveal')?.setAttribute('aria-pressed', 'false');
    if (document.getElementById('license-key-reveal')) document.getElementById('license-key-reveal').textContent = 'Reveal';
    if (tabs) tabs.style.display = 'grid';
    if (accountGroup) accountGroup.style.display = 'grid';
    if (keyGroup) keyGroup.style.display = 'grid';
    if (guestBtn) guestBtn.style.display = 'inline-flex';
    if (separator) separator.style.display = 'grid';
    const canCheckout = status !== 'terms_required' && (!data.usable || status === 'trial' || status === 'payment_required');
    if (planField) planField.disabled = !canCheckout;
    if (checkoutBtn) checkoutBtn.disabled = !canCheckout;
    if (status === 'terms_required') {
        if (tabs) tabs.style.display = 'none';
        if (accountGroup) accountGroup.style.display = 'none';
        if (keyGroup) keyGroup.style.display = 'none';
        if (guestBtn) guestBtn.style.display = 'none';
        if (separator) separator.style.display = 'none';
    }
    if (activateBtn) {
        if (status === 'terms_required') {
            activateBtn.onclick = () => { window.location.href = '/axiom/app'; };
            activateBtn.textContent = 'Open Access Page';
        } else {
            activateBtn.onclick = activateAxiomLicense;
            activateBtn.textContent = data.usable ? 'Refresh License' : 'Unlock AXIOM';
        }
    }
    if (kicker) {
        if (status === 'trial') kicker.textContent = 'Free Trial';
        else if (status === 'device_limit_reached') kicker.textContent = 'Device Limit';
        else if (status === 'payment_required') kicker.textContent = 'Payment Required';
        else if (status === 'terms_required') kicker.textContent = 'Access Terms';
        else if (status === 'suspended') kicker.textContent = 'License Suspended';
        else kicker.textContent = 'Mac App Access';
    }
    if (title) {
        if (status === 'trial' && data.usable) title.textContent = 'AXIOM Trial Active';
        else if (status === 'device_limit_reached') title.textContent = 'Device Limit Reached';
        else if (status === 'payment_required') title.textContent = 'Payment Needed';
        else if (status === 'terms_required') title.textContent = 'Open AXIOM From The Access Page';
        else if (status === 'suspended') title.textContent = 'License Suspended';
        else if (!data.usable) title.textContent = 'Ready To Unlock AXIOM?';
        else title.textContent = 'AXIOM Activated';
    }
    if (copy) {
        if (status === 'trial' && data.usable) {
            const label = days === 1 ? '1 day' : `${days ?? data.trial_days ?? 14} days`;
            copy.textContent = `Your free trial is active. You have ${label} left. Activate anytime to keep using AXIOM after the trial.`;
        } else if (!data.configured) {
            copy.textContent = 'This build is ready for a 30-day trial, but the live license server is not connected yet.';
        } else if (status === 'device_limit_reached') {
            copy.textContent = 'Please manage your AXIOM access from your DJ OWE dashboard, then try again.';
        } else if (status === 'payment_required') {
            copy.textContent = data.message || 'Payment is needed to keep using AXIOM.';
        } else if (status === 'terms_required') {
            copy.textContent = data.message || 'Open AXIOM through the official access page and accept the early-access terms before starting a browser trial.';
        } else if (status === 'suspended') {
            copy.textContent = data.message || 'This AXIOM license is suspended. Contact support if this looks wrong.';
        } else if (status === 'activation_key_not_found') {
            copy.textContent = data.message || 'That activation key was not found. Check the key and try again.';
        } else if (status === 'account_not_found') {
            copy.textContent = data.message || 'That account email was not found. Use the email from checkout.';
        } else if (data.activation_required_before_library || data.activationRequiredBeforeLibrary) {
            copy.textContent = 'Your activation details are in your DJ OWE email. Enter them below to unlock your full library and features.';
        } else if (!data.usable) {
            copy.textContent = data.message || 'Your trial has ended. AXIOM is now in the 500-track Free Builder. Upgrade to restore full access instantly.';
        } else {
            copy.textContent = data.message || 'AXIOM is activated on this Mac.';
        }
    }
    const previewUsable = Boolean(data.preview_usable || data.previewUsable || status === 'guest_preview');
    if (closeBtn) closeBtn.style.display = (!locked || data.usable || previewUsable) ? 'grid' : 'none';
    if (guestBtn) guestBtn.style.display = previewUsable ? 'inline-flex' : 'none';
    if (separator) separator.style.display = previewUsable ? 'grid' : 'none';
    selectAxiomPlan(planField?.value || 'yearly');
    const preferredView = data.preferred_access_view || data.preferredAccessView || (status === 'payment_required' ? 'checkout' : 'activate');
    setLicenseAccessView(preferredView, { preserveCopy: true });
    setAxiomLicenseStatus('');
    modal.classList.add('active');
}

function closeLicenseModal() {
    const previewUsable = Boolean(
        axiomLicenseState?.preview_usable
        || axiomLicenseState?.previewUsable
        || String(axiomLicenseState?.status || '').toLowerCase() === 'guest_preview'
    );
    if (axiomLicenseState?.required && !axiomLicenseState?.usable && !previewUsable) return;
    document.getElementById('license-modal')?.classList.remove('active');
    if (previewUsable) document.body.classList.remove('license-locked');
}

async function activateAxiomLicense() {
    if (isRawFilePreview()) {
        showRawFileLaunchWarning();
        return;
    }
    const btn = document.getElementById('license-activate-btn');
    const email = document.getElementById('license-email')?.value || '';
    const licenseKey = document.getElementById('license-key')?.value || '';
    const deviceLabel = document.getElementById('license-device-label')?.value || axiomLicenseState?.device_label || 'This Mac';
    const refreshingSavedLicense = Boolean(axiomLicenseState?.usable && !String(licenseKey || '').trim());
    setAxiomLicenseStatus('');
    if (btn) {
        btn.disabled = true;
        btn.textContent = refreshingSavedLicense ? 'Refreshing License' : 'Unlocking AXIOM';
    }
    try {
        const resp = await fetch(refreshingSavedLicense ? '/api/license/refresh' : '/api/license/activate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: refreshingSavedLicense ? JSON.stringify({}) : JSON.stringify({
                email,
                license_key: licenseKey,
                device_label: deviceLabel,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
                locale: navigator.language || ''
            })
        });
        const data = await resp.json();
        if (!resp.ok || data.success === false) throw new Error(data.error || 'Activation failed');
        renderAxiomLicense(data);
        document.getElementById('license-modal')?.classList.remove('active');
        reportAxiomLaunch(true);
        if (data.library_access_upgraded || data.libraryAccessUpgraded) {
            const restored = Number(data.restored_track_count ?? data.restoredTrackCount ?? 0);
            const needsRescan = Boolean(data.library_rescan_required || data.libraryRescanRequired);
            if (needsRescan) {
                showToast('Full AXIOM access unlocked. Reconnect or rescan your music folder once to replace the old 500-track preview.');
            } else if (restored > 0) {
                showToast(`Full library unlocked. AXIOM restored ${restored.toLocaleString()} tracks from the preserved library index.`);
            } else {
                showToast('Full AXIOM access unlocked.');
            }
        } else {
            showToast(refreshingSavedLicense ? 'AXIOM license refreshed.' : 'AXIOM activated.');
        }
    } catch (err) {
        setAxiomLicenseStatus(err.message || 'Activation failed.', true);
        showToast(err.message || 'Activation failed.', true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = axiomLicenseState?.usable ? 'Refresh License' : 'Unlock AXIOM';
        }
    }
}

async function startAxiomCheckout() {
    if (isRawFilePreview()) {
        showRawFileLaunchWarning();
        return;
    }
    const btn = document.getElementById('license-checkout-btn');
    const planId = document.getElementById('license-plan')?.value || 'yearly';
    const email = document.getElementById('license-email')?.value || axiomLicenseState?.email || '';
    const previousText = btn?.textContent || 'Continue To Secure Checkout';
    setAxiomLicenseStatus('');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Opening Secure Checkout';
    }
    try {
        const resp = await fetch('/api/axiom/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                planId,
                email,
                source: 'axiom-browser-app'
            })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.error || !data.url) {
            throw new Error(data.error || 'AXIOM checkout is not available yet.');
        }
        showToast('Opening AXIOM checkout.');
        window.location.href = data.url;
    } catch (err) {
        setAxiomLicenseStatus(err.message || 'AXIOM checkout could not start.', true);
        showToast(err.message || 'AXIOM checkout could not start.', true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = previousText;
        }
    }
}

function showVenueComingSoon() {
    showToast('Venue Strategy is coming in AXIOM 2.0.');
}
window.showVenueComingSoon = showVenueComingSoon;

function showTab(tab) {
    if (isAxiomLite() && tab === 'performance') {
        switchTab('studio');
        return;
    }
    const openingDaw = tab === 'studio' && document.body.classList.contains('studio-daw-mode-active') && Boolean(window.AxiomStudioDaw?.activeProject);
    if (libraryHasTracks === false && !openingDaw) {
        showConnectMusicView();
        if (tab !== 'studio' && !document.getElementById('axiom-arrival-overlay')) {
            showToast('Connect your music to unlock AXIOM.');
        }
        return;
    }
    if (tab === 'performance' && !requireAxiomInstalledApp('Performance Mode')) {
        switchTab('studio');
        return;
    }
    if (tab === 'performance' && window.AXIOM_ACCESS_CONTEXT?.canPerformance === false) {
        const owned = window.AXIOM_ACCESS_CONTEXT?.tier === 'owned';
        showToast(owned
            ? 'Performance needs its own purchase or an AXIOM PRO subscription.'
            : 'Performance Mode is available during your 30-day trial or with paid AXIOM access.', true);
        openLicenseModal({
            ...(axiomLicenseState || {}),
            message: owned
                ? 'Your owned engines remain available. Subscribe or buy Performance to use this mode.'
                : 'Your library remains available in the 500-track Guest Preview. Upgrade AXIOM to reopen Performance Mode.'
        }, false);
        switchTab('studio');
        return;
    }
    if (tab === 'health' && window.AXIOM_ACCESS_CONTEXT?.tier === 'owned' && window.AXIOM_ACCESS_CONTEXT?.canHealth === false) {
        showToast('Health needs its own purchase or an AXIOM PRO subscription.', true);
        return;
    }
    if (tab === 'venue') {
        switchTab('studio');
        if (typeof closeStudioToolsDropdown === 'function') closeStudioToolsDropdown();
        showVenueComingSoon();
        return;
    }
    const continueNavigation = () => {
        switchTab(tab);
        if (tab === 'health' && healthJobHasFinished(lastUnifiedHealthJob) && !unifiedHealthIsActive(lastUnifiedHealthJob || {})) {
            healthScanReceiptDismissed = true;
            renderHealthApprovedWorkspace();
            resetHealthViewScroll();
        }
        if (typeof closeStudioToolsDropdown === 'function') closeStudioToolsDropdown();
        document.querySelectorAll('.hud-pill').forEach(ni => ni.style.opacity = '0.5');
        const activeNav = document.getElementById(`tab-${tab}`);
        if (activeNav) activeNav.style.opacity = '1';
    };
    if (showAxiomSessionCelebration(tab, continueNavigation)) return;
    continueNavigation();
}

// ========== FEATURE 1: DRAG & DROP FOLDER ONTO TRACKS COUNTER ==========

function handleFolderDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    const zone = document.getElementById('tracks-drop-zone');
    zone.style.background = 'rgba(57,255,20,0.08)';
    zone.style.boxShadow = '0 0 20px rgba(57,255,20,0.25)';
    zone.style.border = '1px solid rgba(57,255,20,0.5)';
    document.getElementById('tracks-drop-hint').style.opacity = '1';
}

function handleFolderDragLeave(event) {
    const zone = document.getElementById('tracks-drop-zone');
    zone.style.background = '';
    zone.style.boxShadow = '';
    zone.style.border = '';
    document.getElementById('tracks-drop-hint').style.opacity = '0';
}

async function handleFolderDrop(event) {
    event.preventDefault();
    handleFolderDragLeave(event);

    const items = event.dataTransfer.items;
    let detectedName = null;
    let detectedFullPath = null;

    // Try to get entry info via webkitGetAsEntry
    if (items && items.length > 0) {
        const entry = items[0].webkitGetAsEntry ? items[0].webkitGetAsEntry() : null;
        if (entry) {
            if (!entry.isDirectory) {
                showToast("Choose a music folder to connect.", true);
                return;
            }
            detectedName = entry.name || null;
        }
    }

    // Try to extract full path from file.path (works in Electron/some local apps)
    const files = event.dataTransfer.files;
    if (files && files.length > 0) {
        const f = files[0];
        if (f.path) {
            // Electron / local runtime exposes full path
            const parts = f.path.replace(/\\/g, '/').split('/');
            // file.path is a file inside the folder; folder is the parent
            detectedFullPath = parts.slice(0, -1).join('/');
            detectedName = parts[parts.length - 2] || detectedName;
        } else if (f.webkitRelativePath) {
            detectedName = f.webkitRelativePath.split('/')[0] || detectedName;
        }
    }

    // Show path-entry modal so user can confirm / paste the full path
    showFolderPathPrompt(detectedFullPath || '', detectedName || 'folder');
}

const axiomConnectionDialogIds = [
    'library-source-modal',
    'library-source-picker',
    'serato-source-options-modal',
    'serato-connection-recovery-modal',
    'serato-manual-path-modal',
    'serato-playback-unlock-modal',
    'axiom-diagnostics-modal'
];

function syncAxiomConnectionDialogState() {
    const activeDialog = axiomConnectionDialogIds
        .map(id => document.getElementById(id))
        .find(el => el && !el.classList.contains('music-intake-source-suspended') && el.getAttribute('aria-hidden') !== 'true');
    document.body.classList.toggle('axiom-connection-dialog-open', Boolean(activeDialog));
    if (activeDialog) document.body.dataset.axiomConnectionDialog = activeDialog.id;
    else delete document.body.dataset.axiomConnectionDialog;
}

function clearAxiomConnectionDialogs(exceptId = '') {
    axiomConnectionDialogIds.forEach(id => {
        if (id !== exceptId) document.getElementById(id)?.remove();
    });
    syncAxiomConnectionDialogState();
}

function suspendAxiomConnectionDialogsForProgress() {
    axiomConnectionDialogIds.forEach(id => {
        const dialog = document.getElementById(id);
        if (!dialog) return;
        dialog.classList.add('music-intake-source-suspended');
        dialog.setAttribute('aria-hidden', 'true');
    });
    syncAxiomConnectionDialogState();
}

function mountAxiomConnectionDialog(modal) {
    if (!modal?.id) return modal;
    hideMusicIntakeOverlay(true);
    clearAxiomConnectionDialogs(modal.id);
    modal.classList.add('axiom-connection-dialog');
    const panel = modal.firstElementChild;
    panel?.classList.add('axiom-connection-dialog-panel');
    if (panel) panel.tabIndex = 0;
    document.querySelectorAll('#toast-container > *').forEach(toast => toast.remove());
    document.body.appendChild(modal);
    syncAxiomConnectionDialogState();
    const observer = new MutationObserver(() => {
        if (modal.isConnected) return;
        observer.disconnect();
        syncAxiomConnectionDialogState();
    });
    observer.observe(document.body, { childList: true });
    return modal;
}

function closeLibrarySourcePicker() {
    window.cancelAxiomMusicFolderSelection?.();
    document.querySelectorAll('#library-source-modal, #library-source-picker').forEach(el => el.remove());
    syncAxiomConnectionDialogState();
}
