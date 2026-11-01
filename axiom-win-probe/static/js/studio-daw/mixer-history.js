(function () {
  'use strict';
  const histories=new WeakMap();
  let gesture=null;
  function history(p){if(!histories.has(p))histories.set(p,{undo:[],redo:[]});return histories.get(p);}
  function target(p,ref){return ref.scope==='clip'?p.arrangementClips.find(c=>c.id===ref.id):ref.id==='master'?p.masterMixer:p.rowMixer?.[ref.id];}
  const state=(object,key)=>({exists:Object.hasOwn(object,key),value:object[key]});
  const same=(a,b)=>a.exists===b.exists&&Object.is(a.value,b.value);
  function commit(p,changes){
    changes=changes.filter(c=>!same(c.before,c.after));if(!changes.length)return;
    const h=history(p);h.undo.push(changes);if(h.undo.length>100)h.undo.shift();h.redo=[];
    window.AxiomEditHistory?.record(p,'mixer');
  }
  function finish(cancel=false){
    if(!gesture)return;const {p,changes}=gesture;gesture=null;
    if(cancel){for(const change of changes){const object=target(p,change);if(object&&same(state(object,change.key),change.after)){if(change.before.exists)object[change.key]=change.before.value;else delete object[change.key];}}}
    else commit(p,changes);
  }
  function begin(p){finish();gesture={p,changes:[]};}
  function write(p,refs,key,value){
    if(gesture&&gesture.p!==p)finish();
    const changes=[];
    for(const ref of refs){
      const object=target(p,ref);if(!object)continue;
      const parameter=ref.scope==='clip'&&key.startsWith('mix')?key[3].toLowerCase()+key.slice(4):key;
      const automationRef={scope:ref.scope==='clip'?'clip':ref.id==='master'?'project':'deck',targetId:ref.id==='master'?'':ref.id,parameter};
      if(window.AxiomAutomationRecorder?.ready(p)&&window.AxiomDawAutomation?.supported(automationRef.scope,parameter)){
        window.AxiomAutomationRecorder.write(p,automationRef,value);continue;
      }
      const before=state(object,key);object[key]=value;const after=state(object,key);
      if(gesture){const prior=gesture.changes.find(c=>c.scope===ref.scope&&c.id===ref.id&&c.key===key);if(prior)prior.after=after;else gesture.changes.push({...ref,key,before,after});}
      else changes.push({...ref,key,before,after});
    }
    if(!gesture)commit(p,changes);
  }
  function undo(p,redo=false){
    if(window.AxiomEditHistory&&!window.AxiomEditHistory.dispatching)return window.AxiomEditHistory.undo(p,redo);
    finish();const h=history(p),from=redo?h.redo:h.undo,to=redo?h.undo:h.redo,changes=from.at(-1);if(!changes)return false;
    const expected=redo?'before':'after',desired=redo?'after':'before';
    // Validate every target before applying a grouped edit; never partially restore a selection.
    if(changes.some(c=>{const object=target(p,c);return !object||!same(state(object,c.key),c[expected]);}))return false;
    for(const c of changes){const object=target(p,c);if(c[desired].exists)object[c.key]=c[desired].value;else delete object[c.key];}
    from.pop();to.push(changes);return true;
  }
  window.AxiomMixerHistory={begin,finish,write,undo};
  window.AxiomEditHistory?.register('mixer',(p,redo)=>{
    const stems=JSON.stringify(p.arrangementClips.map(c=>['vocals','other','bass','drums'].map(name=>c['stemGain_'+name])));
    const before=JSON.stringify(p.arrangementClips.map(c=>[c.fadeInBeats,c.fadeOutBeats,c.fadeCurve]));
    const changed=undo(p,redo);if(changed){
      if(stems!==JSON.stringify(p.arrangementClips.map(c=>['vocals','other','bass','drums'].map(name=>c['stemGain_'+name])))){window.AxiomStems?.stop();window.AxiomArrangement?.stop(false);window.AxiomStudioDaw.refreshStemPanel?.();}
      if(before!==JSON.stringify(p.arrangementClips.map(c=>[c.fadeInBeats,c.fadeOutBeats,c.fadeCurve])))window.AxiomArrangement?.stop(false);window.AxiomArrangement?.mixerChanged(p);window.AxiomMixer?.refresh();window.AxiomMasterLimiter?.refresh();window.AxiomStudioDaw.refreshArrangement?.();}return changed;
  });
})();
