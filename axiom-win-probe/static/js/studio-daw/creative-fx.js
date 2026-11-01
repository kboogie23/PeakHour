(function(){
  'use strict';
  const types={beatRepeat:'AXIOM Stutter',transitionBuild:'AXIOM Build',saturate:'AXIOM Warmth',bitcrush:'AXIOM Crunch'};
  const controls={beatRepeat:[['repeatPitch','Repeat pitch (semitones)',-24,12,1,0],['repeatDecay','Repeat fade (%)',0,100,1,0]],transitionBuild:[['buildAmount','Build knob (%)',0,100,1,75]],saturate:[['gritDrive','Warmth drive (dB)',0,24,.1,6]],bitcrush:[['crushBits','Bit depth',2,16,1,8],['crushHold','Sample hold',1,32,1,4]]};
  const help={beatRepeat:'Capture the opening slice and repeat it through these bars. Shorter slices make a tighter stutter.',transitionBuild:'One knob removes bass and brings in echo and room reverb together. Ramp rises across the selected bars; Constant holds the knob value.',saturate:'Add soft saturation. Start gently and compare at the same loudness.',bitcrush:'Reduce sample precision and hold samples for a crunchy digital sound.'};
  const modules=new WeakMap(),historyTypes=['beatRepeat','transitionBuild','bitcrush'];
  function validate(f){return Object.hasOwn(types,f?.type)&&f.tailBeats===0&&controls[f.type].every(([k,,min,max])=>f[k]===undefined||Number.isFinite(f[k])&&f[k]>=min&&f[k]<=max)&&
    (f.type!=='beatRepeat'||(f.repeatBeats===undefined||[.125,.25,.5,1,2,4].includes(f.repeatBeats))&&f.durationBeats<=32)&&
    (f.type!=='transitionBuild'||f.durationBeats<=32&&(f.buildMode===undefined||['ramp','constant'].includes(f.buildMode)));}
  function timing(p,f,rate=48000){
    if(!validate(f))throw new Error('Check creative effect settings.');
    const map=window.AxiomStudioDaw.compileTempoMap(p),start=map.beatToSeconds(f.startBeat),end=map.beatToSeconds(f.startBeat+f.durationBeats),step=f.repeatBeats??.5,boundaries=[];
    if(['beatRepeat','transitionBuild'].includes(f.type)&&end-start>32)throw new Error('Stutter and Build support up to 8 bars and 32 seconds.');
    // One echo tap per eighth note; every boundary follows tempo automation.
    for(let b=f.startBeat;b<f.startBeat+f.durationBeats;b+=f.type==='beatRepeat'?step:.5)boundaries.push(Math.round(map.beatToSeconds(b)*rate));
    return {start,end,boundaries,size:f.type==='beatRepeat'?Math.ceil((end-start+.01)*rate)+4:f.type==='transitionBuild'?Math.ceil(rate*2)+4:128,
      loopFrames:Math.max(1,Math.round((map.beatToSeconds(Math.min(f.startBeat+step,f.startBeat+f.durationBeats))-start)*rate))};
  }
  async function prepare(ctx,p){
    if(!(p.fxRegions||[]).some(f=>Object.hasOwn(types,f.type)))return;
    if(!ctx.audioWorklet||typeof AudioWorkletNode!=='function')throw new Error('Creative effects need audio-worklet support.');
    if(!modules.has(ctx))modules.set(ctx,ctx.audioWorklet.addModule('/static/js/studio-daw/creative-fx-worklet.js?v=20261015-1').catch(e=>{modules.delete(ctx);throw e;}));
    await modules.get(ctx);
  }
  function connect(ctx,input,own,f,timingRef,controlled,routing,clock){
    const p=routing?.project||window.AxiomStudioDaw.activeProject;
    // The graph clock is authoritative, including when rendering an isolated clone.
    const t=timing(p,f,ctx.sampleRate),origin=timingRef.origin;
    const node=own(new AudioWorkletNode(ctx,'axiom-creative-fx',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{mode:f.type,size:t.size,loopFrames:t.loopFrames,
      startFrame:Math.round((origin+t.start)*ctx.sampleRate),endFrame:Math.round((origin+t.end)*ctx.sampleRate),boundaries:t.boundaries.map(x=>x+Math.round(origin*ctx.sampleRate)),
      seed:routing?.tapeSeeds?.get(f.id),resumeFrame:Math.round((origin+(routing?.tapeResume??0))*ctx.sampleRate),captureFrame:routing?.tapeCapture?.frame,buildMode:(p.automationLanes||[]).some(l=>l.scope==='fx'&&l.targetId===f.id&&l.parameter==='buildAmount'&&l.enabled!==false)?'constant':f.buildMode||'ramp'}}));
    for(const [key,,,,,fallback] of controls[f.type]){
      const param=node.parameters.get(key),snap=t=>Math.max(0,Math.round(t*ctx.sampleRate)/ctx.sampleRate),wrapped={get value(){return param.value;},set value(v){param.value=v;},cancelScheduledValues:t=>param.cancelScheduledValues(snap(t)),setValueAtTime:(v,t)=>param.setValueAtTime(v,snap(t)),linearRampToValueAtTime:(v,t)=>param.linearRampToValueAtTime(v,snap(t)),setTargetAtTime:(v,t,c)=>param.setTargetAtTime(v,snap(t),c)};const ramp=key==='buildAmount'&&(f.buildMode||'ramp')==='ramp'?()=>{const start=origin+t.start,end=origin+t.end,at=Math.max(ctx.currentTime,start),value=f.buildAmount??fallback;wrapped.cancelScheduledValues(at);wrapped.setValueAtTime(value*Math.max(0,Math.min(1,(at-start)/(end-start))),at);if(at<end)wrapped.linearRampToValueAtTime(value,end);}:null;controlled(f,wrapped,key,timingRef,fallback,v=>v,ramp);
    }
    if(routing?.tapeCapture&&historyTypes.includes(f.type)){
      const capture=routing.tapeCapture;capture.waiting.add(f.id);node.port.onmessage=({data})=>{if(data?.type==='history'){capture.states.set(f.id,data.state);capture.waiting.delete(f.id);}};
    }
    node.onprocessorerror=()=>{routing?.tapeCapture?.fail(new Error('Creative effect processing failed.'));routing?.onerror?.();};
    node.stop=()=>{node.port.postMessage({type:'stop'});node.port.close();};input.connect(node);return node;
  }
  function editor(form,f,fields){
    const rows=[],inputs={};
    const choice=(key,label,values,value)=>{const row=document.createElement('label');row.textContent=label;const input=document.createElement('select');input.name=key;input.setAttribute('aria-label',label);for(const [v,name] of values){const o=document.createElement('option');o.value=v;o.textContent=name;input.append(o);}input.value=String(value);row.append(input);form.querySelector('footer').before(row);rows.push({row,input,key});inputs[key]=input;};
    choice('repeatBeats','Stutter length',[[.125,'1/32 note'],[.25,'1/16 note'],[.5,'1/8 note'],[1,'1 beat'],[2,'2 beats'],[4,'1 bar']],f.repeatBeats??.5);
    choice('buildMode','Build motion',[['ramp','Rise across these bars'],['constant','Hold knob value']],f.buildMode||'ramp');
    const saved=document.createElement('label');saved.textContent='Saved Build';const presets=document.createElement('select');presets.setAttribute('aria-label','Saved Build');saved.append(presets);form.querySelector('footer').before(saved);
    const presetName=document.createElement('input');presetName.type='text';presetName.maxLength=60;presetName.placeholder='Name this preset';presetName.setAttribute('aria-label','Build preset name');saved.append(presetName);
    const save=document.createElement('button');save.type='button';save.textContent='Save Build preset';saved.append(save);
    const readPresets=()=>{try{const data=JSON.parse(localStorage.getItem('axiom-build-presets-v1')||'{}');return data&&typeof data==='object'&&!Array.isArray(data)?data:{};}catch{return {};}};
    const refresh=()=>{presets.replaceChildren();const o=document.createElement('option');o.value='';o.textContent='Choose preset';presets.append(o);for(const [name,v] of Object.entries(readPresets()).slice(0,32)){if(!v||typeof v!=='object'||!Number.isFinite(v.amount)||v.amount<0||v.amount>100||!['ramp','constant'].includes(v.mode))continue;const o=document.createElement('option');o.value=name;o.textContent=name;presets.append(o);}};refresh();
    presets.onchange=()=>{const v=readPresets()[presets.value],amount=form.querySelector('[name="buildAmount"]');if(v&&amount){amount.value=v.amount;inputs.buildMode.value=v.mode;}};
    save.onclick=()=>{const name=presetName.value;if(!name?.trim()){presetName.focus();return;}const amount=Number(form.querySelector('[name="buildAmount"]').value);if(!Number.isFinite(amount)||amount<0||amount>100)return;try{const values=readPresets();values[name.trim().slice(0,60)]={amount,mode:inputs.buildMode.value};localStorage.setItem('axiom-build-presets-v1',JSON.stringify(Object.fromEntries(Object.entries(values).slice(-32))));refresh();}catch(e){window.showToast?.('Build preset could not be saved: '+e.message,true);}};
    return {update(){const type=fields.type.value;for(const {row,input,key} of rows){const on=key==='repeatBeats'?type==='beatRepeat':type==='transitionBuild';row.hidden=!on;input.disabled=!on;}saved.hidden=type!=='transitionBuild';fields.length.max=['beatRepeat','transitionBuild'].includes(type)?8:256;},read(region){if(region.type==='beatRepeat')region.repeatBeats=Number(inputs.repeatBeats.value);if(region.type==='transitionBuild')region.buildMode=inputs.buildMode.value;}};
  }
  window.AxiomCreativeFx={types,controls,help,historyTypes,validate,timing,prepare,connect,editor};
})();
