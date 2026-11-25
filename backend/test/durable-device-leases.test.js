import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableDeviceLeases} from '../src/durable-device-leases.js';

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'testlab-leases-'));
 const path=join(dir,'leases.db');
 let now=10000;
 const instances=[];
 t.after(async()=>{for(const db of instances)db.close();await rm(dir,{recursive:true,force:true});});
 return {open:()=>{const db=new DurableDeviceLeases(path,{clock:()=>now});instances.push(db);return db;},advance:ms=>now+=ms};
}
test('two connections cannot acquire the same device and state persists',async t=>{
 const f=await fixture(t),a=f.open(),b=f.open();
 assert.equal(a.status('device-1'),'UNREGISTERED');
 a.register('device-1');
 const lease=a.acquire({deviceId:'device-1',runId:'run-1'});
 assert.ok(lease);
 b.register('device-1');
 assert.equal(b.status('device-1'),'LEASED');
 assert.equal(b.acquire({deviceId:'device-1',runId:'run-2'}),null);
 const reopened=f.open();
 assert.equal(reopened.status('device-1'),'LEASED');
 assert.equal(reopened.release({...lease,cleanupVerified:true}),true);
 const next=b.acquire({deviceId:'device-1',runId:'run-2'});
 assert.ok(next.fence>lease.fence);
 assert.equal(a.release({...lease,cleanupVerified:true}),false);
 assert.equal(a.heartbeat(lease),false);
});
test('expired lease cannot be renewed or reassigned',async t=>{
 const f=await fixture(t),a=f.open(),b=f.open();
 a.register('device-1');
 const lease=a.acquire({deviceId:'device-1',runId:'run-1',durationMs:1000});
 f.advance(1000);
 assert.equal(b.heartbeat(lease),false);
 assert.equal(a.status('device-1'),'QUARANTINED');
 assert.equal(b.release({...lease,cleanupVerified:true}),false);
 assert.equal(b.acquire({deviceId:'device-1',runId:'run-2'}),null);
});
test('valid heartbeat extends lease, cleanup required, quarantine persists',async t=>{
 const f=await fixture(t),a=f.open();
 a.register('device-1');
 const lease=a.acquire({deviceId:'device-1',runId:'run-1',durationMs:1000});
 f.advance(500);
 assert.equal(a.heartbeat({...lease,durationMs:2000}),true);
 f.advance(1000);
 assert.equal(a.status('device-1'),'LEASED');
 assert.equal(a.release(lease),false);
 assert.equal(a.quarantine(lease),true);
 assert.equal(f.open().status('device-1'),'QUARANTINED');
 assert.equal(a.release({...lease,cleanupVerified:true}),false);
});
test('invalid input and unknown devices fail closed',async t=>{
 const f=await fixture(t),a=f.open();
 assert.throws(()=>a.register('../device'));
 assert.throws(()=>a.acquire({deviceId:'device-1',runId:'run-1',durationMs:0}));
 assert.equal(a.acquire({deviceId:'device-1',runId:'run-1'}),null);
});
