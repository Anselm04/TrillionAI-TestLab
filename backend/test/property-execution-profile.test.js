import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableExecution} from '../src/durable-execution.js';
import {createPropertyExecutionProfile} from '../src/property-execution-profile.js';
import {generateBoundaryInteger} from '../src/property-testing.js';
const revisionSha256='a'.repeat(64);
const config={profileId:'property',testId:'integer',environmentId:'local',revisionSha256,fixtureSha256:'b'.repeat(64),seed:42,cases:20,generate:generateBoundaryInteger,property:async x=>Number.isSafeInteger(x),checkCapacity:async()=>true,verifyFailure:async x=>!Number.isSafeInteger(x),verifyReport:async r=>r.executed===20};
async function run(t,extra={},revision=revisionSha256){
 const dir=mkdtempSync(join(tmpdir(),'testlab-property-'));
 const profile=createPropertyExecutionProfile({...config,...extra});
 const journal=new DurableExecution(join(dir,'runs.sqlite'),{profiles:[profile]});
 try{const queued=journal.submit({profileId:'property',revisionSha256:revision});await journal.runNext({checkCapacity:async()=>true});return journal.get(queued.runId);}
 finally{journal.close();rmSync(dir,{recursive:true,force:true});}
}
test('actual generated boundary cases execute and persist',async t=>{
 const r=await run(t);assert.equal(r.state,'VERIFIED');assert.equal(r.result.observation.status,'PASSED');assert.equal(r.result.observation.report.executed,20);
});
test('verified counterexample becomes a failed observation, not a pass',async t=>{
 const r=await run(t,{property:async x=>x!==0,verifyFailure:async x=>x===0,verifyReport:async r=>r.status==='VERIFIED_COUNTEREXAMPLE'});
 assert.equal(r.state,'VERIFIED');assert.equal(r.result.observation.status,'FAILED');
});
test('unverified, incomplete, or wrong revision execution is blocked',async t=>{
 for(const extra of [{verifyReport:async()=>false},{checkCapacity:async()=>false},{property:async()=>false,verifyFailure:async()=>false}]){
 assert.equal((await run(t,extra)).state,'BLOCKED');
 }
 assert.equal((await run(t,{},'c'.repeat(64))).state,'BLOCKED');
});
test('definition changes with seed, fixture digest and case budget',()=>{
 const p=createPropertyExecutionProfile(config);
 for(const extra of [{seed:43},{cases:21},{fixtureSha256:'c'.repeat(64)}])assert.notEqual(createPropertyExecutionProfile({...config,...extra}).definitionSha256,p.definitionSha256);
});
