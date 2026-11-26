import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
const sha=/^[a-f0-9]{64}$/;
export function observationDigest(task,result){
 return hash(JSON.stringify({taskId:task.taskId,revisionSha256:task.revisionSha256,policySha256:task.policySha256,chunkId:task.chunkId,chunkSha256:task.chunkSha256,status:result.status,summary:result.summary}));
}
export function canonicalReviewEvidence(task,result,evidence){
 if(!evidence||typeof evidence.reviewerId!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(evidence.reviewerId)||typeof evidence.reviewerDefinitionSha256!=='string'||!sha.test(evidence.reviewerDefinitionSha256)||evidence.observationSha256!==observationDigest(task,result)||evidence.chunkSha256!==task.chunkSha256||evidence.accepted!==true)throw Error('Invalid review evidence');
 return {reviewerId:evidence.reviewerId,reviewerDefinitionSha256:evidence.reviewerDefinitionSha256,observationSha256:evidence.observationSha256,chunkSha256:evidence.chunkSha256,accepted:true};
}
