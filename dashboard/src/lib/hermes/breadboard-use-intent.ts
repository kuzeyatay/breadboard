import type { HermesSurface } from "./config.ts";
import { isClickyRequest } from "../clicky/intent.ts";

export const BREADBOARD_USE_SKILL = "breadboard-use";
const ACTION = /\b(?:open|close|dismiss|exit|end|stop|switch|navigate|go|click|press|type|fill|scroll|select|search|use|control|operate)\b/i;
const SURFACE = /\b(?:breadboard|garden|voice\s+(?:assistant|mode|chat|conversation)|browser|new\s+tab)\b/i;
const FOREIGN_BROWSER = /\b(?:Chrome|Firefox|Safari|Edge|Chromium)\b/i;
const DISCUSSION = /^(?:what|why|how\s+(?:do|does|can)|explain|describe|compare|write|build|implement|add)\b/i;
const FOLLOW_UP = /^(?:(?:now|then|next|and|please)\s+)*(?:click|press|type|fill|scroll|select|close|switch|navigate)\b/i;
const UI_ACTION = /\b(?:open|close|dismiss|exit|end|stop|switch|navigate|go|click|press|type|fill|scroll|select|use|control|operate)\b/i;

export function breadboardUseCommandText(input: {
  text: string; surface: HermesSurface; authenticated: boolean;
  priorMessages?: ReadonlyArray<{ role: string; content: string }>;
}): { text: string; automatic: boolean } {
  const text = input.text.trim();
  const available = input.authenticated && ["dashboard_terminal", "garden_chat"].includes(input.surface);
  // Screen guidance belongs to Clicky even when it concerns Chrome or another
  // app. Keep the whole request for Hermes, including any follow-on question.
  if (available && isClickyRequest(text)) {
    return { text: `/${BREADBOARD_USE_SKILL} ${input.text}`, automatic: true };
  }
  const recent = input.priorMessages?.slice(-6).some(m =>
    (m.role === "assistant" && /\bbreadboard[_-]use\b/i.test(m.content)) ||
    (m.role === "user" && UI_ACTION.test(m.content) && SURFACE.test(m.content) && !FOREIGN_BROWSER.test(m.content) && !DISCUSSION.test(m.content)));
  const automatic = Boolean(available && text && !text.startsWith("/") && !DISCUSSION.test(text) &&
    (!FOREIGN_BROWSER.test(text) || /\bbreadboard\b/i.test(text)) &&
    ((ACTION.test(text) && SURFACE.test(text) && (UI_ACTION.test(text) || /\bbrowser\b/i.test(text))) || (recent && FOLLOW_UP.test(text))));
  return { text: automatic ? `/${BREADBOARD_USE_SKILL} ${input.text}` : input.text, automatic };
}
