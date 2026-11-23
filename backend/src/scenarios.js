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
]);

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
    productionReady: false,
  };
}

export function computeReadiness(plan) {
  if (!plan?.categories || !plan?.requirements) throw new Error('Invalid plan');
  const checks = [...plan.categories, ...plan.requirements];
  const failing = checks.filter(x => x.status === 'FAILED');
  const unknown = checks.filter(x => !['PASSED','NOT_APPLICABLE','FAILED'].includes(x.status));
  // A category cannot be marked not applicable without independently supplied evidence.
  const unevidenced = checks.filter(x => ['PASSED','NOT_APPLICABLE'].includes(x.status) && (!Array.isArray(x.evidence) || x.evidence.length === 0));
  return {
    productionReady: failing.length === 0 && unknown.length === 0 && unevidenced.length === 0,
    failing: failing.map(x => x.id),
    unverified: [...unknown, ...unevidenced].map(x => x.id),
  };
}
