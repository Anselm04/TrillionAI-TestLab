import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableExecution} from '../src/durable-execution.js';
import {createAssessmentExecutionProfile} from '../src/assessment-execution-profiles.js';
const revisionSha256='a'.repeat(64),fixtureSha256='b'.repeat(64),environmentId='local';
const config={profileId:'fixture',testId:'check',environmentId,revisionSha256,fixtureSha256,verifyEvidence:async()=>true,verifyReport:async()=>true};
const operation=(i,result=i)=>({id:'op'+i,start:0,end:10,status:'COMMITTED',delta:1,result,evidenceId:'e'+i});
const tx=(final=2)=>({history:[operation(1),operation(2)],initial:0,final});
const snapshot=(name='Submit')=>({revisionSha256,environmentId,journeyId:'check',evidenceId:'snapshot',complete:true,nodes:[{id:'button',role:'button',name,visible:true,enabled:true,keyboardReachable:true,requiresKeyboard:true}],keyboardSteps:[{id:'tab',expectedNodeId:'button',actualNodeId:'button',focusVisible:true}]});
async function run(kind,data,extra={}){
 const dir=mkdtempSync(join(tmpdir(),'testlab-assessment-'));
 const profile=createAssessmentExecutionProfile({...config,kind,collect:async c=>({...c,data}),...extra});
 const journal=new DurableExecution(join(dir,'runs.sqlite'),{profiles:[profile]});
 try{const queued=journal.submit({profileId:'fixture',revisionSha256});await journal.runNext({checkCapacity:async()=>true});return journal.get(queued.runId);}
 finally{journal.close();rmSync(dir,{recursive:true,force:true});}
}
test('transaction model assessment persists passing and failing findings',async()=>{
 const pass=await run('transaction',tx());assert.equal(pass.state,'VERIFIED');assert.equal(pass.result.observation.status,'PASSED');
 const fail=await run('transaction',tx(1));assert.equal(fail.state,'VERIFIED');assert.equal(fail.result.observation.status,'FAILED');
});
test('accessibility assessment persists declared rule findings only',async()=>{
 const pass=await run('accessibility',{snapshot:snapshot()});assert.equal(pass.result.observation.status,'PASSED');assert.equal(pass.result.observation.report.wcagConformance,'NOT_ESTABLISHED');
 const fail=await run('accessibility',{snapshot:snapshot('')});assert.equal(fail.result.observation.status,'FAILED');
});
test('unverified evidence, incomplete history and collection context mismatch block',async()=>{
 assert.equal((await run('transaction',tx(),{verifyEvidence:async()=>false})).state,'BLOCKED');
 assert.equal((await run('transaction',tx(),{verifyReport:async()=>false})).state,'BLOCKED');
 assert.equal((await run('transaction',{...tx(),history:[{...operation(1),status:'UNKNOWN'}]})).state,'BLOCKED');
 assert.equal((await run('transaction',tx(),{collect:async c=>({...c,runId:'wrong',data:tx()})})).state,'BLOCKED');
});
