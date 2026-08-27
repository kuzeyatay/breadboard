// Process-free Office request validation shared by Next and the disposable
// Runtime V2 worker. Keep native-process discovery/launching in officecli.ts;
// importing this module must never create a path from Next to child_process.

import type { ArtifactKind } from "../hermes/artifact-types.ts";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";

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

/** Exact server-owned workspace for one authenticated Office conversation. */
export function officeWorkspaceFor(session: {
  active_directory: string | null;
  conversation_id: number | null;
}): string {
  const active = session.active_directory?.trim();
  if (active) return active;
  if (session.conversation_id === null) {
    throw new OfficeCliError(409, "office_workspace_required", "Office tools need a conversation workspace.");
  }
  const workspace = path.join(dashboardDataDir(), "office-workspaces", String(session.conversation_id));
  fs.mkdirSync(workspace, { recursive: true });
  return workspace;
}

function executableName(base: string): string {
  return process.platform === "win32" ? `${base}.exe` : base;
}

/** Resolve the installed binary without importing the process-launch module. */
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

const ALLOWED_COMMANDS = new Set([
  "create", "add", "set", "get", "query", "remove", "move", "swap",
  "view", "validate", "batch", "dump", "refresh",
  "raw", "raw-set", "add-part",
  "open", "save", "close",
  "help", "load_skill",
]);

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

const NO_FILE_COMMANDS = new Set(["help", "load_skill"]);
const PATH_VALUE_FLAGS = new Set(["--input", "-o", "--output"]);
const PATH_VALUE_PROP_KEYS = new Set(["src", "file", "preview"]);

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
    if (/\s/u.test(character)) {
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
  return /^[a-z][a-z0-9+.-]*:\/\//iu.test(value);
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function containWorkspacePath(workspace: string, raw: string, label: string): string {
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
  file: string | null;
}

export function validateOfficeCommand(command: string, workspace: string): ValidatedOfficeCommand {
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
  if (denied) throw new OfficeCliError(400, "office_command_denied", denied);
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

  if (file) fs.mkdirSync(path.dirname(file), { recursive: true });
  return { argv, subcommand, file };
}

export const OFFICE_RUN_TIMEOUT_MS = 90_000;
export const OFFICE_OUTPUT_LIMIT_BYTES = 400_000;

export interface OfficeRunResult {
  command: string;
  exitCode: number;
  output: string;
  truncated: boolean;
  timedOut: boolean;
  file: string | null;
}

const EXPORT_KINDS = new Map<string, ArtifactKind>([
  [".docx", "document"],
  [".pptx", "presentation"],
  [".xlsx", "spreadsheet"],
  [".csv", "spreadsheet"],
  [".tsv", "spreadsheet"],
  [".pdf", "pdf"],
]);

export interface OfficeExportStaging {
  filePath: string;
  relativeFile: string;
  kind: ArtifactKind;
  title: string;
  filename: string;
  previewFilePath: string | null;
  cleanup: () => void;
}

export type OfficeExportDescription = Omit<OfficeExportStaging, "previewFilePath" | "cleanup">;

export function describeOfficeExport(
  workspace: string,
  args: Record<string, unknown>,
): OfficeExportDescription {
  const file = typeof args.file === "string" ? args.file.trim() : "";
  if (!file) {
    throw new OfficeCliError(400, "office_file_required", "Pass the workspace-relative path of the document to export.");
  }
  const filePath = containWorkspacePath(workspace, file, "The document path");
  const extension = path.extname(filePath).toLowerCase();
  const kind = EXPORT_KINDS.get(extension);
  if (!kind) {
    throw new OfficeCliError(
      400,
      "office_export_unsupported",
      `Only ${[...EXPORT_KINDS.keys()].join(", ")} files can be exported as artifacts.`,
    );
  }
  const metadata = fs.lstatSync(filePath, { throwIfNoEntry: false });
  if (!metadata?.isFile() || metadata.isSymbolicLink()) {
    throw new OfficeCliError(404, "office_file_not_found", `${file} does not exist in the workspace.`);
  }
  const canonical = fs.realpathSync.native(filePath);
  if (!samePath(canonical, filePath)) {
    throw new OfficeCliError(403, "office_input_indirect", "The Office input must be a direct file.");
  }

  const filename = path.basename(filePath);
  const fallbackTitle = filename.replace(/\.[a-z0-9]+$/iu, "");
  const title = typeof args.title === "string" && args.title.trim()
    ? args.title.trim().slice(0, 240)
    : fallbackTitle;
  return {
    filePath,
    relativeFile: path.relative(workspace, filePath).replace(/\\/gu, "/"),
    kind,
    title,
    filename,
  };
}
