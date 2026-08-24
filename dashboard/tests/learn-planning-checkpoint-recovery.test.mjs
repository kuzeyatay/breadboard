import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import Database from "better-sqlite3";

import {
  canonicalCouncilJsonV1,
  councilRequestHashV1,
} from "../src/lib/council-request-hash.ts";
import {
  appendDurablePlanningIssuanceEvent,
  classifyLegacyStageIssuanceEvidence,
  completePlanningCheckpoint,
  completePlanningCheckpointWithAdoption,
  createStartedPlanningCheckpoint,
  dispatchAfterExactPlanningAuthority,
  dispatchAfterDurablePlanningIssuance,
  ensureLearnPlanningCheckpointSchema,
  exactStrictReceiptOriginBinding,
  hasCompletedNativePlanningCheckpoint,
  hasExactPlanningDispatchAuthority,
  materializeLegacyPlanningCheckpoint,
  materializedLegacyPlanningResults,
  PlanningRecoveryBoundaryError,
  planningCheckpointRecoveryDisposition,
  priorPlanningCheckpoints,
  recoverBeforePlanningDispatch,
  resolveUniquePlanningCandidate,
} from "../src/lib/learn-planning-checkpoints.ts";
import {
  assertLegacyPlanningWaiverFullyMaterialized,
  assertLegacyPlanningWaiverMatchesInventory,
  assertLegacyPlanningWaiverPredatesCurrentJob,
  assertNextLegacyPlanningWaiverResult,
  createLegacyPlanningWaiverReceipt,
  LEGACY_PLANNING_WAIVER_ACK,
  persistLegacyPlanningWaiverExercise,
  readExactLegacyPlanningWaiver,
} from "../src/lib/learn-planning-legacy-waiver.ts";
import { auditedLegacyPlanningInventory } from "../src/lib/learn-planning-legacy-inventory.ts";
import { strictChatMockInternalRecoveryUrl } from "../src/lib/learn-planning-internal-url.ts";
import {
  expectedStrictLearnModelRoute,
  planningReceiptProvesOneExactModelCall,
} from "../src/lib/learn-planning-route-proof.ts";
import { modelAuthoredSyllabusPlanProblems } from "../src/lib/learn-syllabus.ts";

const learnSource = fs.readFileSync(new URL("../src/lib/learn.ts", import.meta.url), "utf8");
const golden = JSON.parse(
  fs.readFileSync(
    new URL("../../chatmock/tests/fixtures/council_request_hash_v1.json", import.meta.url),
    "utf8",
  ),
);

function fixtureDatabase(databasePath = ":memory:") {
  const database = new Database(databasePath);
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE learn_jobs (
      id TEXT PRIMARY KEY,
      garden_id TEXT NOT NULL,
      user_id INTEGER,
      model TEXT,
      status TEXT,
      current_step TEXT,
      error TEXT,
      source_set_hash TEXT,
      source_ids_json TEXT,
      syllabus_source_id TEXT,
      source_only INTEGER,
      include_source_snapshots INTEGER,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE learn_job_token_usage (
      job_id TEXT PRIMARY KEY,
      started_requests INTEGER,
      completed_requests INTEGER,
      reported_requests INTEGER,
      request_model TEXT,
      reasoning_effort TEXT,
      reasoning_summary TEXT,
      policy_observed_requests INTEGER,
      policy_mismatch_requests INTEGER,
      usage_updated_at TEXT
    );
    CREATE TABLE learn_maps (job_id TEXT NOT NULL);
    CREATE TABLE learn_versions (job_id TEXT NOT NULL);
  `);
  ensureLearnPlanningCheckpointSchema(database);
  return database;
}

function insertJob(database, {
  id,
  userId = 7,
  sourceSetHash = "source-hash-a",
  sourceIds = ["source-a"],
  model = "gpt-fixture",
  status = "failed",
  currentStep = "fixture failure",
  error = "fixture error",
  createdAt = "2030-01-01T00:00:00.000Z",
  updatedAt = "2030-01-01T00:01:00.000Z",
} = {}) {
  database.prepare(`
    INSERT INTO learn_jobs (
      id, garden_id, user_id, model, status, current_step, error,
      source_set_hash, source_ids_json, syllabus_source_id, source_only,
      include_source_snapshots, created_at, updated_at
    ) VALUES (?, 'fixture-garden', ?, ?, ?, ?, ?, ?, ?, 'fixture-syllabus', 1, 0, ?, ?)
  `).run(
    id,
    userId,
    model,
    status,
    currentStep,
    error,
    sourceSetHash,
    JSON.stringify(sourceIds),
    createdAt,
    updatedAt,
  );
  database.prepare(`
    INSERT INTO learn_job_token_usage (
      job_id, started_requests, completed_requests, reported_requests,
      request_model, reasoning_effort, reasoning_summary,
      policy_observed_requests, policy_mismatch_requests, usage_updated_at
    ) VALUES (?, 2, 2, 2, ?, 'max', 'detailed', 2, 0, ?)
  `).run(id, model, updatedAt);
}

async function startInventoryFixtureServer(payload, mutation = null) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const encodedMutation = Buffer.from(JSON.stringify(mutation), "utf8").toString("base64");
  const script = `
    const http = require("node:http");
    const payload = Buffer.from(process.argv[1], "base64").toString("utf8");
    const mutation = JSON.parse(Buffer.from(process.argv[2], "base64").toString("utf8"));
    let mutated = false;
    const server = http.createServer((request, response) => {
      if (request.method !== "GET" || !request.url.startsWith("/v1/internal/council-results/legacy-inventory?")) {
        response.writeHead(405).end();
        return;
      }
      if (mutation && !mutated) {
        mutated = true;
        const Database = require("better-sqlite3");
        const database = new Database(mutation.databasePath);
        database.prepare(
          "INSERT INTO learn_jobs (id, garden_id, created_at, updated_at) VALUES (?, 'fixture-garden', ?, ?)"
        ).run(mutation.id, mutation.createdAt, mutation.createdAt);
        database.close();
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(payload);
    });
    server.listen(0, "127.0.0.1", () => process.stdout.write(String(server.address().port) + "\\n"));
  `;
  const child = spawn(process.execPath, ["-e", script, encoded, encodedMutation], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const port = await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => reject(new Error(`fixture server timeout: ${stderr}`)), 5_000);
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const line = stdout.match(/^(\d+)\r?\n/);
      if (!line) return;
      clearTimeout(timeout);
      resolve(Number(line[1]));
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`fixture server exited ${code}: ${stderr}`));
    });
  });
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () => child.kill(),
  };
}

test("TypeScript canonical v1 matches the shared Python golden across numeric and Unicode traps", () => {
  assert.equal(councilRequestHashV1(golden.envelope), golden.expectedHash);
  const canonical = canonicalCouncilJsonV1(golden.envelope);
  assert.match(canonical, /"negativeZero":\{"\$number":"i:0"\}/);
  assert.match(canonical, /"oneFloat":\{"\$number":"i:1"\}/);
  assert.match(canonical, /"safeIntegerMaximum":\{"\$number":"i:9007199254740991"\}/);
  assert.ok(
    canonical.indexOf('"numericKeyOrder":{"10":"ten","2":"two"}') >= 0,
    "custom writer must retain recursive UTF-16 lexical key order even for array-index-like keys",
  );
  assert.ok(canonical.indexOf('"😀"') < canonical.indexOf('""'));
  assert.throws(
    () => canonicalCouncilJsonV1({ value: 9_007_199_254_740_992 }),
    /safe integers/,
  );
});

test("checkpoint rows contain bindings only and allow two distinct reauthor cycles", () => {
  const database = fixtureDatabase();
  insertJob(database, { id: "job-origin" });
  const columns = database
    .prepare("PRAGMA table_info(learn_planning_request_checkpoints)")
    .all()
    .map((column) => column.name);
  assert.equal(columns.some((name) => /prompt|answer|content|messages/i.test(name)), false);

  createStartedPlanningCheckpoint(database, {
    requestId: "lrq_fixture_cycle_0000",
    jobId: "job-origin",
    gardenId: "fixture-garden",
    stageKey: "source_map:source_map:cycle:0",
    semanticAttempt: 0,
    requestHash: "a".repeat(64),
    now: "2030-01-01T00:00:10.000Z",
  });
  createStartedPlanningCheckpoint(database, {
    requestId: "lrq_fixture_cycle_0001",
    jobId: "job-origin",
    gardenId: "fixture-garden",
    stageKey: "source_map:source_map:cycle:1",
    semanticAttempt: 0,
    requestHash: "b".repeat(64),
    now: "2030-01-01T00:00:20.000Z",
  });
  assert.throws(
    () => createStartedPlanningCheckpoint(database, {
      requestId: "lrq_fixture_cycle_duplicate",
      jobId: "job-origin",
      gardenId: "fixture-garden",
      stageKey: "source_map:source_map:cycle:1",
      semanticAttempt: 0,
      requestHash: "c".repeat(64),
      now: "2030-01-01T00:00:30.000Z",
    }),
    /UNIQUE constraint failed/,
  );

  completePlanningCheckpoint(database, {
    requestId: "lrq_fixture_cycle_0000",
    requestHash: "a".repeat(64),
    councilRunId: "crun_fixture_cycle_0000",
    responseHash: "d".repeat(64),
    now: "2030-01-01T00:00:40.000Z",
  });
  const rows = database
    .prepare("SELECT * FROM learn_planning_request_checkpoints ORDER BY stage_key")
    .all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].state, "completed");
  assert.equal(rows[1].state, "started");
  database.close();
});

test("checkpoint schema upgrades the pre-result-origin table without losing rows", () => {
  const database = fixtureDatabase();
  insertJob(database, { id: "job-origin" });
  database.exec(`
    DROP TABLE learn_planning_request_checkpoints;
    CREATE TABLE learn_planning_request_checkpoints (
      request_id       TEXT PRIMARY KEY,
      job_id            TEXT NOT NULL REFERENCES learn_jobs(id) ON DELETE CASCADE,
      garden_id         TEXT NOT NULL,
      stage_key         TEXT NOT NULL,
      semantic_attempt  INTEGER NOT NULL CHECK (semantic_attempt >= 0),
      request_hash      TEXT NOT NULL CHECK (length(request_hash) = 64),
      state             TEXT NOT NULL CHECK (state IN ('started', 'completed')),
      council_run_id    TEXT,
      response_hash     TEXT,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL,
      completed_at      TEXT,
      UNIQUE(job_id, stage_key, semantic_attempt)
    );
  `);
  database.prepare(`
    INSERT INTO learn_planning_request_checkpoints (
      request_id, job_id, garden_id, stage_key, semantic_attempt,
      request_hash, state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'started', ?, ?)
  `).run(
    "lrq_fixture_pre_migration",
    "job-origin",
    "fixture-garden",
    "source_map:source_map:cycle:1",
    0,
    "a".repeat(64),
    "2030-01-01T00:00:10.000Z",
    "2030-01-01T00:00:10.000Z",
  );

  ensureLearnPlanningCheckpointSchema(database);
  ensureLearnPlanningCheckpointSchema(database);
  const row = database.prepare(
    "SELECT request_id, result_origin, state FROM learn_planning_request_checkpoints",
  ).get();
  assert.deepEqual(row, {
    request_id: "lrq_fixture_pre_migration",
    result_origin: "receipt",
    state: "started",
  });
  database.close();
});

test("two connections serialize the additive checkpoint migration", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "learn-checkpoint-migration-"));
  const databasePath = path.join(root, "brain.db");
  const database = new Database(databasePath);
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE learn_jobs (id TEXT PRIMARY KEY);
    INSERT INTO learn_jobs (id) VALUES ('job-origin');
    CREATE TABLE learn_planning_request_checkpoints (
      request_id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES learn_jobs(id) ON DELETE CASCADE,
      garden_id TEXT NOT NULL,
      stage_key TEXT NOT NULL,
      semantic_attempt INTEGER NOT NULL,
      request_hash TEXT NOT NULL,
      state TEXT NOT NULL,
      council_run_id TEXT,
      response_hash TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE(job_id, stage_key, semantic_attempt)
    );
    INSERT INTO learn_planning_request_checkpoints (
      request_id, job_id, garden_id, stage_key, semantic_attempt,
      request_hash, state, created_at, updated_at
    ) VALUES (
      'lrq-old', 'job-origin', 'garden', 'stage', 0,
      '${"a".repeat(64)}', 'started', '2030-01-01T00:00:00.000Z',
      '2030-01-01T00:00:00.000Z'
    );
  `);
  database.close();

  const barrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
  const workerSource = `
    const { parentPort, workerData } = require("node:worker_threads");
    (async () => {
      const { default: Database } = await import(workerData.databaseModule);
      const { ensureLearnPlanningCheckpointSchema } = await import(workerData.checkpointModule);
      const signal = new Int32Array(workerData.barrier);
      const db = new Database(workerData.databasePath);
      db.pragma("busy_timeout = 5000");
      Atomics.add(signal, 0, 1);
      parentPort.postMessage("ready");
      Atomics.wait(signal, 1, 0);
      ensureLearnPlanningCheckpointSchema(db);
      db.close();
      parentPort.postMessage("done");
    })().catch((error) => parentPort.postMessage({ error: String(error?.stack || error) }));
  `;
  const workerData = {
    barrier,
    databasePath,
    databaseModule: pathToFileURL(
      path.resolve("node_modules/better-sqlite3/lib/index.js"),
    ).href,
    checkpointModule: new URL(
      "../src/lib/learn-planning-checkpoints.ts",
      import.meta.url,
    ).href,
  };
  const workers = [0, 1].map(() => new Worker(workerSource, {
    eval: true,
    workerData,
  }));
  try {
    await Promise.all(workers.map((worker) => new Promise((resolve, reject) => {
      worker.once("error", reject);
      worker.once("message", (message) => {
        if (message === "ready") resolve();
        else reject(new Error(message?.error ?? `unexpected worker message: ${message}`));
      });
    })));
    const completions = workers.map((worker) => new Promise((resolve, reject) => {
      worker.once("error", reject);
      worker.on("message", (message) => {
        if (message === "done") resolve();
        else if (message?.error) reject(new Error(message.error));
      });
    }));
    Atomics.store(new Int32Array(barrier), 1, 1);
    Atomics.notify(new Int32Array(barrier), 1, 2);
    await Promise.all(completions);
    const verified = new Database(databasePath, { readonly: true });
    const columns = verified.prepare(
      "PRAGMA table_info(learn_planning_request_checkpoints)",
    ).all().map((column) => column.name);
    assert.ok(columns.includes("result_origin"));
    assert.ok(columns.includes("receipt_request_id"));
    assert.deepEqual(
      verified.prepare(
        "SELECT request_id, result_origin, state FROM learn_planning_request_checkpoints",
      ).get(),
      { request_id: "lrq-old", result_origin: "receipt", state: "started" },
    );
    verified.close();
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("prior checkpoint projection retains user, source, syllabus, policy, and no-artifact evidence", () => {
  const database = fixtureDatabase();
  insertJob(database, { id: "job-origin" });
  insertJob(database, {
    id: "job-current",
    status: "planning_source_map",
    currentStep: "Reading syllabus",
    error: null,
    createdAt: "2030-01-01T00:02:00.000Z",
    updatedAt: "2030-01-01T00:02:00.000Z",
  });
  createStartedPlanningCheckpoint(database, {
    requestId: "lrq_fixture_projection_0001",
    jobId: "job-origin",
    gardenId: "fixture-garden",
    stageKey: "source_map:syllabus_reading",
    semanticAttempt: 0,
    requestHash: "e".repeat(64),
    now: "2030-01-01T00:00:10.000Z",
  });

  let rows = priorPlanningCheckpoints(database, {
    currentJobId: "job-current",
    gardenId: "fixture-garden",
    stageKey: "source_map:syllabus_reading",
    semanticAttempt: 0,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].job_user_id, 7);
  assert.equal(rows[0].garden_id, "fixture-garden");
  assert.equal(rows[0].job_garden_id, "fixture-garden");
  assert.equal(rows[0].job_source_set_hash, "source-hash-a");
  assert.equal(rows[0].job_source_ids_json, '["source-a"]');
  assert.equal(rows[0].job_syllabus_source_id, "fixture-syllabus");
  assert.equal(rows[0].request_model, "gpt-fixture");
  assert.equal(rows[0].reasoning_effort, "max");
  assert.equal(rows[0].reasoning_summary, "detailed");
  assert.equal(rows[0].policy_mismatch_requests, 0);
  assert.equal(rows[0].map_count, 0);
  assert.equal(rows[0].version_count, 0);

  database.prepare("UPDATE learn_jobs SET source_set_hash = 'different' WHERE id = 'job-origin'").run();
  database.prepare("UPDATE learn_job_token_usage SET policy_mismatch_requests = 1 WHERE job_id = 'job-origin'").run();
  rows = priorPlanningCheckpoints(database, {
    currentJobId: "job-current",
    gardenId: "fixture-garden",
    stageKey: "source_map:syllabus_reading",
    semanticAttempt: 0,
  });
  assert.equal(rows[0].job_source_set_hash, "different");
  assert.equal(rows[0].policy_mismatch_requests, 1);
  assert.match(learnSource, /origin\.job_source_set_hash !== current\.source_set_hash/);
  assert.match(learnSource, /origin\.job_user_id !== current\.user_id/);
  assert.match(learnSource, /Number\(origin\.policy_mismatch_requests \?\? 0\) !== 0/);
  database.close();
});

test("the promptless resolver is GET-only and exact routing is retained for validation", () => {
  const resolverStart = learnSource.indexOf("async function promptlessCouncilResultGet");
  const resolverEnd = learnSource.indexOf("function recoveredCouncilCallResult", resolverStart);
  const resolver = learnSource.slice(resolverStart, resolverEnd);
  assert.match(resolver, /method: "GET"/);
  assert.match(resolver, /await fetch\(/);
  assert.doesNotMatch(resolver, /chat\.completions\.create/);
  assert.match(learnSource, /row\.state === "started"/);
  assert.match(learnSource, /planningReceiptProvesOneExactModelCall\(result, expectedModel\)/);
  assert.match(learnSource, /A clean completed receipt from an ordinary semantic-failure job is not/);
});

function strictRouteReceipt({
  model,
  provider,
  upstreamModel,
  overrides = {},
}) {
  return {
    councilRunId: "crun-route-proof",
    councilMode: "direct_council",
    requestedModel: model,
    resolvedModel: model,
    modelRouting: [
      {
        endpoint: "council",
        requestedModel: model,
        resolvedModel: model,
        upstreamModel,
        provider,
        requestId: "crun-route-proof",
        outcome: "succeeded",
        fallback: false,
      },
    ],
    usage: { callCount: 1, reportedCallCount: 1 },
    ...overrides,
  };
}

test("exact planning route proof supports canonical bare and external nested model ids", () => {
  assert.deepEqual(expectedStrictLearnModelRoute("gpt-fixture"), {
    requestedModel: "gpt-fixture",
    resolvedModel: "gpt-fixture",
    provider: "chatgpt",
    upstreamModel: "gpt-fixture",
  });
  assert.equal(
    planningReceiptProvesOneExactModelCall(
      strictRouteReceipt({
        model: "gpt-fixture",
        provider: "chatgpt",
        upstreamModel: "gpt-fixture",
      }),
      "gpt-fixture",
    ),
    true,
  );

  const externalModel = "cliproxy/vendor/gemini-fixture";
  assert.deepEqual(expectedStrictLearnModelRoute(externalModel), {
    requestedModel: externalModel,
    resolvedModel: externalModel,
    provider: "cliproxy",
    upstreamModel: "vendor/gemini-fixture",
  });
  const externalReceipt = strictRouteReceipt({
    model: externalModel,
    provider: "cliproxy",
    upstreamModel: "vendor/gemini-fixture",
  });
  assert.equal(planningReceiptProvesOneExactModelCall(externalReceipt, externalModel), true);
  assert.equal(
    planningReceiptProvesOneExactModelCall(
      { ...externalReceipt, modelRouting: [{ ...externalReceipt.modelRouting[0], provider: "chatgpt" }] },
      externalModel,
    ),
    false,
  );
  assert.equal(
    planningReceiptProvesOneExactModelCall(
      { ...externalReceipt, modelRouting: [{ ...externalReceipt.modelRouting[0], upstreamModel: externalModel }] },
      externalModel,
    ),
    false,
  );
  assert.equal(expectedStrictLearnModelRoute("default"), null);
  assert.equal(expectedStrictLearnModelRoute("chatgpt/gpt-fixture"), null);
});

async function executeRecoveryBoundary({ candidates, expectedHash = "a".repeat(64), resolve }) {
  let providerPosts = 0;
  let resolveGets = 0;
  const client = {
    chat: {
      completions: {
        create: async () => {
          providerPosts += 1;
          return { content: "fresh-post" };
        },
      },
    },
  };
  const result = await recoverBeforePlanningDispatch({
    recover: () =>
      resolveUniquePlanningCandidate({
        candidates,
        expectedRequestHash: expectedHash,
        resolve: async (candidate) => {
          resolveGets += 1;
          return resolve(candidate);
        },
      }),
    dispatch: () => client.chat.completions.create(),
  });
  return { result, providerPosts, resolveGets };
}

function boundaryCandidate({
  id,
  state = "started",
  resultOrigin = "receipt",
  exactBinding = true,
  abandonedLineage = "none",
  requestHash = "a".repeat(64),
}) {
  return {
    candidate: { id },
    requestHash,
    disposition: planningCheckpointRecoveryDisposition({
      state,
      resultOrigin,
      exactBinding,
      abandonedLineage,
    }),
  };
}

test("started transport ambiguity, completed abandoned, and legacy candidates recover with zero POST", async () => {
  for (const candidate of [
    boundaryCandidate({ id: "started-transport" }),
    boundaryCandidate({
      id: "completed-abandoned",
      state: "completed",
      abandonedLineage: "valid",
    }),
    boundaryCandidate({
      id: "legacy-abandoned",
      state: "completed",
      resultOrigin: "legacy",
      abandonedLineage: "valid",
    }),
  ]) {
    const run = await executeRecoveryBoundary({
      candidates: [candidate],
      resolve: async ({ id }) => ({ content: `recovered:${id}` }),
    });
    assert.equal(run.providerPosts, 0);
    assert.equal(run.resolveGets, 1);
    assert.match(run.result.content, /^recovered:/);
  }
});

test("a crashed reauthor cycle stays recoverable when derived source and token telemetry drift", async () => {
  const database = fixtureDatabase();
  insertJob(database, {
    id: "job-origin",
    sourceSetHash: "derived-before-page-scan",
  });
  insertJob(database, {
    id: "job-current",
    sourceSetHash: "derived-after-page-scan",
    status: "planning_source_map",
    currentStep: "Reauthoring Source Map",
    error: null,
    createdAt: "2030-01-01T00:02:00.000Z",
    updatedAt: "2030-01-01T00:02:00.000Z",
  });
  // Simulate the token-policy listener persistence failure that used to make
  // an otherwise durable strict receipt disappear from recovery eligibility.
  database.prepare("DELETE FROM learn_job_token_usage WHERE job_id = 'job-origin'").run();
  createStartedPlanningCheckpoint(database, {
    requestId: "lrq_fixture_reauthor_crash",
    jobId: "job-origin",
    gardenId: "fixture-garden",
    stageKey: "source_map:source_map:cycle:1",
    semanticAttempt: 0,
    requestHash: "a".repeat(64),
    now: "2030-01-01T00:01:30.000Z",
  });
  const [row] = priorPlanningCheckpoints(database, {
    currentJobId: "job-current",
    gardenId: "fixture-garden",
    stageKey: "source_map:source_map:cycle:1",
    semanticAttempt: 0,
  });
  const current = database.prepare("SELECT * FROM learn_jobs WHERE id = 'job-current'").get();
  assert.equal(row.job_source_set_hash, "derived-before-page-scan");
  assert.equal(current.source_set_hash, "derived-after-page-scan");
  assert.equal(row.request_model, null);
  assert.equal(row.reasoning_effort, null);
  assert.equal(exactStrictReceiptOriginBinding(row, current), true);

  const run = await executeRecoveryBoundary({
    candidates: [{
      candidate: row,
      requestHash: row.request_hash,
      disposition: planningCheckpointRecoveryDisposition({
        state: row.state,
        resultOrigin: row.result_origin,
        exactBinding: exactStrictReceiptOriginBinding(row, current),
        abandonedLineage: "none",
      }),
    }],
    resolve: async () => ({ content: "recovered-cycle-1" }),
  });
  assert.equal(run.providerPosts, 0);
  assert.equal(run.resolveGets, 1);
  assert.equal(run.result.content, "recovered-cycle-1");
  database.close();
});

test("unresolved, hash-drift, multiple, and torn recovery all make zero provider POSTs", async () => {
  const scenarios = [
    {
      name: "unresolved started receipt",
      candidates: [boundaryCandidate({ id: "unresolved" })],
      resolve: async () => null,
      code: "result_unresolved",
    },
    {
      name: "eligible hash drift",
      candidates: [boundaryCandidate({ id: "hash-drift", requestHash: "b".repeat(64) })],
      resolve: async () => ({ content: "must-not-resolve" }),
      code: "request_hash_mismatch",
    },
    {
      name: "multiple exact candidates",
      candidates: [
        boundaryCandidate({ id: "multiple-a" }),
        boundaryCandidate({ id: "multiple-b" }),
      ],
      resolve: async () => ({ content: "must-not-resolve" }),
      code: "candidate_multiple",
    },
  ];
  for (const scenario of scenarios) {
    let providerPosts = 0;
    const client = { chat: { completions: { create: async () => { providerPosts += 1; } } } };
    await assert.rejects(
      () => recoverBeforePlanningDispatch({
        recover: () => resolveUniquePlanningCandidate({
          candidates: scenario.candidates,
          expectedRequestHash: "a".repeat(64),
          resolve: scenario.resolve,
        }),
        dispatch: () => client.chat.completions.create(),
      }),
      (error) => error instanceof PlanningRecoveryBoundaryError && error.code === scenario.code,
      scenario.name,
    );
    assert.equal(providerPosts, 0, scenario.name);
  }

  let tornPosts = 0;
  await assert.rejects(
    () => recoverBeforePlanningDispatch({
      recover: () => resolveUniquePlanningCandidate({
        candidates: [boundaryCandidate({ id: "torn" })],
        expectedRequestHash: "a".repeat(64),
        resolve: async () => { throw new Error("receipt_corrupt"); },
      }),
      dispatch: async () => { tornPosts += 1; return { content: "fresh" }; },
    }),
    /receipt_corrupt/,
  );
  assert.equal(tornPosts, 0);
});

test("repair issuance persistence failure makes provider dispatch unreachable", async () => {
  let providerPosts = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      () => dispatchAfterDurablePlanningIssuance({
        persist: () => {
          throw new Error("injected issuance fsync failure");
        },
        dispatch: async () => {
          providerPosts += 1;
          return "must-not-dispatch";
        },
      }),
      /injected issuance fsync failure/,
    );
  }
  assert.equal(providerPosts, 0, "neither the first attempt nor a replay may POST");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "learn-planning-issuance-"));
  try {
    appendDurablePlanningIssuanceEvent({
      contentPath: root,
      gardenId: "fixture-garden",
      type: "learn_planning_schema_repair_started",
      at: "2030-01-01T00:01:00.000Z",
      data: {
        jobId: "job-fixture",
        taskType: "source_map",
        stageKey: "source_map:syllabus_reading",
        stageLabel: "Syllabus reading",
        repairAttempt: 1,
      },
    });
    const [entry] = fs
      .readFileSync(path.join(root, "fixture-garden", ".breadboard", "events.jsonl"), "utf8")
      .trim()
      .split(/\r?\n/)
      .map(JSON.parse);
    assert.equal(entry.type, "learn_planning_schema_repair_started");
    assert.equal(entry.stageKey, "source_map:syllabus_reading");
    assert.equal(entry.timestamp, "2030-01-01T00:01:00.000Z");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("genuine later-stage NO_PRIOR and source/policy mismatch make one legitimate POST", async () => {
  for (const candidates of [
    [],
    [boundaryCandidate({ id: "different-selection", exactBinding: false })],
    [boundaryCandidate({
      id: "ordinary-semantic-failure",
      state: "completed",
      abandonedLineage: "none",
    })],
  ]) {
    const run = await executeRecoveryBoundary({
      candidates,
      resolve: async () => ({ content: "must-not-resolve" }),
    });
    assert.equal(run.providerPosts, 1);
    assert.equal(run.resolveGets, 0);
    assert.equal(run.result.content, "fresh-post");
  }
});

test("legacy recovered initial-invalid then repair-valid stays behind the real validator gates", () => {
  const valid = {
    courseTitle: "Fixture Course",
    units: [{
      id: "SU1",
      label: "Week 1",
      title: "Fixture topic",
      objectives: ["Explain the fixture"],
      topics: ["fixture"],
      materialIds: ["R1"],
    }],
    referencedMaterials: [{
      id: "R1",
      citation: "Fixture Text, chapter 1",
      title: "Fixture Text",
      authors: ["Fixture Author"],
      kind: "chapter",
      locator: "chapter 1",
      required: true,
    }],
  };
  const invalid = structuredClone(valid);
  invalid.referencedMaterials[0].locator = " chapter 1 ";
  assert.ok(modelAuthoredSyllabusPlanProblems(invalid).length > 0);
  assert.deepEqual(modelAuthoredSyllabusPlanProblems(valid), []);

  const validatedStart = learnSource.indexOf("async function callValidatedPlanningJson");
  const validatedEnd = learnSource.indexOf("function modelTextCandidateOrThrow", validatedStart);
  const validatedLoop = learnSource.slice(validatedStart, validatedEnd);
  const nonemptyIndex = validatedLoop.indexOf("assertNonemptyPlanningCandidate(result, stageLabel)");
  const validatorIndex = validatedLoop.indexOf("let problems = validate(result.parsed)");
  const repairIndex = validatedLoop.indexOf(
    "result = await dispatchAfterDurablePlanningIssuance",
    validatorIndex,
  );
  assert.ok(nonemptyIndex >= 0 && nonemptyIndex < validatorIndex && validatorIndex < repairIndex);
  assert.match(validatedLoop, /semanticAttempt: repairAttempt/);
  assert.match(learnSource, /source_map:syllabus_reading/);
  assert.match(learnSource, /\/internal\/council-results\/legacy-resolve/);
  assert.match(learnSource, /classifyLegacyStageIssuanceEvidence/);
});

test("legacy stage evidence is diagnostic only and missing exact results always fence dispatch", async () => {
  const base = {
    taskType: "source_map",
    stageKey: "source_map:syllabus_reading",
    stageLabel: "Syllabus reading",
    semanticAttempt: 1,
    initialPlanningStageKey: "source_map:syllabus_reading",
    jobCreatedAt: "2030-01-01T00:00:00.000Z",
    recoveredAt: "2030-01-01T00:02:00.000Z",
  };
  const unrelatedEarlierCalls = [{
    type: "learn_source_formulas_reviewed",
    stage: "planning_preflight",
    modelCalls: 7,
    timestamp: "2030-01-01T00:00:30.000Z",
  }];
  const noExactEvidence = classifyLegacyStageIssuanceEvidence({
    ...base,
    events: unrelatedEarlierCalls,
  });
  assert.equal(noExactEvidence, "none");

  let unprovenPosts = 0;
  await assert.rejects(
    () => recoverBeforePlanningDispatch({
      recover: async () => {
        throw new PlanningRecoveryBoundaryError("result_unresolved");
      },
      dispatch: async () => {
        unprovenPosts += 1;
        return "must-not-use-absence-as-proof";
      },
    }),
    (error) => error instanceof PlanningRecoveryBoundaryError && error.code === "result_unresolved",
  );
  assert.equal(unprovenPosts, 0);

  const planningStartEvidence = classifyLegacyStageIssuanceEvidence({
    ...base,
    semanticAttempt: 0,
    events: [{
      type: "learn_planning_started",
      timestamp: "2030-01-01T00:00:45.000Z",
    }],
  });
  assert.equal(planningStartEvidence, "issued");
  let initialReplayPosts = 0;
  await assert.rejects(
    () => recoverBeforePlanningDispatch({
      recover: async () => {
        if (planningStartEvidence === "issued") {
          throw new PlanningRecoveryBoundaryError("result_unresolved");
        }
        return null;
      },
      dispatch: async () => {
        initialReplayPosts += 1;
        return "must-not-replay-initial";
      },
    }),
    (error) => error instanceof PlanningRecoveryBoundaryError && error.code === "result_unresolved",
  );
  assert.equal(initialReplayPosts, 0);

  const exactRepairEvidence = classifyLegacyStageIssuanceEvidence({
    ...base,
    events: [{
      type: "learn_planning_schema_repair_started",
      taskType: base.taskType,
      stageKey: base.stageKey,
      stageLabel: base.stageLabel,
      repairAttempt: 1,
      timestamp: "2030-01-01T00:01:00.000Z",
    }],
  });
  assert.equal(exactRepairEvidence, "issued");
  let replayPosts = 0;
  await assert.rejects(
    () => recoverBeforePlanningDispatch({
      recover: async () => {
        if (exactRepairEvidence === "issued") {
          throw new PlanningRecoveryBoundaryError("result_unresolved");
        }
        return null;
      },
      dispatch: async () => {
        replayPosts += 1;
        return "must-not-replay";
      },
    }),
    (error) => error instanceof PlanningRecoveryBoundaryError && error.code === "result_unresolved",
  );
  assert.equal(replayPosts, 0);

  assert.equal(classifyLegacyStageIssuanceEvidence({
    ...base,
    events: [{
      type: "learn_planning_transport_ambiguous",
      taskType: base.taskType,
      stageKey: base.stageKey,
      stageLabel: base.stageLabel,
      semanticAttempt: 1,
      timestamp: "not-a-time",
    }],
  }), "ambiguous");
});

test("legacy materialization stores hashes and identifiers, never the recovered answer", () => {
  const database = fixtureDatabase();
  insertJob(database, { id: "job-origin" });
  materializeLegacyPlanningCheckpoint(database, {
    requestId: "lrq_legacy_fixture_0001",
    originJobId: "job-origin",
    gardenId: "fixture-garden",
    stageKey: "source_map:syllabus_reading",
    semanticAttempt: 1,
    requestHash: "f".repeat(64),
    councilRunId: "crun_fixture_legacy",
    responseHash: "0".repeat(64),
    now: "2030-01-01T00:01:00.000Z",
  });
  const row = database
    .prepare("SELECT * FROM learn_planning_request_checkpoints")
    .get();
  assert.equal(row.result_origin, "legacy");
  assert.equal(row.state, "completed");
  assert.equal(Object.values(row).includes('{"legacy":true}'), false);
  assert.throws(
    () => materializeLegacyPlanningCheckpoint(database, {
      requestId: "lrq_legacy_fixture_duplicate_run",
      originJobId: "job-origin",
      gardenId: "fixture-garden",
      stageKey: "source_map:source_map:cycle:0",
      semanticAttempt: 0,
      requestHash: "1".repeat(64),
      councilRunId: "crun_fixture_legacy",
      responseHash: "2".repeat(64),
      now: "2030-01-01T00:01:01.000Z",
    }),
    /UNIQUE constraint failed/,
  );
  database.close();
});

test("receipt completion and O-to-N adoption commit atomically and P resolves the alias", () => {
  const database = fixtureDatabase();
  insertJob(database, { id: "job-o" });
  insertJob(database, {
    id: "job-n",
    createdAt: "2030-01-01T00:02:00.000Z",
    updatedAt: "2030-01-01T00:02:00.000Z",
  });
  insertJob(database, {
    id: "job-p",
    status: "planning",
    currentStep: "retry",
    error: null,
    createdAt: "2030-01-01T00:03:00.000Z",
    updatedAt: "2030-01-01T00:03:00.000Z",
  });
  const requestHash = "8".repeat(64);
  createStartedPlanningCheckpoint(database, {
    requestId: "lrq_origin_o",
    jobId: "job-o",
    gardenId: "fixture-garden",
    stageKey: "source_map:syllabus_reading",
    semanticAttempt: 0,
    requestHash,
    now: "2030-01-01T00:00:10.000Z",
  });
  database.exec(`
    CREATE TRIGGER fail_fixture_adoption
    BEFORE INSERT ON learn_planning_request_checkpoints
    WHEN NEW.request_id = 'lrqa_adoption_n'
    BEGIN
      SELECT RAISE(ABORT, 'injected adoption persistence failure');
    END;
  `);
  assert.throws(
    () => completePlanningCheckpointWithAdoption(database, {
      originRequestId: "lrq_origin_o",
      receiptRequestId: "lrq_origin_o",
      requestHash,
      councilRunId: "crun_fixture_o",
      responseHash: "9".repeat(64),
      adoptionRequestId: "lrqa_adoption_n",
      adoptingJobId: "job-n",
      gardenId: "fixture-garden",
      stageKey: "source_map:syllabus_reading",
      semanticAttempt: 0,
      now: "2030-01-01T00:02:10.000Z",
    }),
    /injected adoption persistence failure/,
  );
  assert.deepEqual(
    database.prepare(
      "SELECT state, council_run_id, response_hash FROM learn_planning_request_checkpoints WHERE request_id = 'lrq_origin_o'",
    ).get(),
    { state: "started", council_run_id: null, response_hash: null },
  );
  assert.equal(
    database.prepare(
      "SELECT COUNT(*) AS count FROM learn_planning_request_checkpoints WHERE job_id = 'job-n'",
    ).get().count,
    0,
  );
  database.exec("DROP TRIGGER fail_fixture_adoption");
  completePlanningCheckpointWithAdoption(database, {
    originRequestId: "lrq_origin_o",
    receiptRequestId: "lrq_origin_o",
    requestHash,
    councilRunId: "crun_fixture_o",
    responseHash: "9".repeat(64),
    adoptionRequestId: "lrqa_adoption_n",
    adoptingJobId: "job-n",
    gardenId: "fixture-garden",
    stageKey: "source_map:syllabus_reading",
    semanticAttempt: 0,
    now: "2030-01-01T00:02:10.000Z",
  });
  const rowsForP = priorPlanningCheckpoints(database, {
    currentJobId: "job-p",
    gardenId: "fixture-garden",
    stageKey: "source_map:syllabus_reading",
    semanticAttempt: 0,
  });
  assert.equal(rowsForP.length, 1);
  assert.equal(rowsForP[0].job_id, "job-n");
  assert.equal(rowsForP[0].request_id, "lrqa_adoption_n");
  assert.equal(rowsForP[0].receipt_request_id, "lrq_origin_o");
  database.close();
});

test("a conflicting member cannot hide a valid receipt alias or reach dispatch", async () => {
  const database = fixtureDatabase();
  for (const [id, createdAt] of [
    ["job-o", "2030-01-01T00:00:00.000Z"],
    ["job-n", "2030-01-01T00:02:00.000Z"],
    ["job-corrupt", "2030-01-01T00:03:00.000Z"],
    ["job-p", "2030-01-01T00:04:00.000Z"],
  ]) {
    insertJob(database, { id, createdAt, updatedAt: createdAt });
  }
  database.prepare("UPDATE learn_jobs SET user_id = 99 WHERE id = 'job-corrupt'").run();
  const requestHash = "a".repeat(64);
  createStartedPlanningCheckpoint(database, {
    requestId: "lrq_chain_origin",
    jobId: "job-o",
    gardenId: "fixture-garden",
    stageKey: "source_map:syllabus_reading",
    semanticAttempt: 0,
    requestHash,
    now: "2030-01-01T00:00:10.000Z",
  });
  completePlanningCheckpointWithAdoption(database, {
    originRequestId: "lrq_chain_origin",
    receiptRequestId: "lrq_chain_origin",
    requestHash,
    councilRunId: "crun_chain",
    responseHash: "b".repeat(64),
    adoptionRequestId: "lrqa_chain_n",
    adoptingJobId: "job-n",
    gardenId: "fixture-garden",
    stageKey: "source_map:syllabus_reading",
    semanticAttempt: 0,
    now: "2030-01-01T00:02:10.000Z",
  });
  database.prepare(`
    INSERT INTO learn_planning_request_checkpoints (
      request_id, job_id, garden_id, stage_key, semantic_attempt,
      request_hash, receipt_request_id, result_origin, state,
      council_run_id, response_hash, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, 0, ?, ?, 'receipt', 'completed', ?, ?, ?, ?, ?)
  `).run(
    "lrqa_chain_corrupt",
    "job-corrupt",
    "fixture-garden",
    "source_map:syllabus_reading",
    requestHash,
    "lrq_chain_origin",
    "crun_chain",
    "b".repeat(64),
    "2030-01-01T00:03:10.000Z",
    "2030-01-01T00:03:10.000Z",
    "2030-01-01T00:03:10.000Z",
  );
  let posts = 0;
  await assert.rejects(
    () => recoverBeforePlanningDispatch({
      recover: async () => priorPlanningCheckpoints(database, {
        currentJobId: "job-p",
        gardenId: "fixture-garden",
        stageKey: "source_map:syllabus_reading",
        semanticAttempt: 0,
      })[0] ?? null,
      dispatch: async () => { posts += 1; return "must-not-post"; },
    }),
    (error) => error instanceof PlanningRecoveryBoundaryError && error.code === "candidate_conflict",
  );
  assert.equal(posts, 0);
  database.close();
});

test("dispatch authority rejects deleted, paused, terminal, and lease-lost jobs", async () => {
  for (const job of [
    null,
    { id: "job", gardenId: "garden", status: "paused" },
    { id: "job", gardenId: "garden", status: "complete" },
    { id: "job", gardenId: "garden", status: "failed" },
  ]) {
    let posts = 0;
    await assert.rejects(
      () => dispatchAfterExactPlanningAuthority({
        authorized: () => hasExactPlanningDispatchAuthority({
          job,
          expectedJobId: "job",
          expectedGardenId: "garden",
          ownsLease: () => true,
        }),
        dispatch: async () => { posts += 1; return "must-not-post"; },
      }),
      (error) => error instanceof PlanningRecoveryBoundaryError &&
        error.code === "dispatch_authority_lost",
    );
    assert.equal(posts, 0);
  }
  let posts = 0;
  await assert.rejects(
    () => dispatchAfterExactPlanningAuthority({
      authorized: () => hasExactPlanningDispatchAuthority({
        job: { id: "job", gardenId: "garden", status: "planning" },
        expectedJobId: "job",
        expectedGardenId: "garden",
        ownsLease: () => false,
      }),
      dispatch: async () => { posts += 1; return "must-not-post"; },
    }),
    /dispatch_authority_lost/,
  );
  assert.equal(posts, 0);
});

function waiverFixtureBinding(overrides = {}) {
  return {
    originJobId: "job-legacy-origin",
    gardenId: "fixture-garden",
    userId: 7,
    model: "gpt-fixture",
    sourceSetHash: "e".repeat(64),
    sourceIds: ["source-a"],
    syllabusSourceId: "fixture-syllabus",
    sourceOnly: true,
    includeSourceSnapshots: false,
    jobCreatedAt: "2030-01-01T00:00:00.000Z",
    recoveredAt: "2030-01-01T00:02:00.000Z",
    startedRequests: 2,
    completedRequests: 2,
    policyObservedRequests: 2,
    ...overrides,
  };
}

function waiverInventoryResult(sequence, marker, overrides = {}) {
  const second = 10 + sequence * 20;
  return {
    sequence,
    requestHash: marker.repeat(64),
    councilRunId: `crun-${marker}`,
    responseHash: marker.toUpperCase().repeat(64).toLowerCase(),
    createdAt: `2030-01-01T00:00:${String(second).padStart(2, "0")}.000Z`,
    updatedAt: `2030-01-01T00:00:${String(second + 5).padStart(2, "0")}.000Z`,
    councilMode: "direct_council",
    requestedModel: "gpt-fixture",
    resolvedModel: "gpt-fixture",
    usage: { callCount: 1, reportedCallCount: 1 },
    modelRouting: [{
      requestId: `crun-${marker}`,
      endpoint: "council",
      requestedModel: "gpt-fixture",
      resolvedModel: "gpt-fixture",
      upstreamModel: "gpt-fixture",
      provider: "chatgpt",
      outcome: "succeeded",
      fallback: false,
    }],
    ...overrides,
  };
}

function sealedWaiverResult(result) {
  return {
    sequence: result.sequence,
    requestHash: result.requestHash,
    councilRunId: result.councilRunId,
    responseHash: result.responseHash,
    createdAt: result.createdAt,
    updatedAt: result.updatedAt,
  };
}

test("legacy waiver canonically seals a complete ordered legacy inventory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "learn-legacy-waiver-"));
  try {
    const binding = waiverFixtureBinding();
    const inventory = [waiverInventoryResult(0, "a"), waiverInventoryResult(1, "b")];
    const results = inventory.map(sealedWaiverResult).reverse();
    const receiptPath = createLegacyPlanningWaiverReceipt({
      contentPath: root,
      binding,
      results,
      operatorReason: "Forensic review found the exact sealed boundary.",
      acknowledgement: LEGACY_PLANNING_WAIVER_ACK,
      now: "2030-01-01T00:03:00.000Z",
    });
    const parsed = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    assert.equal(parsed.schemaVersion, 2);
    assert.deepEqual(parsed.results.map((result) => result.sequence), [0, 1]);
    assert.equal(readExactLegacyPlanningWaiver({
      contentPath: root,
      expectedBinding: binding,
    }).integrityHash, parsed.integrityHash);
    assertLegacyPlanningWaiverPredatesCurrentJob({
      receipt: parsed,
      currentJobCreatedAt: "2030-01-01T00:03:00.001Z",
    });
    for (const currentJobCreatedAt of [
      "2030-01-01T00:03:00.000Z",
      "2030-01-01T00:02:59.999Z",
    ]) {
      assert.throws(
        () => assertLegacyPlanningWaiverPredatesCurrentJob({
          receipt: parsed,
          currentJobCreatedAt,
        }),
        /not sealed before/,
      );
    }
    assert.throws(
      () => readExactLegacyPlanningWaiver({
        contentPath: root,
        expectedBinding: { ...binding, completedRequests: 1 },
      }),
      /binding is stale/,
    );

    assert.throws(
      () => createLegacyPlanningWaiverReceipt({
        contentPath: path.join(root, "incomplete"),
        binding,
        results: [sealedWaiverResult(inventory[0])],
        operatorReason: "Forensic review found an incomplete inventory.",
        acknowledgement: LEGACY_PLANNING_WAIVER_ACK,
        now: "2030-01-01T00:03:00.000Z",
      }),
      /invalid or not unique/,
    );
    assert.throws(
      () => createLegacyPlanningWaiverReceipt({
        contentPath: path.join(root, "predates-recovery"),
        binding,
        results: inventory.map(sealedWaiverResult),
        operatorReason: "Forensic review used an impossible seal time.",
        acknowledgement: LEGACY_PLANNING_WAIVER_ACK,
        now: "2030-01-01T00:01:59.999Z",
      }),
      /cannot predate its recovered boundary/,
    );
    assertNextLegacyPlanningWaiverResult({
      receipt: parsed,
      materialized: [],
      candidate: sealedWaiverResult(inventory[0]),
    });
    assert.throws(
      () => assertLegacyPlanningWaiverFullyMaterialized({
        receipt: parsed,
        materialized: [sealedWaiverResult(inventory[0])],
      }),
      /Not every sealed/,
    );
    assertLegacyPlanningWaiverFullyMaterialized({
      receipt: parsed,
      materialized: inventory.map(sealedWaiverResult),
    });
    fs.writeFileSync(
      receiptPath,
      `${JSON.stringify({ ...parsed, createdAt: "2030-01-01T00:01:59.999Z" })}\n`,
    );
    assert.throws(
      () => readExactLegacyPlanningWaiver({
        contentPath: root,
        expectedBinding: binding,
      }),
      /predates its recovered boundary/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("legacy inventory audit is promptless, exact-route, and count bound", () => {
  const binding = waiverFixtureBinding();
  const inventory = [waiverInventoryResult(0, "a"), waiverInventoryResult(1, "b")];
  assert.deepEqual(
    auditedLegacyPlanningInventory({
      value: { state: "completed", legacy: true, results: inventory },
      binding,
      model: binding.model,
    }),
    inventory.map(sealedWaiverResult),
  );
  assert.throws(
    () => auditedLegacyPlanningInventory({
      value: {
        state: "completed",
        legacy: true,
        results: inventory,
        userPrompt: "must not cross the root schema",
      },
      binding,
      model: binding.model,
    }),
    /response is invalid/,
  );
  assert.throws(
    () => auditedLegacyPlanningInventory({
      value: {
        state: "completed",
        legacy: true,
        results: [{ ...inventory[0], finalAnswer: "must not cross inventory" }, inventory[1]],
      },
      binding,
      model: binding.model,
    }),
    /non-allowlisted field/,
  );
  assert.throws(
    () => auditedLegacyPlanningInventory({
      value: {
        state: "completed",
        legacy: true,
        results: [
          { ...inventory[0], modelRouting: [inventory[0].modelRouting[0], "unknown"] },
          inventory[1],
        ],
      },
      binding,
      model: binding.model,
    }),
    /call evidence is invalid/,
  );
  assert.throws(
    () => auditedLegacyPlanningInventory({
      value: {
        state: "completed",
        legacy: true,
        results: [
          {
            ...inventory[0],
            modelRouting: [{ ...inventory[0].modelRouting[0], userPrompt: "nested leak" }],
          },
          inventory[1],
        ],
      },
      binding,
      model: binding.model,
    }),
    /call evidence is invalid/,
  );
  assert.throws(
    () => auditedLegacyPlanningInventory({
      value: {
        state: "completed",
        legacy: true,
        results: [
          {
            ...inventory[0],
            usage: { ...inventory[0].usage, finalAnswer: "nested leak" },
          },
          inventory[1],
        ],
      },
      binding,
      model: binding.model,
    }),
    /call evidence is invalid/,
  );
  assert.throws(
    () => auditedLegacyPlanningInventory({
      value: {
        state: "completed",
        legacy: true,
        results: [
          { ...inventory[0], usage: { callCount: true, reportedCallCount: "1" } },
          inventory[1],
        ],
      },
      binding,
      model: binding.model,
    }),
    /call evidence is invalid/,
  );
  assert.throws(
    () => auditedLegacyPlanningInventory({
      value: {
        state: "completed",
        legacy: true,
        results: [
          {
            ...inventory[0],
            modelRouting: [{ ...inventory[0].modelRouting[0], fallback: true }],
          },
          inventory[1],
        ],
      },
      binding,
      model: binding.model,
    }),
    /does not prove one exact model call/,
  );
  assert.throws(
    () => auditedLegacyPlanningInventory({
      value: { state: "completed", legacy: true, results: [inventory[0]] },
      binding,
      model: binding.model,
    }),
    /count does not match/,
  );
});

test("internal Learn recovery URLs are uncredentialed loopback HTTP and endpoint allowlisted", () => {
  assert.equal(
    strictChatMockInternalRecoveryUrl(
      "http://127.0.0.1:8765/v1",
      "/internal/council-results/legacy-inventory",
    ).href,
    "http://127.0.0.1:8765/v1/internal/council-results/legacy-inventory",
  );
  assert.equal(
    strictChatMockInternalRecoveryUrl(
      "http://[::1]:8765/",
      "/internal/council-results/resolve",
    ).hostname,
    "[::1]",
  );
  for (const [baseUrl, pathname] of [
    ["https://127.0.0.1:8765/v1", "/internal/council-results/resolve"],
    ["http://example.com/v1", "/internal/council-results/resolve"],
    ["http://user:secret@127.0.0.1:8765/v1", "/internal/council-results/resolve"],
    ["http://127.0.0.1:8765/v1?token=secret", "/internal/council-results/resolve"],
    ["http://127.0.0.1:8765/proxy/v1", "/internal/council-results/resolve"],
    ["http://127.0.0.1:8765/v1", "/internal/admin"],
  ]) {
    assert.throws(
      () => strictChatMockInternalRecoveryUrl(baseUrl, pathname),
      /uncredentialed loopback HTTP/,
    );
  }
});

test("a pre-run seal consumes recovered results in order before one native boundary", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "learn-waiver-prefix-"));
  const database = fixtureDatabase();
  try {
    insertJob(database, {
      id: "job-legacy-origin",
      sourceSetHash: "e".repeat(64),
    });
    const binding = waiverFixtureBinding();
    const inventory = [waiverInventoryResult(0, "a"), waiverInventoryResult(1, "b")];
    const receiptPath = createLegacyPlanningWaiverReceipt({
      contentPath: root,
      binding,
      results: inventory.map(sealedWaiverResult),
      operatorReason: "Forensic review sealed every completed legacy result.",
      acknowledgement: LEGACY_PLANNING_WAIVER_ACK,
      now: "2030-01-01T00:03:00.000Z",
    });
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));

    for (const [index, result] of inventory.entries()) {
      const materialized = materializedLegacyPlanningResults(database, "job-legacy-origin");
      assert.equal(materialized.length, index);
      assertNextLegacyPlanningWaiverResult({
        receipt,
        materialized,
        candidate: sealedWaiverResult(result),
      });
      materializeLegacyPlanningCheckpoint(database, {
        requestId: `lrq_legacy_${index}`,
        originJobId: "job-legacy-origin",
        gardenId: "fixture-garden",
        stageKey: "source_map:syllabus_reading",
        semanticAttempt: index,
        requestHash: result.requestHash,
        councilRunId: result.councilRunId,
        responseHash: result.responseHash,
        now: `2030-01-01T00:01:0${index}.000Z`,
      });
    }
    const materialized = materializedLegacyPlanningResults(database, "job-legacy-origin");
    assertLegacyPlanningWaiverFullyMaterialized({ receipt, materialized });
    let nativeDispatches = 0;
    const value = await recoverBeforePlanningDispatch({
      recover: async () => {
        assertLegacyPlanningWaiverFullyMaterialized({ receipt, materialized });
        return null;
      },
      dispatch: async () => {
        nativeDispatches += 1;
        return "native";
      },
    });
    assert.equal(value, "native");
    assert.equal(nativeDispatches, 1);
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the 404 boundary re-audits the exact full inventory before exercise or dispatch", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "learn-waiver-live-inventory-"));
  try {
    const binding = waiverFixtureBinding();
    const inventory = [waiverInventoryResult(0, "a"), waiverInventoryResult(1, "b")];
    const receiptPath = createLegacyPlanningWaiverReceipt({
      contentPath: root,
      binding,
      results: inventory.map(sealedWaiverResult),
      operatorReason: "Forensic review sealed the complete legacy inventory.",
      acknowledgement: LEGACY_PLANNING_WAIVER_ACK,
      now: "2030-01-01T00:03:00.000Z",
    });
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));

    async function crossBoundary(results) {
      let exercises = 0;
      let dispatches = 0;
      const value = await recoverBeforePlanningDispatch({
        recover: async () => {
          const live = auditedLegacyPlanningInventory({
            value: { state: "completed", legacy: true, results },
            binding,
            model: binding.model,
          });
          assertLegacyPlanningWaiverMatchesInventory({ receipt, inventory: live });
          exercises += 1;
          return null;
        },
        dispatch: async () => {
          dispatches += 1;
          return "native";
        },
      });
      return { value, exercises, dispatches };
    }

    assert.deepEqual(await crossBoundary(inventory), {
      value: "native",
      exercises: 1,
      dispatches: 1,
    });

    const driftedInventories = [
      [inventory[0]],
      [...inventory, waiverInventoryResult(2, "c")],
      [inventory[1], inventory[0]],
      [
        {
          ...inventory[0],
          modelRouting: [{ ...inventory[0].modelRouting[0], fallback: true }],
        },
        inventory[1],
      ],
      [{ ...inventory[0], responseHash: "c".repeat(64) }, inventory[1]],
    ];
    for (const drifted of driftedInventories) {
      let dispatches = 0;
      let exercises = 0;
      await assert.rejects(
        () => recoverBeforePlanningDispatch({
          recover: async () => {
            const live = auditedLegacyPlanningInventory({
              value: { state: "completed", legacy: true, results: drifted },
              binding,
              model: binding.model,
            });
            assertLegacyPlanningWaiverMatchesInventory({ receipt, inventory: live });
            exercises += 1;
            return null;
          },
          dispatch: async () => {
            dispatches += 1;
            return "must-not-dispatch";
          },
        }),
      );
      assert.equal(exercises, 0);
      assert.equal(dispatches, 0);
    }

    const inventoryObservation = learnSource.indexOf(
      "await promptlessLegacyPlanningInventoryGet",
    );
    const equalityCheck = learnSource.indexOf(
      "assertLegacyPlanningWaiverMatchesInventory",
      inventoryObservation,
    );
    const exercisePublication = learnSource.indexOf(
      "persistLegacyPlanningWaiverExercise",
      equalityCheck,
    );
    assert.ok(inventoryObservation >= 0);
    assert.ok(equalityCheck > inventoryObservation);
    assert.ok(exercisePublication > equalityCheck);
    const inventoryHelperStart = learnSource.indexOf(
      "async function promptlessLegacyPlanningInventoryGet",
    );
    const inventoryHelperEnd = learnSource.indexOf(
      "function recoveredCouncilCallResult",
      inventoryHelperStart,
    );
    assert.match(
      learnSource.slice(inventoryHelperStart, inventoryHelperEnd),
      /AbortSignal\.timeout\(30_000\)/,
    );
    const waiverCliSource = fs.readFileSync(
      new URL("../scripts/create-learn-planning-legacy-waiver.mjs", import.meta.url),
      "utf8",
    );
    assert.match(waiverCliSource, /AbortSignal\.timeout\(30_000\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("legacy waiver CLI seals promptless results before retry without mutating SQLite", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "learn-waiver-cli-"));
  let server;
  try {
    const databasePath = path.join(root, "brain.db");
    const contentPath = path.join(root, "content");
    const database = fixtureDatabase(databasePath);
    insertJob(database, {
      id: "job-cli-origin",
      sourceSetHash: "e".repeat(64),
      currentStep: "Unresponsive Learn worker recovered; prior Learn state restored",
      error: "Learn stopped responding before completion. Your garden was restored and is safe to retry.",
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:01:00.000Z",
    });
    database.close();
    const eventDirectory = path.join(contentPath, "fixture-garden", ".breadboard");
    fs.mkdirSync(eventDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(eventDirectory, "events.jsonl"),
      `${JSON.stringify({
        type: "learn_abandoned_job_recovered",
        jobId: "job-cli-origin",
        gardenId: "fixture-garden",
        timestamp: "2020-01-01T00:02:00.000Z",
      })}\n`,
    );
    const inventory = [
      waiverInventoryResult(0, "a", {
        createdAt: "2020-01-01T00:00:10.000Z",
        updatedAt: "2020-01-01T00:00:15.000Z",
      }),
      waiverInventoryResult(1, "b", {
        createdAt: "2020-01-01T00:00:30.000Z",
        updatedAt: "2020-01-01T00:00:35.000Z",
      }),
    ];
    server = await startInventoryFixtureServer({
      state: "completed",
      legacy: true,
      results: inventory,
    });
    const run = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "scripts/create-learn-planning-legacy-waiver.mjs",
        "--db", databasePath,
        "--content-path", contentPath,
        "--origin-job-id", "job-cli-origin",
        "--reason", "Forensic operator review confirmed the migration boundary.",
        "--ack", LEGACY_PLANNING_WAIVER_ACK,
        "--chatmock-base-url", server.baseUrl,
      ],
      { cwd: path.resolve("."), encoding: "utf8" },
    );
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /Created audited legacy planning waiver/);
    const verified = new Database(databasePath, { readonly: true });
    assert.equal(
      verified.prepare("SELECT COUNT(*) AS count FROM learn_planning_request_checkpoints").get().count,
      0,
    );
    verified.close();
    const verifiedReceipt = readExactLegacyPlanningWaiver({
      contentPath,
      expectedBinding: {
        originJobId: "job-cli-origin",
        gardenId: "fixture-garden",
        userId: 7,
        model: "gpt-fixture",
        sourceSetHash: "e".repeat(64),
        sourceIds: ["source-a"],
        syllabusSourceId: "fixture-syllabus",
        sourceOnly: true,
        includeSourceSnapshots: false,
        jobCreatedAt: "2020-01-01T00:00:00.000Z",
        recoveredAt: "2020-01-01T00:02:00.000Z",
        startedRequests: 2,
        completedRequests: 2,
        policyObservedRequests: 2,
      },
    });
    assert.ok(verifiedReceipt);
    assert.deepEqual(verifiedReceipt.results, inventory.map(sealedWaiverResult));
  } finally {
    server?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("legacy waiver CLI rechecks and rejects a retry that starts during inventory", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "learn-waiver-cli-race-"));
  let server;
  try {
    const databasePath = path.join(root, "brain.db");
    const contentPath = path.join(root, "content");
    const database = fixtureDatabase(databasePath);
    insertJob(database, {
      id: "job-cli-origin",
      sourceSetHash: "e".repeat(64),
      currentStep: "Unresponsive Learn worker recovered; prior Learn state restored",
      error: "Learn stopped responding before completion. Your garden was restored and is safe to retry.",
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:01:00.000Z",
    });
    database.close();
    const eventDirectory = path.join(contentPath, "fixture-garden", ".breadboard");
    fs.mkdirSync(eventDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(eventDirectory, "events.jsonl"),
      `${JSON.stringify({
        type: "learn_abandoned_job_recovered",
        jobId: "job-cli-origin",
        gardenId: "fixture-garden",
        timestamp: "2020-01-01T00:02:00.000Z",
      })}\n`,
    );
    const inventory = [
      waiverInventoryResult(0, "a", {
        createdAt: "2020-01-01T00:00:10.000Z",
        updatedAt: "2020-01-01T00:00:15.000Z",
      }),
      waiverInventoryResult(1, "b", {
        createdAt: "2020-01-01T00:00:30.000Z",
        updatedAt: "2020-01-01T00:00:35.000Z",
      }),
    ];
    server = await startInventoryFixtureServer(
      { state: "completed", legacy: true, results: inventory },
      {
        databasePath,
        id: "job-retry-raced",
        createdAt: "2020-01-01T00:03:00.000Z",
      },
    );
    const run = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "scripts/create-learn-planning-legacy-waiver.mjs",
        "--db", databasePath,
        "--content-path", contentPath,
        "--origin-job-id", "job-cli-origin",
        "--reason", "Forensic operator review confirmed the migration boundary.",
        "--ack", LEGACY_PLANNING_WAIVER_ACK,
        "--chatmock-base-url", server.baseUrl,
      ],
      { cwd: path.resolve("."), encoding: "utf8" },
    );
    assert.notEqual(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.match(run.stderr, /began after the legacy recovery boundary/);
    assert.equal(
      fs.existsSync(
        path.join(contentPath, "fixture-garden", ".breadboard", "legacy-planning-waivers"),
      ),
      false,
    );
  } finally {
    server?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("waiver exercise persistence is fail-closed before dispatch and idempotently audited", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "learn-waiver-exercise-"));
  try {
    const exercise = {
      contentPath: root,
      currentJobId: "job-current",
      gardenId: "fixture-garden",
      stageKey: "source_map:source_map:cycle:0",
      semanticAttempt: 0,
      requestHash: "a".repeat(64),
      exactLookupCode: "legacy_not_found",
      originJobId: "job-origin",
      waiverIntegrityHash: "b".repeat(64),
      now: "2030-01-01T00:04:00.000Z",
    };
    const first = persistLegacyPlanningWaiverExercise(exercise);
    const second = persistLegacyPlanningWaiverExercise({
      ...exercise,
      currentJobId: "job-retry-after-pre-checkpoint-crash",
      now: "2030-01-01T00:04:01.000Z",
    });
    assert.equal(first, second);
    const audit = JSON.parse(fs.readFileSync(first, "utf8"));
    assert.equal(audit.kind, "learn_planning_legacy_waiver_exercised");
    assert.equal(audit.exactLookupStatus, 404);
    assert.throws(
      () => persistLegacyPlanningWaiverExercise({
        ...exercise,
        currentJobId: "job-changed-boundary",
        stageKey: "source_map:different-stage",
        requestHash: "c".repeat(64),
        now: "2030-01-01T00:04:02.000Z",
      }),
      /conflicts with its durable record/,
    );

    const impossibleRoot = path.join(root, "not-a-directory");
    fs.writeFileSync(impossibleRoot, "fixture");
    let posts = 0;
    await assert.rejects(
      () => recoverBeforePlanningDispatch({
        recover: async () => {
          persistLegacyPlanningWaiverExercise({
            ...exercise,
            contentPath: impossibleRoot,
            currentJobId: "job-failure",
          });
          return null;
        },
        dispatch: async () => { posts += 1; return "must-not-post"; },
      }),
    );
    assert.equal(posts, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a completed native checkpoint is the post-waiver migration epoch", () => {
  const database = fixtureDatabase();
  insertJob(database, { id: "job-current", status: "planning" });
  assert.equal(hasCompletedNativePlanningCheckpoint(database, "job-current"), false);
  createStartedPlanningCheckpoint(database, {
    requestId: "lrq_epoch",
    jobId: "job-current",
    gardenId: "fixture-garden",
    stageKey: "source_map:source_map:cycle:0",
    semanticAttempt: 0,
    requestHash: "a".repeat(64),
    now: "2030-01-01T00:01:00.000Z",
  });
  assert.equal(
    hasCompletedNativePlanningCheckpoint(database, "job-current"),
    false,
    "a merely started native row cannot waive unresolved legacy ambiguity",
  );
  completePlanningCheckpoint(database, {
    requestId: "lrq_epoch",
    requestHash: "a".repeat(64),
    councilRunId: "crun_epoch",
    responseHash: "b".repeat(64),
    now: "2030-01-01T00:01:30.000Z",
  });
  assert.equal(hasCompletedNativePlanningCheckpoint(database, "job-current"), true);
  database.close();
});

test("every repeatable Source Map and coverage-rebind call includes its reauthor cycle", () => {
  assert.match(
    learnSource,
    /completionRequestOverrides:\s*\{[\s\S]*?councilModeOverride: "direct_council",[\s\S]*?learnStrictRoute: true/,
  );
  assert.match(
    learnSource,
    /stageKey: `source_map:source_map:cycle:\$\{reauthorCycle\}`/,
  );
  assert.match(
    learnSource,
    /stageKey: `source_map:syllabus_coverage_rebind:cycle:\$\{reauthorCycle\}`/,
  );
  assert.match(
    learnSource,
    /stageKey: `source_map:syllabus_coverage_rebind_evidence:cycle:\$\{reauthorCycle\}:\$\{request\.phase\}`/,
  );
  assert.match(learnSource, /requestSourceMap\(sourceMapReauthorAttempts\)/);
  assert.match(learnSource, /rebindSyllabusCoverage\(reauthorCycle\)/);
  assert.match(learnSource, /requestSourceMap\(reauthorCycle\)/);
});
