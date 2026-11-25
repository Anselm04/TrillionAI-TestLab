import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkProperty,seededRandom,generateBoundaryInteger} from '../src/property-testing.js';
test('seed replay and edge values',()=>{
 const a=seededRandom(42),b=seededRandom(42);
 assert.deepEqual(Array.from({length:100},a),Array.from({length:100},b));
 assert.equal(generateBoundaryInteger(a,3),Number.MAX_SAFE_INTEGER);
 assert.throws(()=>seededRandom(-1));
});
test('verified counterexamples replay identically',async()=>{
 const options={seed:42,cases:100,generate:generateBoundaryInteger,property:n=>n>=0,verifyFailure:async n=>n<0};
 const a=await checkProperty(options),b=await checkProperty(options);
 assert.deepEqual(a,b);assert.equal(a.status,'VERIFIED_COUNTEREXAMPLE');assert.equal(a.observation.index,2);
 assert.equal((await checkProperty({...options,verifyFailure:async()=>false})).status,'UNVERIFIED_COUNTEREXAMPLE');
});
test('capacity, cancellation and fixture errors fail closed',async()=>{
 const options={cases:10,generate:generateBoundaryInteger,property:()=>true};
 assert.equal((await checkProperty(options)).executed,10);
 assert.equal((await checkProperty({...options,checkCapacity:async()=>false})).executed,0);
 const c=new AbortController();c.abort();
 assert.equal((await checkProperty({...options,signal:c.signal})).reason,'CANCELLED');
 assert.equal((await checkProperty({...options,property:()=>{throw Error('fixture');}})).status,'INCOMPLETE');
 assert.equal((await checkProperty({...options,generate:()=> 'x'.repeat(70000)})).reason,'INVALID_GENERATED_CASE');
 await assert.rejects(checkProperty({...options,cases:10001}));
});
