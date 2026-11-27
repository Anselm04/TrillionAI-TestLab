import { realpath, mkdir, open, link, unlink } from 'node:fs/promises';
import { join, relative, isAbsolute, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { makeObservation, sealReport, verifyReportChecksum } from './evidence.js';
import { runDockerLifecycle } from './docker-lifecycle.js';

export const MAX_REPORT_BYTES=4*1024*1024;

export async function resolveProject(root, name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(name) || name === '.' || name === '..') throw new Error('Project must be a single directory name');
  const rootPath = await realpath(root);
  const projectPath = await realpath(resolve(rootPath, name));
  const rel = relative(rootPath, projectPath);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('Project outside workspace');
  return projectPath;
}

// The stored checksum detects accidental corruption, not hostile replacement.
export async function readStoredReport(reportRoot, id) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error('Invalid report ID');
  let handle,data;
  try { handle=await open(join(reportRoot,id+'.json'),'r'); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  try {
    const info=await handle.stat();
    if(!info.isFile()||!Number.isSafeInteger(info.size)||info.size>MAX_REPORT_BYTES)throw new Error('Report size limit or file type invalid');
    const buffer=Buffer.alloc(info.size+1);
    let offset=0;
    while(offset<buffer.length){
      const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,offset);
      if(bytesRead===0)break;
      offset+=bytesRead;
    }
    if(offset!==info.size)throw new Error('Report integrity check failed');
    data=buffer.subarray(0,offset).toString('utf8');
  } finally { await handle.close(); }
  let report;
  try { report = JSON.parse(data); }
  catch { throw new Error('Report integrity check failed'); }
  if (report?.id !== id || !verifyReportChecksum(report)) throw new Error('Report integrity check failed');
  return report;
}

// Local filesystem publication: write and sync a private staging file, then
// publish it atomically without replacing an existing report. A crash can
// leave an ignored staging file but cannot expose a partially written report.
export async function persistReport(reportRoot, report) {
  const id=report?.id;
  if (typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)||!verifyReportChecksum(report)) throw new Error('Report integrity check failed');
  const serialized=JSON.stringify(report,null,2);
  if(Buffer.byteLength(serialized,'utf8')>MAX_REPORT_BYTES)throw new Error('Report size limit exceeded');
  await mkdir(reportRoot,{recursive:true});
  const staged=join(reportRoot,'.'+id+'.'+randomUUID()+'.tmp');
  const handle=await open(staged,'wx',0o600);
  try {
    try { await handle.writeFile(serialized,'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await link(staged,join(reportRoot,id+'.json'));
  } finally { await unlink(staged); }
  // The current production-independent runner targets Linux filesystems.
  // Sync the namespace change before acknowledging persisted evidence.
  const directory=await open(reportRoot,'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

export function runProcess(binary, args, { timeoutMs = 120000, outputLimit = 128000, binaryOutput = false } = {}) {
  return new Promise((done) => {
    let output = '', finished = false, timedOut = false, outputTruncated = false;
    const child = spawn(binary, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let binarySize=0; const chunks=[];
    const collectBinary=chunk=>{if(chunk.length>outputLimit-binarySize)outputTruncated=true;const part=chunk.subarray(0,Math.max(0,outputLimit-binarySize));chunks.push(part);binarySize+=part.length;};
    const collect = chunk => { const text=chunk.toString(); if(text.length>outputLimit-output.length)outputTruncated=true; if (output.length < outputLimit) output += text.slice(0, outputLimit - output.length); };
    child.stdout.on('data', binaryOutput ? collectBinary : collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    const complete = (result) => { if (!finished) { finished = true; clearTimeout(timer); done({ ...result, output: output.slice(0, outputLimit), timedOut, outputTruncated, ...(binaryOutput?{stdoutBytes:Buffer.concat(chunks,binarySize)}:{}) }); } };
    child.on('error', err => complete({ exitCode: null, error: err.message }));
    child.on('close', code => complete({ exitCode: code }));
  });
}

export async function executeRun({ workspaceRoot, reportRoot, project, runner = null }) {
  const id = randomUUID();
  const start = new Date().toISOString();
  const projectPath = await resolveProject(workspaceRoot, project);
  // Docker is only for trusted local projects in this phase; hostile code requires VM isolation.
  const image = process.env.TESTLAB_NODE_IMAGE || 'node:22-alpine';
  const args = [
    'run', '--rm', '--name', 'testlab-' + id, '--network', 'none', '--read-only',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--pids-limit', '128', '--cpus', '1', '--memory', '512m',
    '--user', '1000:1000', '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m',
    '--mount', 'type=bind,source=' + projectPath + ',target=/workspace,readonly',
    '--workdir', '/workspace', image, 'node', '--test'
  ];
  let result;
  try {
    result = runner ? await runner('docker', args, { timeoutMs: 120000 }) : await runDockerLifecycle(args, { timeoutMs: 120000 });
  } catch {
    result = {exitCode:null,error:'Runner execution interrupted'};
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) result = {exitCode:null,error:'Runner did not return an execution record'};
  const observation = makeObservation({ checkId: 'node-built-in-tests', command: 'node --test', runnerResult: result, environment: { image, network: 'none', readOnlyRoot: true } });
  const status = observation.status;
  const report = sealReport({
    schemaVersion: 1, id, project, profile: 'node-built-in-tests',
    sourceRevision: {status:'UNKNOWN',sha:null,reason:'Local workspace is not an immutable revision snapshot'},
    startedAt: start, finishedAt: new Date().toISOString(), status,
    checks: [{ name: 'Node.js built-in test suite', status, exitCode: observation.exitCode }],
    scope: 'Initial Node.js test runner only. NOT a production-readiness certificate.',
    execution: { image, network: 'disabled', readOnly: true, resourceLimits: true, cleanupVerified: result.cleanupVerified === true },
    evidence: { output: observation.evidence.stdoutStderr, error: observation.evidence.executorError },
    observations: [observation],
    productionReady: false
  });
  await persistReport(reportRoot,report);
  return report;
}
