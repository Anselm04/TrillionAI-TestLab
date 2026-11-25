import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createIosEvidenceExecutor} from '../src/ios-media-evidence.js';
import {MobileEvidenceStore} from '../src/mobile-evidence.js';
test('export attachments and verify evidence; missing video blocks',async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'ios-media-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const resultBundle=join(root,'test.xcresult');await mkdir(resultBundle);
 const context={deviceId:'iphone-1',artifactSha256:'a'.repeat(64)};
 const report={...context,status:'COMMAND_SUCCEEDED',testRunSha256:'b'.repeat(64),resultBundle,counts:{passedTests:1}};
 const png=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(13,8);png.write('IHDR',12);png.writeUInt32BE(1,16);png.writeUInt32BE(1,20);
 const video=Buffer.alloc(24);video.writeUInt32BE(24);video.write('ftyp',4);video.write('isom',8);
 let includeVideo=true;
 const store=new MobileEvidenceStore(join(root,'sealed'));
 const execute=createIosEvidenceExecutor({execute:async()=>report,store,evidenceRoot:root,runner:async(cmd,args)=>{
  assert.equal(cmd,'xcrun');assert.equal(args[1],'export');
  await writeFile(join(args.at(-1),'screen.png'),png);
  if(includeVideo)await writeFile(join(args.at(-1),'clip.mp4'),video);
  return {exitCode:0};
 }});
 const good=await execute(context);assert.equal(good.evidenceStatus,'CHECKSUM_VERIFIED');assert.equal(await store.verify(good.evidenceManifest),true);
 includeVideo=false;assert.equal((await execute(context)).status,'BLOCKED');
});
