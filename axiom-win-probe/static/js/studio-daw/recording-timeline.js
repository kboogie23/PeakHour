(function(){
  'use strict';
  let settings=null,take=null;
  const tempo=p=>JSON.stringify(window.AxiomStudioDaw.compileTempoMap(p).segments);
  function freeLayer(p,start,duration){
    const occupied=(p.arrangementClips||[]).filter(c=>c.sectionId==='recordings'&&c.timelineStartBeat<start+duration-1e-8&&c.timelineStartBeat+c.timelineDurationBeats>start+1e-8);
    let layer=0;while(occupied.some(c=>(c.layerIndex||0)===layer))layer++;
    return layer;
  }
  function identity(p){
    const number=1+Math.max(p.recordingTakeCounter||0,...(p.arrangementClips||[]).map(c=>Number(c.recordingInfo?.takeNumber)||0));
    const hue=((number-1)*137.508+195)%360;
    const rgb=[0,8,4].map(n=>{const k=(n+hue/30)%12;return Math.round(255*(.65-.28*Math.max(-1,Math.min(k-3,9-k,1))));});
    return {takeId:crypto.randomUUID(),takeNumber:number,takeColour:'#'+rgb.map(n=>n.toString(16).padStart(2,'0')).join('')};
  }
  function releaseInput(job){clearTimeout(job.limit);job.stream?.getTracks().forEach(track=>track.stop());}
  function removePreview(){document.querySelectorAll('.daw-recording-preview').forEach(el=>el.remove());}
  function clear(job){
    releaseInput(job);job.audio?.release?.();removePreview();
    if(take===job)take=null;
    document.getElementById('daw-record-status')?.remove();render();
    if(window.AxiomStudioDaw.activeProject===job.project)window.AxiomStudioDaw.refreshArrangement();
  }
  function render(){
    const button=document.getElementById('daw-toolbar-record');
    const live=take&&['preparing','recording','stopping'].includes(take.phase);
    button?.setAttribute('aria-pressed',String(Boolean(live)));
    button?.setAttribute('aria-label',live?'Stop recording':'Record take');
    if(button){button.disabled=Boolean(take&&['saving','stopping'].includes(take.phase));button.title=live?'Stop and add take to project':settings?`Record ${settings.label}; right-click to change input`:'Choose recording input';}
    if(!take)return;
    let panel=document.getElementById('daw-record-status');
    if(!panel){
      panel=document.createElement('section');panel.id='daw-record-status';panel.setAttribute('aria-label','Timeline recording');
      panel.innerHTML='<strong data-take-title></strong><output role="status"></output><meter min="0" max="1" aria-label="Recording input level"></meter><div><button data-take-stop>Stop</button><button data-take-retry>Retry Save</button><button data-take-return>Back to DAW</button><button data-take-discard>Discard</button></div>';
      panel.querySelector('[data-take-stop]').onclick=stop;
      panel.querySelector('[data-take-retry]').onclick=()=>save(take);
      panel.querySelector('[data-take-return]').onclick=()=>window.AxiomStudioDaw.revealProject(take.project);
      panel.querySelector('[data-take-discard]').onclick=()=>{if(confirm('Discard this unsaved take?'))discard();};
      document.body.append(panel);
    }
    panel.style.setProperty('--take-colour',take.takeColour);
    panel.querySelector('strong').textContent=`Take ${take.takeNumber} / ${settings.label}`;
    panel.querySelector('output').textContent=take.message||`${take.phase==='recording'?'Recording':'Preparing'} / ${(take.seconds||0).toFixed(1)}s`;
    panel.querySelector('meter').value=take.peak||0;
    panel.querySelector('[data-take-stop]').hidden=!['preparing','recording'].includes(take.phase);
    panel.querySelector('[data-take-retry]').hidden=take.phase!=='error'||!take.audio;
    panel.querySelector('[data-take-return]').hidden=window.AxiomStudioDaw.activeProject===take.project;
    panel.querySelector('[data-take-discard]').hidden=!['error','recording'].includes(take.phase);
    renderPreview();
  }
  function renderPreview(){
    const p=window.AxiomStudioDaw.activeProject;
    if(!take||take.project!==p){removePreview();return;}
    const lanes=document.getElementById('studio-daw-lanes'),body=lanes?.querySelector('[data-daw-section="recordings"] .studio-daw-lane-body');
    if(!body)return;
    let preview=body.querySelector('.daw-recording-preview');
    if(!preview){preview=document.createElement('div');preview.className='studio-daw-clip daw-recording-preview';body.append(preview);}
    const map=window.AxiomStudioDaw.compileTempoMap(p),duration=Math.max(.01,map.secondsToBeat(map.beatToSeconds(take.startBeat)+(take.seconds||0))-take.startBeat);
    const layer=freeLayer(p,take.startBeat,duration);
    if(layer!==take.layer){take.layer=layer;window.AxiomStudioDaw.refreshArrangement();return;}
    const start=Number(lanes.dataset.viewStart)||0,span=Number(lanes.dataset.viewBeats)||32;
    const left=Math.max(start,take.startBeat),end=Math.min(start+span,take.startBeat+duration);
    preview.hidden=end<=left;
    preview.style.cssText=`left:${(left-start)/span*100}%;width:${Math.max(0,(end-left)/span*100)}%;--layer-index:${layer};--take-colour:${take.takeColour}`;
    preview.textContent=`Take ${take.takeNumber} / ${take.phase==='recording'?'Recording':take.phase==='error'?'Not saved':'Preparing'}`;
  }
  function setup(){
    if(take){render();return;}
    window.AxiomDawRecording.open({setup:true,settings,onSetup:value=>{settings=value;render();window.showToast?.('Input ready. Place the marker, then press Record.');}});
  }
  async function save(job){
    if(!job||job!==take||!job.audio||job.phase==='saving')return;
    job.phase='saving';job.message='Saving take to project...';render();
    try{
      if(job.project!==window.AxiomStudioDaw.activeProject||tempo(job.project)!==job.tempo)throw new Error('Return to the original project and tempo, then retry saving. Your take is retained.');
      const timing=window.AxiomDawRecording.timing(job.project,job.startBeat,job.audio.duration,job.offsetMs);
      if(!job.track){
        const form=new FormData();form.append('file',job.audio.file,`Take ${job.takeNumber}.wav`);form.append('axiom_generated','1');
        const response=await fetch('/api/studio-daw/import?recording=1',{method:'POST',body:form}),data=await response.json();
        if(!response.ok||!data.track?.path)throw new Error(data.error||'Take storage is unavailable. Retry saving.');
        job.track={...data.track,title:`Take ${job.takeNumber}`,bpm:window.AxiomStudioDaw.compileTempoMap(job.project).bpmAtBeat(timing.startBeat)};
      }
      if(take!==job)return;
      if(job.project!==window.AxiomStudioDaw.activeProject||tempo(job.project)!==job.tempo)throw new Error('Project changed during save. Return to it and retry. Your take is retained.');
      const layerIndex=freeLayer(job.project,timing.startBeat,timing.durationBeats);
      timing.capture={takeId:job.takeId,takeNumber:job.takeNumber,takeColour:job.takeColour,engine:'audio-worklet',sampleRate:48000,frames:job.audio.length,gapFrames:job.audio.gapFrames,inputEnded:job.audio.inputEnded,inputLabel:settings.label,channelOffset:job.channelOffset,requestedStartBeat:job.startBeat,timingOffsetMs:job.offsetMs,sourceTrimSeconds:timing.trimSeconds,overdub:job.playProject,hardwareLatencyCalibrated:false};
      // Hide the provisional take before the normal undoable clip insertion renders.
      take=null;removePreview();
      try{
        window.AxiomStudioDaw.addTrackToProject(job.track,{placement:{sectionId:'recordings',beat:timing.startBeat,layerIndex},recording:timing});
        if(!job.project.arrangementClips.some(c=>c.recordingInfo?.takeId===job.takeId))throw new Error('Take could not be placed. Retry saving.');
      }catch(error){take=job;throw error;}
      job.project.recordingTakeCounter=job.takeNumber;
      clear(job);window.AxiomDawDrafts?.checkpoint();
      window.showToast?.(`Take ${job.takeNumber} added to Recordings, layer ${layerIndex+1}.`);
    }catch(error){if(take===job){job.phase='error';job.message=error.message;render();}}
  }
  async function start(){
    if(take)return;
    if(!settings){setup();return;}
    const p=window.AxiomStudioDaw.activeProject;if(!p)return;
    const position=window.AxiomArrangement.automationPosition?.();
    const startBeat=position?.project===p&&position.eligible?position.beat:Math.max(0,p.editCursorBeat||0);
    const job={...identity(p),...settings,project:p,startBeat,tempo:tempo(p),phase:'preparing',seconds:0,layer:freeLayer(p,startBeat,.01)};
    take=job;window.AxiomArrangement.stop(false);window.AxiomBeatPreview?.stop();window.AxiomStems?.stop();window.stopAxiomAudioPlayback?.('record-input');
    window.AxiomStudioDaw.selectSection('recordings');render();
    try{
      if(!navigator.mediaDevices?.getUserMedia||!window.AudioWorkletNode)throw new Error('PCM input recording is unavailable in this browser.');
      job.stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:{ideal:32},echoCancellation:false,noiseSuppression:false,autoGainControl:false,deviceId:{exact:settings.deviceId}},video:false});
      if(take!==job){releaseInput(job);return;}
      const channels=job.stream.getAudioTracks()[0].getSettings().channelCount;
      if(job.channelOffset>0&&Number.isFinite(channels)&&channels<job.channelOffset+2)throw new Error('This input does not expose the selected USB pair. Choose another input or pair.');
      const prepare=async ctx=>{
        job.recorder=await window.AxiomDawRecording.capture(job.stream,audio=>{
          releaseInput(job);job.overdub?.stop();
          if(take!==job){audio.release?.();return;}
          job.audio=audio;
          if(audio.duration<.05){job.audio.release?.();job.audio=null;job.message='Take was too short. Press Discard, then record again.';job.phase='error';render();return;}
          save(job);
        },error=>{
          releaseInput(job);job.overdub?.cancel();
          if(take===job){job.phase='error';job.message=error.message;render();}
        },ctx,job.channelOffset,(peak,seconds)=>{
          if(take!==job)return;
          if(!['preparing','recording'].includes(job.phase))return;
          job.phase='recording';job.peak=peak;job.seconds=seconds;
          if(!job.playProject){p.editCursorBeat=window.AxiomStudioDaw.compileTempoMap(p).secondsToBeat(window.AxiomStudioDaw.compileTempoMap(p).beatToSeconds(startBeat)+seconds);window.AxiomArrangement.seekBeat(p,p.editCursorBeat);}
          render();
        });
        if(take!==job){job.recorder.abort();throw new Error('Recording cancelled.');}
        // Continue the shared recording clock past the current song/project end.
        job.recorder.endSeconds=window.AxiomStudioDaw.compileTempoMap(p).beatToSeconds(startBeat)+job.recorder.maxSeconds;
        return job.recorder;
      };
      if(job.playProject){
        job.overdub=window.AxiomArrangement.record(p,window.AxiomStudioDaw.compileTempoMap(p).beatToSeconds(startBeat),prepare);
        if(!await job.overdub.ready)throw new Error('Recording preparation was cancelled.');
      }else await prepare(null);
      if(take!==job)return;
      job.phase='recording';job.limit=setTimeout(stop,(job.recorder.maxSeconds+5)*1000);render();
    }catch(error){
      job.recorder?.abort();job.overdub?.cancel();releaseInput(job);
      if(take===job){clear(job);window.showToast?.(error.message,true);}
    }
  }
  function stop(){
    if(!take)return;
    if(take.phase==='preparing'){discard();return;}
    if(take.phase!=='recording')return;
    take.phase='stopping';take.message='Finishing take...';take.recorder.stop();take.overdub?.stop();render();
  }
  function discard(){const job=take;if(!job)return;take=null;job.recorder?.abort();job.overdub?.cancel();clear(job);}
  function toggle(){if(take)stop();else start();}
  window.addEventListener('pagehide',discard);
  window.addEventListener('beforeunload',event=>{if(take){event.preventDefault();event.returnValue='';}});
  window.AxiomDawTimelineRecording={setup,start,stop,toggle,freeLayer,identity,renderPreview,
    get layer(){return take?.project===window.AxiomStudioDaw.activeProject?take.layer:null;},
    get active(){return Boolean(take);}};
})();
