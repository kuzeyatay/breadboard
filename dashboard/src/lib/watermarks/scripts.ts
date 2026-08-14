import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { repositoryRoot } from "../runtime-paths.ts";

// watermarks-remover (github.com/guillaumemeyer/watermarks-remover) strips AI
// provenance marks from text and files: invisible Unicode carriers, C2PA
// manifests, EXIF/XMP blocks and document container properties. The vendored
// clone is pinned in `watermarks-remover/BREADBOARD_UPSTREAM_COMMIT`.
//
// The whole thing is Python 3.10+ *stdlib* — no virtualenv, no install step,
// nothing to provision. That is why this file is so much smaller than its
// OfficeCLI counterpart: resolving the interpreter and the script directory is
// the entire runtime story.

const SCRIPT_TIMEOUT_MS = 120_000;

/** Output ceiling per run. A directory audit is the only thing that gets near it. */
const MAX_OUTPUT_BYTES = 512 * 1024;

export class WatermarkError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "WatermarkError";
    this.status = status;
    this.code = code;
  }
}

/** Root of the vendored clone; `WATERMARKS_REMOVER_ROOT` overrides it. */
export function cloneRoot(): string {
  const configured = process.env.WATERMARKS_REMOVER_ROOT?.trim();
  return configured ? path.resolve(configured) : path.join(repositoryRoot(), "watermarks-remover");
}

/**
 * The skill's `scripts/` directory — what actually gets executed. The packaged
 * app stages only this subtree plus `references/`, so both layouts resolve to
 * the same place.
 */
export function scriptsDir(): string {
  return path.join(cloneRoot(), "skills", "remove-ai-marks", "scripts");
}

export function scriptPath(name: string): string {
  return path.join(scriptsDir(), name);
}

/** Whether the vendored scripts are present, checked on the unified router. */
export function scriptsAvailable(): boolean {
  return fs.existsSync(scriptPath("clean_file.py")) && fs.existsSync(scriptPath("inspect_file.py"));
}

/**
 * Interpreter candidates, most specific first. `python3` does not exist on a
 * default Windows install — worse, the App Execution Alias makes it *resolve*
 * and then fail with a Microsoft Store advertisement, so the Windows order has
 * to put plain `python` first rather than treating `python3` as the portable
 * name.
 */
function pythonCandidates(): string[] {
  const configured = process.env.WATERMARKS_REMOVER_PYTHON?.trim();
  return [
    ...(configured ? [configured] : []),
    ...(process.platform === "win32" ? ["python.exe", "python", "python3"] : ["python3", "python"]),
  ];
}

export interface ScriptRun {
  code: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
}

function spawnOnce(python: string, argv: string[], cwd: string): Promise<ScriptRun | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(python, argv, {
        cwd,
        shell: false,
        windowsHide: true,
        // The scripts print codepoint labels ("U+200B ZERO WIDTH SPACE"); a
        // legacy console codepage would mangle them into a decode error that
        // reads like the file was unreadable.
        env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      });
    } catch {
      resolve(null);
      return;
    }
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, SCRIPT_TIMEOUT_MS);

    const collect = (chunk: Buffer, into: "out" | "err") => {
      const text = chunk.toString("utf8");
      if (into === "out") {
        if (stdout.length + text.length > MAX_OUTPUT_BYTES) {
          stdout = (stdout + text).slice(0, MAX_OUTPUT_BYTES);
          truncated = true;
        } else stdout += text;
      } else if (stderr.length < MAX_OUTPUT_BYTES) {
        stderr = (stderr + text).slice(0, MAX_OUTPUT_BYTES);
      }
    };
    child.stdout?.on("data", (chunk: Buffer) => collect(chunk, "out"));
    child.stderr?.on("data", (chunk: Buffer) => collect(chunk, "err"));

    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // ENOENT for this candidate interpreter — let the caller try the next.
      resolve(null);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, truncated, timedOut });
    });
  });
}

/**
 * Run one vendored script. Tries each interpreter candidate in turn so a
 * machine whose `python3` is the Windows Store stub still works, and reports a
 * missing interpreter as its own actionable error rather than as a failed run.
 */
export async function runScript(script: string, args: string[], cwd: string): Promise<ScriptRun> {
  if (!scriptsAvailable()) {
    throw new WatermarkError(
      503,
      "watermarks_scripts_unavailable",
      `The watermarks-remover scripts are not installed at ${scriptsDir()}. Clone ` +
        "github.com/guillaumemeyer/watermarks-remover into the repository root, or set " +
        "WATERMARKS_REMOVER_ROOT to the checkout.",
    );
  }
  const file = scriptPath(script);
  if (!fs.existsSync(file)) {
    throw new WatermarkError(503, "watermarks_script_missing", `${script} is missing from the vendored checkout.`);
  }
  for (const python of pythonCandidates()) {
    const run = await spawnOnce(python, [file, ...args], cwd);
    if (run) return run;
  }
  throw new WatermarkError(
    503,
    "watermarks_python_unavailable",
    "Python 3.10+ was not found. Install it, or set WATERMARKS_REMOVER_PYTHON to the interpreter path.",
  );
}

/**
 * Parse a `--json` report. The scripts print JSON on stdout and diagnostics on
 * stderr, so a parse failure means the run itself failed — surfacing stderr is
 * what makes that legible instead of "unexpected token".
 */
export function parseReport(run: ScriptRun, what: string): Record<string, unknown> {
  const text = run.stdout.trim();
  if (text) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Fall through to the error below with stderr attached.
    }
  }
  const detail = run.timedOut
    ? "it timed out"
    : run.stderr.trim().split("\n").slice(-4).join(" ").slice(0, 400) || `it exited with code ${run.code}`;
  throw new WatermarkError(502, "watermarks_script_failed", `${what} failed: ${detail}`);
}

/**
 * Resolve a caller-supplied path inside the workspace, refusing anything that
 * escapes it. Copied from the Office tools' containment for the same reason:
 * a tool that opens any path a model writes is a tool that reads the user's
 * disk. `.breadboard` is denied outright — the session's own capability token
 * lives there.
 */
export function containWorkspacePath(
  workspace: string,
  raw: string,
  label: string,
  { allowRoot = false }: { allowRoot?: boolean } = {},
): string {
  const value = raw.trim();
  if (!value) {
    throw new WatermarkError(400, "watermarks_path_required", `${label} is required.`);
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    throw new WatermarkError(
      400,
      "watermarks_path_remote",
      `${label} must be a file in this conversation's workspace, not a URL. Ask the user to attach it instead.`,
    );
  }
  const resolved = path.resolve(workspace, value);
  const relative = path.relative(workspace, resolved);
  if ((!relative && !allowRoot) || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new WatermarkError(
      403,
      "watermarks_path_outside_workspace",
      `${label} must be inside this conversation's workspace (got ${JSON.stringify(raw)}).`,
    );
  }
  if (relative.split(/[\\/]/).includes(".breadboard")) {
    throw new WatermarkError(403, "watermarks_path_reserved", `${label} may not reach the .breadboard directory.`);
  }
  return resolved;
}
