import {createHash,verify} from 'node:crypto';
import {evaluateReleaseEvidence} from './release-evidence-gate.js';
const sha=/^[a-f0-9]{64}$/;
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const keyId=key=>createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex');
const validKey=key=>key?.type==='public'&&key.asymmetricKeyType==='ed25519';
const signature=s=>typeof s==='string'&&/^[A-Za-z0-9+/]{86}==$/.test(s)&&Buffer.from(s,'base64').toString('base64')===s;
// Trust roots and challenge bindings are configured independently of submitted
// evidence. A reviewer signature alone cannot substitute for a worker signature.
export async function evaluateIndependentEvidence({requirements,evidence,workerPublicKeys,reviewerPublicKey,store}={}){
 if(!Array.isArray(requirements)||!requirements.length||requirements.length>500||!Array.isArray(evidence)||evidence.length>500||!Array.isArray(workerPublicKeys)||!workerPublicKeys.length||workerPublicKeys.length>100||!validKey(reviewerPublicKey)||!workerPublicKeys.every(validKey)||typeof store?.verify!=='function')throw Error('Invalid independent trust policy');
 const reviewerId=keyId(reviewerPublicKey),workers=new Map();
 for(const key of workerPublicKeys){const k=keyId(key);if(k===reviewerId||workers.has(k))throw Error('Distinct trust roots required');workers.set(k,key);}
 const expected=new Map(),challenges=new Set();
 for(const r of requirements){
  if(typeof r?.checkId!=='string'||!id.test(r.checkId)||expected.has(r.checkId)||typeof r.workerKeyId!=='string'||!sha.test(r.workerKeyId)||!workers.has(r.workerKeyId)||typeof r.challengeId!=='string'||!id.test(r.challengeId)||challenges.has(r.challengeId))throw Error('Invalid independent requirement');
  expected.set(r.checkId,r);challenges.add(r.challengeId);
 }
 const valid=[],rejected=[],seen=new Set();
 for(const e of evidence){
  if(!expected.has(e?.checkId)||seen.has(e.checkId))throw Error('Unexpected or duplicate evidence');
  seen.add(e.checkId);
  const r=expected.get(e.checkId),a=e.attestation,b=a?.body;
  try{
   if(!b||b.schemaVersion!==1||b.workerKeyId!==r.workerKeyId||e.manifest?.reviewChallengeId!==r.challengeId||!signature(a.signature)||!verify(null,Buffer.from(JSON.stringify(b)),workers.get(r.workerKeyId),Buffer.from(a.signature,'base64')))throw Error('Worker trust or challenge mismatch');
   valid.push(e);
  }catch{rejected.push(e.checkId);}
 }
 const result=await evaluateReleaseEvidence({requirements,evidence:valid,reviewerPublicKey,store});
 return {...result,checks:result.checks.map(c=>rejected.includes(c.checkId)?{...c,reason:'WORKER_AUTHENTICITY_OR_CHALLENGE_FAILED'}:c),verificationMode:'PINNED_WORKER_AND_REVIEWER',productionReady:false,deploymentAuthorized:false};
}
