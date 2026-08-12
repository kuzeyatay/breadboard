export type PermissionDecision = "once" | "always" | "reject";

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
