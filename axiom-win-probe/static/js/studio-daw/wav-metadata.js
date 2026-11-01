(function(){
  'use strict';
  const encode=text=>new TextEncoder().encode(text);
  function join(parts){const bytes=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}return bytes;}
  const syncsafe=n=>new Uint8Array([(n>>>21)&127,(n>>>14)&127,(n>>>7)&127,n&127]);
  function field(value){if(typeof value!=='string'||value.length>500||/[\x00-\x1f\x7f]/.test(value))throw new Error('Use up to 500 characters for Artist and Song Title.');return value.trim();}
  function chunk(id,body){const header=new Uint8Array(8);header.set(encode(id));new DataView(header.buffer).setUint32(4,body.length,true);return join([header,body,...(body.length%2?[new Uint8Array(1)]:[])]);}
  async function tag(blob,metadata){
    const title=field(metadata.title||''),artist=field(metadata.artist||'');
    const key=field(metadata.key||'').toUpperCase(),bpm=metadata.bpm??0;
    if(key&&!/^([1-9]|1[0-2])[AB]$/.test(key))throw new Error('Choose a Camelot key from 1A to 12B.');
    if(typeof bpm!=='number'||!Number.isFinite(bpm)||(bpm!==0&&(bpm<20||bpm>400)))throw new Error('BPM must be between 20 and 400, or blank.');
    if(!title&&!artist&&!key&&!bpm)return blob;
    const header=new Uint8Array(await blob.slice(0,58).arrayBuffer()),view=new DataView(header.buffer);
    if(header.length!==58||new TextDecoder().decode(header.slice(0,4))!=='RIFF'||view.getUint32(54,true)!==blob.size-58)throw new Error('WAV metadata requires a complete rendered mix.');
    const frames=[],info=[];
    for(const [id,riff,value] of [['TIT2','INAM',title],['TPE1','IART',artist],['TBPM',null,bpm?String(bpm):''],['TKEY',null,key]])if(value){
      const text=encode(value),body=join([new Uint8Array([3]),text]);
      frames.push(join([encode(id),syncsafe(body.length),new Uint8Array(2),body]));
      if(riff)info.push(chunk(riff,join([text,new Uint8Array(1)])));
    }
    const body=join(frames),id3=join([encode('ID3'),new Uint8Array([4,0,0]),syncsafe(body.length),body]);
    const tags=join([chunk('LIST',join([encode('INFO'),...info])),chunk('id3 ',id3)]);
    if(blob.size+tags.length>0xffffffff+8)throw new Error('This WAV is too large to include metadata.');
    view.setUint32(4,blob.size+tags.length-8,true);
    // Blob slices retain the exact rendered PCM, including large streamed files.
    return new Blob([header,blob.slice(58),tags],{type:'audio/wav'});
  }
  window.AxiomWavMetadata={tag};
})();
