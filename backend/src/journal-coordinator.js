import {createTraceabilityPlan} from './requirement-traceability.js';
import {coordinateSeniorTests} from './senior-test-coordinator.js';

// The journal and registry are trusted local supervisor dependencies.
// Each registered profile must independently verify its execution evidence.
// This bridge does not accept executable commands from submitted plans.
export async function coordinateJournalTests({plan,journal,bindings,verifyObservation,checkCapacity,signal,maxTests=30}={}){
 const canonical=createTraceabilityPlan(plan);
 if(canonical.planSha256!==plan.planSha256||!Array.isArray(bindings)||bindings.length>500||
 typeof verifyObservation!=='function'||typeof checkCapacity!=='function'||
 !['submit','get','runNext'].every(k=>typeof journal?.[k]==='function'))throw Error('Invalid journal coordinator configuration');
 const seen=new Set(),adapters=[];
 for(const b of bindings){
  const t=canonical.tests.find(x=>x.id===b?.testId);
  if(!t||seen.has(t.id)||typeof b.profileId!=='string'||b.definitionSha256!==t.definitionSha256||b.environmentId!==t.environmentId)throw Error('Invalid profile binding');
  seen.add(t.id);
  const profileId=b.profileId;
  adapters.push({testId:t.id,definitionSha256:t.definitionSha256,environmentId:t.environmentId,execute:async()=>{
   if(signal?.aborted)throw Error('Cancelled');
   const queued=journal.submit({profileId,revisionSha256:canonical.revisionSha256,expectedDefinitionSha256:t.definitionSha256});
   if(queued.definitionSha256!==t.definitionSha256)throw Error('Profile definition mismatch');
   const completed=await journal.runNext({checkCapacity,signal,expectedRunId:queued.runId});
   if(completed?.runId!==queued.runId||completed.state!=='VERIFIED'||completed.integrity!==true)throw Error('Execution not independently verified');
   const stored=journal.get(queued.runId);
   const o=stored?.result?.observation;
   if(stored?.state!=='VERIFIED'||stored.integrity!==true||o?.runId!==queued.runId||o.testId!==t.id||o.environmentId!==t.environmentId)throw Error('Journal evidence mismatch');
   return o;
  }});
 }
 return coordinateSeniorTests({plan:canonical,adapters,verifyObservation,checkCapacity:async()=>!signal?.aborted&&await checkCapacity()===true,maxTests});
}
