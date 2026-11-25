import { AndroidWorker } from './android-worker.js';
import { runProcess } from './core.js';
import { randomUUID } from 'node:crypto';

// Trusted single-host supervisor. All workers must use the same protected database.
// No customer-facing arbitrary command interface is exposed.
export class LeasedAndroidSupervisor {
  #leases; #approved; #runner;
  constructor({leases,approvedDevices,runner=runProcess}={}){
    if(!leases||!Array.isArray(approvedDevices)||!approvedDevices.length||approvedDevices.some(id=>typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)))throw new Error('Lease store and explicit allowlist required');
    this.#leases=leases;this.#approved=new Set(approvedDevices);this.#runner=runner;
    for(const id of this.#approved)this.#leases.register(id);
  }
  async smoke(input){
    if(!this.#approved.has(input?.deviceId)||input.isolationConfirmed!==true)throw new Error('Unauthorized device or missing isolation');
    const lease=this.#leases.acquire({deviceId:input.deviceId,runId:randomUUID(),durationMs:300000});
    if(!lease)return {status:'BLOCKED',reason:'Device not available',productionReady:false,deploymentAuthorized:false};
    let report, released=false;
    try{
      const guardedRunner=async(binary,args,options)=>{
        if(binary==='maestro'&&(args[0]!=='--device'||args[1]!==lease.deviceId||args[2]!=='test'))throw new Error('Maestro command outside lease');
        if(!['apksigner','aapt2','maestro'].includes(binary)&&(binary!=='adb'||args[0]!=='-s'||args[1]!==lease.deviceId))throw new Error('Device command outside lease');
        if(!this.#leases.heartbeat({...lease,durationMs:300000}))throw new Error('Device lease lost');
        const result=await this.#runner(binary,args,options);
        if(!this.#leases.heartbeat({...lease,durationMs:300000}))throw new Error('Device lease lost during command');
        return result;
      };
      const worker=new AndroidWorker({approvedDevices:[lease.deviceId],runner:guardedRunner});
      report=await worker.smoke(input);
      // A failed or incomplete run is quarantined even if it never touched hardware.
      if(report.status==='SMOKE_OBSERVED'&&report.cleanupVerified===true){
        released=this.#leases.release({...lease,cleanupVerified:true});
      }
      if(!released)this.#leases.quarantine(lease);
      return {...report,status:released?report.status:'BLOCKED',leaseReleased:released,fence:lease.fence};
    }catch(error){
      this.#leases.quarantine(lease);
      return {status:'BLOCKED',reason:String(error?.message??error),leaseReleased:false,productionReady:false,deploymentAuthorized:false};
    }
  }
}
