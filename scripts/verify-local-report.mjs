import {pathToFileURL} from 'node:url';
import {readStoredReport} from '../backend/src/core.js';
import {sealReport,OBSERVATION_STATUSES} from '../backend/src/evidence.js';

const reportId=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sha256=/^[a-f0-9]{64}$/;

// The operator must independently retain the expected digest. A checksum
// comparison is not verification of the author, test execution or readiness.
export async function verifyLocalReport({reportRoot,id,expectedDigest}={}){
 const result=(status,extra={})=>({schemaVersion:1,status,id:typeof id==='string'&&reportId.test(id)?id:null,
  ...extra,originVerified:false,productionReady:false,deploymentAuthorized:false});
 if(typeof reportRoot!=='string'||!reportRoot.trim()||typeof id!=='string'||!reportId.test(id)||typeof expectedDigest!=='string'||!sha256.test(expectedDigest))return result('INVALID_INPUT');
 try{
  const report=await readStoredReport(reportRoot,id);
  if(!report)return result('REPORT_MISSING');
  if(report.integrity.digest!==expectedDigest)return result('DIGEST_MISMATCH');
  const {integrity,...body}=report;
  sealReport(body);
  if(report.schemaVersion!==1||report.productionReady!==false||!OBSERVATION_STATUSES.includes(report.status))return result('REPORT_UNAVAILABLE');
  return result('MATCHED_RETAINED_DIGEST',{observedStatus:report.status,integrityDigest:integrity.digest});
 }catch{return result('REPORT_UNAVAILABLE');}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [reportRoot,id,expectedDigest]=process.argv.slice(2);
 const result=await verifyLocalReport(process.argv.length===5?{reportRoot,id,expectedDigest}:{});
 process.stdout.write(JSON.stringify(result)+'\n');
 process.exitCode=result.status==='MATCHED_RETAINED_DIGEST'?0:result.status==='INVALID_INPUT'?2:1;
}
