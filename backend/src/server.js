import http from 'node:http';
import { resolve } from 'node:path';
import { executeRun, readStoredReport } from './core.js';
import { compareRunReports } from './report-comparison.js';
import { catalogCapabilities } from './capability-registry.js';
import { createTestkubeClient } from './testkube-client.js';
import { DurableDeviceLeases } from './durable-device-leases.js';
import { MobileJobs } from './mobile-jobs.js';
import { createRackTransport } from './rack-transport.js';
import { RackCoordinator } from './rack-coordinator.js';
import { inspectDeviceFarm } from './device-farm-status.js';

const host = process.env.TESTLAB_HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8787);
const workspaceRoot = resolve(process.env.TESTLAB_WORKSPACE_ROOT || '../examples');
const reportRoot = resolve(process.env.TESTLAB_REPORT_ROOT || './reports');
const token = process.env.TESTLAB_TOKEN;
if (!token || token.length < 24) { console.error('Set TESTLAB_TOKEN to a random secret at least 24 characters long.'); process.exit(1); }
const approvedDevices=(process.env.TESTLAB_DEVICE_ALLOWLIST||'').split(',').map(x=>x.trim()).filter(Boolean);
const farmEnabled=approvedDevices.length>0&&!!process.env.TESTLAB_DEVICE_DB;
const leases=farmEnabled?new DurableDeviceLeases(resolve(process.env.TESTLAB_DEVICE_DB)):null;
const rack=process.env.TESTLAB_RACK_DB?new RackCoordinator(resolve(process.env.TESTLAB_RACK_DB)):null;
const jobs=process.env.TESTLAB_MOBILE_JOB_DB?new MobileJobs(resolve(process.env.TESTLAB_MOBILE_JOB_DB),{profiles:JSON.parse(process.env.TESTLAB_MOBILE_PROFILES||'[]')}):null;
if(jobs){
 if(!rack||!process.env.TESTLAB_RACK_HOSTS)throw Error('Mobile jobs require rack and host configuration');
 const transport=createRackTransport({rack,jobs,hosts:JSON.parse(process.env.TESTLAB_RACK_HOSTS)});
 await transport.listen(Number(process.env.TESTLAB_RACK_PORT||8788));
}
const testkube = process.env.TESTLAB_TESTKUBE_ORIGIN ? createTestkubeClient({origin:process.env.TESTLAB_TESTKUBE_ORIGIN,approvedTests:(process.env.TESTLAB_TESTKUBE_TESTS||'').split(',').map(x=>x.trim()).filter(Boolean)}) : null;
let active = false;
// Bound admitted HTTP requests while serializing engine submission calls.
// Kubernetes workloads can execute concurrently after submission returns.
let testkubeAdmitted = 0;
let testkubeSubmissionTail = Promise.resolve();
function send(res, code, data) { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); }
const server = http.createServer(async (req, res) => {
  if (req.url === '/health' && req.method === 'GET') return send(res, 200, { ok: true, service: 'TrillionAI-TestLab', version: '0.1.0' });
  if (req.headers.authorization !== 'Bearer ' + token) return send(res, 401, { error: 'Unauthorized' });
  if (req.url === '/capabilities' && req.method === 'GET') {
    return send(res,200,{schemaVersion:1,scope:'DECLARED_LOCAL_RUNNER',domains:catalogCapabilities(),productionReady:false});
  }
  if (req.url === '/device-farm' && req.method === 'GET') {
    if(rack){try{return send(res,200,{status:'RACK_SNAPSHOT',devices:rack.inventory(),productionReady:false});}catch{return send(res,503,{status:'INFRASTRUCTURE_ERROR',devices:[],productionReady:false});}}
    if(!farmEnabled)return send(res,200,{status:'NOT_CONFIGURED',devices:[],productionReady:false});
    try{return send(res,200,await inspectDeviceFarm({approvedDevices,leases}));}
    catch{return send(res,503,{status:'INFRASTRUCTURE_ERROR',devices:[],productionReady:false});}
  }
  if(req.url==='/mobile-jobs'&&req.method==='POST'){
    if(!jobs)return send(res,503,{error:'MOBILE_JOBS_NOT_CONFIGURED'});
    try{
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>4096)return send(res,413,{error:'Request too large'});chunks.push(chunk);}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!body||Object.keys(body).length!==1||typeof body.profileId!=='string')return send(res,400,{error:'PROFILE_REQUIRED'});
      return send(res,202,jobs.submit(body.profileId));
    }catch{return send(res,400,{error:'REQUEST_REJECTED'});}
  }
  const mobileMatch=/^\/mobile-jobs\/([0-9a-f-]{36})$/.exec(req.url||'');
  if(mobileMatch&&req.method==='GET'){
    const job=jobs?.get(mobileMatch[1]);return send(res,job?200:404,job??{error:'NOT_FOUND'});
  }
  if (req.url === '/testkube/executions' && req.method === 'POST') {
    if (!testkube) return send(res,503,{error:'TESTKUBE_NOT_CONFIGURED'});
    if (testkubeAdmitted >= 2) {
      res.setHeader('retry-after','1');
      return send(res,429,{error:'TESTKUBE_REQUEST_BUSY'});
    }
    testkubeAdmitted++;
    try {
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>4096)return send(res,413,{error:'Request too large'});chunks.push(chunk);}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!body||Object.keys(body).length!==1||typeof body.testName!=='string')return send(res,400,{error:'TEST_NAME_REQUIRED'});
      const previous = testkubeSubmissionTail;
      let release;
      testkubeSubmissionTail = new Promise(resolve => { release = resolve; });
      try {
        await previous;
        if (res.destroyed) return;
        return send(res,202,await testkube.submit(body.testName));
      } finally { release(); }
    }catch{return send(res,400,{error:'TESTKUBE_SUBMISSION_UNCONFIRMED'});}
    finally{testkubeAdmitted--;}
  }
  if (req.url === '/runs' && req.method === 'POST') {
    if (active) return send(res, 429, { error: 'Runner busy; concurrency is limited to one' });
    active = true;
    try {
      let data = '';
      for await (const chunk of req) {
        data += chunk;
        if (data.length > 4096) return send(res, 413, { error: 'Request too large' });
      }
      const body = JSON.parse(data);
      const report = await executeRun({ workspaceRoot, reportRoot, project: body.project });
      return send(res, 200, report);
    } catch (err) { return send(res, 400, { error: err.message }); }
    finally { active = false; }
  }
  const comparison = /^\/runs\/compare\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(req.url || '');
  if (comparison && req.method === 'GET') {
    let before,after;
    try { [before,after]=await Promise.all([readStoredReport(reportRoot,comparison[1]),readStoredReport(reportRoot,comparison[2])]); }
    catch { return send(res,503,{error:'REPORT_UNAVAILABLE'}); }
    if (!before||!after) return send(res,404,{error:'Not found'});
    try { return send(res,200,compareRunReports(before,after)); }
    catch { return send(res,409,{error:'REPORTS_INCOMPATIBLE'}); }
  }
  const match = /^\/runs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(req.url || '');
  if (match && req.method === 'GET') {
    try {
      const report = await readStoredReport(reportRoot,match[1]);
      return report ? send(res,200,report) : send(res,404,{error:'Not found'});
    } catch { return send(res,503,{error:'REPORT_UNAVAILABLE'}); }
  }
  return send(res, 404, { error: 'Not found' });
});
server.listen(port, host, () => console.log('TestLab local API listening on http://' + host + ':' + port));
