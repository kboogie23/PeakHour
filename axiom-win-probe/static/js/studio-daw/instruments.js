(function(){
  'use strict';
  const sounds={
    ...(window.AxiomLayerSynth?.presets||{}),
    keys:{name:'Soft Keys',type:'Synth',oscillator:{type:'triangle'},envelope:{attack:.005,decay:.3,sustain:.2,release:.15}},
    bass:{name:'Round Bass',type:'Synth',oscillator:{type:'sine'},envelope:{attack:.008,decay:.2,sustain:.7,release:.08}},
    lead:{name:'Square Lead',type:'Synth',oscillator:{type:'square'},envelope:{attack:.015,decay:.1,sustain:.5,release:.12}},
    pad:{name:'Triangle Pad',type:'Synth',oscillator:{type:'triangle'},envelope:{attack:.25,decay:.2,sustain:.6,release:.5}},
    pluck:{name:'Glass Pluck',type:'Synth',oscillator:{type:'sine'},envelope:{attack:.002,decay:.15,sustain:.03,release:.08}},
    bell:{name:'FM Bell',type:'FMSynth',harmonicity:3,modulationIndex:8,envelope:{attack:.003,decay:.4,sustain:.08,release:.4}},
    organ:{name:'Sine Organ',type:'Synth',oscillator:{type:'sine'},envelope:{attack:.01,decay:.01,sustain:.8,release:.05}},
    brass:{name:'Saw Brass',type:'Synth',oscillator:{type:'sawtooth'},envelope:{attack:.06,decay:.15,sustain:.3,release:.15}}
  };
  const banks=new WeakMap(),selections=new WeakMap(),liveContexts=new WeakMap();
  function keyInfo(key){
    const match=typeof key==='string'&&/^([1-9]|1[0-2])([AB])$/.exec(key);
    if(!match)throw new Error('Choose a verified Camelot key for the instrument pattern.');
    return {tonic:((match[2]==='A'?8:11)+(Number(match[1])-1)*7)%12,minor:match[2]==='A'};
  }
  function anchorLookup(p){
    const cache=new Map(),boundaries=p.mode==='mixtape'?[...new Set((p.arrangementClips||[]).filter(c=>['left-deck','right-deck'].includes(c.sectionId)&&c.path&&c.timelineDurationBeats>0).flatMap(c=>[c.timelineStartBeat,c.timelineStartBeat+c.timelineDurationBeats]))].sort((a,b)=>a-b):[];
    return beat=>{
      let low=0,high=boundaries.length;
      while(low<high){const mid=Math.floor((low+high)/2);if(boundaries[mid]<=beat)low=mid+1;else high=mid;}
      if(!cache.has(low))cache.set(low,window.AxiomStudioDaw.anchorAtBeat(p,beat));
      return cache.get(low);
    };
  }
  function notePitch(p,c,midi,beat,resolveAnchor=null){
    let key=c.sourceKey,pitch=midi,anchorShift=0;
    if(c.syncKey){
      const anchor=(resolveAnchor||((at)=>window.AxiomStudioDaw.anchorAtBeat(p,at)))(Math.max(0,beat));
      key=anchor?.camelot||anchor?.keySync?.anchorKey;
      if(!key)throw new Error('The instrument needs an anchor with a verified key at this position.');
      anchorShift=anchor.camelot?window.AxiomStudioDaw.playbackPitch(anchor):0;
      if(!Number.isInteger(anchorShift))throw new Error('Instrument key sync requires an anchor pitched in whole semitones.');
      const shift=window.AxiomStudioDaw.keySyncOffset(c.sourceKey,key)+anchorShift;
      pitch+=((shift+6)%12+12)%12-6;
    }
    if(!Number.isInteger(pitch)||pitch<0||pitch>127)throw new Error('Key sync moves an instrument note outside MIDI range. Change its octave.');
    if(c.playInKey){
      const info=keyInfo(key),tonic=info.tonic+anchorShift,scale=info.minor?[0,2,3,5,7,8,10]:[0,2,4,5,7,9,11];
      // Nearest in-scale note; ties prefer the lower note. Never alter saved MIDI.
      for(let distance=0;distance<=12;distance++){
        const found=[pitch-distance,pitch+distance].find(n=>n>=0&&n<=127&&scale.includes(((n-tonic)%12+12)%12));
        if(found!==undefined){pitch=found;break;}
      }
    }
    return pitch;
  }
  function liveVoice(ctx,output,sound,synthPatch){
    if(!window.Tone||!sounds[sound])throw new Error('Instrument sound is unavailable.');
    const layered=sounds[sound].type==='LayerSynth',settings=layered?window.AxiomLayerSynth.settings(sound,synthPatch):sounds[sound].envelope;
    let tone=liveContexts.get(ctx);
    if(!tone){tone=new Tone.Context({context:ctx,lookAhead:0});liveContexts.set(ctx,tone);ctx.addEventListener('statechange',()=>{if(ctx.state==='closed'){tone.dispose();liveContexts.delete(ctx);}});}
    const active=new Map(),voices=new Map(),timers=new Map(),gains=new Map(),channels=new Map();
    const disposeVoice=voice=>{clearTimeout(timers.get(voice));timers.delete(voice);const key=voices.get(voice);if(active.get(key)===voice)active.delete(key);voices.delete(voice);voice.dispose();gains.get(voice)?.dispose();gains.delete(voice);};
    const control=(channel,kind,value)=>{
      const state=channels.get(channel)||{pitch:0,volume:1,expression:1};state[kind]=value;channels.set(channel,state);
      for(const [voice,key] of voices)if(Number(key.split(':')[0])===channel){
        voice.detune.setValueAtTime(state.pitch*100,ctx.currentTime+.005);
        gains.get(voice).gain.setValueAtTime(state.volume*state.expression,ctx.currentTime+.005);
      }
    };
    const release=(key,immediate=false)=>{const voice=active.get(key);if(!voice)return;active.delete(key);if(immediate){disposeVoice(voice);return;}voice.triggerRelease(ctx.currentTime+.005);timers.set(voice,setTimeout(()=>disposeVoice(voice),(settings.release+.1)*1000));};
    return {on(key,midi,velocity){
      release(key);if(voices.size>=(layered?16:64))throw new Error('Live instrument voice limit reached.');
      const state=channels.get(Number(key.split(':')[0]))||{pitch:0,volume:1,expression:1};
      const gain=new Tone.Gain({context:tone,gain:state.volume*state.expression}).connect(output);
      let voice;
      try{
        const {type,name,...settings}=sounds[sound];voice=(layered?window.AxiomLayerSynth.createVoice(Tone,tone,sound,synthPatch,{volume:-12,detune:state.pitch*100}):new Tone[type]({context:tone,...settings,volume:-12,detune:state.pitch*100})).connect(gain);voices.set(voice,key);gains.set(voice,gain);active.set(key,voice);
        voice.triggerAttack(440*Math.pow(2,(midi-69)/12),ctx.currentTime+.005,velocity);
      }catch(error){if(voice)disposeVoice(voice);else gain.dispose();throw error;}
    },off:release,control,silence(channel){for(const [voice,key] of voices)if(key.startsWith(channel+':'))disposeVoice(voice);},dispose(){for(const voice of voices.keys())disposeVoice(voice);channels.clear();}};
  }
  function validate(c){
    if(!Object.hasOwn(sounds,c.sound)||!Array.isArray(c.notes)||c.notes.length>2048)throw new Error('Invalid instrument pattern.');
    if(sounds[c.sound].type==='LayerSynth')window.AxiomLayerSynth.settings(c.sound,c.synthPatch);
    else if(c.synthPatch!==undefined)throw new Error('Synth settings require an AXIOM layered sound.');
    for(const key of ['syncKey','playInKey'])if(c[key]!==undefined&&typeof c[key]!=='boolean')throw new Error('Invalid instrument key setting.');
    if(c.sourceKey!==undefined&&c.sourceKey!=='')keyInfo(c.sourceKey);
    if(c.syncKey||c.playInKey)keyInfo(c.sourceKey);
    const ids=new Set();
    for(const n of c.notes){
      if(!n||typeof n.id!=='string'||!/^[-\w]+$/.test(n.id)||ids.has(n.id)||!Number.isInteger(n.midi)||n.midi<0||n.midi>127||!Number.isFinite(n.beat)||n.beat<0||!Number.isFinite(n.duration)||n.duration<=0||n.beat+n.duration>c.lengthBeats+1e-8||!Number.isFinite(n.velocity)||n.velocity<0||n.velocity>1)throw new Error('Invalid instrument note.');
      ids.add(n.id);
      if(n.channel!==undefined&&(!Number.isInteger(n.channel)||n.channel<0||n.channel>15))throw new Error('Invalid instrument note channel.');
    }
    if(c.midiControls!==undefined){
      if(!Array.isArray(c.midiControls)||c.midiControls.length>8192)throw new Error('Invalid MIDI controls.');
      let last=-1;
      for(const point of c.midiControls){
        if(!point||!Number.isFinite(point.beat)||point.beat<last||point.beat<0||point.beat>c.lengthBeats||!Number.isInteger(point.channel)||point.channel<0||point.channel>15||!['pitch','volume','expression'].includes(point.kind)||!Number.isFinite(point.value)||(point.kind==='pitch'?Math.abs(point.value)>24:point.value<0||point.value>1))throw new Error('Invalid MIDI control point.');
        last=point.beat;
      }
    }
  }
  function noteControls(points,n,beat,seconds,duration){
    if(!points.length)return [];
    const state={pitch:0,volume:1,expression:1},later=[];
    for(const point of points){
      if(point.beat<=n.beat)state[point.kind]=point.value;
      else{
        const time=seconds(beat+point.beat-n.beat)-seconds(beat);
        if(time<duration)later.push({...point,time});
      }
    }
    const result=[{time:0,pitch:state.pitch,gain:state.volume*state.expression}];
    for(const point of later){state[point.kind]=point.value;result.push({time:point.time,pitch:state.pitch,gain:state.volume*state.expression});}
    return result;
  }
  function hasNotes(p){return window.AxiomPatterns.list(p).some(c=>c.kind==='midi'&&!c.muted&&c.notes?.length);}
  function events(p,from=0,to=Infinity){
    const map=window.AxiomStudioDaw.compileTempoMap(p),result=[],seconds=b=>b<0?b*60/map.bpmAtBeat(0):map.beatToSeconds(b);let controlCount=0,resolveAnchor=null;
    for(const c of window.AxiomPatterns.list(p)){
      if(c.kind!=='midi'||c.muted)continue;validate(c);
      const controls=Array.from({length:16},(_,channel)=>(c.midiControls||[]).filter(point=>point.channel===channel));
      const synthPatch=sounds[c.sound].type==='LayerSynth'?window.AxiomLayerSynth.settings(c.sound,c.synthPatch):undefined;
      const release=synthPatch?.release??sounds[c.sound].envelope.release,origin=c.startBeat-(c.offsetBeats||0),clipStart=map.beatToSeconds(c.startBeat),clipEnd=map.beatToSeconds(c.startBeat+c.durationBeats);
      if(clipEnd<=from||clipStart>=to)continue;
      const first=Math.floor((map.secondsToBeat(Math.max(from-release,clipStart))-origin)/c.lengthBeats)-1,last=Math.ceil((map.secondsToBeat(Math.min(to,clipEnd))-origin)/c.lengthBeats);
      if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||last-first>10000)throw new Error('Instrument scheduling limit exceeded.');
      for(let cycle=first;cycle<last;cycle++)for(const n of c.notes){
        const beat=origin+cycle*c.lengthBeats+n.beat;
        if(beat+n.duration<=c.startBeat||beat>=c.startBeat+c.durationBeats)continue;
        const start=seconds(beat),hold=seconds(beat+n.duration)-start,end=Math.min(clipEnd,start+hold+release);
        if(end<=from||Math.max(start,clipStart)>=to||n.velocity===0)continue;
        if(!(hold>0&&hold<=60))throw new Error('Instrument notes currently support up to 60 seconds.');
        const performance=noteControls(controls[n.channel??0],n,beat,seconds,hold+release);controlCount+=performance.length;
        if(controlCount>65536)throw new Error('Instrument control scheduling limit exceeded.');
        if(c.syncKey&&!resolveAnchor)resolveAnchor=anchorLookup(p);
        const midi=notePitch(p,c,n.midi,Math.max(c.startBeat,beat),resolveAnchor),key=JSON.stringify([c.sound,midi,hold,performance,...(synthPatch?[synthPatch]:[])]);
        result.push({key,sound:c.sound,synthPatch,midi,hold,controls:performance,onset:Math.max(start,clipStart),finish:end,start:Math.max(start,clipStart,from),end:Math.min(end,to),offset:Math.max(clipStart,from,start)-start,velocity:n.velocity*(c.velocity??1)});
        if(result.length>20000)throw new Error('Instrument scheduling limit exceeded.');
      }
    }
    return result.sort((a,b)=>a.start-b.start);
  }
  async function prepare(p,from,to,cancelled=()=>false){
    if(!hasNotes(p)){banks.delete(p);return;}
    if(!window.Tone)throw new Error('Instrument engine could not load.');
    const wanted=events(p,from,to),previous=banks.get(p),bank=new Map();let bytes=0;
    for(const e of wanted){
      if(cancelled())throw new Error('Instrument preparation cancelled');
      if(bank.has(e.key))continue;
      let buffer=previous?.get(e.key);
      if(!buffer){
        const {type,name,...settings}=sounds[e.sound],ctx=new Tone.OfflineContext(2,e.hold+(e.synthPatch?.release??settings.envelope.release),48000);let voice,gain;
        try{
          gain=new Tone.Gain({context:ctx,gain:1}).connect(ctx.destination);
          voice=(type==='LayerSynth'?window.AxiomLayerSynth.createVoice(Tone,ctx,e.sound,e.synthPatch):new Tone[type]({context:ctx,...settings,volume:-12})).connect(gain);
          for(const point of e.controls){voice.detune.setValueAtTime(point.pitch*100,point.time);gain.gain.setValueAtTime(point.gain,point.time);}
          voice.triggerAttackRelease(440*Math.pow(2,(e.midi-69)/12),e.hold,0,1);buffer=(await ctx.render()).get();
        }
        finally{voice?.dispose();gain?.dispose();ctx.dispose();}
      }
      bytes+=buffer.length*buffer.numberOfChannels*4;if(bytes>128*1024*1024)throw new Error('Instrument preparation exceeds the current 128 MB limit.');
      bank.set(e.key,buffer);
    }
    if(cancelled())throw new Error('Instrument preparation cancelled');banks.set(p,bank);
  }
  function schedule(ctx,destination,p,origin,from,to,own,trackVoice=null,scheduleWindow=null){
    for(const e of events(p,from,to)){
      if(scheduleWindow?.continuations===false&&e.onset<from)continue;
      const buffer=banks.get(p)?.get(e.key);if(!buffer)throw new Error('Instrument sound was not prepared.');
      // Refill windows choose new onsets; an existing voice keeps its original
      // phase and complete release instead of being spliced at a frame boundary.
      const end=scheduleWindow?.complete?Math.min(e.finish,scheduleWindow.end??Infinity):e.end;
      const source=scheduleWindow?.source? scheduleWindow.source(buffer,origin+e.start,e.offset,end-e.start):own(ctx.createBufferSource());
      const gain=own(ctx.createGain());gain.gain.value=e.velocity;source.connect(gain).connect(destination);
      if(!scheduleWindow?.source){source.buffer=buffer;source.start(origin+e.start,e.offset);source.stop(origin+end);}
      trackVoice?.(source,gain,origin+end);
    }
  }
  const noteName=m=>['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][m%12]+(Math.floor(m/12)-1);
  let previewProject=null;
  function preview(id){
    const p=window.AxiomStudioDaw.activeProject,c=window.AxiomPatterns.list(p).find(c=>c.id===id);if(!c)return;
    const copy=JSON.parse(JSON.stringify(p));copy.arrangementClips=(copy.arrangementClips||[]).map(clip=>({...clip,muted:true,mixSolo:false}));copy.patternClips=[{...c,durationBeats:c.lengthBeats}];copy.fxRegions=[];copy.title=c.name;
    for(const row of Object.values(copy.rowMixer||{}))row.solo=false;
    previewProject=copy;
    return window.AxiomArrangement.play(copy,window.AxiomStudioDaw.compileTempoMap(copy).beatToSeconds(c.startBeat));
  }
  function renderEditor(editor,p,c){
    editor.classList.add('daw-note-editor');
    const selected=selections.get(p),note=c.notes.find(n=>n.id===selected),width=Math.max(640,c.lengthBeats*64);
    editor.innerHTML='<div class="daw-note-toolbar"><select aria-label="Instrument sound"></select><button data-play title="Preview instrument pattern" aria-label="Preview instrument pattern"><img src="/static/icons/play.svg" alt=""></button><button data-stop title="Stop instrument preview" aria-label="Stop instrument preview"><img src="/static/icons/square.svg" alt=""></button><button data-edit title="Pattern settings" aria-label="Pattern settings"><img src="/static/icons/sliders-horizontal.svg" alt=""></button><label>Note <input data-pitch type="number" min="0" max="127"></label><label>Beats <input data-length type="number" min="0.0625" step="0.25"></label><label>Velocity <input data-velocity type="range" min="0" max="100"></label><button data-delete title="Delete note" aria-label="Delete note"><img src="/static/icons/trash-2.svg" alt=""></button><output role="status"></output></div><div class="daw-note-scroll"><div class="daw-note-grid" tabindex="0" role="group" aria-label="Instrument piano roll"></div></div>';
    const grid=editor.querySelector('.daw-note-grid'),scroll=editor.querySelector('.daw-note-scroll'),sound=editor.querySelector('select');
    editor.querySelector('.daw-note-toolbar').prepend(patternPicker(p,c));
    window.AxiomPatternMonitor?.mount(editor.querySelector('.daw-note-toolbar'));
    window.AxiomPatterns.mountActions(editor.querySelector('.daw-note-toolbar'),p,c);
    const importButton=document.createElement('button');importButton.innerHTML='<img src="/static/icons/folder-open.svg" alt="">';importButton.title='Import MIDI notes';importButton.setAttribute('aria-label','Import MIDI notes');importButton.onclick=()=>window.AxiomMidiImport.open();editor.querySelector('.daw-note-toolbar').append(importButton);
    const recordButton=document.createElement('button');recordButton.innerHTML='<img src="/static/icons/mic-vocal.svg" alt="">';recordButton.title='Record MIDI';recordButton.setAttribute('aria-label','Record MIDI');recordButton.onclick=()=>window.AxiomMidiInput.open();editor.querySelector('.daw-note-toolbar').append(recordButton);
    for(const [kind,icon,label] of [['midi','piano','Add instrument pattern'],['drums','drum','Add drum pattern']]){const button=document.createElement('button');button.innerHTML=`<img src="/static/icons/${icon}.svg" alt="">`;button.title=label;button.setAttribute('aria-label',label);button.onclick=()=>window.AxiomStudioDaw.addPattern(kind);editor.querySelector('.daw-note-toolbar').append(button);}
    for(const [key,s] of Object.entries(sounds))sound.add(new Option(s.name,key));sound.value=c.sound;
    const apply=patch=>window.AxiomStudioDaw.editPattern(c.id,'apply',patch),update=patch=>note&&apply({notes:c.notes.map(n=>n.id===note.id?{...n,...patch}:n)});
    sound.onchange=()=>apply({sound:sound.value,synthPatch:undefined});editor.querySelector('[data-play]').onclick=()=>preview(c.id);editor.querySelector('[data-stop]').onclick=()=>window.AxiomArrangement.stop(false);editor.querySelector('[data-edit]').onclick=()=>window.AxiomPatterns.edit(c.id);
    if(sounds[c.sound].type==='LayerSynth'){const button=document.createElement('button');button.textContent='Sound settings';button.title='Shape layers, brightness, stereo spread and the note envelope';button.onclick=()=>window.AxiomLayerSynth.edit(c.id);editor.querySelector('.daw-note-toolbar').append(button);}
    const remove=()=>{if(note)apply({notes:c.notes.filter(n=>n.id!==note.id)});};
    editor.querySelector('[data-delete]').disabled=!note;editor.querySelector('[data-delete]').onclick=remove;
    for(const [selector,key,value,scale] of [['pitch','midi',note?.midi,1],['length','duration',note?.duration,1],['velocity','velocity',note?note.velocity*100:0,100]]){
      const input=editor.querySelector('[data-'+selector+']');input.disabled=!note;input.value=value??'';input.onchange=()=>{if(input.value.trim()===''||!update({[key]:Number(input.value)/scale}))input.value=value??'';};
    }
    grid.style.width=width+'px';grid.style.setProperty('--beat-width',(width/c.lengthBeats)+'px');
    const ruler=document.createElement('div');ruler.className='daw-note-ruler';ruler.style.width=width+'px';for(let b=0;b<c.lengthBeats;b++){const tick=document.createElement('span');tick.textContent=`${Math.floor(b/4)+1}.${b%4+1}`;tick.style.left=b/c.lengthBeats*100+'%';ruler.append(tick);}scroll.prepend(ruler);
    for(let midi=127;midi>=0;midi--){const row=document.createElement('div');row.className='daw-note-row'+([1,3,6,8,10].includes(midi%12)?' black':'');row.textContent=noteName(midi);grid.append(row);}
    for(const n of c.notes){
      const button=document.createElement('button');button.className='daw-note'+(n.id===selected?' selected':'');button.style.cssText=`left:${n.beat/c.lengthBeats*100}%;width:${n.duration/c.lengthBeats*100}%;top:${(127-n.midi)*14}px`;
      button.textContent=noteName(n.midi);button.title=`${noteName(n.midi)} / ${n.duration} beats / ${Math.round(n.velocity*100)}%`;button.setAttribute('aria-label',button.title);button.dataset.note=n.id;
      const handle=document.createElement('span');handle.className='daw-note-edge';button.append(handle);
      button.onpointerdown=e=>gesture(e,n,e.target===handle?'resize':'move');grid.append(button);
    }
    function gesture(event,n,mode){
      if(event.button!==0)return;event.preventDefault();event.stopPropagation();
      const rect=grid.getBoundingClientRect(),before=JSON.stringify(c),id=n?.id||crypto.randomUUID();let moved=false,patch=n?{...n}:{id,midi:Math.max(0,Math.min(127,127-Math.floor((event.clientY-rect.top)/14))),beat:Math.max(0,Math.min(c.lengthBeats-.25,Math.floor((event.clientX-rect.left)/rect.width*c.lengthBeats*4)/4)),duration:.25,velocity:.8};
      const ghost=document.createElement('span');ghost.className='daw-note selected';grid.append(ghost);
      const paint=()=>{ghost.style.cssText=`left:${patch.beat/c.lengthBeats*100}%;width:${patch.duration/c.lengthBeats*100}%;top:${(127-patch.midi)*14}px`;};paint();
      const move=e=>{moved||=Math.abs(e.clientX-event.clientX)+Math.abs(e.clientY-event.clientY)>3;let delta=(e.clientX-event.clientX)/rect.width*c.lengthBeats;if(!e.altKey)delta=Math.round(delta*4)/4;
        if(mode==='move'){patch.beat=Math.max(0,Math.min(c.lengthBeats-n.duration,n.beat+delta));patch.midi=Math.max(0,Math.min(127,n.midi-Math.round((e.clientY-event.clientY)/14)));}
        else patch.duration=Math.max(.0625,Math.min(c.lengthBeats-patch.beat,(n?.duration||.25)+delta));paint();};
      const clean=()=>{ghost.remove();document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',end);document.removeEventListener('pointercancel',clean);document.removeEventListener('keydown',escape);};
      const escape=e=>{if(e.key==='Escape'){e.preventDefault();clean();}};
      const end=e=>{move(e);clean();if(window.AxiomStudioDaw.activeProject!==p||JSON.stringify(window.AxiomPatterns.active(p))!==before)return;
        selections.set(p,id);if(!n||moved)apply({notes:n?c.notes.map(x=>x.id===n.id?patch:x):[...c.notes,patch]});else window.AxiomStudioDaw.selectPattern(c.id);
      };
      document.addEventListener('pointermove',move);document.addEventListener('pointerup',end);document.addEventListener('pointercancel',clean);document.addEventListener('keydown',escape);
    }
    grid.onpointerdown=e=>{if(!e.target.closest('button'))gesture(e,null,'draw');};
    grid.onkeydown=e=>{
      if(['Delete','Backspace'].includes(e.key)){e.preventDefault();e.stopPropagation();remove();}
      if(note&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();e.stopPropagation();
        if(e.key==='ArrowUp'||e.key==='ArrowDown')update({midi:Math.max(0,Math.min(127,note.midi+(e.key==='ArrowUp'?1:-1)*(e.shiftKey?12:1)))});
        else update({beat:Math.max(0,Math.min(c.lengthBeats-note.duration,note.beat+(e.key==='ArrowRight'?1:-1)*(e.shiftKey?1:.25)))});
      }
    };
    scroll.scrollTop=Math.max(0,(127-(note?.midi??60))*14-42);if(selected)grid.focus({preventScroll:true});
  }
  function patternPicker(p,c){
    const select=document.createElement('select');select.setAttribute('aria-label','Active pattern');select.title='Active pattern';select.style.cssText='max-width:130px;min-width:0;background:#151815;color:#eee';
    const group=document.createElement('optgroup');group.label='Project patterns';
    for(const clip of window.AxiomPatterns.list(p))group.append(new Option(clip.name,clip.id));select.append(group);select.value=c?.id||'';
    select.onchange=()=>window.AxiomStudioDaw.selectPattern(select.value);
    window.AxiomDrumPresets?.extendPicker(select,p,c);return select;
  }
  window.AxiomInstruments={sounds,validate,notePitch,hasNotes,events,prepare,schedule,preview,renderEditor,patternPicker,liveVoice,get previewing(){return Boolean(previewProject&&window.AxiomArrangement?.isPlayingProject(previewProject));}};
})();
