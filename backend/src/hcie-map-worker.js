import {reviewMapObservation} from './hcie-map-review.js';
import {readVerifiedChunk} from './hcie-chunk-reader.js';
// Trusted local supervisor. Analyzer must be read-only and independently
// enforce isolation, hard deadlines and any model expenditure budget.
export async function runMapWorkerOnce({queue,store,chunks,analyze,review,checkCapacity,signal,leaseMs=30000}={}){
 if(!['claim','complete'].every(k=>typeof queue?.[k]==='function')||typeof store?.root!=='function'||typeof chunks?.page!=='function'||typeof analyze!=='function'||typeof review!=='function'||review===analyze||typeof checkCapacity!=='function'||!Number.isInteger(leaseMs)||leaseMs<100||leaseMs>300000)throw Error('Invalid worker configuration');
 if(signal?.aborted||await checkCapacity()!==true||signal?.aborted)return {status:'PAUSED'};
 const task=queue.claim({leaseMs});
 if(!task)return {status:'IDLE'};
 const deadline=AbortSignal.timeout(Math.max(1,task.expiresAt-Date.now()));
 const stop=signal?AbortSignal.any([signal,deadline]):deadline;
 const guard=()=>{if(stop.aborted||Date.now()>=task.expiresAt)throw Error('Lease or cancellation');};
 const binding={chunkId:task.chunkId,chunkSha256:task.chunkSha256,policySha256:task.policySha256};
 const finish=result=>({taskId:task.taskId,status:queue.complete({taskId:task.taskId,token:task.token,result:{...result,...binding}})?result.status:'STALE'});
 try{
  guard();
  const source=await readVerifiedChunk({store,chunks,path:task.path,index:task.index,expectedRevisionSha256:task.revisionSha256,expectedManifestSha256:task.manifestSha256,signal:stop});
  guard();
  if(source.descriptor.id!==task.chunkId||source.descriptor.chunkSha256!==task.chunkSha256)throw Error('Task source mismatch');
  if(await checkCapacity()!==true)throw Error('Capacity unavailable');
  guard();
  const scope=Object.freeze({taskId:task.taskId,revisionSha256:task.revisionSha256,policySha256:task.policySha256,descriptor:source.descriptor});
  const observation=await analyze({scope,bytes:source.bytes,signal:stop});
  guard();
  if(!observation||!['ANALYZED','INCOMPLETE'].includes(observation.status)||typeof observation.summary!=='string'||observation.summary.length>16384||Buffer.byteLength(observation.summary)>65536)throw Error('Invalid analyzer observation');
  if(observation.status==='ANALYZED'){
   if(await checkCapacity()!==true)throw Error('Review capacity unavailable');
   guard();
   const accepted=await reviewMapObservation({scope,observation,review,signal:stop,readAgain:()=>readVerifiedChunk({store,chunks,path:task.path,index:task.index,expectedRevisionSha256:task.revisionSha256,expectedManifestSha256:task.manifestSha256,signal:stop})});
   guard();
   if(!accepted)return finish({status:'INCOMPLETE',summary:'Independent review did not accept observation.'});
  }
  return finish({status:observation.status,summary:observation.summary});
 }catch{
  if(stop.aborted||Date.now()>=task.expiresAt)return {taskId:task.taskId,status:'INTERRUPTED'};
  return finish({status:'INCOMPLETE',summary:'Source retrieval, capacity or analysis failed; no verified conclusion.'});
 }
}
