// The God's Eye agent's chat identity: the command that reaches it and the
// parsing of a message into a tasking brief.
//
// A run aims the cloned God's Eye View globe — bilawalsidhu/gods-eye-view, a
// photorealistic 3D Earth with live aircraft, ships, satellites, earthquakes
// and public cameras — at whatever the message asks to see, and answers with
// that view framed in the chat. The message is the whole brief: the place, the
// mood ("thermal", "night vision"), and how wide to look.
//
// Imported by client components and by API routes, so it stays free of
// server-only imports.

export const GODS_EYE_COMMAND = "/agents:gods-eye";
export const GODS_EYE_AGENT_ID = "gods-eye";
export const GODS_EYE_AGENT_NAME = "God's Eye";

export function godsEyeUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed ? `${GODS_EYE_COMMAND} ${trimmed}` : GODS_EYE_COMMAND;
}

/**
 * Extract the brief, preserving any other slash tokens the user stacked in
 * front of the command so the capability resolver still sees them and can
 * refuse the combination in the words every surface uses.
 */
export function taskFromGodsEyeCommand(value: string): string | null {
  let remaining = value.trim();
  const precedingTokens: string[] = [];
  let selected = false;
  while (remaining.startsWith("/")) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(remaining);
    if (!match) break;
    if (match[1].toLowerCase() === "agents:gods-eye") {
      selected = true;
    } else {
      precedingTokens.push(`/${match[1]}`);
    }
    remaining = remaining.slice(match[0].length).trimStart();
  }
  if (!selected) return null;
  return [...precedingTokens, remaining].filter(Boolean).join(" ").trim();
}

/** The label a card and a transcript keep for a run. */
export function godsEyeRunLabel(task: string): string {
  const trimmed = task.trim();
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed;
}
