import {test} from 'node:test';
import assert from 'node:assert/strict';
import {guestArguments,runGuestProcess,bootIsolatedFixture} from '../src/guest-sandbox.js';
test('guest configuration denies network, host mounts and writable disk',()=>{
 const args=guestArguments({image:'/fixtures/boot.raw'});
 assert.equal(args[args.indexOf('-nic')+1],'none');
 assert.equal(args[args.indexOf('-m')+1],'512');
 assert.ok(args.includes('file=/fixtures/boot.raw,format=raw,if=virtio,readonly=on'));
 assert.ok(!args.includes('-virtfs'));
 assert.throws(()=>guestArguments({image:'/tmp/file,readonly=off'}));
 assert.throws(()=>guestArguments({image:'relative.raw'}));
});
test('process runner records separate streams and actual exit',async()=>{
 const r=await runGuestProcess(process.execPath,['-e','console.log("out");console.error("err");process.exit(3)']);
 assert.equal(r.exitCode,3);assert.equal(r.stdout.trim(),'out');assert.equal(r.stderr.trim(),'err');assert.equal(r.cleanupVerified,true);
});
test('process runner times out and kills its group',async()=>{
 const r=await runGuestProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:100});
 assert.equal(r.timedOut,true);assert.equal(r.cleanupVerified,true);
});
test('unapproved image never dispatches guest',async()=>{
 const r=await bootIsolatedFixture({image:'/nonexistent.raw',imageSha256:'invalid',runner:()=>{assert.fail('must not launch');}});
 assert.equal(r.status,'BLOCKED');
});
