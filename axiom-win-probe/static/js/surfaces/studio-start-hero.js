(function () {
  function startView() {
    return document.getElementById('studio-start-view');
  }

  function roomPathAvailable() {
    return !document.getElementById('studio-path-room')?.classList.contains('hidden');
  }

  function setStudioStartHero(path = '') {
    const view = startView();
    if (!view) return;
    if (path === 'fresh') view.dataset.startHero = 'fresh';
    else delete view.dataset.startHero;
  }

  function selectStudioStartPath(path = 'fresh', revealArtwork = false) {
    const selectedPath = path === 'room' && roomPathAvailable() ? 'room' : 'fresh';
    setStudioStartHero(revealArtwork && selectedPath === 'fresh' ? 'fresh' : '');

    ['fresh', 'room'].forEach((candidate) => {
      const selected = candidate === selectedPath;
      const card = document.getElementById(`studio-path-${candidate}`);
      const radio = document.getElementById(`studio-path-${candidate}-radio`);
      card?.classList.toggle('is-selected', selected);
      card?.classList.toggle('is-art-selected', selected && (revealArtwork || card.classList.contains('is-art-selected')));
      card?.setAttribute('aria-checked', selected ? 'true' : 'false');
      if (radio) radio.checked = selected;
    });
  }

  function previewStudioStartPath(path = 'fresh') {
    setStudioStartHero(path === 'fresh' ? 'fresh' : '');
  }

  function clearStudioStartPreview() {
    setStudioStartHero('');
  }

  function handleStudioStartPathKeydown(event, path) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    selectStudioStartPath(path, true);
  }

  Object.assign(window, {
    setStudioStartHero,
    selectStudioStartPath,
    previewStudioStartPath,
    clearStudioStartPreview,
    handleStudioStartPathKeydown
  });

  function bindStudioStartHeroBridge() {
    const fresh = document.getElementById('studio-path-fresh');
    const room = document.getElementById('studio-path-room');
    if (fresh?.dataset.heroBridgeBound !== '1') {
      fresh.dataset.heroBridgeBound = '1';
      fresh.addEventListener('mouseenter', () => previewStudioStartPath('fresh'));
      fresh.addEventListener('focusin', () => previewStudioStartPath('fresh'));
      fresh.addEventListener('mouseleave', clearStudioStartPreview);
      fresh.addEventListener('focusout', clearStudioStartPreview);
    }
    if (room?.dataset.heroBridgeBound !== '1') {
      room.dataset.heroBridgeBound = '1';
      room.addEventListener('mouseenter', clearStudioStartPreview);
      room.addEventListener('focusin', clearStudioStartPreview);
      room.addEventListener('click', () => setStudioStartHero(''));
    }
  }

  function bindBuildNightHoverBridge() {
    const grid = document.querySelector('#studio-start-view .build-night-grid');
    if (!grid || grid.dataset.hoverBridgeBound === '1') return;
    grid.dataset.hoverBridgeBound = '1';
    let activeCard = null;

    const clear = () => {
      if (activeCard) activeCard.classList.remove('is-mission-hovered');
      activeCard = null;
    };

    const setActive = (card) => {
      if (activeCard === card) return;
      clear();
      activeCard = card;
      activeCard.classList.add('is-mission-hovered');
    };

    grid.querySelectorAll('.build-night-card').forEach((card) => {
      card.addEventListener('pointerenter', () => setActive(card));
      card.addEventListener('mouseenter', () => setActive(card));
      card.addEventListener('focusin', () => setActive(card));
      card.addEventListener('pointerleave', () => {
        if (activeCard === card) clear();
      });
      card.addEventListener('mouseleave', () => {
        if (activeCard === card) clear();
      });
      card.addEventListener('focusout', () => {
        if (activeCard === card) clear();
      });
    });

    grid.addEventListener('mouseleave', clear);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      bindStudioStartHeroBridge();
      bindBuildNightHoverBridge();
    }, { once: true });
  } else {
    bindStudioStartHeroBridge();
    bindBuildNightHoverBridge();
  }
})();
