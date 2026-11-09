import { canonicalSourceMaterialBody, canonicalSourceRawPageBlocks } from "./learn-syllabus.ts";

/** Read source pages before accepting a teaching plan, including positive coverage verdicts. */
export const PLANNING_EVIDENCE_VERSION = "teaching-pages-and-practice-v1";
// Characters are the only hard bound: they are what fills the Source Map
// prompt, while pages vary from a 300-character slide to a 4000-character
// textbook page. A page count is guidance only. Live 2026-09-25 (gpt-6-luna):
// a hard 64 and then 80 page cap each drew a one-page overshoot and a
// 15-minute repair that changed nothing meaningful.
export const PLANNING_EVIDENCE_PAGES_PER_UNIT_GUIDE = 6;
export const MAX_PLANNING_EVIDENCE_CHARS = 240_000;
// When the Source Map is authored in parts, the selected pages are split
// across small requests, so the total can grow with the plan while one
// record's pages (one unit part's prompt) stay bounded.
export const PLANNING_EVIDENCE_CHARS_PER_RECORD = 25_000;
export const MAX_PLANNING_EVIDENCE_CHARS_CEILING = 600_000;
export const MAX_PLANNING_EVIDENCE_RECORD_CHARS = 90_000;
/** A partitioned total fails only past this multiple of its budget. */
export const PARTITIONED_TOTAL_SLACK = 1.25;

export interface PlanningEvidenceCharBudget { total: number; perRecord: number | null }

/** The single-call map keeps the fixed total; a partitioned map scales with its records. */
export function planningEvidenceCharBudget(recordCount: number, partitioned: boolean): PlanningEvidenceCharBudget {
  if (!partitioned) return { total: MAX_PLANNING_EVIDENCE_CHARS, perRecord: null };
  return {
    total: Math.min(
      MAX_PLANNING_EVIDENCE_CHARS_CEILING,
      Math.max(MAX_PLANNING_EVIDENCE_CHARS, recordCount * PLANNING_EVIDENCE_CHARS_PER_RECORD),
    ),
    perRecord: MAX_PLANNING_EVIDENCE_RECORD_CHARS,
  };
}

export interface PlanningEvidencePage {
  alias: string;
  anchorId: string;
  sourceId: string;
  page: number;
  exactText: string;
}
export interface PlanningEvidenceSelection {
  units: Array<{ unitId: string; pageAliases: string[]; reason: string }>;
  practiceSources: Array<{
    sourceId: string;
    disposition: "selected" | "out_of_scope" | "not_practice";
    pageAliases: string[];
    reason: string;
  }>;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(
  (item) => typeof item === "string" && item.length > 0 && item.trim() === item,
);
const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();

export function planningEvidenceCatalog(input: {
  sources: readonly { sourceId: string; body?: string }[];
  anchors: readonly { id: string; sourceId: string; page: number }[];
}): PlanningEvidencePage[] {
  const raw = new Map<string, string>();
  for (const source of input.sources) {
    const pages = canonicalSourceRawPageBlocks(source.sourceId, source.body);
    for (const page of pages) raw.set(`${source.sourceId}\0${page.pageNumber}`, page.exactText);
    if (pages.length === 0) raw.set(`${source.sourceId}\0unpaged`, canonicalSourceMaterialBody(source.body));
  }
  return input.anchors.flatMap((anchor) => {
    const exactText = raw.get(`${anchor.sourceId}\0${anchor.page}`) ?? raw.get(`${anchor.sourceId}\0unpaged`);
    return exactText ? [{ alias: "", anchorId: anchor.id, sourceId: anchor.sourceId, page: anchor.page, exactText }] : [];
  }).map((page, index) => ({ ...page, alias: `p${index}` }));
}

/** Navigation is explicitly separate from the complete bytes used to verify support. */
export function planningEvidenceNavigation(pages: readonly PlanningEvidencePage[]) {
  const sourceIds = [...new Set(pages.map((page) => page.sourceId))];
  const indexes = new Map(sourceIds.map((id, index) => [id, index]));
  const catalog = pages.map((page) => [
    page.alias, indexes.get(page.sourceId), page.page,
    [...page.exactText.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => match[1]).join(" / ").slice(0, 160),
    normalize(page.exactText).slice(0, 100), page.exactText.length,
  ]);
  // Keep all identities selectable; shrink navigation, never silently drop later pages.
  if (JSON.stringify(catalog).length > 800_000) for (const entry of catalog) entry[4] = "";
  if (JSON.stringify(catalog).length > 800_000) for (const entry of catalog) entry[3] = "";
  if (JSON.stringify(catalog).length > 800_000) throw new Error("Teaching evidence page catalog exceeds its transport bound.");
  return { sourceIds, columns: ["alias", "sourceIndex", "page", "headings", "preview", "pageChars"], pages: catalog };
}

import { PROMPT_LEARN_EVIDENCE_SELECTION as PLANNING_EVIDENCE_SELECTION_PROMPT } from "./system-prompts/feature-defaults.ts";
export { PLANNING_EVIDENCE_SELECTION_PROMPT };

export function planningEvidenceSelectionProblems(input: {
  value: unknown;
  pages: readonly PlanningEvidencePage[];
  unitIds: readonly string[];
  sourceIds: readonly string[];
  budget?: PlanningEvidenceCharBudget;
}): string[] {
  const budget = input.budget ?? planningEvidenceCharBudget(0, false);
  const root = record(input.value);
  const problems: string[] = [];
  const pages = new Map(input.pages.map((page) => [page.alias, page]));
  const selected = new Set<string>();
  for (const [field, key, expected] of [
    ["units", "unitId", input.unitIds], ["practiceSources", "sourceId", input.sourceIds],
  ] as const) {
    const seen = new Set<string>();
    if (!Array.isArray(root[field])) problems.push(`${field} must be an array`);
    for (const raw of Array.isArray(root[field]) ? root[field] : []) {
      const item = record(raw);
      const id = String(item[key] ?? "");
      // Name which rule failed: live 2026-09-24 (gpt-6-luna) the combined
      // "unknown or duplicate" message was repeated verbatim for 3 attempts.
      if (!expected.includes(id)) {
        problems.push(field === "units"
          ? `units has unitId ${id}, which is not one of the supplied teachable syllabus units (${expected.join(", ")}); remove that record`
          : `practiceSources has sourceId ${id}, which is not one of requiredPracticeSourceIds; remove that record`);
      } else if (seen.has(id)) {
        problems.push(`${field} repeats ${key} ${id}; return exactly one record per ${key}`);
      }
      seen.add(id);
      if (typeof item.reason !== "string" || !item.reason.trim()) problems.push(`${field} ${id} needs a reason`);
      const needsPages = field === "units" || item.disposition === "selected";
      if (field === "practiceSources" && !["selected", "out_of_scope", "not_practice"].includes(String(item.disposition))) {
        problems.push(`practice source ${id} needs an explicit disposition`);
      }
      if (!strings(item.pageAliases)) { problems.push(`${field} ${id} needs exact pageAliases`); continue; }
      if (needsPages !== (item.pageAliases.length > 0)) problems.push(`${field} ${id} has an invalid page selection`);
      if (new Set(item.pageAliases).size !== item.pageAliases.length) problems.push(`${field} ${id} repeats pages`);
      for (const alias of item.pageAliases) {
        const page = pages.get(alias);
        if (!page || (field === "practiceSources" && page.sourceId !== id)) problems.push(`${field} ${id} references invalid page ${alias}`);
        selected.add(alias);
      }
    }
    for (const id of expected) {
      if (seen.has(id)) continue;
      problems.push(field === "practiceSources"
        ? `practiceSources omits ${id}: add one practiceSources record for ${id} with disposition selected, out_of_scope, or not_practice (every id in requiredPracticeSourceIds needs exactly one record)`
        // Live 2026-09-25 (gpt-6-luna, scoped M1 run): the selector dropped
        // the M2/M3 units on every attempt; say that scope does not exempt them.
        : `${field} omits ${id}: return one units record for every supplied teachable unit, including units outside the userInstruction's focus (give each at least one page)`);
    }
  }
  const pageChars = (alias: string): number => pages.get(alias)?.exactText.length ?? 0;
  const totalChars = [...selected].reduce((sum, alias) => sum + pageChars(alias), 0);
  const records = (["units", "practiceSources"] as const).flatMap((field) =>
    (Array.isArray(root[field]) ? root[field] : []).map((raw) => {
      const item = record(raw);
      const aliases = strings(item.pageAliases) ? item.pageAliases : [];
      return {
        id: String(item[field === "units" ? "unitId" : "sourceId"] ?? "?"),
        pages: aliases.length,
        chars: aliases.reduce((sum, alias) => sum + pageChars(alias), 0),
      };
    }),
  );
  // A partitioned map never puts the whole selection in one prompt (each
  // record is bounded by perRecord), so its total is a spending guide with
  // slack. Live 2026-09-26 (gpt-6-luna): a healing selection landed 1.5% over
  // the 600000 total and three repairs failed the plan without trimming it.
  const hardTotal = budget.perRecord === null
    ? budget.total
    : Math.round(budget.total * PARTITIONED_TOTAL_SLACK);
  if (totalChars > hardTotal) {
    // Name the overshoot and where the characters went, so one repair can cut
    // the right pages instead of guessing.
    problems.push(
      `Teaching evidence selection has ${totalChars} characters of page text; the limit is ${budget.total}. Remove at least ${totalChars - budget.total} characters, dropping the pages that least teach each record's core idea (per record: ${records.map((entry) => `${entry.id} ${entry.pages} pages/${entry.chars} chars`).join(", ")})`,
    );
  }
  if (budget.perRecord !== null) {
    for (const entry of records) {
      // Same slack as the total: one record's prompt stays far inside the
      // model's window at 1.25x. Live 2026-09-26: SU7 at 102766 of 90000 was
      // the only problem left after a repair on the healing selection.
      if (entry.chars > Math.round(budget.perRecord * PARTITIONED_TOTAL_SLACK)) {
        problems.push(
          `${entry.id} selects ${entry.pages} pages with ${entry.chars} characters; one record may hold at most ${budget.perRecord}. Remove at least ${entry.chars - budget.perRecord} characters from ${entry.id}, keeping the pages that best teach its core idea`,
        );
      }
    }
  }
  return problems;
}

/**
 * Drop unit records for syllabus units the coverage review already ruled
 * unteachable. Live 2026-09-24 (gpt-6-luna): a repair pass re-added the
 * excluded unit after fixing the page limit, exhausting the repair budget on
 * a record that carries no decision anyone downstream reads.
 */
/**
 * Keep only unit records for the supplied teachable units. A record for any
 * other id (an invented one, or a unit outside this coverage) carries no
 * decision the plan can use. Live 2026-09-26 (gpt-6-luna): "SU13", outside
 * the teachable SU1-SU7, survived three attempts and failed the plan.
 */
export function keepTeachableUnitRecords(value: unknown, teachableUnitIds: readonly string[]): unknown {
  const root = record(value);
  if (!Array.isArray(root.units)) return value;
  const teachable = new Set(teachableUnitIds);
  return { ...root, units: root.units.filter((unit) => teachable.has(String(record(unit).unitId ?? ""))) };
}

export function withoutExcludedUnitRecords(value: unknown, excludedUnitIds: readonly string[]): unknown {
  const root = record(value);
  if (!Array.isArray(root.units) || excludedUnitIds.length === 0) return value;
  const excluded = new Set(excludedUnitIds);
  return { ...root, units: root.units.filter((unit) => !excluded.has(String(record(unit).unitId ?? ""))) };
}

export function selectedPlanningEvidence(selection: PlanningEvidenceSelection, pages: readonly PlanningEvidencePage[]) {
  const aliases = new Set([...selection.units, ...selection.practiceSources].flatMap((item) => item.pageAliases));
  return pages.filter((page) => aliases.has(page.alias));
}

export const SOURCE_MAP_EVIDENCE_RULES = `
Teaching evidence (hard):
- If a selected page only locates a topic, or a prompt needs an absent continuation, return evidenceGaps: ["specific missing explanation or continuation and unit/source"]. This requests a bounded page-selection healing pass; never invent support to produce valid JSON. Otherwise omit evidenceGaps. Only teachable syllabus units can receive pages: never return a gap for a unit whose syllabusCoverage verdict is teachable:false. A gap must name material that an unselected page of a supplied source would provide. Material the supplied sources do not contain at all (an exercise file that was not uploaded, a procedure no source explains, a figure-only slide with no prose anywhere) is not a gap: record it in missingOrUnclear instead.
- Add unitEvidence: [{unitId, pages:[{anchorId, quote, teachingUse}]}]. Return exactly one record per teachingEvidenceSelection.units entry. Every page selected for that unit must appear. Copy anchorIds from teachingEvidencePages, quote explanatory source prose verbatim, and explain what objective that passage supports. A heading, contents entry, title, or caption alone cannot establish teachability. If selected pages cannot support a unit, report the evidence problem rather than inventing a quote: page selection will be healed before planning continues.
- Read the COMPLETE teachingEvidencePages. Do not repeat a claim of missing content just because an earlier prefix omitted it. Include every bound teaching page in sourceAnchors; later lessons must use these exact pages.
- Add practiceReview: [{anchorId, questionIds:["Q1"], omittedQuestions:[{label,reason}]}], one record per selected practice page. Enumerate the actual questions on that page, register relevant complete prompts in sourceQuestions, and explain any omitted question individually (outside scope, duplicate solution to an already registered question, or no question on this continuation page). A summary in sources[].examples or sources[].questions does not register an exercise. Empty questionIds AND omittedQuestions is invalid. Do not silently omit an entire selected worksheet.
- Every registered question must carry its original values, subparts, and necessary figure IDs. Read continuation pages to preserve the whole task. Its canonical anchor must contain the prompt, not merely be in the same book.
`;

export class PlanningEvidenceGapError extends Error {}

export const PLANNING_EVIDENCE_HEALING_PASSES = 2;

/** Only evidence failures reselect pages. Transport failures and cancellation propagate unchanged. */
export async function withPlanningEvidenceHealing<T>(
  attempt: (ordinal: number, previousGap: string | undefined) => Promise<T>,
): Promise<T> {
  let previousGap: string | undefined;
  // Live 2026-09-24 (gpt-6-luna, telecom-1 M1): the one healing pass fixed
  // most gaps but still missed one specific passage the gap named exactly.
  for (let ordinal = 0; ordinal < PLANNING_EVIDENCE_HEALING_PASSES + 1; ordinal += 1) {
    try { return await attempt(ordinal, previousGap); }
    catch (error) {
      if (!(error instanceof PlanningEvidenceGapError)) throw error;
      previousGap = error.message;
    }
  }
  throw new PlanningEvidenceGapError(`Teaching evidence is still incomplete after page selection and ${PLANNING_EVIDENCE_HEALING_PASSES} healing passes: ${previousGap}. No lesson plan was accepted.`);
}

/**
 * A quote proves a page teaches something when its words appear on the page.
 * Slides are bullet lists, and the model quotes them by joining bullets, so
 * a quote may be several pieces split at line breaks, bullet markers, or an
 * ellipsis, each verbatim on the page and at least three words long. Live
 * 2026-09-25 (gpt-6-luna): "PSD: Describes ...\n\n- the area under the PSD is
 * the normalized average power." joined two verbatim bullets of one slide.
 */
export function verbatimQuoteOf(rawQuote: string, pageProse: string): boolean {
  const prose = normalize(pageProse);
  const whole = normalize(rawQuote);
  if (whole && prose.includes(whole)) return true;
  const pieces = rawQuote
    .split(/\n+|\s*(?:\.\.\.|…)\s*/)
    .map((piece) => normalize(piece.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")))
    .filter(Boolean);
  return pieces.length > 1 && pieces.every((piece) =>
    piece.split(" ").length >= 3 && prose.includes(piece));
}

/** Fewer than 20 prose words outside headings and math: a formula/diagram slide. */
export function sparseProsePage(nonHeadingText: string): boolean {
  const withoutMath = nonHeadingText.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g, " ");
  return withoutMath.split(/\s+/).filter((word) => /[A-Za-z]{2,}/.test(word)).length < 20;
}

export function sourceMapEvidenceProblems(input: {
  value: unknown;
  selection: PlanningEvidenceSelection;
  pages: readonly PlanningEvidencePage[];
}): string[] {
  const root = record(input.value);
  const problems: string[] = [];
  const pages = new Map(input.pages.map((page) => [page.anchorId, page]));
  const byAlias = new Map(input.pages.map((page) => [page.alias, page]));
  const sourceAnchors = new Set((Array.isArray(root.sourceAnchors) ? root.sourceAnchors : []).map((a) => record(a).id));
  const evidence = Array.isArray(root.unitEvidence) ? root.unitEvidence : [];
  const expectedUnits = new Map(input.selection.units.map((unit) => [unit.unitId, unit]));
  const seenUnits = new Set<string>();
  for (const raw of evidence) {
    const item = record(raw);
    const unitId = String(item.unitId ?? "");
    const expected = expectedUnits.get(unitId);
    if (!expected || seenUnits.has(unitId)) { problems.push(`unitEvidence has unknown or duplicate unit ${unitId}`); continue; }
    seenUnits.add(unitId);
    const required = new Set(expected.pageAliases.map((alias) => byAlias.get(alias)?.anchorId));
    const seen = new Set<string>();
    for (const rawPage of Array.isArray(item.pages) ? item.pages : []) {
      const proof = record(rawPage);
      const id = String(proof.anchorId ?? "");
      const page = pages.get(id);
      if (!required.has(id)) problems.push(`unitEvidence ${unitId} cites page ${id}, which teachingEvidenceSelection did not select for ${unitId}; cite only that unit's selected pages`);
      else if (seen.has(id)) problems.push(`unitEvidence ${unitId} lists page ${id} twice; keep one record per page`);
      seen.add(id);
      if (!sourceAnchors.has(id)) problems.push(`unitEvidence ${unitId} must preserve source anchor ${id}`);
      // Removing headings before checking prevents a contents/section heading from passing as explanatory prose.
      const prose = page?.exactText.replace(/^#{1,6}\s+.*$/gm, "") ?? "";
      const quote = typeof proof.quote === "string" ? normalize(proof.quote) : "";
      // Live 2026-09-25 (gpt-6-luna): one combined message repeated on exam
      // solution pages; name which rule failed and how to satisfy it.
      if (!quote || !verbatimQuoteOf(proof.quote as string, prose)) {
        const isHeading = Boolean(quote) && normalize(page?.exactText ?? "").includes(quote);
        // A slide that is a heading over a formula or diagram has no prose to
        // quote; its heading plus that content is the evidence. Live
        // 2026-09-25: "BPSK Power spectral density" and "Transmitter" slides
        // failed every repair because no prose sentence existed to cite.
        if (!(isHeading && sparseProsePage(prose))) {
          problems.push(isHeading
            ? `unitEvidence ${unitId} page ${id} quotes a heading line; quote a sentence of explanatory prose from that page instead`
            : `unitEvidence ${unitId} page ${id} quote is not an exact substring of that page's text; copy its words character for character (one run, or several verbatim pieces of at least three words separated by line breaks or "..."; never retype equations, skip words inside a piece, or fix spelling)`);
        }
      }
      if (typeof proof.teachingUse !== "string" || !proof.teachingUse.trim()) problems.push(`unitEvidence ${unitId} page ${id} needs a teachingUse`);
    }
    for (const id of required) if (!seen.has(String(id))) problems.push(`unitEvidence ${unitId} dropped selected teaching page ${id}`);
  }
  for (const id of expectedUnits.keys()) if (!seenUnits.has(id)) problems.push(`unitEvidence omits ${id}`);
  const practicePages = new Set(input.selection.practiceSources.flatMap((source) => source.pageAliases.map((alias) => byAlias.get(alias)?.anchorId)));
  const questions = new Map((Array.isArray(root.sourceQuestions) ? root.sourceQuestions : []).map((raw) => {
    const question = record(raw); return [question.id, question] as const;
  }));
  const seenPractice = new Set<string>();
  for (const raw of Array.isArray(root.practiceReview) ? root.practiceReview : []) {
    const review = record(raw);
    const id = String(review.anchorId ?? "");
    if (!practicePages.has(id) || seenPractice.has(id)) problems.push(`practiceReview has invalid or duplicate page ${id}`);
    seenPractice.add(id);
    if (!strings(review.questionIds)) problems.push(`practiceReview ${id} needs questionIds`);
    for (const qid of strings(review.questionIds) ? review.questionIds : []) {
      const question = questions.get(qid);
      if (!question) problems.push(`practiceReview ${id} lists question ${qid}, which sourceQuestions does not define; add that sourceQuestions record or remove ${qid} from this page's questionIds`);
      // Live 2026-09-25 (gpt-6-luna): solutions spanning pages 6-8 kept only
      // their first page; say how to register a continuation.
      else if (!strings(question.sourceAnchorIds) || !question.sourceAnchorIds.includes(id)) problems.push(`practiceReview ${id} lists question ${qid}, but ${qid}.sourceAnchorIds omits ${id}; a question or solution that continues across pages lists every page it occupies, so add ${id} to ${qid}.sourceAnchorIds (or remove ${qid} from this page's questionIds if it is not on this page)`);
    }
    const omitted = Array.isArray(review.omittedQuestions) ? review.omittedQuestions : [];
    if (!Array.isArray(review.omittedQuestions)) problems.push(`practiceReview ${id} needs omittedQuestions`);
    if (!(Array.isArray(review.questionIds) && review.questionIds.length) && !omitted.length) problems.push(`practiceReview ${id} silently drops the selected practice page`);
    for (const entry of omitted) {
      const omission = record(entry);
      if (![omission.label, omission.reason].every((value) => typeof value === "string" && value.trim())) problems.push(`practiceReview ${id} needs a named reason for every omitted question`);
    }
  }
  for (const id of practicePages) if (!seenPractice.has(String(id))) problems.push(`practiceReview omits selected exercise page ${id}`);
  return problems;
}

/** Every verified page must reach at least one lesson serving its syllabus unit. */
export function learningUnitEvidenceProblems(units: readonly {
  id: string; sourceAnchors: readonly string[]; syllabusUnitIds?: readonly string[];
}[], sourceMap: unknown): string[] {
  const root = record(sourceMap);
  return (Array.isArray(root.unitEvidence) ? root.unitEvidence : []).flatMap((raw) => {
    const unit = record(raw);
    return (Array.isArray(unit.pages) ? unit.pages : []).flatMap((rawPage) => {
      const id = String(record(rawPage).anchorId ?? "");
      return units.some((lesson) => lesson.syllabusUnitIds?.includes(String(unit.unitId)) && lesson.sourceAnchors.includes(id))
        ? [] : [`teaching evidence for syllabus unit ${unit.unitId} lost page ${id}; assign it to a lesson teaching that syllabus unit`];
    });
  });
}

export function persistedPlanningEvidenceProblems(input: {
  sourceMap: unknown;
  pages: readonly PlanningEvidencePage[];
  unitIds: readonly string[];
  sourceIds: readonly string[];
}): string[] {
  const root = record(input.sourceMap);
  if (root.teachingEvidencePolicy !== PLANNING_EVIDENCE_VERSION) {
    return ["This map predates complete teaching-page and practice evidence checks; run Learn planning again"];
  }
  // Recheck with the budget the selection was accepted under: a map authored
  // in parts scales with its records (units + sources). The single-call 240k
  // default rejected an accepted 642k M1 selection at generation start and
  // rolled the whole Learning Map back (telecom-1, gpt-6-sol, 2026-10-01).
  const problems = planningEvidenceSelectionProblems({
    ...input,
    value: root.teachingEvidenceSelection,
    budget: planningEvidenceCharBudget(input.unitIds.length + input.sourceIds.length, true),
  });
  if (problems.length) return problems;
  const selection = root.teachingEvidenceSelection as unknown as PlanningEvidenceSelection;
  return sourceMapEvidenceProblems({ value: root, selection, pages: selectedPlanningEvidence(selection, input.pages) });
}
