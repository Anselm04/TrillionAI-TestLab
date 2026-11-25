import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { reviewMobileRun } from './signed-mobile-review.js';
const sha=/^[a-f0-9]{64}$/;
const identifier=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const valid=(v,p)=>typeof v==='string'&&p.test(v);

// Trusted reviewer-owned database. Never expose issuance to the worker.
export class ReviewChallengeStore {
 #db; #clock;
 constructor(path,{clock=Date.now}={}){
  if(typeof path!=='string'||!path||path===':memory:')throw new Error('Persistent database required');
  this.#clock=clock;this.#db=new DatabaseSync(path);
  this.#db.exec(`PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS review_challenges(
    challenge_id TEXT PRIMARY KEY,device_id TEXT NOT NULL,build_sha TEXT NOT NULL,flow_sha TEXT NOT NULL,
    expires_at INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0,1)),
    evidence_run_id TEXT UNIQUE
   );`);
 }
 issue({deviceId,buildSha256,flowSha256,ttlMs=600000}){
  if(!valid(deviceId,identifier)||!valid(buildSha256,sha)||!valid(flowSha256,sha)||!Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>3600000)throw new Error('Invalid challenge context');
  const challengeId=randomUUID(),expiresAt=this.#clock()+ttlMs;
  this.#db.prepare('INSERT INTO review_challenges(challenge_id,device_id,build_sha,flow_sha,expires_at) VALUES (?,?,?,?,?)').run(challengeId,deviceId,buildSha256,flowSha256,expiresAt);
  return {challengeId,deviceId,buildSha256,flowSha256,expiresAt};
 }
 expected(challengeId){
  if(!valid(challengeId,identifier))return null;
  const r=this.#db.prepare('SELECT * FROM review_challenges WHERE challenge_id=? AND consumed=0 AND expires_at>?').get(challengeId,this.#clock());
  return r?{challengeId,deviceId:r.device_id,buildSha256:r.build_sha,flowSha256:r.flow_sha,expiresAt:r.expires_at}:null;
 }
 consume({challengeId,runId,deviceId,buildSha256,flowSha256}){
  if(!valid(challengeId,identifier)||!valid(runId,identifier)||!valid(deviceId,identifier)||!valid(buildSha256,sha)||!valid(flowSha256,sha))return false;
  // Unique evidence ID plus atomic conditional update prevents concurrent/restarted replay.
  return this.#db.prepare('UPDATE OR IGNORE review_challenges SET consumed=1,evidence_run_id=? WHERE challenge_id=? AND consumed=0 AND expires_at>? AND device_id=? AND build_sha=? AND flow_sha=?').run(runId,challengeId,this.#clock(),deviceId,buildSha256,flowSha256).changes===1;
 }
 close(){this.#db.close();}
}

// Reviewer owns both the challenge store and reviewer key. A signed response is
// returned only once, after evidence verification and atomic consumption.
export function createReplayProtectedReviewer({challenges,store,workerPublicKey,reviewerPrivateKey}){
 return async ({challengeId,attestation,manifest})=>{
  const expected=challenges.expected(challengeId);
  if(!expected||manifest?.reviewChallengeId!==challengeId)throw new Error('Challenge unavailable or mismatched');
  const review=await reviewMobileRun({attestation,manifest,store,workerPublicKey,reviewerPrivateKey,expected:{...expected,runId:manifest.runId}});
  if(!challenges.consume({...expected,runId:manifest.runId}))throw new Error('Challenge consumed or evidence replayed');
  return review;
 };
}
