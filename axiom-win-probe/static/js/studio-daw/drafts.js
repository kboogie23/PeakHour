(function () {
  'use strict';
  const prefix='axiom.daw.draft.v1.';
  const owner=crypto.randomUUID();
  const storage=window.AxiomDraftStorage||{
    get:key=>localStorage.getItem(key),set:(key,value)=>localStorage.setItem(key,value),
    list:()=>{const records=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith(prefix))records.push(localStorage.getItem(key));}return records;}
  };
  function freshId(){return crypto.randomUUID();}
  // Keep synchronous fallback callers compatible; persistent-store operations
  // finish only after their transaction commits and is read back.
  function sequence(iterator){
    function advance(value,method='next'){const step=iterator[method](value);return step.done?step.value:step.value?.then?step.value.then(value=>advance(value),error=>advance(error,'throw')):advance(step.value);}
    return advance();
  }
  const then=(value,action)=>value?.then?value.then(action):action(value);
  let pending=null;
  let lastProject=null, lastSnapshot='', failed=false;
  let savedSnapshot='',failedProject=null;
  const recoveryProject=p=>window.AxiomAutomationRecorder?.recoverySnapshot(p)||p;
  function status(){
    const p=window.AxiomStudioDaw?.activeProject;if(!p)return 'inactive';
    if(pending)return 'saving';
    if(failed&&failedProject===p)return 'error';
    try{const value=JSON.stringify(recoveryProject(p));if(p!==lastProject||value!==lastSnapshot)return 'unsaved';return value===savedSnapshot?'saved':'recovery';}catch{return 'error';}
  }
  function renderStatus(){
    if(typeof document==='undefined')return;
    const button=document.querySelector('#studio-daw-shell button[onclick="AxiomDawDrafts.save()"]');if(!button)return;
    let label=document.getElementById('daw-save-status');
    if(!label){label=document.createElement('output');label.id='daw-save-status';label.setAttribute('role','status');label.setAttribute('aria-live','polite');button.before(label);}
    const state=status(),text={inactive:'',saving:'Saving',error:'Not saved',unsaved:'Unsaved',saved:'Saved',recovery:'Recovery only'}[state];
    if(label.textContent!==text)label.textContent=text;label.dataset.state=state;
    label.title={inactive:'',saving:'Writing and verifying this project on this device.',error:'Draft storage failed; current changes are not protected.',unsaved:'Current changes have not reached recovery storage.',saved:'Current project data matches the explicit save. Audio files are referenced separately.',recovery:'Current changes are in recovery, but differ from the explicit saved version.'}[state];
  }
  const notify=(message,error=false)=>window.showToast?.(message,error);
  function validate(project) {
    if(!project || project.schemaVersion!==1 || !project.sourceTrack || typeof project.sourceTrack.path!=='string' || !Array.isArray(project.arrangementClips) || !Array.isArray(project.automationLanes) || !Array.isArray(project.markers)) throw new Error('Unsupported or damaged draft.');
    for(const clip of project.arrangementClips) {
      if(typeof clip.path!=='string' || typeof clip.id!=='string' || !Number.isFinite(clip.sourceStartBeat) || !['sourceDurationBeats','timelineStartBeat','timelineDurationBeats'].every(key=>Number.isFinite(clip[key]) && clip[key]>=0)) throw new Error('Invalid clip in draft.');
      if(clip.beatgrid) window.AxiomStudioDaw.trackGrid(clip);
      if(clip.frozenClip){const r=clip.frozenClip;if(r.version!==1||!r.original||r.original.frozenClip||typeof r.original.path!=='string'||!Array.isArray(r.bakedFx)||!Array.isArray(r.bakedAutomation)||!Number.isFinite(r.durationBeats)||r.durationBeats<=0)throw new Error('Invalid frozen clip receipt.');validate({...project,arrangementClips:[r.original]});if(r.bakedFx.some(f=>!window.AxiomDawFx?.validate(f)))throw new Error('Invalid frozen effect receipt.');}
      if(clip.nativeEffect){if(!window.AxiomNativeEffects)throw new Error('Native effect validation is unavailable. Reload the DAW.');window.AxiomNativeEffects.validate(clip.nativeEffect);}
    }
    return project;
  }
  function validateFile(project){
    validate(project);
    const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
    function inspect(value,depth=0){
      if(depth>40)throw new Error('Project nesting is too deep.');
      if(typeof value==='number'&&!Number.isFinite(value))throw new Error('Nonfinite project value.');
      if(value&&typeof value==='object')for(const key of Object.keys(value)){if(['__proto__','prototype','constructor'].includes(key))throw new Error('Unsafe project property.');inspect(value[key],depth+1);}
    }
    inspect(project);
    if(project.assetIdentities!==undefined&&(!object(project.assetIdentities)||Object.values(project.assetIdentities).some(a=>!object(a)||!/^[a-f0-9]{64}$/.test(a.sha256)||!Number.isSafeInteger(a.size)||a.size<0)))throw new Error('Invalid audio fingerprints.');
    if(project.drumSamples!==undefined&&(!object(project.drumSamples)||Object.values(project.drumSamples).some(a=>!object(a)||typeof a.path!=='string'||typeof a.name!=='string')))throw new Error('Invalid saved drum samples.');
    if(project.patternClips!==undefined)window.AxiomPatterns?.validate(project.patternClips);
    if(project.drumRowOrder!==undefined){
      if(!window.AxiomPatterns?.validateRowOrder)throw new Error('Drum row order validation is unavailable.');
      window.AxiomPatterns.validateRowOrder(project.drumRowOrder);
    }
    if(typeof project.title!=='string'||project.arrangementClips.length>10000)throw new Error('Invalid project name or clip count.');
    const ids=new Set();
    if(project.sampleLayerCount!==undefined&&(!Number.isSafeInteger(project.sampleLayerCount)||project.sampleLayerCount<1))throw new Error('Invalid sample layer count.');
    if(project.arrangementClips.some(c=>c.fadeCurve!==undefined&&!['linear','equal-power'].includes(c.fadeCurve)))throw new Error('Unsupported fade curve.');
    for(const clip of project.arrangementClips)for(const key of ['fadeInBeats','fadeOutBeats'])if(clip[key]!==undefined&&(!Number.isFinite(clip[key])||clip[key]<0))throw new Error('Invalid clip fade.');
    for(const clip of project.arrangementClips){if(ids.has(clip.id)||!clip.id||typeof clip.sectionId!=='string')throw new Error('Invalid or duplicate clip identity.');ids.add(clip.id);}
    for(const key of ['masterMixer','rowMixer','stepPattern'])if(project[key]!==undefined&&!object(project[key]))throw new Error('Invalid '+key+'.');
    for(const mixer of [project.masterMixer,...Object.values(project.rowMixer||{})].filter(v=>v!==undefined)){
      if(!object(mixer))throw new Error('Invalid mixer settings.');
      if(mixer.volume!==undefined&&(!Number.isFinite(mixer.volume)||mixer.volume<0||mixer.volume>1))throw new Error('Invalid mixer volume.');
      for(const key of ['gainDb','highDb','midDb','lowDb'])if(mixer[key]!==undefined&&(!Number.isFinite(mixer[key])||mixer[key]<-24||mixer[key]>12))throw new Error('Invalid mixer EQ or gain.');
    }
    if(project.masterMixer?.limiter!==undefined){
      if(!window.AxiomMasterLimiter)throw new Error('Master limiter validation is unavailable. Reload AXIOM.');
      window.AxiomMasterLimiter.validate(project.masterMixer.limiter);
    }
    if(project.stepPattern)for(const steps of Object.values(project.stepPattern))if(!Array.isArray(steps)||steps.some(n=>!Number.isInteger(n)||n<0||n>1024))throw new Error('Invalid drum pattern.');
    if(project.fxRegions!==undefined&&(!Array.isArray(project.fxRegions)||project.fxRegions.some(f=>!object(f)||!['startBeat','durationBeats','tailBeats'].every(k=>Number.isFinite(f[k])&&f[k]>=0))))throw new Error('Invalid effect regions.');
    if(project.fxRegions&&window.AxiomDawFx?.validate&&project.fxRegions.some(f=>!window.AxiomDawFx.validate(f)))throw new Error('Unsupported effect settings.');
    if(project.markers.some(m=>!object(m)))throw new Error('Invalid markers.');
    if(project.automationLanes.some(l=>!object(l)||!Array.isArray(l.points)||l.points.some(p=>!object(p)||!Number.isFinite(p.beat)||!Number.isFinite(p.value))))throw new Error('Invalid automation.');
    window.AxiomStudioDaw.compileTempoMap?.(project);
    window.AxiomDawAutomation?.validateProject(project);
    window.AxiomMidiControls?.validateProject(project);
    return project;
  }
  function serialize(project=window.AxiomStudioDaw?.activeProject) {
    if(project===window.AxiomStudioDaw?.activeProject)window.AxiomAutomationRecorder?.finish();
    validateFile(project);
    return JSON.stringify({format:'axiom-daw-project',version:1,project},null,2);
  }
  function importText(text) {
    return sequence((function*(){
      if(typeof text!=='string'||text.length>64*1024*1024)throw new Error('Project file exceeds the 64 MB limit.');
      const record=JSON.parse(text);
      if(!record||record.format!=='axiom-daw-project'||record.version!==1)throw new Error('Unsupported AXIOM project file.');
      const project=validateFile(record.project),previous=window.AxiomStudioDaw?.activeProject;
      if(previous&&!(yield checkpoint()))throw new Error('Save the current project before opening another.');
      project.localDraftId=freshId();
      project.arrangementClips.forEach(clip=>{if(clip.stemState==='processing')clip.stemState='failed';});
      yield storage.set(prefix+project.localDraftId,JSON.stringify({version:1,owner,updatedAt:new Date().toISOString(),project,saved:project}));
      if(window.AxiomStudioDaw?.activeProject!==previous)throw new Error('The active project changed. Your imported copy is in Open Project.');
      if((yield window.AxiomStudioDaw.restoreProject(project))===false)throw new Error('Project could not be opened. The imported copy remains in Open Project.');
      lastProject=project;lastSnapshot=JSON.stringify(project);savedSnapshot=lastSnapshot;failed=false;failedProject=null;renderStatus();
      notify('Project opened. Saved drum samples load on playback. Check Project Audio for unavailable sources.');
      return project;
    })());
  }
  async function download() {
    try {
      const project=window.AxiomStudioDaw.activeProject;
      await window.AxiomDawAssets?.capture(project);
      if(project!==window.AxiomStudioDaw.activeProject)throw new Error('The active project changed. Export the current project again.');
      const text=serialize(),blob=new Blob([text],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download=(window.AxiomStudioDaw.activeProject.title||'AXIOM Project').replace(/[^a-zA-Z0-9 _-]/g,'_').slice(0,100)+'.axiom.json';
      document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      notify('Project file downloaded. Original audio is not included.');
    }catch(error){notify('Project not exported: '+error.message,true);}
  }
  let fileRequestVersion = 0;
  function chooseFile() {
    const request = ++fileRequestVersion;
    const project = window.AxiomStudioDaw?.activeProject;
    const navigationVersion = window.axiomTabNavigationVersion;
    const dialog = document.getElementById('daw-draft-dialog');
    const input=document.createElement('input');input.type='file';input.accept='.json,.axiom.json,application/json';
    input.onchange=async()=>{
      try {
        const file=input.files?.[0];if(!file)return;
        if(file.size>64*1024*1024)throw new Error('Project file exceeds the 64 MB limit.');
        const text=await file.text();
        if(dialog && (document.getElementById('daw-draft-dialog')!==dialog || !dialog.open)) return;
        if(request!==fileRequestVersion || project!==window.AxiomStudioDaw?.activeProject || navigationVersion!==window.axiomTabNavigationVersion)
          throw new Error('The project, page or selected file changed. Choose the project file again.');
        await importText(text);dialog?.remove();
      }catch(error){notify('Project not opened: '+error.message,true);}
    };
    input.click();
  }
  function checkpoint(manual=false) {
    if(pending)return manual?pending.then(ok=>ok?checkpoint(true):false):pending;
    if(manual)window.AxiomAutomationRecorder?.finish();
    const project=window.AxiomStudioDaw?.activeProject;
    if(!project)return false;
    const fail=error=>{if(!failed||manual)notify('Draft not saved: '+error.message,true);failed=true;failedProject=project;renderStatus();return false;};
    try{
      validate(project);
      project.localDraftId ||= freshId();
      const captured=JSON.stringify(recoveryProject(project));
      if(!manual&&project===lastProject&&captured===lastSnapshot&&!failed)return true;
      const result=sequence((function*(){
        let key=prefix+project.localDraftId;
        const previous=JSON.parse((yield storage.get(key))||'null');
        const forkedFrom=previous&&previous.owner!==owner?project.localDraftId:null;
        const nextId=forkedFrom?freshId():project.localDraftId;
        const data=JSON.parse(captured);data.localDraftId=nextId;
        const snapshot=JSON.stringify(data);
        key=prefix+nextId;
        const record={version:1,owner,forkedFrom:forkedFrom||previous?.forkedFrom||null,updatedAt:new Date().toISOString(),project:data,saved:manual?data:forkedFrom?null:previous?.saved||null};
        yield storage.set(key,JSON.stringify(record));
        project.localDraftId=nextId;
        lastProject=project;lastSnapshot=snapshot;savedSnapshot=record.saved?JSON.stringify(record.saved):'';failed=false;failedProject=null;
        if(forkedFrom)notify('Opened a separate editable draft. The original and other tabs remain unchanged.');
        if(manual)notify('Project saved on this device. Use Project Files for a portable backup with audio.');
        return true;
      })());
      if(result?.then){pending=result.catch(fail).finally(()=>{pending=null;renderStatus();});return pending;}
      renderStatus();return result;
    }catch(error){return fail(error);}
  }
  function beforeSwitch(action){
    const project=window.AxiomStudioDaw?.activeProject;
    if(!project)return action();
    return then(checkpoint(),ok=>{
      if(!ok||project!==window.AxiomStudioDaw?.activeProject)return false;
      // A user can continue editing while the disk transaction completes.
      if(JSON.stringify(recoveryProject(project))!==lastSnapshot){notify('The project changed while saving. Try the action again.');return false;}
      return action();
    });
  }
  function save() {
    const project=window.AxiomStudioDaw?.activeProject;
    if(!project) return;
    document.getElementById('daw-save-dialog')?.remove();
    const dialog=document.createElement('dialog');dialog.id='daw-save-dialog';
    dialog.style.cssText='background:#191c19;color:#eee;border:1px solid #525852;padding:20px;border-radius:6px;max-width:90vw;width:380px';
    const form=document.createElement('form');
    const heading=document.createElement('h2');heading.id='daw-save-heading';heading.textContent='Save Draft';
    dialog.setAttribute('aria-labelledby',heading.id);
    const label=document.createElement('label');label.htmlFor='daw-save-name';label.textContent='Project name';
    const input=document.createElement('input');input.id='daw-save-name';input.value=project.title||'Untitled';input.required=true;input.maxLength=160;
    input.style.cssText='display:block;box-sizing:border-box;width:100%;margin:12px 0;background:#252925;color:#eee;border:1px solid #525852;padding:8px';
    const error=document.createElement('p');error.setAttribute('role','alert');
    const submit=document.createElement('button');submit.type='submit';submit.textContent='Save';submit.style.cssText='padding:8px 18px;background:var(--accent);color:#071005;margin-right:12px';
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.onclick=()=>{dialog.close();dialog.remove();};
    form.onsubmit=async event=>{
      event.preventDefault();
      if(project!==window.AxiomStudioDaw?.activeProject){error.textContent='The active project changed. Close this dialog and save again.';return;}
      if(!input.value.trim()){input.focus();return;}
      submit.disabled=true;
      try{if(window.AxiomDawAssets)await window.AxiomDawAssets.capture(project);}catch(failure){error.textContent=failure.message;submit.disabled=false;return;}
      if(!dialog.open||document.getElementById('daw-save-dialog')!==dialog)return;
      if(project!==window.AxiomStudioDaw?.activeProject){error.textContent='The active project changed. Close this dialog and save again.';submit.disabled=false;return;}
      const previousTitle=project.title;project.title=input.value.trim();
      const saved=checkpoint(true);
      if(!(saved?.then?await saved:saved)){project.title=previousTitle;error.textContent='Project was not saved. Your previous save is kept. Check free space and try again.';submit.disabled=false;return;}
      dialog.close();dialog.remove();
    };
    const copy=document.createElement('p');copy.textContent='Saves in AXIOM on this device. To create a backup file or include audio, use Project Files.';
    form.append(heading,label,input,error,copy,submit,cancel);dialog.append(form);document.body.append(dialog);dialog.showModal();input.focus();input.select();
  }
  function open() {return beforeSwitch(()=>sequence((function*(){
    document.getElementById('daw-draft-dialog')?.remove();
    const dialog=document.createElement('dialog'); dialog.id='daw-draft-dialog';
    dialog.style.cssText='background:#191c19;color:#eee;border:1px solid #525852;padding:20px;border-radius:6px;max-width:90vw;width:460px';
    const heading=document.createElement('h2'); heading.textContent='Open Project'; dialog.append(heading);
    const copy=document.createElement('p');copy.textContent='Choose a local draft below, or open a project file. Recover latest includes changes made after your last Save Draft.';dialog.append(copy);
    const select=document.createElement('select'); select.setAttribute('aria-label','Choose draft');
    select.style.cssText='width:100%;margin:16px 0;background:#252925;color:#eee;padding:8px';
    const records=[];
    try {
      for(const value of (yield storage.list())) {
        try {const record=JSON.parse(value);validate(record.project);records.push(record);}catch{ /* Retain unreadable records for recovery. */ }
      }
      records.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
      records.forEach((record,index)=>{const option=document.createElement('option');option.value=index;option.textContent=`${record.project.title}${record.forkedFrom?' (separate copy)':''} - ${new Date(record.updatedAt).toLocaleString()}`;select.append(option);});
    } catch(error) {notify('Cannot read drafts: '+error.message,true);return;}
    dialog.append(select);
    for(const [label,field] of [['Recover latest','project'],['Open saved','saved']]) {
      const button=document.createElement('button');button.textContent=label;button.type='button';button.style.cssText='padding:8px;margin-right:8px;background:var(--accent);color:#071005';button.disabled=!records.length;
      button.onclick=async()=>{
        const data=records[Number(select.value)]?.[field];
        if(!data) {notify('No explicit save yet. Use Recover latest.',true);return;}
        const project=validate(JSON.parse(JSON.stringify(data)));
        project.arrangementClips.forEach(clip=>{if(clip.stemState==='processing') clip.stemState='failed';});
        if(await window.AxiomStudioDaw.restoreProject(project)===false) return;
        dialog.close();dialog.remove();
        notify('Draft restored. Saved drum samples load on playback; check Project Audio for unavailable sources.');
      };dialog.append(button);
    }
    const cancel=document.createElement('button');cancel.textContent='Cancel';cancel.onclick=()=>{dialog.close();dialog.remove();};dialog.append(cancel);
    for(const [label,action] of [['Open project file',chooseFile],['Open portable project',()=>window.AxiomDawAssets?.openBundle()]]){const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=action;button.style.cssText='padding:8px;margin-top:12px;margin-right:8px;background:#252925;color:#eee';dialog.append(button);}
    document.body.append(dialog);dialog.showModal();
  })()));}
  function files() {
    if(!window.AxiomStudioDaw?.activeProject)return;
    document.getElementById('daw-project-files-dialog')?.remove();
    const dialog=document.createElement('dialog');dialog.id='daw-project-files-dialog';
    dialog.setAttribute('aria-label','Project Files');
    dialog.style.cssText='background:#191c19;color:#eee;border:1px solid #525852;padding:20px;border-radius:6px;max-width:90vw;width:460px';
    const heading=document.createElement('h2');heading.textContent='Project Files';dialog.append(heading);
    for(const [label,description,action] of [
      ['Save project file','Your arrangement and settings. Audio stays in its current location.',download],
      ['Save project with audio','A portable project with copies of its audio for backup or another Mac.',event=>window.AxiomDawAssets?.exportBundle(event.currentTarget)],
      ['Check project audio','Review and reconnect the audio used by this project.',()=>{dialog.remove();window.AxiomDawAssets?.open();}],
    ]){
      const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=action;
      button.style.cssText='display:block;margin-top:16px;padding:8px;background:#252925;color:#eee';
      const copy=document.createElement('p');copy.textContent=description;dialog.append(button,copy);
    }
    const close=document.createElement('button');close.type='button';close.textContent='Close';close.onclick=()=>{dialog.close();dialog.remove();};dialog.append(close);
    document.body.append(dialog);dialog.showModal();
  }
  window.AxiomDawDrafts={beforeSwitch,checkpoint,save,open,files,validate,serialize,importText,download,chooseFile,status,renderStatus};
  if(typeof document!=='undefined')for(const name of ['input','change','click','pointerup','keydown'])document.addEventListener(name,()=>queueMicrotask(renderStatus));
  setInterval(()=>checkpoint(),1000);
  window.addEventListener('pagehide',()=>checkpoint());
  window.addEventListener('beforeunload',event=>{const result=checkpoint();if((result?.then||!result)&&window.AxiomStudioDaw?.activeProject){event.preventDefault();event.returnValue='';}});
})();
