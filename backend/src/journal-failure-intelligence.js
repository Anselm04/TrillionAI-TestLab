import {analyzeFailureHistory} from './failure-intelligence.js';
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const valid=v=>typeof v==='string'&&id.test(v);
// Each journal must belong to exactly one operator-registered project.
// A checksum is not an independent attestation; reverify every observation.
export async function analyzeJournalFailures({projectId,journal,verifyStoredObservation,after=0,maxRuns=500,maxRecommendations=50}={}){
 if(!valid(projectId)||typeof journal?.historyPage!=='function'||typeof verifyStoredObservation!=='function'||!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(maxRuns)||maxRuns<1||maxRuns>1000)throw Error('Invalid journal analysis');
 const observations=[],sources=new Map(),excluded=[];let cursor=after,scanned=0,hasMore=false;
 while(scanned<maxRuns){
  const page=journal.historyPage({after:cursor,limit:Math.min(50,maxRuns-scanned)});
  for(const entry of page.entries){
   scanned++;
   const o=entry.result?.observation;
   if(entry.state!=='VERIFIED'||entry.integrity!==true||!o||o.runId!==entry.runId||o.definitionSha256!==entry.definitionSha256||o.revisionSha256!==entry.revisionSha256||!valid(o.testId)||!valid(o.environmentId)||!valid(o.evidenceId)||!['PASSED','FAILED'].includes(o.status)){
    excluded.push({runId:entry.runId,state:entry.state});continue;
   }
   // Run IDs identify historical executions; retain the original evidence ID.
   const record={projectId,evidenceId:entry.runId,testId:o.testId,environmentId:o.environmentId,definitionSha256:o.definitionSha256,revisionSha256:o.revisionSha256,status:o.status,sequence:entry.sequence,failureCode:o.status==='FAILED'?'VERIFIED_TEST_FAILURE':null};
   observations.push(record);sources.set(entry.runId,entry);
  }
  cursor=page.nextCursor;hasMore=page.hasMore;
  if(!hasMore||!page.entries.length)break;
 }
 const analysis=await analyzeFailureHistory({projectId,observations,maxRecommendations,verifyObservation:async record=>{
  const entry=sources.get(record.evidenceId);
  return !!entry&&await verifyStoredObservation(structuredClone(entry.result.observation),{projectId,runId:entry.runId,profileId:entry.profileId,definitionSha256:entry.definitionSha256,revisionSha256:entry.revisionSha256})===true;
 }});
 return {...analysis,historyScope:'BOUNDED_JOURNAL_WINDOW',scanned,excluded,nextCursor:cursor,hasMore,status:hasMore||excluded.length||analysis.status==='INCOMPLETE'?'INCOMPLETE':'VERIFIED_HISTORY_ANALYZED'};
}
