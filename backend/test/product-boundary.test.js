import test from 'node:test';
import assert from 'node:assert/strict';
import { TESTLAB_ROLE, ALLOWED_OPERATIONS, FORBIDDEN_OPERATIONS, authorizeProductOperation } from '../src/product-boundary.js';
import { createSandboxSession, authorizeCommand } from '../src/sandbox-policy.js';

test('product is explicitly testing-only', () => {
  assert.equal(TESTLAB_ROLE,'TESTER_ONLY');
  assert.ok(ALLOWED_OPERATIONS.length > 0);
  for (const action of FORBIDDEN_OPERATIONS) assert.equal(authorizeProductOperation(action).authorized,false);
  for (const action of ALLOWED_OPERATIONS) assert.equal(authorizeProductOperation(action).authorized,true);
  assert.equal(authorizeProductOperation('ARBITRARY_COMMAND').authorized,false);
});

test('phase-one sandbox does not authorize editing or deployment tools', () => {
  const session=createSandboxSession({project:'node-sample'});
  for(const tool of ['patch','shell','write-file','git-push','deploy','compile-release','repair-code']){
    assert.equal(authorizeCommand(session,{tool}).authorized,false,tool);
  }
  assert.equal(authorizeCommand(session,{tool:'node-test'}).authorized,true);
});
