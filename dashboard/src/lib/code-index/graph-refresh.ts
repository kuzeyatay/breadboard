import { execFile } from "node:child_process";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { graftGraphDirectory } from "./index-service.ts";
import { resolveGraftLauncher } from "./launcher.ts";

/** How often a repository's graph is brought up to date behind the answers. */
const GRAPH_REFRESH_INTERVAL_MS = 10 * 60_000;
const GRAPH_REFRESH_TIMEOUT_MS = 15 * 60_000;

const graphRefreshes = new Map<string, { startedAt: number; done: boolean }>();

/**
 * Bring a repository's graft graph up to date without anyone waiting for it.
 *
 * graft's query commands refresh before answering; `map` is the cheapest of
 * them and its output is discarded. One refresh per repository at a time, at
 * most one per interval, and never on a turn's critical path — a failure here
 * only means the next answers come from a slightly older graph, which is the
 * same graph the coding agents accept while their build is still running.
 */
export function refreshGraphInBackground(
  repositoryPath: string,
  env: NodeJS.ProcessEnv = process.env,
  options: {
    now?: () => number;
    run?: (command: string, args: string[], cwd: string) => Promise<void>;
  } = {},
): boolean {
  const now = options.now ?? Date.now;
  const key = path.resolve(repositoryPath);
  const current = graphRefreshes.get(key);
  if (current && (!current.done || now() - current.startedAt < GRAPH_REFRESH_INTERVAL_MS)) {
    return false;
  }
  const launcher = resolveGraftLauncher(env);
  if (!launcher) return false;
  const record = { startedAt: now(), done: false };
  graphRefreshes.set(key, record);
  const run = options.run ?? runDetached;
  void run(
    launcher.command,
    [...launcher.args, "--dir", graftGraphDirectory(key, env), "map", key],
    key,
  )
    .catch(() => undefined)
    .finally(() => {
      record.done = true;
    });
  return true;
}

function runDetached(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { cwd, windowsHide: true, timeout: GRAPH_REFRESH_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}
