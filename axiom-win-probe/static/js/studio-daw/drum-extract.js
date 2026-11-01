(function(){
  'use strict';
  const rows=['Kick','Snare'];
  const daw=()=>window.AxiomStudioDaw;
  const geometry=c=>JSON.stringify([c.id,c.path,c.bpm,c.beatgrid,c.sourceStartBeat,c.sourceDurationBeats,c.timelineStartBeat,c.timelineDurationBeats]);
  function range(clip){
    const start=daw().sourceBeatToSeconds(clip,clip.sourceStartBeat),end=daw().sourceBeatToSeconds(clip,clip.sourceStartBeat+clip.sourceDurationBeats);
    if(![start,end,clip.sourceDurationBeats,clip.timelineDurationBeats,clip.timelineStartBeat].every(Number.isFinite)||start<0||end-start<.1||end-start>60||clip.sourceDurationBeats<=0||clip.timelineDurationBeats<=0||clip.timelineDurationBeats>64||clip.timelineStartBeat<0)throw new Error('Trim a clip to 16 bars or fewer, between 0.1 and 60 seconds.');
    return {start,duration:end-start};
  }
  function proposal(clip,result){
    const bounds=range(clip);
    if(result.sourcePath!==clip.path||result.start!==bounds.start||Math.abs(result.duration-bounds.duration)>1e-6||result.reviewRequired!==true||!Array.isArray(result.hits)||result.hits.length>4096)throw new Error('Analysis does not match this clip.');
    const lengthBeats=[4,8,16,32,64].find(n=>n>=clip.timelineDurationBeats),stepCount=Math.max(64,lengthBeats*4),steps={Kick:[],Snare:[]},uncertain={Kick:[],Snare:[]};
    for(const hit of result.hits){
      if(!rows.includes(hit.row)||!Number.isFinite(hit.seconds)||hit.seconds<bounds.start||hit.seconds>=bounds.start+bounds.duration)throw new Error('Invalid extracted hit.');
      const beat=(daw().sourceSecondsToBeat(clip,hit.seconds)-clip.sourceStartBeat)*clip.timelineDurationBeats/clip.sourceDurationBeats;
      const snapped=Math.round(beat*4)/4;
      if(!Number.isFinite(beat))throw new Error('Invalid source beatgrid.');
      if(snapped<0||snapped>=clip.timelineDurationBeats)continue;
      const step=1+snapped*stepCount/lengthBeats;
      if(!steps[hit.row].includes(step))steps[hit.row].push(step);
      if(hit.uncertain&&!uncertain[hit.row].includes(step))uncertain[hit.row].push(step);
    }
    return {id:crypto.randomUUID(),name:`${clip.title||clip.label||'Clip'} drums`.slice(0,100),startBeat:clip.timelineStartBeat,durationBeats:clip.timelineDurationBeats,lengthBeats,stepCount,steps,uncertain};
  }
  function merge(target,draft){
    if(!target||target.kind==='midi')throw new Error('Choose an existing drum pattern.');
    if(draft.durationBeats>target.lengthBeats)throw new Error('Double the destination pattern first; it is shorter than this clip.');
    const count=window.AxiomPatterns.stepCount(target),steps=JSON.parse(JSON.stringify(target.steps));
    for(const [row,hits] of Object.entries(draft.steps))steps[row]=[...new Set([...(steps[row]||[]),...hits.map(step=>1+(step-1)*draft.lengthBeats/draft.stepCount*count/target.lengthBeats)])].sort((a,b)=>a-b);
    const patched={...target,steps};window.AxiomPatterns.validate([patched]);return patched;
  }
  let closeActive=null;
  function mount(head,editor){
    const button=document.createElement('button');button.type='button';button.className='daw-extract-launch';
    button.innerHTML='<img src="/static/icons/audio-waveform.svg" alt="">';button.title='Extract Drum Pattern';button.setAttribute('aria-label','Extract Drum Pattern');button.onclick=()=>open();head.append(button);
    editor.ondragover=e=>{if(Array.from(e.dataTransfer?.types||[]).includes('application/x-axiom-clip')){e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='copy';}};
    editor.ondrop=e=>{let payload;try{payload=JSON.parse(e.dataTransfer.getData('application/x-axiom-clip'));}catch{return;}e.preventDefault();e.stopPropagation();open(payload.id);};
  }
  function open(id){
    const project=daw().activeProject;if(!project)return;
    closeActive?.();window.AxiomArrangement?.stop(false);window.AxiomBeatPreview?.stop();
    const clips=(project.arrangementClips||[]).filter(c=>c.path);
    if(!clips.length){window.showToast?.('Add an audio clip before extracting a drum pattern.',true);return;}
    const dialog=document.createElement('dialog');dialog.id='daw-drum-extract';dialog.setAttribute('aria-label','Extract Drum Pattern');
    dialog.innerHTML='<header><h2>Extract Drum Pattern</h2><button data-close aria-label="Close extraction" title="Close extraction"><img src="/static/icons/x.svg" alt=""></button></header><label>Clip<select data-clip aria-label="Clip"></select></label><div class="daw-extract-input"><label>Audio source<select data-source aria-label="Audio source"><option value="drums">Drum Stem (recommended)</option><option value="original">Original Clip</option></select></label><button data-stems>Create Stems</button></div><div data-rows></div><label>Destination<select data-destination aria-label="Destination"><option value="new">New Pattern</option><option value="merge">Add to Current Pattern</option></select></label><button data-analyze>Analyse Clip</button><output role="status"></output><div class="daw-extract-score" aria-label="Suggested drum hits"></div><nav data-pages hidden><button data-prev aria-label="Previous bars" title="Previous bars">&lt;</button><span></span><button data-next aria-label="Next bars" title="Next bars">&gt;</button></nav><footer><button data-preview aria-label="Preview extracted pattern" title="Preview extracted pattern"><img src="/static/icons/play.svg" alt=""></button><button data-stop aria-label="Stop extraction preview" title="Stop extraction preview"><img src="/static/icons/square.svg" alt=""></button><button data-apply>Apply Pattern</button></footer>';
    const q=s=>dialog.querySelector(s),choose=q('[data-clip]'),source=q('[data-source]'),destination=q('[data-destination]'),status=q('output'),score=q('.daw-extract-score');
    for(const clip of clips)choose.add(new Option(clip.title||clip.label||'Audio clip',clip.id));choose.value=id||daw().selectedMixerClips?.[0]?.id||clips[0].id;if(!choose.value)choose.value=clips[0].id;
    const choices={};
    for(const row of rows){
      const label=document.createElement('label');label.className='daw-extract-row';
      const check=document.createElement('input');check.type='checkbox';check.checked=true;check.setAttribute('aria-label',row);
      const name=document.createElement('span');name.textContent=row;
      const sounds=document.createElement('select');sounds.setAttribute('aria-label',`${row} sound`);
      if(project.drumSamples?.[row]?.path)sounds.add(new Option(project.drumSamples[row].name,'current'));
      for(const sound of window.AxiomStarterKit.sounds.filter(s=>s.row===row))sounds.add(new Option(sound.name,sound.id));
      label.append(check,name,sounds);q('[data-rows]').append(label);choices[row]={check,sounds};
    }
    let closed=false,busy=false,draft=null,page=0,controller=null,context=null,timer=null,revision='',sampleRevision='',target=null,targetRevision='';
    const prepared=new Map();
    const clip=()=>clips.find(c=>c.id===choose.value);
    const valid=()=>!closed&&project===daw().activeProject&&project.arrangementClips.includes(clip());
    function fresh(){if(!valid()||geometry(clip())!==revision||JSON.stringify(project.drumSamples||{})!==sampleRevision)throw new Error('The clip or drum sounds changed. Analyse again.');}
    function stop(){clearTimeout(timer);timer=null;context?.close().catch(()=>{});context=null;q('[data-preview]').setAttribute('aria-pressed','false');}
    function close(){if(closed)return;closed=true;controller?.abort();stop();dialog.close();dialog.remove();if(closeActive===close)closeActive=null;}
    function controls(){
      dialog.querySelectorAll('input,select,button').forEach(el=>el.disabled=busy&&!el.matches('[data-close],[data-stop]'));
      q('[data-stems]').disabled=busy||clip()?.stemState==='processing';
      const empty=!draft||!rows.some(row=>choices[row].check.checked&&draft.steps[row].length);
      q('[data-apply]').disabled=q('[data-preview]').disabled=busy||empty;
      q('[data-prev]').disabled=busy||page===0;q('[data-next]').disabled=busy||!draft||(page+1)*64>=draft.stepCount;
      destination.querySelector('[value="merge"]').disabled=!target||target.kind==='midi';
    }
    function reset(){
      controller?.abort();stop();draft=null;score.replaceChildren();q('[data-pages]').hidden=true;
      source.value=clip()?.stemState==='ready'?'drums':'original';
      target=window.AxiomPatterns.active(project);targetRevision=JSON.stringify(target);
      status.textContent=source.value==='drums'?'Drum stem available.':'Original clip selected. Drum stems usually give cleaner suggestions.';controls();
    }
    function render(){
      score.replaceChildren();if(!draft)return;
      for(const row of rows){
        const label=document.createElement('strong');label.textContent=row;score.append(label);
        for(let i=0;i<64;i++){
          const step=page*64+i+1,cell=document.createElement('button');cell.type='button';
          const hit=draft.steps[row].includes(step),uncertain=draft.uncertain[row].includes(step);
          cell.className='daw-extract-cell';cell.dataset.uncertain=String(hit&&uncertain);cell.setAttribute('aria-pressed',String(hit));cell.setAttribute('aria-label',`${row} extracted step ${step}`);
          cell.title=`${row}, beat ${1+(step-1)*draft.lengthBeats/draft.stepCount}${hit&&uncertain?' (uncertain)':''}`;
          cell.disabled=busy||!choices[row].check.checked||(step-1)*draft.lengthBeats/draft.stepCount>=draft.durationBeats;
          cell.onclick=()=>{stop();draft.steps[row]=hit?draft.steps[row].filter(n=>n!==step):[...draft.steps[row],step].sort((a,b)=>a-b);draft.uncertain[row]=draft.uncertain[row].filter(n=>n!==step);render();controls();};score.append(cell);
        }
      }
      q('[data-pages]').hidden=false;const first=page*64*draft.lengthBeats/draft.stepCount/4+1,last=Math.min(draft.lengthBeats/4,(page+1)*64*draft.lengthBeats/draft.stepCount/4);q('[data-pages] span').textContent=`Bars ${first}-${last}`;
    }
    function selectedDraft(){const copy=JSON.parse(JSON.stringify(draft));delete copy.uncertain;for(const row of rows)if(!choices[row].check.checked)delete copy.steps[row];return copy;}
    async function samples(){
      const selected=rows.filter(row=>choices[row].check.checked),entries=[];
      for(const row of selected){
        const key=choices[row].sounds.value;if(key==='current')continue;
        if(!prepared.has(key)){const sound=window.AxiomStarterKit.sounds.find(s=>s.id===key);const [entry]=await window.AxiomStarterKit.stageSounds([{row,sound}],{signal:controller.signal});prepared.set(key,entry);}
        entries.push(prepared.get(key));
      }
      const bank={...project.drumSamples};for(const {row,track,name} of entries)bank[row]={path:track.path,name,assetIdentity:track.assetIdentity};return {bank,entries};
    }
    async function action(run){if(busy||!valid())return;busy=true;controller=new AbortController();controls();try{await run();}catch(error){if(!closed)status.textContent=error.message;}finally{busy=false;if(!closed){render();controls();}}}
    choose.onchange=reset;source.onchange=()=>{stop();draft=null;score.replaceChildren();q('[data-pages]').hidden=true;status.textContent='';controls();};destination.onchange=stop;
    for(const {check,sounds} of Object.values(choices)){check.onchange=()=>{stop();render();controls();};sounds.onchange=stop;}
    q('[data-close]').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.addEventListener('close',close,{once:true});closeActive=close;
    q('[data-stems]').onclick=()=>action(async()=>{
      const selected=clip();status.textContent='Creating stems...';
      await window.AxiomStems.request(selected,{project,current:()=>!closed&&project===daw().activeProject});
      if(!valid())return;reset();if(selected.stemState!=='ready')status.textContent='Stems are unavailable. Retry Create Stems or analyse the original clip.';
    });
    q('[data-analyze]').onclick=()=>action(async()=>{
      stop();draft=null;score.replaceChildren();const selected=clip(),bounds=range(selected);revision=geometry(selected);sampleRevision=JSON.stringify(project.drumSamples||{});
      target=window.AxiomPatterns.active(project);targetRevision=JSON.stringify(target);
      if(source.value==='drums'&&selected.stemState!=='ready')throw new Error('Create Stems first, or choose Original Clip.');
      status.textContent='Analysing selected audio...';window.AxiomArrangement?.stop(false);window.AxiomBeatPreview?.stop();
      const response=await fetch('/api/studio-daw/drum-pattern',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({path:selected.path,...bounds,source:source.value,...(source.value==='drums'?{stemJob:selected.stemJob}:{})})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Drum analysis unavailable.');fresh();
      draft=proposal(selected,result);page=0;render();
      const count=rows.reduce((n,row)=>n+draft.steps[row].length,0),uncertain=rows.reduce((n,row)=>n+draft.uncertain[row].length,0);
      status.textContent=count?`${count} suggested hits; ${uncertain} uncertain. Review before applying.`:'No clear kick or snare hits found. Try a drum stem or another section.';
    });
    q('[data-prev]').onclick=()=>{page--;render();controls();};q('[data-next]').onclick=()=>{page++;render();controls();};q('[data-stop]').onclick=stop;
    q('[data-preview]').onclick=()=>action(async()=>{
      stop();fresh();const audio=context=new AudioContext();await audio.resume();
      const {bank,entries}=await samples();fresh();if(context!==audio)return;
      const scratch={...project,patternClips:[selectedDraft()],drumSamples:Object.fromEntries(rows.filter(row=>choices[row].check.checked).map(row=>[row,bank[row]]))};
      window.AxiomBeatPreview.rememberSamples(scratch,entries);await window.AxiomBeatPreview.prepare(scratch);fresh();if(context!==audio)return;
      const clock=daw().compileTempoMap(scratch),from=clock.beatToSeconds(draft.startBeat),end=clock.beatToSeconds(draft.startBeat+draft.durationBeats);
      window.AxiomBeatPreview.scheduleArrangement(audio,audio.destination,scratch,audio.currentTime+.06-from,from,end,node=>node);
      q('[data-preview]').setAttribute('aria-pressed','true');timer=setTimeout(stop,(end-from+1)*1000);
    });
    q('[data-apply]').onclick=()=>action(async()=>{
      stop();fresh();const candidate=selectedDraft();
      if(destination.value==='merge'&&JSON.stringify(window.AxiomPatterns.active(project))!==targetRevision)throw new Error('The destination pattern changed. Analyse again.');
      const next=destination.value==='merge'?merge(target,candidate):candidate,{bank,entries}=await samples();fresh();
      if(destination.value==='merge'&&JSON.stringify(window.AxiomPatterns.active(project))!==targetRevision)throw new Error('The destination pattern changed. Analyse again.');
      const ok=destination.value==='merge'?daw().editPattern(target.id,'apply',next,{samples:bank}):daw().importPattern(next,{samples:bank});
      if(!ok)throw new Error('Pattern could not be applied. No existing hits were replaced.');
      window.AxiomBeatPreview.rememberSamples(project,entries);daw().selectPattern(next.id);window.AxiomDawDrafts?.checkpoint();close();
    });
    document.body.append(dialog);reset();dialog.showModal();
  }
  window.addEventListener('pagehide',()=>closeActive?.());
  window.AxiomDrumExtract={range,proposal,merge,mount,open};
})();
