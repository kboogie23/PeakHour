    // Performance session controls, receipts, rendering, and recommendations.
    let performanceYearPrepAcknowledged=false,performanceYearPrepLoading=false;
    async function performanceCheckYearPrep() {
      if(performanceYearPrepAcknowledged||performanceYearPrepLoading)return;
      performanceYearPrepLoading=true;
      try{
        const response=await fetch('/api/library/stats');
        if(!response.ok)return;
        const stats=await response.json();
        if(performanceYearPrepAcknowledged||window.axiomVisibleTab!=='performance')return;
        const panel=document.getElementById('performance-year-prep');
        if(!panel)return;
        panel.hidden=!stats.year_review_recommended;
        panel.classList.toggle('hidden',panel.hidden);
        if(!panel.hidden)document.getElementById('performance-year-prep-copy').textContent=
          `${Number(stats.year_review_tracks||0).toLocaleString()} songs have years to review. Fix them in Health; corrections stay in AXIOM for future sessions.`;
      }catch(_error){/* A preparation reminder must never interrupt a performance. */}
      finally{performanceYearPrepLoading=false;}
    }
    function performanceContinueYearPrep() {
      performanceYearPrepAcknowledged=true;
      const panel=document.getElementById('performance-year-prep');
      if(panel){panel.hidden=true;panel.classList.add('hidden');}
    }
    function performanceOpenYearPrep() {
      showTab('health');setHealthWorkspaceGroupActive('era');
    }

    function performanceClearRefines() {
      performanceRememberRefineState('clear');
      performanceHiddenPaths.clear();
      performanceRejectedGenres.clear();
      performanceRejectedRoots.clear();
      performancePreferredGenres.clear();
      performancePreferredRoots.clear();
      performancePreferredEras.clear();
      performanceEnergyIntent = '';
      performanceTempoIntent = '';
      performanceLaneLock = '';
      performanceRescueMode = false;
      performanceSafePicks = false;
      performanceCleanOnly = false;
      performanceDigDeeper = false;
      performanceArtistCooldown = true;
      performanceExcludeKinds.clear();
      performanceMinYear = 0;
      performanceYearMode = "";
      performanceAssistPreferences = {};
      renderPerformanceRefines();
      performanceFetchSuggestions();
    }

    function performanceResetSession() {
      fetch('/api/performance/coach', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'end'})}).catch(()=>{});
      closePerformanceSessionReceipt();
      performanceSessionStartedAt = Date.now();
      // A freshly reloaded main window may not have read the server's current
      // session yet. An explicit reset must still create a newer session.
      performanceSessionVersion = Math.max(performanceSessionVersion + 1, performanceSessionStartedAt);
      ++performanceSuggestionRequestId;
      performanceSuggestionAbortController?.abort();
      performanceSuggestionAbortController = null;
      performanceAnchorTrack = null;
      performanceCuedTrack = null;
      performanceSuggestions = [];
      performanceTimeline = [];
      performanceNotes = [];
      performanceRefineHistory = [];
      performanceHiddenPaths.clear();
      performanceRejectedFamilies.clear();
      performanceSessionPlayedFamilies.clear();
      performanceRejectedGenres.clear();
      performanceRejectedRoots.clear();
      performancePreferredGenres.clear();
      performancePreferredRoots.clear();
      performancePreferredEras.clear();
      performanceSelectedSuggestionPath = '';
      performanceSeratoLastKey = '';
      performanceLiveTrackIdentityKey = '';
      performanceLiveTrackLoadMarker = '';
      performanceLiveTrackRenderSignature = '';
      performanceSeratoNextPollAt = 0;
      performanceSeratoLastTrack = null;
      performanceLiveTrackStartedAt = 0;
      performanceLiveTrackQualifiedKey = '';
      performanceFeedbackCounts = {
        choices: 0,
        liked: 0,
        hidden: 0,
        tooOld: 0,
        wrongGenre: 0,
        energyUp: 0,
        energyDown: 0,
        doubleTime: 0,
        halfTime: 0,
        laneLock: 0,
        rescue: 0,
        excludes: 0,
        notes: 0
      };
      performanceEnergyIntent = '';
      performanceTempoIntent = '';
      performancePlayingBpmOverride = 0;
      performancePlayingBpmDraft = '';
      performanceLiveAssistTargetBpmVersion = 0;
      performanceTempoResetVersion += 1;
      const targetInput = document.getElementById('performance-playing-bpm-input');
      if (targetInput) targetInput.value = '';
      performanceLaneLock = '';
      performanceRescueMode = false;
      performanceSafePicks = false;
      performanceCleanOnly = false;
      performanceDigDeeper = false;
      performanceArtistCooldown = true;
      performanceExcludeKinds.clear();
      performanceMinYear = 0;
      performanceYearMode = "";
      performanceAssistPreferences = {};
      performanceGigProfileOnlySelected = false;
      performanceTimelineCollapsed = true;
      const auditToggle = document.getElementById('performance-audit-open');
      if (auditToggle) auditToggle.checked = false;
      const notesToggle = document.getElementById('performance-notes-open');
      if (notesToggle) notesToggle.checked = false;
      renderPerformanceMode();
      syncPerformanceLiveAssistState(0).catch(() => {});
      showToast('Performance session reset.');
    }

    function performanceToggleTimeline() {
      performanceTimelineCollapsed = !performanceTimelineCollapsed;
      renderPerformanceTimeline();
    }

    function performanceToggleAudit() {
      const input = document.getElementById('performance-audit-open');
      if (input) input.checked = !input.checked;
      renderPerformanceAudit();
    }

    function performanceNoteLabel(kind = 'note') {
      return {
        loved: 'Crowd Loved',
        dip: 'Energy Dip',
        request: 'Request',
        fix: 'Fix Metadata',
        note: 'Note'
      }[kind] || 'Note';
    }

    function performanceAddNote(kind = 'note', text = '') {
      const input = document.getElementById('performance-note-input');
      const typed = String(text || input?.value || '').trim();
      const anchor = normalizeModalTrackMetadata(performanceAnchorTrack || {});
      const label = performanceNoteLabel(kind);
      const body = typed || label;
      performanceNotes.unshift({
        id: `note-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        kind,
        label,
        text: body,
        track_title: anchor.title || '',
        track_artist: anchor.artist || '',
        track_path: anchor.path || '',
        track_bpm: anchor.bpm || anchor.serato_bpm || '',
        timeline_count: performanceTimeline.length,
        created_at: new Date().toISOString()
      });
      if (input) input.value = '';
      performanceFeedbackCounts.notes += 1;
      renderPerformanceNotes();
      renderPerformanceAudit();
      renderPerformanceRefines();
      showToast(`${label}: ${anchor.title || body}`);
    }

    function performanceAddTypedNote() {
      const input = document.getElementById('performance-note-input');
      const value = String(input?.value || '').trim();
      if (!value) {
        showToast('Type a note first.', true);
        return;
      }
      performanceAddNote('note', value);
    }

    function performanceBindPanelToggles() {
      [
        ['performance-save-session', performanceSaveSession],
        ['performance-send-studio', performanceSendToStudio],
        ['performance-timeline-toggle', performanceToggleTimeline]
      ].forEach(([id, handler]) => {
        const button = document.getElementById(id);
        if (!button || button.dataset.performanceBound === '1') return;
        button.removeAttribute('onclick');
        button.addEventListener('click', (event) => {
          event.preventDefault();
          handler();
        });
        button.dataset.performanceBound = '1';
      });
      const auditToggle = document.getElementById('performance-audit-open');
      if (auditToggle && auditToggle.dataset.performanceBound !== '1') {
        auditToggle.addEventListener('change', renderPerformanceAudit);
        auditToggle.dataset.performanceBound = '1';
      }
      const notesToggle = document.getElementById('performance-notes-open');
      if (notesToggle && notesToggle.dataset.performanceBound !== '1') {
        notesToggle.addEventListener('change', renderPerformanceNotes);
        notesToggle.dataset.performanceBound = '1';
      }
      [
        ['performance-note-loved', () => performanceAddNote('loved')],
        ['performance-note-dip', () => performanceAddNote('dip')],
        ['performance-note-request', () => performanceAddNote('request')],
        ['performance-note-fix', () => performanceAddNote('fix')],
        ['performance-note-add', performanceAddTypedNote]
      ].forEach(([id, handler]) => {
        const button = document.getElementById(id);
        if (!button || button.dataset.performanceBound === '1') return;
        button.addEventListener('click', (event) => {
          event.preventDefault();
          handler();
        });
        button.dataset.performanceBound = '1';
      });
      const noteInput = document.getElementById('performance-note-input');
      if (noteInput && noteInput.dataset.performanceBound !== '1') {
        noteInput.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            performanceAddTypedNote();
          }
        });
        noteInput.dataset.performanceBound = '1';
      }
      ['urban', 'rnb', 'singalong', 'peak'].forEach(lane => {
        const button = document.getElementById(`performance-lock-${lane}`);
        if (!button || button.dataset.performanceBound === '1') return;
        button.removeAttribute('onclick');
        button.addEventListener('click', (event) => {
          event.preventDefault();
          performanceSetLaneLock(lane);
        });
        button.dataset.performanceBound = '1';
      });
      const safePicksButton = document.getElementById('performance-safe-picks');
      if (safePicksButton && safePicksButton.dataset.performanceBound !== '1') {
        safePicksButton.removeAttribute('onclick');
        safePicksButton.addEventListener('click', (event) => {
          event.preventDefault();
          performanceToggleSafePicks();
        });
        safePicksButton.dataset.performanceBound = '1';
      }
      const cleanOnlyButton = document.getElementById('performance-clean-only');
      if (cleanOnlyButton && cleanOnlyButton.dataset.performanceBound !== '1') {
        cleanOnlyButton.removeAttribute('onclick');
        cleanOnlyButton.addEventListener('click', (event) => {
          event.preventDefault();
          performanceToggleCleanOnly();
        });
        cleanOnlyButton.dataset.performanceBound = '1';
      }
      const rescueModeButton = document.getElementById('performance-rescue-mode');
      if (rescueModeButton && rescueModeButton.dataset.performanceBound !== '1') {
        rescueModeButton.removeAttribute('onclick');
        rescueModeButton.addEventListener('click', (event) => {
          event.preventDefault();
          performanceToggleRescueMode();
        });
        rescueModeButton.dataset.performanceBound = '1';
      }
      const digDeeperButton = document.getElementById('performance-dig-deeper');
      if (digDeeperButton && digDeeperButton.dataset.performanceBound !== '1') {
        digDeeperButton.removeAttribute('onclick');
        digDeeperButton.addEventListener('click', (event) => {
          event.preventDefault();
          performanceToggleDigDeeper();
        });
        digDeeperButton.dataset.performanceBound = '1';
      }
      const undoRefineButton = document.getElementById('performance-undo-refine');
      if (undoRefineButton && undoRefineButton.dataset.performanceBound !== '1') {
        undoRefineButton.removeAttribute('onclick');
        undoRefineButton.addEventListener('click', (event) => {
          event.preventDefault();
          performanceUndoRefine();
        });
        undoRefineButton.dataset.performanceBound = '1';
      }
      const artistCooldownButton = document.getElementById('performance-artist-cooldown');
      if (artistCooldownButton && artistCooldownButton.dataset.performanceBound !== '1') {
        artistCooldownButton.removeAttribute('onclick');
        artistCooldownButton.addEventListener('click', (event) => {
          event.preventDefault();
          performanceToggleArtistCooldown();
        });
        artistCooldownButton.dataset.performanceBound = '1';
      }
      ['stingers', 'tools'].forEach(kind => {
        const button = document.getElementById(`performance-exclude-${kind}`);
        if (!button || button.dataset.performanceBound === '1') return;
        button.removeAttribute('onclick');
        button.addEventListener('click', (event) => {
          event.preventDefault();
          performanceToggleExclude(kind);
        });
        button.dataset.performanceBound = '1';
      });
    }

    document.addEventListener('DOMContentLoaded', performanceBindPanelToggles);

    function performanceAuditTracks() {
      const seen = new Set();
      return [...performanceTimeline, performanceAnchorTrack].filter(Boolean).map(normalizeModalTrackMetadata).filter(track => {
        const key = performanceTrackKey(track);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    function performanceBpmRatioMove(fromBpm = 0, toBpm = 0) {
      const a = Number(fromBpm || 0);
      const b = Number(toBpm || 0);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return '';
      const ratio = b / a;
      if (ratio >= 1.85 && ratio <= 2.15) return 'double';
      if (ratio >= 0.46 && ratio <= 0.54) return 'half';
      return '';
    }

    function performanceBpmValue(track = {}) {
      const bpm = Number(track.bpm || track.serato_bpm || 0);
      return Number.isFinite(bpm) && bpm > 0 ? bpm : 0;
    }

    function performanceBpmDisplay(value = 0) {
      const bpm = Number(value || 0);
      return Number.isFinite(bpm) && bpm > 0 ? bpm.toFixed(1) : '--';
    }

    function performanceLiveBpmContext() {
      const anchor = normalizeModalTrackMetadata(performanceAnchorTrack || {});
      const anchorIsLive = anchor.connected_from === 'serato_live'
        || anchor.connected_from === 'djay_live'
        || Boolean(anchor.live_provider);
      const sourceTrack = anchor;
      const nativeBpm = Number(sourceTrack.native_bpm || sourceTrack.track_bpm || sourceTrack.library_bpm || 0) || performanceBpmValue(sourceTrack);
      const manualBpm = performancePlayingBpmOverride || 0;
      const liveBpm = Number(sourceTrack.playing_bpm || sourceTrack.serato_playing_bpm || 0) || 0;
      const playingBpm = manualBpm || liveBpm;
      const sourceBpm = manualBpm || liveBpm || nativeBpm;
      const appLabel = sourceTrack.source_label
        || (sourceTrack.live_provider === 'djay' || sourceTrack.connected_from === 'djay_live' ? 'djay Pro' : '')
        || (sourceTrack.live_provider === 'serato' || sourceTrack.connected_from === 'serato_live' ? 'Serato DJ Pro' : '')
        || performanceLiveSourceLabel
        || 'DJ software';
      let targetBpm = sourceBpm;
      let laneLabel = 'Current lane';
      if (manualBpm) {
        laneLabel = 'Manual target for this transition';
      } else if (sourceBpm && performanceTempoIntent === 'double') {
        targetBpm = sourceBpm * 2;
        laneLabel = liveBpm ? `Double-time from ${appLabel} tempo` : 'Double-time target';
      } else if (sourceBpm && performanceTempoIntent === 'half') {
        targetBpm = sourceBpm / 2;
        laneLabel = liveBpm ? `Half-time from ${appLabel} tempo` : 'Half-time target';
      } else if (liveBpm) {
        laneLabel = `Following ${appLabel} tempo`;
      }
      const sourceLabel = anchorIsLive
        ? `${appLabel} source`
        : 'AXIOM source';
      return {
        nativeBpm,
        manualBpm,
        liveBpm,
        playingBpm,
        sourceBpm,
        targetBpm,
        sourceLabel: manualBpm
          ? 'Manual Target BPM'
          : (liveBpm ? `${appLabel} Playing BPM` : sourceLabel),
        bpmSource: manualBpm ? 'manual' : (liveBpm ? 'live' : 'track'),
        laneLabel,
        appLabel,
        track: sourceTrack,
      };
    }

    function performanceSuggestionAnchorPayload() {
      const anchor = normalizeModalTrackMetadata(performanceAnchorTrack || {});
      const ctx = performanceLiveBpmContext();
      if (!ctx.playingBpm) return anchor;
      return {
        ...anchor,
        native_bpm: ctx.nativeBpm || anchor.native_bpm || anchor.bpm || anchor.serato_bpm || '',
        track_bpm: ctx.nativeBpm || anchor.track_bpm || anchor.bpm || anchor.serato_bpm || '',
        bpm: ctx.playingBpm,
        serato_bpm: ctx.playingBpm,
        playing_bpm: ctx.playingBpm,
        serato_playing_bpm: ctx.playingBpm,
        bpm_source: ctx.manualBpm ? 'playing_bpm_manual' : 'playing_bpm_live',
      };
    }

    function performanceSuggestionBpmReadout(track = {}) {
      const ctx = performanceLiveBpmContext();
      const trackBpm = performanceBpmValue(track);
      if (!ctx.sourceBpm || !trackBpm) {
        return {
          tone: '',
          title: `${performanceBpmDisplay(trackBpm)} BPM`,
          detail: ctx.sourceBpm ? `${ctx.appLabel} ${performanceBpmDisplay(ctx.sourceBpm)} · missing track BPM` : 'Waiting for playing BPM',
        };
      }
      const compareBpm = ctx.targetBpm || ctx.sourceBpm;
      const delta = trackBpm - compareBpm;
      const absDelta = Math.abs(delta);
      const ratioMove = performanceBpmRatioMove(ctx.sourceBpm, trackBpm);
      const tone = absDelta <= 2 ? 'tight' : (ratioMove || performanceTempoIntent ? 'lane' : '');
      const nativeGap = ctx.nativeBpm ? Math.abs(trackBpm - ctx.nativeBpm) : Number.POSITIVE_INFINITY;
      const playingGap = ctx.playingBpm ? Math.abs(trackBpm - ctx.playingBpm) : Number.POSITIVE_INFINITY;
      const laneCopy = ctx.playingBpm && playingGap <= nativeGap && playingGap <= 8
        ? `${ctx.manualBpm ? 'Target' : ctx.appLabel} tempo ${performanceBpmDisplay(ctx.playingBpm)}`
        : ctx.nativeBpm && nativeGap <= 8
          ? `Track BPM ${performanceBpmDisplay(ctx.nativeBpm)}`
          : performanceTempoIntent === 'double'
        ? `Double target ${performanceBpmDisplay(compareBpm)}`
        : performanceTempoIntent === 'half'
          ? `Half target ${performanceBpmDisplay(compareBpm)}`
          : ratioMove === 'double'
            ? 'Double-time option'
            : ratioMove === 'half'
              ? 'Half-time option'
              : ctx.laneLabel;
      return {
        tone,
        title: `${ctx.playingBpm ? (ctx.manualBpm ? 'Target BPM' : `${ctx.appLabel} tempo`) : 'Track BPM'} ${performanceBpmDisplay(ctx.sourceBpm)} -> ${performanceBpmDisplay(trackBpm)}`,
        detail: `${laneCopy} · ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`,
      };
    }

    function performanceSuggestionLane(track = {}) {
      const ctx = performanceLiveBpmContext();
      const bpm = performanceBpmValue(track);
      if (!bpm) return { key: 'other', label: 'Other Tempo Options' };
      const nativeWindow = ctx.nativeBpm ? Math.max(3, ctx.nativeBpm * 0.055) : 0;
      const playingWindow = ctx.playingBpm ? Math.max(4, ctx.playingBpm * 0.06) : 0;
      const nativeGap = ctx.nativeBpm ? Math.abs(bpm - ctx.nativeBpm) : Number.POSITIVE_INFINITY;
      const playingGap = ctx.playingBpm ? Math.abs(bpm - ctx.playingBpm) : Number.POSITIVE_INFINITY;
      if (ctx.playingBpm && playingGap <= playingWindow) {
        return {
          key: 'playing',
          label: `${ctx.manualBpm ? 'Target BPM' : `${ctx.appLabel} Tempo`} Matches (${performanceBpmDisplay(ctx.playingBpm)})`,
        };
      }
      if (ctx.nativeBpm && nativeGap <= nativeWindow && (!ctx.playingBpm || nativeGap <= playingGap)) {
        return { key: 'native', label: `Track BPM Matches (${performanceBpmDisplay(ctx.nativeBpm)})` };
      }
      const ratio = ctx.sourceBpm ? performanceBpmRatioMove(ctx.sourceBpm, bpm) : '';
      if (ratio === 'double') return { key: 'tempo', label: 'Double-Time Options' };
      if (ratio === 'half') return { key: 'tempo', label: 'Half-Time Options' };
      return { key: 'other', label: 'Other Tempo Options' };
    }

    function performanceSuggestionSections(suggestions = []) {
      const profileItems = performanceGigProfileEnabled
        ? suggestions.filter(performanceTrackInGigProfile)
        : [];
      const regularItems = profileItems.length
        ? suggestions.filter(track => !performanceTrackInGigProfile(track))
        : suggestions;
      const output = profileItems.length
        ? [{ label: `Gig Profile · ${currentPerformanceGigProfile()?.name || 'Prepared Picks'}`, items: profileItems }]
        : [];
      if (!performanceLiveBpmContext().playingBpm) {
        if (regularItems.length) output.push({ label: profileItems.length ? 'Usual Recommendations' : '', items: regularItems });
        return output;
      }
      const order = ['playing', 'native', 'tempo', 'other'];
      const sections = new Map();
      regularItems.forEach(track => {
        const lane = performanceSuggestionLane(track);
        if (!sections.has(lane.key)) sections.set(lane.key, { label: lane.label, items: [] });
        sections.get(lane.key).items.push(track);
      });
      output.push(...order.map(key => sections.get(key)).filter(section => section && section.items.length));
      return output;
    }

    function performanceLaneSummaryItems(suggestions = performanceSuggestions) {
      const ctx = performanceLiveBpmContext();
      const counts = { native: 0, playing: 0, tempo: 0, other: 0 };
      const bpms = [];
      (suggestions || []).forEach(track => {
        const bpm = performanceBpmValue(track);
        if (bpm) bpms.push(bpm);
        const lane = performanceSuggestionLane(track).key;
        counts[lane] = (counts[lane] || 0) + 1;
      });
      const items = [];
      const profileCount = (suggestions || []).filter(performanceTrackInGigProfile).length;
      if (performanceGigProfileEnabled) items.push({ label: currentPerformanceGigProfile()?.name || 'Gig Profile', value: profileCount, active: profileCount > 0 });
      if (ctx.playingBpm) items.push({ label: `${ctx.appLabel} Tempo ${performanceBpmDisplay(ctx.playingBpm)}`, value: counts.playing, active: counts.playing > 0 });
      if (ctx.nativeBpm) items.push({ label: `Track BPM ${performanceBpmDisplay(ctx.nativeBpm)}`, value: counts.native, active: counts.native > 0 });
      if (counts.tempo) items.push({ label: 'Half/Double', value: counts.tempo, active: true });
      if (counts.other) items.push({ label: 'Other Tempo', value: counts.other, active: false });
      if (bpms.length) {
        const min = Math.min(...bpms);
        const max = Math.max(...bpms);
        items.push({
          label: min === max ? `${performanceBpmDisplay(min)} BPM shown` : `${performanceBpmDisplay(min)}-${performanceBpmDisplay(max)} BPM shown`,
          value: '',
          active: false,
        });
      }
      return items;
    }

    function renderPerformanceLaneSummary() {
      const target = document.getElementById('performance-lane-summary');
      if (!target) return;
      if (!performanceAnchorTrack || !performanceSuggestions.length) {
        target.innerHTML = '';
        return;
      }
      const items = performanceLaneSummaryItems();
      target.innerHTML = items.map(item => `
        <span class="${item.active ? 'active' : ''}">${escapeHtml(item.label)}${item.value !== '' ? ` · ${Number(item.value || 0).toLocaleString()}` : ''}</span>
      `).join('');
    }

    function performanceBalancedBpmSuggestions(rawSuggestions = [], limit = 28) {
      if (performanceAssistPreferences.more_like) {
        return performanceFilteredSuggestions(rawSuggestions, { limit }).slice(0, limit);
      }
      if (!performanceLiveBpmContext().playingBpm) {
        return performanceFilteredSuggestions(rawSuggestions, { limit }).slice(0, limit);
      }
      const poolLimit = Math.max(rawSuggestions.length, limit * 5, 120);
      const pool = performanceFilteredSuggestions(rawSuggestions, { limit: poolLimit }).slice(0, poolLimit);
      const buckets = { native: [], playing: [], tempo: [], other: [] };
      pool.forEach(track => {
        const lane = performanceSuggestionLane(track).key;
        (buckets[lane] || buckets.other).push(track);
      });
      const selected = [];
      const addUnique = (items = [], max = limit) => {
        items.forEach(track => {
          if (selected.length >= limit || selected.some(existing => performanceTrackKey(existing) === performanceTrackKey(track))) return;
          selected.push(track);
        });
      };
      addUnique(buckets.playing.slice(0, 12));
      addUnique(buckets.native.slice(0, 8));
      addUnique(buckets.tempo.slice(0, 4));
      addUnique([...buckets.playing.slice(12), ...buckets.native.slice(8), ...buckets.tempo.slice(4), ...buckets.other], limit);
      return selected.slice(0, limit);
    }

    function performanceGigProfileTrackFitsLiveRules(track = {}) {
      if (!performanceAnchorTrack) return false;
      const distance = performanceBpmGuardDistance(track);
      if (!Number.isFinite(distance) || distance > 10) return false;
      if (performanceLaneLock && !performanceTrackMatchesLane(track, performanceLaneLock)) return false;
      if (!performanceTrackAllowedByExcludes(track)) return false;
      return distance <= 6 || performanceKeyGuardScore(track) >= 8;
    }

    function performanceGigProfileQualifiedTracks() {
      if (!performanceGigProfileEnabled || !performanceGigProfileTrackCache.length) return [];
      const liveFitPool = performanceGigProfileTrackCache.filter(performanceGigProfileTrackFitsLiveRules);
      return performanceFilteredSuggestions(liveFitPool, { limit: 32 }).slice(0, 32);
    }

    function performanceGigProfileSelectionKey() {
      return JSON.stringify([performanceGigProfileEnabled, performanceGigProfileId,
        performanceGigProfileOnlySelected, (currentPerformanceGigProfile()?.sourceIds || []).slice().sort()]);
    }

    function performanceBlendGigProfileSuggestions(rawSuggestions = [], limit = 16) {
      const usual = performanceBalancedBpmSuggestions(rawSuggestions, limit);
      if (!performanceGigProfileEnabled) return usual;
      const qualifiedProfilePool = performanceGigProfileQualifiedTracks();
      const profileLimit = performanceGigProfileOnlySelected ? limit : 8;
      const profile = performanceFilteredSuggestions(qualifiedProfilePool, { limit: profileLimit }).slice(0, profileLimit);
      if (performanceGigProfileOnlySelected) return profile;
      if (!profile.length) return usual;
      const usualKeys = new Set(usual.map(performanceTrackKey).filter(Boolean));
      const additiveProfile = profile.filter(track => !usualKeys.has(performanceTrackKey(track)));
      const combined = [...additiveProfile, ...usual];
      const similarity = performanceAssistPreferences.more_like;
      const ranked = similarity ? AXIOMLiveAssistSimilarity.chooseTier(combined, similarity).sort((left, right) =>
        Number(AXIOMLiveAssistSimilarity.matches(right, similarity)) - Number(AXIOMLiveAssistSimilarity.matches(left, similarity))
        || Number(AXIOMLiveAssistSimilarity.sameArtist(right, similarity)) - Number(AXIOMLiveAssistSimilarity.sameArtist(left, similarity))) : combined;
      // Both pools were filtered separately. Keep only the first ranked version
      // across the merged list too, without reordering the surviving rows.
      const seenFamilies = new Set();
      return ranked.filter(track => {
        const keys = [String(track.path || '').toLowerCase(), ...performanceTrackSuggestionFamilyKeys(track)].filter(Boolean);
        if (keys.some(key => seenFamilies.has(key))) return false;
        keys.forEach(key => seenFamilies.add(key));
        return true;
      });
    }

    function performanceDraftPlayingBpm(value) {
      performancePlayingBpmDraft = String(value || '');
    }

    function performanceHandlePlayingBpmKeydown(event) {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        performanceCommitPlayingBpm();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        performancePlayingBpmDraft = performancePlayingBpmOverride
          ? performanceBpmDisplay(performancePlayingBpmOverride)
          : '';
        event.currentTarget.value = performancePlayingBpmDraft;
        event.currentTarget.blur();
      }
    }

    function performanceCommitPlayingBpm() {
      const bpm = Number(String(performancePlayingBpmDraft || '').trim());
      if (!Number.isFinite(bpm) || bpm < 30 || bpm > 300) {
        showToast('Target BPM must be from 30 to 300.');
        return;
      }
      performancePlayingBpmOverride = Number(bpm.toFixed(1));
      performancePlayingBpmDraft = performanceBpmDisplay(performancePlayingBpmOverride);
      performanceTempoIntent = '';
      const input = document.getElementById('performance-playing-bpm-input');
      if (input) input.value = performancePlayingBpmDraft;
      renderPerformanceSignals();
      renderPerformanceRefines();
      renderPerformanceSuggestions();
      if (performancePlayingBpmDebounceTimer) clearTimeout(performancePlayingBpmDebounceTimer);
      performancePlayingBpmDebounceTimer = null;
      performancePublishTargetBpm(performancePlayingBpmOverride);
      if (performanceAnchorTrack) performanceFetchSuggestions();
      showToast(`Manual Target BPM ${performancePlayingBpmDraft} set for this transition.`);
    }

    function performanceClearPlayingBpm() {
      performancePlayingBpmOverride = 0;
      performancePlayingBpmDraft = '';
      performanceTempoResetVersion += 1;
      if (performancePlayingBpmDebounceTimer) clearTimeout(performancePlayingBpmDebounceTimer);
      performancePlayingBpmDebounceTimer = null;
      const input = document.getElementById('performance-playing-bpm-input');
      if (input) input.value = '';
      performancePublishTargetBpm(0);
      renderPerformanceSignals();
      renderPerformanceSuggestions();
      if (performanceAnchorTrack) performanceFetchSuggestions();
      showToast('Target BPM returned to the live deck.');
    }

    async function performanceResetTempoBaseline() {
      performanceTempoIntent = '';
      performancePlayingBpmOverride = 0;
      performancePlayingBpmDraft = '';
      performanceTempoResetVersion += 1;
      if (performancePlayingBpmDebounceTimer) clearTimeout(performancePlayingBpmDebounceTimer);
      performancePlayingBpmDebounceTimer = null;
      const input = document.getElementById('performance-playing-bpm-input');
      if (input) input.value = '';
      performancePublishTargetBpm(0);
      renderPerformanceSignals();
      renderPerformanceRefines();
      if (performanceAnchorTrack) await performanceFetchSuggestions();
      else queuePerformanceLiveAssistStateSync(0);
      showToast('Live Assist refreshed at the current track BPM.');
    }

    function renderPerformanceBpmReadout(track = {}) {
      const readout = performanceSuggestionBpmReadout(track);
      return `
        <div class="performance-bpm-readout ${escapeHtml(readout.tone || '')}">
          <strong>${escapeHtml(readout.title)}</strong>
          <span>${escapeHtml(readout.detail)}</span>
        </div>
      `;
    }

    function performanceSuggestionDecisionCopy(track = {}, match = {}) {
      const ctx = performanceLiveBpmContext();
      const lane = performanceSuggestionLane(track);
      const root = performanceTrackRoot(track);
      const year = performanceTrackYear(track);
      const energy = track.energy || modalTrackEnergy(track);
      let headline = 'Good next move';
      let detail = 'Balanced against your current track, filters, and set direction.';
      if (lane.key === 'playing') {
        headline = ctx.manualBpm
          ? 'Matches your manual Target BPM'
          : `Matches the ${ctx.appLabel} playing tempo`;
        detail = 'Use this when the room is already moving at that BPM and you want a cleaner next step.';
      } else if (lane.key === 'native') {
        headline = 'Stays close to the track BPM';
        detail = 'Use this when you want the next record to feel controlled without a big tempo jump.';
      } else if (lane.key === 'tempo') {
        headline = 'Half/double-time bridge';
        detail = 'Use this when you want a dramatic lane change without losing the pulse.';
      } else if (performanceLaneLock && performanceTrackMatchesLane(track, performanceLaneLock)) {
        headline = `Fits the ${performanceLaneLabel()} lane`;
        detail = 'Use this when you want AXIOM to stay inside the room direction you locked.';
      } else if (match?.label) {
        headline = match.label;
      }
      const context = [root, energy, year ? `${year} era` : ''].filter(Boolean).join(' · ');
      return {
        headline,
        detail: context ? `${detail} ${context}.` : detail
      };
    }

    function performanceBuildAudit() {
      const tracks = performanceAuditTracks();
      const bpms = tracks.map(track => Number(track.bpm || track.serato_bpm || 0)).filter(value => Number.isFinite(value) && value > 0);
      const years = tracks.map(performanceTrackYear).filter(Boolean);
      const genres = new Map();
      const roots = new Map();
      let doubleMoves = 0;
      let sharpJumps = 0;
      let missingBpm = 0;
      let missingKey = 0;
      let missingYear = 0;

      tracks.forEach((track, index) => {
        const genre = performanceTrackGenre(track) || 'Unknown';
        const root = performanceTrackRoot(track) || 'Open';
        genres.set(genre, (genres.get(genre) || 0) + 1);
        roots.set(root, (roots.get(root) || 0) + 1);
        if (!Number(track.bpm || track.serato_bpm || 0)) missingBpm += 1;
        if (!track.camelot && !track.key) missingKey += 1;
        if (!performanceTrackYear(track)) missingYear += 1;
        if (index > 0) {
          const prev = tracks[index - 1] || {};
          const prevBpm = Number(prev.bpm || prev.serato_bpm || 0);
          const bpm = Number(track.bpm || track.serato_bpm || 0);
          if (performanceBpmRatioMove(prevBpm, bpm)) {
            doubleMoves += 1;
          } else if (prevBpm && bpm && Math.abs(prevBpm - bpm) > 14) {
            sharpJumps += 1;
          }
        }
      });

      const topFromMap = (map) => [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || ['', 0];
      const [topGenre, topGenreCount] = topFromMap(genres);
      const [topRoot, topRootCount] = topFromMap(roots);
      const bpmMin = bpms.length ? Math.min(...bpms) : 0;
      const bpmMax = bpms.length ? Math.max(...bpms) : 0;
      const yearMin = years.length ? Math.min(...years) : 0;
      const yearMax = years.length ? Math.max(...years) : 0;
      const prepGaps = missingBpm + missingKey + missingYear;
      return {
        tracks,
        count: tracks.length,
        bpmLabel: bpms.length ? `${Math.round(bpmMin)}-${Math.round(bpmMax)}` : '--',
        laneLabel: topRoot ? `${topRoot} ${topRootCount}` : 'Open',
        genreLabel: topGenre ? `${topGenre} ${topGenreCount}` : 'Open',
        eraLabel: years.length ? (yearMin === yearMax ? String(yearMax) : `${yearMin}-${yearMax}`) : 'Open',
        doubleMoves,
        sharpJumps,
        prepGaps,
        missingBpm,
        missingKey,
        missingYear,
        noteCount: performanceNotes.length
      };
    }

    function performanceSessionReceiptRecords() {
      loadSavedPlaylists();
      return savedPlaylists
        .filter(item => item?.performanceSession)
        .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
    }

    function performanceReceiptTracks() {
      if (Array.isArray(performanceReceiptPreviewTracks)) return performanceReceiptPreviewTracks;
      const records = performanceSessionReceiptRecords();
      const selected = records.find(item => item.id === performanceReceiptRecordId);
      if (selected?.tracks?.length) return selected.tracks;
      const liveTimeline = Array.isArray(performanceTimeline) ? performanceTimeline.filter(Boolean) : [];
      if (liveTimeline.length) return liveTimeline;
      const live = performanceSessionTracksForSave();
      if (live.length) return live;
      return records[0]?.tracks || [];
    }

    function performanceReceiptMetrics(tracks = []) {
      const clean = Array.isArray(tracks) ? tracks.filter(Boolean) : [];
      const bpms = clean.map(track => Number(track.bpm || track.serato_bpm || 0)).filter(value => value > 0);
      const years = clean.map(performanceTrackYear).filter(Boolean);
      const genres = new Map();
      clean.forEach(track => {
        const genre = performanceTrackGenre(track) || 'Open format';
        genres.set(genre, (genres.get(genre) || 0) + 1);
      });
      const topGenre = [...genres.entries()].sort((a, b) => b[1] - a[1])[0] || ['Open format', 0];
      let quickMoves = 0;
      clean.forEach((track, index) => {
        if (!index) return;
        const current = new Date(track.played_at || track.start_time || 0).getTime();
        const previous = new Date(clean[index - 1]?.played_at || clean[index - 1]?.start_time || 0).getTime();
        if (current && previous && current - previous > 0 && current - previous < 90000) quickMoves += 1;
      });
      const firstTime = clean.filter(track => Number(track.play_count || track.serato_play_count || 0) <= 1).length;
      const timestamps = clean
        .map(track => new Date(track.played_at || track.start_time || 0).getTime())
        .filter(value => Number.isFinite(value) && value > 0);
      const gaps = [];
      timestamps.forEach((value, index) => {
        if (!index) return;
        const gap = value - timestamps[index - 1];
        if (gap > 0 && gap < 30 * 60 * 1000) gaps.push(gap);
      });
      const sortedGaps = [...gaps].sort((a, b) => a - b);
      const medianGap = sortedGaps.length
        ? sortedGaps[Math.floor(sortedGaps.length / 2)]
        : 3.5 * 60 * 1000;
      const timestampDuration = timestamps.length > 1
        ? Math.max(0, timestamps[timestamps.length - 1] - timestamps[0]) + medianGap
        : 0;
      const durationSeconds = clean.reduce((total, track) => {
        const duration = Number(track.duration || track.length || track.duration_seconds || 0);
        return total + (Number.isFinite(duration) && duration > 0 ? duration : 0);
      }, 0);
      const totalMinutes = clean.length
        ? Math.max(1, Math.round((timestampDuration || durationSeconds * 1000 || clean.length * 3.5 * 60 * 1000) / 60000))
        : 0;
      const currentKeys = new Set(clean.map(performanceTrackKey).filter(Boolean));
      const recentKeys = new Set();
      performanceSessionReceiptRecords()
        .filter(record => !performanceReceiptRecordId || record.id !== performanceReceiptRecordId)
        .slice(0, 8)
        .forEach(record => (record.tracks || []).forEach(track => {
          const key = performanceTrackKey(track);
          if (key) recentKeys.add(key);
        }));
      const repeatedFromRecent = [...currentKeys].filter(key => recentKeys.has(key)).length;
      const recentPercent = currentKeys.size ? Math.round((repeatedFromRecent / currentKeys.size) * 100) : 0;
      const eraCounts = new Map();
      years.forEach(year => {
        const decade = `${Math.floor(year / 10) * 10}s`;
        eraCounts.set(decade, (eraCounts.get(decade) || 0) + 1);
      });
      const eras = [...eraCounts.entries()]
        .sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))
        .slice(0, 3)
        .map(([label, count]) => ({ label, count, percent: years.length ? Math.round((count / years.length) * 100) : 0 }));
      return {
        count: clean.length,
        bpm: bpms.length ? `${Math.round(Math.min(...bpms))}-${Math.round(Math.max(...bpms))}` : '--',
        era: years.length ? `${Math.min(...years)}-${Math.max(...years)}` : 'Open',
        topGenre: topGenre[0],
        topGenreCount: topGenre[1],
        quickMoves,
        firstTime,
        totalMinutes,
        recentPercent,
        eras,
      };
    }

    function performanceReceiptTime(track = {}) {
      const value = new Date(track.played_at || track.start_time || 0);
      if (!Number.isFinite(value.getTime()) || value.getTime() <= 0) return '--:--';
      return value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function performanceReceiptTimelineEvents(tracks = [], metrics = {}) {
      const clean = Array.isArray(tracks) ? tracks.filter(Boolean) : [];
      if (!clean.length) return [];
      const event = (track, label, detail, icon, extra = '') => ({
        time: performanceReceiptTime(track), label, detail, icon, extra
      });
      const events = [];
      const first = clean[0];
      const last = clean[clean.length - 1];
      events.push(event(first, 'Set started', `First track in ${clean.length > 1 ? 'live session' : 'this session'}`, 'skip-forward.svg'));

      if (metrics.quickMoves > 0) {
        events.push(event(clean[Math.min(metrics.quickMoves, clean.length - 1)], 'Quick section', `${metrics.quickMoves + 1} fast move${metrics.quickMoves === 0 ? '' : 's'} detected`, 'zap.svg'));
      }

      let biggestLift = null;
      let biggestDrop = null;
      let smoothPair = null;
      let styleShift = null;
      clean.forEach((track, index) => {
        if (!index) return;
        const previous = clean[index - 1] || {};
        const bpm = Number(track.bpm || track.serato_bpm || 0);
        const previousBpm = Number(previous.bpm || previous.serato_bpm || 0);
        if (bpm && previousBpm) {
          const delta = bpm - previousBpm;
          if (delta > 0 && (!biggestLift || delta > biggestLift.delta)) biggestLift = { track, delta, index };
          if (delta < 0 && (!biggestDrop || delta < biggestDrop.delta)) biggestDrop = { track, delta, index };
          if (Math.abs(delta) <= 3 && !smoothPair) smoothPair = { track, previous, delta };
        }
        const genre = performanceTrackGenre(track);
        const previousGenre = performanceTrackGenre(previous);
        if (!styleShift && genre && previousGenre && genre !== previousGenre) styleShift = { track, previousGenre, genre };
      });

      if (biggestLift) events.push(event(biggestLift.track, 'Energy lift', `Tempo up · +${Math.round(biggestLift.delta)} BPM`, 'audio-waveform.svg'));
      if (metrics.firstTime > 0) {
        const firstNew = clean.find(track => Number(track.play_count || track.serato_play_count || 0) <= 1) || first;
        events.push(event(firstNew, 'First-time music', `${metrics.firstTime} track${metrics.firstTime === 1 ? '' : 's'} played for the first time`, 'check-circle.svg'));
      }

      const timedGaps = clean.slice(0, -1).map((track, index) => ({
        track,
        duration: new Date(clean[index + 1]?.played_at || clean[index + 1]?.start_time || 0).getTime()
          - new Date(track.played_at || track.start_time || 0).getTime()
      })).filter(item => item.duration > 0 && item.duration < 30 * 60 * 1000);
      const longest = timedGaps.sort((a, b) => b.duration - a.duration)[0];
      if (longest) {
        const minutes = Math.floor(longest.duration / 60000);
        const seconds = Math.round((longest.duration % 60000) / 1000);
        events.push(event(longest.track, 'Longest stretch', `${minutes}:${String(seconds).padStart(2, '0')} on one track`, 'disc-3.svg'));
      }
      if (smoothPair) events.push(event(smoothPair.track, 'Smooth transition', `${smoothPair.previous.title || 'Previous track'} to ${smoothPair.track.title || 'next track'} · ${Math.abs(Math.round(smoothPair.delta))} BPM shift`, 'rotate-cw.svg'));
      if (styleShift) events.push(event(styleShift.track, 'Style shift', `${styleShift.previousGenre} to ${styleShift.genre}`, 'sliders-horizontal.svg'));
      if (metrics.eras?.length) {
        const eraDetail = metrics.eras.map(item => `${item.label} ${item.percent}%`).join(' · ');
        const bars = `<div class="performance-era-bars">${metrics.eras.map(item => `<span style="width:${Math.max(4, item.percent)}%" title="${escapeHtml(item.label)} ${item.percent}%"></span>`).join('')}</div>`;
        events.push(event(clean[Math.max(0, clean.length - 2)], 'Era balance', eraDetail, 'database.svg', bars));
      }
      if (biggestDrop) events.push(event(biggestDrop.track, 'Cool-down', `Energy down · ${Math.round(biggestDrop.delta)} BPM`, 'skip-back.svg'));
      events.push(event(last, 'Set ended', `${metrics.totalMinutes || 0} min · ${metrics.count || clean.length} tracks`, 'check.svg'));
      return events;
    }

    function performanceReceiptCoachCopy(metrics, tab) {
      if (!performanceCoachInsightsEnabled) {
        return {
          kicker: 'Coach and session insights are off',
          callout: 'Your set stays yours',
          copy: 'Recording and live recommendations remain available. AXIOM is not analysing this session or creating an automatic receipt.'
        };
      }
      if (!metrics.count) {
        return {
          kicker: 'Ready when you are',
          callout: 'Build the night first',
          copy: 'Meaningful plays will appear here in order. AXIOM waits for real session activity before offering a pattern.'
        };
      }
      if (tab === 'recent') {
        return {
          kicker: 'Across recent sessions',
          callout: metrics.firstTime ? 'Keep the new music moving' : 'Freshen the next move',
          copy: metrics.firstTime
            ? `${metrics.firstTime} first-time play${metrics.firstTime === 1 ? '' : 's'} appeared across the sessions shown.`
            : 'Your recent sessions lean familiar. Try auditioning a few less-played records before the next set.'
        };
      }
      if (tab === 'habit') {
        return {
          kicker: 'Library habit',
          callout: `${metrics.topGenre} leads the room`,
          copy: `${metrics.topGenreCount} of the analysed plays sit in this lane. This is a pattern, not a score.`
        };
      }
      if (metrics.quickMoves >= Math.max(2, Math.round(metrics.count * .3))) {
        return {
          kicker: 'Mixing pace',
          callout: 'Quick transitions',
          copy: `${metrics.quickMoves} quick transitions appeared in this set. Your session history keeps their order for review.`
        };
      }
      return {
        kicker: 'Session read',
        callout: 'A steady night',
        copy: `${metrics.count} meaningful play${metrics.count === 1 ? '' : 's'} moved through ${metrics.topGenre}. No score, just a clear record of the set.`
      };
    }

    function performanceCurrentCoachCopy() {
      return performanceCoachInsightsEnabled
        ? {title: 'Coach On', detail: 'Learning from your sets. Messages appear when there is something useful to offer.'}
        : {title: 'Coach Off', detail: 'Turn on optional support from your playing history.'};
    }

    function renderPerformanceCoach() {
      const strip = document.getElementById('performance-coach-strip');
      const title = document.getElementById('performance-coach-title');
      const detail = document.getElementById('performance-coach-detail');
      const toggle = document.getElementById('performance-coach-toggle');
      const copy = performanceCurrentCoachCopy();
      if (title) title.textContent = copy.title;
      if (detail) detail.textContent = copy.detail;
      if (strip) strip.classList.toggle('is-off', !performanceCoachInsightsEnabled);
      if (toggle) {
        toggle.setAttribute('aria-pressed', performanceCoachInsightsEnabled ? 'true' : 'false');
        const label = toggle.querySelector('span');
        if (label) label.textContent = performanceCoachInsightsEnabled ? 'On' : 'Off';
      }
    }

    function performanceToggleCoach() {
      performanceCoachInsightsEnabled = !performanceCoachInsightsEnabled;
      localStorage.setItem(PERFORMANCE_COACH_INSIGHTS_KEY, performanceCoachInsightsEnabled ? 'on' : 'off');
      renderPerformanceCoach();
      renderPerformanceSessionReceipt();
      showToast(performanceCoachInsightsEnabled ? 'Coach messages on.' : 'Coach messages off. Recommendations stay available.');
    }

    function renderPerformanceSessionReceipt() {
      const receipt = document.getElementById('performance-session-receipt');
      if (!receipt) return;
      performanceCoachInsightsEnabled = localStorage.getItem(PERFORMANCE_COACH_INSIGHTS_KEY) === 'on';
      const records = performanceSessionReceiptRecords();
      let tracks = performanceReceiptTracks();
      if (performanceReceiptTab === 'recent') tracks = records.slice(0, 5).flatMap(item => item.tracks || []);
      if (performanceReceiptTab === 'habit') tracks = records.slice(0, 12).flatMap(item => item.tracks || []);
      const metrics = performanceReceiptMetrics(tracks);
      ['session', 'recent', 'habit'].forEach(tab => {
        document.getElementById(`performance-receipt-tab-${tab}`)?.classList.toggle('active', performanceReceiptTab === tab);
      });
      const summary = document.getElementById('performance-receipt-summary');
      if (summary) summary.innerHTML = [
        ['Total Time', `${metrics.totalMinutes} Min`, 'Tonight\'s session length'],
        ['Tracks Played', metrics.count, 'Meaningful plays'],
        ['First-Time Plays', metrics.firstTime, 'Less familiar records'],
        ['From Recent Sets', `${metrics.recentPercent}%`, 'Repeated from recent sessions'],
      ].map(([label, value, note]) => `<div class="performance-receipt-stat"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`).join('');
      const list = document.getElementById('performance-ledger-list');
      if (list) {
        const events = performanceReceiptTimelineEvents(tracks, metrics);
        list.classList.toggle('is-collapsed', !performanceReceiptTimelineExpanded);
        list.innerHTML = events.length ? events.map(item => `
          <article class="performance-ledger-row">
            <time class="performance-ledger-time">${escapeHtml(item.time)}</time>
            <div class="performance-ledger-event">
              <img src="/static/icons/${escapeHtml(item.icon)}" alt="">
              <strong>${escapeHtml(item.label)}</strong>
            </div>
            <div class="performance-ledger-detail">${escapeHtml(item.detail)}${item.extra || ''}</div>
          </article>
        `).join('') : '<div class="performance-ledger-empty">No session events have been recorded for this view yet.</div>';
      }
      const status = document.getElementById('performance-receipt-status');
      if (status) status.textContent = performanceReceiptTimelineExpanded
        ? 'Full history shown. Session analysis stays private and local in AXIOM.'
        : 'Collapsed history. Your full set timeline is saved with this session.';
      const total = document.getElementById('performance-receipt-footer-total');
      if (total) total.textContent = `${metrics.totalMinutes} min · ${metrics.count} tracks`;
      const expand = document.getElementById('performance-receipt-expand');
      if (expand) {
        expand.textContent = performanceReceiptTimelineExpanded ? 'Collapse' : 'Expand';
        expand.setAttribute('aria-expanded', performanceReceiptTimelineExpanded ? 'true' : 'false');
      }
      const provider = performanceLiveProvider ? `${performanceLiveProvider} Connected` : 'AXIOM Ready';
      const providerBadge = document.getElementById('performance-receipt-command-provider');
      if (providerBadge) providerBadge.textContent = provider;
      ['performance-receipt-dj-auto'].forEach(id => {
        const button = document.getElementById(id);
        if (!button) return;
        button.textContent = performanceSeratoEnabled ? 'DJ Auto On' : 'DJ Auto Off';
        button.classList.toggle('active', performanceSeratoEnabled);
      });
    }

    function openPerformanceSessionReceipt(recordId = '') {
      performanceReceiptRecordId = String(recordId || performanceReceiptRecordId || '');
      document.getElementById('tab-content-performance')?.classList.add('receipt-open');
      const receipt = document.getElementById('performance-session-receipt');
      if (receipt) receipt.hidden = false;
      renderPerformanceSessionReceipt();
      receipt?.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function closePerformanceSessionReceipt() {
      document.getElementById('tab-content-performance')?.classList.remove('receipt-open');
      const receipt = document.getElementById('performance-session-receipt');
      if (receipt) receipt.hidden = true;
    }

    function performanceSetReceiptTab(tab = 'session') {
      if (!['session', 'recent', 'habit'].includes(tab)) return;
      performanceReceiptTab = tab;
      renderPerformanceSessionReceipt();
    }

    function performanceToggleReceiptTimeline() {
      performanceReceiptTimelineExpanded = !performanceReceiptTimelineExpanded;
      renderPerformanceSessionReceipt();
    }

    function performanceViewReceiptTracklist() {
      performanceReceiptTimelineExpanded = true;
      performanceSetReceiptTab('session');
      document.getElementById('performance-ledger-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function performanceSessionTracksForSave() {
      const seen = new Set();
      const source = [...performanceTimeline, performanceAnchorTrack].filter(Boolean);
      const tracks = [];
      source.forEach((track, index) => {
        const normalized = normalizeModalTrackMetadata(track || {});
        const key = performanceTrackKey(normalized);
        if (!key || seen.has(key)) return;
        seen.add(key);
        tracks.push({
          ...normalized,
          performance_sequence: tracks.length + 1,
          performance_saved_from: normalized.connected_from === 'serato_live' || normalized.connected_from === 'djay_live'
            ? normalized.connected_from
            : (normalized.played_from || normalized.source || 'performance_mode'),
          played_at: normalized.played_at || normalized.start_time || new Date().toISOString()
        });
      });
      return prepareTracksForPlaylistSave(tracks);
    }

    function performanceDefaultSessionName() {
      const now = new Date();
      const pad = value => String(value).padStart(2, '0');
      const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
      const anchor = performanceAnchorTrack?.title ? ` - ${performanceAnchorTrack.title}` : '';
      return `Performance ${stamp}${anchor}`.slice(0, 90);
    }

    function performanceSaveSessionRecord(name, tracks, audit) {
      loadSavedPlaylists();
      const cleanTracks = prepareTracksForPlaylistSave(tracks);
      if (!cleanTracks.length) return null;
      const cleanAudit = { ...audit };
      delete cleanAudit.tracks;
      const cleanNotes = performanceNotes.map(note => ({ ...note }));
      const record = {
        id: makePlaylistId(),
        name: String(name || performanceDefaultSessionName()).trim() || performanceDefaultSessionName(),
        tracks: cleanTracks,
        setBrief: setBriefPayload(),
        performanceSession: true,
        performanceAudit: cleanAudit,
        performanceNotes: cleanNotes,
        source: 'performance_mode',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      savedPlaylists.unshift(record);
      selectedPlaylistId = record.id;
      persistSavedPlaylists();
      if (!verifySavedPlaylist(record)) {
        throw new Error('AXIOM could not confirm the Performance session in Playlists.');
      }
      refreshPlaylistsView();
      performanceReceiptRecordId = record.id;
      return record;
    }

    function performanceSaveSession() {
      if (window.AXIOM_REQUIRE_ACCOUNT_FEATURE && !window.AXIOM_REQUIRE_ACCOUNT_FEATURE('Save Performance Session')) return;
      const tracks = performanceSessionTracksForSave();
      if (!tracks.length) {
        showToast('No Performance session tracks to save yet.', true);
        return;
      }
      const audit = performanceBuildAudit();
      showSetNameModal(performanceDefaultSessionName(), (name) => {
        if (!name) return;
        try {
          const record = performanceSaveSessionRecord(name, tracks, audit);
          if (record) {
            showSaveSetSuccess(record.name, record.tracks.length, 'performance');
            if (performanceCoachInsightsEnabled) setTimeout(() => openPerformanceSessionReceipt(record.id), 240);
          }
        } catch (err) {
          console.error('Save Performance session failed:', err);
          showToast(err?.message || 'Performance session save failed.', true);
        }
      });
    }

    async function performanceSendToStudio() {
      const tracks = performanceSessionTracksForSave();
      if (!tracks.length) {
        showToast('No Performance session tracks to send yet.', true);
        return;
      }
      if (studioHasWorkingTracks()) {
        const confirmed = await showAxiomConfirm(
          'Open Performance In Studio',
          `This will replace the current Studio working set with ${tracks.length} Performance track${tracks.length === 1 ? '' : 's'}. Saved playlists and source audio are not affected.`,
          'OPEN IN STUDIO',
          'primary'
        );
        if (!confirmed) return;
      }
      editingPlaylistId = null;
      currentPlaylist = JSON.parse(JSON.stringify(tracks));
      currentRoutePlaylist = [];
      activeStudioView = 'manual';
      magicSetStudioCtaReady = false;
      resetModalSuggestionDecisions();
      if (typeof setGraphMode === 'function') setGraphMode(false);
      document.getElementById('set-brief-view')?.classList.add('hidden');
      document.getElementById('studio-start-view')?.classList.add('hidden');
      document.getElementById('studio-active-view')?.classList.remove('hidden');
      showTab('studio');
      setStudioView('manual');
      applySetBriefToStudioControls();
      updateStudioToolsAvailability();
      initSortable();
      await recalculateAudit();
      showToast(`Performance session opened in Studio: ${tracks.length} tracks.`);
    }

    function performanceFilteredSuggestions(items = [], options = {}) {
      const assist = typeof performanceAssistPreferences === 'object' ? performanceAssistPreferences : {};
      const hidden = options.ignoreHidden ? new Set() : new Set([...performanceHiddenPaths].map(value => String(value || '')));
      const timelineKeys = new Set(performanceTimeline.map(performanceTrackKey));
      const bpmContext = performanceLiveBpmContext();
      const targetBpm = Number(bpmContext.targetBpm || bpmContext.sourceBpm || 0);
      const liveAnchor = bpmContext.track?.live_provider
        || ['djay_live', 'serato_live'].includes(bpmContext.track?.connected_from);
      if (liveAnchor && !targetBpm) return [];
      const bpmWindow = 5;
      const base = items
        .map(normalizeModalTrackMetadata)
        .map((track, index) => ({ track, index }))
        .filter(item => item.track.path && !hidden.has(String(item.track.path || '')))
        .filter(item => !assist.more_like || AXIOMLiveAssistSimilarity.matches(item.track, assist.more_like)
          || AXIOMLiveAssistSimilarity.matchesRoot(item.track, assist.more_like))
        .filter(item => !assist.year_range || AXIOMLiveAssistSimilarity.matchesRange(item.track, assist.year_range))
        .filter(item => {
          if (!targetBpm) return true;
          const bpm = performanceBpmValue(item.track);
          return bpm > 0 && Math.abs(bpm - targetBpm) <= bpmWindow;
        })
        // This is a hard safety gate. Fallback ranking is never allowed to
        // reintroduce Dirty, Explicit, or unknown-version tracks.
        .filter(item => !performanceCleanOnly || performanceTrackIsVerifiedClean(item.track))
        .filter(item => {
          const mode = typeof performanceYearMode === 'string' ? performanceYearMode : '';
          if (!mode) return true;
          const year = performanceTrackYear(item.track);
          const anchorYear = performanceTrackYear(performanceAnchorTrack || {});
          return year > 0 && (mode === 'new' ? year >= 2022 : anchorYear > 0 && year <= anchorYear - 5);
        })
        .filter(item => !assist.wrong_path || item.track.path !== assist.wrong_path)
        .filter(item => !assist.wrong_genre || performanceTrackGenre(item.track).toLowerCase() !== assist.wrong_genre)
        .filter(item => !assist.min_year || performanceTrackYear(item.track) >= assist.min_year)
        .filter(item => !timelineKeys.has(performanceTrackKey(item.track)))
        .filter(item => !performanceWasPlayed(item.track))
        .filter(item => !performanceTrackFamilyRejected(item.track))
        .filter(item => options.ignoreArtistCooldown
          || (assist.more_like && AXIOMLiveAssistSimilarity.sameArtist(item.track, assist.more_like))
          || !performanceArtistOnCooldown(item.track));
      const applySoftFilters = (pool, filterOptions = {}) => pool
        .filter(item => {
          if (filterOptions.ignoreRejectedGenres) return true;
          const genre = performanceTrackGenre(item.track).toLowerCase();
          return !(genre && performanceRejectedGenres.has(genre));
        })
        .filter(item => {
          if (filterOptions.ignoreRejectedRoots) return true;
          const root = performanceTrackRoot(item.track).toLowerCase();
          return !(root && performanceRejectedRoots.has(root));
        })
        .filter(item => {
          if (filterOptions.ignoreYear) return true;
          if (!performanceMinYear) return true;
          const year = performanceTrackYear(item.track);
          return !year || year >= performanceMinYear;
        })
        .filter(item => filterOptions.ignoreExcludes || performanceTrackAllowedByExcludes(item.track))
        .filter(item => filterOptions.ignoreSafePicks || !performanceSafePicks || performanceSafePick(item.track));
      const filtered = applySoftFilters(base)
        || [];
      const fallback = assist.more_like ? filtered : filtered.length
        ? filtered
        : applySoftFilters(base, { ignoreRejectedRoots: true }).length
          ? applySoftFilters(base, { ignoreRejectedRoots: true })
          : applySoftFilters(base, { ignoreRejectedRoots: true, ignoreRejectedGenres: true }).length
            ? applySoftFilters(base, { ignoreRejectedRoots: true, ignoreRejectedGenres: true })
            : applySoftFilters(base, { ignoreRejectedRoots: true, ignoreRejectedGenres: true, ignoreYear: true, ignoreSafePicks: true });
      const laneFiltered = performanceLaneLock
        ? fallback.filter(item => performanceTrackMatchesLane(item.track, performanceLaneLock))
        : fallback;
      const tierPool = laneFiltered.length ? laneFiltered : fallback;
      const sorted = (assist.more_like ? AXIOMLiveAssistSimilarity.chooseTier(tierPool, assist.more_like, item => item.track) : tierPool)
        .sort((a, b) => {
          if (assist.more_like) {
            const genre = Number(AXIOMLiveAssistSimilarity.matches(b.track, assist.more_like))
              - Number(AXIOMLiveAssistSimilarity.matches(a.track, assist.more_like));
            if (genre) return genre;
            const artist = Number(AXIOMLiveAssistSimilarity.sameArtist(b.track, assist.more_like))
              - Number(AXIOMLiveAssistSimilarity.sameArtist(a.track, assist.more_like));
            if (artist) return artist;
          }
          const preferenceRank = track => {
            const genre = performanceTrackGenre(track).toLowerCase();
            const flip = (assist.genre_flip || []).some(value => genre.includes(value)) ? 10000 : 0;
            const same = assist.preferred_genre && genre === assist.preferred_genre ? 10000 : 0;
            const year = performanceTrackYear(track);
            const era = assist.preferred_era ? (year ? Math.max(0, 1000 - Math.abs(year - assist.preferred_era - 5)) : 0) : 0;
            const djEra = assist.preferred_dj_era && AXIOMLiveAssistSimilarity.eraFor(track) === assist.preferred_dj_era ? 10000 : 0;
            return flip + same + era + djEra;
          };
          const preferenceDiff = preferenceRank(b.track) - preferenceRank(a.track);
          if (preferenceDiff) return preferenceDiff;
          const aScore = performanceScoreSuggestion(a.track);
          const bScore = performanceScoreSuggestion(b.track);
          const bucketSize = performanceDigDeeper ? 12 : 8;
          const aBucket = Math.floor(aScore / bucketSize);
          const bBucket = Math.floor(bScore / bucketSize);
          if (aBucket !== bBucket) return bBucket - aBucket;
          if (performanceDigDeeper) {
            const deepDiff = performanceDigDeeperScore(b.track) - performanceDigDeeperScore(a.track);
            if (Math.abs(deepDiff) > 0.01) return deepDiff;
          }
          const shuffleDiff = performanceSuggestionShuffleScore(a.track, a.index) - performanceSuggestionShuffleScore(b.track, b.index);
          return shuffleDiff || bScore - aScore || a.index - b.index;
        });
      const spreadLimit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : 16;
      return performanceSpreadSongFamilies(sorted, spreadLimit)
        .map(item => item.track);
    }

    function performanceSoftFeedbackActive() {
      return Boolean(
        performanceHiddenPaths.size
        || performanceRejectedFamilies.size
        || performanceRejectedGenres.size
        || performanceRejectedRoots.size
        || performanceMinYear
        || performanceSafePicks
        || performanceCleanOnly
        || performanceArtistCooldown
        || performanceExcludeKinds.size
      );
    }

    function performanceRecoverEmptySuggestions(rawSuggestions = []) {
      if (performanceAssistPreferences.more_like) return [];
      let recovered = [];
      let relaxed = false;
      const displayLimit = performanceLiveBpmContext().playingBpm ? 28 : 16;
      if (performanceHiddenPaths.size || performanceRejectedGenres.size || performanceRejectedRoots.size) {
        performanceHiddenPaths.clear();
        performanceRejectedGenres.clear();
        performanceRejectedRoots.clear();
        relaxed = true;
        recovered = performanceBalancedBpmSuggestions(rawSuggestions, displayLimit);
      }
      if (!recovered.length && performanceSafePicks) {
        performanceSafePicks = false;
        relaxed = true;
        recovered = performanceBalancedBpmSuggestions(rawSuggestions, displayLimit);
      }
      if (!recovered.length && performanceMinYear) {
        performanceMinYear = 0;
        relaxed = true;
        recovered = performanceBalancedBpmSuggestions(rawSuggestions, displayLimit);
      }
      if (!recovered.length && performanceArtistCooldown) {
        performanceArtistCooldown = false;
        relaxed = true;
        recovered = performanceBalancedBpmSuggestions(rawSuggestions, displayLimit);
      }
      if (!recovered.length && performanceExcludeKinds.size) {
        performanceExcludeKinds.clear();
        relaxed = true;
        recovered = performanceBalancedBpmSuggestions(rawSuggestions, displayLimit);
      }
      if (relaxed && recovered.length) {
        showToast('Refresh recovered Performance suggestions.');
      }
      return recovered;
    }

    async function performanceFetchSuggestions({ reshuffle = false } = {}) {
      const listEl = document.getElementById('performance-suggestions-list');
      if (!performanceAnchorTrack) {
        if (listEl) listEl.innerHTML = '<div class="text-center py-20 text-axiom-muted text-[10px] font-black uppercase tracking-widest">Set a current track to start live suggestions.</div>';
        renderPerformanceRefines();
        renderPerformanceLaneSummary();
        return false;
      }
      currentAnchorTrack = performanceAnchorTrack;
      const liveAnchor = performanceAnchorTrack.live_provider
        || ['djay_live', 'serato_live'].includes(performanceAnchorTrack.connected_from);
      if (liveAnchor && !performanceLiveBpmContext().sourceBpm) {
        ++performanceSuggestionRequestId;
        performanceSuggestionAbortController?.abort();
        performanceSuggestionAbortController = null;
        performanceSuggestions = [];
        if (listEl) listEl.setAttribute('aria-busy', 'false');
        renderPerformanceSuggestions(0);
        return false;
      }
      if (reshuffle) performanceSuggestionShuffleSeed += 1;
      const requestId = ++performanceSuggestionRequestId;
      if (performanceSuggestionAbortController) performanceSuggestionAbortController.abort();
      const suggestionController = new AbortController();
      performanceSuggestionAbortController = suggestionController;
      const suggestionTimeout = setTimeout(() => suggestionController.abort(), 75000);
      // Remove the old tempo lane immediately, including during slow/failed
      // requests. A deck tempo change must never leave stale picks on screen.
      const allowedPaths = new Set(performanceFilteredSuggestions(performanceSuggestions, { limit: Math.max(28, performanceSuggestions.length) }).map(performanceTrackKey));
      const previousSuggestions = performanceSuggestions.filter(track => allowedPaths.has(performanceTrackKey(track)));
      const removedSuggestions = previousSuggestions.length !== performanceSuggestions.length;
      performanceSuggestions = previousSuggestions;
      if (removedSuggestions) renderPerformanceSuggestions(previousSuggestions.length);
      // Stable inputs keep the same recommendation order, including automatic
      // tempo refreshes and retries. A poll is not a request to shuffle picks.
      if (listEl) {
        listEl.setAttribute('aria-busy', 'true');
        if (!listEl.querySelector('.performance-suggestion-card, .spinner')) {
          listEl.innerHTML = '<div class="spinner border-axiom-accent w-6 h-6 mx-auto mt-10"></div>';
        }
      }
      const modifiers = {};
      if (performanceEnergyIntent === 'up') modifiers.mood_lift = true;
      if (performanceEnergyIntent === 'down') modifiers.mood_drop = true;
      if (performanceTempoIntent === 'double') modifiers.bpm_double = true;
      if (performanceTempoIntent === 'half') modifiers.bpm_half = true;
      modifiers.bpm_window = 5;
      const suggestionAnchor = performanceSuggestionAnchorPayload();
      const bpmContext = performanceLiveBpmContext();
      const profileSelection = performanceGigProfileSelectionKey();
      performanceSuggestionTempo = {
        key: performanceTrackKey(performanceAnchorTrack),
        targetBpm: Number(bpmContext.targetBpm || 0),
      };
      performanceLiveTempoPending = null;
      try {
        // One published result includes both usual picks and the selected DJ
        // playlists. Slow playlist reads must not cause a second list swap.
        const [resp] = await Promise.all([fetch('/api/studio/suggestions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            live_assist: true,
            anchor: suggestionAnchor,
            modifiers,
            set_brief: setBriefRuntimePayload(),
            limit: bpmContext.playingBpm ? 120 : 80,
            offset: 0,
            era: 'All',
            year_mode: performanceYearMode,
            assist_preferences: performanceAssistPreferences,
            relaxed: performanceAnchorTrack.connected_from === 'serato_live'
              || performanceAnchorTrack.connected_from === 'djay_live'
              || Boolean(performanceAnchorTrack.live_provider),
            blacklist: [...performancePlayedBlacklist(),
              ...(typeof performanceHiddenPaths !== 'undefined' ? performanceHiddenPaths : []),
              ...(typeof performanceRejectedFamilies !== 'undefined' ? performanceRejectedFamilies : [])]
          }),
          signal: suggestionController.signal,
        }), performanceGigProfileEnabled ? refreshPerformanceGigProfileTrackCache() : Promise.resolve([])]);
        const data = await resp.json();
        if (requestId !== performanceSuggestionRequestId) return true;
        if (profileSelection !== performanceGigProfileSelectionKey()) return performanceFetchSuggestions();
        const rawSuggestions = [...(data.suggestions || []), ...(performanceAssistPreferences.more_like ? data.root_suggestions || [] : [])];
        const displayLimit = bpmContext.playingBpm ? 28 : 16;
        performanceSuggestions = performanceBlendGigProfileSuggestions(rawSuggestions, displayLimit);
        if (!performanceGigProfileOnlySelected && !performanceSuggestions.length && rawSuggestions.length && performanceSoftFeedbackActive()) {
          performanceSuggestions = performanceRecoverEmptySuggestions(rawSuggestions);
        }
        if (!performanceGigProfileOnlySelected && !performanceSuggestions.length && previousSuggestions.length && !performanceTempoIntent) {
          performanceSuggestions = performanceFilteredSuggestions(previousSuggestions, { limit: displayLimit });
          showToast('Refreshing the current Performance pool.');
        }
        if (
          performanceSelectedSuggestionPath
          && !performanceSuggestions.some(track => String(track.path || '') === performanceSelectedSuggestionPath)
        ) {
          performanceSelectedSuggestionPath = '';
        }
        renderPerformanceSuggestions(data.total || performanceSuggestions.length);
        return true;
      } catch (err) {
        if (requestId !== performanceSuggestionRequestId) return true;
        performanceSuggestions = previousSuggestions;
        if (previousSuggestions.length) {
          renderPerformanceSuggestions(previousSuggestions.length);
        } else if (listEl) {
          listEl.innerHTML = '<p class="text-red-500 font-bold text-center mt-10 text-xs uppercase">Performance suggestions could not load</p>';
        }
        console.error('Performance suggestions failed:', err);
        return false;
      } finally {
        clearTimeout(suggestionTimeout);
        if (listEl && requestId === performanceSuggestionRequestId) listEl.setAttribute('aria-busy', 'false');
        if (performanceSuggestionAbortController === suggestionController) {
          performanceSuggestionAbortController = null;
        }
      }
    }

    function renderPerformanceNow() {
      const target = document.getElementById('performance-now-card');
      if (!target) return;
      const correctionValue = document.getElementById('performance-time-correction-value');
      const currentBpm = Number(performanceAnchorTrack?.bpm || performanceAnchorTrack?.serato_bpm || 0);
      if (correctionValue) correctionValue.textContent = currentBpm > 0 ? `Current track: BPM ${currentBpm.toFixed(1)}` : 'Current track: BPM --';
      renderPerformanceCoach();
      performanceRenderSourceWaveform(performanceAnchorTrack);
      target.classList.remove('provider-axiom', 'provider-djay', 'provider-serato');
      if (!performanceAnchorTrack) {
        const htmlStr = `
          <div class="artwork-fallback" style="--art-a:#172512;--art-b:#050907;">PH</div>
          <div>
            <p class="performance-track-title">Choose a current track</p>
            <p class="text-[11px] text-axiom-muted font-bold mt-2 leading-relaxed">Preview a track in Library or Studio, then click Use Playing Track.</p>
          </div>
        `;
        if (target.innerHTML !== htmlStr) target.innerHTML = htmlStr;
        return;
      }
      const track = normalizeModalTrackMetadata(performanceAnchorTrack);
      const providerTone = performanceNowPlayingColourTone(track);
      if (providerTone) target.classList.add(`provider-${providerTone}`);
      const root = performanceTrackRoot(track);
      const deckBpm = Number(track.playing_bpm || track.serato_playing_bpm || 0);
      const chips = [
        deckBpm ? `${deckBpm.toFixed(1)} BPM · Deck` : (track.bpm ? `${parseFloat(track.bpm).toFixed(1)} BPM` : 'BPM --'),
        track.camelot || 'Key --',
        track.energy || modalTrackEnergy(track),
        root,
        formatTrackYear(track),
        !deckBpm && track.bpm_source === 'serato_live_history' ? 'Serato BPM' : '',
        !deckBpm && track.bpm_source === 'djay_live_analysis' ? 'djay Pro stored BPM' : '',
        track.connected_from === 'serato_live' ? `Serato${track.deck ? ` Deck ${track.deck}` : ''}` : '',
        track.connected_from === 'djay_live' ? 'djay Pro Live' : ''
      ].filter(Boolean);
      const htmlStr = `
        ${renderTrackArtwork(track, 'library-artwork recommendation-artwork', '')}
        <div class="min-w-0">
          <p class="performance-track-title">${escapeHtml(track.title || 'Unknown Title')}</p>
          <p class="text-[12px] text-axiom-muted font-black uppercase tracking-widest mt-2">${escapeHtml(track.artist || 'Unknown Artist')}</p>
          <div class="performance-meta-line">
            ${chips.map(chip => `<span class="performance-meta-chip">${escapeHtml(chip)}</span>`).join('')}
          </div>
        </div>
      `;
      if (target.innerHTML !== htmlStr) target.innerHTML = htmlStr;
    }

    async function performanceCorrectCurrentBpm(action = '') {
      const track = performanceAnchorTrack || performanceSeratoLastTrack;
      if (!track?.path || !['half', 'double'].includes(action)) return showToast('Choose or play a current track first.', true);
      const current = Number(track.bpm || track.serato_bpm || 0), factor = action === 'half' ? 0.5 : 2;
      const next = Math.round(current * factor * 10) / 10;
      if (!Number.isFinite(current) || current <= 0) return showToast('The current track has no BPM to correct. Set it in Library first.', true);
      if (next < 20 || next > 300) return showToast('That correction would put the track outside AXIOM’s supported 20–300 BPM range.', true);
      try {
        const response = await fetch('/api/library/update_bpm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: track.path, bpm: next }) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) throw new Error(data.error || 'Current track BPM could not be corrected.');
        const updated = normalizeModalTrackMetadata(data.track || { ...track, bpm: next });
        performanceAnchorTrack = updated; performanceSeratoLastTrack = { ...performanceSeratoLastTrack, ...updated }; currentAnchorTrack = updated;
        cacheTrackVisual(updated); propagateTrackMetadata(track.path, { bpm: next, energy: updated.energy || '' }, updated);
        renderPerformanceNow(); renderPerformanceSignals(); await performanceFetchSuggestions();
        showToast(`Current track BPM corrected to ${next} inside AXIOM. DJ software playback was not changed.`);
      } catch (error) { showToast(error.message || 'Current track BPM could not be corrected.', true); }
    }

    function renderPerformanceCuedNext() {
      const target = document.getElementById('performance-cued-next');
      if (!target) return;
      if (!performanceCuedTrack) {
        target.classList.remove('has-cue');
        target.hidden = true;
        if (target.innerHTML) target.innerHTML = '';
        return;
      }
      target.hidden = false;
      target.classList.add('has-cue');
      const track = normalizeModalTrackMetadata(performanceCuedTrack);
      const safePath = escapeJs(track.path || '');
      const safeTitle = escapeJs(track.title || '');
      const safeArtist = escapeJs(track.artist || '');
      const safeCamelot = escapeJs(track.camelot || '');
      const safeEnergy = escapeJs(track.energy || '');
      const safeGenre = escapeJs(track.genre || '');
      const playCall = `event.stopPropagation(); playAudioFile('${safePath}', '${safeTitle}', '${safeArtist}', ${track.bpm || 0}, '${safeCamelot}', '${safeEnergy}', event, '${safeGenre}');`;
      const htmlStr = `
        <p class="text-[9px] font-black uppercase tracking-[0.18em] text-cyan-200 mb-3">Cued Next</p>
        <div class="performance-cued-card">
          ${renderTrackArtwork(track, 'library-artwork recommendation-artwork', playCall)}
          <div class="min-w-0">
            <p class="performance-suggestion-title text-[13px] truncate">${escapeHtml(track.title || 'Unknown Title')}</p>
            <p class="text-[10px] text-axiom-muted font-black uppercase tracking-widest truncate mt-1">${escapeHtml(track.artist || 'Unknown Artist')}</p>
            <div class="performance-suggestion-actions">
              <button class="performance-mini-btn" onclick="performancePreviewSuggestion('${safePath}')" type="button">Preview</button>
              <button class="performance-mini-btn" onclick="performancePlayCuedTrack()" type="button">Play</button>
              <button class="performance-mini-btn" onclick="performanceClearCue()" type="button">Clear</button>
            </div>
          </div>
        </div>
      `;
      if (target.innerHTML !== htmlStr) target.innerHTML = htmlStr;
    }

    function renderPerformanceSignals() {
      const energyEl = document.getElementById('performance-signal-energy');
      const rootEl = document.getElementById('performance-signal-root');
      const eraEl = document.getElementById('performance-signal-era');
      const bpmEl = document.getElementById('performance-signal-bpm');
      const bpmDetailEl = document.getElementById('performance-signal-bpm-detail');
      const bpmInput = document.getElementById('performance-playing-bpm-input');
      const feedbackEl = document.getElementById('performance-signal-feedback');
      const anchor = normalizeModalTrackMetadata(performanceAnchorTrack || {});
      const bpmContext = performanceLiveBpmContext();
      const energyLabel = performanceEnergyIntent === 'up'
        ? 'Pushing Up'
        : performanceEnergyIntent === 'down'
          ? 'Pulling Down'
          : performanceTempoIntent === 'double'
            ? 'Double Time'
            : performanceTempoIntent === 'half'
              ? 'Half Time'
              : (anchor.energy || modalTrackEnergy(anchor) || 'Steady');
      const preferredRoot = [...performancePreferredRoots][0] || '';
      const rootLabel = performanceLaneLock
        ? `Lock ${performanceLaneLabel()}`
        : (preferredRoot || performanceTrackRoot(anchor) || 'Open');
      const eraLabel = performanceMinYear
        ? `${performanceMinYear}+`
        : (performanceTrackYear(anchor) || 'Open');
      const feedbackTotal = performanceFeedbackCounts.choices
        + performanceFeedbackCounts.liked
        + performanceFeedbackCounts.hidden
        + performanceFeedbackCounts.tooOld
        + performanceFeedbackCounts.wrongGenre
        + performanceFeedbackCounts.energyUp
        + performanceFeedbackCounts.energyDown
        + performanceFeedbackCounts.doubleTime
        + performanceFeedbackCounts.halfTime
        + performanceFeedbackCounts.laneLock
        + performanceFeedbackCounts.rescue
        + performanceFeedbackCounts.excludes
        + performanceFeedbackCounts.notes;
      const feedbackLabel = feedbackTotal
        ? `${feedbackTotal} Signal${feedbackTotal === 1 ? '' : 's'}`
        : 'Clean';
      if (energyEl) energyEl.textContent = energyLabel;
      if (rootEl) rootEl.textContent = rootLabel;
      if (eraEl) eraEl.textContent = eraLabel;
      if (bpmEl) bpmEl.textContent = bpmContext.sourceBpm ? performanceBpmDisplay(bpmContext.sourceBpm) : '--';
      if (bpmDetailEl) {
        const targetCopy = bpmContext.targetBpm && bpmContext.targetBpm !== bpmContext.sourceBpm
          ? ` -> ${performanceBpmDisplay(bpmContext.targetBpm)}`
          : '';
        const nativeCopy = bpmContext.nativeBpm && bpmContext.playingBpm
          ? ` · native ${performanceBpmDisplay(bpmContext.nativeBpm)}`
          : '';
        bpmDetailEl.textContent = bpmContext.sourceBpm
          ? `${bpmContext.sourceLabel}${targetCopy}${nativeCopy} · ${bpmContext.laneLabel}`
          : 'Waiting for live tempo';
      }
      if (bpmInput && document.activeElement !== bpmInput) {
        performancePlayingBpmDraft = performancePlayingBpmOverride ? performanceBpmDisplay(performancePlayingBpmOverride) : '';
        bpmInput.value = performancePlayingBpmDraft;
        const automaticBpm = bpmContext.liveBpm || bpmContext.nativeBpm;
        bpmInput.placeholder = automaticBpm ? `Auto ${performanceBpmDisplay(automaticBpm)}` : 'Auto';
      }
      if (feedbackEl) feedbackEl.textContent = feedbackLabel;
    }

    function renderPerformanceRefines() {
      const summary = document.getElementById('performance-refine-summary');
      const status = document.getElementById('performance-results-status');
      const active = [];
      if (performanceEnergyIntent === 'up') active.push('more energy');
      if (performanceEnergyIntent === 'down') active.push('less energy');
      if (performanceTempoIntent === 'double') active.push('double time lane');
      if (performanceTempoIntent === 'half') active.push('half time lane');
      if (performanceLaneLock) active.push(`lock ${performanceLaneLabel().toLowerCase()}`);
      if (performanceRescueMode) active.push('rescue');
      if (performanceSafePicks) active.push('safe picks');
      if (performanceCleanOnly) active.push('clean music only');
      if (performanceDigDeeper) active.push('dig deeper');
      if (performanceArtistCooldown) active.push('no artist repeat');
      if (performanceExcludeKinds.has('stingers')) active.push('no stingers');
      if (performanceExcludeKinds.has('tools')) active.push('no tools');
      if (performanceNotes.length) active.push(`${performanceNotes.length} note${performanceNotes.length === 1 ? '' : 's'}`);
      if (performanceMinYear) active.push(`from ${performanceMinYear}+`);
      if (performancePreferredRoots.size) active.push(`${performancePreferredRoots.size} lane liked`);
      if (performancePreferredGenres.size) active.push(`${performancePreferredGenres.size} genre liked`);
      if (performanceGigProfileEnabled) active.push(`gig profile ${currentPerformanceGigProfile()?.name || 'on'}`);
      if (performanceGigProfileEnabled && performanceGigProfileOnlySelected) active.push('only selected playlists');
      if (performanceRejectedGenres.size) active.push(`${performanceRejectedGenres.size} genre removed`);
      if (performanceRejectedRoots.size) active.push(`${performanceRejectedRoots.size} lane removed`);
      if (performanceHiddenPaths.size) active.push(`${performanceHiddenPaths.size} hidden`);
      if (summary) {
        summary.innerHTML = active.length
          ? active.map(item => `<span>${escapeHtml(item)}</span>`).join('')
          : '<span>Listening for your next move</span>';
      }
      document.getElementById('performance-filter-energy-up')?.classList.toggle('active', performanceEnergyIntent === 'up');
      document.getElementById('performance-filter-energy-down')?.classList.toggle('active', performanceEnergyIntent === 'down');
      document.getElementById('performance-filter-double-time')?.classList.toggle('active', performanceTempoIntent === 'double');
      document.getElementById('performance-filter-half-time')?.classList.toggle('active', performanceTempoIntent === 'half');
      ['urban', 'rnb', 'singalong', 'peak'].forEach(lane => {
        document.getElementById(`performance-lock-${lane}`)?.classList.toggle('active', performanceLaneLock === lane);
      });
      document.getElementById('performance-safe-picks')?.classList.toggle('active', performanceSafePicks);
      const cleanOnlyButton = document.getElementById('performance-clean-only');
      cleanOnlyButton?.classList.toggle('active', performanceCleanOnly);
      cleanOnlyButton?.setAttribute('aria-pressed', performanceCleanOnly ? 'true' : 'false');
      document.getElementById('performance-rescue-mode')?.classList.toggle('active', performanceRescueMode);
      document.getElementById('performance-dig-deeper')?.classList.toggle('active', performanceDigDeeper);
      document.getElementById('performance-artist-cooldown')?.classList.toggle('active', performanceArtistCooldown);
      document.getElementById('performance-undo-refine')?.classList.toggle('active', Boolean(performanceRefineHistory.length));
      ['stingers', 'tools'].forEach(kind => {
        document.getElementById(`performance-exclude-${kind}`)?.classList.toggle('active', performanceExcludeKinds.has(kind));
      });
      document.getElementById('performance-filter-newer')?.classList.toggle('active', Boolean(performanceMinYear));
      if (status) {
        const bpmContext = performanceLiveBpmContext();
        const bpmCopy = bpmContext.playingBpm
          ? ` · track ${performanceBpmDisplay(bpmContext.nativeBpm)} / ${bpmContext.appLabel} ${performanceBpmDisplay(bpmContext.playingBpm)}`
          : (bpmContext.sourceBpm ? ` · ${bpmContext.sourceLabel} ${performanceBpmDisplay(bpmContext.sourceBpm)}` : '');
        status.textContent = performanceAnchorTrack
          ? `${performanceSuggestions.length} next move${performanceSuggestions.length === 1 ? '' : 's'} · ${performanceTimeline.length} played${bpmCopy}`
          : 'Set a current track to start live suggestions.';
      }
      renderPerformanceLaneSummary();
      renderPerformanceSignals();
    }

    function renderPerformanceTimeline() {
      const list = document.getElementById('performance-timeline');
      const count = document.getElementById('performance-session-count');
      const toggle = document.getElementById('performance-timeline-toggle');
      if (count) count.textContent = `${performanceTimeline.length} track${performanceTimeline.length === 1 ? '' : 's'} played`;
      if (toggle) {
        const label = toggle.querySelector('span');
        if (label) label.textContent = performanceTimelineCollapsed ? 'Compact' : 'Expanded';
        else toggle.textContent = performanceTimelineCollapsed ? 'Show' : 'Hide';
        toggle.classList.toggle('active', !performanceTimelineCollapsed);
        toggle.setAttribute('aria-pressed', performanceTimelineCollapsed ? 'false' : 'true');
      }
      if (!list) return;
      list.classList.toggle('collapsed', performanceTimelineCollapsed);
      if (!performanceTimeline.length) {
        list.innerHTML = '<p class="text-[10px] text-axiom-muted font-black uppercase tracking-widest">Tracks you mark or choose will build the live set here.</p>';
        return;
      }
      list.innerHTML = performanceTimeline.map((track, index) => {
        const t = normalizeModalTrackMetadata(track);
        return `
          <div class="performance-timeline-item">
            <span class="performance-timeline-index">${index + 1}</span>
            <div class="min-w-0">
              <p class="performance-suggestion-title text-[13px] truncate">${escapeHtml(t.title || 'Unknown Title')}</p>
              <p class="text-[10px] text-axiom-muted font-black uppercase tracking-widest truncate">${escapeHtml(t.artist || 'Unknown Artist')}</p>
            </div>
            <span class="performance-meta-chip">${t.bpm ? parseFloat(t.bpm).toFixed(0) : '--'} BPM</span>
          </div>
        `;
      }).join('');
    }

    function renderPerformanceNotes() {
      const list = document.getElementById('performance-note-list');
      const count = document.getElementById('performance-notes-count');
      const toggle = document.getElementById('performance-notes-toggle');
      const checkbox = document.getElementById('performance-notes-open');
      if (count) count.textContent = `${performanceNotes.length} note${performanceNotes.length === 1 ? '' : 's'}`;
      if (toggle) toggle.textContent = checkbox?.checked ? 'Hide' : 'Show';
      if (!list) return;
      if (!performanceNotes.length) {
        list.innerHTML = '<p class="text-[10px] text-axiom-muted font-black uppercase tracking-widest">Notes you add while performing will stay with this session.</p>';
        return;
      }
      list.innerHTML = performanceNotes.map(note => {
        const track = [note.track_artist, note.track_title].filter(Boolean).join(' - ');
        const time = note.created_at ? new Date(note.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        return `
          <div class="performance-note-item">
            <strong>${escapeHtml(note.label || performanceNoteLabel(note.kind))}</strong>
            <span>${escapeHtml(note.text || '')}</span>
            <span>${escapeHtml([time, track].filter(Boolean).join(' - '))}</span>
          </div>
        `;
      }).join('');
    }

    function renderPerformanceAudit() {
      const panel = document.getElementById('performance-audit');
      const grid = document.getElementById('performance-audit-grid');
      const note = document.getElementById('performance-audit-note');
      const count = document.getElementById('performance-audit-count');
      const toggle = document.getElementById('performance-audit-toggle');
      const checkbox = document.getElementById('performance-audit-open');
      const audit = performanceBuildAudit();
      if (count) count.textContent = audit.count ? `${audit.count} tracks audited` : 'Waiting for set data';
      if (toggle) toggle.textContent = checkbox?.checked ? 'Hide' : 'Show';
      if (!panel || !grid || !note) return;
      if (!audit.count) {
        grid.innerHTML = '';
        note.textContent = 'Performance audit starts once AXIOM sees your Serato session history.';
        return;
      }
      const stats = [
        ['BPM Lane', audit.bpmLabel],
        ['Top Lane', audit.laneLabel],
        ['Main Genre', audit.genreLabel],
        ['Era Range', audit.eraLabel],
        ['Lane Shifts', String(audit.doubleMoves)],
        ['Prep Gaps', String(audit.prepGaps)],
        ['Notes', String(audit.noteCount)]
      ];
      grid.innerHTML = stats.map(([label, value]) => `
        <div class="performance-audit-stat">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `).join('');
      const notes = [];
      if (audit.doubleMoves) notes.push(`${audit.doubleMoves} double/half-time move${audit.doubleMoves === 1 ? '' : 's'} detected.`);
      if (audit.sharpJumps) notes.push(`${audit.sharpJumps} sharp BPM jump${audit.sharpJumps === 1 ? '' : 's'} to review.`);
      if (audit.prepGaps) notes.push(`${audit.prepGaps} metadata gap${audit.prepGaps === 1 ? '' : 's'} found across BPM, key, or year.`);
      if (audit.noteCount) notes.push(`${audit.noteCount} live note${audit.noteCount === 1 ? '' : 's'} saved with this session.`);
      if (!notes.length) notes.push('Clean session shape so far.');
      note.textContent = notes.join(' ');
    }

    function renderPerformanceSuggestions(total = performanceSuggestions.length) {
      const listEl = document.getElementById('performance-suggestions-list');
      if (!listEl) return;
      if (performanceAnchorTrack) currentAnchorTrack = performanceAnchorTrack;
      if (!performanceAnchorTrack) {
        listEl.innerHTML = '<div class="text-center py-20 text-axiom-muted text-[10px] font-black uppercase tracking-widest">No current track selected.</div>';
        renderPerformanceRefines();
        queuePerformanceLiveAssistStateSync(0);
        return;
      }
      const missingLiveTempo = (performanceAnchorTrack.live_provider
        || ['djay_live', 'serato_live'].includes(performanceAnchorTrack.connected_from))
        && !performanceLiveBpmContext().sourceBpm;
      if (missingLiveTempo) performanceSuggestions = [];
      if (!performanceSuggestions.length) {
        const tempoRecovery = performanceTempoIntent || performancePlayingBpmOverride
          ? '<button type="button" onclick="performanceResetTempoBaseline()" class="performance-action secondary mt-5">Return To Current BPM</button>'
          : '';
        const emptyCopy = missingLiveTempo
          ? 'Waiting for the current track tempo. Suggestions will resume automatically.'
          : performanceCleanOnly
          ? 'No positively marked Clean or Radio-safe tracks fit this move. Clean Music Only remains on.'
          : performanceGigProfileEnabled && performanceGigProfileOnlySelected
            ? 'No selected-playlist tracks fit this live move. Adjust Live Crates, BPM, or a refine control.'
            : 'No matching next moves. Clear a filter or choose another current track.';
        const htmlStr = `<div class="text-center py-20 text-axiom-muted text-[10px] font-black uppercase tracking-widest">${emptyCopy}<div>${tempoRecovery}</div></div>`;
        if (listEl.innerHTML !== htmlStr) listEl.innerHTML = htmlStr;
        renderPerformanceRefines();
        renderPerformanceLaneSummary();
        queuePerformanceLiveAssistStateSync(0);
        return;
      }
      const sections = performanceSuggestionSections(performanceSuggestions);
      let globalIndex = 0;
      const renderSuggestionCard = (track, index) => {
        const s = normalizeModalTrackMetadata(track);
        cacheTrackVisual(s);
        const safePath = escapeJs(s.path);
        const safeTitle = escapeJs(s.title || '');
        const safeArtist = escapeJs(s.artist || '');
        const safeCamelot = escapeJs(s.camelot || '');
        const safeEnergy = escapeJs(s.energy || '');
        const safeGenre = escapeJs(s.genre || '');
        const playCall = `event.stopPropagation(); playAudioFile('${safePath}', '${safeTitle}', '${safeArtist}', ${s.bpm || 0}, '${safeCamelot}', '${safeEnergy}', event, '${safeGenre}');`;
        const match = modalSuggestionMatch(s);
        const decision = performanceSuggestionDecisionCopy(s, match);
        const root = performanceTrackRoot(s);
        const year = performanceTrackYear(s);
        const isCued = performanceCuedTrack && performanceTrackKey(s) === performanceTrackKey(performanceCuedTrack);
        const isSelected = performanceSelectedSuggestionPath === String(s.path || '');
        const gigProfileProviders = performanceTrackGigProfileProviders(s);
        const gigProfileTone = performanceTrackGigProfileTone(s) || performanceTrackProviderTone(s);
        const gigProfileChips = gigProfileProviders.map(provider => provider === 'djay' ? 'djay Pro Playlist' : 'Serato Crate');
        const chips = [
          ...gigProfileChips,
          performanceLaneLock && performanceTrackMatchesLane(s, performanceLaneLock) ? `${performanceLaneLabel()} Lock` : '',
          s.bpm ? `${Math.round(parseFloat(s.bpm))} BPM` : 'BPM --',
          s.camelot || 'Key --',
          root,
          AXIOMLiveAssistSimilarity.displayPlacement(s)
        ].filter(Boolean);
        const gigProfileClass = performanceGigProfileColorsEnabled && gigProfileTone ? ` gig-${gigProfileTone}` : '';
        const priorityClass = `${index === 0 ? ' is-priority' : ''}${isCued ? ' is-cued' : ''}${isSelected ? ' is-selected' : ''}${gigProfileClass}`;
        return `
          <div class="performance-suggestion-card${priorityClass}" data-path="${escapeHtml(s.path)}" onclick="performanceSelectSuggestion(event, '${safePath}')">
            <span class="performance-desk-rank">${isCued ? 'Hold' : index + 1}</span>
            ${renderTrackArtwork(s, 'library-artwork recommendation-artwork', playCall)}
            <div class="min-w-0 performance-desk-title">
              <p class="performance-rank">${isCued ? 'CUED' : (index === 0 ? 'NEXT' : String(index + 1).padStart(2, '0'))}</p>
              <p class="performance-suggestion-title text-[15px]">${escapeHtml(s.title || 'Unknown Title')}</p>
              <p class="text-[10px] text-axiom-muted font-black uppercase tracking-widest mt-1">${escapeHtml(s.artist || 'Unknown Artist')}</p>
              <div class="performance-meta-line">
                <span class="performance-meta-chip">${escapeHtml(match.label)}</span>
                ${isSelected ? `<button class="performance-row-reject" type="button" title="Reject this song for this session" aria-label="Reject ${escapeHtml(s.title || 'this song')}" onclick="event.stopPropagation(); performanceRejectSuggestion('${safePath}', 'hide')">&times;</button>` : ''}
                ${chips.map(chip => `<span class="performance-meta-chip">${escapeHtml(chip)}</span>`).join('')}
              </div>
              ${renderPerformanceBpmReadout(s)}
              <div class="performance-decision-line">
                <strong>${escapeHtml(decision.headline)}</strong>
                <span>${escapeHtml(decision.detail)}</span>
              </div>
              ${renderPerformanceCue(s, match)}
              ${renderTrackRoleEvidence(s)}
              <div class="performance-suggestion-actions">
                <button class="performance-mini-btn" onclick="performancePreviewSuggestion('${safePath}')" type="button">Test Preview</button>
                <button class="performance-mini-btn" onclick="performanceRejectSuggestion('${safePath}', 'old')" type="button">Too Old</button>
                <button class="performance-mini-btn" onclick="performanceRejectSuggestion('${safePath}', 'genre')" type="button">Wrong Genre</button>
                <button class="performance-mini-btn" onclick="performanceMoreLikeThis('${safePath}')" type="button">More Like This</button>
                <button class="performance-mini-btn" onclick="performanceRejectSuggestion('${safePath}', 'hide')" type="button">Hide</button>
              </div>
            </div>
            <div class="performance-desk-metadata">
              <span>${s.bpm ? Math.round(parseFloat(s.bpm)) : '—'}</span>
              <span class="performance-desk-key">${escapeHtml(s.camelot || '—')}</span>
              <span>${escapeHtml(String(year || '—'))}</span>
              <span class="performance-desk-fit">${escapeHtml(match.label)}</span>
            </div>
            <div class="performance-pick-stack">
              <button class="performance-pick-btn secondary" onclick="performanceCueSuggestion('${safePath}')" type="button">${isCued ? 'Holding' : 'Hold'}</button>
              <button class="performance-pick-btn" onclick="performanceChooseSuggestion('${safePath}')" type="button">Use Next</button>
            </div>
          </div>
        `;
      };
      const htmlStr = '<div class="performance-desk-table-head" aria-hidden="true"><span>#</span><span>Track</span><div><span>BPM</span><span>Key</span><span>Year</span><span>Fit</span></div><span>Next move</span></div>' + sections.map(section => {
        const heading = section.label
          ? `<div class="performance-section-heading">${escapeHtml(section.label)} · ${section.items.length.toLocaleString()}</div>`
          : '';
        const cards = section.items.map(track => renderSuggestionCard(track, globalIndex++)).join('');
        return `${heading}${cards}`;
      }).join('');
      if (listEl.innerHTML !== htmlStr) listEl.innerHTML = htmlStr;
      renderPerformanceRefines();
      renderPerformanceLaneSummary();
      queuePerformanceLiveAssistStateSync(total);
    }

    function renderPerformanceMode() {
      performanceBindPanelToggles();
      renderPerformanceCommandDeck();
      renderPerformanceGigProfileControl();
      renderPerformanceNow();
      renderPerformanceCuedNext();
      renderPerformanceSignals();
      renderPerformanceTimeline();
      renderPerformanceNotes();
      renderPerformanceAudit();
      renderPerformanceSuggestions();
      renderPerformanceRefines();
      renderPerformanceCoach();
      renderPerformanceSessionReceipt();
    }

    function renderPerformanceCommandDeck() {
      const shell = document.getElementById('tab-content-performance');
      const providerPill = document.getElementById('performance-command-provider');
      if (!shell) return;
      const anchor = normalizeModalTrackMetadata(performanceAnchorTrack || {});
      const liveProvider = (typeof performanceLiveProvider !== 'undefined' && performanceLiveProvider) ? performanceLiveProvider : '';
      const providerTone = performanceNowPlayingColourTone(anchor)
        || (liveProvider === 'djay' ? 'djay' : '')
        || (liveProvider === 'serato' ? 'serato' : '');
      shell.classList.toggle('provider-djay', providerTone === 'djay');
      shell.classList.toggle('provider-serato', providerTone === 'serato');
      if (providerPill) {
        providerPill.textContent = providerTone === 'djay'
          ? 'djay Pro Connected'
          : providerTone === 'serato'
            ? 'Serato Connected'
            : 'AXIOM Ready';
      }
    }

    Object.assign(window, {
      __AXIOM_PERFORMANCE_NATIVE_TICK: performanceNativeLiveAssistTick,
      __AXIOM_PERFORMANCE_NATIVE_REFRESH: performanceNativeLiveAssistRefresh,
      performanceUsePlayingTrack,
      performanceSaveSession,
      openPerformanceSessionReceipt,
      closePerformanceSessionReceipt,
      performanceSetReceiptTab,
      performanceViewReceiptTracklist,
      performanceSendToStudio,
      performanceMarkCurrentPlayed,
      performanceChooseSuggestion,
      performanceCueSuggestion,
      performanceClearCue,
      performancePlayCuedTrack,
      performancePreviewSuggestion,
      performanceSetEnergyIntent,
      performanceSetTempoIntent,
      performanceCorrectCurrentBpm,
      performanceSetLaneLock,
      performanceUndoRefine,
      performanceToggleRescueMode,
      performanceToggleSafePicks,
      performanceToggleDigDeeper,
      performanceToggleArtistCooldown,
      performanceToggleExclude,
      performancePreferNewer,
      performanceRejectSuggestion,
      performanceMoreLikeThis,
      performanceMoreThisEra,
      performanceMoreThisGenre,
      performanceSelectSuggestion,
      performanceClearRefines,
      performanceResetSession,
      performanceToggleTimeline,
      performanceToggleAudit,
      performanceAddNote,
      performanceAddTypedNote,
      renderPerformanceNotes,
      performanceToggleSeratoBridge,
      performancePollSeratoBridge,
      performanceFetchSuggestions,
      performanceToggleGigProfile,
      performanceToggleCoach,
      performanceSelectGigProfile,
      openPerformanceGigProfileManager,
      closePerformanceGigProfileManager,
      filterPerformanceDjProfileSources,
      performanceBulkSelectDjProfileSources,
      refreshPerformanceGigProfileManagerSources,
      savePerformanceGigProfile,
      deletePerformanceGigProfile,
      renderPerformanceMode
    });
