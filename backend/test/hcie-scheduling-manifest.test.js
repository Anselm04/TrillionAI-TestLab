import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {HcieSourceStore} from '../src/hcie-source-store.js';
import {HcieInventoryStore} from '../src/hcie-inventory-store.js';
import {HcieChunkStore} from '../src/hcie-chunk-store.js';
import {HcieMapQueue} from '../src/hcie-map-queue.js';
import {deriveSchedulingManifest} from '../src/hcie-scheduling-manifest.js';
const revisionSha256='a'.repeat(64),policySha256='b'.repeat(64),hash=x=>createHash('sha256').update(x).digest('hex');
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'hcie-manifest-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=new HcieSourceStore(join(root,'objects')),inventory=new HcieInventoryStore(join(root,'inventory.sqlite'),{revisionSha256}),chunks=new HcieChunkStore(join(root,'chunks.sqlite'),{revisionSha256}),queue=new HcieMapQueue(join(root,'map.sqlite'),{revisionSha256,policySha256});
 t.after(()=>{queue.close();chunks.close();inventory.close();});
 const entries=[],reports=[];
 for(const [path,data] of [['a','abcdefgh'],['b',''],['c','xyz']]){
  const file=join(root,path);await writeFile(file,data);
  const entry={path,...await store.capture(file),status:'INDEXED',reason:null};entries.push(entry);
  reports.push(await chunks.index({store,entry,maxChunkBytes:4,checkCapacity:async()=>true}));
 }
 entries.push({path:'d',sha256:null,bytes:null,status:'UNSUPPORTED',reason:'SYMLINK'});
 inventory.append(entries);
 const expectedInventoryDigest=hash(revisionSha256+'\n'+inventory.page().entries.map(e=>JSON.stringify(e)+'\n').join(''));
 inventory.seal({expectedFileCount:entries.length,expectedDigest:expectedInventoryDigest});
 return {queue,reports,options:{inventory,chunks,revisionSha256,policySha256,expectedFileCount:entries.length,expectedInventoryDigest,checkCapacity:async()=>true}};
}
test('independent inventory-derived task digest matches canonical queue order and exposes gaps',async t=>{
 const f=await fixture(t),m=await deriveSchedulingManifest(f.options);
 assert.equal(m.expectedCount,3);assert.equal(m.empty,1);assert.equal(m.unavailable,1);assert.equal(m.sourceCoverageComplete,false);
 assert.equal(f.queue.page().entries.length,0);
 for(const r of f.reports)f.queue.enqueue({chunks:f.options.chunks,path:r.sourcePath,expectedManifestSha256:r.chunkManifestSha256});
 assert.equal(m.expectedTaskDigest,hash(f.queue.page().entries.map(e=>e.taskId+'\n').join('')));
});
test('incorrect inventory identity and task budget fail closed',async t=>{
 const f=await fixture(t);
 await assert.rejects(deriveSchedulingManifest({...f.options,expectedInventoryDigest:'c'.repeat(64)}),/Inventory manifest mismatch/);
 await assert.rejects(deriveSchedulingManifest({...f.options,maxTasks:2}),/budget/);
});
test('omitted chunks cannot establish coverage',async t=>{
 const f=await fixture(t),real=f.options.chunks;
 const chunks={page:opts=>{const p=real.page(opts);return opts.path==='a'?{...p,entries:p.entries.slice(0,1),nextCursor:0,hasMore:false}:p;}};
 await assert.rejects(deriveSchedulingManifest({...f.options,chunks}),/coverage/);
});
test('capacity denial and cancellation prevent manifest publication',async t=>{
 const f=await fixture(t);await assert.rejects(deriveSchedulingManifest({...f.options,checkCapacity:async()=>false}),/paused/);
 const c=new AbortController();c.abort();await assert.rejects(deriveSchedulingManifest({...f.options,signal:c.signal}),/paused/);
});
