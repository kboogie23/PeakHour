/* Saved DJ track colours are independent of playlist membership and genre. */
function renderDjTrackColors(track = {}, provider = '', enabled = true) {
  if (!enabled) return '';
  const colors = track.dj_track_colors || track.raw?.dj_track_colors || {};
  const providers = colors[provider] ? [provider] : ['serato', 'djay'];
  return providers.map(source => {
    const color = colors[source];
    if (!color || !/^#[0-9a-f]{6}$/i.test(color.hex || '')) return '';
    const label = `${source === 'djay' ? 'djay Pro' : 'Serato'}: ${color.name || 'Track colour'}`;
    return `<span class="dj-track-color" role="img" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" style="display:inline-block;flex-shrink:0;width:11px;height:11px;margin-right:7px;border-radius:50%;background:${color.hex};box-shadow:0 0 0 1px #ffffff55;vertical-align:middle"></span>`;
  }).join('');
}
