import {performance} from 'node:perf_hooks';
const pkg=/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const serial=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ok=r=>r?.exitCode===0&&!r.error&&!r.timedOut&&!r.outputTruncated&&typeof r.output==='string';
export function parseMemory(output){
 const rows=[...output.matchAll(/^\s*TOTAL PSS:\s*(\d+)\b/gm)];
 if(rows.length!==1)return null;
 const value=Number(rows[0][1]);return Number.isSafeInteger(value)?value:null;
}
export function parseCpu(output,packageName){
 if(!pkg.test(packageName))return null;
 const values=[];
 for(const line of output.split(/\r?\n/)){
  const m=/^\s*(\d+(?:\.\d+)?)%\s+\d+\/([^:\s]+):/.exec(line);
  if(m&&(m[2]===packageName||m[2].startsWith(packageName+':')))values.push(Number(m[1]));
 }
 return values.length===1&&Number.isFinite(values[0])?values[0]:null;
}
export async function collectDeviceDiagnostics({deviceId,packageName,runner}){
 if(typeof deviceId!=='string'||!serial.test(deviceId)||typeof packageName!=='string'||!pkg.test(packageName)||typeof runner!=='function')throw new Error('Invalid diagnostics context');
 const sample=async(args,parse)=>{
  try{const r=await runner('adb',['-s',deviceId,'shell','dumpsys',...args],{timeoutMs:15000,outputLimit:64000});
   const value=ok(r)?parse(r.output):null;
   return {status:value===null?'NOT_OBSERVED':'OBSERVED',value};
  }catch{return {status:'NOT_OBSERVED',value:null};}
 };
 const start=performance.now();
 const memory=await sample(['meminfo',packageName],parseMemory);
 const cpu=await sample(['cpuinfo'],output=>parseCpu(output,packageName));
 return {schemaVersion:1,phase:'after-journey-before-uninstall',memoryPssKiB:memory,cpuPercent:cpu,collectionDurationMs:Math.round(performance.now()-start),performanceCertified:false};
}
