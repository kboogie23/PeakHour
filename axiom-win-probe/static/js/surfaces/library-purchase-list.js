// Public playlist imports and a saved iTunes shopping list, shared by all sources.
let libraryGapImportedPlaylist = null;
const libraryGapAppleTracks = new Map();
function rememberLibraryGapLink(playlist, tracks) {
  libraryGapImportedPlaylist = playlist;
  for (const track of tracks) libraryGapAppleTracks.set(libraryGapSongLineKey(`${track.artist} - ${track.title}`), track);
}
function clearLibraryGapLinkMetadata() {
  libraryGapImportedPlaylist = null;
  libraryGapAppleTracks.clear();
  for (const suffix of ['url', 'receipt']) {
    const node = document.getElementById(`library-gap-youtube-${suffix}`);
    if (node) { if (suffix === 'url') node.value = ''; else node.textContent = ''; }
  }
  const input = document.getElementById('library-gap-apple-url');
  if (input) input.value = '';
  const receipt = document.getElementById('library-gap-apple-receipt');
  if (receipt) receipt.textContent = '';
}
function configureLibraryGapLinkSource(source) {
  document.getElementById('library-gap-youtube-panel')?.classList.toggle('hidden', source !== 'youtube');
  const panel = document.getElementById('library-gap-apple-panel');
  panel?.classList.toggle('hidden', source !== 'apple');
  const help = document.getElementById('library-gap-apple-help');
  if (help) help.textContent = 'Paste a public playlist share link. No Apple Music sign-in needed. Songs are checked against your AXIOM library.';
}
async function importLibraryGapApplePlaylist() {
  const input = document.getElementById('library-gap-apple-url');
  const url = String(input?.value || '').trim();
  libraryGapStatus('Reading Apple Music Playlist', 'Checking the full song list before adding it.', 'working');
  try {
    const response = await fetch('/api/library/apple-music/playlist-check', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url})});
    const payload = await response.json();
    if (!response.ok || !payload.success) throw new Error(payload.error || 'The Apple Music playlist could not be imported.');
    const textarea = document.getElementById('library-gap-input');
    const merged = mergeLibraryGapSongLists(textarea.value, payload.imported_text);
    textarea.value = merged.text;
    rememberLibraryGapLink(payload.apple_music, payload.apple_music.tracks);
    document.getElementById('library-gap-apple-receipt').textContent = `${payload.apple_music.playlist_name}: ${payload.apple_music.imported_count} of ${payload.apple_music.total_count} songs read. ${merged.addedCount} added; ${merged.skippedCount} duplicates skipped.`;
    return payload;
  } catch (error) {
    libraryGapStatus('Apple Music Playlist Not Imported', error.message, 'error');
    return null;
  }
}
function isLibraryGapYouTubeLink(text) {
  try {
    const url = new URL(String(text || '').trim());
    return url.protocol === 'https:' && ['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(url.host) && !/\s/.test(text);
  } catch (_) { return false; }
}
async function importLibraryGapYouTubeVideo(pastedUrl = '') {
  const url = String(pastedUrl || document.getElementById('library-gap-youtube-url')?.value || '').trim();
  libraryGapStatus('Reading YouTube Songs', 'Reading music credits and the description tracklist.', 'working');
  try {
    const response = await fetch('/api/library/youtube/playlist-check', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url})});
    const payload = await response.json();
    if (!response.ok || !payload.success) throw new Error(payload.error || 'The video song list could not be imported.');
    const textarea = document.getElementById('library-gap-input');
    // Replace only the submitted link; preserve edits made while the request runs.
    const existing = String(textarea.value || '').split(/\r?\n/).filter(line => !pastedUrl || line.trim() !== pastedUrl.trim()).join('\n');
    const merged = mergeLibraryGapSongLists(existing, payload.imported_text);
    textarea.value = merged.text;
    rememberLibraryGapLink(payload.youtube, payload.youtube.tracks);
    setLibraryGapInputSource('youtube', {focus:false});
    document.getElementById('library-gap-youtube-url').value = url;
    const receipt = payload.youtube;
    document.getElementById('library-gap-youtube-receipt').textContent = `${receipt.credits_count} music credits and ${receipt.tracklist_count} tracklist entries read. ${merged.addedCount} songs added; ${merged.skippedCount + receipt.duplicate_count} duplicates skipped. ${receipt.notice}`;
    updateLibraryGapInputCount();
    return payload;
  } catch (error) {
    libraryGapStatus('YouTube Songs Not Imported', error.message, 'error');
    return null;
  }
}
function libraryGapPurchaseTracks(results, existing = []) {
  const tracks = existing.slice();
  const seen = new Set(tracks.map(t=>libraryGapSongLineKey(`${t.artist} - ${t.title}`)));
  for (const row of results) {
    if (row.status !== 'not_found') continue;
    const requested = row.requested || {};
    const title = requested.title || requested.raw || '';
    const artist = requested.artist || '';
    const key = libraryGapSongLineKey(`${artist} - ${title}`);
    if (!title || seen.has(key)) continue;
    seen.add(key);
    const apple = libraryGapAppleTracks.get(key);
    tracks.push({artist,title,path:`missing://${encodeURIComponent(key)}`,is_missing_request:true,apple_id:apple?.apple_id || '',purchased:false});
  }
  return tracks;
}
function saveLibraryGapBuyList() {
  if (window.AXIOM_ACCESS_CONTEXT?.mode === 'guest') return showToast('Sign in to save your To Buy list.', true);
  loadSavedPlaylists();
  const existing = savedPlaylists.find(set=>set.kind==='to-buy');
  const tracks = libraryGapPurchaseTracks(libraryGapPayload?.results || [], existing?.tracks || []);
  if (!tracks.length) return showToast('No missing songs to add. Review possible matches first.', true);
  const record = {id:existing?.id || makePlaylistId(), name:existing?.name || 'To Buy', kind:'to-buy', tracks, updatedAt:new Date().toISOString()};
  const previous = savedPlaylists.slice();
  if (existing) savedPlaylists.splice(savedPlaylists.indexOf(existing),1,record);
  else savedPlaylists.unshift(record);
  try { persistSavedPlaylists(); } catch (_) { savedPlaylists = previous; return showToast('Your To Buy list could not be saved. Free some storage and try again.', true); }
  selectedPlaylistId = record.id;
  closeLibraryGapWorkspace();
  showTab('playlists');
  refreshPlaylistsView();
  showToast(`${tracks.length} songs in Playlists > To Buy. Possible matches stay in review.`);
}
function renderPurchasePlaylist(set, list, kicker, total) {
  kicker.textContent = 'iTunes Store shopping list · confirm the version and price in the store';
  total.textContent = `${set.tracks.filter(t=>!t.purchased).length} to buy`;
  document.getElementById('playlist-listen-edit-btn')?.classList.add('hidden');
  list.innerHTML = `<div class="purchase-list-tools"><p>One list for missing songs from Apple Music, Spotify and pasted lists. Purchases are completed individually in iTunes. Marking a song bought does not add its audio to AXIOM.</p><button type="button" onclick="exportPurchasePlaylist()">Export CSV</button></div>` + set.tracks.map((track,index)=>`
    <article class="purchase-track" data-purchase-row="${index}">
      <div><strong>${escapeHtml(track.title)}</strong><span>${escapeHtml(track.artist)}</span></div>
      <button type="button" onclick="findPurchaseTrack(${index},this)">Find in iTunes</button>
      <label><input type="checkbox" ${track.purchased?'checked':''} onchange="markPurchaseTrack(${index},this.checked)"> Bought</label>
      <div class="purchase-candidates" id="purchase-candidates-${index}" aria-live="polite"></div>
    </article>`).join('');
}
function markPurchaseTrack(index, purchased) {
  const set = getSelectedPlaylist();
  if (set?.kind!=='to-buy' || !set.tracks[index]) return;
  set.tracks[index].purchased=purchased;
  persistSavedPlaylists();
  document.getElementById('playlist-listen-total').textContent = `${set.tracks.filter(t=>!t.purchased).length} to buy`;
}
async function findPurchaseTrack(index, button) {
  const set = getSelectedPlaylist();
  if (set?.kind!=='to-buy' || !set.tracks[index]) return;
  const track = set.tracks[index];
  const output = document.getElementById(`purchase-candidates-${index}`);
  button.disabled=true;
  output.textContent='Checking the Australian iTunes Store...';
  try {
    const response = await fetch('/api/library/itunes/candidates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({artist:track.artist,title:track.title,apple_id:track.apple_id,country:'au'})});
    const payload=await response.json();
    if (!response.ok || !payload.success) throw new Error(payload.error || 'Could not search iTunes.');
    if (!payload.candidates.length) {
      output.textContent='No individual song purchase found in the Australian store. Try a different version or store.';
      return;
    }
    output.replaceChildren();
    for (const candidate of payload.candidates) {
      const url = new URL(candidate.url);
      if(url.protocol!=='https:' || url.hostname!=='itunes.apple.com') continue;
      const row=document.createElement('div');
      const copy=document.createElement('span');
      copy.textContent=`${candidate.title} — ${candidate.artist} · ${candidate.album || ''}${candidate.explicit?' · Explicit':''} · ${candidate.currency} ${Number(candidate.price).toFixed(2)}`;
      const link=document.createElement('a');
      link.href=url.href;link.target='_blank';link.rel='noopener';link.textContent='View in iTunes';
      row.append(copy,link);output.append(row);
    }
  } catch(error) {output.textContent=error.message;} finally {button.disabled=false;}
}
function exportPurchasePlaylist() {
  const set=getSelectedPlaylist();
  if(set?.kind!=='to-buy')return;
  const cell=value=>'"'+String(value||'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
  const csv=[['Artist','Title','Status'],...set.tracks.map(t=>[t.artist,t.title,t.purchased?'Bought':'To Buy'])].map(row=>row.map(cell).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='AXIOM-To-Buy.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
