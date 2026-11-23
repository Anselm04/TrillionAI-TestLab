// Policy is checked before command dispatch; security must also be enforced by the worker.
import { randomUUID } from 'node:crypto';

export const DEFAULT_SANDBOX_POLICY = Object.freeze({
  maxCommands: 30,
  maxDurationMs: 120000,
  maxCpu: 1,
  maxMemoryMb: 512,
  maxDiskMb: 512,
  network: 'none',
  allowHostShell: false,
  allowProductionSecrets: false,
  maxAiSpendUsd: 0,
});

export function createSandboxSession({ project, policy = {} }) {
  if (typeof project !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(project) || project === '.' || project === '..') {
    throw new Error('Invalid project directory');
  }
  const merged = { ...DEFAULT_SANDBOX_POLICY, ...policy };
  if (merged.allowHostShell !== false || merged.allowProductionSecrets !== false || merged.network !== 'none') {
    throw new Error('Sandbox boundary cannot be relaxed by a job');
  }
  for (const key of ['maxCommands','maxDurationMs','maxCpu','maxMemoryMb','maxDiskMb']) {
    if (!Number.isFinite(merged[key]) || merged[key] <= 0 || merged[key] > DEFAULT_SANDBOX_POLICY[key]) {
      throw new Error('Invalid or excessive sandbox limit: ' + key);
    }
  }
  if (merged.maxAiSpendUsd !== 0) throw new Error('Paid AI usage is not enabled');
  return {
    sessionId: randomUUID(),
    project,
    policy: Object.freeze(merged),
    commandsUsed: 0,
    state: 'CREATED',
  };
}

export function authorizeCommand(session, request) {
  if (session.state === 'CLOSED') return { authorized: false, reason: 'Session closed' };
  if (session.commandsUsed >= session.policy.maxCommands) return { authorized: false, reason: 'Command limit reached' };
  if (!request || typeof request !== 'object' || Array.isArray(request)) return { authorized: false, reason: 'Invalid request' };
  // No shell strings, host command injection, arbitrary executables, or shell expansion.
  if (request.tool !== 'node-test') return { authorized: false, reason: 'Tool not available in Phase 1' };
  if (Object.keys(request).some(key => !['tool'].includes(key))) return { authorized: false, reason: 'Unexpected command properties' };
  return { authorized: true, command: { tool: 'node-test' } };
}

export function recordAuthorizedCommand(session) {
  const next = { ...session, commandsUsed: session.commandsUsed + 1, state: 'RUNNING' };
  return next;
}
