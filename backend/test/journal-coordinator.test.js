import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableExecution} from '../src/durable-execution.js';
import {createTraceabilityPlan} from '../src/requirement-traceability.js';
import {coordinateJournalTests} from '../src/journal-coordinator.js';
const revisionSha256='a'.repeat(64),definitionSha256='b'.repeat(64),environmentId='ubuntu';
const plan=createTraceabilityPlan({revisionSha256,requirements:[{id:'r1',title:'Fixture'}],tests:[{id:'t1',definitionSha256,environmentId,requirementIds:['r1']}]});
const binding={testId:'t1',profileId:'fixture',definitionSha256,environmentId};
function setup(t,override={}){
 const dir=mkdtempSync(join(tmpdir(),'testlab-coordinator-'));
 const journal=new DurableExecution(join(dir,'runs.sqlite'),{profiles:[{id:'fixture',definitionSha256,execute:async c=>({...c,testId:'t1',environmentId,status:'PASSED',evidenceId:c.runId}),verify:async()=>true,...override}]});
 t.after(()=>{journal.close();rmSync(dir,{recursive:true,force:true});});
 return journal;
}
const args=journal=>({plan,journal,bindings:[binding],checkCapacity:async()=>true,verifyObservation:async()=>true});
test('registered execution is persisted and unrelated queued work is not dispatched',async t=>{
 const journal=setup(t);const earlier=journal.submit({profileId:'fixture',revisionSha256});
 const r=await coordinateJournalTests(args(journal));
 assert.equal(r.status,'DECLARED_REQUIREMENTS_VERIFIED');
 assert.equal(journal.get(earlier.runId).state,'QUEUED');assert.equal(r.deploymentAuthorized,false);
 const stored=journal.get(r.coverage.tests[0].evidenceId);assert.equal(stored.state,'VERIFIED');
});
test('unverified journal evidence cannot satisfy coverage',async t=>{
 const journal=setup(t,{verify:async()=>false});
 const r=await coordinateJournalTests(args(journal));assert.equal(r.status,'INCOMPLETE');assert.equal(r.coverage.counts.PASSED,0);
});
test('mismatched definitions and resource refusal do not execute',async t=>{
 let calls=0;const journal=setup(t,{definitionSha256:'c'.repeat(64),execute:async()=>{calls++;}});
 const r=await coordinateJournalTests(args(journal));assert.equal(r.status,'INCOMPLETE');
 assert.equal((await journal.runNext({checkCapacity:async()=>true})).status,'IDLE_OR_BUSY');
 const paused=await coordinateJournalTests({...args(journal),checkCapacity:async()=>false});assert.equal(paused.attempts,0);assert.equal(calls,0);
});
test('independent coverage verifier can reject a journal verified result',async t=>{
 const journal=setup(t);const r=await coordinateJournalTests({...args(journal),verifyObservation:async()=>false});assert.equal(r.status,'INCOMPLETE');assert.equal(r.coverage.counts.UNVERIFIED,1);
});
