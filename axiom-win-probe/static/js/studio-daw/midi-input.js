(function(){
  'use strict';
  function eventTime(ctx,timeStamp,now=performance.now()){
    const stamp=Number.isFinite(timeStamp)&&Math.abs(timeStamp-now)<10000?timeStamp:now,pair=ctx.getOutputTimestamp?.();
    if(pair&&Number.isFinite(pair.contextTime)&&Number.isFinite(pair.performanceTime)&&pair.performanceTime>0)return pair.contextTime+(stamp-pair.performanceTime)/1000;
    return ctx.currentTime-(ctx.baseLatency||0)+(stamp-now)/1000;
  }
  function alignTake(notes,map,startBeat,length,offsetMs){
    if(!Number.isFinite(offsetMs)||Math.abs(offsetMs)>500)throw new Error('Timing offset must be between -500 and 500 ms.');
    if(offsetMs===0)return {notes:notes.map(note=>({...note})),excluded:0,trimmed:0};
    const start=map.beatToSeconds(startBeat),end=map.beatToSeconds(startBeat+length),result=[];let excluded=0,trimmed=0;
    for(const note of notes){
      const from=map.beatToSeconds(startBeat+note.beat)+offsetMs/1000;
      const to=map.beatToSeconds(startBeat+note.beat+note.duration)+offsetMs/1000;
      const left=Math.max(start,from),right=Math.min(end,to);
      if(right-left<=1e-8){excluded++;continue;}
      if(from<start-1e-8||to>end+1e-8)trimmed++;
      const beat=map.secondsToBeat(left);
      result.push({...note,beat:beat-startBeat,duration:map.secondsToBeat(right)-beat});
    }
    return {notes:result,excluded,trimmed};
  }
  function alignControls(controls,map,startBeat,length,offsetMs){
    if(!Number.isFinite(offsetMs)||Math.abs(offsetMs)>500)throw new Error('Timing offset must be between -500 and 500 ms.');
    const initial=new Map(),later=[],start=map.beatToSeconds(startBeat),end=map.beatToSeconds(startBeat+length);
    for(const point of controls){
      const time=map.beatToSeconds(startBeat+point.beat)+offsetMs/1000;
      if(time<=start)initial.set(point.channel+':'+point.kind,{...point,beat:0});
      else if(time<=end)later.push({...point,beat:map.secondsToBeat(time)-startBeat});
    }
    return [...initial.values(),...later];
  }
  function collector(map,startBeat,startTime,endTime,channel=-1,voice={on(){},off(){}},bendRange=2){
    if(!Number.isFinite(bendRange)||bendRange<1||bendRange>24)throw new Error('Pitch bend range must be between 1 and 24 semitones.');
    const notes=[],controls=[],held=new Map(),sustain=new Set(),values=new Map();let ignored=0,last=startTime,finished=false;
    const beatAt=time=>map.secondsToBeat(map.beatToSeconds(startBeat)+time-startTime)-startBeat;
    function control(ch,kind,value,time){
      const key=ch+':'+kind;
      if(values.get(key)===value)return;
      if(controls.length>=8192)throw new Error('MIDI take exceeds 8192 control events.');
      values.set(key,value);controls.push({channel:ch,kind,value,beat:beatAt(time)});voice.control?.(ch,kind,value);
    }
    function off(key,time,immediate=false){
      const n=held.get(key);if(!n)return;held.delete(key);voice.off(key,immediate);
      const duration=beatAt(Math.min(endTime,time))-n.beat;if(duration>1e-8)notes.push({id:n.id,midi:n.midi,beat:n.beat,duration,velocity:n.velocity,channel:n.channel});
    }
    function finish(time=endTime){if(!finished){finished=true;for(const key of held.keys())off(key,Math.max(startTime,Math.min(endTime,Math.max(last,time))));sustain.clear();}return {notes,controls,ignored};}
    return {receive(data,time){
      if(finished||!Number.isFinite(time)||time<startTime)return;
      if(time>=endTime){finish(endTime);return;}
      if(!data||!Number.isInteger(data[0])||data[0]<0x80||data[0]>=0xf0||data.length!==([0xc0,0xd0].includes(data[0]&0xf0)?2:3)||Array.from(data).slice(1).some(v=>!Number.isInteger(v)||v<0||v>127))return;
      const type=data[0]&0xf0,ch=data[0]&15,key=ch+':'+data[1];if(channel!==-1&&ch!==channel)return;
      time=Math.max(last,time);last=time;
      if(type===0x90&&data[2]>0){
        off(key,time);if(notes.length+held.size>=2048)throw new Error('MIDI take exceeds 2048 notes.');
        const n={id:crypto.randomUUID(),midi:data[1],beat:beatAt(time),velocity:data[2]/127,channel:ch,released:false};held.set(key,n);voice.on(key,n.midi,n.velocity,startBeat+n.beat);
      }else if(type===0x80||type===0x90){const n=held.get(key);if(n){if(sustain.has(ch))n.released=true;else off(key,time);}}
      else if(type===0xe0)control(ch,'pitch',((data[1]+data[2]*128)-8192)/8192*bendRange,time);
      else if(type===0xb0&&[7,11].includes(data[1]))control(ch,data[1]===7?'volume':'expression',data[2]/127,time);
      else if(type===0xb0&&data[1]===64){
        if(data[2]>=64)sustain.add(ch);else {sustain.delete(ch);for(const [key,n] of held)if(n.channel===ch&&n.released)off(key,time);}
      }else if(type===0xb0&&[120,121,123].includes(data[1])){
        sustain.delete(ch);for(const [key,n] of held)if(n.channel===ch&&(data[1]!==121||n.released))off(key,time,data[1]===120);
        if(data[1]===120)voice.silence?.(ch);
        if(data[1]===121){control(ch,'pitch',0,time);control(ch,'expression',1,time);}
      }else ignored++;
    },finish};
  }
  let closeActive=null;
  function open(){
    if(closeActive)return;
    if(window.AxiomMidiControls?.busy){window.showToast?.('Disconnect MIDI Controls before recording MIDI.',true);return;}
    const p=window.AxiomStudioDaw.activeProject,pattern=p&&window.AxiomPatterns.active(p);if(!p||pattern?.kind!=='midi')return;
    const map=window.AxiomStudioDaw.compileTempoMap(p),snapshot=JSON.stringify(map.segments),startBeat=Math.max(0,p.editCursorBeat||0),length=pattern.lengthBeats,endSeconds=map.beatToSeconds(startBeat+length),from=map.beatToSeconds(startBeat);
    const dialog=document.createElement('dialog');dialog.id='daw-midi-input';dialog.className='daw-fx-dialog';dialog.setAttribute('aria-label','Record MIDI');
    dialog.innerHTML='<h2>Record MIDI</h2><label>Input <select data-input disabled></select></label><label>Channel <select data-channel><option value="-1">All channels</option></select></label><label><input data-monitor type="checkbox" checked> Monitor instrument</label><p data-range></p><output role="status">Connect an input</output><footer><button data-discard>Discard</button><button data-action>Connect MIDI</button></footer>';
    const input=dialog.querySelector('[data-input]'),channel=dialog.querySelector('[data-channel]'),monitor=dialog.querySelector('[data-monitor]'),status=dialog.querySelector('output'),action=dialog.querySelector('[data-action]');
    const timing=document.createElement('label');timing.textContent='Timing offset (ms) ';
    const offset=document.createElement('input');offset.type='number';offset.min='-500';offset.max='500';offset.step='0.1';offset.value='0';offset.title='Negative moves recorded notes earlier; positive moves them later.';
    timing.append(offset);status.before(timing);
    const bendLabel=document.createElement('label');bendLabel.textContent='Pitch bend range (semitones) ';
    const bend=document.createElement('input');bend.type='number';bend.min='1';bend.max='24';bend.step='1';bend.value='2';bendLabel.append(bend);timing.before(bendLabel);
    for(let i=0;i<16;i++)channel.add(new Option(String(i+1),String(i)));
    dialog.querySelector('[data-range]').textContent=`Bar ${startBeat/4+1} / ${length/4} ${length===4?'bar':'bars'} / ${window.AxiomInstruments.sounds[pattern.sound].name}`;
    let access,port,handle,recorder,take=null,closed=false,version=0,state='connect';
    function aligned(){if(!offset.value.trim())throw new Error('Enter a timing offset in milliseconds.');return alignTake(take.notes,map,startBeat,length,Number(offset.value));}
    function review(){
      if(state!=='take')return;
      try{const result=aligned();action.disabled=!result.notes.length;status.textContent=`${result.notes.length} notes / ${take.controls.length} controls / ${take.ignored} unsupported events excluded / ${result.trimmed} trimmed / ${result.excluded} outside pattern`+(take.inputError?' / '+take.inputError:'');}
      catch(error){action.disabled=true;status.textContent=error.message;}
    }
    offset.oninput=review;
    const releasePort=()=>{if(port){port.removeEventListener('midimessage',receive);port.close().catch(()=>{});port=null;}};
    const receive=event=>{try{recorder?.receive(event);}catch(error){handle?.cancel();releasePort();state='failed';action.disabled=true;status.textContent=error.message;}};
    const close=()=>{closed=true;version++;handle?.cancel();recorder?.abort();releasePort();access?.removeEventListener('statechange',devices);access?.close?.();dialog.remove();closeActive=null;};
    function devices(){
      if(closed)return;
      if(access.error){
        recorder?.stop();handle?.stop();releasePort();
        status.textContent=access.error+(take?.notes.length?' Notes retained for review.':'');
        if(!take?.notes.length){state='failed';action.disabled=true;}return;
      }
      if(state==='recording'||state==='preparing'){
        if(port?.state==='disconnected'){recorder?.stop();handle?.stop();status.textContent='Input disconnected. '+(take?.notes.length?`${take.notes.length} notes retained for review.`:'No notes captured.');}
        return;
      }
      if(state!=='ready')return;
      const selected=input.value;input.replaceChildren();for(const device of access.inputs.values())if(device.state==='connected')input.add(new Option(device.name||'MIDI input',device.id));
      if([...input.options].some(o=>o.value===selected))input.value=selected;
      input.disabled=!input.options.length;action.disabled=!input.options.length;status.textContent=input.options.length?'Ready':'No MIDI input connected';
    }
    dialog.querySelector('[data-discard]').onclick=close;dialog.oncancel=e=>{e.preventDefault();close();};closeActive=close;
    action.onclick=async()=>{
      if(state==='recording'){handle.stop();return;}
      if(state==='take'){
        if(p!==window.AxiomStudioDaw.activeProject||JSON.stringify(window.AxiomStudioDaw.compileTempoMap(p).segments)!==snapshot){status.textContent='Project or tempo changed. Restore it before saving this take.';return;}
        let result;try{result=aligned();}catch(error){status.textContent=error.message;return;}
        if(!result.notes.length){status.textContent='No notes remain inside the pattern. Adjust the timing offset.';return;}
        const clip={id:crypto.randomUUID(),kind:'midi',name:(pattern.name+' Take').slice(0,100),sound:pattern.sound,startBeat,durationBeats:length,lengthBeats:length,steps:{},notes:take.notes,midiCapture:{inputLabel:take.inputLabel,channel:Number(channel.value),clock:take.clock,excludedEvents:take.ignored,hardwareLatencyCalibrated:false,...(take.inputError?{inputError:take.inputError}:{})}};
        for(const key of ['sourceKey','syncKey','playInKey'])if(pattern[key]!==undefined)clip[key]=pattern[key];
        clip.notes=result.notes;Object.assign(clip.midiCapture,{timingOffsetMs:Number(offset.value),timingTrimmedNotes:result.trimmed,timingExcludedNotes:result.excluded});
        clip.midiControls=alignControls(take.controls,map,startBeat,length,Number(offset.value));clip.midiCapture.pitchBendRange=Number(bend.value);
        if(window.AxiomStudioDaw.importPattern(clip))close();else status.textContent='The MIDI take could not be added.';return;
      }
      const current=++version;action.disabled=true;
      try{
        if(state==='connect'){
          const connect=navigator.requestMIDIAccess?()=>navigator.requestMIDIAccess({sysex:false}):window.AxiomNativeMidi?.available()?()=>window.AxiomNativeMidi.requestAccess():null;
          if(!connect)throw new Error('MIDI input is unavailable in this browser. MIDI file import remains available.');
          status.textContent='Requesting MIDI access...';const requested=await connect();if(closed||version!==current){requested.close?.();return;}
          access=requested;state='ready';action.textContent='Record';access.addEventListener('statechange',devices);devices();return;
        }
        if(p!==window.AxiomStudioDaw.activeProject||JSON.stringify(window.AxiomStudioDaw.compileTempoMap(p).segments)!==snapshot)throw new Error('Project or tempo changed. Reopen MIDI recording.');
        if(!bend.value.trim()||!Number.isInteger(Number(bend.value))||Number(bend.value)<1||Number(bend.value)>24)throw new Error('Pitch bend range must be an integer from 1 to 24 semitones.');
        port=access.inputs.get(input.value);if(!port||port.state!=='connected')throw new Error('Selected MIDI input is unavailable.');
        state='preparing';input.disabled=true;channel.disabled=true;monitor.disabled=true;bend.disabled=true;status.textContent='Preparing project...';
        const selected=port;await selected.open();if(closed||version!==current){await selected.close();return;}if(selected.state!=='connected')throw new Error('MIDI input disconnected.');
        selected.addEventListener('midimessage',receive);
        handle=window.AxiomArrangement.record(p,from,async ctx=>{
          const output=ctx.createGain();output.gain.value=monitor.checked?1:0;
          const voice=window.AxiomInstruments.liveVoice(ctx,output,pattern.sound,pattern.synthPatch);let capture,start,end,timeout,startTimer,done=false,finishing=false,finishTime=Infinity;
          const inputVoice={on(key,midi,velocity,beat){if(!finishing)voice.on(key,window.AxiomInstruments.notePitch(p,pattern,midi,beat),velocity);},off(...args){if(!finishing)voice.off(...args);},control(...args){if(!finishing)voice.control(...args);},silence(...args){if(!finishing)voice.silence?.(...args);}};
          const dispose=()=>{clearTimeout(timeout);clearTimeout(startTimer);voice.dispose();output.disconnect();};
          const finish=async at=>{
            if(done||finishing)return;finishing=true;finishTime=at??eventTime(ctx,performance.now());dispose();
            let inputError=access.error;
            if(access.flush){action.disabled=true;status.textContent='Finishing MIDI take...';try{await access.flush();}catch(error){inputError=error.message;}}
            if(done)return;done=true;const result=capture?.finish(finishTime);releasePort();
            if(closed||version!==current)return;
            take=result?{...result,inputLabel:selected.name||'MIDI input',clock:access.clock||(ctx.getOutputTimestamp?'output-timestamp':'context-latency-estimate'),inputError}:null;
            state=take?.notes.length?'take':'empty';action.textContent='Save Take';action.disabled=!take?.notes.length;status.textContent=(take?.notes.length?`${take.notes.length} notes / ${take.ignored} unsupported events excluded`:'No notes captured')+(inputError?' / '+inputError:'');review();
          };
          recorder={output,endSeconds,arm(a,b){if(done)throw new Error('MIDI recording cancelled.');if(selected.state!=='connected')throw new Error('MIDI input disconnected.');start=a;end=Math.min(b,a+endSeconds-from);capture=collector(map,startBeat,start,end,Number(channel.value),inputVoice,Number(bend.value));startTimer=setTimeout(()=>{if(!done&&!closed&&version===current)status.textContent='Recording / '+(selected.name||'MIDI input');},Math.max(0,(start-eventTime(ctx,performance.now()))*1000));timeout=setTimeout(()=>{finish(end);handle?.stop();},Math.max(0,(end-ctx.currentTime+.1)*1000));},receive(event){const time=eventTime(ctx,event.timeStamp);if(capture&&!done&&time<=finishTime)capture.receive(event.data,time);},stop(reason){if(reason==='end'&&!done&&!finishing){clearTimeout(timeout);timeout=setTimeout(()=>finish(end),Math.max(0,Math.min(500,(end-eventTime(ctx,performance.now()))*1000)));}else finish();},abort(){if(done)return;done=true;dispose();releasePort();}};
          return recorder;
        });
        if(!await handle.ready)throw new Error('MIDI preparation cancelled.');if(closed||version!==current){handle.cancel();return;}
        state='recording';action.disabled=false;action.textContent='Stop';status.textContent='Starting / '+(selected.name||'MIDI input');
      }catch(error){handle?.cancel();recorder?.abort();releasePort();if(!closed){state=access?'ready':'connect';action.disabled=false;input.disabled=!access;channel.disabled=false;monitor.disabled=false;bend.disabled=false;action.textContent=access?'Record':'Connect MIDI';status.textContent=error.message;}}
    };
    document.body.append(dialog);dialog.showModal();
  }
  window.addEventListener('pagehide',()=>closeActive?.());
  window.AxiomMidiInput={eventTime,alignTake,alignControls,collector,open,get busy(){return Boolean(closeActive);}};
})();
