import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createPrivateKey,createPublicKey} from 'node:crypto';

// Local service-account key files only; never accept a key path from a test job.
export async function loadServiceKey(path,{privateKey=false}={}){
 if(typeof path!=='string'||!path.startsWith('/'))throw new Error('Absolute key path required');
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 let bytes;
 try{
  const s=await fd.stat();
  if(!s.isFile()||s.size<1||s.size>16384||(privateKey&&(s.mode&0o077)!==0))throw new Error('Unsafe key file');
  if(privateKey&&typeof process.getuid==='function'&&s.uid!==process.getuid())throw new Error('Unexpected key owner');
  bytes=Buffer.alloc(s.size);
  let offset=0;
  while(offset<bytes.length){const {bytesRead}=await fd.read(bytes,offset,bytes.length-offset,offset);if(!bytesRead)throw new Error('Incomplete key');offset+=bytesRead;}
  if((await fd.stat()).size!==s.size)throw new Error('Key changed');
  if(!privateKey&&!bytes.toString('ascii').startsWith('-----BEGIN PUBLIC KEY-----'))throw new Error('Public key required');
  const key=privateKey?createPrivateKey(bytes):createPublicKey(bytes);
  if(key.asymmetricKeyType!=='ed25519')throw new Error('Ed25519 key required');
  return key;
 }finally{bytes?.fill(0);await fd.close();}
}
