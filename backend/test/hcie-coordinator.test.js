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
import {HcieCoordinator} from '../src/hcie-coordinator.js';
const revisionSha256='a'.repeat(64),policySha256='b'.repeat(64),hash=x=>createHash('sha256').update(x).digest('hex');
async function fixture(t,data='abcdefghijkl',gap=false){
 const root=await mkdtemp(join(tmpdir(),'hcie-coordinator-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=new HcieSourceStore(join(root,'objects')),inventory=new HcieInventoryStore(join(root,'inventory.sqlite'),{revisionSha256}),chunks=new HcieChunkStore(join(root,'chunks.sqlite'),{revisionSha256}),queue=new HcieMapQueue(join(root,'map.sqlite'),{revisionSha256,policySha256});
 t.after(()=>{queue.close();chunks.close();inventory.close();});
 const file=join(root,'source');await writeFile(file,data);
 const entries=[{path:'a',...await store.capture(file),status:'INDEXED',reason:null}];
 if(gap)entries.push({path:'b',sha256:null,bytes:null,status:'UNSUPPORTED',reason:'SYMLINK'});
 inventory.append(entries);
 const expectedInventoryDigest=hash(revisionSha256+'\n'+inventory.page().entries.map(e=>JSON.stringify(e)+'\n').join(''));
 inventory.seal({expectedFileCount:entries.length,expectedDigest:expectedInventoryDigest});
 const options={revisionSha256,policySha256,expectedFileCount:entries.length,expectedInventoryDigest,maxChunkBytes:4,fanout:2,reductionPath:join(root,'reduce.sqlite')};
 const path=join(root,'coordinator.sqlite'),seen=[];
 const deps={inventory,store,chunks,queue,review:async({scope,observationSha256})=>({accepted:true,observationSha256,chunkSha256:scope.descriptor.chunkSha256,reviewerId:'fixture-reviewer',reviewerDefinitionSha256:'d'.repeat(64)}),checkCapacity:async()=>true,analyze:async({bytes})=>{seen.push(bytes.toString());return {status:'ANALYZED',summary:'observed source'};}};
 return {path,options,deps,seen};
}
async function finish(c,deps){for(let i=0;i<100;i++){const r=await c.step(deps);if(c.status().phase==='DONE')return r;}throw Error('Coordinator did not finish');}
test('real local pipeline survives coordinator restart and reports gaps',async t=>{
 const f=await fixture(t,'abcdefghijkl',true);let c=new HcieCoordinator(f.path,f.options);
 try{
  for(let i=0;i<6;i++)await c.step(f.deps);
  c.close();c=new HcieCoordinator(f.path,f.options);
  const r=await finish(c,f.deps);assert.equal(r.status,'REDUCED');assert.equal(r.analyzed,3);assert.equal(r.unavailable,1);assert.equal(r.analysisComplete,false);assert.equal(r.testingComplete,false);
  assert.deepEqual(f.seen,['abcd','efgh','ijkl']);assert.deepEqual(await c.step(f.deps),r);
 }finally{c.close();}
});
test('empty indexed file produces explicit no-chunk report',async t=>{
 const f=await fixture(t,'');const c=new HcieCoordinator(f.path,f.options);
 try{const r=await finish(c,f.deps);assert.equal(r.status,'NO_ANALYZABLE_CHUNKS');assert.equal(r.empty,1);assert.equal(r.rootId,null);assert.equal(f.seen.length,0);}finally{c.close();}
});
test('capacity pause and mismatched policy do not advance state',async t=>{
 const f=await fixture(t),c=new HcieCoordinator(f.path,f.options);
 try{assert.equal((await c.step({...f.deps,checkCapacity:async()=>false})).status,'PAUSED');assert.equal(c.status().phase,'INDEX');assert.throws(()=>new HcieCoordinator(f.path,{...f.options,maxChunkBytes:5}),/policy mismatch/);}finally{c.close();}
});

test('coordinator reopens after every durable step and preserves rejected review as incomplete',async t=>{
 const f=await fixture(t,'abcdefghijkl');
 const reviewed=[];
 const deps={...f.deps,review:async({scope,observationSha256})=>{
  reviewed.push(scope.descriptor.index);
  return {accepted:scope.descriptor.index!==1,observationSha256,chunkSha256:scope.descriptor.chunkSha256,reviewerId:'fixture-reviewer',reviewerDefinitionSha256:'d'.repeat(64)};
 }};
 let result;
 for(let i=0;i<100;i++){
  const c=new HcieCoordinator(f.path,f.options);
  try{
   const r=await c.step(deps);
   if(c.status().phase==='DONE'){result=r;break;}
  }finally{c.close();}
 }
 assert.ok(result,'Coordinator did not finish after repeated reopen');
 assert.equal(result.status,'REDUCED');
 assert.equal(result.analyzed,2);
 assert.equal(result.incomplete,1);
 assert.equal(result.analysisComplete,false);
 assert.equal(result.testingComplete,false);
 assert.deepEqual(reviewed,[0,1,2]);
 assert.deepEqual(f.seen,['abcd','efgh','ijkl']);
 const c=new HcieCoordinator(f.path,f.options);
 try{assert.deepEqual(await c.step(deps),result);}finally{c.close();}
});

test('mid-index and manifest resource refusal preserve checkpoints and resume',async t=>{
 const f=await fixture(t),c=new HcieCoordinator(f.path,f.options);
 try{
  let calls=0;
  const initial=c.status();
  assert.deepEqual(await c.step({...f.deps,checkCapacity:async()=>++calls<=2}),{status:'PAUSED',phase:'INDEX'});
  assert.deepEqual(c.status(),initial);
  await c.step(f.deps);
  await c.step(f.deps);
  assert.equal(c.status().phase,'MANIFEST');
  const before=c.status();calls=0;
  assert.deepEqual(await c.step({...f.deps,checkCapacity:async()=>++calls<=1}),{status:'PAUSED',phase:'MANIFEST'});
  assert.deepEqual(c.status(),before);
  const result=await finish(c,f.deps);
  assert.equal(result.analyzed,3);
  assert.equal(result.incomplete,0);
  assert.deepEqual(f.seen,['abcd','efgh','ijkl']);
 }finally{c.close();}
});
