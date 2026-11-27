import {createHash} from 'node:crypto';
import {verifyMobileReview} from './signed-mobile-review.js';
const sha=/^[a-f0-9]{64}$/;
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
// Requirements and reviewer keys are trusted release-policy inputs, never
// supplied by an untrusted worker. This gate cannot authorize deployment.
export async function evaluateReleaseEvidence({requirements,evidence,reviewerPublicKey,store}){
 if(!Array.isArray(requirements)||!requirements.length||requirements.length>500||!Array.isArray(evidence)||evidence.length>500||typeof store?.verify!=='function'||reviewerPublicKey?.asymmetricKeyType!=='ed25519')throw Error('Invalid release policy');
 // Review one stable policy/evidence snapshot. The asynchronous artifact
 // verifier receives a detached manifest, not references to the input objects.
 requirements=structuredClone(requirements);
 evidence=structuredClone(evidence);
 const policySha256=hash(requirements);
 const expected=new Map(),submitted=new Map(),runs=new Set();
 for(const r of requirements){
  if(!r||typeof r.checkId!=='string'||typeof r.deviceId!=='string'||typeof r.buildSha256!=='string'||typeof r.flowSha256!=='string'||!id.test(r.checkId)||!id.test(r.deviceId)||!sha.test(r.buildSha256)||!sha.test(r.flowSha256)||(Object.hasOwn(r,'requireVideo')&&typeof r.requireVideo!=='boolean')||expected.has(r.checkId))throw Error('Invalid requirement');
  expected.set(r.checkId,r);
 }
 for(const e of evidence){
  if(!expected.has(e?.checkId)||submitted.has(e.checkId))throw Error('Unexpected or duplicate evidence');
  submitted.set(e.checkId,e);
 }
 const checks=[];
 for(const [checkId,r] of expected){
  const e=submitted.get(checkId);let reason='MISSING_EVIDENCE';
  if(e){
   try{
    const {manifest:m,attestation:a,review:v}=e,b=a.body;
    if(!id.test(b.runId??'')||runs.has(b.runId))throw Error('Duplicate run');
    if(b.deviceId!==r.deviceId||b.buildSha256!==r.buildSha256||b.flowSha256!==r.flowSha256||b.journeyStatus!=='COMMAND_SUCCEEDED'||m.runId!==b.runId||m.deviceId!==b.deviceId||m.buildSha256!==b.buildSha256||m.flowSha256!==b.flowSha256||hash(m)!==b.manifestSha256)throw Error('Context mismatch');
    if(!verifyMobileReview({review:v,attestation:a,reviewerPublicKey})||v.body.decision!=='EVIDENCE_ACCEPTED'||!await store.verify(structuredClone(m)))throw Error('Review or artifact verification failed');
    const kinds=new Set(m.artifacts.map(x=>x.kind));
    if(!kinds.has('log')||!kinds.has('screenshot')||(r.requireVideo===true&&!kinds.has('video')))throw Error('Required artifacts missing');
    runs.add(b.runId);reason=null;
   }catch{reason='INVALID_OR_INCOMPLETE_EVIDENCE';}
  }
  checks.push({checkId,status:reason?'BLOCKED':'VERIFIED',reason});
 }
 return {status:checks.every(c=>c.status==='VERIFIED')?'REQUIRED_EVIDENCE_VERIFIED':'BLOCKED',checks,policySha256,productionReady:false,deploymentAuthorized:false};
}
