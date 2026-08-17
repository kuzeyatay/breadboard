import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";

/**
 * The deterministic half of the vendored `SerhiiKorniienko/bullshit-detector`
 * pack. The clone's own separation of concerns is the reason this is a tool at
 * all: its scripts fetch, parse and count, and its skills reason. Reasoning is
 * what the model already does, so only the scripts need a callback — and they
 * are the half a chat surface cannot otherwise run, because Garden Chat has no
 * shell and the analysis is worthless without the text it is analysing.
 *
 * Every script is PEP 723 self-contained, so `uv run --script` resolves each
 * one's dependencies on its own rather than requiring a prepared virtualenv.
 */

const MAX_ARGUMENTS = 12;
const MAX_ARGUMENT_LENGTH = 4_096;
const MAX_ARGUMENT_BYTES = 16 * 1024;
/** Hard ceiling on captured bytes; a 3-hour podcast transcript is ~1 MB. */
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
/** How much of the output comes back in the tool response, not the file. */
const PREVIEW_BYTES = 24 * 1024;
const DEFAULT_TIMEOUT_MS = 180_000;
/** Fetching is the slowest and least reliable call in the workflow. */
const FETCH_TIMEOUT_MS = 300_000;
/** Every artifact this tool writes lands here, inside the session workspace. */
const OUTPUT_SUBDIRECTORY = "factcheck";

interface FactcheckCommand {
  /** Path to the script, relative to the clone root. */
  script: string;
  /** Flags the model may pass. Anything else is refused by name. */
  flags: ReadonlySet<string>;
  /**
   * How the leading positional argument is treated: a URL or local file for
   * `fetch`, a workspace-relative report path for the report gates, and free
   * search text for coverage.
   */
  positional: "source" | "report" | "query";
  timeoutMs: number;
  /** Extension of the file the captured stdout is written to. */
  outputExtension: string;
}

const COMMANDS: Readonly<Record<string, FactcheckCommand>> = {
  fetch: {
    script: "skills/ingestion/fetch-content/scripts/fetch.py",
    flags: new Set(["--json", "--lang"]),
    positional: "source",
    timeoutMs: FETCH_TIMEOUT_MS,
    outputExtension: "md",
  },
  coverage: {
    script: "skills/ingestion/coverage-check/scripts/coverage.py",
    flags: new Set(["--json", "--timespan", "--max", "--sort", "--timeout"]),
    positional: "query",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    outputExtension: "md",
  },
  tally: {
    script: "skills/analysis/bullshit-detector/scripts/tally.py",
    // `--fix` rewrites the report's Tally line in place. The report is a file
    // this same turn wrote into its own workspace, so the edit is contained,
    // and refusing it would leave the model to fix arithmetic by hand — the
    // exact failure the script exists to remove.
    flags: new Set(["--json", "--fix"]),
    positional: "report",
    timeoutMs: 60_000,
    outputExtension: "txt",
  },
  retractions: {
    script: "skills/analysis/bullshit-detector/scripts/retractions.py",
    flags: new Set([]),
    positional: "report",
    timeoutMs: 120_000,
    outputExtension: "txt",
  },
};

/**
 * The pack's SKILL.md is an entry point that defers its scoring detail to files
 * beside it, and `skill_open` serves a SKILL.md only — so on a chat surface
 * every "see RUBRIC.md" pointer in the injected guidance would be a dead link.
 * This reads those files, and only those files, out of the pinned clone. It
 * spawns nothing; it is here rather than in a tool of its own because it is the
 * same skill's other half.
 */
const REFERENCES: Readonly<Record<string, string>> = {
  "RUBRIC.md": "skills/analysis/bullshit-detector/RUBRIC.md",
  "CLAIMS.md": "skills/analysis/bullshit-detector/CLAIMS.md",
  "RUN-RECORD.md": "skills/analysis/bullshit-detector/RUN-RECORD.md",
};

/** A reference file is guidance the model must read whole, so it is not clipped. */
const MAX_REFERENCE_BYTES = 256 * 1024;

export const FACTCHECK_COMMANDS = Object.freeze([
  ...Object.keys(COMMANDS),
  "reference",
]);

export const FACTCHECK_REFERENCES = Object.freeze(Object.keys(REFERENCES));

/** Schemes `fetch` may be pointed at. Everything else must be a workspace file. */
const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:"]);

export interface FactcheckRuntime {
  /** Absolute path to `uv`, or to a Python interpreter when uv is absent. */
  executable: string;
  /** True when `executable` is uv and scripts self-resolve their dependencies. */
  usesUv: boolean;
  /** Absolute path to the vendored clone. */
  cloneRoot: string;
}

export interface FactcheckRunResult {
  command: string;
  arguments: string[];
  exitCode: number | null;
  durationMs: number;
  /** Workspace-relative path of the full captured output. */
  outputPath: string;
  /** Bytes written to `outputPath`. */
  outputBytes: number;
  /** The head of the output, capped so a long transcript cannot flood a turn. */
  preview: string;
  /** True when `preview` is shorter than the file. */
  truncated: boolean;
  /** The script's actionable `HINT:` line and any other diagnostics. */
  stderr: string;
}

export class FactcheckServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FactcheckServiceError";
    this.code = code;
  }
}

function configuredValue(value: string | undefined): string | null {
  const configured = value?.trim();
  return configured ? path.resolve(configured) : null;
}

function findOnPath(command: string, env: NodeJS.ProcessEnv): string | null {
  const entries = (env.PATH ?? env.Path ?? "").split(path.delimiter);
  const names = process.platform === "win32"
    ? [`${command}.exe`, `${command}.cmd`, command]
    : [command];
  for (const entry of entries) {
    if (!entry.trim()) continue;
    for (const name of names) {
      const candidate = path.join(entry, name);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // An unreadable PATH entry is not this resolution's problem.
      }
    }
  }
  return null;
}

/**
 * Resolves the clone and the interpreter that runs its scripts. `uv` is
 * strongly preferred: the scripts declare their dependencies inline, so uv
 * needs no prepared environment, while a bare Python only works if the five
 * fetch dependencies happen to be installed already.
 */
export function resolveFactcheckRuntime(
  env: NodeJS.ProcessEnv = process.env,
): FactcheckRuntime | null {
  const cloneRoot = configuredValue(env.BREADBOARD_BULLSHIT_DETECTOR_ROOT) ??
    path.join(repositoryRoot(), "bullshit-detector");
  if (!fs.existsSync(path.join(cloneRoot, COMMANDS.fetch.script))) return null;
  const configuredUv = configuredValue(env.BREADBOARD_FACTCHECK_UV);
  const uv = configuredUv && fs.existsSync(configuredUv)
    ? configuredUv
    : findOnPath("uv", env);
  if (uv) return { executable: uv, usesUv: true, cloneRoot };
  const python = configuredValue(env.BREADBOARD_FACTCHECK_PYTHON) ??
    findOnPath(process.platform === "win32" ? "python" : "python3", env);
  if (!python || !fs.existsSync(python)) return null;
  return { executable: python, usesUv: false, cloneRoot };
}

export interface ValidatedFactcheckCommand {
  command: string;
  /** `reference` reads a bundled file; every other command spawns a script. */
  kind: "script" | "reference";
  /** Arguments passed to the script, after the script path. */
  scriptArguments: string[];
  /** Absolute path of the script to run, or of the reference file to read. */
  scriptPath: string;
  timeoutMs: number;
  outputExtension: string;
  /** The positional argument, used to name the output file. */
  subject: string;
}

/**
 * Validates one `factcheck_run` argv. The model chooses a command, a subject
 * and flags from a per-command allowlist; it never supplies a script path, an
 * interpreter, or a path outside the conversation's own workspace.
 */
export function validateFactcheckArguments(input: {
  arguments: unknown;
  workspaceDirectory: string;
  cloneRoot: string;
}): ValidatedFactcheckCommand {
  const raw = input.arguments;
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_ARGUMENTS) {
    throw new FactcheckServiceError(
      "factcheck_invalid_arguments",
      `The fact-check tool requires between 2 and ${MAX_ARGUMENTS} arguments: a command and its subject.`,
    );
  }
  const args = raw.map((value) => {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > MAX_ARGUMENT_LENGTH ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ||
      /[\r\n]/.test(value)
    ) {
      throw new FactcheckServiceError(
        "factcheck_invalid_arguments",
        "Fact-check arguments must be non-empty, bounded, single-line strings.",
      );
    }
    return value;
  });
  if (Buffer.byteLength(args.join("\u0000"), "utf8") > MAX_ARGUMENT_BYTES) {
    throw new FactcheckServiceError(
      "factcheck_invalid_arguments",
      "Fact-check arguments exceed the size limit.",
    );
  }
  const [name, subject, ...flags] = args;
  if (name === "reference") {
    const relative = REFERENCES[subject];
    if (!relative || flags.length > 0) {
      throw new FactcheckServiceError(
        "factcheck_command_denied",
        `Unknown fact-check reference "${subject}". Available: ${FACTCHECK_REFERENCES.join(", ")}.`,
      );
    }
    return {
      command: name,
      kind: "reference",
      scriptArguments: [subject],
      scriptPath: path.join(input.cloneRoot, relative),
      timeoutMs: 0,
      outputExtension: "md",
      subject,
    };
  }
  const command = COMMANDS[name];
  if (!command) {
    throw new FactcheckServiceError(
      "factcheck_command_denied",
      `Unknown fact-check command "${name}". Available: ${FACTCHECK_COMMANDS.join(", ")}.`,
    );
  }
  if (subject.startsWith("-")) {
    throw new FactcheckServiceError(
      "factcheck_invalid_arguments",
      `${name} needs its subject as the second argument, before any flags.`,
    );
  }
  for (const flag of flags) {
    const bare = flag.startsWith("--") ? flag.split("=", 1)[0] : flag;
    // A flag's value arrives as its own argv item (`--lang`, `en`), so a
    // non-flag item here is that value rather than a smuggled positional.
    if (!bare.startsWith("-")) continue;
    if (!command.flags.has(bare)) {
      throw new FactcheckServiceError(
        "factcheck_flag_denied",
        `${bare} is not available for the ${name} command.`,
      );
    }
  }
  const workspaceDirectory = path.resolve(input.workspaceDirectory);
  const scriptArguments = [
    resolveSubject({ command, subject, workspaceDirectory }),
    ...flags,
  ];
  return {
    command: name,
    kind: "script",
    scriptArguments,
    scriptPath: path.join(input.cloneRoot, command.script),
    timeoutMs: command.timeoutMs,
    outputExtension: command.outputExtension,
    subject,
  };
}

function resolveSubject(input: {
  command: FactcheckCommand;
  subject: string;
  workspaceDirectory: string;
}): string {
  const { command, subject, workspaceDirectory } = input;
  if (command.positional === "query") return subject;
  if (command.positional === "source" && /^[a-z][a-z0-9+.-]*:/i.test(subject)) {
    let url: URL;
    try {
      url = new URL(subject);
    } catch {
      throw new FactcheckServiceError(
        "factcheck_source_denied",
        "That source is not a valid URL.",
      );
    }
    if (!ALLOWED_URL_PROTOCOLS.has(url.protocol)) {
      throw new FactcheckServiceError(
        "factcheck_source_denied",
        "Only http and https sources can be fetched.",
      );
    }
    return url.toString();
  }
  return containedWorkspacePath(subject, workspaceDirectory);
}

/**
 * Resolves a model-supplied path inside this conversation's workspace. The
 * report gates read a file, and `tally --fix` writes one, so the containment
 * has to hold for both.
 *
 * The script is spawned with the workspace as its working directory and gets
 * the *relative* path back, because these scripts echo their input into the
 * output they produce — an absolute path would print the host's directory
 * layout into a report the user is about to publish.
 */
function containedWorkspacePath(candidate: string, workspaceDirectory: string): string {
  const resolved = path.resolve(workspaceDirectory, candidate);
  const relative = path.relative(workspaceDirectory, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new FactcheckServiceError(
      "factcheck_path_denied",
      "Fact-check files must live inside this conversation's workspace.",
    );
  }
  return relative.split(path.sep).join("/");
}

function outputFileName(input: {
  command: string;
  subject: string;
  extension: string;
}): string {
  const slug = input.subject
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "input";
  // The subject is attacker-influenced (it is often the URL under audit), so
  // the readable slug is only ever a label: a digest keeps the name unique and
  // stable without letting the subject decide where the file lands.
  const digest = crypto.createHash("sha256").update(input.subject).digest("hex").slice(0, 8);
  return `${input.command}-${slug}-${digest}.${input.extension}`;
}

function childEnvironment(runtime: FactcheckRuntime): NodeJS.ProcessEnv {
  // Fetching is a network job and uv resolves dependencies over the network,
  // so unlike the offline Premortem callback this environment keeps PATH and
  // the proxy/TLS variables a corporate network needs.
  const keys = process.platform === "win32"
    ? [
        "SystemRoot",
        "SystemDrive",
        "windir",
        "ComSpec",
        "PATH",
        "PATHEXT",
        "TEMP",
        "TMP",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "PROGRAMDATA",
      ]
    : ["HOME", "USER", "PATH", "TMPDIR", "LANG"];
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV ?? "production",
  };
  for (const key of [...keys, "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "SSL_CERT_FILE", "UV_CACHE_DIR"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.PYTHONIOENCODING = "utf-8";
  env.PYTHONUTF8 = "1";
  env.PYTHONDONTWRITEBYTECODE = "1";
  if (runtime.usesUv) env.UV_NO_PROGRESS = "1";
  return env;
}

async function terminate(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn(
        "taskkill.exe",
        ["/PID", String(child.pid), "/T", "/F"],
        { windowsHide: true, stdio: "ignore" },
      );
      killer.once("error", () => resolve());
      killer.once("close", () => resolve());
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

export async function runFactcheck(input: {
  arguments: unknown;
  workspaceDirectory: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  runtime?: FactcheckRuntime;
}): Promise<FactcheckRunResult> {
  const startedAt = Date.now();
  const runtime = input.runtime ?? resolveFactcheckRuntime();
  if (!runtime) {
    throw new FactcheckServiceError(
      "factcheck_runtime_unavailable",
      "The fact-check runtime is not prepared. Clone bullshit-detector/ and install uv (https://docs.astral.sh/uv/).",
    );
  }
  const workspaceDirectory = path.resolve(input.workspaceDirectory);
  const validated = validateFactcheckArguments({
    arguments: input.arguments,
    workspaceDirectory,
    cloneRoot: runtime.cloneRoot,
  });
  const outputDirectory = path.join(workspaceDirectory, OUTPUT_SUBDIRECTORY);
  try {
    fs.mkdirSync(outputDirectory, { recursive: true });
  } catch {
    throw new FactcheckServiceError(
      "factcheck_workspace_unavailable",
      "The fact-check tool could not prepare this conversation's workspace.",
    );
  }
  if (validated.kind === "reference") {
    let contents: Buffer;
    try {
      contents = fs.readFileSync(validated.scriptPath);
    } catch {
      throw new FactcheckServiceError(
        "factcheck_runtime_unavailable",
        `${validated.subject} is missing from the vendored bullshit-detector clone.`,
      );
    }
    if (contents.byteLength > MAX_REFERENCE_BYTES) {
      throw new FactcheckServiceError(
        "factcheck_output_too_large",
        `${validated.subject} exceeds the reference size limit.`,
      );
    }
    const referenceName = `reference-${validated.subject}`;
    fs.writeFileSync(path.join(outputDirectory, referenceName), contents);
    return {
      command: validated.command,
      arguments: validated.scriptArguments,
      exitCode: 0,
      durationMs: Date.now() - startedAt,
      outputPath: `${OUTPUT_SUBDIRECTORY}/${referenceName}`,
      outputBytes: contents.byteLength,
      preview: contents.toString("utf8"),
      truncated: false,
      stderr: "",
    };
  }
  const outputName = outputFileName({
    command: validated.command,
    subject: validated.subject,
    extension: validated.outputExtension,
  });
  const outputAbsolute = path.join(outputDirectory, outputName);
  const outputRelative = `${OUTPUT_SUBDIRECTORY}/${outputName}`;
  const argv = runtime.usesUv
    ? ["run", "--no-project", "--script", validated.scriptPath, ...validated.scriptArguments]
    : [validated.scriptPath, ...validated.scriptArguments];

  return await new Promise<FactcheckRunResult>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(runtime.executable, argv, {
        cwd: workspaceDirectory,
        env: childEnvironment(runtime),
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      reject(
        new FactcheckServiceError(
          "factcheck_launch_failed",
          "The fact-check script could not start.",
        ),
      );
      return;
    }
    const stdoutChunks: Buffer[] = [];
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;

    const finish = (error: Error | null, exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      if (error) {
        reject(error);
        return;
      }
      const stdout = Buffer.concat(stdoutChunks);
      try {
        fs.writeFileSync(outputAbsolute, stdout);
      } catch {
        reject(
          new FactcheckServiceError(
            "factcheck_workspace_unavailable",
            "The fact-check tool could not write its output into this conversation's workspace.",
          ),
        );
        return;
      }
      const preview = stdout.subarray(0, PREVIEW_BYTES).toString("utf8");
      resolve({
        command: validated.command,
        arguments: validated.scriptArguments,
        exitCode,
        durationMs: Date.now() - startedAt,
        outputPath: outputRelative,
        outputBytes: stdout.byteLength,
        preview,
        truncated: stdout.byteLength > PREVIEW_BYTES,
        stderr: stderr.trim().slice(0, 4_000),
      });
    };
    const append = (target: "stdout" | "stderr", chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        void terminate(child).finally(() =>
          finish(
            new FactcheckServiceError(
              "factcheck_output_too_large",
              "The fact-check script exceeded the response size limit.",
            ),
            child.exitCode,
          )
        );
        return;
      }
      if (target === "stdout") stdoutChunks.push(chunk);
      else stderr += chunk.toString("utf8");
    };
    child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));
    const onAbort = () => {
      void terminate(child).finally(() =>
        finish(
          new FactcheckServiceError(
            "factcheck_cancelled",
            "The fact-check script was cancelled with the current chat turn.",
          ),
          child.exitCode,
        )
      );
    };
    input.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      void terminate(child).finally(() =>
        finish(
          new FactcheckServiceError(
            "factcheck_timeout",
            "The fact-check script did not finish within the time limit.",
          ),
          child.exitCode,
        )
      );
    }, input.timeoutMs ?? validated.timeoutMs);
    child.once("error", () =>
      finish(
        new FactcheckServiceError(
          "factcheck_launch_failed",
          "The fact-check script could not start.",
        ),
        null,
      )
    );
    child.once("close", (code) => {
      if (timedOut || input.signal?.aborted) return;
      finish(null, code);
    });
    if (input.signal?.aborted) onAbort();
  });
}
