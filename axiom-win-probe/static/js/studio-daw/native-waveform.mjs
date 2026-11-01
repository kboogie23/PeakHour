// Only used after the browser decoder rejects a source. This is preview PCM, not a playback replacement.
export async function nativeWaveform(path, context, {
  fetcher=fetch,
  busy=()=>Boolean(window.AxiomArrangement?.loading||window.AxiomArrangement?.playing),
  current=()=>true,
  wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  now=()=>performance.now(),
}={}) {
  const deadline=now()+180000;
  const deferred=()=>Object.assign(new Error('Waveform preparation yielded to playback.'),{code:'WAVEFORM_DEFERRED'});
  while(now()<deadline) {
    if(!current())throw new Error('Waveform source is no longer in the project.');
    if(busy())throw deferred();
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),125000);
    try {
      const response=await fetcher('/api/studio-daw/waveform',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path}),signal:controller.signal,
      });
      if(response.status===409||response.status===429){await wait(500);continue;}
      if(!response.ok)throw new Error((await response.json()).error||`Native waveform unavailable (${response.status})`);
      if(response.headers.get('X-AXIOM-Waveform-Decoder')!=='native-pcm-v1'||Number(response.headers.get('content-length'))>54*1024*1024)
        throw new Error('Invalid native waveform response.');
      const bytes=await response.arrayBuffer();
      if(bytes.byteLength>54*1024*1024)throw new Error('Native waveform exceeds the preview limit.');
      // Preparation may have started while the response was arriving.
      if(busy())throw deferred();
      if(now()>=deadline)break;
      return await context.decodeAudioData(bytes);
    } finally {clearTimeout(timeout);}
  }
  throw deferred();
}
