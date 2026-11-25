import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableDeviceLeases} from '../src/durable-device-leases.js';
import {LeasedIosSupervisor} from '../src/leased-ios-supervisor.js';
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'testlab-ios-lease-')),leases=new DurableDeviceLeases(join(dir,'leases.db'));
 t.after(async()=>{leases.close();await rm(dir,{recursive:true,force:true});});
 let installed=false;
 const adapter={verifyArtifact:async()=>true,isInstalled:async()=>installed,install:async()=>{installed=true;return true;},execute:async()=>({status:'COMMAND_SUCCEEDED'}),uninstall:async()=>{installed=false;return true;}};
 const input={deviceId:'iphone-1',bundleId:'com.test.app',artifactPath:'/fixtures/test.app',artifactSha256:'a'.repeat(64),isolationConfirmed:true};
 return {leases,adapter,input,config:{leases,adapter,approvedDevices:['iphone-1'],hostPlatform:'darwin'}};
}
test('iOS lifecycle exclusively leases, installs, executes and cleans up',async t=>{
 const f=await fixture(t),s=new LeasedIosSupervisor(f.config);
 const r=await s.smoke(f.input);
 assert.equal(r.status,'SMOKE_OBSERVED');assert.equal(r.cleanupVerified,true);assert.equal(f.leases.status('ios:iphone-1'),'IDLE');assert.equal(r.deploymentAuthorized,false);
});
test('failed execution quarantines after cleanup',async t=>{
 const f=await fixture(t);f.adapter.execute=async()=>({status:'COMMAND_FAILED'});
 const r=await new LeasedIosSupervisor(f.config).smoke(f.input);
 assert.equal(r.status,'BLOCKED');assert.equal(r.cleanupVerified,true);assert.equal(f.leases.status('ios:iphone-1'),'QUARANTINED');
});
test('preexisting application is never removed',async t=>{
 const f=await fixture(t);f.adapter.isInstalled=async()=>true;f.adapter.uninstall=async()=>assert.fail();
 assert.equal((await new LeasedIosSupervisor(f.config).smoke(f.input)).status,'BLOCKED');
});
