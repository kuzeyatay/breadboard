// Select the screen companion for an actual request, without consuming any
// part of the user's message. Hermes still interprets the complete request.
const REQUEST_PREFIX = /^(?:(?:hey\s+)?hermes[,!:]?\s+)?(?:please[,!:]?\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:please[,!:]?\s+)?/i;
const NEGATED = /\b(?:don['’]?t|do\s+not|never|without|avoid|stop|cancel|close|disable)\b/i;
const DEFERRED = /\b(?:if|when|after|later|tomorrow|tonight|next\s+(?:time|week|month)|in\s+\d+\s+(?:minutes?|hours?|days?))\b/i;
const NAMED_REQUEST = /^(?:(?:launch|open|start|run|use|activate|bring\s+up)(?:\s+up)?\s+(?:the\s+)?clicky\b|(?:ask|get)\s+clicky\s+to\b|have\s+clicky\s+(?:help|show|explain|guide)\b|(?:i\s+(?:want|need|would\s+like)|i['’]d\s+like)\s+(?:(?:you\s+)?to\s+(?:launch|open|start|run|use)\s+)?clicky\b)/i;
const CLICKY_ARTIFACT = /\bclicky(?:['’]s)?\s+(?:source|code|repo(?:sitory)?|project|folder|file|tests?|docs?|documentation|website|settings|button|analytics)\b/i;
const COMPANION_REQUEST = /^(?:launch|open|start|use|bring\s+up)\s+(?:(?:a|the|my)\s+)?(?:(?:floating\s+)?screen[ -](?:aware\s+)?(?:companion|helper|assistant)|floating\s+companion)\b/i;
const SCREEN_GUIDANCE = /^(?:help\s+me\s+(?:understand|with)|explain(?:\s+to\s+me)?|walk\s+me\s+through|guide\s+me\s+through)\s+(?:what(?:['’]s|\s+is)\s+(?:currently\s+)?on\s+my\s+screen|(?:this|the)\s+(?:app|window|dialog)\s+on\s+my\s+screen)\b/i;
const CLICK_GUIDANCE = /^(?:show|tell)\s+me\s+(?:where|what)\s+to\s+click\b[^.!?]{0,100}\b(?:on\s+my\s+screen|in\s+this\s+(?:app|window|dialog))\b/i;

export function isClickyRequest(value: string): boolean {
  const text = value.trim();
  if (!text || text.startsWith("/") || NEGATED.test(text) || DEFERRED.test(text)) return false;
  const request = text.replace(REQUEST_PREFIX, "");
  return (NAMED_REQUEST.test(request) && !CLICKY_ARTIFACT.test(request)) || COMPANION_REQUEST.test(request) ||
    SCREEN_GUIDANCE.test(request) || CLICK_GUIDANCE.test(request);
}
