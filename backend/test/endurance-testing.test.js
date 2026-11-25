import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runEndurance} from '../src/endurance-testing.js';
const scope={mode:'isolated-test',revisionSha256:'a'.repeat(64),environmentId:'ubuntu',journeyId:'fixture'};
const policy={durationMs:100,intervalMs:10,maxSamples:100,maxLatencyMs:600000,maxMemoryGrowthBytes:100};
function options(){
 let i=0;
 return {scope,policy,adapter:{...scope,sample:async()=>({...scope,evidenceId:'run-'+(++i),memoryBytes:100,healthy:true})},checkCapacity:async()=>true,verifySample:async()=>true};
}
test('verified measurements cover declared elapsed interval',async()=>{
 const r=await runEndurance(options());assert.equal(r.status,'DECLARED_ENDURANCE_CHECKS_PASSED');assert.ok(r.elapsedMs>=100);assert.ok(r.sampleCount>=2);assert.equal(r.deploymentAuthorized,false);
});
test('memory growth and unhealthy observations are reported',async()=>{
 const a=options();let i=0;a.adapter.sample=async()=>({...scope,evidenceId:'run-'+(++i),memoryBytes:i*200,healthy:true});
 const r=await runEndurance(a);assert.equal(r.status,'VERIFIED_FAILURE');assert.equal(r.violations[0].rule,'MEMORY_GROWTH');
 const b=options();b.adapter.sample=async()=>({...scope,evidenceId:'bad',memoryBytes:100,healthy:false});
 assert.equal((await runEndurance(b)).violations[0].rule,'UNHEALTHY');
});
test('resource refusal, cancellation, unverified and duplicate evidence fail closed',async()=>{
 const a=options();assert.equal((await runEndurance({...a,checkCapacity:async()=>false})).reason,'RESOURCE_LIMIT');
 assert.equal((await runEndurance({...options(),verifySample:async()=>false})).reason,'EVIDENCE_UNVERIFIED');
 const b=options();b.adapter.sample=async()=>({...scope,evidenceId:'duplicate',memoryBytes:100,healthy:true});
 assert.equal((await runEndurance(b)).reason,'INVALID_SAMPLE');
 const c=new AbortController();c.abort();assert.equal((await runEndurance({...options(),signal:c.signal})).reason,'CANCELLED');
 await assert.rejects(runEndurance({...options(),scope:{...scope,mode:'production'}}));
});
test('sample budget cannot stand in for actual duration',async()=>{
 const a=options();a.policy={...policy,durationMs:10000,maxSamples:2};
 assert.equal((await runEndurance(a)).reason,'SAMPLE_BUDGET');
});
