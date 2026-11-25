import {createServer} from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const tokenPattern=/^[a-f0-9]{64}$/;
const hash=x=>createHash('sha256').update(x).digest();
const maxBody=131072;
const send=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
async function read(req){
 let n=0;const chunks=[];
 for await(const chunk of req){n+=chunk.length;if(n>maxBody)throw Error('Request limit');chunks.push(chunk);}
 const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Invalid body');
 return body;
}
// Bind only to loopback. Remote workers require an operator-managed TLS tunnel.
// Each credential is bound to a host and a fixed device allowlist.
export function createRackTransport({rack,hosts}={}){
 if(!rack||!Array.isArray(hosts)||!hosts.length||hosts.length>500)throw Error('Trusted rack configuration required');
 const auth=new Map(),tokens=new Set(),devices=new Set();
 for(const h of hosts){
  if(typeof h?.host!=='string'||!id.test(h.host)||auth.has(h.host)||typeof h.token!=='string'||!tokenPattern.test(h.token)||tokens.has(h.token)||!Array.isArray(h.devices)||h.devices.length>500)throw Error('Invalid host configuration');
  const allowed=new Map();
  for(const d of h.devices){
   if(typeof d?.id!=='string'||!id.test(d.id)||!['android','ios'].includes(d.platform)||devices.has(d.id))throw Error('Invalid device ownership');
   devices.add(d.id);allowed.set(d.id,d.platform);
  }
  tokens.add(h.token);auth.set(h.host,{digest:hash(h.token),allowed});
 }
 let active=0;
 const server=createServer({requestTimeout:10000,headersTimeout:5000,maxHeaderSize:8192},async(req,res)=>{
  if(req.method!=='POST'||!['/heartbeat','/claim','/finish'].includes(req.url))return send(res,404,{error:'NOT_FOUND'});
  const host=req.headers['x-testlab-host'],header=req.headers.authorization,entry=auth.get(host);
  if(!entry||typeof header!=='string'||!header.startsWith('Bearer ')||!tokenPattern.test(header.slice(7))||!timingSafeEqual(hash(header.slice(7)),entry.digest))return send(res,401,{error:'UNAUTHORIZED'});
  if(req.headers['content-type']!=='application/json')return send(res,415,{error:'JSON_REQUIRED'});
  if(active>=16)return send(res,429,{error:'BUSY'});
  active++;
  try{
   const b=await read(req);
   if(req.url==='/heartbeat'){
    if(!Array.isArray(b.devices)||b.devices.some(d=>entry.allowed.get(d?.id)!==d?.platform))throw Error('Unauthorized device');
    rack.heartbeatHost(host,b.devices);return send(res,200,{accepted:true});
   }
   if(req.url==='/claim')return send(res,200,{lease:rack.claim({host,platform:b.platform,jobId:b.jobId,ttlMs:300000})});
   if(!entry.allowed.has(b.deviceId))throw Error('Unauthorized device');
   return send(res,200,{accepted:rack.finish({host,deviceId:b.deviceId,token:b.token,fence:b.fence,cleanupVerified:b.cleanupVerified===true})});
  }catch{if(!res.destroyed)send(res,400,{error:'REQUEST_REJECTED'});}
  finally{active--;}
 });
 server.maxConnections=64;
 return {server,listen(port=0){return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve(server.address());});});}};
}
export function createRackClient({port,host,token,request=fetch}={}){
 if(!Number.isInteger(port)||port<1||port>65535||typeof host!=='string'||!id.test(host)||typeof token!=='string'||!tokenPattern.test(token))throw Error('Invalid rack client');
 async function call(path,body){
  const payload=JSON.stringify(body);if(Buffer.byteLength(payload)>maxBody)throw Error('Request limit');
  const res=await request('http://127.0.0.1:'+port+path,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/json','x-testlab-host':host,authorization:'Bearer '+token},body:payload});
  if(!res.ok||!res.body)throw Error('Rack request rejected');
  const reader=res.body.getReader();let n=0;const chunks=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;n+=value.byteLength;if(n>maxBody)throw Error('Response limit');chunks.push(Buffer.from(value));}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }
 return {heartbeat:devices=>call('/heartbeat',{devices}),claim:({platform,jobId})=>call('/claim',{platform,jobId}),finish:lease=>call('/finish',lease)};
}
