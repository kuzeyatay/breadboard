// Locating and health-checking the cloned career-ops installation.
//
// career-ops is not a service and not a library: it is a router skill plus ~60
// deterministic Node scripts that read and write a job-search workspace on disk
// (cv.md, config/profile.yml, data/applications.md, reports/, output/). The
// upstream design is that an AI coding CLI reads the skill, picks a mode, and
// runs those scripts. Breadboard takes that CLI's place — ChatMock is the model
// layer and ./run-manager.ts drives the loop — so the only things this module
// owns are: where the clone is, how to run Node against it, and what its own
// `doctor.mjs --json` says about the setup state.
//
// The clone directory IS the workspace. That is deliberate: the tracker, the
// reports and the generated PDFs are the whole point of the tool, so they must
// survive a run. Everything upstream writes lands in paths its own .gitignore
// already covers.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";

export interface CareerOpsRuntime {
  /** Directory of the cloned repository, and the cwd of every command. */
  root: string;
  /** How the clone was found — surfaced in health so setup problems are obvious. */
  source: "configured" | "repository" | "cwd";
}

export interface OnboardingState {
  /** True until the user layer (cv.md, profile.yml, _profile.md) exists. */
  onboardingNeeded: boolean;
  /** Which user-layer files are still missing, as career-ops names them. */
  missing: string[];
  /** Non-blocking notes doctor wants surfaced (MCP config, CLI detection). */
  warnings: string[];
  /** Mode templates doctor copied into place during the probe. */
  autoCopied: string[];
}

export interface CareerOpsHealth {
  available: boolean;
  /** The clone exists, even when its dependencies are not installed. */
  cloned: boolean;
  root: string | null;
  /** node_modules is present, so the scripts can actually run. */
  dependenciesInstalled: boolean;
  /** Playwright's chromium download is present — only portal scanning needs it. */
  browsersInstalled: boolean;
  onboarding: OnboardingState | null;
  /** How many router modes the clone publishes. */
  modeCount: number;
  /** Applications currently in data/applications.md, or null when there is none. */
  trackedApplications: number | null;
  reason: string | null;
}

const DOCTOR_TIMEOUT_MS = 60_000;
const DOCTOR_CACHE_MS = 30_000;

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

/** A directory is a career-ops clone when its router skill and doctor are there. */
function isClone(candidate: string): boolean {
  return (
    fs.existsSync(path.join(candidate, "doctor.mjs")) &&
    fs.existsSync(path.join(candidate, "modes")) &&
    fs.existsSync(path.join(candidate, ".agents", "skills", "career-ops", "SKILL.md"))
  );
}

export function resolveCareerOpsRoot(
  env: NodeJS.ProcessEnv = process.env,
): CareerOpsRuntime | null {
  const candidates: Array<{ root: string; source: CareerOpsRuntime["source"] }> = [];
  const explicit = configured(env.CAREER_OPS_ROOT);
  if (env.BREADBOARD_QA_MODE === "1") {
    return explicit && isClone(explicit)
      ? { root: explicit, source: "configured" }
      : null;
  }
  if (explicit) candidates.push({ root: explicit, source: "configured" });
  candidates.push({ root: path.join(repositoryRoot(), "career-ops"), source: "repository" });
  candidates.push({ root: path.resolve(process.cwd(), "career-ops"), source: "cwd" });
  candidates.push({ root: path.resolve(process.cwd(), "..", "career-ops"), source: "cwd" });
  return candidates.find((candidate) => isClone(candidate.root)) ?? null;
}

export function dependenciesInstalled(root: string): boolean {
  // js-yaml is imported by doctor.mjs itself, so its absence is what makes the
  // probe crash rather than report. Check it rather than node_modules alone.
  return fs.existsSync(path.join(root, "node_modules", "js-yaml"));
}

/**
 * Playwright's browser download lives outside the clone (a per-user cache), and
 * only the portal scanner needs it. Missing browsers are a warning, never a
 * blocker — evaluation, CVs, cover letters and the tracker all work without it.
 */
export function browsersInstalled(env: NodeJS.ProcessEnv = process.env): boolean {
  const home = env.USERPROFILE ?? env.HOME ?? "";
  const configuredPath = configured(env.PLAYWRIGHT_BROWSERS_PATH);
  const candidates = [
    configuredPath,
    process.platform === "win32"
      ? path.join(home, "AppData", "Local", "ms-playwright")
      : process.platform === "darwin"
        ? path.join(home, "Library", "Caches", "ms-playwright")
        : path.join(home, ".cache", "ms-playwright"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.some((candidate) => {
    try {
      return fs
        .readdirSync(candidate)
        .some((entry) => entry.toLowerCase().startsWith("chromium"));
    } catch {
      return false;
    }
  });
}

/**
 * Environment for anything career-ops drives. Under the desktop shell the
 * dashboard runs inside Electron, so spawned Node has to be told to behave as
 * Node; `NO_COLOR` keeps script output readable as a tool result rather than as
 * a stream of escape codes.
 */
export function careerOpsEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...env,
    ELECTRON_RUN_AS_NODE: "1",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    CI: "1",
  };
}

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Run one of the clone's own Node scripts. Never throws: a failure to start is
 * returned as text, because every caller either reports it to the user or hands
 * it back to the model as a tool result.
 */
export function runNode(
  root: string,
  args: string[],
  timeoutMs: number,
  options: { maxOutputChars?: number; onChild?: (kill: () => void) => void } = {},
): Promise<CommandResult> {
  const limit = options.maxOutputChars ?? 200_000;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(process.execPath, args, {
        cwd: root,
        windowsHide: true,
        env: careerOpsEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({
        code: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : "spawn failed",
        timedOut: false,
      });
      return;
    }
    options.onChild?.(() => {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (stdout.length < limit) stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < 16_000) stderr += chunk;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: error.message, timedOut });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

function parseOnboarding(stdout: string): OnboardingState | null {
  const start = stdout.indexOf("{");
  if (start < 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.slice(start));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return {
    onboardingNeeded: record.onboardingNeeded === true,
    missing: strings(record.missing),
    warnings: strings(record.warnings),
    autoCopied: strings(record.autoCopied),
  };
}

export function countModes(root: string): number {
  try {
    return fs
      .readdirSync(path.join(root, "modes"))
      .filter((entry) => entry.endsWith(".md") && !entry.startsWith("_")).length;
  } catch {
    return 0;
  }
}

/**
 * How many applications the tracker holds. The tracker is a markdown table, and
 * its rows are the numbered ones — the header and separator are not.
 */
export function countTrackedApplications(root: string): number | null {
  try {
    const table = fs.readFileSync(path.join(root, "data", "applications.md"), "utf8");
    return table.split(/\r?\n/).filter((line) => /^\s*\|\s*\d+\s*\|/.test(line)).length;
  } catch {
    return null;
  }
}

interface HealthCache {
  at: number;
  health: CareerOpsHealth;
}

const globalCache = globalThis as typeof globalThis & {
  __breadboardCareerOpsHealth?: HealthCache;
  __breadboardCareerOpsHealthInFlight?: Promise<CareerOpsHealth>;
};

async function probe(): Promise<CareerOpsHealth> {
  const runtime = resolveCareerOpsRoot();
  if (!runtime) {
    return {
      available: false,
      cloned: false,
      root: null,
      dependenciesInstalled: false,
      browsersInstalled: false,
      onboarding: null,
      modeCount: 0,
      trackedApplications: null,
      reason: "The career-ops clone was not found next to the dashboard.",
    };
  }
  const base = {
    cloned: true,
    root: runtime.root,
    modeCount: countModes(runtime.root),
    trackedApplications: countTrackedApplications(runtime.root),
    browsersInstalled: browsersInstalled(),
  };
  if (!dependenciesInstalled(runtime.root)) {
    return {
      ...base,
      available: false,
      dependenciesInstalled: false,
      onboarding: null,
      reason:
        "career-ops is cloned but its dependencies are not installed. Install them from the Agents tab, or run `npm install` inside career-ops/.",
    };
  }
  // doctor writes the mode templates into place as a side effect of the probe,
  // which is upstream's own idea of what a first run should do.
  const result = await runNode(runtime.root, ["doctor.mjs", "--json"], DOCTOR_TIMEOUT_MS);
  const onboarding = parseOnboarding(result.stdout);
  if (!onboarding) {
    return {
      ...base,
      available: false,
      dependenciesInstalled: true,
      onboarding: null,
      reason: result.timedOut
        ? "career-ops doctor did not answer in time."
        : `career-ops doctor could not report its state. ${result.stderr.split(/\r?\n/)[0] ?? ""}`.trim(),
    };
  }
  return {
    ...base,
    // A missing user layer is not a broken runtime: the agent's first job is to
    // help build it, and several modes (scan, discover, tracker) work without it.
    available: true,
    dependenciesInstalled: true,
    onboarding,
    reason: onboarding.onboardingNeeded
      ? `career-ops has no candidate profile yet — ${onboarding.missing.join(", ")} still missing. Ask the agent to set it up, or add the files under career-ops/.`
      : null,
  };
}

/** Cached because the probe really spawns Node and touches the filesystem. */
export async function health(options: { force?: boolean } = {}): Promise<CareerOpsHealth> {
  const cached = globalCache.__breadboardCareerOpsHealth;
  if (!options.force && cached && Date.now() - cached.at < DOCTOR_CACHE_MS) {
    return cached.health;
  }
  if (globalCache.__breadboardCareerOpsHealthInFlight) {
    return globalCache.__breadboardCareerOpsHealthInFlight;
  }
  const request = probe()
    .then((result) => {
      globalCache.__breadboardCareerOpsHealth = { at: Date.now(), health: result };
      return result;
    })
    .finally(() => {
      globalCache.__breadboardCareerOpsHealthInFlight = undefined;
    });
  globalCache.__breadboardCareerOpsHealthInFlight = request;
  return request;
}

/** Drop the cached probe so the next read reflects a setup action just taken. */
export function invalidateHealth(): void {
  globalCache.__breadboardCareerOpsHealth = undefined;
}
