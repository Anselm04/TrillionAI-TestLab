import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir,symlink} from 'node:fs/promises';
import {discoverIos,parseIosInventory} from '../src/ios-inventory.js';
const device={hardwareProperties:{platform:'iOS',udid:'00008101-ABCDEF',productType:'iPhone15,2'},connectionProperties:{pairingState:'paired'}};
const fixture={result:{devices:[device]}};
test('inventory does not infer physical qualification or readiness',async()=>{
 const result=await discoverIos({hostPlatform:'darwin',runner:async(command,args)=>{
  assert.equal(command,'xcrun');assert.deepEqual(args.slice(0,4),['devicectl','list','devices','--json-output']);
  await writeFile(args[4],JSON.stringify(fixture));return {exitCode:0};
 }});
 assert.equal(result.status,'DISCOVERED');assert.equal(result.devices[0].id,'00008101-ABCDEF');assert.equal(result.devices[0].available,false);
});
test('unsupported hosts and malformed inventory fail closed',async()=>{
 assert.equal((await discoverIos({hostPlatform:'linux',runner:()=>assert.fail()})).status,'UNSUPPORTED_HOST');
 assert.throws(()=>parseIosInventory({}));
 assert.throws(()=>parseIosInventory({result:{devices:[device,device]}}));
 assert.equal((await discoverIos({hostPlatform:'darwin',runner:async()=>({exitCode:1})})).status,'INFRASTRUCTURE_ERROR');
});

test('modern properties schema excludes simulators and preserves conservative readiness',()=>{
 const hardware={platform:'iOS',udid:'00008101-ABCDEF',productType:'iPhone15,2',reality:'physical'};
 const modern={properties:{hardware,connection:{pairingState:'paired'}}};
 const simulator={properties:{hardware:{...hardware,udid:'SIM-123',reality:'simulated'}}};
 const result=parseIosInventory({result:{devices:[modern,simulator]}});
 assert.equal(result.length,1);assert.equal(result[0].id,hardware.udid);assert.equal(result[0].available,false);
 assert.equal(result[0].kind,'unverified');
});

test('discovery rejects oversized, nonregular and symlink inventory output',async()=>{
 for(const create of [
  path=>writeFile(path,Buffer.alloc(2097153)),
  path=>mkdir(path),
  path=>symlink('/dev/null',path),
 ]){
  const result=await discoverIos({hostPlatform:'darwin',runner:async(_command,args)=>{await create(args[4]);return {exitCode:0};}});
  assert.deepEqual(result,{status:'INFRASTRUCTURE_ERROR',devices:[]});
 }
});
