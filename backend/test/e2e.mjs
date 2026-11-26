import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const reports = await mkdtemp(join(tmpdir(), 'testlab-reports-'));
const token = process.env.TESTLAB_TOKEN;
assert.ok(token?.length >= 24);
const port = 18787;
const server = spawn(process.execPath, ['backend/src/server.js'], {
  env: { ...process.env, TESTLAB_WORKSPACE_ROOT: resolve('examples'), TESTLAB_REPORT_ROOT: reports, PORT: String(port) },
  stdio: ['ignore','pipe','pipe']
});
try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch('http://127.0.0.1:'+port+'/health')).ok) { ready=true; break; } } catch {}
    await delay(100);
  }
  assert.ok(ready, 'Backend did not start');
  assert.equal((await fetch('http://127.0.0.1:'+port+'/runs',{method:'POST'})).status,401);
  const response = await fetch('http://127.0.0.1:'+port+'/runs',{
    method:'POST',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({project:'node-sample'})
  });
  assert.equal(response.status,200);
  const report = await response.json();
  assert.equal(report.status,'PASSED',JSON.stringify(report));
  assert.equal(report.execution.cleanupVerified,true,'Container removal must be verified');
  assert.equal(JSON.parse(await readFile(join(reports,report.id+'.json'),'utf8')).integrity.digest,report.integrity.digest);
  const retrieved = await fetch('http://127.0.0.1:'+port+'/runs/'+report.id,{headers:{Authorization:'Bearer '+token}});
  assert.equal(retrieved.status,200);
  assert.equal((await retrieved.json()).id,report.id);
  const headers={Authorization:'Bearer '+token};
  const missing=await fetch('http://127.0.0.1:'+port+'/runs/00000000-0000-4000-8000-000000000000',{headers});
  assert.equal(missing.status,404);
  await writeFile(join(reports,report.id+'.json'),JSON.stringify({...report,status:'FAILED'}));
  const inconsistent=await fetch('http://127.0.0.1:'+port+'/runs/'+report.id,{headers});
  assert.equal(inconsistent.status,503);
  assert.deepEqual(await inconsistent.json(),{error:'REPORT_UNAVAILABLE'});
  console.log('REAL isolated Docker testing and evidence persistence passed');
} finally { server.kill('SIGTERM'); }
