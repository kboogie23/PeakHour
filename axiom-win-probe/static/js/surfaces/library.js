/* Library surface: Matching Songs controls and suggestion loading. */

    function toggleLibModifier(mod) {
      activeLibModifiers[mod] = !activeLibModifiers[mod];
      const btn = document.getElementById(`lmod-${mod}`);
      if (activeLibModifiers[mod]) {
        btn.classList.add('bg-axiom-accent/20', 'text-axiom-accent', 'border-axiom-accent');
      } else {
        btn.classList.remove('bg-axiom-accent/20', 'text-axiom-accent', 'border-axiom-accent');
      }
      btn?.setAttribute('aria-pressed', activeLibModifiers[mod] ? 'true' : 'false');
      renderLibraryMatchingFilterStatus();
      resetAndFetchLibSuggestions();
    }

    function setLibraryMatchingFilter(name, value) {
      if (name === 'root') libRootFilter = value || '';
      renderLibraryMatchingFilterStatus();
      resetAndFetchLibSuggestions();
    }

    function libraryMatchingFilterLabels() {
      const labels = [];
      if (activeLibModifiers.bpm_half) labels.push('Half BPM');
      if (activeLibModifiers.bpm_double) labels.push('Double BPM');
      const bpmWindow = document.getElementById('lmod-bpm-window');
      const era = document.getElementById('lmod-era');
      const count = document.getElementById('lmod-count');
      if (bpmWindow && bpmWindow.value !== '3') labels.push(bpmWindow.selectedOptions?.[0]?.textContent || `${bpmWindow.value} BPM`);
      if (era && era.value !== 'All') labels.push(era.selectedOptions?.[0]?.textContent || era.value);
      if (libRootFilter) labels.push(`${libRootFilter} Root`);
      if (count && count.value !== '20') labels.push(count.selectedOptions?.[0]?.textContent || `${count.value} Matches`);
      return labels.filter(Boolean);
    }

    function renderLibraryMatchingFilterStatus() {
      const status = document.getElementById('library-matching-filter-status');
      if (!status) return;
      const labels = libraryMatchingFilterLabels();
      status.hidden = !labels.length;
      status.innerHTML = labels.length ? `
        <span><b>Filters on:</b> ${labels.map(escapeHtml).join(' / ')}</span>
        <button type="button" onclick="clearLibraryMatchingFilters()">Clear Filters</button>
      ` : '';
    }

    function clearLibraryMatchingFilters(options = {}) {
      const fetchResults = options.fetchResults !== false;
      const silent = Boolean(options.silent);
      activeLibModifiers = {};
      libRootFilter = '';
      const defaults = {
        'lmod-bpm-window': '3',
        'lmod-era': 'All',
        'lmod-root': '',
        'lmod-count': '20'
      };
      Object.entries(defaults).forEach(([id, value]) => {
        const control = document.getElementById(id);
        if (control) control.value = value;
      });
      ['bpm_half', 'bpm_double'].forEach((modifier) => {
        const button = document.getElementById(`lmod-${modifier}`);
        button?.classList.remove('bg-axiom-accent/20', 'text-axiom-accent', 'border-axiom-accent');
        button?.setAttribute('aria-pressed', 'false');
      });
      renderLibraryMatchingFilterStatus();
      if (fetchResults && currentAnchorTrack && libraryMatchingSongsEnabled()) resetAndFetchLibSuggestions();
      if (!silent) showToast('Matching Songs filters cleared.');
    }

    function prepareLibraryMatchingForAnchor(path) {
      if (window.AxiomDawFinder?.active) return;
      const nextPath = String(path || '');
      const currentPath = String(currentAnchorTrack?.path || '');
      if (nextPath && nextPath !== currentPath) {
        clearLibraryMatchingFilters({ fetchResults: false, silent: true });
      }
    }

    function resetAndFetchLibSuggestions() {
      libOffset = 0;
      if (!libraryMatchingSongsEnabled()) return;
      fetchLibSuggestions(false);
    }

    function widenLibraryMatchingSearch() {
      const bpmWindow = document.getElementById('lmod-bpm-window');
      if (bpmWindow) bpmWindow.value = '10';
      renderLibraryMatchingFilterStatus();
      resetAndFetchLibSuggestions();
    }

    let smartLinkRefreshTimer = null;

    function scheduleSmartLinkRefresh() {
      if (!libraryMatchingSongsEnabled()) return;
      clearTimeout(smartLinkRefreshTimer);
      smartLinkRefreshTimer = setTimeout(() => {
        resetAndFetchLibSuggestions();
      }, 900);
    }

    function cssEscapeValue(value) {
      if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value || ''));
      return String(value || '').replace(/["\\]/g, '\\$&');
    }

    async function fetchLibSuggestions(append = false) {
      if (!libraryMatchingSongsEnabled()) return;
      const finder = window.AxiomDawFinder;
      const anchor = finder?.active ? finder.anchor : currentAnchorTrack;
      if (!anchor || (finder?.active && !finder.recommending)) return;
      if (!finder?.active) window.AxiomLibraryDesign?.updateAnchor(anchor);
      const requestId = ++libSuggestionRequestId;
      const listEl = document.getElementById('lib-suggestions-list');

      if (!append) {
        listEl.setAttribute('aria-busy', 'true');
        if (!listEl.querySelector('.recommendation-card, .spinner')) {
          listEl.innerHTML = '<div class="spinner border-axiom-accent w-6 h-6 mx-auto mt-10"></div>';
        }
      } else {
        const loadBtn = document.getElementById('lib-load-more');
        if (loadBtn) loadBtn.innerText = 'Loading...';
      }

      const count = parseInt(document.getElementById('lmod-count').value || 20);
      const requestedCount = libRootFilter ? Math.max(count * 6, 100) : count;
      const era = document.getElementById('lmod-era').value || "All";

      try {
        const requestModifiers = {
          ...activeLibModifiers,
          bpm_window: Number(document.getElementById('lmod-bpm-window')?.value || 3)
        };
        const requestBody = {
          anchor,
          modifiers: requestModifiers,
          set_brief: finder?.active ? {} : setBriefRuntimePayload(),
          limit: requestedCount,
          offset: libOffset,
          era: era,
          blacklist: finder?.active ? [...new Set([...finder.paths, anchor.path])] : getUsedTrackBlacklist([currentAnchorTrack])
        };

        if (libRootFilter && libRootFilter !== "") requestBody.dna_root = libRootFilter;

        const reviewData = !finder?.active && window.AxiomLibraryDesign?.reviewSuggestions(anchor, requestModifiers, requestedCount, libOffset);
        const data = reviewData || await (await fetch('/api/studio/suggestions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        })).json();
        if (requestId !== libSuggestionRequestId) return;
        let items = (data.suggestions || [])
          .map(normalizeModalTrackMetadata)
          .filter(item => modalBpmValue(item) && (finder?.active ? !finder.paths.includes(item.path) : !playlistHasTrack(item)));
        let total = data.total || 0;

        // Client-side root filter using dna_pillar (server field) with genre as fallback
        if (libRootFilter && libRootFilter !== '') {
          items = filterByRoot(items, libRootFilter);
          total = items.length;
        }

        items = items.slice(0, count);

        const loadBtn = document.getElementById('lib-load-more');
        if (loadBtn) loadBtn.remove();

        if (items.length === 0 && !append) {
          const hasActiveFilters = libraryMatchingFilterLabels().length > 0;
          listEl.innerHTML = `
            <div class="library-matching-empty">
              <strong>No matches found</strong>
              <span>${hasActiveFilters
                ? 'Your active filters may be too narrow for this song.'
                : 'AXIOM did not find a strong next-song match at the default range.'}</span>
              <button type="button" onclick="${hasActiveFilters ? 'clearLibraryMatchingFilters()' : 'widenLibraryMatchingSearch()'}">${hasActiveFilters ? 'Clear Filters and Try Again' : 'Try a Wider ±10 BPM Range'}</button>
            </div>
          `;
        } else {
          const htmlStr = items.map(s => {
            s = normalizeModalTrackMetadata(s);
            cacheTrackVisual(s);
            const isPlayed = previewedTracks.has(`${window.location.origin}/api/library/stream?path=${encodeURIComponent(s.path)}`);
            const isPlaying = currentPlayingPath === s.path;
            const keyClass = camelotClass(s.camelot);
            const playCall = `event.stopPropagation(); playAudioFile('${escapeJs(s.path)}', '${escapeJs(s.title)}', '${escapeJs(s.artist)}', ${s.bpm || 0}, '${escapeJs(s.camelot)}', '${escapeJs(s.energy)}', event, '${escapeJs(s.genre || '')}');`;
            return `
                <div class="glass vampire-row recommendation-card axiom-focus-deck-row group ${isPlayed ? 'played' : ''} ${isPlaying ? 'playing-track' : ''}" data-path="${escapeHtml(s.path)}" tabindex="-1">
                    ${renderTrackArtwork(s, 'library-artwork recommendation-artwork', playCall)}
                    <div class="recommendation-main cursor-pointer" onclick="${playCall}">
                        <p class="recommendation-title track-title-resize" title="${escapeHtml(s.title)}">${escapeHtml(s.title)}</p>
                        <p class="recommendation-artist track-artist-resize">${escapeHtml(s.artist || 'Unknown Artist')}</p>
                    </div>
                    <button onclick="event.stopPropagation(); toggleFavorite({path:'${escapeJs(s.path)}',title:'${escapeJs(s.title)}',artist:'${escapeJs(s.artist)}',bpm:${s.bpm || 0},camelot:'${escapeJs(s.camelot || '')}',energy:'${escapeJs(s.energy || '')}',genre:'${escapeJs(s.genre || '')}'})" class="fav-star-btn recommendation-favorite ${favoritesHasTrack(s) ? 'fav-star-active' : ''}" data-fav-path="${escapeHtml(s.path)}" title="${favoritesHasTrack(s) ? 'Remove from Favorites' : 'Add to Favorites'}">${favoritesHasTrack(s) ? '&#9733;' : '&#9734;'}</button>
                    <div class="recommendation-meta">
                      ${renderTrackRoleEvidence(s)}
                      <div class="recommendation-bpm">
                        <div style="color:${s.bpm ? '' : '#EAB308'};" class="cursor-pointer" onclick="event.stopPropagation(); promptSetBpm('${escapeJs(s.path)}', ${s.bpm || 0})" aria-label="Click to edit BPM">${s.bpm ? Math.round(parseFloat(s.bpm)) : '--'}</div>
                        <div class="library-bpm-tools justify-end">
                          ${s.bpm ? `
                            <button onclick="event.stopPropagation(); adjustBpm('${escapeJs(s.path)}', ${s.bpm}, 'half')" title="Halve BPM">1/2</button>
                            <button onclick="event.stopPropagation(); adjustBpm('${escapeJs(s.path)}', ${s.bpm}, 'double')" title="Double BPM">2x</button>
                          ` : `
                            <button onclick="event.stopPropagation(); promptSetBpm('${escapeJs(s.path)}', 0)" title="Set BPM" style="border-color:rgba(234,179,8,0.5);color:#EAB308;">Set</button>
                          `}
                        </div>
                      </div>
                      <div class="recommendation-key-metric ${s.camelot ? 'has-key' : 'is-missing'}">
                        <button onclick="event.stopPropagation(); promptUpdateKey('${escapeJs(s.path)}', '${escapeJs(s.camelot || '')}')" class="camelot-pill ${keyClass} cursor-pointer" title="Set or fix key">${s.camelot || '--'}</button>
                        <small>KEY</small>
                      </div>
                      <button id="lib-sugg-add-${items.indexOf(s)}" onclick="event.stopPropagation(); addAfterAnchor('${escapeJs(s.path)}', '${escapeJs(s.title)}', '${escapeJs(s.artist)}', ${s.bpm}, '${escapeJs(s.camelot)}', '${escapeJs(s.energy)}', 'lib-sugg-add-${items.indexOf(s)}')" class="recommendation-add-btn button--primary">${finder?.active ? 'Add to DAW' : 'Add'}</button>
                    </div>
                </div>
              `;
          }).join('');

          if (append) {
            listEl.insertAdjacentHTML('beforeend', htmlStr);
          } else {
            if (listEl.innerHTML !== htmlStr) listEl.innerHTML = htmlStr;
          }

          if (!libRootFilter && libOffset + count < total) {
            listEl.insertAdjacentHTML('beforeend', `
                    <button id="lib-load-more" onclick="libOffset += ${count}; fetchLibSuggestions(true)" class="recommendations-more-btn button--green-outline">Show More Matches (${total - (libOffset + count)} remaining)</button>
                  `);
          }
        }
      } catch (err) {
        if (!append && requestId === libSuggestionRequestId && !listEl.querySelector('.recommendation-card')) {
          listEl.innerHTML = `<p class="text-red-500 font-bold text-center mt-10 text-xs uppercase">Error loading</p>`;
        }
      } finally {
        if (!append && requestId === libSuggestionRequestId) listEl.setAttribute('aria-busy', 'false');
      }
    }

/* Library surface: search, filters, sorting, and Track Prep navigation. */

	    function getLibraryBpmBounds(value = activeLibraryBpmFilter) {
	      const ranges = {
	        '70-85': { min: 70, max: 85 },
	        '85-100': { min: 85, max: 100 },
	        '100-115': { min: 100, max: 115 },
	        '115-128': { min: 115, max: 128 },
	        '128-140': { min: 128, max: 140 },
	        '140-plus': { min: 140, max: null }
	      };
	      return ranges[value] || null;
	    }

	    function appendLibraryBpmParams(url) {
	      const bounds = getLibraryBpmBounds();
	      if (!bounds) return url;
	      const separator = url.includes('?') ? '&' : '?';
	      const params = new URLSearchParams();
	      params.set('bpm_min', bounds.min);
	      if (bounds.max != null) params.set('bpm_max', bounds.max);
	      return `${url}${separator}${params.toString()}`;
	    }

	    function appendLibraryPagingParams(url, requestedLimit = activeLibraryResultLimit) {
	      const separator = url.includes('?') ? '&' : '?';
	      const params = new URLSearchParams();
	      params.set('limit', Math.min(Math.max(1, Number(requestedLimit) || activeLibraryResultLimit), LIBRARY_RESULT_MAX));
	      params.set('offset', 0);
	      return `${url}${separator}${params.toString()}`;
	    }

	    function appendLibraryRootParams(url) {
	      if (!activeLibraryRootFilter) return url;
	      const separator = url.includes('?') ? '&' : '?';
	      const params = new URLSearchParams();
	      params.set('dna_root', activeLibraryRootFilter);
	      return `${url}${separator}${params.toString()}`;
	    }

	    function appendLibraryPreparationParams(url) {
	      const separator = url.includes('?') ? '&' : '?';
	      const params = new URLSearchParams();
	      params.set('preparation', activeLibraryPreparationFilter || 'all');
	      params.set('sort', libraryActiveSortMode());
	      return `${url}${separator}${params.toString()}`;
	    }

      let libraryBriefPage = null;
      let libraryMorePromise = null;
	    function resetLibraryResultWindow() {
	      activeLibraryResultLimit = LIBRARY_RESULT_STEP;
        libraryBriefPage = null;
	    }

	    function showMoreLibraryResults() {
        if (libraryMorePromise) return libraryMorePromise;
        const briefPaging = setBriefPayload().enabled && !window.AxiomDawFinder?.active && !document.getElementById('main-search').value.trim();
	      activeLibraryResultLimit = briefPaging ? activeLibraryResultLimit + LIBRARY_RESULT_STEP
          : Math.min(activeLibraryResultLimit + LIBRARY_RESULT_STEP, LIBRARY_RESULT_MAX);
        const button = document.querySelector('.library-show-more-btn');
        const label = button?.textContent;
        if (button) { button.disabled = true; button.textContent = 'Loading matches...'; }
        libraryMorePromise = runSearch().finally(() => {
          libraryMorePromise = null;
          if (button?.isConnected) { button.disabled = false; button.textContent = label; }
        });
        return libraryMorePromise;
	    }

      async function loadLibraryBriefPage(url, query, signal, isCurrent) {
        const key = `${activeLibraryQuerySignature}|${url}`;
        if (!libraryBriefPage || libraryBriefPage.key !== key) {
          libraryBriefPage = { key, tracks: new Map(), offset: 0, exhausted: false, data: null, matches: [] };
        }
        const page = libraryBriefPage;
        // The brief is a client-side filter. Walk server pages until enough
        // matching songs exist, rather than repeatedly filtering page zero.
        while (!page.exhausted && page.matches.length < activeLibraryResultLimit) {
          const address = new URL(url, window.location.origin);
          address.searchParams.set('offset', page.offset);
          const response = await fetch(address.pathname + address.search, { signal });
          if (!response.ok) throw new Error(`Library search returned ${response.status}`);
          const data = await response.json();
          if (!isCurrent()) return null;
          const batch = data.tracks || data.results || [];
          for (const track of batch) if (track.path) page.tracks.set(track.path, track);
          page.offset += batch.length;
          page.exhausted = !batch.length || Boolean(data.streaming_mode)
            || (Number.isFinite(Number(data.visible_tracks)) && page.offset >= Number(data.visible_tracks));
          page.data = data;
          page.matches = applyLibraryBriefLensToTracks([...page.tracks.values()], query);
        }
        return { ...page.data, tracks: [...page.tracks.values()], briefMatches: page.matches, briefHasMore: !page.exhausted };
      }

      function libraryTopSortServerMode(token) {
        return window.AxiomLibrarySort.serverMode(token);
      }

      function libraryTopSortLabel(token) {
        const field = window.AxiomLibrarySort.field(token);
        return ({ bpm: 'BPM', key: 'Key', year: 'Year', genre: 'Genre', title: 'Track' })[field] || '';
      }

      function libraryActiveTopSortStack() {
        return (typeof activeLibraryTopSortStack !== 'undefined' && Array.isArray(activeLibraryTopSortStack)) ? activeLibraryTopSortStack : [];
      }

      function libraryActiveSortMode() {
        const modes = libraryActiveTopSortStack().map(libraryTopSortServerMode).filter(Boolean);
        return modes.length ? modes.join(',') : activeLibraryFreshOrder
          ? `fresh:${activeLibraryFreshOrder.seed}:${activeLibraryFreshOrder.previous.join('.')}`
          : (activeLibraryPreparationSort || 'default');
      }

      function librarySortValueForTopSort(track, token) {
        if (token === 'bpm') {
          const bpm = Number(track?.bpm || track?.display_bpm || 0);
          return [!Number.isFinite(bpm) || bpm <= 0, Number.isFinite(bpm) ? bpm : 0];
        }
        if (token === 'key') {
          const value = String(track?.camelot || track?.key || track?.display_key || '').toUpperCase();
          const match = value.match(/(\d{1,2})([AB])/);
          return match ? [0, Number(match[1]), match[2]] : [1, 99, 'Z'];
        }
        if (token === 'year') {
          const year = Number(track?.year || track?.release_year || 0);
          return [!Number.isFinite(year) || year <= 0, Number.isFinite(year) ? -year : 0];
        }
        return [];
      }

      function sortLibraryRowsForTopSort(tracks) {
        if (!libraryActiveTopSortStack().length && activeLibraryFreshOrder) return window.AxiomLibrarySort.freshSort(Array.isArray(tracks) ? tracks : [], activeLibraryFreshOrder.seed, activeLibraryFreshOrder.previous);
        return window.AxiomLibrarySort.sort(Array.isArray(tracks) ? tracks : [], libraryActiveTopSortStack());
      }

      function syncLibraryTopSortControls() {
        const stack = libraryActiveTopSortStack();
        const doc = typeof document !== 'undefined' ? document : null;
        if (!doc) return;
        if (typeof doc.querySelectorAll === 'function') {
          doc.querySelectorAll('[data-library-top-sort]').forEach((button) => {
            const index = stack.findIndex(token => window.AxiomLibrarySort.field(token) === button.dataset.libraryTopSort);
            button.classList.toggle('active', index >= 0);
            button.setAttribute('aria-pressed', index >= 0 ? 'true' : 'false');
            button.dataset.sortOrder = index >= 0 ? String(index + 1) : '';
            button.dataset.sortDirection = index >= 0 ? (window.AxiomLibrarySort.descending(stack[index]) ? 'descending' : 'ascending') : '';
            const order = button.querySelector('.library-sort-order');
            if (order) order.textContent = index >= 0 ? String(index + 1) : '';
            const heading = button.closest('[role="columnheader"]');
            if (heading) heading.setAttribute('aria-sort', index === 0 ? button.dataset.sortDirection : index > 0 ? 'other' : 'none');
          });
        }
        const status = typeof doc.getElementById === 'function' ? doc.getElementById('library-top-sort-status') : null;
        if (status) {
          status.textContent = stack.length
            ? `Sorting by ${stack.map(token => `${libraryTopSortLabel(token)} ${window.AxiomLibrarySort.descending(token) ? 'descending' : 'ascending'}`).join(' then ')}`
            : 'Click a heading to sort. Ctrl-click or Command-click to add a secondary sort.';
          const copy = doc.getElementById('library-sort-description');
          if (copy) copy.textContent = status.textContent;
        }
      }

      function setLibraryTopSort(token, event = null) {
        if (!window.AxiomLibrarySort.fields.includes(token)) return;
        activeLibraryFreshOrder = null;
        const additive = Boolean(event?.metaKey || event?.ctrlKey);
        activeLibraryTopSortStack = window.AxiomLibrarySort.next(libraryActiveTopSortStack(), token, additive);
        resetLibraryResultWindow();
        syncLibraryTopSortControls();
        runSearch();
      }

      function clearLibraryTopSort() {
        activeLibraryFreshOrder = null;
        activeLibraryTopSortStack = [];
        resetLibraryResultWindow();
        syncLibraryTopSortControls();
        runSearch();
      }

      function clearLibraryTypedSearch() {
        const input = document.getElementById('main-search');
        input.value = '';
        resetLibraryResultWindow();
        runSearch();
        input.focus();
      }
	    function scheduleLibrarySearch() {
        if (window.AxiomDawFinder?.recommending) window.AxiomDawFinder.browse(true, false);
        clearTimeout(librarySearchTimer);
        librarySearchTimer = setTimeout(() => {
          runSearch();
	        }, 100);
      }

	    function setLibraryBpmFilter(value) {
	      activeLibraryBpmFilter = value || 'all';
	      resetLibraryResultWindow();
	      renderLibraryBriefLens();
	      runSearch();
	    }

	    function setLibraryRootFilter(value) {
	      activeLibraryRootFilter = value || '';
	      resetLibraryResultWindow();
	      renderLibraryBriefLens();
	      runSearch();
	    }

      function closeLibraryPreparationMenus(except = null) {
        document.querySelectorAll('#library-preparation-filter-menu, #library-preparation-sort-menu, #library-brief-lane-dropdown').forEach((menu) => {
          if (menu !== except) menu.removeAttribute('open');
        });
      }

      function syncLibraryPreparationOpenMenus(menu = null) {
        if (!menu?.open) return;
        closeLibraryPreparationMenus(menu);
      }

      function syncLibraryPreparationMenus() {
        [
          ['library-preparation-filter', 'library-preparation-filter-menu', 'library-preparation-filter-value'],
          ['library-preparation-sort', 'library-preparation-sort-menu', 'library-preparation-sort-value'],
        ].forEach(([selectId, menuId, valueId]) => {
          const select = document.getElementById(selectId);
          const menu = document.getElementById(menuId);
          const valueNode = document.getElementById(valueId);
          if (!select || !menu) return;
          const selected = select.selectedOptions?.[0];
          if (valueNode) valueNode.textContent = selected?.textContent || '';
          menu.querySelectorAll('[role="menuitemradio"][data-value]').forEach((button) => {
            const active = button.dataset.value === select.value;
            button.classList.toggle('active', active);
            button.setAttribute('aria-checked', active ? 'true' : 'false');
            const state = button.querySelector('.library-brief-chip-state');
            if (state) state.textContent = active ? 'Active' : '';
          });
        });
      }

      function syncLibraryPreparationLayoutContract() {
        const lens = document.getElementById('library-brief-lens');
        const scanButton = document.getElementById('library-preparation-scan-visible');
        const preparationOpen = libraryBriefActivePanel === 'preparation';
        document.body.classList.toggle('library-preparation-open', preparationOpen);
        if (!lens) return;
        lens.dataset.libraryPrepScanVisible = preparationOpen && scanButton && !scanButton.hidden ? 'true' : 'false';
        const panel = lens.querySelector(':scope > .library-brief-panel');
        const settings = document.getElementById('library-brief-settings');
        const toolbar = document.getElementById('library-preparation-toolbar');
        const topline = document.getElementById('library-brief-topline');
        const utility = document.getElementById('library-setup-utility-bar');
        const actionRail = document.getElementById('library-brief-action-rail');
        const lane = document.getElementById('library-brief-lane-dropdown');
        const collapse = document.getElementById('library-brief-collapse');
        const toggle = document.getElementById('library-preparation-toggle');
        const toolbarCopy = toolbar?.querySelector('.library-preparation-toolbar-copy');
        const filterMenu = document.getElementById('library-preparation-filter-menu');
        const sortMenu = document.getElementById('library-preparation-sort-menu');
        const filterField = filterMenu?.closest('.library-preparation-menu-field');
        const sortField = sortMenu?.closest('.library-preparation-menu-field');
        const filterSummary = filterMenu?.querySelector('summary');
        const sortSummary = sortMenu?.querySelector('summary');
        const filterSelect = document.getElementById('library-preparation-filter');
        const sortSelect = document.getElementById('library-preparation-sort');
        const managed = [
          lens, panel, settings, toolbar, toolbarCopy, topline, utility, actionRail,
          lane, collapse, toggle, filterField, sortField, filterMenu, sortMenu,
          filterSummary, sortSummary, filterSelect, sortSelect, scanButton,
        ].filter(Boolean);
        const clearManagedStyles = () => managed.forEach((element) => {
          String(element.dataset.nativePrepManaged || '').split(',').filter(Boolean).forEach((property) => element.style.removeProperty(property));
          delete element.dataset.nativePrepManaged;
        });
        clearManagedStyles();
        if (!preparationOpen) return;
        const setManaged = (element, properties = {}) => {
          if (!element) return;
          const names = new Set(String(element.dataset.nativePrepManaged || '').split(',').filter(Boolean));
          Object.entries(properties).forEach(([property, value]) => {
            element.style.setProperty(property, value, 'important');
            names.add(property);
          });
          element.dataset.nativePrepManaged = [...names].join(',');
        };
        const compact = window.innerWidth <= 1180;
        const hasScanAction = Boolean(scanButton && !scanButton.hidden);
        setManaged(lens, {
          display: 'grid',
          'grid-template-columns': compact ? 'minmax(0, 1fr)' : 'minmax(0, 1.55fr) minmax(420px, .9fr)',
          'grid-template-rows': compact ? 'auto auto auto auto' : 'minmax(52px, auto) auto auto',
          'min-height': compact ? '116px' : '66px',
          'column-gap': '8px',
          'row-gap': compact ? '6px' : '0',
        });
        setManaged(panel, { display: 'block', 'grid-column': '1', 'grid-row': compact ? '1' : '1 / 4', 'min-width': '0' });
        setManaged(settings, { display: 'block', width: '100%', 'min-width': '0', margin: '0', padding: '0' });
        // Measure the exposed drawer in its new parent grid, including on first
        // open when the toolbar still carries its hidden class.
        setManaged(toolbar, { display: 'grid', width: '100%', 'min-width': '0' });
        const toolbarWidth = Number(toolbar?.getBoundingClientRect?.().width || 0);
        const toolbarNarrow = toolbarWidth > 0 && toolbarWidth < 640;
        setManaged(toolbar, {
          display: 'grid',
          'grid-template-columns': hasScanAction
            ? toolbarNarrow
              ? 'repeat(2, minmax(0, 1fr))'
              : compact
                ? 'minmax(0, 1.05fr) minmax(0, .78fr) minmax(130px, .95fr)'
                : 'minmax(190px, 1.15fr) minmax(140px, .78fr) minmax(200px, 1.1fr)'
            : 'repeat(2, minmax(0, 1fr))',
          'grid-template-rows': hasScanAction && toolbarNarrow ? '44px 40px' : '44px',
          'align-items': 'center', gap: '6px', width: '100%', 'min-width': '0', 'min-height': '44px', margin: '0', padding: '0',
        });
        setManaged(toolbarCopy, { display: 'none' });
        setManaged(filterField, {
          display: 'grid', 'grid-template-rows': '10px 32px', 'grid-column': '1', 'grid-row': '1',
          gap: '2px', width: '100%', 'min-width': '0', height: '44px', margin: '0', padding: '0', overflow: 'visible',
        });
        setManaged(sortField, {
          display: 'grid', 'grid-template-rows': '10px 32px', 'grid-column': '2', 'grid-row': '1',
          gap: '2px', width: '100%', 'min-width': '0', height: '44px', margin: '0', padding: '0', overflow: 'visible',
        });
        [filterMenu, sortMenu].forEach((menu) => setManaged(menu, {
          display: 'block', position: 'relative', width: '100%', 'min-width': '0', height: '32px', margin: '0', overflow: 'visible',
        }));
        [filterSummary, sortSummary].forEach((summary) => setManaged(summary, {
          // Keep summary a block for macOS 12 WebKit; the chevron is positioned in CSS.
          display: 'block', position: 'relative', 'list-style': 'none',
          width: '100%', 'min-width': '0', height: '32px', 'min-height': '32px', margin: '0', padding: '0',
        }));
        [filterSelect, sortSelect].forEach((select) => setManaged(select, { display: 'none' }));
        setManaged(scanButton, {
          display: scanButton && !scanButton.hidden ? 'inline-flex' : 'none', 'grid-column': '3', 'grid-row': '1',
          'align-items': 'center', 'justify-content': 'center', width: '100%', 'min-width': '0',
          height: '40px', 'min-height': '40px', margin: '0', padding: '0 14px', overflow: 'visible',
        });
        if (hasScanAction && toolbarNarrow) {
          setManaged(scanButton, { 'grid-column': '1 / -1', 'grid-row': '2', 'white-space': 'normal', 'line-height': '1.05' });
        }
        setManaged(topline, {
          display: 'grid', 'grid-column': compact ? '1' : '2', 'grid-row': compact ? '2' : '1',
          'grid-template-columns': 'minmax(0, 1fr) 150px', 'align-items': 'center', gap: '6px', width: '100%', 'min-width': '0', 'min-height': '44px', margin: '0', padding: '0',
        });
        setManaged(utility, {
          display: 'grid', 'grid-column': '1', 'grid-row': '1', 'grid-template-columns': 'minmax(0, 1fr) 116px',
          'align-items': 'center', gap: '6px', width: '100%', 'min-width': '0', margin: '0', padding: '0',
        });
        setManaged(actionRail, {
          display: 'grid', 'grid-column': '2', 'grid-row': '1', 'grid-template-columns': 'minmax(0, 1fr)',
          'align-items': 'center', width: '100%', 'min-width': '0', margin: '0', padding: '0',
        });
        setManaged(lane, { 'grid-column': '1', 'grid-row': '1' });
        setManaged(collapse, { 'grid-column': '2', 'grid-row': '1' });
        setManaged(toggle, { 'grid-column': '1', 'grid-row': '1' });
      }

      window.addEventListener('resize', () => {
        if (libraryBriefActivePanel === 'preparation') syncLibraryPreparationLayoutContract();
      }, { passive: true });

      function chooseLibraryPreparationMenu(selectId, value, button = null) {
        const select = document.getElementById(selectId);
        if (!select) return;
        select.value = value;
        button?.closest('details')?.removeAttribute('open');
        if (selectId === 'library-preparation-filter') {
          setLibraryPreparationFilter(value);
        } else if (selectId === 'library-preparation-sort') {
          setLibraryPreparationSort(value);
        }
        syncLibraryPreparationMenus();
      }

		    function setLibraryPreparationFilter(value) {
		      activeLibraryPreparationFilter = ['missing_metadata', 'missing_file'].includes(value)
		        ? value
		        : 'missing_metadata';
	      if (activeLibraryPreparationFilter !== 'all' && activeLibraryPreparationFilter !== 'ready' && activeLibraryPreparationSort === 'default') {
	        activeLibraryPreparationSort = 'missing_first';
	        const sortSelect = document.getElementById('library-preparation-sort');
	        if (sortSelect) sortSelect.value = activeLibraryPreparationSort;
	      }
	      syncLibraryPreparationMenus();
	      resetLibraryResultWindow();
	      if (lastLibraryPreparationReceiptJob) renderLibraryPreparationScanReceipt(lastLibraryPreparationReceiptJob);
	      runSearch();
	    }

	    function setLibraryPreparationSort(value) {
	      activeLibraryPreparationSort = value || 'default';
	      syncLibraryPreparationMenus();
	      resetLibraryResultWindow();
	      syncLibraryRecentlyAddedControl();
	      runSearch();
	    }

      function libraryRecentlyAddedActive() {
        return activeLibraryPreparationFilter === 'all'
          && activeLibraryPreparationSort === 'recent'
          && !libraryBriefActivePanel;
      }

      function syncLibraryRecentlyAddedControl() {
        const active = libraryRecentlyAddedActive();
        const button = document.getElementById('library-recent-toggle');
        const helper = document.getElementById('library-source-helper');
        if (button) {
          button.classList.toggle('active', active);
          button.setAttribute('aria-pressed', active ? 'true' : 'false');
          button.title = active ? 'Return to the full Library' : 'Show newest indexed tracks first';
        }
        if (helper) {
          helper.textContent = active
            ? 'Newest tracks AXIOM has indexed are shown first. Source audio remains untouched.'
            : 'Connect DJ software, explore with streaming, or choose a music folder.';
        }
      }

      function leaveLibraryRecentlyAddedMode() {
        if (activeLibraryPreparationSort !== 'recent') return false;
        activeLibraryPreparationSort = 'default';
        const sort = document.getElementById('library-preparation-sort');
        if (sort) sort.value = 'default';
        syncLibraryRecentlyAddedControl();
        return true;
      }

      async function toggleLibraryRecentlyAdded(button = null) {
        activeLibraryFreshOrder = null;
        const enable = !libraryRecentlyAddedActive();
        clearTimeout(libraryPreparationCloseTimer);
        clearTimeout(libraryBriefPanelHideTimer);
        activeLibraryPreparationFilter = 'all';
        activeLibraryPreparationSort = enable ? 'recent' : 'default';
        activeLibraryBriefLane = 'best';
        currentSetBrief = normalizeSetBrief({ ...currentSetBrief, enabled: false, era: 'All' });
        activeEra = 'All';
        activeLibraryBpmFilter = 'all';
        activeLibraryRootFilter = '';
        libraryBriefActivePanel = '';
        libraryBriefSetupExpanded = false;
        localStorage.setItem(LIBRARY_BRIEF_SETUP_KEY, 'false');
        document.getElementById('library-brief-lane-dropdown')?.removeAttribute('open');
        const settings = document.getElementById('library-brief-settings');
        if (settings) {
          settings.classList.add('hidden');
          settings.dataset.libraryPanelMotion = 'closed';
        }
        const search = document.getElementById('main-search');
        const era = document.getElementById('library-era-filter');
        const bpm = document.getElementById('library-bpm-filter');
        const root = document.getElementById('library-root-filter');
        const preparation = document.getElementById('library-preparation-filter');
        const sort = document.getElementById('library-preparation-sort');
        if (search) search.value = '';
        if (era) era.value = 'All';
        if (bpm) bpm.value = 'all';
        if (root) root.value = '';
        if (preparation) preparation.value = 'all';
        if (sort) sort.value = activeLibraryPreparationSort;
        resetLibraryResultWindow();
        renderStudioSetBriefBar();
        renderLibraryBriefLens();
        setAxiomButtonBusy(button, true, enable ? 'Opening Recent...' : 'Opening Library...');
        try {
          await runSearch();
          showToast(enable ? 'Showing recently added music first.' : 'Showing the full Library.');
        } finally {
          setAxiomButtonBusy(button, false);
          syncLibraryRecentlyAddedControl();
        }
      }

      async function returnToAllLibraryTracks(button = null, options = {}) {
        activeLibraryFreshOrder = null;
        const preserveReceipt = Boolean(options?.preserveReceipt);
        const silent = Boolean(options?.silent);
        clearTimeout(libraryPreparationCloseTimer);
        clearTimeout(libraryBriefPanelHideTimer);
        document.body.classList.add('library-preparation-closing');
        activeEra = 'All';
        activeLibraryBpmFilter = 'all';
        activeLibraryRootFilter = '';
        activeLibraryPreparationFilter = 'all';
        activeLibraryPreparationSort = 'default';
        activeLibraryBriefLane = 'best';
        currentSetBrief = normalizeSetBrief({ ...currentSetBrief, enabled: false, era: 'All' });
        const searchInput = document.getElementById('main-search');
        const eraSelect = document.getElementById('library-era-filter');
        const bpmSelect = document.getElementById('library-bpm-filter');
        const rootSelect = document.getElementById('library-root-filter');
        const preparationSelect = document.getElementById('library-preparation-filter');
        const sortSelect = document.getElementById('library-preparation-sort');
        if (searchInput) searchInput.value = '';
        if (eraSelect) eraSelect.value = 'All';
        if (bpmSelect) bpmSelect.value = 'all';
        if (rootSelect) rootSelect.value = '';
        if (preparationSelect) preparationSelect.value = 'all';
        if (sortSelect) sortSelect.value = 'default';
        libraryBriefActivePanel = '';
        libraryBriefSetupExpanded = false;
        localStorage.setItem(LIBRARY_BRIEF_SETUP_KEY, 'false');
        document.getElementById('library-brief-lane-dropdown')?.removeAttribute('open');
        const settings = document.getElementById('library-brief-settings');
        if (settings) {
          settings.classList.add('hidden');
          settings.dataset.libraryPanelMotion = 'closed';
        }
        if (!preserveReceipt) renderLibraryPreparationScanReceipt(null);
        resetLibraryResultWindow();
        renderStudioSetBriefBar();
        renderLibraryBriefLens();
        setAxiomButtonBusy(button, true, 'Opening Library...');
        try {
          await runSearch();
          if (!silent) showToast('Showing your Library again. Track Preparation filters are cleared.');
        } finally {
          setAxiomButtonBusy(button, false);
          requestAnimationFrame(() => requestAnimationFrame(() => {
            if (libraryBriefActivePanel !== 'preparation') {
              document.body.classList.remove('library-preparation-closing');
            }
          }));
        }
      }

	    function clearLibrarySearchFilters() {
	      activeLibraryBpmFilter = 'all';
	      activeLibraryRootFilter = '';
	      activeLibraryPreparationFilter = 'all';
	      activeLibraryPreparationSort = 'default';
	      const bpm = document.getElementById('library-bpm-filter');
	      if (bpm) bpm.value = 'all';
	      const root = document.getElementById('library-root-filter');
	      if (root) root.value = '';
	      const era = document.getElementById('library-era-filter');
	      if (era) era.value = 'All';
	      const prep = document.getElementById('library-preparation-filter');
	      if (prep) prep.value = 'all';
	      const prepSort = document.getElementById('library-preparation-sort');
	      if (prepSort) prepSort.value = 'default';
	      setEraFilter('All');
	    }

	    function setupLibraryEraTooltips() {
	      const strip = document.getElementById('era-filters');
	      if (!strip || strip.dataset.tooltipsReady === 'true') return;
	      strip.dataset.tooltipsReady = 'true';

	      let tooltip = document.getElementById('library-era-tooltip');
	      if (!tooltip) {
	        tooltip = document.createElement('div');
	        tooltip.id = 'library-era-tooltip';
	        tooltip.className = 'library-era-tooltip';
	        tooltip.innerHTML = `
	          <span class="library-era-tooltip-label"></span>
	          <strong class="library-era-tooltip-detail"></strong>
	        `;
	        document.body.appendChild(tooltip);
	      }

	      const labelEl = tooltip.querySelector('.library-era-tooltip-label');
	      const detailEl = tooltip.querySelector('.library-era-tooltip-detail');

	      const positionTooltip = (button) => {
	        tooltip.classList.add('visible');
	        const rect = button.getBoundingClientRect();
	        const width = tooltip.offsetWidth || 260;
	        const height = tooltip.offsetHeight || 54;
	        const left = Math.min(window.innerWidth - width - 14, Math.max(14, rect.left + (rect.width / 2) - (width / 2)));
	        const belowTop = rect.bottom + 10;
	        const top = belowTop + height > window.innerHeight - 14 ? Math.max(14, rect.top - height - 10) : belowTop;
	        tooltip.style.left = `${left}px`;
	        tooltip.style.top = `${top}px`;
	      };

	      const showTooltip = (button) => {
	        if (!button?.dataset?.eraDetail) return;
	        labelEl.textContent = button.textContent.trim();
	        detailEl.textContent = button.dataset.eraDetail;
	        positionTooltip(button);
	      };

	      const hideTooltip = () => {
	        tooltip.classList.remove('visible');
	      };

	      strip.addEventListener('mouseover', (event) => {
	        const button = event.target.closest('.era-btn[data-era-detail]');
	        if (button && strip.contains(button)) showTooltip(button);
	      });

	      strip.addEventListener('mousemove', (event) => {
	        const button = event.target.closest('.era-btn[data-era-detail]');
	        if (button && strip.contains(button)) showTooltip(button);
	      });

	      strip.addEventListener('mouseout', (event) => {
	        const button = event.target.closest('.era-btn[data-era-detail]');
	        if (button && (!event.relatedTarget || !button.contains(event.relatedTarget))) hideTooltip();
	      });

	      strip.addEventListener('focusin', (event) => {
	        const button = event.target.closest('.era-btn[data-era-detail]');
	        if (button && strip.contains(button)) showTooltip(button);
	      });

	      strip.addEventListener('focusout', hideTooltip);
	      window.addEventListener('scroll', hideTooltip, true);
	      window.addEventListener('resize', hideTooltip);
	    }

	    if (document.readyState === 'loading') {
	      document.addEventListener('DOMContentLoaded', setupLibraryEraTooltips);
	    } else {
	      setupLibraryEraTooltips();
	    }

	    function setEraFilter(era, syncBrief = true) {
	      activeEra = era || 'All';
	      resetLibraryResultWindow();
	      const eraSelect = document.getElementById('library-era-filter');
	      if (eraSelect && eraSelect.value !== activeEra) eraSelect.value = activeEra;
	      if (syncBrief && setBriefPayload().enabled) {
	        currentSetBrief = normalizeSetBrief({ ...currentSetBrief, era: activeEra });
	        renderStudioSetBriefBar();
	      }
	      renderLibraryBriefLens();
	      runSearch();
	    }

    // ========== RUN SEARCH WITH ENHANCED DNA PILLAR / VELOCITY / TEXTURE HANDLING ==========
	    async function runSearch() {
        const dawFinding = Boolean(window.AxiomDawFinder?.active);
        const requestId = ++librarySearchRequestId;
	      if (librarySearchAbortController) librarySearchAbortController.abort();
	      librarySearchAbortController = new AbortController();
        const q = document.getElementById('main-search').value.trim().toLowerCase();
	      renderLibraryBriefLens();
        if (window.AxiomLibraryQuery) {
          const feedback = document.getElementById('library-search-feedback');
          const understood = document.getElementById('library-search-understood');
          if (feedback && understood) {
            feedback.hidden = !q;
            understood.textContent = q ? `Searching: ${AxiomLibraryQuery.describe(AxiomLibraryQuery.parse(q))}` : '';
          }
        }
        const entranceReadyReview = new URLSearchParams(location.search).get('entrance_library') === 'ready'
          && (window.__axiomEntranceSession?.fixture === true || ['studio-start', 'quick-start'].includes(axiomReviewMode()));
        const libraryReviewFixtureReady = typeof libraryPreparationRowsForDisplay === 'function' && typeof libraryGapReviewTracks === 'function';
        if (libraryReviewFixtureReady && (entranceReadyReview || ['library', 'library-gap-checker', 'library-state-audit'].includes(axiomReviewMode()))) {
          const reviewLibraryTracks = window.AxiomLibraryDesign?.reviewTracks(libraryGapReviewTracks()) || libraryGapReviewTracks();
          const reviewSourceTracks = libraryPreparationRowsForDisplay(reviewLibraryTracks);
          const reviewCandidates = dawFinding ? libraryGapReviewTracks() : reviewSourceTracks;
          const searchedReviewTracks = window.AxiomLibraryQuery
            ? AxiomLibraryQuery.filter(reviewCandidates, q)
            : reviewCandidates.filter(t => !q || [t.title,t.artist,t.path,t.genre].join(' ').toLowerCase().includes(q));
          const unsortedReviewTracks = dawFinding ? searchedReviewTracks : applyLibraryBriefLensToTracks(searchedReviewTracks, q);
          const reviewTracks = sortLibraryRowsForTopSort(unsortedReviewTracks);
          const reviewDisplayTracks = reviewTracks.slice(0, activeLibraryResultLimit);
          const reviewTrackTotal = entranceReadyReview || ['library', 'library-state-audit'].includes(axiomReviewMode()) ? reviewLibraryTracks.length : 23226;
          libraryHasTracks = true;
          mainSearchResults = reviewDisplayTracks.slice();
          updateLibraryCount(reviewTrackTotal);
          document.body.classList.remove('library-empty', 'connect-music-stage');
          document.getElementById('connect-music-view')?.classList.add('hidden');
          renderLibraryBriefLens(reviewTracks);
          renderLibraryResults(reviewDisplayTracks, {
            total: reviewTracks.length,
            total_tracks: reviewTrackTotal,
            visible_tracks: reviewTracks.length,
            hidden_by_set_brief: Math.max(0, reviewSourceTracks.length - reviewTracks.length)
          });
          rememberLibraryFreshness(reviewDisplayTracks, setBriefPayload(), q);
          return;
        }
        const brief = dawFinding ? {enabled:false} : setBriefPayload();
	      const briefSignature = brief.enabled
	        ? [brief.intention, brief.audience, brief.setting, brief.lyrics, brief.soundFocus, brief.energyJourney, brief.planningStyle, brief.duration, brief.era].join(':')
	        : 'off';
        window.AxiomDawFinder?.syncBackButton?.();
        if (typeof syncLibraryTopSortControls === 'function') syncLibraryTopSortControls();
        const topSortSignature = libraryActiveSortMode();
	      const signature = `${q}|${activeEra}|${activeLibraryBpmFilter}|${activeLibraryRootFilter}|${activeLibraryPreparationFilter}|${activeLibraryPreparationSort}|${topSortSignature}|${briefSignature}|${activeLibraryBriefLane}`;
	      if (signature !== activeLibraryQuerySignature) {
	        activeLibraryQuerySignature = signature;
	        clearLibraryBatchSelection();
	        resetLibraryResultWindow();
	      }

      if (!q && libraryHasTracks === false) {
        renderLibraryConnectionPrompt();
        return;
      }

      // One real search path covers title, artist, filename, genre, folder,
      // musical metadata, and AXIOM classification fields. This prevents a
      // song title from being diverted into a different filter endpoint.
      let url = `/api/library/search?q=${encodeURIComponent(q)}&era=${encodeURIComponent(dawFinding ? 'All' : activeEra)}`;

      if (!q && !brief.enabled) {
          url = `/get-tracks?era=${encodeURIComponent(dawFinding ? 'All' : activeEra)}`;
      }

        const briefPaging = brief.enabled && !q;
	      const candidateLimit = briefPaging ? LIBRARY_RESULT_MAX : activeLibraryResultLimit;
	      url = appendLibraryPagingParams(dawFinding ? url : appendLibraryPreparationParams(appendLibraryRootParams(appendLibraryBpmParams(url))), candidateLimit);
      let data;
      try {
        const signal = librarySearchAbortController.signal;
        if (briefPaging) {
          data = await loadLibraryBriefPage(url, q, signal, () => requestId === librarySearchRequestId);
        } else {
          const resp = await fetch(url, { signal });
          if (!resp.ok) throw new Error(`Library search returned ${resp.status}`);
          data = await resp.json();
        }
      } catch (error) {
        if (error?.name === 'AbortError') return;
        console.error('Library search failed:', error);
        if (requestId === librarySearchRequestId) showToast('Library search could not finish. Try again.');
        return;
      }
      if (requestId !== librarySearchRequestId || !data) return;
      if (!handleLibraryBpmReadiness(data, false)) return;
      if (libraryNeedsBpmRepair(data) && Number(data.visible_tracks || 0) === 0) {
        renderLibraryBpmRepairPrompt(data);
        return;
      }
      const rawTracks = data.tracks || data.results || [];
	      const lensTracks = sortLibraryRowsForTopSort(briefPaging ? data.briefMatches : dawFinding ? rawTracks : applyLibraryBriefLensToTracks(rawTracks, q));
	      const displayTracks = lensTracks.slice(0, activeLibraryResultLimit);
      mainSearchResults = displayTracks.slice();
      const context = {
        ...data,
        total: briefPaging ? lensTracks.length : Math.max(Number(data.visible_tracks || 0), lensTracks.length),
        briefPaging,
        visible_tracks: lensTracks.length,
        hidden_by_set_brief: Math.max(0, rawTracks.length - lensTracks.length)
	      };
	      renderLibraryBriefLens(lensTracks);
	      renderLibraryResults(displayTracks, context);
	      rememberLibraryFreshness(displayTracks, brief, q);
	      maybeShowLibraryGuide();
	    }

/* Library surface: track-row and result-list rendering. */
	    // ========== RENDER LIBRARY WITH DNA BADGES (PILLAR // ROOT // TEXTURE) ==========
	    function renderLibraryResults(tracks, context = {}) {
	      tracks = Array.isArray(tracks) ? tracks : [];
      const selectedLibraryPath = document.querySelector('#search-results > .library-track-card.selected')?.dataset.path || '';
      const totalMatches = Math.max(Number(context.total ?? context.library_total_tracks ?? context.total_tracks ?? tracks.length), tracks.length);
      activeLibraryPreparationFilteredTotal = totalMatches;
      if (lastLibraryPreparationReceiptJob) renderLibraryPreparationScanReceipt(lastLibraryPreparationReceiptJob);
      updateLibraryPreparationScanButton(tracks, context);
      renderLibraryBriefLens(tracks);
      if (tracks.length === 0) {
        clearLibraryBatchSelection();
        if (libraryHasTracks === false) {
          renderLibraryConnectionPrompt();
        } else {
          renderLibraryNoMatches(context);
        }
	        return;
	      }
	      const hasMoreLibraryRows = context.briefPaging
          ? context.briefHasMore || totalMatches > tracks.length
          : totalMatches > tracks.length && activeLibraryResultLimit < LIBRARY_RESULT_MAX;
	      const activeEraLabel = activeEra && activeEra !== 'All' ? ` &middot; ${escapeHtml(activeEra)}` : '';
	      const renderedRows = tracks.map(t => {
	        cacheTrackVisual(t);
	        const isPlaying = currentPlayingPath === t.path;
        const isSelected = selectedLibraryPath === t.path;
        const isPlayed = previewedTracks.has(`${window.location.origin}/api/library/stream?path=${encodeURIComponent(t.path)}`);
        const briefScores = libraryBriefScores(t);
        const briefHighlight = setBriefPayload().enabled && (briefScores[activeLibraryBriefLane || 'best'] || 0) >= 34;
        const rawGenreLabel = String(t.genre || '').trim();
        const rawGenreRoot = libraryManualGenreRoot(rawGenreLabel);
        const brain = getGenreBrain(t.genre);
        const root = rawGenreRoot || (brain ? brain.root : (getRootFromSuggestion(t) || 'RAW'));
        const pillar = brain ? brain.pillar : (root !== 'RAW' ? `${root.toUpperCase()}-AUTO` : 'DNA-X');
        const texture = brain ? brain.texture : 'Raw';
        const velocity = brain ? brain.velocity : 'Z-00';
        const energy = brain ? brain.energy : (t.energy || 'Unknown');

        const velocityVal = parseInt(velocity.replace('Z-', '')) || 0;
        const velocityColor = velocityVal >= 8 ? '#ef4444' : '#FFFFFF';
        const displayKey = trustedTrackKey(t);
        const keyClass = camelotClass(displayKey);
        const pillarClass = root.toLowerCase() === 'urban' ? 'pillar-urban' :
                           root.toLowerCase() === 'global' ? 'pillar-global' :
                           root.toLowerCase() === 'local music' ? 'pillar-local-music' :
                           root.toLowerCase() === 'mashup / edits' ? 'pillar-mashup-edits' :
                           root.toLowerCase() === 'electronic' ? 'pillar-electronic' :
                           root.toLowerCase() === 'pop' ? 'pillar-pop' :
                           'pillar-utility';
        const energyClass = getEnergyClass(energy);
        const rawGenreContext = rawGenreLabel.toLowerCase();
        const shouldPreferRawGenre = rawGenreLabel && (rawGenreRoot || root.toLowerCase() === 'utility' || root.toLowerCase() === 'raw') && (
          rawGenreContext.includes('african') || rawGenreContext.includes('afro') || rawGenreContext.includes('amapiano') ||
          rawGenreContext.includes('latin') || rawGenreContext.includes('dancehall') || rawGenreContext.includes('reggaeton') ||
          rawGenreContext.includes('soca') || rawGenreContext.includes('international') || rawGenreContext.includes('disco') ||
          rawGenreContext.includes('retro') || rawGenreContext.includes('throwback') || rawGenreContext.includes('old school') ||
          rawGenreContext.includes('rap') || rawGenreContext.includes('hip hop') || rawGenreContext.includes('rnb') ||
          rawGenreContext.includes('r&b') || rawGenreContext.includes('east coast') || rawGenreContext.includes('west coast') || rawGenreContext.includes('top 40') ||
          rawGenreContext.includes('top40') || rawGenreContext.includes('pop') || rawGenreContext.includes('nz') ||
          rawGenreContext.includes('new zealand') || rawGenreContext.includes('poly') || rawGenreContext.includes('soundcloud') ||
          rawGenreContext.includes('refreshed') || rawGenreContext.includes('mashup')
        );
        const mainChip = (window.AxiomLibraryDesign && rawGenreLabel) || shouldPreferRawGenre ? rawGenreLabel : (root && root !== 'RAW' ? root : (pillar && pillar !== 'DNA-X' ? pillar : (rawGenreLabel || 'DNA')));
        const mainChipVisual = libraryGenreBadgeVisual(mainChip, t);
        const safePath = escapeJs(t.path);
	        const healthIssues = libraryHealthIssuesForTrack(t);
	        const sourceDisconnected = t.source_connected === false;
	        const isAnchor = String(currentAnchorTrack?.path || '') === String(t.path || '');
	        const batchHalfSelected = libraryBatchBpmSelection.has(String(t.path || ''));
	        const batchBpm = Number(t.bpm || 0);
	        const batchHalfReady = Number.isFinite(batchBpm) && batchBpm >= 40 && batchBpm <= 300;
	        const batchSelectReady = Boolean(String(t.path || '').trim()) && !sourceDisconnected;
	        const rowLabel = `${t.title || 'Unknown Title'} by ${t.artist || 'Unknown Artist'}${t.bpm ? `, ${Math.round(Number(t.bpm))} BPM` : ''}${displayKey ? `, key ${displayKey}` : ', key needs review'}`;
	        const playCall = sourceDisconnected
	          ? `event.stopPropagation(); openLibraryTrackPreparation('${safePath}')`
	          : `event.stopPropagation(); playAudioFile('${safePath}', '${escapeJs(t.title)}', '${escapeJs(t.artist)}', ${t.bpm || 0}, '${escapeJs(t.camelot)}', '${escapeJs(t.energy)}', event, '${escapeJs(t.genre || '')}'); highlightLibraryTrack(this.closest('.vampire-row'));`;

        return `
        <div class="vampire-row library-track-card axiom-focus-deck-row cursor-pointer group ${energyClass} ${pillarClass} ${healthIssues.length ? 'needs-health-repair' : ''} ${sourceDisconnected ? 'library-track-missing-file' : ''} ${briefHighlight ? 'library-brief-highlight' : ''} ${batchHalfSelected ? 'batch-selected' : ''} ${isPlayed ? 'played' : ''} ${isPlaying ? 'playing-track library-track-playing' : ''} ${isSelected ? 'selected' : ''}" data-path="${escapeHtml(t.path)}" data-batch-select-ready="${batchSelectReady ? 'true' : 'false'}" data-batch-half-ready="${batchHalfReady ? 'true' : 'false'}" draggable="${sourceDisconnected ? 'false' : 'true'}" tabindex="0" role="listitem" aria-label="${escapeHtml(rowLabel)}" aria-selected="${batchHalfSelected ? 'true' : 'false'}" aria-current="${isSelected || (!selectedLibraryPath && isAnchor) ? 'true' : 'false'}" onkeydown="activateFocusDeckRow(event)" oncontextmenu="return window.openLibraryDawTrackMenu?.(event, '${safePath}')" ${sourceDisconnected ? '' : `ondragstart="dragTrackFromLibrary(event, '${safePath}')"`} onclick="${playCall}">
            <button type="button" class="library-selection-rail library-batch-selector" aria-label="${batchSelectReady ? `Select ${escapeHtml(t.title || 'track')} for batch actions` : `Batch actions unavailable for ${escapeHtml(t.title || 'track')}`}" aria-pressed="${batchHalfSelected ? 'true' : 'false'}" ${batchSelectReady ? `onclick="event.stopPropagation(); toggleLibraryBatchBpmSelection('${safePath}')"` : 'disabled'} title="${batchSelectReady ? 'Select for Library batch actions' : 'Reconnect this music file to use batch actions'}"><span class="library-batch-check" aria-hidden="true"></span></button>
            ${renderFocusDeckMarker()}
            ${renderTrackArtwork(t, 'library-artwork', playCall)}
            <div class="library-track-main cursor-pointer" onclick="${playCall}">
                <div class="library-track-identity">
                    <p class="library-track-title track-title-resize"><span class="preview-icon hidden text-[var(--accent)] mr-1">▶</span>${escapeHtml(t.title)}</p>
                    <p class="library-track-artist track-artist-resize">${escapeHtml(t.artist || 'Unknown Artist')}</p>
                    <div class="library-row-meta-stack">
                        <span class="library-dna-chip dna-badge library-genre-editable ${mainChipVisual.className} ${root.toLowerCase() === 'pop' ? 'dna-badge-pillar' : ''}" style="${mainChipVisual.style}" title="Click to edit genre" onclick="event.stopPropagation(); promptUpdateGenre('${safePath}', '${escapeJs(t.genre || mainChip || '')}')">${escapeHtml(mainChip)}</span>
                        ${document.querySelector('meta[name="axiom-edition"]')?.content === 'pro'
                          ? `<button type="button" class="library-row-year library-year-editable" title="Edit release year" aria-label="Edit release year for ${escapeHtml(t.title || 'track')}" onclick="event.stopPropagation(); openLibraryTrackPreparation('${safePath}', 'year')">${escapeHtml(formatTrackYear(t))}</button>`
                          : `<span class="library-row-year">${escapeHtml(formatTrackYear(t))}</span>`}
                    </div>
                </div>
                <div class="library-track-detail-lane">
                    ${renderLibraryBriefBadges(t)}
                    ${renderLibraryHealthChips(t)}
                </div>
            </div>
            ${renderMiniWaveform(t, isPlaying)}
            <div class="library-bpm-cell library-bpm-editable ${t.bpm ? 'has-bpm' : 'is-missing'}" title="Open Title, Artist, BPM, Key, and Year" onclick="event.stopPropagation(); openLibraryTrackPreparation('${escapeJs(t.path)}')">
                <span style="color: ${t.bpm ? velocityColor : '#EAB308'};" class="library-bpm-value bpm-block cursor-pointer" aria-label="Open track information from BPM">${t.bpm ? Math.round(parseFloat(t.bpm)) : '--'}</span>
                <small class="library-bpm-label">BPM</small>
                <div class="library-bpm-tools">
                    ${t.bpm ? `
                    <button onclick="event.stopPropagation(); adjustBpm('${escapeJs(t.path)}', ${t.bpm || 0}, 'half')" title="Halve BPM">1/2</button>
                    <button onclick="event.stopPropagation(); adjustBpm('${escapeJs(t.path)}', ${t.bpm || 0}, 'double')" title="Double BPM">2x</button>
                    ` : `
                    <button onclick="event.stopPropagation(); openLibraryTrackPreparation('${escapeJs(t.path)}')" title="Scan or enter BPM" style="border-color:rgba(234,179,8,0.5);color:#EAB308;">Scan</button>
                    `}
                </div>
            </div>
            <div class="library-key-cell library-key-metric ${displayKey ? 'has-key' : 'is-missing'}">
                <button onclick="event.stopPropagation(); openLibraryTrackPreparation('${escapeJs(t.path)}')" class="camelot-pill ${keyClass} font-heading text-sm cursor-pointer hover:scale-105 transition-transform" title="${displayKey ? 'Open Title, Artist, BPM, Key, and Year' : 'Key is unresolved. Review or enter track information.'}">${displayKey || (t.key_estimated || t.key_suggestion ? 'Review' : 'Find')}</button>
                <small>KEY</small>
            </div>
            <button onclick="event.stopPropagation(); addTrackFromLibrary('${escapeJs(t.path)}', '${escapeJs(t.title)}', '${escapeJs(t.artist)}', ${t.bpm || 0}, '${escapeJs(displayKey)}', '${escapeJs(t.energy)}', '${escapeJs(t.genre || '')}')" class="hud-pill library-add-btn button--primary">${window.AxiomDawFinder?.active ? 'Add to DAW' : 'Add'}</button>
            <button onclick="event.stopPropagation(); toggleFavorite({path:'${escapeJs(t.path)}',title:'${escapeJs(t.title)}',artist:'${escapeJs(t.artist)}',bpm:${t.bpm || 0},camelot:'${escapeJs(t.camelot || '')}',energy:'${escapeJs(t.energy || '')}',genre:'${escapeJs(t.genre || '')}'})" class="fav-star-btn ${favoritesHasTrack(t) ? 'fav-star-active' : ''}" data-fav-path="${escapeHtml(t.path)}" title="${favoritesHasTrack(t) ? 'Remove from Favorites' : 'Add to Favorites'}">${favoritesHasTrack(t) ? '&#9733;' : '&#9734;'}</button>
	            <button class="library-more-btn button--icon" title="Prepare Title, Artist, BPM, Key, and Year" onclick="event.stopPropagation(); openLibraryTrackPreparation('${escapeJs(t.path)}')">
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/></svg>
            </button>
	        </div>
	      `}).join('');
	      const brief = setBriefPayload();
	      const preparationFooterLabel = activeLibraryPreparationFilter === 'missing_key'
	        ? 'missing-key tracks'
	        : activeLibraryPreparationFilter === 'missing_bpm'
	          ? 'missing-BPM tracks'
	          : activeLibraryPreparationFilter === 'missing_year'
	            ? 'missing-year tracks'
	          : activeLibraryPreparationFilter === 'missing_both'
	            ? 'tracks missing BPM + key'
            : activeLibraryPreparationFilter === 'bpm_review'
                ? 'BPM results needing review'
	            : activeLibraryPreparationFilter === 'needs_prep'
	              ? 'tracks still needing preparation'
	              : activeLibraryPreparationFilter === 'missing_bpm_or_key'
	                ? 'tracks missing BPM or key'
	                : activeLibraryPreparationFilter === 'missing_metadata'
	                  ? 'tracks missing BPM, key, or year'
	              : '';
	      const remainingLibraryRows = Math.max(0, totalMatches - tracks.length);
	      const resultFooter = hasMoreLibraryRows ? `
	        <div class="library-load-more-row px-4 py-8 text-center">
          <button onclick="showMoreLibraryResults()" class="library-show-more-btn px-7 py-3 rounded-xl border border-axiom-accent/50 bg-axiom-accent/10 text-axiom-accent font-black uppercase text-[10px] tracking-[0.22em] hover:bg-axiom-accent hover:text-black transition-all button--green-outline">
	            ${context.briefPaging && context.briefHasMore
              ? `Show More &middot; ${tracks.length.toLocaleString()} matches shown`
              : preparationFooterLabel
	              ? `Show Remaining ${remainingLibraryRows.toLocaleString()} ${preparationFooterLabel} &middot; ${tracks.length.toLocaleString()} of ${totalMatches.toLocaleString()} shown`
	              : `Show More &middot; ${tracks.length.toLocaleString()} of ${totalMatches.toLocaleString()} shown`}
	          </button>
	        </div>
	      ` : brief.enabled && tracks.length < 8 ? `
	        <div class="library-load-more-row px-4 py-5 text-center text-axiom-accent text-[10px] font-black uppercase tracking-[0.16em]">
	          Only ${tracks.length.toLocaleString()} track${tracks.length === 1 ? '' : 's'} match every active setting${activeEraLabel}. AXIOM did not widen your brief.
	        </div>
	      ` : preparationFooterLabel ? `
	        <div class="library-load-more-row px-4 py-5 text-center text-white/35 text-[10px] font-black uppercase tracking-[0.2em]">
	          Showing all ${totalMatches.toLocaleString()} ${preparationFooterLabel}
	        </div>
	      ` : `
	        <div class="library-load-more-row px-4 py-5 text-center text-white/35 text-[10px] font-black uppercase tracking-[0.2em]">
	          Showing ${tracks.length.toLocaleString()} track${tracks.length === 1 ? '' : 's'}${activeEraLabel}
	        </div>
	      `;
      document.getElementById('search-results').innerHTML = renderedRows + resultFooter;
      window.AxiomLibraryDesign?.decorateRows();
      syncLibraryTopSortControls();
	      syncLibraryBatchSelectionUi();
	    }

/* Library surface: per-track preparation panel and cache-only actions. */
    let activeLibraryPreparationSession = null;

    function closeLibraryTrackPreparation() {
      const completedSession = activeLibraryPreparationSession;
      if (completedSession?.pollTimer) window.clearTimeout(completedSession.pollTimer);
      if (completedSession?.closeTimer) window.clearTimeout(completedSession.closeTimer);
      document.getElementById('library-track-prep-modal')?.remove();
      activeLibraryPreparationSession = null;
      if (completedSession?.pendingListRefresh) {
        runSearch().then(() => {
          if (completedSession.preparationReady) {
            showToast('Track preparation confirmed. The completed track has cleared the missing-information list.');
          }
        });
      }
    }

    function focusLibraryPreparationInput(id) {
      const input = document.getElementById(id);
      input?.focus();
      input?.select?.();
    }

    function setLibraryPreparationStatus(message = '', state = 'working') {
      const status = document.getElementById('library-track-prep-status');
      if (!status) return;
      status.classList.toggle('is-visible', Boolean(message));
      status.dataset.state = state;
      status.textContent = message;
    }

    function libraryTrackPreparationReviewMessage(track = {}, requestedLanes = [], confirmedValues = '') {
      const messages = [];
      const nextActions = new Set();
      const bpm = Number(track.bpm || 0);
      const key = normalizeCamelotKey(track.camelot || track.key || track.key_raw || '');
      const year = Number(track.year || track.release_year || 0);
      if (requestedLanes.includes('missing_bpm') && !(bpm > 0)) {
        messages.push(`BPM not changed: ${track.bpm_analysis_reason || 'AXIOM could not confirm one reliable tempo.'}`);
        if (track.bpm_analysis_next_action) nextActions.add(track.bpm_analysis_next_action);
      }
      if (requestedLanes.includes('missing_key') && !key) {
        messages.push(`Key not assigned: ${track.key_analysis_reason || 'AXIOM could not decode a usable harmonic result from this file.'}`);
        if (track.key_analysis_next_action) nextActions.add(track.key_analysis_next_action);
      }
      if (requestedLanes.includes('missing_year') && !(year >= 1900)) {
        messages.push(`Year not assigned: ${track.year_analysis_reason || 'AXIOM could not confirm a reliable release year from the available library and catalog evidence.'}`);
        if (track.year_analysis_next_action) nextActions.add(track.year_analysis_next_action);
      }
      const confirmed = confirmedValues ? `${confirmedValues} confirmed.\n` : '';
      const nextAction = nextActions.values().next().value
        || 'Enter the value below, or analyze the track in Serato or djay Pro and scan again.';
      const next = `\nNext: ${nextAction}`;
      return `${confirmed}${messages.join('\n')}${next}`;
    }

    async function pollLibraryTrackPreparationStatus(expectedJobId = '') {
      const session = activeLibraryPreparationSession;
      if (!session?.jobRunning) return null;
      if (session.pollTimer) {
        window.clearTimeout(session.pollTimer);
        session.pollTimer = null;
      }
      try {
        const resp = await fetch('/api/library/unified_health/status', { cache: 'no-store' });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.success === false) throw new Error(data.error || data.message || 'Track scan status failed');
        const job = data.job || {};
        const jobId = String(job.job_id || '');
        if (expectedJobId && jobId && expectedJobId !== jobId) {
          throw new Error('Another Library scan replaced this track scan. Start this track again.');
        }
        await updateLibraryTrackPreparationFromJob(job);
        if (unifiedHealthIsActive(job) && activeLibraryPreparationSession === session) {
          session.pollTimer = window.setTimeout(() => pollLibraryTrackPreparationStatus(expectedJobId || jobId), 850);
        }
        return job;
      } catch (error) {
        if (activeLibraryPreparationSession === session) {
          session.jobRunning = false;
          updateLibraryTrackPreparationModal(session.track);
          setLibraryPreparationStatus(error.message || 'The track scan stopped before it could finish.', 'error');
        }
        return null;
      }
    }

    function libraryTrackPreparationMissingLanes(track = {}) {
      const bpm = Number(track.bpm || 0);
      const key = normalizeCamelotKey(track.camelot || track.key || track.key_raw || '');
      const year = Number(track.year || track.release_year || 0);
      const lanes = [];
      if (!(bpm > 0)) lanes.push('missing_bpm');
      if (!key) lanes.push('missing_key');
      if (!(year >= 1900)) lanes.push('missing_year');
      return lanes;
    }

    function libraryTrackPreparationScanLabel(lanes = [], running = false) {
      const labels = [
        lanes.includes('missing_bpm') ? 'BPM' : '',
        lanes.includes('missing_key') ? 'Key' : '',
        lanes.includes('missing_year') ? 'Year' : '',
      ].filter(Boolean);
      const target = labels.join(' + ');
      return target ? `${running ? 'Scanning' : 'Scan'} ${target}${running ? '...' : ''}` : 'BPM + Key + Year Ready';
    }

    function updateLibraryTrackPreparationModal(track = {}) {
      if (!activeLibraryPreparationSession || activeLibraryPreparationSession.path !== track.path) return;
      activeLibraryPreparationSession.track = { ...activeLibraryPreparationSession.track, ...track };
      const current = activeLibraryPreparationSession.track;
      const bpm = Number(current.bpm || 0);
      const rawCurrentKey = normalizeCamelotKey(current.camelot || current.key || current.key_raw || '');
      const key = rawCurrentKey;
      const year = Number(current.year || current.release_year || 0);
      const sourceCheckComplete = Boolean(activeLibraryPreparationSession.sourceCheckComplete);
      const sourceDisconnected = sourceCheckComplete && current.source_connected === false;
      const bpmValue = document.getElementById('library-track-prep-bpm-value');
      const keyValue = document.getElementById('library-track-prep-key-value');
      const yearValue = document.getElementById('library-track-prep-year-value');
      const titleHeading = document.getElementById('library-track-prep-title');
      const artistHeading = document.getElementById('library-track-prep-artist');
      const keyLabel = document.getElementById('library-track-prep-key-label');
      const bpmMetric = document.getElementById('library-track-prep-bpm-metric');
      const keyMetric = document.getElementById('library-track-prep-key-metric');
      const yearMetric = document.getElementById('library-track-prep-year-metric');
      if (titleHeading) titleHeading.textContent = current.title || current.filename || 'Unknown Track';
      if (artistHeading) artistHeading.textContent = current.artist || 'Unknown Artist';
      if (bpmValue) bpmValue.textContent = bpm > 0 ? `${Math.round(bpm * 10) / 10}` : 'Missing';
      if (keyValue) keyValue.textContent = key || 'Missing';
      if (yearValue) yearValue.textContent = year >= 1900 ? `${Math.round(year)}` : 'Missing';
      if (keyLabel) keyLabel.textContent = 'Current Camelot Key';
      bpmMetric?.classList.toggle('is-missing', !(bpm > 0));
      keyMetric?.classList.toggle('is-missing', !key);
      yearMetric?.classList.toggle('is-missing', !(year >= 1900));
      keyMetric?.classList.remove('is-estimated');
      const bpmInput = document.getElementById('library-track-prep-bpm-input');
      const keyInput = document.getElementById('library-track-prep-key-input');
      const yearInput = document.getElementById('library-track-prep-year-input');
      const titleInput = document.getElementById('library-track-prep-title-input');
      const artistInput = document.getElementById('library-track-prep-artist-input');
      const genreInput = document.getElementById('library-track-prep-genre-input');
      if (titleInput && document.activeElement !== titleInput) titleInput.value = current.title || current.filename || '';
      if (artistInput && document.activeElement !== artistInput) artistInput.value = current.artist || '';
      if (genreInput && document.activeElement !== genreInput) genreInput.value = current.genre || '';
      if (bpmInput && document.activeElement !== bpmInput) bpmInput.value = bpm > 0 ? `${Math.round(bpm * 10) / 10}` : '';
      if (keyInput && document.activeElement !== keyInput) keyInput.value = key;
      if (yearInput && document.activeElement !== yearInput) yearInput.value = year >= 1900 ? `${Math.round(year)}` : '';
      const combined = document.getElementById('library-track-prep-scan-all');
      const bpmCorrections = document.getElementById('library-track-prep-bpm-corrections');
      const jobRunning = Boolean(activeLibraryPreparationSession.jobRunning);
      const correctionRunning = Boolean(activeLibraryPreparationSession.bpmCorrectionRunning);
      const missingLanes = libraryTrackPreparationMissingLanes(current);
      if (bpmCorrections) {
        bpmCorrections.hidden = !(bpm > 0);
        bpmCorrections.querySelectorAll('button').forEach(button => {
          button.disabled = jobRunning || correctionRunning || sourceDisconnected || !(bpm > 0);
        });
      }
      if (combined) {
        const activeLanes = jobRunning
          && Array.isArray(activeLibraryPreparationSession.requestedLanes)
          && activeLibraryPreparationSession.requestedLanes.length
          ? activeLibraryPreparationSession.requestedLanes
          : missingLanes;
        combined.disabled = jobRunning || !sourceCheckComplete || sourceDisconnected || missingLanes.length === 0;
        combined.textContent = !sourceCheckComplete
          ? 'Checking Source File...'
          : sourceDisconnected
            ? 'Reconnect File to Scan'
            : libraryTrackPreparationScanLabel(activeLanes, jobRunning);
      }
    }

    function updateVisibleLibraryPreparationRow(path, track = {}) {
      const row = document.querySelector(`#search-results .library-track-card[data-path="${cssEscapeValue(path)}"]`);
      if (!row) return false;
      const bpm = Number(track.bpm || 0);
      const key = normalizeCamelotKey(track.camelot || track.key || track.key_raw || '');
      const year = Number(track.year || track.release_year || 0);
      const bpmCell = row.querySelector('.library-bpm-cell');
      const bpmValue = row.querySelector('.library-bpm-value');
      const bpmTools = row.querySelector('.library-bpm-tools');
      if (bpmCell) {
        bpmCell.classList.toggle('has-bpm', bpm > 0);
        bpmCell.classList.toggle('is-missing', !(bpm > 0));
      }
      if (bpmValue) {
        bpmValue.textContent = bpm > 0 ? `${Math.round(bpm)}` : '--';
        bpmValue.style.color = bpm > 0 ? 'var(--accent)' : '#EAB308';
      }
      if (bpmTools && bpm > 0) {
        bpmTools.innerHTML = `
          <button onclick="event.stopPropagation(); adjustBpm('${escapeJs(path)}', ${bpm}, 'half')" title="Halve BPM">1/2</button>
          <button onclick="event.stopPropagation(); adjustBpm('${escapeJs(path)}', ${bpm}, 'double')" title="Double BPM">2x</button>`;
      }
      const keyCell = row.querySelector('.library-key-cell');
      const keyButton = row.querySelector('.camelot-pill');
      if (keyCell) {
        keyCell.classList.toggle('has-key', Boolean(key));
        keyCell.classList.toggle('is-missing', !key);
      }
      if (keyButton) {
        keyButton.textContent = key || 'Find';
        keyButton.title = key ? 'Open Key preparation' : 'Scan or enter Key';
        keyButton.classList.remove('camelot-a', 'camelot-b', 'camelot-unknown');
        keyButton.classList.add(camelotClass(key));
      }
      const keyCaption = keyCell?.querySelector('small');
      if (keyCaption) keyCaption.textContent = 'KEY';
      const yearLabel = row.querySelector('.library-row-year');
      if (yearLabel) yearLabel.textContent = formatTrackYear(track);
      const titleLabel = row.querySelector('.library-track-title');
      const artistLabel = row.querySelector('.library-track-artist');
      const nextTitle = track.title || track.filename || '';
      const nextArtist = track.artist || '';
      if (titleLabel && nextTitle) {
        const previewIcon = titleLabel.querySelector('.preview-icon');
        titleLabel.textContent = nextTitle;
        if (previewIcon) {
          titleLabel.prepend(previewIcon);
          previewIcon.classList.add('hidden');
        }
      }
      if (artistLabel) artistLabel.textContent = nextArtist || 'Unknown Artist';
      if (nextTitle || nextArtist) {
        row.setAttribute('aria-label', `${nextTitle || 'Unknown Title'} by ${nextArtist || 'Unknown Artist'}${bpm ? `, ${Math.round(Number(bpm))} BPM` : ''}${key ? `, key ${key}` : ''}`);
      }
      row.classList.toggle('needs-health-repair', !(bpm > 0 && key && year >= 1900));
      row.classList.add('library-track-prep-confirmed');
      window.setTimeout(() => row.classList.remove('library-track-prep-confirmed'), 1400);
      return true;
    }

    function libraryPreparationPreviewTrack(path) {
      if (['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname) && axiomReviewMode() === 'library' && axiomUiPreviewMode() === 'library-design' && String(path).startsWith('preview://library-design/')) return trackVisualCache.get(path) || null;
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)
          || document.querySelector('meta[name="axiom-edition"]')?.content !== 'pro'
          || !['library', 'library-gap-checker', 'library-state-audit'].includes(axiomReviewMode())
          || !String(path).startsWith('preview://library-gap-')
          || typeof libraryGapReviewTracks !== 'function') return null;
      return libraryGapReviewTracks().find(track => track.path === path) || null;
    }

    async function refreshLibraryTrackPreparation({ refreshResults = true } = {}) {
      const session = activeLibraryPreparationSession;
      if (!session?.path) return null;
      const previewTrack = libraryPreparationPreviewTrack(session.path);
      if (previewTrack) {
        session.sourceCheckComplete = true;
        updateLibraryTrackPreparationModal(previewTrack);
        setLibraryPreparationStatus('Preview track. Edits apply only to this browser preview, not your music Library.', 'review');
        return previewTrack;
      }
      try {
        const resp = await fetch(`/api/library/track?path=${encodeURIComponent(session.path)}`, { cache: 'no-store' });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.success === false) throw new Error(data.error || 'Track preparation could not refresh');
        const track = normalizeModalTrackMetadata(data.track || {});
        session.sourceCheckComplete = true;
        propagateTrackMetadata(session.path, {
          bpm: Number(track.bpm || 0),
          camelot: track.camelot || '',
          key_raw: track.key_raw || track.camelot || '',
          year: Number(track.year || track.release_year || 0) || 0,
          release_year: Number(track.release_year || track.year || 0) || 0,
          energy: track.energy || '',
        }, track);
        updateLibraryTrackPreparationModal(track);
        updateVisibleLibraryPreparationRow(session.path, track);
        if (track.source_connected === false) {
          setLibraryPreparationStatus(
            'Source file disconnected. Reconnect the file or folder, then run Rescan Library before scanning BPM, key, or year again.',
            'review'
          );
        }
        if (refreshResults) await runSearch();
        return track;
      } catch (error) {
        setLibraryPreparationStatus(error.message || 'Track preparation could not refresh.', 'error');
        return null;
      }
    }

    async function openLibraryTrackPreparation(path, focusField = '') {
      if (!path) return;
      document.getElementById('library-track-prep-modal')?.remove();
      let track = normalizeModalTrackMetadata(trackVisualCache.get(path) || { path, title: path.split('/').pop() || 'Track' });
      activeLibraryPreparationSession = {
        path,
        track,
        jobRunning: false,
        bpmCorrectionRunning: false,
        bpmCorrectionToken: 0,
        jobId: '',
        finalizing: false,
        pollTimer: null,
        closeTimer: null,
        sourceCheckComplete: axiomReviewMode() === 'library-gap-checker',
        pendingListRefresh: false,
        preparationReady: false,
      };
      const modal = document.createElement('div');
      modal.id = 'library-track-prep-modal';
      modal.className = 'library-track-prep-modal';
      const genres = Array.from(new Set([track.genre, ...Array.from(trackVisualCache.values()).map(item => item.genre)].filter(Boolean))).sort();
      const art = getTrackArtwork(track) || '/static/axiom-pro-mark.png';
      modal.innerHTML = document.body.classList.contains('axiom-pro-library-design') ? `
        <section class="library-track-prep-card library-metadata-editor" role="dialog" aria-modal="true" aria-labelledby="library-track-prep-title">
          <header class="library-metadata-steel-head"><h2>Track Information</h2><button type="button" class="library-track-prep-close" onclick="closeLibraryTrackPreparation()" aria-label="Close track preparation"><img src="/static/icons/x.svg" alt=""></button></header>
          <div class="library-metadata-content">
            <header class="library-track-prep-head"><img class="library-metadata-art" src="${escapeHtml(art)}" alt="Track artwork"><div><small class="library-track-prep-kicker">Track</small><h3 id="library-track-prep-title">${escapeHtml(track.title || track.filename || 'Unknown Track')}</h3><p id="library-track-prep-artist">${escapeHtml(track.artist || 'Unknown Artist')}</p></div></header>
            <div class="library-track-prep-manual-grid">
              <label class="library-metadata-wide">Title<input id="library-track-prep-title-input" placeholder="Song title" autocomplete="off"></label>
              <label class="library-metadata-wide">Artist<input id="library-track-prep-artist-input" placeholder="Artist name" autocomplete="off"></label>
              <label>BPM<div class="library-metadata-bpm"><input id="library-track-prep-bpm-input" inputmode="decimal" placeholder="128.0" autocomplete="off"><div id="library-track-prep-bpm-corrections" class="library-track-prep-bpm-corrections" hidden><button type="button" onclick="adjustLibraryTrackPreparationBpm('half', this)" title="Halve the current BPM">1/2</button><button type="button" onclick="adjustLibraryTrackPreparationBpm('double', this)" title="Double the current BPM">2x</button></div></div></label>
              <label>Camelot Key<input id="library-track-prep-key-input" placeholder="8A" maxlength="3" autocomplete="off" list="library-metadata-key-options"><datalist id="library-metadata-key-options">${Array.from({length:12},(_,i)=>['A','B'].map(mode=>`<option value="${i+1}${mode}"></option>`).join('')).join('')}</datalist></label>
              <label>Release Year<input id="library-track-prep-year-input" inputmode="numeric" placeholder="2024" maxlength="4" autocomplete="off"></label>
              <label>Genre<input id="library-track-prep-genre-input" placeholder="Choose or enter genre" autocomplete="off" list="library-metadata-genre-options"><datalist id="library-metadata-genre-options">${genres.map(genre=>`<option value="${escapeHtml(genre)}"></option>`).join('')}</datalist></label>
            </div>
            <button id="library-track-prep-scan-all" type="button" class="library-track-prep-primary" onclick="runLibraryTrackPreparationSmartScan(this)">Scan BPM + Key + Year</button>
            <div id="library-track-prep-status" class="library-track-prep-status" aria-live="polite"></div>
            <footer class="library-metadata-footer"><p class="library-track-prep-note">Saved in AXIOM. Your music files stay untouched.</p><div class="library-track-prep-manual-actions"><button type="button" class="library-metadata-cancel" onclick="closeLibraryTrackPreparation()">Cancel</button><button id="library-track-prep-save" type="button" onclick="saveLibraryTrackPreparationManual(this)">Save Track Information</button></div></footer>
          </div>
        </section>` : `
        <section class="library-track-prep-card" role="dialog" aria-modal="true" aria-labelledby="library-track-prep-title">
          <header class="library-track-prep-head">
            <span>
              <small class="library-track-prep-kicker">Library Track Preparation</small>
              <h3 id="library-track-prep-title">${escapeHtml(track.title || track.filename || 'Unknown Track')}</h3>
              <p id="library-track-prep-artist">${escapeHtml(track.artist || 'Unknown Artist')}</p>
            </span>
            <button type="button" class="library-track-prep-close" onclick="closeLibraryTrackPreparation()" aria-label="Close track preparation">X</button>
          </header>
          <div class="library-track-prep-metrics">
            <div id="library-track-prep-bpm-metric" class="library-track-prep-metric">
              <span><small>Current BPM</small><strong id="library-track-prep-bpm-value">--</strong></span>
              <div class="library-track-prep-metric-actions">
                <button type="button" onclick="focusLibraryPreparationInput('library-track-prep-bpm-input')">Enter</button>
                <div id="library-track-prep-bpm-corrections" class="library-track-prep-bpm-corrections" hidden>
                  <button type="button" onclick="adjustLibraryTrackPreparationBpm('half', this)" title="Halve the current BPM">1/2</button>
                  <button type="button" onclick="adjustLibraryTrackPreparationBpm('double', this)" title="Double the current BPM">2x</button>
                </div>
              </div>
            </div>
            <div id="library-track-prep-key-metric" class="library-track-prep-metric">
              <span><small id="library-track-prep-key-label">Current Camelot Key</small><strong id="library-track-prep-key-value">--</strong></span>
              <button type="button" onclick="focusLibraryPreparationInput('library-track-prep-key-input')">Enter</button>
            </div>
            <div id="library-track-prep-year-metric" class="library-track-prep-metric">
              <span><small>Current Year</small><strong id="library-track-prep-year-value">--</strong></span>
              <button type="button" onclick="focusLibraryPreparationInput('library-track-prep-year-input')">Enter</button>
            </div>
          </div>
          <button id="library-track-prep-scan-all" type="button" class="library-track-prep-primary" onclick="runLibraryTrackPreparationSmartScan(this)">Scan BPM + Key + Year</button>
          <div id="library-track-prep-status" class="library-track-prep-status" aria-live="polite"></div>
          <div class="library-track-prep-manual">
            <strong>Enter It Yourself</strong>
            <div class="library-track-prep-manual-grid">
              <label>Song Title<input id="library-track-prep-title-input" placeholder="Song title" autocomplete="off"></label>
              <label>Artist<input id="library-track-prep-artist-input" placeholder="Artist name" autocomplete="off"></label>
              <label>BPM<input id="library-track-prep-bpm-input" inputmode="decimal" placeholder="128.0" autocomplete="off"></label>
              <label>Camelot Key<input id="library-track-prep-key-input" placeholder="8A" maxlength="3" autocomplete="off"></label>
              <label>Release Year<input id="library-track-prep-year-input" inputmode="numeric" placeholder="2024" maxlength="4" autocomplete="off"></label>
            </div>
            <div class="library-track-prep-manual-actions">
              <button id="library-track-prep-save" type="button" onclick="saveLibraryTrackPreparationManual(this)">Save Track Information</button>
            </div>
          </div>
          <p class="library-track-prep-note">AXIOM stores preparation inside its Library cache. Source audio and DJ software databases remain untouched.</p>
        </section>`;
      modal.addEventListener('click', event => {
        if (event.target === modal) closeLibraryTrackPreparation();
      });
      modal.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeLibraryTrackPreparation();
      });
      document.body.appendChild(modal);
      updateLibraryTrackPreparationModal(track);
      if (axiomReviewMode() !== 'library-gap-checker') {
        await refreshLibraryTrackPreparation({ refreshResults: false });
      }
      if (focusField === 'year' && modal.isConnected && activeLibraryPreparationSession?.path === path) {
        focusLibraryPreparationInput('library-track-prep-year-input');
      }
    }

    async function runLibraryTrackPreparationSmartScan(button = null) {
      const session = activeLibraryPreparationSession;
      if (!session?.path || session.jobRunning) return null;
      const lanes = libraryTrackPreparationMissingLanes(session.track || {});
      if (!lanes.length) {
        setLibraryPreparationStatus('This track already has BPM, Key, and Year information.', 'complete');
        updateLibraryTrackPreparationModal(session.track || {});
        return null;
      }
      return runLibraryTrackPreparationScan(lanes, button);
    }

    async function runLibraryTrackPreparationScan(lanes = [], button = null) {
      const session = activeLibraryPreparationSession;
      if (!session?.path || session.jobRunning) return;
      lanes = Array.from(new Set(lanes)).filter(lane => ['missing_bpm', 'missing_key', 'missing_year'].includes(lane));
      if (!lanes.length) return null;
      if (!session.sourceCheckComplete) {
        await refreshLibraryTrackPreparation({ refreshResults: false });
        if (!activeLibraryPreparationSession || activeLibraryPreparationSession.path !== session.path) return null;
      }
      if (session.track?.source_connected === false) {
        setLibraryPreparationStatus(
          'Source file disconnected. Reconnect the file or folder, then run Rescan Library before scanning BPM, key, or year again.',
          'review'
        );
        updateLibraryTrackPreparationModal(session.track);
        return null;
      }
      session.requestedLanes = lanes;
      session.jobRunning = true;
      updateLibraryTrackPreparationModal(session.track);
      setLibraryPreparationStatus('Scan accepted. AXIOM is checking DJ-library evidence and local audio analysis.', 'working');
      if (axiomReviewMode() === 'library-gap-checker' && axiomUiPreviewMode() === 'library-preparation') {
        const demoResults = {
          'preview://library-gap-1': { bpm: 65, camelot: '2A' },
          'preview://library-gap-2': { bpm: 103, camelot: '12A' },
          'preview://library-gap-3': { bpm: 123, camelot: '9A' },
        };
        await new Promise(resolve => window.setTimeout(resolve, 650));
        if (!activeLibraryPreparationSession || activeLibraryPreparationSession.path !== session.path) return null;
        const resolved = { ...session.track, ...(demoResults[session.path] || {}) };
        libraryGapPreparationReviewOverrides.set(session.path, {
          bpm: Number(resolved.bpm || 0),
          camelot: normalizeCamelotKey(resolved.camelot || ''),
          year: Number(resolved.year || resolved.release_year || 0),
        });
        propagateTrackMetadata(session.path, resolved, resolved);
        session.jobRunning = false;
        session.pendingListRefresh = true;
        session.preparationReady = Number(resolved.bpm || 0) > 0
          && Boolean(normalizeCamelotKey(resolved.camelot || ''))
          && Number(resolved.year || resolved.release_year || 0) >= 1900;
        updateLibraryTrackPreparationModal(resolved);
        updateVisibleLibraryPreparationRow(session.path, resolved);
        setLibraryPreparationStatus(
          `Scan complete: BPM ${Math.round(Number(resolved.bpm || 0) * 10) / 10}, Key ${normalizeCamelotKey(resolved.camelot || '')}, and Year ${Number(resolved.year || resolved.release_year || 0)} are now showing on this track.`,
          'complete'
        );
        return {
          status: 'complete',
          total_steps: lanes.length,
          processed_steps: lanes.length,
          totals: { checked: lanes.length, fixed: lanes.length, still_missing: 0 },
          lanes,
        };
      }
      const job = await startUnifiedHealthScan(lanes, button, [session.path], { modalOnly: true });
      if (!activeLibraryPreparationSession || activeLibraryPreparationSession.path !== session.path) return job;
      if (!job) {
        session.jobRunning = false;
        updateLibraryTrackPreparationModal(session.track);
        setLibraryPreparationStatus('The scan could not start. Nothing was changed.', 'error');
        return null;
      }
      session.jobId = String(job.job_id || '');
      updateLibraryTrackPreparationFromJob(job);
      return job;
    }

    async function updateLibraryTrackPreparationFromJob(job = {}) {
      const session = activeLibraryPreparationSession;
      if (!session?.jobRunning) return;
      const jobId = String(job.job_id || '');
      if (session.jobId && jobId && session.jobId !== jobId) return;
      if (!session.jobId && jobId) session.jobId = jobId;
      const status = String(job.status || '').toLowerCase();
      const totals = job.totals || {};
      const active = ['starting', 'running', 'stopping'].includes(status);
      const checked = Number(job.processed_steps || totals.checked || 0);
      const total = Number(job.total_steps || 0);
      if (active) {
        setLibraryPreparationStatus(total > 0
          ? `Scanning ${checked.toLocaleString()} of ${total.toLocaleString()} BPM/Key/Year checks. ${job.message || ''}`
          : (job.message || 'Preparing the BPM, Key, and Year scan...'), 'working');
        return;
      }
      if (session.finalizing) return;
      session.finalizing = true;
      session.jobRunning = false;
      const fixed = Number(totals.fixed || 0);
      const remaining = Number(totals.still_missing || 0);
      const requestedLanes = Array.isArray(job.lanes) ? job.lanes : [];
      const refreshed = await refreshLibraryTrackPreparation({ refreshResults: false });
      if (!activeLibraryPreparationSession || activeLibraryPreparationSession.path !== session.path) return;
      session.finalizing = false;
      session.pendingListRefresh = true;
      const current = refreshed || session.track || {};
      const currentBpm = Number(current.bpm || 0);
      const currentKey = normalizeCamelotKey(current.camelot || current.key || current.key_raw || '');
      const currentYear = Number(current.year || current.release_year || 0);
      session.preparationReady = currentBpm > 0 && Boolean(currentKey) && currentYear >= 1900;
      const requestedValueIsMissing =
        (requestedLanes.includes('missing_bpm') && !(currentBpm > 0))
        || (requestedLanes.includes('missing_key') && !currentKey)
        || (requestedLanes.includes('missing_year') && !(currentYear >= 1900));
      const confirmedValues = [
        currentBpm > 0 ? `BPM ${Math.round(currentBpm * 10) / 10}` : '',
        currentKey ? `Key ${currentKey}` : '',
        currentYear >= 1900 ? `Year ${Math.round(currentYear)}` : '',
      ].filter(Boolean).join(' and ');
      setLibraryPreparationStatus(
        status === 'no_work'
          ? requestedValueIsMissing
            ? (job.message || 'No scan ran. This track is still missing the requested information and needs review or manual entry.')
            : 'This track already has the requested BPM, Key, and Year information.'
          : session.preparationReady
            ? `Scan complete: ${confirmedValues} are now showing on this track.`
            : libraryTrackPreparationReviewMessage(current, requestedLanes, confirmedValues),
        requestedValueIsMissing || (status === 'no_work' && requestedValueIsMissing) ? 'review' : 'complete'
      );
      updateLibraryTrackPreparationModal(current);
      updateVisibleLibraryPreparationRow(session.path, current);
    }

    async function saveLibraryTrackPreparationManual(button = null) {
      const session = activeLibraryPreparationSession;
      if (!session?.path) return;
      const titleText = normalizeManualTrackText(document.getElementById('library-track-prep-title-input')?.value || '');
      const artistText = normalizeManualTrackText(document.getElementById('library-track-prep-artist-input')?.value || '');
      const genreInput = document.getElementById('library-track-prep-genre-input');
      const genreText = normalizeManualTrackText(genreInput?.value || '');
      const genreChanged = !!genreInput && genreText !== String(session.track?.genre || '').trim();
      if (genreChanged && !genreText) return showToast('Enter or choose a genre.', true);
      const bpmText = String(document.getElementById('library-track-prep-bpm-input')?.value || '').trim();
      const keyText = String(document.getElementById('library-track-prep-key-input')?.value || '').trim().toUpperCase();
      const yearText = String(document.getElementById('library-track-prep-year-input')?.value || '').trim();
      const bpm = bpmText ? Number(bpmText) : 0;
      const key = keyText ? normalizeCamelotKey(keyText) : '';
      const year = yearText ? Number(yearText) : 0;
      const maxYear = new Date().getFullYear() + 1;
      if (bpmText && (!Number.isFinite(bpm) || bpm < 20 || bpm > 300)) return showToast('Enter a BPM between 20 and 300.', true);
      if (keyText && !key) return showToast('Use a Camelot key like 1A, 8B, or 12A.', true);
      if (yearText && (!Number.isInteger(year) || year < 1900 || year > maxYear)) return showToast(`Enter a release year between 1900 and ${maxYear}.`, true);
      const currentTitle = normalizeManualTrackText(session.track?.title || session.track?.filename || '');
      const currentArtist = normalizeManualTrackText(session.track?.artist || '');
      const identityChanged = titleText !== currentTitle || artistText !== currentArtist;
      if (identityChanged && (!titleText || !artistText)) return showToast('Enter both a song title and artist name.', true);
      if (!identityChanged && !genreChanged && !bpmText && !keyText && !yearText) return showToast('Enter title, artist, BPM, Camelot Key, Year, or any combination.', true);
      if (libraryPreparationPreviewTrack(session.path)) {
        const changes = {
          ...(identityChanged ? { title: titleText, artist: artistText } : {}),
          ...(genreChanged ? { genre: genreText, dna_genre: genreText } : {}),
          ...(bpmText ? { bpm } : {}),
          ...(keyText ? { camelot: key } : {}),
          ...(yearText ? { year, release_year: year, year_source: 'manual' } : {}),
        };
        libraryGapPreparationReviewOverrides.set(session.path, {
          ...(libraryGapPreparationReviewOverrides.get(session.path) || {}), ...changes,
        });
        session.pendingListRefresh = true;
        closeLibraryTrackPreparation();
        await runSearch();
        showToast('Saved in this preview only. Your music Library is unchanged.');
        return;
      }
      setAxiomButtonBusy(button, true, 'Saving...');
      setLibraryPreparationStatus('Saving track information inside AXIOM...', 'working');
      try {
        if (genreChanged) {
          const resp = await fetch('/api/library/update_genre', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({path:session.path, genre:genreText})});
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok || data.success === false) throw new Error(data.error || 'Genre could not be saved');
          propagateTrackMetadata(session.path, {genre:genreText, dna_genre:genreText}, data.track || {});
        }
        if (identityChanged) {
          const identityResp = await fetch('/api/library/update_track_metadata', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: session.path, title: titleText, artist: artistText })
          });
          const identityData = await identityResp.json().catch(() => ({}));
          if (!identityResp.ok || identityData.success === false) throw new Error(identityData.error || 'Song details could not be saved');
          const updatedIdentity = identityData.track || {};
          propagateTrackMetadata(session.path, { title: updatedIdentity.title || titleText, artist: updatedIdentity.artist || artistText }, updatedIdentity);
        }
        if (bpmText) {
          const bpmResp = await fetch('/api/library/update_bpm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: session.path, bpm })
          });
          const bpmData = await bpmResp.json().catch(() => ({}));
          if (!bpmResp.ok || bpmData.success === false) throw new Error(bpmData.error || 'BPM could not be saved');
        }
        if (keyText) {
          const keyResp = await fetch('/api/library/update_key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: session.path, camelot: key })
          });
          const keyData = await keyResp.json().catch(() => ({}));
          if (!keyResp.ok || keyData.success === false) throw new Error(keyData.error || 'Key could not be saved');
        }
        if (yearText) {
          const yearResp = await fetch('/api/library/update_year', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: session.path, year, source: 'manual' })
          });
          const yearData = await yearResp.json().catch(() => ({}));
          if (!yearResp.ok || yearData.success === false) throw new Error(yearData.error || yearData.message || 'Year could not be saved');
        }
        const refreshed = await refreshLibraryTrackPreparation({ refreshResults: false });
        if (activeLibraryPreparationSession?.path === session.path) {
          session.pendingListRefresh = true;
          const savedBpm = Number(refreshed?.bpm || session.track?.bpm || 0);
          const savedKey = normalizeCamelotKey(refreshed?.camelot || session.track?.camelot || '');
          const savedYear = Number(refreshed?.year || refreshed?.release_year || session.track?.year || session.track?.release_year || 0);
          session.preparationReady = savedBpm > 0 && Boolean(savedKey) && savedYear >= 1900;
        }
        setLibraryPreparationStatus('Track information saved inside AXIOM. Source audio remains untouched.', 'complete');
        showToast('Library preparation saved. Source audio untouched.');
        if (activeLibraryPreparationSession === session) {
          if (session.closeTimer) window.clearTimeout(session.closeTimer);
          session.closeTimer = window.setTimeout(() => {
            if (activeLibraryPreparationSession === session) closeLibraryTrackPreparation();
          }, 700);
        }
      } catch (error) {
        setLibraryPreparationStatus(error.message || 'Library preparation could not be saved.', 'error');
        showToast(error.message || 'Library preparation could not be saved.', true);
      } finally {
        setAxiomButtonBusy(button, false);
      }
    }

    async function adjustLibraryTrackPreparationBpm(action, button = null) {
      const session = activeLibraryPreparationSession;
      const currentBpm = Number(session?.track?.bpm || 0);
      if (!session?.path || session.jobRunning || session.bpmCorrectionRunning || !(currentBpm > 0) || !['half', 'double'].includes(action)) return;
      const nextBpm = Math.round((action === 'half' ? currentBpm / 2 : currentBpm * 2) * 10) / 10;
      if (nextBpm < 20 || nextBpm > 300) {
        setLibraryPreparationStatus('That correction would put the BPM outside AXIOM’s supported 20–300 range.', 'error');
        return;
      }
      session.bpmCorrectionRunning = true;
      session.bpmCorrectionToken = Number(session.bpmCorrectionToken || 0) + 1;
      const correctionToken = session.bpmCorrectionToken;
      updateLibraryTrackPreparationModal(session.track);
      setAxiomButtonBusy(button, true, action === 'half' ? 'Halving...' : 'Doubling...');
      setLibraryPreparationStatus(`Correcting BPM from ${Math.round(currentBpm * 10) / 10} to ${nextBpm} inside AXIOM...`, 'working');
      try {
        const resp = await fetch('/api/library/update_bpm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: session.path, bpm: nextBpm })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.success === false) throw new Error(data.error || 'BPM could not be corrected');
        if (activeLibraryPreparationSession !== session || session.bpmCorrectionToken !== correctionToken) return;
        const updated = normalizeModalTrackMetadata(data.track || { ...session.track, bpm: nextBpm });
        propagateTrackMetadata(session.path, { bpm: nextBpm, energy: updated.energy || '' }, updated);
        session.pendingListRefresh = true;
        session.preparationReady = nextBpm > 0 && Boolean(normalizeCamelotKey(updated.camelot || session.track?.camelot || ''));
        updateLibraryTrackPreparationModal(updated);
        updateVisibleLibraryPreparationRow(session.path, updated);
        setLibraryPreparationStatus(`BPM corrected to ${nextBpm}. The modal and song row now match. Source audio remains untouched.`, 'complete');
        loadLibraryStats();
      } catch (error) {
        if (activeLibraryPreparationSession === session && session.bpmCorrectionToken === correctionToken) {
          setLibraryPreparationStatus(error.message || 'BPM could not be corrected. Source audio remains protected.', 'error');
        }
      } finally {
        if (activeLibraryPreparationSession === session && session.bpmCorrectionToken === correctionToken) {
          session.bpmCorrectionRunning = false;
          updateLibraryTrackPreparationModal(session.track);
        }
        setAxiomButtonBusy(button, false);
      }
    }

    window.promptSetBpm = promptSetBpm;
    window.adjustBpm = adjustBpm;
    window.promptEditTrackIdentity = promptEditTrackIdentity;
    window.promptUpdateGenre = promptUpdateGenre;
    window.promptUpdateKey = promptUpdateKey;
    window.setLibraryTopSort = setLibraryTopSort;
    window.clearLibraryTopSort = clearLibraryTopSort;
    window.openLibraryTrackPreparation = openLibraryTrackPreparation;
    window.closeLibraryTrackPreparation = closeLibraryTrackPreparation;
    window.runLibraryTrackPreparationSmartScan = runLibraryTrackPreparationSmartScan;
    window.runLibraryTrackPreparationScan = runLibraryTrackPreparationScan;
    window.saveLibraryTrackPreparationManual = saveLibraryTrackPreparationManual;
    window.adjustLibraryTrackPreparationBpm = adjustLibraryTrackPreparationBpm;
