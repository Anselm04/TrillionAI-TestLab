import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {createTestkubeClient} from '../src/testkube-client.js';

const names=['testlab-pass','testlab-fail','testlab-cancel','testlab-timeout'];
const origin=process.env.TESTLAB_TESTKUBE_ORIGIN;
const client=createTestkubeClient({origin,approvedTests:names});
const endpoint='http://127.0.0.1:8787/testkube/executions';
const evidence=[];
const save=()=>writeFile(process.env.RUNNER_TEMP+'/testkube-independent-evidence.json',JSON.stringify(evidence,null,2));
const kubectl=(...args)=>JSON.parse(execFileSync('kubectl',['-n','testkube',...args,'-o','json'],{encoding:'utf8',timeout:10000,maxBuffer:4*1024*1024}));
const active=o=>['QUEUED','RUNNING'].includes(o.status);
async function until(fn,ms=150000){
 const end=Date.now()+ms;
 do {const value=await fn();if(value)return value;await delay(500);}while(Date.now()<end);
 throw Error('Qualification deadline exceeded');
}
async function submit(testName){
 const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+process.env.TESTLAB_TOKEN},body:JSON.stringify({testName}),signal:AbortSignal.timeout(15000)});
 assert.equal(response.status,202);return response.json();
}
function workload(o){
 const jobs=kubectl('get','jobs').items.filter(j=>[o.executionId,o.engineExecutionName].includes(j.metadata.name));
 assert.ok(jobs.length<=1,'Ambiguous workload identity');
 if(!jobs.length)return null;
 const job=jobs[0];
 const pods=kubectl('get','pods').items.filter(p=>p.metadata.ownerReferences?.some(r=>r.kind==='Job'&&r.uid===job.metadata.uid));
 const statuses=pods.flatMap(p=>(p.status.containerStatuses??[]).filter(c=>c.name===job.metadata.name).map(c=>({podUid:p.metadata.uid,container:c.name,exitCode:c.state.terminated?.exitCode??null,running:!!c.state.running,startedAt:c.state.running?.startedAt??c.state.terminated?.startedAt??null,finishedAt:c.state.terminated?.finishedAt??null})));
 return {jobUid:job.metadata.uid,jobName:job.metadata.name,conditions:job.status?.conditions??[],statuses};
}
async function terminal(o){return until(async()=>{const v=await client.inspect(o);return !active(v)&&v;});}
async function exitEvidence(o,code){
 const k=await until(()=>{const x=workload(o);return x?.statuses.some(c=>c.exitCode!==null)&&x;});
 evidence.push({executionId:o.executionId,testName:o.testName,engineStatus:o.status,kubernetes:k,expectedExitCode:code});await save();
 assert.equal(k.statuses.length,1);assert.equal(k.statuses[0].exitCode,code);
 return k;
}
try {
 const [a,b]=await Promise.all([submit('testlab-pass'),submit('testlab-fail')]);
 assert.notEqual(a.executionId,b.executionId);
 const [pass,fail]=await Promise.all([terminal(a),terminal(b)]);
 assert.equal(pass.status,'ENGINE_REPORTED_PASS');assert.equal(fail.status,'ENGINE_REPORTED_FAIL');
 const [pa,pb]=await Promise.all([exitEvidence(pass,0),exitEvidence(fail,7)]);
 assert.notEqual(pa.jobUid,pb.jobUid);
 const x=pa.statuses[0],y=pb.statuses[0];
 assert.ok(Date.parse(x.startedAt)<Date.parse(y.finishedAt)&&Date.parse(y.startedAt)<Date.parse(x.finishedAt),'Workloads did not overlap');
 const cancel=await submit('testlab-cancel');
 const before=await until(()=>{const k=workload(cancel);return k?.statuses.some(c=>c.running)&&k;});
 const response=await fetch(origin+'/v1/tests/'+cancel.testName+'/executions/'+cancel.executionId,{method:'PATCH',signal:AbortSignal.timeout(15000)});
 assert.ok(response.ok,'Engine cancellation rejected');await response.body?.cancel();
 const cancelled=await terminal(cancel);
 const stopped=await until(()=>{const k=workload(cancel);return !k?{deleted:true}:k.statuses.length&&k.statuses.every(c=>c.exitCode!==null)?k:null;});
 evidence.push({executionId:cancel.executionId,engineStatus:cancelled.status,before,stopped});await save();
 assert.equal(cancelled.status,'ABORTED');
 const timeout=await submit('testlab-timeout');
 const timed=await until(()=>{const k=workload(timeout);return k?.conditions.some(c=>c.type==='Failed'&&c.status==='True'&&c.reason==='DeadlineExceeded')&&k;});
 const expired=await terminal(timeout);
 evidence.push({executionId:timeout.executionId,engineStatus:expired.status,kubernetes:timed});await save();
 assert.equal(expired.status,'TIMEOUT');
}finally{await save();}
