(function(){
  'use strict';
  const copy=value=>JSON.parse(JSON.stringify(value));
  // A deck effect follows its musical trigger (the end of its active region).
  // Splitting audio transfers that trigger to the fragment containing it.
  function reconcile(p,beforeClips,beforeFx,beforeAutomation,copies={}){
    const daw=window.AxiomStudioDaw,after=p.arrangementClips||[],templates=new Map(beforeFx.map(f=>[f.id,f]));
    const sources=new Map(beforeClips.map(c=>[c.id,c])),lanes=new Map();
    for(const lane of beforeAutomation)if(lane.scope==='fx'){
      if(!lanes.has(lane.targetId))lanes.set(lane.targetId,[]);lanes.get(lane.targetId).push(lane);
    }
    for(const origin of Object.values(copies)){
      if(!sources.has(origin.clip.id))sources.set(origin.clip.id,origin.clip);
      for(const fx of origin.fxRegions||[])if(!templates.has(fx.id))templates.set(fx.id,fx);
      for(const lane of origin.fxAutomation||[])if(lane.scope==='fx'&&!lanes.has(lane.targetId))lanes.set(lane.targetId,origin.fxAutomation.filter(l=>l.scope==='fx'&&l.targetId===lane.targetId));
    }
    const regions=[],automation=(p.automationLanes||[]).filter(l=>l.scope!=='fx'||!templates.has(l.targetId));
    const keep=(fx,id=fx.id)=>{
      regions.push({...fx,id});
      for(const lane of lanes.get(fx.id)||[])automation.push({...copy(lane),targetId:id});
    };
    for(const fx of templates.values()){
      const original=beforeFx.some(f=>f.id===fx.id);
      if(fx.target==='master'||fx.followAudio===false){if(original)keep(fx);continue;}
      const end=fx.startBeat+fx.durationBeats;
      const sourcePool=fx.clipId&&sources.has(fx.clipId)?[sources.get(fx.clipId)]:[...sources.values()];
      const candidates=sourcePool.filter(c=>c.sectionId===fx.target&&c.timelineStartBeat<end&&c.timelineStartBeat+c.timelineDurationBeats>fx.startBeat);
      const owner=candidates.find(c=>c.timelineStartBeat<end&&c.timelineStartBeat+c.timelineDurationBeats>=end-1e-7)||candidates.at(-1);
      if(!owner){if(original)keep(fx);continue;}
      const trigger=Math.min(end,owner.timelineStartBeat+owner.timelineDurationBeats);
      let usedOriginal=false;
      for(const clip of after){
        if(clip.id!==owner.id&&copies[clip.id]?.clip?.id!==owner.id)continue;
        const reversed=Boolean(owner.reversed&&clip.reversed),travel=(trigger-owner.timelineStartBeat)*owner.sourceDurationBeats/owner.timelineDurationBeats;
        const sourceBeat=reversed?owner.sourceStartBeat+owner.sourceDurationBeats-travel:owner.sourceStartBeat+travel;
        const seconds=daw.sourceBeatToSeconds(owner,sourceBeat);
        const sourceAt=daw.sourceSecondsToBeat(clip,seconds),from=clip.sourceStartBeat,to=from+clip.sourceDurationBeats;
        // Exact split boundaries belong to the preceding fragment.
        if(reversed?sourceAt<from-1e-7||sourceAt>=to-1e-7:sourceAt<=from+1e-7||sourceAt>to+1e-7)continue;
        const nextTrigger=clip.timelineStartBeat+(reversed?to-sourceAt:sourceAt-from)*clip.timelineDurationBeats/clip.sourceDurationBeats;
        const delta=nextTrigger-trigger,start=Math.max(0,fx.startBeat+delta);
        const next={...fx,target:clip.sectionId,startBeat:start};
        if(fx.clipId)next.clipId=clip.id;
        const id=!usedOriginal&&original?fx.id:crypto.randomUUID();usedOriginal=true;
        keep(next,id);
      }
    }
    p.fxRegions=regions;p.automationLanes=automation;
  }
  window.AxiomFxFollow={reconcile};
})();
