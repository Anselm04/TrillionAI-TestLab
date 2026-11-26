import {observationDigest} from '../src/hcie-review-evidence.js';
const reviewed=(task,result)=>({...result,reviewEvidence:{accepted:true,reviewerId:'fixture-reviewer',reviewerDefinitionSha256:'d'.repeat(64),observationSha256:observationDigest(task,result),chunkSha256:task.chunkSha256}});
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {HcieReductionStore} from '../src/hcie-reduction-store.js';
const hash=x=>createHash('sha256').update(x).digest('hex'),revisionSha256='a'.repeat(64),policySha256='b'.repeat(64);
function fixture(t,count=9){
 const dir=mkdtempSync(join(tmpdir(),'hcie-reduce-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const rows=Array.from({length:count},(_,i)=>{const chunkId=hash('chunk'+i),chunkSha256=hash('bytes'+i),status=i===2?'INCOMPLETE':'ANALYZED';return {cursor:i+1,taskId:hash('task'+i),revisionSha256,policySha256,chunkId,chunkSha256,manifestSha256:'c'.repeat(64),path:'src/input',index:i,state:status,result:{status,summary:'observation '+i,chunkId,chunkSha256,policySha256}};});
 for(const row of rows)if(row.state==='ANALYZED')row.result=reviewed(row,row.result);
 const options={revisionSha256,policySha256,fanout:2,expectedCount:count,expectedTaskDigest:hash(rows.map(r=>r.taskId+'\n').join(''))};
 const queue={page:({after,limit})=>{const entries=rows.slice(after,after+limit);return {entries,nextCursor:entries.at(-1)?.cursor??after,hasMore:after+entries.length<rows.length};}};
 return {db:join(dir,'reduce.sqlite'),options,queue,rows};
}
test('bounded reduction persists across restarts and preserves every leaf reference',t=>{
 const f=fixture(t);let s=new HcieReductionStore(f.db,f.options);
 try{
  while(s.ingest({queue:f.queue,limit:2}).status!=='READY_TO_SEAL'){}
  s.seal();assert.equal(s.reduceStep({maxGroups:1}).status,'PROGRESS');s.close();s=new HcieReductionStore(f.db,f.options);
  let r;do{r=s.reduceStep({maxGroups:1});}while(r.status==='PROGRESS');
  assert.equal(r.analyzed,8);assert.equal(r.incomplete,1);
  const found=[];function walk(id){const n=s.getNode(id);if(n.kind==='LEAF'){found.push(n.taskId);if(n.status==='ANALYZED')assert.equal(n.reviewEvidence.reviewerId,'fixture-reviewer');}else n.children.forEach(walk);}walk(r.rootId);
  assert.deepEqual(found,f.rows.map(x=>x.taskId));
 }finally{s.close();}
});
test('pending task blocks manifest sealing and preserves cursor',t=>{
 const f=fixture(t);const s=new HcieReductionStore(f.db,f.options);
 try{f.rows[1].state='LEASED';assert.equal(s.ingest({queue:f.queue}).cursor,1);assert.equal(s.ingest({queue:f.queue}).status,'WAITING');assert.throws(()=>s.seal(),/Incomplete/);f.rows[1].state='ANALYZED';assert.equal(s.ingest({queue:f.queue}).status,'READY_TO_SEAL');assert.equal(s.seal(),true);}finally{s.close();}
});
test('incorrect expected manifest cannot seal',t=>{
 const f=fixture(t,1);const s=new HcieReductionStore(f.db,{...f.options,expectedTaskDigest:'d'.repeat(64)});
 try{s.ingest({queue:f.queue});assert.throws(()=>s.seal(),/manifest mismatch/);assert.throws(()=>s.reduceStep(),/not sealed/);}finally{s.close();}
});
test('single leaf becomes root without fabricating test completion',t=>{
 const f=fixture(t,1);const s=new HcieReductionStore(f.db,f.options);
 try{s.ingest({queue:f.queue});s.seal();const r=s.reduceStep();assert.equal(r.status,'REDUCED');assert.equal(r.testingComplete,false);assert.equal(s.getNode(r.rootId).kind,'LEAF');}finally{s.close();}
});
