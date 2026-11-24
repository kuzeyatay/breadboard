import { isProfileId } from "../../scripts/claude-profiles.mjs";
import {
  ClaudeAccountJobError,
  beginClaudeAccountLogin,
  pollClaudeAccountLogin,
  runClaudeAccountJob,
} from "./runtime-v2/claude-account-job.ts";

/**
 * Models exposed by Claude Code subscriptions.
 *
 * Claude Code accepts canonical model ids as well as its moving aliases. Keep
 * canonical ids in Breadboard so a saved background-model choice does not
 * silently change underneath a conversation.
 */
export const CLAUDE_CODE_MODELS = [
  "claude-opus-5-5",
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

export function claudeProfileFile(id: string): string {
  return id === "default" ? CLAUDE_CODE_ACCOUNT_FILE : `claude-code-profile-${id}.json`;
}

export function claudeProfileId(file: string): string | null {
  if (file === CLAUDE_CODE_ACCOUNT_FILE) return "default";
  const id = /^claude-code-profile-([0-9a-f-]+)\.json$/.exec(file)?.[1];
  return id && isProfileId(id) ? id : null;
}

interface ClaudeProfile {
  id: string;
  email: string | null;
  connectedAt: string | null;
  resetAt: number;
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
): Promise<ClaudeCodeStatus & { accounts: ClaudeProfile[] }> {
  const result = await runClaudeAccountJob({ userId, operation: "profiles", signal });
  try {
    const parsed = JSON.parse(result.detail);
    const status = parseClaudeCodeStatus(parsed);
    return {
      ...status,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts.filter((row: ClaudeProfile) => row && isProfileId(row.id) && Number.isFinite(row.resetAt)) : [],
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

export async function linkClaudeCodeLogin(userId: number) {
  return { state: CLAUDE_LOGIN_STATE_PREFIX + await beginClaudeAccountLogin(userId) };
}

export function isClaudeCodeLoginState(state: string): boolean {
  return state.startsWith(CLAUDE_LOGIN_STATE_PREFIX);
}

export async function isClaudeCodeLoginComplete(userId: number, state: string, cancel = false) {
  const jobId = state.slice(CLAUDE_LOGIN_STATE_PREFIX.length);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(jobId)) throw new ClaudeAccountJobError(400, "Invalid Claude sign-in.");
  return pollClaudeAccountLogin(userId, jobId, cancel);
}

export async function changeClaudeProfile(userId: number, operation: "activate" | "logout", profile: string, signal?: AbortSignal) {
  const result = await runClaudeAccountJob({ userId, operation, profile, signal });
  if (!result.ok) throw new ClaudeAccountJobError(409, result.message);
}

export function isClaudeCodeModel(model: string): boolean {
  const normalized = model.trim().toLowerCase().replace(/^cliproxy\//, "");
  return normalized.startsWith("claude-");
}
