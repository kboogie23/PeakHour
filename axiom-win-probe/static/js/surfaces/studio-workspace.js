    // Studio Room Rescue, workspace, version chooser, and graph controls.
    if (typeof document !== 'undefined' && document.head
        && !document.getElementById('magic-set-completion-styles')) {
      const completionStyles = document.createElement('link');
      completionStyles.id = 'magic-set-completion-styles';
      completionStyles.rel = 'stylesheet';
      completionStyles.href = '/static/css/surfaces/studio/magic-set-completion.css?v=20261014-surface-v1';
      document.head.appendChild(completionStyles);
    }
    let roomRescueState = { gig: '', moment: '', tracks: [], brief: null, direction: '', loading: false };
    let roomRescueTracksRequestId = 0;

    function roomRescueElement(id) {
      return document.getElementById(id);
    }

    function resetRoomRescueWizard() {
      roomRescueState = { gig: '', moment: '', tracks: [], brief: null, direction: '', loading: false };
      renderRoomRescueWizard();
    }

    function roomRescueStepNumber() {
      if (roomRescueState.moment) return 3;
      if (roomRescueState.gig) return 2;
      return 1;
    }

    function renderRoomRescueWizard() {
      const step = roomRescueStepNumber();
      const gigStep = roomRescueElement('room-rescue-step-gig');
      const momentStep = roomRescueElement('room-rescue-step-moment');
      const startStep = roomRescueElement('room-rescue-step-start');
      const title = roomRescueElement('room-rescue-title');
      const copy = roomRescueElement('room-rescue-copy');
      const back = document.querySelector('.room-rescue-back');
      gigStep?.classList.toggle('hidden', step !== 1);
      momentStep?.classList.toggle('hidden', step !== 2);
      startStep?.classList.toggle('hidden', step !== 3);
      if (back) back.classList.toggle('hidden', step === 1);
      document.querySelectorAll('[data-room-rescue-progress]').forEach(item => {
        const itemStep = Number(item.getAttribute('data-room-rescue-progress') || 0);
        item.classList.toggle('active', itemStep === step);
        item.classList.toggle('complete', itemStep < step);
      });
      if (step === 1) {
        if (title) title.textContent = 'WHAT KIND OF GIG?';
        if (copy) copy.textContent = 'Pick one. No setup forms.';
      } else if (step === 2) {
        const gig = ROOM_RESCUE_GIGS[roomRescueState.gig];
        if (title) title.textContent = 'WHAT IS HAPPENING RIGHT NOW?';
        if (copy) copy.textContent = `${gig?.label || 'The room'} — choose the closest answer.`;
        renderRoomRescueMoments();
      } else {
        if (title) title.textContent = 'START HERE';
        if (copy) copy.textContent = 'Five real songs from your Library. One clear direction.';
        const direction = roomRescueElement('room-rescue-direction');
        if (direction) direction.textContent = roomRescueState.direction || 'Finding the clearest place to start...';
        renderRoomRescueTracks();
      }
    }

    function renderRoomRescueMoments() {
      const grid = roomRescueElement('room-rescue-moment-grid');
      const gig = ROOM_RESCUE_GIGS[roomRescueState.gig];
      if (!grid || !gig) return;
      grid.innerHTML = gig.moments.map(moment => `
        <button type="button" class="room-rescue-moment-card" onclick="selectRoomRescueMoment('${escapeJs(moment.id)}')">
          <span>${escapeHtml(moment.label)}</span>
          <b aria-hidden="true">&rarr;</b>
        </button>
      `).join('');
    }

    function selectRoomRescueGig(gigId) {
      if (!ROOM_RESCUE_GIGS[gigId]) return;
      roomRescueState = { gig: gigId, moment: '', tracks: [], brief: null, direction: '', loading: false };
      renderRoomRescueWizard();
    }

    async function selectRoomRescueMoment(momentId) {
      const gig = ROOM_RESCUE_GIGS[roomRescueState.gig];
      const moment = gig?.moments.find(item => item.id === momentId);
      if (!moment) return;
      roomRescueState.moment = moment.id;
      roomRescueState.direction = moment.direction;
      roomRescueState.brief = normalizeSetBrief({
        ...DEFAULT_SET_BRIEF,
        ...moment.brief,
        enabled: true,
        purpose: 'live_set',
        duration: 60,
        era: 'All',
        planningStyle: 'guided'
      });
      roomRescueState.tracks = [];
      roomRescueState.loading = true;
      renderRoomRescueWizard();
      await loadRoomRescueTracks();
    }

    function roomRescueBack() {
      if (roomRescueState.moment) {
        roomRescueState.moment = '';
        roomRescueState.tracks = [];
        roomRescueState.brief = null;
        roomRescueState.direction = '';
        roomRescueState.loading = false;
      } else if (roomRescueState.gig) {
        roomRescueState.gig = '';
      } else {
        closeSetBrief();
        return;
      }
      renderRoomRescueWizard();
    }

    function roomRescueChangeMoment() {
      roomRescueState.moment = '';
      roomRescueState.tracks = [];
      roomRescueState.brief = null;
      roomRescueState.direction = '';
      roomRescueState.loading = false;
      renderRoomRescueWizard();
    }

    async function loadRoomRescueTracks() {
      const requestId = ++roomRescueTracksRequestId;
      const requestedBrief = roomRescueState.brief;
      const isCurrentRequest = () => requestId === roomRescueTracksRequestId
        && roomRescueState.brief === requestedBrief;
      const list = roomRescueElement('room-rescue-track-list');
      const build = roomRescueElement('room-rescue-build');
      if (build) build.disabled = true;
      if (list) list.innerHTML = '<div class="room-rescue-loading">Finding five songs in your Library...</div>';
      try {
        const resp = await fetch('/api/studio/brief_readiness', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ set_brief: requestedBrief })
        });
        const data = await resp.json().catch(() => ({}));
        if (!isCurrentRequest()) return;
        if (!resp.ok || data.success === false) throw new Error(data.error || data.message || 'AXIOM could not read this Library.');
        roomRescueState.tracks = (Array.isArray(data.top_tracks) ? data.top_tracks : []).filter(track => track?.path).slice(0, 5);
        roomRescueState.loading = false;
        renderRoomRescueTracks();
      } catch (err) {
        if (!isCurrentRequest()) return;
        roomRescueState.tracks = [];
        roomRescueState.loading = false;
        if (list) list.innerHTML = `<div class="room-rescue-empty"><strong>Connect your music first.</strong><span>${escapeHtml(err.message || 'AXIOM needs a connected Library to choose five real songs.')}</span><button type="button" class="button--primary" onclick="closeSetBrief(); showTab('library')">Open Library</button></div>`;
      }
    }

    function renderRoomRescueTracks() {
      const list = roomRescueElement('room-rescue-track-list');
      const build = roomRescueElement('room-rescue-build');
      if (!list) return;
      if (roomRescueState.loading) {
        list.innerHTML = '<div class="room-rescue-loading">Finding five songs in your Library...</div>';
        if (build) build.disabled = true;
        return;
      }
      if (!roomRescueState.tracks.length) {
        list.innerHTML = '<div class="room-rescue-empty"><strong>No starting songs found.</strong><span>Connect or refresh your Library, then try this answer again.</span><button type="button" class="button--secondary" onclick="loadRoomRescueTracks()">Try Again</button></div>';
        if (build) build.disabled = true;
        return;
      }
      list.innerHTML = roomRescueState.tracks.map((track, index) => `
        <article class="room-rescue-track">
          <span class="room-rescue-track-number">0${index + 1}</span>
          ${renderTrackArtwork(track, 'room-rescue-track-art')}
          <div class="room-rescue-track-copy">
            <strong>${escapeHtml(track.title || track.filename || 'Unknown Track')}</strong>
            <span>${escapeHtml(track.artist || 'Unknown Artist')}</span>
          </div>
          <div class="room-rescue-track-role">
            <b>${escapeHtml(track.axiom_role || 'Start Fit')}</b>
            <span>${track.bpm ? `${Number(track.bpm).toFixed(1)} BPM` : 'BPM --'}${track.camelot ? ` · ${escapeHtml(track.camelot)}` : ''}</span>
          </div>
        </article>
      `).join('');
      if (build) {
        build.disabled = roomRescueState.tracks.length < 1;
        // Bind the final handoff directly once the recommendations exist.
        // This keeps the action reliable in both the native WebView and the
        // browser cockpit even when an inline handler is not compiled.
        build.onclick = buildRoomRescueStart;
      }
    }

    function roomRescueStudioOutcomeMatches(expectedTracks = []) {
      const studio = document.getElementById('studio-active-view');
      const playlist = document.getElementById('active-playlist-container');
      if (!studio || !playlist || studio.classList.contains('hidden')) return false;
      const renderedRows = playlist.querySelectorAll('.playlist-row[data-path]');
      const oversizedFallback = [...document.querySelectorAll('.artwork-fallback')].some(fallback => {
        const bounds = fallback.getBoundingClientRect();
        return bounds.width > 300 || bounds.height > 300;
      });
      return renderedRows.length === expectedTracks.length && !oversizedFallback;
    }

    function assertRoomRescueStudioOutcome(expectedTracks = []) {
      if (roomRescueStudioOutcomeMatches(expectedTracks)) return true;

      // One deterministic recovery pass clears stale generated-view artwork
      // and re-renders the approved manual Studio rows.  If that still fails,
      // stop visibly instead of leaving the user inside an empty green screen.
      const magicSelected = document.getElementById('magic-selected-card');
      if (magicSelected) {
        magicSelected.classList.add('hidden');
        magicSelected.innerHTML = '';
      }
      document.getElementById('studio-active-view')?.classList.remove('hidden', 'graph-mode');
      document.getElementById('active-playlist-container')?.classList.remove('hidden');
      renderPlaylist();
      if (!roomRescueStudioOutcomeMatches(expectedTracks)) {
        throw new Error('AXIOM stopped an incomplete Studio handoff. Your five-song start is still safe; try Build This Start again.');
      }
      return true;
    }

    async function buildRoomRescueStart() {
      if (!roomRescueState.brief || !roomRescueState.tracks.length) return;
      const build = roomRescueElement('room-rescue-build');
      if (build) {
        build.disabled = true;
        build.innerHTML = 'Building Your Start...';
      }
      try {
        const startingTracks = roomRescueState.tracks.map(track => ({ ...track }));
        currentSetBrief = normalizeSetBrief({ ...roomRescueState.brief, enabled: true });
        beginLibraryFreshBuild('room-rescue');
        editingPlaylistId = null;
        currentPlaylist = startingTracks;
        currentRoutePlaylist = [];
        activeStudioView = 'manual';
        magicSetStudioCtaReady = false;
        resetModalSuggestionDecisions();
        applySetBriefToStudioControls();
        await fetch('/api/session/new', { method: 'POST' }).catch(() => null);

        // Room Rescue must always enter a clean manual Studio workspace.
        // A previously opened Magic Set graph can otherwise keep the playlist
        // hidden and stretch a fallback artwork initial across the workspace.
        if (typeof setGraphMode === 'function') setGraphMode(false);
        document.body.classList.remove('graph-mode-active', 'studio-magic-mode', 'studio-health-mode', 'axiom-start-mode');
        document.getElementById('studio-active-view')?.classList.remove('graph-mode');
        forceCloseHealthView();
        showStudioWorkspace();
        setStudioView('manual');
        renderPlaylist();
        assertRoomRescueStudioOutcome(startingTracks);
        initSortable();
        updateStudioToolsAvailability();
        await recalculateAudit();
        setBriefEditingExisting = false;
        showToast('Your five-song start is ready. Change anything in Studio.');
      } catch (error) {
        showToast(error?.message || 'AXIOM could not open this starting set.', true);
      } finally {
        if (build) {
          build.disabled = false;
          build.innerHTML = 'Build This Start <span aria-hidden="true">&rarr;</span>';
        }
      }
    }

    function renderSetBrief() {
      const brief = normalizeSetBrief(currentSetBrief);
      document.querySelectorAll('[data-brief-group]').forEach(group => {
        const key = group.getAttribute('data-brief-group');
        group.querySelectorAll('[data-brief-value]').forEach(button => {
          button.classList.toggle('active', button.getAttribute('data-brief-value') === brief[key]);
        });
      });
	      const duration = document.getElementById('set-brief-duration');
	      const era = document.getElementById('set-brief-era');
	      const sound = document.getElementById('set-brief-sound');
	      const weddingStyle = document.getElementById('set-brief-wedding-style');
	      if (duration) duration.value = String(brief.duration);
	      if (era) era.value = brief.era;
	      if (sound) sound.value = brief.soundFocus;
	      if (weddingStyle) weddingStyle.classList.toggle('hidden', brief.intention !== 'wedding');
	      const submit = document.getElementById('set-brief-submit');
	      const skip = document.getElementById('set-brief-skip');
      if (submit) submit.textContent = setBriefEditingExisting ? 'Apply To Suggestions' : 'Start Building';
      if (skip) skip.classList.toggle('hidden', setBriefEditingExisting);
      renderStudioSetBriefBar();
      renderLibraryBriefLens();
      scheduleSetBriefProof();
      scheduleCrateRead();
    }

    function scheduleSetBriefProof() {
      clearTimeout(setBriefProofTimer);
      setBriefProofTimer = setTimeout(refreshSetBriefProof, 180);
    }

    function scheduleCrateRead() {
      clearTimeout(window.__axiomCrateReadTimer);
      window.__axiomCrateReadTimer = setTimeout(refreshCrateRead, 240);
    }

    function crateReadProfileById(id) {
      return (latestCrateRead?.profiles || []).find(profile => profile.id === id) || null;
    }

    function renderCrateRead(data = latestCrateRead) {
      const panel = document.getElementById('crate-read-panel');
      if (!panel) return;
      if (!data || data.loading) {
        panel.innerHTML = '<div class="crate-read-loading">Reading what this library can do...</div>';
        return;
      }
      const total = Number(data.total_tracks || data.analyzed_tracks || 0);
      if (!total) {
        panel.innerHTML = `
          <div class="crate-read-empty">
            Connect Serato or a music folder so AXIOM can read what this library can do.
          </div>
        `;
        return;
      }
      const profiles = Array.isArray(data.profiles) ? data.profiles.slice(0, 3) : [];
      const bestId = data.best_profile?.id || profiles[0]?.id || '';
      const profileHtml = profiles.map(profile => {
        const evidence = Array.isArray(profile.top_evidence) ? profile.top_evidence : [];
        return `
          <article class="crate-read-card ${profile.id === bestId ? 'is-best' : ''}">
            <span>${escapeHtml(profile.confidence || 'Possible')}</span>
            <h4>${escapeHtml(profile.title || 'Set Direction')}</h4>
            <p>${escapeHtml(profile.audience || '')}</p>
            <b>${Number(profile.strong_tracks || 0).toLocaleString()} strong · ${Number(profile.possible_tracks || 0).toLocaleString()} usable</b>
            <p>${escapeHtml(profile.summary || profile.reason || '')}</p>
            <ul class="crate-read-evidence">
              ${evidence.map(item => `
                <li>${escapeHtml(item.title || 'Track')} ${item.artist ? `· ${escapeHtml(item.artist)}` : ''}${item.bpm ? ` · ${Number(item.bpm).toLocaleString()} BPM` : ''}</li>
              `).join('') || '<li>AXIOM will use BPM, energy, and role fit for this direction.</li>'}
            </ul>
            <button type="button" class="crate-read-use" onclick="useCrateReadProfile('${escapeJs(profile.id)}')">Use This Direction</button>
          </article>
        `;
      }).join('');
      const gapCopy = Array.isArray(data.gaps) && data.gaps.length
        ? data.gaps.map(item => escapeHtml(item)).join(' · ')
        : 'No major library gaps found in this read.';
      const eraCopy = Array.isArray(data.dominant_eras) && data.dominant_eras.length
        ? data.dominant_eras.map(item => escapeHtml(item)).join(' · ')
        : 'Era spread not clear yet.';
      const genreCopy = Array.isArray(data.dominant_genres) && data.dominant_genres.length
        ? data.dominant_genres.map(item => escapeHtml(item)).join(' · ')
        : 'Genre spread not clear yet.';
      panel.innerHTML = `
        <div class="crate-read-head">
          <div>
            <span>Crate Read</span>
            <h3>AXIOM Read ${total.toLocaleString()} Songs</h3>
            <p>${escapeHtml(data.message || 'AXIOM found the strongest set directions in this library.')}</p>
          </div>
          <div class="crate-read-stat">
            <strong>${escapeHtml(data.bpm_range || '--')}</strong>
            <small>BPM Range</small>
          </div>
          <button type="button" class="crate-read-use" data-native-only="serato-export" onclick="exportNoCuePointCrate()">Export No-Cue Crate</button>
        </div>
        <div class="crate-read-grid">
          ${profileHtml || '<div class="crate-read-empty">No set directions scored yet.</div>'}
        </div>
        <div class="crate-read-foot">
          <div class="crate-read-gap-box">
            <span class="crate-read-gap-title">Library Strength</span>
            ${eraCopy}<br>${genreCopy}
          </div>
          <div class="crate-read-gap-box">
            <span class="crate-read-gap-title">What Could Block The Set</span>
            ${gapCopy}
          </div>
        </div>
      `;
      applyAxiomSurfaceMode();
    }

    async function exportNoCuePointCrate() {
      if (!requireAxiomInstalledApp('No Cue Points crate export')) return;
      if (!(await ensureAxiomLicenseUsable('No Cue Points crate export'))) return;
      const crateName = await showAxiomTextPrompt({
        kicker: 'Serato Prep Crate',
        title: 'Name Your Cue-Point Crate',
        copy: 'AXIOM will group playable tracks with no cue-point proof into this Serato crate.',
        defaultValue: 'AXIOM - Needs Cue Points',
        placeholder: 'Serato crate name...',
        confirmText: 'Build Crate'
      });
      if (!crateName) return;
      showToast('Building cue prep crate. Source audio stays untouched.');
      try {
        const resp = await fetch('/api/library/export_no_cue_points_serato', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: crateName })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.success === false) throw new Error(data.error || data.message || 'Cue prep crate export failed');
        showToast(`Cue prep crate ready: ${Number(data.exported_tracks || data.cue_prep_tracks || 0).toLocaleString()} tracks.`);
        showSeratoExportSuccess(data, crateName);
      } catch (err) {
        showToast(err.message || 'Cue prep crate export failed. Source audio untouched.', true);
      }
    }

    async function refreshCrateRead() {
      const panel = document.getElementById('crate-read-panel');
      if (!panel || document.getElementById('set-brief-view')?.classList.contains('hidden')) return;
      const requestId = ++crateReadRequestId;
      renderCrateRead({ loading: true });
      try {
        const resp = await fetch('/api/studio/crate_read', { method: 'POST' });
        const data = await resp.json().catch(() => ({}));
        if (requestId !== crateReadRequestId) return;
        latestCrateRead = data;
        renderCrateRead(data);
      } catch (err) {
        if (requestId !== crateReadRequestId) return;
        panel.innerHTML = '<div class="crate-read-empty">AXIOM will show the library read after the scan catches up.</div>';
      }
    }

    function useCrateReadProfile(profileId) {
      const profile = crateReadProfileById(profileId);
      if (!profile) {
        showToast('That Crate Read direction is no longer available.', true);
        return;
      }
	      const profileIntention = profile.intention || currentSetBrief.intention;
	      currentSetBrief = normalizeSetBrief({
	        ...setBriefWithIntentionDefaults(currentSetBrief, profileIntention),
	        energyJourney: profile.energyJourney || currentSetBrief.energyJourney,
	        duration: profile.duration || currentSetBrief.duration,
	        era: currentSetBrief.era || 'All',
	        planningStyle: 'guided'
      });
      renderSetBrief();
      showToast(`${profile.title || 'Set direction'} selected. AXIOM will build around that read.`);
    }

    async function refreshSetBriefProof() {
      const copy = document.getElementById('set-brief-proof-copy');
      if (!copy || document.getElementById('set-brief-view')?.classList.contains('hidden')) return;
      const brief = setBriefPayload();
      const requestId = ++setBriefProofRequestId;
      copy.textContent = `Checking ${setBriefLabel('intention', brief.intention).toLowerCase()} evidence across your library...`;
      try {
        const resp = await fetch('/api/studio/brief_readiness', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ set_brief: brief })
        });
        const data = await resp.json();
        if (requestId !== setBriefProofRequestId) return;
        const total = Number(data.library_tracks || 0);
        const strong = Number(data.strong_candidates || 0);
        const high = Number(data.high_confidence_candidates || 0);
        const references = Number(data.public_reference_matches || 0);
        if (!total) {
          copy.textContent = 'Connect a music library to reveal the strongest role matches.';
          return;
        }
        const mission = setBriefLabel('intention', brief.intention).toLowerCase();
	        const context = `${setBriefLabel('audience', brief.audience).toLowerCase()} · ${setBriefLabel('setting', brief.setting).toLowerCase()} · ${setBriefLabel('lyrics', brief.lyrics).toLowerCase()} · ${setBriefLabel('soundFocus', brief.soundFocus).toLowerCase()}`;
        const sample = data.track_limit && total >= Number(data.track_limit) ? `${total.toLocaleString()}-track proof sample` : `${total.toLocaleString()} tracks`;
        const referencePart = brief.intention === 'wedding' && references
          ? ` ${references.toLocaleString()} also match the public wedding reference.`
          : '';
        copy.textContent = strong
          ? `${sample}: ${strong.toLocaleString()} strong ${mission} candidates for ${context}, including ${high.toLocaleString()} high-confidence matches.${referencePart}`
          : `${sample}: no strong ${mission} label evidence for ${context} yet, so AXIOM will lead with energy and transition fit.`;
      } catch (_) {
        if (requestId === setBriefProofRequestId) copy.textContent = 'AXIOM will keep using the brief as a soft direction while the library check catches up.';
      }
    }

    function renderStudioSetBriefBar() {
      const bar = document.getElementById('studio-set-brief-bar');
      const summary = document.getElementById('studio-set-brief-summary');
      if (!bar || !summary) return;
      const brief = normalizeSetBrief(currentSetBrief);
      bar.classList.toggle('hidden', !brief.enabled);
      const eraPart = brief.era === 'All' ? '' : ` · ${setBriefLabel('era', brief.era)}`;
	      const contextPart = ` · ${setBriefLabel('purpose', brief.purpose)} · ${setBriefLabel('audience', brief.audience)} · ${setBriefLabel('setting', brief.setting)} · ${setBriefLabel('lyrics', brief.lyrics)} · ${setBriefLabel('soundFocus', brief.soundFocus)}`;
      summary.textContent = brief.enabled
        ? `${setBriefLabel('intention', brief.intention)} · ${brief.duration} Min · ${setBriefLabel('energyJourney', brief.energyJourney)} · ${setBriefLabel('planningStyle', brief.planningStyle)}${contextPart}${eraPart}`
        : 'No brief selected';
    }

	    function selectSetBriefOption(group, value) {
	      if (group === 'intention') currentSetBrief = setBriefWithIntentionDefaults(currentSetBrief, value);
	      else currentSetBrief = normalizeSetBrief({ ...currentSetBrief, enabled: true, [group]: value });
	      renderSetBrief();
	    }

    function updateSetBriefSelects() {
      const duration = Number(document.getElementById('set-brief-duration')?.value || 60);
      const era = document.getElementById('set-brief-era')?.value || 'All';
      const soundFocus = document.getElementById('set-brief-sound')?.value || currentSetBrief.soundFocus || 'open_format';
      currentSetBrief = normalizeSetBrief({ ...currentSetBrief, enabled: true, duration, era, soundFocus });
      renderSetBrief();
    }

    function applySetBriefToLibraryControls() {
      const brief = normalizeSetBrief(currentSetBrief);
      activeEra = brief.enabled ? brief.era : 'All';
      const libraryEra = document.getElementById('library-era-filter');
      if (libraryEra) libraryEra.value = activeEra;
      activeLibraryBriefLane = 'best';
      resetLibraryResultWindow();
      renderLibraryBriefLens();
    }

    function applySetBriefToStudioControls() {
      const brief = normalizeSetBrief(currentSetBrief);
      const length = document.getElementById('set-length-selector');
      const startBpm = document.getElementById('blueprint-start-bpm');
      const endBpm = document.getElementById('blueprint-end-bpm');
      const folderEra = document.getElementById('folder-build-era');
      const librarySuggestionEra = document.getElementById('lmod-era');
      if (!brief.enabled) {
        if (length) length.value = '120';
        if (startBpm) startBpm.value = '120';
        if (endBpm) endBpm.value = '128';
        if (folderEra) folderEra.value = 'All';
        if (librarySuggestionEra) librarySuggestionEra.value = 'All';
        applySetBriefToLibraryControls();
        if (typeof updateGraphTimeline === 'function') updateGraphTimeline();
        renderStudioSetBriefBar();
        return;
      }
	      const bpmProfiles = {
	        opener: [82, 100],
	        warmup: [88, 108],
	        party: [96, 124],
	        open_format: [96, 128],
	        youtube: [94, 122],
	        club_peak: [122, 132],
	        wedding: [92, 122],
	        family_friendly: [82, 120],
	        global: [92, 126],
	        closing: [108, 126]
	      };
      const [start, baseEnd] = bpmProfiles[brief.intention] || bpmProfiles.party;
      const end = brief.energyJourney === 'stay_up'
        ? Math.max(start, baseEnd)
        : brief.energyJourney === 'finish_strong'
          ? baseEnd + 4
          : baseEnd;
      if (length) length.value = String(brief.duration);
      if (startBpm) startBpm.value = String(start);
      if (endBpm) endBpm.value = String(end);
      if (brief.enabled && folderEra) folderEra.value = brief.era;
      if (brief.enabled && librarySuggestionEra) librarySuggestionEra.value = brief.era;
      applySetBriefToLibraryControls();
      if (typeof updateGraphTimeline === 'function') updateGraphTimeline();
	      renderStudioSetBriefBar();
	    }

    function buildTheNightPreset(mission = 'party') {
      return BUILD_THE_NIGHT_PRESETS[mission] || BUILD_THE_NIGHT_PRESETS.party;
    }

    function loadBuildTheNightMission(mission = 'party') {
      const preset = buildTheNightPreset(mission);
      currentSetBrief = normalizeSetBrief({ ...DEFAULT_SET_BRIEF, ...preset, enabled: true });
      if (typeof activeLibraryBriefLane !== 'undefined') activeLibraryBriefLane = 'best';
      renderStudioSetBriefBar();
      renderLibraryBriefLens();
      return currentSetBrief;
    }

    function toggleMissionChoice(mission) {
      const cards = document.querySelectorAll('#studio-start-view .mission-choice');
      const selected = Array.from(cards).find(card => card.dataset.mission === mission);
      if (!selected) return;
      const expand = !selected.classList.contains('is-expanded');
      cards.forEach(card => {
        const open = card === selected && expand;
        card.classList.toggle('is-expanded', open);
        card.querySelector('.mission-choice-toggle')?.setAttribute('aria-expanded', String(open));
        const details = card.querySelector('.mission-choice-details');
        if (details) details.hidden = !open;
      });
    }

    function handleMissionChoiceKeydown(event, mission) {
      if (event.key === ' ' && event.target.classList.contains('mission-choice-toggle')) {
        event.preventDefault();
        toggleMissionChoice(mission);
        return;
      }
      if (event.key !== 'Escape') return;
      const card = event.currentTarget;
      if (!card.classList.contains('is-expanded')) return;
      event.preventDefault();
      toggleMissionChoice(mission);
      card.querySelector('.mission-choice-toggle')?.focus();
    }

    function startBuildTheNight(mission = 'party') {
      setBriefEditingExisting = false;
      setBriefEditSnapshot = null;
      const brief = loadBuildTheNightMission(mission);
      showToast(`${setBriefLabel('intention', brief.intention)} mission loaded. Opening Library.`);
      beginNewSetFromBrief(false);
    }

    function openSetBrief(editExisting = false) {
      setBriefEditingExisting = Boolean(editExisting);
      setBriefEditSnapshot = setBriefEditingExisting ? setBriefPayload() : null;
      if (!setBriefEditingExisting) {
        currentSetBrief = normalizeSetBrief({ ...DEFAULT_SET_BRIEF, enabled: true });
      }
      document.getElementById('studio-start-view')?.classList.add('hidden');
      document.getElementById('studio-active-view')?.classList.add('hidden');
      document.getElementById('set-brief-view')?.classList.remove('hidden');
      document.getElementById('room-rescue-wizard')?.classList.toggle('hidden', setBriefEditingExisting);
      document.getElementById('set-brief-advanced-editor')?.classList.toggle('hidden', !setBriefEditingExisting);
      const studioTab = document.getElementById('tab-content-studio');
      if (studioTab) studioTab.scrollTop = 0;
      if (setBriefEditingExisting) renderSetBrief();
      else resetRoomRescueWizard();
    }

    function closeSetBrief(discardChanges = true) {
      if (setBriefEditingExisting && discardChanges && setBriefEditSnapshot) {
        currentSetBrief = normalizeSetBrief(setBriefEditSnapshot);
        renderStudioSetBriefBar();
      }
      document.getElementById('set-brief-view')?.classList.add('hidden');
      if (setBriefEditingExisting && currentPlaylist.length) {
        document.getElementById('studio-active-view')?.classList.remove('hidden');
      } else {
        document.getElementById('studio-start-view')?.classList.remove('hidden');
      }
      setBriefEditingExisting = false;
      setBriefEditSnapshot = null;
    }

	    function applySetBrief() {
	      currentSetBrief = normalizeSetBrief({ ...currentSetBrief, enabled: true });
	      if (setBriefEditingExisting && currentPlaylist.length) {
	        beginLibraryFreshBuild('edit-brief');
	        applySetBriefToStudioControls();
	        syncEditingPlaylistIfNeeded();
	        closeSetBrief(false);
        showToast('Set Brief updated. New suggestions will follow this direction.');
        return;
      }
      beginNewSetFromBrief(false);
    }

	    async function beginNewSetFromBrief(skipBrief = false) {
	      if (window.AxiomStudioAutosave?.archiveCurrent() === false) return;
	      if (skipBrief) currentSetBrief = { ...DEFAULT_SET_BRIEF };
	      beginLibraryFreshBuild(skipBrief ? 'blank-set' : 'set-brief');
	      console.log("AXIOM: Session Initialized — Discovery Stream Online");
      editingPlaylistId = null;
      currentPlaylist = [];
      currentRoutePlaylist = [];
      graphDots = [];
      anchorTargetDot = null;
      graphAnchorIndex = -1;
      activeStudioView = 'manual';
      magicSetStudioCtaReady = false;
      resetModalSuggestionDecisions();
      document.getElementById('set-brief-view')?.classList.add('hidden');
      document.getElementById('studio-start-view').classList.add('hidden');
      document.getElementById('studio-active-view').classList.remove('hidden');
      applySetBriefToStudioControls();
      fetch('/api/session/new', { method: 'POST' }).catch(() => {});
      renderPlaylist([]);
      renderMetrics({ metrics: { set_score: 0, bpm_flow: [], energy_curve: [] } });
      initSortable();
      updateStudioToolsAvailability();
      showTab('library');
      showToast(skipBrief ? 'AXIOM ready. Build your sequence.' : `${setBriefLabel('intention', currentSetBrief.intention)} brief ready. Choose the first song.`);
      setBriefEditingExisting = false;
    }

    function startNewSet() {
      setBriefEditingExisting = false;
      setBriefEditSnapshot = null;
      currentSetBrief = normalizeSetBrief({
        ...DEFAULT_SET_BRIEF,
        enabled: true,
        intention: 'party',
        planningStyle: 'guided'
      });
      beginNewSetFromBrief(false);
    }

    let studioStartPathSelection = 'fresh';

    function setStudioStartHero(path = '') {
      const view = document.getElementById('studio-start-view');
      if (!view) return;
      if (path === 'fresh') view.dataset.startHero = path;
      else delete view.dataset.startHero;
    }

    function selectStudioStartPath(path = 'fresh', revealArtwork = false) {
      const roomAvailable = !document.getElementById('studio-path-room')?.classList.contains('hidden');
      const selectedPath = path === 'room' && roomAvailable ? 'room' : 'fresh';
      studioStartPathSelection = selectedPath;
      if (revealArtwork) setStudioStartHero(selectedPath === 'fresh' ? 'fresh' : '');

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

    function handleStudioStartPathKeydown(event, path) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      selectStudioStartPath(path, true);
    }

    function previewStudioStartPath(path = 'fresh') {
      setStudioStartHero(path === 'fresh' ? 'fresh' : '');
    }

    function clearStudioStartPreview() {
      setStudioStartHero(studioStartPathSelection);
    }

    function closeActiveSet() {
      if (window.AxiomStudioAutosave?.archiveCurrent() === false) return;
      editingPlaylistId = null;
      currentPlaylist = [];
      currentRoutePlaylist = [];
      graphDots = [];
      anchorTargetDot = null;
      graphAnchorIndex = -1;
      activeStudioView = 'manual';
      magicSetStudioCtaReady = false;
      currentSetBrief = { ...DEFAULT_SET_BRIEF };
      resetModalSuggestionDecisions();
      window.AxiomStudioAutosave?.checkpoint();
      showAxiomStart({ allowReviewNavigation: true });
    }

    Object.assign(window, {
      ...(typeof triggerCSVUpload === 'function' ? { triggerCSVUpload } : {}),
      ...(typeof handleCSVUpload === 'function' ? { handleCSVUpload } : {}),
      startNewSet,
      ...(typeof showAxiomStart === 'function' ? { showAxiomStart } : {}),
      ...(typeof showStudioWorkspace === 'function' ? { showStudioWorkspace } : {}),
      selectStudioStartPath,
      handleStudioStartPathKeydown,
      previewStudioStartPath,
      clearStudioStartPreview,
      toggleMissionChoice,
      handleMissionChoiceKeydown,
      startBuildTheNight,
      openSetBrief,
      closeSetBrief,
      applySetBrief,
      beginNewSetFromBrief,
      selectRoomRescueGig,
      selectRoomRescueMoment,
      roomRescueBack,
      roomRescueChangeMoment,
      loadRoomRescueTracks,
      buildRoomRescueStart,
      closeActiveSet
    });

    function initSortable() {
      const el = document.getElementById('active-playlist-container');
      if (!el || typeof Sortable === 'undefined') return;
      if (sortableList) sortableList.destroy();
      sortableList = Sortable.create(el, {
        animation: 220,
        handle: '.drag-handle',
        ghostClass: 'studio-sortable-ghost',
        chosenClass: 'studio-sortable-chosen',
        dragClass: 'studio-sortable-drag',
        easing: 'cubic-bezier(.2,.8,.2,1)',
        scroll: true,
        scrollSensitivity: 90,
        scrollSpeed: 14,
        onStart: function (evt) {
          el.classList.add('studio-reorder-active');
          if (!evt.item) return;
          evt.item.dataset.dropPosition = String(Number(evt.oldIndex || 0) + 1);
          evt.item.setAttribute('aria-grabbed', 'true');
        },
        onChange: function (evt) {
          if (!evt.item || !Number.isInteger(evt.newIndex)) return;
          evt.item.dataset.dropPosition = String(evt.newIndex + 1);
        },
        onEnd: function (evt) {
          el.classList.remove('studio-reorder-active');
          evt.item?.setAttribute('aria-grabbed', 'false');
          evt.item?.removeAttribute('data-drop-position');

          if (evt.oldIndex === evt.newIndex) {
            evt.item?.classList.add('studio-reorder-returned');
            window.setTimeout(() => evt.item?.classList.remove('studio-reorder-returned'), 700);
            showToast(`TRACK KEPT AT POSITION ${Number(evt.newIndex || 0) + 1}`);
            return;
          }
          const orderSource = getActiveStudioOrderSource();
          const targetList = orderSource === 'route' ? currentRoutePlaylist : currentPlaylist;
          if (!Array.isArray(targetList) || evt.oldIndex < 0 || evt.oldIndex >= targetList.length) {
            renderPlaylist();
            return;
          }
          saveHistory();
          const itemEl = targetList.splice(evt.oldIndex, 1)[0];
          targetList.splice(evt.newIndex, 0, itemEl);
          if (orderSource === 'route') {
            currentRoutePlaylist = targetList;
            renderPlaylist();
          } else {
            currentPlaylist = targetList;
            syncEditingPlaylistIfNeeded();
            recalculateAudit();
          }
          window.requestAnimationFrame(() => {
            const settledRow = Array.from(el.querySelectorAll('.studio-transition-row'))
              .find(row => row.dataset.path === itemEl?.path) || evt.item;
            settledRow?.classList.add('studio-reorder-settled');
            window.setTimeout(() => settledRow?.classList.remove('studio-reorder-settled'), 900);
          });
          const position = Number(evt.newIndex || 0) + 1;
          showToast(`TRACK MOVED · POSITION ${position} · ${orderSource === 'route' ? 'HARMONIC ROUTE' : 'SET ORDER'} UPDATED`);
        }
      });
    }

    function deleteTrackFromPlaylist(index, event) {
      if (event) event.stopPropagation();
      saveHistory();
      if (getActiveStudioOrderSource() === 'route') {
        currentRoutePlaylist.splice(index, 1);
        renderPlaylist();
      } else {
        currentPlaylist.splice(index, 1);
        syncEditingPlaylistIfNeeded();
        updateStudioToolsAvailability();
        recalculateAudit();
      }
      showToast("Track removed from set");
    }

    let modalSearchTimer = null;
    let modalSearchRequestId = 0;
    let modalSearchAbortController = null;

    function scheduleModalSearch() {
        clearTimeout(modalSearchTimer);
        modalSearchTimer = setTimeout(runModalSearch, 100);
    }

    async function runModalSearch() {
        const requestId = ++modalSearchRequestId;
        if (modalSearchAbortController) modalSearchAbortController.abort();
        modalSearchAbortController = new AbortController();
        const query = document.getElementById('modal-search').value.trim();
        if (!query) {
            fetchSuggestions(false);
            return;
        }
        const listEl = document.getElementById('modal-suggestions-list');
        document.getElementById('modal-spinner').classList.remove('hidden');
        listEl.innerHTML = '';
        try {
            const resp = await fetch(`/api/library/search?q=${encodeURIComponent(query)}&limit=50`, {
              signal: modalSearchAbortController.signal
            });
            const data = await resp.json();
            if (requestId !== modalSearchRequestId) return;
            let items = (data.tracks || data.results || [])
              .map(normalizeModalTrackMetadata)
              .filter(track => !modalSkippedSuggestionPaths.has(track.path) && modalSuggestionIsAllowed(track));
            items = sortModalSuggestions(items);
            window.lastSuggestions = items;
            if (items.length === 0) {
                const usedHint = modalShowUsedTracks ? '' : '<br><span class="text-[10px] text-white/35">Used Studio tracks are hidden. Use Show Used if you want to inspect duplicates.</span>';
                listEl.innerHTML = `<p class="text-axiom-muted font-bold text-center mt-10 text-sm uppercase">No results found for "${query}"${usedHint}</p>`;
                document.getElementById('modal-results-count').innerText = '0 search results';
            } else {
                listEl.innerHTML = items.map((s, i) => {
                    cacheTrackVisual(s);
                    const isPlayed = previewedTracks.has(`${window.location.origin}/api/library/stream?path=${encodeURIComponent(s.path)}`);
                    const rowId = `sugg-${i}`;
                    const btnId = `btn-add-${i}`;
                    const match = modalSuggestionMatch(s);
                    const root = modalRootName(s);
                    const isLocked = modalLockedSuggestions.has(s.path);
                    const tags = [isLocked ? 'Kept' : '', s.axiom_role || '', root, s.genre || '', modalTrackEnergy(s)].filter(Boolean).slice(0, 3);
                    const safePath = escapeJs(s.path);
                    const safeTitle = escapeJs(s.title);
                    const safeArtist = escapeJs(s.artist);
                    const safeCamelot = escapeJs(s.camelot || '');
                    const safeEnergy = escapeJs(s.energy || '');
                    const safeGenre = escapeJs(s.genre || '');
                    const safeYear = escapeJs(s.year || s.release_year || '');
                    return `
                        <div onclick="playAndSelectSuggestion(event, ${i}, '${safePath}', '${safeTitle}', '${safeArtist}', ${s.bpm || 0}, '${safeCamelot}', '${safeEnergy}', '${safeGenre}', '${safeYear}')" id="${rowId}" class="vampire-row anchor-suggestion-row axiom-focus-deck-row ${isPlayed ? 'played' : ''} ${isLocked ? 'locked-suggestion' : ''}" data-path="${escapeHtml(s.path)}" tabindex="0" onkeydown="activateFocusDeckRow(event)">
                            ${renderFocusDeckMarker()}
                            <button onclick="playAndSelectSuggestion(event, ${i}, '${safePath}', '${safeTitle}', '${safeArtist}', ${s.bpm || 0}, '${safeCamelot}', '${safeEnergy}', '${safeGenre}', '${safeYear}')" class="anchor-suggestion-play" type="button" title="Preview suggestion">
                              <svg class="w-3 h-3 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                            </button>
                            ${renderModalArtwork(s, 'anchor-suggestion-art')}
                            <div class="min-w-0">
                              <p class="anchor-suggestion-title">${escapeHtml(s.title || 'Unknown Title')}</p>
                              <p class="anchor-suggestion-artist">${escapeHtml(s.artist || 'Unknown Artist')}</p>
                              <div class="anchor-suggestion-tags">${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
                              ${renderTrackRoleEvidence(s)}
                            </div>
                            <div class="anchor-suggestion-metric anchor-suggestion-bpm">
                              <strong class="cursor-pointer" onclick="event.stopPropagation(); promptSetBpm('${safePath}', ${s.bpm || 0})" aria-label="Click to edit BPM">${s.bpm ? Math.round(parseFloat(s.bpm)) : '--'}</strong>
                              <span>BPM</span>
                              <div class="anchor-suggestion-bpm-tools">
                                ${s.bpm ? `
                                  <button onclick="event.stopPropagation(); adjustBpm('${safePath}', ${s.bpm}, 'half')" title="Halve BPM">Half</button>
                                  <button onclick="event.stopPropagation(); adjustBpm('${safePath}', ${s.bpm}, 'double')" title="Double BPM">Double</button>
                                  <button onclick="event.stopPropagation(); promptSetBpm('${safePath}', ${s.bpm})" title="Edit BPM" style="border-color:rgba(255,255,255,0.3);">Edit</button>
                                ` : `
                                  <button onclick="event.stopPropagation(); promptSetBpm('${safePath}', 0)" title="Set BPM" style="width:100%;border-color:rgba(234,179,8,0.5);color:#EAB308;">Set</button>
                                `}
                              </div>
                            </div>
                            <div class="anchor-suggestion-key"><strong>${escapeHtml(s.camelot || '--')}</strong><span>Key</span></div>
                            <div class="anchor-suggestion-match"><strong>${match.pct}</strong><span>${match.label}</span></div>
                            <button id="${btnId}" onclick="event.stopPropagation(); selectedSuggestionData=normalizeModalTrackMetadata({...(trackVisualCache.get('${safePath}') || {}), path:'${safePath}',title:'${safeTitle}',artist:'${safeArtist}',bpm:${s.bpm || 0},camelot:'${safeCamelot}',energy:'${safeEnergy}',genre:'${safeGenre}',year:'${safeYear}'}); updateLiveTransitionPanel(selectedSuggestionData); executeModalAction('add_after_anchor'); triggerSilverFlash('${btnId}')" class="anchor-suggestion-add" type="button">Add</button>
                            <div class="anchor-decision-actions">
                              <button onclick="toggleModalSuggestionLock(event, '${safePath}')" class="anchor-decision-btn ${isLocked ? 'active' : ''}" type="button" title="${isLocked ? 'Remove from kept matches' : 'Keep through matching-song refreshes'}">${isLocked ? 'Kept' : 'Keep'}</button>
                              <button onclick="skipModalSuggestion(event, '${safePath}')" class="anchor-decision-btn skip" type="button" title="Hide for this set">Hide</button>
                              <button onclick="event.stopPropagation(); toggleFavorite({path:'${safePath}',title:'${safeTitle}',artist:'${safeArtist}',bpm:${s.bpm || 0},camelot:'${safeCamelot}',energy:'${safeEnergy}',genre:'${safeGenre}'})" class="anchor-decision-btn ${favoritesHasTrack(s) ? 'active' : ''}" data-fav-path="${escapeHtml(s.path)}" title="${favoritesHasTrack(s) ? 'Remove from saved songs' : 'Save for later'}" type="button">${favoritesHasTrack(s) ? 'Saved' : 'Save'}</button>
                            </div>
                        </div>
                    `;
                }).join('');
                document.getElementById('modal-results-count').innerText = `${items.length} search result${items.length === 1 ? '' : 's'}`;
                renderModalSuggestionDecisionState();
            }
        } catch (err) {
            if (err?.name === 'AbortError') return;
            showToast("Search failed", true);
        } finally {
            if (requestId === modalSearchRequestId) {
              document.getElementById('modal-spinner').classList.add('hidden');
            }
        }
    }

    let studioAuditRequestId = 0;
    async function recalculateAudit() {
      const requestId = ++studioAuditRequestId;
      const body = JSON.stringify({ playlist: currentPlaylist });
      // Show the current set immediately; disk-backed cue discovery and the
      // refreshed transition score must never delay the visible Add result.
      renderPlaylist();
      syncGraphReadonlyDots();
      try {
        const resp = await fetch('/api/studio/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        if (!resp.ok) throw new Error('Studio audit could not be refreshed');
        const data = await resp.json();
        // Compare the song order, not the whole objects: hydrateStudioTrackVersions() adds available_versions
        // to every track while the audit is in flight, which made the old whole-JSON compare discard every
        // audit result (Set Score stayed "--" and the transition markers never appeared).
        const auditOrder = list => (Array.isArray(list) ? list : []).map(track => String(track?.path || '')).join('\n');
        if (requestId !== studioAuditRequestId || auditOrder(JSON.parse(body).playlist) !== auditOrder(currentPlaylist)) return;
        renderPlaylist(data.transitions);
        renderMetrics(data);
      } catch (error) {
        console.warn('Studio audit refresh failed; the current set is still available.', error);
      }
    }

    function getActiveStudioOrderSource() {
      return activeStudioView === 'route' && Array.isArray(currentRoutePlaylist) && currentRoutePlaylist.length ? 'route' : 'manual';
    }

    function getStudioOrderLabelForSource(source) {
      return source === 'route' ? 'harmonic route order' : 'manual order';
    }

    function getActiveSetList() {
      return getActiveStudioOrderSource() === 'route' ? currentRoutePlaylist : currentPlaylist;
    }

    let studioVersionModalIndex = -1;
    let studioVersionPreviewTimer = null;
    let studioVersionPreview = {
      versionIndex: -1,
      path: '',
      title: '',
      artist: '',
      duration: 0,
      currentTime: 0,
      playing: false,
      fixture: false
    };

    function studioTrackVersions(track = {}) {
      const candidates = Array.isArray(track.available_versions) ? track.available_versions : [];
      const seen = new Set();
      const versions = candidates.filter(version => {
        const identity = String(version?.path || `${version?.artist || ''}|${version?.title || ''}`).trim().toLowerCase();
        if (!identity || seen.has(identity)) return false;
        seen.add(identity);
        return true;
      }).map(version => ({ ...version }));
      const currentIdentity = String(track.path || `${track.artist || ''}|${track.title || ''}`).trim().toLowerCase();
      if (currentIdentity && !seen.has(currentIdentity)) {
        versions.unshift({
          path: track.path || '',
          title: track.title || 'Unknown Song',
          artist: track.artist || 'Unknown Artist',
          bpm: track.bpm || 0,
          camelot: track.camelot || '',
          duration_sec: track.duration_sec || 0,
          genre: track.genre || ''
        });
      }
      return versions;
    }

    function studioTrackHasAlternateVersions(track = {}) {
      const currentPath = String(track.path || '');
      return studioTrackVersions(track).some(version => String(version.path || '') !== currentPath);
    }

    const studioVersionHydratedPaths = new Set();
    let studioVersionHydrationPromise = null;

    async function hydrateStudioTrackVersions() {
      if (studioVersionHydrationPromise) return studioVersionHydrationPromise;
      const requested = [];
      const seen = new Set();
      [...(Array.isArray(currentPlaylist) ? currentPlaylist : []), ...(Array.isArray(currentRoutePlaylist) ? currentRoutePlaylist : [])]
        .forEach(track => {
          const path = String(track?.path || '');
          if (!path || path.startsWith('missing://') || seen.has(path) || studioVersionHydratedPaths.has(path)) return;
          if (Array.isArray(track.available_versions) && track.available_versions.length) {
            studioVersionHydratedPaths.add(path);
            return;
          }
          seen.add(path);
          requested.push({ path, title: track.title || '', artist: track.artist || '' });
        });
      if (!requested.length) return null;

      studioVersionHydrationPromise = (async () => {
        const response = await fetch('/api/library/track-versions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tracks: requested })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.success === false || !Array.isArray(payload.tracks)) {
          throw new Error(payload.error || 'AXIOM could not check alternate song versions.');
        }

        const groups = new Map(payload.tracks.map(item => [String(item?.path || ''), item]));
        let changed = false;
        const hydrateList = list => (Array.isArray(list) ? list : []).forEach(track => {
          const path = String(track?.path || '');
          const group = groups.get(path);
          if (!group) return;
          const versions = Array.isArray(group.versions) ? group.versions.map(version => ({ ...version })) : [];
          track.available_versions = versions;
          track.version_count = versions.length;
          studioVersionHydratedPaths.add(path);
          if (versions.some(version => String(version?.path || '') !== path)) changed = true;
        });
        hydrateList(currentPlaylist);
        hydrateList(currentRoutePlaylist);
        requested.forEach(track => studioVersionHydratedPaths.add(track.path));
        if (changed) renderPlaylist();
        return payload;
      })().catch(error => {
        console.warn('Studio alternate-version lookup failed:', error);
        return null;
      }).finally(() => {
        studioVersionHydrationPromise = null;
      });
      return studioVersionHydrationPromise;
    }

    function studioVersionDurationLabel(seconds) {
      const total = Math.max(0, Math.round(Number(seconds || 0)));
      if (!total) return '';
      return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    }

    function handleStudioVersionBackdrop(event) {
      if (event?.target?.id === 'studio-version-overlay') closeStudioVersionChooser();
    }

    function clearStudioVersionPreviewTimer() {
      if (!studioVersionPreviewTimer) return;
      window.clearInterval(studioVersionPreviewTimer);
      studioVersionPreviewTimer = null;
    }

    function startStudioVersionFixturePreview() {
      clearStudioVersionPreviewTimer();
      studioVersionPreviewTimer = window.setInterval(() => {
        if (!studioVersionPreview.playing || !studioVersionPreview.fixture) return;
        studioVersionPreview.currentTime = Math.min(studioVersionPreview.duration, studioVersionPreview.currentTime + 0.5);
        if (studioVersionPreview.currentTime >= studioVersionPreview.duration) {
          studioVersionPreview.playing = false;
          clearStudioVersionPreviewTimer();
        }
        syncStudioVersionPreviewUi();
      }, 500);
    }

    function renderStudioVersionPreviewDeck() {
      const deck = document.getElementById('studio-version-preview-deck');
      if (!deck) return;
      if (!studioVersionPreview.path) {
        deck.className = 'studio-version-preview-deck is-empty';
        deck.innerHTML = `<img src="/static/icons/audio-waveform.svg" alt="" aria-hidden="true"><div><strong>Quick Preview</strong><span>Preview any edit, then use Previous, Next, or +30 Sec to compare it fast.</span></div>`;
        return;
      }
      const duration = Math.max(0, Number(studioVersionPreview.duration || 0));
      const current = Math.max(0, Number(studioVersionPreview.currentTime || 0));
      const progress = duration ? Math.min(100, (current / duration) * 100) : 0;
      deck.className = `studio-version-preview-deck ${studioVersionPreview.playing ? 'is-playing' : 'is-paused'}`;
      deck.innerHTML = `
        <button type="button" class="studio-version-deck-toggle" aria-label="${studioVersionPreview.playing ? 'Pause version preview' : 'Resume version preview'}" onclick="toggleStudioVersionPreviewDeck()">
          <img src="${studioVersionPreview.playing ? '/static/icons/audio-waveform.svg' : '/static/icons/disc-3.svg'}" alt="" aria-hidden="true">
          <span>${studioVersionPreview.playing ? 'Pause' : 'Play'}</span>
        </button>
        <div class="studio-version-deck-copy"><small>Now Previewing</small><strong>${escapeHtml(studioVersionPreview.title || 'Local Version')}</strong><span>${escapeHtml(studioVersionPreview.artist || 'Unknown Artist')}</span></div>
        <div class="studio-version-deck-timeline"><span>${formatTime(current)}</span><i><b style="width:${progress}%"></b></i><span>${duration ? formatTime(duration) : '--:--'}</span></div>
        <div class="studio-version-deck-actions">
          <button type="button" onclick="stepStudioVersionPreview(-1)">Previous</button>
          <button type="button" onclick="stepStudioVersionPreview(1)">Next</button>
          <button type="button" aria-label="Skip preview forward 30 seconds" title="Skip forward 30 seconds" onclick="skipStudioVersionPreview(30)">+30 Sec</button>
          <button type="button" onclick="stopStudioVersionPreview()">Stop</button>
        </div>`;
    }

    function syncStudioVersionPreviewUi() {
      if (studioVersionPreview.path && !studioVersionPreview.fixture && nativePlayerState.path === studioVersionPreview.path) {
        studioVersionPreview.playing = Boolean(nativePlayerState.playing);
        studioVersionPreview.currentTime = Number(nativePlayerState.current_time || 0);
        studioVersionPreview.duration = Number(nativePlayerState.duration || studioVersionPreview.duration || 0);
      }
      document.querySelectorAll('[data-studio-version-preview-path]').forEach(button => {
        const active = button.dataset.studioVersionPreviewPath === studioVersionPreview.path;
        const playing = active && studioVersionPreview.playing;
        button.classList.toggle('is-active', active);
        button.classList.toggle('is-playing', playing);
        const image = button.querySelector('img');
        const label = button.querySelector('span');
        if (image) image.src = playing ? '/static/icons/audio-waveform.svg' : '/static/icons/disc-3.svg';
        if (label) label.textContent = playing ? 'Pause' : 'Preview';
        button.setAttribute('aria-label', playing ? 'Pause this version preview' : 'Preview this version');
      });
      renderStudioVersionPreviewDeck();
    }

    async function toggleStudioVersionPreview(event, versionIndex) {
      event?.stopPropagation();
      const track = getActiveSetList()[studioVersionModalIndex];
      const version = studioTrackVersions(track)[Number(versionIndex)];
      if (!version?.path) {
        showToast('That version is not available to preview.', true);
        return;
      }
      if (studioVersionPreview.path === version.path) {
        await toggleStudioVersionPreviewDeck();
        return;
      }
      clearStudioVersionPreviewTimer();
      studioVersionPreview = {
        versionIndex: Number(versionIndex),
        path: version.path,
        title: version.title || 'Local Version',
        artist: version.artist || 'Unknown Artist',
        duration: Number(version.duration_sec || 180),
        currentTime: 0,
        playing: true,
        fixture: String(version.path).startsWith('preview://')
      };
      syncStudioVersionPreviewUi();
      if (studioVersionPreview.fixture) {
        startStudioVersionFixturePreview();
        return;
      }
      await playAudioFile(version.path, version.title, version.artist, version.bpm, version.camelot, version.energy, event, version.genre);
      syncStudioVersionPreviewUi();
    }

    async function toggleStudioVersionPreviewDeck() {
      if (!studioVersionPreview.path) return;
      if (studioVersionPreview.fixture) {
        if (!studioVersionPreview.playing && studioVersionPreview.currentTime >= studioVersionPreview.duration) studioVersionPreview.currentTime = 0;
        studioVersionPreview.playing = !studioVersionPreview.playing;
        if (studioVersionPreview.playing) startStudioVersionFixturePreview();
        else clearStudioVersionPreviewTimer();
        syncStudioVersionPreviewUi();
        return;
      }
      try {
        await nativeAudioRequest(studioVersionPreview.playing ? '/api/audio/pause' : '/api/audio/resume');
      } catch (error) {
        showToast(error?.message || 'Preview control failed.', true);
      }
      syncStudioVersionPreviewUi();
    }

    async function stopStudioVersionPreview(reset = true) {
      const previous = { ...studioVersionPreview };
      clearStudioVersionPreviewTimer();
      studioVersionPreview.playing = false;
      if (!previous.fixture && previous.path && nativePlayerState.path === previous.path) {
        nativeAudioRequest('/api/audio/stop').catch(() => {});
      }
      if (reset) {
        studioVersionPreview = { versionIndex: -1, path: '', title: '', artist: '', duration: 0, currentTime: 0, playing: false, fixture: false };
      }
      syncStudioVersionPreviewUi();
    }

    function stepStudioVersionPreview(direction = 1) {
      const track = getActiveSetList()[studioVersionModalIndex];
      const versions = studioTrackVersions(track);
      if (!versions.length) return;
      const current = Math.max(0, Number(studioVersionPreview.versionIndex || 0));
      const next = (current + (direction < 0 ? -1 : 1) + versions.length) % versions.length;
      toggleStudioVersionPreview(null, next);
    }

    async function skipStudioVersionPreview(seconds = 30) {
      if (!studioVersionPreview.path) return;
      const delta = Math.max(0, Number(seconds || 0));
      if (!delta) return;
      if (studioVersionPreview.fixture) {
        studioVersionPreview.currentTime = Math.min(studioVersionPreview.duration, studioVersionPreview.currentTime + delta);
        if (studioVersionPreview.currentTime >= studioVersionPreview.duration) {
          studioVersionPreview.playing = false;
          clearStudioVersionPreviewTimer();
        }
        syncStudioVersionPreviewUi();
        return;
      }
      try {
        await nativeAudioRequest('/api/audio/seek_relative', { delta });
      } catch (error) {
        showToast(error?.message || 'Preview skip failed.', true);
      }
      syncStudioVersionPreviewUi();
    }

    function closeStudioVersionChooser() {
      const overlay = document.getElementById('studio-version-overlay');
      stopStudioVersionPreview();
      overlay?.classList.add('hidden');
      overlay?.setAttribute('aria-hidden', 'true');
      studioVersionModalIndex = -1;
    }

    function openStudioVersionChooser(index) {
      const list = getActiveSetList();
      const track = list[index];
      if (!track || !studioTrackHasAlternateVersions(track)) {
        showToast('No other versions are available for this track.', true);
        return;
      }
      studioVersionModalIndex = index;
      stopStudioVersionPreview();
      const versions = studioTrackVersions(track);
      const currentPath = String(track.path || '');
      const copy = document.getElementById('studio-version-copy');
      const listEl = document.getElementById('studio-version-list');
      const overlay = document.getElementById('studio-version-overlay');
      if (copy) {
        const requested = track.requested_title || track.title || 'this song';
        copy.textContent = `${versions.length} library versions found for ${requested}. Choose the edit for this Studio position.`;
      }
      if (listEl) {
        listEl.innerHTML = versions.map((version, versionIndex) => {
          const current = String(version.path || '') === currentPath;
          const meta = [
            version.bpm ? `${Math.round(Number(version.bpm))} BPM` : '',
            version.camelot || '',
            studioVersionDurationLabel(version.duration_sec),
            version.genre || ''
          ].filter(Boolean).join(' · ');
          return `<article class="studio-version-row${current ? ' is-current' : ''}" role="listitem">
            <div class="studio-version-preview-cell">
              <button type="button" class="studio-version-preview" data-studio-version-preview-path="${escapeHtml(version.path || '')}" aria-label="Preview this version" onclick="toggleStudioVersionPreview(event, ${versionIndex})"><img src="/static/icons/disc-3.svg" alt="" aria-hidden="true"><span>Preview</span></button>
              <span class="studio-version-state">${current ? 'Current Version' : 'Available Version'}</span>
            </div>
            <div class="studio-version-copy">
              <strong>${escapeHtml(version.title || 'Unknown Song')}</strong>
              <span>${escapeHtml(version.artist || 'Unknown Artist')}</span>
              <small>${escapeHtml(meta || 'Library version')}</small>
            </div>
            ${current
              ? '<span class="studio-version-current-label">In Studio</span>'
              : `<button type="button" class="studio-version-use" onclick="applyStudioTrackVersion(${versionIndex})">Use Version</button>`}
          </article>`;
        }).join('');
      }
      syncStudioVersionPreviewUi();
      overlay?.classList.remove('hidden');
      overlay?.setAttribute('aria-hidden', 'false');
      setTimeout(() => listEl?.querySelector('.studio-version-use')?.focus(), 0);
    }

    async function applyStudioTrackVersion(versionIndex) {
      const activeList = getActiveSetList();
      const current = activeList[studioVersionModalIndex];
      if (!current) return;
      const versions = studioTrackVersions(current);
      const nextVersion = versions[versionIndex];
      if (!nextVersion?.path || nextVersion.path === current.path) return;
      const previousPath = current.path;
      const shared = {
        requested_order: current.requested_order,
        requested_title: current.requested_title || '',
        requested_artist: current.requested_artist || '',
        available_versions: versions.map(version => ({ ...version })),
        selected_version_index: versionIndex,
        version_count: versions.length,
        _unlinked: false,
        missing_placeholder: false
      };
      const replacement = { ...nextVersion, ...shared };
      saveHistory();
      const manualIndex = currentPlaylist.findIndex(track => track.path === previousPath);
      if (manualIndex >= 0) currentPlaylist[manualIndex] = replacement;
      if (getActiveStudioOrderSource() === 'route') {
        currentRoutePlaylist[studioVersionModalIndex] = replacement;
      } else if (manualIndex < 0) {
        currentPlaylist[studioVersionModalIndex] = replacement;
      }
      syncEditingPlaylistIfNeeded();
      closeStudioVersionChooser();
      try { await recalculateAudit(); } catch (_) { renderPlaylist(); }
      requestAnimationFrame(() => {
        const container = document.getElementById('active-playlist-container');
        const row = container?.querySelector(`[data-path="${cssEscapeValue(replacement.path)}"]`);
        if (row && container) setFocusDeckSelection(row, container);
      });
      showToast(`Studio version updated to ${replacement.title || 'the selected edit'}.`);
    }

    function studioHasWorkingTracks() {
      return (Array.isArray(currentPlaylist) && currentPlaylist.length > 0)
        || (Array.isArray(currentRoutePlaylist) && currentRoutePlaylist.length > 0);
    }

    const STUDIO_MANUAL_BUILD_MIN_TRACKS = 5;

    function hasManualBuildReady() {
      return Array.isArray(currentPlaylist) && currentPlaylist.length >= STUDIO_MANUAL_BUILD_MIN_TRACKS;
    }

    function updateStudioBuildModeVisibility() {
      const controls = document.getElementById('studio-mode-controls');
      const optimizeBtn = document.getElementById('btn-optimize');
      const ready = hasManualBuildReady();
      controls?.classList.toggle('unlocked', ready);
      optimizeBtn?.classList.toggle('unlocked', ready);
      optimizeBtn?.toggleAttribute('disabled', !ready);
      optimizeBtn?.setAttribute('aria-disabled', ready ? 'false' : 'true');
      if (!ready && activeStudioView === 'route') {
        activeStudioView = 'manual';
      }
    }

    function updateHarmonicRouteVisibility() {
      const routeTab = document.getElementById('studio-tab-route');
      const optimizeBtn = document.getElementById('btn-optimize');
      const hasRoute = Array.isArray(currentRoutePlaylist) && currentRoutePlaylist.length > 0;
      const routeReady = hasRoute && hasManualBuildReady();
      if (!routeReady && activeStudioView === 'route') activeStudioView = 'manual';
      const routeSelected = routeReady && activeStudioView === 'route';
      routeTab?.classList.toggle('route-tab-hidden', !routeSelected);
      optimizeBtn?.classList.toggle('route-created', routeSelected);
      optimizeBtn?.classList.toggle('is-completed', routeSelected);
    }

    function updateStudioToolsAvailability() {
      const trigger = document.getElementById('studio-tools-dropdown-btn');
      // Studio Tools is navigation, not a track-dependent action. Keep the
      // trigger discoverable so the DAW handoff is available even when Studio
      // is empty; each destination owns its own useful empty-state message.
      if (trigger) {
        trigger.classList.remove('hidden');
        trigger.disabled = false;
        trigger.setAttribute('aria-disabled', 'false');
      }
      updateStudioBuildModeVisibility();
      updateHarmonicRouteVisibility();
      updateMagicSetStudioCta();
      const aroundButton = document.getElementById('btn-build-around-tracks');
      if (aroundButton) {
        const seedCount = getActiveStudioOutputTracks().length;
        aroundButton.disabled = seedCount < 1;
        aroundButton.title = seedCount < 1
          ? 'Add at least 1 Working Set track first'
          : `Keep all ${seedCount} tracks and build around their collective sound`;
      }
    }

    function updateMagicSetStudioCta() {
      const btn = document.getElementById('btn-view-studio-set');
      if (!studioHasWorkingTracks()) magicSetStudioCtaReady = false;
      const ready = Boolean(magicSetStudioCtaReady && studioHasWorkingTracks());
      const shouldShow = Boolean(graphModeOpen && ready);
      btn?.classList.toggle('hidden', !shouldShow);
      btn?.classList.toggle('is-ready', shouldShow);

      const exportContainer = document.getElementById('export-dropdown-container');
      const exportButton = document.getElementById('export-dropdown-btn');
      exportContainer?.classList.toggle('magic-set-export-ready', ready);
      exportButton?.classList.toggle('magic-set-export-ready', ready);
      if (exportButton) {
        exportButton.setAttribute('aria-label', ready ? 'Export Magic Set — next step' : 'Export set');
        exportButton.title = ready ? 'Magic Set ready — export it next' : 'Export set';
      }
    }

    function viewMagicSetInStudio() {
      setGraphMode(false);
      activeStudioView = 'manual';
      setStudioView('manual');
      showTab('studio');
      updateStudioToolsAvailability();
      requestAnimationFrame(() => {
        document.getElementById('active-playlist-container')?.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
    window.viewMagicSetInStudio = viewMagicSetInStudio;

    function markMagicSetReady({ clearDraft = false } = {}) {
      if (!studioHasWorkingTracks()) {
        magicSetStudioCtaReady = false;
        updateMagicSetStudioCta();
        return false;
      }
      activeStudioView = 'manual';
      magicSetStudioCtaReady = true;
      if (clearDraft) graphDots = [];
      // Publish the real set as the song-dot layer immediately. The audit is a
      // later enhancement and may never hide a completed Magic Set.
      syncGraphReadonlyDots();
      updateStudioToolsAvailability();
      renderMagicSetJourney();
      return true;
    }

    function normalizePlaylistPathForCompare(path) {
      return String(path || '').trim();
    }

    function getRenderedStudioOutputOrder() {
      const container = document.getElementById('active-playlist-container');
      const rows = Array.from(container?.querySelectorAll('.playlist-row[data-path]') || []);
      if (!rows.length) return { tracks: [], label: '' };

      const rowPaths = rows.map(row => normalizePlaylistPathForCompare(row.dataset.path || row.getAttribute('data-path')));
      const manualList = Array.isArray(currentPlaylist) ? currentPlaylist : [];
      const routeList = Array.isArray(currentRoutePlaylist) ? currentRoutePlaylist : [];

      const scoreList = (list) => rowPaths.reduce((score, rowPath, index) => {
        const exactPath = normalizePlaylistPathForCompare(list[index]?.path);
        if (exactPath && exactPath === rowPath) return score + 2;
        return list.some(track => normalizePlaylistPathForCompare(track?.path) === rowPath) ? score + 1 : score;
      }, 0);

      const manualScore = scoreList(manualList);
      const routeScore = scoreList(routeList);
      let renderedSource = container?.dataset.orderSource;
      if (renderedSource !== 'route' && renderedSource !== 'manual') {
        renderedSource = routeScore > manualScore ? 'route' : 'manual';
      }
      const sourceList = renderedSource === 'route' ? routeList : manualList;
      const fallbackList = renderedSource === 'route' ? manualList : routeList;
      const usedSourceIndices = new Set();
      const usedFallbackIndices = new Set();

      const orderedTracks = rowPaths.map(rowPath => {
        const sourceIndex = sourceList.findIndex((track, index) => {
          return !usedSourceIndices.has(index) && normalizePlaylistPathForCompare(track?.path) === rowPath;
        });
        if (sourceIndex >= 0) {
          usedSourceIndices.add(sourceIndex);
          return sourceList[sourceIndex];
        }

        const fallbackIndex = fallbackList.findIndex((track, index) => {
          return !usedFallbackIndices.has(index) && normalizePlaylistPathForCompare(track?.path) === rowPath;
        });
        if (fallbackIndex >= 0) {
          usedFallbackIndices.add(fallbackIndex);
          return fallbackList[fallbackIndex];
        }

        return null;
      }).filter(Boolean);

      return {
        tracks: orderedTracks,
        label: getStudioOrderLabelForSource(renderedSource)
      };
    }

    function getActiveStudioOutputTracks() {
      const renderedOrder = getRenderedStudioOutputOrder();
      if (renderedOrder.tracks.length) {
        return JSON.parse(JSON.stringify(renderedOrder.tracks));
      }
      const activeTracks = getActiveSetList();
      const sourceTracks = Array.isArray(activeTracks) && activeTracks.length ? activeTracks : currentPlaylist;
      return JSON.parse(JSON.stringify(sourceTracks || []));
    }

    function getActiveStudioOutputLabel() {
      const renderedOrder = getRenderedStudioOutputOrder();
      if (renderedOrder.tracks.length && renderedOrder.label) return renderedOrder.label;
      return getStudioOrderLabelForSource(getActiveStudioOrderSource());
    }

    function getPlaylistOrderSignature(list) {
      return (Array.isArray(list) ? list : [])
        .map(track => normalizePlaylistPathForCompare(track?.path) || `${track?.artist || ''}|${track?.title || ''}`)
        .join('>');
    }

    function hasAlternativeStudioExportOrder() {
      if (!Array.isArray(currentPlaylist) || !Array.isArray(currentRoutePlaylist)) return false;
      if (!currentPlaylist.length || !currentRoutePlaylist.length) return false;
      return getPlaylistOrderSignature(currentPlaylist) !== getPlaylistOrderSignature(currentRoutePlaylist);
    }

    function cloneStudioTracks(list) {
      return JSON.parse(JSON.stringify(Array.isArray(list) ? list : []));
    }

    function chooseSeratoExportOrder() {
      if (!hasAlternativeStudioExportOrder()) {
        return Promise.resolve({
          tracks: getActiveStudioOutputTracks(),
          label: getActiveStudioOutputLabel()
        });
      }

      return new Promise((resolve) => {
        document.getElementById('serato-export-choice-overlay')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'serato-export-choice-overlay';
        overlay.className = 'fixed inset-0 z-[12000] flex items-center justify-center bg-black/85 backdrop-blur-md px-6';
        overlay.innerHTML = `
          <div class="relative w-full max-w-2xl overflow-hidden rounded-[28px] border border-axiom-accent/35 bg-[#070b07] p-7 text-primary-contrast shadow-[0_0_70px_rgba(163,255,0,0.18)]">
            <div class="pointer-events-none absolute inset-0 opacity-70" style="background: radial-gradient(circle at 28% 0%, rgba(163,255,0,0.18), transparent 35%), linear-gradient(135deg, rgba(255,255,255,0.08), transparent 32%, rgba(163,255,0,0.06));"></div>
            <button id="serato-export-choice-close" class="absolute right-5 top-5 z-10 text-xl font-black text-white/50 hover:text-white" type="button">x</button>
            <div class="relative z-10">
              <p class="mb-3 text-[10px] font-black uppercase tracking-[0.35em] text-axiom-accent">Serato Handoff</p>
              <h3 class="text-4xl font-black uppercase tracking-wider text-white">Choose the crate route</h3>
              <p class="mt-3 max-w-xl text-sm font-bold leading-relaxed text-white/65">
                AXIOM has your original setlist and a harmonic route. Choose which version should be built inside Serato. Your source audio stays untouched.
              </p>
              <div class="mt-7 grid gap-4 md:grid-cols-2">
                <button id="serato-export-route-choice" class="group rounded-2xl border border-axiom-accent/55 bg-axiom-accent p-5 text-left text-black shadow-[0_0_35px_rgba(163,255,0,0.24)] transition-all hover:-translate-y-1 hover:shadow-[0_0_55px_rgba(163,255,0,0.38)]" type="button">
                  <span class="block text-[10px] font-black uppercase tracking-[0.3em] opacity-70">Recommended</span>
                  <span class="mt-3 block text-2xl font-black uppercase leading-none">Harmonic Route</span>
                  <span class="mt-3 block text-xs font-black uppercase tracking-widest opacity-80">Harmonic and energy flow</span>
                  <span class="mt-5 block text-sm font-black">${currentRoutePlaylist.length} tracks</span>
                </button>
                <button id="serato-export-manual-choice" class="group rounded-2xl border border-white/15 bg-white/[0.04] p-5 text-left text-white transition-all hover:-translate-y-1 hover:border-white/35 hover:bg-white/[0.08]" type="button">
                  <span class="block text-[10px] font-black uppercase tracking-[0.3em] text-white/45">Original</span>
                  <span class="mt-3 block text-2xl font-black uppercase leading-none">Default Setlist</span>
                  <span class="mt-3 block text-xs font-black uppercase tracking-widest text-white/55">The order you created manually</span>
                  <span class="mt-5 block text-sm font-black text-white/75">${currentPlaylist.length} tracks</span>
                </button>
              </div>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);

        const close = (choice) => {
          overlay.remove();
          if (choice === 'route') {
            resolve({ tracks: cloneStudioTracks(currentRoutePlaylist), label: getStudioOrderLabelForSource('route') });
          } else if (choice === 'manual') {
            resolve({ tracks: cloneStudioTracks(currentPlaylist), label: getStudioOrderLabelForSource('manual') });
          } else {
            resolve(null);
          }
        };

        document.getElementById('serato-export-route-choice')?.addEventListener('click', () => close('route'));
        document.getElementById('serato-export-manual-choice')?.addEventListener('click', () => close('manual'));
        document.getElementById('serato-export-choice-close')?.addEventListener('click', () => close(null));
        overlay.addEventListener('click', (event) => {
          if (event.target === overlay) close(null);
        });
      });
    }

    function setGraphMode(open) {
      graphModeOpen = open;
      const view = document.getElementById('studio-active-view');
      const playlist = document.getElementById('active-playlist-container');
      const graph = document.getElementById('graph-container');
      const magicTab = document.getElementById('studio-tab-magic');
      const manualTab = document.getElementById('studio-tab-manual');
      magicTab?.classList.toggle('active', open);
      magicTab?.setAttribute('aria-pressed', open ? 'true' : 'false');
      manualTab?.setAttribute('aria-pressed', open ? 'false' : (activeStudioView === 'manual' ? 'true' : 'false'));
      if (open) {

        activeStudioView = 'manual';
      }
      document.body.classList.toggle('studio-magic-mode', open);
      view?.classList.toggle('graph-mode', open);
      if (playlist) {
        playlist.classList.remove('hidden');
        playlist.style.display = '';
      }
      if (graph) graph.classList.remove('graph-tucked');
      if (!open) {
        anchorTargetDot = null;
        graphDots = [];
        graphAnchorIndex = -1;
        document.getElementById('btn-generate-from-anchor')?.classList.add('hidden');
      } else {
        syncGraphReadonlyDots();
        setTimeout(() => {
          if (bpmChartInstance) {
            bpmChartInstance.resize();
            recalcBpmYAxis();
          }
        }, 60);
      }
      updateMagicSetStudioCta();
      renderMagicSetJourney();
      renderPlaylist();
    }

    function toggleGraphMode() {
      setGraphMode(!graphModeOpen);
    }

    function openMagicSetWorkspace() {
      if (libraryHasTracks !== true) {
        showConnectMusicView();
        return;
      }
      setGraphMode(false);
      showStudioWorkspace();
      setStudioView('manual');
      setGraphMode(true);
    }

    function syncGraphReadonlyDots() {
      // Song markers belong to the current set, independently of the pending
      // audit. Draft markers and the selected anchor keep their own layers.
      const list = getActiveSetList();
      const avgDur = parseFloat(document.getElementById('avg-duration-selector').value || 2);
      const flow = list.map(track => Number(track.bpm) || 0);
      if (!bpmChartInstance) {
        renderMetrics({ metrics: { bpm_flow: flow } }, { updateScore: false });
      }
      if (bpmChartInstance) {
        bpmChartInstance.data.datasets[0].data = flow.map((bpm, index) => ({ x: index * avgDur, y: bpm }));
        bpmChartInstance.data.datasets[1].data = graphDots;
        bpmChartInstance.data.datasets[2].data = anchorTargetDot ? [anchorTargetDot] : [];
        recalcBpmYAxis();
      }
    }

    function setGraphAnchor(index, event) {
      const list = getActiveSetList();
      const track = list[index];
      if (!track) return;
      graphAnchorIndex = index;
      currentAnchorTrack = track;
      const avgDur = parseFloat(document.getElementById('avg-duration-selector').value || 2);
      anchorTargetDot = { x: index * avgDur, y: parseFloat(track.bpm) || 0 };
      graphDots = [];
      if (bpmChartInstance) {
        bpmChartInstance.data.datasets[1].data = [];
        bpmChartInstance.data.datasets[2].data = [anchorTargetDot];
        recalcBpmYAxis();
      }
      updateAnchorBtnVisibility();
      renderMagicSetSelectedCard();
      renderPlaylist();
      showToast(`Anchor: ${track.title || 'Track'}`);
      if (event) event.stopPropagation();
    }

    function openMagicReplace(index) {
      const list = getActiveSetList();
      if (!list[index]) return;
      graphAnchorIndex = index;
      currentAnchorTrack = list[index];
      renderMagicSetSelectedCard();
      openModal(index);
    }

    async function flipMagicSetFromAnchor(action) {
      if (!(await ensureAxiomLicenseUsable('Magic Set'))) return;
      const list = getActiveSetList();
      if (!Array.isArray(list) || !list.length) {
        showToast('Add tracks before flipping BPM', true);
        return;
      }
      const startIndex = graphAnchorIndex >= 0 ? graphAnchorIndex : 0;
      const factor = action === 'half' ? 0.5 : 2;
      const label = action === 'half' ? 'half-time' : 'double-time';
      const confirmed = await showAxiomConfirm(
        'Flip Magic Set BPM',
        `Update BPM cache from track ${startIndex + 1} onward to ${label}? Source audio stays untouched.`,
        'Flip BPM',
        'primary'
      );
      if (!confirmed) return;

      let updated = 0;
      for (let i = startIndex; i < list.length; i++) {
        const track = list[i];
        const current = parseFloat(track?.bpm);
        if (!track?.path || !Number.isFinite(current) || current <= 0) continue;
        const nextBpm = Math.round(current * factor * 10) / 10;
        try {
          const resp = await fetch('/api/library/update_bpm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: track.path, bpm: nextBpm })
          });
          const data = await resp.json().catch(() => ({}));
          if (resp.ok && data.success !== false) {
            propagateTrackMetadata(track.path, { bpm: nextBpm, energy: data.track?.energy }, data.track || null);
            updated++;
          }
        } catch (err) {
          console.warn('Magic Set BPM flip failed:', err);
        }
      }

      if (graphModeOpen) syncGraphReadonlyDots();
      renderPlaylist();
      renderMagicSetJourney();
      recalculateAudit();
      showToast(updated ? `Updated ${updated} track BPM value${updated === 1 ? '' : 's'} to ${label}` : 'No BPM values were updated', !updated);
    }

    function studioTrackDurationSeconds(track = {}) {
      const seconds = Number(track.duration_sec || 0);
      if (Number.isFinite(seconds) && seconds > 0) return seconds;
      const minutes = Number(track.duration_min || 0);
      if (Number.isFinite(minutes) && minutes > 0) return minutes * 60;
      return 0;
    }

    function formatStudioSetRuntime(totalSeconds = 0) {
      const roundedMinutes = Math.max(0, Math.round(Number(totalSeconds || 0) / 60));
      if (roundedMinutes < 60) return `${roundedMinutes} Min`;
      const hours = Math.floor(roundedMinutes / 60);
      const minutes = roundedMinutes % 60;
      return `${hours}h${minutes ? ` ${String(minutes).padStart(2, '0')}m` : ''}`;
    }

    function updateStudioSetSummary(list = getActiveSetList()) {
      const tracks = Array.isArray(list) ? list : [];
      const knownDurations = tracks.map(studioTrackDurationSeconds).filter(duration => duration > 0);
      const knownTotal = knownDurations.reduce((sum, duration) => sum + duration, 0);
      const fallbackDuration = knownDurations.length ? knownTotal / knownDurations.length : 210;
      const unknownCount = Math.max(0, tracks.length - knownDurations.length);
      const estimatedTotal = knownTotal + (unknownCount * fallbackDuration);
      const countTarget = document.getElementById('studio-set-track-count');
      const runtimeTarget = document.getElementById('studio-set-runtime');
      if (countTarget) countTarget.textContent = String(tracks.length);
      if (runtimeTarget) runtimeTarget.textContent = formatStudioSetRuntime(estimatedTotal);
    }

    // ========== RENDER PLAYLIST WITH DNA BADGES ==========
