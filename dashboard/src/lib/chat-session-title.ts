/**
 * Browser helper for chat surfaces whose history is local-only. Canonical
 * conversations run the same title request on the server as part of their
 * first-turn pipeline.
 */
export async function requestChatTitleFromFirstMessage(
  message: string,
  model?: string,
): Promise<string | null> {
  const firstPrompt = message.trim();
  if (!firstPrompt) return null;
  try {
    const response = await fetch("/api/chat-title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstPrompt, model }),
    });
    if (!response.ok) return null;
    const body = await response.json() as { title?: unknown };
    return typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : null;
  } catch {
    return null;
  }
}
