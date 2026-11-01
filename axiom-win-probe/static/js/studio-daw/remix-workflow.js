(function(){
  'use strict';
  const key='axiom-remix-setup-v1',copy=value=>JSON.parse(JSON.stringify(value));
  let comparison=null;
  const daw=()=>window.AxiomStudioDaw;
  const selected=()=>daw()?.selectedMixerClips?.length===1?daw().selectedMixerClips[0]:null;
  function read(){try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}}
  function save(value){localStorage.setItem(key,JSON.stringify(value));}
  function preferences(){const value=read();return value?.version===1?value:null;}
  function setFormat(format){if(['wav','mp3'].includes(format))save({...preferences(),version:1,format});}
  function setup(p){
    const rowMixer={};
    for(const [id,row] of Object.entries(p.rowMixer||{})){
      if(!['left-deck','right-deck','samples','recordings','instruments','fx'].includes(id))continue;
      rowMixer[id]={};
      for(const name of ['volume','gainDb','lowDb','midDb','highDb'])if(Number.isFinite(row[name]))rowMixer[id][name]=row[name];
    }
    const samples=(p.arrangementClips||[]).filter(c=>c.sectionId==='samples').slice(0,32).map(c=>({...copy(c),id:crypto.randomUUID(),mixSolo:false,mixMuted:false,muted:false}));
    // Reuse unbound FX regions. Song-triggered effects belong to that edit.
    const fx=(p.fxRegions||[]).filter(f=>(f.target==='master'||f.followAudio===false)&&!f.sweepSource&&window.AxiomDawFx?.validate(f)).slice(0,32).map(f=>({...copy(f),id:crypto.randomUUID()}));
    return {rowMixer,samples,fx,sampleLayerCount:p.sampleLayerCount||1};
  }
  function apply(p){
    const value=preferences();if(!value?.enabled||!value.setup)return p;
    try{
      const s=value.setup,candidate={...p,rowMixer:copy(s.rowMixer||{}),sampleLayerCount:s.sampleLayerCount||1,
        arrangementClips:[...p.arrangementClips,...(s.samples||[]).map(c=>({...copy(c),id:crypto.randomUUID()}))],
        fxRegions:(s.fx||[]).map(f=>({...copy(f),id:crypto.randomUUID()}))};
      window.AxiomDawDrafts.serialize(candidate); // Validate stored settings and sources before applying.
      Object.assign(p,candidate);
    }catch{window.showToast?.('Saved editing setup could not be loaded. This song opened with default settings.',true);}
    return p;
  }
  function openSetup(){
    document.getElementById('daw-remix-setup')?.close();
    const dialog=document.createElement('dialog');dialog.id='daw-remix-setup';dialog.className='daw-fx-dialog';
    dialog.innerHTML='<h2>Editing Setup</h2><p>Reuse sample clips, lane levels and EQ, and independently placed FX when opening your next song. Export format is remembered separately.</p><p>Song audio, its grid, tempo automation, mute and solo choices stay with each edit.</p><output role="status"></output><footer><button data-save>Use this setup for new edits</button><button data-clear>Use default setup</button><button data-close>Close</button></footer>';
    const status=dialog.querySelector('output');status.textContent=preferences()?.enabled?'Your saved setup is enabled.':'New edits use the default setup.';
    dialog.querySelector('[data-save]').onclick=()=>{try{const p=daw().activeProject;if(!p)return;save({...preferences(),version:1,enabled:true,setup:setup(p)});status.textContent='Saved. Your next song will use this setup.';}catch(error){status.textContent='Could not save setup: '+error.message;}};
    dialog.querySelector('[data-clear]').onclick=()=>{try{save({...preferences(),version:1,enabled:false,setup:null});status.textContent='New edits will use the default setup.';}catch(error){status.textContent=error.message;}};
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
  }
  async function compare(mode,clip,seconds){
    const p=daw()?.activeProject;if(!p||!clip)return false;
    const active=window.AxiomSourceAudition?.playing||window.AxiomArrangement?.playing||window.AxiomArrangement?.loading;
    if(!comparison||comparison.clip!==clip||comparison.project!==p||!active)comparison={clip,project:p,seconds};
    if(active&&comparison.mode===mode){window.AxiomSourceAudition?.stop();window.AxiomArrangement?.stop(false);comparison=null;return false;}
    comparison.mode=mode;
    const at=comparison.seconds;
    window.AxiomSourceAudition?.stop();window.AxiomArrangement?.stop(false);
    if(mode==='original')return window.AxiomSourceAudition.toggle(p,clip,at);
    return window.AxiomArrangement.auditionSource(p,clip,at);
  }

  function reviewSpans(structure){
    if(Array.isArray(structure?.reviewSpans))return structure.reviewSpans.filter(s=>Number.isFinite(s.startSeconds)&&Number.isFinite(s.endSeconds)&&s.startSeconds>=0&&s.endSeconds>s.startSeconds).slice(0,128).map(s=>({startSeconds:s.startSeconds,endSeconds:s.endSeconds,reason:'Weak drum attack'}));
    return [];
  }
  function repairAnchors(anchors,beat,seconds){
    if(!Number.isInteger(beat)||beat===0||!Number.isFinite(seconds)||seconds<0)throw new Error('Choose a numbered beat other than Clip Start.');
    const anchor=anchors.find(a=>a.beat===beat);if(!anchor)throw new Error('Choose an existing beat.');
    const delta=seconds-anchor.seconds;
    const next=anchors.map(a=>({...a,seconds:a.seconds+(a.beat===0?0:delta*Math.max(0,1-Math.abs(a.beat-beat)/4))}));
    if(next.some((a,i)=>a.seconds<0||i&&a.seconds<=next[i-1].seconds))throw new Error('That correction crosses another beat. Choose a closer transient.');
    return next;
  }
  function openReview(){
    const c=selected();if(!c?.beatgrid){window.showToast?.('Select a prepared song to review its timing.',true);return;}
    document.getElementById('daw-snap-review')?.close();
    const dialog=document.createElement('dialog');dialog.id='daw-snap-review';dialog.className='daw-fx-dialog';
    dialog.innerHTML='<h2>Review Snap</h2><p>These are listening hints, not confirmed timing errors. Choose a section, then place the waveform cursor on its beat. Aligning that beat also adjusts the surrounding four beats on each side. Clip Start stays fixed. Undo Grid restores the previous map.</p><div data-regions></div><label>Beat to align<input data-beat type="number" step="1"></label><output role="status"></output><footer><button data-fix>Align beat to cursor</button><button data-close>Close</button></footer>';
    const regions=dialog.querySelector('[data-regions]'),input=dialog.querySelector('[data-beat]'),status=dialog.querySelector('output');
    input.value=Math.round(daw().sourceCuePosition(c.id).beat);
    const spans=c.beatgrid.metadata?.reviewSpans||[];
    if(!spans.length)regions.textContent='No weak-attack sections were reported. You can still correct a beat you hear drifting.';
    for(const s of spans){const b=document.createElement('button');b.type='button';b.textContent=`Listen ${s.startSeconds.toFixed(1)}–${s.endSeconds.toFixed(1)}s`;b.onclick=()=>{daw().locateSourceSeconds(c.id,s.startSeconds);input.value=Math.round(daw().sourceSecondsToBeat(c,(s.startSeconds+s.endSeconds)/2));dialog.close();};regions.append(b);}
    // Non-modal: the source waveform must remain usable while choosing a transient.
    dialog.querySelector('[data-fix]').onclick=()=>{try{if(selected()!==c)throw new Error('Reselect this song before correcting its grid.');const at=daw().sourceCuePosition(c.id);daw().repairSnapBeat(c.id,Number(input.value),at.seconds);status.textContent='Beat and nearby grid aligned. Undo Grid is available.';}catch(error){status.textContent=error.message;}};
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.show();
  }
  window.AxiomRemixWorkflow={compare,reviewSpans,repairAnchors,openReview,openSetup,apply,preferences,setFormat,setup};
})();
