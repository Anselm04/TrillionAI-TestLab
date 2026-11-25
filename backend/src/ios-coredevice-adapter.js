import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runProcess} from './core.js';
import {verifyIosArtifact} from './ios-artifact.js';
const serial=/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;
const bundle=/^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)+$/;
const ok=r=>r?.exitCode===0&&!r.error&&!r.timedOut&&!r.outputTruncated;
export function parseInstalledApps(doc){
 const apps=doc?.result?.apps;
 if(!Array.isArray(apps)||apps.length>20000)throw Error('Invalid installed app inventory');
 const ids=new Set();
 for(const app of apps){
  if(typeof app?.bundleIdentifier!=='string'||!bundle.test(app.bundleIdentifier)||ids.has(app.bundleIdentifier))throw Error('Ambiguous installed app inventory');
  ids.add(app.bundleIdentifier);
 }
 return ids;
}
// Trusted macOS worker only. Application paths must be immutable operator-owned
// staged bundles; this adapter does not accept arbitrary shell commands.
export function createIosCoreDeviceAdapter({teamId,execute,runner=runProcess,hostPlatform=process.platform}={}){
 if(hostPlatform!=='darwin'||typeof teamId!=='string'||!/^[A-Z0-9]{10}$/.test(teamId)||typeof execute!=='function')throw Error('Dedicated macOS host and trusted execution adapter required');
 const validate=c=>{
  if(typeof c?.deviceId!=='string'||!serial.test(c.deviceId)||typeof c.bundleId!=='string'||!bundle.test(c.bundleId))throw Error('Invalid device context');
 };
 async function invoke(c,args,timeoutMs){
  validate(c);
  const dir=await mkdtemp(join(tmpdir(),'testlab-coredevice-'));
  try{
   const path=join(dir,'result.json');
   const r=await runner('xcrun',['devicectl',...args,'--json-output',path],{timeoutMs,outputLimit:64000});
   if(!ok(r))throw Error('CoreDevice command failed');
   const info=await stat(path);
   if(!info.isFile()||info.size>4194304)throw Error('Invalid CoreDevice output');
   const doc=JSON.parse(await readFile(path,'utf8'));
   if(doc?.info?.outcome!=='success'||!doc.result||typeof doc.result!=='object')throw Error('CoreDevice outcome not confirmed');
   return doc;
  }finally{await rm(dir,{recursive:true,force:true});}
 }
 async function isInstalled(c){
  const doc=await invoke(c,['device','info','apps','--device',c.deviceId],30000);
  return parseInstalledApps(doc).has(c.bundleId);
 }
 const verifyArtifact=c=>verifyIosArtifact({...c,teamId,runner,hostPlatform});
 return {
  verifyArtifact,isInstalled,
  async install(c){
   if(!await verifyArtifact(c)||await isInstalled(c)!==false)return false;
   await invoke(c,['device','install','app','--device',c.deviceId,c.artifactPath],120000);
   return await isInstalled(c)===true;
  },
  async uninstall(c){
   // Caller must own the lease and have established absence before installation.
   if(await isInstalled(c)===false)return true;
   await invoke(c,['device','uninstall','app','--device',c.deviceId,c.bundleId],60000);
   return await isInstalled(c)===false;
  },
  async execute(c){validate(c);return execute(c);}
 };
}
