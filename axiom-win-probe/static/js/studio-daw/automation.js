(function () {
  'use strict';

  const existing = window.AxiomStudioDaw || {};

  function createAutomationLane({ scope = 'project', parameter, targetId = '', points = [] }) {
    if (!parameter) {
      throw new Error('Studio DAW automation lanes require a parameter.');
    }
    if (scope !== 'project' && !targetId) {
      throw new Error('Studio DAW non-project automation lanes require a target id.');
    }
    return {
      scope,
      parameter,
      targetId,
      points,
    };
  }

  function createBpmAutomation(points = []) {
    return createAutomationLane({
      scope: 'project',
      parameter: 'bpm',
      points,
    });
  }

  const definitions={volume:['Volume',0,1,1],gainDb:['Trim (dB)',-24,12,0],lowDb:['Low EQ (dB)',-24,12,0],midDb:['Mid EQ (dB)',-24,12,0],highDb:['High EQ (dB)',-24,12,0],
    stemGain_vocals:['Vocals',0,2,1],stemGain_other:['Melody',0,2,1],stemGain_bass:['Bass',0,2,1],stemGain_drums:['Drums',0,2,1],wet:['Wet level',0,1,.35],feedback:['Echo feedback',0,.9,.45],resonanceDb:['Resonance (dB)',-12,24,1],cutoffHz:['Cutoff (Hz)',20,20000,80],preDelayMs:['Pre-delay (ms)',0,250,0],dampingHz:['Reverb tone (Hz)',200,20000,20000]};
  const fxParameters={wet:null,feedback:['echo'],resonanceDb:['lowpass','highpass'],cutoffHz:['lowpass','highpass'],preDelayMs:['reverb','vintageReverb'],dampingHz:['reverb','vintageReverb']};
  definitions.tapeSpeed=['Tape speed (%)',0,100,100];fxParameters.tapeSpeed=['tapeStop'];
  for(const [type,fields] of Object.entries(window.AxiomCreativeFx?.controls||{}))for(const [key,label,min,max,step,value] of fields){definitions[key]=[label,min,max,value];fxParameters[key]=[type];}
  Object.assign(definitions,{decaySeconds:['Reverb decay (seconds)',.1,30,3],vintageModMs:['Tail movement (ms)',0,5,1.2],vintageLowCutHz:['Reverb bass cut (Hz)',20,1000,120],vintageWidth:['Reverb width (%)',0,150,100],vintageColor:['Vintage warmth (%)',0,100,45],gateDepth:['Chop strength (%)',0,100,100]});
  for(const key of ['decaySeconds','vintageModMs','vintageLowCutHz','vintageWidth','vintageColor'])fxParameters[key]=['vintageReverb'];
  fxParameters.gateDepth=['tranceGate'];
  Object.assign(definitions,{filterPosition:['Filter: low-pass / off / high-pass',-100,100,0],fxAmount:['Amount (%)',0,100,50],driveDb:['Boost (dB)',0,12,0],ceilingDb:['Output ceiling (dB)',-12,0,-1],limiterReleaseMs:['Limiter release (ms)',10,1000,100]});
  Object.assign(fxParameters,{filterPosition:['filter'],fxAmount:['sidechainHard','sidechainSoft','brighten'],driveDb:['amplify','limiter'],ceilingDb:['limiter'],limiterReleaseMs:['limiter']});
  Object.assign(definitions,{
    enhanceBodyDb:['Body (dB)',-12,12,-1.5],enhanceAirDb:['Air (dB)',-12,12,1],
    enhanceThresholdDb:['Threshold (dB)',-60,0,-18],enhanceRatio:['Ratio',1,20,2],
    enhanceAttackMs:['Attack (ms)',.1,200,20],enhanceReleaseMs:['Release (ms)',10,1000,150],
    enhanceOutputDb:['Output trim (dB)',-12,12,0],
    enhanceLowThresholdDb:['Low threshold (dB)',-60,0,-18],enhanceMidThresholdDb:['Mid threshold (dB)',-60,0,-18],enhanceHighThresholdDb:['High threshold (dB)',-60,0,-18],
  });
  for(const name of Object.keys(definitions).filter(name=>name.startsWith('enhance')))fxParameters[name]=['enhance'];
  const histories=new WeakMap(),copy=value=>JSON.parse(JSON.stringify(value));
  const identity=lane=>JSON.stringify([lane.scope,lane.targetId||'',lane.parameter]);
  function supported(scope,parameter){return Object.hasOwn(definitions,parameter)&&(scope==='clip'&&parameter==='filterPosition'||(scope==='fx'?Object.hasOwn(fxParameters,parameter):['project','deck','clip'].includes(scope)&&!Object.hasOwn(fxParameters,parameter)&&(scope==='clip'||!parameter.startsWith('stemGain_'))));}
  function available(p,ref,parameter=ref.parameter){
    if(!supported(ref.scope,parameter))return false;
    if(ref.scope!=='fx')return true;
    if(parameter==='wet')return target(p,ref)?.type!=='limiter';
    const fx=target(p,ref);if(!fxParameters[parameter]?.includes(fx?.type))return false;
    if(['enhanceLowThresholdDb','enhanceMidThresholdDb','enhanceHighThresholdDb'].includes(parameter))return fx.enhanceDynamicsMode==='multiband';
    if(parameter==='enhanceThresholdDb')return fx.enhanceDynamicsMode!=='multiband';
    return true;
  }
  function recordable(p,ref,parameter=ref.parameter){return available(p,ref,parameter)&&(parameter!=='cutoffHz'||Number.isFinite(target(p,ref)?.cutoffHz));}
  function normalize(lane){
    if(!lane||!supported(lane.scope,lane.parameter)||typeof (lane.targetId||'')!=='string'||(lane.scope!=='project'&&!lane.targetId)||!Array.isArray(lane.points)||lane.points.length>2048)throw new Error('Unsupported parameter automation lane.');
    if(lane.scope==='project'&&lane.targetId||lane.scope==='deck'&&!['left-deck','right-deck','samples','recordings','instruments'].includes(lane.targetId))throw new Error('Unsupported automation target.');
    const [,min,max]=definitions[lane.parameter],points=lane.points.map(point=>{
      if(!point||!Number.isFinite(point.beat)||point.beat<0||!Number.isFinite(point.value)||point.value<min||point.value>max||!['linear','hold'].includes(point.curve||'linear'))throw new Error('Invalid automation point. Check its position, value and curve.');
      return {beat:point.beat,value:point.value,curve:point.curve||'linear'};
    }).sort((a,b)=>a.beat-b.beat);
    if(points.some((point,i)=>i&&point.beat===points[i-1].beat))throw new Error('Two automation points cannot share a position.');
    return {scope:lane.scope,targetId:lane.targetId||'',parameter:lane.parameter,enabled:lane.enabled!==false,points};
  }
  function validateProject(p){
    const ids=new Set();
    for(const lane of p.automationLanes||[]){
      if(lane.parameter==='bpm')continue;
      const checked=normalize(lane),id=identity(checked);
      if(checked.scope==='fx'&&target(p,checked)&&!available(p,checked))throw new Error('Automation parameter is unavailable for this effect.');
      if(ids.has(id))throw new Error('Duplicate automation lane.');ids.add(id);
    }
  }
  function target(p,ref){
    if(ref.scope==='project')return p.masterMixer||{};
    if(ref.scope==='deck')return p.rowMixer?.[ref.targetId]||{};
    if(ref.scope==='clip')return p.arrangementClips.find(c=>c.id===ref.targetId);
    if(ref.scope==='fx'){const fx=p.fxRegions?.find(f=>f.id===ref.targetId);return fx&&window.AxiomDawFx?.effectiveRegion?window.AxiomDawFx.effectiveRegion(p,fx):fx;}
  }
  function offset(p,lane){return lane.scope==='clip'?(target(p,lane)?.timelineStartBeat||0):lane.scope==='fx'?(target(p,lane)?.startBeat||0):0;}
  function valueAt(lane,beat,fallback){
    if(lane.enabled===false||!lane.points.length||beat<lane.points[0].beat)return fallback;
    for(let i=1;i<lane.points.length;i++){
      const a=lane.points[i-1],b=lane.points[i];
      if(beat<b.beat)return a.curve==='hold'?a.value:a.value+(b.value-a.value)*(beat-a.beat)/(b.beat-a.beat);
    }
    return lane.points.at(-1).value;
  }
  function schedule(ctx,param,p,ref,parameter,timing,fallback,transform=value=>value){
    const live=window.AxiomAutomationRecorder?.live(p,{...ref,parameter});
    if(live!==undefined){
      const map=window.AxiomStudioDaw.compileTempoMap(p),start=timing.origin+map.beatToSeconds(timing.startBeat??0),end=timing.origin+map.beatToSeconds(timing.endBeat);
      const liveStart=timing.liveStartBeat===undefined?start:timing.origin+map.beatToSeconds(timing.liveStartBeat);
      if(ctx.currentTime>=liveStart&&ctx.currentTime<end){
        const time=Math.max(ctx.currentTime,start);
        param.cancelScheduledValues(time);
        if(time===ctx.currentTime&&param.setTargetAtTime)param.setTargetAtTime(transform(live),time,.01);
        else param.setValueAtTime(transform(live),time);
        return true;
      }
    }
    const raw=p.automationLanes?.find(l=>identity(l)===identity({...ref,parameter}));
    if(!raw||raw.enabled===false||!raw.points.length)return false;
    const lane=normalize(raw),map=window.AxiomStudioDaw.compileTempoMap(p),shift=offset(p,lane);
    const time=Math.max(ctx.currentTime,timing.origin+map.beatToSeconds(timing.startBeat??0)),first=map.secondsToBeat(Math.max(0,time-timing.origin)),end=timing.endBeat;
    if(!timing.preScheduled)param.cancelScheduledValues(time);
    param.setValueAtTime(transform(valueAt(lane,first-shift,fallback)),time);
    if(end<=first)return true;
    const points=lane.points.map(point=>({...point,beat:point.beat+shift}));
    // Subdivide beat-linear curves so tempo ramps and dB-to-gain transforms retain their shape.
    let count=0;
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[i+1];
      if(a.beat>first&&a.beat<=end)param.setValueAtTime(transform(a.value),timing.origin+map.beatToSeconds(a.beat));
      if(!b||a.curve==='hold'||b.beat<=first||a.beat>=end)continue;
      const start=Math.max(first,a.beat),finish=Math.min(end,b.beat),steps=Math.ceil((finish-start)*16);
      count+=steps;if(count>32768)throw new Error('Automation curve is too long. Split it into shorter regions.');
      const beats=Array.from({length:steps},(_,i)=>start+(finish-start)*(i+1)/steps);
      if(parameter==='filterPosition'&&a.value!==b.value)for(const value of [-4,0,4]){const beat=a.beat+(value-a.value)/(b.value-a.value)*(b.beat-a.beat);if(beat>start&&beat<finish)beats.push(beat);}
      for(const beat of [...new Set(beats)].sort((a,b)=>a-b)){
        param.linearRampToValueAtTime(transform(a.value+(b.value-a.value)*(beat-a.beat)/(b.beat-a.beat)),timing.origin+map.beatToSeconds(beat));
      }
    }
    return true;
  }
  const snapshot=p=>JSON.stringify(p.automationLanes||[]);
  function history(p){if(!histories.has(p))histories.set(p,{undo:[],redo:[]});return histories.get(p);}
  function undo(p,redo=false){
    const h=history(p),from=redo?h.redo:h.undo,to=redo?h.undo:h.redo,entry=from.at(-1);
    if(!entry)return false;
    const keys=new Set(entry.keys),expected=JSON.parse(entry[redo?'before':'after']),desired=JSON.parse(entry[redo?'after':'before']);
    const selected=lanes=>JSON.stringify(lanes.filter(l=>keys.has(identity(l))));
    if(selected(p.automationLanes||[])!==selected(expected))return false;
    window.AxiomArrangement?.stop(false);
    // Restore only this edit's lanes. A newly initialized BPM lane is not part of a fader take.
    const untouched=(p.automationLanes||[]).filter(l=>!keys.has(identity(l))),next=[];
    for(const lane of desired){
      if(keys.has(identity(lane)))next.push(lane);
      else{const index=untouched.findIndex(l=>identity(l)===identity(lane));if(index>=0)next.push(...untouched.splice(index,1));}
    }
    p.automationLanes=[...next,...untouched];from.pop();to.push(entry);window.AxiomStudioDaw.refreshArrangement?.();return true;
  }
  function commit(p,lanes){
    const normalized=lanes.map(normalize);
    if(normalized.some(l=>!target(p,l)||!available(p,l)))throw new Error('Automation target or parameter is unavailable.');
    const before=snapshot(p),keys=new Set(normalized.map(identity));
    const next=[...(p.automationLanes||[]).filter(l=>!keys.has(identity(l))),...normalized.filter(l=>l.points.length)];
    validateProject({...p,automationLanes:next});
    const after=JSON.stringify(next);if(before===after)return false;
    p.automationLanes=next;
    const h=history(p);h.undo.push({before,after,keys:[...keys]});if(h.undo.length>100)h.undo.shift();h.redo=[];
    window.AxiomEditHistory?.register('automation',undo);window.AxiomEditHistory?.record(p,'automation');window.AxiomStudioDaw.refreshArrangement?.();return true;
  }
  function apply(p,lanes){
    lanes.forEach(normalize);
    window.AxiomArrangement?.stop(false);
    return commit(p,lanes);
  }
  function reconcileClips(p,beforeClips,beforeLanes,copies={}){
    const next=beforeLanes.filter(l=>l.scope!=='clip').map(copy);
    for(const clip of p.arrangementClips){
      const source=copies[clip.id]?.clip||beforeClips.find(c=>c.id===clip.id);
      if(!source)continue;
      const lanes=copies[clip.id]?.lanes||beforeLanes.filter(l=>l.scope==='clip'&&l.targetId===source.id);
      const oldRatio=source.sourceDurationBeats/source.timelineDurationBeats,newRatio=clip.sourceDurationBeats/clip.timelineDurationBeats;
      if(!(oldRatio>0&&newRatio>0))continue;
      const daw=window.AxiomStudioDaw,reinterpreted=source.bpm!==clip.bpm;
      const direction=source.reversed&&clip.reversed?-1:1;
      const oldOrigin=source.sourceStartBeat+(direction<0?source.sourceDurationBeats:0),newOrigin=clip.sourceStartBeat+(direction<0?clip.sourceDurationBeats:0);
      // BPM correction changes source-beat units. Ordinary trims/moves retain
      // their existing beat arithmetic; corrections follow the same audio time.
      const remap=beat=>{
        const seconds=daw.sourceBeatToSeconds(source,oldOrigin+direction*beat*oldRatio);
        const mapped=(daw.sourceSecondsToBeat(clip,seconds)-newOrigin)/(direction*newRatio);
        return Math.abs(mapped)<1e-9?0:mapped;
      };
      for(const raw of lanes){
        const lane=normalize(raw),shift=(oldOrigin-newOrigin)/(direction*newRatio),scale=oldRatio/newRatio;
        const points=lane.points.map(point=>({...point,beat:reinterpreted?remap(point.beat):point.beat*scale+shift}));
        if(points.some(point=>point.beat<0)&&!points.some(point=>point.beat===0)){
          const oldBeat=reinterpreted?(daw.sourceSecondsToBeat(source,daw.sourceBeatToSeconds(clip,newOrigin))-oldOrigin)/(direction*oldRatio):-shift/scale;
          const key=lane.parameter.startsWith('stemGain_')?lane.parameter:'mix'+lane.parameter[0].toUpperCase()+lane.parameter.slice(1);
          const active=lane.points.filter(point=>point.beat<=oldBeat).at(-1);
          points.push({beat:0,value:valueAt({...lane,enabled:true},oldBeat,source[key]??definitions[lane.parameter][3]),curve:active?.curve||'hold'});
        }
        next.push(normalize({...lane,targetId:clip.id,points:points.filter(point=>point.beat>=0)}));
      }
    }
    p.automationLanes=next;
  }
  function edit(refs,parameter='volume',filterStart=null){
    const p=window.AxiomStudioDaw.activeProject;if(!p||!refs?.length)return;
    try{refs.forEach(ref=>{normalize({...ref,parameter,points:[]});if(!available(p,ref,parameter))throw new Error('Automation parameter is unavailable for this effect.');});}catch(e){window.showToast?.(e.message,true);return;}
    document.getElementById('daw-parameter-automation')?.remove();
    const dialog=document.createElement('dialog');dialog.id='daw-parameter-automation';dialog.className='daw-parameter-automation';dialog.setAttribute('aria-label','Parameter Automation');
    const form=document.createElement('form'),heading=document.createElement('h2');heading.textContent='Automation';
    const title=document.createElement('p'),object=target(p,refs[0]);title.textContent=refs.length>1?`${refs.length} selected clips`:refs[0].scope==='project'?'Master':refs[0].scope==='fx'?`${window.AxiomDawFx?.label?.(object?.type)||'Effect'} · ${object?.target?.replace('-',' ')||''}`:object?.title||refs[0].targetId;
    const selector=document.createElement('select');selector.setAttribute('aria-label','Automation parameter');
    for(const [key,[label]] of Object.entries(definitions))if(refs.every(ref=>available(p,ref,key))){const option=document.createElement('option');option.value=key;option.textContent=label;selector.append(option);}
    selector.value=parameter;
    const enabled=document.createElement('input');enabled.type='checkbox';enabled.setAttribute('aria-label','Enable automation');
    const enableLabel=document.createElement('label');enableLabel.append(enabled,document.createTextNode('Enabled'));
    const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=180;canvas.setAttribute('aria-label','Automation curve');
    const table=document.createElement('div');table.className='daw-automation-points';
    const error=document.createElement('p');error.setAttribute('role','alert');
    const guide=document.createElement('p');guide.className='daw-filter-automation-guide';
    const footer=document.createElement('footer');
    const button=(label,action)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=action;return b;};
    let lane,span=16,selected=-1;
    const currentValue=()=>{
      const ref=refs[0],object=target(p,ref)||{},key=ref.scope==='clip'&&!selector.value.startsWith('stemGain_')?'mix'+selector.value[0].toUpperCase()+selector.value.slice(1):selector.value;
      if(key==='cutoffHz'&&object.cutoffHz===undefined)return object.reverse?18000:80;
      return object[key]??definitions[selector.value][3];
    };
    function draw(){
      const ctx=canvas.getContext('2d'),[,min,max]=definitions[selector.value];
      ctx.clearRect(0,0,1000,180);ctx.strokeStyle='#454e49';ctx.lineWidth=1;
      for(let i=0;i<=16;i++){ctx.beginPath();ctx.moveTo(i/16*1000,0);ctx.lineTo(i/16*1000,180);ctx.stroke();}
      if(selector.value==='filterPosition'){ctx.beginPath();ctx.moveTo(0,90);ctx.lineTo(1000,90);ctx.stroke();}
      ctx.strokeStyle='#a3ff00';ctx.lineWidth=2;ctx.beginPath();
      const curve={...lane,points:[...lane.points].sort((a,b)=>a.beat-b.beat)};
      const fx=target(p,refs[0]),sweep=selector.value==='cutoffHz'&&fx?.cutoffHz===undefined?window.AxiomDawFx?.cutoffCurve(p,fx):null;
      for(let x=0;x<=1000;x++){const beat=x/1000*span,y=180-(valueAt(curve,beat,sweep?sweep(fx.startBeat+beat):currentValue())-min)/(max-min)*180;x?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.stroke();
      lane.points.forEach((point,i)=>{ctx.fillStyle=i===selected?'#ffffff':'#a3ff00';ctx.fillRect(point.beat/span*1000-5,180-(point.value-min)/(max-min)*180-5,10,10);});
    }
    function render(){
      guide.hidden=selector.value!=='filterPosition';guide.textContent=(refs[0].scope==='clip'?'Selected clip only, including its active stems. ':'')+'Up: high-pass (less bass). Centre 0: filter off. Down: low-pass (less treble). Add points and drag to draw the sweep; return a point to 0 for the original sound.';
      table.replaceChildren();
      lane.points.forEach((point,i)=>{
        const row=document.createElement('div');row.className='daw-automation-point';
        for(const [label,key,value] of [['Bar','beat',point.beat/4+1],['Value','value',point.value]]){
          const input=document.createElement('input');input.type='number';input.required=true;input.step='any';input.value=value;input.setAttribute('aria-label',`${label} ${i+1}`);
          input.min=key==='beat'?1:definitions[selector.value][1];if(key==='value')input.max=definitions[selector.value][2];
          input.onchange=()=>{const previous=point[key];point[key]=key==='beat'?(Number(input.value)-1)*4:Number(input.value);try{lane=normalize(lane);error.textContent='';render();}catch(e){point[key]=previous;error.textContent=e.message;}};row.append(input);
        }
        const curve=document.createElement('select');curve.setAttribute('aria-label',`Curve ${i+1}`);
        for(const value of ['linear','hold']){const option=document.createElement('option');option.value=value;option.textContent=value;curve.append(option);}curve.value=point.curve;curve.onchange=()=>{point.curve=curve.value;draw();};row.append(curve);
        row.append(button('Remove',()=>{lane.points.splice(i,1);render();}));table.append(row);
      });
      span=Math.max(.25,refs[0].scope==='clip'?(object?.timelineDurationBeats||16):16,...lane.points.map(point=>point.beat));draw();
    }
    function load(){
      const saved=p.automationLanes?.find(l=>identity(l)===identity({...refs[0],parameter:selector.value}));
      const points=!saved&&selector.value==='filterPosition'&&Number.isFinite(filterStart)?[{beat:0,value:filterStart,curve:'linear'},{beat:object?.timelineDurationBeats||16,value:0,curve:'hold'}]:[];
      lane=copy(saved||{...refs[0],parameter:selector.value,enabled:true,points});lane=normalize(lane);enabled.checked=lane.enabled;selected=-1;render();
    }
    selector.onchange=load;enabled.onchange=()=>{lane.enabled=enabled.checked;};
    canvas.onpointerdown=event=>{
      if(event.button!==0)return;event.preventDefault();const rect=canvas.getBoundingClientRect(),[,min,max]=definitions[selector.value];
      const pointAt=e=>{let value=Math.max(min,Math.min(max,max-(e.clientY-rect.top)/rect.height*(max-min)));if(selector.value==='filterPosition'&&!e.altKey&&Math.abs(e.clientY-rect.top-rect.height/2)<8)value=0;return {beat:Math.max(0,Math.min(span,(e.clientX-rect.left)/rect.width*span)),value,curve:'linear'};};
      const before=copy(lane),at=pointAt(event);selected=lane.points.findIndex(point=>Math.abs(point.beat-at.beat)/span*rect.width<10&&Math.abs(point.value-at.value)/(max-min)*rect.height<12);
      if(selected<0){lane.points.push(at);selected=lane.points.length-1;}const moving=lane.points[selected];
      canvas.setPointerCapture(event.pointerId);
      const move=e=>{const next=pointAt(e);moving.beat=next.beat;moving.value=next.value;draw();};
      const end=e=>{canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',end);canvas.removeEventListener('pointercancel',end);if(e.type==='pointercancel')lane=before;try{lane=normalize(lane);error.textContent='';}catch(ex){lane=before;error.textContent=ex.message;}render();};
      canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);render();
    };
    footer.append(button('Add Point',()=>{lane.points.push({beat:lane.points.length?lane.points.at(-1).beat+4:0,value:currentValue(),curve:'linear'});render();}),button('Clear',()=>{lane.points=[];render();}),button('Cancel',()=>dialog.close()));
    const save=button('Apply',()=>{
      try{if(!form.reportValidity())return;if(p!==window.AxiomStudioDaw.activeProject)throw new Error('The active project changed.');apply(p,refs.map(ref=>({...copy(lane),...ref})));dialog.close();}catch(e){error.textContent=e.message;}
    });footer.append(save);
    const columns=document.createElement('div');columns.className='daw-automation-point';
    for(const label of [refs[0].scope==='clip'?'Clip bar':refs[0].scope==='fx'?'FX bar':'Project bar','Value','Curve','']){const text=document.createElement('span');text.textContent=label;columns.append(text);}
    form.onsubmit=e=>e.preventDefault();form.append(heading,title,selector,enableLabel,guide,canvas,columns,table,error,footer);dialog.append(form);dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);load();dialog.showModal();
  }
  window.AxiomDawAutomation={definitions,supported,available,recordable,normalize,validateProject,valueAt,schedule,apply,commit,undo,edit,reconcileClips};

  window.AxiomStudioDaw = Object.freeze({
    ...existing,
    createAutomationLane,
    createBpmAutomation,
  });
})();
