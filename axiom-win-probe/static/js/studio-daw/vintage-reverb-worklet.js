// Original eight-line feedback-delay network; no third-party impulses or presets.
class AxiomVintageReverb extends AudioWorkletProcessor {
  static get parameterDescriptors(){return [
    {name:'decaySeconds',defaultValue:3,minValue:.1,maxValue:30},
    {name:'dampingHz',defaultValue:12000,minValue:200,maxValue:20000},
    {name:'vintageModMs',defaultValue:1.2,minValue:0,maxValue:5},
    {name:'vintageLowCutHz',defaultValue:120,minValue:20,maxValue:1000},
    {name:'vintageWidth',defaultValue:100,minValue:0,maxValue:150},
    {name:'vintageColor',defaultValue:45,minValue:0,maxValue:100},
  ].map(p=>({...p,automationRate:'k-rate'}));}
  constructor({processorOptions:{mode='hall',size=1,endFrame}}){
    super();
    if(!['hall','plate','chamber'].includes(mode)||!Number.isFinite(size)||size<.5||size>2||!Number.isSafeInteger(endFrame))throw new Error('Invalid vintage reverb schedule.');
    const scale=mode==='plate'?.55:mode==='chamber'?.7:1;
    this.delays=[.0297,.0371,.0411,.0437,.0531,.0617,.0719,.0893].map(d=>d*size*scale*sampleRate);
    this.rings=this.delays.map(d=>new Float32Array(Math.ceil(d+.005*sampleRate)+4));
    this.positions=new Uint32Array(8);this.low=new Float64Array(8);this.read=new Float64Array(8);this.mix=new Float64Array(8);
    this.hpIn=[0,0];this.hpOut=[0,0];this.endFrame=endFrame;this.motion=mode==='plate'?.4:mode==='chamber'?.65:1;
    this.port.onmessage=({data})=>{if(data?.type==='stop')this.endFrame=currentFrame;};
  }
  process(inputs,outputs,p){
    const output=outputs[0],input=inputs[0]||[],decay=p.decaySeconds[0],color=p.vintageColor[0]/100;
    const damping=1-Math.exp(-2*Math.PI*Math.min(p.dampingHz[0],20000*Math.pow(.14,color))/sampleRate);
    const highpass=Math.exp(-2*Math.PI*p.vintageLowCutHz[0]/sampleRate),width=p.vintageWidth[0]/100,depth=p.vintageModMs[0]*sampleRate/1000*this.motion;
    const gains=this.delays.map(d=>Math.pow(.001,d/sampleRate/decay));
    for(let i=0;i<output[0].length;i++){
      if(currentFrame+i>=this.endFrame){output[0][i]=output[1][i]=0;continue;}
      const time=(currentFrame+i)/sampleRate;
      for(let j=0;j<8;j++){
        const ring=this.rings[j],delay=this.delays[j]+depth*Math.sin(time*2*Math.PI*(.13+j*.017)+j),read=(this.positions[j]-delay+ring.length)%ring.length,at=Math.floor(read),f=read-at;
        const value=ring[at]*(1-f)+ring[(at+1)%ring.length]*f;this.low[j]+=damping*(value-this.low[j]);this.read[j]=this.low[j];this.mix[j]=this.low[j];
      }
      // Orthogonal Hadamard scattering preserves feedback energy before decay.
      for(let span=1;span<8;span*=2)for(let j=0;j<8;j+=2*span)for(let k=0;k<span;k++){const a=this.mix[j+k],b=this.mix[j+k+span];this.mix[j+k]=a+b;this.mix[j+k+span]=a-b;}
      const left=input[0]?.[i]||0,right=input[1]?.[i]??left;
      for(let j=0;j<8;j++){
        this.rings[j][this.positions[j]]=(j%2?right:left)*.25*(j<4?1:-1)+this.mix[j]*Math.SQRT1_2*.5*gains[j];
        this.positions[j]=(this.positions[j]+1)%this.rings[j].length;
      }
      const l=(this.read[0]+this.read[2]-this.read[4]+this.read[6])*.5,r=(this.read[1]-this.read[3]+this.read[5]+this.read[7])*.5;
      const mid=(l+r)/2,side=(l-r)/2*width;
      for(let c=0;c<2;c++){const value=mid+(c?-side:side),filtered=highpass*(this.hpOut[c]+value-this.hpIn[c]);this.hpIn[c]=value;this.hpOut[c]=filtered;output[c][i]=filtered;}
    }
    return currentFrame+output[0].length<this.endFrame;
  }
}
registerProcessor('axiom-vintage-reverb',AxiomVintageReverb);
