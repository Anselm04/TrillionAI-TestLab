import {runBoundedProcess} from './bounded-process.js';
const namePattern=/^testlab-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Only internally constructed Docker arguments and a trusted local daemon.
// Docker is not the isolation boundary for hostile customer code.
export async function runDockerLifecycle(args,{timeoutMs=120000,execute=runBoundedProcess,binary='/usr/bin/docker'}={}){
 if(!Array.isArray(args)||args[0]!=='run'||args.filter(a=>a==='--name').length!==1||!namePattern.test(args[args.indexOf('--name')+1]??'')||typeof execute!=='function')throw Error('Invalid Docker lifecycle configuration');
 const name=args[args.indexOf('--name')+1];
 const invoke=(argv,ms)=>execute({binary,args:argv,timeoutMs:ms});
 let result,clean=false;
 try{result=await invoke(args,timeoutMs);}catch{result={status:'INFRASTRUCTURE_ERROR'};}
 // Removal is scoped to the unique internally generated container name.
 // Do not infer absence from a failed inspect (daemon may be unavailable).
 try{
  await invoke(['rm','--force',name],15000);
  const listed=await invoke(['ps','--all','--filter','name=^/'+name+'$','--format','{{.Names}}'],15000);
  clean=listed.status==='COMMAND_SUCCEEDED'&&listed.exitCode===0&&listed.outputTruncated===false&&typeof listed.output==='string'&&listed.output.trim()==='';
 }catch{}
 const mapped={exitCode:result?.exitCode??null,output:result?.output??'',outputTruncated:result?.outputTruncated===true,timedOut:result?.status==='TIMEOUT',cleanupVerified:clean};
 if(!clean)return {...mapped,error:'Docker cleanup unconfirmed'};
 if(!['COMMAND_SUCCEEDED','COMMAND_FAILED','TIMEOUT'].includes(result?.status)||result.terminationConfirmed!==true)return {...mapped,error:'Docker execution unconfirmed'};
 return mapped;
}
