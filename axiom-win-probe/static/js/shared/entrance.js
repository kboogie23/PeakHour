/* Reusable doors over the real Studio start page. Never takes playlist ownership. */
(function () {
  'use strict';
  if (window.AxiomEntrance) return;
  const session = window.__axiomEntranceSession;
  const overlay = document.getElementById('axiom-entrance');
  const workspace = document.getElementById('main-content-wrapper');
  if (!session || !overlay || !workspace) return;
  const button = overlay.querySelector('button');
  const remixButton = document.getElementById('axiom-entrance-remix');
  let destination = 'set';
  const gates = { library: false, version: false, license: false, splash: false };
  const covered = new Map(), animations = new Set();
  let presented = false, preparing = false, tourChecked = false, fallback = 0, scheduled = false, navigated = false, closingRun = 0;
  const timing = Object.freeze({ total: 1320, doorsStart: 180, doorsDuration: 970, brandingStart: 120, brandingDuration: 200 });
  function protect() {
    for (const node of workspace.children) {
      if (!node.matches('.tab-content, #audio-player')) continue;
      if (!covered.has(node)) covered.set(node, { inert: node.inert, hidden: node.getAttribute('aria-hidden') });
      node.inert = true;node.setAttribute('aria-hidden', 'true');
    }
  }
  function restore() {
    for (const [node, previous] of covered) {
      node.inert = previous.inert;
      if (previous.hidden === null) node.removeAttribute('aria-hidden');
      else node.setAttribute('aria-hidden', previous.hidden);
    }
    covered.clear();
  }
  function finish(focus = false) {
    if (session.phase === 'OPEN') return;
    closingRun++;session.phase = 'OPEN';session.eligible = false;
    try { sessionStorage.setItem(session.key, 'OPEN'); } catch (_) {}
    clearTimeout(fallback);
    for (const animation of animations) animation.cancel();
    animations.clear();observer.disconnect();restore();
    document.documentElement.removeAttribute('data-axiom-entrance');
    presented = false;
    window.AxiomEntranceLibrary?.hide();
    const openRemix = focus && destination === 'remix';
    destination = 'set';
    if (openRemix) {
      document.getElementById('main-search')?.focus({ preventScroll: true });
      window.showToast?.('Choose a song in Library. Right-click it to make a Studio DAW edit, or add songs to Studio for a mixtape.');
      return;
    }
    if (!focus) window.AxiomEntranceSound?.stop();
    if (focus) {
      const heading = document.querySelector('#studio-start-view .command-title');
      if (heading && !heading.closest('.hidden')) { heading.setAttribute('tabindex', '-1');heading.focus({ preventScroll: true }); }
    }
  }
  function prepareDestination() {
    preparing = true;
    try { showAxiomStart({ allowReviewNavigation: true, entrance: true }); }
    finally { preparing = false; }
    // The local ready fixture must allow reviewing both paths without a real library.
    if (session.fixture && new URLSearchParams(location.search).get('entrance_library') === 'ready') {
      document.getElementById('studio-path-room')?.classList.remove('hidden');
    }
    protect();
  }
  function blockers() {
    return ['checking', 'required'].includes(document.documentElement.dataset.axiomLogin) || document.body.classList.contains('license-locked') || document.querySelector('#license-modal.active, #update-modal.active, #release-splash.active, #axiom-arrival-overlay, #library-source-modal, #daw-draft-dialog');
  }
  function maybePresent() {
    scheduled = false;
    if (!session.eligible || session.phase !== 'CLOSED' || presented || !gates.library || !gates.version || !gates.license || gates.splash || blockers()) return;
    if (window.AxiomStudioDaw?.activeProject) { finish();return; }
    if (!tourChecked) {
      tourChecked = true;
      const flow = new URLSearchParams(location.search).get('entrance_flow') || '';
      if ((!session.fixture || flow.includes('tour')) && !window.AxiomEntranceLibrary?.empty) showAxiomArrival(session.fixture);
      if (document.getElementById('axiom-arrival-overlay')) return;
    }
    prepareDestination();presented = true;
    document.documentElement.setAttribute('data-axiom-entrance', 'closed');
    libraryChanged();
    if (!document.querySelector('#master-hud.active')) (button.disabled ? document.getElementById('entrance-add-music') : button)?.focus({ preventScroll: true });
  }
  function schedule() {
    if (session.eligible && !scheduled) { scheduled = true;queueMicrotask(maybePresent); }
  }
  function animate(node, frames, options) {
    const animation = node.animate(frames, { fill: 'both', ...options });
    animations.add(animation);return animation;
  }
  function open(target = 'set') {
    if (session.phase !== 'CLOSED' || !presented || blockers() || (window.AxiomEntranceLibrary && !window.AxiomEntranceLibrary.canOpen)) return;
    destination = target === 'remix' ? 'remix' : 'set';
    // Set the page behind the closed doors before their opening animation.
    // Navigation here must not dismiss the entrance or reveal Start first.
    if (destination === 'remix') {
      preparing = true;
      try { switchTab('library'); }
      finally { preparing = false; }
      protect();
    }
    session.phase = 'OPENING';button.disabled = true;
    if (remixButton) remixButton.disabled = true;
    window.AxiomEntranceLibrary?.hide();
    window.AxiomEntranceSound?.play();
    document.documentElement.setAttribute('data-axiom-entrance', 'opening');
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(true);return; }
    fallback = setTimeout(() => finish(true), timing.total + 450);
    try {
      const start = document.timeline.currentTime;
      const tracks = [
        animate(overlay.querySelector('.entrance-brand'), [{ opacity: 1 }, { opacity: 0 }], { delay: timing.brandingStart, duration: timing.brandingDuration, easing: 'ease-out' }),
        animate(overlay.querySelector('.entrance-left'), [{ transform: 'translateX(0)' }, { transform: 'translateX(-101%)' }], { delay: timing.doorsStart, duration: timing.doorsDuration, easing: 'cubic-bezier(.65,0,.2,1)' }),
        animate(overlay.querySelector('.entrance-right'), [{ transform: 'translateX(0)' }, { transform: 'translateX(101%)' }], { delay: timing.doorsStart, duration: timing.doorsDuration, easing: 'cubic-bezier(.65,0,.2,1)' }),
        animate(overlay.querySelector('.entrance-floor'), [{ opacity: 1 }, { opacity: 0 }], { delay: 1000, duration: 320 }),
        animate(overlay.querySelector('.entrance-light'), [{ opacity: 0 }, { opacity: .4, offset: .4 }, { opacity: 0 }], { duration: 320 }),
      ];
      for (const animation of tracks) animation.startTime = start;
      Promise.all(tracks.map(a => a.finished)).then(() => { if (session.phase === 'OPENING') finish(true); }).catch(() => { if (session.phase === 'OPENING') finish(true); });
    } catch (_) { finish(true); }
  }
  function libraryChanged() {
    const library = window.AxiomEntranceLibrary;
    const locked = library && !library.canOpen;
    overlay.toggleAttribute('data-library-locked', Boolean(locked));
    const welcome = document.getElementById('entrance-welcome');
    if (welcome) welcome.hidden = !locked;
    button.disabled = session.phase !== 'CLOSED' || !presented || Boolean(locked);
    if (remixButton) remixButton.disabled = button.disabled;
  }
  function close() {
    if (session.phase !== 'OPEN' || blockers() || !gates.library || !gates.version || !gates.license) return;
    // Only cover the existing Start view. Do not create/reset a set or touch transport.
    const run = ++closingRun;
    session.phase = 'CLOSING';session.eligible = true;presented = true;
    try { sessionStorage.removeItem(session.key); } catch (_) {}
    window.AxiomEntranceSound?.play();protect();
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    document.documentElement.setAttribute('data-axiom-entrance', 'closing');libraryChanged();
    function settled() {
      if (session.phase !== 'CLOSING' || run !== closingRun) return;
      session.phase = 'CLOSED';clearTimeout(fallback);
      for (const animation of animations) animation.cancel();
      animations.clear();
      document.documentElement.setAttribute('data-axiom-entrance', 'closed');libraryChanged();
      (button.disabled ? document.getElementById('entrance-add-music') : button)?.focus({ preventScroll: true });
    }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { settled();return; }
    fallback = setTimeout(settled, timing.total + 450);
    try {
      const start = document.timeline.currentTime;
      const tracks = [
        animate(overlay.querySelector('.entrance-left'), [{ transform: 'translateX(-101%)' }, { transform: 'translateX(0)' }], { duration: timing.doorsDuration, easing: 'cubic-bezier(.65,0,.2,1)' }),
        animate(overlay.querySelector('.entrance-right'), [{ transform: 'translateX(101%)' }, { transform: 'translateX(0)' }], { duration: timing.doorsDuration, easing: 'cubic-bezier(.65,0,.2,1)' }),
        animate(overlay.querySelector('.entrance-floor'), [{ opacity: 0 }, { opacity: 1 }], { duration: 700, easing: 'ease-in' }),
        animate(overlay.querySelector('.entrance-smoke'), [{ opacity: 0 }, { opacity: 1 }], { delay: 350, duration: 750 }),
        animate(overlay.querySelector('.entrance-brand'), [{ opacity: 0 }, { opacity: 1 }], { delay: 970, duration: 350, easing: 'ease-out' }),
      ];
      for (const animation of tracks) animation.startTime = start;
      Promise.all(tracks.map(a => a.finished)).then(settled).catch(settled);
    } catch (_) { settled(); }
  }
  const observer = new MutationObserver(schedule);
  window.AxiomEntrance = Object.freeze({
    timing, get phase() { return session.phase; }, get eligible() { return session.eligible; },
    libraryReady() { gates.library = true; schedule();return session.eligible || navigated; },
    versionReady() { gates.version = true;schedule(); },
    licenseReady() { gates.license = true;schedule(); },
    splashPending(value) { gates.splash = value;schedule(); },
    navigate() { if (window.AxiomEntranceLibrary?.busy) return; if (session.eligible && !preparing && presented && !document.getElementById('axiom-arrival-overlay')) finish(); },
    dismiss: finish, open, close, libraryChanged,
  });
  if (session.eligible) protect();
  button.addEventListener('click', () => open());
  remixButton?.addEventListener('click', () => open('remix'));
  document.getElementById('axiom-sidebar')?.addEventListener('click', event => {
    if (event.target.closest('button, a') && !event.target.closest('.axiom-sidebar-utilities, #tracks-drop-zone') && !document.getElementById('axiom-arrival-overlay')) { navigated = true;finish(); }
  }, true);
  window.addEventListener('popstate', () => finish());
  window.addEventListener('hashchange', () => finish());
  window.addEventListener('pagehide', () => { if (session.phase === 'OPENING' || session.phase === 'CLOSING') finish(); });
  document.addEventListener('visibilitychange', () => document.documentElement.toggleAttribute('data-entrance-paused', document.hidden));
  document.addEventListener('keydown', event => {
    // Covered player shortcuts cannot steal Space from the entrance button.
    if (session.eligible && !blockers() && !event.target.closest('#axiom-sidebar, #master-hud') && [' ', 'ArrowLeft', 'ArrowRight'].includes(event.key)) event.stopPropagation();
  }, true);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
})();
