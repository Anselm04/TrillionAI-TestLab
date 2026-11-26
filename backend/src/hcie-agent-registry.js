import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
const sha=/^[a-f0-9]{64}$/;
const id=/^[A-Za-z0-9_.:-]{1,128}$/;
const validId=x=>typeof x==='string'&&id.test(x);
const validSha=x=>typeof x==='string'&&sha.test(x);
// Trusted operator registration: executable callbacks are never selected by
// customer input. Definition digests must originate in qualified build evidence.
export class HcieAgentRegistry {
 #agents=new Map();#pairs=new Map();#sealed=false;
 register({agentId,role,definitionSha256,implementation}={}){
  if(this.#sealed)throw Error('Registry sealed');
  if(!validId(agentId)||!['ANALYZER','REVIEWER'].includes(role)||!validSha(definitionSha256)||typeof implementation!=='function')throw Error('Invalid agent registration');
  if(this.#agents.has(agentId)||[...this.#agents.values()].some(a=>a.implementation===implementation))throw Error('Duplicate agent registration');
  this.#agents.set(agentId,Object.freeze({agentId,role,definitionSha256,implementation}));
 }
 approve({analyzerId,reviewerId,executionPolicySha256}={}){
  if(this.#sealed)throw Error('Registry sealed');
  const a=this.#agents.get(analyzerId),r=this.#agents.get(reviewerId);
  if(a?.role!=='ANALYZER'||r?.role!=='REVIEWER'||a.agentId===r.agentId||a.definitionSha256===r.definitionSha256||!validSha(executionPolicySha256))throw Error('Independent approved agent pair required');
  const binding=Object.freeze({schemaVersion:1,analyzerId:a.agentId,analyzerDefinitionSha256:a.definitionSha256,reviewerId:r.agentId,reviewerDefinitionSha256:r.definitionSha256,executionPolicySha256});
  const policySha256=hash(JSON.stringify(binding));
  this.#pairs.set(policySha256,Object.freeze({binding,a,r}));
  return policySha256;
 }
 seal(){this.#sealed=true;}
 resolve(policySha256){
  if(!this.#sealed||!validSha(policySha256))throw Error('Sealed agent registry required');
  const p=this.#pairs.get(policySha256);
  if(!p)throw Error('Unapproved agent policy');
  const assertScope=scope=>{if(scope?.policySha256!==policySha256)throw Error('Agent scope policy mismatch');};
  return Object.freeze({binding:p.binding,policySha256,
   analyze:async request=>{assertScope(request.scope);if(request.signal?.aborted)throw Error('Analysis cancelled');return p.a.implementation(request);},
   review:async request=>{
    assertScope(request.scope);if(request.signal?.aborted)throw Error('Review cancelled');
    const decision=await p.r.implementation(request);
    if(request.signal?.aborted)throw Error('Review cancelled');
    // Ignore callback-asserted identity. Only the registry supplies identity.
    return {accepted:decision?.accepted===true,observationSha256:decision?.observationSha256,chunkSha256:decision?.chunkSha256,reviewerId:p.r.agentId,reviewerDefinitionSha256:p.r.definitionSha256};
   }
  });
 }
}
