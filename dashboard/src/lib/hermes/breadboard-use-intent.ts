import type { HermesSurface } from "./config.ts";

export const BREADBOARD_USE_SKILL = "breadboard-use";
const ACTION = /\b(?:open|close|dismiss|exit|end|stop|switch|navigate|go|click|press|type|fill|scroll|select|search|use|control|operate)\b/i;
const SURFACE = /\b(?:breadboard|garden|voice\s+(?:assistant|mode|chat|conversation)|browser|new\s+tab)\b/i;
const FOREIGN_BROWSER = /\b(?:Chrome|Firefox|Safari|Edge|Chromium)\b/i;
const DISCUSSION = /^(?:what|why|how\s+(?:do|does|can)|explain|describe|compare|write|build|implement|add)\b/i;
const FOLLOW_UP = /^(?:(?:now|then|next|and|please)\s+)*(?:click|press|type|fill|scroll|select|close|switch|navigate)\b/i;
const UI_ACTION = /\b(?:open|close|dismiss|exit|end|stop|switch|navigate|go|click|press|type|fill|scroll|select|use|control|operate)\b/i;
const PROFILE_TARGET = /\b(?:profile(?:\s+page)?|(?:breadboard|my|the)\s+settings|startup\s+(?:sound|chime)|browser\s+navigation|navbar|clap\s+(?:controls|action|sensitivity)|(?:finger[- ]?)?snap\s+(?:controls|action|sensitivity)|read\s+aloud\s+notifications|always[- ]on\s+voice\s+assistant|automatic\s+theme|sunrise\s+to\s+sunset|review\s+(?:delivery|questions|recall))\b/i;
const PROFILE_ACTION = /\b(?:open|access|show|list|read|inspect|check|turn|switch|toggle|enable|disable|mute|unmute|set|change|adjust|update|save|close|stop)\b/i;

// A site interaction is browser work even when the user never says "browser".
// This selects guidance and tools; it does not authorize an unspecified send.
const ACCOUNT_SITE = /\b(?:whats\s?app|instagram|tiktok|twitter|facebook|linkedin|reddit|telegram)\b|\b(?:on|in|my|use|open)\s+x\b|\bx\.com\b/i;
const ACCOUNT_ACTION = /\b(?:open|visit|use|read|check|inspect|browse|scroll|save|bookmark|like|follow|unfollow|send|message|reply|post|comment|click|type|fill|select|search|submit)\b|\bgo\s+to\b/i;
const ACCOUNT_CONTEXT = /\b(?:signed[ -]in|logged[ -]in|my\s+(?:account|feed|timeline|inbox|messages)|this\s+(?:site|page)|the\s+(?:site|page)|website|web\s+app|browser)\b/i;
// URLs make this independent of the examples above. Public page reading still
// belongs to retrieval; explicit interaction with any web address goes here.
const WEB_ADDRESS = /\bhttps?:\/\/[^\s<>]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,63}(?:[/:][^\s<>]*)?/i;
const WEBSITE_INTERACTION = /\b(?:open|visit|browse|scroll|click|press|type|fill|select|submit|save|bookmark|reply|send|sign\s+in|log\s+in)\b|\bgo\s+to\b/i;
const SELF_DELIVERY = /\b(?:send|text|forward)\b.*\bto\s+my\s+(?:whatsapp|telegram|phone)\b|\b(?:whatsapp|telegram|text|send|forward)\s+me\b/i;

// A reference URL can contain "garden", "browser", or action words without
// requesting app control. Keep link labels, and preserve the original input
// for the model and the explicit website-interaction selector below.
function surfaceProse(text: string): string {
  return text
    .replace(/\[([^\]\r\n]+)\]\((?:[^()\r\n]|\([^()\r\n]*\))*\)/g, "$1")
    .replace(/^ {0,3}\[[^\]\r\n]+\]:\s+\S+.*$/gm, "");
}

function signedInSiteRequest(text: string): boolean {
  const request = text.replace(/^(?:(?:please[, ]*|(?:can|could|would)\s+you\s+))+/i, "").trim();
  if (SELF_DELIVERY.test(request) ||
    /^(?:what|why|how|explain|describe|compare|write|draft|build|implement|add|if|when|once|after|later)\b/i.test(request) ||
    /\b(?:don't|do not|never|tomorrow)\b/i.test(request) ||
    /^(?:search|research|look up)\s+(?:the\s+web|public\s+sources)\b/i.test(request)) return false;
  // Quoted page content is not a command. Quoted message bodies remain valid.
  if (/^["“”`]|\b(?:example|document|page|post)\s+(?:says|reads|said)\b/i.test(request)) return false;
  return (ACCOUNT_ACTION.test(request) && (ACCOUNT_SITE.test(request) || ACCOUNT_CONTEXT.test(request))) ||
    (WEB_ADDRESS.test(request) && WEBSITE_INTERACTION.test(request));
}

function profileSettingsRequest(text: string): boolean {
  const request = text.replace(/^(?:(?:please[, ]*|(?:can|could|would)\s+you\s+))+/i, "").trim();
  if (!PROFILE_TARGET.test(request) || /["“”`]|\b(?:don't|do not|never|not now|tomorrow)\b/i.test(request) ||
    /^(?:if|when|once|after|later|explain|describe|write|build|implement|add)\b/i.test(request) ||
    /\b(?:windows|macos|android|ios|chrome|firefox|safari|edge)\s+(?:profile|settings)\b/i.test(request)) return false;
  return PROFILE_ACTION.test(request) || /^(?:what|which)\b.*\b(?:on|off|enabled|disabled|settings|switches)\b/i.test(request);
}

function screenRecordingRequest(text: string): boolean {
  const request = text.replace(/^(?:(?:please[, ]*|(?:can|could|would)\s+you\s+))+/i, "").trim();
  if (/^(?:what|why|how|explain|describe|compare|write|build|implement|add|make|if|when|once|after|later)\b/i.test(request) ||
    /["“”`]|\b(?:don't|do not|never|tomorrow|code|feature|support)\b/i.test(request)) return false;
  return /\b(?:record|capture)\b.*\b(?:screen|desktop|monitor|window)\b|\b(?:start|stop|finish|save|check)\b.*\b(?:screen|desktop|window)\s+(?:video|recording|capture)\b/i.test(request);
}

export function breadboardUseCommandText(input: {
  text: string; surface: HermesSurface; authenticated: boolean;
  priorMessages?: ReadonlyArray<{ role: string; content: string }>;
}): { text: string; automatic: boolean } {
  const text = input.text.trim();
  const prose = surfaceProse(text);
  const available = input.authenticated && ["dashboard_terminal", "garden_chat"].includes(input.surface);
  if (available && !text.startsWith("/") && screenRecordingRequest(text)) {
    return { text: `/${BREADBOARD_USE_SKILL} ${input.text}`, automatic: true };
  }
  if (available && !text.startsWith("/") && profileSettingsRequest(text)) {
    return { text: `/${BREADBOARD_USE_SKILL} ${input.text}`, automatic: true };
  }
  if (available && !text.startsWith("/") && signedInSiteRequest(text) &&
    (!FOREIGN_BROWSER.test(prose) || /\bbreadboard\b/i.test(prose))) {
    return { text: `/${BREADBOARD_USE_SKILL} ${input.text}`, automatic: true };
  }
  const recent = input.priorMessages?.slice(-6).some(m => {
    const priorProse = surfaceProse(m.content);
    return (m.role === "assistant" && /\bbreadboard[_-]use\b/i.test(priorProse)) ||
    (m.role === "user" && (profileSettingsRequest(m.content) || signedInSiteRequest(m.content) ||
      (UI_ACTION.test(priorProse) && SURFACE.test(priorProse) && !FOREIGN_BROWSER.test(priorProse) && !DISCUSSION.test(priorProse))));
  });
  const automatic = Boolean(available && prose && !text.startsWith("/") && !DISCUSSION.test(prose) &&
    (!FOREIGN_BROWSER.test(prose) || /\bbreadboard\b/i.test(prose)) &&
    ((ACTION.test(prose) && SURFACE.test(prose) && (UI_ACTION.test(prose) || /\bbrowser\b/i.test(prose))) ||
      (recent && !SELF_DELIVERY.test(prose) && (FOLLOW_UP.test(prose) || /^(?:(?:now|then|next|and|please)\s+)*(?:turn|enable|disable|toggle|set|adjust|save|bookmark|reply|send)\b/i.test(prose)))));
  return { text: automatic ? `/${BREADBOARD_USE_SKILL} ${input.text}` : input.text, automatic };
}
