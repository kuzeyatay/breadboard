import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-automation-tabs-'));
process.env.BREADBOARD_DATA_DIR = dataRoot;
const { default: db } = await import('../src/lib/db.ts');
const { beginRuntimeRun, finishRuntimeRun } = await import('../src/lib/hermes/run-store.ts');
const state = globalThis.__automationTabsTest = { db, userId: 7, jobs: new Map() };
for (const id of [7, 8]) db.prepare('INSERT INTO users(id, username, email, password_hash) VALUES (?, ?, ?, ?)').run(id, `user${id}`, `${id}@example.test`, 'x');
const session = userId => Number(db.prepare(`INSERT INTO hermes_runtime_sessions
  (surface, user_id, agent_name, workspace_key) VALUES ('dashboard_terminal', ?, 'browser', ?)`).run(userId, `cleanup-${userId}`).lastInsertRowid);
const ownedSession = session(7), otherSession = session(8);
const stubs = {
  auth: `export class RouteError extends Error { constructor(status,message){super(message);this.status=status;} }
    export async function requireUserId(){const id=globalThis.__automationTabsTest.userId;if(!id)throw new RouteError(401,'Unauthorized');return id;}`,
  db: 'export default globalThis.__automationTabsTest.db;',
  jobs: `export async function isAgentBrowserRunFinished(userId,id){const value=globalThis.__automationTabsTest.jobs.get(id);if(value==='unavailable')throw new Error('offline');return userId===7 && value===true;}`,
};
const bundle = await build({ entryPoints: ['src/app/api/browser/automation-tabs/route.ts'], bundle: true,
  write: false, platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'native-status-fixture', setup(builder) {
    builder.onResolve({ filter: /server-auth$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
    builder.onResolve({ filter: /\/db\.ts$/ }, () => ({ path: 'db', namespace: 'fixture' }));
    builder.onResolve({ filter: /agent-browser\/run-manager\.ts$/ }, () => ({ path: 'jobs', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'js' }));
  }}],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const call = owners => module.exports.POST(new Request('http://localhost/api/browser/automation-tabs', { method: 'POST', body: JSON.stringify({ owners, userId: 8 }) }));
after(() => {
  delete globalThis.__automationTabsTest;
  db.close();
  assert.equal(path.dirname(path.resolve(dataRoot)), path.resolve(os.tmpdir()));
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test('reconciliation recovers missed response releases and scopes every status to its account and exact run', async () => {
  const ended = [];
  for (const status of ['completed', 'cancelled', 'error']) {
    const run = beginRuntimeRun({ runtimeSessionId: ownedSession, instruction: 'inspect a page', dispatch: {} });
    finishRuntimeRun(run.id, status); // No desktop receipt: the initial delivery is missed.
    ended.push(JSON.stringify([String(ownedSession), run.id]));
  }
  const active = beginRuntimeRun({ runtimeSessionId: ownedSession, instruction: 'still working', dispatch: {} });
  const other = beginRuntimeRun({ runtimeSessionId: otherSession, instruction: 'other account', dispatch: {} });
  finishRuntimeRun(other.id, 'completed');
  const job = `job_${'a'.repeat(64)}`, unavailable = `job_${'b'.repeat(64)}`;
  state.jobs.set(job, true); state.jobs.set(unavailable, 'unavailable');
  const response = await call([...ended, ended[0], JSON.stringify([String(ownedSession), active.id]),
    JSON.stringify([String(otherSession), other.id]), JSON.stringify([String(otherSession), active.id]),
    JSON.stringify([String(ownedSession), 'missing']), 'invalid', job, unavailable]);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { finishedOwners: [...ended, job] });
});

test('status endpoint rejects unauthenticated and malformed requests', async () => {
  state.userId = null;
  assert.equal((await call([])).status, 401);
  state.userId = 7;
  for (const owners of [null, {}, [42], ['x'.repeat(1025)], Array(65).fill('owner')]) {
    assert.equal((await call(owners)).status, 400);
  }
});
