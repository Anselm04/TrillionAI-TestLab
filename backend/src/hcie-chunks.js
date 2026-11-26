import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {join} from 'node:path';
const sha=/^[a-f0-9]{64}$/;
const hash=x=>createHash('sha256').update(x).digest('hex');
const integer=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
// The private store must remain operator-protected. Byte offsets are
// half-open, lines are inclusive and LF-delimited. Oversize lines split
// deterministically; this is not a language parser or token counter.
export async function describeSourceChunks({store,entry,revisionSha256,maxChunkBytes=16384,maxChunks=100000,signal,checkCapacity,onChunk}={}){
 if(typeof store?.root!=='function'||typeof entry?.path!=='string'||!entry.path||entry.path.length>4096||entry.path.includes('\\')||entry.path.includes('\0')||entry.path.split('/').some(p=>!p||p==='.'||p==='..')||entry.status!=='INDEXED'||typeof entry.sha256!=='string'||!sha.test(entry.sha256)||!integer(entry.bytes,0,2147483648)||typeof revisionSha256!=='string'||!sha.test(revisionSha256)||!integer(maxChunkBytes,1,65536)||!integer(maxChunks,1,1000000)||typeof onChunk!=='function'||typeof checkCapacity!=='function')throw Error('Invalid chunk configuration');
 const sourcePath=entry.path,sourceHash=entry.sha256,bytes=entry.bytes;
 const fd=await open(join(await store.root(),sourceHash),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 const fileHash=createHash('sha256'),manifestHash=createHash('sha256');
 let offset=0,line=1,count=0;
 try{
  const before=await fd.stat({bigint:true});
  if(!before.isFile()||before.size!==BigInt(bytes))throw Error('SOURCE_SIZE_MISMATCH');
  const buffer=Buffer.alloc(maxChunkBytes);
  while(offset<bytes){
   if(signal?.aborted||await checkCapacity()!==true||signal?.aborted)throw Error('CHUNKING_PAUSED');
   if(count>=maxChunks)throw Error('CHUNK_BUDGET');
   const length=Math.min(maxChunkBytes,bytes-offset);let filled=0;
   while(filled<length){const {bytesRead}=await fd.read(buffer,filled,length-filled,offset+filled);if(!bytesRead)throw Error('SOURCE_TRUNCATED');filled+=bytesRead;}
   // Prefer the final LF in the bounded window, otherwise split long lines.
   const lastLF=buffer.subarray(0,length).lastIndexOf(10);
   const size=offset+length<bytes&&lastLF>=0?lastLF+1:length;
   const data=buffer.subarray(0,size);
   const startLine=line;let endLine=line;
   for(const byte of data){endLine=line;if(byte===10)line++;}
   fileHash.update(data);
   const body={revisionSha256,sourcePath,sourceHash,index:count,startByte:offset,endByte:offset+size,startLine,endLine,chunkSha256:hash(data)};
   const descriptor={...body,id:hash(JSON.stringify(body))};
   manifestHash.update(JSON.stringify(descriptor)+'\n');
   // Consumer must stage these records, not publish verified analysis yet.
   await onChunk(Object.freeze(descriptor));
   offset+=size;count++;
  }
  const after=await fd.stat({bigint:true});
  if(signal?.aborted||before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs||fileHash.digest('hex')!==sourceHash)throw Error('SOURCE_INTEGRITY_FAILED');
  return {status:'CHUNKS_VERIFIED',revisionSha256,sourcePath,sourceHash,bytes,chunkCount:count,chunkManifestSha256:manifestHash.digest('hex'),analysisComplete:false,testingComplete:false};
 }finally{await fd.close();}
}
