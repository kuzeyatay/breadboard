import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Session, WebContents } from 'electron';
import { BrowserHlsDownloads, hlsFilename } from '../src/main/browser-hls-downloads';

function fixture() {
  const hooks: Record<string, (details: any) => void> = {};
  const session = { webRequest: Object.fromEntries(['onSendHeaders', 'onResponseStarted', 'onCompleted', 'onErrorOccurred']
    .map(name => [name, (...args: unknown[]) => { hooks[name] = args.at(-1) as (details: any) => void; }])) } as unknown as Session;
  const contents = (id: number) => Object.assign(new EventEmitter(), { id, session,
    getURL: () => `https://page.example/watch/${id}`, getUserAgent: () => 'fixture' }) as unknown as WebContents;
  const first = contents(1), second = contents(2);
  const manager = new BrowserHlsDownloads(undefined, undefined, () => {});
  manager.attach(first); manager.attach(second);
  const request = (id: number, owner = 1) => hooks.onSendHeaders!({ id, webContentsId: owner,
    requestHeaders: { Cookie: 'private cookie', Authorization: 'Bearer secret', Referer: 'https://page.example/watch/1' } });
  const response = (id: number, overrides = {}) => hooks.onResponseStarted!({ id, webContentsId: 1,
    url: 'https://cdn.example/manifest?token=secret', statusCode: 200, responseHeaders: { 'Content-Type': ['application/vnd.apple.mpegurl'] },
    fromCache: false, referrer: 'https://page.example/watch/1', ...overrides });
  return { first, second, manager, request, response };
}

test('detected streams are deduplicated, bounded and scoped to the requesting page', () => {
  const f = fixture();
  f.request(1); f.response(1);
  f.request(2); f.response(2);
  assert.equal(f.manager.snapshot(f.first).streams.length, 1);
  assert.equal(f.manager.snapshot(f.second).streams.length, 0);
  assert.doesNotMatch(JSON.stringify(f.manager.snapshot(f.first)), /secret|cookie|Authorization|https:/);
  for (let id = 3; id < 40; id++) { f.request(id); f.response(id, { url: `https://cdn.example/${id}.m3u8` }); }
  assert.equal(f.manager.snapshot(f.first).streams.length, 24);
});

test('navigation discards streams and late responses; cached manifests remain discoverable', () => {
  const f = fixture();
  f.request(1); f.response(1);
  f.request(2);
  f.first.emit('did-start-navigation', {} as never, 'https://page.example/next', false, true);
  assert.equal(f.manager.snapshot(f.first).streams.length, 0);
  f.response(2);
  assert.equal(f.manager.snapshot(f.first).streams.length, 0, 'ignore the previous document response');
  f.response(3, { fromCache: true });
  assert.equal(f.manager.snapshot(f.first).streams.length, 1);
  f.first.emit('did-start-navigation', {} as never, 'https://page.example/next#section', true, true);
  assert.equal(f.manager.snapshot(f.first).streams.length, 1, 'same-document navigation keeps streams');
  f.first.emit('destroyed');
  assert.equal(f.manager.snapshot(f.first).streams.length, 0);
});

test('filenames cannot escape the download folder or use Windows device names', () => {
  assert.equal(hlsFilename('../../CON', 'ts'), '_.._CON.ts');
  assert.equal(hlsFilename('CON', 'ts'), '_CON.ts');
  assert.equal(hlsFilename('Demo: a/b\\c?', 'mp4'), 'Demo_ a_b_c_.mp4');
  assert.ok(hlsFilename('x'.repeat(300), 'ts').length < 150);
});
