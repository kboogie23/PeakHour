(function(){
  'use strict';
  const sounds=Object.freeze([
    {id:'punch-kick',name:'Punch Kick',category:'Kick',row:'Kick'},
    {id:'deep-kick',name:'Deep Kick',category:'Kick',row:'Kick'},
    {id:'tight-snare',name:'Tight Snare',category:'Snare',row:'Snare'},
    {id:'hand-clap',name:'Hand Clap',category:'Clap',row:'Clap'},
    {id:'closed-hat',name:'Closed Hat',category:'Hats',row:'Hats'},
    {id:'open-hat',name:'Open Hat',category:'Hats',row:'Open Hat'},
    {id:'short-bass-c2',name:'Short Bass / C2',category:'Bass',row:'Bass'},
    {id:'sub-808-c1',name:'Sub 808 / C1',category:'808',row:'808'},
    {id:'rim-shot',name:'Rim Shot',category:'Percussion',row:'Perc'},
    {id:'wood-perc',name:'Wood Perc',category:'Percussion',row:'Perc'}
  ].map(Object.freeze));
  const kit=Object.freeze(['punch-kick','tight-snare','hand-clap','closed-hat','open-hat','short-bass-c2','sub-808-c1','rim-shot']);
  const extraRows=Object.freeze(['Clap','Open Hat','Bass','808']);
  const rows=Object.freeze(['Kick','Snare','Hats','One Shot','Vocal Chop','Perc',...extraRows]);
  const url=sound=>`/static/audio/axiom-starter-kit/${sound.id}.wav`;
  const emptySlots=p=>kit.map(id=>sounds.find(s=>s.id===id)).filter(s=>!p.drumSamples?.[s.row]?.path);
  function selectionSlots(p,ids){
    const used=new Set([...Object.keys(p.drumSamples||{}),...(p.patternClips||[]).flatMap(c=>Object.keys(c.steps||{}).filter(row=>c.steps[row]?.length))]);
    const allRows=new Set([...rows,...used,...(p.patternClips||[]).flatMap(c=>Object.keys(c.steps||{}))]);
    const selected=sounds.filter(sound=>ids.includes(sound.id));
    return selected.map(sound=>{
      let row=sound.row,index=2;
      while(used.has(row)&&index<=64)row=`${sound.row} ${index++}`;
      if(used.has(row))throw new Error('No free drum row is available.');
      allRows.add(row);if(allRows.size>64)throw new Error('This project has reached the 64 drum-row limit.');
      used.add(row);return {sound,row};
    });
  }
  async function stageSounds(selected,{signal,onProgress}={}){
    const entries=[];
    for(const [index,{sound,row}] of selected.entries()){
      signal?.throwIfAborted();onProgress?.(sound,index,selected.length);
      const response=await fetch(url(sound),{signal});if(!response.ok)throw new Error(`${sound.name} is unavailable.`);
      const file=new File([await response.blob()],`${sound.id}.wav`,{type:'audio/wav'});
      const sample=await window.AxiomBeatPreview.importSample(file,{signal});
      signal?.throwIfAborted();entries.push({row,...sample,name:sound.name});
    }
    return entries;
  }
  let closeActive=null;
  function mount(head){
    const button=document.createElement('button');button.type='button';button.className='daw-starter-kit-launch';
    button.textContent='Starter Kit';button.title='Load or preview original AXIOM drum sounds';button.onclick=()=>open();head.append(button);
  }
  function open(row='Kick'){
    const p=window.AxiomStudioDaw.activeProject;if(!p||!window.AxiomPatterns?.isDrumRow(row))return;
    closeActive?.();
    let closed=false,busy=false,context=null,source=null,previewGeneration=0;
    const controller=new AbortController(),buffers=new Map(),checked=new Set(),dialog=document.createElement('dialog');
    dialog.id='daw-starter-kit';dialog.setAttribute('aria-label','AXIOM Starter Kit');
    dialog.innerHTML='<header><h2>AXIOM Starter Kit</h2><button data-close title="Close sound picker" aria-label="Close sound picker"><img src="/static/icons/x.svg" alt=""></button></header><div class="daw-kit-filters"><label>Use on row<select data-row></select></label><label>Category<select data-category><option value="">All sounds</option></select></label><button data-file>Your File</button></div><div class="daw-kit-sounds"></div><output role="status"></output><footer><span data-count>0 selected</span><button data-fill>Fill Empty Rows</button><button data-add>Add Selected</button></footer>';
    const rowSelect=dialog.querySelector('[data-row]'),category=dialog.querySelector('[data-category]'),list=dialog.querySelector('.daw-kit-sounds'),status=dialog.querySelector('output'),fill=dialog.querySelector('[data-fill]');
    const add=dialog.querySelector('[data-add]'),count=dialog.querySelector('[data-count]');
    add.title='Add checked sounds to separate drum rows without replacing existing sounds';
    for(const name of new Set([...rows,...Object.keys(p.drumSamples||{}).filter(window.AxiomPatterns.isDrumRow),row]))rowSelect.add(new Option(name,name));rowSelect.value=row;
    for(const name of [...new Set(sounds.map(s=>s.category))])category.add(new Option(name,name));
    function stop(){previewGeneration++;if(source){try{source.stop();}catch(_){}source.disconnect();source=null;}list.querySelectorAll('[data-preview]').forEach(b=>b.setAttribute('aria-pressed','false'));}
    function close(){if(closed)return;closed=true;controller.abort();stop();context?.close().catch(()=>{});dialog.close();dialog.remove();if(closeActive===close)closeActive=null;}
    closeActive=close;
    const valid=()=>!closed&&p===window.AxiomStudioDaw.activeProject;
    function controls(){dialog.querySelectorAll('button,select,input').forEach(el=>{if(!el.matches('[data-close]'))el.disabled=busy;});fill.disabled=busy||!emptySlots(p).length;add.disabled=busy||!checked.size;count.textContent=`${checked.size} selected`;}
    async function preview(sound,button){
      const wasPlaying=button.getAttribute('aria-pressed')==='true';stop();if(wasPlaying)return;
      const generation=previewGeneration;status.textContent='Loading preview...';
      try{
        context||=new AudioContext();await context.resume();
        let buffer=buffers.get(sound.id);
        if(!buffer){const response=await fetch(url(sound),{signal:controller.signal});if(!response.ok)throw new Error('This starter sound is unavailable.');buffer=await context.decodeAudioData(await response.arrayBuffer());buffers.set(sound.id,buffer);}
        if(!valid()||generation!==previewGeneration)return;
        source=context.createBufferSource();source.buffer=buffer;
        const gain=context.createGain();gain.gain.value=.35*Number(document.getElementById('ap-volume')?.value??1);source.connect(gain).connect(context.destination);
        const playing=source;source.onended=()=>{playing.disconnect();gain.disconnect();if(source===playing){source=null;button.setAttribute('aria-pressed','false');}};
        button.setAttribute('aria-pressed','true');status.textContent=sound.name;source.start();
      }catch(error){if(valid()&&generation===previewGeneration)status.textContent=error.message;}
    }
    async function assign(selected){
      if(busy||!valid()||!selected.length)return;
      busy=true;stop();controls();
      const before=JSON.stringify(p.drumSamples||{});
      try{
        const entries=await stageSounds(selected,{signal:controller.signal,onProgress:(sound,index,total)=>{status.textContent=`Loading ${sound.name} (${index+1}/${total})...`;}});
        if(!valid())return;
        if(JSON.stringify(p.drumSamples||{})!==before)throw new Error('Drum sounds changed while loading. Nothing was replaced; try again.');
        if(!window.AxiomBeatPreview.assignSamples(p,entries))throw new Error('The sounds could not be assigned.');
        close();window.showToast?.(entries.length===1?`${entries[0].row}: ${entries[0].name}`:`${entries.length} sounds added. Existing sounds were kept.`);
      }catch(error){if(valid())status.textContent=error.message;}
      finally{busy=false;if(!closed)controls();}
    }
    function render(){
      stop();list.replaceChildren();
      for(const sound of sounds.filter(s=>!category.value||s.category===category.value)){
        const item=document.createElement('div');item.className='daw-kit-sound';
        const check=document.createElement('input');check.type='checkbox';check.checked=checked.has(sound.id);check.setAttribute('aria-label',`Select ${sound.name}`);check.onchange=()=>{if(check.checked)checked.add(sound.id);else checked.delete(sound.id);controls();};
        const play=document.createElement('button');play.dataset.preview=sound.id;play.title=`Preview ${sound.name}`;play.setAttribute('aria-label',play.title);play.setAttribute('aria-pressed','false');play.innerHTML='<img src="/static/icons/play.svg" alt="">';play.onclick=()=>preview(sound,play);
        const name=document.createElement('span');name.textContent=sound.name;
        const use=document.createElement('button');use.textContent='Use';use.setAttribute('aria-label',`Use ${sound.name}`);use.onclick=()=>assign([{sound,row:rowSelect.value}]);
        name.onclick=()=>check.click();item.append(check,play,name,use);list.append(item);
      }
      controls();
    }
    category.onchange=render;rowSelect.onchange=()=>{stop();status.textContent=p.drumSamples?.[rowSelect.value]?.name||'';};
    dialog.querySelector('[data-close]').onclick=close;
    dialog.querySelector('[data-file]').onclick=()=>{const target=rowSelect.value;close();window.AxiomBeatPreview.load(target);};
    fill.onclick=()=>assign(emptySlots(p).map(sound=>({sound,row:sound.row})));
    add.onclick=()=>{try{assign(selectionSlots(p,[...checked]));}catch(error){status.textContent=error.message;}};
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    dialog.addEventListener('close',close,{once:true});
    document.body.append(dialog);render();dialog.showModal();
  }
  window.addEventListener('pagehide',()=>closeActive?.());
  window.AxiomStarterKit={sounds,kit,rows,extraRows,url,emptySlots,selectionSlots,stageSounds,mount,open};
})();
