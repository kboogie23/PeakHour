/* First-library entrance state. Uses the existing, read-only music intake flows. */
(function () {
  'use strict';
  const session = window.__axiomEntranceSession;
  const params = new URLSearchParams(location.search);
  const fixture = session?.fixture && params.get('entrance_library');
  const tile = document.getElementById('entrance-add-music');
  const chooser = document.getElementById('entrance-library-chooser');
  if (!tile || !chooser) return;
  document.body.appendChild(chooser);
  let count = null, busy = false;
  function place() {
    if (chooser.hidden) return;
    const rect = tile.getBoundingClientRect();
    const width = Math.min(350, innerWidth - 24);
    chooser.style.width = width + 'px';
    chooser.style.left = Math.max(12, Math.min(rect.left, innerWidth - width - 12)) + 'px';
    chooser.style.top = Math.max(12, Math.min(rect.top - chooser.offsetHeight - 12, innerHeight - chooser.offsetHeight - 12)) + 'px';
  }
  function hide(focus = false) {
    chooser.hidden = true; tile.setAttribute('aria-expanded', 'false');
    if (focus) tile.focus({ preventScroll: true });
  }
  function show() {
    if (busy) return;
    chooser.hidden = false; tile.setAttribute('aria-expanded', 'true');place();
    chooser.querySelector('[data-entrance-source]')?.focus({ preventScroll: true });
  }
  function setCount(value) {
    if (fixture) value = fixture === 'empty' ? 0 : 24;
    if (value == null || !Number.isFinite(Number(value))) return;
    count = Math.max(0, Number(value));
    if (count > 0) {
      hide();
    }
    document.documentElement.toggleAttribute('data-entrance-library-empty', count === 0);
    const display = document.getElementById('lib-track-count-val');
    if (fixture && display) display.textContent = count.toLocaleString();
    window.AxiomEntrance?.libraryChanged();
  }
  async function choose(source) {
    if (busy) return;
    hide(); busy = true;
    try {
      // This entrance chooser already supplies the source choice.
      if (source === 'folder' && await openFolderForLibrary() === false) return;
      else if (source === 'serato') await startSeratoDatabaseFlowFromSource();
      await loadLibraryStats(false);
    } catch (error) {
      if (!error?.cancelled) showToast(error.message || 'Music could not be added. Choose your library again.', true);
    } finally { busy = false;window.AxiomEntrance?.libraryChanged(); }
  }
  tile.addEventListener('click', event => {
    // The parent track dock has its own legacy folder action.
    event.stopPropagation();
    if (chooser.hidden) show();
    else hide(true);
  });
  chooser.querySelector('[data-entrance-dismiss]').addEventListener('click', () => hide(true));
  chooser.querySelectorAll('[data-entrance-source]').forEach(button => button.addEventListener('click', () => choose(button.dataset.entranceSource)));
  document.addEventListener('pointerdown', event => {
    if (!chooser.hidden && !chooser.contains(event.target) && !tile.contains(event.target)) hide();
  });
  document.addEventListener('keydown', event => {
    if (!chooser.hidden && event.key === 'Escape') { event.preventDefault();event.stopPropagation();hide(true); }
  }, true);
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);
  window.AxiomEntranceLibrary = Object.freeze({
    setCount, show, hide, choose,
    // A past import is not evidence that this installation has music now.
    get canOpen() { return count > 0; },
    get empty() { return count === 0; },
    get known() { return count !== null; },
    get busy() { return busy; },
  });
  if (fixture) setCount(0);
})();
