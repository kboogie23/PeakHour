// Approved Live Assist controls. Saved choices belong to AXIOM, never DJ databases.
const ASSIST_MAYBE_KEY = 'axiomLiveAssistMaybeNext.v1';
const ASSIST_MAYBE_EMOJI_KEY = 'axiomLiveAssistMaybeEmoji.v1';
const ASSIST_MAYBE_EMOJI_OPTIONS = ['🤔', '🔥', '👿', '🩷', '💀', '💃🏻', '🧟‍♂️', '🍆', '⭐️🕺'];
let assistKept = [];
try { const rows = JSON.parse(localStorage.getItem(ASSIST_MAYBE_KEY) || '[]'); if (Array.isArray(rows)) assistKept = rows.filter(t => isLocalTrackPath(t.path)); } catch (_) {}
let assistMaybeEmoji = '🤔';
let assistMaybeEmojiSelected = false;
try {
  const savedEmoji = localStorage.getItem(ASSIST_MAYBE_EMOJI_KEY);
  if (ASSIST_MAYBE_EMOJI_OPTIONS.includes(savedEmoji)) {
    assistMaybeEmoji = savedEmoji;
    assistMaybeEmojiSelected = true;
  }
} catch (_) {}
let assistDragging = false;
function persistAssistKept() { try { localStorage.setItem(ASSIST_MAYBE_KEY, JSON.stringify(assistKept)); } catch (_) { setStatus('Maybe Next could not be saved. Keep this window open.', true); } }
function persistAssistMaybeEmoji() {
  try { localStorage.setItem(ASSIST_MAYBE_EMOJI_KEY, assistMaybeEmoji); } catch (_) {}
}
function renderAssistMaybeEmoji() {
  document.querySelectorAll('#maybe-button .thinking, #maybe-emoji-current').forEach(node => { node.textContent = assistMaybeEmoji; });
  const label = document.querySelector('#maybe-button .assist-maybe-label');
  if (label) {
    label.textContent = assistMaybeEmojiSelected ? assistMaybeEmoji : 'Maybe Next';
    label.classList.toggle('is-crowd-mood', assistMaybeEmojiSelected);
  }
  const menu = document.getElementById('maybe-emoji-menu');
  if (!menu) return;
  const html = ASSIST_MAYBE_EMOJI_OPTIONS.map(emoji => `<button type="button" data-maybe-emoji="${escapeHtml(emoji)}" aria-pressed="${emoji === assistMaybeEmoji ? 'true' : 'false'}">${escapeHtml(emoji)}</button>`).join('');
  if (menu.innerHTML !== html) menu.innerHTML = html;
}
function renderApprovedAssist() {
  const deck = document.getElementById('live-deck-bpm');
  const deckBpm = formatBpm(liveAssistTempoSourceBpm());
  const deckText = deckBpm ? String(Number(deckBpm)) : '—';
  if (deck && deck.textContent !== deckText) deck.textContent = deckText;
  document.getElementById('maybe-count').textContent = assistKept.length;
  renderAssistMaybeEmoji();
  const saved = document.getElementById('saved-list');
  const html = assistKept.map(t => `<div class="saved-song" draggable="true" tabindex="0" data-path="${escapeHtml(t.path)}" data-title="${escapeHtml(t.title)}"><div><strong>${escapeHtml(t.title)}</strong><small>${escapeHtml([t.artist && t.artist !== 'Unknown Artist' ? t.artist : '', Number(t.bpm) > 0 ? `${formatBpm(t.bpm)} BPM` : ''].filter(Boolean).join(' · ') || 'Request · not analysed')}</small></div><button type="button" data-unkeep-path="${escapeHtml(t.path)}" aria-label="Remove ${escapeHtml(t.title)} from Maybe Next">×</button></div>`).join('') || '<small>Keep songs here with + or drop a request below.</small>';
  if (saved.innerHTML !== html && !assistDragging) saved.innerHTML = html;
  const add = document.getElementById('gig-profile-refresh');
  add.textContent = state.gigProfileChoosing ? 'Refresh All' : '+ Add Playlists';
  add.setAttribute('aria-label', state.gigProfileChoosing ? 'Refresh all DJ playlists' : 'Browse all DJ playlists');
  renderAssistKeepButtons();
}
function renderAssistKeepButtons() {
  document.querySelectorAll('[data-keep-path]').forEach(button => {
    const kept = assistKept.some(track => track.path === button.dataset.keepPath);
    const title = button.closest('.track')?.querySelector('.track-title')?.textContent || 'song';
    button.classList.toggle('is-kept', kept);
    button.setAttribute('aria-pressed', String(kept));
    button.setAttribute('aria-label', `${kept ? 'Show' : 'Add'} ${title} ${kept ? 'in' : 'to'} Maybe Next`);
    const symbol = kept ? '\u2713' : '+';
    if (button.textContent !== symbol) button.textContent = symbol;
  });
}
function toggleAssistYearMode(mode) {
  const step = ((state.moreLike || state.yearRange)?.span_years || 2) + 1;
  shiftAssistYearRange(mode === 'old' ? -step : step, mode);
}
function resizeAssistYearRange(span) {
  const base = state.moreLike || state.yearRange;
  const next = AXIOMLiveAssistSimilarity.resize(base, span);
  if (!next) { setStatus('This release year range cannot be expanded further.', true); render(); return; }
  if (state.moreLike) state.moreLike = next;
  else state.yearRange = next;
  render();
  sendSessionFeedback('year_range', {});
  setStatus(state.moreLike ? `Following ${AXIOMLiveAssistSimilarity.description(next)}` : `Release years ${next.min_year}–${next.max_year}.`);
}
function shiftAssistYearRange(years, direction) {
  const base = state.moreLike || state.yearRange || AXIOMLiveAssistSimilarity.rangeFromTrack(state.anchor || {});
  if (!base) { setStatus('The playing track needs a year or AXIOM Era to move this range.', true); return; }
  const next = AXIOMLiveAssistSimilarity.shift(base, years, direction || base.direction);
  if (!next) { setStatus('This year range cannot move any further.', true); return; }
  const stepHadFocus = typeof document !== 'undefined' && document.activeElement?.hasAttribute('data-assist-year-step');
  if (state.moreLike) state.moreLike = next;
  else state.yearRange = next;
  state.yearMode = '';
  state.minYear = 0; state.maxYear = 0;
  render();
  if (stepHadFocus) document.querySelector(`.assist-year-steps:not([hidden]) [data-assist-year-step="${years < 0 ? -1 : 1}"]`)?.focus();
  sendSessionFeedback('year_range', {});
  const summary = state.moreLike ? `Following ${AXIOMLiveAssistSimilarity.description(next)}` : `${next.mode === 'era' ? 'AXIOM Era' : 'Release years'} ${AXIOMLiveAssistSimilarity.rangeLabel(next)}. Use + / − to move again.`;
  setStatus(summary + (next.direction === 'new' ? ` Past starting ${next.mode === 'era' ? 'era' : 'range'}: ${AXIOMLiveAssistSimilarity.referenceLabel(next)}.` : ''));
}
function toggleAssistMaybe(open) {
  document.getElementById('maybe-drawer').hidden = !open;
  document.getElementById('maybe-button').setAttribute('aria-expanded', String(open));
  if (open) { gigProfileMenu.hidden = true; state.gigProfileMenuOpen = false; }
  renderApprovedAssist();
}
document.getElementById('maybe-button').onclick = () => toggleAssistMaybe(document.getElementById('maybe-drawer').hidden);
document.getElementById('close-maybe').onclick = () => toggleAssistMaybe(false);
document.getElementById('maybe-emoji-button')?.addEventListener('click', event => {
  event.stopPropagation();
  const menu = document.getElementById('maybe-emoji-menu');
  menu.hidden = !menu.hidden;
  event.currentTarget.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
});
document.addEventListener('click', event => {
  const emojiOption = event.target.closest('[data-maybe-emoji]');
  if (emojiOption) {
    event.stopPropagation();
    const nextEmoji = emojiOption.dataset.maybeEmoji;
    if (ASSIST_MAYBE_EMOJI_OPTIONS.includes(nextEmoji)) {
      assistMaybeEmoji = nextEmoji;
      assistMaybeEmojiSelected = true;
      persistAssistMaybeEmoji();
      renderApprovedAssist();
      setStatus(`Maybe Next emoji changed to ${nextEmoji}.`);
    }
    document.getElementById('maybe-emoji-menu').hidden = true;
    document.getElementById('maybe-emoji-button').setAttribute('aria-expanded', 'false');
    return;
  }
  if (!event.target.closest('#maybe-emoji-button, #maybe-emoji-menu')) {
    const emojiMenu = document.getElementById('maybe-emoji-menu');
    if (emojiMenu) emojiMenu.hidden = true;
    document.getElementById('maybe-emoji-button')?.setAttribute('aria-expanded', 'false');
  }
  const add = event.target.closest('[data-keep-path]');
  if (add) {
    const path = add.dataset.keepPath;
    const t = state.suggestions.map(normalizeTrack).find(t => t.path === path);
    if (t) {
      const index = assistKept.findIndex(saved => saved.path === path);
      const {raw, ...saved} = t;
      if (index < 0) assistKept.push(saved);
      else assistKept[index] = saved;
      persistAssistKept();
      toggleAssistMaybe(true);
      const savedRow = [...document.querySelectorAll('.saved-song')].find(row => row.dataset.path === path);
      savedRow?.scrollIntoView({block:'nearest'});
      savedRow?.focus({preventScroll:true});
      setStatus(index < 0 ? `${t.title} kept in Maybe Next.` : `${t.title} is already in Maybe Next.`);
    }
  }
  const remove = event.target.closest('[data-unkeep-path]');
  if (remove) { assistKept = assistKept.filter(t => t.path !== remove.dataset.unkeepPath); persistAssistKept(); renderApprovedAssist(); }
});
window.addEventListener('storage', event => {
  if (event.key === ASSIST_MAYBE_KEY) {
    try { const rows=JSON.parse(event.newValue || '[]');if(Array.isArray(rows)) assistKept=rows.filter(t=>isLocalTrackPath(t.path));renderApprovedAssist(); } catch (_) {}
  }
  if (event.key === ASSIST_MAYBE_EMOJI_KEY && ASSIST_MAYBE_EMOJI_OPTIONS.includes(event.newValue)) {
    assistMaybeEmoji = event.newValue;
    assistMaybeEmojiSelected = true;
    renderApprovedAssist();
  }
});
function assistRequestPaths(text) {
  return [...new Set(String(text || '').split(/[\r\n]+/).map(line => {
    const value = line.trim();
    if (value.startsWith('file:')) {
      try { const url = new URL(value); return !url.hostname || url.hostname === 'localhost' ? decodeURIComponent(url.pathname) : ''; } catch (_) { return ''; }
    }
    return value.startsWith('/') ? value : '';
  }).filter(Boolean))].slice(0,100);
}
let assistRequestQueue = Promise.resolve(), assistNativeRequest = null;
function addAssistRequests(paths, nativeVerified = false) {
  assistRequestQueue = assistRequestQueue.catch(()=>{}).then(async () => {
    let added = 0, duplicate = 0, rejected = 0;
    for (const path of assistRequestPaths(paths.join('\n'))) {
      if (assistKept.some(t => t.path === path)) { duplicate++; continue; }
      let track = state.suggestions.map(normalizeTrack).find(t => t.path === path);
      if (!track) {
        try { const data = await fetchJson(`/api/library/track?path=${encodeURIComponent(path)}`); if (data.track?.source_connected) track = normalizeTrack(data.track); }
        catch (_) { /* A native drop may be a request outside the AXIOM library. */ }
      }
      if (!track && nativeVerified) track = normalizeTrack({path, title:path.split('/').pop().replace(/\.[^.]+$/, '')});
      if (!track) { rejected++; continue; }
      const {raw, ...saved} = track;
      assistKept.push(saved); added++;
    }
    if (added) persistAssistKept();
    renderApprovedAssist();
    setStatus([added ? `${added} ${added === 1 ? 'request added' : 'requests added'} to Maybe Next.` : '', duplicate ? `${duplicate} already kept.` : '', rejected ? `${rejected} could not be added. Drag the local song file from your DJ software in the AXIOM app.` : ''].filter(Boolean).join(' ') || 'Drop a local song from your DJ software. Streaming links cannot be kept here.', !added && !duplicate);
  });
  return assistRequestQueue;
}
window.__AXIOM_ASSIST_REQUEST_DROP = (id, paths) => {
  if (!assistNativeRequest || assistNativeRequest.id !== id) return;
  clearTimeout(assistNativeRequest.timer); assistNativeRequest = null;
  addAssistRequests(Array.isArray(paths) ? paths : [], true);
};
const assistRequestArea = document.getElementById('saved-list');
assistRequestArea.addEventListener('dragover', event => {
  event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
  assistRequestArea.classList.add('is-drop-target');
});
assistRequestArea.addEventListener('dragleave', event => { if (!assistRequestArea.contains(event.relatedTarget)) assistRequestArea.classList.remove('is-drop-target'); });
assistRequestArea.addEventListener('drop', event => {
  event.preventDefault(); event.stopPropagation(); assistDragging = false;
  assistRequestArea.classList.remove('is-drop-target');
  const transfer = event.dataTransfer;
  const paths = assistRequestPaths(transfer?.getData('text/uri-list') || transfer?.getData('text/plain'));
  const files = Array.from(transfer?.files || []);
  const bridge = window.webkit?.messageHandlers?.axiomNative;
  if (bridge && (files.length || paths.length)) {
    if (assistNativeRequest) clearTimeout(assistNativeRequest.timer);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    assistNativeRequest = {id, timer:setTimeout(()=>{assistNativeRequest=null;setStatus('The DJ software did not share a local song file. Try dragging the song from its library.',true);},4000)};
    bridge.postMessage({action:'addAssistRequestDrop',id,names:files.map(file=>file.name),paths});
  } else addAssistRequests(paths);
});
function prepareSavedDrag(event) {
  if (event.target.closest('button')) return;
  const row = event.target.closest('.saved-song[data-path]');
  if (row && event.type === 'mousedown') assistDragging = true;
  if (row) window.webkit?.messageHandlers?.axiomNative?.postMessage({action:'prepareTrackDrag',path:row.dataset.path,title:row.dataset.title});
}
document.addEventListener('pointerover', prepareSavedDrag);
document.addEventListener('mousedown', prepareSavedDrag);
document.addEventListener('pointerout', event => { const row=event.target.closest('.saved-song[data-path]'); if(row&&!row.contains(event.relatedTarget)) window.webkit?.messageHandlers?.axiomNative?.postMessage({action:'clearTrackDrag'}); });
document.addEventListener('dragstart', event => {
  const row = event.target.closest('[draggable="true"][data-path]');
  if (!row || !event.dataTransfer) return;
  assistDragging = true;
  const path=row.dataset.path;
  event.dataTransfer.effectAllowed='copy';event.dataTransfer.setData('text/uri-list',fileUrlForPath(path));event.dataTransfer.setData('text/plain',path);
  const ghost=document.createElement('div');ghost.className='assist-drag-ghost';ghost.textContent=row.dataset.title||row.querySelector('strong')?.textContent||path.split('/').pop();document.body.appendChild(ghost);event.dataTransfer.setDragImage(ghost,10,10);setTimeout(()=>ghost.remove(),0);
});
document.addEventListener('dragend',()=>{assistDragging=false;});
document.addEventListener('mouseup',()=>{assistDragging=false;});
const recordLevel = document.getElementById('record-level');
let recordGainSave = Promise.resolve(), recordGainError = null;
function renderRecordGain() { const db=Number(recordLevel.value);document.getElementById('record-level-value').textContent=`${db} dB`;recordLevel.parentElement.style.setProperty('--level-angle',`${-135+(db+24)/24*270}deg`); }
function saveRecordGain() {
  renderRecordGain(); if(LIVE_ASSIST_PREVIEW_MODE)return;
  const db=Number(recordLevel.value);recordGainError=null;
  recordGainSave=recordGainSave.catch(()=>{}).then(()=>fetchJson('/api/performance/recording/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({record_gain_db:db})})).catch(error=>{recordGainError=error;setStatus(`Recording level not saved: ${error.message}`,true);});
}
recordLevel.addEventListener('input',renderRecordGain);recordLevel.addEventListener('change',saveRecordGain);
recordLevel.addEventListener('dblclick',()=>{recordLevel.value='0';saveRecordGain();});
let gainGesture=null;
recordLevel.addEventListener('pointerdown',event=>{event.preventDefault();recordLevel.focus();gainGesture={y:event.clientY,db:Number(recordLevel.value)};recordLevel.setPointerCapture(event.pointerId);});
recordLevel.addEventListener('pointermove',event=>{if(!gainGesture)return;recordLevel.value=String(Math.max(-24,Math.min(0,Math.round(gainGesture.db+(gainGesture.y-event.clientY)/4))));renderRecordGain();});
recordLevel.addEventListener('pointerup',()=>{if(gainGesture){gainGesture=null;saveRecordGain();}});recordLevel.addEventListener('pointercancel',()=>{gainGesture=null;});
renderRecordGain();
if(!LIVE_ASSIST_PREVIEW_MODE)fetchJson('/api/performance/recording/settings').then(data=>{recordLevel.value=String(data.settings?.record_gain_db||0);renderRecordGain();}).catch(()=>{});
let approvedCoachOpen = false;
let approvedCoachBusy = false;
let coachSessionVersion = 0;
window.__AXIOM_COACH_CLOSED = () => { approvedCoachOpen = false; };
async function pollApprovedCoach() {
  if (LIVE_ASSIST_PREVIEW_MODE || approvedCoachBusy) return;
  if (coachSessionVersion !== state.lastSessionVersion) { coachSessionVersion=state.lastSessionVersion;document.getElementById('coach-set-reminder').value=''; }
  if (!state.coachInsightsEnabled) { const frame=document.getElementById('approved-coach-frame');if(frame){frame.hidden=true;frame.contentWindow.__AXIOM_HIDE_COACH_PROMPT?.();}approvedCoachOpen=false;return; }
  if (approvedCoachOpen || assistDragging || state.loading || state.gigProfileMenuOpen || !setRecordDrawer.hidden || document.body.dataset.assistMode === 'collapsed' || !state.anchor) return;
  approvedCoachBusy=true;
  try {
    const bpm=Number(state.bpmOverride)||liveAssistTempoSourceBpm()*(state.tempoIntent==='half'?.5:state.tempoIntent==='double'?2:1);
    const context=JSON.stringify([state.anchor.path,state.lastSessionVersion,bpm,state.yearMode,state.cleanOnly,filteredSuggestions().map(t=>t.path)]);
    const response=await fetchJson('/api/performance/coach',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:true,reminder:document.getElementById('coach-set-reminder').value,target_bpm:bpm,allowed_paths:filteredSuggestions().map(t=>t.path)})});
    const message=response.message;
    const currentBpm=Number(state.bpmOverride)||liveAssistTempoSourceBpm()*(state.tempoIntent==='half'?.5:state.tempoIntent==='double'?2:1);
    if(context!==JSON.stringify([state.anchor?.path,state.lastSessionVersion,currentBpm,state.yearMode,state.cleanOnly,filteredSuggestions().map(t=>t.path)])) return;
    if (!message || !state.coachInsightsEnabled || assistDragging || !setRecordDrawer.hidden || document.body.dataset.assistMode==='collapsed') return;
    approvedCoachOpen=true;
    const native=window.webkit?.messageHandlers?.axiomNative;
    if(native?.postMessage) native.postMessage({action:'showCoachPrompt',...message});
    else {
      let frame=document.getElementById('approved-coach-frame');
      if(!frame){frame=document.createElement('iframe');frame.id='approved-coach-frame';frame.title='AXIOM Coach';frame.src='/live_assist_coach_prompt?review=performance&ui_preview=coach';frame.style.cssText='position:fixed;right:12px;bottom:12px;width:340px;border:0;z-index:100';document.body.appendChild(frame);await new Promise(resolve=>frame.onload=resolve);}
      frame.hidden=false;frame.style.height=message.track?'260px':'128px';frame.contentWindow.__AXIOM_SHOW_COACH_PROMPT(message);
    }
    await fetchJson('/api/performance/coach',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'acknowledge',id:message.id})});
  } catch (_) { approvedCoachOpen=false; }
  finally {approvedCoachBusy=false;}
}
setInterval(pollApprovedCoach,2500);

let assistLivePlaylistIds = new Set();
function selectAssistPlayingNowTrack() {
  if (!state.anchor) return;
  state.selectedPlayingTrackKey = playingTrackSelectionKey();
  state.selectedPath = '';
  render();
  setStatus('Playing Now selected. Choose a feedback action or open + for more options.');
}
document.getElementById('assist-anchor-action').addEventListener('click', event => {
  event.stopPropagation();
  selectAssistPlayingNowTrack();
});
assistNowPlaying.addEventListener('click', event => {
  if (event.target.closest('button:not(#assist-anchor-action),select,input,textarea,a')) return;
  selectAssistPlayingNowTrack();
});
assistNowPlaying.addEventListener('keydown', event => {
  if (!['Enter', ' '].includes(event.key)) return;
  if (event.target.closest('button:not(#assist-anchor-action),select,input,textarea,a')) return;
  event.preventDefault();
  selectAssistPlayingNowTrack();
});
let assistPlaylistReversed = false;
function toggleApprovedPlaylistOrder() {
  assistPlaylistReversed = !assistPlaylistReversed;
  renderGigProfileSources();
  gigProfileSources.scrollTop = 0;
}
try { const ids=JSON.parse(localStorage.getItem('axiomLiveAssistPlaylists.v1')||'[]');if(Array.isArray(ids))assistLivePlaylistIds=new Set(ids); } catch (_) {}
function renderApprovedPlaylists() {
  const choosing = Boolean(state.gigProfileChoosing);
  if (!choosing) for (const id of state.gigProfileSelectedIds) assistLivePlaylistIds.add(id);
  const wanted = String(gigProfileSearch.value || '').trim().toLowerCase();
  gigProfileSearch.hidden = false;
  const provider = activeGigProfileProvider();
  gigProfileSearch.placeholder = provider === 'djay' ? 'Search djay Pro playlists' : provider === 'serato' ? 'Search Serato crates' : 'Search playlists';
  document.getElementById('gig-profile-refresh').hidden = false;
  document.getElementById('gig-profile-refresh').textContent = choosing ? 'Refresh All' : '+ Add Playlists';
  document.getElementById('gig-profile-refresh').setAttribute('aria-label', choosing ? 'Refresh all DJ playlists' : 'Browse all DJ playlists');
  const applyButton = document.getElementById('gig-profile-apply');
  applyButton.textContent = choosing ? 'Add Selected' : 'Apply Added';
  applyButton.disabled = Boolean(state.gigProfileSourcesLoading || (choosing && !activeGigProfileSelectedIds().length));
  const rows = activeGigProfileSources().filter(source => choosing || assistLivePlaylistIds.has(source.id));
  const previousScrollTop = gigProfileSources.scrollTop;
  const openKeys = new Set([...gigProfileSources.querySelectorAll('details[open][data-gig-tree-key]')].map(node => node.getAttribute('data-gig-tree-key')));
  const reverseButton = document.getElementById('gig-profile-reverse');
  reverseButton.setAttribute('aria-pressed', String(assistPlaylistReversed));
  reverseButton.setAttribute('aria-label', assistPlaylistReversed ? 'Restore original playlist order' : 'Show bottom of playlist list first');
  reverseButton.title = assistPlaylistReversed ? 'Bottom first — click for original order' : 'Show bottom first';
  gigProfileSources.setAttribute('aria-busy', String(Boolean(state.gigProfileSourcesLoading)));
  const playlistHtml = buildGigProfileSourceForest(rows).map(provider => {
    const roots = [...provider.roots.values()];
    if (assistPlaylistReversed) roots.reverse();
    return roots.map(node => renderGigProfileTreeNode(node, wanted, 0, provider.provider, assistPlaylistReversed)).join('');
  }).join('');
  const emptyTitle = state.gigProfileSourcesLoading
    ? 'Reading DJ playlists...'
    : wanted
      ? 'No selected playlists match this search.'
      : choosing
        ? 'No playlists were found in this DJ library.'
        : 'Your selected playlists will appear here.';
  const emptyDetail = state.gigProfileSourcesLoading
    ? 'AXIOM is checking Serato crates and djay Pro playlists.'
    : wanted
      ? 'Clear the search or choose + Add Playlists to browse everything.'
      : choosing
        ? 'Refresh all playlists, then try again.'
        : 'To add more, choose + Add Playlists.';
  gigProfileSources.innerHTML = playlistHtml || `<div class="gig-profile-empty"><strong>${emptyTitle}</strong><span>${emptyDetail}</span></div>`;
  gigProfileSources.querySelectorAll('details[data-gig-tree-key]').forEach(node => {
    if (!wanted) node.open = openKeys.has(node.getAttribute('data-gig-tree-key'));
  });
  refreshGigProfileCheckboxState();
  gigProfileSources.scrollTop = previousScrollTop;
  const addedCount = activeGigProfileSources().filter(source => assistLivePlaylistIds.has(source.id)).length;
  gigProfileSelectionCount.textContent = state.gigProfileSourcesLoading ? 'Reading DJ playlists…' : choosing ? `${activeGigProfileSelectedIds().length} selected from all playlists` : `${addedCount} added · + Add Playlists shows all`;
  renderGigProfileButton(); return true;
}
function finishApprovedPlaylistAdd() {
  if (!activeGigProfileSelectedIds().length) {
    setStatus('Choose at least one playlist to add.');
    renderGigProfileSources();
    return;
  }
  for(const id of state.gigProfileSelectedIds)assistLivePlaylistIds.add(id);
  try{localStorage.setItem('axiomLiveAssistPlaylists.v1',JSON.stringify([...assistLivePlaylistIds]));}catch(_){}
  state.gigProfileChoosing=false;state.gigProfileMenuDirty=true;
  gigProfileSearch.value='';
  renderGigProfileSources();
  gigProfileSelectionCount.textContent=`${activeGigProfileSelectedIds().length} selected · Ready to apply`;
}
