import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile,open,realpath,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=/^[a-f0-9]{64}$/;
const id=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const limits={log:256000,screenshot:12*1024*1024};
const names={log:'execution.log',screenshot:'screen.png'};
const png=Buffer.from([137,80,78,71,13,10,26,10]);
const validPng=bytes=>bytes.length>=33&&bytes.subarray(0,8).equals(png)&&bytes.readUInt32BE(8)===13&&bytes.toString('ascii',12,16)==='IHDR'&&bytes.readUInt32BE(16)>0&&bytes.readUInt32BE(20)>0;

// Trusted operator configured local directory, never an HTTP supplied path.
export class MobileEvidenceStore{
 #root;
 constructor(root){if(typeof root!=='string'||!root.startsWith('/'))throw new Error('Absolute evidence root required');this.#root=root;}
 async #directory(){
  await mkdir(this.#root,{recursive:true,mode:0o700});
  const root=await realpath(this.#root);
  const info=await stat(root);
  if(!info.isDirectory()||(info.mode&0o077)!==0)throw new Error('Evidence root must be private');
  return root;
 }
 async capture({deviceId,buildSha256,flowSha256,log,screenshot}){
  if(typeof deviceId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(deviceId)||!digest.test(buildSha256??'')||!digest.test(flowSha256??''))throw new Error('Invalid evidence context');
  const artifacts=[];
  const root=await this.#directory(),runId=randomUUID(),dir=join(root,runId);
  await mkdir(dir,{mode:0o700});
  for(const [kind,value] of [['log',log],['screenshot',screenshot]]){
   if(value===undefined||value===null)continue;
   if(kind==='log'&&typeof value!=='string'||kind==='screenshot'&&!Buffer.isBuffer(value))throw new Error('Invalid evidence type');
   const bytes=Buffer.from(value);
   if(!bytes.length||bytes.length>limits[kind]||(kind==='screenshot'&&!validPng(bytes)))throw new Error('Invalid evidence bytes');
   await writeFile(join(dir,names[kind]),bytes,{flag:'wx',mode:0o600});
   artifacts.push({kind,name:names[kind],bytes:bytes.length,sha256:hash(bytes)});
  }
  if(!artifacts.length)throw new Error('No evidence captured');
  const manifest={schemaVersion:1,runId,deviceId,buildSha256,flowSha256,artifacts,independentReview:'PENDING',productionReady:false};
  await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest),{flag:'wx',mode:0o600});
  return manifest;
 }
 async verify(manifest){
  try{
   if(!id.test(manifest?.runId??'')||!Array.isArray(manifest.artifacts)||!manifest.artifacts.length||manifest.artifacts.length>2)return false;
   const root=await this.#directory(),dir=join(root,manifest.runId);
   if(await realpath(dir)!==dir)return false;
   const disk=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));
   if(JSON.stringify(disk)!==JSON.stringify(manifest))return false;
   const seen=new Set();
   for(const item of manifest.artifacts){
    if(!Object.hasOwn(names,item.kind)||seen.has(item.kind)||item.name!==names[item.kind]||!digest.test(item.sha256??'')||!Number.isSafeInteger(item.bytes)||item.bytes<1||item.bytes>limits[item.kind])return false;
    seen.add(item.kind);
    const fd=await open(join(dir,item.name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try{
     const s=await fd.stat();
     if(!s.isFile()||s.size!==item.bytes)return false;
     const bytes=Buffer.alloc(s.size);
     let pos=0;
     while(pos<bytes.length){const {bytesRead}=await fd.read(bytes,pos,bytes.length-pos,pos);if(!bytesRead)return false;pos+=bytesRead;}
     if(hash(bytes)!==item.sha256||(await fd.stat()).size!==s.size)return false;
    }finally{await fd.close();}
   }
   return true;
  }catch{return false;}
 }
}
