import { scopedSystemPromptText } from "./system-prompts/service.ts";
import { createHash } from "node:crypto";
import type { CriticFn, CriticIssue } from "./critic-loop.ts";
import {
  buildFinalGardenState,
  type CanonicalSourceAnchor,
  type FinalGardenPage,
  type FinalGardenState,
} from "./final-garden-state.ts";

/**
 * Final source-completeness review: does the finished module teach everything
 * its selected sources teach, and can a student follow every lesson?
 *
 * telecom-1 (2026-10-18): an audit of three finished modules found 105 verified
 * gaps and 30 slides no lesson taught - formulas (the Shannon limit, line-code
 * PSDs), values (GSM's 0.577 ms slot), whole slide topics (cell splitting,
 * TDD/FDD), figures the exercises depend on, and terms used but never defined.
 * Per-lesson review only checks a lesson against its own teaching plan, and the
 * final critic sees 240-character source excerpts, so nothing compared the
 * finished module with the full source pages. This does, in three steps:
 *   1. each lesson against the full text of the source pages bound to it;
 *   2. every reported gap re-checked against all lessons bound to the same page
 *      (lesson A is often reported for content lesson B teaches);
 *   3. source pages no lesson is bound to, against the lesson outlines.
 * Verified gaps become blocking `source_teaching_gap` critic issues, so the
 * existing critic loop repairs them with its model repair. A gap that is still
 * reported after it was repaired twice becomes a warning: the loop must not
 * spend its rounds on one finding the repair cannot satisfy.
 */

export const SOURCE_COMPLETENESS_ISSUE_PREFIX = "source-completeness:";

export type SourceCompletenessReviewKind = "page_review" | "verify" | "unassigned";
export type SourceCompletenessReview = (request: {
  kind: SourceCompletenessReviewKind;
  label: string;
  pageId?: string;
  system: string;
  user: string;
}) => Promise<string>;

export interface SourceCompletenessGap {
  type: "slide" | "figure" | "explanation";
  severity: "must" | "minor";
  what: string;
  anchorId: string | null;
  where: string | null;
}

const TEXT_KINDS = new Set(["guidance", "text_concept", "abstract", "intro"]);
const FIGURE_KINDS = new Set(["figure", "table", "graph"]);
const PAGE_BODY_LIMIT = 60_000;
const ANCHOR_TEXT_LIMIT = 6_000;
const MAX_RAISES_BEFORE_WARNING = 2;

import { PROMPT_LEARNING_COMPLETENESS as SOURCE_COMPLETENESS_REVIEW_PROMPT } from "./system-prompts/feature-defaults.ts";
export { SOURCE_COMPLETENESS_REVIEW_PROMPT };

import { PROMPT_LEARNING_GAP_VERIFICATION as SOURCE_COMPLETENESS_VERIFY_PROMPT } from "./system-prompts/feature-defaults.ts";
export { SOURCE_COMPLETENESS_VERIFY_PROMPT };

import { PROMPT_LEARNING_UNASSIGNED_SOURCES as SOURCE_COMPLETENESS_UNASSIGNED_PROMPT } from "./system-prompts/feature-defaults.ts";
export { SOURCE_COMPLETENESS_UNASSIGNED_PROMPT };

function sha(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? content;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** Gaps from a page review. Anchor ids not bound to the page are dropped to null. */
export function parseSourceCompletenessGaps(content: string, allowedAnchorIds: ReadonlySet<string>): SourceCompletenessGap[] {
  const parsed = parseJsonObject(content);
  if (!parsed || !Array.isArray(parsed.gaps)) throw new Error("source completeness review returned no gaps array");
  return parsed.gaps.flatMap((raw): SourceCompletenessGap[] => {
    const gap = raw as Record<string, unknown>;
    const type = gap.type === "slide" || gap.type === "figure" || gap.type === "explanation" ? gap.type : null;
    const what = typeof gap.what === "string" ? gap.what.trim() : "";
    if (!type || !what) return [];
    const anchorId = typeof gap.anchorId === "string" && allowedAnchorIds.has(gap.anchorId) ? gap.anchorId : null;
    return [{
      type,
      severity: gap.severity === "must" ? "must" : "minor",
      what,
      anchorId,
      where: typeof gap.where === "string" && gap.where.trim() ? gap.where.trim() : null,
    }];
  });
}

export function parseSourceCompletenessVerdicts(content: string): Map<number, "taught" | "missing" | "invalid"> {
  const parsed = parseJsonObject(content);
  if (!parsed || !Array.isArray(parsed.verdicts)) throw new Error("source completeness verification returned no verdicts array");
  const verdicts = new Map<number, "taught" | "missing" | "invalid">();
  for (const raw of parsed.verdicts) {
    const entry = raw as Record<string, unknown>;
    const n = Number(entry.n);
    if (Number.isInteger(n) && (entry.verdict === "taught" || entry.verdict === "missing" || entry.verdict === "invalid")) verdicts.set(n, entry.verdict);
  }
  return verdicts;
}

function pageOrder(a: FinalGardenPage, b: FinalGardenPage): number {
  return a.sectionNumber - b.sectionNumber || a.subsectionNumber.localeCompare(b.subsectionNumber, undefined, { numeric: true });
}

/** Every source anchor a page is bound to: its frontmatter plus its learning-unit contract. */
export function pageAnchorIds(state: FinalGardenState, page: FinalGardenPage): string[] {
  const unit = state.learningUnitContract.units.find((u) => u.id === page.learningUnitId);
  return [...new Set([
    ...page.sourceAnchors,
    ...page.sourceVisualIds,
    ...(unit?.sourceAnchors ?? []),
    ...(unit?.sourceFigures ?? []).map((f) => f.id),
    ...(unit?.sourceTables ?? []).map((t) => t.id),
  ])].filter((id) => state.sourceAnchors[id]);
}

function anchorEvidence(anchor: CanonicalSourceAnchor): string | null {
  if (TEXT_KINDS.has(anchor.kind) && anchor.exactText?.trim()) {
    return `### SOURCE PAGE ${anchor.id}${anchor.page ? ` (page ${anchor.page})` : ""}\n${anchor.exactText.slice(0, ANCHOR_TEXT_LIMIT)}`;
  }
  if (FIGURE_KINDS.has(anchor.kind)) {
    const description = [anchor.caption, anchor.semanticSummary].filter(Boolean).join(". ") || anchor.title;
    return `### SOURCE FIGURE ${anchor.id}${anchor.page ? ` (page ${anchor.page})` : ""}\n${description}`;
  }
  return null;
}

/** Text source pages of the run's sources that no lesson is bound to. */
export function unassignedSourceAnchors(state: FinalGardenState): CanonicalSourceAnchor[] {
  const referenced = new Set(state.pages.flatMap((page) => pageAnchorIds(state, page)));
  const sources = new Set([...referenced].map((id) => state.sourceAnchors[id]?.sourceId).filter(Boolean));
  return Object.values(state.sourceAnchors).filter((anchor) =>
    TEXT_KINDS.has(anchor.kind) && anchor.exactText?.trim() && anchor.sourceId && sources.has(anchor.sourceId) && !referenced.has(anchor.id));
}

function lessonText(page: FinalGardenPage): string {
  return page.body.replace(/^```breadboard-(?:detached-)?visual[\s\S]*?^```/gm, "[interactive visual]").slice(0, PAGE_BODY_LIMIT);
}

function lessonOutline(state: FinalGardenState, page: FinalGardenPage): string {
  const unit = state.learningUnitContract.units.find((u) => u.id === page.learningUnitId);
  const body = lessonText(page);
  const headings = body.split("\n").filter((line) => /^#{2,4} /.test(line));
  const firsts = body.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && !/^[!|$>#*-]/.test(p))
    .map((p) => p.split(/(?<=[.?!])\s/)[0].slice(0, 160));
  return `## ${page.rel}\n${page.title}${unit?.learningQuestion ? ` - ${unit.learningQuestion}` : ""}\n${headings.join("\n")}\n${firsts.join(" ").slice(0, 2000)}`;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }));
  return results;
}

interface PendingGap extends SourceCompletenessGap { pageRel: string }

function issueFor(gap: PendingGap, state: FinalGardenState, raises: Map<string, number>): CriticIssue {
  const fingerprint = sha(`${gap.pageRel}|${gap.anchorId ?? ""}|${gap.type}|${gap.what.toLowerCase().replace(/\s+/g, " ").slice(0, 120)}`);
  const times = (raises.get(fingerprint) ?? 0) + 1;
  raises.set(fingerprint, times);
  const anchor = gap.anchorId ? state.sourceAnchors[gap.anchorId] : undefined;
  const lead = gap.type === "figure"
    ? "A source figure the student needs is neither shown nor described in the module"
    : gap.type === "explanation"
      ? "The lesson uses something it never explains"
      : "The source teaches this, but no lesson of the module does";
  return {
    id: `${SOURCE_COMPLETENESS_ISSUE_PREFIX}${fingerprint.slice(0, 16)}`,
    severity: gap.severity === "must" && times <= MAX_RAISES_BEFORE_WARNING ? "blocking" : "warning",
    type: "source_teaching_gap",
    pagePath: gap.pageRel,
    sourceAnchorIds: gap.anchorId ? [gap.anchorId] : [],
    problem: `${lead}: ${gap.what}`,
    evidence: anchor ? (anchorEvidence(anchor) ?? anchor.title).slice(0, 900) : (gap.where ?? gap.pageRel),
    expected: gap.type === "explanation"
      ? "The lesson explains it before it is used, from simpler ideas."
      : "The lesson teaches this source content where it belongs in its argument, with nothing beyond what the source states.",
    repairTarget: "unit_page",
    suggestedRepair: `Add to ${gap.pageRel}${gap.where ? ` near "${gap.where}"` : ""}: ${gap.what}`,
  };
}

/**
 * A critic that reports verified source-completeness gaps for the finished
 * garden on disk. Page reviews and verifications are cached by content, so a
 * later critic round only re-reviews pages a repair changed.
 */
export function createSourceCompletenessCritic(input: {
  gardenDir: string;
  gardenSlug: string;
  review: SourceCompletenessReview;
  concurrency?: number;
  /** Tests supply a state; Learn reads the finished garden from disk. */
  loadState?: () => FinalGardenState;
}): CriticFn {
  const concurrency = input.concurrency ?? 4;
  const reviewCache = new Map<string, SourceCompletenessGap[]>();
  const verifyCache = new Map<string, Map<number, "taught" | "missing" | "invalid">>();
  const raises = new Map<string, number>();

  const verify = async (gaps: PendingGap[], candidates: FinalGardenPage[]): Promise<PendingGap[]> => {
    if (!gaps.length) return [];
    const list = gaps.map((g, i) => `${i + 1}. [${g.pageRel}, ${g.type}, ${g.severity}${g.anchorId ? `, ${g.anchorId}` : ""}] ${g.what}`).join("\n");
    const user = `# GAPS\n${list}\n\n${candidates.map((p) => `# LESSON ${p.rel}\n${lessonText(p)}`).join("\n\n")}`;
    const key = sha(user);
    let verdicts = verifyCache.get(key);
    if (!verdicts) {
      verdicts = parseSourceCompletenessVerdicts(await input.review({ kind: "verify", label: `verify ${gaps.length} gap(s)`, system: scopedSystemPromptText("learning-gap-verification"), user }));
      verifyCache.set(key, verdicts);
    }
    return gaps.filter((_, i) => verdicts!.get(i + 1) === "missing");
  };

  return async () => {
    const state = input.loadState?.() ?? buildFinalGardenState(input.gardenDir, input.gardenSlug);
    const pages = [...state.pages].sort(pageOrder);
    const anchorsOf = new Map(pages.map((p) => [p.rel, pageAnchorIds(state, p)]));

    // 1. each lesson against its full source pages
    const reported = (await mapLimit(pages, concurrency, async (page): Promise<PendingGap[]> => {
      const ids = anchorsOf.get(page.rel) ?? [];
      const evidence = ids.map((id) => anchorEvidence(state.sourceAnchors[id])).filter(Boolean);
      if (!evidence.length) return [];
      const user = `# SOURCE PAGES BOUND TO THIS LESSON\n${evidence.join("\n\n")}\n\n# LESSON ${page.rel}: ${page.title}\n${lessonText(page)}`;
      const key = sha(user);
      let gaps = reviewCache.get(key);
      if (!gaps) {
        gaps = parseSourceCompletenessGaps(await input.review({ kind: "page_review", label: `source completeness ${page.rel}`, pageId: page.rel, system: scopedSystemPromptText("learning-completeness"), user }), new Set(ids));
        reviewCache.set(key, gaps);
      }
      return gaps.map((g) => ({ ...g, pageRel: page.rel }));
    })).flat();

    // 2. re-check against every lesson that could hold the content
    const confirmed: PendingGap[] = [];
    const groups = new Map<string, { gaps: PendingGap[]; candidates: FinalGardenPage[] }>();
    for (const gap of reported) {
      if (gap.type === "explanation" && gap.severity !== "must") continue;
      const key = gap.type !== "explanation" && gap.anchorId ? `anchor:${gap.anchorId}` : `page:${gap.pageRel}`;
      if (!groups.has(key)) {
        const at = pages.findIndex((p) => p.rel === gap.pageRel);
        const candidates = key.startsWith("anchor:")
          ? pages.filter((p) => anchorsOf.get(p.rel)?.includes(gap.anchorId!))
          : pages.slice(Math.max(0, at - 2), at + 1);
        groups.set(key, { gaps: [], candidates });
      }
      groups.get(key)!.gaps.push(gap);
    }
    for (const kept of await mapLimit([...groups.values()], concurrency, (g) => verify(g.gaps, g.candidates))) confirmed.push(...kept);

    // 3. source pages no lesson is bound to
    const unassigned = unassignedSourceAnchors(state);
    if (unassigned.length) {
      const user = `# SOURCE PAGES\n${unassigned.map((a) => anchorEvidence(a)!.slice(0, 2500)).join("\n\n")}\n\n# LESSON OUTLINES\n${pages.map((p) => lessonOutline(state, p)).join("\n\n")}`;
      const key = sha(user);
      let parsed = reviewCache.get(key);
      if (!parsed) {
        const result = parseJsonObject(await input.review({ kind: "unassigned", label: `${unassigned.length} unbound source page(s)`, system: scopedSystemPromptText("learning-unassigned-sources"), user }));
        if (!result || !Array.isArray(result.pages)) throw new Error("source completeness unbound-page review returned no pages array");
        const ids = new Set(unassigned.map((a) => a.id));
        parsed = result.pages.flatMap((raw): SourceCompletenessGap[] => {
          const entry = raw as Record<string, unknown>;
          if (entry.verdict !== "missing" || typeof entry.anchorId !== "string" || !ids.has(entry.anchorId)) return [];
          const lesson = typeof entry.lesson === "string" ? entry.lesson : "";
          return [{ type: "slide", severity: "must", what: String(entry.what ?? "").trim() || `teach source page ${entry.anchorId}`, anchorId: entry.anchorId, where: lesson }];
        });
        reviewCache.set(key, parsed);
      }
      for (const gap of parsed) {
        const target = pages.find((p) => p.rel === gap.where) ?? null;
        if (!target) continue;
        const anchor = state.sourceAnchors[gap.anchorId!];
        // candidates: the target plus lessons bound to neighbouring pages of the same source
        const near = pages.filter((p) => p === target || (anchorsOf.get(p.rel) ?? []).some((id) => {
          const other = state.sourceAnchors[id];
          return other?.sourceId === anchor?.sourceId && Math.abs((other?.page ?? -99) - (anchor?.page ?? 99)) <= 3;
        })).slice(0, 4);
        confirmed.push(...await verify([{ ...gap, where: null, pageRel: target.rel }], near));
      }
    }

    return confirmed.map((gap) => issueFor(gap, state, raises));
  };
}
