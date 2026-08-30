import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

import type { Run, RunEvent } from './api';

const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'breadboard-research-api-'),
);
const stateDirectory = path.join(temporaryRoot, 'state');
const gatewayRequests: http.IncomingMessage[] = [];
const gatewayClosures: Array<Promise<void>> = [];

const gateway = http.createServer((request, response) => {
  gatewayRequests.push(request);
  request.resume();
  gatewayClosures.push(
    new Promise(resolve => {
      response.once('close', resolve);
    }),
  );
  // Intentionally keep the model call open. The abort test proves the run's
  // AbortSignal closes it instead of merely hiding late progress in the API.
});
let api: typeof import('./api');

before(async () => {
  await new Promise<void>(resolve => gateway.listen(0, '127.0.0.1', resolve));
  const gatewayAddress = gateway.address();
  assert.ok(gatewayAddress && typeof gatewayAddress === 'object');

  process.env.DEEP_RESEARCH_STATE_DIR = stateDirectory;
  process.env.DEEP_RESEARCH_SECRET = 'test-loopback-secret';
  process.env.CHATMOCK_BASE_URL = `http://127.0.0.1:${gatewayAddress.port}/v1`;
  process.env.CHATMOCK_MODEL = 'test-model';
  process.env.DEEP_RESEARCH_STEP_TIMEOUT_MS = '30000';

  api = await import('./api');
});

function fixture(overrides: Partial<Run> = {}): Run {
  return {
    runId: 'fixture-run',
    ownerUserId: 7,
    query: 'What changed?',
    userContext: 'private requester profile',
    breadth: 2,
    depth: 1,
    output: 'report',
    status: 'completed',
    createdAt: '2026-08-12T00:00:00.000Z',
    completedAt: '2026-08-12T00:01:00.000Z',
    events: [
      {
        sequenceNumber: 1,
        type: 'run.completed',
        at: '2026-08-12T00:01:00.000Z',
        payload: {},
      },
    ],
    sequence: 1,
    aborted: false,
    learnings: ['Grounded fact [S1]'],
    visitedUrls: ['https://example.com/source'],
    sources: [
      {
        id: 'S1',
        url: 'https://example.com/source',
        query: 'source query',
        retrievedAt: '2026-08-12T00:00:30.000Z',
      },
    ],
    evidence: [
      {
        id: 'E1',
        claim: 'Grounded fact',
        sourceIds: ['S1'],
        query: 'source query',
        depth: 1,
      },
    ],
    warnings: [],
    coverage: {
      totalClaims: 1,
      citedClaims: 1,
      ratio: 1,
      referencedSources: 1,
      totalSources: 1,
      sourceRatio: 1,
    },
    budget: {
      searches: 1,
      modelCalls: 2,
      sources: 1,
      tokens: 15,
      elapsedMs: 1000,
    },
    result: 'Grounded fact [S1]',
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    ...overrides,
  };
}

async function listenApp(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = api.default.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
      ),
  };
}

function authorized(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      authorization: 'Bearer test-loopback-secret',
      'content-type': 'application/json',
      ...init.headers,
    },
  };
}

after(async () => {
  gateway.closeAllConnections();
  await new Promise<void>(resolve => gateway.close(() => resolve()));
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

test('durable snapshots preserve reports and evidence without persisting requester context', () => {
  const directory = path.join(temporaryRoot, 'store-contract');
  const store = new api.DurableRunStore(directory);
  const original = fixture();

  store.persist(original);

  const raw = JSON.parse(
    fs.readFileSync(path.join(directory, `${original.runId}.json`), 'utf8'),
  ) as Record<string, unknown>;
  assert.equal('userContext' in raw, false);
  assert.equal(raw.result, original.result);
  assert.deepEqual(raw.sources, original.sources);
  assert.deepEqual(raw.evidence, original.evidence);
  assert.deepEqual(raw.coverage, original.coverage);
  assert.equal(
    fs.readdirSync(directory).some(name => name.endsWith('.tmp')),
    false,
  );

  const restored = api.restoreRunSnapshot(store.load()[0]);
  assert.ok(restored);
  assert.equal(restored.userContext, '');
  assert.equal(restored.result, original.result);
  assert.deepEqual(restored.events, original.events);
});

test('event history is bounded while sequence numbers remain monotonic', () => {
  const run = fixture({ events: [], sequence: 0 });
  for (let index = 0; index < 2_100; index += 1) {
    api.appendRunEvent(run, 'research.progress', { index });
  }
  assert.equal(run.events.length, 2_000);
  assert.equal(run.sequence, 2_100);
  assert.equal(run.events[0]?.sequenceNumber, 101);
  assert.equal(run.events.at(-1)?.sequenceNumber, 2_100);
});

test('restart recovery exposes prior events and honestly terminates interrupted work', async () => {
  fs.mkdirSync(stateDirectory, { recursive: true });
  const completed = fixture({
    runId: 'completed-run',
    createdAt: new Date(Date.now() - 1_000).toISOString(),
    completedAt: new Date().toISOString(),
  });
  const { userContext: _completedContext, ...safeCompleted } = completed;
  fs.writeFileSync(
    path.join(stateDirectory, 'completed-run.json'),
    JSON.stringify({ schemaVersion: 1, ...safeCompleted }),
  );
  const interrupted = fixture({
    runId: 'interrupted-run',
    status: 'running',
    completedAt: undefined,
    result: undefined,
    events: [
      {
        sequenceNumber: 1,
        type: 'run.started',
        at: '2026-08-12T00:00:00.000Z',
        payload: {},
      },
    ],
    sequence: 1,
  });
  const { userContext: _context, ...safeInterrupted } = interrupted;
  fs.writeFileSync(
    path.join(stateDirectory, 'interrupted-run.json'),
    JSON.stringify({ schemaVersion: 1, ...safeInterrupted }),
  );

  const service = await listenApp();
  try {
    const runResponse = await fetch(
      `${service.baseUrl}/runs/interrupted-run?userId=7`,
      authorized(),
    );
    assert.equal(runResponse.status, 200);
    const body = (await runResponse.json()) as {
      data: {
        status: string;
        failure?: { code: string };
        lastSequence: number;
      };
    };
    assert.equal(body.data.status, 'failed');
    assert.equal(body.data.failure?.code, 'service_restarted');
    assert.equal(body.data.lastSequence, 2);

    const completedResponse = await fetch(
      `${service.baseUrl}/runs/completed-run?userId=7`,
      authorized(),
    );
    assert.equal(completedResponse.status, 200);
    const completedBody = (await completedResponse.json()) as {
      data: {
        status: string;
        result: string;
        sourceCount: number;
        evidenceCount: number;
      };
    };
    assert.equal(completedBody.data.status, 'completed');
    assert.equal(completedBody.data.result, completed.result);
    assert.equal(completedBody.data.sourceCount, 1);
    assert.equal(completedBody.data.evidenceCount, 1);

    const eventsResponse = await fetch(
      `${service.baseUrl}/runs/interrupted-run/events?userId=7&since=0`,
      authorized(),
    );
    const eventsBody = (await eventsResponse.json()) as { data: RunEvent[] };
    assert.deepEqual(
      eventsBody.data.map(event => event.type),
      ['run.started', 'run.failed'],
    );
    assert.equal(eventsBody.data[1]?.payload.error, 'service_restarted');

    const persisted = JSON.parse(
      fs.readFileSync(
        path.join(stateDirectory, 'interrupted-run.json'),
        'utf8',
      ),
    ) as { status: string; failure: { code: string } };
    assert.equal(persisted.status, 'failed');
    assert.equal(persisted.failure.code, 'service_restarted');
  } finally {
    await service.close();
  }
});

test('abort immediately terminalizes a run and cancels its in-flight model request', async () => {
  const service = await listenApp();
  try {
    const createResponse = await fetch(
      `${service.baseUrl}/runs`,
      authorized({
        method: 'POST',
        body: JSON.stringify({
          runId: 'cancelled-run',
          ownerUserId: 7,
          query: 'Research cancellation behavior',
          breadth: 1,
          depth: 1,
          output: 'report',
        }),
      }),
    );
    assert.equal(createResponse.status, 200);

    const requestDeadline = Date.now() + 5_000;
    while (gatewayRequests.length === 0 && Date.now() < requestDeadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(
      gatewayRequests.length,
      1,
      'the planning model request should be in flight',
    );

    const abortResponse = await fetch(
      `${service.baseUrl}/runs/cancelled-run/abort`,
      authorized({ method: 'POST', body: JSON.stringify({ userId: 7 }) }),
    );
    assert.equal(abortResponse.status, 200);
    const aborted = (await abortResponse.json()) as {
      data: { status: string; lastSequence: number };
    };
    assert.equal(aborted.data.status, 'aborted');

    await Promise.race([
      gatewayClosures[0],
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('model request was not cancelled')),
          5_000,
        ),
      ),
    ]);

    const eventsResponse = await fetch(
      `${service.baseUrl}/runs/cancelled-run/events?userId=7&since=0`,
      authorized(),
    );
    const eventsBody = (await eventsResponse.json()) as { data: RunEvent[] };
    assert.equal(
      eventsBody.data.filter(event => event.type === 'run.aborted').length,
      1,
    );
    assert.equal(
      eventsBody.data.some(event => event.type === 'run.failed'),
      false,
    );
  } finally {
    await service.close();
  }
});
