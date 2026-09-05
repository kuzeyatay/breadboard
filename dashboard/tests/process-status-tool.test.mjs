import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import {
  PROCESS_KINDS,
  collectProcessStatus,
  resolveGardens,
  summarizeProcessStatus,
} from "../src/lib/hermes/process-status.ts";
import {
  runtimeV2DatabaseCandidates,
  withRuntimeV2Database,
} from "../src/lib/runtime-v2/runtime-database.ts";
import { PROCESS_STATUS_TOOLS, allowedToolsForSurface } from "../src/lib/hermes/tool-scopes.ts";
import { BROKERED_TOOLS } from "../src/lib/hermes/capability-broker.ts";
import { composeHermesSystemPrompt } from "../src/lib/hermes/system-prompts.ts";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const NOW = new Date("2026-09-03T12:00:00.000Z");
const ms = (iso) => new Date(iso).getTime();

function dashboardDatabase() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE clusters (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE
    );
    CREATE TABLE learn_jobs (
      id TEXT PRIMARY KEY,
      garden_id TEXT NOT NULL,
      status TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'full',
      model TEXT NOT NULL DEFAULT 'model',
      current_step TEXT,
      progress_percent INTEGER NOT NULL DEFAULT 0,
      current_section_title TEXT,
      current_page_title TEXT,
      error TEXT,
      paused_from_status TEXT,
      active_elapsed_ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE video_transcription_jobs (
      id TEXT PRIMARY KEY,
      cluster_id INTEGER NOT NULL,
      garden_slug TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      input_kind TEXT NOT NULL,
      status TEXT NOT NULL,
      progress_percent REAL,
      current_stage TEXT,
      original_filename TEXT,
      original_url TEXT,
      source_title TEXT,
      error_code TEXT,
      error_message TEXT,
      cancel_requested INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE thought_topology_jobs (
      id INTEGER PRIMARY KEY,
      cluster_id INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      last_error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE runtime_v2_outer_agent_runs (
      job_id TEXT PRIMARY KEY,
      owner_user_id INTEGER NOT NULL,
      agent_kind TEXT NOT NULL,
      garden_id TEXT,
      conversation_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      terminal_at TEXT
    );
    CREATE TABLE scheduled_chat_jobs (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      cron_expression TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      next_run_at TEXT NOT NULL,
      last_run_at TEXT,
      last_status TEXT,
      last_error TEXT,
      run_count INTEGER NOT NULL DEFAULT 0,
      garden_slug TEXT,
      one_shot INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO users (id) VALUES (1), (2);
    INSERT INTO clusters (id, user_id, name, slug) VALUES
      (5, 1, 'Electromagnetism 1', 'electromagnetism-1'),
      (6, 1, 'Signals and Systems', 'signals'),
      (7, 2, 'Someone else', 'someone-else');
  `);
  return db;
}

function runtimeDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-runtime-status-"));
  const file = path.join(dir, "runtime-v2.sqlite3");
  const db = new Database(file);
  db.exec(`
    CREATE TABLE runtime_jobs (
      job_id TEXT PRIMARY KEY,
      job_type TEXT NOT NULL,
      worker_kind TEXT NOT NULL,
      resource_class TEXT NOT NULL DEFAULT 'core',
      owner_principal TEXT NOT NULL DEFAULT 'user',
      user_id INTEGER,
      garden_id TEXT,
      conversation_id TEXT,
      state TEXT NOT NULL,
      stage TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      updated_at INTEGER NOT NULL,
      finished_at INTEGER,
      progress_current INTEGER NOT NULL DEFAULT 0,
      progress_total INTEGER NOT NULL DEFAULT 0,
      failure_code TEXT,
      failure_message TEXT,
      cancellation_requested INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE runtime_job_input_uploads (
      upload_id TEXT PRIMARY KEY,
      job_id TEXT,
      display_name TEXT NOT NULL
    );
  `);
  const insert = db.prepare(`
    INSERT INTO runtime_jobs
      (job_id, job_type, worker_kind, user_id, garden_id, state, stage, created_at, started_at,
       updated_at, finished_at, progress_current, progress_total, failure_code, failure_message)
    VALUES (@id, @type, @worker, @user, @garden, @state, @stage, @created, @started, @updated,
            @finished, @current, @total, @failureCode, @failureMessage)
  `);
  const base = {
    worker: "node",
    stage: null,
    started: null,
    finished: null,
    current: 0,
    total: 0,
    failureCode: null,
    failureMessage: null,
  };
  insert.run({
    ...base,
    id: "job_upload_running",
    type: "document-ingestion",
    worker: "document-ingestion-node",
    user: 1,
    garden: "electromagnetism-1",
    state: "running",
    stage: "processing",
    created: ms("2026-09-03T11:50:00Z"),
    started: ms("2026-09-03T11:50:05Z"),
    updated: ms("2026-09-03T11:58:00Z"),
    current: 3,
    total: 12,
  });
  insert.run({
    ...base,
    id: "job_upload_failed",
    type: "document-ingestion",
    worker: "document-ingestion-node",
    user: 1,
    garden: "electromagnetism-1",
    state: "failed",
    created: ms("2026-09-03T10:00:00Z"),
    updated: ms("2026-09-03T10:04:00Z"),
    finished: ms("2026-09-03T10:04:00Z"),
    failureCode: "WORKER_FAILED",
    failureMessage: "OCR service refused the PDF",
  });
  insert.run({
    ...base,
    id: "job_upload_ancient",
    type: "document-ingestion",
    worker: "document-ingestion-node",
    user: 1,
    garden: "electromagnetism-1",
    state: "succeeded",
    created: ms("2026-08-01T10:00:00Z"),
    updated: ms("2026-08-01T10:04:00Z"),
    finished: ms("2026-08-01T10:04:00Z"),
  });
  insert.run({
    ...base,
    id: "job_upload_other_user",
    type: "document-ingestion",
    worker: "document-ingestion-node",
    user: 2,
    garden: "someone-else",
    state: "running",
    created: ms("2026-09-03T11:50:00Z"),
    updated: ms("2026-09-03T11:58:00Z"),
  });
  insert.run({
    ...base,
    id: "job_background",
    type: "background-task",
    worker: "background-task-node",
    user: 1,
    garden: null,
    state: "running",
    created: ms("2026-09-03T11:59:00Z"),
    updated: ms("2026-09-03T11:59:30Z"),
  });
  insert.run({
    ...base,
    id: "job_research",
    type: "max-research-run",
    worker: "outer-max-research-node",
    user: 1,
    garden: null,
    state: "running",
    stage: "waiting-external",
    created: ms("2026-09-03T11:30:00Z"),
    updated: ms("2026-09-03T11:57:00Z"),
  });
  db.prepare(`
    INSERT INTO runtime_job_input_uploads (upload_id, job_id, display_name) VALUES
      ('u1', 'job_upload_running', 'Lecture 4 - Gauss law.pdf'),
      ('u2', 'job_upload_failed', 'Problem set 2.pdf')
  `).run();
  db.close();
  return file;
}

test("Gardens resolve from names, slugs, fragments and abbreviations", () => {
  const db = dashboardDatabase();
  assert.deepEqual(resolveGardens(db, 1, "electromagnetism-1").map((g) => g.slug), ["electromagnetism-1"]);
  assert.deepEqual(resolveGardens(db, 1, "Electromagnetism 1").map((g) => g.slug), ["electromagnetism-1"]);
  assert.deepEqual(resolveGardens(db, 1, "signals").map((g) => g.slug), ["signals"]);
  assert.deepEqual(resolveGardens(db, 1, "EM1").map((g) => g.slug), ["electromagnetism-1"], "EM1 ≈ Electromagnetism 1");
  assert.deepEqual(resolveGardens(db, 1, "SaS").map((g) => g.slug), ["signals"]);
  assert.deepEqual(resolveGardens(db, 1, "Someone else"), [], "another account's Garden never matches");
  assert.deepEqual(resolveGardens(db, 1, "nothing like this"), []);
  assert.equal(resolveGardens(db, 1, null).length, 2);
});

test("a Garden's document uploads come from the runtime store, scoped to the user", () => {
  const db = dashboardDatabase();
  const runtimeDatabasePath = runtimeDatabase();
  const report = collectProcessStatus({
    database: db,
    userId: 1,
    gardens: resolveGardens(db, 1, "EM1"),
    kinds: ["document_upload"],
    runtimeDatabasePath,
    now: () => NOW,
  });
  assert.deepEqual(report.unavailable, []);
  assert.deepEqual(
    report.processes.map((record) => [record.id, record.state, record.title]),
    [
      ["job_upload_running", "running", "Lecture 4 - Gauss law.pdf"],
      ["job_upload_failed", "failed", "Problem set 2.pdf"],
    ],
    "running first, the day's failure next, last month's success and other people's jobs absent",
  );
  const [running, failed] = report.processes;
  assert.equal(running.kind, "document_upload");
  assert.equal(running.garden, "electromagnetism-1");
  assert.equal(running.gardenName, "Electromagnetism 1");
  assert.equal(running.stage, "Processing");
  assert.equal(running.progressPercent, 25);
  assert.equal(running.startedAt, "2026-09-03T11:50:05.000Z");
  assert.equal(failed.error, "OCR service refused the PDF");
  assert.equal(failed.detail.failureCode, "WORKER_FAILED");
  assert.deepEqual(report.counts, { running: 1, waiting: 0, succeeded: 0, failed: 1 });

  const summary = summarizeProcessStatus(report);
  assert.match(summary, /Running \(1\):/);
  assert.match(summary, /Lecture 4 - Gauss law\.pdf in Electromagnetism 1 — Processing \(25%\)/);
  assert.match(summary, /Failed or cancelled \(1\):/);
  assert.match(summary, /OCR service refused the PDF/);
});

test("every family is read, ordered by state, and Garden-less work stays visible account-wide", () => {
  const db = dashboardDatabase();
  const runtimeDatabasePath = runtimeDatabase();
  db.prepare(`
    INSERT INTO learn_jobs (id, garden_id, status, current_step, progress_percent, created_at, updated_at)
    VALUES ('learn-1', 'electromagnetism-1', 'generating_learning_pages', 'Writing lesson 3 of 8', 40,
            '2026-09-03T11:00:00.000Z', '2026-09-03T11:59:00.000Z'),
           ('learn-old', 'signals', 'complete', NULL, 100,
            '2026-08-20T11:00:00.000Z', '2026-08-20T12:00:00.000Z'),
           ('learn-theirs', 'someone-else', 'planning', NULL, 1,
            '2026-09-03T11:00:00.000Z', '2026-09-03T11:59:00.000Z')
  `).run();
  db.prepare(`
    INSERT INTO video_transcription_jobs
      (id, cluster_id, garden_slug, user_id, input_kind, status, progress_percent, current_stage,
       original_filename, created_at, updated_at)
    VALUES ('vt-1', 6, 'signals', 1, 'upload', 'transcribing', 55.5, 'Transcribing with WhisperX',
            'lecture.mp4', '2026-09-03T11:40:00.000Z', '2026-09-03T11:58:00.000Z')
  `).run();
  db.prepare(`
    INSERT INTO thought_topology_jobs (id, cluster_id, revision, reason, status, created_at, updated_at)
    VALUES (1, 5, 7, 'learn-published', 'queued', '2026-09-03T11:59:00.000Z', '2026-09-03T11:59:00.000Z')
  `).run();
  db.prepare(`
    INSERT INTO runtime_v2_outer_agent_runs (job_id, owner_user_id, agent_kind, garden_id, conversation_id, created_at)
    VALUES ('job_research', 1, 'max-research', NULL, 'conv_1', '2026-09-03T11:30:00.000Z')
  `).run();
  db.prepare(`
    INSERT INTO scheduled_chat_jobs (id, user_id, title, cron_expression, next_run_at, last_status, garden_slug)
    VALUES (1, 1, 'Morning briefing', '0 8 * * *', '2026-09-04T08:00:00.000Z', 'completed', NULL)
  `).run();

  const everything = collectProcessStatus({
    database: db,
    userId: 1,
    runtimeDatabasePath,
    now: () => NOW,
  });
  assert.deepEqual(everything.unavailable, []);
  const byKind = Object.fromEntries(
    everything.processes.map((record) => [record.id, record]),
  );
  assert.equal(byKind["learn-1"].state, "running");
  assert.equal(byKind["learn-1"].stage, "Writing lesson 3 of 8");
  assert.equal(byKind["learn-1"].progressPercent, 40);
  assert.equal(byKind["learn-old"], undefined, "a two-week-old completion is outside the lookback");
  assert.equal(byKind["learn-theirs"], undefined);
  assert.equal(byKind["vt-1"].kind, "transcription");
  assert.equal(byKind["vt-1"].progressPercent, 56);
  assert.equal(byKind["thought-topology:1"].state, "waiting");
  assert.equal(byKind["job_research"].kind, "agent_run");
  assert.equal(byKind["job_research"].state, "running");
  assert.equal(byKind["job_research"].stage, "Waiting on an external service");
  assert.equal(byKind["schedule:1"].state, "waiting");
  assert.equal(byKind["job_background"], undefined, "housekeeping jobs are not the person's processes");
  assert.equal(
    everything.processes.filter((record) => record.kind === "runtime_job").length,
    0,
    "a runtime job already reported as an agent run is not listed twice",
  );

  const states = everything.processes.map((record) => record.state);
  const order = { running: 0, waiting: 1, failed: 2, succeeded: 3 };
  for (let index = 1; index < states.length; index += 1) {
    assert.ok(order[states[index - 1]] <= order[states[index]], "running work is listed before finished work");
  }

  const scoped = collectProcessStatus({
    database: db,
    userId: 1,
    gardens: resolveGardens(db, 1, "signals"),
    runtimeDatabasePath,
    now: () => NOW,
  });
  const scopedIds = scoped.processes.map((record) => record.id);
  assert.ok(scopedIds.includes("vt-1"));
  assert.ok(scopedIds.includes("job_research"), "Garden-less agent runs belong to every Garden's view");
  assert.ok(scopedIds.includes("schedule:1"));
  assert.ok(!scopedIds.includes("learn-1"));
  assert.ok(!scopedIds.includes("job_upload_running"));
});

test("a missing runtime store or table names the gap instead of failing the answer", () => {
  const db = dashboardDatabase();
  const report = collectProcessStatus({
    database: db,
    userId: 1,
    runtimeDatabasePath: path.join(os.tmpdir(), "does-not-exist", "runtime-v2.sqlite3"),
    now: () => NOW,
  });
  assert.deepEqual(report.unavailable.sort(), ["document_upload", "runtime_job"]);
  assert.match(summarizeProcessStatus(report), /Could not read: document upload, runtime job/);
  assert.equal(
    withRuntimeV2Database(() => 1, { path: path.join(os.tmpdir(), "nope.sqlite3") }),
    null,
  );
  const candidates = runtimeV2DatabaseCandidates({ BREADBOARD_RUNTIME_V2_DATABASE: "C:/custom/runtime.sqlite3" });
  assert.ok(candidates[0].replace(/\\/g, "/").endsWith("custom/runtime.sqlite3"));
  assert.ok(candidates.every((candidate) => candidate.endsWith("runtime.sqlite3") || candidate.endsWith("runtime-v2.sqlite3")));
});

test("the tool is registered everywhere a Breadboard tool has to appear", () => {
  const plugin = read("hermes-agent/plugins/breadboard/__init__.py");
  const manifest = read("hermes-agent/plugins/breadboard/plugin.yaml");
  for (const tool of PROCESS_STATUS_TOOLS) {
    assert.ok(manifest.includes(`  - ${tool}`), `${tool} missing from plugin.yaml provides_tools`);
    assert.ok(plugin.includes(`"${tool}"`), `${tool} missing from _TOOLS in __init__.py`);
    assert.ok(BROKERED_TOOLS.includes(tool), `${tool} is not brokered`);
    assert.ok(allowedToolsForSurface("dashboard_terminal").includes(tool));
    assert.ok(allowedToolsForSurface("garden_chat").includes(tool));
    assert.ok(!allowedToolsForSurface("quartz_ai").includes(tool));
  }
  assert.ok(plugin.includes('"/api/hermes/tools/process-status"'));
  assert.ok(
    fs.existsSync(path.join(repoRoot, "dashboard", "src", "app", "api", "hermes", "tools", "process-status", "route.ts")),
  );
  assert.match(
    plugin,
    /route_kind in \{[^}]*"process_status"[^}]*\}/,
    "process_status must produce the {tool, args} payload its route reads",
  );
  for (const kind of PROCESS_KINDS) {
    assert.ok(plugin.includes(`"${kind}"`), `${kind} is not offered in the tool schema`);
  }
  assert.ok(fs.existsSync(path.join(repoRoot, "hermes-config", "system", "process-status.md")));
});

test("the turn prompt carries the process-status boundary only when the tool is granted", () => {
  const decision = {
    mode: "knowledge",
    requestedOutcome: "Check on the upload",
    implementationRequired: false,
    decisionReason: "Knowledge task",
    decisionSource: "breadboard_server_policy_v1",
    authorizedRoots: [],
    authorizedPathPatterns: [],
    allowedTools: ["breadboard_process_status"],
    allowedOperations: ["knowledge_work"],
    allowedCommandPatterns: [],
    selectedConditionalSkills: [],
    selectedConnections: [],
  };
  const withTool = composeHermesSystemPrompt({ surface: "garden_chat", decision });
  assert.match(withTool, /native_process_status/);
  assert.match(withTool, /EM1/);
  const without = composeHermesSystemPrompt({
    surface: "garden_chat",
    decision: { ...decision, allowedTools: [] },
  });
  assert.doesNotMatch(without, /native_process_status/);
});
