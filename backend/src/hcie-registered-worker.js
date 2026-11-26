import {runMapWorkerOnce} from './hcie-map-worker.js';
import {HcieAgentRegistry} from './hcie-agent-registry.js';
// Strict registered execution path. Existing low-level fixture API remains
// available to trusted tests and must not be exposed as a customer endpoint.
export async function runRegisteredMapWorkerOnce({registry,policySha256,queue,store,chunks,checkCapacity,signal,leaseMs}={}){
 if(!(registry instanceof HcieAgentRegistry)||typeof queue?.claim!=='function'||typeof queue?.complete!=='function')throw Error('Registered worker dependencies required');
 const pair=registry.resolve(policySha256);
 const boundQueue={
  claim:opts=>{
   const task=queue.claim(opts);
   if(task&&task.policySha256!==policySha256)throw Error('Queue policy mismatch');
   return task;
  },
  complete:input=>queue.complete(input)
 };
 return runMapWorkerOnce({queue:boundQueue,store,chunks,analyze:pair.analyze,review:pair.review,checkCapacity,signal,leaseMs});
}
