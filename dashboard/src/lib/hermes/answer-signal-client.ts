// The browser's side of answer signals.
//
// Explicit ratings report write failures to the feedback control. Incidental
// signals such as copying an answer are best-effort.

export type AnswerRating = "rated_up" | "rated_down";
export type AnswerSignalKind =
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

export function addressable(target: SignalTarget): target is {
  conversationId: string;
  messageId: string;
} {
  return Boolean(target.conversationId?.trim() && target.messageId?.trim());
}

function postSignal(target: SignalTarget, kind: AnswerSignalKind | AnswerRating, reason?: AnswerSignalReason) {
  return fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...target, kind, reason }),
  });
}

export async function recordAnswerSignal(
  target: SignalTarget,
  kind: AnswerSignalKind,
): Promise<void> {
  if (addressable(target)) await postSignal(target, kind).catch(() => {});
}

export async function saveAnswerRating(
  target: SignalTarget,
  rating: AnswerRating | null,
  reason?: AnswerSignalReason,
): Promise<void> {
  if (!addressable(target)) throw new Error("Missing answer ID.");
  const response = rating
    ? await postSignal(target, rating, reason)
    : await fetch(`${ENDPOINT}?${new URLSearchParams(target)}`, { method: "DELETE" });
  if (!response.ok || (await response.json()).rating !== rating) {
    throw new Error("Could not save feedback.");
  }
}

export async function fetchAnswerRating(
  target: SignalTarget,
): Promise<AnswerRating | null> {
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
