/**
 * A fresh answer to an earlier question, for regenerating a response that is
 * not the newest one. `history` ends with the user message being re-asked and
 * holds nothing after it; the caller swaps the text into that one answer so
 * every later message stays exactly as it was.
 */
export async function regenerateResponseText(
  history: readonly { role: string; content?: string }[],
  model?: string | null,
): Promise<string> {
  const response = await fetch("/api/chat-regenerate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: history
        .filter((m) => (m.role === "user" || m.role === "assistant") && m.content?.trim())
        .map(({ role, content }) => ({ role, content })),
    }),
  });
  const body = (await response.json().catch(() => null)) as { content?: string; error?: string } | null;
  if (!response.ok || typeof body?.content !== "string") {
    throw new Error(body?.error || "The response could not be regenerated.");
  }
  return body.content;
}
