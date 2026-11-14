(function () {
  'use strict';

  const existing = window.AxiomStudioDaw || {};
  let activeProject = null;
  let patternPreviewProject=null;
  document.addEventListener('pointerdown',event=>{
    if(event.target?.closest?.('dialog, [role="dialog"]'))return;
    const editor=event.target?.closest?.('#studio-daw-step-editor.daw-drum-editor, #studio-daw-step-editor.daw-note-editor');
    patternPreviewProject=editor?activeProject:null;
    document.getElementById('studio-daw-step-editor')?.toggleAttribute('data-preview-focus',Boolean(editor));
    if(event.target?.closest?.('#studio-daw-shell')&&!event.target.closest('button, input, select, textarea, [contenteditable="true"], [role="slider"]')){
      const surface=editor||document.getElementById('studio-daw-shell');surface.tabIndex=-1;surface.focus({preventScroll:true});
    }
  },true);
  const masterMarkup=new WeakMap();
  const sourceEditorMarkup=new WeakMap();
  const editHistories=new WeakMap(),editHandlers=new Map();let dispatchingHistory=false;
  function editHistory(p){if(!editHistories.has(p))editHistories.set(p,{undo:[],redo:[]});return editHistories.get(p);}
  window.AxiomEditHistory={
    register:(scope,handler)=>editHandlers.set(scope,handler),
    record(p,scope){if(!p||dispatchingHistory)return;if(scope!=='midi-controls')window.AxiomMidiControls?.flush();const h=editHistory(p);h.undo.push(scope);if(h.undo.length>30)h.undo.shift();h.redo=[];},
    clear(p){if(p)editHistories.delete(p);},
    canUndo(p,redo=false){return Boolean(p&&editHistory(p)[redo?'redo':'undo'].length);},
    get dispatching(){return dispatchingHistory;},
    undo(p,redo=false){
      window.AxiomAutomationRecorder?.finish();
      window.AxiomMidiControls?.flush();
      window.AxiomMixerHistory?.finish();
      if(!p||p!==activeProject)return false;
      const h=editHistory(p),from=redo?h.redo:h.undo,to=redo?h.undo:h.redo,scope=from.at(-1);if(!scope)return false;
      dispatchingHistory=true;
      try{if(!editHandlers.get(scope)?.(p,redo))return false;from.pop();to.push(scope);return true;}finally{dispatchingHistory=false;}
    }
  };
  const parameterHistories=new WeakMap();
  function parameterHistory(p){if(!parameterHistories.has(p))parameterHistories.set(p,{undo:[],redo:[]});return parameterHistories.get(p);}
  const parameterTarget=(p,id)=>id?p.arrangementClips.find(c=>c.id===id):p;
  const parameterState=(target,key)=>JSON.stringify({exists:Object.hasOwn(target,key),value:target[key]});
  function restoreParameter(target,key,snapshot){const state=JSON.parse(snapshot);if(state.exists)target[key]=state.value;else delete target[key];}
  function stopParameterPlayback(keepBeatPreview=false){window.AxiomArrangement?.stop(false);window.AxiomStems?.stop();if(!keepBeatPreview)window.AxiomBeatPreview?.stop();}
  function writeParameters(updates,{keepPendingSnap=false,keepBeatPreview=false}={}){
    if(!activeProject)return false;
    window.AxiomMixerHistory?.finish();
    const changes=updates.map(({id,key,value})=>{const target=parameterTarget(activeProject,id);return target?{id,key,before:parameterState(target,key),after:JSON.stringify({exists:true,value})}:null;});
    if(changes.some(c=>!c))return false;
    const changed=changes.filter(c=>c.before!==c.after);if(!changed.length)return true;
    if(window.AxiomDawAutomation&&!updates.some(u=>!u.id&&u.key==='automationLanes')&&activeProject.automationLanes?.some(l=>l.scope==='clip')&&updates.some(u=>u.id&&['sourceStartBeat','sourceDurationBeats','timelineDurationBeats'].includes(u.key))){
      const preview={...activeProject,arrangementClips:activeProject.arrangementClips.map(c=>({...c}))};
      for(const u of updates)if(u.id){const clip=preview.arrangementClips.find(c=>c.id===u.id);if(clip)clip[u.key]=u.value;}
      window.AxiomDawAutomation.reconcileClips(preview,activeProject.arrangementClips,activeProject.automationLanes);
      changed.push({key:'automationLanes',before:parameterState(activeProject,'automationLanes'),after:JSON.stringify({exists:true,value:preview.automationLanes})});
    }
    if(window.AxiomFxFollow&&updates.some(u=>u.id&&['timelineStartBeat','timelineDurationBeats','sourceStartBeat','sourceDurationBeats','sectionId','beatgrid','bpm'].includes(u.key))){
      const preview={...activeProject,arrangementClips:activeProject.arrangementClips.map(c=>({...c}))};
      for(const change of changed)restoreParameter(parameterTarget(preview,change.id),change.key,change.after);
      window.AxiomFxFollow.reconcile(preview,activeProject.arrangementClips,activeProject.fxRegions||[],activeProject.automationLanes||[]);
      for(const key of ['fxRegions','automationLanes']){
        const after=parameterState(preview,key),prior=changed.find(c=>!c.id&&c.key===key);
        if(prior)prior.after=after;else if(parameterState(activeProject,key)!==after)changed.push({key,before:parameterState(activeProject,key),after});
      }
    }
    if(!keepPendingSnap||!window.AxiomArrangement?.waitingForSnap)stopParameterPlayback(keepBeatPreview);
    for(const c of changed)restoreParameter(parameterTarget(activeProject,c.id),c.key,c.after);
    const h=parameterHistory(activeProject);h.undo.push(changed);if(h.undo.length>30)h.undo.shift();h.redo=[];
    window.AxiomEditHistory.record(activeProject,'parameters');renderShell('set');return true;
  }
  function undoParameters(p,redo){
    const h=parameterHistory(p),from=redo?h.redo:h.undo,to=redo?h.undo:h.redo,changes=from.at(-1);if(!changes)return false;
    // Completed stem jobs own their source-time receipts, even if a grid/BPM
    // edit was recorded before the job finished. Rebase only that derived beat.
    const stemOrigins=new Map();
    for(const c of changes)if(c.id&&['bpm','beatgrid'].includes(c.key)){
      const target=parameterTarget(p,c.id);
      if(target?.stemJob&&Number.isFinite(target.stemCoverage?.start))stemOrigins.set(c.id,target.stemCoverage.start);
    }
    if(changes.some(c=>{const target=parameterTarget(p,c.id);return !target||(!(c.key==='stemSourceStart'&&stemOrigins.has(c.id))&&parameterState(target,c.key)!==c[redo?'before':'after']);}))return false;
    const clip=selectedArrangementClip(),view=clip&&changes.some(c=>c.id===clip.id&&c.key==='beatgrid')?sourceViewSeconds(clip):null;
    stopParameterPlayback();for(const c of changes)restoreParameter(parameterTarget(p,c.id),c.key,c[redo?'after':'before']);
    for(const [id,seconds] of stemOrigins){const target=parameterTarget(p,id);target.stemSourceStart=existing.sourceSecondsToBeat(target,seconds);}
    if(view)restoreSourceViewSeconds(clip,view);
    from.pop();to.push(changes);renderShell('set');return true;
  }
  let activeMarkerIndex = 0;
  let activeSectionId = 'master';
  const mixerSelection=new Set();
  let rangeMode=false,rangeSelection=null,rangeProject=null,suppressRangeClick=false,rangeDragging=false;
  const rangeHistory=new WeakMap();
  const rangeRedo=new WeakMap();
  function setRange(sectionId,start,end) {
    if(!activeProject || !arrangementSections.some(s=>s.id===sectionId) || ![start,end].every(Number.isFinite) || start<0 || end<=start)return false;
    rangeSelection={sectionId,start,end};rangeProject=activeProject;selectedBpmPoint=-1;bpmEditing=false;
    paintRange();return true;
  }
  function clearRange() {rangeSelection=null;paintRange();}
  function timelineSnapshot(p=activeProject,includeSources=false) {
    if(!dispatchingHistory)window.AxiomMixerHistory?.finish();
    return JSON.stringify({
      ...(includeSources?{sweepSources:{sourceTrack:p.sourceTrack,sourceTracks:p.sourceTracks,anchorPath:p.anchorPath,assetIdentities:p.assetIdentities}}:{}),
      arrangementClips:p?.arrangementClips||[],
      fxRegions:p?.fxRegions||[],
      patternClips:p?.patternClips||[],
      markers:p?.markers||[],
      tempoSegments:p?.tempoSegments||[],
      automationLanes:p?.automationLanes||[],
      editCursorBeat:p?.editCursorBeat,
    });
  }
  function restoreTimelineSnapshot(p,snapshot) {
    const state=JSON.parse(snapshot);
    if(state.sweepSources)Object.assign(p,state.sweepSources);
    if(state.editCursorBeat!==undefined)p.editCursorBeat=state.editCursorBeat;
    p.arrangementClips=state.arrangementClips||[];
    p.fxRegions=state.fxRegions||[];
    p.patternClips=state.patternClips||[];
    p.markers=state.markers||[];
    p.tempoSegments=state.tempoSegments||[];
    p.automationLanes=state.automationLanes||[];
  }
  function paintRange() {
    document.querySelectorAll('.daw-range-selection').forEach(el=>el.remove());
    if(!rangeSelection || rangeProject!==activeProject)return;
    const {sectionId,start,end}=rangeSelection,span=viewBeats || timelineWorkspaceBeats();
    const left=Math.max(start,viewStartBeat),right=Math.min(end,viewStartBeat+span);
    const lane=document.querySelector(`#studio-daw-lanes [data-daw-section="${sectionId}"] .studio-daw-lane-body`);
    if(!lane || right<=left)return;
    const box=document.createElement('div');box.className='daw-range-selection';box.tabIndex=0;
    box.setAttribute('aria-label',`Selected range: ${(end-start)/4} bars`);
    box.style.cssText=`left:${(left-viewStartBeat)/span*100}%;width:${(right-left)/span*100}%`;
    const label=document.createElement('span');label.textContent=`${Number(((end-start)/4).toFixed(4))} bars`;box.appendChild(label);
    box.oncontextmenu=openRangeMenu;lane.appendChild(box);
  }
  function toggleRangeMode() {rangeMode=!rangeMode;clearRange();renderTrackStack();}
  function rangeSnapshot() {if(!dispatchingHistory)window.AxiomMixerHistory?.finish();return JSON.stringify(activeProject.arrangementClips);}
  function clipSelectionSnapshot(){return {id:selectedClipId,ids:[...mixerSelection],sectionId:activeSectionId,range:rangeProject===activeProject&&rangeSelection?{...rangeSelection}:null,automation:JSON.stringify(activeProject?.automationLanes||[]),fx:JSON.stringify(activeProject?.fxRegions||[])};}
  function recordClipEdit(before,beforeSelection,copies={}){
    const after=rangeSnapshot();if(before===after)return;
    const beforeAutomation=beforeSelection?.automation||JSON.stringify(activeProject.automationLanes||[]);
    if(window.AxiomDawAutomation&&(JSON.parse(beforeAutomation).some(l=>l.scope==='clip')||Object.values(copies).some(c=>c.lanes?.length)))window.AxiomDawAutomation.reconcileClips(activeProject,JSON.parse(before),JSON.parse(beforeAutomation),copies);
    const beforeFx=beforeSelection?.fx||JSON.stringify(activeProject.fxRegions||[]);
    window.AxiomFxFollow?.reconcile(activeProject,JSON.parse(before),JSON.parse(beforeFx),JSON.parse(beforeAutomation),copies);
    const history=rangeHistory.get(activeProject)||[];
    history.push({before,after,beforeFx,afterFx:JSON.stringify(activeProject.fxRegions||[]),beforeAutomation,afterAutomation:JSON.stringify(activeProject.automationLanes||[]),beforeSelection,afterSelection:clipSelectionSnapshot()});if(history.length>30)history.shift();rangeHistory.set(activeProject,history);rangeRedo.set(activeProject,[]);
    window.AxiomEditHistory.record(activeProject,'clip');
  }
  function recordTimelineEdit(before,beforeSelection,includeSources=false){
    const after=timelineSnapshot(activeProject,includeSources);if(before===after)return false;
    const history=rangeHistory.get(activeProject)||[];
    history.push({kind:'timeline',includeSources,before,after,beforeSelection,afterSelection:clipSelectionSnapshot()});
    if(history.length>30)history.shift();
    rangeHistory.set(activeProject,history);rangeRedo.set(activeProject,[]);
    window.AxiomEditHistory.record(activeProject,'clip');
    return true;
  }
  function hasTimelineContentInRange(start,end) {
    const overlaps=(itemStart,itemLength)=>Number.isFinite(itemStart)&&Number.isFinite(itemLength)&&itemLength>0&&itemStart<end&&itemStart+itemLength>start;
    return arrangementClips().some(clip=>overlaps(Number(clip.timelineStartBeat),Number(clip.timelineDurationBeats)))||
      (activeProject.fxRegions||[]).some(fx=>overlaps(Number(fx.startBeat),Number(fx.durationBeats||0)+Number(fx.tailBeats||0)))||
      (activeProject.patternClips||[]).some(clip=>overlaps(Number(clip.startBeat),Number(clip.durationBeats||0)));
  }
  function rippleDeleteEmptyRange(start,end) {
    const length=end-start;if(!(length>0)||hasTimelineContentInRange(start,end))return false;
    const before=timelineSnapshot(),beforeSelection=clipSelectionSnapshot();
    window.AxiomArrangement?.stop(false);window.AxiomStems?.stop();
    const moveStart=beat=>Number(beat)>=end?Number(beat)-length:Number(beat)<start?Number(beat):start;
    activeProject.arrangementClips=arrangementClips().map(clip=>({...clip,timelineStartBeat:moveStart(clip.timelineStartBeat)}));
    activeProject.fxRegions=(activeProject.fxRegions||[]).map(fx=>fx.coverage==='project'?fx:({...fx,startBeat:moveStart(fx.startBeat)}));
    activeProject.patternClips=(activeProject.patternClips||[]).map(clip=>({...clip,startBeat:moveStart(clip.startBeat)}));
    activeProject.markers=(activeProject.markers||[]).filter(marker=>Number(marker.beat)<start||Number(marker.beat)>=end).map(marker=>({...marker,beat:moveStart(marker.beat)}));
    activeProject.tempoSegments=(activeProject.tempoSegments||[]).filter(segment=>Number(segment.startBeat)<start||Number(segment.startBeat)>=end).map(segment=>({...segment,startBeat:moveStart(segment.startBeat)}));
    activeProject.automationLanes=(activeProject.automationLanes||[]).map(lane=>{
      if(!['project','deck'].includes(lane.scope))return lane;
      return {...lane,points:(lane.points||[]).filter(point=>Number(point.beat)<start||Number(point.beat)>=end).map(point=>({...point,beat:moveStart(point.beat)}))};
    });
    if(Number.isFinite(activeProject.editCursorBeat))activeProject.editCursorBeat=moveStart(activeProject.editCursorBeat);
    recordTimelineEdit(before,beforeSelection);
    rangeSelection=null;renderShell('set');paintRange();
    showToast?.(`Removed ${length/4} empty bars and moved later arrangement content forward.`);
    return true;
  }
  function editRange(action,destination,targetSection=rangeSelection?.sectionId) {
    const range=rangeSelection;
    if(!range || rangeProject!==activeProject || range.sectionId==='fx' || !['delete','move'].includes(action))return false;
    if(action==='move' && (!Number.isFinite(destination) || destination<0 || !arrangementSections.some(s=>s.id===targetSection) || targetSection==='fx'))return false;
    if(action==='delete' && rippleDeleteEmptyRange(range.start,range.end))return true;
    const before=rangeSnapshot(),beforeSelection=clipSelectionSnapshot(),after=[],moved=[],copies={};
    for(const clip of arrangementClips()) {
      const start=Math.max(range.start,clip.timelineStartBeat),end=Math.min(range.end,clip.timelineStartBeat+clip.timelineDurationBeats);
      if(clip.sectionId!==range.sectionId || end<=start){after.push(clip);continue;}
      const slice=(a,b)=>{const part={...clip,id:clipId('range'),sourceIntent:'trimmed',timelineStartBeat:a,timelineDurationBeats:b-a,sourceStartBeat:clip.sourceStartBeat+(a-clip.timelineStartBeat)*clip.sourceDurationBeats/clip.timelineDurationBeats,sourceDurationBeats:(b-a)*clip.sourceDurationBeats/clip.timelineDurationBeats};copies[part.id]={clip};return part;};
      if(start>clip.timelineStartBeat)after.push(slice(clip.timelineStartBeat,start));
      if(end<clip.timelineStartBeat+clip.timelineDurationBeats)after.push(slice(end,clip.timelineStartBeat+clip.timelineDurationBeats));
      if(action==='move')moved.push({...slice(start,end),timelineStartBeat:destination+start-range.start,sectionId:targetSection});
    }
    after.push(...moved);
    if(JSON.stringify(after)===before)return false;
    window.AxiomArrangement?.stop(false);window.AxiomStems?.stop();
    activeProject.arrangementClips=after;
    mixerSelection.clear();moved.forEach(clip=>mixerSelection.add(clip.id));
    selectedClipId=moved[0]?.id||'';
    clipEditorOpen=false;
    if(action==='move')rangeSelection={sectionId:targetSection,start:destination,end:destination+range.end-range.start};else rangeSelection=null;
    if(action==='move')activeSectionId=targetSection;
    recordClipEdit(before,beforeSelection,copies);
    renderShell('set');paintRange();return true;
  }
  function repeatRange(factor) {
    const range=rangeSelection,p=activeProject;
    if(!range||rangeProject!==p||![.5,2].includes(factor))return false;
    const hits=arrangementClips().filter(c=>c.sectionId===range.sectionId&&c.timelineStartBeat<range.end&&c.timelineStartBeat+c.timelineDurationBeats>range.start).sort((a,b)=>a.timelineStartBeat-b.timelineStartBeat);
    const first=hits[0],saved=first?.repeatSlice;
    const fail=message=>{window.showToast?.(message,true);return false;};
    if(!first)return fail('Select part of an audio clip first.');
    const soundKey=c=>JSON.stringify([c.path,c.bpm,c.sourceStartBeat,c.beatgrid,c.pitchSemitones,c.keySync,c.fluidSync,c.volume,c.pan,c.muted,c.stemJob,c.stemPlaybackMode,c.stemMix,c.nativeEffect,c.repeatSlice?.sourceEndSeconds]);
    let edge=range.start;
    for(const c of hits){
      if(c.timelineStartBeat>edge+1e-6||c!==first&&Math.abs(c.timelineStartBeat-edge)>1e-6||hits.length>1&&(!saved||c.repeatSlice?.id!==saved.id||c.path!==first.path))return fail('Select one clip or a continuous section of its repeats.');
      if(c!==first&&soundKey(c)!==soundKey(first))return fail('Select repeats with matching sound settings, or adjust each edited section separately.');
      edge=c.timelineStartBeat+c.timelineDurationBeats;
    }
    if(edge<range.end-1e-6||first.timelineStartBeat>range.start)return fail('Keep the selection inside the audio.');
    const ratio=first.sourceDurationBeats/first.timelineDurationBeats,length=range.end-range.start;
    const sourceStart=first.sourceStartBeat+(range.start-first.timelineStartBeat)*ratio;
    const savedEnd=Number.isFinite(saved?.sourceEndSeconds)?existing.sourceSecondsToBeat(first,saved.sourceEndSeconds):saved?.sourceEndBeat;
    const available=saved?Math.min(length,(savedEnd-sourceStart)/ratio):length;
    const current=saved?Math.min(saved.unitBeats,length):length,unit=current*factor;
    if(![ratio,sourceStart,available,unit].every(Number.isFinite)||ratio<=0||existing.sourceBeatToSeconds(first,sourceStart)<-1e-6)return false;
    if(unit<.0625-1e-6||Math.ceil(length/unit)>256)return fail('This section is already at the shortest repeat length.');
    if(unit>available+1e-6)return fail('This is already the full selected phrase. Use Half repeat length for tighter repeats.');
    const before=rangeSnapshot(),beforeSelection=clipSelectionSnapshot(),after=[],copies={},repeated=[];
    const slice=(c,a,b)=>{
      const rate=c.sourceDurationBeats/c.timelineDurationBeats;
      const part={...c,id:clipId('repeat'),sourceIntent:'trimmed',timelineStartBeat:a,timelineDurationBeats:b-a,sourceStartBeat:c.sourceStartBeat+(a-c.timelineStartBeat)*rate,sourceDurationBeats:(b-a)*rate};
      copies[part.id]={clip:c};return part;
    };
    for(const c of arrangementClips()){
      if(!hits.includes(c)){after.push(c);continue;}
      if(c.timelineStartBeat<range.start)after.push(slice(c,c.timelineStartBeat,range.start));
      if(c.timelineStartBeat+c.timelineDurationBeats>range.end)after.push(slice(c,range.end,c.timelineStartBeat+c.timelineDurationBeats));
    }
    const group=clipId('repeat-group');
    for(let start=range.start;start<range.end-1e-6;start+=unit){
      const duration=Math.min(unit,range.end-start),part={...first,id:clipId('repeat'),sourceIntent:'trimmed',timelineStartBeat:start,timelineDurationBeats:duration,sourceStartBeat:sourceStart,sourceDurationBeats:duration*ratio,
        repeatSlice:{id:group,unitBeats:unit,sourceEndBeat:sourceStart+available*ratio,sourceEndSeconds:existing.sourceBeatToSeconds(first,sourceStart+available*ratio)}};
      copies[part.id]={clip:first};repeated.push(part);after.push(part);
    }
    stopParameterPlayback();p.arrangementClips=after;
    mixerSelection.clear();repeated.forEach(c=>mixerSelection.add(c.id));selectedClipId=repeated[0].id;clipEditorOpen=false;
    recordClipEdit(before,beforeSelection,copies);renderShell('set');paintRange();
    window.showToast?.(factor===.5?'Tighter repeats added. The section stays the same length.':'Repeat length doubled. The section stays the same length.');return true;
  }
  // Separation receipts are background cache state, not arrangement edits.
  // Keep mix levels and every timing/grid field in the conflict check.
  const stemReceiptFields=['stemRequestKey','stemCancelRequested','stemState','stemJob','stemSourceStart','stemCoverage','stemRecipe','stemPlaybackBeforeRefresh','stemAutoRefreshQueued','stemAutoRefreshCoverage','stemAutoRefreshAttempts'];
  function comparableHistory(snapshot,timeline=false){
    const state=JSON.parse(snapshot);
    if(timeline)delete state.editCursorBeat;
    for(const clip of timeline?state.arrangementClips:state){
      if(clip.stemPlaybackBeforeRefresh)clip.stemPlaybackMode=clip.stemPlaybackBeforeRefresh;
      if(clip.stemPlaybackMode==='stems')delete clip.stemPlaybackMode;
      for(const key of stemReceiptFields)delete clip[key];
    }
    return JSON.stringify(state,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);
  }
  function refreshHistoryStems(snapshot,currentClips,timeline=false){
    const state=JSON.parse(snapshot);
    for(const clip of timeline?state.arrangementClips:state){
      const current=currentClips.find(c=>c.id===clip.id&&c.path===clip.path)||
        currentClips.find(c=>c.path===clip.path&&clip.stemRequestKey&&c.stemRequestKey===clip.stemRequestKey);
      if(!current)continue;
      const playbackMode=clip.stemPlaybackBeforeRefresh||clip.stemPlaybackMode;
      for(const key of stemReceiptFields){if(Object.hasOwn(current,key))clip[key]=current[key];else delete clip[key];}
      if(clip.stemPlaybackBeforeRefresh)clip.stemPlaybackMode='original';
      if(clip.stemJob&&clip.stemCoverage&&['ready','stale'].includes(clip.stemState)){
        const {start,end}=clip.stemCoverage;
        clip.stemSourceStart=existing.sourceSecondsToBeat(clip,start);
        clip.stemState=existing.sourceBeatToSeconds(clip,clip.sourceStartBeat)>=start-1e-6&&
          existing.sourceBeatToSeconds(clip,clip.sourceStartBeat+clip.sourceDurationBeats)<=end+1e-6?'ready':'stale';
        if(clip.stemState==='ready'){
          if(playbackMode)clip.stemPlaybackMode=playbackMode;else delete clip.stemPlaybackMode;
          delete clip.stemPlaybackBeforeRefresh;
        }else if(playbackMode!=='original'){
          clip.stemPlaybackMode='original';clip.stemPlaybackBeforeRefresh=playbackMode||'stems';
        }
      }
    }
    return JSON.stringify(state);
  }
  function undoRange(redo=false) {
    if(!dispatchingHistory)return window.AxiomEditHistory.undo(activeProject,redo);
    const source=redo?rangeRedo:rangeHistory,destination=redo?rangeHistory:rangeRedo;
    const history=source.get(activeProject),entry=history?.at(-1);if(!entry)return false;
    const current=entry.kind==='timeline'?timelineSnapshot(activeProject,entry.includeSources):rangeSnapshot();
    const comparable=snapshot=>comparableHistory(snapshot,entry.kind==='timeline');
    if(comparable(current)!==comparable(entry[redo?'before':'after'])){showToast('Other timeline changes followed this edit. History cannot safely replace them.',true);return false;}
    if(entry.beforeFx!==undefined&&JSON.stringify(activeProject.fxRegions||[])!==entry[redo?'beforeFx':'afterFx'])return false;
    if(entry.beforeAutomation!==undefined&&JSON.stringify(activeProject.automationLanes||[])!==entry[redo?'beforeAutomation':'afterAutomation'])return false;
    // Refresh both sides so Redo can restore removed clips with completed stems.
    const expectedState=JSON.parse(entry[redo?'before':'after']);
    const expectedClips=entry.kind==='timeline'?expectedState.arrangementClips:expectedState;
    const receipt=c=>JSON.stringify(stemReceiptFields.map(key=>c?.[key]));
    const completed=activeProject.arrangementClips.filter(c=>receipt(c)!==receipt(expectedClips.find(old=>old.id===c.id)));
    for(const side of ['before','after'])entry[side]=refreshHistoryStems(entry[side],completed,entry.kind==='timeline');
    window.AxiomArrangement?.stop(false);window.AxiomStems?.stop();
    if(entry.kind==='timeline')restoreTimelineSnapshot(activeProject,entry[redo?'after':'before']);
    else activeProject.arrangementClips=JSON.parse(entry[redo?'after':'before']);
    history.pop();
    if(entry.beforeFx!==undefined)activeProject.fxRegions=JSON.parse(entry[redo?'afterFx':'beforeFx']);
    if(entry.beforeAutomation!==undefined)activeProject.automationLanes=JSON.parse(entry[redo?'afterAutomation':'beforeAutomation']);
    const next=destination.get(activeProject)||[];next.push(entry);destination.set(activeProject,next);
    clearRange();mixerSelection.clear();clipEditorOpen=false;
    const selection=entry[redo?'afterSelection':'beforeSelection'];
    const id=typeof selection==='object'?selection?.id:selection;
    selectedClipId=activeProject.arrangementClips.some(c=>c.id===id)?id:activeProject.arrangementClips[0]?.id||'';
    for(const selected of (typeof selection==='object'?selection?.ids||[]:id?[id]:[])){
      if(activeProject.arrangementClips.some(c=>c.id===selected))mixerSelection.add(selected);
    }
    if(selection?.sectionId)activeSectionId=selection.sectionId;
    if(selection?.range){rangeSelection={...selection.range};rangeProject=activeProject;}
    renderShell('set');paintRange();return true;
  }
  function openRangeMenu(event) {
    if(!rangeSelection)return true;
    event.preventDefault();event.stopPropagation();hideContextMenu();
    contextMenu=document.createElement('div');contextMenu.className='studio-daw-context-menu';contextMenu.setAttribute('role','menu');contextMenu.setAttribute('aria-label','Selected range actions');
    const add=(label,fn)=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('role','menuitem');button.onclick=click=>{click.stopPropagation();hideContextMenu();fn();};contextMenu.appendChild(button);};
    const showMenu=()=>{
      document.body.appendChild(contextMenu);
      contextMenu.style.top=`${Math.max(8,Math.min(event.clientY,window.innerHeight-contextMenu.getBoundingClientRect().height-8))}px`;
    };
    const range={...rangeSelection},rangeOwner=activeProject;
    const quickEffect=(type)=>{
      if(activeProject!==rangeOwner)return;
      const fx=window.AxiomDawFx;if(!fx)return;
      const targets=fx.rangeTargets(activeProject,range.start,range.end);
      const target=type==='enhance'||range.sectionId==='master'?'master':range.sectionId!=='fx'?range.sectionId:targets.length===1?targets[0]:null;
      if(target||!targets.length){if(fx.quickApply(type,range,target||'master')&&type==='enhance')fx.edit(activeProject.fxRegions.at(-1).id);return;}
      contextMenu=document.createElement('div');contextMenu.className='studio-daw-context-menu';contextMenu.setAttribute('role','menu');contextMenu.setAttribute('aria-label','Choose effect track');
      const title=document.createElement('strong');title.textContent=`${type==='echoOut'?'Echo Out':fx.label(type)} on...`;contextMenu.append(title);
      for(const id of [...targets,'master'])add(fx.targetLabels[id],()=>{if(activeProject===rangeOwner)fx.quickApply(type,range,id);});
      contextMenu.style.left=`${Math.max(8,Math.min(event.clientX,window.innerWidth-250))}px`;
      contextMenu.style.top=`${Math.max(8,Math.min(event.clientY,window.innerHeight-280))}px`;
      showMenu();
    };
    add('Set range length...',()=>{const raw=window.prompt('Selected length in bars',String((rangeSelection.end-rangeSelection.start)/4));if(raw===null)return;const bars=Number(raw);if(Number.isFinite(bars)&&bars>0&&bars<=256)setRange(rangeSelection.sectionId,rangeSelection.start,rangeSelection.start+bars*4);});
    add('Loop project in this range',()=>{try{window.AxiomArrangement.setLoop(activeProject,rangeSelection.start,rangeSelection.end);window.AxiomArrangement.play(activeProject);}catch(error){window.showToast?.(error.message,true);}});
    if(window.AxiomArrangement?.getLoop?.(activeProject))add('Turn loop off',()=>window.AxiomArrangement.clearLoop());
    for(const [type,label] of [['echoOut','Echo Out'],['echo','Echo'],['tapeStop','AXIOM Tape Stop'],['beatRepeat','AXIOM Stutter'],['transitionBuild','AXIOM Build'],['saturate','AXIOM Warmth'],['bitcrush','AXIOM Crunch'],['lowpass','Low-pass sweep'],['highpass','High-pass sweep'],['reverb','Reverb'],['vintageReverb','AXIOM Vintage Reverb'],['tranceGate','AXIOM Trance Gate'],['enhance','AXIOM Mix Enhance']])add(label,()=>quickEffect(type));
    add('Chop selected audio to pads...',()=>{const hits=arrangementClips().filter(c=>c.sectionId===range.sectionId&&c.timelineStartBeat<range.end&&c.timelineStartBeat+c.timelineDurationBeats>range.start);if(activeProject===rangeOwner&&hits.length===1)window.AxiomCreativeTools.open('chop',hits[0],range);else window.showToast?.('Select a range within one audio clip.',true);});
    add('Render Reverb Tail...',()=>renderReverbTailForRange(range));
    add('Custom effect...',()=>window.AxiomDawFx?.edit(null,{startBeat:range.start,durationBeats:range.end-range.start,...(range.sectionId!=='fx'?{target:range.sectionId}:{})}));
    if(rangeSelection.sectionId!=='fx') {
      add('Copy selected audio',copySelection);
      add('Cut selected audio',cutSelection);
      add('Half repeat length · tighter',()=>repeatRange(.5));
      add('Double repeat length · longer',()=>repeatRange(2));
      add('Delete selected audio',()=>editRange('delete'));
      add('Move selected audio to bar...',()=>{const raw=window.prompt('Destination bar (1 = project start)',String(rangeSelection.start/4+1));if(raw!==null && Number(raw)>=1)editRange('move',(Number(raw)-1)*4);});
    }
    add('Clear selection',clearRange);
    contextMenu.style.left=`${Math.max(8,Math.min(event.clientX,window.innerWidth-250))}px`;
    contextMenu.style.top=`${Math.max(8,Math.min(event.clientY,window.innerHeight-280))}px`;
    showMenu();return false;
  }
  function startRangeDrag(event) {
    if(event.button!==0 || !activeProject)return;
    if(event.target?.closest?.('.daw-fade-handle,.daw-trim-handle,.daw-fx-resize'))return;
    const lane=event.target?.closest?.('#studio-daw-lanes [data-daw-section]');if(!lane)return;
    const rangeTarget=event.target?.closest?.('.daw-range-selection');
    const clipTarget=event.target?.closest?.('article[data-daw-clip-id]');
    if(clipTarget && !rangeTarget)return;
    const moving=Boolean(rangeTarget);
    if(!moving && !rangeMode && event.target.closest('article,button,input,select')){clearRange();return;}
    if(moving && rangeSelection?.sectionId==='fx'){event.preventDefault();event.stopPropagation();return;}
    const body=lane.querySelector('.studio-daw-lane-body'),rect=body.getBoundingClientRect(),span=viewBeats || timelineWorkspaceBeats();
    const at=e=>snapBeat(viewStartBeat+(e.clientX-rect.left)/rect.width*span,e);
    const first=at(event),origin=rangeSelection?{...rangeSelection}:null;
    let dragged=false;rangeDragging=true;
    event.preventDefault();event.stopPropagation();
    const move=e=>{
      if(Math.abs(e.clientX-event.clientX)<4 && !dragged)return;
      dragged=true;
      if(!moving)setRange(lane.dataset.dawSection,Math.min(first,at(e)),Math.max(first,at(e)));
      else {
        const box=body.querySelector('.daw-range-selection');
        if(box)box.style.transform=`translateX(${e.clientX-event.clientX}px)`;
      }
    };
    const end=e=>{
      document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',end);document.removeEventListener('pointercancel',cancel);rangeDragging=false;
      if(dragged){suppressRangeClick=true;setTimeout(()=>{suppressRangeClick=false;},0);}
      if(moving && dragged) {
        const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-daw-section]');
        if(target)editRange('move',Math.max(0,origin.start+at(e)-first),target.dataset.dawSection);
        paintRange();
      }
    };
    const cancel=e=>{end({...e,clientX:event.clientX,clientY:-1});rangeSelection=origin;paintRange();};
    document.addEventListener('pointermove',move);document.addEventListener('pointerup',end);document.addEventListener('pointercancel',cancel);
  }
  let selectedClipIndex = 0;
  let selectedClipId = '';
  let selectedClipPointerRatio = 0;
  let clipboardTrack = null;
  let arrangementClipboard = null;
  let projectBlockSelection = null;
  let targetLayerIndex = 0;
  let zoomMode = 'arrange';
  let zoomTarget = 'arrange';
  let clipEditorOpen = false;
  const sourceViews = new WeakMap();
  let sourceWheelFrame = null;
  let sourceStartGesture = null;

  function focusZoom(target) { zoomTarget = target === 'source' ? 'source' : 'arrange'; }

  function sourceView(clip) {
    if (!sourceViews.has(clip)) {const limits=sourceLimits(clip);sourceViews.set(clip,{span:limits.end-limits.start,start:limits.start});}
    return sourceViews.get(clip);
  }
  function sourceViewSeconds(clip) {
    const view=sourceView(clip);
    return {start:secondsFromBeat(clip,view.start),end:secondsFromBeat(clip,view.start+view.span)};
  }
  function restoreSourceViewSeconds(clip,view) {
    const start=existing.sourceSecondsToBeat(clip,view.start),end=existing.sourceSecondsToBeat(clip,view.end);
    sourceViews.set(clip,{start,span:end-start});
  }

  function sourceLimits(clip) {
    const start=existing.sourceSecondsToBeat(clip,0);
    const duration=window.AxiomWaveformDetail?.duration?.(clip.path)||durationSecondsFromTrack(clip);
    const end=duration>0?existing.sourceSecondsToBeat(clip,duration):clip.sourceStartBeat+clip.sourceDurationBeats;
    return {start,end:Math.max(start+1/960,end)};
  }
  function musicalRound(value) {
    if(!Number.isFinite(value))return value;
    const ticks=Math.round(value*15360)/15360;
    return Math.abs(ticks-Math.round(ticks))<1e-10?Math.round(ticks):Number(ticks.toFixed(10));
  }
  function sourceGridStepBeats(span) {
    const safeSpan=Number(span);
    return Math.pow(2,Math.ceil(Math.log2((Number.isFinite(safeSpan)&&safeSpan>0?safeSpan:4)/24)));
  }
  function sourceSnapBeat(clip,beat,{force=false,rect=null,span=null}={}) {
    if(!snapEnabled||clip?.snapDisabled||!Number.isFinite(beat))return Number(Math.max(0,beat).toFixed(10));
    const view=sourceView(clip),visibleSpan=span||view.span||clip.sourceDurationBeats||4,step=sourceGridStepBeats(visibleSpan);
    const nearest=musicalRound(Math.round(beat/step)*step);
    if(force)return Math.max(0,nearest);
    const width=rect?.width||0;
    if(width>0&&Math.abs(nearest-beat)*width/visibleSpan<=8)return Math.max(0,nearest);
    return Number(Math.max(0,beat).toFixed(10));
  }
  function sourceCueBeat(clip) {
    return sourceView(clip).cue ?? (clip.sourceStartBeat+selectedClipPointerRatio*clip.sourceDurationBeats);
  }
  function paintSourcePlayback(clip,seconds) {
    if(clip!==selectedArrangementClip()||!clipEditorOpen)return;
    const beat=existing.sourceSecondsToBeat(clip,seconds),view=sourceView(clip),span=view.span||clip.sourceDurationBeats;
    const limits=sourceLimits(clip);view.cue=Math.max(limits.start,Math.min(limits.end,beat));
    selectedClipPointerRatio=Math.max(0,Math.min(1,(view.cue-clip.sourceStartBeat)/clip.sourceDurationBeats));
    activeProject.editCursorBeat=clip.timelineStartBeat+clip.timelineDurationBeats*selectedClipPointerRatio;
    window.AxiomArrangement?.seekBeat(activeProject,activeProject.editCursorBeat);
    if(beat>view.start+span||beat<view.start){view.start=Math.max(limits.start,Math.min(limits.end-span,beat-span/2));renderStepEditor();}
    paintEditCursor(clip);
  }
  function playSourceCue() {
    const clip=selectedArrangementClip();if(!clip)return false;
    focusZoom('source');
    return window.AxiomSourceAudition?.toggle(activeProject,clip,Math.max(0,secondsFromBeat(clip,sourceCueBeat(clip))));
  }
  function sourceCuePosition(id){const c=clipByReference(id);const beat=sourceCueBeat(c);return {beat,seconds:secondsFromBeat(c,beat)};}
  function compareSource(mode){const c=selectedArrangementClip();if(c)return window.AxiomRemixWorkflow?.compare(mode,c,sourceCuePosition(c.id).seconds);}
  function locateSourceSeconds(id,seconds){
    const c=clipByReference(id);if(!c)return;
    const beat=existing.sourceSecondsToBeat(c,seconds),view=sourceView(c),limits=sourceLimits(c);
    view.cue=beat;view.span=Math.min(16,limits.end-limits.start);view.start=Math.max(limits.start,Math.min(limits.end-view.span,beat-4));
    gridEditMode=true;focusZoom('source');renderStepEditor();
  }
  function repairSnapBeat(id,beat,seconds){
    const c=clipByReference(id);if(!c?.beatgrid)throw new Error('Select a prepared song.');
    const anchors=window.AxiomRemixWorkflow.repairAnchors(c.beatgrid.beatAnchors,beat,seconds);
    const reference=existing.createBeatgridReference({...c.beatgrid,beatAnchors:anchors,metadata:{...c.beatgrid.metadata,manuallyCorrected:true}});
    return applySourceGrid(id,anchors,reference,null,true);
  }
  function zoomSource(direction) {
    stopClipDragScroll();
    const clip=selectedArrangementClip();
    if (!clip) return;
    focusZoom('source');
    const view=sourceView(clip),oldSpan=view.span||clip.sourceDurationBeats,limits=sourceLimits(clip);
    const span=direction===0?limits.end-limits.start:Math.min(limits.end-limits.start,Math.max(.0625,oldSpan*(direction>0?.8:1.25)));
    view.start=direction===0?limits.start:Math.max(limits.start,Math.min(limits.end-span,sourceCueBeat(clip)-span/2));
    view.span=span;
    renderStepEditor();
  }

  function panSource(direction) {
    stopClipDragScroll();
    const clip=selectedArrangementClip();if(!clip)return;
    const view=sourceView(clip),span=view.span||clip.sourceDurationBeats,limits=sourceLimits(clip);
    view.start=Math.max(limits.start,Math.min(limits.end-span,view.start+direction*span/2));
    focusZoom('source');renderStepEditor();
  }
  function sourceWheel(event) {
    if(event.defaultPrevented||event.target?.closest?.('button,input,select'))return;
    const clip=selectedArrangementClip();if(!clip)return;
    event.preventDefault();event.stopPropagation();focusZoom('source');
    if(sourceStartGesture)return;
    const view=sourceView(clip),span=view.span||clip.sourceDurationBeats,limits=sourceLimits(clip);
    const width=event.currentTarget.getBoundingClientRect().width;if(!width)return;
    const horizontal=event.shiftKey||Math.abs(event.deltaX)>Math.abs(event.deltaY);
    const delta=(horizontal?(event.shiftKey?(event.deltaX||event.deltaY):event.deltaX):event.deltaY)*(event.deltaMode===1?16:event.deltaMode===2?width:1);
    if(!Number.isFinite(delta)||delta===0)return;
    const previousStart=view.start,previousSpan=view.span;
    if(horizontal)view.start=Math.max(limits.start,Math.min(limits.end-span,view.start+delta/width*span));
    else {
      const cue=sourceCueBeat(clip),anchor=cue>=view.start&&cue<=view.start+span?cue:view.start+span/2;
      const fraction=(anchor-view.start)/span;
      view.span=Math.min(limits.end-limits.start,Math.max(.0625,span*Math.exp(Math.max(-.3,Math.min(.3,delta*.003)))));
      view.start=Math.max(limits.start,Math.min(limits.end-view.span,anchor-fraction*view.span));
    }
    if(view.start===previousStart&&view.span===previousSpan)return;
    const frame={project:activeProject,clip};
    if(sourceWheelFrame?.project===frame.project&&sourceWheelFrame.clip===clip)return;
    sourceWheelFrame=frame;
    requestAnimationFrame(()=>{
      if(sourceWheelFrame!==frame)return;
      sourceWheelFrame=null;
      if(activeProject===frame.project&&selectedArrangementClip()===clip)renderStepEditor();
    });
  }

  function locateSourceStart(event) {
    event?.preventDefault();event?.stopPropagation();
    const clip=selectedArrangementClip();if(!clip)return;
    sourceView(clip).start=clip.sourceStartBeat;
    focusZoom('source');selectClip(clip.id,{pointerRatio:0,render:true});
  }

  function dragSourceStart(event) {
    if(event.button!==0)return;
    event.preventDefault();event.stopPropagation();
    const clip=selectedArrangementClip(),target=event.currentTarget;
    if(!clip||target.classList.contains('offscreen'))return;
    const detail=target.closest('.daw-source-detail'),rect=detail?.getBoundingClientRect();
    if(!rect?.width)return;
    const project=activeProject,view={...sourceView(clip)},span=view.span||clip.sourceDurationBeats;
    const original={...clip},x=event.clientX;let moved=false,position=clip.sourceStartBeat;
    const step=sourceGridStepBeats(span);
    sourceStartGesture={project,clip};
    target.setPointerCapture(event.pointerId);
    target.onpointermove=move=>{
      if(activeProject!==project||selectedArrangementClip()!==clip)return;
      if(!moved&&Math.abs(move.clientX-x)<3)return;
      moved=true;
      position=original.sourceStartBeat+(move.clientX-x)/rect.width*span;
      if(move.shiftKey&&snapEnabled&&!clip.snapDisabled&&!move.altKey)position=Math.round(position/step)*step;
      const ratio=original.sourceDurationBeats/original.timelineDurationBeats;
      const minimum=existing.sourceSecondsToBeat(clip,0);
      position=Math.max(minimum,Math.min(original.sourceStartBeat+original.sourceDurationBeats-Math.min(original.timelineDurationBeats,1/960)*ratio,position));
      target.style.left=Math.max(0,Math.min(100,(position-view.start)/span*100))+'%';
      target.setAttribute('aria-description',`Clip start at ${secondsFromBeat(clip,position).toFixed(4)} seconds. Hold Shift to snap.`);
    };
    const finish=end=>{
      target.onpointermove=target.onpointerup=target.onpointercancel=target.onlostpointercapture=null;
      window.removeEventListener('blur',finish);
      sourceStartGesture=null;
      if(activeProject!==project||selectedArrangementClip()!==clip)return;
      if(moved&&end.type==='pointerup'){
        anchorClipStart(clip.id,secondsFromBeat(clip,position));
        selectedClipPointerRatio=0;delete sourceView(clip).cue;activeProject.editCursorBeat=clip.timelineStartBeat;
      }
      renderShell('set');
    };
    target.onpointerup=target.onpointercancel=target.onlostpointercapture=finish;
    window.addEventListener('blur',finish);
  }

  function anchorClipStart(id,seconds) {
    const clip=clipByReference(id);if(!clip)return false;
    const end=secondsFromBeat(clip,clip.sourceStartBeat+clip.sourceDurationBeats);
    if(!Number.isFinite(seconds)||seconds<0||seconds>=end-1/48000)return false;
    const view=sourceViewSeconds(clip);
    if(clip.beatgrid?.metadata?.method==='axiom-snap'){
      const changed=applyAutomaticSnap(clip,clip.beatgrid.beatAnchors,seconds);
      selectedClipPointerRatio=0;restoreSourceViewSeconds(clip,view);renderShell('set');return changed;
    }
    const beat=existing.sourceSecondsToBeat(clip,seconds);
    const anchors=clip.beatgrid?.beatAnchors||[{beat:0,seconds:0},{beat:4,seconds:secondsFromBeat(clip,4)}];
    const reference=existing.createBeatgridReference({source:clip.beatgrid?.source||'manual',mode:'fluid',trackPath:clip.path,
      beatAnchors:anchors.map(a=>({...a,beat:a.beat-beat})),metadata:{...clip.beatgrid?.metadata,clipStartSeconds:seconds,clipLocalAnchor:true}});
    applySourceGrid(id,reference.beatAnchors,reference,{sourceSeconds:seconds,timelineStartBeat:clip.timelineStartBeat});
    selectedClipPointerRatio=0;restoreSourceViewSeconds(clip,view);activeProject.editCursorBeat=clip.timelineStartBeat;
    window.AxiomArrangement?.seekBeat(activeProject,clip.timelineStartBeat);renderShell('set');return true;
  }

  function setSourceDownbeat() {
    const clip=selectedArrangementClip();if(!clip)return false;
    try{return anchorClipStart(clip.id,secondsFromBeat(clip,sourceCueBeat(clip)));}
    catch(error){window.showToast?.(error.message,true);return false;}
  }

  function trimSourceStart() {
    const clip=selectedArrangementClip(); if(!clip) return;
    trimClip(clip.id,'left',clip.timelineStartBeat+(sourceCueBeat(clip)-clip.sourceStartBeat)*clip.timelineDurationBeats/clip.sourceDurationBeats);
    selectedClipPointerRatio=0;sourceViews.delete(clip);renderShell('set');
  }

  let beatCorrectionMode='fixed';
  let gridEditMode=false;
  function findSourcePeak(){
    const clip=selectedArrangementClip();if(!clip)return false;
    const view=sourceView(clip),span=view.span||clip.sourceDurationBeats;
    try{
      if(!window.AxiomWaveformDetail)throw new Error('Waveform tools are still loading.');
      const seconds=window.AxiomWaveformDetail.findPeak(clip.path,existing.sourceBeatToSeconds(clip,view.start),existing.sourceBeatToSeconds(clip,view.start+span));
      if(seconds===null)throw new Error('No non-silent waveform peak in this range.');
      const beat=existing.sourceSecondsToBeat(clip,seconds);
      selectedClipPointerRatio=Math.max(0,Math.min(1,(beat-clip.sourceStartBeat)/clip.sourceDurationBeats));
      view.cue=beat;
      gridEditMode=true;focusZoom('source');renderStepEditor();return true;
    }catch(error){showToast(error.message,true);return false;}
  }
  function toggleGridEditing(){gridEditMode=!gridEditMode;renderStepEditor();}
  function dragGridAnchor(event,index){
    if(event.button!==0)return;
    event.preventDefault();event.stopPropagation();
    const clip=selectedArrangementClip(),project=activeProject;if(!clip?.beatgrid)return;
    const reference=clip.beatgrid,anchor=reference.beatAnchors[index];if(!anchor)return;
    const view={...sourceView(clip)},span=view.span||clip.sourceDurationBeats;
    const surface=event.currentTarget.closest('.daw-source-detail'),rect=surface.getBoundingClientRect(),handle=event.currentTarget;
    if(!rect.width)return;
    const original=JSON.stringify(clip);let moved=false,seconds=anchor.seconds;
    const move=e=>{
      if(Math.abs(e.clientX-event.clientX)<3&&!moved)return;moved=true;
      const fraction=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width));
      seconds=existing.sourceBeatToSeconds(clip,view.start+fraction*span);
      handle.style.left=`${fraction*100}%`;handle.title=`Beat ${anchor.beat}: ${seconds.toFixed(4)} seconds`;
    };
    const finish=e=>{
      document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',finish);document.removeEventListener('pointercancel',finish);
      if(e.type==='pointerup'&&moved&&activeProject===project&&JSON.stringify(clip)===original){
        try{if(beatCorrectionMode==='pinned')window.AxiomCreativeTools.align(clip,anchor.beat,seconds);else applySourceGrid(clip.id,existing.correctBeatAnchor(reference,anchor.beat,seconds,beatCorrectionMode));}catch(error){showToast(error.message,true);}
      }
      renderStepEditor();
    };
    document.addEventListener('pointermove',move);document.addEventListener('pointerup',finish);document.addEventListener('pointercancel',finish);
  }
  function setSourceBeatHere(value,mode=beatCorrectionMode){
    const clip=selectedArrangementClip();if(!clip)return false;
    const sourceBeat=sourceCueBeat(clip);
    const seconds=existing.sourceBeatToSeconds(clip,sourceBeat);
    const raw=value===undefined?document.getElementById('daw-source-beat-number')?.value:value;
    if(raw===null||String(raw).trim()==='')return false;
    try{
      const beat=Number(raw),reference=clip.beatgrid||{beatAnchors:[{beat:0,seconds:0},{beat:4,seconds:secondsFromBeat(clip,4)}]};
      if(mode==='pinned'){window.AxiomCreativeTools.align(clip,beat,seconds);return true;}
      const anchors=existing.correctBeatAnchor(reference,beat,seconds,mode);
      applySourceGrid(clip.id,anchors);
      selectedClipPointerRatio=Math.max(0,Math.min(1,(beat-clip.sourceStartBeat)/clip.sourceDurationBeats));
      sourceViews.delete(clip);renderStepEditor();return true;
    }catch(error){showToast(error.message,true);return false;}
  }

  function syncSourceGrid(){
    const clip=selectedArrangementClip();if(!clip?.beatgrid)return false;
    const phase=((clip.sourceStartBeat%1)+1)%1;
    return writeParameters([{id:clip.id,key:'fluidSync',value:true},
      {id:clip.id,key:'timelineDurationBeats',value:clip.sourceDurationBeats},
      {id:clip.id,key:'timelineStartBeat',value:Math.max(0,Math.round(clip.timelineStartBeat-phase))+phase},
      {key:'playbackMode',value:'preserve-pitch'}]);
  }

  function applyAutomaticSnap(clip,detected,chosenSeconds,analysisSource,reviewSpans,steadyBpm,analysis={}) {
    const localToClip=analysis.refresh===true||chosenSeconds!==undefined||clip.beatgrid?.metadata?.clipLocalAnchor===true;
    // Clip Start changes phase, never tempo. Translate the entire detected map
    // so its nearest beat becomes bar 1; moving only that beat stretches the
    // neighbouring intervals and makes the opening sound like slow motion.
    const seconds=chosenSeconds??clip.beatgrid?.metadata?.clipStartSeconds??secondsFromBeat(clip,clip.sourceStartBeat);
    const raw=existing.createBeatgridReference({source:'axiom',mode:'fluid',trackPath:clip.path,beatAnchors:detected});
    const rawMap=existing.compileBeatgrid(raw),origin=Math.round(rawMap.secondsToBeat(seconds));
    if(steadyBpm===undefined)steadyBpm=clip.beatgrid?.metadata?.steadyBpm;
    if(steadyBpm!=null&&(!Number.isFinite(steadyBpm)||steadyBpm<20||steadyBpm>400))throw new Error('Invalid steady grid tempo.');
    // Rephase a steady grid as one straight line. Pinning just one anchor
    // would introduce an artificial speed change around Clip Start.
    const shift=seconds-rawMap.beatToSeconds(origin);
    const anchors=detected.filter(a=>a.beat!==origin).map(a=>({beat:a.beat-origin,
      seconds:steadyBpm?seconds+(a.beat-origin)*60/steadyBpm:a.seconds+shift})).filter(a=>a.seconds>=0);
    // Retain the exact source-zero boundary when translation clips earlier
    // anchors, and the outgoing slope when the cue is beyond the stored map.
    if(seconds>0&&!anchors.some(a=>a.seconds===0))anchors.push({beat:steadyBpm?-seconds*steadyBpm/60:rawMap.secondsToBeat(-shift)-origin,seconds:0});
    if(!anchors.some(a=>a.beat>0))anchors.push({beat:1,seconds:steadyBpm?seconds+60/steadyBpm:rawMap.beatToSeconds(origin+1)+shift});
    anchors.push({beat:0,seconds});anchors.sort((a,b)=>a.beat-b.beat);
    const reference=existing.createBeatgridReference({source:'axiom',mode:'fluid',trackPath:clip.path,beatAnchors:anchors,
      metadata:{method:'axiom-snap',reviewRequired:false,clipStartSeconds:seconds,...(localToClip?{clipLocalAnchor:true}:{}),
        analysisSource:analysisSource||clip.beatgrid?.metadata?.analysisSource||'drum-stem',
        reviewSpans:reviewSpans??clip.beatgrid?.metadata?.reviewSpans??[],...(steadyBpm?{steadyBpm}:{}),
        timingVersion:analysis.timingVersion??clip.beatgrid?.metadata?.timingVersion,
        ...(steadyBpm&&(analysis.steadyEvidence||clip.beatgrid?.metadata?.steadyEvidence)?{steadyEvidence:analysis.steadyEvidence||clip.beatgrid.metadata.steadyEvidence}:{})}});
    const map=existing.compileBeatgrid(reference),updates=[],mapped=new Map();
    const originTimeline=Math.max(0,Math.round(clip.timelineStartBeat/4)*4);
    const targets=localToClip?[clip]:arrangementClips().filter(c=>c.path===clip.path&&!c.beatgrid?.metadata?.clipLocalAnchor);
    for(const target of targets){
      const start=map.secondsToBeat(target===clip&&chosenSeconds!==undefined?chosenSeconds:secondsFromBeat(target,target.sourceStartBeat));
      const end=map.secondsToBeat(secondsFromBeat(target,target.sourceStartBeat+target.sourceDurationBeats));
      // Preserve deliberate edit placement; contiguous slices remain contiguous.
      const relative=existing.sourceSecondsToBeat(clip,secondsFromBeat(target,target.sourceStartBeat))-clip.sourceStartBeat;
      const offset=target.timelineStartBeat-clip.timelineStartBeat-relative*clip.timelineDurationBeats/clip.sourceDurationBeats;
      const patch={beatgrid:reference,gridStatus:'ready',fluidSync:true,sourceStartBeat:start,sourceDurationBeats:end-start,
        timelineStartBeat:localToClip?target.timelineStartBeat:Math.max(0,originTimeline+start+offset),
        timelineDurationBeats:localToClip?(end-start)*target.timelineDurationBeats/target.sourceDurationBeats:end-start};
      if(target===clip&&chosenSeconds!==undefined){patch.sourceIntent='trimmed';patch.alignAudioStart=false;}
      if(Number.isFinite(target.stemSourceStart))patch.stemSourceStart=map.secondsToBeat(secondsFromBeat(target,target.stemSourceStart));
      mapped.set(target.id,{target,start});
      for(const [key,value] of Object.entries(patch))updates.push({id:target.id,key,value});
    }
    if((localToClip&&activeProject.automationLanes?.length)||activeProject.automationLanes?.some(l=>l.scope==='clip'&&mapped.has(l.targetId))){
      updates.push({key:'automationLanes',value:activeProject.automationLanes.map(l=>{
        const item=l.scope==='clip'&&mapped.get(l.targetId);if(!item)return l;
        const {target,start}=item,ratio=target.sourceDurationBeats/target.timelineDurationBeats;
        const points=l.points.map(point=>({...point,beat:map.secondsToBeat(secondsFromBeat(target,target.sourceStartBeat+point.beat*ratio))-start}));
        if(points.some(point=>point.beat<0)&&!points.some(point=>point.beat===0)){
          const oldBeat=(existing.sourceSecondsToBeat(target,seconds)-target.sourceStartBeat)/ratio,prior=l.points.filter(point=>point.beat<=oldBeat).at(-1);
          points.push({beat:0,value:window.AxiomDawAutomation.valueAt({...l,enabled:true},oldBeat,prior?.value??0),curve:prior?.curve||'hold'});
        }
        return {...l,points:points.filter(point=>point.beat>=0).sort((a,b)=>a.beat-b.beat)};
      })});
    }
    for(const key of ['sourceTracks','sourceTrack'])if(!localToClip&&activeProject[key]){
      const update=t=>t.path===clip.path?{...t,beatgrid:reference,gridStatus:'ready'}:t;
      updates.push({key,value:Array.isArray(activeProject[key])?activeProject[key].map(update):update(activeProject[key])});
    }
    if(chosenSeconds!==undefined)updates.push({key:'editCursorBeat',value:clip.timelineStartBeat});
    updates.push({key:'playbackMode',value:'preserve-pitch'});
    return writeParameters(updates,{keepPendingSnap:chosenSeconds===undefined});
  }

  function applySteadyTiming(id,times,firstDownbeat=0,trimPickup=false,refresh=false){
    const clip=clipByReference(id);if(!clip)return false;
    const automatic=!Array.isArray(times),structure=automatic?times:null;
    if(automatic){
      if(structure?.version!==1||!Array.isArray(structure.anchors)||structure.anchors.length<4||structure.anchors.length>6144)throw new Error('AXIOM Snap returned an invalid timing map.');
      firstDownbeat=structure.downbeatOffset;
      for(let i=0;i<structure.anchors.length;i++){
        const a=structure.anchors[i],prev=structure.anchors[i-1];
        if(!Number.isInteger(a.beat)||a.beat<0||a.beat>32768||!Number.isFinite(a.seconds)||a.seconds<0||prev&&(a.beat<=prev.beat||a.seconds<=prev.seconds))throw new Error('AXIOM Snap returned invalid beat positions.');
      }
      times=structure.anchors.map(a=>a.seconds);
    }
    if(!automatic)existing.validateDetectedBeatTimes(times);
    if(!Number.isInteger(firstDownbeat)||firstDownbeat<0||firstDownbeat>3||times.length<4)throw new Error('Invalid downbeat position.');
    const anchors=automatic?structure.anchors.map(a=>({beat:a.beat-firstDownbeat,seconds:a.seconds})):times.map((seconds,index)=>({beat:index-firstDownbeat,seconds}));
    if(automatic)return applyAutomaticSnap(clip,anchors,undefined,['serato','djay','axiom-mix'].includes(structure.analysisSource)?structure.analysisSource:'drum-stem',window.AxiomRemixWorkflow?.reviewSpans(structure)||[],structure.steadyBpm??null,{refresh,timingVersion:structure.timingVersion,steadyEvidence:structure.steadyEvidence});
    const reference=existing.createBeatgridReference({source:'axiom',mode:'fluid',trackPath:clip.path,beatAnchors:anchors,metadata:{method:'axiom-snap',reviewRequired:false}});
    const map=existing.compileBeatgrid(reference),oldStart=existing.sourceBeatToSeconds(clip,clip.sourceStartBeat),oldEnd=existing.sourceBeatToSeconds(clip,clip.sourceStartBeat+clip.sourceDurationBeats);
    const startSeconds=trimPickup?times[firstDownbeat]:oldStart;
    if(startSeconds<oldStart-1e-6||startSeconds>=oldEnd)throw new Error('The chosen downbeat is outside this clip.');
    const start=map.secondsToBeat(startSeconds),end=map.secondsToBeat(oldEnd);
    const position=Math.max(0,Math.ceil((clip.timelineStartBeat-start)/4)*4+start);
    const updates=[{id,key:'beatgrid',value:reference},{id,key:'gridStatus',value:'ready'},{id,key:'fluidSync',value:true},
      {id,key:'sourceIntent',value:trimPickup?'trimmed':clip.sourceIntent},{id,key:'sourceStartBeat',value:start},{id,key:'sourceDurationBeats',value:end-start},
      {id,key:'timelineStartBeat',value:position},{id,key:'timelineDurationBeats',value:end-start},{key:'playbackMode',value:'preserve-pitch'}];
    if(Number.isFinite(clip.stemSourceStart))updates.push({id,key:'stemSourceStart',value:map.secondsToBeat(existing.sourceBeatToSeconds(clip,clip.stemSourceStart))});
    if(activeProject.automationLanes?.some(l=>l.scope==='clip'&&l.targetId===id)){
      const ratio=clip.sourceDurationBeats/clip.timelineDurationBeats;
      const lanes=activeProject.automationLanes.map(l=>{
        if(l.scope!=='clip'||l.targetId!==id)return l;
        const points=l.points.map(point=>({...point,beat:map.secondsToBeat(existing.sourceBeatToSeconds(clip,clip.sourceStartBeat+point.beat*ratio))-start}));
        if(points.some(point=>point.beat<0)&&!points.some(point=>point.beat===0)){
          const oldBeat=(existing.sourceSecondsToBeat(clip,startSeconds)-clip.sourceStartBeat)/ratio,prior=l.points.filter(point=>point.beat<=oldBeat).at(-1);
          points.push({beat:0,value:window.AxiomDawAutomation.valueAt({...l,enabled:true},oldBeat,prior?.value??0),curve:prior?.curve||'hold'});
        }
        return {...l,points:points.filter(point=>point.beat>=0).sort((a,b)=>a.beat-b.beat)};
      });
      updates.push({key:'automationLanes',value:lanes});
    }
    return writeParameters(updates);
  }

  function seekSource(event) {
    event.preventDefault(); event.stopPropagation(); focusZoom('source');
    const clip=selectedArrangementClip(); if(!clip) return;
    const view=sourceView(clip),rect=event.currentTarget.getBoundingClientRect();
    let sourceBeat=view.start+Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width))*(view.span || clip.sourceDurationBeats);
    if(snapEnabled && !clip.snapDisabled && !event.altKey) {
      const step=sourceGridStepBeats(view.span || clip.sourceDurationBeats);
      const nearest=musicalRound(Math.round(sourceBeat/step)*step);
      // Grid correction needs free placement between lines, with a small
      // magnetic target at each visible line. Normal source editing should
      // also honor the visible snap lines so splits/duplicates stay musical.
      // Alt always bypasses snapping.
      if(event.shiftKey || Math.abs(nearest-sourceBeat)*rect.width/(view.span||clip.sourceDurationBeats)<=8) sourceBeat=nearest;
    }
    const limits=sourceLimits(clip);sourceBeat=Math.max(limits.start,Math.min(limits.end,sourceBeat));
    sourceBeat=event.altKey?Number(sourceBeat.toFixed(10)):sourceSnapBeat(clip,sourceBeat,{rect,span:view.span||clip.sourceDurationBeats});
    selectClip(clip.id,{sourceBeat,pointerRatio:(sourceBeat-clip.sourceStartBeat)/clip.sourceDurationBeats,cursorOnly:true});
    sourceView(clip).cueSnapBypassed=Boolean(event.altKey);
    window.AxiomArrangement?.seekBeat(activeProject,activeProject.editCursorBeat);
  }

  function dragSourceCursor(event) {
    if(event.button!==0||event.target?.closest?.('button,input,select'))return;
    event.preventDefault();event.stopPropagation();
    const detail=event.currentTarget,project=activeProject,clip=selectedArrangementClip();
    if(!clip)return;
    window.AxiomSourceAudition?.begin(activeProject,clip);
    let live=true,scheduled=false,latest=event;
    const paint=()=>{
      scheduled=false;
      if(!live||project!==activeProject||clip!==selectedArrangementClip())return;
      seekSource({currentTarget:detail,clientX:latest.clientX,altKey:latest.altKey,shiftKey:latest.shiftKey,preventDefault(){},stopPropagation(){}});
      window.AxiomSourceAudition?.scrub(Math.max(0,secondsFromBeat(clip,sourceCueBeat(clip))));
    };
    const move=e=>{latest=e;if(!scheduled){scheduled=true;requestAnimationFrame(paint);}};
    const finish=e=>{
      if(e.type==='pointerup'){latest=e;paint();}
      live=false;window.AxiomSourceAudition?.stop();
      document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',finish);document.removeEventListener('pointercancel',finish);
      window.removeEventListener('blur',finish);
    };
    document.addEventListener('pointermove',move);document.addEventListener('pointerup',finish);document.addEventListener('pointercancel',finish);
    window.addEventListener('blur',finish);paint();
  }

  function paintEditCursor(clip) {
    const editor=document.getElementById('studio-daw-step-editor'),detail=editor?.querySelector('.daw-source-detail');
    if(!detail||sourceEditorMarkup.get(editor)?.clip!==clip)return false;
    const view=sourceView(clip),span=view.span||clip.sourceDurationBeats,beat=sourceCueBeat(clip);
    let cursor=detail.querySelector('.daw-source-cursor');
    if(!cursor){cursor=document.createElement('b');cursor.className='daw-source-cursor';detail.appendChild(cursor);}
    cursor.style.left=`${(beat-view.start)/span*100}%`;
    cursor.hidden=beat<view.start||beat>view.start+span;
    const projectCursor=document.getElementById('studio-daw-lanes')?.querySelector('.studio-daw-playhead');
    if(projectCursor)projectCursor.style.left=`${Math.max(0,Math.min(100,(activeProject.editCursorBeat-viewStartBeat)/(viewBeats||timelineWorkspaceBeats(activeProject))*100))}%`;
    const tempo=editor.querySelector('.daw-source-tempo');
    if(tempo){let text;try{const grid=existing.trackGrid(clip);text=`${(grid?grid.bpmAtBeat(beat):Number(clip.bpm||120)).toFixed(3)} BPM`;}catch{text='Invalid grid';}if(tempo.textContent!==text)tempo.textContent=text;}
    const number=editor.querySelector('#daw-source-beat-number');
    if(number&&document.activeElement!==number)number.value=String(Math.round(beat));
    return true;
  }

  function renderSourceDetail() {
    const clip=selectedArrangementClip(); if(!clip) return '';
    const view=sourceView(clip),span=view.span || clip.sourceDurationBeats;
    const step=sourceGridStepBeats(span);
    let lines='';
    for(const hint of clip.beatgrid?.metadata?.reviewSpans||[]){
      const from=Math.max(view.start,existing.sourceSecondsToBeat(clip,hint.startSeconds)),to=Math.min(view.start+span,existing.sourceSecondsToBeat(clip,hint.endSeconds));
      if(to>from)lines+=`<i class="daw-snap-review-hint" aria-hidden="true" style="left:${(from-view.start)/span*100}%;width:${(to-from)/span*100}%"></i>`;
    }
    if(gridEditMode)for(const [index,anchor] of (clip.beatgrid?.beatAnchors||[]).entries()){
      if(anchor.beat<view.start||anchor.beat>view.start+span)continue;
      lines+=`<button type="button" class="daw-grid-anchor" style="left:${(anchor.beat-view.start)/span*100}%" aria-label="Grid anchor beat ${anchor.beat}" title="Beat ${anchor.beat}, ${anchor.seconds.toFixed(4)} seconds. Drag to align to a transient; right-click for exact editing." onpointerdown="AxiomStudioDaw.dragGridAnchor(event,${index})" onclick="event.preventDefault();event.stopPropagation()" oncontextmenu="event.preventDefault();event.stopPropagation();AxiomStudioDaw.editSourceGrid('${clip.id}')">${anchor.beat}</button>`;
    }
    for(let beat=Math.ceil(view.start/step)*step;beat<view.start+span;beat+=step) {
      const bar=Math.floor(beat/4)+1,pulse=Math.floor(((beat%4)+4)%4)+1;
      lines+=`<i class="${Math.abs(beat%4)<1e-8?'downbeat':''}" style="left:${(beat-view.start)/span*100}%"><small>${bar}.${pulse}${step<1?'.'+Math.round(((beat%1)+1)%1*960):''}</small></i>`;
    }
    const startPosition=(clip.sourceStartBeat-view.start)/span,startVisible=startPosition>=0&&startPosition<=1;
    const startTime=existing.sourceBeatToSeconds(clip,clip.sourceStartBeat);
    lines+=`<button type="button" class="daw-source-start${startVisible?'':' offscreen'}" style="left:${Math.max(0,Math.min(1,startPosition))*100}%" aria-label="Locate clip start" aria-description="Clip start at ${startTime.toFixed(3)} seconds. Drag to set bar 1; the grid and stems follow. Hold Shift to snap. Click to locate." onpointerdown="AxiomStudioDaw.dragSourceStart(event)" onclick="AxiomStudioDaw.locateSourceStart(event)"><span>${startVisible?'CLIP START':'&lt; CLIP START'}</span></button>`;
    const clipEnd=(clip.sourceStartBeat+clip.sourceDurationBeats-view.start)/span;
    if(startPosition>0)lines+=`<span class="daw-source-outside" style="left:0;width:${Math.min(1,startPosition)*100}%" aria-hidden="true"></span>`;
    if(clipEnd<1)lines+=`<span class="daw-source-outside" style="left:${Math.max(0,clipEnd)*100}%;right:0" aria-hidden="true"></span>`;
    const cursor=(sourceCueBeat(clip)-view.start)/span;
    const source = renderWaveformBars({...clip,sourceStartBeat:view.start,sourceDurationBeats:span});
    const status = clip.path
      ? '<output class="daw-waveform-status" data-waveform-status role="status">Loading source waveform…</output>'
      : '<output class="daw-waveform-status is-error" data-waveform-status role="status">Audio source unavailable for this clip. Reload the track from Library.</output>';
    return `<div class="daw-source-detail" tabindex="0" aria-label="Selected source waveform" aria-describedby="daw-source-help" onfocus="AxiomStudioDaw.focusZoom('source')" onpointerdown="AxiomStudioDaw.dragSourceCursor(event)" onwheel="AxiomStudioDaw.sourceWheel(event)">${source}${status}${lines}${cursor>=0&&cursor<=1?`<b class="daw-source-cursor" style="left:${cursor*100}%"></b>`:''}</div><div class="daw-source-zoom">
      <fieldset data-source-group="compare"><legend>Compare</legend><button type="button" class="daw-source-audition" aria-label="Play source cue" onclick="AxiomStudioDaw.playSourceCue()">Cue</button><button type="button" class="daw-remix-control" onclick="AxiomStudioDaw.compareSource('original')" title="Hear the original timing. Switching restarts the same comparison point.">Original</button><button type="button" class="daw-remix-control" onclick="AxiomStudioDaw.compareSource('snap')" title="Hear this clip quantized at project tempo with its edits. Switching restarts the same comparison point.">Snap</button><button type="button" class="daw-remix-control" onclick="AxiomRemixWorkflow.openReview()">Review</button><output class="daw-source-audition-status" role="status"></output></fieldset>
      <fieldset data-source-group="view"><legend>View</legend><button type="button" aria-label="Previous source range" title="Previous source range" onclick="AxiomStudioDaw.panSource(-1)">&lt;</button><button type="button" aria-label="Zoom source out" title="Zoom source out" onclick="AxiomStudioDaw.zoomSource(-1)">-</button><button type="button" title="Fit whole source, including trimmed audio" onclick="AxiomStudioDaw.zoomSource(0)">Fit</button><button type="button" aria-label="Zoom source in" title="Zoom source in" onclick="AxiomStudioDaw.zoomSource(1)">+</button><button type="button" aria-label="Next source range" title="Next source range" onclick="AxiomStudioDaw.panSource(1)">&gt;</button></fieldset>
      <fieldset data-source-group="repair"><legend>Repair</legend><button type="button" onclick="AxiomStudioDaw.setSourceDownbeat()">Downbeat</button><button type="button" onclick="AxiomStudioDaw.alignClipStart()" title="Remove detected leading silence and place the clip start on the nearest bar line. Undo is available.">Start On One</button><button type="button" onclick="AxiomStudioDaw.trimSourceStart()">Trim Start</button><button type="button" onclick="AxiomStudioDaw.splitActiveClip()">Split</button><button type="button" onclick="AxiomStudioDaw.undoSourceGrid();AxiomStudioDaw.zoomSource(0)">Undo Grid</button></fieldset>
      <abbr id="daw-source-help" class="daw-source-help" tabindex="0" aria-label="Source waveform help: Drag to hear and place the cue. Shift: snap. Wheel: zoom at cue. Shift+wheel: pan. Space: play source cue. Drag Clip Start to set bar 1; the grid and stems follow. Click Clip Start to locate." title="Drag to hear and place the cue. Shift: snap. Wheel: zoom at cue. Shift+wheel: pan. Space: play source cue. Drag Clip Start to set bar 1; the grid and stems follow. Click Clip Start to locate.">?</abbr>
      <details class="daw-source-more"><summary>More tools</summary><div class="daw-source-more-panel">
        <fieldset data-source-group="grid"><legend>Grid</legend></fieldset>
        <fieldset data-source-group="import"><legend>Import</legend></fieldset>
      </div></details>
    </div>`;
  }
  let viewStartBeat = 0;
  let viewBeats = 0;
  let contextMenu = null;
  let snapEnabled = true;
  let pendingLayer = null;
  const cueCache = new Map();
  const bpmHistories = new WeakMap();
  let selectedBpmPoint = -1;
  let bpmEditing = false;
  let bpmLaneSize = 'compact';

  function bpmHistory() {
    if (!bpmHistories.has(activeProject)) bpmHistories.set(activeProject,{undo:[],redo:[]});
    return bpmHistories.get(activeProject);
  }

  function bpmSnapshot() {
    const lane=bpmAutomation();
    return JSON.parse(JSON.stringify(lane));
  }

  function restoreBpmSnapshot(snapshot) {
    const restored=JSON.parse(JSON.stringify(snapshot));
    restored.scope ||= 'project';
    restored.parameter ||= 'bpm';
    restored.points ||= [];
    activeProject.automationLanes ||= [];
    const index=activeProject.automationLanes.findIndex(item=>item.scope==='project'&&item.parameter==='bpm');
    if(index>=0)activeProject.automationLanes[index]=restored;
    else activeProject.automationLanes.push(restored);
  }

  function syncBpmDisplay(beat=activeProject?.editCursorBeat||0,force=false) {
    const input=document.getElementById('studio-daw-top-bpm');
    if(!input||!activeProject)return;
    const precise=existing.compileTempoMap(activeProject).bpmAtBeat(beat);
    const card=input.closest?.('.daw-project-tempo'),label=card?.querySelector('span');
    if(card)card.dataset.mode=activeProject.mode==='mixtape'?'mixtape':'edit';
    if(label)label.textContent=activeProject.mode==='mixtape'?'NOW':'BPM';
    input.setAttribute('aria-label',activeProject.mode==='mixtape'?'Current automation BPM':'Project BPM');
    input.title=activeProject.mode==='mixtape'?`Current automation tempo: ${precise} BPM. Type here only if you want one fixed tempo.`:`Exact project tempo: ${precise} BPM. Click to edit.`;
    if(force||document.activeElement!==input)input.value=String(Math.round(precise));
  }

  function bpmPointTitle(point) {
    return 'BPM marker. Click to type, or drag left/right for timing and up/down for BPM.';
  }

  function beginProjectBpmEdit(input) {
    if(!activeProject)return;
    input.dataset.bpmEdited='false';
    input.value=String(existing.compileTempoMap(activeProject).bpmAtBeat(activeProject.editCursorBeat||0));
    input.select?.();
  }

  function finishProjectBpmEdit(input) {
    if(input.dataset.bpmEdited==='true')setProjectBpm(input.value);
    input.dataset.bpmEdited='false';
    syncBpmDisplay(undefined,true);
  }

  function recordBpmChange(before) {
    const after=bpmSnapshot();
    if (JSON.stringify(before)===JSON.stringify(after)) return;
    const history=bpmHistory(); history.undo.push({before,after});
    if(history.undo.length>100) history.undo.shift();
    history.redo=[];
    window.AxiomEditHistory.record(activeProject,'bpm');
    window.AxiomArrangement?.tempoChanged?.(activeProject);
    syncBpmDisplay();
  }

  function markBpmLaneManual() {
    const lane=bpmAutomation();
    if(lane.generatedBy){delete lane.generatedBy;delete lane.transitionBeats;}
    return lane;
  }

  function undoBpm(redo=false) {
    if(!dispatchingHistory)return window.AxiomEditHistory.undo(activeProject,redo);
    if(!activeProject) return false;
    const history=bpmHistory(), from=redo?history.redo:history.undo, to=redo?history.undo:history.redo;
    const entry=from.at(-1);if(!entry) return false;
    if(JSON.stringify(bpmSnapshot())!==JSON.stringify(entry[redo?'before':'after']))return false;
    from.pop();to.push(entry);
    restoreBpmSnapshot(entry[redo?'after':'before']);
    window.AxiomArrangement?.tempoChanged?.(activeProject);
    syncBpmDisplay();
    selectedBpmPoint=-1; hideContextMenu(); renderLanes(); return true;
  }

  function selectBpmPoint(event,index) {
    event?.preventDefault?.(); event?.stopPropagation?.();
    selectedBpmPoint=index;
    bpmEditing=true;
    document.querySelectorAll('[data-bpm-index]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.bpmIndex)===index)));
  }

  function removeBpmPoint(index=selectedBpmPoint) {
    if(!activeProject || !Number.isInteger(index) || index<0 || index>=bpmAutomation().points.length) return false;
    const before=bpmSnapshot(); bpmAutomation().points.splice(index,1);
    recordBpmChange(before); selectedBpmPoint=-1; hideContextMenu(); renderLanes(); return true;
  }

  function openBpmMenu(event,index) {
    event.preventDefault(); event.stopPropagation(); selectBpmPoint(null,index); hideContextMenu();
    contextMenu=document.createElement('div'); contextMenu.className='studio-daw-context-menu';
    contextMenu.setAttribute('role','menu'); contextMenu.setAttribute('aria-label','BPM marker actions');
    contextMenu.innerHTML=`<button type="button" role="menuitem" onclick="AxiomStudioDaw.editBpmPoint(event,${index});AxiomStudioDaw.hideContextMenu()">Edit BPM Marker</button><button type="button" role="menuitem" onclick="AxiomStudioDaw.removeBpmPoint(${index})">Remove BPM Marker</button><button type="button" role="menuitem" onclick="AxiomStudioDaw.undoBpm()">Undo BPM Edit</button>`;
    contextMenu.style.left=`${Math.max(8,Math.min(event.clientX,window.innerWidth-260))}px`;
    contextMenu.style.top=`${Math.max(8,Math.min(event.clientY,window.innerHeight-150))}px`;
    document.body.appendChild(contextMenu);
    return false;
  }

  function setBpmCurve(index,curve) {
    if(!['linear','hold'].includes(curve) || !bpmAutomation().points[index]) return false;
    const before=bpmSnapshot();bpmAutomation().points[index].curve=curve;
    recordBpmChange(before);hideContextMenu();renderLanes();return true;
  }

  function bpmAutomation(create = true) {
    let lane = activeProject.automationLanes?.find(item => item.scope === 'project' && item.parameter === 'bpm');
    if (!lane) {
      // Painting an empty timeline must not add data outside the edit history.
      if (!create) return { scope:'project', parameter:'bpm', points:[] };
      activeProject.automationLanes ||= [];
      lane = { scope:'project', parameter:'bpm', points:[{beat:0,value:activeProject.sourceTrack.bpm,curve:'linear'}] };
      activeProject.automationLanes.push(lane);
    }
    return lane;
  }

  function usableBpm(value, fallback = 120) {
    const bpm = Number(value);
    const base = Number(fallback);
    return Number.isFinite(bpm) && bpm >= 20 && bpm <= 400 ? bpm : (Number.isFinite(base) && base > 0 ? base : 120);
  }

  function pushTempoPoint(points, beat, value, curve = 'hold') {
    const cleanBeat = Math.max(0, Math.round(Number(beat) * 1000000) / 1000000);
    const cleanValue = Math.round(usableBpm(value) * 100) / 100;
    const existingPoint = points.find(point => Math.abs(point.beat - cleanBeat) < 0.000001);
    if (existingPoint) {
      existingPoint.value = cleanValue;
      existingPoint.curve = curve;
    } else {
      points.push({ beat: cleanBeat, value: cleanValue, curve });
    }
    points.sort((a, b) => a.beat - b.beat);
    return points.at(-1);
  }

  function mixtapeDeckClips(project = activeProject) {
    return (project?.arrangementClips || [])
      .filter(clip => ['left-deck', 'right-deck'].includes(clip.sectionId) && clip.path && clip.timelineDurationBeats > 0)
      .slice()
      .sort((a, b) => a.timelineStartBeat - b.timelineStartBeat || Number(a.trackIndex || 0) - Number(b.trackIndex || 0));
  }

  function mixtapeHandoffBeat(clip) {
    const start = Math.max(0, Number(clip?.timelineStartBeat || 0));
    const stored = Number(clip?.mixtapeHandoffBeat);
    if (!Number.isFinite(stored)) return start;
    const end = start + Math.max(0, Number(clip?.timelineDurationBeats || 0));
    return Math.max(start, Math.min(end || stored, stored));
  }

  function createMixtapeBpmLane(project = activeProject) {
    const clips = mixtapeDeckClips(project);
    const firstBpm = usableBpm(clips[0]?.bpm, project?.sourceTrack?.bpm || 120);
    const points = [];
    pushTempoPoint(points, 0, firstBpm, 'hold');
    clips.forEach((clip, index) => {
      const bpm = usableBpm(clip.bpm, firstBpm);
      if (index === 0) {
        pushTempoPoint(points, clip.timelineStartBeat || 0, bpm, 'hold');
        return;
      }
      const previous = clips[index - 1];
      const previousBpm = usableBpm(previous.bpm, firstBpm);
      const clipStart = Math.max(0, Number(clip.timelineStartBeat || 0));
      const handoffBeat = mixtapeHandoffBeat(clip);
      const previousStart = Math.max(0, Number(previous.timelineStartBeat || 0));
      const available = Math.max(0.25, handoffBeat - previousStart);
      const rampLength = clipStart < handoffBeat ? handoffBeat - clipStart : Math.min(16, available);
      const rampStart = Math.max(previousStart, handoffBeat - rampLength);
      pushTempoPoint(points, rampStart, previousBpm, 'linear');
      pushTempoPoint(points, handoffBeat, bpm, 'hold');
    });
    return {
      scope: 'project',
      parameter: 'bpm',
      generatedBy: 'mixtape',
      transitionBeats: 16,
      points: points.filter((point, index, all) => index === 0 || Math.abs(point.beat - all[index - 1].beat) > 0.000001),
    };
  }

  function shouldRegenerateMixtapeBpm(project = activeProject) {
    if (!project || project.projectTempoChosen) return false;
    const lane = (project.automationLanes || []).find(item => item.scope === 'project' && item.parameter === 'bpm');
    return !lane || lane.generatedBy === 'mixtape' || !Array.isArray(lane.points) || lane.points.length <= 1;
  }

  function syncMixtapeBpmAutomation(project = activeProject, force = false) {
    if (!project || project.mode !== 'mixtape' || (!force && !shouldRegenerateMixtapeBpm(project))) return false;
    const lane = createMixtapeBpmLane(project);
    project.automationLanes = [...(project.automationLanes || []).filter(item => item.parameter !== 'bpm'), lane];
    return true;
  }

  function setBpmPoint(index, beat, value, render = true) {
    if (!activeProject || !Number.isFinite(beat) || !Number.isFinite(value) || beat < 0 || value < 20 || value > 400) return false;
    bpmEditing=true;
    const lane = bpmAutomation();
    const before=render?bpmSnapshot():null;
    markBpmLaneManual();
    const previous=lane.points[index] || lane.points.find(item=>Math.abs(item.beat-beat)<.000001);
    const point = {beat,value:Math.round(value*100)/100,curve:previous?.curve || 'hold'};
    if (index >= 0 && index < lane.points.length) lane.points[index] = point;
    else {
      const duplicate = lane.points.findIndex(item => Math.abs(item.beat-point.beat)<.000001);
      if (duplicate >= 0) lane.points[duplicate] = point;
      else lane.points.push(point);
    }
    lane.points.sort((a,b)=>a.beat-b.beat);
    if(before) recordBpmChange(before);
    if (render) renderLanes();
    return true;
  }

  function setProjectBpm(raw){
    const value=Number(raw);
    if(!activeProject||!String(raw).trim()||!Number.isFinite(value)||value<20||value>400){showToast?.('Enter a project BPM between 20 and 400.',true);if(activeProject)renderHeader('set');return false;}
    const bpm=Math.round(value*100)/100;
    const lanes=(activeProject.automationLanes||[]).filter(l=>l.parameter!=='bpm');
    lanes.push({scope:'project',parameter:'bpm',points:[{beat:0,value:bpm,curve:'hold'}]});
    return writeParameters([{key:'automationLanes',value:lanes},{key:'projectTempoChosen',value:true},{key:'playbackMode',value:'preserve-pitch'}]);
  }

  function addBpmPoint(event) {
    event.preventDefault(); event.stopPropagation();
    if (!activeProject || event.target.closest('button')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!(rect.width>0)) return;
    if(event.clientX<rect.left || event.clientX>rect.left+rect.width)return;
    const length=viewBeats || timelineWorkspaceBeats(activeProject);
    const beat = snapBeat(viewStartBeat+(event.clientX-rect.left)/rect.width*length);
    const lane=bpmAutomation(),duplicate=lane.points.findIndex(point=>Math.abs(point.beat-beat)<.000001);
    if(duplicate>=0){selectBpmPoint(null,duplicate);return;}
    const before=bpmSnapshot(),clock=existing.compileTempoMap(activeProject);
    markBpmLaneManual();
    // New manual markers become the project tempo from this beat until the next
    // marker. Keep full precision here; rounding an interpolated BPM changes the entry point.
    const point={beat,value:clock.bpmAtBeat(beat),curve:'hold'};
    lane.points.push(point);lane.points.sort((a,b)=>a.beat-b.beat);
    selectedBpmPoint=lane.points.indexOf(point);bpmEditing=true;
    recordBpmChange(before);renderLanes();
  }

  function editBpmPoint(event,index) {
    event.preventDefault(); event.stopPropagation();
    const point = bpmAutomation().points[index];
    const raw = window.prompt('BPM (20-400)',String(point.value));
    if (raw === null || !raw.trim()) return;
    if (!setBpmPoint(index,point.beat,Number(raw))) {
      if (typeof showToast === 'function') showToast('Enter a BPM between 20 and 400.',true);
    }
  }

  function dragBpmPoint(event,index) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const target = event.currentTarget;
    selectBpmPoint(null,index);
    const before=bpmSnapshot();
    const lane = bpmAutomation();
    markBpmLaneManual();
    const point = lane.points[index];
    const startY = event.clientY, startValue = point.value, startBeat = point.beat;
    const track = target.closest?.('.studio-daw-bpm-points');
    const rect = track?.getBoundingClientRect?.();
    const totalBeats = Number(track?.dataset.totalBeats || viewBeats || timelineWorkspaceBeats(activeProject));
    const viewStart = Number(track?.dataset.viewStart || viewStartBeat || 0);
    let moved = false;
    target.setPointerCapture(event.pointerId);
    target.onpointermove = move => {
      const dx = Math.abs((move.clientX || 0) - event.clientX), dy = Math.abs(startY-move.clientY);
      if (dx<3 && dy<3 && !moved) return;
      moved = true;
      const value = Math.max(20,Math.min(400,startValue+(startY-move.clientY)*(move.shiftKey ? .1 : 1)));
      let beat = startBeat;
      if(rect?.width>0 && Number.isFinite(totalBeats) && totalBeats>0){
        const ratio=Math.max(0,Math.min(1,(move.clientX-rect.left)/rect.width));
        beat=viewStart+ratio*totalBeats;
        beat=move.altKey?Math.round(beat*1000)/1000:snapBeat(beat);
      }
      point.beat=Math.max(0,beat);
      point.value=Math.round(value*100)/100;
      lane.points.sort((a,b)=>a.beat-b.beat);
      selectedBpmPoint=lane.points.indexOf(point);
      target.dataset.bpmIndex=String(selectedBpmPoint);
      target.textContent = String(point.value);
      target.setAttribute('aria-label',`BPM marker ${selectedBpmPoint+1}: ${point.value}`);
      if(rect?.width>0 && Number.isFinite(totalBeats) && totalBeats>0)target.parentElement.style.left = `${Math.max(0,Math.min(100,(point.beat-viewStart)/totalBeats*100))}%`;
      target.parentElement.style.top = `${(400-point.value)/380*100}%`;
    };
    target.onpointerup = target.onpointercancel = end => {
      target.onpointermove = target.onpointerup = target.onpointercancel = null;
      if (moved) {
        if(end.type==='pointercancel') restoreBpmSnapshot(before);
        else recordBpmChange(before);
        renderLanes();
        renderBpmLane();
        document.querySelector(`[data-bpm-index="${selectedBpmPoint}"]`)?.focus();
      } else if (end.type === 'pointerup') {
        editBpmPoint(end,index);
      }
    };
  }

  function toggleBpmLaneSize() {
    bpmLaneSize = bpmLaneSize === 'expanded' ? 'compact' : 'expanded';
    renderTrackStack();
    renderBpmLane();
    return true;
  }

  function receiveCues(path,cues,source) {
    const clean = Array.isArray(cues) ? cues.filter(cue=>Number.isFinite(cue.time_ms) && cue.time_ms>=0).map(cue=>({time_ms:cue.time_ms,label:String(cue.label || 'Cue'),color:/^#[0-9a-f]{6}$/i.test(cue.color) ? cue.color : '#9b9f98'})) : [];
    cueCache.set(path,{cues:clean,source});
    if (activeProject) renderLanes();
  }

  function renderClipCues(clip,visibleStart,visibleEnd) {
    const data = cueCache.get(clip.path);
    if (!data) return '';
    return `<div class="daw-source-cues">${data.cues.map(cue=>{
      const sourceBeat = existing.sourceSecondsToBeat ? existing.sourceSecondsToBeat(clip,cue.time_ms/1000) : cue.time_ms/1000*(clip.bpm||120)/60;
      if(sourceBeat<clip.sourceStartBeat || sourceBeat>=clip.sourceStartBeat+clip.sourceDurationBeats) return '';
      const beat = clip.timelineStartBeat+(sourceBeat-clip.sourceStartBeat)/clip.sourceDurationBeats*clip.timelineDurationBeats;
      if(beat<visibleStart || beat>=visibleEnd) return '';
      return `<span style="left:${(beat-visibleStart)/(visibleEnd-visibleStart)*100}%;--cue-color:${cue.color}" title="${escapeHtml(data.source+' cue: '+cue.label)}"><b>${escapeHtml(cue.label)}</b></span>`;
    }).join('')}</div>`;
  }

  function gridStepBeats() {
    const span = viewBeats || timelineWorkspaceBeats(activeProject);
    const visibleStep = arrangementGridStep(span);
    return span <= 64 ? Math.min(1, visibleStep) : 4;
  }

  function snapBeat(beat, event, clip) {
    if (!snapEnabled || event?.altKey || clip?.snapDisabled) return Math.max(0, beat);
    return Math.max(0, Math.round(beat / gridStepBeats()) * gridStepBeats());
  }

  function toggleSnap() {
    snapEnabled = !snapEnabled;
    renderTrackStack();
  }

  function toggleMixer() {
    const shell = document.getElementById('studio-daw-shell');
    const collapsed = shell.classList.toggle('daw-mixer-collapsed');
    const button = shell.querySelector('.studio-daw-mixer-header button');
    if (button) {
      button.textContent = collapsed ? 'Expand' : 'Collapse';
      button.setAttribute('aria-expanded', String(!collapsed));
      button.setAttribute('aria-label', collapsed ? 'Expand mixer' : 'Collapse mixer');
    }
  }

  function layerCount(sectionId) {
    if(!sectionId.endsWith('deck') && activeSectionId!==sectionId) return 1;
    if(sectionId==='fx') return Math.max(1,activeProject?.fxRegions?.length || 0,
      ...arrangementClips().filter(c=>c.sectionId==='fx').map(c=>(c.layerIndex||0)+1));
    const minimum=sectionId==='samples'?Math.max(1,activeProject?.sampleLayerCount||1):sectionId==='recordings'?Math.max(1,(window.AxiomDawTimelineRecording?.layer??-1)+1):1;
    return arrangementClips().filter(clip => clip.sectionId === sectionId).reduce((count,clip)=>Math.max(count,(clip.layerIndex || 0)+1),minimum);
  }

  function addAudioActionLabel() {
    return ['samples','fx','recordings','instruments'].includes(activeSectionId) ? 'Add Layer' : 'Add Track';
  }

  function beginAdd() {
    if(activeSectionId==='samples'){
      pendingLayer=null;
      return writeParameters([{key:'sampleLayerCount',value:layerCount('samples')+1}]);
    }
    if(activeSectionId==='fx' && window.AxiomDawFx) return window.AxiomDawFx.edit();
    const layered = ['samples', 'fx', 'recordings', 'instruments'].includes(activeSectionId);
    pendingLayer = layered ? { sectionId: activeSectionId, layerIndex: arrangementClips().some(clip => clip.sectionId === activeSectionId) ? layerCount(activeSectionId) : 0, beat: activeProject.editCursorBeat || 0 } : null;
    return openLibrarySearchForAdd();
  }

  function chooseSampleLayer(index,event){
    event?.preventDefault();event?.stopPropagation();
    if(!Number.isInteger(index)||index<0||index>=layerCount('samples'))return false;
    pendingLayer={sectionId:'samples',layerIndex:index,beat:activeProject.editCursorBeat||0};
    return openLibrarySearchForAdd();
  }

  const DAW_SAMPLE_BANK_KEY='axiomDawSampleBank.v1';
  function normalizeDawSampleBankItem(item={}){
    if(!item?.path)return null;
    return {
      path:item.path,
      title:item.title||item.filename||'Sample',
      filename:item.filename||item.title||'',
      durationSec:Number(item.durationSec||item.duration_sec||0)||0,
      addedAt:item.addedAt||new Date().toISOString(),
      lastUsedAt:item.lastUsedAt||'',
      lastPreviewedAt:item.lastPreviewedAt||'',
      useCount:Math.max(0,Number(item.useCount||0)||0),
      previewCount:Math.max(0,Number(item.previewCount||0)||0),
      dawSample:true
    };
  }
  function sampleBankSortValue(item){
    const lastUsed=Date.parse(item.lastUsedAt||'')||0,lastPreviewed=Date.parse(item.lastPreviewedAt||'')||0,added=Date.parse(item.addedAt||'')||0;
    return (lastUsed*4)+(lastPreviewed*2)+(Number(item.useCount||0)*86400000)+(Number(item.previewCount||0)*3600000)+added;
  }
  function sortDawSampleBank(list){
    return list.filter(Boolean).sort((a,b)=>sampleBankSortValue(b)-sampleBankSortValue(a));
  }
  function readDawSampleBank(){
    try{const list=JSON.parse(localStorage.getItem(DAW_SAMPLE_BANK_KEY)||'[]');return sortDawSampleBank(Array.isArray(list)?list.map(normalizeDawSampleBankItem).filter(Boolean).slice(0,200):[]);}catch{return [];}
  }
  function writeDawSampleBank(list){
    try{
      const saved=JSON.stringify(sortDawSampleBank(list).slice(0,200));
      localStorage.setItem(DAW_SAMPLE_BANK_KEY,saved);
      if(localStorage.getItem(DAW_SAMPLE_BANK_KEY)!==saved)throw new Error('Sample bank save could not be verified.');
      return true;
    }catch(error){console.warn('Sample bank could not be saved:',error);return false;}
  }
  function removeDawSample(path){
    const saved=readDawSampleBank(),sample=saved.find(item=>item.path===path);
    if(!sample)return null;
    return writeDawSampleBank(saved.filter(item=>item.path!==path))?sample:null;
  }
  function updateDawSampleBankUsage(path,updates={}){
    const list=readDawSampleBank();
    const index=list.findIndex(item=>item.path===path);
    if(index<0)return null;
    const current=list[index];
    const item={
      ...current,
      ...updates,
      useCount:Math.max(0,Number(updates.useCount ?? current.useCount ?? 0)||0),
      previewCount:Math.max(0,Number(updates.previewCount ?? current.previewCount ?? 0)||0)
    };
    if(updates.useIncrement)item.useCount=Math.max(0,Number(current.useCount||0)+Number(updates.useIncrement||0));
    if(updates.previewIncrement)item.previewCount=Math.max(0,Number(current.previewCount||0)+Number(updates.previewIncrement||0));
    delete item.useIncrement;delete item.previewIncrement;
    list[index]=item;writeDawSampleBank(list);return item;
  }
  function rememberDawSample(track,filename=''){
    if(!track?.path)return null;
    const now=new Date().toISOString();
    const existing=readDawSampleBank().find(item=>item.path===track.path);
    const item=normalizeDawSampleBankItem({
      ...existing,
      path:track.path,
      title:track.title||filename||track.filename||existing?.title||'Sample',
      filename:filename||track.filename||existing?.filename||'',
      durationSec:Number(track.durationSec||track.duration_sec||existing?.durationSec||0)||0,
      addedAt:existing?.addedAt||now,
      dawSample:true
    });
    const list=readDawSampleBank().filter(existing=>existing.path!==item.path);
    list.unshift(item);writeDawSampleBank(list);return item;
  }
  function samplePlacement(project=activeProject){
    return {sectionId:'samples',layerIndex:activeSectionId==='samples'?Math.max(0,layerCount('samples')-1):Math.max(0,project?.sampleLayerCount||1)-1,beat:Number(project?.editCursorBeat||0)};
  }
  function addBankSampleToLayer(track,{batch=false}={}){
    if(!activeProject||!track?.path)return false;
    const now=new Date().toISOString();
    const bankTrack=updateDawSampleBankUsage(track.path,{lastUsedAt:now,useIncrement:1})||rememberDawSample({...track,lastUsedAt:now,useCount:Number(track.useCount||0)+1});
    const project=activeProject,placement=samplePlacement(project);
    project.sampleBank=Array.isArray(project.sampleBank)?project.sampleBank:[];
    if(!project.sampleBank.some(item=>item.path===track.path))project.sampleBank.push({...track,...bankTrack,dawSample:true,addedAt:bankTrack?.addedAt||track.addedAt||now});
    addTrackToProject({...track,...bankTrack,imported:true},{placement,preserveImportDuration:true,nonOverlapping:true,batch});
    const clip=selectedArrangementClip();
    if(clip)project.editCursorBeat=Math.max(placement.beat,Number(clip.timelineStartBeat||0)+Number(clip.timelineDurationBeats||0));
    if(!batch){renderShell('samples');revealStudioDawShell('samples');window.AxiomDawDrafts?.checkpoint();}
    return true;
  }
  async function previewBankSample(sample,button){
    if(!sample?.path)return false;
    updateDawSampleBankUsage(sample.path,{lastPreviewedAt:new Date().toISOString(),previewIncrement:1});
    document.querySelectorAll('#daw-sample-bank-dialog [data-sample-preview]').forEach(item=>item.setAttribute('aria-pressed','false'));
    button?.setAttribute?.('aria-pressed','true');
    if(typeof playAudioFile==='function'){
      await playAudioFile(sample.path,sample.title||sample.filename||'Sample','Sample Bank',0,'','',null,'',{context:'studio-daw-preview'});
      return true;
    }
    showToast?.('AXIOM preview player is still loading.',true);
    return false;
  }
  function openSampleBankDialog(options={}){
    if(!activeProject)return false;
    const existing=document.getElementById('daw-sample-bank-dialog');if(existing)existing.remove();
    const dialog=document.createElement('dialog');dialog.id='daw-sample-bank-dialog';dialog.className='daw-fx-dialog daw-sample-bank-dialog';
    dialog.innerHTML=`<h2>Sample Bank</h2><p>Preview first. Frequently used and recently used sounds stay at the top. Remove only takes a sound out of this bank; its audio file and placed clips stay intact.</p><div class="daw-sample-bank-list"></div><p data-bank-status role="status" aria-live="polite"></p><footer><button type="button" data-undo-remove disabled>Undo Remove</button><button type="button" data-import>Import Files</button><button type="button" data-close>Close</button></footer>`;
    const list=dialog.querySelector('.daw-sample-bank-list');
    const removed=[],undo=dialog.querySelector('[data-undo-remove]'),status=dialog.querySelector('[data-bank-status]');
    function renderBank(){
      const saved=readDawSampleBank();
      list.replaceChildren();
      undo.disabled=!removed.length;
      if(!saved.length){
        const empty=document.createElement('div');
        empty.className='daw-sample-bank-empty';
        empty.innerHTML=`<strong>No samples in your bank yet.</strong><span>Import single FX, drops, drums or one-shots here. They stay DAW-only and never enter AXIOM Library or set building.</span>`;
        list.append(empty);
      }
      saved.forEach((sample,index)=>{
        const row=document.createElement('div');row.className='daw-sample-bank-item';row.dataset.index=String(index);
        const duration=sample.durationSec?` · ${Math.round(sample.durationSec*10)/10}s`:'';
        const uses=Number(sample.useCount||0),previews=Number(sample.previewCount||0);
        row.innerHTML=`<div class="daw-sample-bank-copy"><strong>${escapeHtml(sample.title||sample.filename||'Sample')}</strong><small>${escapeHtml(sample.filename||sample.path)}${duration}</small>${uses||previews?`<em>${uses} use${uses===1?'':'s'}${previews?` · ${previews} preview${previews===1?'':'s'}`:''}</em>`:''}</div><div class="daw-sample-bank-actions"><button type="button" data-sample-preview aria-pressed="false">Preview</button><button type="button" data-sample-use>Use</button><button type="button" data-sample-remove aria-label="Remove ${escapeHtml(sample.title||sample.filename||'Sample')} from Sample Bank">Remove</button></div>`;
        row.querySelector('[data-sample-preview]').onclick=event=>{event.stopPropagation();previewBankSample(sample,event.currentTarget).catch(error=>showToast?.(`Preview failed: ${error.message}`,true));};
        row.querySelector('[data-sample-use]').onclick=()=>{addBankSampleToLayer(sample);dialog.close();dialog.remove();showToast?.('Sample added to the Samples lane.');};
        row.querySelector('[data-sample-remove]').onclick=event=>{
          event.stopPropagation();
          const item=removeDawSample(sample.path);
          if(!item){status.textContent='Could not remove this sound. Please retry.';return;}
          removed.push(item);renderBank();
          status.textContent=`Removed ${item.title} from Sample Bank. Audio file and placed clips kept.`;
          undo.focus();
        };
        row.querySelector('.daw-sample-bank-actions').ondblclick=event=>event.stopPropagation();
        row.ondblclick=()=>{addBankSampleToLayer(sample);dialog.close();dialog.remove();showToast?.('Sample added to the Samples lane.');};
        list.append(row);
      });
    }
    undo.onclick=()=>{
      const item=removed[removed.length-1];if(!item)return;
      const saved=readDawSampleBank();
      if(!saved.some(sample=>sample.path===item.path)){
        if(saved.length>=200){status.textContent='Sample Bank is full. Remove another sound before restoring this one.';return;}
        if(!writeDawSampleBank([...saved,item])){status.textContent='Could not restore this sound. Please retry.';return;}
      }
      removed.pop();renderBank();status.textContent=`Restored ${item.title} to Sample Bank.`;
    };
    renderBank();
    dialog.querySelector('[data-import]').onclick=()=>importSampleFolderToLayer({forcePicker:true});
    dialog.querySelector('[data-close]').onclick=()=>{dialog.close();dialog.remove();};
    dialog.addEventListener('cancel',event=>{event.preventDefault();dialog.close();dialog.remove();});
    document.body.append(dialog);dialog.showModal();
    if(options.focusImport&&!readDawSampleBank().length)setTimeout(()=>dialog.querySelector('[data-import]')?.focus(),0);
    return true;
  }
  function importSampleFolderToLayer(options={}) {
    if(!activeProject)return false;
    if(!options.forcePicker)return openSampleBankDialog({focusImport:true});
    const input=document.createElement('input');
    input.type='file';input.accept='audio/*';input.multiple=true;
    window.AxiomWindowsStudioFormats?.widenPicker?.(input);  // Windows layer: this picker's files are decoded by the server
    input.hidden=true;document.body.append(input);
    input.addEventListener('cancel',()=>input.remove(),{once:true});
    input.onchange=async()=>{
      const files=[...input.files||[]].filter(file=>/\.(mp3|mp4|m4a|wav|aiff?|flac|aac)$/i.test(file.name)||window.AxiomWindowsStudioFormats?.test(file.name));
      input.remove();
      if(!files.length){showToast?.('Choose one or more audio sample files.',true);return;}
      const project=activeProject,limit=Math.min(files.length,48);
      let imported=0,failed=0;
      setAxiomPreviewPlayerContext?.('studio-daw-preview',{reason:'import_sample_bank'});
      for(const file of files.slice(0,limit)){
        if(project!==activeProject){failed++;break;}
        try{
          const form=new FormData();form.append('file',file);
          const response=await fetch('/api/studio-daw/import',{method:'POST',body:form});
          const data=await response.json().catch(()=>({}));
          if(!response.ok||!data.track?.path)throw new Error(data.error||'Sample could not be imported.');
          const item=rememberDawSample(data.track,file.name)||data.track;
          addBankSampleToLayer({...data.track,...item},{batch:true});
          imported++;
        }catch(error){failed++;console.warn('Sample bank import failed:',file.name,error);}
      }
      if(project===activeProject){renderShell('samples');revealStudioDawShell('samples');window.AxiomDawDrafts?.checkpoint();openSampleBankDialog();}
      showToast?.(failed?`Sample Bank added ${imported}; ${failed} could not load.`:`Sample Bank added ${imported} sample${imported===1?'':'s'} to the samples lane.`,Boolean(!imported));
    };
    input.click();return true;
  }

  function prepareDawLibraryAddAnchor() {
    return window.AxiomDawFinder?.begin(activeProject) || null;
  }

  function positionLane(event, sectionId) {
    if (event.target?.closest?.('.studio-daw-clip')) return;
    window.AxiomMixer?.close?.();
    const rect = event.currentTarget.getBoundingClientRect();
    activeProject.editCursorBeat = snapBeat(viewStartBeat + Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * (viewBeats || timelineWorkspaceBeats(activeProject)), event);
    window.AxiomArrangement?.seekBeat(activeProject,activeProject.editCursorBeat);
    selectSection(sectionId);
    targetLayerIndex = Math.max(0,Math.min(layerCount(sectionId)-1,Math.floor((event.clientY-rect.top)/rect.height*layerCount(sectionId)))) || 0;
  }

  function dragClip(event, id) {
    if(event.target?.closest?.('.daw-trim-handle')) {event.preventDefault();return;}
    const clip = clipByReference(id);
    if (!clip) return;
    const bundle=shouldTreatSelectionAsProjectBlock()?selectedTimelineBundle({forceProject:true}):null;
    const pointerBeat=clip.timelineStartBeat+clipPointerRatio(event)*clip.timelineDurationBeats;
    event.dataTransfer.setData('application/x-axiom-clip', JSON.stringify({ id, offset: bundle?pointerBeat-bundle.originBeat:clipPointerRatio(event) * clip.timelineDurationBeats, projectBlock:Boolean(bundle), copy: Boolean(event.altKey) }));
    event.dataTransfer.effectAllowed = 'copyMove';
    event.stopPropagation();
  }

  let clipDragScrollTimer = null;
  let clipDragScrollDirection = 0;
  let clipDragScrollSeen = 0;

  function stopClipDragScroll() {
    clipDragScrollDirection = 0;
    if (clipDragScrollTimer) {
      clearInterval(clipDragScrollTimer);
      clipDragScrollTimer = null;
    }
    document.querySelector('.studio-daw-timeline')?.classList.remove('is-drag-autoscrolling');
  }

  function refreshDragViewport() {
    if (!activeProject || !viewBeats) return;
    const maxStart = Math.max(0, timelineWorkspaceBeats(activeProject) - viewBeats);
    viewStartBeat = Math.max(0, Math.min(maxStart, viewStartBeat));
    renderRuler();
    renderLanes();
  }

  function startClipDragScroll(direction) {
    if (!viewBeats || !direction) {
      stopClipDragScroll();
      return;
    }
    clipDragScrollDirection = direction < 0 ? -1 : 1;
    clipDragScrollSeen = Date.now();
    const project = activeProject;
    document.querySelector('.studio-daw-timeline')?.classList.add('is-drag-autoscrolling');
    if (clipDragScrollTimer) return;
    clipDragScrollTimer = setInterval(() => {
      // Finder drags may never deliver dragend to this document. Require
      // continuing dragover evidence instead of retaining an unbounded timer.
      if (!activeProject || activeProject !== project || !viewBeats || !clipDragScrollDirection ||
          document.hidden || Date.now() - clipDragScrollSeen > 750) {
        stopClipDragScroll();
        return;
      }
      const maxStart = Math.max(0, timelineWorkspaceBeats(activeProject) - viewBeats);
      const step = viewBeats * 0.08;
      const next = Math.max(0, Math.min(maxStart, viewStartBeat + clipDragScrollDirection * step));
      if (Math.abs(next - viewStartBeat) < 1e-9) { stopClipDragScroll(); return; }
      viewStartBeat = next;
      refreshDragViewport();
    }, 90);
  }

  function selectedFxIds() {
    return new Set(window.AxiomDawFx?.selectedIdsForProject?.()||[]);
  }
  function selectedAudioClips() {
    return arrangementClips().filter(clip=>mixerSelection.has(clip.id));
  }
  function projectBlockSelectionActive() {
    return Boolean(activeProject&&projectBlockSelection===activeProject&&arrangementClips().length&&selectedAudioClips().length===arrangementClips().length);
  }
  function shouldTreatSelectionAsProjectBlock() {
    // Only Select All opts into moving project markers and tempo with the audio.
    return projectBlockSelectionActive();
  }
  function selectedTimelineBundle({forceProject=false,cut=false}={}) {
    if(!activeProject)return null;
    const allProject=forceProject||shouldTreatSelectionAsProjectBlock();
    const clips=allProject?arrangementClips():selectedAudioClips();
    const fxIds=allProject?new Set((activeProject.fxRegions||[]).map(fx=>fx.id)):selectedFxIds();
    const fxRegions=(activeProject.fxRegions||[]).filter(fx=>fxIds.has(fx.id));
    const patternClips=allProject?JSON.parse(JSON.stringify(activeProject.patternClips||[])):[];
    if(!clips.length&&!fxRegions.length&&!patternClips.length)return null;
    const starts=[];
    clips.forEach(clip=>starts.push(Number(clip.timelineStartBeat||0)));
    fxRegions.filter(fx=>fx.coverage!=='project').forEach(fx=>starts.push(Number(fx.startBeat||0)));
    patternClips.forEach(clip=>starts.push(Number(clip.startBeat||0)));
    if(allProject){
      (activeProject.markers||[]).forEach(marker=>starts.push(Number(marker.beat||0)));
      (activeProject.tempoSegments||[]).forEach(segment=>starts.push(Number(segment.startBeat||0)));
    }
    const finiteStarts=starts.filter(Number.isFinite);
    const originBeat=finiteStarts.length?Math.max(0,Math.min(...finiteStarts)):0;
    const clipIds=new Set(clips.map(clip=>clip.id));
    const automation=(activeProject.automationLanes||[]).filter(lane=>{
      if(lane.scope==='clip')return clipIds.has(lane.targetId);
      if(lane.scope==='fx')return fxIds.has(lane.targetId);
      return allProject&&['project','deck'].includes(lane.scope);
    });
    return {
      kind:'timeline-bundle',project:activeProject,cut,allProject,originBeat,
      clips:JSON.parse(JSON.stringify(clips)),
      fxRegions:JSON.parse(JSON.stringify(fxRegions)),
      patternClips,
      markers:allProject?JSON.parse(JSON.stringify(activeProject.markers||[])):[],
      tempoSegments:allProject?JSON.parse(JSON.stringify(activeProject.tempoSegments||[])):[],
      automation:JSON.parse(JSON.stringify(automation))
    };
  }
  function cloneTimelineBundle(bundle,startBeat,{preserveIds=false}={}) {
    const delta=Math.max(-Number(bundle.originBeat||0),Number(startBeat||0)-Number(bundle.originBeat||0));
    const clipMap=new Map(),fxMap=new Map();
    const clips=(bundle.clips||[]).map(source=>{const id=preserveIds?source.id:clipId('paste');clipMap.set(source.id,id);return {...source,id,timelineStartBeat:Math.max(0,Number(source.timelineStartBeat||0)+delta)};});
    const fxRegions=(bundle.fxRegions||[]).map(source=>{const id=preserveIds?source.id:clipId('fx');fxMap.set(source.id,id);return {...source,id,startBeat:source.coverage==='project'?0:Math.max(0,Number(source.startBeat||0)+delta)};});
    const patternClips=(bundle.patternClips||[]).map(source=>({...source,id:preserveIds?source.id:clipId('pattern'),startBeat:Math.max(0,Number(source.startBeat||0)+delta)}));
    const markers=(bundle.markers||[]).map(marker=>({...marker,beat:Math.max(0,Number(marker.beat||0)+delta)}));
    const tempoSegments=(bundle.tempoSegments||[]).map(segment=>({...segment,startBeat:Math.max(0,Number(segment.startBeat||0)+delta)}));
    const automation=(bundle.automation||[]).map(lane=>{
      const next=JSON.parse(JSON.stringify(lane));
      if(next.scope==='clip')next.targetId=clipMap.get(next.targetId)||next.targetId;
      else if(next.scope==='fx')next.targetId=fxMap.get(next.targetId)||next.targetId;
      else if(['project','deck'].includes(next.scope))next.points=(next.points||[]).map(point=>({...point,beat:Math.max(0,Number(point.beat||0)+delta)}));
      return next;
    });
    return {clips,fxRegions,patternClips,markers,tempoSegments,automation,delta};
  }
  function removeTimelineBundleSelection(bundle) {
    if(!activeProject||!bundle)return false;
    const clipIds=new Set((bundle.clips||[]).map(clip=>clip.id)),fxIds=new Set((bundle.fxRegions||[]).map(fx=>fx.id)),patternIds=new Set((bundle.patternClips||[]).map(clip=>clip.id));
    activeProject.arrangementClips=arrangementClips().filter(clip=>!clipIds.has(clip.id));
    activeProject.fxRegions=(activeProject.fxRegions||[]).filter(fx=>!fxIds.has(fx.id));
    activeProject.patternClips=(activeProject.patternClips||[]).filter(clip=>!patternIds.has(clip.id));
    activeProject.automationLanes=(activeProject.automationLanes||[]).filter(lane=>{
      if(lane.scope==='clip')return !clipIds.has(lane.targetId);
      if(lane.scope==='fx')return !fxIds.has(lane.targetId);
      return !(bundle.allProject&&['project','deck'].includes(lane.scope));
    });
    if(bundle.allProject){activeProject.markers=[];activeProject.tempoSegments=[];}
    return true;
  }
  function pasteTimelineBundle(bundle,startBeat) {
    if(!activeProject||!bundle||bundle.project!==activeProject)return false;
    window.AxiomMixerHistory?.finish();window.AxiomArrangement?.stop(false);window.AxiomStems?.stop();stopParameterPlayback();
    const before=timelineSnapshot(),beforeSelection=clipSelectionSnapshot();
    const cloned=cloneTimelineBundle(bundle,snapBeat(Math.max(0,Number(startBeat||0))),{preserveIds:Boolean(bundle.cut)});
    activeProject.arrangementClips.push(...cloned.clips);
    activeProject.fxRegions=[...(activeProject.fxRegions||[]),...cloned.fxRegions];
    activeProject.patternClips=[...(activeProject.patternClips||[]),...cloned.patternClips];
    activeProject.automationLanes=[...(activeProject.automationLanes||[]),...cloned.automation];
    if(bundle.allProject){
      activeProject.markers=[...(activeProject.markers||[]),...cloned.markers];
      activeProject.tempoSegments=[...(activeProject.tempoSegments||[]),...cloned.tempoSegments].sort((a,b)=>Number(a.startBeat||0)-Number(b.startBeat||0));
    }
    clearRange();window.AxiomDawFx?.clearSelection?.();mixerSelection.clear();cloned.clips.forEach(clip=>mixerSelection.add(clip.id));
    selectedClipId=cloned.clips[0]?.id||'';selectedClipPointerRatio=0;clipEditorOpen=false;activeSectionId=cloned.clips[0]?.sectionId||activeSectionId;
    activeProject.editCursorBeat=Math.max(0,Number(bundle.originBeat||0)+cloned.delta);
    if(bundle.cut)arrangementClipboard=null;
    projectBlockSelection=bundle.allProject?activeProject:null;
    recordTimelineEdit(before,beforeSelection);renderShell('set');
    showToast?.(`${cloned.clips.length} clip${cloned.clips.length===1?'':'s'} pasted${cloned.fxRegions.length?` with ${cloned.fxRegions.length} FX region${cloned.fxRegions.length===1?'':'s'}`:''}.`);
    return true;
  }
  function moveSelectedProjectBlock(anchorClip,delta) {
    if(!activeProject||!anchorClip||!shouldTreatSelectionAsProjectBlock()||!Number.isFinite(delta))return false;
    const bundle=selectedTimelineBundle({forceProject:true});
    if(!bundle)return false;
    const before=timelineSnapshot(),beforeSelection=clipSelectionSnapshot();
    const moved=cloneTimelineBundle(bundle,Number(bundle.originBeat||0)+delta,{preserveIds:true});
    removeTimelineBundleSelection(bundle);
    activeProject.arrangementClips.push(...moved.clips);
    activeProject.fxRegions=[...(activeProject.fxRegions||[]),...moved.fxRegions];
    activeProject.patternClips=[...(activeProject.patternClips||[]),...moved.patternClips];
    activeProject.automationLanes=[...(activeProject.automationLanes||[]),...moved.automation];
    activeProject.markers=[...(activeProject.markers||[]),...moved.markers];
    activeProject.tempoSegments=[...(activeProject.tempoSegments||[]),...moved.tempoSegments].sort((a,b)=>Number(a.startBeat||0)-Number(b.startBeat||0));
    mixerSelection.clear();moved.clips.forEach(clip=>mixerSelection.add(clip.id));
    selectedClipId=anchorClip.id;selectedClipPointerRatio=0;clipEditorOpen=false;projectBlockSelection=activeProject;
    activeProject.editCursorBeat=Math.max(0,Number(anchorClip.timelineStartBeat||0)+delta);
    recordTimelineEdit(before,beforeSelection);renderShell('set');return true;
  }

  function dragOverLane(event) {
    event.preventDefault();
    const types=Array.from(event.dataTransfer?.types||[]);
    if(types.includes('Files')) event.dataTransfer.dropEffect='copy';
    else if(types.includes('application/x-axiom-clip')&&event.dataTransfer?.getData?.('application/x-axiom-clip')?.includes('"copy":true'))event.dataTransfer.dropEffect='copy';
    if (!viewBeats) return;
    const rect = event.currentTarget?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0) return;
    const edge = Math.min(96, Math.max(52, rect.width * 0.16));
    const direction = event.clientX >= rect.right - edge ? 1 : event.clientX <= rect.left + edge ? -1 : 0;
    if (direction) startClipDragScroll(direction);
    else stopClipDragScroll();
  }

  function stemSourceCoverage(clip) {
    const start=existing.sourceBeatToSeconds(clip,clip.sourceStartBeat);
    const end=existing.sourceBeatToSeconds(clip,clip.sourceStartBeat+clip.sourceDurationBeats);
    return Number.isFinite(start)&&Number.isFinite(end)?{start:Math.min(start,end),end:Math.max(start,end)}:null;
  }

  function stemRefreshCoverage(clip) {
    if(!clip?.stemJob)return stemSourceCoverage(clip);
    const ranges=arrangementClips().filter(item=>item.path===clip.path&&item.stemJob===clip.stemJob).map(stemSourceCoverage).filter(Boolean);
    if(!ranges.length)return stemSourceCoverage(clip);
    return {start:Math.min(...ranges.map(range=>range.start)),end:Math.max(...ranges.map(range=>range.end))};
  }

  function queueStemRefresh(clip) {
    if(!clip?.stemJob)return false;
    const coverage=stemRefreshCoverage(clip);
    for(const item of arrangementClips().filter(candidate=>candidate.path===clip.path&&candidate.stemJob===clip.stemJob)){
      item.stemAutoRefreshQueued=true;
      if(coverage)item.stemAutoRefreshCoverage=coverage;
    }
    if(clip.stemState==='processing')return false;
    window.AxiomStems?.request(clip,{autoRefresh:true,restoreJob:clip.stemJob,coverage});
    return true;
  }

  function trimClip(id,edge,timelineBeat,render=true) {
    const clip=clipByReference(id);
    if(!clip || !['left','right'].includes(edge) || !Number.isFinite(timelineBeat)) return false;
    const before=render?rangeSnapshot():null,beforeSelection=clipSelectionSnapshot();
    const stemCoverage=clip.stemCoverage||(clip.stemState==='ready'?{start:existing.sourceBeatToSeconds(clip,clip.stemSourceStart??clip.sourceStartBeat),end:existing.sourceBeatToSeconds(clip,clip.sourceStartBeat+clip.sourceDurationBeats)}:null);
    const source=projectTracks().find(track=>track.path===clip.path) || clip;
    const duration=durationSecondsFromTrack(clip) || durationSecondsFromTrack(source);
    const timeToBeat=seconds=>existing.sourceSecondsToBeat ? existing.sourceSecondsToBeat(clip,seconds) : seconds*(clip.bpm||120)/60;
    const minimum=timeToBeat(0),maximum=duration>0?timeToBeat(duration):clip.sourceStartBeat+clip.sourceDurationBeats;
    const ratio=clip.sourceDurationBeats/clip.timelineDurationBeats;
    if(!Number.isFinite(ratio) || ratio<=0) return false;
    const end=clip.timelineStartBeat+clip.timelineDurationBeats;
    const minLength=Math.min(clip.timelineDurationBeats,1/960);
    let changed=false;
    if(edge==='left') {
      const earliest=Math.max(0,clip.timelineStartBeat+(clip.reversed?clip.sourceStartBeat+clip.sourceDurationBeats-maximum:minimum-clip.sourceStartBeat)/ratio);
      const position=Math.max(earliest,Math.min(end-minLength,timelineBeat));
      const delta=position-clip.timelineStartBeat;
      if(Math.abs(delta)<1e-9) return false;
      if(!clip.reversed)clip.sourceStartBeat+=delta*ratio;
      clip.sourceDurationBeats-=delta*ratio;
      clip.timelineStartBeat=position;clip.timelineDurationBeats=end-position;changed=true;
    } else {
      const latest=clip.reversed?end+(clip.sourceStartBeat-minimum)/ratio:clip.timelineStartBeat+(maximum-clip.sourceStartBeat)/ratio;
      const position=Math.min(latest,Math.max(clip.timelineStartBeat+minLength,timelineBeat));
      if(Math.abs(position-end)<1e-9) return false;
      if(clip.reversed)clip.sourceStartBeat-=(position-end)*ratio;
      clip.timelineDurationBeats=position-clip.timelineStartBeat;clip.sourceDurationBeats=clip.timelineDurationBeats*ratio;changed=true;
    }
    if(changed){clip.sourceIntent = 'trimmed';if(stemCoverage)clip.stemCoverage=stemCoverage;}
    let needsStemRefresh=false;
    if(changed && clip.stemJob && ['ready','stale','processing'].includes(clip.stemState)) {
      const range=clip.stemCoverage;
      const covered=range&&existing.sourceBeatToSeconds(clip,clip.sourceStartBeat)>=range.start-1e-6&&existing.sourceBeatToSeconds(clip,clip.sourceStartBeat+clip.sourceDurationBeats)<=range.end+1e-6;
      if(covered){
        if(clip.stemState!=='processing')clip.stemState='ready';
      }else{
        if(clip.stemState!=='processing')clip.stemState='stale';
        needsStemRefresh=true;
      }
      if(!covered&&clip.stemPlaybackMode!=='original'){
        clip.stemPlaybackBeforeRefresh=clip.stemPlaybackMode||'stems';
        clip.stemPlaybackMode='original';
      }else if(covered&&clip.stemPlaybackBeforeRefresh){
        clip.stemPlaybackMode=clip.stemPlaybackBeforeRefresh;
        delete clip.stemPlaybackBeforeRefresh;
      }
    }
    if(render){window.AxiomArrangement?.stop(false);window.AxiomStems?.stop();recordClipEdit(before,beforeSelection);renderShell('set');}
    if(render&&changed&&needsStemRefresh){
      showToast?.(clip.stemState==='processing'?'Stem refresh queued for the latest extended range. Original audio plays until it is ready.':'Refreshing stems for the extended clip. Original audio plays until the new range is ready.');
      queueStemRefresh(clip);
    }
    return changed;
  }

  async function alignClipStart(){
    const p=activeProject,id=selectedArrangementClip()?.id;
    if(!id)return false;
    try{
      if(window.AxiomSourceBounds?.prepare)await window.AxiomSourceBounds.prepare(p,()=>activeProject===p,{clipIds:[id]});
      if(activeProject!==p)return false;
      const clip=clipByReference(id);if(!clip)return false;
      const aligned=window.AxiomSourceBounds?.alignedStart(clip,clip.audioStartSeconds)||{};
      const values={...aligned,timelineStartBeat:Math.max(0,Math.round(clip.timelineStartBeat/4)*4),alignAudioStart:false,sourceIntent:'trimmed'};
      const changed=writeParameters(Object.entries(values).map(([key,value])=>({id,key,value})));
      if(changed)showToast?.(`Audio start aligned to bar ${values.timelineStartBeat/4+1}. Undo restores its previous position.`);
      return changed;
    }catch(error){showToast?.(error.message,true);return false;}
  }

  function dragTrim(event,id,edge) {
    if(event.button!==0) return;
    event.preventDefault();event.stopPropagation();
    const clip=clipByReference(id),target=event.currentTarget;
    const article=target.closest('.studio-daw-clip'),lane=article?.parentElement;
    if(!clip || !lane) return;
    window.AxiomArrangement?.stop(false);window.AxiomStems?.stop();
    const before={...clip},beforeSnapshot=rangeSnapshot(),beforeSelection=clipSelectionSnapshot(),p=activeProject,rect=lane.getBoundingClientRect(),span=viewBeats || timelineWorkspaceBeats();
    const original=edge==='left'?clip.timelineStartBeat:clip.timelineStartBeat+clip.timelineDurationBeats;
    const x=event.clientX;let moved=false;
    target.setPointerCapture(event.pointerId);
    target.onpointermove=move=>{
      if(activeProject!==p||clipByReference(id)!==clip)return;
      if(Math.abs(move.clientX-x)<3 && !moved) return;
      moved=true;Object.assign(clip,before);
      trimClip(id,edge,snapBeat(original+(move.clientX-x)/rect.width*span,move,clip),false);
      const left=Math.max(viewStartBeat,clip.timelineStartBeat),right=Math.min(viewStartBeat+span,clip.timelineStartBeat+clip.timelineDurationBeats);
      article.style.left=(left-viewStartBeat)/span*100+'%';article.style.width=(right-left)/span*100+'%';
    };
    target.onpointerup=target.onpointercancel=endEvent=>{
      target.onpointermove=target.onpointerup=target.onpointercancel=null;
      if(activeProject!==p||clipByReference(id)!==clip)return;
      if(endEvent.type==='pointercancel') Object.assign(clip,before);
      else {
        // Narrow clips can be entirely covered by their trim handles. A handle
        // click must select the same clip that Delete and the mixer operate on.
        selectClip(id,{render:false,pointerRatio:edge==='left'?0:1});
        focusZoom('arrange');
        if(moved)recordClipEdit(beforeSnapshot,beforeSelection);
      }
      if(moved && edge==='left' && Math.abs(clip.sourceStartBeat-before.sourceStartBeat)<1e-9 && typeof showToast==='function') showToast('This edge is already at the available source or project start. Move the clip later if it needs room before bar 1.');
      renderShell('set');
      if(endEvent.type!=='pointercancel')document.querySelector(`[data-daw-clip-id="${id}"]`)?.focus({preventScroll:true});
      if(endEvent.type!=='pointercancel'&&(clip.stemState==='stale'||clip.stemAutoRefreshQueued)){
        showToast?.(clip.stemState==='processing'?'Stem refresh queued for the latest extended range. Original audio plays until it is ready.':'Refreshing stems for the extended clip. Original audio plays until the new range is ready.');
        queueStemRefresh(clip);
      }
    };
  }

  function trimKey(event,id,edge) {
    if(!['ArrowLeft','ArrowRight'].includes(event.key)) return;
    event.preventDefault();event.stopPropagation();
    const clip=clipByReference(id);if(!clip) return;
    window.AxiomArrangement?.stop(false);
    const position=edge==='left'?clip.timelineStartBeat:clip.timelineStartBeat+clip.timelineDurationBeats;
    trimClip(id,edge,position+(event.key==='ArrowLeft'?-1:1)*gridStepBeats());
  }

  function dropClip(event, sectionId) {
    stopClipDragScroll();
    event.preventDefault();
    let payload;
    try { payload = JSON.parse(event.dataTransfer.getData('application/x-axiom-clip')); } catch (_) { return; }
    const clip = clipByReference(payload.id);
    if (!clip || !arrangementSections.some(s=>s.id===sectionId)||!Number.isFinite(Number(payload.offset||0))) return;
    if(sectionId==='instruments'&&window.AxiomDrumExtract){event.stopPropagation();window.AxiomDrumExtract.open(clip.id);return;}
    const rect = event.currentTarget.getBoundingClientRect();
    if(rect.width<=0||rect.height<=0||![event.clientX,event.clientY].every(Number.isFinite))return;
    const group=mixerSelection.has(clip.id)?arrangementClips().filter(c=>mixerSelection.has(c.id)):[clip];
    const copying=Boolean(payload.copy);
    const sameSection=group.every(c=>c.sectionId===clip.sectionId);
    if(!sameSection&&sectionId!==clip.sectionId){showToast('Move a multi-section selection within its existing sections.',true);return;}
    const before=rangeSnapshot(),beforeSelection=clipSelectionSnapshot();
    const beat = viewStartBeat + (event.clientX - rect.left) / rect.width * (viewBeats || timelineWorkspaceBeats(activeProject));
    const projectBundle=payload.projectBlock&&shouldTreatSelectionAsProjectBlock()?selectedTimelineBundle({forceProject:true}):null;
    const origin=projectBundle?projectBundle.originBeat:clip.timelineStartBeat;
    const delta=Math.max(-(projectBundle?origin:Math.min(...group.map(c=>c.timelineStartBeat))),snapBeat(beat-Number(payload.offset||0),event,clip)-origin);
    if(projectBundle&&!copying){
      if(moveSelectedProjectBlock(clip,delta))return;
    }
    if(payload.projectBlock&&copying){
      const bundle=selectedTimelineBundle({forceProject:true});
      if(bundle){arrangementClipboard={...bundle,cut:false};if(pasteTimelineBundle(arrangementClipboard,snapBeat(beat-Number(payload.offset||0),event,clip)))return;}
    }
    const layers=layerCount(sectionId),lowest=Math.min(...group.map(c=>c.layerIndex||0)),highest=Math.max(...group.map(c=>c.layerIndex||0));
    if(sameSection&&highest-lowest>=layers){showToast('The destination needs enough layers for this selection.',true);return;}
    const targetLayer=Math.min(layers-1,Math.max(0,Math.floor((event.clientY-rect.top)/(rect.height/layers))));
    const layerDelta=sameSection?Math.max(-lowest,Math.min(layers-1-highest,targetLayer-(clip.layerIndex||0))):0;
    if(!copying&&Math.abs(delta)<1e-9&&layerDelta===0&&sectionId===clip.sectionId)return;
    window.AxiomArrangement?.stop(false);window.AxiomStems?.stop();
    if(copying){
      const originals=new Map(group.map(item=>[item.id,item])),copies=JSON.parse(JSON.stringify(group)).map(item=>({...item,id:clipId('drag-copy'),
        timelineStartBeat:item.timelineStartBeat+delta,sectionId:sameSection?sectionId:item.sectionId,
        layerIndex:sameSection?(item.layerIndex||0)+layerDelta:item.layerIndex||0,copiedFromClipId:item.id}));
      copies.forEach(item=>{if(['left-deck','right-deck'].includes(item.sectionId))item.mixtapeHandoffBeat=Number(item.timelineStartBeat||0);});
      activeProject.arrangementClips.push(...copies);
      if(activeProject.mode==='mixtape'&&shouldRegenerateMixtapeBpm(activeProject))syncMixtapeBpmAutomation(activeProject,true);
      mixerSelection.clear();copies.forEach(item=>mixerSelection.add(item.id));
      selectedClipId=copies.find(item=>item.copiedFromClipId===clip.id)?.id||copies[0].id;selectedClipPointerRatio=0;clipEditorOpen=false;
      activeProject.editCursorBeat=copies.find(item=>item.id===selectedClipId)?.timelineStartBeat||copies[0].timelineStartBeat;
      recordClipEdit(before,beforeSelection,Object.fromEntries(copies.map(item=>[item.id,{clip:originals.get(item.copiedFromClipId)}])));
      renderShell('set');return;
    }
    for(const item of group){
      item.timelineStartBeat+=delta;
      if(sameSection){item.layerIndex=(item.layerIndex||0)+layerDelta;item.sectionId=sectionId;}
    }
    if(activeProject.mode==='mixtape'&&shouldRegenerateMixtapeBpm(activeProject))syncMixtapeBpmAutomation(activeProject,true);
    activeProject.editCursorBeat = clip.timelineStartBeat;
    selectClip(clip.id, { pointerRatio: 0,preserveSelection:group.length>1 });
    recordClipEdit(before,beforeSelection);
    renderLanes();
  }

  function freeAudioPosition(sectionId,layerIndex,beat,duration){
    let start=Math.max(0,beat);
    const occupied=arrangementClips().filter(c=>c.sectionId===sectionId&&(c.layerIndex||0)===layerIndex)
      .slice().sort((a,b)=>a.timelineStartBeat-b.timelineStartBeat);
    for(const clip of occupied){
      const end=clip.timelineStartBeat+clip.timelineDurationBeats;
      if(start<end && start+duration>clip.timelineStartBeat)start=end;
    }
    return start;
  }

  let importQueue=Promise.resolve();
  function dropAudioFiles(event){
    const files=Array.from(event.dataTransfer?.files||[]);
    if(!files.length) for(const item of Array.from(event.dataTransfer?.items||[])) {
      const file=item.kind==='file'?item.getAsFile?.():null;if(file)files.push(file);
    }
    if(!activeProject||!files.length)return;
    event.preventDefault();event.stopImmediatePropagation?.();event.stopPropagation();
    const project=activeProject,lane=event.target?.closest?.('[data-daw-section]');
    const sectionId=lane?.dataset.dawSection || (['left-deck','right-deck','samples','fx','recordings'].includes(activeSectionId)?activeSectionId:'left-deck');
    if(!['left-deck','right-deck','samples','fx','recordings'].includes(sectionId)){
      showToast('Drop audio onto a deck, Samples, FX or Recordings lane.',true);return;
    }
    const rect=lane?.getBoundingClientRect();
    const layerIndex=rect?Math.max(0,Math.min(layerCount(sectionId)-1,Math.floor((event.clientY-rect.top)/rect.height*layerCount(sectionId)))):0;
    const hit=event.target?.closest?.('[data-daw-clip-id]');
    const clip=hit?clipByReference(hit.dataset.dawClipId):null;
    if(clip?.renderedFx?.signal==='generated-sweep'){
      if(files.length!==1){showToast('Drop one replacement sweep onto the clip.',true);return;}
      importQueue=importQueue.then(()=>{
        if(project!==activeProject||clipByReference(clip.id)!==clip)return;
        return window.AxiomDawSweepAudio.replace(project,clip,files[0],message=>showToast(message));
      }).catch(error=>showToast(error.message,true));return importQueue;
    }
    let beat=clip?clip.timelineStartBeat+clip.timelineDurationBeats:rect?snapBeat(viewStartBeat+Math.max(0,(event.clientX-rect.left)/rect.width)*(viewBeats||timelineWorkspaceBeats(project)),event):null;
    importQueue=importQueue.then(async()=>{
      for(const file of files){
        if(project!==activeProject)return;
        if(file.size>96*1024*1024||!(/\.(mp3|mp4|m4a|wav|aiff?|flac|aac)$/i.test(file.name)||window.AxiomWindowsStudioFormats?.test(file.name))){
          showToast(`Not imported: ${file.name}. Use a supported audio file up to 96 MB.`,true);continue;
        }
        showToast(`Importing ${file.name}`);
        try{
          const body=new FormData();body.append('file',file);
          if(sectionId.endsWith('deck'))body.append('analyze','1');
          const response=await fetch('/api/studio-daw/import',{method:'POST',body});
          const data=await response.json();
          if(!response.ok)throw new Error(data.error||'Audio import failed.');
          if(project!==activeProject)return;
          if(!data.track?.bpm) data.track.bpm=existing.compileTempoMap(project).bpmAtBeat(Math.max(0,beat||0));
          addTrackToProject(data.track,{placement:{sectionId,layerIndex,beat},nonOverlapping:true,preserveImportDuration:true});
          const added=arrangementClips().find(c=>c.id===selectedClipId);
          if(added)beat=added.timelineStartBeat+added.timelineDurationBeats;
        }catch(error){showToast(`${file.name}: ${error.message}`,true);}
      }
    }).catch(error=>showToast(error.message,true));
    return importQueue;
  }

  const importAnalysisPolls=new WeakMap();
  function resumeImportAnalyses(project=activeProject){
    if(!project)return;
    let pending=importAnalysisPolls.get(project);
    if(!pending){pending=new Set();importAnalysisPolls.set(project,pending);}
    for(const track of project.sourceTracks||[]){
      const job=track.importAnalysis;
      if(!job || !['queued','running'].includes(job.state) || pending.has(job.id))continue;
      pending.add(job.id);
      const poll=async()=>{
        if(project!==activeProject){pending.delete(job.id);return;}
        if(!(project.arrangementClips||[]).some(c=>c.path===track.path)){pending.delete(job.id);return;}
        try{
          const response=await fetch(`/api/studio-daw/import/status/${encodeURIComponent(job.id)}`);
          const result=await response.json();
          if(!response.ok)throw new Error(result.error||'Project analysis unavailable.');
          if(project!==activeProject){pending.delete(job.id);return;}
          if(['queued','running'].includes(result.state)||window.AxiomArrangement?.playing||window.AxiomArrangement?.loading){setTimeout(poll,1500);return;}
          applyImportAnalysis(project,track.path,result);
        }catch(error){
          if(project===activeProject)applyImportAnalysis(project,track.path,{state:'needs_review',message:error.message});
        }
        pending.delete(job.id);
      };
      setTimeout(poll,500);
    }
  }

  function applyImportAnalysis(project,path,result){
    if(project!==activeProject)return false;
    const metadata=result.track||{};
    if(metadata.path && metadata.path!==path)return false;
    const clips=(project.arrangementClips||[]).filter(c=>c.path===path);
    const source=project.sourceTracks?.find(t=>t.path===path);
    if(!source||!clips.length)return false;
    const bpm=Number(metadata.bpm),key=String(metadata.camelot||'');
    const validBpm=Number.isFinite(bpm)&&bpm>=20&&bpm<=300;
    const validKey=/^(?:[1-9]|1[0-2])[AB]$/.test(key)&&!metadata.key_estimated;
    const updates=[];
    for(const clip of clips){
      if(validBpm&&!clip.bpmCorrection&&clip.bpm===source.bpm){
        const factor=clip.beatgrid?1:bpm/clip.bpm;
        // Analysis must not move, shorten or speed up a clip already placed.
        updates.push({id:clip.id,key:'bpm',value:bpm},
          {id:clip.id,key:'sourceStartBeat',value:clip.sourceStartBeat*factor},
          {id:clip.id,key:'sourceDurationBeats',value:clip.sourceDurationBeats*factor});
      }
      if(validKey&&(!clip.camelot||clip.camelot===source.camelot))updates.push({id:clip.id,key:'camelot',value:key});
      updates.push({id:clip.id,key:'importAnalysis',value:{...clip.importAnalysis,state:result.state,message:result.message,bpmAvailable:validBpm}});
    }
    const next={...source,importAnalysis:{...source.importAnalysis,state:result.state,message:result.message,bpmAvailable:validBpm}};
    if(validBpm)next.bpm=bpm;
    if(validKey)next.camelot=key;
    for(const field of ['artist','genre','year','era'])if(metadata[field])next[field]=metadata[field];
    updates.push({key:'sourceTracks',value:project.sourceTracks.map(t=>t.path===path?next:t)});
    writeParameters(updates);
    return true;
  }

  const DJ_INTRO_DEFAULT_BARS = 8;
  function djIntroBars(track) {
    const value = Number(track?.dj_intro_bars ?? track?.intro_bars);
    return value === 16 ? 16 : DJ_INTRO_DEFAULT_BARS;
  }
  function defaultMarkersForTrack(track, introBars = djIntroBars(track)) {
    const startBeat = Math.max(4, introBars * 4);
    // Keep automatic DJ markers intentionally minimal. AXIOM places the intro
    // and start/hype marker; DJs can add deeper song-section notes by hand
    // when that structure is useful for the set.
    return [
      { beat: 0, label: 'Intro', role: 'intro', kind: 'dj_intro', bars: introBars },
      { beat: startBeat, label: 'Start / Hype', role: 'start_hype', kind: 'dj_intro', bars: introBars },
    ];
  }

  const arrangementSections = [
    { id: 'left-deck', label: 'Left Deck', hint: 'Main edit source' },
    { id: 'right-deck', label: 'Right Deck', hint: 'Transition deck' },
    { id: 'samples', label: 'Samples', hint: 'One shots & loops' },
    { id: 'fx', label: 'FX', hint: 'Throws & sweeps' },
    { id: 'recordings', label: 'Recordings', hint: 'Scratches & vox' },
    { id: 'instruments', label: 'Drums / Instruments', hint: 'Patterns and parts' },
  ];
  const laneColours=[['Lime','#a3ff00'],['Amber','#f0a91f'],['Cyan','#39d8ff'],['Blue','#73a8ff'],['Purple','#ba8cff'],['Pink','#ff88b5'],['Coral','#ff8a72'],['Mint','#78dfb3']];
  const laneColour=id=>/^#[0-9a-f]{6}$/i.test(activeProject?.laneColours?.[id]||'')?activeProject.laneColours[id]:'';

  const sectionSymbols = {
    'left-deck': '1',
    'right-deck': '2',
    samples: 'SP',
    fx: 'FX',
    recordings: 'REC',
    instruments: 'DR',
  };

  function activeTrackList() {
    if (typeof getActiveSetList === 'function') {
      const list = getActiveSetList();
      if (Array.isArray(list)) return list;
    }
    return Array.isArray(currentPlaylist) ? currentPlaylist : [];
  }

  // Studio rows can remain visible after their source has been removed or
  // disconnected. Keep that state attached to the DAW copy so a non-playable
  // row can never silently become a DAW clip or render input.
  function trackHasUsableAudio(track) {
    const path = String(track?.path || '').trim();
    return Boolean(path && !track?.missing_placeholder && !track?._unlinked && !track?.needs_relink);
  }

  function trackByIndex(index) {
    return activeTrackList()[Number(index)] || null;
  }

  function stableTrackCopy(track) {
    const path = String(track?.path || '').trim();
    const cached = path && typeof trackVisualCache !== 'undefined' && trackVisualCache?.get ? trackVisualCache.get(path) : null;
    const merged = typeof normalizeModalTrackMetadata === 'function'
      ? normalizeModalTrackMetadata({ ...(cached || {}), ...(track || {}) })
      : { ...(cached || {}), ...(track || {}) };
    let beatgrid=null,gridStatus=merged?.gridStatus==='invalid'?'invalid':'missing';
    if(merged?.beatgrid && existing.trackGrid) {
      try {existing.trackGrid(merged);beatgrid=JSON.parse(JSON.stringify(merged.beatgrid));gridStatus='verified-anchors';}
      catch {gridStatus='invalid';}
    }
    const durationSec = durationSecondsFromTrack(merged);
    return {
      beatgrid,gridStatus,
      importAnalysis: merged?.importAnalysis ? {...merged.importAnalysis} : null,
      title: String(merged?.title || 'Untitled Track'),
      artist: String(merged?.artist || 'Unknown Artist'),
      path,
      bpm: Number(merged?.bpm || 120) || 120,
      camelot: String(merged?.camelot || merged?.key || ''),
      energy: String(merged?.energy || ''),
      genre: String(merged?.genre || ''),
      year: merged?.year || null,
      era: merged?.era || '',
      durationSec,
      duration_sec: durationSec,
      missing_placeholder: Boolean(merged?.missing_placeholder),
      _unlinked: Boolean(merged?._unlinked),
      needs_relink: Boolean(merged?.needs_relink),
    };
  }

  function durationSecondsFromTrack(track) {
    const direct = Number(track?.durationSec || track?.duration_sec || track?.duration_seconds || track?.length_seconds || 0);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const millis = Number(track?.duration_ms || track?.durationInMillis || track?.durationMillis || 0);
    if (Number.isFinite(millis) && millis > 0) return millis / 1000;
    const minutes = Number(track?.duration_min || track?.duration_minutes || 0);
    if (Number.isFinite(minutes) && minutes > 0) return minutes * 60;
    const generic = Number(track?.duration || track?.length || 0);
    return Number.isFinite(generic) && generic > 0 ? generic : 0;
  }

  function clipId(prefix = 'clip') {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
  }

  function beatsFromTrackDuration(track) {
    const bpm = Number(track?.bpm || 120) || 120;
    const durationSec = durationSecondsFromTrack(track);
    if (durationSec > 0) return Math.max(1/64, existing.sourceSecondsToBeat ? existing.sourceSecondsToBeat(track,durationSec)-existing.sourceSecondsToBeat(track,0) : (durationSec / 60) * bpm);
    return 64;
  }

  function secondsFromBeat(track, beat) {
    if(existing.sourceBeatToSeconds) return Math.max(0,existing.sourceBeatToSeconds(track,Number(beat || 0)));
    const bpm = Number(track?.bpm || 120) || 120;
    return Math.max(0, (Number(beat || 0) * 60) / bpm);
  }

  function arrangementLengthBeats(project = activeProject) {
    const clips = Array.isArray(project?.arrangementClips) ? project.arrangementClips : [];
    const clipEnd = clips.reduce((max, clip) => Math.max(max, Number(clip.timelineStartBeat || 0) + Number(clip.timelineDurationBeats || 0)), 0);
    const markerEnd = (project?.markers || []).reduce((max, marker) => Math.max(max, Number(marker.beat || 0) + 16), 0);
    const fxEnd=(project?.fxRegions || []).reduce((max,fx)=>Math.max(max,fx.startBeat+fx.durationBeats+(fx.tailBeats||0)),0);
    const patternEnd=(project?.patternClips||[]).reduce((max,c)=>Math.max(max,c.startBeat+c.durationBeats),0);
    return Math.max(64, clipEnd, markerEnd,fxEnd,patternEnd);
  }

  function timelineWorkspaceBeats(project=activeProject) {
    const length=arrangementLengthBeats(project);
    return Math.ceil((length+Math.max(64,length/4))/4)*4;
  }

  function sectionForClipIndex(index) {
    return Number(index || 0) % 2 === 0 ? 'left-deck' : 'right-deck';
  }

  function makeArrangementClip(track, options = {}) {
    const safeTrack = stableTrackCopy(track);
    const sourceStartBeat = Number(options.sourceStartBeat ?? (existing.sourceSecondsToBeat ? existing.sourceSecondsToBeat(safeTrack,0) : 0));
    const sourceDurationBeats = Math.max(1/64, Number(options.sourceDurationBeats || options.timelineDurationBeats || 16));
    return {
      id: options.id || clipId('clip'),
      trackIndex: Number(options.trackIndex || 0),
      sectionId: options.sectionId || sectionForClipIndex(options.trackIndex || 0),
      label: String(options.label || safeTrack.title || 'Clip'),
      title: safeTrack.title,
      artist: safeTrack.artist,
      path: safeTrack.path,
      durationSec:safeTrack.durationSec,
      beatgrid:safeTrack.beatgrid,gridStatus:safeTrack.gridStatus,
      importAnalysis:safeTrack.importAnalysis,
      bpm: safeTrack.bpm,
      camelot: safeTrack.camelot,
      energy: safeTrack.energy,
      genre: safeTrack.genre,
      sourceStartBeat,
      sourceDurationBeats,
      timelineStartBeat: Math.max(0, Number(options.timelineStartBeat || 0)),
      timelineDurationBeats: Math.max(1/64, Number(options.timelineDurationBeats || sourceDurationBeats)),
      repeatCount: Math.max(1, Number(options.repeatCount || 1)),
      sourceIntent: options.sourceIntent || null,
      alignAudioStart: options.alignAudioStart === true,
      ...(Number.isFinite(Number(options.mixtapeHandoffBeat)) ? { mixtapeHandoffBeat: Math.max(0, Number(options.mixtapeHandoffBeat)) } : {}),
    };
  }

  function createRegionClipsForTrack(track, trackIndex = 0, sectionId = 'left-deck') {
    // Structural DJ markers describe the source; they must never turn a song
    // into a set of artificial timeline clips. Keep this helper for legacy
    // callers, but return one full-file clip so the trim handle can reveal the
    // entire source and playback cannot stop at a marker boundary.
    return [createFullTrackClip(track, trackIndex, 0)];
  }

  function isGeneratedRegionClipSet(project) {
    const source = project?.sourceTrack;
    const clips = Array.isArray(project?.arrangementClips) ? project.arrangementClips : [];
    if (!source?.path) return false;
    const totalBeats = beatsFromTrackDuration(source);
    const markers = defaultMarkersForTrack(source).filter(marker => marker.beat < totalBeats);
    if (clips.length !== markers.length) return false;
    const boundaries = [...markers.map(marker => marker.beat), totalBeats];
    const close = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-8;
    return clips.every((clip, index) => {
      const start = boundaries[index];
      const end = Math.max(start + 1, boundaries[index + 1] || totalBeats);
      return clip.path === source.path && clip.trackIndex === 0 && clip.sectionId === 'left-deck' &&
        clip.label === markers[index].label && close(clip.sourceStartBeat, start) &&
        close(clip.sourceDurationBeats, end - start) && close(clip.timelineStartBeat, start) &&
        close(clip.timelineDurationBeats, end - start);
    });
  }

  function migrateGeneratedRegionClipSet(project) {
    if (!isGeneratedRegionClipSet(project)) return false;
    const first = project.arrangementClips[0];
    const full = createFullTrackClip(project.sourceTrack, first.trackIndex || 0, first.timelineStartBeat || 0);
    full.sectionId = first.sectionId || 'left-deck';
    full.layerIndex = first.layerIndex || 0;
    project.arrangementClips = [full];
    return true;
  }

  function createFullTrackClip(track, trackIndex = 0, timelineStartBeat = 0) {
    const safeTrack = stableTrackCopy(track);
    const durationBeats = beatsFromTrackDuration(safeTrack);
    return makeArrangementClip(safeTrack, {
      trackIndex,
      sectionId: sectionForClipIndex(trackIndex),
      label: safeTrack.title,
      sourceStartBeat: existing.sourceSecondsToBeat ? existing.sourceSecondsToBeat(safeTrack,0) : 0,
      sourceDurationBeats: durationBeats,
      timelineStartBeat,
      timelineDurationBeats: durationBeats,
      sourceIntent: 'full-track',
      alignAudioStart: true,
      mixtapeHandoffBeat: timelineStartBeat,
    });
  }

  function ensureArrangementClips(project = activeProject) {
    if (!project) return [];
    if (Array.isArray(project.arrangementClips)) return project.arrangementClips;
    const tracks = project.sourceTracks?.length ? project.sourceTracks : [project.sourceTrack].filter(Boolean);
    if (tracks.length <= 1) {
      project.arrangementClips = [createFullTrackClip(tracks[0] || project.sourceTrack, 0, 0)];
    } else {
      let cursor = 0;
      project.arrangementClips = tracks.map((track, index) => {
        const clip = createFullTrackClip(track, index, cursor);
        cursor += clip.timelineDurationBeats;
        return clip;
      });
    }
    selectedClipId = project.arrangementClips[0]?.id || '';
    selectedClipIndex = project.arrangementClips[0]?.trackIndex || 0;
    return project.arrangementClips;
  }

  function createProjectFromTrack(track) {
    const safeTrack = stableTrackCopy(track);
    const project = existing.createEmptyProject
      ? existing.createEmptyProject(`${safeTrack.title} Edit`, safeTrack.bpm)
      : { schemaVersion: 1, title: `${safeTrack.title} Edit`, tempoSegments: [{ startBeat: 0, bpm: safeTrack.bpm }], beatgridReferences: [], automationLanes: [], decks: [] };
    const bpmLane = existing.createBpmAutomation
      ? existing.createBpmAutomation([
          { beat: 0, value: safeTrack.bpm, curve: 'hold' },
          { beat: 128, value: safeTrack.bpm, curve: 'linear' },
        ])
      : { scope: 'project', parameter: 'bpm', points: [{ beat: 0, value: safeTrack.bpm, curve: 'hold' }, { beat: 128, value: safeTrack.bpm, curve: 'linear' }] };

    return {
      ...project,
      sourceTrack: safeTrack,
      sourceTracks: [safeTrack],
      markers: defaultMarkersForTrack(safeTrack).map(marker => ({ ...marker })),
      automationLanes: [bpmLane],
      arrangementClips: [createFullTrackClip(safeTrack, 0, 0)],
      patternClips: [],
      stepPattern: {},
      sectionsCollapsed: {},
    };
  }

  function createProjectFromSet(tracks, mode = 'mixtape') {
    const safeTracks = tracks.map(stableTrackCopy);
    const firstTrack = safeTracks[0] || stableTrackCopy(null);
    let timelineCursor = 0;
    const arrangementClips = safeTracks.map((track, index) => {
      const clip = createFullTrackClip(track, index, timelineCursor);
      timelineCursor += clip.timelineDurationBeats;
      return clip;
    });
    arrangementClips.forEach((clip,index)=>{clip.intakePlacement={startBeat:clip.timelineStartBeat,afterId:arrangementClips[index-1]?.id||null};});
    const project = {
      ...createProjectFromTrack(firstTrack),
      title: 'Studio Mixtape Draft',
      sourceTrack: firstTrack,
      sourceTracks: safeTracks,
      arrangementClips,
      mode: mode === 'edit' ? 'edit' : 'mixtape',
    };
    if (project.mode === 'mixtape' && typeof syncMixtapeBpmAutomation === 'function') syncMixtapeBpmAutomation(project, true);
    else {
      const fallbackBpm = Number.isFinite(Number(firstTrack.bpm)) && Number(firstTrack.bpm) > 0 ? Number(firstTrack.bpm) : 120;
      project.automationLanes = [{ scope:'project', parameter:'bpm', points:[{ beat:0, value:fallbackBpm, curve:'hold' }] }];
    }
    return project;
  }

  function afterDraftSaved(action){
    if(window.AxiomDawTimelineRecording?.active){window.showToast?.('Finish and save or discard the current take before switching projects.',true);return false;}
    if(window.AxiomDawDrafts?.beforeSwitch)return window.AxiomDawDrafts.beforeSwitch(action);
    if(activeProject&&window.AxiomDawDrafts?.checkpoint()===false)return false;
    return action();
  }

  function showStudioDawProject(track, source = 'track') {return afterDraftSaved(()=>{
    if (!track || !trackHasUsableAudio(track)) {
      if (typeof showToast === 'function') showToast('This Studio track is not playable on this Mac. Reconnect it before opening Studio DAW.', true);
      return false;
    }
    hideContextMenu();
    viewStartBeat = 0; viewBeats = 0; shellReference = false;
    activeProject = createProjectFromTrack(track);
    window.AxiomRemixWorkflow?.apply(activeProject);
    window.AxiomArrangement?.stop();
    activeProject.mode='edit';
    selectedBpmPoint=-1; bpmEditing=false;
    activeMarkerIndex = 0;
    activeSectionId = 'master';
    selectedClipIndex = 0;
    selectedClipId = '';
    clipEditorOpen = false;
    selectedClipPointerRatio = 0;
    zoomMode = 'arrange';
    window.setAxiomPreviewPlayerContext?.('studio-daw-preview', { reason: 'open_studio_daw', reset:true });

    document.getElementById('studio-start-view')?.classList.add('hidden');
    document.getElementById('set-brief-view')?.classList.add('hidden');
    document.getElementById('studio-active-view')?.classList.add('hidden');
    const shell = document.getElementById('studio-daw-shell');
    shell?.classList.remove('hidden');
    shell?.setAttribute('aria-hidden', 'false');
    document.body.classList.add('studio-daw-mode-active');
    window.quietDawNotifications?.();
    if (typeof showTab === 'function') showTab('studio');
    renderShell(source);
    shell?.scrollIntoView({ block: 'start' });
    window.AxiomSourceBounds?.queue(activeProject);
    return false;
  });}

  async function showStudioDawSetProject(tracks, mode = 'mixtape') {
    if (!['mixtape', 'edit'].includes(mode)) return false;
    const previousProject = activeProject;
    const navigationVersion = window.axiomTabNavigationVersion;
    const intakeTracks = (Array.isArray(tracks) ? tracks : activeTrackList()).map(stableTrackCopy);
    if (!window.AxiomAudioReadiness) { showToast('Audio checks are unavailable. Reopen AXIOM before opening this set in Studio DAW.', true); return false; }
    const realTracks = await window.AxiomAudioReadiness.review(intakeTracks, { forMixtape: true });
    if (!realTracks) return false;
    if (activeProject !== previousProject || window.axiomTabNavigationVersion !== navigationVersion) {
      showToast('The project or page changed during the audio check. Open your set again when ready.');
      return false;
    }
    const readyPaths = new Set(realTracks.map(track => track.path));
    const retainedStudioTracks = intakeTracks.filter(track => !readyPaths.has(track.path));
    return commitStudioDawSetProject(realTracks, mode, retainedStudioTracks);
  }

  function commitStudioDawSetProject(realTracks, mode = 'mixtape', retainedStudioTracks = []) {return afterDraftSaved(()=>{
    if (!realTracks.length) {
      if (typeof showToast === 'function') showToast('Add playable tracks to Studio before opening Studio DAW.', true);
      return false;
    }
    if (mode === 'mixtape' && activeProject?.mode === 'mixtape') {
      // Import into the existing arrangement without rebuilding its edits or automation.
      const additions = realTracks.filter(track => !projectHasTrack(track));
      activeProject._studioPendingTracks = retainedStudioTracks.map(stableTrackCopy);
      pendingLayer = null;
      for (const track of additions) addTrackToProject(track, {batch:true});
      revealStudioDawShell('set');
      window.AxiomSourceBounds?.queue(activeProject);
      showToast(additions.length ? `${additions.length} new songs added to your mixtape. Existing edits kept.` : 'Your mixtape already contains these songs.');
      return false;
    }
    hideContextMenu();
    activeProject = createProjectFromSet(realTracks, mode);
    activeProject._studioPendingTracks = retainedStudioTracks.map(stableTrackCopy);
    window.AxiomRemixWorkflow?.apply(activeProject);
    window.AxiomArrangement?.stop();
    activeProject.mode = mode === 'edit' ? 'edit' : 'mixtape';
    if (activeProject.mode === 'edit') {
      activeProject.title = 'Studio Edit Draft';
      activeProject.anchorPath = activeProject.sourceTrack.path;
    }
    selectedBpmPoint=-1; bpmEditing=false;
    viewStartBeat = 0;
    viewBeats = 0;
    shellReference = false;
    activeMarkerIndex = 0;
    activeSectionId = 'master';
    selectedClipIndex = 0;
    selectedClipId = '';
    clipEditorOpen = false;
    selectedClipPointerRatio = 0;
    zoomMode = 'arrange';
    window.setAxiomPreviewPlayerContext?.('studio-daw-preview', { reason: 'open_studio_daw_set', reset:true });
    document.getElementById('studio-start-view')?.classList.add('hidden');
    document.getElementById('set-brief-view')?.classList.add('hidden');
    document.getElementById('studio-active-view')?.classList.add('hidden');
    const shell = document.getElementById('studio-daw-shell');
    shell?.classList.remove('hidden');
    shell?.setAttribute('aria-hidden', 'false');
    document.body.classList.add('studio-daw-mode-active');
    window.quietDawNotifications?.();
    if (typeof showTab === 'function') showTab('studio');
    renderShell('set');
    shell?.scrollIntoView({ block: 'start' });
    window.AxiomSourceBounds?.queue(activeProject);
    return false;
  });}

  function revealStudioDawShell(source = 'set') {
    if (!activeProject) return false;
    document.getElementById('connect-music-view')?.classList.add('hidden');
    document.body.classList.remove('connect-music-stage');
    window.setAxiomPreviewPlayerContext?.('studio-daw-preview', { reason: 'reveal_studio_daw' });
    document.getElementById('studio-start-view')?.classList.add('hidden');
    document.getElementById('set-brief-view')?.classList.add('hidden');
    document.getElementById('studio-active-view')?.classList.add('hidden');
    const shell = document.getElementById('studio-daw-shell');
    shell?.classList.remove('hidden');
    shell?.setAttribute('aria-hidden', 'false');
    document.body.classList.add('studio-daw-mode-active');
    window.quietDawNotifications?.();
    if (typeof showTab === 'function') showTab('studio');
    clipEditorOpen = Boolean(selectedClipId && selectedArrangementClip());
    renderShell(source);
    shell?.scrollIntoView({ block: 'start' });
    return false;
  }

  const referenceExcludedProjects=new WeakSet();
  function newBlankProject(){return afterDraftSaved(()=>{
    stopParameterPlayback();hideContextMenu();clearRange();
    activeProject={...createProjectFromTrack({path:'',title:'Untitled',bpm:120}),
      title:'Untitled',mode:'edit',playbackMode:'preserve-pitch',sourceTracks:[],arrangementClips:[],markers:[],automationLanes:[],
      editCursorBeat:0,patternClips:[],stepPattern:Object.fromEntries(['Kick','Snare','Hats','One Shot','Vocal Chop','Perc'].map(name=>[name,[]]))};
    referenceExcludedProjects.add(activeProject);
    selectedClipId='';selectedClipIndex=0;selectedClipPointerRatio=0;mixerSelection.clear();
    selectedBpmPoint=-1;activeMarkerIndex=0;activeSectionId='master';clipEditorOpen=false;
    pendingLayer=null;targetLayerIndex=0;arrangementClipboard=null;clipboardTrack=null;
    viewStartBeat=0;viewBeats=0;shellReference=false;focusZoom('arrange');
    window.AxiomArrangement?.seekBeat(activeProject,0);
    window.setAxiomPreviewPlayerContext?.('studio-daw-preview',{reason:'new_blank_project',reset:true});
    revealStudioDawShell('track');return true;
  });}

  function closeStudioDawShell() {
    window.AxiomSourceAudition?.stop();
    window.AxiomDawFinder?.syncStudioSet(activeProject);
    window.AxiomArrangement?.stop();
    hideContextMenu();
    const shell = document.getElementById('studio-daw-shell');
    shell?.classList.add('hidden');
    shell?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('studio-daw-mode-active');
    window.setAxiomPreviewPlayerContext?.('library-studio-preview', { reason: 'close_studio_daw' });
    document.getElementById('studio-active-view')?.classList.remove('hidden');
    if (typeof setStudioView === 'function') setStudioView('manual');
  }

  function renderShell(source = 'track') {
    if (!activeProject) return;
    resumeImportAnalyses(activeProject);
    if(rangeProject!==activeProject)clearRange();
    ensureArrangementClips(activeProject);
    window.AxiomStemCache?.reconcile?.(activeProject);
    renderHeader(source);
    renderInspector();
    renderLayerPanel();
    renderTrackStack();
    renderArrangementOverview();
    renderRuler();
    renderMarkers();
    renderLanes();
    renderStepEditor();
    renderBpmLane();
    syncZoomUi();
    window.AxiomMixer?.refresh();
    window.AxiomDawFinder?.syncStudioSet(activeProject);
    window.AxiomSteadyTiming?.queue(activeProject);
  }

  function renderHeader(source) {
    const controls=document.querySelector('.studio-daw-master-controls');
    const accessoryControls=document.getElementById('daw-accessory-controls') || controls;
    window.AxiomMasterLimiter?.mount(accessoryControls);
    if(controls && !document.getElementById('daw-project-mode')){
      const group=document.createElement('div');group.id='daw-project-mode';group.setAttribute('role','group');group.setAttribute('aria-label','Project mode');
      for(const [value,label] of [['mixtape','MIXTAPE'],['edit','REMIX']]){
        const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.mode=value;
        button.title=value==='mixtape'?'Incoming songs take over when the outgoing anchor ends':'Keep one fixed anchor throughout the remix';
        button.onclick=()=>setProjectMode(value);group.appendChild(button);
      }
      const modeSlot=controls.querySelector('#daw-project-mode-slot');
      if(modeSlot) modeSlot.append(group); else controls.prepend(group);
      const anchor=document.createElement('output');anchor.id='daw-anchor-status';accessoryControls.appendChild(anchor);
    }
    document.querySelectorAll('#daw-project-mode button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===(activeProject.mode==='mixtape'?'mixtape':'edit'))));
    updateAnchorStatus(activeProject.editCursorBeat||0);
    const keySyncSlot=document.getElementById('daw-key-sync-slot') || accessoryControls;
    if(controls&&!document.getElementById('daw-key-sync')){
      const button=document.createElement('button');button.id='daw-key-sync';button.type='button';button.textContent='SYNC KEY';
      button.onclick=()=>toggleKeySync();keySyncSlot.appendChild(button);
    } else {
      const button=document.getElementById('daw-key-sync');
      if(button&&keySyncSlot&&!keySyncSlot.contains(button))keySyncSlot.appendChild(button);
    }
    updateKeySyncControl();
    if(controls&&!document.getElementById('daw-sweep-template')){
      const button=document.createElement('button');button.id='daw-sweep-template';button.type='button';button.textContent='Generate Sweep';
      button.setAttribute('aria-label','Generate sweep audio clip');
      button.title='Generate a ready-made rising chopped whoosh on the selected bars';button.onclick=()=>window.AxiomDawSweeps?.open();accessoryControls.appendChild(button);
    }
    if(controls&&!document.getElementById('daw-plugins')){
      const button=document.createElement('button');button.id='daw-plugins';button.type='button';button.textContent='Plugins';
      button.title='Attach an installed Mac Audio Unit effect to the selected audio clip';
      button.onclick=()=>window.AxiomNativeEffects?.openSelected();accessoryControls.appendChild(button);
    }
    if(controls && !document.getElementById('daw-playback-mode')) {
      const select=document.createElement('select');select.id='daw-playback-mode';select.setAttribute('aria-label','Audio processing mode');select.title='Audio processing mode';
      select.innerHTML='<option value="resample">Resample</option><option value="preserve-pitch">Preserve Pitch</option>';
      select.onchange=()=>setPlaybackMode(select.value);accessoryControls.appendChild(select);
    }
    const mode=document.getElementById('daw-playback-mode');if(mode)mode.value=activeProject.playbackMode||'resample';
    const title = document.getElementById('studio-daw-project-title');
    const subtitle = document.getElementById('studio-daw-project-subtitle');
    const track = activeProject.sourceTrack;
    const topKey = document.getElementById('studio-daw-top-key');
    const sideTitle = document.getElementById('studio-daw-master-side-title');
    syncBpmDisplay();
    if (topKey) topKey.textContent = track.camelot || '---';
    if (sideTitle) sideTitle.textContent = activeProject.title;
    if (title) title.textContent = activeProject.title;
    if (subtitle) {
      subtitle.textContent = source === 'set'
        ? `${activeProject.sourceTracks.length} tracks loaded in this project. Split, stem, layer, and BPM automation work stays inside AXIOM.`
        : `${track.artist} · ${Math.round(track.bpm)} BPM${track.camelot ? ` · ${track.camelot}` : ''}. Source audio stays untouched.`;
    }
    const note = document.getElementById('studio-daw-performance-note');
    note?.classList.toggle('hidden', window.axiomVisibleTab === 'performance');
  }

  function visibleProjectMarkers() {
    return (activeProject?.markers || []).filter(marker => {
      const kind = String(marker?.kind || '').toLowerCase();
      const role = String(marker?.role || '').toLowerCase();
      if (kind === 'dj_structure') return false;
      if (kind === 'dj_intro') return role === 'intro' || role === 'start_hype';
      return true;
    });
  }

  function inspectorSlider({ label, value, min, max, step, suffix = '', param, disabled = false }) {
    const numeric = Number.isFinite(Number(value)) ? Number(value) : Number(min || 0);
    const display = suffix ? `${Math.round(numeric * 10) / 10}${suffix}` : `${Math.round(numeric * 100) / 100}`;
    return `<label class="daw-inspector-slider${disabled ? ' disabled' : ''}">
      <span>${escapeHtml(label)}</span>
      <output>${escapeHtml(display)}</output>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${numeric}" data-inspector-param="${escapeHtml(param)}" ${disabled ? 'disabled' : ''} oninput="AxiomStudioDaw.setInspectorParam('${escapeHtml(param)}', this.value, true)" onchange="AxiomStudioDaw.setInspectorParam('${escapeHtml(param)}', this.value)">
    </label>`;
  }

  function inspectorKnobRatio(value, min, max) {
    const ratio = min < 0 && max > 0
      ? .5 + value / (value < 0 ? -min : max) / 2
      : (value - min) / (max - min || 1);
    return Math.max(0, Math.min(1, ratio));
  }

  function inspectorKnob({ label, value, min, max, step, suffix = '', param, displayValue, polarity = 1, disabled = false }) {
    const numeric = Number.isFinite(Number(value)) ? Number(value) : Number(min || 0);
    const lower = Number(min || 0);
    const upper = Number(max || 100);
    const ratio = inspectorKnobRatio(numeric, lower, upper);
    const display = displayValue || (suffix ? `${Math.round(numeric * 10) / 10}${suffix}` : `${Math.round(numeric * 100) / 100}`);
    return `<label class="daw-inspector-knob${disabled ? ' disabled' : ''}" style="--knob-ratio:${ratio}">
      <span>${escapeHtml(label)}</span>
      <button type="button" class="daw-inspector-knob-control" role="slider" aria-label="${escapeHtml(label)}" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${numeric}" data-knob-param="${escapeHtml(param)}" data-knob-min="${min}" data-knob-max="${max}" data-knob-step="${step}" data-knob-polarity="${Number(polarity) || 1}" data-knob-suffix="${escapeHtml(suffix)}" ${disabled ? 'disabled' : ''} onpointerdown="AxiomStudioDaw.dragInspectorKnob(event)" onkeydown="AxiomStudioDaw.keyInspectorKnob(event)"><i></i></button>
      <output>${escapeHtml(display)}</output>
    </label>`;
  }

  function inspectorToggle({ label, stem, value, disabled = false }) {
    const numeric = Math.max(0, Math.min(2, Number.isFinite(Number(value)) ? Number(value) : 1));
    const display = numeric === 0 ? 'Off' : `${Math.round((20 * Math.log10(numeric)) * 10) / 10} dB`;
    return `<label class="daw-inspector-stem${disabled ? ' pending' : ''}">
      <span>${escapeHtml(label)}</span>
      <input type="range" min="0" max="2" step="0.01" value="${numeric}" data-stem-neutral="1" oninput="AxiomStudioDaw.setStemInspectorGain('${stem}', this.value, true)" onchange="AxiomStudioDaw.setStemInspectorGain('${stem}', this.value)">
      <output>${escapeHtml(display)}</output>
      <button type="button" aria-pressed="${numeric > 0}" onclick="AxiomStudioDaw.toggleStemInspectorGain('${stem}')">${numeric > 0 ? 'On' : 'Off'}</button>
    </label>`;
  }

  function stemProgressValues(clip) {
    const progress=window.AxiomStems?.progress?.(clip);
    return {
      mode:progress?.mode==='mps'?'GPU/MPS':progress?.mode==='cpu'?'CPU':'Checking hardware',
      detail:progress?.detail||'Starting the local stem engine.',
      elapsed:`${Math.floor((progress?.elapsedSeconds||0)/60)}:${String(Math.floor((progress?.elapsedSeconds||0)%60)).padStart(2,'0')}`,
    };
  }

  function stemProgressMarkup(clip) {
    const {mode,detail,elapsed}=stemProgressValues(clip);
    return `<strong data-stem-mode>${escapeHtml(mode)}</strong> · <span data-stem-detail>${escapeHtml(detail)}</span> <span data-stem-elapsed>${escapeHtml(elapsed)}</span>`;
  }

  function refreshStemProgress() {
    // Polls must not replace controls, lose keyboard focus or repaint waveforms.
    document.querySelectorAll('.daw-stem-progress[data-stem-clip]').forEach(node=>{
      const clip=activeProject?.arrangementClips?.find(item=>item.id===node.dataset.stemClip);
      if(clip?.stemState!=='processing')return;
      const values=stemProgressValues(clip);
      for(const key of ['mode','detail','elapsed']){
        const field=node.querySelector(`[data-stem-${key}]`);
        if(field&&field.textContent!==values[key])field.textContent=values[key];
      }
    });
  }

  function renderInspector() {
    const clip = explicitlySelectedArrangementClip();
    const track = clip || activeProject.sourceTrack || {};
    const shell = document.getElementById('studio-daw-shell');
    const panel = document.getElementById('studio-daw-clip-inspector');
    const title = document.getElementById('studio-daw-inspector-title');
    const deviceTitle = document.getElementById('studio-daw-device-inspector-title');
    const subtitle = document.getElementById('studio-daw-inspector-subtitle');
    const meta = document.getElementById('studio-daw-inspector-meta');
    const waveform = document.getElementById('studio-daw-inspector-waveform');
    const controls = document.getElementById('studio-daw-inspector-controls');
    shell?.setAttribute('data-clip-inspector', clip ? 'selected' : 'hidden');
    panel?.classList.toggle('is-hidden', !clip);
    if(panel)panel.inert=!clip;
    panel?.setAttribute('aria-hidden', clip ? 'false' : 'true');
    if (!clip) {
      if (title) title.textContent = 'No clip selected';
      if (deviceTitle) deviceTitle.textContent = 'No clip selected';
      if (subtitle) subtitle.textContent = 'Select a clip to edit fades, filters, stems, EQ, and level automation.';
      if (waveform) waveform.innerHTML = '';
      if (meta) meta.innerHTML = '';
      if (controls) controls.innerHTML = '';
      return;
    }
    if (title) title.textContent = clip ? (clip.label && clip.label !== clip.title ? `${clip.label} · ${clip.title}` : clip.title) : track.title;
    if (deviceTitle) deviceTitle.textContent = clip ? `${clip.label} · ${clip.title}` : track.title;
    if (subtitle) subtitle.textContent = clip ? track.artist : 'Select a clip to edit fades, filters, stems, EQ, and level automation.';
    if (waveform) waveform.innerHTML = clip?.path ? renderWaveformBars(clip) : '';
    if (!meta) return;
    meta.innerHTML = [
      ['Artist', track.artist],
      ['BPM', Math.round(track.bpm)],
      ['Key', track.camelot || 'Not set'],
      ['Start', formatTime(secondsFromBeat(track, clip?.sourceStartBeat || 0))],
      ['Length', `${Math.max(1, Math.round((clip?.sourceDurationBeats || 16) / 4))} bars`],
      ['Source', clip ? clip.sectionId?.replace('-', ' ') || 'clip' : 'project'],
    ].map(([label, value]) => label === 'Key'
      ? `<button type="button" class="daw-inspector-meta-action" aria-label="Sync selected clip key to anchor" title="Sync selected clip key to the anchor" onclick="AxiomStudioDaw.syncInspectorKey()"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></button>`
      : `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
    if (!controls) return;
    if (!clip) {
      controls.innerHTML = '<p class="daw-inspector-empty">No clip selected. Choose a timeline clip to unlock fades, HP/LP filter, stems, gain, and EQ controls.</p>';
      return;
    }
    const duration = Math.max(1, Number(clip.timelineDurationBeats || clip.sourceDurationBeats || 16));
    const fadeMax = Math.max(.25, Math.min(16, duration / 2));
    const filterValue = Number(clip.mixFilterPosition ?? 0);
    const stemReady = clip.stemState === 'ready' && Boolean(clip.stemJob);
    const anchorReady = ['left-deck', 'right-deck'].includes(clip.sectionId);
    controls.innerHTML = `
      <section class="daw-inspector-section">
        <h4>Stems</h4>
        ${clip.stemState === 'processing' ? `<p class="daw-stem-progress" data-stem-clip="${escapeHtml(clip.id)}" role="status">${stemProgressMarkup(clip)}</p>` : ''}
        ${inspectorToggle({ label: 'Vocals', stem: 'vocals', value: clip.stemGain_vocals ?? 1, disabled: !stemReady })}
        ${inspectorToggle({ label: 'Drums', stem: 'drums', value: clip.stemGain_drums ?? 1, disabled: !stemReady })}
        ${inspectorToggle({ label: 'Bass', stem: 'bass', value: clip.stemGain_bass ?? 1, disabled: !stemReady })}
        ${inspectorToggle({ label: 'Harmony', stem: 'other', value: clip.stemGain_other ?? 1, disabled: !stemReady })}
        <button type="button" class="daw-inspector-select-clip" onclick="AxiomStudioDaw.inspectorStemAction()">${clip.stemState === 'processing' ? 'Cancel Separation' : stemReady ? 'Play Stems' : 'Create Stems'}</button>
      </section>
      ${anchorReady ? `<section class="daw-inspector-section daw-inspector-anchor">
        <h4>Anchor</h4>
        <button type="button" class="daw-inspector-anchor-button" aria-pressed="${Boolean(clip.transitionAnchor || activeProject.anchorPath === clip.path)}" onclick="AxiomStudioDaw.makeClipAnchor('${escapeHtml(clip.id)}')">Make Anchor</button>
        <p>Use this track as the reference for key sync and transition decisions around this point.</p>
      </section>` : ''}
      <section class="daw-inspector-section">
        <h4>Range</h4>
        ${inspectorSlider({ label: 'Fade In', value: clip.fadeInBeats || 0, min: 0, max: fadeMax, step: .25, suffix: ' beats', param: 'fadeInBeats' })}
        ${inspectorSlider({ label: 'Fade Out', value: clip.fadeOutBeats || 0, min: 0, max: fadeMax, step: .25, suffix: ' beats', param: 'fadeOutBeats' })}
        ${inspectorSlider({ label: 'Gain', value: clip.mixGainDb || 0, min: -24, max: 12, step: .5, suffix: ' dB', param: 'mixGainDb' })}
        <button type="button" class="daw-inspector-select-clip" aria-pressed="${Boolean(clip.reversed)}" onclick="AxiomStudioDaw.toggleClipReverse('${escapeHtml(clip.id)}')">${clip.reversed ? 'Restore Forward Audio' : 'Reverse Clip Audio'}</button>
      </section>
      <section class="daw-inspector-section">
        <h4>Filter</h4>
        <div class="daw-inspector-knob-row">
          ${inspectorKnob({ label: 'HP Filter', value: Math.max(0, filterValue), min: 0, max: 100, step: 1, suffix: '', param: 'mixFilterPosition', polarity: 1, displayValue: filterValue > 0 ? `${Math.round(filterValue)}%` : '20 Hz' })}
          ${inspectorKnob({ label: 'LP Filter', value: Math.max(0, -filterValue), min: 0, max: 100, step: 1, suffix: '', param: 'mixFilterPosition', polarity: -1, displayValue: filterValue < 0 ? `${Math.round(Math.abs(filterValue))}%` : '20.0 kHz' })}
        </div>
        <button type="button" class="daw-inspector-automation" onclick="AxiomStudioDaw.openInspectorAutomation('filterPosition')">Automate Filter</button>
      </section>
      <section class="daw-inspector-eq">
        <h4>EQ</h4>
        <div class="daw-inspector-knob-row three">
          ${inspectorKnob({ label: 'Low', value: clip.mixLowDb || 0, min: -24, max: 12, step: .5, suffix: ' dB', param: 'mixLowDb' })}
          ${inspectorKnob({ label: 'Mid', value: clip.mixMidDb || 0, min: -24, max: 12, step: .5, suffix: ' dB', param: 'mixMidDb' })}
          ${inspectorKnob({ label: 'High', value: clip.mixHighDb || 0, min: -24, max: 12, step: .5, suffix: ' dB', param: 'mixHighDb' })}
        </div>
      </section>`;
  }

  function renderLayerPanel() {
    const panel = document.getElementById('studio-daw-layer-panel');
    const content = document.getElementById('studio-daw-layer-panel-content');
    const showBeatmaker = activeSectionId === 'instruments';
    panel?.classList.toggle('hidden', !showBeatmaker);
    panel?.setAttribute('aria-hidden', showBeatmaker ? 'false' : 'true');
    document.getElementById('studio-daw-shell')?.setAttribute('data-active-section', activeSectionId);
    if (!content || !showBeatmaker) return;
    content.innerHTML = `
      <div class="studio-daw-beatmaker">
        <div class="studio-daw-beatmaker-head">
          <span>Layer Workspace</span>
          <h2>Beatmaker</h2>
          <p>Load kicks, snares, hats, one-shots, scratch breaks, and instrument parts for the Drums / Instruments layer.</p>
        </div>
        <div class="studio-daw-pad-bank" aria-label="Beatmaker sample pads">
          ${['Kick', 'Snare', 'Hat', 'Clap', 'Perc', 'One Shot', 'Scratch', 'Loop'].map(label => `<button type="button">${escapeHtml(label)}</button>`).join('')}
        </div>
      </div>
    `;
    window.AxiomCreativeTools?.mountPads(content,activeProject);
  }

  function renderTrackStack() {
    renderContextPanel();
    const stack = document.getElementById('studio-daw-track-stack');
    if (!stack) return;
    stack.dataset.projectMode = activeProject?.mode || 'edit';
    stack.dataset.bpmLaneSize = bpmLaneSize;
    stack.innerHTML = [
      `<div class="studio-daw-track-head master${activeSectionId === 'master' ? ' active' : ''}" role="button" tabindex="0" onclick="AxiomStudioDaw.selectSection('master')" onkeydown="AxiomStudioDaw.handleSectionKeydown(event, 'master')"><span>MC</span><strong>Master Clip<small>Project automation</small></strong><button type="button" aria-label="Open master clip" onclick="event.stopPropagation(); AxiomStudioDaw.openMasterClip()">Open</button></div>`,
      activeProject?.mode === 'mixtape'
        ? `<div class="studio-daw-track-stack-spacer daw-tempo-map-spacer"><span>Tempo Map</span><strong>${bpmLaneSize === 'expanded' ? 'Expanded' : 'Compact'}</strong><button type="button" onclick="event.stopPropagation(); AxiomStudioDaw.toggleBpmLaneSize()" aria-label="${bpmLaneSize === 'expanded' ? 'Collapse tempo map' : 'Expand tempo map'}">${bpmLaneSize === 'expanded' ? 'Collapse' : 'Expand'}</button></div>`
        : '<div class="studio-daw-track-stack-spacer" aria-hidden="true"><span>Bar</span><strong>1.1.1</strong></div>',
      ...arrangementSections.map(section => `
        <div class="studio-daw-track-head${activeSectionId === section.id ? ' active' : ''}" style="--layer-count:${layerCount(section.id)};--lane-custom-colour:${laneColour(section.id)}" data-custom-colour="${Boolean(laneColour(section.id))}" data-section-head="${escapeHtml(section.id)}" role="button" aria-pressed="${activeSectionId === section.id}" tabindex="0" onclick="AxiomStudioDaw.selectSection('${escapeHtml(section.id)}')" onkeydown="AxiomStudioDaw.handleSectionKeydown(event, '${escapeHtml(section.id)}')">
          <span>${escapeHtml(sectionSymbols[section.id] || 'TR')}</span>
          <strong>${escapeHtml(section.label)}<small>${escapeHtml(section.hint)}</small></strong>
          ${section.id.endsWith('deck') ? `<div class="daw-lane-switches">${[['solo','Solo'],['muted','Mute']].map(([key,label])=>`<button type="button" data-deck-mixer="${section.id}" data-deck-param="${key}" aria-label="${label} ${escapeHtml(section.label)}" aria-pressed="${Boolean(activeProject.rowMixer?.[section.id]?.[key])}" title="${label} ${escapeHtml(section.label)}" onkeydown="event.stopPropagation()" onclick="event.stopPropagation(); AxiomStudioDaw.toggleDeckMixer('${section.id}', '${key}')">${label}</button>`).join('')}</div>` : ''}
          <button type="button" class="daw-lane-menu-trigger" aria-label="${escapeHtml(section.label)} actions" title="${escapeHtml(section.label)} actions" onkeydown="event.stopPropagation()" onclick="event.stopPropagation(); AxiomStudioDaw.openLaneMenu(event, '${escapeHtml(section.id)}')"><img src="/static/icons/chevron-down.svg" alt=""></button>
        </div>
      `),
    ].join('');
    let actions = document.getElementById('daw-arrangement-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.id = 'daw-arrangement-actions';
    }
    stack.appendChild(actions);
    if (actions) actions.innerHTML = `<button type="button" class="studio-daw-add-audio" onclick="AxiomStudioDaw.beginAdd()">${addAudioActionLabel()}</button><button type="button" class="daw-snap-lock" aria-label="Snap to grid" aria-pressed="${snapEnabled}" title="${snapEnabled ? 'Snap on: unlock for free placement' : 'Snap off: lock to grid'}" onclick="AxiomStudioDaw.toggleSnap()"><img src="/static/icons/${snapEnabled ? 'lock-keyhole' : 'lock-keyhole-open'}.svg" alt=""></button><button type="button" class="daw-range-tool" aria-label="Select time range" aria-pressed="${rangeMode}" title="Select time range" onclick="AxiomStudioDaw.toggleRangeMode()"><img src="/static/icons/square.svg" alt=""></button>`;
    if(activeSectionId==='recordings'&&actions&&!actions.querySelector('[data-record-input]'))actions.insertAdjacentHTML('beforeend','<button type="button" data-record-input class="daw-range-tool" aria-label="Recording input" title="Choose recording input" onclick="AxiomDawTimelineRecording.setup()"><img src="/static/icons/mic-vocal.svg" alt=""></button>');
    actions?.classList.toggle('has-record-input',activeSectionId==='recordings');
    refreshDeckMixer();
  }

  function refreshDeckMixer() {
    document.querySelectorAll('[data-deck-mixer]').forEach(button=>{
      button.setAttribute('aria-pressed',String(Boolean(activeProject?.rowMixer?.[button.dataset.deckMixer]?.[button.dataset.deckParam])));
    });
    document.querySelectorAll('[data-section-head], [data-daw-section]').forEach(node=>{
      const row=activeProject?.rowMixer?.[node.dataset.sectionHead||node.dataset.dawSection];
      node.setAttribute('data-mixer-muted',String(Boolean(row?.muted)));
    });
    const clips=new Map((activeProject?.arrangementClips||[]).map(clip=>[clip.id,clip]));
    document.querySelectorAll('[data-daw-clip-id]').forEach(node=>{
      const clip=clips.get(node.dataset.dawClipId);
      node.setAttribute('data-mixer-muted',String(Boolean(clip&&(clip.muted||clip.mixMuted||activeProject?.rowMixer?.[clip.sectionId]?.muted))));
    });
  }

  function toggleDeckMixer(sectionId,key) {
    if(!activeProject||!['left-deck','right-deck'].includes(sectionId)||!['solo','muted'].includes(key))return false;
    const history=window.AxiomMixerHistory;
    if(!history){window.showToast?.('Mixer controls are still loading. Try again.',true);return false;}
    history.finish();
    activeProject.rowMixer ||= {};
    const row=activeProject.rowMixer[sectionId] ||= {volume:1,muted:false};
    history.write(activeProject,[{scope:'mix',id:sectionId}],key,!row[key]);
    window.AxiomArrangement?.mixerChanged(activeProject);
    refreshDeckMixer();window.AxiomMixer?.refresh();
    return true;
  }

  function renderContextPanel() {
    const panel = document.querySelector('.studio-daw-master-side-panel');
    if (!panel || !activeProject) return;
    const clip = selectedArrangementClip();
    const showStems = activeSectionId !== 'master' && clip && clip.sectionId === activeSectionId;
    panel.classList.toggle('daw-stem-context',Boolean(showStems));
    if (!showStems) {
      panel.innerHTML = `<div><strong>Master Clip</strong><button type="button" onclick="AxiomStudioDaw.openMasterClip()">Open</button><span id="studio-daw-master-side-title">${escapeHtml(activeProject.title)}</span></div><small>BPM Automation</small>`;
      return;
    }
    const stems = [['Vocals','mic-vocal','vocals'],['Melody','piano','other'],['Bass','guitar','bass'],['Drums','drum','drums']];
    panel.innerHTML = `<div class="daw-stem-caption"><span title="${escapeHtml(clip.title+' - '+clip.label)}">${escapeHtml(clip.label)}</span><button type="button" title="Project controls" aria-label="Show master project controls" onclick="AxiomStudioDaw.openMasterClip()"><img src="/static/icons/audio-waveform.svg" alt=""></button></div><div class="daw-stem-buttons" aria-label="Selected clip stems">${stems.map(([name,icon])=>`<button type="button" disabled aria-label="${name} stem unavailable" title="${name}: separated audio is not connected"><img src="/static/icons/${icon}.svg" alt=""></button>`).join('')}<button type="button" class="daw-stem-expand" aria-label="${clip.stemLevelsExpanded?'Collapse':'Expand'} stem levels" aria-expanded="${Boolean(clip.stemLevelsExpanded)}" onclick="AxiomStudioDaw.toggleStemLevels()"><img src="/static/icons/chevron-${clip.stemLevelsExpanded?'up':'down'}.svg" alt=""></button></div>${clip.stemLevelsExpanded?`<div class="daw-stem-levels">${stems.map(([name])=>`<label title="${name} level: separated audio is not connected"><input type="range" min="0" max="1" step="0.01" value="1" disabled aria-label="${name} stem level"></label>`).join('')}</div>`:''}`;
    const ready=clip.stemState==='ready';
    const stemLevel=key=>window.AxiomAutomationRecorder?.live(activeProject,{scope:'clip',targetId:clip.id,parameter:'stemGain_'+key})??clip['stemGain_'+key]??1;
    panel.querySelectorAll('.daw-stem-buttons button').forEach((button,index)=>{
      if(index>=4) return;
      const [name,,key]=stems[index];
      button.disabled=!ready;
      button.setAttribute('aria-label',`${name} stem ${ready?'toggle':'unavailable'}`);
      button.setAttribute('aria-pressed',String(stemLevel(key)>0));
      button.title=ready?`Mute/unmute ${name}`:`Separate this clip to enable ${name}`;
      button.onclick=()=>{window.AxiomStems.setGain(clip,key,stemLevel(key)>0?0:1);renderContextPanel();};
      button.oncontextmenu=event=>{event.preventDefault();event.stopPropagation();window.AxiomDawAutomation?.edit([{scope:'clip',targetId:clip.id}],`stemGain_${key}`);};
    });
    panel.querySelectorAll('.daw-stem-levels input').forEach((input,index)=>{
      input.disabled=!ready; input.value=stemLevel(stems[index][2]);
      input.oncontextmenu=event=>{event.preventDefault();event.stopPropagation();window.AxiomDawAutomation?.edit([{scope:'clip',targetId:clip.id}],`stemGain_${stems[index][2]}`);};
      input.oninput=()=>window.AxiomStems.setGain(clip,stems[index][2],Number(input.value));
      input.onpointerdown=()=>window.AxiomMixerHistory?.begin(activeProject);
      input.onchange=input.onpointerup=input.onblur=()=>window.AxiomMixerHistory?.finish();
      input.onpointercancel=()=>{window.AxiomMixerHistory?.finish(true);window.AxiomStems?.stop();renderContextPanel();};
    });
    const action=document.createElement('button');
    action.type='button'; action.className='daw-separate-clip';
    const separating=clip.stemState==='processing';
    action.textContent=separating?(clip.stemCancelRequested?'Cancelling...':'Cancel Separation'):ready?'Play Stems':'Create Stems';
    action.disabled=separating&&Boolean(clip.stemCancelRequested);
    action.onclick=()=>separating?window.AxiomStems.cancel(clip):ready?window.AxiomStems.play(clip):window.AxiomStems.request(clip);
    if(separating){
      const detail=document.createElement('small');detail.className='daw-stem-progress';detail.setAttribute('role','status');
      detail.dataset.stemClip=clip.id;detail.innerHTML=stemProgressMarkup(clip);
      panel.appendChild(detail);
    }
    panel.appendChild(action);
  }

  function toggleStemLevels() {
    const clip = selectedArrangementClip();
    if (!clip) return;
    clip.stemLevelsExpanded = !clip.stemLevelsExpanded;
    renderContextPanel();
  }

  function setInspectorParam(param, rawValue, preview = false) {
    const clip = selectedArrangementClip();
    if (!clip) return false;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return false;
    const simpleParams = new Set(['fadeInBeats','fadeOutBeats','mixGainDb','mixLowDb','mixMidDb','mixHighDb']);
    if (simpleParams.has(param)) return writeParameters([{ id: clip.id, key: param, value }], { keepPendingSnap: preview });
    if (param !== 'mixFilterPosition') return false;
    const ref = { scope: 'clip', targetId: clip.id, parameter: 'filterPosition' };
    const lanes = (activeProject.automationLanes || []).filter(lane => !(lane.scope === ref.scope && lane.targetId === ref.targetId && lane.parameter === ref.parameter));
    if (Math.abs(value) > .001) {
      const lane = window.AxiomDawAutomation?.normalize?.({ ...ref, enabled: true, points: [{ beat: 0, value, curve: 'hold' }] }) || { ...ref, enabled: true, points: [{ beat: 0, value, curve: 'hold' }] };
      lanes.push(lane);
    }
    return writeParameters([{ id: clip.id, key: 'mixFilterPosition', value }, { key: 'automationLanes', value: lanes }], { keepPendingSnap: preview });
  }

  function knobConfig(button) {
    const min = Number(button?.dataset?.knobMin);
    const max = Number(button?.dataset?.knobMax);
    const step = Number(button?.dataset?.knobStep) || 1;
    const polarity = Number(button?.dataset?.knobPolarity) || 1;
    return { min, max, step, polarity, param: button?.dataset?.knobParam || '', suffix: button?.dataset?.knobSuffix || '' };
  }

  function snapKnobValue(value, { min, max, step }) {
    if (!Number.isFinite(value)) value = min;
    const snapped = step > 0 ? Math.round(value / step) * step : value;
    return Math.max(min, Math.min(max, Math.round(snapped * 1000) / 1000));
  }

  function updateInspectorKnob(button, value) {
    const config = knobConfig(button);
    const safe = snapKnobValue(value, config);
    const label = button.closest('.daw-inspector-knob');
    const output = label?.querySelector('output');
    const ratio = inspectorKnobRatio(safe, config.min, config.max);
    label?.style.setProperty('--knob-ratio', String(Math.max(0, Math.min(1, ratio))));
    button.setAttribute('aria-valuenow', String(safe));
    if (output) output.textContent = config.suffix ? `${Math.round(safe * 10) / 10}${config.suffix}` : `${Math.round(safe * 100) / 100}`;
    return safe;
  }

  function dragInspectorKnob(event) {
    const button = event?.currentTarget;
    if (!button || button.disabled || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const config = knobConfig(button);
    const startValue = snapKnobValue(Number(button.getAttribute('aria-valuenow')), config);
    const startY = event.clientY;
    const sensitivity = (config.max - config.min || 1) / 150;
    button.setPointerCapture?.(event.pointerId);
    const move = pointerEvent => {
      pointerEvent.preventDefault?.();
      updateInspectorKnob(button, startValue + (startY - pointerEvent.clientY) * sensitivity);
    };
    const finish = pointerEvent => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', finish, true);
      button.releasePointerCapture?.(event.pointerId);
      const finalValue = snapKnobValue(Number(button.getAttribute('aria-valuenow')), config);
      if (pointerEvent.type === 'pointercancel') return renderInspector();
      setInspectorParam(config.param, finalValue * config.polarity);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', finish, true);
  }

  function keyInspectorKnob(event) {
    const button = event?.currentTarget;
    if (!button || button.disabled || !['ArrowUp','ArrowRight','ArrowDown','ArrowLeft','Home','End'].includes(event.key)) return true;
    event.preventDefault();
    event.stopPropagation();
    const config = knobConfig(button);
    const current = snapKnobValue(Number(button.getAttribute('aria-valuenow')), config);
    const delta = (event.key === 'ArrowUp' || event.key === 'ArrowRight') ? config.step : (event.key === 'ArrowDown' || event.key === 'ArrowLeft') ? -config.step : 0;
    const next = event.key === 'Home' ? config.min : event.key === 'End' ? config.max : current + delta;
    const value = updateInspectorKnob(button, next);
    setInspectorParam(config.param, value * config.polarity);
    return false;
  }

  function setStemInspectorGain(stem, rawValue, preview = false) {
    const clip = selectedArrangementClip();
    const value = Number(rawValue);
    if (!clip || !Number.isFinite(value)) return false;
    window.AxiomStems?.setGain?.(clip, stem, Math.max(0, Math.min(2, value)));
    if (!preview) renderInspector();
    return true;
  }

  function toggleStemInspectorGain(stem) {
    const clip = selectedArrangementClip();
    if (!clip) return false;
    const key = `stemGain_${stem}`;
    const next = Number(clip[key] ?? 1) > 0 ? 0 : 1;
    setStemInspectorGain(stem, next);
    renderContextPanel();
    return true;
  }

  function openInspectorAutomation(parameter = 'volume') {
    const clip = selectedArrangementClip();
    if (!clip) return false;
    window.AxiomDawAutomation?.edit?.([{ scope: 'clip', targetId: clip.id }], parameter);
    return true;
  }

  function syncInspectorKey() {
    const clip = selectedArrangementClip();
    if (!clip) {
      window.showToast?.('Select an incoming clip first, then sync it to the anchor key.', true);
      return false;
    }
    mixerSelection.clear();
    mixerSelection.add(clip.id);
    updateKeySyncControl();
    return toggleKeySync();
  }

  function inspectorStemAction() {
    const clip = selectedArrangementClip();
    if (!clip) return false;
    if (clip.stemState === 'processing') return window.AxiomStems?.cancel?.(clip);
    if (clip.stemState === 'ready' && clip.stemJob) return window.AxiomStems?.play?.(clip, selectedClipPointerRatio || 0);
    return window.AxiomStems?.request?.(clip);
  }

  function waveformSeed(track, index = 0) {
    const source = `${track?.title || ''}${track?.artist || ''}${track?.path || ''}${index}`;
    let hash = 0;
    for (let charIndex = 0; charIndex < source.length; charIndex += 1) {
      hash = ((hash << 5) - hash + source.charCodeAt(charIndex)) | 0;
    }
    return Math.abs(hash) || 1;
  }

  function waveformColor(track, index = 0) {
    const palette = ['#78f05a', '#f06b49', '#54d9ff', '#f9d65c', '#c47bff', '#ff5f9e'];
    const genre = String(track?.genre || track?.energy || '').toLowerCase();
    if (genre.includes('rnb') || genre.includes('soul')) return '#78f05a';
    if (genre.includes('latin') || genre.includes('dancehall') || genre.includes('global')) return '#f06b49';
    if (genre.includes('electronic') || genre.includes('house')) return '#54d9ff';
    if (genre.includes('utility') || genre.includes('sfx')) return '#f9d65c';
    return palette[waveformSeed(track, index) % palette.length];
  }

  function renderWaveformBars(track, options = {}) {
    if (!track?.path) return '';
    const start=track.sourceStartBeat || 0;
    const duration=track.sourceDurationBeats ? secondsFromBeat(track,start+track.sourceDurationBeats)-secondsFromBeat(track,start) : 0;
    const grid=track.beatgrid ? ` data-wave-grid="${escapeHtml(JSON.stringify(track.beatgrid))}" data-source-beat="${start}" data-source-beats="${track.sourceDurationBeats || 0}"` : '';
    const stemMix = ['vocals','drums','bass','other'].map(name => Math.max(0, Math.min(2, Number(track[`stemGain_${name}`] ?? 1))));
    const hasStemMix = track.stemState === 'ready' || track.stemJob || stemMix.some(value => Math.abs(value - 1) > 0.01);
    const stemAttr = hasStemMix ? ` data-wave-stem-mix="${escapeHtml(JSON.stringify(stemMix))}"` : '';
    const reverseAttr = track.reversed ? ' data-wave-reversed="true"' : '';
    const classes = `daw-audio-wave${hasStemMix ? ' daw-stem-aware-wave' : ''}`;
    return `<canvas class="${classes}" data-wave-path="${escapeHtml(track.path)}" data-wave-start="${secondsFromBeat(track,start)}" data-wave-duration="${duration}"${grid}${stemAttr}${reverseAttr} aria-label="${track.reversed ? 'Reversed audio waveform' : hasStemMix ? 'Stem-aware audio waveform' : 'Audio waveform'}"></canvas>`;
  }

  const scaffoldLaneClips = {
    samples: [
      { label: 'Vocal Chop 14', left: 8, width: 20 },
      { label: 'Vocal Chop 2', left: 30, width: 18 },
      { label: 'Horn Stab', left: 62, width: 22 },
      { label: 'Impact 07', left: 86, width: 12 },
    ],
    fx: [
      { label: 'Sweep Up 02', left: 20, width: 24 },
      { label: 'Noise Down 03', left: 58, width: 24 },
    ],
    recordings: [
      { label: 'Scratch Take 03', left: 14, width: 22 },
      { label: 'Mic Vox 02', left: 54, width: 32 },
    ],
    instruments: [
      { label: 'Drums 01', left: 3, width: 94 },
    ],
  };

  function renderScaffoldLaneClips(sectionId) {
    if(sectionId==='fx' && window.AxiomDawFx) return window.AxiomDawFx.render(activeProject,viewStartBeat,viewBeats || timelineWorkspaceBeats());
    if (sectionId === 'instruments') {
      if(window.AxiomPatterns){const span=viewBeats||timelineWorkspaceBeats();return window.AxiomPatterns.list(activeProject).map(c=>{
        const start=Math.max(c.startBeat,viewStartBeat),end=Math.min(c.startBeat+c.durationBeats,viewStartBeat+span);if(end<=start)return '';
        return `<article class="studio-daw-clip daw-pattern-clip" role="button" tabindex="0" aria-label="Select pattern ${escapeHtml(c.name)}" style="left:${(start-viewStartBeat)/span*100}%;width:${(end-start)/span*100}%" onpointerdown="AxiomPatterns.drag(event,'${c.id}')" onclick="event.stopPropagation();AxiomStudioDaw.selectPattern('${c.id}')" ondblclick="AxiomPatterns.edit('${c.id}')" oncontextmenu="event.preventDefault();AxiomPatterns.edit('${c.id}')"><strong>${escapeHtml(c.name)}</strong>${start===c.startBeat?`<button class="daw-trim-handle left" aria-label="Resize pattern start" title="Resize pattern start" onpointerdown="AxiomPatterns.drag(event,'${c.id}','left')" onclick="event.stopPropagation()"></button>`:''}${end===c.startBeat+c.durationBeats?`<button class="daw-trim-handle right" aria-label="Resize pattern end" title="Resize pattern end" onpointerdown="AxiomPatterns.drag(event,'${c.id}','right')" onclick="event.stopPropagation()"></button>`:''}</article>`;
      }).join('');}
      return '<article class="studio-daw-clip daw-pattern-clip" style="left:1%;width:98%" onclick="AxiomStudioDaw.selectSection(\'instruments\')"><strong>Drums 01</strong><div class="daw-pattern-preview"></div></article>';
    }
    if (shellReference && sectionId === 'fx') {
      return '<article class="studio-daw-clip daw-fx-preview" style="left:9%;width:22%" title="Reference preview: automation curve"><strong>Sweep Up 02</strong><canvas data-fx-curve="up"></canvas></article><article class="studio-daw-clip daw-fx-preview" style="left:56%;width:20%" title="Reference preview: automation curve"><strong>Noise Down 03</strong><canvas data-fx-curve="down"></canvas></article>';
    }
    return '';
  }

  const layeredArrangementSections = new Set(['samples', 'fx', 'recordings', 'instruments']);

  function takeColour(clip){
    const colour=clip.recordingInfo?.takeColour;
    return /^#[0-9a-f]{6}$/i.test(colour||'')?colour:'';
  }

  function renderLayerOverview(section, clips, layers, totalBeats) {
    if (!clips.length || layers.length <= 1) return '';
    const layerLabel = `${layers.length} ${layers.length === 1 ? 'layer' : 'layers'}`;
    return `<div class="daw-layer-overview daw-${escapeHtml(section.id)}-overview" style="--sample-layer-count:${layers.length}" aria-label="${escapeHtml(section.label)}: ${layerLabel}">
      <strong>${escapeHtml(section.label)} <small>${escapeHtml(layerLabel)}</small></strong>
      ${clips.map(item => {
        const start = Math.max(viewStartBeat, item.timelineStartBeat);
        const end = Math.min(viewStartBeat + totalBeats, item.timelineStartBeat + item.timelineDurationBeats);
        if (end <= start) return '';
        const layer = layers.indexOf(item.layerIndex || 0);
        return `<button type="button" class="daw-sample-summary-block daw-layer-summary-block" data-sample-summary-id="${escapeHtml(item.id)}" data-take-colour="${takeColour(item)}" style="left:${(start - viewStartBeat) / totalBeats * 100}%;width:${(end - start) / totalBeats * 100}%;--summary-layer:${layer};--take-colour:${takeColour(item)||'transparent'}" aria-label="Expand ${escapeHtml(section.label)}: ${escapeHtml(item.label || item.title)}, layer ${layer + 1}" title="${escapeHtml(item.label || item.title)}" onclick="event.stopPropagation();AxiomStudioDaw.selectSection('${escapeHtml(section.id)}')"></button>`;
      }).join('')}
    </div>`;
  }

  function showReferencePreview() {
    if (!['localhost', '127.0.0.1'].includes(location.hostname) || !new URLSearchParams(location.search).has('composer_reference') || !activeProject) return;
    if(activeProject.localDraftId||referenceExcludedProjects.has(activeProject))return;
    const tracks = projectTracks();
    const first = tracks.find(track => track.title.toLowerCase().includes('call on me')) || tracks[0];
    const second = tracks.find(track => track.path !== first.path) || first;
    const duration = beatsFromTrackDuration(first);
    activeProject.title = `${first.title} Edit`;
    activeProject.sourceTrack = first;
    activeProject.automationLanes = [{scope:'project',parameter:'bpm',points:[{beat:0,value:first.bpm,curve:'linear'}]}];
    activeProject.markers = defaultMarkersForTrack(first, 8);
    activeProject.arrangementClips = [makeArrangementClip(first, { sectionId:'left-deck', sourceDurationBeats:duration, timelineDurationBeats:duration, label:'Intro' }), makeArrangementClip(second, { sectionId:'right-deck', trackIndex:1, sourceDurationBeats:Math.min(duration,beatsFromTrackDuration(second)), timelineDurationBeats:duration, label:'Intro' })];
    const excerpts = [
      ['samples',.01,.15,'Excerpt 01'],['samples',.19,.22,'Excerpt 02'],['samples',.45,.17,'Excerpt 03'],['samples',.65,.20,'Excerpt 04'],['samples',.88,.11,'Excerpt 05'],
      ['recordings',.04,.20,'Audio take 01'],['recordings',.52,.30,'Audio take 02']
    ];
    excerpts.forEach(([sectionId,start,length,label]) => activeProject.arrangementClips.push(makeArrangementClip(first, { sectionId, label, timelineStartBeat:start*duration, timelineDurationBeats:length*duration, sourceStartBeat:start*duration, sourceDurationBeats:length*duration })));
    selectedClipId = activeProject.arrangementClips[0].id;
    activeSectionId = 'instruments';
    shellReference = true;
    renderShell('track');
  }
  let shellReference = false;

  function projectTracks() {
    return activeProject?.sourceTracks?.length ? activeProject.sourceTracks : [activeProject?.sourceTrack].filter(Boolean);
  }

  function renderArrangementOverview() {
    const overview = document.getElementById('studio-daw-arrangement-overview');
    if (!overview || !activeProject) return;
    const clips = ensureArrangementClips(activeProject);
    const totalBeats = arrangementLengthBeats(activeProject);
    overview.innerHTML = `
      <div class="studio-daw-overview-window"></div>
      ${clips.map((clip, index) => `
        <span class="studio-daw-overview-clip" style="left:${timelinePercent((clip.timelineStartBeat / totalBeats) * 100)}%;width:${timelinePercent(Math.max(4, (clip.timelineDurationBeats / totalBeats) * 100))}%;--wave:${waveformColor(clip, index)}">
          ${renderWaveformBars(clip, { count: 16, index })}
        </span>
      `).join('')}
    `;
  }

  function arrangementGridStep(span) {
    return span <= 64 ? 2 ** Math.floor(Math.log2(span / 16)) : 4 * 2 ** Math.ceil(Math.log2(Math.max(1, span / 1024)));
  }

  function timelinePercent(value) {
    const percent = Number(value);
    if (!Number.isFinite(percent)) return '0';
    return percent.toFixed(5).replace(/\.?0+$/, '');
  }

  function arrangementBarLabel(beat) {
    const bar = Math.floor(beat / 4) + 1, fraction = beat / 4 - Math.floor(beat / 4);
    if (fraction === 0) return `BAR ${bar}`;
    let denominator = 2;
    while (denominator < 4096 && !Number.isInteger(fraction * denominator)) denominator *= 2;
    return `${bar} + ${Math.round(fraction * denominator)}/${denominator}`;
  }

  function renderRuler() {
    const ruler = document.getElementById('studio-daw-ruler');
    if (!ruler) return;
    const span = viewBeats || timelineWorkspaceBeats(activeProject);
    const step = Math.max(arrangementGridStep(span), 2 ** Math.ceil(Math.log2(span * 88 / (ruler.clientWidth || 1024))));
    const ticks=new Set();
    for(let beat=Math.ceil(viewStartBeat/step)*step;beat<viewStartBeat+span;beat+=step)ticks.add(beat);
    ruler.innerHTML = '';
    for (const beat of [...ticks].sort((a,b)=>a-b)) {
      const bar = Math.floor(beat / 4) + 1;
      const pulse = Math.floor(beat % 4) + 1;
      const division = span <= 1 ? String(Math.round((beat % 1) * 960)).padStart(3,'0') : Math.floor((beat % 1) * 4) + 1;
      const phrase=beat%32===0;
      const leftPercent = (beat - viewStartBeat) / span * 100;
      const edgeGuard = leftPercent > 96 ? ';transform:translateX(-100%);padding-left:0;padding-right:4px;text-align:right' : '';
      ruler.innerHTML += `<span class="${phrase?'daw-phrase-label':''}" style="position:absolute;left:${leftPercent}%${edgeGuard}" data-ruler-beat="${beat}" data-beat-label="${bar}.${pulse}.${division}" ${phrase?`data-phrase-bar="${bar}" title="Bar ${bar}: start of an 8-bar section"`:''}>${arrangementBarLabel(beat)}</span>`;
    }
  }

  function renderMarkers() {
    const markers = document.getElementById('studio-daw-markers');
    if (!markers) return;
    const totalBeats = arrangementLengthBeats(activeProject);
    markers.title = 'Right-click an empty position to add a label marker';
    markers.oncontextmenu = addNoteMarker;
    markers.innerHTML = visibleProjectMarkers().map((marker) => {
      const index = activeProject.markers.indexOf(marker);
      return `
      <button type="button" title="Click to rename, delete or play from this marker" aria-label="${escapeHtml(marker.label)} marker at bar ${Math.floor(Number(marker.beat || 0) / 4) + 1}" data-marker-role="${escapeHtml(marker.role || 'label')}" class="studio-daw-marker marker-${escapeHtml(marker.role || 'label')}${index === activeMarkerIndex ? ' active' : ''}" style="left:${(marker.beat / totalBeats) * 100}%" onclick="return AxiomStudioDaw.markerActions(event, ${index})" oncontextmenu="return AxiomStudioDaw.markerActions(event, ${index})">
        ${escapeHtml(marker.label)}
      </button>
    `;}).join('');
  }

  function renderLanes() {
    const lanes = document.getElementById('studio-daw-lanes');
    if (!lanes) return;
    const masterStrip = document.getElementById('studio-daw-master-strip');
    const clips = ensureArrangementClips(activeProject);
    const totalBeats = viewBeats || timelineWorkspaceBeats(activeProject);
    renderRuler();
    lanes.dataset.viewStart=String(viewStartBeat);lanes.dataset.viewBeats=String(totalBeats);
    renderBpmLane();
    const playingPath = currentStudioDawPlayingPath();
    const bpm = Math.round(activeProject.sourceTrack.bpm);
    const masterClip = `
      <section class="studio-daw-lane studio-daw-master-lane${activeSectionId === 'master' ? ' active' : ''}" data-daw-section="master" aria-label="Master clip lane">
        <div class="studio-daw-lane-body">
          <article class="studio-daw-clip studio-daw-master-clip${activeSectionId === 'master' ? ' selected' : ''}" role="button" tabindex="0" style="left:0; width:calc(100% - 12px)" onclick="AxiomStudioDaw.openMasterClip()" onkeydown="AxiomStudioDaw.handleSectionKeydown(event, 'master')">
            <div class="studio-daw-master-copy">
              <small>Master Clip · Open</small>
              <strong>${escapeHtml(activeProject.title || 'Studio DAW Project')}</strong>
            </div>
            <div class="studio-daw-master-editor">
              <div class="studio-daw-master-waveform">
                <canvas class="daw-rendered-master" data-master-render data-total-beats="${arrangementLengthBeats(activeProject)}" hidden></canvas>
                <canvas class="daw-live-master" data-live-master data-total-beats="${arrangementLengthBeats(activeProject)}" aria-label="Live mix waveform"></canvas>
              </div>
              <div class="studio-daw-master-automation" data-total-beats="${totalBeats}" data-view-start="${viewStartBeat}" aria-label="Project BPM automation" onclick="AxiomStudioDaw.addBpmPoint(event)">
                ${bpmAutomation(false).points.map((point,index)=>point.beat<viewStartBeat||point.beat>viewStartBeat+totalBeats?'':`<span style="left:${(point.beat-viewStartBeat)/totalBeats*100}%;top:${(400-point.value)/380*100}%"><button type="button" data-bpm-index="${index}" aria-pressed="${selectedBpmPoint===index}" aria-label="BPM marker ${index+1}: ${point.value}" title="${escapeHtml(bpmPointTitle(point))}" onclick="AxiomStudioDaw.selectBpmPoint(event,${index})" oncontextmenu="return AxiomStudioDaw.openBpmMenu(event,${index})" onpointerdown="AxiomStudioDaw.dragBpmPoint(event,${index})">${Math.round(point.value*100)/100}</button></span>`).join('')}
              </div>
            </div>
          </article>
        </div>
      </section>
    `;
    const sectionLanes = arrangementSections.map(section => {
      const deckClips = clips.filter(clip => clip.sectionId === section.id);
      const sampleLayers=[...new Set(deckClips.map(clip=>clip.layerIndex || 0))].sort((a,b)=>a-b);
      const compactLayeredSection = layeredArrangementSections.has(section.id) && activeSectionId !== section.id && sampleLayers.length > 1;
      let clip = compactLayeredSection ? renderLayerOverview(section, deckClips, sampleLayers, totalBeats) : deckClips.length
        ? deckClips.map((clip, index) => {
            const visibleStart = Math.max(viewStartBeat, clip.timelineStartBeat);
            const visibleEnd = Math.min(viewStartBeat + totalBeats, clip.timelineStartBeat + clip.timelineDurationBeats);
            if (visibleEnd <= visibleStart) return '';
            const isPlaying = Boolean(clip.path && clip.path === playingPath && selectedClipId === clip.id);
            const width = ((visibleEnd - visibleStart) / totalBeats) * 100;
            const left = ((visibleStart - viewStartBeat) / totalBeats) * 100;
            const sourceScale = clip.sourceDurationBeats / clip.timelineDurationBeats;
            const visibleWave = { ...clip, sourceStartBeat: clip.sourceStartBeat + (clip.reversed?clip.timelineStartBeat+clip.timelineDurationBeats-visibleEnd:visibleStart-clip.timelineStartBeat) * sourceScale, sourceDurationBeats: (visibleEnd-visibleStart) * sourceScale };
            const isAnchorClip = ['left-deck', 'right-deck'].includes(section.id) && (clip.transitionAnchor || activeProject.anchorPath === clip.path);
            return `
              <article
                class="studio-daw-clip${isPlaying ? ' playing-track' : ''}${mixerSelection.has(clip.id) ? ' selected' : ''}${isAnchorClip ? ' daw-anchor-clip' : ''}${clip.reversed ? ' daw-reversed-clip' : ''}"
                style="left:${timelinePercent(left)}%; width:${timelinePercent(width)}%; --layer-index:${activeSectionId===section.id ? clip.layerIndex || 0 : 0};--take-colour:${takeColour(clip)||'transparent'}"
                data-take-colour="${takeColour(clip)}"
                draggable="true"
                ondragstart="AxiomStudioDaw.dragClip(event, '${escapeHtml(clip.id)}')"
                role="button"
                tabindex="0"
                data-path="${escapeHtml(clip.path)}"
                data-daw-clip-id="${escapeHtml(clip.id)}"
                data-daw-anchor="${isAnchorClip ? 'true' : 'false'}"
                data-daw-reversed="${clip.reversed ? 'true' : 'false'}"
                data-daw-track-index="${clip.trackIndex}"
                data-visible-start-ratio="${(visibleStart-clip.timelineStartBeat)/clip.timelineDurationBeats}"
                data-visible-duration-ratio="${(visibleEnd-visibleStart)/clip.timelineDurationBeats}"
                aria-label="Select ${escapeHtml(clip.label)} from ${escapeHtml(clip.title)} in Studio DAW"
                onclick="return AxiomStudioDaw.selectAtPointer('${escapeHtml(clip.id)}', event)"
                ondblclick="return AxiomStudioDaw.playClip('${escapeHtml(clip.id)}', event)"
                oncontextmenu="return AxiomStudioDaw.openClipMenu(event, '${escapeHtml(clip.id)}')"
                onkeydown="return AxiomStudioDaw.handleClipKeydown(event, '${escapeHtml(clip.id)}')"
              >
                <span class="daw-clip-timing-border" aria-hidden="true"></span>
                ${Math.abs(visibleStart-clip.timelineStartBeat)<1e-8?`<button type="button" class="daw-trim-handle left" aria-label="Trim clip start" title="Drag to reveal or trim earlier audio" onpointerdown="AxiomStudioDaw.dragTrim(event,'${escapeHtml(clip.id)}','left')" onkeydown="AxiomStudioDaw.trimKey(event,'${escapeHtml(clip.id)}','left')" onclick="event.stopPropagation()" ondblclick="event.stopPropagation()"></button>`:''}
                ${Math.abs(visibleEnd-clip.timelineStartBeat-clip.timelineDurationBeats)<1e-8?`<button type="button" class="daw-trim-handle right" aria-label="Trim clip end" title="Drag to reveal or trim later audio" onpointerdown="AxiomStudioDaw.dragTrim(event,'${escapeHtml(clip.id)}','right')" onkeydown="AxiomStudioDaw.trimKey(event,'${escapeHtml(clip.id)}','right')" onclick="event.stopPropagation()" ondblclick="event.stopPropagation()"></button>`:''}
                <div class="studio-daw-clip-waveform" aria-hidden="true">${renderWaveformBars(visibleWave)}</div>
                ${renderFadeHandles(clip,visibleStart,visibleEnd)}
                <strong>${escapeHtml(shellReference && !section.id.endsWith('deck') ? clip.label : clip.title)}</strong>
                ${isAnchorClip ? '<em class="daw-anchor-pill">Anchor</em>' : ''}
                ${clip.reversed ? '<em class="daw-reverse-pill">REV</em>' : ''}
                <small title="${escapeHtml(clip.importAnalysis?.message||'')}">${clip.importAnalysis&&['queued','running'].includes(clip.importAnalysis.state)?'Checking BPM / key…':clip.importAnalysis?.state==='needs_review'?'BPM / key needs review':escapeHtml(clip.label === clip.title ? 'Intro' : clip.label)}${clip.reversed?' · Reverse':''}${clip.repeatCount > 1 ? ` · x${clip.repeatCount}` : ''}</small>
                ${renderClipCues(clip,visibleStart,visibleEnd)}
                ${section.id.endsWith('deck') ? `<div class="daw-clip-markers">${visibleProjectMarkers().filter(marker => marker.beat >= visibleStart && marker.beat < visibleEnd).map(marker => `<span class="marker-${escapeHtml(marker.role || 'label')}" data-marker-role="${escapeHtml(marker.role || 'label')}" style="left:${(marker.beat-visibleStart)/(visibleEnd-visibleStart)*100}%">${escapeHtml(marker.label)}</span>`).join('')}</div>` : ''}
              </article>
            `;
          }).join('')
        : renderScaffoldLaneClips(section.id);
      if(section.id==='fx'&&deckClips.length)clip+=renderScaffoldLaneClips(section.id);
      return `
        <section class="studio-daw-lane${activeSectionId === section.id ? ' active' : ''}" style="--layer-count:${layerCount(section.id)};--lane-custom-colour:${laneColour(section.id)}" data-custom-colour="${Boolean(laneColour(section.id))}" data-daw-section="${escapeHtml(section.id)}" aria-label="${escapeHtml(section.label)} lane" onclick="AxiomStudioDaw.positionLane(event, '${escapeHtml(section.id)}')" ondragover="AxiomStudioDaw.dragOverLane(event, '${escapeHtml(section.id)}')" ondrop="AxiomStudioDaw.dropClip(event, '${escapeHtml(section.id)}')">
          <div class="studio-daw-lane-body">${section.id==='samples'&&activeSectionId==='samples'?Array.from({length:layerCount('samples')},(_,index)=>`<div class="daw-sample-layer-row" style="--layer-index:${index}" aria-label="Sample layer ${index+1}"><button type="button" title="Add audio to sample layer ${index+1}" aria-label="Add audio to sample layer ${index+1}" onclick="AxiomStudioDaw.chooseSampleLayer(${index},event)"><img src="/static/icons/folder-open.svg" alt=""></button></div>`).join(''):''}${clip}</div>
        </section>
      `;
    }).join('');
    if (masterStrip&&masterMarkup.get(masterStrip)!==masterClip){masterStrip.innerHTML=masterClip;masterMarkup.set(masterStrip,masterClip);}
    const displayStep=arrangementGridStep(totalBeats);
    let grid = '<div class="daw-musical-grid" aria-hidden="true">';
    for (let beat = Math.ceil(viewStartBeat/displayStep)*displayStep; beat < viewStartBeat+totalBeats; beat += displayStep) {
      grid += `<i class="${beat % 4 === 0 ? 'bar-line' : beat % 2 === 0 ? 'half-bar-line' : Number.isInteger(beat) ? 'beat-line' : ''}" data-grid-beat="${beat}" style="left:${(beat-viewStartBeat)/totalBeats*100}%"></i>`;
    }
    const selected = selectedArrangementClip();
    const playheadBeat = activeProject.editCursorBeat ?? (selected ? selected.timelineStartBeat + selected.timelineDurationBeats * selectedClipPointerRatio : 0);
    let phrases='<div class="daw-phrase-grid" aria-hidden="true">';
    const phraseStep=32*Math.max(1,Math.ceil(totalBeats/32/256));
    for(let beat=Math.ceil(viewStartBeat/phraseStep)*phraseStep;beat<viewStartBeat+totalBeats;beat+=phraseStep)
      phrases+=`<i data-phrase-bar="${beat/4+1}" style="left:${(beat-viewStartBeat)/totalBeats*100}%"></i>`;
    lanes.innerHTML = grid + '</div>'+phrases+`</div><div class="studio-daw-playhead" style="left:${Math.max(0,Math.min(100,(playheadBeat-viewStartBeat)/totalBeats*100))}%" aria-hidden="true"></div>` + sectionLanes;
    paintRange();
    window.AxiomSteadyTiming?.render();
    refreshDeckMixer();
    window.AxiomDawTimelineRecording?.renderPreview();
    window.AxiomProducerTips?.consider(activeProject);
  }

  function renderStepEditor() {
    const editor = document.getElementById('studio-daw-step-editor');
    if (!editor) return;
    editor.classList.remove('daw-note-editor');
    editor.classList.remove('daw-drum-editor');
    editor.classList.toggle('daw-clip-editor',clipEditorOpen);
    if(clipEditorOpen && selectedArrangementClip()) {
      const clip=selectedArrangementClip();
      if(sourceStartGesture?.project===activeProject&&sourceStartGesture.clip===clip)return;
      const html=`<header><strong>${escapeHtml(clip.title)}</strong><button type="button" title="Return to drums" aria-label="Close clip editor" onclick="AxiomStudioDaw.selectSection('instruments')">&times;</button></header>${renderSourceDetail()}`;
      const signature=JSON.stringify([html,clip.bpm,clip.stemState,clip.fluidSync,gridEditMode,beatCorrectionMode,selectedClipPointerRatio]);
      const controls=JSON.stringify([clip.title,clip.path,clip.bpm,clip.stemState,clip.fluidSync,clip.beatgrid?.source,Boolean(clip.beatgrid),gridEditMode,beatCorrectionMode]);
      const previous=sourceEditorMarkup.get(editor);
      if(previous?.clip===clip&&previous.signature===signature)return;
      const detail=editor.querySelector('.daw-source-detail');
      if(previous?.clip===clip&&previous.controls===controls&&detail){
        const template=document.createElement('template');template.innerHTML=html;
        const next=template.content.querySelector('.daw-source-detail');
        const canvas=detail.querySelector('canvas[data-wave-path]'),replacement=next.querySelector('canvas[data-wave-path]');
        if(canvas&&replacement){
          for(const attribute of [...canvas.attributes])if(!replacement.hasAttribute(attribute.name)&&attribute.name!=='width'&&attribute.name!=='height')canvas.removeAttribute(attribute.name);
          for(const attribute of replacement.attributes)canvas.setAttribute(attribute.name,attribute.value);
          replacement.replaceWith(canvas);
        }
        // Retain the wheel target, canvas and toolbar while changing the viewport.
        detail.replaceChildren(...next.childNodes);
        sourceEditorMarkup.set(editor,{clip,signature,controls});
        paintEditCursor(clip);
        if(canvas)window.AxiomWaveformDetail?.renderCanvas?.(canvas);
        return;
      }
      const moreToolsOpen=Boolean(editor.querySelector('.daw-source-more')?.open);
      editor.innerHTML=html;
      const moreTools=editor.querySelector('.daw-source-more');
      if(moreTools)moreTools.open=moreToolsOpen||gridEditMode;
      const toolbar=editor.querySelector('.daw-source-zoom');
      if(toolbar){
        const gridGroup = toolbar.querySelector('[data-source-group="grid"]') || toolbar;
        const importGroup = toolbar.querySelector('[data-source-group="import"]') || toolbar;
        const output=document.createElement('output');output.className='daw-source-tempo';output.setAttribute('aria-label','Source tempo at cursor');
        try{
          const grid=existing.trackGrid(clip),beat=sourceCueBeat(clip);
          const bpm=grid?grid.bpmAtBeat(beat):Number(clip.bpm||120);
          output.textContent=`${bpm.toFixed(3)} BPM`;
          output.title=grid?`Source grid tempo at cursor (${clip.beatgrid.source})`:'Fixed source BPM fallback; no imported grid';
        }catch(error){output.textContent='Invalid grid';output.title=error.message;}
        gridGroup.appendChild(output);
        const edit=document.createElement('button');edit.type='button';edit.textContent='Edit Grid';edit.setAttribute('aria-pressed',String(gridEditMode));edit.title='Place the cursor on transients; nearby grid lines attract it. Alt bypasses snapping; Shift snaps to the nearest line. Drag beat anchors to correct the grid.';edit.onclick=toggleGridEditing;gridGroup.appendChild(edit);
        const peak=document.createElement('button');peak.type='button';peak.textContent='Find Peak';peak.title='Place the cursor at the strongest waveform peak in the visible source range; does not detect or change beats';peak.onclick=findSourcePeak;gridGroup.appendChild(peak);
        const mode=document.createElement('select');mode.setAttribute('aria-label','Beat correction mode');mode.title='Keep later anchors fixed, or shift them together to preserve later tempos';
        for(const [value,label] of [['fixed','Keep later anchors'],['shift','Shift later anchors'],['pinned','Pin neighbouring beats']]){const option=document.createElement('option');option.value=value;option.textContent=label;mode.appendChild(option);}
        mode.value=beatCorrectionMode;mode.onchange=()=>{beatCorrectionMode=mode.value;};gridGroup.appendChild(mode);
        const beat=document.createElement('input');beat.type='number';beat.step='1';beat.id='daw-source-beat-number';beat.setAttribute('aria-label','Source beat number');beat.title='Source beat number: 0 is the first downbeat, 4 is bar 2';beat.value=String(Math.round(clip.sourceStartBeat+selectedClipPointerRatio*clip.sourceDurationBeats));beat.style.cssText='width:72px;background:#252925;color:#eee;border:1px solid #525852';gridGroup.appendChild(beat);
        const button=document.createElement('button');button.type='button';button.textContent='Set Beat Here';button.title='Align a numbered source beat to the waveform cursor';button.onclick=()=>setSourceBeatHere();gridGroup.appendChild(button);
        const sync=document.createElement('button');sync.type='button';sync.textContent='Sync Grid';sync.disabled=!clip.beatgrid;sync.setAttribute('aria-pressed',String(!!clip.fluidSync));sync.title='Align source beats to project beats with preserved pitch, keeping the selected original or separated-stem mode and levels';sync.onclick=syncSourceGrid;gridGroup.appendChild(sync);
        const serato=document.createElement('button');serato.type='button';serato.textContent='Serato Grid';serato.title='Read the embedded Serato beatgrid from this MP3';serato.disabled=!/\.mp3$/i.test(clip.path);serato.onclick=async()=>{serato.disabled=true;serato.textContent='Reading...';try{await importSeratoGrid();}finally{if(serato.isConnected){serato.disabled=false;serato.textContent='Serato Grid';}}};importGroup.appendChild(serato);
        const djay=document.createElement('button');djay.type='button';djay.textContent='djay Grid';djay.title='Read the beatgrid from the local djay analysis cache';djay.onclick=async()=>{djay.disabled=true;try{await importSeratoGrid('djay');}finally{if(djay.isConnected)djay.disabled=false;}};importGroup.appendChild(djay);
        const drums=document.createElement('button');drums.type='button';drums.textContent='Drum Beats';drums.disabled=clip.stemState!=='ready';drums.title='Analyze an existing drum stem, then review suggested anchors before applying';drums.onclick=async()=>{drums.disabled=true;drums.textContent='Analyzing...';try{await detectDrumGrid();}finally{if(drums.isConnected){drums.disabled=false;drums.textContent='Drum Beats';}}};importGroup.appendChild(drums);
        toolbar.querySelectorAll('button').forEach(control=>{control.dataset.axiomCtaSkip='true';});
      }
      sourceEditorMarkup.set(editor,{clip,signature,controls});
      return;
    }
    sourceEditorMarkup.delete(editor);
    const rows = [
      { label: 'Kick', className: 'kick', hits: [1,17,33,49] },
      { label: 'Snare', className: 'snare', hits: [17,49] },
      { label: 'Hats', className: 'hat', hits: Array.from({length:32},(_,i)=>i*2+1) },
      { label: 'One Shot', className: 'oneshot', hits: [45] },
      { label: 'Vocal Chop', className: 'vocal', hits: [25,57] },
      { label: 'Perc', className: 'perc', hits: [9,29,41,61] },
    ];
    const pattern=window.AxiomPatterns?.active(activeProject);
    const usedRows=new Set([...Object.keys(activeProject.drumSamples||{}),...(window.AxiomPatterns?.list(activeProject)||[]).flatMap(c=>Object.keys(c.steps||{}).filter(row=>c.steps[row]?.length))]);
    for(const label of new Set([...(window.AxiomStarterKit?.extraRows||[]),...usedRows])){
      if(usedRows.has(label)&&!rows.some(row=>row.label===label)&&window.AxiomPatterns?.isDrumRow(label))rows.push({label,className:/^Kick(?: |$)/.test(label)?'kick':/^(Snare|Clap)(?: |$)/.test(label)?'snare':/^(Hats|Open Hat)(?: |$)/.test(label)?'hat':'oneshot',hits:[]});
    }
    if(window.AxiomPatterns)rows.splice(0,rows.length,...window.AxiomPatterns.orderedRows(rows,activeProject.drumRowOrder));
    const pageIndex=pattern?window.AxiomPatterns.page(activeProject,pattern):0,stepOffset=pageIndex*64;
    const beatPerStep=(pattern?.lengthBeats||16)/(pattern?.stepCount||64);
    editor.style.setProperty('--daw-drum-rows',rows.length);
    if(activeSectionId==='instruments'&&pattern?.kind==='midi'&&window.AxiomInstruments){window.AxiomInstruments.renderEditor(editor,activeProject,pattern);return;}
    if(activeSectionId==='instruments')editor.classList.add('daw-drum-editor');
    editor.innerHTML = `
      <div class="studio-daw-step-head"><strong>Drums 01</strong><span class="daw-pattern-length">1 Bar</span><div class="daw-pattern-transport"><button type="button" aria-label="Play beat preview" title="Play beat preview" onclick="AxiomBeatPreview.play()"><img src="/static/icons/skip-forward.svg" alt=""></button><button type="button" aria-label="Stop beat preview" title="Stop beat preview" onclick="AxiomBeatPreview.stop()"><img src="/static/icons/square.svg" alt=""></button></div><label class="daw-knob-control">SWING<button class="daw-knob" disabled title="Swing processing is not connected yet"></button></label></div>
      <div class="studio-daw-step-grid">
        <span class="studio-daw-step-row-label">Bar</span>${Array.from({length:64},(_,i)=>{const beat=(stepOffset+i)*beatPerStep;return `<span class="daw-step-tick">${i%4===0&&Number.isInteger(beat)?`${Math.floor(beat/4)+1}.${beat%4+1}`:''}</span>`;}).join('')}
        ${rows.map(row => `<button type="button" class="studio-daw-step-row-label daw-load-sample" data-sample-row="${escapeHtml(row.label)}" data-loaded="${Boolean(activeProject.drumSamples?.[row.label]?.path)}" aria-label="Load ${escapeHtml(row.label)} sample" title="${escapeHtml(activeProject.drumSamples?.[row.label]?.name||`Load ${row.label} sample`)}" onclick="AxiomStarterKit.open('${escapeHtml(row.label)}')"><span><strong>${escapeHtml(row.label)}</strong><small>${escapeHtml(activeProject.drumSamples?.[row.label]?.name||'')}</small></span><img src="/static/icons/folder-open.svg" alt=""></button>` + Array.from({ length: 64 }, (_, index) => {
          const step = stepOffset + index + 1;
          const hit = (pattern?.steps?.[row.label] || (activeProject.patternClips?[]:activeProject.stepPattern?.[row.label] || row.hits)).includes(step);
          return `<button type="button" class="studio-daw-step-cell ${row.className}${hit ? ' hit' : ''}" data-step="${step}" data-hit="${escapeHtml(row.label)}" aria-pressed="${hit}" aria-label="${escapeHtml(row.label)} step ${step}">${step}</button>`;
        }).join('')).join('')}
      </div>
      <div class="daw-step-properties"><label>Length <strong>1 Bar</strong></label><label class="daw-knob-control">VELOCITY<button class="daw-knob" disabled title="Sample playback is not connected yet"></button></label><label class="daw-knob-control">PROBABILITY<button class="daw-knob" disabled title="Sample playback is not connected yet"></button></label></div>
    `;
    if(Object.keys(activeProject.drumSamples||{}).length){const pads=document.createElement('div'),content=document.createElement('div'),grid=editor.querySelector('.studio-daw-step-grid');pads.className='studio-daw-pad-bank daw-chop-pads';pads.setAttribute('role','group');pads.setAttribute('aria-label','Playable sample pads');content.className='daw-pattern-content';grid.before(content);content.append(pads,grid);window.AxiomCreativeTools?.mountPads(editor,activeProject);}
    if(window.AxiomPatterns){
      const head=editor.querySelector('.studio-daw-step-head');
      window.AxiomPatternMonitor?.mount(head);
      window.AxiomPatterns.mountRowOrder(editor.querySelector('.studio-daw-step-grid'),activeProject,rows.map(row=>row.label));
      window.AxiomProducerTips?.mount(head);
      window.AxiomStarterKit?.mount(head);
      window.AxiomDrumPresets?.mount(head);
      window.AxiomDrumExtract?.mount(head,editor);
      window.AxiomPatterns.mountActions(editor.querySelector('.daw-step-properties'),activeProject,pattern);
      if(pattern){
        const pager=document.createElement('div');pager.className='daw-pattern-pages';
        const back=document.createElement('button'),next=document.createElement('button'),label=document.createElement('span');
        back.textContent='<';next.textContent='>';back.setAttribute('aria-label','Previous pattern bars');next.setAttribute('aria-label','Next pattern bars');
        back.title='Previous pattern bars';next.title='Next pattern bars';back.disabled=pageIndex===0;next.disabled=stepOffset+64>=window.AxiomPatterns.stepCount(pattern);
        label.textContent=`Bars ${Math.floor(stepOffset*beatPerStep/4)+1}-${Math.ceil((stepOffset+64)*beatPerStep/4)}`;
        back.onclick=()=>{window.AxiomPatterns.page(activeProject,pattern,pageIndex-1);renderStepEditor();};next.onclick=()=>{window.AxiomPatterns.page(activeProject,pattern,pageIndex+1);renderStepEditor();};
        pager.append(back,label,next);head.append(pager);
      }
      head.querySelector('strong').textContent=pattern?.name||'No pattern';
      if(window.AxiomInstruments)head.querySelector('strong').replaceWith(window.AxiomInstruments.patternPicker(activeProject,pattern));
      head.querySelector('.daw-pattern-length').textContent=pattern?`${pattern.lengthBeats/4} Bar`:'0 Bars';
      const add=document.createElement('button');add.textContent='+';add.title='Add independent pattern';add.setAttribute('aria-label','Add pattern');add.onclick=()=>addPattern();head.querySelector('.daw-pattern-transport').append(add);
      const instrument=document.createElement('button');instrument.innerHTML='<img src="/static/icons/piano.svg" alt="">';instrument.title='Add instrument pattern';instrument.setAttribute('aria-label','Add instrument pattern');instrument.onclick=()=>addPattern('midi');head.querySelector('.daw-pattern-transport').append(instrument);
      if(pattern){const edit=document.createElement('button');edit.setAttribute('aria-label','Edit');edit.innerHTML='<img src="/static/icons/sliders-horizontal.svg" alt="">';edit.title='Pattern position, length and duplication';edit.onclick=()=>window.AxiomPatterns.edit(pattern.id);head.querySelector('.daw-pattern-transport').append(edit);}
      editor.querySelector('.daw-step-properties strong').textContent=pattern?`${pattern.lengthBeats/4} Bar`:'0 Bars';
      for(const [key,label,container] of [['swing','Swing',head],['velocity','Velocity',editor.querySelector('.daw-step-properties')],['probability','Probability',editor.querySelector('.daw-step-properties')]]){
        const target=[...container.querySelectorAll('.daw-knob-control')].find(node=>node.textContent.trim().toLowerCase()===label.toLowerCase());if(!target)continue;
        const input=document.createElement('input');input.type='range';input.min='0';input.max='100';input.step='1';input.value=String((pattern?.[key]??(key==='swing'?0:1))*100);input.disabled=!pattern;input.setAttribute('aria-label',`Pattern ${label.toLowerCase()}`);input.title=`${label}: ${input.value}%`;input.style.cssText='width:45px;min-width:0;accent-color:var(--accent)';
        input.oninput=()=>{input.title=`${label}: ${input.value}%`;};input.onchange=()=>editPattern(pattern.id,'apply',{[key]:Number(input.value)/100});target.querySelector('button')?.replaceWith(input);
      }
    }
  }

  function renderBpmLane() {
    const lane = document.getElementById('studio-daw-bpm-lane');
    if (!lane) return;
    if (!activeProject || activeProject.mode !== 'mixtape') {
      lane.classList.add('hidden');
      lane.setAttribute('aria-hidden', 'true');
      lane.innerHTML = '';
      return;
    }
    const bpmLane = bpmAutomation(false);
    const totalBeats = viewBeats || timelineWorkspaceBeats(activeProject);
    const viewEnd = viewStartBeat + totalBeats;
    const yFor = value => Math.max(0, Math.min(100, (400 - value) / 380 * 100));
    let clock = null;
    try { clock = existing.compileTempoMap(activeProject); } catch (error) {}
    const guidePoints = clock ? [
      { beat:viewStartBeat, value:clock.bpmAtBeat(viewStartBeat), guide:true },
      ...bpmLane.points.filter(point => point.beat >= viewStartBeat && point.beat <= viewEnd),
      { beat:viewEnd, value:clock.bpmAtBeat(viewEnd), guide:true },
    ] : bpmLane.points.filter(point => point.beat >= viewStartBeat && point.beat <= viewEnd);
    const uniqueGuidePoints = guidePoints
      .filter(point => Number.isFinite(point.beat) && Number.isFinite(point.value))
      .sort((a,b)=>a.beat-b.beat)
      .filter((point,index,all)=>index===0 || Math.abs(point.beat-all[index-1].beat)>0.000001 || !point.guide);
    const path = uniqueGuidePoints.map(point => `${((point.beat-viewStartBeat)/totalBeats*100).toFixed(3)},${yFor(point.value).toFixed(3)}`).join(' ');
    const visibleButtons = bpmLane.points.map((point,index)=>{
      if(point.beat < viewStartBeat || point.beat > viewEnd) return '';
      const left = ((point.beat - viewStartBeat) / totalBeats * 100).toFixed(3);
      return `<span style="left:${left}%;top:${yFor(point.value).toFixed(3)}%"><button type="button" data-bpm-index="${index}" aria-pressed="${selectedBpmPoint===index}" aria-label="BPM marker ${index+1}: ${point.value}" title="${escapeHtml(bpmPointTitle(point))}" onclick="AxiomStudioDaw.selectBpmPoint(event,${index})" oncontextmenu="return AxiomStudioDaw.openBpmMenu(event,${index})" onpointerdown="AxiomStudioDaw.dragBpmPoint(event,${index})">${Math.round(point.value*100)/100}</button></span>`;
    }).join('');
    const startBpm = clock ? clock.bpmAtBeat(viewStartBeat) : bpmLane.points[0]?.value;
    const endBpm = clock ? clock.bpmAtBeat(Math.max(viewStartBeat, viewEnd - 0.000001)) : bpmLane.points.at(-1)?.value;
    lane.classList.remove('hidden');
    lane.setAttribute('aria-hidden', 'false');
    lane.dataset.mode = 'mixtape';
    lane.dataset.size = bpmLaneSize;
    lane.innerHTML = `
      <div class="studio-daw-bpm-head"><span>${activeProject.mode === 'mixtape' ? 'Mixtape BPM Automation' : 'Project BPM Automation'}</span><span>${Math.round((startBpm || 0) * 100) / 100} → ${Math.round((endBpm || 0) * 100) / 100} BPM</span></div>
      <div class="studio-daw-bpm-points" data-total-beats="${totalBeats}" data-view-start="${viewStartBeat}" onclick="AxiomStudioDaw.addBpmPoint(event)">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="${path}"></polyline></svg>
        ${visibleButtons}
      </div>`;
  }

  function addNoteMarker(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!activeProject) return false;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!(rect.width > 0)) return false;
    const beat = snapBeat(Math.max(0, Math.min(1, (event.clientX-rect.left)/rect.width)) * arrangementLengthBeats(activeProject));
    markerNameDialog('Add Label Marker', 'New label', label => addMarker(beat, label));
    return false;
  }

  function addMarker(position, label) {
    if (!activeProject) return;
    const clip = selectedArrangementClip();
    const beat = snapBeat(position ?? activeProject.editCursorBeat ?? (clip
      ? clip.timelineStartBeat + clip.timelineDurationBeats * selectedClipPointerRatio
      : 0));
    const added = {beat,label:label?.trim().slice(0,80) || `Label ${activeProject.markers.length+1}`,kind:'label'};
    const markers=[...activeProject.markers,added].sort((a,b)=>Number(a.beat||0)-Number(b.beat||0));
    const addedIndex = markers.indexOf(added);
    writeParameters([{key:'markers',value:markers}]);
    activeMarkerIndex = addedIndex;
    renderMarkers();
  }

  function applyDjIntroMarkers(introBars = DJ_INTRO_DEFAULT_BARS) {
    if (!activeProject) return false;
    const bars = Number(introBars) === 16 ? 16 : DJ_INTRO_DEFAULT_BARS;
    const generated = defaultMarkersForTrack(activeProject.sourceTrack, bars);
    const legacyGeneratedLabels = new Set(['intro', 'start / hype', 'verse 1', 'hook', 'verse 2', 'outro']);
    const userMarkers = (activeProject.markers || []).filter(marker => {
      const kind = String(marker?.kind || '').toLowerCase();
      if (kind === 'dj_intro' || kind === 'dj_structure') return false;
      const label = String(marker?.label || '').trim().toLowerCase();
      return !(!kind && legacyGeneratedLabels.has(label));
    });
    const markers = [...generated, ...userMarkers].sort((a, b) => Number(a.beat || 0) - Number(b.beat || 0));
    writeParameters([{ key: 'markers', value: markers }]);
    activeMarkerIndex = Math.max(0, markers.findIndex(marker => marker.role === 'start_hype'));
    renderMarkers();
    const control = document.getElementById('studio-daw-intro-length');
    if (control) control.value = String(bars);
    showToast?.(`DJ markers set: INTRO bars 1–${bars}; START / HYPE at bar ${bars + 1}.`);
    return true;
  }

  function markerActions(event,index) {
    event?.preventDefault?.();event?.stopPropagation?.();
    const project=activeProject,marker=project?.markers?.[index];if(!marker)return false;
    hideContextMenu();clearRange();mixerSelection.clear();selectedBpmPoint=-1;window.AxiomDawFx?.clearSelection?.();
    activeMarkerIndex=index;renderMarkers();
    contextMenu=document.createElement('div');contextMenu.className='studio-daw-context-menu';
    contextMenu.setAttribute('role','menu');contextMenu.setAttribute('aria-label','Marker actions');
    contextMenu.markerSelection={project,marker};
    const current=()=>project===activeProject?project.markers.indexOf(marker):-1;
    for(const [label,action] of [['Rename',i=>renameMarker(null,i)],['Delete marker',i=>deleteMarker(i)],['Play from here',i=>selectMarker(i)]]){
      const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('role','menuitem');
      button.onclick=e=>{e.stopPropagation();hideContextMenu();const i=current();if(i>=0)action(i);};contextMenu.appendChild(button);
    }
    const rect=event?.currentTarget?.getBoundingClientRect?.();
    contextMenu.style.left=`${Math.max(8,Math.min(event?.clientX||rect?.left||8,window.innerWidth-250))}px`;
    contextMenu.style.top=`${Math.max(8,Math.min(event?.clientY||rect?.bottom||8,window.innerHeight-150))}px`;
    document.body.appendChild(contextMenu);contextMenu.querySelector('button')?.focus();return false;
  }

  function renameMarker(event, index = activeMarkerIndex) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    activeMarkerIndex = Number(index) || 0;
    renameActiveMarker();
    return false;
  }

  function visibleBarCount() {
    const span = viewBeats || timelineWorkspaceBeats(activeProject);
    return Number.isFinite(span) && span > 0 ? span / 4 : 16;
  }

  function setZoom(nextMode, anchor) {
    stopClipDragScroll();
    focusZoom('arrange');
    const oldSpan=viewBeats || timelineWorkspaceBeats(activeProject);
    // anchor {beat, fraction} (Windows Ctrl+wheel) keeps that beat under the pointer; otherwise the edit cursor stays put.
    const position=anchor ? Number(anchor.beat) || 0 : Number(activeProject?.editCursorBeat) || 0;
    const fraction=anchor ? Math.max(0,Math.min(1,Number(anchor.fraction) || 0)) : Math.max(0,Math.min(1,(position-viewStartBeat)/oldSpan));
    const span = nextMode === 'bar' ? 4 : nextMode === 'arrange' ? 0 : Number(nextMode);
    viewBeats = Number.isFinite(span) ? Math.max(.25, span) : 0;
    if (span === 0) viewBeats = 0;
    zoomMode = viewBeats ? 'bar' : 'arrange';
    viewStartBeat = viewBeats ? Math.max(0,Math.min(Math.max(0,timelineWorkspaceBeats()-viewBeats),position-fraction*viewBeats)) : 0;
    renderRuler();
    renderMarkers();
    renderLanes();
    syncZoomUi();
  }

  function stepZoom(direction) {
    if (!direction) return;
    const fullSpan = timelineWorkspaceBeats(activeProject);
    const span = Math.max(.25, (viewBeats || fullSpan) * (direction > 0 ? .8 : 1.25));
    setZoom(span >= fullSpan - 1e-8 ? 0 : span);
  }

  // Windows layer (windows-studio-zoom.js): Ctrl+wheel / pinch zoom around a point on the lanes, and Ctrl +/-/0.
  // factor < 1 zooms in; fraction is where the pointer is across the visible lane (0 = left edge, 1 = right edge).
  function zoomTimelineBy(factor, fraction) {
    if (!activeProject || !(factor > 0) || !Number.isFinite(factor)) return false;
    const fullSpan = timelineWorkspaceBeats(activeProject);
    const oldSpan = viewBeats || fullSpan;
    const span = Math.min(fullSpan, Math.max(.25, oldSpan * factor));
    if (Math.abs(span - oldSpan) < 1e-9) return false;
    const f = Math.max(0, Math.min(1, Number(fraction) || 0));
    setZoom(span >= fullSpan - 1e-8 ? 0 : span, {beat: viewStartBeat + f * oldSpan, fraction: f});
    return true;
  }

  function zoomKey(direction) {
    if (!direction) {
      if (zoomTarget === 'source') zoomSource(0); else setZoom(0);
    } else if (zoomTarget === 'source') zoomSource(direction);
    else stepZoom(direction);
    return true;
  }

  function panTimeline(direction) {
    stopClipDragScroll();
    if (!viewBeats) return;
    viewStartBeat = Math.max(0, Math.min(Math.max(0,timelineWorkspaceBeats()-viewBeats),viewStartBeat+viewBeats*direction));
    renderRuler(); renderLanes();
  }

  function followPlayhead(beat) {
    if (!activeProject || !viewBeats || !Number.isFinite(beat)) return false;
    if (beat >= viewStartBeat && beat < viewStartBeat + viewBeats * .9) return false;
    const maxStart = Math.max(0, timelineWorkspaceBeats(activeProject) - viewBeats);
    const next = Math.max(0, Math.min(maxStart, beat - viewBeats * .25));
    if (Math.abs(next - viewStartBeat) < 1e-8) return false;
    viewStartBeat = next;
    renderLanes();
    return true;
  }

  function panTimelineFromWheel(event) {
    const timeline = event?.target?.closest?.('.studio-daw-timeline');
    if (!timeline || !activeProject || !viewBeats || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey ||
        event.target?.closest?.('input, textarea, select, [contenteditable="true"], .daw-source-detail, .daw-source-zoom')) return;
    // Trackpads report horizontal motion as deltaX. Shift+wheel is the
    // keyboard/mouse equivalent. A vertically scrolling wheel without Shift
    // remains available for the Studio page itself.
    const delta = Math.abs(Number(event.deltaX || 0)) >= Math.abs(Number(event.deltaY || 0))
      ? Number(event.deltaX || 0)
      : event.shiftKey ? Number(event.deltaY || 0) : 0;
    if (!Number.isFinite(delta) || Math.abs(delta) < 0.01) return;
    const width = document.getElementById('studio-daw-lanes')?.getBoundingClientRect().width;
    if (!(width > 0)) return;
    event.preventDefault();
    stopClipDragScroll();
    const maxStart = Math.max(0, timelineWorkspaceBeats(activeProject) - viewBeats);
    const pixels = delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? width : 1);
    const distance = Math.max(-viewBeats, Math.min(viewBeats, pixels / width * viewBeats));
    const next = Math.max(0, Math.min(maxStart, viewStartBeat + distance));
    if (Math.abs(next - viewStartBeat) < 1e-9) return;
    viewStartBeat = next;
    renderRuler();
    renderMarkers();
    renderLanes();
  }

  function lockWorkbenchHorizontalScroll(event) {
    const workbench = event?.target?.closest?.('.studio-daw-workbench');
    if (!workbench || !dawSurfaceIsVisible() || workbench.scrollLeft === 0) return;
    workbench.scrollLeft = 0;
  }

  function syncZoomUi() {
    const bars = visibleBarCount();
    const timeline = document.querySelector('.studio-daw-timeline');
    timeline?.style.setProperty('--visible-bars', String(bars));
    timeline?.setAttribute('data-zoom', zoomMode === 'bar' ? '1' : '16');
    timeline?.setAttribute('data-guide-density', bars <= 16 ? 'edit' : 'overview');
    document.getElementById('studio-daw-zoom-arrange')?.classList.toggle('active', zoomMode !== 'bar');
    document.getElementById('studio-daw-zoom-bar')?.classList.toggle('active', zoomMode === 'bar');
    const zoomSelect = document.getElementById('daw-zoom-resolution');
    if (zoomSelect) {
      let current = zoomSelect.querySelector('[data-current-zoom]');
      const preset = [0,64,32,16,8,4,2,1,.5,.25].includes(viewBeats);
      if (preset) current?.remove();
      else {
        if (!current) {
          current = document.createElement('option');
          current.setAttribute('data-current-zoom', 'true');
          zoomSelect.appendChild(current);
        }
        current.value = String(viewBeats);
        current.textContent = `${Number((viewBeats / 4).toFixed(3))} bars`;
      }
      zoomSelect.value = String(viewBeats);
    }
  }

  function selectMarker(index,event) {
    event?.preventDefault?.();event?.stopPropagation?.();
    const marker = activeProject?.markers?.[Number(index)];
    if(!marker || !Number.isFinite(marker.beat) || marker.beat<0) return false;
    activeMarkerIndex=Number(index);
    activeProject.editCursorBeat=marker.beat;
    renderMarkers();
    if(window.AxiomArrangement) window.AxiomArrangement.play(activeProject,existing.compileTempoMap(activeProject).beatToSeconds(marker.beat));
    return false;
  }

  function deleteMarker(index=activeMarkerIndex) {
    const marker=activeProject?.markers?.[index];if(!marker)return false;
    const changed=writeParameters([{key:'markers',value:activeProject.markers.filter(item=>item!==marker)}]);
    activeMarkerIndex=Math.min(index,activeProject.markers.length-1);renderMarkers();return changed;
  }

  function renameActiveMarker() {
    if (!activeProject) return;
    const project=activeProject,marker=project.markers[activeMarkerIndex];
    if(!marker)return;
    const index=()=>project===activeProject?project.markers.indexOf(marker):-1;
    markerNameDialog('Edit Marker', marker.label, next => {
      if(index()<0)return false;
      return writeParameters([{key:'markers',value:project.markers.map(item=>item===marker?{...item,label:next}:item)}]);
    },{
      remove:()=>index()<0?false:deleteMarker(index()),
      play:()=>{if(index()<0)return false;selectMarker(index());return true;}
    });
  }

  function markerNameDialog(title, value, commit, options={}) {
    const project=activeProject;
    document.getElementById('daw-marker-dialog')?.remove();
    const dialog=document.createElement('dialog');dialog.id='daw-marker-dialog';
    dialog.style.cssText='background:#191c19;color:#eee;border:1px solid #525852;padding:20px;border-radius:6px;max-width:90vw;width:380px';
    const form=document.createElement('form');
    const heading=document.createElement('h2');heading.id='daw-marker-heading';heading.textContent=title;dialog.setAttribute('aria-labelledby',heading.id);
    const label=document.createElement('label');label.htmlFor='daw-marker-name';label.textContent='Marker name';
    const input=document.createElement('input');input.id='daw-marker-name';input.value=value||'';input.required=true;input.maxLength=80;
    input.style.cssText='display:block;box-sizing:border-box;width:100%;margin:12px 0;background:#252925;color:#eee;border:1px solid #525852;padding:8px';
    const error=document.createElement('p');error.setAttribute('role','alert');
    const submit=document.createElement('button');submit.type='submit';submit.textContent='Save';submit.style.cssText='padding:8px 18px;background:var(--accent);color:#071005;margin-right:12px';
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.onclick=()=>{dialog.close();dialog.remove();};
    form.onsubmit=event=>{
      event.preventDefault();
      if(project!==activeProject){error.textContent='The active project changed. Close this dialog and try again.';return;}
      const name=input.value.trim().slice(0,80);if(!name){input.focus();return;}
      if(commit(name)===false){error.textContent='This marker changed. Close this dialog and select it again.';return;}
      dialog.close();dialog.remove();
    };
    form.append(heading,label,input,error,submit);
    for(const [key,text] of [['remove','Delete marker'],['play','Play from here']])if(options[key]){
      const button=document.createElement('button');button.type='button';button.textContent=text;
      button.style.cssText='padding:8px 12px;margin:6px 8px 6px 0;background:#303630;color:#fff;border:1px solid #667066';
      button.onclick=()=>{
        if(project!==activeProject||options[key]()===false){error.textContent='This marker changed. Close this dialog and select it again.';return;}
        dialog.close();dialog.remove();
      };form.append(button);
    }
    form.append(cancel);dialog.append(form);document.body.appendChild(dialog);dialog.showModal();input.focus();input.select();
  }

  function selectSection(sectionId) {
    window.AxiomSourceAudition?.stop();
    targetLayerIndex=0;
    clearRange();
    mixerSelection.clear();
    if(String(sectionId||'')!=='fx')window.AxiomDawFx?.clearSelection?.();
    selectedClipId='';
    selectedClipPointerRatio=0;
    clipEditorOpen=false;focusZoom('arrange');
    activeSectionId = String(sectionId || 'master');
    renderLayerPanel();
    renderInspector();
    renderTrackStack();
    renderLanes();
    renderBpmLane();
    renderStepEditor();
    updateAnchorStatus(activeProject.editCursorBeat||0);
    window.AxiomMixer?.refresh();
    syncZoomUi();
  }

  function handleSectionKeydown(event, sectionId) {
    if (!event || (event.key !== 'Enter' && event.key !== ' ')) return true;
    event.preventDefault();
    event.stopPropagation();
    selectSection(sectionId);
    return false;
  }

  function openMasterClip() {
    selectSection('master');
    return false;
  }

  function openStemSection() {
    if (!activeProject) return false;
    const clips = arrangementClips();
    const selected = selectedArrangementClip();
    const clip = selected?.stemJob
      ? selected
      : clips.find(item => item.stemJob && item.stemState === 'ready')
        || selected
        || clips[0];
    if (!clip) {
      if (typeof showToast === 'function') showToast('Add a song clip before opening stems.', true);
      return false;
    }
    if (clip.stemState !== 'ready') window.AxiomStems?.warmup?.();
    if (selectedArrangementClip()?.id !== clip.id) selectClip(clip.id);
    else if (activeSectionId !== clip.sectionId) selectSection(clip.sectionId || 'left-deck');
    if (clip.stemState === 'ready' && clip.stemJob) {
      clip.stemLevelsExpanded = true;
      renderContextPanel();
      document.querySelector('.studio-daw-master-side-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return false;
    }
    if (typeof showToast === 'function') showToast('Select Create Stems to create the four stem channels.', true);
    renderContextPanel();
    return false;
  }

  function splitActiveClip() {
    if(activeSectionId==='fx'){
      const ids=window.AxiomDawFx?.selectedIdsForProject()||[];
      if(ids.length===1)return window.AxiomDawFx.action(ids[0],'split');
      window.showToast?.('Select one sweep to split at the playhead.',true);return false;
    }
    const clips = arrangementClips();
    const clip = selectedArrangementClip();
    if(zoomTarget==='source'&&clip&&(sourceCueBeat(clip)<=clip.sourceStartBeat||sourceCueBeat(clip)>=clip.sourceStartBeat+clip.sourceDurationBeats)){window.showToast?.('Place the cue inside the clip before splitting.',true);return false;}
    // The source cue already owns any explicit snapping. Zoom must not impose
    // a new minimum cut length or move a fine cue to a distant visible line.
    const snap = zoomTarget!=='source' && snapEnabled && !clip?.snapDisabled ? gridStepBeats() : 1 / 960;
    if (!clip || clip.sourceDurationBeats <= 0 || clip.timelineDurationBeats < snap * 2) {
      if (typeof showToast === 'function') showToast('Choose a longer clip before splitting.', true);
      return false;
    }
    const cursor=clip.timelineStartBeat+clip.timelineDurationBeats*selectedClipPointerRatio;
    const sourceCue=zoomTarget==='source'?sourceSnapBeat(clip,sourceCueBeat(clip),{force:!sourceView(clip).cueSnapBypassed}):null;
    const requested = zoomTarget==='source' ? (clip.reversed?clip.sourceStartBeat+clip.sourceDurationBeats-sourceCue:sourceCue-clip.sourceStartBeat)*clip.timelineDurationBeats/clip.sourceDurationBeats : snapBeat(cursor,null,clip)-clip.timelineStartBeat;
    const timelineFirst = musicalRound(Math.max(snap,Math.min(clip.timelineDurationBeats-snap,requested)));
    const sourceFirst = musicalRound(clip.sourceDurationBeats * timelineFirst / clip.timelineDurationBeats);
    const timelineSecond = musicalRound(clip.timelineDurationBeats - timelineFirst);
    const sourceSecond = musicalRound(clip.sourceDurationBeats - sourceFirst);
    const before=rangeSnapshot(),beforeSelection=clipSelectionSnapshot();
    window.AxiomArrangement?.stop(false);window.AxiomStems?.stop();
    const first = {
      ...clip,
      id: clipId('split'),
      label: `${clip.label} A`,
      sourceStartBeat: clip.reversed ? clip.sourceStartBeat + sourceSecond : clip.sourceStartBeat,
      sourceDurationBeats: sourceFirst,
      timelineDurationBeats: timelineFirst,
      sourceIntent: 'split',
    };
    const second = {
      ...clip,
      id: clipId('split'),
      label: `${clip.label} B`,
      sourceStartBeat: clip.reversed ? clip.sourceStartBeat : clip.sourceStartBeat + sourceFirst,
      sourceDurationBeats: sourceSecond,
      timelineStartBeat: clip.timelineStartBeat + timelineFirst,
      timelineDurationBeats: timelineSecond,
      sourceIntent: 'split',
    };
    const index = clips.findIndex(item => item.id === clip.id);
    clips.splice(index >= 0 ? index : 0, 1, first, second);
    selectedClipId = second.id;
    selectedClipIndex = second.trackIndex;
    selectedClipPointerRatio = 0;
    activeSectionId = second.sectionId;
    mixerSelection.clear();mixerSelection.add(second.id);recordClipEdit(before,beforeSelection,{[first.id]:{clip},[second.id]:{clip}});
    renderShell('set');
    if (typeof showToast === 'function') showToast(`Split clip: ${clip.label}`);
    return false;
  }

  function projectTrackByIndex(index) {
    const tracks = activeProject?.sourceTracks?.length ? activeProject.sourceTracks : [activeProject?.sourceTrack].filter(Boolean);
    return tracks[Number(index)] || null;
  }

  function arrangementClips() {
    return ensureArrangementClips(activeProject);
  }

  function selectedArrangementClip() {
    const clips = arrangementClips();
    return clips.find(clip => clip.id === selectedClipId) || clips.find(clip => clip.trackIndex === selectedClipIndex) || clips[0] || null;
  }

  function explicitlySelectedArrangementClip() {
    return arrangementClips().find(clip => clip.id === selectedClipId) || null;
  }

  function clipByReference(reference) {
    const clips = arrangementClips();
    if (typeof reference === 'string') return clips.find(clip => clip.id === reference) || null;
    const numeric = Number(reference);
    return clips.find(clip => clip.trackIndex === numeric) || clips[numeric] || null;
  }

  function clipPointerRatio(event) {
    const target = event?.currentTarget?.closest?.('.studio-daw-clip') || event?.target?.closest?.('.studio-daw-clip');
    if (!target || typeof event?.clientX !== 'number') return selectedClipPointerRatio || 0;
    const rect = target.getBoundingClientRect();
    if (!rect.width) return 0;
    const localRatio = Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));
    const ratio = Number(target.dataset.visibleStartRatio || 0) + localRatio * Number(target.dataset.visibleDurationRatio || 1);
    const clip = clipByReference(target.dataset.dawClipId || selectedClipId);
    if (!clip) return Math.max(0, Math.min(.999999, ratio));
    const beat = snapBeat(clip.timelineStartBeat + ratio * clip.timelineDurationBeats, event, clip);
    return Math.max(0, Math.min(.999999, (beat - clip.timelineStartBeat) / clip.timelineDurationBeats));
  }

  function selectClip(reference, options = {}) {
    clearRange();
    window.AxiomDawFx?.clearSelection?.();
    selectedBpmPoint=-1; bpmEditing=false;
    const clip = clipByReference(reference);
    if (!clip) return null;
    window.AxiomMixer?.close?.();
    if(selectedClipId!==clip.id)window.AxiomSourceAudition?.stop();
    targetLayerIndex=clip.layerIndex||0;
    if(!options.additive&&!options.preserveSelection){mixerSelection.clear();projectBlockSelection=null;}
    if(options.additive && mixerSelection.has(clip.id)) mixerSelection.delete(clip.id);
    else mixerSelection.add(clip.id);
    clipEditorOpen=true;
    selectedClipId = clip.id;
    selectedClipIndex = Number(clip.trackIndex || 0);
    activeSectionId = clip.sectionId || sectionForClipIndex(selectedClipIndex);
    if(Number.isFinite(options.sourceBeat))sourceView(clip).cue=options.sourceBeat;
    else if(typeof options.pointerRatio==='number')delete sourceView(clip).cue;
    if (typeof options.pointerRatio === 'number') selectedClipPointerRatio = Math.max(0, Math.min(.999999, options.pointerRatio));
    activeProject.editCursorBeat = clip.timelineStartBeat + clip.timelineDurationBeats * selectedClipPointerRatio;
    updateAnchorStatus(activeProject.editCursorBeat);
    if (options.render !== false) {
      if(options.cursorOnly&&paintEditCursor(clip))return clip;
      renderInspector();
      renderTrackStack();
      renderMarkers();
      renderLanes();
      renderBpmLane();
      renderStepEditor();
      syncZoomUi();
      window.AxiomMixer?.refresh();
      revealSourceEditor(clip);
    }
    return clip;
  }

  function revealSourceEditor(clip) {
    const project=activeProject;
    requestAnimationFrame(()=>{
      if(activeProject!==project||!clipEditorOpen||selectedArrangementClip()!==clip)return;
      const editor=document.getElementById('studio-daw-step-editor'),host=document.getElementById('tab-content-studio');
      if(!editor?.getBoundingClientRect||!host?.getBoundingClientRect)return;
      const bounds=host.getBoundingClientRect(),rect=editor.getBoundingClientRect();
      const player=document.getElementById('audio-player')?.getBoundingClientRect();
      const bottom=player?.height?Math.min(bounds.bottom,player.top):bounds.bottom;
      host.style.setProperty('--daw-player-clearance',`${Math.max(110,bounds.bottom-bottom+8)}px`);
      if(rect.bottom>bottom-8)host.scrollTop+=rect.bottom-bottom+8;
      else if(rect.top<bounds.top+8)host.scrollTop+=rect.top-bounds.top-8;
      window.dispatchEvent(new Event('axiom-daw-layout-changed'));
    });
  }

  function currentStudioDawPlayingPath() {
    try {
      return String(currentPlayingPath || '');
    } catch (_) {
      return '';
    }
  }

  function syncStudioDawClipHighlights(path = currentStudioDawPlayingPath(), clipId = selectedClipId) {
    document.querySelectorAll('.studio-daw-clip[data-path]').forEach(clip => {
      const isSameClip = clipId && clip.dataset.dawClipId === clipId;
      const isFallbackMatch = !clipId && Boolean(path) && clip.dataset.path === path;
      clip.classList.toggle('playing-track', Boolean(path) && (isSameClip || isFallbackMatch));
    });
  }

  function playClip(index, event, options = {}) {
    window.AxiomArrangement?.stop();
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const clip = clipByReference(index);
    if (!clip?.path) {
      if (typeof showToast === 'function') showToast('Audio file not available locally', true);
      return false;
    }
    const ratio = typeof options.pointerRatio === 'number' ? options.pointerRatio : clipPointerRatio(event);
    const startBeat = typeof options.startBeat === 'number'
      ? options.startBeat
      : clip.sourceStartBeat + (clip.sourceDurationBeats * ratio);
    selectedClipPointerRatio = Math.max(0, Math.min(.999999, (startBeat - clip.sourceStartBeat) / clip.sourceDurationBeats));
    selectClip(clip.id, { pointerRatio: selectedClipPointerRatio, render: true });
    if(window.AxiomArrangement?.audition) {window.AxiomArrangement.audition(activeProject,clip,selectedClipPointerRatio);return false;}
    if(clip.stemState==='ready' && window.AxiomStems) {window.AxiomStems.play(clip,selectedClipPointerRatio);return false;}
    window.AxiomStems?.stop();
    if (typeof playAudioFile !== 'function') {
      if (typeof showToast === 'function') showToast('AXIOM audio player is still loading.', true);
      return false;
    }
    playAudioFile(
      clip.path,
      clip.title || 'Unknown Title',
      clip.artist || 'Unknown Artist',
      Number(clip.bpm || 0) || 0,
      clip.camelot || '',
      clip.energy || '',
      event || null,
      clip.genre || '',
      {
        context: 'studio-daw-preview',
        startTimeSeconds: secondsFromBeat(clip, startBeat),
      }
    );
    syncStudioDawClipHighlights(clip.path, clip.id);
    return false;
  }

  async function jumpToStart() {
    if(window.AxiomArrangement) {window.AxiomArrangement.stop();return false;}
    const clip = selectedArrangementClip();
    const seconds = clip ? secondsFromBeat(clip, clip.sourceStartBeat) : 0;
    try {
      if (typeof nativeAudioRequest === 'function') await nativeAudioRequest('/api/audio/seek', { seconds });
    } catch (err) {
      if (typeof showToast === 'function') showToast(`Jump to start failed: ${err.message}`, true);
    }
    return false;
  }

  async function stopPlayback() {
    window.AxiomSourceAudition?.stop();
    window.AxiomArrangement?.stop();
    window.AxiomBeatPreview?.stop();
    window.AxiomStems?.stop();
    if (typeof stopAxiomAudioPlayback === 'function') {
      await stopAxiomAudioPlayback('studio_daw_stop');
    } else if (typeof nativeAudioRequest === 'function') {
      await nativeAudioRequest('/api/audio/stop', { reason: 'studio_daw_stop' });
    }
    syncStudioDawClipHighlights('');
    return false;
  }

  async function playFromStart() {
    if(window.AxiomArrangement && activeProject) {
      window.AxiomSourceAudition?.stop();
      // A whole-project restart must not be redirected into a selected loop.
      window.AxiomArrangement.clearLoop?.();
      activeProject.editCursorBeat=0;
      viewStartBeat=0;
      renderRuler();renderMarkers();renderLanes();
      return window.AxiomArrangement.play(activeProject,0);
    }
    const clip = selectedArrangementClip();
    if (!clip?.path) return false;
    if (!currentStudioDawPlayingPath()) return playClip(clip.id, null, { startBeat: clip.sourceStartBeat });
    await jumpToStart();
    try {
      if (typeof nativeAudioRequest === 'function') {
        await nativeAudioRequest('/api/audio/resume', {});
      } else if (typeof togglePlay === 'function') {
        await togglePlay();
      }
    } catch (_) {
      playClip(clip.id, null, { startBeat: clip.sourceStartBeat });
    }
    return false;
  }

  function playOrToggle() {
    window.AxiomSourceAudition?.stop();
    if(window.AxiomArrangement) {window.AxiomArrangement.toggle();return false;}
    if(window.AxiomStems?.playing) {window.AxiomStems.stop();return false;}
    const clip = selectedArrangementClip();
    if(clip?.stemState==='ready' && window.AxiomStems) {window.AxiomStems.play(clip,selectedClipPointerRatio);return false;}
    if (!currentStudioDawPlayingPath() && clip) return playClip(clip.id, null, { startBeat: clip.sourceStartBeat });
    if (typeof togglePlay === 'function') togglePlay();
    return false;
  }

  function bpmParameterUpdates(clip,next,mode,factor=next/Number(clip.bpm)) {
    const current=Number(clip.bpm);
    // Keep the same source audio window while changing its beat interpretation.
    // A verified grid is copied and its time anchors are scaled around its first
    // anchor, so the correction remains clip-local and never writes the source.
    const oldStartSeconds = existing.sourceBeatToSeconds?.(clip, clip.sourceStartBeat) || 0;
    const oldEndSeconds = existing.sourceBeatToSeconds?.(clip, clip.sourceStartBeat + clip.sourceDurationBeats) || oldStartSeconds;
    let beatgrid = clip.beatgrid;
    if (beatgrid?.beatAnchors?.length >= 2) {
      const anchors = beatgrid.beatAnchors;
      const origin = Number(anchors[0].seconds || 0);
      beatgrid = {
        ...beatgrid,
        beatAnchors: anchors.map(anchor => ({
          ...anchor,
          seconds: origin + (Number(anchor.seconds || origin) - origin) / factor,
        })),
      };
      if(Number.isFinite(beatgrid.metadata?.steadyBpm)){
        const steadyBpm=beatgrid.metadata.steadyBpm*factor;
        if(steadyBpm<20||steadyBpm>400)throw new Error('That correction would put the steady Snap grid outside its supported 20-400 BPM range.');
        beatgrid.metadata={...beatgrid.metadata,steadyBpm};
      }
      if(Array.isArray(beatgrid.tempoSegments))beatgrid.tempoSegments=beatgrid.tempoSegments.map(segment=>Number.isFinite(segment.bpm)?{...segment,bpm:segment.bpm*factor}:{...segment});
    }
    const corrected = { ...clip, bpm: next, beatgrid };
    const sourceStartBeat = existing.sourceSecondsToBeat?.(corrected, oldStartSeconds) ?? clip.sourceStartBeat;
    const sourceEndBeat = existing.sourceSecondsToBeat?.(corrected, oldEndSeconds) ?? (sourceStartBeat + clip.sourceDurationBeats);
    // This corrects detected BPM, not a deliberate half-speed audio effect.
    // At a fixed project BPM, halving source BPM halves its beat span and
    // doubles playback speed. Preserve the complete source-time window and
    // the existing source-beat/project-beat sync ratio.
    const timelineDurationBeats = Math.max(1 / 64, Number(clip.timelineDurationBeats || 0) * factor);
    const updates = [
      { id: clip.id, key: 'bpm', value: next },
      { id: clip.id, key: 'bpmCorrection', value: { mode, factor, previousBpm: current, updatedBpm: next } },
      { id: clip.id, key: 'sourceStartBeat', value: sourceStartBeat },
      { id: clip.id, key: 'sourceDurationBeats', value: Math.max(1 / 64, sourceEndBeat - sourceStartBeat) },
      { id: clip.id, key: 'timelineDurationBeats', value: timelineDurationBeats },
    ];
    if (beatgrid) updates.push({ id: clip.id, key: 'beatgrid', value: beatgrid });
    if(Number.isFinite(clip.stemSourceStart))updates.push({id:clip.id,key:'stemSourceStart',value:existing.sourceSecondsToBeat(corrected,existing.sourceBeatToSeconds(clip,clip.stemSourceStart))});
    return updates;
  }

  function validateBpmPlayback(project,clips) {
    if(project.playbackMode!=='preserve-pitch')return;
    const clock=existing.compileTempoMap(project);
    for(const clip of clips.filter(c=>!c.muted&&c.timelineDurationBeats>0)){
      const grid=existing.trackGrid(clip),start=clip.timelineStartBeat,end=start+clip.timelineDurationBeats;
      const ratio=clip.sourceDurationBeats/clip.timelineDurationBeats;
      if(!Number.isFinite(ratio)||ratio<=0)throw new Error('Correct the clip duration before changing its BPM.');
      const sourceAt=beat=>existing.sourceBeatToSeconds(clip,clip.sourceStartBeat+(beat-start)*ratio);
      const boundaries=[...new Set([start,end,...clock.segments.map(s=>s.beat),...(grid?.anchors||[]).map(a=>start+(a.beat-clip.sourceStartBeat)/ratio)])]
        .filter(beat=>beat>=start&&beat<=end).sort((a,b)=>a-b);
      for(let i=1;i<boundaries.length;i++){
        const a=boundaries[i-1],b=boundaries[i],slope=(sourceAt(b)-sourceAt(a))/(b-a);
        const segment=clock.segments.find(s=>a>=s.beat&&a<s.end);
        // Source timing is linear between anchors; project BPM is linear or
        // held. Its endpoints bound every playback ratio in this interval.
        for(const beat of [a,b]){
          const bpm=segment.value+segment.slope*(beat-segment.beat),stretch=60/(slope*bpm);
          if(!Number.isFinite(stretch)||stretch<.125-1e-9||stretch>8+1e-9)
            throw new Error('That correction exceeds the Preserve Pitch stretch range of 1/8 to 8. Adjust the clip length or project tempo first.');
        }
      }
    }
  }

  function correctClipBpm(action, id = selectedClipId) {
    const clip=clipByReference(id),current=Number(clip?.bpm||0);
    if(!clip||!['half','double'].includes(action))return false;
    if(!Number.isFinite(current)||current<=0){showToast?.('This clip has no BPM to correct. Set a BPM in Library first.',true);return false;}
    const factor=action==='half'?.5:2,next=Math.round(current*factor*10)/10;
    if(next<20||next>300){showToast?.('That correction would put the clip outside AXIOM’s supported 20–300 BPM range.',true);return false;}
    let updates;
    try{
      updates=bpmParameterUpdates(clip,next,action,factor);
      const preview={...activeProject,arrangementClips:activeProject.arrangementClips.map(c=>({...c}))};
      const previewClip=preview.arrangementClips.find(item=>item.id===clip.id);
      for(const update of updates)previewClip[update.key]=update.value;
      const remapAutomation=window.AxiomDawAutomation&&activeProject.automationLanes?.some(l=>l.scope==='clip');
      if(remapAutomation)window.AxiomDawAutomation.reconcileClips(preview,activeProject.arrangementClips,activeProject.automationLanes);
      const regenerate=activeProject.mode==='mixtape'&&['left-deck','right-deck'].includes(clip.sectionId)&&shouldRegenerateMixtapeBpm(activeProject);
      if(regenerate)preview.automationLanes=[...(preview.automationLanes||[]).filter(lane=>lane.parameter!=='bpm'),createMixtapeBpmLane(preview)];
      validateBpmPlayback(preview,regenerate?preview.arrangementClips:[previewClip]);
      if(remapAutomation||regenerate)updates.push({key:'automationLanes',value:preview.automationLanes});
    }catch(error){showToast?.(error.message,true);return false;}
    if (!writeParameters(updates)) return false;
    showToast?.(`Clip BPM corrected ${action === 'half' ? 'to half-time' : 'to double-time'} at ${next} BPM. Audio speed updated; Library metadata was not changed.`);
    return true;
  }

  function updateLibraryBpm(path,bpm) {
    const next=Number(bpm);
    if(!activeProject||typeof path!=='string'||!path||!Number.isFinite(next)||next<20||next>300)return false;
    const updates=[];
    for(const clip of arrangementClips()){
      if(clip.path!==path||['half','double'].includes(clip.bpmCorrection?.mode)||['manual','recording','rendered-fx'].includes(clip.beatgrid?.source)||Number(clip.bpm)===next)continue;
      // Manual half/double corrections belong to that split. A Library change
      // updates inherited interpretations, never the project's tempo or a
      // deliberately overridden sibling. Keep trim times and placements.
      if(!Number.isFinite(Number(clip.bpm))||Number(clip.bpm)<=0)continue;
      updates.push(...bpmParameterUpdates(clip,next,'library'));
    }
    if(activeProject.sourceTracks?.some(track=>track.path===path&&Number(track.bpm)!==next))
      updates.push({key:'sourceTracks',value:activeProject.sourceTracks.map(track=>track.path===path?{...track,bpm:next}:track)});
    return updates.length?writeParameters(updates):true;
  }

  function makeRoomForClip(inserted) {
    const start=musicalRound(inserted.timelineStartBeat),epsilon=1e-7;
    inserted.timelineStartBeat=start;
    let end=musicalRound(start+inserted.timelineDurationBeats);
    const neighbours=arrangementClips().filter(clip=>clip.sectionId===inserted.sectionId &&
      (clip.layerIndex||0)===(inserted.layerIndex||0) && clip.timelineStartBeat+clip.timelineDurationBeats>start+epsilon)
      .slice().sort((a,b)=>a.timelineStartBeat-b.timelineStartBeat);
    for(const clip of neighbours){
      // Touching edges fit. A later gap absorbs the push, so the rest of the
      // arrangement stays anchored instead of moving on every duplicate.
      if(clip.timelineStartBeat>=end-epsilon)break;
      clip.timelineStartBeat=end;
      end=musicalRound(clip.timelineStartBeat+clip.timelineDurationBeats);
    }
  }

  function copySelection() {
    window.AxiomMixerHistory?.finish();
    if(rangeSelection&&rangeProject===activeProject&&rangeSelection.sectionId!=='fx'){
      const range=rangeSelection,clips=[],originals={};
      for(const clip of arrangementClips()){
        const start=Math.max(range.start,clip.timelineStartBeat),end=Math.min(range.end,clip.timelineStartBeat+clip.timelineDurationBeats);
        if(clip.sectionId!==range.sectionId||end<=start)continue;
        const ratio=clip.sourceDurationBeats/clip.timelineDurationBeats;
        originals[clip.id]=clip;
        clips.push({...clip,sourceIntent:'trimmed',timelineStartBeat:start,timelineDurationBeats:end-start,
          sourceStartBeat:clip.sourceStartBeat+(start-clip.timelineStartBeat)*ratio,sourceDurationBeats:(end-start)*ratio});
      }
      if(!clips.length){showToast?.('No audio inside the selected range.',true);return false;}
      arrangementClipboard={project:activeProject,...JSON.parse(JSON.stringify({clips,originals,startBeat:range.start,
        automation:activeProject.automationLanes||[],fxRegions:activeProject.fxRegions||[]}))};
      return true;
    }
    const bundle=selectedTimelineBundle();
    if(bundle&&(bundle.allProject||bundle.fxRegions.length||bundle.patternClips.length||bundle.clips.some(clip=>clip.sectionId!==bundle.clips[0]?.sectionId))){
      arrangementClipboard={...bundle,cut:false};
      return true;
    }
    if(activeSectionId==='fx'&&window.AxiomDawFx?.copySelected())return true;
    const clips=arrangementClips().filter(clip=>mixerSelection.has(clip.id));
    if(!clips.length)return false;
    arrangementClipboard={project:activeProject,clips:JSON.parse(JSON.stringify(clips)),automation:JSON.parse(JSON.stringify(activeProject.automationLanes||[])),fxRegions:JSON.parse(JSON.stringify(activeProject.fxRegions||[]))};
    return true;
  }

  function cutSelection(){
    const bundle=selectedTimelineBundle();
    if(bundle&&(bundle.allProject||bundle.fxRegions.length||bundle.patternClips.length||bundle.clips.some(clip=>clip.sectionId!==bundle.clips[0]?.sectionId))){
      arrangementClipboard={...bundle,cut:true};
      const before=timelineSnapshot(),beforeSelection=clipSelectionSnapshot();
      removeTimelineBundleSelection(bundle);
      clearRange();mixerSelection.clear();window.AxiomDawFx?.clearSelection?.();selectedClipId='';selectedClipPointerRatio=0;clipEditorOpen=false;projectBlockSelection=null;
      recordTimelineEdit(before,beforeSelection);renderShell('set');return true;
    }
    if(!copySelection())return false;
    if(rangeSelection&&rangeProject===activeProject&&rangeSelection.sectionId!=='fx')return editRange('delete');
    return deleteSelectedClips();
  }

  function pasteAtCursor(){
    if(arrangementClipboard?.kind==='timeline-bundle')return pasteTimelineBundle(arrangementClipboard,activeProject?.editCursorBeat||0);
    if(activeSectionId==='fx'&&window.AxiomDawFx?.paste())return true;
    if(!arrangementClipboard||arrangementClipboard.project!==activeProject)return false;
    const source=arrangementClipboard.clips,sectionId=source[0].sectionId;
    const deckTransfer = ['left-deck','right-deck'].includes(sectionId) && ['left-deck','right-deck'].includes(activeSectionId);
    const sampleTransfer = ['left-deck','right-deck'].includes(sectionId) && activeSectionId==='samples';
    if(activeSectionId!==sectionId && !deckTransfer && !sampleTransfer){
      if(typeof showToast==='function')showToast('Choose a position in the original section before pasting.',true);
      return false;
    }
    window.AxiomMixerHistory?.finish();
    const before=rangeSnapshot(),beforeSelection=clipSelectionSnapshot();
    const firstBeat=arrangementClipboard.startBeat??Math.min(...source.map(clip=>clip.timelineStartBeat));
    const firstLayer=Math.min(...source.map(clip=>clip.layerIndex||0));
    const start=musicalRound(snapBeat(Math.max(0,activeProject.editCursorBeat||0)));
    const pasted=JSON.parse(JSON.stringify(source)).map(clip=>({...clip,id:clipId('paste'),sectionId:activeSectionId,
      timelineStartBeat:musicalRound(start+clip.timelineStartBeat-firstBeat),
      layerIndex:targetLayerIndex+(clip.layerIndex||0)-firstLayer}));
    stopParameterPlayback();
    activeProject.arrangementClips.push(...pasted);
    clearRange();
    mixerSelection.clear();pasted.forEach(clip=>mixerSelection.add(clip.id));
    selectedClipId=pasted[0].id;selectedClipPointerRatio=0;clipEditorOpen=false;
    recordClipEdit(before,beforeSelection,Object.fromEntries(pasted.map((clip,i)=>[clip.id,{clip:arrangementClipboard.originals?.[source[i].id]||source[i],fxRegions:arrangementClipboard.fxRegions,fxAutomation:arrangementClipboard.automation,lanes:(arrangementClipboard.automation||[]).filter(l=>l.scope==='clip'&&l.targetId===source[i].id)}])));renderShell('set');return true;
  }

  function pasteAfterSelection(options = {}) {
    if (!activeProject || !clipboardTrack) return false;
    const clips = arrangementClips();
    const before=rangeSnapshot(),beforeSelection=clipSelectionSnapshot();
    const selected = selectedArrangementClip() || clips[0];
    const insertAt = selected ? clips.findIndex(clip => clip.id === selected.id) + 1 : clips.length;
    const startBeat = selected
      ? musicalRound(selected.timelineStartBeat + selected.timelineDurationBeats)
      : arrangementLengthBeats(activeProject);
    const nextClip = {
      ...JSON.parse(JSON.stringify(clipboardTrack)),
      id: clipId('paste'),
      label: clipboardTrack.label || clipboardTrack.title || 'Pasted Clip',
      timelineStartBeat: startBeat,
      sectionId: selected?.sectionId || clipboardTrack.sectionId || sectionForClipIndex(clipboardTrack.trackIndex || 0),
    };
    window.AxiomArrangement?.stop(false);window.AxiomStems?.stop();
    makeRoomForClip(nextClip);
    clips.splice(Math.max(0, insertAt), 0, nextClip);
    selectedClipId = nextClip.id;
    selectedClipIndex = nextClip.trackIndex;
    activeSectionId = nextClip.sectionId;
    selectedClipPointerRatio = 0;
    mixerSelection.clear();mixerSelection.add(nextClip.id);recordClipEdit(before,beforeSelection,{[nextClip.id]:{clip:clipboardTrack}});
    renderShell('set');
    if (typeof showToast === 'function' && options.toast !== false) showToast(`Pasted after selected clip`);
    return false;
  }

  function isProjectOpen() {
    return Boolean(activeProject);
  }

  function projectHasTrack(track) {
    const path = String(track?.path || '');
    if (!path || !activeProject) return false;
    return arrangementClips().some(clip => String(clip?.path || '') === path);
  }

  function addTrackToProject(track, options = {}) {
    if (!activeProject) {
      return showStudioDawProject(track, 'track');
    }
    const safeTrack = stableTrackCopy(track);
    if (!trackHasUsableAudio(track)) {
      if (typeof showToast === 'function') showToast('That Studio track is unavailable on this Mac. Reconnect it before adding it to the DAW.', true);
      return false;
    }
    const layerTarget = options.placement || pendingLayer;
    if (projectHasTrack(safeTrack) && !layerTarget) {
      if (typeof showToast === 'function') showToast(`Already in Studio DAW: ${safeTrack.title}`, true);
      revealStudioDawShell('set');
      return false;
    }
    const before=options.renderedFx?timelineSnapshot(activeProject,true):rangeSnapshot(),beforeSelection=clipSelectionSnapshot();
    stopParameterPlayback();
    activeProject.sourceTracks = Array.isArray(activeProject.sourceTracks) ? activeProject.sourceTracks : [];
    if(!activeProject.sourceTrack?.path){
      const previousBpm=activeProject.sourceTrack?.bpm||120;
      activeProject.sourceTrack={...safeTrack,bpm:options.renderedFx||activeProject.projectTempoChosen?previousBpm:safeTrack.bpm};
      if(!options.renderedFx&&!activeProject.projectTempoChosen)activeProject.tempoSegments=[{startBeat:0,bpm:safeTrack.bpm}];
      for(const lane of activeProject.automationLanes||[]){
        if(!options.renderedFx && !activeProject.projectTempoChosen && lane.parameter==='bpm' && lane.points?.length===1 && lane.points[0].beat===0 && lane.points[0].value===previousBpm){
          lane.points=[{beat:0,value:safeTrack.bpm,curve:'hold'}];
        }
      }
    }
    let sourceIndex = activeProject.sourceTracks.findIndex(item => item.path === safeTrack.path);
    if (sourceIndex < 0) { sourceIndex = activeProject.sourceTracks.length; activeProject.sourceTracks.push(safeTrack); }
    selectedClipIndex = sourceIndex;
    activeSectionId = layerTarget?.sectionId || options.sectionId || (selectedClipIndex % 2 === 0 ? 'left-deck' : 'right-deck');
    const clips = ensureArrangementClips(activeProject);
    const startBeat = layerTarget && Number.isFinite(layerTarget.beat) ? (options.renderedFx?layerTarget.beat:snapBeat(layerTarget.beat)) : Math.max(0, ...clips.map(clip => clip.timelineStartBeat + clip.timelineDurationBeats));
    const newClip = createFullTrackClip(safeTrack, selectedClipIndex, startBeat);
    if(!layerTarget){
      const previous=clips.find(clip=>clip.timelineStartBeat+clip.timelineDurationBeats===startBeat);
      newClip.intakePlacement={startBeat,afterId:previous?.id||null};
    }
    if(options.recording){
      newClip.timelineStartBeat=layerTarget.beat;newClip.timelineDurationBeats=options.recording.durationBeats;newClip.sourceStartBeat=0;newClip.sourceDurationBeats=options.recording.durationBeats;
      newClip.beatgrid={version:1,source:'recording',trackPath:safeTrack.path,beatAnchors:options.recording.anchors};newClip.recorded=true;newClip.recordingInfo=options.recording.capture;
    }
    if(options.renderedFx){
      const t=options.renderedFx;
      newClip.timelineStartBeat=layerTarget.beat;newClip.timelineDurationBeats=t.durationBeats;newClip.sourceStartBeat=0;newClip.sourceDurationBeats=t.durationBeats;
      newClip.beatgrid={version:1,source:'rendered-fx',trackPath:safeTrack.path,beatAnchors:t.anchors};newClip.fluidSync=true;newClip.renderedFx=t.provenance;
    }
    newClip.sectionId = activeSectionId;
    if(!['left-deck','right-deck'].includes(newClip.sectionId))newClip.alignAudioStart=false;
    newClip.layerIndex = layerTarget?.layerIndex || 0;
    if(options.preserveImportDuration){
      const clock=existing.compileTempoMap(activeProject);
      newClip.timelineDurationBeats=Math.max(1/64,clock.secondsToBeat(clock.beatToSeconds(startBeat)+safeTrack.durationSec)-startBeat);
      newClip.imported=true;
    }
    if(options.nonOverlapping)newClip.timelineStartBeat=freeAudioPosition(newClip.sectionId,newClip.layerIndex,startBeat,newClip.timelineDurationBeats);
    if(options.preserveImportDuration && newClip.timelineStartBeat!==startBeat){
      const clock=existing.compileTempoMap(activeProject);
      // A tempo change at the free slot must not change the imported audio length.
      const occupied=clips.filter(c=>c.sectionId===newClip.sectionId&&(c.layerIndex||0)===newClip.layerIndex)
        .slice().sort((a,b)=>a.timelineStartBeat-b.timelineStartBeat);
      for(let attempt=0;attempt<=occupied.length;attempt++){
        const start=newClip.timelineStartBeat;
        newClip.timelineDurationBeats=Math.max(1/64,clock.secondsToBeat(clock.beatToSeconds(start)+safeTrack.durationSec)-start);
        const free=freeAudioPosition(newClip.sectionId,newClip.layerIndex,start,newClip.timelineDurationBeats);
        if(free===start)break;
        newClip.timelineStartBeat=free;
      }
    }
    if(['left-deck','right-deck'].includes(newClip.sectionId))newClip.mixtapeHandoffBeat=Number(newClip.timelineStartBeat||0);
    pendingLayer = null;
    clips.push(newClip);
    if(options.replaceFxId&&options.renderedFx?.provenance?.signal==='generated-sweep'){
      activeProject.fxRegions=(activeProject.fxRegions||[]).filter(f=>f.id!==options.replaceFxId);
      activeProject.automationLanes=(activeProject.automationLanes||[]).filter(l=>l.scope!=='fx'||l.targetId!==options.replaceFxId);
    }
    if (activeProject.mode === 'mixtape' && shouldRegenerateMixtapeBpm(activeProject)) {
      syncMixtapeBpmAutomation(activeProject, true);
    }
    selectedClipId = newClip.id;
    mixerSelection.clear();mixerSelection.add(newClip.id);
    if(options.renderedFx){activeProject.editCursorBeat=newClip.timelineStartBeat;recordTimelineEdit(before,beforeSelection,true);}else recordClipEdit(before,beforeSelection);
    selectedClipPointerRatio = 0;
    if (!layerTarget && typeof currentPlaylist !== 'undefined' && Array.isArray(currentPlaylist)) {
      const alreadyInStudioSet = currentPlaylist.some(setTrack => String(setTrack?.path || '') === safeTrack.path);
      if (!alreadyInStudioSet) {
        if (typeof saveHistory === 'function') saveHistory();
        currentPlaylist.push({ ...safeTrack, duration_sec: safeTrack.durationSec });
        if (typeof syncEditingPlaylistIfNeeded === 'function') syncEditingPlaylistIfNeeded();
        if (typeof renderPlaylist === 'function') renderPlaylist(currentPlaylist);
        if (typeof updateStudioToolsAvailability === 'function') updateStudioToolsAvailability();
      }
    }
    if (options.batch) return false;
    revealStudioDawShell('set');
    activeProject.editCursorBeat=newClip.timelineStartBeat;
    window.AxiomArrangement?.seekBeat(activeProject,newClip.timelineStartBeat);
    window.setAxiomPreviewPlayerContext?.('studio-daw-preview', {reason:'studio_daw_add_track',reset:true});
    if (typeof showToast === 'function') showToast(`Added to Studio DAW: ${safeTrack.title}`);
    window.AxiomSourceBounds?.queue(activeProject);
    return false;
  }

  function replaceSweepSource(oldPath,track,renderedFx){
    const p=activeProject,parts=arrangementClips().filter(c=>c.path===oldPath&&c.renderedFx?.signal==='generated-sweep');
    if(!parts.length||!trackHasUsableAudio(track)||renderedFx?.provenance?.signal!=='generated-sweep')return false;
    const before=timelineSnapshot(activeProject,true),beforeSelection=clipSelectionSnapshot(),safe=stableTrackCopy(track);
    stopParameterPlayback();
    for(const clip of parts){
      Object.assign(clip,{path:safe.path,title:safe.title,filename:track.filename,durationSec:safe.durationSec,duration_sec:safe.durationSec,bpm:safe.bpm,assetIdentity:track.assetIdentity,
        beatgrid:{version:1,source:'rendered-fx',trackPath:safe.path,beatAnchors:JSON.parse(JSON.stringify(renderedFx.anchors))},renderedFx:JSON.parse(JSON.stringify(renderedFx.provenance))});
      if(clip.stemJob){delete clip.stemJob;delete clip.stemSourceStart;clip.stemState='failed';}
    }
    p.sourceTracks=(p.sourceTracks||[]).map(t=>t.path===oldPath?{...safe}:t);
    if(p.sourceTrack?.path===oldPath)p.sourceTrack={...safe};
    if(p.anchorPath===oldPath)p.anchorPath=safe.path;
    if(track.assetIdentity)p.assetIdentities={...p.assetIdentities,[safe.path]:track.assetIdentity};
    recordTimelineEdit(before,beforeSelection,true);window.AxiomStudioDaw.refreshArrangement();return true;
  }

  function duplicateSelection() {
    const clip = selectedArrangementClip();
    if (!clip) return false;
    clipboardTrack = { ...clip, copiedFromClipId: clip.id };
    return pasteAfterSelection();
  }

  function toggleClipReverse(id = selectedClipId) {
    const clicked=clipByReference(id);
    const clips=(mixerSelection.size&&clicked&&mixerSelection.has(clicked.id)?arrangementClips().filter(clip=>mixerSelection.has(clip.id)):[clicked]).filter(Boolean);
    if(!clips.length)return false;
    const next=!clips.every(clip=>clip.reversed);
    const updates=clips.map(clip=>({id:clip.id,key:'reversed',value:next}));
    if(!writeParameters(updates))return false;
    showToast?.(next?`Reversed ${clips.length===1?'clip audio':'selected clips'}.`:`Restored ${clips.length===1?'clip audio':'selected clips'} forward.`);
    return true;
  }

  function openReverbTailRegion(region,{missingMessage='Select the clip or range you want to turn into a reverse reverb build.',failedMessage='Reverb tail could not be prepared.'}={}) {
    if(!activeProject||!region){showToast?.(missingMessage,true);return false;}
    const fx={id:`reverb-tail-${Date.now().toString(36)}`,type:'reverb',target:region.target||'master',startBeat:region.startBeat,durationBeats:region.durationBeats,tailBeats:8,wet:.42,reverse:false,decaySeconds:2.4,preDelayMs:20,dampingHz:9000};
    if(!window.AxiomDawFx?.apply?.(fx)){showToast?.(failedMessage,true);return false;}
    window.AxiomDawFxTail?.open?.(fx.id);
    return true;
  }

  function renderReverbTailForClip(id = selectedClipId) {
    const clip=clipByReference(id);
    if(!clip)return openReverbTailRegion(null);
    const duration=Math.max(.25,Math.min(4,Number(clip.timelineDurationBeats||4)));
    const start=Math.max(0,Number(clip.timelineStartBeat||0)+Number(clip.timelineDurationBeats||0)-duration);
    return openReverbTailRegion({target:clip.sectionId||'master',startBeat:start,durationBeats:duration},{failedMessage:'Reverb tail could not be prepared for this clip.'});
  }

  function renderReverbTailForRange(range = rangeSelection) {
    if(!activeProject||!range||rangeProject!==activeProject)return openReverbTailRegion(null,{missingMessage:'Select the bars you want to turn into a reverse reverb build.'});
    const start=Number(range.start),end=Number(range.end),duration=end-start;
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||duration<.25){showToast?.('Select at least 1/16 bar for a reverb tail.',true);return false;}
    const target=range.sectionId&&range.sectionId!=='fx'?range.sectionId:'master';
    return openReverbTailRegion({target,startBeat:start,durationBeats:duration},{failedMessage:'Reverb tail could not be prepared for this range.'});
  }

  function deleteSelectedClips() {
    if(!activeProject||!arrangementClips().some(clip=>mixerSelection.has(clip.id)))return false;
    window.AxiomMixerHistory?.finish();
    const before=rangeSnapshot(),beforeSelection=clipSelectionSnapshot();
    stopParameterPlayback();
    activeProject.arrangementClips=arrangementClips().filter(clip=>!mixerSelection.has(clip.id));
    mixerSelection.clear();selectedClipId='';selectedClipPointerRatio=0;clipEditorOpen=false;projectBlockSelection=null;
    recordClipEdit(before,beforeSelection);renderShell('set');return true;
  }

  function deleteSelectedItems() {
    const clipIds=new Set(mixerSelection),fxIds=new Set(window.AxiomDawFx?.selectedIdsForProject?.()||[]);
    if(!activeProject||(!clipIds.size&&!fxIds.size))return false;
    window.AxiomMixerHistory?.finish();
    const before=timelineSnapshot(),beforeSelection=clipSelectionSnapshot();
    stopParameterPlayback();
    activeProject.arrangementClips=arrangementClips().filter(clip=>!clipIds.has(clip.id));
    const previous=JSON.parse(before);window.AxiomFxFollow?.reconcile(activeProject,previous.arrangementClips,previous.fxRegions,previous.automationLanes);
    if(fxIds.size)window.AxiomDawFx?.deleteSelected?.({record:false});
    mixerSelection.clear();window.AxiomDawFx?.clearSelection?.();selectedClipId='';selectedClipPointerRatio=0;clipEditorOpen=false;projectBlockSelection=null;
    recordTimelineEdit(before,beforeSelection);renderShell('set');return true;
  }

  function reviewExportEnding(issue){
    if(!activeProject||issue?.signature!==JSON.stringify(activeProject))return false;
    const clips=arrangementClips().filter(c=>issue.clipIds.includes(c.id));
    clearRange();mixerSelection.clear();clips.forEach(c=>mixerSelection.add(c.id));
    selectedClipId=clips[0]?.id||'';clipEditorOpen=false;
    activeSectionId=clips[0]?.sectionId||(issue.patternIds.length?'instruments':'fx');
    activeProject.editCursorBeat=issue.end;
    viewBeats=0;viewStartBeat=0;zoomMode='arrange';
    renderShell('set');
    document.querySelector(`#studio-daw-lanes [data-daw-section="${activeSectionId}"]`)?.scrollIntoView({block:'center'});
    showToast?.('Full project shown. Later audio clips are selected for review.');return true;
  }

  function removeExportEnding(issue){
    if(!activeProject||issue?.signature!==JSON.stringify(activeProject))return false;
    const before=timelineSnapshot(),beforeSelection=clipSelectionSnapshot(),p=activeProject;
    stopParameterPlayback();
    const previous=JSON.parse(before);
    p.arrangementClips=arrangementClips().filter(c=>!issue.clipIds.includes(c.id));
    p.patternClips=(p.patternClips||[]).filter(c=>!issue.patternIds.includes(c.id));
    window.AxiomDawAutomation?.reconcileClips(p,previous.arrangementClips,previous.automationLanes);
    window.AxiomFxFollow?.reconcile(p,previous.arrangementClips,previous.fxRegions,previous.automationLanes);
    p.fxRegions=(p.fxRegions||[]).filter(f=>!issue.fxIds.includes(f.id));
    p.automationLanes=(p.automationLanes||[]).filter(l=>l.scope!=='fx'||p.fxRegions.some(f=>f.id===l.targetId));
    clearRange();mixerSelection.clear();selectedClipId='';clipEditorOpen=false;
    recordTimelineEdit(before,beforeSelection);viewBeats=0;viewStartBeat=0;zoomMode='arrange';renderShell('set');return true;
  }

  function repeatSelection() {
    const clip = selectedArrangementClip();
    if (!clip) return false;
    clipboardTrack = {
      ...clip,
      label: `${clip.label} Repeat`,
      repeatCount: Number(clip.repeatCount || 1) + 1,
      copiedFromClipId: clip.id,
    };
    pasteAfterSelection({ toast: false });
    if (typeof showToast === 'function') showToast(`Repeated: ${clip.label}`);
    return false;
  }

  async function openLibrarySearchForAdd() {
    let anchor = prepareDawLibraryAddAnchor();
    if (typeof switchTab === 'function') switchTab('library');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!window.AxiomDawFinder?.active) anchor = prepareDawLibraryAddAnchor();
      if (!window.AxiomDawFinder?.active) {
        if (typeof showToast === 'function') showToast('Library is still opening. Try Add Track again.', true);
        return;
      }
      const input = document.getElementById('main-search');
      if (typeof focusAxiomSongSearchInput === 'function') focusAxiomSongSearchInput(input);
      else input?.focus?.({ preventScroll: true });
      if (anchor) resetAndFetchLibSuggestions();
      else runSearch();
      if (typeof showToast === 'function') showToast(anchor
        ? `Find your next track after ${anchor.title || 'the project anchor'}.`
        : (pendingLayer ? `Choose audio for ${pendingLayer.sectionId} layer ${pendingLayer.layerIndex + 1}.` : 'Search Library. Add buttons place new tracks at the end of the project.'));
    }));
    return false;
  }

  function dawSurfaceIsVisible(){
    const shell=document.getElementById('studio-daw-shell'),tab=document.getElementById('tab-content-studio');
    return Boolean(activeProject&&shell&&!shell.classList.contains('hidden')&&!tab?.classList.contains('hidden')&&
      tab?.style?.display!=='none'&&!shell.closest?.('[hidden], [aria-hidden="true"]'));
  }
  function handleStudioDawKeyboard(event) {
    if (!dawSurfaceIsVisible()) return;
    if(event && !event.defaultPrevented && (event.metaKey||event.ctrlKey) && !event.altKey && !event.shiftKey &&
      (String(event.key||'').toLowerCase()==='f'||String(event.code||'').toLowerCase()==='keyf')){
      // Own Find while the DAW is visible so the general Studio shortcut cannot bypass deck selection.
      event.preventDefault();event.stopImmediatePropagation?.();event.stopPropagation();
      if(!event.repeat && ['left-deck','right-deck'].includes(activeSectionId) &&
        !dawKeyboardTargetIsEditable(event.target) && !event.target?.closest?.('dialog, [role="dialog"]'))beginAdd();
      return;
    }
    if(event && !event.defaultPrevented && (event.metaKey||event.ctrlKey) && !event.altKey && !event.shiftKey &&
      ['n','s'].includes(String(event.key).toLowerCase()) && !event.target?.closest?.('dialog, [role="dialog"]')){
      event.preventDefault();event.stopImmediatePropagation?.();event.stopPropagation();
      if(!event.repeat){if(String(event.key).toLowerCase()==='n')newBlankProject();else window.AxiomDawDrafts?.save();}
      return;
    }
    const historyCommand=event&&(event.metaKey||event.ctrlKey)&&String(event.key||'').toLowerCase()==='z';
    const clipboardCommand = event && (event.metaKey || event.ctrlKey) && ['c','x','v'].includes(String(event.key || '').toLowerCase());
    if (!event || event.defaultPrevented || (historyCommand ? dawHistoryTargetIsEditable(event.target) : clipboardCommand ? dawClipboardTargetIsEditable(event.target) : dawKeyboardTargetIsEditable(event.target))) return;
    const key = String(event.key || '').toLowerCase();
    const code = String(event.code || '').toLowerCase();
    const cmd = event.metaKey || event.ctrlKey;
    if(contextMenu?.markerSelection&&!cmd&&!event.altKey&&(key==='delete'||key==='backspace')){
      event.preventDefault();event.stopImmediatePropagation?.();event.stopPropagation();
      const {project,marker}=contextMenu.markerSelection;hideContextMenu();
      if(project===activeProject){const index=project.markers.indexOf(marker);if(index>=0)deleteMarker(index);}
      return;
    }
    if(cmd && !event.altKey && !event.shiftKey && key==='a' && !event.target?.closest?.('dialog, [role="dialog"]')) {
      event.preventDefault();event.stopImmediatePropagation?.();event.stopPropagation();
      clearRange();selectedBpmPoint=-1;bpmEditing=false;
      const clips=arrangementClips();
      mixerSelection.clear();clips.forEach(clip=>mixerSelection.add(clip.id));
      selectedClipId=clips[0]?.id||'';selectedClipIndex=Number(clips[0]?.trackIndex||0);clipEditorOpen=false;
      const fxCount=window.AxiomDawFx?.selectAll?.({render:false})||0;
      projectBlockSelection=activeProject;
      renderShell('set');
      showToast?.(`${clips.length} audio clips${fxCount?` and ${fxCount} FX regions`:''} selected.`);
      return;
    }
    if(!cmd&&event.target?.closest?.('.daw-note-grid')&&['delete','backspace','arrowup','arrowdown','arrowleft','arrowright'].includes(key))return;
    if(key==='escape' && rangeSelection){clearRange();return;}
    if(rangeSelection && !cmd && (key==='delete'||key==='backspace')) {
      event.preventDefault();event.stopImmediatePropagation?.();editRange('delete');return;
    }

    if(cmd && key==='z') {
      event.preventDefault(); event.stopImmediatePropagation?.(); event.stopPropagation();
      if(!window.AxiomEditHistory.undo(activeProject,event.shiftKey)&&typeof showToast==='function')showToast('No edit can be restored safely.',true);
      return;
    }
    if(!cmd && (key==='delete'||key==='backspace') && selectedBpmPoint>=0) {
      event.preventDefault(); event.stopImmediatePropagation?.(); event.stopPropagation();
      removeBpmPoint(); return;
    }
    if(activeSectionId==='instruments'&&window.AxiomPatterns?.keyboard(activeProject,event)){event.preventDefault();event.stopImmediatePropagation?.();event.stopPropagation();return;}
    if(!cmd && !event.altKey && (key==='delete'||key==='backspace') && !event.target?.closest?.('dialog, [role="dialog"]')) {
      if(deleteSelectedItems()){event.preventDefault();event.stopImmediatePropagation?.();event.stopPropagation();}
      return;
    }
    if(key==='enter' && event.target?.dataset?.bpmIndex!==undefined) {
      editBpmPoint(event,Number(event.target.dataset.bpmIndex)); return;
    }

    if (cmd && (key === 'e' || code === 'keye')) {
      event.preventDefault();
      event.stopPropagation();
      splitActiveClip();
      return;
    }
    if (cmd && (key === 'c' || code === 'keyc')) {
      event.preventDefault();
      event.stopImmediatePropagation?.();
      event.stopPropagation();
      copySelection();
      return;
    }
    if (cmd && !event.altKey && (key === 'x' || code === 'keyx') && !event.target?.closest?.('dialog, [role="dialog"]')) {
      if(cutSelection()){event.preventDefault();event.stopImmediatePropagation?.();event.stopPropagation();}
      return;
    }
    if (cmd && (key === 'v' || code === 'keyv')) {
      event.preventDefault();
      event.stopImmediatePropagation?.();
      event.stopPropagation();
      pasteAtCursor();
      return;
    }
    if (cmd && (key === 'd' || code === 'keyd')) {
      event.preventDefault();
      event.stopPropagation();
      duplicateSelection();
      return;
    }
    if (!cmd && !event.altKey && !event.shiftKey && (key === 'm' || code === 'keym')) {
      event.preventDefault();
      event.stopPropagation();
      addMarker();
      return;
    }
    if (!event.altKey && (cmd || event.shiftKey) && (event.key === '+' || event.key === '=')) {
      event.preventDefault();
      event.stopPropagation();
      if(zoomTarget==='source') zoomSource(1); else stepZoom(1);
      return;
    }
    if (!event.altKey && (cmd || event.shiftKey) && (event.key === '-' || event.key === '_')) {
      event.preventDefault();
      event.stopPropagation();
      if(zoomTarget==='source') zoomSource(-1); else stepZoom(-1);
      return;
    }
    if (!cmd && !event.altKey && event.code === 'Space') {
      if(event.target?.closest?.('dialog, [role="dialog"]'))return;
      if(event.repeat) {event.preventDefault();return;}
      event.preventDefault();
      event.stopImmediatePropagation?.();
      event.stopPropagation();
      if(window.AxiomDawTimelineRecording?.active){window.AxiomDawTimelineRecording.stop();return;}
      if (event.shiftKey) playFromStart();
      else if(patternPreviewProject===activeProject&&activeSectionId==='instruments'&&!clipEditorOpen){
        const pattern=window.AxiomPatterns?.active(activeProject);
        if(pattern?.kind==='midi'){
          if(window.AxiomInstruments?.previewing)window.AxiomArrangement.stop(false);
          else window.AxiomInstruments?.preview(pattern.id);
        }else if(window.AxiomBeatPreview?.playing)window.AxiomBeatPreview.stop();
        else window.AxiomBeatPreview?.play();
      }
      else if(zoomTarget==='source'&&clipEditorOpen)playSourceCue();
      else playOrToggle();
    }
  }

  function dawKeyboardTargetIsEditable(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest('input, textarea, select, option, [contenteditable="true"], [role="slider"]'));
  }

  function dawClipboardTargetIsEditable(target) {
    // Faders and gain knobs keep focus after an adjustment, but have no text
    // to copy. Clipboard commands there still belong to the selected clips.
    if (target instanceof Element && target.closest('.studio-daw-mixer-strip') &&
        target.closest('input[type="range"], [role="slider"]') &&
        !target.closest('dialog, [role="dialog"]')) return false;
    return dawKeyboardTargetIsEditable(target);
  }

  function dawHistoryTargetIsEditable(target){
    if(target?.closest?.('dialog, [role="dialog"]'))return true;
    if(target instanceof Element&&target.closest('select, input[type="range"], input[type="checkbox"], input[type="radio"], [role="slider"]'))return false;
    return dawKeyboardTargetIsEditable(target);
  }

  function handleClipKeydown(event, index) {
    if (!event || (event.key !== 'Enter' && event.key !== ' ')) return true;
    return playClip(index, event);
  }

  const gridHistories=new WeakMap(),gridRedos=new WeakMap();
  async function importSeratoGrid(provider='serato'){
    if(!['serato','djay'].includes(provider))return false;
    const clip=selectedArrangementClip(),project=activeProject;if(!clip)return false;
    const before=JSON.stringify(clip);
    try{
      const response=await fetch('/api/studio-daw/beatgrid/'+provider,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:clip.path})});
      if(response.status===404)throw new Error('Restart the local AXIOM engine to enable beatgrid import. Save your draft first.');
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Grid import failed.');
      if(activeProject!==project||clipByReference(clip.id)!==clip||JSON.stringify(clip)!==before)throw new Error('The clip changed during import. Select it and import again.');
      const grid=data.beatgrid;if(grid?.source!==provider||grid.trackPath!==clip.path||grid.readOnly!==true)throw new Error('The imported grid does not match this source.');
      applySourceGrid(clip.id,grid.beatAnchors,grid);return true;
    }catch(error){showToast(error.message,true);return false;}
  }
  function applySourceGrid(id,anchors,imported=null,alignment=null,repair=false) {
    const clip=clipByReference(id);if(!clip) throw new Error('Select an audio clip.');
    const localToClip=Boolean(alignment||clip.beatgrid?.metadata?.clipLocalAnchor||imported?.metadata?.clipLocalAnchor);
    let reference=imported||existing.createBeatgridReference({source:'manual',mode:'fluid',trackPath:clip.path,beatAnchors:anchors});
    if(localToClip)reference={...reference,metadata:{...reference.metadata,clipLocalAnchor:true}};
    if(reference.trackPath!==clip.path)throw new Error('Beatgrid belongs to another source.');
    const map=existing.compileBeatgrid(reference);
    const beforeClips=JSON.parse(rangeSnapshot()),beforeAutomation=JSON.stringify(activeProject.automationLanes||[]);
    const targets=localToClip?[clip]:[...new Set([...projectTracks(),activeProject.sourceTrack,...arrangementClips()].filter(t=>t?.path===clip.path&&!t.beatgrid?.metadata?.clipLocalAnchor))];
    const changes=targets.map(target=>{
      const patch={beatgrid:reference,gridStatus:'verified-anchors'};
      if(Number.isFinite(target.sourceStartBeat) && Number.isFinite(target.sourceDurationBeats)) {
        const start=existing.sourceBeatToSeconds(target,target.sourceStartBeat),end=existing.sourceBeatToSeconds(target,target.sourceStartBeat+target.sourceDurationBeats);
        patch.sourceStartBeat=map.secondsToBeat(start);patch.sourceDurationBeats=map.secondsToBeat(end)-patch.sourceStartBeat;
        if(alignment&&target===clip){
          if(!Number.isFinite(alignment.sourceSeconds)||alignment.sourceSeconds<0||end-alignment.sourceSeconds<1/48000)throw new Error('Choose a downbeat before the end of the clip.');
          const remaining=target.sourceStartBeat+target.sourceDurationBeats-existing.sourceSecondsToBeat(target,alignment.sourceSeconds);
          patch.sourceStartBeat=map.secondsToBeat(alignment.sourceSeconds);patch.sourceDurationBeats=map.secondsToBeat(end)-patch.sourceStartBeat;
          patch.sourceIntent='trimmed';patch.alignAudioStart=false;
          patch.timelineStartBeat=alignment.timelineStartBeat;
          patch.timelineDurationBeats=target.timelineDurationBeats*remaining/target.sourceDurationBeats;
        } else if(target.fluidSync&&!alignment){
          patch.timelineDurationBeats=patch.sourceDurationBeats;
          patch.timelineStartBeat=target.timelineStartBeat+patch.sourceStartBeat-target.sourceStartBeat;
          if(patch.timelineStartBeat<0)throw new Error('Move this clip later before correcting a grid that extends before the project start.');
        }
        if(Number.isFinite(target.stemSourceStart)) patch.stemSourceStart=map.secondsToBeat(existing.sourceBeatToSeconds(target,target.stemSourceStart));
      }
      return {target,patch,before:Object.fromEntries(Object.keys(patch).map(key=>[key,target[key]]))};
    });
    if(localToClip)changes.localClipId=clip.id;
    let nextAutomation=activeProject.automationLanes;
    if(alignment){
      changes.alignedClipId=clip.id;
      if(window.AxiomDawAutomation&&activeProject.automationLanes?.some(l=>l.scope==='clip')){
        const preview={...activeProject,arrangementClips:activeProject.arrangementClips.map(c=>{
          const old=beforeClips.find(o=>o.id===c.id);if(!old||c.path!==clip.path)return c;
          const next={...c,...changes.find(change=>change.target===c)?.patch};
          const start=existing.sourceSecondsToBeat(old,existing.sourceBeatToSeconds(next,next.sourceStartBeat));
          const end=existing.sourceSecondsToBeat(old,existing.sourceBeatToSeconds(next,next.sourceStartBeat+next.sourceDurationBeats));
          return {...next,sourceStartBeat:start,sourceDurationBeats:end-start};
        })};
        window.AxiomDawAutomation.reconcileClips(preview,beforeClips,JSON.parse(beforeAutomation));
        nextAutomation=localToClip?(activeProject.automationLanes||[]).flatMap(l=>l.scope==='clip'&&l.targetId===clip.id?preview.automationLanes.filter(n=>n.scope===l.scope&&n.targetId===l.targetId&&n.parameter===l.parameter):[l]):preview.automationLanes;
      }
      changes.automationBefore=beforeAutomation;changes.automationAfter=JSON.stringify(nextAutomation||[]);
    }
    if(repair){
      const preview={...activeProject,arrangementClips:activeProject.arrangementClips.map(c=>({...c,...changes.find(change=>change.target===c)?.patch}))};
      nextAutomation=(activeProject.automationLanes||[]).map(l=>{
        const change=l.scope==='clip'&&changes.find(change=>change.target.id===l.targetId);if(!change)return l;
        const old=change.target,start=change.patch.sourceStartBeat;
        return {...l,points:l.points.map(point=>({...point,beat:map.secondsToBeat(existing.sourceBeatToSeconds(old,old.sourceStartBeat+point.beat*old.sourceDurationBeats/old.timelineDurationBeats))-start}))};
      });
      preview.automationLanes=nextAutomation;
      window.AxiomFxFollow?.reconcile(preview,beforeClips,activeProject.fxRegions||[],nextAutomation);
      nextAutomation=preview.automationLanes;
      changes.alignedClipId=clip.id;
      changes.automationBefore=beforeAutomation;changes.automationAfter=JSON.stringify(nextAutomation);
      changes.fxBefore=JSON.stringify(activeProject.fxRegions||[]);changes.fxAfter=JSON.stringify(preview.fxRegions||[]);
    }
    window.AxiomArrangement?.stop(false);window.AxiomStems?.stop();
    const history=gridHistories.get(activeProject)||[];history.push(changes);if(history.length>50)history.shift();gridHistories.set(activeProject,history);
    gridRedos.set(activeProject,[]);
    changes.forEach(({target,patch})=>Object.assign(target,patch));
    if(alignment||repair)activeProject.automationLanes=nextAutomation;
    if(repair)activeProject.fxRegions=JSON.parse(changes.fxAfter);
    window.AxiomEditHistory.record(activeProject,'grid');
    renderShell('set');
    window.AxiomWaveformDetail?.refresh?.([...new Set(changes.map(change=>change.target.path).filter(Boolean))]);
    return true;
  }
  function undoSourceGrid(redo=false) {
    const source=redo?gridRedos:gridHistories,destination=redo?gridHistories:gridRedos;
    const history=source.get(activeProject),changes=history?.[history.length-1];if(!changes)return false;
    const path=changes[0].target.path;
    const targets=changes.localClipId?arrangementClips().filter(c=>c.id===changes.localClipId):[...new Set([...projectTracks(),activeProject.sourceTrack,...arrangementClips()].filter(t=>t?.path===path&&!t.beatgrid?.metadata?.clipLocalAnchor))];
    if(!targets.length)return false;
    const exact=dispatchingHistory||changes.alignedClipId&&targets.every(target=>{
      const change=changes.find(c=>c.target===target||(target.id&&c.target.id===target.id));
      return change&&Object.entries(redo?change.before:change.patch).every(([key,value])=>JSON.stringify(target[key])===JSON.stringify(value));
    });
    if(exact&&changes.automationBefore!==undefined&&JSON.stringify(activeProject.automationLanes||[])!==changes[redo?'automationBefore':'automationAfter'])return false;
    if(exact&&changes.fxBefore!==undefined&&JSON.stringify(activeProject.fxRegions||[])!==changes[redo?'fxBefore':'fxAfter'])return false;
    const patches=targets.map(target=>{
      const matched=changes.find(change=>change.target===target || (target.id&&change.target.id===target.id));
      const change=matched || changes[0];
      const desired=redo?change.patch:change.before;
      if(exact){
        const expected=redo?change.before:change.patch;
        if(!matched||Object.entries(expected).some(([key,value])=>JSON.stringify(target[key])!==JSON.stringify(value)))return null;
        return {target,patch:desired};
      }
      const restored={...target,beatgrid:desired.beatgrid};
      const patch={beatgrid:desired.beatgrid,gridStatus:desired.gridStatus};
      if(Number.isFinite(target.sourceStartBeat) && Number.isFinite(target.sourceDurationBeats)) {
        const start=existing.sourceBeatToSeconds(target,target.sourceStartBeat),end=existing.sourceBeatToSeconds(target,target.sourceStartBeat+target.sourceDurationBeats);
        patch.sourceStartBeat=existing.sourceSecondsToBeat(restored,start);patch.sourceDurationBeats=existing.sourceSecondsToBeat(restored,end)-patch.sourceStartBeat;
        if(target.fluidSync){
          patch.timelineDurationBeats=patch.sourceDurationBeats;
          patch.timelineStartBeat=target.timelineStartBeat+patch.sourceStartBeat-target.sourceStartBeat;
          if(patch.timelineStartBeat<0)return null;
        }
        if(Number.isFinite(target.stemSourceStart)) patch.stemSourceStart=existing.sourceSecondsToBeat(restored,existing.sourceBeatToSeconds(target,target.stemSourceStart));
      }
      return {target,patch};
    });
    if(patches.some(patch=>!patch))return false;
    const selected=selectedArrangementClip(),view=selected&&patches.some(patch=>patch.target===selected)?sourceViewSeconds(selected):null;
    window.AxiomArrangement?.stop(false);window.AxiomStems?.stop();
    history.pop();
    const next=destination.get(activeProject)||[];next.push(changes);destination.set(activeProject,next);
    patches.forEach(({target,patch})=>Object.entries(patch).forEach(([key,value])=>{if(value===undefined)delete target[key];else target[key]=value;}));
    if(view)restoreSourceViewSeconds(selected,view);
    if(exact&&changes.automationBefore!==undefined)activeProject.automationLanes=JSON.parse(changes[redo?'automationAfter':'automationBefore']);
    if(exact&&changes.fxBefore!==undefined)activeProject.fxRegions=JSON.parse(changes[redo?'fxAfter':'fxBefore']);
    // The dedicated grid command preserves later trims; those old snapshots must not be replayed.
    if(!dispatchingHistory)window.AxiomEditHistory.clear(activeProject);
    renderShell('set');return true;
  }
  async function detectDrumGrid(){
    const clip=selectedArrangementClip(),project=activeProject;if(!clipEditorOpen||clip?.stemState!=='ready'||!clip.stemJob)return false;
    const before=JSON.stringify(clip),url=`/api/studio-daw/stems/${encodeURIComponent(clip.stemJob)}/beatgrid`;
    const stillCurrent=()=>activeProject===project&&clipEditorOpen&&selectedArrangementClip()===clip&&clipByReference(clip.id)===clip&&JSON.stringify(clip)===before;
    try{
      const bpm=Number(clip.bpm),tempoHint=Number.isFinite(bpm)&&bpm>=20&&bpm<=400?bpm:null;
      let response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tempoHint})}),data=await response.json();
      if(!stillCurrent())return false;
      if(!response.ok)throw new Error(data.error||'Restart the local engine to enable drum beat analysis.');
      const deadline=Date.now()+180000;
      while(data.state==='processing'){
        if(Date.now()>deadline)throw new Error('Analysis is still running. Try Detect Drum Beats again shortly.');
        await new Promise(resolve=>setTimeout(resolve,750));
        if(!stillCurrent())return false;
        response=await fetch(url);data=await response.json();if(!response.ok)throw new Error(data.error||'Analysis unavailable.');
      }
      if(!stillCurrent())return false;
      if(data.state!=='ready')throw new Error(data.error||'Drum analysis failed.');
      if(data.sourcePath!==clip.path)throw new Error('The analysis no longer matches this clip.');
      if(data.tempoHint!==tempoHint)throw new Error('The analysis used a different source BPM. Run Detect Drum Beats again.');
      existing.validateDetectedBeatTimes(data.times);
      const first=Math.round(existing.sourceSecondsToBeat(clip,data.times[0]));
      editSourceGrid(clip.id,data.times.map((seconds,index)=>({beat:first+index,seconds})));return true;
    }catch(error){if(stillCurrent())showToast(error.message,true);return false;}
  }

  function editSourceGrid(id,proposal=null) {
    const clip=clipByReference(id);if(!clip)return;
    const project=activeProject,before=JSON.stringify(clip);
    document.getElementById('daw-grid-editor')?.remove();
    const dialog=document.createElement('dialog');dialog.id='daw-grid-editor';dialog.className='daw-grid-editor';dialog.setAttribute('aria-label','Source Beatgrid');
    const initial=proposal||clip.beatgrid?.beatAnchors || [{beat:0,seconds:0},{beat:4,seconds:240/(clip.bpm||120)}];
    dialog.innerHTML=`<form><h2>Source Beatgrid</h2><div class="daw-grid-title">${escapeHtml(clip.title || clip.label)}</div><div class="daw-grid-columns"><span>Source beat (0-based)</span><span>Time (seconds)</span><span></span></div><div class="daw-grid-rows"></div><p role="alert"></p><footer><button type="button" data-grid-add>Add Anchor</button><button type="button" data-grid-undo>Undo Grid Edit</button><button type="button" data-grid-cancel>Cancel</button><button type="submit">Apply</button></footer></form>`;
    const rows=dialog.querySelector('.daw-grid-rows'),error=dialog.querySelector('[role="alert"]');
    if(proposal){dialog.querySelector('h2').textContent='Review Drum Beats';error.textContent='Suggested beats only. Confirm beat numbering before applying.';}
    function row(point) {
      const element=document.createElement('div');element.className='daw-grid-columns';
      element.innerHTML='<input type="number" step="any" aria-label="Source beat" required><input type="number" step="any" min="0" aria-label="Source seconds" required><button type="button" aria-label="Remove anchor" title="Remove anchor">&times;</button>';
      const inputs=element.querySelectorAll('input');inputs[0].value=point.beat;inputs[1].value=point.seconds;
      element.querySelector('button').onclick=()=>element.remove();rows.append(element);
    }
    initial.forEach(row);
    if(proposal){
      const controls=document.createElement('div');controls.className='daw-grid-columns';
      controls.innerHTML='<label>First beat (0-based)<input type="number" step="1" aria-label="First detected beat number"></label><label>Beat spacing<select aria-label="Detected beat spacing"><option value="0.5">Half beat</option><option value="1" selected>One beat</option><option value="2">Two beats</option></select></label>';
      const first=controls.querySelector('input'),spacing=controls.querySelector('select');first.value=proposal[0].beat;
      const renumber=()=>{if(first.value.trim()===''||!Number.isFinite(Number(first.value)))return;Array.from(rows.children).forEach((element,index)=>{element.querySelector('input').value=Number(first.value)+index*Number(spacing.value);});};
      first.onchange=renumber;spacing.onchange=renumber;rows.before(controls);
    }
    dialog.querySelector('[data-grid-add]').onclick=()=>{const inputs=rows.lastElementChild?.querySelectorAll('input');row({beat:inputs?Number(inputs[0].value)+4:0,seconds:inputs?Number(inputs[1].value)+240/(clip.bpm||120):0});};
    dialog.querySelector('[data-grid-cancel]').onclick=()=>{dialog.close();dialog.remove();};
    dialog.querySelector('[data-grid-undo]').onclick=()=>{if(undoSourceGrid()){dialog.close();dialog.remove();}else error.textContent='No source grid edit to undo.';};
    dialog.querySelector('form').onsubmit=event=>{
      event.preventDefault();
      try {
        if(activeProject!==project||clipByReference(id)!==clip||JSON.stringify(clip)!==before)throw new Error('The clip changed. Close this editor and reopen it.');
        let anchors=Array.from(rows.children,element=>{const inputs=element.querySelectorAll('input');if(Array.from(inputs).some(input=>!input.value.trim()))throw new Error('Enter every beat and time.');return {beat:Number(inputs[0].value),seconds:Number(inputs[1].value)};});
        if(proposal){
          if(anchors.length<2)throw new Error('Keep at least two detected anchors.');
          const low=Math.min(...anchors.map(a=>a.seconds)),high=Math.max(...anchors.map(a=>a.seconds));
          anchors=[...(clip.beatgrid?.beatAnchors||[]).filter(a=>a.seconds<low||a.seconds>high),...anchors].sort((a,b)=>a.beat-b.beat);
        }
        applySourceGrid(id,anchors);dialog.close();dialog.remove();
      } catch(reason){error.textContent=reason.message;}
    };
    document.body.append(dialog);dialog.showModal();
  }

  function setClipPitch(id,semitones) {
    const clip=clipByReference(id);
    if(!clip || !Number.isFinite(semitones) || semitones < -24 || semitones > 24)return false;
    return writeParameters([{id:clip.id,key:'pitchSemitones',value:semitones},{key:'playbackMode',value:'preserve-pitch'}]);
  }
  function setNativeEffect(id,effect){
    const clip=clipByReference(id);if(!clip)return false;
    if(!window.AxiomNativeEffects)throw new Error('Native effect controls are unavailable. Reload the DAW.');
    window.AxiomNativeEffects.validate(effect);
    const changes=[{id:clip.id,key:'nativeEffect',value:effect}];
    if(effect?.enabled)changes.push({key:'playbackMode',value:'preserve-pitch'},{id:clip.id,key:'stemPlaybackMode',value:'original'});
    return writeParameters(changes);
  }
  function setPlaybackMode(mode){return ['resample','preserve-pitch'].includes(mode)&&writeParameters([{key:'playbackMode',value:mode}]);}
  function updateKeySyncControl(){
    const button=document.getElementById('daw-key-sync');if(!button)return;
    const clips=arrangementClips().filter(c=>mixerSelection.has(c.id));
    const synced=clips.filter(c=>c.keySync).length;
    button.disabled=!clips.length;button.setAttribute('aria-pressed',synced===clips.length&&synced?'true':synced?'mixed':'false');
    button.textContent='SYNC KEY';
    button.title=synced===clips.length&&synced?'Key sync on. Click to restore the selected clips\' original pitch.':'Match the selected clips to the anchor song';
  }
  function keySyncError(message){
    const dialog=document.createElement('dialog');dialog.id='daw-key-sync-error';dialog.className='daw-fx-dialog';
    dialog.setAttribute('aria-labelledby','daw-key-sync-error-title');
    const title=document.createElement('h2');title.id='daw-key-sync-error-title';title.textContent='Unable to sync key';
    const detail=document.createElement('p');detail.textContent=message;
    const unchanged=document.createElement('p');unchanged.textContent='No clips were changed.';
    const close=document.createElement('button');close.type='button';close.textContent='OK';close.onclick=()=>{dialog.close();dialog.remove();};
    dialog.addEventListener('cancel',()=>dialog.remove());dialog.append(title,detail,unchanged,close);document.body.append(dialog);dialog.showModal();
  }
  function toggleKeySync(){
    const clips=arrangementClips().filter(c=>mixerSelection.has(c.id));if(!clips.length)return false;
    if(clips.every(clip=>clip.keySync))return writeParameters(clips.map(clip=>({id:clip.id,key:'keySync',value:null})));
    try{
      // Validate the complete selection before writing a single undoable edit.
      const updates=clips.map(clip=>{
        const anchor=existing.anchorAtBeat(activeProject,clip.timelineStartBeat);
        const name=clip.title||clip.label||'Selected clip';
        if(!anchor?.path)throw new Error(`${name}: no anchor is available at this clip's entry point.`);
        if(anchor.path===clip.path)throw new Error(`${name} is the anchor song. Select the incoming clips you want to match to it.`);
        const anchorKey=anchor.keySync?.targetKey||anchor.keySync?.anchorKey||anchor.camelot;
        let match;
        try{match=existing.keySyncMatch(clip.camelot,anchorKey);}
        catch(error){throw new Error(`${name} (${clip.camelot||'key unknown'}) to anchor (${anchorKey||'key unknown'}): ${error.message}`);}
        return {id:clip.id,key:'keySync',value:{anchorPath:anchor.path,...match,transpose:match.transpose-Number(clip.pitchSemitones||0)}};
      });
      const changed=writeParameters([...updates,{key:'playbackMode',value:'preserve-pitch'}]);
      if(changed)for(const clip of clips)window.AxiomArrangement?.warmKeySync?.(activeProject,clip);
      return changed;
    }catch(error){keySyncError(error.message);return false;}
  }
  function setProjectMode(mode){
    if(!activeProject||!['mixtape','edit'].includes(mode))return false;
    const changes=[{key:'mode',value:mode}];
    if(mode==='edit'){
      const anchor=existing.anchorAtBeat(activeProject,activeProject.editCursorBeat||0);
      changes.push({key:'anchorPath',value:anchor?.path||activeProject.sourceTrack?.path||''});
    }
    if(mode==='mixtape' && shouldRegenerateMixtapeBpm(activeProject)){
      changes.push({key:'automationLanes',value:[...(activeProject.automationLanes||[]).filter(lane=>lane.parameter!=='bpm'),createMixtapeBpmLane(activeProject)]});
    }
    return writeParameters(changes);
  }
  function setTransitionAnchor(id){
    const clip=clipByReference(id);
    if(!clip||activeProject.mode!=='mixtape'||!['left-deck','right-deck'].includes(clip.sectionId))return false;
    const next=!clip.transitionAnchor;
    return writeParameters([{id:clip.id,key:'transitionAnchor',value:next}, ...(next ? [{key:'anchorPath',value:clip.path}] : [])]);
  }
  function makeClipAnchor(id){
    const clip=clipByReference(id);
    if(!clip||!['left-deck','right-deck'].includes(clip.sectionId)){
      window.showToast?.('Choose a Left Deck or Right Deck track to use as the anchor.', true);
      return false;
    }
    const changes=[{key:'anchorPath',value:clip.path}];
    if(activeProject.mode==='mixtape')changes.push({id:clip.id,key:'transitionAnchor',value:true});
    const changed=writeParameters(changes);
    if(changed)window.showToast?.(`${clip.title||clip.label||'Track'} is now the anchor for sync decisions.`);
    return changed;
  }
  function updateAnchorStatus(beat){
    if(!activeProject)return;
    updateKeySyncControl();
    const anchor=existing.anchorAtBeat(activeProject,beat),output=document.getElementById('daw-anchor-status');
    syncBpmDisplay(beat);
    if(output){const text=anchor?.path?`ANCHOR: ${anchor.title||anchor.label||'Track'}`:'NO ANCHOR';if(output.textContent!==text)output.textContent=text;output.title=text;}
  }
  function setPatternRow(row,steps){
    return setPatternRows({[row]:steps});
  }
  function setPatternRows(updates){
    const current=activeProject&&window.AxiomPatterns?.active(activeProject);
    if(!activeProject||!updates||typeof updates!=='object'||Array.isArray(updates)||Object.keys(updates).length>64)return false;
    for(const [row,steps] of Object.entries(updates)){
      const validRow=window.AxiomPatterns?window.AxiomPatterns.isDrumRow(row):['Kick','Snare','Hats','One Shot','Vocal Chop','Perc'].includes(row);
      if(!validRow||!Array.isArray(steps)||steps.some(n=>!Number.isInteger(n)||n<1||n>(current?.stepCount||64)))return false;
    }
    const normalized=Object.fromEntries(Object.entries(updates).map(([row,steps])=>[row,[...new Set(steps)].sort((a,b)=>a-b)]));
    if(window.AxiomPatterns){const pattern=window.AxiomPatterns.active(activeProject);
      if(!pattern)return Object.values(normalized).some(steps=>steps.length)?addPattern('drums',normalized):false;
      if(pattern.kind==='midi')return false;
      const clips=window.AxiomPatterns.list(activeProject).map(c=>c.id===pattern.id?{...c,steps:{...c.steps,...normalized}}:c);
      try{window.AxiomPatterns.validate(clips);}catch{return false;}
      return writeParameters([{key:'patternClips',value:clips}],{keepBeatPreview:true});}
    return writeParameters([{key:'stepPattern',value:{...activeProject.stepPattern,...normalized}}]);
  }
  function validDrumSamples(samples){
    return samples&&typeof samples==='object'&&!Array.isArray(samples)&&Object.keys(samples).length<=64&&Object.entries(samples).every(([row,s])=>window.AxiomPatterns?.isDrumRow(row)&&s&&typeof s.path==='string'&&s.path&&typeof s.name==='string');
  }
  function setDrumSamples(samples){
    if(!activeProject||!validDrumSamples(samples))return false;
    return writeParameters([{key:'drumSamples',value:samples}]);
  }
  function commitCreativeClip(p,expected,id,clip,fx,lanes){
    if(p!==activeProject||window.AxiomCreativeTools.signature(p)!==expected||!arrangementClips().some(c=>c.id===id))return false;
    const candidate={...p,arrangementClips:arrangementClips().map(c=>c.id===id?clip:c),fxRegions:fx,automationLanes:lanes};
    if(clip.assetIdentity)candidate.assetIdentities={...p.assetIdentities,[clip.path]:clip.assetIdentity};
    window.AxiomDawDrafts.serialize(candidate);
    const before=timelineSnapshot(p,true),beforeSelection=clipSelectionSnapshot();stopParameterPlayback();
    Object.assign(p,candidate);recordTimelineEdit(before,beforeSelection,true);sourceViews.delete(clip);renderShell('set');window.AxiomDawDrafts?.checkpoint();return true;
  }
  function setDrumRowOrder(order){
    window.AxiomPatterns.validateRowOrder(order);
    return writeParameters([{key:'drumRowOrder',value:order}],{keepBeatPreview:true});
  }
  function showPatternPage(page){
    if(window.AxiomDrumDraw?.active)return;
    const pattern=activeProject&&window.AxiomPatterns?.active(activeProject);
    if(!pattern||window.AxiomPatterns.page(activeProject,pattern)===page)return;
    window.AxiomPatterns.page(activeProject,pattern,page);renderStepEditor();
  }
  function selectPattern(id){window.AxiomPatterns?.select(activeProject,id);selectSection('instruments');renderStepEditor();}
  function addPattern(kind='drums',initialSteps={},options={}){
    if(!activeProject||!window.AxiomPatterns)return false;
    const clips=window.AxiomPatterns.list(activeProject),c={id:crypto.randomUUID(),name:`Drums ${clips.length+1}`,startBeat:Math.max(0,Math.round((activeProject.editCursorBeat||0)/4)*4),durationBeats:16,lengthBeats:16,steps:{...Object.fromEntries(Object.keys(window.AxiomPatterns.defaults).map(row=>[row,[]])),...initialSteps}};
    if(kind==='midi')Object.assign(c,{kind:'midi',name:`Instrument ${clips.length+1}`,notes:[],sound:'keys'});
    if(options.startBeat!==undefined){if(!Number.isFinite(options.startBeat)||options.startBeat<0)return false;c.startBeat=options.startBeat;}
    if(options.lengthBeats!==undefined){if(!Number.isFinite(options.lengthBeats)||options.lengthBeats<.25||options.lengthBeats>128)return false;c.lengthBeats=c.durationBeats=options.lengthBeats;}
    if(options.name!==undefined){if(typeof options.name!=='string'||!options.name.trim()||options.name.length>100)return false;c.name=options.name;}
    if(options.samples!==undefined&&!validDrumSamples(options.samples))return false;
    try{window.AxiomPatterns.validate([...clips,c]);}catch{return false;}
    const updates=[{key:'patternClips',value:[...clips,c]}];
    if(options.samples!==undefined)updates.push({key:'drumSamples',value:options.samples});
    window.AxiomPatterns.select(activeProject,c.id);return writeParameters(updates);
  }
  function editPattern(id,action,patch={},options={}){
    if(!activeProject||!window.AxiomPatterns)return false;
    if(options.samples!==undefined&&(action!=='apply'||!validDrumSamples(options.samples)))return false;
    const clips=JSON.parse(JSON.stringify(window.AxiomPatterns.list(activeProject))),index=clips.findIndex(c=>c.id===id);if(index<0&&action!=='paste')return false;
    if(action==='paste'){const c={...patch,id:crypto.randomUUID(),startBeat:snapBeat(Math.max(0,activeProject.editCursorBeat||0))};clips.push(c);window.AxiomPatterns.select(activeProject,c.id);}
    else if(action==='delete')clips.splice(index,1);
    else if(action==='duplicate'){const c=JSON.parse(JSON.stringify(clips[index]));c.id=crypto.randomUUID();c.startBeat+=c.durationBeats;clips.push(c);window.AxiomPatterns.select(activeProject,c.id);}
    else if(action==='apply')Object.assign(clips[index],patch);else return false;
    try{window.AxiomPatterns.validate(clips);}catch{return false;}
    const updates=[{key:'patternClips',value:clips}];
    if(options.samples!==undefined)updates.push({key:'drumSamples',value:options.samples});
    return writeParameters(updates);
  }
  function importPattern(clip,options={}){
    if(!activeProject||!window.AxiomPatterns)return false;
    if(options.samples!==undefined&&!validDrumSamples(options.samples))return false;
    const clips=[...window.AxiomPatterns.list(activeProject),JSON.parse(JSON.stringify(clip))];
    try{window.AxiomPatterns.validate(clips);}catch{return false;}
    window.AxiomPatterns.select(activeProject,clip.id);activeSectionId='instruments';clipEditorOpen=false;
    const updates=[{key:'patternClips',value:clips}];
    if(options.samples!==undefined)updates.push({key:'drumSamples',value:options.samples});
    return writeParameters(updates);
  }
  function setClipFades(id,fadeIn,fadeOut){
    const clip=clipByReference(id);
    if(!clip||![fadeIn,fadeOut].every(v=>Number.isFinite(v)&&v>=0)||fadeIn+fadeOut>clip.timelineDurationBeats)return false;
    window.AxiomArrangement?.stop(false);window.AxiomStems?.stop();
    const history=window.AxiomMixerHistory;
    if(history){history.begin(activeProject);history.write(activeProject,[{scope:'clip',id:clip.id}],'fadeInBeats',fadeIn);history.write(activeProject,[{scope:'clip',id:clip.id}],'fadeOutBeats',fadeOut);history.finish();}
    else {clip.fadeInBeats=fadeIn;clip.fadeOutBeats=fadeOut;}
    renderShell('set');return true;
  }
  function setClipFadeCurve(id,curve){
    const clip=clipByReference(id);if(!clip||!['linear','equal-power'].includes(curve))return false;
    window.AxiomArrangement?.stop(false);window.AxiomStems?.stop();
    if(window.AxiomMixerHistory)window.AxiomMixerHistory.write(activeProject,[{scope:'clip',id:clip.id}],'fadeCurve',curve);else clip.fadeCurve=curve;
    renderShell('set');return true;
  }
  function crossfadeSelection(){
    const clips=arrangementClips().filter(c=>mixerSelection.has(c.id)).sort((a,b)=>a.timelineStartBeat-b.timelineStartBeat);
    if(clips.length!==2)return null;
    const [outgoing,incoming]=clips;
    if(!clips.every(c=>[c.timelineStartBeat,c.timelineDurationBeats].every(Number.isFinite)))return null;
    const overlap=outgoing.timelineStartBeat+outgoing.timelineDurationBeats-incoming.timelineStartBeat;
    if(overlap<=0||outgoing.timelineStartBeat>=incoming.timelineStartBeat||outgoing.timelineStartBeat+outgoing.timelineDurationBeats>=incoming.timelineStartBeat+incoming.timelineDurationBeats)return null;
    if((outgoing.fadeInBeats||0)+overlap>outgoing.timelineDurationBeats||(incoming.fadeOutBeats||0)+overlap>incoming.timelineDurationBeats)return null;
    return {outgoing,incoming,overlap};
  }
  function crossfadeSelected(){
    const pair=crossfadeSelection();if(!pair){showToast('Select two staggered, overlapping clips with room for the transition fades.',true);return false;}
    window.AxiomArrangement?.stop(false);window.AxiomStems?.stop();
    const history=window.AxiomMixerHistory;history?.begin(activeProject);
    for(const [clip,key] of [[pair.outgoing,'fadeOutBeats'],[pair.incoming,'fadeInBeats']]){
      if(history){history.write(activeProject,[{scope:'clip',id:clip.id}],key,pair.overlap);history.write(activeProject,[{scope:'clip',id:clip.id}],'fadeCurve','equal-power');}
      else {clip[key]=pair.overlap;clip.fadeCurve='equal-power';}
    }
    history?.finish();renderShell('set');return true;
  }
  function renderFadeHandles(clip,start,end){
    const duration=clip.timelineDurationBeats;
    let input=Math.max(0,Number(clip.fadeInBeats)||0),output=Math.max(0,Number(clip.fadeOutBeats)||0);
    if(input+output>duration){const scale=duration/(input+output);input*=scale;output*=scale;}
    return [['in',input,clip.timelineStartBeat],['out',output,clip.timelineStartBeat+duration-output]].map(([edge,length,origin])=>{
      const point=edge==='in'?origin+length:origin,pct=(point-start)/(end-start)*100;
      const curve=clip.fadeCurve==='equal-power'?`;clip-path:polygon(0 0,100% 0,${Array.from({length:17},(_,i)=>{const x=1-i/16,gain=Math.sin((edge==='in'?x:1-x)*Math.PI/2);return `${x*100}% ${(1-gain)*100}%`;}).join(',')})`:'';
      const shade=length?`<span class="daw-fade-shade ${edge}" aria-hidden="true" style="left:${(origin-start)/(end-start)*100}%;width:${length/(end-start)*100}%${curve}"></span>`:'';
      if(point<start||point>end)return shade;
      return shade+`<button type="button" class="daw-fade-handle" data-fade-edge="${edge}" aria-label="Adjust fade ${edge}" title="Fade ${edge}: ${length/4} bars" style="left:clamp(8px,${pct}%,calc(100% - 8px))" onpointerdown="AxiomStudioDaw.dragFade(event,'${escapeHtml(clip.id)}','${edge}')" onkeydown="AxiomStudioDaw.fadeKey(event,'${escapeHtml(clip.id)}','${edge}')" onclick="event.stopPropagation()" ondblclick="event.stopPropagation()"></button>`;
    }).join('');
  }
  function fadeKey(event,id,edge){
    if(!['ArrowLeft','ArrowRight','Home'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();const c=clipByReference(id);if(!c)return;
    const other=Math.min(c.timelineDurationBeats,Number(c[edge==='in'?'fadeOutBeats':'fadeInBeats'])||0);
    const delta=(event.key==='ArrowRight'?1:-1)*(edge==='in'?1:-1)*gridStepBeats();
    const value=event.key==='Home'?0:Math.max(0,Math.min(c.timelineDurationBeats-other,(Number(c[edge==='in'?'fadeInBeats':'fadeOutBeats'])||0)+delta));
    setClipFades(id,edge==='in'?value:other,edge==='out'?value:other);
    document.querySelector(`[data-daw-clip-id="${id}"] [data-fade-edge="${edge}"]`)?.focus();
  }
  function dragFade(event,id,edge){
    if(event.button!==0)return;event.preventDefault();event.stopPropagation();
    const c=clipByReference(id),target=event.currentTarget,article=target.closest('.studio-daw-clip'),lane=article?.parentElement;if(!c||!lane)return;
    const p=activeProject,rect=lane.getBoundingClientRect(),span=viewBeats||timelineWorkspaceBeats(),start=c.timelineStartBeat,end=start+c.timelineDurationBeats;
    const other=Math.min(c.timelineDurationBeats,Number(c[edge==='in'?'fadeOutBeats':'fadeInBeats'])||0),initial=Number(c[edge==='in'?'fadeInBeats':'fadeOutBeats'])||0;
    let value=initial,moved=false;target.setPointerCapture(event.pointerId);
    target.onpointermove=e=>{
      if(Math.abs(e.clientX-event.clientX)<3&&!moved)return;moved=true;
      const origin=edge==='in'?start+initial:end-initial,point=snapBeat(origin+(e.clientX-event.clientX)/rect.width*span,e,c);
      value=Math.max(0,Math.min(c.timelineDurationBeats-other,edge==='in'?point-start:end-point));
      const beat=edge==='in'?start+value:end-value,visibleStart=Math.max(start,viewStartBeat),visibleEnd=Math.min(end,viewStartBeat+span);
      target.style.left=`clamp(8px,${(beat-visibleStart)/(visibleEnd-visibleStart)*100}%,calc(100% - 8px))`;target.title=`Fade ${edge}: ${Number((value/4).toFixed(4))} bars`;
    };
    target.onpointerup=target.onpointercancel=e=>{
      target.onpointermove=target.onpointerup=target.onpointercancel=null;
      if(activeProject!==p||clipByReference(id)!==c)return;
      if(e.type==='pointercancel'||!moved){renderShell('set');return;}
      setClipFades(id,edge==='in'?value:other,edge==='out'?value:other);
    };
  }

  function openClipMenu(event, clipId) {
    const clip = clipByReference(clipId);
    if (!clip) return true;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    selectClip(clip.id, { pointerRatio: clipPointerRatio(event), render: true, preserveSelection:mixerSelection.has(clip.id) });
    hideContextMenu();

    const clipFxScopeChoice = ['samples','recordings','instruments'].includes(clip.sectionId);
    contextMenu = document.createElement('div');
    contextMenu.className = 'studio-daw-context-menu';
    contextMenu.setAttribute('role', 'menu');
    contextMenu.setAttribute('aria-label', 'Studio DAW clip actions');
    contextMenu.innerHTML = `
      <button type="button" role="menuitem" data-studio-daw-menu-action="key-sync">Sync Key</button>
      ${['left-deck','right-deck'].includes(clip.sectionId)?`<button type="button" role="menuitem" data-studio-daw-menu-action="make-anchor">Make anchor for sync</button>`:''}
      ${activeProject.mode==='mixtape'&&['left-deck','right-deck'].includes(clip.sectionId)?`<button type="button" role="menuitemcheckbox" aria-checked="${Boolean(clip.transitionAnchor)}" data-studio-daw-menu-action="transition-anchor">${clip.transitionAnchor?'Stop using as transition anchor':'Use as transition anchor'}</button>`:''}
      ${clipFxScopeChoice?`
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="echo-clip">Echo on selected clip</button>
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="echo-layer">Echo on layer</button>
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="reverb-clip">Reverb on selected clip</button>
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="reverb-layer">Reverb on layer</button>
      `:`
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="echo-out">Echo Out</button>
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="echo">Echo</button>
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="reverb">Reverb</button>
      `}
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="filter">Filter automation...</button>
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="tape-stop">Tape Stop on selected clip (last bar)</button>
      <button type="button" role="menuitem" data-studio-daw-menu-action="stutter">Stutter on selected clip...</button>
      <button type="button" role="menuitem" data-studio-daw-menu-action="build">One-knob Build...</button>
      <button type="button" role="menuitem" data-studio-daw-menu-action="chop">Chop to Pads...</button>
      <button type="button" role="menuitem" data-studio-daw-menu-action="freeze">${clip.frozenClip?'Unfreeze Clip':'Freeze Clip...'}</button>
      <button type="button" role="menuitem" data-studio-daw-menu-action="fix-beat">Fix Beat (pin neighbours)...</button>
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="lowpass">Low-pass filter...</button>
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="highpass">High-pass filter...</button>
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="play"><span>P</span>Play From Here</button>
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="split"><span>E</span>Split Clip Here</button>
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="marker"><span>M</span>Add Label Marker</button>
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="duplicate"><span>D</span>Duplicate</button>
      <button type="button" role="menuitemcheckbox" aria-checked="${Boolean(clip.reversed)}" data-axiom-cta-skip="true" data-studio-daw-menu-action="reverse"><span>Rev</span>${clip.reversed ? 'Restore Forward Audio' : 'Reverse Clip Audio'}</button>
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="reverb-tail"><span>Tail</span>Render Reverb Tail</button>
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="repeat"><span>R</span>Repeat</button>
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="stem"><span>S</span>Stem Section</button>
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="zoom"><span>1</span>Zoom To 1 Bar</button>
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="grid">Edit Source Beatgrid</button>
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="tempo-half">Correct BPM to Half-Time (${Number(clip.bpm || 0).toFixed(1)})</button>
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="tempo-double">Correct BPM to Double-Time (${Number(clip.bpm || 0).toFixed(1)})</button>
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="pitch">Pitch Shift (${Number(clip.pitchSemitones||0)} st)</button>
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="native">Audio Unit Effect${clip.nativeEffect?clip.nativeEffect.enabled?' (On)':' (Bypassed)':''}</button>
      <button type="button" role="menuitem" data-studio-daw-menu-action="fades">Clip Fades (${Number(clip.fadeInBeats||0)/4} / ${Number(clip.fadeOutBeats||0)/4} bars)</button>
      <button type="button" role="menuitem" data-studio-daw-menu-action="crossfade" ${crossfadeSelection()?'':'disabled'} title="Two staggered overlapping clips required">Crossfade Selected Clips</button>
      <button type="button" role="menuitemcheckbox" aria-checked="${clip.fadeCurve==='equal-power'}" data-studio-daw-menu-action="fade-curve">Equal-power Fades</button>
      <button type="button" role="menuitemcheckbox" aria-checked="${!clip.snapDisabled}" data-studio-daw-menu-action="snap">${clip.snapDisabled ? 'Enable' : 'Disable'} Snap For This Clip</button>
    `;
    const effectOwner=activeProject,effectClipIds=arrangementClips().filter(c=>mixerSelection.has(c.id)).map(c=>c.id);
    for(const [action,kind] of [['chop','chop'],['freeze',clip.frozenClip?'unfreeze':'freeze'],['fix-beat','timing']])contextMenu.querySelector(`[data-studio-daw-menu-action="${action}"]`)?.addEventListener('click',()=>{hideContextMenu();if(activeProject===effectOwner)window.AxiomCreativeTools.open(kind,clip);});
    for(const [action,type] of [['stutter','beatRepeat'],['build','transitionBuild']])contextMenu.querySelector(`[data-studio-daw-menu-action="${action}"]`)?.addEventListener('click',()=>{hideContextMenu();if(activeProject===effectOwner)window.AxiomDawFx.edit(null,{type,target:clip.sectionId,clipId:clip.id,startBeat:clip.timelineStartBeat,durationBeats:Math.min(4,clip.timelineDurationBeats),tailBeats:0,wet:1});});

    contextMenu.querySelector('[data-studio-daw-menu-action="make-anchor"]')?.addEventListener('click',()=>{hideContextMenu();if(activeProject===effectOwner)makeClipAnchor(clip.id);});
    contextMenu.querySelector('[data-studio-daw-menu-action="transition-anchor"]')?.addEventListener('click',()=>{hideContextMenu();if(activeProject===effectOwner)setTransitionAnchor(clip.id);});
    contextMenu.querySelector('[data-studio-daw-menu-action="key-sync"]')?.addEventListener('click',()=>{hideContextMenu();if(activeProject===effectOwner)toggleKeySync();});
    for(const [action,type,scope] of [['tape-stop','tapeStop','clip'],['echo-out','echoOut','layer'],['echo','echo','layer'],['reverb','reverb','layer'],['echo-clip','echo','clip'],['echo-layer','echo','layer'],['reverb-clip','reverb','clip'],['reverb-layer','reverb','layer']])contextMenu.querySelector(`[data-studio-daw-menu-action="${action}"]`)?.addEventListener('click',click=>{
      click.stopPropagation();hideContextMenu();
      if(activeProject!==effectOwner)return;
      window.AxiomDawFx?.quickApplyClips(type,effectClipIds,{scope});
    });
    for(const [action,startValue] of [['filter',null],['lowpass',-80],['highpass',80]])contextMenu.querySelector(`[data-studio-daw-menu-action="${action}"]`)?.addEventListener('click',click=>{
      click.stopPropagation();hideContextMenu();if(activeProject!==effectOwner)return;
      window.AxiomDawAutomation?.edit(effectClipIds.map(targetId=>({scope:'clip',targetId})),'filterPosition',startValue);
    });
    contextMenu.querySelector('[data-studio-daw-menu-action="grid"]')?.addEventListener('click',()=>{hideContextMenu();editSourceGrid(clip.id);});
    contextMenu.querySelector('[data-studio-daw-menu-action="tempo-half"]')?.addEventListener('click',()=>{hideContextMenu();correctClipBpm('half',clip.id);});
    contextMenu.querySelector('[data-studio-daw-menu-action="tempo-double"]')?.addEventListener('click',()=>{hideContextMenu();correctClipBpm('double',clip.id);});
    contextMenu.querySelector('[data-studio-daw-menu-action="native"]')?.addEventListener('click',()=>{hideContextMenu();window.AxiomNativeEffects?.open(clip.id);});
    contextMenu.querySelector('[data-studio-daw-menu-action="crossfade"]')?.addEventListener('click',()=>{hideContextMenu();crossfadeSelected();});
    contextMenu.querySelector('[data-studio-daw-menu-action="fade-curve"]')?.addEventListener('click',()=>{hideContextMenu();setClipFadeCurve(clip.id,clip.fadeCurve==='equal-power'?'linear':'equal-power');});
    contextMenu.querySelector('[data-studio-daw-menu-action="fades"]')?.addEventListener('click',()=>{
      hideContextMenu();const fadeIn=window.prompt('Fade-in length in bars (0 disables)',String(Number(clip.fadeInBeats||0)/4));if(fadeIn===null||!fadeIn.trim())return;
      const fadeOut=window.prompt('Fade-out length in bars (0 disables)',String(Number(clip.fadeOutBeats||0)/4));if(fadeOut===null||!fadeOut.trim())return;
      if(!setClipFades(clip.id,Number(fadeIn)*4,Number(fadeOut)*4))showToast('Fade lengths must be nonnegative and fit within this clip.',true);
    });
    contextMenu.querySelector('[data-studio-daw-menu-action="pitch"]')?.addEventListener('click',()=>{
      hideContextMenu();const raw=window.prompt('Pitch shift in semitones (-24 to 24). Uses Preserve Pitch mode.',String(clip.pitchSemitones||0));
      if(raw===null || !raw.trim())return;
      if(!setClipPitch(clip.id,Number(raw)))showToast('Enter a pitch shift between -24 and 24 semitones.',true);
    });
    contextMenu.querySelector('[data-studio-daw-menu-action="snap"]')?.addEventListener('click', () => {
      clip.snapDisabled = !clip.snapDisabled;
      hideContextMenu();
    });
    contextMenu.querySelector('[data-studio-daw-menu-action="play"]')?.addEventListener('click', clickEvent => {
      clickEvent.stopPropagation();
      if(window.AxiomArrangement) window.AxiomArrangement.play(activeProject,existing.compileTempoMap(activeProject).beatToSeconds(activeProject.editCursorBeat));
      else playClip(clip.id, null, { pointerRatio: selectedClipPointerRatio });
      hideContextMenu();
    });
    contextMenu.querySelector('[data-studio-daw-menu-action="split"]')?.addEventListener('click', clickEvent => {
      clickEvent.stopPropagation();
      splitActiveClip();
      hideContextMenu();
    });
    contextMenu.querySelector('[data-studio-daw-menu-action="marker"]')?.addEventListener('click', clickEvent => {
      clickEvent.stopPropagation();
      addMarker();
      hideContextMenu();
    });
    contextMenu.querySelector('[data-studio-daw-menu-action="duplicate"]')?.addEventListener('click', clickEvent => {
      clickEvent.stopPropagation();
      duplicateSelection();
      hideContextMenu();
    });
    contextMenu.querySelector('[data-studio-daw-menu-action="reverse"]')?.addEventListener('click', clickEvent => {
      clickEvent.stopPropagation();
      toggleClipReverse(clip.id);
      hideContextMenu();
    });
    contextMenu.querySelector('[data-studio-daw-menu-action="reverb-tail"]')?.addEventListener('click', clickEvent => {
      clickEvent.stopPropagation();
      renderReverbTailForClip(clip.id);
      hideContextMenu();
    });
    contextMenu.querySelector('[data-studio-daw-menu-action="repeat"]')?.addEventListener('click', clickEvent => {
      clickEvent.stopPropagation();
      repeatSelection();
      hideContextMenu();
    });
    contextMenu.querySelector('[data-studio-daw-menu-action="zoom"]')?.addEventListener('click', clickEvent => {
      clickEvent.stopPropagation();
      setZoom('bar');
      hideContextMenu();
    });
    contextMenu.querySelector('[data-studio-daw-menu-action="stem"]')?.addEventListener('click', clickEvent => {
      clickEvent.stopPropagation();
      window.AxiomStems?.request(clip);
      hideContextMenu();
    });
    document.body.appendChild(contextMenu);

    contextMenu.style.maxHeight='calc(100vh - 16px)';contextMenu.style.overflowY='auto';
    const left = Math.min(event?.clientX || 16, window.innerWidth - contextMenu.offsetWidth - 8);
    const top = Math.min(event?.clientY || 16, window.innerHeight - contextMenu.offsetHeight - 8);
    contextMenu.style.left = `${Math.max(8, left)}px`;
    contextMenu.style.top = `${Math.max(8, top)}px`;
    contextMenu.querySelector('button')?.focus();
    return false;
  }

  function openLaneMenu(event, sectionId) {
    const section = arrangementSections.find(item => item.id === sectionId);
    if (!section) return true;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if(contextMenu?.dataset.laneMenu===sectionId){hideContextMenu();return false;}
    if(activeSectionId!==sectionId)selectSection(sectionId);
    hideContextMenu();

    const layered = layeredArrangementSections.has(sectionId);
    const clip = selectedArrangementClip();
    const clipInLane = clip && clip.sectionId === sectionId;
    const cursorBeat = activeProject?.editCursorBeat || 0;
    contextMenu = document.createElement('div');
    contextMenu.className = 'studio-daw-context-menu studio-daw-lane-menu';
    contextMenu.dataset.laneMenu=sectionId;
    contextMenu.setAttribute('role', 'menu');
    contextMenu.setAttribute('aria-label', `${section.label} actions`);
    contextMenu.innerHTML = `
      <strong>${escapeHtml(section.label)}</strong>
      <small>${escapeHtml(section.hint)}</small>
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-lane-colour-toggle aria-expanded="false">Change colour</button>
      <div class="daw-lane-colour-palette" role="group" aria-label="${escapeHtml(section.label)} colour" hidden>
        ${laneColours.map(([label,colour])=>`<button type="button" data-lane-colour="${colour}" data-axiom-cta-skip="true" aria-label="${label}" title="${label}" aria-pressed="${laneColour(sectionId)===colour}" style="--swatch-colour:${colour}"></button>`).join('')}
        <button type="button" data-lane-colour="" data-axiom-cta-skip="true" class="daw-lane-colour-reset">Default colour</button>
      </div>
      ${sectionId==='samples'?'<button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="sample-bank">Open Sample Bank</button><button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="sample-import">Import Sample Files</button>':''}
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="add-marker">Add label marker at cursor</button>
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="volume" ${clipInLane ? '' : 'disabled'}>Automate selected clip volume</button>
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="filter" ${clipInLane ? '' : 'disabled'}>Automate selected clip filter</button>
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="fx">Add FX to layer</button>
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="fx-clip" ${clipInLane ? '' : 'disabled'}>Add FX to selected clip</button>
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="add">${layered ? 'Add layer' : 'Add track'}</button>
      ${layered ? '<button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="expand">Show lane layers</button>' : ''}
    `;
    const colourOwner=activeProject;
    contextMenu.querySelector('[data-lane-colour-toggle]').addEventListener('click',click=>{
      click.stopPropagation();
      const palette=contextMenu.querySelector('.daw-lane-colour-palette');
      palette.hidden=!palette.hidden;
      click.currentTarget.setAttribute('aria-expanded',String(!palette.hidden));
    });
    contextMenu.querySelectorAll('[data-lane-colour]').forEach(button=>button.addEventListener('click',click=>{
      click.stopPropagation();
      if(activeProject!==colourOwner)return;
      const colour=button.dataset.laneColour;
      const colours={...activeProject.laneColours};
      if(colour)colours[sectionId]=colour;else delete colours[sectionId];
      if(Object.keys(colours).length)activeProject.laneColours=colours;else delete activeProject.laneColours;
      renderTrackStack();renderLanes();hideContextMenu();
      window.AxiomDawDrafts?.checkpoint?.();
    }));
    contextMenu.querySelector('[data-studio-daw-menu-action="sample-bank"]')?.addEventListener('click', clickEvent => {
      clickEvent.stopPropagation();
      openSampleBankDialog();
      hideContextMenu();
    });
    contextMenu.querySelector('[data-studio-daw-menu-action="sample-import"]')?.addEventListener('click', clickEvent => {
      clickEvent.stopPropagation();
      openSampleBankDialog({focusImport:true});
      hideContextMenu();
    });
    contextMenu.querySelector('[data-studio-daw-menu-action="add-marker"]')?.addEventListener('click', clickEvent => {
      clickEvent.stopPropagation();
      addMarker(cursorBeat);
      hideContextMenu();
    });
    contextMenu.querySelector('[data-studio-daw-menu-action="volume"]')?.addEventListener('click', clickEvent => {
      clickEvent.stopPropagation();
      if (clipInLane) openInspectorAutomation('volume');
      hideContextMenu();
    });
    contextMenu.querySelector('[data-studio-daw-menu-action="filter"]')?.addEventListener('click', clickEvent => {
      clickEvent.stopPropagation();
      if (clipInLane) openInspectorAutomation('filterPosition');
      hideContextMenu();
    });
    contextMenu.querySelector('[data-studio-daw-menu-action="fx"]')?.addEventListener('click', clickEvent => {
      clickEvent.stopPropagation();
      window.AxiomDawFx?.edit?.(null, { target: sectionId, startBeat: cursorBeat, durationBeats: 16 });
      hideContextMenu();
    });
    contextMenu.querySelector('[data-studio-daw-menu-action="fx-clip"]')?.addEventListener('click', clickEvent => {
      clickEvent.stopPropagation();
      if (clipInLane) window.AxiomDawFx?.edit?.(null, { target: clip.sectionId, clipId: clip.id, startBeat: clip.timelineStartBeat, durationBeats: clip.timelineDurationBeats });
      hideContextMenu();
    });
    contextMenu.querySelector('[data-studio-daw-menu-action="add"]')?.addEventListener('click', clickEvent => {
      clickEvent.stopPropagation();
      beginAdd();
      hideContextMenu();
    });
    contextMenu.querySelector('[data-studio-daw-menu-action="expand"]')?.addEventListener('click', clickEvent => {
      clickEvent.stopPropagation();
      selectSection(sectionId);
      hideContextMenu();
    });
    document.body.appendChild(contextMenu);

    contextMenu.style.maxHeight = 'calc(100vh - 16px)';
    contextMenu.style.overflowY = 'auto';
    const trigger=document.querySelector(`[data-section-head="${sectionId}"] .daw-lane-menu-trigger`);
    const anchor=trigger?.getBoundingClientRect();
    const left = Math.min((anchor?.right||244)-contextMenu.offsetWidth, window.innerWidth - contextMenu.offsetWidth - 8);
    const below=(anchor?.bottom||8)+6;
    const top = below+contextMenu.offsetHeight<=window.innerHeight-8?below:(anchor?.top||16)-contextMenu.offsetHeight-6;
    contextMenu.style.left = `${Math.max(8, left)}px`;
    contextMenu.style.top = `${Math.max(8, top)}px`;
    contextMenu.querySelector('button')?.focus();
    return false;
  }

  function openTrackMenu(event, index) {
    const track = trackByIndex(index);
    if (!track || track.missing_placeholder) return true;
    event.preventDefault();
    event.stopPropagation();
    hideContextMenu();

    contextMenu = document.createElement('div');
    contextMenu.className = 'studio-daw-context-menu';
    contextMenu.setAttribute('role', 'menu');
    contextMenu.setAttribute('aria-label', 'Studio DAW track actions');
    contextMenu.innerHTML = activeProject
      ? `
        <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="append">Add to Studio DAW Project</button>
        <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="new-edit">Make New Studio DAW Edit</button>
        <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="mixtape">Make Mixtape from Studio Set</button>
      `
      : `
        <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="new-edit">Make An Edit To This Track</button>
        <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="mixtape">Make Mixtape from Studio Set</button>
      `;
    contextMenu.querySelector('[data-studio-daw-menu-action="append"]')?.addEventListener('click', clickEvent => {
      clickEvent.stopPropagation();
      if (window.AxiomDawFinder?.active) window.AxiomDawFinder.add(track);
      else addTrackToProject(track);
      hideContextMenu();
    });
    contextMenu.querySelector('[data-studio-daw-menu-action="new-edit"]')?.addEventListener('click', clickEvent => {
      clickEvent.stopPropagation();
      openTrackByIndex(index);
      hideContextMenu();
    });
    contextMenu.querySelector('[data-studio-daw-menu-action="mixtape"]')?.addEventListener('click', clickEvent => {
      clickEvent.stopPropagation();
      showStudioDawSetProject(activeTrackList());
      hideContextMenu();
    });
    document.body.appendChild(contextMenu);

    contextMenu.style.maxHeight = 'calc(100vh - 16px)';
    contextMenu.style.overflowY = 'auto';
    const left = Math.min(event.clientX, window.innerWidth - contextMenu.offsetWidth - 8);
    const top = Math.min(event.clientY, window.innerHeight - contextMenu.offsetHeight - 8);
    contextMenu.style.left = `${Math.max(8, left)}px`;
    contextMenu.style.top = `${Math.max(8, top)}px`;
    contextMenu.querySelector('button')?.focus();
    return false;
  }

  function normalizeLibraryMenuTrack(trackOrPath) {
    if (trackOrPath && typeof trackOrPath === 'object') return stableTrackCopy(trackOrPath);
    const path = String(trackOrPath || '');
    const cached = typeof trackVisualCache !== 'undefined' ? trackVisualCache.get(path) : null;
    return stableTrackCopy(cached || { path, title: path.split(/[\\/]/).pop() || 'Track' });
  }

  function openLibraryTrackMenu(event, trackOrPath) {
    const track = normalizeLibraryMenuTrack(trackOrPath);
    if (!track.path) return true;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    hideContextMenu();

    const addLabel = activeProject ? 'Add to Studio DAW Project' : 'Make Studio DAW Edit';
    contextMenu = document.createElement('div');
    contextMenu.className = 'studio-daw-context-menu';
    contextMenu.setAttribute('role', 'menu');
    contextMenu.setAttribute('aria-label', 'Library Studio DAW actions');
    contextMenu.innerHTML = `
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="add">${escapeHtml(addLabel)}</button>
      <button type="button" role="menuitem" data-axiom-cta-skip="true" data-studio-daw-menu-action="set">Add to Studio Set</button>
    `;
    contextMenu.querySelector('[data-studio-daw-menu-action="add"]')?.addEventListener('click', clickEvent => {
      clickEvent.stopPropagation();
      if (window.AxiomDawFinder?.active) window.AxiomDawFinder.add(track);
      else addTrackToProject(track);
      hideContextMenu();
    });
    contextMenu.querySelector('[data-studio-daw-menu-action="set"]')?.addEventListener('click', clickEvent => {
      clickEvent.stopPropagation();
      if (typeof addTrackFromLibrary === 'function') {
        addTrackFromLibrary(track.path, track.title, track.artist, track.bpm, track.camelot, track.energy, track.genre, { forceStudioSet: true });
      }
      hideContextMenu();
    });
    document.body.appendChild(contextMenu);

    const left = Math.min(event?.clientX || 16, window.innerWidth - 280);
    const top = Math.min(event?.clientY || 16, window.innerHeight - 96);
    contextMenu.style.left = `${Math.max(8, left)}px`;
    contextMenu.style.top = `${Math.max(8, top)}px`;
    contextMenu.querySelector('button')?.focus();
    return false;
  }

  function hideContextMenu() {
    contextMenu?.remove();
    contextMenu = null;
  }

  function studioRowIndexFromEvent(event) {
    const row = event?.target?.closest?.('#active-playlist-container .playlist-row[data-path]');
    if (!row) return -1;
    const rows = Array.from(document.querySelectorAll('#active-playlist-container .playlist-row[data-path]'));
    return rows.indexOf(row);
  }

  function handleStudioPlaylistContextMenu(event) {
    const index = studioRowIndexFromEvent(event);
    if (index < 0) return;
    openTrackMenu(event, index);
  }

  function openTrackByIndex(index) {
    return showStudioDawProject(trackByIndex(index), 'track');
  }

  function openCurrentSet() {
    if (!activeTrackList().length) return activeProject ? revealStudioDawShell('track') : newBlankProject();
    // Start from the complete Studio order; later Mixtape song edits mirror back to Studio.
    return showStudioDawSetProject(activeTrackList());
  }

  function requestCurrentSet() {
    const current = document.getElementById('daw-set-choice');
    if (current) { current.querySelector('button')?.focus();return false; }
    const tracks = activeTrackList().map(stableTrackCopy);
    if (!tracks.length) return activeProject ? revealStudioDawShell('track') : newBlankProject();
    const origin = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.id = 'daw-set-choice';dialog.className = 'daw-set-choice';
    dialog.setAttribute('aria-labelledby', 'daw-set-choice-title');
    dialog.setAttribute('aria-describedby', 'daw-set-choice-summary');
    dialog.innerHTML = `<div class="daw-set-choice-header"><h2 id="daw-set-choice-title">Open your set in Studio DAW</h2>
      <span class="axiom-tool-logo axiom-tool-logo-daw" aria-hidden="true"><img src="/static/brands/axiom-studio-tools.png" alt=""></span></div>
      <p id="daw-set-choice-summary">${tracks.length} track${tracks.length === 1 ? '' : 's'}, in your current Studio order. Choose how you want to work.</p>
      <div class="daw-set-choices">
        <button type="button" data-daw-set-mode="mixtape" data-axiom-cta-skip="true"><strong>${activeProject?.mode === 'mixtape' ? 'Add To Mixtape' : 'Make a Mixtape'}</strong><span>${activeProject?.mode === 'mixtape' ? 'Add new songs and keep your existing edits and automation.' : 'Mix the full set, shape transitions and record your mix.'}</span></button>
        <button type="button" data-daw-set-mode="edit" data-axiom-cta-skip="true"><strong>Edit</strong><span>Open the set for edits and remixing, with the first track as your anchor.</span></button>
      </div><p class="daw-set-choice-note">Mixtape songs stay in sync with your Studio set for live performance. Samples and effects stay in DAW.</p>
      <button type="button" data-daw-set-cancel data-axiom-cta-skip="true">Cancel</button>`;
    function dismiss(restoreFocus) {
      dialog.close();dialog.remove();
      if (restoreFocus && origin?.isConnected) origin.focus({ preventScroll: true });
    }
    dialog.addEventListener('cancel', event => { event.preventDefault();dismiss(true); });
    dialog.querySelector('[data-daw-set-cancel]').onclick = () => dismiss(true);
    for (const choice of dialog.querySelectorAll('[data-daw-set-mode]')) {
      choice.onclick = () => {
        const mode = choice.dataset.dawSetMode;
        dismiss(true);
        return showStudioDawSetProject(tracks, mode);
      };
    }
    document.body.appendChild(dialog);dialog.showModal();
    dialog.querySelector('[data-daw-set-mode="mixtape"]').focus();
    return false;
  }

  function selectAtPointer(id,event) {
    event?.preventDefault();event?.stopPropagation();
    const additive=Boolean(event?.shiftKey || event?.metaKey || event?.ctrlKey);
    const cursorOnly=Boolean(event&&selectedClipId===id&&clipEditorOpen&&mixerSelection.size===1&&!rangeSelection&&selectedBpmPoint<0&&!additive);
    selectClip(id,{pointerRatio:clipPointerRatio(event),additive,cursorOnly});
    window.AxiomArrangement?.seekBeat(activeProject,activeProject.editCursorBeat);
    return false;
  }

  function restoreProject(project) {return afterDraftSaved(()=>{
    stopPlayback();
    window.AxiomBeatPreview?.stop();
    window.AxiomStems?.stop();
    activeProject=project;
    hideContextMenu();clearRange();mixerSelection.clear();
    const migrated = migrateGeneratedRegionClipSet(activeProject);
    selectedClipId=project.arrangementClips[0]?.id || '';
    selectedClipIndex=0; selectedBpmPoint=-1; bpmEditing=false;
    selectedClipPointerRatio=0; activeMarkerIndex=0; clipEditorOpen=false;
    pendingLayer=null; targetLayerIndex=0; zoomMode='arrange';
    activeSectionId='master'; viewStartBeat=0; viewBeats=0; shellReference=false;
    revealStudioDawShell('track');
    if (migrated) window.AxiomDawDrafts?.checkpoint?.();
    window.AxiomSourceBounds?.queue(activeProject);
    return true;
  });}

  window.AxiomEditHistory.register('clip',(p,redo)=>undoRange(redo));
  window.AxiomEditHistory.register('bpm',(p,redo)=>undoBpm(redo));
  window.AxiomEditHistory.register('grid',(p,redo)=>undoSourceGrid(redo));
  window.AxiomEditHistory.register('parameters',undoParameters);
  document.addEventListener('click', hideContextMenu);
  const closeLaneMenu=()=>{if(contextMenu?.dataset.laneMenu)hideContextMenu();};
  window.addEventListener('resize',closeLaneMenu);
  document.addEventListener('click',event=>{if(suppressRangeClick){event.preventDefault();event.stopImmediatePropagation();}},true);
  document.addEventListener('pointerdown',startRangeDrag,true);
  document.addEventListener('dragstart',event=>{if(rangeDragging){event.preventDefault();event.stopImmediatePropagation();}},true);
  document.addEventListener('dragend', stopClipDragScroll, true);
  document.addEventListener('dragleave', event => {
    if (!event.relatedTarget && (event.target === document.documentElement || event.target === document.body)) stopClipDragScroll();
  }, true);
  document.addEventListener('drop', stopClipDragScroll, true);
  document.addEventListener('pointerup', stopClipDragScroll, true);
  document.addEventListener('pointercancel', stopClipDragScroll, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopClipDragScroll(); });
  window.addEventListener?.('blur', stopClipDragScroll);
  window.addEventListener?.('pagehide', stopClipDragScroll);
  document.addEventListener('keydown', handleStudioDawKeyboard, true);
  document.addEventListener('dragover',event=>{
    if (!event.target?.closest?.('#studio-daw-lanes .studio-daw-lane')) stopClipDragScroll();
    if(event.target?.closest?.('#studio-daw-shell') && Array.from(event.dataTransfer?.types||[]).includes('Files'))event.preventDefault();
  },true);
  document.addEventListener('drop',event=>{
    if(event.target?.closest?.('#studio-daw-shell') && (event.dataTransfer?.files?.length || Array.from(event.dataTransfer?.types||[]).includes('Files')))dropAudioFiles(event);
  },true);
  // Native WebKit edit commands can dispatch clipboard events without keydown.
  for(const [type,action] of [['cut',cutSelection],['copy',copySelection],['paste',pasteAtCursor]]){
    document.addEventListener(type,event=>{
      if(!dawSurfaceIsVisible()||
        event.defaultPrevented||dawClipboardTargetIsEditable(event.target)||event.target?.closest?.('dialog, [role="dialog"]'))return;
      if(action()){event.preventDefault();event.stopImmediatePropagation();}
    },true);
  }
  document.addEventListener('pointerdown',event=>{
    if(event.target?.closest?.('#studio-daw-lanes, #studio-daw-ruler, .daw-zoom-toolbar')) focusZoom('arrange');
    else if(event.target?.closest?.('.daw-source-detail, .daw-source-zoom')) focusZoom('source');
  },true);
  document.addEventListener('wheel', panTimelineFromWheel, {capture:true, passive:false});
  document.addEventListener('scroll', lockWorkbenchHorizontalScroll, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { stopClipDragScroll(); hideContextMenu(); }
  });
  document.addEventListener('contextmenu', handleStudioPlaylistContextMenu, true);

  window.AxiomStudioDaw = Object.freeze({
    ...existing,
    setRange,clearRange,toggleRangeMode,editRange,repeatRange,undoRange,undoClipEdit:undoRange,openRangeMenu,deleteTimeRange:rippleDeleteEmptyRange,
    get selectedRange(){return rangeSelection?{...rangeSelection}:null;},
    trimClip,alignClipStart,dragTrim,trimKey,applySourceGrid,undoSourceGrid,editSourceGrid,setBpmCurve,setClipPitch,correctClipBpm,updateLibraryBpm,setNativeEffect,setPlaybackMode,setPatternRow,setPatternRows,setDrumSamples,commitCreativeClip,setDrumRowOrder,showPatternPage,addPattern,selectPattern,editPattern,importPattern,setClipFades,setClipFadeCurve,dragFade,fadeKey,crossfadeSelected,
    get expandedSection(){return activeSectionId;},
    get selectedMixerClips(){return arrangementClips().filter(clip=>mixerSelection.has(clip.id));},
    selectAtPointer,setSourceBeatHere,syncSourceGrid,applySteadyTiming,toggleGridEditing,findSourcePeak,dragGridAnchor,dragSourceCursor,importSeratoGrid,detectDrumGrid,
    sourceCuePosition,compareSource,locateSourceSeconds,repairSnapBeat,
    refreshArrangement:()=>{window.AxiomStemCache?.reconcile?.(activeProject);renderTrackStack();renderLanes();if(clipEditorOpen)renderStepEditor();window.AxiomDawFinder?.syncStudioSet(activeProject);},
    restoreProject,
    newBlankProject,followPlayhead,
    setProjectMode,updateAnchorStatus,
    toggleKeySync,
    setTransitionAnchor,
    makeClipAnchor,
    snapBeat,
    get activeProject() {
      return activeProject;
    },
    addMarker,
    selectBpmPoint,
    removeBpmPoint,
    openBpmMenu,
    undoBpm,
    toggleStemLevels,
    setInspectorParam,
    dragInspectorKnob,
    keyInspectorKnob,
    setStemInspectorGain,
    toggleStemInspectorGain,
    openInspectorAutomation,
    syncInspectorKey,
    inspectorStemAction,
    openStemSection,
    refreshStemPanel(options={}) {
      if(options.progressOnly){refreshStemProgress();return;}
      renderContextPanel();renderInspector();renderStepEditor();
    },
    get selectedStemClip() { const clip=selectedArrangementClip(); return clip?.stemState==='ready'?clip:null; },
    setBpmPoint,setProjectBpm,beginProjectBpmEdit,finishProjectBpmEdit,toggleBpmLaneSize,
    addBpmPoint,
    editBpmPoint,
    dragBpmPoint,
    receiveCues,
    beginAdd,
    addAudioActionLabel,
    chooseSampleLayer,
    importSampleFolderToLayer,
    openSampleBankDialog,
    addBankSampleToLayer,
    readDawSampleBank,
    toggleSnap,
    toggleMixer,
    positionLane,
    dragOverLane,
    stopClipDragScroll,
    dragClip,
    dropClip, dropAudioFiles, applyImportAnalysis,
    addTrackToProject,
    replaceSweepSource,
    closeStudioDawShell,
    cancelLibraryAdd(){ pendingLayer = null; },
    revealProject(project){ if (project === activeProject) return revealStudioDawShell(); },
    copySelection,
    reviewExportEnding,removeExportEnding,
    duplicateSelection,
    toggleClipReverse,
    renderReverbTailForClip,
    renderReverbTailForRange,
    hideContextMenu,
    handleClipKeydown,
    handleSectionKeydown,
    toggleDeckMixer,
    refreshDeckMixer,
    jumpToStart,
    isProjectOpen,
    openLibrarySearchForAdd,
    openLibraryTrackMenu,
    openClipMenu,
    openLaneMenu,
    openMasterClip,
    openTrackByIndex,
    openCurrentSet,
    requestCurrentSet,
    openTrackMenu,
    pasteAfterSelection,
    playClip,
    playFromStart,
    playOrToggle,
    renameActiveMarker,
    renameMarker,deleteMarker,markerActions,
    repeatSelection,
    selectMarker,
    selectSection,
    setZoom,
    focusZoom,
    zoomSource, sourceWheel, playSourceCue, paintSourcePlayback,
    seekSource,
    stepZoom,zoomTimelineBy,zoomKey,
    get surfaceVisible(){return dawSurfaceIsVisible();},
    panTimeline,
    panSource,
    locateSourceStart,
    dragSourceStart,anchorClipStart,
    setSourceDownbeat,
    applyDjIntroMarkers,
    trimSourceStart,
    syncStudioDawClipHighlights,
    stopPlayback,
    showStudioDawSetProject,
    showStudioDawProject,
    showReferencePreview,
    splitActiveClip,
  });

  window.openStudioDawTrackMenu = openTrackMenu;
  window.openLibraryDawTrackMenu = openLibraryTrackMenu;
  window.closeStudioDawShell = closeStudioDawShell;
})();
