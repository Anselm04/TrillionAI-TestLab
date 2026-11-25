import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAdbInventory, discoverAndroid, DevicePool, evaluateDeviceGate } from '../src/device-farm.js';

const inventory = 'List of devices attached\nABC123 device product:p model:Pixel_7 transport_id:1\nXYZ offline\nLOCKED unauthorized\nemulator-5554 device model:sdk_gphone\n';
test('inventory distinguishes connectivity without asserting physical hardware',()=>{
  const devices=parseAdbInventory(inventory);
  assert.equal(devices.length,4);
  assert.equal(devices[0].model,'Pixel_7');
  assert.equal(devices[0].kind,'unverified');
  assert.equal(devices[1].available,false);
  assert.equal(devices[2].available,false);
  assert.equal(devices[3].kind,'unverified');
});
test('discovery uses fixed command and rejects failed or truncated output',async()=>{
  const r=await discoverAndroid({runner:async(binary,args)=>{
    assert.equal(binary,'adb');assert.deepEqual(args,['devices','-l']);
    return {exitCode:0,output:inventory};
  }});
  assert.equal(r.status,'DISCOVERED');
  for(const failure of [{exitCode:1},{exitCode:0,output:inventory,timedOut:true},{exitCode:0,output:inventory,outputTruncated:true},{error:'missing adb'}]){
    assert.deepEqual(await discoverAndroid({runner:async()=>failure}),{status:'INFRASTRUCTURE_ERROR',devices:[]});
  }
});
test('exclusive leases quarantine on expiry and require verified cleanup',()=>{
  let now=0;
  const pool=new DevicePool({clock:()=>now});
  pool.refresh(parseAdbInventory(inventory));
  const lease=pool.acquire({deviceId:'ABC123',runId:'run-1',durationMs:1000});
  assert.ok(lease);
  assert.equal(pool.status('ABC123'),'LEASED');
  assert.equal(pool.acquire({deviceId:'ABC123',runId:'run-2'}),null);
  assert.equal(pool.acquire({deviceId:'LOCKED',runId:'run-2'}),null);
  now=1001;
  pool.refresh(parseAdbInventory(inventory));
  assert.equal(pool.status('ABC123'),'QUARANTINED');
  assert.equal(pool.acquire({deviceId:'ABC123',runId:'run-2'}),null);
  assert.equal(pool.release('ABC123',lease.token),false);
  assert.equal(pool.release('ABC123','wrong',{cleanupVerified:true}),false);
  assert.equal(pool.release('ABC123',lease.token,{cleanupVerified:true}),true);
  assert.equal(pool.status('ABC123'),'AVAILABLE');
});
test('gate never authorizes deployment, missing or invalid evidence blocks',()=>{
  const good={checkId:'login',status:'PASSED',exitCode:0,timedOut:false,evidenceDigest:'a'.repeat(64),independentReview:'VERIFIED'};
  assert.equal(evaluateDeviceGate(['login'],[]).status,'BLOCKED');
  assert.equal(evaluateDeviceGate(['login','logout'],[good]).status,'BLOCKED');
  for(const override of [{exitCode:1},{timedOut:true},{evidenceDigest:''},{independentReview:'PENDING'},{status:'FAILED'}]){
    assert.equal(evaluateDeviceGate(['login'],[{...good,...override}]).status,'BLOCKED');
  }
  const gate=evaluateDeviceGate(['login'],[good]);
  assert.equal(gate.status,'EVIDENCE_REVIEW_REQUIRED');
  assert.equal(gate.deploymentAuthorized,false);
  assert.equal(gate.productionReady,false);
  assert.throws(()=>evaluateDeviceGate(['login'],[good,good]));
  assert.throws(()=>evaluateDeviceGate([],[]));
});
