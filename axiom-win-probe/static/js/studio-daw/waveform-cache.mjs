function bytes(data) {return data.peaks.byteLength+(data.bands||[]).reduce((sum,band)=>sum+band.byteLength,0);}

export class WaveformCache {
  constructor({detailLimit=64*1024*1024,overviewLimit=16*1024*1024,overviewBins=8192,errorLimit=128}={}) {
    this.detailLimit=detailLimit;this.overviewLimit=overviewLimit;this.overviewBins=overviewBins;this.errorLimit=errorLimit;
    this.details=new Map();this.overviews=new Map();this.errors=new Map();
    this.detailBytes=0;this.overviewBytes=0;
  }
  get(path,detail=false) {
    const map=detail?this.details:this.overviews,value=map.get(path);
    if(value){map.delete(path);map.set(path,value);return value;}
    return this.errors.get(path);
  }
  store(map,key,limit,path,data) {
    if(map.has(path)){this[key]-=bytes(map.get(path));map.delete(path);}
    const size=bytes(data);
    if(size>limit)return;
    while(map.size&&this[key]+size>limit){const first=map.keys().next().value;this[key]-=bytes(map.get(first));map.delete(first);}
    map.set(path,data);this[key]+=size;
  }
  set(path,data) {
    if(data.error){
      this.errors.delete(path);this.errors.set(path,{error:String(data.error).slice(0,1024)});
      while(this.errors.size>this.errorLimit)this.errors.delete(this.errors.keys().next().value);
      return;
    }
    this.errors.delete(path);
    const peaks=new Float32Array(Math.min(this.overviewBins,data.peaks.length));
    const bands=data.bands?.map(()=>new Float32Array(peaks.length));
    for(let i=0;i<peaks.length;i++) {
      const end=Math.floor((i+1)*data.peaks.length/peaks.length);
      for(let j=Math.floor(i*data.peaks.length/peaks.length);j<end;j++){peaks[i]=Math.max(peaks[i],data.peaks[j]);if(bands)for(let b=0;b<3;b++)bands[b][i]+=data.bands[b][j];}
    }
    // A detail reload need not invalidate identical overview pixels.
    const old=this.overviews.get(path);
    const overview=old&&old.duration===data.duration&&old.peakSpanSeconds===data.peakSpanSeconds&&old.peaks.length===peaks.length&&peaks.every((value,index)=>old.peaks[index]===value)&&Boolean(old.bands)===Boolean(bands)&&(!bands||bands.every((band,b)=>band.every((v,i)=>old.bands[b][i]===v)))?old:{peaks,...(bands?{bands}:{}),duration:data.duration,...(data.peakSpanSeconds?{peakSpanSeconds:data.peakSpanSeconds}:{})};
    this.store(this.overviews,'overviewBytes',this.overviewLimit,path,overview);
    this.store(this.details,'detailBytes',this.detailLimit,path,data);
  }
  clearError(path) { return this.errors.delete(path); }
  stats() {
    return {detailBytes:this.detailBytes,overviewBytes:this.overviewBytes,detailEntries:this.details.size,overviewEntries:this.overviews.size,errorEntries:this.errors.size,detailLimit:this.detailLimit,overviewLimit:this.overviewLimit};
  }
}
