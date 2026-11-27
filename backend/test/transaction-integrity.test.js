import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyIncrementHistory} from '../src/transaction-integrity.js';
const op=(id,start,end,result,status='COMMITTED')=>({id,start,end,result,status,delta:1,evidenceId:'e-'+id});
const args={initial:0,final:2,revisionSha256:'a'.repeat(64),environmentId:'sandbox',verifyEvidence:async()=>true};
test('overlapping increments permit either valid commit order',async()=>{
 const history=[op('a',0,4,2),op('b',1,3,1)];
 assert.equal((await verifyIncrementHistory({...args,history})).status,'DECLARED_INCREMENT_MODEL_PASSED');
});
test('lost updates and real time ordering violations are detected',async()=>{
 const lost=await verifyIncrementHistory({...args,final:1,history:[op('a',0,4,1),op('b',1,3,1)]});
 assert.deepEqual(lost.violations,['FINAL_STATE_MISMATCH','NON_ATOMIC_INCREMENT']);
 const reversed=await verifyIncrementHistory({...args,history:[op('a',0,1,2),op('b',2,3,1)]});
 assert.deepEqual(reversed.violations,['REAL_TIME_ORDER_VIOLATION']);
});
test('unknown commits, unverified evidence and duplicate IDs never pass',async()=>{
 const history=[op('a',0,1,1),op('b',2,3,2,'UNKNOWN')];
 assert.equal((await verifyIncrementHistory({...args,history})).status,'INCOMPLETE');
 assert.equal((await verifyIncrementHistory({...args,history,verifyEvidence:async()=>false})).status,'UNVERIFIED');
 await assert.rejects(verifyIncrementHistory({...args,history:[history[0],history[0]]}));
});
test('aborted increments do not count toward committed state',async()=>{
 const history=[op('a',0,1,1),op('b',2,3,null,'ABORTED')];
 assert.equal((await verifyIncrementHistory({...args,final:1,history})).status,'DECLARED_INCREMENT_MODEL_PASSED');
});

test('reused operation evidence cannot establish an increment history verdict',async()=>{
 const history=[op('a',0,1,1),{...op('b',2,3,2),evidenceId:'e-a'}];
 await assert.rejects(verifyIncrementHistory({...args,history,verifyEvidence:async()=>assert.fail('duplicate evidence reached verifier')}),/Invalid operation/);
 assert.equal((await verifyIncrementHistory({...args,history:[op('a',0,1,1),op('b',2,3,2)]})).status,'DECLARED_INCREMENT_MODEL_PASSED');
});
