import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createReviewerService,createReviewerClient} from '../src/reviewer-service.js';
test('reviewer service separates issuance from review credentials',async t=>{
 const schedulerToken='a'.repeat(64),workerToken='b'.repeat(64);
 const service=createReviewerService({schedulerToken,workerToken,challenges:{issue:x=>({...x,challengeId:'fixture'})},review:async x=>({decision:x.challengeId==='fixture'?'ACCEPTED':'BLOCKED'})});
 const {port}=await service.listen();t.after(()=>new Promise(resolve=>service.server.close(resolve)));
 const issue=createReviewerClient({port,token:schedulerToken,role:'scheduler'});
 const review=createReviewerClient({port,token:workerToken,role:'worker'});
 const challenge=await issue({deviceId:'phone',buildSha256:'c'.repeat(64),flowSha256:'d'.repeat(64)});
 assert.equal(challenge.challengeId,'fixture');
 assert.equal((await review(challenge)).decision,'ACCEPTED');
 await assert.rejects(createReviewerClient({port,token:workerToken,role:'scheduler'})({}));
 await assert.rejects(createReviewerClient({port,token:schedulerToken,role:'worker'})({}));
 await assert.rejects(review({data:'x'.repeat(70000)}));
 assert.throws(()=>createReviewerService({schedulerToken,workerToken:schedulerToken,challenges:{issue(){}},review(){}}));
});
