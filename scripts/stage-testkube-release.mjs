// Local release rehearsal only. No publishing or deployment capability.
import {createHash} from 'node:crypto';
import {createReadStream,readFileSync,readdirSync,lstatSync,mkdirSync,copyFileSync,cpSync,writeFileSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {collectAlpinePackages,groupAlpineSources} from './testkube-alpine-manifest.mjs';

const artifactPaths = ['testkube-api','executor-init/runner','executor-scraper/runner','init-image.tar','scraper-image.tar'];
const repo = fileURLToPath(new URL('../',import.meta.url));
const safePath = /^[-a-zA-Z0-9_.+@~/]+$/;
function validPath(p) {
  return safePath.test(p) && !p.startsWith('/') && p.split('/').every(s=>s && s!=='.' && s!=='..');
}
async function digest(path) {
  if (!lstatSync(path).isFile()) throw Error(`Not a regular file: ${path}`);
  const h=createHash('sha256');
  for await (const bytes of createReadStream(path)) h.update(bytes);
  return h.digest('hex');
}
function walk(root, prefix='') {
  const files=[];
  for(const entry of readdirSync(join(root,prefix),{withFileTypes:true})) {
    const p=prefix?`${prefix}/${entry.name}`:entry.name;
    if(!validPath(p)) throw Error(`Invalid path: ${p}`);
    if(entry.isDirectory()) files.push(...walk(root,p));
    else if(entry.isFile()) files.push(p);
    else throw Error(`Nonregular entry: ${p}`);
  }
  return files.sort();
}
export async function verifyChecksums(root, manifest, expectedPaths) {
  const expected = new Map();
  for(const line of readFileSync(manifest,'utf8').trimEnd().split('\n')) {
    const m=/^([a-f0-9]{64})  (?:\.\/)?(.+)$/.exec(line);
    if(!m || !validPath(m[2]) || expected.has(m[2])) throw Error('Invalid or duplicate checksum entry');
    expected.set(m[2],m[1]);
  }
  if(!expected.size || JSON.stringify([...expected.keys()].sort())!==JSON.stringify([...expectedPaths].sort())) throw Error('Checksum coverage mismatch');
  for(const [p,h] of expected) if(await digest(join(root,p))!==h) throw Error(`Checksum mismatch: ${p}`);
  return Object.fromEntries(expected);
}
export async function verifySourceBundle(source,evidence) {
  const files=walk(source).filter(p=>p!=='SHA256SUMS');
  const hashes=await verifyChecksums(source,join(source,'SHA256SUMS'),files);
  const packages=['init','scraper'].flatMap(image=>collectAlpinePackages(readFileSync(join(evidence,`${image}-apk-installed.txt`),'utf8'),JSON.parse(readFileSync(join(evidence,`${image}-sbom.json`),'utf8'))).map(p=>({...p,image})));
  if(readFileSync(join(source,'apk-packages.json'),'utf8')!==JSON.stringify(packages,null,2)+'\n') throw Error('Source package inventory mismatch');
  const groups=groupAlpineSources(packages);
  const manifest=groups.map(p=>[p.origin,p.version,p.commit,[...p.packages].sort().join(',')].join('\t')).join('\n')+'\n';
  if(readFileSync(join(source,'apk-source-manifest.tsv'),'utf8')!==manifest) throw Error('Source package manifest does not match tested images');
  const rows=readFileSync(join(source,'alpine-source-evidence.tsv'),'utf8').trimEnd().split('\n').map(row=>row.split('\t'));
  if(rows.length!==groups.length) throw Error('Source recipe coverage mismatch');
  for(let i=0;i<groups.length;i++) {
    const g=groups[i], [origin,version,commit,recipe,names]=rows[i];
    if(origin!==g.origin || version!==g.version || commit!==g.commit || !['main','community','testing'].some(s=>recipe===`${s}/${origin}`) || names!==[...g.packages].sort().join(',') || !hashes[`alpine/${origin}-${commit}/recipe.tar`]) throw Error('Source recipe identity mismatch');
  }
  const mpl=JSON.parse(readFileSync(join(source,'go/module-identity.json'),'utf8'));
  const api=readFileSync(join(evidence,'api-build-modules.txt'),'utf8');
  if(mpl.Path!=='github.com/hashicorp/golang-lru/v2' || mpl.Version!=='v2.0.1' || mpl.Origin?.Hash!=='6ce8a7443353151a95e1d2d74e0579bd4e5b92e5' || !api.includes(`\tdep\t${mpl.Path}\t${mpl.Version}\t${mpl.Sum}`) || !hashes['go/golang-lru-v2.0.1/LICENSE']) throw Error('MPL source identity mismatch');
  return {sourceFiles:files.length,sourceFamilies:groups.length,installedPackages:packages.length};
}
export async function stageRelease({input,evidence,source,output,commit,runId}) {
  if(!/^[a-f0-9]{40}$/.test(commit)||!/^\d+$/.test(runId)) throw Error('Invalid release identity');
  const tested=await verifyChecksums(input,join(evidence,'scanned-artifacts.sha256'),artifactPaths);
  const sourceCounts=await verifySourceBundle(source,evidence);
  for(const component of ['init','scraper']) {
    const scan=JSON.parse(readFileSync(join(evidence,`${component}-vulnerabilities.json`),'utf8'));
    if(!Array.isArray(scan.Results)||scan.Results.some(r=>(r.Vulnerabilities??[]).length>0)) throw Error(`Image scan not clear: ${component}`);
  }
  for(const file of ['_temp-testkube-api.txt','executor-init-runner.txt','executor-scraper-runner.txt']) {
    if(!readFileSync(join(evidence,file),'utf8').includes('Your code is affected by 0 vulnerabilities.')) throw Error(`Binary scan not clear: ${file}`);
  }
  mkdirSync(output); // Require a new, empty staging location.
  for(const p of artifactPaths) {
    const dest=join(output,'artifacts',p); mkdirSync(dirname(dest),{recursive:true}); copyFileSync(join(input,p),dest);
    if(await digest(dest)!==tested[p]) throw Error(`Staged artifact differs: ${p}`);
  }
  cpSync(source,join(output,'source'),{recursive:true,errorOnExist:true,force:false});
  await verifySourceBundle(join(output,'source'),evidence);
  const notices=join(output,'notices'); mkdirSync(notices);
  console.log(execFileSync(process.execPath,[join(repo,'scripts/prepare-testkube-notices.mjs'),evidence,join(notices,'GO-THIRD-PARTY-NOTICES.txt'),join(notices,'ALPINE-LICENSES.tsv'),runId,commit],{encoding:'utf8'}).trim());
  copyFileSync(join(repo,'third_party/testkube/LICENSE'),join(notices,'TESTKUBE-LICENSE'));
  for(const component of ['init','scraper']) copyFileSync(join(evidence,`${component}-LICENSE`),join(notices,`${component}-LICENSE`));
  const security=join(output,'evidence'); mkdirSync(security);
  for(const p of ['scanned-artifacts.sha256','api-build-modules.txt','init-build-modules.txt','scraper-build-modules.txt','init-sbom.json','scraper-sbom.json','init-apk-installed.txt','scraper-apk-installed.txt','init-vulnerabilities.json','scraper-vulnerabilities.json','_temp-testkube-api.txt','executor-init-runner.txt','executor-scraper-runner.txt']) copyFileSync(join(evidence,p),join(security,p));
  writeFileSync(join(output,'release-manifest.json'),JSON.stringify({candidateVersion:`testkube-v1.16.0-testlab.${commit.slice(0,12)}`,commit,runId,sourceCounts,scannedArtifacts:tested,distributionAuthorized:false,hostedProductionAuthorized:false},null,2)+'\n');
  writeFileSync(join(output,'DISTRIBUTION-README.txt'),'Qualification staging only. Do not publish or activate hosted production. Before authorized distribution, provide the matching source/ and notices/ alongside the exact artifacts/ with durable recipient access, and retain SHA256SUMS. Distribution review and hosted production approval are separate decisions; this staging package grants neither.\n');
  const files=walk(output), lines=[];
  for(const p of files) lines.push(`${await digest(join(output,p))}  ${p}`);
  const sums=join(output,'SHA256SUMS'); writeFileSync(sums,lines.join('\n')+'\n');
  await verifyChecksums(output,sums,walk(output).filter(p=>p!=='SHA256SUMS'));
  console.log(`Verified staged release: ${files.length} files; no publication authorized.`);
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [input,evidence,source,output,commit,runId]=process.argv.slice(2);
  if(![input,evidence,source,output,commit,runId].every(Boolean)) throw Error('Usage: node stage-testkube-release.mjs INPUT EVIDENCE SOURCE OUTPUT COMMIT RUN_ID');
  await stageRelease({input:resolve(input),evidence:resolve(evidence),source:resolve(source),output:resolve(output),commit,runId});
}
