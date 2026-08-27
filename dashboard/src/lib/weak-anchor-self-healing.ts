// ===========================================================================
// Weak-anchor self-healing loop
//
// Breadboard already owns every PRIMITIVE needed to repair an actively
// referenced weak source anchor: usage classification, evidence scoring,
// source-text presence/relevance verification, concept-family detection, and
// two-phase atomic anchor replacement with global closure + rollback. What was
// missing is the ORCHESTRATION: a bounded, production-path, deterministic-first
// / ChatMock-second loop that audits the final state, repairs what it can prove
// deterministically, asks ChatMock ONLY for the residual ambiguity, verifies
// every decision independently, applies atomically, rebuilds, re-audits, and
// publishes only when no ACTIVE weak-anchor blocker remains.
//
// Invariants enforced here:
//   * Weak-anchor failures are never suppressed — a repair must move the audit
//     blocker count DOWN or it is rolled back.
//   * UNUSED / historical weak anchors never enter the loop, so they never
//     consume a ChatMock call.
//   * ChatMock can never invent evidence — every excerpt is re-checked against
//     the real source (presence + relevance) and every replacement id must be
//     one we offered.
//   * A repair being "attempted" never counts as success — only a verified,
//     applied, blocker-reducing change does.
//
// This module depends ONLY on the stable, high-level exports of
// final-garden-state.ts. The handful of low-level helpers it needs (source
// paragraph reader, stronger-anchor picker, snapshot/restore) are reimplemented
// locally so the orchestration is self-contained.
// ===========================================================================

import type { Dirent } from "node:fs";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";

import {
  type AnchorConfidence,
  type AnchorUsageStatus,
  type CanonicalSourceAnchor,
  type CanonicalSourceAnchorKind,
  type ConceptFamily,
  type FinalGardenState,
  type SourceTextRelevanceDecision,
  type SourceTextRelevanceResult,
  type SourceTextVerificationResult,
  type SourceUsageKind,
  applyAnchorReplacementPlanAtomically,
  auditFinalGardenState,
  buildAnchorReplacementPlan,
  buildFinalGardenState,
  classifyAnchorUsage,
  detectConceptFamily,
  isRelevanceAcceptableForKind,
  scoreAnchorEvidence,
  verifySourceText,
  verifySourceTextRelevance,
} from "./final-garden-state.ts";

// ---------------------------------------------------------------------------
// Tunables (conservative on purpose — ambiguity escalates instead of guessing).
// ---------------------------------------------------------------------------

/** Best candidate must clear this composite score to be repaired deterministically. */
export const DETERMINISTIC_REPAIR_FLOOR = 0.8;
/** Best must beat the runner-up by at least this margin, else it is ambiguous. */
export const DETERMINISTIC_REPAIR_MARGIN = 0.15;

const DEFAULTS = {
  maxRounds: 3,
  maxIssuesPerRound: 12,
  maxChatMockCallsPerRound: 2,
  maxTotalChatMockCalls: 4,
} as const;

// ---------------------------------------------------------------------------
// Local source-paragraph reader (mirrors final-garden-state's internal parser
// exactly so evidence scores line up with the audit).
// ---------------------------------------------------------------------------

interface SrcPara {
  sourceId: string;
  sourceTitle: string;
  page: number;
  text: string;
}

function splitFrontmatter(content: string): { rawFrontmatter: string; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { rawFrontmatter: "", body: content };
  return { rawFrontmatter: match[1] ?? "", body: match[2] ?? "" };
}

function fmScalar(rawFm: string, key: string): string {
  const match = rawFm.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  if (!match) return "";
  return String(match[1] ?? "").trim().replace(/^["']|["']$/g, "");
}

function walkMarkdown(absDir: string, relDir: string, out: Array<{ abs: string; rel: string }>): void {
  let entries: Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const abs = path.join(absDir, e.name);
    const rel = `${relDir}/${e.name}`;
    if (e.isDirectory()) walkMarkdown(abs, rel, out);
    else if (/\.md$/i.test(e.name)) out.push({ abs, rel });
  }
}

function readTextSafe(p: string): string | undefined {
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return undefined;
  }
}

function readSourceParagraphs(gardenDir: string): SrcPara[] {
  const files: Array<{ abs: string; rel: string }> = [];
  walkMarkdown(path.join(gardenDir, "sources"), "sources", files);
  const out: SrcPara[] = [];
  for (const { abs, rel } of files) {
    if (/(^|\/)_index\.md$/i.test(rel)) continue;
    const text = readTextSafe(abs);
    if (text === undefined) continue;
    const { rawFrontmatter, body } = splitFrontmatter(text);
    const sourceId = fmScalar(rawFrontmatter, "sourceId") || path.basename(rel, ".md");
    const sourceTitle = fmScalar(rawFrontmatter, "title") || path.basename(rel, ".md");
    let page = 0;
    let buffer: string[] = [];
    const flush = (): void => {
      const para = buffer.join(" ").replace(/\s+/g, " ").trim();
      if (page > 0 && para.length >= 40) out.push({ sourceId, sourceTitle, page, text: para });
      buffer = [];
    };
    for (const line of body.split(/\r?\n/)) {
      const header = line.match(/^#{1,3}\s*Page\s+(\d+)\b/i);
      if (header) {
        flush();
        page = Number.parseInt(header[1] ?? "0", 10);
        continue;
      }
      if (/^#{1,6}\s/.test(line)) {
        flush();
        continue;
      }
      if (line.trim() === "") {
        flush();
        continue;
      }
      buffer.push(line.trim());
    }
    flush();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Local stronger-existing-anchor picker (conservative: same source, literal
// keyword overlap ≥ 2, and at least as strong as the weak anchor).
// ---------------------------------------------------------------------------

const CONFIDENCE_RANK: Record<AnchorConfidence, number> = { unsupported: 0, low: 1, medium: 2, high: 3 };
const STOPWORDS = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "over", "under", "of", "to", "in", "on", "a", "an", "is", "are", "as", "by", "or"]);

function anchorStrength(anchor: CanonicalSourceAnchor): number {
  return anchor.confidence ? CONFIDENCE_RANK[anchor.confidence] : CONFIDENCE_RANK.high;
}

function literalConceptTokens(anchor: CanonicalSourceAnchor): Set<string> {
  const tokens = new Set<string>();
  for (const kw of anchor.conceptKeywords ?? []) tokens.add(kw.toLowerCase());
  for (const word of String(anchor.title ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) {
    if (word.length >= 3 && !STOPWORDS.has(word)) tokens.add(word);
  }
  return tokens;
}

function pickStrongerExistingCandidate(
  anchorId: string,
  keywords: string[],
  inferredPage: number | undefined,
  sourceId: string,
  registry: Record<string, CanonicalSourceAnchor>,
  candidateConfidence: AnchorConfidence,
): string | undefined {
  const wants = keywords.map((k) => k.toLowerCase());
  let best: { id: string; score: number } | null = null;
  for (const anchor of Object.values(registry)) {
    if (anchor.id === anchorId) continue;
    if (anchor.kind === "formula" || anchor.kind === "figure" || anchor.kind === "table" || anchor.kind === "graph") continue;
    if (sourceId && anchor.sourceId && anchor.sourceId !== sourceId) continue;
    const tokens = literalConceptTokens(anchor);
    const overlap = wants.filter((k) => tokens.has(k)).length;
    const samePage = inferredPage != null && anchor.page != null && Math.abs(anchor.page - inferredPage) <= 1;
    const structural = anchor.origin === "structural_ledger" && !anchor.confidence;
    const qualifies = overlap >= 2 || (samePage && overlap >= 1 && structural);
    if (!qualifies) continue;
    if (anchorStrength(anchor) < CONFIDENCE_RANK[candidateConfidence]) continue;
    const score = overlap * 10 + (samePage ? 3 : 0) + anchorStrength(anchor);
    if (!best || score > best.score) best = { id: anchor.id, score };
  }
  return best?.id;
}

// ---------------------------------------------------------------------------
// Local snapshot / restore for ledger-only rollbacks.
// ---------------------------------------------------------------------------

function snapshotGarden(gardenDir: string): Map<string, string> {
  const snap = new Map<string, string>();
  const walk = (abs: string): void => {
    let entries: Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(abs, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(md|json)$/i.test(e.name)) {
        const rel = path.relative(gardenDir, p).split(path.sep).join("/");
        const t = readTextSafe(p);
        if (t !== undefined) snap.set(rel, t);
      }
    }
  };
  for (const root of ["learning", ".breadboard"]) {
    const abs = path.join(gardenDir, root);
    if (fs.existsSync(abs)) walk(abs);
  }
  return snap;
}

function restoreGarden(gardenDir: string, snap: Map<string, string>): void {
  for (const [rel, content] of snap) {
    const abs = path.join(gardenDir, ...rel.split("/"));
    if (readTextSafe(abs) !== content) fs.writeFileSync(abs, content, "utf-8");
  }
}

// ===========================================================================
// Part 1 — the typed weak-anchor repair issue.
// ===========================================================================

/** A NORMALIZED failure category — never the raw audit sentence. Two audits that
 *  phrase the same defect differently must collapse to the same reason so the
 *  issue identity is stable across rounds/rebuilds. */
export type WeakAnchorFailureReason =
  | "low_confidence_evidence"
  | "unsupported_confidence_evidence"
  | "irrelevant_source_text"
  | "wrong_concept_family";

export interface WeakAnchorUsageTarget {
  /** page rel, contract unit id, or visual id. */
  ref: string;
  kind: SourceUsageKind | "page" | "contract_unit" | "visual";
}

export interface WeakAnchorRepairIssue {
  /** Deterministic identity built from anchor id + usage targets + kind +
   *  concept family + normalized failure category. NEVER the error sentence, so
   *  the same defect keeps one identity even as wording changes. */
  stableIdentity: string;
  anchorId: string;
  kind: string;
  title: string;
  conceptFamily: ConceptFamily;
  conceptKeywords: string[];
  confidence: AnchorConfidence;
  failureReason: WeakAnchorFailureReason;
  usageStatus: AnchorUsageStatus;
  usageTargets: WeakAnchorUsageTarget[];
  sourceId?: string;
  page?: number;
  evidenceScore?: number;
}

function normalizedFailureReason(anchor: CanonicalSourceAnchor): WeakAnchorFailureReason {
  if (anchor.confidence === "unsupported") return "unsupported_confidence_evidence";
  if ((anchor.evidence?.negativeEvidencePenalty ?? 0) > 0) return "wrong_concept_family";
  if (anchor.relevance?.decision === "irrelevant") return "irrelevant_source_text";
  return "low_confidence_evidence";
}

function conceptFamilyOfAnchor(anchor: CanonicalSourceAnchor): ConceptFamily {
  const basis = [anchor.title ?? "", ...(anchor.conceptKeywords ?? [])].join(" ");
  return detectConceptFamily(basis).family;
}

function buildStableIdentity(
  anchor: CanonicalSourceAnchor,
  family: ConceptFamily,
  reason: WeakAnchorFailureReason,
  usageTargets: WeakAnchorUsageTarget[],
): string {
  const usages = usageTargets
    .map((u) => `${u.kind}:${u.ref}`)
    .sort()
    .join(",");
  return `weak-anchor|id=${anchor.id}|kind=${anchor.kind}|family=${family}|reason=${reason}|usages=${usages}`;
}

function usageTargetsForAnchor(state: FinalGardenState, anchorId: string): WeakAnchorUsageTarget[] {
  const seen = new Set<string>();
  const out: WeakAnchorUsageTarget[] = [];
  const push = (ref: string, kind: WeakAnchorUsageTarget["kind"]): void => {
    const key = `${kind}:${ref}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ref, kind });
  };
  // Prefer the precise usage kind from the reconciled usage records.
  for (const usage of state.sourceUsages) {
    if (usage.anchorId === anchorId) push(usage.pageRel, usage.kind);
  }
  for (const page of state.pages) {
    if (
      page.sourceAnchors.includes(anchorId) ||
      page.sourceFormulaAnchors.includes(anchorId) ||
      page.sourceVisualIds.includes(anchorId)
    ) {
      push(page.rel, "page");
    }
  }
  for (const unit of state.learningUnitContract.units) {
    if ((unit.sourceAnchors ?? []).includes(anchorId)) push(unit.id, "contract_unit");
  }
  for (const visual of state.visuals) {
    if ([...visual.anchorIds, ...visual.textAnchorIds].includes(anchorId)) push(visual.id, "visual");
  }
  return out;
}

// ===========================================================================
// Part 2 — collect the ACTIVE weak-anchor issues from the reconciled state.
//   * active state only (classifyAnchorUsage) — no repair/critic/migration history;
//   * only low/unsupported, not-yet-critic-confirmed GENERATED anchors block.
// ===========================================================================

export function collectWeakAnchorRepairIssues(state: FinalGardenState): WeakAnchorRepairIssue[] {
  const usage = classifyAnchorUsage(state);
  const issues: WeakAnchorRepairIssue[] = [];
  for (const anchor of Object.values(state.sourceAnchors)) {
    if (!anchor.confidence || anchor.criticConfirmed) continue;
    if (anchor.confidence !== "low" && anchor.confidence !== "unsupported") continue;
    if (usage[anchor.id] !== "actively_referenced") continue; // unused/historical never block
    const family = conceptFamilyOfAnchor(anchor);
    const reason = normalizedFailureReason(anchor);
    const usageTargets = usageTargetsForAnchor(state, anchor.id);
    issues.push({
      stableIdentity: buildStableIdentity(anchor, family, reason, usageTargets),
      anchorId: anchor.id,
      kind: anchor.kind,
      title: anchor.title ?? anchor.id,
      conceptFamily: family,
      conceptKeywords: anchor.conceptKeywords ?? [],
      confidence: anchor.confidence,
      failureReason: reason,
      usageStatus: "actively_referenced",
      usageTargets,
      sourceId: anchor.sourceId,
      page: anchor.page,
      evidenceScore: anchor.evidence?.totalScore,
    });
  }
  return issues.sort((a, b) => a.stableIdentity.localeCompare(b.stableIdentity));
}

/** The authoritative publish-gate count for THIS category (mirrors the audit). */
export function activeWeakAnchorBlockerCount(state: FinalGardenState): number {
  return auditFinalGardenState(state).byRule.anchor_evidence?.length ?? 0;
}

// ===========================================================================
// Part 3 — deterministic candidate search (existing anchors + source passages).
// ===========================================================================

export type AnchorRepairCandidateKind = "existing_anchor" | "source_passage";

export interface AnchorRepairCandidate {
  kind: AnchorRepairCandidateKind;
  /** existing_anchor only. */
  replacementAnchorId?: string;
  /** source_passage only. */
  sourceId?: string;
  page?: number;
  exactText?: string;
  evidenceConfidence: AnchorConfidence;
  evidenceScore: number;
  relevance: SourceTextRelevanceDecision;
  relevanceScore: number;
  wrongFamilyPenalty: number;
  familyCompatible: boolean;
  supportsAllUsages: boolean;
  /** Combined ranking score in [0,1]. */
  score: number;
  reason: string;
}

const CONFIDENCE_WEIGHT: Record<AnchorConfidence, number> = { high: 1, medium: 0.7, low: 0.4, unsupported: 0.1 };

function relevanceAnchorFor(issue: WeakAnchorRepairIssue): {
  id: string;
  title: string;
  kind: string;
  conceptKeywords: string[];
  semanticSummary: string;
} {
  return {
    id: issue.anchorId,
    title: issue.title,
    kind: issue.kind,
    conceptKeywords: issue.conceptKeywords,
    semanticSummary: issue.title,
  };
}

function candidateSupportsAllUsages(issue: WeakAnchorRepairIssue, relevance: SourceTextRelevanceResult): boolean {
  // A passage must be acceptable for the anchor's kind AND, when the anchor is
  // referenced by a formula/definition/text usage, be flat-out relevant (not
  // merely "weak"). Broad kinds (abstract/intro/guidance) may accept weak relevance.
  const strictUsage = issue.usageTargets.some(
    (u) => u.kind === "formula_definition" || u.kind === "worked_example" || u.kind === "text_concept",
  );
  if (strictUsage) return relevance.decision === "relevant";
  return isRelevanceAcceptableForKind(relevance, issue.kind, "high");
}

/** Rank the strongest deterministic repair options for one weak anchor. */
export function findAnchorRepairCandidates(
  gardenDir: string,
  issue: WeakAnchorRepairIssue,
  state: FinalGardenState,
  paragraphs?: SrcPara[],
): AnchorRepairCandidate[] {
  const anchorLike = relevanceAnchorFor(issue);
  const candidates: AnchorRepairCandidate[] = [];

  // (a) A genuinely stronger EXISTING canonical anchor that covers this concept.
  const existingId = pickStrongerExistingCandidate(
    issue.anchorId,
    issue.conceptKeywords,
    issue.page,
    issue.sourceId ?? "",
    state.sourceAnchors,
    issue.confidence,
  );
  if (existingId && state.sourceAnchors[existingId]) {
    const existing = state.sourceAnchors[existingId];
    const excerpt = existing.exactText ?? existing.semanticSummary ?? existing.title ?? "";
    const relevance = verifySourceTextRelevance(anchorLike, excerpt);
    const evidenceConfidence = existing.confidence ?? "high";
    const relScore = relevance.totalScore;
    const evScore = CONFIDENCE_WEIGHT[evidenceConfidence];
    candidates.push({
      kind: "existing_anchor",
      replacementAnchorId: existingId,
      sourceId: existing.sourceId,
      page: existing.page,
      exactText: existing.exactText,
      evidenceConfidence,
      evidenceScore: Number(evScore.toFixed(3)),
      relevance: relevance.decision,
      relevanceScore: Number(relScore.toFixed(3)),
      wrongFamilyPenalty: relevance.wrongFamilyPenalty,
      familyCompatible: relevance.wrongFamilyPenalty === 0,
      supportsAllUsages: candidateSupportsAllUsages(issue, relevance),
      score: Number((0.5 * relScore + 0.5 * evScore).toFixed(3)),
      reason: `existing ${evidenceConfidence}-confidence anchor ${existingId} (relevance ${relevance.decision})`,
    });
  }

  // (b) Real source passages that support the anchor's meaning. Scope to the
  //     anchor's own source when known, else search everything.
  const allParas = paragraphs ?? readSourceParagraphs(gardenDir);
  const scoped = issue.sourceId ? allParas.filter((p) => p.sourceId === issue.sourceId) : allParas;
  const pool = scoped.length ? scoped : allParas;
  const scoredPassages = pool
    .map((para) => {
      const relevance = verifySourceTextRelevance(anchorLike, para.text);
      const evidence = scoreAnchorEvidence({
        anchorId: issue.anchorId,
        title: issue.title,
        kind: issue.kind as CanonicalSourceAnchorKind,
        conceptKeywords: issue.conceptKeywords,
        sourceId: para.sourceId,
        requestedPage: para.page,
        paragraphs: [para],
      });
      return { para, relevance, evidence };
    })
    .filter((s) => s.relevance.decision !== "irrelevant" && s.evidence.exactText.length >= 12)
    .sort(
      (a, b) =>
        b.relevance.totalScore + b.evidence.totalScore - (a.relevance.totalScore + a.evidence.totalScore) ||
        a.para.page - b.para.page,
    )
    .slice(0, 4);

  for (const s of scoredPassages) {
    const relScore = s.relevance.totalScore;
    const evScore = s.evidence.totalScore;
    candidates.push({
      kind: "source_passage",
      sourceId: s.evidence.sourceId || s.para.sourceId,
      page: s.evidence.matchedPage ?? s.para.page,
      exactText: s.evidence.exactText,
      evidenceConfidence: s.evidence.confidence,
      evidenceScore: Number(evScore.toFixed(3)),
      relevance: s.relevance.decision,
      relevanceScore: Number(relScore.toFixed(3)),
      wrongFamilyPenalty: s.relevance.wrongFamilyPenalty,
      familyCompatible: s.relevance.wrongFamilyPenalty === 0,
      supportsAllUsages: candidateSupportsAllUsages(issue, s.relevance),
      score: Number((0.5 * relScore + 0.5 * evScore).toFixed(3)),
      reason: `source passage p${s.para.page} (${s.evidence.confidence} evidence, relevance ${s.relevance.decision})`,
    });
  }

  return candidates.sort(
    (a, b) =>
      b.score - a.score ||
      (b.exactText ?? b.replacementAnchorId ?? "").localeCompare(a.exactText ?? a.replacementAnchorId ?? ""),
  );
}

// ===========================================================================
// Part 4 — deterministic repair policy.
// ===========================================================================

export type DeterministicRepairAction =
  | "reground_from_source"
  | "replace_with_existing_anchor"
  | "escalate_to_chatmock"
  | "no_candidate";

export interface DeterministicAnchorRepairDecision {
  issueIdentity: string;
  anchorId: string;
  action: DeterministicRepairAction;
  candidate?: AnchorRepairCandidate;
  bestScore?: number;
  runnerUpScore?: number;
  margin?: number;
  reason: string;
}

/** Repair deterministically ONLY when a single candidate is unambiguously
 *  correct: relevant, medium+ evidence, family-compatible (zero wrong-family
 *  penalty), supports every usage, clears the conservative floor, AND clearly
 *  beats the runner-up. Anything closer is handed to ChatMock. */
export function decideDeterministicAnchorRepair(
  issue: WeakAnchorRepairIssue,
  candidates: AnchorRepairCandidate[],
): DeterministicAnchorRepairDecision {
  if (candidates.length === 0) {
    return { issueIdentity: issue.stableIdentity, anchorId: issue.anchorId, action: "no_candidate", reason: "no supporting anchor or source passage found" };
  }
  const best = candidates[0];
  const runnerUp = candidates[1];
  const margin = Number((best.score - (runnerUp?.score ?? 0)).toFixed(3));

  const gates: Array<[boolean, string]> = [
    [best.relevance === "relevant", `best relevance is ${best.relevance}, not relevant`],
    [best.evidenceConfidence === "high" || best.evidenceConfidence === "medium", `best evidence is ${best.evidenceConfidence}`],
    [best.familyCompatible && best.wrongFamilyPenalty === 0, "best has a wrong-family penalty"],
    [best.supportsAllUsages, "best does not support all usages"],
    [best.score >= DETERMINISTIC_REPAIR_FLOOR, `best score ${best.score} < floor ${DETERMINISTIC_REPAIR_FLOOR}`],
    [margin >= DETERMINISTIC_REPAIR_MARGIN, `best beats runner-up by only ${margin} (< ${DETERMINISTIC_REPAIR_MARGIN})`],
  ];
  const failed = gates.find(([ok]) => !ok);
  if (failed) {
    return {
      issueIdentity: issue.stableIdentity,
      anchorId: issue.anchorId,
      action: "escalate_to_chatmock",
      candidate: best,
      bestScore: best.score,
      runnerUpScore: runnerUp?.score,
      margin,
      reason: `ambiguous for deterministic repair (${failed[1]})`,
    };
  }
  return {
    issueIdentity: issue.stableIdentity,
    anchorId: issue.anchorId,
    action: best.kind === "existing_anchor" ? "replace_with_existing_anchor" : "reground_from_source",
    candidate: best,
    bestScore: best.score,
    runnerUpScore: runnerUp?.score,
    margin,
    reason: `unambiguous: ${best.reason}; margin ${margin} over runner-up`,
  };
}

// ===========================================================================
// Part 5 — batching (same source + compatible family; decisions stay per-issue).
// ===========================================================================

export interface WeakAnchorRepairBatch {
  batchId: string;
  sourceId?: string;
  conceptFamily: ConceptFamily;
  issues: WeakAnchorRepairIssue[];
}

export function batchWeakAnchorRepairIssues(issues: WeakAnchorRepairIssue[]): WeakAnchorRepairBatch[] {
  const byKey = new Map<string, WeakAnchorRepairBatch>();
  for (const issue of issues) {
    const key = `${issue.sourceId ?? "?"}::${issue.conceptFamily}`;
    let batch = byKey.get(key);
    if (!batch) {
      batch = { batchId: key, sourceId: issue.sourceId, conceptFamily: issue.conceptFamily, issues: [] };
      byKey.set(key, batch);
    }
    batch.issues.push(issue);
  }
  return [...byKey.values()].sort((a, b) => a.batchId.localeCompare(b.batchId));
}

// ===========================================================================
// Part 6 — the targeted ChatMock packet (one anchor, not the whole garden).
// ===========================================================================

export interface WeakAnchorRepairPacket {
  issueIdentity: string;
  anchor: {
    id: string;
    kind: string;
    title: string;
    conceptKeywords: string[];
    semanticSummary?: string;
    sourceId?: string;
    page?: number;
    confidence: AnchorConfidence;
    currentExactText?: string;
  };
  failureReason: WeakAnchorFailureReason;
  referencedBy: { pages: string[]; unitIds: string[]; visuals: string[] };
  candidatePassages: Array<{ sourceId?: string; page?: number; exactText: string; relevance: string; evidenceConfidence: string; score: number }>;
  existingAlternativeAnchors: Array<{ id: string; kind: string; title: string; sourceId?: string; page?: number; exactText?: string }>;
  rules: string[];
}

const PACKET_RULES = [
  "Only choose from the candidatePassages or existingAlternativeAnchors provided; do NOT invent a passage, an anchor id, or a page number.",
  "For confirm_current_grounding or reground_from_source you MUST return a verbatim exactText that appears in the source; paraphrase is rejected.",
  "For replace_with_existing_anchor the replacementAnchorId MUST be one of existingAlternativeAnchors.",
  "If nothing here supports the anchor's meaning, return reject_no_grounding — do not fabricate support.",
];

export function buildWeakAnchorRepairPacket(
  issue: WeakAnchorRepairIssue,
  candidates: AnchorRepairCandidate[],
  state: FinalGardenState,
): WeakAnchorRepairPacket {
  const anchor = state.sourceAnchors[issue.anchorId];
  return {
    issueIdentity: issue.stableIdentity,
    anchor: {
      id: issue.anchorId,
      kind: issue.kind,
      title: issue.title,
      conceptKeywords: issue.conceptKeywords,
      semanticSummary: anchor?.semanticSummary,
      sourceId: issue.sourceId,
      page: issue.page,
      confidence: issue.confidence,
      currentExactText: anchor?.exactText,
    },
    failureReason: issue.failureReason,
    referencedBy: {
      pages: issue.usageTargets
        .filter((u) => u.kind === "page" || u.kind === "page_prose" || u.kind === "formula_definition" || u.kind === "worked_example" || u.kind === "text_concept")
        .map((u) => u.ref),
      unitIds: issue.usageTargets.filter((u) => u.kind === "contract_unit").map((u) => u.ref),
      visuals: issue.usageTargets
        .filter((u) => u.kind === "visual" || u.kind === "visual_grounding" || u.kind === "source_crop")
        .map((u) => u.ref),
    },
    candidatePassages: candidates
      .filter((c) => c.kind === "source_passage" && c.exactText)
      .map((c) => ({ sourceId: c.sourceId, page: c.page, exactText: c.exactText!, relevance: c.relevance, evidenceConfidence: c.evidenceConfidence, score: c.score })),
    existingAlternativeAnchors: candidates
      .filter((c) => c.kind === "existing_anchor" && c.replacementAnchorId)
      .map((c) => {
        const a = state.sourceAnchors[c.replacementAnchorId!];
        return { id: c.replacementAnchorId!, kind: a?.kind ?? "text_concept", title: a?.title ?? c.replacementAnchorId!, sourceId: a?.sourceId, page: a?.page, exactText: a?.exactText };
      }),
    rules: PACKET_RULES,
  };
}

// ===========================================================================
// Part 7 — the structured decision (deterministic OR ChatMock).
// ===========================================================================

export type WeakAnchorDecisionKind =
  | "confirm_current_grounding"
  | "reground_from_source"
  | "replace_with_existing_anchor"
  | "reject_no_grounding";

export interface WeakAnchorRepairDecision {
  issueIdentity: string;
  anchorId: string;
  decision: WeakAnchorDecisionKind;
  confidence: "high" | "medium" | "low";
  reason: string;
  exactText?: string;
  sourceId?: string;
  page?: number;
  replacementAnchorId?: string;
  /** How the decision was produced. */
  origin: "deterministic" | "chatmock";
}

/** A caller-injected ChatMock adapter. Returning null means "no decision". It may
 *  throw to signal ChatMock is unavailable (e.g. HTTP 502); the loop treats that
 *  as critic-unavailable and stops spending the budget. */
export type WeakAnchorRepairModel = (
  packet: WeakAnchorRepairPacket,
) => Promise<WeakAnchorRepairDecision | null> | WeakAnchorRepairDecision | null;

/** Turn a passed deterministic decision into the common decision shape. */
function deterministicDecisionOf(
  issue: WeakAnchorRepairIssue,
  det: DeterministicAnchorRepairDecision,
): WeakAnchorRepairDecision | null {
  const c = det.candidate;
  if (!c) return null;
  if (det.action === "replace_with_existing_anchor") {
    return {
      issueIdentity: issue.stableIdentity,
      anchorId: issue.anchorId,
      decision: "replace_with_existing_anchor",
      confidence: "high",
      reason: det.reason,
      replacementAnchorId: c.replacementAnchorId,
      origin: "deterministic",
    };
  }
  if (det.action === "reground_from_source") {
    return {
      issueIdentity: issue.stableIdentity,
      anchorId: issue.anchorId,
      decision: "reground_from_source",
      confidence: "high",
      reason: det.reason,
      exactText: c.exactText,
      sourceId: c.sourceId,
      page: c.page,
      origin: "deterministic",
    };
  }
  return null;
}

// ===========================================================================
// Part 8 — INDEPENDENT verification of a decision (deterministic or ChatMock).
// ===========================================================================

export interface WeakAnchorDecisionVerification {
  ok: boolean;
  issueIdentity: string;
  anchorId: string;
  /** Whether applying the decision can actually clear the blocker. */
  resolvesBlocker: boolean;
  checks: {
    targetsIssueAnchor: boolean;
    exactTextPresent?: SourceTextVerificationResult;
    relevance?: SourceTextRelevanceResult;
    relevanceAcceptable?: boolean;
    familyCompatible?: boolean;
    replacementKnown?: boolean;
    replacementInRegistry?: boolean;
    replacementCompatible?: boolean;
  };
  reason: string;
}

export function verifyWeakAnchorRepairDecision(
  gardenDir: string,
  issue: WeakAnchorRepairIssue,
  decision: WeakAnchorRepairDecision,
  packet: WeakAnchorRepairPacket,
  state: FinalGardenState,
): WeakAnchorDecisionVerification {
  const base = { issueIdentity: issue.stableIdentity, anchorId: issue.anchorId };
  const anchorLike = relevanceAnchorFor(issue);

  // Guard 0 — a decision must target the issue's own anchor.
  if (decision.anchorId !== issue.anchorId) {
    return { ...base, ok: false, resolvesBlocker: false, checks: { targetsIssueAnchor: false }, reason: `decision targets ${decision.anchorId}, not ${issue.anchorId}` };
  }

  if (decision.decision === "reject_no_grounding") {
    // Structurally valid, but it does NOT ground the anchor → cannot clear the blocker.
    return { ...base, ok: true, resolvesBlocker: false, checks: { targetsIssueAnchor: true }, reason: "rejection is valid but leaves the anchor blocking" };
  }

  if (decision.decision === "replace_with_existing_anchor") {
    const rid = decision.replacementAnchorId ?? "";
    const known = packet.existingAlternativeAnchors.some((a) => a.id === rid);
    const inRegistry = Boolean(state.sourceAnchors[rid]);
    let compatible = false;
    let relevance: SourceTextRelevanceResult | undefined;
    if (inRegistry) {
      const repl = state.sourceAnchors[rid];
      const excerpt = repl.exactText ?? repl.semanticSummary ?? repl.title ?? "";
      relevance = verifySourceTextRelevance(anchorLike, excerpt);
      compatible = relevance.wrongFamilyPenalty === 0 && relevance.decision !== "irrelevant";
    }
    const ok = known && inRegistry && compatible;
    return {
      ...base,
      ok,
      resolvesBlocker: ok,
      checks: { targetsIssueAnchor: true, replacementKnown: known, replacementInRegistry: inRegistry, replacementCompatible: compatible, relevance },
      reason: ok
        ? `replacement ${rid} is offered, registered, and semantically compatible`
        : `replacement ${rid} rejected (${!known ? "not offered" : !inRegistry ? "not in registry" : "wrong family / irrelevant"})`,
    };
  }

  // confirm_current_grounding | reground_from_source → verbatim source presence + relevance.
  const exactText = decision.exactText ?? "";
  if (exactText.trim().length < 12) {
    return { ...base, ok: false, resolvesBlocker: false, checks: { targetsIssueAnchor: true }, reason: "decision provided no verbatim exactText to verify" };
  }
  const presence = verifySourceText(gardenDir, exactText, { sourceId: decision.sourceId, page: decision.page });
  const relevance = verifySourceTextRelevance(anchorLike, exactText);
  const relevanceAcceptable = isRelevanceAcceptableForKind(relevance, issue.kind, decision.confidence);
  const familyCompatible = relevance.wrongFamilyPenalty === 0;
  const ok = presence.ok && relevanceAcceptable && familyCompatible;
  return {
    ...base,
    ok,
    resolvesBlocker: ok,
    checks: { targetsIssueAnchor: true, exactTextPresent: presence, relevance, relevanceAcceptable, familyCompatible },
    reason: ok
      ? `excerpt is present in source (${presence.matchType}) and supports the anchor (${relevance.decision})`
      : `excerpt rejected (${!presence.ok ? "not found in source" : !relevanceAcceptable ? `relevance ${relevance.decision} insufficient` : "wrong concept family"})`,
  };
}

// ===========================================================================
// Part 9 — atomic application with rollback; commit only if blockers decrease.
// ===========================================================================

export interface WeakAnchorRepairApplicationResult {
  issueIdentity: string;
  anchorId: string;
  applied: boolean;
  action: "reground" | "confirm" | "replace" | "none";
  origin: "deterministic" | "chatmock";
  updatedFiles: string[];
  blockersBefore: number;
  blockersAfter: number;
  rolledBack: boolean;
  reason: string;
}

function ledgerPathOf(gardenDir: string): string {
  return path.join(gardenDir, ".breadboard", "source-anchors.json");
}

/** Patch a canonical anchor record wherever it lives (text-concept OR structural). */
function updateLedgerAnchorRecord(gardenDir: string, anchorId: string, patch: Record<string, unknown>): boolean {
  const p = ledgerPathOf(gardenDir);
  const raw = readTextSafe(p);
  if (raw === undefined) return false;
  const json = JSON.parse(raw) as Record<string, unknown>;
  let touched = false;
  for (const key of ["sourceTextConceptAnchors", "sourceStructuralAnchors"]) {
    const arr = Array.isArray(json[key]) ? (json[key] as Array<Record<string, unknown>>) : [];
    const rec = arr.find((r) => String(r.id ?? "") === anchorId);
    if (rec) {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete rec[k];
        else rec[k] = v;
      }
      json[key] = arr;
      touched = true;
    }
  }
  if (touched) fs.writeFileSync(p, `${JSON.stringify(json, null, 2)}\n`, "utf-8");
  return touched;
}

/** Apply one VERIFIED decision atomically. Confirm/reground touch only the
 *  ledger (rolled back from a snapshot on failure); replacement runs the
 *  two-phase atomic planner (which self-rolls-back on closure failure). In every
 *  case the change is kept ONLY if the audit's weak-anchor blocker count drops. */
export function applyVerifiedWeakAnchorDecision(
  gardenDir: string,
  gardenSlug: string | undefined,
  issue: WeakAnchorRepairIssue,
  decision: WeakAnchorRepairDecision,
  verification: WeakAnchorDecisionVerification,
  state: FinalGardenState,
): WeakAnchorRepairApplicationResult {
  const base = { issueIdentity: issue.stableIdentity, anchorId: issue.anchorId, origin: decision.origin };
  const blockersBefore = activeWeakAnchorBlockerCount(state);

  if (!verification.ok || !verification.resolvesBlocker) {
    return { ...base, applied: false, action: "none", updatedFiles: [], blockersBefore, blockersAfter: blockersBefore, rolledBack: false, reason: `not applied — verification did not clear it: ${verification.reason}` };
  }

  const snapshot = snapshotGarden(gardenDir);

  // ---- Replacement: two-phase atomic planner. ----
  if (decision.decision === "replace_with_existing_anchor") {
    const plan = buildAnchorReplacementPlan(
      [{ oldAnchorId: issue.anchorId, proposedNewAnchorId: decision.replacementAnchorId!, reason: "critic_replacement", requestedBy: "weak_anchor_self_healing" }],
      Object.values(state.sourceAnchors),
    );
    const application = applyAnchorReplacementPlanAtomically(gardenDir, state, plan);
    const after = buildFinalGardenState(gardenDir, gardenSlug);
    const blockersAfter = activeWeakAnchorBlockerCount(after);
    if (!application.applied || blockersAfter >= blockersBefore) {
      restoreGarden(gardenDir, snapshot);
      return { ...base, applied: false, action: "replace", updatedFiles: [], blockersBefore, blockersAfter, rolledBack: true, reason: application.applied ? `replacement applied but blockers did not drop (${blockersBefore}→${blockersAfter}); rolled back` : `replacement not applied: ${application.reason}` };
    }
    return { ...base, applied: true, action: "replace", updatedFiles: application.updatedFiles, blockersBefore, blockersAfter, rolledBack: false, reason: `replaced ${issue.anchorId} → ${decision.replacementAnchorId} (blockers ${blockersBefore}→${blockersAfter})` };
  }

  // ---- Reground: re-score the anchor against the verified passage. ----
  if (decision.decision === "reground_from_source") {
    const evidence = scoreAnchorEvidence({
      anchorId: issue.anchorId,
      title: issue.title,
      kind: issue.kind as CanonicalSourceAnchorKind,
      conceptKeywords: issue.conceptKeywords,
      sourceId: decision.sourceId,
      requestedPage: decision.page,
      paragraphs: readSourceParagraphs(gardenDir).filter((p) => !decision.sourceId || p.sourceId === decision.sourceId),
    });
    const weakEvidence = evidence.confidence === "low" || evidence.confidence === "unsupported";
    updateLedgerAnchorRecord(gardenDir, issue.anchorId, {
      exactText: decision.exactText,
      sourceId: evidence.sourceId || decision.sourceId || issue.sourceId,
      page: evidence.matchedPage ?? decision.page ?? issue.page,
      confidence: evidence.confidence,
      evidence: {
        matchedPage: evidence.matchedPage,
        keywordHits: evidence.keywordHits,
        missingKeywords: evidence.missingKeywords,
        titleOverlapScore: evidence.titleOverlapScore,
        keywordCoverageScore: evidence.keywordCoverageScore,
        pageMatchScore: evidence.pageMatchScore,
        contextSpecificityScore: evidence.contextSpecificityScore,
        negativeEvidencePenalty: evidence.negativeEvidencePenalty,
        totalScore: evidence.totalScore,
        decision: evidence.decision,
      },
      // If the passage only re-scores to "low", vouch for it explicitly so the
      // verified grounding is not lost — verification already proved presence +
      // relevance, so this is not a rubber stamp.
      criticConfirmed: weakEvidence ? true : undefined,
      criticConfirmationReason: weakEvidence ? `regrounded to a verified source passage (${decision.origin})` : undefined,
      criticConfirmedExactText: weakEvidence ? decision.exactText : undefined,
    });
    const after = buildFinalGardenState(gardenDir, gardenSlug);
    const blockersAfter = activeWeakAnchorBlockerCount(after);
    if (blockersAfter >= blockersBefore) {
      restoreGarden(gardenDir, snapshot);
      return { ...base, applied: false, action: "reground", updatedFiles: [], blockersBefore, blockersAfter, rolledBack: true, reason: `regrounding did not reduce blockers (${blockersBefore}→${blockersAfter}); rolled back` };
    }
    return { ...base, applied: true, action: "reground", updatedFiles: [".breadboard/source-anchors.json"], blockersBefore, blockersAfter, rolledBack: false, reason: `regrounded ${issue.anchorId} to ${evidence.confidence} evidence (blockers ${blockersBefore}→${blockersAfter})` };
  }

  // ---- Confirm current grounding: critic vouches for the existing excerpt. ----
  if (decision.decision === "confirm_current_grounding") {
    updateLedgerAnchorRecord(gardenDir, issue.anchorId, {
      criticConfirmed: true,
      criticConfirmationReason: decision.reason || `confirmed by ${decision.origin}`,
      criticConfirmedExactText: decision.exactText,
    });
    const after = buildFinalGardenState(gardenDir, gardenSlug);
    const blockersAfter = activeWeakAnchorBlockerCount(after);
    if (blockersAfter >= blockersBefore) {
      restoreGarden(gardenDir, snapshot);
      return { ...base, applied: false, action: "confirm", updatedFiles: [], blockersBefore, blockersAfter, rolledBack: true, reason: `confirmation did not reduce blockers (${blockersBefore}→${blockersAfter}); rolled back` };
    }
    return { ...base, applied: true, action: "confirm", updatedFiles: [".breadboard/source-anchors.json"], blockersBefore, blockersAfter, rolledBack: false, reason: `confirmed ${issue.anchorId} grounding (blockers ${blockersBefore}→${blockersAfter})` };
  }

  return { ...base, applied: false, action: "none", updatedFiles: [], blockersBefore, blockersAfter: blockersBefore, rolledBack: false, reason: `unhandled decision ${decision.decision}` };
}

// ===========================================================================
// Part 10 — the bounded self-healing loop.
// ===========================================================================

export interface WeakAnchorSelfHealingOptions {
  maxRounds?: number;
  maxIssuesPerRound?: number;
  maxChatMockCallsPerRound?: number;
  maxTotalChatMockCalls?: number;
  /** Injected ChatMock adapter. Absent → deterministic-only run. */
  anchorRepairModel?: WeakAnchorRepairModel;
}

export interface WeakAnchorSelfHealingRound {
  round: number;
  blockersBefore: number;
  blockersAfter: number;
  issuesConsidered: number;
  deterministicRepairs: number;
  chatMockCalls: number;
  chatMockRepairs: number;
  rejected: number;
  unresolved: number;
  actions: WeakAnchorRepairApplicationResult[];
}

export interface WeakAnchorSelfHealingResult {
  gardenSlug: string;
  rounds: WeakAnchorSelfHealingRound[];
  totalChatMockCalls: number;
  deterministicRepairs: number;
  chatMockRepairs: number;
  resolvedAnchorIds: string[];
  unresolvedActiveAnchorIds: string[];
  criticAvailable: boolean;
  criticRequested: boolean;
  publishReady: boolean;
  reason: string;
}

export async function runWeakAnchorSelfHealingLoop(
  gardenDir: string,
  gardenSlug: string | undefined,
  options: WeakAnchorSelfHealingOptions = {},
): Promise<WeakAnchorSelfHealingResult> {
  const maxRounds = options.maxRounds ?? DEFAULTS.maxRounds;
  const maxIssuesPerRound = options.maxIssuesPerRound ?? DEFAULTS.maxIssuesPerRound;
  const maxChatMockCallsPerRound = options.maxChatMockCallsPerRound ?? DEFAULTS.maxChatMockCallsPerRound;
  const maxTotalChatMockCalls = options.maxTotalChatMockCalls ?? DEFAULTS.maxTotalChatMockCalls;
  const model = options.anchorRepairModel;

  const rounds: WeakAnchorSelfHealingRound[] = [];
  let totalChatMockCalls = 0;
  let deterministicRepairs = 0;
  let chatMockRepairs = 0;
  let criticRequested = false;
  let criticUnavailable = false;

  const initialIds = new Set(collectWeakAnchorRepairIssues(buildFinalGardenState(gardenDir, gardenSlug)).map((i) => i.anchorId));

  for (let round = 1; round <= maxRounds; round += 1) {
    let state = buildFinalGardenState(gardenDir, gardenSlug);
    const blockersBefore = activeWeakAnchorBlockerCount(state);
    const issues = collectWeakAnchorRepairIssues(state).slice(0, maxIssuesPerRound);
    if (issues.length === 0) break;

    const roundRec: WeakAnchorSelfHealingRound = {
      round,
      blockersBefore,
      blockersAfter: blockersBefore,
      issuesConsidered: issues.length,
      deterministicRepairs: 0,
      chatMockCalls: 0,
      chatMockRepairs: 0,
      rejected: 0,
      unresolved: 0,
      actions: [],
    };

    // Batch by source+family for locality; still decide per issue.
    const paragraphs = readSourceParagraphs(gardenDir);
    for (const batch of batchWeakAnchorRepairIssues(issues)) {
      for (const issue of batch.issues) {
        // Rebuild before each apply so counts/closure reflect prior repairs.
        state = buildFinalGardenState(gardenDir, gardenSlug);
        if (collectWeakAnchorRepairIssues(state).every((i) => i.anchorId !== issue.anchorId)) {
          // Already resolved by an earlier repair this round.
          continue;
        }
        const candidates = findAnchorRepairCandidates(gardenDir, issue, state, paragraphs);
        const det = decideDeterministicAnchorRepair(issue, candidates);

        // (1) Deterministic path — still independently verified before applying.
        if (det.action === "reground_from_source" || det.action === "replace_with_existing_anchor") {
          const decision = deterministicDecisionOf(issue, det);
          if (decision) {
            const packet = buildWeakAnchorRepairPacket(issue, candidates, state);
            const verification = verifyWeakAnchorRepairDecision(gardenDir, issue, decision, packet, state);
            if (verification.ok) {
              const app = applyVerifiedWeakAnchorDecision(gardenDir, gardenSlug, issue, decision, verification, state);
              roundRec.actions.push(app);
              if (app.applied) {
                deterministicRepairs += 1;
                roundRec.deterministicRepairs += 1;
                continue;
              }
            }
          }
        }

        // (2) ChatMock path — ONLY for residual ambiguity, within budget.
        const budgetOk = roundRec.chatMockCalls < maxChatMockCallsPerRound && totalChatMockCalls < maxTotalChatMockCalls;
        if (model && !criticUnavailable && budgetOk) {
          const packet = buildWeakAnchorRepairPacket(issue, candidates, state);
          criticRequested = true;
          roundRec.chatMockCalls += 1;
          totalChatMockCalls += 1;
          let decision: WeakAnchorRepairDecision | null = null;
          try {
            decision = await model(packet);
          } catch {
            criticUnavailable = true;
            roundRec.unresolved += 1;
            continue;
          }
          if (!decision) {
            roundRec.unresolved += 1;
            continue;
          }
          const normalized: WeakAnchorRepairDecision = { ...decision, origin: "chatmock" };
          const verification = verifyWeakAnchorRepairDecision(gardenDir, issue, normalized, packet, state);
          if (normalized.decision === "reject_no_grounding" || !verification.ok || !verification.resolvesBlocker) {
            roundRec.rejected += 1;
            const blockers = activeWeakAnchorBlockerCount(state);
            roundRec.actions.push({ issueIdentity: issue.stableIdentity, anchorId: issue.anchorId, applied: false, action: "none", origin: "chatmock", updatedFiles: [], blockersBefore: blockers, blockersAfter: blockers, rolledBack: false, reason: `chatmock decision not accepted: ${verification.reason}` });
            continue;
          }
          const app = applyVerifiedWeakAnchorDecision(gardenDir, gardenSlug, issue, normalized, verification, state);
          roundRec.actions.push(app);
          if (app.applied) {
            chatMockRepairs += 1;
            roundRec.chatMockRepairs += 1;
          } else {
            roundRec.unresolved += 1;
          }
          continue;
        }

        // (3) No deterministic repair and no budget/model → leave it blocking.
        roundRec.unresolved += 1;
      }
    }

    roundRec.blockersAfter = activeWeakAnchorBlockerCount(buildFinalGardenState(gardenDir, gardenSlug));
    rounds.push(roundRec);
    // Stop early if nothing changed this round (avoid spinning).
    if (roundRec.blockersAfter >= roundRec.blockersBefore && roundRec.deterministicRepairs === 0 && roundRec.chatMockRepairs === 0) break;
  }

  const finalState = buildFinalGardenState(gardenDir, gardenSlug);
  const remaining = collectWeakAnchorRepairIssues(finalState);
  const unresolvedActiveAnchorIds = remaining.map((i) => i.anchorId).sort();
  const resolvedAnchorIds = [...initialIds].filter((id) => !unresolvedActiveAnchorIds.includes(id)).sort();
  const publishReady = unresolvedActiveAnchorIds.length === 0;
  const criticAvailable = !criticUnavailable;

  return {
    gardenSlug: gardenSlug ?? finalState.slug,
    rounds,
    totalChatMockCalls,
    deterministicRepairs,
    chatMockRepairs,
    resolvedAnchorIds,
    unresolvedActiveAnchorIds,
    criticAvailable,
    criticRequested,
    publishReady,
    reason: publishReady
      ? `no active weak-anchor blockers remain (${deterministicRepairs} deterministic + ${chatMockRepairs} ChatMock repair(s))`
      : criticRequested && !criticAvailable
        ? `ChatMock unavailable with ${unresolvedActiveAnchorIds.length} unresolved active weak anchor(s)`
        : `${unresolvedActiveAnchorIds.length} active weak anchor(s) could not be repaired within budget`,
  };
}

// ===========================================================================
// Part 13 — diagnostic reports (never a gate).
// ===========================================================================

export function writeWeakAnchorSelfHealingReports(gardenDir: string, result: WeakAnchorSelfHealingResult): string[] {
  const bd = path.join(gardenDir, ".breadboard");
  fs.mkdirSync(bd, { recursive: true });
  const changed: string[] = [];

  const jsonPath = path.join(bd, "weak-anchor-self-healing.json");
  const jsonContent = `${JSON.stringify(result, null, 2)}\n`;
  if (readTextSafe(jsonPath) !== jsonContent) {
    fs.writeFileSync(jsonPath, jsonContent, "utf-8");
    changed.push(".breadboard/weak-anchor-self-healing.json");
  }

  const cell = (s: unknown): string => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const md = [
    "# Weak-Anchor Self-Healing",
    "",
    `Garden: ${result.gardenSlug}. Publish-ready (weak-anchor category): ${result.publishReady}.`,
    `Deterministic repairs: ${result.deterministicRepairs}. ChatMock repairs: ${result.chatMockRepairs}. ChatMock calls: ${result.totalChatMockCalls}. Critic available: ${result.criticAvailable}.`,
    "",
    `Resolved anchors: ${result.resolvedAnchorIds.length ? result.resolvedAnchorIds.join(", ") : "—"}`,
    `Unresolved active anchors: ${result.unresolvedActiveAnchorIds.length ? result.unresolvedActiveAnchorIds.join(", ") : "—"}`,
    "",
    "## Rounds",
    "",
    "| Round | Blockers Before | Blockers After | Considered | Deterministic | ChatMock Calls | ChatMock Repairs | Rejected | Unresolved |",
    "|---|---|---|---|---|---|---|---|---|",
    ...(result.rounds.length
      ? result.rounds.map((r) => `| ${r.round} | ${r.blockersBefore} | ${r.blockersAfter} | ${r.issuesConsidered} | ${r.deterministicRepairs} | ${r.chatMockCalls} | ${r.chatMockRepairs} | ${r.rejected} | ${r.unresolved} |`)
      : ["| — | — | — | — | — | — | — | — | — |"]),
    "",
    "## Actions",
    "",
    "| Anchor | Action | Origin | Applied | Blockers | Reason |",
    "|---|---|---|---|---|---|",
    ...(() => {
      const acts = result.rounds.flatMap((r) => r.actions);
      return acts.length
        ? acts.map((a) => `| ${cell(a.anchorId)} | ${a.action} | ${a.origin} | ${a.applied} | ${a.blockersBefore}→${a.blockersAfter} | ${cell(a.reason)} |`)
        : ["| — | — | — | — | — | — |"];
    })(),
    "",
  ].join("\n");
  const mdPath = path.join(bd, "weak-anchor-self-healing.md");
  if (readTextSafe(mdPath) !== md) {
    fs.writeFileSync(mdPath, md, "utf-8");
    changed.push(".breadboard/weak-anchor-self-healing.md");
  }
  return changed;
}

// ===========================================================================
// Part 14 — final acceptance decision.
// ===========================================================================

export type FinalAcceptancePrimaryReason =
  | "accepted"
  | "unresolved_active_weak_anchors"
  | "critic_unavailable_with_unresolved_semantic_issues";

export interface FinalAcceptanceDecision {
  publishReady: boolean;
  primaryReason: FinalAcceptancePrimaryReason;
  criticAvailable: boolean;
  unresolvedActiveAnchorCount: number;
  unresolvedActiveAnchorIds: string[];
  reason: string;
}

/** Turn a self-healing result into the terminal publish/draft decision. A repair
 *  being ATTEMPTED never accepts the garden — only zero residual active weak
 *  anchors does. When ChatMock was needed but unavailable, the specific reason is
 *  surfaced so the caller can keep the garden a draft. */
export function decideFinalAcceptance(result: WeakAnchorSelfHealingResult): FinalAcceptanceDecision {
  const unresolvedActiveAnchorCount = result.unresolvedActiveAnchorIds.length;
  if (unresolvedActiveAnchorCount === 0) {
    return {
      publishReady: true,
      primaryReason: "accepted",
      criticAvailable: result.criticAvailable,
      unresolvedActiveAnchorCount: 0,
      unresolvedActiveAnchorIds: [],
      reason: "no active weak-anchor blockers remain",
    };
  }
  if (!result.criticAvailable) {
    return {
      publishReady: false,
      primaryReason: "critic_unavailable_with_unresolved_semantic_issues",
      criticAvailable: false,
      unresolvedActiveAnchorCount,
      unresolvedActiveAnchorIds: result.unresolvedActiveAnchorIds,
      reason: `ChatMock unavailable with ${unresolvedActiveAnchorCount} unresolved active weak anchor(s); keeping garden as draft`,
    };
  }
  return {
    publishReady: false,
    primaryReason: "unresolved_active_weak_anchors",
    criticAvailable: true,
    unresolvedActiveAnchorCount,
    unresolvedActiveAnchorIds: result.unresolvedActiveAnchorIds,
    reason: `${unresolvedActiveAnchorCount} active weak anchor(s) remain after deterministic + ChatMock repair`,
  };
}
