// Metadata-only Live Assist scope. This never reads or modifies audio.
(function (root) {
  'use strict';
  function label(value) { return String(value || '').trim().replace(/\s+/g, ' '); }
  function genreKey(value) {
    const key = label(value).toLowerCase().replace(/[^a-z0-9]/g, '');
    return ['rnb', 'rb', 'randb', 'rhythmandblues'].includes(key) ? 'rnb' : key;
  }
  function artistLabel(value) {
    return label(value).replace(/^(?:(?:\([^)]*\)|\[[^\]]*\])\s*)+/, '')
      .split(/\s+\b(?:feat\.?|ft\.?|featuring)\s+/i)[0].trim();
  }
  function artistKey(value) { return artistLabel(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function year(value) {
    const match = String(value || '').match(/\b(?:19|20|21)\d{2}\b/);
    return match ? Number(match[0]) : 0;
  }
  const roots = ['Urban', 'Pop', 'Global', 'Local Music', 'Mashup / Edits', 'Electronic', 'Utility'];
  // Mirrors scanner.ERA_MAP; the contract test checks the shared boundaries.
  const eras = [
    [1950,1975,'Retro One','1950–1974'],[1975,1990,'Retro 2','1975–1989'],
    [1990,2000,'The 90s','1990s'],[2000,2010,'2k Era','2000s'],
    [2010,2017,'2010s','2010–2016'],[2017,2020,'Pre-Covid','2017–2019'],
    [2020,2022,'Post-Covid','2020–2021'],[2022,2024,'Old','2022–2023'],
    [2024,2026,'Recent','2024–2025'],[2026,2100,'New','2026+']
  ];
  function eraName(value) { return eras.find(era => era[2].toLowerCase() === label(value).toLowerCase())?.[2] || ''; }
  function eraFor(track = {}) {
    const raw = track.raw || {};
    const override = eraName(track.era_override || raw.era_override);
    if (override) return override;
    const release = [track.year,track.release_year,track.date,raw.year,raw.release_year,raw.date].map(year).find(Boolean);
    if (release) return eras.find(era => release >= era[0] && release < era[1])?.[2] || '';
    return eraName(track.effective_era || track.era || raw.effective_era || raw.era);
  }
  function eraLabel(value) { return eras.find(era => era[2] === value)?.[3] || ''; }
  function timelineYear(track = {}) {
    const raw=track.raw||{}, release=year(track.year||track.release_year||raw.year||raw.release_year);
    const override=eraName(track.era_override||raw.era_override);
    if(track.year_estimated??raw.year_estimated)return 0;
    if((track.year_health_state||raw.year_health_state)==='approximate')return 0;
    if(override&&eras.find(era=>release>=era[0]&&release<era[1])?.[2]!==override)return 0;
    return release;
  }
  function rangeLabel(scope) { return scope?.mode === 'era' ? eraLabel(scope.era) : scope ? `${scope.min_year}–${scope.max_year}` : ''; }
  function referenceLabel(scope) { return scope?.mode === 'era' ? eraLabel(scope.reference_era) : scope ? `${scope.reference_year - scope.span_years}–${scope.reference_year}` : ''; }
  function displayPlacement(track) {
    return timelineYear(track) || (eraName(track.era_override || track.raw?.era_override) ? eraLabel(eraFor(track)) : 'Year unconfirmed');
  }
  function rootFor(track) {
    const raw = track.raw || {};
    const direct = label(track.dna_root || track.root || track.auto_root || raw.dna_root || raw.root || raw.auto_root);
    const known = roots.find(value => value.toLowerCase() === direct.toLowerCase());
    if (known) return known;
    return typeof getRootFromSuggestion === 'function' ? label(getRootFromSuggestion(track)) : '';
  }
  function normalize(value) {
    if (!value || typeof value !== 'object') return null;
    const artist = artistLabel(value.artist).slice(0, 160);
    const genre = label(value.genre).slice(0, 160);
    const range = normalizeRange(value);
    if (!artistKey(artist) || /^(unknown|unknown artist|various artists)$/i.test(artist)
        || !genreKey(genre) || /^(unknown|unknown genre)$/i.test(genre)
        || !range) return null;
    return { artist, genre, root: rootFor(value), ...range,
      title: label(value.title).slice(0, 240), path: String(value.path || '').slice(0, 4096) };
  }
  function normalizeRange(value) {
    if (!value || typeof value !== 'object') return null;
    if (value.mode === 'era') {
      const era = eraName(value.era), reference = eraName(value.reference_era) || era;
      if (!era) return null;
      const index = eras.findIndex(row => row[2] === era), origin = eras.findIndex(row => row[2] === reference);
      const direction = index < origin ? 'old' : index > origin ? 'new' : '';
      return {mode:'era',era,reference_era:reference,reference_year:year(value.reference_year),span_years:[2,5,10].includes(value.span_years)?value.span_years:2,direction,
        navigation:direction || (['old','new'].includes(value.navigation) ? value.navigation : '')};
    }
    const min = value.min_year, max = value.max_year;
    const span = max - min;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1900 || max > 2199 || ![2, 5, 10].includes(span)) return null;
    const reference = year(value.reference_year) || max;
    const direction = max < reference ? 'old' : max > reference ? 'new' : '';
    return { min_year: min, max_year: max, span_years: span, reference_year: reference, reference_era:eraName(value.reference_era), direction,
      navigation: direction || (['old', 'new'].includes(value.navigation) ? value.navigation : '') };
  }
  function rangeFromTrack(track, span = 2, mode = 'auto') {
    const max=timelineYear(track),era=eraFor(track);
    const useEra=mode==='era'||(mode==='auto'&&!max&&Boolean(eraName(track.era_override||track.raw?.era_override)));
    return normalizeRange(useEra ? {mode:'era',era,reference_era:era,reference_year:max,span_years:span}
      : {min_year:max-span,max_year:max,reference_year:max,reference_era:era});
  }
  function fromTrack(track, span = 2, mode = 'auto') {
    const range=rangeFromTrack(track,span,mode);
    return range?normalize({...track,genre:track.genre||track.dna_genre||track.category,...range}):null;
  }
  function followMetadata(scope,track) {
    if(!scope||!scope.path||scope.path!==track?.path)return scope;
    const next=fromTrack(track,scope.span_years||2);
    if(!next)return null;
    if(next.mode===scope.mode&&next.reference_year===scope.reference_year&&next.reference_era===scope.reference_era)return scope;
    // Preserve an intentional year offset when an exact year is corrected.
    return next.mode!=='era'&&scope.mode!=='era'?shift(next,scope.max_year-scope.reference_year):next;
  }
  function matches(track, scope) {
    if (!scope) return true;
    return (!scope.path || track.path !== scope.path)
      && genreKey(track.genre || track.dna_genre || track.category) === genreKey(scope.genre)
      && matchesRange(track, scope);
  }
  function matchesRange(track, range) {
    if (range?.mode === 'era') return eraFor(track) === range.era;
    const release = timelineYear(track);
    return !range || (release >= range.min_year && release <= range.max_year);
  }
  function matchesRoot(track, scope) {
    return Boolean(scope?.root && rootFor(track).toLowerCase() === scope.root.toLowerCase())
      && (!scope.path || track.path !== scope.path) && matchesRange(track, scope);
  }
  function chooseTier(items, scope, trackFor = item => item) {
    if (!scope) return items;
    const exact = items.filter(item => matches(trackFor(item), scope));
    if (exact.length > 2 || !scope.root) return exact;
    const related = items.filter(item => !matches(trackFor(item), scope) && matchesRoot(trackFor(item), scope));
    return [...exact, ...related];
  }
  function sameArtist(track, scope) {
    if (!scope) return false;
    const wanted = artistKey(scope.artist), credited = artistLabel(track.artist || track.album_artist);
    if (artistKey(credited) === wanted) return true;
    return label(track.artist || track.album_artist)
      .replace(/^(?:(?:\([^)]*\)|\[[^\]]*\])\s*)+/, '')
      .split(/\s+(?:feat\.?|ft\.?|featuring|vs\.?|x)\s+|\s*[&,]\s*/i)
      .some(artist => artistKey(artist) === wanted);
  }
  function description(scope) {
    return scope ? `${scope.artist} first · ${scope.genre} · ${rangeLabel(scope)}` : '';
  }
  function shift(scope, years, direction = scope?.direction) {
    if (!scope) return null;
    if (scope.mode === 'era') {
      const target = eras.findIndex(row => row[2] === scope.era) + Math.sign(years);
      if (target < 0 || target >= eras.length) return null;
      const shifted = {...scope,era:eras[target][2],navigation:direction || (years < 0 ? 'old' : 'new')};
      return scope.artist ? normalize(shifted) : normalizeRange(shifted);
    }
    const shifted = { ...scope, min_year: scope.min_year + years, max_year: scope.max_year + years,
      navigation: direction || scope.navigation || (years < 0 ? 'old' : 'new') };
    return scope.artist ? normalize(shifted) : normalizeRange(shifted);
  }
  function resize(scope, span) {
    if (!scope || scope.mode === 'era' || ![2, 5, 10].includes(span)) return null;
    const resized = {...scope, min_year: scope.max_year - span};
    return scope.artist ? normalize(resized) : normalizeRange(resized);
  }
  function reset(scope) {
    return scope?.mode === 'era'
      ? normalize({...scope,era:scope.reference_era,navigation:''})
      : normalize({...scope,min_year:scope.reference_year - scope.span_years,max_year:scope.reference_year,navigation:''});
  }
  root.AXIOMLiveAssistSimilarity = { normalize, normalizeRange, fromTrack, rangeFromTrack, followMetadata, timelineYear, matches, matchesRange, matchesRoot, chooseTier, rootFor, sameArtist, description, shift, resize, eraFor, eraLabel, eraName, rangeLabel, referenceLabel, displayPlacement, reset, eras };
})(typeof window === 'object' ? window : globalThis);
