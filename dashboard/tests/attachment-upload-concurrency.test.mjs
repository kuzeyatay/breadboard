import assert from 'node:assert/strict';
import test from 'node:test';
import { extractChatAttachments } from '../src/lib/chat-attachments.ts';

test('file uploads run with bounded concurrency and retain selection order, warnings and failures', async t => {
  const pending = new Map();
  const started = [];
  let active = 0, peak = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const name = options.body.get('file').name;
    started.push(name);
    peak = Math.max(peak, ++active);
    return new Promise(resolve => pending.set(name, () => {
      active--;
      resolve(name === '3.png'
        ? Response.json({ error: 'reader unavailable' }, { status: 503 })
        : Response.json({ type: 'image', dataUrl: 'data:image/png;base64,AA==', warning: name === '1.png' ? 'partial reading' : undefined }));
    }));
  });
  const statuses = [];
  const result = extractChatAttachments(Array.from({ length: 5 }, (_, i) => new File(['image'], `${i}.png`)), {
    onStatus: status => statuses.push(status),
  });
  const tick = () => new Promise(resolve => setImmediate(resolve));
  await tick();
  assert.deepEqual(started, ['0.png', '1.png', '2.png']);
  pending.get('1.png')(); await tick();
  assert.deepEqual(started, ['0.png', '1.png', '2.png', '3.png']);
  pending.get('2.png')(); await tick();
  assert.equal(started.length, 5);
  pending.get('4.png')(); pending.get('3.png')(); pending.get('0.png')();
  const prepared = await result;
  assert.equal(peak, 3);
  assert.deepEqual(prepared.attachments.map(file => file.name), ['0.png', '1.png', '2.png', '4.png']);
  assert.deepEqual(prepared.errors, ['3.png: reader unavailable']);
  assert.deepEqual(prepared.warnings, ['1.png: partial reading']);
  assert.equal(statuses.at(-1), '');
});
