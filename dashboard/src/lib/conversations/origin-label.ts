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
