/**
 * Partitioned Source Map authoring.
 *
 * The Source Map used to be one model call that returned every source summary,
 * every registered figure, every teaching-evidence binding, and every practice
 * question at once: ~190k input tokens and a ~150 KB answer. Live 2026-09-25
 * (gpt-6-luna, telecom-1 M1) that single answer was malformed twice (a root
 * closed early, surplus closers) and each repair had to regenerate everything.
 *
 * Here the same map is authored in small parts that follow the map's own
 * boundaries: questions, figures, and anchors never cross sources, and each
 * unit's evidence only cites that unit's selected pages. Parts are merged
 * mechanically (concatenate, de-duplicate anchors, renumber question ids) and
 * the merged map must still pass the unchanged whole-map validators.
 */
import type { PlanningEvidencePage, PlanningEvidenceSelection } from "./learn-planning-evidence.ts";

export type SourceMapPart =
  | { kind: "catalog"; key: string; sourceId: string; figureIds?: readonly string[]; chunk?: { index: number; count: number } }
  | { kind: "unit"; key: string; unitId: string }
  | { kind: "practice"; key: string; sourceId: string };

type Json = Record<string, unknown>;

const record = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** Stage-key-safe identity for a part. */
function partKey(kind: SourceMapPart["kind"], id: string): string {
  return `${kind}:${id.replace(/[^A-Za-z0-9_.-]/g, "_")}`;
}

/**
 * One catalog part per selected source, one unit part per teaching-evidence
 * unit record, and one practice part per source that can hold questions: a
 * selected practice source, or one whose pages or figures were flagged as
 * question evidence.
 */
export function sourceMapParts(input: {
  sourceIds: readonly string[];
  selection: PlanningEvidenceSelection;
  questionSourceIds: readonly string[];
  /** Registered figure ids per source, in payload order. */
  figureIdsBySource?: ReadonlyMap<string, readonly string[]>;
}): SourceMapPart[] {
  const practice = new Set([
    ...input.selection.practiceSources
      .filter((source) => source.disposition === "selected" && source.pageAliases.length > 0)
      .map((source) => source.sourceId),
    ...input.questionSourceIds,
  ]);
  return [
    ...input.sourceIds.flatMap((sourceId) => catalogParts(sourceId, input.figureIdsBySource?.get(sourceId) ?? [])),
    ...input.selection.units.map((unit) => ({ kind: "unit" as const, key: partKey("unit", unit.unitId), unitId: unit.unitId })),
    ...input.sourceIds
      .filter((sourceId) => practice.has(sourceId))
      .map((sourceId) => ({ kind: "practice" as const, key: partKey("practice", sourceId), sourceId })),
  ];
}

/**
 * A source with many registered figures is catalogued in figure chunks: one
 * entry per figure made the textbook's part (548 figures, em1 2026-10-10) a
 * 15-18 min answer that the upstream cut again and again. Smaller sources keep
 * their single part and its existing checkpoint key.
 */
export const CATALOG_FIGURES_PER_PART = 120;

function catalogParts(sourceId: string, figureIds: readonly string[]): SourceMapPart[] {
  const key = partKey("catalog", sourceId);
  if (figureIds.length <= CATALOG_FIGURES_PER_PART) return [{ kind: "catalog", key, sourceId }];
  const count = Math.ceil(figureIds.length / CATALOG_FIGURES_PER_PART);
  return Array.from({ length: count }, (_, index) => ({
    kind: "catalog" as const,
    key: `${key}.figures${index + 1}of${count}`,
    sourceId,
    figureIds: figureIds.slice(index * CATALOG_FIGURES_PER_PART, (index + 1) * CATALOG_FIGURES_PER_PART),
    chunk: { index, count },
  }));
}

/** What a part must return, appended to the unchanged Source Map system prompt. */
export function sourceMapPartInstruction(part: SourceMapPart): string {
  const common =
    "\n\nPART SCOPE (hard): this request authors one part of the Source Map; separate requests author the other parts and code merges them. " +
    "Everything above still applies to what you return, but return ONLY the keys listed here, and only for the scope named here.";
  if (part.kind === "catalog") {
    const chunkNote = part.chunk
      ? `
This is figure chunk ${part.chunk.index + 1} of ${part.chunk.count} for this source: the supplied sourceVisuals are only this chunk, and the other chunks cover the source's remaining figures, so never call figures outside this chunk missing or unavailable.`
      : "";
    return `${common}
Scope: source ${part.sourceId}.${chunkNote}
Return ONLY {"sources":[exactly one entry for ${part.sourceId}],"figures":[exactly one entry for every supplied sourceVisuals record],"sourceAnchors":[at least one canonical anchor of this source that best represents it],"missingOrUnclear":[...]}.`;
  }
  if (part.kind === "unit") {
    return `${common}
Scope: syllabus unit ${part.unitId}'s teaching evidence.
Return ONLY {"unitEvidence":[exactly one record for ${part.unitId}],"sourceAnchors":[one entry for every page cited in unitEvidence],"evidenceGaps":[only if needed]}.`;
  }
  return `${common}
Scope: practice source ${part.sourceId}.
Return ONLY {"sourceQuestions":[the relevant questions in this source],"practiceReview":[one entry for every selected practice page of this source],"unresolvedSyllabusQuestionReferences":[one entry for every syllabus question reference this source does not contain, with a reason],"sourceAnchors":[one entry for every page that holds a question],"evidenceGaps":[only if needed]}.
Number question ids Q1, Q2, ...; they are renumbered when the parts are merged.`;
}

/** Filter the monolithic Source Map payload down to one part's evidence. */
export function sourceMapPartPayload(part: SourceMapPart, shared: {
  base: Json;
  sourceContext: Json;
  canonicalSourceAnchors: readonly Json[];
  sourceQuestionEvidence: readonly Json[];
  selection: PlanningEvidenceSelection;
  pages: readonly PlanningEvidencePage[];
}): Json {
  const bySource = (sourceId: string) => (item: unknown) =>
    text(record(item).sourceId) === sourceId || text(record(item).id) === sourceId;
  // The garden-wide hashes change whenever any source gains a scanned figure;
  // carrying them re-asked every part after an unrelated scan.
  const { sourceSetHash: _sourceSetHash, sourceArtifactInventoryHash: _inventoryHash, ...partSourceContext } =
    shared.sourceContext;
  const sourceContextFor = (sourceId: string, figureIds?: readonly string[]): Json => {
    const chunk = figureIds ? new Set(figureIds) : null;
    return {
      ...partSourceContext,
      sources: array(shared.sourceContext.sources).filter((source) => text(record(source).id) === sourceId),
      sourceVisuals: array(shared.sourceContext.sourceVisuals).filter((visual) =>
        bySource(sourceId)(visual) && (!chunk || chunk.has(text(record(visual).sourceVisualId)))),
    };
  };
  if (part.kind === "catalog") {
    return {
      ...shared.base,
      sourceMapPart: { kind: part.kind, sourceId: part.sourceId, ...(part.chunk ? { figureChunk: part.chunk } : {}) },
      sourceContext: sourceContextFor(part.sourceId, part.figureIds),
      canonicalSourceAnchors: shared.canonicalSourceAnchors.filter(bySource(part.sourceId)),
    };
  }
  if (part.kind === "unit") {
    const unit = shared.selection.units.find((candidate) => candidate.unitId === part.unitId);
    const aliases = new Set(unit?.pageAliases ?? []);
    const pages = shared.pages.filter((page) => aliases.has(page.alias));
    const anchorIds = new Set(pages.map((page) => page.anchorId));
    return {
      ...shared.base,
      sourceMapPart: { kind: part.kind, unitId: part.unitId },
      canonicalSourceAnchors: shared.canonicalSourceAnchors.filter((anchor) => anchorIds.has(text(anchor.id))),
      teachingEvidenceSelection: { units: unit ? [unit] : [], practiceSources: [] },
      teachingEvidencePages: pages,
    };
  }
  const practice = shared.selection.practiceSources.find((source) => source.sourceId === part.sourceId);
  const aliases = new Set(practice?.disposition === "selected" ? practice.pageAliases : []);
  return {
    ...shared.base,
    sourceMapPart: { kind: part.kind, sourceId: part.sourceId },
    sourceContext: sourceContextFor(part.sourceId),
    canonicalSourceAnchors: shared.canonicalSourceAnchors.filter(bySource(part.sourceId)),
    sourceQuestionEvidence: shared.sourceQuestionEvidence.filter(bySource(part.sourceId)),
    teachingEvidenceSelection: { units: [], practiceSources: practice ? [practice] : [] },
    teachingEvidencePages: shared.pages.filter((page) => aliases.has(page.alias)),
  };
}

/** The teaching-evidence selection a part answers for, for the page-level validator. */
export function sourceMapPartSelection(
  part: SourceMapPart,
  selection: PlanningEvidenceSelection,
): PlanningEvidenceSelection {
  if (part.kind === "unit") {
    return { units: selection.units.filter((unit) => unit.unitId === part.unitId), practiceSources: [] };
  }
  if (part.kind === "practice") {
    return { units: [], practiceSources: selection.practiceSources.filter((source) => source.sourceId === part.sourceId) };
  }
  return { units: [], practiceSources: [] };
}

/** Anchor-record checks a part can settle alone (mirrors the whole-map rules). */
export function sourceMapPartAnchorProblems(input: {
  value: unknown;
  canonicalAnchors: readonly { id: string; sourceId: string }[];
  sourceIds: readonly string[];
}): string[] {
  const problems: string[] = [];
  const canonical = new Map(input.canonicalAnchors.map((anchor) => [anchor.id, anchor]));
  const expected = new Set(input.sourceIds);
  const seen = new Set<string>();
  const anchors = record(input.value).sourceAnchors;
  if (!Array.isArray(anchors)) return ["sourceAnchors must be an array"];
  anchors.forEach((raw, index) => {
    const anchor = record(raw);
    const id = text(anchor.id).trim();
    const known = canonical.get(id);
    if (!known) problems.push(`sourceAnchors[${index}].id ${id || "(missing)"} must be copied from canonicalSourceAnchors`);
    else if (seen.has(id)) problems.push(`canonical source anchor ${id} appears more than once`);
    seen.add(id);
    // A canonical anchor's sourceId is identity, not judgement: the merge
    // copies it from the catalog. Live 2026-09-25 a unit part (which is not
    // shown the source list) put a page id there through three attempts.
    if (!known && !expected.has(text(anchor.sourceId).trim())) {
      problems.push(`sourceAnchors[${index}].sourceId must be an exact supplied source id`);
    }
    if (!text(anchor.title).trim()) problems.push(`sourceAnchors[${index}].title is required`);
    if (!text(anchor.summary).trim()) problems.push(`sourceAnchors[${index}].summary is required`);
  });
  return problems;
}

export function sourceMapPartGaps(value: unknown): string[] {
  return array(record(value).evidenceGaps).map(String).filter((gap) => gap.trim());
}

/**
 * Merge accepted parts into one Source Map. Code only concatenates, removes
 * duplicate anchors (first wins), renumbers question ids to stay unique, and
 * reconciles syllabus question references: a reference any part mapped is
 * resolved, the rest keep one unresolved record. Every semantic field is the
 * parts' own text.
 */
export function mergeSourceMapParts(input: {
  parts: readonly { part: SourceMapPart; value: unknown }[];
  syllabusQuestionReferences: readonly { unitId: string; reference: string }[];
  /** The catalog's sourceId for a canonical anchor id; anchors take it verbatim. */
  canonicalSourceIdOf?: (anchorId: string) => string | undefined;
}): Json {
  const of = (kind: SourceMapPart["kind"]) => input.parts.filter((entry) => entry.part.kind === kind);
  const anchors = new Map<string, unknown>();
  for (const { value } of input.parts) {
    for (const anchor of array(record(value).sourceAnchors)) {
      const id = text(record(anchor).id);
      const sourceId = input.canonicalSourceIdOf?.(id);
      if (id && !anchors.has(id)) anchors.set(id, sourceId ? { ...record(anchor), sourceId } : anchor);
    }
  }

  let nextQuestion = 1;
  const sourceQuestions: Json[] = [];
  const practiceReview: Json[] = [];
  for (const { value } of of("practice")) {
    const renamed = new Map<string, string>();
    for (const question of array(record(value).sourceQuestions)) {
      const id = `Q${nextQuestion++}`;
      renamed.set(text(record(question).id), id);
      sourceQuestions.push({ ...record(question), id });
    }
    for (const review of array(record(value).practiceReview)) {
      const entry = record(review);
      practiceReview.push({
        ...entry,
        questionIds: array(entry.questionIds).map((qid) => renamed.get(text(qid)) ?? text(qid)),
      });
    }
  }

  const pair = (unitId: string, reference: string) => JSON.stringify([unitId, reference]);
  const resolved = new Set(sourceQuestions.flatMap((question) =>
    array(question.syllabusAssignments).map((raw) => pair(text(record(raw).unitId), text(record(raw).reference)))));
  const unresolved = new Map<string, Json>();
  for (const { value } of of("practice")) {
    for (const raw of array(record(value).unresolvedSyllabusQuestionReferences)) {
      const entry = record(raw);
      const key = pair(text(entry.unitId), text(entry.reference));
      if (!resolved.has(key) && !unresolved.has(key)) unresolved.set(key, entry);
    }
  }
  for (const { unitId, reference } of input.syllabusQuestionReferences) {
    const key = pair(unitId, reference);
    if (!resolved.has(key) && !unresolved.has(key)) {
      unresolved.set(key, { unitId, reference, reason: "No selected practice source was found to contain this reference." });
    }
  }

  return {
    // A chunked source answers its one sources entry in every chunk; keep the first.
    sources: of("catalog").flatMap(({ part, value }) =>
      part.kind === "catalog" && part.chunk && part.chunk.index > 0 ? [] : array(record(value).sources)),
    figures: of("catalog").flatMap(({ value }) => array(record(value).figures)),
    sourceAnchors: [...anchors.values()],
    sourceQuestions,
    unresolvedSyllabusQuestionReferences: [...unresolved.values()],
    missingOrUnclear: [...new Set(of("catalog").flatMap(({ value }) => array(record(value).missingOrUnclear).map(String)))],
    unitEvidence: of("unit").flatMap(({ value }) => array(record(value).unitEvidence)),
    practiceReview,
  };
}

/** Run async work with bounded concurrency, preserving input order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    // After a failure, start no new work; in-flight items finish on their own.
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await work(items[index], index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/** `sourceQuestions[i]` indices whose only failure is an unverifiable prompt. */
export function unverifiablePromptIndices(problems: readonly string[]): number[] | null {
  const indices = new Set<number>();
  for (const problem of problems) {
    const match = /^sourceQuestions\[(\d+)\]\.prompt (?:must be copied verbatim|is not contained in its selected sourceAnchorIds)/.exec(problem);
    if (!match) return null;
    indices.add(Number(match[1]));
  }
  return indices.size ? [...indices].sort((a, b) => a - b) : null;
}

/**
 * Remove questions whose prompts could not be copied verbatim, keeping the
 * part internally consistent: their ids leave practiceReview (named as
 * omitted instead), and a syllabus reference only they resolved becomes an
 * unresolved reference. Code only deletes; it never rewrites a prompt. Used
 * after a practice part's last repair so one unverifiable exercise costs that
 * exercise, not the whole plan. Live 2026-09-26 (gpt-6-luna): Keiser Problem
 * 9-3 gained three extra words through three attempts and failed a 4-hour plan.
 */
export function dropUnverifiableQuestions(value: unknown, indices: readonly number[]): Json {
  const root = record(value);
  const drop = new Set(indices);
  const questions = array(root.sourceQuestions);
  const kept = questions.filter((_, index) => !drop.has(index));
  const dropped = questions.filter((_, index) => drop.has(index)).map(record);
  const droppedIds = new Map(dropped.map((question) => [text(question.id), text(question.label) || text(question.id)]));
  const reason = "Its prompt could not be copied verbatim from the source, so it was left out rather than paraphrased.";
  const practiceReview = array(root.practiceReview).map((raw) => {
    const review = record(raw);
    const ids = array(review.questionIds).map(text);
    const removed = ids.filter((id) => droppedIds.has(id));
    if (!removed.length) return review;
    return {
      ...review,
      questionIds: ids.filter((id) => !droppedIds.has(id)),
      omittedQuestions: [
        ...array(review.omittedQuestions),
        ...removed.map((id) => ({ label: droppedIds.get(id), reason })),
      ],
    };
  });
  const pair = (entry: Json) => JSON.stringify([text(entry.unitId), text(entry.reference)]);
  const stillResolved = new Set(kept.flatMap((question) => array(record(question).syllabusAssignments).map((raw) => pair(record(raw)))));
  const unresolved = array(root.unresolvedSyllabusQuestionReferences).map(record);
  const listed = new Set(unresolved.map(pair));
  for (const question of dropped) {
    for (const raw of array(question.syllabusAssignments)) {
      const entry = record(raw);
      const key = pair(entry);
      if (stillResolved.has(key) || listed.has(key)) continue;
      listed.add(key);
      unresolved.push({ unitId: text(entry.unitId), reference: text(entry.reference), reason });
    }
  }
  return { ...root, sourceQuestions: kept, practiceReview, unresolvedSyllabusQuestionReferences: unresolved };
}

/** Page anchor ids whose only failure is a quote that is not verbatim, or null. */
export function unverifiableQuoteAnchorIds(problems: readonly string[], unitId: string): string[] | null {
  const ids = new Set<string>();
  const prefix = `unitEvidence ${unitId} page `;
  for (const problem of problems) {
    if (!problem.startsWith(prefix)) return null;
    const rest = problem.slice(prefix.length);
    const match = /^(\S+) (?:quote is not an exact substring|quotes a heading line)/.exec(rest);
    if (!match) return null;
    ids.add(match[1]);
  }
  return ids.size ? [...ids] : null;
}

/**
 * Remove pages whose quote could not be verified from a unit part's answer.
 * The unit keeps every page it could prove; code deletes, never rewrites.
 * Live 2026-09-26 (gpt-6-luna): one Molisch quote still off after three
 * attempts left SU5 with no evidence and failed the plan.
 */
export function dropUnitEvidencePages(value: unknown, anchorIds: readonly string[]): Json {
  const root = record(value);
  const drop = new Set(anchorIds);
  return {
    ...root,
    unitEvidence: array(root.unitEvidence).map((raw) => {
      const unit = record(raw);
      return { ...unit, pages: array(unit.pages).filter((page) => !drop.has(text(record(page).anchorId))) };
    }),
  };
}

/**
 * On a practice part's last attempt: which questions to drop (unverifiable
 * prompts) and which selected pages to release (never reviewed), or null
 * when any other problem remains. Live 2026-09-26 (gpt-6-luna): the Couch
 * part left textbook problem pages 250+ unreviewed through three attempts.
 */
export interface PracticeSalvagePlan {
  promptIndices: number[];
  unreviewedPages: string[];
  /** Related-figure ids that name no registered figure, by question index. */
  unknownFigureRefs: { index: number; id: string }[];
}

export function practiceSalvagePlan(problems: readonly string[]): PracticeSalvagePlan | null {
  const prompts = new Set<number>();
  const pages = new Set<string>();
  const figureRefs: { index: number; id: string }[] = [];
  for (const problem of problems) {
    const prompt = /^sourceQuestions\[(\d+)\]\.prompt (?:must be copied verbatim|is not contained in its selected sourceAnchorIds)/.exec(problem);
    if (prompt) { prompts.add(Number(prompt[1])); continue; }
    const page = /^practiceReview omits selected exercise page (\S+)$/.exec(problem);
    if (page) { pages.add(page[1]); continue; }
    // Live 2026-09-30 (gpt-6-sol, Couch practice): equation ids such as
    // S16.P258.E2 listed as related figures failed the whole part. The
    // unresolved reference goes; the verbatim question stays.
    const figure = /^sourceQuestions\[(\d+)\]\.relatedFigureIds references unknown figure (\S+)$/.exec(problem);
    if (figure) { figureRefs.push({ index: Number(figure[1]), id: figure[2] }); continue; }
    return null;
  }
  if (!prompts.size && !pages.size && !figureRefs.length) return null;
  return {
    promptIndices: [...prompts].sort((a, b) => a - b),
    unreviewedPages: [...pages],
    unknownFigureRefs: figureRefs,
  };
}

/** Remove related-figure ids that resolve to no registered figure. */
export function dropUnknownFigureRefs(value: unknown, refs: readonly { index: number; id: string }[]): Json {
  const root = record(value);
  if (!refs.length) return root;
  return {
    ...root,
    sourceQuestions: array(root.sourceQuestions).map((raw, index) => {
      const unknown = new Set(refs.filter((ref) => ref.index === index).map((ref) => ref.id));
      if (!unknown.size) return raw;
      const question = record(raw);
      return { ...question, relatedFigureIds: array(question.relatedFigureIds).filter((id) => !unknown.has(text(id))) };
    }),
  };
}
