import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableExecution} from '../src/durable-execution.js';
import {analyzeJournalFailures} from '../src/journal-failure-intelligence.js';
const revisionSha256='a'.repeat(64),definitionSha256='b'.repeat(64);
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'testlab-history-'));
 let status='FAILED';
 const profile={id:'fixture',definitionSha256,execute:async c=>({...c,testId:'login',environmentId:'local',evidenceId:c.runId,status}),verify:async()=>true};
 let journal=new DurableExecution(join(dir,'runs.sqlite'),{profiles:[profile]});
 t.after(()=>{journal.close();rmSync(dir,{recursive:true,force:true});});
 return {get journal(){return journal;},async execute(next){status=next;const q=journal.submit({profileId:'fixture',revisionSha256});await journal.runNext({checkCapacity:async()=>true});return q.runId;},reopen(){journal.close();journal=new DurableExecution(join(dir,'runs.sqlite'),{profiles:[profile]});}};
}
const analyze=(journal,extra={})=>analyzeJournalFailures({projectId:'project',journal,verifyStoredObservation:async()=>true,...extra});
test('persistent history groups failures and mixed results after restart',async t=>{
 const f=fixture(t);await f.execute('FAILED');await f.execute('FAILED');await f.execute('PASSED');f.reopen();
 const r=await analyze(f.journal);assert.equal(r.status,'VERIFIED_HISTORY_ANALYZED');assert.equal(r.groups[0].count,2);assert.equal(r.recommendations[0].reason,'MIXED_VERIFIED_OUTCOMES');
});
test('queued and unverified results cannot count as findings',async t=>{
 const f=fixture(t);await f.execute('FAILED');f.journal.submit({profileId:'fixture',revisionSha256});
 const r=await analyze(f.journal,{verifyStoredObservation:async()=>false});assert.equal(r.status,'INCOMPLETE');assert.equal(r.groups.length,0);assert.equal(r.rejected.length,1);assert.equal(r.excluded[0].state,'QUEUED');
});
test('bounded pages preserve cursors without claiming complete coverage',async t=>{
 const f=fixture(t);await f.execute('FAILED');await f.execute('PASSED');await f.execute('FAILED');
 const first=await analyze(f.journal,{maxRuns:2});assert.equal(first.scanned,2);assert.equal(first.hasMore,true);assert.equal(first.status,'INCOMPLETE');
 const next=await analyze(f.journal,{after:first.nextCursor,maxRuns:2});assert.equal(next.scanned,1);assert.equal(next.hasMore,false);
 assert.throws(()=>f.journal.historyPage({limit:501}));
});
