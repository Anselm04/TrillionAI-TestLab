import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {describeSourceChunks} from './hcie-chunks.js';
const sha=/^[a-f0-9]{64}$/;
const valid=v=>typeof v==='string'&&sha.test(v);
const hash=v=>createHash('sha256').update(v).digest('hex');
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const pathOK=p=>typeof p==='string'&&p.length>0&&p.length<=4096&&!p.includes('\\')&&!p.includes('\0')&&p.split('/').every(s=>s&&s!=='.'&&s!=='..');
// One operator-owned revision database. A single supervisor writes it;
// workers may page only sealed manifests. Never expose provisional rows.
export class HcieChunkStore {
 #db; #revision; #busy=false;
 constructor(path,{revisionSha256}={}){
  if(typeof path!=='string'||!path||path===':memory:'||!valid(revisionSha256))throw Error('Persistent revision database required');
  this.#revision=revisionSha256;this.#db=new DatabaseSync(path);
  try{
   this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS chunk_meta(id INTEGER PRIMARY KEY CHECK(id=1),revision TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chunk_files(path TEXT PRIMARY KEY,source TEXT NOT NULL,bytes INTEGER NOT NULL,chunk_bytes INTEGER NOT NULL,sealed INTEGER NOT NULL DEFAULT 0,digest TEXT,count INTEGER);
    CREATE TABLE IF NOT EXISTS chunk_rows(path TEXT NOT NULL,idx INTEGER NOT NULL,id TEXT NOT NULL UNIQUE,body TEXT NOT NULL,PRIMARY KEY(path,idx),FOREIGN KEY(path) REFERENCES chunk_files(path));`);
   this.#db.prepare('INSERT OR IGNORE INTO chunk_meta VALUES(1,?)').run(revisionSha256);
   if(this.#db.prepare('SELECT revision FROM chunk_meta WHERE id=1').get().revision!==revisionSha256)throw Error('Revision mismatch');
  }catch(e){this.#db.close();throw e;}
 }
 #file(path){return this.#db.prepare('SELECT * FROM chunk_files WHERE path=?').get(path);}
 #validate(d,path,f,index,offset){
  const {id,...body}=d;
  if(d.revisionSha256!==this.#revision||d.sourcePath!==path||d.sourceHash!==f.source||d.index!==index||d.startByte!==offset||!integer(d.endByte,offset+1,Math.min(f.bytes,offset+f.chunk_bytes))||!integer(d.startLine,1,f.bytes+1)||!integer(d.endLine,d.startLine,f.bytes+1)||!valid(d.chunkSha256)||!valid(id)||hash(JSON.stringify(body))!==id)throw Error('Invalid chunk descriptor');
 }
 async index({store,entry,maxChunkBytes=16384,maxChunks=100000,signal,checkCapacity}={}){
  if(this.#busy)throw Error('Chunk writer busy');
  if(!pathOK(entry?.path)||entry.status!=='INDEXED'||!valid(entry.sha256)||!integer(entry.bytes,0,2147483648)||!integer(maxChunkBytes,1,65536)||!integer(maxChunks,1,1000000)||typeof checkCapacity!=='function')throw Error('Invalid chunk indexing request');
  const path=entry.path;this.#busy=true;
  try{
   this.#db.prepare('INSERT OR IGNORE INTO chunk_files(path,source,bytes,chunk_bytes) VALUES(?,?,?,?)').run(path,entry.sha256,entry.bytes,maxChunkBytes);
   const f=this.#file(path);
   if(f.source!==entry.sha256||f.bytes!==entry.bytes||f.chunk_bytes!==maxChunkBytes)throw Error('Conflicting file identity');
   let count=0,offset=0;
   const get=this.#db.prepare('SELECT body FROM chunk_rows WHERE path=? AND idx=?');
   const insert=this.#db.prepare('INSERT INTO chunk_rows(path,idx,id,body) VALUES(?,?,?,?)');
   const report=await describeSourceChunks({store,entry,revisionSha256:this.#revision,maxChunkBytes,maxChunks,signal,checkCapacity,onChunk:d=>{
    this.#validate(d,path,f,count,offset);
    const encoded=JSON.stringify(d),old=get.get(path,count);
    if(old){if(old.body!==encoded)throw Error('Conflicting stored chunk');}
    else{if(f.sealed)throw Error('Sealed manifest missing chunk');insert.run(path,count,d.id,encoded);}
    count++;offset=d.endByte;
   }});
   if(signal?.aborted)throw Error('CHUNKING_PAUSED');
   this.#db.exec('BEGIN IMMEDIATE');
   try{
    const digest=createHash('sha256');let i=0,pos=0;
    for(const row of this.#db.prepare('SELECT body FROM chunk_rows WHERE path=? ORDER BY idx').iterate(path)){
     const d=JSON.parse(row.body);this.#validate(d,path,f,i,pos);digest.update(row.body+'\n');i++;pos=d.endByte;
    }
    const actual=digest.digest('hex');
    if(i!==count||i!==report.chunkCount||pos!==f.bytes||actual!==report.chunkManifestSha256||(f.sealed&&(f.digest!==actual||f.count!==i)))throw Error('Chunk manifest mismatch');
    this.#db.prepare('UPDATE chunk_files SET sealed=1,digest=?,count=? WHERE path=?').run(actual,i,path);
    this.#db.exec('COMMIT');return report;
   }catch(e){this.#db.exec('ROLLBACK');throw e;}
  }finally{this.#busy=false;}
 }
 page({path,after=-1,limit=128}={}){
  if(!pathOK(path)||!integer(after,-1,1000000)||!integer(limit,1,256))throw Error('Invalid chunk cursor');
  const f=this.#file(path);if(!f?.sealed)throw Error('Manifest not sealed');
  const rows=this.#db.prepare('SELECT idx,body FROM chunk_rows WHERE path=? AND idx>? ORDER BY idx LIMIT ?').all(path,after,limit+1);
  const entries=rows.slice(0,limit).map(r=>{
   const d=JSON.parse(r.body);this.#validate(d,path,f,r.idx,d.startByte);return d;
  });
  if(entries.length!==Math.min(limit,Math.max(0,f.count-after-1))||entries.some((d,i)=>d.index!==after+i+1))throw Error('Stored chunk coverage mismatch');
  return {entries,nextCursor:entries.at(-1)?.index??after,hasMore:rows.length>limit,manifestSha256:f.digest};
 }
 close(){if(this.#busy)throw Error('Chunk writer busy');this.#db.close();}
}
