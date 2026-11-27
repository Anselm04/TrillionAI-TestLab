import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveProject, executeRun, readStoredReport, persistReport, MAX_REPORT_BYTES } from '../src/core.js';
import { verifyReportChecksum, sealReport } from '../src/evidence.js';
import { randomUUID } from 'node:crypto';

test('reject traversal and invalid names', async () => {
  const root = await mkdtemp(join(tmpdir(), 'testlab-root-'));
  await assert.rejects(resolveProject(root, '../etc'));
  await assert.rejects(resolveProject(root, '/etc'));
  await assert.rejects(resolveProject(root, '..'));
});

test('reject symlinks escaping workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'testlab-root-'));
  await symlink(tmpdir(), join(root, 'escape'));
  await assert.rejects(resolveProject(root, 'escape'), /outside workspace/);
});

test('test runs save evidence of real runner return code', async () => {
  const root = await mkdtemp(join(tmpdir(), 'testlab-root-'));
  await mkdir(join(root, 'sample'));
  const reports = join(root, 'reports');
  const report = await executeRun({workspaceRoot:root, reportRoot:reports, project:'sample', runner: async (bin,args) => {
    assert.equal(bin, 'docker');
    assert.ok(args.includes('--network'));
    assert.ok(args.includes('none'));
    return {exitCode:1,output:'FAIL sample test',timedOut:false};
  }});
  assert.equal(report.status,'FAILED');
  assert.equal(report.observations[0].status,'FAILED');
  assert.equal(report.productionReady,false);
  assert.deepEqual(report.sourceRevision,{status:'UNKNOWN',sha:null,reason:'Local workspace is not an immutable revision snapshot'});
  assert.equal(verifyReportChecksum(report),true);
  assert.equal(JSON.parse(await readFile(join(reports,report.id+'.json'))).status,'FAILED');
});

test('missing Docker must never pass', async () => {
  const root = await mkdtemp(join(tmpdir(), 'testlab-root-'));
  await mkdir(join(root, 'sample'));
  const report = await executeRun({workspaceRoot:root,reportRoot:join(root,'reports'),project:'sample',runner:async()=>({exitCode:null,error:'spawn docker ENOENT'})});
  assert.equal(report.status,'INFRASTRUCTURE_ERROR');
});

test('runner interruptions and missing records persist as infrastructure outcomes', async (t) => {
  const root=await mkdtemp(join(tmpdir(),'testlab-interruption-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'sample'));
  const reportRoot=join(root,'reports');
  for(const runner of [async()=>undefined,async()=>null,async()=>{throw new Error('fixture interruption');}]) {
    const report=await executeRun({workspaceRoot:root,reportRoot,project:'sample',runner});
    assert.equal(report.status,'INFRASTRUCTURE_ERROR');
    assert.equal(report.checks[0].exitCode,null);
    assert.equal(report.execution.cleanupVerified,false);
    assert.equal(report.observations[0].status,'INFRASTRUCTURE_ERROR');
    assert.deepEqual(await readStoredReport(reportRoot,report.id),report);
  }
});

test('stored report retrieval distinguishes missing and inconsistent evidence', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'testlab-report-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'sample'));
  const reports = join(root,'reports');
  const report = await executeRun({workspaceRoot:root,reportRoot:reports,project:'sample',runner:async()=>({exitCode:0})});
  assert.deepEqual(await readStoredReport(reports,report.id),report);
  assert.equal(await readStoredReport(reports,'00000000-0000-4000-8000-000000000000'),null);
  const path = join(reports,report.id+'.json');
  await writeFile(path,JSON.stringify({...report,status:'FAILED'}));
  await assert.rejects(readStoredReport(reports,report.id),/Report integrity/);
  await writeFile(path,'{');
  await assert.rejects(readStoredReport(reports,report.id),/Report integrity/);
  const otherId='00000000-0000-4000-8000-000000000000';
  await writeFile(join(reports,otherId+'.json'),JSON.stringify(report));
  await assert.rejects(readStoredReport(reports,otherId),/Report integrity/);
});

test('report publication never replaces existing evidence and leaves no staging files',async t=>{
  const root=await mkdtemp(join(tmpdir(),'testlab-report-publish-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'sample'));
  const reports=join(root,'reports');
  const report=await executeRun({workspaceRoot:root,reportRoot:reports,project:'sample',runner:async()=>({exitCode:1})});
  await assert.rejects(persistReport(reports,report),{code:'EEXIST'});
  assert.deepEqual(await readStoredReport(reports,report.id),report);
  assert.deepEqual(await readdir(reports),[report.id+'.json']);
  await assert.rejects(persistReport(reports,{...report,status:'PASSED'}),/Report integrity/);
  assert.deepEqual(await readdir(reports),[report.id+'.json']);
  const concurrent=join(root,'concurrent');
  const attempts=await Promise.allSettled([persistReport(concurrent,report),persistReport(concurrent,report)]);
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(attempts.find(x=>x.status==='rejected').reason.code,'EEXIST');
  assert.deepEqual(await readStoredReport(concurrent,report.id),report);
  assert.deepEqual(await readdir(concurrent),[report.id+'.json']);
});

test('local evidence storage rejects oversized reports before publication or retrieval',async t=>{
  const root=await mkdtemp(join(tmpdir(),'testlab-report-budget-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'sample'));
  const reports=join(root,'reports');
  const report=await executeRun({workspaceRoot:root,reportRoot:reports,project:'sample',runner:async()=>({exitCode:0})});
  const {integrity,...body}=report;
  const large=sealReport({...body,id:randomUUID(),notes:'x'.repeat(MAX_REPORT_BYTES)});
  await assert.rejects(persistReport(reports,large),/Report size limit/);
  assert.equal(await readStoredReport(reports,large.id),null);
  await writeFile(join(reports,large.id+'.json'),JSON.stringify(large));
  await assert.rejects(readStoredReport(reports,large.id),/Report size limit/);
  assert.deepEqual(await readStoredReport(reports,report.id),report);
});

test('bounded concurrent report publication retains all 128 independent outcomes',async t=>{
  const root=await mkdtemp(join(tmpdir(),'testlab-report-concurrency-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'sample'));
  const reports=join(root,'reports');
  const results=[];
  for(let i=0;i<128;i+=4){
    const batch=await Promise.all(Array.from({length:4},(_,j)=>executeRun({workspaceRoot:root,reportRoot:reports,project:'sample',runner:async()=>({exitCode:(i+j)%2})})));
    results.push(...batch);
  }
  assert.equal(new Set(results.map(r=>r.id)).size,128);
  assert.equal((await readdir(reports)).length,128);
  for(const report of results)assert.deepEqual(await readStoredReport(reports,report.id),report);
  assert.equal(results.filter(r=>r.status==='PASSED').length,64);
  assert.equal(results.filter(r=>r.status==='FAILED').length,64);
});
