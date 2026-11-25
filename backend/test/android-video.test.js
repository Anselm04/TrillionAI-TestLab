import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {recordAndroidClip} from '../src/android-video.js';
import {MobileEvidenceStore} from '../src/mobile-evidence.js';
const video=Buffer.from('00000018667479706d703432000000006d70343269736f6d','hex');
const success={exitCode:0,output:''};
test('bounded recording uses selected device and cleans remote file',async()=>{
 const calls=[];
 const r=await recordAndroidClip({deviceId:'device-1',execute:async()=>({exitCode:0,output:'journey'}),runner:async(binary,args,options)=>{
  assert.equal(binary,'adb');assert.deepEqual(args.slice(0,2),['-s','device-1']);calls.push(args);
  if(args[2]==='exec-out')return {...success,stdoutBytes:video};
  if(args[3]==='screenrecord')assert.equal(options.timeoutMs,45000);
  return success;
 }});
 assert.equal(r.status,'CLIP_CAPTURED');assert.equal(r.cleanupVerified,true);
 assert.deepEqual(r.video,video);assert.equal(r.result.output,'journey');
 assert.ok(calls.some(a=>a[3]==='rm'));assert.ok(calls.some(a=>a[3]==='test'));
});
test('capture and cleanup errors fail closed',async()=>{
 for(const failure of ['capture','cleanup']){
  const r=await recordAndroidClip({deviceId:'device-1',execute:async()=>success,runner:async(binary,args)=>{
   if(args[2]==='exec-out')return {...success,stdoutBytes:failure==='capture'?Buffer.from('bad'):video};
   if(args[3]==='test'&&failure==='cleanup')return {exitCode:1};
   return success;
  }});
  assert.equal(r.status,'CAPTURE_FAILED');
 }
});
test('video evidence checksum detects modification',async t=>{
 const root=await mkdtemp(join(tmpdir(),'testlab-video-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=new MobileEvidenceStore(root);
 const m=await store.capture({deviceId:'device-1',buildSha256:'a'.repeat(64),flowSha256:'b'.repeat(64),log:'log',video});
 assert.equal(await store.verify(m),true);
 await writeFile(join(root,m.runId,'clip.mp4'),Buffer.alloc(video.length));
 assert.equal(await store.verify(m),false);
});
