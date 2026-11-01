(function (root) {
  'use strict';
  const rnb = /\b(?:r\s*&\s*b|r\s*[- ]?n\s*[- ]?b|rhythm\s*(?:and|&)\s*blues)\b/i;
  function parse(value) {
    const query = { text: '', bpm: null, years: null, genre: null, key: null };
    const quoted = [];
    let text = String(value || '').toLowerCase().replace(/"([^"\n]+)"/g, (_, literal) => {
      quoted.push(literal); return ` quotedtoken${quoted.length - 1} `;
    });
    text = text.replace(/\b(\d{2,3}(?:\.\d+)?)\s*(?:[-–—]|to)\s*(\d{2,3}(?:\.\d+)?)\s*bpm\b|\bbpm\s*:?\s*(\d{2,3}(?:\.\d+)?)\s*(?:[-–—]|to)\s*(\d{2,3}(?:\.\d+)?)\b|\b(\d{2,3}(?:\.\d+)?)\s*bpm\b|\bbpm\s*:?\s*(\d{2,3}(?:\.\d+)?)\b/i,
      (_, ...args) => { const values = args.slice(0, 6).filter(v => v !== undefined).map(Number); query.bpm = [Math.min(...values), Math.max(...values)]; return ' '; });
    text = text.replace(/\b(?:the\s+)?((?:19|20)?\d0)[’']?s\b|\b(nineties|eighties|seventies|sixties|noughties|two thousands)\b/i, (_, digits, word) => {
      let year = digits ? Number(digits) : { nineties: 1990, eighties: 1980, seventies: 1970, sixties: 1960, noughties: 2000, 'two thousands': 2000 }[word];
      if (year < 100) year += year < 30 ? 2000 : 1900;
      query.years = [year, year + 9]; return ' ';
    });
    text = text.replace(rnb, () => { query.genre = 'rnb'; return ' '; });
    text = text.replace(/\b(?:key\s*:?\s*)?((?:1[0-2]|[1-9])[ab])(?:\s+key)?\b/i, (_, key) => { query.key = key.toUpperCase(); return ' '; });
    text = text.replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim();
    quoted.forEach((value, i) => { text = text.replace(`quotedtoken${i}`, value); });
    query.text = text;
    return query;
  }
  function matches(track, query) {
    for (const [field, bounds] of [['bpm', query.bpm], ['year', query.years]]) {
      if (bounds) {
        const value = Number(track[field] || 0);
        if (!Number.isFinite(value) || value < bounds[0] || value > bounds[1]) return false;
      }
    }
    if (query.genre && !rnb.test(String(track.genre || ''))) return false;
    if (query.key && String(track.camelot || track.key || '').trim().toUpperCase() !== query.key) return false;
    return true;
  }
  function filter(rows, value) {
    const query = parse(value);
    const words = query.text.toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter(track => matches(track, query) && words.every(word =>
      [track.title, track.artist, track.path, track.genre, track.year, track.key].join(' ').toLowerCase().includes(word)));
  }
  function describe(query) {
    return [query.genre && 'R&B', query.years && `${query.years[0]}–${query.years[1]}`,
      query.bpm && (query.bpm[0] === query.bpm[1] ? `${query.bpm[0]} BPM` : `${query.bpm[0]}–${query.bpm[1]} BPM`),
      query.key && `Key ${query.key}`, query.text && `“${query.text}”`].filter(Boolean).join(' · ');
  }
  const api = { parse, matches, filter, describe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AxiomLibraryQuery = api;
})(typeof window === 'undefined' ? globalThis : window);
