import {randomUUID} from 'node:crypto';
const serial=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ok=r=>r?.exitCode===0&&!r.error&&!r.timedOut&&!r.outputTruncated;
export const VIDEO_LIMIT=32*1024*1024;
// Structural check only; not a decoder or proof of video coverage.
export function hasMp4Header(bytes){
 return Buffer.isBuffer(bytes)&&bytes.length>=16&&bytes.toString('ascii',4,8)==='ftyp'&&bytes.readUInt32BE(0)>=16&&bytes.readUInt32BE(0)<=bytes.length;
}
// The trusted lease guard must wrap the runner. Capture is bounded to a 30-second
// clip and never claims complete journey coverage or synchronized start.
export async function recordAndroidClip({deviceId,runner,execute}){
 if(typeof deviceId!=='string'||!serial.test(deviceId)||typeof runner!=='function'||typeof execute!=='function')throw new Error('Invalid recording context');
 const path='/data/local/tmp/testlab-'+randomUUID()+'.mp4';
 const adb=(args,options)=>runner('adb',['-s',deviceId,...args],options);
 let video, result, executionError, recordingError;
 let cleanupVerified=false;
 try{
  const record=Promise.resolve().then(()=>adb(['shell','screenrecord','--time-limit','30','--bit-rate','2000000',path],{timeoutMs:45000,outputLimit:64000}));
  const task=Promise.resolve().then(execute);
  const [r,t]=await Promise.allSettled([record,task]);
  if(t.status==='fulfilled')result=t.value;else executionError=t.reason;
  if(r.status==='fulfilled'&&ok(r.value)){
   const pull=await adb(['exec-out','cat',path],{timeoutMs:20000,outputLimit:VIDEO_LIMIT,binaryOutput:true});
   if(ok(pull)&&hasMp4Header(pull.stdoutBytes))video=pull.stdoutBytes;
  }
 }catch(e){recordingError=e;}
 finally{
  try{
   const removed=await adb(['shell','rm','-f',path],{timeoutMs:15000,outputLimit:64000});
   const absent=await adb(['shell','test','!','-e',path],{timeoutMs:15000,outputLimit:64000});
   cleanupVerified=ok(removed)&&ok(absent);
  }catch{cleanupVerified=false;}
 }
 return {result,video,executionError:!!executionError,recordingError:!!recordingError,cleanupVerified,status:video&&cleanupVerified&&!recordingError?'CLIP_CAPTURED':'CAPTURE_FAILED'};
}
