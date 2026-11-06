import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Run from the artifact, not this script's directory. The resolver guard is
// essential: a standalone tree inside the checkout can otherwise silently load
// missing files from the developer's node_modules and give a false pass.
const runtimeLoader = stripTypeScriptTypes(fs.readFileSync(new URL('../../dashboard/src/lib/speech/livekit-runtime.ts', import.meta.url), 'utf8'));
export const livekitRuntimeProbe = runtimeLoader + String.raw`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fs.realpathSync(process.cwd());
registerHooks({ resolve(specifier, context, next) {
  const result = next(specifier, context);
  if (result.url.startsWith('file:')) {
    const relative = path.relative(root, fs.realpathSync(fileURLToPath(result.url)));
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('LiveKit resolved outside the standalone artifact: ' + specifier);
    }
  }
  return result;
} });
// Use the same narrow audio loader as the route, including its internal SDK
// paths. The native source test separately preloads Next's image library to
// reproduce the Windows DLL conflict from importing the umbrella SDK.
const { VAD, initializeLogger, VADEventType, AudioFrame } = loadLiveKitVoiceRuntime();
initializeLogger({ pretty: false, level: 'error' });
const vad = new VAD();
const stream = vad.stream();
let input;
stream.updateInputStream(new ReadableStream({ start(controller) { input = controller; } }));
const timeout = setTimeout(() => { console.error('Packaged LiveKit inference timed out'); process.exit(1); }, 10000);
try {
  input.enqueue(new AudioFrame(new Int16Array(1024), 16000, 1, 1024));
  let processed = 0;
  for await (const event of stream) {
    if (event.type === VADEventType.INFERENCE_DONE) processed = event.samplesIndex;
    if (processed >= 1024) break;
  }
  assert.ok(processed >= 1024, 'The packaged native model must actually process audio');
  console.log('LiveKit standalone audio imports and native inference passed');
} finally {
  clearTimeout(timeout);
  input.close();
  stream.close();
  await vad.close();
}
`;

export function verifyLiveKitRuntime(standaloneRoot, nodeExecutable = process.execPath) {
  const result = spawnSync(nodeExecutable, ['--input-type=module', '--eval', livekitRuntimeProbe], {
    cwd: standaloneRoot, encoding: 'utf8', timeout: 40_000, windowsHide: true,
    // Do not allow caller preload hooks or NODE_PATH to mask packaging defects.
    env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Packaged LiveKit validation failed: ${result.error?.message ?? result.stderr ?? result.stdout}`);
  }
  return result.stdout.trim();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Supply the standalone dashboard directory.');
  console.log(verifyLiveKitRuntime(path.resolve(process.argv[2]), process.argv[3] ? path.resolve(process.argv[3]) : undefined));
}
