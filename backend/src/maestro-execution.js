import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {executeJourney,validateJourney} from './mobile-journey.js';

// Only called inside the trusted leased worker with a verified installed APK.
export async function runMaestroJourney({journey,deviceId,packageName,buildSha256,runner}){
 const plan=validateJourney(journey);
 if(plan.packageName!==packageName||typeof runner!=='function')throw new Error('Journey does not match verified APK');
 return executeJourney({journey:plan,deviceId,buildSha256,execute:async({flow})=>{
  const dir=await mkdtemp(join(tmpdir(),'testlab-maestro-'));
  try{
   const path=join(dir,'flow.yaml');
   await writeFile(path,flow,{flag:'wx',mode:0o600});
   return await runner('maestro',['--device',deviceId,'test',path],{timeoutMs:240000,outputLimit:64000});
  }finally{await rm(dir,{recursive:true,force:true});}
 }});
}
