import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {applyNonWatchingRollupBuildScripts} from '../src/lib/classroom/setup.ts';

function fixture(t, cli = '') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'classroom-rollup-'));
  assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
  assert.match(path.basename(root),/^classroom-rollup-/);
  t.after(() => fs.rmSync(root, {recursive:true,force:true}));
  const directory = path.join(root, 'packages/@openmaic/renderer');
  const rollup = path.join(directory, 'node_modules/rollup');
  fs.mkdirSync(path.join(rollup, 'dist/bin'), {recursive:true});
  fs.writeFileSync(path.join(rollup, 'package.json'), JSON.stringify({name:'rollup',version:'0.0.0'}));
  fs.writeFileSync(path.join(rollup, 'dist/bin/rollup'), cli);
  const manifest = {name:'@openmaic/renderer',scripts:{build:'node before.mjs && rollup -c && tsc --emitDeclarationOnly',dev:'rollup -c -w'},dependencies:{kept:'1.0.0'}};
  const file = path.join(directory, 'package.json');
  fs.writeFileSync(file, JSON.stringify(manifest));
  return {root,directory,rollup,file,manifest,helper:path.join(directory,'.breadboard-rollup-build.cjs')};
}
const leakedWatchers = "const fs=require('node:fs');fs.writeFileSync('compiled.txt','actual output');fs.watch('compiled.txt',()=>{});fs.watchFile('compiled.txt',()=>{});";

test('a completed one-shot build exits naturally despite leaked file watchers', t => {
  const f = fixture(t, leakedWatchers);
  const options = {cwd:f.directory,windowsHide:true,encoding:'utf8',timeout:2000};
  const baseline = spawnSync(process.execPath,[path.join(f.rollup,'dist/bin/rollup'),'-c'],options);
  assert.equal(baseline.error?.code,'ETIMEDOUT','Unfixed completion must retain the leaked handles');
  assert.equal(fs.readFileSync(path.join(f.directory,'compiled.txt'),'utf8'),'actual output');
  assert.equal(applyNonWatchingRollupBuildScripts(f.root,'win32'),1);
  const result = spawnSync(process.execPath,[f.helper,'-c'],options);
  assert.equal(result.error,undefined);
  assert.equal(result.status,0,result.stderr);
  assert.equal(fs.readFileSync(path.join(f.directory,'compiled.txt'),'utf8'),'actual output');
});

test('a failed build retains its nonzero exit and diagnostic even with leaked watchers', t => {
  const f = fixture(t,leakedWatchers+"process.stderr.write('controlled compilation failure');process.exitCode=23;");
  applyNonWatchingRollupBuildScripts(f.root,'win32');
  const result = spawnSync(process.execPath,[f.helper,'-c'],{cwd:f.directory,windowsHide:true,encoding:'utf8',timeout:2000});
  assert.equal(result.error,undefined);
  assert.equal(result.status,23);
  assert.match(result.stderr,/controlled compilation failure/);
});

test('only the Windows one-shot script changes; repeat application and dev commands remain intact', t => {
  const f = fixture(t);
  assert.equal(applyNonWatchingRollupBuildScripts(f.root,'linux'),0);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file,'utf8')),f.manifest);
  assert.equal(applyNonWatchingRollupBuildScripts(f.root,'win32'),1);
  assert.equal(applyNonWatchingRollupBuildScripts(f.root,'win32'),0);
  const patched = JSON.parse(fs.readFileSync(f.file,'utf8'));
  assert.equal(patched.scripts.build,'node before.mjs && node .breadboard-rollup-build.cjs -c && tsc --emitDeclarationOnly');
  assert.equal(patched.scripts.dev,f.manifest.scripts.dev);
  assert.deepEqual(patched.dependencies,f.manifest.dependencies);
  const rejected = spawnSync(process.execPath,[f.helper,'-c','--watch'],{cwd:f.directory,windowsHide:true,encoding:'utf8',timeout:2000});
  assert.notEqual(rejected.status,0);
  assert.match(rejected.stderr,/Expected a one-shot Rollup build/);
});

test('the copied editor gets the same bounded build entry without changing other packages', t => {
  const f = fixture(t);
  for (const name of ['editor','importer']) {
    const directory=path.join(f.root,'packages/@openmaic',name);
    fs.mkdirSync(directory,{recursive:true});
    fs.writeFileSync(path.join(directory,'package.json'),JSON.stringify({scripts:{build:'rollup -c',dev:'rollup -c -w'}}));
  }
  assert.equal(applyNonWatchingRollupBuildScripts(f.root,'win32'),2);
  const editor=JSON.parse(fs.readFileSync(path.join(f.root,'packages/@openmaic/editor/package.json'),'utf8'));
  const importer=JSON.parse(fs.readFileSync(path.join(f.root,'packages/@openmaic/importer/package.json'),'utf8'));
  assert.equal(editor.scripts.build,'node .breadboard-rollup-build.cjs -c');
  assert.equal(importer.scripts.build,'rollup -c');
});
