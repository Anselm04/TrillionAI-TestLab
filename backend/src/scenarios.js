export const FAILURE_CATEGORIES = Object.freeze([
  { id: 'AUTH', title: 'Authentication and authorization', severity: 'critical' },
  { id: 'INPUT', title: 'Input validation and injection', severity: 'high' },
  { id: 'DATA', title: 'Database integrity and isolation', severity: 'critical' },
  { id: 'PAY', title: 'Payments and financial safety', severity: 'critical' },
  { id: 'API', title: 'API and integration failures', severity: 'high' },
  { id: 'DEPLOY', title: 'Configuration and deployment', severity: 'high' },
  { id: 'RACE', title: 'Concurrency and race conditions', severity: 'high' },
  { id: 'PERF', title: 'Performance and exhaustion', severity: 'medium' },
  { id: 'UI', title: 'Frontend user journeys', severity: 'medium' },
  { id: 'RECOVERY', title: 'Failure handling and recovery', severity: 'high' },
  { id: 'SUPPLY', title: 'Dependency and supply chain risks', severity: 'high' },
  { id: 'AGENT', title: 'AI tool access and spending limits', severity: 'critical' },
].map(Object.freeze));

export function createCoveragePlan(requirements = []) {
  if (!Array.isArray(requirements) || requirements.some(r => typeof r !== 'string' || r.length === 0 || r.length > 500)) throw new Error('Invalid requirements');
  return {
    schemaVersion: 1,
    categories: FAILURE_CATEGORIES.map(category => ({
      ...category,
      status: 'UNTESTED',
      evidence: [],
      reason: 'No applicable scenario executed',
    })),
    requirements: requirements.map((statement, index) => ({
      id: 'REQ-' + String(index + 1).padStart(3, '0'),
      statement,
      status: 'UNTESTED',
      evidence: [],
    })),
    productionReady: false, // Legacy compatibility: TestLab does not certify software.
    allDeclaredChecksEvidenced: false,
  };
}

export function computeReadiness(plan) {
  if (!Array.isArray(plan?.categories) || !Array.isArray(plan?.requirements)) throw new Error('Invalid plan');
  const expectedCategories = new Set(FAILURE_CATEGORIES.map(c=>c.id));
  if (plan.categories.length !== expectedCategories.size || plan.categories.some(c=>!expectedCategories.delete(c?.id))) throw new Error('Invalid coverage categories');
  const requirementIds = new Set();
  for(const requirement of plan.requirements) {
    if (typeof requirement?.id !== 'string' || !/^REQ-[0-9]{3,}$/.test(requirement.id) || requirementIds.has(requirement.id)) throw new Error('Invalid requirement');
    requirementIds.add(requirement.id);
  }
  const checks = [...plan.categories, ...plan.requirements];
  const failing = checks.filter(x => x.status === 'FAILED');
  const unknown = checks.filter(x => !['PASSED','NOT_APPLICABLE','FAILED'].includes(x.status));
  // A category cannot be marked not applicable without independently supplied evidence.
  const unevidenced = checks.filter(x => ['PASSED','NOT_APPLICABLE'].includes(x.status) && (!Array.isArray(x.evidence) || x.evidence.length === 0 || x.evidence.some(ref=>typeof ref !== 'string' || !ref.trim())));
  return {
    productionReady: false,
    allDeclaredChecksEvidenced: checks.length > 0 && failing.length === 0 && unknown.length === 0 && unevidenced.length === 0,
    failing: failing.map(x => x.id),
    unverified: [...unknown, ...unevidenced].map(x => x.id),
  };
}
