/* Shared Library ordering: missing values stay last in either direction. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AxiomLibrarySort = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  const fields = ['title', 'genre', 'year', 'bpm', 'key'];
  const field = token => String(token || '').split('_')[0];
  const descending = token => token === 'year' || String(token).endsWith('_desc');
  const defaults = name => name;
  const reverse = token => field(token) === 'year'
    ? (descending(token) ? 'year_asc' : 'year')
    : (descending(token) ? field(token) : `${field(token)}_desc`);
  const serverMode = token => token === 'bpm' ? 'bpm_asc' : token;
  function next(stack, name, additive) {
    if (!fields.includes(name)) return stack.slice();
    const index = stack.findIndex(token => field(token) === name);
    if (additive) {
      const result = stack.slice();
      if (index < 0) result.push(defaults(name));
      else result[index] = reverse(result[index]);
      return result;
    }
    return [index === 0 ? reverse(stack[0]) : defaults(name)];
  }
  function value(track, name) {
    if (name === 'bpm' || name === 'year') {
      const raw = name === 'bpm' ? track.bpm || track.display_bpm : track.year || track.release_year;
      const number = Number(raw);
      return [!Number.isFinite(number) || number <= 0, Number.isFinite(number) ? number : 0];
    }
    if (name === 'key') {
      const match = String(track.camelot || track.key || track.display_key || '').toUpperCase().trim().match(/^(1[0-2]|[1-9])([AB])$/);
      return match ? [false, Number(match[1]), match[2]] : [true, 0, ''];
    }
    const text = String(name === 'title' ? track.title || track.filename || '' : track.genre || '').trim().toLowerCase();
    return [!text || text === 'unknown' || text === 'unknown genre', text];
  }
  function compare(a, b, stack) {
    for (const token of stack) {
      const left = value(a, field(token)), right = value(b, field(token));
      if (left[0] !== right[0]) return left[0] ? 1 : -1;
      for (let i = 1; i < left.length; i++) {
        if (left[i] === right[i]) continue;
        return (left[i] < right[i] ? -1 : 1) * (descending(token) ? -1 : 1);
      }
    }
    for (const name of ['artist', 'title', 'path']) {
      const left = String(a[name] || '').toLowerCase(), right = String(b[name] || '').toLowerCase();
      if (left !== right) return left < right ? -1 : 1;
    }
    return 0;
  }
  function freshIdentity(track) {
    return String(track.path || track.browser_file || `${track.artist || 'unknown'}::${track.title || track.filename || 'track'}`);
  }
  function freshHash(text) {
    let hash = 2166136261;
    for (const byte of new TextEncoder().encode(String(text))) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    return hash;
  }
  function freshSort(tracks, seed, previous = []) {
    const shown = new Set(previous.map(Number));
    const ranked = tracks.map(track => ({ track, id: freshIdentity(track) }));
    ranked.forEach(row => { row.shown = shown.has(freshHash(row.id)); row.rank = freshHash(`${seed}:${row.id}`); });
    ranked.sort((a,b) => Number(a.shown) - Number(b.shown) || a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    // A small library still gets a visibly different order, even when a
    // shuffled permutation happens to match the previous display exactly.
    if (ranked.length > 1 && ranked.length === previous.length && ranked.every((row,index) => freshHash(row.id) === Number(previous[index]))) ranked.push(ranked.shift());
    return ranked.map(row => row.track);
  }
  return { fields, field, descending, next, serverMode, compare, freshHash, freshIdentity, freshSort,
    sort: (tracks, stack) => stack.length ? tracks.slice().sort((a, b) => compare(a, b, stack)) : tracks.slice() };
});
