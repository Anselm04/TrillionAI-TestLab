import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open,mkdir,realpath,lstat,link,unlink,opendir} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,sep} from 'node:path';
const digest=/^[a-f0-9]{64}$/;
const flags=constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK;
const inside=(root,path)=>{const rel=relative(root,path);return !!rel&&rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);};
const integer=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const unchanged=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
// Operator-protected source snapshot and private store, with no concurrent
// untrusted directory writers. Not an openat2 race-proof filesystem sandbox.
export class HcieSourceStore{
 #root;
 constructor(root){if(typeof root!=='string'||!isAbsolute(root))throw Error('Absolute store required');this.#root=resolve(root);}
 async root(){
  await mkdir(this.#root,{recursive:true,mode:0o700});
  const s=await lstat(this.#root);
  if(!s.isDirectory()||(s.mode&0o077)!==0||await realpath(this.#root)!==this.#root)throw Error('Private canonical store required');
  return this.#root;
 }
 async verify({sha256,bytes}){
  if(typeof sha256!=='string'||!digest.test(sha256)||!integer(bytes,0,2147483648))return false;
  let fd;
  try{
   fd=await open(join(await this.root(),sha256),flags);
   const before=await fd.stat({bigint:true});
   if(!before.isFile()||before.size!==BigInt(bytes))return false;
   const h=createHash('sha256'),buffer=Buffer.alloc(65536);let pos=0;
   while(pos<bytes){const {bytesRead}=await fd.read(buffer,0,Math.min(buffer.length,bytes-pos),pos);if(!bytesRead)return false;h.update(buffer.subarray(0,bytesRead));pos+=bytesRead;}
   return h.digest('hex')===sha256&&unchanged(before,await fd.stat({bigint:true}));
  }catch{return false;}finally{await fd?.close();}
 }
 async capture(path,{maxBytes=67108864,signal}={}){
  if(typeof path!=='string'||!isAbsolute(path)||!integer(maxBytes,0,2147483648))throw Error('Invalid source capture');
  const root=await this.root(),temporary=join(root,'.capture-'+randomUUID());
  let input,output;
  try{
   if(signal?.aborted)throw Error('CANCELLED');
   input=await open(path,flags);
   const before=await input.stat({bigint:true});
   if(!before.isFile()||before.size>BigInt(maxBytes))throw Error('SOURCE_LIMIT_OR_TYPE');
   output=await open(temporary,'wx',0o600);
   const h=createHash('sha256'),buffer=Buffer.alloc(65536);let bytes=0;
   while(true){
    if(signal?.aborted)throw Error('CANCELLED');
    const {bytesRead}=await input.read(buffer,0,buffer.length,null);if(!bytesRead)break;
    bytes+=bytesRead;if(bytes>maxBytes)throw Error('SOURCE_LIMIT');
    const chunk=buffer.subarray(0,bytesRead);h.update(chunk);
    let offset=0;while(offset<bytesRead){const w=await output.write(chunk,offset,bytesRead-offset,null);if(!w.bytesWritten)throw Error('STORE_WRITE_FAILED');offset+=w.bytesWritten;}
   }
   if(signal?.aborted||BigInt(bytes)!==before.size||!unchanged(before,await input.stat({bigint:true})))throw Error('SOURCE_CHANGED_OR_CANCELLED');
   const sha256=h.digest('hex');await output.chmod(0o400);await output.sync();await output.close();output=undefined;
   try{await link(temporary,join(root,sha256));}catch(e){if(e.code!=='EEXIST')throw e;if(!await this.verify({sha256,bytes}))throw Error('EXISTING_OBJECT_INVALID');}
   const directory=await open(root,constants.O_RDONLY|constants.O_DIRECTORY);try{await directory.sync();}finally{await directory.close();}
   return {sha256,bytes};
  }finally{await input?.close();await output?.close();await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 }
}
// Streaming inventory of an operator-prepared tree, excluding no files
// silently. Unsupported paths are surfaced without fabricated source digests.
export async function* snapshotSource({sourceRoot,store,maxFiles=100000,maxFileBytes=67108864,maxTotalBytes=2147483648,maxDepth=64,signal}={}){
 if(typeof sourceRoot!=='string'||!isAbsolute(sourceRoot)||typeof store?.capture!=='function'||typeof store?.root!=='function'||!integer(maxFiles,1,10000000)||!integer(maxFileBytes,0,2147483648)||!integer(maxTotalBytes,0,Number.MAX_SAFE_INTEGER)||!integer(maxDepth,1,128))throw Error('Invalid snapshot limits');
 const root=resolve(sourceRoot),storage=await store.root();
 if(await realpath(root)!==root||!(await lstat(root)).isDirectory()||root===storage||inside(root,storage)||inside(storage,root))throw Error('Separate canonical source and storage roots required');
 let files=0,total=0;
 async function* walk(dir,depth){
  if(signal?.aborted)throw Error('CANCELLED');
  if(depth>maxDepth)throw Error('DEPTH_LIMIT');
  if(await realpath(dir)!==dir)throw Error('DIRECTORY_CHANGED');
  for await(const entry of await opendir(dir)){
   if(signal?.aborted)throw Error('CANCELLED');
   const full=join(dir,entry.name),path=relative(root,full).split(sep).join('/');
   if(!inside(root,full)||path.length>4096||path.includes('\\')||path.includes('\0'))throw Error('UNSUPPORTED_PATH');
   const s=await lstat(full);
   if(s.isDirectory()){yield* walk(full,depth+1);continue;}
   if(++files>maxFiles)throw Error('FILE_COUNT_LIMIT');
   if(!s.isFile()){yield {path,status:'UNSUPPORTED',reason:s.isSymbolicLink()?'SYMLINK':'SPECIAL_FILE',bytes:null,sha256:null};continue;}
   if(s.size>maxFileBytes){yield {path,status:'EXCLUDED',reason:'FILE_SIZE_LIMIT',bytes:s.size,sha256:null};continue;}
   if(s.size>maxTotalBytes-total)throw Error('TOTAL_BYTE_LIMIT');
   const captured=await store.capture(full,{maxBytes:Math.min(maxFileBytes,maxTotalBytes-total),signal});
   total+=captured.bytes;yield {path,...captured,status:'INDEXED',reason:null};
  }
 }
 yield* walk(root,0);
}
