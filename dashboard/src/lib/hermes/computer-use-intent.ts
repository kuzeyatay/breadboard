// Automatic selection for tasks that ask Breadboard to operate a graphical
// desktop application. Selection supplies the operating contract; it does not
// force a computer_use call. The skill still prefers APIs, connected services,
// filesystem/terminal operations, and purpose-built browser tools first.

import type { HermesSurface } from "./config.ts";

export const COMPUTER_USE_SKILL = "computer-use";

const GUI_ACTION =
  /\b(?:click|double[ -]?click|right[ -]?click|drag|drop|scroll|type|enter|fill(?:\s+in|\s+out)?|select|choose|press|toggle|check\s+(?:the\s+)?(?:box|checkbox)|uncheck|open|close|dismiss|move|resize|rename)\b/i;
const DESKTOP_OBJECT =
  /\b(?:my\s+)?(?:computer|desktop|screen|window|dialog|menu|taskbar|dock|system\s+(?:settings|preferences)|control\s+panel|native\s+app(?:lication)?|desktop\s+app(?:lication)?)\b/i;
const NAMED_DESKTOP_APP =
  /\b(?:Excel|Word|PowerPoint|Outlook|OneNote|Finder|File\s+Explorer|Windows\s+Explorer|System\s+Settings|Settings\s+app|Photoshop|Illustrator|Premiere|Figma\s+Desktop|Obsidian|Notepad|TextEdit|Calculator|Terminal|iTerm|Visual\s+Studio|VS\s+Code|Slack\s+app|Discord\s+app)\b/i;
const EXPLICIT_CONTROL =
  /\b(?:use|take\s+over|control|operate|drive|interact\s+with)\b[^.!?]{0,45}\b(?:computer|desktop|screen|app(?:lication)?|window)\b/i;
const ACTION_IN_APP =
  /\b(?:click|double[ -]?click|right[ -]?click|drag|drop|scroll|type|enter|fill(?:\s+in|\s+out)?|select|choose|press|toggle|check\s+(?:the\s+)?(?:box|checkbox)|uncheck|open|close|dismiss|move|resize|rename)\b[^.!?]{0,90}\b(?:in|inside|within|on)\b[^.!?]{0,45}\b(?:app(?:lication)?|window|dialog)\b/i;
const BROWSER_ROUTE =
  /\b(?:browser|website|web\s*page|web\s+app|Chrome|Chromium|Firefox|Safari|Edge|URL|https?:\/\/|www\.)\b/i;
const DISCUSSION_ONLY =
  /\b(?:what\s+is|what'?s|how\s+does|does\s+Hermes|can\s+Hermes|support(?:s|ed)?|explain|documentation|docs|compare|difference|pros?\s+and\s+cons?)\b[^.!?]{0,90}\b(?:computer[ -]?use|desktop\s+(?:control|automation)|cua-driver)\b/i;
const FOLLOW_UP_ACTION =
  /^(?:(?:now|then|next|and|please)\s+)*(?:click|double[ -]?click|right[ -]?click|drag|drop|scroll|type|enter|fill|select|choose|press|toggle|check\s+(?:the\s+)?(?:box|checkbox)|uncheck|open|close|dismiss|move|resize|rename)\b/i;
const COMPUTER_USE_CONTEXT = /(?:\/computer-use\b|\bcomputer_use\b|Hermes background computer use)/i;

function recentlyUsedComputerUse(
  messages: ReadonlyArray<{ role: string; content: string }> | undefined,
): boolean {
  return (messages ?? [])
    .slice(-8)
    .some(
      (message) =>
        message.role === "assistant" && COMPUTER_USE_CONTEXT.test(message.content),
    );
}

export interface ComputerUseIntentInput {
  text: string;
  surface: HermesSurface;
  authenticated: boolean;
  priorMessages?: ReadonlyArray<{ role: string; content: string }>;
}

export function shouldAutoSelectComputerUse(
  input: ComputerUseIntentInput,
): boolean {
  const text = input.text.trim();
  const available =
    input.authenticated &&
    (input.surface === "dashboard_terminal" || input.surface === "garden_chat");
  if (!available || !text || text.startsWith("/") || DISCUSSION_ONLY.test(text)) {
    return false;
  }

  if (FOLLOW_UP_ACTION.test(text) && recentlyUsedComputerUse(input.priorMessages)) {
    return true;
  }

  const explicitDesktop = EXPLICIT_CONTROL.test(text) || DESKTOP_OBJECT.test(text);
  // A normal web interaction belongs to the browser runtime. An explicit
  // request to control the desktop still selects this skill, whose guidance
  // will try that browser runtime before touching the GUI.
  if (BROWSER_ROUTE.test(text) && !explicitDesktop) return false;

  return (
    EXPLICIT_CONTROL.test(text) ||
    (GUI_ACTION.test(text) && DESKTOP_OBJECT.test(text)) ||
    (GUI_ACTION.test(text) && NAMED_DESKTOP_APP.test(text)) ||
    ACTION_IN_APP.test(text)
  );
}

export function computerUseCommandText(
  input: ComputerUseIntentInput,
): { text: string; automatic: boolean } {
  const automatic = shouldAutoSelectComputerUse(input);
  return {
    text: automatic ? `/${COMPUTER_USE_SKILL} ${input.text}` : input.text,
    automatic,
  };
}
