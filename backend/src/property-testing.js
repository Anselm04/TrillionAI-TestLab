import {createHash} from 'node:crypto';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function seededRandom(seed){
 if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw Error('Invalid seed');
 let state=seed;
 return ()=>{state=(state+0x6D2B79F5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}
// Callbacks must be trusted, bounded, in-process fixtures. External or
// untrusted execution belongs in an independently enforced sandbox.
export async function checkProperty({seed=1,cases=100,generate,property,checkCapacity=async()=>true,verifyFailure=async()=>false,signal}={}){
 if(!Number.isInteger(cases)||cases<1||cases>10000||[generate,property,checkCapacity,verifyFailure].some(x=>typeof x!=='function'))throw Error('Invalid property configuration');
 const random=seededRandom(seed);
 let executed=0;
 const report=(status,extra={})=>({schemaVersion:1,seed,cases,executed,status,...extra,productionReady:false,deploymentAuthorized:false});
 for(let index=0;index<cases;index++){
  if(signal?.aborted)return report('INCOMPLETE',{reason:'CANCELLED'});
  try{
   if(await checkCapacity()!==true)return report('INCOMPLETE',{reason:'RESOURCE_LIMIT'});
   if(signal?.aborted)return report('INCOMPLETE',{reason:'CANCELLED'});
   const raw=generate(random,index), encoded=JSON.stringify(raw);
   if(typeof encoded!=='string'||Buffer.byteLength(encoded)>65536)return report('INCOMPLETE',{reason:'INVALID_GENERATED_CASE'});
   const input=JSON.parse(encoded), inputSha256=digest(input);
   executed++;
   const result=await property(structuredClone(input));
   if(signal?.aborted)return report('INCOMPLETE',{reason:'CANCELLED'});
   if(result!==true&&result!==false)return report('INCOMPLETE',{reason:'INVALID_PROPERTY_RESULT'});
   if(result===false){
    const observation={seed,index,inputSha256};
    const confirmed=await verifyFailure(structuredClone(input),structuredClone(observation));
    if(signal?.aborted)return report('INCOMPLETE',{reason:'CANCELLED'});
    return report(confirmed===true?'VERIFIED_COUNTEREXAMPLE':'UNVERIFIED_COUNTEREXAMPLE',{observation});
   }
  }catch{return report('INCOMPLETE',{reason:'FIXTURE_OR_VERIFIER_ERROR'});}
 }
 return report('GENERATED_CASES_PASSED');
}
export function generateBoundaryInteger(random,index){
 const edges=[0,1,-1,Number.MAX_SAFE_INTEGER,Number.MIN_SAFE_INTEGER,2147483647,-2147483648];
 return index<edges.length?edges[index]:Math.floor(random()*2000001)-1000000;
}
