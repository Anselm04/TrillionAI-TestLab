import {createHash} from 'node:crypto';
import {evaluateIndependentEvidence} from './independent-verification.js';
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const sha=/^[a-f0-9]{64}$/;
const valid=(v,re)=>typeof v==='string'&&re.test(v);
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
// Trusted plan binds each test to one immutable submitted revision, its test
// definition and environment. Observations never introduce new requirements.
export function createTraceabilityPlan({revisionSha256,requirements,tests}={}){
 if(!valid(revisionSha256,sha)||!Array.isArray(requirements)||!requirements.length||requirements.length>500||!Array.isArray(tests)||tests.length>500)throw Error('Invalid traceability plan');
 const known=new Set(),testIds=new Set(),links=new Map();
 const reqs=requirements.map(r=>{
  if(!valid(r?.id,id)||known.has(r.id)||typeof r.title!=='string'||!r.title.trim()||r.title.length>500)throw Error('Invalid requirement');
  known.add(r.id);links.set(r.id,[]);
  return {id:r.id,title:r.title};
 });
 const cases=tests.map(t=>{
  if(!valid(t?.id,id)||testIds.has(t.id)||!valid(t.definitionSha256,sha)||!valid(t.environmentId,id)||!Array.isArray(t.requirementIds)||!t.requirementIds.length||t.requirementIds.length>500||new Set(t.requirementIds).size!==t.requirementIds.length||t.requirementIds.some(x=>!known.has(x)))throw Error('Invalid test mapping');
  testIds.add(t.id);
  for(const r of t.requirementIds)links.get(r).push(t.id);
  return {id:t.id,definitionSha256:t.definitionSha256,environmentId:t.environmentId,requirementIds:[...t.requirementIds].sort()};
 });
 const body={schemaVersion:1,revisionSha256,requirements:reqs.sort((a,b)=>a.id.localeCompare(b.id)),tests:cases.sort((a,b)=>a.id.localeCompare(b.id))};
 return {...body,planSha256:hash(body)};
}
// verifyObservation is a trusted independent adapter. It must bind the exact
// observation to independently verified evidence, not trust a submitted flag.
export async function evaluateTraceability({plan,observations,verifyObservation}={}){
 const canonical=createTraceabilityPlan(plan);
 if(plan.planSha256!==canonical.planSha256||!Array.isArray(observations)||observations.length>500||typeof verifyObservation!=='function')throw Error('Invalid assessment input');
 const cases=new Map(canonical.tests.map(t=>[t.id,t])),submitted=new Map(),seen=new Set();
 for(const o of structuredClone(observations)){
  if(!cases.has(o?.testId)||submitted.has(o.testId)||!valid(o.evidenceId,id)||seen.has(o.evidenceId))throw Error('Unexpected or duplicate observation');
  submitted.set(o.testId,o);seen.add(o.evidenceId);
 }
 const results=[];
 for(const t of canonical.tests){
  const o=submitted.get(t.id);
  let status='NOT_EXECUTED',reason='NO_OBSERVATION',evidenceId=null;
  if(o){
   status='UNVERIFIED';reason='EVIDENCE_NOT_VERIFIED';
   if(o.revisionSha256!==canonical.revisionSha256||o.definitionSha256!==t.definitionSha256||o.environmentId!==t.environmentId)reason='CONTEXT_MISMATCH';
   else if(['PASSED','FAILED','TIMEOUT','INFRASTRUCTURE_ERROR'].includes(o.status)){
    try{
     if(await verifyObservation(structuredClone(o),structuredClone(t),canonical.revisionSha256)===true){status=o.status;reason=null;evidenceId=o.evidenceId;}
    }catch{reason='VERIFIER_ERROR';}
   }
  }
  results.push({testId:t.id,status,reason,evidenceId});
 }
 const byId=new Map(results.map(r=>[r.testId,r]));
 const linked=new Map(canonical.requirements.map(r=>[r.id,[]]));
 for(const t of canonical.tests)for(const requirementId of t.requirementIds)linked.get(requirementId).push(byId.get(t.id));
 const requirements=canonical.requirements.map(r=>{
  const checks=linked.get(r.id);
  const status=checks.some(c=>c.status==='FAILED')?'FAILED':!checks.length||checks.every(c=>c.status==='NOT_EXECUTED')?'NOT_TESTED':checks.every(c=>c.status==='PASSED')?'PASSED':checks.some(c=>c.status==='PASSED')?'PARTIALLY_TESTED':'UNVERIFIED';
  return {...r,status,checks};
 });
 const counts={PASSED:0,FAILED:0,PARTIALLY_TESTED:0,NOT_TESTED:0,UNVERIFIED:0};
 for(const r of requirements)counts[r.status]++;
 return {schemaVersion:1,revisionSha256:canonical.revisionSha256,planSha256:canonical.planSha256,requirements,tests:results,counts,productionReady:false,deploymentAuthorized:false};
}
// Mobile adapter: strict pinned worker/reviewer verification; no caller-supplied
// PASS flag can substitute for a verified mobile attestation.
export function createMobileTraceVerifier({bindings,workerPublicKeys,reviewerPublicKey,store}={}){
 if(!Array.isArray(bindings)||bindings.length>500)throw Error('Invalid mobile bindings');
 const map=new Map();
 for(const b of bindings){
  if(!valid(b?.testId,id)||map.has(b.testId)||!valid(b.revisionSha256,sha)||!valid(b.definitionSha256,sha)||!valid(b.environmentId,id)||!b.requirement||b.requirement.flowSha256!==b.definitionSha256)throw Error('Invalid mobile binding');
  map.set(b.testId,structuredClone(b));
 }
 return async(o,t,revision)=>{
  const b=map.get(t.id);
  if(!b||o.status!=='PASSED'||b.revisionSha256!==revision||b.definitionSha256!==t.definitionSha256||b.environmentId!==t.environmentId||o.evidence?.manifest?.runId!==o.evidenceId)return false;
  const result=await evaluateIndependentEvidence({requirements:[b.requirement],evidence:[o.evidence],workerPublicKeys,reviewerPublicKey,store});
  return result.status==='REQUIRED_EVIDENCE_VERIFIED';
 };
}
