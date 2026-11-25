import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {executeJourney,validateJourney} from './mobile-journey.js';
import {collectDeviceDiagnostics} from './device-diagnostics.js';
import {recordAndroidClip} from './android-video.js';

// Only called inside the trusted leased worker with a verified installed APK.
export async function runMaestroJourney({journey,deviceId,packageName,buildSha256,runner,evidenceStore,reviewChallengeId,recordVideo=false,appiumExecutor}){
 const plan=validateJourney(journey);
 if(plan.packageName!==packageName||typeof runner!=='function')throw new Error('Journey does not match verified APK');
 let capturedLog, recording;
 if(recordVideo&&!evidenceStore)throw new Error('Video requires evidence store');
 let report=await executeJourney({journey:plan,deviceId,buildSha256,engine:appiumExecutor?'appium':'maestro',execute:async({flow})=>{
  const dir=await mkdtemp(join(tmpdir(),'testlab-maestro-'));
  try{
   const path=join(dir,'flow.yaml');
   await writeFile(path,flow,{flag:'wx',mode:0o600});
   const execute=()=>appiumExecutor?appiumExecutor({journey:plan,deviceId,packageName}):runner('maestro',['--device',deviceId,'test',path],{timeoutMs:240000,outputLimit:64000});
   if(recordVideo)recording=await recordAndroidClip({deviceId,runner,execute});
   const result=recordVideo?recording.result:await execute();
   if(typeof result?.output==='string'&&!result.outputTruncated)capturedLog=result.output;
   return result;
  }finally{await rm(dir,{recursive:true,force:true});}
 }});
 if(appiumExecutor)report={...report,engine:'appium',independentReview:'PENDING'};
 if(evidenceStore){
  const diagnostics=await collectDeviceDiagnostics({deviceId,packageName,runner});
  report={...report,diagnostics};
 }
 if(recordVideo)report={...report,videoStatus:recording?.status??'CAPTURE_FAILED',videoCleanupVerified:recording?.cleanupVerified===true};
 if(!evidenceStore)return report;
 if(!capturedLog)return {...report,evidenceStatus:'NOT_CAPTURED'};
 try{
  // End-of-journey device screen, before APK uninstall; not an assertion-time screenshot.
  const screen=await runner('adb',['-s',deviceId,'exec-out','screencap','-p'],{timeoutMs:15000,outputLimit:12*1024*1024,binaryOutput:true});
  const screenshot=screen?.exitCode===0&&!screen.error&&!screen.timedOut&&!screen.outputTruncated&&Buffer.isBuffer(screen.stdoutBytes)?screen.stdoutBytes:undefined;
  const manifest=await evidenceStore.capture({deviceId,buildSha256,flowSha256:report.flowSha256,log:capturedLog,screenshot,video:recording?.video,reviewChallengeId});
  if(!screenshot||(recordVideo&&recording?.status!=='CLIP_CAPTURED'))return {...report,evidenceStatus:'CAPTURE_FAILED',evidenceManifest:manifest};
  return {...report,evidenceStatus:await evidenceStore.verify(manifest)?'CHECKSUM_VERIFIED':'INVALID',evidenceManifest:manifest};
 }catch{return {...report,evidenceStatus:'CAPTURE_FAILED'};}
}
