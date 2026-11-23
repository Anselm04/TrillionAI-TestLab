// Explicit adapter capabilities: unsupported platforms never receive a PASS.
const adapters = Object.freeze({
  node: Object.freeze({
    id: 'node',
    label: 'Node.js built-in test runner',
    status: 'implemented',
    capabilities: Object.freeze(['unit-tests']),
    environments: Object.freeze(['linux-container']),
  }),
  flutter: Object.freeze({
    id: 'flutter',
    label: 'Flutter application',
    status: 'planned',
    capabilities: Object.freeze([]),
    environments: Object.freeze([]),
  }),
  python: Object.freeze({
    id: 'python',
    label: 'Python application',
    status: 'planned',
    capabilities: Object.freeze([]),
    environments: Object.freeze([]),
  }),
  web: Object.freeze({
    id: 'web',
    label: 'Browser end-to-end testing',
    status: 'planned',
    capabilities: Object.freeze([]),
    environments: Object.freeze([]),
  }),
});

export function listAdapters() {
  return Object.values(adapters).map(x => ({
    ...x,
    capabilities: [...x.capabilities],
    environments: [...x.environments],
  }));
}

export function resolveAdapter(id, capability) {
  const entry = adapters[id];
  if (!entry) return { status: 'UNSUPPORTED', reason: 'Unknown adapter', id };
  if (entry.status !== 'implemented' || !entry.capabilities.includes(capability)) {
    return { status: 'UNTESTED', reason: 'Adapter capability not implemented', id, capability };
  }
  return { status: 'AVAILABLE', adapter: { ...entry } };
}
