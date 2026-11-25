import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {compileMaestro,compileExecutionPlan} from '../src/mobile-journey.js';
import {reviewMobileRun} from '../src/signed-mobile-review.js';
import {MobileReviewOrchestrator} from '../src/mobile-review-orchestrator.js';
const worker=generateKeyPairSync('ed25519'),reviewer=generateKeyPairSync('ed25519');
function fixture(){
 const input={reviewChallengeId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',deviceId:'device-1',packageName:'com.test.app',apkSha256:'a'.repeat(64),journey:{id:'welcome',packageName:'com.test.app',steps:[{action:'launch'},{action:'assertVisible',text:'Welcome'},{action:'stop'}]}};
 const m={reviewChallengeId:input.reviewChallengeId,runId:'run-1',deviceId:input.deviceId,buildSha256:input.apkSha256,flowSha256:createHash('sha256').update(compileMaestro(input.journey)).digest('hex'),artifacts:[{kind:'log'},{kind:'screenshot'}]};
 const store={verify:async manifest=>manifest===m};
 const report={status:'SMOKE_OBSERVED',leaseReleased:true,cleanupVerified:true,journeyReport:{...m,journeyId:'welcome',status:'COMMAND_SUCCEEDED',evidenceStatus:'CHECKSUM_VERIFIED',evidenceManifest:m}};
 const config={supervisor:{smoke:async()=>report},store,workerPrivateKey:worker.privateKey,reviewerPublicKey:reviewer.publicKey,review:args=>reviewMobileRun({...args,store,workerPublicKey:worker.publicKey,reviewerPrivateKey:reviewer.privateKey})};
 return {input,report,config};
}
test('orchestrate separate worker and reviewer signatures without deployment authority',async()=>{
 const {input,config}=fixture();
 const result=await new MobileReviewOrchestrator(config).run(input);
 assert.equal(result.status,'EVIDENCE_REVIEWED');assert.equal(result.review.body.decision,'EVIDENCE_ACCEPTED');
 assert.equal(result.productionReady,false);assert.equal(result.deploymentAuthorized,false);
});
test('incomplete execution, mismatched flow and failed reviewer block',async()=>{
 for(const mutate of [f=>{f.report.cleanupVerified=false},f=>{f.report.journeyReport.flowSha256='b'.repeat(64)},f=>{f.config.review=async()=>{throw Error('offline')}},f=>{f.config.review=async()=>({body:{decision:'EVIDENCE_ACCEPTED'},signature:'invalid'})}]){
  const f=fixture();mutate(f);
  assert.equal((await new MobileReviewOrchestrator(f.config).run(f.input)).status,'BLOCKED');
 }
});

test('Appium review requires its own plan digest and engine identity',async()=>{
 const f=fixture();
 f.input.engine='appium';
 const j=f.report.journeyReport,m=j.evidenceManifest;
 const maestro=m.flowSha256;
 m.flowSha256=createHash('sha256').update(compileExecutionPlan(f.input.journey,'appium')).digest('hex');
 assert.notEqual(m.flowSha256,maestro);
 j.flowSha256=m.flowSha256;j.engine='appium';
 const o=new MobileReviewOrchestrator(f.config);
 assert.equal((await o.run(f.input)).status,'EVIDENCE_REVIEWED');
 j.engine='maestro';
 assert.equal((await o.run(f.input)).status,'BLOCKED');
 j.engine='appium';j.flowSha256=maestro;
 assert.equal((await o.run(f.input)).status,'BLOCKED');
});
