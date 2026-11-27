import {mkdtemp,open,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runProcess} from './core.js';
const idPattern=/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;
export function parseIosInventory(document){
 if(!Array.isArray(document?.result?.devices))throw Error('Unsupported device inventory schema');
 const found=new Map();
 for(const d of document.result.devices){
  const modern=d?.properties;
  const h=modern?.hardware??d?.hardwareProperties;
  if(h?.platform!=='iOS'||typeof h.udid!=='string'||!idPattern.test(h.udid))continue;
  if(h.reality==='simulated'||d.visibilityClass==='simulators')continue;
  if(found.has(h.udid))throw Error('Duplicate device');
  const c=modern?.connection??d.connectionProperties??{};
  found.set(h.udid,{id:h.udid,platform:'ios',model:typeof h.productType==='string'?h.productType:null,state:c.pairingState==='paired'?'paired':'unverified',kind:'unverified',available:false});
 }
 return [...found.values()];
}
export async function discoverIos({runner=runProcess,hostPlatform=process.platform}={}){
 if(hostPlatform!=='darwin')return {status:'UNSUPPORTED_HOST',devices:[]};
 const dir=await mkdtemp(join(tmpdir(),'testlab-ios-'));
 try{
  const path=join(dir,'devices.json');
  const r=await runner('xcrun',['devicectl','list','devices','--json-output',path],{timeoutMs:20000,outputLimit:64000});
  if(r?.exitCode!==0||r.error||r.timedOut||r.outputTruncated)throw Error('Discovery failed');
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
   const info=await fd.stat();if(!info.isFile()||info.size>2097152)throw Error('Invalid inventory file');
   const buffer=Buffer.alloc(info.size+1);let offset=0;
   while(offset<buffer.length){const {bytesRead}=await fd.read(buffer,offset,buffer.length-offset,offset);if(!bytesRead)break;offset+=bytesRead;}
   if(offset!==info.size||(await fd.stat()).size!==info.size)throw Error('Inventory changed during read');
   return {status:'DISCOVERED',devices:parseIosInventory(JSON.parse(buffer.subarray(0,offset).toString('utf8')))};
  }finally{await fd.close();}
 }catch{return {status:'INFRASTRUCTURE_ERROR',devices:[]};}
 finally{await rm(dir,{recursive:true,force:true});}
}
