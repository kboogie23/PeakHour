(function(){
  'use strict';
  const presets={
    axiomWidePad:{name:'AXIOM Wide Pad',type:'LayerSynth',layers:['sawtooth','sawtooth','triangle','sine'],envelope:{attack:.5,decay:.3,sustain:.7,release:2},brightness:2400,spread:9,blend:.35},
    axiomTranceLead:{name:'AXIOM Trance Lead',type:'LayerSynth',layers:['sawtooth','sawtooth','square','triangle'],envelope:{attack:.015,decay:.12,sustain:.75,release:.3},brightness:6800,spread:12,blend:.2},
    axiomDeepBass:{name:'AXIOM Deep Bass',type:'LayerSynth',layers:['sawtooth','square','sine','sine'],envelope:{attack:.008,decay:.2,sustain:.55,release:.12},brightness:900,spread:2,blend:.65},
    axiomGlassKeys:{name:'AXIOM Glass Keys',type:'LayerSynth',layers:['triangle','sine','sine','triangle'],envelope:{attack:.005,decay:.5,sustain:.12,release:1.1},brightness:9000,spread:4,blend:.45},
  };
  const controls=[
    ['brightness','Brightness (Hz)',100,16000,50,'Raise this for a brighter sound. Lower it for a softer, darker sound.'],
    ['spread','Detune spread (cents)',0,30,.5,'Raise this to thicken the layers. Lower it for a steadier pitch.'],
    ['blend','Layer blend',0,1,.01,'Move toward 0 for the main oscillator pair; toward 1 for the supporting pair.'],
    ['width','Stereo spread',0,1,.01,'0 centres all layers. Higher values spread the main layers left and right.'],
    ['attack','Fade-in (seconds)',.001,3,.01,'Raise this for a slow pad swell. Lower it for an immediate hit.'],
    ['decay','Initial fade (seconds)',.01,3,.01,'How long the initial peak takes to settle to the held level.'],
    ['sustain','Held level',0,1,.01,'How loud the sound stays while a note is held.'],
    ['release','Fade after note (seconds)',.02,5,.01,'Higher values ring out longer after you release a note. The pattern boundary still stops the sound.'],
  ];
  function settings(sound,patch){
    const preset=presets[sound];if(!preset)throw new Error('Unknown AXIOM layered sound.');
    if(patch!==undefined&&(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(key=>!controls.some(c=>c[0]===key))))throw new Error('Invalid synth settings.');
    const result={brightness:preset.brightness,spread:preset.spread,blend:preset.blend,width:.8,...preset.envelope,...patch};
    for(const [key,,min,max] of controls)if(!Number.isFinite(result[key])||result[key]<min||result[key]>max)throw new Error('Invalid synth '+key+'.');
    return result;
  }
  function createVoice(Tone,context,sound,patch,{volume=-12,detune=0}={}){
    const s=settings(sound,patch),preset=presets[sound],owned=[],own=node=>{owned.push(node);return node;};
    try{
      const output=own(new Tone.Gain({context,gain:1})),filter=own(new Tone.Filter({context,type:'lowpass',frequency:s.brightness,Q:.7,rolloff:-24})).connect(output);
      const layers=preset.layers.map((type,i)=>{
        const balance=(i<2?1-s.blend:s.blend)/2,pan=i<2?(i===0?-1:1)*s.width:0;
        const panner=own(new Tone.Panner({context,pan})).connect(filter),gain=own(new Tone.Gain({context,gain:balance})).connect(panner);
        const cents=i<2?(i===0?-1:1)*s.spread:0,octave=sound==='axiomDeepBass'&&i>=2?-12:sound==='axiomGlassKeys'&&i===3?12:0;
        const voice=own(new Tone.Synth({context,volume,detune:detune+cents,oscillator:{type,phase:i*73},envelope:{attack:s.attack,decay:s.decay,sustain:s.sustain,release:s.release}})).connect(gain);
        return {voice,cents,ratio:Math.pow(2,octave/12)};
      });
      return {connect(destination){output.connect(destination);return this;},detune:{setValueAtTime(value,time){for(const l of layers)l.voice.detune.setValueAtTime(value+l.cents,time);}},
        triggerAttack(frequency,time,velocity){for(const l of layers)l.voice.triggerAttack(frequency*l.ratio,time,velocity);},
        triggerRelease(time){for(const l of layers)l.voice.triggerRelease(time);},
        triggerAttackRelease(frequency,duration,time,velocity){for(const l of layers)l.voice.triggerAttackRelease(frequency*l.ratio,duration,time,velocity);},
        dispose(){for(const node of owned)node.dispose();}};
    }catch(error){for(const node of owned)node.dispose();throw error;}
  }
  function edit(id){
    const p=window.AxiomStudioDaw.activeProject,c=window.AxiomPatterns.list(p).find(c=>c.id===id);if(!c||!presets[c.sound])return;
    const before=JSON.stringify(c),values=settings(c.sound,c.synthPatch),dialog=document.createElement('dialog');dialog.className='daw-fx-dialog';dialog.setAttribute('aria-label','AXIOM Layer Synth');
    const form=document.createElement('form');form.method='dialog';const title=document.createElement('h2');title.textContent=presets[c.sound].name;form.append(title);
    for(const [key,label,min,max,step,help] of controls){const row=document.createElement('label');row.style.flexWrap='wrap';const caption=document.createElement('span');caption.textContent=label;const input=document.createElement('input');Object.assign(input,{type:'number',name:key,min,max,step:step===.01?'any':step,value:values[key],required:true});input.setAttribute('aria-label',label);input.title=help;const hint=document.createElement('small');hint.textContent=help;hint.style.cssText='flex-basis:100%;color:#bac7be;line-height:1.4';row.append(caption,input,hint);form.append(row);}
    const footer=document.createElement('footer');footer.innerHTML='<button value="cancel">Cancel</button><button value="save">Apply sound</button>';form.append(footer);dialog.append(form);
    form.onsubmit=event=>{if(event.submitter?.value!=='save')return;const patch=Object.fromEntries(controls.map(([key])=>[key,Number(form.elements.namedItem(key).value)]));
      try{settings(c.sound,patch);if(p!==window.AxiomStudioDaw.activeProject||JSON.stringify(window.AxiomPatterns.list(p).find(x=>x.id===id))!==before||!window.AxiomStudioDaw.editPattern(id,'apply',{synthPatch:patch}))throw new Error('The pattern changed. Reopen its sound settings.');}
      catch(error){event.preventDefault();window.showToast?.(error.message,true);}};
    dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();
  }
  window.AxiomLayerSynth={presets,controls,settings,createVoice,edit};
})();
