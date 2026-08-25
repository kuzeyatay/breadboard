import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

import {
  discardPersistedLearnTokenUsageForProvenMissingReceipt,
  ensureLearnTokenUsagePersistenceSchema,
  persistedLearnTokenUsageForJob,
  reconcilePersistedLearnTokenUsageFromReceipt,
  recordPersistedLearnTokenUsageEvent,
} from '../src/lib/learn-token-usage-persistence.ts';

function openUsageDatabase(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const databasePath = path.join(root, 'learn.db');
  const database = new Database(databasePath);
  database.pragma('foreign_keys = ON');
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
  `);
  ensureLearnTokenUsagePersistenceSchema(database);
  return { root, databasePath, database };
}

const exactUsage = Object.freeze({
  inputTokens: 101,
  outputTokens: 29,
  totalTokens: 130,
  cachedInputTokens: 17,
  reasoningTokens: 11,
});

const failedGenerationUsage = Object.freeze({
  inputTokens: 41,
  outputTokens: 9,
  totalTokens: 50,
  cachedInputTokens: 3,
  reasoningTokens: 4,
});

const twoGenerationUsage = Object.freeze({
  inputTokens: exactUsage.inputTokens + failedGenerationUsage.inputTokens,
  outputTokens: exactUsage.outputTokens + failedGenerationUsage.outputTokens,
  totalTokens: exactUsage.totalTokens + failedGenerationUsage.totalTokens,
  cachedInputTokens:
    exactUsage.cachedInputTokens + failedGenerationUsage.cachedInputTokens,
  reasoningTokens:
    exactUsage.reasoningTokens + failedGenerationUsage.reasoningTokens,
});

const exactPolicy = Object.freeze({
  model: 'provider/exact-model',
  reasoningEffort: 'max',
  reasoningSummary: 'detailed',
});

function recordTrackedDispatch(
  database,
  jobId,
  httpCompletionObserved,
  binding = receipt(),
) {
  const requestIdentity = {
    clientRequestId: binding.receiptId,
    clientRequestHash: binding.requestHash,
  };
  recordPersistedLearnTokenUsageEvent(
    database,
    jobId,
    { type: 'started', requestEvidence: exactPolicy, requestIdentity },
    '2026-08-24T10:00:00.000Z',
  );
  recordPersistedLearnTokenUsageEvent(
    database,
    jobId,
    {
      type: 'completed',
      usage: httpCompletionObserved ? { ...exactUsage, estimated: false } : null,
      requestEvidence: exactPolicy,
      requestIdentity,
    },
    '2026-08-24T10:00:01.000Z',
  );
}

function receipt(overrides = {}) {
  return {
    receiptId: 'lrq_exact_request_0001',
    requestHash: 'a'.repeat(64),
    usage: exactUsage,
    providerCallCount: 1,
    reportedCallCount: 1,
    estimatedCallCount: 0,
    dispatchCount: 1,
    httpCompletionObserved: false,
    requestEvidence: exactPolicy,
    ...overrides,
  };
}

test('Learn reconciles generated-visual usage against the selected receipt model', () => {
  const learnSource = fs.readFileSync(
    new URL('../src/lib/learn.ts', import.meta.url),
    'utf8',
  );
  assert.match(
    learnSource,
    /onCouncilReceipt:[\s\S]*?requestEvidence:\s*\{\s*model:\s*receipt\.requestedModel,/,
  );
  assert.ok(
    (learnSource.match(/reconcileFailedReceipt\(source, lookup\.receipt\)/g) ?? [])
      .length >= 3,
    'dispatch failure, restarted checkpoint, and skipped newer native failure must reconcile durable attempts',
  );
  assert.doesNotMatch(
    learnSource,
    /onCouncilReceipt:[\s\S]*?requestEvidence:\s*\{\s*model,\s*reasoningEffort:/,
  );
  assert.match(
    learnSource,
    /reconcileOrdinaryCouncilReceiptAttempts\(\{[\s\S]*?receipt:\s*lookup\.receipt,/,
    'ordinary receipts must reconcile their per-generation attempt history',
  );
  const visualSource = fs.readFileSync(
    new URL('../src/lib/generated-visuals.ts', import.meta.url),
    'utf8',
  );
  assert.match(visualSource, /const criticModel = input\.model;/);
  assert.doesNotMatch(visualSource, /LEARN_GENERATED_VISUAL_CRITIC_MODEL/);
});

function assertOneExactLifecycle(database, jobId) {
  assert.deepEqual(persistedLearnTokenUsageForJob(database, jobId), {
    ...exactUsage,
    estimated: false,
    startedCalls: 1,
    completedCalls: 1,
    reportedCalls: 1,
    unreportedCalls: 0,
    inFlightCalls: 0,
    requestPolicy: {
      ...exactPolicy,
      observedCalls: 1,
      consistent: true,
    },
  });
}

function assertTwoGenerationLifecycle(database, jobId) {
  assert.deepEqual(persistedLearnTokenUsageForJob(database, jobId), {
    ...twoGenerationUsage,
    estimated: true,
    startedCalls: 2,
    completedCalls: 2,
    reportedCalls: 1,
    unreportedCalls: 1,
    inFlightCalls: 0,
    requestPolicy: {
      ...exactPolicy,
      observedCalls: 2,
      consistent: true,
    },
  });
}

test('one ambiguous dispatch fills its one unreported completion once', () => {
  const fixture = openUsageDatabase('learn-usage-one-dispatch-');
  try {
    recordTrackedDispatch(fixture.database, 'current-job', false);
    const reconciliation = receipt();
    assert.equal(
      reconcilePersistedLearnTokenUsageFromReceipt(
        fixture.database,
        'current-job',
        reconciliation,
        '2026-08-24T10:03:00.000Z',
      ),
      true,
    );
    assertOneExactLifecycle(fixture.database, 'current-job');

    assert.equal(
      reconcilePersistedLearnTokenUsageFromReceipt(
        fixture.database,
        'current-job',
        { ...reconciliation, dispatchCount: 0 },
        '2026-08-24T10:04:00.000Z',
      ),
      false,
      'later adoption of the same receipt must not apply it again',
    );
    assertOneExactLifecycle(fixture.database, 'current-job');
    assert.throws(
      () => reconcilePersistedLearnTokenUsageFromReceipt(
        fixture.database,
        'current-job',
        { ...reconciliation, usage: { ...exactUsage, outputTokens: 30 } },
        '2026-08-24T10:05:00.000Z',
      ),
      /receipt identity conflict/,
    );
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('receipt reconciliation never consumes an unrelated aggregate slot', () => {
  const fixture = openUsageDatabase('learn-usage-unrelated-slot-');
  try {
    recordPersistedLearnTokenUsageEvent(
      fixture.database,
      'concurrent-job',
      { type: 'started', requestEvidence: exactPolicy },
      '2026-08-24T10:10:00.000Z',
    );
    recordPersistedLearnTokenUsageEvent(
      fixture.database,
      'concurrent-job',
      { type: 'completed', usage: null, requestEvidence: exactPolicy },
      '2026-08-24T10:10:01.000Z',
    );
    const before = persistedLearnTokenUsageForJob(
      fixture.database,
      'concurrent-job',
    );

    assert.throws(
      () => reconcilePersistedLearnTokenUsageFromReceipt(
        fixture.database,
        'concurrent-job',
        receipt({
          receiptId: 'lrq_must_not_consume_other_call_0001',
          requestHash: '5'.repeat(64),
        }),
        '2026-08-24T10:11:00.000Z',
      ),
      /could not reconcile tracked counters/,
    );
    assert.deepEqual(
      persistedLearnTokenUsageForJob(fixture.database, 'concurrent-job'),
      before,
    );
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a proven cross-job missing receipt removes the origin HTTP phantom call', () => {
  const fixture = openUsageDatabase('learn-usage-proven-missing-origin-');
  try {
    const binding = receipt({
      receiptId: 'lrq_proven_missing_origin_0001',
      requestHash: '8'.repeat(64),
    });
    recordTrackedDispatch(fixture.database, 'origin-job', false, binding);
    assert.equal(
      persistedLearnTokenUsageForJob(fixture.database, 'origin-job').startedCalls,
      1,
    );
    assert.equal(
      discardPersistedLearnTokenUsageForProvenMissingReceipt(
        fixture.database,
        'origin-job',
        binding.receiptId,
        binding.requestHash,
        '2026-08-24T10:20:00.000Z',
      ),
      true,
    );
    assert.deepEqual(
      persistedLearnTokenUsageForJob(fixture.database, 'origin-job'),
      {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        estimated: false,
        startedCalls: 0,
        completedCalls: 0,
        reportedCalls: 0,
        unreportedCalls: 0,
        inFlightCalls: 0,
      },
    );
    assert.equal(
      discardPersistedLearnTokenUsageForProvenMissingReceipt(
        fixture.database,
        'origin-job',
        binding.receiptId,
        binding.requestHash,
        '2026-08-24T10:21:00.000Z',
      ),
      false,
    );
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a missing-receipt handoff removes both bounded preaccept HTTP phantoms', () => {
  const fixture = openUsageDatabase('learn-usage-proven-missing-two-http-');
  try {
    const binding = receipt({
      receiptId: 'lrq_proven_missing_two_http_0001',
      requestHash: '8'.repeat(64),
    });
    recordTrackedDispatch(fixture.database, 'origin-job', false, binding);
    recordTrackedDispatch(fixture.database, 'origin-job', false, binding);
    assert.equal(
      persistedLearnTokenUsageForJob(fixture.database, 'origin-job').startedCalls,
      2,
    );
    assert.equal(
      discardPersistedLearnTokenUsageForProvenMissingReceipt(
        fixture.database,
        'origin-job',
        binding.receiptId,
        binding.requestHash,
        '2026-08-24T10:22:00.000Z',
      ),
      true,
    );
    assert.deepEqual(
      persistedLearnTokenUsageForJob(fixture.database, 'origin-job'),
      {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        estimated: false,
        startedCalls: 0,
        completedCalls: 0,
        reportedCalls: 0,
        unreportedCalls: 0,
        inFlightCalls: 0,
      },
    );
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('same-job generation 1 failure plus generation 2 completion preserves both provider calls', () => {
  const fixture = openUsageDatabase('learn-usage-redispatch-http-');
  try {
    const reconciliation = receipt({
      receiptId: 'lrq_safe_redispatch_http_0001',
      requestHash: 'b'.repeat(64),
      usage: twoGenerationUsage,
      providerCallCount: 2,
      reportedCallCount: 1,
      estimatedCallCount: 1,
      dispatchCount: 2,
      httpCompletionObserved: true,
    });
    recordTrackedDispatch(fixture.database, 'redispatch-job', false, reconciliation);
    recordTrackedDispatch(fixture.database, 'redispatch-job', true, reconciliation);
    assert.equal(
      reconcilePersistedLearnTokenUsageFromReceipt(
        fixture.database,
        'redispatch-job',
        reconciliation,
        '2026-08-24T11:00:00.000Z',
      ),
      true,
    );
    assertTwoGenerationLifecycle(fixture.database, 'redispatch-job');
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('cross-job generation 2 reconciles only the provider dispatch observed by its successor', () => {
  const fixture = openUsageDatabase('learn-usage-cross-job-generation-two-');
  try {
    const reconciliation = receipt({
      receiptId: 'lrq_cross_job_generation_two_0001',
      requestHash: '7'.repeat(64),
      dispatchCount: 1,
      httpCompletionObserved: true,
    });
    recordTrackedDispatch(fixture.database, 'successor-job', true, reconciliation);
    assert.equal(reconciliation.dispatchCount, 1);
    assert.equal(
      reconcilePersistedLearnTokenUsageFromReceipt(
        fixture.database,
        'successor-job',
        reconciliation,
        '2026-08-24T11:10:00.000Z',
      ),
      true,
    );
    assertOneExactLifecycle(fixture.database, 'successor-job');
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('cross-job generations backfill origin failure and successor completion exactly once', () => {
  const fixture = openUsageDatabase('learn-usage-cross-job-both-generations-');
  try {
    const requestId = 'lrq_cross_job_shared_receipt_0001';
    const requestHash = '9'.repeat(64);
    const trackedBinding = receipt({ receiptId: requestId, requestHash });
    recordTrackedDispatch(fixture.database, 'origin-job', false, trackedBinding);
    recordTrackedDispatch(fixture.database, 'successor-job', true, trackedBinding);
    const originAccounting = receipt({
      receiptId: 'lrga_origin_generation_one_0001',
      lifecycleRequestId: requestId,
      requestHash,
      usage: failedGenerationUsage,
      providerCallCount: 1,
      reportedCallCount: 0,
      estimatedCallCount: 1,
      dispatchCount: 1,
      httpCompletionObserved: false,
    });
    const successorAccounting = receipt({
      receiptId: 'lrga_successor_generation_two_0001',
      lifecycleRequestId: requestId,
      requestHash,
      dispatchCount: 1,
      httpCompletionObserved: true,
    });
    assert.equal(
      reconcilePersistedLearnTokenUsageFromReceipt(
        fixture.database,
        'origin-job',
        originAccounting,
        '2026-08-24T11:11:00.000Z',
      ),
      true,
    );
    assert.equal(
      reconcilePersistedLearnTokenUsageFromReceipt(
        fixture.database,
        'successor-job',
        successorAccounting,
        '2026-08-24T11:12:00.000Z',
      ),
      true,
    );
    assert.deepEqual(persistedLearnTokenUsageForJob(fixture.database, 'origin-job'), {
      ...failedGenerationUsage,
      estimated: true,
      startedCalls: 1,
      completedCalls: 1,
      reportedCalls: 0,
      unreportedCalls: 1,
      inFlightCalls: 0,
      requestPolicy: { ...exactPolicy, observedCalls: 1, consistent: true },
    });
    assertOneExactLifecycle(fixture.database, 'successor-job');
    assert.equal(
      reconcilePersistedLearnTokenUsageFromReceipt(
        fixture.database,
        'origin-job',
        originAccounting,
        '2026-08-24T11:13:00.000Z',
      ),
      false,
    );
    assert.equal(
      reconcilePersistedLearnTokenUsageFromReceipt(
        fixture.database,
        'successor-job',
        successorAccounting,
        '2026-08-24T11:14:00.000Z',
      ),
      false,
    );
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('three HTTP attempts reconcile as two durable provider generations', () => {
  const fixture = openUsageDatabase('learn-usage-missing-then-generation-two-');
  try {
    const reconciliation = receipt({
      receiptId: 'lrq_missing_then_generation_two_0001',
      requestHash: '6'.repeat(64),
      usage: twoGenerationUsage,
      providerCallCount: 2,
      reportedCallCount: 1,
      estimatedCallCount: 1,
      // The first HTTP attempt was proven absent by receipt_not_found. The
      // server receipt therefore truthfully reports only generation 1 + 2.
      dispatchCount: 2,
      httpCompletionObserved: true,
    });
    recordTrackedDispatch(fixture.database, 'three-http-job', false, reconciliation);
    recordTrackedDispatch(fixture.database, 'three-http-job', false, reconciliation);
    recordTrackedDispatch(fixture.database, 'three-http-job', true, reconciliation);
    assert.equal(
      reconcilePersistedLearnTokenUsageFromReceipt(
        fixture.database,
        'three-http-job',
        reconciliation,
        '2026-08-24T11:15:00.000Z',
      ),
      true,
    );
    assertTwoGenerationLifecycle(fixture.database, 'three-http-job');
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('re-entry normalizes a prior failed attempt when invocation dispatchCount resets', () => {
  const fixture = openUsageDatabase('learn-usage-reentry-dispatch-count-');
  try {
    const reconciliation = receipt({
      receiptId: 'lrq_reentry_redispatch_http_0001',
      requestHash: '4'.repeat(64),
      usage: twoGenerationUsage,
      providerCallCount: 2,
      reportedCallCount: 1,
      estimatedCallCount: 1,
      dispatchCount: 2,
      httpCompletionObserved: true,
    });
    recordTrackedDispatch(fixture.database, 'reentry-job', false, reconciliation);
    recordTrackedDispatch(fixture.database, 'reentry-job', true, reconciliation);

    assert.equal(
      reconcilePersistedLearnTokenUsageFromReceipt(
        fixture.database,
        'reentry-job',
        reconciliation,
        '2026-08-24T11:30:00.000Z',
      ),
      true,
    );
    assertTwoGenerationLifecycle(fixture.database, 'reentry-job');
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('ambiguous safe redispatch removes one lifecycle and applies receipt usage', () => {
  const fixture = openUsageDatabase('learn-usage-redispatch-ambiguous-');
  try {
    const reconciliation = receipt({
      receiptId: 'lrq_safe_redispatch_ambiguous_0001',
      requestHash: 'c'.repeat(64),
      usage: twoGenerationUsage,
      providerCallCount: 2,
      reportedCallCount: 1,
      estimatedCallCount: 1,
      dispatchCount: 2,
      httpCompletionObserved: false,
    });
    recordTrackedDispatch(fixture.database, 'redispatch-job', false, reconciliation);
    recordTrackedDispatch(fixture.database, 'redispatch-job', false, reconciliation);
    assert.equal(
      reconcilePersistedLearnTokenUsageFromReceipt(
        fixture.database,
        'redispatch-job',
        reconciliation,
        '2026-08-24T12:00:00.000Z',
      ),
      true,
    );
    assertTwoGenerationLifecycle(fixture.database, 'redispatch-job');
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('terminal generation-2 failure accounts both failed attempts without double counting', () => {
  const fixture = openUsageDatabase('learn-usage-terminal-generation-two-');
  try {
    const requestId = 'lrq_terminal_generation_two_0001';
    const requestHash = '0'.repeat(64);
    const binding = receipt({ receiptId: requestId, requestHash });
    recordTrackedDispatch(fixture.database, 'failed-job', false, binding);
    const generationOne = receipt({
      receiptId: 'lrga_failed_generation_one_0001',
      lifecycleRequestId: requestId,
      requestHash,
      usage: failedGenerationUsage,
      providerCallCount: 1,
      reportedCallCount: 0,
      estimatedCallCount: 1,
      dispatchCount: 1,
      httpCompletionObserved: false,
    });
    const bothFailedUsage = Object.fromEntries(
      Object.entries(failedGenerationUsage).map(([key, value]) => [key, value * 2]),
    );
    const generationTwo = receipt({
      receiptId: 'lrga_failed_generation_two_0001',
      lifecycleRequestId: requestId,
      requestHash,
      usage: bothFailedUsage,
      providerCallCount: 2,
      reportedCallCount: 0,
      estimatedCallCount: 2,
      dispatchCount: 2,
      httpCompletionObserved: false,
    });
    assert.equal(
      reconcilePersistedLearnTokenUsageFromReceipt(
        fixture.database,
        'failed-job',
        generationOne,
        '2026-08-24T12:10:00.000Z',
      ),
      true,
    );
    recordTrackedDispatch(fixture.database, 'failed-job', false, binding);
    assert.equal(
      reconcilePersistedLearnTokenUsageFromReceipt(
        fixture.database,
        'failed-job',
        generationTwo,
        '2026-08-24T12:11:00.000Z',
      ),
      true,
    );
    assert.deepEqual(persistedLearnTokenUsageForJob(fixture.database, 'failed-job'), {
      ...bothFailedUsage,
      estimated: true,
      startedCalls: 2,
      completedCalls: 2,
      reportedCalls: 0,
      unreportedCalls: 2,
      inFlightCalls: 0,
      requestPolicy: { ...exactPolicy, observedCalls: 2, consistent: true },
    });
    assert.equal(
      reconcilePersistedLearnTokenUsageFromReceipt(
        fixture.database,
        'failed-job',
        generationTwo,
        '2026-08-24T12:12:00.000Z',
      ),
      false,
    );
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('reapplying generation 1 accounting removes a later preaccept HTTP phantom', () => {
  const fixture = openUsageDatabase('learn-usage-reapply-generation-one-');
  try {
    const requestId = 'lrq_reapply_generation_one_0001';
    const requestHash = 'a'.repeat(64);
    const binding = receipt({ receiptId: requestId, requestHash });
    const generationOne = receipt({
      receiptId: 'lrga_reapply_generation_one_0001',
      lifecycleRequestId: requestId,
      requestHash,
      usage: failedGenerationUsage,
      providerCallCount: 1,
      reportedCallCount: 0,
      estimatedCallCount: 1,
      dispatchCount: 1,
      httpCompletionObserved: false,
    });
    recordTrackedDispatch(fixture.database, 'owner-job', false, binding);
    assert.equal(
      reconcilePersistedLearnTokenUsageFromReceipt(
        fixture.database,
        'owner-job',
        generationOne,
        '2026-08-24T12:20:00.000Z',
      ),
      true,
    );
    recordTrackedDispatch(
      fixture.database,
      'owner-job',
      false,
      binding,
    );
    assert.equal(
      persistedLearnTokenUsageForJob(fixture.database, 'owner-job').startedCalls,
      2,
    );
    assert.equal(
      reconcilePersistedLearnTokenUsageFromReceipt(
        fixture.database,
        'owner-job',
        generationOne,
        '2026-08-24T12:21:00.000Z',
      ),
      false,
      'the accounting id remains idempotent while its exact lifecycle is normalized',
    );
    assert.deepEqual(persistedLearnTokenUsageForJob(fixture.database, 'owner-job'), {
      ...failedGenerationUsage,
      estimated: true,
      startedCalls: 1,
      completedCalls: 1,
      reportedCalls: 0,
      unreportedCalls: 1,
      inFlightCalls: 0,
      requestPolicy: { ...exactPolicy, observedCalls: 1, consistent: true },
    });
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('zero-dispatch adoption records one complete lifecycle durably', () => {
  const fixture = openUsageDatabase('learn-usage-adopt-receipt-');
  let database = fixture.database;
  const adoption = receipt({
    receiptId: 'lrq_adopted_request_0001',
    requestHash: 'd'.repeat(64),
    dispatchCount: 0,
  });
  try {
    assert.equal(
      reconcilePersistedLearnTokenUsageFromReceipt(
        database,
        'adopting-job',
        adoption,
        '2026-08-24T13:00:00.000Z',
      ),
      true,
    );
    assertOneExactLifecycle(database, 'adopting-job');

    database.close();
    database = new Database(fixture.databasePath);
    database.pragma('foreign_keys = ON');
    assert.equal(
      reconcilePersistedLearnTokenUsageFromReceipt(
        database,
        'adopting-job',
        adoption,
        '2026-08-24T14:00:00.000Z',
      ),
      false,
      'idempotence must survive database reopen',
    );
    assertOneExactLifecycle(database, 'adopting-job');
    assert.deepEqual(
      database.prepare(
        `SELECT receipt_id, request_hash, job_id,
                observed_dispatch_count, http_completion_observed, applied_at
         FROM learn_token_usage_receipt_accounting`,
      ).all(),
      [{
        receipt_id: adoption.receiptId,
        request_hash: adoption.requestHash,
        job_id: 'adopting-job',
        observed_dispatch_count: 0,
        http_completion_observed: 0,
        applied_at: '2026-08-24T13:00:00.000Z',
      }],
    );
  } finally {
    if (database.open) database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('zero-dispatch same-job recovery does not duplicate an already tracked response', () => {
  const fixture = openUsageDatabase('learn-usage-same-job-recovery-');
  const recovered = receipt({
    receiptId: 'lrq_same_job_crash_window_0001',
    requestHash: '2'.repeat(64),
    dispatchCount: 0,
    httpCompletionObserved: false,
  });
  try {
    recordTrackedDispatch(fixture.database, 'same-job', true, recovered);
    assertOneExactLifecycle(fixture.database, 'same-job');

    assert.equal(
      reconcilePersistedLearnTokenUsageFromReceipt(
        fixture.database,
        'same-job',
        recovered,
        '2026-08-24T14:30:00.000Z',
      ),
      true,
    );
    assertOneExactLifecycle(fixture.database, 'same-job');
    assert.deepEqual(
      fixture.database.prepare(
        `SELECT started_requests, completed_requests, reported_requests,
                total_tokens
         FROM learn_token_usage_request_lifecycles
         WHERE job_id = ? AND request_id = ? AND request_hash = ?`,
      ).get('same-job', recovered.receiptId, recovered.requestHash),
      {
        started_requests: 1,
        completed_requests: 1,
        reported_requests: 1,
        total_tokens: exactUsage.totalTokens,
      },
    );
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('cross-job adoption uses its checkpoint alias without changing origin accounting', () => {
  const fixture = openUsageDatabase('learn-usage-cross-job-adoption-');
  const origin = receipt({
    receiptId: 'lrq_cross_job_origin_0001',
    requestHash: '3'.repeat(64),
    dispatchCount: 1,
    httpCompletionObserved: true,
  });
  const adoption = receipt({
    // Ordinary Learn uses the current job's durable checkpoint alias here;
    // the origin receipt id is globally owned by origin-job already.
    receiptId: 'lrqa_cross_job_checkpoint_0001',
    requestHash: origin.requestHash,
    dispatchCount: 0,
    httpCompletionObserved: false,
  });
  try {
    recordTrackedDispatch(fixture.database, 'origin-job', true, origin);
    assert.equal(
      reconcilePersistedLearnTokenUsageFromReceipt(
        fixture.database,
        'origin-job',
        origin,
        '2026-08-24T14:44:00.000Z',
      ),
      true,
    );
    assertOneExactLifecycle(fixture.database, 'origin-job');
    const originBefore = persistedLearnTokenUsageForJob(
      fixture.database,
      'origin-job',
    );

    assert.equal(
      reconcilePersistedLearnTokenUsageFromReceipt(
        fixture.database,
        'adopting-job',
        adoption,
        '2026-08-24T14:45:00.000Z',
      ),
      true,
    );
    assert.equal(
      reconcilePersistedLearnTokenUsageFromReceipt(
        fixture.database,
        'adopting-job',
        adoption,
        '2026-08-24T14:46:00.000Z',
      ),
      false,
      'the current checkpoint alias must account its adopted result once',
    );
    assert.deepEqual(
      persistedLearnTokenUsageForJob(fixture.database, 'origin-job'),
      originBefore,
    );
    assertOneExactLifecycle(fixture.database, 'adopting-job');
    assert.deepEqual(
      fixture.database.prepare(
        `SELECT receipt_id, job_id, observed_dispatch_count
         FROM learn_token_usage_receipt_accounting
         ORDER BY applied_at`,
      ).all(),
      [
        {
          receipt_id: origin.receiptId,
          job_id: 'origin-job',
          observed_dispatch_count: 1,
        },
        {
          receipt_id: adoption.receiptId,
          job_id: 'adopting-job',
          observed_dispatch_count: 0,
        },
      ],
    );
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('one normal HTTP completion is bound without changing its tracked totals', () => {
  const fixture = openUsageDatabase('learn-usage-normal-receipt-');
  try {
    const reconciliation = receipt({
      receiptId: 'lrq_normal_request_0001',
      requestHash: 'e'.repeat(64),
      httpCompletionObserved: true,
    });
    recordTrackedDispatch(fixture.database, 'normal-job', true, reconciliation);
    assert.equal(
      reconcilePersistedLearnTokenUsageFromReceipt(
        fixture.database,
        'normal-job',
        reconciliation,
        '2026-08-24T15:00:00.000Z',
      ),
      true,
    );
    assertOneExactLifecycle(fixture.database, 'normal-job');
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('receipt accounting fails loudly on impossible observations and missing slots', () => {
  const fixture = openUsageDatabase('learn-usage-invalid-receipt-');
  try {
    assert.throws(
      () => reconcilePersistedLearnTokenUsageFromReceipt(
        fixture.database,
        'invalid-job',
        receipt({
          receiptId: 'lrq_impossible_observation_0001',
          requestHash: 'f'.repeat(64),
          dispatchCount: 0,
          httpCompletionObserved: true,
        }),
        '2026-08-24T16:00:00.000Z',
      ),
      /cannot observe HTTP completion without dispatch/,
    );
    assert.throws(
      () => reconcilePersistedLearnTokenUsageFromReceipt(
        fixture.database,
        'invalid-job',
        receipt({
          receiptId: 'lrq_invalid_policy_0001',
          requestHash: '0'.repeat(64),
          dispatchCount: 0,
          requestEvidence: { ...exactPolicy, reasoningEffort: 'low' },
        }),
        '2026-08-24T16:01:00.000Z',
      ),
      /must use max\/detailed reasoning/,
    );
    assert.throws(
      () => reconcilePersistedLearnTokenUsageFromReceipt(
        fixture.database,
        'invalid-job',
        receipt({
          receiptId: 'lrq_missing_slot_0001',
          requestHash: '1'.repeat(64),
        }),
        '2026-08-24T16:02:00.000Z',
      ),
      /could not reconcile tracked counters/,
    );
    assert.equal(
      fixture.database.prepare(
        'SELECT count(*) AS count FROM learn_token_usage_receipt_accounting',
      ).get().count,
      0,
      'failed accounting must not burn the receipt identity',
    );
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
