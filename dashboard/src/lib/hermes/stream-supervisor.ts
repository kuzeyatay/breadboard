// Decision logic for the server-owned event pump's supervision timer, kept
// pure so it can be tested without a database or a live runtime.
//
// Three failures are invisible from inside the upstream subscription itself,
// because all of them look exactly like a turn that is simply still thinking:
//
//   1. The turn was re-dispatched onto a replacement runtime session, so the
//      subscription is bound to a session that will never emit again.
//   2. The runtime accepted the turn and then went silent.
//   3. The runtime streamed part of a turn and then stopped answering at all.
//
// The pump polls this on an interval and acts on the returned decision.

/** How often the pump re-evaluates the decision below. */
export const STREAM_SUPERVISOR_POLL_MS = 1_000;

/**
 * How long an event pump may wait for the matching message POST to create its
 * durable run. In development, Next can cold-compile the events and messages
 * routes independently; fifteen seconds was shorter than a normal cold start
 * and let the stream close just before the accepted run appeared.
 */
export const PRE_DISPATCH_STREAM_TIMEOUT_MS = 120_000;

/**
 * A submitted run that has produced no event at all is stuck. The browser
 * applies its own friendlier 90s first-activity timeout, so this bound is
 * deliberately looser: an attached client wins the race and reports the nicer
 * message, while pumps with no viewer (scheduled chats, WhatsApp) still
 * terminate instead of hanging forever.
 */
export const SILENT_STREAM_TIMEOUT_MS = 120_000;

/**
 * How long a turn that has already streamed may go completely quiet.
 *
 * The Hermes adapter polls the durable turn result whenever the live stream is
 * idle and republishes a `busy` status every ten seconds for as long as the
 * runtime says the turn is running, so quiet here does not mean "a slow tool"
 * — it means the runtime has stopped answering about this turn at all. The one
 * exception is a pending approval, which is deliberately silent while it waits
 * for a person, and which `awaitingPermission` excludes.
 */
export const RUNTIME_INACTIVITY_TIMEOUT_MS = 180_000;

/**
 * The same bound for a turn parked on an approval. Hermes expires an
 * unanswered approval in about five minutes and then resumes the turn with a
 * refusal, so this only ever fires if the runtime forgot the turn while a
 * request was outstanding — the one case where waiting for a person would
 * otherwise mean waiting forever.
 */
export const PERMISSION_WAIT_TIMEOUT_MS = 900_000;

export type StreamSupervisorDecision =
  | { kind: "rebind" }
  | { kind: "silent_timeout" }
  | { kind: "inactivity_timeout" };

export interface RuntimeIdentityFields {
  runtimeKind: string;
  externalSessionId: string;
  liveSessionId?: string | undefined;
}

/**
 * Identity of the runtime session a subscription is bound to. `liveSessionId`
 * participates because a restarted runtime can reissue the same durable
 * external id against a new live session.
 */
export function runtimeIdentityKey(session: RuntimeIdentityFields): string {
  return `${session.runtimeKind}:${session.externalSessionId}:${session.liveSessionId ?? ""}`;
}

export function streamSupervisorDecision(input: {
  /** Identity the current upstream subscription was opened against. */
  boundIdentity: string;
  /** Identity the durable row carries now, or null if it is unreadable. */
  currentIdentity: string | null;
  /** True once any event has arrived from the runtime on this turn. */
  sawRuntimeEvent: boolean;
  /** True once the prompt has actually been handed to the runtime. */
  submitted: boolean;
  /** Time since the pump opened its first subscription. */
  elapsedMs: number;
  /** True once the turn has been persisted; supervision stops after that. */
  finalized: boolean;
  /** True once a silent timeout has already been raised. */
  timedOut: boolean;
  /** Time since the last runtime event, once any has arrived. */
  msSinceLastEvent?: number;
  /** True while a permission request is outstanding, which is silent by design. */
  awaitingPermission?: boolean;
}): StreamSupervisorDecision | null {
  if (input.finalized) return null;

  // Rebinding takes priority over the timeout: a replaced identity explains the
  // silence and is recoverable, so adopt it rather than failing the turn.
  if (input.currentIdentity && input.currentIdentity !== input.boundIdentity) {
    return { kind: "rebind" };
  }

  if (input.timedOut) return null;
  // An unsubmitted run has its own 15s dispatch deadline; expiring it here
  // would race that and misreport a slow dispatch as a dead runtime.
  if (!input.submitted) return null;

  if (input.sawRuntimeEvent) {
    // A turn waiting on a person is not a turn that stopped working, so it is
    // held to the far looser approval bound instead.
    const quietFor = input.msSinceLastEvent ?? 0;
    const bound = input.awaitingPermission
      ? PERMISSION_WAIT_TIMEOUT_MS
      : RUNTIME_INACTIVITY_TIMEOUT_MS;
    return quietFor < bound ? null : { kind: "inactivity_timeout" };
  }

  if (input.elapsedMs < SILENT_STREAM_TIMEOUT_MS) return null;
  return { kind: "silent_timeout" };
}
