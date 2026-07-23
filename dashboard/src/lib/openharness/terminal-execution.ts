import { spawn } from "node:child_process";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";

const MAX_COMMAND_LENGTH = 2_000;
const MAX_OUTPUT_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;

export interface TerminalAuthorization {
  allowed: boolean;
  category: "inspect" | "git_read" | "verification" | "denied";
  reason: string;
  workspaceRoot: string;
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

/**
 * Server-side command policy for the dedicated Terminal. It deliberately
 * rejects shell composition, absolute paths, parent traversal and all write /
 * install command families. The model receives no way to choose a cwd.
 */
export function authorizeTerminalCommand(command: unknown): TerminalAuthorization {
  const workspaceRoot = path.resolve(repositoryRoot());
  if (typeof command !== "string" || !command.trim()) {
    return { allowed: false, category: "denied", reason: "A command is required.", workspaceRoot };
  }
  const value = command.trim();
  if (value.length > MAX_COMMAND_LENGTH) {
    return { allowed: false, category: "denied", reason: "The command is too long.", workspaceRoot };
  }
  if (/[\r\n;&|<>`$%]/.test(value) || /@\(/.test(value)) {
    return {
      allowed: false,
      category: "denied",
      reason: "Shell composition, redirection, and command substitution require separate approval.",
      workspaceRoot,
    };
  }
  if (
    /(?:^|\s)(?:\.\.(?:[\\/]|$)|~(?:[\\/]|$)|[A-Za-z]:[\\/]|\\\\|\/(?:[^\s]|$))/i.test(value) ||
    /(?:^|\s)(?:--cwd|--prefix|--dir|--directory|-C)(?:\s|=)/i.test(value)
  ) {
    return {
      allowed: false,
      category: "denied",
      reason: "Commands may only address relative paths inside the approved Breadboard workspace.",
      workspaceRoot,
    };
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

export async function runAuthorizedTerminalCommand(command: string): Promise<{
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}> {
  const authorization = authorizeTerminalCommand(command);
  if (!authorization.allowed) throw new Error(authorization.reason);

  const executable = process.platform === "win32" ? "powershell.exe" : "/bin/sh";
  const args = process.platform === "win32"
    ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command]
    : ["-lc", command];

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: authorization.workspaceRoot,
      windowsHide: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
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
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, DEFAULT_TIMEOUT_MS);
    child.once("close", (exitCode) => {
      clearTimeout(timer);
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
