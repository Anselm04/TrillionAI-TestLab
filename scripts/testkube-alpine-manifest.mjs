import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const namePattern = /^[a-zA-Z0-9][a-zA-Z0-9+._-]*$/;
const versionPattern = /^[a-zA-Z0-9][a-zA-Z0-9+._~-]*$/;

export function collectAlpinePackages(database, sbom) {
  const installed = new Map();
  for (const record of database.trim().split(/\n\s*\n/)) {
    const fields = Object.fromEntries(record.split('\n').filter(line => /^[PVolcL]:/.test(line)).map(line => [line[0], line.slice(2)]));
    const { P: name, V: version, o: origin, c: commit, L: license } = fields;
    if (!namePattern.test(name ?? '') || !versionPattern.test(version ?? '') || !namePattern.test(origin ?? '') || !/^[a-f0-9]{40}$/.test(commit ?? '') || !license) throw Error(`Incomplete APK source identity: ${name ?? 'unknown'}`);
    if (installed.has(name)) throw Error(`Duplicate APK package: ${name}`);
    installed.set(name, { name, version, origin, commit, license });
  }
  const seen = new Set();
  for (const component of sbom.components ?? []) {
    if (!component.purl?.startsWith('pkg:apk/')) continue;
    const actual = installed.get(component.name);
    if (!actual || actual.version !== component.version || seen.has(component.name)) throw Error(`APK SBOM identity mismatch: ${component.name}`);
    seen.add(component.name);
  }
  if (!seen.size || seen.size !== installed.size) throw Error('APK SBOM does not cover installed package database');
  return [...installed.values()].sort((a,b) => a.name.localeCompare(b.name,'en'));
}

export function groupAlpineSources(packages) {
  const groups = new Map();
  for (const p of packages) {
    const key = `${p.origin}@${p.commit}`;
    const prior = groups.get(key);
    if (prior && prior.version !== p.version) throw Error(`Inconsistent source package version: ${key}`);
    if (prior) prior.packages.add(p.name);
    else groups.set(key, { origin: p.origin, version: p.version, commit: p.commit, packages: new Set([p.name]) });
  }
  return [...groups.values()].sort((a,b) => a.origin.localeCompare(b.origin,'en') || a.commit.localeCompare(b.commit,'en'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [evidence, output] = process.argv.slice(2);
  if (!evidence || !output) throw Error('Usage: node testkube-alpine-manifest.mjs EVIDENCE OUTPUT');
  const packages = ['init','scraper'].flatMap(image => collectAlpinePackages(readFileSync(join(evidence, `${image}-apk-installed.txt`), 'utf8'), JSON.parse(readFileSync(join(evidence, `${image}-sbom.json`), 'utf8'))).map(p => ({ ...p, image })));
  const groups = groupAlpineSources(packages);
  writeFileSync(join(output,'apk-packages.json'), JSON.stringify(packages,null,2)+'\n');
  writeFileSync(join(output,'apk-source-manifest.tsv'), groups.map(p => [p.origin,p.version,p.commit,[...p.packages].sort().join(',')].join('\t')).join('\n')+'\n');
  console.log(`Verified ${packages.length} installed APK records against SBOMs and mapped ${groups.length} unique source identities.`);
}
