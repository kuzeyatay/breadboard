import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { runElectronFixture } from './helpers/run-electron-fixture';

function compileAccessibilityProbe(root: string, directory: string) {
  const windows = process.env.SystemRoot || 'C:\\Windows';
  const references = ['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase', 'System.Speech'].map(name =>
    '/reference:' + path.join(windows, 'Microsoft.NET/assembly/GAC_MSIL', name, 'v4.0_4.0.0.0__31bf3856ad364e35', name + '.dll'));
  const compile = spawnSync(path.join(windows, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    ['/nologo', '/target:exe', '/platform:x64', `/out:${path.join(directory, 'probe.exe')}`,
      '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll',
      '/reference:Accessibility.dll', ...references, path.join(root, 'tests/fixtures/dictation-native-host.cs')], { encoding: 'utf8', windowsHide: true });
  assert.equal(compile.status, 0, compile.stdout + compile.stderr);
  fs.copyFileSync(path.join(root, 'dist/native/windows-dictation.exe'), path.join(directory, 'windows-dictation.exe'));
}

test('a cold editor can acquire live preview after its selection becomes available without retargeting the hold', { skip: process.platform !== 'win32' }, () => {
  const root = path.resolve(__dirname, '../..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-dictation-preview-'));
  try {
    const windows = process.env.SystemRoot || 'C:\\Windows';
    const exe = path.join(directory, 'preview.exe');
    const references = ['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'].map(name =>
      '/reference:' + path.join(windows, 'Microsoft.NET/assembly/GAC_MSIL', name, 'v4.0_4.0.0.0__31bf3856ad364e35', name + '.dll'));
    const compile = spawnSync(path.join(windows, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
      ['/nologo', '/target:exe', '/platform:x64', '/main:DictationPreviewTests', `/out:${exe}`,
        '/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll', '/reference:Accessibility.dll', ...references,
        path.join(root, 'src/native/windows-dictation.cs'), path.join(root, 'src/native/dictation-chord.cs'),
        path.join(root, 'tests/fixtures/dictation-preview-tests.cs')], { encoding: 'utf8', windowsHide: true });
    assert.equal(compile.status, 0, compile.stdout + compile.stderr);
    const run = spawnSync(exe, [], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /Delayed preview capture checks passed/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('native accessibility recognizes Chromium input, textarea and rich editors and rejects stale or non-editable focus',
  { skip: process.platform !== 'win32', timeout: 240000 }, async t => {
  const root = path.resolve(__dirname, '../..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-dictation-chromium-'));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_TEST_CONTEXT;
  try {
    compileAccessibilityProbe(root, directory);
    const result = await runElectronFixture(require('electron') as string, [path.join(root, 'tests/fixtures/dictation-chromium.cjs'), directory], root, env, 230000, true);
    assert.equal(result.error, undefined, result.output + String(result.error ?? ''));
    assert.equal(result.status, 0, result.output);
    const verified = JSON.parse(fs.readFileSync(path.join(directory, 'passed.json'), 'utf8')) as { skipped?: string };
    if (verified.skipped) { t.skip(verified.skipped); return; }
    const receipt = path.resolve(root, '../qa/system-dictation/chromium-fields.json');
    fs.mkdirSync(path.dirname(receipt), { recursive: true });
    fs.copyFileSync(path.join(directory, 'passed.json'), receipt);
  } finally { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test('Breadboard chat receives atomic live revisions while Ctrl+Shift is held, then submits the final words once',
  { skip: process.platform !== 'win32', timeout: 45000 }, async t => {
  const root = path.resolve(__dirname, '../..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-dictation-composer-'));
  const env: NodeJS.ProcessEnv = { ...process.env, BREADBOARD_DICTATION_INTERACTIVE: '0' }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_TEST_CONTEXT;
  try {
    compileAccessibilityProbe(root, directory);
    const result = await runElectronFixture(require('electron') as string, [path.join(root, 'tests/fixtures/dictation-composer.cjs'), directory], root, env, 40000, true);
    assert.equal(result.error, undefined, result.output + String(result.error ?? ''));
    assert.equal(result.status, 0, result.output);
    const verified = JSON.parse(fs.readFileSync(path.join(directory, 'passed.json'), 'utf8')) as { skipped?: string };
    if (verified.skipped) { t.skip(verified.skipped); return; }
    const receipt = path.resolve(root, '../qa/system-dictation/composer-streaming.json');
    fs.mkdirSync(path.dirname(receipt), { recursive: true });
    fs.copyFileSync(path.join(directory, 'passed.json'), receipt);
  } finally { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test('native input preserves selection, submits once and rejects stale focus', { skip: process.platform !== 'win32', timeout: 15000 }, t => {
  const root = path.resolve(__dirname, '../..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-dictation-input-'));
  try {
    const windows = process.env.SystemRoot || 'C:\\Windows';
    const exe = path.join(directory, 'insertion.exe');
    const references = ['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'].map(name =>
      '/reference:' + path.join(windows, 'Microsoft.NET/assembly/GAC_MSIL', name, 'v4.0_4.0.0.0__31bf3856ad364e35', name + '.dll'));
    const compile = spawnSync(path.join(windows, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
      ['/nologo', '/target:exe', `/out:${exe}`, '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', ...references,
        path.join(root, 'tests/fixtures/dictation-insertion-test.cs')], { encoding: 'utf8', windowsHide: true });
    assert.equal(compile.status, 0, compile.stdout + compile.stderr);
    const run = spawnSync(exe, [path.join(root, 'dist/native/windows-dictation.exe')], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    t.diagnostic(run.stdout.trim());
    if (run.status === 2) {
      t.skip('Windows denied fixture foreground access; focus rejection passed but live insertion was not exercised');
      return;
    }
    assert.equal(run.status, 0, run.stdout + run.stderr);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('Ctrl+Shift preserves other shortcuts and handles hold, release and cancellation without leaking Win', { skip: process.platform !== 'win32' }, () => {
  const root = path.resolve(__dirname, '../..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-dictation-test-'));
  try {
    const exe = path.join(directory, 'chord-tests.exe');
    const compiler = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    const compile = spawnSync(compiler, ['/nologo', '/target:exe', `/out:${exe}`,
      path.join(root, 'src/native/dictation-chord.cs'), path.join(root, 'tests/fixtures/dictation-chord-tests.cs')], { encoding: 'utf8', windowsHide: true });
    assert.equal(compile.status, 0, compile.stdout + compile.stderr);
    const run = spawnSync(exe, [], { encoding: 'utf8', windowsHide: true });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /regression checks passed/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('Mausely tagged Ctrl+Shift starts and finishes dictation while ordinary injected input stays excluded', { skip: process.platform !== 'win32' }, () => {
  const root = path.resolve(__dirname, '../..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-dictation-mausely-'));
  try {
    const exe = path.join(directory, 'mausely-tests.exe');
    const compiler = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    const compile = spawnSync(compiler, ['/nologo', '/target:exe', '/platform:x64', `/out:${exe}`,
      path.join(root, 'tests/fixtures/dictation-mausely-tests.cs')], { encoding: 'utf8', windowsHide: true });
    assert.equal(compile.status, 0, compile.stdout + compile.stderr);
    const run = spawnSync(exe, [path.join(root, 'dist/native/windows-dictation.exe')], { encoding: 'utf8', windowsHide: true });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /injected-input exclusion checks passed/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('Windows hooks install and shut down on parent pipe closure', { skip: process.platform !== 'win32', timeout: 10000 }, async () => {
  const helper = spawn(path.resolve(__dirname, '../../dist/native/windows-dictation.exe'), [], { windowsHide: true, stdio: 'pipe' });
  const lines = createInterface({ input: helper.stdout });
  try {
    await new Promise<void>((resolve, reject) => {
      helper.once('error', reject);
      helper.once('exit', code => reject(new Error(`Helper exited before ready: ${code}`)));
      lines.once('line', line => { try { assert.equal(JSON.parse(line).type, 'ready'); resolve(); } catch (error) { reject(error); } });
    });
    const exit = new Promise(resolve => helper.once('exit', resolve));
    helper.stdin.end();
    assert.equal(await exit, 0);
  } finally { lines.close(); helper.kill(); }
});

test('Windows silently removing hooks is recovered without restarting Breadboard or leaving stuck keys', { skip: process.platform !== 'win32', timeout: 15000 }, async () => {
  const root = path.resolve(__dirname, '../..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-dictation-hooks-'));
  try {
    const executable = path.join(directory, 'recovery.exe');
    const compiler = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    const compile = spawnSync(compiler, ['/nologo', '/target:exe', '/platform:x64', `/out:${executable}`,
      '/reference:System.Windows.Forms.dll', path.join(root, 'tests/fixtures/dictation-hook-recovery.cs')], { encoding: 'utf8', windowsHide: true });
    assert.equal(compile.status, 0, compile.stdout + compile.stderr);
    const child = spawn(executable, [path.join(root, 'dist/native/windows-dictation.exe')], { windowsHide: true, stdio: 'pipe' });
    let output = '';
    child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
    const timeout = setTimeout(() => child.kill(), 10000);
    try {
      const status = await new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
      assert.equal(status, 0, output);
      assert.match(output, /hooks-restored/);
      assert.match(output, /automatic recovery checks passed/);
    } finally { clearTimeout(timeout); child.kill(); }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('in-flight text cannot be converted into Ctrl shortcuts by queued restores or physical autorepeat', { skip: process.platform !== 'win32' }, () => {
  const root = path.resolve(__dirname, '../..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-dictation-modifiers-'));
  try {
    const exe = path.join(directory, 'modifiers.exe');
    const compiler = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    const compile = spawnSync(compiler, ['/nologo', '/target:exe', `/out:${exe}`, path.join(root, 'tests/fixtures/dictation-modifier-tests.cs')], { encoding: 'utf8', windowsHide: true });
    assert.equal(compile.status, 0, compile.stdout + compile.stderr);
    const run = spawnSync(exe, [path.join(root, 'dist/native/windows-dictation.exe')], { encoding: 'utf8', windowsHide: true });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /regression checks passed/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('isolated dictation test cannot compete with the running app shortcut', { skip: process.platform !== 'win32' }, () => {
  const root = path.resolve(__dirname, '../..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-dictation-scope-'));
  try {
    const exe = path.join(directory, 'scope-tests.exe');
    const compiler = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    const compile = spawnSync(compiler, ['/nologo', '/target:exe', `/out:${exe}`,
      path.join(root, 'src/native/dictation-chord.cs'), path.join(root, 'tests/fixtures/dictation-window-scope.cs'),
      path.join(root, 'tests/fixtures/dictation-window-scope-tests.cs')], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(compile.status, 0, compile.stdout + compile.stderr);
    const run = spawnSync(exe, [], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /window scope checks passed/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
