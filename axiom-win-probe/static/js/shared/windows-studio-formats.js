// PEAK HOUR (Windows): the Studio DAW "Import" file pickers offer, and accept, every audio and video type the Windows layer
// teaches the DAW to decode (windows_studio_formats.EXTRA: ogg, opus, wma, alac, mpg, mpeg, avi, wmv, mkv, webm, mov, m4v, vob),
// not only the eight the Mac build allows. The shared Studio DAW scripts build their pickers with the Mac lists; this file
// widens exactly the picker shell.js hands to AxiomWindowsStudioFormats.widenPicker (the Import Files flow that POSTs to
// /api/studio-daw/import, decoded by the server) and answers
// AxiomWindowsStudioFormats.test(name) for the DAW's own "is this importable" checks. It is loaded by the Windows page only, so
// the macOS edition keeps its lists. Keep EXTRA equal to windows_studio_formats.EXTRA (test_windows_studio_formats.py checks it).
(function(){
 'use strict';
 const EXTRA=['.ogg','.opus','.wma','.alac','.mpg','.mpeg','.avi','.wmv','.mkv','.webm','.mov','.m4v','.vob'];
 const LEGACY=['.mp3','.mp4','.m4a','.wav','.aif','.aiff','.flac','.aac'];
 const extra=new RegExp('\\.('+EXTRA.map(item=>item.slice(1)).join('|')+')$','i');
 function widen(value){
  const text=String(value==null?'':value);
  const parts=text.split(',').map(part=>part.trim()).filter(Boolean);
  const audioOnly=parts.length===1&&parts[0].toLowerCase()==='audio/*';
  const oldList=parts.length>=3&&parts.every(part=>LEGACY.includes(part.toLowerCase()));
  if(!audioOnly&&!oldList)return text;
  return parts.concat(EXTRA.filter(item=>!parts.some(part=>part.toLowerCase()===item))).join(',');
 }
 // Only the DAW's server-side import picker asks for this (shell.js importSampleFolderToLayer): those files are decoded by the
 // server's FFmpeg. Every other picker (composer.js, assets.js replacement file, sweeps...) decodes in the BROWSER, which cannot
 // read wma, avi, vob or alac, so none of them is touched.
 function widenPicker(input){
  if(input&&input.type==='file')input.accept=widen(input.accept);
  return input;
 }
 window.AxiomWindowsStudioFormats=Object.freeze({extensions:Object.freeze(EXTRA.slice()),widen,widenPicker,test:name=>extra.test(String(name||''))});
})();
