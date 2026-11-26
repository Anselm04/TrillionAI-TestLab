import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveProject, executeRun, readStoredReport } from '../src/core.js';
import { verifyReportChecksum } from '../src/evidence.js';

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
