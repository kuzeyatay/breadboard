#!/usr/bin/env node

import path from "path";
import fs from "fs";
import Database from "better-sqlite3";

import {
  createLegacyPlanningWaiverReceipt,
  LEGACY_PLANNING_WAIVER_ACK,
} from "../src/lib/learn-planning-legacy-waiver.ts";
import { auditedLegacyPlanningInventory } from "../src/lib/learn-planning-legacy-inventory.ts";
import { strictChatMockInternalRecoveryUrl } from "../src/lib/learn-planning-internal-url.ts";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

const dbPath = argument("--db");
const contentPath = argument("--content-path");
const originJobId = argument("--origin-job-id");
const operatorReason = argument("--reason");
const acknowledgement = argument("--ack");
const chatmockBaseUrl = argument("--chatmock-base-url");

function legacyInventoryUrl(baseUrl, query) {
  const destination = strictChatMockInternalRecoveryUrl(
    baseUrl,
    "/internal/council-results/legacy-inventory",
  );
  for (const [key, value] of Object.entries(query)) {
    destination.searchParams.set(key, value);
  }
  return destination;
}

async function fetchLegacyInventory(baseUrl, query) {
  const response = await fetch(legacyInventoryUrl(baseUrl, query), {
    method: "GET",
    redirect: "error",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  if (body.length > 1_000_000) throw new Error("Legacy Council inventory response is oversized.");
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("Legacy Council inventory response is not valid JSON.");
  }
  if (!response.ok) {
    const code = parsed?.error?.code;
    throw new Error(`Legacy Council inventory failed (${code ?? `HTTP ${response.status}`}).`);
  }
  return parsed;
}

function assertNoCompetingGardenJobs(database, origin, recoveredMs) {
  const originCreatedMs = Date.parse(origin.created_at);
  if (!Number.isFinite(originCreatedMs)) {
    throw new Error("Origin Learn job creation time is invalid.");
  }
  const others = database.prepare(
    `SELECT id, created_at, updated_at
     FROM learn_jobs
     WHERE id <> ? AND garden_id = ?`,
  ).all(origin.id, origin.garden_id);
  for (const other of others) {
    const createdMs = Date.parse(other.created_at);
    const updatedMs = Date.parse(other.updated_at);
    if (!Number.isFinite(createdMs) || !Number.isFinite(updatedMs)) {
      throw new Error("Another Learn job has an invalid time boundary.");
    }
    if (createdMs > recoveredMs) {
      throw new Error(
        `A same-garden Learn job (${other.id}) began after the legacy recovery boundary; the waiver must be sealed before any retry.`,
      );
    }
    if (createdMs <= recoveredMs && updatedMs >= originCreatedMs) {
      throw new Error("Another Learn job overlaps the legacy recovery fence.");
    }
  }
}

if (
  !dbPath ||
  !contentPath ||
  !originJobId ||
  !operatorReason ||
  !acknowledgement ||
  !chatmockBaseUrl
) {
  fail(
    "Usage: npm run learn:waive-legacy-planning -- --db <brain.db> --content-path <quartz/content> --origin-job-id <id> --reason <audit reason> --ack \"" +
      LEGACY_PLANNING_WAIVER_ACK +
      "\" --chatmock-base-url <http://127.0.0.1:8765/v1>",
  );
} else {
  const database = new Database(path.resolve(dbPath), { readonly: true, fileMustExist: true });
  try {
    // A waiver never mutates SQLite. The schema must already be migrated by a
    // normal Dashboard/worker startup.
    const columns = new Set(
      database.prepare("PRAGMA table_info(learn_planning_request_checkpoints)")
        .all().map((column) => column.name),
    );
    if (!columns.has("result_origin")) {
      throw new Error("Learn planning checkpoint schema has not been migrated.");
    }
    const origin = database.prepare(
      `SELECT j.*,
        u.request_model, u.reasoning_effort, u.reasoning_summary,
        u.started_requests, u.completed_requests,
        u.policy_observed_requests, u.policy_mismatch_requests,
        (SELECT COUNT(*) FROM learn_maps m WHERE m.job_id = j.id) AS map_count,
        (SELECT COUNT(*) FROM learn_versions v WHERE v.job_id = j.id) AS version_count,
        (SELECT COUNT(*) FROM learn_planning_request_checkpoints c
          WHERE c.job_id = j.id AND c.result_origin = 'receipt') AS native_receipt_count
       FROM learn_jobs j
       LEFT JOIN learn_job_token_usage u ON u.job_id = j.id
       WHERE j.id = ?`,
    ).get(originJobId);
    if (!origin) throw new Error("Origin Learn job does not exist.");
    if (
      origin.status !== "failed" ||
      origin.current_step !== "Unresponsive Learn worker recovered; prior Learn state restored" ||
      origin.error !== "Learn stopped responding before completion. Your garden was restored and is safe to retry." ||
      Number(origin.map_count) !== 0 ||
      Number(origin.version_count) !== 0 ||
      Number(origin.native_receipt_count) !== 0 ||
      origin.request_model !== origin.model ||
      origin.reasoning_effort !== "max" ||
      origin.reasoning_summary !== "detailed" ||
      Number(origin.policy_mismatch_requests) !== 0 ||
      Number(origin.policy_observed_requests) <= 0 ||
      Number(origin.started_requests) !== Number(origin.policy_observed_requests) ||
      Number(origin.completed_requests) !== Number(origin.policy_observed_requests)
    ) {
      throw new Error("Origin Learn job does not satisfy the exact recovered legacy fence.");
    }
    const sourceIds = JSON.parse(origin.source_ids_json);
    if (!Array.isArray(sourceIds) || !sourceIds.every((entry) => typeof entry === "string")) {
      throw new Error("Origin source selection is invalid.");
    }
    const eventsPath = path.join(
      path.resolve(contentPath),
      origin.garden_id,
      ".breadboard",
      "events.jsonl",
    );
    const events = fs.readFileSync(eventsPath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((event) => event && typeof event === "object" && event.jobId === originJobId);
    const recoveryEvents = events.filter(
      (event) => event.type === "learn_abandoned_job_recovered",
    );
    if (recoveryEvents.length !== 1) {
      throw new Error("Origin has no unique abandoned-recovery event.");
    }
    const recoveredAt = recoveryEvents[0].timestamp ?? recoveryEvents[0].at;
    const recoveredMs = Date.parse(recoveredAt);
    const updatedMs = Date.parse(origin.updated_at);
    if (
      !Number.isFinite(recoveredMs) ||
      !Number.isFinite(updatedMs) ||
      recoveredMs < updatedMs ||
      recoveredMs - updatedMs > 5 * 60_000
    ) {
      throw new Error("Origin abandoned-recovery time fence is invalid.");
    }
    assertNoCompetingGardenJobs(database, origin, recoveredMs);
    const binding = {
      originJobId,
      gardenId: origin.garden_id,
      userId: origin.user_id,
      model: origin.model,
      sourceSetHash: origin.source_set_hash,
      sourceIds,
      syllabusSourceId: origin.syllabus_source_id,
      sourceOnly: Boolean(origin.source_only),
      includeSourceSnapshots: Boolean(origin.include_source_snapshots),
      jobCreatedAt: origin.created_at,
      recoveredAt: new Date(recoveredMs).toISOString(),
      startedRequests: Number(origin.started_requests),
      completedRequests: Number(origin.completed_requests),
      policyObservedRequests: Number(origin.policy_observed_requests),
    };
    const inventory = await fetchLegacyInventory(chatmockBaseUrl, {
      createdAfter: binding.jobCreatedAt,
      createdBefore: binding.recoveredAt,
      reasoningEffort: "max",
      reasoningSummary: "detailed",
      gardenId: binding.gardenId,
      requestedModel: binding.model,
      sourceSetHash: binding.sourceSetHash,
      sourceIdsJson: JSON.stringify(binding.sourceIds),
    });
    const results = auditedLegacyPlanningInventory({
      value: inventory,
      binding,
      model: origin.model,
    });
    // Timestamp the seal before the final database observation. A retry that
    // starts before this check is rejected here; one that starts just after it
    // has a strictly later createdAt for the runtime pre-run check.
    const sealedAt = new Date().toISOString();
    assertNoCompetingGardenJobs(database, origin, recoveredMs);
    const destination = createLegacyPlanningWaiverReceipt({
      contentPath: path.resolve(contentPath),
      binding,
      results,
      operatorReason,
      acknowledgement,
      now: sealedAt,
    });
    process.stdout.write(`Created audited legacy planning waiver: ${destination}\n`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    database.close();
  }
}
