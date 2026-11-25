import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseMemory,parseCpu,collectDeviceDiagnostics} from '../src/device-diagnostics.js';
test('parse only unambiguous Android samples',()=>{
 assert.equal(parseMemory(' TOTAL PSS: 12345 TOTAL RSS: 23456'),12345);
 assert.equal(parseMemory('missing'),null);
 assert.equal(parseMemory('TOTAL PSS: 1\nTOTAL PSS: 2'),null);
 assert.equal(parseCpu('  12.5% 123/com.test.app: 2% user','com.test.app'),12.5);
 assert.equal(parseCpu('  12% 123/com.test.app.other: 2% user','com.test.app'),null);
});
test('sample fixed device commands, no invented measurements',async()=>{
 const result=await collectDeviceDiagnostics({deviceId:'device-1',packageName:'com.test.app',runner:async(binary,args)=>{
  assert.equal(binary,'adb');assert.deepEqual(args.slice(0,4),['-s','device-1','shell','dumpsys']);
  return args[4]==='meminfo'?{exitCode:0,output:'TOTAL PSS: 1234'}:{exitCode:1,output:'unavailable'};
 }});
 assert.deepEqual(result.memoryPssKiB,{status:'OBSERVED',value:1234});
 assert.deepEqual(result.cpuPercent,{status:'NOT_OBSERVED',value:null});
 assert.equal(result.performanceCertified,false);
});
