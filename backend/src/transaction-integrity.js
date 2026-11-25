import {createHash} from 'node:crypto';
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const valid=x=>typeof x==='string'&&id.test(x);
const sha=/^[a-f0-9]{64}$/;
// Model: atomic integer increments on a single isolated fixture key.
// This does not establish serializability for arbitrary databases.
export async function verifyIncrementHistory({history,initial,final,revisionSha256,environmentId,verifyEvidence}={}){
 if(!Array.isArray(history)||!history.length||history.length>10000||!Number.isSafeInteger(initial)||!Number.isSafeInteger(final)||typeof revisionSha256!=='string'||!sha.test(revisionSha256)||!valid(environmentId)||typeof verifyEvidence!=='function')throw Error('Invalid history');
 const seen=new Set(),operations=[];
 for(const o of history){
  if(!valid(o?.id)||seen.has(o.id)||!Number.isSafeInteger(o.start)||!Number.isSafeInteger(o.end)||o.start<0||o.end<o.start||!['COMMITTED','ABORTED','UNKNOWN'].includes(o.status)||!Number.isSafeInteger(o.delta)||o.delta!==1||!valid(o.evidenceId))throw Error('Invalid operation');
  if(o.status==='COMMITTED'&&!Number.isSafeInteger(o.result))throw Error('Invalid commit result');
  seen.add(o.id);operations.push({id:o.id,start:o.start,end:o.end,status:o.status,delta:o.delta,result:o.status==='COMMITTED'?o.result:null,evidenceId:o.evidenceId});
 }
 const evidence={revisionSha256,environmentId,initial,final,operations};
 const report=(status,extra={})=>({schemaVersion:1,status,...extra,historySha256:createHash('sha256').update(JSON.stringify(evidence)).digest('hex'),productionReady:false,deploymentAuthorized:false});
 try{if(await verifyEvidence(structuredClone(evidence))!==true)return report('UNVERIFIED');}catch{return report('UNVERIFIED');}
 if(operations.some(o=>o.status==='UNKNOWN'))return report('INCOMPLETE',{reason:'UNKNOWN_COMMIT'});
 const committed=operations.filter(o=>o.status==='COMMITTED').sort((a,b)=>a.result-b.result);
 if(!Number.isSafeInteger(initial+committed.length))return report('INCOMPLETE',{reason:'INTEGER_RANGE'});
 const violations=[];
 if(final!==initial+committed.length)violations.push('FINAL_STATE_MISMATCH');
 let maxStart=-1;
 for(let i=0;i<committed.length;i++){
  const o=committed[i];
  if(o.result!==initial+i+1&&!violations.includes('NON_ATOMIC_INCREMENT'))violations.push('NON_ATOMIC_INCREMENT');
  if(o.end<maxStart&&!violations.includes('REAL_TIME_ORDER_VIOLATION'))violations.push('REAL_TIME_ORDER_VIOLATION');
  maxStart=Math.max(maxStart,o.start);
 }
 return report(violations.length?'VERIFIED_FAILURE':'DECLARED_INCREMENT_MODEL_PASSED',{committed:committed.length,aborted:operations.length-committed.length,violations});
}
