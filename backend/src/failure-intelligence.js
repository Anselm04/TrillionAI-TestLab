import {createHash} from 'node:crypto';
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const sha=/^[a-f0-9]{64}$/;
const valid=(v,r)=>typeof v==='string'&&r.test(v);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const outcomes=new Set(['PASSED','FAILED','TIMEOUT','INFRASTRUCTURE_ERROR']);
// Process one trusted project and bounded observation batch at a time.
// A fingerprint is a grouping key, not a root-cause diagnosis.
export async function analyzeFailureHistory({projectId,observations,verifyObservation,maxRecommendations=50}={}){
 if(!valid(projectId,id)||!Array.isArray(observations)||observations.length>10000||typeof verifyObservation!=='function'||!Number.isInteger(maxRecommendations)||maxRecommendations<1||maxRecommendations>500)throw Error('Invalid history configuration');
 const evidenceIds=new Set(),records=[];
 for(const o of observations){
  if(o?.projectId!==projectId||!valid(o.evidenceId,id)||evidenceIds.has(o.evidenceId)||!valid(o.testId,id)||!valid(o.environmentId,id)||!valid(o.definitionSha256,sha)||!valid(o.revisionSha256,sha)||!outcomes.has(o.status)||!Number.isSafeInteger(o.sequence)||o.sequence<0||(o.status!=='PASSED'&&!valid(o.failureCode,id)))throw Error('Invalid observation');
  evidenceIds.add(o.evidenceId);
  records.push({projectId,evidenceId:o.evidenceId,testId:o.testId,environmentId:o.environmentId,definitionSha256:o.definitionSha256,revisionSha256:o.revisionSha256,status:o.status,sequence:o.sequence,failureCode:o.status==='PASSED'?null:o.failureCode});
 }
 records.sort((a,b)=>a.sequence-b.sequence||(a.evidenceId<b.evidenceId?-1:1));
 const series=new Map(),rejected=[];
 for(const o of records){
  let verified=false;
  try{verified=await verifyObservation(structuredClone(o))===true;}catch{}
  if(!verified){rejected.push(o.evidenceId);continue;}
  const key=hash([o.projectId,o.testId,o.environmentId,o.definitionSha256,o.revisionSha256]);
  if(!series.has(key))series.set(key,{identity:{projectId,testId:o.testId,environmentId:o.environmentId,definitionSha256:o.definitionSha256,revisionSha256:o.revisionSha256},passes:0,failures:0,infrastructure:0,groups:new Map()});
  const s=series.get(key);
  if(o.status==='PASSED'){s.passes++;continue;}
  if(o.status==='FAILED')s.failures++;else s.infrastructure++;
  const fingerprint=hash([key,o.status,o.failureCode]);
  if(!s.groups.has(fingerprint))s.groups.set(fingerprint,{fingerprint,...s.identity,status:o.status,failureCode:o.failureCode,count:0,evidenceIds:[]});
  const g=s.groups.get(fingerprint);g.count++;g.evidenceIds.push(o.evidenceId);
 }
 const groups=[],recommendations=[];
 for(const s of series.values()){
  for(const g of s.groups.values())groups.push(g);
  if(s.failures||s.infrastructure)recommendations.push({...s.identity,reason:s.failures&&s.passes?'MIXED_VERIFIED_OUTCOMES':s.failures?'VERIFIED_TEST_FAILURE':'INFRASTRUCTURE_REVIEW_REQUIRED',priority:s.failures?2:1,failedRuns:s.failures,passedRuns:s.passes,infrastructureRuns:s.infrastructure,action:s.failures?'RETEST_REGISTERED_CASE':'REVIEW_TEST_ENVIRONMENT'});
 }
 groups.sort((a,b)=>b.count-a.count||a.fingerprint.localeCompare(b.fingerprint));
 recommendations.sort((a,b)=>b.priority-a.priority||b.failedRuns-a.failedRuns||b.infrastructureRuns-a.infrastructureRuns||hash(a).localeCompare(hash(b)));
 return {schemaVersion:1,projectId,observations:records.length,verifiedCount:records.length-rejected.length,rejected,groups,recommendations:recommendations.slice(0,maxRecommendations),omittedRecommendations:Math.max(0,recommendations.length-maxRecommendations),status:rejected.length||!records.length?'INCOMPLETE':'VERIFIED_HISTORY_ANALYZED',rootCauseEstablished:false,customerRepairAuthorized:false,productionReady:false,deploymentAuthorized:false};
}
