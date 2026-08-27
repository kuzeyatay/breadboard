// The command policy for Career Ops runs.
//
// career-ops does its real work through its own Node scripts, and its mode files
// document them literally: `node set-status.mjs 42 Applied`, `node tracker.mjs`,
// `node generate-pdf.mjs cv.html output/cv.pdf`. So a run's only power is "run
// one of this clone's scripts", and this module is what keeps that bounded.
//
// Four rules hold everywhere:
//
//   1. No shell, ever. A command is parsed into an argv array and spawned
//      directly, so nothing a model writes can become shell syntax.
//   2. The only executable is Node, and the only entry point is a script that
//      already exists at the root of the clone. Nothing installs, nothing is
//      fetched, nothing outside the repository is executed.
//   3. Scripts that would take the run outside its job — self-updating the
//      clone, installing plugins, calling a different LLM provider, running the
//      upstream test suite — are refused by name, with the reason handed back to
//      the model so it can pick the right script instead.
//   4. Every path argument must resolve inside the clone. The clone is the
//      workspace, so this is a containment boundary, not a redirection: a path
//      that escapes is refused rather than rewritten, because a rewritten path
//      would silently change which tracker or report a script edits.

import path from "node:path";
import {
  externalRuntimeLstat,
  externalRuntimeReadDirectory,
  externalRuntimeRealpath,
} from "../external-runtime-filesystem.ts";

export interface ParsedCommand {
  /** The clone-root script to run, e.g. "tracker.mjs". */
  script: string;
  /** argv passed to Node, script first. */
  args: string[];
  /** Single-line rendering used for events and the transcript. */
  display: string;
}

export type CommandDecision =
  | { ok: true; command: ParsedCommand }
  | { ok: false; reason: string };

const MAX_ARGS = 60;
const MAX_ARG_LENGTH = 8_000;
const MAX_COMMAND_LENGTH = 16_000;

const CHAINING_TOKENS = new Set(["&&", "||", ";", "|", "&", ">", ">>", "<", "2>", "2>&1"]);

interface Token {
  value: string;
  quoted: boolean;
}

/**
 * Minimal shell-free tokenizer. Quoting is recorded so an operator character
 * inside a quoted job title or URL is not mistaken for shell syntax.
 */
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    if (match[1] !== undefined) tokens.push({ value: match[1], quoted: true });
    else if (match[2] !== undefined) tokens.push({ value: match[2], quoted: true });
    else tokens.push({ value: match[3] ?? "", quoted: false });
  }
  return tokens;
}

/** Scripts refused by name, and what to say instead. */
const REFUSED_SCRIPTS: Record<string, string> = {
  "update-system.mjs":
    "Updating or rolling back the career-ops clone is the user's decision, not a run's. Tell them what an update would change and let them run it themselves.",
  "plugin-install.mjs":
    "Installing plugins is a user action. Report which plugin would help and let them install it from the Agents tab.",
  "plugins.mjs":
    "Managing the plugin layer is a user action. `node plugin-audit.mjs` reports the current state read-only.",
  "openrouter-runner.mjs":
    "Breadboard is already the model layer for this run — ChatMock serves the model you are running on. Do the reasoning yourself and use the deterministic scripts for everything else.",
  "openai-eval.mjs":
    "Breadboard is already the model layer for this run. Evaluate the offer yourself following the mode instructions.",
  "openai-tailor.mjs":
    "Breadboard is already the model layer for this run. Tailor the CV yourself, then render it with `node generate-pdf.mjs`.",
  "gemini-eval.mjs": "Breadboard is already the model layer for this run.",
  "ollama-eval.mjs": "Breadboard is already the model layer for this run.",
  "eval-golden.mjs":
    "The golden-set harness benchmarks other model providers; it is not part of a job-search task.",
  "seed-fixture.mjs":
    "Seeding fixtures would write test data into the user's real tracker.",
  "build-dashboard.mjs":
    "Building the Go TUI is a developer action and needs a Go toolchain; the tracker is readable with `node tracker.mjs`.",
};

/** Test harnesses: never part of a job-search task, and one of them is 700 kB. */
function isTestHarness(script: string): boolean {
  return /^test[-.]/.test(script) || /-tests?\.mjs$/.test(script) || /\.test\.mjs$/.test(script);
}

/**
 * Subtrees a run may write into. Everything here is user data that career-ops
 * itself treats as generated or user-owned, and that its .gitignore already
 * covers. The scripts themselves are deliberately not writable: a run that could
 * rewrite `set-status.mjs` would be able to rewrite its own execution policy.
 */
const WRITABLE_DIRECTORIES = [
  "data",
  "reports",
  "output",
  "jds",
  "interview-prep",
  "writing-samples",
  "config",
  "modes",
  "seeds",
];

/** Individual files a run may write outside a writable directory. */
const WRITABLE_FILES = ["cv.md", "article-digest.md", "resume.md", "resume.tex", "voice-dna.md"];

/**
 * Under `modes/` only the user's own three files are writable — the mode
 * instructions are what the run is being steered by, so a run that could edit
 * them could edit its own brief.
 */
const WRITABLE_MODE_FILES = new Set(["_profile.md", "_custom.md", "_brief.md"]);

export interface ResolvedPath {
  absolute: string;
  /** Path relative to the clone root, in posix form. */
  relative: string;
}

type ExistingPathKind = "any" | "file" | "directory";

interface RootAuthority {
  /** The spelling supplied by the runtime, before following a root alias. */
  lexical: string;
  /** The actual directory that defines this run's filesystem authority. */
  canonical: string;
}

function comparablePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function samePath(left: string, right: string): boolean {
  return comparablePath(left) === comparablePath(right);
}

function isInside(candidate: string, root: string): boolean {
  const comparableCandidate = comparablePath(candidate);
  const comparableRoot = comparablePath(root);
  return (
    comparableCandidate === comparableRoot ||
    comparableCandidate.startsWith(
      comparableRoot.endsWith(path.sep) ? comparableRoot : `${comparableRoot}${path.sep}`,
    )
  );
}

function isMissingPathError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * The configured clone root is the authority granted to Career Ops. It may
 * itself be a deliberate alias (for example a managed-runtime junction), so we
 * canonicalize that one boundary. Links below it are data controlled by the
 * workspace and are never allowed to enlarge the authority.
 */
function rootAuthority(root: string): RootAuthority | null {
  try {
    const lexical = path.resolve(root);
    const canonical = path.resolve(externalRuntimeRealpath(lexical));
    if (!externalRuntimeLstat(canonical).isDirectory()) return null;
    return { lexical, canonical };
  } catch {
    return null;
  }
}

function resolveWithAuthority(
  value: string,
  root: string,
  options: { allowMissing: boolean; kind: ExistingPathKind },
): ResolvedPath | null {
  if (value.includes("\0")) return null;
  const authority = rootAuthority(root);
  if (!authority) return null;

  const lexicalCandidate = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(authority.lexical, value);
  if (!isInside(lexicalCandidate, authority.lexical)) return null;

  const relative = path.relative(authority.lexical, lexicalCandidate);
  const canonicalCandidate = path.resolve(authority.canonical, relative);
  if (!isInside(canonicalCandidate, authority.canonical)) return null;

  const segments = relative ? relative.split(path.sep).filter(Boolean) : [];
  let current = authority.canonical;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let info;
    try {
      // lstat is intentional: stat would follow the very link this boundary is
      // meant to reject. On Windows, directory junctions report as links too.
      info = externalRuntimeLstat(current);
    } catch (error) {
      if (options.allowMissing && isMissingPathError(error)) {
        return {
          absolute: canonicalCandidate,
          relative: relative.split(path.sep).join("/"),
        };
      }
      return null;
    }

    if (info.isSymbolicLink()) return null;
    const final = index === segments.length - 1;
    if (!final && !info.isDirectory()) return null;
    // A hard-linked file can alias a secret or executable named outside the
    // workspace even though realpath has no alternate pathname to reveal.
    if (final && info.isFile() && info.nlink > 1) return null;

    try {
      const actual = path.resolve(externalRuntimeRealpath(current));
      // The realpath equality check also catches reparse-point behavior that a
      // platform-specific lstat implementation might not label as a symlink.
      if (!isInside(actual, authority.canonical) || !samePath(actual, current)) return null;
    } catch {
      return null;
    }

    if (final) {
      if (options.kind === "file" && !info.isFile()) return null;
      if (options.kind === "directory" && !info.isDirectory()) return null;
    }
  }

  if (!segments.length && options.kind === "file") return null;
  return {
    absolute: canonicalCandidate,
    relative: relative.split(path.sep).join("/"),
  };
}

/**
 * Resolve a path argument against the clone root and refuse anything that
 * escapes it. Absolute paths are accepted only when they are already inside.
 */
export function resolveInsideRoot(value: string, root: string): ResolvedPath | null {
  return resolveWithAuthority(value, root, { allowMissing: true, kind: "any" });
}

/** Resolve an existing direct child path without following links or junctions. */
export function resolveExistingInsideRoot(
  value: string,
  root: string,
  kind: ExistingPathKind = "any",
): ResolvedPath | null {
  return resolveWithAuthority(value, root, { allowMissing: false, kind });
}

/** A process entry point must be a direct, regular root-level clone script. */
export function resolveExecutableScript(script: string, root: string): ResolvedPath | null {
  const normalized = script.replace(/^\.[\\/]/, "").replace(/\\/g, "/");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.mjs$/.test(normalized)) return null;
  const resolved = resolveExistingInsideRoot(normalized, root, "file");
  return resolved?.relative === normalized ? resolved : null;
}

export type WriteDecision = { ok: true; path: ResolvedPath } | { ok: false; reason: string };

/** Whether a run may write to a path, and why not when it may not. */
export function resolveWritablePath(value: string, root: string): WriteDecision {
  const resolved = resolveInsideRoot(value, root);
  if (!resolved) {
    return {
      ok: false,
      reason: "That path is outside the career-ops workspace. Write inside the clone.",
    };
  }
  if (!resolved.relative) {
    return { ok: false, reason: "That is the workspace directory itself, not a file." };
  }
  const segments = resolved.relative.split("/");
  if (segments[0] === "modes") {
    return segments.length === 2 && WRITABLE_MODE_FILES.has(segments[1])
      ? { ok: true, path: resolved }
      : {
          ok: false,
          reason: `Only ${[...WRITABLE_MODE_FILES].join(", ")} may be written under modes/. The mode instructions themselves are read-only.`,
        };
  }
  if (WRITABLE_DIRECTORIES.includes(segments[0]) && segments.length > 1) {
    return { ok: true, path: resolved };
  }
  if (segments.length === 1 && WRITABLE_FILES.includes(segments[0])) {
    return { ok: true, path: resolved };
  }
  return {
    ok: false,
    reason: `Writes are limited to ${WRITABLE_DIRECTORIES.join("/, ")}/ and ${WRITABLE_FILES.join(", ")}. career-ops's own scripts and templates are read-only.`,
  };
}

/** Whether a run may read a path. Anything inside the clone except secrets. */
export function resolveReadablePath(value: string, root: string): WriteDecision {
  const resolved = resolveInsideRoot(value, root);
  if (!resolved) {
    return {
      ok: false,
      reason: "That path is outside the career-ops workspace.",
    };
  }
  const segments = resolved.relative.split("/");
  if (segments[0] === ".git" || segments[0] === "node_modules") {
    return { ok: false, reason: "That directory is not part of the job-search workspace." };
  }
  // `.env` holds the user's plugin API keys. Nothing a run does needs them, and
  // their contents would end up in the transcript.
  if (/^\.env/.test(segments.at(-1) ?? "")) {
    return { ok: false, reason: "Secrets files are not readable from a run." };
  }
  return { ok: true, path: resolved };
}

/** Every root-level script a run may execute, for the prompt and for tests. */
export function availableScripts(root: string): string[] {
  let entries: string[];
  try {
    entries = externalRuntimeReadDirectory(root);
  } catch {
    return [];
  }
  return entries
    .filter(
      (entry) =>
        entry.endsWith(".mjs") &&
        !isTestHarness(entry) &&
        !(entry in REFUSED_SCRIPTS) &&
        Boolean(resolveExecutableScript(entry, root)),
    )
    .sort();
}

/**
 * Turn one model-proposed command line into a bounded argv, or explain why it
 * was refused. The explanation is fed back as the tool result so the model can
 * correct itself instead of silently retrying.
 */
export function parseCommand(raw: string, root: string): CommandDecision {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "No command was provided." };
  if (trimmed.length > MAX_COMMAND_LENGTH) return { ok: false, reason: "That command is too long." };
  if (/[\r\n]/.test(trimmed)) {
    return { ok: false, reason: "Run one single-line command per tool call." };
  }

  const tokens = tokenize(trimmed);
  if (!tokens.length) return { ok: false, reason: "No command was provided." };
  for (const token of tokens) {
    if (token.quoted) continue;
    if (CHAINING_TOKENS.has(token.value)) {
      return {
        ok: false,
        reason:
          "Chaining and redirection are not available. Run one command per tool call; a script that writes a file takes the path as an argument.",
      };
    }
    if (token.value.includes("$(") || token.value.includes("`")) {
      return { ok: false, reason: "Command substitution is not available." };
    }
  }

  // `node x.mjs …`, `npm run x`, and a bare `x.mjs …` all appear in the upstream
  // docs. Normalize the first two onto the third rather than refusing on syntax.
  let rest = tokens;
  const head = tokens[0].value
    .replace(/^\.[\\/]/, "")
    .replace(/\.(exe|cmd|bat)$/i, "")
    .toLowerCase();
  if (head === "node" || head === "nodejs") {
    rest = tokens.slice(1);
  } else if (head === "npm" || head === "npx" || head === "pnpm" || head === "yarn") {
    return {
      ok: false,
      reason:
        "Package managers are not available in a run. Call the script directly, e.g. `node tracker.mjs`.",
    };
  } else if (head === "career-ops" || head === "cops") {
    return {
      ok: false,
      reason:
        "The career-ops wrapper runs commands through Docker. Call the script directly instead, e.g. `node tracker.mjs`.",
    };
  }

  if (!rest.length) return { ok: false, reason: "Name the script to run, e.g. `node tracker.mjs`." };

  const script = rest[0].value.replace(/^\.[\\/]/, "").replace(/\\/g, "/");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.mjs$/.test(script)) {
    return {
      ok: false,
      reason: `Only career-ops's own scripts run here, named plainly (e.g. \`node tracker.mjs\`). "${rest[0].value}" is not one.`,
    };
  }
  const refusal = REFUSED_SCRIPTS[script];
  if (refusal) return { ok: false, reason: refusal };
  if (isTestHarness(script)) {
    return { ok: false, reason: "The upstream test harnesses are not part of a job-search task." };
  }
  if (!resolveExecutableScript(script, root)) {
    return {
      ok: false,
      reason: `There is no ${script} in this career-ops clone. Read docs/SCRIPTS.md for the scripts this version ships.`,
    };
  }

  const argumentTokens = rest.slice(1);
  if (argumentTokens.length > MAX_ARGS) {
    return { ok: false, reason: "That command has too many arguments." };
  }
  if (argumentTokens.some((token) => token.value.length > MAX_ARG_LENGTH)) {
    return {
      ok: false,
      reason:
        "One of those arguments is too long. Long text (a job description, a report body) belongs in a file the script reads, not on the command line.",
    };
  }

  // Only arguments that really look like paths are checked. A job title, a
  // company name or a URL must pass through untouched.
  for (const token of argumentTokens) {
    const value = token.value;
    if (!looksLikePath(value)) continue;
    if (!resolveInsideRoot(value, root)) {
      return {
        ok: false,
        reason: `${value} is outside the career-ops workspace. Every file a run reads or writes lives inside the clone.`,
      };
    }
  }

  const args = [script, ...argumentTokens.map((token) => token.value)];
  return {
    ok: true,
    command: {
      script,
      args,
      display: `node ${args.join(" ")}`.slice(0, 400),
    },
  };
}

/**
 * A conservative reading of "this argument names a file". Flags, URLs and plain
 * words are excluded; anything with a path separator or a known extension is
 * treated as a path so containment applies to it.
 */
export function looksLikePath(value: string): boolean {
  if (!value || value.startsWith("-")) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
  return (
    value.includes("/") ||
    value.includes("\\") ||
    /\.(md|html?|pdf|tex|json|ya?ml|tsv|csv|txt|png|jpe?g|docx?)$/i.test(value)
  );
}
