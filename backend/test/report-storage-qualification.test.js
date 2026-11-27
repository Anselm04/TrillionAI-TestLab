import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {persistReport,readStoredReport} from '../src/core.js';
import {makeObservation,sealReport} from '../src/evidence.js';

// Local report storage only: no customer code, external service, device,
// network workload or production infrastructure participates in this test.
test('bounded local report storage soak preserves every outcome and records measured resource observations',{timeout:20000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'testlab-storage-soak-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const count=32,intervalMs=100,fixtureOutput='x'.repeat(128*1024);
 const expected=[],latencies=[];
 const initialRss=process.memoryUsage.rss();
 let sampledPeakRss=initialRss,storedBytes=0;
 const start=performance.now();
 for(let i=0;i<count;i++){
  const observation=makeObservation({checkId:'node-built-in-tests',command:'node --test',runnerResult:{exitCode:i%2,output:fixtureOutput},environment:{name:'local-fixture'}});
  const report=sealReport({schemaVersion:1,id:randomUUID(),project:'fixture',profile:'node-built-in-tests',status:observation.status,observations:[observation],productionReady:false});
  const began=performance.now();
  await persistReport(root,report);
  assert.deepEqual(await readStoredReport(root,report.id),report);
  latencies.push(performance.now()-began);
  expected.push({id:report.id,status:report.status,digest:report.integrity.digest});
  storedBytes+=(await stat(join(root,report.id+'.json'))).size;
  sampledPeakRss=Math.max(sampledPeakRss,process.memoryUsage.rss());
  if(i<count-1)await delay(intervalMs);
 }
 assert.equal((await readdir(root)).length,count);
 for(const entry of expected){
  const report=await readStoredReport(root,entry.id);
  assert.equal(report.status,entry.status);
  assert.equal(report.integrity.digest,entry.digest);
 }
 assert.equal(expected.filter(r=>r.status==='PASSED').length,16);
 assert.equal(expected.filter(r=>r.status==='FAILED').length,16);
 latencies.sort((a,b)=>a-b);
 const elapsedMs=Math.round(performance.now()-start);
 assert.ok(elapsedMs>=3000,'Timed fixture must cover the declared sampling interval');
 t.diagnostic(JSON.stringify({scope:'LOCAL_REPORT_STORAGE_FIXTURE',cycles:count,elapsedMs,storedBytes,
  p95PublishAndReadMs:Number(latencies[Math.ceil(count*.95)-1].toFixed(2)),initialRssBytes:initialRss,sampledPeakRssBytes:sampledPeakRss,
  productionReady:false,customerThroughputVerified:false}));
});
