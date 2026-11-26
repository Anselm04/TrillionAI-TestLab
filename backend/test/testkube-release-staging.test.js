import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {stageRelease} from '../../scripts/stage-testkube-release.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
const commit='a'.repeat(40), module='github.com/hashicorp/golang-lru/v2', version='v2.0.1';
const artifacts=['testkube-api','executor-init/runner','executor-scraper/runner','init-image.tar','scraper-image.tar'];
function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'release-staging-test-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const opts={input:join(root,'input'),evidence:join(root,'evidence'),source:join(root,'source'),output:join(root,'output'),commit,runId:'123'};
  const put=(dir,p,data)=>{const path=join(dir,p);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,data);};
  const sums=(dir,paths)=>paths.map(p=>`${hash(readFileSync(join(dir,p)))}  ${p}`).join('\n')+'\n';
  for(const p of artifacts) put(opts.input,p,`fixture ${p}`);
  put(opts.evidence,'scanned-artifacts.sha256',sums(opts.input,artifacts));
  const apk={name:'busybox',version:'1.0-r0',origin:'busybox',commit,license:'GPL-2.0-only'};
  for(const image of ['init','scraper']) {
    put(opts.evidence,`${image}-apk-installed.txt`,`P:busybox\nV:1.0-r0\no:busybox\nc:${commit}\nL:GPL-2.0-only\n`);
    put(opts.evidence,`${image}-sbom.json`,JSON.stringify({components:[{name:'busybox',version:apk.version,purl:'pkg:apk/alpine/busybox@1.0-r0',licenses:[{license:{id:apk.license}}]}]}));
    put(opts.evidence,`${image}-vulnerabilities.json`,JSON.stringify({Results:[{Vulnerabilities:[]}]}));
    put(opts.evidence,`${image}-LICENSE`,'MIT License fixture');
  }
  for(const binary of ['api','init','scraper']) put(opts.evidence,`${binary}-build-modules.txt`,`fixture: go1.27.4\n\tdep\t${module}\t${version}\th1:fixture\n`);
  for(const p of ['_temp-testkube-api.txt','executor-init-runner.txt','executor-scraper-runner.txt']) put(opts.evidence,p,'Your code is affected by 0 vulnerabilities.');
  const key=hash(`${module}@${version}`);
  put(opts.evidence,'module-notice-index.tsv',`${key}\t${module}\t${version}\n`);
  put(opts.evidence,`module-notices/${key}/LICENSE`,'MPL fixture');
  const sourceFiles={
    'apk-packages.json':JSON.stringify(['init','scraper'].map(image=>({...apk,image})),null,2)+'\n',
    'apk-source-manifest.tsv':`busybox\t1.0-r0\t${commit}\tbusybox\n`,
    'alpine-source-evidence.tsv':`busybox\t1.0-r0\t${commit}\tmain/busybox\tbusybox\n`,
    [`alpine/busybox-${commit}/recipe.tar`]:'fixture recipe',
    'go/module-identity.json':JSON.stringify({Path:module,Version:version,Sum:'h1:fixture',Origin:{Hash:'6ce8a7443353151a95e1d2d74e0579bd4e5b92e5'}}),
    'go/golang-lru-v2.0.1/LICENSE':'fixture source license'
  };
  for(const [p,data] of Object.entries(sourceFiles)) put(opts.source,p,data);
  put(opts.source,'SHA256SUMS',sums(opts.source,Object.keys(sourceFiles)));
  return {opts,put,key};
}
test('stages exact artifacts and sources with a release-bound notice and no publication approval',async t=>{
  const {opts}=fixture(t); await stageRelease(opts);
  const result=JSON.parse(readFileSync(join(opts.output,'release-manifest.json')));
  assert.equal(result.distributionAuthorized,false);
  assert.equal(result.commit,commit);
  assert.equal(result.sourceCounts.installedPackages,2);
  for(const p of artifacts) assert.equal(hash(readFileSync(join(opts.output,'artifacts',p))),result.scannedArtifacts[p]);
  assert.match(readFileSync(join(opts.output,'notices/GO-THIRD-PARTY-NOTICES.txt'),'utf8'),/Qualification run 123/);
  for(const row of readFileSync(join(opts.output,'SHA256SUMS'),'utf8').trimEnd().split('\n')) {
    const [digest,path]=row.split('  '); assert.equal(hash(readFileSync(join(opts.output,path))),digest);
  }
});
for(const [name,mutate,error] of [
  ['changed binary',({opts,put})=>put(opts.input,artifacts[0],'tampered'),/Checksum mismatch/],
  ['unlisted source',({opts,put})=>put(opts.source,'unexpected','extra'),/coverage mismatch/],
  ['missing source',({opts})=>rmSync(join(opts.source,'go/module-identity.json')),/coverage mismatch/],
  ['failed image scan',({opts,put})=>put(opts.evidence,'init-vulnerabilities.json','{"Results":[{"Vulnerabilities":[{}]}]}'),/Image scan not clear/],
  ['missing notice',({opts,key})=>rmSync(join(opts.evidence,'module-notices',key,'LICENSE')), /Unresolved notice/]
]) test(`rejects ${name}`,async t=>{const f=fixture(t); mutate(f); await assert.rejects(stageRelease(f.opts),error);});
