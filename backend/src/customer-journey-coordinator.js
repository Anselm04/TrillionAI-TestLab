import {planCustomerJourneys} from './customer-journey-planner.js';
// Dependencies are trusted operator services. Proposed journeys never select
// device, artifact path, signing identity, credentials or review challenge.
export async function runCustomerJourneySuite({catalog,propose,engine='maestro',maxJourneys=10,artifact,deviceId,issueChallenge,orchestrator,verifyIsolation}){
 if(typeof deviceId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(deviceId)||typeof artifact?.apkPath!=='string'||artifact.apkSha256!==catalog?.buildSha256||!Array.isArray(artifact.signerSha256)||!artifact.signerSha256.length||artifact.signerSha256.some(x=>typeof x!=='string'||!/^[a-f0-9]{64}$/.test(x))||typeof issueChallenge!=='function'||typeof orchestrator?.run!=='function'||typeof verifyIsolation!=='function')throw Error('Invalid suite configuration');
 const trustedArtifact={apkPath:artifact.apkPath,apkSha256:artifact.apkSha256,signerSha256:[...artifact.signerSha256]};
 const plans=await planCustomerJourneys({catalog,propose,engine,maxJourneys});
 const results=[];
 let blocked=false;
 for(const plan of plans){
  if(blocked){results.push({journeyId:plan.journey.id,flowSha256:plan.flowSha256,status:'NOT_EXECUTED'});continue;}
  try{
   if(await verifyIsolation({deviceId,buildSha256:plan.buildSha256})!==true)throw Error('Isolation not verified');
   const challenge=await issueChallenge({deviceId,buildSha256:plan.buildSha256,flowSha256:plan.flowSha256});
   if(challenge?.deviceId!==deviceId||challenge.buildSha256!==plan.buildSha256||challenge.flowSha256!==plan.flowSha256||typeof challenge.challengeId!=='string')throw Error('Challenge mismatch');
   const result=await orchestrator.run({...trustedArtifact,deviceId,packageName:plan.journey.packageName,journey:plan.journey,engine:plan.engine,reviewChallengeId:challenge.challengeId,isolationConfirmed:true});
   blocked=result?.status!=='EVIDENCE_REVIEWED';
   results.push({journeyId:plan.journey.id,flowSha256:plan.flowSha256,status:blocked?'BLOCKED':'EVIDENCE_REVIEWED',result});
  }catch{
   blocked=true;results.push({journeyId:plan.journey.id,flowSha256:plan.flowSha256,status:'BLOCKED',reason:'Execution prerequisite or infrastructure failed'});
  }
 }
 return {status:blocked?'BLOCKED':'EVIDENCE_REVIEWED',planned:plans.length,reviewed:results.filter(r=>r.status==='EVIDENCE_REVIEWED').length,results,productionReady:false,deploymentAuthorized:false};
}
