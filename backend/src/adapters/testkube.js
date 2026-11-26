// TestLab-owned adapter boundary; no upstream code bundled.
export const TESTKUBE_SOURCE = Object.freeze({
  upstream: 'https://github.com/kubeshop/testkube',
  revision: '10a4281347cc677912a527bec34caa79880f87af',
  reference: 'https://github.com/Anselm04/Testkube-Source-Code-Reference',
  referenceCommit: '51697966d39ee714c7e5ef9d6dadb8fd92f2b444'
});
export function testkubeCapability() {
  return Object.freeze({
    adapter: 'testkube',
    status: 'UNTESTED',
    enabled: false,
    reason: 'Licence, dependency, standalone execution and isolation qualification required',
    source: TESTKUBE_SOURCE
  });
}
export async function executeTestkube() {
  // Fail closed until qualified execution transport and evidence validation exist.
  return testkubeCapability();
}
