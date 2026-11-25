import {createHash} from 'node:crypto';
import {validateJourney,compileExecutionPlan} from './mobile-journey.js';
const sha=/^[a-f0-9]{64}$/;
const hash=x=>createHash('sha256').update(x).digest('hex');
// Catalog is trusted operator input, not model output. Only synthetic isolated
// fixtures may be planned. Network enforcement belongs to the host sandbox.
export async function planCustomerJourneys({catalog,propose,engine='maestro',maxJourneys=10}){
 if(!catalog||catalog.syntheticOnly!==true||catalog.networkIsolationConfirmed!==true||!sha.test(catalog.buildSha256??'')||typeof propose!=='function'||!Number.isSafeInteger(maxJourneys)||maxJourneys<1||maxJourneys>50||!Array.isArray(catalog.selectors)||catalog.selectors.length>500)throw Error('Invalid synthetic test catalog');
 const selectors=new Map();
 for(const s of catalog.selectors){
  if(typeof s?.text!=='string'||!s.text.trim()||s.text.length>200||selectors.has(s.text)||!['observe','synthetic-navigation'].includes(s.permission))throw Error('Invalid selector catalog');
  selectors.set(s.text,s.permission);
 }
 const context={packageName:catalog.packageName,buildSha256:catalog.buildSha256,selectors:catalog.selectors.map(s=>({text:s.text,permission:s.permission})),maxJourneys};
 const raw=await propose(structuredClone(context));
 if(!Array.isArray(raw)||!raw.length||raw.length>maxJourneys)throw Error('Invalid proposal count');
 const seen=new Set(),plans=[];
 for(const candidate of raw){
  const plan=validateJourney(candidate);
  if(plan.packageName!==context.packageName||seen.has(plan.id))throw Error('Unexpected journey identity');
  seen.add(plan.id);
  for(const step of plan.steps){
   if(step.text!==undefined&&!selectors.has(step.text))throw Error('Unknown selector');
   if(step.action==='tapText'&&selectors.get(step.text)!=='synthetic-navigation')throw Error('Unapproved interaction');
  }
  plans.push({journey:plan,engine,buildSha256:context.buildSha256,flowSha256:hash(compileExecutionPlan(plan,engine)),status:'PLANNED',productionReady:false,deploymentAuthorized:false});
 }
 return plans;
}
