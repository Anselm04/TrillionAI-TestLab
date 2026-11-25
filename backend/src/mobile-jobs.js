import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const valid=x=>typeof x==='string'&&id.test(x);
// Only operator-configured profiles are executable. No customer command,
// filesystem path, signing key or isolation override is accepted over the API.
export class MobileJobs{
 #db;#profiles;
 constructor(path,{profiles}={}){
  if(typeof path!=='string'||!path||path===':memory:'||!Array.isArray(profiles)||!profiles.length)throw Error('Persistent jobs and trusted profiles required');
  this.#profiles=new Map();
  for(const p of profiles){if(!valid(p?.id)||!['android','ios'].includes(p.platform)||this.#profiles.has(p.id))throw Error('Invalid profile');this.#profiles.set(p.id,p.platform);}
  this.#db=new DatabaseSync(path);
  this.#db.exec(`PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS mobile_jobs(id TEXT PRIMARY KEY,profile TEXT NOT NULL,platform TEXT NOT NULL,state TEXT NOT NULL,host TEXT,token TEXT,result TEXT,created INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS mobile_jobs_queue ON mobile_jobs(state,platform,created);`);
  // Interrupted execution is not automatically replayed.
  this.#db.prepare("UPDATE mobile_jobs SET state='BLOCKED',result=? WHERE state='RUNNING'").run(JSON.stringify({reason:'Coordinator restarted',productionReady:false,deploymentAuthorized:false}));
 }
 submit(profileId){
  if(!this.#profiles.has(profileId))throw Error('Unknown profile');
  const jobId=randomUUID(),platform=this.#profiles.get(profileId);
  this.#db.prepare("INSERT INTO mobile_jobs(id,profile,platform,state,created) VALUES (?,?,?,'QUEUED',?)").run(jobId,profileId,platform,Date.now());
  return {jobId,profileId,platform,state:'QUEUED'};
 }
 claim({host,platform}){
  if(!valid(host)||!['android','ios'].includes(platform))throw Error('Invalid worker');
  const token=randomUUID();
  const row=this.#db.prepare("UPDATE mobile_jobs SET state='RUNNING',host=?,token=? WHERE id=(SELECT id FROM mobile_jobs WHERE state='QUEUED' AND platform=? ORDER BY created,id LIMIT 1) RETURNING id,profile,platform").get(host,token,platform);
  return row?{jobId:row.id,profileId:row.profile,platform:row.platform,host,token}:null;
 }
 finish({jobId,host,token,result}){
  if(!valid(jobId)||!valid(host)||typeof token!=='string')return false;
  const state=result?.status==='EVIDENCE_REVIEWED'&&result.rackReleased===true?'REVIEWED':'BLOCKED';
  const body={status:state,reason:state==='BLOCKED'?'Execution, review or cleanup incomplete':null,productionReady:false,deploymentAuthorized:false};
  return this.#db.prepare("UPDATE mobile_jobs SET state=?,result=?,token=NULL WHERE id=? AND host=? AND token=? AND state='RUNNING'").run(state,JSON.stringify(body),jobId,host,token).changes===1;
 }
 get(jobId){
  if(!valid(jobId))return null;
  const r=this.#db.prepare('SELECT id,profile,platform,state,result FROM mobile_jobs WHERE id=?').get(jobId);
  return r?{jobId:r.id,profileId:r.profile,platform:r.platform,state:r.state,result:r.result?JSON.parse(r.result):null}:null;
 }
 close(){this.#db.close();}
}
// Trusted worker callback resolves profile to immutable local configuration and
// runs the appropriate reviewed supervisor. A rack lease is mandatory.
export async function runMobileJob({job,rackClient,execute}){
 if(!job||typeof rackClient?.claim!=='function'||typeof rackClient?.finish!=='function'||typeof execute!=='function')throw Error('Invalid worker configuration');
 let lease,report,rackReleased=false;
 try{
  ({lease}=await rackClient.claim({platform:job.platform,jobId:job.jobId}));
  if(!lease||lease.jobId!==job.jobId||lease.host!==job.host)throw Error('No matching rack lease');
  report=await execute({profileId:job.profileId,platform:job.platform,deviceId:lease.deviceId});
 }catch{report={status:'BLOCKED'};}
 finally{
  if(lease){try{
   const clean=report?.status==='EVIDENCE_REVIEWED'&&report.report?.cleanupVerified===true&&report.report?.leaseReleased===true;
   const result=await rackClient.finish({...lease,cleanupVerified:clean});
   rackReleased=clean&&result.accepted===true;
  }catch{rackReleased=false;}}
 }
 return {status:rackReleased?'EVIDENCE_REVIEWED':'BLOCKED',rackReleased,productionReady:false,deploymentAuthorized:false};
}
