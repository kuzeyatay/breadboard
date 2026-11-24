import type { HermesSurface } from "../hermes/config.ts";

export interface ConversationOrigin {
  surface: HermesSurface;
  gardenName?: string | null;
  historySurface?: string | null;
}

/** Display-only provenance: renaming a chat never edits its source. */
export function conversationOriginLabel(origin: ConversationOrigin): string {
  const surface = origin.surface === "dashboard_terminal"
    ? "Terminal"
    : origin.surface === "quartz_ai"
      ? "Page AI"
      : origin.historySurface === "assistant"
        ? "Assistant"
        : "Workspace";
  return [origin.gardenName?.trim(), surface].filter(Boolean).join(": ");
}

/** Bread inside the Code tab's VS Code: its chats read "Code: <title>" in the Terminal. */
export const CODE_ORIGIN_LABEL = "Code";

/** Turn context for a chat started from VS Code, so Bread answers as the coding assistant it is there. */
export function codeOriginPrompt(originLabel: string | null | undefined): string {
  return originLabel === CODE_ORIGIN_LABEL
    ? "The user is talking to you from Bread inside VS Code (Breadboard's Code tab). Treat the conversation as being about code and the repository open there: answer as a coding assistant, with code blocks, file paths and concrete changes."
    : "";
}

/** Messaging titles already identify their source in the terminal history. */
export function conversationDisplayTitle(title: string, originLabel?: string): string {
  if (
    (!originLabel || ["Terminal", "Telegram", "WhatsApp"].includes(originLabel)) &&
    /^(?:Telegram|WhatsApp)(?:\s*[:·]|$)/i.test(title)
  ) {
    return title;
  }
  return `${originLabel ? `${originLabel}: ` : ""}${title}`;
}
