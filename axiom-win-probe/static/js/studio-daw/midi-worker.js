importScripts('/static/vendor/midi-2.0.28/Midi.js');
const module={exports:{}};
importScripts('/static/vendor/midi-file-1.2.4/midi-parser.js');

function channelEvents(raw){
  const channels=Array.from({length:16},()=>[]);let order=0,end=0,count=0;
  for(const track of raw.tracks){
    let ticks=0;
    for(const event of track){
      ticks+=event.deltaTime;
      if(!Number.isSafeInteger(ticks)||ticks<0||++count>100000)throw new Error('MIDI event or timing limit exceeded.');
      if(event.channel!==undefined){
        if(!Number.isInteger(event.channel)||event.channel<0||event.channel>15)throw new Error('Invalid MIDI channel.');
        channels[event.channel].push({...event,ticks,order});
      }
      order++;
    }
    end=Math.max(end,ticks);
  }
  for(const events of channels)events.sort((a,b)=>a.ticks-b.ticks||a.order-b.order);
  return {channels,end};
}

function sustainedNotes(track,events,end,ppq){
  const pedals=events.filter(e=>e.type==='controller'&&[64,121].includes(e.controllerType));
  let sustained=0;
  const notes=track.notes.map(n=>{
    const release=n.ticks+n.durationTicks;
    const off=events.find(e=>e.type==='noteOff'&&e.noteNumber===n.midi&&e.ticks===release);
    let down=false,next=end;
    for(const event of pedals){
      if(event.ticks<release||(event.ticks===release&&(!off||event.order<off.order)))down=event.controllerType===64&&event.value>=64;
      else if(event.controllerType===121||event.value<64){next=event.ticks;break;}
    }
    let finish=release;
    if(down){
      const retrigger=events.find(e=>e.type==='noteOn'&&e.noteNumber===n.midi&&e.ticks>=release&&e.ticks>n.ticks);
      finish=Math.max(release,Math.min(next,retrigger?.ticks??end));if(finish>release)sustained++;
    }
    return {id:crypto.randomUUID(),midi:n.midi,beat:n.ticks/ppq,duration:(finish-n.ticks)/ppq,velocity:n.velocity,channel:track.channel};
  });
  return {notes,sustained};
}
self.onmessage=event=>{
  try{
    const buffer=event.data;
    if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<14||buffer.byteLength>2*1024*1024)throw new Error('MIDI files must be valid and no larger than 2 MB.');
    const header=new DataView(buffer);
    if(header.getUint32(0)!==0x4d546864||header.getUint32(4)!==6||header.getUint16(8)>1||!header.getUint16(10)||header.getUint16(10)>128||!header.getUint16(12)||(header.getUint16(12)&0x8000))throw new Error('Only type 0/1 MIDI files with musical tick timing are supported.');
    const midi=new Midi(new Uint8Array(buffer)),ppq=midi.header.ppq;
    const raw=module.exports(new Uint8Array(buffer));
    if(raw.tracks.length!==header.getUint16(10))throw new Error('MIDI file has missing tracks.');
    const channelData=channelEvents(raw);
    if(!Number.isFinite(ppq)||ppq<=0)throw new Error('Invalid MIDI timing.');
    if(midi.header.timeSignatures.some(s=>s.timeSignature[0]!==4||s.timeSignature[1]!==4))throw new Error('This editor currently imports 4/4 MIDI parts only.');
    const tracks=[];let total=0;
    for(const [index,t] of midi.tracks.entries()){
      if(!t.notes.length)continue;
      total+=t.notes.length;if(total>8192||tracks.length>=32)throw new Error('MIDI import supports up to 32 note tracks and 8192 notes per file.');
      const events=channelData.channels[t.channel],{notes,sustained}=sustainedNotes(t,events,channelData.end,ppq);
      if(notes.some(n=>!Number.isInteger(n.midi)||n.midi<0||n.midi>127||!Number.isFinite(n.beat)||n.beat<0||!Number.isFinite(n.duration)||n.duration<=0||!Number.isFinite(n.velocity)||n.velocity<0||n.velocity>1))throw new Error('MIDI contains invalid or zero-length notes.');
      const lengthBeats=Math.max(4,Math.ceil(Math.max(...notes.map(n=>n.beat+n.duration))/4)*4),program=t.instrument.number;
      const sound=program>=32&&program<=39?'bass':program>=16&&program<=23?'organ':program>=80&&program<=87?'lead':program>=88&&program<=95?'pad':program>=8&&program<=15?'bell':program>=56&&program<=63?'brass':program>=24&&program<=31?'pluck':'keys';
      const midiControls=[];let controllers=0,pitchBends=0;
      for(const point of events){
        const beat=point.ticks/ppq,channel=t.channel;
        if(point.type==='controller'){
          if([7,11].includes(point.controllerType)&&beat<=lengthBeats)midiControls.push({beat,channel,kind:point.controllerType===7?'volume':'expression',value:point.value/127});
          else if(point.controllerType===121&&beat<=lengthBeats)midiControls.push({beat,channel,kind:'pitch',value:0},{beat,channel,kind:'expression',value:1});
          else if(![64,121].includes(point.controllerType))controllers++;
        }else if(point.type==='pitchBend'){
          if(beat<=lengthBeats)midiControls.push({beat,channel,kind:'pitch',value:point.value/8192*2});else pitchBends++;
        }
      }
      midiControls.sort((a,b)=>a.beat-b.beat);
      if(midiControls.some(p=>!Number.isFinite(p.beat)||p.beat<0||!Number.isFinite(p.value)||(p.kind==='pitch'?Math.abs(p.value)>2:p.value<0||p.value>1)))throw new Error('Invalid MIDI control values.');
      const hasParameters=events.some(e=>e.type==='controller'&&[6,38,96,97,98,99,100,101].includes(e.controllerType));
      const reason=t.instrument.percussion?'Percussion mapping is not available.':lengthBeats>256?'Part exceeds 64 bars.':notes.length>2048?'Part exceeds 2048 notes.':midiControls.length>8192?'Part exceeds 8192 control events.':hasParameters?'MIDI parameter changes (RPN/NRPN) are not supported.':'';
      tracks.push({name:(t.name||`MIDI Track ${index+1}`).slice(0,100),notes,lengthBeats,sound,program,reason,midiControls,controllers,pitchBends,sustained});
    }
    if(!tracks.length)throw new Error('The MIDI file has no playable notes.');
    self.postMessage({tracks,ppq,tempoEvents:midi.header.tempos.length});
  }catch(error){self.postMessage({error:error.message||'Could not read MIDI file.'});}
};
