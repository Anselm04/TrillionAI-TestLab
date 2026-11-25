import {runMobileJob} from './mobile-jobs.js';
// The trusted host supplies discovery and profile execution functions. A worker
// may only poll its own platform. Heartbeats continue during test execution.
export async function runMobileWorkerOnce({client,platform,discover,execute}){
 if(!['android','ios'].includes(platform)||typeof discover!=='function'||typeof execute!=='function'||!['heartbeat','poll','complete','claim','finish'].every(k=>typeof client?.[k]==='function'))throw Error('Invalid worker configuration');
 const beat=async()=>{
  const devices=await discover();
  if(!Array.isArray(devices)||devices.some(d=>d?.platform!==platform))throw Error('Invalid worker inventory');
  if((await client.heartbeat(devices)).accepted!==true)throw Error('Heartbeat rejected');
 };
 await beat();
 const {job}=await client.poll(platform);
 if(!job)return {status:'IDLE'};
 let lost=false,pending=Promise.resolve();
 const timer=setInterval(()=>{pending=pending.then(async()=>{try{await beat();}catch{lost=true;}});},10000);
 timer.unref?.();
 let result;
 try{
  result=await runMobileJob({job,rackClient:client,execute:async context=>{
   if(lost)throw Error('Worker heartbeat lost');
   const report=await execute(context);
   if(lost)throw Error('Worker heartbeat lost');
   return report;
  }});
 }catch{result={status:'BLOCKED',rackReleased:false};}
 finally{clearInterval(timer);await pending;}
 if(lost)result={status:'BLOCKED',rackReleased:false};
 const done=await client.complete({...job,result});
 return {status:done.accepted===true?result.status:'BLOCKED',jobId:job.jobId,productionReady:false,deploymentAuthorized:false};
}
