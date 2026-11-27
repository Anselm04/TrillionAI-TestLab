import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppForgeQualificationPlan} from '../src/appforge-qualification.js';
import {evaluateTraceability} from '../src/requirement-traceability.js';

test('AppForge mixed fixture evidence never promotes missing, rejected or stale requirements', async()=>{
 const revisionSha256='a'.repeat(64), definitionSha256='b'.repeat(64), environmentId='fixture';
 const tests=Array.from({length:6},(_,i)=>({id:'case-'+i,definitionSha256,environmentId,requirementIds:['AF-00'+([1,2,3,3,4,5][i])]}));
 const plan=createAppForgeQualificationPlan({revisionSha256,tests});
 const observations=tests.slice(0,5).map((t,i)=>({testId:t.id,evidenceId:'evidence-'+i,revisionSha256,definitionSha256,environmentId,status:i===1?'FAILED':'PASSED'}));
 observations[4].revisionSha256='c'.repeat(64);
 const called=[];
 const result=await evaluateTraceability({plan,observations,verifyObservation:async o=>{called.push(o.testId);return o.testId!=='case-3';}});
 assert.deepEqual(called,['case-0','case-1','case-2','case-3']);
 assert.deepEqual(result.counts,{PASSED:1,FAILED:1,PARTIALLY_TESTED:1,NOT_TESTED:15,UNVERIFIED:1});
 assert.equal(result.requirements.length,19);
 assert.equal(result.productionReady,false);
 assert.equal(result.deploymentAuthorized,false);
 assert.equal(result.tests.find(t=>t.testId==='case-4').reason,'CONTEXT_MISMATCH');
 assert.equal(result.tests.find(t=>t.testId==='case-3').evidenceId,null);
 assert.equal(result.tests.find(t=>t.testId==='case-5').status,'NOT_EXECUTED');
});
