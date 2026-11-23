import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createInventory, partitionItems, buildEvidenceHierarchy } from '../src/hcie.js';

const digest=s=>createHash('sha256').update(s).digest('hex');
const makeFiles=n=>Array.from({length:n},(_,i)=>({path:'src/file'+String(i).padStart(5,'0')+'.ts',sha256:digest('file'+i),bytes:100,status:'INDEXED'}));
const assess=files=>files.map((f,i)=>({id:'a'+i,status:'ANALYZED',evidence:[{id:'e'+i,sourcePath:f.path,sourceHash:f.sha256,startLine:1,endLine:2}]}));

test('every file remains traceable through a multi-layer reduction',()=>{
  const files=makeFiles(1025);
  const inventory=createInventory(files,'commit-001');
  const tree=buildEvidenceHierarchy({inventory,assessments:assess(files),fanout:16});
  assert.ok(tree.layers.length>=3);
  assert.equal(tree.rootId,tree.layers.at(-1)[0].id);
  assert.equal(tree.layers.at(-1)[0].sourceIds.length,1025);
  assert.equal(tree.layers.at(-1)[0].evidenceIds.length,1025);
  assert.equal(tree.analysisComplete,true);
  assert.equal(tree.testingComplete,false);
  assert.equal(tree.productCertified,false);
});

test('missing analysis cannot become complete via summaries',()=>{
  const files=makeFiles(5);
  const tree=buildEvidenceHierarchy({inventory:createInventory(files,'commit-002'),assessments:assess(files.slice(0,4)),fanout:2});
  assert.equal(tree.analysisComplete,false);
  assert.deepEqual(tree.sourceCoverage.incomplete,[files[4].path]);
});

test('incomplete chunks propagate up every level',()=>{
  const files=makeFiles(8);
  const records=assess(files);
  records[4].status='INCOMPLETE';
  const tree=buildEvidenceHierarchy({inventory:createInventory(files,'commit-003'),assessments:records,fanout:2});
  assert.equal(tree.layers.at(-1)[0].status,'INCOMPLETE');
  assert.equal(tree.analysisComplete,false);
});

test('reject source mismatches, duplicate paths and invalid evidence',()=>{
  const files=makeFiles(2);
  assert.throws(()=>createInventory([files[0],files[0]],'r'),/Duplicate path/);
  assert.throws(()=>createInventory([{...files[0],path:'../escape'}],'r'),/Invalid/);
  const inventory=createInventory(files,'r');
  const records=assess(files);
  records[0].evidence[0].sourceHash=digest('wrong');
  assert.throws(()=>buildEvidenceHierarchy({inventory,assessments:records}),/hash mismatch/);
});

test('bounded partitioning handles empty and large collections without losing entries',()=>{
  assert.deepEqual(partitionItems([]),[]);
  const values=Array.from({length:45000},(_,i)=>i);
  const groups=partitionItems(values,64);
  assert.equal(groups.flat().length,45000);
  assert.throws(()=>partitionItems(values,1),/Invalid/);
});
