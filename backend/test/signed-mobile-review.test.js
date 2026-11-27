import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {attestMobileRun,reviewMobileRun,verifyMobileReview} from '../src/signed-mobile-review.js';
const worker=generateKeyPairSync('ed25519'),reviewer=generateKeyPairSync('ed25519');
function fixture(status='COMMAND_SUCCEEDED'){
 const manifest={runId:'run-1',deviceId:'device-1',buildSha256:'a'.repeat(64),flowSha256:'b'.repeat(64),artifacts:[{kind:'log'},{kind:'screenshot'}]};
 const report={...manifest,status,evidenceManifest:manifest};
 const store={verify:async m=>{assert.deepEqual(m,manifest);return true;}};
 return {manifest,report,store};
}
test('separate worker and reviewer signatures bind evidence to expected run',async()=>{
 const f=fixture(),attestation=await attestMobileRun({...f,privateKey:worker.privateKey});
 const input={attestation,manifest:f.manifest,store:f.store,workerPublicKey:worker.publicKey,reviewerPrivateKey:reviewer.privateKey,expected:f.manifest};
 const review=await reviewMobileRun(input);
 assert.equal(review.body.decision,'EVIDENCE_ACCEPTED');
 assert.equal(review.body.deploymentAuthorized,false);
 assert.equal(verifyMobileReview({review,attestation,reviewerPublicKey:reviewer.publicKey}),true);
 assert.equal(verifyMobileReview({review:{...review,body:{...review.body,decision:'BLOCKED'}},attestation,reviewerPublicKey:reviewer.publicKey}),false);
 await assert.rejects(reviewMobileRun({...input,reviewerPrivateKey:worker.privateKey}));
 await assert.rejects(reviewMobileRun({...input,expected:{...f.manifest,runId:'other'}}));
 await assert.rejects(reviewMobileRun({...input,manifest:{...f.manifest,artifacts:[]}}));
 await assert.rejects(reviewMobileRun({...input,workerPublicKey:reviewer.publicKey}));
});
test('failed run cannot obtain accepted evidence decision',async()=>{
 const f=fixture('COMMAND_FAILED'),attestation=await attestMobileRun({...f,privateKey:worker.privateKey});
 const review=await reviewMobileRun({attestation,manifest:f.manifest,store:f.store,workerPublicKey:worker.publicKey,reviewerPrivateKey:reviewer.privateKey,expected:f.manifest});
 assert.equal(review.body.decision,'BLOCKED');
});

test('asynchronous verifier cannot mutate attested or reviewed evidence',async()=>{
 const f=fixture('COMMAND_FAILED');
 const attestation=await attestMobileRun({...f,privateKey:worker.privateKey,store:{verify:async m=>{
  f.report.status='COMMAND_SUCCEEDED';m.deviceId='other';return true;
 }}});
 assert.equal(attestation.body.journeyStatus,'COMMAND_FAILED');
 assert.equal(attestation.body.deviceId,'device-1');
 const g=fixture();
 g.manifest.artifacts=[{kind:'log'}];
 const signed=await attestMobileRun({...g,privateKey:worker.privateKey});
 const review=await reviewMobileRun({attestation:signed,manifest:g.manifest,expected:g.manifest,workerPublicKey:worker.publicKey,reviewerPrivateKey:reviewer.privateKey,store:{verify:async m=>{
  m.artifacts.push({kind:'screenshot'});g.manifest.artifacts.push({kind:'screenshot'});return true;
 }}});
 assert.equal(review.body.decision,'BLOCKED');
 assert.equal(verifyMobileReview({review,attestation:signed,reviewerPublicKey:reviewer.publicKey}),true);
});
