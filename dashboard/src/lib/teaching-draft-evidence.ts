import { createHash } from "node:crypto";

export interface TeachingDraftPassage {
  id: string;
  text: string;
  start: number;
  end: number;
}

export const TEACHING_DRAFT_EVIDENCE_RULES = `The supplied draftPassages are exact, contiguous passages of pageMarkdown, each with a server-assigned ID. Prefer passage references over copying Markdown, especially equations. In any draft-evidence field (sentence, definition, text, paragraph, quote, or an element of sentences), return {"draftPassage":"one exact supplied ID"} instead of a string. To quote a contiguous range, use {"draftPassage":"first ID","through":"last ID"}; the server includes every character between them. Select the smallest passage or range that supports the finding. These references are resolved to exact quotations before validation. Never invent IDs, concatenate separated passages, or quote JSON-escaped pageMarkdown as if its escape sequences were literal draft text. Exact string quotations remain supported. priorExplanation.quote is different: it must quote the actual earlier lesson, never a draftPassage. Keep all required inspection arrays and concrete learning obstacles. Passage IDs are evidence locators, not teaching-quality verdicts.`;

/** IDs identify both the passage and this exact draft; edits invalidate them. */
export function teachingDraftPassages(markdown: string): TeachingDraftPassage[] {
  const revision = createHash("sha256").update(markdown).digest("hex").slice(0, 10);
  const passages: TeachingDraftPassage[] = [];
  let start = 0;
  const append = (end: number) => {
    const text = markdown.slice(start, end);
    if (text.trim()) passages.push({ id: `p${passages.length + 1}-${revision}`, text, start, end });
  };
  for (const match of markdown.matchAll(/\r?\n[\t ]*\r?\n/g)) {
    append(match.index);
    start = match.index + match[0].length;
  }
  append(markdown.length);
  return passages;
}

/** Resolve only draft-evidence slots. Earlier-lesson evidence and explanatory
 * prose are never replaced, and every resulting quote still passes the normal
 * exact-text validator. No fuzzy matching or invented evidence is permitted. */
export function resolveTeachingDraftEvidence(parsed: unknown, markdown: string, passages: TeachingDraftPassage[]): unknown {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;
  const byId = new Map(passages.map(passage => [passage.id, passage]));
  const resolve = (value: unknown, location: string): unknown => {
    // Some reviews serialize the supplied locator as prose instead of the
    // preferred object. Accept only this exact ID/range grammar, then apply
    // the same current-draft and reader-order checks. Never guess a quote.
    if (typeof value === "string" && !markdown.includes(value)) {
      const locator = /^(p[1-9]\d*-[a-f0-9]{10})(?: through (p[1-9]\d*-[a-f0-9]{10}))?$/.exec(value);
      if (locator) value = { draftPassage: locator[1], ...(locator[2] ? { through: locator[2] } : {}) };
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const reference = value as Record<string, unknown>;
    if (!Object.hasOwn(reference, "draftPassage")) return value;
    if (Object.keys(reference).some(key => key !== "draftPassage" && key !== "through")) {
      throw new Error(`${location}: a draft reference may contain only draftPassage and optional through.`);
    }
    const first = typeof reference.draftPassage === "string" ? byId.get(reference.draftPassage) : undefined;
    const last = reference.through === undefined ? first : typeof reference.through === "string" ? byId.get(reference.through) : undefined;
    if (!first || !last || first.start > last.start) {
      throw new Error(`${location}: unknown, stale or reversed draft passage reference ${JSON.stringify(value)}. Choose IDs from this request's draftPassages in reader order.`);
    }
    return markdown.slice(first.start, last.end);
  };
  const fields: Record<string, string[]> = {
    terms: ["sentence"], concepts: ["definition"], results: ["sentence"], flow: ["sentence"],
    callouts: ["text"], reteaching: ["paragraph"], planCoverage: ["quote"], contractIssues: ["quote"],
    restatements: ["sentences"],
  };
  const result = { ...parsed } as Record<string, unknown>;
  for (const [collection, keys] of Object.entries(fields)) {
    if (!Array.isArray(result[collection])) continue;
    result[collection] = result[collection].map((entry: unknown, index: number) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
      const revised = { ...entry } as Record<string, unknown>;
      for (const key of keys) {
        const location = `${collection}[${index}].${key}`;
        revised[key] = Array.isArray(revised[key])
          ? revised[key].map((value: unknown, i: number) => resolve(value, `${location}[${i}]`))
          : resolve(revised[key], location);
      }
      return revised;
    });
  }
  return result;
}
