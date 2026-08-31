export type PermissionDecision = "once" | "always" | "reject";

export interface ClarificationAnswerResult {
  courseCorrectionTargetClientMessageId?: string;
  courseCorrectionOffset?: number;
  persisted: boolean;
}

/** Answer a mid-turn `clarify` question; the blocked turn resumes on success. */
export async function submitClarificationAnswer(
  requestId: string,
  sessionId: string | number,
  answer: string,
  assistantContentOffset?: number,
): Promise<ClarificationAnswerResult> {
  let response: Response;
  try {
    response = await fetch(
      `/api/hermes/clarifications/${encodeURIComponent(requestId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, answer, assistantContentOffset }),
      },
    );
  } catch {
    throw new Error("The answer could not reach the runtime.");
  }

  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    courseCorrectionTargetClientMessageId?: unknown;
    courseCorrectionOffset?: unknown;
    persisted?: unknown;
  };
  if (!response.ok) {
    throw new Error(body.error ?? "The runtime rejected the answer.");
  }
  return {
    courseCorrectionTargetClientMessageId:
      typeof body.courseCorrectionTargetClientMessageId === "string"
        ? body.courseCorrectionTargetClientMessageId
        : undefined,
    courseCorrectionOffset:
      typeof body.courseCorrectionOffset === "number"
        ? body.courseCorrectionOffset
        : undefined,
    persisted: body.persisted === true,
  };
}

export async function submitPermissionDecision(
  requestId: string,
  sessionId: string | number,
  decision: PermissionDecision,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(
      `/api/hermes/permissions/${encodeURIComponent(requestId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, decision }),
      },
    );
  } catch {
    throw new Error("The permission decision could not reach the runtime.");
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(body.error ?? "The runtime rejected the permission decision.");
  }
}
