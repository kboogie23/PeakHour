    function updateGraphTimeline() {
      const setLen = parseInt(document.getElementById('set-length-selector').value || 120);
      const avgDur = parseInt(document.getElementById('avg-duration-selector').value || 2);
      document.getElementById('est-track-count').innerText = Math.round(setLen / avgDur);
      for (let index = 0; index < 5; index++) {
        const start = Math.round((setLen / 5) * index);
        const end = Math.round((setLen / 5) * (index + 1));
        const label = document.getElementById(`magic-phase-time-${index}`);
        if (label) label.textContent = `${start} - ${end} min`;
      }
      if (bpmChartInstance && bpmChartInstance.options.scales.x) {
        bpmChartInstance.options.scales.x.max = setLen;
        bpmChartInstance.options.scales.x.ticks.stepSize = Math.max(6, Math.round(setLen / 5));
        const trackPoints = currentPlaylist.map((t, i) => ({ x: i * avgDur, y: t.bpm || 0 }));
        bpmChartInstance.data.datasets[0].data = trackPoints;
        if (graphModeOpen && graphAnchorIndex < 0) syncGraphReadonlyDots();
        bpmChartInstance.update();
      }
      renderMagicSetJourney();
    }

    async function handleMagicSetTimelineControlChange() {
      updateGraphTimeline();
      if (axiomReviewMode() !== 'magic-set') return;
      const hasReviewJourney = currentPlaylist.some(track => String(track?.path || '').startsWith('preview://magic-set-'));
      if (!hasReviewJourney) return;
      await populateMagicSetReviewFixture(magicSetReviewBuildMode);
    }

    function applyBpmBlueprint() {
        const startBpm = parseFloat(document.getElementById('blueprint-start-bpm').value);
        const endBpm = parseFloat(document.getElementById('blueprint-end-bpm').value);
        const setLen = parseInt(document.getElementById('set-length-selector').value || 120);

        // Always ensure we have points at the start and end
        graphDots = [
            { x: 0, y: startBpm },
            { x: setLen, y: endBpm }
        ];

        bpmChartInstance.data.datasets[1].data = graphDots;
        recalcBpmYAxis();
        renderMagicSetJourney();
    }

    function addBlueprintSegment() {
        const setLen = parseInt(document.getElementById('set-length-selector').value || 120);
        const startBpm = parseFloat(document.getElementById('blueprint-start-bpm').value);
        const endBpm = parseFloat(document.getElementById('blueprint-end-bpm').value);

        // Add a point in the middle
        const midTime = Math.round(setLen / 2);
        const midBpm = Math.round((startBpm + endBpm) / 2);

        graphDots.push({ x: midTime, y: midBpm });
        graphDots.sort((a,b) => a.x - b.x);

        bpmChartInstance.data.datasets[1].data = graphDots;
        recalcBpmYAxis();
        renderMagicSetJourney();
    }

    function clearBlueprint() {
        if (axiomReviewMode() === 'magic-set') {
            currentPlaylist = [];
            currentRoutePlaylist = [];
            graphDots = [];
            anchorTargetDot = null;
            graphAnchorIndex = -1;
            magicSetStudioCtaReady = false;
            if (bpmChartInstance) {
                bpmChartInstance.data.datasets[0].data = [];
                bpmChartInstance.data.datasets[1].data = [];
                bpmChartInstance.data.datasets[2].data = [];
                recalcBpmYAxis();
            }
            renderPlaylist();
            updateMagicSetScoreCard(0);
            updateMagicSetStudioCta();
            recalculateAudit();
            return;
        }
        graphDots = [];
        bpmChartInstance.data.datasets[1].data = graphDots;
        recalcBpmYAxis();
        renderMagicSetJourney();
    }

    function recalcBpmYAxis() {
      if (!bpmChartInstance) return;
      let yMin, yMax;
      const actualTrackDots = Array.isArray(bpmChartInstance.data?.datasets?.[0]?.data)
        ? bpmChartInstance.data.datasets[0].data
        : [];
      const allDots = [...actualTrackDots, ...graphDots, ...(anchorTargetDot ? [anchorTargetDot] : [])];
      const defaultMin = 70;
      const defaultMax = 140;

      // The approved Magic Set review uses a fixed DJ-readable scale so the
      // half-time flip is easy to compare at every supported window size.
      if (axiomReviewMode() === 'magic-set') {
        yMin = 60;
        yMax = 145;
        bpmChartInstance.options.scales.y.ticks.stepSize = 10;
        bpmChartInstance.options.scales.y.ticks.callback = value => value <= 140 ? value : '';
      // Keep the working DJ range visible by default, then expand only when points need it.
      } else if (allDots.length === 0) {
        yMin = defaultMin; yMax = defaultMax;
      } else {
        const bpms = allDots.map(d => d.y);
        const actualMin = Math.min(...bpms);
        const actualMax = Math.max(...bpms);

        // Preserve 70-140 as the main visual lane while allowing outliers.
        yMin = Math.max(50, Math.min(defaultMin, actualMin - 8));
        yMax = Math.min(220, Math.max(defaultMax, actualMax + 8));

        // Ensure enough breathing room for drawing and dragging.
        if (yMax - yMin < 70) {
            const center = (yMax + yMin) / 2;
            yMin = Math.max(50, center - 35);
            yMax = Math.min(220, center + 35);
        }
      }
      bpmChartInstance.options.scales.y.min = yMin;
      bpmChartInstance.options.scales.y.max = yMax;
      bpmChartInstance.update();
      renderMagicSetJourney();
    }

    async function buildMagicSetAroundWorkingTracks() {
      if (!(await ensureAxiomLicenseUsable('Build Around These Tracks'))) return;
      if (axiomReviewMode() === 'magic-set') {
        await populateMagicSetReviewFixture('around');
        showToast('Built a complete Magic Set around the Working Set tracks.');
        return;
      }
      const seeds = getActiveStudioOutputTracks();
      if (seeds.length < 1) {
        showToast('Add at least 1 track to the Working Set first.', true);
        return;
      }
      if (buildMagicSetAroundWorkingTracks.busy) return;
      if (graphDots.length < 2) applyBpmBlueprint();
      const bpmPoints = [...graphDots]
        .map(point => ({
          time_min: Number(point.x || 0),
          bpm: Number(point.y || 0),
          tempo_flip: String(point.tempoFlipFromPrevious || '')
        }))
        .filter(point => point.bpm > 0)
        .sort((a, b) => a.time_min - b.time_min);
      const setLen = parseInt(document.getElementById('set-length-selector')?.value || 120, 10);
      const avgDur = Math.max(0.5, parseFloat(document.getElementById('avg-duration-selector')?.value || 2));
      const targetCount = Math.max(seeds.length, Math.min(100, Math.round(setLen / avgDur)));
      const stillCurrent = studioGenerationGuard();
      const btn = document.getElementById('btn-build-around-tracks');
      buildMagicSetAroundWorkingTracks.busy = true;
      setAxiomButtonBusy(btn, true, 'Reading Collective Vibe...');
      showToast(`Reading ${seeds.length} Working Set tracks, then sequencing the result against your BPM markers...`);
      try {
        const resp = await fetch('/api/studio/build_around_tracks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            seed_tracks: seeds,
            target_count: targetCount,
            avg_duration: avgDur,
            bpm_points: bpmPoints,
            max_bpm_step: getMagicBpmStepLimit(),
            set_brief: setBriefRuntimePayload()
          })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.success === false) {
          throw new Error(data.error || data.message || 'AXIOM could not build around these tracks.');
        }
        if (!stillCurrent()) return;
        saveHistory();
        currentPlaylist = dedupePlaylistTracks(data.playlist || seeds);
        currentRoutePlaylist = [];
        renderPlaylist();
        initSortable();
        syncEditingPlaylistIfNeeded();
        markMagicSetReady();
        await recalculateAudit();
        showStudioTrackAddedPulse({ title: `${Number(data.added_count || 0)} Magic Set tracks` }, currentPlaylist.length, currentPlaylist);
        showToast(data.message || `Kept ${seeds.length} tracks and built around their collective sound.`);
      } catch (error) {
        showToast(error.message || 'Build Around These Tracks paused.', true);
      } finally {
        buildMagicSetAroundWorkingTracks.busy = false;
        setAxiomButtonBusy(btn, false);
        updateStudioToolsAvailability();
      }
    }

    async function generateMagicSetFromParameters() {
      if (axiomReviewMode() === 'magic-set') {
        await populateMagicSetReviewFixture('magic');
        showToast('Magic Set populated and ready to review.');
        return;
      }
      if (getActiveStudioOutputTracks().length > 0) {
        showToast('Keeping your Working Set tracks and building the Magic Set around them...');
        await buildMagicSetAroundWorkingTracks();
        return;
      }
      if (graphDots.length < 2) applyBpmBlueprint();
      await fillSetFromBPMPoints();
    }

    function updateAnchorBtnVisibility() {
      const btn = document.getElementById('btn-generate-from-anchor');
      if (!btn) return;
      if (anchorTargetDot && graphAnchorIndex >= 0 && graphDots.length === 1) {
        btn.classList.remove('hidden');
      } else {
        btn.classList.add('hidden');
      }
    }

    function syncEditingPlaylistIfNeeded() {
      if (!editingPlaylistId) return;
      const set = savedPlaylists.find(item => item.id === editingPlaylistId);
      if (!set) return;
      set.tracks = dedupePlaylistTracks(JSON.parse(JSON.stringify(currentPlaylist || [])));
      set.setBrief = setBriefPayload();
      set.updatedAt = new Date().toISOString();
      persistSavedPlaylists();
      if (selectedPlaylistId === editingPlaylistId) refreshPlaylistsView();
    }

    function studioGenerationGuard() {
      const working = currentPlaylist, route = currentRoutePlaylist;
      const state = () => JSON.stringify({working: currentPlaylist, route: currentRoutePlaylist,
        editing: editingPlaylistId, view: activeStudioView, dots: graphDots,
        anchor: anchorTargetDot, anchorIndex: graphAnchorIndex, brief: setBriefRuntimePayload(),
        duration: document.getElementById('avg-duration-selector')?.value,
        length: document.getElementById('set-length-selector')?.value, bpmStep: getMagicBpmStepLimit()});
      const requested = state();
      return () => {
        if (currentPlaylist === working && currentRoutePlaylist === route && requested === state()) return true;
        showToast('Your set or setup changed while Magic Set was building. Your edits were kept; build again to use them.');
        return false;
      };
    }

    async function autoFillSegment() {
      if (autoFillSegment.busy) return;
      if (graphDots.length < 2) return;
      const segStart = graphDots[graphDots.length - 2];
      const segEnd   = graphDots[graphDots.length - 1];
      const avgDur   = parseFloat(document.getElementById('avg-duration-selector').value);
      let anchorKey  = currentPlaylist.length > 0 ? currentPlaylist[currentPlaylist.length - 1].camelot : null;

      const btnAF = null; // btn-autofill removed
      const stillCurrent = studioGenerationGuard();
      autoFillSegment.busy = true;

      try {
        const segTime = segEnd.x - segStart.x;
        const tempoFlip = magicGraphTempoFlipInfo(segStart, segEnd, avgDur);
        const need    = magicSetTrackEstimate(segTime, segStart.y, segEnd.y, avgDur, tempoFlip?.mode || '');
        if (need < 1) {
          showToast('Segment too short — move the points further apart', true);
          return;
        }
        const dtTime = segTime / need;
        let addedTracks = [];
        const usedPaths = new Set(getUsedTrackPaths());
        let lastSelectedBpm = Number(currentPlaylist[currentPlaylist.length - 1]?.bpm || segStart.y || 0);

        for (let s = 0; s < need; s++) {
          const tFrom   = segStart.x + s * dtTime;
          const tTo     = segStart.x + (s + 1) * dtTime;
          const bpmFrom = magicSegmentBpmAt(segStart.y, segEnd.y, s / need, tempoFlip?.mode || '');
          const bpmTo   = magicSegmentBpmAt(segStart.y, segEnd.y, (s + 1) / need, tempoFlip?.mode || '');

          const start_dot = { time_min: tFrom, bpm: Math.round(bpmFrom * 10) / 10 };
          const end_dot   = { time_min: tTo,   bpm: Math.round(bpmTo   * 10) / 10 };

          const resp = await fetch('/api/studio/autofill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ start_dot, end_dot, avg_duration: avgDur, max_bpm_step: getMagicBpmStepLimit(), tempo_flip: s === 0 ? (tempoFlip?.mode || '') : '', previous_bpm: lastSelectedBpm, anchor_key: anchorKey, blacklist: [...usedPaths], set_brief: setBriefRuntimePayload() })
          });
          let data;
          try { data = await resp.json(); } catch(je) { data = {}; }
          if (!stillCurrent()) return;
          if (!resp.ok) {
            const msg = data.error || data.message || data.detail || `HTTP ${resp.status}`;
            throw new Error(`Sub-segment ${s + 1}: ${msg}`);
          }
          if (data.error || data.message) {
            throw new Error(`Sub-segment ${s + 1}: ${data.error || data.message}`);
          }
          if (data.tracks && data.tracks.length > 0) {
            const uniqueTracks = data.tracks.filter(track => {
              if (!track.path || usedPaths.has(track.path)) return false;
              usedPaths.add(track.path);
              return true;
            });
            if (uniqueTracks.length > 0) {
              addedTracks = addedTracks.concat(uniqueTracks);
              anchorKey = uniqueTracks[uniqueTracks.length - 1].camelot || anchorKey;
              lastSelectedBpm = Number(uniqueTracks[uniqueTracks.length - 1].bpm || lastSelectedBpm || 0);
            }
          }
        }

        if (addedTracks.length > 0) {
          saveHistory();
          currentPlaylist = dedupePlaylistTracks(currentPlaylist.concat(addedTracks));
          syncEditingPlaylistIfNeeded();
          // graphDots intentionally NOT cleared — allows chaining further segments
          initSortable();
          markMagicSetReady();
          recalculateAudit();
          showToast(`Auto-filled ${addedTracks.length} track${addedTracks.length !== 1 ? 's' : ''}`);
          showStudioTrackAddedPulse({ title: `${addedTracks.length} Magic Set tracks` }, currentPlaylist.length);
        } else {
          showToast('No matches found to fill gap', true);
        }
      } catch (e) {
        console.error('autoFillSegment error:', e);
        showToast(e.message || 'Error filling segment', true);
      } finally {
        autoFillSegment.busy = false;
      }

    }

    async function fillSetFromBPMPoints() {
      if (!(await ensureAxiomLicenseUsable('Magic Set'))) return;
      if (fillSetFromBPMPoints.busy) return;
      if (graphDots.length < 2) {
        showToast('Add at least 2 BPM points on the chart first', true);
        return;
      }
      const setLen    = parseInt(document.getElementById('set-length-selector').value || 120);
      const avgDur    = parseFloat(document.getElementById('avg-duration-selector').value || 2);
      const targetTracks = Math.max(1, Math.round(setLen / Math.max(0.5, avgDur)));

      // Use only user-placed points — sorted, no forced 0 / setLen padding
      const dots = [...graphDots].sort((a, b) => a.x - b.x);
      const stillCurrent = studioGenerationGuard();
      fillSetFromBPMPoints.busy = true;

      const btn = document.getElementById('btn-magic-set');
      setAxiomButtonBusy(btn, true, 'Building Magic Set...');
      showToast(`Building set from ${dots.length - 1} BPM segment${dots.length - 2 === 0 ? '' : 's'}...`);

      try {
        const points = dots.map((dot, index) => {
          const tempoFlip = index > 0 ? magicGraphTempoFlipInfo(dots[index - 1], dot, avgDur) : null;
          return {
            time_min: Number(dot.x || 0),
            bpm: Number(dot.y || 0),
            tempo_flip: tempoFlip?.mode || ''
          };
        });
        const resp = await fetch('/api/studio/generate_from_curve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            points,
            avg_duration: avgDur,
            target_count: targetTracks,
            max_bpm_step: getMagicBpmStepLimit(),
            set_brief: setBriefRuntimePayload()
          })
        });
        let data;
        try { data = await resp.json(); } catch (jsonError) { data = {}; }
        if (!stillCurrent()) return;
        if (!resp.ok || data.error) {
          throw new Error(data.error || data.message || data.detail || `HTTP ${resp.status}`);
        }
        const allTracks = dedupePlaylistTracks(data.tracks || []).slice(0, targetTracks);

        if (allTracks.length > 0) {
          // This fresh-set path is reached only when Studio has no Working Set
          // tracks. Existing tracks are always routed through Build Around so
          // a Magic Set action can never silently remove the user's work.
          saveHistory();
          currentPlaylist = dedupePlaylistTracks(allTracks);
          syncEditingPlaylistIfNeeded();
          initSortable();
          markMagicSetReady({ clearDraft: true });
          recalculateAudit();

          const segCount = dots.length - 1;
          const estimatedTracks = targetTracks;
          let msg = `Filled ${allTracks.length} track${allTracks.length !== 1 ? 's' : ''} across ${segCount} segment${segCount !== 1 ? 's' : ''}`;
          if (allTracks.length < estimatedTracks) {
            msg += ` — for more coverage, add extra BPM points or reduce avg duration`;
          }
          showToast(msg, allTracks.length < estimatedTracks);
          showStudioTrackAddedPulse({ title: `${allTracks.length} Magic Set tracks` }, currentPlaylist.length);
        } else {
          showToast('No matches found for that BPM curve — try different BPM range or check your library', true);
        }
      } catch (err) {
        console.error('fillSetFromBPMPoints error:', err);
        showToast(err.message || 'Error filling from BPM points', true);
      } finally {
        fillSetFromBPMPoints.busy = false;
        setAxiomButtonBusy(btn, false);
      }
    }

    // ========== FEATURE 3: ONE-CLICK SET GENERATION FROM ANCHOR TRACK ==========

    async function generateSetFromAnchor() {
      if (!(await ensureAxiomLicenseUsable('Magic Set'))) return;
      if (generateSetFromAnchor.busy) return;
      if (!anchorTargetDot || graphAnchorIndex < 0) return;
      if (currentPlaylist.length === 0) {
        showToast('Add a track before generating', true);
        return;
      }

      const anchorTrack = currentPlaylist[graphAnchorIndex];
      if (!anchorTrack) {
        showToast('Choose an anchor track from the compressed set list', true);
        return;
      }
      const anchorBpm   = parseFloat(anchorTrack.bpm) || anchorTargetDot.y;
      const targetBpm   = anchorTargetDot.y;
      const targetTime  = anchorTargetDot.x;
      const avgDur      = parseFloat(document.getElementById('avg-duration-selector').value || 2);
      const tempoFlip   = magicGraphTempoFlipInfo(
        { x: graphAnchorIndex * avgDur, y: anchorBpm },
        anchorTargetDot,
        avgDur
      );

      // BPM jump warning
      const bpmDiff = Math.abs(targetBpm - anchorBpm);
      if (bpmDiff > 30 && !tempoFlip) {
        const proceed = confirm(
          `Large BPM jump detected (${bpmDiff.toFixed(0)} BPM difference — may sound abrupt). Continue anyway?`
        );
        if (!proceed) return;
      } else if (tempoFlip) {
        showToast(`Treating ${Math.round(anchorBpm)} to ${Math.round(targetBpm)} BPM as a ${tempoFlip.label}`);
      }

      // Disable button / show spinner
      const stillCurrent = studioGenerationGuard();
      const btn     = document.getElementById('btn-generate-from-anchor');
      const btnText = document.getElementById('gen-anchor-text');
      const spinner = document.getElementById('gen-anchor-spinner');
      btn.disabled = true;
      btn.style.opacity = '0.7';
      btnText.innerText = 'GENERATING...';
      spinner.classList.remove('hidden');
      generateSetFromAnchor.busy = true;

      try {
        const resp = await fetch('/api/studio/generate_from_anchor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            anchor_track: { bpm: anchorBpm, camelot: anchorTrack.camelot, duration_min: anchorTrack.duration_min || avgDur, duration_sec: anchorTrack.duration_sec || 0, path: anchorTrack.path },
            target_time:  targetTime,
            target_bpm:   targetBpm,
            avg_duration: avgDur,
            max_bpm_step: getMagicBpmStepLimit(),
            tempo_flip: tempoFlip?.mode || '',
            blacklist: getUsedTrackPaths(),
            set_brief: setBriefRuntimePayload(),
          })
        });

        const data = await resp.json();
        if (!stillCurrent()) return;

        if (!resp.ok) {
          showToast(data.error || 'Generation failed', true);
          return;
        }

        if (!data.tracks || data.tracks.length === 0) {
          showToast('No matching tracks found for that BPM curve — try a wider BPM range or check your library', true);
          return;
        }

        const uniqueTracks = data.tracks.filter(track => !playlistHasTrack(track));
        if (uniqueTracks.length === 0) {
          showToast('Generated tracks were already in this set', true);
          return;
        }

        // Append generated tracks after the selected anchor.
        saveHistory();
        currentPlaylist.splice(graphAnchorIndex + 1, 0, ...uniqueTracks);
        syncEditingPlaylistIfNeeded();
        initSortable();
        renderPlaylist();
        markMagicSetReady();
        recalculateAudit();

        showToast(
          `Generated ${uniqueTracks.length} track${uniqueTracks.length !== 1 ? 's' : ''} after ${anchorTrack.title || 'the Set Starter'}`
        );
        showStudioTrackAddedPulse({ title: `${uniqueTracks.length} Magic Set tracks` }, currentPlaylist.length);

      } catch (err) {
        showToast('Generation failed: ' + err.message, true);
      } finally {
        generateSetFromAnchor.busy = false;
        btn.disabled = false;
        btn.style.opacity = '1';
        btnText.innerText = 'GENERATE SET TO TARGET';
        spinner.classList.add('hidden');
      }
    }

    // ========== END FEATURE 3 ==========
