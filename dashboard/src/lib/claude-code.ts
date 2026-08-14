import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const STATUS_TIMEOUT_MS = 20_000;
const LOGIN_STATE_TTL_MS = 15 * 60_000;

/**
 * Models exposed by Claude Code subscriptions.
 *
 * Claude Code accepts canonical model ids as well as its moving aliases. Keep
 * canonical ids in Breadboard so a saved background-model choice does not
 * silently change underneath a conversation.
 */
export const CLAUDE_CODE_MODELS = [
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-haiku-4-5-20251001",
  // Last because it is not a rung on the Opus/Sonnet/Haiku ladder: Fable is a
  // separate model picked for what it writes, not for how much it costs.
  "claude-fable-5",
] as const;

/** A virtual account id. It contains no credential and is safe to send to UI. */
export const CLAUDE_CODE_ACCOUNT_FILE = "claude-code-session.json";
const CLAUDE_LOGIN_STATE_PREFIX = "claude-code:";

export interface ClaudeCodeStatus {
  installed: boolean;
  loggedIn: boolean;
  authMethod: string | null;
  email: string | null;
  subscriptionType: string | null;
  error: string | null;
}

interface ClaudeAuthStatusPayload {
  loggedIn?: unknown;
  authMethod?: unknown;
  email?: unknown;
  subscriptionType?: unknown;
}

const globalState = globalThis as typeof globalThis & {
  __breadboardClaudeLoginStates?: Map<string, number>;
};

function loginStates(): Map<string, number> {
  globalState.__breadboardClaudeLoginStates ??= new Map<string, number>();
  const states = globalState.__breadboardClaudeLoginStates;
  const now = Date.now();
  for (const [state, expiresAt] of states) {
    if (expiresAt <= now) states.delete(state);
  }
  return states;
}

function claudeCommand(): string {
  // The override is mainly useful to packaged apps whose inherited PATH is
  // narrower than an interactive shell's. The credential remains Claude
  // Code-owned regardless of where its executable lives.
  const configured = process.env.CLAUDE_CLI_PATH?.trim();
  if (configured) return configured;

  // Desktop apps do not always inherit the login shell's PATH. Check the
  // official installer's common locations before falling back to PATH lookup.
  const executable = process.platform === "win32" ? "claude.exe" : "claude";
  const candidates = [
    path.join(os.homedir(), ".local", "bin", executable),
    ...(process.platform === "darwin"
      ? ["/opt/homebrew/bin/claude", "/usr/local/bin/claude"]
      : []),
    ...(process.platform === "win32" && process.env.LOCALAPPDATA
      ? [path.join(process.env.LOCALAPPDATA, "Programs", "claude", executable)]
      : []),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? "claude";
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseClaudeCodeStatus(value: unknown): ClaudeCodeStatus {
  const payload =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as ClaudeAuthStatusPayload)
      : {};
  const loggedIn = payload.loggedIn === true;
  return {
    installed: true,
    loggedIn,
    authMethod: text(payload.authMethod),
    email: text(payload.email),
    subscriptionType: text(payload.subscriptionType),
    error: loggedIn ? null : "Claude Code is not signed in.",
  };
}

function commandError(error: unknown): { missing: boolean; message: string } {
  const value = error as {
    code?: unknown;
    stdout?: unknown;
    stderr?: unknown;
    message?: unknown;
  };
  const missing = value?.code === "ENOENT";
  const detail = [value?.stderr, value?.stdout, value?.message]
    .find((candidate) => typeof candidate === "string" && candidate.trim());
  return {
    missing,
    message:
      typeof detail === "string" && detail.trim()
        ? detail.trim()
        : missing
          ? "Claude Code is not installed."
          : "Claude Code is not signed in.",
  };
}

/** Read authentication through Claude Code itself; never open its credential. */
export async function readClaudeCodeStatus(): Promise<ClaudeCodeStatus> {
  try {
    const { stdout } = await execFileAsync(
      claudeCommand(),
      ["auth", "status", "--json"],
      {
        timeout: STATUS_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
    );
    return parseClaudeCodeStatus(JSON.parse(stdout));
  } catch (error) {
    const failure = commandError(error);
    return {
      installed: !failure.missing,
      loggedIn: false,
      authMethod: null,
      email: null,
      subscriptionType: null,
      error: failure.message,
    };
  }
}

/**
 * Link an already authenticated Claude Code installation to Breadboard.
 *
 * Operator OSS ultimately trusts `claude auth status` and leaves the real
 * credential under Claude Code's ownership. Breadboard does the same. The
 * current settings surface has no authorization-code input, so a first login
 * must be completed with the official `claude auth login` command; once it is,
 * linking is immediate and no token is copied into Breadboard or CLIProxyAPI.
 */
export async function linkClaudeCodeLogin(): Promise<{
  state: string;
  complete: true;
}> {
  const status = await readClaudeCodeStatus();
  if (!status.installed) {
    throw new Error(
      "Claude Code is not installed. Install the official Claude Code CLI, run `claude auth login`, then refresh Breadboard.",
    );
  }
  if (!status.loggedIn) {
    throw new Error(
      "Run `claude auth login` once in a terminal, then refresh Breadboard. Claude keeps the credential; Breadboard never copies it.",
    );
  }

  const state = `${CLAUDE_LOGIN_STATE_PREFIX}${crypto.randomUUID()}`;
  loginStates().set(state, Date.now() + LOGIN_STATE_TTL_MS);
  return { state, complete: true };
}

export function isClaudeCodeLoginState(state: string): boolean {
  return state.startsWith(CLAUDE_LOGIN_STATE_PREFIX);
}

export async function isClaudeCodeLoginComplete(state: string): Promise<boolean> {
  if (!loginStates().has(state)) return false;
  return (await readClaudeCodeStatus()).loggedIn;
}

/** Sign out through the owner of the credential rather than deleting files. */
export async function logoutClaudeCode(): Promise<void> {
  try {
    await execFileAsync(claudeCommand(), ["auth", "logout"], {
      timeout: STATUS_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    throw new Error(commandError(error).message);
  }
}

export function isClaudeCodeModel(model: string): boolean {
  const normalized = model.trim().toLowerCase().replace(/^cliproxy\//, "");
  return normalized.startsWith("claude-");
}
