import {createHash} from 'node:crypto';
import {readdir,lstat,readFile,realpath} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {runProcess} from './core.js';
const sha=/^[a-f0-9]{64}$/;
const bundle=/^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)+$/;
const ok=r=>r?.exitCode===0&&!r.error&&!r.timedOut&&!r.outputTruncated;
// Operator-owned staging directory must be inaccessible to test workloads.
// Canonical digest binds paths, permissions and bytes; symlinks are not supported.
export async function digestIosBundle(root){
 if(typeof root!=='string'||!isAbsolute(root)||!root.endsWith('.app')||await realpath(root)!==root||!(await lstat(root)).isDirectory())throw Error('Invalid staged app');
 const hash=createHash('sha256');let entries=0,total=0;
 async function walk(dir,prefix){
  for(const name of (await readdir(dir)).sort()){
   if(++entries>20000||/[\x00-\x1f\x7f]/.test(name))throw Error('Bundle entry limit or invalid name');
   const path=join(dir,name),rel=prefix+name,s=await lstat(path);
   if(s.isSymbolicLink()||(!s.isDirectory()&&!s.isFile()))throw Error('Unsupported bundle entry');
   hash.update(JSON.stringify([rel,s.isDirectory()?'dir':'file',s.mode&0o777,s.isDirectory()?0:s.size])+'\n');
   if(s.isDirectory())await walk(path,rel+'/');
   else{
    total+=s.size;if(total>512*1024*1024||s.size>128*1024*1024)throw Error('Bundle size limit');
    const bytes=await readFile(path);if(bytes.length!==s.size)throw Error('Bundle changed');
    hash.update(createHash('sha256').update(bytes).digest());
   }
  }
 }
 await walk(root,'');return hash.digest('hex');
}
export async function verifyIosArtifact({artifactPath,artifactSha256,bundleId,teamId,runner=runProcess,hostPlatform=process.platform}){
 if(hostPlatform!=='darwin'||!sha.test(artifactSha256??'')||!bundle.test(bundleId??'')||typeof teamId!=='string'||!/^[A-Z0-9]{10}$/.test(teamId))return false;
 try{
  if(await digestIosBundle(artifactPath)!==artifactSha256)return false;
  const signed=await runner('codesign',['--verify','--deep','--strict',artifactPath],{timeoutMs:60000,outputLimit:64000});
  if(!ok(signed))return false;
  const identity=await runner('codesign',['-d','--verbose=4',artifactPath],{timeoutMs:15000,outputLimit:64000});
  if(!ok(identity)||typeof identity.output!=='string')return false;
  const ids=[...identity.output.matchAll(/^Identifier=(.+)$/gm)].map(x=>x[1]);
  const teams=[...identity.output.matchAll(/^TeamIdentifier=(.+)$/gm)].map(x=>x[1]);
  return ids.length===1&&ids[0]===bundleId&&teams.length===1&&teams[0]===teamId&&await digestIosBundle(artifactPath)===artifactSha256;
 }catch{return false;}
}
