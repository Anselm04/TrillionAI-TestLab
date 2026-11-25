import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calibrateMobileGate} from '../src/self-calibration.js';
test('real mobile gate detects every declared synthetic fault',async()=>{
 const result=await calibrateMobileGate();
 assert.equal(result.status,'CALIBRATION_PASSED');
 assert.equal(result.observations.length,9);
 assert.equal(result.deploymentAuthorized,false);
});
test('calibration rejects always-pass and always-block broken gate implementations',async()=>{
 for(const status of ['REQUIRED_EVIDENCE_VERIFIED','BLOCKED']){
  const result=await calibrateMobileGate({evaluate:async()=>({status,productionReady:false,deploymentAuthorized:false})});
  assert.equal(result.status,'CALIBRATION_FAILED');
  assert.ok(result.observations.some(x=>x.status==='MISCLASSIFIED'));
 }
});
test('exception is infrastructure error rather than successful detection',async()=>{
 const result=await calibrateMobileGate({evaluate:async()=>{throw Error('fixture');}});
 assert.equal(result.status,'CALIBRATION_FAILED');
 assert.ok(result.observations.every(x=>x.status==='INFRASTRUCTURE_ERROR'));
});
