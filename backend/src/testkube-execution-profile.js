import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {performance} from 'node:perf_hooks';
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const sha=/^[a-f0-9]{64}$/;
const name=/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const valid=(v,r)=>typeof v==='string'&&r.test(v);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const outcome=o=>o?.status==='ENGINE_REPORTED_PASS'?'PASSED':o?.status==='ENGINE_REPORTED_FAIL'?'FAILED':null;
const identity=o=>[o.engine,o.testName,o.executionId,o.executionName,o.executionNumber,o.engineExecutionName];
const same=(a,b)=>JSON.stringify(identity(a))===JSON.stringify(identity(b));
const active=o=>['QUEUED','RUNNING'].includes(o?.status);
// All configuration and callbacks are trusted supervisor inputs. The
// independent reviewer must verify actual workload identity, fixture/revision,
// and termination evidence, not just repeat the engine's reported status.
export function createTestkubeExecutionProfile({profileId,testId,environmentId,revisionSha256,fixtureSha256,testName,client,verifyFixture,collectEvidence,verifyEvidence,checkCapacity,maxPolls=100,pollMs=500,deadlineMs=120000}={}){
 if(![profileId,testId,environmentId].every(v=>valid(v,id))||![revisionSha256,fixtureSha256].every(v=>valid(v,sha))||!valid(testName,name)||!['submit','inspect'].every(k=>typeof client?.[k]==='function')||[verifyFixture,collectEvidence,verifyEvidence,checkCapacity].some(f=>typeof f!=='function')||!Number.isInteger(maxPolls)||maxPolls<1||maxPolls>1000||!Number.isInteger(pollMs)||pollMs<1||pollMs>10000||!Number.isInteger(deadlineMs)||deadlineMs<1||deadlineMs>300000)throw Error('Invalid engine profile');
 const definitionSha256=hash({kind:'testkube',version:1,testId,environmentId,revisionSha256,fixtureSha256,testName,maxPolls,pollMs,deadlineMs});
 const bound=c=>c?.profileId===profileId&&c.revisionSha256===revisionSha256&&c.definitionSha256===definitionSha256&&valid(c.runId,id);
 const scope=c=>({...c,testId,environmentId,fixtureSha256,testName});
 const validEngine=o=>o?.engine==='testkube-v1.16.0'&&o.testName===testName&&valid(o.executionId,id)&&typeof o.executionName==='string'&&/^testlab-[a-f0-9-]{36}$/.test(o.executionName)&&Number.isSafeInteger(o.executionNumber)&&o.executionNumber>0&&o.engineExecutionName===o.executionName+'-'+o.executionNumber;
 const evidenceMatches=(e,c,o)=>e?.runId===c.runId&&e.revisionSha256===revisionSha256&&e.definitionSha256===definitionSha256&&e.fixtureSha256===fixtureSha256&&e.environmentId===environmentId&&e.executionId===o.executionId&&e.engineExecutionName===o.engineExecutionName&&valid(e.artifactSha256,sha)&&Number.isInteger(e.exitCode)&&e.exitCode>=0&&e.exitCode<=255&&((e.exitCode===0)===(outcome(o)==='PASSED'));
 return Object.freeze({id:profileId,definitionSha256,async execute(c,signal){
  if(!bound(c)||signal?.aborted)throw Error('Execution context rejected');
  const end=performance.now()+deadlineMs;
  const guard=()=>{if(signal?.aborted||performance.now()>=end)throw Error('Execution deadline or cancellation');};
  guard();if(await checkCapacity()!==true)throw Error('Capacity unavailable');
  guard();if(await verifyFixture(scope(c),signal)!==true)throw Error('Fixture binding rejected');
  guard();const initial=await client.submit(testName);guard();
  if(!validEngine(initial))throw Error('Engine identity invalid');
  let observed=initial;
  for(let i=0;active(observed)&&i<maxPolls;i++){
   guard();await delay(Math.min(pollMs,Math.max(1,end-performance.now())),undefined,{signal});guard();
   observed=await client.inspect(initial);guard();
   if(!validEngine(observed)||!same(initial,observed))throw Error('Engine identity changed');
  }
  if(!outcome(observed))throw Error('No conclusive engine result');
  const evidence=await collectEvidence(structuredClone(observed),scope(c),signal);guard();
  const encoded=JSON.stringify(evidence);
  if(typeof encoded!=='string'||Buffer.byteLength(encoded)>65536)throw Error('Evidence budget exceeded');
  const canonical=JSON.parse(encoded);
  if(!evidenceMatches(canonical,c,observed))throw Error('Independent evidence mismatch');
  const report={execution:observed,evidence:canonical};
  return {...c,testId,environmentId,status:outcome(observed),report,evidenceId:hash({runId:c.runId,report})};
 },async verify(o,c){
  if(!bound(c)||!bound(o)||o.runId!==c.runId||o.testId!==testId||o.environmentId!==environmentId||!validEngine(o.report?.execution)||!outcome(o.report.execution)||o.status!==outcome(o.report.execution)||!evidenceMatches(o.report.evidence,c,o.report.execution)||o.evidenceId!==hash({runId:c.runId,report:o.report}))return false;
  return await verifyEvidence(structuredClone(o.report),scope(c))===true;
 }});
}
