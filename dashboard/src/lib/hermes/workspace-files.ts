// Structured file work inside the session's own workspace.
//
// Hermes already ships `read_file`/`write_file`/`patch`/`search_files` in its
// `file` toolset, and Breadboard deliberately does not enable them: those tools
// document their path argument as "absolute or relative to cwd" and enforce no
// root, so switching them on would hand the model the whole filesystem outside
// the capability decision, outside the audit trail, and outside the per-surface
// scope every other tool obeys. What the model actually needs is the iterate-on
// -a-file loop, not unbounded reach — so the loop is rebuilt here against the
// one directory the session already owns.
//
// That directory is the Hermes runtime workspace (`session.workspace_key`), the
// same root `agent_loop_run` works in and the same path the runtime uses as its
// cwd. Everything a turn writes therefore lands where the rest of the turn can
// find it, and nothing reaches past it.
//
// The containment rules are the ones agent-loop-service.ts already proved out —
// no absolute paths, no drive letters, no UNC prefixes, no `..`, no symlinked
// ancestor — plus one this location makes mandatory: `.breadboard/` holds the
// session's live capability token (session-service.ts writes it there), so a
// path naming that directory is refused outright rather than merely hidden.

import fs from "node:fs";
import path from "node:path";

export class WorkspaceFileError extends Error {
  // Declared and assigned rather than written as constructor parameter
  // properties: the repo's tests run TypeScript through Node's strip-only
  // mode, which refuses that syntax outright.
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "WorkspaceFileError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Two different ceilings, because they bound two different things.
 *
 * `MAX_WRITE_BYTES` bounds content the *model* supplies, and exists because the
 * Hermes plugin refuses a request body over 512 KiB. `MAX_FILE_BYTES` bounds
 * what may be loaded off disk and rewritten in place — a patch supplies only
 * the span it changes, so it is not held to the request-body limit and a large
 * file stays editable.
 */
export const MAX_WRITE_BYTES = 384 * 1024;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
/**
 * How much text one read may return. Line count alone is not enough: 2,000
 * lines of a minified bundle would blow past the plugin's 2 MiB response cap,
 * so the character budget is what actually ends the slice.
 */
const MAX_READ_RESPONSE_CHARS = 192 * 1024;
const DEFAULT_READ_LINES = 400;
const MAX_READ_LINES = 2_000;
const MAX_LINE_CHARS = 2_000;
const MAX_LIST_ENTRIES = 500;
const MAX_SEARCH_MATCHES = 100;
/** A file bigger than this is not searched: it is data, not source. */
const MAX_SEARCH_FILE_BYTES = 2 * 1024 * 1024;
const MAX_WALK_ENTRIES = 20_000;

/**
 * Directories never walked and never reachable. `.breadboard` is the security
 * one — it holds this session's capability token. The rest are noise that would
 * bury a listing.
 */
const DENIED_DIRECTORIES = new Set([".breadboard", ".git", "node_modules"]);

function denied(value: string): WorkspaceFileError {
  return new WorkspaceFileError(
    "workspace_path_denied",
    `Workspace paths must stay inside this conversation's workspace and may not name a reserved directory: ${value}`,
    403,
  );
}

export interface ContainedPath {
  /** Absolute path on disk. */
  absolute: string;
  /** Workspace-relative, forward-slashed. `"."` is the workspace itself. */
  relative: string;
}

/**
 * Resolve a model-supplied path inside the workspace.
 *
 * Rejects absolute paths, `~`, drive letters, UNC prefixes, traversal, reserved
 * directories, and symlinked escapes. `allowRoot` is for the tools that take a
 * directory (list, search); the file tools refuse the workspace itself because
 * "write the workspace" is never what was meant.
 */
export function containedWorkspaceFile(
  workspaceDirectory: string,
  value: string,
  options: { allowRoot?: boolean } = {},
): ContainedPath {
  const candidate = String(value ?? "").replace(/\\/g, "/").trim();
  const isRoot = candidate === "" || candidate === "." || candidate === "./";
  if (isRoot) {
    if (!options.allowRoot) {
      throw new WorkspaceFileError(
        "workspace_path_required",
        "A file path inside the workspace is required.",
      );
    }
  } else if (
    candidate.startsWith("/") ||
    candidate.startsWith("~") ||
    /^[A-Za-z]:/.test(candidate) ||
    candidate.split("/").some((segment) => segment === ".." || DENIED_DIRECTORIES.has(segment))
  ) {
    throw denied(value);
  }

  const root = path.resolve(workspaceDirectory);
  const resolved = isRoot ? root : path.resolve(root, candidate);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw denied(value);

  // A symlink planted at any existing ancestor would otherwise let a contained
  // relative path resolve outside the workspace the moment it is opened.
  let existing = resolved;
  while (!fs.existsSync(existing) && path.dirname(existing) !== existing) {
    existing = path.dirname(existing);
  }
  try {
    const realRoot = fs.realpathSync(root);
    const realExisting = fs.realpathSync(existing);
    const realRelative = path.relative(realRoot, realExisting);
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) throw denied(value);
  } catch (error) {
    if (error instanceof WorkspaceFileError) throw error;
    throw new WorkspaceFileError(
      "workspace_unavailable",
      "The conversation workspace could not be resolved.",
      500,
    );
  }

  return {
    absolute: resolved,
    relative: relative ? relative.replace(/\\/g, "/") : ".",
  };
}

function stringArgument(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = stringArgument(args, key);
  if (!value.trim()) {
    throw new WorkspaceFileError("workspace_argument_missing", `\`${key}\` is required.`);
  }
  return value;
}

function boundedInteger(args: Record<string, unknown>, key: string, fallback: number, max: number): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}

/**
 * Text, or a refusal. Binary content is refused rather than mangled: a NUL byte
 * in the first slice means the file is not something a model can usefully read,
 * and returning replacement characters would let it "edit" the file into ruin.
 */
function readText(target: ContainedPath): string {
  let stats: fs.Stats;
  try {
    stats = fs.statSync(target.absolute);
  } catch {
    throw new WorkspaceFileError("workspace_file_not_found", `\`${target.relative}\` does not exist in the workspace.`, 404);
  }
  if (stats.isDirectory()) {
    throw new WorkspaceFileError("workspace_path_is_directory", `\`${target.relative}\` is a directory. Use workspace_list.`);
  }
  if (stats.size > MAX_FILE_BYTES) {
    throw new WorkspaceFileError(
      "workspace_file_too_large",
      `\`${target.relative}\` is ${stats.size} bytes; this tool handles at most ${MAX_FILE_BYTES}. Narrow it with workspace_search.`,
    );
  }
  const buffer = fs.readFileSync(target.absolute);
  if (buffer.includes(0)) {
    throw new WorkspaceFileError("workspace_file_binary", `\`${target.relative}\` is a binary file.`);
  }
  return buffer.toString("utf8");
}

export interface WorkspaceReadResult {
  path: string;
  lines: string[];
  firstLine: number;
  totalLines: number;
  truncated: boolean;
}

export function readWorkspaceFile(
  workspaceDirectory: string,
  args: Record<string, unknown>,
): WorkspaceReadResult {
  const target = containedWorkspaceFile(workspaceDirectory, requiredString(args, "path"));
  const all = readText(target).split(/\r?\n/);
  const offset = boundedInteger(args, "offset", 1, Math.max(all.length, 1));
  const limit = boundedInteger(args, "limit", DEFAULT_READ_LINES, MAX_READ_LINES);
  const requested = all.slice(offset - 1, offset - 1 + limit);
  // Two budgets, both enforced: each line is capped so one minified bundle line
  // cannot dominate, and the slice stops once the response budget is spent so a
  // file of such lines cannot either.
  const lines: string[] = [];
  let characters = 0;
  for (const line of requested) {
    const capped = line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line;
    if (lines.length && characters + capped.length > MAX_READ_RESPONSE_CHARS) break;
    lines.push(capped);
    characters += capped.length + 1;
  }
  return {
    path: target.relative,
    lines,
    firstLine: offset,
    totalLines: all.length,
    truncated: offset - 1 + lines.length < all.length,
  };
}

export interface WorkspaceWriteResult {
  path: string;
  bytes: number;
  created: boolean;
}

export function writeWorkspaceFile(
  workspaceDirectory: string,
  args: Record<string, unknown>,
): WorkspaceWriteResult {
  const target = containedWorkspaceFile(workspaceDirectory, requiredString(args, "path"));
  const content = stringArgument(args, "content");
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_WRITE_BYTES) {
    throw new WorkspaceFileError(
      "workspace_content_too_large",
      `Content is ${bytes} bytes; this tool writes at most ${MAX_WRITE_BYTES}. Write it in pieces and assemble them.`,
    );
  }
  if (fs.existsSync(target.absolute) && fs.statSync(target.absolute).isDirectory()) {
    throw new WorkspaceFileError("workspace_path_is_directory", `\`${target.relative}\` is a directory.`);
  }
  const created = !fs.existsSync(target.absolute);
  fs.mkdirSync(path.dirname(target.absolute), { recursive: true });
  fs.writeFileSync(target.absolute, content, "utf8");
  return { path: target.relative, bytes, created };
}

export interface WorkspacePatchResult {
  path: string;
  replacements: number;
  bytes: number;
}

/**
 * Exact-string replacement, unique by default.
 *
 * Deliberately not fuzzy, unlike Hermes's own `patch`. A fuzzy match that lands
 * on the wrong span is the failure mode nobody catches, because the tool
 * reports success; requiring an exact, unique `find` turns that into an error
 * the model can see and fix on the next call.
 */
export function patchWorkspaceFile(
  workspaceDirectory: string,
  args: Record<string, unknown>,
): WorkspacePatchResult {
  const target = containedWorkspaceFile(workspaceDirectory, requiredString(args, "path"));
  const find = requiredString(args, "find");
  const replace = stringArgument(args, "replace");
  const replaceAll = args.replaceAll === true;
  const original = readText(target);

  const occurrences = original.split(find).length - 1;
  if (occurrences === 0) {
    throw new WorkspaceFileError(
      "workspace_patch_no_match",
      `\`find\` does not appear in ${target.relative}. Read the file and copy the text exactly, including indentation.`,
    );
  }
  if (occurrences > 1 && !replaceAll) {
    throw new WorkspaceFileError(
      "workspace_patch_ambiguous",
      `\`find\` appears ${occurrences} times in ${target.relative}. Include enough surrounding text to make it unique, or pass replaceAll.`,
    );
  }
  const updated = replaceAll ? original.split(find).join(replace) : original.replace(find, replace);
  const bytes = Buffer.byteLength(updated, "utf8");
  // Held to the file ceiling, not the request ceiling: a patch sends only the
  // span it changes, so editing a large file is not a large request.
  if (bytes > MAX_FILE_BYTES) {
    throw new WorkspaceFileError(
      "workspace_content_too_large",
      `The patched file would be ${bytes} bytes; the ceiling is ${MAX_FILE_BYTES}.`,
    );
  }
  fs.writeFileSync(target.absolute, updated, "utf8");
  return { path: target.relative, replacements: replaceAll ? occurrences : 1, bytes };
}

/**
 * The directory argument of `workspace_list` / `workspace_search`. A missing
 * directory is an error rather than an empty result: "there is nothing in src/"
 * and "there is no src/" lead the model to different next moves.
 */
function requireDirectory(start: ContainedPath): void {
  if (!fs.existsSync(start.absolute)) {
    throw new WorkspaceFileError(
      "workspace_directory_not_found",
      `\`${start.relative}\` does not exist in the workspace.`,
      404,
    );
  }
  if (!fs.statSync(start.absolute).isDirectory()) {
    throw new WorkspaceFileError(
      "workspace_path_is_file",
      `\`${start.relative}\` is a file, not a directory.`,
    );
  }
}

interface WalkedFile {
  relative: string;
  absolute: string;
  size: number;
}

/**
 * Every file under a directory, minus the reserved ones. Bounded twice: by the
 * entry ceiling and by refusing to follow directory symlinks, so a link back
 * into the workspace cannot make the walk unbounded.
 */
function walk(root: string, start: ContainedPath): { files: WalkedFile[]; truncated: boolean } {
  const files: WalkedFile[] = [];
  const queue = [start.absolute];
  let seen = 0;
  while (queue.length) {
    const directory = queue.shift() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (++seen > MAX_WALK_ENTRIES) return { files, truncated: true };
      if (DENIED_DIRECTORIES.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        queue.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      let size = 0;
      try {
        size = fs.statSync(absolute).size;
      } catch {
        continue;
      }
      files.push({
        relative: path.relative(root, absolute).replace(/\\/g, "/"),
        absolute,
        size,
      });
    }
  }
  return { files, truncated: false };
}

/**
 * Translate a glob into a regular expression. `**` crosses directory
 * separators, `*` and `?` do not — the conventional reading, and the one that
 * makes `src/*.ts` mean what it looks like.
 */
function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*";
        index += 1;
        if (pattern[index + 1] === "/") index += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (character === "?") {
      source += "[^/]";
      continue;
    }
    source += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, "i");
}

export interface WorkspaceListResult {
  path: string;
  files: Array<{ path: string; size: number }>;
  total: number;
  truncated: boolean;
}

export function listWorkspaceFiles(
  workspaceDirectory: string,
  args: Record<string, unknown>,
): WorkspaceListResult {
  const root = path.resolve(workspaceDirectory);
  const start = containedWorkspaceFile(workspaceDirectory, stringArgument(args, "path"), {
    allowRoot: true,
  });
  requireDirectory(start);
  const glob = stringArgument(args, "glob").trim();
  const matcher = glob ? globToRegExp(glob) : null;
  const walked = walk(root, start);
  const matched = matcher
    ? walked.files.filter((file) => matcher.test(file.relative) || matcher.test(path.basename(file.relative)))
    : walked.files;
  matched.sort((left, right) => left.relative.localeCompare(right.relative));
  return {
    path: start.relative,
    files: matched.slice(0, MAX_LIST_ENTRIES).map((file) => ({ path: file.relative, size: file.size })),
    total: matched.length,
    truncated: walked.truncated || matched.length > MAX_LIST_ENTRIES,
  };
}

export interface WorkspaceSearchResult {
  query: string;
  matches: Array<{ path: string; line: number; text: string }>;
  filesSearched: number;
  truncated: boolean;
}

export function searchWorkspaceFiles(
  workspaceDirectory: string,
  args: Record<string, unknown>,
): WorkspaceSearchResult {
  const root = path.resolve(workspaceDirectory);
  const start = containedWorkspaceFile(workspaceDirectory, stringArgument(args, "path"), {
    allowRoot: true,
  });
  requireDirectory(start);
  const query = requiredString(args, "query");
  let pattern: RegExp;
  try {
    pattern = new RegExp(query, args.caseSensitive === true ? "" : "i");
  } catch {
    throw new WorkspaceFileError("workspace_search_invalid", `\`query\` is not a valid regular expression: ${query}`);
  }
  const glob = stringArgument(args, "glob").trim();
  const matcher = glob ? globToRegExp(glob) : null;

  const walked = walk(root, start);
  const matches: WorkspaceSearchResult["matches"] = [];
  let filesSearched = 0;
  let truncated = walked.truncated;

  for (const file of walked.files) {
    if (matches.length >= MAX_SEARCH_MATCHES) {
      truncated = true;
      break;
    }
    if (matcher && !matcher.test(file.relative) && !matcher.test(path.basename(file.relative))) continue;
    if (file.size > MAX_SEARCH_FILE_BYTES) continue;
    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(file.absolute);
    } catch {
      continue;
    }
    if (buffer.includes(0)) continue;
    filesSearched += 1;
    const lines = buffer.toString("utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (matches.length >= MAX_SEARCH_MATCHES) {
        truncated = true;
        break;
      }
      if (!pattern.test(lines[index])) continue;
      const text = lines[index];
      matches.push({
        path: file.relative,
        line: index + 1,
        text: text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS)}…` : text,
      });
    }
  }

  return { query, matches, filesSearched, truncated };
}
