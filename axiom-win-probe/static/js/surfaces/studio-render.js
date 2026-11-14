    // Studio playlist rendering, Magic Set scoring, and shared track identity updates.
    function renderPlaylist(transitions = []) {
      const container = document.getElementById('active-playlist-container');
      if (!container) return;
      const orderSource = getActiveStudioOrderSource();
      container.dataset.orderSource = orderSource;
      container.dataset.orderLabel = getStudioOrderLabelForSource(orderSource);
      const listToRender = getActiveSetList();
      updateStudioSetSummary(listToRender);
      updateStudioToolsAvailability();

      if (listToRender.length === 0) {
        container.classList.remove('energy-spine-active');
        const studioView = document.getElementById('studio-active-view');
        if (studioView) {
          studioView.style.removeProperty('--spine-x');
          studioView.style.removeProperty('--spine-row-x');
        }
        container.innerHTML = `<div class="text-center p-10 text-axiom-muted font-bold uppercase tracking-widest text-sm">Playlist is empty</div>`;
        return;
      }

      container.classList.toggle('energy-spine-active', listToRender.length > 1);
      container.innerHTML = listToRender.map((t, i) => {
        cacheTrackVisual(t);
        const trans = transitions.find ? transitions.find(tr => tr.from_index === i) : null;
        const errClass = t._unlinked ? 'border-red-500/50 bg-red-500/5' : 'border-white/5';
        const isHarmonic = (i > 0 && isHarmonicMatch(listToRender[i-1], t));
        const isMissingRequest = Boolean(t.missing_placeholder);
        const anchorClass = graphModeOpen && i === graphAnchorIndex ? 'is-anchor' : '';
        const isPlaying = currentPlayingPath === t.path;

        const brain = getGenreBrain(t.genre);
        const pillar = brain ? brain.pillar : 'DNA-X';
        const velocity = brain ? brain.velocity : 'Z-00';
        const dnaDisplayLabel = brain ? pillar : 'GENRE NEEDED';
        const dnaEditTitle = brain
          ? `AXIOM DNA: ${pillar} style lane, ${velocity} energy lane. Click to edit Genre + Root.`
          : 'Genre is not classified yet. Click to set Genre + Root so AXIOM can classify this track.';
        const velocityVal = parseInt(velocity.replace('Z-', '')) || 0;
        const velocityColor = (velocityVal >= 8 || velocity === 'Z-10') ? '#ef4444' : 'var(--accent)';
        const keyClass = camelotClass(t.camelot);
        const rowAction = t.missing_placeholder
          ? `showToast('This request is still missing from your Library.', true)`
          : graphModeOpen
            ? `setGraphAnchor(${i}, event)`
            : `playAudioFile('${escapeJsAttribute(t.path)}', '${escapeJsAttribute(t.title)}', '${escapeJsAttribute(t.artist)}', ${parseFloat(t.bpm) || 0}, '${escapeJsAttribute(t.camelot || '')}', '${escapeJsAttribute(t.energy || '')}', event); highlightPlaylistTrack(this)`;
        const nodeScore = isMissingRequest ? 0 : (trans ? trans.overall : studioEnergyScore(t.energy, i));
        const nodeRating = trans ? trans.rating : studioEnergyRating(nodeScore);
        const nodeBpm = t.bpm ? Math.round(parseFloat(t.bpm)) : '--';
        const harmonicScore = i === 0 ? 'Anchor' : (isHarmonic ? 'Match' : '--');
        const matchingSongsLeft = matchingSongsButtonPosition() === 'left';
        const hasAlternateVersions = !t.missing_placeholder && studioTrackHasAlternateVersions(t);
        const versionActionButton = hasAlternateVersions
          ? `<button type="button" class="track-identity-edit-button track-version-edit-button" title="Change selected song version" aria-label="Change selected song version" onclick="event.stopPropagation(); openStudioVersionChooser(${i})">Version</button>`
          : '';
        const matchingSongsButton = t.missing_placeholder
          ? `<button type="button" disabled class="studio-smart-btn button--green-outline${matchingSongsLeft ? ' is-left' : ''}">Missing Song</button>`
          : `<div class="studio-row-smart-actions">
              <button type="button" onclick="event.stopPropagation(); openModal(${i})" class="studio-smart-btn studio-matching-action button--green-outline${matchingSongsLeft ? ' is-left' : ''}">Matching Songs</button>
            </div>`;

        let tooltipHtml = '';
        if (isMissingRequest) {
            tooltipHtml = `<div class="tb-tooltip"><div class="tb-tooltip-title">Missing Request</div><div class="tb-tooltip-row"><span>Add this song to your Library, then replace this placeholder.</span></div></div>`;
        } else if (i === 0) {
            tooltipHtml = `<div class="tb-tooltip"><div class="tb-tooltip-title">Starting Point</div><div class="tb-tooltip-row"><span>Set Starter</span></div></div>`;
        } else {
            const prev = listToRender[i-1];

            let bpmLabel = 'BPM Clash';
            let bpmPts = '+10';
            let bpmClass = 'clash';
            if (t.bpm && prev.bpm) {
                const diff = Math.min(Math.abs(prev.bpm - t.bpm), Math.abs(prev.bpm - t.bpm/2), Math.abs(prev.bpm - t.bpm*2));
                if (diff <= 1.5) { bpmLabel = 'Perfect BPM Match'; bpmPts = '+50'; bpmClass = 'perfect'; }
                else if (diff <= 4.0) { bpmLabel = 'Mixable BPM Match'; bpmPts = '+35'; bpmClass = 'mixable'; }
            }

            let keyLabel = 'Key Clash';
            let keyPts = '+10';
            let keyClass = 'clash';
            if (t.camelot && prev.camelot) {
                if (t.camelot === prev.camelot) { keyLabel = 'Perfect Key Match'; keyPts = '+50'; keyClass = 'perfect'; }
                else if (isHarmonic) { keyLabel = 'Harmonic Key Match'; keyPts = '+40'; keyClass = 'perfect'; }
            }

            tooltipHtml = `
              <div class="tb-tooltip">
                <div class="tb-tooltip-title">Transition Breakdown</div>

                <div class="tb-tooltip-section">
                  <div class="tb-tooltip-section-header">BPM Matching</div>
                  <div class="tb-tooltip-row ${bpmClass}">
                    <span class="tb-metric-detail">${prev.bpm ? parseFloat(prev.bpm).toFixed(1) : '--'} → ${t.bpm ? Math.round(parseFloat(t.bpm)) : '--'}</span>
                    <span>${bpmPts}</span>
                  </div>
                  <div class="tb-tooltip-desc ${bpmClass}">${bpmLabel}</div>
                </div>

                <div class="tb-tooltip-section">
                  <div class="tb-tooltip-section-header">Harmonic Key</div>
                  <div class="tb-tooltip-row ${keyClass}">
                    <span class="tb-metric-detail">${prev.camelot || '--'} → ${escapeHtml(t.camelot || '--')}</span>
                    <span>${keyPts}</span>
                  </div>
                  <div class="tb-tooltip-desc ${keyClass}">${keyLabel}</div>
                </div>

                <div class="tb-tooltip-footer">
                  <span>Total Synergy</span>
                  <strong class="text-white">${nodeScore}/100</strong>
                </div>
              </div>
            `;
        }

        return `
        <div class="playlist-row studio-transition-row axiom-focus-deck-row glass p-4 rounded-2xl border ${errClass} ${anchorClass} ${isPlaying ? 'playing-track' : ''} has-transition relative group mb-4" data-path="${escapeHtml(t.path)}" role="listitem" aria-grabbed="false" tabindex="0" onkeydown="activateFocusDeckRow(event)" oncontextmenu="return openStudioDawTrackMenu(event, ${i})">
            ${renderFocusDeckMarker()}
            ${isHarmonic ? `<div class="absolute -top-4 left-10 w-px h-4 bg-axiom-accent/30 z-0"></div>` : ''}
            <div class="drag-handle cursor-grab text-white/25 hover:text-white px-2 relative z-10" title="Hold and drag to reorder this track" aria-label="Hold and drag to reorder this track" onclick="event.stopPropagation()">
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M4 15h16v-2H4v2zm0 4h16v-2H4v2zm0-8h16V9H4v2zm0-6v2h16V5H4z"/></svg>
            </div>
            <div class="studio-row-main flex items-center gap-4 cursor-pointer" onclick="${rowAction}">
                ${renderTrackArtwork(t, 'studio-track-artwork', `event.stopPropagation(); ${rowAction}`)}
                <div class="studio-row-text">
                    <div class="studio-row-title-line">
                        <p class="studio-row-title uppercase group-hover:text-axiom-accent transition-colors track-title-resize">${graphModeOpen ? `<span class="text-axiom-accent/70 mr-2">${i + 1}</span>` : ''}${escapeHtml(t.title || 'Untitled Track')}</p>
                    </div>
                    <div class="flex items-center gap-2 flex-wrap">
                        <p class="studio-row-artist font-bold uppercase track-artist-resize">${escapeHtml(t.artist || 'Unknown Artist')}</p>
                        <button type="button" class="studio-dna-chip" title="${escapeHtml(dnaEditTitle)}" aria-label="${escapeHtml(dnaEditTitle)}" onclick="event.stopPropagation(); promptSetBpm('${escapeJsAttribute(t.path)}', ${Number(t.bpm) || 0}, ${Number(t.year || t.release_year || 0)})">${dnaDisplayLabel} // ${velocity}</button>
                    </div>
                </div>
                <div class="studio-row-identity-actions" aria-label="Track identity actions">
                    <button type="button" class="track-identity-edit-button" title="Edit title and artist" aria-label="Edit title and artist" onclick="event.stopPropagation(); promptEditTrackIdentity('${escapeJsAttribute(t.path)}', '${escapeJsAttribute(t.title || '')}', '${escapeJsAttribute(t.artist || '')}')">Edit</button>
                    ${versionActionButton}
                </div>
            </div>
            ${matchingSongsButton}
            <div class="studio-metric studio-bpm-metric">
                ${isMissingRequest
                  ? `<strong style="color:#ff525b;">--</strong>`
                  : `<strong style="color: ${t.bpm ? velocityColor : '#EAB308'};" class="cursor-pointer" onclick="event.stopPropagation(); promptSetBpm('${escapeJsAttribute(t.path)}', ${Number(t.bpm) || 0})" aria-label="Click to edit BPM">${t.bpm ? Math.round(parseFloat(t.bpm)) : '--'}</strong>`}
                <small>BPM</small>
            </div>
            <div class="studio-metric studio-key-metric ${t.camelot ? 'has-key' : 'is-missing'}">
                ${isMissingRequest
                  ? `<span class="camelot-pill is-missing font-black text-xs" style="color:#ff525b;">--</span>`
                  : `<button onclick="event.stopPropagation(); promptUpdateKey('${escapeJsAttribute(t.path)}', '${escapeJsAttribute(t.camelot || '')}')" class="camelot-pill ${keyClass} font-black text-xs cursor-pointer hover:scale-105 transition-transform" title="Set or fix key">${escapeHtml(t.camelot || '--')}</button>`}
                <small>Key</small>
            </div>
            <div class="studio-metric studio-harmonic-metric">
                <strong class="studio-harmonic-indicator ${i === 0 ? 'is-anchor' : (isHarmonic ? 'is-percentage' : 'is-missing')}">${harmonicScore}</strong>
                <small>Harmonic</small>
            </div>
            ${graphModeOpen ? `
            <div class="magic-row-hover-actions" aria-label="Magic Set track actions">
              <button type="button" onclick="event.stopPropagation(); openMagicReplace(${i})">Replace</button>
              <button type="button" onclick="event.stopPropagation(); playAudioFile('${escapeJsAttribute(t.path)}', '${escapeJsAttribute(t.title)}', '${escapeJsAttribute(t.artist)}', ${parseFloat(t.bpm) || 0}, '${escapeJsAttribute(t.camelot || '')}', '${escapeJsAttribute(t.energy || '')}', event)">Preview</button>
              <button type="button" onclick="event.stopPropagation(); setGraphAnchor(${i}, event)">Lock</button>
              <button type="button" onclick="event.stopPropagation(); adjustBpm('${escapeJsAttribute(t.path)}', ${Number(t.bpm) || 0}, 'half')">1/2</button>
              <button type="button" onclick="event.stopPropagation(); adjustBpm('${escapeJsAttribute(t.path)}', ${Number(t.bpm) || 0}, 'double')">2x</button>
            </div>` : ''}
            ${isMissingRequest
              ? `<button type="button" disabled class="fav-star-btn" title="Add the song to your Library before saving it">&#9734;</button>`
              : `<button onclick="event.stopPropagation(); toggleFavorite({path:'${escapeJsAttribute(t.path)}',title:'${escapeJsAttribute(t.title || '')}',artist:'${escapeJsAttribute(t.artist || '')}',bpm:${Number(t.bpm) || 0},camelot:'${escapeJsAttribute(t.camelot || '')}',energy:'${escapeJsAttribute(t.energy || '')}',genre:'${escapeJsAttribute(t.genre || '')}'})" class="fav-star-btn ${favoritesHasTrack(t) ? 'fav-star-active' : ''}" data-fav-path="${escapeHtml(t.path)}" title="${favoritesHasTrack(t) ? 'Remove from Favorites' : 'Add to Favorites'}">${favoritesHasTrack(t) ? '&#9733;' : '&#9734;'}</button>`}
            <button onclick="deleteTrackFromPlaylist(${i}, event)" class="studio-remove-btn flex items-center justify-center text-white/24 hover:text-red-400 transition-colors" title="Remove Track">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
            <div class="absolute transition-badge energy-spine-node badge-${nodeRating} ${i === 0 ? 'is-first-node' : ''} ${i === listToRender.length - 1 ? 'is-last-node' : ''} shadow-xl cursor-help">
              <span class="transition-node-ripple" aria-hidden="true"></span>
              <span class="studio-spine-orb" aria-hidden="true"></span>
              ${isMissingRequest
                ? `<strong aria-label="Missing request"><span class="studio-node-bpm-value">--</span><span class="studio-node-bpm-label">Missing</span></strong>`
                : `<strong onclick="event.stopPropagation(); promptSetBpm('${escapeJsAttribute(t.path)}', ${Number(t.bpm) || 0})" aria-label="Click to edit BPM"><span class="studio-node-bpm-value">${nodeBpm}</span><span class="studio-node-bpm-label">BPM</span></strong>`}
              ${tooltipHtml}
            </div>
        </div>`;
      }).join('');
      highlightPlayingTrack(currentPlayingPath);
      requestAnimationFrame(() => {
        syncStudioSpineToBpmColumn();
        requestAnimationFrame(syncStudioSpineToBpmColumn);
      });
      setTimeout(syncStudioSpineToBpmColumn, 80);
      void hydrateStudioTrackVersions();
    }

    function syncStudioSpineToBpmColumn() {
      const studioView = document.getElementById('studio-active-view');
      const container = document.getElementById('active-playlist-container');
      const row = container?.querySelector('.studio-transition-row');
      const bpmMetric = row?.querySelector('.studio-metric');
      if (!studioView || !container || !row || !bpmMetric) return;

      const rowRect = row.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const bpmRect = bpmMetric.getBoundingClientRect();
      if (!rowRect.width || !containerRect.width || !bpmRect.width) return;

      const bpmCenter = bpmRect.left + bpmRect.width / 2;
      const clampPercent = (value) => Math.max(0, Math.min(100, value)).toFixed(3) + '%';
      studioView.style.setProperty('--spine-row-x', clampPercent(((bpmCenter - rowRect.left) / rowRect.width) * 100));
      studioView.style.setProperty('--spine-x', clampPercent(((bpmCenter - containerRect.left) / containerRect.width) * 100));

      const nodes = Array.from(container.querySelectorAll('.energy-spine-node'))
        .filter(node => node.getClientRects().length);
      if (nodes.length > 1) {
        const firstRect = nodes[0].getBoundingClientRect();
        const lastRect = nodes[nodes.length - 1].getBoundingClientRect();
        const firstCenter = firstRect.top + firstRect.height / 2 - containerRect.top;
        const lastCenter = lastRect.top + lastRect.height / 2 - containerRect.top;
        const spineHeight = Math.max(0, lastCenter - firstCenter);
        container.style.setProperty('--spine-top', `${firstCenter.toFixed(1)}px`);
        container.style.setProperty('--spine-height', `${spineHeight.toFixed(1)}px`);
      }

      nodes.forEach((node, index) => {
        const nextNode = nodes[index + 1];
        if (!nextNode) {
          node.style.removeProperty('--spine-line-height');
          node.style.removeProperty('--spine-orb-travel');
          return;
        }

        const nodeRect = node.getBoundingClientRect();
        const nextRect = nextNode.getBoundingClientRect();
        const gap = Math.max(0, nextRect.top - nodeRect.bottom);
        const capOffset = Math.min(3, Math.max(1, gap * 0.04));
        const lineHeight = Math.max(0, gap - capOffset * 2);
        const orbStart = Math.min(10, Math.max(6, gap * 0.18));
        const orbTravel = Math.max(0, gap - orbStart * 2);

        node.style.setProperty('--spine-gap-offset', `${capOffset.toFixed(1)}px`);
        node.style.setProperty('--spine-line-height', `${lineHeight.toFixed(1)}px`);
        node.style.setProperty('--spine-orb-start', `${orbStart.toFixed(1)}px`);
        node.style.setProperty('--spine-orb-travel', `${orbTravel.toFixed(1)}px`);
      });
    }

    window.addEventListener('resize', () => {
      if (document.getElementById('active-playlist-container')?.classList.contains('energy-spine-active')) {
        requestAnimationFrame(syncStudioSpineToBpmColumn);
      }
    });

    function normalizeEnergyValue(energy) {
      const raw = String(energy || '').trim().toLowerCase();
      if (raw === 'peak' || raw === 'high') return 'Peak';
      if (raw === 'mid' || raw === 'medium') return 'Mid';
      if (raw === 'low') return 'Low';
      return 'Unknown';
    }

    function studioEnergyScore(energy, index = 0) {
      const normalized = normalizeEnergyValue(energy);
      if (normalized === 'Peak') return 85;
      if (normalized === 'Mid') return 75;
      if (normalized === 'Low') return 60;
      return 70 + (index % 3) * 5;
    }

    function studioEnergyRating(score) {
      const numeric = parseFloat(score) || 0;
      if (numeric >= 80) return 'green';
      if (numeric >= 50) return 'yellow';
      return 'red';
    }

    const MAGIC_BPM_STEP_LIMIT = 3;

    function getMagicBpmStepLimit() {
      return MAGIC_BPM_STEP_LIMIT;
    }

    function magicTempoFlipInfo(startBpm, endBpm) {
      const start = Number(startBpm) || 0;
      const end = Number(endBpm) || 0;
      if (!start || !end) return null;
      const rawDiff = Math.abs(end - start);
      if (rawDiff < 24) return null;

      const halfRelatedDiff = Math.abs(start - end * 2);
      const doubleRelatedDiff = Math.abs(start * 2 - end);
      const relatedThreshold = 24;

      if (start >= 95 && end <= 95 && halfRelatedDiff <= relatedThreshold) {
        return {
          mode: 'half',
          label: 'half-time flip',
          displayBpm: end,
          comparisonBpm: end * 2,
          distance: halfRelatedDiff
        };
      }

      if (start <= 95 && end >= 105 && doubleRelatedDiff <= relatedThreshold) {
        return {
          mode: 'double',
          label: 'double-time flip',
          displayBpm: end,
          comparisonBpm: end / 2,
          distance: Math.abs(start - end / 2)
        };
      }

      return null;
    }

    function magicTempoAwareBpmDistance(startBpm, endBpm) {
      const flip = magicTempoFlipInfo(startBpm, endBpm);
      if (flip) return Math.abs((Number(startBpm) || 0) - flip.comparisonBpm);
      return Math.abs((Number(endBpm) || 0) - (Number(startBpm) || 0));
    }

    function magicGraphTempoFlipInfo(startPoint, endPoint, avgDuration = 2) {
      const flip = magicTempoFlipInfo(startPoint?.y, endPoint?.y);
      if (!flip) return null;
      const explicitMode = String(endPoint?.tempoFlipFromPrevious || '').toLowerCase();
      if (explicitMode === flip.mode) return flip;
      const timeSpan = Math.abs(Number(endPoint?.x || 0) - Number(startPoint?.x || 0));
      const maximumFlipSpan = Math.max(1, Number(avgDuration || 2) * 1.5);
      return timeSpan <= maximumFlipSpan ? flip : null;
    }

    function magicPersistentTempoFlipInfo(points, index) {
      if (!Array.isArray(points) || index <= 0 || index >= points.length) return null;
      const flip = magicTempoFlipInfo(points[index - 1]?.y, points[index]?.y);
      if (!flip) return null;

      // A one-song 70 -> 140 -> 70 spike is not a set-lane decision. Suppress
      // both labels when the next or previous edge immediately reverses it.
      const nextFlip = index + 1 < points.length
        ? magicTempoFlipInfo(points[index]?.y, points[index + 1]?.y)
        : null;
      if (nextFlip && nextFlip.mode !== flip.mode) return null;
      const previousFlip = index > 1
        ? magicTempoFlipInfo(points[index - 2]?.y, points[index - 1]?.y)
        : null;
      if (previousFlip && previousFlip.mode !== flip.mode) return null;
      return flip;
    }

    function magicSegmentBpmAt(startBpm, endBpm, progress, flipMode = '') {
      const start = Number(startBpm) || 0;
      const end = Number(endBpm) || 0;
      const ratio = Math.max(0, Math.min(1, Number(progress) || 0));
      const flip = String(flipMode || '').toLowerCase();
      // Display and generate the real tempo lane: the first edge drops or rises
      // sharply, then the remainder continues from the new actual BPM.
      if (flip && ratio === 0) return start;
      if (flip === 'half') {
        const mappedStart = start / 2;
        return mappedStart + (end - mappedStart) * ratio;
      }
      if (flip === 'double') {
        const mappedStart = start * 2;
        return mappedStart + (end - mappedStart) * ratio;
      }
      return start + (end - start) * ratio;
    }

    function magicSetTrackEstimate(durationMinutes, startBpm, endBpm, avgDuration, flipMode = '') {
      const duration = Math.max(0, Number(durationMinutes) || 0);
      const average = Math.max(0.5, Number(avgDuration) || 2);
      // A vertical tempo-flip marker is one DJ transition, not a zero-length
      // segment to discard or subdivide. The next timed segment owns the
      // progressive climb from the new half/double-time lane.
      if (flipMode && duration <= 0.001) return 1;
      const timeCount = Math.ceil(duration / average);
      const bpmDistance = flipMode
        ? (flipMode === 'half'
            ? Math.abs((Number(startBpm) || 0) - ((Number(endBpm) || 0) * 2))
            : Math.abs((Number(startBpm) || 0) - ((Number(endBpm) || 0) / 2)))
        : Math.abs((Number(endBpm) || 0) - (Number(startBpm) || 0));
      const bpmCount = Math.ceil(bpmDistance / getMagicBpmStepLimit());
      return Math.max(1, timeCount, bpmCount);
    }

    function magicScoreLabel(score) {
      const numeric = Number(score) || 0;
      if (numeric >= 90) return 'Excellent';
      if (numeric >= 80) return 'Strong';
      if (numeric >= 65) return 'Playable';
      if (numeric > 0) return 'Review';
      return 'Ready';
    }

    function updateMagicSetScoreCard(score = null) {
      const list = getActiveSetList();
      const setLen = parseInt(document.getElementById('set-length-selector')?.value || 120);
      const avgDur = parseFloat(document.getElementById('avg-duration-selector')?.value || 2);
      const estimate = Math.max(1, Math.round(setLen / Math.max(0.5, avgDur)));
      const displayScore = score ?? (parseInt(document.getElementById('set-score-display')?.textContent || '0', 10) || 0);
      const subtitle = document.getElementById('magic-set-subtitle');
      const scoreValue = document.getElementById('magic-score-value');
      const scoreLabel = document.getElementById('magic-score-label');
      const hours = setLen / 60;
      const durationLabel = setLen >= 60
        ? `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hour${hours === 1 ? '' : 's'}`
        : `${setLen} mins`;
      if (subtitle) subtitle.textContent = `AXIOM-built journey · ${list.length} tracks · ${durationLabel}`;
      if (scoreValue) scoreValue.textContent = displayScore > 0 ? displayScore : '--';
      if (scoreLabel) scoreLabel.textContent = magicScoreLabel(displayScore);
      const ratio = document.getElementById('magic-track-ratio');
      const open = document.getElementById('magic-open-positions');
      const dotTracks = document.getElementById('magic-dot-track-count');
      const dotOpen = document.getElementById('magic-dot-open-count');
      const openCount = Math.max(0, estimate - list.length);
      if (ratio) ratio.textContent = `${list.length} / ${estimate}`;
      if (open) open.textContent = openCount;
      if (dotTracks) dotTracks.textContent = `${list.length} track${list.length === 1 ? '' : 's'}`;
      if (dotOpen) dotOpen.textContent = `${openCount} open`;
    }

    function renderMagicSetSelectedCard() {
      const card = document.getElementById('magic-selected-card');
      if (!card) return;
      if (!graphModeOpen) {
        card.classList.add('hidden');
        card.innerHTML = '';
        return;
      }
      const list = getActiveSetList();
      const track = graphAnchorIndex >= 0 ? list[graphAnchorIndex] : null;
      if (!track) {
        card.classList.add('hidden');
        card.innerHTML = '';
        return;
      }
      const indexLabel = String(graphAnchorIndex + 1).padStart(2, '0');
      const nextTrack = list[graphAnchorIndex + 1];
      const match = nextTrack ? (isHarmonicMatch(track, nextTrack) ? 94 : 82) : 88;
      const bpm = track.bpm ? Number(track.bpm).toFixed(0) : '--';
      const nextBpm = nextTrack?.bpm ? Number(nextTrack.bpm).toFixed(0) : bpm;
      card.innerHTML = `
        <div class="magic-selected-art">${renderTrackArtwork(track, 'w-full h-full object-cover', '')}</div>
        <div class="min-w-0">
          <strong>${indexLabel} — ${escapeHtml(track.title || 'Untitled Track')}</strong>
          <p>${bpm} BPM → ${nextBpm} BPM</p>
          <span>${escapeHtml(track.camelot || '--')} · ${escapeHtml(track.energy || 'Energy ready')}</span>
          <p><em>${match}% transition match</em></p>
          <div class="magic-selected-actions">
            <button type="button" onclick="playAudioFile('${escapeJsAttribute(track.path)}', '${escapeJsAttribute(track.title)}', '${escapeJsAttribute(track.artist)}', ${parseFloat(track.bpm) || 0}, '${escapeJsAttribute(track.camelot || '')}', '${escapeJsAttribute(track.energy || '')}', event)">Preview</button>
            <button type="button" onclick="openMagicReplace(${graphAnchorIndex})">Replace</button>
            <button type="button" onclick="setGraphAnchor(${graphAnchorIndex}, event)">Lock</button>
          </div>
        </div>
      `;
      card.classList.remove('hidden');
    }

    function renderMagicSetJourney() {
      updateMagicSetScoreCard();
      renderMagicSetSelectedCard();
    }

    function hideMagicPointActions(delay = 0) {
      clearTimeout(magicPointHoverHideTimer);
      const hide = () => {
        const panel = document.getElementById('magic-point-actions');
        if (panel?.matches(':hover')) {
          magicPointHoverHideTimer = setTimeout(() => hideMagicPointActions(0), 250);
          return;
        }
        magicPointHoverState = null;
        panel?.classList.add('hidden');
      };
      if (delay > 0) {
        magicPointHoverHideTimer = setTimeout(hide, delay);
      } else {
        hide();
      }
    }

    function graphPointStateForElement(activeElement) {
      if (!activeElement) return null;
      const datasetIndex = activeElement.datasetIndex;
      const index = activeElement.index;
      const avgDur = parseFloat(document.getElementById('avg-duration-selector')?.value || 2);
      if (datasetIndex === 0) {
        const list = getActiveSetList();
        const track = list[index];
        if (!track) return null;
        return {
          kind: 'track',
          index,
          bpm: Number(track.bpm || 0) || 0,
          title: track.title || track.filename || 'Track',
          detail: `${String(index + 1).padStart(2, '0')} · ${Number(track.bpm || 0) ? `${Math.round(Number(track.bpm))} BPM` : 'BPM ready'}`
        };
      }
      if (datasetIndex === 1) {
        const dot = graphDots[index];
        if (!dot) return null;
        return {
          kind: 'draft',
          index,
          bpm: Number(dot.y || 0) || 0,
          title: `BPM marker ${index + 1}`,
          detail: `${Math.round(dot.x)} min · ${Math.round(dot.y)} BPM`
        };
      }
      if (datasetIndex === 2 && anchorTargetDot && graphAnchorIndex >= 0) {
        const track = getActiveSetList()[graphAnchorIndex];
        return {
          kind: 'anchor',
          index: graphAnchorIndex,
          bpm: Number(anchorTargetDot.y || track?.bpm || 0) || 0,
          title: track?.title || 'Anchor target',
          detail: `${Math.round(anchorTargetDot.x)} min · ${Math.round(anchorTargetDot.y)} BPM`
        };
      }
      return null;
    }

    function showMagicPointActions(chartEvent, activeElements) {
      const active = activeElements?.[0] || null;
      const pointState = graphPointStateForElement(active);
      const panel = document.getElementById('magic-point-actions');
      const graph = document.getElementById('graph-container');
      const canvas = document.getElementById('bpmChart');
      if (!pointState || !panel || !graph || !canvas) {
        hideMagicPointActions(450);
        return;
      }

      clearTimeout(magicPointHoverHideTimer);
      magicPointHoverState = pointState;
      const native = chartEvent?.native || chartEvent;
      const canvasRect = canvas.getBoundingClientRect();
      const graphRect = graph.getBoundingClientRect();
      const activePoint = active.element;
      const left = activePoint?.x != null
        ? canvas.offsetLeft + activePoint.x
        : (native?.clientX || canvasRect.left) - graphRect.left;
      const top = activePoint?.y != null
        ? canvas.offsetTop + activePoint.y
        : (native?.clientY || canvasRect.top) - graphRect.top;

      const canReplace = pointState.kind === 'track' || pointState.kind === 'anchor';
      panel.style.left = `${Math.max(122, Math.min(left, graph.clientWidth - 122))}px`;
      panel.style.top = `${Math.max(124, top)}px`;
      panel.innerHTML = `
        <strong>${escapeHtml(pointState.title)}</strong>
        <span>${escapeHtml(pointState.detail)}</span>
        <div class="magic-point-action-row">
          <button type="button" onclick="handleMagicPointAction('half')">1/2 From Here</button>
          <button type="button" onclick="handleMagicPointAction('double')">2x From Here</button>
          ${canReplace ? `<button type="button" onclick="handleMagicPointAction('replace')">Replace</button>` : ''}
        </div>
      `;
      panel.classList.remove('hidden');
    }

    function flipDraftBpmMarkersFromPoint(startIndex, action) {
      if (!Array.isArray(graphDots) || !graphDots[startIndex]) return false;
      const factor = action === 'half' ? 0.5 : 2;
      for (let i = startIndex; i < graphDots.length; i++) {
        const current = Number(graphDots[i]?.y || 0);
        if (!current) continue;
        graphDots[i] = {
          ...graphDots[i],
          y: Math.max(50, Math.min(220, Math.round(current * factor * 10) / 10)),
          ...(i === startIndex && startIndex > 0 ? { tempoFlipFromPrevious: action } : {})
        };
      }
      if (bpmChartInstance) {
        bpmChartInstance.data.datasets[1].data = graphDots;
        recalcBpmYAxis();
      }
      renderMagicSetJourney();
      return true;
    }

    async function handleMagicPointAction(action) {
      const pointState = magicPointHoverState;
      if (!pointState) return;
      if (action === 'replace') {
        hideMagicPointActions();
        openMagicReplace(pointState.index);
        return;
      }
      if (action !== 'half' && action !== 'double') return;

      hideMagicPointActions();
      if (pointState.kind === 'draft') {
        const updated = flipDraftBpmMarkersFromPoint(pointState.index, action);
        showToast(updated ? `Draft curve flipped ${action === 'half' ? 'half-time' : 'double-time'} from marker ${pointState.index + 1}` : 'No BPM markers changed', !updated);
        return;
      }

      graphAnchorIndex = pointState.index;
      currentAnchorTrack = getActiveSetList()[pointState.index] || currentAnchorTrack;
      renderMagicSetSelectedCard();
      renderPlaylist();
      await flipMagicSetFromAnchor(action);
    }

    Object.assign(window, {
      handleMagicPointAction,
      magicTempoFlipInfo,
      magicGraphTempoFlipInfo,
      magicPersistentTempoFlipInfo,
      magicTempoAwareBpmDistance,
      magicSegmentBpmAt
    });

    function deriveEnergyCurve(audit) {
      const curve = audit?.metrics?.energy_curve;
      if (Array.isArray(curve) && curve.length) {
        return curve.map(normalizeEnergyValue);
      }

      const listToRender = getActiveSetList();
      if (Array.isArray(listToRender) && listToRender.length) {
        return listToRender.map(track => normalizeEnergyValue(track.energy));
      }

      return [];
    }

    function renderEnergyLadder(audit) {
      const ladder = document.getElementById('energy-ladder');
      if (!ladder) return;

      const energyCurve = deriveEnergyCurve(audit);
      if (!energyCurve.length) {
        ladder.classList.add('energy-ladder-empty');
        ladder.innerHTML = `
          <div class="energy-timeline-track">
            ${Array.from({ length: 24 }, (_, i) =>
              `<div class="energy-block energy-idle" title="Add tracks to build the energy ladder" style="opacity:${0.22 + (i % 6) * 0.08}"></div>`
            ).join('')}
          </div>
          <div class="energy-timeline-labels"><span>Intro</span><span>Build</span><span>Peak</span><span>Drive</span><span>Outro</span></div>
        `;
        return;
      }

      ladder.classList.remove('energy-ladder-empty');
      ladder.innerHTML = `
        <div class="energy-timeline-track">
          ${energyCurve
            .map((energy, i) => `<div class="flex-1 energy-block energy-${energy}" title="${i + 1}. ${energy}"></div>`)
            .join('')}
        </div>
        <div class="energy-timeline-labels"><span>Intro</span><span>Build</span><span>Peak</span><span>Drive</span><span>Outro</span></div>
      `;
    }

    function studioSetScorePresentation(score, trackCount) {
      if (!Number(trackCount)) return { text: '--', className: 'text-axiom-muted' };
      const numericScore = Number(score) || 0;
      return {
        text: String(numericScore),
        className: numericScore >= 80 ? 'text-axiom-accent' : (numericScore >= 50 ? 'text-green-400' : 'text-red-500')
      };
    }

    function magicChartAccentColor(isLight = false) {
      if (isLight) return '#0047AB';
      const resolved = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      return resolved || '#a3ff00';
    }

    function renderMetrics(audit, { updateScore = true } = {}) {
      if (updateScore) {
        const score = audit.metrics.set_score;
        const scoreDisplay = document.getElementById('set-score-display');
        const scorePresentation = studioSetScorePresentation(score, getActiveSetList().length);
        scoreDisplay.innerText = scorePresentation.text;
        scoreDisplay.className = scorePresentation.className;
        updateMagicSetScoreCard(score);
      }

      const setLen = parseInt(document.getElementById('set-length-selector').value || 120);
      const avgDur = parseFloat(document.getElementById('avg-duration-selector').value || 2);
      document.getElementById('est-track-count').innerText = Math.round(setLen / avgDur);

      const trackPoints = audit.metrics.bpm_flow.map((bpm, i) => ({ x: i * avgDur, y: bpm }));

      const isLight = document.body.classList.contains('light-mode');
      // Chart.js paints into a canvas and cannot resolve CSS var() strings.
      // Pass the computed colour so existing Studio tracks stay visible in
      // Magic Set on native WKWebView as well as current browsers.
      const accentColor = magicChartAccentColor(isLight);
      const gridColor = isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.05)';
      const labelColor = isLight ? '#555555' : '#666';
      const pointOutline = '#071005';
      const accentFaint = isLight ? 'rgba(0, 71, 171, 0.05)' : 'rgba(163, 255, 0, 0.05)';

      const ctx = document.getElementById('bpmChart').getContext('2d');
      if (bpmChartInstance) bpmChartInstance.destroy();
      const magicTempoFlipLabelPlugin = {
        id: 'magicTempoFlipLabels',
        afterDatasetsDraw(chart) {
          const points = chart.getDatasetMeta(0)?.data || [];
          const values = chart.data.datasets?.[0]?.data || [];
          const context = chart.ctx;
          values.forEach((point, index) => {
            if (index === 0) return;
            const flip = magicPersistentTempoFlipInfo(values, index);
            const marker = points[index];
            if (!flip || !marker) return;
            const label = flip.mode === 'half' ? 'Half-Time Flip' : 'Double-Time Flip';
            context.save();
            context.font = '900 10px Barlow, sans-serif';
            const width = context.measureText(label).width + 18;
            const x = Math.max(chart.chartArea.left, Math.min(marker.x - width / 2, chart.chartArea.right - width));
            const y = Math.max(chart.chartArea.top + 4, marker.y - 30);
            context.fillStyle = flip.mode === 'half' ? 'rgba(36,217,255,0.92)' : 'rgba(163,255,0,0.92)';
            context.fillRect(x, y, width, 22);
            context.fillStyle = '#050705';
            context.fillText(label, x + 9, y + 15);
            context.restore();
          });
        }
      };
      bpmChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          datasets: [
            {
              label: 'Track BPM',
              data: trackPoints,
              borderColor: accentColor, borderWidth: 3, tension: 0.08, fill: false,
              backgroundColor: accentFaint,
              pointBackgroundColor: accentColor,
              pointBorderColor: pointOutline,
              pointBorderWidth: 2,
              pointRadius: 6,
              pointHoverRadius: 9
            },
            {
              label: 'Draft Points',
              type: 'scatter',
              data: graphDots,
              backgroundColor: '#22d3ee',
              pointRadius: 8,
              pointBorderColor: isLight ? '#000' : '#fff',
              pointBorderWidth: 2,
              showLine: true,
              borderColor: 'rgba(34, 211, 238, 0.4)',
              borderDash: [5, 5]
            },
            {
              label: 'Anchor Target',
              type: 'scatter',
              data: anchorTargetDot ? [anchorTargetDot] : [],
              backgroundColor: accentColor,
              pointRadius: 11,
              pointBorderColor: '#000',
              pointBorderWidth: 2,
              showLine: false,
              pointStyle: 'circle'
            }
          ]
        },
        plugins: [magicTempoFlipLabelPlugin],
        options: {
          responsive: true, maintainAspectRatio: false,
          layout: {
            padding: { top: 12, right: 14, bottom: 34, left: 8 }
          },
          plugins: { legend: { display: false }, tooltip: { enabled: true } },
          onHover: (event, activeElements) => {
            showMagicPointActions(event, activeElements);
          },
          scales: {
            x: {
              type: 'linear',
              position: 'bottom',
              min: 0,
              max: setLen,
              ticks: {
                callback: v => `${v} MIN`,
                color: labelColor,
                stepSize: Math.max(6, Math.round(setLen / 5)),
                maxRotation: 0,
                autoSkip: true
              },
              grid: { color: gridColor },
              title: { display: false, text: 'Time (Minutes)', color: labelColor, font: { size: 10 } }
            },
            y: {
              position: 'left',
              min: axiomReviewMode() === 'magic-set' ? 60 : 70,
              max: axiomReviewMode() === 'magic-set' ? 145 : 140,
              grid: { color: gridColor },
              ticks: {
                color: labelColor,
                padding: 10,
                stepSize: 10,
                callback: value => value <= 140 ? value : ''
              },
              title: { display: true, text: 'BPM', color: labelColor, font: { size: 10 } }
            }
          },
          onClick: (e) => {
            if (wasDragging) { wasDragging = false; return; }
            const canvasPosition = Chart.helpers.getRelativePosition(e, bpmChartInstance);
            const dataX = Math.round(bpmChartInstance.scales.x.getValueForPixel(canvasPosition.x));
            const dataY = Math.round(bpmChartInstance.scales.y.getValueForPixel(canvasPosition.y));

            // Anchor mode: first click after selecting a compressed set-list track sets the target.
            if (anchorTargetDot && graphAnchorIndex >= 0 && graphDots.length === 0) {
              graphDots = [anchorTargetDot];
              anchorTargetDot = { x: dataX, y: dataY };
              bpmChartInstance.data.datasets[1].data = graphDots;
              bpmChartInstance.data.datasets[2].data = [anchorTargetDot];
              recalcBpmYAxis();
              updateAnchorBtnVisibility();
              return;
            }

            graphDots.push({ x: dataX, y: dataY });
            graphDots.sort((a, b) => a.x - b.x);
            bpmChartInstance.data.datasets[1].data = graphDots;
            recalcBpmYAxis();
          }
        }
      });

      // Right-click on a draft dot or anchor dot to remove it
      document.getElementById('bpmChart').oncontextmenu = (e) => {
        e.preventDefault();
        const rect = e.target.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        // Check anchor dot first (dataset[2])
        if (anchorTargetDot) {
          const meta2 = bpmChartInstance.getDatasetMeta(2);
          if (meta2.data.length > 0) {
            const pt = meta2.data[0];
            const d = Math.hypot(pt.x - mx, pt.y - my);
            if (d < 20) {
              anchorTargetDot = null;
              bpmChartInstance.data.datasets[2].data = [];
              recalcBpmYAxis();
              updateAnchorBtnVisibility();
              return;
            }
          }
        }

        // Check regular draft dots (dataset[1])
        if (!graphDots.length) return;
        const meta = bpmChartInstance.getDatasetMeta(1);
        let closestIdx = -1, closestDist = Infinity;
        meta.data.forEach((pt, i) => {
          const d = Math.hypot(pt.x - mx, pt.y - my);
          if (d < closestDist) { closestDist = d; closestIdx = i; }
        });
        if (closestIdx >= 0 && closestDist < 20) {
          graphDots.splice(closestIdx, 1);
          bpmChartInstance.data.datasets[1].data = graphDots;
          recalcBpmYAxis();
        }
      };

      // ── Drag dots (regular: vertical only; anchor: both axes) ───────────
      let dragIdx = -1;
      let anchorDragging = false;
      let wasDragging = false;
      const bpmCanvasEl = document.getElementById('bpmChart');

      const graphContainerEl = document.getElementById('graph-container');
      if (graphContainerEl && graphContainerEl.dataset.magicPointLeaveBound !== 'true') {
        graphContainerEl.dataset.magicPointLeaveBound = 'true';
        graphContainerEl.addEventListener('mouseleave', () => hideMagicPointActions(500));
      }

      bpmCanvasEl.addEventListener('mousedown', (e) => {
        if (!bpmChartInstance) return;
        const rect = bpmCanvasEl.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        // Check anchor dot first (dataset[2]) — draggable on both axes
        if (anchorTargetDot) {
          const meta2 = bpmChartInstance.getDatasetMeta(2);
          if (meta2.data.length > 0) {
            const d = Math.hypot(meta2.data[0].x - mx, meta2.data[0].y - my);
            if (d < 20) { anchorDragging = true; bpmCanvasEl.style.cursor = 'move'; return; }
          }
        }

        // Regular draft dots (dataset[1]) — vertical only
        if (!graphDots.length) return;
        const meta = bpmChartInstance.getDatasetMeta(1);
        let closestIdx = -1, closestDist = Infinity;
        meta.data.forEach((pt, i) => {
          const d = Math.hypot(pt.x - mx, pt.y - my);
          if (d < closestDist) { closestDist = d; closestIdx = i; }
        });
        if (closestIdx >= 0 && closestDist < 20) {
          dragIdx = closestIdx;
          bpmCanvasEl.style.cursor = 'ns-resize';
        }
      }, true);

      bpmCanvasEl.addEventListener('mousemove', (e) => {
        if (!anchorDragging && dragIdx < 0) return;
        wasDragging = true;
        const rect = bpmCanvasEl.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        if (anchorDragging && anchorTargetDot) {
          anchorTargetDot.x = Math.max(0, Math.round(bpmChartInstance.scales.x.getValueForPixel(mx)));
          anchorTargetDot.y = Math.max(60, Math.min(220, Math.round(bpmChartInstance.scales.y.getValueForPixel(my))));
          bpmChartInstance.data.datasets[2].data = [anchorTargetDot];
          recalcBpmYAxis();
        } else if (dragIdx >= 0) {
          const newBPM = Math.round(bpmChartInstance.scales.y.getValueForPixel(my));
          graphDots[dragIdx].y = Math.max(60, Math.min(220, newBPM));
          bpmChartInstance.data.datasets[1].data = graphDots;
          recalcBpmYAxis();
        }
      }, true);

      bpmCanvasEl.addEventListener('mouseup', () => {
        dragIdx = -1;
        anchorDragging = false;
        bpmCanvasEl.style.cursor = '';
      }, true);
      // ────────────────────────────────────────────────────────────────────

      renderEnergyLadder(audit);
      renderMagicSetJourney();
    }

    function trackIdentity(track) {
      if (!track) return '';
      const path = String(track.path || '').trim();
      if (path) return `path:${path.toLowerCase()}`;
      const title = String(track.title || track.filename || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const artist = String(track.artist || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return `meta:${title}|${artist}`;
    }

    function trackIdentityKeys(trackOrPath) {
      const values = new Set();
      if (typeof trackOrPath === 'string') {
        const path = trackOrPath.trim();
        if (path) values.add(`path:${path.toLowerCase()}`);
        return values;
      }
      const track = trackOrPath || {};
      [
        track.path,
        track.browser_playback_path,
        track.export_path,
        track.browser_relative_path,
        track.relative_path,
        track.webkitRelativePath,
        track.filename
      ].filter(Boolean).forEach(value => values.add(`path:${String(value).trim().toLowerCase()}`));
      const metaKey = trackIdentity({ title: track.title || track.filename || '', artist: track.artist || '' });
      if (metaKey) values.add(metaKey);
      return values;
    }

    function trackMatchesIdentity(track, target) {
      const trackPath = String(typeof track === 'string' ? track : track?.path || '').trim();
      const targetPath = String(typeof target === 'string' ? target : target?.path || '').trim();
      // Two concrete files cannot become the same track through title or alias matches.
      if (trackPath && targetPath) return trackPath === targetPath;
      const trackKeys = trackIdentityKeys(track);
      const targetKeys = trackIdentityKeys(target);
      for (const key of targetKeys) {
        if (trackKeys.has(key)) return true;
      }
      return false;
    }

    function patchTrackListMetadata(list, target, patch) {
      if (!Array.isArray(list)) return false;
      let changed = false;
      list.forEach(track => {
        if (!trackMatchesIdentity(track, target)) return;
        Object.assign(track, patch);
        changed = true;
      });
      return changed;
    }

    function propagateTrackMetadata(path, patch = {}, updatedTrack = null) {
      const cleanPatch = Object.fromEntries(Object.entries({ ...(updatedTrack || {}), ...patch }).filter(([_, value]) => value !== undefined));
      const target = updatedTrack || { path };
      patchTrackListMetadata(currentPlaylist, target, cleanPatch);
      patchTrackListMetadata(currentRoutePlaylist, target, cleanPatch);
      patchTrackListMetadata(mainSearchResults, target, cleanPatch);
      patchTrackListMetadata(studioSearchResults, target, cleanPatch);
      if (Array.isArray(window.lastSuggestions)) patchTrackListMetadata(window.lastSuggestions, target, cleanPatch);
      if (patchTrackListMetadata(favoritesTracks, target, cleanPatch)) _saveFavorites();
      let savedChanged = false;
      savedPlaylists.forEach(set => {
        if (patchTrackListMetadata(set.tracks, target, cleanPatch)) {
          set.updatedAt = new Date().toISOString();
          savedChanged = true;
        }
      });
      if (savedChanged) {
        persistSavedPlaylists();
        refreshPlaylistsView();
      }
      if (selectedSuggestionData && trackMatchesIdentity(selectedSuggestionData, target)) Object.assign(selectedSuggestionData, cleanPatch);
      if (currentAnchorTrack && trackMatchesIdentity(currentAnchorTrack, target)) Object.assign(currentAnchorTrack, cleanPatch);
      for (const [key, value] of trackVisualCache.entries()) {
        if (trackMatchesIdentity({ ...value, path: value?.path || key }, target)) {
          trackVisualCache.set(key, { ...value, ...cleanPatch });
        }
      }
      renderPlaylist();
      if (currentRoutePlaylist.length) updateHarmonicRouteVisibility();
      if(Object.hasOwn(cleanPatch,'bpm'))window.AxiomStudioDaw?.updateLibraryBpm?.(path,cleanPatch.bpm);
      return cleanPatch;
    }

    function studioTrackLists() {
      return [currentPlaylist, currentRoutePlaylist].filter(Array.isArray);
    }

    function studioHasTrack(track) {
      if (!track) return false;
      return studioTrackLists().some(list => list.some(existing => trackMatchesIdentity(existing, track)));
    }

    function playlistHasTrack(track) {
      return studioHasTrack(track);
    }

    function getUsedTrackPaths(extraTracks = []) {
      return [...currentPlaylist, ...currentRoutePlaylist, ...extraTracks]
        .map(track => track?.path)
        .filter(Boolean);
    }

    function getUsedTrackBlacklist(extraTracks = []) {
      const values = new Set();
      [...currentPlaylist, ...currentRoutePlaylist, ...extraTracks].forEach(track => {
        if (!track) return;
        [
          track.path,
          track.browser_playback_path,
          track.export_path,
          track.browser_relative_path,
          track.relative_path,
          track.webkitRelativePath,
          track.filename,
          `${track.artist || ''}-${track.title || ''}`
        ].filter(Boolean).forEach(value => values.add(String(value)));
      });
      return [...values];
    }

    function dedupePlaylistTracks(tracks) {
      const seen = new Set();
      const unique = [];
      (tracks || []).forEach(track => {
        const key = trackIdentity(track);
        if (key && seen.has(key)) return;
        if (key) seen.add(key);
        unique.push(track);
      });
      return unique;
    }
