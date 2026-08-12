import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";
import {
  canonicalizePath,
  isWithinRoot,
  realPathAllowingMissing,
} from "./filesystem-paths.ts";

const MAX_COMMAND_LENGTH = 2_000;
const MAX_OUTPUT_BYTES = 512 * 1024;

/**
 * A single HTTP slice never waits longer than this before handing back a
 * "still running" result. It stays below the Hermes plugin's socket deadline so
 * the caller always receives a real answer instead of a dead connection.
 */
const DEFAULT_SLICE_MS = 100_000;
/**
 * Total wall-clock one command may occupy across slices when nobody chooses.
 * Whole-disk inspection legitimately runs for many minutes — enumerating every
 * file on a loaded Windows drive measurably takes more than ten — and the old
 * fixed 120s deadline killed those scans before their first line of output
 * existed, so the model saw nothing but a timeout and had to hand the work back
 * to the user.
 */
const DEFAULT_MAX_RUNTIME_MS = 1_200_000;
/**
 * The hardest wall-clock ceiling any single command may reach, including one
 * whose timeout the model picked for itself. Setting
 * BREADBOARD_TERMINAL_MAX_COMMAND_MS replaces both this cap and the default
 * above: an operator who lowers it means it, so a model request is clamped into
 * it rather than allowed to argue past it.
 */
const MAX_ALLOWED_RUNTIME_MS = 3_600_000;
const MIN_RUNTIME_MS = 1_000;
/**
 * A backgrounded command whose caller stops collecting it is killed. Without
 * this a dropped turn would leave a full-drive scan running forever.
 */
const ABANDONED_AFTER_MS = 180_000;
/** How long a finished command's output stays collectable. */
const COLLECTABLE_AFTER_EXIT_MS = 300_000;

function boundedEnvMs(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function sliceMs(): number {
  return boundedEnvMs("BREADBOARD_TERMINAL_SLICE_MS", DEFAULT_SLICE_MS, 1_000, 240_000);
}

/** The operator's explicit ceiling, when one is configured. */
function configuredMaxRuntimeMs(): number | null {
  const parsed = Number.parseInt(
    process.env.BREADBOARD_TERMINAL_MAX_COMMAND_MS ?? "",
    10,
  );
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(Math.max(parsed, MIN_RUNTIME_MS), MAX_ALLOWED_RUNTIME_MS);
}

/**
 * How long this command may run. The model chooses it, because only the caller
 * that wrote the command knows whether it asked for a one-line status or a scan
 * of every file on the disk, and a single fixed number is wrong for one of them
 * either way. The choice is a request, not an instruction: it is clamped into
 * the operator's ceiling here, on the server, and an absent or nonsense value
 * falls back to the standing default rather than to no limit at all.
 */
export function resolveMaxRuntimeMs(requestedMs?: unknown): number {
  const ceiling = configuredMaxRuntimeMs() ?? MAX_ALLOWED_RUNTIME_MS;
  const fallback = Math.min(
    configuredMaxRuntimeMs() ?? DEFAULT_MAX_RUNTIME_MS,
    ceiling,
  );
  const requested = typeof requestedMs === "number" ? requestedMs : Number.NaN;
  if (!Number.isFinite(requested) || requested <= 0) return fallback;
  return Math.min(Math.max(Math.round(requested), MIN_RUNTIME_MS), ceiling);
}

interface RunningCommand {
  id: string;
  command: string;
  child: ChildProcess;
  runtimeSessionId: number | null;
  startedAt: number;
  /** Wall-clock this command is held to, kept for an honest timeout report. */
  maxRuntimeMs: number;
  stdout: Buffer<ArrayBufferLike>;
  stderr: Buffer<ArrayBufferLike>;
  truncated: boolean;
  timedOut: boolean;
  closed: boolean;
  exitCode: number | null;
  waiters: Set<() => void>;
  ceilingTimer: NodeJS.Timeout | null;
  abandonTimer: NodeJS.Timeout | null;
  collectTimer: NodeJS.Timeout | null;
}

/** Commands still collectable by id, whether running or recently finished. */
const commandsById = new Map<string, RunningCommand>();
/** The one command each runtime session currently owns. */
const activeCommands = new Map<number, RunningCommand>();

/**
 * Resolve PowerShell by absolute path instead of trusting PATH lookup.
 *
 * The installed desktop app has been observed failing an already-authorized
 * command with `spawn powershell.exe ENOENT`: the policy said yes and execution
 * died anyway. libuv resolves a bare executable name through PATH only (unlike
 * CreateProcess, it does not implicitly search System32), and this process runs
 * with a curated environment — the packaged supervisor's `baseEnv` plus the
 * filter below. Pinning the shell to %SystemRoot% removes PATH from the picture
 * for a fixed, security-sensitive executable.
 */
export function resolveCommandShell(): string {
  return process.platform === "win32" ? windowsShell() : "/bin/sh";
}

function windowsShell(): string {
  const systemRoot =
    process.env.SystemRoot ?? process.env.SYSTEMROOT ?? process.env.windir;
  if (systemRoot) {
    const absolute = path.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    if (existsSync(absolute)) return absolute;
  }
  return "powershell.exe";
}

function filteredEnvironment(): NodeJS.ProcessEnv {
  const allowed = new Set([
    "APPDATA",
    "COMSPEC",
    "HOME",
    "HOMEDRIVE",
    "HOMEPATH",
    "LANG",
    "LOCALAPPDATA",
    "NODE",
    "NODE_ENV",
    "NUMBER_OF_PROCESSORS",
    "OS",
    "PATH",
    "PATHEXT",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "WINDIR",
  ]);
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name, value]) => allowed.has(name.toUpperCase()) && value !== undefined,
    ),
  ) as NodeJS.ProcessEnv;
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (!pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.once("error", () => resolve());
      killer.once("close", () => resolve());
    });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

function clearTimers(record: RunningCommand): void {
  if (record.ceilingTimer) clearTimeout(record.ceilingTimer);
  if (record.abandonTimer) clearTimeout(record.abandonTimer);
  record.ceilingTimer = null;
  record.abandonTimer = null;
}

function forget(record: RunningCommand): void {
  clearTimers(record);
  if (record.collectTimer) clearTimeout(record.collectTimer);
  record.collectTimer = null;
  commandsById.delete(record.id);
  if (
    record.runtimeSessionId !== null &&
    activeCommands.get(record.runtimeSessionId) === record
  ) {
    activeCommands.delete(record.runtimeSessionId);
  }
}

export async function cancelAuthorizedTerminalCommand(
  runtimeSessionId: number,
): Promise<boolean> {
  const record = activeCommands.get(runtimeSessionId);
  if (!record || record.closed) return false;
  await terminateProcessTree(record.child);
  return true;
}

export interface TerminalAuthorization {
  allowed: boolean;
  category: "inspect" | "git_read" | "verification" | "delete" | "approved" | "denied";
  /** True when the exact command may proceed after an interactive user approval. */
  approvalRequired: boolean;
  reason: string;
  workspaceRoot: string;
}

export interface TerminalAuthorizationOptions {
  /**
   * Server-owned working directory for this runtime session. The model cannot
   * choose it.
   */
  workspaceRoot?: string;
  /**
   * Canonical roots from the active per-turn capability decision. Absolute
   * paths are accepted automatically only when they resolve inside one of
   * these roots. An exact interactive command approval may widen that command.
   */
  authorizedRoots?: readonly string[];
  /** Exact server-resolved files this turn may delete. */
  authorizedDeleteTargets?: readonly string[];
  /**
   * Exact command whose native runtime permission prompt has resolved. This is
   * supplied by Breadboard's server-owned tool wrapper, never by model args.
   */
  approvedCommand?: string;
}

const SAFE_COMMANDS: Array<{
  category: Exclude<TerminalAuthorization["category"], "denied">;
  pattern: RegExp;
}> = [
  { category: "inspect", pattern: /^(?:pwd|Get-Location)(?:\s+)?$/i },
  { category: "inspect", pattern: /^(?:ls|dir|Get-ChildItem)(?:\s+[^\r\n]*)?$/i },
  { category: "inspect", pattern: /^(?:cat|type|Get-Content)(?:\s+[^\r\n]+)$/i },
  { category: "inspect", pattern: /^rg(?:\s+[^\r\n]+)$/i },
  {
    category: "git_read",
    pattern: /^git\s+(?:status|diff|log|show|rev-parse|branch\s+--show-current)(?:\s+[^\r\n]*)?$/i,
  },
  {
    category: "verification",
    pattern: /^(?:npm|pnpm|yarn|bun)\s+(?:(?:run\s+)?(?:test|lint|build|typecheck|check))(?:\s+[^\r\n]*)?$/i,
  },
  { category: "verification", pattern: /^node\s+--test(?:\s+[^\r\n]*)?$/i },
  { category: "verification", pattern: /^npx\s+tsc\s+--noEmit(?:\s+[^\r\n]*)?$/i },
];

const SAFE_READ_PIPELINE_STAGES = [
  /^(?:Get-ChildItem|dir|ls)(?:\s+[^\r\n]*)?$/i,
  /^(?:Sort-Object|Select-Object|Measure-Object|Format-Table)(?:\s+[^\r\n]*)?$/i,
];

function resolvedRoot(value: string): string | null {
  const canonical = canonicalizePath(value);
  return canonical ? realPathAllowingMissing(canonical) : null;
}

function authorizationRoots(
  workspaceRoot: string,
  roots: readonly string[] | undefined,
): string[] {
  const candidates = [workspaceRoot, ...(roots ?? [])];
  return [
    ...new Set(
      candidates
        .map(resolvedRoot)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

/**
 * Return quoted and unquoted command tokens without evaluating PowerShell.
 * This is intentionally smaller than a shell parser: command composition,
 * substitutions, script blocks, and expressions are rejected before this runs.
 */
function commandTokens(command: string): string[] {
  const tokens: string[] = [];
  for (const match of command.matchAll(/"([^"]*)"|'([^']*)'|([^\s|]+)/g)) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    if (value) tokens.push(value.replace(/[,\s]+$/, ""));
  }
  return tokens;
}

function absoluteCommandPaths(command: string): string[] {
  return commandTokens(command).filter((token) =>
    /^[A-Za-z]:[\\/]/.test(token) ||
    /^\\\\[^\\]/.test(token) ||
    (process.platform !== "win32" && token.startsWith("/")),
  );
}

function safeReadPipeline(command: string): boolean {
  if (!command.includes("|")) return false;
  const stages = command.split("|").map((stage) => stage.trim());
  if (stages.length < 2 || stages.length > 5 || stages.some((stage) => !stage)) {
    return false;
  }
  if (!SAFE_READ_PIPELINE_STAGES[0].test(stages[0])) return false;
  return stages
    .slice(1)
    .every((stage) => SAFE_READ_PIPELINE_STAGES[1].test(stage));
}

function parsedExactDeleteTarget(command: string): string | null {
  const powershell = command.match(
    /^Remove-Item\s+(?:-Force\s+)?-LiteralPath\s+(?:'([^']+)'|"([^"$`]+)"|([^\s'"`;&|<>]+))(?:\s+-Force)?$/i,
  );
  if (powershell) return powershell[1] ?? powershell[2] ?? powershell[3] ?? null;
  const posix = command.match(
    /^rm\s+--\s+(?:'([^']+)'|"([^"$`]+)"|([^\s'"`;&|<>]+))$/,
  );
  return posix ? posix[1] ?? posix[2] ?? posix[3] ?? null : null;
}

function sameResolvedPath(left: string, right: string): boolean {
  const a = resolvedRoot(left);
  const b = resolvedRoot(right);
  return Boolean(a && b && isWithinRoot(a, b) && isWithinRoot(b, a));
}

/**
 * Server-side automatic command policy for the dedicated Terminal. Safe reads
 * and focused verification run immediately. Other valid commands are marked as
 * requiring approval; the runtime then pauses on a native permission card and
 * retries with `approvedCommand` set to the exact text the user saw. The model
 * receives no approval flag and no independent way to choose a cwd.
 */
export function authorizeTerminalCommand(
  command: unknown,
  options: TerminalAuthorizationOptions = {},
): TerminalAuthorization {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? repositoryRoot());
  const roots = authorizationRoots(workspaceRoot, options.authorizedRoots);
  if (typeof command !== "string" || !command.trim()) {
    return { allowed: false, category: "denied", approvalRequired: false, reason: "A command is required.", workspaceRoot };
  }
  const value = command.trim();
  if (value.length > MAX_COMMAND_LENGTH) {
    return { allowed: false, category: "denied", approvalRequired: false, reason: "The command is too long.", workspaceRoot };
  }
  if (options.approvedCommand?.trim() === value) {
    return {
      allowed: true,
      category: "approved",
      approvalRequired: false,
      reason: "Authorized by the user's approval of this exact command.",
      workspaceRoot,
    };
  }
  const deleteTarget = parsedExactDeleteTarget(value);
  if (deleteTarget) {
    const target = resolvedRoot(deleteTarget);
    const exactTargets = options.authorizedDeleteTargets ?? [];
    if (
      !target ||
      !path.isAbsolute(deleteTarget) ||
      !roots.some((root) => isWithinRoot(root, target)) ||
      !exactTargets.some((allowed) => sameResolvedPath(allowed, deleteTarget))
    ) {
      return {
        allowed: false,
        category: "denied",
        approvalRequired: true,
        reason: "Deletion is limited to the exact files confirmed for this turn.",
        workspaceRoot,
      };
    }
    return {
      allowed: true,
      category: "delete",
      approvalRequired: false,
      reason: "Authorized as an exact-file deletion confirmed for this turn.",
      workspaceRoot,
    };
  }
  if (/[\r\n;&<>`$%{}[\]()]/.test(value) || /@\(/.test(value)) {
    return {
      allowed: false,
      category: "denied",
      approvalRequired: true,
      reason: "Shell composition, redirection, and command substitution require separate approval.",
      workspaceRoot,
    };
  }
  if (
    /(?:^|\s)(?:\.\.(?:[\\/]|$)|~(?:[\\/]|$))/i.test(value) ||
    /(?:^|\s)(?:--cwd|--prefix|--dir|--directory|-C)(?:\s|=)/i.test(value)
  ) {
    return {
      allowed: false,
      category: "denied",
      approvalRequired: true,
      reason: "Commands may not use parent traversal or choose a different working directory.",
      workspaceRoot,
    };
  }
  for (const requestedPath of absoluteCommandPaths(value)) {
    const target = resolvedRoot(requestedPath);
    if (!target || !roots.some((root) => isWithinRoot(root, target))) {
      return {
        allowed: false,
        category: "denied",
        approvalRequired: true,
        reason: "The command addresses a path outside the folders authorized for this turn.",
        workspaceRoot,
      };
    }
  }
  if (
    /^(?:(?:npm|pnpm|yarn|bun)\s+(?:install|uninstall|add|remove|publish)|git\s+(?:push|commit|checkout|switch|merge|rebase|reset|clean)|(?:rm|rmdir|del|erase|Remove-Item|Set-Content|Add-Content|Move-Item|Copy-Item|New-Item|chmod|chown|curl|wget|Invoke-WebRequest|Start-Process)\b)/i.test(value) ||
    /(?:--pre(?:-glob)?|--hostname-bin|--ext-diff|--textconv)\b/i.test(value) ||
    /\b(?:env|variable|function|alias|cert|registry):/i.test(value)
  ) {
    return {
      allowed: false,
      category: "denied",
      approvalRequired: true,
      reason: "This command can modify the workspace, install software, or affect an external system.",
      workspaceRoot,
    };
  }
  if (safeReadPipeline(value)) {
    return {
      allowed: true,
      category: "inspect",
      approvalRequired: false,
      reason: "Authorized as a read-only inspection pipeline within the active folder grant.",
      workspaceRoot,
    };
  }
  if (value.includes("|")) {
    return {
      allowed: false,
      category: "denied",
      approvalRequired: true,
      reason: "Only Get-ChildItem read pipelines with sorting, selection, measurement, or table formatting are allowed.",
      workspaceRoot,
    };
  }
  const match = SAFE_COMMANDS.find((candidate) => candidate.pattern.test(value));
  if (!match) {
    return {
      allowed: false,
      category: "denied",
      approvalRequired: true,
      reason: "Only read-only inspection, read-only Git, and focused existing verification commands are allowed automatically.",
      workspaceRoot,
    };
  }
  return {
    allowed: true,
    category: match.category,
    approvalRequired: false,
    reason: "Authorized by the dedicated Terminal read/verification policy.",
    workspaceRoot,
  };
}

export interface TerminalCommandResult {
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  /**
   * True when the command is still executing. The caller collects the rest by
   * asking for the same `commandId` again; nothing has been killed.
   */
  running: boolean;
  /** Handle for collecting the remainder of a still-running command. */
  commandId: string | null;
  elapsedMs: number;
  /** Wall-clock ceiling this command is held to, for an honest timeout report. */
  maxRuntimeMs: number;
}

function snapshot(record: RunningCommand): TerminalCommandResult {
  return {
    command: record.command,
    cwd: ".",
    exitCode: record.closed ? record.exitCode : null,
    stdout: record.stdout.toString("utf8"),
    stderr: record.stderr.toString("utf8"),
    timedOut: record.timedOut,
    truncated: record.truncated,
    running: !record.closed,
    commandId: record.closed ? null : record.id,
    elapsedMs: Date.now() - record.startedAt,
    maxRuntimeMs: record.maxRuntimeMs,
  };
}

function startCommand(
  command: string,
  workspaceRoot: string,
  options: { runtimeSessionId?: number; maxRuntimeMs?: number },
): RunningCommand {
  const executable = resolveCommandShell();
  const args = process.platform === "win32"
    ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command]
    : ["-lc", command];
  const child = spawn(executable, args, {
    cwd: workspaceRoot,
    windowsHide: true,
    detached: process.platform !== "win32",
    env: filteredEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const ceiling = resolveMaxRuntimeMs(options.maxRuntimeMs);
  const record: RunningCommand = {
    id: randomUUID(),
    command,
    child,
    runtimeSessionId: options.runtimeSessionId ?? null,
    startedAt: Date.now(),
    maxRuntimeMs: ceiling,
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    truncated: false,
    timedOut: false,
    closed: false,
    exitCode: null,
    waiters: new Set(),
    ceilingTimer: null,
    abandonTimer: null,
    collectTimer: null,
  };

  const append = (
    current: Buffer<ArrayBufferLike>,
    chunk: Buffer<ArrayBufferLike>,
  ): Buffer<ArrayBufferLike> => {
    if (current.length >= MAX_OUTPUT_BYTES) {
      record.truncated = true;
      return current;
    }
    const remaining = MAX_OUTPUT_BYTES - current.length;
    if (chunk.length > remaining) record.truncated = true;
    return Buffer.concat([current, chunk.subarray(0, remaining)]);
  };
  child.stdout.on("data", (chunk: Buffer<ArrayBufferLike>) => {
    record.stdout = append(record.stdout, chunk);
  });
  child.stderr.on("data", (chunk: Buffer<ArrayBufferLike>) => {
    record.stderr = append(record.stderr, chunk);
  });

  const settle = (exitCode: number | null) => {
    if (record.closed) return;
    record.exitCode = exitCode;
    record.closed = true;
    clearTimers(record);
    for (const wake of [...record.waiters]) wake();
    record.waiters.clear();
    // Keep the finished output collectable: a slice may have already returned
    // "still running" before the process exited, and the next collection must
    // still find the result rather than a missing handle.
    record.collectTimer = setTimeout(
      () => forget(record),
      COLLECTABLE_AFTER_EXIT_MS,
    );
    record.collectTimer.unref?.();
  };
  child.once("error", (error) => {
    record.stderr = append(record.stderr, Buffer.from(String(error.message)));
    settle(-1);
  });
  child.once("close", (exitCode) => settle(exitCode));

  record.ceilingTimer = setTimeout(() => {
    record.timedOut = true;
    void terminateProcessTree(child);
  }, ceiling);
  record.ceilingTimer.unref?.();

  commandsById.set(record.id, record);
  if (options.runtimeSessionId !== undefined) {
    const previous = activeCommands.get(options.runtimeSessionId);
    if (previous && !previous.closed) void terminateProcessTree(previous.child);
    activeCommands.set(options.runtimeSessionId, record);
  }
  return record;
}

/**
 * Wait for this command to finish, for the slice to expire, or for the caller
 * to go away. Expiry is not a kill: the process keeps running and stays
 * collectable by id.
 */
function awaitSlice(
  record: RunningCommand,
  options: { signal?: AbortSignal },
): Promise<void> {
  if (record.abandonTimer) {
    clearTimeout(record.abandonTimer);
    record.abandonTimer = null;
  }
  if (record.closed) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      record.waiters.delete(finish);
      options.signal?.removeEventListener("abort", onAbort);
      // A caller that stops collecting must not leave a scan running forever.
      if (!record.closed && !record.abandonTimer) {
        record.abandonTimer = setTimeout(
          () => void terminateProcessTree(record.child),
          ABANDONED_AFTER_MS,
        );
        record.abandonTimer.unref?.();
      }
      resolve();
    };
    const onAbort = () => {
      void terminateProcessTree(record.child);
      finish();
    };
    const timer = setTimeout(finish, sliceMs());
    timer.unref?.();
    record.waiters.add(finish);
    options.signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runAuthorizedTerminalCommand(
  command: string,
  options: {
    runtimeSessionId?: number;
    signal?: AbortSignal;
    workspaceRoot?: string;
    authorizedRoots?: readonly string[];
    authorizedDeleteTargets?: readonly string[];
    approvedCommand?: string;
    /** Wall-clock this command asked for, clamped by `resolveMaxRuntimeMs`. */
    maxRuntimeMs?: number;
  } = {},
): Promise<TerminalCommandResult> {
  const authorization = authorizeTerminalCommand(command, options);
  if (!authorization.allowed) throw new Error(authorization.reason);
  const record = startCommand(command, authorization.workspaceRoot, options);
  await awaitSlice(record, options);
  return collect(record);
}

/**
 * Collect more of a command that outlived its slice. Ownership is checked by
 * the caller's runtime session: a handle is useless to any other session.
 */
export async function continueAuthorizedTerminalCommand(
  commandId: unknown,
  options: { runtimeSessionId: number; signal?: AbortSignal },
): Promise<TerminalCommandResult> {
  const record =
    typeof commandId === "string" ? commandsById.get(commandId) : undefined;
  if (!record || record.runtimeSessionId !== options.runtimeSessionId) {
    throw new Error(
      "That command is no longer running. Start it again if you still need it.",
    );
  }
  await awaitSlice(record, options);
  return collect(record);
}

function collect(record: RunningCommand): TerminalCommandResult {
  const result = snapshot(record);
  if (record.closed) forget(record);
  return result;
}
