import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableExecution} from '../src/durable-execution.js';
import {dispatchRetestCycle} from '../src/retest-dispatcher.js';
const revisionSha256='a'.repeat(64),definitionSha256='b'.repeat(64);
async function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'testlab-dispatch-'));
 let count=0;
 const journal=new DurableExecution(join(dir,'runs.sqlite'),{profiles:[{id:'fixture',definitionSha256,execute:async c=>({...c,testId:'login',environmentId:'local',evidenceId:c.runId,status:++count===1?'FAILED':'PASSED'}),verify:async()=>true}]});
 t.after(()=>{journal.close();rmSync(dir,{recursive:true,force:true});});
 const q=journal.submit({profileId:'fixture',revisionSha256});await journal.runNext({checkCapacity:async()=>true,expectedRunId:q.runId});
 return {journal,parent:q.runId,count:()=>count};
}
const options=journal=>({projectId:'project',journal,verifyStoredObservation:async()=>true,checkCapacity:async()=>true});
test('verified failure dispatches exactly its retest, not unrelated queued work',async t=>{
 const f=await fixture(t),unrelated=f.journal.submit({profileId:'fixture',revisionSha256});
 const result=await dispatchRetestCycle(options(f.journal));
 assert.equal(result.events[0].parentRunId,f.parent);assert.equal(result.events[0].outcome,'PASSED');assert.equal(f.journal.get(unrelated.runId).state,'QUEUED');
 const repeat=await dispatchRetestCycle(options(f.journal));assert.equal(repeat.events[0].status,'ALREADY_PROCESSED');assert.equal(f.count(),2);
});
test('unverified history cannot trigger retests',async t=>{
 const f=await fixture(t);const r=await dispatchRetestCycle({...options(f.journal),verifyStoredObservation:async()=>false});
 assert.equal(r.events.length,0);assert.equal(f.count(),1);
});
test('resource and cancellation gates prevent dispatch',async t=>{
 const f=await fixture(t);assert.equal((await dispatchRetestCycle({...options(f.journal),checkCapacity:async()=>false})).status,'PAUSED');
 const c=new AbortController();c.abort();assert.equal((await dispatchRetestCycle({...options(f.journal),signal:c.signal})).status,'PAUSED');assert.equal(f.count(),1);
});

test('interrupted retest dispatch retains the input cursor for safe resumption',async t=>{
 const f=await fixture(t);let checks=0;
 const paused=await dispatchRetestCycle({...options(f.journal),checkCapacity:async()=>++checks===1});
 assert.equal(paused.status,'CYCLE_INCOMPLETE');
 assert.equal(paused.nextCursor,0);
 assert.equal(paused.hasMore,true);
 assert.equal(f.count(),1);
 const resumed=await dispatchRetestCycle({...options(f.journal),after:paused.nextCursor});
 assert.equal(resumed.events[0].outcome,'PASSED');
 assert.equal(f.count(),2);
});
