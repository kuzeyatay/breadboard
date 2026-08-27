// Observational Settings status for the Runtime V2-owned semantic-memory
// service. Polling this module never imports mem0, acquires a lease, or starts
// the service; the first real retrieval/extraction does that.

import type Database from "better-sqlite3";
import db from "../db.ts";
import {
  isRuntimeV2ServiceControlConfigured,
  readSupervisedServiceSnapshot,
  type SupervisedServiceLifecycleState,
} from "../supervisor-control.ts";
import { mem0Config } from "./config.ts";

export interface SemanticMemoryStatus {
  /** Whether the layer is switched on in configuration. */
  enabled: boolean;
  /** Whether per-turn LLM fact extraction is on. */
  extractionEnabled: boolean;
  /** Whether Runtime reports the staged engine installation as available. */
  engineAvailable: boolean;
  /** Embedding model and width the index is built in. */
  fingerprint: string;
  /** Active memories carrying a current vector. */
  indexedMemories: number;
  /** Active memories in total, so partial coverage is visible. */
  totalMemories: number;
  /** Plain-language reason recall is degraded, or null when it can cold-start. */
  degradedReason: string | null;
}

const INSTALLATION_PRESENT_STATES = new Set<SupervisedServiceLifecycleState>([
  "pending",
  "starting",
  "healthy",
  "degraded",
  "failed",
  "stopping",
  "stopped",
  "available-but-stopped",
  "ready",
  "busy",
  "resource-blocked",
]);

export async function semanticMemoryStatus(
  userId: number,
  database: Database.Database = db,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SemanticMemoryStatus> {
  const config = mem0Config(env);
  let lifecycle: SupervisedServiceLifecycleState | null = null;
  if (isRuntimeV2ServiceControlConfigured(env)) {
    try {
      lifecycle = (await readSupervisedServiceSnapshot(
        "mem0-semantic-engine",
        env,
      ))?.state ?? null;
    } catch {
      lifecycle = null;
    }
  }

  const totals = database.prepare(`
    SELECT COUNT(*) AS n FROM durable_memories
    WHERE user_id = ? AND state IN ('candidate','confirmed')
  `).get(userId) as { n: number };
  const indexed = database.prepare(`
    SELECT COUNT(*) AS n
    FROM durable_memories dm
    JOIN mem0_mirrors mm ON mm.durable_id = dm.id
    WHERE dm.user_id = ? AND dm.state IN ('candidate','confirmed')
      AND mm.fingerprint = ? AND mm.mem0_id <> ''
  `).get(userId, config.fingerprint) as { n: number };

  return {
    enabled: config.enabled,
    extractionEnabled: config.extractionEnabled,
    engineAvailable:
      lifecycle !== null && INSTALLATION_PRESENT_STATES.has(lifecycle),
    fingerprint: config.fingerprint,
    indexedMemories: indexed.n,
    totalMemories: totals.n,
    degradedReason: degradedReason(config.enabled, lifecycle, env),
  };
}

function degradedReason(
  enabled: boolean,
  lifecycle: SupervisedServiceLifecycleState | null,
  env: NodeJS.ProcessEnv,
): string | null {
  const embeddingsOff = ["off", "0", "false"].includes(
    (env.BREADBOARD_EMBEDDINGS ?? "").trim().toLowerCase(),
  );
  if (embeddingsOff) {
    return "Embeddings are switched off (BREADBOARD_EMBEDDINGS), so memories are found by wording only.";
  }
  if (!enabled) {
    return "Semantic memory is switched off (BREADBOARD_MEM0), so memories are found by wording only.";
  }
  if (!isRuntimeV2ServiceControlConfigured(env)) {
    return "Semantic memory requires the Breadboard Runtime service owner, so memories are currently found by wording only.";
  }
  if (lifecycle === null) {
    return "The semantic-memory service is unavailable, so memories are currently found by wording only.";
  }
  if (lifecycle === "installation-unavailable") {
    return "The semantic-memory engine is not installed in this Breadboard runtime.";
  }
  if (lifecycle === "failed") {
    return "The semantic-memory service failed to start; lexical memory remains available.";
  }
  if (lifecycle === "resource-blocked") {
    return "Memory pressure is preventing semantic recall right now; lexical memory remains available.";
  }
  return null;
}
