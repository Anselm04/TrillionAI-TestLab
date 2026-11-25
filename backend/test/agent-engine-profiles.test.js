import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableExecution} from '../src/durable-execution.js';
import {createAgentEngineProfile} from '../src/agent-engine-profiles.js';
import {createTraceabilityPlan} from '../src/requirement-traceability.js';
const revisionSha256='a'.repeat(64),definitionSha256='b'.repeat(64),environmentId='local';
const base={profileId:'fixture',testId:'check',environmentId,revisionSha256,fixtureSha256:'c'.repeat(64),verifyReport:async()=>true,checkCapacity:async()=>true};
async function run(kind,config,extra={}){
 const dir=mkdtempSync(join(tmpdir(),'testlab-agent-'));
 const profile=createAgentEngineProfile({...base,kind,config,...extra});
 const journal=new DurableExecution(join(dir,'runs.sqlite'),{profiles:[profile]});
 try{const q=journal.submit({profileId:'fixture',revisionSha256});await journal.runNext({checkCapacity:async()=>true});return journal.get(q.runId);}
 finally{journal.close();rmSync(dir,{recursive:true,force:true});}
}
const plan=createTraceabilityPlan({revisionSha256,requirements:[{id:'r',title:'Authorization'}],tests:[{id:'t',definitionSha256,environmentId,requirementIds:['r']}]});
function adversarial(status){return {plan,adapters:[{testId:'t',definitionSha256,environmentId,category:'authorization',execute:async()=>({testId:'t',revisionSha256,definitionSha256,environmentId,evidenceId:'e1',status})}],verifyObservation:async()=>true};}
test('adversarial verified findings persist as failed observations',async()=>{
 assert.equal((await run('adversarial',adversarial('PASSED'))).result.observation.status,'PASSED');
 assert.equal((await run('adversarial',adversarial('FAILED'))).result.observation.status,'FAILED');
});
const target={id:'web',platform:'web',mode:'browser',osVersion:'ubuntu24',arch:'x64',buildSha256:'d'.repeat(64),flowSha256:'e'.repeat(64)};
function compatibility(mode='browser'){return {targets:[target],inventory:[{...target,mode,deviceId:'device'}],verifyObservation:async()=>true,collect:async c=>({...c,observations:[{targetId:'web',deviceId:'device',runId:c.runId,revisionSha256,buildSha256:target.buildSha256,flowSha256:target.flowSha256,status:'PASSED'}]})};}
test('compatibility verifies declared software target without physical claims',async()=>{
 const r=await run('compatibility',compatibility());assert.equal(r.state,'VERIFIED');assert.equal(r.result.observation.report.physicalQualification,'NOT_REQUESTED');
 const c=compatibility();c.collect=async()=>({runId:'wrong'});assert.equal((await run('compatibility',c)).state,'BLOCKED');
});
function endurance(healthy=true){let i=0;return {policy:{durationMs:100,intervalMs:10,maxSamples:100,maxLatencyMs:600000,maxMemoryGrowthBytes:100},sample:async c=>({...c,evidenceId:'s'+(++i),memoryBytes:100,healthy}),verifySample:async()=>true};}
test('endurance runs actual elapsed sampling and preserves unhealthy findings',async()=>{
 const r=await run('endurance',endurance());assert.equal(r.state,'VERIFIED');assert.ok(r.result.observation.report.elapsedMs>=100);
 assert.equal((await run('endurance',endurance(false))).result.observation.status,'FAILED');
});
test('resource and independent report refusal block execution qualification',async()=>{
 assert.equal((await run('adversarial',adversarial('PASSED'),{verifyReport:async()=>false})).state,'BLOCKED');
 assert.equal((await run('endurance',endurance(),{checkCapacity:async()=>false})).state,'BLOCKED');
});
