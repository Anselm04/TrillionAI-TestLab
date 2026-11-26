import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableExecution} from '../src/durable-execution.js';
import {createTestkubeExecutionProfile} from '../src/testkube-execution-profile.js';
const revisionSha256='a'.repeat(64),fixtureSha256='b'.repeat(64);
const executionName='testlab-12345678-1234-1234-1234-123456789abc';
const initial={engine:'testkube-v1.16.0',testName:'fixture',executionId:'engine-1',executionName,executionNumber:1,engineExecutionName:executionName+'-1',status:'RUNNING'};
function config(status='ENGINE_REPORTED_PASS',extra={}){
 return {profileId:'engine',testId:'check',environmentId:'isolated',revisionSha256,fixtureSha256,testName:'fixture',pollMs:1,maxPolls:2,deadlineMs:10000,
 client:{submit:async()=>({...initial}),inspect:async()=>({...initial,status})},verifyFixture:async()=>true,checkCapacity:async()=>true,
 collectEvidence:async(o,c)=>({runId:c.runId,revisionSha256:c.revisionSha256,definitionSha256:c.definitionSha256,fixtureSha256,environmentId:c.environmentId,executionId:o.executionId,engineExecutionName:o.engineExecutionName,artifactSha256:'c'.repeat(64),exitCode:status==='ENGINE_REPORTED_PASS'?0:7}),verifyEvidence:async()=>true,...extra};
}
async function run(options,signal){
 const dir=mkdtempSync(join(tmpdir(),'testlab-engine-'));
 const profile=createTestkubeExecutionProfile(options);
 const journal=new DurableExecution(join(dir,'runs.sqlite'),{profiles:[profile]});
 try{const q=journal.submit({profileId:profile.id,revisionSha256});await journal.runNext({checkCapacity:async()=>true,signal});return journal.get(q.runId);}
 finally{journal.close();rmSync(dir,{recursive:true,force:true});}
}
test('durably records verified pass and fail separately',async()=>{
 for(const [engine,status] of [['ENGINE_REPORTED_PASS','PASSED'],['ENGINE_REPORTED_FAIL','FAILED']]){
  const r=await run(config(engine));assert.equal(r.state,'VERIFIED');assert.equal(r.result.observation.status,status);assert.equal(r.integrity,true);
 }
});
test('engine claim without independent approval remains blocked',async()=>{
 assert.equal((await run(config(undefined,{verifyEvidence:async()=>false}))).state,'BLOCKED');
});
test('changed execution identity is rejected',async()=>{
 const c=config();c.client.inspect=async()=>({...initial,executionId:'different',status:'ENGINE_REPORTED_PASS'});
 assert.equal((await run(c)).state,'BLOCKED');
});
test('nonterminal or aborted execution does not become a verdict',async()=>{
 for(const status of ['RUNNING','ABORTED','TIMEOUT','NOT_EXECUTED'])assert.equal((await run(config(status))).state,'BLOCKED');
});
test('fixture and capacity refusal prevent submission',async()=>{
 for(const key of ['verifyFixture','checkCapacity']){
  const c=config();let calls=0;c.client.submit=async()=>{calls++;return initial;};c[key]=async()=>false;
  assert.equal((await run(c)).state,'BLOCKED');assert.equal(calls,0);
 }
});
test('wrong revision or exit code cannot be accepted',async()=>{
 for(const change of [{revisionSha256:'d'.repeat(64)},{exitCode:7}]){
  const c=config();const original=c.collectEvidence;c.collectEvidence=async(...args)=>({...await original(...args),...change});
  assert.equal((await run(c)).state,'BLOCKED');
 }
});
test('pre-cancelled execution stays queued',async()=>{
 const c=config();const ctrl=new AbortController();ctrl.abort();
 assert.equal((await run(c,ctrl.signal)).state,'QUEUED');
});
