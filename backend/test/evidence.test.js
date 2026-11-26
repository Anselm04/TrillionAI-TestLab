import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyExecution, makeObservation, sealReport, verifyReportChecksum } from '../src/evidence.js';

test('a valid exit code zero is an observed test pass, not product certification', () => {
  const obs=makeObservation({checkId:'unit',command:'node --test',runnerResult:{exitCode:0,output:'ok'},environment:'isolated-linux'});
  assert.equal(obs.status,'PASSED');
  assert.match(obs.limitations.join(' '),/not evidence/);
});

test('test failure, timeout, missing runner, Docker runtime errors are distinct', () => {
  assert.equal(classifyExecution({exitCode:1}).status,'FAILED');
  assert.equal(classifyExecution({exitCode:125}).status,'INFRASTRUCTURE_ERROR');
  assert.equal(classifyExecution({exitCode:null}).status,'INFRASTRUCTURE_ERROR');
  assert.equal(classifyExecution(null).status,'INFRASTRUCTURE_ERROR');
  assert.equal(classifyExecution({exitCode:0,timedOut:true}).status,'TIMEOUT');
  assert.equal(classifyExecution({exitCode:0,error:'daemon unavailable'}).status,'INFRASTRUCTURE_ERROR');
});

test('refuse invented PASS and false readiness certifications', () => {
  const obs=makeObservation({checkId:'one',command:'node --test',runnerResult:{exitCode:1},environment:'linux'});
  assert.throws(()=>sealReport({observations:[{...obs,status:'PASSED'}]}),/Cannot pass/);
  assert.throws(()=>sealReport({observations:[obs],productionReady:true}),/certification/);
  assert.throws(()=>sealReport({observations:[{...obs,status:'NOT_EXECUTED'}]}),/Not-executed/);
});

test('record checksum detects modifications but is not a signature', () => {
  const obs=makeObservation({checkId:'unit',command:'node --test',runnerResult:{exitCode:0,output:'ok'},environment:'linux'});
  const sealed=sealReport({schemaVersion:2,observations:[obs],productionReady:false});
  assert.equal(sealed.integrity.assertion,'checksum-only-not-signed');
  assert.equal(verifyReportChecksum(sealed),true);
  assert.equal(verifyReportChecksum({...sealed,observations:[{...obs,status:'FAILED'}]}),false);
});

test('unexecuted test is never recorded as passing', () => {
  const obs=makeObservation({checkId:'missing',command:'node --test',runnerResult:undefined,environment:'linux'});
  assert.equal(obs.status,'INFRASTRUCTURE_ERROR');
});

test('sealing rejects contradictory execution outcomes', () => {
  const obs = makeObservation({checkId:'unit',command:'node --test',runnerResult:{exitCode:0},environment:'linux'});
  for (const change of [
    {timedOut:true},
    {evidence:{...obs.evidence,executorError:'runtime error'}},
    {status:'FAILED'},
    {status:'FAILED',exitCode:125},
    {status:'FAILED',exitCode:-1},
    {status:'TIMEOUT',timedOut:false},
    {status:'NOT_EXECUTED',exitCode:null,timedOut:true},
  ]) {
    assert.throws(() => sealReport({observations:[{...obs,...change}]}), /inconsistent/i);
  }
});

test('sealed reports are independent snapshots and reject contradictory single-check summaries', () => {
  const obs=makeObservation({checkId:'unit',command:'node --test',runnerResult:{exitCode:1},environment:'linux'});
  const draft={status:'FAILED',observations:[obs],productionReady:false};
  const sealed=sealReport(draft);
  draft.observations[0].reason='updated outside report';
  assert.notEqual(sealed.observations[0].reason,draft.observations[0].reason);
  assert.equal(verifyReportChecksum(sealed),true);
  assert.throws(()=>sealReport({...draft,status:'PASSED'}),/Inconsistent report status/);
});
