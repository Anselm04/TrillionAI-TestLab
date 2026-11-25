import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTraceabilityPlan} from '../src/requirement-traceability.js';
import {coordinateSeniorTests} from '../src/senior-test-coordinator.js';
const revisionSha256='a'.repeat(64),definitionSha256='b'.repeat(64),environmentId='ubuntu';
const plan=createTraceabilityPlan({revisionSha256,requirements:['r1','r2','r3'].map(id=>({id,title:id})),tests:['t1','t2'].map((id,i)=>({id,definitionSha256,environmentId,requirementIds:['r'+(i+1)]}))});
const make=(testId,execute)=>({testId,definitionSha256,environmentId,execute});
const result=(testId,status='PASSED')=>({testId,status,revisionSha256,definitionSha256,environmentId,evidenceId:'run-'+testId});
test('coordinator selects registered tests, independently checks evidence and reports gaps',async()=>{
 const calls=[];
 const adapters=['t1','t2'].map(id=>make(id,async()=>{calls.push(id);return result(id);}));
 const r=await coordinateSeniorTests({plan,adapters,proposeOrder:async()=>['t2','t1'],verifyObservation:async o=>o.testId==='t1'});
 assert.deepEqual(calls,['t2','t1']);assert.equal(r.planningMode,'VALIDATED_PROPOSAL');
 assert.equal(r.coverage.counts.PASSED,1);assert.equal(r.coverage.counts.UNVERIFIED,1);assert.equal(r.coverage.counts.NOT_TESTED,1);
 assert.equal(r.status,'INCOMPLETE');assert.equal(r.deploymentAuthorized,false);
});
test('unknown proposed tests cannot execute and resource limits preserve pending coverage',async()=>{
 let calls=0;
 const adapters=['t1','t2'].map(id=>make(id,async()=>{calls++;return result(id);}));
 const r=await coordinateSeniorTests({plan,adapters,proposeOrder:async()=>['host-shell','t1'],verifyObservation:async()=>true,maxTests:1});
 assert.equal(r.planningMode,'DETERMINISTIC');assert.equal(calls,1);assert.equal(r.events[1].reason,'TEST_BUDGET');
 const paused=await coordinateSeniorTests({plan,adapters,checkCapacity:async()=>false,verifyObservation:async()=>true});
 assert.equal(paused.attempts,0);assert.equal(paused.coverage.counts.PASSED,0);
 await assert.rejects(coordinateSeniorTests({plan,adapters:[make('unknown',async()=>{})],verifyObservation:async()=>true}));
});
test('infrastructure failure stops subsequent work and never creates a fabricated pass',async()=>{
 const r=await coordinateSeniorTests({plan,adapters:[make('t1',async()=>{throw Error('offline');}),make('t2',async()=>{assert.fail('must not run');})],verifyObservation:async()=>true});
 assert.equal(r.attempts,1);assert.equal(r.coverage.counts.PASSED,0);assert.equal(r.events[0].status,'INFRASTRUCTURE_ERROR');
});
