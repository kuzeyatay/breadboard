import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {registeredConnectExecutable, inspectBambuConnect, bambuConnectUri, launchBambuConnect, prepareConnectPlate, handoffConnectPlate} from '../src/lib/bambu/connect.ts';
import {slicedFixture} from './helpers/bambu-fake.mjs';

async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'breadboard-connect-'));
  t.after(() => fs.rm(root, {recursive:true, force:true}));
  return root;
}
const registration = {platform:'win32', executable:'C:\\Apps\\Bambu Connect\\bambu-connect.exe'};

test('registration follows each user installation and rejects shell commands and unrelated handlers', () => {
  for (const exe of ['D:\\Apps\\Bambu Connect\\bambu-connect.exe', 'C:\\Users\\Zoë\\AppData\\Local\\BambuConnect\\BambuConnect.exe']) {
    assert.equal(registeredConnectExecutable(`HKEY_CLASSES_ROOT\\bambu-connect\\shell\\open\\command\r\n    (Default)    REG_SZ    "${exe}" "%1"\r\n`), exe);
  }
  for (const value of ['cmd.exe /c something', '"C:\\Windows\\powershell.exe" -Command bad', '"\\\\host\\share\\bambu-connect.exe" "%1"', '"C:\\App\\other.exe" "%1"']) {
    assert.equal(registeredConnectExecutable(`    (Default)    REG_SZ    ${value}`), null);
  }
});

test('capabilities distinguish installation from printer connection and unattended printing', async () => {
  const installed = await inspectBambuConnect(async () => registration, 'win32');
  assert.equal(installed.available, true);
  for (const capability of ['canStartUnattended','canSetAmsMapping','canObservePrint']) assert.equal(installed[capability], false);
  assert.equal('executable' in installed, false);
  assert.equal('connected' in installed, false);
  assert.equal((await inspectBambuConnect(async () => null, 'win32')).available, false);
  assert.equal((await inspectBambuConnect(async () => registration, 'linux')).platformSupported, false);
});

test('official URI preserves Unicode and special characters as data with only documented parameters', () => {
  const file = 'C:\\Users\\Zoë\\parts & $(test)\\finger #4.gcode.3mf';
  const name = 'Finger & #4 $(test)';
  const uri = new URL(bambuConnectUri(file, name, 'win32'));
  assert.equal(uri.protocol, 'bambu-connect:'); assert.equal(uri.hostname, 'import-file');
  assert.equal(uri.searchParams.get('path'), file); assert.equal(uri.searchParams.get('name'), name);
  assert.deepEqual([...uri.searchParams.keys()], ['path','name','version']);
  assert.equal(uri.searchParams.get('version'), '1.0.0');
  assert.equal(new URL(bambuConnectUri('/Users/Zoë/finger.gcode.3mf', name, 'darwin')).searchParams.get('path'), '/Users/Zoë/finger.gcode.3mf');
  for (const bad of ['relative.gcode.3mf', 'https://host/model.gcode.3mf', 'C:\\x\n.gcode.3mf', 'C:\\x.stl']) assert.throws(() => bambuConnectUri(bad, name, 'win32'));
});

test('native launches never interpret paths as shell code and never claim a started print', async () => {
  const calls = [];
  const run = async (...args) => {calls.push(args); return {stdout:''};};
  const file = 'C:\\test & $(bad)\\plate.gcode.3mf';
  const result = await launchBambuConnect(file, 'test', registration, run);
  assert.deepEqual(result, {launchRequested:true, printStarted:false, sentToPrinter:false});
  assert.equal(calls[0][1].some(arg => arg.includes(file)), false);
  assert.equal(new URL(calls[0][2].env.BREADBOARD_BAMBU_CONNECT_URI).searchParams.get('path'), file);
  assert.equal(calls[0][2].windowsHide, true);
  await launchBambuConnect('/tmp/a.gcode.3mf', 'test', {platform:'darwin',application:'/Applications/Bambu Connect.app'}, run);
  assert.equal(calls[1][0], '/usr/bin/open'); assert.deepEqual(calls[1][1].slice(0,2), ['-a','/Applications/Bambu Connect.app']);
  await assert.rejects(launchBambuConnect(file, 'test', registration, async () => {throw new Error('private detail');}), error => error.code === 'bambu_connect_launch' && !error.message.includes('private detail'));
});

test('handoff accepts sliced profiles across Bambu families without a P2S-only model list', async t => {
  const root = await temporary(t);
  for (const model of ['Bambu Lab P2S','Bambu Lab P1P','Bambu Lab P1S','Bambu Lab X1 Carbon','Bambu Lab X1E','Bambu Lab A1','Bambu Lab A1 mini','Bambu Lab H2S','Bambu Lab H2D']) {
    const prepared = await prepareConnectPlate(root, slicedFixture({model}), 'test.gcode.3mf');
    assert.equal(prepared.plate.model, model);
  }
  // Multi-nozzle validation is delegated to the native app, never flattened to a single nozzle.
  const multi = await prepareConnectPlate(root, slicedFixture({model:'Bambu Lab H2D', nozzle:'0.4;0.6'}), 'dual.gcode.3mf');
  assert.equal(multi.plate.nozzle, null); assert.ok(multi.plate.blockers.some(x => x.includes('nozzle')));
});

test('storage is scoped to the account, deduplicated, and checked for changed bytes', async t => {
  const root = await temporary(t), bytes = slicedFixture();
  const first = await prepareConnectPlate(path.join(root, 'user-1'), bytes, '../../test.gcode.3mf');
  const second = await prepareConnectPlate(path.join(root, 'user-2'), bytes, 'test.gcode.3mf');
  assert.equal(first.sha256, second.sha256); assert.notEqual(first.file, second.file);
  assert.ok(first.file.startsWith(path.join(root, 'user-1') + path.sep));
  assert.equal(first.displayName, 'test');
  assert.equal((await prepareConnectPlate(path.join(root, 'user-1'), bytes, 'again.gcode.3mf')).file, first.file);
  await fs.writeFile(first.file, 'changed');
  await assert.rejects(prepareConnectPlate(path.join(root, 'user-1'), bytes, 'test.gcode.3mf'), /changed/);
  await assert.rejects(prepareConnectPlate(root, Buffer.from('PKbroken'), 'test.gcode.3mf'));
  await assert.rejects(prepareConnectPlate(root, slicedFixture({unsliced:true}), 'test.gcode.3mf'));
});

test('handoff receipts cannot turn an OS launch into a printer or AMS confirmation', async t => {
  const root = await temporary(t);
  const calls = [];
  const receipt = await handoffConnectPlate(root, slicedFixture(), 'test.gcode.3mf', async () => registration, async (...args) => {calls.push(args); return {launchRequested:true, printStarted:false, sentToPrinter:false};});
  assert.equal(calls.length, 1); assert.equal(receipt.state, 'confirmation_required');
  for (const property of ['printStarted','sentToPrinter','printerConnectionVerified','mappingApplied']) assert.equal(receipt[property], false);
  assert.equal(JSON.stringify(receipt).includes(root), false);
  await assert.rejects(handoffConnectPlate(root, slicedFixture(), 'test.gcode.3mf', async () => null), /Install/);
});

test('API requires same-origin signed-in access, rejects arbitrary paths, and scopes each upload to its user', async t => {
  const root = await temporary(t);
  globalThis.__connectTest = {userId:1, root, calls:[]};
  t.after(() => {delete globalThis.__connectTest;});
  const stubs = {
    'server-auth.ts': 'export class RouteError extends Error {constructor(status,message){super(message);this.status=status;}} export const requireUserId=()=>{if(!globalThis.__connectTest.userId)throw new RouteError(401,"Unauthorized");return globalThis.__connectTest.userId;};',
    'conversations/store.ts': 'export const getConversationForUser=()=>({});',
    'runtime-paths.ts': 'export const dashboardBulkDataDir=()=>globalThis.__connectTest.root;',
    'bambu/connect.ts': 'export const inspectBambuConnect=async()=>({available:true,canStartUnattended:false}); export const handoffConnectPlate=async(root,bytes,name)=>{globalThis.__connectTest.calls.push({root,size:bytes.length,name});return {launchRequested:true,printStarted:false};};',
  };
  const plugin = {name:'test-host', setup(b) {
    b.onResolve({filter:/.*/}, args => {
      let portable = (args.path.startsWith('.') ? path.resolve(args.resolveDir, args.path) : args.path).replaceAll('\\','/');
      const key = Object.keys(stubs).find(k => portable.endsWith('/'+k) || (portable+'.ts').endsWith('/'+k));
      if (key) return {path:key, namespace:'test-host'};
      if (args.path.startsWith('@/')) return {path:path.resolve('src', args.path.slice(2))};
      return null;
    });
    b.onLoad({filter:/.*/,namespace:'test-host'}, args => ({contents:stubs[args.path],loader:'ts'}));
  }};
  const outfile = path.join(root, 'route.cjs');
  await build({entryPoints:[path.resolve('src/app/api/hermes/connections/bambu/connect/route.ts')],outfile,bundle:true,platform:'node',format:'cjs',plugins:[plugin],logLevel:'silent'});
  const route = createRequire(import.meta.url)(outfile);
  const url = 'http://127.0.0.1:1234/api/hermes/connections/bambu/connect';
  const request = (headers = {}) => new Request(url, {method:'POST',headers:{origin:'http://127.0.0.1:1234','content-type':'application/octet-stream','x-bambu-filename':'test.gcode.3mf',...headers},body:'TEST'});
  globalThis.__connectTest.userId = null;
  assert.equal((await route.GET(new Request(url))).status,401);
  assert.equal((await route.POST(request())).status,401);
  globalThis.__connectTest.userId = 1;
  assert.equal((await route.POST(request({origin:'https://foreign.example'}))).status,403);
  assert.equal((await route.POST(request({authorization:'Bearer tool'}))).status,403);
  assert.equal((await route.POST(request({'content-type':'application/json'}))).status,400);
  assert.equal((await route.POST(request())).status,200);
  globalThis.__connectTest.userId = 2;
  assert.equal((await route.POST(request())).status,200);
  assert.deepEqual(globalThis.__connectTest.calls.map(c => c.root), [path.join(root,'bambu/connect/1'),path.join(root,'bambu/connect/2')]);
});
