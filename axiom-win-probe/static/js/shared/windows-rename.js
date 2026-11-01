// PEAK HOUR: show the Windows edition's name wherever AXIOM's own wording says
// "AXIOM" (page text, tooltips, placeholders, alt text and alert/confirm boxes),
// and Windows words for Mac ones (Finder -> File Explorer, Trash -> Recycle Bin).
// Only what people read changes: code names, saved settings, API addresses and
// data folders keep AXIOM. Left as they are on purpose:
//  - folder paths ("Music\AXIOM DJ\Recordings" is a real folder),
//  - song titles and artists (rows with data-path, track title/artist text),
//  - the licence window and the AXIOM Lite import (they name AXIOM's products),
//  - anything inside inputs, code and editable text.
(function(){
 'use strict';
 const NAME='PEAK HOUR';
 const WORD=/(?<![\w.-])(?:AXIOM|Axiom)(?:\s+(?:PRO|Pro)\b)?(?!\w|-[A-Z0-9_])(?!\s+(?:LITE|Lite)\b)/g;  // "AXIOM-generated" yes, "X-AXIOM-DJ" no
 const PATH=/[\\]|[A-Za-z]:\/|%[A-Z]+%/;
 const SKIP_TAGS=new Set(['SCRIPT','STYLE','TEXTAREA','INPUT','SELECT','CODE','PRE','NOSCRIPT']);
 const KEEP='#license-modal,#lite-migration-settings-item,[data-path],[data-track-path],[class*="track-title"],[class*="track-artist"],[contenteditable=""],[contenteditable="true"],[data-ph-keep]';
 const ATTRS=['title','placeholder','aria-label','alt','data-tooltip'];
 // Mac wording for features that have Windows versions (windows_mac_parity.py and the Windows adapters).
 const PHRASES=[
  [/Ctrl-click or Command-click/g,'Ctrl-click'],
  [/AXIOM Broadcast Driver Needed/g,'Virtual Cable Needed To Stream'],
  [/Broadcast driver needed/g,'Virtual cable needed'],
  [/Share To AXIOM Broadcast/g,'Streaming Feed On'],
  [/ The same clean feed will be available to streaming apps as AXIOM Broadcast\./g,' The same clean feed also plays into your virtual audio cable for streaming apps.'],
  [/ AXIOM Broadcast needs its macOS audio driver installed on this Mac\./g,' To stream it too, install a virtual audio cable such as VB-CABLE.'],
  [/Test Signal checks Mac recording access before your set\./g,'Test Signal checks the sound before your set.'],
  [/Open Serato or djay Pro\. First use may require Screen & System Audio Recording access\./g,'Open your DJ software (Serato, VirtualDJ or djay) to record its sound.'],
  [/Connect a controller Record, Mix or Master output\. The MacBook microphone is excluded\./g,'Connect a controller Record, Mix or Master output.'],
  [/Mac audio permission needed/g,'Audio permission needed'],
  [/^System Settings$/,'Settings'],
  [/Press Command-C on Mac or Ctrl-C on Windows to copy\./g,'Press Ctrl-C to copy.'],
  [/drag the database V2 file from Finder into Terminal to see its full path, then paste it here/g,'in File Explorer, Shift+right-click the database V2 file, choose Copy as path, then paste it here'],
  [/Finder path/g,'File path'],
  [/Reveal in Finder/g,'Show in File Explorer'],
  [/\bin Finder\b/g,'in File Explorer'],
  [/\b(?:the )?macOS Trash\b/g,'the Recycle Bin'],
  [/Mac Audio Unit effect/g,'VST3 effect'],
  [/Audio Unit (?:effect|Effect)/g,'VST3 effect'],
  [/Audio Units/g,'VST3 effects'],
  [/Audio Unit/g,'VST3 effect'],
  [/\bMac Audio\b/g,'PC Audio'],
  [/\bCore Audio\b/g,'Windows audio'],
  [/Slow Mac\b/g,'Slow PC'],
  [/the Mac folder picker/g,'the folder picker'],
  [/\b(this|your|another|This|Your|Another) Mac\b/g,'$1 PC'],
 ];
 const rename=text=>typeof text!=='string'||PATH.test(text)?text:PHRASES.reduce((value,[from,to])=>value.replace(from,to),text).replace(WORD,NAME);
 const kept=element=>!element||SKIP_TAGS.has(element.tagName)||!!element.closest(KEEP);
 function fixText(node){
  if(kept(node.parentElement))return;
  const next=rename(node.nodeValue);
  if(next!==node.nodeValue)node.nodeValue=next;
 }
 function fixAttrs(element){
  if(kept(element))return;
  for(const name of ATTRS){
   const value=element.getAttribute(name);
   if(value){const next=rename(value);if(next!==value)element.setAttribute(name,next);}
  }
 }
 function sweep(root){
  if(root.nodeType===3){fixText(root);return;}
  if(root.nodeType!==1)return;
  if(root.tagName&&kept(root))return;
  fixAttrs(root);
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT,{acceptNode:node=>
   node.nodeType===1&&(SKIP_TAGS.has(node.tagName)||node.matches(KEEP))?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
  for(let node=walker.nextNode();node;node=walker.nextNode()){
   if(node.nodeType===3)fixText(node);else fixAttrs(node);
  }
 }
 new MutationObserver(records=>{
  for(const record of records){
   if(record.type==='childList')record.addedNodes.forEach(sweep);
   else if(record.type==='characterData')fixText(record.target);
   else if(record.type==='attributes')fixAttrs(record.target);
  }
 }).observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:ATTRS});
 for(const name of ['alert','confirm','prompt']){
  const original=window[name].bind(window);
  window[name]=(message,...rest)=>original(rename(String(message??'')),...rest);
 }
 if(document.body)sweep(document.body);
 document.addEventListener('DOMContentLoaded',()=>sweep(document.body));
 window.PeakHourRename=rename;
})();
