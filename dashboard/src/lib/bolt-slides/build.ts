// Building one deck, and reading the failure back well enough to repair it.
//
// This is a plain `vite build` in the run's workspace, spawned as
// `node <clone>/node_modules/vite/bin/vite.js build` rather than through npm or
// npx — the same choice the Wardrobe runtime makes, for the same reason: a
// `.cmd` shim on Windows is a quoting hazard, and there is nothing here that
// needs a package manager.
//
// The interesting half is `buildFailure`. Vite reports a broken deck as a wall
// of Rollup output, and handing all of it back to the model as "fix this" wastes
// the repair round on reading. So the first real error line is lifted out, with
// the file and position Rollup names, and that is what the repair prompt leads
// with. The full tail still travels behind it, because the line that names the
// cause is not always the line that explains it.

import { spawn, type ChildProcess } from "node:child_process";
import { viteEntry } from "./runtime.ts";
import { runDirectory } from "./workspace.ts";

/** A deck is a few dozen small modules; a build past this is stuck, not slow. */
const BUILD_TIMEOUT_MS = 6 * 60_000;
const MAX_LOG_CHARS = 24_000;

export interface BuildResult {
  ok: boolean;
  /** The tail of everything Vite said, trimmed to something readable. */
  log: string;
  /** The one line that names the cause, when Rollup gave one. */
  failure: string;
  durationMs: number;
}

/**
 * The line worth leading a repair with.
 *
 * Rollup's own diagnostics start with a marker — `[vite]:`, `error during
 * build:`, `x Build failed` — and esbuild's syntax errors carry a
 * `file:line:column` prefix. Either shape is a better opening than the last
 * line of the log, which is usually the exit banner.
 */
export function buildFailure(log: string): string {
  const lines = log
    .split(/\r?\n/)
    .map((line) => line.replace(/\[[0-9;]*m/g, "").trim())
    .filter(Boolean);
  const marked = lines.find(
    (line) =>
      /^(\[vite\][^\s]*:|error during build:|x |✘|RollupError|Error:)/i.test(line) ||
      /^[^\s:]+\.(tsx?|css):\d+:\d+:/.test(line),
  );
  if (marked) {
    const index = lines.indexOf(marked);
    // The line after a marker is usually the one that says what is wrong; the
    // marker on its own is often just "error during build:".
    return lines.slice(index, index + 3).join("\n").slice(0, 1_200);
  }
  return lines.slice(-3).join("\n").slice(0, 1_200);
}

export interface BuildHandle {
  promise: Promise<BuildResult>;
  /** Stop the build; the promise still settles, as a failure. */
  kill: () => void;
}

export function buildDeck(
  runId: string,
  onLog?: (line: string) => void,
): BuildHandle {
  const entry = viteEntry();
  const startedAt = Date.now();
  if (!entry) {
    return {
      promise: Promise.resolve({
        ok: false,
        log: "",
        failure: "Bolt Slides' dependencies are not installed, so no deck can be built.",
        durationMs: 0,
      }),
      kill: () => undefined,
    };
  }

  let child: ChildProcess | null = null;
  const promise = new Promise<BuildResult>((resolve) => {
    let log = "";
    const spawned = spawn(process.execPath, [entry, "build"], {
      cwd: runDirectory(runId),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NO_COLOR: "1",
        FORCE_COLOR: "0",
        // Vite reads this to decide `import.meta.env.MODE`; a deck is only ever
        // built for viewing, never for the dashboard's own dev conditions.
        NODE_ENV: "production",
      },
    });
    child = spawned;

    const collect = (chunk: string) => {
      log = `${log}${chunk}`.slice(-MAX_LOG_CHARS);
      if (!onLog) return;
      for (const line of chunk.split(/\r?\n/)) {
        const cleaned = line.replace(/\[[0-9;]*m/g, "").trim();
        if (cleaned) onLog(cleaned.slice(0, 500));
      }
    };
    spawned.stdout?.setEncoding("utf8");
    spawned.stderr?.setEncoding("utf8");
    spawned.stdout?.on("data", collect);
    spawned.stderr?.on("data", collect);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        spawned.kill();
      } catch {
        // Already gone.
      }
    }, BUILD_TIMEOUT_MS);
    timer.unref?.();

    const settle = (result: Omit<BuildResult, "durationMs">) => {
      clearTimeout(timer);
      child = null;
      resolve({ ...result, durationMs: Date.now() - startedAt });
    };

    spawned.on("error", (error) => {
      settle({ ok: false, log, failure: error.message });
    });
    spawned.on("exit", (code) => {
      if (timedOut) {
        settle({ ok: false, log, failure: "The deck build ran past its time limit." });
        return;
      }
      settle(
        code === 0
          ? { ok: true, log, failure: "" }
          : { ok: false, log, failure: buildFailure(log) },
      );
    });
  });

  return {
    promise,
    kill: () => {
      try {
        child?.kill();
      } catch {
        // Already exited.
      }
    },
  };
}
