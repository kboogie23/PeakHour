/* Exact local door cue; independent of music transport and export.
   Source: https://www.youtube.com/watch?v=58QSYX1ExKw (Tech Rar).
   Original timing and pitch retained; only playback volume is attenuated. */
(function () {
  'use strict';
  let context = null, timeout = 0, enabled = true, asset = null;
  try { enabled = localStorage.getItem('axiomEntranceSound.v1') !== 'off'; } catch (_) {}
  function sync() {
    const button = document.getElementById('entrance-sound-toggle');
    if (button) { button.setAttribute('aria-pressed', String(enabled));button.textContent = 'Door sound: ' + (enabled ? 'On' : 'Off'); }
  }
  function stop() {
    clearTimeout(timeout);
    const old = context; context = null;
    if (old) old.close().catch(() => {});
  }
  function volumeAllowed() {
    const media = document.getElementById('main-player');
    const volume = Number(document.getElementById('ap-volume')?.value ?? media?.volume ?? 1);
    if (!enabled || document.hidden || !Number.isFinite(volume) || media?.muted || (media && !media.paused) ||
        (typeof nativePlayerState !== 'undefined' && nativePlayerState.playing) || window.AxiomArrangement?.playing) return 0;
    return Math.max(0, Math.min(1, volume));
  }
  function load() {
    if (!asset) asset = fetch('/static/audio/entrance-door.wav').then(response => {
      if (!response.ok) throw new Error('Door cue unavailable');
      return response.arrayBuffer();
    }).catch(() => { asset = null;return null; });
    return asset;
  }
  // Fetch bytes early, but create/resume audio only from the user's Open action.
  load();
  async function play() {
    stop();
    if (!volumeAllowed()) return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    let ctx;
    try {
      ctx = context = new Audio();
      await ctx.resume();
      const bytes = await load();
      if (context !== ctx) return;
      if (!bytes) { stop();return; }
      const buffer = await ctx.decodeAudioData(bytes.slice(0));
      if (context !== ctx) return;
      const volume = volumeAllowed();
      if (!volume) { stop();return; }
      const source = ctx.createBufferSource(), gain = ctx.createGain();
      source.buffer = buffer;
      // Source peak is 0 dBFS: 0.08 caps the cue at about -22 dBFS.
      gain.gain.setValueAtTime(.08 * volume, ctx.currentTime);
      source.connect(gain);gain.connect(ctx.destination);
      source.onended = () => { if (context === ctx) stop(); };
      source.start();
      timeout = setTimeout(() => { if (context === ctx) stop(); }, (buffer.duration + .5) * 1000);
    } catch (_) { if (context === ctx) stop(); }
  }
  document.getElementById('entrance-sound-toggle')?.addEventListener('click', () => {
    enabled = !enabled;
    try { localStorage.setItem('axiomEntranceSound.v1', enabled ? 'on' : 'off'); } catch (_) {}
    if (!enabled) stop();sync();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.addEventListener('pagehide', stop);
  window.AxiomEntranceSound = Object.freeze({ play, stop });sync();
})();
