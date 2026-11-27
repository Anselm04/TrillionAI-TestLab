import {freemem,totalmem,loadavg,availableParallelism} from 'node:os';
import {statfs} from 'node:fs/promises';
const MiB=1024*1024;
export async function inspectHostCapacity({path,minFreeMiB=1024,minDiskMiB=2048,maxLoadPerCpu=0.85,sample=async()=>({free:freemem(),total:totalmem(),cpus:availableParallelism(),load:loadavg()[0],disk:await statfs(path)})}={}){
 if(typeof path!=='string'||!path.startsWith('/')||!Number.isSafeInteger(minFreeMiB)||minFreeMiB<512||!Number.isSafeInteger(minFreeMiB*MiB)||!Number.isSafeInteger(minDiskMiB)||minDiskMiB<1024||!Number.isSafeInteger(minDiskMiB*MiB)||!Number.isFinite(maxLoadPerCpu)||maxLoadPerCpu<=0||maxLoadPerCpu>1)throw Error('Invalid resource policy');
 try{
  const s=await sample();
  const blocks=s?.disk?.bavail,blockSize=s?.disk?.bsize;
  if(!Number.isSafeInteger(blocks)||blocks<0||!Number.isSafeInteger(blockSize)||blockSize<=0)throw Error('Invalid resource sample');
  const disk=blocks*blockSize;
  if(![s.free,s.total,s.cpus,disk].every(Number.isSafeInteger)||s.free<0||s.total<=0||s.free>s.total||s.cpus<1||!Number.isFinite(s.load)||s.load<0||disk<0)throw Error('Invalid resource sample');
  const reasons=[];
  if(s.free<Math.max(minFreeMiB*MiB,s.total*0.15))reasons.push('LOW_MEMORY');
  if(disk<minDiskMiB*MiB)reasons.push('LOW_DISK');
  if(s.load/s.cpus>maxLoadPerCpu)reasons.push('HIGH_LOAD');
  return {ready:reasons.length===0,reasons,freeMiB:Math.floor(s.free/MiB),diskMiB:Math.floor(disk/MiB),cpuCount:s.cpus,load:s.load};
 }catch{return {ready:false,reasons:['RESOURCE_SAMPLE_UNAVAILABLE']};}
}
