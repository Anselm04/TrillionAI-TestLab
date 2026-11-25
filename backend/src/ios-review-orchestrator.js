import {attestMobileRun,verifyMobileReview} from './signed-mobile-review.js';
const sha=/^[a-f0-9]{64}$/;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
// The expected test plan digest is trusted configuration, not inferred from evidence.
export function createIosReviewOrchestrator({supervisor,store,workerPrivateKey,reviewerPublicKey,review,testRunSha256}={}){
 if(typeof supervisor?.smoke!=='function'||typeof store?.verify!=='function'||workerPrivateKey?.type!=='private'||workerPrivateKey.asymmetricKeyType!=='ed25519'||reviewerPublicKey?.type!=='public'||reviewerPublicKey.asymmetricKeyType!=='ed25519'||typeof review!=='function'||typeof testRunSha256!=='string'||!sha.test(testRunSha256))throw Error('Trusted iOS review configuration required');
 return async input=>{
  const blocked=(reason,report=null)=>({status:'BLOCKED',reason,report,productionReady:false,deploymentAuthorized:false});
  if(typeof input?.deviceId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9-]{0,120}$/.test(input.deviceId)||typeof input.artifactSha256!=='string'||!sha.test(input.artifactSha256)||typeof input.reviewChallengeId!=='string'||!uuid.test(input.reviewChallengeId))return blocked('Invalid review context');
  let report;
  try{
   report=await supervisor.smoke(input);
   const e=report?.execution,m=e?.evidenceManifest,deviceId='ios:'+input.deviceId;
   if(report?.status!=='SMOKE_OBSERVED'||report.cleanupVerified!==true||report.leaseReleased!==true||report.deviceId!==input.deviceId||report.artifactSha256!==input.artifactSha256||e?.status!=='COMMAND_SUCCEEDED'||e.evidenceStatus!=='CHECKSUM_VERIFIED'||e.deviceId!==input.deviceId||e.artifactSha256!==input.artifactSha256||e.testRunSha256!==testRunSha256||!m||m.reviewChallengeId!==input.reviewChallengeId)return blocked('Incomplete execution or mismatched challenge',report);
   const expected={runId:m.runId,deviceId,buildSha256:input.artifactSha256,flowSha256:testRunSha256};
   const attestation=await attestMobileRun({report:{...expected,status:e.status,evidenceManifest:m},store,privateKey:workerPrivateKey});
   const signedReview=await review({challengeId:input.reviewChallengeId,manifest:m,attestation});
   if(!verifyMobileReview({review:signedReview,attestation,reviewerPublicKey})||signedReview.body.decision!=='EVIDENCE_ACCEPTED')return blocked('Independent review rejected',report);
   return {status:'EVIDENCE_REVIEWED',report,manifest:m,attestation,review:signedReview,productionReady:false,deploymentAuthorized:false};
  }catch{return blocked('Execution or review infrastructure failure',report);}
 };
}
