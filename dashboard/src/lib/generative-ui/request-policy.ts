import type { GenerativeUiResource } from "./contracts.ts";

const GARDEN_DISPLAY = "(?:gardens?[\\s-]+(?:(?:search|navigation)[\\s-]+)?(?:widget|card|panel|navigator|results)|garden[\\s-]+search[\\s-]+results|found\\s+in\\s+your\\s+gardens)";
const DISPLAY_REQUEST = new RegExp(
  `^(?:(?:and|also|then|now)\\s+)*(?:please\\s+)?(?:(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?|(?:i\\s+(?:want|need|would\\s+like)|i'd\\s+like)\\s+(?:you\\s+to\\s+)?)?(?:show|display|open|include|add|render|use|bring\\s+up)\\s+(?:me\\s+)?(?:(?:a|the|my|our|your)\\s+)?["“]?${GARDEN_DISPLAY}\\b`,
  "i",
);
const TERSE_REQUEST = new RegExp(`^(?:the\\s+)?${GARDEN_DISPLAY}\\s+please$`, "i");
const WANT_REQUEST = new RegExp(
  `^(?:i\\s+(?:want|need|would\\s+like)|i'd\\s+like)\\s+(?:to\\s+see\\s+)?(?:(?:a|the|my|our|your)\\s+)?["“]?${GARDEN_DISPLAY}["”]?(?:\\s+(?:widget|card|panel))?(?:\\s+please)?$`,
  "i",
);
const NEGATED_DISPLAY = /\b(?:do\s+not|don't|dont|never|without|avoid|hide|remove|no)\b[^.!?;\n]{0,100}\b(?:widget|card|panel|navigator|results|found\s+in\s+your\s+gardens)\b/i;

/** Only the person's request may opt in, never retrieval queries or page text. */
export function explicitlyRequestsGardenNavigator(request: string): boolean {
  // Quoted examples and document/code excerpts are data, not display requests.
  const prose = request
    .replace(/’/g, "'")
    .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, " ")
    .replace(/^\s*>.*$/gm, " ")
    .replace(/`[^`\n]*`/g, " ")
    .trim();
  if (NEGATED_DISPLAY.test(prose)) return false;
  return prose.split(/[.!?;\n]+/).some((part) => {
    const clause = part.trim();
    return DISPLAY_REQUEST.test(clause) || TERSE_REQUEST.test(clause) || WANT_REQUEST.test(clause);
  });
}

/** Retrieval remains available as evidence without automatically creating UI. */
export function uiResourcesForUserRequest(
  resources: GenerativeUiResource[] | undefined,
  request: string,
): GenerativeUiResource[] {
  if (!resources) return [];
  if (explicitlyRequestsGardenNavigator(request)) return resources;
  return resources.filter((resource) => resource.kind !== "garden-search");
}
