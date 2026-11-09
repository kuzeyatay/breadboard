import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { API_ANYTHING_TOOLS, apiAnythingFallback } from "./api-anything-contract.mjs";

// Opaque runtime paths keep Next's asset tracer out of mutable user data.
const fs = process.getBuiltinModule("node:fs");
const path = process.getBuiltinModule("node:path");
const { Worker } = process.getBuiltinModule("node:worker_threads");
const pending = new Map();
const active = new Map();
const MAX_RESULT_BYTES = 1024 * 1024;

export function apiAnythingPaths({ repoRoot, dataRoot, userId } = {}) {
  const root = repoRoot || process.env.BREADBOARD_REPO_ROOT ||
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const data = dataRoot || process.env.BREADBOARD_DATA_DIR || path.join(root, "dashboard");
  return { bundle: path.join(root, "api-anything", "breadboard", "host.mjs"),
    sites: path.join(root, "api-anything", "sites"),
    worker: path.join(root, "dashboard", "scripts", "api-anything-worker.mjs"),
    home: path.join(data, "runtime-v2", "api-anything", `user-${userId}`) };
}

export function apiAnythingAvailable(options = {}) {
  if (process.env.BREADBOARD_API_ANYTHING_ENABLED === "0") return false;
  const files = apiAnythingPaths(options);
  return [files.bundle, files.worker, files.sites].every(file => fs.existsSync(file));
}

export async function callApiAnythingTool({ userId, tool, args = {}, signal, repoRoot, dataRoot,
  scopeId = "", permissionGranted = false, timeoutMs = 25_000 } = {}) {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new TypeError("Website APIs require authenticated user scope.");
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  if (tool === "__breadboard_list_tools") return { ok: true, tools: API_ANYTHING_TOOLS, available: apiAnythingAvailable({ repoRoot, dataRoot }) };
  if (!API_ANYTHING_TOOLS.some(item => item.name === tool)) return { ok: false, class: "input", reason: "Unknown website API tool." };
  if (!apiAnythingAvailable({ repoRoot, dataRoot })) return apiAnythingFallback("API Anything is unavailable. Continue with Breadboard's browser tools.");
  if ((active.get(userId) ?? 0) >= 4) return apiAnythingFallback("The website API runtime is busy. Continue with the browser or retry later.");
  const paths = apiAnythingPaths({ repoRoot, dataRoot, userId });
  const key = createHash("sha256").update(JSON.stringify([paths.home, scopeId, tool, args])).digest("hex");
  for (const [id, entry] of pending) if (entry.expires < Date.now()) pending.delete(id);
  const saved = permissionGranted && scopeId ? pending.get(key) : undefined;
  if (saved) pending.delete(key);
  const approvedPlan = saved?.plan;
  const budget = Math.max(100, Math.min(40_000, timeoutMs));
  active.set(userId, (active.get(userId) ?? 0) + 1);
  try {
    const result = await new Promise((resolve, reject) => {
      const worker = new Worker(paths.worker, {
        workerData: { bundle: paths.bundle, sites: paths.sites, tool, args, approvedPlan, timeoutMs: Math.max(100, budget - 1500) },
        env: { ...process.env, API_ANYTHING_HOME: paths.home, API_ANYTHING_LOCAL_ONLY: "1" },
        // Do not inherit a parent's test loader or inspector into the finite worker.
        execArgv: [], stdout: true, stderr: true,
      });
      worker.stdout.resume(); worker.stderr.resume();
      let settled = false;
      const finish = (value, error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer); signal?.removeEventListener("abort", abort);
        void worker.terminate();
        if (error) reject(error); else resolve(value);
      };
      const failure = (reason, classification = "unavailable") => approvedPlan
        ? { ok: false, provider: "api-anything", class: classification, reason, verifyBeforeRetry: true, fallback: { recommended: false } }
        : apiAnythingFallback(reason, classification);
      const abort = () => finish(null, signal.reason ?? new DOMException("Aborted", "AbortError"));
      const timer = setTimeout(() => finish(failure("The website API timed out.", "timeout")), budget);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      worker.once("message", value => {
        if (Buffer.byteLength(JSON.stringify(value)) > MAX_RESULT_BYTES) finish(failure("The website API response exceeded the result limit."));
        else finish(value);
      });
      worker.once("error", () => finish(failure("The website API runtime failed.")));
      worker.once("exit", () => { if (!settled) finish(failure("The website API runtime exited without a result.")); });
    });
    if (result.pendingPlan) {
      if (scopeId && pending.size < 128) pending.set(key, { plan: result.pendingPlan, expires: Date.now() + 5 * 60_000 });
      delete result.pendingPlan;
      if (!scopeId) {
        return { ...result, reason: "Use the browser's normal approval flow for this write.", fallback: { recommended: true } };
      }
    }
    return result;
  } finally {
    const count = (active.get(userId) ?? 1) - 1;
    if (count) active.set(userId, count); else active.delete(userId);
  }
}

export function callApiAnythingAgentTool({ userId, input, signal, ...options }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return Promise.resolve({ ok: false, class: "input", reason: "Website API input must be an object." });
  }
  const { action, ...args } = input;
  return callApiAnythingTool({ ...options, userId, tool: action, args, signal });
}
