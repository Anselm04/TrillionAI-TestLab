import test from 'node:test';
import assert from 'node:assert/strict';
import {collectAlpinePackages,groupAlpineSources} from '../../scripts/testkube-alpine-manifest.mjs';

const commit = 'a'.repeat(40);
const record = (name, version='1.0-r0') => `P:${name}\nV:${version}\no:busybox\nc:${commit}\nL:GPL-2.0-only`;
const components = names => ({components:names.map(name=>({name,version:'1.0-r0',purl:`pkg:apk/alpine/${name}@1.0-r0`}))});

test('Alpine source inventory binds installed packages to SBOM and deduplicates subpackages',()=>{
 const result=collectAlpinePackages(record('busybox')+'\n\n'+record('busybox-binsh'),components(['busybox','busybox-binsh']));
 assert.equal(result.length,2);
 const groups=groupAlpineSources([...result,...result]);
 assert.equal(groups.length,1);
 assert.equal(groups[0].commit,commit);
 assert.deepEqual([...groups[0].packages],['busybox','busybox-binsh']);
});
test('Alpine source inventory rejects incomplete or mismatched evidence',()=>{
 assert.throws(()=>collectAlpinePackages(record('busybox').replace(`c:${commit}\n`,''),components(['busybox'])),/Incomplete/);
 assert.throws(()=>collectAlpinePackages(record('busybox','1.1-r0'),components(['busybox'])),/mismatch/);
 assert.throws(()=>collectAlpinePackages(record('busybox')+'\n\n'+record('busybox-binsh'),components(['busybox'])),/does not cover/);
 assert.throws(()=>collectAlpinePackages(record('busybox').replace('o:busybox','o:../outside'),components(['busybox'])),/Incomplete/);
});
