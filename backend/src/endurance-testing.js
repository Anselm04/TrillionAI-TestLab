import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const sha=/^[a-f0-9]{64}$/;
const valid=(v,r)=>typeof v==='string'&&r.test(v);
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
// Host adapters must enforce isolation and hard execution deadlines.
// This loop never launches untrusted commands or repairs the tested application.
export async function runEndurance({scope,policy,adapter,checkCapacity,verifySample,signal}={}){
 if(scope?.mode!=='isolated-test'||!valid(scope.revisionSha256,sha)||!valid(scope.environmentId,id)||!valid(scope.journeyId,id)||
 !integer(policy?.durationMs,100,86400000)||!integer(policy.intervalMs,10,3600000)||!integer(policy.maxSamples,2,10000)||!integer(policy.maxLatencyMs,1,600000)||!integer(policy.maxMemoryGrowthBytes,0,Number.MAX_SAFE_INTEGER)||
 adapter?.environmentId!==scope.environmentId||adapter?.journeyId!==scope.journeyId||adapter?.revisionSha256!==scope.revisionSha256||
 [adapter?.sample,checkCapacity,verifySample].some(v=>typeof v!=='function'))throw Error('Invalid endurance configuration');
 const context=structuredClone(scope),limits=structuredClone(policy);
 const samples=[],evidenceIds=new Set(),violations=[];
 const start=performance.now();
 const elapsed=()=>Math.floor(performance.now()-start);
 const report=(status,reason=null)=>({schemaVersion:1,status,reason,context,limits,elapsedMs:elapsed(),sampleCount:samples.length,samples,violations,evidenceSha256:createHash('sha256').update(JSON.stringify({context,limits,samples})).digest('hex'),productionReady:false,deploymentAuthorized:false});
 while(true){
  if(signal?.aborted)return report('INCOMPLETE','CANCELLED');
  if(samples.length>=limits.maxSamples)return report('INCOMPLETE','SAMPLE_BUDGET');
  try{
   if(await checkCapacity()!==true)return report('INCOMPLETE','RESOURCE_LIMIT');
   if(signal?.aborted)return report('INCOMPLETE','CANCELLED');
   const began=elapsed();
   const raw=await adapter.sample(structuredClone(context),signal);
   if(signal?.aborted)return report('INCOMPLETE','CANCELLED');
   if(!valid(raw?.evidenceId,id)||evidenceIds.has(raw.evidenceId)||raw.revisionSha256!==context.revisionSha256||raw.environmentId!==context.environmentId||raw.journeyId!==context.journeyId||!integer(raw.memoryBytes,0,Number.MAX_SAFE_INTEGER)||typeof raw.healthy!=='boolean')return report('INCOMPLETE','INVALID_SAMPLE');
   const sample={evidenceId:raw.evidenceId,revisionSha256:raw.revisionSha256,environmentId:raw.environmentId,journeyId:raw.journeyId,memoryBytes:raw.memoryBytes,healthy:raw.healthy,elapsedMs:began,latencyMs:Math.max(0,elapsed()-began)};
   if(await verifySample(structuredClone(sample),structuredClone(context))!==true)return report('INCOMPLETE','EVIDENCE_UNVERIFIED');
   if(signal?.aborted)return report('INCOMPLETE','CANCELLED');
   evidenceIds.add(sample.evidenceId);samples.push(sample);
   if(!sample.healthy)violations.push({evidenceId:sample.evidenceId,rule:'UNHEALTHY'});
   if(sample.latencyMs>limits.maxLatencyMs)violations.push({evidenceId:sample.evidenceId,rule:'LATENCY_LIMIT'});
   if(sample.memoryBytes-samples[0].memoryBytes>limits.maxMemoryGrowthBytes)violations.push({evidenceId:sample.evidenceId,rule:'MEMORY_GROWTH'});
   if(violations.length)return report('VERIFIED_FAILURE');
   if(began>=limits.durationMs&&samples.length>=2)return report('DECLARED_ENDURANCE_CHECKS_PASSED');
   await delay(Math.min(limits.intervalMs,Math.max(1,limits.durationMs-elapsed())),undefined,{signal});
  }catch{return report('INCOMPLETE',signal?.aborted?'CANCELLED':'ADAPTER_OR_VERIFIER_ERROR');}
 }
}
