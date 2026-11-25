import {createHash,createPublicKey} from 'node:crypto';
import {qualifyRecovery} from './chaos-recovery.js';
import {verifySupplyChain} from './supply-chain-verification.js';
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const sha=/^[a-f0-9]{64}$/;
const valid=(v,r)=>typeof v==='string'&&r.test(v);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
// Trusted local registration only. Collectors and recovery callbacks must
// enforce isolation and bounded execution outside this adapter.
export function createRecoverySupplyProfile({kind,profileId,testId,environmentId,revisionSha256,fixtureSha256,config,checkCapacity,verifyReport}={}){
 if(!['recovery','supply-chain'].includes(kind)||![profileId,testId,environmentId].every(v=>valid(v,id))||![revisionSha256,fixtureSha256].every(v=>valid(v,sha))||!config||typeof checkCapacity!=='function'||typeof verifyReport!=='function')throw Error('Invalid profile');
 let definition,run,pass,fail;
 if(kind==='recovery'){
  const scenario=structuredClone(config.scenario),adapter={...config.adapter},verifyObservation=config.verifyObservation;
  if(!scenario||adapter.environmentId!==environmentId||adapter.revisionSha256!==revisionSha256||adapter.scenarioId!==scenario.id||adapter.fault!==scenario.fault||[adapter.baseline,adapter.exercise,adapter.cleanup,verifyObservation].some(v=>typeof v!=='function'))throw Error('Invalid recovery registration');
  definition={scenario};
  pass='DECLARED_RECOVERY_CHECKS_PASSED';fail='VERIFIED_FAILURE';
  run=(c,signal)=>qualifyRecovery({scope:{mode:'isolated-test',revisionSha256,environmentId},scenario,adapter:{
   ...adapter,baseline:(ctx,s)=>adapter.baseline({...ctx,runId:c.runId},s),exercise:(ctx,s)=>adapter.exercise({...ctx,runId:c.runId},s),cleanup:ctx=>adapter.cleanup({...ctx,runId:c.runId})
  },verifyObservation:o=>verifyObservation(o,structuredClone(c)),checkCapacity,signal});
 }else{
  const artifactSha256=config.artifactSha256,collect=config.collect,p=config.policy;
  if(!valid(artifactSha256,sha)||typeof collect!=='function'||!p?.keys||!p.requiredTools||!Number.isSafeInteger(p.maxAgeMs)||p.maxAgeMs<1||p.maxAgeMs>31536000000)throw Error('Invalid supply chain registration');
  const keys=Object.entries(p.keys);
  if(!keys.length||keys.length>100)throw Error('Invalid trust roots');
  const policy={maxAgeMs:p.maxAgeMs,requiredTools:structuredClone(p.requiredTools),keys:Object.fromEntries(keys.sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>{
   if(!valid(k,id)||!Array.isArray(v.kinds)||!v.kinds.length||v.kinds.some(x=>!['sbom','vulnerability-scan','build-provenance'].includes(x)))throw Error('Invalid signer');
   const key=createPublicKey(v.publicKey);if(key.asymmetricKeyType!=='ed25519')throw Error('Invalid public key');
   return [k,{publicKey:key.export({type:'spki',format:'pem'}),kinds:[...new Set(v.kinds)].sort()}];
  }))};
  definition={artifactSha256,policy};
  pass='DECLARED_SIGNED_EVIDENCE_VERIFIED';fail='VERIFIED_FINDINGS';
  run=async(c,signal)=>{
   const data=await collect(structuredClone(c),signal);
   if(signal?.aborted||data?.runId!==c.runId||data.revisionSha256!==revisionSha256||data.definitionSha256!==c.definitionSha256||data.artifactSha256!==artifactSha256||!Array.isArray(data.evidence)||data.evidence.length>30)throw Error('Evidence context mismatch');
   return verifySupplyChain({artifactSha256,revisionSha256,policy,evidence:data.evidence});
  };
 }
 const definitionSha256=hash({kind,version:1,testId,environmentId,fixtureSha256,definition});
 const bound=c=>c?.profileId===profileId&&c.revisionSha256===revisionSha256&&c.definitionSha256===definitionSha256&&valid(c.runId,id);
 const status=r=>r?.status===pass?'PASSED':r?.status===fail?'FAILED':null;
 return Object.freeze({id:profileId,definitionSha256,async execute(c,signal){
  if(!bound(c)||signal?.aborted||await checkCapacity()!==true||signal?.aborted)throw Error('Execution refused');
  const report=await run(c,signal),observed=status(report);
  if(!observed||signal?.aborted)throw Error('Incomplete engine result');
  return {...c,testId,environmentId,status:observed,report,evidenceId:hash({runId:c.runId,report})};
 },async verify(o,c){
  if(!bound(c)||!bound(o)||o.runId!==c.runId||o.testId!==testId||o.environmentId!==environmentId||!status(o.report)||status(o.report)!==o.status||o.evidenceId!==hash({runId:c.runId,report:o.report}))return false;
  return await verifyReport(structuredClone(o.report),{...c,testId,environmentId})===true;
 }});
}
