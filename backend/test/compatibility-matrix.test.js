import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCompatibility} from '../src/compatibility-matrix.js';
const revisionSha256='a'.repeat(64),buildSha256='b'.repeat(64),flowSha256='c'.repeat(64);
const web={id:'web',platform:'web',mode:'browser',osVersion:'ubuntu24',arch:'x64',buildSha256,flowSha256};
const phone={...web,id:'phone',platform:'android',mode:'physical',osVersion:'14',arch:'arm64'};
const inventory=[{...web,deviceId:'browser1'},{...phone,deviceId:'phone1'},{...phone,mode:'emulator',deviceId:'emu1'}];
const observation=(t,deviceId,status='PASSED')=>({targetId:t.id,deviceId,runId:'run-'+t.id,revisionSha256,buildSha256,flowSha256,status});
const args={revisionSha256,inventory,targets:[web,phone],verifyObservation:async()=>true};
test('browser evidence cannot imply physical qualification',async()=>{
 const r=await evaluateCompatibility({...args,observations:[observation(web,'browser1')]});
 assert.equal(r.checks[0].status,'PASSED');assert.equal(r.checks[1].status,'NOT_TESTED');assert.equal(r.physicalQualification,'INCOMPLETE');
});
test('emulator and unsigned physical observations cannot qualify physical targets',async()=>{
 for(const device of ['emu1','phone1']){
 const r=await evaluateCompatibility({...args,observations:[observation(phone,device)]});
 assert.equal(r.checks[1].status,'UNVERIFIED');assert.equal(r.status,'INCOMPLETE');
 }
});
test('verified failure and wrong build remain distinct',async()=>{
 const r=await evaluateCompatibility({...args,observations:[observation(web,'browser1','FAILED')]});
 assert.equal(r.status,'VERIFIED_FAILURE');
 const b=await evaluateCompatibility({...args,observations:[{...observation(web,'browser1'),buildSha256:'d'.repeat(64)}]});
 assert.equal(b.checks[0].reason,'CONTEXT_MISMATCH');
});
test('duplicate run identifiers and invalid targets are rejected',async()=>{
 await assert.rejects(evaluateCompatibility({...args,observations:[observation(web,'browser1'),{...observation(phone,'phone1'),runId:'run-web'}]}));
 await assert.rejects(evaluateCompatibility({...args,targets:[{...phone,mode:'browser'}],observations:[]}));
});
test('verified software-only matrix never claims physical tests or release',async()=>{
 const r=await evaluateCompatibility({...args,targets:[web],observations:[observation(web,'browser1')]});
 assert.equal(r.status,'DECLARED_MATRIX_PASSED');assert.equal(r.physicalQualification,'NOT_REQUESTED');assert.equal(r.deploymentAuthorized,false);
});
