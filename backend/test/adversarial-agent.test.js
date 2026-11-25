import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTraceabilityPlan} from '../src/requirement-traceability.js';
import {runAdversarialTests} from '../src/adversarial-agent.js';
const revisionSha256='a'.repeat(64),definitionSha256='b'.repeat(64),environmentId='sandbox';
const plan=createTraceabilityPlan({revisionSha256,requirements:[{id:'r1',title:'Reject invalid input'}],tests:[{id:'t1',definitionSha256,environmentId,requirementIds:['r1']}]});
const scope={mode:'isolated-test',revisionSha256,environmentIds:[environmentId]};
const adapter={testId:'t1',definitionSha256,environmentId,category:'input-validation',execute:async()=>({testId:'t1',revisionSha256,definitionSha256,environmentId,status:'FAILED',evidenceId:'e1'})};
test('reports only independently verified failures',async()=>{
 const args={plan,scope,adapters:[adapter]};
 const verified=await runAdversarialTests({...args,verifyObservation:async()=>true});
 assert.equal(verified.status,'VERIFIED_FAILURES');
 assert.deepEqual(verified.findings,[{testId:'t1',category:'input-validation',evidenceId:'e1',status:'VERIFIED_TEST_FAILURE'}]);
 assert.equal(verified.customerRepairAuthorized,false);
 const rejected=await runAdversarialTests({...args,verifyObservation:async()=>false});
 assert.equal(rejected.status,'INCOMPLETE');assert.equal(rejected.findings.length,0);
});
test('rejects wrong scope and unknown categories before execution',async()=>{
 let calls=0;
 const a={...adapter,execute:async()=>{calls++;}};
 const args={plan,scope,adapters:[a],verifyObservation:async()=>true};
 await assert.rejects(runAdversarialTests({...args,scope:{...scope,environmentIds:['other']}}));
 await assert.rejects(runAdversarialTests({...args,adapters:[{...a,category:'unknown'}]}));
 await assert.rejects(runAdversarialTests({...args,adapters:[a,a]}));
 assert.equal(calls,0);
});
test('missing adapters and resource limits never imply pass',async()=>{
 const args={plan,scope,verifyObservation:async()=>true};
 assert.equal((await runAdversarialTests({...args,adapters:[]})).status,'INCOMPLETE');
 assert.equal((await runAdversarialTests({...args,adapters:[adapter],checkCapacity:async()=>false})).status,'INCOMPLETE');
});
