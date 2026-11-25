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
