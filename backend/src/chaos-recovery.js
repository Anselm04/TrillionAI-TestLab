import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const sha=/^[a-f0-9]{64}$/;
const valid=(v,r)=>typeof v==='string'&&r.test(v);
const faults=new Set(['dependency-unavailable','transient-error','restart','latency','snapshot-restore']);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
// Trusted host callbacks must enforce sandbox isolation and hard deadlines.
// No host fault injection, production access or customer remediation.
export async function qualifyRecovery({scope,scenario,adapter,verifyObservation,checkCapacity=async()=>true,signal}={}){
 if(scope?.mode!=='isolated-test'||!valid(scope.environmentId,id)||!valid(scope.revisionSha256,sha)||
 !valid(scenario?.id,id)||!faults.has(scenario.fault)||!Number.isInteger(scenario.maxRecoveryMs)||scenario.maxRecoveryMs<1||scenario.maxRecoveryMs>600000||
 !Number.isInteger(scenario.maxLostRecords)||scenario.maxLostRecords<0||
 adapter?.environmentId!==scope.environmentId||adapter?.revisionSha256!==scope.revisionSha256||
 adapter?.scenarioId!==scenario.id||adapter?.fault!==scenario.fault||
 [adapter?.baseline,adapter?.exercise,adapter?.cleanup,verifyObservation,checkCapacity].some(x=>typeof x!=='function'))throw Error('Invalid recovery qualification');
 const context=structuredClone({scope,scenario});
 const report=(status,extra={})=>({schemaVersion:1,scenarioId:context.scenario.id,environmentId:context.scope.environmentId,revisionSha256:context.scope.revisionSha256,status,...extra,productionReady:false,deploymentAuthorized:false});
 if(signal?.aborted)return report('INCOMPLETE',{reason:'CANCELLED'});
 let observation,reason,started=false,clean=false;
 try{
 if(await checkCapacity()!==true)return report('INCOMPLETE',{reason:'RESOURCE_LIMIT'});
 if(signal?.aborted)return report('INCOMPLETE',{reason:'CANCELLED'});
 const baseline=structuredClone(await adapter.baseline(structuredClone(context),signal));
 if(!valid(baseline?.stateSha256,sha)||!Number.isSafeInteger(baseline.recordCount)||baseline.recordCount<0)throw Error('Invalid baseline');
 if(signal?.aborted)return report('INCOMPLETE',{reason:'CANCELLED'});
 if(await checkCapacity()!==true)return report('INCOMPLETE',{reason:'RESOURCE_LIMIT'});
 if(signal?.aborted)return report('INCOMPLETE',{reason:'CANCELLED'});
 started=true;
 const start=performance.now();
 const after=await adapter.exercise(structuredClone(context),signal);
 const elapsedMs=Math.ceil(performance.now()-start);
 if(!valid(after?.evidenceId,id)||!valid(after.stateSha256,sha)||!Number.isSafeInteger(after.recordCount)||after.recordCount<0||typeof after.healthy!=='boolean'||!Number.isSafeInteger(after.lostRecords)||after.lostRecords<0||after.lostRecords>baseline.recordCount)throw Error('Invalid recovery evidence');
 observation={...context,baseline:{stateSha256:baseline.stateSha256,recordCount:baseline.recordCount},after:{stateSha256:after.stateSha256,recordCount:after.recordCount,healthy:after.healthy,lostRecords:after.lostRecords,evidenceId:after.evidenceId},elapsedMs};
 }catch{reason='FIXTURE_ERROR';}
 finally{if(started){try{clean=await adapter.cleanup(structuredClone(context))===true;}catch{clean=false;}}}
 if(started&&!clean)return report('INCOMPLETE',{reason:'SANDBOX_CLEANUP_FAILED'});
 if(signal?.aborted)return report('INCOMPLETE',{reason:'CANCELLED'});
 if(!observation)return report('INCOMPLETE',{reason:reason||'NO_OBSERVATION'});
 try{
 if(await verifyObservation(structuredClone(observation))!==true)return report('INCOMPLETE',{reason:'EVIDENCE_UNVERIFIED'});
 }catch{return report('INCOMPLETE',{reason:'VERIFIER_ERROR'});}
 if(signal?.aborted)return report('INCOMPLETE',{reason:'CANCELLED'});
 const violations=[];
 if(!observation.after.healthy)violations.push('UNHEALTHY');
 if(observation.elapsedMs>context.scenario.maxRecoveryMs)violations.push('RECOVERY_TIME_EXCEEDED');
 if(observation.after.lostRecords>context.scenario.maxLostRecords)violations.push('RECORD_LOSS_EXCEEDED');
 return report(violations.length?'VERIFIED_FAILURE':'DECLARED_RECOVERY_CHECKS_PASSED',{observation,observationSha256:hash(observation),violations});
}
