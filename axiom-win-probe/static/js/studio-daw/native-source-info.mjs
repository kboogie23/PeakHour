// The native probe counts full decoded EOF and returns bounded envelope data.
// No browser AudioBuffer or encoded whole-file download is needed for long music.
export async function nativeSourceInfo(path, {fetcher=fetch,current=()=>true,
  busy=()=>Boolean(window.AxiomArrangement?.loading||window.AxiomArrangement?.playing),
  wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  while(current()) {
    if(busy())throw Object.assign(new Error('Waveform preparation yielded to playback.'),{code:'WAVEFORM_DEFERRED'});
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
    let data;
    try {
      const response=await fetcher('/api/studio-daw/assets/check',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({paths:[path],metadataOnly:true,verifyDecoded:true,waveform:true}),signal:controller.signal});
      data=await response.json();
      if(!response.ok)throw new Error(data.error||'Native source verification is unavailable.');
    } finally {clearTimeout(timeout);}
    const asset=data.assets?.find(asset=>asset.path===path);
    if(asset?.status==='pending'){await wait(250);continue;}
    if(asset?.status!=='ready'||asset.decodedEOF!==true||!Number.isFinite(asset.durationSec)||asset.durationSec<=0)
      throw new Error(asset?.reason||'Restart the updated local AXIOM engine for full-source verification.');
    if(!Array.isArray(asset.peaks)||!asset.peaks.length||asset.peaks.length>32768||asset.peaks.some(p=>!Number.isFinite(p)||p<0||p>1)
      ||!Number.isFinite(asset.peakSpanSeconds)||asset.peakSpanSeconds<asset.durationSec)
      throw new Error('Native waveform envelope is invalid.');
    return {...asset,duration:asset.durationSec,peaks:new Float32Array(asset.peaks)};
  }
  throw new Error('Waveform source is no longer in the project.');
}
