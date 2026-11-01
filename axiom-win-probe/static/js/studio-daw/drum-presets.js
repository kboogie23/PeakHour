(function(){
  'use strict';
  const eighths=[1,3,5,7,9,11,13,15];
  const presets=[
    {id:'straight-pop',name:'Straight Pop',group:'Pop',bar:{Kick:[1,9,11],Snare:[5,13],Hats:eighths},fill:{Snare:[16]}},
    {id:'dance-pop',name:'Dance Pop',group:'Pop',bar:{Kick:[1,5,9,13],Clap:[5,13],Hats:[3,11],'Open Hat':[7,15]},fill:{Clap:[16]}},
    {id:'dembow',name:'Dembow-inspired',group:'Latin-inspired',bar:{Kick:[1,9],Snare:[7,13],Hats:eighths,Perc:[4,12,16]},fill:{Snare:[15]}},
    {id:'latin-pop',name:'Latin Pop',group:'Latin-inspired',bar:{Kick:[1,7,9,15],Snare:[5,13],Hats:[3,7,11,15],Perc:[1,4,7,11,13]},fill:{Perc:[16]}},
    {id:'house',name:'Four-on-floor House',group:'Dance',bar:{Kick:[1,5,9,13],Clap:[5,13],Hats:[1,5,9,13],'Open Hat':[3,7,11,15]},fill:{Clap:[16]}},
    {id:'half-time',name:'Half-time Hip-Hop',group:'Hip-Hop',bar:{Kick:[1,7,12],Snare:[9],Hats:eighths},fill:{Hats:[14,16]}},
    {id:'jersey-club',name:'Jersey Club',group:'Club',bar:{Kick:[1,5,9,12,15],Clap:[5,13],Hats:[3,7,11,15],Perc:[4,10,16]},fill:{Kick:[16]}}
  ];
  for(const preset of presets){
    for(const map of [preset.bar,preset.fill]){Object.values(map).forEach(Object.freeze);Object.freeze(map);}
    Object.freeze(preset);
  }
  Object.freeze(presets);
  function stepsFor(id){
    const preset=presets.find(p=>p.id===id);if(!preset)throw new Error('Choose a drum preset.');
    const steps=Object.fromEntries(Object.entries(preset.bar).map(([row,hits])=>[row,Array.from({length:4},(_,bar)=>hits.map(hit=>hit+bar*16)).flat()]));
    for(const [row,hits] of Object.entries(preset.fill))steps[row]=[...new Set([...(steps[row]||[]),...hits.map(hit=>hit+48)])].sort((a,b)=>a-b);
    return steps;
  }
  function missingSounds(project,id){
    return Object.keys(stepsFor(id)).filter(row=>!project.drumSamples?.[row]?.path).map(row=>{
      const sound=window.AxiomStarterKit.sounds.find(s=>s.row===row);
      if(!sound)throw new Error(`No starter sound for ${row}.`);return {row,sound};
    });
  }
  function patchFor(id,pattern){
    if(pattern.kind==='midi')throw new Error('Choose a drum pattern.');
    const base=stepsFor(id),length=pattern.lengthBeats;
    if(![4,8,16,32,64,128,256].includes(length))throw new Error('Invalid drum pattern length.');
    // Retain beat spacing in older long patterns with only 64 stored steps.
    const stepCount=Math.max(pattern.stepCount||64,length*4);
    const steps=Object.fromEntries(Object.entries(base).map(([row,hits])=>{
      const expanded=[];
      for(let offset=0;offset<length;offset+=16)for(const hit of hits){
        const beat=offset+(hit-1)/4;if(beat<length)expanded.push(1+beat*stepCount/length);
      }
      return [row,expanded];
    }));
    return {name:presets.find(p=>p.id===id).name,steps,stepCount};
  }
  let pendingSwitch=null;
  function extendPicker(select,project,pattern){
    if(pattern?.kind==='midi')return;
    const group=document.createElement('optgroup');group.label='Drum presets';
    for(const preset of presets)group.append(new Option(preset.name,`preset:${preset.id}`));
    select.append(group);select.value=pattern?.id||'';
    const selectPattern=select.onchange;
    select.onchange=()=>{
      if(!select.value.startsWith('preset:')){pendingSwitch?.abort();selectPattern?.();return;}
      switchPreset(select,project,pattern,select.value.slice(7));
    };
    select.title=pattern?'Select a project pattern or replace this drum groove with a preset':'Select a project pattern or create a drum preset';
  }
  async function switchPreset(select,project,pattern,id){
    pendingSwitch?.abort();
    const controller=new AbortController();pendingSwitch=controller;
    const beforePattern=JSON.stringify(pattern),beforeSamples=JSON.stringify(project.drumSamples||{});
    const valid=()=>!controller.signal.aborted&&select.isConnected&&project===window.AxiomStudioDaw.activeProject&&
      window.AxiomPatterns.active(project)?.id===pattern?.id&&JSON.stringify(window.AxiomPatterns.active(project))===beforePattern&&JSON.stringify(project.drumSamples||{})===beforeSamples;
    select.value=pattern?.id||'';select.disabled=true;select.setAttribute('aria-busy','true');
    try{
      const patch=pattern?patchFor(id,pattern):null;
      const entries=await window.AxiomStarterKit.stageSounds(missingSounds(project,id),{signal:controller.signal,onProgress:()=>{if(!valid())controller.abort();controller.signal.throwIfAborted();}});
      if(!valid())return;
      const samples={...project.drumSamples};
      for(const {row,track,name} of entries)samples[row]={path:track.path,name,assetIdentity:track.assetIdentity};
      const ok=pattern?window.AxiomStudioDaw.editPattern(pattern.id,'apply',patch,{samples}):
        window.AxiomStudioDaw.addPattern('drums',stepsFor(id),{name:presets.find(p=>p.id===id).name,samples});
      if(!ok)throw new Error('The drum preset could not be applied.');
      window.AxiomBeatPreview.rememberSamples(project,entries);window.AxiomDawDrafts?.checkpoint();
    }catch(error){if(valid())window.showToast?.(error.message,true);}
    finally{select.disabled=false;select.removeAttribute('aria-busy');if(pendingSwitch===controller)pendingSwitch=null;}
  }
  let closeActive=null;
  function mount(head){
    const group=document.createElement('div');group.className='daw-pattern-library';
    const kit=head.querySelector('.daw-starter-kit-launch');if(kit)group.append(kit);
    const button=document.createElement('button');button.type='button';button.className='daw-starter-kit-launch';
    button.textContent='Presets';button.title='Create a new four-bar drum groove';button.onclick=open;
    group.append(button);head.append(group);
  }
  function open(){
    const project=window.AxiomStudioDaw.activeProject;if(!project)return;
    closeActive?.();let closed=false,busy=false;
    const controller=new AbortController(),dialog=document.createElement('dialog');
    dialog.id='daw-drum-presets';dialog.setAttribute('aria-label','Drum Presets');
    dialog.innerHTML='<header><h2>Drum Presets</h2><button data-close aria-label="Close drum presets" title="Close drum presets"><img src="/static/icons/x.svg" alt=""></button></header><label class="daw-preset-choice">Groove<select aria-label="Groove"></select></label><div class="daw-preset-score" aria-label="Four-bar pattern preview"></div><label class="daw-preset-fill"><input type="checkbox" checked> Fill missing sounds</label><output role="status"></output><footer><span>4 bars</span><button data-create>Create Pattern</button></footer>';
    const select=dialog.querySelector('select'),score=dialog.querySelector('.daw-preset-score'),fill=dialog.querySelector('input'),status=dialog.querySelector('output'),create=dialog.querySelector('[data-create]');
    for(const name of new Set(presets.map(p=>p.group))){const group=document.createElement('optgroup');group.label=name;for(const p of presets.filter(p=>p.group===name))group.append(new Option(p.name,p.id));select.append(group);}
    const valid=()=>!closed&&project===window.AxiomStudioDaw.activeProject;
    function close(){if(closed)return;closed=true;controller.abort();dialog.close();dialog.remove();if(closeActive===close)closeActive=null;}
    closeActive=close;
    function render(){
      score.replaceChildren();
      const blank=document.createElement('span');score.append(blank);
      for(let bar=1;bar<=4;bar++){const label=document.createElement('span');label.className='daw-preset-bar';label.textContent=`Bar ${bar}`;score.append(label);}
      for(const [row,hits] of Object.entries(stepsFor(select.value))){
        const label=document.createElement('span');label.textContent=row;score.append(label);
        for(let step=1;step<=64;step++){const cell=document.createElement('i');cell.className=hits.includes(step)?'hit':'';cell.dataset.beat=String((step-1)%4===0);cell.setAttribute('aria-hidden','true');score.append(cell);}
      }
      const missing=missingSounds(project,select.value).map(s=>s.row);
      status.textContent=!fill.checked&&missing.length?`No sound loaded: ${missing.join(', ')}`:'';
    }
    select.onchange=render;fill.onchange=render;
    dialog.querySelector('[data-close]').onclick=close;
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('close',close,{once:true});
    create.onclick=async()=>{
      if(busy||!valid())return;
      busy=true;select.disabled=fill.disabled=create.disabled=true;
      const id=select.value,before=JSON.stringify(project.drumSamples||{});
      try{
        const entries=fill.checked?await window.AxiomStarterKit.stageSounds(missingSounds(project,id),{signal:controller.signal,onProgress:(sound,index,total)=>{status.textContent=`Loading ${sound.name} (${index+1}/${total})...`;}}):[];
        if(!valid())return;
        if(before!==JSON.stringify(project.drumSamples||{}))throw new Error('Drum sounds changed while loading. Try again.');
        const samples={...project.drumSamples};
        for(const {row,track,name} of entries)samples[row]={path:track.path,name,assetIdentity:track.assetIdentity};
        const name=presets.find(p=>p.id===id).name;
        if(!window.AxiomStudioDaw.addPattern('drums',stepsFor(id),{name,samples}))throw new Error('The pattern could not be added.');
        window.AxiomBeatPreview.rememberSamples(project,entries);window.AxiomDawDrafts?.checkpoint();
        close();window.showToast?.(`${name} added`);
      }catch(error){if(valid())status.textContent=error.message;}
      finally{busy=false;if(!closed)select.disabled=fill.disabled=create.disabled=false;}
    };
    document.body.append(dialog);render();dialog.showModal();
  }
  window.addEventListener('pagehide',()=>{closeActive?.();pendingSwitch?.abort();});
  window.AxiomDrumPresets={presets,stepsFor,patchFor,missingSounds,extendPicker,mount,open};
})();
