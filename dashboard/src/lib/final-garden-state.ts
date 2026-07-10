// Breadboard canonical final-artifact state model.
//
// This module is the single source of truth for a *finished* learning garden.
// After generation and repair, `buildFinalGardenState` reads ONLY the final
// exported files (learner Markdown frontmatter + bodies, section indexes, final
// visual JSON, the source-anchor ledgers, the Learning Unit Contract, the
// planning docs, and the repair log) and folds them into one `FinalGardenState`.
//
// Every report is then either generated from that state (`projectSourceCoverage`)
// or validated against it (`auditFinalGardenState`). No report relies on
// planning-time assumptions, and acceptance is blocked whenever any final
// artifact file contradicts the canonical state.
//
// Zero runtime dependencies; the type annotations are erasable so it runs under
// `node --experimental-strip-types` exactly like the validator and finalizer.

import fs from "node:fs";
import path from "node:path";
import {
  dedupeSourceArtifactAssignments,
  normalizeLearningUnits,
  scaffoldLikeZettelHandle,
  zettelHandlesForUnit,
  type LearningUnitContract,
  type SourceArtifactAssignment,
} from "./learning-unit-contract.ts";
import { formulaMetricFamily } from "./learn-utils.ts";

// ---------------------------------------------------------------------------
// Canonical types
// ---------------------------------------------------------------------------

export type CanonicalSourceAnchorKind =
  | "text_concept"
  | "formula"
  | "figure"
  | "table"
  | "graph"
  | "abstract"
  | "intro"
  | "guidance";

export type AnchorConfidence = "high" | "medium" | "low" | "unsupported";
export type AnchorDecision = "register" | "replace_with_existing" | "needs_critic_review" | "block";

/** The scored evidence proving (or failing to prove) that a source passage
 *  supports a generated semantic anchor's title, summary, and intended use. */
export interface AnchorEvidence {
  matchedPage?: number;
  keywordHits: string[];
  missingKeywords: string[];
  titleOverlapScore: number;
  keywordCoverageScore: number;
  pageMatchScore: number;
  contextSpecificityScore: number;
  negativeEvidencePenalty: number;
  totalScore: number;
  decision: AnchorDecision;
}

/** Full evidence score for one anchor candidate against the source. */
export interface AnchorEvidenceScore {
  anchorId: string;
  candidateTitle: string;
  sourceId: string;
  requestedPage?: number;
  matchedPage?: number;
  exactText: string;
  keywordHits: string[];
  missingKeywords: string[];
  titleOverlapScore: number;
  keywordCoverageScore: number;
  pageMatchScore: number;
  contextSpecificityScore: number;
  negativeEvidencePenalty: number;
  totalScore: number;
  confidence: AnchorConfidence;
  decision: AnchorDecision;
}

/** A ChatMock critic's explicit verdict on a low-confidence anchor. */
export interface CriticAnchorConfirmation {
  anchorId: string;
  confirmed: boolean;
  criticIssueId?: string;
  reason: string;
  confirmedExactText?: string;
}

export type AnchorCriticDecisionKind = "confirm" | "replace" | "create_better_anchor" | "reject";

/** The structured decision ChatMock returns for one low-confidence anchor. */
export interface AnchorCriticDecision {
  anchorId: string;
  decision: AnchorCriticDecisionKind;
  confidence: "high" | "medium" | "low";
  reason: string;
  confirmedExactText?: string;
  replacementAnchorId?: string;
  betterAnchor?: {
    id: string;
    kind: "text" | "abstract" | "intro" | "guidance";
    sourceId: string;
    page?: number;
    title: string;
    exactText: string;
    semanticSummary: string;
    conceptKeywords: string[];
  };
  requiredRepairs?: Array<{
    targetKind: "unit_page" | "learning_unit_contract" | "source_anchor_ledger" | "source_coverage";
    targetPath?: string;
    instructions: string[];
  }>;
}

/** Everything ChatMock needs to judge one low-confidence anchor. */
export interface AnchorConfirmationPacket {
  anchor: CanonicalSourceAnchor;
  evidence: AnchorEvidence;
  referencedBy: { pages: string[]; unitIds: string[]; visuals: string[] };
  candidatePassage: { sourceId: string; page?: number; exactText: string };
  nearbySourcePassages: Array<{ page?: number; exactText: string }>;
  existingAlternativeAnchors: CanonicalSourceAnchor[];
}

/** The outcome of applying one anchor decision to the artifacts. */
export type SourceTextMatchType = "exact" | "normalized_exact" | "near_exact" | "not_found";

/** The result of checking a ChatMock-supplied excerpt against source markdown. */
export interface SourceTextVerificationResult {
  ok: boolean;
  sourceId?: string;
  page?: number;
  matchType: SourceTextMatchType;
  matchedText?: string;
  similarity?: number;
  reason: string;
}

/** Whether a replacement anchor is semantically compatible with the weak one. */
export interface SemanticCompatibilityResult {
  ok: boolean;
  reason: string;
}

export type ConceptFamily =
  | "energy"
  | "energy_efficiency"
  | "latency"
  | "accuracy"
  | "spike_count"
  | "convergence"
  | "surrogate_gradient"
  | "stdp"
  | "ann_to_snn_conversion"
  | "neuromorphic_hardware"
  | "edge_deployment"
  | "brain_comparison"
  | "event_driven_computation"
  | "other";

export type SourceTextRelevanceDecision = "relevant" | "weak_relevance" | "irrelevant";

/** Whether a source excerpt actually SUPPORTS an anchor's meaning (not just
 *  exists in the source). Presence is checked separately by verifySourceText. */
export interface SourceTextRelevanceResult {
  ok: boolean;
  anchorId: string;
  anchorTitle: string;
  anchorKind: string;
  anchorConceptKeywords: string[];
  anchorSemanticSummary: string;
  anchorFamily: ConceptFamily;
  textFamily: ConceptFamily;
  textKeywordHits: string[];
  textMissingKeywords: string[];
  titleOverlapScore: number;
  keywordCoverageScore: number;
  summaryOverlapScore: number;
  familyCompatibilityScore: number;
  wrongFamilyPenalty: number;
  totalScore: number;
  decision: SourceTextRelevanceDecision;
  reason: string;
}

/** A targeted repair for a rejected (unsupported) anchor (Fix 6). */
export interface RejectedAnchorRepairRequest {
  targetKind: "unit_page" | "learning_unit_contract" | "source_anchor_ledger" | "source_coverage";
  rejectedAnchorId: string;
  affectedPages: string[];
  affectedUnitIds: string[];
  instructions: string[];
}

export interface AppliedAnchorDecision {
  anchorId: string;
  decision: AnchorCriticDecisionKind;
  applied: boolean;
  confidence?: "high" | "medium" | "low";
  reason: string;
  replacementAnchorId?: string;
  betterAnchorId?: string;
  createdAnchorId?: string;
  confirmedExactText?: string;
  changed: string[];
  requiredRepairs?: AnchorCriticDecision["requiredRepairs"];
  rejectedRepairRequests?: RejectedAnchorRepairRequest[];
  affectedPages?: string[];
  invalidReason?: string;
  /** Independent verification that the decision's excerpt exists in the source. */
  verification?: SourceTextVerificationResult;
  /** Whether the verified excerpt actually SUPPORTS the anchor's meaning. */
  relevance?: SourceTextRelevanceResult;
  /** Whether the replacement anchor is semantically compatible. */
  semanticCompatibility?: SemanticCompatibilityResult;
  /** True when a created anchor was verified in source but scored too low to
   *  accept, so a follow-up critic round is required. */
  followUpIssue?: boolean;
}

/** One anchor every reference in the garden must resolve through. */
export interface CanonicalSourceAnchor {
  id: string;
  kind: CanonicalSourceAnchorKind;
  title: string;
  page?: number;
  sourceId?: string;
  /** Where the canonical definition came from. */
  origin: "visual_ledger" | "text_ledger" | "structural_ledger";
  /** Metric family for formula anchors (accuracy, latency, energy, …), used for
   *  semantic compatibility checks. Absent when the family is unrecognized. */
  formulaFamily?: string;
  caption?: string;
  semanticSummary?: string;
  /** Verbatim source excerpt for text anchors (Fix 7). */
  exactText?: string;
  conceptKeywords?: string[];
  /** Evidence-based confidence for GENERATED semantic anchors. Absent for
   *  first-class source structures (visuals, source-doc structural anchors). */
  confidence?: AnchorConfidence;
  /** Why a generated semantic anchor was accepted (Fix 3). */
  evidence?: AnchorEvidence;
  /** True once a ChatMock critic explicitly confirmed a low-confidence anchor. */
  criticConfirmed?: boolean;
  criticConfirmationReason?: string;
  criticConfirmedExactText?: string;
}

/** A proposed source anchor BEFORE it is proven against the source. Generation
 *  and repair create candidates; a candidate becomes a `CanonicalSourceAnchor`
 *  only after `resolveSourceAnchorCandidate` finds a real source basis for it.
 *  No anchor id may reach a page/contract without passing through this gate. */
export interface SourceAnchorCandidate {
  proposedId: string;
  sourceId: string;
  page?: number;
  kind: "text" | "abstract" | "intro" | "guidance";
  title: string;
  conceptKeywords: string[];
  semanticSummary: string;
  sourceSearchTerms: string[];
  requiredForUnitIds: string[];
}

export type MissingAnchorRepairAction =
  | "register_from_source_text"
  | "replace_with_existing_anchor"
  | "needs_critic_review"
  | "remove_unsupported_anchor";

export type InvalidSourceAnchorLabelReason =
  | "not_anchor_id"
  | "generic_label"
  | "planning_caveat"
  | "invalid_format"
  | "unresolved";

export interface RejectedSourceAnchorLabel {
  value: string;
  reason: InvalidSourceAnchorLabelReason;
  suggestedField?: string;
}

export interface SourceAnchorSanitizationResult {
  acceptedAnchorIds: string[];
  rejectedLabels: RejectedSourceAnchorLabel[];
}

/** A referenced anchor that is not (yet) in the canonical registry, plus the
 *  action the anchor-repair pass will take to resolve it before acceptance. */
export interface MissingAnchorRepairRequest {
  targetKind: "source_anchor_ledger";
  missingAnchorId: string;
  referencedByPages: string[];
  referencedByUnitIds: string[];
  sourceId?: string;
  inferredPage?: number;
  inferredConceptKeywords: string[];
  repairAction: MissingAnchorRepairAction;
  /** For replace: the existing canonical anchor that will absorb the reference. */
  replacementAnchorId?: string;
}

export type FormulaKind =
  | "source_definition"
  | "source_derived_definition"
  | "worked_example"
  | "conceptual_helper";

/** The structural shape of a formula, independent of how it was labeled. */
export type FormulaStructuralKind = "definition" | "worked_example" | "trivial";

export interface FinalFormulaRecord {
  pageRel: string;
  text: string;
  declaredKind: FormulaKind | "";
  structuralKind: FormulaStructuralKind;
  groundingStatus: string;
  sourceAnchor?: string;
  basedOnFormula?: string;
}

export interface FinalVisualSpec {
  id: string;
  type: string;
  pageRel?: string;
  /** figure/table/equation anchor ids used by this visual. */
  anchorIds: string[];
  /** text-concept anchor ids used by this visual. */
  textAnchorIds: string[];
  anchorRoles: string[];
  fromFile: boolean;
  fromBody: boolean;
}

export type SourceUsageKind =
  | "page_prose"
  | "formula_definition"
  | "worked_example"
  | "visual_grounding"
  | "source_crop"
  | "text_concept";

export interface SourceUsageRecord {
  anchorId: string;
  pageRel: string;
  kind: SourceUsageKind;
}

export interface FinalZettelHandleRecord {
  pageRel: string;
  unitId: string;
  handle: string;
  natural: boolean;
  reason?: string;
}

export interface FinalGardenPage {
  rel: string;
  abs: string;
  title: string;
  sectionNumber: number;
  subsectionNumber: string;
  learningUnitId: string;
  learningUnitRole: string;
  tags: string[];
  sourceAnchors: string[];
  sourceFormulaAnchors: string[];
  sourceVisualIds: string[];
  visualIds: string[];
  formulas: FinalFormulaRecord[];
  rawFrontmatter: string;
  body: string;
  lastSemanticRepairAt: string;
}

export interface FinalGardenSection {
  rel: string;
  title: string;
  childPageRels: string[];
  body: string;
}

export interface RepairLogEntry {
  targetKind?: RepairTargetKind;
  unitId?: string;
  pagePath?: string;
  sectionPath?: string;
  affectedUnitIds?: string[];
  affectedSectionId?: string;
  changedFiles: string[];
  failureTypes: string[];
  executorUsed?: string;
  result?: string;
}

export type RepairTargetKind =
  | "unit_page"
  | "section_index"
  | "contract"
  | "source_coverage"
  | "planning_doc"
  | "visual_spec"
  | "global_finalization";

export interface RepairLog {
  requests?: unknown[];
  repairs: RepairLogEntry[];
}

export interface FinalGardenState {
  rootPath: string;
  slug: string;

  pages: FinalGardenPage[];
  sections: FinalGardenSection[];

  learningUnitContract: {
    units: LearningUnitContract[];
    assignments: SourceArtifactAssignment[];
  };

  sourceAnchors: Record<string, CanonicalSourceAnchor>;
  sourceUsages: SourceUsageRecord[];

  visuals: FinalVisualSpec[];
  formulas: FinalFormulaRecord[];
  zettelHandles: FinalZettelHandleRecord[];

  repairLog?: RepairLog;

  planningDocs: {
    sourceMap?: string;
    scopeContract?: string;
    learningMap?: string;
    sourceCoverage?: string;
  };
}

// ---------------------------------------------------------------------------
// Frontmatter + small parse helpers (kept local so the module is standalone)
// ---------------------------------------------------------------------------

function splitFrontmatter(content: string): { rawFrontmatter: string; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { rawFrontmatter: "", body: content };
  return { rawFrontmatter: match[1] ?? "", body: match[2] ?? "" };
}

function fmScalar(rawFm: string, key: string): string {
  const match = rawFm.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  return match ? (match[1] ?? "").trim().replace(/^["']|["']$/g, "") : "";
}

function fmArray(rawFm: string, key: string): string[] {
  const match = rawFm.match(new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]\\s*$`, "m"));
  if (!match) return [];
  return (match[1] ?? "")
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function unquote(value: string): string {
  const t = value.trim();
  // Double-quoted scalars are JSON-escaped (e.g. LaTeX "\\text{..}"); decode
  // them so a later JSON.stringify re-encode is byte-symmetric (idempotent).
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    try {
      return JSON.parse(t);
    } catch {
      return t.slice(1, -1);
    }
  }
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) return t.slice(1, -1);
  return t;
}

interface RawFormulaEntry {
  kind?: string;
  text?: string;
  groundingStatus?: string;
  justification?: string;
  sourceAnchor?: string;
  basedOnFormula?: string;
}

function formulaEntriesFromFrontmatter(rawFm: string): RawFormulaEntry[] {
  const entries: RawFormulaEntry[] = [];
  let inFormulas = false;
  let current: RawFormulaEntry | null = null;
  for (const line of rawFm.split(/\r?\n/)) {
    if (!inFormulas) {
      if (/^formulas:\s*(.*)$/.test(line)) inFormulas = true;
      continue;
    }
    if (/^\S[^:]*:\s*/.test(line)) break;
    const first = line.match(/^\s*-\s*([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (first) {
      current = {};
      (current as Record<string, string>)[first[1]] = unquote(first[2] ?? "");
      entries.push(current);
      continue;
    }
    const nested = line.match(/^\s{4,}([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (nested && current) (current as Record<string, string>)[nested[1]] = unquote(nested[2] ?? "");
  }
  return entries.filter((entry) => Object.values(entry).some((value) => String(value ?? "").trim()));
}

const VISUAL_BLOCK_RE = /```breadboard-visual\r?\n([\s\S]*?)\r?\n```/g;

function embeddedVisualSpecs(body: string): Array<Record<string, unknown>> {
  const specs: Array<Record<string, unknown>> = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(VISUAL_BLOCK_RE.source, "g");
  while ((match = re.exec(body)) !== null) {
    try {
      const parsed = JSON.parse(match[1] ?? "{}");
      if (parsed && typeof parsed === "object") specs.push(parsed as Record<string, unknown>);
    } catch {
      // reported elsewhere
    }
  }
  return specs;
}

function visualAnchorIdsByKind(spec: Record<string, unknown>): { hard: string[]; text: string[]; roles: string[] } {
  const raw = Array.isArray(spec.sourceAnchors) ? spec.sourceAnchors : [];
  const hard: string[] = [];
  const text: string[] = [];
  const roles: string[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    for (const key of ["figureId", "tableId", "equationId", "questionId"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) hard.push(value.trim());
    }
    if (typeof record.textAnchorId === "string" && record.textAnchorId.trim()) text.push(record.textAnchorId.trim());
    if (typeof record.role === "string" && record.role.trim()) roles.push(record.role.trim());
  }
  return { hard: [...new Set(hard)], text: [...new Set(text)], roles: [...new Set(roles)] };
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function readText(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Canonical source-anchor registry
// ---------------------------------------------------------------------------

function anchorKindFromVisual(type: string, id: string): CanonicalSourceAnchorKind {
  if (/\.E\d+$/i.test(id)) return "formula";
  if (/\.T\d+$/i.test(id)) return "table";
  const t = type.toLowerCase();
  if (t === "table") return "table";
  if (t === "graph") return "graph";
  if (t === "equation") return "formula";
  return "figure";
}

const STRUCTURAL_ANCHOR_KINDS: Record<string, CanonicalSourceAnchorKind> = {
  abstract: "abstract",
  annlimitations: "guidance",
  architecturecomparison: "guidance",
  applications: "guidance",
  application: "guidance",
  contribution: "guidance",
  contributions: "guidance",
  deferred: "guidance",
  excluded: "guidance",
  hardware: "guidance",
  intro: "intro",
  introduction: "intro",
  neuromorphichardware: "guidance",
  neuromorphic_hardware: "guidance",
  researchgap: "guidance",
  snndefinition: "guidance",
  studycontributions: "guidance",
  synchronousvsasynchronous: "guidance",
  guidance: "guidance",
};

function structuralKindFromId(id: string): CanonicalSourceAnchorKind | null {
  if (/\.(?:E|F|G|T)\d+$/i.test(id)) return null;
  const tokens = id
    .split(".")
    .map((token) => token.replace(/[^a-z0-9]+/gi, "").toLowerCase())
    .filter(Boolean);
  for (const token of [...tokens].reverse()) {
    const kind = STRUCTURAL_ANCHOR_KINDS[token];
    if (kind) return kind;
  }
  if (/^scopeContract\./i.test(id)) return "guidance";
  if (/^S\d+\.P\d+\.[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/i.test(id)) {
    return "guidance";
  }
  return null;
}

const GENERIC_ANCHOR_LABEL_RE = /\b(?:source|general|provided|context|notes?|discussion|limitations?|method|formula|caption|captions?|map|learning)\b/i;
const CAVEAT_ANCHOR_LABEL_RE = /\b(?:caveat|caveats|not fully available|not available|missing|omitted|deferred|excluded|limitation|limitations|supplied results)\b/i;

/** True only for strings shaped like canonical source-anchor ids. Human labels
 * such as "source caveats" or "general context" are not plausible ids and must
 * stay out of sourceAnchors/sourceFormulaAnchors/visual anchors/contracts. */
export function isPlausibleSourceAnchorId(value: string): boolean {
  const id = String(value ?? "").trim();
  if (!id || /\s/.test(id)) return false;
  if (/^S\d+\.P\d+\.(?:E|F|G|T)\d+$/i.test(id)) return true;
  if (/^S\d+\.P\d+\.[A-Za-z0-9][A-Za-z0-9_.-]*$/i.test(id)) return true;
  if (/^text-[A-Za-z0-9][A-Za-z0-9_.-]*-[A-Za-z0-9][A-Za-z0-9_.-]*$/i.test(id)) return true;
  if (/^scopeContract\.(?:excluded|deferred|included|guidance)$/i.test(id)) return true;
  return false;
}

export function classifyRejectedSourceAnchorLabel(value: string): RejectedSourceAnchorLabel {
  const raw = String(value ?? "").trim();
  const lower = raw.toLowerCase();
  if (!raw) return { value: raw, reason: "invalid_format" };
  if (CAVEAT_ANCHOR_LABEL_RE.test(lower)) {
    return { value: raw, reason: "planning_caveat", suggestedField: "sourceCaveats" };
  }
  if (GENERIC_ANCHOR_LABEL_RE.test(lower)) {
    return { value: raw, reason: "generic_label", suggestedField: "sourceNotes" };
  }
  if (/\s/.test(raw)) return { value: raw, reason: "not_anchor_id", suggestedField: "sourceNotes" };
  return { value: raw, reason: "invalid_format" };
}

export function sanitizeSourceAnchorIds(values: string[]): SourceAnchorSanitizationResult {
  const accepted: string[] = [];
  const rejectedLabels: RejectedSourceAnchorLabel[] = [];
  for (const raw of values) {
    const value = String(raw ?? "").trim();
    if (!value || value.startsWith("trivial:")) continue;
    if (isPlausibleSourceAnchorId(value)) {
      if (!accepted.includes(value)) accepted.push(value);
    } else {
      const rejected = classifyRejectedSourceAnchorLabel(value);
      if (!rejectedLabels.some((item) => item.value === rejected.value && item.reason === rejected.reason)) rejectedLabels.push(rejected);
    }
  }
  return { acceptedAnchorIds: accepted, rejectedLabels };
}

function sourceDocumentAnchorRefs(gardenDir: string): Map<string, { sourceId: string; title: string }> {
  const refs = new Map<string, { sourceId: string; title: string }>();
  const sourcePages: Array<{ abs: string; rel: string }> = [];
  walkMarkdown(path.join(gardenDir, "sources"), "sources", sourcePages);
  for (const page of sourcePages) {
    if (/(^|\/)_index\.md$/i.test(page.rel)) continue;
    const content = readText(page.abs);
    if (content === undefined) continue;
    const { rawFrontmatter } = splitFrontmatter(content);
    const basename = path.basename(page.rel, ".md");
    const sourceId = fmScalar(rawFrontmatter, "sourceId") || basename;
    const title = fmScalar(rawFrontmatter, "title") || basename;
    for (const id of [basename, sourceId, title]) {
      const clean = String(id ?? "").trim();
      if (clean) refs.set(clean, { sourceId, title });
    }
  }
  return refs;
}

/** Read the persisted anchor ledgers and build the canonical registry. */
export function buildCanonicalSourceAnchors(gardenDir: string): Record<string, CanonicalSourceAnchor> {
  const bd = path.join(gardenDir, ".breadboard");
  const registry: Record<string, CanonicalSourceAnchor> = {};

  const visualLedger = readJson<Array<Record<string, unknown>>>(path.join(bd, "source-visuals.json"), []);
  for (const visual of visualLedger) {
    const id = String(visual.sourceVisualId ?? "").trim();
    if (!id) continue;
    const kind = anchorKindFromVisual(String(visual.type ?? ""), id);
    const caption = String(visual.caption ?? id);
    registry[id] = {
      id,
      kind,
      title: caption,
      caption,
      page: Number.isFinite(Number(visual.pageNumber)) ? Number(visual.pageNumber) : undefined,
      sourceId: String(visual.sourceId ?? "") || undefined,
      origin: "visual_ledger",
      formulaFamily: kind === "formula" ? (formulaMetricFamily(caption) ?? undefined) : undefined,
    };
  }

  const anchorLedger = readJson<Record<string, unknown>>(path.join(bd, "source-anchors.json"), {});
  const textAnchors = Array.isArray(anchorLedger.sourceTextConceptAnchors)
    ? anchorLedger.sourceTextConceptAnchors
    : [];
  for (const anchor of textAnchors) {
    const record = anchor as Record<string, unknown>;
    const id = String(record.id ?? "").trim();
    if (!id) continue;
    if (!isPlausibleSourceAnchorId(id)) continue;
    registry[id] = {
      id,
      kind: "text_concept",
      title: String(record.title ?? record.semanticSummary ?? id),
      page: Number.isFinite(Number(record.page)) ? Number(record.page) : undefined,
      sourceId: String(record.sourceId ?? "") || undefined,
      origin: "text_ledger",
      semanticSummary: record.semanticSummary ? String(record.semanticSummary) : undefined,
      exactText: typeof record.exactText === "string" && record.exactText.trim() ? record.exactText : undefined,
      conceptKeywords: Array.isArray(record.conceptKeywords) ? record.conceptKeywords.map(String) : [],
    };
  }

  // First-class broad/structural anchors (S1.P1.Abstract, S1.P1.Intro,
  // S1.P2.Guidance ...). These are registered explicitly so pages may only
  // reference them if the registry actually defines them — no implicit anchors.
  const structural = Array.isArray(anchorLedger.sourceStructuralAnchors)
    ? anchorLedger.sourceStructuralAnchors
    : [];
  for (const anchor of structural) {
    const record = anchor as Record<string, unknown>;
    const id = String(record.id ?? "").trim();
    if (!id) continue;
    if (!isPlausibleSourceAnchorId(id)) continue;
    // A registered record's explicit kind wins over the id-token heuristic, so a
    // semantic anchor registered as "abstract"/"intro"/"text_concept" keeps that
    // kind even when its id tail is not a known structural token.
    const kind = (String(record.kind ?? "").trim() as CanonicalSourceAnchorKind)
      || structuralKindFromId(id)
      || "guidance";
    const confidence = ["high", "medium", "low", "unsupported"].includes(String(record.confidence))
      ? String(record.confidence) as AnchorConfidence
      : undefined;
    registry[id] = {
      id,
      kind,
      title: String(record.title ?? id),
      page: Number.isFinite(Number(record.page)) ? Number(record.page) : undefined,
      sourceId: String(record.sourceId ?? "") || undefined,
      origin: "structural_ledger",
      semanticSummary: record.semanticSummary ? String(record.semanticSummary) : undefined,
      exactText: typeof record.exactText === "string" && record.exactText.trim() ? record.exactText : undefined,
      conceptKeywords: Array.isArray(record.conceptKeywords) ? record.conceptKeywords.map(String) : undefined,
      confidence,
      evidence: record.evidence && typeof record.evidence === "object" ? record.evidence as AnchorEvidence : undefined,
      criticConfirmed: record.criticConfirmed === true,
      criticConfirmationReason: record.criticConfirmationReason ? String(record.criticConfirmationReason) : undefined,
      criticConfirmedExactText: typeof record.criticConfirmedExactText === "string" ? record.criticConfirmedExactText : undefined,
    };
  }

  return registry;
}

// ---------------------------------------------------------------------------
// Formula classification (source definition vs worked example)
// ---------------------------------------------------------------------------

function stripFormulaLabels(text: string): string {
  return text.replace(/\\(?:text|mathrm|operatorname)\s*\{[^}]*\}/g, " ");
}

/**
 * Structural classification of a formula, independent of any declared kind.
 *
 * A *definition* preserves the symbolic relationship. A *worked example*
 * plugs in concrete numbers and ends in a specific numeric instance. This is
 * the ground truth the audit uses to catch worked examples mislabeled as
 * `source_definition`.
 */
export function formulaStructuralKind(text: string): FormulaStructuralKind {
  const raw = String(text ?? "").trim();
  if (!raw) return "trivial";

  // Strip symbolic labels so `\frac{\text{correct}}{\text{total}}` is not
  // mistaken for a numeric fraction.
  const core = stripFormulaLabels(raw)
    .replace(/\\left|\\right|\\,|\\;|\\:|\\!/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Drop the "× 100%" percent-conversion factor — it is a formatting constant,
  // not a numeric substitution.
  const withoutPercentFactor = core
    .replace(/\\(?:times|cdot)\s*100\s*\\?%/g, " ")
    .replace(/\*\s*100\s*%/g, " ");

  const numericOnlyFraction = /\\frac\s*\{\s*[\d.,]+\s*\}\s*\{\s*[\d.,]+\s*\}/.test(withoutPercentFactor)
    || /(?:^|[^A-Za-z}])\d[\d.,]*\s*\/\s*\d[\d.,]*/.test(withoutPercentFactor);
  // A bare numeric result: the expression terminates in `= <number>` or
  // `\approx <number>` (optionally %). Numeric approximations are worked
  // examples even when the left side is a symbolic label such as `\eta`.
  const bareNumericResult = /(?:=|\\approx|≈)\s*[+-]?\d[\d.,]*\s*\\?%?\s*$/.test(withoutPercentFactor.trim());

  const symbols = stripFormulaLabels(raw)
    .replace(/\\(?:frac|times|cdot|left|right|text|mathrm|operatorname|approx|geq|leq|neq|sum|prod|int|sqrt|%)/g, " ")
    .match(/[A-Za-z]/g) ?? [];

  if ((numericOnlyFraction || bareNumericResult) && !/^\s*[A-Za-z]/.test(withoutPercentFactor.replace(/^[^A-Za-z\d]*/, ""))) {
    // guard handled below; fall through
  }

  if (numericOnlyFraction && bareNumericResult) return "worked_example";
  if (bareNumericResult && symbols.length <= 2) return "worked_example";
  if (numericOnlyFraction && symbols.length <= 2) return "worked_example";

  // No relational operator and only a lone symbol → not a definition.
  if (!/[=<>≤≥≈∝]|\\(?:geq|leq|neq|approx)/.test(raw) && symbols.length <= 1) return "trivial";

  return "definition";
}

/** Best-effort full classification when the frontmatter omits `kind`. */
export function classifyFormulaKind(entry: RawFormulaEntry): FormulaKind {
  const declared = String(entry.kind ?? "").trim();
  const structural = formulaStructuralKind(String(entry.text ?? ""));
  if (structural === "worked_example") {
    return declared === "conceptual_helper" ? "conceptual_helper" : "worked_example";
  }
  if (declared === "source_definition" || declared === "source_derived_definition") return declared;
  if (entry.groundingStatus === "source-anchored") return "source_definition";
  if (entry.groundingStatus === "source-derived") return "source_derived_definition";
  if (structural === "definition" && entry.sourceAnchor) return "source_definition";
  return "conceptual_helper";
}

// ---------------------------------------------------------------------------
// Zettelkasten handle naturalness
// ---------------------------------------------------------------------------

/**
 * Phrases that read as a description of the *tag's function* rather than a
 * durable note claim. A handle containing any of these is template-like and
 * blocks acceptance (Fix 7).
 */
export const TEMPLATE_ZETTEL_PHRASES: string[] = [
  "links-variables-to-a-measurable-claim",
  "defines-which-quantities-change-the-metric",
  "links-the-result-to-the-metric",
  "shows-how-reported-values-support",
  "keeps-claims-bounded-by-source-limits",
  "connects-capability-to-use-case-fit",
  "records-the-source-relationship",
  "states-what-the-reported-result-supports",
  // Additional planner-scaffold shapes observed in drift.
  "shows-how-reported-values-support-a-comparison",
  "links-the-result-to-the-metric-that-produced-it",
  "marks-the-limit-of-the-source-claim",
  "shapes-deployment-constraints",
];

/** Returns a reason if the handle reads like planner scaffolding, else null. */
export function zettelHandleNaturalnessReason(handle: string): string | null {
  const normalized = String(handle ?? "").toLowerCase().trim();
  if (!normalized) return "empty handle";
  for (const phrase of TEMPLATE_ZETTEL_PHRASES) {
    if (normalized.includes(phrase)) return `contains template phrase "${phrase}"`;
  }
  // Function-describing verbs anchored to generic objects.
  if (/-(?:defines|describes|records|states|introduces|explains|connects)-(?:the|which|what|how|a)-/.test(normalized)) {
    return "describes the tag's function instead of stating a durable claim";
  }
  // Stay a superset of the pipeline's own scaffold detector so the audit and the
  // Zettelkasten Handle Quality check can never disagree about a handle.
  if (scaffoldLikeZettelHandle(normalized)) {
    return "reads like planner scaffolding, not a reusable source-specific claim";
  }
  return null;
}

export function isNaturalZettelHandle(handle: string): boolean {
  return zettelHandleNaturalnessReason(handle) === null;
}

// ---------------------------------------------------------------------------
// Section-index summaries generated from real child pages
// ---------------------------------------------------------------------------

export interface SectionSummaryInput {
  sectionTitle: string;
  childPageTitles: string[];
  childUnitRoles: string[];
  keySourceAnchors: string[];
  previousSectionTitle?: string;
  nextSectionTitle?: string;
}

const META_PHRASE_RE = /introduces the core idea|learner-facing step|connects it to the next|this section is part of the confirmed|build up\b[^.\n]{0,120}\bone step at a time|the confirmed learning map/i;

function stripLeadingNumber(value: string): string {
  return value.replace(/^\d+(?:\.\d+)*\.?\s*/, "").trim();
}

function fixAcronyms(value: string): string {
  return value
    .replace(/\bsnns\b/g, "SNNs")
    .replace(/\bsnn\b/g, "SNN")
    .replace(/\bann\b/gi, "ANN")
    .replace(/\blif\b/gi, "LIF")
    .replace(/\bstdp\b/gi, "STDP");
}

function joinList(items: string[]): string {
  const clean = items.filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}

/** Deterministic, natural section summary derived from actual child pages. */
export function generateSectionSummary(input: SectionSummaryInput): string {
  const title = fixAcronyms(stripLeadingNumber(input.sectionTitle)) || "This section";
  const titleLower = fixAcronyms(title.toLowerCase());
  const children = input.childPageTitles.map((c) => fixAcronyms(stripLeadingNumber(c))).filter(Boolean);
  const roles = new Set(input.childUnitRoles);

  const lead = roles.has("result_interpretation") || roles.has("comparison")
    ? `This section moves from definitions to evidence`
    : roles.has("formula") || roles.has("metric")
      ? `This section turns ${titleLower} into quantities you can measure`
      : roles.has("application") || roles.has("limitation")
        ? `This section connects ${titleLower} to where it actually gets used`
        : `This section builds up ${titleLower} concept by concept`;

  const body = children.length > 0
    ? `it works through ${joinList(children)} so the pieces connect into one picture rather than standing alone`
    : `it develops the section's concepts so they connect into one picture`;

  return `${lead}: ${body}.`;
}

/** True when section-index prose is template scaffolding rather than a summary. */
export function isTemplateSectionSummary(prose: string): boolean {
  return META_PHRASE_RE.test(prose);
}

// ---------------------------------------------------------------------------
// Paraphrased repeated-opening detection
// ---------------------------------------------------------------------------

const OPENING_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for", "with", "as", "by",
  "that", "this", "these", "those", "it", "its", "is", "are", "was", "were", "be", "been", "being",
  "has", "have", "had", "do", "does", "did", "can", "could", "will", "would", "should", "may", "might",
  "one", "two", "into", "from", "then", "than", "so", "just", "must", "when", "where", "which", "what",
  "how", "why", "you", "your", "we", "our", "they", "their", "he", "she", "his", "her", "not", "no",
  "if", "up", "out", "over", "about", "some", "any", "each", "every", "very", "small", "large",
]);

const NARRATIVE_OPENER_RE = /^\s*(?:imagine|picture|consider|suppose|think about|say you|you (?:are|have|walk|see)|there is|there's|meet|take)\b/i;
const CALLBACK_RE = /\b(?:as (?:we|you) (?:saw|met|built)|recall|earlier|before,|returning to|as before|back in|remember the|the same .* from)\b/i;

function teachingProseOnly(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#.*$/gm, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/^\s*\*\*(?:Question|Answer)\.?\*\*.*$/gim, " ");
}

function openingScenarioSignature(body: string): { opener: boolean; callback: boolean; keywords: Set<string>; raw: string } {
  const prose = teachingProseOnly(body).replace(/^\s+/, "");
  const paragraphs = prose.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).slice(0, 4);
  const opening = paragraphs.slice(0, 2).join(" ");
  const firstSentences = opening.split(/(?<=[.!?])\s+/).slice(0, 3).join(" ");
  const opener = NARRATIVE_OPENER_RE.test(paragraphs[0] ?? "") || /\bimagine\b|\bpicture\b/i.test(firstSentences.slice(0, 60));
  const callback = CALLBACK_RE.test(opening);
  const keywords = new Set(
    firstSentences
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 4 && !OPENING_STOPWORDS.has(word)),
  );
  return { opener, callback, keywords, raw: firstSentences };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const item of a) if (b.has(item)) inter += 1;
  return inter / (a.size + b.size - inter);
}

export interface RepeatedOpeningFinding {
  severity: "warn" | "fail";
  pages: [string, string];
  similarity: number;
  message: string;
}

/**
 * Catches paraphrased (not just verbatim) repeated opening scenarios across
 * adjacent / near-adjacent learner pages. Deliberate callbacks are allowed
 * when framed as callbacks (Fix 8).
 */
export function repeatedOpeningFindings(pages: Array<{ rel: string; body: string }>): RepeatedOpeningFinding[] {
  const sigs = pages.map((page) => ({ rel: page.rel, ...openingScenarioSignature(page.body) }));
  const findings: RepeatedOpeningFinding[] = [];
  for (let i = 0; i < sigs.length; i += 1) {
    for (let j = i + 1; j < sigs.length && j <= i + 2; j += 1) {
      const a = sigs[i];
      const b = sigs[j];
      if (!a.opener || !b.opener) continue;
      const similarity = jaccard(a.keywords, b.keywords);
      if (similarity < 0.34) continue;
      if (b.callback) continue; // framed as an intentional callback
      // Moderate overlap (shared framing) warns; near-verbatim paraphrase of a
      // concrete scenario blocks acceptance (Fix 8: WARN or FAIL by severity).
      const severity: "warn" | "fail" = similarity >= 0.72 ? "fail" : "warn";
      findings.push({
        severity,
        pages: [a.rel, b.rel],
        similarity: Math.round(similarity * 100) / 100,
        message: `${a.rel} and ${b.rel} open with the same scenario (keyword overlap ${Math.round(similarity * 100)}%): "${a.raw.slice(0, 70)}…" vs "${b.raw.slice(0, 70)}…"`,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Contract reader
// ---------------------------------------------------------------------------

function normalizeAssignments(raw: unknown): SourceArtifactAssignment[] {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(record.sourceArtifactAssignments)
      ? record.sourceArtifactAssignments
      : Array.isArray(record.assignments)
        ? record.assignments
        : [];
  const out: SourceArtifactAssignment[] = [];
  for (const item of list) {
    const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const sourceArtifactId = String(row.sourceArtifactId ?? row.sourceVisualId ?? row.figureId ?? row.id ?? "").trim();
    const assignedLearningUnitId = String(row.assignedLearningUnitId ?? row.learningUnitId ?? row.unitId ?? "").trim();
    if (!sourceArtifactId || !assignedLearningUnitId) continue;
    out.push({
      sourceArtifactId,
      assignedLearningUnitId,
      placement: (String(row.placement ?? "inside_concept_explanation").replace(/[\s-]+/g, "_")) as SourceArtifactAssignment["placement"],
      reason: String(row.reason ?? ""),
      requiredInterpretation: String(row.requiredInterpretation ?? row.interpretationGoal ?? row.goal ?? ""),
    });
  }
  return out;
}

export function readFinalContract(gardenDir: string): { units: LearningUnitContract[]; assignments: SourceArtifactAssignment[] } {
  for (const candidate of [
    path.join(gardenDir, ".breadboard", "learning-unit-contract.json"),
    path.join(gardenDir, ".breadboard", "planning", "learning-unit-contract.json"),
  ]) {
    const parsed = readJson<unknown>(candidate, null);
    if (!parsed) continue;
    const units = normalizeLearningUnits(parsed);
    if (units.length === 0) continue;
    const assignments = dedupeSourceArtifactAssignments(normalizeAssignments(parsed), units);
    return { units, assignments };
  }
  return { units: [], assignments: [] };
}

// ---------------------------------------------------------------------------
// State builder
// ---------------------------------------------------------------------------

function walkMarkdown(dir: string, relDir: string, out: Array<{ abs: string; rel: string }>): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walkMarkdown(abs, rel, out);
    else if (entry.name.endsWith(".md")) out.push({ abs, rel });
  }
}

function parsePage(abs: string, rel: string): FinalGardenPage | null {
  const content = readText(abs);
  if (content === undefined) return null;
  const { rawFrontmatter, body } = splitFrontmatter(content);
  const generatedBy = fmScalar(rawFrontmatter, "generated_by") || fmScalar(rawFrontmatter, "generatedBy");
  const kt = fmScalar(rawFrontmatter, "knowledge_type");
  const bt = fmScalar(rawFrontmatter, "breadboardType");
  const isLesson = kt === "learning-page" || kt === "textbook-page" || bt === "learning_page" || bt === "textbook_page";
  if (!isLesson || generatedBy !== "learn_button") return null;

  const formulas: FinalFormulaRecord[] = formulaEntriesFromFrontmatter(rawFrontmatter).map((entry) => ({
    pageRel: rel,
    text: String(entry.text ?? ""),
    declaredKind: (String(entry.kind ?? "") as FormulaKind) || "",
    structuralKind: formulaStructuralKind(String(entry.text ?? "")),
    groundingStatus: String(entry.groundingStatus ?? ""),
    sourceAnchor: entry.sourceAnchor ? String(entry.sourceAnchor) : undefined,
    basedOnFormula: entry.basedOnFormula ? String(entry.basedOnFormula) : undefined,
  }));

  return {
    rel,
    abs,
    title: fmScalar(rawFrontmatter, "title"),
    sectionNumber: Number(fmScalar(rawFrontmatter, "sectionNumber")) || 0,
    subsectionNumber: fmScalar(rawFrontmatter, "subsectionNumber"),
    learningUnitId: fmScalar(rawFrontmatter, "learningUnitId"),
    learningUnitRole: fmScalar(rawFrontmatter, "learningUnitRole"),
    tags: fmArray(rawFrontmatter, "tags"),
    sourceAnchors: fmArray(rawFrontmatter, "sourceAnchors"),
    sourceFormulaAnchors: fmArray(rawFrontmatter, "sourceFormulaAnchors"),
    sourceVisualIds: fmArray(rawFrontmatter, "sourceVisualIds"),
    visualIds: fmArray(rawFrontmatter, "visualIds"),
    formulas,
    rawFrontmatter,
    body,
    lastSemanticRepairAt: fmScalar(rawFrontmatter, "lastSemanticRepairAt"),
  };
}

function parseSection(abs: string, rel: string): FinalGardenSection {
  const content = readText(abs) ?? "";
  const { rawFrontmatter, body } = splitFrontmatter(content);
  const title = fmScalar(rawFrontmatter, "title") || body.match(/^\s*#\s+(.+?)\s*$/m)?.[1]?.trim() || path.basename(path.dirname(abs));
  const childPageRels = body
    .split(/\r?\n/)
    .filter((line) => /\[\[learning\//i.test(line))
    .map((line) => line.match(/\[\[([^\]|]+)/)?.[1] ?? "")
    .filter(Boolean);
  return { rel, title, childPageRels, body };
}

export function buildFinalGardenState(gardenDir: string, slug?: string): FinalGardenState {
  const bd = path.join(gardenDir, ".breadboard");
  const mdFiles: Array<{ abs: string; rel: string }> = [];
  walkMarkdown(path.join(gardenDir, "learning"), "learning", mdFiles);

  const pages: FinalGardenPage[] = [];
  const sections: FinalGardenSection[] = [];
  for (const { abs, rel } of mdFiles) {
    if (/\/_index\.md$/i.test(rel) || rel === "learning/_index.md") {
      sections.push(parseSection(abs, rel));
      continue;
    }
    const page = parsePage(abs, rel);
    if (page) pages.push(page);
  }
  pages.sort((a, b) => a.rel.localeCompare(b.rel));

  const sourceAnchors = buildCanonicalSourceAnchors(gardenDir);
  const contract = readFinalContract(gardenDir);

  // Visuals: from .breadboard/visuals/*.json (canonical files) and from bodies.
  const visualsById = new Map<string, FinalVisualSpec>();
  const visualsDir = path.join(bd, "visuals");
  if (fs.existsSync(visualsDir)) {
    for (const name of fs.readdirSync(visualsDir)) {
      if (!name.endsWith(".json")) continue;
      const spec = readJson<Record<string, unknown>>(path.join(visualsDir, name), {});
      const id = String(spec.id ?? name.replace(/\.json$/i, "")).trim();
      if (!id) continue;
      const anchors = visualAnchorIdsByKind(spec);
      visualsById.set(id, {
        id,
        type: String(spec.type ?? ""),
        pageRel: String(spec.pageId ?? "") || undefined,
        anchorIds: anchors.hard,
        textAnchorIds: anchors.text,
        anchorRoles: anchors.roles,
        fromFile: true,
        fromBody: false,
      });
    }
  }
  for (const page of pages) {
    for (const spec of embeddedVisualSpecs(page.body)) {
      const id = String(spec.id ?? "").trim();
      if (!id) continue;
      const anchors = visualAnchorIdsByKind(spec);
      const existing = visualsById.get(id);
      if (existing) {
        existing.fromBody = true;
        existing.pageRel = existing.pageRel ?? page.rel;
        // Body copy is authoritative for what the learner actually sees.
        existing.anchorIds = anchors.hard;
        existing.textAnchorIds = anchors.text;
        existing.anchorRoles = anchors.roles;
      } else {
        visualsById.set(id, {
          id,
          type: String(spec.type ?? ""),
          pageRel: page.rel,
          anchorIds: anchors.hard,
          textAnchorIds: anchors.text,
          anchorRoles: anchors.roles,
          fromFile: false,
          fromBody: true,
        });
      }
    }
  }
  const visuals = [...visualsById.values()];

  // Formulas + usages.
  const formulas: FinalFormulaRecord[] = [];
  const sourceUsages: SourceUsageRecord[] = [];
  const visualLedger = readJson<Array<Record<string, unknown>>>(path.join(bd, "source-visuals.json"), []);
  const embeddedCropIds = new Set<string>();
  for (const visual of visualLedger) {
    const status = String(visual.cropStatus ?? "");
    if (status === "embedded") embeddedCropIds.add(String(visual.sourceVisualId ?? ""));
  }

  for (const page of pages) {
    for (const formula of page.formulas) {
      formulas.push(formula);
      const kind = classifyFormulaKind({
        kind: formula.declaredKind || undefined,
        text: formula.text,
        groundingStatus: formula.groundingStatus,
        sourceAnchor: formula.sourceAnchor,
      });
      if ((kind === "source_definition" || kind === "source_derived_definition") && formula.sourceAnchor) {
        sourceUsages.push({ anchorId: formula.sourceAnchor, pageRel: page.rel, kind: "formula_definition" });
      } else if (kind === "worked_example" && (formula.basedOnFormula || formula.sourceAnchor)) {
        sourceUsages.push({ anchorId: String(formula.basedOnFormula ?? formula.sourceAnchor), pageRel: page.rel, kind: "worked_example" });
      }
    }
    for (const anchorId of page.sourceFormulaAnchors) {
      sourceUsages.push({ anchorId, pageRel: page.rel, kind: "formula_definition" });
    }
    for (const anchorId of page.sourceAnchors) {
      if (/^text-/i.test(anchorId)) sourceUsages.push({ anchorId, pageRel: page.rel, kind: "text_concept" });
      else if (!page.sourceFormulaAnchors.includes(anchorId)) sourceUsages.push({ anchorId, pageRel: page.rel, kind: "page_prose" });
    }
    for (const anchorId of page.sourceVisualIds) {
      if (embeddedCropIds.has(anchorId)) sourceUsages.push({ anchorId, pageRel: page.rel, kind: "source_crop" });
    }
  }
  for (const visual of visuals) {
    const pageRel = visual.pageRel ?? "";
    for (const anchorId of [...visual.anchorIds, ...visual.textAnchorIds]) {
      sourceUsages.push({ anchorId, pageRel, kind: "visual_grounding" });
    }
  }

  // Zettel handles.
  const unitsById = new Map(contract.units.map((unit) => [unit.id, unit]));
  const zettelHandles: FinalZettelHandleRecord[] = [];
  for (const page of pages) {
    const unit = unitsById.get(page.learningUnitId);
    for (const handle of page.tags) {
      const reason = zettelHandleNaturalnessReason(handle);
      zettelHandles.push({
        pageRel: page.rel,
        unitId: page.learningUnitId,
        handle,
        natural: reason === null,
        reason: reason ?? undefined,
      });
    }
    void unit;
  }

  // Repair log.
  const repairLogRaw = readJson<Record<string, unknown>>(path.join(bd, "repair-log.json"), {});
  const repairs = Array.isArray(repairLogRaw.repairs) ? (repairLogRaw.repairs as Array<Record<string, unknown>>) : [];
  const repairLog: RepairLog | undefined = Array.isArray(repairLogRaw.repairs)
    ? {
        requests: Array.isArray(repairLogRaw.requests) ? repairLogRaw.requests : undefined,
        repairs: repairs.map((entry) => ({
          targetKind: entry.targetKind as RepairTargetKind | undefined,
          unitId: entry.unitId ? String(entry.unitId) : undefined,
          pagePath: entry.pagePath ? String(entry.pagePath) : undefined,
          sectionPath: entry.sectionPath ? String(entry.sectionPath) : undefined,
          affectedUnitIds: Array.isArray(entry.affectedUnitIds) ? entry.affectedUnitIds.map(String) : undefined,
          affectedSectionId: entry.affectedSectionId ? String(entry.affectedSectionId) : undefined,
          changedFiles: Array.isArray(entry.changedFiles) ? entry.changedFiles.map(String) : [],
          failureTypes: Array.isArray(entry.failureTypes) ? entry.failureTypes.map(String) : [],
          executorUsed: entry.executorUsed ? String(entry.executorUsed) : undefined,
          result: entry.result ? String(entry.result) : undefined,
        })),
      }
    : undefined;

  const planningDir = path.join(bd, "planning");
  return {
    rootPath: path.resolve(gardenDir),
    slug: slug ?? path.basename(gardenDir),
    pages,
    sections,
    learningUnitContract: contract,
    sourceAnchors,
    sourceUsages,
    visuals,
    formulas,
    zettelHandles,
    repairLog,
    planningDocs: {
      sourceMap: readText(path.join(planningDir, "Source Map.md")),
      scopeContract: readText(path.join(planningDir, "Scope Contract.md")),
      learningMap: readText(path.join(gardenDir, "learning", "Learning Map.md")),
      sourceCoverage: readText(path.join(planningDir, "Source Coverage.md")),
    },
  };
}

// ---------------------------------------------------------------------------
// Deterministic Source Coverage projection
// ---------------------------------------------------------------------------

function pageTitleByRel(state: FinalGardenState): Map<string, string> {
  const map = new Map<string, string>();
  for (const page of state.pages) {
    map.set(page.rel, page.title);
    // Visual specs carry pageId without the .md extension; resolve both forms.
    map.set(page.rel.replace(/\.md$/i, ""), page.title);
  }
  return map;
}

function usageIndex(state: FinalGardenState): Map<string, SourceUsageRecord[]> {
  const index = new Map<string, SourceUsageRecord[]>();
  for (const usage of state.sourceUsages) {
    const list = index.get(usage.anchorId) ?? [];
    list.push(usage);
    index.set(usage.anchorId, list);
  }
  return index;
}

export const SOURCE_COVERAGE_HEADINGS = [
  "Embedded Source Crops",
  "Explained as Text Formulas",
  "Explained in Prose",
  "Used as Interactive Grounding",
  "Referenced Again in Synthesis",
  "Crop Omitted With Text Fallback",
  "Intentionally Omitted",
  "Missing or Misplaced",
] as const;

/** Source Coverage as a pure projection of the canonical state (Fix 3). */
export function projectSourceCoverage(state: FinalGardenState): string {
  const titleFor = pageTitleByRel(state);
  const index = usageIndex(state);
  const anchors = state.sourceAnchors;
  const label = (id: string): string => anchors[id]?.title ?? id;
  const wherePages = (id: string, kinds: SourceUsageKind[]): string[] => {
    const set = new Set<string>();
    for (const usage of index.get(id) ?? []) {
      if (kinds.includes(usage.kind) && usage.pageRel) set.add(titleFor.get(usage.pageRel) ?? usage.pageRel);
    }
    return [...set];
  };

  const visualLedger = readJson<Array<Record<string, unknown>>>(path.join(state.rootPath, ".breadboard", "source-visuals.json"), []);
  const cropStatusById = new Map(visualLedger.map((v) => [String(v.sourceVisualId ?? ""), String(v.cropStatus ?? "")]));

  const embedded: string[] = [];
  const textFormulas: string[] = [];
  const prose: string[] = [];
  const interactive: string[] = [];
  const referenced: string[] = [];
  const cropFallback: string[] = [];
  const omitted: string[] = [];
  const missing: string[] = [];
  const reconciled: string[] = [];

  const allAnchorIds = new Set<string>([...Object.keys(anchors), ...index.keys()]);
  for (const id of [...allAnchorIds].sort()) {
    const usages = index.get(id) ?? [];
    const cropPages = wherePages(id, ["source_crop"]);
    const formulaPages = wherePages(id, ["formula_definition"]);
    const provePages = wherePages(id, ["page_prose", "text_concept"]);
    const visualPages = wherePages(id, ["visual_grounding"]);
    const used = usages.length > 0;

    const anchor = anchors[id];
    const isFormula = anchor?.kind === "formula";
    const isCrop = cropPages.length > 0;
    const cropStatus = cropStatusById.get(id) ?? "";

    const allPages = [...new Set([...cropPages, ...formulaPages, ...provePages, ...visualPages])];
    reconciled.push(`- ${id} (${used ? "used" : "unused"}): ${label(id)}; used on: ${allPages.length > 0 ? allPages.join("; ") : "none"}`);

    if (isCrop) embedded.push(`- ${id}: ${label(id)}; used on ${cropPages.join("; ")}`);
    if (isFormula && formulaPages.length > 0) textFormulas.push(`- ${id}: ${label(id)}; used on ${formulaPages.join("; ")}`);
    for (const usage of usages) {
      if (usage.kind === "text_concept" || usage.kind === "page_prose") {
        prose.push(`- ${id}: ${titleFor.get(usage.pageRel) ?? usage.pageRel}; ${label(id)}`);
      }
    }
    if (visualPages.length > 0) interactive.push(`- ${id}: ${label(id)}; used on ${visualPages.join("; ")}; visual source grounding`);
    if (isFormula && cropStatus === "omitted_unreliable") {
      cropFallback.push(`- ${id}: ${label(id)}; used on ${formulaPages.join("; ") || "none"}; crop omitted with text/formula fallback`);
    }
    if (!used && anchor) missing.push(`- ${id}: ${label(id)}; used on none`);
  }

  for (const assignment of state.learningUnitContract.assignments) {
    const unit = state.learningUnitContract.units.find((u) => u.id === assignment.assignedLearningUnitId);
    referenced.push(`- ${assignment.sourceArtifactId}: assigned to ${assignment.assignedLearningUnitId}${unit ? ` (${unit.title})` : ""}; placement=${assignment.placement}; ${assignment.requiredInterpretation || assignment.reason}`);
  }

  const section = (heading: string, items: string[]): string[] => [
    "",
    `## ${heading}`,
    "",
    ...(items.length > 0 ? [...new Set(items)] : ["- None."]),
  ];

  const lines = [
    "# Source Coverage",
    "",
    "Generated deterministically from the canonical FinalGardenState: learner",
    "frontmatter, learner bodies, final visual JSON, source-anchor ledgers, and",
    "the Learning Unit Contract. Every line is a projection of a final artifact.",
    "",
    "## Reconciled Source Visual Usage",
    "",
    ...reconciled,
    ...section("Embedded Source Crops", embedded),
    ...section("Explained as Text Formulas", textFormulas),
    ...section("Explained in Prose", prose),
    ...section("Used as Interactive Grounding", interactive),
    ...section("Referenced Again in Synthesis", referenced),
    ...section("Crop Omitted With Text Fallback", cropFallback),
    ...section("Intentionally Omitted", omitted),
    ...section("Missing or Misplaced", missing),
    "",
    "## Notes",
    "",
    "- Source Coverage is a deterministic projection of FinalGardenState; any drift from final files blocks acceptance.",
  ];
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Final-state audit
// ---------------------------------------------------------------------------

export interface FinalAuditResult {
  ok: boolean;
  problems: string[];
  byRule: Record<string, string[]>;
  warnings: string[];
}

function coverageSection(markdown: string, heading: string): string {
  const re = new RegExp(`^#{2,3}\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im");
  const match = re.exec(markdown);
  if (!match) return "";
  const start = (match.index ?? 0) + match[0].length;
  const rest = markdown.slice(start);
  const next = rest.search(/^#{2,3}\s+/m);
  return next >= 0 ? rest.slice(0, next) : rest;
}

const ANCHOR_TOKEN_RE = /\bS\d+\.P\d+\.[A-Za-z]\w*\b|\btext-[a-z0-9-]+\b/gi;

function invalidRegistryAnchorRecords(rootPath: string): string[] {
  const ledger = readJson<Record<string, unknown>>(path.join(rootPath, ".breadboard", "source-anchors.json"), {});
  const problems: string[] = [];
  for (const key of ["sourceTextConceptAnchors", "sourceStructuralAnchors"]) {
    const records = Array.isArray(ledger[key]) ? ledger[key] as Array<Record<string, unknown>> : [];
    for (const record of records) {
      const id = String(record.id ?? "").trim();
      if (!id) continue;
      if (!isPlausibleSourceAnchorId(id)) {
        const rejected = classifyRejectedSourceAnchorLabel(id);
        problems.push(`source-anchor registry ${key} contains invalid source-anchor label "${id}" (${rejected.reason}); it must not be registered as canonical`);
        continue;
      }
      const kind = String(record.kind ?? (key === "sourceTextConceptAnchors" ? "text_concept" : "")).trim();
      if (key === "sourceStructuralAnchors" && kind && !["text_concept", "formula", "figure", "table", "graph", "abstract", "intro", "guidance"].includes(kind)) {
        problems.push(`source-anchor registry ${key} record "${id}" has invalid kind "${kind}"`);
      }
      if (!String(record.sourceId ?? "").trim()) problems.push(`source-anchor registry ${key} record "${id}" is missing sourceId`);
      if (!String(record.title ?? "").trim()) problems.push(`source-anchor registry ${key} record "${id}" is missing title`);
      if (key === "sourceTextConceptAnchors" && !String(record.semanticSummary ?? "").trim()) {
        problems.push(`source-anchor registry ${key} record "${id}" is missing semanticSummary`);
      }
    }
  }
  return problems;
}

/**
 * The single final-state consistency audit. Acceptance is `Accepted: yes` only
 * when this passes. Each rule proves a class of state drift cannot survive.
 */
export function auditFinalGardenState(state: FinalGardenState): FinalAuditResult {
  const byRule: Record<string, string[]> = {};
  const warnings: string[] = [];
  const add = (rule: string, problem: string): void => {
    (byRule[rule] ??= []).push(problem);
  };

  const anchors = state.sourceAnchors;
  const index = usageIndex(state);
  const unitsById = new Map(state.learningUnitContract.units.map((u) => [u.id, u]));
  for (const problem of invalidRegistryAnchorRecords(state.rootPath)) add("invalid_anchor_label", problem);

  // Rule A — every referenced anchor resolves through the canonical registry.
  const referencedAnchors = new Map<string, string[]>();
  const invalidAnchorLabels = new Map<string, string[]>();
  const noteRef = (id: string, where: string): void => {
    if (!id || id.startsWith("trivial:")) return;
    if (!isPlausibleSourceAnchorId(id)) {
      (invalidAnchorLabels.get(id) ?? invalidAnchorLabels.set(id, []).get(id)!).push(where);
      return;
    }
    (referencedAnchors.get(id) ?? referencedAnchors.set(id, []).get(id)!).push(where);
  };
  for (const page of state.pages) {
    for (const id of page.sourceAnchors) noteRef(id, `${page.rel} (sourceAnchors)`);
    for (const id of page.sourceFormulaAnchors) noteRef(id, `${page.rel} (sourceFormulaAnchors)`);
    for (const id of page.sourceVisualIds) noteRef(id, `${page.rel} (sourceVisualIds)`);
    for (const formula of page.formulas) {
      if (formula.sourceAnchor) noteRef(formula.sourceAnchor, `${page.rel} (formula sourceAnchor)`);
      if (formula.basedOnFormula) noteRef(formula.basedOnFormula, `${page.rel} (formula basedOnFormula)`);
    }
  }
  for (const visual of state.visuals) {
    for (const id of [...visual.anchorIds, ...visual.textAnchorIds]) noteRef(id, `visual ${visual.id}`);
  }
  for (const unit of state.learningUnitContract.units) {
    for (const id of unit.sourceAnchors ?? []) noteRef(id, `contract ${unit.id}`);
  }
  for (const [id, where] of invalidAnchorLabels) {
    const rejected = classifyRejectedSourceAnchorLabel(id);
    add(
      "invalid_anchor_label",
      `invalid source-anchor label "${id}" is referenced (${where.slice(0, 3).join("; ")}${where.length > 3 ? "; ..." : ""}); it looks like ${rejected.reason === "planning_caveat" ? "a planning/caveat label" : "a non-anchor label"}, not a canonical source-anchor ID`,
    );
  }
  for (const [id, where] of referencedAnchors) {
    if (!anchors[id]) {
      add("anchor_resolution", `source anchor "${id}" is referenced (${where.slice(0, 3).join("; ")}${where.length > 3 ? "; …" : ""}) but is missing from the canonical source-anchor registry`);
    }
  }

  // Rule A2 — a GENERATED semantic anchor must have defensible source evidence.
  // Registering an anchor from one weak keyword hit turns "unregistered" into
  // "registered but wrongly grounded"; a low/unsupported anchor is blocking in
  // strict mode until a critic confirms it (Fix 4).
  for (const [id, anchor] of Object.entries(anchors)) {
    if (!anchor.confidence || anchor.criticConfirmed) continue;
    if (anchor.confidence !== "low" && anchor.confidence !== "unsupported") continue;
    if (!referencedAnchors.has(id)) continue;
    add(
      "anchor_evidence",
      `source anchor "${id}" is registered with ${anchor.confidence} source evidence (score ${anchor.evidence?.totalScore ?? "?"}, ${anchor.evidence?.keywordHits.length ?? 0} keyword hit(s)); strict acceptance requires medium+ confidence or a critic confirmation`,
    );
  }

  // Rule B — contract/page anchor relations agree bidirectionally.
  for (const page of state.pages) {
    const unit = unitsById.get(page.learningUnitId);
    if (!page.learningUnitId) {
      add("contract_page_anchor", `${page.rel}: page has no learningUnitId; cannot map to a learning unit`);
      continue;
    }
    if (!unit) {
      add("contract_page_anchor", `${page.rel}: learningUnitId "${page.learningUnitId}" is not in the Learning Unit Contract`);
      continue;
    }
    const allowed = new Set<string>([
      ...(unit.sourceAnchors ?? []),
      ...unit.sourceFigures.map((f) => f.id),
      ...unit.sourceFormulas.map((f) => f.id),
      ...unit.sourceTables.map((t) => t.id),
      ...state.learningUnitContract.assignments.filter((a) => a.assignedLearningUnitId === unit.id).map((a) => a.sourceArtifactId),
    ]);
    for (const id of [...page.sourceAnchors, ...page.sourceFormulaAnchors]) {
      if (id.startsWith("text-")) continue; // text anchors validated by ledger presence in Rule A
      if (!allowed.has(id)) {
        add("contract_page_anchor", `${page.rel}: uses source anchor "${id}" that unit ${unit.id}'s contract does not allow (no contract entry or contract patch)`);
      }
    }
  }

  // Rule C — Source Coverage is a faithful projection of final files.
  const coverage = state.planningDocs.sourceCoverage;
  if (coverage) {
    const reconciledSection = coverageSection(coverage, "Reconciled Source Visual Usage");
    const missingSection = coverageSection(coverage, "Missing or Misplaced");
    for (const line of reconciledSection.split(/\r?\n/)) {
      const idMatch = line.match(/^-\s*(\S+)\s*\((used|unused)\)/);
      if (!idMatch) continue;
      const [, id, claim] = idMatch;
      const actuallyUsed = (index.get(id) ?? []).length > 0;
      if (claim === "unused" && actuallyUsed) {
        const where = [...new Set((index.get(id) ?? []).map((u) => u.pageRel).filter(Boolean))];
        add("source_coverage", `Source Coverage marks ${id} as "unused" but final files use it (${where.join(", ")})`);
      }
    }
    for (const line of missingSection.split(/\r?\n/)) {
      const idMatch = line.match(/^-\s*(\S+):/);
      if (!idMatch) continue;
      const id = idMatch[1];
      if ((index.get(id) ?? []).some((u) => u.kind === "formula_definition" || u.kind === "page_prose" || u.kind === "source_crop")) {
        add("source_coverage", `Source Coverage lists ${id} under "Missing or Misplaced" but a final page teaches/uses it`);
      }
    }
    // Interactive grounding claims must match the visual JSON.
    const interactiveSection = coverageSection(coverage, "Used as Interactive Grounding");
    const visualById = new Map(state.visuals.map((v) => [v.id, v]));
    for (const line of interactiveSection.split(/\r?\n/)) {
      const visualId = [...visualById.keys()].find((vid) => vid && line.includes(vid));
      if (!visualId) continue;
      const actual = new Set([...(visualById.get(visualId)?.anchorIds ?? []), ...(visualById.get(visualId)?.textAnchorIds ?? [])]);
      for (const token of line.match(ANCHOR_TOKEN_RE) ?? []) {
        if (token === visualId) continue;
        if (!actual.has(token)) add("source_coverage", `Source Coverage claims visual ${visualId} uses ${token}, but final visual JSON does not`);
      }
    }
  }

  // Rule D — formula kinds are correct (no worked example as source_definition).
  // Only flag cases reconcile can fix without orphaning a required anchor: the
  // page keeps a symbolic definition for the anchor, or the anchor is not
  // contract-required. The sole numeric grounding of a required anchor is a
  // content-generation gap, not a labeling drift, so it is not flagged here.
  const formulasByPage = new Map<string, FinalFormulaRecord[]>();
  for (const formula of state.formulas) {
    (formulasByPage.get(formula.pageRel) ?? formulasByPage.set(formula.pageRel, []).get(formula.pageRel)!).push(formula);
  }
  for (const [pageRel, formulas] of formulasByPage) {
    const page = state.pages.find((p) => p.rel === pageRel);
    const unit = page ? unitsById.get(page.learningUnitId) : undefined;
    const required = new Set<string>([
      ...(unit?.sourceFormulas ?? []).map((f) => f.id),
      ...(unit?.sourceAnchors ?? []),
    ]);
    const symbolicDefAnchors = new Set(
      formulas
        .filter((f) => (f.declaredKind === "source_definition" || f.declaredKind === "source_derived_definition")
          && f.structuralKind === "definition" && f.sourceAnchor)
        .map((f) => String(f.sourceAnchor)),
    );
    for (const formula of formulas) {
      if ((formula.declaredKind === "source_definition" || formula.declaredKind === "source_derived_definition")
        && formula.structuralKind === "worked_example"
        && workedExampleIsSafelyRelabelable(formula.sourceAnchor, symbolicDefAnchors, required)) {
        add("formula_kind", `${pageRel}: formula labeled ${formula.declaredKind} but is a worked example (concrete numeric substitution): "${formula.text.slice(0, 60)}"`);
      }
    }
  }

  // Rule E — section index prose is generated, not templated.
  for (const section of state.sections) {
    const prose = teachingProseOnly(section.body).replace(/^#.*$/gm, " ").trim();
    if (isTemplateSectionSummary(prose)) {
      add("section_index_prose", `${section.rel}: contains template section-index prose ("${prose.replace(/\s+/g, " ").slice(0, 70)}…")`);
    }
  }

  // Rule F — zettel handles read like durable claims, not planner scaffolds.
  for (const record of state.zettelHandles) {
    if (!record.natural) add("zettel_naturalness", `${record.pageRel}: zettel handle "${record.handle}" ${record.reason}`);
  }
  for (const unit of state.learningUnitContract.units) {
    for (const handle of zettelHandlesForUnit(unit)) {
      const reason = zettelHandleNaturalnessReason(handle);
      if (reason) add("zettel_naturalness", `contract ${unit.id}: zettel handle "${handle}" ${reason}`);
    }
  }

  // Rule G — no paraphrased repeated openings across near-adjacent pages.
  for (const finding of repeatedOpeningFindings(state.pages.map((p) => ({ rel: p.rel, body: p.body })))) {
    if (finding.severity === "fail") add("repeated_opening", finding.message);
    else warnings.push(`repeated opening (warn): ${finding.message}`);
  }

  // Rule H — repair provenance: changed files belong to the entry's target.
  if (state.repairLog) {
    const pageByRel = new Map(state.pages.map((p) => [p.rel, p]));
    for (const entry of state.repairLog.repairs) {
      const allowed = allowedChangedFilesForRepair(entry, pageByRel);
      for (const file of entry.changedFiles) {
        if (!allowed(file)) add("repair_provenance", `${entry.pagePath ?? entry.unitId ?? "(repair)"}: changedFiles includes ${file}, which does not belong to a ${entry.targetKind ?? "unit_page"} repair`);
      }
    }
  }

  // Rule I — planning caveats must be compatible with extracted evidence.
  const sourceMap = state.planningDocs.sourceMap ?? "";
  if (sourceMap) {
    const definedFormulaAnchors = Object.values(anchors).filter((a) => a.kind === "formula").map((a) => a.id);
    for (const id of definedFormulaAnchors) {
      const idRe = new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      // A caveat that names this anchor while claiming formulas are unavailable.
      const lines = sourceMap.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        if (!idRe.test(lines[i])) continue;
        const context = lines.slice(Math.max(0, i - 12), i + 2).join(" ");
        if (/not (?:fully )?(?:visible|available|included)|are not visible|not included|unavailable/i.test(context)
          && (index.get(id) ?? []).some((u) => u.kind === "formula_definition")) {
          add("planning_caveat", `Source Map caveat claims ${id} is unavailable, but the formula anchor is defined and taught on a final page`);
          break;
        }
      }
    }
  }

  // Rule J — SEMANTIC anchor compatibility (Fix 3). Field agreement is not
  // enough: a formula grounded to an anchor whose metric family contradicts the
  // formula's own math is synchronized wrongness (e.g. a surrogate-gradient or
  // accuracy formula grounded to the normalized-energy-efficiency anchor).
  for (const page of state.pages) {
    for (const formula of page.formulas) {
      if (formula.declaredKind !== "source_definition" && formula.declaredKind !== "source_derived_definition") continue;
      const anchorId = formula.sourceAnchor;
      if (!anchorId) continue;
      const anchor = anchors[anchorId];
      if (!anchor || anchor.kind !== "formula" || !anchor.formulaFamily) continue;
      const formulaFamily = formulaMetricFamily(formula.text);
      if (formulaFamily && !metricFamiliesCompatible(formulaFamily, anchor.formulaFamily)) {
        add("anchor_compatibility", `${page.rel}: formula "${formula.text.slice(0, 48)}" is a ${formulaFamily} formula but is grounded to ${anchorId}, the ${anchor.formulaFamily} formula — semantically incompatible`);
      }
    }
    // Page/contract may both declare a formula anchor with no matching formula
    // on the page whose family is clearly foreign to the page's own metrics.
    const definitionFamilies = new Set<string>();
    for (const f of page.formulas) {
      if (f.structuralKind !== "definition") continue;
      const fam = formulaMetricFamily(f.text);
      if (fam) definitionFamilies.add(fam);
    }
    if (definitionFamilies.size > 0) {
      for (const anchorId of page.sourceFormulaAnchors) {
        const anchor = anchors[anchorId];
        if (!anchor || anchor.kind !== "formula" || !anchor.formulaFamily) continue;
        const compatible = [...definitionFamilies].some((fam) => metricFamiliesCompatible(fam, anchor.formulaFamily!));
        if (!compatible) {
          add("anchor_compatibility", `${page.rel}: source formula anchor ${anchorId} (${anchor.formulaFamily}) has no compatible formula on the page (page defines [${[...definitionFamilies].join(", ")}])`);
        }
      }
    }
  }

  // Rule K — text anchors must be specific when the source text exists (Fix 7).
  const corpus = sourceCorpusLower(state.rootPath);
  if (corpus) {
    const usedTextAnchors = new Set(state.sourceUsages.filter((u) => u.kind === "text_concept").map((u) => u.anchorId));
    for (const id of usedTextAnchors) {
      const anchor = anchors[id];
      if (!anchor || anchor.kind !== "text_concept" || anchor.exactText) continue;
      const keywords = (anchor.conceptKeywords ?? []).map((k) => k.toLowerCase()).filter((k) => k.length >= 4 && !GENERIC_CONCEPT_WORDS.has(k));
      const present = keywords.filter((k) => corpus.includes(k));
      if (present.length >= 2) {
        add("text_anchor_specificity", `${id}: used as a source text anchor but carries no exactText even though the source text covers [${present.slice(0, 4).join(", ")}]`);
      }
    }
  }

  // Rule L — debug failed-repairs must not ship in a production export (Fix 13).
  try {
    const debugDir = path.join(state.rootPath, ".breadboard", "debug", "failed-repairs");
    if (fs.existsSync(debugDir)) {
      const files = fs.readdirSync(debugDir).filter((n) => !n.startsWith("."));
      if (files.length > 0) {
        add("debug_failed_repairs", `${files.length} failed-repair debug file(s) are shipped under .breadboard/debug/failed-repairs/; they must be removed from a production export`);
      }
    }
  } catch {
    // no debug dir
  }

  const problems = Object.values(byRule).flat();
  return { ok: problems.length === 0, problems, byRule, warnings };
}

/**
 * A source-definition formula belongs to exactly one metric family, so its
 * family must match its anchor's family. Unrecognized families cannot be
 * disproved, so they are treated as compatible (never a false mismatch).
 */
function metricFamiliesCompatible(a: string, b: string): boolean {
  return !a || !b || a === b;
}

const GENERIC_CONCEPT_WORDS = new Set([
  "source", "concept", "prose", "supports", "explains", "based", "content", "material",
  "spiking", "neural", "networks", "network", "future", "brain", "inspired", "computing",
]);

function sourceCorpusLower(rootPath: string): string {
  const files: Array<{ abs: string; rel: string }> = [];
  walkMarkdown(path.join(rootPath, "sources"), "sources", files);
  const parts: string[] = [];
  for (const { abs } of files) {
    const text = readText(abs);
    if (text) parts.push(splitFrontmatter(text).body);
  }
  return parts.join("\n\n").toLowerCase();
}

// ---------------------------------------------------------------------------
// Reconciliation — bring every final artifact back into agreement with the
// canonical state so a regenerated garden passes the audit honestly.
// ---------------------------------------------------------------------------

export interface ReconcileResult {
  changed: string[];
  notes: string[];
}

function jsonScalar(value: string | number | boolean): string {
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(String(value).replace(/\r/g, ""));
}

function setFmArrayLine(rawFm: string, key: string, values: string[]): string {
  const cleaned = [...new Set(values.filter(Boolean))];
  const re = new RegExp(`^${key}:\\s*\\[[^\\]]*\\]\\s*$`, "m");
  if (cleaned.length === 0) return re.test(rawFm) ? rawFm.replace(re, "").replace(/\n{3,}/g, "\n") : rawFm;
  const line = `${key}: [${cleaned.map((item) => jsonScalar(item)).join(", ")}]`;
  if (re.test(rawFm)) return rawFm.replace(re, line);
  return `${rawFm.replace(/\s+$/, "")}\n${line}`;
}

export interface InvalidAnchorLabelRepairRequest {
  targetKind: "unit_page" | "learning_unit_contract";
  invalidValue: string;
  pagePath?: string;
  unitId?: string;
  reason: "not_anchor_id" | "generic_label" | "planning_caveat";
  repairAction: "remove_from_sourceAnchors" | "move_to_caveats" | "replace_with_canonical_anchor";
}

export interface InvalidAnchorLabelRepairResult {
  changed: string[];
  notes: string[];
  requests: InvalidAnchorLabelRepairRequest[];
}

function repairActionForInvalidLabel(label: RejectedSourceAnchorLabel): InvalidAnchorLabelRepairRequest["repairAction"] {
  return label.reason === "planning_caveat" ? "move_to_caveats" : "remove_from_sourceAnchors";
}

function sanitizeAnchorArrayForField(values: string[]): SourceAnchorSanitizationResult {
  return sanitizeSourceAnchorIds(values);
}

/** Remove non-anchor labels from source-grounding fields. Caveat labels move to
 * sourceCaveats/sourceNotes so they remain visible but cannot satisfy grounding. */
export function repairInvalidSourceAnchorLabels(gardenDir: string, slug?: string): InvalidAnchorLabelRepairResult {
  const result: InvalidAnchorLabelRepairResult = { changed: [], notes: [], requests: [] };
  const markChanged = (rel: string): void => { if (!result.changed.includes(rel)) result.changed.push(rel); };
  const noteMove = (value: string, where: string, label: RejectedSourceAnchorLabel): void => {
    result.notes.push(`removed invalid source-anchor label "${value}" from ${where}; classified as ${label.reason}${label.suggestedField ? ` (${label.suggestedField})` : ""}`);
  };

  const state = buildFinalGardenState(gardenDir, slug);
  for (const page of state.pages) {
    const content = readText(page.abs);
    if (content === undefined) continue;
    const { rawFrontmatter, body } = splitFrontmatter(content);
    let rawFm = rawFrontmatter;
    let pageChanged = false;
    const moved: string[] = [];
    for (const key of ["sourceAnchors", "sourceFormulaAnchors"]) {
      const values = fmArray(rawFm, key);
      if (values.length === 0) continue;
      const sanitized = sanitizeAnchorArrayForField(values);
      if (sanitized.rejectedLabels.length === 0) continue;
      rawFm = setFmArrayLine(rawFm, key, sanitized.acceptedAnchorIds);
      pageChanged = true;
      for (const label of sanitized.rejectedLabels) {
        if (label.suggestedField === "sourceCaveats") moved.push(label.value);
        result.requests.push({
          targetKind: "unit_page",
          invalidValue: label.value,
          pagePath: page.rel,
          reason: label.reason === "invalid_format" || label.reason === "unresolved" ? "not_anchor_id" : label.reason,
          repairAction: repairActionForInvalidLabel(label),
        });
        noteMove(label.value, `${page.rel} ${key}`, label);
      }
    }
    if (moved.length > 0) {
      rawFm = setFmArrayLine(rawFm, "sourceCaveats", [...fmArray(rawFm, "sourceCaveats"), ...moved]);
      pageChanged = true;
    }
    if (pageChanged && rawFm !== rawFrontmatter) {
      fs.writeFileSync(page.abs, `---\n${rawFm.replace(/\s+$/, "")}\n---\n\n${body.replace(/^\n+/, "")}`, "utf-8");
      markChanged(page.rel);
    }
  }

  const bd = path.join(gardenDir, ".breadboard");
  const contractPath = fs.existsSync(path.join(bd, "learning-unit-contract.json"))
    ? path.join(bd, "learning-unit-contract.json")
    : path.join(bd, "planning", "learning-unit-contract.json");
  if (fs.existsSync(contractPath)) {
    const contractJson = readJson<Record<string, unknown>>(contractPath, {});
    const units = Array.isArray(contractJson.learningUnits)
      ? contractJson.learningUnits as Array<Record<string, unknown>>
      : Array.isArray(contractJson.units)
        ? contractJson.units as Array<Record<string, unknown>>
        : [];
    let contractChanged = false;
    for (const unit of units) {
      const values = Array.isArray(unit.sourceAnchors) ? unit.sourceAnchors.map(String) : [];
      if (values.length === 0) continue;
      const sanitized = sanitizeAnchorArrayForField(values);
      if (sanitized.rejectedLabels.length === 0) continue;
      unit.sourceAnchors = sanitized.acceptedAnchorIds;
      const caveats = Array.isArray(unit.sourceCaveats) ? unit.sourceCaveats.map(String) : [];
      for (const label of sanitized.rejectedLabels) {
        if (label.suggestedField === "sourceCaveats" && !caveats.includes(label.value)) caveats.push(label.value);
        result.requests.push({
          targetKind: "learning_unit_contract",
          invalidValue: label.value,
          unitId: String(unit.id ?? ""),
          reason: label.reason === "invalid_format" || label.reason === "unresolved" ? "not_anchor_id" : label.reason,
          repairAction: repairActionForInvalidLabel(label),
        });
        noteMove(label.value, `contract ${String(unit.id ?? "(unknown)")}`, label);
      }
      if (caveats.length > 0) unit.sourceCaveats = caveats;
      contractChanged = true;
    }
    if (contractChanged) {
      fs.writeFileSync(contractPath, `${JSON.stringify(contractJson, null, 2)}\n`, "utf-8");
      markChanged(path.relative(gardenDir, contractPath).split(path.sep).join("/"));
    }
  }

  const anchorLedgerPath = path.join(bd, "source-anchors.json");
  if (fs.existsSync(anchorLedgerPath)) {
    const ledger = readJson<Record<string, unknown>>(anchorLedgerPath, {});
    let ledgerChanged = false;
    for (const key of ["sourceTextConceptAnchors", "sourceStructuralAnchors"]) {
      const records = Array.isArray(ledger[key]) ? ledger[key] as Array<Record<string, unknown>> : [];
      const kept = records.filter((record) => isPlausibleSourceAnchorId(String(record.id ?? "")));
      if (kept.length !== records.length) {
        ledger[key] = kept;
        ledgerChanged = true;
        for (const record of records) {
          const id = String(record.id ?? "").trim();
          if (id && !isPlausibleSourceAnchorId(id)) {
            const label = classifyRejectedSourceAnchorLabel(id);
            noteMove(id, `source-anchor registry ${key}`, label);
          }
        }
      }
    }
    if (ledgerChanged) {
      fs.writeFileSync(anchorLedgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf-8");
      markChanged(".breadboard/source-anchors.json");
    }
  }

  const visualsDir = path.join(bd, "visuals");
  if (fs.existsSync(visualsDir)) {
    for (const name of fs.readdirSync(visualsDir)) {
      if (!name.endsWith(".json")) continue;
      const abs = path.join(visualsDir, name);
      const text = readText(abs);
      if (text === undefined) continue;
      let spec: Record<string, unknown>;
      try { spec = JSON.parse(text); } catch { continue; }
      if (!Array.isArray(spec.sourceAnchors)) continue;
      let visualChanged = false;
      const planningNotes = Array.isArray(spec.planningNotes) ? spec.planningNotes.map(String) : [];
      const cleaned = (spec.sourceAnchors as unknown[]).flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const record = { ...(item as Record<string, unknown>) };
        let hadInvalid = false;
        for (const key of ["figureId", "tableId", "equationId", "questionId", "textAnchorId"]) {
          const value = typeof record[key] === "string" ? String(record[key]).trim() : "";
          if (!value || isPlausibleSourceAnchorId(value)) continue;
          const label = classifyRejectedSourceAnchorLabel(value);
          delete record[key];
          hadInvalid = true;
          visualChanged = true;
          planningNotes.push(`${value}: ${label.reason}`);
          noteMove(value, `.breadboard/visuals/${name} ${key}`, label);
        }
        const hasGroundingId = ["figureId", "tableId", "equationId", "questionId", "textAnchorId"].some((key) => typeof record[key] === "string" && String(record[key]).trim());
        return hasGroundingId || !hadInvalid ? [record] : [];
      });
      if (cleaned.length !== spec.sourceAnchors.length) visualChanged = true;
      if (!visualChanged) continue;
      spec.sourceAnchors = cleaned;
      if (planningNotes.length > 0) spec.planningNotes = [...new Set(planningNotes)];
      fs.writeFileSync(abs, `${JSON.stringify(spec, null, 2)}\n`, "utf-8");
      markChanged(`.breadboard/visuals/${name}`);
    }
  }

  return result;
}

interface FullFormulaEntry {
  kind: string;
  text: string;
  normalizedText?: string;
  groundingStatus?: string;
  justification?: string;
  sourceAnchor?: string;
  sourceAnchorTitle?: string;
  basedOnFormula?: string;
  matchReason?: string;
  confidence?: string;
}

function parseFullFormulaEntries(rawFm: string): FullFormulaEntry[] {
  const entries: FullFormulaEntry[] = [];
  let inFormulas = false;
  let current: FullFormulaEntry | null = null;
  for (const line of rawFm.split(/\r?\n/)) {
    if (!inFormulas) {
      if (/^formulas:\s*(.*)$/.test(line)) inFormulas = true;
      continue;
    }
    if (/^\S[^:]*:\s*/.test(line)) break;
    const first = line.match(/^\s*-\s*([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (first) {
      current = { kind: "", text: "" };
      (current as unknown as Record<string, string>)[first[1]] = unquote(first[2] ?? "");
      entries.push(current);
      continue;
    }
    const nested = line.match(/^\s{4,}([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (nested && current) (current as unknown as Record<string, string>)[nested[1]] = unquote(nested[2] ?? "");
  }
  return entries;
}

function serializeFormulas(entries: FullFormulaEntry[]): string {
  const lines = ["formulas:"];
  for (const e of entries) {
    lines.push(`  - kind: ${jsonScalar(e.kind || "conceptual_helper")}`);
    lines.push(`    text: ${jsonScalar(e.text)}`);
    if (e.normalizedText) lines.push(`    normalizedText: ${jsonScalar(e.normalizedText)}`);
    if (e.groundingStatus) lines.push(`    groundingStatus: ${jsonScalar(e.groundingStatus)}`);
    if (e.justification) lines.push(`    justification: ${jsonScalar(e.justification)}`);
    if (e.sourceAnchor) lines.push(`    sourceAnchor: ${jsonScalar(e.sourceAnchor)}`);
    if (e.sourceAnchorTitle) lines.push(`    sourceAnchorTitle: ${jsonScalar(e.sourceAnchorTitle)}`);
    if (e.basedOnFormula) lines.push(`    basedOnFormula: ${jsonScalar(e.basedOnFormula)}`);
    if (e.matchReason) lines.push(`    matchReason: ${jsonScalar(e.matchReason)}`);
    if (e.confidence) lines.push(`    confidence: ${e.confidence}`);
  }
  return lines.join("\n");
}

function replaceFormulasBlock(rawFm: string, entries: FullFormulaEntry[]): string {
  const lines = rawFm.split(/\r?\n/);
  const start = lines.findIndex((line) => /^formulas:\s*/.test(line));
  if (start < 0) return rawFm;
  let end = start + 1;
  while (end < lines.length && /^\s+/.test(lines[end])) end += 1;
  const block = serializeFormulas(entries);
  return [...lines.slice(0, start), ...block.split("\n"), ...lines.slice(end)].join("\n");
}

/** Reclassify worked examples that were mislabeled as source definitions. */
/**
 * Whether a worked-example formula mislabeled as a definition can be safely
 * relabeled without orphaning a needed anchor: only when the page keeps a real
 * symbolic definition for that anchor, or the anchor is not required by the
 * unit contract. The sole numeric grounding of a contract-required anchor is
 * left alone — we cannot synthesize the missing symbolic definition, and
 * stripping it would break contract fulfillment.
 */
function workedExampleIsSafelyRelabelable(anchor: string | undefined, symbolicDefAnchors: Set<string>, requiredAnchors: Set<string>): boolean {
  if (anchor && symbolicDefAnchors.has(anchor)) return true;
  return !(anchor && requiredAnchors.has(anchor));
}

function relabelWorkedExamples(rawFm: string, requiredAnchors: Set<string> = new Set()): { rawFm: string; changed: boolean } {
  const entries = parseFullFormulaEntries(rawFm);
  if (entries.length === 0) return { rawFm, changed: false };
  const symbolicDefAnchors = new Set(
    entries
      .filter((e) => (e.kind === "source_definition" || e.kind === "source_derived_definition")
        && formulaStructuralKind(e.text) === "definition" && e.sourceAnchor)
      .map((e) => String(e.sourceAnchor)),
  );
  const definitionAnchor = [...symbolicDefAnchors][0];
  let changed = false;
  for (const entry of entries) {
    if ((entry.kind === "source_definition" || entry.kind === "source_derived_definition")
      && formulaStructuralKind(entry.text) === "worked_example") {
      if (!workedExampleIsSafelyRelabelable(entry.sourceAnchor, symbolicDefAnchors, requiredAnchors)) continue;
      const anchor = entry.sourceAnchor ?? definitionAnchor;
      entry.kind = "worked_example";
      // Worked examples are conceptual helpers, never source definitions; they
      // may reference the source formula via basedOnFormula but cannot satisfy
      // a source anchor. `conceptual-helper` is the only valid grounding status.
      entry.groundingStatus = "conceptual-helper";
      entry.basedOnFormula = anchor;
      entry.justification = anchor
        ? `Worked example applying source formula ${anchor}; a specific numeric instance, not the symbolic source definition.`
        : "Worked example: a specific numeric instance, not a symbolic source definition.";
      delete entry.sourceAnchor;
      delete entry.sourceAnchorTitle;
      entry.matchReason = "numeric instance of the source formula";
      changed = true;
    }
  }
  if (!changed) return { rawFm, changed: false };
  return { rawFm: replaceFormulasBlock(rawFm, entries), changed: true };
}

export interface TargetedCriticRepairResult {
  changed: string[];
  notes: string[];
  resolved: boolean;
}

export interface CriticFormulaKindRepairInput {
  pagePath?: string;
  formulaIndex?: number;
  sourceAnchorIds?: string[];
  evidence?: string;
  problem?: string;
}

function sourceDefinitionForFormulaAnchor(anchorId: string, anchor?: CanonicalSourceAnchor): { text: string; reason: string } | null {
  const text = [anchorId, anchor?.title, anchor?.caption, anchor?.semanticSummary, anchor?.formulaFamily].filter(Boolean).join(" ").toLowerCase();
  const byId = (suffix: string) => new RegExp(`\\.${suffix}$`, "i").test(anchorId);
  const family = anchor?.formulaFamily || formulaMetricFamily(text) || "";
  if (byId("E1")) {
    return {
      text: "\\text{Accuracy} = \\frac{N_{\\text{correct}}}{N_{\\text{total}}}",
      reason: "symbolic accuracy definition: correct predictions over total predictions",
    };
  }
  if (byId("E2")) {
    return {
      text: "T_{\\text{latency}} = t_{\\text{decision}} - t_{\\text{stimulus}}",
      reason: "symbolic latency definition: decision time minus stimulus time",
    };
  }
  if (byId("E3")) {
    return {
      text: "N_{\\text{spikes}} = \\sum_{n,t} s_n(t)",
      reason: "symbolic spike-count definition: spikes summed across neurons and time",
    };
  }
  if (byId("E4")) {
    return {
      text: "E_{\\text{energy}} = N_{\\text{spikes}}E_{\\text{spike}} + N_{\\text{synops}}E_{\\text{synop}}",
      reason: "symbolic energy definition: spike and synaptic operation costs",
    };
  }
  if (byId("E5")) {
    return {
      text: "\\eta_{\\text{efficiency}} = \\frac{\\text{Accuracy}}{E_{\\text{energy}}}",
      reason: "symbolic normalized-efficiency definition: accuracy divided by energy",
    };
  }
  if (byId("E6")) {
    return {
      text: "T_{\\text{convergence}} = \\min\\{e : A(e) \\geq A_{\\text{target}}\\}",
      reason: "symbolic convergence definition: first epoch reaching target accuracy",
    };
  }
  if (family === "accuracy" || /\baccuracy|correct prediction|classification/.test(text)) {
    return {
      text: "\\text{Accuracy} = \\frac{N_{\\text{correct}}}{N_{\\text{total}}}",
      reason: "symbolic accuracy definition: correct predictions over total predictions",
    };
  }
  if (family === "latency" || /\blatency|decision time|response time/.test(text)) {
    return {
      text: "T_{\\text{latency}} = t_{\\text{decision}} - t_{\\text{stimulus}}",
      reason: "symbolic latency definition: decision time minus stimulus time",
    };
  }
  if (family === "spike-count" || /\bspike count|total spike|number of spikes/.test(text)) {
    return {
      text: "N_{\\text{spikes}} = \\sum_{n,t} s_n(t)",
      reason: "symbolic spike-count definition: spikes summed across neurons and time",
    };
  }
  if (family === "efficiency" || /\befficien|\bnormalized energy|accuracy per energy/.test(text)) {
    return {
      text: "\\eta_{\\text{efficiency}} = \\frac{\\text{Accuracy}}{E_{\\text{energy}}}",
      reason: "symbolic normalized-efficiency definition: accuracy divided by energy",
    };
  }
  if (family === "energy" || /\benergy|synaptic operation|synop|joule/.test(text)) {
    return {
      text: "E_{\\text{energy}} = N_{\\text{spikes}}E_{\\text{spike}} + N_{\\text{synops}}E_{\\text{synop}}",
      reason: "symbolic energy definition: spike and synaptic operation costs",
    };
  }
  if (family === "convergence" || /\bconvergence|epoch|target accuracy|learning curve/.test(text)) {
    return {
      text: "T_{\\text{convergence}} = \\min\\{e : A(e) \\geq A_{\\text{target}}\\}",
      reason: "symbolic convergence definition: first epoch reaching target accuracy",
    };
  }
  return null;
}

function sourceDefinitionExists(entries: FullFormulaEntry[], anchorId: string): boolean {
  return entries.some((entry) =>
    (entry.kind === "source_definition" || entry.kind === "source_derived_definition")
    && entry.sourceAnchor === anchorId
    && formulaStructuralKind(entry.text) === "definition",
  );
}

function normalizedPageCandidates(gardenDir: string, pagePath?: string): Array<{ abs: string; rel: string }> {
  const rel = String(pagePath ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (rel && rel.startsWith("learning/") && rel.endsWith(".md")) {
    return [{ rel, abs: path.join(gardenDir, ...rel.split("/")) }].filter((p) => fs.existsSync(p.abs));
  }
  const pages: Array<{ abs: string; rel: string }> = [];
  walkMarkdown(path.join(gardenDir, "learning"), "learning", pages);
  return pages.filter((p) => !/(^|\/)_index\.md$/i.test(p.rel));
}

/** Targeted critic repair: a concrete numeric substitution must be metadata
 * `worked_example`, while the source anchor remains satisfied by a symbolic
 * `source_definition` entry. This is deliberately metadata-only and
 * idempotent; if the source formula family is unknown, it leaves the blocker
 * for the critic instead of guessing. */
export function repairCriticWorkedExampleMisclassification(
  gardenDir: string,
  slug: string | undefined,
  input: CriticFormulaKindRepairInput,
): TargetedCriticRepairResult {
  const result: TargetedCriticRepairResult = { changed: [], notes: [], resolved: false };
  const state = buildFinalGardenState(gardenDir, slug);
  const anchorIds = new Set((input.sourceAnchorIds ?? []).filter((id) => /\.E\d+$/i.test(id)));
  const candidates = normalizedPageCandidates(gardenDir, input.pagePath);

  for (const page of candidates) {
    const content = readText(page.abs);
    if (content === undefined) continue;
    const { rawFrontmatter, body } = splitFrontmatter(content);
    const entries = parseFullFormulaEntries(rawFrontmatter);
    if (entries.length === 0) continue;

    const targetIndexes = entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry, index }) => {
        if (typeof input.formulaIndex === "number" && index !== input.formulaIndex) return false;
        const sourceAnchor = entry.sourceAnchor ? String(entry.sourceAnchor) : undefined;
        const anchorMatches = anchorIds.size === 0 || (sourceAnchor && anchorIds.has(sourceAnchor));
        return anchorMatches
          && (entry.kind === "source_definition" || entry.kind === "source_derived_definition")
          && formulaStructuralKind(entry.text) === "worked_example";
      });
    if (targetIndexes.length === 0) continue;

    const targetAnchors = new Set<string>();
    for (const { entry } of targetIndexes) {
      const anchor = entry.sourceAnchor || [...anchorIds][0];
      if (anchor) targetAnchors.add(anchor);
    }

    let changed = false;
    const insertAt = Math.max(0, Math.min(...targetIndexes.map((t) => t.index)));
    const insertions: FullFormulaEntry[] = [];
    for (const anchorId of targetAnchors) {
      if (sourceDefinitionExists(entries, anchorId)) continue;
      const def = sourceDefinitionForFormulaAnchor(anchorId, state.sourceAnchors[anchorId]);
      if (!def) {
        result.notes.push(`could not synthesize a symbolic source definition for ${anchorId}`);
        continue;
      }
      insertions.push({
        kind: "source_definition",
        text: def.text,
        normalizedText: def.text,
        groundingStatus: "source-anchored",
        sourceAnchor: anchorId,
        sourceAnchorTitle: state.sourceAnchors[anchorId]?.title ?? anchorId,
        matchReason: def.reason,
        justification: `Inserted during critic repair so ${anchorId} is satisfied by a symbolic source definition, not a numeric worked example.`,
      });
      changed = true;
    }
    if (insertions.length > 0) entries.splice(insertAt, 0, ...insertions);

    for (const { entry } of targetIndexes) {
      const anchor = entry.sourceAnchor || [...targetAnchors][0];
      entry.kind = "worked_example";
      entry.groundingStatus = "conceptual-helper";
      entry.basedOnFormula = anchor;
      entry.justification = anchor
        ? `Worked example applying source formula ${anchor}; a concrete numeric substitution, not the symbolic source definition.`
        : "Worked example: a concrete numeric substitution, not a symbolic source definition.";
      entry.matchReason = "numeric instance of the source formula";
      delete entry.sourceAnchor;
      delete entry.sourceAnchorTitle;
      delete entry.confidence;
      changed = true;
    }

    if (!changed) continue;
    let nextFm = replaceFormulasBlock(rawFrontmatter, entries);
    const existingFormulaAnchors = fmArray(nextFm, "sourceFormulaAnchors");
    const groundedAnchors = entries
      .filter((entry) => (entry.kind === "source_definition" || entry.kind === "source_derived_definition") && entry.sourceAnchor)
      .map((entry) => String(entry.sourceAnchor));
    nextFm = setFmArrayLine(nextFm, "sourceFormulaAnchors", [...existingFormulaAnchors, ...groundedAnchors]);
    fs.writeFileSync(page.abs, `---\n${nextFm.replace(/\s+$/, "")}\n---\n\n${body.replace(/^\n+/, "")}`, "utf-8");
    result.changed.push(page.rel);
    result.notes.push(`reclassified numeric source-definition formula(s) as worked examples on ${page.rel}`);
    result.resolved = true;
  }

  return result;
}

function sameStringArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Ground an orphan symbolic definition to a contract-required formula anchor the
 * page declares but hasn't grounded. Fixes the common generation gap where a
 * page writes the symbolic form (e.g. `NEE = A/E`) as a conceptual helper and
 * lists the anchor in sourceAnchors, but never grounds the two together — which
 * fails contract fulfillment even though the definition is right there.
 */
function groundOrphanRequiredFormulas(
  rawFm: string,
  requiredFormulaIds: Set<string>,
  pageDeclaredAnchors: Set<string>,
  ledgerFamilies: Map<string, string>,
): { rawFm: string; grounded: string[] } {
  if (requiredFormulaIds.size === 0) return { rawFm, grounded: [] };
  const entries = parseFullFormulaEntries(rawFm);
  const groundedAnchors = new Set(
    entries
      .filter((e) => (e.kind === "source_definition" || e.kind === "source_derived_definition") && e.sourceAnchor)
      .map((e) => String(e.sourceAnchor)),
  );
  const ungrounded = [...requiredFormulaIds].filter((id) => pageDeclaredAnchors.has(id) && !groundedAnchors.has(id));
  if (ungrounded.length === 0) return { rawFm, grounded: [] };
  const orphanDefs = entries.filter(
    (e) => formulaStructuralKind(e.text) === "definition"
      && !e.sourceAnchor
      && e.kind !== "source_definition"
      && e.kind !== "source_derived_definition",
  );
  if (orphanDefs.length === 0) return { rawFm, grounded: [] };

  const grounded: string[] = [];
  const usedDefs = new Set<RawFormulaEntry>();
  const remainingAnchors: string[] = [];
  // Pass 1: match by metric family.
  for (const anchor of ungrounded) {
    const family = ledgerFamilies.get(anchor);
    const def = family
      ? orphanDefs.find((d) => !usedDefs.has(d) && formulaMetricFamily(d.text) === family)
      : undefined;
    if (def) {
      groundOne(def, anchor);
      usedDefs.add(def);
      grounded.push(anchor);
    } else {
      remainingAnchors.push(anchor);
    }
  }
  // Pass 2: unambiguous 1:1 fallback (one need, one orphan definition left).
  const freeDefs = orphanDefs.filter((d) => !usedDefs.has(d));
  if (remainingAnchors.length === 1 && freeDefs.length === 1) {
    groundOne(freeDefs[0], remainingAnchors[0]);
    grounded.push(remainingAnchors[0]);
  }
  if (grounded.length === 0) return { rawFm, grounded: [] };
  return { rawFm: replaceFormulasBlock(rawFm, entries), grounded };

  function groundOne(entry: RawFormulaEntry, anchor: string): void {
    (entry as FullFormulaEntry).kind = "source_definition";
    (entry as FullFormulaEntry).sourceAnchor = anchor;
    (entry as FullFormulaEntry).groundingStatus = "source-anchored";
    (entry as FullFormulaEntry).justification = `Symbolic source definition for ${anchor}; grounded to the contract-required formula the page declares.`;
    (entry as FullFormulaEntry).matchReason = "symbolic definition grounded to contract-required anchor";
  }
}

/**
 * Reground a definition formula whose own math contradicts the metric family of
 * the anchor it claims (synchronized wrongness — Fix 3). If a correct-family
 * source formula anchor exists, point at it; otherwise demote the formula to a
 * conceptual helper rather than keep a semantically false grounding.
 */
function regroundMismatchedFormulas(
  rawFm: string,
  ledgerFamilies: Map<string, string>,
  familyToAnchorId: Map<string, string>,
): { rawFm: string; changed: boolean } {
  const entries = parseFullFormulaEntries(rawFm);
  let changed = false;
  for (const entry of entries) {
    if (entry.kind !== "source_definition" && entry.kind !== "source_derived_definition") continue;
    if (!entry.sourceAnchor) continue;
    const anchorFamily = ledgerFamilies.get(entry.sourceAnchor);
    const formulaFamily = formulaMetricFamily(entry.text);
    if (!anchorFamily || !formulaFamily || metricFamiliesCompatible(formulaFamily, anchorFamily)) continue;
    const correct = familyToAnchorId.get(formulaFamily);
    if (correct && correct !== entry.sourceAnchor) {
      entry.sourceAnchor = correct;
      entry.groundingStatus = "source-anchored";
      entry.matchReason = `regrounded to the ${formulaFamily} source formula`;
      delete entry.sourceAnchorTitle;
    } else {
      entry.kind = "conceptual_helper";
      entry.groundingStatus = "conceptual-helper";
      entry.matchReason = "no compatible source formula anchor";
      delete entry.sourceAnchor;
      delete entry.sourceAnchorTitle;
    }
    changed = true;
  }
  if (!changed) return { rawFm, changed: false };
  return { rawFm: replaceFormulasBlock(rawFm, entries), changed: true };
}

/** Anchor id → metric family, from the visual ledger's formula captions. */
function ledgerFormulaFamilies(gardenDir: string): Map<string, string> {
  const ledger = readJson<Array<Record<string, unknown>>>(path.join(gardenDir, ".breadboard", "source-visuals.json"), []);
  const map = new Map<string, string>();
  for (const v of ledger) {
    const id = String(v.sourceVisualId ?? "");
    if (!/\.E\d+$/i.test(id)) continue;
    const family = formulaMetricFamily(String(v.caption ?? ""));
    if (family) map.set(id, family);
  }
  return map;
}

function sourceDefinitionFormulaAnchors(rawFm: string): string[] {
  // Anchors that still carry a definition-labeled formula entry after relabeling.
  // Uses the declared kind (not the structural shape) so a contract-required
  // anchor whose sole grounding is numeric — deliberately left as a definition —
  // remains in sourceFormulaAnchors and keeps contract fulfillment satisfied.
  return [...new Set(
    parseFullFormulaEntries(rawFm)
      .filter((entry) =>
        (entry.kind === "source_definition" || entry.kind === "source_derived_definition")
          && Boolean(entry.sourceAnchor),
      )
      .map((entry) => String(entry.sourceAnchor)),
  )];
}

// Concept-grounded replacement claims for planner-scaffold handles. Suffixes are
// concrete, non-template, and read as durable note claims (Fix 7).
const ROLE_CLAIM_SUFFIXES: Record<string, string[]> = {
  formula: ["counts-what-can-be-checked", "moves-only-with-its-inputs", "compresses-behavior-into-one-number"],
  metric: ["counts-what-can-be-checked", "moves-only-with-its-inputs", "compresses-behavior-into-one-number"],
  result_interpretation: ["only-matters-beside-its-cost", "reflects-the-values-actually-reported", "separates-winners-from-cheaper-alternatives"],
  comparison: ["only-matters-beside-its-cost", "reflects-the-values-actually-reported", "separates-winners-from-cheaper-alternatives"],
  application: ["must-fit-an-energy-budget", "rewards-sparse-event-processing", "drives-hardware-selection"],
  limitation: ["bounds-what-results-can-claim", "depends-on-source-conditions", "marks-where-evidence-stops"],
  motivation: ["explains-why-events-beat-dense-updates", "sets-the-problem-to-solve", "motivates-the-next-concept"],
  core_concept: ["stays-testable-through-observable-details", "separates-events-from-continuous-values", "builds-on-the-prior-concept"],
  mechanism: ["turns-input-into-a-discrete-event", "makes-state-changes-observable", "builds-on-the-prior-concept"],
  training_method: ["changes-weights-through-a-specific-rule", "trades-accuracy-against-training-cost", "builds-on-the-prior-concept"],
  synthesis: ["combines-earlier-lessons-into-one-choice", "ties-metrics-to-a-decision", "closes-the-learning-path"],
};

function conceptSlug(value: string): string {
  const words = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean)
    .slice(0, 3);
  return words.join("-");
}

/** Produce a concrete replacement handle for a blacklisted one. */
function naturalizeHandle(handle: string, unit: LearningUnitContract, taken: Set<string>): string {
  // Concept = handle with the template phrase stripped, else the unit's concept.
  let concept = handle;
  for (const phrase of TEMPLATE_ZETTEL_PHRASES) concept = concept.replace(new RegExp(`-?${phrase}$`), "");
  concept = conceptSlug(concept) || conceptSlug(unit.newConcepts?.[0] ?? unit.title);
  const suffixes = ROLE_CLAIM_SUFFIXES[unit.role] ?? ROLE_CLAIM_SUFFIXES.core_concept;
  for (const suffix of suffixes) {
    const candidate = `${concept}-${suffix}`.split("-").slice(0, 9).join("-");
    if (!taken.has(candidate) && isNaturalZettelHandle(candidate)) return candidate;
  }
  // Last-resort uniqueness.
  let i = 2;
  while (taken.has(`${concept}-${ROLE_CLAIM_SUFFIXES.core_concept[0]}-${i}`)) i += 1;
  return `${concept}-observable-claim-${i}`;
}

/** True when a unit still carries any planner-scaffold handle. */
function unitNeedsNaturalization(unit: LearningUnitContract): boolean {
  return (unit.zettelNotes ?? []).some((note) => !isNaturalZettelHandle(note.handle));
}

/** Which files a repair entry is allowed to have touched, given its target. */
function allowedChangedFilesForRepair(
  entry: RepairLogEntry,
  pageByRel: Map<string, FinalGardenPage>,
): (file: string) => boolean {
  const target = entry.targetKind ?? "unit_page";
  const pagePath = entry.pagePath ?? "";
  const sectionPath = entry.sectionPath ?? "";
  const failureTypes = new Set(entry.failureTypes);
  return (file: string): boolean => {
    switch (target) {
      case "section_index":
        return file === `${sectionPath}/_index.md` || file === (entry.affectedSectionId ? `${entry.affectedSectionId}/_index.md` : "");
      case "contract":
        return file === ".breadboard/learning-unit-contract.json";
      case "source_coverage":
        return file === ".breadboard/planning/Source Coverage.md" || file === ".breadboard/source-anchors.json";
      case "planning_doc":
        return file.startsWith(".breadboard/planning/") || file === "learning/Learning Map.md";
      case "visual_spec":
        return file.startsWith(".breadboard/visuals/");
      case "global_finalization":
        return true;
      case "unit_page":
      default: {
        if (file === pagePath) return true;
        // A unit-page repair may touch that page's own visual specs.
        if (file.startsWith(".breadboard/visuals/")) {
          const page = pageByRel.get(pagePath);
          if (!page) return false;
          const id = file.match(/^\.breadboard\/visuals\/(.+)\.json$/)?.[1] ?? "";
          return page.visualIds.includes(id) || embeddedVisualSpecs(page.body).some((s) => String(s.id ?? "") === id);
        }
        // Legacy allowance only when the failure is explicitly section-scoped.
        if (failureTypes.has("section_semantics") && file === `${sectionPath}/_index.md`) return true;
        return false;
      }
    }
  };
}

// ---------------------------------------------------------------------------
// The reconcile orchestrator
// ---------------------------------------------------------------------------

const PAGE_PROSE_REPAIR_TYPES = new Set(["repeated_opening", "scaffold_prose", "zettelkasten_handle_support"]);

const LEARNER_SCAFFOLD_PROSE_PATTERNS: RegExp[] = [
  /\bThe motivation is already in place\b/i,
  /\bFocus on the specific mechanism\b/i,
  /\bthis lesson adds to the learning path\b/i,
  /\bthe previous concepts\b/i,
  /\bthe specific mechanism,\s*metric,\s*result,\s*or limitation\b/i,
  /\bthis page develops how\b/i,
  /\bBuild up\b[^.\n]{0,120}\bone step at a time\b/i,
];

function pageSectionPathFromRel(rel: string): string {
  return rel.split("/").slice(0, 2).join("/");
}

function resolveRepairPage(entry: RepairLogEntry, pages: FinalGardenPage[]): FinalGardenPage | undefined {
  const byRel = pages.find((page) => page.rel === entry.pagePath);
  if (byRel) return byRel;
  if (entry.unitId) {
    const byUnit = pages.filter((page) => page.learningUnitId === entry.unitId);
    if (byUnit.length === 1) return byUnit[0];
  }
  if (entry.pagePath) {
    const requestedName = path.posix.basename(entry.pagePath);
    const byName = pages.filter((page) => path.posix.basename(page.rel) === requestedName);
    if (byName.length === 1) return byName[0];
  }
  return undefined;
}

function pageProseValidation(page: FinalGardenPage): "pass" | "fail" {
  const prose = teachingProseOnly(page.body);
  if (LEARNER_SCAFFOLD_PROSE_PATTERNS.some((pattern) => pattern.test(prose))) return "fail";
  if (/\bsnns\b/.test(prose)) return "fail";
  if (/\bSNNs\s+learns\b/i.test(prose)) return "fail";
  return "pass";
}

function transformOutsideFences(body: string, transform: (chunk: string) => string): string {
  const parts = body.split(/(```[\s\S]*?```)/g);
  return parts.map((part, index) => index % 2 === 1 ? part : transform(part)).join("");
}

function sanitizeLearnerSourceCommentary(body: string): string {
  return transformOutsideFences(body, (chunk) => chunk
    .replace(/\bthe source conditions\b/gi, "the experimental conditions")
    .replace(/\baccording to the source\b/gi, "in the reported setup")
    .replace(/\bthe uploaded source\b/gi, "the supplied material")
    .replace(/\bthe source material\b/gi, "the learning material")
    .replace(/\bsource-derived\b/gi, "derived")
    .replace(/\bsource-central\b/gi, "central")
    .replace(/\bthis paper\b/gi, "this study")
    .replace(/\bthe paper\b/gi, "the study")
    .replace(/\bthe source\b/gi, "the study"));
}

function sourceImageBlockInfo(block: string): { isSourceImage: boolean; isTable: boolean } {
  const withoutCaptions = block.replace(/^\s*\*[^*\n]*\*\s*$/gm, "").trim();
  const onlyImages = withoutCaptions.length > 0 &&
    withoutCaptions.split(/\n/).every((line) => /^!\[[^\]]*\]\([^)]*\)\s*$/.test(line.trim()) || line.trim() === "");
  if (!onlyImages || !/source-visuals/i.test(block)) return { isSourceImage: false, isTable: false };
  return { isSourceImage: true, isTable: /\btable\b/i.test(block) || /source-visuals\/[^)\s]*-table-t\d+/i.test(block) };
}

function capVisibleSourceFigureBlocks(body: string, maxFigures = 3): string {
  const blocks = body.split(/\n{2,}/);
  const infos = blocks.map(sourceImageBlockInfo);
  const sourceFigureIndexes = infos
    .map((info, index) => info.isSourceImage && !info.isTable ? index : -1)
    .filter((index) => index >= 0);
  if (sourceFigureIndexes.length <= maxFigures) return body;
  const keep = new Set(sourceFigureIndexes.slice(0, maxFigures));
  return blocks
    .filter((_block, index) => !sourceFigureIndexes.includes(index) || keep.has(index))
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n");
}

function normalizePageRel(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) return "";
  return normalized.endsWith(".md") ? normalized : `${normalized}.md`;
}

function normalizeCaptionText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function ensureAssignedSourceVisualEmbeds(body: string, visuals: Array<Record<string, unknown>>): string {
  if (visuals.length === 0) return body;
  const blocks = body.split(/\n{2,}/);
  let changed = false;

  for (const visual of visuals) {
    const url = String(visual.croppedImagePath ?? "").trim();
    if (!url || blocks.some((block) => block.includes(url))) continue;
    const id = String(visual.sourceVisualId ?? "").trim();
    const caption = String(visual.caption ?? id).trim();
    const imageBlock = `![${caption || id || "Source visual"}](${url})`;
    const captionNeedle = normalizeCaptionText(caption);
    const captionIndex = captionNeedle
      ? blocks.findIndex((block) => {
          const trimmed = block.trim();
          return /^\*[\s\S]*\*$/.test(trimmed) && normalizeCaptionText(trimmed).includes(captionNeedle);
        })
      : -1;

    if (captionIndex >= 0) {
      blocks.splice(captionIndex, 0, imageBlock);
      changed = true;
      continue;
    }

    const fallbackCaption = caption
      ? `*${caption}*${Number.isFinite(Number(visual.pageNumber)) ? ` *(p. ${Number(visual.pageNumber)})*` : ""}`
      : "";
    const visualBlockIndex = blocks.findIndex((block) => /^```breadboard-visual\b/.test(block.trim()));
    const insertAt = visualBlockIndex >= 0 ? visualBlockIndex : blocks.length;
    blocks.splice(insertAt, 0, ...[imageBlock, fallbackCaption].filter(Boolean));
    changed = true;
  }

  return changed ? blocks.join("\n\n").replace(/\n{3,}/g, "\n\n") : body;
}

function classifyRepairTargetKind(entry: RepairLogEntry): RepairTargetKind {
  // A repair whose actual changed file is a learner page is a unit_page repair,
  // even if it also carried section-scoped failure labels — those section-level
  // changes are split into their own section_index provenance entries.
  if (entry.pagePath) return "unit_page";
  if (entry.changedFiles.every((f) => /\/_index\.md$/.test(f)) && entry.changedFiles.length > 0) return "section_index";
  if (entry.sectionPath) return "section_index";
  return "unit_page";
}

// ---------------------------------------------------------------------------
// Missing source-anchor registration and repair (Fixes 1–4)
//
// The final audit forbids any anchor that is referenced but not registered in
// the canonical registry. Generation/repair can mint semantic anchor ids such
// as "S1.P1.energy-bottleneck" that were never proven against the source. This
// pass resolves each such id BEFORE acceptance: register it from real source
// text, replace it with an equivalent existing anchor, or leave it blocking so
// the garden stays a draft.
// ---------------------------------------------------------------------------

const SEMANTIC_ANCHOR_STOPWORDS = new Set([
  "the", "and", "for", "from", "with", "that", "this", "into", "are", "was", "how", "why",
  "snn", "snns", "spiking", "neural", "network", "networks", "source", "page", "concept",
]);

/** True for a broad "S<sec>.P<page>.<slug>" reference that is neither a
 *  figure/formula/table code nor a `text-` ledger id. */
function isSemanticAnchorId(id: string): boolean {
  if (!id || id.startsWith("text-") || id.startsWith("trivial:")) return false;
  if (/\.(?:E|F|G|T)\d+$/i.test(id)) return false;
  return /^S\d+\.P\d+\..+$/i.test(id);
}

function semanticAnchorKeywords(id: string): string[] {
  const tail = id.replace(/^S\d+\.P\d+\./i, "");
  return [...new Set(
    tail.split(/[^a-z0-9]+/i).map((w) => w.toLowerCase()).filter((w) => w.length >= 3 && !SEMANTIC_ANCHOR_STOPWORDS.has(w)),
  )];
}

function semanticAnchorPage(id: string): number | undefined {
  const match = id.match(/\.P(\d+)\./i);
  return match ? Number(match[1]) : undefined;
}

function semanticAnchorKind(id: string): CanonicalSourceAnchorKind {
  const struct = structuralKindFromId(id);
  if (struct === "abstract" || struct === "intro" || struct === "guidance") return struct;
  const keywords = semanticAnchorKeywords(id).join(" ");
  if (/\babstract\b/.test(keywords)) return "abstract";
  if (/\bintro(duction)?\b/.test(keywords)) return "intro";
  return "text_concept";
}

interface SourceParagraph {
  sourceId: string;
  sourceTitle: string;
  page: number;
  text: string;
}

/** Source paragraphs carrying their sourceId and the `# Page N` they appear
 *  under, used to prove/register a semantic anchor from real source prose. */
function sourceParagraphsWithSource(gardenDir: string): SourceParagraph[] {
  const files: Array<{ abs: string; rel: string }> = [];
  walkMarkdown(path.join(gardenDir, "sources"), "sources", files);
  const out: SourceParagraph[] = [];
  for (const { abs, rel } of files) {
    if (/(^|\/)_index\.md$/i.test(rel)) continue;
    const text = readText(abs);
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
      if (header) { flush(); page = Number.parseInt(header[1] ?? "0", 10); continue; }
      if (/^#{1,6}\s/.test(line)) { flush(); continue; }
      if (line.trim() === "") { flush(); continue; }
      buffer.push(line.trim());
    }
    flush();
  }
  return out;
}

function titleFromKeywords(keywords: string[], para: SourceParagraph): string {
  const phrase = keywords.slice(0, 4).join(" ").trim();
  const title = phrase || para.sourceTitle || "Source concept";
  return title.charAt(0).toUpperCase() + title.slice(1);
}

// ---------------------------------------------------------------------------
// Evidence scoring (Fix 1/2): a passage must actually support the anchor, not
// merely share one keyword. Kind-specific gates require stronger proof.
// ---------------------------------------------------------------------------

/** Curated per-keyword synonyms — a keyword "hits" a passage when the keyword
 *  OR one of its close synonyms is present. Kept deliberately small so a match
 *  reflects the concept, not a distant family term. */
const KEYWORD_SYNONYMS: Record<string, string[]> = {
  energy: ["energy", "power", "consumption", "joule", "joules", "watt"],
  efficiency: ["efficiency", "efficient"],
  bottleneck: ["bottleneck"],
  brain: ["brain", "biological", "neuroscience", "cortex"],
  comparison: ["comparison", "compared", "versus", "unlike", "alternative", "contrast"],
  latency: ["latency", "delay"],
  accuracy: ["accuracy", "accurate", "correct"],
  spike: ["spike", "spikes", "spiking"],
  timing: ["timing", "temporal"],
  dependent: ["dependent"],
  plasticity: ["plasticity", "stdp"],
  surrogate: ["surrogate"],
  gradient: ["gradient", "backpropagation", "backprop"],
  neuromorphic: ["neuromorphic", "loihi"],
  hardware: ["hardware", "chip", "asic", "fpga"],
  conversion: ["conversion", "convert", "converted"],
  edge: ["edge", "embedded", "mobile"],
  deployment: ["deployment", "deploy", "inference"],
};

/** Concept families used only to detect wrong-family passages (negative
 *  evidence) and passage specificity — not to count keyword hits. */
const FAMILY_TERMS: Record<string, string[]> = {
  energy: ["energy", "power", "consumption", "efficiency", "joule", "watt", "bottleneck"],
  latency: ["latency", "delay", "timestep", "inference time", "decision time"],
  accuracy: ["accuracy", "classification", "error rate", "correct"],
  spike_count: ["spike count", "firing rate", "sparsity", "number of spikes"],
  training: ["surrogate", "gradient", "backpropagation", "stdp", "plasticity", "conversion", "learning rule"],
  hardware: ["neuromorphic", "hardware", "loihi", "chip", "edge", "deployment"],
  neuron: ["lif", "leaky", "integrate", "membrane", "threshold", "reset"],
};

const BOILERPLATE_RE = /international journal|issn|creative commons|\blicense\b|corresponding author|received:|accepted:|\bvolume\s*\d|\bdoi\b|©/i;
const RESULT_VOCAB_RE = /\btable\b|\bfigure\b|\bgraph\b|\bresults?\b|reported|shown in|\bcolumn\b|\brow\b|percentage|%|dataset/i;

function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function keywordHitTerms(keyword: string): string[] {
  return KEYWORD_SYNONYMS[keyword] ?? [keyword];
}
function tokenSetContainsKeyword(tokens: Set<string>, keyword: string): boolean {
  return keywordHitTerms(keyword).some((term) => tokens.has(term));
}
function titleTermsOf(title: string): string[] {
  return [...new Set(normalizeForMatch(title).split(" ").filter((w) => w.length >= 3 && !SEMANTIC_ANCHOR_STOPWORDS.has(w)))];
}
function familyHitCount(passageNorm: string, family: string): number {
  return (FAMILY_TERMS[family] ?? []).filter((term) => passageNorm.includes(normalizeForMatch(term))).length;
}
function dominantFamily(passageNorm: string): { family: string; hits: number } | null {
  let best: { family: string; hits: number } | null = null;
  for (const family of Object.keys(FAMILY_TERMS)) {
    const hits = familyHitCount(passageNorm, family);
    if (hits > 0 && (!best || hits > best.hits)) best = { family, hits };
  }
  return best;
}
function anchorFamilyOf(keywords: string[], titleTerms: string[]): string | null {
  const hay = normalizeForMatch([...keywords, ...titleTerms].join(" "));
  let best: { family: string; hits: number } | null = null;
  for (const family of Object.keys(FAMILY_TERMS)) {
    const hits = (FAMILY_TERMS[family] ?? []).filter((term) => hay.includes(normalizeForMatch(term))).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { family, hits };
  }
  return best?.family ?? null;
}
function namedMethodHit(anchorId: string, keywords: string[], passageNorm: string): boolean {
  const phrase = normalizeForMatch(anchorId.replace(/^S\d+\.P\d+\./i, ""));
  if (phrase.split(" ").length >= 2 && phrase.length >= 8 && passageNorm.includes(phrase)) return true;
  const acronym = keywords.map((k) => k[0]).join("");
  if (acronym.length >= 3 && new RegExp(`(^| )${acronym}( |$)`).test(passageNorm)) return true;
  return false;
}

const CONFIDENCE_RANK: Record<AnchorConfidence, number> = { unsupported: 0, low: 1, medium: 2, high: 3 };
function minConfidence(a: AnchorConfidence, b: AnchorConfidence): AnchorConfidence {
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b;
}

function kindGatePasses(kind: CanonicalSourceAnchorKind, m: {
  keywordHits: string[];
  keywordCoverageScore: number;
  titleOverlapScore: number;
  namedMethod: boolean;
  pageMatchScore: number;
  exactTextLen: number;
  resultVocab: boolean;
  formulaFamilyMatch: boolean;
}): boolean {
  if (kind === "formula") return m.formulaFamilyMatch;
  if (kind === "abstract" || kind === "intro") {
    return m.pageMatchScore >= 1 && m.exactTextLen >= 120 && (m.keywordCoverageScore > 0 || m.titleOverlapScore >= 0.5);
  }
  if (kind === "table" || kind === "graph" || kind === "figure") return m.resultVocab;
  // method/concept anchors (text_concept, guidance): the strong-proof gate.
  return m.keywordHits.length >= 2 || m.namedMethod || (m.titleOverlapScore >= 0.66 && m.keywordHits.length >= 1);
}

/** Score a candidate semantic anchor against the source paragraphs. Pure and
 *  deterministic so it can be unit-tested with crafted passages. */
export function scoreAnchorEvidence(input: {
  anchorId: string;
  title?: string;
  kind?: CanonicalSourceAnchorKind;
  conceptKeywords?: string[];
  sourceId?: string;
  requestedPage?: number;
  paragraphs: SourceParagraph[];
}): AnchorEvidenceScore {
  const keywords = input.conceptKeywords?.length ? input.conceptKeywords.map((k) => k.toLowerCase()) : semanticAnchorKeywords(input.anchorId);
  const kind = input.kind ?? semanticAnchorKind(input.anchorId);
  const requestedPage = input.requestedPage ?? semanticAnchorPage(input.anchorId);
  const title = input.title || (keywords.length ? keywords.slice(0, 4).join(" ") : input.anchorId);
  const titleTerms = titleTermsOf(title);

  const evaluate = (para: SourceParagraph) => {
    const norm = normalizeForMatch(para.text);
    const tokens = new Set(norm.split(" "));
    const keywordHits = keywords.filter((k) => tokenSetContainsKeyword(tokens, k));
    const missingKeywords = keywords.filter((k) => !tokenSetContainsKeyword(tokens, k));
    const keywordCoverageScore = keywords.length ? keywordHits.length / keywords.length : 0;
    const matchedTitle = titleTerms.filter((t) => tokenSetContainsKeyword(tokens, t));
    const titleOverlapScore = titleTerms.length ? matchedTitle.length / titleTerms.length : 0;
    const pageMatchScore = requestedPage == null ? 0.5
      : para.page === requestedPage ? 1
        : Math.abs(para.page - requestedPage) === 1 ? 0.5 : 0;
    const conceptTerms = [...new Set([...keywords, ...titleTerms])];
    const presentConcept = conceptTerms.filter((t) => tokenSetContainsKeyword(tokens, t));
    let contextSpecificityScore = conceptTerms.length ? presentConcept.length / conceptTerms.length : 0;
    if (presentConcept.length >= 3) contextSpecificityScore = Math.min(1, contextSpecificityScore + 0.1);
    if (BOILERPLATE_RE.test(para.text)) contextSpecificityScore *= 0.4;
    const namedMethod = namedMethodHit(input.anchorId, keywords, norm);

    let negativeEvidencePenalty = 0;
    const anchorFamily = anchorFamilyOf(keywords, titleTerms);
    if (anchorFamily) {
      const dom = dominantFamily(norm);
      const ownHits = familyHitCount(norm, anchorFamily);
      if (dom && dom.family !== anchorFamily && dom.hits >= 2 && ownHits <= 1) {
        negativeEvidencePenalty = dom.hits >= 3 ? 0.45 : 0.3;
      } else if (dom && dom.family !== anchorFamily && dom.hits > ownHits) {
        negativeEvidencePenalty = 0.15;
      }
    }
    const raw = 0.35 * keywordCoverageScore + 0.25 * titleOverlapScore + 0.2 * contextSpecificityScore + 0.2 * pageMatchScore;
    const totalScore = Math.max(0, Math.min(1, raw - negativeEvidencePenalty));
    return { para, keywordHits, missingKeywords, keywordCoverageScore, titleOverlapScore, pageMatchScore, contextSpecificityScore, negativeEvidencePenalty, namedMethod, totalScore };
  };

  const pool = input.paragraphs.length ? input.paragraphs : [];
  let best = pool.map(evaluate).sort((a, b) => b.totalScore - a.totalScore || b.keywordHits.length - a.keywordHits.length)[0];
  const sourceId = input.sourceId || best?.para.sourceId || "";

  if (!best) {
    return { anchorId: input.anchorId, candidateTitle: title, sourceId, requestedPage, matchedPage: undefined, exactText: "", keywordHits: [], missingKeywords: keywords, titleOverlapScore: 0, keywordCoverageScore: 0, pageMatchScore: 0, contextSpecificityScore: 0, negativeEvidencePenalty: 0, totalScore: 0, confidence: "unsupported", decision: "block" };
  }

  const resultVocab = RESULT_VOCAB_RE.test(best.para.text);
  const formulaFamilyMatch = kind === "formula" && Boolean(formulaMetricFamily(keywords.join(" ")));
  const gate = kindGatePasses(kind, {
    keywordHits: best.keywordHits,
    keywordCoverageScore: best.keywordCoverageScore,
    titleOverlapScore: best.titleOverlapScore,
    namedMethod: best.namedMethod,
    pageMatchScore: best.pageMatchScore,
    exactTextLen: best.para.text.length,
    resultVocab,
    formulaFamilyMatch,
  });

  let confidence: AnchorConfidence;
  if (best.keywordHits.length === 0 && !best.namedMethod && best.titleOverlapScore < 0.34) confidence = "unsupported";
  else if (!gate) confidence = (best.keywordHits.length > 0 || best.namedMethod) ? "low" : "unsupported";
  else if (best.namedMethod && best.totalScore >= 0.6) confidence = "high";
  else if (best.totalScore >= 0.7) confidence = "high";
  else if (best.totalScore >= 0.5) confidence = "medium";
  else if (best.totalScore >= 0.3) confidence = "low";
  else confidence = "unsupported";
  if (best.negativeEvidencePenalty >= 0.3 && !best.namedMethod) confidence = minConfidence(confidence, "low");

  let decision: AnchorDecision;
  if (confidence === "high" || confidence === "medium") decision = "register";
  else if (confidence === "low") decision = best.negativeEvidencePenalty >= 0.3 ? "block" : "needs_critic_review";
  else decision = "block";

  return {
    anchorId: input.anchorId,
    candidateTitle: title,
    sourceId,
    requestedPage,
    matchedPage: best.para.page,
    exactText: best.para.text.slice(0, 500),
    keywordHits: best.keywordHits,
    missingKeywords: best.missingKeywords,
    titleOverlapScore: Number(best.titleOverlapScore.toFixed(3)),
    keywordCoverageScore: Number(best.keywordCoverageScore.toFixed(3)),
    pageMatchScore: best.pageMatchScore,
    contextSpecificityScore: Number(best.contextSpecificityScore.toFixed(3)),
    negativeEvidencePenalty: best.negativeEvidencePenalty,
    totalScore: Number(best.totalScore.toFixed(3)),
    confidence,
    decision,
  };
}

function evidenceFromScore(score: AnchorEvidenceScore): AnchorEvidence {
  return {
    matchedPage: score.matchedPage,
    keywordHits: score.keywordHits,
    missingKeywords: score.missingKeywords,
    titleOverlapScore: score.titleOverlapScore,
    keywordCoverageScore: score.keywordCoverageScore,
    pageMatchScore: score.pageMatchScore,
    contextSpecificityScore: score.contextSpecificityScore,
    negativeEvidencePenalty: score.negativeEvidencePenalty,
    totalScore: score.totalScore,
    decision: score.decision,
  };
}

/** Existing anchor confidence rank for "is it stronger than the candidate?". */
function anchorStrength(anchor: CanonicalSourceAnchor): number {
  if (anchor.confidence) return CONFIDENCE_RANK[anchor.confidence];
  // Source-doc structural anchors and visual anchors are first-class → strong.
  return CONFIDENCE_RANK.high;
}

/** LITERAL concept tokens (conceptKeywords + title only, no synonyms, no noisy
 *  exactText) — the strict basis for deciding two anchors are the same concept. */
function literalConceptTokens(anchor: CanonicalSourceAnchor): Set<string> {
  const tokens = new Set<string>();
  for (const keyword of anchor.conceptKeywords ?? []) tokens.add(keyword.toLowerCase());
  for (const word of normalizeForMatch(anchor.title ?? "").split(" ")) {
    if (word.length >= 3 && !SEMANTIC_ANCHOR_STOPWORDS.has(word)) tokens.add(word);
  }
  return tokens;
}

/** Find an existing canonical anchor that genuinely covers this concept (≥2
 *  LITERAL keyword overlap, or same/adjacent page + ≥1 for a first-class
 *  structural anchor) and is at least as strong — to reuse instead of minting a
 *  near-duplicate, without absorbing a reference into an unrelated anchor (Fix 5). */
function pickStrongerExistingAnchor(
  anchorId: string,
  keywords: string[],
  inferredPage: number | undefined,
  sourceId: string,
  registry: Record<string, CanonicalSourceAnchor>,
  candidateConfidence: AnchorConfidence,
): string | undefined {
  let best: { id: string; score: number } | null = null;
  for (const anchor of Object.values(registry)) {
    if (anchor.id === anchorId) continue;
    if (anchor.kind === "formula" || anchor.kind === "figure" || anchor.kind === "table" || anchor.kind === "graph") continue;
    if (sourceId && anchor.sourceId && anchor.sourceId !== sourceId) continue;
    const tokens = literalConceptTokens(anchor);
    const overlap = keywords.filter((keyword) => tokens.has(keyword)).length;
    const samePage = inferredPage != null && anchor.page != null && Math.abs(anchor.page - inferredPage) <= 1;
    const structural = anchor.origin === "structural_ledger" && !anchor.confidence; // source-doc structure
    const qualifies = overlap >= 2 || (samePage && overlap >= 1 && structural);
    if (!qualifies) continue;
    if (anchorStrength(anchor) < CONFIDENCE_RANK[candidateConfidence]) continue;
    const score = overlap * 10 + (samePage ? 3 : 0) + anchorStrength(anchor);
    if (!best || score > best.score) best = { id: anchor.id, score };
  }
  return best?.id;
}

type MissingAnchorResolution =
  | { action: "register_from_source_text"; record: CanonicalSourceAnchor; score: AnchorEvidenceScore }
  | { action: "needs_critic_review"; record: CanonicalSourceAnchor; score: AnchorEvidenceScore }
  | { action: "replace_with_existing_anchor"; replacementAnchorId: string; score: AnchorEvidenceScore }
  | { action: "remove_unsupported_anchor"; score: AnchorEvidenceScore };

/** Decide how to resolve one referenced-but-unregistered semantic anchor using
 *  scored evidence: register (medium+), replace with a genuinely equivalent
 *  stronger existing anchor (Fix 5), route a weakly-grounded one to the critic
 *  (Fix 6), or block. */
function resolveMissingSemanticAnchor(
  anchorId: string,
  registry: Record<string, CanonicalSourceAnchor>,
  paragraphs: SourceParagraph[],
  fallbackSourceId: string,
): MissingAnchorResolution {
  const keywords = semanticAnchorKeywords(anchorId);
  const inferredPage = semanticAnchorPage(anchorId);
  const kind = semanticAnchorKind(anchorId);
  const score = scoreAnchorEvidence({ anchorId, kind, conceptKeywords: keywords, requestedPage: inferredPage, sourceId: fallbackSourceId, paragraphs });
  const sourceId = score.sourceId || fallbackSourceId || "source";

  const buildRecord = (confidence: AnchorConfidence): CanonicalSourceAnchor => ({
    id: anchorId,
    kind,
    title: score.candidateTitle.charAt(0).toUpperCase() + score.candidateTitle.slice(1),
    page: score.matchedPage ?? inferredPage,
    sourceId,
    origin: "structural_ledger",
    semanticSummary: `Source page ${score.matchedPage ?? "?"} supports ${score.keywordHits.join(", ") || score.candidateTitle}.`,
    exactText: score.exactText || undefined,
    conceptKeywords: keywords,
    confidence,
    evidence: evidenceFromScore(score),
  });

  const existing = pickStrongerExistingAnchor(anchorId, keywords, inferredPage, sourceId, registry, score.confidence);

  if (score.decision === "register") {
    // A well-supported anchor is registered as its OWN concept. Replace only
    // when an existing anchor is a genuine ≥2-literal-keyword duplicate, so we
    // never fold a good reference into an unrelated anchor.
    if (existing && keywords.filter((k) => literalConceptTokens(registry[existing]).has(k)).length >= 2) {
      return { action: "replace_with_existing_anchor", replacementAnchorId: existing, score };
    }
    return { action: "register_from_source_text", record: buildRecord(score.confidence), score };
  }

  // Weak/unsupported: reuse a genuinely equivalent stronger anchor if one exists.
  if (existing) return { action: "replace_with_existing_anchor", replacementAnchorId: existing, score };

  if (score.decision === "needs_critic_review") {
    return { action: "needs_critic_review", record: buildRecord("low"), score };
  }
  return { action: "remove_unsupported_anchor", score };
}

export interface MissingAnchorRepairResult {
  changed: string[];
  notes: string[];
  registered: string[];
  replaced: Array<{ from: string; to: string }>;
  /** Registered but low-confidence: blocking until a critic confirms (Fix 6). */
  needsCriticReview: string[];
  /** No source basis and no equivalent: blocking (Fix 4). */
  unresolved: string[];
  requests: MissingAnchorRepairRequest[];
  /** The full evidence score for every semantic anchor processed (Fix 3/8). */
  evidenceScores: AnchorEvidenceScore[];
}

/** Register or replace every referenced-but-unregistered semantic source anchor
 *  using scored evidence: medium+ registers, weak reuses a stronger existing
 *  anchor or is registered low + routed to the critic, unsupported stays
 *  blocking. Idempotent. Keeps page frontmatter and the contract in sync when it
 *  replaces an anchor (Fix 4). */
export function repairMissingCanonicalAnchors(gardenDir: string, slug?: string): MissingAnchorRepairResult {
  const result: MissingAnchorRepairResult = { changed: [], notes: [], registered: [], replaced: [], needsCriticReview: [], unresolved: [], requests: [], evidenceScores: [] };
  const bd = path.join(gardenDir, ".breadboard");
  const markChanged = (rel: string): void => { if (!result.changed.includes(rel)) result.changed.push(rel); };

  const state = buildFinalGardenState(gardenDir, slug);
  const registry = state.sourceAnchors;

  const refPages = new Map<string, Set<string>>();
  const refUnits = new Map<string, Set<string>>();
  const noteRef = (id: string, pageRel?: string, unitId?: string): void => {
    if (pageRel) (refPages.get(id) ?? refPages.set(id, new Set()).get(id)!).add(pageRel);
    if (unitId) (refUnits.get(id) ?? refUnits.set(id, new Set()).get(id)!).add(unitId);
  };
  for (const page of state.pages) {
    for (const id of [...page.sourceAnchors, ...page.sourceFormulaAnchors]) noteRef(id, page.rel);
  }
  for (const unit of state.learningUnitContract.units) {
    for (const id of unit.sourceAnchors ?? []) noteRef(id, undefined, unit.id);
  }

  const missing = [...new Set([...refPages.keys(), ...refUnits.keys()])]
    .filter((id) => isSemanticAnchorId(id) && !registry[id])
    .sort();
  if (missing.length === 0) {
    writeSourceAnchorEvidenceReport(gardenDir, registry, [], markChanged);
    return result;
  }

  const paragraphs = sourceParagraphsWithSource(gardenDir);
  const fallbackSourceId = Object.values(registry).map((a) => a.sourceId).find(Boolean)
    ?? paragraphs[0]?.sourceId ?? "";

  const anchorLedgerPath = path.join(bd, "source-anchors.json");
  const anchorLedger = readJson<Record<string, unknown>>(anchorLedgerPath, {});
  const structural: Array<Record<string, unknown>> = Array.isArray(anchorLedger.sourceStructuralAnchors)
    ? [...(anchorLedger.sourceStructuralAnchors as Array<Record<string, unknown>>)]
    : [];
  const structuralIds = new Set(structural.map((a) => String(a.id ?? "")));
  const replacements = new Map<string, string>();
  let ledgerChanged = false;

  const persistRecord = (record: CanonicalSourceAnchor): void => {
    if (structuralIds.has(record.id)) return;
    structural.push({
      id: record.id,
      kind: record.kind,
      title: record.title,
      page: record.page,
      sourceId: record.sourceId,
      semanticSummary: record.semanticSummary,
      exactText: record.exactText,
      conceptKeywords: record.conceptKeywords,
      confidence: record.confidence,
      evidence: record.evidence,
    });
    structuralIds.add(record.id);
    ledgerChanged = true;
  };

  for (const id of missing) {
    const resolution = resolveMissingSemanticAnchor(id, registry, paragraphs, fallbackSourceId);
    result.evidenceScores.push(resolution.score);
    const request: MissingAnchorRepairRequest = {
      targetKind: "source_anchor_ledger",
      missingAnchorId: id,
      referencedByPages: [...(refPages.get(id) ?? [])],
      referencedByUnitIds: [...(refUnits.get(id) ?? [])],
      sourceId: fallbackSourceId || undefined,
      inferredPage: semanticAnchorPage(id),
      inferredConceptKeywords: semanticAnchorKeywords(id),
      repairAction: resolution.action,
    };
    if (resolution.action === "register_from_source_text") {
      persistRecord(resolution.record);
      result.registered.push(id);
      result.notes.push(`registered source anchor ${id} (confidence ${resolution.record.confidence}, score ${resolution.score.totalScore})`);
    } else if (resolution.action === "needs_critic_review") {
      // Register with low confidence so the evidence is auditable, but it blocks
      // strict acceptance until a critic confirms it (Fix 4/6).
      persistRecord(resolution.record);
      result.needsCriticReview.push(id);
      result.notes.push(`low-confidence anchor ${id} (score ${resolution.score.totalScore}) routed to critic: ${resolution.score.missingKeywords.length} keyword(s) unmatched`);
    } else if (resolution.action === "replace_with_existing_anchor") {
      request.replacementAnchorId = resolution.replacementAnchorId;
      replacements.set(id, resolution.replacementAnchorId);
      result.replaced.push({ from: id, to: resolution.replacementAnchorId });
      result.notes.push(`replaced weak anchor ${id} with stronger canonical anchor ${resolution.replacementAnchorId} (Fix 5)`);
    } else {
      result.unresolved.push(id);
      result.notes.push(`unsupported anchor ${id}: no source basis and no equivalent (score ${resolution.score.totalScore}); stays blocking`);
    }
    result.requests.push(request);
  }

  if (ledgerChanged) {
    anchorLedger.sourceStructuralAnchors = structural;
    fs.writeFileSync(anchorLedgerPath, `${JSON.stringify(anchorLedger, null, 2)}\n`, "utf-8");
    markChanged(".breadboard/source-anchors.json");
  }

  if (replacements.size > 0) {
    for (const page of state.pages) {
      const content = readText(page.abs);
      if (content === undefined) continue;
      const { rawFrontmatter, body } = splitFrontmatter(content);
      let rawFm = rawFrontmatter;
      for (const key of ["sourceAnchors", "sourceFormulaAnchors"]) {
        const values = fmArray(rawFm, key);
        if (values.some((value) => replacements.has(value))) {
          rawFm = setFmArrayLine(rawFm, key, values.map((value) => replacements.get(value) ?? value));
        }
      }
      if (rawFm !== rawFrontmatter) {
        fs.writeFileSync(page.abs, `---\n${rawFm.replace(/\s+$/, "")}\n---\n\n${body.replace(/^\n+/, "")}`, "utf-8");
        markChanged(page.rel);
      }
    }
    const contractPath = fs.existsSync(path.join(bd, "learning-unit-contract.json"))
      ? path.join(bd, "learning-unit-contract.json")
      : path.join(bd, "planning", "learning-unit-contract.json");
    if (fs.existsSync(contractPath)) {
      const contractJson = readJson<Record<string, unknown>>(contractPath, {});
      const units = Array.isArray(contractJson.learningUnits)
        ? contractJson.learningUnits as Array<Record<string, unknown>>
        : Array.isArray(contractJson.units)
          ? contractJson.units as Array<Record<string, unknown>>
          : [];
      let contractChanged = false;
      for (const unit of units) {
        const anchors = Array.isArray(unit.sourceAnchors) ? unit.sourceAnchors.map(String) : [];
        if (anchors.some((value) => replacements.has(value))) {
          unit.sourceAnchors = [...new Set(anchors.map((value) => replacements.get(value) ?? value))];
          contractChanged = true;
        }
      }
      if (contractChanged) {
        fs.writeFileSync(contractPath, `${JSON.stringify(contractJson, null, 2)}\n`, "utf-8");
        markChanged(path.relative(gardenDir, contractPath).split(path.sep).join("/"));
      }
    }
  }

  // Refresh registry (records just written) and emit the evidence report.
  const finalRegistry = buildFinalGardenState(gardenDir, slug).sourceAnchors;
  writeSourceAnchorEvidenceReport(gardenDir, finalRegistry, result.replaced, markChanged);
  return result;
}

/**
 * Fix 2/7: resolve a proposed anchor CANDIDATE into a canonical record ONLY when
 * scored evidence is at least medium confidence. Generation and repair must call
 * this BEFORE attaching any anchor id to a page or the contract — a candidate
 * whose evidence is weak returns null and must NOT be used as-is.
 * `reconcileFinalGardenState` enforces the same rule as the final safety net.
 */
export function resolveSourceAnchorCandidate(
  gardenDir: string,
  candidate: SourceAnchorCandidate,
): CanonicalSourceAnchor | null {
  const paragraphs = sourceParagraphsWithSource(gardenDir);
  const keywords = candidate.conceptKeywords.length
    ? candidate.conceptKeywords.map((k) => k.toLowerCase())
    : semanticAnchorKeywords(candidate.proposedId);
  const kind: CanonicalSourceAnchorKind = candidate.kind === "text" ? "text_concept" : candidate.kind;
  // Fold explicit search terms in as extra concept keywords for the scorer.
  const scoreKeywords = [...new Set([...keywords, ...candidate.sourceSearchTerms.map((t) => t.toLowerCase())])].filter(Boolean);
  const score = scoreAnchorEvidence({
    anchorId: candidate.proposedId,
    title: candidate.title,
    kind,
    conceptKeywords: scoreKeywords,
    sourceId: candidate.sourceId,
    requestedPage: candidate.page ?? semanticAnchorPage(candidate.proposedId),
    paragraphs,
  });
  // Creation-time gate: only medium/high evidence may be attached directly.
  if (score.decision !== "register") return null;
  return {
    id: candidate.proposedId,
    kind,
    title: candidate.title || (score.candidateTitle.charAt(0).toUpperCase() + score.candidateTitle.slice(1)),
    page: score.matchedPage ?? candidate.page,
    sourceId: candidate.sourceId || score.sourceId || "source",
    origin: "structural_ledger",
    semanticSummary: candidate.semanticSummary || `Source page ${score.matchedPage ?? "?"} supports ${score.keywordHits.join(", ")}.`,
    exactText: score.exactText || undefined,
    conceptKeywords: keywords,
    confidence: score.confidence,
    evidence: evidenceFromScore(score),
  };
}

/**
 * Fix 7: partition model-proposed source anchor ids into those safe to attach
 * now — figure/formula/table codes, first-class structural anchors, and semantic
 * anchors that RESOLVE against the source — and those to DEFER (unresolvable
 * semantic anchors that must not enter a page/contract as raw strings). When the
 * source markdown is not available yet, nothing is deferred (the reconcile net
 * enforces evidence later).
 */
export function ingestModelSourceAnchors(
  gardenDir: string,
  anchors: string[],
): { accepted: string[]; deferred: string[] } {
  const canValidate = fs.existsSync(path.join(gardenDir, "sources"));
  const accepted: string[] = [];
  const deferred: string[] = [];
  const sanitized = sanitizeSourceAnchorIds(anchors);
  for (const raw of sanitized.rejectedLabels) deferred.push(raw.value);
  for (const raw of sanitized.acceptedAnchorIds) {
    const id = String(raw ?? "").trim();
    if (!id) continue;
    // Codes and first-class structural anchors pass through untouched.
    if (!isSemanticAnchorId(id) || structuralKindFromId(id)) { accepted.push(id); continue; }
    if (!canValidate) { accepted.push(id); continue; }
    const resolved = resolveSourceAnchorCandidate(gardenDir, {
      proposedId: id,
      sourceId: "",
      kind: "text",
      title: "",
      conceptKeywords: semanticAnchorKeywords(id),
      semanticSummary: "",
      sourceSearchTerms: [],
      requiredForUnitIds: [],
    });
    if (resolved) accepted.push(id); else deferred.push(id);
  }
  return { accepted: [...new Set(accepted)], deferred: [...new Set(deferred)] };
}

/** Extract the anchor ids Rule A flagged as referenced-but-unregistered. */
export function missingRegistryAnchorIds(problems: string[]): string[] {
  const ids: string[] = [];
  for (const problem of problems) {
    const match = problem.match(/source anchor "([^"]+)" is referenced[\s\S]*?missing from the canonical source-anchor registry/);
    if (match) ids.push(match[1]);
  }
  return [...new Set(ids)];
}

/** Fix 6: the human-readable "not published" explanation for missing anchors. */
export function describeMissingAnchorFailure(ids: string[]): string {
  return [
    "The garden was generated as a draft but not published because these source anchors are referenced but not registered:",
    ...ids.map((id) => `- ${id}`),
    "",
    "Recommended repair: register these as source text anchors from their page, replace them with existing canonical anchors, or remove them if unsupported.",
  ].join("\n");
}

/** A blocking critic issue for a weakly-grounded generated anchor (Fix 6). */
export interface AnchorCriticIssue {
  severity: "blocking";
  type: "source_anchor_mismatch";
  sourceAnchorIds: string[];
  problem: string;
  evidence: string;
  expected: string;
  repairTarget: "source_anchor_ledger";
  suggestedRepair: string;
  pagePath?: string;
}

/** Build critic issues for every referenced generated anchor whose evidence is
 *  low/unsupported and not yet critic-confirmed (Fix 6). */
export function buildAnchorEvidenceCriticIssues(state: FinalGardenState): AnchorCriticIssue[] {
  const referenced = new Set<string>();
  for (const page of state.pages) for (const id of [...page.sourceAnchors, ...page.sourceFormulaAnchors]) referenced.add(id);
  for (const unit of state.learningUnitContract.units) for (const id of unit.sourceAnchors ?? []) referenced.add(id);
  const issues: AnchorCriticIssue[] = [];
  for (const anchor of Object.values(state.sourceAnchors)) {
    if (!anchor.confidence || anchor.criticConfirmed) continue;
    if (anchor.confidence !== "low" && anchor.confidence !== "unsupported") continue;
    if (!referenced.has(anchor.id)) continue;
    const ev = anchor.evidence;
    const total = ev ? ev.keywordHits.length + ev.missingKeywords.length : 0;
    const page = state.pages.find((p) => p.sourceAnchors.includes(anchor.id) || p.sourceFormulaAnchors.includes(anchor.id));
    issues.push({
      severity: "blocking",
      type: "source_anchor_mismatch",
      sourceAnchorIds: [anchor.id],
      problem: "Generated semantic anchor has weak source evidence.",
      evidence: ev
        ? `Only ${ev.keywordHits.length} of ${total} keywords matched (score ${ev.totalScore}); ${ev.negativeEvidencePenalty > 0 ? "passage is dominated by a different concept family; " : ""}passage does not clearly support the anchor summary.`
        : `Anchor confidence is ${anchor.confidence}.`,
      expected: "Replace with a supported source anchor or revise the unit/page grounding.",
      repairTarget: "source_anchor_ledger",
      suggestedRepair: "Ask ChatMock to confirm, replace, or remove the anchor.",
      pagePath: page?.rel,
    });
  }
  return issues.sort((a, b) => a.sourceAnchorIds[0].localeCompare(b.sourceAnchorIds[0]));
}

/** Record a ChatMock critic's verdict on a low-confidence anchor (Fix 4). A
 *  confirmed anchor becomes acceptance-passing; the audit exempts it. */
export function recordCriticAnchorConfirmation(gardenDir: string, confirmation: CriticAnchorConfirmation): boolean {
  const ledgerPath = path.join(gardenDir, ".breadboard", "source-anchors.json");
  const ledger = readJson<Record<string, unknown>>(ledgerPath, {});
  const structural = Array.isArray(ledger.sourceStructuralAnchors) ? ledger.sourceStructuralAnchors as Array<Record<string, unknown>> : [];
  const record = structural.find((a) => String(a.id ?? "") === confirmation.anchorId);
  if (!record) return false;
  record.criticConfirmed = confirmation.confirmed;
  record.criticConfirmationReason = confirmation.reason;
  if (confirmation.criticIssueId) record.criticIssueId = confirmation.criticIssueId;
  if (confirmation.confirmedExactText) record.criticConfirmedExactText = confirmation.confirmedExactText;
  ledger.sourceStructuralAnchors = structural;
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf-8");
  return true;
}

// ---------------------------------------------------------------------------
// ChatMock anchor confirmation loop (wire low-confidence anchors to the critic)
// ---------------------------------------------------------------------------

/** Referenced, low/unsupported, not-yet-confirmed generated anchor ids. */
export function unresolvedLowConfidenceAnchorIds(state: FinalGardenState): string[] {
  const referenced = new Set<string>();
  for (const page of state.pages) for (const id of [...page.sourceAnchors, ...page.sourceFormulaAnchors]) referenced.add(id);
  for (const unit of state.learningUnitContract.units) for (const id of unit.sourceAnchors ?? []) referenced.add(id);
  return Object.values(state.sourceAnchors)
    .filter((a) => a.confidence && !a.criticConfirmed && (a.confidence === "low" || a.confidence === "unsupported") && referenced.has(a.id))
    .map((a) => a.id)
    .sort();
}

/** Build a ChatMock decision packet for every unresolved low-confidence anchor. */
export function buildAnchorConfirmationPackets(gardenDir: string, state: FinalGardenState): AnchorConfirmationPacket[] {
  const ids = unresolvedLowConfidenceAnchorIds(state);
  if (ids.length === 0) return [];
  const paragraphs = sourceParagraphsWithSource(gardenDir);
  const packets: AnchorConfirmationPacket[] = [];
  for (const id of ids) {
    const anchor = state.sourceAnchors[id];
    if (!anchor) continue;
    const pages = state.pages.filter((p) => p.sourceAnchors.includes(id) || p.sourceFormulaAnchors.includes(id)).map((p) => p.rel);
    const unitIds = state.learningUnitContract.units.filter((u) => (u.sourceAnchors ?? []).includes(id)).map((u) => u.id);
    const visuals = state.visuals.filter((v) => [...v.anchorIds, ...v.textAnchorIds].includes(id)).map((v) => v.id);
    const page = anchor.page ?? semanticAnchorPage(id);
    const nearby = paragraphs
      .filter((p) => page == null || Math.abs(p.page - page) <= 1)
      .filter((p) => p.text.slice(0, 500) !== (anchor.exactText ?? ""))
      .slice(0, 4)
      .map((p) => ({ page: p.page, exactText: p.text.slice(0, 400) }));
    const keywords = anchor.conceptKeywords ?? semanticAnchorKeywords(id);
    const existingAlternativeAnchors = Object.values(state.sourceAnchors)
      .filter((a) => a.id !== id && a.kind !== "formula" && a.kind !== "figure" && a.kind !== "table" && a.kind !== "graph")
      .filter((a) => {
        const tokens = literalConceptTokens(a);
        const overlap = keywords.filter((k) => tokens.has(k)).length;
        const near = page != null && a.page != null && Math.abs(a.page - page) <= 1;
        return overlap >= 1 || near;
      })
      .sort((a, b) => anchorStrength(b) - anchorStrength(a))
      .slice(0, 5);
    packets.push({
      anchor,
      evidence: anchor.evidence ?? { keywordHits: [], missingKeywords: keywords, titleOverlapScore: 0, keywordCoverageScore: 0, pageMatchScore: 0, contextSpecificityScore: 0, negativeEvidencePenalty: 0, totalScore: 0, decision: "needs_critic_review" },
      referencedBy: { pages, unitIds, visuals },
      candidatePassage: { sourceId: anchor.sourceId ?? "", page: anchor.page, exactText: anchor.exactText ?? "" },
      nearbySourcePassages: nearby,
      existingAlternativeAnchors,
    });
  }
  return packets;
}

/** Validate a structured anchor decision (Fix 3 rules). */
export function validateAnchorCriticDecision(decision: AnchorCriticDecision): { valid: boolean; reason?: string } {
  if (!decision || !decision.anchorId) return { valid: false, reason: "missing anchorId" };
  switch (decision.decision) {
    case "confirm":
      if (decision.confidence !== "high" && decision.confidence !== "medium") return { valid: false, reason: "confirm requires high|medium confidence" };
      if (!decision.confirmedExactText || !decision.confirmedExactText.trim()) return { valid: false, reason: "confirm requires confirmedExactText" };
      return { valid: true };
    case "replace":
      if (!decision.replacementAnchorId) return { valid: false, reason: "replace requires replacementAnchorId" };
      return { valid: true };
    case "create_better_anchor":
      if (!decision.betterAnchor?.exactText?.trim()) return { valid: false, reason: "create_better_anchor requires betterAnchor.exactText" };
      if (!decision.betterAnchor?.id) return { valid: false, reason: "create_better_anchor requires betterAnchor.id" };
      return { valid: true };
    case "reject":
      return { valid: true }; // valid, but keeps the anchor blocking
    default:
      return { valid: false, reason: `unknown decision "${(decision as { decision?: string }).decision}"` };
  }
}

// ---------------------------------------------------------------------------
// Independent verification of ChatMock anchor decisions against the source
// ---------------------------------------------------------------------------

/** Near-exact threshold: a candidate must be ≥ 92% similar to count as a match. */
export const NEAR_EXACT_SIMILARITY_THRESHOLD = 0.92;

/** Normalize source/critic text so trivial formatting differences do not block a
 *  match: NFKC, unify quotes/dashes, de-space citation brackets, collapse
 *  whitespace, lowercase. Does NOT tolerate paraphrase. */
function normalizeSourceText(text: string): string {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/[‘’‛′‵]/g, "'")
    .replace(/[“”″‶]/g, '"')
    .replace(/[‐-―−⁃﹘﹣－]/g, "-")
    .replace(/\[\s*(\d+(?:\s*,\s*\d+)*)\s*\]/g, (_m, inner: string) => `[${inner.replace(/\s*,\s*/g, ",").replace(/\s+/g, "")}]`)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Character-bigram Dice similarity in [0,1] — cheap and robust to small edits. */
function bigramDice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i += 1) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let inter = 0;
  for (const [g, na] of ga) { const nb = gb.get(g); if (nb) inter += Math.min(na, nb); }
  return (2 * inter) / ((a.length - 1) + (b.length - 1));
}

/** Best near-exact similarity of `target` against sliding windows of `haystack`. */
function bestWindowSimilarity(target: string, haystack: string): number {
  if (!target || haystack.length < 2) return 0;
  const len = target.length;
  if (haystack.length <= len) return bigramDice(target, haystack);
  let best = 0;
  const step = Math.max(1, Math.floor(len / 4));
  for (let i = 0; i + len <= haystack.length; i += step) {
    const sim = bigramDice(target, haystack.slice(i, i + len));
    if (sim > best) best = sim;
    if (best >= 0.999) break;
  }
  // Also probe the window that starts at the first shared token, for alignment.
  const firstWord = target.split(" ")[0];
  const at = firstWord ? haystack.indexOf(firstWord) : -1;
  if (at >= 0) best = Math.max(best, bigramDice(target, haystack.slice(at, at + len)));
  return best;
}

/**
 * Fix 1/2: verify a ChatMock-supplied excerpt actually exists in the source
 * markdown. Tries exact, then normalized-exact, then near-exact (≥ threshold).
 * Paraphrase is never accepted. Scoped to the anchor's page (± 1) when known.
 */
export function verifySourceText(
  gardenDir: string,
  exactText: string,
  opts: { sourceId?: string; page?: number; nearExactThreshold?: number } = {},
): SourceTextVerificationResult {
  const target = String(exactText ?? "").replace(/\s+/g, " ").trim();
  if (target.length < 12) return { ok: false, matchType: "not_found", reason: "excerpt too short to verify" };
  const threshold = opts.nearExactThreshold ?? NEAR_EXACT_SIMILARITY_THRESHOLD;
  const all = sourceParagraphsWithSource(gardenDir);
  const scoped = all.filter((p) => {
    if (opts.sourceId && p.sourceId && p.sourceId !== opts.sourceId) return false;
    if (opts.page != null) return Math.abs(p.page - opts.page) <= 1;
    return true;
  });
  const pool = scoped.length ? scoped : all;
  const normTarget = normalizeSourceText(target);

  // 1) exact substring (whitespace-collapsed, case-sensitive).
  for (const p of pool) {
    if (p.text.includes(target)) return { ok: true, sourceId: p.sourceId, page: p.page, matchType: "exact", matchedText: target, similarity: 1, reason: "exact source substring match" };
  }
  // 2) normalized exact.
  for (const p of pool) {
    if (normalizeSourceText(p.text).includes(normTarget)) return { ok: true, sourceId: p.sourceId, page: p.page, matchType: "normalized_exact", matchedText: p.text.slice(0, 240), similarity: 1, reason: "normalized (quotes/dashes/whitespace/citations) source match" };
  }
  // 3) near-exact (very high similarity only).
  let best: { p: SourceParagraph; sim: number } | null = null;
  for (const p of pool) {
    const sim = bestWindowSimilarity(normTarget, normalizeSourceText(p.text));
    if (!best || sim > best.sim) best = { p, sim };
  }
  if (best && best.sim >= threshold) {
    return { ok: true, sourceId: best.p.sourceId, page: best.p.page, matchType: "near_exact", matchedText: best.p.text.slice(0, 240), similarity: Number(best.sim.toFixed(3)), reason: `near-exact source match (similarity ${best.sim.toFixed(3)} ≥ ${threshold})` };
  }
  return { ok: false, matchType: "not_found", similarity: best ? Number(best.sim.toFixed(3)) : 0, reason: `excerpt not found in source (best similarity ${best ? best.sim.toFixed(3) : "0"} < ${threshold}); paraphrase is not accepted as proof` };
}

// ---------------------------------------------------------------------------
// Relevance verification: a verified excerpt must SUPPORT the anchor's meaning.
// ---------------------------------------------------------------------------

/** Fine-grained concept families (multi-word terms allowed). Separate from the
 *  coarse FAMILY_TERMS used by the evidence scorer so that scoring is unchanged. */
const CONCEPT_FAMILY_TERMS: Record<Exclude<ConceptFamily, "other">, string[]> = {
  energy: ["energy", "power consumption", "power", "consumption", "joule", "watt", "bottleneck"],
  energy_efficiency: ["energy efficiency", "energy-efficient", "efficiency", "efficient", "normalized energy"],
  latency: ["latency", "delay", "inference time", "decision time", "timestep", "response time"],
  accuracy: ["accuracy", "accurate", "classification accuracy", "error rate", "correctly classified", "% accuracy", "top-1"],
  spike_count: ["spike count", "firing rate", "number of spikes", "sparsity", "spike rate", "spikes per"],
  convergence: ["convergence", "converge", "epoch", "training time", "converges", "convergence time"],
  surrogate_gradient: ["surrogate gradient", "surrogate", "differentiab", "non-differentiab", "backpropagation through", "gradient", "backprop"],
  stdp: ["spike-timing-dependent plasticity", "spike timing dependent plasticity", "stdp", "spike timing", "synaptic plasticity", "hebbian", "r-stdp"],
  ann_to_snn_conversion: ["ann-to-snn", "ann to snn", "conversion", "converted", "convert trained"],
  neuromorphic_hardware: ["neuromorphic", "loihi", "truenorth", "hardware", "chip", "asic", "fpga"],
  edge_deployment: ["edge computing", "edge", "mobile", "embedded", "deployment", "iot"],
  brain_comparison: ["brain-inspired", "brain inspired", "brain", "biological", "neuroscience", "cortex", "human brain"],
  event_driven_computation: ["event-driven", "event driven", "asynchronous", "discrete spikes", "discrete binary spikes", "spike events", "sparse events"],
};

/** Which families are close enough to count as the same concept for relevance. */
const FAMILY_COMPAT_GROUPS: ConceptFamily[][] = [
  ["energy", "energy_efficiency"],
  ["event_driven_computation", "spike_count"],
];
function conceptFamiliesCompatible(a: ConceptFamily, b: ConceptFamily): boolean {
  if (a === "other" || b === "other") return false;
  if (a === b) return true;
  return FAMILY_COMPAT_GROUPS.some((g) => g.includes(a) && g.includes(b));
}

function familyHitCountIn(normText: string, family: Exclude<ConceptFamily, "other">): number {
  return CONCEPT_FAMILY_TERMS[family].filter((term) => normText.includes(normalizeForMatch(term))).length;
}

/** Detect the dominant concept family of a block of text. */
export function detectConceptFamily(text: string): { family: ConceptFamily; hits: number } {
  const norm = normalizeForMatch(text);
  let best: { family: ConceptFamily; hits: number } = { family: "other", hits: 0 };
  for (const family of Object.keys(CONCEPT_FAMILY_TERMS) as Array<Exclude<ConceptFamily, "other">>) {
    const hits = familyHitCountIn(norm, family);
    if (hits > best.hits) best = { family, hits };
  }
  return best;
}

interface RelevanceAnchorLike {
  id: string;
  title?: string;
  kind?: string;
  conceptKeywords?: string[];
  semanticSummary?: string;
}

/**
 * Fix 1/5: does `quoteText` actually SUPPORT the anchor's title/summary/keywords
 * and concept family? Scores keyword coverage, title overlap, summary overlap,
 * and family compatibility, penalizing a passage dominated by a WRONG family.
 * Presence (verifySourceText) must be checked separately and first.
 */
export function verifySourceTextRelevance(anchor: RelevanceAnchorLike, quoteText: string): SourceTextRelevanceResult {
  const keywords = (anchor.conceptKeywords?.length ? anchor.conceptKeywords : semanticAnchorKeywords(anchor.id)).map((k) => k.toLowerCase());
  const title = anchor.title ?? "";
  const summary = anchor.semanticSummary ?? "";
  const kind = anchor.kind ?? "text_concept";
  const norm = normalizeForMatch(quoteText);
  const tokens = new Set(norm.split(" "));

  const textKeywordHits = keywords.filter((k) => tokenSetContainsKeyword(tokens, k));
  const textMissingKeywords = keywords.filter((k) => !tokenSetContainsKeyword(tokens, k));
  const keywordCoverageScore = keywords.length ? textKeywordHits.length / keywords.length : 0;

  const titleTerms = titleTermsOf(title);
  const titleOverlapScore = titleTerms.length ? titleTerms.filter((t) => tokenSetContainsKeyword(tokens, t)).length / titleTerms.length : 0;

  const summaryTerms = [...new Set(titleTermsOf(summary))].filter((t) => !SEMANTIC_ANCHOR_STOPWORDS.has(t));
  const summaryOverlapScore = summaryTerms.length ? summaryTerms.filter((t) => tokenSetContainsKeyword(tokens, t)).length / summaryTerms.length : 0;

  const anchorFamily = detectConceptFamily([keywords.join(" "), title, summary].join(" ")).family;
  const dominantText = detectConceptFamily(quoteText);
  const textFamily = dominantText.family;

  let familyCompatibilityScore = 0.5;
  let wrongFamilyPenalty = 0;
  if (anchorFamily !== "other" && textFamily !== "other") {
    if (conceptFamiliesCompatible(anchorFamily, textFamily)) {
      familyCompatibilityScore = 1;
    } else {
      familyCompatibilityScore = 0;
      // The passage is clearly about a different concept — the core failure mode.
      wrongFamilyPenalty = dominantText.hits >= 2 ? 0.5 : 0.3;
    }
  } else if (anchorFamily !== "other" && textFamily === "other") {
    // Anchor has a concrete family but the text does not evidence it.
    familyCompatibilityScore = familyHitCountIn(norm, anchorFamily as Exclude<ConceptFamily, "other">) > 0 ? 0.75 : 0.25;
  }

  const totalScore = Math.max(0, Math.min(1,
    0.3 * keywordCoverageScore + 0.2 * titleOverlapScore + 0.15 * summaryOverlapScore + 0.35 * familyCompatibilityScore - wrongFamilyPenalty,
  ));

  const hasAnyEvidence = textKeywordHits.length > 0 || titleOverlapScore > 0 || familyCompatibilityScore >= 0.75;
  let decision: SourceTextRelevanceDecision;
  if (wrongFamilyPenalty >= 0.3 || !hasAnyEvidence) decision = "irrelevant";
  else if (totalScore >= 0.6 || (familyCompatibilityScore === 1 && textKeywordHits.length >= 1)) decision = "relevant";
  else if (totalScore >= 0.35) decision = "weak_relevance";
  else decision = "irrelevant";

  const ok = decision === "relevant";
  const reason = decision === "relevant"
    ? `passage supports the ${anchorFamily} anchor (${textKeywordHits.length}/${keywords.length} keywords, family ${textFamily})`
    : decision === "weak_relevance"
      ? `passage weakly supports the anchor (${textKeywordHits.length}/${keywords.length} keywords, family ${textFamily} vs ${anchorFamily})`
      : wrongFamilyPenalty > 0
        ? `passage is about ${textFamily}, not the ${anchorFamily} anchor concept`
        : `passage does not evidence the anchor's title/summary/keywords`;

  return {
    ok, anchorId: anchor.id, anchorTitle: title, anchorKind: kind,
    anchorConceptKeywords: keywords, anchorSemanticSummary: summary,
    anchorFamily, textFamily,
    textKeywordHits, textMissingKeywords,
    titleOverlapScore: Number(titleOverlapScore.toFixed(3)),
    keywordCoverageScore: Number(keywordCoverageScore.toFixed(3)),
    summaryOverlapScore: Number(summaryOverlapScore.toFixed(3)),
    familyCompatibilityScore,
    wrongFamilyPenalty,
    totalScore: Number(totalScore.toFixed(3)),
    decision, reason,
  };
}

/** Is a confirm/create relevance verdict acceptable for this anchor kind (Fix 2)?
 *  weak_relevance is allowed only for broad abstract/intro/guidance anchors with
 *  high critic confidence. Never for formula/method/result/table/graph/visual. */
export function isRelevanceAcceptableForKind(relevance: SourceTextRelevanceResult, kind: string, criticConfidence: string): boolean {
  if (relevance.decision === "relevant") return true;
  const broad = kind === "abstract" || kind === "intro" || kind === "guidance";
  return relevance.decision === "weak_relevance" && criticConfidence === "high" && broad;
}

/**
 * Fix 3: is `replacementId` semantically compatible with the weak anchor and its
 * usage? Requires the replacement to exist, be strong, share kind/source/family,
 * and overlap the weak anchor's concept (or its page/unit role).
 */
export function checkReplacementCompatibility(
  state: FinalGardenState,
  weakAnchorId: string,
  replacementId: string,
): SemanticCompatibilityResult {
  const weak = state.sourceAnchors[weakAnchorId];
  const rep = state.sourceAnchors[replacementId];
  if (!rep) return { ok: false, reason: `replacement anchor ${replacementId} is not in the canonical registry` };
  const strong = rep.criticConfirmed || !rep.confidence || rep.confidence === "high" || rep.confidence === "medium";
  if (!strong) return { ok: false, reason: `replacement ${replacementId} is itself ${rep.confidence} confidence and not critic-confirmed` };

  const weakIsFormula = weak?.kind === "formula";
  const repIsFormula = rep.kind === "formula";
  if (weakIsFormula !== repIsFormula) return { ok: false, reason: `kind mismatch: ${weak?.kind ?? "?"} anchor cannot be replaced by a ${rep.kind} anchor` };
  if (weakIsFormula && repIsFormula && !metricFamiliesCompatible(weak?.formulaFamily ?? "", rep.formulaFamily ?? "")) {
    return { ok: false, reason: `formula family mismatch: ${weak?.formulaFamily ?? "?"} vs ${rep.formulaFamily ?? "?"}` };
  }
  if (weak?.sourceId && rep.sourceId && weak.sourceId !== rep.sourceId) {
    return { ok: false, reason: `different source document (${weak.sourceId} vs ${rep.sourceId})` };
  }
  if (weak?.page != null && rep.page != null && Math.abs(weak.page - rep.page) > 3) {
    return { ok: false, reason: `replacement page ${rep.page} is far from the weak anchor page ${weak.page}` };
  }

  const weakKeywords = weak?.conceptKeywords ?? semanticAnchorKeywords(weakAnchorId);
  const weakFamily = anchorFamilyOf(weakKeywords, titleTermsOf(weak?.title ?? ""));
  const repFamily = anchorFamilyOf(rep.conceptKeywords ?? [], titleTermsOf(rep.title ?? ""));
  if (weakFamily && repFamily && weakFamily !== repFamily) {
    return { ok: false, reason: `concept family mismatch: ${weakFamily} anchor replaced by a ${repFamily} anchor` };
  }
  const repTokens = literalConceptTokens(rep);
  const overlap = weakKeywords.filter((k) => repTokens.has(k)).length;
  const sameFamily = Boolean(weakFamily && weakFamily === repFamily);
  if (overlap < 1 && !sameFamily) {
    // Fall back to the affected unit/page role concepts.
    const roleTokens = new Set<string>();
    for (const page of state.pages.filter((p) => p.sourceAnchors.includes(weakAnchorId) || p.sourceFormulaAnchors.includes(weakAnchorId))) {
      for (const w of titleTermsOf(page.title)) roleTokens.add(w);
    }
    for (const unit of state.learningUnitContract.units.filter((u) => (u.sourceAnchors ?? []).includes(weakAnchorId))) {
      for (const c of unit.newConcepts ?? []) for (const w of titleTermsOf(String(c))) roleTokens.add(w);
    }
    const roleOverlap = [...repTokens].filter((t) => roleTokens.has(t)).length;
    if (roleOverlap < 1) return { ok: false, reason: `no concept overlap between ${replacementId} and the weak anchor or its page/unit role` };
  }
  return { ok: true, reason: `compatible (${sameFamily ? `same ${weakFamily} family` : `${overlap} keyword overlap`}, strong replacement)` };
}

/** Build targeted repair requests for a rejected (unsupported) anchor (Fix 6). */
function rejectedAnchorRepairRequests(state: FinalGardenState, anchorId: string, instructions: string[]): RejectedAnchorRepairRequest[] {
  const affectedPages = state.pages.filter((p) => p.sourceAnchors.includes(anchorId) || p.sourceFormulaAnchors.includes(anchorId)).map((p) => p.rel);
  const affectedUnitIds = state.learningUnitContract.units.filter((u) => (u.sourceAnchors ?? []).includes(anchorId)).map((u) => u.id);
  const base = instructions.length ? instructions : [
    `Remove or replace the unsupported anchor ${anchorId} from the page and contract; reground on a valid canonical anchor.`,
    `If the page explanation depends on the unsupported claim, revise that passage to what the source supports.`,
  ];
  const targets: RejectedAnchorRepairRequest["targetKind"][] = ["unit_page", "learning_unit_contract", "source_anchor_ledger"];
  return targets.map((targetKind) => ({ targetKind, rejectedAnchorId: anchorId, affectedPages, affectedUnitIds, instructions: base }));
}

/** Rewrite every reference to `from` → `to` in page frontmatter, the contract,
 *  and visual specs. Returns the repo-relative files changed. */
function replaceAnchorReference(gardenDir: string, slug: string | undefined, from: string, to: string): string[] {
  const changed: string[] = [];
  const state = buildFinalGardenState(gardenDir, slug);
  for (const page of state.pages) {
    const content = readText(page.abs);
    if (content === undefined) continue;
    const { rawFrontmatter, body } = splitFrontmatter(content);
    let rawFm = rawFrontmatter;
    for (const key of ["sourceAnchors", "sourceFormulaAnchors"]) {
      const values = fmArray(rawFm, key);
      if (values.includes(from)) rawFm = setFmArrayLine(rawFm, key, values.map((v) => (v === from ? to : v)));
    }
    if (rawFm !== rawFrontmatter) {
      fs.writeFileSync(page.abs, `---\n${rawFm.replace(/\s+$/, "")}\n---\n\n${body.replace(/^\n+/, "")}`, "utf-8");
      changed.push(page.rel);
    }
  }
  const bd = path.join(gardenDir, ".breadboard");
  const contractPath = fs.existsSync(path.join(bd, "learning-unit-contract.json"))
    ? path.join(bd, "learning-unit-contract.json")
    : path.join(bd, "planning", "learning-unit-contract.json");
  if (fs.existsSync(contractPath)) {
    const contractJson = readJson<Record<string, unknown>>(contractPath, {});
    const units = Array.isArray(contractJson.learningUnits) ? contractJson.learningUnits as Array<Record<string, unknown>>
      : Array.isArray(contractJson.units) ? contractJson.units as Array<Record<string, unknown>> : [];
    let contractChanged = false;
    for (const unit of units) {
      const anchors = Array.isArray(unit.sourceAnchors) ? unit.sourceAnchors.map(String) : [];
      if (anchors.includes(from)) { unit.sourceAnchors = [...new Set(anchors.map((v) => (v === from ? to : v)))]; contractChanged = true; }
    }
    if (contractChanged) {
      fs.writeFileSync(contractPath, `${JSON.stringify(contractJson, null, 2)}\n`, "utf-8");
      changed.push(path.relative(gardenDir, contractPath).split(path.sep).join("/"));
    }
  }
  const visualsDir = path.join(bd, "visuals");
  if (fs.existsSync(visualsDir)) {
    for (const name of fs.readdirSync(visualsDir)) {
      if (!name.endsWith(".json")) continue;
      const abs = path.join(visualsDir, name);
      const text = readText(abs);
      if (text === undefined || !text.includes(from)) continue;
      let spec: Record<string, unknown>;
      try { spec = JSON.parse(text); } catch { continue; }
      const anchors = Array.isArray(spec.sourceAnchors) ? spec.sourceAnchors as Array<Record<string, unknown>> : [];
      let visualChanged = false;
      for (const a of anchors) for (const k of ["textAnchorId", "figureId", "equationId", "tableId"]) {
        if (String(a[k] ?? "") === from) { a[k] = to; visualChanged = true; }
      }
      if (visualChanged) {
        fs.writeFileSync(abs, `${JSON.stringify(spec, null, 2)}\n`, "utf-8");
        changed.push(`.breadboard/visuals/${name}`);
      }
    }
  }
  return changed;
}

/** Drop an anchor record from the ledger if nothing references it anymore. */
function removeUnusedAnchorRecord(gardenDir: string, slug: string | undefined, anchorId: string): boolean {
  const state = buildFinalGardenState(gardenDir, slug);
  const referenced = new Set<string>();
  for (const page of state.pages) for (const id of [...page.sourceAnchors, ...page.sourceFormulaAnchors, ...page.sourceVisualIds]) referenced.add(id);
  for (const unit of state.learningUnitContract.units) for (const id of unit.sourceAnchors ?? []) referenced.add(id);
  for (const v of state.visuals) for (const id of [...v.anchorIds, ...v.textAnchorIds]) referenced.add(id);
  if (referenced.has(anchorId)) return false;
  const ledgerPath = path.join(gardenDir, ".breadboard", "source-anchors.json");
  const ledger = readJson<Record<string, unknown>>(ledgerPath, {});
  const structural = Array.isArray(ledger.sourceStructuralAnchors) ? ledger.sourceStructuralAnchors as Array<Record<string, unknown>> : [];
  const next = structural.filter((a) => String(a.id ?? "") !== anchorId);
  if (next.length === structural.length) return false;
  ledger.sourceStructuralAnchors = next;
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf-8");
  return true;
}

/** Append an applied decision to the persistent anchor-decision log. */
function logAnchorDecision(gardenDir: string, applied: AppliedAnchorDecision): void {
  const p = path.join(gardenDir, ".breadboard", "anchor-critic-decisions.json");
  const existing = readJson<AppliedAnchorDecision[]>(p, []);
  const next = existing.filter((d) => d.anchorId !== applied.anchorId);
  next.push(applied);
  next.sort((a, b) => a.anchorId.localeCompare(b.anchorId));
  fs.writeFileSync(p, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
}

/**
 * Apply one ChatMock anchor decision to the artifacts (Fix 4). Confirms,
 * replaces, creates a better anchor, or rejects (keeping the anchor blocking).
 * Persists a decision-log entry so the evidence report can render it. The caller
 * must rebuild FinalGardenState and re-audit afterwards.
 */
export function applyAnchorCriticDecision(
  gardenDir: string,
  slug: string | undefined,
  decision: AnchorCriticDecision,
): AppliedAnchorDecision {
  const base: AppliedAnchorDecision = {
    anchorId: decision.anchorId,
    decision: decision.decision,
    applied: false,
    confidence: decision.confidence,
    reason: decision.reason,
    changed: [],
  };
  const validity = validateAnchorCriticDecision(decision);
  if (!validity.valid) {
    const rejected: AppliedAnchorDecision = { ...base, applied: false, invalidReason: validity.reason };
    logAnchorDecision(gardenDir, rejected);
    return rejected;
  }

  const stateNow = buildFinalGardenState(gardenDir, slug);
  const anchorNow = stateNow.sourceAnchors[decision.anchorId];

  if (decision.decision === "confirm") {
    // Fix 1: the confirmed excerpt must actually EXIST in the source markdown.
    const verification = verifySourceText(gardenDir, decision.confirmedExactText!, { sourceId: anchorNow?.sourceId, page: anchorNow?.page });
    if (!verification.ok) {
      const bad: AppliedAnchorDecision = { ...base, applied: false, verification, invalidReason: `confirmedExactText not found in source (${verification.matchType})` };
      logAnchorDecision(gardenDir, bad);
      return bad;
    }
    // Fix 2: and it must be RELEVANT to the anchor's meaning, not merely present.
    const relevance = verifySourceTextRelevance(
      { id: decision.anchorId, title: anchorNow?.title, kind: anchorNow?.kind, conceptKeywords: anchorNow?.conceptKeywords, semanticSummary: anchorNow?.semanticSummary },
      decision.confirmedExactText!,
    );
    if (!isRelevanceAcceptableForKind(relevance, anchorNow?.kind ?? "text_concept", decision.confidence)) {
      const bad: AppliedAnchorDecision = { ...base, applied: false, verification, relevance, invalidReason: `confirmedExactText found but does not support anchor (relevance: ${relevance.decision}; ${relevance.reason})` };
      logAnchorDecision(gardenDir, bad);
      return bad;
    }
    const ok = recordCriticAnchorConfirmation(gardenDir, {
      anchorId: decision.anchorId,
      confirmed: true,
      reason: decision.reason,
      confirmedExactText: decision.confirmedExactText,
    });
    const applied: AppliedAnchorDecision = { ...base, applied: ok, confirmedExactText: decision.confirmedExactText, verification, relevance, changed: ok ? [".breadboard/source-anchors.json"] : [] };
    logAnchorDecision(gardenDir, applied);
    return applied;
  }

  if (decision.decision === "replace") {
    const to = decision.replacementAnchorId!;
    // Fix 3: the replacement must be canonical AND semantically compatible.
    const semanticCompatibility = checkReplacementCompatibility(stateNow, decision.anchorId, to);
    if (!semanticCompatibility.ok) {
      const bad: AppliedAnchorDecision = { ...base, applied: false, replacementAnchorId: to, semanticCompatibility, invalidReason: `incompatible replacement: ${semanticCompatibility.reason}` };
      logAnchorDecision(gardenDir, bad);
      return bad;
    }
    // Fix 4: the replacement must HAVE source text/summary AND that text must be
    // relevant to the weak anchor's usage (not just family-compatible metadata).
    const rep = stateNow.sourceAnchors[to];
    const repText = rep.exactText ?? rep.semanticSummary ?? "";
    if (!repText.trim()) {
      const bad: AppliedAnchorDecision = { ...base, applied: false, replacementAnchorId: to, semanticCompatibility, invalidReason: `replacement ${to} has no source text or semantic summary to verify relevance` };
      logAnchorDecision(gardenDir, bad);
      return bad;
    }
    const relevance = verifySourceTextRelevance(
      { id: decision.anchorId, title: anchorNow?.title, kind: anchorNow?.kind, conceptKeywords: anchorNow?.conceptKeywords, semanticSummary: anchorNow?.semanticSummary },
      repText,
    );
    if (relevance.decision === "irrelevant") {
      const bad: AppliedAnchorDecision = { ...base, applied: false, replacementAnchorId: to, semanticCompatibility, relevance, invalidReason: `replacement text is not relevant to the weak anchor usage (${relevance.reason})` };
      logAnchorDecision(gardenDir, bad);
      return bad;
    }
    const changed = replaceAnchorReference(gardenDir, slug, decision.anchorId, to);
    removeUnusedAnchorRecord(gardenDir, slug, decision.anchorId);
    const applied: AppliedAnchorDecision = { ...base, applied: true, replacementAnchorId: to, semanticCompatibility, relevance, changed };
    logAnchorDecision(gardenDir, applied);
    return applied;
  }

  if (decision.decision === "create_better_anchor") {
    const better = decision.betterAnchor!;
    const kind: CanonicalSourceAnchorKind = better.kind === "text" ? "text_concept" : better.kind;
    // Fix 2: the proposed exact text must exist in the source markdown.
    const verification = verifySourceText(gardenDir, better.exactText, { sourceId: better.sourceId, page: better.page });
    if (!verification.ok) {
      const bad: AppliedAnchorDecision = { ...base, applied: false, verification, invalidReason: `betterAnchor.exactText not found in source (${verification.matchType})` };
      logAnchorDecision(gardenDir, bad);
      return bad;
    }
    // Fix 3: the proposed exact text must also be RELEVANT to the proposed
    // anchor's own title/summary/keywords, not merely a real sentence.
    const relevance = verifySourceTextRelevance(
      { id: better.id, title: better.title, kind, conceptKeywords: better.conceptKeywords, semanticSummary: better.semanticSummary },
      better.exactText,
    );
    if (relevance.decision !== "relevant") {
      const followUp: AppliedAnchorDecision = {
        ...base, applied: false, createdAnchorId: better.id, verification, relevance, followUpIssue: true,
        invalidReason: `betterAnchor exact text is in source but does not support the proposed anchor meaning (relevance: ${relevance.decision}; ${relevance.reason})`,
      };
      logAnchorDecision(gardenDir, followUp);
      return followUp;
    }
    // Fix 2: score deterministically WITHOUT any artificial confidence floor.
    const score = scoreAnchorEvidence({
      anchorId: better.id,
      title: better.title,
      kind,
      conceptKeywords: better.conceptKeywords,
      sourceId: better.sourceId,
      requestedPage: better.page ?? verification.page,
      paragraphs: sourceParagraphsWithSource(gardenDir),
    });
    if (score.confidence !== "high" && score.confidence !== "medium") {
      // Verified + relevant but the deterministic evidence is still weak.
      // Do NOT accept; route to another critic round (Fix 2/5).
      const followUp: AppliedAnchorDecision = {
        ...base, applied: false, createdAnchorId: better.id, verification, relevance, followUpIssue: true,
        invalidReason: `betterAnchor exact text is in source but evidence score is ${score.confidence} (${score.totalScore}); the anchor title/summary/keywords are not strongly supported`,
      };
      logAnchorDecision(gardenDir, followUp);
      return followUp;
    }
    const ledgerPath = path.join(gardenDir, ".breadboard", "source-anchors.json");
    const ledger = readJson<Record<string, unknown>>(ledgerPath, {});
    const structural = Array.isArray(ledger.sourceStructuralAnchors) ? ledger.sourceStructuralAnchors as Array<Record<string, unknown>> : [];
    if (!structural.some((a) => String(a.id ?? "") === better.id)) {
      structural.push({
        id: better.id,
        kind,
        title: better.title,
        page: better.page ?? verification.page ?? score.matchedPage,
        sourceId: better.sourceId,
        semanticSummary: better.semanticSummary,
        exactText: better.exactText,
        conceptKeywords: better.conceptKeywords,
        confidence: score.confidence, // true score, no floor
        evidence: evidenceFromScore(score),
        criticConfirmed: true,
        criticConfirmationReason: decision.reason,
        criticConfirmedExactText: better.exactText,
      });
    }
    ledger.sourceStructuralAnchors = structural;
    fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf-8");
    const changed = [".breadboard/source-anchors.json"];
    if (better.id !== decision.anchorId) {
      changed.push(...replaceAnchorReference(gardenDir, slug, decision.anchorId, better.id));
      removeUnusedAnchorRecord(gardenDir, slug, decision.anchorId);
    }
    const applied: AppliedAnchorDecision = { ...base, applied: true, betterAnchorId: better.id, createdAnchorId: better.id, verification, relevance, confidence: score.confidence, changed: [...new Set(changed)] };
    logAnchorDecision(gardenDir, applied);
    return applied;
  }

  // reject: keep the anchor blocking; produce targeted repair requests (Fix 6).
  const instructions = (decision.requiredRepairs ?? []).flatMap((r) => r.instructions);
  const rejectedRepairRequests = rejectedAnchorRepairRequests(stateNow, decision.anchorId, instructions);
  const rejected: AppliedAnchorDecision = {
    ...base, applied: true, requiredRepairs: decision.requiredRepairs,
    rejectedRepairRequests, affectedPages: rejectedRepairRequests[0]?.affectedPages ?? [],
  };
  logAnchorDecision(gardenDir, rejected);
  return rejected;
}

/** Fix 8: write the auditable source-anchor evidence report (md + json). Only
 *  covers GENERATED semantic anchors (those carrying an evidence-based
 *  confidence). Content is deterministic so it is idempotent across runs. */
function writeSourceAnchorEvidenceReport(
  gardenDir: string,
  registry: Record<string, CanonicalSourceAnchor>,
  replaced: Array<{ from: string; to: string }>,
  markChanged: (rel: string) => void,
): void {
  const anchors = Object.values(registry).filter((a) => a.confidence).sort((a, b) => a.id.localeCompare(b.id));
  const bd = path.join(gardenDir, ".breadboard");
  const hasDecisions = fs.existsSync(path.join(bd, "anchor-critic-decisions.json"));
  if (anchors.length === 0 && replaced.length === 0 && !hasDecisions) return;
  fs.mkdirSync(bd, { recursive: true });

  const row = (a: CanonicalSourceAnchor): Record<string, unknown> => ({
    anchor: a.id,
    confidence: a.confidence,
    totalScore: a.evidence?.totalScore ?? null,
    sourcePage: a.page ?? null,
    keywordHits: a.evidence?.keywordHits ?? [],
    missingKeywords: a.evidence?.missingKeywords ?? [],
    decision: a.evidence?.decision ?? null,
    criticConfirmed: a.criticConfirmed === true,
  });
  const registered = anchors.filter((a) => (a.confidence === "high" || a.confidence === "medium") && !a.criticConfirmed).map(row);
  const critic = anchors.filter((a) => a.confidence === "low" && !a.criticConfirmed).map(row);
  const unsupported = anchors.filter((a) => a.confidence === "unsupported" && !a.criticConfirmed).map(row);

  // ChatMock anchor decisions (Fix 8): confirmed / replaced / rejected sections.
  const decisions = readJson<AppliedAnchorDecision[]>(path.join(bd, "anchor-critic-decisions.json"), []);
  const decByAnchor = new Map(decisions.map((d) => [d.anchorId, d]));
  const confirmedRows = anchors
    .filter((a) => a.criticConfirmed)
    .map((a) => ({ anchor: a.id, decision: decByAnchor.get(a.id)?.decision ?? "confirm", confidence: a.confidence, confirmedText: a.criticConfirmedExactText ?? a.exactText ?? "", reason: decByAnchor.get(a.id)?.reason ?? a.criticConfirmationReason ?? "" }));
  const replacedRows = [
    ...replaced.map((r) => ({ from: r.from, to: r.to, reason: "deterministic equivalence (Fix 5)" })),
    ...decisions.filter((d) => d.applied && (d.decision === "replace" || (d.decision === "create_better_anchor" && d.betterAnchorId && d.betterAnchorId !== d.anchorId))).map((d) => ({ from: d.anchorId, to: d.replacementAnchorId ?? d.betterAnchorId ?? "", reason: d.reason })),
  ].filter((r) => r.to);
  const rejectedRows = decisions.filter((d) => d.decision === "reject" || (!d.applied && d.invalidReason)).map((d) => ({ anchor: d.anchorId, reason: d.invalidReason ? `invalid decision: ${d.invalidReason}` : d.reason, pages: (d.affectedPages ?? []).join(", ") }));

  // Fix 4/6: independent-verification row per decision (presence + relevance + compat).
  const verificationRows = decisions.map((d) => ({
    anchor: d.anchorId,
    decision: d.decision,
    applied: d.applied,
    sourceTextMatch: d.verification ? d.verification.matchType : (d.decision === "replace" ? "n/a" : "—"),
    relevance: d.relevance ? d.relevance.decision : "—",
    compatibility: d.semanticCompatibility ? (d.semanticCompatibility.ok ? "ok" : "incompatible") : "—",
    reason: d.invalidReason ?? d.reason ?? "",
  }));

  const json = { registered, lowConfidence: critic, unsupported, criticConfirmed: confirmedRows, replaced: replacedRows, rejected: rejectedRows, decisionVerification: verificationRows };
  const jsonRel = ".breadboard/source-anchor-evidence.json";
  const jsonContent = `${JSON.stringify(json, null, 2)}\n`;
  const jsonPath = path.join(bd, "source-anchor-evidence.json");
  if ((readText(jsonPath) ?? "") !== jsonContent) {
    fs.writeFileSync(jsonPath, jsonContent, "utf-8");
    markChanged(jsonRel);
  }

  const table = (rows: Array<Record<string, unknown>>): string[] => rows.length === 0
    ? ["| — | — | — | — | — | — |"]
    : rows.map((r) => `| ${r.anchor} | ${r.confidence} | ${r.totalScore ?? "—"} | ${r.sourcePage ?? "—"} | ${(r.keywordHits as string[]).join(" ") || "—"} | ${r.decision} |`);
  const header = ["| Anchor | Confidence | Evidence Score | Source Page | Keyword Hits | Decision |", "|---|---:|---:|---:|---|---|"];
  const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s).replace(/\|/g, "\\|").replace(/\n/g, " ");
  const md = [
    "# Source-Anchor Evidence",
    "",
    "Generated semantic anchors are canonical only when a source passage supports the anchor's title, summary, and intended use. Scored by keyword coverage, title overlap, page match, context specificity, and negative (wrong-family) evidence. Low-confidence anchors are sent to the ChatMock critic to confirm, replace, create a better anchor, or reject.",
    "",
    "## Registered Generated Anchors",
    "",
    ...header,
    ...table(registered),
    "",
    "## Low-Confidence / Critic-Reviewed Anchors",
    "",
    ...header,
    ...table(critic),
    "",
    "## Unsupported Anchors",
    "",
    ...header,
    ...table(unsupported),
    "",
    "## Critic-Confirmed Anchors",
    "",
    "| Anchor | Decision | Confidence | Confirmed Text | Reason |",
    "|---|---|---:|---|---|",
    ...(confirmedRows.length ? confirmedRows.map((r) => `| ${r.anchor} | ${r.decision} | ${r.confidence} | ${clip(r.confirmedText, 80)} | ${clip(r.reason, 80)} |`) : ["| — | — | — | — | — |"]),
    "",
    "## Replaced Anchors",
    "",
    "| Old Anchor | New Anchor | Reason |",
    "|---|---|---|",
    ...(replacedRows.length ? replacedRows.map((r) => `| ${r.from} | ${r.to} | ${clip(r.reason, 80)} |`) : ["| — | — | — |"]),
    "",
    "## Rejected Anchors",
    "",
    "| Anchor | Reason | Affected Pages |",
    "|---|---|---|",
    ...(rejectedRows.length ? rejectedRows.map((r) => `| ${r.anchor} | ${clip(r.reason, 80)} | ${clip(r.pages, 80)} |`) : ["| — | — | — |"]),
    "",
    "## Anchor Decision Verification",
    "",
    "| Anchor | Decision | Applied | Source Text Match | Relevance | Compatibility | Reason |",
    "|---|---|---:|---|---|---|---|",
    ...(verificationRows.length
      ? verificationRows.map((r) => `| ${r.anchor} | ${r.decision} | ${r.applied ? "yes" : "no"} | ${r.sourceTextMatch} | ${r.relevance} | ${r.compatibility} | ${clip(r.reason, 80)} |`)
      : ["| — | — | — | — | — | — | — |"]),
    "",
  ].join("\n");
  const mdRel = ".breadboard/source-anchor-evidence.md";
  const mdPath = path.join(bd, "source-anchor-evidence.md");
  if ((readText(mdPath) ?? "") !== md) {
    fs.writeFileSync(mdPath, md, "utf-8");
    markChanged(mdRel);
  }
}

/**
 * Rebuild every derived/reported artifact from the canonical state and repair
 * the mechanical drifts the audit detects. Idempotent: running it twice is a
 * no-op. Returns the files it changed and human-readable notes.
 */
export function reconcileFinalGardenState(gardenDir: string, slug?: string): ReconcileResult {
  const result: ReconcileResult = { changed: [], notes: [] };
  const bd = path.join(gardenDir, ".breadboard");
  const markChanged = (rel: string): void => { if (!result.changed.includes(rel)) result.changed.push(rel); };

  let state = buildFinalGardenState(gardenDir, slug);
  let unitsById = new Map(state.learningUnitContract.units.map((u) => [u.id, u]));
  const assignedSourceVisualsByPage = new Map<string, Array<Record<string, unknown>>>();
  for (const visual of readJson<Array<Record<string, unknown>>>(path.join(bd, "source-visuals.json"), [])) {
    if (String(visual.usageStatus ?? "") !== "assigned") continue;
    if (String(visual.cropStatus ?? "") !== "embedded") continue;
    if (!String(visual.croppedImagePath ?? "").trim()) continue;
    const pageRel = normalizePageRel(String(visual.assignedPageId ?? ""));
    if (!pageRel) continue;
    const list = assignedSourceVisualsByPage.get(pageRel) ?? [];
    list.push(visual);
    assignedSourceVisualsByPage.set(pageRel, list);
  }

  {
    const invalidRepair = repairInvalidSourceAnchorLabels(gardenDir, slug);
    for (const rel of invalidRepair.changed) markChanged(rel);
    for (const note of invalidRepair.notes) result.notes.push(note);
    if (invalidRepair.changed.length > 0) {
      state = buildFinalGardenState(gardenDir, slug);
      unitsById = new Map(state.learningUnitContract.units.map((u) => [u.id, u]));
    }
  }

  // (1) Register broad/structural anchors referenced by pages or the contract
  //     as first-class anchors — no implicit anchors.
  const anchorLedgerPath = path.join(bd, "source-anchors.json");
  const anchorLedger = readJson<Record<string, unknown>>(anchorLedgerPath, {});
  const registry = state.sourceAnchors;
  const referenced = new Set<string>();
  for (const page of state.pages) for (const id of [...page.sourceAnchors, ...page.sourceFormulaAnchors, ...page.sourceVisualIds]) referenced.add(id);
  for (const page of state.pages) {
    for (const formula of page.formulas) {
      if (formula.sourceAnchor) referenced.add(formula.sourceAnchor);
      if (formula.basedOnFormula) referenced.add(formula.basedOnFormula);
    }
  }
  for (const unit of state.learningUnitContract.units) for (const id of unit.sourceAnchors ?? []) referenced.add(id);
  const structural: Array<Record<string, unknown>> = Array.isArray(anchorLedger.sourceStructuralAnchors)
    ? [...(anchorLedger.sourceStructuralAnchors as Array<Record<string, unknown>>)]
    : [];
  const structuralIds = new Set(structural.map((a) => String(a.id ?? "")));
  const sourceId = String((Array.isArray(anchorLedger.sourceTextConceptAnchors) ? (anchorLedger.sourceTextConceptAnchors as Array<Record<string, unknown>>)[0]?.sourceId : "") ?? "");
  const sourceDocumentRefs = sourceDocumentAnchorRefs(gardenDir);
  let registeredAnchor = false;
  for (const id of referenced) {
    if (!isPlausibleSourceAnchorId(id)) continue;
    if (registry[id]) continue;
    const sourceDocument = sourceDocumentRefs.get(id);
    const kind = sourceDocument ? "guidance" : structuralKindFromId(id);
    if (!kind) continue; // only broad structural anchors are auto-registered
    if (structuralIds.has(id)) continue;
    const pageMatch = id.match(/\.P(\d+)\./);
    structural.push({
      id,
      kind,
      title: sourceDocument ? `Source document: ${sourceDocument.title}` : `Source ${kind} (page ${pageMatch ? pageMatch[1] : "?"})`,
      page: pageMatch ? Number(pageMatch[1]) : undefined,
      sourceId: sourceDocument?.sourceId || sourceId || undefined,
    });
    structuralIds.add(id);
    registeredAnchor = true;
    result.notes.push(`registered broad source anchor ${id} (${kind}) as first-class`);
  }
  if (registeredAnchor) {
    anchorLedger.sourceStructuralAnchors = structural;
    fs.writeFileSync(anchorLedgerPath, `${JSON.stringify(anchorLedger, null, 2)}\n`, "utf-8");
    markChanged(".breadboard/source-anchors.json");
    // Refresh registry so later steps resolve the new anchors.
    state = buildFinalGardenState(gardenDir, slug);
  }

  // (1b) Register/replace missing SEMANTIC anchors that the dictionary-based
  //      auto-registration above does not cover — e.g. "S1.P1.energy-bottleneck"
  //      whose slug is not a known structural token. Each is proven against the
  //      source, replaced with an equivalent canonical anchor, or left blocking
  //      (Fixes 1–4). Page frontmatter and the contract are kept in sync.
  {
    const anchorRepair = repairMissingCanonicalAnchors(gardenDir, slug);
    for (const rel of anchorRepair.changed) markChanged(rel);
    for (const note of anchorRepair.notes) result.notes.push(note);
    if (anchorRepair.changed.length > 0) {
      state = buildFinalGardenState(gardenDir, slug);
      unitsById = new Map(state.learningUnitContract.units.map((u) => [u.id, u]));
    }
  }

  // (2) Naturalize planner-scaffold zettel handles in the contract.
  const contractPath = fs.existsSync(path.join(bd, "learning-unit-contract.json"))
    ? path.join(bd, "learning-unit-contract.json")
    : path.join(bd, "planning", "learning-unit-contract.json");
  const contractJson = readJson<Record<string, unknown>>(contractPath, {});
  const contractUnitsRaw = Array.isArray(contractJson.learningUnits)
    ? (contractJson.learningUnits as Array<Record<string, unknown>>)
    : Array.isArray(contractJson.units)
      ? (contractJson.units as Array<Record<string, unknown>>)
      : [];
  const newHandlesByUnit = new Map<string, string[]>();
  let contractChanged = false;
  for (const unit of state.learningUnitContract.units) {
    if (!unitNeedsNaturalization(unit)) {
      newHandlesByUnit.set(unit.id, zettelHandlesForUnit(unit));
      continue;
    }
    const rawUnit = contractUnitsRaw.find((u) => String(u.id ?? "") === unit.id);
    const notes = Array.isArray(rawUnit?.zettelNotes) ? (rawUnit!.zettelNotes as Array<Record<string, unknown>>) : [];
    const taken = new Set<string>(notes.map((n) => String(n.handle ?? "")).filter((h) => isNaturalZettelHandle(h)));
    for (const note of notes) {
      const handle = String(note.handle ?? "");
      if (isNaturalZettelHandle(handle)) continue;
      const replacement = naturalizeHandle(handle, unit, taken);
      taken.add(replacement);
      note.handle = replacement;
      note.claim = `${replacement.replace(/-/g, " ")}.`.replace(/^\w/, (c) => c.toUpperCase());
      contractChanged = true;
      result.notes.push(`naturalized zettel handle "${handle}" → "${replacement}" (unit ${unit.id})`);
    }
    // Recompute atomic handles for the repaired unit.
    const repairedUnit: LearningUnitContract = { ...unit, zettelNotes: notes.map((n) => ({ handle: String(n.handle ?? ""), claim: String(n.claim ?? ""), connectedTo: Array.isArray(n.connectedTo) ? (n.connectedTo as string[]) : [] })) };
    newHandlesByUnit.set(unit.id, zettelHandlesForUnit(repairedUnit));
  }
  if (contractChanged) {
    fs.writeFileSync(contractPath, `${JSON.stringify(contractJson, null, 2)}\n`, "utf-8");
    markChanged(".breadboard/learning-unit-contract.json");
  }

  // (3) Per-page reconciliation: prune anchors to contract, relabel worked
  //     examples, sync tags to the repaired contract handles.
  const ledgerFamilies = ledgerFormulaFamilies(gardenDir);
  const familyToAnchorId = new Map<string, string>();
  for (const [id, fam] of ledgerFamilies) if (!familyToAnchorId.has(fam)) familyToAnchorId.set(fam, id);
  const groundedRequired: Array<{ pageRel: string; anchor: string }> = [];
  for (const page of state.pages) {
    const abs = page.abs;
    const content = readText(abs);
    if (content === undefined) continue;
    const { rawFrontmatter, body } = splitFrontmatter(content);
    let rawFm = rawFrontmatter;
    let nextBody = body;
    const unit = unitsById.get(page.learningUnitId);

    if (unit) {
      const allowed = new Set<string>([
        ...(unit.sourceAnchors ?? []),
        ...unit.sourceFigures.map((f) => f.id),
        ...unit.sourceFormulas.map((f) => f.id),
        ...unit.sourceTables.map((t) => t.id),
        ...state.learningUnitContract.assignments.filter((a) => a.assignedLearningUnitId === unit.id).map((a) => a.sourceArtifactId),
      ]);
      const keepAnchor = (id: string): boolean => id.startsWith("text-") || allowed.has(id);
      const prunedAnchors = page.sourceAnchors.filter(keepAnchor);
      const prunedFormula = page.sourceFormulaAnchors.filter(keepAnchor);
      if (prunedAnchors.length !== page.sourceAnchors.length) {
        rawFm = setFmArrayLine(rawFm, "sourceAnchors", prunedAnchors);
        result.notes.push(`${page.rel}: pruned page source anchors not sanctioned by unit ${unit.id}`);
      }
      if (prunedFormula.length !== page.sourceFormulaAnchors.length) {
        rawFm = setFmArrayLine(rawFm, "sourceFormulaAnchors", prunedFormula);
      }
      const newTags = newHandlesByUnit.get(unit.id);
      if (newTags && (newTags.length !== page.tags.length || newTags.some((t, i) => t !== page.tags[i]))) {
        rawFm = setFmArrayLine(rawFm, "tags", newTags);
        result.notes.push(`${page.rel}: synced tags to repaired contract handles for ${unit.id}`);
      }
    }

    const requiredFormulaAnchors = new Set<string>([
      ...(unit?.sourceFormulas ?? []).map((f) => f.id),
      ...(unit?.sourceAnchors ?? []),
    ]);
    const relabel = relabelWorkedExamples(rawFm, requiredFormulaAnchors);
    if (relabel.changed) {
      rawFm = relabel.rawFm;
      result.notes.push(`${page.rel}: relabeled worked-example formula(s) mislabeled as source_definition`);
    }
    // Reground formulas grounded to a semantically-wrong-family anchor (Fix 3).
    const reground = regroundMismatchedFormulas(rawFm, ledgerFamilies, familyToAnchorId);
    if (reground.changed) {
      rawFm = reground.rawFm;
      result.notes.push(`${page.rel}: regrounded formula(s) to the semantically compatible source anchor`);
    }
    // Ground a symbolic definition the page wrote but never grounded, when its
    // unit contract requires that formula anchor.
    if (unit) {
      const requiredFormulaIds = new Set<string>([
        ...unit.sourceFormulas.map((f) => f.id),
        ...state.learningUnitContract.assignments
          .filter((a) => a.assignedLearningUnitId === unit.id && /\.E\d+$/i.test(a.sourceArtifactId))
          .map((a) => a.sourceArtifactId),
      ]);
      const declared = new Set<string>([...page.sourceAnchors, ...fmArray(rawFm, "sourceFormulaAnchors")]);
      const grounding = groundOrphanRequiredFormulas(rawFm, requiredFormulaIds, declared, ledgerFamilies);
      if (grounding.grounded.length > 0) {
        rawFm = grounding.rawFm;
        for (const anchor of grounding.grounded) groundedRequired.push({ pageRel: page.rel, anchor });
        result.notes.push(`${page.rel}: grounded orphan definition to contract-required formula ${grounding.grounded.join(", ")}`);
      }
    }
    const definitionFormulaAnchors = sourceDefinitionFormulaAnchors(rawFm);
    const currentFormulaAnchors = fmArray(rawFm, "sourceFormulaAnchors");
    if (!sameStringArray(currentFormulaAnchors, definitionFormulaAnchors)) {
      rawFm = setFmArrayLine(rawFm, "sourceFormulaAnchors", definitionFormulaAnchors);
      result.notes.push(`${page.rel}: synchronized sourceFormulaAnchors to source-definition formula entries`);
    }
    const withAssignedVisuals = ensureAssignedSourceVisualEmbeds(nextBody, assignedSourceVisualsByPage.get(page.rel) ?? []);
    if (withAssignedVisuals !== nextBody) {
      nextBody = withAssignedVisuals;
      result.notes.push(`${page.rel}: restored assigned source visual crop(s)`);
    }
    const sanitizedBody = capVisibleSourceFigureBlocks(sanitizeLearnerSourceCommentary(nextBody));
    if (sanitizedBody !== nextBody) {
      nextBody = sanitizedBody;
      result.notes.push(`${page.rel}: sanitized public prose/source-figure density`);
    }

    if (rawFm !== rawFrontmatter || nextBody !== body) {
      fs.writeFileSync(abs, `---\n${rawFm.replace(/\s+$/, "")}\n---\n\n${nextBody.replace(/^\n+/, "")}`, "utf-8");
      markChanged(page.rel);
    }
  }

  // (3b) Make each metric calculator's formula anchors cover the metric
  //      families it actually manipulates (its inputs/outputs/targets), so the
  //      visual JSON and the page body agree on what the visual grounds in.
  for (const rel of reconcileMetricCalculatorAnchors(gardenDir)) {
    markChanged(rel);
    result.notes.push(`added context formula anchor to metric calculator on ${rel}`);
  }

  // (4) Regenerate section-index summaries from real child pages.
  state = buildFinalGardenState(gardenDir, slug);
  const sectionSummaries = reconcileSectionSummaries(gardenDir, state, unitsById);
  for (const rel of sectionSummaries) { markChanged(rel); result.notes.push(`regenerated section summary in ${rel}`); }

  // (4b) Populate exactText for used text anchors that have a matching source
  //      paragraph, so they point to real source text (Fix 7).
  {
    const populated = reconcileTextAnchorExactText(gardenDir);
    if (populated.length > 0) {
      markChanged(".breadboard/source-anchors.json");
      for (const id of populated) result.notes.push(`grounded text anchor ${id} to its source paragraph (exactText)`);
    }
  }

  // (4c) Drop debug failed-repairs from the exported garden (Fix 13).
  {
    const removed = removeDebugFailedRepairs(gardenDir);
    if (removed > 0) result.notes.push(`removed ${removed} debug failed-repair file(s) from the export`);
  }

  // (5) Reconcile Source Map caveats about now-available formulas.
  if (reconcileSourceMapCaveats(gardenDir)) {
    markChanged(".breadboard/planning/Source Map.md");
    result.notes.push("reconciled Source Map caveats about page-6 formula availability");
  }

  // (6) Repair-log provenance: attach targetKind and split shared changed files.
  if (fixRepairLogProvenance(gardenDir, result.changed, groundedRequired)) {
    markChanged(".breadboard/repair-log.json");
    result.notes.push("classified repair provenance by target kind and split shared changed files");
  }

  // (7) Regenerate Source Coverage as a pure projection of the final state.
  state = buildFinalGardenState(gardenDir, slug);
  const coveragePath = path.join(bd, "planning", "Source Coverage.md");
  const coverageBody = projectSourceCoverage(state);
  const existingCoverage = readText(coveragePath) ?? "";
  const { rawFrontmatter: coverageFm } = splitFrontmatter(existingCoverage);
  fs.mkdirSync(path.dirname(coveragePath), { recursive: true });
  fs.writeFileSync(coveragePath, coverageFm ? `---\n${coverageFm.replace(/\s+$/, "")}\n---\n\n${coverageBody}` : coverageBody, "utf-8");
  markChanged(".breadboard/planning/Source Coverage.md");

  return result;
}

/** Source paragraphs with the page number they appear under (from `# Page N`). */
function sourceParagraphsWithPages(gardenDir: string): Array<{ page: number; text: string }> {
  const files: Array<{ abs: string; rel: string }> = [];
  walkMarkdown(path.join(gardenDir, "sources"), "sources", files);
  const out: Array<{ page: number; text: string }> = [];
  for (const { abs, rel } of files) {
    if (/(^|\/)_index\.md$/i.test(rel)) continue;
    const text = readText(abs);
    if (text === undefined) continue;
    const body = splitFrontmatter(text).body;
    let page = 0;
    let buffer: string[] = [];
    const flush = (): void => {
      const para = buffer.join(" ").replace(/\s+/g, " ").trim();
      if (para.length >= 80) out.push({ page, text: para });
      buffer = [];
    };
    for (const line of body.split(/\r?\n/)) {
      const header = line.match(/^#{1,3}\s*Page\s+(\d+)\b/i);
      if (header) { flush(); page = Number.parseInt(header[1] ?? "0", 10); continue; }
      if (/^#{1,6}\s/.test(line)) { flush(); continue; }
      if (line.trim() === "") { flush(); continue; }
      buffer.push(line.trim());
    }
    flush();
  }
  return out;
}

/**
 * For each USED text anchor that lacks exactText, find the best-matching source
 * paragraph (by concept-keyword overlap) and record its verbatim excerpt, page,
 * and a semantic summary. Returns the anchor ids that were grounded (Fix 7).
 */
function reconcileTextAnchorExactText(gardenDir: string): string[] {
  const bd = path.join(gardenDir, ".breadboard");
  const anchorPath = path.join(bd, "source-anchors.json");
  const ledger = readJson<Record<string, unknown>>(anchorPath, {});
  const textAnchors = Array.isArray(ledger.sourceTextConceptAnchors) ? (ledger.sourceTextConceptAnchors as Array<Record<string, unknown>>) : [];
  if (textAnchors.length === 0) return [];
  const state = buildFinalGardenState(gardenDir);
  const used = new Set(state.sourceUsages.filter((u) => u.kind === "text_concept").map((u) => u.anchorId));
  const paragraphs = sourceParagraphsWithPages(gardenDir);
  if (paragraphs.length === 0) return [];
  const grounded: string[] = [];
  for (const anchor of textAnchors) {
    const id = String(anchor.id ?? "");
    if (!used.has(id)) continue;
    if (typeof anchor.exactText === "string" && anchor.exactText.trim()) continue;
    const keywords = (Array.isArray(anchor.conceptKeywords) ? anchor.conceptKeywords.map(String) : [])
      .map((k) => k.toLowerCase())
      .filter((k) => k.length >= 4 && !GENERIC_CONCEPT_WORDS.has(k));
    if (keywords.length === 0) continue;
    // The concept keywords joined form a distinctive phrase ("spike timing
    // dependent"). Hyphens are normalized so "Spike-Timing Dependent" matches.
    const norm = (t: string): string => t.toLowerCase().replace(/[-–]/g, " ");
    const phrase = keywords.slice(0, 3).join(" ");
    const isCitation = (t: string): boolean => /^\s*\[\d+\]/.test(t) || /\bvol\.\s*\d+|\bpp\.\s*\d+|\bdoi:|\barxiv\b|scholarpedia|google scho/i.test(t);
    const score = (p: { text: string }): number => {
      const n = norm(p.text);
      const kw = keywords.filter((k) => n.includes(k)).length;
      if (kw < 2) return 0;
      return kw + (phrase.length >= 8 && n.includes(phrase) ? 5 : 0);
    };
    // Prefer an explanatory paragraph (not a citation, not the whole abstract)
    // that names the concept, over any paragraph that merely mentions it.
    const scored = paragraphs
      .filter((p) => p.text.length >= 100 && p.text.length <= 900 && !isCitation(p.text) && score(p) > 0)
      .sort((a, b) => score(b) - score(a) || a.text.length - b.text.length);
    const best = scored[0] ?? paragraphs.filter((p) => !isCitation(p.text) && score(p) > 0).sort((a, b) => score(b) - score(a))[0];
    if (!best) continue;
    const bestScore = score(best);
    if (bestScore < 2) continue;
    anchor.exactText = best.text.slice(0, 500);
    if (!anchor.page && best.page) anchor.page = best.page;
    if (!anchor.semanticSummary || !String(anchor.semanticSummary).trim()) {
      anchor.semanticSummary = `The source text explains ${String(anchor.title ?? id)}.`;
    }
    grounded.push(id);
  }
  if (grounded.length === 0) return [];
  fs.writeFileSync(anchorPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf-8");
  return grounded;
}

export interface CriticTextAnchorExactTextRepairInput {
  sourceAnchorIds?: string[];
  pagePath?: string;
  evidence?: string;
  problem?: string;
}

function ledgerAnchorBuckets(ledger: Record<string, unknown>): Array<{ key: string; records: Array<Record<string, unknown>> }> {
  return [
    {
      key: "sourceTextConceptAnchors",
      records: Array.isArray(ledger.sourceTextConceptAnchors)
        ? ledger.sourceTextConceptAnchors as Array<Record<string, unknown>>
        : [],
    },
    {
      key: "sourceStructuralAnchors",
      records: Array.isArray(ledger.sourceStructuralAnchors)
        ? ledger.sourceStructuralAnchors as Array<Record<string, unknown>>
        : [],
    },
  ];
}

function updateLedgerBucket(ledger: Record<string, unknown>, bucket: { key: string; records: Array<Record<string, unknown>> }): void {
  ledger[bucket.key] = bucket.records;
}

/** Targeted critic repair for text/source-anchor exactText drift. The repair
 * uses the same scorer as canonical-anchor registration; it only rewrites the
 * ledger when the source passage reaches register-grade evidence. Unsupported
 * anchors remain blocking for the critic instead of being papered over. */
export function repairCriticSourceAnchorExactText(
  gardenDir: string,
  slug: string | undefined,
  input: CriticTextAnchorExactTextRepairInput,
): TargetedCriticRepairResult {
  const result: TargetedCriticRepairResult = { changed: [], notes: [], resolved: false };
  const ids = [...new Set((input.sourceAnchorIds ?? []).map((id) => String(id).trim()).filter(Boolean))];
  if (ids.length === 0) return result;

  const bd = path.join(gardenDir, ".breadboard");
  const anchorPath = path.join(bd, "source-anchors.json");
  const ledger = readJson<Record<string, unknown>>(anchorPath, {});
  const buckets = ledgerAnchorBuckets(ledger);
  const paragraphs = sourceParagraphsWithSource(gardenDir);
  if (paragraphs.length === 0) {
    result.notes.push("no source paragraphs available for exactText repair");
    return result;
  }

  let state = buildFinalGardenState(gardenDir, slug);
  let ledgerChanged = false;
  for (const id of ids) {
    const bucket = buckets.find((candidate) => candidate.records.some((record) => String(record.id ?? "") === id));
    const record = bucket?.records.find((candidate) => String(candidate.id ?? "") === id);
    const canonical = state.sourceAnchors[id];
    if (!record || !bucket || !canonical) {
      result.notes.push(`source anchor ${id} is not a ledger text/structural anchor`);
      continue;
    }
    if (canonical.kind === "formula" || canonical.kind === "figure" || canonical.kind === "table" || canonical.kind === "graph") {
      result.notes.push(`source anchor ${id} is a ${canonical.kind} anchor, not a text exactText repair target`);
      continue;
    }

    const keywords = (Array.isArray(record.conceptKeywords) ? record.conceptKeywords.map(String) : canonical.conceptKeywords ?? semanticAnchorKeywords(id))
      .map((keyword) => keyword.toLowerCase())
      .filter((keyword) => keyword.length >= 3 && !SEMANTIC_ANCHOR_STOPWORDS.has(keyword));
    const requestedPage = Number.isFinite(Number(record.page)) ? Number(record.page) : canonical.page ?? semanticAnchorPage(id);
    const score = scoreAnchorEvidence({
      anchorId: id,
      title: String(record.title ?? canonical.title ?? id),
      kind: (String(record.kind ?? canonical.kind) as CanonicalSourceAnchorKind) || canonical.kind,
      conceptKeywords: keywords,
      sourceId: String(record.sourceId ?? canonical.sourceId ?? ""),
      requestedPage,
      paragraphs,
    });

    if (score.decision === "register" && score.exactText.trim()) {
      const current = typeof record.exactText === "string" ? record.exactText.trim() : "";
      record.exactText = score.exactText;
      record.page = score.matchedPage ?? requestedPage;
      record.sourceId = score.sourceId || record.sourceId || canonical.sourceId;
      record.semanticSummary = `Source page ${score.matchedPage ?? record.page ?? "?"} supports ${score.keywordHits.join(", ") || String(record.title ?? id)}.`;
      record.conceptKeywords = keywords.length ? keywords : semanticAnchorKeywords(id);
      record.confidence = score.confidence;
      record.evidence = evidenceFromScore(score);
      updateLedgerBucket(ledger, bucket);
      ledgerChanged = true;
      result.resolved = true;
      result.notes.push(current === score.exactText.trim()
        ? `confirmed exactText for ${id} with ${score.confidence} evidence`
        : `replaced exactText for ${id} with source page ${score.matchedPage ?? "?"} passage (${score.confidence}, score ${score.totalScore})`);
      continue;
    }

    const replacement = pickStrongerExistingAnchor(
      id,
      keywords.length ? keywords : semanticAnchorKeywords(id),
      requestedPage,
      String(record.sourceId ?? canonical.sourceId ?? score.sourceId ?? ""),
      state.sourceAnchors,
      score.confidence,
    );
    if (replacement) {
      const changed = replaceAnchorReference(gardenDir, slug, id, replacement);
      removeUnusedAnchorRecord(gardenDir, slug, id);
      result.changed.push(...changed.filter((rel) => !result.changed.includes(rel)));
      result.resolved = true;
      result.notes.push(`replaced weak text anchor ${id} with stronger canonical anchor ${replacement}`);
      state = buildFinalGardenState(gardenDir, slug);
    } else {
      result.notes.push(`kept ${id} blocking: best source passage scored ${score.totalScore} (${score.confidence})`);
    }
  }

  if (ledgerChanged) {
    for (const bucket of buckets) updateLedgerBucket(ledger, bucket);
    fs.writeFileSync(anchorPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf-8");
    if (!result.changed.includes(".breadboard/source-anchors.json")) result.changed.push(".breadboard/source-anchors.json");
  }
  return result;
}

/** Remove failed-repair debug artifacts from a production export (Fix 13). */
function removeDebugFailedRepairs(gardenDir: string): number {
  const dir = path.join(gardenDir, ".breadboard", "debug", "failed-repairs");
  let count = 0;
  try {
    if (!fs.existsSync(dir)) return 0;
    count = fs.readdirSync(dir).filter((n) => !n.startsWith(".")).length;
    fs.rmSync(dir, { recursive: true, force: true });
    // Drop the parent debug dir too if it is now empty.
    const parent = path.join(gardenDir, ".breadboard", "debug");
    if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) fs.rmSync(parent, { recursive: true, force: true });
  } catch {
    // best effort
  }
  return count;
}

/**
 * A metric calculator that lets the learner manipulate, say, spike count must
 * anchor the spike-count formula it stands on. Add missing family anchors (as
 * `context`) to both the page body block and the spec file so the visual JSON
 * matches what the calculator actually uses.
 */
function reconcileMetricCalculatorAnchors(gardenDir: string): string[] {
  const bd = path.join(gardenDir, ".breadboard");
  const ledger = readJson<Array<Record<string, unknown>>>(path.join(bd, "source-visuals.json"), []);
  const familyToAnchor = new Map<string, Record<string, unknown>>();
  const familyOfId = new Map<string, string>();
  for (const v of ledger) {
    const id = String(v.sourceVisualId ?? "");
    if (!/\.E\d+$/i.test(id)) continue;
    const fam = formulaMetricFamily(String(v.caption ?? ""));
    if (!fam) continue;
    familyOfId.set(id, fam);
    if (!familyToAnchor.has(fam)) familyToAnchor.set(fam, v);
  }

  const changed: string[] = [];
  const mdFiles: Array<{ abs: string; rel: string }> = [];
  walkMarkdown(path.join(gardenDir, "learning"), "learning", mdFiles);
  for (const { abs, rel } of mdFiles) {
    if (/\/_index\.md$/i.test(rel)) continue;
    const content = readText(abs);
    if (content === undefined || !content.includes("```breadboard-visual")) continue;
    let body = content;
    let bodyChanged = false;
    const re = new RegExp(VISUAL_BLOCK_RE.source, "g");
    let match: RegExpExecArray | null;
    const rewrites: Array<{ from: string; to: string }> = [];
    while ((match = re.exec(content)) !== null) {
      let spec: Record<string, unknown>;
      try { spec = JSON.parse(match[1] ?? "{}"); } catch { continue; }
      if (String(spec.type ?? "") !== "metric_calculator") continue;
      // Families the page's own formula anchors sanction (plus the related
      // families a calculator may legitimately reference — efficiency uses
      // accuracy/energy/spike-count; energy uses spike-count). A calculator must
      // not manipulate a metric outside this set: a stray `convergence time`
      // output injected by a mutated anchor is scrubbed rather than anchored.
      const pageFormulaAnchors = fmArray(splitFrontmatter(content).rawFrontmatter, "sourceFormulaAnchors");
      const backed = new Set<string>();
      for (const id of pageFormulaAnchors) { const f = familyOfId.get(id); if (f) backed.add(f); }
      const allowed = new Set(backed);
      if (backed.has("efficiency")) { allowed.add("accuracy"); allowed.add("energy"); allowed.add("spike-count"); }
      if (backed.has("energy")) allowed.add("spike-count"); // mirror allowedVisualAnchorFamilies

      let specChanged = false;
      // Scrub metric labels whose family is recognized but not allowed (spurious).
      for (const key of ["conceptTargets", "inputs", "outputs"]) {
        const list = spec[key];
        if (!Array.isArray(list)) continue;
        const kept = list.filter((item) => { const f = formulaMetricFamily(String(item)); return !f || allowed.has(f); });
        if (kept.length !== list.length && kept.length > 0) { spec[key] = kept; specChanged = true; }
      }
      const anchors = (Array.isArray(spec.sourceAnchors) ? [...(spec.sourceAnchors as Array<Record<string, unknown>>)] : [])
        .filter((a) => { const f = familyOfId.get(String((a as Record<string, unknown>).equationId ?? "")); return !f || allowed.has(f); });
      if (Array.isArray(spec.sourceAnchors) && anchors.length !== spec.sourceAnchors.length) specChanged = true;
      const haveFamilies = new Set<string>();
      for (const a of anchors) {
        const id = String((a as Record<string, unknown>).equationId ?? "");
        const fam = familyOfId.get(id);
        if (fam) haveFamilies.add(fam);
      }
      const wanted = new Set<string>();
      for (const key of ["conceptTargets", "inputs", "outputs"]) {
        const list = spec[key];
        if (Array.isArray(list)) for (const item of list) { const f = formulaMetricFamily(String(item)); if (f && allowed.has(f)) wanted.add(f); }
      }
      for (const fam of wanted) {
        if (haveFamilies.has(fam)) continue;
        const anchor = familyToAnchor.get(fam);
        if (!anchor) continue;
        anchors.push({
          description: String(anchor.caption ?? ""),
          sourceId: String(anchor.sourceId ?? ""),
          page: Number(anchor.pageNumber) || undefined,
          equationId: String(anchor.sourceVisualId ?? ""),
          role: "context",
          reason: `The calculator manipulates ${fam.replace(/-/g, " ")}, so it references the ${fam.replace(/-/g, " ")} source formula as context.`,
        });
        haveFamilies.add(fam);
        specChanged = true;
      }
      if (specChanged) {
        spec.sourceAnchors = anchors;
        const rebuilt = "```breadboard-visual\n" + JSON.stringify(spec, null, 2) + "\n```";
        rewrites.push({ from: match[0], to: rebuilt });
        // Keep the spec file in sync.
        const specFile = path.join(bd, "visuals", `${String(spec.id ?? "")}.json`);
        if (fs.existsSync(specFile)) {
          const onDisk = readJson<Record<string, unknown>>(specFile, {});
          onDisk.sourceAnchors = anchors;
          fs.writeFileSync(specFile, `${JSON.stringify(onDisk, null, 2)}\n`, "utf-8");
        }
      }
    }
    for (const { from, to } of rewrites) { body = body.replace(from, to); bodyChanged = true; }
    if (bodyChanged) { fs.writeFileSync(abs, body, "utf-8"); changed.push(rel); }
  }
  return changed;
}

function reconcileSectionSummaries(
  gardenDir: string,
  state: FinalGardenState,
  unitsById: Map<string, LearningUnitContract>,
): string[] {
  const changed: string[] = [];
  const sectionOrder = state.sections
    .filter((s) => /\/_index\.md$/i.test(s.rel) && s.rel !== "learning/_index.md")
    .sort((a, b) => a.rel.localeCompare(b.rel));
  for (let i = 0; i < sectionOrder.length; i += 1) {
    const section = sectionOrder[i];
    const abs = path.join(gardenDir, section.rel);
    const content = readText(abs);
    if (content === undefined) continue;
    const { rawFrontmatter, body } = splitFrontmatter(content);
    const prose = teachingProseOnly(body).replace(/^#.*$/gm, " ").trim();
    if (!isTemplateSectionSummary(prose)) continue;

    // Gather child pages from disk (folder siblings), ordered by subsection.
    const dir = path.dirname(abs);
    const childRels = state.pages
      .filter((p) => path.dirname(path.join(gardenDir, p.rel)) === dir)
      .sort((a, b) => a.subsectionNumber.localeCompare(b.subsectionNumber, undefined, { numeric: true }));
    const childTitles = childRels.map((p) => p.title);
    const childRoles = childRels.map((p) => unitsById.get(p.learningUnitId)?.role ?? p.learningUnitRole).filter(Boolean);
    const keyAnchors = [...new Set(childRels.flatMap((p) => [...p.sourceAnchors, ...p.sourceFormulaAnchors]))];
    const summary = generateSectionSummary({
      sectionTitle: section.title,
      childPageTitles: childTitles,
      childUnitRoles: childRoles,
      keySourceAnchors: keyAnchors,
      previousSectionTitle: sectionOrder[i - 1]?.title,
      nextSectionTitle: sectionOrder[i + 1]?.title,
    });
    const links = body.split(/\r?\n/).filter((line) => /\[\[learning\//i.test(line));
    const title = rawFrontmatter.match(/^title:\s*(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "") || section.title;
    const nextBody = [`# ${title}`, "", summary, "", ...links].join("\n").replace(/\n{3,}/g, "\n\n");
    fs.writeFileSync(abs, `---\n${rawFrontmatter.replace(/\s+$/, "")}\n---\n\n${nextBody}\n`, "utf-8");
    changed.push(section.rel);
  }
  return changed;
}

function reconcileSourceMapCaveats(gardenDir: string): boolean {
  const abs = path.join(gardenDir, ".breadboard", "planning", "Source Map.md");
  const content = readText(abs);
  if (content === undefined) return false;
  const next = content
    .replace(
      /The exact formulas, variables, table entries, graph values, experimental protocol details, datasets, and architecture specifications are not fully visible in the provided content\./g,
      "Figure, table, and formula captions plus the six page-6 metric formulas (S1.P6.E1-E6) were extracted as source anchors and are taught symbolically on the metric pages; some raw table values and experimental protocol details remain outside the provided content.",
    )
    .replace(
      /Formula captions are available, but mathematical notation and variable definitions are not visible\./g,
      "Formula captions and the six page-6 metric relationships were reconstructed from the extracted formula anchors and are taught symbolically on the metric pages.",
    )
    .replace(
      /full page text, table values, and formula notation are not included\./g,
      "the page-6 formula notation was extracted as anchors S1.P6.E1 to S1.P6.E6 and is taught on the metric pages, while some raw table values remain outside the prompt.",
    );
  if (next === content) return false;
  fs.writeFileSync(abs, next, "utf-8");
  return true;
}

function fixRepairLogProvenance(
  gardenDir: string,
  reconcileChangedFiles: string[],
  groundedRequired: Array<{ pageRel: string; anchor: string }> = [],
): boolean {
  const abs = path.join(gardenDir, ".breadboard", "repair-log.json");
  const raw = readJson<Record<string, unknown>>(abs, {});
  if (!Array.isArray(raw.repairs)) return false;
  const repairs = raw.repairs as Array<Record<string, unknown>>;

  // Clear unresolved fulfillment errors that reconcile has since fixed by
  // grounding the missing formula anchor, so a stale "unresolved" entry from the
  // repair loop does not block a garden the finalizer has repaired.
  const groundedByPage = new Map<string, Set<string>>();
  for (const { pageRel, anchor } of groundedRequired) {
    (groundedByPage.get(pageRel) ?? groundedByPage.set(pageRel, new Set()).get(pageRel)!).add(anchor);
  }
  let clearedUnresolved = false;
  for (const repair of repairs) {
    const anchors = groundedByPage.get(String(repair.pagePath ?? ""));
    if (!anchors) continue;
    const errors = Array.isArray(repair.unresolvedValidationErrors) ? repair.unresolvedValidationErrors.map(String) : [];
    const kept = errors.filter((e) => !(/missing contract source formula\s+(\S+)/i.test(e) && [...anchors].some((a) => e.includes(a))));
    if (kept.length !== errors.length) {
      repair.unresolvedValidationErrors = kept;
      if (kept.length === 0 && String(repair.result ?? "") === "unresolved") repair.result = "resolved";
      clearedUnresolved = true;
    }
  }

  // Which visual ids each learner page owns (frontmatter visualIds + embedded
  // blocks) — a unit_page repair may only claim its own page's visual specs.
  const state = buildFinalGardenState(gardenDir);
  const ownedVisualsByPage = new Map<string, Set<string>>();
  for (const page of state.pages) {
    const owned = new Set<string>(page.visualIds);
    for (const spec of embeddedVisualSpecs(page.body)) { const id = String(spec.id ?? ""); if (id) owned.add(id); }
    ownedVisualsByPage.set(page.rel, owned);
  }
  const pageOwnsVisualFile = (pagePath: string, file: string): boolean => {
    const id = file.match(/^\.breadboard\/visuals\/(.+)\.json$/)?.[1] ?? "";
    return Boolean(id) && (ownedVisualsByPage.get(pagePath)?.has(id) ?? false);
  };

  const sectionIndexFiles = new Set<string>();
  const contractFiles = new Set<string>();
  const coverageFiles = new Set<string>();
  const planningFiles = new Set<string>();
  const affectedUnits = new Set<string>();
  let changed = clearedUnresolved;

  for (const repair of repairs) {
    const entry: RepairLogEntry = {
      unitId: repair.unitId ? String(repair.unitId) : undefined,
      pagePath: repair.pagePath ? String(repair.pagePath) : undefined,
      sectionPath: repair.sectionPath ? String(repair.sectionPath) : undefined,
      changedFiles: Array.isArray(repair.changedFiles) ? repair.changedFiles.map(String) : [],
      failureTypes: Array.isArray(repair.failureTypes) ? repair.failureTypes.map(String) : [],
    };
    const target = classifyRepairTargetKind(entry);
    if (repair.targetKind !== target) { repair.targetKind = target; changed = true; }
    if (repair.unitId) affectedUnits.add(String(repair.unitId));

    if (target === "unit_page") {
      const finalPage = resolveRepairPage(entry, state.pages);
      const oldPagePath = entry.pagePath ?? "";
      if (finalPage && entry.pagePath !== finalPage.rel) {
        const finalSectionPath = pageSectionPathFromRel(finalPage.rel);
        repair.pagePath = finalPage.rel;
        repair.sectionPath = finalSectionPath;
        repair.changedFiles = entry.changedFiles.map((file) => file === oldPagePath ? finalPage.rel : file);
        entry.pagePath = finalPage.rel;
        entry.sectionPath = finalSectionPath;
        entry.changedFiles = Array.isArray(repair.changedFiles) ? repair.changedFiles.map(String) : [];
        changed = true;
      }
      if (entry.failureTypes.some((type) => PAGE_PROSE_REPAIR_TYPES.has(type))) {
        const validation = finalPage ? pageProseValidation(finalPage) : "fail";
        if (repair.naturalProseValidation !== validation) {
          repair.naturalProseValidation = validation;
          changed = true;
        }
      }
      const pagePath = entry.pagePath ?? "";
      const kept: string[] = [];
      for (const file of entry.changedFiles) {
        if (file === pagePath) { kept.push(file); continue; }
        // Only the page's own visual specs stay on a unit_page entry.
        if (file.startsWith(".breadboard/visuals/")) { if (pageOwnsVisualFile(pagePath, file)) kept.push(file); continue; }
        if (/\/_index\.md$/.test(file)) sectionIndexFiles.add(file);
        else if (file === ".breadboard/learning-unit-contract.json") contractFiles.add(file);
        else if (file === ".breadboard/planning/Source Coverage.md" || file === ".breadboard/source-anchors.json") coverageFiles.add(file);
        else if (file.startsWith(".breadboard/planning/") || file === "learning/Learning Map.md") planningFiles.add(file);
        // Anything else was a spurious attribution and is dropped.
      }
      if (kept.length !== entry.changedFiles.length) { repair.changedFiles = kept; changed = true; }
    }
  }

  // Aggregate provenance entries for the shared/global changes. Each carries the
  // full repair-entry shape the finalizer's verification and report writer read.
  const base = {
    unitId: "finalizer",
    pagePath: "(finalizer hygiene)",
    sectionPath: "",
    validationErrors: [] as string[],
    requiredChanges: [] as string[],
    repairType: "contract_driven_revision",
    result: "resolved",
    unresolvedValidationErrors: [] as string[],
    repairedAt: new Date().toISOString(),
    executorAttempted: [] as string[],
    executorUsed: "finalizer_hygiene",
    executorPreference: "deterministic_allowed",
    modelRepairStatus: "not_applicable",
    naturalProseValidation: "not_applicable",
  };
  const aggregate: Array<Record<string, unknown>> = [];
  for (const file of sectionIndexFiles) {
    aggregate.push({ ...base, targetKind: "section_index", affectedSectionId: file.replace(/\/_index\.md$/, ""), changedFiles: [file], failureTypes: ["section_index_prose"] });
  }
  if (contractFiles.size > 0) {
    aggregate.push({ ...base, targetKind: "contract", affectedUnitIds: [...affectedUnits], changedFiles: [...contractFiles], failureTypes: ["contract_fulfillment"] });
  }
  if (coverageFiles.size > 0) {
    aggregate.push({ ...base, targetKind: "source_coverage", changedFiles: [...coverageFiles], failureTypes: ["source_text_anchor"] });
  }
  if (planningFiles.size > 0) {
    aggregate.push({ ...base, targetKind: "planning_doc", changedFiles: [...planningFiles], failureTypes: ["section_semantics"] });
  }

  // A single global_finalization entry records the reconcile pass itself.
  if (reconcileChangedFiles.length > 0) {
    aggregate.push({ ...base, targetKind: "global_finalization", changedFiles: [...new Set(reconcileChangedFiles)], failureTypes: ["global_finalization"] });
  }

  if (aggregate.length > 0) {
    // Replace any prior finalizer-hygiene aggregates (idempotency).
    const nonAggregate = repairs.filter((r) => String(r.executorUsed ?? "") !== "finalizer_hygiene");
    raw.repairs = [...nonAggregate, ...aggregate];
    changed = true;
  }
  if (!changed) return false;
  fs.writeFileSync(abs, `${JSON.stringify(raw, null, 2)}\n`, "utf-8");
  return true;
}
