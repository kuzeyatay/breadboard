import type { HermesSurface } from "./config.ts";
import { isClickyRequest } from "../clicky/intent.ts";

export const BREADBOARD_USE_SKILL = "breadboard-use";
const ACTION = /\b(?:open|close|dismiss|exit|end|stop|switch|navigate|go|click|press|type|fill|scroll|select|search|use|control|operate)\b/i;
const SURFACE = /\b(?:breadboard|garden|voice\s+(?:assistant|mode|chat|conversation)|browser|new\s+tab)\b/i;
const FOREIGN_BROWSER = /\b(?:Chrome|Firefox|Safari|Edge|Chromium)\b/i;
const DISCUSSION = /^(?:what|why|how\s+(?:do|does|can)|explain|describe|compare|write|build|implement|add)\b/i;
const FOLLOW_UP = /^(?:(?:now|then|next|and|please)\s+)*(?:click|press|type|fill|scroll|select|close|switch|navigate)\b/i;
const UI_ACTION = /\b(?:open|close|dismiss|exit|end|stop|switch|navigate|go|click|press|type|fill|scroll|select|use|control|operate)\b/i;
const PROFILE_TARGET = /\b(?:profile(?:\s+page)?|(?:breadboard|my|the)\s+settings|startup\s+(?:sound|chime)|browser\s+navigation|navbar|clap\s+(?:controls|action|sensitivity)|(?:finger[- ]?)?snap\s+(?:controls|action|sensitivity)|read\s+aloud\s+notifications|always[- ]on\s+voice\s+assistant|automatic\s+theme|sunrise\s+to\s+sunset|review\s+(?:delivery|questions|recall))\b/i;
const PROFILE_ACTION = /\b(?:open|access|show|list|read|inspect|check|turn|switch|toggle|enable|disable|mute|unmute|set|change|adjust|update|save|close|stop)\b/i;

function profileSettingsRequest(text: string): boolean {
  const request = text.replace(/^(?:(?:please[, ]*|(?:can|could|would)\s+you\s+))+/i, "").trim();
  if (!PROFILE_TARGET.test(request) || /["“”`]|\b(?:don't|do not|never|not now|tomorrow)\b/i.test(request) ||
    /^(?:if|when|once|after|later|explain|describe|write|build|implement|add)\b/i.test(request) ||
    /\b(?:windows|macos|android|ios|chrome|firefox|safari|edge)\s+(?:profile|settings)\b/i.test(request)) return false;
  return PROFILE_ACTION.test(request) || /^(?:what|which)\b.*\b(?:on|off|enabled|disabled|settings|switches)\b/i.test(request);
}

export function breadboardUseCommandText(input: {
  text: string; surface: HermesSurface; authenticated: boolean;
  priorMessages?: ReadonlyArray<{ role: string; content: string }>;
}): { text: string; automatic: boolean } {
  const text = input.text.trim();
  const available = input.authenticated && ["dashboard_terminal", "garden_chat"].includes(input.surface);
  if (available && !text.startsWith("/") && profileSettingsRequest(text)) {
    return { text: `/${BREADBOARD_USE_SKILL} ${input.text}`, automatic: true };
  }
  // Screen guidance belongs to Clicky even when it concerns Chrome or another
  // app. Keep the whole request for Hermes, including any follow-on question.
  if (available && isClickyRequest(text)) {
    return { text: `/${BREADBOARD_USE_SKILL} ${input.text}`, automatic: true };
  }
  const recent = input.priorMessages?.slice(-6).some(m =>
    (m.role === "assistant" && /\bbreadboard[_-]use\b/i.test(m.content)) ||
    (m.role === "user" && (profileSettingsRequest(m.content) ||
      (UI_ACTION.test(m.content) && SURFACE.test(m.content) && !FOREIGN_BROWSER.test(m.content) && !DISCUSSION.test(m.content)))));
  const automatic = Boolean(available && text && !text.startsWith("/") && !DISCUSSION.test(text) &&
    (!FOREIGN_BROWSER.test(text) || /\bbreadboard\b/i.test(text)) &&
    ((ACTION.test(text) && SURFACE.test(text) && (UI_ACTION.test(text) || /\bbrowser\b/i.test(text))) ||
      (recent && (FOLLOW_UP.test(text) || /^(?:(?:now|then|next|and|please)\s+)*(?:turn|enable|disable|toggle|set|adjust)\b/i.test(text)))));
  return { text: automatic ? `/${BREADBOARD_USE_SKILL} ${input.text}` : input.text, automatic };
}
