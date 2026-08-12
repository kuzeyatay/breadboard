// What the Settings → Memory panel says about semantic recall.
//
// The layer is designed to fail quietly, which is right for a turn and wrong
// for a settings page: a user looking at their memories deserves to know
// whether recall-by-meaning is actually working, and if not, why. This
// reports the real state — configured, built, indexed — rather than the
// intended one.

import type Database from "better-sqlite3";
import db from "../db.ts";
import { mem0Config } from "./config.ts";

export interface SemanticMemoryStatus {
  /** Whether the layer is switched on in configuration. */
  enabled: boolean;
  /** Whether per-turn LLM fact extraction is on. */
  extractionEnabled: boolean;
  /** Whether the vendored engine is actually present and loadable. */
  engineAvailable: boolean;
  /** Embedding model and width the index is built in. */
  fingerprint: string;
  /** Active memories carrying a current vector. */
  indexedMemories: number;
  /** Active memories in total, so partial coverage is visible. */
  totalMemories: number;
  /** Plain-language reason recall is degraded, or null when it is healthy. */
  degradedReason: string | null;
}

export async function semanticMemoryStatus(
  userId: number,
  database: Database.Database = db,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SemanticMemoryStatus> {
  const config = mem0Config(env);
  const engine = await probeVendoredEngine();

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
    engineAvailable: engine.loadable,
    fingerprint: config.fingerprint,
    indexedMemories: indexed.n,
    totalMemories: totals.n,
    degradedReason: degradedReason(config.enabled, engine, env),
  };
}

function degradedReason(
  enabled: boolean,
  engine: EngineProbe,
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
  if (!engine.loadable) {
    // "Not installed" and "installed but broken" call for different repairs, so
    // they get different sentences rather than one guess.
    return engine.missing
      ? "The mem0 engine has not been built yet. It builds itself on the next `npm run dev`, or run `npm run setup:mem0` now."
      : `The mem0 engine is installed but failed to load (${engine.error}). Rebuild it with \`npm run setup:mem0\`.`;
  }
  return null;
}

interface EngineProbe {
  /** Whether `import("mem0ai/oss")` actually yields a usable engine here. */
  loadable: boolean;
  /** True when the package simply is not there, as opposed to broken. */
  missing: boolean;
  error: string;
}

type EngineProbeGlobal = typeof globalThis & { __breadboardMem0Loadable?: true };

/**
 * The engine is a `file:` dependency on a clone that gitignores its own build
 * output, so "installed" and "built" are genuinely different states and only
 * the second one works.
 *
 * The check is the load itself, because that is the operation whose success
 * decides whether recall by meaning works. `require.resolve` reads like the
 * cheaper answer and is a wrong one: the bundler rewrites it to return the
 * module *id* (`"mem0ai/oss"`) rather than a path, so `existsSync` said no and
 * a perfectly good build reported itself as missing. Anything that reasons
 * about node_modules layout instead of asking the loader can drift the same way.
 *
 * Only success is memoised. A failure stays re-probed so that finishing the
 * build — which the stack launcher may be doing in the background right now —
 * shows up on the next settings visit instead of after a restart.
 */
async function probeVendoredEngine(): Promise<EngineProbe> {
  const cache = globalThis as EngineProbeGlobal;
  if (cache.__breadboardMem0Loadable) return { loadable: true, missing: false, error: "" };
  try {
    const { Memory } = await import("mem0ai/oss");
    if (typeof Memory !== "function") {
      return { loadable: false, missing: false, error: "no Memory export" };
    }
    cache.__breadboardMem0Loadable = true;
    return { loadable: true, missing: false, error: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as NodeJS.ErrnoException | null)?.code;
    return {
      loadable: false,
      missing: code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND",
      error: message.split("\n")[0].slice(0, 200),
    };
  }
}
