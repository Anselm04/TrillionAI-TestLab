// TestLab's observable coverage inventory. Entries are declarations of what
// verification adapters can execute, never probabilities or product guarantees.
export const TEST_DOMAINS = Object.freeze([
  { id: 'functional', label: 'Functional and end-to-end testing' },
  { id: 'security', label: 'Application security and authorization' },
  { id: 'data', label: 'Database integrity, migration and privacy' },
  { id: 'api', label: 'API and third-party integration' },
  { id: 'payments', label: 'Payments, subscriptions and financial integrity' },
  { id: 'resilience', label: 'Recovery, fault injection and chaos' },
  { id: 'performance', label: 'Load, stress, soak and resource usage' },
  { id: 'concurrency', label: 'Concurrency, races and idempotency' },
  { id: 'compatibility', label: 'Devices, browsers and operating systems' },
  { id: 'accessibility', label: 'Accessibility and user workflows' },
  { id: 'supply-chain', label: 'Dependencies, provenance and secrets' },
  { id: 'ai', label: 'AI tools, prompt injection and expenditure boundaries' },
  { id: 'testing-quality', label: 'Mutation testing, flaky tests and test calibration' },
  { id: 'deployment', label: 'Deployment configuration and rollback rehearsal' },
]);

// Only the implemented Node.js runner is marked executable.
// Other domains are planned and MUST remain untested until a real adapter exists.
export const IMPLEMENTED_CHECKS = Object.freeze([
  {
    id: 'node.builtin-test',
    adapter: 'node',
    domain: 'functional',
    title: 'Node.js built-in test command',
    execution: 'docker-node22',
    command: 'node --test',
    prerequisites: ['trusted-local-source', 'docker', 'node22-image'],
    supportedPlatform: 'linux',
    limitation: 'Runs tests present in the submitted project; does not independently determine overall functional completeness.',
  },
]);

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 300) throw new TypeError('Invalid ' + name);
  return value;
}

export function catalogCapabilities() {
  const implemented = new Map(IMPLEMENTED_CHECKS.map(check => [check.domain, check]));
  return TEST_DOMAINS.map(domain => ({
    ...domain,
    availableChecks: IMPLEMENTED_CHECKS.filter(check => check.domain === domain).map(check => ({...check, prerequisites:[...check.prerequisites]})),
    implementationStatus: implemented.has(domain.id) ? 'PARTIAL' : 'NOT_IMPLEMENTED',
    // Every domain remains untested until a particular customer run executes it.
    runStatus: 'NOT_EXECUTED',
  }));
}

export function planRequestedChecks(requestedDomains, supportedCheckIds = IMPLEMENTED_CHECKS.map(x=>x.id)) {
  if (!Array.isArray(requestedDomains)) throw new TypeError('requestedDomains must be an array');
  if (!Array.isArray(supportedCheckIds)) throw new TypeError('supportedCheckIds must be an array');
  const knownDomains = new Map(TEST_DOMAINS.map(x=>[x.id,x]));
  const checks = [];
  for (const raw of requestedDomains) {
    const domainId = requiredString(raw, 'domain');
    if (checks.some(x=>x.domain === domainId)) throw new Error('Duplicate domain: ' + domainId);
    const domain = knownDomains.get(domainId);
    const check = IMPLEMENTED_CHECKS.find(x=>x.domain === domainId && supportedCheckIds.includes(x.id));
    checks.push({
      domain: domainId,
      title: domain?.label ?? 'Unknown testing domain',
      checkId: check?.id ?? null,
      status: 'NOT_EXECUTED',
      reason: !domain ? 'Unknown testing domain' : !check ? 'No verified test adapter available for this domain' : 'Test has not been executed',
      evidence: [],
    });
  }
  return {
    schemaVersion: 1,
    checks,
    claims: { certification: false, guarantees: false, safetyProbability: null },
  };
}

export function summarizeExecutedChecks(plan, observations) {
  if (!Array.isArray(plan?.checks) || !Array.isArray(observations)) throw new TypeError('Invalid plan or observations');
  const allowed = new Set(['PASSED', 'FAILED', 'TIMEOUT', 'INFRASTRUCTURE_ERROR']);
  const ids = new Set();
  for (const observation of observations) {
    if (!observation || !allowed.has(observation.status) || typeof observation.checkId !== 'string') throw new Error('Invalid observation');
    if (ids.has(observation.checkId)) throw new Error('Duplicate observation');
    ids.add(observation.checkId);
  }
  const result = plan.checks.map(check => {
    const obs = observations.find(o=>o.checkId === check.checkId && check.checkId !== null);
    if (!obs) return {...check};
    if (!IMPLEMENTED_CHECKS.some(x=>x.id === check.checkId && x.domain === check.domain)) throw new Error('Unrecognized check');
    if (obs.status === 'PASSED' && obs.exitCode !== 0) throw new Error('Evidence mismatch: PASS without exit code zero');
    if (obs.status === 'FAILED' && (!Number.isInteger(obs.exitCode) || obs.exitCode === 0)) throw new Error('Evidence mismatch: FAILED without nonzero exit');
    return { ...check, status: obs.status, reason: obs.reason ?? 'See execution evidence', evidence: [obs.checkId] };
  });
  // It is impossible for this function to label the entire product production ready.
  return { schemaVersion: 1, checks: result, productCertified: false };
}
