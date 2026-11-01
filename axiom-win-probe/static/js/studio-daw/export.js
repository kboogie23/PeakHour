(function(){
  'use strict';
  const renders=new WeakMap();let generation=0,busy=false;
  const timingReceipts=[];
  function exportTiming(format){
    const now=()=>typeof performance==='object'?performance.now():Date.now();
    const started=now(),stages={};let stage=null,changed=started,finished=false,policy=null;
    const move=next=>{if(finished||next===stage)return;const at=now();if(stage)stages[stage]=(stages[stage]||0)+Math.max(0,at-changed);stage=next;changed=at;};
    return {stage:move,mode:value=>{policy={mode:value.mode,reason:value.reason,buffered:value.buffered,duration:value.duration,estimatedBytes:value.estimatedBytes};},finish(state){
      if(finished)return;move(null);finished=true;
      const totalMs=Math.max(0,now()-started),workMs=Math.max(0,totalMs-(stages.destination||0));
      timingReceipts.push({format,state,totalMs,workMs,stages:{...stages},policy});
      if(timingReceipts.length>10)timingReceipts.shift();
    }};
  }
  const nativePending=new Map();let activeSave=null;
  const nativeBridge=()=>window.webkit?.messageHandlers?.axiomNative||window.AxiomWindowsMixExport;
  function endingReview(p){
    if(!p||!window.AxiomStudioDaw.compileTempoMap)return null;
    const spans=[],add=(start,length,section)=>{if(Number.isFinite(start)&&Number.isFinite(length)&&start>=0&&length>0)spans.push({start,end:start+length,section});};
    for(const c of p.arrangementClips||[])add(c.timelineStartBeat,c.timelineDurationBeats,c.sectionId);
    for(const c of window.AxiomPatterns?.list(p)||p.patternClips||[])add(c.startBeat,c.durationBeats,'instruments');
    // A master limiter or filter extending across the project is not audio.
    // Count actual effect tails after their input, so a ringing echo is not a gap.
    for(const f of p.fxRegions||[])if(f.type==='gatedSweep')add(f.startBeat,f.durationBeats+(f.tailBeats||0),f.target);
    const inputs=spans.slice();
    for(const f of p.fxRegions||[]){
      if(f.type!=='gatedSweep'&&f.tailBeats>0)for(const span of inputs){
        if((f.target==='master'||f.target===span.section)&&span.start<f.startBeat+f.durationBeats&&span.end>f.startBeat){
          const trigger=Math.min(span.end,f.startBeat+f.durationBeats);add(trigger,f.tailBeats,span.section);
        }
      }
    }
    spans.sort((a,b)=>a.start-b.start);
    const map=window.AxiomStudioDaw.compileTempoMap(p);let end=spans[0]?.end,gap=null;
    for(const span of spans.slice(1)){
      if(span.start-end>=16&&map.beatToSeconds(span.start)-map.beatToSeconds(end)>=15)gap={start:end,end:span.start};
      end=Math.max(end,span.end);
    }
    if(!gap)return null;
    const clipIds=(p.arrangementClips||[]).filter(c=>c.timelineStartBeat>=gap.end-1e-7).map(c=>c.id);
    const patternIds=(p.patternClips||[]).filter(c=>c.startBeat>=gap.end-1e-7).map(c=>c.id);
    const fxIds=(p.fxRegions||[]).filter(f=>f.startBeat>=gap.end-1e-7).map(f=>f.id);
    if(!clipIds.length&&!patternIds.length&&!fxIds.length)return null;
    const exportEnd=Math.max(end,...(p.fxRegions||[]).map(f=>f.startBeat+f.durationBeats+(f.tailBeats||0)));
    return {signature:JSON.stringify(p),...gap,clipIds,patternIds,fxIds,
      gapSeconds:map.beatToSeconds(gap.end)-map.beatToSeconds(gap.start),startSeconds:map.beatToSeconds(gap.end),duration:map.beatToSeconds(exportEnd)};
  }
  function originalSong(project){
    const songs=new Map();
    for(const clip of project.arrangementClips||[]){
      if(!clip.path || !['left-deck','right-deck'].includes(clip.sectionId))continue;
      songs.set(clip.path,clip);
    }
    if(songs.size!==1)return null;
    const clip=[...songs.values()][0];
    const source=(project.sourceTracks||[]).find(track=>track.path===clip.path)||clip;
    return {title:String(source.title||'').slice(0,500),artist:String(source.artist||'').slice(0,500)};
  }
  function cleanFilenamePart(value){
    return String(value||'').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/\s+/g,' ').trim();
  }
  function metadataDefaults(p,start=0,end=Infinity){
    const daw=window.AxiomStudioDaw,map=daw.compileTempoMap(p);
    const segments=map.segments.filter(s=>s.end>start&&s.beat<end);
    const tempo=map.bpmAtBeat(start);
    const bpm=segments.every(s=>!s.slope&&Math.abs(s.value-tempo)<1e-7)?Math.round(tempo*1000)/1000:0;
    const clips=(p.arrangementClips||[]).filter(c=>!c.muted&&c.path&&c.timelineStartBeat<end&&c.timelineStartBeat+c.timelineDurationBeats>start);
    const keys=clips.map(c=>{
      const match=/^([1-9]|1[0-2])([AB])$/.exec(String(c.camelot||'').toUpperCase());
      const pitch=daw.playbackPitch?.(c)||0;
      // Resampling and mixed/unknown sources cannot promise a single key.
      const rate=bpm/Number(c.bpm||0)*c.sourceDurationBeats/c.timelineDurationBeats;
      if(!match||!Number.isInteger(pitch)||(p.playbackMode!=='preserve-pitch'&&(!bpm||!Number.isFinite(rate)||Math.abs(rate-1)>1e-7||c.beatgrid?.mode&&c.beatgrid.mode!=='fixed')))return '';
      return `${((Number(match[1])-1+pitch*7)%12+12)%12+1}${match[2]}`;
    });
    const hasPatterns=(window.AxiomPatterns?.list(p)||p.patternClips||[]).some(c=>c.startBeat<end&&c.startBeat+c.durationBeats>start);
    const key=!hasPatterns&&keys.length&&keys[0]&&keys.every(k=>k===keys[0])?keys[0]:'';
    return {bpm:bpm>=20&&bpm<=400?bpm:0,key};
  }
  function exportFilename({title,artist,projectTitle},format){
    const safeFormat=['wav','mp3'].includes(format)?format:'wav';
    const safeTitle=cleanFilenamePart(title)||cleanFilenamePart(projectTitle)||'Untitled';
    const safeArtist=cleanFilenamePart(artist);
    return `${safeArtist?`${safeArtist} - `:''}${safeTitle}.${safeFormat}`;
  }
  function contentBounds(p){
    const spans=[],add=(start,length)=>{if(Number.isFinite(start)&&Number.isFinite(length)&&length>0)spans.push({start,end:start+length});};
    for(const c of p?.arrangementClips||[])if(!c.muted)add(Number(c.timelineStartBeat),Number(c.timelineDurationBeats));
    for(const c of window.AxiomPatterns?.list(p)||p?.patternClips||[])add(Number(c.startBeat),Number(c.durationBeats));
    for(const f of p?.fxRegions||[])if(f.type==='gatedSweep'||f.tailBeats>0)add(Number(f.startBeat),Number(f.durationBeats||0)+Number(f.tailBeats||0));
    if(!spans.length)return {start:0,end:0};
    return {start:Math.min(...spans.map(span=>span.start)),end:Math.max(...spans.map(span=>span.end))};
  }
  function markerBeat(p,role){
    const marker=(p?.markers||[]).find(item=>item.role===role);
    return Number.isFinite(Number(marker?.beat))?Number(marker.beat):null;
  }
  function cleanBeat(value,fallback=0){
    const number=Number(value);
    return Number.isFinite(number)?Math.max(0,number):fallback;
  }
  function barLabel(beat){
    const safe=cleanBeat(beat);
    const bar=Math.floor(safe/4)+1,pulse=Math.floor(safe%4)+1;
    return `Bar ${bar}.${pulse}`;
  }
  function nativeRequest(action,data={},timeoutMs=30000){
    return new Promise((resolve,reject)=>{
      const requestId=crypto.randomUUID();
      const timeout=setTimeout(()=>{nativePending.delete(requestId);reject(new Error('Native mix save did not respond. Update AXIOM or retry the save.'));},timeoutMs);
      nativePending.set(requestId,{exportId:data.exportId,finish:payload=>{clearTimeout(timeout);nativePending.delete(requestId);payload?.success?resolve(payload):reject(new Error(payload?.cancelled?'Save cancelled.':payload?.error||'Native mix save failed.'));}});
      try{nativeBridge().postMessage({action,requestId,...data});}
      catch(error){clearTimeout(timeout);nativePending.delete(requestId);reject(error);}
    });
  }
  window.__AXIOM_MIX_EXPORT_RESULT=(requestId,payload)=>nativePending.get(requestId)?.finish(payload);
  function cancelNativeSave(){
    const exportId=activeSave;if(!exportId)return;
    activeSave=null;
    for(const pending of [...nativePending.values()])if(pending.exportId===exportId)pending.finish({cancelled:true});
    nativeRequest('mixExportCancel',{exportId}).catch(()=>{});
  }
  window.addEventListener?.('pagehide',cancelNativeSave);
  async function chooseDestination(filename,format,cancelled=()=>false){
    if(!nativeBridge()){
      if(format==='mp3')throw new Error('MP3 export is available in the installed AXIOM app.');
      return null;
    }
    const support=await nativeRequest('mixExportSupport',{},5000);
    if(cancelled())throw new Error('Export cancelled.');
    if(format==='mp3'&&!support.formats?.includes('mp3'))throw new Error('Update AXIOM to export MP3.');
    if(!support.chooseBeforeRender)return null;
    const exportId=crypto.randomUUID();activeSave=exportId;
    try{await nativeRequest('mixExportChoose',{exportId,filename,format},300000);return exportId;}
    catch(error){cancelNativeSave();throw error;}
  }
  async function deliver(result,filename,cancelled=()=>false,onProgress=()=>{},chosen=null,metadata=null){
    const format=filename.toLowerCase().endsWith('.mp3')?'mp3':'wav';
    let blob=result.file||new Blob([result.buffer],{type:'audio/wav'});
    const audioFrames=(blob.size-58)/8;
    if(metadata&&(metadata.title||metadata.artist||metadata.bpm||metadata.key)){
      if(!window.AxiomWavMetadata)throw new Error('WAV metadata support did not load. Reload AXIOM.');
      if(nativeBridge()){const support=await nativeRequest('mixExportSupport',{},5000);if(!support.wavMetadata||((format==='mp3'||metadata.bpm||metadata.key)&&!support.musicalMetadata))throw new Error('Update the installed AXIOM app to export Title, Artist, BPM and Key.');}
      blob=await window.AxiomWavMetadata.tag(blob,metadata);
    }
    if(!nativeBridge()){
      if(format==='mp3')throw new Error('MP3 export is available in the installed AXIOM app.');
      const objectURL=URL.createObjectURL(blob),link=document.createElement('a');link.href=objectURL;link.download=filename;link.click();
      setTimeout(()=>URL.revokeObjectURL(objectURL),60000);
      // Browsers don't report download completion. Retain OPFS output until
      // explicit cleanup, and never invent a destination or a saved receipt.
      return {state:'download-requested'};
    }
    const exportId=chosen||crypto.randomUUID();activeSave=exportId;
    try{
      if(chosen)await nativeRequest('mixExportStart',{exportId,size:blob.size});
      else{
        const support=await nativeRequest('mixExportSupport',{},5000);
        if(format==='mp3'&&!support.formats?.includes('mp3'))throw new Error('Update AXIOM to export MP3.');
        await nativeRequest('mixExportBegin',{exportId,filename,format,size:blob.size},300000);
      }
      if(cancelled())throw new Error('Save cancelled.');
      for(let offset=0;offset<blob.size;offset+=256*1024){
        if(cancelled())throw new Error('Save cancelled.');
        const bytes=new Uint8Array(await blob.slice(offset,offset+256*1024).arrayBuffer());
        let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
        const reply=await nativeRequest('mixExportChunk',{exportId,offset,data:btoa(binary)});
        if(reply.received!==offset+bytes.length)throw new Error('Native WAV transfer length did not verify.');
        onProgress(reply.received,blob.size);
      }
      if(cancelled())throw new Error('Save cancelled.');
      onProgress(blob.size,blob.size,'finishing');
      const receipt=await nativeRequest('mixExportFinish',{exportId},960000);
      if(receipt.state!=='saved'||(format==='wav'?receipt.bytes!==blob.size:receipt.format!=='mp3'||receipt.inputBytes!==blob.size||!(receipt.bytes>0))||receipt.frames!==audioFrames||!receipt.path||!/^[a-f0-9]{64}$/.test(receipt.sha256||''))throw new Error('Native WAV completion receipt did not verify.');
      return receipt;
    }catch(error){await nativeRequest('mixExportCancel',{exportId}).catch(()=>{});throw error;}
    finally{if(activeSave===exportId)activeSave=null;await result.release?.();}
  }
  async function encode(result,cancelled=()=>false,reverse=false){
    const {audio,trimFrames,frames}=result;
    if(audio.numberOfChannels!==2||audio.sampleRate!==48000||!Number.isInteger(frames)||frames<1||frames>28800000||!Number.isInteger(trimFrames)||trimFrames<0||trimFrames+frames>audio.length)throw new Error('Invalid rendered audio range.');
    const bytes=frames*8,buffer=new ArrayBuffer(58+bytes),view=new DataView(buffer);
    const text=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
    text(0,'RIFF');view.setUint32(4,50+bytes,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,18,true);
    view.setUint16(20,3,true);view.setUint16(22,2,true);view.setUint32(24,48000,true);view.setUint32(28,384000,true);view.setUint16(32,8,true);view.setUint16(34,32,true);view.setUint16(36,0,true);
    text(38,'fact');view.setUint32(42,4,true);view.setUint32(46,frames,true);text(50,'data');view.setUint32(54,bytes,true);
    const channels=[audio.getChannelData(0),audio.getChannelData(1)],peaks=new Float32Array(Math.min(65536,frames));let peak=0;
    const bands=Array.from({length:3},()=>new Float32Array(peaks.length)),low=[0,0],upper=[0,0],lowAlpha=1-Math.exp(-2*Math.PI*200/48000),midAlpha=1-Math.exp(-2*Math.PI*2000/48000);
    for(let i=0;i<frames;i++){
      if(i%65536===0){if(cancelled())throw new Error('Export cancelled');await new Promise(resolve=>setTimeout(resolve,0));}
      for(let ch=0;ch<2;ch++){
        const value=channels[ch][trimFrames+(reverse?frames-1-i:i)];if(!Number.isFinite(value))throw new Error('The rendered mix contains invalid samples.');
        view.setFloat32(58+(i*2+ch)*4,value,true);const magnitude=Math.abs(value);peak=Math.max(peak,magnitude);const bin=Math.min(peaks.length-1,Math.floor(i/frames*peaks.length));peaks[bin]=Math.max(peaks[bin],magnitude);
        low[ch]+=lowAlpha*(value-low[ch]);upper[ch]+=midAlpha*(value-upper[ch]);
        bands[0][bin]+=low[ch]**2;bands[1][bin]+=(upper[ch]-low[ch])**2;bands[2][bin]+=(value-upper[ch])**2;
      }
    }
    if(cancelled())throw new Error('Export cancelled');
    return {buffer,peaks,bands,peak,duration:frames/48000};
  }
  function overviewPeaks(result,map,startBeat,endBeat,width){
    const columns=new Float32Array(width),count=result.peaks.length;
    for(let x=0;x<width;x++){
      const start=map.beatToSeconds(startBeat+(endBeat-startBeat)*x/width),end=map.beatToSeconds(startBeat+(endBeat-startBeat)*(x+1)/width);
      if(start>=result.duration||end<=0)continue;
      const first=Math.max(0,Math.floor(start/result.duration*count)),last=Math.min(count,Math.ceil(end/result.duration*count));
      for(let i=first;i<last;i++)columns[x]=Math.max(columns[x],result.peaks[i]);
    }
    return columns;
  }
  function draw(canvas,p){
    const result=renders.get(p),valid=Boolean(result&&result.signature===JSON.stringify(p));
    canvas.hidden=!valid;canvas.parentElement.classList.toggle('has-master-render',valid);
    if(!valid){canvas.parentElement.title=result?'Source overview; master render is out of date':'Source overview';return false;}
    const rect=canvas.getBoundingClientRect();canvas.width=Math.max(1,Math.round(rect.width*2));canvas.height=Math.max(1,Math.round(rect.height*2));
    const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);ctx.fillStyle='#a3ff00';
    const columns=overviewPeaks(result,window.AxiomStudioDaw.compileTempoMap(p),0,Number(canvas.dataset.totalBeats),w);
    const map=window.AxiomStudioDaw.compileTempoMap(p),total=Number(canvas.dataset.totalBeats);
    for(let x=0;x<w;x++){
      if(result.bands){
        const a=Math.max(0,Math.floor(map.beatToSeconds(x/w*total)/result.duration*result.peaks.length)),b=Math.min(result.peaks.length,Math.ceil(map.beatToSeconds((x+1)/w*total)/result.duration*result.peaks.length));
        const energy=result.bands.map(band=>{let sum=0;for(let i=a;i<b;i++)sum+=band[i];return sum;}),max=Math.max(...energy,1e-9);
        ctx.fillStyle=`rgb(${Math.round(70+185*energy[0]/max)},${Math.round(45+180*energy[1]/max)},${Math.round(45+200*energy[2]/max)})`;
      }
      const height=Math.min(1,columns[x])*h;if(height>0)ctx.fillRect(x,(h-height)/2,1,Math.max(1,height));
    }
    canvas.parentElement.title='Rendered master mix';canvas.setAttribute('aria-label','Rendered master waveform');canvas.dataset.waveState='ready';return true;
  }
  function open(){
    if(busy)return;
    document.getElementById('daw-export-dialog')?.close();
    const dialog=document.createElement('dialog');dialog.id='daw-export-dialog';dialog.className='daw-fx-dialog';
    dialog.innerHTML='<h2>Export Audio</h2><p>Choose a format, set render In / Out, then name and save your audio.</p><label>Format <select data-export-format aria-label="Audio file format"><option value="wav">WAV</option><option value="mp3">MP3</option></select></label><section class="daw-export-range" aria-label="Render range"><div><strong>Render Range</strong><small data-export-range-summary></small></div><div class="daw-export-range-grid"><label>IN <input type="number" min="1" step="0.25" data-export-in-bar aria-label="Render In bar"></label><label>OUT <input type="number" min="1" step="0.25" data-export-out-bar aria-label="Render Out bar"></label></div><div class="daw-export-range-actions"><button type="button" data-export-set-in title="Set Render In from the current DAW cursor">I</button><button type="button" data-export-set-out title="Set Render Out from the current DAW cursor">O</button><button type="button" data-export-audio-range>Use Audio Range</button><button type="button" data-export-full-range>Full Project</button></div></section><div data-export-metadata><label>Song Title <input type="text" data-export-title aria-label="Song Title" maxlength="500"></label><label>Artist <input type="text" data-export-artist aria-label="Artist" maxlength="500"></label><small data-export-filename-preview></small></div><label><input type="checkbox" data-add-library> Add the finished edit to Library</label><label title="The saved WAV or MP3 does not need separated stem cache. If you keep editing stem levels later, create stems again."><input type="checkbox" data-free-stems checked> Free separated stem cache after save</label><small data-free-stems-note>Recommended when this render is your finished edit. Your export stays safe; stem edits can be regenerated if you reopen the project.</small><button type="button" data-library-retry hidden>Retry Add to Library</button><output role="status">Ready</output><footer><button type="button" data-close>Cancel</button><button type="button" data-export>Continue</button></footer>';
    const button=dialog.querySelector('[data-export]'),status=dialog.querySelector('output'),format=dialog.querySelector('[data-export-format]'),close=dialog.querySelector('[data-close]');
    const addLibrary=dialog.querySelector('[data-add-library]'),retryLibrary=dialog.querySelector('[data-library-retry]'),freeStems=dialog.querySelector('[data-free-stems]');
    const titleInput=dialog.querySelector('[data-export-title]'),artistInput=dialog.querySelector('[data-export-artist]'),metadataFields=dialog.querySelector('[data-export-metadata]'),filenamePreview=dialog.querySelector('[data-export-filename-preview]');
    metadataFields.insertAdjacentHTML('beforeend','<label>BPM <input type="number" min="20" max="400" step="any" data-export-bpm aria-label="BPM" placeholder="Variable or unknown"></label><label>Key <select data-export-key aria-label="Key"><option value="">Mixed or unknown</option>'+Array.from({length:12},(_,i)=>['A','B'].map(mode=>`<option value="${i+1}${mode}">${i+1}${mode}</option>`).join('')).join('')+'</select></label>');
    const bpmInput=dialog.querySelector('[data-export-bpm]'),keyInput=dialog.querySelector('[data-export-key]');
    const inInput=dialog.querySelector('[data-export-in-bar]'),outInput=dialog.querySelector('[data-export-out-bar]'),rangeSummary=dialog.querySelector('[data-export-range-summary]');
    const currentProject=window.AxiomStudioDaw.activeProject,original=originalSong(currentProject);
    titleInput.value=currentProject?.exportMetadata?.title??original?.title??currentProject?.title??'';artistInput.value=currentProject?.exportMetadata?.artist??original?.artist??'';
    const bounds=contentBounds(currentProject),savedRange=currentProject?.exportRange||{};
    const initialIn=cleanBeat(savedRange.inBeat,bounds.start||0),initialOut=cleanBeat(savedRange.outBeat,bounds.end||0);
    inInput.value=String(Math.round((initialIn/4+1)*1000)/1000);
    outInput.value=String(Math.round((Math.max(initialOut,initialIn+1)/4+1)*1000)/1000);
    const defaults=metadataDefaults(currentProject,initialIn,Math.max(initialOut,initialIn+1));
    let bpmEdited=currentProject.exportMetadata?.bpmEdited===true,keyEdited=currentProject.exportMetadata?.keyEdited===true;
    bpmInput.value=String((bpmEdited?currentProject.exportMetadata.bpm:defaults.bpm)||'');
    keyInput.value=(keyEdited?currentProject.exportMetadata.key:defaults.key)||'';
    bpmInput.oninput=()=>{bpmEdited=true;};keyInput.onchange=()=>{keyEdited=true;};
    const currentFilename=()=>exportFilename({title:titleInput.value,artist:artistInput.value,projectTitle:currentProject?.title},format.value);
    const updateFilenamePreview=()=>{if(filenamePreview)filenamePreview.textContent=`Filename: ${currentFilename()}`;};
    const inputBeat=input=>Math.max(0,(Number(input.value||1)-1)*4);
    const cursorBeat=()=>cleanBeat(window.AxiomStudioDaw?.activeProject?.editCursorBeat,markerBeat(currentProject,'start_hype')??bounds.start??0);
    function setRange(inBeat,outBeat){
      const nextIn=cleanBeat(inBeat,0),nextOut=cleanBeat(outBeat,nextIn+4);
      inInput.value=String(Math.round((nextIn/4+1)*1000)/1000);
      outInput.value=String(Math.round((Math.max(nextOut,nextIn+1/16)/4+1)*1000)/1000);
      updateRangeSummary();
    }
    function rangeBeats(){
      const start=inputBeat(inInput),end=inputBeat(outInput);
      if(end<=start)throw new Error('Render Out must be after Render In.');
      return {start,end};
    }
    function updateRangeSummary(){
      try{const range=rangeBeats();rangeSummary.textContent=`${barLabel(range.start)} to ${barLabel(range.end)} · ${(range.end-range.start)/4} bars`;
        const values=metadataDefaults(currentProject,range.start,range.end);
        if(!bpmEdited)bpmInput.value=String(values.bpm||'');if(!keyEdited)keyInput.value=values.key;
      }
      catch(error){rangeSummary.textContent=error.message;}
    }
    inInput.oninput=outInput.oninput=updateRangeSummary;
    dialog.querySelector('[data-export-set-in]').onclick=()=>setRange(cursorBeat(),inputBeat(outInput));
    dialog.querySelector('[data-export-set-out]').onclick=()=>setRange(inputBeat(inInput),Math.max(cursorBeat(),inputBeat(inInput)+4));
    dialog.querySelector('[data-export-audio-range]').onclick=()=>setRange(bounds.start,bounds.end||bounds.start+4);
    dialog.querySelector('[data-export-full-range]').onclick=()=>setRange(0,bounds.end||64);
    dialog.addEventListener('keydown',event=>{
      if(event.target?.closest?.('input, textarea, select'))return;
      if(event.key?.toLowerCase()==='i'){event.preventDefault();setRange(cursorBeat(),inputBeat(outInput));}
      if(event.key?.toLowerCase()==='o'){event.preventDefault();setRange(inputBeat(inInput),Math.max(cursorBeat(),inputBeat(inInput)+4));}
    });
    const showMetadata=()=>{metadataFields.hidden=false;updateFilenamePreview();};format.onchange=showMetadata;titleInput.oninput=artistInput.oninput=updateFilenamePreview;
    updateRangeSummary();
    const review=document.createElement('section');review.className='daw-export-ending';review.hidden=true;
    review.innerHTML='<h3>Project scatter detected</h3><p>Looks like there may be unused clips left from creating your remix. Would you like to render with them or remove them?</p><p data-ending-detail></p><p data-ending-clips></p><div class="daw-export-ending-actions"><button type="button" data-ending-show>Show clips</button><button type="button" data-ending-keep>Render with them</button><button type="button" data-ending-remove>Remove clips</button></div>';
    dialog.querySelector('label').before(review);
    const keep=review.querySelector('[data-ending-keep]');let issue=null,approvedEnding=null;
    const stamp=seconds=>{const s=Math.round(seconds);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
    function checkEnding(){
      const next=endingReview(window.AxiomStudioDaw.activeProject);
      if(next?.signature!==issue?.signature)approvedEnding=null;
      issue=next;review.hidden=!issue;
      if(issue){
        review.querySelector('[data-ending-detail]').textContent=`There is a ${stamp(issue.gapSeconds)} gap before content at ${stamp(issue.startSeconds)}. Including it makes the export ${stamp(issue.duration)} long.`;
        const p=window.AxiomStudioDaw.activeProject,names=(p.arrangementClips||[]).filter(c=>issue.clipIds.includes(c.id)).map(c=>c.label||c.title||'Audio clip');
        const counts=[[issue.clipIds.length,'audio clip'],[issue.patternIds.length,'pattern'],[issue.fxIds.length,'FX region']].filter(([n])=>n).map(([n,label])=>`${n} ${label}${n===1?'':'s'}`);
        review.querySelector('[data-ending-clips]').textContent=`${counts.join(', ')} after the gap.${names.length?' '+names.slice(0,3).join('; ')+(names.length>3?'…':''):''}`;
      }
      button.hidden=Boolean(issue);button.disabled=Boolean(issue&&approvedEnding!==issue.signature);
      return !issue||approvedEnding===issue.signature;
    }
    keep.onclick=()=>{if(busy)return;checkEnding();if(issue)approvedEnding=issue.signature;return button.onclick();};
    review.querySelector('[data-ending-show]').onclick=()=>{if(busy)return;checkEnding();if(issue&&window.AxiomStudioDaw.reviewExportEnding?.(issue))dialog.close();};
    review.querySelector('[data-ending-remove]').onclick=()=>{
      if(busy)return;
      const current=issue;
      if(current&&window.AxiomStudioDaw.removeExportEnding?.(current)){checkEnding();status.textContent=issue?'Clips removed. Review the remaining project scatter.':'Scattered clips removed. Your remix is ready to export.';}
      else{checkEnding();status.textContent='The project changed. Review the current ending again.';}
    };
    checkEnding();
    addLibrary.disabled=!nativeBridge();addLibrary.checked=Boolean(nativeBridge());
    freeStems.disabled=!nativeBridge();
    if(!nativeBridge()){addLibrary.title='Available after saving in the installed AXIOM app.';freeStems.title='AXIOM frees stem cache after a verified native save.';}
    format.value=window.AxiomRemixWorkflow?.preferences()?.format||'wav';
    showMetadata();
    let savedReceipt=null,savedBpm=0,savedOriginalSong=null,savedMetadata=null;
    async function enroll(){
      retryLibrary.disabled=true;
      try{
        const response=await fetch('/api/studio-daw/export/library',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:savedReceipt.path,sha256:savedReceipt.sha256,bpm:savedBpm,original_song:savedOriginalSong,metadata:savedMetadata})});
        const data=await response.json();if(!response.ok||!data.success)throw new Error(data.error||'Library import did not finish.');
        status.textContent=data.visible===false?'Saved. This edit is outside your current library access limit.':'Saved and added to Library: '+savedReceipt.path;
        retryLibrary.hidden=true;
        try{await window.loadLibraryStats?.();await window.runSearch?.();}
        catch{status.textContent+=' Library view could not refresh; reopen Library to see your saved track.';}
      }catch(error){status.textContent='Audio saved: '+savedReceipt.path+'. Library import failed: '+error.message;retryLibrary.hidden=false;}
      finally{retryLibrary.disabled=false;}
    }
    retryLibrary.onclick=enroll;
    let result=null,keepDownload=false,complete=false;
    const discard=()=>{if(!keepDownload)result?.release?.()?.catch?.(()=>{});result=null;keepDownload=false;};
    close.onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{if(busy){generation++;busy=false;cancelNativeSave();window.AxiomArrangement.stop(true,'export-cancel');}discard();dialog.remove();});
    button.onclick=async()=>{
      const p=window.AxiomStudioDaw.activeProject;if(!p||busy||complete)return;
      if(!checkEnding())return;
      const selectedFormat=format.value;if(!['wav','mp3'].includes(selectedFormat))return;
      savedMetadata={title:titleInput.value.trim(),artist:artistInput.value.trim(),bpm:bpmInput.value.trim()?Number(bpmInput.value):0,key:keyInput.value};
      if(!Number.isFinite(savedMetadata.bpm)||(savedMetadata.bpm!==0&&(savedMetadata.bpm<20||savedMetadata.bpm>400))){status.textContent='BPM must be between 20 and 400, or blank.';return;}
      discard();
      const token=++generation;let signature,snapshot;
      const timing=exportTiming(selectedFormat);let outcome='cancelled',renderMode='offline';
      busy=true;button.disabled=true;format.disabled=true;titleInput.disabled=true;artistInput.disabled=true;bpmInput.disabled=keyInput.disabled=true;close.textContent='Cancel';status.textContent='Preparing export...';
      try{
        timing.stage('timing');
        await window.AxiomSteadyTiming?.prepare(p,()=>token===generation&&p===window.AxiomStudioDaw.activeProject);
        if(token!==generation)return;
        if(!checkEnding()){status.textContent='Timing changed. Review the ending before exporting.';return;}
        const range=rangeBeats();
        const latest=metadataDefaults(p,range.start,range.end);
        if(!bpmEdited){savedMetadata.bpm=latest.bpm;bpmInput.value=String(latest.bpm||'');}
        if(!keyEdited){savedMetadata.key=latest.key;keyInput.value=latest.key;}
        p.exportRange={inBeat:range.start,outBeat:range.end};
        if(savedMetadata)p.exportMetadata={...savedMetadata,bpmEdited,keyEdited};
        window.AxiomDawDrafts?.checkpoint?.();
        signature=JSON.stringify(p);snapshot=JSON.parse(signature);
        savedOriginalSong=originalSong(snapshot);
        try{window.AxiomRemixWorkflow?.setFormat(selectedFormat);}catch{/* Saving preferences must not block an export. */}
        savedBpm=savedMetadata.bpm;
        const filename=exportFilename({title:titleInput.value,artist:artistInput.value,projectTitle:snapshot.title},selectedFormat);
        status.textContent=nativeBridge()?'Name your audio and choose a location...':'Preparing WAV download...';
        timing.stage('destination');
        const chosen=await chooseDestination(filename,selectedFormat,()=>token!==generation);
        if(token!==generation)return;
        button.textContent='Exporting…';status.textContent='Exporting audio…';
        timing.stage('preparation');
        const options={masterProcessing:true,startBeat:range.start,endBeat:range.end,
          onPhase:phase=>{if(token!==generation)return;timing.stage(phase);status.textContent=({sources:'Checking source audio…',timing:'Preparing timing…',stems:'Checking stems…',preparation:'Preparing audio…',rendering:renderMode==='realtime'?'Exporting in real time…':'Rendering audio…'})[phase]||'Preparing audio…';},
          onMode:policy=>{renderMode=policy.mode;timing.mode(policy);},
          onProgress:(elapsed,total)=>{if(token===generation)status.textContent=(renderMode==='realtime'?'Exporting in real time… ':'Rendering audio… ')+Math.min(90,Math.floor(elapsed/total*90))+'%';}};
        const rendered=await window.AxiomArrangement.renderAuto(snapshot,options);
        if(token!==generation||!rendered){rendered?.release?.();return;}
        timing.stage('encoding');status.textContent='Preparing WAV file…';
        const encoded=rendered.file?rendered:await (window.AxiomStreamExport?.canEncodeOffline?.()?window.AxiomStreamExport.encodeOffline(rendered,()=>token!==generation):encode(rendered,()=>token!==generation));
        if(token!==generation){encoded.release?.();return;}
        result=encoded;
        timing.stage('saving');
        status.textContent=nativeBridge()?(chosen?'Exporting audio… 90%':'Choose where to save your mix...'):'Requesting WAV download...';
        const receipt=await deliver({...result,release:undefined},filename,()=>token!==generation,(sent,total,stage)=>{if(token===generation)status.textContent=stage==='finishing'?'Finishing export…':'Exporting audio… '+(90+Math.floor(sent/total*9))+'%';},chosen,savedMetadata);
        if(token!==generation)return;
        keepDownload=receipt.state==='download-requested';
        renders.set(p,{signature,peaks:result.peaks,bands:result.bands,duration:result.duration});window.AxiomStudioDaw.refreshArrangement();
        status.textContent=receipt.state==='saved'?'Saved: '+receipt.path:'WAV download requested.';
        if(freeStems.checked&&receipt.state==='saved'&&window.AxiomStemCache?.discardAfterExport){
          try{
            const cleanup=await window.AxiomStemCache.discardAfterExport(p);
            if(cleanup.bytesFreed>0)status.textContent+=' Stem cache freed: '+(cleanup.bytesFreed/1024/1024).toFixed(0)+' MB.';
            else if(cleanup.busy?.length)status.textContent+=' Stem cache is still in use; AXIOM will clean it when playback/editing releases it.';
          }catch(error){status.textContent+=' Stem cache cleanup was skipped: '+error.message;}
        }
        complete=true;button.hidden=true;review.hidden=true;savedReceipt=receipt;
        outcome=receipt.state;timing.stage('library');
        if(addLibrary.checked&&receipt.state==='saved')await enroll();
      }catch(error){if(token===generation){outcome=/^(?:Save|Export) cancelled\b/.test(error.message)?'cancelled':'failed';cancelNativeSave();status.textContent=error.message;}}
      finally{timing.finish(outcome);if(token===generation){if(!complete)cancelNativeSave();busy=false;if(!complete)checkEnding();else button.disabled=true;format.disabled=complete;titleInput.disabled=complete;artistInput.disabled=complete;bpmInput.disabled=keyInput.disabled=complete;button.textContent='Continue';close.textContent=complete?'Done':'Cancel';discard();}}
    };
    document.body.append(dialog);dialog.showModal();
  }
  window.AxiomDawExport={open,encode,draw,overviewPeaks,deliver,cancelNativeSave,originalSong,endingReview,exportFilename,contentBounds,metadataDefaults,diagnostics:()=>JSON.parse(JSON.stringify(timingReceipts))};
})();
