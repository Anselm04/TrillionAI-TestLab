import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyzeFailureHistory} from '../src/failure-intelligence.js';
const projectId='testlab',revisionSha256='a'.repeat(64),definitionSha256='b'.repeat(64);
const obs=(i,status='FAILED',extra={})=>({projectId,revisionSha256,definitionSha256,evidenceId:'e'+i,testId:'login',environmentId:'ubuntu',sequence:i,status,failureCode:'ASSERTION',...extra});
const run=(observations,extra={})=>analyzeFailureHistory({projectId,observations,verifyObservation:async()=>true,...extra});
test('groups recurring failures and retains all evidence identifiers',async()=>{
 const r=await run([obs(2),obs(1),obs(3,'PASSED')]);
 assert.equal(r.groups.length,1);assert.equal(r.groups[0].count,2);
 assert.deepEqual(r.groups[0].evidenceIds,['e1','e2']);
 assert.equal(r.recommendations[0].reason,'MIXED_VERIFIED_OUTCOMES');
 assert.equal(r.rootCauseEstablished,false);assert.equal(r.customerRepairAuthorized,false);
});
test('revision, environment and infrastructure outcomes stay distinct',async()=>{
 const r=await run([obs(1),obs(2,'FAILED',{revisionSha256:'c'.repeat(64)}),obs(3,'TIMEOUT',{environmentId:'android'})]);
 assert.equal(r.groups.length,3);assert.equal(r.recommendations.length,3);
 assert.equal(r.recommendations[2].action,'REVIEW_TEST_ENVIRONMENT');
});
test('unverified observations cannot produce findings or retest recommendations',async()=>{
 const r=await run([obs(1),obs(2)],{verifyObservation:async o=>o.evidenceId==='e2'});
 assert.equal(r.status,'INCOMPLETE');assert.equal(r.groups[0].count,1);assert.deepEqual(r.rejected,['e1']);
 assert.equal((await run([obs(1)],{verifyObservation:async()=>false})).recommendations.length,0);
});
test('rejects duplicate evidence and cross-project input; bounds recommendations',async()=>{
 await assert.rejects(run([obs(1),obs(1)]));
 await assert.rejects(run([obs(1,'FAILED',{projectId:'other'})]));
 const r=await run([obs(1),obs(2,'FAILED',{testId:'checkout'})],{maxRecommendations:1});
 assert.equal(r.recommendations.length,1);assert.equal(r.omittedRecommendations,1);
});
