import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import ts from 'typescript';

const root=fileURLToPath(new URL('../',import.meta.url));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bb-voice-skills-cache-'));
const source=fs.readFileSync(path.join(root,'src/lib/hermes/skills.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/from (["'])(\.[^"']+)\1/g,(_,quote,relative)=>`from ${JSON.stringify(pathToFileURL(path.resolve(root,'src/lib/hermes',relative)).href)}`);
const bundles=[0,1].map(i=>{const file=path.join(tmp,`route-${i}.mjs`);fs.writeFileSync(file,compiled);return file;});
const [warmup,messages]=await Promise.all(bundles.map(file=>import(pathToFileURL(file).href)));

test('independent routes reuse shipped skill hashes without changing discovery or mutable-root checks',t=>{
  const originalRoot=process.env.BREADBOARD_REPO_ROOT;
  const originalOverride=process.env.HERMES_FIRST_PARTY_SKILLS_ROOT;
  const originalRead=fs.readFileSync;
  t.after(()=>{fs.readFileSync=originalRead;for(const [key,value] of [['BREADBOARD_REPO_ROOT',originalRoot],['HERMES_FIRST_PARTY_SKILLS_ROOT',originalOverride]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}fs.rmSync(tmp,{recursive:true,force:true});});
  process.env.BREADBOARD_REPO_ROOT=tmp;
  delete process.env.HERMES_FIRST_PARTY_SKILLS_ROOT;
  const skillsRoot=path.join(tmp,'hermes-skills','prebuilt');
  const directory=path.join(skillsRoot,'study-guide');
  fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,'SKILL.md'),'---\nname: study-guide\ndescription: Teaching and study planning\n---\nExplain the study material.\n');
  const asset=path.join(directory,'reference.bin');fs.writeFileSync(asset,Buffer.alloc(1024,7));
  let assetReads=0;
  fs.readFileSync=function(file,...args){if(path.resolve(String(file))===asset)assetReads++;return originalRead.call(this,file,...args);};
  const first=warmup.listFirstPartySkills();assert.equal(first.length,1);assert.equal(assetReads,1);
  const second=messages.listFirstPartySkills();assert.deepEqual(second,first);
  assert.equal(assetReads,1,'a second API bundle must reuse the asset hash warmed by startup');
  process.env.HERMES_FIRST_PARTY_SKILLS_ROOT=skillsRoot;
  const reviewed=messages.listFirstPartySkills()[0];
  fs.writeFileSync(asset,Buffer.alloc(1024,9));
  const modified=warmup.listFirstPartySkills()[0];
  assert.notEqual(modified.contentHash,reviewed.contentHash,'overridden review roots must still detect changed bytes');
  assert.equal(assetReads,3);
});
