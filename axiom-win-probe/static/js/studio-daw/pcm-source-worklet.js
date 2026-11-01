class AxiomPcmSource extends AudioWorkletProcessor {
  constructor({processorOptions:options}){
    super();
    this.channels=options.channels;this.startFrame=options.startFrame;this.stopFrame=options.stopFrame;this.offset=options.offset;this.drainFrames=options.drainFrames||0;this.phase=options.phase??0;this.done=false;
    if(!Array.isArray(this.channels)||![1,2].includes(this.channels.length)||!this.channels.every(c=>c instanceof Float32Array&&c.length===this.channels[0].length)||
      ![this.startFrame,this.stopFrame,this.offset,this.drainFrames].every(Number.isSafeInteger)||this.offset<0||this.offset>=this.channels[0].length||this.drainFrames<0||this.startFrame<0||this.stopFrame<this.startFrame||!Number.isFinite(this.phase)||this.phase<0||this.phase>=1)throw new Error('Invalid PCM source schedule.');
    this.port.onmessage=({data})=>{
      if(this.done||data?.type!=='stop'||!Number.isSafeInteger(data.frame)||data.frame<0)return;
      this.stopFrame=Math.min(this.stopFrame,data.frame);
      if(this.stopFrame<=currentFrame){this.done=true;this.channels=null;this.port.postMessage({type:'ended'});}
    };
  }
  process(inputs,outputs){
    const output=outputs[0];for(const channel of output)channel.fill(0);
    if(this.done)return false;
    const count=output[0]?.length||128,end=Math.min(this.stopFrame,this.startFrame+this.channels[0].length-this.offset);
    const first=Math.max(0,this.startFrame-currentFrame),last=Math.min(count,end-currentFrame);
    // Absolute addressing cannot accumulate a slipped render quantum.
    for(let c=0;c<output.length;c++)for(let i=first;i<last;i++){
      const channel=this.channels[c%this.channels.length],at=this.offset+currentFrame+i-this.startFrame;
      let value=channel[at];
      if(this.phase){
        const step=at+1<channel.length?channel[at+1]-value:value-channel[Math.max(0,at-1)];
        value+=step*this.phase;
      }
      if(!Number.isFinite(value))throw new Error('Invalid PCM sample.');
      output[c][i]=value;
    }
    if(currentFrame+count>=end+this.drainFrames){this.done=true;this.channels=null;this.port.postMessage({type:'ended'});return false;}
    return true;
  }
}
registerProcessor('axiom-pcm-source',AxiomPcmSource);
