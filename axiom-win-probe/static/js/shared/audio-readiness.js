/* One read-only full-source check shared by Health and Studio set intake. */
(function () {
  'use strict';
  function localReviewAudioReadyBypassEnabled() {
    try {
      const params = new URLSearchParams(window.location?.search || '');
      const host = window.location?.hostname || '';
      return params.has('review') && params.get('daw_audio_ready') === '1' && (host === '127.0.0.1' || host === 'localhost');
    } catch (error) {
      return false;
    }
  }

  function reviewReadyTrack(track) {
    const duration = Number(track?.durationSec || track?.duration_sec || track?.duration || 180);
    return {
      ...track,
      durationSec: Number.isFinite(duration) && duration > 0 ? duration : 180,
      duration_sec: Number.isFinite(duration) && duration > 0 ? duration : 180,
      duration: Number.isFinite(duration) && duration > 0 ? duration : 180,
    };
  }

  async function check(tracks, { current = () => true, progress = () => {} } = {}) {
    const unique = [...new Map(tracks.map(t => [t.path || '', t])).values()];
    const results = new Map();
    for (let start = 0; start < unique.length; start += 16) {
      let waiting = unique.slice(start, start + 16);
      for (const track of waiting.filter(t => !t.path)) results.set('', { path: '', status: 'missing', reason: 'No local file linked. Reconnect this song first.' });
      waiting = waiting.filter(t => t.path);
      while (waiting.length) {
        if (!current()) throw new Error('Audio check stopped. Completed checks will be reused.');
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
        let data;
        try {
          const endpoint = typeof isAxiomLite === 'function' && isAxiomLite()
            ? '/api/library/audio/check' : '/api/studio-daw/assets/check';
          const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths: waiting.map(t => t.path), metadataOnly: true, verifyDecoded: true }), signal: controller.signal });
          data = await response.json();
          if (!response.ok || !Array.isArray(data.assets)) throw new Error(data.error || 'Audio verification is unavailable. Try again.');
        } finally { clearTimeout(timer); }
        if (!current()) throw new Error('Audio check stopped. Completed checks will be reused.');
        for (const track of waiting) {
          const asset = data.assets.find(a => a.path === track.path);
          if (asset?.status === 'pending') continue;
          results.set(track.path, asset?.status === 'ready' && asset.decodedEOF === true && Number.isFinite(asset.durationSec) && asset.durationSec > 0
            ? asset : { path: track.path, status: 'unavailable', reason: asset?.reason || (asset?.status === 'missing' ? 'File not found. Reconnect its folder.' : 'Full audio verification did not complete. Retry or check file access.') });
        }
        waiting = waiting.filter(t => !results.has(t.path));
        progress({ checked: results.size, total: unique.length, ready: [...results.values()].filter(a => a.status === 'ready').length, track: waiting[0], frames: data.assets.find(a => a.path === waiting[0]?.path)?.decodedFrames || 0 });
        if (waiting.length) await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
    return tracks.map(track => ({ ...track, audioCheck: results.get(track.path || '') }));
  }
  let active = null;
  async function review(tracks, { forMixtape = false, destination = 'DAW' } = {}) {
    if (forMixtape && localReviewAudioReadyBypassEnabled()) return tracks.map(reviewReadyTrack);
    if (active) return null;
    const owner = {};
    active = owner;
    const dialog = document.createElement('dialog');
    dialog.className = 'axiom-audio-check';
    dialog.setAttribute('aria-label', 'Full audio check');
    dialog.innerHTML = '<h2>Checking full songs</h2><p data-summary role="status" aria-live="polite">Preparing audio checks…</p><progress aria-label="Songs checked"></progress><p data-detail>Source files stay unchanged.</p><ul></ul><button type="button">Stop check</button>';
    const previousFocus = document.activeElement;
    document.body.appendChild(dialog);dialog.showModal();
    let cancelled = false, resolveChoice = null, resolveStopped;
    const stopped = new Promise(resolve => { resolveStopped = resolve; });
    const button = dialog.querySelector('button'), summary = dialog.querySelector('[data-summary]'), detail = dialog.querySelector('[data-detail]'), bar = dialog.querySelector('progress');
    const close = (choice = null) => {
      cancelled = true;
      if (active === owner) active = null;
      resolveStopped(null);
      resolveChoice?.(choice);
      dialog.close();dialog.remove();previousFocus?.focus?.();
    };
    button.onclick = () => close();dialog.addEventListener('cancel', event => { event.preventDefault();close(); });
    try {
      const checked = await Promise.race([stopped, check(tracks, { current: () => !cancelled, progress: state => {
        summary.textContent = `${state.checked} of ${state.total} songs checked · ${state.ready} ready`;
        bar.max = Math.max(1, state.total);bar.value = state.checked;
        detail.textContent = state.track ? `${state.track.title || state.track.path} · ${Math.floor(state.frames / 48000)} seconds verified` : 'Finalising full-song checks';
      } })]);
      if (cancelled) return null;
      window.dispatchEvent?.(new CustomEvent('axiom-audio-verified', { detail: { paths: checked.filter(t => t.audioCheck?.status === 'ready').map(t => t.path) } }));
      const blocked = checked.filter(t => t.audioCheck?.status !== 'ready');
      dialog.querySelector('h2').textContent = 'Audio check complete';
      bar.max = 1;bar.value = 1;
      summary.textContent = `${checked.length} songs checked · ${checked.length - blocked.length} ready · ${blocked.length} need attention`;
      detail.textContent = blocked.length ? 'These files could not be fully verified. This does not necessarily mean damaged audio. Reconnect missing files or retry after checking access. Your set stays unchanged.' : 'Every song decoded to the end. Source files are unchanged.';
      for (const track of blocked) { const li = document.createElement('li');li.textContent = `${track.title || track.path || 'Unlinked song'} — ${track.audioCheck?.reason}`;dialog.querySelector('ul').appendChild(li); }
      button.textContent = 'Close';
      const ready = checked.filter(track => track.audioCheck?.status === 'ready')
        .map(({ audioCheck, ...track }) => ({ ...track, durationSec: audioCheck.durationSec, duration_sec: audioCheck.durationSec, duration: audioCheck.durationSec }));
      if (forMixtape && !blocked.length) { close();return ready; }
      if (forMixtape && ready.length) {
        detail.textContent = `The songs listed below could not be verified. You can close this check to review them, or add only the ready songs to ${destination}. Your existing songs stay in place.`;
        const proceed = document.createElement('button');proceed.type = 'button';
        proceed.textContent = `Open ${ready.length} ready song${ready.length === 1 ? '' : 's'} in ${destination}`;
        proceed.onclick = () => close(ready);
        dialog.appendChild(proceed);
        return await new Promise(resolve => { resolveChoice = resolve; });
      }
      return null;
    } catch (error) {
      if (!cancelled) { dialog.querySelector('h2').textContent = 'Audio check paused';summary.textContent = 'Audio check could not finish';detail.textContent = error.message;bar.removeAttribute('value');bar.hidden = true;button.textContent = 'Close'; }
      return null;
    }
  }
  async function health() {
    try {
      const response = await fetch('/api/library/health/audio_sources');const data = await response.json();
      if (!response.ok || !Array.isArray(data.tracks)) throw new Error(data.error || 'Could not load Library audio.');
      if (!data.tracks.length) throw new Error('Add music to the Library first.');
      await review(data.tracks);
    } catch (error) { window.showToast?.(error.message, true); }
  }
  window.AxiomAudioReadiness = { check, review, health };
})();
