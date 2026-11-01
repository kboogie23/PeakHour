    // Shared arrival, navigation, confirmation, and surface visibility controls.
    function closeAxiomArrival(markSeen = false) {
      const overlay = document.getElementById('axiom-arrival-overlay');
      if (markSeen) {
        const walkthroughKey = 'axiomWalkthroughV2Seen';
        localStorage.setItem(walkthroughKey, 'true');
        localStorage.setItem(getAxiomWalkthroughKey(walkthroughKey), 'true');
      }
      if (!overlay) return;
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 180ms ease';
      setTimeout(() => overlay.remove(), 190);
    }

    function showAxiomArrival(force = false) {
      const walkthroughKey = 'axiomWalkthroughV2Seen';
      const currentWalkthroughKey = getAxiomWalkthroughKey(walkthroughKey);
      if (!force && document.getElementById('library-source-modal')) return;
      if (!force && localStorage.getItem(currentWalkthroughKey) === 'true') return;
      const existingOverlay = document.getElementById('axiom-arrival-overlay');
      if (existingOverlay) closeAxiomArrival(false);

      const steps = [
        {
          section: 'Arrival',
          title: 'Welcome to AXIOM.',
          copy: 'AXIOM helps turn your music folders into ready-to-build DJ sets. This walkthrough stays available from the Help button whenever you need it.',
          command: 'Start AXIOM',
          tab: 'studio',
          modules: [
            ['Add Folders', 'Point AXIOM at your music.'],
            ['Find Tracks', 'Search like a DJ thinks.'],
            ['Build Sets', 'Line up songs that work together.'],
            ['Export Crates', 'Send finished sets to your DJ app.']
          ]
        },
        {
          section: 'Library',
          title: 'Find the right song.',
          copy: 'Library is your music browser. Search loose, preview songs, filter by era or speed, and add good ideas into Studio.',
          command: 'Open Library',
          tab: 'library',
          modules: [
            ['Add Folder', 'Bring in music folders.'],
            ['Search', 'Find half-remembered tracks.'],
            ['Preview', 'Listen before adding.'],
            ['Add To Set', 'Send the song to Studio.']
          ]
        },
        {
          section: 'Studio',
          title: 'Build your set.',
          copy: 'Studio is where your set comes together. Build manually, describe the room, or use Magic Set to draft a complete journey.',
          command: 'Open Studio',
          tab: 'studio',
          modules: [
            ['Room Rescue', 'Choose the gig and get a clear start.'],
            ['Manual Build', 'Shape the order yourself.'],
            ['Magic Set', 'Draft a complete set journey.'],
            ['Cue Points', 'Prepare mix moments for your tracks.']
          ]
        },
        {
          section: 'Health',
          title: 'Repair your library.',
          copy: 'Health finds missing BPM, key and year information, duplicate tracks, and title or artist cleanup that needs your review.',
          command: 'Open Health',
          tab: 'health',
          modules: [
            ['BPM And Key', 'Find trusted mix information.'],
            ['Release Years', 'Fill or review era information.'],
            ['Duplicates', 'Compare copies before removing anything.'],
            ['Metadata', 'Review title and artist cleanup.']
          ]
        },
        {
          section: 'Playlists',
          title: 'Keep your finished sets.',
          copy: 'Playlists stores the sets you save. Open them again, listen back, rename them, and keep your prep organized.',
          command: 'Open Playlists',
          tab: 'playlists',
          modules: [
            ['Saved Sets', 'Keep every build.'],
            ['Rename', 'Label sets clearly.'],
            ['Listen Back', 'Check the flow.'],
            ['Reuse', 'Open old sets fast.']
          ]
        },
        {
          section: 'Performance',
          title: 'Get help while playing.',
          copy: 'In the installed app, Performance follows the track playing in your DJ software and recommends calm, compatible options for what could work next.',
          command: 'Open Performance',
          tab: 'performance',
          modules: [
            ['Live Assist', 'Follow the currently playing track.'],
            ['Tempo Lane', 'Keep recommendations near the deck BPM.'],
            ['Energy Direction', 'Hold, lift, or cool the room.'],
            ['Cue Next', 'Prepare one recommendation before playing it.']
          ]
        },
        {
          section: 'Ready',
          title: 'You are ready.',
          copy: 'Simple flow: add music, build the set, save it, then export. AXIOM keeps your original music files safe.',
          command: 'Enter AXIOM',
          tab: 'studio',
          modules: [
            ['Add', 'Connect your folders.'],
            ['Build', 'Create the set.'],
            ['Save', 'Store the crate.'],
            ['Export', 'Send it out.']
          ]
        }
      ].filter(step => !(isAxiomLite() && step.tab === 'performance'));

      let currentStep = 0;
      const overlay = document.createElement('div');
      overlay.id = 'axiom-arrival-overlay';
      overlay.className = 'axiom-arrival-overlay';
      overlay.innerHTML = `
        <section class="axiom-arrival-card" role="dialog" aria-modal="true" aria-labelledby="axiom-arrival-title">
          <div class="axiom-walkthrough-frame">
            <div class="axiom-step-main">
              <div class="axiom-step-content">
                <div class="axiom-walkthrough-brand-block">
                <div class="axiom-walkthrough-brand">AXIOM</div>
                  <p class="axiom-walkthrough-kicker">Quick Start</p>
                </div>
                <span id="axiom-step-ghost" class="axiom-step-ghost" aria-hidden="true">01</span>
                <div class="axiom-step-copy-block">
                  <p id="axiom-step-page" class="axiom-step-eyebrow">Arrival</p>
                  <h2 id="axiom-arrival-title" class="axiom-arrival-title">Welcome to AXIOM.</h2>
                  <span class="axiom-step-accent" aria-hidden="true"></span>
                  <p id="axiom-step-copy" class="axiom-arrival-copy"></p>
                </div>
                <div id="axiom-step-modules" class="axiom-step-modules" aria-label="AXIOM walkthrough modules"></div>
                <p class="axiom-walkthrough-protection">Your music files stay untouched. AXIOM keeps its notes and fixes inside its own library.</p>
              </div>
            </div>

            <aside class="axiom-walkthrough-sidebar">
              <div class="axiom-walkthrough-sidebar-head">
                <p>Your Quick Start</p>
                  <p id="axiom-step-counter" class="axiom-step-counter">01 / 05</p>
              </div>
              <div id="axiom-walkthrough-steps" class="axiom-walkthrough-steps"></div>
            </aside>

              <div class="axiom-step-footer">
                <div id="axiom-step-progress" class="axiom-step-progress" aria-hidden="true"></div>
                <div class="axiom-arrival-actions">
                  <button type="button" class="axiom-arrival-secondary" id="axiom-arrival-back">Back</button>
                  <button type="button" class="axiom-arrival-secondary" id="axiom-arrival-skip">Skip Tour</button>
                  <button type="button" class="axiom-arrival-primary" id="axiom-arrival-start">Next</button>
                </div>
              </div>
          </div>
        </section>
      `;
      document.body.appendChild(overlay);

      const closeArrival = () => {
        closeAxiomArrival(true);
      };

      const activateTabForStep = step => {
        if (step?.tab === 'performance' && typeof isAxiomWebPreview === 'function' && isAxiomWebPreview()) return;
        if (step?.tab && typeof showTab === 'function') {
          showTab(step.tab);
        }
      };

      const renderStep = () => {
        const step = steps[currentStep];
        overlay.querySelector('#axiom-step-page').textContent = step.section;
        overlay.querySelector('#axiom-step-counter').textContent = `${String(currentStep + 1).padStart(2, '0')} / ${String(steps.length).padStart(2, '0')}`;
        overlay.querySelector('#axiom-step-ghost').textContent = String(currentStep + 1).padStart(2, '0');
        overlay.querySelector('#axiom-arrival-title').textContent = step.title;
        overlay.querySelector('#axiom-step-copy').textContent = step.copy;
        overlay.querySelector('#axiom-arrival-start').textContent = currentStep === steps.length - 1 ? step.command : 'Next';
        overlay.querySelector('#axiom-arrival-back').disabled = currentStep === 0;

        overlay.querySelector('#axiom-walkthrough-steps').innerHTML = steps.map((item, index) => `
          <button type="button" class="axiom-walkthrough-step ${index === currentStep ? 'active' : ''}" data-step="${index}">
            <span class="axiom-walkthrough-step-number">${index + 1}</span>
            <span class="axiom-walkthrough-step-label">${item.section}</span>
          </button>
        `).join('');

        overlay.querySelector('#axiom-step-modules').innerHTML = step.modules.map(([title, body]) => `
          <div class="axiom-step-module">
            <strong>${title}</strong>
            <span>${body}</span>
          </div>
        `).join('');

        overlay.querySelector('#axiom-step-progress').innerHTML = steps.map((_, index) => `
          <span class="axiom-step-progress-dot ${index <= currentStep ? 'active' : ''}"></span>
        `).join('');

        overlay.querySelectorAll('.axiom-walkthrough-step').forEach(button => {
          button.addEventListener('click', () => {
            currentStep = Number(button.dataset.step || 0);
            activateTabForStep(steps[currentStep]);
            renderStep();
          });
        });
      };

      overlay.querySelector('#axiom-arrival-start')?.addEventListener('click', () => {
        if (currentStep >= steps.length - 1) {
          activateTabForStep(steps[currentStep]);
          closeArrival();
          return;
        }
        currentStep += 1;
        activateTabForStep(steps[currentStep]);
        renderStep();
      });
      overlay.querySelector('#axiom-arrival-back')?.addEventListener('click', () => {
        if (currentStep === 0) return;
        currentStep -= 1;
        activateTabForStep(steps[currentStep]);
        renderStep();
      });
      overlay.querySelector('#axiom-arrival-skip')?.addEventListener('click', closeArrival);
      overlay.addEventListener('click', event => {
        if (event.target === overlay) closeArrival();
      });

      renderStep();
    }

    function getAxiomWalkthroughKey(baseKey = 'axiomWalkthroughV2Seen') {
      try {
        const storedLicense = JSON.parse(localStorage.getItem('axiomWebLicense.v1') || '{}');
        const email = String(storedLicense.email || storedLicense.account_email || storedLicense.accountEmail || '').trim().toLowerCase();
        if (email) return `${baseKey}:${email}`;
      } catch (_) {}
      try {
        const entry = new URLSearchParams(window.location.search).get('entry') || '';
        if (entry === 'guest-preview') return `${baseKey}:guest-preview`;
      } catch (_) {}
      return baseKey;
    }

    window.replayAxiomWalkthrough = () => {
      const walkthroughKey = 'axiomWalkthroughV2Seen';
      localStorage.removeItem(walkthroughKey);
      localStorage.removeItem(getAxiomWalkthroughKey(walkthroughKey));
      showAxiomArrival(true);
    };

    document.addEventListener('DOMContentLoaded', () => {
      // The entrance coordinates the existing tour after licensing and splash.
      if (!window.AxiomEntrance?.eligible) setTimeout(showAxiomArrival, 350);
    });

    function increaseFontSize() {
      if (smartLinksFontScale < 1.5) {
        smartLinksFontScale += 0.1;
        updateSmartLinksFontSize();
        showToast(`Font Size: ${Math.round(smartLinksFontScale * 100)}%`);
      }
    }

    function decreaseFontSize() {
      if (smartLinksFontScale > 0.8) {
        smartLinksFontScale -= 0.1;
        updateSmartLinksFontSize();
        showToast(`Font Size: ${Math.round(smartLinksFontScale * 100)}%`);
      }
    }

    function updateSmartLinksFontSize() {
      document.documentElement.style.setProperty('--global-font-scale', smartLinksFontScale);
      document.getElementById('font-size-display').innerText = `${Math.round(smartLinksFontScale * 100)}%`;
      localStorage.setItem('smartLinksFontScale', smartLinksFontScale);
    }

    function loadSmartLinksFontScale() {
      const saved = localStorage.getItem('smartLinksFontScale');
      if (saved) {
        smartLinksFontScale = parseFloat(saved);
        updateSmartLinksFontSize();
      }
    }

    function formatTime(secs) {
      if (isNaN(secs)) return "0:00";
      const m = Math.floor(secs / 60);
      const s = Math.floor(secs % 60);
      return `${m}:${s < 10 ? '0' : ''}${s}`;
    }

    function switchTab(name) {
      window.AxiomStudioAutosave?.checkpoint();
      if (isAxiomLite() && name === 'performance') name = 'studio';
      window.AxiomEntrance?.navigate();
      const previousVisibleTab = String(window.axiomVisibleTab || '');
      const enteringStudio = name === 'studio' && previousVisibleTab !== 'studio';
      if (previousVisibleTab === 'library' && name !== 'library' && !window.AxiomDawFinder?.active) {
        clearLibraryMatchingFilters({ fetchResults: false, silent: true });
      }
      window.AxiomDawFinder?.navigate(name);
      window.axiomTabNavigationVersion = Number(window.axiomTabNavigationVersion || 0) + 1;
      window.axiomVisibleTab = String(name || '');
      document.body.classList.toggle('performance-mode-active', name === 'performance');
      const dawShell = document.getElementById('studio-daw-shell');
      if (name !== 'studio') {
        if (previousVisibleTab === 'studio') {
          dawShell?.toggleAttribute('data-resume-on-return', document.body.classList.contains('studio-daw-mode-active'));
        }
        document.body.classList.remove('studio-daw-mode-active');
        // Health shares Studio's tab container. Hide the DAW itself as well
        // as its mode styling so its drum editor cannot sit below Health.
        dawShell?.classList.add('hidden');
        dawShell?.setAttribute('aria-hidden', 'true');
        window.AxiomSourceAudition?.stop();
        window.AxiomBeatPreview?.stop();
        window.AxiomStems?.stop();
      }
      if (name === 'studio' && dawShell?.hasAttribute('data-resume-on-return') && window.AxiomStudioDaw?.activeProject) {
        dawShell.removeAttribute('data-resume-on-return');
        dawShell.classList.remove('hidden');
        dawShell.setAttribute('aria-hidden', 'false');
        document.body.classList.add('studio-daw-mode-active');
        ['studio-start-view', 'studio-active-view', 'set-brief-view'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
      }
      const studioDawActive = name === 'studio' && document.body.classList.contains('studio-daw-mode-active');
      window.setAxiomPreviewPlayerContext?.(
        studioDawActive ? 'studio-daw-preview' : 'library-studio-preview',
        { reason: `switch_tab_${name || 'unknown'}` }
      );
      if (name === 'performance') applyPerformanceLayoutPreference();
      if (name !== 'health-review') {
        const metadataRulesPanel = document.getElementById('health-metadata-rules-panel');
        const metadataRulesButton = document.getElementById('health-metadata-rules-button');
        metadataRulesPanel?.classList.add('hidden');
        metadataRulesPanel?.setAttribute('aria-hidden', 'true');
        metadataRulesButton?.setAttribute('aria-expanded', 'false');
        document.getElementById('tab-content-health-review')?.classList.remove('metadata-rules-open');
      }
      if (name !== 'health-review') {
        if (name !== 'era-review') {
          window.healthMaintenanceRequestVersion = Number(window.healthMaintenanceRequestVersion || 0) + 1;
        }
      }
      document.body.classList.remove('axiom-start-mode');
      document.getElementById('axiom-start-button')?.removeAttribute('aria-current');
      document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
      const contentName = name === 'health' ? 'studio' : name;
      const targetTab = document.getElementById(`tab-content-${contentName}`);
      if (targetTab) targetTab.classList.remove('hidden');

      const activeClass = 'axiom-sidebar-nav-item w-full flex items-center justify-between px-10 py-5 bg-gradient-to-r from-axiom-accent/20 to-transparent border-l-4 border-axiom-accent text-axiom-accent font-black uppercase text-xs tracking-[0.2em] transition-all group';
      const inactiveClass = 'axiom-sidebar-nav-item w-full flex items-center justify-between px-10 py-5 bg-transparent border-l-4 border-transparent text-white/40 hover:text-white hover:bg-white/5 font-black uppercase text-xs tracking-[0.2em] transition-all group';
      const iconActiveClass = 'w-5 h-5 drop-shadow-[0_0_8px_rgba(163,255,0,0.8)] transition-all';
      const iconInactiveClass = 'w-5 h-5 opacity-50 group-hover:opacity-100 transition-all';

      if (document.getElementById('tab-btn-studio')) {
          document.getElementById('tab-btn-studio').className = name === 'studio' ? `${activeClass} pr-24` : `${inactiveClass} pr-24`;
          document.getElementById('icon-studio').className = name === 'studio' ? iconActiveClass : iconInactiveClass;
      }
      if (document.getElementById('tab-btn-library')) {
          document.getElementById('tab-btn-library').className = name === 'library' ? activeClass : inactiveClass;
          document.getElementById('icon-library').className = name === 'library' ? iconActiveClass : iconInactiveClass;
      }
      if (document.getElementById('tab-btn-performance')) {
          document.getElementById('tab-btn-performance').className = name === 'performance' ? activeClass : inactiveClass;
          document.getElementById('icon-performance').className = name === 'performance' ? iconActiveClass : iconInactiveClass;
      }
      if (document.getElementById('tab-btn-health')) {
          document.getElementById('tab-btn-health').className = name === 'health' ? activeClass : inactiveClass;
          document.getElementById('icon-health').className = name === 'health' ? iconActiveClass : iconInactiveClass;
      }
      if (document.getElementById('tab-btn-playlists')) {
          document.getElementById('tab-btn-playlists').className = name === 'playlists' ? activeClass : inactiveClass;
          document.getElementById('icon-playlists').className = name === 'playlists' ? iconActiveClass : iconInactiveClass;
      }
      document.querySelectorAll('#axiom-sidebar .axiom-sidebar-nav-item').forEach(button => {
        button.dataset.navState = button.id === `tab-btn-${name}` ? 'active' : 'inactive';
      });
      document.querySelectorAll('.hud-pill').forEach(btn => btn.style.borderColor = 'rgba(255,255,255,0.1)');
      const activeHudBtn = document.getElementById(`tab-${name}`);
      if (activeHudBtn) activeHudBtn.style.borderColor = '#ADFF2F';

      if (name === 'health') {
        if (typeof performanceStopSeratoBridge === 'function') performanceStopSeratoBridge();
        document.body.classList.remove('bg-[#1a1a1a]');
        document.body.classList.add('bg-black');
        setStudioView('health');
        if (unifiedHealthIsActive(lastUnifiedHealthJob || {})) {
          updateUnifiedHealthProgress(lastUnifiedHealthJob);
        }
      } else if (name === 'studio') {
        if (typeof performanceStopSeratoBridge === 'function') performanceStopSeratoBridge();
        document.body.classList.remove('bg-[#1a1a1a]');
        document.body.classList.add('bg-black');
        if (enteringStudio) {
          // Native WebKit can retain the previous Studio scroll offset. Reset
          // it before and after layout so the summary header cannot render
          // underneath the compact window inset on re-entry.
          resetStudioWorkspaceScroll();
          window.requestAnimationFrame?.(resetStudioWorkspaceScroll);
        }
        if (!studioDawActive && isHealthViewVisiblyOpen()) {
          setStudioView('manual');
        } else {
          forceCloseHealthView();
        }
      } else if (name === 'library') {
        if (typeof performanceStopSeratoBridge === 'function') performanceStopSeratoBridge();
        forceCloseHealthView();
        if (typeof setGraphMode === 'function') setGraphMode(false);
        document.body.classList.remove('bg-black');
        document.body.classList.add('bg-[#1a1a1a]');
        loadLibraryStats(false);
        runSearch();
        renderLibraryMatchingFilterStatus();
        if (currentAnchorTrack && libraryMatchingSongsEnabled()) resetAndFetchLibSuggestions();
        setTimeout(maybeShowLibraryGuide, 900);
      } else if (name === 'performance') {
        forceCloseHealthView();
        performanceCheckYearPrep();
        if (typeof setGraphMode === 'function') setGraphMode(false);
        document.body.classList.remove('bg-[#1a1a1a]');
        document.body.classList.add('bg-black');
        performanceStartSeratoBridge();
        loadPerformanceRecordingDestination();
        const visiblePlayingRow = document.querySelector('.playing-track[data-path], .library-track-playing[data-path]');
        if (!performanceAnchorTrack && (currentAnchorTrack || currentPlayingPath || visiblePlayingRow)) {
          performanceUsePlayingTrack();
        } else {
          renderPerformanceMode();
        }
      } else if (name === 'playlists') {
        if (typeof performanceStopSeratoBridge === 'function') performanceStopSeratoBridge();
        forceCloseHealthView();
        if (typeof setGraphMode === 'function') setGraphMode(false);
        document.body.classList.remove('bg-[#1a1a1a]');
        document.body.classList.add('bg-black');
        refreshPlaylistsView();
      } else {
        if (typeof performanceStopSeratoBridge === 'function') performanceStopSeratoBridge();
        forceCloseHealthView();
        document.body.classList.remove('bg-[#1a1a1a]');
        document.body.classList.add('bg-black');
      }
    }

    function showAxiomConfirm(title, message, confirmText = "Confirm", type = "primary", variantOverride = '') {
        return new Promise((resolve) => {
            const overlay = document.getElementById('axiom-modal-overlay');
            const titleEl = document.getElementById('axiom-modal-title');
            const bodyEl = document.getElementById('axiom-modal-body');
            const confirmBtn = document.getElementById('axiom-modal-confirm');
            const cancelBtn = document.getElementById('axiom-modal-cancel');
            const iconDiv = document.getElementById('axiom-modal-icon');
            const card = document.getElementById('axiom-modal-card');
            const kicker = document.getElementById('axiom-modal-kicker');
            const safety = document.getElementById('axiom-modal-safety');
            const modalCopy = `${title} ${message} ${confirmText}`.toLowerCase();
            const actionCopy = `${title} ${confirmText}`.toLowerCase();
            const isHealthAction = modalCopy.includes('health')
              || (actionCopy.includes('scan') && /\b(bpm|key|year)\b/.test(modalCopy));
            const healthVariant = actionCopy.includes('all')
              ? 'health-all'
              : actionCopy.includes('bpm')
                ? 'health-bpm'
                : actionCopy.includes('key')
                  ? 'health-key'
                  : actionCopy.includes('year')
                    ? 'health-year'
                    : 'health-all';
            const variant = variantOverride
              || (type === 'danger'
                ? 'danger'
                : actionCopy.includes('djay')
                ? 'djay'
                : actionCopy.includes('serato')
                  ? 'serato'
                  : isHealthAction
                    ? healthVariant
                    : 'axiom');

            titleEl.innerText = title;
            bodyEl.innerText = message;
            confirmBtn.innerText = confirmText;
            card.dataset.variant = variant;
            kicker.innerText = variant === 'serato'
              ? 'Serato Handoff'
              : variant === 'djay'
                ? 'djay Pro Handoff'
                : variant === 'metadata'
                  ? 'Metadata Cleanup'
                : variant === 'health-bpm'
                  ? 'BPM Health'
                  : variant === 'health-key'
                    ? 'Key Health'
                    : variant === 'health-year'
                      ? 'Year Health'
                      : ['health', 'health-all'].includes(variant)
                        ? 'All Health'
                  : type === 'danger'
                    ? 'Check This Action'
                    : 'AXIOM Action';
            safety.classList.toggle('hidden', !(variant.startsWith('health') || ['serato', 'djay', 'metadata'].includes(variant)));

            confirmBtn.className = `modal-btn flex-1 ${type === 'danger' ? 'modal-btn-danger' : 'modal-btn-primary'}`;
            iconDiv.className = 'mb-4 flex justify-center';

            const cleanup = (val) => {
                overlay.classList.remove('active');
                confirmBtn.onclick = null;
                cancelBtn.onclick = null;
                resolve(val);
            };

            confirmBtn.onclick = () => cleanup(true);
            cancelBtn.onclick = () => cleanup(false);
            overlay.onclick = (e) => { if (e.target === overlay) cleanup(false); };

            overlay.classList.add('active');
        });
    }

    function exportSetBackup(event) {
      if (event) event.preventDefault();
      if (!requirePaidStudioFeature('Backup Set')) return;
      const sourceTracks = getActiveStudioOutputTracks();
      if (!sourceTracks.length) {
        showToast("Set is empty. Add tracks first.", true);
        return;
      }
      try {
        showSetNameModal('AXIOM_SET_BACKUP', (setName) => {
          if (!setName) return;
          const savedTracks = sourceTracks.map(stableBrowserTrackForSave);
          const dataStr = JSON.stringify(savedTracks, null, 2);
          const blob = new Blob([dataStr], { type: 'application/json' });
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = url;
          a.download = `${setName}.json`;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
          }, 100);
          showSaveSetSuccess(setName, sourceTracks.length, 'backup');
        });
      } catch (err) {
        showToast('Backup failed', true);
      }
    }

    function resetHealthViewScroll() {
        const healthView = document.getElementById('health-view');
        const studioActiveView = document.getElementById('studio-active-view');
        if (healthView) healthView.scrollTop = 0;
        if (studioActiveView) studioActiveView.scrollTop = 0;
        if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }

    function resetStudioWorkspaceScroll() {
        const studioTab = document.getElementById('tab-content-studio');
        const studioActiveView = document.getElementById('studio-active-view');
        if (studioTab) studioTab.scrollTop = 0;
        if (studioActiveView) studioActiveView.scrollTop = 0;
        if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }

    function isHealthViewVisiblyOpen() {
        const healthView = document.getElementById('health-view');
        return activeStudioView === 'health'
            || document.body.classList.contains('studio-health-mode')
            || Boolean(healthView && !healthView.classList.contains('hidden'));
    }

    function forceCloseHealthView() {
        const healthView = document.getElementById('health-view');
        const graphContainer = document.getElementById('graph-container');
        const playlistContainer = document.getElementById('active-playlist-container');

        document.body.classList.remove('studio-health-mode');
        if (healthView) healthView.classList.add('hidden');
        if (graphContainer && !graphModeOpen) graphContainer.classList.remove('hidden');
        if (playlistContainer) playlistContainer.classList.remove('hidden');
        if (activeStudioView === 'health') activeStudioView = 'manual';
    }

    function showAxiomStart(options = {}) {
        const reviewMode = axiomReviewMode();
        const entranceReview = reviewMode === 'entrance' && window.__axiomEntranceSession?.fixture === true;
        const readyEntranceReview = new URLSearchParams(location.search).get('entrance_library') === 'ready'
          && (entranceReview || ['studio-start', 'quick-start'].includes(reviewMode));
        if (reviewMode && !entranceReview && !options.allowReviewNavigation && !['studio-start', 'quick-start', 'real-data-audit'].includes(reviewMode)) return;
        if (libraryHasTracks !== true && !options.entrance && !readyEntranceReview) {
          showConnectMusicView();
          return;
        }
        activeStudioView = 'manual';
        const dawShell = document.getElementById('studio-daw-shell');
        dawShell?.removeAttribute('data-resume-on-return');
        dawShell?.classList.add('hidden');
        dawShell?.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('studio-daw-mode-active');
        document.body.classList.remove('studio-health-mode', 'bg-[#1a1a1a]');
        document.body.classList.add('bg-black');
        forceCloseHealthView();
        showTab('studio');
        document.getElementById('connect-music-view')?.classList.add('hidden');
        document.body.classList.remove('connect-music-stage');
        document.getElementById('set-brief-view')?.classList.add('hidden');
        document.getElementById('studio-active-view')?.classList.add('hidden');
        document.getElementById('studio-start-view')?.classList.remove('hidden');
        document.body.classList.add('axiom-start-mode');
        const studioNav = document.getElementById('tab-btn-studio');
        if (studioNav) studioNav.dataset.navState = 'inactive';
        document.getElementById('axiom-start-button')?.setAttribute('aria-current', 'page');
        updateStudioToolsAvailability();
        if (readyEntranceReview) document.getElementById('studio-path-room')?.classList.remove('hidden');
    }

    function showStudioLaunchView(options = {}) {
      showAxiomStart(options);
    }

    function showStudioWorkspace() {
      if (libraryHasTracks !== true) {
        showConnectMusicView();
        return;
      }
      showTab('studio');
      document.getElementById('connect-music-view')?.classList.add('hidden');
      document.getElementById('studio-start-view')?.classList.add('hidden');
      document.getElementById('set-brief-view')?.classList.add('hidden');
      document.getElementById('studio-daw-shell')?.classList.add('hidden');
      document.getElementById('studio-daw-shell')?.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('studio-daw-mode-active');
      window.setAxiomPreviewPlayerContext?.('library-studio-preview', { reason: 'show_studio_workspace' });
      document.getElementById('studio-active-view')?.classList.remove('hidden');
      setStudioView(activeStudioView === 'health' ? 'manual' : activeStudioView);
      // DAW and the Working Set share this tab, so this return can bypass the
      // enteringStudio reset. Clear the old DAW offset after restoring Studio.
      resetStudioWorkspaceScroll();
      window.requestAnimationFrame?.(resetStudioWorkspaceScroll);
      updateStudioToolsAvailability();
    }

    function syncMusicConnectionViews() {
      if (['health', 'library-gap-checker', 'library-state-audit', 'magic-set'].includes(axiomReviewMode())) {
        libraryHasTracks = true;
        document.body.classList.remove('library-empty', 'connect-music-stage');
        document.getElementById('connect-music-view')?.classList.add('hidden');
        return false;
      }
      const needsMusic = libraryHasTracks !== true;
      document.body.classList.toggle('library-empty', needsMusic);
      document.body.classList.toggle('connect-music-stage', needsMusic);
      document.getElementById('connect-music-view')?.classList.toggle('hidden', !needsMusic);
      if (needsMusic) {
        document.getElementById('studio-start-view')?.classList.add('hidden');
        document.getElementById('set-brief-view')?.classList.add('hidden');
        document.getElementById('studio-active-view')?.classList.add('hidden');
      }
      return needsMusic;
    }

    function showConnectMusicView() {
      if (axiomReviewMode() === 'health') {
        libraryHasTracks = true;
        switchTab('health');
        return;
      }
      activeStudioView = 'manual';
      document.body.classList.remove('studio-health-mode', 'bg-[#1a1a1a]');
      document.body.classList.add('bg-black');
      forceCloseHealthView();
      switchTab('studio');
      syncMusicConnectionViews();
      updateStudioToolsAvailability();
    }

    function setStudioView(view, options = {}) {
        if (view === 'health' && graphModeOpen && typeof setGraphMode === 'function') {
            setGraphMode(false);
        }
        activeStudioView = view;
        document.body.classList.toggle('studio-health-mode', view === 'health');
        const manTab = document.getElementById('studio-tab-manual');
        const routeTab = document.getElementById('studio-tab-route');
        const healthView = document.getElementById('health-view');
        const graphContainer = document.getElementById('graph-container');
        const playlistContainer = document.getElementById('active-playlist-container');

        updateStudioBuildModeVisibility();
        updateHarmonicRouteVisibility();
        [manTab, routeTab].forEach(t => t?.classList.remove('active'));
        manTab?.classList.toggle('manual-user-activated', view === 'manual' && Boolean(options.userActivated));
        manTab?.setAttribute('aria-pressed', view === 'manual' ? 'true' : 'false');
        routeTab?.setAttribute('aria-pressed', view === 'route' ? 'true' : 'false');


        if (view === 'manual') {
            manTab?.classList.add('active');
            healthView.classList.add('hidden');
            if (!graphModeOpen) graphContainer.classList.remove('hidden');
            playlistContainer.classList.remove('hidden');
            maybeShowStudioGuide();
        } else if (view === 'route') {
            if (!Array.isArray(currentRoutePlaylist) || currentRoutePlaylist.length === 0) {
              showToast('Click Suggest Order first to create a harmonic route.', true);
              setStudioView('manual');
              return;
            }
            routeTab?.classList.add('active');
            healthView.classList.add('hidden');
            if (!graphModeOpen) graphContainer.classList.remove('hidden');
            playlistContainer.classList.remove('hidden');
            maybeShowStudioGuide();
        } else if (view === 'health') {
            document.getElementById('studio-start-view')?.classList.add('hidden');
            document.getElementById('studio-active-view')?.classList.remove('hidden');
            healthView.classList.remove('hidden');
            resetHealthViewScroll();
            graphContainer.classList.add('hidden');
            playlistContainer.classList.add('hidden');
            // Opening Health is a quiet snapshot refresh. The fixed scan banner is
            // reserved for an actual user-started repair so entering the tab never
            // shifts or flashes the whole cockpit.
            if (axiomReviewMode() !== 'health') {
                runLibraryHealthCheck({ force: false, silent: true, skipProgress: true });
            }
        }
        renderPlaylist();
    }
