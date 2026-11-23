import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveProject, executeRun } from '../src/core.js';

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
  assert.equal(JSON.parse(await readFile(join(reports,report.id+'.json'))).status,'FAILED');
});

test('missing Docker must never pass', async () => {
  const root = await mkdtemp(join(tmpdir(), 'testlab-root-'));
  await mkdir(join(root, 'sample'));
  const report = await executeRun({workspaceRoot:root,reportRoot:join(root,'reports'),project:'sample',runner:async()=>({exitCode:null,error:'spawn docker ENOENT'})});
  assert.equal(report.status,'INFRASTRUCTURE_ERROR');
});
