import type { QaRunEnvironment } from "./environment";

const PACKAGED_CHILD_DENIED_PREFIXES = [
  "BREADBOARD_QA_",
  "BREADBOARD_RUNTIME_V2_BURN_IN",
  "BREADBOARD_DASHBOARD_",
  "BREADBOARD_MEMORY_",
  "BREADBOARD_AGENT_MEMORY",
] as const;

const PACKAGED_CHILD_DENIED_KEYS = new Set([
  "BREADBOARD_DATA_DIR",
  "BREADBOARD_REPO_ROOT",
  "BREADBOARD_DESKTOP_DASHBOARD_MODE",
  "BREADBOARD_DEVELOPMENT_DASHBOARD_DIR",
  "BREADBOARD_CRITICAL_FREE_COMMIT_MB",
  "BREADBOARD_MIN_FREE_COMMIT_MB",
  "BREADBOARD_DASHBOARD_DEV_HEAP_MB",
  "BREADBOARD_DASHBOARD_TREE_SOFT_LIMIT_MB",
  "BREADBOARD_DASHBOARD_TREE_HARD_LIMIT_MB",
  "BREADBOARD_RUNTIME_V2_SERVICE_EVIDENCE_BINDING",
  "BREADBOARD_MEMORY_DIAGNOSTIC_TOKEN",
  "GBRAIN_MODE",
  "UI_TARS_MODE",
  "CAD_MODE",
  "COLPALI_MODE",
  "HUMANIZER_MODE",
  "CLIPROXY_MODE",
  "VIDEO_TRANSCRIPTION_ENABLED",
  "CI",
]);

/**
 * Keep profile/data isolation while removing every QA or behavior override from
 * an installed application's child environment. Empty dotenv-shadow values are
 * omitted too: a packaged launch receives this complete environment object and
 * therefore cannot inherit the values they were protecting against.
 */
export function sanitizePackagedChildEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value.length === 0) continue;
    const normalized = key.toUpperCase();
    if (PACKAGED_CHILD_DENIED_KEYS.has(normalized)) continue;
    if (PACKAGED_CHILD_DENIED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
      continue;
    }
    result[key] = value;
  }
  return result;
}

/** Return a launch view without mutating the marker-owning QA run. */
export function withPackagedChildEnvironment(
  run: QaRunEnvironment,
): QaRunEnvironment {
  return {
    ...run,
    env: sanitizePackagedChildEnvironment(run.env),
  };
}
