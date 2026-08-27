import crypto from "node:crypto";
import {
  ClaudeAccountJobError,
  runClaudeAccountJob,
} from "./runtime-v2/claude-account-job.ts";

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
  // The same Fable 5 on the same subscription, reached through the local pxpipe
  // proxy: it renders the system prompt, tool docs and older history into dense
  // images, which cost tokens by their pixel size rather than by their text. The
  // suffix names the route, not a different model, and ChatMock strips it before
  // the CLI ever sees it (`chatmock/providers/pxpipe.py`). Both entries exist
  // because the compression is lossy for long exact strings buried in old
  // context, so byte-exact work belongs on the plain id.
  "claude-fable-5-efficient",
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
  __breadboardClaudeLoginStates?: Map<string, { userId: number; expiresAt: number }>;
};

function loginStates(): Map<string, { userId: number; expiresAt: number }> {
  globalState.__breadboardClaudeLoginStates ??= new Map<
    string,
    { userId: number; expiresAt: number }
  >();
  const states = globalState.__breadboardClaudeLoginStates;
  const now = Date.now();
  for (const [state, record] of states) {
    if (record.expiresAt <= now) states.delete(state);
  }
  return states;
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

/** Read authentication through Claude Code itself; never open its credential. */
export async function readClaudeCodeStatus(
  userId: number,
  signal?: AbortSignal,
): Promise<ClaudeCodeStatus> {
  const result = await runClaudeAccountJob({ userId, operation: "status", signal });
  try {
    const status = parseClaudeCodeStatus(JSON.parse(result.detail));
    const parsed = JSON.parse(result.detail) as { installed?: unknown; error?: unknown };
    return {
      ...status,
      installed: parsed.installed === true,
      error: status.loggedIn ? null : text(parsed.error) ?? status.error,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ClaudeAccountJobError(502, "Runtime returned an invalid Claude Code status.");
    }
    throw error;
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
export async function linkClaudeCodeLogin(userId: number, signal?: AbortSignal): Promise<{
  state: string;
  complete: true;
}> {
  const status = await readClaudeCodeStatus(userId, signal);
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
  loginStates().set(state, { userId, expiresAt: Date.now() + LOGIN_STATE_TTL_MS });
  return { state, complete: true };
}

export function isClaudeCodeLoginState(state: string): boolean {
  return state.startsWith(CLAUDE_LOGIN_STATE_PREFIX);
}

export async function isClaudeCodeLoginComplete(
  userId: number,
  state: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (loginStates().get(state)?.userId !== userId) return false;
  return (await readClaudeCodeStatus(userId, signal)).loggedIn;
}

/** Sign out through the owner of the credential rather than deleting files. */
export async function logoutClaudeCode(userId: number, signal?: AbortSignal): Promise<void> {
  const result = await runClaudeAccountJob({ userId, operation: "logout", signal });
  if (!result.ok) throw new ClaudeAccountJobError(502, result.message);
}

export function isClaudeCodeModel(model: string): boolean {
  const normalized = model.trim().toLowerCase().replace(/^cliproxy\//, "");
  return normalized.startsWith("claude-");
}
