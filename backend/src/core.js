import { realpath, mkdir, writeFile } from 'node:fs/promises';
import { join, relative, isAbsolute, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { makeObservation, sealReport } from './evidence.js';
import { runDockerLifecycle } from './docker-lifecycle.js';

export async function resolveProject(root, name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(name) || name === '.' || name === '..') throw new Error('Project must be a single directory name');
  const rootPath = await realpath(root);
  const projectPath = await realpath(resolve(rootPath, name));
  const rel = relative(rootPath, projectPath);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('Project outside workspace');
  return projectPath;
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
  const result = runner ? await runner('docker', args, { timeoutMs: 120000 }) : await runDockerLifecycle(args, { timeoutMs: 120000 });
  const observation = makeObservation({ checkId: 'node-built-in-tests', command: 'node --test', runnerResult: result, environment: { image, network: 'none', readOnlyRoot: true } });
  const status = observation.status;
  const report = sealReport({
    schemaVersion: 1, id, project, profile: 'node-built-in-tests',
    startedAt: start, finishedAt: new Date().toISOString(), status,
    checks: [{ name: 'Node.js built-in test suite', status, exitCode: result.exitCode ?? null }],
    scope: 'Initial Node.js test runner only. NOT a production-readiness certificate.',
    execution: { image, network: 'disabled', readOnly: true, resourceLimits: true, cleanupVerified: result.cleanupVerified === true },
    evidence: { output: result.output || '', error: result.error || null },
    observations: [observation],
    productionReady: false
  });
  await mkdir(reportRoot, { recursive: true });
  await writeFile(join(reportRoot, id + '.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  return report;
}
