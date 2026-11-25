import {createHash} from 'node:crypto';
import {mkdtemp,readFile,lstat,realpath} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {runProcess} from './core.js';
const sha=/^[a-f0-9]{64}$/;
const ok=r=>r?.exitCode===0&&!r.error&&!r.timedOut&&!r.outputTruncated;
export function parseXcResultSummary(doc){
 const fields=['passedTests','failedTests','skippedTests','expectedFailures'];
 if(fields.some(k=>!Number.isSafeInteger(doc?.[k])||doc[k]<0))throw Error('Invalid test summary');
 const counts=Object.fromEntries(fields.map(k=>[k,doc[k]]));
 return {...counts,passed:doc.result==='Passed'&&counts.passedTests>0&&counts.failedTests===0&&counts.skippedTests===0&&counts.expectedFailures===0};
}
// Only prebuilt operator-approved test suites on a dedicated macOS host.
// The xctestrun and referenced binaries must reside in protected staging.
export function createXcuiExecutor({testRunPath,testRunSha256,artifactSha256,bundleId,evidenceRoot,runner=runProcess,hostPlatform=process.platform}={}){
 if(hostPlatform!=='darwin'||typeof testRunPath!=='string'||!isAbsolute(testRunPath)||!testRunPath.endsWith('.xctestrun')||!sha.test(testRunSha256??'')||!sha.test(artifactSha256??'')||typeof bundleId!=='string'||typeof evidenceRoot!=='string'||!isAbsolute(evidenceRoot))throw Error('Trusted XCUITest configuration required');
 return async context=>{
  const blocked=(reason,extra={})=>({status:'BLOCKED',reason,...extra,productionReady:false,deploymentAuthorized:false});
  if(context?.artifactSha256!==artifactSha256||context.bundleId!==bundleId||typeof context.deviceId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9-]{0,120}$/.test(context.deviceId))return blocked('Execution context mismatch');
  let resultBundle;
  try{
   const stat=await lstat(testRunPath);
   if(!stat.isFile()||stat.size>4194304||await realpath(testRunPath)!==testRunPath)return blocked('Invalid test plan');
   if(createHash('sha256').update(await readFile(testRunPath)).digest('hex')!==testRunSha256)return blocked('Test plan digest mismatch');
   const dir=await mkdtemp(join(evidenceRoot,'xcui-'));
   resultBundle=join(dir,'result.xcresult');
   const run=await runner('xcodebuild',['test-without-building','-xctestrun',testRunPath,'-destination','platform=iOS,id='+context.deviceId,'-parallel-testing-enabled','NO','-resultBundlePath',resultBundle],{timeoutMs:210000,outputLimit:262144});
   if(!ok(run))return blocked('Test command failed',{resultBundle});
   const summary=await runner('xcrun',['xcresulttool','get','test-results','summary','--path',resultBundle,'--format','json'],{timeoutMs:20000,outputLimit:262144});
   if(!ok(summary))return blocked('Result summary unavailable',{resultBundle});
   const counts=parseXcResultSummary(JSON.parse(summary.output));
   return {status:counts.passed?'COMMAND_SUCCEEDED':'BLOCKED',counts,resultBundle,testRunSha256,artifactSha256,deviceId:context.deviceId,independentReview:'PENDING',productionReady:false,deploymentAuthorized:false};
  }catch{return blocked('XCUITest infrastructure or result schema failure',{resultBundle});}
 };
}
