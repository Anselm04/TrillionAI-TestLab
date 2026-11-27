import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {HcieSourceStore} from '../src/hcie-source-store.js';
import {HcieInventoryStore} from '../src/hcie-inventory-store.js';
import {ingestSourceInventory} from '../src/hcie-ingestion.js';
const revisionSha256='a'.repeat(64),hash=x=>createHash('sha256').update(x).digest('hex');
const record=(path,content)=>({path,sha256:hash(content),bytes:Buffer.byteLength(content),status:'INDEXED',reason:null});
function manifest(records){return {expectedFileCount:records.length,expectedDigest:hash(revisionSha256+'\n'+records.map(r=>JSON.stringify(r)+'\n').join(''))};}
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'hcie-ingest-')),sourceRoot=join(root,'source');await mkdir(sourceRoot);
 const inventory=new HcieInventoryStore(join(root,'inventory.sqlite'),{revisionSha256});
 t.after(async()=>{inventory.close();await rm(root,{recursive:true,force:true});});
 return {sourceRoot,inventory,store:new HcieSourceStore(join(root,'store')),checkCapacity:async()=>true,batchSize:1};
}
test('real files and explicit unsupported paths seal against independent manifest',async t=>{
 const f=await fixture(t);await writeFile(join(f.sourceRoot,'a'),'hello');await symlink('a',join(f.sourceRoot,'b'));
 const expectedManifest=manifest([record('a','hello'),{path:'b',sha256:null,bytes:null,status:'UNSUPPORTED',reason:'SYMLINK'}]);
 const r=await ingestSourceInventory({...f,expectedManifest});
 assert.equal(r.status,'INVENTORY_SEALED_WITH_GAPS');assert.equal(r.fileCount,2);assert.equal(r.analysisComplete,false);
 assert.equal(f.inventory.page().entries[1].sha256,null);
});
test('interrupted batches resume without duplicate inventory entries',async t=>{
 const f=await fixture(t);await writeFile(join(f.sourceRoot,'a'),'hello');await writeFile(join(f.sourceRoot,'b'),'world');
 const expectedManifest=manifest([record('a','hello'),record('b','world')]);let checks=0;
 const first=await ingestSourceInventory({...f,expectedManifest,checkCapacity:async()=>++checks<=4});
 assert.equal(first.status,'PAUSED');assert.equal(f.inventory.page().entries.length,1);
 const r=await ingestSourceInventory({...f,expectedManifest});assert.equal(r.status,'INVENTORY_SEALED');assert.equal(r.added,1);
});
test('incorrect independent manifest cannot seal the inventory',async t=>{
 const f=await fixture(t);await writeFile(join(f.sourceRoot,'a'),'hello');
 const r=await ingestSourceInventory({...f,expectedManifest:manifest([record('a','wrong')])});assert.equal(r.status,'INCOMPLETE');
 assert.equal(f.inventory.append([record('b','new')]).added,1);
});

test('capacity refusal during source capture pauses ingestion without sealing',async t=>{
 const f=await fixture(t);await writeFile(join(f.sourceRoot,'a'),'hello');
 const expectedManifest=manifest([record('a','hello')]);let checks=0;
 const paused=await ingestSourceInventory({...f,expectedManifest,checkCapacity:async()=>++checks<=1});
 assert.equal(paused.status,'PAUSED');
 assert.equal(f.inventory.page().entries.length,0);
 assert.equal((await ingestSourceInventory({...f,expectedManifest})).status,'INVENTORY_SEALED');
});
