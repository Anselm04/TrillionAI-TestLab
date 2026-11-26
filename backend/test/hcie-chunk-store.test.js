import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {HcieSourceStore} from '../src/hcie-source-store.js';
import {HcieChunkStore} from '../src/hcie-chunk-store.js';
const revisionSha256='a'.repeat(64);
async function fixture(t,data='abc\n123456789\nlast\n'){
 const root=await mkdtemp(join(tmpdir(),'hcie-store-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const source=join(root,'source'),db=join(root,'chunks.sqlite');
 await writeFile(source,data);
 const store=new HcieSourceStore(join(root,'objects')),entry={...await store.capture(source),path:'src/code.js',status:'INDEXED'};
 return {db,store,entry,maxChunkBytes:5,checkCapacity:async()=>true};
}
const open=db=>new HcieChunkStore(db,{revisionSha256});
test('sealed chunks persist, page and replay idempotently',async t=>{
 const f=await fixture(t);let s=open(f.db);
 try{const report=await s.index(f);assert.equal(report.chunkCount,4);s.close();s=open(f.db);
 const a=s.page({path:f.entry.path,limit:2}),b=s.page({path:f.entry.path,after:a.nextCursor,limit:2});
 assert.equal(a.hasMore,true);assert.equal(b.hasMore,false);assert.equal(b.entries.at(-1).endByte,f.entry.bytes);
 assert.equal(a.manifestSha256,report.chunkManifestSha256);assert.deepEqual(await s.index(f),report);
 }finally{s.close();}
});
test('interruption persists provisional rows but never exposes them; replay resumes',async t=>{
 const f=await fixture(t);let s=open(f.db),calls=0;
 try{await assert.rejects(s.index({...f,checkCapacity:async()=>++calls<3}),/CHUNKING_PAUSED/);
 assert.throws(()=>s.page({path:f.entry.path}),/not sealed/);
 s.close();s=open(f.db);assert.equal((await s.index(f)).chunkCount,4);
 }finally{s.close();}
});
test('conflicting source identity and wrong revision fail',async t=>{
 const f=await fixture(t),s=open(f.db);
 try{await s.index(f);await assert.rejects(s.index({...f,maxChunkBytes:4}),/Conflicting/);
 assert.throws(()=>new HcieChunkStore(f.db,{revisionSha256:'b'.repeat(64)}),/Revision mismatch/);
 }finally{s.close();}
});
test('tampered provisional source never seals',async t=>{
 const f=await fixture(t,'original'),s=open(f.db);
 try{const p=join(await f.store.root(),f.entry.sha256);await chmod(p,0o600);await writeFile(p,'modified');
 await assert.rejects(s.index(f),/SOURCE_INTEGRITY_FAILED/);assert.throws(()=>s.page({path:f.entry.path}),/not sealed/);
 }finally{s.close();}
});
test('empty file seals and missing sealed rows are detected',async t=>{
 const f=await fixture(t,''),s=open(f.db);
 try{assert.equal((await s.index(f)).chunkCount,0);assert.deepEqual(s.page({path:f.entry.path}).entries,[]);}finally{s.close();}
 const g=await fixture(t),v=open(g.db);
 try{await v.index(g);const db=new DatabaseSync(g.db);try{db.exec('DELETE FROM chunk_rows WHERE idx=0');}finally{db.close();}
 assert.throws(()=>v.page({path:g.entry.path}),/coverage/);await assert.rejects(v.index(g),/missing chunk/);
 }finally{v.close();}
});
