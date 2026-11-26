import {canonicalReviewEvidence} from './hcie-review-evidence.js';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
const sha=/^[a-f0-9]{64}$/;
const valid=v=>typeof v==='string'&&sha.test(v);
const hash=v=>createHash('sha256').update(v).digest('hex');
const integer=(v,a,b)=>Number.isSafeInteger(v)&&v>=a&&v<=b;
const pathOK=p=>typeof p==='string'&&p.length>0&&p.length<=4096&&!p.includes('\\')&&!p.includes('\0')&&p.split('/').every(x=>x&&x!=='.'&&x!=='..');
// Trusted coordinator, operator-protected DB, one revision and analysis policy.
// Expired leases are fenced. Map output is analysis, never a test verdict.
export class HcieMapQueue {
 #db;#revision;#policy;#attempts;#quota;
 constructor(path,{revisionSha256,policySha256,maxAttempts=3,maxTasks=1000000}={}){
  if(typeof path!=='string'||!path||path===':memory:'||!valid(revisionSha256)||!valid(policySha256)||!integer(maxAttempts,1,10)||!integer(maxTasks,1,10000000))throw Error('Invalid map queue policy');
  this.#revision=revisionSha256;this.#policy=policySha256;this.#attempts=maxAttempts;this.#quota=maxTasks;this.#db=new DatabaseSync(path);
  try{
   this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS map_meta(id INTEGER PRIMARY KEY CHECK(id=1),binding TEXT NOT NULL,total INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS map_tasks(seq INTEGER PRIMARY KEY,id TEXT NOT NULL UNIQUE,descriptor TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('QUEUED','LEASED','ANALYZED','INCOMPLETE')),attempt INTEGER NOT NULL DEFAULT 0,token TEXT,until_ms INTEGER,result TEXT,digest TEXT);
    CREATE INDEX IF NOT EXISTS map_ready ON map_tasks(state,seq);
    CREATE INDEX IF NOT EXISTS map_expiry ON map_tasks(state,until_ms);`);
   const binding=JSON.stringify({revisionSha256,policySha256,maxAttempts,maxTasks});
   this.#db.prepare('INSERT OR IGNORE INTO map_meta(id,binding) VALUES(1,?)').run(binding);
   if(this.#db.prepare('SELECT binding FROM map_meta WHERE id=1').get().binding!==binding)throw Error('Queue policy mismatch');
  }catch(e){this.#db.close();throw e;}
 }
 #tx(fn){this.#db.exec('BEGIN IMMEDIATE');try{const r=fn();this.#db.exec('COMMIT');return r;}catch(e){this.#db.exec('ROLLBACK');throw e;}}
 enqueue({chunks,path,expectedManifestSha256,after=-1,limit=128}={}){
  if(typeof chunks?.page!=='function'||!pathOK(path)||!valid(expectedManifestSha256)||!integer(after,-1,1000000)||!integer(limit,1,256))throw Error('Invalid map input');
  const page=chunks.page({path,after,limit});
  if(page.manifestSha256!==expectedManifestSha256||!Array.isArray(page.entries)||page.entries.length>limit||page.nextCursor!==(page.entries.at(-1)?.index??after)||typeof page.hasMore!=='boolean'||(page.hasMore&&page.entries.length!==limit))throw Error('Manifest binding mismatch');
  const tasks=page.entries.map((d,i)=>{
   const {id,...body}=d;
   if(d.revisionSha256!==this.#revision||d.sourcePath!==path||d.index!==after+i+1||!valid(id)||hash(JSON.stringify(body))!==id||!valid(d.chunkSha256)||!valid(d.sourceHash))throw Error('Invalid map descriptor');
   const descriptor=JSON.stringify({revisionSha256:this.#revision,policySha256:this.#policy,path,index:d.index,chunkId:id,chunkSha256:d.chunkSha256,manifestSha256:expectedManifestSha256});
   return {id:hash(descriptor),descriptor};
  });
  return this.#tx(()=>{
   let total=this.#db.prepare('SELECT total FROM map_meta WHERE id=1').get().total,added=0;
   const existing=this.#db.prepare('SELECT descriptor FROM map_tasks WHERE id=?'),insert=this.#db.prepare("INSERT INTO map_tasks(id,descriptor,state) VALUES(?,?,'QUEUED')");
   for(const t of tasks){
    const old=existing.get(t.id);if(old){if(old.descriptor!==t.descriptor)throw Error('Task identity conflict');continue;}
    if(total>=this.#quota)throw Error('Map quota exhausted');
    insert.run(t.id,t.descriptor);total++;added++;
   }
   this.#db.prepare('UPDATE map_meta SET total=? WHERE id=1').run(total);
   return {added,nextCursor:page.nextCursor,hasMore:page.hasMore};
  });
 }
 claim({leaseMs=30000}={}){
  if(!integer(leaseMs,100,300000))throw Error('Invalid lease');
  return this.#tx(()=>{
   const now=Date.now();
   this.#db.prepare("UPDATE map_tasks SET state=CASE WHEN attempt>=? THEN 'INCOMPLETE' ELSE 'QUEUED' END,token=NULL,until_ms=NULL WHERE state='LEASED' AND until_ms<=?").run(this.#attempts,now);
   const token=randomUUID(),expiresAt=now+leaseMs;
   const row=this.#db.prepare("UPDATE map_tasks SET state='LEASED',attempt=attempt+1,token=?,until_ms=? WHERE seq=(SELECT seq FROM map_tasks WHERE state='QUEUED' ORDER BY seq LIMIT 1) RETURNING id,descriptor,attempt").get(token,expiresAt);
   return row?{taskId:row.id,...JSON.parse(row.descriptor),attempt:row.attempt,token,expiresAt}:null;
  });
 }
 complete({taskId,token,result}={}){
  if(!valid(taskId)||typeof token!=='string'||!result||!['ANALYZED','INCOMPLETE'].includes(result.status)||typeof result.summary!=='string'||result.summary.length>16384||!valid(result.chunkId)||!valid(result.chunkSha256)||!valid(result.policySha256))throw Error('Invalid map result');
  // Store only allowlisted fields. No engine verdict or claimed certification.
  const candidate={status:result.status,summary:result.summary,chunkId:result.chunkId,chunkSha256:result.chunkSha256,policySha256:result.policySha256};
  return this.#tx(()=>{
   const row=this.#db.prepare("SELECT descriptor FROM map_tasks WHERE id=? AND state='LEASED' AND token=? AND until_ms>?").get(taskId,token,Date.now());
   if(!row)return false;
   const d=JSON.parse(row.descriptor);
   if(result.chunkId!==d.chunkId||result.chunkSha256!==d.chunkSha256||result.policySha256!==d.policySha256)throw Error('Result binding mismatch');
   const reviewEvidence=result.status==='ANALYZED'?canonicalReviewEvidence({taskId,...d},candidate,result.reviewEvidence):null;
   const body=JSON.stringify({...candidate,reviewEvidence});
   return this.#db.prepare("UPDATE map_tasks SET state=?,result=?,digest=?,token=NULL,until_ms=NULL WHERE id=? AND token=? AND until_ms>?").run(result.status,body,hash(body),taskId,token,Date.now()).changes===1;
  });
 }
 page({after=0,limit=128}={}){
  if(!integer(after,0,Number.MAX_SAFE_INTEGER)||!integer(limit,1,256))throw Error('Invalid queue cursor');
  const rows=this.#db.prepare('SELECT seq,id,descriptor,state,attempt,result,digest FROM map_tasks WHERE seq>? ORDER BY seq LIMIT ?').all(after,limit+1);
  const entries=rows.slice(0,limit).map(r=>{
   if(hash(r.descriptor)!==r.id||(r.result!==null&&hash(r.result)!==r.digest)||(r.result===null&&r.digest!==null))throw Error('Stored map integrity mismatch');
   const descriptor=JSON.parse(r.descriptor),result=r.result===null?null:JSON.parse(r.result);
   if(r.state==='ANALYZED')canonicalReviewEvidence({taskId:r.id,...descriptor},result,result?.reviewEvidence);
   return {cursor:r.seq,taskId:r.id,...descriptor,state:r.state,attempt:r.attempt,result};
  });
  return {entries,nextCursor:entries.at(-1)?.cursor??after,hasMore:rows.length>limit,analysisComplete:false,testingComplete:false};
 }
 close(){this.#db.close();}
}
