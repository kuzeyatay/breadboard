// Run after `npm run build` and `npm run test:build` in desktop. Set
// BREADBOARD_DICTATION_CDP to the running Breadboard debug endpoint so this
// verifies the user's configured garden/terminal provider. Set
// BREADBOARD_DICTATION_PHYSICAL=1 to use physical keys and microphone audio.
// --latency compares both transcription paths with the same synthetic speech,
// without capturing the user's microphone or injecting keyboard input.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { runElectronFixture } = require('../dist-tests/tests/helpers/run-electron-fixture.js');
if (!process.env.BREADBOARD_DICTATION_CDP) {
  throw new Error('Set BREADBOARD_DICTATION_CDP to the running Breadboard debug endpoint; verification must use its configured dictation provider.');
}
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'breadboard-dictation-live-'));
const output = path.resolve(desktop, '../qa/system-dictation');
const shortCommands = process.argv.includes('--short-commands');
const withoutRelay = process.argv.includes('--without-relay');
const standby = process.argv.includes('--standby');
const commands = process.argv.includes('--commands') || shortCommands;
const startup = process.argv.includes('--startup') || commands;
const latency = process.argv.includes('--latency') || startup;
const outputPrefix = (standby ? 'standby-' : '') + (withoutRelay ? 'direct-' : '') + (shortCommands ? 'short-commands-' : commands ? 'commands-' : startup ? 'startup-' : latency ? 'latency-' : 'live-');
const windows = process.env.SystemRoot || 'C:\\Windows';
const references = ['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase', 'System.Speech'].map(name =>
  '/reference:' + path.join(windows, 'Microsoft.NET/assembly/GAC_MSIL', name, 'v4.0_4.0.0.0__31bf3856ad364e35', name + '.dll'));
function run(exe, args) {
  const result = spawnSync(exe, args, { windowsHide: true, encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error(result.stdout + result.stderr + (result.error || ''));
}
try {
  run(path.join(windows, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo', '/target:exe',
    '/out:' + path.join(directory, 'native-host.exe'), '/reference:System.Windows.Forms.dll',
    '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll', '/reference:Accessibility.dll', ...references,
    path.join(desktop, 'tests/fixtures/dictation-native-host.cs')]);
  run(path.join(directory, 'native-host.exe'), ['--sample', path.join(directory, 'sample.wav')]);
  if (latency) run(path.join(directory, 'native-host.exe'), ['--sample', path.join(directory, 'sample-long.wav'),
    shortCommands ? 'Ready to send. Send message.' : 'The words should appear while I am still speaking. I can pause between sentences and then continue with more details. Please keep every final word, including purple bicycles beside the river. Send message.']);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_TEST_CONTEXT;
  if (commands) env.BREADBOARD_DICTATION_COMMAND_ONLY = '1';
  if (shortCommands) env.BREADBOARD_DICTATION_SHORT_COMMANDS = '1';
  if (withoutRelay) env.BREADBOARD_DICTATION_DROP_USER_RELAY = '1';
  if (standby) env.BREADBOARD_DICTATION_STANDBY = '1';
  const result = await runElectronFixture(require('electron'), [path.join(desktop, startup ? 'tests/fixtures/dictation-startup.cjs' : latency ? 'tests/fixtures/dictation-latency.cjs' : 'tests/fixtures/system-dictation-e2e.cjs'), directory], desktop, env, 480000);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, outputPrefix + 'last-run.json'), JSON.stringify({
    checkedAt: new Date().toISOString(), shortcut: 'Ctrl + Shift', physical: env.BREADBOARD_DICTATION_PHYSICAL === '1',
    passed: !result.error && result.status === 0, error: result.error?.message,
  }, null, 2));
  for (const name of ['passed.json', 'cursor-pill.png', 'transcription.log', 'electron-output.log', 'latency-runs.json']) {
    if (fs.existsSync(path.join(directory, name))) fs.copyFileSync(path.join(directory, name), path.join(output, outputPrefix + name));
  }
  if (result.error || result.status !== 0) throw new Error(result.output + String(result.error || ''));
  const receipt = JSON.parse(fs.readFileSync(path.join(directory, 'passed.json'), 'utf8'));
  console.log(JSON.stringify(startup ? {
    passed: receipt.passed, checkedAt: receipt.checkedAt, scope: receipt.scope,
    runs: receipt.runs.map(({ name, startupMs, firstWordsAfterSpeechMs, releaseToTextMs, microphoneStopMs, fallbacks, notice, commandBeforeRelease, resultBeforeRelease, commandConfirmationToResultMs }) =>
      ({ name, startupMs, firstWordsAfterSpeechMs, releaseToTextMs, microphoneStopMs, fallbacks, submit: notice.submit, commandBeforeRelease, resultBeforeRelease, commandConfirmationToResultMs })),
    receipt: path.join(output, outputPrefix + 'passed.json'),
  } : receipt, null, 2));
} finally { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
