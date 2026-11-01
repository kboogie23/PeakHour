/* Before first paint: reserve the existing workspace without touching the sidebar. */
(function () {
  const params = new URLSearchParams(location.search);
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const fixture = local && document.querySelector('meta[name="axiom-packaged"]')?.content !== '1' && params.get('review') === 'entrance';
  const explicitRoute = !fixture && (Boolean(location.search) || Boolean(location.hash));
  const launch = document.querySelector('meta[name="axiom-launch"]')?.content || 'local-review';
  const key = `axiomEntranceSession:${launch}`;
  let dismissed = false;
  try { dismissed = sessionStorage.getItem(key) === 'OPEN'; } catch (_) {}
  const eligible = location.protocol !== 'file:' && !explicitRoute && !dismissed;
  window.__axiomEntranceSession ||= { phase: eligible ? 'CLOSED' : 'OPEN', eligible, key, fixture };
  if (window.__axiomEntranceSession.eligible) {
    document.documentElement.setAttribute('data-axiom-entrance', 'waiting');
    // A missing controller must never leave an opaque, unusable workspace.
    setTimeout(() => {
      if (!window.AxiomEntrance) document.documentElement.removeAttribute('data-axiom-entrance');
    }, 8000);
  }
})();
