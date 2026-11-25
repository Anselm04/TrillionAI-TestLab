import {createHash,generateKeyPairSync} from 'node:crypto';
import {attestMobileRun,reviewMobileRun} from './signed-mobile-review.js';
import {evaluateReleaseEvidence} from './release-evidence-gate.js';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
// Bounded, deterministic input mutation of synthetic evidence, never customer code.
// A thrown exception is not proof that a fault was correctly detected.
export async function calibrateMobileGate({evaluate=evaluateReleaseEvidence}={}){
 const worker=generateKeyPairSync('ed25519'),reviewer=generateKeyPairSync('ed25519');
 const manifest={runId:'calibration-run',deviceId:'fixture-phone',buildSha256:'a'.repeat(64),flowSha256:'b'.repeat(64),artifacts:[{kind:'log'},{kind:'screenshot'}]};
 const store={verify:async m=>digest(m)===digest(manifest)};
 const attestation=await attestMobileRun({report:{...manifest,status:'COMMAND_SUCCEEDED',evidenceManifest:manifest},store,privateKey:worker.privateKey});
 const review=await reviewMobileRun({attestation,manifest,store,workerPublicKey:worker.publicKey,reviewerPrivateKey:reviewer.privateKey,expected:manifest});
 const requirement={checkId:'fixture',deviceId:manifest.deviceId,buildSha256:manifest.buildSha256,flowSha256:manifest.flowSha256};
 const evidence={checkId:'fixture',manifest,attestation,review};
 const base={requirements:[requirement],evidence:[evidence],reviewerPublicKey:reviewer.publicKey,store};
 const cases=[
  ['valid-control',{},'REQUIRED_EVIDENCE_VERIFIED'],
  ['missing-evidence',{evidence:[]},'BLOCKED'],
  ['wrong-build',{requirements:[{...requirement,buildSha256:'c'.repeat(64)}]},'BLOCKED'],
  ['wrong-device',{requirements:[{...requirement,deviceId:'other-phone'}]},'BLOCKED'],
  ['wrong-flow',{requirements:[{...requirement,flowSha256:'d'.repeat(64)}]},'BLOCKED'],
  ['missing-video',{requirements:[{...requirement,requireVideo:true}]},'BLOCKED'],
  ['forged-signature',{evidence:[{...evidence,review:{...review,signature:'invalid'}}]},'BLOCKED'],
  ['replayed-evidence',{requirements:[requirement,{...requirement,checkId:'second'}],evidence:[evidence,{...evidence,checkId:'second'}]},'BLOCKED'],
  ['tampered-artifact',{store:{verify:async()=>false}},'BLOCKED']
 ];
 const observations=[];
 for(const [checkId,override,expected] of cases){
  try{
   const result=await evaluate({...base,...override});
   const actual=result?.status??'UNKNOWN';
   observations.push({checkId,expected,actual,status:actual===expected&&result?.deploymentAuthorized===false&&result?.productionReady===false?'DETECTED':'MISCLASSIFIED'});
  }catch{observations.push({checkId,expected,actual:'EXCEPTION',status:'INFRASTRUCTURE_ERROR'});}
 }
 return {schemaVersion:1,scope:'Synthetic mobile release-gate input mutation only',status:observations.every(o=>o.status==='DETECTED')?'CALIBRATION_PASSED':'CALIBRATION_FAILED',observations,productionReady:false,deploymentAuthorized:false};
}
