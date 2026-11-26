import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HcieSourceStore} from '../src/hcie-source-store.js';
import {HcieChunkStore} from '../src/hcie-chunk-store.js';
import {readVerifiedChunk} from '../src/hcie-chunk-reader.js';
const revision='a'.repeat(64);
async function setup(t){
 const root=await mkdtemp(join(tmpdir(),'hcie-reader-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const source=join(root,'input');const data=Buffer.from([0,255,10,65,66,67,10,90]);await writeFile(source,data);
 const store=new HcieSourceStore(join(root,'objects')),entry={...await store.capture(source),path:'src/input',status:'INDEXED'};
 const chunks=new HcieChunkStore(join(root,'chunks.sqlite'),{revisionSha256:revision});t.after(()=>chunks.close());
 const report=await chunks.index({store,entry,maxChunkBytes:4,checkCapacity:async()=>true});
 return {data,entry,options:{store,chunks,path:entry.path,expectedRevisionSha256:revision,expectedManifestSha256:report.chunkManifestSha256}};
}
test('retrieve exact original binary bytes for every sealed chunk',async t=>{
 const {options,data}=await setup(t);const page=options.chunks.page({path:options.path});const pieces=[];
 for(const d of page.entries){const result=await readVerifiedChunk({...options,index:d.index});assert.deepEqual(result.bytes,data.subarray(d.startByte,d.endByte));assert.equal(result.descriptor.id,d.id);pieces.push(result.bytes);}
 assert.deepEqual(Buffer.concat(pieces),data);
});
test('reject incorrect revision, manifest, missing index and cancelled reads',async t=>{
 const {options}=await setup(t);
 for(const change of [{expectedRevisionSha256:'b'.repeat(64)},{expectedManifestSha256:'c'.repeat(64)},{index:999}])await assert.rejects(readVerifiedChunk({...options,index:0,...change}),/binding/);
 const c=new AbortController();c.abort();await assert.rejects(readVerifiedChunk({...options,index:0,signal:c.signal}),/CANCELLED/);
});
test('detect mutated bytes in requested source range',async t=>{
 const {options,entry,data}=await setup(t);const p=join(await options.store.root(),entry.sha256);
 await chmod(p,0o600);const changed=Buffer.from(data);changed[0]=99;await writeFile(p,changed);
 await assert.rejects(readVerifiedChunk({...options,index:0}),/integrity/);
});
