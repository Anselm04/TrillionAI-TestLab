import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runProcess} from '../src/core.js';
test('binary capture preserves bytes and separates stderr',async()=>{
 const r=await runProcess(process.execPath,['-e','process.stdout.write(Buffer.from([0,255,128,10]));process.stderr.write("diagnostic")'],{binaryOutput:true,outputLimit:64});
 assert.equal(r.exitCode,0);assert.deepEqual(r.stdoutBytes,Buffer.from([0,255,128,10]));assert.equal(r.output,'diagnostic');assert.equal(r.outputTruncated,false);
});
test('binary output limit reports truncation',async()=>{
 const r=await runProcess(process.execPath,['-e','process.stdout.write(Buffer.alloc(100,255))'],{binaryOutput:true,outputLimit:10});
 assert.equal(r.stdoutBytes.length,10);assert.equal(r.outputTruncated,true);
});
