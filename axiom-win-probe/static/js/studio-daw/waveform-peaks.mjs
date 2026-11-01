// Preserve source bin boundaries and filter history while yielding UI time during analysis.
export async function waveformPeaks(audio, {now=()=>performance.now(),yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0)),budgetMs=4}={}) {
  const peaks=new Float32Array(Math.min(audio.length,262144));
  const bands=Array.from({length:3},()=>new Float32Array(peaks.length));
  const lowAlpha=1-Math.exp(-2*Math.PI*200/audio.sampleRate),midAlpha=1-Math.exp(-2*Math.PI*2000/audio.sampleRate);
  const batchBins=Math.max(1,Math.floor(32768/Math.max(1,Math.ceil(audio.length/peaks.length))));
  let started=now();
  for(let c=0;c<audio.numberOfChannels;c++) {
    const channel=audio.getChannelData(c);
    let low=0,upper=0;
    for(let i=0;i<peaks.length;i++) {
      const begin=Math.floor(i*channel.length/peaks.length),end=Math.floor((i+1)*channel.length/peaks.length);
      for(let j=begin;j<end;j++) {
        const sample=channel[j];peaks[i]=Math.max(peaks[i],Math.abs(sample));
        low+=lowAlpha*(sample-low);upper+=midAlpha*(sample-upper);
        bands[0][i]+=low*low;bands[1][i]+=(upper-low)**2;bands[2][i]+=(sample-upper)**2;
      }
      if((i+1)%batchBins===0&&now()-started>=budgetMs) {await yieldTask();started=now();}
    }
  }
  return {peaks,bands,duration:audio.duration};
}
