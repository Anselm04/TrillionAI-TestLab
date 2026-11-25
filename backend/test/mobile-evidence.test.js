import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,symlink,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MobileEvidenceStore} from '../src/mobile-evidence.js';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'testlab-evidence-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 return {root,store:new MobileEvidenceStore(root)};
}
const context={deviceId:'device-1',buildSha256:'a'.repeat(64),flowSha256:'b'.repeat(64)};
test('capture and verify evidence, reject tampered artifact and manifest',async t=>{
 const {root,store}=await fixture(t);
 const m=await store.capture({...context,log:'test result'});
 assert.equal(await store.verify(m),true);
 assert.equal(m.independentReview,'PENDING');
 assert.equal(await store.verify({...m,deviceId:'other'}),false);
 await writeFile(join(root,m.runId,'execution.log'),'evil result');
 assert.equal(await store.verify(m),false);
});
test('reject invalid evidence and traversal',async t=>{
 const {store}=await fixture(t);
 await assert.rejects(store.capture({...context,screenshot:Buffer.from('not PNG')}));
 await assert.rejects(store.capture({...context,log:'x'.repeat(256001)}));
 await assert.rejects(store.capture(context));
 assert.equal(await store.verify({runId:'../etc',artifacts:[{}]}),false);
});
test('reject symlink substitution',async t=>{
 const {root,store}=await fixture(t);
 const m=await store.capture({...context,log:'test result'});
 const file=join(root,m.runId,'execution.log');
 await unlink(file);
 const replacement=join(root,'replacement');
 await writeFile(replacement,'test result');
 await symlink(replacement,file);
 assert.equal(await store.verify(m),false);
});
