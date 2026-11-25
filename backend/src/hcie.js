import { createHash } from 'node:crypto';

// HCIE core: deterministic, bounded aggregation of evidence references.
// No LLM conclusion is treated as a verified test result.
const hash = data => createHash('sha256').update(data).digest('hex');
const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 4096;
const validEvidence = e => e && validId(e.id) && validId(e.sourcePath) &&
  Number.isInteger(e.startLine) && e.startLine > 0 &&
  Number.isInteger(e.endLine) && e.endLine >= e.startLine &&
  typeof e.sourceHash === 'string' && /^[a-f0-9]{64}$/.test(e.sourceHash);

export function createInventory(entries, revision) {
  if (!validId(revision) || !Array.isArray(entries)) throw new TypeError('Revision and entries required');
  const seen = new Set();
  const files = entries.map(entry => {
    const status = entry?.status ?? 'PENDING';
    const unavailable = ['UNREADABLE','EXCLUDED','UNSUPPORTED'].includes(status);
    if (!entry || !validId(entry.path) || entry.path.startsWith('/') ||
        entry.path.split('/').some(p => p === '..' || p === '.') ||
        (!(unavailable && entry.sha256 === null) && (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256))) ||
        (!(unavailable && entry.bytes === null) && (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0))) {
      throw new TypeError('Invalid inventory entry');
    }
    if (seen.has(entry.path)) throw new Error('Duplicate path: ' + entry.path);
    seen.add(entry.path);
    if (!['PENDING','INDEXED','UNREADABLE','EXCLUDED','UNSUPPORTED'].includes(status)) throw new TypeError('Invalid inventory status');
    return Object.freeze({path:entry.path,sha256:entry.sha256,bytes:entry.bytes,status,reason:entry.reason ?? null});
  }).sort((a,b)=>a.path.localeCompare(b.path,'en'));
  return Object.freeze({
    revision, fileCount:files.length, files:Object.freeze(files),
    inventoryHash:hash(JSON.stringify({revision,files}))
  });
}

export function partitionItems(items, maxPerGroup = 32) {
  if (!Array.isArray(items) || !Number.isSafeInteger(maxPerGroup) || maxPerGroup < 2 || maxPerGroup > 256)
    throw new TypeError('Invalid partition parameters');
  const out=[];
  for(let i=0;i<items.length;i+=maxPerGroup) out.push(items.slice(i,i+maxPerGroup));
  return out;
}

export function buildEvidenceHierarchy({inventory, assessments, fanout = 32}) {
  if (!inventory || !Array.isArray(inventory.files) || !Array.isArray(assessments))
    throw new TypeError('Invalid analysis input');
  if (!Number.isSafeInteger(fanout) || fanout < 2 || fanout > 256) throw new TypeError('Invalid fanout');
  const filePaths=new Set(inventory.files.map(f=>f.path));
  const ids=new Set();
  const leaves=assessments.map((a,i)=>{
    if (!a || !validId(a.id) || ids.has(a.id)) throw new Error('Invalid or duplicate assessment ID');
    ids.add(a.id);
    if (!['ANALYZED','INCOMPLETE'].includes(a.status)) throw new Error('Invalid assessment status');
    if (!Array.isArray(a.evidence) || a.evidence.some(e=>!validEvidence(e) || !filePaths.has(e.sourcePath))) throw new Error('Invalid evidence');
    // Evidence references must correspond to the inventoried source bytes.
    for(const e of a.evidence) {
      if (inventory.files.find(f=>f.path===e.sourcePath)?.sha256!==e.sourceHash)
        throw new Error('Source hash mismatch for '+e.sourcePath);
    }
    return {id:'leaf:'+a.id,kind:'LEAF',status:a.status,sourceIds:[a.id],evidenceIds:[...new Set(a.evidence.map(e=>e.id))],children:[],summary:a.summary ?? null};
  });
  const layers=[leaves];
  let nodes=leaves;
  let depth=0;
  while(nodes.length>1){
    depth++;
    nodes=partitionItems(nodes,fanout).map((group,i)=>({
      id:'level:'+depth+':'+i,kind:'GROUP',
      status:group.every(x=>x.status==='ANALYZED')?'ANALYZED':'INCOMPLETE',
      children:group.map(x=>x.id),
      sourceIds:[...new Set(group.flatMap(x=>x.sourceIds))],
      evidenceIds:[...new Set(group.flatMap(x=>x.evidenceIds))],
      // No lossy AI-generated conclusion is silently introduced during aggregation.
      summary:null
    }));
    layers.push(nodes);
  }
  const covered=new Set(assessments.flatMap(a=>a.evidence.map(e=>e.sourcePath)));
  const incomplete=inventory.files.filter(f=>f.status!=='INDEXED' || !covered.has(f.path)).map(f=>f.path);
  const root=nodes[0] ?? null;
  return {
    schemaVersion:1,revision:inventory.revision,inventoryHash:inventory.inventoryHash,
    fileCount:inventory.fileCount,assessmentCount:assessments.length,
    layers,rootId:root?.id??null,
    sourceCoverage:{accountedFor:inventory.fileCount,withEvidence:covered.size,incomplete},
    analysisComplete:incomplete.length===0 && !!root && root.status==='ANALYZED',
    testingComplete:false,productCertified:false
  };
}
