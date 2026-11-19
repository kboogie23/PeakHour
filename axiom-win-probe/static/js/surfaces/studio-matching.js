    // Studio Matching Songs anchor, ranking, and modal presentation.
    function studioTrackWithDuration(path, fields = {}) {
        const cached = typeof trackVisualCache !== 'undefined' ? (trackVisualCache.get(path) || {}) : {};
        const merged = { ...cached, ...fields, path };
        const directDuration = Number(merged.durationSec || merged.duration_sec || merged.duration || 0);
        const duration = directDuration > 0 ? directDuration : Number(merged.duration_min || 0) * 60;
        if (Number.isFinite(duration) && duration > 0) {
            merged.durationSec = duration;
            merged.duration_sec = duration;
        }
        return merged;
    }

    function addAfterAnchor(path, title, artist, bpm, camelot, energy, elementId) {
        if (!path) return;
        const nextTrack = studioTrackWithDuration(path, { title, artist, bpm, camelot, energy, genre: (typeof trackVisualCache !== 'undefined' ? trackVisualCache.get(path)?.genre : '') || '' });
        if (window.AxiomDawFinder?.active) {
            return window.AxiomDawFinder.add(nextTrack);
        }
        if (playlistHasTrack(nextTrack)) {
          showToast(`Already in set: ${title}`, true);
          return;
        }
        const wasEmpty = currentPlaylist.length === 0;
        saveHistory();
        let insertIndex = currentPlaylist.length;
        if (currentAnchorTrack) {
            const idx = currentPlaylist.findIndex(t => t.path === currentAnchorTrack.path);
            if (idx !== -1) insertIndex = idx + 1;
        }
        currentPlaylist.splice(insertIndex, 0, nextTrack);
        syncEditingPlaylistIfNeeded();
        activeStudioView = 'manual';
        if (wasEmpty) {
            document.getElementById('studio-start-view').classList.add('hidden');
            document.getElementById('studio-active-view').classList.remove('hidden');
        }
        showTab('studio');
      updateStudioToolsAvailability();
      showToast(`Added ${title} after the Set Starter`);
      showStudioTrackAddedPulse(nextTrack, currentPlaylist.length);
      triggerSilverFlash(elementId);
      recalculateAudit();
    }

    async function addTrackFromLibrary(path, title, artist, bpm, camelot, energy, genre, options = {}) {
      if (!path) return;
      const nextTrack = studioTrackWithDuration(path, { title, artist, bpm, camelot, energy, genre: genre || '' });
      if (!options.forceStudioSet && window.AxiomDawFinder?.active) {
        return window.AxiomDawFinder.add(nextTrack);
      }
      if (playlistHasTrack(nextTrack)) {
        showToast(`Already in set: ${title}`, true);
        return;
      }
      const needsPreparation = Number(bpm || 0) <= 0 || !String(camelot || '').trim();
      if (needsPreparation) {
        const missing = [Number(bpm || 0) <= 0 ? 'BPM' : '', !String(camelot || '').trim() ? 'key' : ''].filter(Boolean).join(' and ');
        const confirmed = await showAxiomConfirm(
          'Prepare This Track',
          `${title || 'This track'} is missing ${missing}. AXIOM can add it to Studio now and run the same trusted Health preparation in the background. Source audio stays untouched.`,
          'PREPARE & ADD',
          'primary',
          'health-all'
        );
        if (!confirmed) return;
      }
      const wasEmpty = currentPlaylist.length === 0;
      saveHistory();
      currentPlaylist.push(nextTrack);
      syncEditingPlaylistIfNeeded();
      activeStudioView = 'manual';
      if (wasEmpty) {
        const row = document.querySelector(`#search-results .vampire-row[data-path="${CSS.escape(path)}"]`);
        row?.classList.add('set-start-shake');
        setTimeout(() => row?.classList.remove('set-start-shake'), 650);
        document.getElementById('studio-start-view').classList.add('hidden');
        document.getElementById('studio-active-view').classList.remove('hidden');
        initSortable();
      }
      showStudioWorkspace();
      updateStudioToolsAvailability();
      showToast(needsPreparation ? `Added: ${title}. Health preparation started.` : `Added: ${title}`);
      showStudioTrackAddedPulse(nextTrack, currentPlaylist.length);
      recalculateAudit();
      if (needsPreparation) startUnifiedHealthScan('', null, [path]);
    }

    function dragTrackFromLibrary(event, encodedTrack) {
      if (!event || !event.dataTransfer || !encodedTrack) return;
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.dropEffect = 'copy';
      if (!String(encodedTrack || '').trim().startsWith('%7B')) {
        const path = String(encodedTrack || '');
        const track = trackVisualCache.get(path) || { path, title: path.split(/[\\/]/).pop() || 'Track' };
        encodedTrack = encodeURIComponent(JSON.stringify({
          path: track.path || path,
          title: track.title || track.filename || 'Track',
          artist: track.artist || 'Unknown Artist',
          bpm: track.bpm || 0,
          camelot: track.camelot || '',
          energy: track.energy || '',
          genre: track.genre || '',
          durationSec: track.durationSec || track.duration_sec || track.duration || (Number(track.duration_min || 0) * 60) || 0,
          duration_sec: track.durationSec || track.duration_sec || track.duration || (Number(track.duration_min || 0) * 60) || 0
        }));
      }
      event.dataTransfer.setData('application/x-axiom-track', encodedTrack);
      event.dataTransfer.setData('text/plain', encodedTrack);
    }

    function allowDropPlaylist(event) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    }

    function dropTrackPlaylist(event) {
      event.preventDefault();
      const encodedTrack = event.dataTransfer?.getData('application/x-axiom-track')
        || event.dataTransfer?.getData('text/plain');
      if (!encodedTrack) return;

      let track;
      try {
        track = JSON.parse(decodeURIComponent(encodedTrack));
      } catch (err) {
        showToast('Could not add dropped track', true);
        return;
      }

      if (!track || !track.path) return;
      track = studioTrackWithDuration(track.path, track);
      if (playlistHasTrack(track)) {
        showToast(`Already in set: ${track.title || 'Track'}`, true);
        return;
      }
      const wasEmpty = currentPlaylist.length === 0;
      saveHistory();
      currentPlaylist.push({
        path: track.path,
        title: track.title || 'Unknown Title',
        artist: track.artist || 'Unknown Artist',
        bpm: track.bpm || 0,
        camelot: track.camelot || '',
        energy: track.energy || '',
        genre: track.genre || '',
        durationSec: track.durationSec || track.duration_sec || track.duration || (Number(track.duration_min || 0) * 60) || 0,
        duration_sec: track.durationSec || track.duration_sec || track.duration || (Number(track.duration_min || 0) * 60) || 0
      });
      syncEditingPlaylistIfNeeded();
      activeStudioView = 'manual';
      if (wasEmpty) {
        document.getElementById('studio-start-view')?.classList.add('hidden');
        document.getElementById('studio-active-view')?.classList.remove('hidden');
        initSortable();
      }
      showTab('studio');
      updateStudioToolsAvailability();
      showToast(`Added: ${track.title || 'Track'}`);
      showStudioTrackAddedPulse(track, currentPlaylist.length);
      recalculateAudit();
    }

    function triggerSilverFlash(id) {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add('momentum-flash');
            setTimeout(() => el.classList.remove('momentum-flash'), 400);
        }
    }


    const MODAL_CUE_COLORS = ['var(--accent)', '#f59e0b', '#3b82f6', '#ff3b30'];
    let modalAnchorCues = [];
    let modalAnchorCueSource = 'fallback';
    let latestSeratoCuePublishState = {};

    function modalCueDefaults(track = {}) {
      const seed = hashString(`${track.path || ''}${track.title || ''}${track.artist || ''}`);
      const offsets = [22, 68, 102, 150].map((v, i) => Math.max(6, v + ((seed >> (i * 2)) % 13)));
      return offsets.map((sec, i) => ({
        label: ['A', 'B', 'C', 'D'][i],
        time_ms: sec * 1000,
        type: i === 0 ? 'Hot Cue' : (i === 3 ? 'Exit Cue' : 'Hot Cue'),
        note: i === 0 ? 'First clean phrase' : (i === 1 ? 'Vocal pickup' : (i === 2 ? 'Blend window' : 'Drop / exit'))
      }));
    }

    function normalizeCueSlots(cues = [], track = {}) {
      const defaults = modalCueDefaults(track);
      const source = Array.isArray(cues) && cues.length ? cues : defaults;
      return [0, 1, 2, 3].map(i => {
        const cue = source[i] || defaults[i];
        return {
          ...cue,
          label: String(cue.label || defaults[i].label || ['A', 'B', 'C', 'D'][i]).replace(/^CUE\s*/i, '').slice(0, 1).toUpperCase() || ['A', 'B', 'C', 'D'][i],
          time_ms: Number.isFinite(Number(cue.time_ms)) ? Number(cue.time_ms) : defaults[i].time_ms,
          type: cue.type || defaults[i].type,
          note: cue.note || defaults[i].note
        };
      });
    }

    function isImportedDjCueSource(source = '') {
      return ['serato', 'djay'].includes(String(source || '').toLowerCase());
    }

    function modalDisplayCueSlots(cues = [], track = {}, source = 'fallback') {
      if (source === 'fallback' || !Array.isArray(cues) || !cues.length) return normalizeCueSlots([], track);
      return cues.slice(0, 4).map((cue, index) => ({
        ...cue,
        label: String(cue.label || `CUE ${index + 1}`).trim() || `CUE ${index + 1}`,
        time_ms: Math.max(0, Number(cue.time_ms) || 0),
        color: /^#[0-9a-f]{6}$/i.test(String(cue.color || '')) ? cue.color : MODAL_CUE_COLORS[index],
        type: cue.type || 'Hot Cue',
        source: source === 'axiom' ? 'axiom' : cue.source,
        source_label: cue.source_label || (source === 'serato' ? 'Serato' : (source === 'djay' ? 'djay Pro' : 'AXIOM'))
      }));
    }

    function axiomCuePayload(cues = [], track = {}) {
      return modalDisplayCueSlots(cues, track, cues.length ? 'axiom' : 'fallback').slice(0, 4).map((cue, index) => ({
        label: String(cue.label || `CUE ${index + 1}`).trim().slice(0, 32) || `CUE ${index + 1}`,
        time_ms: Math.max(0, Math.round(Number(cue.time_ms) || 0)),
        color: /^#[0-9a-f]{6}$/i.test(String(cue.color || '')) ? cue.color : MODAL_CUE_COLORS[index],
        type: cue.type || 'Hot Cue',
        source: 'axiom',
        source_label: 'AXIOM'
      }));
    }

    function updateModalCueHeader() {
      const source = document.getElementById('modal-cue-source');
      const copy = document.getElementById('modal-cue-copy');
      const publish = document.getElementById('modal-cue-publish');
      const imported = isImportedDjCueSource(modalAnchorCueSource);
      if (source) {
        source.textContent = modalAnchorCueSource === 'serato'
          ? 'Serato Cues'
          : (modalAnchorCueSource === 'djay' ? 'djay Pro Cues' : (modalAnchorCueSource === 'axiom' ? 'AXIOM Cues' : 'Suggested Cues'));
      }
      if (copy) {
        copy.classList.toggle('hidden', modalAnchorCueSource === 'axiom');
        copy.textContent = imported ? 'Copy To AXIOM' : 'Save In AXIOM';
        copy.title = imported
          ? 'Create an editable AXIOM copy. The DJ software and music file stay unchanged.'
          : 'Save these four starting cues in AXIOM without changing the music file.';
      }
      if (publish) {
        const path = String(currentAnchorTrack?.path || '');
        const mp3Ready = modalAnchorCueSource === 'axiom' && /\.mp3$/i.test(path);
        const latestPath = String(latestSeratoCuePublishState?.result?.path || '');
        const canRollback = latestSeratoCuePublishState?.status === 'published' && latestPath === path;
        publish.classList.toggle('hidden', !mp3Ready);
        publish.textContent = canRollback ? 'Undo Serato Publish' : 'Publish To Serato';
        publish.onclick = canRollback
          ? () => rollbackSeratoCuePublish(publish)
          : () => previewSeratoCuePublish(publish);
        publish.title = 'Preview a guarded MP3 cue-tag handoff. Existing Serato cues require separate approval.';
      }
    }

    function localDjCuePreviewFixture() {
      const params = new URLSearchParams(window.location.search);
      if (!['127.0.0.1', 'localhost'].includes(window.location.hostname) || !params.get('review')) return null;
      const mode = params.get('cue_preview');
      if (mode === 'axiom') {
        return {
          source: 'axiom',
          cues: [
            { label: 'CLEAN INTRO', time_ms: 28000, color: '#CC0000', source: 'axiom', source_label: 'AXIOM' },
            { label: 'FIRST HOOK', time_ms: 68000, color: '#CC8800', source: 'axiom', source_label: 'AXIOM' },
            { label: 'BIG DROP', time_ms: 112000, color: '#0000CC', source: 'axiom', source_label: 'AXIOM' },
            { label: 'MIX OUT', time_ms: 152000, color: '#CC0088', source: 'axiom', source_label: 'AXIOM' }
          ]
        };
      }
      if (mode !== 'dj') return null;
      return {
        source: 'djay',
        cues: [
          { label: 'INTRO', time_ms: 28000, color: '#CC0000', source: 'djay', source_label: 'djay Pro' },
          { label: 'HOOK', time_ms: 68000, color: '#CC8800', source: 'djay', source_label: 'djay Pro' },
          { label: 'DROP', time_ms: 112000, color: '#0000CC', source: 'djay', source_label: 'djay Pro' },
          { label: 'OUTRO', time_ms: 152000, color: '#CC0088', source: 'djay', source_label: 'djay Pro' }
        ]
      };
    }

    function modalRootName(track = {}) {
      return getRootFromSuggestion(track) || (getGenreBrain(track.genre)?.root) || 'Raw';
    }

    function modalTrackEnergy(track = {}) {
      return track.energy || getGenreBrain(track.genre)?.energy || 'Mid';
    }

    function modalTrackTagHtml(track = {}) {
      const root = modalRootName(track);
      const genre = track.genre || track.dna_genre || '';
      const year = formatTrackYear(track);
      return [root, genre, year && year !== 'Year --' ? year : '']
        .filter(Boolean)
        .slice(0, 3)
        .map(tag => `<span>${escapeHtml(tag)}</span>`)
        .join('');
    }

    function renderModalArtwork(track = {}, className = 'anchor-suggestion-art') {
      const art = getTrackArtwork(track);
      const fallback = `<div class="artwork-fallback" style="${artworkVars(track)}">${getArtworkInitials(track)}</div>`;
      const generatedNight = renderArtworkImageLayer(generatedTrackArtwork(track), 'generated-track-artwork generated-track-artwork-night');
      const generatedDay = renderArtworkImageLayer(generatedTrackArtwork(track, 'day'), 'generated-track-artwork generated-track-artwork-day');
      const image = `${fallback}${generatedNight}${generatedDay}${renderArtworkImageLayer(art)}`;
      return `<div class="${className}" style="${artworkVars(track)}">${image}</div>`;
    }

    function anchorIntentOptions(brief = setBriefPayload()) {
      if (brief.intention === 'party') {
        return [
          ['best', 'Best Fits'],
          ['singalong', 'Singalong'],
          ['dancefloor', 'Dancefloor Ready'],
          ['peak', 'Peak Party']
        ];
      }
      const config = libraryBriefConfig(brief);
      return config.lanes
        .filter(([key]) => key !== 'risks')
        .slice(0, 4);
    }

    function rankModalSuggestionsByIntent(items = [], brief = setBriefPayload()) {
      if (!brief.enabled || !Array.isArray(items) || !items.length) return items;
      const scored = items.map((track) => ({
        track,
        score: Number(libraryBriefScores(track, brief)[modalIntentLane] || 0),
        eligible: libraryBriefEligibility(track, brief).eligible !== false
      }));
      const eligible = scored.filter(item => item.eligible);
      return (eligible.length ? eligible : scored)
        .sort((a, b) => (b.score - a.score) || (modalSuggestionCompatibilityScore(b.track) - modalSuggestionCompatibilityScore(a.track)))
        .map(item => item.track);
    }

    function setModalIntentLane(lane = 'best') {
      const brief = setBriefPayload();
      const options = anchorIntentOptions(brief);
      if (!options.some(([key]) => key === lane)) return;
      modalIntentLane = lane;
      selectedSuggestionData = null;
      updateLiveTransitionPanel(null);
      renderAnchorTransitionBoard(currentAnchorTrack || {});
      resetAndFetchSuggestions();
      const label = options.find(([key]) => key === lane)?.[1] || 'Best Fits';
      showToast(`${setBriefLabel('intention', brief.intention)} journey: ${label}`);
    }

    function renderAnchorTransitionBoard(track = currentAnchorTrack || {}) {
      const board = document.getElementById('modal-anchor-transition-board');
      if (!board) return;
      const anchor = normalizeModalTrackMetadata(track || {});
      const cueSlots = modalDisplayCueSlots(modalAnchorCues, anchor, modalAnchorCueSource);
      const usesDjCues = isImportedDjCueSource(modalAnchorCueSource) && cueSlots.length > 0;
      const usesStoredCues = modalAnchorCueSource !== 'fallback' && cueSlots.length > 0;
      const brief = setBriefPayload();
      const intentOptions = anchorIntentOptions(brief);
      if (!intentOptions.some(([key]) => key === modalIntentLane)) {
        modalIntentLane = intentOptions[0]?.[0] || 'best';
      }
      const journeyName = document.getElementById('modal-journey-name');
      if (journeyName) {
        journeyName.textContent = brief.enabled
          ? `${setBriefLabel('intention', brief.intention)} Set Prep`
          : 'Anchor Journey';
      }
      const sectionLabels = usesStoredCues
        ? cueSlots.map((cue, index) => [cue.label || `CUE ${index + 1}`, cue])
        : [
            ['INTRO', cueSlots[0]],
            ['HOOK', cueSlots[1]],
            ['DROP', cueSlots[2]],
            ['OUTRO', cueSlots[3]]
          ];
      board.innerHTML = `
        <div class="anchor-section-strip ${usesDjCues ? 'has-dj-cues' : ''}" style="--cue-count:${Math.max(1, sectionLabels.length)}">
          ${sectionLabels.map(([label, cue], index) => `
            <div role="button" tabindex="0" class="anchor-section-chip" style="--cue:${escapeHtml(cue.color || MODAL_CUE_COLORS[index])}" onclick="jumpModalCue(${index})" onkeydown="if(event.key === 'Enter' || event.key === ' '){ event.preventDefault(); jumpModalCue(${index}); }" title="Preview ${escapeHtml(label)} at ${cueTimeLabel(cue)}${usesDjCues ? ` from ${escapeHtml(cue.source_label || 'DJ software')}` : ''}">
              <strong>${escapeHtml(label)}</strong>
              <span>${usesDjCues ? `${escapeHtml(cue.source_label || 'DJ software')} · ` : `${escapeHtml(cue.label)} · `}${cueTimeLabel(cue)}</span>
              ${usesDjCues ? '' : `<span class="anchor-cue-actions"><button type="button" class="set-now" onclick="setModalAnchorCue(event, ${index})">Set Now</button>${modalAnchorCueSource === 'axiom' ? `<button type="button" class="rename" onclick="renameModalAnchorCue(event, ${index})">Name</button><button type="button" class="remove" aria-label="Delete ${escapeHtml(label)} cue" title="Delete ${escapeHtml(label)} cue" onclick="deleteModalCue(event, ${index})">×</button>` : ''}</span>`}
            </div>
          `).join('')}
        </div>
        <div class="anchor-intent-shell">
          <span class="anchor-intent-label">Build Toward</span>
          <div class="anchor-intent-grid">
            ${intentOptions.map(([key, label]) => `
              <button type="button" class="anchor-intent-btn ${modalIntentLane === key ? 'active' : ''}" onclick="setModalIntentLane('${escapeJs(key)}')">${escapeHtml(label)}</button>
            `).join('')}
          </div>
        </div>
      `;
      updateModalCueHeader();
    }

    function cueTimeLabel(cue) {
      return fmtTime(cue?.time_ms || 0);
    }

    function updateAnchorHero(track = {}) {
      const merged = normalizeModalTrackMetadata(track.path ? { ...(trackVisualCache.get(track.path) || {}), ...track } : track);
      cacheTrackVisual(merged);
      const titleEl = document.getElementById('modal-anchor-title');
      const artistEl = document.getElementById('modal-anchor-artist');
      if (titleEl) titleEl.innerText = merged.title || 'Unknown Title';
      if (artistEl) artistEl.innerText = merged.artist || 'Unknown Artist';
      const bpm = parseFloat(merged.bpm || 0);
      document.getElementById('modal-anchor-bpm').innerText = bpm ? `${bpm.toFixed(1)} BPM` : '-- BPM';
      document.getElementById('modal-anchor-key').innerText = merged.camelot || '--';
      document.getElementById('modal-anchor-energy').innerText = `${modalTrackEnergy(merged)} Energy`;
      document.getElementById('modal-anchor-tags').innerHTML = modalTrackTagHtml(merged);
      document.getElementById('modal-anchor-artwork').outerHTML = renderModalArtwork(merged, 'anchor-cover-card')
        .replace('<div class="anchor-cover-card"', '<div id="modal-anchor-artwork" class="anchor-cover-card"');
      document.getElementById('modal-anchor-time').innerText = `0:00 / ${formatTrackDuration(merged)}`;
      renderAnchorTransitionBoard(merged, window.lastSuggestions || []);
    }

    let modalAnchorCueRequestId = 0;
    async function loadModalAnchorCues(trackPath) {
      const requestId = ++modalAnchorCueRequestId;
      modalAnchorCues = [];
      modalAnchorCueSource = 'fallback';
      const fixture = localDjCuePreviewFixture();
      if (fixture) {
        modalAnchorCues = fixture.cues;
        modalAnchorCueSource = fixture.source;
        updateAnchorHero(currentAnchorTrack || {});
        renderModalCues();
        return;
      }
      if (!trackPath) {
        renderModalCues();
        return;
      }
      try {
        const resp = await fetch(`/api/cues/get?path=${encodeURIComponent(trackPath)}`);
        if (resp.ok) {
          const data = await resp.json();
          if (requestId !== modalAnchorCueRequestId || currentAnchorTrack?.path !== trackPath) return;
          // A DJ can set an AXIOM cue while the disk read is still pending.
          // Keep that explicit edit rather than replacing it with imported cues.
          if (modalAnchorCueSource === 'axiom') return;
          modalAnchorCues = data.cues || [];
          modalAnchorCueSource = data.cue_source || (modalAnchorCues.length ? 'axiom' : 'fallback');
        }
      } catch (e) {
        console.warn('Failed to load anchor cues', e);
      }
      if (requestId !== modalAnchorCueRequestId || currentAnchorTrack?.path !== trackPath) return;
      updateAnchorHero(currentAnchorTrack || {});
      renderModalCues();
    }

    function modalSuggestionMatch(track = {}) {
      const anchorTrack = normalizeModalTrackMetadata(currentAnchorTrack || {});
      const candidateTrack = normalizeModalTrackMetadata(track || {});
      const anchorBpm = parseFloat(anchorTrack.bpm || 0);
      const bpm = parseFloat(candidateTrack.bpm || 0);
      const diff = anchorBpm && bpm ? Math.abs(anchorBpm - bpm) : 0;
      const keyMatch = anchorTrack.camelot && candidateTrack.camelot && anchorTrack.camelot === candidateTrack.camelot;
      const confidence = keyMatch ? 92 : Math.max(68, 88 - Math.round(diff * 2));
      return {
        pct: `${confidence}%`,
        label: keyMatch ? 'Perfect Match' : (diff <= 3 ? 'Solid Match' : 'Creative Lift'),
        confidence
      };
    }

    function modalSuggestionMatchPercent(track = {}) {
      const match = modalSuggestionMatch(track);
      const pct = parseFloat(String(match.pct || '').replace(/[^\d.-]/g, ''));
      return Number.isFinite(pct) ? pct : 0;
    }

    function modalSuggestionBpmDelta(track = {}) {
      const anchorBpm = parseFloat(currentAnchorTrack?.bpm || 0);
      const bpm = parseFloat(track.bpm || 0);
      return anchorBpm && bpm ? Math.abs(anchorBpm - bpm) : Number.POSITIVE_INFINITY;
    }

    function modalCamelotParts(value) {
      const match = String(normalizeCamelotKey(value) || value || '').trim().match(/^(\d{1,2})([AB])$/i);
      if (!match) return null;
      return { num: parseInt(match[1], 10), letter: match[2].toUpperCase() };
    }

    function modalSuggestionKeyScore(track = {}) {
      const anchor = modalCamelotParts(normalizeModalTrackMetadata(currentAnchorTrack || {}).camelot);
      const candidate = modalCamelotParts(normalizeModalTrackMetadata(track || {}).camelot);
      if (!anchor || !candidate) return 0;
      if (anchor.num === candidate.num && anchor.letter === candidate.letter) return 100;
      if (anchor.num === candidate.num) return 78;
      const rawDiff = Math.abs(anchor.num - candidate.num);
      const wheelDiff = Math.min(rawDiff, 12 - rawDiff);
      if (wheelDiff === 1 && anchor.letter === candidate.letter) return 72;
      if (wheelDiff === 1) return 48;
      if (wheelDiff === 2 && anchor.letter === candidate.letter) return 32;
      return Math.max(0, 24 - wheelDiff * 4);
    }

    function modalSuggestionCompatibilityScore(track = {}) {
      const match = modalSuggestionMatch(track);
      const bpmDelta = modalSuggestionBpmDelta(track);
      const bpmScore = Number.isFinite(bpmDelta) ? Math.max(0, 32 - bpmDelta * 4) : 0;
      const anchorRoot = modalRootName(currentAnchorTrack || {});
      const candidateRoot = modalRootName(track || {});
      const rootBonus = anchorRoot && candidateRoot && anchorRoot === candidateRoot ? 8 : 0;
      return (match.confidence || 0)
        + modalSuggestionMatchPercent(track) * 1.5
        + bpmScore
        + modalSuggestionKeyScore(track) * 0.45
        + rootBonus;
    }

    function modalSuggestionAlpha(track = {}, field = 'title') {
      if (field === 'title') {
        return String(track?.title || track?.name || track?.filename || track?.path || '').trim().toLocaleLowerCase();
      }
      if (field === 'artist') {
        return String(track?.artist || track?.album_artist || track?.albumArtist || '').trim().toLocaleLowerCase();
      }
      return String(track?.[field] || '').trim().toLocaleLowerCase();
    }

    function sortModalSuggestions(items = []) {
      const list = Array.isArray(items) ? [...items] : [];
      const mode = modalSuggestionSort || 'transition';
      if (mode === 'transition') return list;
      return list.sort((a, b) => {
        if (mode === 'compatibility') {
          const compatibilityDiff = modalSuggestionCompatibilityScore(b) - modalSuggestionCompatibilityScore(a);
          if (compatibilityDiff) return compatibilityDiff;
          const bpmDiff = modalSuggestionBpmDelta(a) - modalSuggestionBpmDelta(b);
          if (bpmDiff) return bpmDiff;
          return modalSuggestionAlpha(a).localeCompare(modalSuggestionAlpha(b));
        }
        if (mode === 'match') {
          const percentDiff = modalSuggestionMatchPercent(b) - modalSuggestionMatchPercent(a);
          if (percentDiff) return percentDiff;
          const confidenceDiff = (modalSuggestionMatch(b).confidence || 0) - (modalSuggestionMatch(a).confidence || 0);
          if (confidenceDiff) return confidenceDiff;
          return modalSuggestionBpmDelta(a) - modalSuggestionBpmDelta(b);
        }
        if (mode === 'bpm') {
          const bpmDiff = modalSuggestionBpmDelta(a) - modalSuggestionBpmDelta(b);
          if (bpmDiff) return bpmDiff;
          return modalSuggestionCompatibilityScore(b) - modalSuggestionCompatibilityScore(a);
        }
        if (mode === 'key') {
          const keyDiff = modalSuggestionKeyScore(b) - modalSuggestionKeyScore(a);
          if (keyDiff) return keyDiff;
          const bpmDiff = modalSuggestionBpmDelta(a) - modalSuggestionBpmDelta(b);
          if (bpmDiff) return bpmDiff;
          return modalSuggestionCompatibilityScore(b) - modalSuggestionCompatibilityScore(a);
        }
        if (mode === 'artist') {
          const artistDiff = modalSuggestionAlpha(a, 'artist').localeCompare(modalSuggestionAlpha(b, 'artist'));
          if (artistDiff) return artistDiff;
          return modalSuggestionAlpha(a).localeCompare(modalSuggestionAlpha(b));
        }
        if (mode === 'title') {
          const titleDiff = modalSuggestionAlpha(a).localeCompare(modalSuggestionAlpha(b));
          if (titleDiff) return titleDiff;
          return modalSuggestionAlpha(a, 'artist').localeCompare(modalSuggestionAlpha(b, 'artist'));
        }
        return 0;
      });
    }

    function setModalSuggestionSort(value) {
      modalSuggestionSort = value || 'transition';
      const sortEl = document.getElementById('modal-suggestion-sort');
      if (sortEl && sortEl.value !== modalSuggestionSort) sortEl.value = modalSuggestionSort;
      const searchEl = document.getElementById('modal-search');
      if (searchEl && searchEl.value.trim()) {
        runModalSearch();
        return;
      }
      resetAndFetchSuggestions();
    }

    function softlyRotateModalSuggestions(items = [], step = 0) {
      const ordered = [...items];
      const windowSize = Math.min(5, ordered.length);
      if (step <= 0 || windowSize < 2) return ordered;
      const shift = ((step - 1) % (windowSize - 1)) + 1;
      const topWindow = ordered.slice(0, windowSize);
      return [
        ...topWindow.slice(shift),
        ...topWindow.slice(0, shift),
        ...ordered.slice(windowSize)
      ];
    }

    function modalSuggestionForPath(path) {
      const key = String(path || '');
      return (window.lastSuggestions || []).find(track => String(track.path || '') === key)
        || trackVisualCache.get(key)
        || null;
    }

    function renderModalSuggestionDecisionState() {
      const summary = document.getElementById('modal-decision-summary');
      const clear = document.getElementById('modal-clear-decisions');
      const usedToggle = document.getElementById('modal-show-used-toggle');
      const locked = modalLockedSuggestions.size;
      const skipped = modalSkippedSuggestionPaths.size;
      if (summary) summary.textContent = `${locked} Kept · ${skipped} Hidden`;
      if (clear) clear.classList.toggle('hidden', locked + skipped === 0);
      if (usedToggle) {
        usedToggle.classList.toggle('active', modalShowUsedTracks);
        usedToggle.textContent = modalShowUsedTracks ? 'Hide Used' : 'Show Used';
        usedToggle.title = modalShowUsedTracks
          ? 'Hide tracks that are already in Studio'
          : 'Used tracks are hidden from Matching Songs';
      }
    }

    function modalSuggestionIsAllowed(track = {}) {
      return modalShowUsedTracks || !playlistHasTrack(track);
    }

    function toggleModalShowUsedTracks() {
      modalShowUsedTracks = !modalShowUsedTracks;
      renderModalSuggestionDecisionState();
      resetAndFetchSuggestions();
    }

    function resetModalSuggestionDecisions() {
      modalLockedSuggestions.clear();
      modalSkippedSuggestionPaths.clear();
      modalSuggestionRotationStep = 0;
      renderModalSuggestionDecisionState();
    }

    function currentLockedModalSuggestions() {
      return [...modalLockedSuggestions.values()]
        .map(normalizeModalTrackMetadata)
        .filter(track => track?.path && !modalSkippedSuggestionPaths.has(track.path) && modalSuggestionIsAllowed(track));
    }

    function toggleModalSuggestionLock(event, path) {
      if (event) event.stopPropagation();
      const key = String(path || '');
      if (!key) return;
      if (modalLockedSuggestions.has(key)) {
        modalLockedSuggestions.delete(key);
        showToast('Song removed from Keep.');
      } else {
        const track = modalSuggestionForPath(key);
        if (!track) return;
        modalSkippedSuggestionPaths.delete(key);
        modalLockedSuggestions.set(key, normalizeModalTrackMetadata(track));
        showToast(`Kept: ${track.title || 'Matching song'}`);
      }
      renderModalSuggestionDecisionState();
      fetchSuggestions(false, { selectFirst: false, preserveScroll: true });
    }

    function skipModalSuggestion(event, path) {
      if (event) event.stopPropagation();
      const key = String(path || '');
      if (!key) return;
      const track = modalSuggestionForPath(key);
      modalLockedSuggestions.delete(key);
      modalSkippedSuggestionPaths.add(key);
      if (selectedSuggestionData?.path === key) {
        selectedSuggestionData = null;
        updateLiveTransitionPanel(null);
      }
      if (nativePlayerState.deck === 'modal' && nativePlayerState.path === key) {
        nativeAudioRequest('/api/audio/stop').catch(() => {});
      }
      modalSuggestionRotationStep += 1;
      renderModalSuggestionDecisionState();
      fetchSuggestions(false, {
        selectFirst: false,
        softRotate: modalSuggestionRotationStep,
        preserveScroll: true
      });
      showToast(`Hidden for this set: ${track?.title || 'Matching song'}`);
    }

    function rotateModalSuggestions() {
      modalSuggestionRotationStep += 1;
      selectedSuggestionData = null;
      updateLiveTransitionPanel(null);
      fetchSuggestions(false, {
        selectFirst: false,
        softRotate: modalSuggestionRotationStep,
        preserveScroll: true
      });
      showToast('New matching songs shown. Kept songs stayed in place.');
    }

    function clearModalSuggestionDecisions() {
      resetModalSuggestionDecisions();
      selectedSuggestionData = null;
      updateLiveTransitionPanel(null);
      fetchSuggestions(false, { selectFirst: false });
      showToast('Matching-song choices cleared.');
    }

    function updateLiveTransitionPanel(track = selectedSuggestionData) {
      const content = document.getElementById('modal-transition-content');
      if (!content) return;
      const saveForLaterButton = document.getElementById('modal-save-for-later-btn');
      if (saveForLaterButton) {
        const isSaved = Boolean(track?.path && favoritesHasTrack(track));
        saveForLaterButton.textContent = isSaved ? 'Saved For Later' : 'Save For Later';
        saveForLaterButton.classList.toggle('active', isSaved);
      }
      const transitionTitle = document.getElementById('modal-transition-title');
      if (transitionTitle) {
        transitionTitle.textContent = '';
        transitionTitle.hidden = true;
        transitionTitle.setAttribute('aria-hidden', 'true');
      }
      if (!track) {
        content.innerHTML = `
          <div class="transition-intel-stage">
            <div class="transition-perspective-grid"></div>
            <div class="transition-sync-line"></div>
            <div class="transition-stage-score">--<span>compatibility</span></div>
            <div class="transition-now-playing">
              <p class="transition-now-kicker">Preview Target</p>
              <strong class="transition-now-title">Select a suggestion</strong>
              <span class="transition-now-artist">Live transition will focus here</span>
            </div>
            <div class="transition-stage-metrics">
              <div class="transition-stage-metric"><span>BPM Sync</span><strong>Waiting</strong></div>
              <div class="transition-stage-metric"><span>Key Route</span><strong>Select Track</strong></div>
              <div class="transition-stage-metric"><span>Energy</span><strong>Ready</strong></div>
            </div>
          </div>
          <div class="mix-advice-card">
            <div>
              <p>Transition Intelligence</p>
              <strong class="transition-intelligence-prompt">Select a suggestion to inspect mix timing.</strong>
              <div class="text-white/50 text-xs mt-2">AXIOM will show BPM, key, energy, and cue timing here.</div>
            </div>
            <div class="confidence-ring" style="--pct:0%">--</div>
          </div>
        `;
        document.getElementById('modal-insight-copy').innerText = 'Choose a suggestion to inspect cue timing and transition feel.';
        return;
      }

      const anchor = normalizeModalTrackMetadata(currentAnchorTrack || {});
      track = normalizeModalTrackMetadata(track || {});
      const suggestionSlots = modalDisplayCueSlots(modalCues, track, modalCueSource);
      const match = modalSuggestionMatch(track);
      const bestStart = suggestionSlots[1] || suggestionSlots[0];
      const bestEnd = suggestionSlots[2] || suggestionSlots[1] || bestStart;
      const anchorBpm = parseFloat(anchor.bpm || 0);
      const trackBpm = parseFloat(track.bpm || 0);
      const bpmDelta = anchorBpm && trackBpm ? Math.abs(anchorBpm - trackBpm) : 0;
      const bpmCopy = anchorBpm && trackBpm ? `${trackBpm.toFixed(1)} BPM / Δ ${bpmDelta.toFixed(1)}` : '--';
      const harmonicCopy = `${anchor.camelot || '--'} → ${track.camelot || '--'}`;
      const energyCopy = `${modalTrackEnergy(anchor)} → ${modalTrackEnergy(track)}`;
      const stageStyle = `--compat:${match.confidence}%;`;
      const modalAudio = document.getElementById('modal-player');
      const targetKicker = modalAudio && !modalAudio.paused ? 'Now Playing' : 'Preview Target';
      const targetTitle = track.title || track.filename || 'Selected Track';
      const targetArtist = track.artist || 'Unknown Artist';
      content.innerHTML = `
        <div class="transition-intel-stage" style="${stageStyle}">
          <div class="transition-perspective-grid"></div>
          <div class="transition-sync-line"></div>
          <div class="transition-stage-score">${match.confidence}<span>compatibility</span></div>
          <div class="transition-now-playing">
            <p class="transition-now-kicker">${escapeHtml(targetKicker)}</p>
            <strong class="transition-now-title" title="${escapeHtml(targetTitle)}">${escapeHtml(targetTitle)}</strong>
            <span class="transition-now-artist">${escapeHtml(targetArtist)}</span>
          </div>
          <div class="transition-stage-metrics">
            <div class="transition-stage-metric"><span>BPM Sync</span><strong>${escapeHtml(bpmCopy)}</strong></div>
            <div class="transition-stage-metric"><span>Key Route</span><strong>${escapeHtml(harmonicCopy)}</strong></div>
            <div class="transition-stage-metric"><span>Energy</span><strong>${escapeHtml(energyCopy)}</strong></div>
          </div>
        </div>
        <div class="transition-metrics-grid">
          <div class="transition-metric-card is-confidence">
            <span>Compatibility</span>
            <strong>${match.confidence}%</strong>
          </div>
          <div class="transition-metric-card">
            <span>BPM Sync</span>
            <strong>${escapeHtml(bpmCopy)}</strong>
          </div>
          <div class="transition-metric-card">
            <span>Key Route</span>
            <strong>${escapeHtml(harmonicCopy)}</strong>
          </div>
          <div class="transition-metric-card">
            <span>Energy</span>
            <strong>${escapeHtml(energyCopy)}</strong>
          </div>
        </div>
        <div class="mix-advice-card" style="--pct:${match.confidence}%">
          <div>
            <p>Recommended Mix</p>
            <strong>Best window: ${cueTimeLabel(bestStart)} → ${cueTimeLabel(bestEnd)}</strong>
            <div class="text-white/50 text-xs mt-2">Technique: ${match.label}. Keep phrase alignment tight and introduce low EQ first.</div>
          </div>
          <div class="confidence-ring">${match.confidence}%</div>
        </div>
      `;
      document.getElementById('modal-insight-copy').innerText =
        `${match.label}. ${track.camelot || '--'} into ${anchor.camelot || '--'} with ${track.bpm ? parseFloat(track.bpm).toFixed(1) : '--'} BPM gives a clean live transition target.`;
    }
