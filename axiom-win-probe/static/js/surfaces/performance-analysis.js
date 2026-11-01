    // Performance recommendation analysis and ranking. Loaded as a classic script.
    function performanceTrackYear(track = {}) {
      const raw = track.year || track.release_year || track.released || track.date || '';
      const match = String(raw || '').match(/\b(19|20)\d{2}\b/);
      return match ? parseInt(match[0], 10) : 0;
    }

    function performanceTrackEraKey(track = {}) {
      const override = String(track.era_override || '').trim();
      const overrideKeys = {
        'Retro One': '1950s–70s',
        'Retro 2': 'Late 70s–80s',
        'The 90s': '1990s',
        '2k Era': '2000s',
        '2010s': '2010s',
        'Pre-Covid': '2010s',
        'Post-Covid': '2020s',
        'Old': '2020s',
        'Recent': '2020s',
        'New': '2020s'
      };
      if (overrideKeys[override]) return overrideKeys[override];
      const year = performanceTrackYear(track);
      if (!year) return '';
      if (year >= 2020) return '2020s';
      return `${Math.floor(year / 10) * 10}s`;
    }

    function performanceTrackRoot(track = {}) {
      return getRootFromSuggestion(track) || '';
    }

    function performanceTrackGenre(track = {}) {
      return String(track.genre || track.dna_genre || track.category || '').trim();
    }

    function performanceEnergyRank(track = {}) {
      const raw = String(track.energy || modalTrackEnergy(track) || '').toLowerCase();
      if (raw.includes('peak') || raw.includes('high')) return 3;
      if (raw.includes('mid')) return 2;
      if (raw.includes('low')) return 1;
      return 0;
    }

    function performanceLaneLabel(lane = performanceLaneLock) {
      return {
        urban: 'Urban',
        rnb: 'RNB',
        singalong: 'Singalong',
        clean: 'Clean',
        peak: 'Peak'
      }[lane] || '';
    }

    function performanceTrackSearchText(track = {}) {
      return [
        track.title,
        track.name,
        track.filename,
        track.artist,
        track.genre,
        track.dna_genre,
        track.category,
        track.axiom_role,
        track.energy
      ].filter(Boolean).join(' ').toLowerCase();
    }

    function performanceTrackCleanClassification(track = {}) {
      const explicitFields = ['explicit', 'is_explicit', 'content_explicit'];
      const cleanFields = ['clean', 'is_clean', 'radio_safe', 'family_safe'];
      const hasBooleanState = (fields, expected) => fields.some(field =>
        Object.prototype.hasOwnProperty.call(track, field) && track[field] === expected
      );
      const explicitValue = explicitFields
        .map(field => track[field])
        .find(value => typeof value === 'string' && value.trim());
      const cleanValue = cleanFields
        .map(field => track[field])
        .find(value => typeof value === 'string' && value.trim());
      const structuredVersion = [
        track.version,
        track.version_name,
        track.edit_type,
        track.mix_name,
        track.content_rating,
        track.lyrics_mode,
        explicitValue,
        cleanValue
      ].filter(Boolean).join(' ').toLowerCase();
      const visibleVersion = [
        track.title,
        track.name,
        track.filename,
        track.category,
        track.tags,
        track.comments
      ].filter(Boolean).join(' ').toLowerCase();
      const explicitMarker = /\b(explicit|uncensored|uncut|xxx|adult version)\b/.test(`${structuredVersion} ${visibleVersion}`)
        || /(?:^|[\(\[\{_\-])\s*dirty\s*(?:[\)\]\}_\-]|$)/.test(visibleVersion)
        || /\bdirty\s+(?:edit|version|intro|outro|short|extended)\b/.test(visibleVersion);
      if (hasBooleanState(explicitFields, true) || explicitMarker) return 'explicit';

      const structuredCleanMarker = /\b(clean|radio safe|family safe|censored|all ages)\b/.test(structuredVersion);
      const visibleCleanMarker = /\b(clean\s+(?:edit|version|intro|outro|short|extended)|radio\s+(?:edit|version|clean)|censored|family friendly|all ages)\b/.test(visibleVersion)
        || /(?:^|[\(\[\{_\-])\s*clean\s*(?:[\)\]\}_\-]|$)/.test(visibleVersion);
      if (hasBooleanState(cleanFields, true) || hasBooleanState(explicitFields, false) || structuredCleanMarker || visibleCleanMarker) return 'clean';
      return 'unknown';
    }

    function performanceTrackIsVerifiedClean(track = {}) {
      return performanceTrackCleanClassification(track) === 'clean';
    }

    function performanceTrackMatchesLane(track = {}, lane = performanceLaneLock) {
      if (!lane) return true;
      const text = performanceTrackSearchText(track);
      const root = performanceTrackRoot(track).toLowerCase();
      const energyRank = performanceEnergyRank(track);
      if (lane === 'urban') return root === 'urban' || /\b(hip hop|rap|rnb|r&b|trap|jersey|ratchet|afro|dancehall)\b/.test(text);
      if (lane === 'rnb') {
        if (/\b(rnb|r&b|r n b|soul|slow jam|slowjam|neo soul|quiet storm)\b/.test(text)) return true;
        return root === 'urban' && !/\b(trap|drill|ratchet|jersey|twerk|hype|hardcore)\b/.test(text);
      }
      if (lane === 'singalong') return /\b(sing|anthem|classic|throwback|lyrics?|karaoke|radio|pop|rnb|r&b)\b/.test(text) || ['pop', 'urban'].includes(root);
      if (lane === 'clean') return performanceTrackIsVerifiedClean(track);
      if (lane === 'peak') return energyRank >= 3 || /\b(peak|club|hype|banger|anthem|party|dance|high energy)\b/.test(text);
      return true;
    }

    function performanceTrackHasStingerSignal(track = {}) {
      const text = performanceTrackSearchText(track);
      return /\b(stinger|sting|station id|dj drop|drop only|sweep|sweeper)\b/.test(text);
    }

    function performanceTrackHasToolSignal(track = {}) {
      const text = performanceTrackSearchText(track);
      const root = performanceTrackRoot(track).toLowerCase();
      if (root === 'utility') return true;
      return /\b(tool|tools|utility|transition|sound fx|sfx|fx|acapella|acap|instrumental|scratch|scratch tool|loop)\b/.test(text);
    }

    function performanceTrackAllowedByExcludes(track = {}) {
      if (!performanceExcludeKinds.size) return true;
      if (performanceExcludeKinds.has('stingers') && performanceTrackHasStingerSignal(track)) return false;
      if (performanceExcludeKinds.has('tools') && performanceTrackHasToolSignal(track)) return false;
      return true;
    }

    function performanceBpmDistanceFromAnchor(track = {}) {
      const anchor = normalizeModalTrackMetadata(performanceAnchorTrack || {});
      const bpmContext = performanceLiveBpmContext();
      const anchorBpm = Number(bpmContext.targetBpm || anchor.bpm || anchor.serato_bpm || 0);
      const trackBpm = Number(track.bpm || track.serato_bpm || 0);
      if (!Number.isFinite(anchorBpm) || !Number.isFinite(trackBpm) || anchorBpm <= 0 || trackBpm <= 0) {
        return Number.POSITIVE_INFINITY;
      }
      if (bpmContext.manualBpm || bpmContext.liveBpm || performanceTempoIntent) {
        return Math.abs(trackBpm - anchorBpm);
      }
      return Math.min(
        Math.abs(trackBpm - anchorBpm),
        Math.abs(trackBpm - (anchorBpm * 2)),
        Math.abs(trackBpm - (anchorBpm / 2))
      );
    }

    function performanceBpmGuardDistance(track = {}) {
      const anchor = normalizeModalTrackMetadata(performanceAnchorTrack || {});
      const anchorBpm = Number(performanceLiveBpmContext().targetBpm || anchor.bpm || anchor.serato_bpm || 0);
      const trackBpm = Number(track.bpm || track.serato_bpm || 0);
      if (!Number.isFinite(anchorBpm) || !Number.isFinite(trackBpm) || anchorBpm <= 0 || trackBpm <= 0) {
        return Number.POSITIVE_INFINITY;
      }
      return Math.abs(trackBpm - anchorBpm);
    }

    function performanceBpmGuardScore(track = {}) {
      const distance = performanceBpmGuardDistance(track);
      if (!Number.isFinite(distance)) return 0;
      if (distance <= 2) return 26;
      if (distance <= 4) return 20;
      if (distance <= 6) return 14;
      if (distance <= 10) return 4;
      return -Math.min(30, Math.round((distance - 10) * 2));
    }

    function performanceBpmGuardActive(track = {}) {
      const distance = performanceBpmGuardDistance(track);
      return Number.isFinite(distance) && distance <= 6;
    }

    function performanceCamelotParts(track = {}) {
      const normalized = normalizeModalTrackMetadata(track || {});
      const key = normalizeCamelotKey(normalized.camelot || normalized.key || normalized.key_raw || normalized.initial_key || '');
      const match = String(key || '').trim().match(/^(\d{1,2})([AB])$/i);
      if (!match) return null;
      const num = parseInt(match[1], 10);
      if (!Number.isFinite(num) || num < 1 || num > 12) return null;
      return { num, letter: match[2].toUpperCase(), key: `${num}${match[2].toUpperCase()}` };
    }

    function performanceKeyGuardScore(track = {}) {
      const anchor = performanceCamelotParts(performanceAnchorTrack || {});
      const candidate = performanceCamelotParts(track || {});
      if (!anchor || !candidate) return 0;
      if (anchor.key === candidate.key) return 24;
      if (anchor.num === candidate.num) return 16;
      const rawDiff = Math.abs(anchor.num - candidate.num);
      const wheelDiff = Math.min(rawDiff, 12 - rawDiff);
      if (wheelDiff === 1 && anchor.letter === candidate.letter) return 14;
      if (wheelDiff === 1) return 8;
      if (wheelDiff === 2 && anchor.letter === candidate.letter) return 3;
      return 0;
    }

    function performanceKeyGuardActive(track = {}) {
      return performanceKeyGuardScore(track) >= 14;
    }

    function performanceSafePick(track = {}) {
      const normalized = normalizeModalTrackMetadata(track || {});
      if (performanceTrackHasStingerSignal(normalized) || performanceTrackHasToolSignal(normalized)) return false;
      if (performanceBpmGuardDistance(normalized) > 6) return false;
      const match = modalSuggestionMatch(normalized);
      return (match.confidence || 0) >= 72;
    }

    function performanceRescueScore(track = {}) {
      const normalized = normalizeModalTrackMetadata(track || {});
      const anchorEnergy = performanceEnergyRank(performanceAnchorTrack || {});
      const trackEnergy = performanceEnergyRank(normalized);
      const bpmDistance = performanceBpmGuardDistance(normalized);
      const match = modalSuggestionMatch(normalized);
      const text = performanceTrackSearchText(normalized);
      let score = 0;
      if (Number.isFinite(bpmDistance)) score += Math.max(0, 8 - bpmDistance) * 3;
      if (performanceSafePick(normalized)) score += 22;
      score += Math.max(0, (match.confidence || 0) - 70) / 2;
      if (anchorEnergy && trackEnergy >= anchorEnergy) score += 8;
      if (trackEnergy >= 3) score += 6;
      if (/\b(anthem|classic|hit|single|club|party|singalong|radio|remix|quick hit|quickhit)\b/.test(text)) score += 7;
      if (/\b(clean|radio edit)\b/.test(text)) score += 3;
      if (performanceTrackHasStingerSignal(normalized) || performanceTrackHasToolSignal(normalized)) score -= 30;
      if (/\b(deep|rare|album|lp|interlude|intro only|outro only)\b/.test(text)) score -= 8;
      return score;
    }

    function performanceLaneScore(track = {}) {
      if (!performanceLaneLock) return 0;
      return performanceTrackMatchesLane(track, performanceLaneLock) ? 28 : -8;
    }

    function performanceRememberPreference(track = {}, mode = 'liked') {
      const genre = performanceTrackGenre(track).toLowerCase();
      const root = performanceTrackRoot(track).toLowerCase();
      if (genre) performancePreferredGenres.add(genre);
      if (root) performancePreferredRoots.add(root);
      if (mode === 'choice') performanceFeedbackCounts.choices += 1;
      if (mode === 'liked') performanceFeedbackCounts.liked += 1;
    }

    function performanceScoreSuggestion(track = {}) {
      let score = 0;
      const genre = performanceTrackGenre(track).toLowerCase();
      const root = performanceTrackRoot(track).toLowerCase();
      const anchorEnergy = performanceEnergyRank(performanceAnchorTrack || {});
      const trackEnergy = performanceEnergyRank(track);
      const year = performanceTrackYear(track);

      if (genre && performancePreferredGenres.has(genre)) score += 18;
      if (root && performancePreferredRoots.has(root)) score += 12;
      const era = performanceTrackEraKey(track);
      if (era && performancePreferredEras.has(era)) score += 18;
      score += performanceLaneScore(track);
      score += performanceBpmGuardScore(track);
      score += performanceKeyGuardScore(track);
      if (performanceEnergyIntent === 'up' && trackEnergy && anchorEnergy) score += Math.max(0, trackEnergy - anchorEnergy) * 10;
      if (performanceEnergyIntent === 'down' && trackEnergy && anchorEnergy) score += Math.max(0, anchorEnergy - trackEnergy) * 10;
      if (performanceRescueMode) score += performanceRescueScore(track);
      if (performanceMinYear && year >= performanceMinYear) score += 10;
      if (performanceMinYear && !year) score += 2;
      if (performanceTimeline.length) {
        const lastRoot = performanceTrackRoot(performanceTimeline[performanceTimeline.length - 1] || {}).toLowerCase();
        if (root && root === lastRoot) score += 4;
      }
      return score;
    }

    function performanceLiveTempoNeedsRefresh(now = Date.now()) {
      const context = performanceLiveBpmContext();
      const key = performanceTrackKey(performanceAnchorTrack || {});
      const targetBpm = Number(context.targetBpm || 0);
      if (!key || !targetBpm || !performanceSuggestionTempo || performanceSuggestionTempo.key !== key) return false;
      const delta = Math.abs(targetBpm - performanceSuggestionTempo.targetBpm);
      // Compare with the last requested tempo, not the previous poll, so slow
      // intentional nudges accumulate while tenths-of-a-BPM noise stays quiet.
      if (delta < 0.5) {
        performanceLiveTempoPending = null;
        return false;
      }
      if (context.playingBpm && delta >= 2) return true;
      const source = context.playingBpm ? 'live' : 'track';
      if (!performanceLiveTempoPending || performanceLiveTempoPending.key !== key
          || performanceLiveTempoPending.source !== source
          || Math.abs(performanceLiveTempoPending.targetBpm - targetBpm) >= 0.5) {
        performanceLiveTempoPending = { key, source, targetBpm, since: now };
        return false;
      }
      // A missing deck read is not a tempo change. Keep the readout truthful,
      // but give it three seconds to recover before rebuilding at stored BPM.
      return now - performanceLiveTempoPending.since >= (context.playingBpm ? 1000 : 3000);
    }

    function performanceShuffleHash(value = '') {
      let hash = 2166136261;
      const input = String(value || '');
      for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0;
    }

    function performanceSuggestionShuffleScore(track = {}, index = 0) {
      const anchor = normalizeModalTrackMetadata(performanceAnchorTrack || {});
      const candidate = normalizeModalTrackMetadata(track || {});
      const key = [
        performanceSuggestionShuffleSeed,
        performanceTrackKey(anchor),
        performanceTempoIntent,
        performanceLaneLock,
        performanceRescueMode ? 'rescue' : '',
        performanceSafePicks ? 'safe' : '',
        performanceCleanOnly ? 'clean-only' : '',
        performanceDigDeeper ? 'deep' : '',
        performanceGigProfileEnabled ? performanceGigProfileId : '',
        performanceGigProfileOnlySelected ? 'only-selected' : '',
        candidate.path,
        candidate.artist,
        candidate.title
      ].join('|');
      return performanceShuffleHash(key);
    }

    function performanceDigDeeperScore(track = {}) {
      const normalized = normalizeModalTrackMetadata(track || {});
      const genre = performanceTrackGenre(normalized).toLowerCase();
      const root = performanceTrackRoot(normalized).toLowerCase();
      const text = performanceTrackSearchText(normalized);
      const year = performanceTrackYear(normalized);
      const bpmDistance = performanceBpmDistanceFromAnchor(normalized);
      const match = modalSuggestionMatch(normalized);
      let score = 0;
      if (Number.isFinite(bpmDistance)) score += Math.max(0, 12 - bpmDistance) * 2;
      if (genre && !performancePreferredGenres.has(genre)) score += 10;
      if (root && !performancePreferredRoots.has(root)) score += 4;
      if (year && year < 2015) score += 7;
      if (year && year >= 2020) score += 3;
      if (/\b(album|lp|deep|rare|classic|throwback|slow jam|slowjam|soul)\b/.test(text)) score += 6;
      if (/\b(top 40|radio|viral|tiktok|quick hit|quickhit|hype intro|bpm supreme)\b/.test(text)) score -= 4;
      score += Math.max(0, (match.confidence || 0) - 68) / 4;
      return score;
    }

    function performanceBpmCue(track = {}) {
      const anchor = normalizeModalTrackMetadata(performanceAnchorTrack || {});
      const anchorBpm = Number(performanceLiveBpmContext().targetBpm || anchor.bpm || anchor.serato_bpm || 0);
      const trackBpm = Number(track.bpm || track.serato_bpm || 0);
      if (!Number.isFinite(anchorBpm) || !Number.isFinite(trackBpm) || anchorBpm <= 0 || trackBpm <= 0) return '';
      const from = anchorBpm.toFixed(1);
      const to = trackBpm.toFixed(1);
      const gap = Math.abs(trackBpm - anchorBpm);
      if (performanceTempoIntent === 'double') return `Double-time lane ${from} to ${to}`;
      if (performanceTempoIntent === 'half') return `Half-time lane ${from} to ${to}`;
      const ratioMove = performanceBpmRatioMove(anchorBpm, trackBpm);
      if (ratioMove === 'double') return `Double-time option ${from} to ${to}`;
      if (ratioMove === 'half') return `Half-time option ${from} to ${to}`;
      if (gap <= 2) return `Tight BPM ${from} to ${to}`;
      if (gap <= 6) return `Small tempo step ${from} to ${to}`;
      if (gap <= 12) return `Reachable tempo move ${from} to ${to}`;
      return `BPM jump ${from} to ${to}`;
    }

    function performanceCueReasons(track = {}, match = null) {
      const reasons = [];
      const normalized = normalizeModalTrackMetadata(track || {});
      const bpmCue = performanceBpmCue(normalized);
      const genre = performanceTrackGenre(normalized);
      const root = performanceTrackRoot(normalized);
      const year = performanceTrackYear(normalized);
      const activeMatch = match || modalSuggestionMatch(normalized);
      if (performanceRescueMode) reasons.push('Rescue');
      if (performanceSafePicks && performanceSafePick(normalized)) reasons.push('Safe Pick');
      if (performanceBpmGuardActive(normalized)) reasons.push('BPM Guard');
      if (performanceKeyGuardActive(normalized)) reasons.push('Key Guard');
      if (performanceDigDeeper) reasons.push('Dig Deeper');
      if (bpmCue) reasons.push(bpmCue);
      if (performanceLaneLock && performanceTrackMatchesLane(normalized, performanceLaneLock)) {
        reasons.push(`${performanceLaneLabel()} lock`);
      } else if (root) {
        reasons.push(`${root} lane`);
      }
      if (genre) reasons.push(genre);
      if (year) reasons.push(String(year));
      if (activeMatch?.label) reasons.push(activeMatch.label);
      if (performanceExcludeKinds.has('stingers') && !performanceTrackHasStingerSignal(normalized)) reasons.push('No stinger');
      if (performanceExcludeKinds.has('tools') && !performanceTrackHasToolSignal(normalized)) reasons.push('No tool');
      return [...new Set(reasons.filter(Boolean))].slice(0, 5);
    }

    function renderPerformanceCue(track = {}, match = null) {
      const reasons = performanceCueReasons(track, match);
      if (!reasons.length) return '';
      return `
        <div class="performance-cue" aria-label="Why AXIOM recommends this track">
          ${reasons.map(reason => `<span>${escapeHtml(reason)}</span>`).join('')}
        </div>
      `;
    }

    function performanceTrackKey(track = {}) {
      const normalized = normalizeModalTrackMetadata(track || {});
      return String(normalized.path || `${normalized.artist || ''}-${normalized.title || ''}`).trim().toLowerCase();
    }

    function performanceLiveTrackIdentity(track = {}) {
      const normalized = normalizeModalTrackMetadata(track || {});
      const provider = String(normalized.live_provider || track.live_provider || 'dj').trim().toLowerCase();
      const title = performanceCleanIdentity(normalized.title || track.title || track.name || track.filename || 'unknown title');
      const artist = performanceCleanIdentity(normalized.artist || track.artist || 'unknown artist');
      const sessionId = String(track.session_id || normalized.session_id || '').trim();
      const rowId = String(track.id || normalized.id || '').trim();
      const startTime = String(track.start_time || normalized.start_time || '').trim();
      const marker = rowId
        ? `${sessionId}:${rowId}`
        : (provider === 'serato' && startTime ? `${sessionId}:${startTime}` : '');
      return {
        key: `${provider}|${title || artist}`,
        marker: marker ? `${provider}|${marker}` : '',
      };
    }

    function performanceTrackProviderTone(track = {}) {
      const normalized = normalizeModalTrackMetadata(track || {});
      // Live-session ownership is authoritative. A library row can retain
      // historical Serato/djay metadata even when the other DJ application is
      // currently driving Performance Mode, so never let those fallback
      // fields override an explicit live provider.
      const explicitLiveProvider = String(
        normalized.live_provider
        || track.live_provider
        || normalized.active_provider
        || track.active_provider
        || ''
      ).trim().toLowerCase();
      if (explicitLiveProvider === 'djay' || explicitLiveProvider === 'serato') {
        return explicitLiveProvider;
      }
      const connectedProvider = String(
        normalized.connected_from || track.connected_from || ''
      ).trim().toLowerCase();
      if (connectedProvider.includes('djay')) return 'djay';
      if (connectedProvider.includes('serato')) return 'serato';
      const providerText = [
        normalized.source,
        track.source,
        normalized.source_label,
        track.source_label,
      ].map(value => String(value || '').trim().toLowerCase()).join(' ');
      if (providerText.includes('djay')) return 'djay';
      if (providerText.includes('serato')) return 'serato';
      return '';
    }

    function performanceNowPlayingColourPreference() {
      const stored = String(localStorage.getItem(PERFORMANCE_NOW_PLAYING_COLOUR_KEY) || 'auto').trim().toLowerCase();
      return ['auto', 'axiom', 'serato', 'djay'].includes(stored) ? stored : 'auto';
    }

    function performanceNowPlayingColourTone(track = {}) {
      const preference = performanceNowPlayingColourPreference();
      if (preference !== 'auto') return preference;
      return performanceTrackProviderTone(track) || 'axiom';
    }

    function applyPerformanceNowPlayingColourPreference() {
      const preference = performanceNowPlayingColourPreference();
      const select = document.getElementById('performance-now-playing-colour-select');
      if (select) select.value = preference;
      renderPerformanceNow();
      return preference;
    }

    function setPerformanceNowPlayingColour(value = 'auto') {
      const preference = ['auto', 'axiom', 'serato', 'djay'].includes(String(value || '').trim().toLowerCase())
        ? String(value).trim().toLowerCase()
        : 'auto';
      localStorage.setItem(PERFORMANCE_NOW_PLAYING_COLOUR_KEY, preference);
      applyPerformanceNowPlayingColourPreference();
      const labels = { auto: 'Match DJ Software', axiom: 'AXIOM Green', serato: 'Serato Blue', djay: 'djay Pro Orange' };
      showToast(`Now Playing colour: ${labels[preference]}.`);
    }

    function performanceLiveTrackDisplaySignature(track = {}) {
      const normalized = normalizeModalTrackMetadata(track || {});
      return JSON.stringify([
        performanceTrackProviderTone(normalized),
        normalized.path || '',
        normalized.title || '',
        normalized.artist || '',
        Number(normalized.bpm || normalized.serato_bpm || 0),
        Number(normalized.playing_bpm || normalized.serato_playing_bpm || 0),
        Number(normalized.native_bpm || normalized.track_bpm || 0),
        normalized.camelot || normalized.key || '',
        normalized.energy || '',
        normalized.genre || '',
        normalized.year || normalized.release_year || '',
        normalized.deck || '',
      ]);
    }

    function performanceIsNewLiveTrackLoad(track = {}) {
      const identity = performanceLiveTrackIdentity(track);
      const sameLoadMarker = Boolean(
        identity.marker
        && performanceLiveTrackLoadMarker
        && identity.marker === performanceLiveTrackLoadMarker
      );
      const identityChanged = Boolean(
        identity.key
        && identity.key !== performanceLiveTrackIdentityKey
        && !sameLoadMarker
      );
      const replayedSameSong = Boolean(
        !identityChanged
        && identity.marker
        && performanceLiveTrackLoadMarker
        && identity.marker !== performanceLiveTrackLoadMarker
      );
      const isFirstLoad = !performanceLiveTrackIdentityKey;
      performanceLiveTrackIdentityKey = identity.key;
      if (identity.marker) performanceLiveTrackLoadMarker = identity.marker;
      return isFirstLoad || identityChanged || replayedSameSong;
    }

    function performanceCleanIdentity(value = '') {
      return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
    }

    function performanceArtistIdentity(value = '') {
      return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\b(feat|ft|featuring)\.?\b.*$/i, ' ')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
    }

    function performanceBasename(value = '') {
      return String(value || '').split(/[\\/]/).pop();
    }

    function performanceStem(value = '') {
      return performanceBasename(value).replace(/\.[^.]+$/, '');
    }

    function performanceSongFamilyTitle(value = '') {
      let clean = String(value || '').trim().toLowerCase();
      clean = clean.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_/g, ' ');
      clean = clean.replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' ');
      clean = clean.replace(/\b(feat|ft|featuring)\.?\b.*$/i, ' ');
      const versionWords = /\b(intro|outro|clean|dirty|explicit|radio|edit|remix|refix|rework|bootleg|mashup|transition|quick|short|long|extended|acap|acapella|instrumental|single|video|snipz|kidcutup|mrefresh|mfresh|markcutz|break|redrum|starter|throwback|version|club|mix)\b/i;
      const parts = clean.split(/\s+-\s+/);
      if (parts.length > 1 && parts.slice(1).some(part => versionWords.test(part))) {
        clean = parts[0];
      }
      clean = clean.replace(/\b(clean|dirty|explicit|intro|outro|radio|edit|remix|refix|rework|bootleg|mashup|transition|quick|short|long|extended|acap|acapella|instrumental|single|video|version|club|mix|hd|hq|xxx)\b/gi, ' ');
      clean = clean.replace(/[^a-z0-9]+/g, ' ');
      return clean.trim().replace(/\s+/g, ' ');
    }

    function performanceSongFamilyArtist(value = '') {
      return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\b(feat|ft|featuring)\.?\b.*$/i, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
    }

    function performanceTrackSongFamilyValues(track = {}) {
      const normalized = normalizeModalTrackMetadata(track || {});
      const path = normalized.path || track.path || '';
      const filename = normalized.filename || track.filename || performanceBasename(path);
      const artist = performanceSongFamilyArtist(normalized.artist || track.artist || '');
      const titleCandidates = [
        normalized.title || track.title || track.name || '',
        performanceStem(filename),
        performanceStem(path)
      ];
      [performanceStem(filename), performanceStem(path)].forEach(value => {
        const parts = String(value || '').split(/\s+-\s+/);
        if (parts.length > 1) titleCandidates.push(parts.slice(1).join(' - '));
      });
      const values = [];
      titleCandidates.forEach(value => {
        const title = performanceSongFamilyTitle(value);
        if (!title) return;
        values.push(`song::${title}`);
        if (artist) values.push(`song::${artist}::${title}`);
        const compactTitle = title.replace(/\s+/g, '');
        if (compactTitle.length >= 6) {
          values.push(`songcompact::${compactTitle}`);
          if (artist) values.push(`songcompact::${artist.replace(/\s+/g, '')}::${compactTitle}`);
        }
      });
      return values;
    }

    function performanceTrackSuggestionFamilyKeys(track = {}) {
      const values = performanceTrackSongFamilyValues(track);
      const artistKeys = values.filter(value => /^song(?:compact)?::[^:]+::[^:]+$/.test(value));
      const titleKeys = values.filter(value => /^song(?:compact)?::[^:]+$/.test(value)).filter(value => {
        const title = value.replace(/^song(?:compact)?::/, '').trim();
        return value.startsWith('songcompact::')
          ? title.length >= 6
          : (title.length >= 8 || title.split(/\s+/).length >= 2);
      });
      return [...new Set([...artistKeys, ...titleKeys].map(performanceCleanIdentity).filter(Boolean))];
    }

    function performanceTrackSuggestionArtistKey(track = {}) {
      const normalized = normalizeModalTrackMetadata(track || {});
      const artist = performanceArtistIdentity(normalized.artist || track.artist || '');
      return artist && artist.length >= 2 ? `artist::${artist}` : '';
    }

    function performanceSpreadSongFamilies(items = [], limit = 16) {
      const selected = [];
      const usedFamilies = new Set();
      const artistCounts = new Map();
      const overflow = [];
      items.forEach(item => {
        const keys = [String(item.track.path || '').toLowerCase(), ...performanceTrackSuggestionFamilyKeys(item.track)].filter(Boolean);
        const artistKey = performanceTrackSuggestionArtistKey(item.track);
        const duplicate = keys.length && keys.some(key => usedFamilies.has(key));
        const artistCount = artistKey ? (artistCounts.get(artistKey) || 0) : 0;
        const artistCrowded = artistKey && artistCount >= 2;
        // A different edit is still the same song, never overflow filler.
        if (duplicate) return;
        keys.forEach(key => usedFamilies.add(key));
        if (artistCrowded) {
          overflow.push(item);
          return;
        }
        selected.push(item);
        if (artistKey) artistCounts.set(artistKey, artistCount + 1);
      });
      return [...selected, ...overflow].slice(0, limit);
    }

    function performanceTrackIdentityValues(track = {}) {
      const normalized = normalizeModalTrackMetadata(track || {});
      const path = normalized.path || track.path || '';
      const filename = normalized.filename || track.filename || performanceBasename(path);
      const title = normalized.title || track.title || track.name || '';
      const artist = normalized.artist || track.artist || '';
      return [
        path,
        performanceBasename(path),
        performanceStem(path),
        filename,
        performanceStem(filename),
        artist && title ? `${artist}-${title}` : '',
        artist && title ? `${artist}::${title}` : '',
        performanceTrackKey(normalized),
        ...performanceTrackSongFamilyValues(normalized)
      ].map(performanceCleanIdentity).filter(Boolean);
    }

    function performancePlayedIdentitySet() {
      const values = new Set(performanceSessionPlayedFamilies);
      performanceTimeline.filter(Boolean).forEach(track => {
        performanceTrackIdentityValues(track).forEach(value => values.add(value));
      });
      return values;
    }

    function performanceWasPlayed(track = {}) {
      const played = performancePlayedIdentitySet();
      return performanceTrackIdentityValues(track).some(value => played.has(value));
    }

    function performanceRecentArtistSet(limit = 8) {
      const recent = [performanceAnchorTrack, ...performanceTimeline.slice(-limit).reverse(), performanceSeratoLastTrack].filter(Boolean);
      const artists = new Set();
      recent.forEach(track => {
        const normalized = normalizeModalTrackMetadata(track || {});
        const artist = performanceArtistIdentity(normalized.artist || track.artist || '');
        if (artist) artists.add(artist);
      });
      return artists;
    }

    function performanceArtistOnCooldown(track = {}) {
      if (!performanceArtistCooldown) return false;
      const artist = performanceArtistIdentity(track.artist || normalizeModalTrackMetadata(track || {}).artist || '');
      if (!artist) return false;
      return performanceRecentArtistSet().has(artist);
    }

    function performancePlayedBlacklist() {
      const values = new Set(performanceSessionPlayedFamilies);
      performanceTimeline.filter(Boolean).forEach(track => {
        performanceTrackIdentityValues(track).forEach(value => values.add(value));
      });
      return [...values];
    }

    function performanceTrackPlayDurationSeconds(track = {}) {
      const start = Number(track.start_time || 0);
      const end = Number(track.end_time || 0);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0 || end <= start) return 0;
      let duration = end - start;
      // Modern epoch milliseconds must be converted even for plays shorter than 43.2 seconds.
      if (start > 1e11 && end > 1e11) duration /= 1000;
      else if (duration > 43200 && duration / 1000 <= 43200) duration /= 1000;
      return duration > 0 && duration <= 43200 ? duration : 0;
    }

    function performanceTrackFamilyRejected(track = {}) {
      const keys = performanceTrackSuggestionFamilyKeys(track);
      return keys.some(key => performanceRejectedFamilies.has(key));
    }

    function performanceRejectTrackFamily(track = {}) {
      performanceTrackSuggestionFamilyKeys(track).forEach(key => performanceRejectedFamilies.add(key));
      queuePerformanceLiveAssistStateSync();
    }

    function performanceSuggestionForPath(path) {
      const key = String(path || '');
      return performanceSuggestions.find(track => String(track.path || '') === key)
        || trackVisualCache.get(key)
        || null;
    }

    function performanceSelectSuggestion(event, path) {
      if (event?.target?.closest('button')) return;
      const nextPath = String(path || '');
      if (!nextPath) return;
      performanceSelectedSuggestionPath = nextPath;
      renderPerformanceSuggestions();
    }

    function performanceSetSeratoStatus(message = '', active = false) {
      const status = document.getElementById('performance-serato-status');
      const toggle = document.getElementById('performance-serato-toggle');
      if (status) {
        status.textContent = message || (performanceSeratoEnabled ? 'DJ auto: watching when Performance is open' : 'DJ auto: paused');
        status.style.color = active ? 'rgba(163,255,0,0.82)' : '';
      }
      if (toggle) {
        toggle.classList.toggle('active', performanceSeratoEnabled);
        toggle.textContent = performanceSeratoEnabled ? 'DJ Auto On' : 'DJ Auto Off';
      }
      ['performance-receipt-dj-auto'].forEach(id => {
        const button = document.getElementById(id);
        if (!button) return;
        button.classList.toggle('active', performanceSeratoEnabled);
        button.textContent = performanceSeratoEnabled ? 'DJ Auto On' : 'DJ Auto Off';
      });
    }

    function performanceFindCachedTrack(path = '') {
      const key = String(path || '');
      if (!key) return null;
      const pools = [
        ...(Array.isArray(mainSearchResults) ? mainSearchResults : []),
        ...(Array.isArray(studioSearchResults) ? studioSearchResults : []),
        ...(Array.isArray(currentPlaylist) ? currentPlaylist : []),
        ...Array.from(trackVisualCache.values())
      ];
      return pools.find(track => String(track?.path || '') === key) || trackVisualCache.get(key) || null;
    }

    function performanceNormalizeLiveTrack(track = {}, options = {}) {
      const path = String(track.path || '').trim();
      const cached = performanceFindCachedTrack(path) || {};
      const timeline = track.axiom_timeline_saved ? track : cached;
      const reportedBpm = Number(track.serato_bpm || track.bpm || 0);
      const cachedBpm = Number(cached.bpm || 0);
      const liveBpm = Number.isFinite(reportedBpm) && reportedBpm > 0 ? reportedBpm : cachedBpm;
      const previousLive = options.preservePlayingBpm ? (performanceSeratoLastTrack || {}) : {};
      const previousPath = String(previousLive.path || '').trim();
      const sameLiveTrack = Boolean(path && previousPath && path === previousPath
        && performanceTrackProviderTone(track) === performanceTrackProviderTone(previousLive));
      const reportedPlayingBpm = Number(track.playing_bpm || track.serato_playing_bpm || 0);
      const previousPlayingBpm = sameLiveTrack && !Object.prototype.hasOwnProperty.call(track, 'deck_bpm_status')
        ? Number(previousLive.playing_bpm || previousLive.serato_playing_bpm || 0)
        : 0;
      const playingBpm = Number.isFinite(reportedPlayingBpm) && reportedPlayingBpm > 0
        ? reportedPlayingBpm
        : (Number.isFinite(previousPlayingBpm) && previousPlayingBpm > 0 ? previousPlayingBpm : 0);
      const nativeBpm = Number(
        track.native_bpm
        || track.track_bpm
        || track.library_bpm
        || reportedBpm
        || cached.native_bpm
        || cached.track_bpm
        || cached.library_bpm
        || cachedBpm
        || 0
      );
      const provider = performanceTrackProviderTone(track);
      const sourceLabel = track.source_label || (provider === 'djay'
        ? 'djay Pro'
        : (provider === 'serato' ? 'Serato DJ Pro' : 'DJ software'));
      const normalized = normalizeModalTrackMetadata({
        ...cached,
        ...track,
        path: path || cached.path || '',
        title: track.title || track.name || cached.title || track.filename || 'Unknown Title',
        artist: track.artist || cached.artist || 'Unknown Artist',
        genre: cached.genre || track.genre || '',
        year: timeline.year || track.year || '',
        year_estimated: timeline.year_estimated ?? track.year_estimated ?? false,
        year_health_state: timeline.year_health_state ?? track.year_health_state ?? '',
        era_override: Object.prototype.hasOwnProperty.call(timeline, 'era_override') ? timeline.era_override : track.era_override,
        bpm: liveBpm || 0,
        serato_bpm: reportedBpm || '',
        native_bpm: Number.isFinite(nativeBpm) && nativeBpm > 0 ? nativeBpm : '',
        track_bpm: Number.isFinite(nativeBpm) && nativeBpm > 0 ? nativeBpm : '',
        playing_bpm: playingBpm || '',
        serato_playing_bpm: playingBpm || '',
        bpm_source: track.bpm_source || (reportedBpm ? `${provider}_live_history` : (cached.bpm_source || '')),
        camelot: cached.camelot || track.camelot || track.key || '',
        energy: track.energy || (liveBpm ? modalTrackEnergy({ bpm: liveBpm }) : '') || cached.energy || '',
        source: track.source || (provider ? `${provider}_live_history` : 'dj_live'),
        connected_from: track.connected_from || (provider ? `${provider}_live` : 'dj_live'),
        live_provider: provider,
        source_label: sourceLabel,
        deck: track.deck || cached.deck || ''
      });
      if (normalized.path) cacheTrackVisual(normalized);
      return normalized;
    }

    const performanceWaveformCache = new Map();
    let performanceWaveformRequest = 0;

    function performanceDrawSourceWaveform(target, peaks) {
      target.replaceChildren();
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      target.appendChild(canvas);
      const width = Math.max(1, Math.round(target.clientWidth));
      const height = 44;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = width * ratio; canvas.height = height * ratio;
      canvas.style.width = '100%'; canvas.style.height = `${height}px`;
      const context = canvas.getContext('2d');
      context.scale(ratio, ratio);
      context.fillStyle = '#35bed0';
      // Each column is the maximum of its real source bins, with a symmetric
      // amplitude envelope. No fabricated rhythm or moving playback marker.
      for (let x = 0; x < width; x++) {
        const start = Math.floor(x * peaks.length / width);
        const end = Math.max(start + 1, Math.floor((x + 1) * peaks.length / width));
        let peak = 0;
        for (let i = start; i < Math.min(peaks.length, end); i++) peak = Math.max(peak, peaks[i]);
        const amplitude = Math.max(1, Math.min(1, peak) * (height - 4));
        context.fillRect(x, (height - amplitude) / 2, 1, amplitude);
      }
      target.dataset.waveState = 'ready';
      target.setAttribute('aria-label', 'Current track source audio waveform');
    }

    async function performanceRenderSourceWaveform(track) {
      const target = document.getElementById('performance-deck-waveform');
      if (!target) return;
      const path = String(track?.path || '');
      if (target.dataset.wavePath === path && target.dataset.waveState) return;
      const requestId = ++performanceWaveformRequest;
      target.dataset.wavePath = path;
      target.dataset.waveState = 'loading';
      target.textContent = path ? 'Loading source waveform…' : 'Choose a track to view its waveform';
      target.classList.remove('is-live');
      if (!path) { target.dataset.waveState = 'waiting'; return; }
      try {
        let peaks = performanceWaveformCache.get(path);
        if (!peaks) {
          const preview = (path.startsWith('/preview/') || path === '/tmp/axiom-performance-review-anchor.mp3') && window.location.hostname === '127.0.0.1'
            && new URLSearchParams(window.location.search).has('review');
          if (preview) {
            const response = await fetch('/static/fixtures/performance-source-envelope.json');
            if (!response.ok) throw new Error('Review waveform unavailable');
            peaks = (await response.json()).peaks;
            target.dataset.waveFixture = 'generated-audio';
          } else {
            delete target.dataset.waveFixture;
            const {nativeSourceInfo} = await import('../studio-daw/native-source-info.mjs');
            peaks = (await nativeSourceInfo(path, {current:()=>requestId === performanceWaveformRequest})).peaks;
          }
          performanceWaveformCache.set(path, peaks);
          while (performanceWaveformCache.size > 8) performanceWaveformCache.delete(performanceWaveformCache.keys().next().value);
        }
        if (requestId === performanceWaveformRequest) performanceDrawSourceWaveform(target, peaks);
      } catch (_) {
        if (requestId !== performanceWaveformRequest) return;
        target.dataset.waveState = 'unavailable';
        target.textContent = 'Source waveform unavailable';
        target.setAttribute('aria-label', 'Source waveform unavailable');
      }
    }
