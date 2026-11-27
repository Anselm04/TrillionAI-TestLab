import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {attestMobileRun,reviewMobileRun} from '../src/signed-mobile-review.js';
import {evaluateReleaseEvidence} from '../src/release-evidence-gate.js';
test('release gate verifies signed evidence and blocks missing or reused runs',async()=>{
 const worker=generateKeyPairSync('ed25519'),reviewer=generateKeyPairSync('ed25519');
 const manifest={runId:'run-1',deviceId:'phone',buildSha256:'a'.repeat(64),flowSha256:'b'.repeat(64),artifacts:[{kind:'log'},{kind:'screenshot'}]};
 const store={verify:async m=>isDeepStrictEqual(m,manifest)};
 const attestation=await attestMobileRun({report:{...manifest,status:'COMMAND_SUCCEEDED',evidenceManifest:manifest},store,privateKey:worker.privateKey});
 const review=await reviewMobileRun({attestation,manifest,store,workerPublicKey:worker.publicKey,reviewerPrivateKey:reviewer.privateKey,expected:manifest});
 const requirement={checkId:'smoke',deviceId:manifest.deviceId,buildSha256:manifest.buildSha256,flowSha256:manifest.flowSha256};
 const evidence={checkId:'smoke',manifest,attestation,review};
 const config={requirements:[requirement],evidence:[evidence],reviewerPublicKey:reviewer.publicKey,store};
 const good=await evaluateReleaseEvidence(config);
 assert.equal(good.status,'REQUIRED_EVIDENCE_VERIFIED');assert.equal(good.deploymentAuthorized,false);
 const detached=await evaluateReleaseEvidence({...config,store:{verify:async m=>{
  assert.notEqual(m,manifest);
  assert.deepEqual(m,manifest);
  return true;
 }}});
 assert.equal(detached.status,'REQUIRED_EVIDENCE_VERIFIED');
 assert.equal(detached.policySha256,createHash('sha256').update(JSON.stringify(config.requirements)).digest('hex'));
 for(const override of [{evidence:[]},{requirements:[{...requirement,requireVideo:true}]},{requirements:[{...requirement,buildSha256:'c'.repeat(64)}]},{evidence:[{...evidence,review:{...review,signature:'invalid'}}]},{requirements:[requirement,{...requirement,checkId:'second'}],evidence:[evidence,{...evidence,checkId:'second'}]}]){
  assert.equal((await evaluateReleaseEvidence({...config,...override})).status,'BLOCKED');
 }
});

test('release policy rejects malformed video requirements and coerced identifiers',async()=>{
 const reviewer=generateKeyPairSync('ed25519');
 const requirement={checkId:'smoke',deviceId:'phone',buildSha256:'a'.repeat(64),flowSha256:'b'.repeat(64)};
 for(const change of [{requireVideo:'true'},{requireVideo:1},{requireVideo:null},{checkId:123},{deviceId:['phone']},{buildSha256:['a'.repeat(64)]},{flowSha256:['b'.repeat(64)]}]){
  await assert.rejects(evaluateReleaseEvidence({requirements:[{...requirement,...change}],evidence:[],reviewerPublicKey:reviewer.publicKey,store:{verify:async()=>assert.fail('unexpected verification')}}),/Invalid requirement/);
 }
});
