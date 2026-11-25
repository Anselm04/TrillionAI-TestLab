import {createServer} from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest();
const tokenValid=t=>typeof t==='string'&&/^[a-f0-9]{64}$/.test(t);
const limit=65536;
function reply(res,code,body){res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));}
async function readBody(req){
 const chunks=[];let bytes=0;
 for await(const chunk of req){bytes+=chunk.length;if(bytes>limit)throw Error('Body too large');chunks.push(chunk);}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
// Separate process, separate credentials for scheduler and worker. Loopback only;
// cross-host access requires a separately authenticated encrypted transport.
export function createReviewerService({challenges,review,schedulerToken,workerToken}={}){
 if(typeof challenges?.issue!=='function'||typeof review!=='function'||!tokenValid(schedulerToken)||!tokenValid(workerToken)||schedulerToken===workerToken)throw Error('Separate reviewer credentials required');
 const scheduler=hash(schedulerToken),worker=hash(workerToken);let active=0;
 const server=createServer({requestTimeout:10000,headersTimeout:5000,maxHeaderSize:8192},async(req,res)=>{
  const route=req.url;
  if(req.method!=='POST'||!['/challenge','/review'].includes(route)){reply(res,404,{error:'NOT_FOUND'});return;}
  const auth=req.headers.authorization;
  if(typeof auth!=='string'||!auth.startsWith('Bearer ')||!tokenValid(auth.slice(7))||!timingSafeEqual(hash(auth.slice(7)),route==='/challenge'?scheduler:worker)){reply(res,401,{error:'UNAUTHORIZED'});return;}
  if(req.headers['content-type']!=='application/json'){reply(res,415,{error:'JSON_REQUIRED'});return;}
  if(active>=8){reply(res,429,{error:'BUSY'});return;}
  active++;
  try{
   const body=await readBody(req);
   const result=route==='/challenge'?challenges.issue({deviceId:body.deviceId,buildSha256:body.buildSha256,flowSha256:body.flowSha256}):await review({challengeId:body.challengeId,attestation:body.attestation,manifest:body.manifest});
   reply(res,200,result);
  }catch{if(!res.destroyed)reply(res,400,{error:'REQUEST_REJECTED'});}
  finally{active--;}
 });
 server.maxConnections=32;
 return {server,listen(port=0){return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve(server.address());});});}};
}
export function createReviewerClient({port,token,role,request=fetch}={}){
 if(!Number.isInteger(port)||port<1||port>65535||!tokenValid(token)||!['scheduler','worker'].includes(role))throw Error('Invalid client configuration');
 return async body=>{
  const payload=JSON.stringify(body);if(Buffer.byteLength(payload)>limit)throw Error('Request too large');
  const res=await request('http://127.0.0.1:'+port+(role==='scheduler'?'/challenge':'/review'),{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:payload});
  if(!res.ok||!res.body)throw Error('Reviewer request rejected');
  const reader=res.body.getReader();let bytes=0;const chunks=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>limit)throw Error('Response too large');chunks.push(Buffer.from(value));}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 };
}
