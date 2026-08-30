import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

import {
  attachLearnTokenUsageTracking,
  sumLearnTokenUsage,
} from '../src/lib/learn-token-usage.ts';
import {
  ensureLearnTokenUsagePersistenceSchema,
  persistedLearnTokenUsageForJob,
  reconcilePersistedLearnTokenUsageForTerminalJob,
  reconcilePersistedLearnTokenUsageForStaleTerminalJobs,
  recordPersistedLearnTokenUsageEvent,
} from '../src/lib/learn-token-usage-persistence.ts';

function fakeClient(create) {
  return { chat: { completions: { create } } };
}

test('Learn client tracking reports start and normalized provider usage', async () => {
  const events = [];
  const client = fakeClient(async () => ({
    usageEstimated: true,
    usage: {
      prompt_tokens: 120,
      completion_tokens: 30,
      total_tokens: 150,
      prompt_tokens_details: { cached_tokens: 80 },
      completion_tokens_details: { reasoning_tokens: 12 },
    },
  }));

  attachLearnTokenUsageTracking(client, (event) => events.push(event));
  await client.chat.completions.create({ model: 'gpt-5.6-sol' });

  assert.deepEqual(events, [
    { type: 'started' },
    {
      type: 'completed',
      usage: {
        inputTokens: 120,
        outputTokens: 30,
        totalTokens: 150,
        cachedInputTokens: 80,
        reasoningTokens: 12,
        estimated: true,
      },
    },
  ]);
});

test('Learn client tracking emits the exact durable request binding on both events', async () => {
  const events = [];
  const client = fakeClient(async () => ({
    usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
  }));
  const requestIdentity = {
    clientRequestId: 'lrq_tracked_exact_request_0001',
    clientRequestHash: 'a'.repeat(64),
  };

  attachLearnTokenUsageTracking(client, (event) => events.push(event), {
    completionRequestOverrides: {
      reasoning: { effort: 'max', summary: 'detailed' },
    },
  });
  await client.chat.completions.create({
    model: 'gpt-5.6-sol',
    ...requestIdentity,
  });

  assert.deepEqual(events.map((event) => event.requestIdentity), [
    requestIdentity,
    requestIdentity,
  ]);
  assert.strictEqual(events[0].requestIdentity, events[1].requestIdentity);
  assert.throws(() => {
    events[0].requestIdentity.clientRequestId = 'changed';
  }, TypeError);
});

test('Learn workflow usage accumulates planning and generation jobs', () => {
  const usage = sumLearnTokenUsage([
    {
      inputTokens: 153_131,
      outputTokens: 30_046,
      totalTokens: 183_177,
      cachedInputTokens: 120_000,
      reasoningTokens: 10_000,
      estimated: false,
      startedCalls: 20,
      completedCalls: 20,
      reportedCalls: 20,
      unreportedCalls: 0,
      inFlightCalls: 0,
      requestPolicy: {
        model: 'gpt-5.6-sol',
        reasoningEffort: 'max',
        reasoningSummary: 'detailed',
        observedCalls: 20,
        consistent: true,
      },
    },
    {
      inputTokens: 94_901,
      outputTokens: 14_976,
      totalTokens: 109_877,
      cachedInputTokens: 80_000,
      reasoningTokens: 5_000,
      estimated: true,
      startedCalls: 10,
      completedCalls: 9,
      reportedCalls: 9,
      unreportedCalls: 0,
      inFlightCalls: 1,
      requestPolicy: {
        model: 'gpt-5.6-sol',
        reasoningEffort: 'max',
        reasoningSummary: 'detailed',
        observedCalls: 10,
        consistent: true,
      },
    },
  ]);

  assert.equal(usage.totalTokens, 293_054);
  assert.equal(usage.inputTokens, 248_032);
  assert.equal(usage.outputTokens, 45_022);
  assert.equal(usage.startedCalls, 30);
  assert.equal(usage.reportedCalls, 29);
  assert.equal(usage.inFlightCalls, 1);
  assert.equal(usage.estimated, true);
  assert.deepEqual(usage.requestPolicy, {
    model: 'gpt-5.6-sol',
    reasoningEffort: 'max',
    reasoningSummary: 'detailed',
    observedCalls: 30,
    consistent: true,
  });
});

test('Learn workflow policy aggregation fails closed on a cross-job mismatch', () => {
  const baseUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    estimated: false,
    startedCalls: 1,
    completedCalls: 1,
    reportedCalls: 1,
    unreportedCalls: 0,
    inFlightCalls: 0,
  };
  const usage = sumLearnTokenUsage([
    {
      ...baseUsage,
      requestPolicy: {
        model: 'gpt-5.6-sol',
        reasoningEffort: 'max',
        reasoningSummary: 'detailed',
        observedCalls: 4,
        consistent: true,
      },
    },
    {
      ...baseUsage,
      requestPolicy: {
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
        reasoningSummary: 'detailed',
        observedCalls: 2,
        consistent: true,
      },
    },
  ]);

  assert.deepEqual(usage.requestPolicy, {
    model: 'gpt-5.6-sol',
    reasoningEffort: 'max',
    reasoningSummary: 'detailed',
    observedCalls: 6,
    consistent: false,
  });
});

test('Learn client tracking marks missing and failed usage as unreported', async () => {
  const missingEvents = [];
  const missingClient = fakeClient(async () => ({ choices: [] }));
  attachLearnTokenUsageTracking(missingClient, (event) => missingEvents.push(event));
  await missingClient.chat.completions.create({});
  assert.deepEqual(missingEvents, [
    { type: 'started' },
    { type: 'completed', usage: null },
  ]);

  const failedEvents = [];
  const failedClient = fakeClient(async () => {
    throw new Error('upstream failed');
  });
  attachLearnTokenUsageTracking(failedClient, (event) => failedEvents.push(event));
  await assert.rejects(() => failedClient.chat.completions.create({}), /upstream failed/);
  assert.deepEqual(failedEvents, [
    { type: 'started' },
    { type: 'completed', usage: null },
  ]);
});

test('reattaching one Learn client changes jobs without stacking counters', async () => {
  const firstJobEvents = [];
  const secondJobEvents = [];
  const client = fakeClient(async () => ({
    usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
  }));

  attachLearnTokenUsageTracking(client, (event) => firstJobEvents.push(event));
  attachLearnTokenUsageTracking(client, (event) => secondJobEvents.push(event));
  await client.chat.completions.create({});

  assert.deepEqual(firstJobEvents, []);
  assert.equal(secondJobEvents.length, 2);
});

test('Learn request policy authoritatively and immutably overrides reasoning', async () => {
  const events = [];
  const requests = [];
  const client = fakeClient(async (request) => {
    requests.push(request);
    return { usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 } };
  });
  const originalRequest = {
    model: 'selected-model',
    reasoning: { effort: 'low', summary: 'none' },
    messages: [{ role: 'user', content: 'Explain the relationship.' }],
  };
  const originalSnapshot = structuredClone(originalRequest);
  const requestPolicy = {
    reasoning: { effort: 'max', summary: 'detailed' },
    councilModeOverride: 'direct_council',
    learnStrictRoute: true,
  };

  attachLearnTokenUsageTracking(client, (event) => events.push(event), {
    completionRequestOverrides: requestPolicy,
  });
  requestPolicy.reasoning.effort = 'low';
  await client.chat.completions.create(originalRequest);

  assert.deepEqual(originalRequest, originalSnapshot);
  assert.notStrictEqual(requests[0], originalRequest);
  assert.deepEqual(requests[0], {
    ...originalSnapshot,
    reasoning: { effort: 'max', summary: 'detailed' },
    councilModeOverride: 'direct_council',
    learnStrictRoute: true,
  });
  assert.deepEqual(
    events.map((event) => event.requestEvidence),
    [
      {
        model: 'selected-model',
        reasoningEffort: 'max',
        reasoningSummary: 'detailed',
      },
      {
        model: 'selected-model',
        reasoningEffort: 'max',
        reasoningSummary: 'detailed',
      },
    ],
  );
  assert.strictEqual(events[0].requestEvidence, events[1].requestEvidence);
});

test('Learn request evidence is bounded and excludes arbitrary request data', async () => {
  const events = [];
  const client = fakeClient(async () => ({
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  }));
  const secret = 'must-never-appear-in-usage-telemetry';

  attachLearnTokenUsageTracking(client, (event) => events.push(event), {
    completionRequestOverrides: {
      reasoning: {
        effort: `max-${'e'.repeat(80)}`,
        summary: `detailed-${'s'.repeat(80)}`,
        hiddenPrompt: secret,
      },
    },
  });
  await client.chat.completions.create({
    model: `provider/model-${'m'.repeat(160)}`,
    messages: [{ role: 'user', content: secret }],
    headers: { authorization: secret },
    apiKey: secret,
  });

  const evidence = events[0].requestEvidence;
  assert.deepEqual(Object.keys(evidence).sort(), [
    'model',
    'reasoningEffort',
    'reasoningSummary',
  ]);
  assert.equal(evidence.model.length, 128);
  assert.equal(evidence.reasoningEffort.length, 32);
  assert.equal(evidence.reasoningSummary.length, 32);
  assert.doesNotMatch(JSON.stringify(events), new RegExp(secret));
  assert.strictEqual(events[0].requestEvidence, events[1].requestEvidence);
  assert.throws(() => {
    events[0].requestEvidence.reasoningEffort = 'low';
  }, TypeError);
});

test('failed Learn requests retain their effective policy evidence', async () => {
  const events = [];
  const client = fakeClient(async () => {
    throw new Error('provider unavailable');
  });

  attachLearnTokenUsageTracking(client, (event) => events.push(event), {
    completionRequestOverrides: {
      reasoning: { effort: 'max', summary: 'detailed' },
    },
  });
  await assert.rejects(
    () => client.chat.completions.create({ model: 'selected-model' }),
    /provider unavailable/,
  );

  assert.deepEqual(events.map((event) => event.requestEvidence), [
    {
      model: 'selected-model',
      reasoningEffort: 'max',
      reasoningSummary: 'detailed',
    },
    {
      model: 'selected-model',
      reasoningEffort: 'max',
      reasoningSummary: 'detailed',
    },
  ]);
  assert.equal(events[1].usage, null);
});

test('Learn request policy is pinned on a single-shot exact-refusal failure', async () => {
  const events = [];
  const requests = [];
  const exactFailure = Object.assign(
    new Error('listener refused request after proxy lifecycle change'),
    { code: 'ECONNREFUSED' },
  );
  const client = fakeClient(async (request) => {
    requests.push(request);
    throw exactFailure;
  });

  let healthVerifications = 0;
  attachLearnTokenUsageTracking(client, (event) => events.push(event), {
    completionRequestOverrides: {
      reasoning: { effort: 'max', summary: 'detailed' },
    },
    retryTransport: {
      verifyConnectionRecovery: async () => {
        healthVerifications += 1;
        return {
          id: 'must-not-authorize-model-replay',
          evidence: 'chatmock_model_health_200_after_downstream_refusal',
        };
      },
    },
  });
  await assert.rejects(
    () => client.chat.completions.create({
      model: 'selected-model',
      reasoning: { effort: 'low', summary: 'none' },
    }),
    (error) => error === exactFailure,
  );

  assert.equal(requests.length, 1);
  assert.equal(healthVerifications, 0);
  assert.deepEqual(requests[0].reasoning, {
    effort: 'max',
    summary: 'detailed',
  });
  assert.deepEqual(events.map((event) => event.requestEvidence), [
    {
      model: 'selected-model',
      reasoningEffort: 'max',
      reasoningSummary: 'detailed',
    },
    {
      model: 'selected-model',
      reasoningEffort: 'max',
      reasoningSummary: 'detailed',
    },
  ]);
  assert.equal(events[1].usage, null);
});

test('reattachment replaces or clears the completion request policy', async () => {
  const events = [];
  const requests = [];
  const client = fakeClient(async (request) => {
    requests.push(request);
    return { usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 } };
  });

  attachLearnTokenUsageTracking(client, (event) => events.push(event), {
    completionRequestOverrides: {
      reasoning: { effort: 'high', summary: 'concise' },
    },
  });
  await client.chat.completions.create({ reasoning: { effort: 'low' } });

  attachLearnTokenUsageTracking(client, (event) => events.push(event), {
    completionRequestOverrides: {
      reasoning: { effort: 'max', summary: 'detailed' },
    },
  });
  await client.chat.completions.create({ reasoning: { effort: 'low' } });

  // The wrapper is also shared by ingestion. Reattaching without a Learn
  // policy must clear the previous override instead of leaking it.
  attachLearnTokenUsageTracking(client, (event) => events.push(event));
  await client.chat.completions.create({ reasoning: { effort: 'low' } });

  assert.deepEqual(
    requests.map((request) => request.reasoning),
    [
      { effort: 'high', summary: 'concise' },
      { effort: 'max', summary: 'detailed' },
      { effort: 'low' },
    ],
  );
  assert.equal(events.length, 6);
  assert.ok(events.slice(0, 4).every((event) => event.requestEvidence));
  assert.ok(events.slice(4).every((event) => !('requestEvidence' in event)));
});

test('an in-flight Learn call stays attributed to the job where it started', async () => {
  const firstJobEvents = [];
  const secondJobEvents = [];
  let resolveRequest;
  const client = fakeClient(
    () =>
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
  );

  attachLearnTokenUsageTracking(client, (event) => firstJobEvents.push(event));
  const request = client.chat.completions.create({});
  attachLearnTokenUsageTracking(client, (event) => secondJobEvents.push(event));
  resolveRequest({ usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 } });
  await request;

  assert.deepEqual(firstJobEvents.map((event) => event.type), ['started', 'completed']);
  assert.deepEqual(secondJobEvents, []);
});

test('concurrent Learn calls report every in-flight and completed request', async () => {
  const events = [];
  const resolvers = [];
  const client = fakeClient(
    () =>
      new Promise((resolve) => {
        resolvers.push(resolve);
      }),
  );

  attachLearnTokenUsageTracking(client, (event) => events.push(event));
  const first = client.chat.completions.create({});
  const second = client.chat.completions.create({});

  assert.equal(events.filter((event) => event.type === 'started').length, 2);
  assert.equal(events.filter((event) => event.type === 'completed').length, 0);

  for (const resolve of resolvers) {
    resolve({ usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } });
  }
  await Promise.all([first, second]);

  assert.equal(events.filter((event) => event.type === 'completed').length, 2);
});

test('terminal recovery closes abandoned request lifecycles without fabricating usage', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-terminal-usage-'));
  const databasePath = path.join(root, 'learn.db');
  const exactError = 'worker exited after dispatch: generic sentinel error';
  const terminalAt = '2026-08-24T04:34:33.715Z';
  let database = new Database(databasePath);
  try {
    database.exec(`
      CREATE TABLE learn_jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        error TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE learn_job_token_usage (
        job_id TEXT PRIMARY KEY,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        started_requests INTEGER NOT NULL DEFAULT 0,
        completed_requests INTEGER NOT NULL DEFAULT 0,
        reported_requests INTEGER NOT NULL DEFAULT 0,
        estimated_requests INTEGER NOT NULL DEFAULT 0,
        request_model TEXT,
        reasoning_effort TEXT,
        reasoning_summary TEXT,
        policy_observed_requests INTEGER NOT NULL DEFAULT 0,
        policy_mismatch_requests INTEGER NOT NULL DEFAULT 0,
        usage_updated_at TEXT
      );
    `);
    database.prepare(
      'INSERT INTO learn_jobs (id, status, error, updated_at) VALUES (?, ?, ?, ?)',
    ).run('generic-abandoned-job', 'failed', exactError, terminalAt);
    database.prepare(
      `INSERT INTO learn_job_token_usage (
         job_id, input_tokens, output_tokens, total_tokens,
         cached_input_tokens, reasoning_tokens,
         started_requests, completed_requests, reported_requests,
         estimated_requests, request_model, reasoning_effort,
         reasoning_summary, policy_observed_requests,
         policy_mismatch_requests, usage_updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'generic-abandoned-job',
      120,
      30,
      150,
      80,
      12,
      4,
      2,
      2,
      0,
      'gpt-5.6-sol',
      'max',
      'detailed',
      4,
      0,
      '2026-08-24T02:58:14.711Z',
    );

    assert.equal(
      reconcilePersistedLearnTokenUsageForTerminalJob(
        database,
        'generic-abandoned-job',
        terminalAt,
      ),
      1,
    );
    assert.deepEqual(
      persistedLearnTokenUsageForJob(database, 'generic-abandoned-job'),
      {
        inputTokens: 120,
        outputTokens: 30,
        totalTokens: 150,
        cachedInputTokens: 80,
        reasoningTokens: 12,
        estimated: false,
        startedCalls: 4,
        completedCalls: 4,
        reportedCalls: 2,
        unreportedCalls: 2,
        inFlightCalls: 0,
        requestPolicy: {
          model: 'gpt-5.6-sol',
          reasoningEffort: 'max',
          reasoningSummary: 'detailed',
          observedCalls: 4,
          consistent: true,
        },
      },
    );
    assert.equal(
      database.prepare('SELECT error FROM learn_jobs WHERE id = ?')
        .get('generic-abandoned-job').error,
      exactError,
    );

    assert.equal(
      reconcilePersistedLearnTokenUsageForTerminalJob(
        database,
        'generic-abandoned-job',
        '2026-08-24T04:35:00.000Z',
      ),
      0,
      'a repeated recovery sweep must not count or rewrite anything again',
    );
    assert.equal(
      database.prepare(
        'SELECT usage_updated_at FROM learn_job_token_usage WHERE job_id = ?',
      ).get('generic-abandoned-job').usage_updated_at,
      terminalAt,
    );

    database.exec(`
      INSERT INTO learn_jobs (id, status, error, updated_at) VALUES
        ('old-failed', 'failed', 'exact failed error', '2026-08-24T01:00:00.000Z'),
        ('old-cancelled', 'cancelled', 'exact cancel error', '2026-08-24T01:00:00.000Z'),
        ('old-complete', 'complete', 'exact complete note', '2026-08-24T01:00:00.000Z'),
        ('old-awaiting', 'awaiting_confirmation', 'must stay open', '2026-08-24T01:00:00.000Z'),
        ('recent-failed', 'failed', 'worker may still unwind', '2026-08-24T03:01:00.000Z');
      INSERT INTO learn_job_token_usage (
        job_id, total_tokens, started_requests, completed_requests,
        reported_requests, usage_updated_at
      ) VALUES
        ('old-failed', 11, 2, 1, 1, '2026-08-24T01:00:00.000Z'),
        ('old-cancelled', 12, 2, 1, 1, '2026-08-24T01:00:00.000Z'),
        ('old-complete', 13, 2, 1, 1, '2026-08-24T01:00:00.000Z'),
        ('old-awaiting', 14, 2, 1, 1, '2026-08-24T01:00:00.000Z'),
        ('recent-failed', 15, 2, 1, 1, '2026-08-24T03:01:00.000Z');
    `);
    assert.deepEqual(
      reconcilePersistedLearnTokenUsageForStaleTerminalJobs(
        database,
        '2026-08-24T03:00:00.000Z',
        '2026-08-24T04:00:00.000Z',
      ).sort(),
      ['old-cancelled', 'old-complete', 'old-failed'],
    );
    for (const [jobId, totalTokens] of [
      ['old-failed', 11],
      ['old-cancelled', 12],
      ['old-complete', 13],
    ]) {
      const usage = persistedLearnTokenUsageForJob(database, jobId);
      assert.equal(usage.inFlightCalls, 0, jobId);
      assert.equal(usage.unreportedCalls, 1, jobId);
      assert.equal(usage.totalTokens, totalTokens, jobId);
      assert.equal(usage.estimated, false, jobId);
    }
    assert.equal(
      persistedLearnTokenUsageForJob(database, 'old-awaiting').inFlightCalls,
      1,
    );
    assert.equal(
      persistedLearnTokenUsageForJob(database, 'recent-failed').inFlightCalls,
      1,
    );
    assert.deepEqual(
      database.prepare(
        `SELECT id, error FROM learn_jobs
         WHERE id LIKE 'old-%' ORDER BY id`,
      ).all(),
      [
        { id: 'old-awaiting', error: 'must stay open' },
        { id: 'old-cancelled', error: 'exact cancel error' },
        { id: 'old-complete', error: 'exact complete note' },
        { id: 'old-failed', error: 'exact failed error' },
      ],
    );
    assert.deepEqual(
      reconcilePersistedLearnTokenUsageForStaleTerminalJobs(
        database,
        '2026-08-24T03:00:00.000Z',
        '2026-08-24T04:01:00.000Z',
      ),
      [],
    );

    database.close();
    database = new Database(databasePath, { readonly: true });
    const reopened = persistedLearnTokenUsageForJob(
      database,
      'generic-abandoned-job',
    );
    assert.equal(reopened.inFlightCalls, 0);
    assert.equal(reopened.unreportedCalls, 2);
    assert.equal(reopened.totalTokens, 150);
    assert.equal(
      database.prepare('SELECT error FROM learn_jobs WHERE id = ?')
        .get('generic-abandoned-job').error,
      exactError,
    );
  } finally {
    if (database.open) database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Learn policy receipts migrate legacy rows and survive database reopen', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-policy-receipt-'));
  const databasePath = path.join(root, 'learn.db');
  let database = new Database(databasePath);
  try {
    database.exec(`
      CREATE TABLE learn_job_token_usage (
        job_id TEXT PRIMARY KEY,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        started_requests INTEGER NOT NULL DEFAULT 0,
        completed_requests INTEGER NOT NULL DEFAULT 0,
        reported_requests INTEGER NOT NULL DEFAULT 0,
        estimated_requests INTEGER NOT NULL DEFAULT 0,
        usage_updated_at TEXT
      );
      INSERT INTO learn_job_token_usage (
        job_id, input_tokens, output_tokens, total_tokens,
        started_requests, completed_requests, reported_requests
      ) VALUES ('legacy-job', 10, 5, 15, 1, 1, 1);
    `);

    ensureLearnTokenUsagePersistenceSchema(database);
    const columns = new Set(
      database.prepare('PRAGMA table_info(learn_job_token_usage)').all()
        .map((column) => column.name),
    );
    for (const column of [
      'request_model',
      'reasoning_effort',
      'reasoning_summary',
      'policy_observed_requests',
      'policy_mismatch_requests',
    ]) {
      assert.ok(columns.has(column), `missing migrated column ${column}`);
    }
    assert.equal(
      persistedLearnTokenUsageForJob(database, 'legacy-job').requestPolicy,
      undefined,
    );
    recordPersistedLearnTokenUsageEvent(
      database,
      'incomplete-policy-job',
      {
        type: 'started',
        requestEvidence: {
          model: null,
          reasoningEffort: 'max',
          reasoningSummary: 'detailed',
        },
      },
      '2026-08-23T23:59:59.000Z',
    );
    assert.equal(
      persistedLearnTokenUsageForJob(database, 'incomplete-policy-job')
        .requestPolicy.consistent,
      false,
    );

    const secret = 'prompt-header-api-key-must-not-persist';
    const longModel = `provider/model-${'m'.repeat(160)}`;
    recordPersistedLearnTokenUsageEvent(
      database,
      'legacy-job',
      {
        type: 'started',
        requestEvidence: {
          model: longModel,
          reasoningEffort: 'max',
          reasoningSummary: 'detailed',
          hiddenPrompt: secret,
          headers: { authorization: secret },
        },
      },
      '2026-08-24T00:00:00.000Z',
    );
    recordPersistedLearnTokenUsageEvent(
      database,
      'legacy-job',
      {
        type: 'completed',
        usage: {
          inputTokens: 4,
          outputTokens: 2,
          totalTokens: 6,
          cachedInputTokens: 1,
          reasoningTokens: 1,
          estimated: false,
        },
      },
      '2026-08-24T00:00:01.000Z',
    );

    database.close();
    database = new Database(databasePath);
    const reopened = persistedLearnTokenUsageForJob(database, 'legacy-job');
    assert.equal(reopened.totalTokens, 21);
    assert.deepEqual(reopened.requestPolicy, {
      model: longModel.slice(0, 128),
      reasoningEffort: 'max',
      reasoningSummary: 'detailed',
      observedCalls: 1,
      consistent: true,
    });
    const raw = database.prepare(
      'SELECT * FROM learn_job_token_usage WHERE job_id = ?',
    ).get('legacy-job');
    assert.doesNotMatch(JSON.stringify(raw), new RegExp(secret));

    recordPersistedLearnTokenUsageEvent(
      database,
      'legacy-job',
      {
        type: 'started',
        requestEvidence: {
          model: longModel,
          reasoningEffort: 'max',
          reasoningSummary: 'detailed',
        },
      },
      '2026-08-24T00:00:02.000Z',
    );
    recordPersistedLearnTokenUsageEvent(
      database,
      'legacy-job',
      {
        type: 'started',
        requestEvidence: {
          model: longModel,
          reasoningEffort: 'low',
          reasoningSummary: 'detailed',
        },
      },
      '2026-08-24T00:00:03.000Z',
    );
    assert.deepEqual(
      persistedLearnTokenUsageForJob(database, 'legacy-job').requestPolicy,
      {
        model: longModel.slice(0, 128),
        reasoningEffort: 'max',
        reasoningSummary: 'detailed',
        observedCalls: 3,
        consistent: false,
      },
    );
  } finally {
    if (database.open) database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Learn persistence uses a job-scoped atomic usage table', () => {
  const source = fs.readFileSync(new URL('../src/lib/learn.ts', import.meta.url), 'utf8');
  const projection = fs.readFileSync(
    new URL('../src/lib/learn-status-projection.ts', import.meta.url),
    'utf8',
  );
  const persistence = fs.readFileSync(
    new URL('../src/lib/learn-token-usage-persistence.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /CREATE TABLE IF NOT EXISTS learn_job_token_usage/);
  assert.match(source, /model\s+TEXT NOT NULL DEFAULT 'gpt-5\.6-sol'/);
  assert.match(source, /model: row\.model\?\.trim\(\) \|\| LEARN_MODEL/);
  assert.match(source, /ensureLearnTokenUsagePersistenceSchema\(db\)/);
  assert.match(source, /policy_observed_requests INTEGER NOT NULL DEFAULT 0/);
  assert.match(source, /policy_mismatch_requests INTEGER NOT NULL DEFAULT 0/);
  assert.match(persistence, /started_requests = started_requests \+ 1/);
  assert.match(persistence, /completed_requests = completed_requests \+ 1/);
  assert.match(persistence, /input_tokens = input_tokens \+ \?/);
  assert.match(persistence, /policy_observed_requests = policy_observed_requests \+ 1/);
  assert.match(persistence, /policy_mismatch_requests = policy_mismatch_requests \+ CASE/);
  assert.match(persistence, /persistedLearnTokenUsageForJob/);
  assert.doesNotMatch(persistence, /messages|headers|apiKey|authorization/);
  assert.match(source, /tokenUsage: learnTokenUsageForJob\(row\.id\)/);
  assert.match(projection, /function learnTokenUsageForWorkflow/);
  assert.match(projection, /SELECT garden_id, job_id FROM learn_maps WHERE id = \?/);
  assert.match(projection, /tokenUsage: learnTokenUsageForWorkflow\(visibleJob\)/);
  assert.doesNotMatch(
    source.match(/function recordLearnTokenUsageEvent[\s\S]*?\n\}/)?.[0] ?? '',
    /learn_jobs[\s\S]*updated_at/,
  );
});

test('Learn panel renders live job usage without Council activity', () => {
  const source = fs.readFileSync(
    new URL('../src/app/gardens/[clusterSlug]/workspace-client.tsx', import.meta.url),
    'utf8',
  );
  const usagePanelIndex = source.indexOf('aria-label="Learn token usage"');
  const councilActivityIndex = source.indexOf('Council activity');
  const nextPanelSectionIndex = source.indexOf(
    '{panelExpanded &&',
    usagePanelIndex,
  );
  const usagePanelSource = source.slice(usagePanelIndex, nextPanelSectionIndex);

  assert.ok(usagePanelIndex >= 0, 'Learn token usage panel should be rendered');
  assert.equal(councilActivityIndex, -1, 'Council activity should not be rendered');
  assert.ok(nextPanelSectionIndex > usagePanelIndex, 'usage panel should remain in the Learn panel');
  assert.match(source, /label: "Input"/);
  assert.match(source, /label: "Output"/);
  assert.match(source, /label: "Reasoning"/);
  assert.match(source, /label: "Total"/);
  assert.doesNotMatch(
    usagePanelSource,
    /inFlightCalls|unreportedCalls|learnUsageCallSummary/,
    "call availability internals should not appear in the token row",
  );
  assert.match(source, /Waiting for usage/);
  assert.match(
    source,
    /const learnPanelModel = active \? \(job\?\.model \?\? model\) : model/,
  );
  assert.match(
    source,
    /\{learnPanelModel \? \([\s\S]*?<span className="text-gray-600">Model:<\/span>[\s\S]*?<span[\s\S]*?className="font-mono tabular-nums text-gray-200"[\s\S]*?formatAssistantModelName\(learnPanelModel\)/,
  );
  assert.ok(
    usagePanelSource.indexOf("{learnPanelModel ? (") >
      usagePanelSource.lastIndexOf("Waiting for usage"),
    "the next-run model must remain visible before the first token-usage call",
  );
  assert.match(
    usagePanelSource,
    /metric\.label === "Total"[\s\S]*?formatLearnTotalTokenCount\(metric\.value\)/,
  );
  assert.match(
    source,
    /function formatLearnTotalTokenCount[\s\S]*?count >= 1_000_000[\s\S]*?formatTokenCount\(count\)[\s\S]*?toFixed\(1\)[\s\S]*?k/,
  );
  assert.match(
    usagePanelSource,
    /formatLearnMetricTokenCount\(metric\.value\)/,
  );
  assert.match(
    source,
    /function formatLearnMetricTokenCount[\s\S]*?replace\(\/K\$\/, "k"\)/,
  );
  assert.doesNotMatch(usagePanelSource, /\.toLowerCase\(\)/);
  assert.doesNotMatch(source, /Cached input unavailable/);
  assert.doesNotMatch(source, /Generated across Learn/);
  assert.doesNotMatch(source, /Provider-reported total/);
  assert.doesNotMatch(source, /const statusLabel =/);
  assert.doesNotMatch(source, /const learnUsageBadge =/);
  assert.doesNotMatch(usagePanelSource, /role="status"/);
});
