import {canonicalReviewEvidence} from './hcie-review-evidence.js';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
const sha=/^[a-f0-9]{64}$/;
const valid=v=>typeof v==='string'&&sha.test(v);
const hash=v=>createHash('sha256').update(v).digest('hex');
const integer=(v,a,b)=>Number.isSafeInteger(v)&&v>=a&&v<=b;
// Operator-protected local database. Expected count and ordered task digest
// must come from an independently established, complete scheduling manifest.
export class HcieReductionStore {
 #db;#revision;#policy;#fanout;#expectedCount;#expectedDigest;
 constructor(path,{revisionSha256,policySha256,fanout=32,expectedCount,expectedTaskDigest}={}){
  if(typeof path!=='string'||!path||path===':memory:'||!valid(revisionSha256)||!valid(policySha256)||!valid(expectedTaskDigest)||!integer(expectedCount,1,10000000)||!integer(fanout,2,128))throw Error('Invalid reduction policy');
  this.#revision=revisionSha256;this.#policy=policySha256;this.#fanout=fanout;this.#expectedCount=expectedCount;this.#expectedDigest=expectedTaskDigest;
  this.#db=new DatabaseSync(path);
  try{
   this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS reduce_meta(id INTEGER PRIMARY KEY CHECK(id=1),binding TEXT NOT NULL,cursor INTEGER NOT NULL DEFAULT 0,sealed INTEGER NOT NULL DEFAULT 0,level INTEGER NOT NULL DEFAULT 0,position INTEGER NOT NULL DEFAULT 0,root TEXT);
    CREATE TABLE IF NOT EXISTS reduce_nodes(level INTEGER NOT NULL,position INTEGER NOT NULL,id TEXT UNIQUE NOT NULL,body TEXT NOT NULL,PRIMARY KEY(level,position));`);
   const binding=JSON.stringify({revisionSha256,policySha256,fanout,expectedCount,expectedTaskDigest});
   this.#db.prepare('INSERT OR IGNORE INTO reduce_meta(id,binding) VALUES(1,?)').run(binding);
   if(this.#meta().binding!==binding)throw Error('Reduction policy mismatch');
  }catch(e){this.#db.close();throw e;}
 }
 #meta(){return this.#db.prepare('SELECT * FROM reduce_meta WHERE id=1').get();}
 #tx(fn){this.#db.exec('BEGIN IMMEDIATE');try{const r=fn();this.#db.exec('COMMIT');return r;}catch(e){this.#db.exec('ROLLBACK');throw e;}}
 #insert(level,position,node){const body=JSON.stringify(node),id=hash(body);this.#db.prepare('INSERT INTO reduce_nodes(level,position,id,body) VALUES(?,?,?,?)').run(level,position,id,body);return id;}
 #decode(r){if(!r||hash(r.body)!==r.id)throw Error('Reduction node integrity mismatch');return {id:r.id,...JSON.parse(r.body)};}
 ingest({queue,limit=128}={}){
  if(typeof queue?.page!=='function'||!integer(limit,1,256))throw Error('Invalid reduction input');
  return this.#tx(()=>{
   const m=this.#meta();if(m.sealed)return {status:'SEALED',cursor:m.cursor};
   const p=queue.page({after:m.cursor,limit});
   if(!Array.isArray(p.entries)||p.entries.length>limit||typeof p.hasMore!=='boolean'||p.nextCursor!==(p.entries.at(-1)?.cursor??m.cursor))throw Error('Invalid queue page');
   let cursor=m.cursor;
   for(const e of p.entries){
    if(e.cursor!==cursor+1||e.cursor>this.#expectedCount||e.revisionSha256!==this.#revision||e.policySha256!==this.#policy||![e.taskId,e.chunkId,e.chunkSha256,e.manifestSha256].every(valid))throw Error('Task binding mismatch');
    if(!['ANALYZED','INCOMPLETE'].includes(e.state))break;
    const r=e.result;
    if((e.state==='ANALYZED'&&!r)||(r&&(r.status!==e.state||r.chunkId!==e.chunkId||r.chunkSha256!==e.chunkSha256||r.policySha256!==this.#policy||typeof r.summary!=='string'||r.summary.length>16384)))throw Error('Assessment mismatch');
    const reviewEvidence=e.state==='ANALYZED'?canonicalReviewEvidence(e,r,r.reviewEvidence):null;
    this.#insert(0,cursor,{kind:'LEAF',taskId:e.taskId,chunkId:e.chunkId,chunkSha256:e.chunkSha256,manifestSha256:e.manifestSha256,path:e.path,index:e.index,status:e.state,summary:r?.summary??null,reviewEvidence,analyzed:e.state==='ANALYZED'?1:0,incomplete:e.state==='INCOMPLETE'?1:0});
    cursor++;
   }
   this.#db.prepare('UPDATE reduce_meta SET cursor=? WHERE id=1').run(cursor);
   return {status:cursor===this.#expectedCount?'READY_TO_SEAL':cursor===m.cursor?'WAITING':'PROGRESS',cursor};
  });
 }
 seal(){
  return this.#tx(()=>{
   const m=this.#meta();if(m.sealed)return true;
   if(m.cursor!==this.#expectedCount)throw Error('Incomplete task coverage');
   const h=createHash('sha256');let count=0;
   for(const row of this.#db.prepare('SELECT * FROM reduce_nodes WHERE level=0 ORDER BY position').iterate()){
    const n=this.#decode(row);if(row.position!==count++||n.kind!=='LEAF')throw Error('Invalid leaf sequence');h.update(n.taskId+'\n');
   }
   if(count!==this.#expectedCount||h.digest('hex')!==this.#expectedDigest)throw Error('Task manifest mismatch');
   this.#db.prepare('UPDATE reduce_meta SET sealed=1 WHERE id=1').run();return true;
  });
 }
 reduceStep({maxGroups=32}={}){
  if(!integer(maxGroups,1,256))throw Error('Invalid reduction budget');
  return this.#tx(()=>{
   let m=this.#meta();if(!m.sealed)throw Error('Manifest not sealed');if(m.root)return {status:'REDUCED',rootId:m.root};
   let level=m.level,position=m.position,groups=0;
   let size=this.#db.prepare('SELECT COUNT(*) AS n FROM reduce_nodes WHERE level=?').get(level).n;
   while(groups<maxGroups){
    if(size===1&&position===0){
     const root=this.#decode(this.#db.prepare('SELECT * FROM reduce_nodes WHERE level=? AND position=0').get(level));
     if(root.analyzed+root.incomplete!==this.#expectedCount)throw Error('Root coverage mismatch');
     this.#db.prepare('UPDATE reduce_meta SET root=?,level=?,position=0 WHERE id=1').run(root.id,level);
     return {status:'REDUCED',rootId:root.id,analyzed:root.analyzed,incomplete:root.incomplete,testingComplete:false};
    }
    if(size<1||position>size)throw Error('Invalid reduction checkpoint');
    if(position===size){level++;position=0;size=this.#db.prepare('SELECT COUNT(*) AS n FROM reduce_nodes WHERE level=?').get(level).n;continue;}
    const rows=this.#db.prepare('SELECT * FROM reduce_nodes WHERE level=? AND position>=? ORDER BY position LIMIT ?').all(level,position,this.#fanout);
    if(rows.length!==Math.min(this.#fanout,size-position)||rows.some((r,i)=>r.position!==position+i))throw Error('Missing child nodes');
    const children=rows.map(r=>this.#decode(r));
    const analyzed=children.reduce((a,n)=>a+n.analyzed,0),incomplete=children.reduce((a,n)=>a+n.incomplete,0);
    this.#insert(level+1,Math.floor(position/this.#fanout),{kind:'GROUP',children:children.map(n=>n.id),analyzed,incomplete,status:incomplete?'INCOMPLETE':'ANALYZED'});
    position+=rows.length;groups++;
   }
   this.#db.prepare('UPDATE reduce_meta SET level=?,position=? WHERE id=1').run(level,position);
   return {status:'PROGRESS',level,position,groups};
  });
 }
 getNode(id){if(!valid(id))throw Error('Invalid node identity');const r=this.#db.prepare('SELECT * FROM reduce_nodes WHERE id=?').get(id);return r?this.#decode(r):null;}
 close(){this.#db.close();}
}
