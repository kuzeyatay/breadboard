// Locating the cloned Harvey LAB harness and the Python that can run it.
//
// The clone is a benchmark repository: 1,671 legal tasks, an execution harness,
// and an LLM judge. Breadboard uses the harness half — its system prompt, its
// six workspace tools, and its .docx/.xlsx/.pptx skill manuals — and supplies
// the assignment and the documents itself. Nothing here reads `tasks/`.
//
// Two things the clone assumes and this machine does not have:
//
// **Podman.** Every tool call in the benchmark runs inside a rootless container,
// which is the right answer when the documents are adversarial fixtures and the
// model is the thing on trial. Here the documents are the user's own, so
// `scripts/legal-bridge.py` re-implements the sandbox interface over a per-run
// directory instead — inheriting the clone's own path discipline rather than
// reimplementing it. The "let it run commands" switch is what replaces the
// container boundary, and it is the reason that switch exists.
//
// **Pandoc.** Reading a .docx goes through it. `pypandoc-binary` puts a pandoc
// in the environment we build, so nothing has to be installed system-wide; if
// it is missing anyway the bridge falls back to MarkItDown and health says so.
//
// The environment lives in `harvey-labs/.venv` — inside the clone, covered by
// its .gitignore, removable by deleting one directory — and Breadboard never
// builds it behind a run: the Agents tab asks and the user agrees.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";

export interface LegalRuntime {
  /** Directory of the cloned repository — the cwd of every command. */
  root: string;
  /** How the clone was found; surfaced in health so a mislocation is obvious. */
  source: "configured" | "repository" | "cwd";
}

export interface LegalHealth {
  /** Ready to run an assignment right now. */
  available: boolean;
  /** The clone exists, even when its environment is not built. */
  cloned: boolean;
  root: string | null;
  /** The virtual environment exists and has a Python executable. */
  environmentReady: boolean;
  /** The harness imports inside that environment, with its document libraries. */
  harnessImportable: boolean;
  /** Pandoc is available, so .docx reading uses it rather than the fallback. */
  pandocAvailable: boolean;
  /** A real bash exists, so the `bash` tool and the skill scripts can run. */
  shellAvailable: boolean;
  /** The Python that would build the environment, when there is no venv yet. */
  systemPython: string | null;
  /** uv is on PATH — the only supported way to build the environment. */
  uvAvailable: boolean;
  /** Breadboard's bridge script, which is not part of the clone. */
  bridgeFound: boolean;
  reason: string | null;
}

const PROBE_TIMEOUT_MS = 60_000;
const HEALTH_CACHE_MS = 20_000;

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

/** A directory is the LAB clone when the harness and its sandbox are there. */
export function isClone(candidate: string): boolean {
  return (
    fs.existsSync(path.join(candidate, "harness", "agent_loop.py")) &&
    fs.existsSync(path.join(candidate, "harness", "tools.py")) &&
    fs.existsSync(path.join(candidate, "harness", "system_prompt.md")) &&
    fs.existsSync(path.join(candidate, "sandbox", "sandbox.py"))
  );
}

export function resolveLegalRoot(env: NodeJS.ProcessEnv = process.env): LegalRuntime | null {
  const candidates: Array<{ root: string; source: LegalRuntime["source"] }> = [];
  const explicit = configured(env.HARVEY_LABS_ROOT);
  if (env.BREADBOARD_QA_MODE === "1") {
    return explicit && isClone(explicit)
      ? { root: explicit, source: "configured" }
      : null;
  }
  if (explicit) candidates.push({ root: explicit, source: "configured" });
  candidates.push({ root: path.join(repositoryRoot(), "harvey-labs"), source: "repository" });
  candidates.push({ root: path.resolve(process.cwd(), "harvey-labs"), source: "cwd" });
  candidates.push({ root: path.resolve(process.cwd(), "..", "harvey-labs"), source: "cwd" });
  return candidates.find((candidate) => isClone(candidate.root)) ?? null;
}

/** The bridge script, which is Breadboard's own file and not part of the clone. */
export function bridgeScriptPath(): string | null {
  const candidates = [
    path.join(repositoryRoot(), "scripts", "legal-bridge.py"),
    path.resolve(process.cwd(), "scripts", "legal-bridge.py"),
    path.resolve(process.cwd(), "..", "scripts", "legal-bridge.py"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export function venvDirectory(root: string): string {
  return path.join(root, ".venv");
}

/** The Python inside the clone's virtual environment, if it has been built. */
export function venvPython(root: string): string | null {
  const candidate =
    process.platform === "win32"
      ? path.join(venvDirectory(root), "Scripts", "python.exe")
      : path.join(venvDirectory(root), "bin", "python");
  return fs.existsSync(candidate) ? candidate : null;
}

/** Find an executable on PATH, honouring PATHEXT on Windows. */
export function resolveOnPath(
  executable: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (path.isAbsolute(executable)) return fs.existsSync(executable) ? executable : null;
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const directories = (env[pathKey] ?? "").split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
      : [""];
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${executable}${extension}`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function safeSize(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/**
 * A Python that could build the environment. The clone needs 3.12 or 3.13; the
 * one on PATH is only a starting point, because uv fetches a matching
 * interpreter when this one is too new — which it currently is on this machine.
 */
export function findSystemPython(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = configured(env.HARVEY_LABS_PYTHON);
  if (explicit && fs.existsSync(explicit)) return explicit;
  for (const name of ["python3", "python"]) {
    const found = resolveOnPath(name, env);
    // The Windows Store alias is a zero-byte reparse point that opens the Store
    // instead of running anything.
    if (found && safeSize(found) > 0) return found;
  }
  return null;
}

export function uvPath(env: NodeJS.ProcessEnv = process.env): string | null {
  return resolveOnPath("uv", env);
}

/**
 * A real bash for the agent's `bash` tool and the skill scripts.
 *
 * `C:\Windows\System32\bash.exe` is deliberately excluded: it is the WSL
 * launcher, and the Linux shell it starts cannot see the Windows workspace at
 * the path it would be handed. Kept in step with `_find_shell` in the bridge —
 * a test asserts both sides name the same executable.
 */
export function findShell(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = configured(env.LEGAL_AGENT_BASH);
  if (explicit && fs.existsSync(explicit)) return explicit;
  const programFiles = env.PROGRAMFILES ?? "C:\\Program Files";
  const gitCandidates =
    process.platform === "win32"
      ? [
          path.join(programFiles, "Git", "bin", "bash.exe"),
          path.join(programFiles, "Git", "usr", "bin", "bash.exe"),
        ]
      : [];
  const found = gitCandidates.find((candidate) => fs.existsSync(candidate));
  if (found) return found;
  const onPath = resolveOnPath("bash", env);
  return onPath && !onPath.toLowerCase().includes("system32") ? onPath : null;
}

/** Breadboard's own state directory for this agent, never the clone's. */
export function stateRoot(): string {
  const configured = process.env.LEGAL_AGENT_STATE_DIR?.trim();
  return configured
    ? path.resolve(configured)
    : path.join(repositoryRoot(), ".runtime", "legal");
}

/**
 * Environment for anything the harness runs. Under the desktop shell the
 * dashboard is Electron, so a spawned Node-launched process has to be told to
 * behave as Node; the encoding vars keep Python's own output UTF-8 on Windows,
 * where a memo full of typographic dashes would otherwise be mangled by cp1252.
 */
export function legalEnv(
  extra: Record<string, string | undefined> = {},
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...env,
    ELECTRON_RUN_AS_NODE: "1",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    PYTHONUNBUFFERED: "1",
    ...extra,
  };
}

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Run one command for the harness. Never throws: every caller either reports
 * the failure to the user or turns it into a health reason.
 */
export function runCommand(
  command: string,
  args: string[],
  options: {
    cwd: string;
    timeoutMs: number;
    env?: Record<string, string | undefined>;
    maxOutputChars?: number;
    onChild?: (kill: () => void) => void;
    onStdout?: (chunk: string) => void;
  },
): Promise<CommandResult> {
  const limit = options.maxOutputChars ?? 200_000;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        windowsHide: true,
        env: legalEnv(options.env ?? {}),
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
      options.onStdout?.(chunk);
      if (stdout.length < limit) stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < 32_000) stderr += chunk;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    }, options.timeoutMs);
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

interface HealthCache {
  at: number;
  health: LegalHealth;
}

const globalCache = globalThis as typeof globalThis & {
  __breadboardLegalHealth?: HealthCache;
  __breadboardLegalHealthInFlight?: Promise<LegalHealth>;
};

/**
 * One probe answers three questions at once, because starting a Python
 * interpreter is the expensive part: does the harness import, is pandoc
 * reachable, and are the document libraries actually installed. A venv can
 * exist with a half-finished install behind it, so the import is the only
 * check that means anything.
 */
const PROBE_SOURCE = [
  "import json, shutil, sys",
  "sys.path.insert(0, sys.argv[1])",
  "from harness.tools import get_all_tool_definitions",
  "from harness.adapters.openai import OpenAIAdapter",
  "from harness.agent_loop import run_agent",
  "from sandbox.sandbox import Sandbox",
  "import docx, pptx, openpyxl, pdfplumber, markitdown",
  "pandoc = shutil.which('pandoc')",
  "if not pandoc:",
  "    try:",
  "        import pypandoc, pathlib",
  "        found = pathlib.Path(pypandoc.get_pandoc_path())",
  "        pandoc = str(found if found.exists() else found.with_suffix('.exe'))",
  "        pandoc = pandoc if pathlib.Path(pandoc).exists() else ''",
  "    except Exception:",
  "        pandoc = ''",
  "print(json.dumps({'ok': True, 'pandoc': bool(pandoc), 'tools': len(get_all_tool_definitions())}))",
].join("\n");

async function probe(): Promise<LegalHealth> {
  const runtime = resolveLegalRoot();
  const bridgeFound = Boolean(bridgeScriptPath());
  const shellAvailable = Boolean(findShell());

  if (!runtime) {
    return {
      available: false,
      cloned: false,
      root: null,
      environmentReady: false,
      harnessImportable: false,
      pandocAvailable: false,
      shellAvailable,
      systemPython: findSystemPython(),
      uvAvailable: Boolean(uvPath()),
      bridgeFound,
      reason: "The harvey-labs clone was not found next to the dashboard.",
    };
  }

  const base = {
    cloned: true,
    root: runtime.root,
    uvAvailable: Boolean(uvPath()),
    bridgeFound,
    shellAvailable,
  };

  const python = venvPython(runtime.root);
  if (!python) {
    return {
      ...base,
      available: false,
      environmentReady: false,
      harnessImportable: false,
      pandocAvailable: false,
      systemPython: findSystemPython(),
      reason:
        "The Legal Agent is cloned but its Python environment has not been built yet. Build it from its settings.",
    };
  }

  const result = await runCommand(python, ["-c", PROBE_SOURCE, runtime.root], {
    cwd: runtime.root,
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  let parsed: { ok?: boolean; pandoc?: boolean } = {};
  try {
    const line = result.stdout.split(/\r?\n/).filter(Boolean).at(-1) ?? "";
    parsed = JSON.parse(line) as { ok?: boolean; pandoc?: boolean };
  } catch {
    parsed = {};
  }
  const harnessImportable = result.code === 0 && parsed.ok === true;

  if (!harnessImportable) {
    return {
      ...base,
      available: false,
      environmentReady: true,
      harnessImportable: false,
      pandocAvailable: false,
      systemPython: python,
      reason: result.timedOut
        ? "The Legal Agent environment did not answer in time."
        : `The Legal Agent environment exists but the harness does not import. ${
            result.stderr.split(/\r?\n/).filter(Boolean).at(-1) ?? ""
          }`.trim(),
    };
  }

  if (!bridgeFound) {
    return {
      ...base,
      available: false,
      environmentReady: true,
      harnessImportable: true,
      pandocAvailable: parsed.pandoc === true,
      systemPython: python,
      reason: "Breadboard's legal bridge script is missing from scripts/.",
    };
  }

  return {
    ...base,
    available: true,
    environmentReady: true,
    harnessImportable: true,
    pandocAvailable: parsed.pandoc === true,
    systemPython: python,
    reason: null,
  };
}

/** Cached because the probe really starts a Python interpreter. */
export async function health(options: { force?: boolean } = {}): Promise<LegalHealth> {
  const cached = globalCache.__breadboardLegalHealth;
  if (!options.force && cached && Date.now() - cached.at < HEALTH_CACHE_MS) {
    return cached.health;
  }
  if (globalCache.__breadboardLegalHealthInFlight) {
    return globalCache.__breadboardLegalHealthInFlight;
  }
  const request = probe()
    .then((result) => {
      globalCache.__breadboardLegalHealth = { at: Date.now(), health: result };
      return result;
    })
    .finally(() => {
      globalCache.__breadboardLegalHealthInFlight = undefined;
    });
  globalCache.__breadboardLegalHealthInFlight = request;
  return request;
}

/** Drop the cached probe so the next read reflects a setup step just taken. */
export function invalidateHealth(): void {
  globalCache.__breadboardLegalHealth = undefined;
}
