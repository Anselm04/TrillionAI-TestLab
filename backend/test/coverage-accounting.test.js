import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoveragePlan, computeReadiness } from '../src/scenarios.js';

const reviewedPlan = () => {
  const plan = createCoveragePlan(['Customer sees the expected total']);
  return {
    ...plan,
    categories: plan.categories.map(c=>({...c,status:'NOT_APPLICABLE',evidence:['scope-review']})),
    requirements: plan.requirements.map(r=>({...r,status:'PASSED',evidence:['observed-total']})),
  };
};

test('coverage accounting cannot omit or duplicate required categories', () => {
  const plan=reviewedPlan();
  assert.equal(computeReadiness(plan).allDeclaredChecksEvidenced,true);
  assert.throws(()=>computeReadiness({...plan,categories:plan.categories.slice(1)}),/Invalid coverage categories/);
  assert.throws(()=>computeReadiness({...plan,categories:[...plan.categories,plan.categories[0]]}),/Invalid coverage categories/);
  assert.throws(()=>computeReadiness({...plan,requirements:[...plan.requirements,plan.requirements[0]]}),/Invalid requirement/);
});

test('only nonblank evidence references count towards declared coverage', () => {
  for(const evidence of [[],[''],['   '],[null],[{}]]) {
    const plan=reviewedPlan();
    plan.requirements[0].evidence=evidence;
    const result=computeReadiness(plan);
    assert.equal(result.allDeclaredChecksEvidenced,false);
    assert.deepEqual(result.unverified,['REQ-001']);
    assert.equal(result.productionReady,false);
  }
});
