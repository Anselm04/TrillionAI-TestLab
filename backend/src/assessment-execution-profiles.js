import {createHash} from 'node:crypto';
import {verifyIncrementHistory} from './transaction-integrity.js';
import {assessAccessibility} from './accessibility-testing.js';
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const sha=/^[a-f0-9]{64}$/;
const valid=(v,r)=>typeof v==='string'&&r.test(v);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const engines=Object.freeze({
 transaction:{pass:'DECLARED_INCREMENT_MODEL_PASSED',fail:'VERIFIED_FAILURE',assess:(data,c,verifyEvidence)=>verifyIncrementHistory({history:data.history,initial:data.initial,final:data.final,revisionSha256:c.revisionSha256,environmentId:c.environmentId,verifyEvidence})},
 accessibility:{pass:'DECLARED_RULES_PASSED',fail:'VERIFIED_RULE_FINDINGS',assess:(data,c,verifyEvidence)=>assessAccessibility({revisionSha256:c.revisionSha256,environmentId:c.environmentId,journeyId:c.journeyId,snapshot:data.snapshot,verifyEvidence})}
});
// Trusted host collectors must enforce isolation and deadlines. No submitted
// command, verifier or execution settings are accepted from customer input.
export function createAssessmentExecutionProfile({kind,profileId,testId,environmentId,revisionSha256,fixtureSha256,journeyId=testId,collect,verifyEvidence,verifyReport}={}){
 if(!Object.hasOwn(engines,kind)||![profileId,testId,environmentId,journeyId].every(v=>valid(v,id))||![revisionSha256,fixtureSha256].every(v=>valid(v,sha))||[collect,verifyEvidence,verifyReport].some(v=>typeof v!=='function'))throw Error('Invalid assessment profile');
 const engine=engines[kind],definitionSha256=hash({kind,version:1,testId,environmentId,fixtureSha256,journeyId});
 const bound=c=>c?.profileId===profileId&&c.revisionSha256===revisionSha256&&c.definitionSha256===definitionSha256&&valid(c.runId,id);
 const status=r=>r?.status===engine.pass?'PASSED':r?.status===engine.fail?'FAILED':null;
 return Object.freeze({id:profileId,definitionSha256,async execute(c,signal){
  if(!bound(c)||signal?.aborted)throw Error('Assessment context rejected');
  const scope={...c,testId,environmentId,journeyId};
  const collected=await collect(structuredClone(scope),signal);
  if(signal?.aborted||collected?.runId!==c.runId||collected.revisionSha256!==revisionSha256||collected.definitionSha256!==definitionSha256||collected.environmentId!==environmentId)throw Error('Collection context mismatch');
  const encoded=JSON.stringify(collected.data);
  if(typeof encoded!=='string'||Buffer.byteLength(encoded)>8388608)throw Error('Collection budget exceeded');
  const report=await engine.assess(JSON.parse(encoded),scope,async evidence=>!signal?.aborted&&await verifyEvidence(evidence,structuredClone(scope))===true);
  const observed=status(report);
  if(!observed||signal?.aborted)throw Error('Assessment incomplete');
  return {...c,testId,environmentId,evidenceId:hash({runId:c.runId,report}),status:observed,report};
 },async verify(o,c){
  if(!bound(c)||!bound(o)||o.runId!==c.runId||o.testId!==testId||o.environmentId!==environmentId||!status(o.report)||status(o.report)!==o.status||o.evidenceId!==hash({runId:c.runId,report:o.report}))return false;
  return await verifyReport(structuredClone(o.report),{...c,testId,environmentId,journeyId})===true;
 }});
}
