import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {applyPortablePackageBuildScripts} from '../src/lib/classroom/setup.ts';

test('Windows package builds clean only their own dist and retain the remaining build steps',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'classroom-scripts-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const directory=path.join(root,'packages/@openmaic/renderer');
 fs.mkdirSync(path.join(directory,'dist'),{recursive:true});
 fs.writeFileSync(path.join(directory,'dist/old.js'),'old');
 fs.writeFileSync(path.join(directory,'retained.txt'),'keep');
 const manifest={name:'@openmaic/renderer',scripts:{clean:'rm -rf dist',build:'node pre.mjs && rm -rf dist && node after.mjs'},dependencies:{example:'1.0.0'}};
 const file=path.join(directory,'package.json');fs.writeFileSync(file,JSON.stringify(manifest));
 assert.equal(applyPortablePackageBuildScripts(root,'linux'),0);
 assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),manifest);
 assert.equal(applyPortablePackageBuildScripts(root,'win32'),1);
 assert.equal(applyPortablePackageBuildScripts(root,'win32'),0,'idempotent');
 const patched=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.equal(patched.scripts.build,'node pre.mjs && node .breadboard-clean-dist.cjs && node after.mjs');
 assert.deepEqual(patched.dependencies,manifest.dependencies);
 const child=spawnSync(process.execPath,[path.join(directory,'.breadboard-clean-dist.cjs')],{cwd:root,windowsHide:true,encoding:'utf8',timeout:10000});
 assert.equal(child.status,0,child.stderr);
 assert.equal(fs.existsSync(path.join(directory,'dist')),false);
 assert.equal(fs.readFileSync(path.join(directory,'retained.txt'),'utf8'),'keep');
});
