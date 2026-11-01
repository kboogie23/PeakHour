/* Shared track artwork, metadata badges, and waveform presentation. */
    const storedLibraryArtworkPreference = localStorage.getItem('axiomLibraryArtwork');
    let libraryArtworkEnabled = storedLibraryArtworkPreference == null ? true : storedLibraryArtworkPreference !== 'off';
    if (storedLibraryArtworkPreference == null) localStorage.setItem('axiomLibraryArtwork', 'on');

    function applyLibraryArtworkPreference() {
      document.body.classList.toggle('library-artwork-disabled', !libraryArtworkEnabled);
      const artworkCard = document.getElementById('tab-artwork');
      const artworkStatus = document.getElementById('settings-artwork-status');
      if (artworkCard) artworkCard.setAttribute('aria-pressed', libraryArtworkEnabled ? 'true' : 'false');
      if (artworkStatus) artworkStatus.textContent = libraryArtworkEnabled ? 'Artwork On' : 'Artwork Off';
      document.querySelectorAll('.library-artwork-toggle').forEach(btn => {
        btn.innerText = libraryArtworkEnabled ? 'ARTWORK ON' : 'ARTWORK OFF';
      });
    }

    function toggleLibraryArtwork() {
      libraryArtworkEnabled = !libraryArtworkEnabled;
      localStorage.setItem('axiomLibraryArtwork', libraryArtworkEnabled ? 'on' : 'off');
      applyLibraryArtworkPreference();
      runSearch();
      resetAndFetchLibSuggestions();
      showToast(libraryArtworkEnabled ? 'Album artwork enabled' : 'Album artwork hidden');
    }

    function getTrackArtwork(track = {}) {
      if (!libraryArtworkEnabled) return '';
      const raw = track.artwork || track.image || track.cover || track.cover_url || track.album_art || track.albumArt || track.artwork_url || track.artworkPath || '';
      if (raw && typeof raw === 'string') {
        const trimmed = raw.trim();
        if (/^(data:image\/|https?:\/\/|\/api\/|\/static\/)/i.test(trimmed)) return trimmed;
      }
      if (track.browser_file || String(track.path || '').startsWith('preview://')) return '';
      if (track.path) return `/api/library/artwork?path=${encodeURIComponent(track.path)}`;
      return '';
    }

    function getArtworkInitials(track = {}) {
      const source = `${track.title || track.filename || 'PH'} ${track.artist || ''}`.trim();
      const words = source.split(/\s+/).filter(Boolean);
      const first = words[0]?.[0] || 'A';
      const second = (words.find(w => w.length > 2 && w !== words[0]) || words[1] || 'X')[0] || 'X';
      return `${first}${second}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 2) || 'PH';
    }

    function hashString(str = '') {
      let hash = 0;
      for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
      return Math.abs(hash);
    }

    function artworkVars(track = {}) {
      const palettes = [
        ['#122a18', '#050907'],
        ['#203004', '#071007'],
        ['#23330a', '#101306'],
        ['#172512', '#0f100a'],
        ['#1d3314', '#07100a'],
        ['#2a2f12', '#090d06']
      ];
      const seed = hashString(`${track.path || ''}${track.title || ''}${track.artist || ''}`);
      const pair = palettes[seed % palettes.length];
      return `--art-a:${pair[0]};--art-b:${pair[1]};`;
    }

    function generatedTrackArtwork(track = {}, themeMode = 'night') {
      if (!libraryArtworkEnabled) return '';
      const dayMode = themeMode === 'day' || themeMode === 'light';
      const palettes = dayMode
        ? [
            ['#0a2a66', '#2563eb', '#ffffff'],
            ['#072b49', '#0ea5e9', '#f0f9ff'],
            ['#172554', '#3b82f6', '#ffffff'],
            ['#0c1f4a', '#60a5fa', '#ffffff'],
            ['#083344', '#06b6d4', '#ecfeff'],
            ['#172554', '#818cf8', '#eef2ff']
          ]
        : [
            ['#071006', 'var(--accent)', '#ffffff'],
            ['#0b131f', '#39ff14', '#e8fff0'],
            ['#160a20', '#b6ff00', '#ffffff'],
            ['#101206', '#f4ff4a', '#ffffff'],
            ['#071b16', '#00f5a0', '#f4fff9'],
            ['#190c08', '#ffdf3d', '#fff8dc']
          ];
      const seed = hashString(`${track.path || ''}${track.title || ''}${track.artist || ''}`);
      const [bg, accent, fg] = palettes[seed % palettes.length];
      const initials = getArtworkInitials(track);
      const title = String(track.title || track.filename || 'AXIOM').slice(0, 34);
      const artist = String(track.artist || 'DJ OWE').slice(0, 30);
      const svgText = value => String(value).replace(/[&<>\"]/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '\"': '&quot;'
      }[char]));
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${bg}" offset="0"/><stop stop-color="#050505" offset="1"/></linearGradient><radialGradient id="r" cx="68%" cy="24%" r="70%"><stop stop-color="${accent}" stop-opacity=".55" offset="0"/><stop stop-color="${accent}" stop-opacity="0" offset="1"/></radialGradient></defs><rect width="320" height="320" rx="32" fill="url(#g)"/><rect width="320" height="320" rx="32" fill="url(#r)"/><circle cx="230" cy="92" r="58" fill="none" stroke="${accent}" stroke-opacity=".35" stroke-width="3"/><circle cx="230" cy="92" r="18" fill="${accent}" fill-opacity=".18"/><path d="M0 260 L42 242 L82 270 L132 232 L184 258 L242 226 L320 252 L320 320 L0 320 Z" fill="${accent}" fill-opacity=".22"/><text x="34" y="139" fill="${fg}" font-family="Arial Black, Impact, sans-serif" font-size="88" font-weight="900" letter-spacing="-3">${svgText(initials)}</text><text x="36" y="210" fill="${fg}" font-family="Arial, sans-serif" font-size="18" font-weight="800">${svgText(title)}</text><text x="36" y="236" fill="${accent}" font-family="Arial, sans-serif" font-size="14" font-weight="800">${svgText(artist)}</text><text x="36" y="52" fill="${accent}" font-family="Arial Black, Arial, sans-serif" font-size="15" font-weight="900" letter-spacing="4">AXIOM</text></svg>`;
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }

    function escapeArtworkCssUrl(value = '') {
      return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/[\r\n\f]/g, '');
    }

    function renderArtworkImageLayer(art = '', extraClass = '') {
      if (!art) return '';
      const style = `background-image:url("${escapeArtworkCssUrl(art)}");`;
      const className = `track-artwork-image${extraClass ? ` ${extraClass}` : ''}`;
      return `<div class="${className}" aria-hidden="true" style="${escapeHtml(style)}"></div>`;
    }

    function renderTrackArtwork(track = {}, sizeClass = 'library-artwork', playHandler = '') {
      const art = getTrackArtwork(track);
      const playAttr = playHandler ? ` onclick="${playHandler}"` : '';
      const fallback = `<div class="artwork-fallback" style="${artworkVars(track)}">${getArtworkInitials(track)}</div>`;
      const generatedNight = renderArtworkImageLayer(generatedTrackArtwork(track), 'generated-track-artwork generated-track-artwork-night');
      const generatedDay = renderArtworkImageLayer(generatedTrackArtwork(track, 'day'), 'generated-track-artwork generated-track-artwork-day');
      const inner = `${fallback}${generatedNight}${generatedDay}${renderArtworkImageLayer(art)}`;
      return `
        <div class="track-artwork-shell ${sizeClass}" style="${artworkVars(track)}"${playAttr}>
          ${inner}
          ${playHandler ? `<span class="library-artwork-play"><svg class="w-3 h-3 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>` : ''}
        </div>
      `;
    }

    function renderFocusDeckMarker() {
      return `
        <span class="axiom-focus-marker" aria-hidden="true">
          <img src="${window.AXIOM_WEB_PREVIEW ? '/axiom-cockpit' : ''}/static/icons/check-circle.svg" alt="">
          <span>Selected</span>
        </span>
      `;
    }

    function formatTrackDuration(track = {}) {
      const sec = parseFloat(track.duration_sec || 0);
      if (sec > 0) return formatTime(sec);
      const min = parseFloat(track.duration_min || 0);
      if (min > 0) return formatTime(min * 60);
      return '--:--';
    }

    function formatTrackYear(track = {}) {
      const raw = track.year || track.release_year || track.released || track.date || '';
      const match = String(raw || '').match(/\b(19|20)\d{2}\b/);
      if (match) return `${match[0]}${track.year_estimated ? ' (est.)' : ''}`;
      const eraLabels = {
        'Retro One': '1950–1974', 'Retro 2': '1975–1989', 'The 90s': '1990s',
        '2k Era': '2000s', '2010s': '2010–2016', 'Pre-Covid': '2017–2019',
        'Post-Covid': '2020–2021', 'Old': '2022–2023', 'Recent': '2024–2025', 'New': '2026+',
      };
      const era = eraLabels[track.era_override] || eraLabels[track.effective_era] || eraLabels[track.era];
      return era ? `${era} (era only)` : 'Year --';
    }

    function libraryHealthIssuesForTrack(track = {}) {
      const issues = [];
      if (track.set_build_excluded) issues.push({ key: 'set_excluded', label: 'Set Excluded' });
      if (track.source_connected === false || !browserSafeExportPath(track)) issues.push({ key: 'missing_file', label: 'Missing File' });
      if (!trackHasUsableBpm(track)) issues.push({ key: 'missing_bpm', label: 'Needs BPM' });
      const usableKey = trustedTrackKey(track);
      if (!usableKey) issues.push({ key: 'missing_key', label: track.key_suggestion || track.key_estimated ? 'Review Key' : 'Needs Key' });
      if (!track.year && !track.release_year) issues.push({ key: 'missing_year', label: 'Needs Year' });
      else if (track.year_estimated) issues.push({ key: 'estimated_year', label: 'Estimated Year' });
      return issues;
    }

    function trustedTrackKey(track = {}) {
      if (track.key_estimated) return '';
      return normalizeCamelotKey(track.camelot) || normalizeCamelotKey(track.key_raw);
    }

    function renderLibraryHealthChips(track = {}) {
      const issues = libraryHealthIssuesForTrack(track);
      if (!issues.length) return '';
      return `
        <div class="library-health-chips" aria-label="Library health">
          ${issues.map(issue => `<span class="library-health-chip ${issue.key}">${escapeHtml(issue.label)}</span>`).join('')}
        </div>
      `;
    }

    function renderMiniWaveform(track = {}, isPlaying = false, count = 12) {
      if (document.body.classList.contains('browser-fast-library')) {
        return `<div class="library-waveform library-waveform-lite ${isPlaying ? 'is-playing' : ''}" aria-hidden="true"></div>`;
      }
      const seed = hashString(`${track.path || ''}${track.title || ''}${track.bpm || ''}`);
      let bars = '';
      for (let i = 0; i < count; i++) {
        const wave = Math.sin((seed % 41 + i * 9) * 0.38) + Math.cos((seed % 29 + i * 5) * 0.22);
        const height = 10 + Math.round(Math.abs(wave) * 13) + ((i + seed) % 5);
        bars += `<span class="wavebar" style="--h:${height}px"></span>`;
      }
      return `<div class="library-waveform ${isPlaying ? 'is-playing' : ''}" aria-hidden="true">${bars}</div>`;
    }

    function renderPerformanceDeckWaveform(track = {}, isPlaying = false, count = 190) {
      const seed = hashString(`${track.path || ''}${track.title || ''}${track.bpm || ''}`);
      let bars = '';
      for (let i = 0; i < count; i++) {
        const phase = seed % 67;
        const body = Math.abs(
          Math.sin((phase + i * 7) * .31) * .58
          + Math.cos((phase + i * 11) * .17) * .32
          + Math.sin((phase + i * 3) * .09) * .1
        );
        const transient = ((seed + i * 19) % 37) < 3 ? 12 : 0;
        const edge = .72 + Math.sin(Math.PI * (i / Math.max(1, count - 1))) * .28;
        const height = Math.max(9, Math.min(50, Math.round((11 + body * 44 + transient) * edge)));
        bars += `<span class="wavebar" style="--h:${height}px"></span>`;
      }
      return `<div class="library-waveform performance-waveform-bars ${isPlaying ? 'is-playing' : ''}" aria-hidden="true">${bars}</div>`;
    }

    function libraryGenreToken(value = '') {
      return String(value || 'dna').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'dna';
    }

    function libraryManualGenreRoot(value = '') {
      const normalized = String(value || '').toLowerCase().replace(/[-_]+/g, ' ').trim();
      if (!normalized) return '';
      const has = (...terms) => terms.some(term => normalized.includes(term));
      if (has('rap', 'hip hop', 'hiphop', 'uk', 'grime', 'drill', 'east coast', 'west coast', 'ratchet', 'jersey')) return 'Urban';
      if (has('urban', 'r&b', 'rnb', 'r n b', 'r b', 'alternative rnb')) return 'Urban';
      if (has('nz', 'new zealand', 'aotearoa', 'poly', 'polynesian', 'pacific', 'samoa', 'samoan', 'tonga', 'tongan')) return 'Local Music';
      if (has('soundcloud', 'refreshed', 'mashup', 'mash up', 'bootleg', 'edit pack', 'edits pack')) return 'Mashup / Edits';
      if (has('global', 'african', 'afro', 'afrobeats', 'afrobeat', 'amapiano', 'latin', 'dancehall', 'reggaeton', 'soca', 'international')) return 'Global';
      if (has('edm', 'electronic', 'house', 'club', 'techno', 'garage', 'drum n bass', 'dnb')) return 'Electronic';
      if (has('top40', 'top 40', 'pop', 'dance', 'radio', 'mainstream')) return 'Pop';
      return '';
    }

    function libraryGenreBadgeVisual(label = '', track = {}) {
      const primaryGenreContext = [
        label,
        track.genre,
        track.dna_genre
      ].filter(Boolean).join(' ').toLowerCase();
      const primaryHas = (...terms) => terms.some(term => primaryGenreContext.includes(term));
      const genreContext = [
        label,
        track.genre,
        track.genre_group,
        track.genreGroup,
        track.style,
        track.root,
        track.pillar,
        Array.isArray(track.tags) ? track.tags.join(' ') : track.tags
      ].filter(Boolean).join(' ').toLowerCase();
      const has = (...terms) => terms.some(term => genreContext.includes(term));
      let palette = {
        border: 'rgba(244, 245, 242, 0.16)',
        bg: 'rgba(244, 245, 242, 0.075)',
        color: 'rgba(244, 245, 242, 0.82)'
      };
      if (primaryHas('nz', 'new zealand', 'aotearoa', 'poly', 'polynesian', 'pacific', 'samoa', 'samoan', 'tonga', 'tongan', 'local music')) {
        palette = { border: 'rgba(45, 212, 191, 0.62)', bg: 'rgba(45, 212, 191, 0.14)', color: '#2dd4bf' };
      } else if (primaryHas('soundcloud', 'refreshed', 'mashup', 'mash up', 'bootleg', 'edit pack', 'edits pack', 'mashup / edits')) {
        palette = { border: 'rgba(14, 165, 233, 0.62)', bg: 'rgba(14, 165, 233, 0.14)', color: '#38bdf8' };
      } else if (primaryHas('global', 'african', 'afro', 'afrobeats', 'afrobeat', 'amapiano', 'latin', 'dancehall', 'reggaeton', 'soca', 'international')) {
        palette = { border: 'rgba(16, 185, 129, 0.58)', bg: 'rgba(16, 185, 129, 0.14)', color: '#34d399' };
      } else if (primaryHas('urban', 'r&b', 'rnb', 'r n b', 'r-b', 'alternative rnb')) {
        palette = { border: 'rgba(236, 72, 153, 0.58)', bg: 'rgba(236, 72, 153, 0.14)', color: '#f472b6' };
      } else if (primaryHas('rap', 'hip hop', 'hip-hop', 'hiphop', 'uk', 'grime', 'drill', 'east coast', 'west coast', 'ratchet', 'jersey')) {
        palette = { border: 'rgba(249, 115, 22, 0.58)', bg: 'rgba(249, 115, 22, 0.15)', color: '#fb923c' };
      } else if (has('rap', 'hip hop', 'hip-hop', 'hiphop', 'uk', 'grime', 'drill', 'east coast', 'west coast', 'ratchet', 'jersey')) {
        palette = { border: 'rgba(249, 115, 22, 0.58)', bg: 'rgba(249, 115, 22, 0.15)', color: '#fb923c' };
      } else if (has('urban', 'r&b', 'rnb', 'r n b', 'r-b', 'alternative rnb')) {
        palette = { border: 'rgba(236, 72, 153, 0.58)', bg: 'rgba(236, 72, 153, 0.14)', color: '#f472b6' };
      } else if (has('edm', 'electronic', 'house', 'club')) {
        palette = { border: 'rgba(250, 204, 21, 0.58)', bg: 'rgba(250, 204, 21, 0.14)', color: '#fde047' };
      } else if (has('global', 'african', 'afro', 'afrobeats', 'afrobeat', 'amapiano', 'latin', 'dancehall', 'reggaeton', 'soca', 'international') || has('afro ')) {
        palette = { border: 'rgba(16, 185, 129, 0.58)', bg: 'rgba(16, 185, 129, 0.14)', color: '#34d399' };
      } else if (has('disco', 'retro', 'throwback', 'old school', 'old-school', '70s', "70's", '80s', "80's", '90s', "90's")) {
        palette = { border: 'rgba(168, 85, 247, 0.58)', bg: 'rgba(168, 85, 247, 0.14)', color: '#c084fc' };
      } else if (has('nz', 'new zealand', 'aotearoa', 'poly', 'polynesian', 'pacific', 'samoa', 'samoan', 'tonga', 'tongan', 'local music')) {
        palette = { border: 'rgba(45, 212, 191, 0.62)', bg: 'rgba(45, 212, 191, 0.14)', color: '#2dd4bf' };
      } else if (has('soundcloud', 'refreshed', 'mashup', 'mash up', 'bootleg', 'edit pack', 'edits pack', 'mashup / edits')) {
        palette = { border: 'rgba(14, 165, 233, 0.62)', bg: 'rgba(14, 165, 233, 0.14)', color: '#38bdf8' };
      } else if (has('top40', 'top 40', 'top-40', 'pop', 'dance', 'radio', 'mainstream')) {
        palette = { border: 'rgba(34, 211, 238, 0.58)', bg: 'rgba(34, 211, 238, 0.14)', color: '#22d3ee' };
      }
      // Day Mode keeps the category tint in the chip surface and border, but
      // uses one dark label color so every genre remains legible on light rows.
      if (document.body.classList.contains('light-mode')) palette.color = '#07111f';
      return {
        className: `library-genre-${libraryGenreToken(label)}`,
        style: `border-color:${palette.border} !important;background:${palette.bg} !important;color:${palette.color} !important;`
      };
    }

    function cacheTrackVisual(track = {}) {
      if (track && track.path) trackVisualCache.set(track.path, { ...(trackVisualCache.get(track.path) || {}), ...track });
    }
