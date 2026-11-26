import {observationDigest} from '../src/hcie-review-evidence.js';
const reviewed=(task,result)=>({...result,reviewEvidence:{accepted:true,reviewerId:'fixture-reviewer',reviewerDefinitionSha256:'d'.repeat(64),observationSha256:observationDigest(task,result),chunkSha256:task.chunkSha256}});
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {HcieSourceStore} from '../src/hcie-source-store.js';
import {HcieChunkStore} from '../src/hcie-chunk-store.js';
import {HcieMapQueue} from '../src/hcie-map-queue.js';
const revisionSha256='a'.repeat(64),policySha256='b'.repeat(64);
async function fixture(t,extra={}){
 const root=await mkdtemp(join(tmpdir(),'hcie-map-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const file=join(root,'input');await writeFile(file,'abcdefgh');
 const store=new HcieSourceStore(join(root,'objects')),entry={...await store.capture(file),path:'src/input',status:'INDEXED'};
 const chunks=new HcieChunkStore(join(root,'chunks.sqlite'),{revisionSha256});t.after(()=>chunks.close());
 const manifest=await chunks.index({store,entry,maxChunkBytes:4,checkCapacity:async()=>true});
 const db=join(root,'map.sqlite'),options={revisionSha256,policySha256,...extra};
 const q=new HcieMapQueue(db,options);
 return {q,db,options,input:{chunks,path:entry.path,expectedManifestSha256:manifest.chunkManifestSha256}};
}
const result=t=>reviewed(t,{status:'ANALYZED',summary:'Observed source only',chunkId:t.chunkId,chunkSha256:t.chunkSha256,policySha256:t.policySha256});
test('idempotent enqueue, bounded cursor, exclusive claims, bound results',async t=>{
 const {q,input}=await fixture(t);try{
 const a=q.enqueue({...input,limit:1});assert.equal(a.added,1);assert.equal(a.hasMore,true);
 assert.equal(q.enqueue({...input,limit:1}).added,0);assert.equal(q.enqueue({...input,after:a.nextCursor}).added,1);
 const x=q.claim(),y=q.claim();assert.notEqual(x.taskId,y.taskId);assert.equal(q.claim(),null);
 assert.throws(()=>q.complete({...x,result:{...result(x),chunkId:'c'.repeat(64)}}),/binding/);
 assert.equal(q.complete({...x,result:result(x)}),true);assert.equal(q.complete({...x,result:result(x)}),false);
 const page=q.page();assert.equal(page.entries[0].state,'ANALYZED');assert.equal(page.analysisComplete,false);
 }finally{q.close();}
});
test('restart retains queue; expired worker fenced and retry exhausted',async t=>{
 const f=await fixture(t,{maxAttempts:2});let q=f.q;
 try{q.enqueue({...f.input,limit:1});const old=q.claim({leaseMs:100});q.close();q=new HcieMapQueue(f.db,f.options);
 await delay(130);const next=q.claim({leaseMs:100});assert.equal(next.taskId,old.taskId);assert.equal(next.attempt,2);
 assert.equal(q.complete({...old,result:result(old)}),false);await delay(130);
 assert.equal(q.claim(),null);assert.equal(q.page().entries[0].state,'INCOMPLETE');
 }finally{q.close();}
});
test('quota transaction and manifest mismatch fail closed',async t=>{
 const {q,input}=await fixture(t,{maxTasks:1});try{
 assert.throws(()=>q.enqueue({...input,expectedManifestSha256:'d'.repeat(64)}),/binding/);
 assert.throws(()=>q.enqueue(input),/quota/);assert.equal(q.page().entries.length,0);
 assert.equal(q.enqueue({...input,limit:1}).added,1);
 }finally{q.close();}
});

test('direct completion without bound review evidence is rejected',async t=>{
 const {q,input}=await fixture(t);try{
 q.enqueue(input);const x=q.claim();
 assert.throws(()=>q.complete({...x,result:{...result(x),reviewEvidence:null}}),/review evidence/);
 assert.throws(()=>q.complete({...x,result:{...result(x),summary:'changed after review'}}),/review evidence/);
 assert.equal(q.complete({...x,result:result(x)}),true);
 assert.equal(q.page().entries[0].result.reviewEvidence.reviewerId,'fixture-reviewer');
 }finally{q.close();}
});
