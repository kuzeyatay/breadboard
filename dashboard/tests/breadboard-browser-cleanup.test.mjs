import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-browser-cleanup-'));
process.env.BREADBOARD_DATA_DIR = dataRoot;
const { default: db } = await import('../src/lib/db.ts');
const { beginRuntimeRun, finishRuntimeRun } = await import('../src/lib/hermes/run-store.ts');
db.prepare("INSERT INTO users(id, username, email, password_hash) VALUES (7, 'browser', 'browser@example.test', 'x')").run();
const sessionId = Number(db.prepare(`INSERT INTO hermes_runtime_sessions
  (surface, user_id, agent_name, workspace_key) VALUES ('dashboard_terminal', 7, 'browser', 'cleanup')`).run().lastInsertRowid);
after(() => {
  db.close();
  assert.equal(path.dirname(path.resolve(dataRoot)), path.resolve(os.tmpdir()));
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test('completion, cancellation and error release the exact response browser run without a mounted chat', async () => {
  const calls = [];
  let attempts = 0;
  const server = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${'a'.repeat(64)}`);
    let body = '';
    for await (const chunk of req) body += chunk;
    const value = JSON.parse(body);
    attempts++;
    // Cleanup alone is idempotent and can recover from a transient busy bridge.
    if (attempts === 1) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'busy' }));
    } else {
      calls.push(value);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ released: true }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(path.join(dataRoot, 'breadboard-use.json'), JSON.stringify({
    protocolVersion: 1, port: server.address().port, token: 'a'.repeat(64),
  }));
  try {
    for (const status of ['completed', 'cancelled', 'error']) {
      const run = beginRuntimeRun({ runtimeSessionId: sessionId, instruction: 'Read the first post', dispatch: {} });
      const count = calls.length;
      assert.equal(finishRuntimeRun(run.id, status), true);
      assert.equal(finishRuntimeRun(run.id, status), false);
      const deadline = Date.now() + 5_000;
      while (calls.length === count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      assert.deepEqual(calls[count], { args: { action: 'release_run' }, sessionId: String(sessionId), userId: 7, runId: run.id });
    }
    assert.equal(calls.length, 3);
    assert.equal(attempts, 4);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
