import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {createInventory} from './hcie.js';
const sha=/^[a-f0-9]{64}$/;
const hardEntryLimit=1000000;
// One trusted immutable revision per database. The upstream snapshotter must
// independently enumerate source and establish the expected inventory.
export class HcieInventoryStore{
 #db;#revision;#maxEntries;
 constructor(path,{revisionSha256,maxEntries}={}){
  if(typeof path!=='string'||!path||path===':memory:'||typeof revisionSha256!=='string'||!sha.test(revisionSha256))throw Error('Persistent revision-bound inventory required');
  if(maxEntries!==undefined&&(!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>hardEntryLimit))throw Error('Invalid inventory capacity policy');
  this.#revision=revisionSha256;
  this.#db=new DatabaseSync(path);
  try{
   this.#db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS hcie_meta(id INTEGER PRIMARY KEY CHECK(id=1),revision TEXT NOT NULL,sealed INTEGER NOT NULL DEFAULT 0,digest TEXT); CREATE TABLE IF NOT EXISTS hcie_files(path TEXT PRIMARY KEY,entry TEXT NOT NULL);");
   this.#db.prepare('INSERT OR IGNORE INTO hcie_meta(id,revision) VALUES(1,?)').run(revisionSha256);
   if(this.#db.prepare('SELECT revision FROM hcie_meta WHERE id=1').get().revision!==revisionSha256)throw Error('Revision mismatch');
   this.#db.exec('BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS hcie_inventory_limits(id INTEGER PRIMARY KEY CHECK(id=1),max_entries INTEGER NOT NULL);');
   this.#db.prepare('INSERT OR IGNORE INTO hcie_inventory_limits(id,max_entries) VALUES(1,?)').run(maxEntries??hardEntryLimit);
   this.#maxEntries=this.#db.prepare('SELECT max_entries FROM hcie_inventory_limits WHERE id=1').get().max_entries;
   if(!Number.isSafeInteger(this.#maxEntries)||this.#maxEntries<1||this.#maxEntries>hardEntryLimit||(maxEntries!==undefined&&maxEntries!==this.#maxEntries))throw Error('Inventory capacity policy mismatch');
   if(this.#db.prepare('SELECT COUNT(*) AS count FROM hcie_files').get().count>this.#maxEntries)throw Error('Inventory capacity reached');
   this.#db.exec('COMMIT');
  }catch(e){this.#db.close();throw e;}
 }
 append(entries){
  if(!Array.isArray(entries)||!entries.length||entries.length>256)throw Error('Invalid inventory batch');
  const canonical=createInventory(entries,this.#revision).files;
  this.#db.exec('BEGIN IMMEDIATE');
  try{
   if(this.#db.prepare('SELECT sealed FROM hcie_meta WHERE id=1').get().sealed)throw Error('Inventory sealed');
   const get=this.#db.prepare('SELECT entry FROM hcie_files WHERE path=?'),insert=this.#db.prepare('INSERT INTO hcie_files(path,entry) VALUES(?,?)');
   const existing=this.#db.prepare('SELECT COUNT(*) AS count FROM hcie_files').get().count;
   let added=0;
   for(const f of canonical){
    if(f.path.includes('\\')||f.path.includes('\0')||f.path.split('/').some(x=>!x)||!(f.reason===null||typeof f.reason==='string'&&f.reason.length<=1024))throw Error('Invalid source entry');
    const encoded=JSON.stringify(f),old=get.get(f.path);
    if(old){if(old.entry!==encoded)throw Error('Conflicting source entry');continue;}
    if(existing+added>=this.#maxEntries)throw Error('Inventory capacity reached');
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
  if(expectedFileCount>this.#maxEntries)throw Error('Inventory capacity reached');
  this.#db.exec('BEGIN IMMEDIATE');
  try{
   const hash=createHash('sha256').update(this.#revision+'\n');
   let count=0,after='',knownBytes=0n,unknownSizeCount=0;
   const fileStatusCounts={PENDING:0,INDEXED:0,UNREADABLE:0,EXCLUDED:0,UNSUPPORTED:0};
   while(true){
    const p=this.page({after,limit:128});
    for(const entry of p.entries){
     if(!Object.hasOwn(fileStatusCounts,entry.status))throw Error('Invalid inventory status');
     fileStatusCounts[entry.status]++;
     if(entry.bytes===null)unknownSizeCount++;
     else if(Number.isSafeInteger(entry.bytes)&&entry.bytes>=0)knownBytes+=BigInt(entry.bytes);
     else throw Error('Invalid inventory size');
     hash.update(JSON.stringify(entry)+'\n');count++;
     if(count>this.#maxEntries)throw Error('Inventory capacity reached');
    }
    after=p.nextCursor;if(!p.hasMore)break;
   }
   const digest=hash.digest('hex');
   if(count!==expectedFileCount||digest!==expectedDigest)throw Error('Inventory manifest mismatch');
   this.#db.prepare('UPDATE hcie_meta SET sealed=1,digest=? WHERE id=1').run(digest);
   this.#db.exec('COMMIT');
   return {revisionSha256:this.#revision,fileCount:count,inventoryDigest:digest,inventorySealed:true,fileStatusCounts,knownBytes:knownBytes.toString(),unknownSizeCount,maxEntries:this.#maxEntries,analysisComplete:false,testingComplete:false};
  }catch(e){this.#db.exec('ROLLBACK');throw e;}
 }
 close(){this.#db.close();}
}
