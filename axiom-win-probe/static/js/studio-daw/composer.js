(async function () {
  'use strict';
  const shell = document.getElementById('studio-daw-shell');
  if (!shell) return;
  // Older running Flask instances may still serve the cached pre-history template.
  if(!window.AxiomMixerHistory){
    try {await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/static/js/studio-daw/mixer-history.js?v=1';script.onload=resolve;script.onerror=reject;document.head.appendChild(script);});}
    catch {window.showToast?.('Mixer controls could not load. Reload the local review when your draft is saved.',true);return;}
  }
  const {WaveformCache}=await import('./waveform-cache.mjs');
  const {masterWaveform,waveformColor}=await import('./master-waveform.mjs');
  const cache = new WaveformCache();
  window.AxiomWaveformDetail=Object.freeze({duration:path=>cache.get(path,true)?.duration,refresh:refreshWaveforms,renderCanvas:renderWave,findPeak(path,start,end){
    const data=cache.get(path,true);
    if(!data)throw new Error('Wait for the source waveform to load, then try Find Peak again.');
    if(data.error)throw new Error(data.error);
    return window.AxiomStudioDaw.waveformPeakTime(data,start,end);
  },stats:()=>({...cache.stats(),decoding,queued:queued.length,decodeCount,nativeFallbackCount})});
  const pending = new Set();
  const queued = [];
  let decoding = false;
  let decodeCount = 0;
  let nativeFallbackCount = 0;
  let drainTimer = 0;
  let refreshFrame = 0;
  let referenceLoaded = false;
  let beatContext, beatTimer, beatProject, beatStep = 0, nextBeatTime = 0, beatGeneration = 0;
  const sampleBanks = new WeakMap();
  const beatSources = new Set();
  let beatMonitor=null,beatLoading=false;
  function stopBeatPreview() {
    beatGeneration++;
    clearInterval(beatTimer); beatTimer = null;
    beatLoading=false;
    beatMonitor?.stop();beatMonitor=null;
    beatSources.forEach(source=>{try {source.stop();} catch (_) {}});
    beatSources.clear();
    shell.querySelector('[aria-label="Play beat preview"]')?.setAttribute('aria-pressed','false');
  }
  function sampleBank(project) {
    if (!sampleBanks.has(project)) sampleBanks.set(project,new Map());
    return sampleBanks.get(project);
  }
  function previewBpm(project) {
    return window.AxiomStudioDaw.compileTempoMap(project).bpmAtBeat(project.editCursorBeat || 0);
  }
  async function prepareSamples(project){
    const bank=sampleBank(project);
    for(const [row,sample] of bank)if(project.drumSamples?.[row]?.path!==sample.path)bank.delete(row);
    if(!Object.keys(project.drumSamples||{}).length)return;
    beatContext ||= new AudioContext({sampleRate:48000});
    for(const [row,sample] of Object.entries(project.drumSamples||{})){
      if(bank.get(row)?.path===sample.path)continue;
      const response=await fetch(`/api/library/stream?path=${encodeURIComponent(sample.path)}`);
      if(!response.ok)throw new Error(`Drum sample unavailable: ${sample.name||row}`);
      const buffer=await beatContext.decodeAudioData(await response.arrayBuffer());
      if(buffer.duration>30)throw new Error('Stored drum sample exceeds 30 seconds.');
      if(project.drumSamples[row]!==sample)throw new Error('Drum sample changed during loading. Play again.');
      bank.set(row,{buffer,name:sample.name,path:sample.path});
    }
  }
  async function playBeatPreview() {
    stopBeatPreview();
    const generation=beatGeneration;
    const project = window.AxiomStudioDaw.activeProject;
    if (!project) return;
    beatLoading=true;
    try {
      if(window.AxiomPatterns&&!window.AxiomPatterns.active(project)&&!window.AxiomPatternMonitor?.enabled)throw new Error('Add a pattern before previewing drums.');
      window.AxiomArrangement?.stop(false);
      await prepareSamples(project);
      if(generation!==beatGeneration||project!==window.AxiomStudioDaw.activeProject)return;
      if(!sampleBank(project).size&&!window.AxiomPatternMonitor?.enabled)throw new Error('Load a sample using a drum row first.');
      beatContext ||= new AudioContext({sampleRate:48000});
      if(beatContext.audioWorklet&&window.AxiomPcmSource?.enabled)await window.AxiomPcmSource.prepare(beatContext);
      await beatContext.resume();
      if(generation!==beatGeneration||project!==window.AxiomStudioDaw.activeProject)return;
      beatProject = project; beatStep = 0; nextBeatTime = beatContext.currentTime + .06;
      const patternId=window.AxiomPatterns?.active(project)?.id,spans=[];
      let previewBeat=0;
      beatMonitor=window.AxiomPatternMonitor?.start(beatContext,project,{segments:()=>spans,previewPatternId:patternId||'empty-preview',valid:()=>generation===beatGeneration&&!shell.classList.contains('hidden')&&window.AxiomStudioDaw.activeProject===project});
      const tick = () => {
        if (shell.classList.contains('hidden') || window.AxiomStudioDaw.activeProject !== beatProject) {stopBeatPreview(); return;}
        if (nextBeatTime < beatContext.currentTime) nextBeatTime = beatContext.currentTime + .03;
        while (nextBeatTime < beatContext.currentTime + .12) {
          const current=window.AxiomPatterns?.active(project);
          if(current?.id!==patternId){stopBeatPreview();return;}
          const beatSeconds=60/previewBpm(project),span=(current?.lengthBeats||16)/(current?.stepCount||64);
          spans.push({base:nextBeatTime,from:previewBeat*beatSeconds,to:(previewBeat+span)*beatSeconds,clock:{secondsToBeat:seconds=>seconds/beatSeconds,beatToSeconds:beat=>beat*beatSeconds}});
          sampleBank(project).forEach((sample,row)=>{
            const pattern=window.AxiomPatterns?.active(project);
            const hit = pattern?window.AxiomPatterns.stepHit(pattern,row,beatStep):[...shell.querySelectorAll('.studio-daw-step-cell.hit')].some(cell=>cell.dataset.hit===row && Number(cell.dataset.step)===beatStep%64+1);
            if (!hit) return;
            const timing={when:nextBeatTime+(hit.delay||0)*60/previewBpm(project),offset:0,duration:sample.buffer.duration};
            const protectedVoice=Boolean(beatContext.audioWorklet&&window.AxiomPcmSource?.enabled&&window.AxiomPcmSource.canPlayVoice(beatContext,sample.buffer,timing));
            const source=protectedVoice?window.AxiomPcmSource.createVoice(beatContext,sample.buffer,timing):beatContext.createBufferSource();
            if(!protectedVoice)source.buffer=sample.buffer;
            else source.onprocessorerror=()=>{if(generation===beatGeneration){stopBeatPreview();showToast('Beat preview processing failed. Press Play to retry.',true);}};
            const gain = beatContext.createGain(); gain.gain.value = .35*(hit.velocity??1)*Number(document.getElementById('ap-volume')?.value ?? 1);
            source.connect(gain).connect(beatContext.destination);
            beatSources.add(source);
            source.onended=()=>{beatSources.delete(source);source.disconnect();gain.disconnect();};
            if(!protectedVoice)source.start(timing.when);
          });
          nextBeatTime += beatSeconds*span;previewBeat+=span;
          beatStep++;
        }
        while(spans.length&&spans[0].base+spans[0].to-spans[0].from<beatContext.currentTime-.1)spans.shift();
        beatMonitor?.pump();
      };
      beatLoading=false;beatTimer = setInterval(tick,25); tick();
      shell.querySelector('[aria-label="Play beat preview"]')?.setAttribute('aria-pressed','true');
    } catch(error) { if(generation===beatGeneration){stopBeatPreview();showToast(`Beat preview unavailable: ${error.message}`,true);} }
  }
  async function importSample(file,{signal}={}){
    if(file.size>5*1024*1024)throw new Error('Choose a one-shot sample smaller than 5 MB.');
    beatContext ||= new AudioContext({sampleRate:48000});
    const buffer=await beatContext.decodeAudioData(await file.arrayBuffer());
    if(buffer.duration>30)throw new Error('Use a sample shorter than 30 seconds.');
    const form=new FormData();form.append('file',file);
    const response=await fetch('/api/studio-daw/import',{method:'POST',body:form,signal}),data=await response.json();
    if(!response.ok||!data.track?.path)throw new Error(data.error||'Sample could not be stored.');
    return {track:data.track,buffer};
  }
  function rememberSamples(project,entries){
    for(const {row,track,name,buffer} of entries)sampleBank(project).set(row,{path:track.path,name,buffer});
  }
  function assignSamples(project,entries){
    if(project!==window.AxiomStudioDaw.activeProject)return false;
    const samples={...project.drumSamples};
    for(const {row,track,name} of entries)samples[row]={path:track.path,name,assetIdentity:track.assetIdentity};
    if(!window.AxiomStudioDaw.setDrumSamples(samples))return false;
    rememberSamples(project,entries);
    window.AxiomDawDrafts?.checkpoint();return true;
  }
  async function playPad(row){
    const p=window.AxiomStudioDaw.activeProject;if(!p?.drumSamples?.[row])return false;
    const generation=beatGeneration;
    try{await prepareSamples(p);if(generation!==beatGeneration||p!==window.AxiomStudioDaw.activeProject)return false;
      await beatContext.resume();const sample=sampleBank(p).get(row);if(!sample)return false;
      const source=beatContext.createBufferSource(),gain=beatContext.createGain();source.buffer=sample.buffer;gain.gain.value=.7*Number(document.getElementById('ap-volume')?.value??1);
      source.connect(gain).connect(beatContext.destination);beatSources.add(source);source.onended=()=>{beatSources.delete(source);source.disconnect();gain.disconnect();};source.start(beatContext.currentTime+.005);return true;
    }catch(error){showToast('Pad unavailable: '+error.message,true);return false;}
  }
  function loadBeatSample(row) {
    const project = window.AxiomStudioDaw.activeProject;
    const input = document.createElement('input'); input.type='file'; input.accept='audio/*';
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      try {
        const sample=await importSample(file);
        if(!assignSamples(project,[{row,...sample,name:file.name}]))throw new Error('Project changed while loading the sample.');
        showToast(`${row}: ${file.name}`);
      } catch(error) {showToast(`Sample could not load: ${error.message}`,true);}
    };
    input.click();
  }
  function scheduleArrangement(ctx,destination,project,origin,from,end,own,trackVoice=null,makeSource=null) {
    const clock=window.AxiomStudioDaw.compileTempoMap(project);
    const voice=(sample,when,velocity)=>{
      const source=makeSource?makeSource(sample.buffer,when,0,sample.buffer.duration):own(ctx.createBufferSource());
      const gain=own(ctx.createGain());gain.gain.value=.35*velocity;source.connect(gain).connect(destination);
      if(!makeSource){source.buffer=sample.buffer;source.start(when);}
      trackVoice?.(source,gain,when+sample.buffer.duration);
    };
    if(window.AxiomPatterns){
      for(const hit of window.AxiomPatterns.hits(project,clock.secondsToBeat(from),clock.secondsToBeat(end))){
        const sample=sampleBank(project).get(hit.row);if(!sample)continue;
        voice(sample,origin+clock.beatToSeconds(hit.beat),hit.velocity);
      }
      return;
    }
    const defaults={Kick:[1,17,33,49],Snare:[17,49],Hats:Array.from({length:32},(_,i)=>i*2+1),'One Shot':[45],'Vocal Chop':[25,57],Perc:[9,29,41,61]};
    const startStep=Math.ceil(clock.secondsToBeat(from)*16-1e-8),lastStep=Math.ceil(clock.secondsToBeat(end)*16-1e-8);
    if(lastStep-startStep>500000) throw new Error('Pattern exceeds the current scheduler limit.');
    for(let step=startStep;step<lastStep;step++) sampleBank(project).forEach((sample,row)=>{
      if(!(project.stepPattern?.[row] || defaults[row] || []).includes(step%64+1)) return;
      voice(sample,origin+clock.beatToSeconds(step/16),1);
    });
  }
  window.AxiomBeatPreview = Object.freeze({play:playBeatPreview,stop:stopBeatPreview,load:loadBeatSample,importSample,playPad,assignSamples,rememberSamples,prepare:prepareSamples,scheduleArrangement,hasSamples:p=>Object.keys(p.drumSamples||{}).length>0,get playing(){return beatLoading||beatTimer!==null&&beatTimer!==undefined;}});
  window.addEventListener('pagehide',stopBeatPreview);

  // Weak data IDs let evicted peak arrays go without invalidating unchanged canvas pixels.
  const paintedWaves=new WeakMap(),waveVersions=new WeakMap();let waveVersion=0;
  const stemWaveColors = ['#ff5fa8', '#36d6ff', '#a3ff00', '#9a6cff'];
  function stemMix(canvas) {
    if (!canvas.dataset.waveStemMix) return null;
    try {
      const values = JSON.parse(canvas.dataset.waveStemMix);
      return Array.isArray(values) && values.length ? values.map(value => Math.max(0, Math.min(2, Number(value) || 0))) : null;
    } catch {
      return null;
    }
  }
  function paintStemWave(ctx, canvas, data, indexAt, width, height, mix) {
    const total = Math.max(0.01, mix.reduce((sum, value) => sum + value, 0));
    const enabled = mix.map(value => Math.max(0, Math.min(1.18, value / Math.max(1, total / mix.length))));
    for (let x = 0; x < width; x++) {
      const from = indexAt(x);
      const to = Math.max(from + 1, indexAt(x + 1));
      let peak = 0;
      for (let p = from; p < Math.min(to, data.peaks.length); p++) peak = Math.max(peak, data.peaks[p]);
      if (!peak) continue;
      const baseHalf = Math.max(0.5, peak * height * .44);
      mix.forEach((value, index) => {
        if (value <= 0.01) return;
        const laneOffset = (index - 1.5) * height * .115;
        const half = Math.max(0.5, baseHalf * (0.22 + enabled[index] * .36));
        ctx.globalAlpha = Math.min(0.95, 0.32 + enabled[index] * .46);
        ctx.fillStyle = stemWaveColors[index] || '#a3ff00';
        ctx.fillRect(x, height / 2 + laneOffset - half, 1, half * 2);
      });
    }
    ctx.globalAlpha = 1;
  }
  function paint(canvas, data) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const nextWidth=Math.ceil(rect.width*ratio),nextHeight=Math.ceil(rect.height*ratio),color=getComputedStyle(canvas).color,stems=stemMix(canvas);
    if(!waveVersions.has(data))waveVersions.set(data,++waveVersion);
    const frequencyColour=Boolean(canvas.closest('.daw-source-detail, #studio-daw-inspector-waveform'));
    const reversed=canvas.dataset.waveReversed==='true';
    const signature=JSON.stringify([waveVersions.get(data),nextWidth,nextHeight,color,canvas.dataset.wavePath,canvas.dataset.waveStart,canvas.dataset.waveDuration,canvas.dataset.waveGrid,canvas.dataset.sourceBeat,canvas.dataset.sourceBeats,canvas.dataset.waveStemMix,canvas.dataset.waveReversed,frequencyColour]);
    if(paintedWaves.get(canvas)===signature&&canvas.width===nextWidth&&canvas.height===nextHeight&&canvas.dataset.waveState==='ready')return;
    canvas.width = nextWidth;
    canvas.height = nextHeight;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.fillStyle = color;
    const start = Number(canvas.dataset.waveStart || 0);
    const duration = Number(canvas.dataset.waveDuration || 0) || data.duration;
    const peakSpan=data.peakSpanSeconds||data.duration;
    const first = Math.floor(start / peakSpan * data.peaks.length);
    const last = Math.min(data.peaks.length, Math.ceil((start + duration) / peakSpan * data.peaks.length));
    let grid=null;
    if(canvas.dataset.waveGrid) {
      try {grid=window.AxiomStudioDaw.compileBeatgrid(JSON.parse(canvas.dataset.waveGrid));} catch {canvas.dataset.waveState='invalid-grid';return;}
    }
    const indexAt=x=>{
      const ratio=reversed?1-x/width:x/width;
      return grid
        ? Math.max(0,Math.min(data.peaks.length,Math.floor(grid.beatToSeconds(Number(canvas.dataset.sourceBeat)+ratio*Number(canvas.dataset.sourceBeats))/peakSpan*data.peaks.length)))
        : first+Math.floor(ratio*(last-first));
    };
    if(stems) {
      paintStemWave(ctx, canvas, data, indexAt, width, height, stems);
      canvas.dataset.waveState='ready';paintedWaves.set(canvas,signature);return;
    }
    if(frequencyColour && data.bands) {
      for(let x=0;x<width;x++) {
        const from=indexAt(x),to=Math.min(data.peaks.length,Math.max(from+1,indexAt(x+1)));
        let peak=0,low=0,mid=0,high=0;
        for(let p=from;p<to;p++){peak=Math.max(peak,data.peaks[p]);low+=data.bands[0][p];mid+=data.bands[1][p];high+=data.bands[2][p];}
        const max=Math.max(low,mid,high,1e-9);
        ctx.fillStyle=`rgb(${Math.round(70+185*low/max)},${Math.round(45+180*mid/max)},${Math.round(45+200*high/max)})`;
        const half=Math.max(.5,peak*height*.46);ctx.fillRect(x,height/2-half,1,half*2);
      }
      canvas.dataset.waveState='ready';paintedWaves.set(canvas,signature);return;
    }
    ctx.beginPath();
    for (let x = 0; x < width; x++) {
      const from = indexAt(x);
      const to = Math.max(from+1,indexAt(x+1));
      let peak = 0;
      for (let p = from; p < Math.min(to, data.peaks.length); p++) peak = Math.max(peak, data.peaks[p]);
      const y = height / 2 - Math.max(0.5, peak * height * .46);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (let x = width - 1; x >= 0; x--) {
      const p = Math.min(data.peaks.length - 1,indexAt(x));
      ctx.lineTo(x, height / 2 + Math.max(.5, (data.peaks[p] || 0) * height * .46));
    }
    ctx.closePath();
    ctx.fill();
    canvas.dataset.waveState = 'ready';
    paintedWaves.set(canvas,signature);
  }

  function refreshWaveforms(paths=null) {
    const wanted=paths==null?null:new Set((Array.isArray(paths)?paths:[paths]).map(String));
    shell.querySelectorAll('canvas[data-wave-path]').forEach(canvas => {
      if(wanted && !wanted.has(String(canvas.dataset.wavePath||'')))return;
      paintedWaves.delete(canvas);
      if(canvas.dataset.waveState==='ready')canvas.dataset.waveState='stale';
      renderWave(canvas);
    });
    paintMaster();
  }

  // Decode one read-only library stream at a time; retain peaks, never PCM buffers.
  function queueWave(path,priority=false) {
    if(pending.has(path)) {
      const index=queued.indexOf(path);
      if(priority&&index>0){queued.splice(index,1);queued.unshift(path);}
      return;
    }
    pending.add(path);if(priority)queued.unshift(path);else queued.push(path);
  }
  function setWaveStatus(canvas, message, error=false, hidden=false) {
    const detail=canvas.closest?.('.daw-source-detail');
    const status=detail?.querySelector?.('[data-waveform-status]');
    if(!status)return;
    status.textContent=message;
    status.hidden=hidden;
    status.classList.toggle('is-error',Boolean(error));
  }
  function renderWave(canvas) {
    const path=canvas.dataset.wavePath,overview=cache.get(path);
    if(!path){canvas.dataset.waveState='unavailable';setWaveStatus(canvas,'Audio source unavailable for this clip.',true);return;}
    if(overview?.duration)window.AxiomSourceBounds?.observe(window.AxiomStudioDaw.activeProject,path,overview.duration);
    const rect=canvas.getBoundingClientRect();
    const detailCanvas=Boolean(canvas.closest('.daw-source-detail'));
    const duration=Number(canvas.dataset.waveDuration)||overview?.duration;
    const detail=detailCanvas||Boolean(overview?.peaks&&duration/overview.duration*overview.peaks.length<rect.width*Math.min(2,window.devicePixelRatio||1));
    const data=detail?cache.get(path,true):overview;
    if(data?.peaks && rect.width && rect.height){paint(canvas,data);setWaveStatus(canvas,'',false,true);}
    else if(data?.error){canvas.title=data.error;canvas.dataset.waveState='unavailable';setWaveStatus(canvas,`Waveform unavailable: ${data.error}`,true);}
    else {
      if(overview?.peaks && rect.width && rect.height)paint(canvas,overview);
      canvas.dataset.waveState='loading';
      if(rect.width && rect.height)queueWave(path,detail);
      setWaveStatus(canvas,rect.width&&rect.height?'Loading source waveform…':'Waiting for editor layout…');
      if(!rect.width||!rect.height){
        if(canvas.dataset.waveLayoutRetry!=='scheduled'){
          canvas.dataset.waveLayoutRetry='scheduled';
          const schedule=window.requestAnimationFrame || (typeof requestAnimationFrame==='function' ? requestAnimationFrame : null);
          if(schedule) schedule(()=>{canvas.dataset.waveLayoutRetry='';if(canvas.isConnected)renderWave(canvas);});
          else canvas.dataset.waveLayoutRetry='';
        }
      }
    }
  }
  function deferDrain() {
    if(!drainTimer)drainTimer=setTimeout(()=>{drainTimer=0;drain();},500);
  }
  async function drain() {
    if (decoding || shell.classList.contains('hidden')) return;
    if(queued.length&&(window.AxiomArrangement?.loading||window.AxiomArrangement?.playing)){deferDrain();return;}
    const live=new Set([...shell.querySelectorAll('canvas[data-wave-path]')].map(canvas=>canvas.dataset.wavePath).concat(window.AxiomStudioDaw.activeProject?.arrangementClips.map(c=>c.path)||[]));
    let path;
    while((path=queued.shift())&&!live.has(path))pending.delete(path);
    if (!path) return;
    decoding = true;
    let context, deferred=false;
    try {
      let nativeOnly=false;
      if(!window.AxiomBrowserStretch){
        const {nativeSourceInfo}=await import('./native-source-info.mjs');
        const info=await nativeSourceInfo(path,{current:()=>[...shell.querySelectorAll('canvas[data-wave-path]')].some(canvas=>canvas.dataset.wavePath===path)});
        if(info.duration>600||info.sourceBytes>1024*1024*1024){
          cache.set(path,{peaks:info.peaks,duration:info.duration,peakSpanSeconds:info.peakSpanSeconds});
          window.AxiomSourceBounds?.observe(window.AxiomStudioDaw.activeProject,path,info.duration);
          shell.querySelectorAll('canvas[data-wave-path]').forEach(canvas=>{if(canvas.dataset.wavePath===path)renderWave(canvas);});
          window.AxiomSourceBounds?.render();return;
        }
        nativeOnly=info.sourceBytes>96*1024*1024;
      }
      context = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 22050);
      let audio;
      if(!nativeOnly){
        const response = await fetch(`/api/library/stream?path=${encodeURIComponent(path)}`);
        if (!response.ok) throw new Error(`Audio unavailable (${response.status})`);
        if (Number(response.headers.get('content-length')) > 96 * 1024 * 1024) throw new Error('Waveform exceeds preview size limit');
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > 96 * 1024 * 1024) throw new Error('Waveform exceeds preview size limit');
        try {audio = await context.decodeAudioData(bytes);}catch (_) {}
      }
      // Large video containers use bounded audio-only PCM, never a full browser download.
      if(!audio) {
        const {nativeWaveform}=await import('./native-waveform.mjs');
        audio=await nativeWaveform(path,context,{
          current:()=>window.AxiomStudioDaw.activeProject?.arrangementClips.some(c=>c.path===path)||[...shell.querySelectorAll('canvas[data-wave-path]')].some(canvas=>canvas.dataset.wavePath===path),
        });
        nativeFallbackCount++;
      }
      decodeCount++;
      const {waveformPeaks}=await import('./waveform-peaks.mjs');
      cache.set(path, await waveformPeaks(audio));
      window.AxiomSourceBounds?.observe(window.AxiomStudioDaw.activeProject,path,audio.duration);
      updateSelectedPreview();
      shell.querySelectorAll('canvas[data-wave-path]').forEach(canvas => {
        if (canvas.dataset.wavePath === path) renderWave(canvas);
      });
      window.AxiomSourceBounds?.render();
      paintMaster();
    } catch (error) {
      if(error.code==='WAVEFORM_DEFERRED'){deferred=true;return;}
      cache.set(path, { error: error.message });
      shell.querySelectorAll('canvas[data-wave-path]').forEach(canvas => {
        if (canvas.dataset.wavePath === path) {
          canvas.dataset.waveState = 'unavailable';
          canvas.title = error.message;
          setWaveStatus(canvas,`Waveform unavailable: ${error.message}`,true);
        }
      });
    } finally {
      pending.delete(path);
      context = null;
      decoding = false;
      if(deferred){queueWave(path);deferDrain();}else drain();
    }
  }

  function paintAutomation(container) {
    let canvas = container.querySelector('canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'daw-automation-curve';
      container.prepend(canvas);
    }
    const rect = container.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * 2));
    canvas.height = Math.max(1, Math.round(rect.height * 2));
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#9cb72e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const clock=window.AxiomStudioDaw.compileTempoMap(window.AxiomStudioDaw.activeProject);
    const total=Number(container.dataset.totalBeats || 64),start=Number(container.dataset.viewStart||0),y=bpm=>(400-bpm)/380*canvas.height;
    let begun=false;
    clock.segments.forEach(segment=>{
      if(segment.beat>start+total||segment.end<=start)return;
      const beat=Math.max(start,segment.beat),end=Math.min(start+total,segment.end);
      const x=(beat-start)/total*canvas.width,value=segment.value+segment.slope*(beat-segment.beat);
      if(!begun){ctx.moveTo(x,y(value));begun=true;}else ctx.lineTo(x,y(value));
      ctx.lineTo((end-start)/total*canvas.width,y(segment.value+segment.slope*(end-segment.beat)));
    });
    ctx.stroke();
  }

  function paintMaster() {
    const project=window.AxiomStudioDaw.activeProject;if(!project)return;
    const canvas=shell.querySelector('canvas[data-live-master]');if(!canvas)return;
    const rendered=shell.querySelector('canvas[data-master-render]');
    if(rendered&&window.AxiomDawExport?.draw(rendered,project)){canvas.hidden=true;return;}
    canvas.hidden=false;
    const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
    canvas.width=Math.ceil(rect.width*Math.min(2,window.devicePixelRatio||1));canvas.height=Math.ceil(rect.height*Math.min(2,window.devicePixelRatio||1));
    const {columns,bands,missing}=masterWaveform(project,canvas.width,Number(canvas.dataset.totalBeats),path=>{const data=cache.get(path);if(!data)queueWave(path);return data;},window.AxiomStudioDaw,window.AxiomDawAutomation);
    const ctx=canvas.getContext('2d');
    for(let x=0;x<columns.length;x++){
      const height=Math.min(1,columns[x])*canvas.height*.92;if(!height)continue;
      ctx.fillStyle=waveformColor(bands[0][x],bands[1][x],bands[2][x]);ctx.fillRect(x,(canvas.height-height)/2,1,height);
    }
    canvas.dataset.waveState=missing?'loading':'ready';
    canvas.parentElement.title='Live mix level preview: clip volume, gain, fades, mute and solo. Effects and overlapping audio are exact after export.';
  }
  let masterFrame=0;
  function refreshMaster(){if(!masterFrame)masterFrame=requestAnimationFrame(()=>{masterFrame=0;paintMaster();});}
  function refresh() {
    refreshFrame = 0;
    if (shell.classList.contains('hidden')) {stopBeatPreview(); return;}
    if (!referenceLoaded && new URLSearchParams(location.search).has('composer_reference')) {
      referenceLoaded = true;
      window.AxiomStudioDaw.showReferencePreview();
    }
    paintMaster();
    shell.querySelectorAll('canvas[data-wave-path]').forEach(canvas => {
      if(canvas.closest('.has-master-render'))return;
      const path = canvas.dataset.wavePath;
      loadCues(path);
      renderWave(canvas);
    });
    shell.querySelectorAll('.studio-daw-master-automation').forEach(paintAutomation);
    shell.querySelectorAll('canvas[data-fx-curve]').forEach(canvas => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * 2; canvas.height = rect.height * 2;
      const ctx = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;
      ctx.strokeStyle = '#6ca8c9'; ctx.lineWidth = 2; ctx.beginPath();
      const up = canvas.dataset.fxCurve === 'up';
      ctx.moveTo(0, up ? h-3 : 4);
      ctx.bezierCurveTo(w*.2,up ? h-3 : 4,w*.3,up ? 4 : h-3,w,up ? 4 : h-3);
      ctx.stroke();
    });
    updatePatternPreview();
    const beatPlayIcon = shell.querySelector('[aria-label="Play beat preview"] img');
    if (beatPlayIcon && beatPlayIcon.getAttribute('src') !== '/static/icons/play.svg') beatPlayIcon.setAttribute('src','/static/icons/play.svg');
    updateSelectedPreview();
    window.AxiomSourceBounds?.render();
    drain();
  }

  const cueRequests = new Set();
  function loadCues(path) {
    if (!path || cueRequests.has(path)) return;
    cueRequests.add(path);
    fetch(`/api/cues/get?path=${encodeURIComponent(path)}`).then(response=>{
      if (!response.ok) throw new Error('Cue read unavailable');
      return response.json();
    }).then(data=>{
      window.AxiomStudioDaw.receiveCues(path,data.cues,data.cue_source || 'unknown');
    }).catch(()=>{ /* Missing cue evidence must not become invented markers. */ });
  }
  shell.addEventListener('daw-automation-change',event=>paintAutomation(event.target));

  function updateSelectedPreview() {
    const selected = shell.querySelector('.studio-daw-clip[data-daw-clip-id].selected');
    const source = selected?.querySelector('canvas[data-wave-path]');
    const canvas = document.getElementById('daw-selected-wave');
    if (!canvas) return;
    const signature=source ? JSON.stringify(source.dataset) : '';
    if(canvas.dataset.previewSignature!==signature){
      canvas.getContext('2d')?.clearRect(0,0,canvas.width,canvas.height);
      for(const key of Object.keys(canvas.dataset))delete canvas.dataset[key];
      canvas.dataset.previewSignature=signature;
    }
    if(!source)return;
    Object.assign(canvas.dataset,source.dataset);
    const data = cache.get(source.dataset.wavePath);
    if (data?.peaks) paint(canvas,data);
  }

  function updatePatternPreview() {
    const preview = shell.querySelector('.daw-pattern-preview');
    if (!preview) return;
    const hits = Array.from(shell.querySelectorAll('.studio-daw-step-cell.kick')).map(cell=>cell.classList.contains('hit'));
    const signature = hits.join(',');
    if (preview.dataset.pattern === signature) return;
    preview.dataset.pattern = signature;
    preview.innerHTML = Array.from({length:64},(_,i)=>`<i class="${hits[i] ? 'hit' : ''}"></i>`).join('');
  }

  const mixer = shell.querySelector('.studio-daw-mixer-strips');
  const mixerToggle = shell.querySelector('.studio-daw-mixer-header button');
  mixerToggle.setAttribute('onclick', 'AxiomStudioDaw.toggleMixer()');
  mixerToggle.setAttribute('aria-expanded', 'true');
  mixerToggle.setAttribute('aria-label', 'Collapse mixer');
  mixerToggle.textContent = 'Collapse';
  let activeMixerDetailScope = 'mix';
  const mixerDetail = document.createElement('aside');
  mixerDetail.id = 'daw-mixer-detail-panel';
  mixerDetail.className = 'daw-mixer-detail-panel';
  mixerDetail.setAttribute('aria-label', 'Detailed mixer controls');
  const mixerChannels=[['master','Master'],['left-deck','Left Deck'],['right-deck','Right Deck'],['samples','Samples'],['fx','FX'],['recordings','Recordings'],['instruments','Drums / Instruments']];
  mixerDetail.innerHTML = `
    <div class="daw-mixer-detail-header">
      <span>MIXER</span>
      <button type="button" class="daw-mixer-detail-close" aria-label="Close mixer detail">×</button>
    </div>
    <div class="daw-mixer-detail-channels">${['Mix', 'Clip'].map(name => `
      <section class="daw-mixer-detail-section" role="region" aria-label="${name} mixer controls" data-mixer-detail-scope="${name.toLowerCase()}">
        <p>${name === 'Mix' ? 'Deck mixer' : 'Clip mixer'}</p>
        ${name==='Mix'?`<select class="daw-mixer-target" aria-label="Mixer channel">${mixerChannels.map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select>`:`<small data-mixer-label="clip">CLIP</small>`}
        <label class="daw-knob-control daw-gain-control">GAIN<button class="daw-knob" role="slider" aria-valuemin="-24" aria-valuemax="12" aria-valuenow="0" data-mixer-scope="${name.toLowerCase()}" data-mixer-param="gainDb" title="Gain: drag to adjust, double-click to enter dB" aria-label="${name} Gain"></button><output>0.0 dB</output></label>
        <div class="daw-eq-knob-row">
          ${['High', 'Mid', 'Low'].map(band => `<label class="daw-knob-control">${band.toUpperCase()}<button class="daw-knob" role="slider" aria-valuemin="-24" aria-valuemax="12" aria-valuenow="0" data-mixer-scope="${name.toLowerCase()}" data-mixer-param="${band.toLowerCase()}Db" title="${band}: drag to adjust, double-click to enter dB" aria-label="${name} ${band}"></button><output>0.0 dB</output></label>`).join('')}
        </div>
        <label class="daw-fader-control">VOLUME<input class="daw-fader" type="range" min="0" max="1" step="0.01" value="1" aria-label="${name} volume" data-mixer-volume="${name.toLowerCase()}"><output class="daw-volume-readout">0.0 dB</output></label>
        <div class="daw-channel-buttons"><button data-mixer-solo="${name.toLowerCase()}" aria-label="Solo ${name}" aria-pressed="false">S</button><button data-mixer-mute="${name.toLowerCase()}" aria-label="Mute ${name}" aria-pressed="false">M</button><button data-mixer-automation="${name.toLowerCase()}" aria-label="Edit ${name} automation" title="Edit automation"><img src="/static/icons/audio-waveform.svg" alt="" width="14" height="14"></button></div>
      </section>`).join('')}</div>`;
  shell.querySelector('.studio-daw-arrange-shell')?.append(mixerDetail);
  const mixerControlRoots = () => [mixer, mixerDetail].filter(Boolean);
  const mixerControls = selector => mixerControlRoots().flatMap(root => Array.from(root.querySelectorAll(selector)));
  const setMixerDetailOpen = (scope = 'mix', open = true) => {
    activeMixerDetailScope = scope === 'clip' ? 'clip' : 'mix';
    shell.toggleAttribute('data-mixer-detail', open);
    mixerDetail.inert = !open;
    mixerDetail.setAttribute('aria-hidden', String(!open));
    shell.querySelectorAll('.studio-daw-mixer-strip').forEach(strip => {
      strip.classList.toggle('is-selected', strip.dataset.mixerStrip === activeMixerDetailScope && open);
    });
    mixerDetail.querySelectorAll('[data-mixer-detail-scope]').forEach(section => {
      const selected=section.dataset.mixerDetailScope === activeMixerDetailScope;
      section.classList.toggle('active', selected);
      section.setAttribute('aria-label',`${section.dataset.mixerDetailScope==='mix'?'Mix':'Clip'} mixer controls${selected?', selected':''}`);
    });
    const channels=mixerDetail.querySelector('.daw-mixer-detail-channels');
    const selected=channels.querySelector('.active');
    if(channels.firstElementChild!==selected)channels.prepend(selected);
  };
  mixerDetail.querySelector('.daw-mixer-detail-close')?.addEventListener('click', event => {
    event.stopPropagation();
    setMixerDetailOpen(activeMixerDetailScope, false);
  });
  const mixerTarget=mixerDetail.querySelector('.daw-mixer-target');
  mixerTarget.addEventListener('change',()=>{
    window.AxiomStudioDaw.selectSection(mixerTarget.value);
    setMixerDetailOpen('mix',true);
  });
  mixer.innerHTML = ['Mix', 'Clip'].map(name => `
    <div class="studio-daw-mixer-strip" data-mixer-strip="${name.toLowerCase()}" role="button" tabindex="0" aria-label="Open ${name} mixer detail">
      <strong>${name.toUpperCase()}</strong>
      <label class="daw-knob-control daw-gain-control">GAIN<button class="daw-knob" role="slider" aria-valuemin="-24" aria-valuemax="12" aria-valuenow="0" data-mixer-scope="${name.toLowerCase()}" data-mixer-param="gainDb" title="Gain: drag to adjust, double-click to enter dB" aria-label="${name} Gain"></button><output>0.0 dB</output></label>
      <div class="daw-eq-knob-row">
        ${['High', 'Mid', 'Low'].map(band => `<label class="daw-knob-control">${band.toUpperCase()}<button class="daw-knob" role="slider" aria-valuemin="-24" aria-valuemax="12" aria-valuenow="0" data-mixer-scope="${name.toLowerCase()}" data-mixer-param="${band.toLowerCase()}Db" title="${band}: drag to adjust, double-click to enter dB" aria-label="${name} ${band}"></button><output>0.0 dB</output></label>`).join('')}
      </div>
      <div class="daw-strip-level-row">
        <div class="daw-channel-meter" aria-label="${name} preview level">
          <meter min="0" max="1" value="0" title="Stereo maximum sample peak"></meter>
          <div class="daw-meter-labels">${['0','-6','-12','-24','-36','-60'].map(db => `<div>${db}</div>`).join('')}</div>
        </div>
        <label class="daw-fader-control">VOL<input class="daw-fader" type="range" min="0" max="1" step="0.01" value="1" aria-label="${name} volume" data-mixer-volume="${name.toLowerCase()}"><output class="daw-volume-readout">0.0 dB</output></label>
      </div>
      <div class="daw-channel-buttons"><button data-mixer-solo="${name.toLowerCase()}" aria-label="Solo ${name}" aria-pressed="false">S</button><button data-mixer-mute="${name.toLowerCase()}" aria-label="Mute ${name}" aria-pressed="false">M</button><button data-mixer-automation="${name.toLowerCase()}" aria-label="Edit ${name} automation" title="Edit automation"><img src="/static/icons/audio-waveform.svg" alt="" width="14" height="14"></button></div>
      <small data-mixer-label="${name.toLowerCase()}">${name.toUpperCase()}</small>
    </div>`).join('');
  mixer.querySelectorAll('.studio-daw-mixer-strip').forEach(strip => {
    strip.addEventListener('click', event => {
      if (event.target.closest('button, input, [role="slider"]')) return;
      setMixerDetailOpen(strip.dataset.mixerStrip, true);
    });
    strip.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      setMixerDetailOpen(strip.dataset.mixerStrip, true);
    });
  });
  function mixerTargets(scope,create=false) {
    const api=window.AxiomStudioDaw,p=api.activeProject,row=api.expandedSection;
    if(!p)return [];
    if(scope==='clip')return api.selectedMixerClips;
    if(!row)return [];
    if(row==='master') {
      if(create)p.masterMixer ||= {volume:1,muted:false};
      return [p.masterMixer || {volume:1,muted:false}];
    }
    if(create){p.rowMixer ||= {};p.rowMixer[row] ||= {volume:1,muted:false};}
    return [p.rowMixer?.[row] || {volume:1,muted:false}];
  }
  function refreshMixer() {
    refreshMaster();
    window.AxiomStudioDaw.refreshDeckMixer?.();
    const masterMode=window.AxiomStudioDaw.expandedSection==='master';
    mixerTarget.value=window.AxiomStudioDaw.expandedSection;
    mixer.classList.toggle('daw-master-mixer',masterMode);
    const strips=mixer.querySelectorAll('.studio-daw-mixer-strip');
    strips[0].querySelector('strong').textContent=masterMode?'MASTER':'MIX';
    strips[1].hidden=masterMode;
    const clipCount=window.AxiomStudioDaw.selectedMixerClips.length;
    strips[1].querySelector('strong').textContent=clipCount>1?`${clipCount} CLIPS`:'CLIP';
    mixerControls('[data-mixer-volume="clip"]').forEach(input => input.title=clipCount>1?`Set volume for all ${clipCount} selected clips. Undo restores their previous levels.`:'Adjust selected clip volume');
    mixerControls('[data-mixer-volume="mix"]').forEach(input => input.setAttribute('aria-label',masterMode?'Master volume':'Mix volume'));
    mixerControls('[data-mixer-mute="mix"]').forEach(button => button.setAttribute('aria-label',masterMode?'Mute Master':'Mute Mix'));
    for(const scope of ['mix','clip']) {
      const display=(object,key,fallback)=>{
        const api=window.AxiomStudioDaw,row=api.expandedSection,parameter=scope==='clip'?key[3].toLowerCase()+key.slice(4):key;
        const ref={scope:scope==='clip'?'clip':row==='master'?'project':'deck',targetId:scope==='clip'?object?.id:row==='master'?'':row,parameter};
        return window.AxiomAutomationRecorder?.live(api.activeProject,ref)??object?.[key]??fallback;
      };
      const targets=mixerTargets(scope),key=scope==='mix'?'volume':'mixVolume',muteKey=scope==='mix'?'muted':'mixMuted';
      const inputs=mixerControls(`[data-mixer-volume="${scope}"]`),buttons=mixerControls(`[data-mixer-mute="${scope}"]`);
      const value=display(targets[0],key,1),mixed=targets.some(t=>display(t,key,1)!==value);
      inputs.forEach(input => {
        input.disabled=!targets.length;input.value=String(value);
        input.nextElementSibling.textContent=!targets.length?'--':mixed?'Mixed':value?`${(20*Math.log10(value)).toFixed(1)} dB`:'-inf dB';
      });
      mixerControls(`[data-mixer-automation="${scope}"]`).forEach(button => button.disabled=!targets.length||(scope==='mix'&&window.AxiomStudioDaw.expandedSection==='fx'));
      buttons.forEach(button => {
        button.disabled=!targets.length;
        button.setAttribute('aria-pressed',String(targets.length>0&&targets.every(t=>t[muteKey])));
      });
      mixerControls(`[data-mixer-solo="${scope}"]`).forEach(solo => {
        solo.disabled=!targets.length||(scope==='mix'&&masterMode);solo.hidden=scope==='mix'&&masterMode;
        solo.setAttribute('aria-pressed',String(targets.length>0&&targets.every(t=>t[scope==='mix'?'solo':'mixSolo'])));
      });
      mixerControls(`[data-mixer-scope="${scope}"]`).forEach(knob=>{
        const param=knob.dataset.mixerParam,key=scope==='mix'?param:`mix${param[0].toUpperCase()}${param.slice(1)}`,value=display(targets[0],key,0);
        knob.disabled=!targets.length;knob.setAttribute('aria-valuenow',value);knob.style.setProperty('--knob-angle',`${knobAngle(param,value)}deg`);
        knob.nextElementSibling.textContent=targets.some(t=>display(t,key,0)!==value)?'Mixed':`${value.toFixed(1)} dB`;
      });
      mixerControls(`[data-mixer-label="${scope}"]`).forEach(label => {
        label.textContent=scope==='mix'?(masterMode?'Entire project':window.AxiomStudioDaw.expandedSection.replace('-',' ')):(targets.length?`${targets.length} clip${targets.length===1?'':'s'}`:'No clip');
      });
      const detail=mixerDetail.querySelector(`[data-mixer-detail-scope="${scope}"]`);
      detail.classList.toggle('is-master',scope==='mix'&&masterMode);
      detail.querySelector('p').textContent=scope==='mix'?(masterMode?'Master mixer':'Deck mixer'):'Clip mixer';
      if(scope==='clip'&&targets.length===1)detail.querySelector('small').textContent=targets[0].title||targets[0].label||'Selected clip';
    }
    setMixerDetailOpen(activeMixerDetailScope, shell.hasAttribute('data-mixer-detail'));
  }
  function setMixer(scope,value,isMute=false) {
    if(!Number.isFinite(value) || value<0 || value>1)return false;
    const targets=mixerTargets(scope,true),key=scope==='mix'?(isMute?'muted':'volume'):(isMute?'mixMuted':'mixVolume');
    writeMixer(scope,key,isMute?Boolean(value):value);
    window.AxiomArrangement?.mixerChanged(window.AxiomStudioDaw.activeProject);refreshMixer();return Boolean(targets.length);
  }
  function writeMixer(scope,key,value){
    const api=window.AxiomStudioDaw,p=api.activeProject;
    if(!p)return;
    mixerTargets(scope,true);
    const refs=scope==='clip'?api.selectedMixerClips.map(c=>({scope,id:c.id})):[{scope,id:api.expandedSection}];
    window.AxiomMixerHistory.write(p,refs,key,value);
  }
  mixerControls('[data-mixer-volume]').forEach(input=>input.addEventListener('input',()=>setMixer(input.dataset.mixerVolume,Number(input.value))));
  mixerControls('[data-mixer-mute]').forEach(button=>button.addEventListener('click',()=>setMixer(button.dataset.mixerMute,button.getAttribute('aria-pressed')==='true'?0:1,true)));
  function editMixerAutomation(scope,parameter='volume'){
    const api=window.AxiomStudioDaw,row=api.expandedSection;
    const refs=scope==='clip'?api.selectedMixerClips.map(c=>({scope:'clip',targetId:c.id})):[{scope:row==='master'?'project':'deck',targetId:row==='master'?'':row}];
    window.AxiomDawAutomation?.edit(refs,parameter);
  }
  mixerControls('[data-mixer-automation]').forEach(button=>button.addEventListener('click',()=>editMixerAutomation(button.dataset.mixerAutomation)));
  mixerControls('[data-mixer-volume], [data-mixer-param]').forEach(control=>{
    control.addEventListener('contextmenu',event=>{
      event.preventDefault();event.stopPropagation();
      editMixerAutomation(control.dataset.mixerVolume||control.dataset.mixerScope,control.dataset.mixerParam||'volume');
    });
    control.title=(control.title?control.title+'. ':'')+'Right-click to edit automation';
  });
  function setParam(scope,param,value){
    if(!['gainDb','highDb','midDb','lowDb','solo'].includes(param)||!Number.isFinite(value))return false;
    const key=scope==='mix'?param:`mix${param[0].toUpperCase()}${param.slice(1)}`;
    writeMixer(scope,key,param==='solo'?Boolean(value):Math.max(-24,Math.min(12,value)));
    window.AxiomArrangement?.mixerChanged(window.AxiomStudioDaw.activeProject);refreshMixer();return true;
  }
  function knobAngle(param,value){
    const numeric=Number(value)||0;
    const scale=param==='filterPosition'?1.35:7.5;
    return Math.max(-135,Math.min(135,Math.round(numeric*scale*10)/10));
  }
  mixerControls('[data-mixer-solo]').forEach(b=>b.addEventListener('click',()=>setParam(b.dataset.mixerSolo,'solo',b.getAttribute('aria-pressed')==='true'?0:1)));
  mixerControls('[data-mixer-param]').forEach(knob=>{
    const set=value=>setParam(knob.dataset.mixerScope,knob.dataset.mixerParam,value);
    knob.addEventListener('keydown',e=>{if(['ArrowUp','ArrowRight','ArrowDown','ArrowLeft','Home'].includes(e.key)){e.preventDefault();e.stopPropagation();set(e.key==='Home'?0:Number(knob.getAttribute('aria-valuenow'))+(['ArrowUp','ArrowRight'].includes(e.key)?1:-1)*(e.shiftKey?.1:1));}});
    knob.addEventListener('dblclick',()=>{const value=prompt('Level in dB (-24 to +12)',knob.getAttribute('aria-valuenow'));if(value!==null&&value.trim())set(Number(value));});
    knob.addEventListener('pointerdown',e=>{
      if(e.button!==0)return;e.preventDefault();const y=e.clientY,start=Number(knob.getAttribute('aria-valuenow'));knob.setPointerCapture(e.pointerId);knob.focus();window.AxiomMixerHistory.begin(window.AxiomStudioDaw.activeProject);
      const move=event=>set(Math.round((start+(y-event.clientY)/4)*10)/10),end=event=>{window.AxiomMixerHistory.finish(event.type==='pointercancel');window.AxiomArrangement?.mixerChanged(window.AxiomStudioDaw.activeProject);refreshMixer();knob.removeEventListener('pointermove',move);knob.removeEventListener('pointerup',end);knob.removeEventListener('pointercancel',end);};
      knob.addEventListener('pointermove',move);knob.addEventListener('pointerup',end);knob.addEventListener('pointercancel',end);
    });
  });
  function meter(channels){
    const api=window.AxiomStudioDaw;
    const selectedClips=new Set(api.selectedMixerClips),row=api.expandedSection;
    const peaks=[0,0],elements=mixer.querySelectorAll('.daw-channel-meter meter');
    let masterPeak=null;
    for(const channel of channels){
      const mix=channel.sectionId===row,clip=channel.clip&&selectedClips.has(channel.clip);
      const master=channel.sectionId==='master';
      if(!mix&&!clip&&!(master&&window.AxiomProducerTips?.enabled))continue;
      const peak=channel.level();
      if(master)masterPeak=peak;
      if(mix)peaks[0]=Math.max(peaks[0],peak);
      if(clip)peaks[1]=Math.max(peaks[1],peak);
    }
    window.AxiomProducerTips?.observeMaster(api.activeProject,masterPeak);
    ['mix','clip'].forEach((scope,index)=>{
      const peak=peaks[index],element=elements[index];
      element.value=peak?Math.max(0,Math.min(1,(20*Math.log10(peak)+60)/60)):0;
      element.title=`Stereo maximum sample peak: ${peak?(20*Math.log10(peak)).toFixed(1):'-inf'} dBFS${peak>=1?' (clipping)':''}`;
    });
  }
  mixerControls('[data-mixer-volume]').forEach(input=>{
    input.addEventListener('pointerdown',()=>window.AxiomMixerHistory.begin(window.AxiomStudioDaw.activeProject));
    input.addEventListener('change',()=>window.AxiomMixerHistory.finish());
    input.addEventListener('pointercancel',()=>{window.AxiomMixerHistory.finish(true);window.AxiomArrangement?.mixerChanged(window.AxiomStudioDaw.activeProject);refreshMixer();});
    input.addEventListener('blur',()=>window.AxiomMixerHistory.finish());
  });
  function undoMixer(redo=false){
    const p=window.AxiomStudioDaw.activeProject;if(!p)return false;
    const fades=()=>JSON.stringify(p.arrangementClips.map(c=>[c.id,c.fadeInBeats,c.fadeOutBeats,c.fadeCurve])),before=fades();
    const changed=window.AxiomMixerHistory.undo(p,redo);
    if(changed){if(before!==fades())window.AxiomArrangement?.stop(false);window.AxiomArrangement?.mixerChanged(p);refreshMixer();}
    else window.showToast?.('No mixer change can be restored safely.');
    return changed;
  }
  mixer.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'){event.preventDefault();event.stopPropagation();undoMixer(event.shiftKey);}});
  window.AxiomMixer={refresh:refreshMixer,set:setMixer,setParam,knobAngle,meter,undo:undoMixer,open:setMixerDetailOpen,close:()=>setMixerDetailOpen(activeMixerDetailScope,false)};refreshMixer();
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.className = 'daw-stop-button';
  stop.setAttribute('aria-label', 'Stop DAW playback');
  stop.title = 'Stop';
  stop.innerHTML = '<img src="/static/icons/square.svg" alt="">';
  stop.setAttribute('onclick','AxiomStudioDaw.stopPlayback()');
  document.querySelector('#audio-player .player-left-zone')?.prepend(stop);
  const pause = document.createElement('button');
  pause.type = 'button'; pause.className = 'daw-pause-button';
  pause.title = 'Pause'; pause.setAttribute('aria-label','Pause DAW playback');
  pause.innerHTML = '<img src="/static/icons/pause.svg" alt="">';
  pause.setAttribute('onclick',"if(window.AxiomArrangement) AxiomArrangement.pause(); if (window.AxiomStems?.playing) AxiomStems.stop()");
  document.querySelector('#audio-player .player-left-zone')?.append(pause);
  const selectedWave = document.createElement('canvas');
  selectedWave.id = 'daw-selected-wave'; selectedWave.className = 'daw-audio-wave';
  document.querySelector('#audio-player .player-track-copy')?.append(selectedWave);
  const zoom = document.createElement('div');
  zoom.className = 'daw-zoom-toolbar';
  zoom.innerHTML = '<button type="button" data-pan="-1" title="Previous range" aria-label="Previous range" aria-pressed="false"><img src="/static/icons/skip-back.svg" alt=""></button><button type="button" data-zoom="-1" title="Zoom out" aria-label="Zoom out" aria-pressed="false">-</button><button type="button" data-zoom="1" title="Zoom in" aria-label="Zoom in" aria-pressed="false">+</button><button type="button" data-pan="1" title="Next range" aria-label="Next range" aria-pressed="false"><img src="/static/icons/skip-forward.svg" alt=""></button>';
  zoom.querySelectorAll('[data-zoom]').forEach(button => button.setAttribute('onclick',`AxiomStudioDaw.stepZoom(${Number(button.dataset.zoom)})`));
  zoom.querySelectorAll('[data-pan]').forEach(button => button.setAttribute('onclick',`AxiomStudioDaw.panTimeline(${Number(button.dataset.pan)})`));
  let zoomPulseTimer = null;
  zoom.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
    const turnOn=button.hasAttribute('data-pan')&&button.getAttribute('aria-pressed')!=='true';
    document.querySelectorAll('.daw-zoom-toolbar button').forEach(item => {
      item.classList.remove('is-active', 'is-clicking');
      item.setAttribute('aria-pressed', 'false');
    });
    button.classList.add('is-clicking');
    button.classList.toggle('is-active', turnOn);
    button.setAttribute('aria-pressed', String(turnOn));
    clearTimeout(zoomPulseTimer);
    zoomPulseTimer = setTimeout(() => button.classList.remove('is-clicking'), 180);
  }));
  const transportDock=document.getElementById('daw-idle-transport-controls');
  if(transportDock)transportDock.append(zoom);else document.querySelector('#audio-player .player-volume-zone')?.before(zoom);
  shell.addEventListener('click', event => {
    if(event.target.closest('#studio-daw-lanes')&&!event.target.closest('.studio-daw-clip, button, input, select, [role="button"], [role="slider"], .daw-fx-region, .daw-automation-point')){
      setMixerDetailOpen(activeMixerDetailScope,false);
      shell.setAttribute('data-clip-inspector','hidden');
      const inspector=document.getElementById('studio-daw-clip-inspector');
      if(inspector){inspector.classList.add('is-hidden');inspector.inert=true;inspector.setAttribute('aria-hidden','true');}
    }
    const step = event.target.closest('.studio-daw-step-cell');
    if (!step||step.disabled) return;
    const project = window.AxiomStudioDaw.activeProject;
    if (project) {
      const row=step.dataset.hit,index=Number(step.dataset.step),pattern=window.AxiomPatterns?.active(project);
      // Read the complete pattern, including bars on other editor pages.
      const hits=new Set(pattern?.steps?.[row]||(window.AxiomPatterns?[]:project.stepPattern?.[row]||[]));
      if(hits.has(index))hits.delete(index);else hits.add(index);
      window.AxiomStudioDaw.setPatternRow(row,[...hits]);
    }
    updatePatternPreview();
  });
  window.addEventListener('axiom-audio-verified', event => {
    const paths=Array.isArray(event.detail?.paths)?event.detail.paths:[];
    let changed=false;
    for(const path of paths)if(cache.clearError(path))changed=true;
    if(changed&&!refreshFrame)refreshFrame=requestAnimationFrame(refresh);
  });
  window.addEventListener('axiom-daw-layout-changed',()=>{if(!refreshFrame)refreshFrame=requestAnimationFrame(refresh);});
  const sourceEditor=document.getElementById('studio-daw-step-editor');
  if(sourceEditor&&typeof ResizeObserver!=='undefined')new ResizeObserver(()=>{if(!refreshFrame)refreshFrame=requestAnimationFrame(refresh);}).observe(sourceEditor);
  const observer = new MutationObserver(records => {
    if (records.some(record => record.type === 'childList' || record.target === shell)) {
      if (!refreshFrame) refreshFrame = requestAnimationFrame(refresh);
    }
  });
  observer.observe(shell, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  new ResizeObserver(() => { if (!refreshFrame) refreshFrame = requestAnimationFrame(refresh); }).observe(shell);
})();
