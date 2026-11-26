import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {join} from 'node:path';
const sha=/^[a-f0-9]{64}$/;
const hash=v=>createHash('sha256').update(v).digest('hex');
// Trusted local manifest store. Only retrieve a sealed descriptor; never
// accept a caller-supplied object path, file offset or byte length.
export async function readVerifiedChunk({store,chunks,path,index,expectedRevisionSha256,expectedManifestSha256,signal}={}){
 if(typeof store?.root!=='function'||typeof chunks?.page!=='function'||typeof path!=='string'||!Number.isSafeInteger(index)||index<0||index>=1000000||typeof expectedRevisionSha256!=='string'||!sha.test(expectedRevisionSha256)||typeof expectedManifestSha256!=='string'||!sha.test(expectedManifestSha256))throw Error('Invalid retrieval request');
 if(signal?.aborted)throw Error('CANCELLED');
 const page=chunks.page({path,after:index-1,limit:1});
 const d=page.entries[0];
 if(page.manifestSha256!==expectedManifestSha256||!d||d.index!==index||d.sourcePath!==path||d.revisionSha256!==expectedRevisionSha256)throw Error('Chunk manifest binding failed');
 const {id,...body}=d;
 if(typeof d.sourceHash!=='string'||!sha.test(d.sourceHash)||typeof d.chunkSha256!=='string'||!sha.test(d.chunkSha256)||hash(JSON.stringify(body))!==id||!Number.isSafeInteger(d.startByte)||!Number.isSafeInteger(d.endByte)||d.startByte<0||d.endByte>2147483648||d.endByte<=d.startByte||d.endByte-d.startByte>65536)throw Error('Invalid descriptor');
 const fd=await open(join(await store.root(),d.sourceHash),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const before=await fd.stat({bigint:true});
  if(!before.isFile()||before.size<BigInt(d.endByte))throw Error('Source unavailable');
  const bytes=Buffer.alloc(d.endByte-d.startByte);let pos=0;
  while(pos<bytes.length){
   if(signal?.aborted)throw Error('CANCELLED');
   const {bytesRead}=await fd.read(bytes,pos,bytes.length-pos,d.startByte+pos);
   if(!bytesRead)throw Error('Source truncated');pos+=bytesRead;
  }
  const after=await fd.stat({bigint:true});
  if(signal?.aborted||before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs||hash(bytes)!==d.chunkSha256)throw Error('Chunk integrity failed');
  return {descriptor:Object.freeze({...d}),bytes,manifestSha256:page.manifestSha256};
 }finally{await fd.close();}
}
