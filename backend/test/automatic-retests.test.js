import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableExecution} from '../src/durable-execution.js';
const revisionSha256='a'.repeat(64),definitionSha256='b'.repeat(64);
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'testlab-retests-'));
 const path=join(dir,'runs.sqlite');
 let status='FAILED';
 const profile={id:'fixture',definitionSha256,execute:async c=>({...c,testId:'login',environmentId:'local',evidenceId:c.runId,status}),verify:async()=>true};
 let journal=new DurableExecution(path,{profiles:[profile]});
 t.after(()=>{journal.close();rmSync(dir,{recursive:true,force:true});});
 return {get journal(){return journal;},setStatus(s){status=s;},reopen(){journal.close();journal=new DurableExecution(path,{profiles:[profile]});}};
}
const capacity=async()=>true,verifyStoredObservation=async()=>true;
async function initial(j){const q=j.submit({profileId:'fixture',revisionSha256});await j.runNext({checkCapacity:capacity,expectedRunId:q.runId});return q.runId;}
const schedule=(j,parentRunId,extra={})=>j.scheduleRetest({parentRunId,verifyStoredObservation,...extra});
test('concurrent scheduling creates one child and survives restart',async t=>{
 const f=fixture(t),parent=await initial(f.journal);
 const results=await Promise.all([schedule(f.journal,parent),schedule(f.journal,parent)]);
 assert.deepEqual(results.map(x=>x.status).sort(),['ALREADY_SCHEDULED','SCHEDULED']);
 assert.equal(results[0].runId,results[1].runId);
 f.reopen();assert.equal((await schedule(f.journal,parent)).runId,results[0].runId);
 const child=f.journal.get(results[0].runId);assert.equal(child.state,'QUEUED');assert.equal(child.revisionSha256,revisionSha256);
});
test('retry lineage is bounded and actual retests preserve evidence',async t=>{
 const f=fixture(t),j=f.journal,parent=await initial(j);
 const first=await schedule(j,parent);await j.runNext({checkCapacity:capacity,expectedRunId:first.runId});
 const second=await schedule(j,first.runId);assert.equal(second.rootId,parent);assert.equal(second.attempt,2);
 await j.runNext({checkCapacity:capacity,expectedRunId:second.runId});
 assert.equal((await schedule(j,second.runId)).status,'RETRY_BUDGET_EXHAUSTED');
});
test('passing, queued, cancelled and independently rejected runs cannot trigger retests',async t=>{
 const f=fixture(t),j=f.journal;f.setStatus('PASSED');const passed=await initial(j);
 assert.equal((await schedule(j,passed)).status,'NOT_ELIGIBLE');
 const queued=j.submit({profileId:'fixture',revisionSha256});
 assert.equal((await schedule(j,queued.runId)).status,'NOT_ELIGIBLE');
 f.setStatus('FAILED');const failed=await initial(j);
 assert.equal((await schedule(j,failed,{verifyStoredObservation:async()=>false})).status,'NOT_ELIGIBLE');
 const controller=new AbortController();controller.abort();
 assert.equal((await schedule(j,failed,{signal:controller.signal})).status,'NOT_ELIGIBLE');
});
