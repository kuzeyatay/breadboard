import { createHash } from "node:crypto";
import { requestKeywords } from "./hermes/request-language.ts";
import { dropMismatchedJsonClosers, parseJsonObjectResponse } from "./learn-utils.ts";

export const TEACHING_PLAN_VERSION = "reader-progression-v5";
export interface TeachingStep {
  id: string;
  buildsOn: string[];
  establishes: string;
  workedUse: string;
  transition: string;
}
export interface TeachingPlan {
  version: typeof TEACHING_PLAN_VERSION;
  /** Older plans default to lesson review; new plans classify the requested depth. */
  scope?: "focused-answer" | "lesson";
  objective: string;
  background: string[];
  /** Retrieved pages explicitly established as the reader's prior lessons. */
  priorLessonPageIds?: string[];
  constraints: string[];
  requiredCoverage: string[];
  steps: TeachingStep[];
}

/** These checks select an editorial pass, never authorize tools or edits. */
export function preservesLiteralTeachingText(request: string): boolean {
  const text = requestKeywords(request);
  // Preserving a quotation inside a new explanation is not an exact-copy task.
  const authorsExplanation = (/\b(?:enrich|harmonize|teach|explain|rewrite|revise)\b/i.test(text) ||
    /\bI\s+(?:authorize|request)\s+(?:a\s+)?(?:full|whole|complete)[- ]body\s+(?:revision|rewrite)\b/i.test(text)) &&
    !/^\s*(?:please\s+)?(?:translate|copy|export|save)\b/i.test(text) &&
    !/\b(?:do not|don['’]?t|dont|never)\s+(?:explain|rewrite|revise)\b/i.test(text);
  if (authorsExplanation) return false;
  return /\b(?:verbatim|word.for.word|without (?:any )?(?:changes|rewriting)|(?<!almost\s)exactly as (?:written|provided|is))\b/i.test(text) ||
    /^\s*(?:please\s+)?(?:translate|copy|export)\b/i.test(text) ||
    /^\s*(?:please\s+)?save\s+(?:this|that|it|the (?:file|note|text|answer|response))\s*(?:[.!]|$|as\b|in\b|to\b)/i.test(text) ||
    /^\s*create (?:a )?(?:new )?(?:markdown|note|file) (?:with|from) (?:this|that|it)\s*[.!]?$/i.test(text);
}

export function isTeachingCandidate(request: string, context = ""): boolean {
  if (preservesLiteralTeachingText(request) || isDocumentStructureRequest(request)) return false;
  const text = requestKeywords(request);
  if (/\b(?:do not|don['’]?t|dont|never) explain\b/i.test(text)) return false;
  const subject = /\b(?:explain|explanation|learn|learning|teach|teaching|understand|lesson|textbook|prerequisite|beginner|concepts?|tutorial|definitions?|derivation|rigou?r|introduction|viewpoints?)\b/i;
  if (/\b(?:create|render|generate)\b.*\b(?:image|video|visualization)\b/i.test(text)) return false;
  if (subject.test(text)) return true;
  return /^(?:why|how|what)\b/i.test(text.trim()) ||
    (/\b(?:rewrite|revise|harmonize|combine|merge|add|move|markdown|make it|this note|this page)\b/i.test(text) && subject.test(context));
}

/** Clear document inventories need source coverage, not a lesson for every topic.
 * Ambiguous or mixed teaching requests still go through semantic planning. */
export function isDocumentStructureRequest(request: string): boolean {
  const text = requestKeywords(request);
  if (/\b(?:teach|explain|explanation|derive|derivation|rewrite|revise|enrich|expand|solve|calculate|prove)\b/i.test(text) ||
      /\b(?:walk me through|work through|from first principles)\b/i.test(text) ||
      /\b(?:worked|step.by.step|in.depth)\b|\b(?:with|include|including|give|show)\s+(?:\w+\s+)?examples?\b/i.test(text) ||
      /\b(?:write|create|build|generate)\b[^.!?\n]*\b(?:lesson|tutorial)\b/i.test(text)) return false;
  if (/\btopic[ -]chain\b|\btable of contents\b/i.test(text)) return true;
  const document = /\b(?:markdown|document|article|chapter|text|note|page|lesson)\b/i.test(text);
  return document && (/\b(?:topic|concept)[ -](?:map|outline)\b/i.test(text) ||
    (/\b(?:reading|document|source) order\b/i.test(text) && /\b(?:topics?|concepts?|headings?|sections?|ideas)\b/i.test(text)) ||
    /\b(?:list|scan|outline|enumerate|extract|map|trace)\b[^.!?\n]*\b(?:topics|headings|sections|progression)\b/i.test(text));
}

import { PROMPT_TEACHING_PLAN as TEACHING_PLAN_PROMPT } from "./system-prompts/feature-defaults.ts";
export { TEACHING_PLAN_PROMPT };

const string = { type: "string" };
const strings = { type: "array", items: string };
export const teachingPlanSchema = {
  type: "object", additionalProperties: false,
  required: ["applicable", "reason", "scope", "objective", "background", "priorLessonPageIds", "constraints", "requiredCoverage", "steps"],
  properties: {
    applicable: { type: "boolean" }, reason: string, objective: string,
    scope: { type: "string", enum: ["focused-answer", "lesson"] },
    background: strings, priorLessonPageIds: strings, constraints: strings, requiredCoverage: strings,
    steps: { type: "array", maxItems: 48, items: { type: "object", additionalProperties: false,
      required: ["id", "buildsOn", "establishes", "workedUse", "transition"],
      properties: { id: string, buildsOn: strings, establishes: string, workedUse: string, transition: string } } },
  },
};

export function parseTeachingPlan(raw: string): TeachingPlan | null {
  let value: Record<string, any>;
  try {
    value = parseJsonObjectResponse(raw);
  } catch {
    // Web-backed providers can append surplus closers even when a strict
    // schema is requested. Recover only those syntax defects, then apply all
    // plan validation below. Never select a nested plan or one of two answers.
    value = parseJsonObjectResponse(dropMismatchedJsonClosers(raw));
  }
  if (typeof value?.applicable !== "boolean") throw new Error("Teaching plan omitted applicability.");
  if (!value.applicable) return null;
  const scope = value.scope ?? "lesson";
  if (scope !== "focused-answer" && scope !== "lesson") throw new Error("Invalid teaching scope.");
  const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
  const list = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);
  if (!text(value.objective) || !list(value.background) || !list(value.constraints) ||
      !list(value.requiredCoverage) || !value.requiredCoverage.length ||
      new Set(value.requiredCoverage).size !== value.requiredCoverage.length ||
      !Array.isArray(value.steps) || !value.steps.length || value.steps.length > 48) throw new Error("Teaching plan is incomplete.");
  const priorLessonPageIds = value.priorLessonPageIds ?? [];
  if (!list(priorLessonPageIds) || new Set(priorLessonPageIds).size !== priorLessonPageIds.length) throw new Error("Prior lessons must be distinct retrieved page identifiers.");
  const prior = new Set<string>();
  for (const step of value.steps) {
    if (!step || !text(step.id) || prior.has(step.id) || !list(step.buildsOn) ||
        step.buildsOn.some((id: string) => !prior.has(id)) || !text(step.establishes) ||
        (scope === "focused-answer" ? typeof step.workedUse !== "string" : !text(step.workedUse)) || typeof step.transition !== "string") throw new Error("Teaching steps must establish their dependencies in reader order.");
    prior.add(step.id);
  }
  return { version: TEACHING_PLAN_VERSION, scope, objective: value.objective, background: value.background, priorLessonPageIds,
    constraints: value.constraints, requiredCoverage: value.requiredCoverage, steps: value.steps };
}

export function teachingEvidencePageId(pageId: string): string {
  return pageId.replace(/@\d+$/, "");
}

export function teachingPlanPrompt(plan: TeachingPlan): string {
  if (plan.scope === "focused-answer") return `# focused_answer\nAnswer the user's current question directly in the opening sentence. Use only the explanation needed to resolve it; no compulsory worked example, derivation, or lesson introduction. Preserve necessary conditions and factual accuracy. The plan is fallible context and must not broaden the user's request. Do not print the internal plan.\n${JSON.stringify(plan)}`;
  return `# teaching_plan\nWrite from this reader progression, using source material as evidence rather than copying its order. Preserve all scoped coverage and format constraints. Establish each needed meaning before relying on it. This is an internal plan, not headings or process commentary to print.\n${JSON.stringify(plan)}`;
}

export function teachingReviewHash(markdown: string, context: unknown): string {
  return createHash("sha256").update(JSON.stringify({ version: TEACHING_PLAN_VERSION, markdown, context })).digest("hex");
}
