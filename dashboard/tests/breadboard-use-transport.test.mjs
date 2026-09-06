import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import test from 'node:test';
register('./teach-support/server-only-stub.mjs', import.meta.url);
const { useBreadboard } = await import('../src/lib/hermes/breadboard-use.ts');
const { describeError } = await import('../src/lib/hermes/route-core.ts');

test('browser recovery errors reach the agent through the real transport and route error policy', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-use-transport-'));
  const previousData = process.env.BREADBOARD_DATA_DIR;
  const token = 'a'.repeat(64);
  let reply = { status: 400, body: { error: "Activate this target's tab before inspecting or interacting with it." } };
  let calls = 0;
  const server = http.createServer(async (req, res) => {
    calls++;
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    let body = '';
    for await (const chunk of req) body += chunk;
    assert.deepEqual(JSON.parse(body), { args: { action: 'snapshot', targetId: 9 }, sessionId: 'session', userId: 7 });
    res.writeHead(reply.status, { 'Content-Type': 'application/json', Connection: 'close' });
    res.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.BREADBOARD_DATA_DIR = dir;
  const receipt = path.join(dir, 'breadboard-use.json');
  const call = async () => {
    try { return await useBreadboard({ action: 'snapshot', targetId: 9 }, 'session', 7); }
    catch (error) { return describeError(error); }
  };
  try {
    assert.equal((await call()).status, 503);
    fs.writeFileSync(receipt, 'null');
    assert.equal((await call()).status, 503);
    fs.writeFileSync(receipt, JSON.stringify({ protocolVersion: 1, port: server.address().port, token }));
    for (const [status, error] of [
      [400, "Activate this target's tab before inspecting or interacting with it."],
      [400, 'The page is loading. Read state again before interacting.'],
      [400, 'Snapshot expired. Take another snapshot before acting.'],
      [403, 'The desktop app is signed into a different account.'],
      [409, 'Another Breadboard action is running. Read fresh state and retry.'],
    ]) {
      reply = { status, body: { error } };
      assert.deepEqual(await call(), { status, body: { error } });
    }
    assert.equal(calls, 5, 'transport must not replay actions automatically');
    reply = { status: 200, body: { snapshotId: 'fresh', elements: [{ ref: 'e1', name: 'SAT SCORE' }] } };
    assert.deepEqual(await call(), reply.body);
    reply = { status: 400, body: null };
    assert.equal((await call()).status, 400);
    reply = { status: 502, body: 'private stack trace or invalid response' };
    assert.deepEqual(await call(), { status: 502, body: { error: 'Breadboard returned an invalid response. Read fresh state before retrying.' } });
    await new Promise(resolve => server.close(resolve));
    const unavailable = await call();
    assert.equal(unavailable.status, 503);
    assert.ok(!JSON.stringify(unavailable).includes(token));
    assert.ok(!JSON.stringify(unavailable).includes(dir));
  } finally {
    if (previousData === undefined) delete process.env.BREADBOARD_DATA_DIR;
    else process.env.BREADBOARD_DATA_DIR = previousData;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
