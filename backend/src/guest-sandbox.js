import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,realpath} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {spawn} from 'node:child_process';
const sha=/^[a-f0-9]{64}$/;
// Operator-prepared Linux boot image; no host shares, network, guest agent,
// writable base image, arbitrary QEMU arguments or customer-provided paths.
export function guestArguments({image,acceleration='kvm'}){
 if(typeof image!=='string'||!isAbsolute(image)||/[,\r\n]/.test(image)||!['kvm','tcg'].includes(acceleration))throw Error('Invalid trusted guest image configuration');
 return ['-no-user-config','-nodefaults','-machine','q35,accel='+acceleration,'-m','512','-smp','1','-display','none','-monitor','none','-serial','stdio','-nic','none','-no-reboot','-drive','file='+image+',format=raw,if=virtio,readonly=on'];
}
// Dedicated process group, bounded separate byte streams, wait for exit.
// QEMU must run as an unprivileged dedicated account with no secrets.
export function runGuestProcess(binary,args,{timeoutMs=120000,outputLimit=131072}={}){
 return new Promise(resolve=>{
  let child;
  try{child=spawn(binary,args,{shell:false,detached:true,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'C',HOME:'/nonexistent'}});}
  catch{return resolve({exitCode:null,error:'SPAWN_FAILED',cleanupVerified:false});}
  const streams={stdout:[],stderr:[]},sizes={stdout:0,stderr:0};let timedOut=false,truncated=false,error=null;
  const kill=()=>{if(child.pid){try{process.kill(-child.pid,'SIGKILL');}catch{}}};
  for(const name of ['stdout','stderr'])child[name].on('data',chunk=>{
   const room=Math.max(0,outputLimit-sizes[name]);if(chunk.length>room){truncated=true;kill();}
   if(room){const part=chunk.subarray(0,room);streams[name].push(part);sizes[name]+=part.length;}
  });
  const timer=setTimeout(()=>{timedOut=true;kill();},timeoutMs);
  child.once('error',()=>{error='SPAWN_FAILED';});
  child.once('close',(exitCode,signal)=>{
   clearTimeout(timer);
   let cleanupVerified=false;
   if(child.pid){try{process.kill(-child.pid,0);kill();}catch(e){cleanupVerified=e.code==='ESRCH';}}
   resolve({exitCode,signal,error,timedOut,truncated,cleanupVerified,stdout:Buffer.concat(streams.stdout).toString('utf8'),stderr:Buffer.concat(streams.stderr).toString('utf8')});
  });
 });
}
export async function bootIsolatedFixture({image,imageSha256,acceleration='kvm',runner=runGuestProcess}={}){
 const blocked=reason=>({status:'BLOCKED',reason,productionReady:false,deploymentAuthorized:false});
 try{
  if(process.platform!=='linux'||typeof process.getuid!=='function'||process.getuid()===0)return blocked('Unprivileged Linux worker required');
  if(typeof imageSha256!=='string'||!sha.test(imageSha256))return blocked('Pinned image digest required');
  const args=guestArguments({image,acceleration}),s=await lstat(image);
  if(!s.isFile()||s.size<1||s.size>2147483648||await realpath(image)!==image||(s.mode&0o222)!==0)return blocked('Protected immutable image required');
  const hash=createHash('sha256');for await(const chunk of createReadStream(image))hash.update(chunk);
  if(hash.digest('hex')!==imageSha256)return blocked('Image digest mismatch');
  const result=await runner('/usr/bin/qemu-system-x86_64',args);
  // Exit alone is not proof of test success or VM security qualification.
  return {status:result.exitCode===0&&!result.error&&!result.timedOut&&!result.truncated&&result.cleanupVerified?'GUEST_EXIT_OBSERVED':'BLOCKED',imageSha256,result,productionReady:false,deploymentAuthorized:false};
 }catch{return blocked('Guest infrastructure unavailable');}
}
