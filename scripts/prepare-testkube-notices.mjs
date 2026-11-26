// Assemble the exact notice inventory from an independently verified CI artifact.
// This does not authorize or perform binary redistribution.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [evidenceArg, noticesArg, imageArg, runId='45802648709', commit='76723217f8ed7819367e15881a2cc97c0a1cf0ea'] = process.argv.slice(2);
if (!evidenceArg || !noticesArg || !imageArg) throw Error('Usage: node prepare-testkube-notices.mjs SECURITY_EVIDENCE NOTICE_OUTPUT IMAGE_OUTPUT');
if (!/^\d+$/.test(runId) || !/^[a-f0-9]{40}$/.test(commit)) throw Error('Invalid qualification identity');
const evidence = resolve(evidenceArg);
const docs = fileURLToPath(new URL('../docs/', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => readFileSync(join(evidence, path));
const texts = new Map(), entries = new Map();
const add = bytes => {
  if (!bytes.length) throw Error('Empty notice');
  const key = hash(bytes);
  texts.set(key, bytes);
  return key;
};
for (const line of read('module-notice-index.tsv').toString('utf8').trimEnd().split('\n')) {
  const [key, module, version = ''] = line.split('\t');
  if (!module || !/^[a-f0-9]{64}$/.test(key) || hash(`${module}@${version}`) !== key) throw Error('Invalid notice index');
  const id = `${module}@${version}`;
  if (entries.has(id)) throw Error(`Duplicate module ${id}`);
  const directory = join(evidence, 'module-notices', key);
  const files = existsSync(directory) ? readdirSync(directory, { withFileTypes: true }).filter(d => d.isFile()).map(d => d.name).sort() : [];
  const notices = files.map(name => `${name}: ${add(readFileSync(join(directory, name)))}`);
  if (!notices.length && id === 'github.com/package-url/packageurl-go@v0.1.0') {
    const source = readFileSync(join(docs, 'TESTKUBE_PURL_NOTICE.md'), 'utf8');
    const offset = source.indexOf('Copyright (c) the purl authors');
    if (offset < 0) throw Error('PURL notice missing');
    notices.push(`mit.LICENSE: ${add(Buffer.from(source.slice(offset)))}`);
  }
  if (!notices.length) throw Error(`Unresolved notice: ${id}`);
  entries.set(id, notices);
}
const used = new Map();
for (const binary of ['api', 'init', 'scraper']) {
  const build = read(`${binary}-build-modules.txt`).toString('utf8');
  if (!build.split('\n')[0].endsWith(': go1.27.4')) throw Error('Unexpected Go toolchain');
  for (const line of build.split('\n')) {
    const fields = line.split('\t');
    if (fields[1] !== 'dep') continue;
    const id = `${fields[2]}@${fields[3]}`;
    if (!entries.has(id)) throw Error(`Linked module lacks notice: ${binary}: ${id}`);
    if (!used.has(id)) used.set(id, []);
    used.get(id).push(binary);
  }
}
const goNotice = add(readFileSync(join(docs, 'TESTKUBE_GO_NOTICE.txt')));
const output = ['TestLab — Testkube Go binary third-party notices', `Qualification run ${runId}; source commit ${commit}.`, 'Exact module notice texts are identified by SHA-256 below. No binary redistribution approval is implied.', '', `Go toolchain go1.27.4: ${goNotice}`, ''];
for (const [id, notices] of [...entries].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
  output.push(`${id} [${used.get(id)?.join(', ') ?? 'module graph / main source'}]`, ...notices.map(n => `  ${n}`), '');
}
output.push('MPL-2.0 corresponding source reference: https://github.com/hashicorp/golang-lru/tree/6ce8a7443353151a95e1d2d74e0579bd4e5b92e5', '');
for (const [digest, bytes] of [...texts].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
  const decoded = bytes.toString('utf8');
  if (!Buffer.from(decoded).equals(bytes)) throw Error(`Notice is not UTF-8: ${digest}`);
  output.push(`----- SHA-256 ${digest} -----`, decoded, '');
}
const imageLines = ['image\tpackage\tversion\tSBOM license identifiers (not legal clearance)'];
for (const image of ['init', 'scraper']) {
  const components = JSON.parse(read(`${image}-sbom.json`)).components;
  const packages = components.filter(c => c.purl?.startsWith('pkg:apk/')).sort((a,b)=>a.name.localeCompare(b.name,'en'));
  if (!packages.length) throw Error(`No OS packages in ${image} SBOM`);
  for (const c of packages) {
    const licenses = (c.licenses ?? []).map(l => l.license?.id ?? l.license?.name ?? l.expression).filter(Boolean);
    if (!licenses.length) throw Error(`No OS license identified for ${c.name}`);
    imageLines.push([image,c.name,c.version,licenses.join(',')].join('\t'));
  }
}
writeFileSync(resolve(noticesArg), output.join('\n') + '\n');
writeFileSync(resolve(imageArg), imageLines.join('\n') + '\n');
console.log(`Verified ${entries.size} module inventory entries, ${used.size} linked dependency versions, ${texts.size} distinct Go notice texts and ${imageLines.length-1} OS package records.`);
