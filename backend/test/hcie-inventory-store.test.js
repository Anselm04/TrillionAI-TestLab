import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {HcieInventoryStore} from '../src/hcie-inventory-store.js';
const revisionSha256='a'.repeat(64);
const file=i=>({path:'src/'+String(i).padStart(6,'0')+'.js',sha256:'b'.repeat(64),bytes:100,status:'INDEXED',reason:null});
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'hcie-inventory-')),path=join(dir,'inventory.sqlite');
 let store=new HcieInventoryStore(path,{revisionSha256});
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 return {path,get store(){return store;},reopen(){store.close();store=new HcieInventoryStore(path,{revisionSha256});}};
}
function manifest(n){const h=createHash('sha256').update(revisionSha256+'\n');for(let i=0;i<n;i++)h.update(JSON.stringify(file(i))+'\n');return {expectedFileCount:n,expectedDigest:h.digest('hex')};}
test('45,000 entries persist through bounded batches and resume',t=>{
 const f=fixture(t),n=45000;
 for(let i=0;i<n;i+=200){f.store.append(Array.from({length:Math.min(200,n-i)},(_,j)=>file(i+j)));if(i===20000)f.reopen();}
 assert.equal(f.store.append([file(0)]).added,0);
 const sealed=f.store.seal(manifest(n));assert.equal(sealed.fileCount,n);assert.equal(sealed.analysisComplete,false);
 assert.equal(sealed.fileStatusCounts.INDEXED,n);
 assert.equal(sealed.knownBytes,String(n*100));
 assert.throws(()=>f.store.append([file(n)]));
});

test('sealed inventory preserves unavailable entries and unknown sizes explicitly',t=>{
 const f=fixture(t);
 const rows=[file(0),{...file(1),status:'UNREADABLE',sha256:null,bytes:null,reason:'fixture unavailable'},
  {...file(2),status:'EXCLUDED',reason:'fixture exclusion'}];
 f.store.append(rows);
 const h=createHash('sha256').update(revisionSha256+'\n');for(const row of rows)h.update(JSON.stringify(row)+'\n');
 const sealed=f.store.seal({expectedFileCount:3,expectedDigest:h.digest('hex')});
 assert.deepEqual(sealed.fileStatusCounts,{PENDING:0,INDEXED:1,UNREADABLE:1,EXCLUDED:1,UNSUPPORTED:0});
 assert.equal(sealed.knownBytes,'200');
 assert.equal(sealed.unknownSizeCount,1);
 assert.equal(sealed.analysisComplete,false);
 assert.equal(sealed.testingComplete,false);
});

test('committed inventory survives abrupt process exit without an orderly close',t=>{
 const f=fixture(t);
 const child=spawnSync(process.execPath,['--input-type=module','-e',`
   import {HcieInventoryStore} from ${JSON.stringify(new URL('../src/hcie-inventory-store.js',import.meta.url).href)};
   const store=new HcieInventoryStore(process.argv[1],{revisionSha256:process.argv[2]});
   store.append(JSON.parse(process.argv[3]));
   process.exit(17);
 `,f.path,revisionSha256,JSON.stringify([file(0),file(1)])],{timeout:10000,encoding:'utf8'});
 assert.equal(child.status,17,child.stderr);
 f.reopen();
 assert.deepEqual(f.store.page().entries,[file(0),file(1)]);
 assert.equal(f.store.append([file(0),file(1),file(2)]).added,1);
 assert.equal(f.store.seal(manifest(3)).fileCount,3);
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
