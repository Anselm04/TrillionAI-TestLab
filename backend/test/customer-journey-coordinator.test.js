import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runCustomerJourneySuite} from '../src/customer-journey-coordinator.js';
const buildSha256='a'.repeat(64);
const catalog={syntheticOnly:true,networkIsolationConfirmed:true,packageName:'com.test.app',buildSha256,selectors:[{text:'Welcome',permission:'observe'}]};
const journey={id:'welcome',packageName:catalog.packageName,steps:[{action:'launch'},{action:'assertVisible',text:'Welcome'},{action:'stop'}]};
function fixture(){
 const calls=[];
 return {calls,config:{catalog,propose:async()=>[journey,{...journey,id:'second'}],artifact:{apkPath:'/fixtures/test.apk',apkSha256:buildSha256,signerSha256:['b'.repeat(64)]},deviceId:'device-1',verifyIsolation:async()=>true,issueChallenge:async ctx=>({...ctx,challengeId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}),orchestrator:{run:async input=>{calls.push(input);return {status:'EVIDENCE_REVIEWED'};}}}};
}
test('execute validated journeys sequentially with trusted artifact and review context',async()=>{
 const {calls,config}=fixture(),r=await runCustomerJourneySuite(config);
 assert.equal(r.status,'EVIDENCE_REVIEWED');assert.equal(r.reviewed,2);assert.equal(calls.length,2);
 assert.equal(calls[0].apkPath,'/fixtures/test.apk');assert.equal(calls[0].isolationConfirmed,true);assert.equal(r.deploymentAuthorized,false);
});
test('stop after failure and never execute without verified isolation',async()=>{
 const f=fixture();f.config.verifyIsolation=async()=>false;
 const r=await runCustomerJourneySuite(f.config);
 assert.equal(r.status,'BLOCKED');assert.equal(f.calls.length,0);assert.equal(r.results[1].status,'NOT_EXECUTED');
 const g=fixture();g.config.orchestrator.run=async input=>{g.calls.push(input);return {status:'BLOCKED'};};
 assert.equal((await runCustomerJourneySuite(g.config)).reviewed,0);assert.equal(g.calls.length,1);
});
