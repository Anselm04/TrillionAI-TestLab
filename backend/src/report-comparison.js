import { isDeepStrictEqual } from 'node:util';
import { sealReport, verifyReportChecksum } from './evidence.js';

function validate(report) {
  if (!verifyReportChecksum(report)) throw new Error('Report integrity check failed');
  const {integrity,...payload}=report;
  sealReport(payload);
  if (report.schemaVersion!==1 || typeof report.id!=='string' || !report.id ||
      typeof report.project!=='string' || !report.project || report.profile!=='node-built-in-tests' ||
      report.productionReady!==false || report.observations.length!==1 ||
      report.status!==report.observations[0].status) throw new Error('Incompatible reports');
  return report.observations[0];
}

// Descriptive comparison only. A mutable workspace or image label is not
// an immutable revision or an independently verified equivalent environment.
export function compareRunReports(before,after) {
  const a=validate(before),b=validate(after);
  if (before.id===after.id || before.project!==after.project ||
      a.checkId!==b.checkId || a.command!==b.command) throw new Error('Incompatible reports');
  const contextMatches=isDeepStrictEqual(a.environment,b.environment);
  const outcome=report=>({id:report.id,status:report.status,exitCode:report.observations[0].exitCode,integrityDigest:report.integrity.digest});
  return {
    schemaVersion:1,project:before.project,profile:before.profile,
    status:!contextMatches?'CONTEXT_DIFFERS':a.status===b.status&&a.exitCode===b.exitCode?'OBSERVATIONS_MATCH':'OBSERVATIONS_DIFFER',
    before:outcome(before),after:outcome(after),
    revisionComparison:'NOT_ESTABLISHED',environmentEquivalenceVerified:false,
    limitations:['Observed outcomes only; neither a matching result nor a changed result proves a defect was repaired.','The local runner does not establish immutable source or environment identity.'],
    productCertified:false,productionReady:false,
  };
}
