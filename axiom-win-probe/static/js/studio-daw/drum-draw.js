(function(){
  'use strict';
  let gesture=null,suppressClick=false;
  // Clip the pointer segment to each slot so fast movements cannot skip hits.
  function crosses(a,b,rect){
    let lo=0,hi=1;
    for(const [start,delta,min,max] of [[a.x,b.x-a.x,rect.left,rect.right],[a.y,b.y-a.y,rect.top,rect.bottom]]){
      if(Math.abs(delta)<1e-9){if(start<min||start>max)return false;continue;}
      const x=(min-start)/delta,y=(max-start)/delta;
      lo=Math.max(lo,Math.min(x,y));hi=Math.min(hi,Math.max(x,y));if(lo>hi)return false;
    }
    return true;
  }
  function valid(g){
    const p=window.AxiomStudioDaw.activeProject;if(p!==g.project)return false;
    const c=window.AxiomPatterns?.active(p);
    return p===g.project&&g.grid.isConnected&&c?.id===g.patternId&&JSON.stringify(c?.steps||p.stepPattern||{})===g.before;
  }
  function paint(g,a,b){
    const bounds=g.grid.getBoundingClientRect();
    for(const cell of g.grid.querySelectorAll('.studio-daw-step-cell')){
      const r=cell.getBoundingClientRect(),visible={left:Math.max(r.left,bounds.left,0),right:Math.min(r.right,bounds.right,window.innerWidth),top:Math.max(r.top,bounds.top,0),bottom:Math.min(r.bottom,bounds.bottom,window.innerHeight)};
      if(visible.left>=visible.right||visible.top>=visible.bottom||!crosses(a,b,visible))continue;
      const row=cell.dataset.hit,index=Number(cell.dataset.step);
      if(!g.rows.has(row))g.rows.set(row,new Set(g.steps[row]||[]));
      const hits=g.rows.get(row);g.add?hits.add(index):hits.delete(index);
      cell.classList.toggle('hit',g.add);cell.setAttribute('aria-pressed',String(g.add));
    }
  }
  function finish(commit=false){
    const g=gesture;if(!g)return;gesture=null;
    const apply=commit&&valid(g);
    g.grid.classList.remove('daw-drawing');
    try{g.grid.releasePointerCapture(g.pointerId);}catch{}
    // Restore the temporary drawing before committing through normal project history.
    for(const cell of g.grid.querySelectorAll('.studio-daw-step-cell')){
      const hit=(g.steps[cell.dataset.hit]||[]).includes(Number(cell.dataset.step));cell.classList.toggle('hit',hit);cell.setAttribute('aria-pressed',String(hit));
    }
    if(apply){
      window.AxiomStudioDaw.setPatternRows(Object.fromEntries([...g.rows].map(([row,hits])=>[row,[...hits].sort((a,b)=>a-b)])));
      window.AxiomDawDrafts?.checkpoint();
    }
  }
  document.addEventListener('pointerdown',event=>{
    suppressClick=false;
    const cell=event.target?.closest?.('#studio-daw-step-editor.daw-drum-editor .studio-daw-step-cell');
    if(!cell||cell.disabled||event.button!==0||event.isPrimary===false)return;
    finish();
    const project=window.AxiomStudioDaw?.activeProject;if(!project)return;
    const pattern=window.AxiomPatterns?.active(project);if(pattern?.kind==='midi')return;
    const steps=pattern?.steps||(window.AxiomPatterns?{}:project.stepPattern||{}),point={x:event.clientX,y:event.clientY};
    const grid=cell.closest('.studio-daw-step-grid');
    gesture={project,patternId:pattern?.id,before:JSON.stringify(pattern?.steps||project.stepPattern||{}),steps,grid,pointerId:event.pointerId,previous:point,rows:new Map(),add:!(steps[cell.dataset.hit]||[]).includes(Number(cell.dataset.step))};
    suppressClick=true;event.preventDefault();cell.focus({preventScroll:true});grid.classList.add('daw-drawing');
    grid.setPointerCapture?.(event.pointerId);paint(gesture,point,point);
  },true);
  document.addEventListener('pointermove',event=>{
    const g=gesture;if(!g||event.pointerId!==g.pointerId)return;
    if(!valid(g)){finish();return;}
    event.preventDefault();const point={x:event.clientX,y:event.clientY};paint(g,g.previous,point);g.previous=point;
  },{capture:true,passive:false});
  document.addEventListener('pointerup',event=>{
    if(!gesture||event.pointerId!==gesture.pointerId)return;
    const g=gesture;if(valid(g))paint(g,g.previous,{x:event.clientX,y:event.clientY});finish(true);
  },true);
  document.addEventListener('pointercancel',()=>finish(),true);
  document.addEventListener('lostpointercapture',event=>{if(gesture?.pointerId===event.pointerId)finish();},true);
  document.addEventListener('click',event=>{if(suppressClick&&event.detail>0){suppressClick=false;event.preventDefault();event.stopImmediatePropagation();}},true);
  document.addEventListener('keydown',event=>{if(gesture&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();finish();}},true);
  window.addEventListener('blur',()=>finish());window.addEventListener('pagehide',()=>finish());
  window.AxiomDrumDraw=Object.freeze({crosses,cancel:()=>finish(),get active(){return Boolean(gesture);}});
})();
