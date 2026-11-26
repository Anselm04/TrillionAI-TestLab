import {createHash} from 'node:crypto';
const sha=/^[a-f0-9]{64}$/;
const valid=v=>typeof v==='string'&&sha.test(v);
const hash=v=>createHash('sha256').update(v).digest('hex');
const integer=(v,a,b)=>Number.isSafeInteger(v)&&v>=a&&v<=b;
const pathOK=p=>typeof p==='string'&&p.length>0&&p.length<=4096&&!p.includes('\\')&&!p.includes('\0')&&p.split('/').every(x=>x&&x!=='.'&&x!=='..');
// Derive the expected task order from an independently sealed inventory,
// not from the map queue. All storage adapters are trusted local inputs.
export async function deriveSchedulingManifest({inventory,chunks,revisionSha256,policySha256,expectedFileCount,expectedInventoryDigest,checkCapacity,signal,maxTasks=1000000}={}){
 if(typeof inventory?.page!=='function'||typeof chunks?.page!=='function'||![revisionSha256,policySha256,expectedInventoryDigest].every(valid)||!integer(expectedFileCount,1,10000000)||!integer(maxTasks,1,10000000)||typeof checkCapacity!=='function')throw Error('Invalid scheduling policy');
 const inventoryHash=createHash('sha256').update(revisionSha256+'\n'),taskHash=createHash('sha256');
 let files=0,indexed=0,unavailable=0,empty=0,tasks=0,after='';
 const guard=async()=>{if(signal?.aborted||await checkCapacity()!==true||signal?.aborted)throw Error('Scheduling manifest paused');};
 while(true){
  await guard();
  const page=inventory.page({after,limit:128});
  if(!Array.isArray(page.entries)||page.entries.length>128||typeof page.hasMore!=='boolean'||(page.hasMore&&page.entries.length!==128)||page.nextCursor!==(page.entries.at(-1)?.path??after))throw Error('Inventory page mismatch');
  for(const entry of page.entries){
   if(!pathOK(entry.path)||Buffer.compare(Buffer.from(entry.path),Buffer.from(after))<=0||++files>expectedFileCount)throw Error('Inventory coverage mismatch');
   after=entry.path;inventoryHash.update(JSON.stringify(entry)+'\n');
   if(entry.status!=='INDEXED'){
    if(!['UNREADABLE','EXCLUDED','UNSUPPORTED','PENDING'].includes(entry.status))throw Error('Invalid inventory state');
    unavailable++;continue;
   }
   if(!valid(entry.sha256)||!integer(entry.bytes,0,2147483648))throw Error('Invalid indexed source');
   indexed++;
   const manifestHash=createHash('sha256');let cursor=-1,offset=0,digest=null;
   while(true){
    await guard();
    const p=chunks.page({path:entry.path,after:cursor,limit:128});
    if(!valid(p.manifestSha256)||!Array.isArray(p.entries)||p.entries.length>128||typeof p.hasMore!=='boolean'||(p.hasMore&&p.entries.length!==128)||p.nextCursor!==(p.entries.at(-1)?.index??cursor)||(digest!==null&&digest!==p.manifestSha256))throw Error('Chunk page mismatch');
    digest=p.manifestSha256;
    for(const d of p.entries){
     const {id,...body}=d;
     if(!valid(id)||hash(JSON.stringify(body))!==id||d.revisionSha256!==revisionSha256||d.sourcePath!==entry.path||d.sourceHash!==entry.sha256||d.index!==cursor+1||d.startByte!==offset||!integer(d.endByte,offset+1,Math.min(entry.bytes,offset+65536))||!valid(d.chunkSha256)||++tasks>maxTasks)throw Error('Chunk coverage or task budget mismatch');
     cursor=d.index;offset=d.endByte;manifestHash.update(JSON.stringify(d)+'\n');
     const descriptor={revisionSha256,policySha256,path:entry.path,index:d.index,chunkId:id,chunkSha256:d.chunkSha256,manifestSha256:digest};
     taskHash.update(hash(JSON.stringify(descriptor))+'\n');
    }
    if(!p.hasMore)break;
   }
   if(offset!==entry.bytes||manifestHash.digest('hex')!==digest)throw Error('Source manifest coverage mismatch');
   if(entry.bytes===0)empty++;
  }
  if(!page.hasMore)break;
 }
 await guard();
 if(files!==expectedFileCount||inventoryHash.digest('hex')!==expectedInventoryDigest)throw Error('Inventory manifest mismatch');
 return {revisionSha256,policySha256,inventoryDigest:expectedInventoryDigest,fileCount:files,indexed,unavailable,empty,expectedCount:tasks,expectedTaskDigest:taskHash.digest('hex'),sourceCoverageComplete:unavailable===0,analysisComplete:false,testingComplete:false};
}
