/* Windows video preview (windows_video_api.py). Music videos Edge can play as they are stream straight from the
   library (no waiting); others are converted first. "Play audio only" sends this track to the normal player, and
   the "Always play audio only" setting (also in Settings) skips the video window for every video track. */
(() => {
  let enabled = false, generation = 0, activeId = null, current = null, dialog, player, title, status, audioOnlyBox;
  const api = '/api/windows/video/';
  const storageKey = 'peakhour.videoAudioOnly';
  let bypass = false, swapped = -1, forcedMute = false, userMuted = false;
  let showSeq = 0, startedOnce = false, promptState = '', playPending = false, wantUnmute = false;  // promptState: '' | 'play' | 'sound'
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
    generation += 1; promptState = ''; wantUnmute = false; playPending = false;
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
    // while the start is forced silent, a click on the unmute button is the user's choice: keep it
    player.addEventListener('volumechange', () => {
      if (forcedMute && !player.muted) { forcedMute = false; userMuted = false; }
      if (promptState === 'sound' && !player.muted) { promptState = ''; status.textContent = ''; }
    });
    player.addEventListener('click', () => { if (promptState) userStart(); });
    dialog.addEventListener('keydown', event => { if (event.key === ' ' && promptState && userStart()) event.preventDefault(); });
    const footer = document.createElement('label'); footer.className = 'axiom-windows-video-audio-only';
    audioOnlyBox = document.createElement('input'); audioOnlyBox.type = 'checkbox'; audioOnlyBox.dataset.videoAudioOnly = '';
    audioOnlyBox.addEventListener('change', () => setAudioOnly(audioOnlyBox.checked));
    footer.append(audioOnlyBox, document.createTextNode(' Always play audio only for video tracks (no video window)'));
    dialog.append(header, status, player, footer); document.body.append(dialog);
    dialog.addEventListener('close', clear);
  }
  // fast: an MP4/M4V/MOV starts at once from the library file (no inspection first); checkPlan() looks at it afterwards
  async function prepare(path, convert, token, fast = false) {
    const response = await fetch(api + 'prepare', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({path, convert, fast})});
    let data;
    try { data = await response.json(); }
    catch (_) { throw new Error('Video preview service returned an invalid response'); }
    if (!response.ok || !data.success) throw new Error(data.error || 'Video preview could not be prepared');
    if (token !== generation) { await release(data.id); return null; }
    return data;
  }
  // A quickly started direct preview was not inspected: if the file needs a copy or conversion (other sound, HEVC, 10-bit),
  // swap to the prepared version. Runs beside playback, so the first picture never waits for it.
  async function checkPlan(path, data, token) {
    try {
      const response = await fetch(api + encodeURIComponent(data.id) + '/plan');
      if (token !== generation || !response.ok) return;
      const plan = await response.json();
      if (token !== generation || !plan.success || plan.plan === 'direct') return;
      // 'copy' (sound Edge cannot play as it is) and unplayable sound swap at once. Otherwise ('convert': HEVC, 10-bit...)
      // Edge may decode it as it is, so let it try, but watch that a picture really appears (watchPicture).
      if (plan.plan === 'copy' || plan.audio_ok === false) swap(path, plan.plan === 'convert', token);
      else void watchPicture(path, data, token);
    } catch (_) { /* Edge decides: the player's own error handler still converts a file it cannot play */ }
  }
  // Without a decoder Edge often drops the video track and plays only the sound: no error, a black box. Convert then.
  async function watchPicture(path, data, token) {
    for (let i = 0; i < 40; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 250));
      if (token !== generation || activeId !== data.id) return;
      if (player.readyState < 1) continue;
      if (player.videoWidth === 0) { swap(path, true, token); return; }
      if (player.currentTime >= 1 && !player.paused) {
        const quality = player.getVideoPlaybackQuality ? player.getVideoPlaybackQuality() : null;
        if (quality && quality.totalVideoFrames === 0) swap(path, true, token);
        return;  // frames are advancing: Edge is decoding this file itself
      }
    }
  }
  // One swap (copy/conversion) per open: the error handler and the plan check can both want one. It continues where the
  // first picture stopped and says what it is doing, never a silent black box.
  function swap(path, convert, token) {
    if (swapped === token || token !== generation) return;
    swapped = token;
    const resume = player.currentTime || 0;
    try { player.pause(); } catch (_) {}
    show(path, convert, token, false, resume).catch(error => { if (token === generation) status.textContent = error.message; });
  }
  async function show(path, convert, token, fast = !convert, resume = 0) {
    status.textContent = convert ? 'Converting this video so it can play… this can take a minute.' : fast ? 'Loading video…' : 'Preparing this video…';
    const data = await prepare(path, convert, token, fast);
    if (!data) return;
    const old = activeId; activeId = data.id; if (old) void release(old);
    let retried = false;
    player.src = api + encodeURIComponent(data.id);
    const mine = ++showSeq; startedOnce = false; promptState = '';
    player.onloadedmetadata = () => {
      if (token !== generation) return;
      if (!promptState) status.textContent = data.mode === 'direct' ? '' : 'Preview ready';  // never blank a "Press play" / "Click for sound"
      if (resume > 0 && (!player.duration || resume < player.duration - 1)) player.currentTime = resume;
      setTimeout(() => { if (mine === showSeq) checkStart(token); }, 1000);
    };
    player.onwaiting = () => { if (token === generation && !player.paused && player.readyState < 3) status.textContent = 'Buffering…'; };
    player.onplaying = () => {
      if (token !== generation) return;
      startedOnce = true;
      if (promptState !== 'sound') { promptState = ''; status.textContent = ''; }
    };
    player.onerror = async () => {
      if (token !== generation) return;
      // A dropped connection (busy server, drive waking up) is retried once where it stopped before any conversion
      if (data.mode === 'direct' && !retried && player.error && player.error.code === 2) {
        retried = true; const resume = player.currentTime || 0; status.textContent = 'Reconnecting…';
        player.addEventListener('loadedmetadata', () => { if (resume > 0) player.currentTime = resume; }, {once: true});
        player.load(); player.play().catch(() => {}); return;
      }
      // The server forgets previews it had to close (idle for hours, or room was needed): say so instead of converting
      try { if ((await fetch(player.src, {headers: {Range: 'bytes=0-0'}})).status === 404) { if (token === generation) status.textContent = 'This preview was closed. Close this window and open the video again.'; return; } } catch (_) {}
      if (token !== generation) return;
      if (data.mode === 'direct') { swap(path, true, token); return; }
      status.textContent = 'Video preview could not be played. Use "Play audio only".';
    };
    player.load();
    if (data.verified === false) void checkPlan(path, data, token);
    playPending = true;
    try { await player.play(); } catch (_) { /* judged by the player's state below, not by the exception */ }
    playPending = false;
    // A newer show() (swap) or a new open replaced this one: only then is an AbortError "replaced". Otherwise a paused
    // player with data is a refused or aborted start, and it says so.
    if (token !== generation || mine !== showSeq) return;
    if (wantUnmute) { wantUnmute = false; void restoreSound(token); }
    checkStart(token);
  }
  // State-based: still paused, never played, has data -> tell the user how to start it
  function checkStart(token) {
    if (token !== generation || promptState) return;
    if (player.paused && !player.ended && !startedOnce && player.readyState >= 2) { promptState = 'play'; status.textContent = 'Press play to begin.'; }
  }
  // Give the user's own mute setting back. Never while play() is still pending (Edge aborts a pending start on unmute).
  // If Edge refuses sound without a click and pauses the picture, keep it playing muted and ask for a click.
  async function restoreSound(token) {
    if (!forcedMute) return;
    forcedMute = false; player.muted = userMuted;
    if (userMuted) return;
    await new Promise(resolve => setTimeout(resolve, 300));
    if (token !== generation || promptState === 'play') return;
    if (player.paused && !player.ended && player.readyState >= 2) {
      player.muted = true; promptState = 'sound'; status.textContent = 'Click for sound';
      try { await player.play(); } catch (_) { promptState = ''; checkStart(token); }
    }
  }
  // A click on the picture or Space starts it (or gives it sound) when the browser wanted a click first
  function userStart() {
    if (!promptState) return false;
    const wasSound = promptState === 'sound';
    promptState = ''; status.textContent = '';
    forcedMute = false; player.muted = userMuted;
    const go = () => { if (player.paused) player.play().catch(() => {}); };
    go(); if (wasSound) setTimeout(go, 150);  // the player's own click may pause it once more
    return true;
  }
  async function open(path, name, details = {}) {
    ensureDialog(); clear(); const token = generation;
    current = {path, name, ...details};
    audioOnlyBox.checked = audioOnly();
    title.textContent = name || 'Video preview';
    if (!dialog.open) dialog.showModal();
    try {
      // Stopping the sound player goes through its command queue and a busy server: the picture starts at once but muted,
      // and gets its sound when the stop has settled (or after 1.5 s), so the two never overlap for long.
      // The player is forced silent for a moment, then goes back to the user's own mute setting (not simply to unmuted)
      const unmute = () => { if (!forcedMute) return; if (playPending) { wantUnmute = true; return; } void restoreSound(token); };
      if (!forcedMute) userMuted = player.muted;
      forcedMute = true; player.muted = true;
      let stopped = Promise.resolve();
      try { if (typeof stopAxiomAudioPlayback === 'function') stopped = Promise.resolve(stopAxiomAudioPlayback('video_preview')).catch(() => {}); } catch (_) {}
      void stopped.then(unmute); setTimeout(unmute, 1500);
      playPending = true;  // nothing is unmuted before the first play() has settled
      await show(path, false, token);
    } catch (error) { if (token === generation) { playPending = false; status.textContent = error.message || 'Video preview failed'; if (forcedMute) { forcedMute = false; player.muted = userMuted; } } }
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
