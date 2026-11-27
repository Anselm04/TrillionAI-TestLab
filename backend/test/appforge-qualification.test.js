import test from 'node:test';
import assert from 'node:assert/strict';
import { appForgeQualificationTemplate, createAppForgeQualificationPlan } from '../src/appforge-qualification.js';
import { evaluateTraceability } from '../src/requirement-traceability.js';

test('AppForge functional scope is versioned, unique and entirely untested before submission',()=>{
 const template=appForgeQualificationTemplate();
 assert.equal(template.product,'AppForge');
 assert.equal(template.version,1);
 assert.equal(template.productionReady,false);
 assert.equal(template.requirements.length,19);
 assert.equal(new Set(template.requirements.map(r=>r.id)).size,19);
 assert.ok(template.requirements.every(r=>r.status==='NOT_EXECUTED'));
 template.requirements.pop();
 assert.equal(appForgeQualificationTemplate().requirements.length,19);
});

test('a revision-bound AppForge plan preserves every declared requirement even without mapped tests',async()=>{
 const revisionSha256='a'.repeat(64);
 const plan=createAppForgeQualificationPlan({revisionSha256});
 const assessment=await evaluateTraceability({plan,observations:[],verifyObservation:async()=>false});
 assert.equal(assessment.counts.NOT_TESTED,19);
 assert.equal(assessment.counts.PASSED,0);
 assert.equal(assessment.productionReady,false);
 assert.throws(()=>createAppForgeQualificationPlan({revisionSha256:'unknown'}),/Invalid traceability plan/);
});
