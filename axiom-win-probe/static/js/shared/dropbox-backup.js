// Direct Dropbox copies with selection, optional read-only music and recoverable restores.
(function () {
  'use strict';
  let flow = '', restorePreview = null, busy = false, poll = null, autoTimer = null;
  let fixtureVerified = false;
  let fixtureBrowser = null, copyPreview = null, catalogData = null;
  const sizeLabel = bytes => bytes >= 1073741824 ? (bytes / 1073741824).toFixed(2) + ' GB' : (bytes / 1048576).toFixed(1) + ' MB';
  const prefKeys = ['axiomTheme', 'axiomStartupWorkflowMode.v1'];
  const pendingKey = 'axiomDropboxRestorePending.v1';
  const node = id => document.getElementById(id);
  const reviewing = () => typeof axiomReviewMode === 'function' && Boolean(axiomReviewMode());
  const reviewingBackup = () => reviewing() && new URLSearchParams(location.search).get('ui_preview') === 'dropbox-backup';
  const emptyVault = () => ({version: 1, active: null, recent: []});
  const vaultKey = () => getAxiomWalkthroughKey('axiomStudioWorkingSet.v1');
  const playlistKey = () => typeof PLAYLISTS_STORAGE_KEY === 'string' ? PLAYLISTS_STORAGE_KEY : 'axiomSavedPlaylists';
  function pendingRestore(value) {
    if (value) localStorage.setItem(pendingKey, '1');
    else localStorage.removeItem(pendingKey);
    window.axiomBackupRestorePending = value;
  }
  function message(text, error = false) {
    const el = node('dropbox-message');
    if (el) { el.textContent = text; el.dataset.error = String(error); }
  }
  async function api(action, body, timeoutMs = 0) {
    const controller = timeoutMs ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetch('/api/dropbox/' + action, {signal: controller?.signal,
        headers: {'Content-Type': 'application/json', ...(reviewing() ? {'X-AXIOM-UI-Review': '1'} : {})}, ...(body === undefined ? {} : {
        method: 'POST', body: JSON.stringify(body)
      })});
      const data = await response.json();
      if (!response.ok || data.success !== true) throw new Error(data.error || 'Dropbox backup could not finish.');
      return data;
    } finally { if (timeout) clearTimeout(timeout); }
  }
  function capture() {
    if (reviewing() && (!reviewingBackup() || !fixtureVerified)) throw new Error('Backups are disabled in this review.');
    if (reviewingBackup()) return fixtureBrowser || {playlists: [], working_set: emptyVault(), preferences: {}};
    const working = window.AxiomStudioAutosave?.exportBackup();
    if (!working) throw new Error('Wait for Studio recovery to finish before backing up.');
    return {playlists: JSON.parse(localStorage.getItem(playlistKey()) || '[]'), working_set: working,
      preferences: Object.fromEntries(prefKeys.map(k => [k, localStorage.getItem(k)]))};
  }
  function storageValues(data) {
    return {[playlistKey()]: JSON.stringify(data.playlists), [vaultKey()]: JSON.stringify(data.working_set),
      ...Object.fromEntries(prefKeys.map(k => [k, data.preferences[k] ?? null]))};
  }
  function writeBrowser(data) {
    const values = storageValues(data);
    const before = Object.fromEntries(Object.keys(values).map(k => [k, localStorage.getItem(k)]));
    const write = snapshot => Object.entries(snapshot).forEach(([k, value]) => {
      if (value === null) localStorage.removeItem(k); else localStorage.setItem(k, value);
      if (localStorage.getItem(k) !== value) throw new Error('The restored app data could not be verified.');
    });
    try { write(values); } catch (error) { write(before); throw error; }
  }
  async function finishPendingRestore() {
    if (reviewing() && (!reviewingBackup() || !fixtureVerified)) return true;
    window.axiomBackupRestorePending = localStorage.getItem(pendingKey) === '1';
    try {
      const {restore} = await api('pending', undefined, 4000);
      if (!restore) { pendingRestore(false); return true; }
      pendingRestore(true);
      if (restore.waiting) throw new Error('Music is still being restored. Retry recovery when the transfer finishes.');
      try {
        writeBrowser(restore.browser);
        await api('finish-restore', {id: restore.id, browser: restore.browser});
      } catch (error) {
        if (!restore.rolled_back) {
          const rollback = await api('finish-restore', {id: restore.id, browser: restore.browser, rollback: true});
          writeBrowser(rollback.browser);
          await api('finish-restore', {id: restore.id, browser: rollback.browser});
        }
        throw error;
      }
      pendingRestore(false);
      return true;
    } catch (error) {
      // Do not initialize autosave over an unresolved partial restore.
      if (window.axiomBackupRestorePending) {
        window.showToast?.('Backup restore needs attention. Your recovery copy is safe. Reopen AXIOM to retry.', true);
        node('dropbox-retry-restore').hidden = false;
        if (!node('dropbox-dialog').open) node('dropbox-dialog').showModal();
        message('Restore is paused. Retry to finish recovery before editing your library.', true);
        return false;
      }
      return true; // Unconfigured/offline Dropbox must never block ordinary startup.
    }
  }
  function controls(disabled) {
    busy = disabled;
    node('dropbox-dialog')?.querySelectorAll('button[data-action],input,select').forEach(el => { el.disabled = disabled; });
  }
  async function refresh() {
    const data = await api('status');
    fixtureVerified = data.review_fixture === true;
    fixtureBrowser = fixtureVerified ? data.review_browser || null : null;
    node('dropbox-connection').textContent = data.connected ? 'Dropbox connected' : data.configured ? 'Dropbox not connected' : 'Dropbox sign-in setup pending';
    node('dropbox-connect').hidden = data.connected;
    node('dropbox-connect').disabled = !data.configured || busy;
    node('dropbox-disconnect').hidden = !data.connected;
    node('dropbox-backup-now').disabled = !data.connected || busy;
    node('dropbox-history-refresh').disabled = !data.connected || busy;
    node('dropbox-daily').disabled = !data.connected || busy;
    node('dropbox-daily').checked = Boolean(data.daily);
    node('dropbox-last-backup').textContent = data.last_backup ? 'Last verified backup: ' + new Date(data.last_backup.at).toLocaleString() : 'No verified Dropbox backup yet.';
    if (!data.configured) message('Direct Dropbox sign-in will be available after AXIOM’s Dropbox app is configured.');
    if (data.job.state === 'failed') message(data.job.message, true);
    if (data.job.state === 'running') { controls(true); message(data.job.message); schedulePoll(); }
    return data;
  }
  function selection() {
    const mode = node('dropbox-scope').value;
    return {mode, include_music: node('dropbox-include-music').checked,
      ids: Array.from(node('dropbox-playlist-choices').querySelectorAll('input:checked')).map(el => el.value),
      folder: JSON.parse(node('dropbox-folder').value || '[]')};
  }
  function selectionChanged() {
    copyPreview = null;
    node('dropbox-copy-preview').hidden = true;
    const mode = node('dropbox-scope').value;
    node('dropbox-playlist-choices').hidden = mode !== 'playlists';
    node('dropbox-folder-choice').hidden = mode !== 'folder';
    if (!catalogData) return;
    const choice = selection();
    const chosen = catalogData.playlists.filter(p => mode === 'library' ||
      (mode === 'playlists' ? choice.ids.includes(String(p.id)) : choice.folder.length && choice.folder.every((part, i) => p.folder[i] === part)));
    node('dropbox-selection-summary').textContent = mode === 'library'
      ? `${catalogData.library_tracks.toLocaleString()} library tracks, ${chosen.length} saved playlists, settings and unfinished sets.`
      : `${chosen.length} playlist${chosen.length === 1 ? '' : 's'} selected. Names, subfolders and track order will be preserved.`;
  }
  async function loadCatalog() {
    catalogData = await api('catalog', {browser: capture()});
    const container = node('dropbox-playlist-choices'); container.replaceChildren();
    for (const p of catalogData.playlists) {
      const label = document.createElement('label'), input = document.createElement('input');
      input.type = 'checkbox'; input.value = String(p.id); input.onchange = selectionChanged;
      const name = document.createElement('span'); name.textContent = p.name;
      const detail = document.createElement('small'); detail.textContent = (p.folder.length ? p.folder.join(' / ') + ' · ' : '') + p.tracks + (p.tracks === 1 ? ' track' : ' tracks');
      label.append(input, name, detail); container.append(label);
    }
    if (!catalogData.playlists.length) container.textContent = 'Save a playlist in AXIOM to copy it here.';
    const folder = node('dropbox-folder'); folder.replaceChildren();
    const empty = document.createElement('option'); empty.value = '[]'; empty.textContent = 'Choose a folder'; folder.append(empty);
    for (const parts of catalogData.folders) {
      const option = document.createElement('option'); option.value = JSON.stringify(parts); option.textContent = parts.join(' / '); folder.append(option);
    }
    selectionChanged();
  }
  function schedulePoll() {
    clearTimeout(poll);
    poll = setTimeout(async () => {
      try {
        const data = await api('status'); message(data.job.message, data.job.state === 'failed');
        if (data.job.state === 'running') schedulePoll();
        else { controls(false); await refresh(); if (data.job.state === 'complete') await history(); }
      } catch (error) { controls(false); message(error.message, true); }
    }, 1500);
  }
  async function history() {
    const data = await api('history'), container = node('dropbox-history');
    container.replaceChildren();
    if (!data.backups.length) { container.textContent = 'No backups in your AXIOM Dropbox folder yet.'; return; }
    for (const backup of data.backups) {
      const row = document.createElement('div'); row.className = 'dropbox-history-row';
      const text = document.createElement('span');
      text.textContent = (backup.label || 'AXIOM backup') + ' · ' + new Date(backup.modified).toLocaleString() +
        (backup.music_files ? ' · ' + backup.music_files + ' music files (' + sizeLabel(backup.music_bytes) + ')' : ' · Preview contents');
      text.title = backup.name;
      const button = document.createElement('button'); button.type = 'button'; button.dataset.action = 'preview';
      button.textContent = 'Preview Restore'; button.onclick = () => action('preview', backup.name);
      row.append(text, button); container.append(row);
    }
  }
  async function action(kind, value) {
    if (busy) return;
    clearTimeout(poll); poll = null;
    controls(true);
    try {
      if (kind === 'connect') {
        const result = await api('connect', {}); flow = result.flow;
        node('dropbox-code-step').hidden = false;
        openAxiomExternalUrl(result.url, 'Dropbox sign-in');
        message('Approve AXIOM on Dropbox, then paste the connection code below.');
      } else if (kind === 'finish-connect') {
        const code = node('dropbox-code').value; node('dropbox-code').value = '';
        await api('finish-connect', {flow, code}); flow = '';
        node('dropbox-code-step').hidden = true; message('Dropbox connected. Choose Back Up Now to upload your first backup.');
        await history();
      } else if (kind === 'disconnect') {
        await api('disconnect', {}); flow = ''; restorePreview = null;
        node('dropbox-preview').hidden = true; node('dropbox-history').replaceChildren();
        message('Dropbox disconnected. Existing backups remain in Dropbox.');
      } else if (kind === 'schedule') {
        await api('schedule', {daily: node('dropbox-daily').checked});
        message('Schedule saved. Daily library-information backups run while AXIOM is open, without music files.');
      } else if (kind === 'plan-copy') {
        message('Checking your selection and music availability...');
        copyPreview = await api('preview-copy', {browser: capture(), selection: selection()});
        node('dropbox-copy-preview-text').textContent = `${copyPreview.label}: ${copyPreview.playlists} playlist${copyPreview.playlists === 1 ? '' : 's'} and ${copyPreview.tracks} unique track${copyPreview.tracks === 1 ? '' : 's'}. ` +
          (copyPreview.include_music ? `${copyPreview.music_files} music files (${sizeLabel(copyPreview.music_bytes)}) will be copied to Dropbox. ` : 'Library and playlist information only; music files are not included. ') +
          (copyPreview.missing ? `${copyPreview.missing} files are missing, unsupported or outside your connected library. Reconnect them or turn off Include music files.` : 'A dated copy will be kept; previous backups stay available.');
        node('dropbox-copy-preview').hidden = false;
        message(copyPreview.missing ? 'Resolve unavailable music before copying.' : 'Review your copy, then choose Copy to Dropbox.', Boolean(copyPreview.missing));
      } else if (kind === 'backup') {
        if (!copyPreview || copyPreview.missing) throw new Error('Preview a valid selection before copying.');
        message('Preparing your AXIOM backup...');
        await api('backup', {browser: capture(), copy_token: copyPreview.token});
        copyPreview = null; node('dropbox-copy-preview').hidden = true;
        schedulePoll(); return;
      } else if (kind === 'history') {
        await history();
      } else if (kind === 'preview') {
        message('Downloading and checking this backup...');
        restorePreview = await api('preview', {name: value, browser: capture()});
        node('dropbox-preview-copy').textContent = `${restorePreview.label || 'AXIOM backup'}: ${restorePreview.playlists} saved playlist${restorePreview.playlists === 1 ? '' : 's'}, ${restorePreview.tracks} library track${restorePreview.tracks === 1 ? '' : 's'} and ${restorePreview.working_tracks} Working Set track${restorePreview.working_tracks === 1 ? '' : 's'}. ${restorePreview.replaces} ` +
          (restorePreview.portable ? `${restorePreview.music_files} music files will download (${sizeLabel(restorePreview.music_bytes)}).` : `Unavailable music paths: ${restorePreview.missing_tracks}. Reconnect the matching music folders after restoring.`);
        node('dropbox-preview').hidden = false; message('Review the contents before restoring.');
      } else if (kind === 'restore') {
        if (!restorePreview) throw new Error('Preview a backup first.');
        const browser = capture();
        pendingRestore(true);
        message('Keeping a recovery copy and restoring your AXIOM backup...');
        const restorePoll = setInterval(async () => {
          try { const status = await api('status'); if (status.job.kind === 'restore') message(status.job.message, status.job.state === 'failed'); } catch (_) {}
        }, 1500);
        try {
          await api('restore', {token: restorePreview.token, browser, confirm: 'RESTORE AXIOM BACKUP'});
          if (await finishPendingRestore()) { location.reload(); return; }
        } catch (error) {
          // The server may have completed a request whose response was lost.
          const pending = await api('pending');
          if (!pending.restore) pendingRestore(false);
          throw error;
        } finally { clearInterval(restorePoll); }
      } else if (kind === 'retry-restore') {
        if (await finishPendingRestore()) location.reload();
      }
    } catch (error) { message(error.message, true); }
    finally {
      if (kind !== 'backup' || !poll) { controls(false); try { await refresh(); } catch (_) {} }
      if (node('dropbox-confirm-copy')) node('dropbox-confirm-copy').disabled = busy || !copyPreview || Boolean(copyPreview.missing);
    }
  }
  async function open() {
    const dialog = node('dropbox-dialog');
    if (!dialog.open) dialog.showModal();
    try { const data = await refresh(); await loadCatalog(); if (data.connected) await history(); }
    catch (error) { message(error.message, true); }
  }
  async function automaticBackup() {
    if (reviewing() || busy || window.axiomBackupRestorePending) return;
    try {
      const status = await api('status');
      if (!status.connected || !status.daily || status.job.state === 'running') return;
      await api('backup', {browser: capture(), automatic: true});
    } catch (_) { /* Status retains failures; do not interrupt a performance. */ }
  }
  function close() {
    if (window.axiomBackupRestorePending) { message('Finish recovery before returning to your library.', true); return; }
    node('dropbox-dialog').close();
  }
  window.AxiomDropbox = {open, close, action, finishPendingRestore, capture, selectionChanged};
  document.addEventListener('DOMContentLoaded', () => {
    node('dropbox-dialog')?.addEventListener('cancel', event => {
      if (window.axiomBackupRestorePending) event.preventDefault();
    });
    if (reviewingBackup()) setTimeout(open, 400);
    autoTimer = setInterval(automaticBackup, 60 * 60 * 1000);
    setTimeout(automaticBackup, 30000);
  });
})();
