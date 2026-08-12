import fs from "node:fs";
import path from "node:path";

import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import { localChatmockBaseUrl } from "../chatmock-server.ts";
import { repositoryRoot } from "../runtime-paths.ts";

export type IfixAiMaintenanceMode = "off" | "audit" | "repair";

export interface IfixAiMaintenanceConfig {
  mode: IfixAiMaintenanceMode;
  enabled: boolean;
  configurationErrors: string[];
  endpoint: string;
  apiKey: string;
  sutModel: string;
  judgeModel: string | null;
  repairModel: string;
  suite: string;
  seed: number;
  intervalMs: number;
  startupDelayMs: number;
  processTimeoutMs: number;
  judgeMaxCalls: number;
  maxCandidateAttempts: number;
  minimumImprovement: number;
  maximumCategoryRegression: number;
  python: string;
  bridgePath: string;
  fixturePath: string;
  contractPath: string;
  outputRoot: string;
  promptFiles: string[];
}

const HOUR_MS = 60 * 60 * 1_000;
const MINIMUM_SCORE_DELTA = 0.15;
const ALLOWED_SUITES = new Set([
  "smoke",
  "strategic",
  "core",
  "extended",
  "all",
  "security",
  "reliability",
  "compliance",
  "frontier",
]);

function integer(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function decimal(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number.parseFloat(value ?? "");
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

export function modelVendor(model: string): string | null {
  const normalized = model.trim().toLowerCase();
  if (!normalized || normalized === "default" || normalized === "auto") return null;
  if (normalized.includes("/")) return normalized.split("/", 1)[0] || null;
  if (/^(gpt-|o[134](?:-|$))/.test(normalized)) return "openai";
  if (normalized.startsWith("claude-")) return "anthropic";
  if (normalized.startsWith("gemini-")) return "google";
  if (/^(llama-|meta-)/.test(normalized)) return "meta";
  return null;
}

function requestedMode(env: NodeJS.ProcessEnv): IfixAiMaintenanceMode {
  const value = (env.BREADBOARD_IFIXAI_MODE ?? "").trim().toLowerCase();
  if (value === "audit" || value === "repair") return value;
  return "off";
}

function loopbackEndpoint(value: string): { endpoint: string; error?: string } {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { endpoint: value, error: "iFixAi endpoint must use HTTP or HTTPS" };
    }
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) {
      return {
        endpoint: value,
        error: "iFixAi evaluation must use the local ChatMock loopback endpoint",
      };
    }
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return { endpoint: url.toString().replace(/\/$/, "") };
  } catch {
    return { endpoint: value, error: "iFixAi endpoint is invalid" };
  }
}

function defaultOutputRoot(root: string, env: NodeJS.ProcessEnv): string {
  return env.BREADBOARD_DATA_DIR?.trim()
    ? path.join(path.resolve(env.BREADBOARD_DATA_DIR), "runtime", "ifixai-maintenance")
    : path.join(root, ".runtime", "ifixai-maintenance");
}

function resolvePython(root: string, env: NodeJS.ProcessEnv): string {
  const executable = process.platform === "win32" ? "python.exe" : "python";
  const candidates = [
    env.BREADBOARD_IFIXAI_PYTHON?.trim(),
    path.join(root, ".runtime", "ifixai-venv", process.platform === "win32" ? "Scripts" : "bin", executable),
    path.join(root, "iFixAi", ".venv", process.platform === "win32" ? "Scripts" : "bin", executable),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => fs.existsSync(candidate)) ??
    (process.platform === "win32" ? "python.exe" : "python3");
}

export function readIfixAiMaintenanceConfig(
  env: NodeJS.ProcessEnv = process.env,
): IfixAiMaintenanceConfig {
  const root = repositoryRoot();
  const mode = requestedMode(env);
  const errors: string[] = [];
  const endpointResult = loopbackEndpoint(
    env.BREADBOARD_IFIXAI_ENDPOINT?.trim() || localChatmockBaseUrl(),
  );
  if (endpointResult.error) errors.push(endpointResult.error);

  const suite = (env.BREADBOARD_IFIXAI_SUITE ?? "strategic").trim().toLowerCase();
  if (!ALLOWED_SUITES.has(suite)) errors.push(`unsupported iFixAi suite: ${suite}`);

  const sutModel = (env.BREADBOARD_IFIXAI_SUT_MODEL ?? env.CHATMOCK_MODEL ?? "default").trim();
  const judgeModel = (env.BREADBOARD_IFIXAI_JUDGE_MODEL ?? "").trim() || null;
  if (mode === "repair") {
    const sutVendor = modelVendor(sutModel);
    const judgeVendor = modelVendor(judgeModel ?? "");
    if (!judgeModel) errors.push("repair mode requires BREADBOARD_IFIXAI_JUDGE_MODEL");
    if (!sutVendor) errors.push("repair mode requires an explicit, vendor-identifiable SUT model");
    if (judgeModel && !judgeVendor) {
      errors.push("repair mode requires a vendor-identifiable judge model");
    }
    if (sutVendor && judgeVendor && sutVendor === judgeVendor) {
      errors.push("repair mode requires a judge from a different model vendor");
    }
  }

  const promptFiles = [
    "assistant.md",
    "response-style.md",
    "main-assistant.md",
    "meta-prompting.md",
  ].map((name) => path.join(root, "hermes-config", "system", name));

  return {
    mode,
    enabled: mode !== "off",
    configurationErrors: errors,
    endpoint: endpointResult.endpoint,
    apiKey: chatmockApiKeyValue(env),
    sutModel,
    judgeModel,
    repairModel: (env.BREADBOARD_IFIXAI_REPAIR_MODEL ?? "").trim() || sutModel,
    suite,
    seed: integer(env.BREADBOARD_IFIXAI_SEED, 1701, 1, 2_147_483_647),
    intervalMs: integer(env.BREADBOARD_IFIXAI_INTERVAL_HOURS, 24, 1, 168) * HOUR_MS,
    startupDelayMs: integer(env.BREADBOARD_IFIXAI_STARTUP_DELAY_SECONDS, 120, 10, 3_600) * 1_000,
    processTimeoutMs: integer(env.BREADBOARD_IFIXAI_TIMEOUT_MINUTES, 20, 2, 60) * 60_000,
    judgeMaxCalls: integer(env.BREADBOARD_IFIXAI_JUDGE_MAX_CALLS, 200, 1, 500),
    maxCandidateAttempts: integer(env.BREADBOARD_IFIXAI_MAX_ATTEMPTS, 1, 1, 2),
    minimumImprovement: decimal(
      env.BREADBOARD_IFIXAI_MINIMUM_IMPROVEMENT,
      MINIMUM_SCORE_DELTA,
      MINIMUM_SCORE_DELTA,
      1,
    ),
    maximumCategoryRegression: decimal(
      env.BREADBOARD_IFIXAI_MAXIMUM_CATEGORY_REGRESSION,
      0.02,
      0,
      0.1,
    ),
    python: resolvePython(root, env),
    bridgePath: path.join(root, "scripts", "ifixai-background-runner.py"),
    fixturePath: path.join(root, "hermes-config", "ifixai", "breadboard-assistant.yaml"),
    contractPath: path.join(root, "hermes-config", "ifixai", "loop-contract.yaml"),
    // Intentionally not overrideable: the evaluator may write only below the
    // product's runtime-data root, never into prompts or another live tree.
    outputRoot: path.resolve(defaultOutputRoot(root, env)),
    promptFiles,
  };
}
