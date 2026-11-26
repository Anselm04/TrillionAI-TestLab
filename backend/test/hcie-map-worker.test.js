import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HcieSourceStore} from '../src/hcie-source-store.js';
import {HcieChunkStore} from '../src/hcie-chunk-store.js';
import {HcieMapQueue} from '../src/hcie-map-queue.js';
import {runMapWorkerOnce} from '../src/hcie-map-worker.js';
const revisionSha256='a'.repeat(64),policySha256='b'.repeat(64);
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'hcie-worker-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const file=join(root,'input');await writeFile(file,'abcdefgh');
 const store=new HcieSourceStore(join(root,'objects')),entry={...await store.capture(file),path:'src/input',status:'INDEXED'};
 const chunks=new HcieChunkStore(join(root,'chunks.sqlite'),{revisionSha256});
 const queue=new HcieMapQueue(join(root,'map.sqlite'),{revisionSha256,policySha256});
 t.after(()=>{queue.close();chunks.close();});
 const manifest=await chunks.index({store,entry,maxChunkBytes:4,checkCapacity:async()=>true});
 queue.enqueue({chunks,path:entry.path,expectedManifestSha256:manifest.chunkManifestSha256});
 return {queue,store,chunks,entry,review:async({scope,observationSha256})=>({accepted:true,observationSha256,chunkSha256:scope.descriptor.chunkSha256}),checkCapacity:async()=>true};
}
test('worker obtains real verified bytes and persists analysis only',async t=>{
 const f=await fixture(t);const seen=[];
 const analyze=async({scope,bytes})=>{seen.push(bytes.toString());assert.equal(scope.revisionSha256,revisionSha256);return {status:'ANALYZED',summary:'source observation',productCertified:true};};
 assert.equal((await runMapWorkerOnce({...f,analyze})).status,'ANALYZED');
 assert.equal((await runMapWorkerOnce({...f,analyze})).status,'ANALYZED');
 assert.equal((await runMapWorkerOnce({...f,analyze})).status,'IDLE');
 assert.deepEqual(seen,['abcd','efgh']);
 assert.equal(f.queue.page().entries[0].result.productCertified,undefined);
});
test('tampered source never reaches analyzer',async t=>{
 const f=await fixture(t);const p=join(await f.store.root(),f.entry.sha256);await chmod(p,0o600);await writeFile(p,'Abcdefgh');
 let calls=0;const r=await runMapWorkerOnce({...f,analyze:async()=>{calls++;}});
 assert.equal(r.status,'INCOMPLETE');assert.equal(calls,0);
});
test('unavailable capacity or cancellation does not create successful analysis',async t=>{
 const f=await fixture(t);const analyze=async()=>({status:'ANALYZED',summary:'should not run'});
 assert.equal((await runMapWorkerOnce({...f,analyze,checkCapacity:async()=>false})).status,'PAUSED');
 const c=new AbortController();
 const r=await runMapWorkerOnce({...f,signal:c.signal,analyze:async()=>{c.abort();return {status:'ANALYZED',summary:'cancelled'};}});
 assert.equal(r.status,'INTERRUPTED');assert.equal(f.queue.page().entries[0].state,'LEASED');
});
test('invalid analyzer result becomes incomplete',async t=>{
 const f=await fixture(t);assert.equal((await runMapWorkerOnce({...f,analyze:async()=>({status:'PASSED',summary:'not an analysis status'})})).status,'INCOMPLETE');
});

test('review refusal and mismatched digest never accept observation',async t=>{
 const f=await fixture(t),analyze=async()=>({status:'ANALYZED',summary:'unverified'});
 assert.equal((await runMapWorkerOnce({...f,analyze,review:async()=>({accepted:false})})).status,'INCOMPLETE');
 assert.equal((await runMapWorkerOnce({...f,analyze,review:async()=>({accepted:true,observationSha256:'wrong'})})).status,'INCOMPLETE');
});
test('review receives independently read bytes, not analyzer-mutated buffer',async t=>{
 const f=await fixture(t);
 const r=await runMapWorkerOnce({...f,analyze:async({bytes})=>{bytes.fill(0);return {status:'ANALYZED',summary:'candidate'};},review:async({bytes,scope,observationSha256})=>{assert.equal(bytes.toString(),'abcd');return {accepted:true,observationSha256,chunkSha256:scope.descriptor.chunkSha256};}});
 assert.equal(r.status,'ANALYZED');
});
test('missing or identical reviewer fails before claim',async t=>{
 const f=await fixture(t),analyze=async()=>({status:'ANALYZED',summary:'candidate'});
 await assert.rejects(runMapWorkerOnce({...f,analyze,review:undefined}),/configuration/);
 await assert.rejects(runMapWorkerOnce({...f,analyze,review:analyze}),/configuration/);
 assert.equal(f.queue.page().entries[0].state,'QUEUED');
});
