import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createXcuiExecutor,parseXcResultSummary} from '../src/xcuitest-execution.js';
test('XCUITest binds selected device and checks nonempty successful summary',async t=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),'xcui-')));t.after(()=>rm(dir,{recursive:true,force:true}));
 const testRunPath=join(dir,'suite.xctestrun');await writeFile(testRunPath,'fixture');
 const artifactSha256='a'.repeat(64),bundleId='com.test.app';
 const context={artifactSha256,bundleId,deviceId:'iphone-1'};
 let summary={result:'Passed',passedTests:2,failedTests:0,skippedTests:0,expectedFailures:0};
 const execute=createXcuiExecutor({hostPlatform:'darwin',testRunPath,testRunSha256:createHash('sha256').update('fixture').digest('hex'),artifactSha256,bundleId,evidenceRoot:dir,runner:async(binary,args)=>{
  if(binary==='xcodebuild'){assert.ok(args.includes('platform=iOS,id=iphone-1'));return {exitCode:0};}
  assert.equal(binary,'xcrun');return {exitCode:0,output:JSON.stringify(summary)};
 }});
 assert.equal((await execute(context)).status,'COMMAND_SUCCEEDED');
 summary={...summary,skippedTests:1};assert.equal((await execute(context)).status,'BLOCKED');
 assert.equal((await execute({...context,artifactSha256:'b'.repeat(64)})).status,'BLOCKED');
 await writeFile(testRunPath,'tampered');assert.equal((await execute(context)).status,'BLOCKED');
});
test('empty or malformed summary cannot pass',()=>{
 assert.throws(()=>parseXcResultSummary({result:'Passed'}));
 assert.equal(parseXcResultSummary({result:'Passed',passedTests:0,failedTests:0,skippedTests:0,expectedFailures:0}).passed,false);
});
