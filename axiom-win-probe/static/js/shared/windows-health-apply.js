// Health apply results on Windows (windows_apply_wording.py words the errors). Two actions on the Health review page
// gave almost no visible status: DJ Metadata Publish (a header line while it ran, "Completed With Skips" with the reasons
// buried afterwards) and Title/Artist Cleanup (one request; only "Applying..." on the button and a toast that the page
// replaces 100 ms later). This shows one status bar at the top of the page: what is running, how far it is, and what the
// result was, until Hide is pressed or the page is left. It watches the answers of those routes (the same way
// windows-health-snapshot.js watches /api/library/health), so AXIOM's own Health scripts and toasts are not changed.
// The bar sits outside #health-review-container, so the page re-rendering its list does not remove it.
(() => {
 'use strict';
 const CLEANUP='/api/library/utility_metadata_cleanup';
 const PUBLISH_ROUTE=/^\/api\/library\/metadata_publish\/(status|apply|rollback)$/;
 const GENERIC='This file could not be changed.';
 let node=null, tab=null, tabWatch=null, sawApply=false, lastAction='apply', cleanup=null, parts=null, lostTimer=null;

 function plural(count,one,many){return `${count.toLocaleString()} ${count===1?one:many}`}
 function plain(text){  // no "[Errno 9]" ever reaches the screen, even if the server did not reword it
  const clean=String(text==null?'':text).replace(/\s*\[(?:Errno|WinError) -?\d+\]\s*/g,' ').replace(/\s+/g,' ').trim();
  return clean||GENERIC;
 }
 function why(text){return text?plain(text):'PEAK HOUR stopped before it could change anything.'}
 function sentence(text){return plain(text).replace(/[.\s]+$/,'')}
 function number(value){const n=Number(value);return Number.isFinite(n)?n:0}

 function stopLostTimer(){if(lostTimer!==null){clearTimeout(lostTimer);lostTimer=null}}
 function remove(){
  stopLostTimer();
  if(tabWatch){tabWatch.disconnect();tabWatch=null}
  tab=null;
  if(node&&node.parentNode)node.parentNode.removeChild(node);
 }
 function build(){
  const element=document.createElement('div');
  element.id='ph-apply-status';element.className='ph-apply-status';
  element.setAttribute('role','status');element.setAttribute('aria-live','polite');
  const title=document.createElement('strong');title.className='ph-apply-title';
  const detail=document.createElement('span');detail.className='ph-apply-detail';
  const bar=document.createElement('div');bar.className='ph-apply-bar';
  const fill=document.createElement('div');fill.className='ph-apply-fill';
  bar.appendChild(fill);
  const close=document.createElement('button');close.type='button';close.className='ph-apply-close';close.textContent='Hide';
  close.addEventListener('click',()=>{sawApply=false;remove()});
  element.append(title,detail,bar,close);
  parts={title,detail,fill};
  return element;
 }
 function place(){  // returns false when there is no page to show it on
  const review=document.getElementById('tab-content-health-review');
  let host=null,head=null;
  if(review&&!review.classList.contains('hidden')){host=review;head=review.querySelector('.health-review-page-head')}
  else host=document.querySelector('.tab-content:not(.hidden)');
  if(!host)return false;
  if(node&&node.isConnected&&tab===host)return true;
  remove();
  if(!node)node=build();
  if(head&&head.parentNode===host)head.insertAdjacentElement('afterend',node);
  else host.insertBefore(node,host.firstChild);
  tab=host;
  tabWatch=new MutationObserver(()=>{if(tab&&tab.classList.contains('hidden'))remove()});
  tabWatch.observe(tab,{attributes:true,attributeFilter:['class']});
  return true;
 }
 function show(state,title,detail,percent){  // percent: a number while running with progress, 'wait' for an unknown wait
  stopLostTimer();  // any new state replaces "Checking…", so its timer no longer applies
  if(!place())return;
  node.dataset.state=state;
  parts.title.textContent=title;
  parts.detail.textContent=detail||'';
  parts.fill.classList.toggle('is-waiting',percent==='wait');
  parts.fill.style.width=percent==='wait'?'100%':`${Math.max(0,Math.min(100,number(percent)))}%`;
 }

 function parseBody(body){
  if(body&&typeof body==='object')return body;
  try{const value=JSON.parse(body);return value&&typeof value==='object'?value:{}}catch(_){return {}}
 }
 function firstReason(data){  // per-song reasons, when the answer carries them
  for(const key of ['skipped','failed','failures','errors','conflicts']){
   const list=data&&data[key];
   if(Array.isArray(list)){
    const row=list.find(item=>item&&typeof item==='object'&&(item.reason||item.error));
    if(row)return sentence(row.reason||row.error);
   }
  }
  return '';
 }

 function observeCleanup(requestBody,data,ok){
  const request=parseBody(requestBody);
  const apply=request.apply!==false;
  const paths=Array.isArray(request.paths)?request.paths.length:0;
  if(data==null){  // the request was just made
   cleanup={apply,total:paths};
   const what=paths?plural(paths,'change','changes'):'changes';
   show('running',`${apply?'Applying':'Undoing'} ${what}…`,'This can take a moment. Keep this page open.','wait');
   return;
  }
  const total=cleanup&&cleanup.apply===apply&&cleanup.total?cleanup.total:paths;
  cleanup=null;
  const verb=apply?'applied':'undone';
  if(data.lost){  // the request itself failed: whether the server finished is not known
   show('failed','PEAK HOUR could not confirm the changes','The connection dropped. Open the list again to see what was applied.',null);
   return;
  }
  if(!ok||data.success===false){
   show('failed',apply?'No changes were applied':'No changes were undone',why(data.error||data.message),null);
   return;
  }
  const count=number(data.count);
  const wanted=total||count;
  if(count>=wanted&&count>0){
   show('ok',`${plural(count,'change','changes')} ${verb}`,'Saved in PEAK HOUR only. Your music files were not changed.',null);
   return;
  }
  const reason=firstReason(data);
  show(count>0?'partial':'failed',
   count>0?`${count.toLocaleString()} ${verb}, ${(wanted-count).toLocaleString()} could not be ${verb}`:(apply?'No changes were applied':'No changes were undone'),
   `Those songs were left as they were. See the list below.${reason?` First reason: ${reason}.`:''}`,null);
 }

 function observePublish(path,data,ok){
  const action=path.slice(path.lastIndexOf('/')+1);
  const starting=action==='apply'||action==='rollback';
  if(starting&&data==null){lastAction=action;sawApply=true;show('running','Starting…','This can take a moment. Keep this page open.','wait');return}
  if(data==null||!sawApply)return;
  const nothing=lastAction==='rollback'?'Nothing was restored':'No changes were applied';
  if(!ok||data.success===false){
   if(starting&&data.lost){  // the request was cut off, but the job may be running: wait for the status answers to decide
    show('running','Checking…','PEAK HOUR lost contact for a moment and is checking what happened. Keep this page open.','wait');
    if(node&&node.dataset.state==='running'){  // shown: if no status answer replaces it in time, say so instead of waiting forever
     const wait=window.AxiomWindowsHealthApply&&window.AxiomWindowsHealthApply.lostTimeoutMs;
     lostTimer=setTimeout(()=>{
      lostTimer=null;
      sawApply=false;
      show('failed','PEAK HOUR could not confirm the changes','Open the list again to see what was applied, then try again if needed.',null);
     },typeof wait==='number'&&Number.isFinite(wait)&&wait>=0?wait:20000);
    }
   }else if(starting){sawApply=false;show('failed',nothing,why(data.error),null)}  // a failed status poll is retried by the page
   return;
  }
  const status=String(data.status||'');
  const progress=number(data.progress),total=number(data.total);
  const summary=data.summary&&typeof data.summary==='object'?data.summary:{};
  if(status==='publishing'){
   show('running',`Applying ${progress.toLocaleString()} of ${total.toLocaleString()}…`,'This can take a moment. Keep this page open.',total?progress/total*100:'wait');
  }else if(status==='rolling_back'){
   show('running',`Restoring ${progress.toLocaleString()} of ${total.toLocaleString()}…`,'This can take a moment. Keep this page open.',total?progress/total*100:'wait');
  }else if(status==='complete'||status==='partial'){
   sawApply=false;
   // The summary is a count of the result rows by status; the apply job only writes 'published' and 'failed'.
   // 'skipped' is read too in case a later version reports it.
   const published=number(summary.published);
   const rows=Array.isArray(data.results)?data.results:[];
   let missed=number(summary.failed)+number(summary.skipped);
   if(!missed)missed=rows.filter(item=>item&&item.status!=='published').length;
   if(!missed&&total>published)missed=total-published;
   if(status==='complete'&&!missed){
    show('ok',`${plural(published,'change','changes')} applied`,'Titles and artists were written into your music files.',null);
   }else{
    const row=rows.find(item=>item&&(item.status==='failed'||item.status==='error'||item.status==='skipped'));
    const reason=row&&(row.reason||row.error)?sentence(row.reason||row.error):'';
    show(published>0?'partial':'failed',`${published.toLocaleString()} applied, ${missed?`${missed.toLocaleString()} could not be applied`:'some could not be applied'}`,
     `${reason?`First reason: ${reason}. `:''}See the list below for each song.`,null);
   }
  }else if(status==='rolled_back'||status==='rollback_partial'){
   sawApply=false;
   const restored=number(summary.rolled_back);
   show(status==='rolled_back'?'ok':'partial',`${plural(restored,'file','files')} restored`,
    status==='rolled_back'?'The files are back to how they were before publishing.':'Files that changed after publishing were left as they are.',null);
  }else if(status==='error'){
   sawApply=false;
   show('failed',nothing,why(data.error),null);
  }
  // previewing, ready, idle: nothing to show
 }

 // path: the route; method: GET/POST; requestBody: the body that was sent; responseData: the parsed answer, or
 // null/undefined at the moment the request is made; ok: the HTTP status was a success
 function observe(path,method,requestBody,responseData,ok){
  try{
   const route=String(path||'');
   if(route===CLEANUP&&String(method||'GET').toUpperCase()==='POST')observeCleanup(requestBody,responseData,ok!==false);
   else if(PUBLISH_ROUTE.test(route))observePublish(route,responseData,ok!==false);
  }catch(_){}
 }
 window.AxiomWindowsHealthApply={observe,lostTimeoutMs:20000};

 const nativeFetch=window.fetch.bind(window);
 window.fetch=function(input,init){
  let path='',method='GET',body=null;
  try{
   const url=typeof input==='string'?input:(input&&(input.href||input.url))||'';
   path=new URL(url,location.href).pathname;
   method=String((init&&init.method)||(input&&input.method)||'GET').toUpperCase();
   body=init&&typeof init.body==='string'?init.body:null;
  }catch(_){}
  const watched=path===CLEANUP||PUBLISH_ROUTE.test(path);
  if(watched&&method==='POST')observe(path,method,body,null,true);
  const pending=nativeFetch(input,init);
  if(watched){
   try{
    pending.then(response=>response.clone().json().then(data=>observe(path,method,body,data,response.ok),()=>observe(path,method,body,{},response.ok)))
     .catch(()=>{});
    if(path===CLEANUP||method==='POST')pending.catch(()=>observe(path,method,body,{success:false,error:'PEAK HOUR could not be reached.',lost:true},false));
   }catch(_){}
  }
  return pending;
 };
})();
