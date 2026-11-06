import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { build } from 'esbuild';
import { ensureArtifactSchema } from '../src/lib/hermes/artifact-schema.ts';

test('completed recordings become owned, playable video artifacts and retries reuse the artifact', { skip: process.platform !== 'win32' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-recording-artifact-'));
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY);
    CREATE TABLE clusters(id INTEGER PRIMARY KEY, slug TEXT, user_id INTEGER);
    CREATE TABLE conversations(id INTEGER PRIMARY KEY, public_id TEXT, user_id INTEGER, surface TEXT, default_garden_id INTEGER);
    CREATE TABLE hermes_runtime_sessions(id INTEGER PRIMARY KEY);
    CREATE TABLE hermes_runs(id TEXT PRIMARY KEY, runtime_session_id INTEGER);
    CREATE TABLE conversation_messages(id INTEGER PRIMARY KEY, conversation_id INTEGER, client_message_id TEXT, role TEXT);
    INSERT INTO users VALUES (7);
    INSERT INTO conversations VALUES (44, 'conv_recording', 7, 'dashboard_terminal', NULL);
    INSERT INTO hermes_runtime_sessions VALUES (33);
    INSERT INTO hermes_runs VALUES ('run', 33);
    INSERT INTO conversation_messages VALUES (55, 44, 'client', 'assistant');
  `);
  ensureArtifactSchema(database);
  const state = globalThis.__screenRecordingArtifactTest = { database, root, active: true };
  const stubs = {
    '../db.ts': 'export default globalThis.__screenRecordingArtifactTest.database;',
    '../runtime-paths.ts': 'export const dashboardDataDir = () => globalThis.__screenRecordingArtifactTest.root; export const repositoryRoot = dashboardDataDir;',
    './runtime-store.ts': 'export const runtimeExternalSessionId = () => "runtime";',
    './run-store.ts': 'export const getRuntimeRun = () => ({ id: "run" }); export const getActiveRuntimeRun = () => globalThis.__screenRecordingArtifactTest.active ? { id: "run" } : null; export const parseRuntimeRunDispatch = () => ({ clientMessageId: "client" });',
  };
  try {
    const bundle = await build({ entryPoints: ['src/lib/hermes/screen-recording-artifact.ts'], bundle: true, write: false,
      platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'isolated-authority', setup(builder) {
        builder.onResolve({ filter: /./ }, args => stubs[args.path] ? { path: args.path, namespace: 'authority' } : undefined);
        builder.onLoad({ filter: /.*/, namespace: 'authority' }, args => ({ contents: stubs[args.path], loader: 'js' }));
      } }] });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
    const { attachScreenRecording } = module.exports;
    const session = { id: 33, user_id: 7, conversation_id: 44, cluster_id: null, surface: 'dashboard_terminal' };
    const id = '12345678-1234-1234-1234-123456789abc';
    const recording = { id, state: 'complete', filename: `${id}.mp4`, durationSeconds: 0.5, sourceId: 'tab:1' };
    fs.mkdirSync(path.join(root, 'screen-recordings'));
    const file = path.join(root, 'screen-recordings', recording.filename);
    execFileSync(path.resolve('../desktop/resources/bin/ffmpeg.exe'), ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10',
      '-t', '0.5', '-pix_fmt', 'yuv420p', file], { windowsHide: true });
    const pending = { recording: { state: 'recording' } };
    assert.equal(await attachScreenRecording(pending, session, 'run'), pending);
    await assert.rejects(attachScreenRecording({ recording: { ...recording, filename: '../private.mp4' } }, session, 'run'), /invalid recording/);
    state.active = false;
    await assert.rejects(attachScreenRecording({ recording }, session, 'run'), /finished/);
    state.active = true;
    const result = await attachScreenRecording({ recording }, session, 'run');
    assert.equal(result.artifact.kind, 'video');
    assert.equal(result.artifact.status, 'ready');
    assert.equal(result.artifact.downloadAvailable, true);
    const row = database.prepare('SELECT * FROM hermes_artifacts WHERE id = ?').get(result.artifact.id);
    assert.equal(row.user_id, 7);
    assert.equal(row.conversation_id, 44);
    assert.equal(row.originating_message_id, 55);
    assert.equal(row.originating_run_id, 'run');
    assert.equal(row.mime_type, 'video/mp4');
    fs.unlinkSync(file);
    const retried = await attachScreenRecording({ recording }, session, 'run');
    assert.equal(retried.artifact.id, result.artifact.id, 'retry does not duplicate or need the temporary source');
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM hermes_artifacts').get().n, 1);
  } finally {
    database.close(); delete globalThis.__screenRecordingArtifactTest;
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
