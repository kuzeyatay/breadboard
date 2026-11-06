// An isolated test UI and native helper, backed by the already-running app.
// No dashboard build, service restart, copied credentials or profile changes.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(desktop, '../qa/system-dictation/sandbox-status.json');
if (fs.existsSync(output)) {
  const old = JSON.parse(fs.readFileSync(output, 'utf8'));
  if (old.status === 'ready' && old.pid) { try { process.kill(old.pid, 0); console.log('The dictation test is already open.'); process.exit(0); } catch {} }
}
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_TEST_CONTEXT;
const voicePreview = path.resolve(desktop, '../qa/system-dictation/voice-preview-status.json');
if (fs.existsSync(voicePreview)) {
  const preview = JSON.parse(fs.readFileSync(voicePreview, 'utf8'));
  if (preview.ready && preview.pid) { try { process.kill(preview.pid, 0); env.BREADBOARD_DICTATION_RESUME_VOICE = '1'; } catch {} }
}
if (!env.BREADBOARD_DICTATION_CDP) {
  const port = fs.readFileSync(path.join(process.env.APPDATA, 'breadboard-desktop/DevToolsActivePort'), 'utf8').split(/\r?\n/)[0];
  if (!/^\d+$/.test(port)) throw new Error('Breadboard debug endpoint is unavailable');
  env.BREADBOARD_DICTATION_CDP = 'http://127.0.0.1:' + port;
}
const targets = await (await fetch(env.BREADBOARD_DICTATION_CDP + '/json/list')).json();
if (!targets.some(target => /\/notification-overlay$/.test(target.url))) throw new Error('Open Breadboard before launching this test');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'breadboard-dictation-sandbox-'));
const windows = process.env.SystemRoot;
const compiler = path.join(windows, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const references = ['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'].map(name => '/reference:' + path.join(windows, 'Microsoft.NET/assembly/GAC_MSIL', name, 'v4.0_4.0.0.0__31bf3856ad364e35', name + '.dll'));
const common = ['/nologo', '/target:exe', '/platform:x64', '/optimize+', '/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll', '/reference:Accessibility.dll', ...references];
for (const [name, sources] of [
  ['windows-dictation', ['src/native/windows-dictation.cs', 'src/native/dictation-accessibility.cs', 'src/native/dictation-chord.cs']],
  ['sandbox-host', ['tests/fixtures/dictation-sandbox-host.cs', 'tests/fixtures/dictation-window-scope.cs', 'src/native/dictation-chord.cs']],
]) {
  const result = spawnSync(compiler, [...common, '/out:' + path.join(directory, name + '.exe'), ...sources.map(source => path.join(desktop, source))], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error(result.error?.message || result.stdout + result.stderr);
}
const log = path.join(directory, 'sandbox.log'), descriptor = fs.openSync(log, 'w');
const child = spawn(require('electron'), [path.join(desktop, 'tests/fixtures/dictation-sandbox.cjs'), directory], { cwd: desktop, env, detached: true, windowsHide: env.BREADBOARD_DICTATION_SANDBOX_SMOKE === '1', stdio: ['ignore', descriptor, descriptor] });
fs.closeSync(descriptor); child.unref();
for (let i = 0; i < 200; i++) {
  await new Promise(resolve => setTimeout(resolve, 100));
  const text = fs.readFileSync(log, 'utf8');
  if (text.includes('SANDBOX_READY')) { console.log(JSON.stringify({ ready: true, pid: child.pid, log, receipt: output })); process.exit(0); }
  try { process.kill(child.pid, 0); } catch { throw new Error(text || 'The dictation test exited before it was ready'); }
}
throw new Error('The test is still starting. See ' + log);
