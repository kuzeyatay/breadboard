import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BrowserDownloads } from '../src/main/browser-downloads';

test('native transfer progress, cancellation, failures and completed file actions share browser history', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-hls-history-'));
  const opened: string[] = [];
  const files = { openPath: async (file: string) => { opened.push(file); return ''; }, showItemInFolder: () => {} };
  const store = new BrowserDownloads(dir, files);
  try {
    let cancelled = false;
    const transfer = store.startNative('video.video', 'https://page.example/watch', () => { cancelled = true; });
    transfer.rename('video.ts'); transfer.progress(1024, 1, 2);
    const item = store.snapshot().items[0]!;
    assert.deepEqual(item.progress, { completed: 1, total: 2 });
    assert.equal((await store.command({ type: 'cancel', id: item.id })).ok, true);
    assert.equal(cancelled, true);
    transfer.finish('cancelled');
    const failed = store.startNative('failed.ts', 'https://page.example/watch', () => {});
    failed.finish('interrupted', '', 'The server returned HTTP 403.');
    const complete = store.startNative('video.ts', 'https://page.example/watch', () => {});
    const output = path.join(dir, 'video.ts'); fs.writeFileSync(output, Buffer.alloc(2048));
    complete.progress(2048, 2, 2); complete.finish('completed', output);
    assert.equal((await store.command({ type: 'open', id: store.snapshot().items[0]!.id })).ok, true);
    assert.deepEqual(opened, [output]);
    const restored = new BrowserDownloads(dir, files).snapshot();
    assert.equal(restored.error, null);
    assert.deepEqual(restored.items.map(item => item.state), ['completed', 'interrupted', 'cancelled']);
    assert.match(restored.items[1]!.error!, /403/);
    assert.equal(restored.items[0]!.totalBytes, 2048);
  } finally {
    store.flush(); assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('application shutdown aborts native requests and restores them as interrupted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-hls-quit-'));
  const files = { openPath: async () => '', showItemInFolder: () => {} };
  const store = new BrowserDownloads(dir, files);
  try {
    let aborted = false;
    const transfer = store.startNative('video.ts', 'https://page.example/watch', () => { aborted = true; });
    transfer.progress(1024, 1, 2); store.prepareForQuit(); transfer.finish('cancelled');
    assert.equal(aborted, true);
    assert.equal(new BrowserDownloads(dir, files).snapshot().items[0]!.state, 'interrupted');
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
