import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runEndurance} from '../src/endurance-testing.js';

const scope={mode:'isolated-test',revisionSha256:'a'.repeat(64),environmentId:'fixture',journeyId:'journey'};
function fixture(){
 return {scope:{...scope},policy:{durationMs:100,intervalMs:10,maxSamples:10,maxLatencyMs:600000,maxMemoryGrowthBytes:100},adapter:{...scope,sample:async()=>({...scope,evidenceId:'sample-1',memoryBytes:100,healthy:true})},checkCapacity:async()=>true,verifySample:async()=>true};
}
test('endurance rejects every mismatched evidence context before verification',async()=>{
 for(const [key,value] of [['revisionSha256','b'.repeat(64)],['environmentId','other'],['journeyId','other']]){
  const o=fixture();
  o.adapter.sample=async()=>({...scope,[key]:value,evidenceId:'sample-1',memoryBytes:100,healthy:true});
  let calls=0;
  o.verifySample=async()=>{calls++;return true;};
  const r=await runEndurance(o);
  assert.equal(r.status,'INCOMPLETE');
  assert.equal(r.reason,'INVALID_SAMPLE');
  assert.equal(r.sampleCount,0);
  assert.equal(calls,0);
 }
});
test('cancellation during independent verification cannot admit a sample',async()=>{
 const o=fixture(), controller=new AbortController();
 o.signal=controller.signal;
 o.verifySample=async()=>{controller.abort();return true;};
 const r=await runEndurance(o);
 assert.equal(r.status,'INCOMPLETE');
 assert.equal(r.reason,'CANCELLED');
 assert.equal(r.sampleCount,0);
 assert.equal(r.deploymentAuthorized,false);
});
test('independent verifier errors cannot create passing endurance evidence',async()=>{
 const o=fixture();
 o.verifySample=async()=>{throw Error('fixture verifier failure');};
 const r=await runEndurance(o);
 assert.equal(r.status,'INCOMPLETE');
 assert.equal(r.reason,'ADAPTER_OR_VERIFIER_ERROR');
 assert.equal(r.sampleCount,0);
 assert.equal(r.productionReady,false);
});
