/* Windows video preview (windows_video_api.py). Music videos Edge can play as they are stream straight from the
   library (no waiting); others are converted first. "Play audio only" sends this track to the normal player, and
   the "Always play audio only" setting (also in Settings) skips the video window for every video track. */
(() => {
  let enabled = false, generation = 0, activeId = null, current = null, dialog, player, title, status, audioOnlyBox;
  const api = '/api/windows/video/';
  const storageKey = 'peakhour.videoAudioOnly';
  let bypass = false;
  const isVideo = path => /\.(mp4|m4v|mov|avi|vob|mpg|mpeg)$/i.test(String(path || ''));
  const audioOnly = () => { try { return localStorage.getItem(storageKey) === '1'; } catch (_) { return false; } };
  function setAudioOnly(on) {
    try { localStorage.setItem(storageKey, on ? '1' : '0'); } catch (_) {}
    document.querySelectorAll('[data-video-audio-only]').forEach(box => { box.checked = on; });
    const toggle = document.getElementById('settings-video-audio-only-toggle');
    if (toggle) toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  // keepalive lets the request finish while the page unloads (the server also expires idle previews)
  async function release(id, tries = 3) {
    if (!id) return;
    for (let attempt = 0; attempt < tries; attempt += 1) {
      try {
        const response = await fetch(api + encodeURIComponent(id), { method: 'DELETE', keepalive: true });
        if (response.ok || response.status === 404) return;
      } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  function clear() {
    generation += 1;
    if (player) { player.pause(); player.removeAttribute('src'); player.load(); }
    const old = activeId; activeId = null; void release(old);
  }
  function playAudio() {
    const track = current;
    if (!track) return;
    dialog.close();
    bypass = true;  // this one call goes to the normal audio player
    try { window.playAudioFile?.(track.path, track.name, track.artist || '', track.bpm, track.camelot, track.energy); }
    finally { bypass = false; }
  }
  function ensureDialog() {
    if (dialog) return;
    dialog = document.createElement('dialog'); dialog.className = 'axiom-windows-video';
    dialog.setAttribute('aria-labelledby', 'axiom-windows-video-title');
    const header = document.createElement('header');
    title = document.createElement('h2'); title.id = 'axiom-windows-video-title';
    const audioButton = document.createElement('button'); audioButton.type = 'button'; audioButton.textContent = 'Play audio only';
    audioButton.addEventListener('click', playAudio);
    const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close';
    close.setAttribute('aria-label', 'Close video preview'); close.addEventListener('click', () => dialog.close());
    header.append(title, audioButton, close);
    status = document.createElement('p'); status.setAttribute('role', 'status');
    player = document.createElement('video'); player.controls = true; player.playsInline = true;
    player.setAttribute('aria-label', 'Video preview');
    const footer = document.createElement('label'); footer.className = 'axiom-windows-video-audio-only';
    audioOnlyBox = document.createElement('input'); audioOnlyBox.type = 'checkbox'; audioOnlyBox.dataset.videoAudioOnly = '';
    audioOnlyBox.addEventListener('change', () => setAudioOnly(audioOnlyBox.checked));
    footer.append(audioOnlyBox, document.createTextNode(' Always play audio only for video tracks (no video window)'));
    dialog.append(header, status, player, footer); document.body.append(dialog);
    dialog.addEventListener('close', clear);
  }
  async function prepare(path, convert, token) {
    const response = await fetch(api + 'prepare', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({path, convert})});
    let data;
    try { data = await response.json(); }
    catch (_) { throw new Error('Video preview service returned an invalid response'); }
    if (!response.ok || !data.success) throw new Error(data.error || 'Video preview could not be prepared');
    if (token !== generation) { await release(data.id); return null; }
    return data;
  }
  async function show(path, convert, token) {
    status.textContent = convert ? 'Converting this video so it can play… this can take a minute.' : 'Loading video…';
    const data = await prepare(path, convert, token);
    if (!data) return;
    const old = activeId; activeId = data.id; if (old) void release(old);
    player.src = api + encodeURIComponent(data.id);
    player.onloadedmetadata = () => { if (token === generation) status.textContent = data.mode === 'direct' ? '' : 'Preview ready'; };
    player.onerror = async () => {
      if (token !== generation) return;
      // The server forgets previews it had to close (idle for hours, or room was needed): say so instead of converting
      try { if ((await fetch(player.src, {headers: {Range: 'bytes=0-0'}})).status === 404) { if (token === generation) status.textContent = 'This preview was closed. Close this window and open the video again.'; return; } } catch (_) {}
      if (token !== generation) return;
      if (data.mode === 'direct') { show(path, true, token).catch(error => { if (token === generation) status.textContent = error.message; }); return; }
      status.textContent = 'Video preview could not be played. Use "Play audio only".';
    };
    player.load();
    try { await player.play(); } catch (_) { if (token === generation && player.readyState) status.textContent = 'Press play to begin.'; }
  }
  async function open(path, name, details = {}) {
    ensureDialog(); clear(); const token = generation;
    current = {path, name, ...details};
    audioOnlyBox.checked = audioOnly();
    title.textContent = name || 'Video preview';
    if (!dialog.open) dialog.showModal();
    try {
      if (typeof stopAxiomAudioPlayback === 'function') await stopAxiomAudioPlayback('video_preview');
      if (token !== generation) return;
      await show(path, false, token);
    } catch (error) { if (token === generation) status.textContent = error.message || 'Video preview failed'; }
  }
  window.addEventListener('pagehide', () => { const id = activeId; activeId = null; if (id) void release(id, 1); });
  window.AxiomWindowsVideoPreview = {isVideo, open, setAudioOnly, audioOnly,
    // audio-player.js sends video tracks here only while this is true
    get enabled() { return enabled && !bypass && !audioOnly(); }};
  document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('settings-video-audio-only-toggle');
    if (toggle) {
      toggle.setAttribute('aria-pressed', audioOnly() ? 'true' : 'false');
      toggle.addEventListener('click', () => { const on = !audioOnly(); setAudioOnly(on); window.showToast?.(on ? 'Video tracks play audio only.' : 'Video tracks open the video preview.'); });
    }
  });
  fetch(api + 'capabilities').then(r => r.ok ? r.json() : null).then(data => { enabled = Boolean(data?.video_preview); }).catch(() => {});
})();
