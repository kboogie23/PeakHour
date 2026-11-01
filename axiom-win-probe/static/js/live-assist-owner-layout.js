// Owner review: retain AXIOM's current design and existing control handlers.
(() => {
  let assistPresentationGeneration = 0;
  window.__AXIOM_PREPARE_ASSIST_PRESENTATION = generation => {
    assistPresentationGeneration = generation;
    let scheduled = false;
    let fontDeadline;
    const paint = () => {
      if (scheduled) return;
      scheduled = true;
      clearTimeout(fontDeadline);
      let sent = false;
      const acknowledge = () => {
        if (sent) return;
        sent = true;
        if (generation !== assistPresentationGeneration) return;
        window.webkit?.messageHandlers?.axiomNative?.postMessage?.({
          // String tokens survive WebKit's NSNumber conversion unchanged.
          action: 'clientReady', stage: 'live-assist-presented', generation: String(generation),
        });
      };
      // Hidden WKWebViews can throttle animation frames. Resolve layout and
      // keep a bounded reveal path instead of leaving the panel invisible.
      void document.body.offsetHeight;
      const paintDeadline = setTimeout(acknowledge, 250);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        clearTimeout(paintDeadline);
        acknowledge();
      }));
    };
    // Wait for local fonts, with a bounded fallback for a failed font load.
    // Two frames let the final native size and owner layout settle offscreen.
    fontDeadline = setTimeout(paint, 1000);
    if (document.fonts?.ready) document.fonts.ready.then(paint, paint);
    else paint();
  };
  const byId = id => document.getElementById(id);
  const body = document.body;
  body.classList.add('assist-owner-layout');
  document.querySelector('.bpmbar').id = 'assist-source-toolbar';
  // Keep the review at native logical dimensions after browser sizing resets.
  if (LIVE_ASSIST_PREVIEW_MODE && !LIVE_ASSIST_NATIVE_SHELL
      && LIVE_ASSIST_QUERY.get('preview')?.includes('list')
      && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) {
    document.documentElement.classList.add('assist-size-review');
    body.classList.add('assist-size-review');
  }
  const footer = document.querySelector('footer.actions');
  const feedback = document.querySelector('.more-like-control');
  const feedbackMenu = byId('more-like-menu');
  const feedbackTab = byId('like-plus-button');
  const recordMenu = byId('set-record-drawer');
  const maybeMenu = byId('maybe-drawer');
  const create = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const tabbar = create('div', 'assist-bottom-tabs');
  tabbar.setAttribute('role', 'tablist');
  tabbar.setAttribute('aria-label', 'Live Assistant tools');
  const controlsTab = create('button', 'assist-bottom-tab', 'Controls');
  controlsTab.id = 'assist-controls-tab';
  const recordTab = create('button', 'assist-bottom-tab', 'Record');
  recordTab.id = 'assist-record-tab';
  const controlsMenu = create('section', 'assist-bottom-panel');
  controlsMenu.id = 'assist-controls-panel';
  controlsMenu.hidden = true;
  const head = create('div', 'assist-panel-head');
  head.append(create('strong', '', 'Controls'));
  const close = create('button', 'assist-controls-close', 'Close');
  const closeIcon = create('img', '', '');
  closeIcon.src = '/static/icons/x.svg';
  closeIcon.alt = '';
  closeIcon.setAttribute('aria-hidden', 'true');
  close.append(closeIcon);
  close.type = 'button';
  close.setAttribute('aria-label', 'Close Controls');
  head.append(close);
  controlsMenu.append(head);
  const controlLabel = (title, hint) => {
    const label = create('div', 'assist-control-label');
    label.append(create('strong', '', title), create('small', '', hint));
    return label;
  };
  const tempoRow = create('div', 'assist-control-row');
  const tempo = create('div', 'assist-panel-buttons');
  tempo.setAttribute('role', 'group');
  tempo.setAttribute('aria-label', 'Recommendation tempo');
  const tempoButtons = [byId('half-button'), byId('double-button')];
  tempo.append(...tempoButtons);
  tempoButtons.forEach((button, index) => {
    const label = button.textContent;
    button.replaceChildren(create('strong', 'assist-tempo-ratio', index === 0 ? '½' : '2×'), create('span', '', label));
  });
  tempoRow.classList.add('assist-tempo-row');
  tempoRow.append(controlLabel('Tempo', 'Change the tempo lane without changing your playing song.'), tempo);
  controlsMenu.append(tempoRow);
  const sourceOrder = create('div', 'assist-source-order assist-control-row');
  sourceOrder.append(controlLabel('DJ software tracks', ''));
  const sourceOrderButtons = create('div', 'assist-panel-buttons');
  sourceOrderButtons.setAttribute('role', 'group');
  sourceOrderButtons.setAttribute('aria-label', 'DJ software track position');
  const syncSourceOrder = () => sourceOrderButtons.querySelectorAll('button').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.position === state.djTrackPosition));
  });
  ['top', 'bottom'].forEach(position => {
    const button = create('button', '', position === 'top' ? 'Top' : 'Bottom');
    button.type = 'button';
    button.dataset.position = position;
    button.setAttribute('aria-label', `DJ software tracks at the ${position}`);
    button.onclick = () => { setLiveAssistDJTrackPosition(position); syncSourceOrder(); };
    sourceOrderButtons.append(button);
  });
  sourceOrder.append(sourceOrderButtons);
  controlsMenu.append(sourceOrder);
  syncSourceOrder();
  const windowSettings = create('div', 'assist-window-settings assist-control-row');
  windowSettings.append(controlLabel('Window size', ''), document.querySelector('.assist-layout-control'));
  controlsMenu.append(windowSettings);

  const startModeKey = 'axiomLiveAssistStartMode.v1';
  let startMode = 'collapsed';
  if (!LIVE_ASSIST_NATIVE_SHELL) {
    try { if (localStorage.getItem(startModeKey) === 'expanded') startMode = 'expanded'; } catch (_) {}
  }
  const startup = create('div', 'assist-source-order assist-control-row assist-startup-settings');
  startup.append(controlLabel('When Live Assistant opens', 'Choose how it appears next time.'));
  const startupButtons = create('div', 'assist-panel-buttons');
  startupButtons.setAttribute('role', 'group');
  startupButtons.setAttribute('aria-label', 'Live Assistant opening style');
  const syncStartMode = () => startupButtons.querySelectorAll('button').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === startMode));
  });
  window.__AXIOM_SET_ASSIST_START_MODE = mode => {
    startMode = mode === 'expanded' ? 'expanded' : 'collapsed';
    syncStartMode();
  };
  ['collapsed', 'expanded'].forEach(mode => {
    const button = create('button', '', mode === 'collapsed' ? 'Corner tab' : 'Open panel');
    button.type = 'button';
    button.dataset.mode = mode;
    button.onclick = () => {
      window.__AXIOM_SET_ASSIST_START_MODE(mode);
      if (LIVE_ASSIST_NATIVE_SHELL) {
        window.webkit.messageHandlers.axiomNative.postMessage({ action: 'setLiveAssistStartMode', mode });
      } else {
        try { localStorage.setItem(startModeKey, mode); } catch (_) {}
      }
    };
    startupButtons.append(button);
  });
  startup.append(startupButtons);
  controlsMenu.append(startup);
  syncStartMode();
  // Explicit local review only; the native host owns actual startup preferences.
  if (LIVE_ASSIST_PREVIEW_MODE && !LIVE_ASSIST_NATIVE_SHELL
      && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)
      && (LIVE_ASSIST_QUERY.has('review') || LIVE_ASSIST_QUERY.has('ui_preview'))
      && LIVE_ASSIST_QUERY.has('start')) {
    const requestedStart = LIVE_ASSIST_QUERY.get('start');
    setAssistMode(['collapsed', 'expanded'].includes(requestedStart) ? requestedStart : startMode);
  }

  const trackSizeKey = 'axiomLiveAssistTrackSize.v2';
  const normalizeTrackSize = value => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(100, Math.max(60, Math.round(number))) : 100;
  };
  const readTrackSize = () => {
    try {
      const saved = localStorage.getItem(trackSizeKey);
      if (saved !== null) return normalizeTrackSize(saved);
      const previous = JSON.parse(localStorage.getItem('axiomLiveAssistTextSize.v1') || '{}');
      // Existing Small preferences become truly compact, instead of -2px.
      return previous?.titles === 'small' || previous?.details === 'small' ? 60 : 100;
    } catch (_) { return 100; }
  };
  let trackSize = readTrackSize();
  const sizeRow = create('div', 'assist-track-size-settings assist-control-row');
  const sizeLabel = create('label', 'assist-control-label');
  sizeLabel.htmlFor = 'assist-track-size';
  sizeLabel.append(create('strong', '', 'Track size'), create('small', '', 'Text and row spacing'));
  const sizeControl = create('div', 'assist-track-size-control');
  const sizeSlider = create('input', 'assist-track-size-slider');
  sizeSlider.id = 'assist-track-size';
  sizeSlider.type = 'range';
  sizeSlider.min = '60'; sizeSlider.max = '100'; sizeSlider.step = '1';
  sizeSlider.setAttribute('aria-label', 'Track size');
  const sizeEnds = create('div', 'assist-track-size-ends');
  const sizeValue = create('output', 'assist-track-size-value');
  sizeValue.htmlFor = sizeSlider.id;
  sizeEnds.append(create('span', '', 'Compact'), sizeValue, create('span', '', 'Large'));
  sizeControl.append(sizeSlider, sizeEnds);
  sizeRow.append(sizeLabel, sizeControl);
  controlsMenu.append(sizeRow);
  const applyTrackSize = (persist = false) => {
    const fraction = (trackSize - 60) / 40;
    const px = (small, large) => `${(small + (large - small) * fraction).toFixed(2)}px`;
    const properties = {
      '--assist-title-size': px(16, 27), '--assist-artist-size': px(10, 14),
      '--assist-meta-size': px(10, 13), '--assist-genre-size': px(9, 11),
      '--assist-row-height': px(48, 86), '--assist-row-padding': px(2, 6),
      '--assist-copy-gap': px(0, 2), '--assist-add-width': px(28, 36),
      '--assist-add-height': px(28, 40), '--assist-add-font': px(20, 24),
      '--assist-row-gap': px(6, 10), '--assist-chip-padding-y': px(1, 3),
      '--assist-chip-padding-x': px(4, 6), '--assist-anchor-padding': px(6, 10),
      '--assist-anchor-meta-size': px(10, 11),
      '--assist-deck-bpm-size': px(23, 29), '--assist-deck-gap': px(2, 6),
      '--assist-deck-padding-bottom': px(0, 4),
      '--assist-topbar-height': px(40, 46), '--assist-brand-mark-size': px(28, 32),
      '--assist-tab-height': px(32, 36), '--assist-action-height': px(38, 42),
      '--assist-shell-gap': px(5, 7), '--assist-footer-gap': px(6, 8),
      '--assist-saved-title-size': px(16, 20), '--assist-saved-row-height': px(44, 60),
      '--assist-saved-row-padding': px(4, 8), '--assist-saved-artist-size': px(10, 11),
    };
    Object.entries(properties).forEach(([name, value]) => body.style.setProperty(name, value));
    body.dataset.assistTrackDensity = trackSize <= 80 ? 'compact' : 'large';
    sizeSlider.value = String(trackSize);
    sizeValue.textContent = `${trackSize}%`;
    sizeSlider.setAttribute('aria-valuetext', `${trackSize}% · ${trackSize <= 80 ? 'Compact' : 'Large'} tracks`);
    // CSS changes preserve recommendation DOM, selection, focus and scroll.
    if (persist) {
      try { localStorage.setItem(trackSizeKey, String(trackSize)); } catch (_) {}
    }
  };
  sizeSlider.oninput = () => { trackSize = normalizeTrackSize(sizeSlider.value); applyTrackSize(); };
  sizeSlider.onchange = () => { trackSize = normalizeTrackSize(sizeSlider.value); applyTrackSize(true); };
  const textPreview = create('div', 'assist-text-preview');
  const textSample = create('div', 'assist-text-sample');
  textSample.setAttribute('aria-hidden', 'true');
  textSample.append(create('strong', '', 'Track title'), create('span', '', 'Artist · BPM · Year'));
  const resetText = create('button', 'assist-text-reset', 'Reset size');
  resetText.type = 'button';
  resetText.setAttribute('aria-label', 'Reset Live Assist track size');
  resetText.onclick = () => { trackSize = 100; applyTrackSize(true); };
  textPreview.append(textSample, resetText);
  controlsMenu.append(textPreview);
  applyTrackSize();

  feedbackTab.removeAttribute('style');
  feedbackTab.replaceChildren(document.createTextNode('More like this'));
  feedbackTab.className = 'assist-bottom-tab';
  feedbackTab.setAttribute('aria-label', 'More like this menu');
  feedbackMenu.prepend(byId('like-button'), byId('old-button'));
  feedback.replaceChildren(feedbackTab, feedbackMenu);
  tabbar.append(feedback, controlsTab, recordTab);
  const bottom = create('div', 'assist-bottom-actions');
  const maybe = byId('maybe-button');
  const thinking = maybe.querySelector('.thinking');
  if (thinking) thinking.hidden = true;
  maybe.prepend(create('span', 'assist-maybe-label', 'Maybe Next'));
  byId('assist-anchor-refresh').querySelector('span').textContent = 'More';
  bottom.append(maybe, byId('clean-only-button'), document.querySelector('.refresh-control'));
  footer.replaceChildren(tabbar, bottom, controlsMenu, recordMenu);
  recordMenu.classList.add('assist-bottom-panel');
  feedbackMenu.classList.add('assist-bottom-panel');
  maybeMenu.classList.add('assist-bottom-panel');
  // Preserve the one-press recording control, now inside its setup menu.
  const recordToggle = byId('set-record-button');
  recordToggle.querySelector('b[hidden]').hidden = false;
  recordMenu.querySelector('.set-record-action-group').append(recordToggle);
  document.querySelector('.record-maybe-pair')?.remove();

  const tabs = [[feedbackTab, feedbackMenu], [controlsTab, controlsMenu], [recordTab, recordMenu]];
  tabs.forEach(([tab, panel]) => {
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panel.id);
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
  });
  const syncTabs = () => tabs.forEach(([tab, panel]) => {
    const open = !panel.hidden;
    tab.setAttribute('aria-selected', String(open));
    tab.setAttribute('aria-expanded', String(open));
  });
  const closeMenus = (keep = null) => {
    tabs.forEach(([, panel]) => { if (panel !== keep && !panel.hidden) panel.hidden = true; });
    if (keep !== recordMenu) body.classList.remove('recording-drawer-open');
    if (keep !== maybeMenu) toggleAssistMaybe(false);
    if (keep !== gigProfileMenu) {
      gigProfileMenu.hidden = true;
      state.gigProfileMenuOpen = false;
      renderGigProfileButton();
    }
    syncTabs();
  };
  controlsTab.onclick = event => {
    event.stopPropagation();
    const open = controlsMenu.hidden;
    closeMenus(controlsMenu);
    controlsMenu.hidden = !open;
    syncSourceOrder();
    syncTabs();
  };
  recordTab.onclick = async event => {
    event.stopPropagation();
    const open = recordMenu.hidden;
    closeMenus(recordMenu);
    if (open) await openRecordingDrawer();
    else closeRecordingDrawer();
    syncTabs();
  };
  feedbackTab.addEventListener('click', () => {
    // The existing listener opens this menu first; retain its feedback actions.
    closeMenus(feedbackMenu);
    syncTabs();
  });
  maybe.addEventListener('click', () => closeMenus(maybeMenu));
  byId('gig-profile-button').addEventListener('click', () => closeMenus(gigProfileMenu));
  close.onclick = () => { controlsMenu.hidden = true; syncTabs(); controlsTab.focus(); };
  const observer = new MutationObserver(syncTabs);
  tabs.forEach(([, panel]) => observer.observe(panel, {attributes: true, attributeFilter: ['hidden']}));
  const syncPlaylistLayout = () => body.classList.toggle('assist-playlists-open', !gigProfileMenu.hidden);
  new MutationObserver(syncPlaylistLayout).observe(gigProfileMenu, {attributes: true, attributeFilter: ['hidden']});
  syncPlaylistLayout();
  const syncToggle = button => button.setAttribute('aria-checked', button.getAttribute('aria-pressed') || 'false');
  [byId('clean-only-button'), byId('assist-only-selected')].forEach(button => {
    button.setAttribute('role', 'switch');
    syncToggle(button);
    new MutationObserver(() => syncToggle(button)).observe(button, {attributes: true, attributeFilter: ['aria-pressed']});
  });
  const onlySelected = byId('assist-only-selected');
  onlySelected.textContent = 'Only selected';
  document.addEventListener('click', event => {
    if (event.target.closest('footer.actions, #maybe-drawer')) return;
    if (!controlsMenu.hidden) controlsMenu.hidden = true;
    syncTabs();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeMenus(); feedbackTab.focus(); }
    if (event.target.closest('.assist-bottom-tabs') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const buttons = tabs.map(([tab]) => tab);
      const index = buttons.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3;
      buttons[next].focus();
      buttons[next].click();
    }
  });
  new MutationObserver(() => {
    if (body.dataset.assistMode === 'collapsed') closeMenus();
  }).observe(body, {attributes: true, attributeFilter: ['data-assist-mode']});

  // Browser-only menu samples never connect to or mutate a DJ library.
  if (LIVE_ASSIST_PREVIEW_MODE && LIVE_ASSIST_QUERY.get('preview')?.includes('list')
      && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) {
    const provider = state.gigProfile.live_provider || 'serato';
    state.gigProfileSources = ['RNB Classics', 'Hip Hop Party', 'Dancehall', 'Warm Up', 'Peak Time', 'Requests', 'Throwbacks', 'Closing Set'].map((name, index) => ({
      id: index === 0 ? `preview-${provider}` : `preview-${provider}-${index}`,
      name, provider, path: `/preview/crates/${name}`, track_count: 48 + index * 13,
      matched_track_count: 35 + index * 8,
    }));
    state.gigProfileSourcesLoaded = true;
    state.gigProfileSources.forEach(source => assistLivePlaylistIds.add(source.id));
    state.bpmContext = {live_bpm: trackBpm(state.anchor)};
  }
  syncTabs();
  render();
})();
