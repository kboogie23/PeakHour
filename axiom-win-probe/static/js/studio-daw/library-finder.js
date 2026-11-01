/* Temporary Library destination owned only by the DAW ADD journey. */
(function () {
  'use strict';
  let session = null;
  const controlIds = ['lmod-bpm-window', 'lmod-era', 'lmod-root', 'lmod-count'];
  function chooseAnchor(project) {
    if (!project) return null;
    const songs = (project.arrangementClips || []).filter(c => c.path && !c.mixMuted &&
      !c.recorded && !c.renderedFx && ['left-deck', 'right-deck'].includes(c.sectionId));
    const clip = project.mode === 'edit'
      ? songs.find(c => c.path === project.anchorPath)
      : songs.slice().sort((a,b) => (b.timelineStartBeat + b.timelineDurationBeats) -
          (a.timelineStartBeat + a.timelineDurationBeats) || b.timelineStartBeat - a.timelineStartBeat)[0];
    const source = project.mode === 'edit'
      ? (project.sourceTracks || []).find(t => t.path === project.anchorPath) || clip || project.sourceTrack
      : clip;
    if (!source?.path) return null;
    const metadata = (project.sourceTracks || []).find(t => t.path === source.path) || source;
    return {...metadata, ...source, ...(clip || {}), title: metadata.title || clip?.title || clip?.label || 'Track'};
  }
  function setTracks(project) {
    const seen=new Set();
    return (project?.arrangementClips || []).filter(c=>c.path && !c.recorded && !c.renderedFx &&
      ['left-deck','right-deck'].includes(c.sectionId)).slice().sort((a,b)=>a.timelineStartBeat-b.timelineStartBeat)
      .filter(c=>{if(seen.has(c.path))return false;seen.add(c.path);return true;})
      .map(c=>({...((project.sourceTracks||[]).find(t=>t.path===c.path)||c)}));
  }
  function hasTimelineMusic(project = window.AxiomStudioDaw?.activeProject) {
    return Boolean((project?.arrangementClips || []).some(clip => clip?.path || clip?.recorded || clip?.renderedFx));
  }
  function syncBackButton(project = window.AxiomStudioDaw?.activeProject) {
    if (typeof document === 'undefined') return false;
    const source = document.getElementById('library-choose-music-source');
    if (!source) return false;
    const shouldReturn = active() || hasTimelineMusic(project);
    source.dataset.primaryMode = shouldReturn ? 'daw-return' : 'source-picker';
    source.classList.toggle('library-source-daw-return', shouldReturn);
    source.textContent = shouldReturn ? 'Back to DAW' : 'Choose Music Source';
    source.setAttribute('aria-label', shouldReturn ? 'Back to DAW' : 'Choose Music Source');
    source.title = shouldReturn ? 'Back to DAW' : 'Choose Music Source';
    return shouldReturn;
  }
  function sourcePrimaryAction() {
    const source = typeof document !== 'undefined' ? document.getElementById('library-choose-music-source') : null;
    syncBackButton(window.AxiomStudioDaw?.activeProject);
    if (source?.dataset.primaryMode === 'daw-return') return returnToProject();
    return typeof openLibrarySourcePicker === 'function' ? openLibrarySourcePicker() : false;
  }
  function syncStudioSet(project) {
    syncBackButton(project);
    if(project?.mode!=='mixtape'||typeof currentPlaylist==='undefined')return;
    const next=setTracks(project);
    const retainedPaths=new Set((project._studioPendingTracks||[]).map(track=>track.path));
    const pendingRequests=currentPlaylist.filter(track=>track?.missing_placeholder||track?._unlinked||
      String(track?.path||'').startsWith('missing://')||retainedPaths.has(track?.path));
    const nextPaths=new Set(next.map(track=>track.path));
    const nextStudio=next.map(t=>({...currentPlaylist.find(old=>old.path===t.path),...t}))
      .concat(pendingRequests.filter(track=>!nextPaths.has(track.path)));
    const fields=['path','title','artist','bpm','camelot','genre','year','era'];
    if(nextStudio.length===currentPlaylist.length && nextStudio.every((t,i)=>fields.every(field=>
      (t[field]??'')===(currentPlaylist[i]?.[field]??''))))return;
    if(typeof saveHistory==='function')saveHistory();
    currentPlaylist=nextStudio;
    if(typeof syncEditingPlaylistIfNeeded==='function')syncEditingPlaylistIfNeeded();
    if(typeof renderPlaylist==='function')renderPlaylist(currentPlaylist);
    if(typeof updateStudioToolsAvailability==='function')updateStudioToolsAvailability();
  }
  function active() { return Boolean(session && window.AxiomStudioDaw?.activeProject === session.project); }
  function invalidate() {
    if (typeof libSuggestionRequestId !== 'undefined') libSuggestionRequestId++;
    if (typeof smartLinkRefreshTimer !== 'undefined') clearTimeout(smartLinkRefreshTimer);
  }
  function header() {
    let el = document.getElementById('daw-library-finder');
    if (el) return el;
    const topbar = document.querySelector('#tab-content-library .library-topbar');
    if (!topbar) return null;
    el = document.createElement('section');el.id = 'daw-library-finder';el.hidden = true;
    el.setAttribute('aria-label', 'Find music for your DAW project');
    el.innerHTML = `<div class="daw-finder-heading"><div><small>STUDIO DAW</small><h2>Find your next track</h2><p data-finder-anchor></p></div></div>
      <div class="daw-finder-actions"><button type="button" data-finder-matches onclick="AxiomDawFinder.browse(false)">Recommended</button><button type="button" data-finder-all onclick="AxiomDawFinder.browse(true)">Browse all music</button><span>Search any song to add to your project timeline.</span><button type="button" onclick="AxiomDawFinder.end()">Exit track finder</button></div>`;
    topbar.after(el);
    return el;
  }
  function begin(project) {
    if (!project) return null;
    if (session) end(false);
    const panel = document.getElementById('smart-links-panel');
    const input = document.getElementById('main-search');
    const resultsColumn = document.querySelector('.library-results-column');
    if (!panel || !input || !resultsColumn || !document.querySelector('#tab-content-library .library-topbar')) {
      if (typeof showToast === 'function') showToast('Library is still opening. Try Add Track again.', true);
      return null;
    }
    const marker = document.createComment('Library Matching Songs position');
    panel.before(marker);
    const section=window.AxiomStudioDaw?.expandedSection;
    session = {project, sectionId:['left-deck','right-deck'].includes(section)?section:null, anchor:chooseAnchor(project), entering:true, all:false, marker, panel,
      search:input.value, placeholder:input.placeholder, normalAnchor:currentAnchorTrack,
      playerLabel:document.querySelector('.player-add-btn')?.textContent,
      modifiers:{...activeLibModifiers}, root:libRootFilter,
      controls:Object.fromEntries(controlIds.map(id => [id,document.getElementById(id)?.value])),
      scroll:document.getElementById('search-results')?.scrollTop || 0};
    window.__axiomDawMatchingContext = {forceMatching:true, anchorPath:session.anchor?.path || ''};
    clearLibraryMatchingFilters({fetchResults:false,silent:true});invalidate();
    const playerAdd=document.querySelector('.player-add-btn');if(playerAdd)playerAdd.textContent='+ Add to DAW';
    input.value = '';input.placeholder = 'SEARCH ANY SONG TO ADD TO YOUR PROJECT...';
    resultsColumn.appendChild(panel);
    document.body.classList.add('daw-library-finder-active');
    syncBackButton(project);
    const el=header();el.hidden=false;
    el.querySelector('h2').textContent=project.mode==='edit'?'Find music for your edit':'Find your next track';
    const a=session.anchor;
    el.querySelector('[data-finder-anchor]').textContent=a
      ? `Matching to ${a.title} — ${a.artist || 'Unknown Artist'} · ${a.bpm || '—'} BPM · ${a.camelot || a.key || 'Key unavailable'}`
      : 'Choose the first song for your project. Recommendations will follow once it has an anchor.';
    browse(!a, false);
    return a;
  }
  function browse(all, fetchResults=true) {
    if (!active()) return;
    session.all=Boolean(all || !session.anchor);
    document.body.classList.toggle('daw-library-finder-all',session.all);
    const el=header();
    el.querySelector('[data-finder-matches]').disabled=!session.anchor;
    el.querySelector('[data-finder-matches]').setAttribute('aria-pressed',String(!session.all));
    el.querySelector('[data-finder-all]').setAttribute('aria-pressed',String(session.all));
    if (!session.all) document.getElementById('main-search').value='';
    applyLibraryMatchingSongsPreference();
    session.panel.setAttribute('aria-hidden',String(session.all));
    if(fetchResults) { if(session.all) runSearch();else resetAndFetchLibSuggestions(); }
  }
  function end(refresh=true) {
    if (!session) return;
    const old=session;session=null;invalidate();window.__axiomDawMatchingContext=null;
    old.marker.replaceWith(old.panel);
    document.body.classList.remove('daw-library-finder-active','daw-library-finder-all');
    document.getElementById('daw-library-finder').hidden=true;
    syncBackButton(window.AxiomStudioDaw?.activeProject);
    const input=document.getElementById('main-search');input.value=old.search;input.placeholder=old.placeholder;
    const playerAdd=document.querySelector('.player-add-btn');if(playerAdd)playerAdd.textContent=old.playerLabel;
    currentAnchorTrack=old.normalAnchor;activeLibModifiers=old.modifiers;libRootFilter=old.root;
    for(const [id,value] of Object.entries(old.controls)) { const c=document.getElementById(id);if(c)c.value=value; }
    for(const mod of ['bpm_half','bpm_double']) {
      const b=document.getElementById('lmod-'+mod),enabled=Boolean(old.modifiers[mod]);
      b?.setAttribute('aria-pressed',String(enabled));
      for(const cls of ['bg-axiom-accent/20','text-axiom-accent','border-axiom-accent'])b?.classList.toggle(cls,enabled);
    }
    window.AxiomStudioDaw?.cancelLibraryAdd?.();
    renderLibraryMatchingFilterStatus();applyLibraryMatchingSongsPreference();
    if(refresh) {
      Promise.resolve(runSearch()).then(()=>{const rows=document.getElementById('search-results');if(!session&&rows)rows.scrollTop=old.scroll;});
      if(currentAnchorTrack&&libraryMatchingSongsEnabled())resetAndFetchLibSuggestions();
    }
  }
  function navigate(name) {
    if (!session) return;
    if(session.entering && name==='library') {session.entering=false;return;}
    end(false);
  }
  function returnToProject() {
    const project=session?.project || window.AxiomStudioDaw?.activeProject;
    if(!active()){syncBackButton(project); if(project) window.AxiomStudioDaw?.revealProject?.(project); return;}
    end(false);
    window.AxiomStudioDaw?.revealProject?.(project);
  }
  function showEmptyLibrary() {
    if (!active()) return;
    browse(true, false);
    const results=document.getElementById('search-results');
    if (results) results.innerHTML='<section class="library-empty-state"><div class="library-empty-copy"><h2 class="library-empty-title">Connect music for this project</h2><p class="library-empty-body">Your DAW project is still open. Choose a music source to find more tracks, or use Back to DAW.</p><div class="library-empty-actions"><button type="button" class="library-empty-primary" onclick="openLibrarySourcePicker()">Choose music source</button></div></div></section>';
  }
  async function add(track) {
    if(!active()||session.adding)return false;
    const owner=session;owner.adding=true;
    try {
      if(!window.AxiomAudioReadiness) {showToast('Audio checks are unavailable. Reopen AXIOM before adding this song.',true);return false;}
      const checked=await window.AxiomAudioReadiness.review([track],{forMixtape:true});
      if(!checked?.length||session!==owner||!active())return false;
      return window.AxiomStudioDaw.addTrackToProject(checked[0],{fromDawFinder:true,sectionId:owner.sectionId});
    } finally {owner.adding=false;}
  }
  window.AxiomDawFinder={begin,end,navigate,browse,add,returnToProject,sourcePrimaryAction,showEmptyLibrary,chooseAnchor,setTracks,syncStudioSet,syncBackButton,hasTimelineMusic,
    get active(){return active();},get anchor(){return active()?session.anchor:null;},
    get recommending(){return active()&&!session.all;},
    get paths(){return active()?(session.project.arrangementClips||[]).map(c=>c.path).filter(Boolean):[];}};
})();
