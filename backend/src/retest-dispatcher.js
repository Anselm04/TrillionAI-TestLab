import {analyzeJournalFailures} from './journal-failure-intelligence.js';
// Trusted supervisor configuration only. One journal belongs to one project.
// Dispatch one bounded cycle; no background timers or unbounded retry loops.
export async function dispatchRetestCycle({projectId,journal,verifyStoredObservation,checkCapacity,signal,after=0,maxRuns=100,maxDispatch=5,maxAttempts=2}={}){
 if(typeof checkCapacity!=='function'||typeof verifyStoredObservation!=='function'||typeof journal?.scheduleRetest!=='function'||typeof journal?.runNext!=='function'||!Number.isInteger(maxDispatch)||maxDispatch<1||maxDispatch>20||!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>3)throw Error('Invalid retest supervisor policy');
 const events=[];
 const report=(status,extra={})=>({status,events,productionReady:false,deploymentAuthorized:false,...extra});
 if(signal?.aborted||await checkCapacity()!==true||signal?.aborted)return report('PAUSED');
 const analysis=await analyzeJournalFailures({projectId,journal,verifyStoredObservation,after,maxRuns});
 const rejected=new Set(analysis.rejected);
 // Recommendations are a bounded presentation list, not an execution inventory.
 const candidates=new Map();
 for(const g of analysis.groups){
  if(g.status!=='FAILED')continue;
  for(const runId of g.evidenceIds)if(!rejected.has(runId))candidates.set(runId,g);
 }
 let attempted=0,interrupted=false;
 for(const [parentRunId,r] of candidates){
  if(attempted>=maxDispatch||signal?.aborted||await checkCapacity()!==true||signal?.aborted){interrupted=true;break;}
  const entry=journal.get(parentRunId),o=entry?.result?.observation;
  if(entry?.state!=='VERIFIED'||entry.integrity!==true||o?.status!=='FAILED'||o.testId!==r.testId||o.environmentId!==r.environmentId||entry.definitionSha256!==r.definitionSha256||entry.revisionSha256!==r.revisionSha256)continue;
  attempted++;
  const scheduled=await journal.scheduleRetest({parentRunId,verifyStoredObservation:(observation,context)=>verifyStoredObservation(observation,{...context,projectId}),maxAttempts,signal});
  if(!['SCHEDULED','ALREADY_SCHEDULED'].includes(scheduled.status)){events.push({parentRunId,status:scheduled.status});continue;}
  const child=journal.get(scheduled.runId);
  if(child?.state!=='QUEUED'){events.push({parentRunId,runId:scheduled.runId,status:'ALREADY_PROCESSED'});continue;}
  const result=await journal.runNext({checkCapacity,signal,expectedRunId:scheduled.runId});
  events.push({parentRunId,runId:scheduled.runId,status:result?.state??result?.status??'UNKNOWN',outcome:result?.state==='VERIFIED'?result.result?.observation?.status??null:null});
  if(result?.status==='PAUSED'||result?.status==='IDLE_OR_BUSY'||result?.state==='BLOCKED'){interrupted=true;break;}
 }
 return report(interrupted?'CYCLE_INCOMPLETE':'CYCLE_FINISHED',{nextCursor:interrupted?after:analysis.nextCursor,hasMore:interrupted||analysis.hasMore,historyStatus:analysis.status,attempted,candidateCount:candidates.size});
}
