import test from 'node:test';
import assert from 'node:assert/strict';
import { sum } from '../math.js';
test('real sample project', () => assert.equal(sum(2,3),5));
