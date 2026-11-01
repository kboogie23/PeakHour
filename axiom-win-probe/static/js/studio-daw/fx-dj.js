(function(){
  'use strict';
  const types={filter:'DJ Filter',sidechainHard:'Sidechain Hard',sidechainSoft:'Sidechain Soft',amplify:'Amplify',brighten:'Enhance',limiter:'Region Limiter',tranceGate:'AXIOM Trance Gate',gatedSweep:'Gated Sweep Up',...(window.AxiomCreativeFx?.types||{})};
  const gatePresets={Pulse:[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],Offbeat:[0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0],Lift:[1,2,0,0,1,2,0,0,1,0,1,0,1,1,1,1],Stutter:[1,0,1,1,0,1,0,0,1,0,1,1,0,1,0,1]};
  const sources=['left-deck','right-deck','samples','recordings','instruments'];
  const controls={...(window.AxiomCreativeFx?.controls||{}),
    gatedSweep:[],
    filter:[['filterPosition','Filter: low-pass / centre off / high-pass',-100,100,1,0]],
    tranceGate:[['gateDepth','Chop strength (%)',0,100,1,100],['gateAttackMs','Step fade-in (ms)',0,100,1,3],['gateDecayMs','Step decay (ms)',0,300,1,25],['gateSustain','Step hold level (%)',0,100,1,100],['gateReleaseMs','Step fade-out (ms)',0,200,1,10],['gateSwing','Swing (%)',0,75,1,0]],
    sidechainHard:[['fxAmount','Amount (%)',0,100,1,50]],sidechainSoft:[['fxAmount','Amount (%)',0,100,1,50]],
    amplify:[['driveDb','Boost (dB)',0,12,.1,0]],brighten:[['fxAmount','Brightness (%)',0,100,1,0]],
    limiter:[['driveDb','Boost (dB)',0,12,.1,0],['ceilingDb','Output ceiling (dB)',-12,0,.1,-1],['limiterReleaseMs','Release (ms)',10,1000,1,100]]
  };
  const help={...(window.AxiomCreativeFx?.help||{}),filter:'Centre is unfiltered. Below centre removes treble; above centre removes bass. Automate Filter to draw your sweep.',sidechainHard:'Stronger ducking from another track. The trigger is taken before its deck effects and fader.',sidechainSoft:'Gentler ducking from another track. The trigger is taken before its deck effects and fader.',amplify:'Raise the level. Use Region Limiter after Amplify to control peaks inside this FX region.',brighten:'Add upper-frequency clarity with a gentle high shelf.',limiter:'Stereo-linked sample-peak limiting for this timeline FX region only. Use Open Master Limiter for the whole-mix Amount dial.'};
  const modules=new WeakMap();
  const dynamic=type=>['sidechainHard','sidechainSoft','limiter'].includes(type);
  async function prepare(ctx,p){
    if(!(p.fxRegions||[]).some(f=>dynamic(f.type))&&!p.masterMixer?.limiter)return;
    if(!ctx.audioWorklet||typeof AudioWorkletNode!=='function')throw new Error('These dynamics effects need audio-worklet support. Update AXIOM before playing this project.');
    if(!modules.has(ctx))modules.set(ctx,ctx.audioWorklet.addModule('/static/js/studio-daw/fx-dynamics-worklet.js?v=20260914-master-limiter').catch(error=>{modules.delete(ctx);throw error;}));
    await modules.get(ctx);
  }
  function validate(fx){
    if(!Object.hasOwn(types,fx.type))return false;
    if(Object.hasOwn(window.AxiomCreativeFx?.types||{},fx.type)&&!window.AxiomCreativeFx.validate(fx))return false;
    if(fx.type==='tranceGate'&&((fx.gateSteps!==undefined&&(!Array.isArray(fx.gateSteps)||![8,16,32].includes(fx.gateSteps.length)||fx.gateSteps.some(s=>![0,1,2].includes(s))))||(fx.gateStepBeats!==undefined&&![.125,.25,.5,1,2].includes(fx.gateStepBeats))))return false;
    if(fx.type==='limiter'&&fx.wet!==1)return false;
    if(fx.type.startsWith('sidechain')&&(!sources.includes(fx.sidechainSource)||fx.sidechainSource===fx.target))return false;
    return controls[fx.type].every(([key,,min,max])=>fx[key]===undefined||Number.isFinite(fx[key])&&fx[key]>=min&&fx[key]<=max);
  }
  function gateEnvelope(clock,fx){
    const steps=fx.gateSteps||gatePresets.Pulse,step=fx.gateStepBeats??.25,endBeat=fx.startBeat+fx.durationBeats;
    const at=i=>clock.beatToSeconds(Math.min(endBeat,fx.startBeat+i*step+(i%2?(fx.gateSwing||0)/100*step:0)));
    const points=[{time:at(0),value:0}],count=Math.ceil(fx.durationBeats/step);
    for(let i=0;i<count;i++){
      const state=steps[i%steps.length];if(state!==1)continue;
      const start=at(i);let last=i+1;
      while(last<count&&steps[last%steps.length]===2)last++;
      const end=at(last),span=end-start,attack=Math.min((fx.gateAttackMs??3)/1000,span*.25),release=Math.min((fx.gateReleaseMs??10)/1000,span*.25),decay=Math.min((fx.gateDecayMs??25)/1000,Math.max(0,span-attack-release)),sustain=(fx.gateSustain??100)/100;
      points.push({time:start,value:0},{time:start+attack,value:1},{time:start+attack+decay,value:sustain},{time:end-release,value:sustain},{time:end,value:0});i=last-1;
    }
    points.push({time:clock.beatToSeconds(endBeat),value:0});return points;
  }
  function connect(ctx,input,own,fx,timing,controlled,routing,clock){
    if(Object.hasOwn(window.AxiomCreativeFx?.types||{},fx.type))return window.AxiomCreativeFx.connect(ctx,input,own,fx,timing,controlled,routing,clock);
    if(fx.type==='gatedSweep')return window.AxiomDawSweeps.connect(ctx,input,own,fx,timing,controlled,routing,clock);
    const bind=(param,key,transform=v=>v)=>{const field=controls[fx.type].find(c=>c[0]===key);controlled(fx,param,key,timing,field[5],transform);};
    if(fx.type==='tranceGate'){
      const gate=own(ctx.createGain()),depth=own(ctx.createGain()),dry=own(ctx.createGain()),sum=own(ctx.createGain());
      depth.gain.value=(fx.gateDepth??100)/100;dry.gain.value=1-depth.gain.value;
      const points=gateEnvelope(clock,fx),from=ctx.currentTime-timing.origin;
      let value=0;
      for(let i=0;i<points.length;i++){
        const point=points[i];if(point.time<=from){value=point.value;continue;}
        const previous=points[i-1];if(previous&&previous.time<from)value=previous.value+(point.value-previous.value)*(from-previous.time)/(point.time-previous.time);break;
      }
      gate.gain.value=value;gate.gain.setValueAtTime(value,ctx.currentTime);
      for(const point of points)if(point.time>=from)gate.gain.linearRampToValueAtTime(point.value,timing.origin+point.time);
      bind(depth.gain,'gateDepth',v=>v/100);bind(dry.gain,'gateDepth',v=>1-v/100);
      input.connect(gate).connect(depth).connect(sum);input.connect(dry).connect(sum);return sum;
    }
    if(fx.type==='amplify'){const node=own(ctx.createGain());bind(node.gain,'driveDb',v=>Math.pow(10,v/20));input.connect(node);return node;}
    if(fx.type==='brighten'){const node=own(ctx.createBiquadFilter());node.type='highshelf';node.frequency.value=4500;bind(node.gain,'fxAmount',v=>v*.09);input.connect(node);return node;}
    if(fx.type==='filter'){
      const sum=own(ctx.createGain()),dry=own(ctx.createGain()),lp=own(ctx.createBiquadFilter()),hp=own(ctx.createBiquadFilter()),low=own(ctx.createGain()),high=own(ctx.createGain());
      lp.type='lowpass';hp.type='highpass';lp.Q.value=hp.Q.value=0;
      const amount=v=>Math.min(1,Math.abs(v)/4);
      bind(dry.gain,'filterPosition',v=>1-amount(v));bind(low.gain,'filterPosition',v=>v<0?amount(v):0);bind(high.gain,'filterPosition',v=>v>0?amount(v):0);
      bind(lp.frequency,'filterPosition',v=>20000*Math.pow(40/20000,Math.max(0,-v)/100));
      bind(hp.frequency,'filterPosition',v=>20*Math.pow(18000/20,Math.max(0,v)/100));
      input.connect(dry).connect(sum);input.connect(lp).connect(low).connect(sum);input.connect(hp).connect(high).connect(sum);return sum;
    }
    if(dynamic(fx.type)){
      const node=own(new AudioWorkletNode(ctx,'axiom-dj-dynamics',{numberOfInputs:2,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{mode:fx.type}}));
      node.onprocessorerror=()=>routing?.onerror?.();
      for(const [key] of controls[fx.type])bind(node.parameters.get(key),key);
      input.connect(node,0,0);
      if(fx.type.startsWith('sidechain')){
        const trigger=routing?.taps?.get(fx.sidechainSource);
        if(!trigger)throw new Error('Sidechain trigger is unavailable. Select a different track.');
        trigger.connect(node,0,1);
      }
      return node;
    }
    throw new Error('Unsupported DJ effect.');
  }
  function editor(form,fx,fields){
    const nodes={},all=new Map(Object.values(controls).flat().map(field=>[field[0],field]));
    for(const [key,label,min,max,step,value] of all.values()){
      const row=document.createElement('label');row.textContent=label;const input=document.createElement('input');
      Object.assign(input,{type:key==='buildAmount'?'range':'number',name:key,min,max,step,value:fx[key]??value,required:true});input.setAttribute('aria-label',label);row.append(input);form.querySelector('footer').before(row);nodes[key]={row,input};
    }
    const row=document.createElement('label');row.textContent='Trigger track';const select=document.createElement('select');select.name='sidechainSource';
    for(const source of sources){const option=document.createElement('option');option.value=source;option.textContent=source==='instruments'?'Drums / Instruments':source.replace('-',' ');select.append(option);}
    select.value=fx.sidechainSource||(fx.target==='left-deck'?'right-deck':'left-deck');row.append(select);form.querySelector('footer').before(row);
    const description=document.createElement('p');description.className='daw-dj-fx-help';form.querySelector('footer').before(description);
    const gateRow=document.createElement('div');gateRow.className='daw-gate-editor';gateRow.innerHTML='<label>Step length<select name="gateStepBeats" aria-label="Step length"><option value="0.125">1/32 note</option><option value="0.25">1/16 note</option><option value="0.5">1/8 note</option><option value="1">1/4 note</option><option value="2">1/2 note</option></select></label><label>Pattern length<select aria-label="Gate pattern length"><option>8</option><option>16</option><option>32</option></select></label><label>Pattern preset<select aria-label="Gate pattern preset"><option value="">Custom</option></select></label><div class="daw-gate-steps" role="group" aria-label="Gate pattern steps"></div><small>Click a step: off, on, then tied. Tied steps hold the previous opening. The pattern repeats through the effect region.</small>';
    let gateSteps=[...(fx.gateSteps||gatePresets.Pulse)];
    const resolution=gateRow.querySelector('[name="gateStepBeats"]'),length=gateRow.querySelector('[aria-label="Gate pattern length"]'),preset=gateRow.querySelector('[aria-label="Gate pattern preset"]'),grid=gateRow.querySelector('.daw-gate-steps');
    const gateHint=gateRow.querySelector('small');gateHint.id='daw-gate-pattern-help';
    for(const select of [resolution,length,preset]){select.title=select===length?'Choose 8, 16 or 32 repeating steps.':select===preset?'Load a starting rhythm, then edit its steps.':'Choose the musical duration of one step.';select.setAttribute('aria-describedby',gateHint.id);}
    resolution.value=String(fx.gateStepBeats??.25);length.value=gateSteps.length;
    for(const name of Object.keys(gatePresets)){const option=document.createElement('option');option.value=option.textContent=name;preset.append(option);}
    function paintGate(){grid.replaceChildren();gateSteps.forEach((value,i)=>{const button=document.createElement('button');button.type='button';button.textContent=value===2?'Tie':String(i+1);button.setAttribute('aria-label',`Gate step ${i+1}: ${['off','on','tied'][value]}`);button.setAttribute('aria-pressed',String(value>0));button.title='Click to cycle off, on and tied';button.onclick=()=>{gateSteps[i]=(gateSteps[i]+1)%3;preset.value='';paintGate();};grid.append(button);});}
    length.onchange=()=>{gateSteps=Array.from({length:Number(length.value)},(_,i)=>gateSteps[i]??0);preset.value='';paintGate();};preset.onchange=()=>{if(gatePresets[preset.value]){gateSteps=[...gatePresets[preset.value]];length.value=gateSteps.length;paintGate();}};
    paintGate();form.querySelector('footer').before(gateRow);
    let prior=null;
    function update(){
      const type=fields.type.value,custom=Object.hasOwn(types,type),sidechain=type.startsWith('sidechain');
      gateRow.hidden=type!=='tranceGate';for(const control of gateRow.querySelectorAll('select,button'))control.disabled=type!=='tranceGate';
      if(custom&&prior!==type&&!fx.id)fields.wet.value=type==='gatedSweep'?String(fx.type===type?fx.wet??.5:.5):'1';
      for(const [key,{row,input}] of Object.entries(nodes)){
        const field=custom&&controls[type].find(c=>c[0]===key),on=Boolean(field);row.hidden=!on;input.disabled=!on;
        if(on){row.firstChild.textContent=field[1];if(prior!==type)input.value=(type===fx.type?fx[key]:undefined)??field[5];}
      }
      prior=type;
      row.hidden=!sidechain;select.disabled=!sidechain;
      for(const option of select.options)option.disabled=option.value===fields.target.value;
      if(sidechain&&select.value===fields.target.value)select.value=sources.find(s=>s!==fields.target.value);
      description.hidden=!custom;description.textContent=help[type]||'';
      if(custom){fields.tail.disabled=true;fields.tail.parentElement.hidden=true;fields.reverse.disabled=true;fields.reverse.parentElement.hidden=true;}
      else fields.tail.parentElement.hidden=false;
      fields.wet.disabled=type==='limiter';fields.wet.parentElement.hidden=type==='limiter';if(type==='limiter')fields.wet.value='1';
    }
    fields.target.addEventListener('change',update);
    return {update,read(region){if(!Object.hasOwn(types,region.type))return;for(const [key] of controls[region.type])region[key]=Number(nodes[key].input.value);if(region.type.startsWith('sidechain'))region.sidechainSource=select.value;if(region.type==='tranceGate'){region.gateSteps=[...gateSteps];region.gateStepBeats=Number(resolution.value);}}};
  }
  window.AxiomDawDjFx={types,sources,controls,help,prepare,validate,connect,editor,gateEnvelope,gatePresets};
})();
