import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DurableDeviceLeases} from '../src/durable-device-leases.js';
import {LeasedAndroidSupervisor} from '../src/leased-android-supervisor.js';
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'testlab-supervisor-'));
 const path=join(dir,'leases.db'),apkPath=join(dir,'test.apk');
 const bytes=Buffer.from('fixture');await writeFile(apkPath,bytes);
 let now=10000;
 const a=new DurableDeviceLeases(path,{clock:()=>now}),b=new DurableDeviceLeases(path,{clock:()=>now});
 t.after(async()=>{a.close();b.close();await rm(dir,{recursive:true,force:true});});
 return {a,b,advance:ms=>now+=ms,input:{deviceId:'device-1',packageName:'com.test.app',apkPath,apkSha256:createHash('sha256').update(bytes).digest('hex'),signerSha256:['a'.repeat(64)],isolationConfirmed:true}};
}
const success=output=>({exitCode:0,output,timedOut:false});
function fake(){
 let present=false;
 return async(binary,args)=>{
  if(binary==='apksigner')return success('Signer #1 certificate SHA-256 digest: '+'a'.repeat(64)+'\n');
  if(binary==='aapt2')return success("package: name='com.test.app' versionCode='1'\n");
  assert.equal(binary,'adb');assert.deepEqual(args.slice(0,2),['-s','device-1']);
  const cmd=args.slice(2).join(' ');
  if(cmd==='get-state')return success('device\n');
  if(cmd==='shell pm list packages com.test.app')return success(present?'package:com.test.app\n':'');
  if(cmd.startsWith('install ')){present=true;return success('Success\n');}
  if(cmd==='shell pm path com.test.app')return success('package:/data/app/base.apk\n');
  if(cmd==='uninstall com.test.app'){present=false;return success('Success\n');}
  throw new Error('Unexpected command');
 };
}
test('supervisor integrates durable ownership with smoke and verified cleanup',async t=>{
 const f=await fixture(t);
 const s=new LeasedAndroidSupervisor({leases:f.a,approvedDevices:['device-1'],runner:fake()});
 const result=await s.smoke(f.input);
 assert.equal(result.status,'SMOKE_OBSERVED');assert.equal(result.leaseReleased,true);
 assert.equal(f.b.status('device-1'),'IDLE');assert.equal(result.deploymentAuthorized,false);
});
test('second supervisor cannot allocate occupied device',async t=>{
 const f=await fixture(t);
 const a=new LeasedAndroidSupervisor({leases:f.a,approvedDevices:['device-1'],runner:fake()});
 const b=new LeasedAndroidSupervisor({leases:f.b,approvedDevices:['device-1'],runner:async()=>assert.fail('must not execute')});
 const first=a.smoke(f.input);
 assert.equal((await b.smoke(f.input)).status,'BLOCKED');
 assert.equal((await first).status,'SMOKE_OBSERVED');
});
test('lost lease during command blocks and persists quarantine',async t=>{
 const f=await fixture(t);
 const s=new LeasedAndroidSupervisor({leases:f.a,approvedDevices:['device-1'],runner:async()=>{f.advance(300001);return success('device');}});
 const report=await s.smoke(f.input);
 assert.equal(report.status,'BLOCKED');assert.equal(report.leaseReleased,false);
 assert.equal(f.b.status('device-1'),'QUARANTINED');
});
test('failed artifact verification is conservatively quarantined',async t=>{
 const f=await fixture(t);
 const s=new LeasedAndroidSupervisor({leases:f.a,approvedDevices:['device-1'],runner:async()=>assert.fail('must not execute')});
 assert.equal((await s.smoke({...f.input,apkSha256:'0'.repeat(64)})).status,'BLOCKED');
 assert.equal(f.b.status('device-1'),'QUARANTINED');
 await assert.rejects(s.smoke({...f.input,deviceId:'unapproved'}));
});
