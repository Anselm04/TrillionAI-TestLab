import {createHash,createPublicKey,sign,verify} from 'node:crypto';
const sha=/^[a-f0-9]{64}$/;
const identifier=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function keyId(key){
 const pub=key.type==='public'?key:createPublicKey(key);
 if(pub.asymmetricKeyType!=='ed25519')throw new Error('Ed25519 key required');
 return createHash('sha256').update(pub.export({type:'spki',format:'der'})).digest('hex');
}
function payload({runId,deviceId,buildSha256,flowSha256,manifestSha256,journeyStatus,workerKeyId}){
 if(!identifier.test(runId??'')||!identifier.test(deviceId??'')||![buildSha256,flowSha256,manifestSha256,workerKeyId].every(x=>typeof x==='string'&&sha.test(x))||!['COMMAND_SUCCEEDED','COMMAND_FAILED','TIMEOUT','INFRASTRUCTURE_ERROR'].includes(journeyStatus))throw new Error('Invalid attestation');
 return {schemaVersion:1,runId,deviceId,buildSha256,flowSha256,manifestSha256,journeyStatus,workerKeyId};
}
export async function attestMobileRun({report,store,privateKey}){
 report=structuredClone(report);
 const m=report?.evidenceManifest;
 if(!m||!await store.verify(structuredClone(m))||m.deviceId!==report.deviceId||m.buildSha256!==report.buildSha256||m.flowSha256!==report.flowSha256)throw new Error('Evidence not verified');
 const body=payload({...m,manifestSha256:hash(m),journeyStatus:report.status,workerKeyId:keyId(privateKey)});
 return {body,signature:sign(null,Buffer.from(JSON.stringify(body)),privateKey).toString('base64')};
}
export async function reviewMobileRun({attestation,manifest,store,workerPublicKey,reviewerPrivateKey,expected}){
 attestation=structuredClone(attestation);
 manifest=structuredClone(manifest);
 expected=structuredClone(expected);
 const body=payload(attestation.body);
 if(JSON.stringify(body)!==JSON.stringify(attestation.body)||keyId(workerPublicKey)!==body.workerKeyId||!verify(null,Buffer.from(JSON.stringify(body)),workerPublicKey,Buffer.from(attestation.signature,'base64')))throw new Error('Invalid worker signature');
 const reviewerKeyId=keyId(reviewerPrivateKey);
 if(reviewerKeyId===body.workerKeyId)throw new Error('Independent key required');
 if(!expected||expected.runId!==body.runId||expected.deviceId!==body.deviceId||expected.buildSha256!==body.buildSha256||expected.flowSha256!==body.flowSha256)throw new Error('Unexpected run context');
 if(hash(manifest)!==body.manifestSha256||manifest.runId!==body.runId||manifest.deviceId!==body.deviceId||manifest.buildSha256!==body.buildSha256||manifest.flowSha256!==body.flowSha256||!await store.verify(structuredClone(manifest)))throw new Error('Artifact verification failed');
 const kinds=new Set(manifest.artifacts.map(x=>x.kind));
 const decision=body.journeyStatus==='COMMAND_SUCCEEDED'&&kinds.has('log')&&kinds.has('screenshot')?'EVIDENCE_ACCEPTED':'BLOCKED';
 const review={schemaVersion:1,attestationSha256:hash(attestation),reviewerKeyId,decision,deploymentAuthorized:false,productionReady:false};
 return {body:review,signature:sign(null,Buffer.from(JSON.stringify(review)),reviewerPrivateKey).toString('base64')};
}
export function verifyMobileReview({review,attestation,reviewerPublicKey}){
 try{
 const b=review.body;
 if(b.schemaVersion!==1||b.attestationSha256!==hash(attestation)||b.reviewerKeyId!==keyId(reviewerPublicKey)||b.reviewerKeyId===attestation.body.workerKeyId||!['EVIDENCE_ACCEPTED','BLOCKED'].includes(b.decision)||b.deploymentAuthorized!==false||b.productionReady!==false)return false;
 return verify(null,Buffer.from(JSON.stringify(b)),reviewerPublicKey,Buffer.from(review.signature,'base64'));
 }catch{return false;}
}
