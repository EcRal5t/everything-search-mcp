import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
const pkg=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8'));
assert.equal(pkg.private,true);
assert.equal(Object.hasOwn(pkg,'version'),false);
const lock=JSON.parse(await fs.readFile(new URL('../package-lock.json',import.meta.url),'utf8'));
assert.equal(Object.hasOwn(lock.packages[''],'version'),false);
const manifest=JSON.parse(await fs.readFile(new URL('../vendor/es/manifest.json',import.meta.url),'utf8'));
for(const file of manifest.files){
 const data=await fs.readFile(new URL('../vendor/es/'+file.path,import.meta.url));
 assert.equal(createHash('sha256').update(data).digest('hex'),file.sha256,file.path);
}
for(const file of ['src/cli.js','src/server.js','package-lock.json','scripts/discover.ps1','MIGRATION.md'])await fs.access(new URL('../'+file,import.meta.url));
console.log(JSON.stringify({ok:true,stage:'unreleased',helper_version:manifest.version,architectures:manifest.files.length}));
