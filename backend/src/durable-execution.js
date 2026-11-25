import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const sha=/^[a-f0-9]{64}$/;
const valid=(x,r)=>typeof x==='string'&&r.test(x);
const hash=x=>createHash('sha256').update(x).digest('hex');
// A single trusted coordinator owns this database. Restart recovery is
// explicit and must occur only after the previous coordinator has stopped.
export class DurableExecution {
 #db; #profiles;
 constructor(path,{profiles}={}){
  if(typeof path!=='string'||!path||path===':memory:'||!Array.isArray(profiles)||!profiles.length||profiles.length>500)throw Error('Persistent database and registered profiles required');
  this.#profiles=new Map();
  for(const p of profiles){
   if(!valid(p?.id,id)||this.#profiles.has(p.id)||!valid(p.definitionSha256,sha)||typeof p.execute!=='function'||typeof p.verify!=='function')throw Error('Invalid profile');
   this.#profiles.set(p.id,Object.freeze({...p}));
  }
  this.#db=new DatabaseSync(path);
  this.#db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS execution_runs(
    id TEXT PRIMARY KEY, profile TEXT NOT NULL, definition TEXT NOT NULL,
    revision TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('QUEUED','RUNNING','VERIFIED','BLOCKED')),
    token TEXT, result TEXT, digest TEXT, created INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS execution_queue ON execution_runs(state,created,id);`);
 }
 submit({profileId,revisionSha256,expectedDefinitionSha256}={}){
  const p=this.#profiles.get(profileId);
  if(!p||!valid(revisionSha256,sha)||(expectedDefinitionSha256!==undefined&&expectedDefinitionSha256!==p.definitionSha256))throw Error('Unknown profile or revision');
  const runId=randomUUID();
  this.#db.prepare("INSERT INTO execution_runs(id,profile,definition,revision,state,created) VALUES (?,?,?,?,'QUEUED',?)").run(runId,profileId,p.definitionSha256,revisionSha256,Date.now());
  return this.get(runId);
 }
 get(runId){
  if(!valid(runId,id))return null;
  const r=this.#db.prepare('SELECT id,profile,definition,revision,state,result,digest FROM execution_runs WHERE id=?').get(runId);
  if(!r)return null;
  const integrity=r.result===null?r.digest===null:hash(r.result)===r.digest;
  return {runId:r.id,profileId:r.profile,definitionSha256:r.definition,revisionSha256:r.revision,state:integrity?r.state:'BLOCKED',result:integrity&&r.result?JSON.parse(r.result):null,integrity,productionReady:false,deploymentAuthorized:false};
 }
 // Bounded cursor scan. Use one journal per trusted project.
 historyPage({after=0,limit=100}={}){
  if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>500)throw Error('Invalid history page');
  const rows=this.#db.prepare('SELECT rowid AS sequence,id FROM execution_runs WHERE rowid>? ORDER BY rowid LIMIT ?').all(after,limit+1);
  const page=rows.slice(0,limit);
  return {entries:page.map(r=>({sequence:r.sequence,...this.get(r.id)})),nextCursor:page.at(-1)?.sequence??after,hasMore:rows.length>limit};
 }
 recoverInterrupted(){
  const result=JSON.stringify({reason:'INTERRUPTED_EXECUTION_REQUIRES_REVIEW'});
  return Number(this.#db.prepare("UPDATE execution_runs SET state='BLOCKED',token=NULL,result=?,digest=? WHERE state='RUNNING'").run(result,hash(result)).changes);
 }
 async runNext({checkCapacity,signal,expectedRunId}={}){
  if(typeof checkCapacity!=='function'||(expectedRunId!==undefined&&!valid(expectedRunId,id)))throw Error('Capacity gate required');
  if(signal?.aborted||await checkCapacity()!==true||signal?.aborted)return {status:'PAUSED'};
  const token=randomUUID();
  const row=this.#db.prepare("UPDATE execution_runs SET state='RUNNING',token=? WHERE id=(SELECT id FROM execution_runs WHERE state='QUEUED' AND (? IS NULL OR id=?) ORDER BY created,id LIMIT 1) AND NOT EXISTS(SELECT 1 FROM execution_runs WHERE state='RUNNING') RETURNING id,profile,definition,revision").get(token,expectedRunId??null,expectedRunId??null);
  if(!row)return {status:'IDLE_OR_BUSY'};
  const context={runId:row.id,profileId:row.profile,definitionSha256:row.definition,revisionSha256:row.revision};
  let state='BLOCKED',body={reason:'EXECUTION_OR_VERIFICATION_FAILED'};
  try{
   const p=this.#profiles.get(row.profile);
   if(!p||p.definitionSha256!==row.definition||signal?.aborted)throw Error('Profile mismatch or cancellation');
   const observation=await p.execute(structuredClone(context),signal);
   if(signal?.aborted||!observation||observation.runId!==row.id||observation.definitionSha256!==row.definition||observation.revisionSha256!==row.revision||!valid(observation.evidenceId,id)||!['PASSED','FAILED'].includes(observation.status))throw Error('Invalid observation');
   const encoded=JSON.stringify(observation);
   if(Buffer.byteLength(encoded)>262144)throw Error('Evidence summary too large');
   const canonical=JSON.parse(encoded);
   if(await p.verify(structuredClone(canonical),structuredClone(context))!==true||signal?.aborted)throw Error('Unverified');
   state='VERIFIED';body={observation:canonical};
  }catch{}
  const result=JSON.stringify(body);
  const updated=this.#db.prepare("UPDATE execution_runs SET state=?,result=?,digest=?,token=NULL WHERE id=? AND state='RUNNING' AND token=?").run(state,result,hash(result),row.id,token);
  return updated.changes===1?this.get(row.id):{status:'STALE_EXECUTION'};
 }
 close(){this.#db.close();}
}
