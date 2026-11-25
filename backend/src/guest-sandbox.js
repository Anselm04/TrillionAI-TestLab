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
export function runGuestProcess(binary,args,{timeoutMs=120000,outputLimit=131072,signal}={}){
 if(typeof binary!=='string'||!isAbsolute(binary)||!Array.isArray(args)||args.length>256||args.some(a=>typeof a!=='string'||a.includes('\0')||a.length>16384)||!Number.isSafeInteger(timeoutMs)||timeoutMs<10||timeoutMs>3600000||!Number.isSafeInteger(outputLimit)||outputLimit<1||outputLimit>1048576)throw Error('Invalid guest process configuration');
 if(signal?.aborted)return Promise.resolve({exitCode:null,error:'CANCELLED',cleanupVerified:false,stdout:'',stderr:''});
 return new Promise(resolve=>{
  let child;
  try{child=spawn(binary,args,{shell:false,detached:true,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'C',HOME:'/nonexistent'}});}
  catch{return resolve({exitCode:null,error:'SPAWN_FAILED',cleanupVerified:false});}
  const streams={stdout:[],stderr:[]},sizes={stdout:0,stderr:0};
  let timedOut=false,truncated=false,error=null,done=false,watchdog,timer,stopping=false;
  const kill=()=>{if(child.pid){try{process.kill(-child.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')error='GROUP_TERMINATION_FAILED';}}};
  const finish=(exitCode,exitSignal,cleanupVerified)=>{
   if(done)return;done=true;clearTimeout(timer);clearTimeout(watchdog);signal?.removeEventListener('abort',cancel);
   resolve({exitCode,signal:exitSignal,error,timedOut,truncated,cleanupVerified,stdout:Buffer.concat(streams.stdout).toString('utf8'),stderr:Buffer.concat(streams.stderr).toString('utf8')});
  };
  const stop=()=>{
   if(done||stopping)return;stopping=true;kill();
   watchdog=setTimeout(()=>{kill();child.stdout.destroy();child.stderr.destroy();child.unref();error='CLEANUP_UNCONFIRMED';finish(null,null,false);},5000);
  };
  const cancel=()=>{error='CANCELLED';stop();};
  for(const name of ['stdout','stderr'])child[name].on('data',chunk=>{
   const room=Math.max(0,outputLimit-sizes[name]);
   if(room){const part=chunk.subarray(0,room);streams[name].push(part);sizes[name]+=part.length;}
   if(chunk.length>room){truncated=true;stop();}
  });
  child.once('error',()=>{error='SPAWN_FAILED';stop();});
  child.once('exit',()=>{stop();});
  child.once('close',(exitCode,exitSignal)=>{
   let cleanupVerified=false;
   if(child.pid){try{process.kill(-child.pid,0);kill();}catch(e){cleanupVerified=e.code==='ESRCH';}}
   finish(exitCode,exitSignal,cleanupVerified);
  });
  timer=setTimeout(()=>{timedOut=true;stop();},timeoutMs);
  signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted)cancel();
 });
}
export async function bootIsolatedFixture({image,imageSha256,acceleration='kvm',runner=runGuestProcess,signal,timeoutMs=120000}={}){
 const blocked=reason=>({status:'BLOCKED',reason,productionReady:false,deploymentAuthorized:false});
 try{
  if(process.platform!=='linux'||typeof process.getuid!=='function'||process.getuid()===0)return blocked('Unprivileged Linux worker required');
  if(typeof imageSha256!=='string'||!sha.test(imageSha256))return blocked('Pinned image digest required');
  if(signal?.aborted)return blocked('Cancelled');
  const args=guestArguments({image,acceleration}),s=await lstat(image);
  if(!s.isFile()||s.size<1||s.size>2147483648||await realpath(image)!==image||(s.mode&0o222)!==0)return blocked('Protected immutable image required');
  const hash=createHash('sha256');for await(const chunk of createReadStream(image)){if(signal?.aborted)return blocked('Cancelled');hash.update(chunk);}
  if(hash.digest('hex')!==imageSha256)return blocked('Image digest mismatch');
  const result=await runner('/usr/bin/qemu-system-x86_64',args,{signal,timeoutMs});
  // Exit alone is not proof of test success or VM security qualification.
  return {status:!signal?.aborted&&result.exitCode===0&&!result.error&&!result.timedOut&&!result.truncated&&result.cleanupVerified?'GUEST_EXIT_OBSERVED':'BLOCKED',imageSha256,result,productionReady:false,deploymentAuthorized:false};
 }catch{return blocked('Guest infrastructure unavailable');}
}
