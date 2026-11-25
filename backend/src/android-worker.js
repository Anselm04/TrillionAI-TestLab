import { createHash } from 'node:crypto';
import { open, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runProcess } from './core.js';

const serialPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const packagePattern = /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$/;
const digestPattern = /^[a-f0-9]{64}$/;
const ok = r => r?.exitCode === 0 && !r.error && !r.timedOut && !r.outputTruncated && typeof r.output === 'string';
const hash = data => createHash('sha256').update(data).digest('hex');

// Only operator-approved dedicated devices and signed-off APKs may enter this worker.
// Host/USB isolation and network policy are external prerequisites, not inferred here.
export class AndroidWorker {
  #active = new Set();
  #quarantined = new Set();
  #approved;
  #runner;
  constructor({ approvedDevices, runner = runProcess } = {}) {
    if (!Array.isArray(approvedDevices) || !approvedDevices.length || approvedDevices.some(x=>typeof x!=='string'||!serialPattern.test(x))) throw new Error('Explicit device allowlist required');
    this.#approved = new Set(approvedDevices);
    this.#runner = runner;
  }
  status(id) {
    if (!this.#approved.has(id)) return 'UNAUTHORIZED';
    if (this.#quarantined.has(id)) return 'QUARANTINED';
    return this.#active.has(id) ? 'BUSY' : 'IDLE';
  }
  async smoke({ deviceId, packageName, apkPath, apkSha256, isolationConfirmed = false }) {
    if (this.status(deviceId)!=='IDLE') throw new Error('Device unavailable or not authorized');
    if (isolationConfirmed !== true) throw new Error('Dedicated isolated test host required');
    if (typeof packageName!=='string'||!packagePattern.test(packageName)||packageName.length>200 || typeof apkSha256!=='string'||!digestPattern.test(apkSha256)||typeof apkPath!=='string') throw new Error('Invalid artifact declaration');
    this.#active.add(deviceId);
    const observations=[];
    let dir, installed=false, touched=false, cleanupVerified=false, error=null;
    const execute=async (checkId,args,timeoutMs=15000)=>{
      const r=await this.#runner('adb',['-s',deviceId,...args],{timeoutMs,outputLimit:64000});
      observations.push({checkId,status:ok(r)?'PASSED':'INFRASTRUCTURE_ERROR',exitCode:r?.exitCode??null,timedOut:r?.timedOut===true,outputDigest:hash(typeof r?.output==='string'?r.output:'')});
      return r;
    };
    try {
      // Copy and hash the exact bytes installed, avoiding path substitution after verification.
      const fd=await open(apkPath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
      let bytes;
      try {
        const stat=await fd.stat();
        if(!stat.isFile()||stat.size<1||stat.size>128*1024*1024) throw new Error('Unsupported APK size or type');
        bytes=Buffer.alloc(stat.size);
        let offset=0;
        while(offset<bytes.length){
          const {bytesRead}=await fd.read(bytes,offset,bytes.length-offset,offset);
          if(!bytesRead) throw new Error('Artifact changed during read');
          offset+=bytesRead;
        }
        if((await fd.stat()).size!==stat.size) throw new Error('Artifact size changed');
      } finally { await fd.close(); }
      if(hash(bytes)!==apkSha256) throw new Error('APK digest mismatch');
      dir=await mkdtemp(join(tmpdir(),'testlab-apk-'));
      const staged=join(dir,'artifact.apk');
      await writeFile(staged,bytes,{flag:'wx',mode:0o600});
      const state=await execute('device-state',['get-state']);
      if(!ok(state)||state.output.trim()!=='device') throw new Error('Device not ready');
      // Refuse to replace an existing package or trust ambiguous package-list output.
      const before=await execute('package-preflight',['shell','pm','list','packages',packageName]);
      if(!ok(before)||before.output.trim()!=='') throw new Error('Package already present or preflight ambiguous');
      touched=true;
      const install=await execute('apk-install',['install',staged],120000);
      if(!ok(install)||!/^Success$/m.test(install.output)) throw new Error('Install not confirmed');
      installed=true;
      const path=await execute('package-presence',['shell','pm','path',packageName]);
      if(!ok(path)||!/^package:\//m.test(path.output)) throw new Error('Declared package not confirmed');
    } catch(e) { error=String(e?.message??e); }
    finally {
      if(installed) {
        try {
          const uninstall=await execute('apk-uninstall',['uninstall',packageName],30000);
          const after=await execute('package-cleanup',['shell','pm','list','packages',packageName]);
          cleanupVerified=ok(uninstall)&&/^Success$/m.test(uninstall.output)&&ok(after)&&after.output.trim()==='';
        } catch { cleanupVerified=false; }
      }
      // Unknown install outcomes or cleanup failures must never return to the idle pool.
      if(touched&&!cleanupVerified) this.#quarantined.add(deviceId);
      this.#active.delete(deviceId);
      if(dir) { try { await rm(dir,{recursive:true,force:true}); } catch { error=error??'Local artifact cleanup failed'; } }
    }
    return {deviceId,apkSha256,packageName,status:!error&&installed&&cleanupVerified?'SMOKE_OBSERVED':'BLOCKED',error,cleanupVerified,observations,productionReady:false,deploymentAuthorized:false};
  }
}
