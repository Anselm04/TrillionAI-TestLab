import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TESTKUBE_SOURCE, testkubeCapability, executeTestkube } from '../src/adapters/testkube.js';
test('Testkube is pinned and unavailable until qualification', async () => {
  assert.match(TESTKUBE_SOURCE.revision, /^[a-f0-9]{40}$/);
  assert.equal(testkubeCapability().enabled, false);
  assert.equal((await executeTestkube({ enabled: true })).status, 'UNTESTED');
});
