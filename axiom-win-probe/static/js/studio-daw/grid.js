(function () {
  'use strict';

  const existing = window.AxiomStudioDaw || {};

  function keySyncOffset(source,target){
    const parse=value=>/^([1-9]|1[0-2])([AB])$/.exec(String(value||'').trim().toUpperCase());
    const a=parse(source),b=parse(target);
    if(!a||!b)throw new Error('Both tracks need a verified Camelot key before key sync.');
    if(a[2]!==b[2])throw new Error('Major/minor conversion is not supported by pitch shifting. Choose an anchor in the same mode.');
    const tonic=key=>((key[2]==='A'?8:11)+(Number(key[1])-1)*7)%12;
    return ((tonic(b)-tonic(a)+18)%12)-6;
  }
  function playbackPitch(clip){return Number(clip.pitchSemitones||0)+Number(clip.keySync?.transpose||0);}
  function keySyncMatch(source,anchor){
    const sourceKey=String(source||'').trim().toUpperCase(),anchorKey=String(anchor||'').trim().toUpperCase();
    const valid=value=>/^([1-9]|1[0-2])[AB]$/.test(value);
    if(!valid(sourceKey)||!valid(anchorKey))throw new Error('Both tracks need a verified Camelot key before key sync.');
    const relative=sourceKey.slice(-1)!==anchorKey.slice(-1);
    const targetKey=relative?anchorKey.slice(0,-1)+sourceKey.slice(-1):anchorKey;
    return {anchorKey,targetKey,match:relative?'relative':'exact',transpose:keySyncOffset(sourceKey,targetKey)};
  }

  function anchorAtBeat(project,beat=0){
    const clips=(project.arrangementClips||[]).filter(c=>['left-deck','right-deck'].includes(c.sectionId)&&c.path&&c.timelineDurationBeats>0)
      .slice().sort((a,b)=>a.timelineStartBeat-b.timelineStartBeat||Number(a.trackIndex||0)-Number(b.trackIndex||0));
    if(project.mode!=='mixtape'){
      const path=project.anchorPath||project.sourceTrack?.path;
      return clips.find(c=>c.path===path)||project.sourceTracks?.find(c=>c.path===path)||project.sourceTrack||null;
    }
    const chosen=clips.filter(c=>c.transitionAnchor===true&&c.timelineStartBeat<=beat&&beat<c.timelineStartBeat+c.timelineDurationBeats).at(-1);
    if(chosen)return chosen;
    let anchor=null;
    const events=[...new Set(clips.flatMap(c=>[c.timelineStartBeat,c.timelineStartBeat+c.timelineDurationBeats]))].filter(at=>at<=beat).sort((a,b)=>a-b);
    for(const at of events){
      if(anchor && anchor.timelineStartBeat+anchor.timelineDurationBeats>at)continue;
      anchor=clips.find(c=>c.timelineStartBeat<=at && c.timelineStartBeat+c.timelineDurationBeats>at)||null;
    }
    return anchor;
  }

  function compileTempoMap(project) {
    const base=Number(project.sourceTrack?.bpm || 120);
    const points=(project.automationLanes?.find(lane=>lane.parameter==='bpm')?.points || []).map(p=>({...p}));
    if(!Number.isFinite(base) || base<=0) throw new Error('Project BPM must be positive.');
    points.sort((a,b)=>a.beat-b.beat);
    points.forEach((p,i)=>{
      if(!Number.isFinite(p.beat) || p.beat<0 || !Number.isFinite(p.value) || p.value<=0 || (i && p.beat===points[i-1].beat)) throw new Error('Tempo points require unique nonnegative beats and positive BPM.');
    });
    if(!points.length || points[0].beat>0) points.unshift({beat:0,value:base,curve:'hold'});
    const segments=[];
    let time=0;
    for(let i=0;i<points.length;i++) {
      const p=points[i],next=points[i+1],end=next?.beat ?? Infinity;
      const slope=next && p.curve!=='hold'?(next.value-p.value)/(end-p.beat):0;
      const elapsed=beats=>Math.abs(slope)<1e-12?60*beats/p.value:60*Math.log1p(slope*beats/p.value)/slope;
      const duration=next?elapsed(end-p.beat):Infinity;
      segments.push({beat:p.beat,end,time,endTime:time+duration,value:p.value,slope,elapsed});
      time+=duration;
    }
    function find(value,key) {
      let low=0,high=segments.length-1;
      while(low<high){const mid=Math.ceil((low+high)/2);if(segments[mid][key]<=value)low=mid;else high=mid-1;}
      return segments[low];
    }
    function position(value){if(!Number.isFinite(value) || value<0)throw new Error('Project position must be nonnegative.');}
    const beatToSeconds=beat=>{position(beat);const s=find(beat,'beat');return s.time+s.elapsed(beat-s.beat);};
    const secondsToBeat=seconds=>{position(seconds);const s=find(seconds,'time'),dt=seconds-s.time;return s.beat+(Math.abs(s.slope)<1e-12?dt*s.value/60:s.value*Math.expm1(dt*s.slope/60)/s.slope);};
    const bpmAtBeat=beat=>{position(beat);const s=find(beat,'beat');return s.value+s.slope*(beat-s.beat);};
    return {segments,beatToSeconds,secondsToBeat,bpmAtBeat};
  }

  function compileBeatgrid(reference) {
    if(!reference || !Array.isArray(reference.beatAnchors) || reference.beatAnchors.length<2) throw new Error('At least two beat/time anchors are required.');
    const anchors=reference.beatAnchors.map(anchor=>({beat:anchor.beat,seconds:anchor.seconds}));
    for(let i=0;i<anchors.length;i++) {
      const point=anchors[i],previous=anchors[i-1];
      if(!Number.isFinite(point.beat) || !Number.isFinite(point.seconds) || point.seconds<0) throw new Error('Grid anchors require finite beats and nonnegative seconds.');
      if(previous && (point.beat<=previous.beat || point.seconds<=previous.seconds)) throw new Error('Grid anchors must increase strictly in beat and time.');
    }
    function segment(value,key) {
      let low=0,high=anchors.length-1;
      while(low<high) {const mid=Math.ceil((low+high)/2);if(anchors[mid][key]<=value) low=mid;else high=mid-1;}
      return Math.min(low,anchors.length-2);
    }
    function convert(value,from,to) {
      if(!Number.isFinite(value)) throw new Error('Grid position must be finite.');
      const index=segment(value,from),a=anchors[index],b=anchors[index+1];
      return a[to]+(value-a[from])*(b[to]-a[to])/(b[from]-a[from]);
    }
    const bpmAtBeat=beat=>{
      if(!Number.isFinite(beat))throw new Error('Grid position must be finite.');
      const index=segment(beat,'beat'),a=anchors[index],b=anchors[index+1];
      return 60*(b.beat-a.beat)/(b.seconds-a.seconds);
    };
    return Object.freeze({anchors:Object.freeze(anchors.map(Object.freeze)),beatToSeconds:beat=>convert(beat,'beat','seconds'),secondsToBeat:seconds=>convert(seconds,'seconds','beat'),bpmAtBeat});
  }
  const maps=new WeakMap();
  function correctBeatAnchor(reference,beat,seconds,mode='fixed'){
    if(!Number.isFinite(beat)||!Number.isFinite(seconds)||seconds<0)throw new Error('Enter a finite beat at a valid source time.');
    if(!['fixed','shift'].includes(mode))throw new Error('Unknown beat correction mode.');
    const grid=compileBeatgrid(reference),delta=seconds-grid.beatToSeconds(beat);
    const anchors=grid.anchors.filter(point=>Math.abs(point.beat-beat)>1e-8).map(point=>({
      beat:point.beat,seconds:point.seconds+(mode==='shift'&&point.beat>beat?delta:0)
    }));
    // Keep the outgoing tempo even when correcting beyond the last stored anchor.
    if(mode==='shift'&&!anchors.some(point=>point.beat>beat))anchors.push({beat:beat+4,seconds:seconds+240/grid.bpmAtBeat(beat)});
    anchors.push({beat,seconds});anchors.sort((a,b)=>a.beat-b.beat);
    compileBeatgrid({beatAnchors:anchors});
    return anchors;
  }
  function trackGrid(track) {
    const reference=track?.beatgrid;
    if(!reference) return null;
    if(reference.trackPath!==track.path) throw new Error('Beatgrid belongs to a different source file.');
    if(!maps.has(reference)) maps.set(reference,compileBeatgrid(reference));
    return maps.get(reference);
  }
  function sourceBeatToSeconds(track,beat) {
    const grid=trackGrid(track);
    const seconds=grid?grid.beatToSeconds(beat):beat*60/(track.bpm || 120);
    // A round-trip through a downbeat-offset grid can put source zero a tiny
    // fraction below zero. Keep real negative ranges invalid, not roundoff.
    return Math.abs(seconds)<1e-9?0:seconds;
  }
  function sourceSecondsToBeat(track,seconds) {
    const grid=trackGrid(track);
    return grid?grid.secondsToBeat(seconds):seconds*(track.bpm || 120)/60;
  }

  function createBeatgridReference({ source, mode, trackPath, tempoSegments = [], beatAnchors = [], sourceHash = '', metadata = {} }) {
    if (!trackPath) {
      throw new Error('Studio DAW beatgrid references require a track path.');
    }
    if (['serato', 'djay', 'rekordbox', 'plugin'].includes(source) === false && source !== 'axiom' && source !== 'manual') {
      throw new Error('Studio DAW beatgrid source is not supported.');
    }
    return {
      source,
      mode,
      trackPath,
      tempoSegments,
      beatAnchors,
      sourceHash,
      metadata,
      readOnly: true,
    };
  }

  function validateDetectedBeatTimes(times){
    if(!Array.isArray(times)||times.length<4||times.some((t,i)=>!Number.isFinite(t)||t<0||(i&&t<=times[i-1])))throw new Error('Invalid detected beat times.');
    for(let i=2;i<times.length;i++){
      const previous=times[i-1]-times[i-2],current=times[i]-times[i-1];
      if(Math.max(previous,current)/Math.min(previous,current)>=1.65)throw new Error(`Ambiguous drum beat spacing near ${times[i-1].toFixed(2)} seconds. Analyze a shorter clip or place anchors manually; suggestions were not applied.`);
    }
    return true;
  }

  function waveformPeakTime(data,start,end){
    if(!data?.peaks?.length||!Number.isFinite(data.duration)||data.duration<=0||!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return null;
    const count=data.peaks.length,first=Math.max(0,Math.ceil(start/data.duration*count-.5)),last=Math.min(count,Math.ceil(end/data.duration*count-.5));
    let peak=-1,amplitude=0;
    for(let i=first;i<last;i++){const value=data.peaks[i];if(Number.isFinite(value)&&value>amplitude){amplitude=value;peak=i;}}
    return peak<0?null:(peak+.5)*data.duration/count;
  }

  window.AxiomStudioDaw = Object.freeze({
    ...existing,
    createBeatgridReference,
    compileTempoMap,anchorAtBeat,keySyncOffset,keySyncMatch,playbackPitch,
    compileBeatgrid,
    correctBeatAnchor,
    waveformPeakTime,validateDetectedBeatTimes,
    trackGrid,
    sourceBeatToSeconds,
    sourceSecondsToBeat,
  });
})();
