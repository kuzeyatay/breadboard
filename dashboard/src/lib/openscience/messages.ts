import type { MessageRecord } from "./client.ts";

/** Compaction notes are internal state, even though their role is assistant. */
export function isResearchAssistant(info: Record<string, unknown> | undefined): boolean {
  return info?.role === "assistant" && info.summary !== true &&
    info.mode !== "compaction" && info.agent !== "compaction";
}

/** Deliver the completed finding, not accumulated tool commentary or handoffs. */
export function finalResearchAnswer(messages: readonly MessageRecord[]): string {
  const message = [...messages].reverse().find(message =>
    isResearchAssistant(message.info) && message.parts?.some(part => part.type === "text" && part.text?.trim()));
  if (!message || message.info?.error || ["tool-calls", "length"].includes(message.info?.finish ?? "") ||
    message.parts?.some(part => part.type === "tool")) return "";
  return (message.parts ?? []).filter(part => part.type === "text")
    .map(part => part.text?.trim()).filter(Boolean).join("\n\n");
}
