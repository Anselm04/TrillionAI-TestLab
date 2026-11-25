import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HcieInventoryStore} from '../src/hcie-inventory-store.js';
const revisionSha256='a'.repeat(64);
const file=i=>({path:'src/'+String(i).padStart(6,'0')+'.js',sha256:'b'.repeat(64),bytes:100,status:'INDEXED',reason:null});
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'hcie-inventory-')),path=join(dir,'inventory.sqlite');
 let store=new HcieInventoryStore(path,{revisionSha256});
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 return {get store(){return store;},reopen(){store.close();store=new HcieInventoryStore(path,{revisionSha256});}};
}
function manifest(n){const h=createHash('sha256').update(revisionSha256+'\n');for(let i=0;i<n;i++)h.update(JSON.stringify(file(i))+'\n');return {expectedFileCount:n,expectedDigest:h.digest('hex')};}
test('45,000 entries persist through bounded batches and resume',t=>{
 const f=fixture(t),n=45000;
 for(let i=0;i<n;i+=200){f.store.append(Array.from({length:Math.min(200,n-i)},(_,j)=>file(i+j)));if(i===20000)f.reopen();}
 assert.equal(f.store.append([file(0)]).added,0);
 const sealed=f.store.seal(manifest(n));assert.equal(sealed.fileCount,n);assert.equal(sealed.analysisComplete,false);
 assert.throws(()=>f.store.append([file(n)]));
});
test('conflicts roll back entire batch and mismatched manifests cannot seal',t=>{
 const f=fixture(t);f.store.append([file(0)]);
 assert.throws(()=>f.store.append([file(1),{...file(0),bytes:99}]));
 assert.equal(f.store.page().entries.length,1);
 assert.throws(()=>f.store.seal(manifest(2)));f.store.append([file(1)]);
 assert.equal(f.store.seal(manifest(2)).inventorySealed,true);
});
test('page cursor is bounded and invalid paths rejected',t=>{
 const f=fixture(t);f.store.append([file(2),file(0),file(1)]);
 const p=f.store.page({limit:2});assert.equal(p.hasMore,true);assert.deepEqual(f.store.page({after:p.nextCursor}).entries,[file(2)]);
 assert.throws(()=>f.store.append([{...file(3),path:'src//bad'}]));
 assert.throws(()=>f.store.page({limit:257}));
});
