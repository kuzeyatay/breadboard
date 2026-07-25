import { spawn, type ChildProcess } from "node:child_process";
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
const DEFAULT_TIMEOUT_MS = 120_000;
const activeCommands = new Map<number, ChildProcess>();

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

export async function cancelAuthorizedTerminalCommand(
  runtimeSessionId: number,
): Promise<boolean> {
  const child = activeCommands.get(runtimeSessionId);
  if (!child) return false;
  activeCommands.delete(runtimeSessionId);
  await terminateProcessTree(child);
  return true;
}

export interface TerminalAuthorization {
  allowed: boolean;
  category: "inspect" | "git_read" | "verification" | "denied";
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
   * paths are accepted only when they resolve inside one of these roots.
   */
  authorizedRoots?: readonly string[];
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

/**
 * Server-side command policy for the dedicated Terminal. It deliberately
 * rejects shell composition, paths outside the active grant, parent traversal,
 * and all write / install command families. The model receives no way to
 * choose a cwd. A narrowly parsed read-only PowerShell pipeline is supported so
 * inspection tasks such as sorting files by size can actually be completed.
 */
export function authorizeTerminalCommand(
  command: unknown,
  options: TerminalAuthorizationOptions = {},
): TerminalAuthorization {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? repositoryRoot());
  const roots = authorizationRoots(workspaceRoot, options.authorizedRoots);
  if (typeof command !== "string" || !command.trim()) {
    return { allowed: false, category: "denied", reason: "A command is required.", workspaceRoot };
  }
  const value = command.trim();
  if (value.length > MAX_COMMAND_LENGTH) {
    return { allowed: false, category: "denied", reason: "The command is too long.", workspaceRoot };
  }
  if (/[\r\n;&<>`$%{}[\]()]/.test(value) || /@\(/.test(value)) {
    return {
      allowed: false,
      category: "denied",
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
      reason: "This command can modify the workspace, install software, or affect an external system.",
      workspaceRoot,
    };
  }
  if (safeReadPipeline(value)) {
    return {
      allowed: true,
      category: "inspect",
      reason: "Authorized as a read-only inspection pipeline within the active folder grant.",
      workspaceRoot,
    };
  }
  if (value.includes("|")) {
    return {
      allowed: false,
      category: "denied",
      reason: "Only Get-ChildItem read pipelines with sorting, selection, measurement, or table formatting are allowed.",
      workspaceRoot,
    };
  }
  const match = SAFE_COMMANDS.find((candidate) => candidate.pattern.test(value));
  if (!match) {
    return {
      allowed: false,
      category: "denied",
      reason: "Only read-only inspection, read-only Git, and focused existing verification commands are allowed automatically.",
      workspaceRoot,
    };
  }
  return {
    allowed: true,
    category: match.category,
    reason: "Authorized by the dedicated Terminal read/verification policy.",
    workspaceRoot,
  };
}

export async function runAuthorizedTerminalCommand(
  command: string,
  options: {
    runtimeSessionId?: number;
    signal?: AbortSignal;
    workspaceRoot?: string;
    authorizedRoots?: readonly string[];
  } = {},
): Promise<{
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}> {
  const authorization = authorizeTerminalCommand(command, options);
  if (!authorization.allowed) throw new Error(authorization.reason);

  const executable = resolveCommandShell();
  const args = process.platform === "win32"
    ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command]
    : ["-lc", command];

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: authorization.workspaceRoot,
      windowsHide: true,
      detached: process.platform !== "win32",
      env: filteredEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (options.runtimeSessionId !== undefined) {
      const previous = activeCommands.get(options.runtimeSessionId);
      if (previous && previous.exitCode === null) {
        void terminateProcessTree(previous);
      }
      activeCommands.set(options.runtimeSessionId, child);
    }
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let truncated = false;
    let timedOut = false;
    const append = (
      current: Buffer<ArrayBufferLike>,
      chunk: Buffer<ArrayBufferLike>,
    ): Buffer<ArrayBufferLike> => {
      if (current.length >= MAX_OUTPUT_BYTES) {
        truncated = true;
        return current;
      }
      const remaining = MAX_OUTPUT_BYTES - current.length;
      if (chunk.length > remaining) truncated = true;
      return Buffer.concat([current, chunk.subarray(0, remaining)]);
    };
    child.stdout.on("data", (chunk: Buffer<ArrayBufferLike>) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer<ArrayBufferLike>) => { stderr = append(stderr, chunk); });
    child.once("error", reject);
    const onAbort = () => {
      void terminateProcessTree(child);
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      void terminateProcessTree(child);
    }, DEFAULT_TIMEOUT_MS);
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (
        options.runtimeSessionId !== undefined &&
        activeCommands.get(options.runtimeSessionId) === child
      ) {
        activeCommands.delete(options.runtimeSessionId);
      }
      resolve({
        command,
        cwd: ".",
        exitCode,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        timedOut,
        truncated,
      });
    });
  });
}
