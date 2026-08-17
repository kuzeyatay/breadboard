import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { resolveGraftLauncher, type GraftLauncher } from "./launcher.ts";

/**
 * The graft code index behind every coding agent run.
 *
 * graft (https://github.com/nanonets/graft) turns a repository into a graph of
 * symbols, spans and call edges that answers "where does X live" and "what
 * breaks if I change Y" from one call, instead of the grep-and-read sweep an
 * agent otherwise pays for on every task. Breadboard builds that graph for the
 * repository a Garden is connected to and hands it to the coding agents as an
 * MCP server, so the tools are simply there when a run starts.
 *
 * Two decisions are worth stating, because both are deliberate departures from
 * the way graft is usually installed:
 *
 * 1. The graph lives OUTSIDE the connected repository (`graft --dir`). A default
 *    in-repo `graft/` also writes `.gitignore` and `.ignore` into the user's
 *    working tree, and those files would land in the run's undo snapshot and in
 *    the diff Breadboard shows for the run. A connected repository is the
 *    user's, not ours: an agent run has to leave exactly the edits it made.
 * 2. The build never blocks a run. A cold graph on a large repository takes
 *    minutes; a run that has to wait for one would look hung. The first run on
 *    a freshly connected repository therefore starts the build and proceeds
 *    without graft, and every run after it gets the graph. graft refreshes the
 *    graph itself before answering, so staleness needs no handling here.
 */

export interface GraftServer {
  command: string;
  args: string[];
}

export interface GraftRunContext {
  /** MCP server to register, so the runtime exposes graft's tools. */
  server: GraftServer;
  /** Prepended to the agent's prompt — tools nobody mentions go unused. */
  instruction: string;
  repositoryPath: string;
  graphDirectory: string;
}

export type GraftIndexState = "ready" | "building" | "missing" | "unavailable";

const BUILD_TIMEOUT_MS = 20 * 60_000;
/** A failed build should not be retried on every keystroke-fast rerun. */
const BUILD_RETRY_COOLDOWN_MS = 5 * 60_000;

interface BuildRecord {
  status: "building" | "failed";
  startedAt: number;
  finishedAt: number;
}

const builds = new Map<string, BuildRecord>();

function repositoryKey(repositoryPath: string): string {
  const resolved = path.resolve(repositoryPath);
  const normalized = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  return createHash("sha1").update(normalized).digest("hex").slice(0, 16);
}

function graphRoot(env: NodeJS.ProcessEnv): string {
  const configured = env.BREADBOARD_GRAFT_HOME?.trim();
  return configured || path.resolve(process.cwd(), ".runtime", "graft");
}

/**
 * One graph per repository path, shared by every Garden connected to it — the
 * folder name keeps the repository recognisable, the hash keeps two checkouts
 * of the same project apart.
 */
export function graftGraphDirectory(
  repositoryPath: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const label =
    path.basename(path.resolve(repositoryPath)).replace(/[^A-Za-z0-9._-]/g, "-") ||
    "repository";
  return path.join(graphRoot(env), `${label}-${repositoryKey(repositoryPath)}`);
}

export function graftIndexExists(
  repositoryPath: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return existsSync(path.join(graftGraphDirectory(repositoryPath, env), "INDEX.md"));
}

export function graftIndexState(
  repositoryPath: string,
  env: NodeJS.ProcessEnv = process.env,
): GraftIndexState {
  if (!resolveGraftLauncher(env)) return "unavailable";
  if (graftIndexExists(repositoryPath, env)) return "ready";
  return builds.get(repositoryKey(repositoryPath))?.status === "building"
    ? "building"
    : "missing";
}

function startBuild(
  launcher: GraftLauncher,
  repositoryPath: string,
  graphDirectory: string,
  key: string,
): void {
  mkdirSync(graphDirectory, { recursive: true });
  builds.set(key, { status: "building", startedAt: Date.now(), finishedAt: 0 });
  const child = spawn(
    launcher.command,
    [...launcher.args, "--dir", graphDirectory, "build", repositoryPath],
    {
      cwd: repositoryPath,
      windowsHide: true,
      stdio: "ignore",
      env: { ...process.env, NO_COLOR: "1" },
    },
  );
  const timer = setTimeout(() => child.kill(), BUILD_TIMEOUT_MS);
  // A build outliving the request that asked for it is the point; it must not
  // hold the process open once it is the only thing left running.
  timer.unref?.();
  child.unref();
  const settle = (built: boolean) => {
    clearTimeout(timer);
    if (built) builds.delete(key);
    else builds.set(key, { status: "failed", startedAt: 0, finishedAt: Date.now() });
  };
  child.on("close", () => settle(graftIndexExists(repositoryPath)));
  child.on("error", () => settle(false));
}

/**
 * Build the graph for this repository if it has none, and report what a run can
 * count on right now. Safe to call on every run: a build already in flight, a
 * graph already on disk, and a build that failed minutes ago all short-circuit.
 */
export function ensureGraftIndex(
  repositoryPath: string,
  env: NodeJS.ProcessEnv = process.env,
): GraftIndexState {
  const launcher = resolveGraftLauncher(env);
  if (!launcher) return "unavailable";
  if (graftIndexExists(repositoryPath, env)) return "ready";

  const key = repositoryKey(repositoryPath);
  const record = builds.get(key);
  if (record?.status === "building") {
    if (Date.now() - record.startedAt < BUILD_TIMEOUT_MS) return "building";
  } else if (
    record?.status === "failed" &&
    Date.now() - record.finishedAt < BUILD_RETRY_COOLDOWN_MS
  ) {
    return "missing";
  }

  try {
    startBuild(launcher, path.resolve(repositoryPath), graftGraphDirectory(repositoryPath, env), key);
  } catch {
    builds.set(key, { status: "failed", startedAt: 0, finishedAt: Date.now() });
    return "missing";
  }
  return "building";
}

export function graftServerFor(
  repositoryPath: string,
  env: NodeJS.ProcessEnv = process.env,
): GraftServer | null {
  const launcher = resolveGraftLauncher(env);
  if (!launcher) return null;
  const resolvedRepository = path.resolve(repositoryPath);
  return {
    command: launcher.command,
    args: [
      ...launcher.args,
      "--dir",
      graftGraphDirectory(resolvedRepository, env),
      "mcp",
      resolvedRepository,
    ],
  };
}

/**
 * Naming the tools is what makes them get used: an agent handed an unexplained
 * MCP server still opens with a `grep`. The CLI form is spelled out too, since
 * the graph directory is outside the repository and no agent would guess the
 * `--dir` it needs.
 */
export function graftInstruction(context: {
  repositoryPath: string;
  graphDirectory: string;
}): string {
  const repository = JSON.stringify(context.repositoryPath);
  const graph = JSON.stringify(context.graphDirectory);
  return [
    "This repository is indexed by graft. Get your bearings from the graph before you grep or read whole files — it answers from prebuilt nodes with exact file:line, and one call usually replaces several reads.",
    "- graft_find_code — locate and understand: \"how does X work\", \"where is Y\". The default first call.",
    "- graft_find_all — every occurrence of a literal, when a ranked top-N is not enough.",
    "- graft_trace_calls — who calls a symbol, what it calls, the blast radius. Run this BEFORE renaming or changing a shared symbol; editing the one obvious file and stopping is the classic miss.",
    "- graft_file_api — a file's whole API in ~200 tokens, instead of reading it.",
    "- graft_repo_map — orientation in an unfamiliar area.",
    `If those tools are not exposed in this run, the same graph is a CLI: \`graft --dir ${graph} ask "<task>" --source ${repository}\` (also \`grep\`, \`skeleton <file>\`, \`callers <symbol>\`, \`map\`). The --dir is required — the graph is kept outside the repository so a run's diff stays exactly the edits you made.`,
    "Pick the one tool that fits and act on its answer; do not re-ask the same question reworded. Read source files to edit them, not to find them.",
  ].join("\n");
}

/**
 * Everything a run needs, or null when graft cannot serve this repository yet —
 * no CLI installed, or a graph still building.
 */
export function graftRunContextFor(
  repositoryPath: string,
  env: NodeJS.ProcessEnv = process.env,
): GraftRunContext | null {
  const state = ensureGraftIndex(repositoryPath, env);
  if (state !== "ready") return null;
  const server = graftServerFor(repositoryPath, env);
  if (!server) return null;
  const resolvedRepository = path.resolve(repositoryPath);
  const graphDirectory = graftGraphDirectory(resolvedRepository, env);
  return {
    server,
    instruction: graftInstruction({
      repositoryPath: resolvedRepository,
      graphDirectory,
    }),
    repositoryPath: resolvedRepository,
    graphDirectory,
  };
}
