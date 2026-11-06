// A physical click grants this isolated fixture foreground access. All typing
// after that click uses fixed test data and the production native helper.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'breadboard-typing-check-'));
const windows = process.env.SystemRoot || 'C:\\Windows';
const refs = ['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase', 'System.Speech'].map(name =>
  '/reference:' + path.join(windows, 'Microsoft.NET/assembly/GAC_MSIL', name, 'v4.0_4.0.0.0__31bf3856ad364e35', name + '.dll'));
const common = ['/nologo', '/target:exe', '/platform:x64', '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll', '/reference:Accessibility.dll', ...refs];
for (const [name, files] of [
  ['probe', ['tests/fixtures/dictation-native-host.cs']],
  ['windows-dictation', ['src/native/windows-dictation.cs', 'src/native/dictation-accessibility.cs', 'src/native/dictation-chord.cs']],
]) {
  const run = spawnSync(path.join(windows, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), [...common, '/out:' + path.join(directory, name + '.exe'), ...files.map(file => path.join(desktop, file))], { windowsHide: true, encoding: 'utf8' });
  if (run.status !== 0) throw Error(run.stdout + run.stderr);
}
const env = { ...process.env, BREADBOARD_DICTATION_INTERACTIVE: '1', BREADBOARD_DICTATION_QUICK: '1' };
if (process.argv[2]) env.BREADBOARD_DICTATION_BASELINE = path.resolve(process.argv[2]);
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_TEST_CONTEXT;
const log = path.join(directory, 'check.log'), fd = fs.openSync(log, 'w');
const child = spawn(require('electron'), [path.join(desktop, 'tests/fixtures/dictation-chromium.cjs'), directory], { cwd: desktop, env, windowsHide: false, detached: true, stdio: ['ignore', fd, fd] });
fs.closeSync(fd); child.unref();
console.log(JSON.stringify({ pid: child.pid, directory, log }));
