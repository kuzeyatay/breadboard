import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { repositoryRoot } from "../runtime-paths.ts";

// OfficeCLI (github.com/iOfficeAI/OfficeCLI) is a self-contained native binary
// that reads and writes .docx/.xlsx/.pptx through a document DOM. Breadboard
// pins release v1.0.143 — the same tag the vendored OfficeCLI/ clone is checked
// out at, so the skills the catalog serves describe exactly the binary that
// runs. The binary itself is machine-local (provisioned by
// `npm run setup:officecli` into .runtime/officecli), never committed.

const PINNED_VERSION = "1.0.143";

export class OfficeCliError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "OfficeCliError";
    this.status = status;
    this.code = code;
  }
}

function executableName(base: string): string {
  return process.platform === "win32" ? `${base}.exe` : base;
}

/**
 * Resolve the OfficeCLI binary. `OFFICECLI_BIN` wins, then the provisioned
 * `.runtime/officecli` copy, then the official installer's per-user location,
 * then PATH. Returns null when nothing is installed — the tool routes turn
 * that into an actionable "run npm run setup:officecli" error.
 */
export function resolveOfficeCli(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.OFFICECLI_BIN?.trim();
  if (explicit && fs.existsSync(explicit)) return explicit;
  const candidates = [
    path.join(repositoryRoot(), ".runtime", "officecli", executableName("officecli")),
    ...(process.platform === "win32" && env.LOCALAPPDATA
      ? [path.join(env.LOCALAPPDATA, "OfficeCLI", "officecli.exe")]
      : []),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Environment for every OfficeCLI spawn. The pinned binary must never
 * self-update out from under the vendored skills, and the resident document
 * cache must flush after every mutation so non-OfficeCLI readers — the
 * artifact importer, the garden — always see current bytes on disk.
 */
export function officeCliEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...env,
    OFFICECLI_SKIP_UPDATE: "1",
    OFFICECLI_RESIDENT_FLUSH: "each",
    NO_COLOR: "1",
  };
}

// Subcommands the agent may run. Everything else is refused by name so a typo
// never falls through to an unreviewed behavior of the binary.
const ALLOWED_COMMANDS = new Set([
  "create", "add", "set", "get", "query", "remove", "move", "swap",
  "view", "validate", "batch", "dump", "refresh",
  "raw", "raw-set", "add-part",
  "open", "save", "close",
  "help", "load_skill",
]);

// Refused with a reason instead of a generic "unknown command", because the
// vendored SKILL.md documents these and the model will try them.
const DENIED_COMMANDS = new Map<string, string>([
  ["mcp", "OfficeCLI's MCP server is not used here; call the office_run tool directly."],
  ["watch", "The live preview server cannot run inside a tool call; use `view <file> html` for a snapshot."],
  ["unwatch", "The live preview server cannot run inside a tool call."],
  ["goto", "Browser navigation needs the watch server, which is unavailable here."],
  ["mark", "Review marks need the watch server, which is unavailable here; use `add --type comment` for durable annotations."],
  ["unmark", "Review marks need the watch server, which is unavailable here."],
  ["get-marks", "Review marks need the watch server, which is unavailable here."],
  ["plugins", "Plugin management is operator-only; the pinned binary runs without extra plugins."],
]);

// Commands whose first positional argument is not a file in the workspace.
const NO_FILE_COMMANDS = new Set(["help", "load_skill"]);

// Flags whose value names a file OfficeCLI will read or write.
const PATH_VALUE_FLAGS = new Set(["--input", "-o", "--output"]);

// `--prop key=value` keys whose value names a file OfficeCLI will read
// (embedded pictures, media, OLE payloads). Contained so a document cannot be
// used to embed — and later exfiltrate — files from outside the workspace.
const PATH_VALUE_PROP_KEYS = new Set(["src", "file", "preview"]);

/**
 * Split a single command string into argv the way a POSIX shell would group
 * quoted spans, without invoking any shell. Quotes may open mid-token
 * (`text="hello world"`); backslashes are literal because Windows paths are
 * full of them.
 */
export function tokenizeOfficeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let started = false;
  let quote: '"' | "'" | null = null;
  for (const character of command) {
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (started) tokens.push(current);
      current = "";
      started = false;
      continue;
    }
    current += character;
    started = true;
  }
  if (quote) {
    throw new OfficeCliError(400, "office_command_unbalanced_quote", "The command has an unclosed quote.");
  }
  if (started) tokens.push(current);
  return tokens;
}

function looksLikeUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

/**
 * Resolve a path argument against the workspace and refuse anything that
 * escapes it. Returns the absolute path so the spawned process cannot be
 * confused by its working directory.
 */
export function containWorkspacePath(
  workspace: string,
  raw: string,
  label: string,
): string {
  if (!raw.trim()) {
    throw new OfficeCliError(400, "office_path_required", `${label} is required.`);
  }
  if (looksLikeUrl(raw)) {
    throw new OfficeCliError(
      400,
      "office_path_remote",
      `${label} must be a file inside the document workspace, not a URL.`,
    );
  }
  const resolved = path.resolve(workspace, raw);
  const relative = path.relative(workspace, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new OfficeCliError(
      403,
      "office_path_outside_workspace",
      `${label} must be a path relative to the document workspace (got ${JSON.stringify(raw)}).`,
    );
  }
  return resolved;
}

export interface ValidatedOfficeCommand {
  argv: string[];
  subcommand: string;
  /** Absolute path of the document the command touches, when it names one. */
  file: string | null;
}

/**
 * Validate one agent-supplied command string and rewrite every filesystem
 * reference to a contained absolute path. Element paths (`/body/p[3]`,
 * `/Sheet1/A1`) are OfficeCLI's own addressing syntax, never filesystem paths,
 * so only the documented positions are treated as files: the first positional
 * argument, `--input`/`-o`/`--output` values, and file-reading `--prop` keys.
 */
export function validateOfficeCommand(
  command: string,
  workspace: string,
): ValidatedOfficeCommand {
  const tokens = tokenizeOfficeCommand(command);
  if (tokens[0]?.toLowerCase() === "officecli") tokens.shift();
  if (tokens.length === 0) {
    throw new OfficeCliError(400, "office_command_required", "A command is required, e.g. `create report.docx`.");
  }
  const subcommand = tokens[0].toLowerCase();
  if (subcommand === "--version" || subcommand === "--help") {
    return { argv: [subcommand], subcommand, file: null };
  }
  const denied = DENIED_COMMANDS.get(subcommand);
  if (denied) {
    throw new OfficeCliError(400, "office_command_denied", denied);
  }
  if (!ALLOWED_COMMANDS.has(subcommand)) {
    throw new OfficeCliError(
      400,
      "office_command_unknown",
      `Unknown OfficeCLI command ${JSON.stringify(subcommand)}. Run \`help\` for the command list.`,
    );
  }

  const argv = [...tokens];
  let file: string | null = null;
  if (!NO_FILE_COMMANDS.has(subcommand)) {
    if (!argv[1] || argv[1].startsWith("-")) {
      throw new OfficeCliError(
        400,
        "office_file_required",
        `\`${subcommand}\` needs a document path as its first argument, relative to the workspace.`,
      );
    }
    file = containWorkspacePath(workspace, argv[1], "The document path");
    argv[1] = file;
  }

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (PATH_VALUE_FLAGS.has(token)) {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new OfficeCliError(400, "office_path_required", `${token} needs a value.`);
      }
      argv[index + 1] = containWorkspacePath(workspace, value, `The ${token} path`);
      index += 1;
      continue;
    }
    if (token === "--prop") {
      const value = argv[index + 1];
      const separator = value?.indexOf("=") ?? -1;
      if (value !== undefined && separator > 0) {
        const key = value.slice(0, separator).toLowerCase();
        if (PATH_VALUE_PROP_KEYS.has(key)) {
          argv[index + 1] = `${value.slice(0, separator)}=${containWorkspacePath(
            workspace,
            value.slice(separator + 1),
            `The ${key} file`,
          )}`;
        }
      }
      index += 1;
    }
  }

  if (file) {
    // `create nested/dir/report.docx` should work: the containment check has
    // already bounded the directory to the workspace.
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  return { argv, subcommand, file };
}

export const OFFICE_RUN_TIMEOUT_MS = 90_000;
export const OFFICE_OUTPUT_LIMIT_BYTES = 400_000;

export interface OfficeCliResult {
  code: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
}

/** Run the pinned binary with an argv that has already been validated. */
export function runOfficeCli(
  argv: string[],
  options: { cwd: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } ,
): Promise<OfficeCliResult> {
  const binary = resolveOfficeCli(options.env ?? process.env);
  if (!binary) {
    throw new OfficeCliError(
      503,
      "officecli_unavailable",
      `OfficeCLI ${PINNED_VERSION} is not installed. Run \`npm run setup:officecli\` from the repository root.`,
    );
  }
  const timeoutMs = options.timeoutMs ?? OFFICE_RUN_TIMEOUT_MS;
  return new Promise<OfficeCliResult>((resolvePromise, rejectPromise) => {
    const child = spawn(binary, argv, {
      cwd: options.cwd,
      env: officeCliEnv(options.env ?? process.env),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    const collect = (target: "stdout" | "stderr") => (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (target === "stdout") {
        if (stdout.length < OFFICE_OUTPUT_LIMIT_BYTES) stdout += text;
        else truncated = true;
      } else if (stderr.length < 64_000) {
        stderr += text;
      }
    };
    child.stdout.on("data", collect("stdout"));
    child.stderr.on("data", collect("stderr"));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      rejectPromise(
        new OfficeCliError(500, "officecli_spawn_failed", `OfficeCLI could not start: ${error.message}`),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        code: code ?? -1,
        stdout: stdout.slice(0, OFFICE_OUTPUT_LIMIT_BYTES),
        stderr,
        truncated,
        timedOut,
      });
    });
  });
}
