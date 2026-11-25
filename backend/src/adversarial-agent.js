import {coordinateSeniorTests} from './senior-test-coordinator.js';
import {createTraceabilityPlan} from './requirement-traceability.js';

const categories = new Set(['authorization','input-validation','state-transition','resource-boundary','session-isolation','error-handling']);
const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

// Only trusted, registered test callbacks are accepted. Scope must be
// established by the host from its sandbox registry, not customer input.
export async function runAdversarialTests({plan,scope,adapters,verifyObservation,checkCapacity,maxTests=30}={}) {
 const canonical=createTraceabilityPlan(plan);
 if (canonical.planSha256!==plan.planSha256 || scope?.mode!=='isolated-test' ||
     scope.revisionSha256!==canonical.revisionSha256 ||
     !Array.isArray(scope.environmentIds) || !scope.environmentIds.length ||
     scope.environmentIds.length>500 || scope.environmentIds.some(x=>typeof x!=='string'||!id.test(x)) ||
     !Array.isArray(adapters) || adapters.length>500 || typeof verifyObservation!=='function')
   throw Error('Invalid adversarial scope');
 const environments=new Set(scope.environmentIds);
 if(canonical.tests.some(t=>!environments.has(t.environmentId))) throw Error('Environment outside scope');
 const registry=new Map();
 for(const a of adapters){
   if(!categories.has(a?.category)||registry.has(a.testId)||typeof a.execute!=='function' ||
      !canonical.tests.some(t=>t.id===a.testId&&t.definitionSha256===a.definitionSha256&&t.environmentId===a.environmentId))
     throw Error('Invalid adversarial adapter');
   registry.set(a.testId,{...a});
 }
 const result=await coordinateSeniorTests({plan:canonical,adapters:[...registry.values()],verifyObservation,checkCapacity,maxTests});
 const findings=result.coverage.tests.filter(t=>t.status==='FAILED').map(t=>({
   testId:t.testId,category:registry.get(t.testId).category,evidenceId:t.evidenceId,
   status:'VERIFIED_TEST_FAILURE'
 }));
 const unverified=result.coverage.tests.filter(t=>!['PASSED','FAILED'].includes(t.status));
 return {schemaVersion:1,findings,unverified,execution:result,
   status:findings.length?'VERIFIED_FAILURES':unverified.length||result.status==='INCOMPLETE'?'INCOMPLETE':'DECLARED_CASES_PASSED',
   productionReady:false,deploymentAuthorized:false,customerRepairAuthorized:false};
}
