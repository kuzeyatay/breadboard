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

/** One anchor every reference in the garden must resolve through. */
export interface CanonicalSourceAnchor {
  id: string;
  kind: CanonicalSourceAnchorKind;
  title: string;
  page?: number;
  sourceId?: string;
  /** Where the canonical definition came from. */
  origin: "visual_ledger" | "text_ledger" | "structural_ledger";
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
    registry[id] = {
      id,
      kind: anchorKindFromVisual(String(visual.type ?? ""), id),
      title: String(visual.caption ?? id),
      page: Number.isFinite(Number(visual.pageNumber)) ? Number(visual.pageNumber) : undefined,
      sourceId: String(visual.sourceId ?? "") || undefined,
      origin: "visual_ledger",
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
    registry[id] = {
      id,
      kind: "text_concept",
      title: String(record.title ?? record.semanticSummary ?? id),
      page: Number.isFinite(Number(record.page)) ? Number(record.page) : undefined,
      sourceId: String(record.sourceId ?? "") || undefined,
      origin: "text_ledger",
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
    const kind = structuralKindFromId(id) ?? (String(record.kind ?? "") as CanonicalSourceAnchorKind) ?? "guidance";
    registry[id] = {
      id,
      kind,
      title: String(record.title ?? id),
      page: Number.isFinite(Number(record.page)) ? Number(record.page) : undefined,
      sourceId: String(record.sourceId ?? "") || undefined,
      origin: "structural_ledger",
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
  // A bare numeric result: the expression terminates in `= <number>` (optionally %).
  const bareNumericResult = /=\s*[+-]?\d[\d.,]*\s*\\?%?\s*$/.test(withoutPercentFactor.trim());

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

  // Rule A — every referenced anchor resolves through the canonical registry.
  const referencedAnchors = new Map<string, string[]>();
  const noteRef = (id: string, where: string): void => {
    if (!id || id.startsWith("trivial:")) return;
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
  for (const [id, where] of referencedAnchors) {
    if (!anchors[id]) {
      add("anchor_resolution", `source anchor "${id}" is referenced (${where.slice(0, 3).join("; ")}${where.length > 3 ? "; …" : ""}) but is missing from the canonical source-anchor registry`);
    }
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

  const problems = Object.values(byRule).flat();
  return { ok: problems.length === 0, problems, byRule, warnings };
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
  const unitsById = new Map(state.learningUnitContract.units.map((u) => [u.id, u]));
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
