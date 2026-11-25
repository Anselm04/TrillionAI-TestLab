import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableExecution} from '../src/durable-execution.js';
const definitionSha256='a'.repeat(64),revisionSha256='b'.repeat(64);
const profile={id:'fixture',definitionSha256,execute:async c=>({...c,status:'FAILED',evidenceId:'e1'}),verify:async()=>true};
const submit=d=>d.submit({profileId:'fixture',revisionSha256});
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'testlab-execution-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return join(dir,'runs.sqlite');}
test('persists verified failure across reopen without treating it as pass',async t=>{
 const path=fixture(t);let d=new DurableExecution(path,{profiles:[profile]});
 const run=submit(d);assert.equal(run.state,'QUEUED');
 assert.equal((await d.runNext({checkCapacity:async()=>true})).state,'VERIFIED');
 d.close();d=new DurableExecution(path,{profiles:[profile]});
 assert.equal(d.get(run.runId).result.observation.status,'FAILED');assert.equal(d.get(run.runId).deploymentAuthorized,false);d.close();
});
test('capacity refusal and unverified observations fail closed',async t=>{
 const d=new DurableExecution(fixture(t),{profiles:[{...profile,verify:async()=>false}]});
 try{const r=submit(d);assert.equal((await d.runNext({checkCapacity:async()=>false})).status,'PAUSED');assert.equal(d.get(r.runId).state,'QUEUED');
 assert.equal((await d.runNext({checkCapacity:async()=>true})).state,'BLOCKED');}finally{d.close();}
});
test('single execution and explicit interrupted-run fencing',async t=>{
 let release,started;const ready=new Promise(r=>{started=r;});
 const d=new DurableExecution(fixture(t),{profiles:[{...profile,execute:async c=>{started();await new Promise(r=>{release=r;});return {...c,status:'PASSED',evidenceId:'e1'};}}]});
 try{const r=submit(d);submit(d);const pending=d.runNext({checkCapacity:async()=>true});await ready;
 assert.equal((await d.runNext({checkCapacity:async()=>true})).status,'IDLE_OR_BUSY');
 assert.equal(d.recoverInterrupted(),1);release();assert.equal((await pending).status,'STALE_EXECUTION');
 assert.equal(d.get(r.runId).state,'BLOCKED');}finally{d.close();}
});
test('changed profile definition blocks queued execution after restart',async t=>{
 const path=fixture(t);let d=new DurableExecution(path,{profiles:[profile]});submit(d);d.close();
 d=new DurableExecution(path,{profiles:[{...profile,definitionSha256:'c'.repeat(64)}]});
 try{assert.equal((await d.runNext({checkCapacity:async()=>true})).state,'BLOCKED');}finally{d.close();}
});
