import {setTimeout as delay} from 'node:timers/promises';
import {loadServiceKey} from './service-keys.js';
import {createRackClient} from './rack-transport.js';
import {createReviewerClient} from './reviewer-service.js';
import {createMobileProfileRuntime} from './mobile-profile-runtime.js';
import {inspectHostCapacity} from './host-resource-gate.js';
import {runMobileWorkerOnce} from './mobile-worker-loop.js';
const e=process.env;
const runtime=await createMobileProfileRuntime({
 platform:e.TESTLAB_WORKER_PLATFORM,approvedDevices:JSON.parse(e.TESTLAB_WORKER_DEVICES||'[]'),
 profiles:JSON.parse(e.TESTLAB_WORKER_PROFILES||'[]'),leasePath:e.TESTLAB_WORKER_LEASE_DB,
 evidenceRoot:e.TESTLAB_EVIDENCE_ROOT,xcresultRoot:e.TESTLAB_XCRESULT_ROOT,
 workerPrivateKey:await loadServiceKey(e.TESTLAB_WORKER_KEY,{privateKey:true}),
 reviewerPublicKey:await loadServiceKey(e.TESTLAB_REVIEWER_PUBLIC_KEY),
 issueChallenge:createReviewerClient({port:Number(e.TESTLAB_REVIEW_PORT||8789),token:e.TESTLAB_SCHEDULER_TOKEN,role:'scheduler'}),
 review:createReviewerClient({port:Number(e.TESTLAB_REVIEW_PORT||8789),token:e.TESTLAB_REVIEW_WORKER_TOKEN,role:'worker'}),
 isolationConfirmed:e.TESTLAB_DEDICATED_ISOLATION==='confirmed'
});
let stopping=false;
process.on('SIGINT',()=>{stopping=true;});
process.on('SIGTERM',()=>{stopping=true;});
try{
 const client=createRackClient({port:Number(e.TESTLAB_RACK_PORT||8788),host:e.TESTLAB_WORKER_HOST,token:e.TESTLAB_WORKER_TOKEN});
 while(!stopping){
  try{
   const capacity=await inspectHostCapacity({path:e.TESTLAB_EVIDENCE_ROOT});
   if(capacity.ready){
    const result=await runMobileWorkerOnce({client,platform:e.TESTLAB_WORKER_PLATFORM,discover:runtime.discover,execute:runtime.execute});
    console.log(JSON.stringify({status:result.status,jobId:result.jobId??null}));
   }else console.log(JSON.stringify({status:'RESOURCE_PAUSED',reasons:capacity.reasons}));
  }catch{console.error('Worker infrastructure unavailable; no automatic job replay');}
  if(!stopping)await delay(10000);
 }
}finally{runtime.close();}
