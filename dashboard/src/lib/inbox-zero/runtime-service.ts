// Process-free dashboard adapter for the Runtime V2-owned Inbox Zero stack
// controller. Docker/Compose/psql modules are reachable only from the service
// entrypoint; Next exchanges small authenticated JSON records with it.

import {
  callRuntimeAgentService,
  scopedAgentRequest,
  withRuntimeAgentServiceLease,
  type RuntimeAgentScope,
} from "../runtime-agent-service.ts";
import type {
  InboxZeroSession,
  InboxZeroStatusResult,
  ReadyResult,
  StackStatus,
  SetupStatus,
} from "./contract.ts";

export interface InboxZeroEnsureOptions {
  chatmockBaseUrl: string;
  chatmockApiKey: string;
  model: string;
  preferredEmail?: string;
}

export type InboxZeroSetupInput =
  | {
      action: "save_oauth";
      googleClientId: string;
      googleClientSecret: string;
      microsoftClientId: string;
      microsoftClientSecret: string;
    }
  | { action: "clear_oauth" | "stop" | "disconnect" }
  | {
      action: "start";
      chatmockBaseUrl: string;
      chatmockApiKey: string;
      model: string;
    };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(value: unknown, maximum = 8_192): string | null {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") <= maximum
    ? value
    : null;
}

function loopbackOrigin(value: unknown): string | null {
  const text = boundedString(value, 2_048);
  if (text === null) return null;
  try {
    const url = new URL(text);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function stackStatus(value: unknown): StackStatus | undefined {
  if (value === undefined) return undefined;
  const item = record(value);
  const docker = record(item?.docker);
  const states = new Set([
    "running",
    "starting",
    "stopped",
    "docker_unavailable",
    "not_installed",
  ]);
  const reason = item?.reason === undefined ? undefined : boundedString(item.reason, 2_048);
  if (
    !item ||
    !docker ||
    !states.has(String(item.state)) ||
    typeof item.reachable !== "boolean" ||
    typeof docker.cliInstalled !== "boolean" ||
    typeof docker.desktopInstalled !== "boolean" ||
    typeof docker.daemonRunning !== "boolean" ||
    reason === null
  ) throw new Error("Inbox Zero returned an invalid stack status.");
  return {
    state: item.state as StackStatus["state"],
    reachable: item.reachable,
    docker: {
      cliInstalled: docker.cliInstalled,
      desktopInstalled: docker.desktopInstalled,
      daemonRunning: docker.daemonRunning,
      ...(typeof docker.reason === "string" && docker.reason.length <= 2_048
        ? { reason: docker.reason }
        : {}),
    },
    ...(reason ? { reason } : {}),
  };
}

function setupStatus(value: unknown): SetupStatus {
  const item = record(value);
  const steps = new Set([
    "clone_missing",
    "docker_unavailable",
    "oauth_client_missing",
    "stack_not_running",
    "mailbox_not_connected",
    "ready",
  ]);
  if (
    !item ||
    !steps.has(String(item.step)) ||
    typeof item.ready !== "boolean" ||
    boundedString(item.message, 2_048) === null
  ) throw new Error("Inbox Zero returned an invalid setup status.");
  const mailboxes = Array.isArray(item.mailboxes)
    ? item.mailboxes.slice(0, 100).map((mailbox) => {
        const candidate = record(mailbox);
        const email = boundedString(candidate?.email, 320);
        const provider = boundedString(candidate?.provider, 64);
        if (email === null || provider === null) {
          throw new Error("Inbox Zero returned an invalid mailbox list.");
        }
        return { email, provider };
      })
    : undefined;
  const stack = stackStatus(item.stack);
  return {
    step: item.step as SetupStatus["step"],
    ready: item.ready,
    message: item.message as string,
    ...(typeof item.url === "string" && item.url.length <= 2_048 ? { url: item.url } : {}),
    ...(stack ? { stack } : {}),
    ...(mailboxes ? { mailboxes } : {}),
  };
}

function session(value: unknown): InboxZeroSession | undefined {
  if (value === undefined) return undefined;
  const item = record(value);
  const identity = record(item?.identity);
  const cookie = boundedString(item?.cookie, 2_048);
  const userId = boundedString(identity?.userId, 256);
  const emailAccountId = boundedString(identity?.emailAccountId, 256);
  const email = boundedString(identity?.email, 320);
  const provider = boundedString(identity?.provider, 64);
  const expiresAt = typeof item?.expiresAt === "string" ? new Date(item.expiresAt) : null;
  if (
    !item ||
    !identity ||
    !cookie ||
    !cookie.startsWith("better-auth.session_token=") ||
    !userId ||
    !emailAccountId ||
    email === null ||
    provider === null ||
    !expiresAt ||
    !Number.isFinite(expiresAt.getTime())
  ) throw new Error("Inbox Zero returned an invalid session projection.");
  return {
    cookie,
    identity: { userId, emailAccountId, email, provider },
    expiresAt,
  };
}

export function withInboxZeroStackLease<T>(
  scope: RuntimeAgentScope,
  reason: string,
  operation: () => Promise<T>,
): Promise<T> {
  return withRuntimeAgentServiceLease(
    "inbox-zero-stack",
    `${reason}:${scope.runId ?? scope.userId}`,
    operation,
  );
}

export async function readInboxZeroStatus(
  scope: Pick<RuntimeAgentScope, "userId">,
): Promise<InboxZeroStatusResult> {
  return withInboxZeroStackLease(scope, "authenticated-status", async () => {
    const value = record(await callRuntimeAgentService(
      "inbox-zero-stack",
      "/v1/status",
      scopedAgentRequest(scope),
      { timeoutMs: 45_000 },
    ));
    const oauth = record(value?.oauth);
    const baseUrl = loopbackOrigin(value?.baseUrl);
    if (
      !value ||
      typeof value.available !== "boolean" ||
      typeof value.installed !== "boolean" ||
      !["stack", "disabled"].includes(String(value.mode)) ||
      baseUrl === null ||
      boundedString(value.cloneRoot, 4_096) === null ||
      !oauth ||
      typeof oauth.google !== "boolean" ||
      typeof oauth.microsoft !== "boolean" ||
      typeof oauth.configured !== "boolean"
    ) throw new Error("Inbox Zero returned an invalid status projection.");
    return {
      available: value.available,
      installed: value.installed,
      mode: value.mode as InboxZeroStatusResult["mode"],
      baseUrl,
      cloneRoot: value.cloneRoot as string,
      oauth: {
        google: oauth.google,
        microsoft: oauth.microsoft,
        configured: oauth.configured,
      },
      setup: setupStatus(value.setup),
    };
  });
}

/** Caller holds the service lease for the complete mailbox turn. */
export async function ensureInboxZeroReady(
  scope: RuntimeAgentScope,
  options: InboxZeroEnsureOptions,
  signal?: AbortSignal,
): Promise<ReadyResult> {
  const value = record(await callRuntimeAgentService(
    "inbox-zero-stack",
    "/v1/ensure",
    scopedAgentRequest(scope, {
      options: {
        chatmockBaseUrl: options.chatmockBaseUrl,
        chatmockApiKey: options.chatmockApiKey,
        model: options.model,
        preferredEmail: options.preferredEmail ?? null,
      },
    }),
    { timeoutMs: 6 * 60_000, ...(signal ? { signal } : {}) },
  ));
  if (!value || typeof value.ok !== "boolean") {
    throw new Error("Inbox Zero returned an invalid readiness projection.");
  }
  const baseUrl = loopbackOrigin(value.baseUrl);
  const projectedSession = session(value.session);
  return {
    ok: value.ok,
    setup: setupStatus(value.setup),
    ...(projectedSession ? { session: projectedSession } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  };
}

export function runInboxZeroSetup(
  scope: Pick<RuntimeAgentScope, "userId">,
  input: InboxZeroSetupInput,
): Promise<Record<string, unknown>> {
  return withInboxZeroStackLease(scope, `user-setup:${input.action}`, async () => {
    const value = record(await callRuntimeAgentService(
      "inbox-zero-stack",
      "/v1/setup",
      scopedAgentRequest(scope, { input }),
      { timeoutMs: input.action === "start" ? 6 * 60_000 : 3 * 60_000 },
    ));
    if (!value || typeof value.ok !== "boolean" || !value.setup) {
      throw new Error("Inbox Zero returned an invalid setup result.");
    }
    const setup = setupStatus(value.setup);
    if (input.action === "save_oauth") {
      return {
        ok: value.ok,
        restartRequired: value.restartRequired === true,
        setup,
      };
    }
    if (input.action === "start") {
      const states = new Set([
        "running",
        "starting",
        "stopped",
        "docker_unavailable",
        "not_installed",
      ]);
      const state = states.has(String(value.state)) ? String(value.state) : "stopped";
      const reason = value.reason === null ? null : boundedString(value.reason, 2_048);
      const log = boundedString(value.log, 8_000);
      if (reason === null && value.reason !== null || log === null) {
        throw new Error("Inbox Zero returned an invalid start result.");
      }
      return { ok: value.ok, state, reason, log, setup };
    }
    if (input.action === "disconnect") {
      const revoked = Number(value.revoked);
      if (!Number.isSafeInteger(revoked) || revoked < 0) {
        throw new Error("Inbox Zero returned an invalid disconnect result.");
      }
      return { ok: value.ok, revoked, setup };
    }
    return { ok: value.ok, setup };
  });
}
