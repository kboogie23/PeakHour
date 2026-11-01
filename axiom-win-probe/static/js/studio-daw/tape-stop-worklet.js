class AxiomTapeStop extends AudioWorkletProcessor {
  static get parameterDescriptors(){return [
    {name:'speed',defaultValue:1,minValue:0,maxValue:1,automationRate:'a-rate'},
    {name:'wet',defaultValue:1,minValue:0,maxValue:1,automationRate:'a-rate'},
  ];}
  constructor({processorOptions:o}){
    super();
    if(!o||!['classic','modern','loop'].includes(o.mode)||!Number.isSafeInteger(o.startFrame)||!Number.isSafeInteger(o.endFrame)||o.endFrame<=o.startFrame||o.endFrame-o.startFrame>sampleRate*32||!Number.isInteger(o.size)||o.size<128||o.size>sampleRate*33||!Array.isArray(o.boundaries)||o.boundaries.some((x,i)=>!Number.isSafeInteger(x)||i&&x<=o.boundaries[i-1]))throw new Error('Invalid Tape Stop schedule.');
    this.o=o;this.size=o.size;this.fade=Math.max(16,Math.round(sampleRate*.002));
    this.buffers=[new Float32Array(this.size),new Float32Array(this.size)];
    this.write=0;this.read=0;this.loopAnchor=0;this.active=false;this.slice=0;this.old=0;this.fadeLeft=0;this.stopped=false;this.captured=false;
    this.lastSpeed=1;
    if(o.seed){
      const s=o.seed;
      if(!Array.isArray(s.buffers)||s.buffers.length!==2||s.buffers.some(b=>b.length!==this.size)||!['write','read','loopAnchor','old','fadeLeft'].every(k=>Number.isFinite(s[k]))||!Number.isInteger(s.write)||s.write<0)throw new Error('Invalid Tape Stop history.');
      this.buffers=s.buffers.map(b=>new Float32Array(b));
      for(const k of ['write','read','loopAnchor','old','fadeLeft','active','lastSpeed'])this[k]=s[k];
      this.slice=Math.max(0,o.boundaries.findIndex(x=>x>=o.resumeFrame)-1);
      if(o.boundaries.every(x=>x<o.resumeFrame))this.slice=Math.max(0,o.boundaries.length-1);
    }
    this.port.onmessage=({data})=>{if(data?.type==='stop')this.stopped=true;};
  }
  snapshot(){
    this.captured=true;
    this.port.postMessage({type:'history',state:{buffers:this.buffers.map(b=>b.slice()),write:this.write,read:this.read,loopAnchor:this.loopAnchor,old:this.old,fadeLeft:this.fadeLeft,active:this.active,lastSpeed:this.lastSpeed}});
  }
  at(channel,position){
    const captured=this.o.mode==='loop'&&this.active&&this.write-this.loopAnchor>=this.o.loopFrames;
    const first=Math.max(0,this.write-this.size+3,captured?this.loopAnchor:0),last=captured?this.loopAnchor+this.o.loopFrames-1:this.write;
    position=Math.max(first,Math.min(last,position));
    const i=Math.floor(position),t=position-i,b=this.buffers[channel],value=n=>b[((Math.max(first,Math.min(last,n))%this.size)+this.size)%this.size];
    // Cubic interpolation retains stereo and avoids stepping at low speed.
    const a=value(i-1),c=value(i),d=value(i+1),e=value(i+2);
    return c+.5*t*(d-a+t*(2*a-5*c+4*d-e+t*(3*(c-d)+e-a)));
  }
  reset(position){this.old=this.read;this.read=position;this.fadeLeft=this.fade;}
  process(inputs,outputs,parameters){
    const output=outputs[0],input=inputs[0]||[],o=this.o;
    if(this.stopped){for(const c of output)c.fill(0);return false;}
    for(let i=0;i<output[0].length;i++){
      const frame=currentFrame+i;
      if(!this.captured&&frame===o.captureFrame)this.snapshot();
      if(o.seed&&frame<o.resumeFrame){for(let c=0;c<output.length;c++)output[c][i]=input[c]?.[i]??input[0]?.[i]??0;continue;}
      const speed=Math.pow(parameters.speed[parameters.speed.length===1?0:i],o.shape),wet=parameters.wet[parameters.wet.length===1?0:i];
      const inside=frame>=o.startFrame&&frame<o.endFrame;
      for(let c=0;c<2;c++)this.buffers[c][this.write%this.size]=input[c]?.[i]??input[0]?.[i]??0;
      if(inside&&!this.active){this.active=true;this.read=this.write;this.loopAnchor=this.write;}
      if(inside&&speed>=.999999&&this.lastSpeed<.999999&&o.mode==='classic')this.reset(this.write);
      while(this.slice+1<o.boundaries.length&&frame>=o.boundaries[this.slice+1]){
        this.slice++;
        if(inside&&o.mode==='modern')this.reset(this.write);
        if(inside&&o.mode==='loop'&&o.loopSync&&this.write-this.loopAnchor>=o.loopFrames)this.reset(this.loopAnchor);
      }
      if(inside&&o.mode==='loop'&&this.read>=this.loopAnchor+o.loopFrames&&this.write-this.loopAnchor>=o.loopFrames)this.reset(this.loopAnchor+(this.read-this.loopAnchor)%o.loopFrames);
      const stopFade=Math.min(1,speed/.025)*(speed<.025?Math.min(1,Math.max(0,(o.endFrame-frame)/(sampleRate*.003))):1),exit=Math.max(0,1-(frame-o.endFrame)/(this.fade*2));
      const amount=inside?wet:frame>=o.endFrame&&this.active?wet*exit:0;
      for(let c=0;c<output.length;c++){
        const dry=input[c]?.[i]??input[0]?.[i]??0;
        let shifted=this.active?this.at(Math.min(c,1),this.read)*stopFade:0;
        if(inside&&this.fadeLeft){const blend=1-this.fadeLeft/this.fade;shifted=this.at(Math.min(c,1),this.old)*stopFade*(1-blend)+shifted*blend;}
        output[c][i]=dry*(1-amount)+shifted*amount;
      }
      if(inside||this.active&&exit>0){this.read+=speed;if(this.fadeLeft){this.old+=speed;this.fadeLeft--;}}
      this.lastSpeed=speed;this.write++;
    }
    if(!this.captured&&currentFrame+output[0].length===o.captureFrame)this.snapshot();
    return true;
  }
}
registerProcessor('axiom-tape-stop',AxiomTapeStop);
