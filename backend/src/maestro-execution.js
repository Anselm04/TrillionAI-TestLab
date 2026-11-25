import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {executeJourney,validateJourney} from './mobile-journey.js';

// Only called inside the trusted leased worker with a verified installed APK.
export async function runMaestroJourney({journey,deviceId,packageName,buildSha256,runner,evidenceStore}){
 const plan=validateJourney(journey);
 if(plan.packageName!==packageName||typeof runner!=='function')throw new Error('Journey does not match verified APK');
 let capturedLog;
 const report=await executeJourney({journey:plan,deviceId,buildSha256,execute:async({flow})=>{
  const dir=await mkdtemp(join(tmpdir(),'testlab-maestro-'));
  try{
   const path=join(dir,'flow.yaml');
   await writeFile(path,flow,{flag:'wx',mode:0o600});
   const result=await runner('maestro',['--device',deviceId,'test',path],{timeoutMs:240000,outputLimit:64000});
   if(typeof result?.output==='string'&&!result.outputTruncated)capturedLog=result.output;
   return result;
  }finally{await rm(dir,{recursive:true,force:true});}
 }});
 if(!evidenceStore)return report;
 if(!capturedLog)return {...report,evidenceStatus:'NOT_CAPTURED'};
 try{
  // End-of-journey device screen, before APK uninstall; not an assertion-time screenshot.
  const screen=await runner('adb',['-s',deviceId,'exec-out','screencap','-p'],{timeoutMs:15000,outputLimit:12*1024*1024,binaryOutput:true});
  const screenshot=screen?.exitCode===0&&!screen.error&&!screen.timedOut&&!screen.outputTruncated&&Buffer.isBuffer(screen.stdoutBytes)?screen.stdoutBytes:undefined;
  const manifest=await evidenceStore.capture({deviceId,buildSha256,flowSha256:report.flowSha256,log:capturedLog,screenshot});
  if(!screenshot)return {...report,evidenceStatus:'CAPTURE_FAILED',evidenceManifest:manifest};
  return {...report,evidenceStatus:await evidenceStore.verify(manifest)?'CHECKSUM_VERIFIED':'INVALID',evidenceManifest:manifest};
 }catch{return {...report,evidenceStatus:'CAPTURE_FAILED'};}
}
