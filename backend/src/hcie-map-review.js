import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
// A separate trusted reviewer must explicitly accept the exact observation
// and independently retrieved bytes. Acceptance is not a test verdict.
export async function reviewMapObservation({scope,observation,readAgain,review,signal}){
 if(typeof review!=='function'||typeof readAgain!=='function'||!observation||observation.status!=='ANALYZED'||typeof observation.summary!=='string')throw Error('Invalid review request');
 if(signal?.aborted)throw Error('Review interrupted');
 const source=await readAgain();
 if(signal?.aborted||source.descriptor.id!==scope.descriptor.id||hash(source.bytes)!==scope.descriptor.chunkSha256)throw Error('Review source mismatch');
 const candidate=Object.freeze({status:observation.status,summary:observation.summary});
 const observationSha256=hash(JSON.stringify({taskId:scope.taskId,revisionSha256:scope.revisionSha256,policySha256:scope.policySha256,chunkId:scope.descriptor.id,chunkSha256:scope.descriptor.chunkSha256,...candidate}));
 const decision=await review({scope,bytes:source.bytes,observation:candidate,observationSha256,signal});
 if(signal?.aborted)throw Error('Review interrupted');
 if(decision?.accepted!==true||decision.observationSha256!==observationSha256||decision.chunkSha256!==scope.descriptor.chunkSha256)return null;
 return {accepted:true,observationSha256,chunkSha256:decision.chunkSha256,reviewerId:decision.reviewerId,reviewerDefinitionSha256:decision.reviewerDefinitionSha256};
}
