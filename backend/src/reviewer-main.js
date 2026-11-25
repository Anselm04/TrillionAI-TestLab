import {loadServiceKey} from './service-keys.js';
import {MobileEvidenceStore} from './mobile-evidence.js';
import {ReviewChallengeStore,createReplayProtectedReviewer} from './review-challenges.js';
import {createReviewerService} from './reviewer-service.js';
const e=process.env;
const store=new MobileEvidenceStore(e.TESTLAB_EVIDENCE_ROOT);
const workerPublicKey=await loadServiceKey(e.TESTLAB_WORKER_PUBLIC_KEY);
const reviewerPrivateKey=await loadServiceKey(e.TESTLAB_REVIEWER_KEY,{privateKey:true});
const challenges=new ReviewChallengeStore(e.TESTLAB_REVIEW_DB);
try{
 const review=createReplayProtectedReviewer({challenges,store,workerPublicKey,reviewerPrivateKey});
 const service=createReviewerService({challenges,review,schedulerToken:e.TESTLAB_SCHEDULER_TOKEN,workerToken:e.TESTLAB_REVIEW_WORKER_TOKEN});
 await service.listen(Number(e.TESTLAB_REVIEW_PORT||8789));
 console.log('TestLab reviewer listening on loopback');
 const stop=()=>service.server.close(()=>challenges.close());
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
}catch(e){challenges.close();throw e;}
