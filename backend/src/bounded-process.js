import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {isAbsolute} from 'node:path';

// Only trusted host-registered commands. A process group is NOT a sandbox:
// descendants can escape it. Containers and VMs require separate cleanup.
export function runBoundedProcess({binary,args=[],cwd,timeoutMs=30000,outputLimit=128000,signal}={}){
 if(!['linux','darwin'].includes(process.platform)||typeof binary!=='string'||binary.includes('\0')||!isAbsolute(binary)||!Array.isArray(args)||args.length>256||args.some(a=>typeof a!=='string'||a.includes('\0')||a.length>16384)||!Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>3600000||!Number.isInteger(outputLimit)||outputLimit<1||outputLimit>1048576||(cwd!==undefined&&(typeof cwd!=='string'||cwd.includes('\0')||!isAbsolute(cwd))))throw Error('Invalid trusted process configuration');
 if(signal?.aborted)return Promise.resolve({status:'CANCELLED',exitCode:null,output:'',outputTruncated:false,terminationConfirmed:false});
 return new Promise(resolve=>{
  const start=performance.now();
  let child;
  try{child=spawn(binary,args,{cwd,detached:true,shell:false,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}});}
  catch{return resolve({status:'INFRASTRUCTURE_ERROR',exitCode:null,output:'',outputTruncated:false,terminationConfirmed:false,elapsedMs:Math.ceil(performance.now()-start)});}
  const chunks=[];let size=0,truncated=false,reason=null,done=false,timer,watchdog,killFailed=false;
  function collect(chunk){
   const remaining=outputLimit-size;
   if(chunk.length>remaining)truncated=true;
   if(remaining>0){const part=chunk.subarray(0,remaining);chunks.push(part);size+=part.length;}
  }
  child.stdout.on('data',collect);child.stderr.on('data',collect);
  function finish(status,code,confirmed){
   if(done)return;done=true;clearTimeout(timer);clearTimeout(watchdog);signal?.removeEventListener('abort',cancel);
   resolve({status,exitCode:code,output:Buffer.concat(chunks,size).toString('utf8'),outputTruncated:truncated,terminationConfirmed:confirmed,elapsedMs:Math.ceil(performance.now()-start)});
  }
  function killGroup(){
   if(!child.pid)return;
   try{process.kill(-child.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')killFailed=true;}
  }
  function stop(why){
   if(done||reason)return;reason=why;killGroup();
   watchdog=setTimeout(()=>{killGroup();child.stdout.destroy();child.stderr.destroy();child.unref();finish('CLEANUP_UNCONFIRMED',null,false);},5000);
  }
  function cancel(){stop('CANCELLED');}
  child.once('error',()=>finish('INFRASTRUCTURE_ERROR',null,false));
  child.once('exit',()=>killGroup());
  child.once('close',code=>{
   // An exit/close confirms only the direct child and its streams, not
   // escaped descendants, VM teardown, or container removal.
   if(killFailed)return finish('CLEANUP_UNCONFIRMED',code,false);
   if(!reason&&performance.now()-start>=timeoutMs)reason='TIMEOUT';
   finish(reason??(code===0?'COMMAND_SUCCEEDED':'COMMAND_FAILED'),code,true);
  });
  timer=setTimeout(()=>stop('TIMEOUT'),timeoutMs);
  signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted)cancel();
 });
}
