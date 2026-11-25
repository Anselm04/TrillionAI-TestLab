import { randomUUID } from 'node:crypto';
import { runProcess } from './core.js';

const serialPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export function parseAdbInventory(output) {
  if (typeof output !== 'string') throw new TypeError('ADB output required');
  const devices = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = /^([^\s]+)\s+(device|offline|unauthorized|recovery|bootloader)(?:\s+(.*))?$/.exec(line.trim());
    if (!match || !serialPattern.test(match[1])) continue;
    const [,id,state,details=''] = match;
    const model = /(?:^|\s)model:([^\s]+)/.exec(details)?.[1] ?? null;
    devices.set(id, { id, platform: 'android', state, model, kind: 'unverified', available: state === 'device' });
  }
  return [...devices.values()];
}

export async function discoverAndroid({ runner = runProcess } = {}) {
  const result = await runner('adb', ['devices', '-l'], {timeoutMs: 10000, outputLimit: 64000});
  if (result?.error || result?.timedOut || result?.exitCode !== 0 || typeof result.output !== 'string' || result.outputTruncated) {
    return {status:'INFRASTRUCTURE_ERROR', devices:[]};
  }
  return {status:'DISCOVERED', devices:parseAdbInventory(result.output)};
}

// Local single-worker lease coordinator. Not a distributed lock.
export class DevicePool {
  #devices = new Map();
  #leases = new Map();
  constructor({clock = Date.now} = {}) { this.clock = clock; }
  refresh(devices) {
    if (!Array.isArray(devices)) throw new TypeError('Device inventory required');
    const next = new Map();
    for (const device of devices) {
      if (!serialPattern.test(device?.id ?? '') || device.platform !== 'android' || next.has(device.id)) throw new Error('Invalid or duplicate device');
      next.set(device.id, {...device});
    }
    this.#devices = next;
  }
  acquire({deviceId, runId, durationMs = 60000}) {
    if (typeof runId !== 'string' || !runId.trim() || runId.length > 128 || !Number.isSafeInteger(durationMs) || durationMs < 1000 || durationMs > 3600000) throw new Error('Invalid lease request');
    const device = this.#devices.get(deviceId);
    if (!device || device.state !== 'device' || device.available !== true || this.#leases.has(deviceId)) return null;
    const lease = {deviceId, runId, token:randomUUID(), expiresAt:this.clock()+durationMs};
    this.#leases.set(deviceId, lease);
    return {...lease};
  }
  // Expiry quarantines the device; it does not silently reassign running hardware.
  status(deviceId) {
    const lease = this.#leases.get(deviceId);
    if (lease) return lease.expiresAt <= this.clock() ? 'QUARANTINED' : 'LEASED';
    return this.#devices.get(deviceId)?.available === true && this.#devices.get(deviceId)?.state === 'device' ? 'AVAILABLE' : 'UNAVAILABLE';
  }
  release(deviceId, token, {cleanupVerified = false} = {}) {
    const lease = this.#leases.get(deviceId);
    if (!lease || lease.token !== token || cleanupVerified !== true) return false;
    this.#leases.delete(deviceId);
    return true;
  }
}

// This assesses declared coverage only; never deploys or certifies a product.
export function evaluateDeviceGate(requiredChecks, observations) {
  if (!Array.isArray(requiredChecks) || !requiredChecks.length || !Array.isArray(observations)) throw new TypeError('Nonempty requirements and observations required');
  const expected = new Set(requiredChecks);
  if (expected.size !== requiredChecks.length || requiredChecks.some(x=>typeof x !== 'string' || !x.trim())) throw new Error('Invalid requirements');
  const seen = new Map();
  for (const obs of observations) {
    if (!expected.has(obs?.checkId) || seen.has(obs.checkId)) throw new Error('Unexpected or duplicate observation');
    seen.set(obs.checkId, obs);
  }
  const checks = requiredChecks.map(checkId=>{
    const obs = seen.get(checkId);
    const verified = obs?.status === 'PASSED' && obs.exitCode === 0 && obs.timedOut === false && typeof obs.evidenceDigest === 'string' && /^[a-f0-9]{64}$/.test(obs.evidenceDigest) && obs.independentReview === 'VERIFIED';
    return {checkId, status:verified ? 'PASSED' : obs?.status === 'FAILED' ? 'FAILED' : 'NOT_VERIFIED'};
  });
  return {status:checks.every(x=>x.status==='PASSED') ? 'EVIDENCE_REVIEW_REQUIRED' : 'BLOCKED', checks, productionReady:false, deploymentAuthorized:false};
}
