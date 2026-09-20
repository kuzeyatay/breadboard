// The browser's side of answer signals.
//
// Every call here is best-effort and silent. A signal is a side observation
// about an answer, never the point of the interaction the user is having: if
// recording that they copied an answer fails, the answer is still on their
// clipboard and nothing should say otherwise. So failures are swallowed, and
// the caller is never made to await one.
//
// `conversationId` and `messageId` are both required for any of this to mean
// anything, and surfaces that cannot supply them (a failure row with no stored
// message, an anonymous Quartz reader) simply do not record. That is why every
// function takes a nullable target and returns early rather than throwing —
// the component calls them unconditionally.

export type AnswerSignalKind =
  | "rated_up"
  | "rated_down"
  | "copied"
  | "spoken"
  | "regenerated"
  | "edited"
  | "retried";

export type AnswerSignalReason = "wrong" | "too_long" | "missed_point" | "style";

export interface SignalTarget {
  conversationId?: string | null;
  messageId?: string | null;
}

const ENDPOINT = "/api/answer-signals";

function addressable(target: SignalTarget): target is {
  conversationId: string;
  messageId: string;
} {
  return Boolean(target.conversationId?.trim() && target.messageId?.trim());
}

/**
 * Record one signal. Returns the rating standing against the answer afterwards,
 * or null when nothing could be recorded — which the caller treats the same as
 * "no rating", because from the user's point of view it is.
 */
export async function recordAnswerSignal(
  target: SignalTarget,
  kind: AnswerSignalKind,
  reason?: AnswerSignalReason | null,
): Promise<"rated_up" | "rated_down" | null> {
  if (!addressable(target)) return null;
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: target.conversationId,
        messageId: target.messageId,
        kind,
        ...(reason ? { reason } : {}),
      }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { rating?: unknown };
    return body.rating === "rated_up" || body.rating === "rated_down" ? body.rating : null;
  } catch {
    return null;
  }
}

export async function clearAnswerRating(target: SignalTarget): Promise<void> {
  if (!addressable(target)) return;
  try {
    const params = new URLSearchParams({
      conversationId: target.conversationId,
      messageId: target.messageId,
    });
    await fetch(`${ENDPOINT}?${params.toString()}`, { method: "DELETE" });
  } catch {
    // The thumb is already off on screen; a failed clear reconciles on reload.
  }
}

export async function fetchAnswerRating(
  target: SignalTarget,
): Promise<"rated_up" | "rated_down" | null> {
  if (!addressable(target)) return null;
  try {
    const params = new URLSearchParams({
      conversationId: target.conversationId,
      messageId: target.messageId,
    });
    const response = await fetch(`${ENDPOINT}?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { rating?: unknown };
    return body.rating === "rated_up" || body.rating === "rated_down" ? body.rating : null;
  } catch {
    return null;
  }
}
