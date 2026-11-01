// "Adding your music" on Windows (windows_intake.py): percentage, files per second and time left from
// /api/windows/import-progress; "Hide progress" really hides the window (AXIOM's status checks reopened it
// every 1.2 s) and a slim meter at the top keeps showing the import, with Show to bring the window back.
// The window fits laptop screens and uses PEAK HOUR's crate and red folder icon.
(function(){
 'use strict';
 const api='/api/windows/import-progress';
 let dismissed=false,latest=null,timer=null;
 const byId=id=>document.getElementById(id);
 const plural=(n,word)=>`${Number(n).toLocaleString()} ${word}${n===1?'':'s'}`;
 function timeLeft(seconds){
  if(seconds==null)return '';
  if(seconds<60)return 'less than a minute left';
  const minutes=Math.round(seconds/60);
  if(minutes<60)return `about ${plural(minutes,'minute')} left`;
  const hours=Math.floor(minutes/60),rest=minutes%60;
  return `about ${plural(hours,'hour')}${rest?` ${plural(rest,'minute')}`:''} left`;
 }
 function describe(p,counts=true){
  const finishing=p.total&&p.processed>=p.total;  // every file found; the library is being saved and linked
  if(finishing)return p.step===2?'Step 2 of 2: saving track details':'Step 1 of 2: all files found, saving your library';
  const step=p.step===2?'Step 2 of 2: reading track details (BPM, key, year)':'Step 1 of 2: finding your music';
  const parts=[step];
  if(p.total){if(counts)parts.push(`${p.processed.toLocaleString()} of ${p.total.toLocaleString()}`);}
  else if(p.counting)parts.push(`counting files, ${p.files_found.toLocaleString()} found so far`);
  else if(p.processed&&counts)parts.push(`${p.processed.toLocaleString()} done`);
  if(p.files_per_second)parts.push(`${p.files_per_second.toLocaleString()} files a second`);
  const left=timeLeft(p.seconds_left);if(left)parts.push(left);
  return parts.join(' · ');
 }
 function meter(){
  let el=byId('ph-import-meter');
  if(el)return el;
  el=document.createElement('div');el.id='ph-import-meter';el.hidden=true;el.setAttribute('role','status');
  el.innerHTML='<div class="ph-import-meter-bar"><span></span></div><div class="ph-import-meter-pill"><strong>Adding music</strong><span class="ph-import-meter-text"></span><button type="button">Show</button></div>';
  el.querySelector('button').addEventListener('click',reopen);
  document.body.appendChild(el);
  return el;
 }
 function renderMeter(){
  const el=meter(),p=latest;
  const running=p&&p.active&&(dismissed||p.library_ready);
  el.hidden=!running;
  if(!running)return;
  el.querySelector('strong').textContent=p.library_ready?'Reading track details':'Adding music';
  el.querySelector('.ph-import-meter-text').textContent=`${p.percent!=null?`${p.percent}% · `:''}${describe(p).replace(/^Step [12] of 2: [^·]*· ?/,'')}`;
  el.querySelector('button').hidden=p.library_ready;  // the window closes once the library is usable
  const bar=el.querySelector('.ph-import-meter-bar span');
  el.classList.toggle('is-indeterminate',p.percent==null);
  bar.style.width=p.percent!=null?`${Math.max(2,p.percent)}%`:'';
 }
 function decorate(){
  const overlay=byId('music-intake-overlay');
  if(!overlay)return;
  overlay.querySelector('.vault-crate')?.setAttribute('src','/static/brand/vault-crate.png');
  overlay.querySelector('.vault-source img')?.setAttribute('src','/static/brand/folder-open-red.svg');
  const message=byId('music-intake-message');
  if(message){
   message.textContent=message.textContent.replace(/\b1 folders\b/g,'1 folder').replace(/\s*·\s*\d+s live/,'').replace(/ (?:AXIOM|PEAK HOUR) is reading metadata while source audio stays untouched\.?/,'');
  }
  const kicker=byId('music-intake-kicker'),p=latest;
  if(kicker&&p&&p.active&&!p.library_ready)kicker.textContent=describe(p,false);  // the window shows its own count below the bar
  if(p&&p.active&&!p.library_ready&&p.percent!=null){
   const summary=byId('music-intake-percent-summary');if(summary)summary.textContent=`${p.percent}%`;
  }
 }
 async function poll(){
  clearTimeout(timer);
  try{
   const r=await fetch(api,{cache:'no-store'});
   if(r.ok){const data=await r.json();latest=data.active||latest?.active?data:null;}
  }catch(error){}
  renderMeter();decorate();
  timer=latest&&latest.active?setTimeout(poll,1000):null;
 }
 function reopen(){
  dismissed=false;
  const overlay=byId('music-intake-overlay');
  if(overlay&&latest&&latest.active&&!latest.library_ready){overlay.classList.remove('hidden');requestAnimationFrame(()=>overlay.classList.add('active'));}
  renderMeter();
 }
 function wrap(name,make){
  const original=window[name];
  if(typeof original==='function')window[name]=make(original);
 }
 wrap('showMusicIntakeOverlay',original=>function(...args){dismissed=false;const result=original.apply(this,args);decorate();poll();return result;});
 wrap('hideMusicIntakeOverlay',original=>function(...args){
  if(latest?.active||byId('music-intake-overlay')?.classList.contains('is-loading'))dismissed=true;
  const result=original.apply(this,args);renderMeter();return result;
 });
 wrap('renderMusicIntakeOverlay',original=>function(...args){
  const result=original.apply(this,args);
  const overlay=byId('music-intake-overlay');
  if(dismissed&&overlay){overlay.classList.remove('active');overlay.classList.add('hidden');}
  decorate();
  if(!timer)poll();
  return result;
 });
 wrap('completeMusicIntakeOverlay',original=>function(...args){const result=original.apply(this,args);dismissed=false;poll();return result;});
 document.addEventListener('DOMContentLoaded',poll);  // an import still running after a reload shows in the meter
})();
