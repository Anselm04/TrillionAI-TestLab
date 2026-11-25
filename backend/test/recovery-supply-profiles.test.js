import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableExecution} from '../src/durable-execution.js';
import {createRecoverySupplyProfile} from '../src/recovery-supply-profiles.js';
const revisionSha256='a'.repeat(64),environmentId='local',artifactSha256='b'.repeat(64);
const base={profileId:'fixture',testId:'check',environmentId,revisionSha256,fixtureSha256:'c'.repeat(64),checkCapacity:async()=>true,verifyReport:async()=>true};
async function run(kind,config,extra={}){
 const dir=mkdtempSync(join(tmpdir(),'testlab-recovery-supply-'));
 const profile=createRecoverySupplyProfile({...base,kind,config,...extra});
 const journal=new DurableExecution(join(dir,'runs.sqlite'),{profiles:[profile]});
 try{const q=journal.submit({profileId:'fixture',revisionSha256});await journal.runNext({checkCapacity:async()=>true});return journal.get(q.runId);}
 finally{journal.close();rmSync(dir,{recursive:true,force:true});}
}
function recovery({healthy=true,clean=true}={}){
 const scenario={id:'restart',fault:'restart',maxRecoveryMs:600000,maxLostRecords:0};
 return {scenario,adapter:{environmentId,revisionSha256,scenarioId:scenario.id,fault:scenario.fault,baseline:async()=>({stateSha256:artifactSha256,recordCount:5}),exercise:async c=>({evidenceId:c.runId,stateSha256:artifactSha256,recordCount:5,healthy,lostRecords:0}),cleanup:async()=>clean},verifyObservation:async()=>true};
}
test('recovery assessment persists observed pass and failure',async()=>{
 const p=await run('recovery',recovery());assert.equal(p.state,'VERIFIED');assert.equal(p.result.observation.status,'PASSED');
 assert.equal((await run('recovery',recovery({healthy:false}))).result.observation.status,'FAILED');
});
test('failed recovery cleanup and report verification block qualification',async()=>{
 assert.equal((await run('recovery',recovery({clean:false}))).state,'BLOCKED');
 assert.equal((await run('recovery',recovery(),{verifyReport:async()=>false})).state,'BLOCKED');
});
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const requiredTools={sbom:'syft','vulnerability-scan':'grype','build-provenance':'builder'};
function supply({criticalCount=0,tamper=false}={}){
 const policy={maxAgeMs:60000,requiredTools,keys:{signer:{publicKey:publicKey.export({type:'spki',format:'pem'}),kinds:Object.keys(requiredTools)}}};
 return {artifactSha256,policy,collect:async c=>{
 const now=Date.now();
 const evidence=Object.keys(requiredTools).map(kind=>{
 const payload=Buffer.from(JSON.stringify({schemaVersion:1,kind,tool:requiredTools[kind],toolVersion:'1',artifactSha256,revisionSha256,evidenceId:kind,createdAtMs:now,packageCount:1,reportSha256:artifactSha256,databaseSha256:artifactSha256,databaseUpdatedAtMs:now,criticalCount,highCount:0,complete:true,buildDefinitionSha256:artifactSha256,builderId:'builder'}));
 return {kind,keyId:'signer',payload,signature:tamper?Buffer.alloc(64):sign(null,payload,privateKey)};
 });
 return {...c,artifactSha256,evidence};
 }};
}
test('actual Ed25519 verification persists signed findings and rejects tampering',async()=>{
 const p=await run('supply-chain',supply());assert.equal(p.state,'VERIFIED');assert.equal(p.result.observation.status,'PASSED');
 assert.equal((await run('supply-chain',supply({criticalCount:1}))).result.observation.status,'FAILED');
 assert.equal((await run('supply-chain',supply({tamper:true}))).state,'BLOCKED');
});
test('trust policy is bound to profile definition',()=>{
 const config=supply();const p=createRecoverySupplyProfile({...base,kind:'supply-chain',config});
 config.policy.maxAgeMs=1000;
 assert.notEqual(createRecoverySupplyProfile({...base,kind:'supply-chain',config}).definitionSha256,p.definitionSha256);
});
