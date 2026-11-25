import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {AndroidWorker} from '../src/android-worker.js';

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'testlab-worker-test-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const apkPath=join(dir,'test.apk'), bytes=Buffer.from('fixture');
 await writeFile(apkPath,bytes);
 return {deviceId:'test-1',packageName:'com.test.app',apkPath,apkSha256:createHash('sha256').update(bytes).digest('hex'),isolationConfirmed:true};
}
const success=output=>({exitCode:0,output,timedOut:false});
function fake({failInstall=false,failCleanup=false,existing=false}={}){
 let present=existing;
 return async(binary,args)=>{
  assert.equal(binary,'adb');assert.deepEqual(args.slice(0,2),['-s','test-1']);
  const command=args.slice(2).join(' ');
  if(command==='get-state')return success('device\n');
  if(command==='shell pm list packages com.test.app')return success(present?'package:com.test.app\n':'');
  if(command.startsWith('install ')){present=true;return failInstall?{exitCode:1,output:'Failure'}:success('Success\n');}
  if(command==='shell pm path com.test.app')return success('package:/data/app/base.apk\n');
  if(command==='uninstall com.test.app'){if(!failCleanup)present=false;return success('Success\n');}
  throw new Error('Unexpected command');
 };
}
test('authorized smoke run verifies artifact and cleanup without release approval',async t=>{
 const input=await fixture(t),worker=new AndroidWorker({approvedDevices:['test-1'],runner:fake()});
 const result=await worker.smoke(input);
 assert.equal(result.status,'SMOKE_OBSERVED');assert.equal(result.cleanupVerified,true);
 assert.equal(result.deploymentAuthorized,false);assert.equal(worker.status('test-1'),'IDLE');
});
test('invalid digest does not execute ADB',async t=>{
 const input=await fixture(t),worker=new AndroidWorker({approvedDevices:['test-1'],runner:async()=>assert.fail('ADB must not run')});
 assert.equal((await worker.smoke({...input,apkSha256:'0'.repeat(64)})).status,'BLOCKED');
 assert.equal(worker.status('test-1'),'IDLE');
});
test('unauthorized hardware and missing isolation are rejected',async t=>{
 const input=await fixture(t),worker=new AndroidWorker({approvedDevices:['test-1'],runner:fake()});
 await assert.rejects(worker.smoke({...input,deviceId:'other'}));
 await assert.rejects(worker.smoke({...input,isolationConfirmed:false}));
 await assert.rejects(worker.smoke({...input,packageName:'com.test;reboot'}));
});
test('uncertain install and failed cleanup quarantine device',async t=>{
 const input=await fixture(t);
 for(const options of [{failInstall:true},{failCleanup:true}]){
  const worker=new AndroidWorker({approvedDevices:['test-1'],runner:fake(options)});
  assert.equal((await worker.smoke(input)).status,'BLOCKED');
  assert.equal(worker.status('test-1'),'QUARANTINED');
  await assert.rejects(worker.smoke(input));
 }
});
test('existing package is never replaced',async t=>{
 const input=await fixture(t),worker=new AndroidWorker({approvedDevices:['test-1'],runner:fake({existing:true})});
 assert.equal((await worker.smoke(input)).status,'BLOCKED');
 assert.equal(worker.status('test-1'),'IDLE');
});
test('parallel request cannot use the same device',async t=>{
 const input=await fixture(t),worker=new AndroidWorker({approvedDevices:['test-1'],runner:fake()});
 const first=worker.smoke(input);
 await assert.rejects(worker.smoke(input));
 assert.equal((await first).status,'SMOKE_OBSERVED');
});
