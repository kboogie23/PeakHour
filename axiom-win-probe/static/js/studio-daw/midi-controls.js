(function(){
  'use strict';
  const copy=v=>JSON.parse(JSON.stringify(v)),histories=new WeakMap();
  let session=null,enumerated=null,connecting=false,version=0,dialog=null,learnTarget=null,gesture=null,flushTimer,ticker;
  const pickups=new Map();
  function message(data){
    if(!data||data.length!==3||!Array.from(data).every(Number.isInteger)||data[1]<0||data[1]>127||data[2]<0||data[2]>127)return null;
    if(data[0]>=0xb0&&data[0]<=0xbf&&data[1]<120)return {kind:'cc',channel:data[0]&15,controller:data[1],value:data[2]/127};
    if(data[0]>=0xe0&&data[0]<=0xef)return {kind:'pitch',channel:data[0]&15,controller:0,value:(data[1]+128*data[2])/16383};
    return null;
  }
  const sourceKey=s=>`${s.kind}:${s.channel}:${s.controller}`;
  function normalize(m){
    const s=m?.source,t=m?.target;
    if(!s||!['cc','pitch'].includes(s.kind)||!Number.isInteger(s.channel)||s.channel<0||s.channel>15||!Number.isInteger(s.controller)||s.controller<0||s.controller>(s.kind==='pitch'?0:119))throw new Error('Invalid MIDI control source.');
    window.AxiomDawAutomation.normalize({...t,points:[]});
    return {source:{kind:s.kind,channel:s.channel,controller:s.controller},target:{scope:t.scope,targetId:t.targetId||'',parameter:t.parameter},invert:m.invert===true};
  }
  function validateProject(p){
    const list=p.midiMappings||[];if(!Array.isArray(list)||list.length>128)throw new Error('A project supports up to 128 MIDI control mappings.');
    const seen=new Set();for(const raw of list){const key=sourceKey(normalize(raw).source);if(seen.has(key))throw new Error('A MIDI control is assigned more than once.');seen.add(key);}
  }
  function target(p,t,create=false){
    if(t.scope==='project'){if(create)p.masterMixer||={};return p.masterMixer;}
    if(t.scope==='deck'){if(create){p.rowMixer||={};p.rowMixer[t.targetId]||={};}return p.rowMixer?.[t.targetId];}
    return (t.scope==='clip'?p.arrangementClips:p.fxRegions)?.find(c=>c.id===t.targetId);
  }
  const parameter=t=>t.scope==='clip'&&!t.parameter.startsWith('stemGain_')?'mix'+t.parameter[0].toUpperCase()+t.parameter.slice(1):t.parameter;
  const field=(object,key)=>JSON.stringify({exists:Object.hasOwn(object,key),value:object[key]});
  function history(p){if(!histories.has(p))histories.set(p,{undo:[],redo:[]});return histories.get(p);}
  function record(p,entry){const h=history(p);h.undo.push(entry);if(h.undo.length>100)h.undo.shift();h.redo=[];window.AxiomEditHistory?.record(p,'midi-controls');}
  function flush(){clearTimeout(flushTimer);if(!gesture)return;const g=gesture;gesture=null;const changes=g.changes.filter(c=>c.before!==c.after);if(changes.length)record(g.p,{changes});}
  function notify(){window.AxiomArrangement?.mixerChanged(window.AxiomStudioDaw.activeProject);window.AxiomMixer?.refresh();}
  function undo(p,redo=false){
    flush();const h=history(p),from=redo?h.redo:h.undo,to=redo?h.undo:h.redo,entry=from.at(-1);if(!entry)return false;
    const expected=redo?'before':'after',desired=redo?'after':'before';
    if(entry.changes){
      if(entry.changes.some(c=>{const object=target(p,c.target);return !object||field(object,c.key)!==c[expected];}))return false;
      for(const c of entry.changes){const object=target(p,c.target),state=JSON.parse(c[desired]);if(state.exists)object[c.key]=state.value;else delete object[c.key];}
    }else{if(JSON.stringify(p.midiMappings||[])!==entry[expected])return false;p.midiMappings=JSON.parse(entry[desired]);}
    from.pop();to.push(entry);pickups.clear();notify();renderMappings();return true;
  }
  function assign(p,mapping){
    flush();const m=normalize(mapping),before=JSON.stringify(p.midiMappings||[]),next=(p.midiMappings||[]).filter(item=>sourceKey(item.source)!==sourceKey(m.source));next.push(m);
    validateProject({...p,midiMappings:next});p.midiMappings=next;const after=JSON.stringify(next);if(before!==after)record(p,{before,after});pickups.clear();renderMappings();return m;
  }
  function remove(p,key){flush();const before=JSON.stringify(p.midiMappings||[]);p.midiMappings=(p.midiMappings||[]).filter(m=>sourceKey(m.source)!==key);const after=JSON.stringify(p.midiMappings);if(before!==after)record(p,{before,after});pickups.delete(key);renderMappings();}
  function apply(p,raw,event){
    if(!event||!Number.isFinite(event.value)||event.value<0||event.value>1)throw new Error('Invalid MIDI controller value.');
    if(window.AxiomArrangement?.rendering)return 'Export active';
    const m=normalize(raw),t=m.target,key=sourceKey(m.source);if(sourceKey(event)!==key)return 'unmapped';
    const recorder=window.AxiomAutomationRecorder,writing=recorder?.ready(p);
    if(!writing&&p.automationLanes?.some(l=>l.scope===t.scope&&(l.targetId||'')===t.targetId&&l.parameter===t.parameter&&l.enabled!==false&&l.points?.length))return 'Automation active';
    const object=target(p,t,true);if(!object)return 'Target unavailable';
    if(window.AxiomDawAutomation.available&&!window.AxiomDawAutomation.available(p,t))return 'Parameter unavailable';
    if(window.AxiomDawAutomation.recordable&&!window.AxiomDawAutomation.recordable(p,t))return 'Choose Fixed cutoff in the FX editor';
    if(t.parameter.startsWith('stemGain_')&&(object.stemState!=='ready'||!object.stemJob))return 'Stems unavailable';
    const prop=parameter(t),[,min,max,fallback]=window.AxiomDawAutomation.definitions[t.parameter],current=writing?recorder.current(p,t):object[prop]??fallback,at=(current-min)/(max-min),value=m.invert?1-event.value:event.value;
    let pickup=pickups.get(key);if(!pickup||pickup.writing!==Boolean(writing)||pickup.lastApplied!==undefined&&Math.abs(pickup.lastApplied-current)>1e-8)pickup={previous:value,engaged:false,writing:Boolean(writing)};
    if(!pickup.engaged&&(Math.abs(value-at)<=1/127||(pickup.previous-at)*(value-at)<=0))pickup.engaged=true;
    pickup.previous=value;pickups.set(key,pickup);if(!pickup.engaged)return 'Pickup';
    const next=min+value*(max-min);
    if(writing){if(!recorder.write(p,t,next,event.timeStamp))return 'Outside target';pickup.lastApplied=next;return 'Recording automation';}
    if(current===next)return 'Ready';
    if(gesture&&gesture.p!==p)flush();gesture||={p,changes:[]};
    const before=field(object,prop);object[prop]=next;const after=field(object,prop),id=JSON.stringify(t),prior=gesture.changes.find(c=>c.id===id);
    if(prior)prior.after=after;else gesture.changes.push({id,target:t,key:prop,before,after});
    pickup.lastApplied=next;clearTimeout(flushTimer);flushTimer=setTimeout(flush,300);notify();return `${next.toFixed(3)}`;
  }
  function status(text){if(dialog)dialog.querySelector('[role="status"]').textContent=text;}
  function buttonState(){const b=document.getElementById('daw-midi-controls-button');if(b)b.setAttribute('aria-pressed',String(Boolean(session)));}
  async function disconnect(reason='Disconnected'){
    window.AxiomAutomationRecorder?.finish();
    version++;connecting=false;learnTarget=null;flush();pickups.clear();clearInterval(ticker);
    const old=session||enumerated;session=null;enumerated=null;buttonState();
    if(old){old.port?.removeEventListener('midimessage',receive);old.access.removeEventListener('statechange',devices);await old.port?.close().catch(()=>{});await old.access.close?.();}
    status(reason);controlsState();
  }
  function devices(){const active=session||enumerated;if(active&&(active.access.error||active.port?.state==='disconnected'))disconnect(active.access.error||'MIDI input disconnected. Reconnect explicitly.');}
  function watch(){clearInterval(ticker);ticker=setInterval(()=>{const active=session||enumerated;if(active&&(active.p!==window.AxiomStudioDaw.activeProject||document.getElementById('studio-daw-shell')?.classList.contains('hidden')))disconnect('Project changed. Reconnect controls for this project.');},250);}
  function receive(event){
    if(!session||session.p!==window.AxiomStudioDaw.activeProject)return;
    const data=message(event.data);if(!data)return;
    try{
      if(learnTarget){assign(session.p,{source:data,target:learnTarget.target,invert:learnTarget.invert});learnTarget=null;status('Mapping saved');controlsState();return;}
      const mapping=session.p.midiMappings?.find(m=>sourceKey(m.source)===sourceKey(data));if(mapping)status(apply(session.p,mapping,{...data,timeStamp:event.timeStamp}));
    }catch(error){status(error.message);learnTarget=null;}
  }
  async function connect(){
    if(session){await disconnect();return;}
    if(connecting)return;
    if(window.AxiomMidiInput?.busy){status('Finish MIDI recording before connecting controls.');return;}
    if(enumerated&&enumerated.p!==window.AxiomStudioDaw.activeProject){await disconnect('Project changed. Connect controls for the current project.');return;}
    const p=window.AxiomStudioDaw.activeProject,current=++version;connecting=true;controlsState();let access,port;
    try{
      const request=typeof navigator.requestMIDIAccess==='function'?()=>navigator.requestMIDIAccess({sysex:false}):window.AxiomNativeMidi?.available()?()=>window.AxiomNativeMidi.requestAccess():null;
      if(!request)throw new Error('MIDI controls are unavailable in this browser.');
      access=enumerated?.p===p?enumerated.access:await request();if(current!==version||p!==window.AxiomStudioDaw.activeProject){await access.close?.();return;}
      const list=[...access.inputs.values()].filter(port=>port.state==='connected'),input=dialog.querySelector('[data-midi-port]'),selected=input.value;
      input.replaceChildren(...list.map(port=>new Option(port.name||'MIDI input',port.id)));
      if(list.some(port=>port.id===selected))input.value=selected;
      // Enumeration and opening are separate explicit actions when inputs are first discovered.
      if(!selected||!list.some(port=>port.id===selected)){enumerated={p,access};access.addEventListener('statechange',devices);watch();status(list.length?'Choose an input, then connect.':'No MIDI input connected');return;}
      port=access.inputs.get(selected);await port.open();
      if(current!==version||p!==window.AxiomStudioDaw.activeProject){await port.close();await access.close?.();return;}
      enumerated=null;session={p,access,port};port.addEventListener('midimessage',receive);access.addEventListener('statechange',devices);status('Connected / '+(port.name||'MIDI input'));
      watch();
    }catch(error){enumerated=null;await port?.close().catch(()=>{});await access?.close?.();status(error.message);}
    finally{if(current===version)connecting=false;controlsState();buttonState();}
  }
  function controlsState(){if(!dialog)return;dialog.querySelector('[data-midi-connect]').textContent=session?'Disconnect':connecting?'Connecting...':'Connect';dialog.querySelector('[data-midi-connect]').disabled=connecting;dialog.querySelector('[data-midi-port]').disabled=Boolean(session)||connecting;dialog.querySelector('[data-midi-learn]').disabled=!session;dialog.querySelector('[data-midi-learn]').textContent=learnTarget?'Cancel Learn':'Learn';}
  function renderMappings(){
    if(!dialog)return;const p=window.AxiomStudioDaw.activeProject,list=dialog.querySelector('[data-midi-list]');list.replaceChildren();
    for(const m of p?.midiMappings||[]){
      const row=document.createElement('div');row.style.cssText='display:flex;gap:8px;align-items:center;border-top:1px solid #454e49;padding:8px 0';
      const text=document.createElement('span');text.style.cssText='flex:1;min-width:0;overflow-wrap:anywhere';const t=m.target;
      text.textContent=`Ch ${m.source.channel+1} ${m.source.kind==='pitch'?'Pitch':`CC ${m.source.controller}`} / ${t.scope==='project'?'Master':target(p,t)?.title||t.targetId} / ${window.AxiomDawAutomation.definitions[t.parameter]?.[0]||t.parameter}`;
      const removeButton=document.createElement('button');removeButton.type='button';removeButton.title='Remove mapping';removeButton.setAttribute('aria-label','Remove mapping');removeButton.innerHTML='<img src="/static/icons/trash-2.svg" width="16" height="16" alt="">';removeButton.onclick=()=>remove(p,sourceKey(m.source));row.append(text,removeButton);list.append(row);
    }
  }
  function open(){
    if(dialog?.open){dialog.focus();return;}
    if(!dialog){
      dialog=document.createElement('dialog');dialog.id='daw-midi-controls';dialog.className='daw-fx-dialog';dialog.setAttribute('aria-label','MIDI Controls');
      dialog.innerHTML='<h2>MIDI Controls</h2><label>Input<select data-midi-port aria-label="MIDI control input"></select></label><label>Target<select data-midi-target aria-label="MIDI control target"></select></label><label>Parameter<select data-midi-parameter aria-label="MIDI control parameter"></select></label><label><input type="checkbox" data-midi-invert>Invert</label><output role="status">Disconnected</output><div data-midi-list></div><footer><button data-midi-connect>Connect</button><button data-midi-learn disabled>Learn</button><button data-midi-close>Close</button></footer>';
      dialog.querySelector('[data-midi-connect]').onclick=connect;
      dialog.querySelector('[data-midi-close]').onclick=()=>{learnTarget=null;if(connecting||enumerated)disconnect();dialog.close();};dialog.oncancel=()=>{learnTarget=null;if(connecting||enumerated)disconnect();};
      dialog.querySelector('[data-midi-learn]').onclick=()=>{if(learnTarget){learnTarget=null;status('Learning cancelled');}else{learnTarget={target:{...JSON.parse(dialog.querySelector('[data-midi-target]').value),parameter:dialog.querySelector('[data-midi-parameter]').value},invert:dialog.querySelector('[data-midi-invert]').checked};status('Waiting for a controller movement...');}controlsState();};
      document.body.append(dialog);
    }
    const p=window.AxiomStudioDaw.activeProject,input=dialog.querySelector('[data-midi-target]');input.replaceChildren();
    const add=(label,scope,targetId='')=>input.add(new Option(label,JSON.stringify({scope,targetId})));
    add('Master','project');for(const id of ['left-deck','right-deck','samples','recordings','instruments'])add(id.replaceAll('-',' '),'deck',id);
    for(const c of p.arrangementClips)add('Clip / '+(c.title||c.id),'clip',c.id);for(const f of p.fxRegions||[])add('FX / '+f.type,'fx',f.id);
    input.onchange=()=>{learnTarget=null;const select=dialog.querySelector('[data-midi-parameter]'),ref=JSON.parse(input.value);select.replaceChildren();for(const [key,[label]] of Object.entries(window.AxiomDawAutomation.definitions))if(window.AxiomDawAutomation.recordable(p,ref,key))select.add(new Option(label,key));controlsState();};input.onchange();renderMappings();controlsState();dialog.showModal();
  }
  window.AxiomMidiControls={message,normalize,validateProject,assign,remove,apply,flush,undo,open,disconnect,get busy(){return Boolean(session)||Boolean(enumerated)||connecting;}};
  window.AxiomEditHistory?.register('midi-controls',undo);
  window.addEventListener('pagehide',()=>disconnect());
  document.addEventListener('pointerdown',flush,true);
  const host=document.querySelector('#daw-accessory-controls') || document.querySelector('.studio-daw-master-controls');
  if(host){const button=document.createElement('button');button.id='daw-midi-controls-button';button.type='button';button.title='MIDI Controls';button.setAttribute('aria-label','MIDI Controls');button.setAttribute('aria-pressed','false');button.innerHTML='<img src="/static/icons/piano.svg" width="16" height="16" alt="">';button.onclick=open;host.append(button);}
})();
