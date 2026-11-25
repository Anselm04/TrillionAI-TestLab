import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {createInventory} from './hcie.js';
const sha=/^[a-f0-9]{64}$/;
// One trusted immutable revision per database. The upstream snapshotter must
// independently enumerate source and establish the expected inventory.
export class HcieInventoryStore{
 #db;#revision;
 constructor(path,{revisionSha256}={}){
  if(typeof path!=='string'||!path||path===':memory:'||typeof revisionSha256!=='string'||!sha.test(revisionSha256))throw Error('Persistent revision-bound inventory required');
  this.#revision=revisionSha256;
  this.#db=new DatabaseSync(path);
  try{
   this.#db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS hcie_meta(id INTEGER PRIMARY KEY CHECK(id=1),revision TEXT NOT NULL,sealed INTEGER NOT NULL DEFAULT 0,digest TEXT); CREATE TABLE IF NOT EXISTS hcie_files(path TEXT PRIMARY KEY,entry TEXT NOT NULL);");
   this.#db.prepare('INSERT OR IGNORE INTO hcie_meta(id,revision) VALUES(1,?)').run(revisionSha256);
   if(this.#db.prepare('SELECT revision FROM hcie_meta WHERE id=1').get().revision!==revisionSha256)throw Error('Revision mismatch');
  }catch(e){this.#db.close();throw e;}
 }
 append(entries){
  if(!Array.isArray(entries)||!entries.length||entries.length>256)throw Error('Invalid inventory batch');
  const canonical=createInventory(entries,this.#revision).files;
  this.#db.exec('BEGIN IMMEDIATE');
  try{
   if(this.#db.prepare('SELECT sealed FROM hcie_meta WHERE id=1').get().sealed)throw Error('Inventory sealed');
   const get=this.#db.prepare('SELECT entry FROM hcie_files WHERE path=?'),insert=this.#db.prepare('INSERT INTO hcie_files(path,entry) VALUES(?,?)');
   let added=0;
   for(const f of canonical){
    if(f.path.includes('\\')||f.path.includes('\0')||f.path.split('/').some(x=>!x)||!(f.reason===null||typeof f.reason==='string'&&f.reason.length<=1024))throw Error('Invalid source entry');
    const encoded=JSON.stringify(f),old=get.get(f.path);
    if(old){if(old.entry!==encoded)throw Error('Conflicting source entry');continue;}
    insert.run(f.path,encoded);added++;
   }
   this.#db.exec('COMMIT');return {added};
  }catch(e){this.#db.exec('ROLLBACK');throw e;}
 }
 page({after='',limit=100}={}){
  if(typeof after!=='string'||after.length>4096||!Number.isInteger(limit)||limit<1||limit>256)throw Error('Invalid inventory cursor');
  const rows=this.#db.prepare('SELECT path,entry FROM hcie_files WHERE path>? ORDER BY path COLLATE BINARY LIMIT ?').all(after,limit+1);
  const batch=rows.slice(0,limit);
  return {entries:batch.map(r=>JSON.parse(r.entry)),nextCursor:batch.at(-1)?.path??after,hasMore:rows.length>limit};
 }
 seal({expectedFileCount,expectedDigest}={}){
  if(!Number.isSafeInteger(expectedFileCount)||expectedFileCount<1||!sha.test(expectedDigest??''))throw Error('Independent manifest count and digest required');
  this.#db.exec('BEGIN IMMEDIATE');
  try{
   const hash=createHash('sha256').update(this.#revision+'\n');
   let count=0,after='';
   while(true){
    const p=this.page({after,limit:128});
    for(const entry of p.entries){hash.update(JSON.stringify(entry)+'\n');count++;}
    after=p.nextCursor;if(!p.hasMore)break;
   }
   const digest=hash.digest('hex');
   if(count!==expectedFileCount||digest!==expectedDigest)throw Error('Inventory manifest mismatch');
   this.#db.prepare('UPDATE hcie_meta SET sealed=1,digest=? WHERE id=1').run(digest);
   this.#db.exec('COMMIT');
   return {revisionSha256:this.#revision,fileCount:count,inventoryDigest:digest,inventorySealed:true,analysisComplete:false,testingComplete:false};
  }catch(e){this.#db.exec('ROLLBACK');throw e;}
 }
 close(){this.#db.close();}
}
