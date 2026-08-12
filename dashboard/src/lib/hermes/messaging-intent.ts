import type { HermesSurface } from "./config.ts";

// "Send this to my WhatsApp" has to select the send-to-my-phone skill, because a
// skill is only in scope for a turn that invoked it — and nobody types
// `/send-to-my-phone`. This module decides when a plain sentence counts as that
// invocation.
//
// The bar is an *instruction to send*, not a mention of a messaging app. A chat
// about the WhatsApp integration itself says "whatsapp" constantly and must not
// have its turn quietly bound to this skill, so a bare app name never fires:
// there has to be a delivery verb aimed at the user's own account.

/** send / text / forward … <something> … to my whatsapp|telegram|phone. */
const SEND_TO_CHANNEL =
  /\b(?:send|sent|text|message|msg|forward|share|shoot|push|deliver|drop|post)\b[\s\S]{0,120}?\b(?:to|on|onto|over|via|through|into)\s+(?:my|our|the)?\s*(?:whats\s?app|telegram|phone|mobile)\b/i;

/**
 * "whatsapp me this", "telegram this to me", "text me that", "text this to me".
 * `text` and `msg` are included as verbs on their own because they only ever
 * mean a phone message; `send … to me` deliberately is not, since in a chat the
 * user is already reading, that usually means "show me".
 */
const CHANNEL_AS_VERB =
  /\b(?:whats\s?app|telegram)\s+(?:me|this|that|it)\b|\btext\s+me\b|\b(?:text|msg)\s+(?:this|that|it)\s+to\s+me\b|\bmessage\s+me\s+(?:this|that|it)\b/i;

/**
 * Reports of a send that already happened, and questions about the feature
 * rather than requests to use it. Both look like the patterns above and are the
 * two ways this misfires in practice.
 */
const NOT_A_REQUEST =
  /\b(?:i|we)\s+(?:just\s+|already\s+)?(?:sent|texted|messaged|forwarded|shared)\b|\b(?:can|could|does|do|is|are|how\s+do)\b[\s\S]{0,40}\b(?:breadboard|you|it|this app)\b[\s\S]{0,40}\b(?:able to|support|handle)\b/i;

/** The assistant asked which app to use; a short answer is still the same errand. */
const AWAITING_CHANNEL_CHOICE =
  /\b(?:which (?:one|app|app should i use)|whatsapp or telegram|telegram or whatsapp|shall i send it to|send it to which)\b/i;

const SHORT_CHANNEL_REPLY =
  /^(?:(?:yes|yep|yeah|sure|ok|okay|please|go ahead|do it)\b[\s\S]{0,60}|(?:whats\s?app|telegram|both|either)\b[\s\S]{0,60})$/i;

function isChannelChoiceReply(input: {
  text: string;
  priorMessages?: ReadonlyArray<{ role: string; content: string }>;
}): boolean {
  const latestAssistant = [...(input.priorMessages ?? [])]
    .reverse()
    .find((message) => message.role === "assistant")
    ?.content.trim();
  if (!latestAssistant) return false;
  return (
    AWAITING_CHANNEL_CHOICE.test(latestAssistant) &&
    SHORT_CHANNEL_REPLY.test(input.text.trim())
  );
}

export function messagingCommandText(input: {
  text: string;
  surface: HermesSurface;
  authenticated: boolean;
  priorMessages?: ReadonlyArray<{ role: string; content: string }>;
}): { text: string; automatic: boolean } {
  const text = input.text.trim();
  const available =
    input.authenticated &&
    (input.surface === "dashboard_terminal" || input.surface === "garden_chat");
  const automatic =
    available &&
    Boolean(text) &&
    // A turn that already selected a skill keeps it: only one may run per turn,
    // so a second prefix would be rejected outright.
    !text.startsWith("/") &&
    !NOT_A_REQUEST.test(text) &&
    (
      SEND_TO_CHANNEL.test(text) ||
      CHANNEL_AS_VERB.test(text) ||
      isChannelChoiceReply({ text, priorMessages: input.priorMessages })
    );
  return {
    text: automatic ? `/send-to-my-phone ${input.text}` : input.text,
    automatic,
  };
}
