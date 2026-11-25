import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {attestMobileRun,reviewMobileRun} from '../src/signed-mobile-review.js';
import {evaluateIndependentEvidence} from '../src/independent-verification.js';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
test('independent verification pins both signing identities and challenge',async()=>{
 const w=generateKeyPairSync('ed25519'),v=generateKeyPairSync('ed25519'),other=generateKeyPairSync('ed25519');
 const manifest={runId:'fixture-run',deviceId:'phone',buildSha256:'a'.repeat(64),flowSha256:'b'.repeat(64),reviewChallengeId:'challenge-one',artifacts:[{kind:'log'},{kind:'screenshot'}]};
 const store={verify:async m=>hash(m)===hash(manifest)};
 const attestation=await attestMobileRun({report:{...manifest,status:'COMMAND_SUCCEEDED',evidenceManifest:manifest},store,privateKey:w.privateKey});
 const review=await reviewMobileRun({attestation,manifest,store,workerPublicKey:w.publicKey,reviewerPrivateKey:v.privateKey,expected:manifest});
 const requirement={checkId:'smoke',deviceId:manifest.deviceId,buildSha256:manifest.buildSha256,flowSha256:manifest.flowSha256,workerKeyId:attestation.body.workerKeyId,challengeId:manifest.reviewChallengeId};
 const evidence={checkId:'smoke',manifest,attestation,review};
 const config={requirements:[requirement],evidence:[evidence],workerPublicKeys:[w.publicKey],reviewerPublicKey:v.publicKey,store};
 assert.equal((await evaluateIndependentEvidence(config)).status,'REQUIRED_EVIDENCE_VERIFIED');
 assert.equal((await evaluateIndependentEvidence({...config,requirements:[{...requirement,challengeId:'other-challenge'}]})).status,'BLOCKED');
 // Simulate a reviewer signing a forged worker attestation: reviewer signature
 // is mathematically valid, but the independently pinned worker is not.
 const forged={...attestation,signature:sign(null,Buffer.from(JSON.stringify(attestation.body)),other.privateKey).toString('base64')};
 const body={...review.body,attestationSha256:hash(forged)};
 const forgedReview={body,signature:sign(null,Buffer.from(JSON.stringify(body)),v.privateKey).toString('base64')};
 assert.equal((await evaluateIndependentEvidence({...config,evidence:[{...evidence,attestation:forged,review:forgedReview}]})).status,'BLOCKED');
 await assert.rejects(evaluateIndependentEvidence({...config,workerPublicKeys:[v.publicKey]}));
});
