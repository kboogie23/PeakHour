    function axiomRecordVaultStaticUrl(path) {
      const web = document.querySelector('script[src*="/axiom-cockpit/static/js/surfaces/library-intake.js"]');
      return `${web ? '/axiom-cockpit/static' : '/static'}/${path}`;
    }

    function ensureAxiomRecordVaultStyles() {
      if (document.querySelector('link[href*="/static/css/surfaces/record-vault.css"]')) return;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = axiomRecordVaultStaticUrl('css/surfaces/record-vault.css?v=20261006-approved-v1');
      document.head.appendChild(link);
    }

    // Library count, music intake progress, and Studio-add feedback overlays.
    function updateLibraryCount(n) {
      const el = document.getElementById('lib-track-count-val');
      const healthEl = document.getElementById('health-inbox-track-total');
      const value = n != null ? Number(n).toLocaleString() : '—';
      const cleanupSandboxCount = axiomUiPreviewMode() === 'health-cleanup-sandbox' ? '120' : '';
      const reviewEligibleCount = axiomReviewMode() === 'health'
        ? Number(currentHealthSummary?.health_eligible_tracks || 0)
        : 0;
      const reviewFixtureCount = axiomReviewMode() === 'health'
        ? new Set((currentHealthTracks || [])
            .filter(track => track.health_review_fixture)
            .map(track => track.path || track.filename || track.title)).size
        : 0;
      const reviewLibraryCount = axiomReviewMode() === 'health'
        ? Number(currentHealthSummary?.health_review_library_tracks || 0)
        : 0;
      const displayedLibraryValue = cleanupSandboxCount || (reviewLibraryCount > 0
        ? reviewLibraryCount.toLocaleString()
        : (reviewEligibleCount > 0 ? reviewEligibleCount.toLocaleString() : value));
      if (el) el.textContent = displayedLibraryValue;
      window.AxiomEntranceLibrary?.setCount(n);
      if (healthEl) healthEl.textContent = cleanupSandboxCount || (reviewEligibleCount > 0
        ? reviewEligibleCount.toLocaleString()
        : reviewFixtureCount > 0
          ? reviewFixtureCount.toLocaleString()
          : value);
    }

    let musicIntakeHideTimer = null;
    let musicIntakeAnticipationTimer = null;
    let musicIntakeCompletionFrame = null;
    let musicIntakeDisplayedProgress = 3;
    let musicIntakeDisplayedCount = 0;
    let musicIntakeActivityFrame = 0;
    let musicIntakeState = { indexed: 0, total: 0, stage: 'Loading Music', folderName: 'Music Library', updatedAt: 0 };

    function ensureMusicIntakeOverlay() {
      ensureAxiomRecordVaultStyles();
      let overlay = document.getElementById('music-intake-overlay');
      if (overlay) return overlay;
      overlay = document.createElement('div');
      overlay.id = 'music-intake-overlay';
      overlay.className = 'music-intake-overlay hidden record-vault-overlay';
      const editionLabel = isAxiomLite() ? 'LITE' : 'PRO';
      overlay.innerHTML = `
        <div class="music-intake-inner record-vault-intake" role="status" aria-live="polite">
          <div class="vault-intake-copy">
            <div class="vault-brand"><b>AXIOM<small>${editionLabel}</small></b><span>RECORD VAULT / MUSIC IMPORT</span></div>
            <h2 id="vault-intake-heading" class="vault-intake-heading">ADDING YOUR <em>MUSIC</em></h2>
            <p id="music-intake-message" class="music-intake-message">AXIOM is reading your music and adding it to your library.</p>
            <p class="vault-protection">Original music stays untouched.</p>
            <div class="vault-source"><img src="${axiomRecordVaultStaticUrl('icons/folder-open.svg')}" alt="" /><div><strong id="music-intake-title">Music Library</strong><span id="music-intake-kicker">Reading track details…</span></div></div>
            <div class="music-intake-progress" role="progressbar" aria-label="Music import progress" aria-valuemin="0" aria-valuemax="100"><span id="music-intake-progress-bar"></span></div>
            <div class="vault-progress-summary"><strong id="music-intake-percent-summary">0%</strong><div id="music-intake-count">0<span>Tracks</span></div><button type="button" class="music-intake-hide" onclick="hideMusicIntakeOverlay()">Hide progress</button></div>
          </div>
          <div class="vault-motion-stage" aria-hidden="true">
            <img class="vault-smoke" src="${axiomRecordVaultStaticUrl('assets/record-vault/glow.png')}" alt="" />
            ${Array.from({length:6}, (_,i) => `<img class="vault-flying-record record-${i}" src="${axiomRecordVaultStaticUrl('assets/record-vault/record.png')}" alt="" style="animation-delay:${(-i * .9) / 1.1}s" />`).join('')}
            <img class="vault-crate" src="${axiomRecordVaultStaticUrl('assets/record-vault/crate.png')}" alt="" />
            <span class="vault-art-caption">COLLECT<br />PREPARE<br />PLAY</span>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      return overlay;
    }

    function renderMusicIntakeOverlay(payload = {}, display = {}) {
      const overlay = ensureMusicIntakeOverlay();
      clearTimeout(musicIntakeHideTimer);
      musicIntakeState = {
        ...musicIntakeState,
        ...payload,
        updatedAt: display.preserveUpdatedAt ? musicIntakeState.updatedAt : Date.now()
      };
      const total = Math.max(0, Number(musicIntakeState.total || 0));
      const indexed = Math.max(0, Math.min(total || Number(musicIntakeState.indexed || 0), Number(musicIntakeState.indexed || 0)));
      const indeterminate = display.indeterminate === true;
      const measuredProgress = total > 0 ? Math.max(0, Math.min(100, (indexed / total) * 100)) : musicIntakeDisplayedProgress;
      const requestedProgress = Number(display.progress);
      const progress = indeterminate ? 0 : Math.max(0, Math.min(100, Number.isFinite(requestedProgress) ? requestedProgress : measuredProgress));
      const requestedCount = Number(display.count);
      const displayedCount = Math.max(0, Math.round(Number.isFinite(requestedCount) ? requestedCount : (total ? indexed : Number(musicIntakeState.indexed || 0))));
      musicIntakeDisplayedProgress = progress;
      musicIntakeDisplayedCount = displayedCount;
      const folderName = musicIntakeState.folderName || 'Music Library';
      const stage = musicIntakeState.stage || 'Loading Music';
      const title = musicIntakeState.title || (folderName ? `${folderName} Index` : 'Building AXIOM Index');
      document.getElementById('music-intake-kicker').textContent = stage;
      document.getElementById('music-intake-title').textContent = folderName;
      document.getElementById('music-intake-message').textContent = musicIntakeState.message || 'BPM, key, year, energy, and playable track links are being prepared.';
      const foldersSeen = Math.max(0, Number(musicIntakeState.foldersSeen || 0));
      const countUnit = indeterminate && indexed <= 0 ? 'Folders' : 'Tracks';
      const countValue = indeterminate && indexed <= 0 ? foldersSeen : displayedCount;
      document.getElementById('music-intake-count').innerHTML = `${countValue.toLocaleString()}${total ? ` / ${total.toLocaleString()}` : ''}<span>${countUnit}</span>`;
      const progressBar = document.getElementById('music-intake-progress-bar');
      overlay.classList.toggle('is-indeterminate', indeterminate);
      if (progressBar) {
        progressBar.style.setProperty('--progress', indeterminate ? '18%' : `${progress}%`);
        progressBar.style.width = indeterminate ? '18%' : `${progress}%`;
        const meter = progressBar.parentElement;
        if (indeterminate) meter.removeAttribute('aria-valuenow');
        else meter.setAttribute('aria-valuenow', String(Math.round(progress)));
        const positions = [-100, 80, 260, 440];
        progressBar.style.transform = indeterminate ? `translateX(${positions[Number(display.activityFrame || 0) % positions.length]}%)` : '';
      }
      const stageMap = [
        ['music-intake-stage-read', 'music-intake-route-read', 0],
        ['music-intake-stage-bpm', 'music-intake-route-bpm', 26],
        ['music-intake-stage-key', 'music-intake-route-key', 52],
        ['music-intake-stage-links', 'music-intake-route-links', 76]
      ];
      stageMap.forEach(([cardId, routeId, start], index) => {
        const nextStart = stageMap[index + 1]?.[2] ?? 101;
        [document.getElementById(cardId), document.getElementById(routeId)].forEach((el) => {
          if (!el) return;
          el.classList.toggle('is-active', progress >= start && progress < nextStart);
          el.classList.toggle('is-done', progress >= nextStart);
        });
      });
      const sourceEl = document.getElementById('music-intake-source');
      const percentEl = document.getElementById('music-intake-percent');
      const percentSummaryEl = document.getElementById('music-intake-percent-summary');
      const readyEl = document.getElementById('music-intake-ready');
      const proofOne = document.getElementById('music-intake-proof-1');
      const proofTwo = document.getElementById('music-intake-proof-2');
      if (sourceEl) sourceEl.textContent = folderName.replace(/\s+library$/i, '').slice(0, 12) || 'Music';
      const liveLabel = `LIVE${'.'.repeat((Number(display.activityFrame || 0) % 4) + 1)}`;
      if (percentEl) percentEl.textContent = indeterminate ? liveLabel : `${Math.round(progress)}%`;
      if (percentSummaryEl) percentSummaryEl.textContent = indeterminate ? liveLabel : `${Math.round(progress)}%`;
      if (readyEl) readyEl.textContent = indeterminate ? 'Reading' : progress >= 96 ? 'Ready' : progress >= 52 ? 'Links' : 'Prep';
      if (proofOne) proofOne.textContent = total > 0
        ? `${displayedCount.toLocaleString()} of ${total.toLocaleString()} tracks are in the performance index.`
        : indexed > 0
          ? `${indexed.toLocaleString()} tracks indexed from ${foldersSeen.toLocaleString()} folders. The drive is responding.`
          : `${foldersSeen.toLocaleString()} folders checked. The drive is responding.`;
      if (proofTwo) proofTwo.textContent = progress >= 76 ? 'AXIOM is shaping openers, bridges, peaks, and reset options.' : 'Preparing BPM, key, year, energy, and playable track links.';
      overlay.classList.remove('hidden');
      requestAnimationFrame(() => overlay.classList.add('active'));
    }

    function showMusicIntakeOverlay(payload = {}) {
      suspendAxiomConnectionDialogsForProgress();
      clearInterval(musicIntakeAnticipationTimer);
      if (musicIntakeCompletionFrame) cancelAnimationFrame(musicIntakeCompletionFrame);
      musicIntakeCompletionFrame = null;
      musicIntakeDisplayedProgress = 0;
      musicIntakeDisplayedCount = 0;
      musicIntakeActivityFrame = 0;
      ensureMusicIntakeOverlay().classList.add('is-loading');
      ensureMusicIntakeOverlay().classList.remove('is-complete');
      const heading = document.getElementById('vault-intake-heading');
      if (heading) heading.innerHTML = 'ADDING YOUR <em>MUSIC</em>';
      renderMusicIntakeOverlay({ indexed: 0, total: 0, foldersSeen: 0, ...payload }, { progress: 0, count: 0, indeterminate: true, activityFrame: 0 });
      musicIntakeAnticipationTimer = setInterval(() => {
        if (Number(musicIntakeState.total || 0) > 0) return;
        musicIntakeActivityFrame = (musicIntakeActivityFrame + 1) % 4;
        renderMusicIntakeOverlay({}, {
          progress: 0,
          count: musicIntakeDisplayedCount,
          indeterminate: true,
          activityFrame: musicIntakeActivityFrame,
          preserveUpdatedAt: true
        });
      }, 450);
    }

    function hideMusicIntakeOverlay(immediate = false) {
      clearTimeout(musicIntakeHideTimer);
      clearInterval(musicIntakeAnticipationTimer);
      if (musicIntakeCompletionFrame) cancelAnimationFrame(musicIntakeCompletionFrame);
      musicIntakeCompletionFrame = null;
      const overlay = document.getElementById('music-intake-overlay');
      if (!overlay) return;
      overlay.classList.remove('is-loading');
      overlay.classList.remove('active');
      if (immediate) {
        overlay.classList.add('hidden');
        return;
      }
      setTimeout(() => overlay.classList.add('hidden'), 180);
    }

    function updateMusicIntakeOverlay(payload = {}) {
      const total = Math.max(0, Number(payload.total ?? musicIntakeState.total ?? 0));
      const indexed = Math.max(0, Number(payload.indexed ?? musicIntakeState.indexed ?? 0));
      const measuredProgress = total > 0 ? Math.round((Math.min(total, indexed) / total) * 100) : musicIntakeDisplayedProgress;
      const requestedProgress = Number(payload.progress);
      const nextProgress = Number.isFinite(requestedProgress)
        ? Math.max(musicIntakeDisplayedProgress, requestedProgress)
        : Math.max(musicIntakeDisplayedProgress, measuredProgress);
      const indeterminate = payload.indeterminate === true || (total <= 0 && !Number.isFinite(requestedProgress));
      renderMusicIntakeOverlay(payload, {
        progress: nextProgress,
        count: indexed,
        indeterminate,
        activityFrame: musicIntakeActivityFrame
      });
    }

    function completeMusicIntakeOverlay(payload = {}) {
      const overlay = ensureMusicIntakeOverlay();
      overlay.classList.remove('is-loading');
      overlay.classList.add('is-complete');
      const heading = document.getElementById('vault-intake-heading');
      if (heading) heading.innerHTML = /paused|failed|stopped/i.test(payload.stage || '') ? 'MUSIC IMPORT <em>PAUSED</em>' : 'YOUR MUSIC <em>IS READY</em>';
      clearInterval(musicIntakeAnticipationTimer);
      if (musicIntakeCompletionFrame) cancelAnimationFrame(musicIntakeCompletionFrame);
      const finalTotal = Math.max(0, Number(payload.total ?? musicIntakeState.total ?? 0));
      const finalCount = Math.max(0, Number(payload.indexed ?? payload.total ?? musicIntakeState.total ?? 0));
      const completionPayload = {
        ...payload,
        indexed: finalCount,
        total: finalTotal,
        stage: payload.stage || 'Library Ready',
        message: payload.message || 'Your tracks are ready for Library, Studio, and Magic Set.'
      };
      if (finalTotal <= 0 || finalCount <= 0) {
        renderMusicIntakeOverlay(completionPayload, {
          progress: musicIntakeDisplayedProgress,
          count: finalCount
        });
        musicIntakeHideTimer = setTimeout(hideMusicIntakeOverlay, 2200);
        return;
      }
      const startProgress = Math.min(96, musicIntakeDisplayedProgress);
      const startCount = Math.min(finalCount, musicIntakeDisplayedCount);
      const startedAt = performance.now();
      const duration = 1100;
      const animateCompletion = now => {
        const elapsed = Math.max(0, Math.min(1, (now - startedAt) / duration));
        const eased = 1 - Math.pow(1 - elapsed, 3);
        renderMusicIntakeOverlay(completionPayload, {
          progress: Math.round(startProgress + ((100 - startProgress) * eased)),
          count: Math.round(startCount + ((finalCount - startCount) * eased)),
          preserveUpdatedAt: true
        });
        if (elapsed < 1) {
          musicIntakeCompletionFrame = requestAnimationFrame(animateCompletion);
          return;
        }
        musicIntakeCompletionFrame = null;
        musicIntakeHideTimer = setTimeout(hideMusicIntakeOverlay, 2200);
      };
      musicIntakeCompletionFrame = requestAnimationFrame(animateCompletion);
    }

    let studioAddedHideTimer = null;

    function hideStudioAddedOverlay() {
      clearTimeout(studioAddedHideTimer);
      document.getElementById('studio-added-overlay')?.classList.remove('active');
    }

    function ensureStudioAddedOverlay() {
      let overlay = document.getElementById('studio-added-overlay');
      if (overlay) return overlay;
      overlay = document.createElement('div');
      overlay.id = 'studio-added-overlay';
      overlay.className = 'studio-added-overlay';
      overlay.innerHTML = `
        <div class="studio-added-panel" role="status" aria-live="polite">
          <div class="studio-added-head">
            <div>
              <p class="studio-added-kicker">Added To Studio</p>
              <h2 id="studio-added-title" class="studio-added-title">Working Set</h2>
              <p id="studio-added-copy" class="studio-added-copy">The track is in your set and ready for the next decision.</p>
            </div>
            <button type="button" class="studio-added-close" onclick="hideStudioAddedOverlay()" title="Close" aria-label="Close Studio update">&times;</button>
          </div>
          <div class="studio-added-mission-row">
            <div class="studio-added-mission"><span>Mission</span><strong id="studio-added-mission">Working Set</strong></div>
            <div id="studio-added-journey" class="studio-added-journey">Build your sequence</div>
          </div>
          <div class="studio-added-phases" aria-label="Set journey">
            <div class="studio-added-phase">Warm-Up</div>
            <div class="studio-added-phase">Build</div>
            <div class="studio-added-phase">Peak</div>
            <div class="studio-added-phase">Close</div>
          </div>
          <div id="studio-added-tracks" class="studio-added-tracks"></div>
          <div class="studio-added-foot">
            <div id="studio-added-count" class="studio-added-count">1 Track</div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
              <button id="studio-added-session-hide" type="button" class="studio-added-session-hide" onclick="hideWorkingSetAnimationForSession()">Don't Show Again This Session</button>
              <button type="button" class="studio-added-view" onclick="hideStudioAddedOverlay(); showTab('studio')">View In Set</button>
            </div>
          </div>
        </div>
      `;
      overlay.addEventListener('click', event => {
        if (event.target === overlay) hideStudioAddedOverlay();
      });
      document.body.appendChild(overlay);
      return overlay;
    }

    function sampleStudioAddedTracks(tracks = [], maxTracks = 12) {
      if (tracks.length <= maxTracks) return tracks.slice();
      const sampled = [];
      for (let index = 0; index < maxTracks; index += 1) {
        sampled.push(tracks[Math.round(index * (tracks.length - 1) / (maxTracks - 1))]);
      }
      return sampled;
    }

    function studioMissionName() {
      const brief = setBriefPayload();
      if (!brief.enabled) return 'Working Set';
      const label = setBriefLabel('intention', brief.intention);
      return /\bset\b/i.test(label) ? label : `${label} Set`;
    }
