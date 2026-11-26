import { createHash } from 'node:crypto';

// Evidence contract: statuses describe observed execution; no confidence scores or certifications.
// Hash is a local integrity checksum, NOT a cryptographic signature or proof of trusted execution.
export const OBSERVATION_STATUSES = Object.freeze([
  'PASSED', 'FAILED', 'NOT_EXECUTED', 'INFRASTRUCTURE_ERROR', 'TIMEOUT',
]);

export function classifyExecution(result) {
  if (!result || typeof result !== 'object') return {status: 'INFRASTRUCTURE_ERROR', reason: 'Runner did not return an execution record'};
  if (result.error) return {status: 'INFRASTRUCTURE_ERROR', reason: String(result.error)};
  if (result.timedOut === true) return {status: 'TIMEOUT', reason: 'Execution deadline exceeded'};
  if (!Number.isInteger(result.exitCode) || result.exitCode < 0 || result.exitCode > 255) {
    return {status: 'INFRASTRUCTURE_ERROR', reason: 'Missing or invalid process exit code'};
  }
  // Docker exit code 125 indicates a Docker daemon/CLI error, not a failed test.
  if (result.exitCode === 125) return {status: 'INFRASTRUCTURE_ERROR', reason: 'Docker runtime failed'};
  if (result.exitCode === 0) return {status: 'PASSED', reason: 'Test command exited with code 0'};
  return {status: 'FAILED', reason: 'Test command exited with nonzero code ' + result.exitCode};
}

export function makeObservation({ checkId, command, runnerResult, environment }) {
  if (!checkId || typeof checkId !== 'string' || !command || typeof command !== 'string') throw new TypeError('checkId and command required');
  const { status, reason } = classifyExecution(runnerResult);
  return {
    checkId, command, status, reason,
    exitCode: Number.isInteger(runnerResult?.exitCode) ? runnerResult.exitCode : null,
    timedOut: runnerResult?.timedOut === true,
    environment,
    evidence: {
      stdoutStderr: typeof runnerResult?.output === 'string' ? runnerResult.output : '',
      captureTruncated: runnerResult?.outputTruncated === true,
      executorError: runnerResult?.error ? String(runnerResult.error) : null,
    },
    limitations: [
      'Only this named command was observed.',
      'A passing command is not evidence that all application functionality is correct.',
    ],
  };
}

export function sealReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new TypeError('Invalid report');
  if (!Array.isArray(report.observations) || report.observations.length === 0) throw new Error('Observations required');
  if (report.productionReady === true || report.certified === true || report.guaranteed === true) throw new Error('Unsupported certification claim');
  for (const obs of report.observations) {
    if (!OBSERVATION_STATUSES.includes(obs.status)) throw new Error('Unsupported observation status');
    if (obs.status === 'PASSED' && obs.exitCode !== 0) throw new Error('Cannot pass without exit code 0');
    if (obs.status === 'NOT_EXECUTED' && obs.exitCode !== null) throw new Error('Not-executed record cannot contain an exit code');
    if (obs.status === 'NOT_EXECUTED') {
      if (obs.timedOut === true || obs.evidence?.executorError) throw new Error('Inconsistent execution outcome');
    } else {
      const expected = classifyExecution({exitCode:obs.exitCode,timedOut:obs.timedOut,error:obs.evidence?.executorError});
      if (expected.status !== obs.status) throw new Error('Inconsistent execution outcome');
    }
  }
  const canonical = JSON.stringify(report);
  const digest = createHash('sha256').update(canonical).digest('hex');
  return { ...report, integrity: { algorithm: 'sha256', digest, assertion: 'checksum-only-not-signed' } };
}

export function verifyReportChecksum(report) {
  if (!report?.integrity || report.integrity.algorithm !== 'sha256' || report.integrity.assertion !== 'checksum-only-not-signed') return false;
  const { integrity, ...payload } = report;
  const expected = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return expected === integrity.digest;
}
