import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {deriveSchedulingManifest} from './hcie-scheduling-manifest.js';
import {runMapWorkerOnce} from './hcie-map-worker.js';
import {HcieReductionStore} from './hcie-reduction-store.js';
const sha=/^[a-f0-9]{64}$/;
const valid=v=>typeof v==='string'&&sha.test(v);
const integer=(v,a,b)=>Number.isSafeInteger(v)&&v>=a&&v<=b;
// Single trusted local supervisor. The supplied stores and analyzer must be
// dedicated to this revision and policy. Never publish test verdicts here.
export class HcieCoordinator {
 #db;#options;#binding;#busy=false;
 constructor(path,options={}){
  const {revisionSha256,policySha256,expectedInventoryDigest,expectedFileCount,maxChunkBytes=16384,maxChunks=100000,maxTasks=1000000,reductionPath,fanout=32}=options;
  if(typeof path!=='string'||!path||path===':memory:'||typeof reductionPath!=='string'||!reductionPath||reductionPath===':memory:'||path===reductionPath||![revisionSha256,policySha256,expectedInventoryDigest].every(valid)||!integer(expectedFileCount,1,10000000)||!integer(maxChunkBytes,1,65536)||!integer(maxChunks,1,1000000)||!integer(maxTasks,1,10000000)||!integer(fanout,2,128))throw Error('Invalid coordinator policy');
  this.#binding={revisionSha256,policySha256,expectedInventoryDigest,expectedFileCount,maxChunkBytes,maxChunks,maxTasks,reductionPath,fanout};
  this.#options={...options,...this.#binding};
  this.#db=new DatabaseSync(path);
  try{
   this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS coordinator(id INTEGER PRIMARY KEY CHECK(id=1),binding TEXT NOT NULL,phase TEXT NOT NULL,cursor TEXT NOT NULL DEFAULT '',ordinal INTEGER NOT NULL DEFAULT -1,manifest TEXT,report TEXT);`);
   const binding=JSON.stringify(this.#binding);
   this.#db.prepare("INSERT OR IGNORE INTO coordinator(id,binding,phase) VALUES(1,?,'INDEX')").run(binding);
   if(this.#state().binding!==binding)throw Error('Coordinator policy mismatch');
  }catch(e){this.#db.close();throw e;}
 }
 #state(){return this.#db.prepare('SELECT * FROM coordinator WHERE id=1').get();}
 #advance(phase,cursor='',ordinal=-1){this.#db.prepare('UPDATE coordinator SET phase=?,cursor=?,ordinal=? WHERE id=1').run(phase,cursor,ordinal);}
 #finish(report){this.#db.prepare("UPDATE coordinator SET phase='DONE',report=? WHERE id=1").run(JSON.stringify(report));return report;}
 status(){const s=this.#state();return {phase:s.phase,cursor:s.cursor,ordinal:s.ordinal,report:s.report?JSON.parse(s.report):null};}
 async step({inventory,store,chunks,queue,analyze,review,checkCapacity,signal,leaseMs=30000}={}){
  if(this.#busy)throw Error('Coordinator busy');
  if(typeof inventory?.page!=='function'||typeof store?.root!=='function'||typeof chunks?.index!=='function'||typeof chunks?.page!=='function'||!['enqueue','page','claim','complete'].every(k=>typeof queue?.[k]==='function')||typeof analyze!=='function'||typeof review!=='function'||review===analyze||typeof checkCapacity!=='function')throw Error('Invalid coordinator dependencies');
  this.#busy=true;
  try{
   const s=this.#state(),o=this.#options;
   if(s.phase==='DONE')return JSON.parse(s.report);
   const allowed=async()=>!signal?.aborted&&await checkCapacity()===true&&!signal?.aborted;
   if(!await allowed())return {status:'PAUSED',phase:s.phase};
   if(s.phase==='INDEX'){
    const p=inventory.page({after:s.cursor,limit:1}),entry=p.entries[0];
    if(!entry){this.#advance('MANIFEST');return {status:'PROGRESS',phase:'MANIFEST'};}
    if(entry.status==='INDEXED')await chunks.index({store,entry,maxChunkBytes:o.maxChunkBytes,maxChunks:o.maxChunks,signal,checkCapacity});
    if(signal?.aborted)return {status:'PAUSED',phase:s.phase};
    this.#advance('INDEX',entry.path);return {status:'PROGRESS',phase:'INDEX'};
   }
   if(s.phase==='MANIFEST'){
    const m=await deriveSchedulingManifest({...o,inventory,chunks,signal,checkCapacity});
    this.#db.prepare("UPDATE coordinator SET manifest=?,phase='SCHEDULE',cursor='',ordinal=-1 WHERE id=1").run(JSON.stringify(m));
    return {status:'PROGRESS',phase:'SCHEDULE'};
   }
   const m=JSON.parse(s.manifest);
   if(s.phase==='SCHEDULE'){
    // Cursor is the last completed file; ordinal tracks the next file's chunks.
    const p=inventory.page({after:s.cursor,limit:1}),entry=p.entries[0];
    if(!entry){this.#advance('ANALYZE');return {status:'PROGRESS',phase:'ANALYZE'};}
    if(entry.status!=='INDEXED'){this.#advance('SCHEDULE',entry.path);return {status:'PROGRESS',phase:'SCHEDULE'};}
    const cp=chunks.page({path:entry.path,after:s.ordinal,limit:128});
    const en=queue.enqueue({chunks,path:entry.path,expectedManifestSha256:cp.manifestSha256,after:s.ordinal,limit:128});
    if(en.nextCursor!==cp.nextCursor||en.hasMore!==cp.hasMore)throw Error('Scheduling checkpoint mismatch');
    if(en.hasMore)this.#advance('SCHEDULE',s.cursor,en.nextCursor);else this.#advance('SCHEDULE',entry.path);
    return {status:'PROGRESS',phase:'SCHEDULE'};
   }
   if(s.phase==='ANALYZE'){
    const r=await runMapWorkerOnce({queue,store,chunks,analyze,review,checkCapacity,signal,leaseMs});
    if(r.status==='IDLE'){
     // A queue with no claimable work may still have live leases. Reduction
     // checks terminal coverage before publication.
     this.#advance('REDUCE');return {status:'PROGRESS',phase:'REDUCE'};
    }
    return {status:r.status,phase:'ANALYZE',taskId:r.taskId??null};
   }
   if(s.phase!=='REDUCE')throw Error('Invalid coordinator phase');
   if(m.expectedCount===0){
    if(queue.page({after:0,limit:1}).entries.length)throw Error('Unexpected map tasks');
    return this.#finish({status:'NO_ANALYZABLE_CHUNKS',...m,rootId:null,analyzed:0,incomplete:0,analysisComplete:false,testingComplete:false});
   }
   const reduction=new HcieReductionStore(o.reductionPath,{...m,fanout:o.fanout});
   try{
    const ing=reduction.ingest({queue,limit:128});
    if(ing.status==='WAITING'){
     // Return to worker claim, which reconciles expired leases.
     this.#advance('ANALYZE');return {status:'WAITING',phase:'ANALYZE'};
    }
    if(ing.status==='PROGRESS')return {status:'PROGRESS',phase:'REDUCE'};
    if(ing.status==='READY_TO_SEAL'){
     if(queue.page({after:m.expectedCount,limit:1}).entries.length)throw Error('Unexpected map tasks');
     reduction.seal();
    }
    const r=reduction.reduceStep({maxGroups:32});
    if(r.status!=='REDUCED')return {status:'PROGRESS',phase:'REDUCE'};
    const root=reduction.getNode(r.rootId);
    if(!root||root.analyzed+root.incomplete!==m.expectedCount)throw Error('Root coverage mismatch');
    return this.#finish({...m,status:'REDUCED',rootId:r.rootId,analyzed:root.analyzed,incomplete:root.incomplete,mapCoverageComplete:true,analysisComplete:false,testingComplete:false,productCertified:false});
   }finally{reduction.close();}
  }finally{this.#busy=false;}
 }
 close(){if(this.#busy)throw Error('Coordinator busy');this.#db.close();}
}
