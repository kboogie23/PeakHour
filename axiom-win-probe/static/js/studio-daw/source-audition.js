(function(){
  'use strict';
  // Source audition is independent of arrangement timing, trim and effects.
  // Keep one bounded decoded source; long files use the existing media stream.
  let context,master,cache,session,timer;
  const voices=new Set();
  const volume=()=>Math.max(0,Math.min(1,Number(document.getElementById('ap-volume')?.value??1)))*.7;
  function status(text=''){
    const out=document.querySelector('.daw-source-audition-status');if(out)out.textContent=text;
    const button=document.querySelector('.daw-source-audition');
    if(button){button.textContent=session?.mode==='play'?'Stop Original':'Original Cue';button.setAttribute('aria-pressed',String(session?.mode==='play'));}
  }
  function current(s){return session===s&&s.project===window.AxiomStudioDaw.activeProject&&(!s.project.arrangementClips||s.project.arrangementClips.includes(s.clip))&&!document.hidden;}
  function stop(){
    clearInterval(timer);timer=null;
    const previous=session;session=null;clearTimeout(previous?.pause);
    previous?.cancelMetadata?.();
    if(previous?.media){previous.media.pause();previous.media.removeAttribute('src');previous.media.load();}
    for(const voice of voices){
      try{
        const gain=voice.cueGain.gain,now=context.currentTime;
        if(gain.cancelAndHoldAtTime)gain.cancelAndHoldAtTime(now);
        else{gain.cancelScheduledValues(now);gain.setValueAtTime(gain.value,now);}
        gain.linearRampToValueAtTime(0,now+.006);voice.stop(now+.006);
      }catch{try{voice.stop();}catch{}}
    }voices.clear();
    status();
  }
  async function decoded(clip){
    if(cache?.path===clip.path)return cache.task;
    const owned={path:clip.path};cache=owned;
    owned.task=(async()=>{
      if(Number(clip.durationSec||clip.duration_sec||clip.duration)>600)return null;
      const response=await fetch(`/api/library/stream?path=${encodeURIComponent(clip.path)}`);
      if(!response.ok)throw new Error(`Source audio unavailable (${response.status}).`);
      if(Number(response.headers.get('content-length'))>96*1024*1024){await response.body?.cancel();return null;}
      const bytes=await response.arrayBuffer();if(bytes.byteLength>96*1024*1024)return null;
      if(cache!==owned)return null;
      const decoder=new (window.OfflineAudioContext||window.webkitOfflineAudioContext)(2,1,22050);
      let audio;
      try{audio=await decoder.decodeAudioData(bytes);}
      catch{
        const {nativeWaveform}=await import('./native-waveform.mjs');
        audio=await nativeWaveform(clip.path,decoder,{current:()=>cache===owned});
      }
      if(audio.duration>600)return null;
      return audio;
    })().catch(error=>{if(cache===owned)cache=null;throw error;});
    return owned.task;
  }
  function grain(s,seconds,duration=.08){
    if(!current(s)||!s.audio)return;
    const offset=Math.max(0,Math.min(s.audio.duration,seconds)),length=Math.min(duration,s.audio.duration-offset);
    if(length<=.001)return;
    const node=context.createBufferSource(),gain=context.createGain(),now=context.currentTime;
    node.buffer=s.audio;node.cueGain=gain;node.connect(gain);gain.connect(master);
    const fade=Math.min(duration<=.08?.04:.008,length/2);
    gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(1,now+fade);
    gain.gain.setValueAtTime(1,now+length-fade);gain.gain.linearRampToValueAtTime(0,now+length);
    voices.add(node);node.onended=()=>{voices.delete(node);node.disconnect();gain.disconnect();};
    node.start(now,offset,length);
    return node;
  }
  function tick(s){
    if(session!==s)return;
    if(!current(s)||!document.body.classList.contains('studio-daw-mode-active')){stop();return;}
    if(master)master.gain.value=volume();
    if(s.media)s.media.volume=volume();
    if(s.mode==='play'){
      if(s.ready)status('Original timing');
      if(s.started!==undefined){const seconds=s.media?s.media.currentTime:s.latest+context.currentTime-s.started;window.AxiomStudioDaw.paintSourcePlayback?.(s.clip,seconds);}
      return;
    }
    // One short, faded audition per fresh pointer position. Do not loop a
    // stationary grain or play queued positions after the pointer is released.
    if(!s.ready||s.latest===s.heard)return;
    s.heard=s.latest;
    if(s.audio)grain(s,s.latest);
    else if(s.media&&!s.media.seeking){
      s.media.currentTime=Math.max(0,Math.min(s.media.duration||Infinity,s.latest));
      s.media.volume=volume();s.media.play().catch(error=>{if(current(s)){stop();status(error.message||'Source audition could not play.');}});
      clearTimeout(s.pause);s.pause=setTimeout(()=>{if(current(s)&&s.mode==='scrub')s.media.pause();},120);
    }else s.heard=null;
  }
  function begin(project,clip,mode='scrub'){
    stop();window.AxiomArrangement?.stop(false);window.AxiomBeatPreview?.stop();window.AxiomStems?.stop();
    window.stopAxiomAudioPlayback?.('source_audition');
    const s={project,clip,mode,latest:0,heard:null,ready:false};session=s;
    status('Preparing cue audio…');
    try{
      if(!context){context=new (window.AudioContext||window.webkitAudioContext)();master=context.createGain();master.connect(context.destination);}
      master.gain.value=volume();
      const resumed=context.resume();
      s.task=(async()=>{
        await resumed;const audio=await decoded(clip);if(!current(s))return;
        s.audio=audio;
        if(!audio){
          const media=new Audio();s.media=media;media.preload='auto';
          await new Promise((resolve,reject)=>{
            const finish=error=>{clearTimeout(timeout);s.cancelMetadata=null;media.onloadedmetadata=media.onerror=null;error?reject(error):resolve();};
            const timeout=setTimeout(()=>finish(new Error('Source audition timed out.')),15000);
            s.cancelMetadata=()=>finish();
            media.onloadedmetadata=()=>finish();
            media.onerror=()=>finish(new Error('This source cannot be auditioned by the audio preview.'));
            media.src=`/api/library/stream?path=${encodeURIComponent(clip.path)}`;
          });
        }
        if(!current(s))return;
        s.ready=true;status(mode==='play'?'Original timing':'Scrubbing source');tick(s);
      })().catch(error=>{if(current(s)){stop();status(error.message);}});
      timer=setInterval(()=>tick(s),40);
    }catch(error){stop();status(error.message);}
    return s;
  }
  function scrub(seconds){if(session?.mode==='scrub')session.latest=Math.max(0,seconds);}
  async function toggle(project,clip,seconds){
    if(session?.mode==='play'){stop();return false;}
    const s=begin(project,clip,'play');s.latest=seconds;
    await s.task;if(!current(s)||!s.ready)return false;
    s.started=context.currentTime;
    if(s.audio){
      const remaining=s.audio.duration-seconds;if(remaining<=0){stop();return false;}
      const node=grain(s,seconds,remaining);
      if(!node){stop();return false;}
      const ended=node.onended;
      node.onended=()=>{ended();if(current(s))stop();};
    }else{
      s.media.volume=volume();s.media.currentTime=Math.max(0,Math.min(s.media.duration,seconds));
      s.media.onended=()=>{if(current(s))stop();};
      try{await s.media.play();}catch(error){if(current(s)){stop();status(error.message);}return false;}
    }
    return true;
  }
  for(const name of ['blur','pagehide'])window.addEventListener(name,stop);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  window.AxiomSourceAudition={begin,scrub,toggle,stop,get playing(){return session?.mode==='play';}};
})();
