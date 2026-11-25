import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyApkIdentity} from '../src/apk-verification.js';
const digest='a'.repeat(64);
const ok=output=>({exitCode:0,output});
const policy={apkPath:'/tmp/test.apk',packageName:'com.test.app',signerSha256:[digest]};
const run=(signature,identity)=>async binary=>binary==='apksigner'?signature:identity;
const signed=ok('Signer #1 certificate SHA-256 digest: '+digest+'\n');
const manifest=ok("package: name='com.test.app' versionCode='1'\n");
test('approved package and exact signer set required',async()=>{
 assert.equal((await verifyApkIdentity({...policy,runner:run(signed,manifest)})).status,'VERIFIED');
 for(const signature of [{exitCode:1,output:signed.output},ok(''),ok(signed.output+'Signer #2 certificate SHA-256 digest: '+'b'.repeat(64)),ok(signed.output+signed.output),{...signed,outputTruncated:true}]){
  await assert.rejects(verifyApkIdentity({...policy,runner:run(signature,manifest)}));
 }
 await assert.rejects(verifyApkIdentity({...policy,runner:run(signed,ok("package: name='com.other.app' versionCode='1'"))}));
 await assert.rejects(verifyApkIdentity({...policy,signerSha256:[],runner:run(signed,manifest)}));
});
