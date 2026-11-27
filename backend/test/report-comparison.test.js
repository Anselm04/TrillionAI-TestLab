import test from 'node:test';
import assert from 'node:assert/strict';
import { makeObservation, sealReport } from '../src/evidence.js';
import { compareRunReports } from '../src/report-comparison.js';

const fixture=(id,exitCode,project='sample',image='node:22-alpine')=>{
  const observation=makeObservation({checkId:'node-built-in-tests',command:'node --test',runnerResult:{exitCode},environment:{image}});
  return sealReport({schemaVersion:1,id,project,profile:'node-built-in-tests',status:observation.status,observations:[observation],sourceRevision:{status:'UNKNOWN',sha:null},productionReady:false});
};

test('comparison retains both observed outcomes without claiming the defect was fixed',()=>{
  const before=fixture('run-a',1),after=fixture('run-b',0);
  const result=compareRunReports(before,after);
  assert.equal(result.status,'OBSERVATIONS_DIFFER');
  assert.equal(result.before.status,'FAILED');
  assert.equal(result.after.status,'PASSED');
  assert.equal(result.revisionComparison,'NOT_ESTABLISHED');
  assert.equal(result.productCertified,false);
  assert.equal(before.status,'FAILED');
  assert.equal(compareRunReports(before,fixture('run-c',1)).status,'OBSERVATIONS_MATCH');
});

test('comparison refuses mismatched projects, reused reports and corrupted records',()=>{
  const before=fixture('run-a',1);
  assert.throws(()=>compareRunReports(before,fixture('run-b',0,'another')), /Incompatible reports/);
  assert.throws(()=>compareRunReports(before,before), /Incompatible reports/);
  assert.throws(()=>compareRunReports(before,{...fixture('run-b',0),status:'FAILED'}), /Report integrity/);
  assert.equal(compareRunReports(before,fixture('run-b',0,'sample','node:24')).status,'CONTEXT_DIFFERS');
});
