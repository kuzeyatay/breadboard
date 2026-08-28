import assert from "node:assert/strict";
import { describe, it } from "node:test";

import Database from "better-sqlite3";

import {
  adoptCompletedLearnCouncilCheckpoint,
  adoptCompletedLearnCouncilCheckpointWithBoundary,
  adoptClaimedLearnCouncilRedispatch,
  assertUniqueLegacyLearnCouncilFailureWithoutCompletion,
  canStartLearnCouncilAfterLegacyAbsence,
  claimLearnCouncilMissingReceiptRecovery,
  claimLearnCouncilRedispatch,
  completeLearnCouncilReceiptChain,
  createStartedLearnCouncilCheckpoint,
  createStartedLearnCouncilCheckpointAfterLegacyFailure,
  ensureLearnCouncilCheckpointSchema,
  exactFailedLearnCouncilLineage,
  exactLearnCouncilRetryJobBinding,
  hasNativeLearnCouncilCheckpoint,
  isExactLegacyLearnCouncilFailureShape,
  legacyLearnCouncilLineageQuiescenceDelayMs,
  legacyLearnCouncilLineageIsQuiescent,
  learnCouncilDispatchGenerationOwners,
  learnCouncilRetryJob,
  materializeCompletedLegacyLearnCouncilCheckpoint,
  materializeCompletedLegacyLearnCouncilCheckpointAfterFailure,
  priorLearnCouncilCheckpoints,
  recordLearnCouncilNativeLineageBoundary,
  recordLegacyLearnCouncilFailureProof,
  selectNewestCompletedLearnCouncilCheckpoint,
} from "../src/lib/learn-council-checkpoints.ts";
import {
  assertExactOrdinaryLearnCouncilReceiptAttempt,
  completedLearnCouncilReceiptAttemptMatchesResult,
  learnCouncilReceiptOwnerPrefixIsExact,
  parseLearnCouncilReceiptAttempts,
  sumLearnCouncilReceiptAttemptUsage,
} from "../src/lib/learn-council-receipt-accounting.ts";
import {
  discardPersistedLearnTokenUsageForProvenMissingReceipt,
  ensureLearnTokenUsagePersistenceSchema,
  persistedLearnTokenUsageForJob,
  reconcilePersistedLearnTokenUsageFromReceipt,
  recordPersistedLearnTokenUsageEvent,
} from "../src/lib/learn-token-usage-persistence.ts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const RESPONSE_HASH = "c".repeat(64);

function database() {
  const db = new Database(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE learn_jobs (
      id TEXT PRIMARY KEY,
      garden_id TEXT NOT NULL,
      user_id INTEGER,
      model TEXT,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      requires_replan INTEGER NOT NULL DEFAULT 0,
      confirmed_learning_map_id TEXT,
      source_set_hash TEXT,
      source_ids_json TEXT,
      syllabus_source_id TEXT,
      source_only INTEGER,
      include_source_snapshots INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE learn_versions (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL
    );
  `);
  ensureLearnCouncilCheckpointSchema(db);
  return db;
}

function databaseWithUsage() {
  const db = database();
  db.exec(`
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
  ensureLearnTokenUsagePersistenceSchema(db);
  return db;
}

function addJob(db, input) {
  db.prepare(`
    INSERT INTO learn_jobs (
      id, garden_id, user_id, model, status, mode, requires_replan,
      confirmed_learning_map_id, source_set_hash, source_ids_json,
      syllabus_source_id, source_only, include_source_snapshots,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.gardenId ?? "garden-generic",
    input.userId ?? 7,
    input.model ?? "model-generic",
    input.status,
    input.mode ?? "generate",
    input.requiresReplan ?? 0,
    input.mapId ?? "map-generic",
    input.sourceSetHash ?? HASH_A,
    JSON.stringify(input.sourceIds ?? ["source-a", "source-b"]),
    input.syllabusId ?? "syllabus-generic",
    input.sourceOnly ?? 1,
    input.includeSourceSnapshots ?? 0,
    input.createdAt,
    input.updatedAt,
  );
}

function stage(jobId, stageKey = "generation:page:unit-generic:draft") {
  return {
    jobId,
    gardenId: "garden-generic",
    stageKey,
    semanticAttempt: 0,
  };
}

function legacyFailureProof(overrides = {}) {
  return {
    councilRunId: "legacy-run-failed",
    failureCode: "connection_closed",
    failurePhase: "receive",
    partialOutput: true,
    replaySafe: false,
    councilMode: "direct_council",
    requestedModel: "model-generic",
    resolvedModel: "model-generic",
    callCount: 1,
    reportedCallCount: 0,
    createdAt: "2026-01-01T00:01:00.000Z",
    updatedAt: "2026-01-01T00:02:00.000Z",
    ...overrides,
  };
}

describe("ordinary Learn Council checkpoints", () => {
  it("strictly parses and sums both durable provider generations", () => {
    const route = (runId, outcome) => ({
      endpoint: "council",
      requestedModel: "model-generic",
      resolvedModel: "model-generic",
      provider: "chatgpt",
      upstreamModel: "model-generic",
      fallback: false,
      requestId: runId,
      outcome,
    });
    const failed = {
      dispatchGeneration: 1,
      outcome: "failed_no_final_answer",
      councilRunId: "run-generation-one",
      finalAnswerPresent: false,
      usage: {
        inputTokens: 41,
        outputTokens: 9,
        totalTokens: 50,
        cachedInputTokens: 3,
        reasoningTokens: 4,
        callCount: 1,
        reportedCallCount: 0,
      },
      usageEstimated: true,
      modelRouting: [route("run-generation-one", "failed")],
      requestedModel: "model-generic",
      resolvedModel: "model-generic",
      createdAt: "2026-01-01T00:01:00.000Z",
      updatedAt: "2026-01-01T00:02:00.000Z",
      failureCode: "council_no_final_answer",
    };
    const completed = {
      dispatchGeneration: 2,
      outcome: "completed",
      councilRunId: "run-generation-two",
      finalAnswerPresent: true,
      usage: {
        inputTokens: 101,
        outputTokens: 29,
        totalTokens: 130,
        cachedInputTokens: 17,
        reasoningTokens: 11,
        callCount: 1,
        reportedCallCount: 1,
      },
      usageEstimated: false,
      modelRouting: [route("run-generation-two", "succeeded")],
      requestedModel: "model-generic",
      resolvedModel: "model-generic",
      createdAt: "2026-01-01T00:03:00.000Z",
      updatedAt: "2026-01-01T00:04:00.000Z",
      responseHash: RESPONSE_HASH,
    };
    const attempts = parseLearnCouncilReceiptAttempts(
      [failed, completed],
      2,
      "completed",
    );
    for (const attempt of attempts) {
      assert.doesNotThrow(() =>
        assertExactOrdinaryLearnCouncilReceiptAttempt(attempt, "model-generic"));
    }
    assert.deepEqual(sumLearnCouncilReceiptAttemptUsage(attempts), {
      usage: {
        inputTokens: 142,
        outputTokens: 38,
        totalTokens: 180,
        cachedInputTokens: 20,
        reasoningTokens: 15,
      },
      providerCallCount: 2,
      reportedCallCount: 1,
      estimatedCallCount: 1,
    });
    const matchingResult = {
      councilRunId: completed.councilRunId,
      responseHash: completed.responseHash,
      requestedModel: completed.requestedModel,
      resolvedModel: completed.resolvedModel,
      createdAt: completed.createdAt,
      updatedAt: completed.updatedAt,
      usageEstimated: completed.usageEstimated,
      modelRouting: completed.modelRouting,
      usage: completed.usage,
    };
    assert.equal(
      completedLearnCouncilReceiptAttemptMatchesResult(
        attempts.at(-1),
        matchingResult,
      ),
      true,
    );
    assert.equal(
      completedLearnCouncilReceiptAttemptMatchesResult(
        attempts.at(-1),
        { ...matchingResult, usage: { ...matchingResult.usage, totalTokens: 131 } },
      ),
      false,
      "a structurally valid result may not forge different attempt usage",
    );
    assert.throws(
      () => parseLearnCouncilReceiptAttempts(
        [{ ...failed, dispatchGeneration: 2 }, completed],
        2,
        "completed",
      ),
      /attempt binding is invalid/,
    );
    assert.throws(
      () => parseLearnCouncilReceiptAttempts(
        [{ ...failed, unsafePrompt: "forbidden" }, completed],
        2,
        "completed",
      ),
      /attempt binding is invalid/,
    );
    assert.equal(
      learnCouncilReceiptOwnerPrefixIsExact([1, 2], 1, true),
      true,
      "a crash after the local generation-2 claim may resume while the server still proves only generation 1",
    );
    assert.equal(learnCouncilReceiptOwnerPrefixIsExact([1, 2], 1, false), false);
    assert.equal(learnCouncilReceiptOwnerPrefixIsExact([1, 2], 2, false), true);
  });

  it("persists an exact prompt-free binding before the first dispatch", () => {
    const db = database();
    addJob(db, {
      id: "job-current",
      status: "generating_learning_pages",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    const row = createStartedLearnCouncilCheckpoint(db, {
      requestId: "ordinary-request-1",
      requestHash: HASH_B,
      now: "2026-01-02T00:00:01.000Z",
      ...stage("job-current"),
    });

    assert.equal(row.state, "started");
    assert.equal(row.receipt_request_id, "ordinary-request-1");
    assert.equal(row.request_hash, HASH_B);
    assert.equal(row.dispatch_attempt_count, 1);
    assert.equal(row.redispatch_count, 0);
    assert.equal(hasNativeLearnCouncilCheckpoint(db, "job-current"), true);
    const columns = db.prepare(
      "PRAGMA table_info(learn_council_request_checkpoints)",
    ).all().map((column) => column.name);
    for (const forbidden of ["prompt", "messages", "system", "user", "content"]) {
      assert.equal(columns.includes(forbidden), false);
    }
  });

  it("binds cross-job recovery to the exact failed workflow epoch", () => {
    const db = database();
    addJob(db, {
      id: "job-origin",
      status: "failed",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:10:00.000Z",
    });
    addJob(db, {
      id: "job-unrelated",
      status: "failed",
      mapId: "different-map",
      createdAt: "2026-01-01T01:00:00.000Z",
      updatedAt: "2026-01-01T01:10:00.000Z",
    });
    addJob(db, {
      id: "job-current",
      status: "generating_learning_pages",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    const origin = learnCouncilRetryJob(db, "job-origin");
    const unrelated = learnCouncilRetryJob(db, "job-unrelated");
    const current = learnCouncilRetryJob(db, "job-current");
    assert.ok(origin && unrelated && current);
    assert.equal(exactLearnCouncilRetryJobBinding(origin, current), true);
    assert.equal(exactLearnCouncilRetryJobBinding(unrelated, current), false);
    assert.deepEqual(
      exactFailedLearnCouncilLineage(db, "job-current").map((job) => job.id),
      ["job-origin"],
    );
  });

  it("requires legacy lineage quiescence beyond both client and provider deadlines", () => {
    const base = {
      id: "failed-origin",
      status: "failed",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:10:00.000Z",
    };
    assert.equal(
      legacyLearnCouncilLineageIsQuiescent(
        [base],
        Date.parse("2026-01-01T00:46:59.999Z"),
      ),
      false,
      "a young failed job may still publish after the non-atomic legacy glob",
    );
    assert.equal(
      legacyLearnCouncilLineageIsQuiescent(
        [base],
        Date.parse("2026-01-01T00:47:00.000Z"),
      ),
      true,
    );
    assert.equal(
      legacyLearnCouncilLineageIsQuiescent(
        [{ ...base, status: "generating_learning_pages" }],
        Date.parse("2026-01-01T01:00:00.000Z"),
      ),
      false,
    );
    assert.equal(
      legacyLearnCouncilLineageQuiescenceDelayMs(
        [base],
        Date.parse("2026-01-01T00:46:59.999Z"),
      ),
      1,
      "the recovery loop can wait exactly to the safe boundary",
    );
    assert.equal(
      legacyLearnCouncilLineageQuiescenceDelayMs(
        [base],
        Date.parse("2026-01-01T00:47:00.000Z"),
      ),
      0,
    );
    assert.equal(
      legacyLearnCouncilLineageQuiescenceDelayMs(
        [{ ...base, status: "generating_learning_pages" }],
        Date.parse("2026-01-01T01:00:00.000Z"),
      ),
      null,
      "time alone cannot make a non-terminal predecessor safe",
    );
  });

  it("claims at most one same-id/hash redispatch across job aliases", () => {
    const db = database();
    addJob(db, {
      id: "job-origin",
      status: "failed",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:10:00.000Z",
    });
    addJob(db, {
      id: "job-current",
      status: "generating_learning_pages",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    const source = createStartedLearnCouncilCheckpoint(db, {
      requestId: "ordinary-request-1",
      requestHash: HASH_B,
      now: "2026-01-01T00:01:00.000Z",
      ...stage("job-origin"),
    });

    const claimed = claimLearnCouncilRedispatch(db, {
      checkpointId: "ordinary-adoption-1",
      source,
      requestHash: HASH_B,
      reason: "request_failed",
      now: "2026-01-02T00:01:00.000Z",
      ...stage("job-current"),
    });
    assert.equal(claimed.receipt_request_id, "ordinary-request-1");
    assert.equal(claimed.dispatch_attempt_count, 2);
    assert.equal(claimed.redispatch_count, 1);
    assert.equal(claimed.redispatch_reason, "request_failed");
    assert.deepEqual(
      learnCouncilDispatchGenerationOwners(db, "ordinary-request-1").map(
        (owner) => [owner.dispatch_generation, owner.job_id],
      ),
      [[1, "job-origin"], [2, "job-current"]],
    );
    assert.throws(
      () => claimLearnCouncilRedispatch(db, {
        checkpointId: "ordinary-adoption-2",
        source: claimed,
        requestHash: HASH_B,
        reason: "request_failed",
        now: "2026-01-02T00:02:00.000Z",
        ...stage("job-current"),
      }),
      /no remaining exact redispatch authority/,
    );
  });

  it("transfers an unposted generation-2 claim to an exact successor", () => {
    const db = database();
    addJob(db, {
      id: "job-cancelled-owner",
      status: "failed",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:10:00.000Z",
    });
    addJob(db, {
      id: "job-successor",
      status: "generating_learning_pages",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    const source = createStartedLearnCouncilCheckpoint(db, {
      requestId: "receipt-unposted-generation-two",
      requestHash: HASH_B,
      now: "2026-01-01T00:01:00.000Z",
      ...stage("job-cancelled-owner"),
    });
    const locallyClaimed = claimLearnCouncilRedispatch(db, {
      checkpointId: source.checkpoint_id,
      source,
      requestHash: HASH_B,
      reason: "request_failed",
      now: "2026-01-01T00:02:00.000Z",
      ...stage("job-cancelled-owner"),
    });
    assert.throws(
      () => adoptClaimedLearnCouncilRedispatch(db, {
        checkpointId: "successor-generation-two-alias",
        source: locallyClaimed,
        requestHash: HASH_B,
        now: "2026-01-02T00:01:00.000Z",
        beforeOwnerTransfer: (
          priorOwnerJobId,
          receiptRequestId,
          exactRequestHash,
        ) => {
          assert.equal(priorOwnerJobId, "job-cancelled-owner");
          assert.equal(
            receiptRequestId,
            "receipt-unposted-generation-two",
          );
          assert.equal(exactRequestHash, HASH_B);
          throw new Error("injected atomic usage cleanup crash");
        },
        ...stage("job-successor"),
      }),
      /injected atomic usage cleanup crash/,
    );
    assert.deepEqual(
      learnCouncilDispatchGenerationOwners(
        db,
        "receipt-unposted-generation-two",
      ).map((owner) => [owner.dispatch_generation, owner.job_id]),
      [[1, "job-cancelled-owner"], [2, "job-cancelled-owner"]],
      "a cleanup crash must roll back both the alias and owner transfer",
    );
    assert.equal(
      db.prepare(
        `SELECT COUNT(*) AS count FROM learn_council_request_checkpoints
         WHERE job_id = ? AND stage_key = ? AND semantic_attempt = ?`,
      ).get(
        "job-successor",
        "generation:page:unit-generic:draft",
        0,
      ).count,
      0,
    );
    const adopted = adoptClaimedLearnCouncilRedispatch(db, {
      checkpointId: "successor-generation-two-alias",
      source: locallyClaimed,
      requestHash: HASH_B,
      now: "2026-01-02T00:01:00.000Z",
      beforeOwnerTransfer: (
        priorOwnerJobId,
        receiptRequestId,
        exactRequestHash,
      ) => {
        assert.equal(priorOwnerJobId, "job-cancelled-owner");
        assert.equal(receiptRequestId, "receipt-unposted-generation-two");
        assert.equal(exactRequestHash, HASH_B);
      },
      ...stage("job-successor"),
    });
    assert.equal(adopted.redispatch_reason, "request_failed");
    assert.deepEqual(
      learnCouncilDispatchGenerationOwners(
        db,
        "receipt-unposted-generation-two",
      ).map((owner) => [owner.dispatch_generation, owner.job_id]),
      [[1, "job-cancelled-owner"], [2, "job-successor"]],
    );
  });

  it("atomically cleans a chained generation-2 owner's preaccept phantom", () => {
    const db = databaseWithUsage();
    for (const [id, status, day] of [
      ["job-generation-one-owner", "failed", "01"],
      ["job-generation-two-owner", "failed", "02"],
      ["job-generation-two-successor", "generating_learning_pages", "03"],
    ]) {
      addJob(db, {
        id,
        status,
        createdAt: `2026-01-${day}T00:00:00.000Z`,
        updatedAt: `2026-01-${day}T00:10:00.000Z`,
      });
    }
    const requestId = "receipt-chained-generation-transfer";
    const requestIdentity = {
      clientRequestId: requestId,
      clientRequestHash: HASH_B,
    };
    const requestEvidence = {
      model: "model-generic",
      reasoningEffort: "max",
      reasoningSummary: "detailed",
    };
    const trackPreacceptAttempt = (jobId, timestamp) => {
      recordPersistedLearnTokenUsageEvent(
        db,
        jobId,
        { type: "started", requestEvidence, requestIdentity },
        timestamp,
      );
      recordPersistedLearnTokenUsageEvent(
        db,
        jobId,
        {
          type: "completed",
          usage: null,
          requestEvidence,
          requestIdentity,
        },
        timestamp,
      );
    };
    const generationOneUsage = {
      inputTokens: 41,
      outputTokens: 9,
      totalTokens: 50,
      cachedInputTokens: 3,
      reasoningTokens: 4,
    };
    const reconcileGenerationOne = () =>
      reconcilePersistedLearnTokenUsageFromReceipt(
        db,
        "job-generation-one-owner",
        {
          receiptId: "lrga_chained_generation_one",
          lifecycleRequestId: requestId,
          requestHash: HASH_B,
          usage: generationOneUsage,
          providerCallCount: 1,
          reportedCallCount: 0,
          estimatedCallCount: 1,
          dispatchCount: 1,
          httpCompletionObserved: false,
          requestEvidence,
        },
        "2026-01-03T00:01:00.000Z",
      );
    const source = createStartedLearnCouncilCheckpoint(db, {
      requestId,
      requestHash: HASH_B,
      now: "2026-01-01T00:01:00.000Z",
      ...stage("job-generation-one-owner"),
    });
    trackPreacceptAttempt(
      "job-generation-one-owner",
      "2026-01-01T00:02:00.000Z",
    );
    assert.equal(reconcileGenerationOne(), true);
    const generationTwoClaim = claimLearnCouncilRedispatch(db, {
      checkpointId: "generation-two-owner-alias",
      source,
      requestHash: HASH_B,
      reason: "request_failed",
      now: "2026-01-02T00:01:00.000Z",
      ...stage("job-generation-two-owner"),
    });
    trackPreacceptAttempt(
      "job-generation-two-owner",
      "2026-01-02T00:02:00.000Z",
    );
    const cleanupPriorOwner = (priorOwnerJobId, exactId, exactHash) => {
      assert.equal(reconcileGenerationOne(), false);
      assert.equal(
        discardPersistedLearnTokenUsageForProvenMissingReceipt(
          db,
          priorOwnerJobId,
          exactId,
          exactHash,
          "2026-01-03T00:02:00.000Z",
        ),
        true,
      );
    };
    assert.throws(
      () => adoptClaimedLearnCouncilRedispatch(db, {
        checkpointId: "generation-two-successor-alias",
        source: generationTwoClaim,
        requestHash: HASH_B,
        now: "2026-01-03T00:01:00.000Z",
        beforeOwnerTransfer: (...args) => {
          cleanupPriorOwner(...args);
          throw new Error("injected crash after chained usage cleanup");
        },
        ...stage("job-generation-two-successor"),
      }),
      /injected crash after chained usage cleanup/,
    );
    assert.deepEqual(
      learnCouncilDispatchGenerationOwners(db, requestId).map((owner) => [
        owner.dispatch_generation,
        owner.job_id,
      ]),
      [
        [1, "job-generation-one-owner"],
        [2, "job-generation-two-owner"],
      ],
    );
    assert.equal(
      persistedLearnTokenUsageForJob(db, "job-generation-two-owner")
        .startedCalls,
      1,
      "the outer rollback must restore the prior owner's phantom lifecycle",
    );
    adoptClaimedLearnCouncilRedispatch(db, {
      checkpointId: "generation-two-successor-alias",
      source: generationTwoClaim,
      requestHash: HASH_B,
      now: "2026-01-03T00:03:00.000Z",
      beforeOwnerTransfer: cleanupPriorOwner,
      ...stage("job-generation-two-successor"),
    });
    assert.deepEqual(
      learnCouncilDispatchGenerationOwners(db, requestId).map((owner) => [
        owner.dispatch_generation,
        owner.job_id,
      ]),
      [
        [1, "job-generation-one-owner"],
        [2, "job-generation-two-successor"],
      ],
    );
    assert.deepEqual(
      persistedLearnTokenUsageForJob(db, "job-generation-two-owner"),
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
    assert.deepEqual(
      persistedLearnTokenUsageForJob(db, "job-generation-one-owner"),
      {
        ...generationOneUsage,
        estimated: true,
        startedCalls: 1,
        completedCalls: 1,
        reportedCalls: 0,
        unreportedCalls: 1,
        inFlightCalls: 0,
        requestPolicy: {
          ...requestEvidence,
          observedCalls: 1,
          consistent: true,
        },
      },
    );
  });

  it("completes only the server generation backed by the exact local claim", () => {
    const db = database();
    addJob(db, {
      id: "job-current",
      status: "generating_learning_pages",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    const generationOne = createStartedLearnCouncilCheckpoint(db, {
      requestId: "ordinary-generation-one",
      requestHash: HASH_B,
      now: "2026-01-02T00:01:00.000Z",
      ...stage("job-current", "generation:page:one:draft"),
    });
    assert.throws(
      () => completeLearnCouncilReceiptChain(db, {
        receiptRequestId: generationOne.receipt_request_id,
        requestHash: HASH_B,
        councilRunId: "unexpected-generation-two-run",
        responseHash: RESPONSE_HASH,
        receiptDispatchCount: 2,
        now: "2026-01-02T00:02:00.000Z",
      }),
      /generation conflicts with its durable local claim/,
    );

    const generationTwoStarted = createStartedLearnCouncilCheckpoint(db, {
      requestId: "ordinary-generation-two",
      requestHash: HASH_B,
      now: "2026-01-02T00:03:00.000Z",
      ...stage("job-current", "generation:page:two:draft"),
    });
    const generationTwoClaimed = claimLearnCouncilRedispatch(db, {
      checkpointId: generationTwoStarted.checkpoint_id,
      source: generationTwoStarted,
      requestHash: HASH_B,
      reason: "request_failed",
      now: "2026-01-02T00:04:00.000Z",
      ...stage("job-current", "generation:page:two:draft"),
    });
    assert.throws(
      () => completeLearnCouncilReceiptChain(db, {
        receiptRequestId: generationTwoClaimed.receipt_request_id,
        requestHash: HASH_B,
        councilRunId: "stale-generation-one-run",
        responseHash: RESPONSE_HASH,
        receiptDispatchCount: 1,
        now: "2026-01-02T00:05:00.000Z",
      }),
      /generation conflicts with its durable local claim/,
    );
  });

  it("completes every same-receipt alias atomically and adopts once", () => {
    const db = database();
    addJob(db, {
      id: "job-origin",
      status: "failed",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:10:00.000Z",
    });
    addJob(db, {
      id: "job-current",
      status: "generating_learning_pages",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    addJob(db, {
      id: "job-next",
      status: "generating_learning_pages",
      createdAt: "2026-01-03T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
    });
    const source = createStartedLearnCouncilCheckpoint(db, {
      requestId: "ordinary-request-1",
      requestHash: HASH_B,
      now: "2026-01-01T00:01:00.000Z",
      ...stage("job-origin"),
    });
    claimLearnCouncilMissingReceiptRecovery(db, {
      claimId: "missing-receipt-claim-1",
      checkpointId: "ordinary-adoption-1",
      source,
      requestHash: HASH_B,
      now: "2026-01-02T00:01:00.000Z",
      beforeOwnerTransfer: () => {},
      ...stage("job-current"),
    });
    const completed = completeLearnCouncilReceiptChain(db, {
      receiptRequestId: "ordinary-request-1",
      requestHash: HASH_B,
      councilRunId: "council-run-1",
      responseHash: RESPONSE_HASH,
      receiptDispatchCount: 1,
      now: "2026-01-02T00:02:00.000Z",
    });
    assert.equal(completed.length, 2);
    assert.ok(completed.every((row) => row.state === "completed"));

    const latest = priorLearnCouncilCheckpoints(db, {
      currentJobId: "job-next",
      ...stage("job-next"),
    });
    assert.equal(latest.length, 1);
    const adopted = adoptCompletedLearnCouncilCheckpoint(db, {
      checkpointId: "ordinary-adoption-2",
      source: latest[0],
      now: "2026-01-03T00:01:00.000Z",
      ...stage("job-next"),
    });
    assert.equal(adopted.state, "completed");
    assert.equal(adopted.receipt_request_id, "ordinary-request-1");
    assert.equal(adopted.council_run_id, "council-run-1");
  });

  it("materializes a completed prompt-free legacy outcome without dispatch authority", () => {
    const db = database();
    addJob(db, {
      id: "job-origin",
      status: "failed",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:10:00.000Z",
    });
    addJob(db, {
      id: "job-current",
      status: "generating_learning_pages",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    const row = materializeCompletedLegacyLearnCouncilCheckpoint(db, {
      checkpointId: "legacy-checkpoint-1",
      originJobId: "job-origin",
      requestHash: HASH_B,
      councilRunId: "legacy-run-1",
      responseHash: RESPONSE_HASH,
      now: "2026-01-02T00:01:00.000Z",
      ...stage("job-current"),
    });
    assert.equal(row.result_origin, "legacy");
    assert.equal(row.state, "completed");
    assert.equal(row.receipt_request_id, null);
    assert.equal(row.dispatch_attempt_count, 0);
    assert.equal(hasNativeLearnCouncilCheckpoint(db, "job-current"), false);
  });

  it("atomically fences a fresh strict epoch behind a positive legacy failure proof", () => {
    const db = database();
    addJob(db, {
      id: "job-origin",
      status: "failed",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:10:00.000Z",
    });
    addJob(db, {
      id: "job-current",
      status: "generating_learning_pages",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    const row = createStartedLearnCouncilCheckpointAfterLegacyFailure(db, {
      proofId: "legacy-proof-1",
      requestId: "ordinary-request-1",
      originJobId: "job-origin",
      requestHash: HASH_B,
      proof: legacyFailureProof(),
      now: "2026-01-02T00:01:00.000Z",
      ...stage("job-current"),
    });
    assert.equal(row.state, "started");
    assert.equal(row.dispatch_attempt_count, 1);
    const proof = db.prepare(
      "SELECT * FROM learn_council_legacy_failure_proofs WHERE proof_id = ?",
    ).get("legacy-proof-1");
    assert.equal(proof.final_answer_present, 0);
    assert.equal(proof.candidate_count, 0);
    assert.equal(proof.partial_output, 1);
    assert.equal(proof.replay_safe, 0);

    assert.throws(
      () => createStartedLearnCouncilCheckpointAfterLegacyFailure(db, {
        proofId: "legacy-proof-2",
        requestId: "ordinary-request-2",
        originJobId: "job-origin",
        requestHash: HASH_B,
        proof: {
          ...row,
          councilRunId: "legacy-run-failed-2",
          failureCode: "connection_closed",
          failurePhase: "receive",
          partialOutput: true,
          replaySafe: false,
          councilMode: "direct_council",
          requestedModel: "model-generic",
          resolvedModel: "model-generic",
          callCount: 1,
          reportedCallCount: 0,
          createdAt: "2026-01-01T00:03:00.000Z",
          updatedAt: "2026-01-01T00:04:00.000Z",
        },
        now: "2026-01-02T00:02:00.000Z",
        ...stage("job-current"),
      }),
      /conflicts with durable evidence/,
    );
  });

  it("atomically resumes a failed-newer plus completed-older migration after a proof-only crash", () => {
    const db = database();
    addJob(db, {
      id: "job-failed-newer",
      status: "failed",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:10:00.000Z",
    });
    addJob(db, {
      id: "job-completed-older",
      status: "failed",
      createdAt: "2025-12-31T00:00:00.000Z",
      updatedAt: "2025-12-31T00:10:00.000Z",
    });
    addJob(db, {
      id: "job-current",
      status: "generating_learning_pages",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    // Simulate the old two-write implementation crashing after the boundary.
    recordLegacyLearnCouncilFailureProof(db, {
      proofId: "legacy-proof-before-crash",
      originJobId: "job-failed-newer",
      requestHash: HASH_B,
      proof: legacyFailureProof(),
      now: "2026-01-02T00:01:00.000Z",
      ...stage("job-current"),
    });

    const recovered = materializeCompletedLegacyLearnCouncilCheckpointAfterFailure(db, {
      proofId: "legacy-proof-after-restart",
      failureOriginJobId: "job-failed-newer",
      completionOriginJobId: "job-completed-older",
      checkpointId: "legacy-completion-after-restart",
      requestHash: HASH_B,
      proof: legacyFailureProof(),
      councilRunId: "legacy-run-completed",
      responseHash: RESPONSE_HASH,
      now: "2026-01-02T00:02:00.000Z",
      ...stage("job-current"),
    });
    const repeated = materializeCompletedLegacyLearnCouncilCheckpointAfterFailure(db, {
      proofId: "legacy-proof-repeat",
      failureOriginJobId: "job-failed-newer",
      completionOriginJobId: "job-completed-older",
      checkpointId: "legacy-completion-repeat",
      requestHash: HASH_B,
      proof: legacyFailureProof(),
      councilRunId: "legacy-run-completed",
      responseHash: RESPONSE_HASH,
      now: "2026-01-02T00:03:00.000Z",
      ...stage("job-current"),
    });

    assert.equal(recovered.checkpoint_id, "legacy-completion-after-restart");
    assert.equal(repeated.checkpoint_id, recovered.checkpoint_id);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM learn_council_legacy_failure_proofs").get().count,
      1,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM learn_council_request_checkpoints").get().count,
      1,
    );
    // This is the exact migration boundary that allows page 1.3's 404-only
    // lookup to begin the first native strict receipt epoch.
    assert.equal(canStartLearnCouncilAfterLegacyAbsence(db, "job-current"), true);
  });

  it("carries a migrated failure boundary into an exact successor retry", () => {
    const db = database();
    addJob(db, {
      id: "job-legacy-failure",
      status: "failed",
      createdAt: "2025-12-30T00:00:00.000Z",
      updatedAt: "2025-12-30T00:10:00.000Z",
    });
    addJob(db, {
      id: "job-legacy-completion",
      status: "failed",
      createdAt: "2025-12-31T00:00:00.000Z",
      updatedAt: "2025-12-31T00:10:00.000Z",
    });
    addJob(db, {
      id: "job-retry-one",
      status: "failed",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:10:00.000Z",
    });
    addJob(db, {
      id: "job-retry-two",
      status: "generating_learning_pages",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    const source = materializeCompletedLegacyLearnCouncilCheckpointAfterFailure(db, {
      proofId: "legacy-proof-one",
      failureOriginJobId: "job-legacy-failure",
      completionOriginJobId: "job-legacy-completion",
      checkpointId: "legacy-completion-one",
      requestHash: HASH_B,
      proof: legacyFailureProof(),
      councilRunId: "legacy-run-completed",
      responseHash: RESPONSE_HASH,
      now: "2026-01-01T00:05:00.000Z",
      ...stage("job-retry-one"),
    });

    const adopted = adoptCompletedLearnCouncilCheckpointWithBoundary(db, {
      checkpointId: "legacy-completion-two",
      boundaryProofId: "legacy-boundary-adoption-two",
      source,
      now: "2026-01-02T00:01:00.000Z",
      ...stage("job-retry-two"),
    });
    assert.equal(adopted.result_origin, "legacy");
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM learn_council_legacy_boundary_adoptions").get().count,
      1,
    );
    assert.equal(canStartLearnCouncilAfterLegacyAbsence(db, "job-retry-two"), true);
  });

  it("accepts a completed current native planning receipt as the first ordinary epoch fence", () => {
    const db = database();
    addJob(db, {
      id: "job-current",
      status: "planning",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    assert.equal(canStartLearnCouncilAfterLegacyAbsence(db, "job-current"), false);
    assert.equal(
      canStartLearnCouncilAfterLegacyAbsence(db, "job-current", {
        hasCompletedNativePlanningCheckpoint: true,
      }),
      true,
    );
  });

  it("keeps receipt absence separate from the one failed-provider redispatch", () => {
    const db = database();
    addJob(db, {
      id: "job-current",
      status: "generating_learning_pages",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    const source = createStartedLearnCouncilCheckpoint(db, {
      requestId: "ordinary-request-missing",
      requestHash: HASH_B,
      now: "2026-01-02T00:01:00.000Z",
      ...stage("job-current"),
    });
    const missingClaim = claimLearnCouncilMissingReceiptRecovery(db, {
      claimId: "missing-claim-one",
      checkpointId: source.checkpoint_id,
      source,
      requestHash: HASH_B,
      now: "2026-01-02T00:02:00.000Z",
      ...stage("job-current"),
    });
    const resumedMissingClaim = claimLearnCouncilMissingReceiptRecovery(db, {
      claimId: "missing-claim-after-crash",
      checkpointId: source.checkpoint_id,
      source: missingClaim,
      requestHash: HASH_B,
      now: "2026-01-02T00:03:00.000Z",
      ...stage("job-current"),
    });
    assert.equal(resumedMissingClaim.redispatch_count, 0);
    assert.equal(resumedMissingClaim.dispatch_attempt_count, 1);
    assert.deepEqual(
      learnCouncilDispatchGenerationOwners(db, "ordinary-request-missing").map(
        (owner) => [owner.dispatch_generation, owner.job_id],
      ),
      [[1, "job-current"]],
      "a proven missing receipt transfers generation 1 to the job that reissues it",
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM learn_council_missing_receipt_recoveries").get().count,
      1,
    );

    const failedRedispatch = claimLearnCouncilRedispatch(db, {
      checkpointId: source.checkpoint_id,
      source: resumedMissingClaim,
      requestHash: HASH_B,
      reason: "request_failed",
      now: "2026-01-02T00:04:00.000Z",
      ...stage("job-current"),
    });
    assert.equal(failedRedispatch.dispatch_attempt_count, 2);
    assert.equal(failedRedispatch.redispatch_count, 1);
    assert.equal(failedRedispatch.redispatch_reason, "request_failed");
  });

  it("transfers a claimed-but-unposted missing receipt recovery to a successor", () => {
    const db = database();
    addJob(db, {
      id: "job-missing-owner",
      status: "failed",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:10:00.000Z",
    });
    addJob(db, {
      id: "job-missing-successor",
      status: "generating_learning_pages",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    const source = createStartedLearnCouncilCheckpoint(db, {
      requestId: "receipt-unposted-missing-recovery",
      requestHash: HASH_B,
      now: "2026-01-01T00:01:00.000Z",
      ...stage("job-missing-owner"),
    });
    const claimed = claimLearnCouncilMissingReceiptRecovery(db, {
      claimId: "missing-recovery-transfer-claim",
      checkpointId: source.checkpoint_id,
      source,
      requestHash: HASH_B,
      now: "2026-01-01T00:02:00.000Z",
      ...stage("job-missing-owner"),
    });
    assert.throws(
      () => claimLearnCouncilMissingReceiptRecovery(db, {
        claimId: "unused-new-claim-id",
        checkpointId: "missing-recovery-successor-alias",
        source: claimed,
        requestHash: HASH_B,
        now: "2026-01-02T00:01:00.000Z",
        beforeOwnerTransfer: (
          priorOwnerJobId,
          receiptRequestId,
          exactRequestHash,
        ) => {
          assert.equal(priorOwnerJobId, "job-missing-owner");
          assert.equal(
            receiptRequestId,
            "receipt-unposted-missing-recovery",
          );
          assert.equal(exactRequestHash, HASH_B);
          throw new Error("injected atomic missing cleanup crash");
        },
        ...stage("job-missing-successor"),
      }),
      /injected atomic missing cleanup crash/,
    );
    assert.deepEqual(
      db.prepare(
        `SELECT authorized_job_id, claim_id
         FROM learn_council_missing_receipt_recoveries`,
      ).all(),
      [{
        authorized_job_id: "job-missing-owner",
        claim_id: "missing-recovery-transfer-claim",
      }],
      "a cleanup crash must roll back the claim transfer",
    );
    assert.deepEqual(
      learnCouncilDispatchGenerationOwners(
        db,
        "receipt-unposted-missing-recovery",
      ).map((owner) => [owner.dispatch_generation, owner.job_id]),
      [[1, "job-missing-owner"]],
    );
    assert.equal(
      db.prepare(
        `SELECT COUNT(*) AS count FROM learn_council_request_checkpoints
         WHERE job_id = ? AND stage_key = ? AND semantic_attempt = ?`,
      ).get(
        "job-missing-successor",
        "generation:page:unit-generic:draft",
        0,
      ).count,
      0,
    );
    const transferred = claimLearnCouncilMissingReceiptRecovery(db, {
      claimId: "unused-new-claim-id",
      checkpointId: "missing-recovery-successor-alias",
      source: claimed,
      requestHash: HASH_B,
      now: "2026-01-02T00:01:00.000Z",
      beforeOwnerTransfer: (
        priorOwnerJobId,
        receiptRequestId,
        exactRequestHash,
      ) => {
        assert.equal(priorOwnerJobId, "job-missing-owner");
        assert.equal(receiptRequestId, "receipt-unposted-missing-recovery");
        assert.equal(exactRequestHash, HASH_B);
      },
      ...stage("job-missing-successor"),
    });
    assert.equal(transferred.job_id, "job-missing-successor");
    assert.deepEqual(
      db.prepare(
        `SELECT authorized_job_id, claim_id
         FROM learn_council_missing_receipt_recoveries`,
      ).all(),
      [{
        authorized_job_id: "job-missing-successor",
        claim_id: "missing-recovery-transfer-claim",
      }],
    );
    assert.deepEqual(
      learnCouncilDispatchGenerationOwners(
        db,
        "receipt-unposted-missing-recovery",
      ).map((owner) => [owner.dispatch_generation, owner.job_id]),
      [[1, "job-missing-successor"]],
    );
  });

  it("selects an older exact completion only past terminal failure or proven absence", async () => {
    const db = database();
    addJob(db, {
      id: "job-older-completed",
      status: "failed",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:10:00.000Z",
    });
    addJob(db, {
      id: "job-newer-incomplete",
      status: "failed",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:10:00.000Z",
    });
    addJob(db, {
      id: "job-current",
      status: "generating_learning_pages",
      createdAt: "2026-01-03T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
    });
    const older = createStartedLearnCouncilCheckpoint(db, {
      requestId: "receipt-older-completed",
      requestHash: HASH_B,
      now: "2026-01-01T00:01:00.000Z",
      ...stage("job-older-completed"),
    });
    completeLearnCouncilReceiptChain(db, {
      receiptRequestId: older.receipt_request_id,
      requestHash: HASH_B,
      councilRunId: "run-older-completed",
      responseHash: RESPONSE_HASH,
      receiptDispatchCount: 1,
      now: "2026-01-01T00:02:00.000Z",
    });
    createStartedLearnCouncilCheckpoint(db, {
      requestId: "receipt-newer-incomplete",
      requestHash: HASH_B,
      now: "2026-01-02T00:01:00.000Z",
      ...stage("job-newer-incomplete"),
    });
    const candidates = priorLearnCouncilCheckpoints(db, {
      currentJobId: "job-current",
      ...stage("job-current"),
    });
    assert.deepEqual(candidates.map((row) => row.job.id), [
      "job-newer-incomplete",
      "job-older-completed",
    ]);

    for (const terminal of ["failed", "receipt_not_found"]) {
      const selected = await selectNewestCompletedLearnCouncilCheckpoint(
        candidates,
        async () => terminal,
      );
      assert.equal(selected.completed?.job.id, "job-older-completed");
      assert.equal(selected.newestIncomplete?.job.id, "job-newer-incomplete");
    }
    await assert.rejects(
      () => selectNewestCompletedLearnCouncilCheckpoint(
        candidates,
        async () => "request_started",
      ),
      /still started/,
    );
  });

  it("carries a skipped native missing boundary beside an adopted legacy completion", () => {
    const db = database();
    addJob(db, {
      id: "job-legacy-origin",
      status: "failed",
      createdAt: "2025-12-28T00:00:00.000Z",
      updatedAt: "2025-12-28T00:10:00.000Z",
    });
    addJob(db, {
      id: "job-legacy-completed",
      status: "failed",
      createdAt: "2025-12-29T00:00:00.000Z",
      updatedAt: "2025-12-29T00:10:00.000Z",
    });
    addJob(db, {
      id: "job-native-missing",
      status: "failed",
      createdAt: "2025-12-30T00:00:00.000Z",
      updatedAt: "2025-12-30T00:10:00.000Z",
    });
    addJob(db, {
      id: "job-retry-one",
      status: "generating_learning_pages",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const oldLegacy = materializeCompletedLegacyLearnCouncilCheckpoint(db, {
      checkpointId: "old-legacy-completion",
      originJobId: "job-legacy-origin",
      requestHash: HASH_B,
      councilRunId: "old-legacy-run",
      responseHash: RESPONSE_HASH,
      now: "2025-12-29T00:05:00.000Z",
      ...stage("job-legacy-completed"),
    });
    const nativeMissing = createStartedLearnCouncilCheckpoint(db, {
      requestId: "newer-native-missing",
      requestHash: HASH_B,
      now: "2025-12-30T00:05:00.000Z",
      ...stage("job-native-missing"),
    });
    recordLearnCouncilNativeLineageBoundary(db, {
      boundaryId: "native-boundary-retry-one",
      originJobId: "job-native-missing",
      requestHash: HASH_B,
      proof: {
        outcome: "receipt_not_found",
        receiptRequestId: nativeMissing.receipt_request_id,
        dispatchGeneration: null,
        dispatchCount: null,
        redispatchCount: null,
        redispatchAllowed: null,
        failureCode: null,
      },
      now: "2026-01-01T00:01:00.000Z",
      ...stage("job-retry-one"),
    });
    const currentLegacy = materializeCompletedLegacyLearnCouncilCheckpoint(db, {
      checkpointId: "current-legacy-completion",
      originJobId: oldLegacy.origin_job_id,
      requestHash: HASH_B,
      councilRunId: oldLegacy.council_run_id,
      responseHash: oldLegacy.response_hash,
      now: "2026-01-01T00:02:00.000Z",
      ...stage("job-retry-one"),
    });
    assert.equal(canStartLearnCouncilAfterLegacyAbsence(db, "job-retry-one"), true);

    db.prepare(
      "UPDATE learn_jobs SET status = 'failed', updated_at = ? WHERE id = ?",
    ).run("2026-01-01T00:10:00.000Z", "job-retry-one");
    addJob(db, {
      id: "job-retry-two",
      status: "generating_learning_pages",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    adoptCompletedLearnCouncilCheckpointWithBoundary(db, {
      checkpointId: "successor-legacy-completion",
      boundaryProofId: "successor-boundary-adoption",
      source: currentLegacy,
      now: "2026-01-02T00:01:00.000Z",
      ...stage("job-retry-two"),
    });
    assert.equal(canStartLearnCouncilAfterLegacyAbsence(db, "job-retry-two"), true);
    assert.equal(
      db.prepare(
        "SELECT COUNT(*) AS count FROM learn_council_native_lineage_boundaries",
      ).get().count,
      2,
    );
  });

  it("migrates the exact failed generation sequence before opening the first native later stage", () => {
    const db = database();
    addJob(db, {
      id: "job-earlier-generation",
      status: "failed",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:20:00.000Z",
    });
    addJob(db, {
      id: "job-newest-generation",
      status: "failed",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:20:00.000Z",
    });
    addJob(db, {
      id: "job-fixed-retry",
      status: "generating_learning_pages",
      createdAt: "2026-01-03T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
    });

    for (const [stageKey, requestHash, runId, responseHash] of [
      ["generation:topic_overview", "1".repeat(64), "run-overview-newest", "a".repeat(64)],
      ["generation:page:one-one:draft", "2".repeat(64), "run-one-one-newest", "b".repeat(64)],
    ]) {
      materializeCompletedLegacyLearnCouncilCheckpoint(db, {
        checkpointId: `checkpoint-${runId}`,
        originJobId: "job-newest-generation",
        requestHash,
        councilRunId: runId,
        responseHash,
        now: "2026-01-03T00:01:00.000Z",
        ...stage("job-fixed-retry", stageKey),
      });
    }

    materializeCompletedLegacyLearnCouncilCheckpointAfterFailure(db, {
      proofId: "proof-one-two-newest-failed",
      failureOriginJobId: "job-newest-generation",
      completionOriginJobId: "job-earlier-generation",
      checkpointId: "checkpoint-one-two-older-completed",
      requestHash: "3".repeat(64),
      proof: legacyFailureProof({
        councilRunId: "run-one-two-newest-failed",
        createdAt: "2026-01-02T00:10:00.000Z",
        updatedAt: "2026-01-02T00:11:00.000Z",
      }),
      councilRunId: "run-one-two-older-completed",
      responseHash: "c".repeat(64),
      now: "2026-01-03T00:02:00.000Z",
      ...stage("job-fixed-retry", "generation:page:one-two:draft"),
    });

    assert.equal(canStartLearnCouncilAfterLegacyAbsence(db, "job-fixed-retry"), true);
    const firstNativeLaterStage = createStartedLearnCouncilCheckpoint(db, {
      requestId: "native-one-three-request",
      requestHash: "4".repeat(64),
      now: "2026-01-03T00:03:00.000Z",
      ...stage("job-fixed-retry", "generation:page:one-three:draft"),
    });
    assert.equal(firstNativeLaterStage.result_origin, "receipt");
    assert.equal(firstNativeLaterStage.dispatch_attempt_count, 1);
    assert.deepEqual(
      db.prepare(
        `SELECT stage_key, origin_job_id, result_origin, state
         FROM learn_council_request_checkpoints
         WHERE job_id = ? ORDER BY created_at, rowid`,
      ).all("job-fixed-retry"),
      [
        {
          stage_key: "generation:topic_overview",
          origin_job_id: "job-newest-generation",
          result_origin: "legacy",
          state: "completed",
        },
        {
          stage_key: "generation:page:one-one:draft",
          origin_job_id: "job-newest-generation",
          result_origin: "legacy",
          state: "completed",
        },
        {
          stage_key: "generation:page:one-two:draft",
          origin_job_id: "job-earlier-generation",
          result_origin: "legacy",
          state: "completed",
        },
        {
          stage_key: "generation:page:one-three:draft",
          origin_job_id: "job-fixed-retry",
          result_origin: "receipt",
          state: "started",
        },
      ],
    );
  });

  it("rejects multiple failure-only legacy outcomes and malformed endpoint proofs", () => {
    assert.doesNotThrow(() =>
      assertUniqueLegacyLearnCouncilFailureWithoutCompletion(1, false));
    assert.doesNotThrow(() =>
      assertUniqueLegacyLearnCouncilFailureWithoutCompletion(2, true));
    assert.throws(
      () => assertUniqueLegacyLearnCouncilFailureWithoutCompletion(2, false),
      /Multiple legacy failed\/no-final outcomes/,
    );

    const valid = {
      outcome: "failed",
      councilRunId: "legacy-failed-run",
      finalAnswerPresent: false,
      candidateCount: 0,
      failureCode: "connection_closed",
      failurePhase: "receive",
      partialOutput: true,
      replaySafe: false,
      councilMode: "direct_council",
      requestedModel: "model-generic",
      resolvedModel: "model-generic",
      usage: { callCount: 1, reportedCallCount: 0 },
      modelRouting: [{ outcome: "failed" }],
      createdAt: "2026-01-01T00:01:00.000Z",
      updatedAt: "2026-01-01T00:02:00.000Z",
    };
    assert.equal(isExactLegacyLearnCouncilFailureShape(valid), true);
    for (const malformed of [
      { ...valid, usage: { callCount: "1", reportedCallCount: 0 } },
      { ...valid, failurePhase: undefined },
      { ...valid, partialOutput: "true" },
      { ...valid, replaySafe: undefined },
      { ...valid, modelRouting: [{ outcome: "failed" }, { outcome: "failed" }] },
    ]) {
      assert.equal(isExactLegacyLearnCouncilFailureShape(malformed), false);
    }
  });

  it("persists a skipped newer native boundary before adopting an older native completion", () => {
    const db = database();
    addJob(db, {
      id: "job-native-completed-older",
      status: "failed",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:10:00.000Z",
    });
    addJob(db, {
      id: "job-native-missing-newer",
      status: "failed",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:10:00.000Z",
    });
    addJob(db, {
      id: "job-current",
      status: "generating_learning_pages",
      createdAt: "2026-01-03T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
    });
    const older = createStartedLearnCouncilCheckpoint(db, {
      requestId: "older-native-completed",
      requestHash: HASH_B,
      now: "2026-01-01T00:01:00.000Z",
      ...stage("job-native-completed-older"),
    });
    const [olderCompleted] = completeLearnCouncilReceiptChain(db, {
      receiptRequestId: older.receipt_request_id,
      requestHash: HASH_B,
      councilRunId: "older-native-run",
      responseHash: RESPONSE_HASH,
      receiptDispatchCount: 1,
      now: "2026-01-01T00:02:00.000Z",
    });
    const newer = createStartedLearnCouncilCheckpoint(db, {
      requestId: "newer-native-missing",
      requestHash: HASH_B,
      now: "2026-01-02T00:01:00.000Z",
      ...stage("job-native-missing-newer"),
    });
    recordLearnCouncilNativeLineageBoundary(db, {
      boundaryId: "newer-native-boundary-current",
      originJobId: "job-native-missing-newer",
      requestHash: HASH_B,
      proof: {
        outcome: "receipt_not_found",
        receiptRequestId: newer.receipt_request_id,
        dispatchGeneration: null,
        dispatchCount: null,
        redispatchCount: null,
        redispatchAllowed: null,
        failureCode: null,
      },
      now: "2026-01-03T00:01:00.000Z",
      ...stage("job-current"),
    });
    const adopted = adoptCompletedLearnCouncilCheckpoint(db, {
      checkpointId: "older-native-adopted-current",
      source: olderCompleted,
      now: "2026-01-03T00:02:00.000Z",
      ...stage("job-current"),
    });
    assert.equal(adopted.result_origin, "receipt");
    assert.equal(hasNativeLearnCouncilCheckpoint(db, "job-current"), true);
    assert.equal(
      db.prepare(
        "SELECT COUNT(*) AS count FROM learn_council_native_lineage_boundaries WHERE authorized_job_id = ?",
      ).get("job-current").count,
      1,
    );
  });
});
