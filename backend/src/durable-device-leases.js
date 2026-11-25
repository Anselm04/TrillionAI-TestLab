import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

const idPattern=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function validId(id){if(typeof id!=='string'||!idPattern.test(id))throw new Error('Invalid identifier');}
export class DurableDeviceLeases {
  #db; #clock;
  constructor(path,{clock=Date.now}={}){
    if(typeof path!=='string'||!path||path===':memory:')throw new Error('Persistent database path required');
    this.#clock=clock;
    this.#db=new DatabaseSync(path);
    this.#db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS device_leases (
        device_id TEXT PRIMARY KEY, fence INTEGER NOT NULL DEFAULT 0,
        token TEXT, run_id TEXT, expires_at INTEGER,
        state TEXT NOT NULL CHECK(state IN ('IDLE','LEASED','QUARANTINED'))
      );`);
  }
  #transaction(fn){
    this.#db.exec('BEGIN IMMEDIATE');
    try{const result=fn();this.#db.exec('COMMIT');return result;}
    catch(e){this.#db.exec('ROLLBACK');throw e;}
  }
  register(deviceId){
    validId(deviceId);
    this.#db.prepare("INSERT OR IGNORE INTO device_leases(device_id,state) VALUES (?,'IDLE')").run(deviceId);
  }
  #expire(deviceId,now){
    this.#db.prepare("UPDATE device_leases SET state='QUARANTINED' WHERE device_id=? AND state='LEASED' AND expires_at<=?").run(deviceId,now);
  }
  acquire({deviceId,runId,durationMs=60000}){
    validId(deviceId);validId(runId);
    if(!Number.isSafeInteger(durationMs)||durationMs<1000||durationMs>3600000)throw new Error('Invalid duration');
    return this.#transaction(()=>{
      const now=this.#clock();this.#expire(deviceId,now);
      const token=randomUUID();
      const row=this.#db.prepare("UPDATE device_leases SET state='LEASED',fence=fence+1,token=?,run_id=?,expires_at=? WHERE device_id=? AND state='IDLE' RETURNING fence").get(token,runId,now+durationMs,deviceId);
      return row?{deviceId,runId,token,fence:row.fence,expiresAt:now+durationMs}:null;
    });
  }
  status(deviceId){
    validId(deviceId);
    return this.#transaction(()=>{
      this.#expire(deviceId,this.#clock());
      return this.#db.prepare('SELECT state FROM device_leases WHERE device_id=?').get(deviceId)?.state??'UNREGISTERED';
    });
  }
  heartbeat({deviceId,token,fence,durationMs=60000}){
    validId(deviceId);
    if(typeof token!=='string'||!Number.isSafeInteger(fence)||!Number.isSafeInteger(durationMs)||durationMs<1000||durationMs>3600000)throw new Error('Invalid heartbeat');
    return this.#transaction(()=>{
      const now=this.#clock();this.#expire(deviceId,now);
      return this.#db.prepare("UPDATE device_leases SET expires_at=? WHERE device_id=? AND token=? AND fence=? AND state='LEASED'").run(now+durationMs,deviceId,token,fence).changes===1;
    });
  }
  // Caller must be a trusted local supervisor and independently verify cleanup.
  // Expired leases cannot be released by the old worker; operator recovery is required.
  release({deviceId,token,fence,cleanupVerified=false}){
    validId(deviceId);
    if(cleanupVerified!==true||typeof token!=='string'||!Number.isSafeInteger(fence))return false;
    return this.#transaction(()=>{
      this.#expire(deviceId,this.#clock());
      return this.#db.prepare("UPDATE device_leases SET state='IDLE',token=NULL,run_id=NULL,expires_at=NULL WHERE device_id=? AND token=? AND fence=? AND state='LEASED'").run(deviceId,token,fence).changes===1;
    });
  }
  quarantine({deviceId,token,fence}){
    validId(deviceId);
    if(typeof token!=='string'||!Number.isSafeInteger(fence))return false;
    return this.#db.prepare("UPDATE device_leases SET state='QUARANTINED' WHERE device_id=? AND token=? AND fence=? AND state='LEASED'").run(deviceId,token,fence).changes===1;
  }
  // Recovery deliberately not exposed: require a future authenticated maintenance workflow.
  close(){this.#db.close();}
}
