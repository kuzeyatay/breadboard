import { requestKeywords, requestedActions, actionMatches } from "../hermes/request-language.ts";
import { isDocumentStructureRequest, isTeachingCandidate, preservesLiteralTeachingText } from "../teaching-plan.ts";

/** Identify unresolved user questions for conversation memory; performs no model call. */
export function explanationIntent(request: string, hasSelection = false, context = "") {
  if (isDocumentStructureRequest(request)) return { candidate: false, repair: false };
  const text = requestKeywords(request).trim().replace(/^(?:(?:please|pls|hey|okay|ok|bro|so|but|wait)[,!]?\s+|(?:can|could|would|will) you\s+)*/i, "");
  const action = requestedActions(request).some(item => actionMatches(item,
    /write|rewrite|translate|summari[sz]e|create|build|generate|run|send|delete|save|publish|edit|modify|install|fix|implement|convert|render/));
  const teaching = isTeachingCandidate(request, context);
  if (!text || (action && !teaching) || preservesLiteralTeachingText(request) || /^translate\b/i.test(text) || /^(?:do not|don['’]?t|dont|never)\s+explain\b/i.test(text) || /^(?:thanks|thank you|got it|understood|yes|no|okay|ok)[!.\s]*$/i.test(text)) return { candidate: false, repair: false };
  const correction = /\b(?:what do you mean|you (?:haven['’]?t|have not|didn['’]?t|did not|don['’]?t|do not) explain|(?:i|that|this|it) (?:still )?(?:don['’]?t|doesn['’]?t|do not|does not) (?:understand|follow|make sense)|(?:missing|skipped|skip|skipping) (?:a |the )?(?:step|cause|reason)|explain (?:this|that|it) (?:better|again|properly)|how (?:did|do) you (?:get|go) from|you can['’]?t just say|you cant just say)\b/i.test(text);
  const question = /^(?:(?:in|for|under|to|with|about|from|at)\s+)?(?:what|why|how|where|when|which|does|do|is|are|can|could|would|should)\b/i.test(text) || text.includes("?");
  const confusion = /\b(?:makes? no sense|(?:i['’]?m|i am) (?:lost|confused)|that (?:doesn['’]?t|does not) follow|first principles)\b/i.test(text);
  const restatement = /^(?:basically|in other words|you(?:'re|’re| are) saying|that means|this means)\b/i.test(text);
  const candidate = teaching || hasSelection || correction || confusion || question || restatement || /^(?:cover|teach|explain|describe|help me understand|walk me through|i (?:still )?(?:don['’]?t|dont|do not) understand)\b/i.test(text);
  return { candidate, repair: candidate && (correction || confusion || restatement || hasSelection || /^(?:why|how)[?!.\s]*$/i.test(text)) };
}

