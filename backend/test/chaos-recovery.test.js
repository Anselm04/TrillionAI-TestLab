import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qualifyRecovery} from '../src/chaos-recovery.js';
const scope={mode:'isolated-test',environmentId:'sandbox',revisionSha256:'a'.repeat(64)};
const scenario={id:'restart-1',fault:'restart',maxRecoveryMs:600000,maxLostRecords:0};
const baseline={stateSha256:'b'.repeat(64),recordCount:10};
const after={...baseline,healthy:true,lostRecords:0,evidenceId:'run-1'};
const make=()=>({environmentId:scope.environmentId,revisionSha256:scope.revisionSha256,scenarioId:scenario.id,fault:scenario.fault,baseline:async()=>baseline,exercise:async()=>after,cleanup:async()=>true});
const args=()=>({scope,scenario,adapter:make(),verifyObservation:async()=>true});
test('qualifies verified recovery and detects record loss',async()=>{
 const a=args();assert.equal((await qualifyRecovery(a)).status,'DECLARED_RECOVERY_CHECKS_PASSED');
 a.adapter.exercise=async()=>({...after,lostRecords:1,recordCount:9});
 const r=await qualifyRecovery(a);assert.equal(r.status,'VERIFIED_FAILURE');assert.deepEqual(r.violations,['RECORD_LOSS_EXCEEDED']);
 assert.equal(r.deploymentAuthorized,false);
});
test('cleanup executes after exercise exceptions and failures block pass',async()=>{
 const a=args();let cleaned=0;a.adapter.exercise=async()=>{throw Error('fixture');};a.adapter.cleanup=async()=>{cleaned++;return true;};
 assert.equal((await qualifyRecovery(a)).reason,'FIXTURE_ERROR');assert.equal(cleaned,1);
 a.adapter.cleanup=async()=>false;assert.equal((await qualifyRecovery(a)).reason,'SANDBOX_CLEANUP_FAILED');
});
test('scope, capacity and independent verification are mandatory',async()=>{
 const a=args();await assert.rejects(qualifyRecovery({...a,scope:{...scope,mode:'production'}}));
 assert.equal((await qualifyRecovery({...a,verifyObservation:async()=>false})).reason,'EVIDENCE_UNVERIFIED');
 assert.equal((await qualifyRecovery({...a,checkCapacity:async()=>false})).reason,'RESOURCE_LIMIT');
 const controller=new AbortController();controller.abort();
 assert.equal((await qualifyRecovery({...a,signal:controller.signal})).reason,'CANCELLED');
});

test('recovery exercise cannot rewrite captured baseline evidence',async()=>{
 const a=args(),original={...baseline};
 a.adapter.baseline=async()=>original;
 a.adapter.exercise=async()=>{original.recordCount=9;original.stateSha256='c'.repeat(64);return {...after,recordCount:9,lostRecords:1};};
 const r=await qualifyRecovery(a);
 assert.equal(r.status,'VERIFIED_FAILURE');
 assert.deepEqual(r.observation.baseline,baseline);
});
test('cancellation during initial resource admission prevents baseline access',async()=>{
 const a=args(),controller=new AbortController();
 a.adapter.baseline=async()=>assert.fail('cancelled fixture accessed');
 const r=await qualifyRecovery({...a,signal:controller.signal,checkCapacity:async()=>{controller.abort();return true;}});
 assert.equal(r.reason,'CANCELLED');
});
