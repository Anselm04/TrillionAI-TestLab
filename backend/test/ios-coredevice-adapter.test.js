import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createIosCoreDeviceAdapter,parseInstalledApps} from '../src/ios-coredevice-adapter.js';
import {digestIosBundle} from '../src/ios-artifact.js';
test('CoreDevice installs and removes verified app on selected device',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'testlab-app-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const app=join(await realpath(dir),'Test.app');await mkdir(app);await writeFile(join(app,'Info.plist'),'fixture');
 const c={deviceId:'iphone-1',bundleId:'com.test.app',artifactPath:app,artifactSha256:await digestIosBundle(app)};
 let installed=false;const commands=[];
 const runner=async(binary,args)=>{
  if(binary==='codesign')return {exitCode:0,output:args[0]==='-d'?'Identifier=com.test.app\nTeamIdentifier=ABCDEFGHIJ\n':''};
  assert.equal(binary,'xcrun');assert.equal(args[args.indexOf('--device')+1],c.deviceId);commands.push(args);
  if(args[2]==='install')installed=true;
  if(args[2]==='uninstall')installed=false;
  await writeFile(args.at(-1),JSON.stringify({info:{outcome:'success'},result:{apps:installed?[{bundleIdentifier:c.bundleId}]:[]}}));
  return {exitCode:0};
 };
 const a=createIosCoreDeviceAdapter({teamId:'ABCDEFGHIJ',hostPlatform:'darwin',runner,execute:async()=>({status:'COMMAND_SUCCEEDED'})});
 assert.equal(await a.isInstalled(c),false);assert.equal(await a.install(c),true);
 assert.equal(await a.install(c),false);assert.equal(await a.uninstall(c),true);
 assert.equal(await a.isInstalled(c),false);
 assert.equal(commands.filter(x=>x[2]==='install').length,1);
});
test('ambiguous inventory and unsupported hosts are rejected',()=>{
 assert.throws(()=>parseInstalledApps({}));
 assert.throws(()=>parseInstalledApps({result:{apps:[{bundleIdentifier:'com.test.app'},{bundleIdentifier:'com.test.app'}]}}));
 assert.throws(()=>createIosCoreDeviceAdapter({hostPlatform:'linux'}));
});
