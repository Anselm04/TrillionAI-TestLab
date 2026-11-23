import test from 'node:test';
import assert from 'node:assert/strict';
import { listAdapters, resolveAdapter } from '../src/adapters.js';
import { createSandboxSession, authorizeCommand, recordAuthorizedCommand } from '../src/sandbox-policy.js';
import { createCoveragePlan, computeReadiness, FAILURE_CATEGORIES } from '../src/scenarios.js';

test('node unit test is supported; other technologies remain explicitly untested', () => {
  assert.equal(resolveAdapter('node','unit-tests').status,'AVAILABLE');
  assert.equal(resolveAdapter('flutter','unit-tests').status,'UNTESTED');
  assert.equal(resolveAdapter('unsupported','unit-tests').status,'UNSUPPORTED');
  assert.equal(listAdapters().length,4);
});

test('sandbox rejects attempts to grant host-shell, network and paid privileges', () => {
  for (const policy of [{allowHostShell:true},{network:'host'},{allowProductionSecrets:true},{maxAiSpendUsd:1},{maxMemoryMb:9999}]) {
    assert.throws(()=>createSandboxSession({project:'node-sample',policy}));
  }
  assert.throws(()=>createSandboxSession({project:'../etc'}));
});

test('terminal tool contract denies arbitrary shell and only permits built-in test execution', () => {
  const session=createSandboxSession({project:'node-sample',policy:{maxCommands:1}});
  assert.equal(authorizeCommand(session,{tool:'shell',command:'rm -rf /'}).authorized,false);
  assert.equal(authorizeCommand(session,{tool:'node-test',command:'anything'}).authorized,false);
  assert.equal(authorizeCommand(session,{tool:'node-test'}).authorized,true);
  const updated=recordAuthorizedCommand(session);
  assert.equal(authorizeCommand(updated,{tool:'node-test'}).authorized,false);
});

test('readiness starts unverified and cannot pass with missing evidence', () => {
  const plan=createCoveragePlan(['Customer can register']);
  assert.equal(plan.categories.length,FAILURE_CATEGORIES.length);
  assert.equal(plan.productionReady,false);
  assert.equal(computeReadiness(plan).productionReady,false);
  const modified={
    categories:plan.categories.map(c=>({...c,status:'PASSED',evidence:[]})),
    requirements:plan.requirements.map(r=>({...r,status:'PASSED',evidence:[]})),
  };
  assert.equal(computeReadiness(modified).productionReady,false);
});

test('readiness needs evidence on every declared requirement and applicable category', () => {
  const plan=createCoveragePlan(['Login works']);
  const result=computeReadiness({
    categories:plan.categories.map(c=>({...c,status:'NOT_APPLICABLE',evidence:['reviewed applicability']})),
    requirements:plan.requirements.map(r=>({...r,status:'PASSED',evidence:['run-123']})),
  });
  assert.equal(result.productionReady,false);
  assert.equal(result.allDeclaredChecksEvidenced,true);
});
