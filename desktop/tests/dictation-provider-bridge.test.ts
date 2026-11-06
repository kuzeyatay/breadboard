import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { Readable } from 'node:stream';
import vm from 'node:vm';
import path from 'node:path';
import { WebSocketServer } from 'ws';

test('isolated speech bridge coordinates shared audio, propagates cancellation and closes only its own sessions', { timeout: 15000 }, async () => {
  const { openDictationProviderBridge } = require(path.resolve(__dirname, '../../tests/fixtures/dictation-provider-bridge.cjs'));
  const leases = new Map<string, number>(), deleted: string[] = [];
  let sequence = 0, delayAllocation = false, aborted = false, allocating = false;
  const context = vm.createContext({ Map, AbortController, AbortSignal, Uint8Array, atob,
    BroadcastChannel: class {
      postMessage(value: { id: string; holds: number }) { leases.set(value.id, value.holds); }
      close() {}
    },
    fetch: async (url: string, init: { method: string; signal: AbortSignal }) => {
      if (url === '/api/speech/subscription') {
        assert.equal([...leases.values()].some(holds => holds > 0), true, 'shared focus is claimed before allocation');
        if (delayAllocation) {
          allocating = true;
          await new Promise((_, reject) => init.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true }));
        }
        return Response.json({ id: 'owned-' + ++sequence });
      }
      if (init.method === 'DELETE') { deleted.push(url.split('/').at(-1)!); return Response.json({ ok: true }); }
      return Response.json({ ok: true });
    },
  });
  const socketServer = new WebSocketServer({ noServer: true });
  const server = http.createServer((_req, res) => {
    const address = server.address() as { port: number };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify([{ url: 'http://127.0.0.1:12345/notification-overlay', webSocketDebuggerUrl: `ws://127.0.0.1:${address.port}/bridge` }]));
  });
  server.on('upgrade', (req, socket, head) => socketServer.handleUpgrade(req, socket, head, client => socketServer.emit('connection', client)));
  socketServer.on('connection', client => client.on('message', async data => {
    const message = JSON.parse(data.toString());
    try {
      const value = await vm.runInContext(message.params.expression, context);
      client.send(JSON.stringify({ id: message.id, result: { result: { value } } }));
    } catch (error) {
      client.send(JSON.stringify({ id: message.id, result: { exceptionDetails: { text: String(error) } } }));
    }
  }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const bridge = await openDictationProviderBridge(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
  const request = (url: string, method: string) => Object.assign(Readable.from([]), { url, method, headers: {} });
  try {
    await bridge.setAudioFocus(true);
    await bridge.forward(request('/api/speech/subscription', 'POST'));
    await bridge.setAudioFocus(false);
    assert.deepEqual([...leases.values()], [1], 'allocated connection retains its lease while transcription finishes');
    await bridge.forward(request('/api/speech/subscription/owned-1', 'DELETE'));
    assert.deepEqual([...leases.values()], [0]);
    assert.deepEqual(deleted, ['owned-1']);

    delayAllocation = true;
    const abort = new AbortController();
    const rejected = assert.rejects(bridge.forward(request('/api/speech/subscription', 'POST'), abort.signal), /authenticated speech request failed/);
    while (!allocating) await new Promise(resolve => setTimeout(resolve, 10));
    abort.abort(); await rejected;
    assert.equal(aborted, true, 'cancellation reaches the authenticated upstream fetch');
    assert.deepEqual([...leases.values()], [0]);

    delayAllocation = false;
    await bridge.forward(request('/api/speech/subscription', 'POST'));
    await bridge.close();
    assert.deepEqual(deleted, ['owned-1', 'owned-2'], 'closing the test releases only sessions it allocated');
    assert.deepEqual([...leases.values()], [0]);
    assert.equal(vm.runInContext('globalThis.__breadboardDictationTestBridges.size', context), 0);
  } finally {
    await bridge.close();
    socketServer.clients.forEach(client => client.terminate());
    socketServer.close(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
