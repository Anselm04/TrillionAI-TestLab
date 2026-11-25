import {randomUUID} from 'node:crypto';
const serial=/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;
const bundle=/^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)+$/;
const digest=/^[a-f0-9]{64}$/;
// Trusted host adapters must verify the signed artifact and independently
// observe installation state. No customer-supplied shell commands.
export class LeasedIosSupervisor{
 #leases;#approved;#adapter;
 constructor({leases,approvedDevices,adapter,hostPlatform=process.platform}={}){
  if(hostPlatform!=='darwin'||!leases||!Array.isArray(approvedDevices)||!approvedDevices.length||approvedDevices.some(x=>typeof x!=='string'||!serial.test(x))||!['verifyArtifact','isInstalled','install','execute','uninstall'].every(k=>typeof adapter?.[k]==='function'))throw Error('Dedicated macOS host and complete trusted adapter required');
  this.#leases=leases;this.#approved=new Set(approvedDevices);this.#adapter=adapter;
  for(const id of this.#approved)leases.register('ios:'+id);
 }
 async smoke(input){
  const {deviceId,bundleId,artifactPath,artifactSha256,isolationConfirmed}=input??{};
  if(!this.#approved.has(deviceId)||isolationConfirmed!==true||typeof bundleId!=='string'||!bundle.test(bundleId)||typeof artifactPath!=='string'||!digest.test(artifactSha256??''))throw Error('Invalid iOS execution context');
  const lease=this.#leases.acquire({deviceId:'ios:'+deviceId,runId:randomUUID(),durationMs:300000});
  if(!lease)return {status:'BLOCKED',productionReady:false,deploymentAuthorized:false};
  const context={deviceId,bundleId,artifactPath,artifactSha256};
  let touched=false,cleanupVerified=false,execution=null,released=false,failed=false;
  const call=async(method,args)=>{
   if(!this.#leases.heartbeat({...lease,durationMs:300000}))throw Error('Lease lost');
   const result=await this.#adapter[method](args);
   if(!this.#leases.heartbeat({...lease,durationMs:300000}))throw Error('Lease lost during operation');
   return result;
  };
  try{
   if(await call('verifyArtifact',context)!==true)throw Error('Artifact verification failed');
   if(await call('isInstalled',context)!==false)throw Error('Preexisting application or unknown state');
   touched=true;
   if(await call('install',context)!==true||await call('isInstalled',context)!==true)throw Error('Install not verified');
   execution=await call('execute',context);
   if(execution?.status!=='COMMAND_SUCCEEDED')throw Error('Execution failed');
  }catch{failed=true;}
  finally{
   if(touched){try{cleanupVerified=await call('uninstall',context)===true&&await call('isInstalled',context)===false;}catch{cleanupVerified=false;}}
   if(!failed&&cleanupVerified)released=this.#leases.release({...lease,cleanupVerified:true});
   if(!released)this.#leases.quarantine(lease);
  }
  return {status:released?'SMOKE_OBSERVED':'BLOCKED',deviceId,bundleId,artifactSha256,execution,cleanupVerified,leaseReleased:released,productionReady:false,deploymentAuthorized:false};
 }
}
