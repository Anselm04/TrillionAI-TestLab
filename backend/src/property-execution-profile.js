import {checkProperty} from './property-testing.js';
import {createHash} from 'node:crypto';
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const sha=/^[a-f0-9]{64}$/;
const valid=(v,r)=>typeof v==='string'&&r.test(v);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
// Only trusted local bounded fixtures. The operator pins fixture source and
// independently verifies evidence; arbitrary submitted code is not accepted.
export function createPropertyExecutionProfile({profileId,testId,environmentId,revisionSha256,fixtureSha256,seed=1,cases=100,generate,property,checkCapacity,verifyFailure,verifyReport}={}){
 if(![profileId,testId,environmentId].every(v=>valid(v,id))||![revisionSha256,fixtureSha256].every(v=>valid(v,sha))||!Number.isInteger(seed)||seed<0||seed>0xffffffff||!Number.isInteger(cases)||cases<1||cases>10000||[generate,property,checkCapacity,verifyFailure,verifyReport].some(v=>typeof v!=='function'))throw Error('Invalid registered property profile');
 const definitionSha256=hash({engine:'property-v1',testId,environmentId,fixtureSha256,seed,cases});
 function bound(c){return c?.profileId===profileId&&c.revisionSha256===revisionSha256&&c.definitionSha256===definitionSha256&&valid(c.runId,id);}
 return Object.freeze({id:profileId,definitionSha256,async execute(context,signal){
  if(!bound(context)||signal?.aborted)throw Error('Property context rejected');
  const report=await checkProperty({seed,cases,generate,property,checkCapacity,verifyFailure,signal});
  const status=report.status==='GENERATED_CASES_PASSED'?'PASSED':report.status==='VERIFIED_COUNTEREXAMPLE'?'FAILED':null;
  if(!status||signal?.aborted)throw Error('Property evidence incomplete');
  const evidenceId=hash({runId:context.runId,report});
  return {...context,testId,environmentId,evidenceId,status,report};
 },async verify(observation,context){
  if(!bound(context)||!bound(observation)||observation.runId!==context.runId||observation.testId!==testId||observation.environmentId!==environmentId)return false;
  const report=observation.report;
  if(!report||report.seed!==seed||report.cases!==cases||observation.evidenceId!==hash({runId:context.runId,report}))return false;
  if(observation.status==='PASSED'?(report.status!=='GENERATED_CASES_PASSED'||report.executed!==cases):(observation.status!=='FAILED'||report.status!=='VERIFIED_COUNTEREXAMPLE'||!Number.isInteger(report.executed)||report.executed<1||report.executed>cases))return false;
  return await verifyReport(structuredClone(report),structuredClone(context))===true;
 }});
}
