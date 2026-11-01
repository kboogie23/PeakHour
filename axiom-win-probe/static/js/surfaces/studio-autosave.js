// Recovery for Studio's Working Set; separate from named Playlists and DAW drafts.
(function () {
  'use strict';
  const BASE_KEY = 'axiomStudioWorkingSet.v1';
  const params = new URLSearchParams(window.location.search);
  const review = ['127.0.0.1', 'localhost'].includes(window.location.hostname)
    && params.get('review') === 'studio-active' && params.get('studio_autosave_review') === '1';
  let ready = false, restoring = false, failed = false, storageKey = '', signature = '', currentId = '';
  let vault = { version: 1, active: null, recent: [] };
  const copy = value => JSON.parse(JSON.stringify(value));
  const meaningful = workspace => workspace.tracks.length || workspace.route.length || workspace.dots.length;
  const allowed = () => review || params.get('entry') !== 'guest-preview' && window.AXIOM_ACCESS_CONTEXT?.mode !== 'guest'
    && !(typeof axiomReviewMode === 'function' && axiomReviewMode()) && !(typeof axiomUiPreviewMode === 'function' && axiomUiPreviewMode());

  function tracks(list) {
    return (Array.isArray(list) ? list : []).map(track => {
      const stable = typeof stableBrowserTrackForSave === 'function' ? stableBrowserTrackForSave(track) : { ...track };
      delete stable.browser_file;
      return stable;
    });
  }
  function snapshot() {
    return copy({ tracks: tracks(currentPlaylist), route: tracks(currentRoutePlaylist), brief: currentSetBrief,
      view: activeStudioView === 'route' ? 'route' : 'manual', editingId: editingPlaylistId,
      dots: graphDots, anchor: anchorTargetDot, anchorIndex: graphAnchorIndex,
      modifiers: activeModifiers, controls: Object.fromEntries(['set-length-selector', 'avg-duration-selector', 'blueprint-start-bpm', 'blueprint-end-bpm']
        .map(id => [id, document.getElementById(id)?.value || ''])) });
  }
  function valid(record) {
    const w = record?.workspace;
    return Boolean(record && typeof record.id === 'string' && typeof record.updatedAt === 'string'
      && w && Array.isArray(w.tracks) && Array.isArray(w.route) && Array.isArray(w.dots)
      && [...w.tracks, ...w.route].every(t => t && typeof t === 'object') && w.brief && typeof w.brief === 'object');
  }
  function status(message = '', error = false) {
    const label = document.getElementById('studio-autosave-status');
    if (label) {
      label.textContent = message;
      label.hidden = !message;
      label.dataset.state = error ? 'failed' : 'saved';
      label.title = error ? 'Use Save Set or Backup Set before quitting AXIOM.' : 'Your Working Set is kept on this Mac and restored when AXIOM reopens.';
    }
    const resume = document.getElementById('studio-resume-set-btn');
    if (resume) {
      const record = vault.active || vault.recent[0];
      resume.hidden = !record;
      resume.textContent = record ? `Resume Last Set (${record.workspace.tracks.length || record.workspace.route.length} tracks)` : 'Resume Last Set';
    }
  }
  function storageFailure() {
    status('Autosave failed — use Save Set or Backup Set', true);
    if (!failed) window.showToast?.('Studio could not autosave. Use Save Set or Backup Set before quitting AXIOM.', true);
    failed = true;
    return false;
  }
  function persist(next) {
    const text = JSON.stringify(next);
    localStorage.setItem(storageKey, text);
    if (localStorage.getItem(storageKey) !== text) throw new Error('Studio draft read-back failed.');
    vault = next;
    failed = false;
  }
  function checkpoint() {
    if (window.axiomBackupRestorePending) return false;
    if (!ready) return !failed;
    if (restoring || !allowed()) return true;
    try {
      const workspace = snapshot(), nextSignature = JSON.stringify(workspace);
      if (signature === nextSignature && !failed) return true;
      const active = meaningful(workspace) ? { id: currentId || `studio-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        updatedAt: new Date().toISOString(), workspace } : null;
      persist({ ...vault, active });
      currentId = active?.id || '';
      signature = nextSignature;
      status(active ? 'Autosaved on this Mac' : '');
      return true;
    } catch (_) { return storageFailure(); }
  }
  function archiveCurrent() {
    if (!ready) return !failed;
    if (!allowed()) return true;
    if (!checkpoint()) return false;
    if (!vault.active) return true;
    try {
      const recent = [vault.active, ...vault.recent.filter(item => item.id !== vault.active.id)].slice(0, 10);
      persist({ ...vault, active: null, recent });
      currentId = ''; signature = '';
      status();
      return true;
    } catch (_) { return storageFailure(); }
  }
  function apply(record) {
    restoring = true;
    try {
      const w = copy(record.workspace);
      currentPlaylist = w.tracks;
      currentRoutePlaylist = w.route;
      currentSetBrief = normalizeSetBrief(w.brief);
      activeStudioView = w.view === 'route' && w.route.length ? 'route' : 'manual';
      editingPlaylistId = savedPlaylists.some(set => set.id === w.editingId) ? w.editingId : null;
      graphDots = w.dots;
      anchorTargetDot = w.anchor || null;
      graphAnchorIndex = Number.isInteger(w.anchorIndex) ? w.anchorIndex : -1;
      currentAnchorTrack = (activeStudioView === 'route' ? currentRoutePlaylist : currentPlaylist)[graphAnchorIndex] || null;
      activeModifiers = w.modifiers || {};
      currentId = record.id;
      signature = '';
      // Restoring the saved data must not depend on a display helper succeeding.
      let displayReady = true;
      try {
        applySetBriefToStudioControls();
        if (typeof updateGraphTimeline === 'function') updateGraphTimeline();
      } catch (error) {
        displayReady = false;
        console.error('Studio recovery display failed; saved set retained.', error);
        window.showToast?.('Your saved set was recovered, but its display could not finish loading. Open Studio to continue.', true);
      }
      for (const [id, value] of Object.entries(w.controls || {})) {
        const input = document.getElementById(id);
        if (input && value) input.value = value;
      }
      return displayReady;
    } finally { restoring = false; }
  }
  function initialize() {
    if (ready || !allowed()) return;
    storageKey = review ? `${BASE_KEY}.review` : getAxiomWalkthroughKey(BASE_KEY);
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const stored = JSON.parse(raw);
        if (stored.version !== 1 || !Array.isArray(stored.recent) || stored.active && !valid(stored.active)
          || !stored.recent.every(valid)) throw new Error('Invalid Studio recovery data.');
        vault = stored;
      }
      let displayReady = true;
      if (vault.active && meaningful(vault.active.workspace)) displayReady = apply(vault.active);
      ready = true;
      status(vault.active ? (displayReady ? 'Autosaved set restored' : 'Saved set recovered; display needs attention') : '');
    } catch (_) { storageFailure(); }
  }
  function hasWorkingSet() {
    return ready && Boolean(meaningful(snapshot()));
  }
  function resume(id = '') {
    const record = id ? [vault.active, ...vault.recent].find(item => item?.id === id) : vault.active || vault.recent[0];
    if (!record || !allowed()) return;
    if (record.id !== currentId && !archiveCurrent()) return;
    const displayReady = apply(record);
    vault = { ...vault, recent: vault.recent.filter(item => item.id !== record.id) };
    checkpoint();
    document.getElementById('studio-recovery-dialog')?.close();
    showStudioWorkspace();
    initSortable();
    recalculateAudit();
    if (displayReady) window.showToast?.('Your unfinished Studio set is restored.');
  }
  function openRecovery() {
    if (!checkpoint()) return;
    const records = [vault.active, ...vault.recent].filter(Boolean);
    if (!records.length) { window.showToast?.('No Studio recovery sets yet.'); return; }
    let dialog = document.getElementById('studio-recovery-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'studio-recovery-dialog';
      dialog.setAttribute('aria-label', 'Recover a Studio set');
      dialog.style.cssText = 'background:#0c1018;color:#ffffff;-webkit-text-fill-color:#ffffff;border:1px solid #495164;border-radius:12px;padding:24px;width:min(560px,90vw);max-height:80vh;overflow:auto';
      document.body.appendChild(dialog);
    }
    dialog.innerHTML = `<h2 style="font-size:22px;font-weight:800">Recover a Studio Set</h2>
      <p style="margin:8px 0 20px">AXIOM keeps your current Working Set and the last 10 sets you close or replace.</p>
      ${records.map(record => `<div style="border-top:1px solid #495164;padding:14px 0;display:flex;align-items:center;justify-content:space-between;gap:16px">
        <div style="min-width:0;word-break:break-word"><strong>${escapeHtml(savedPlaylists.find(set => set.id === record.workspace.editingId)?.name || record.workspace.tracks[0]?.title || record.workspace.route[0]?.title || 'Untitled Set')}</strong><br>
        <small>${record.workspace.tracks.length || record.workspace.route.length} tracks · ${escapeHtml(new Date(record.updatedAt).toLocaleString())}</small></div>
        <button type="button" style="flex-shrink:0;background:#a3ff00!important;color:#071005!important;-webkit-text-fill-color:#071005!important;padding:8px 14px;border-radius:6px;font-weight:800" onclick="window.AxiomStudioAutosave.resume('${escapeJs(record.id)}')">Resume</button>
      </div>`).join('')}
      <button type="button" style="background:#202634!important;color:#ffffff!important;-webkit-text-fill-color:#ffffff!important;padding:8px 14px;border-radius:6px" onclick="this.closest('dialog').close()">Close</button>`;
    dialog.showModal();
  }

  // Save on the central renderer immediately, before any asynchronous scoring.
  // The timer and focus/lifecycle hooks also catch brief, graph and native handoffs.
  const render = renderPlaylist;
  renderPlaylist = function (...args) { checkpoint(); return render.apply(this, args); };
  window.addEventListener('blur', checkpoint);
  window.addEventListener('pagehide', checkpoint);
  window.addEventListener('beforeunload', event => {
    if (window.axiomBackupRestorePending) return;
    if (!checkpoint()) { event.preventDefault(); event.returnValue = ''; }
  });
  document.addEventListener('visibilitychange', checkpoint);
  document.addEventListener('change', checkpoint);
  window.setInterval(checkpoint, 2000);
  window.AxiomStudioAutosave = { initialize, checkpoint, archiveCurrent, hasWorkingSet, resume, openRecovery,
    exportBackup: () => {
      if (!ready || !allowed() || !checkpoint()) throw new Error('Studio recovery is not ready for backup.');
      return copy(vault);
    },
    prepareToQuit: () => !meaningful(snapshot()) || checkpoint(),
    get hasRecovery() { return ready && Boolean(vault.active || vault.recent.length); } };
})();
