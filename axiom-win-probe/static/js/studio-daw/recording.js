(function(){
  'use strict';
  let closeActive=null,preferredInput='';
  const preferredPairs=new Map();
  async function capture(stream,onstop,onerror,sharedContext=null,channelOffset=0,onLevel=()=>{}){
    const ctx=sharedContext||new AudioContext({sampleRate:48000});let input,node,timeout,finished=false,frames=0,inputEnded=false,storage;let writes=Promise.resolve();
    const dispose=()=>{clearTimeout(timeout);input?.disconnect();node?.disconnect();if(!sharedContext&&ctx.state!=='closed')ctx.close().catch(()=>{});};
    const fail=error=>{if(finished)return;finished=true;recorder.state='inactive';storage?.abort();dispose();onerror(error);};
    const recorder={state:'recording',arm(start,end){if(finished)throw new Error('Audio input ended before recording could start.');node.port.postMessage({type:'arm',startFrame:Math.round(start*ctx.sampleRate),endFrame:Math.round(end*ctx.sampleRate)});},stop(){if(finished||this.state!=='recording')return;this.state='inactive';node.port.postMessage({type:'stop'});timeout=setTimeout(()=>fail(new Error('Audio input stopped responding. The incomplete take was not saved.')),15000);},abort(){finished=true;this.state='inactive';storage?.abort();dispose();}};
    try{
      if(!ctx.audioWorklet||ctx.sampleRate!==48000)throw new Error('48 kHz PCM recording is unavailable in this browser.');
      storage=await window.AxiomDawRecordingStorage.create();recorder.maxSeconds=storage.maxFrames/48000;
      await ctx.audioWorklet.addModule('/static/js/studio-daw/recording-worklet.js?v=3');
      node=new AudioWorkletNode(ctx,'axiom-input-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCountMode:'max',channelInterpretation:'discrete',processorOptions:{scheduled:Boolean(sharedContext),channelOffset,maxFrames:storage.maxFrames,bounded:true}});
      node.onprocessorerror=()=>fail(new Error('Audio capture failed. The incomplete take was not saved.'));
      node.port.onmessage=e=>{
        if(finished)return;const data=e.data;
        if(data.type==='error'){fail(new Error(data.message));return;}
        if(data.type==='samples'){
          if(data.offset!==frames||data.left.length!==data.right.length||frames+data.left.length>storage.maxFrames){fail(new Error('Audio capture lost a buffer. The incomplete take was not saved.'));return;}
          frames+=data.left.length;onLevel(data.peak,frames/48000);
          writes=writes.then(async()=>{if(finished)return;await storage.append(data);if(!finished)node.port.postMessage({type:'ack'});}).catch(fail);
        }else if(data.type==='stopped'){
          if(data.frames!==frames||data.sampleRate!==48000){fail(new Error('Audio capture duration did not verify.'));return;}
          writes=writes.then(async()=>{
            if(finished)return;
            const result=await storage.finish(frames);
            if(finished){await result.release();return;}
            finished=true;recorder.state='inactive';dispose();
            onstop({...result,numberOfChannels:2,sampleRate:48000,length:frames,duration:frames/48000,gapFrames:data.gapFrames,inputEnded,startFrame:data.startFrame,scheduledEndFrame:data.scheduledEndFrame});
          }).catch(fail);
        }
      };
      input=ctx.createMediaStreamSource(stream);input.connect(node);node.connect(ctx.destination);await ctx.resume();
      for(const track of stream.getAudioTracks()){
        if(track.readyState==='ended')throw new Error('Audio input disconnected before recording started.');
        track.addEventListener('ended',()=>{inputEnded=true;recorder.stop();},{once:true});
      }
      return recorder;
    }catch(e){storage?.abort();dispose();throw e;}
  }
  function timing(p,startBeat,duration,offsetMs=0){
    if(!Number.isFinite(offsetMs)||Math.abs(offsetMs)>500)throw new Error('Timing offset must be between -500 and 500 ms.');
    if(!Number.isFinite(duration)||duration<=0)throw new Error('Recording duration must be positive.');
    const map=window.AxiomStudioDaw.compileTempoMap(p),shifted=map.beatToSeconds(startBeat)+offsetMs/1000,start=Math.max(0,shifted),trimSeconds=Math.max(0,-shifted);
    if(duration-trimSeconds<1/48000)throw new Error('Timing offset places the entire take before the project.');
    startBeat=map.secondsToBeat(start);
    const endBeat=map.secondsToBeat(shifted+duration);
    const beats=[startBeat,endBeat,...map.segments.map(s=>s.beat).filter(b=>b>startBeat&&b<endBeat)];
    const step=Math.max(1/16,(endBeat-startBeat)/Math.max(1,16000-beats.length));
    for(let b=startBeat+step;b<endBeat;b+=step)beats.push(b);
    const anchors=[...new Set(beats)].sort((a,b)=>a-b).map(b=>({beat:b-startBeat,seconds:map.beatToSeconds(b)-shifted}));
    if(trimSeconds)anchors.unshift({beat:-trimSeconds*map.bpmAtBeat(0)/60,seconds:0});
    return {startBeat,trimSeconds,durationBeats:endBeat-startBeat,anchors};
  }
  function open(options={}){
    if(closeActive)return;
    const p=window.AxiomStudioDaw.activeProject;if(!p)return;
    window.AxiomArrangement.stop();window.AxiomBeatPreview?.stop();window.AxiomStems?.stop();window.stopAxiomAudioPlayback?.('record-input');
    const version=()=>JSON.stringify(window.AxiomStudioDaw.compileTempoMap(p).segments);
    const startBeat=Math.max(0,p.editCursorBeat||0),snapshot=version(),dialog=document.createElement('dialog');dialog.className='daw-fx-dialog';dialog.id='daw-record-dialog';
    dialog.innerHTML='<h2>Record DJ Audio</h2><p>Capture scratches or a mix into the Recordings layer.</p><label>Audio input <select data-input-device aria-label="Recording audio input"><option value="">Choose controller or mixer</option></select></label><label>USB channels <select data-input-channels aria-label="Recording USB channels"><option value="0">1 / 2</option><option value="2">3 / 4</option><option value="4">5 / 6</option><option value="6">7 / 8</option><option value="8">9 / 10</option><option value="10">11 / 12</option><option value="12">13 / 14</option><option value="14">15 / 16</option></select></label><button type="button" data-enable-inputs>Find audio inputs</button><p data-input-help>Choose your controller or mixer and the USB pair carrying MIX (REC OUT). Listen through your DJ hardware.</p><label><input type="checkbox" data-play-project> Play project</label><p>Monitoring off · Up to 2 hours per take, subject to free storage.</p><label>Input level <meter data-input-level min="0" max="1" value="0" aria-label="Recording input level"></meter></label><output role="status">Ready</output><audio controls preload="metadata" aria-label="Recorded take preview" hidden style="width:100%;max-width:100%;margin-top:12px"></audio><footer><button data-discard>Discard</button><button data-retake hidden title="Discard this take and record again">Retake</button><button data-action>Record</button></footer>';
    const status=dialog.querySelector('output'),action=dialog.querySelector('[data-action]');
    const timingLabel=document.createElement('label');timingLabel.textContent='Timing offset (ms) ';
    const offset=document.createElement('input');offset.type='number';offset.min='-500';offset.max='500';offset.step='0.1';offset.value='0';offset.title='Negative moves the take earlier; positive moves it later.';
    timingLabel.append(offset);status.before(timingLabel);
    let stream,recorder,overdub,limit,token=0,wav=null,duration=0,closed=false,captureInfo=null,previewURL=null,releaseTake=null;
    const preview=dialog.querySelector('audio'),retake=dialog.querySelector('[data-retake]'),playerVolume=document.getElementById('ap-volume');preview.style.colorScheme='dark';
    const previewVolume=()=>{const value=Number(playerVolume?.value??1);preview.volume=Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;};
    previewVolume();playerVolume?.addEventListener('input',previewVolume);
    const clearPreview=()=>{releaseTake?.();releaseTake=null;preview.pause();preview.removeAttribute('src');preview.load();preview.hidden=true;if(previewURL)URL.revokeObjectURL(previewURL);previewURL=null;};
    preview.onerror=()=>{if(!closed&&wav)status.textContent='Take preview could not play. The take is still available to save.';};
    function placement(){if(!offset.value.trim())throw new Error('Enter a timing offset in milliseconds.');return timing(p,startBeat,duration,Number(offset.value));}
    function review(){
      if(!wav||closed)return;
      try{const t=placement();action.disabled=false;status.textContent=duration.toFixed(2)+' seconds / Bar '+(t.startBeat/4+1).toFixed(4)+(t.trimSeconds?' / '+(t.trimSeconds*1000).toFixed(1)+' ms before project':'')+(captureInfo.inputEnded?' / Input ended':'')+(captureInfo.gapFrames?' / Input gap: '+(captureInfo.gapFrames/48).toFixed(1)+' ms':'');}
      catch(error){action.disabled=true;status.textContent=error.message;}
    }
    offset.oninput=review;
    const playProject=dialog.querySelector('[data-play-project]');
    const inputSelect=dialog.querySelector('[data-input-device]'),channels=dialog.querySelector('[data-input-channels]'),inputHelp=dialog.querySelector('[data-input-help]'),meter=dialog.querySelector('[data-input-level]');let listing=0;
    const routing=()=>{
      const label=inputSelect.selectedOptions[0]?.textContent||'';
      if(/REV.?7/i.test(label)){channels.value='4';inputHelp.textContent='DDJ-REV7: route USB 5/6 to MIX (REC OUT) in Pioneer Setting Utility, then select 5 / 6 here.';}
      else if(/900.*NXS2/i.test(label)){channels.value='8';inputHelp.textContent='DJM-900NXS2: choose the USB pair assigned to MIX (REC OUT) in Pioneer Setting Utility. 9 / 10 is the usual record pair. Keep any DVS control-tone pairs unchanged.';}
      else{channels.value='0';inputHelp.textContent='Choose the USB pair carrying your mixer record output. A microphone input records the room, not the DJ mix.';}
      if(preferredPairs.has(inputSelect.value))channels.value=preferredPairs.get(inputSelect.value);
    };
    if(preferredInput){inputSelect.add(new Option('Selected input',preferredInput));inputSelect.value=preferredInput;}
    async function refreshDevices(){
      const version=++listing;
      try{
        const devices=await navigator.mediaDevices?.enumerateDevices();if(closed||version!==listing||inputSelect.disabled||!devices)return;
        const selected=preferredInput,oldLabel=inputSelect.selectedOptions[0]?.textContent||'Selected input';
        inputSelect.replaceChildren(new Option('Choose controller or mixer',''));
        for(const device of devices.filter(d=>d.kind==='audioinput'&&d.deviceId&&!['default','communications'].includes(d.deviceId)))inputSelect.add(new Option(device.label||'Audio input '+inputSelect.options.length,device.deviceId));
        if(selected&&![...inputSelect.options].some(o=>o.value===selected))inputSelect.add(new Option(oldLabel+' (unavailable)',selected));
        inputSelect.value=selected;
        routing();
      }catch(e){if(!closed&&!inputSelect.disabled)status.textContent='Input list unavailable: '+e.message;}
    }
    inputSelect.onchange=()=>{preferredInput=inputSelect.value;routing();};
    channels.onchange=()=>{if(inputSelect.value)preferredPairs.set(inputSelect.value,channels.value);};
    const enableInputs=dialog.querySelector('[data-enable-inputs]');
    enableInputs.onclick=async()=>{
      if(recorder?.state==='recording'||closed)return;
      enableInputs.disabled=true;action.disabled=true;status.textContent='Allow audio-input access to list your controller or mixer.';
      let permissionStream;
      try{
        permissionStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
        permissionStream.getTracks().forEach(track=>track.stop());permissionStream=null;
        if(closed)return;
        await refreshDevices();status.textContent='Choose your controller or mixer and its record-output USB pair.';
      }catch(error){if(!closed)status.textContent='Audio-input access failed: '+error.message;}
      finally{permissionStream?.getTracks().forEach(track=>track.stop());if(!closed){enableInputs.disabled=false;action.disabled=Boolean(wav);}}
    };
    navigator.mediaDevices?.addEventListener('devicechange',refreshDevices);
    const release=()=>{clearTimeout(limit);stream?.getTracks().forEach(t=>t.stop());};
    const close=()=>{closed=true;token++;overdub?.cancel();recorder?.abort();release();clearPreview();wav=null;playerVolume?.removeEventListener('input',previewVolume);navigator.mediaDevices?.removeEventListener('devicechange',refreshDevices);closeActive=null;dialog.remove();};
    retake.onclick=()=>{if(!wav||retake.disabled||closed)return;clearPreview();wav=null;duration=0;captureInfo=null;recorder=null;overdub=null;retake.hidden=true;offset.disabled=false;action.textContent='Record';action.disabled=false;action.click();};
    closeActive=close;dialog.querySelector('[data-discard]').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
    action.onclick=async()=>{
      if(recorder?.state==='recording'){action.disabled=true;recorder.stop();return;}
      const current=++token;
      if(wav){
        preview.pause();retake.disabled=true;action.disabled=true;offset.disabled=true;status.textContent='Saving take...';
        try{
          if(p!==window.AxiomStudioDaw.activeProject||version()!==snapshot)throw new Error('Project or tempo changed. Restore it to save this take at its original position.');
          const t=placement(),timingOffsetMs=Number(offset.value);
          const form=new FormData();form.append('file',wav,'Take '+new Date().toISOString().replace(/[:.]/g,'-')+'.wav');
          form.append('axiom_generated','1');
          const response=await fetch('/api/studio-daw/import?recording=1',{method:'POST',body:form}),data=await response.json();if(!response.ok)throw new Error(data.error||'Take could not be saved.');
          if(!data.track?.path)throw new Error('Recording storage is unavailable on this surface. The take remains in this dialog; it has not been added to the project.');
          if(closed||current!==token)return;
          if(p!==window.AxiomStudioDaw.activeProject||version()!==snapshot)throw new Error('Project or tempo changed during save. The take has not been placed.');
          const layer=1+Math.max(-1,...p.arrangementClips.filter(c=>c.sectionId==='recordings').map(c=>c.layerIndex||0));
          t.capture={...captureInfo,timingOffsetMs,requestedStartBeat:startBeat,sourceTrimSeconds:t.trimSeconds};
          data.track.bpm=window.AxiomStudioDaw.compileTempoMap(p).bpmAtBeat(t.startBeat);
          window.AxiomStudioDaw.addTrackToProject(data.track,{placement:{sectionId:'recordings',beat:t.startBeat,layerIndex:layer},recording:t});
          if(!p.arrangementClips.some(c=>c.path===data.track.path&&c.recorded))throw new Error('Take could not be placed.');
          window.AxiomDawDrafts?.checkpoint();close();
          if(data.storage==='browser')window.showToast?.('Take saved in this browser. Clearing site data removes its audio.');
        }catch(e){if(!closed){status.textContent=e.message;action.disabled=false;offset.disabled=false;retake.disabled=false;}}
        return;
      }
      if(!inputSelect.value){status.textContent='Choose your controller or mixer first. Use Find audio inputs if device names are hidden.';return;}
      action.disabled=true;enableInputs.disabled=true;inputSelect.disabled=true;channels.disabled=true;playProject.disabled=true;status.textContent='Requesting audio input...';
      try{
        if(p!==window.AxiomStudioDaw.activeProject||version()!==snapshot)throw new Error('Project or tempo changed. Reopen recording at the intended position.');
        if(!navigator.mediaDevices?.getUserMedia||!window.AudioWorkletNode)throw new Error('PCM input recording is unavailable in this browser.');
        const deviceId=inputSelect.value;
        stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:{ideal:32},echoCancellation:false,noiseSuppression:false,autoGainControl:false,...(deviceId?{deviceId:{exact:deviceId}}:{})},video:false});
        if(closed||current!==token){release();return;}
        const inputTrack=stream.getAudioTracks()[0],inputSettings=inputTrack.getSettings(),channelOffset=Number(channels.value);
        if(!Number.isInteger(channelOffset)||channelOffset<0||channelOffset>14||channelOffset%2)throw new Error('Choose a stereo USB channel pair.');
        if(channelOffset>0&&Number.isFinite(inputSettings.channelCount)&&inputSettings.channelCount<channelOffset+2)throw new Error('This audio input does not expose that USB pair. Check Pioneer routing or use a stereo record-output input.');
        const prepare=async ctx=>{
        recorder=await capture(stream,async audio=>{
          overdub?.stop();release();if(closed||current!==token){audio.release?.();return;}
          releaseTake=audio.release;
          action.disabled=true;status.textContent='Preparing take...';
          try{
            duration=audio.duration;if(duration<.05||duration>7200)throw new Error('Takes must be between 0.05 seconds and two hours.');
            captureInfo={engine:'audio-worklet',sampleRate:audio.sampleRate,frames:audio.length,gapFrames:audio.gapFrames,inputEnded:audio.inputEnded,inputLabel:inputTrack.label,inputSampleRate:inputSettings.sampleRate,inputChannels:inputSettings.channelCount,channelOffset,overdub:Boolean(ctx),startFrame:audio.startFrame,scheduledEndFrame:audio.scheduledEndFrame,hardwareLatencyCalibrated:false};
            wav=audio.file;previewURL=URL.createObjectURL(wav);preview.src=previewURL;preview.hidden=false;retake.hidden=false;retake.disabled=false;
            action.textContent='Save Take';review();
          }catch(e){if(!closed){status.textContent=e.message;action.disabled=true;}}
        },error=>{overdub?.cancel();release();if(!closed){status.textContent=error.message;action.disabled=true;}},ctx,channelOffset,(peak,seconds)=>{if(closed||current!==token)return;meter.value=Math.min(1,peak||0);status.textContent='Recording '+Math.floor(seconds/60)+':'+String(Math.floor(seconds%60)).padStart(2,'0')+' / '+(inputTrack.label||'Audio input')+(peak>=1?' / Clipping: lower the mixer record level':peak<.00001?' / No signal: check the record-output routing':'');});
        return recorder;
        };
        if(playProject.checked){
          status.textContent='Preparing project playback...';
          overdub=window.AxiomArrangement.record(p,window.AxiomStudioDaw.compileTempoMap(p).beatToSeconds(startBeat),prepare);
          if(!await overdub.ready)throw new Error('Recording preparation was cancelled.');
        }else await prepare(null);
        if(closed||current!==token){recorder.abort();release();return;}
        action.textContent='Stop';action.disabled=false;status.textContent='Recording / '+(inputTrack.label||'Audio input')+' / Monitoring off';limit=setTimeout(()=>recorder.stop(),(recorder.maxSeconds+5)*1000);
      }catch(e){overdub?.cancel();recorder?.abort();release();if(!closed){status.textContent=e.message;action.disabled=false;inputSelect.disabled=false;channels.disabled=false;playProject.disabled=false;enableInputs.disabled=false;action.textContent='Record';refreshDevices();}}
    };
    if(options.setup){
      dialog.querySelector('h2').textContent='Recording Input';
      dialog.querySelector('p').textContent='Choose the source for your next timeline take.';
      dialog.querySelector('[data-discard]').textContent='Cancel';
      playProject.checked=options.settings?.playProject!==false;
      offset.value=String(options.settings?.offsetMs||0);
      dialog.querySelector('[data-input-level]').closest('label').hidden=true;
      action.textContent='Use Input';
      action.onclick=()=>{
        if(!inputSelect.value){status.textContent='Choose an audio input first.';return;}
        const offsetMs=Number(offset.value),channelOffset=Number(channels.value);
        if(!offset.value.trim()||!Number.isFinite(offsetMs)||Math.abs(offsetMs)>500){status.textContent='Timing offset must be between -500 and 500 ms.';return;}
        if(!Number.isInteger(channelOffset)||channelOffset<0||channelOffset>14||channelOffset%2){status.textContent='Choose a valid USB channel pair.';return;}
        const settings={deviceId:inputSelect.value,label:inputSelect.selectedOptions[0]?.textContent||'Audio input',channelOffset,offsetMs,playProject:playProject.checked};
        preferredInput=settings.deviceId;preferredPairs.set(settings.deviceId,String(channelOffset));
        close();options.onSetup?.(settings);
      };
    }
    document.body.append(dialog);dialog.showModal();refreshDevices();
  }
  window.addEventListener('pagehide',()=>closeActive?.());
  window.AxiomDawRecording={open,timing,capture};
})();
