// Waking the on-demand agent runtime for unattended surfaces.
//
// Hermes is an on-demand Runtime V2 service with a short idle TTL. The browser
// keeps it alive as a side effect of the supervisor lease every session holds,
// but the messaging gateways (Telegram, WhatsApp) run in trusted service
// processes that are deliberately not given the supervisor control capability —
// so a message arriving after Hermes idled out used to die in `createSession`
// with `runtime_unavailable`. This module gives every unattended inbound path
// one best-effort call that makes sure the runtime is running before a turn is
// attempted:
//
// - In a process that holds supervisor control (the dashboard), it acquires a
//   Hermes lease directly and holds it on a sliding timer, so back-to-back
//   messages reuse one lease instead of churning the supervisor.
// - In a gateway process it asks the dashboard to do that over the loopback
//   internal URL, authenticated with the gateway's own service token — the same
//   shared secret the dashboard already uses to call into the gateway, so no
//   new credential is minted and the gateway still cannot reach the supervisor.
// - Anywhere else (dev stacks that launch Hermes themselves) it is a no-op.
//
// Lease acquisition blocks until the supervisor reports the service ready, so a
// successful wake also doubles as "Hermes is up now".

import { readHermesConfig } from "../hermes/config.ts";
import {
  acquireServiceLease,
  isSupervisorControlConfigured,
  releaseSupervisorLease,
  type SupervisorLease,
} from "../supervisor-control.ts";

/**
 * How long a wake keeps its lease. Longer than the messaging turn ceiling
 * (5 minutes), and the service's own idle TTL still runs after release, so a
 * turn that starts near the end of the hold cannot lose its runtime.
 */
const WAKE_HOLD_MS = 10 * 60_000;

/** Ceiling for the proxied wake call: the supervisor's own lease-acquire
 * control timeout (4 minutes, covering a cold service start) plus margin. */
const WAKE_REQUEST_TIMEOUT_MS = 4 * 60_000 + 30_000;

const MIN_TOKEN_BYTES = 32;

let held: { lease: SupervisorLease; timer: NodeJS.Timeout } | null = null;
let acquiring: Promise<boolean> | null = null;

/**
 * Dashboard-side wake: acquire (or extend) the shared Hermes lease. Returns
 * false in an unsupervised environment where there is no lease to take.
 * Concurrent callers share one acquisition.
 */
export async function holdAgentRuntimeLease(reason: string): Promise<boolean> {
  if (held) {
    held.timer.refresh();
    return true;
  }
  if (acquiring) return acquiring;
  acquiring = (async () => {
    try {
      const lease = await acquireServiceLease("hermes", reason);
      if (!lease) return false;
      const timer = setTimeout(() => {
        const current = held;
        held = null;
        if (current) void releaseSupervisorLease(current.lease);
      }, WAKE_HOLD_MS);
      timer.unref();
      held = { lease, timer };
      return true;
    } finally {
      acquiring = null;
    }
  })();
  return acquiring;
}

/**
 * The gateway's own service token doubles as the wake credential: the
 * supervisor hands the same secret to the dashboard (to call the gateway) and
 * to the gateway (to authenticate callers), so the dashboard can verify it
 * without any new configuration. Each gateway only ever holds its own token.
 */
function gatewayServiceToken(): string | null {
  for (const name of [
    "BREADBOARD_TELEGRAM_GATEWAY_TOKEN",
    "BREADBOARD_WHATSAPP_GATEWAY_TOKEN",
  ] as const) {
    const token = process.env[name]?.trim() ?? "";
    if (Buffer.byteLength(token, "utf8") >= MIN_TOKEN_BYTES) return token;
  }
  return null;
}

/**
 * Make sure the agent runtime is running before an unattended turn. Best
 * effort and never throws: on failure the turn proceeds and reports the
 * runtime error through its existing path. Returns false only when a wake was
 * actually attempted and failed.
 */
export async function wakeAgentRuntime(reason: string): Promise<boolean> {
  try {
    if (isSupervisorControlConfigured()) {
      return await holdAgentRuntimeLease(reason);
    }
    const token = gatewayServiceToken();
    // No supervisor and no gateway credential: an unsupervised dev stack where
    // Hermes is launched externally and there is nothing to wake.
    if (!token) return true;
    const response = await fetch(
      `${readHermesConfig().dashboardInternalUrl}/api/internal/agent-runtime-wake`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason }),
        signal: AbortSignal.timeout(WAKE_REQUEST_TIMEOUT_MS),
        cache: "no-store",
      },
    );
    return response.ok;
  } catch (error) {
    console.error(
      "[agent-runtime] wake failed",
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}
