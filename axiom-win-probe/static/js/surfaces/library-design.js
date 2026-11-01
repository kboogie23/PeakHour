/* Pro Library views share one result list, filters, selection and player. */
(function () {
  const storageKey = 'axiomProLibraryView.v1';
  const shell = document.getElementById('tab-content-library');
  if (!shell) return;
  document.body.classList.add('axiom-pro-library-design');
  const commandBar = document.getElementById('library-brief-lens');
  const grid = shell.querySelector('.library-main-grid');
  if (commandBar && grid) shell.insertBefore(commandBar, grid);
  const prepIntro = document.createElement('section');
  prepIntro.id = 'library-track-prep-intro';
  prepIntro.hidden = true;
  prepIntro.setAttribute('aria-label', 'Track Prep');
  prepIntro.innerHTML = '<span class="library-prep-intro-label">Track Prep</span><div><h2><span>Get your tracks ready.</span></h2><p>Find missing BPM, key and year, check files, and tidy track details right here.</p></div>';
  shell.querySelector('.library-topbar')?.appendChild(prepIntro);
  let prepIntroPlayed = false;
  let view = localStorage.getItem(storageKey) === 'album' ? 'album' : 'list';
  function sync() {
    shell.dataset.libraryView = view;
    document.body.classList.toggle('library-design-active', !shell.classList.contains('hidden'));
    document.querySelectorAll('[data-library-view]').forEach(button => {
      button.setAttribute('aria-pressed', button.dataset.libraryView === view ? 'true' : 'false');
    });
    const matching = document.getElementById('library-design-matching-toggle');
    matching?.setAttribute('aria-pressed', document.body.classList.contains('library-matching-songs-disabled') ? 'false' : 'true');
    syncSetupControls();
    if (shell.classList.contains('hidden') || !document.body.classList.contains('library-setup-open')) closeSetupMenu();
    const preparing = commandBar?.dataset.libraryBriefPanel === 'preparation';
    if (prepIntro.hidden === preparing) prepIntro.hidden = !preparing;
    if (preparing && !prepIntroPlayed) { prepIntro.classList.add('library-prep-intro-reveal'); prepIntroPlayed = true; }
    const count = document.getElementById('library-design-count');
    const originalCount = document.getElementById('lib-track-count-val');
    if (count && originalCount) count.textContent = `${originalCount.textContent} tracks`;
  }
  function setView(value) {
    if (!['list', 'album'].includes(value)) return;
    view = value;
    localStorage.setItem(storageKey, view);
    sync();
  }
  function decorateRows() {
    document.querySelectorAll('#search-results > .library-track-card').forEach(row => {
      // Move existing interactive metadata nodes; do not create duplicate controls.
      const meta = row.querySelector('.library-row-meta-stack');
      if (meta && !row.querySelector(':scope > .library-row-meta-stack')) row.appendChild(meta);
      const title = row.querySelector('.library-track-title');
      if (title) title.setAttribute('title', Array.from(title.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim());
    });
    sync();
  }
  function reviewTracks(tracks) {
    // Review-only art and large-library fixture; never replace installed library data.
    if (!['127.0.0.1', 'localhost', '::1'].includes(location.hostname)
      || new URLSearchParams(location.search).get('review') !== 'library') return tracks;
    const files = ['dum-dumb', 'for-the-money', 'how-long', 'rain', 'obsessed', 'birthday', 'down-on-me'];
    const decorated = tracks.map((track, index) => ({ ...track, artwork: axiomRecordVaultStaticUrl(`assets/library-review/${files[index % files.length]}.png`) }));
    if (new URLSearchParams(location.search).get('ui_preview') !== 'library-design') return decorated;
    return Array.from({ length: 120 }, (_, index) => ({ ...decorated[index % decorated.length],
      path: `preview://library-design/${index}`, title: `${decorated[index % decorated.length].title}${index >= decorated.length ? ` (Library ${index + 1})` : ''}`,
      bpm: 65 + (index % 24) * 3, year: 2000 + (index % 26), ...(libraryGapPreparationReviewOverrides.get(`preview://library-design/${index}`) || {}) }));
  }
  function reviewSuggestions(anchor, modifiers, count, offset) {
    if (!['127.0.0.1', 'localhost', '::1'].includes(location.hostname)
      || new URLSearchParams(location.search).get('review') !== 'library') return null;
    const rows = reviewTracks(libraryGapReviewTracks());
    const windowBpm = Number(modifiers.bpm_window || 3);
    const tempos = [Number(anchor.bpm)];
    if (modifiers.bpm_half) tempos.push(Number(anchor.bpm) / 2);
    if (modifiers.bpm_double) tempos.push(Number(anchor.bpm) * 2);
    const matches = rows.filter(track => track.path !== anchor.path
      && tempos.some(bpm => Math.abs(bpm - Number(track.bpm)) <= windowBpm));
    return { suggestions: matches.slice(offset, offset + count), total: matches.length };
  }
  function updateAnchor(track) {
    let panel = document.getElementById('library-design-anchor');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'library-design-anchor';
      document.getElementById('lib-suggestions-list')?.before(panel);
    }
    panel.innerHTML = `${renderTrackArtwork(track, 'library-design-anchor-art')}<div><small>Based on</small><strong>${escapeHtml(track.title || 'Selected track')}</strong><span>${escapeHtml(track.artist || '')}</span><span>${escapeHtml(String(track.bpm || '--'))} BPM · ${escapeHtml(trustedTrackKey(track) || 'Key unresolved')}</span></div>`;
  }
  // Setup menus preserve the original select/change handlers while enlarging
  // only the open choices on hover. No hover lens appears on closed controls.
  const setupControls = new Map();
  let openSetupMenu = null;
  function closeSetupMenu() {
    if (!openSetupMenu) return;
    openSetupMenu.menu.remove();
    openSetupMenu.button.setAttribute('aria-expanded', 'false');
    openSetupMenu = null;
  }
  function syncSetupControls() {
    document.querySelectorAll('#library-brief-settings .library-brief-control-grid select').forEach(select => {
      let button = setupControls.get(select);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'library-setup-select-trigger';
        button.dataset.setupSelect = select.id;
        button.dataset.axiomCtaSkip = 'true';
        button.setAttribute('role', 'combobox');
        button.setAttribute('aria-haspopup', 'listbox');
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-controls', `${select.id}-choices`);
        const label = select.closest('label')?.querySelector('span')?.textContent.trim() || select.id;
        button.setAttribute('aria-label', label);
        select.dataset.setupCustomSelect = 'true';
        select.setAttribute('aria-hidden', 'true');
        select.tabIndex = -1;
        select.after(button);
        button.addEventListener('click', () => {
          if (openSetupMenu?.button === button) closeSetupMenu();
          else openSetupChoices(select, button);
        });
        button.addEventListener('keydown', event => {
          if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();openSetupChoices(select, button);
          }
        });
        select.addEventListener('change', syncSetupControls);
        setupControls.set(select, button);
      }
      const label = select.options[select.selectedIndex]?.textContent || 'Choose';
      if (button.textContent !== label) button.textContent = label;
    });
  }
  function openSetupChoices(select, button) {
    closeSetupMenu();
    const menu = document.createElement('div');
    menu.id = `${select.id}-choices`;
    menu.className = 'library-setup-choice-menu';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', button.getAttribute('aria-label'));
    const choices = Array.from(select.options).filter(option => !option.disabled);
    choices.forEach(option => {
      const item = document.createElement('button');
      item.type = 'button';item.className = 'library-setup-choice';
      item.dataset.axiomCtaSkip = 'true';
      item.setAttribute('role', 'option');item.setAttribute('aria-selected', String(option.value === select.value));
      item.textContent = option.textContent;item.dataset.value = option.value;
      item.addEventListener('click', () => {
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        closeSetupMenu();button.focus();
      });
      menu.appendChild(item);
    });
    document.body.appendChild(menu);
    const rect = button.getBoundingClientRect();
    const width = Math.min(Math.max(280, rect.width), innerWidth - 24);
    menu.style.width = `${width}px`;
    menu.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`;
    const below = innerHeight - rect.bottom - 16;
    const above = rect.top - 16;
    const height = Math.min(choices.length * 44 + 12, Math.max(below, above), 540);
    menu.style.maxHeight = `${height}px`;
    menu.style.top = `${below >= height ? rect.bottom + 6 : Math.max(12, rect.top - height - 6)}px`;
    openSetupMenu = { menu, button };
    button.setAttribute('aria-expanded', 'true');
    const items = Array.from(menu.children);
    let index = Math.max(0, choices.findIndex(option => option.value === select.value));
    items[index]?.focus();
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        closeSetupMenu();if (event.key === 'Escape') { event.preventDefault();button.focus(); }return;
      }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        if (event.key === 'Home') index = 0;
        else if (event.key === 'End') index = items.length - 1;
        else index = (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[index]?.focus();
      }
    });
  }
  document.addEventListener('pointerdown', event => {
    if (openSetupMenu && !openSetupMenu.menu.contains(event.target) && event.target !== openSetupMenu.button) closeSetupMenu();
  });
  window.addEventListener('resize', closeSetupMenu);
  window.addEventListener('scroll', event => {
    if (!openSetupMenu?.menu.contains(event.target)) closeSetupMenu();
  }, true);
  syncSetupControls();
  window.AxiomLibraryDesign = { setView, decorateRows, reviewTracks, reviewSuggestions, updateAnchor, sync };
  new MutationObserver(sync).observe(shell, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  if (commandBar) new MutationObserver(sync).observe(commandBar, { attributes: true, attributeFilter: ['data-library-brief-panel'] });
  const count = document.getElementById('lib-track-count-val');
  if (count) new MutationObserver(sync).observe(count, { childList: true, characterData: true, subtree: true });
  sync();
})();
