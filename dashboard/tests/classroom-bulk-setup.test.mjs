import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {classroomRuntimeRoot,classroomInstallationRoot,classroomToolsDir,classroomDataDir,classroomStagingRoot,classroomProcessEnvironment} from '../src/lib/classroom/runtime.ts';
import {prepareClassroomPackageManager,writePnpmShims,ensureClassroomDataLink,runClassroomStep} from '../src/lib/classroom/setup.ts';
import {markManagedPayloadReady} from '../scripts/runtime-v2-bulk-paths.mjs';

function fixture(t){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'breadboard-classroom-bulk-'));
  const data=path.join(base,'state'),bulk=path.join(base,'large');
  fs.mkdirSync(data);fs.mkdirSync(bulk);
  const previous={data:process.env.BREADBOARD_DATA_DIR,bulk:process.env.BREADBOARD_BULK_DATA_DIR};
  process.env.BREADBOARD_DATA_DIR=data;process.env.BREADBOARD_BULK_DATA_DIR=bulk;
  t.after(()=>{for(const [key,value] of [['BREADBOARD_DATA_DIR',previous.data],['BREADBOARD_BULK_DATA_DIR',previous.bulk]])if(value===undefined)delete process.env[key];else process.env[key]=value;fs.rmSync(base,{recursive:true,force:true});});
  return {base,data,bulk};
}
function write(file,value='fixture'){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);}

test('Windows package-manager launch accepts native namespaced paths without changing the source environment',async t=>{
  if(process.platform!=='win32'){t.skip('Windows native path regression');return;}
  const {base}=fixture(t),entry=path.join(base,'package manager.cjs');
  write(entry,"require('node:fs').writeFileSync('launch-result.json',JSON.stringify({cwd:process.cwd(),argument:process.argv[2],cache:process.env.npm_config_cache,corepack:process.env.COREPACK_HOME,path:process.env.Path}));");
  const env={...process.env,Path:'\\\\?\\C:\\Node;\\\\?\\D:\\Tools',npm_config_cache:'\\\\?\\D:\\Cache\\npm',COREPACK_HOME:'\\\\?\\D:\\Cache\\corepack'};
  const original={...env};
  await runClassroomStep('Fixture package manager',path.toNamespacedPath(process.execPath),[path.toNamespacedPath(entry),'\\\\?\\D:\\Toolchains\\openmaic'],{cwd:path.toNamespacedPath(base),env,timeoutMs:10000});
  const result=JSON.parse(fs.readFileSync(path.join(base,'launch-result.json'),'utf8'));
  assert.equal(result.cwd,base);assert.equal(result.argument,'D:\\Toolchains\\openmaic');
  assert.equal(result.cache,'D:\\Cache\\npm');assert.equal(result.corepack,'D:\\Cache\\corepack');
  assert.equal(result.path,'C:\\Node;D:\\Tools');assert.deepEqual(env,original);
  const tools=path.join(base,'shims');
  writePnpmShims(tools,'\\\\?\\D:\\Tools\\pnpm.cjs','\\\\?\\C:\\Node\\node.exe',false);
  assert.match(fs.readFileSync(path.join(tools,'pnpm.cmd'),'utf8'),/"C:\\Node\\node.exe" "D:\\Tools\\pnpm.cjs" %\*/);
});

test('Classroom process path presentation preserves provider values and non-Windows paths',()=>{
  const source={Path:'\\\\?\\C:\\Node;\\\\?\\UNC\\server\\tools',COREPACK_HOME:'\\\\?\\D:\\cache',OPENAI_BASE_URL:'http://127.0.0.1:1234/v1',OPENAI_API_KEY:'fixture'};
  assert.deepEqual(classroomProcessEnvironment(source,'linux'),source);
  assert.deepEqual(classroomProcessEnvironment(source,'win32'),{...source,Path:'C:\\Node;\\\\server\\tools',COREPACK_HOME:'D:\\cache'});
});

test('Classroom stages and builds on D, selects only a completed build, and keeps classroom data on C',t=>{
  const {data,bulk}=fixture(t);
  const legacy=path.join(data,'runtime-v2/toolchains/openmaic');
  const installed=path.join(bulk,'runtime-v2/toolchains/openmaic');
  assert.equal(classroomRuntimeRoot(),legacy);
  assert.equal(classroomInstallationRoot(),installed);
  const external=path.join(data,'user-owned');
  assert.equal(classroomRuntimeRoot({...process.env,OPENMAIC_RUNTIME_ROOT:external}),external);
  assert.throws(()=>classroomInstallationRoot({...process.env,OPENMAIC_RUNTIME_ROOT:external}),/own installation directory/u);
  assert.equal(classroomInstallationRoot({...process.env,OPENMAIC_RUNTIME_ROOT:legacy}),installed);
  assert.equal(classroomToolsDir(),path.join(bulk,'runtime-v2/toolchains/openmaic-tools'));
  assert.equal(classroomStagingRoot('fixture'),path.join(bulk,'runtime-v2/toolchains/.openmaic-stage-fixture'));
  const state=classroomDataDir();write(path.join(state,'my-lesson.json'),'saved');
  write(path.join(installed,'.next/BUILD_ID'));
  markManagedPayloadReady(data,'runtime-v2/toolchains/openmaic');
  assert.equal(classroomRuntimeRoot(),legacy,'an incomplete build must not displace C');
  for(const file of ['packages/@openmaic/generation/dist/index.js','public/vendor/maic-importer/index.js'])write(path.join(installed,file));
  markManagedPayloadReady(data,'runtime-v2/toolchains/openmaic');
  assert.equal(classroomRuntimeRoot(),installed);
  ensureClassroomDataLink(path.join(installed,'data'));
  assert.equal(fs.realpathSync.native(path.join(installed,'data')),fs.realpathSync.native(state));
  assert.equal(fs.readFileSync(path.join(state,'my-lesson.json'),'utf8'),'saved');
  fs.unlinkSync(path.join(installed,'.next/BUILD_ID'));
  assert.equal(classroomRuntimeRoot(),legacy,'a lost build must not remain ready');
});

test('missing Corepack uses the exact source-pinned pnpm and verifies its integrity before reuse',async t=>{
  const {base}=fixture(t),source=path.join(base,'source'),tools=classroomToolsDir();
  const hash='ab'.repeat(64),version='10.28.0';
  write(path.join(source,'package.json'),JSON.stringify({packageManager:`pnpm@${version}+sha512.${hash}`}));
  const calls=[];
  const run=async(label,command,args,options)=>{
    calls.push({label,command,args,options});
    write(path.join(tools,'node_modules/pnpm/bin/pnpm.cjs'),'// fixture');
    write(path.join(tools,'node_modules/pnpm/package.json'),JSON.stringify({version}));
    write(path.join(tools,'package-lock.json'),JSON.stringify({packages:{'node_modules/pnpm':{integrity:`sha512-${Buffer.from(hash,'hex').toString('base64')}`}}}));
  };
  const result=await prepareClassroomPackageManager(source,tools,{},run,null);
  assert.equal(calls.length,1);assert.equal(calls[0].command,process.execPath);
  assert.ok(calls[0].args.includes('--ignore-scripts'));assert.equal(calls[0].args.at(-1),`pnpm@${version}`);
  assert.deepEqual(result,{entry:path.join(tools,'node_modules/pnpm/bin/pnpm.cjs'),prefix:[]});
  assert.deepEqual(await prepareClassroomPackageManager(source,tools,{},()=>assert.fail('verified package should be reused'),null),result);
  writePnpmShims(tools,result.entry,process.execPath,false);
  assert.ok(!fs.readFileSync(path.join(tools,'pnpm.cmd'),'utf8').includes(' pnpm %*'));
  write(path.join(tools,'package-lock.json'),'{}');
  await assert.rejects(prepareClassroomPackageManager(source,tools,{},async()=>{},null),/pinned integrity/u);
  write(path.join(source,'package.json'),JSON.stringify({packageManager:'pnpm@latest'}));
  await assert.rejects(prepareClassroomPackageManager(source,tools,{},()=>assert.fail('unpinned input must not install'),null),/must pin/u);
});
