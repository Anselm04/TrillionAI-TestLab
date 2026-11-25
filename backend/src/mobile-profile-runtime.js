import {createHash} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {discoverAndroid} from './device-farm.js';
import {discoverIos} from './ios-inventory.js';
import {DurableDeviceLeases} from './durable-device-leases.js';
import {MobileEvidenceStore} from './mobile-evidence.js';
import {LeasedAndroidSupervisor} from './leased-android-supervisor.js';
import {MobileReviewOrchestrator} from './mobile-review-orchestrator.js';
import {LeasedIosSupervisor} from './leased-ios-supervisor.js';
import {createIosCoreDeviceAdapter} from './ios-coredevice-adapter.js';
import {createIosEvidenceExecutor} from './ios-media-evidence.js';
import {createXcuiExecutor} from './xcuitest-execution.js';
import {createIosReviewOrchestrator} from './ios-review-orchestrator.js';
import {compileExecutionPlan,validateJourney} from './mobile-journey.js';
import {createAppiumExecutor} from './appium-journey.js';
const sha=/^[a-f0-9]{64}$/;
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const digest=x=>typeof x==='string'&&sha.test(x);
const abs=x=>typeof x==='string'&&isAbsolute(x);
// Only operator-owned profiles. The explicit isolation declaration is not a
// measurement of physical or network isolation; dedicated test hardware is required.
export async function createMobileProfileRuntime({platform,approvedDevices,profiles,leasePath,evidenceRoot,xcresultRoot,workerPrivateKey,reviewerPublicKey,issueChallenge,review,isolationConfirmed,runner,hostPlatform=process.platform}={}){
 if(!['android','ios'].includes(platform)||(platform==='ios'&&hostPlatform!=='darwin')||isolationConfirmed!==true||!Array.isArray(approvedDevices)||!approvedDevices.length||approvedDevices.some(x=>typeof x!=='string'||!id.test(x))||!Array.isArray(profiles)||!profiles.length||!abs(leasePath)||!abs(evidenceRoot)||typeof issueChallenge!=='function'||typeof review!=='function'||workerPrivateKey?.type!=='private'||workerPrivateKey.asymmetricKeyType!=='ed25519'||reviewerPublicKey?.type!=='public'||reviewerPublicKey.asymmetricKeyType!=='ed25519')throw Error('Invalid trusted worker configuration');
 const approved=new Set(approvedDevices),configured=new Map();
 const store=new MobileEvidenceStore(evidenceRoot);
 await mkdir(evidenceRoot,{recursive:true,mode:0o700});
 if(platform==='ios'){if(!abs(xcresultRoot))throw Error('XCTest result root required');await mkdir(xcresultRoot,{recursive:true,mode:0o700});}
 const leases=new DurableDeviceLeases(leasePath);
 try{
  for(const p of profiles){
   if(typeof p?.id!=='string'||!id.test(p.id)||configured.has(p.id)||p.platform!==platform)throw Error('Invalid profile');
   if(platform==='android'){
    const journey=validateJourney(p.journey),engine=p.engine??'maestro';
    if(!abs(p.apkPath)||!digest(p.apkSha256)||!Array.isArray(p.signerSha256)||!p.signerSha256.length||!p.signerSha256.every(digest)||journey.packageName!==p.packageName||!['maestro','appium'].includes(engine))throw Error('Invalid Android profile');
    const flowSha256=createHash('sha256').update(compileExecutionPlan(journey,engine)).digest('hex');
    const appiumExecutor=engine==='appium'?createAppiumExecutor({endpoint:p.appiumEndpoint}):undefined;
    const supervisor=new LeasedAndroidSupervisor({leases,approvedDevices,runner,evidenceStore:store,appiumExecutor});
    const orchestrator=new MobileReviewOrchestrator({supervisor,store,workerPrivateKey,reviewerPublicKey,review});
    configured.set(p.id,{buildSha256:p.apkSha256,flowSha256,run:input=>orchestrator.run({apkPath:p.apkPath,apkSha256:p.apkSha256,signerSha256:p.signerSha256,packageName:p.packageName,journey,engine,recordVideo:p.recordVideo===true,...input})});
   }else{
    if(!abs(p.artifactPath)||!digest(p.artifactSha256)||!digest(p.testRunSha256))throw Error('Invalid iOS profile');
    const execute=createIosEvidenceExecutor({execute:createXcuiExecutor({...p,evidenceRoot:xcresultRoot,runner,hostPlatform}),store,evidenceRoot:xcresultRoot,runner,requireVideo:p.requireVideo!==false});
    const adapter=createIosCoreDeviceAdapter({teamId:p.teamId,execute,runner,hostPlatform});
    const supervisor=new LeasedIosSupervisor({leases,approvedDevices,adapter,hostPlatform});
    const run=createIosReviewOrchestrator({supervisor,store,workerPrivateKey,reviewerPublicKey,review,testRunSha256:p.testRunSha256});
    configured.set(p.id,{buildSha256:p.artifactSha256,flowSha256:p.testRunSha256,run:input=>run({artifactPath:p.artifactPath,artifactSha256:p.artifactSha256,bundleId:p.bundleId,...input})});
   }
  }
  return {
   async discover(){
    const found=platform==='android'?await discoverAndroid({runner}):await discoverIos({runner,hostPlatform});
    if(found.status!=='DISCOVERED')throw Error('Device discovery unavailable');
    return found.devices.filter(d=>approved.has(d.id)).map(d=>({id:d.id,platform,ready:(platform==='android'?d.available===true:d.state==='paired')&&leases.status(platform==='ios'?'ios:'+d.id:d.id)!=='QUARANTINED'}));
   },
   async execute({profileId,platform:requested,deviceId}){
    const p=configured.get(profileId);
    if(!p||requested!==platform||!approved.has(deviceId))throw Error('Unauthorized profile or device');
    const context={deviceId:platform==='ios'?'ios:'+deviceId:deviceId,buildSha256:p.buildSha256,flowSha256:p.flowSha256};
    const challenge=await issueChallenge(context);
    if(!challenge||Object.entries(context).some(([k,v])=>challenge[k]!==v))throw Error('Review challenge mismatch');
    return p.run({deviceId,reviewChallengeId:challenge.challengeId,isolationConfirmed:true});
   },
   close(){leases.close();}
  };
 }catch(e){leases.close();throw e;}
}
