import {createHash,createPublicKey,verify} from 'node:crypto';
const sha=/^[a-f0-9]{64}$/;
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const digest=b=>createHash('sha256').update(b).digest('hex');
const valid=(v,r)=>typeof v==='string'&&r.test(v);
const kinds=['sbom','vulnerability-scan','build-provenance'];
// Trusted policy and keys are supplied by the host, never by a submission.
// This is a TestLab-specific Ed25519 envelope, not a Cosign bundle parser.
export function verifySupplyChain({artifactSha256,revisionSha256,policy,evidence,nowMs=Date.now()}={}){
 if(!valid(artifactSha256,sha)||!valid(revisionSha256,sha)||!Number.isSafeInteger(nowMs)||!Number.isSafeInteger(policy?.maxAgeMs)||policy.maxAgeMs<1||policy.maxAgeMs>31536000000||!Array.isArray(evidence)||evidence.length>30||!policy.keys||!policy.requiredTools)throw Error('Invalid supply chain policy');
 const results=[],seen=new Set();
 for(const kind of kinds){
  const tool=policy.requiredTools[kind];
  if(!valid(tool,id))throw Error('Missing required tool');
  const candidates=evidence.filter(e=>e?.kind===kind);
  if(candidates.length!==1){results.push({kind,status:'INCOMPLETE',reason:'MISSING_OR_DUPLICATE_EVIDENCE'});continue;}
  const e=candidates[0];
  let status='UNVERIFIED',reason='INVALID_ENVELOPE';
  try{
   if(!valid(e.keyId,id)||!Object.hasOwn(policy.keys,e.keyId)||!Array.isArray(policy.keys[e.keyId].kinds)||!policy.keys[e.keyId].kinds.includes(kind)||!Buffer.isBuffer(e.payload)||e.payload.length>8*1024*1024||!Buffer.isBuffer(e.signature)||e.signature.length!==64)throw Error('Invalid envelope');
   const key=createPublicKey(policy.keys[e.keyId].publicKey);
   if(key.asymmetricKeyType!=='ed25519'||!verify(null,e.payload,key,e.signature))throw Error('Signature failed');
   const p=JSON.parse(e.payload.toString('utf8'));
   if(p.schemaVersion!==1||p.kind!==kind||p.tool!==tool||!valid(p.toolVersion,id)||p.artifactSha256!==artifactSha256||p.revisionSha256!==revisionSha256||!valid(p.evidenceId,id)||seen.has(p.evidenceId)||!Number.isSafeInteger(p.createdAtMs)||p.createdAtMs>nowMs||nowMs-p.createdAtMs>policy.maxAgeMs)throw Error('Binding failed');
   if(kind==='sbom'&&(!Number.isSafeInteger(p.packageCount)||p.packageCount<0||!valid(p.reportSha256,sha)))throw Error('Invalid SBOM');
   if(kind==='vulnerability-scan'&&(!valid(p.reportSha256,sha)||!valid(p.databaseSha256,sha)||!Number.isSafeInteger(p.databaseUpdatedAtMs)||p.databaseUpdatedAtMs>p.createdAtMs||nowMs-p.databaseUpdatedAtMs>policy.maxAgeMs||!Number.isSafeInteger(p.criticalCount)||p.criticalCount<0||!Number.isSafeInteger(p.highCount)||p.highCount<0||p.complete!==true))throw Error('Invalid scan');
   if(kind==='build-provenance'&&(!valid(p.buildDefinitionSha256,sha)||!valid(p.builderId,id)||p.complete!==true))throw Error('Invalid provenance');
   seen.add(p.evidenceId);
   status=kind==='vulnerability-scan'&&(p.criticalCount>0||p.highCount>0)?'VERIFIED_FINDINGS':'SIGNED_EVIDENCE_VERIFIED';reason=null;
   results.push({kind,status,reason,evidenceId:p.evidenceId,payloadSha256:digest(e.payload),...(kind==='vulnerability-scan'?{criticalCount:p.criticalCount,highCount:p.highCount}:{})});continue;
  }catch{/* Invalid or untrusted evidence cannot authorize a pass. */}
  results.push({kind,status,reason});
 }
 return {schemaVersion:1,artifactSha256,revisionSha256,results,status:results.some(r=>r.status==='VERIFIED_FINDINGS')?'VERIFIED_FINDINGS':results.every(r=>r.status==='SIGNED_EVIDENCE_VERIFIED')?'DECLARED_SIGNED_EVIDENCE_VERIFIED':'INCOMPLETE',productionReady:false,deploymentAuthorized:false};
}
