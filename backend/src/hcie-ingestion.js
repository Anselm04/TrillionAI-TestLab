import {snapshotSource} from './hcie-source-store.js';
const sha=/^[a-f0-9]{64}$/;
// Trusted expected manifest supplied independently of the capture. An
// incomplete traversal never seals; committed batches remain resumable.
export async function ingestSourceInventory({inventory,store,sourceRoot,expectedManifest,checkCapacity,signal,batchSize=64,limits={}}={}){
 if(typeof inventory?.append!=='function'||typeof inventory?.seal!=='function'||typeof store?.verify!=='function'||typeof checkCapacity!=='function'||!Number.isInteger(batchSize)||batchSize<1||batchSize>256||!Number.isSafeInteger(expectedManifest?.expectedFileCount)||expectedManifest.expectedFileCount<1||typeof expectedManifest.expectedDigest!=='string'||!sha.test(expectedManifest.expectedDigest))throw Error('Invalid ingestion configuration');
 let scanned=0,indexed=0,unavailable=0,added=0;
 const batch=[];
 const report=(status,extra={})=>({status,scanned,indexed,unavailable,added,analysisComplete:false,testingComplete:false,...extra});
 const capacity=async()=>!signal?.aborted&&await checkCapacity()===true&&!signal?.aborted;
 const flush=()=>{if(batch.length){added+=inventory.append(batch).added;batch.length=0;}};
 if(!await capacity())return report('PAUSED');
 try{
  for await(const entry of snapshotSource({...limits,sourceRoot,store,signal})){
   if(!await capacity())return report('PAUSED');
   if(entry.status==='INDEXED'){
    if(!await store.verify(entry))throw Error('SOURCE_OBJECT_UNVERIFIED');
    indexed++;
   }else unavailable++;
   scanned++;
   if(scanned>expectedManifest.expectedFileCount)throw Error('MANIFEST_COUNT_EXCEEDED');
   batch.push(entry);
   if(batch.length===batchSize)flush();
  }
  if(!await capacity())return report('PAUSED');
  flush();
  const sealed=inventory.seal(expectedManifest);
  return report(unavailable?'INVENTORY_SEALED_WITH_GAPS':'INVENTORY_SEALED',{...sealed});
 }catch(e){return report('INCOMPLETE',{reason:String(e?.message??e).slice(0,256)});}
}
