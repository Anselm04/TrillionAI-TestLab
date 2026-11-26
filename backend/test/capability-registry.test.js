import test from 'node:test';
import assert from 'node:assert/strict';
import { TEST_DOMAINS, catalogCapabilities, planRequestedChecks, summarizeExecutedChecks } from '../src/capability-registry.js';

test('capability inventory has unique domains and only the implemented Node.js check', () => {
  const catalog = catalogCapabilities();
  assert.equal(catalog.length, TEST_DOMAINS.length);
  assert.equal(new Set(catalog.map(x=>x.id)).size, catalog.length);
  assert.equal(catalog.filter(x=>x.implementationStatus === 'PARTIAL').length, 1);
  assert.equal(catalog.find(x=>x.id === 'security').implementationStatus, 'NOT_IMPLEMENTED');
  assert.ok(catalog.every(x=>x.runStatus === 'NOT_EXECUTED'));
});

test('all requested scenarios start not executed and unknown categories cannot pass', () => {
  const plan = planRequestedChecks(['functional', 'security', 'payments', 'an-unknown-test']);
  assert.equal(plan.checks.length, 4);
  assert.ok(plan.checks.every(x=>x.status === 'NOT_EXECUTED'));
  assert.equal(plan.checks.find(x=>x.domain === 'security').checkId,null);
  assert.match(plan.checks.find(x=>x.domain === 'an-unknown-test').reason,/Unknown/);
  assert.equal(plan.claims.certification,false);
});

test('only the actual matching execution can change a check outcome', () => {
  const plan=planRequestedChecks(['functional','security']);
  const report=summarizeExecutedChecks(plan,[{checkId:'node.builtin-test',status:'PASSED',exitCode:0,reason:'Observed exit code zero'}]);
  assert.equal(report.checks[0].status,'PASSED');
  assert.equal(report.checks[1].status,'NOT_EXECUTED');
  assert.equal(report.productCertified,false);
});

test('invalid result and invented successful observation are rejected', () => {
  const plan=planRequestedChecks(['functional']);
  assert.throws(()=>summarizeExecutedChecks(plan,[{checkId:'node.builtin-test',status:'PASSED',exitCode:3}]),/Evidence mismatch/);
  assert.throws(()=>summarizeExecutedChecks(plan,[{checkId:'node.builtin-test',status:'FAILED',exitCode:0}]),/Evidence mismatch/);
  assert.throws(()=>summarizeExecutedChecks(plan,[{checkId:'node.builtin-test',status:'IMAGINED',exitCode:0}]),/Invalid/);
  assert.throws(()=>planRequestedChecks(['security','security']),/Duplicate/);
  assert.throws(()=>summarizeExecutedChecks(plan,[{checkId:'fictional.check',status:'PASSED',exitCode:0}]),/not in the declared plan/);
});

test('summary rejects pre-populated outcomes and evidence in an unexecuted plan', () => {
  for (const change of [{status:'PASSED'}, {evidence:['unverified']}]) {
    const plan = planRequestedChecks(['functional']);
    Object.assign(plan.checks[0], change);
    assert.throws(() => summarizeExecutedChecks(plan, []), /Invalid plan check/);
  }
});

test('summary rejects duplicate domains and inconsistent declared check identities', () => {
  const plan = planRequestedChecks(['functional', 'payments']);
  plan.checks[1].checkId = 'node.builtin-test';
  assert.throws(() => summarizeExecutedChecks(plan, []), /Invalid plan check/);
  const duplicate = planRequestedChecks(['functional']);
  duplicate.checks.push({...duplicate.checks[0]});
  assert.throws(() => summarizeExecutedChecks(duplicate, []), /Invalid plan check/);
});
