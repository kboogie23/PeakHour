// A live amplitude overview from measured source peaks. Overlapping peaks are
// an envelope, not a phase-accurate render; the completed export replaces it.
export function masterWaveform(project, width, totalBeats, source, api, automation) {
  const columns=new Float32Array(width),bands=Array.from({length:3},()=>new Float32Array(width)),map=api.compileTempoMap(project);
  const solos=Object.values(project.rowMixer||{}).some(row=>row.solo)||project.arrangementClips.some(c=>c.mixSolo);
  const lanes=new Map((project.automationLanes||[]).map(l=>[[l.scope,l.targetId||'',l.parameter].join(':'),l]));
  const level=(scope,id,parameter,beat,fallback)=>{
    const lane=lanes.get([scope,id,parameter].join(':'));
    return lane&&automation?automation.valueAt(lane,beat,fallback):fallback;
  };
  const gain=(scope,id,beat,settings,prefix='')=>{
    const key=name=>prefix?prefix+name[0].toUpperCase()+name.slice(1):name;
    const volume=level(scope,id,'volume',beat,settings[key('volume')]??1);
    const db=level(scope,id,'gainDb',beat,settings[key('gainDb')]??0);
    return Math.max(0,Math.min(1,volume))*10**(Math.max(-24,Math.min(12,db))/20);
  };
  let missing=false;
  for(const clip of project.arrangementClips){
    const row=project.rowMixer?.[clip.sectionId]||{},master=project.masterMixer||{};
    if(clip.muted||clip.mixMuted||row.muted||master.muted||solos&&!row.solo&&!clip.mixSolo)continue;
    const data=source(clip.path);
    if(!data?.peaks){missing=true;continue;}
    const start=clip.timelineStartBeat,end=start+clip.timelineDurationBeats;
    if(!(end>start))continue;
    const sourceAt=beat=>api.sourceBeatToSeconds(clip,clip.sourceStartBeat+(beat-start)*clip.sourceDurationBeats/clip.timelineDurationBeats);
    let fadeIn=Math.min(clip.timelineDurationBeats,clip.fadeInBeats||0),fadeOut=Math.min(clip.timelineDurationBeats,clip.fadeOutBeats||0);
    if(fadeIn+fadeOut>clip.timelineDurationBeats){const scale=clip.timelineDurationBeats/(fadeIn+fadeOut);fadeIn*=scale;fadeOut*=scale;}
    for(let x=Math.max(0,Math.floor(start/totalBeats*width));x<Math.min(width,Math.ceil(end/totalBeats*width));x++){
      const a=Math.max(start,x/width*totalBeats),b=Math.min(end,(x+1)/width*totalBeats),beat=(a+b)/2;
      const span=data.peakSpanSeconds||data.duration;
      const first=Math.max(0,Math.floor(sourceAt(a)/span*data.peaks.length)),last=Math.min(data.peaks.length,Math.ceil(sourceAt(b)/span*data.peaks.length));
      let peak=0;for(let i=first;i<last;i++)peak=Math.max(peak,data.peaks[i]);
      const time=map.beatToSeconds(beat),from=map.beatToSeconds(start),to=map.beatToSeconds(end);
      let fade=Math.min(1,fadeIn?(time-from)/(map.beatToSeconds(start+fadeIn)-from):1,fadeOut?(to-time)/(to-map.beatToSeconds(end-fadeOut)):1);
      if(clip.fadeCurve==='equal-power')fade=Math.sin(fade*Math.PI/2);
      const amplitude=fade*gain('clip',clip.id,beat-start,clip,'mix')*gain('deck',clip.sectionId,beat,row)*gain('project','',beat,master);
      columns[x]+=peak*amplitude;
      if(data.bands)for(let band=0;band<3;band++){
        let energy=0;for(let i=first;i<last;i++)energy+=data.bands[band][i];
        bands[band][x]+=energy/Math.max(1,last-first)*data.peaks.length/span*amplitude**2;
      }
    }
  }
  return {columns,bands,missing};
}

export function waveformColor(low,mid,high) {
  const max=Math.max(low,mid,high,1e-9);
  return `rgb(${Math.round(70+185*low/max)},${Math.round(45+180*mid/max)},${Math.round(45+200*high/max)})`;
}
