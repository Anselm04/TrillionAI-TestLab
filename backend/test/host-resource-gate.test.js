import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectHostCapacity} from '../src/host-resource-gate.js';
const MiB=1048576;
test('resource admission defers low memory, disk and overloaded hosts',async()=>{
 const normal={free:2048*MiB,total:8192*MiB,cpus:4,load:1,disk:{bavail:1048576,bsize:4096}};
 const check=overrides=>inspectHostCapacity({path:'/tmp',sample:async()=>({...normal,...overrides})});
 assert.equal((await check({})).ready,true);
 assert.deepEqual((await check({free:256*MiB})).reasons,['LOW_MEMORY']);
 assert.deepEqual((await check({load:4})).reasons,['HIGH_LOAD']);
 assert.deepEqual((await check({disk:{bavail:1,bsize:4096}})).reasons,['LOW_DISK']);
 assert.equal((await inspectHostCapacity({path:'/tmp',sample:async()=>{throw Error('unavailable');}})).ready,false);
});

test('capacity measurements require internally consistent whole-byte and CPU values',async()=>{
 const valid={free:2048*MiB,total:8192*MiB,cpus:4,load:1,disk:{bavail:1048576,bsize:4096}};
 for(const change of [
  {free:valid.total+1}, {free:valid.free+.5}, {cpus:1.5},
  {disk:{bavail:1048576,bsize:0}}, {disk:{bavail:1048576.5,bsize:4096}},
  {disk:{bavail:Number.MAX_SAFE_INTEGER,bsize:4096}},
 ]){
  const result=await inspectHostCapacity({path:'/tmp',sample:async()=>({...valid,...change})});
  assert.deepEqual(result,{ready:false,reasons:['RESOURCE_SAMPLE_UNAVAILABLE']});
 }
 await assert.rejects(inspectHostCapacity({path:'/tmp',minDiskMiB:Number.MAX_SAFE_INTEGER}),/Invalid resource policy/);
});
