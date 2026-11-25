import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const valid=x=>typeof x==='string'&&id.test(x);
// Single authoritative coordinator database on local disk, not shared over NFS.
// Host identity must be authenticated by the transport before calling this API.
export class RackCoordinator{
 #db;#clock;
 constructor(path,{clock=Date.now}={}){
  if(typeof path!=='string'||!path||path===':memory:')throw Error('Persistent coordinator required');
  this.#clock=clock;this.#db=new DatabaseSync(path);
  this.#db.exec(`PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS rack_hosts(id TEXT PRIMARY KEY,expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS rack_devices(id TEXT PRIMARY KEY,host TEXT NOT NULL,platform TEXT NOT NULL,state TEXT NOT NULL,seen INTEGER NOT NULL,fence INTEGER NOT NULL DEFAULT 0,token TEXT,job TEXT,expires INTEGER);
  CREATE UNIQUE INDEX IF NOT EXISTS rack_active_job ON rack_devices(job) WHERE job IS NOT NULL;`);
 }
 #tx(fn){this.#db.exec('BEGIN IMMEDIATE');try{const r=fn();this.#db.exec('COMMIT');return r;}catch(e){this.#db.exec('ROLLBACK');throw e;}}
 #expire(now){this.#db.prepare("UPDATE rack_devices SET state='QUARANTINED' WHERE state='LEASED' AND (expires<=? OR host IN (SELECT id FROM rack_hosts WHERE expires<=?))").run(now,now);}
 heartbeatHost(host,devices,{ttlMs=30000}={}){
  if(!valid(host)||!Array.isArray(devices)||devices.length>500||!Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>120000)throw Error('Invalid host inventory');
  const seen=new Set();
  for(const d of devices){if(!valid(d?.id)||!['android','ios'].includes(d.platform)||typeof d.ready!=='boolean'||seen.has(d.id))throw Error('Invalid device inventory');seen.add(d.id);}
  return this.#tx(()=>{
   const now=this.#clock();this.#expire(now);
   this.#db.prepare('INSERT INTO rack_hosts VALUES (?,?) ON CONFLICT(id) DO UPDATE SET expires=excluded.expires').run(host,now+ttlMs);
   this.#db.prepare('UPDATE rack_devices SET seen=0 WHERE host=?').run(host);
   for(const d of devices){
    const old=this.#db.prepare('SELECT host,platform FROM rack_devices WHERE id=?').get(d.id);
    if(old&&(old.host!==host||old.platform!==d.platform))throw Error('Device ownership conflict');
    this.#db.prepare("INSERT INTO rack_devices(id,host,platform,state,seen) VALUES (?,?,?,'IDLE',?) ON CONFLICT(id) DO UPDATE SET seen=excluded.seen").run(d.id,host,d.platform,d.ready?now+ttlMs:0);
   }
   this.#db.prepare("UPDATE rack_devices SET state='QUARANTINED' WHERE host=? AND state='LEASED' AND seen<=?").run(host,now);
   return true;
  });
 }
 claim({host,platform,jobId,ttlMs=60000}){
  if(!valid(host)||!valid(jobId)||!['android','ios'].includes(platform)||!Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>300000)throw Error('Invalid claim');
  return this.#tx(()=>{
   const now=this.#clock();this.#expire(now);
   if(this.#db.prepare('SELECT id FROM rack_devices WHERE job=?').get(jobId))return null;
   const d=this.#db.prepare("SELECT d.id FROM rack_devices d JOIN rack_hosts h ON h.id=d.host WHERE d.host=? AND d.platform=? AND d.state='IDLE' AND d.seen>? AND h.expires>? ORDER BY d.id LIMIT 1").get(host,platform,now,now);
   if(!d)return null;
   const token=randomUUID();const expiresAt=now+ttlMs;
   const row=this.#db.prepare("UPDATE rack_devices SET state='LEASED',fence=fence+1,token=?,job=?,expires=? WHERE id=? RETURNING fence").get(token,jobId,expiresAt,d.id);
   return {host,deviceId:d.id,jobId,token,fence:row.fence,expiresAt};
  });
 }
 finish({host,deviceId,token,fence,cleanupVerified}){
  if(!valid(host)||!valid(deviceId)||typeof token!=='string'||!Number.isSafeInteger(fence))return false;
  return this.#tx(()=>{
   this.#expire(this.#clock());
   const state=cleanupVerified===true?'IDLE':'QUARANTINED';
   return this.#db.prepare("UPDATE rack_devices SET state=?,token=NULL,job=NULL,expires=NULL WHERE host=? AND id=? AND token=? AND fence=? AND state='LEASED'").run(state,host,deviceId,token,fence).changes===1;
  });
 }
 inventory(){
  return this.#tx(()=>{const now=this.#clock();this.#expire(now);return this.#db.prepare("SELECT d.id,d.host,d.platform,d.state,CASE WHEN d.seen>? AND h.expires>? AND d.state='IDLE' THEN 1 ELSE 0 END AS available FROM rack_devices d JOIN rack_hosts h ON h.id=d.host ORDER BY d.id").all(now,now).map(r=>({...r,available:r.available===1}));});
 }
 close(){this.#db.close();}
}
