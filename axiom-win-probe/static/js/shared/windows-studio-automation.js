// PEAK HOUR (Windows): draws the volume, trim and filter automation on the Studio DAW timeline. Until now only the BPM
// curve was drawn although the other lanes played and exported. Each clip's lanes (project.automationLanes with scope
// "clip") are drawn as a coloured curve inside the clip; deck and master lanes across the deck's lane / the master clip.
// Read-only: the small label buttons ("Filter", "Volume", "Trim") open the existing Parameter Automation dialog to edit.
// The curves use the clips' own view maths (the lanes' data-view-start / data-view-beats, the clip's timelineStartBeat
// and timelineDurationBeats) so they scale and scroll with timeline zoom. They are redrawn whenever the lanes are
// rendered again (zoom, scroll, edits, undo, a new project), which is the only time the clips are rebuilt.
(function(){
 'use strict';
 const SVG='http://www.w3.org/2000/svg';
 const KINDS={filterPosition:['filter','Filter'],volume:['volume','Volume'],gainDb:['trim','Trim']};
 const ORDER=['filterPosition','volume','gainDb'];
 const api=()=>window.AxiomStudioDaw;
 const lanesEl=()=>document.getElementById('studio-daw-lanes');
 const masterEl=()=>document.getElementById('studio-daw-master-strip');
 let painting=false,frame=0,lastSignature='',lastCount=0;

 const definition=parameter=>window.AxiomDawAutomation?.definitions?.[parameter]||null;  // [label,min,max,default]

 // The value the engine uses between points (automation.js valueAt): flat before the first point, linear or hold after.
 function valueAt(points,beat,fallback){
  if(!points.length||beat<points[0].beat)return fallback;
  for(let i=1;i<points.length;i++){
   const a=points[i-1],b=points[i];
   if(beat<b.beat)return a.curve==='hold'?a.value:a.value+(b.value-a.value)*(beat-a.beat)/(b.beat-a.beat);
  }
  return points[points.length-1].value;
 }

 // Curve vertices as [beat, value], from visible start to visible end (lane beats), with steps for hold points.
 function vertices(points,from,to,fallback){
  const out=[[from,valueAt(points,from,fallback)]];
  points.forEach((point,i)=>{
   if(point.beat<=from||point.beat>=to)return;
   const before=points[i-1];
   if(!before||before.curve==='hold')out.push([point.beat,before?before.value:fallback]);  // a step, not a slope
   out.push([point.beat,point.value]);
  });
  out.push([to,valueAt(points,to,fallback)]);
  return out;
 }

 function lanePoints(lane){
  return (lane.points||[]).filter(p=>Number.isFinite(p?.beat)&&Number.isFinite(p?.value)).sort((a,b)=>a.beat-b.beat);
 }

 function curve(lane,shift,visibleStart,visibleEnd,fallback){
  const def=definition(lane.parameter);
  if(!def||!(visibleEnd>visibleStart))return '';
  const [,min,max]=def,span=visibleEnd-visibleStart;
  const pts=lanePoints(lane).map(p=>({...p,beat:p.beat+shift}));
  if(!pts.length)return '';
  return vertices(pts,visibleStart,visibleEnd,fallback).map(([beat,value])=>{
   const x=(beat-visibleStart)/span*100,y=94-(Math.max(min,Math.min(max,value))-min)/((max-min)||1)*88;
   return `${x.toFixed(3)},${y.toFixed(3)}`;
  }).join(' ');
 }

 function chip(kind,label,ref,parameter){
  const button=document.createElement('button');
  button.type='button';button.className='ph-auto-chip ph-auto-'+kind;button.textContent=label;
  button.title=`${label} automation (drawn on the timeline). Click to edit.`;
  button.setAttribute('aria-label',`Edit ${label} automation`);
  for(const type of ['pointerdown','mousedown','dblclick','contextmenu'])button.addEventListener(type,event=>event.stopPropagation());
  button.addEventListener('click',event=>{
   event.preventDefault();event.stopPropagation();
   window.AxiomDawAutomation?.edit?.([ref],parameter);
  });
  button.draggable=false;
  return button;
 }

 // entries: [{lane, parameter}] drawn into host; shift/from/to are in absolute timeline beats; fallbacks per parameter.
 function overlay(host,entries,ref,shift,from,to,fallbackFor){
  const wrap=document.createElement('div');wrap.className='ph-auto';wrap.setAttribute('data-ph-auto','');
  const svg=document.createElementNS(SVG,'svg');
  svg.setAttribute('viewBox','0 0 100 100');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('aria-hidden','true');
  const legend=document.createElement('span');legend.className='ph-auto-legend';
  let drawn=0;
  for(const {lane,parameter} of entries){
   const [kind,label]=KINDS[parameter];
   const points=curve(lane,shift,from,to,fallbackFor(parameter));
   if(!points)continue;
   const line=document.createElementNS(SVG,'polyline');
   line.setAttribute('class','ph-auto-line ph-auto-'+kind);line.setAttribute('points',points);
   line.setAttribute('data-ph-auto-parameter',parameter);line.setAttribute('data-ph-auto-scope',ref.scope);
   svg.appendChild(line);legend.appendChild(chip(kind,label,ref,parameter));drawn++;
  }
  if(!drawn)return;
  wrap.append(svg,legend);host.appendChild(wrap);
 }

 const wanted=(project,scope,targetId)=>
  ORDER.map(parameter=>({parameter,lane:(project.automationLanes||[]).find(l=>l&&l.scope===scope&&(l.targetId||'')===targetId&&l.parameter===parameter&&l.enabled!==false&&Array.isArray(l.points)&&l.points.length)}))
   .filter(entry=>entry.lane);

 function paint(){
  frame=0;
  const lanes=lanesEl(),master=masterEl(),project=api()?.activeProject;
  if(!lanes||!project||!window.AxiomDawAutomation)return;
  painting=true;
  try{
   const existingOverlays=document.querySelectorAll('#studio-daw-lanes .ph-auto, #studio-daw-master-strip .ph-auto');
   const drawable=(project.automationLanes||[]).filter(l=>l&&KINDS[l.parameter]&&l.enabled!==false&&l.points?.length);
   const viewStart=Number(lanes.dataset.viewStart)||0,viewBeats=Number(lanes.dataset.viewBeats)||0;
   // Nothing changed since the last drawing and every overlay is still in the page: leave them alone.
   const signature=JSON.stringify([viewStart,viewBeats,drawable,document.querySelectorAll('#studio-daw-lanes .studio-daw-clip').length,(project.arrangementClips||[]).map(c=>[c.id,c.timelineStartBeat,c.timelineDurationBeats])]);
   if(signature===lastSignature&&existingOverlays.length===lastCount&&[...existingOverlays].every(node=>node.isConnected))return;
   existingOverlays.forEach(node=>node.remove());
   lastSignature='';lastCount=0;
   if(!drawable.length||!(viewBeats>0))return;
   const viewEnd=viewStart+viewBeats;
   const defaults=parameter=>definition(parameter)?.[3]??0;
   // clips
   for(const article of lanes.querySelectorAll('.studio-daw-clip[data-daw-clip-id]')){
    const clip=(project.arrangementClips||[]).find(c=>c.id===article.dataset.dawClipId);
    if(!clip)continue;
    const entries=wanted(project,'clip',clip.id);
    if(!entries.length)continue;
    const start=clip.timelineStartBeat,end=start+clip.timelineDurationBeats;
    const from=Math.max(viewStart,start),to=Math.min(viewEnd,end);
    overlay(article,entries,{scope:'clip',targetId:clip.id},start,from,to,parameter=>{
     const key='mix'+parameter[0].toUpperCase()+parameter.slice(1);
     return Number.isFinite(clip[key])?clip[key]:defaults(parameter);
    });
   }
   // deck lanes: the whole lane, absolute beats
   for(const section of lanes.querySelectorAll('.studio-daw-lane[data-daw-section]:not(.studio-daw-master-lane)')){
    const id=section.dataset.dawSection,body=section.querySelector('.studio-daw-lane-body');
    const entries=body?wanted(project,'deck',id):[];
    if(entries.length)overlay(body,entries,{scope:'deck',targetId:id},0,viewStart,viewEnd,defaults);
   }
   // master volume: across the master clip
   const entries=wanted(project,'project','');
   const masterClip=master?.querySelector('.studio-daw-master-clip');
   if(entries.length&&masterClip)overlay(masterClip,entries,{scope:'project',targetId:''},0,viewStart,viewEnd,defaults);
   lastCount=document.querySelectorAll('#studio-daw-lanes .ph-auto, #studio-daw-master-strip .ph-auto').length;
   lastSignature=lastCount?signature:'';
  }finally{
   painting=false;
   observe();
  }
 }

 function schedule(){if(!frame)frame=requestAnimationFrame(paint);}

 let observer=null;
 function relevant(records){
  const ours=node=>node.nodeType===1&&node.matches?.('[data-ph-auto]');
  return records.some(record=>{
   if(record.target.nodeType===1&&record.target.closest?.('[data-ph-auto]'))return false;
   const nodes=[...record.addedNodes,...record.removedNodes];
   return !nodes.length||nodes.some(node=>!ours(node));
  });
 }
 function observe(){
  if(!observer)observer=new MutationObserver(records=>{if(!painting&&relevant(records))schedule();});
  observer.disconnect();
  const shell=document.getElementById('studio-daw-shell');
  if(shell)observer.observe(shell,{childList:true,subtree:true});
 }

 function start(){
  observe();schedule();
  // the DAW shell can be built after this file loads
  if(!document.getElementById('studio-daw-shell'))document.addEventListener('DOMContentLoaded',()=>{observe();schedule();});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
 window.AxiomWindowsStudioAutomation=Object.freeze({repaint:paint});
})();
