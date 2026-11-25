import {DatabaseSync} from 'node:sqlite';
import {createHash,createPublicKey,sign,verify} from 'node:crypto';
const sha=/^[a-f0-9]{64}$/;
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const zero='0'.repeat(64);
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const keyId=k=>createHash('sha256').update(k.export({type:'spki',format:'der'})).digest('hex');
const publicKey=k=>k?.type==='public'&&k.asymmetricKeyType==='ed25519';
const signed=(body,key)=>({body,signature:sign(null,Buffer.from(JSON.stringify(body)),key).toString('base64')});
function authentic(record,key){
 try{return typeof record.signature==='string'&&record.signature.length===88&&verify(null,Buffer.from(JSON.stringify(record.body)),key,Buffer.from(record.signature,'base64'));}catch{return false;}
}
// A separate trusted ledger service retains the signing key. A checkpoint must
// be retained outside this database; a local chain alone cannot detect rollback.
export class EvidenceLedger{
 #db;#key;#public;#id;#limit;
 constructor(path,{privateKey,maxEntries=100000}={}){
  if(typeof path!=='string'||!path.startsWith('/')||privateKey?.type!=='private'||privateKey.asymmetricKeyType!=='ed25519'||!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>1000000)throw Error('Invalid ledger configuration');
  this.#key=privateKey;this.#public=createPublicKey(privateKey);this.#id=keyId(this.#public);this.#limit=maxEntries;
  this.#db=new DatabaseSync(path);
  this.#db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS evidence_ledger(seq INTEGER PRIMARY KEY,run_id TEXT UNIQUE NOT NULL,record TEXT NOT NULL,hash TEXT NOT NULL);');
 }
 append({runId,manifestSha256,reviewSha256}={}){
  if(typeof runId!=='string'||!id.test(runId)||typeof manifestSha256!=='string'||!sha.test(manifestSha256)||typeof reviewSha256!=='string'||!sha.test(reviewSha256))throw Error('Invalid evidence identity');
  this.#db.exec('BEGIN IMMEDIATE');
  try{
   const prev=this.#db.prepare('SELECT seq,hash,record FROM evidence_ledger ORDER BY seq DESC LIMIT 1').get();
   if(prev&&(!authentic(JSON.parse(prev.record),this.#public)||digest(JSON.parse(prev.record))!==prev.hash||JSON.parse(prev.record).body.seq!==prev.seq))throw Error('Invalid ledger tail');
   const seq=(prev?.seq??0)+1;if(seq>this.#limit)throw Error('Ledger capacity reached');
   const body={version:1,seq,previous:prev?.hash??zero,runId,manifestSha256,reviewSha256,keyId:this.#id};
   const record=signed(body,this.#key);
   this.#db.prepare('INSERT INTO evidence_ledger VALUES (?,?,?,?)').run(seq,runId,JSON.stringify(record),digest(record));
   this.#db.exec('COMMIT');return record;
  }catch(e){this.#db.exec('ROLLBACK');throw e;}
 }
 records(){
  const rows=this.#db.prepare('SELECT seq,run_id,record,hash FROM evidence_ledger ORDER BY seq LIMIT ?').all(this.#limit+1);
  if(rows.length>this.#limit)throw Error('Ledger capacity exceeded');
  return rows.map(r=>{const item=JSON.parse(r.record);if(item.body.seq!==r.seq||item.body.runId!==r.run_id||digest(item)!==r.hash)throw Error('Stored row mismatch');return item;});
 }
 checkpoint(){
  const records=this.records(),result=verifyEvidenceLedger({records,publicKey:this.#public});
  if(!result.valid)throw Error('Ledger verification failed');
  return signed({version:1,count:records.length,head:result.head,keyId:this.#id},this.#key);
 }
 close(){this.#db.close();}
}
export function verifyEvidenceLedger({records,publicKey:key,checkpoint}={}){
 const bad=reason=>({valid:false,reason,productionReady:false,deploymentAuthorized:false});
 try{
  if(!Array.isArray(records)||records.length>1000000||!publicKey(key))return bad('INVALID_INPUT');
  const kid=keyId(key),runs=new Set();let head=zero;
  if(checkpoint&&(!authentic(checkpoint,key)||checkpoint.body.version!==1||checkpoint.body.keyId!==kid||!Number.isSafeInteger(checkpoint.body.count)||checkpoint.body.count<0||checkpoint.body.count>records.length||!sha.test(checkpoint.body.head)))return bad('INVALID_OR_ROLLED_BACK_CHECKPOINT');
  if(checkpoint?.body.count===0&&checkpoint.body.head!==zero)return bad('CHECKPOINT_MISMATCH');
  for(let i=0;i<records.length;i++){
   const r=records[i],b=r?.body;
   if(!b||b.version!==1||b.seq!==i+1||b.previous!==head||b.keyId!==kid||typeof b.runId!=='string'||!id.test(b.runId)||runs.has(b.runId)||!sha.test(b.manifestSha256)||!sha.test(b.reviewSha256)||!authentic(r,key))return bad('CHAIN_OR_SIGNATURE_INVALID');
   runs.add(b.runId);head=digest(r);
   if(checkpoint?.body.count===i+1&&checkpoint.body.head!==head)return bad('CHECKPOINT_MISMATCH');
  }
  return {valid:true,head,count:records.length,checkpointVerified:!!checkpoint,productionReady:false,deploymentAuthorized:false};
 }catch{return bad('VERIFICATION_ERROR');}
}
