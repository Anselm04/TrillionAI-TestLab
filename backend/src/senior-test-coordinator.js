import {createTraceabilityPlan,evaluateTraceability} from './requirement-traceability.js';
const identifier=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
// Model suggestions are optional and untrusted. Only operator-registered test
// definitions and execution callbacks may run; no arbitrary commands or edits.
export async function coordinateSeniorTests({plan,adapters,proposeOrder,verifyObservation,checkCapacity=async()=>true,maxTests=30}={}){
 const canonical=createTraceabilityPlan(plan);
 if(plan.planSha256!==canonical.planSha256||!Array.isArray(adapters)||adapters.length>500||typeof verifyObservation!=='function'||typeof checkCapacity!=='function'||!Number.isInteger(maxTests)||maxTests<1||maxTests>100)throw Error('Invalid coordinator configuration');
 const available=new Map();
 for(const a of adapters){
  if(typeof a?.testId!=='string'||!identifier.test(a.testId)||available.has(a.testId)||typeof a.execute!=='function'||!canonical.tests.some(t=>t.id===a.testId&&t.definitionSha256===a.definitionSha256&&t.environmentId===a.environmentId))throw Error('Untrusted adapter mapping');
  available.set(a.testId,a.execute);
 }
 const ordered=canonical.tests.map(t=>t.id);
 let planningMode='DETERMINISTIC';
 if(typeof proposeOrder==='function'){
  try{
   const proposed=await proposeOrder(structuredClone(canonical));
   if(Array.isArray(proposed)&&proposed.length===ordered.length&&new Set(proposed).size===ordered.length&&proposed.every(x=>ordered.includes(x))){
    ordered.splice(0,ordered.length,...proposed);planningMode='VALIDATED_PROPOSAL';
   }
  }catch{/* Preserve deterministic fallback. */}
 }
 const cases=new Map(canonical.tests.map(t=>[t.id,t])),observations=[],events=[],evidenceIds=new Set();
 let attempts=0,halted=false;
 for(const testId of ordered){
  const t=cases.get(testId),execute=available.get(testId);
  if(!execute){events.push({testId,status:'NOT_EXECUTED',reason:'NO_REGISTERED_ADAPTER'});continue;}
  if(halted||attempts>=maxTests){events.push({testId,status:'NOT_EXECUTED',reason:halted?'RESOURCE_OR_INFRASTRUCTURE_STOP':'TEST_BUDGET'});continue;}
  try{if(await checkCapacity()!==true){halted=true;events.push({testId,status:'NOT_EXECUTED',reason:'RESOURCE_LIMIT'});continue;}}
  catch{halted=true;events.push({testId,status:'NOT_EXECUTED',reason:'CAPACITY_CHECK_FAILED'});continue;}
  attempts++;
  try{
   const o=await execute({test:structuredClone(t),revisionSha256:canonical.revisionSha256});
   if(o?.testId!==testId||o.revisionSha256!==canonical.revisionSha256||o.definitionSha256!==t.definitionSha256||o.environmentId!==t.environmentId||typeof o.evidenceId!=='string'||!identifier.test(o.evidenceId)||evidenceIds.has(o.evidenceId)||!['PASSED','FAILED','TIMEOUT','INFRASTRUCTURE_ERROR'].includes(o.status))throw Error('Invalid execution observation');
   evidenceIds.add(o.evidenceId);observations.push(structuredClone(o));
   events.push({testId,status:'OBSERVATION_COLLECTED'});
   if(['TIMEOUT','INFRASTRUCTURE_ERROR'].includes(o.status))halted=true;
  }catch{halted=true;events.push({testId,status:'INFRASTRUCTURE_ERROR',reason:'EXECUTION_OR_CONTEXT_FAILED'});}
 }
 const coverage=await evaluateTraceability({plan:canonical,observations,verifyObservation});
 const gaps=coverage.requirements.filter(r=>r.status!=='PASSED').map(r=>({requirementId:r.id,status:r.status,testIds:r.checks.filter(c=>c.status!=='PASSED').map(c=>c.testId)}));
 return {schemaVersion:1,planningMode,attempts,events,coverage,gaps,status:gaps.length||halted?'INCOMPLETE':'DECLARED_REQUIREMENTS_VERIFIED',productionReady:false,deploymentAuthorized:false};
}
