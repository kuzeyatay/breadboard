// Getting from "the user typed an instruction" to "there is an authenticated
// session against a running Inbox Zero".
//
// Four things have to be true, and each fails in a way the person can act on:
// the clone is present, a container engine is available, the stack is up, and a
// mailbox is connected. The last one is theirs to do and cannot be automated —
// it needs their Google or Microsoft OAuth client and their consent in a real
// browser — so it is reported as a step with a link, never as an error.
//
// Minted sessions are cached by the authenticated Breadboard user. Minting
// writes a row to Inbox Zero's session table, and doing that once per turn would
// fill it with a session per message. The scope key is equally important: a
// cookie minted during one user's request must never be reused by another.

import "server-only";

import { resolveInboxZeroConfig, type InboxZeroConfig } from "./config.ts";
import {
  cloneInstalled,
  containerModelSettings,
  ensureCredentials,
  hasEmailProvider,
  stackStatus,
  startStack,
} from "./stack.ts";
import { mintSession, listMailboxes } from "./session.ts";
import { verifySession } from "./client.ts";
import type {
  InboxZeroSession,
  ReadyResult,
  SetupStatus,
  SetupStep,
} from "./contract.ts";

export type { ReadyResult, SetupStatus, SetupStep } from "./contract.ts";

interface CachedSession {
  session: InboxZeroSession;
  cachedAt: number;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __breadboardInboxZeroSessions?: Map<number, CachedSession>;
};

/** Re-mint well before the seven-day session expiry rather than at the edge. */
const SESSION_REUSE_MS = 12 * 60 * 60_000;
/** Keep a compromised or long-lived service from accumulating one entry per user forever. */
const MAX_CACHED_USER_SCOPES = 64;

function cachedSessions(): Map<number, CachedSession> {
  return runtimeGlobal.__breadboardInboxZeroSessions ??=
    new Map<number, CachedSession>();
}

function cacheSession(scopeUserId: number, session: InboxZeroSession): void {
  const sessions = cachedSessions();
  sessions.delete(scopeUserId);
  sessions.set(scopeUserId, { session, cachedAt: Date.now() });
  while (sessions.size > MAX_CACHED_USER_SCOPES) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
}

function step(step: SetupStep, message: string, extra: Partial<SetupStatus> = {}): SetupStatus {
  return { step, ready: step === "ready", message, ...extra };
}

/**
 * Where the stack stands, without starting anything.
 *
 * Health must never cost a boot: opening a settings panel should not pull four
 * container images.
 */
export async function setupStatus(
  config: InboxZeroConfig = resolveInboxZeroConfig(),
): Promise<SetupStatus> {
  if (!cloneInstalled(config)) {
    return step(
      "clone_missing",
      `Inbox Zero is not checked out at ${config.cloneRoot}.`,
    );
  }
  const credentials = ensureCredentials(config);
  if (!hasEmailProvider(credentials)) {
    return step(
      "oauth_client_missing",
      "Inbox Zero needs your own Google or Microsoft OAuth client before it can read a mailbox. Add one in its settings.",
    );
  }
  const stack = await stackStatus(config);
  if (stack.state === "docker_unavailable") {
    return step("docker_unavailable", stack.reason ?? "No container engine is running.", { stack });
  }
  if (!stack.reachable) {
    return step("stack_not_running", "Inbox Zero is installed but not running yet.", { stack });
  }
  try {
    const mailboxes = await listMailboxes(config, credentials);
    if (!mailboxes.length) {
      return step(
        "mailbox_not_connected",
        "Inbox Zero is running. Sign in and connect your mailbox to finish setting it up.",
        { stack, url: config.baseUrl, mailboxes },
      );
    }
    return step(
      "ready",
      `Connected to ${mailboxes[0].email}.`,
      { stack, url: config.baseUrl, mailboxes },
    );
  } catch (error) {
    return step("stack_not_running", describe(error), { stack });
  }
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("psql_failed")) {
    return "Inbox Zero's database did not answer. The stack may still be starting.";
  }
  if (message === "no_compose_command") {
    return "No Docker Compose command is available on this machine.";
  }
  return message.slice(0, 300);
}

/**
 * Everything needed for a turn: a running stack and a session that it accepts.
 *
 * `allowStart` is false on read-only paths so that checking status never starts
 * containers, and true on the run path where the user has asked for work and a
 * cold start is the honest cost of it.
 */
export async function ensureReady(input: {
  scopeUserId: number;
  allowStart: boolean;
  chatmockBaseUrl: string;
  chatmockApiKey: string;
  model: string;
  preferredEmail?: string;
  config?: InboxZeroConfig;
}): Promise<ReadyResult> {
  if (!Number.isSafeInteger(input.scopeUserId) || input.scopeUserId < 1) {
    throw new Error("A valid authenticated Inbox Zero user scope is required.");
  }
  const config = input.config ?? resolveInboxZeroConfig();
  if (config.mode === "disabled") {
    return { ok: false, setup: step("clone_missing", "The Inbox Zero agent is switched off.") };
  }
  if (!cloneInstalled(config)) {
    return {
      ok: false,
      setup: step("clone_missing", `Inbox Zero is not checked out at ${config.cloneRoot}.`),
    };
  }

  const credentials = ensureCredentials(config);
  if (!hasEmailProvider(credentials)) {
    return {
      ok: false,
      setup: step(
        "oauth_client_missing",
        "Inbox Zero needs your own Google or Microsoft OAuth client before it can read a mailbox. Add one in its settings.",
      ),
    };
  }

  let stack = await stackStatus(config);
  if (!stack.reachable) {
    if (!input.allowStart) {
      return {
        ok: false,
        setup: step("stack_not_running", "Inbox Zero is not running.", { stack }),
      };
    }
    const started = await startStack({
      config,
      credentials,
      model: containerModelSettings({
        chatmockBaseUrl: input.chatmockBaseUrl,
        chatmockApiKey: input.chatmockApiKey,
        model: input.model,
      }),
    });
    stack = started.status;
    if (!started.started) {
      return {
        ok: false,
        setup: step(
          stack.state === "docker_unavailable" ? "docker_unavailable" : "stack_not_running",
          stack.reason ?? "Inbox Zero did not finish starting.",
          { stack },
        ),
      };
    }
  }

  const sessions = cachedSessions();
  const cached = sessions.get(input.scopeUserId);
  if (
    cached &&
    Date.now() - cached.cachedAt < SESSION_REUSE_MS &&
    (!input.preferredEmail || cached.session.identity.email === input.preferredEmail)
  ) {
    const verified = await verifySession(config, cached.session);
    if (verified.ok) {
      return { ok: true, session: cached.session, setup: step("ready", `Connected to ${cached.session.identity.email}.`, { stack }) };
    }
    sessions.delete(input.scopeUserId);
  }

  try {
    const session = await mintSession({
      config,
      credentials,
      preferredEmail: input.preferredEmail,
    });
    if (!session) {
      return {
        ok: false,
        setup: step(
          "mailbox_not_connected",
          "Inbox Zero is running, but no mailbox is connected yet. Sign in and connect one to finish setting it up.",
          { stack, url: config.baseUrl },
        ),
      };
    }
    const verified = await verifySession(config, session);
    if (!verified.ok) {
      return {
        ok: false,
        setup: step(
          "stack_not_running",
          `Inbox Zero rejected the session Breadboard minted (HTTP ${verified.status}).`,
          { stack },
        ),
      };
    }
    cacheSession(input.scopeUserId, session);
    return {
      ok: true,
      session,
      setup: step("ready", `Connected to ${session.identity.email}.`, { stack }),
    };
  } catch (error) {
    return { ok: false, setup: step("stack_not_running", describe(error), { stack }) };
  }
}

/** Forget the cached session, so the next turn mints a fresh one. */
export function forgetSession(): void {
  cachedSessions().clear();
}
