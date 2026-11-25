import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {verifySupplyChain} from '../src/supply-chain-verification.js';
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const artifactSha256='a'.repeat(64),revisionSha256='b'.repeat(64),nowMs=100000;
const requiredTools={'sbom':'syft','vulnerability-scan':'grype','build-provenance':'builder'};
const policy={maxAgeMs:1000,requiredTools,keys:{worker:{publicKey:publicKey.export({type:'spki',format:'pem'}),kinds:Object.keys(requiredTools)}}};
function envelope(kind,extra={}){
 const payload=Buffer.from(JSON.stringify({schemaVersion:1,kind,tool:requiredTools[kind],toolVersion:'1.0',artifactSha256,revisionSha256,evidenceId:kind,createdAtMs:nowMs,packageCount:5,reportSha256:'c'.repeat(64),databaseSha256:'d'.repeat(64),databaseUpdatedAtMs:nowMs,criticalCount:0,highCount:0,complete:true,buildDefinitionSha256:'e'.repeat(64),builderId:'ci',...extra}));
 return {kind,keyId:'worker',payload,signature:sign(null,payload,privateKey)};
}
const make=()=>Object.keys(requiredTools).map(k=>envelope(k));
const run=evidence=>verifySupplyChain({artifactSha256,revisionSha256,nowMs,policy,evidence});
test('all pinned signed evidence verifies without authorizing deployment',()=>{
 const r=run(make());assert.equal(r.status,'DECLARED_SIGNED_EVIDENCE_VERIFIED');assert.equal(r.deploymentAuthorized,false);
});
test('tampering, stale scan database and mismatched artifact fail closed',()=>{
 for(const bad of [envelope('sbom',{artifactSha256:'f'.repeat(64)}),{...envelope('sbom'),signature:Buffer.alloc(64)}]){
 const e=make();e[0]=bad;assert.equal(run(e).status,'INCOMPLETE');
 }
 const e=make();e[1]=envelope('vulnerability-scan',{databaseUpdatedAtMs:0});assert.equal(run(e).status,'INCOMPLETE');
});
test('missing duplicate and unauthorized evidence do not pass',()=>{
 const e=make();assert.equal(run(e.slice(1)).status,'INCOMPLETE');assert.equal(run([...e,e[0]]).status,'INCOMPLETE');
 e[0].keyId='unknown';assert.equal(run(e).status,'INCOMPLETE');
});
test('signed vulnerability counts are reported as findings',()=>{
 const e=make();e[1]=envelope('vulnerability-scan',{criticalCount:1});const r=run(e);assert.equal(r.status,'VERIFIED_FINDINGS');assert.equal(r.results[1].criticalCount,1);
});
