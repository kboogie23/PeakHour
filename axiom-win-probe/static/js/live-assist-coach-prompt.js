const coachPrompt = document.getElementById('coach-prompt');
const coachReviewQuery = new URLSearchParams(location.search);
const coachReviewMode = ['127.0.0.1','localhost','[::1]'].includes(location.hostname)
 && coachReviewQuery.get('review') === 'performance' && coachReviewQuery.get('ui_preview') === 'coach'
 && coachReviewQuery.has('preview') && !window.webkit?.messageHandlers?.axiomNative?.postMessage;
let coachTimer=null,coachRemaining=10000,coachStarted=0,coachDragging=false;
function pauseCoach(){if(coachTimer){clearTimeout(coachTimer);coachTimer=null;coachRemaining=Math.max(0,coachRemaining-(performance.now()-coachStarted));}}
function closeCoach(){pauseCoach();coachPrompt.classList.remove('visible');const bridge=window.webkit?.messageHandlers?.axiomNative;if(bridge?.postMessage)bridge.postMessage({action:'dismissCoachPrompt'});else{window.parent.__AXIOM_COACH_CLOSED?.();const frame=window.frameElement;if(frame)frame.hidden=true;}}
function resumeCoach(){if(coachReviewMode||!coachPrompt.classList.contains('visible')||coachDragging||coachPrompt.matches(':hover')||coachPrompt.contains(document.activeElement))return;pauseCoach();coachStarted=performance.now();coachTimer=setTimeout(closeCoach,coachRemaining);}
window.__AXIOM_SHOW_COACH_PROMPT=payload=>{
 pauseCoach();coachRemaining=10000;coachDragging=false;
 document.getElementById('coach-title').textContent=String(payload.title||'');document.getElementById('coach-detail').textContent=String(payload.detail||'');
 const card=document.getElementById('coach-song');card.replaceChildren();card.hidden=!payload.track;delete card.dataset.path;
 coachPrompt.classList.toggle('has-track', Boolean(payload.track));
 if(payload.track){const t=payload.track;card.dataset.path=t.path;card.dataset.title=t.title;card.setAttribute('aria-label',`Drag ${t.title} to deck`);for(const [tag,text] of [['strong',t.title],['span',t.artist],['small',`${t.bpm} BPM · ${t.camelot||t.key||''}`],['footer','Drag to deck ↗']]){const e=document.createElement(tag);e.textContent=text;card.appendChild(e);}}
 coachPrompt.classList.add('visible');resumeCoach();
};
window.__AXIOM_HIDE_COACH_PROMPT=()=>{pauseCoach();coachPrompt.classList.remove('visible');};
document.getElementById('coach-dismiss').onclick=closeCoach;
coachPrompt.addEventListener('pointerenter',pauseCoach);coachPrompt.addEventListener('pointerleave',resumeCoach);coachPrompt.addEventListener('focusin',pauseCoach);coachPrompt.addEventListener('focusout',()=>setTimeout(resumeCoach,0));
const coachSong=document.getElementById('coach-song');
function prepareCoachDrag(){const path=coachSong.dataset.path;if(path)window.webkit?.messageHandlers?.axiomNative?.postMessage({action:'prepareTrackDrag',path,title:coachSong.dataset.title});}
coachSong.addEventListener('pointerover',prepareCoachDrag);coachSong.addEventListener('mousedown',()=>{prepareCoachDrag();pauseCoach();coachDragging=true;});
document.addEventListener('mouseup',()=>{coachDragging=false;resumeCoach();});
coachSong.addEventListener('pointerout',()=>window.webkit?.messageHandlers?.axiomNative?.postMessage({action:'clearTrackDrag'}));
coachSong.addEventListener('dragstart',event=>{if(!coachSong.dataset.path)return;pauseCoach();coachDragging=true;const path=coachSong.dataset.path;event.dataTransfer.effectAllowed='copy';event.dataTransfer.setData('text/uri-list','file://'+path.split('/').map(encodeURIComponent).join('/'));event.dataTransfer.setData('text/plain',path);const ghost=document.createElement('div');ghost.textContent=coachSong.dataset.title;ghost.style.cssText='position:fixed;left:-1000px;background:var(--accent);color:#071005;padding:10px;font:700 14px Barlow';document.body.appendChild(ghost);event.dataTransfer.setDragImage(ghost,5,5);setTimeout(()=>ghost.remove(),0);});
coachSong.addEventListener('dragend',()=>{coachDragging=false;resumeCoach();});
window.__AXIOM_NATIVE_DRAG_RESULT=()=>{coachDragging=false;resumeCoach();};
if(coachReviewMode){
 document.body.classList.add('coach-review');
 document.getElementById('coach-review-controls').hidden=false;
 coachSong.draggable=false;
 const track={path:'/preview/sample-track',title:'Return of the Mack',artist:'Mark Morrison',bpm:96,camelot:'8A'};
 const samples={
  familiar:{title:'Familiar Pairing',detail:'You’ve mixed this after No Diggity before.',track},
  discovery:{title:'Feeling brave?',detail:'Let’s try some new shit. This could be your next combo.',track},
  reminder:{title:'Capture a moment',detail:'Fancy a quick clip? Ask someone to capture this moment.'},
 };
 const showSample=name=>{
  const sample=samples[name]||samples.familiar;
  window.__AXIOM_SHOW_COACH_PROMPT(sample);
  if(sample.track){coachSong.removeAttribute('tabindex');coachSong.setAttribute('aria-label','Sample song');coachSong.querySelector('footer').textContent='Sample song · Preview only';}
  document.querySelectorAll('[data-coach-preview]').forEach(button=>button.setAttribute('aria-pressed',String(samples[button.dataset.coachPreview]===sample)));
 };
 document.querySelectorAll('[data-coach-preview]').forEach(button=>button.onclick=()=>showSample(button.dataset.coachPreview));
 showSample(coachReviewQuery.get('preview'));
}
