import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile,symlink,readdir,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {HcieSourceStore,snapshotSource} from '../src/hcie-source-store.js';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'hcie-source-')),sourceRoot=join(root,'source'),storage=join(root,'store');
 await mkdir(sourceRoot);t.after(()=>rm(root,{recursive:true,force:true}));
 return {sourceRoot,storage,store:new HcieSourceStore(storage)};
}
async function entries(options){const result=[];for await(const entry of snapshotSource(options))result.push(entry);return result;}
test('real source bytes stream into deduplicated verified objects',async t=>{
 const f=await fixture(t),data=Buffer.alloc(200000,65);
 await mkdir(join(f.sourceRoot,'nested'));await writeFile(join(f.sourceRoot,'a.js'),data);await writeFile(join(f.sourceRoot,'nested','b.js'),data);await writeFile(join(f.sourceRoot,'empty'),'');
 const records=await entries(f);assert.equal(records.length,3);
 const same=records.filter(r=>r.bytes===data.length);assert.equal(same.length,2);assert.equal(same[0].sha256,createHash('sha256').update(data).digest('hex'));assert.equal(same[0].sha256,same[1].sha256);
 assert.equal((await readdir(f.storage)).length,2);
 for(const r of records)assert.equal(await f.store.verify(r),true);
});
test('symlinks and oversized files explicitly remain outside indexed coverage',async t=>{
 const f=await fixture(t);await writeFile(join(f.sourceRoot,'large'),'123456');await symlink('/etc/passwd',join(f.sourceRoot,'link'));
 const records=await entries({...f,maxFileBytes:5});assert.equal(records.find(x=>x.path==='link').status,'UNSUPPORTED');assert.equal(records.find(x=>x.path==='large').status,'EXCLUDED');assert.equal(records.find(x=>x.path==='large').sha256,null);
});
test('byte and file budgets, cancellation and overlapping roots fail closed',async t=>{
 const f=await fixture(t);await writeFile(join(f.sourceRoot,'a'),'1234');await writeFile(join(f.sourceRoot,'b'),'5678');
 await assert.rejects(entries({...f,maxTotalBytes:5}),/TOTAL_BYTE_LIMIT/);await assert.rejects(entries({...f,maxFiles:1}),/FILE_COUNT_LIMIT/);
 const controller=new AbortController();controller.abort();await assert.rejects(entries({...f,signal:controller.signal}),/CANCELLED/);
 await assert.rejects(entries({...f,store:new HcieSourceStore(join(f.sourceRoot,'store'))}),/Separate canonical/);
});
test('existing corrupted object is not silently trusted',async t=>{
 const f=await fixture(t),path=join(f.sourceRoot,'a');await writeFile(path,'original');
 const object=await f.store.capture(path),stored=join(f.storage,object.sha256);await chmod(stored,0o600);await writeFile(stored,'modified');
 assert.equal(await f.store.verify(object),false);await assert.rejects(f.store.capture(path),/EXISTING_OBJECT_INVALID/);
 assert.equal((await readdir(f.storage)).some(x=>x.startsWith('.capture-')),false);
});
