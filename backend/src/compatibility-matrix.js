import {createHash} from 'node:crypto';
import {evaluateIndependentEvidence} from './independent-verification.js';
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const sha=/^[a-f0-9]{64}$/;
const valid=(x,r)=>typeof x==='string'&&r.test(x);
const modes={android:['physical','emulator'],ios:['physical','simulator'],web:['browser'],linux:['native','vm'],windows:['native','vm'],macos:['native','vm']};
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export async function evaluateCompatibility({revisionSha256,targets,observations,inventory,verifyObservation,mobileTrust}={}){
 if(!valid(revisionSha256,sha)||!Array.isArray(targets)||!targets.length||targets.length>500||!Array.isArray(observations)||observations.length>500||!Array.isArray(inventory)||inventory.length>500||typeof verifyObservation!=='function')throw Error('Invalid compatibility configuration');
 const devices=new Map(),expected=new Map(),submitted=new Map(),runs=new Set();
 for(const d of inventory){
  if(!valid(d?.deviceId,id)||devices.has(d.deviceId)||!Object.hasOwn(modes,d.platform)||!modes[d.platform].includes(d.mode)||!valid(d.osVersion,id)||!valid(d.arch,id))throw Error('Invalid trusted inventory');
  devices.set(d.deviceId,structuredClone(d));
 }
 for(const t of targets){
  if(!valid(t?.id,id)||expected.has(t.id)||!Object.hasOwn(modes,t.platform)||!modes[t.platform].includes(t.mode)||!valid(t.osVersion,id)||!valid(t.arch,id)||!valid(t.buildSha256,sha)||!valid(t.flowSha256,sha))throw Error('Invalid target');
  expected.set(t.id,structuredClone(t));
 }
 for(const o of observations){
  if(!expected.has(o?.targetId)||submitted.has(o.targetId)||!valid(o.runId,id)||runs.has(o.runId))throw Error('Unexpected or duplicate observation');
  submitted.set(o.targetId,o);runs.add(o.runId);
 }
 const checks=[];
 for(const [targetId,t] of expected){
  const o=submitted.get(targetId),d=devices.get(o?.deviceId);
  let status='NOT_TESTED',reason='MISSING_OBSERVATION';
  if(o){
   status='UNVERIFIED';reason='CONTEXT_MISMATCH';
   if(d&&d.platform===t.platform&&d.mode===t.mode&&d.osVersion===t.osVersion&&d.arch===t.arch&&o.revisionSha256===revisionSha256&&o.buildSha256===t.buildSha256&&o.flowSha256===t.flowSha256&&['PASSED','FAILED'].includes(o.status)){
    reason='EVIDENCE_UNVERIFIED';
    try{
     let verified=await verifyObservation(structuredClone(o),structuredClone(t),structuredClone(d))===true;
     if(verified&&t.mode==='physical'){
      const binding=mobileTrust?.bindings?.find(b=>b.targetId===targetId);
      verified=!!binding&&binding.revisionSha256===revisionSha256&&binding.requirement?.deviceId===d.deviceId&&binding.requirement?.buildSha256===t.buildSha256&&binding.requirement?.flowSha256===t.flowSha256&&o.mobileEvidence?.manifest?.runId===o.runId&&o.status==='PASSED';
      if(verified){
       const result=await evaluateIndependentEvidence({requirements:[binding.requirement],evidence:[o.mobileEvidence],workerPublicKeys:mobileTrust.workerPublicKeys,reviewerPublicKey:mobileTrust.reviewerPublicKey,store:mobileTrust.store});
       verified=result.status==='REQUIRED_EVIDENCE_VERIFIED';
      }
     }
     if(verified){status=o.status;reason=null;}
    }catch{reason='VERIFICATION_FAILED';}
   }
  }
  checks.push({targetId,platform:t.platform,mode:t.mode,status,reason});
 }
 const physical=checks.filter(c=>c.mode==='physical');
 return {schemaVersion:1,revisionSha256,matrixSha256:hash([...expected.values()]),checks,status:checks.some(c=>c.status==='FAILED')?'VERIFIED_FAILURE':checks.every(c=>c.status==='PASSED')?'DECLARED_MATRIX_PASSED':'INCOMPLETE',physicalQualification:physical.length===0?'NOT_REQUESTED':physical.every(c=>c.status==='PASSED')?'DECLARED_PHYSICAL_CHECKS_VERIFIED':'INCOMPLETE',productionReady:false,deploymentAuthorized:false};
}
