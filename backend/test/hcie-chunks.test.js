import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,writeFile,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HcieSourceStore} from '../src/hcie-source-store.js';
import {describeSourceChunks} from '../src/hcie-chunks.js';
const hash=x=>createHash('sha256').update(x).digest('hex'),revisionSha256='a'.repeat(64);
async function fixture(t,data){
 const root=await mkdtemp(join(tmpdir(),'hcie-chunks-')),path=join(root,'source');
 t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(path,data);const store=new HcieSourceStore(join(root,'store')),captured=await store.capture(path);
 return {store,entry:{...captured,path:'src/source.js',status:'INDEXED'},revisionSha256,checkCapacity:async()=>true};
}
async function collect(options){const chunks=[];const report=await describeSourceChunks({...options,onChunk:async c=>chunks.push(c)});return {chunks,report};}
test('bounded chunks preserve exact original bytes and inclusive line positions',async t=>{
 const data=Buffer.from('abc\n123456789\nlast\n'),f=await fixture(t,data);
 const {chunks,report}=await collect({...f,maxChunkBytes:5});
 assert.equal(report.status,'CHUNKS_VERIFIED');assert.equal(report.chunkCount,chunks.length);
 let pos=0;
 for(const c of chunks){assert.equal(c.startByte,pos);assert.ok(c.endByte-c.startByte<=5);assert.equal(c.chunkSha256,hash(data.subarray(c.startByte,c.endByte)));pos=c.endByte;}
 assert.equal(pos,data.length);assert.deepEqual(chunks.map(c=>[c.startLine,c.endLine]),[[1,1],[2,2],[2,2],[3,3]]);
 assert.deepEqual(await collect({...f,maxChunkBytes:5}),{chunks,report});
});
test('empty source and arbitrary binary bytes are accounted for exactly',async t=>{
 const empty=await fixture(t,Buffer.alloc(0));assert.equal((await collect(empty)).report.chunkCount,0);
 const data=Buffer.from([0,255,10,195,169,10,0]),f=await fixture(t,data);
 const r=await collect({...f,maxChunkBytes:2});assert.equal(r.chunks.at(-1).endByte,data.length);
 assert.equal(r.report.analysisComplete,false);
});
test('source tampering cannot produce a verified chunk manifest',async t=>{
 const f=await fixture(t,Buffer.from('original')),path=join(await f.store.root(),f.entry.sha256);
 await chmod(path,0o600);await writeFile(path,'modified');
 await assert.rejects(collect(f),/SOURCE_INTEGRITY_FAILED/);
});
test('capacity, cancellation, and chunk-count limits fail closed',async t=>{
 const f=await fixture(t,Buffer.from('abcdefgh'));
 await assert.rejects(collect({...f,maxChunkBytes:2,maxChunks:1}),/CHUNK_BUDGET/);
 await assert.rejects(collect({...f,checkCapacity:async()=>false}),/CHUNKING_PAUSED/);
 const c=new AbortController();c.abort();await assert.rejects(collect({...f,signal:c.signal}),/CHUNKING_PAUSED/);
});
