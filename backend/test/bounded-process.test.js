import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runBoundedProcess} from '../src/bounded-process.js';
const run=(code,options={})=>runBoundedProcess({binary:process.execPath,args:['-e',code],...options});
test('successful and failing commands preserve exit status',async()=>{
 const ok=await run('console.log("ok")');assert.equal(ok.status,'COMMAND_SUCCEEDED');assert.match(ok.output,/ok/);
 const bad=await run('process.exit(3)');assert.equal(bad.status,'COMMAND_FAILED');assert.equal(bad.exitCode,3);
});
test('timeout terminates a nonresponsive trusted process',async()=>{
 const result=await run('setInterval(()=>{},1000)',{timeoutMs:100});
 assert.equal(result.status,'TIMEOUT');assert.equal(result.terminationConfirmed,true);assert.ok(result.elapsedMs<6000);
});
test('cancellation terminates the direct child',async()=>{
 const controller=new AbortController();
 const pending=run('setInterval(()=>{},1000)',{signal:controller.signal});
 setTimeout(()=>controller.abort(),100);
 assert.equal((await pending).status,'CANCELLED');
});
test('output is bounded and relative executable paths rejected',async()=>{
 const r=await run('process.stdout.write("a".repeat(10000))',{outputLimit:100});
 assert.equal(r.output.length,100);assert.equal(r.outputTruncated,true);
 assert.throws(()=>runBoundedProcess({binary:'node'}));
});
