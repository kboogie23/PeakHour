class AxiomCreativeFx extends AudioWorkletProcessor {
  static get parameterDescriptors(){return [
    {name:'repeatPitch',defaultValue:0,minValue:-24,maxValue:12},{name:'repeatDecay',defaultValue:0,minValue:0,maxValue:100},
    {name:'buildAmount',defaultValue:75,minValue:0,maxValue:100},{name:'gritDrive',defaultValue:6,minValue:0,maxValue:24},
    {name:'crushBits',defaultValue:8,minValue:2,maxValue:16},{name:'crushHold',defaultValue:4,minValue:1,maxValue:32}];}
  constructor({processorOptions:o}){
    super();if(!['beatRepeat','transitionBuild','saturate','bitcrush'].includes(o.mode)||!Number.isInteger(o.size)||o.size<4||o.size>sampleRate*32+100)throw new Error('Invalid creative effect history.');
    this.o=o;this.buffers=[new Float32Array(o.size),new Float32Array(o.size)];this.write=0;this.read=0;this.old=0;this.fadeLeft=0;this.boundary=0;this.last=[0,0];this.low=[0,0];this.held=[0,0];this.stopped=false;this.captured=false;
    if(o.seed){const s=o.seed;if(!Array.isArray(s.buffers)||s.buffers.length!==2||s.buffers.some(b=>b.length!==o.size)||!['write','read','old','fadeLeft','boundary'].every(k=>Number.isFinite(s[k])))throw new Error('Invalid creative effect seed.');this.buffers=s.buffers.map(b=>new Float32Array(b));for(const k of ['write','read','old','fadeLeft','boundary','last','low','held'])this[k]=s[k];}
    this.port.onmessage=({data})=>{if(data?.type==='stop')this.stopped=true;};
  }
  snapshot(){this.captured=true;this.port.postMessage({type:'history',state:{buffers:this.buffers.map(b=>b.slice()),write:this.write,read:this.read,old:this.old,fadeLeft:this.fadeLeft,boundary:this.boundary,last:[...this.last],low:[...this.low],held:[...this.held]}});}
  sample(c,position,loop=false){
    const end=loop?Math.min(this.write,this.o.loopFrames-1):this.write,lo=loop?0:Math.max(0,this.write-this.o.size+2);
    position=Math.max(lo,Math.min(end,position));const n=Math.floor(position),mix=position-n,b=this.buffers[c],at=i=>b[Math.max(lo,Math.min(end,i))%this.o.size];return at(n)*(1-mix)+at(n+1)*mix;
  }
  process(inputs,outputs,p){
    const out=outputs[0],input=inputs[0]||[],o=this.o,param=(key,i)=>p[key][p[key].length===1?0:i];
    if(this.stopped){for(const c of out)c.fill(0);return false;}
    for(let i=0;i<out[0].length;i++){
      const frame=currentFrame+i;if(!this.captured&&frame===o.captureFrame)this.snapshot();
      if(o.seed&&frame<o.resumeFrame){for(let c=0;c<out.length;c++)out[c][i]=input[c]?.[i]??input[0]?.[i]??0;continue;}
      const inside=frame>=o.startFrame&&frame<o.endFrame;
      if(!inside){for(let c=0;c<out.length;c++)out[c][i]=input[c]?.[i]??input[0]?.[i]??0;continue;}
      while(this.boundary+1<o.boundaries.length&&frame>=o.boundaries[this.boundary+1]){this.boundary++;if(o.mode==='beatRepeat'){this.old=this.read;this.read=0;this.fadeLeft=Math.max(8,Math.round(sampleRate*.002));}}
      const ratio=Math.pow(2,param('repeatPitch',i)/12),decay=Math.pow(1-param('repeatDecay',i)/100,this.boundary);
      const amount=param('buildAmount',i)/100;
      const spacing=this.boundary+1<o.boundaries.length?o.boundaries[this.boundary+1]-o.boundaries[this.boundary]:this.boundary?o.boundaries[this.boundary]-o.boundaries[this.boundary-1]:sampleRate*.25;
      for(let c=0;c<out.length;c++){
        const ch=Math.min(c,1),x=input[c]?.[i]??input[0]?.[i]??0;let value=x;
        if(o.mode==='beatRepeat'){
          // Keep the captured slice immutable after its first pass.
          if(this.write<o.loopFrames)this.buffers[ch][this.write%o.size]=x;
          value=this.sample(ch,this.read,true)*decay;
          if(this.fadeLeft){const a=this.fadeLeft/Math.max(8,Math.round(sampleRate*.002));value=value*(1-a)+this.sample(ch,this.old,true)*decay*a;}
        }else if(o.mode==='transitionBuild'){
          const delayed=this.write>=spacing?this.sample(ch,this.write-Math.min(o.size-2,spacing)):0;
          const alpha=1-Math.exp(-2*Math.PI*(20+amount*1800)/sampleRate);this.low[ch]+=alpha*(x-this.low[ch]);
          const filtered=x-this.low[ch]*amount;
          // Three short feedback taps supply a small stereo room, bounded below unity.
          let room=0;for(const seconds of [.037,.061,.089])if(this.write>seconds*sampleRate)room+=this.sample(ch,this.write-seconds*sampleRate)/3;
          this.buffers[ch][this.write%o.size]=filtered+delayed*.35*amount+room*.15*amount;
          value=filtered*(1-.35*amount)+delayed*.4*amount+room*.2*amount;
        }else if(o.mode==='saturate'){
          const drive=param('gritDrive',i);if(drive>0){const gain=Math.pow(10,drive/20);value=Math.tanh(x*gain)/Math.tanh(gain);}
        }else{
          const hold=Math.round(param('crushHold',i)),levels=Math.pow(2,Math.round(param('crushBits',i))-1);
          if((frame-o.startFrame)%hold===0)this.held[ch]=Math.round(Math.max(-1,Math.min(1,x))*levels)/levels;value=this.held[ch];
        }
        out[c][i]=Number.isFinite(value)?value:0;
      }
      if(o.mode==='beatRepeat'){this.read+=ratio;if(this.read>=o.loopFrames){this.old=this.read;this.read%=o.loopFrames;this.fadeLeft=Math.max(8,Math.round(sampleRate*.002));}if(this.fadeLeft){this.old+=ratio;this.fadeLeft--;}}
      this.write++;
    }
    if(!this.captured&&currentFrame+out[0].length===o.captureFrame)this.snapshot();return true;
  }
}
registerProcessor('axiom-creative-fx',AxiomCreativeFx);
