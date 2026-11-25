// Trusted Android SDK tools must be installed on the isolated worker host.
const packagePattern=/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const digestPattern=/^[a-f0-9]{64}$/;
function successful(r){return r?.exitCode===0&&!r.error&&!r.timedOut&&!r.outputTruncated&&typeof r.output==='string'&&r.output.length<64000;}
export function parsePackageIdentity(output){
 const matches=[...output.matchAll(/^package: name='([^']+)'(?:\s|$)/gm)];
 if(matches.length!==1||!packagePattern.test(matches[0][1]))throw new Error('Ambiguous APK package identity');
 return matches[0][1];
}
export function parseSignerDigests(output){
 const lines=output.split(/\r?\n/).filter(x=>/^Signer #\d+ certificate SHA-256 digest:/.test(x));
 const signers=new Map();
 for(const line of lines){
  const m=/^Signer #(\d+) certificate SHA-256 digest: ([a-fA-F0-9]{64})$/.exec(line.trim());
  if(!m||signers.has(m[1]))throw new Error('Ambiguous signer record');
  signers.set(m[1],m[2].toLowerCase());
 }
 if(!signers.size)throw new Error('Missing signer certificate');
 return [...signers.values()].sort();
}
export async function verifyApkIdentity({apkPath,packageName,signerSha256,runner}){
 if(typeof apkPath!=='string'||!apkPath.startsWith('/')||typeof packageName!=='string'||!packagePattern.test(packageName)||!Array.isArray(signerSha256)||!signerSha256.length||signerSha256.some(x=>typeof x!=='string'||!digestPattern.test(x))||new Set(signerSha256).size!==signerSha256.length||typeof runner!=='function')throw new Error('Invalid APK verification policy');
 const options={timeoutMs:30000,outputLimit:64000};
 const signature=await runner('apksigner',['verify','--print-certs','--verbose',apkPath],options);
 if(!successful(signature))throw new Error('APK signature verification failed');
 const actual=parseSignerDigests(signature.output);
 const expected=[...signerSha256].sort();
 if(actual.length!==expected.length||actual.some((x,i)=>x!==expected[i]))throw new Error('APK signer mismatch');
 const identity=await runner('aapt2',['dump','badging',apkPath],options);
 if(!successful(identity)||parsePackageIdentity(identity.output)!==packageName)throw new Error('APK package mismatch');
 return {status:'VERIFIED',packageName,signerSha256:actual};
}
