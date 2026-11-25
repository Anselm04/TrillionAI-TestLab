import {createHash} from 'node:crypto';
import {compileMaestro,validateJourney} from './mobile-journey.js';
import {attestMobileRun,verifyMobileReview} from './signed-mobile-review.js';

// Trusted local worker boundary. The reviewer callback must belong to a separately
// controlled service; the worker never receives its private key.
export class MobileReviewOrchestrator {
 #supervisor; #store; #workerKey; #review; #reviewerPublicKey;
 constructor({supervisor,store,workerPrivateKey,review,reviewerPublicKey}={}){
  if(typeof supervisor?.smoke!=='function'||typeof store?.verify!=='function'||!workerPrivateKey||typeof review!=='function'||!reviewerPublicKey)throw new Error('Complete review configuration required');
  this.#supervisor=supervisor;this.#store=store;this.#workerKey=workerPrivateKey;this.#review=review;this.#reviewerPublicKey=reviewerPublicKey;
 }
 async run(input){
  const plan=validateJourney(input?.journey);
  if(plan.packageName!==input.packageName||typeof input.apkSha256!=='string'||!(/^[a-f0-9]{64}$/).test(input.apkSha256))throw new Error('Invalid expected build or journey');
  const flowSha256=createHash('sha256').update(compileMaestro(plan)).digest('hex');
  const blocked=(reason,report=null)=>({status:'BLOCKED',reason,report,productionReady:false,deploymentAuthorized:false});
  let report;
  try{
   report=await this.#supervisor.smoke({...input,journey:plan});
   const j=report?.journeyReport,m=j?.evidenceManifest;
   if(report?.status!=='SMOKE_OBSERVED'||report.leaseReleased!==true||report.cleanupVerified!==true||j?.status!=='COMMAND_SUCCEEDED'||j.evidenceStatus!=='CHECKSUM_VERIFIED'||!m)return blocked('Execution or evidence incomplete',report);
   if(j.deviceId!==input.deviceId||j.buildSha256!==input.apkSha256||j.flowSha256!==flowSha256||j.journeyId!==plan.id)return blocked('Execution context mismatch',report);
   const attestation=await attestMobileRun({report:j,store:this.#store,privateKey:this.#workerKey});
   const expected={runId:m.runId,deviceId:input.deviceId,buildSha256:input.apkSha256,flowSha256};
   const review=await this.#review({attestation,manifest:m,expected});
   if(!verifyMobileReview({review,attestation,reviewerPublicKey:this.#reviewerPublicKey})||review.body.decision!=='EVIDENCE_ACCEPTED')return blocked('Independent evidence review not accepted',report);
   return {status:'EVIDENCE_REVIEWED',report,attestation,review,productionReady:false,deploymentAuthorized:false};
  }catch{return blocked('Execution or review infrastructure failure',report);}
 }
}
