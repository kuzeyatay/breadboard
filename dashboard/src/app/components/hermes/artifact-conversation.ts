"use client";

// Where a newly created artifact hangs.
//
// Every artifact belongs to a conversation. A surface that makes one without
// having a chat open yet — the image studio reached from a social post card,
// for instance — needs somewhere to put it, so it opens a conversation on its
// own surface first. Both studios ask the same question, so they ask it here.

export type ArtifactSurface = "dashboard_terminal" | "garden_chat";

export async function openArtifactConversation(input: {
  surface: ArtifactSurface;
  gardenSlug?: string | null;
  title: string;
}): Promise<string> {
  const response = await fetch("/api/hermes/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      surface: input.surface,
      ...(input.gardenSlug ? { gardenSlug: input.gardenSlug } : {}),
      title: input.title,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    session?: { id?: string };
    error?: string;
  };
  if (!response.ok || !body.session?.id) {
    throw new Error(body.error ?? "The artifact workspace could not be opened.");
  }
  return body.session.id;
}
