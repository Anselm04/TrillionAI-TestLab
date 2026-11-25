import {mkdtemp,readdir,lstat,realpath,open,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,isAbsolute,relative,sep} from 'node:path';
import {runProcess} from './core.js';
import {VIDEO_LIMIT} from './android-video.js';
const sha=/^[a-f0-9]{64}$/;
const ok=r=>r?.exitCode===0&&!r.error&&!r.timedOut&&!r.outputTruncated;
async function readBounded(path,limit){
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const s=await fd.stat();if(!s.isFile()||s.size<1||s.size>limit)throw Error('Invalid attachment size');
  const b=Buffer.alloc(s.size);let n=0;
  while(n<b.length){const {bytesRead}=await fd.read(b,n,b.length-n,n);if(!bytesRead)throw Error('Incomplete attachment');n+=bytesRead;}
  if((await fd.stat()).size!==s.size)throw Error('Attachment changed');
  return b;
 }finally{await fd.close();}
}
// Export completed XCTest attachments only. Missing media is not synthesized.
export function createIosEvidenceExecutor({execute,store,evidenceRoot,runner=runProcess,requireVideo=true}={}){
 if(typeof execute!=='function'||typeof store?.capture!=='function'||typeof store?.verify!=='function'||typeof evidenceRoot!=='string'||!isAbsolute(evidenceRoot))throw Error('Trusted evidence configuration required');
 return async context=>{
  const report=await execute(context);
  const failed=reason=>({...report,status:'BLOCKED',evidenceStatus:'CAPTURE_FAILED',reason,productionReady:false,deploymentAuthorized:false});
  if(report?.status!=='COMMAND_SUCCEEDED')return report;
  let dir;
  try{
   if(report.deviceId!==context.deviceId||report.artifactSha256!==context.artifactSha256||!sha.test(report.testRunSha256??''))return failed('Evidence context mismatch');
   const root=await realpath(evidenceRoot),result=await realpath(report.resultBundle),rel=relative(root,result);
   if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)||!result.endsWith('.xcresult')||!(await lstat(result)).isDirectory())return failed('Result outside evidence root');
   dir=await mkdtemp(join(root,'ios-attachments-'));
   const r=await runner('xcrun',['xcresulttool','export','attachments','--path',result,'--output-path',dir],{timeoutMs:30000,outputLimit:64000});
   if(!ok(r))return failed('Attachment export failed');
   const files=await readdir(dir);if(files.length>1000)return failed('Too many attachments');
   const pick=ext=>files.filter(n=>n.toLowerCase().endsWith(ext)).sort()[0];
   const png=pick('.png'),mp4=pick('.mp4');
   if(!png||(requireVideo&&!mp4))return failed('Required recorded media missing');
   const screenshot=await readBounded(join(dir,png),12*1024*1024);
   const video=mp4?await readBounded(join(dir,mp4),VIDEO_LIMIT):undefined;
   const manifest=await store.capture({deviceId:'ios:'+context.deviceId,buildSha256:context.artifactSha256,flowSha256:report.testRunSha256,log:JSON.stringify({engine:'xcuitest',counts:report.counts,mediaSource:'xcresult-export',screenshotAttachment:png,videoAttachment:mp4??null}),screenshot,video,reviewChallengeId:context.reviewChallengeId});
   if(!await store.verify(manifest))return failed('Evidence checksum failed');
   return {...report,evidenceStatus:'CHECKSUM_VERIFIED',evidenceManifest:manifest,independentReview:'PENDING',productionReady:false,deploymentAuthorized:false};
  }catch{return failed('Attachment export or storage failed');}
  finally{if(dir)await rm(dir,{recursive:true,force:true});}
 };
}
