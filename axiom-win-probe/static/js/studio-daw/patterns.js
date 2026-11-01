(function(){
  'use strict';
  const defaults={Kick:[1,17,33,49],Snare:[17,49],Hats:Array.from({length:32},(_,i)=>i*2+1),'One Shot':[45],'Vocal Chop':[25,57],Perc:[9,29,41,61],Clap:[],'Open Hat':[],Bass:[],'808':[]};
  function isDrumRow(row){
    if(typeof row!=='string')return false;
    if(Object.hasOwn(defaults,row))return true;
    const match=/^(.+) ([2-9]|[1-5][0-9]|6[0-4])$/.exec(row);
    return Boolean(match&&Object.hasOwn(defaults,match[1]));
  }
  const selected=new WeakMap();
  const clipboards=new WeakMap();
  const pages=new WeakMap();
  const stepCount=c=>c.stepCount??64;
  function validateRowOrder(order){
    if(!Array.isArray(order)||order.length>64||new Set(order).size!==order.length||order.some(row=>!isDrumRow(row)))throw new Error('Invalid drum row order.');
    return order;
  }
  function orderedRows(rows,order=[]){
    validateRowOrder(order);
    const rank=new Map(order.map((row,i)=>[row,i]));
    return [...rows].sort((a,b)=>(rank.get(a.label)??order.length)-(rank.get(b.label)??order.length));
  }
  function movedRows(order,row,target){
    validateRowOrder(order);
    const from=order.indexOf(row),to=order.indexOf(target),copy=[...order];
    if(from<0||to<0||from===to)return copy;
    copy.splice(from,1);copy.splice(to,0,row);return copy;
  }
  function mountRowOrder(grid,p,order){
    let dragging=null;
    function move(row,target){
      if(window.AxiomStudioDaw.activeProject!==p)return;
      window.AxiomStudioDaw.setDrumRowOrder(movedRows(order,row,target));
      window.AxiomDawDrafts?.checkpoint();
      const handle=[...document.querySelectorAll('[data-drum-reorder]')].find(el=>el.dataset.drumReorder===row);
      handle?.focus({preventScroll:true});
    }
    for(const label of [...grid.querySelectorAll('.daw-load-sample')]){
      const row=label.dataset.sampleRow,wrap=document.createElement('div'),handle=document.createElement('button');
      wrap.className='daw-drum-row-heading';wrap.dataset.drumRow=row;
      handle.type='button';handle.draggable=true;handle.dataset.drumReorder=row;handle.className='daw-drum-reorder';
      handle.innerHTML='<img src="/static/icons/grip-vertical.svg" alt="">';handle.setAttribute('aria-label',`Reorder ${row}`);
      handle.title=`Drag ${row} to reorder, or use Up and Down arrows when focused`;
      handle.onkeydown=e=>{
        if(!['ArrowUp','ArrowDown'].includes(e.key))return;
        e.preventDefault();e.stopPropagation();const target=order[order.indexOf(row)+(e.key==='ArrowUp'?-1:1)];if(target)move(row,target);
      };
      handle.ondragstart=e=>{dragging=row;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',row);};
      handle.ondragend=()=>{dragging=null;grid.querySelectorAll('.daw-drum-drop-target').forEach(el=>el.classList.remove('daw-drum-drop-target'));};
      wrap.ondragover=e=>{if(!dragging)return;e.preventDefault();e.dataTransfer.dropEffect='move';wrap.classList.add('daw-drum-drop-target');};
      wrap.ondragleave=()=>wrap.classList.remove('daw-drum-drop-target');
      wrap.ondrop=e=>{if(!dragging)return;e.preventDefault();e.stopPropagation();const from=dragging;dragging=null;move(from,row);};
      label.replaceWith(wrap);wrap.append(handle,label);
    }
  }
  function page(p,c,next){
    if(!pages.has(p))pages.set(p,new Map());
    const state=pages.get(p),max=Math.ceil(stepCount(c)/64)-1;
    const value=Math.max(0,Math.min(max,next??state.get(c.id)??0));state.set(c.id,value);return value;
  }
  function doubled(c){
    validate([c]);
    if(c.lengthBeats>128||(c.kind!=='midi'&&stepCount(c)>512))throw new Error('Pattern is at its maximum length.');
    const copy=JSON.parse(JSON.stringify(c));
    copy.lengthBeats=c.lengthBeats*2;copy.durationBeats=Math.max(c.durationBeats,copy.lengthBeats);
    if(c.kind==='midi'){
      copy.notes.push(...c.notes.map(n=>({...n,id:crypto.randomUUID(),beat:n.beat+c.lengthBeats})));
      if(c.midiControls?.length){
        // The copied phrase starts with the same controller defaults as bar one.
        const resets=new Map();
        for(const point of c.midiControls)resets.set(`${point.channel}:${point.kind}`,{beat:c.lengthBeats,channel:point.channel,kind:point.kind,value:point.kind==='pitch'?0:1});
        copy.midiControls=[...copy.midiControls,...resets.values(),...c.midiControls.map(point=>({...point,beat:point.beat+c.lengthBeats}))].sort((a,b)=>a.beat-b.beat);
      }
    }
    else {
      copy.stepCount=stepCount(c)*2;
      copy.steps=Object.fromEntries(Object.entries(c.steps).map(([row,steps])=>[row,[...steps,...steps.map(n=>n+stepCount(c))]]));
    }
    validate([copy]);return copy;
  }
  function mountActions(host,p,c){
    if(!c)return;
    const actions=document.createElement('div');actions.className='daw-pattern-actions';
    for(const [label,title,run] of [
      ['Double Pattern','Copy the pattern into a new second half without changing beat timing',()=>{
        try{const next=doubled(c);if(c.kind!=='midi')page(p,next,stepCount(c)/64);window.AxiomStudioDaw.editPattern(c.id,'apply',next);}
        catch(error){window.showToast?.(error.message,true);}
      }],
      ['Duplicate Clip','Place an independent copy immediately after this timeline clip',()=>window.AxiomStudioDaw.editPattern(c.id,'duplicate')]
    ]){
      const button=document.createElement('button');button.type='button';button.textContent=label;button.title=title;button.onclick=run;
      if(label==='Double Pattern')button.disabled=c.lengthBeats>128||(c.kind!=='midi'&&stepCount(c)>512);
      actions.append(button);
    }
    host.append(actions);
  }
  function list(p){
    if(p.patternClips)return p.patternClips;
    const end=Math.max(4,...(p.arrangementClips||[]).map(c=>c.timelineStartBeat+c.timelineDurationBeats));
    return [{id:'legacy-pattern',name:'Drums 01',startBeat:0,durationBeats:end,lengthBeats:4,steps:{...defaults,...p.stepPattern}}];
  }
  function active(p){return list(p).find(c=>c.id===selected.get(p))||list(p)[0];}
  function validate(clips){
    if(!Array.isArray(clips)||clips.length>10000)throw new Error('Invalid pattern clips.');
    const ids=new Set();
    for(const c of clips){
      if(!c||typeof c.id!=='string'||!/^[-\w]+$/.test(c.id)||ids.has(c.id)||typeof c.name!=='string'||c.name.length>100||!Number.isFinite(c.startBeat)||c.startBeat<0||!Number.isFinite(c.durationBeats)||c.durationBeats<=0||!(c.kind==='midi'?Number.isInteger(c.lengthBeats)&&c.lengthBeats>=4&&c.lengthBeats<=256&&c.lengthBeats%4===0:[4,8,16,32,64,128,256].includes(c.lengthBeats))||!c.steps||typeof c.steps!=='object')throw new Error('Invalid pattern clip.');
      if(![64,128,256,512,1024].includes(stepCount(c)))throw new Error('Invalid pattern resolution.');
      ids.add(c.id);
      if(c.kind==='midi'){
        if(!window.AxiomInstruments)throw new Error('Instrument engine unavailable.');
        window.AxiomInstruments.validate(c);
      }
      if(!Number.isFinite(c.startBeat+c.durationBeats))throw new Error('Pattern range is too large.');
      if(c.offsetBeats!==undefined&&!Number.isFinite(c.offsetBeats))throw new Error('Invalid pattern offset.');
      for(const key of ['swing','velocity','probability'])if(c[key]!==undefined&&(!Number.isFinite(c[key])||c[key]<0||c[key]>1))throw new Error('Invalid pattern dynamics.');
      if(Object.keys(c.steps).length>64)throw new Error('Too many drum rows.');
      for(const [row,steps] of Object.entries(c.steps))if(!isDrumRow(row)||!Array.isArray(steps)||steps.some(n=>!Number.isInteger(n)||n<1||n>stepCount(c)))throw new Error('Invalid pattern steps.');
    }
    return clips;
  }
  function stepHit(clip,row,index){
    const count=stepCount(clip);
    if(!(clip.steps[row]||[]).includes((index%count+count)%count+1))return null;
    let seed=2166136261;for(const char of `${clip.id}:${row}:${index}`)seed=Math.imul(seed^char.charCodeAt(0),16777619);
    if((seed>>>0)/4294967296>=(clip.probability??1))return null;
    return {delay:(index%2+2)%2*(clip.swing||0)*clip.lengthBeats/(count*2),velocity:clip.velocity??1};
  }
  function hits(p,from,to){
    if(!Number.isFinite(from)||!Number.isFinite(to)||to<from)throw new Error('Invalid pattern playback range.');
    validate(list(p));const result=[];
    for(const clip of list(p)){
      if(clip.muted||clip.kind==='midi')continue;
      const step=clip.lengthBeats/stepCount(clip),end=Math.min(to,clip.startBeat+clip.durationBeats);
      const origin=clip.startBeat-(clip.offsetBeats||0);
      if(!Number.isSafeInteger(Math.floor((Math.max(from,clip.startBeat)-origin)/step)))throw new Error('Pattern scheduling limit exceeded.');
      if((end-Math.max(from,clip.startBeat))/step>500000)throw new Error('Pattern scheduling limit exceeded.');
      for(let i=Math.floor((Math.max(from,clip.startBeat)-origin)/step);origin+i*step<end-1e-8;i++){
        for(const row of Object.keys(clip.steps)){
          const hit=stepHit(clip,row,i),beat=origin+i*step+(hit?.delay||0);
          if(hit&&beat>=Math.max(from,clip.startBeat)-1e-8&&beat<end-1e-8)result.push({row,beat,clipId:clip.id,velocity:hit.velocity});
        }
        if(result.length>500000)throw new Error('Pattern scheduling limit exceeded.');
      }
    }
    return result.sort((a,b)=>a.beat-b.beat);
  }
  function select(p,id){selected.set(p,id);}
  function keyboard(p,event){
    const key=String(event.key).toLowerCase(),cmd=event.metaKey||event.ctrlKey,c=active(p);
    if(event.altKey||event.shiftKey||event.target?.closest?.('dialog, [role="dialog"]'))return false;
    if(cmd&&['c','x'].includes(key)&&c){clipboards.set(p,JSON.parse(JSON.stringify(c)));if(key==='x')window.AxiomStudioDaw.editPattern(c.id,'delete');return true;}
    if(cmd&&key==='v'){const clip=clipboards.get(p);if(clip)window.AxiomStudioDaw.editPattern('','paste',JSON.parse(JSON.stringify(clip)));return true;}
    if(cmd&&key==='d'&&c){window.AxiomStudioDaw.editPattern(c.id,'duplicate');return true;}
    if(!cmd&&['delete','backspace'].includes(key)&&c){window.AxiomStudioDaw.editPattern(c.id,'delete');return true;}
    return false;
  }
  function resized(c,edge,beat){
    const end=c.startBeat+c.durationBeats;
    if(edge==='left'){const start=Math.max(0,Math.min(end-.0625,beat));return {startBeat:start,durationBeats:end-start,offsetBeats:(c.offsetBeats||0)+start-c.startBeat};}
    if(edge==='right')return {startBeat:c.startBeat,durationBeats:Math.max(.0625,beat-c.startBeat)};
    return {startBeat:Math.max(0,beat),durationBeats:c.durationBeats};
  }
  function drag(event,id,edge='move'){
    if(event.button!==0)return;event.preventDefault();event.stopPropagation();
    const p=window.AxiomStudioDaw.activeProject,c=list(p).find(c=>c.id===id),article=event.currentTarget.closest('.daw-pattern-clip'),body=article?.closest('.studio-daw-lane-body'),lanes=document.getElementById('studio-daw-lanes');
    if(!c||!body||!lanes)return;
    const rect=body.getBoundingClientRect(),span=Number(lanes.dataset.viewBeats),start=Number(lanes.dataset.viewStart||0),style=article.getAttribute('style'),before=JSON.stringify(c);
    let next=null;
    const move=e=>{if(Math.abs(e.clientX-event.clientX)<3)return;
      const origin=edge==='right'?c.startBeat+c.durationBeats:c.startBeat,beat=window.AxiomStudioDaw.snapBeat(origin+(e.clientX-event.clientX)/rect.width*span,e);
      next=resized(c,edge,beat);article.style.left=`${(next.startBeat-start)/span*100}%`;article.style.width=`${next.durationBeats/span*100}%`;
    };
    const escape=e=>{if(e.key==='Escape'){e.preventDefault();clean();}};
    const clean=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',end);document.removeEventListener('pointercancel',cancel);document.removeEventListener('keydown',escape);article.setAttribute('style',style);};
    const cancel=()=>clean();
    const end=e=>{move(e);clean();if(p!==window.AxiomStudioDaw.activeProject||JSON.stringify(list(p).find(c=>c.id===id))!==before)return;
      if(next)window.AxiomStudioDaw.editPattern(id,'apply',next);window.AxiomStudioDaw.selectPattern(id);
    };
    document.addEventListener('pointermove',move);document.addEventListener('pointerup',end);document.addEventListener('pointercancel',cancel);document.addEventListener('keydown',escape);
  }
  function edit(id){
    const p=window.AxiomStudioDaw.activeProject,c=list(p).find(c=>c.id===id);if(!c)return;
    const dialog=document.createElement('dialog');dialog.setAttribute('aria-label','Pattern Clip');dialog.style.cssText='background:#191c19;color:#eee;border:1px solid #525852;padding:20px;width:340px;max-width:90vw';
    const form=document.createElement('form');const fields={};
    for(const [key,label,value] of [['name','Name',c.name],['startBeat','Start bar',c.startBeat/4+1],['durationBeats','Duration bars',c.durationBeats/4],['lengthBeats','Pattern bars',c.lengthBeats/4]]){
      const wrapper=document.createElement('label');wrapper.textContent=label;
      const input=document.createElement(key==='lengthBeats'&&c.kind!=='midi'?'select':'input');input.setAttribute('aria-label',label);
      if(key==='lengthBeats'&&c.kind!=='midi')for(const n of [...new Set([1,2,4,c.lengthBeats/4])]){const option=document.createElement('option');option.value=n;option.textContent=n;input.append(option);}
      else if(key!=='name'){input.type='number';input.min=key==='startBeat'?'1':'.0625';input.step='.0625';}else input.maxLength=100;
      input.value=value;input.required=true;input.style.cssText='display:block;width:100%;box-sizing:border-box;margin:6px 0 12px;background:#252925;color:#eee;padding:5px';fields[key]=input;wrapper.append(input);form.append(wrapper);
      if(key==='lengthBeats'&&c.kind==='midi'){input.min='1';input.max='64';input.step='1';}
      if(key==='lengthBeats'&&c.kind!=='midi'&&stepCount(c)>64){input.disabled=true;input.title='Use Double Pattern to extend; trim the timeline clip to shorten playback.';}
    }
    if(c.kind==='midi'){
      const label=document.createElement('label');label.textContent='Original key';
      const select=document.createElement('select');select.setAttribute('aria-label','Original key');select.add(new Option('Not set',''));
      for(const mode of ['A','B'])for(let n=1;n<=12;n++)select.add(new Option(n+mode,n+mode));
      select.value=c.sourceKey||'';select.style.cssText='display:block;width:100%;margin:6px 0 12px;background:#252925;color:#eee;padding:5px';
      fields.sourceKey=select;label.append(select);form.append(label);
      for(const [key,text] of [['syncKey','Sync to anchor key'],['playInKey','Play in Key']]){
        const row=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=Boolean(c[key]);input.setAttribute('aria-label',text);
        row.style.cssText='display:flex;align-items:center;gap:8px;margin:10px 0';row.append(input,document.createTextNode(text));fields[key]=input;form.append(row);
      }
    }
    const status=document.createElement('p');status.setAttribute('role','alert');form.append(status);
    for(const action of ['Apply','Duplicate','Delete','Cancel']){const button=document.createElement('button');button.type='button';button.textContent=action;button.style.cssText='margin:4px;padding:5px;background:#252925;color:#eee';button.onclick=()=>{
      if(action==='Cancel'){dialog.remove();return;}
      if(p!==window.AxiomStudioDaw.activeProject){status.textContent='The project changed.';return;}
      const patch={name:fields.name.value,startBeat:(Number(fields.startBeat.value)-1)*4,durationBeats:Number(fields.durationBeats.value)*4,lengthBeats:Number(fields.lengthBeats.value)*4};
      if(c.kind==='midi'&&action==='Apply'){
        Object.assign(patch,{sourceKey:fields.sourceKey.value,syncKey:fields.syncKey.checked,playInKey:fields.playInKey.checked});
        try{window.AxiomInstruments.validate({...c,...patch});for(const n of c.notes.length?c.notes:[{midi:60}])window.AxiomInstruments.notePitch(p,{...c,...patch},n.midi,patch.startBeat);}
        catch(error){status.textContent=error.message;return;}
      }
      if(window.AxiomStudioDaw.editPattern(id,action.toLowerCase(),patch))dialog.remove();else status.textContent='Check the pattern position and length.';
    };form.append(button);}
    if(window.AxiomMidiImport){const button=document.createElement('button');button.type='button';button.textContent='Import MIDI notes';button.onclick=()=>{dialog.remove();window.AxiomMidiImport.open();};form.append(button);}
    form.onsubmit=e=>e.preventDefault();dialog.append(form);document.body.append(dialog);dialog.showModal();
  }
  window.AxiomPatterns={list,active,validate,hits,stepHit,resized,drag,keyboard,select,edit,defaults,stepCount,page,doubled,mountActions,isDrumRow,validateRowOrder,orderedRows,movedRows,mountRowOrder};
})();
