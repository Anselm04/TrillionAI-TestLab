import {createHash} from 'node:crypto';
import {runAdversarialTests} from './adversarial-agent.js';
import {createTraceabilityPlan} from './requirement-traceability.js';
import {evaluateCompatibility} from './compatibility-matrix.js';
import {runEndurance} from './endurance-testing.js';
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const sha=/^[a-f0-9]{64}$/;
const valid=(v,r)=>typeof v==='string'&&r.test(v);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const kinds={
 adversarial:['DECLARED_CASES_PASSED','VERIFIED_FAILURES'],
 compatibility:['DECLARED_MATRIX_PASSED','VERIFIED_FAILURE'],
 endurance:['DECLARED_ENDURANCE_CHECKS_PASSED','VERIFIED_FAILURE']
};
// Registry configuration and callbacks are trusted host inputs, never a
// customer request. Hard callback deadlines require a separate host adapter.
export function createAgentEngineProfile({kind,profileId,testId,environmentId,revisionSha256,fixtureSha256,config,verifyReport,checkCapacity}={}){
 if(!Object.hasOwn(kinds,kind)||![profileId,testId,environmentId].every(v=>valid(v,id))||![revisionSha256,fixtureSha256].every(v=>valid(v,sha))||typeof verifyReport!=='function'||typeof checkCapacity!=='function'||!config)throw Error('Invalid agent engine profile');
 let definition,run;
 if(kind==='adversarial'){
  const plan=createTraceabilityPlan(config.plan);
  if(plan.planSha256!==config.plan.planSha256||plan.revisionSha256!==revisionSha256||plan.tests.some(t=>t.environmentId!==environmentId)||!Array.isArray(config.adapters)||typeof config.verifyObservation!=='function')throw Error('Invalid adversarial registration');
  const adapters=config.adapters.map(a=>({...a})),verify=config.verifyObservation,maxTests=config.maxTests??30;
  definition={planSha256:plan.planSha256,maxTests,categories:adapters.map(a=>({testId:a.testId,category:a.category}))};
  run=signal=>runAdversarialTests({plan,scope:{mode:'isolated-test',revisionSha256,environmentIds:[environmentId]},adapters:adapters.map(a=>({...a,execute:async c=>{if(signal?.aborted)throw Error('Cancelled');return a.execute(c,signal);}})),verifyObservation:verify,checkCapacity:async()=>!signal?.aborted&&await checkCapacity()===true,maxTests});
 }else if(kind==='compatibility'){
  const targets=structuredClone(config.targets),inventory=structuredClone(config.inventory),collect=config.collect,verifyObservation=config.verifyObservation,mobileTrust=config.mobileTrust;
  if(!Array.isArray(targets)||!targets.length||!Array.isArray(inventory)||typeof collect!=='function'||typeof verifyObservation!=='function')throw Error('Invalid compatibility registration');
  definition={targets,inventory};
  run=async(signal,context)=>{
   const collected=await collect(structuredClone(context),signal);
   if(collected?.runId!==context.runId||collected.revisionSha256!==revisionSha256||collected.definitionSha256!==context.definitionSha256||!Array.isArray(collected.observations))throw Error('Collection binding failed');
   return evaluateCompatibility({revisionSha256,targets,inventory,observations:collected.observations,verifyObservation,mobileTrust});
  };
 }else{
  const policy=structuredClone(config.policy),sample=config.sample,verifySample=config.verifySample;
  if(typeof sample!=='function'||typeof verifySample!=='function'||!policy)throw Error('Invalid endurance registration');
  // Full samples must fit the durable journal's bounded report budget.
  if(!Number.isInteger(policy.maxSamples)||policy.maxSamples>500)throw Error('Journal sample budget exceeded');
  definition={policy};
  const scope={mode:'isolated-test',revisionSha256,environmentId,journeyId:testId};
  run=signal=>runEndurance({scope,policy,adapter:{...scope,sample},verifySample,checkCapacity,signal});
 }
 const definitionSha256=hash({kind,version:1,testId,environmentId,fixtureSha256,definition});
 const bound=c=>c?.profileId===profileId&&c.revisionSha256===revisionSha256&&c.definitionSha256===definitionSha256&&valid(c.runId,id);
 const status=r=>r?.status===kinds[kind][0]?'PASSED':r?.status===kinds[kind][1]?'FAILED':null;
 return Object.freeze({id:profileId,definitionSha256,async execute(c,signal){
  if(!bound(c)||signal?.aborted||await checkCapacity()!==true||signal?.aborted)throw Error('Execution refused');
  const report=await run(signal,c);
  const observed=status(report);
  if(!observed||signal?.aborted)throw Error('Incomplete engine result');
  return {...c,testId,environmentId,status:observed,report,evidenceId:hash({runId:c.runId,report})};
 },async verify(o,c){
  if(!bound(c)||!bound(o)||o.runId!==c.runId||o.testId!==testId||o.environmentId!==environmentId||!status(o.report)||status(o.report)!==o.status||o.evidenceId!==hash({runId:c.runId,report:o.report}))return false;
  return await verifyReport(structuredClone(o.report),{...c,testId,environmentId})===true;
 }});
}
