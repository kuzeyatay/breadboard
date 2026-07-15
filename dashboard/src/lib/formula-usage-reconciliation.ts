// Canonical formula-usage reconciliation.
//
// Formula assignment is represented in several final-artifact projections. This
// module treats learner pages + the Learning Unit Contract + canonical source
// evidence + final visual JSON as authoritative, then rebuilds page metadata,
// the source-visual usage ledger, and Source Coverage in one rollback-backed
// transaction. Source Coverage is never read as evidence.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  auditFinalGardenState,
  buildFinalGardenState,
  formulaStructuralKind,
  type FinalGardenPage,
  type FinalGardenState,
} from "./final-garden-state.ts";
import type { FinalRepairIssue } from "./garden-finalize.ts";
import type { LearningUnitContract } from "./learning-unit-contract.ts";
import { formulaMetricFamily, isTrivialFormulaFragment } from "./learn-utils.ts";
import {
  assertFormulaAssignmentCompatible,
  buildFormulaIdentityRepairPacket,
  buildFormulaIdentityRegistry,
  findCompatibleFormulaAssignments,
  formulaFamiliesForAssignmentContext,
  formulaIdentityRegistryPath,
  legacyFormulaFamily,
  normalizeFormulaSemanticFamily,
  renderFormulaIdentityRegistry,
  verifyCanonicalFormulaIdentity,
  verifyFormulaIdentityRepairDecision,
  type CanonicalFormulaIdentity,
  type ContractFormulaAssignmentProvenance,
  type FormulaIdentityConflict,
  type FormulaIdentityRepairDecision,
  type FormulaIdentityRepairPacket,
} from "./formula-identity.ts";
import {
  deriveUnitFormulaRequirement,
  validateFormulaAssignment,
} from "./formula-assignment.ts";

export type CanonicalFormulaUsageMode =
  | "source_definition"
  | "source_derived_definition"
  | "worked_example"
  | "text_explanation"
  | "interactive_grounding"
  | "intentionally_omitted";

export type CanonicalFormulaCoverageMode =
  | "Explained as Text Formulas"
  | "Embedded Source Crops"
  | "Used as Interactive Grounding"
  | "Intentionally Omitted"
  | "Missing or Misplaced";

export interface FormulaMetadataEntry {
  kind: string;
  text: string;
  normalizedText?: string;
  groundingStatus?: string;
  justification?: string;
  sourceAnchor?: string;
  sourceAnchorTitle?: string;
  basedOnFormula?: string;
  formulaFamily?: string;
  exampleGroupId?: string;
  matchReason?: string;
  confidence?: string;
}

export type CanonicalFormulaUsage = {
  formulaAnchorId: string;
  unitId: string;
  pagePath: string;
  formulaFamily?: string;
  requiredByContract: boolean;
  modes: CanonicalFormulaUsageMode[];
  definitionEntry?: {
    text: string;
    kind: "source_definition" | "source_derived_definition";
    sourceAnchor: string;
  };
  workedExamples: {
    text: string;
    basedOnFormula?: string;
    formulaFamily?: string;
    exampleGroupId?: string;
  }[];
  sourceLedgerUsage?: {
    conceptUsage?: string;
    cropStatus?: string;
    usageStatus?: string;
  };
  coverageMode?: CanonicalFormulaCoverageMode;
  problems: string[];
};

export type CanonicalFormulaUsageIndex = {
  byAnchorId: Record<string, CanonicalFormulaUsage[]>;
  byPagePath: Record<string, CanonicalFormulaUsage[]>;
  unresolvedAssignments: {
    unitId: string;
    pagePath?: string;
    formulaAnchorId: string;
    reason: string;
  }[];
  problems: string[];
};

export type ContractFormulaCompatibilityResult = {
  compatible: boolean;
  formulaAnchorId: string;
  unitId: string;
  pagePath: string;
  formulaFamily?: string;
  unitConceptFamilies: string[];
  titleOverlapScore: number;
  keywordCoverageScore: number;
  semanticCompatibilityScore: number;
  reason: string;
};

export type ContractFormulaReconciliationResult = {
  formulaAnchorId: string;
  unitId: string;
  pagePath: string;
  action:
    | "already_present"
    | "added_existing_definition"
    | "linked_existing_definition"
    | "moved_contract_assignment"
    | "needs_chatmock"
    | "unsupported";
  changed: boolean;
  reason: string;
};

export type WorkedExampleLineageDecision =
  | {
      action: "assign_lineage";
      entryIndex: number;
      basedOnFormula: string;
      formulaFamily: string;
      confidence: "high";
      reason: string;
    }
  | { action: "reclassify_conceptual_helper"; entryIndex: number; reason: string }
  | { action: "remove_metadata_only"; entryIndex: number; reason: string }
  | {
      action: "needs_chatmock";
      entryIndex: number;
      candidateDefinitionAnchors: string[];
      reason: string;
    };

export type FormulaUsageRepairPacket = {
  pagePath: string;
  pageTitle: string;
  unitId: string;
  issue:
    | "contract_formula_compatibility"
    | "missing_source_definition"
    | "ambiguous_worked_example_lineage";
  pageFormulaEntries: FormulaMetadataEntry[];
  relevantBodyExcerpts: string[];
  contractRequiredFormulas: {
    anchorId: string;
    title: string;
    exactText?: string;
    semanticSummary?: string;
    formulaFamily?: string;
  }[];
  candidateDefinitions: {
    anchorId: string;
    text: string;
    formulaFamily?: string;
    compatibilityReason: string;
  }[];
  allowedActions: (
    | "attach_existing_formula"
    | "assign_worked_example_lineage"
    | "reclassify_as_conceptual_helper"
    | "remove_metadata_entry"
    | "move_contract_assignment"
    | "reject_formula_usage"
  )[];
};

export type FormulaUsageRepairDecision = {
  action: FormulaUsageRepairPacket["allowedActions"][number];
  entryIndex?: number;
  formulaAnchorId?: string;
  targetUnitId?: string;
  reason: string;
};

export type FormulaUsageRepairModel = (
  packet: FormulaUsageRepairPacket,
) => Promise<FormulaUsageRepairDecision | null> | FormulaUsageRepairDecision | null;

export type FormulaIdentityRepairModel = (
  packet: FormulaIdentityRepairPacket,
) => Promise<FormulaIdentityRepairDecision | null> | FormulaIdentityRepairDecision | null;

export type FormulaProjectionReconciliationResult = {
  passed: boolean;
  formulaIdentitiesVerified: number;
  registryFamilyCorrections: number;
  contractAssignmentsChecked: number;
  contractAssignmentsRepaired: number;
  contractAnchorLeaksRemoved: number;
  assignmentsReplaced: number;
  assignmentsMoved: number;
  incompatibleAssignmentsFound: number;
  ambiguousAssignmentsSentToChatMock: number;
  identityConflicts: FormulaIdentityConflict[];
  definitionsAdded: number;
  definitionsLinked: number;
  wrongFamilyPageEntriesRepaired: number;
  workedExamplesRelined: number;
  workedExamplesReclassified: number;
  metadataEntriesRemoved: number;
  orphanWorkedExamplesBefore: number;
  chatMockCallsUsed: number;
  sourceFormulaAnchorArraysUpdated: string[];
  sourceLedgerRecordsUpdated: string[];
  sourceCoverageRegenerated: boolean;
  unresolvedIssues: FinalRepairIssue[];
  changedFiles: string[];
  stateFingerprintBefore: string;
  stateFingerprintAfter: string;
  rolledBack: boolean;
  formulaLedgerModesChanged: number;
  sourceCoverageEntriesRegenerated: number;
  remainingFormulaFamilyMismatches: number;
  rollbackReason?: string;
};

interface FormulaProjectionAuditIssue {
  id: string;
  subproblems: string[];
  pagePath?: string;
  unitId?: string;
  anchorId?: string;
}

interface ParsedMarkdown {
  rawFrontmatter: string;
  body: string;
  hadFrontmatter: boolean;
}

const FORMULA_ID_RE = /^S\d+\.P\d+\.E\d+$/i;
const KNOWN_FAMILIES = [
  "accuracy", "latency", "energy", "efficiency", "spike-count", "convergence",
  "loss", "gradient", "probability", "threshold",
] as const;
const STOP_WORDS = new Set([
  "the", "and", "for", "from", "with", "into", "that", "this", "where", "when",
  "which", "what", "does", "how", "source", "formula", "equation", "define", "defined",
  "used", "using", "page", "unit", "learning", "text", "first", "identified", "chosen",
]);

function readJson<T>(abs: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(abs, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function parseMarkdown(content: string): ParsedMarkdown {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { rawFrontmatter: "", body: content, hadFrontmatter: false };
  return { rawFrontmatter: match[1] ?? "", body: match[2] ?? "", hadFrontmatter: true };
}

function joinMarkdown(rawFrontmatter: string, body: string): string {
  return `---\n${rawFrontmatter.replace(/\s+$/, "")}\n---\n\n${body.replace(/^\n+/, "")}`;
}

function unquote(value: string): string {
  const text = value.trim();
  if (text.startsWith('"') && text.endsWith('"')) {
    try { return JSON.parse(text); } catch { return text.slice(1, -1); }
  }
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1);
  return text;
}

function jsonScalar(value: string): string {
  return JSON.stringify(String(value).replace(/\r/g, ""));
}

export function parseFormulaMetadataEntries(rawFm: string): FormulaMetadataEntry[] {
  const entries: FormulaMetadataEntry[] = [];
  let active = false;
  let current: FormulaMetadataEntry | null = null;
  for (const line of rawFm.split(/\r?\n/)) {
    if (!active) {
      if (/^formulas:\s*/.test(line)) active = true;
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
    if (nested && current) {
      (current as unknown as Record<string, string>)[nested[1]] = unquote(nested[2] ?? "");
    }
  }
  return entries.filter((entry) => entry.text.trim() || entry.kind.trim());
}

function serializeFormulaMetadata(entries: FormulaMetadataEntry[]): string {
  const lines = ["formulas:"];
  for (const entry of entries) {
    lines.push(`  - kind: ${jsonScalar(entry.kind || "conceptual_helper")}`);
    lines.push(`    text: ${jsonScalar(entry.text)}`);
    for (const key of [
      "normalizedText", "groundingStatus", "justification", "sourceAnchor",
      "sourceAnchorTitle", "basedOnFormula", "formulaFamily", "exampleGroupId", "matchReason",
    ] as const) {
      const value = entry[key];
      if (value) lines.push(`    ${key}: ${jsonScalar(value)}`);
    }
    if (entry.confidence) {
      lines.push(`    confidence: ${/^[0-9.]+$/.test(entry.confidence) ? entry.confidence : jsonScalar(entry.confidence)}`);
    }
  }
  return lines.join("\n");
}

function replaceFormulaMetadata(rawFm: string, entries: FormulaMetadataEntry[]): string {
  const lines = rawFm.split(/\r?\n/);
  const start = lines.findIndex((line) => /^formulas:\s*/.test(line));
  const block = serializeFormulaMetadata(entries).split("\n");
  if (start < 0) return `${rawFm.replace(/\s+$/, "")}\n${block.join("\n")}`;
  let end = start + 1;
  while (end < lines.length && /^\s+/.test(lines[end])) end += 1;
  return [...lines.slice(0, start), ...block, ...lines.slice(end)].join("\n");
}

function fmArray(rawFm: string, key: string): string[] {
  const match = rawFm.match(new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]\\s*$`, "m"));
  if (!match) return [];
  return (match[1] ?? "").split(",").map((item) => unquote(item)).filter(Boolean);
}

function setFmArray(rawFm: string, key: string, values: string[]): string {
  const unique = [...new Set(values.filter(Boolean))].sort();
  const line = `${key}: [${unique.map(jsonScalar).join(", ")}]`;
  const re = new RegExp(`^${key}:\\s*\\[[^\\]]*\\]\\s*$`, "m");
  if (re.test(rawFm)) return rawFm.replace(re, line);
  return `${rawFm.replace(/\s+$/, "")}\n${line}`;
}

function normalizeFormulaText(text: string): string {
  return String(text ?? "")
    .replace(/\\text\{([^}]*)\}/g, "$1")
    .replace(/\\mathrm\{([^}]*)\}/g, "$1")
    .replace(/\\operatorname\{([^}]*)\}/g, "$1")
    .replace(/\\[A-Za-z]+/g, " ")
    .replace(/[{}\\$]/g, " ")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function words(text: string): string[] {
  return [...new Set(
    String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/)
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word)),
  )];
}

function overlapScore(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const set = new Set(right);
  return left.filter((token) => set.has(token)).length / left.length;
}

function roundScore(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

function semanticFamily(text: string): string | undefined {
  const detected = formulaMetricFamily(text);
  if (detected) return detected;
  const lower = text.toLowerCase();
  if (/converg|target accuracy|threshold crossing|epochmin|epoch min/.test(lower)) return "convergence";
  if (/spike count|total spikes|spikes summed/.test(lower)) return "spike-count";
  if (/energy efficiency|accuracy per (?:joule|energy)/.test(lower)) return "efficiency";
  if (/energy consumption|energy per|synaptic operation/.test(lower)) return "energy";
  if (/latency|decision time|stimulus onset/.test(lower)) return "latency";
  if (/accuracy|correct prediction/.test(lower)) return "accuracy";
  return undefined;
}

function familiesFromText(text: string): string[] {
  const lower = text.toLowerCase();
  return KNOWN_FAMILIES.filter((family) => {
    if (family === "spike-count") return /spike count|total spikes|spiking activity/.test(lower);
    return lower.includes(family);
  });
}

function familiesCompatible(left?: string, right?: string): boolean {
  return !left || !right || left === right;
}

function ledgerPath(gardenDir: string): string {
  return path.join(gardenDir, ".breadboard", "source-visuals.json");
}

function contractFormulaIds(state: FinalGardenState, unit: LearningUnitContract): string[] {
  const assigned = state.learningUnitContract.assignments
    .filter((assignment) => assignment.assignedLearningUnitId === unit.id && FORMULA_ID_RE.test(assignment.sourceArtifactId))
    .map((assignment) => assignment.sourceArtifactId);
  return [...new Set([...unit.sourceFormulas.map((formula) => formula.id), ...assigned])];
}

function pageExplainsFormula(page: FinalGardenPage, anchorText: string): boolean {
  const family = semanticFamily(anchorText);
  const bodyText = `${page.title} ${page.body}`;
  if (family && familiesFromText(bodyText).includes(family)) return true;
  return overlapScore(words(anchorText), words(bodyText)) >= 0.3;
}

function isDefinition(entry: FormulaMetadataEntry): boolean {
  return (entry.kind === "source_definition" || entry.kind === "source_derived_definition")
    && formulaStructuralKind(entry.text) === "definition";
}

function uniquePush<T>(record: Record<string, T[]>, key: string, value: T): void {
  (record[key] ??= []).push(value);
}

function usageCoverageMode(usage: CanonicalFormulaUsage): CanonicalFormulaCoverageMode {
  if (usage.modes.includes("source_definition") || usage.modes.includes("source_derived_definition")) {
    return "Explained as Text Formulas";
  }
  if (usage.modes.includes("interactive_grounding")) return "Used as Interactive Grounding";
  if (usage.modes.includes("intentionally_omitted")) return "Intentionally Omitted";
  return "Missing or Misplaced";
}

/** Build formula usage from authoritative final artifacts. Source Coverage is
 * deliberately absent from the inputs. */
export function buildCanonicalFormulaUsageIndex(
  gardenDir: string,
  state: FinalGardenState,
): CanonicalFormulaUsageIndex {
  const result: CanonicalFormulaUsageIndex = {
    byAnchorId: {},
    byPagePath: {},
    unresolvedAssignments: [],
    problems: [],
  };
  const ledger = readJson<Array<Record<string, unknown>>>(ledgerPath(gardenDir), []);
  const ledgerById = new Map(ledger.map((record) => [String(record.sourceVisualId ?? ""), record]));
  const pagesByUnit = new Map<string, FinalGardenPage[]>();
  for (const page of state.pages) {
    const pages = pagesByUnit.get(page.learningUnitId) ?? [];
    pages.push(page);
    pagesByUnit.set(page.learningUnitId, pages);
  }

  const usageByKey = new Map<string, CanonicalFormulaUsage>();
  const ensureUsage = (anchorId: string, unitId: string, pagePath: string, required: boolean): CanonicalFormulaUsage => {
    const key = `${anchorId}\0${pagePath}`;
    const existing = usageByKey.get(key);
    if (existing) {
      existing.requiredByContract ||= required;
      return existing;
    }
    const anchor = state.sourceAnchors[anchorId];
    const ledgerRecord = ledgerById.get(anchorId);
    const usage: CanonicalFormulaUsage = {
      formulaAnchorId: anchorId,
      unitId,
      pagePath,
      formulaFamily: anchor?.formulaFamily ?? semanticFamily(
        [anchor?.title, anchor?.exactText, anchor?.semanticSummary, ledgerRecord?.caption].filter(Boolean).join(" "),
      ),
      requiredByContract: required,
      modes: [],
      workedExamples: [],
      sourceLedgerUsage: ledgerRecord ? {
        conceptUsage: String(ledgerRecord.conceptUsage ?? "") || undefined,
        cropStatus: String(ledgerRecord.cropStatus ?? "") || undefined,
        usageStatus: String(ledgerRecord.usageStatus ?? "") || undefined,
      } : undefined,
      problems: [],
    };
    usageByKey.set(key, usage);
    uniquePush(result.byAnchorId, anchorId, usage);
    uniquePush(result.byPagePath, pagePath, usage);
    return usage;
  };

  for (const unit of state.learningUnitContract.units) {
    for (const anchorId of contractFormulaIds(state, unit)) {
      const pages = pagesByUnit.get(unit.id) ?? [];
      if (pages.length !== 1) {
        result.unresolvedAssignments.push({
          unitId: unit.id,
          pagePath: pages[0]?.rel,
          formulaAnchorId: anchorId,
          reason: pages.length === 0 ? "contract unit has no final learner page" : "contract unit maps to multiple final learner pages",
        });
        continue;
      }
      ensureUsage(anchorId, unit.id, pages[0].rel, true);
    }
  }

  for (const page of state.pages) {
    const entries = parseFormulaMetadataEntries(page.rawFrontmatter);
    for (const anchorId of page.sourceFormulaAnchors.filter((id) => FORMULA_ID_RE.test(id))) {
      ensureUsage(anchorId, page.learningUnitId, page.rel, false);
    }
    for (const entry of entries) {
      const anchorId = String(entry.sourceAnchor ?? entry.basedOnFormula ?? "");
      if (!FORMULA_ID_RE.test(anchorId)) continue;
      const usage = ensureUsage(anchorId, page.learningUnitId, page.rel, false);
      if (isDefinition(entry)) {
        const kind = entry.kind as "source_definition" | "source_derived_definition";
        if (!usage.modes.includes(kind)) usage.modes.push(kind);
        usage.definitionEntry ??= { text: entry.text, kind, sourceAnchor: anchorId };
      } else if (entry.kind === "worked_example") {
        if (!usage.modes.includes("worked_example")) usage.modes.push("worked_example");
        usage.workedExamples.push({
          text: entry.text,
          basedOnFormula: entry.basedOnFormula,
          formulaFamily: entry.formulaFamily,
          exampleGroupId: entry.exampleGroupId,
        });
      }
    }
  }

  for (const visual of state.visuals) {
    for (const anchorId of visual.anchorIds.filter((id) => FORMULA_ID_RE.test(id))) {
      const page = state.pages.find((candidate) => candidate.rel === visual.pageRel || candidate.rel.replace(/\.md$/i, "") === visual.pageRel);
      if (!page) continue;
      const usage = ensureUsage(anchorId, page.learningUnitId, page.rel, false);
      if (!usage.modes.includes("interactive_grounding")) usage.modes.push("interactive_grounding");
    }
  }

  for (const usage of usageByKey.values()) {
    const page = state.pages.find((candidate) => candidate.rel === usage.pagePath);
    const anchor = state.sourceAnchors[usage.formulaAnchorId];
    const evidence = [anchor?.title, anchor?.semanticSummary, anchor?.exactText, usage.formulaFamily].filter(Boolean).join(" ");
    if (page && pageExplainsFormula(page, evidence) && !usage.modes.includes("text_explanation")) {
      usage.modes.push("text_explanation");
    }
    const ledgerRecord = ledgerById.get(usage.formulaAnchorId);
    if (/intentionally_omitted|omitted_with_reason/i.test(String(ledgerRecord?.conceptUsage ?? ledgerRecord?.usageStatus ?? ""))) {
      usage.modes.push("intentionally_omitted");
    }
    if (usage.requiredByContract && !usage.definitionEntry && !usage.modes.includes("intentionally_omitted")) {
      usage.problems.push("contract-required formula lacks a canonical symbolic definition on the assigned page");
    }
    if (usage.definitionEntry && !page?.sourceFormulaAnchors.includes(usage.formulaAnchorId)) {
      usage.problems.push("definition metadata is not mirrored in page sourceFormulaAnchors");
    }
    if (!anchor || anchor.kind !== "formula") usage.problems.push("formula anchor does not resolve to canonical formula evidence");
    usage.coverageMode = usageCoverageMode(usage);
    result.problems.push(...usage.problems.map((problem) => `${usage.formulaAnchorId}/${usage.unitId}/${usage.pagePath}: ${problem}`));
  }
  result.problems.push(...result.unresolvedAssignments.map((item) => `${item.formulaAnchorId}/${item.unitId}: ${item.reason}`));
  return result;
}

export function verifyContractFormulaCompatibility(
  formulaAnchorId: string,
  unit: LearningUnitContract,
  page: FinalGardenPage,
  state: FinalGardenState,
): ContractFormulaCompatibilityResult {
  const anchor = state.sourceAnchors[formulaAnchorId];
  if (!anchor || anchor.kind !== "formula") {
    return {
      compatible: false,
      formulaAnchorId,
      unitId: unit.id,
      pagePath: page.rel,
      unitConceptFamilies: formulaFamiliesForAssignmentContext(unit, page),
      titleOverlapScore: 0,
      keywordCoverageScore: 0,
      semanticCompatibilityScore: 0,
      reason: "formula anchor does not resolve to canonical source evidence",
    };
  }
  const identity = verifyCanonicalFormulaIdentity(anchor, state.rootPath);
  const candidates = findCompatibleFormulaAssignments(unit, page, [identity]);
  const candidate = candidates[0];
  const unitConceptFamilies = formulaFamiliesForAssignmentContext(unit, page);
  const formulaText = [identity.title, identity.canonicalText, identity.caption].filter(Boolean).join(" ");
  const titleOverlapScore = roundScore(overlapScore(words(identity.title), words(`${unit.title} ${page.title}`)));
  const keywordCoverageScore = roundScore(overlapScore(words(formulaText), words(`${unit.title} ${unit.learningQuestion} ${page.title} ${page.body}`)));
  const semanticCompatibilityScore = candidate?.totalScore ?? 0;
  const compatible = Boolean(candidate?.compatible);
  return {
    compatible,
    formulaAnchorId,
    unitId: unit.id,
    pagePath: page.rel,
    formulaFamily: identity.family === "other" ? undefined : legacyFormulaFamily(identity.family),
    unitConceptFamilies,
    titleOverlapScore,
    keywordCoverageScore,
    semanticCompatibilityScore,
    reason: compatible
      ? `compatible verified identity: score ${semanticCompatibilityScore}, family ${identity.family}, confidence ${identity.evidence.confidence}`
      : !identity.verified
        ? `formula identity is unresolved (${identity.evidence.reason})`
        : `incompatible verified family ${identity.family}; unit/page families are [${unitConceptFamilies.join(", ") || "none"}]`,
  };
}

export function reconcileContractFormulaUsage(
  usage: CanonicalFormulaUsage,
  state: FinalGardenState,
): ContractFormulaReconciliationResult {
  const unit = state.learningUnitContract.units.find((candidate) => candidate.id === usage.unitId);
  const page = state.pages.find((candidate) => candidate.rel === usage.pagePath);
  if (!unit || !page) {
    return { formulaAnchorId: usage.formulaAnchorId, unitId: usage.unitId, pagePath: usage.pagePath, action: "unsupported", changed: false, reason: "assigned unit/page does not resolve" };
  }
  const compatibility = verifyContractFormulaCompatibility(usage.formulaAnchorId, unit, page, state);
  if (!compatibility.compatible) {
    return { formulaAnchorId: usage.formulaAnchorId, unitId: usage.unitId, pagePath: usage.pagePath, action: "needs_chatmock", changed: false, reason: compatibility.reason };
  }
  if (usage.definitionEntry && page.sourceFormulaAnchors.includes(usage.formulaAnchorId)) {
    return { formulaAnchorId: usage.formulaAnchorId, unitId: usage.unitId, pagePath: usage.pagePath, action: "already_present", changed: false, reason: "canonical definition and page anchor already agree" };
  }
  const entries = parseFormulaMetadataEntries(page.rawFrontmatter);
  const anchor = state.sourceAnchors[usage.formulaAnchorId];
  const family = usage.formulaFamily ?? anchor?.formulaFamily;
  const compatibleExisting = entries.filter((entry) => {
    if (entry.kind === "worked_example") return false;
    if (formulaStructuralKind(entry.text) !== "definition") return false;
    if (entry.sourceAnchor && entry.sourceAnchor !== usage.formulaAnchorId) return false;
    return familiesCompatible(semanticFamily(entry.text), family);
  });
  if (compatibleExisting.length === 1) {
    return { formulaAnchorId: usage.formulaAnchorId, unitId: usage.unitId, pagePath: usage.pagePath, action: "linked_existing_definition", changed: true, reason: "one compatible symbolic definition already exists on the page" };
  }
  if (anchor?.exactText && formulaStructuralKind(anchor.exactText) === "definition" && pageExplainsFormula(page, `${anchor.title} ${anchor.exactText}`)) {
    return { formulaAnchorId: usage.formulaAnchorId, unitId: usage.unitId, pagePath: usage.pagePath, action: "added_existing_definition", changed: true, reason: "canonical symbolic source evidence exists and the page explains it" };
  }
  return {
    formulaAnchorId: usage.formulaAnchorId,
    unitId: usage.unitId,
    pagePath: usage.pagePath,
    action: "needs_chatmock",
    changed: false,
    reason: compatibleExisting.length > 1
      ? "multiple compatible symbolic definitions remain"
      : "no canonical symbolic source record is available; numeric examples cannot be promoted",
  };
}

function binaryOrTimingIllustration(text: string): boolean {
  const normalized = text.replace(/\\[;,]/g, ",").replace(/\s+/g, "");
  return /^[A-Za-z][A-Za-z0-9_{}]*=(?:[01],){3,}[01]$/.test(normalized)
    || /(?:t_?\d+|spike\s*time|event\s*time|timestamp)/i.test(text) && formulaStructuralKind(text) !== "worked_example";
}

export function resolveWorkedExampleLineage(
  entry: FormulaMetadataEntry,
  page: FinalGardenPage,
  usageIndex: CanonicalFormulaUsageIndex,
  state: FinalGardenState,
): WorkedExampleLineageDecision {
  const entries = parseFormulaMetadataEntries(page.rawFrontmatter);
  const entryIndex = Math.max(0, entries.findIndex((candidate) => candidate === entry || (
    candidate.text === entry.text && candidate.kind === entry.kind
  )));
  if (binaryOrTimingIllustration(entry.text)) {
    return { action: "reclassify_conceptual_helper", entryIndex, reason: "illustrative spike/event timing notation, not a numerical application of a source formula" };
  }
  const hasRelation = /[=<>≤≥≈]|\\(?:geq|leq|approx)/.test(entry.text);
  if ((isTrivialFormulaFragment(entry.text) || formulaStructuralKind(entry.text) === "trivial") && !hasRelation) {
    return { action: "remove_metadata_only", entryIndex, reason: "trivial formula fragment is not useful canonical metadata; learner body remains unchanged" };
  }

  const unit = state.learningUnitContract.units.find((candidate) => candidate.id === page.learningUnitId);
  const contractIds = unit ? contractFormulaIds(state, unit) : [];
  const onPageIds = usageIndex.byPagePath[page.rel]?.map((usage) => usage.formulaAnchorId) ?? [];
  const candidateIds = [...new Set([...onPageIds, ...contractIds])].filter((id) => Boolean(state.sourceAnchors[id]));
  const entryFamily = entry.formulaFamily ?? semanticFamily(entry.text);
  const candidates = candidateIds.filter((anchorId) => {
    const anchor = state.sourceAnchors[anchorId];
    const family = anchor?.formulaFamily ?? semanticFamily(`${anchor?.title ?? ""} ${anchor?.exactText ?? ""}`);
    return entryFamily ? familiesCompatible(entryFamily, family) : overlapScore(words(entry.text), words(`${anchor?.title ?? ""} ${anchor?.exactText ?? ""}`)) >= 0.25;
  });
  if (candidates.length === 1) {
    const anchor = state.sourceAnchors[candidates[0]];
    return {
      action: "assign_lineage",
      entryIndex,
      basedOnFormula: candidates[0],
      formulaFamily: entryFamily ?? anchor.formulaFamily ?? semanticFamily(anchor.title) ?? "source-formula",
      confidence: "high",
      reason: "one canonical on-page/contract definition matches formula family, symbolic structure, and page context",
    };
  }
  if (candidates.length > 1) {
    return { action: "needs_chatmock", entryIndex, candidateDefinitionAnchors: candidates, reason: "two or more independently plausible definition anchors remain" };
  }
  return { action: "reclassify_conceptual_helper", entryIndex, reason: "expression is illustrative notation with no supported canonical formula lineage" };
}

export function deriveFormulaConceptUsage(
  usage: CanonicalFormulaUsage,
):
  | "explained_as_text_formula"
  | "used_as_interactive_grounding"
  | "referenced_again"
  | "intentionally_omitted"
  | "missing" {
  if (usage.modes.includes("source_definition") || usage.modes.includes("source_derived_definition")) return "explained_as_text_formula";
  if (usage.modes.includes("interactive_grounding")) return "used_as_interactive_grounding";
  if (usage.modes.includes("text_explanation") && !usage.requiredByContract) return "referenced_again";
  if (usage.modes.includes("intentionally_omitted")) return "intentionally_omitted";
  return "missing";
}

function derivedModeForAnchor(usages: CanonicalFormulaUsage[]): ReturnType<typeof deriveFormulaConceptUsage> {
  const modes = usages.map(deriveFormulaConceptUsage);
  for (const mode of ["explained_as_text_formula", "used_as_interactive_grounding", "referenced_again", "intentionally_omitted", "missing"] as const) {
    if (modes.includes(mode)) return mode;
  }
  return "missing";
}

function coverageSection(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // JavaScript has no `\Z` end-of-input escape: in a RegExp it matches a
  // literal "Z" (and, with the case-insensitive flag, any "z"). Use a
  // negative-any-character assertion so labels such as "Normalized" cannot
  // truncate the section before later formula records.
  return markdown.match(new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, "mi"))?.[1] ?? "";
}

/** Pure Source Coverage renderer. The prior report is never consulted or
 * incrementally merged. */
export function renderSourceCoverageFromFinalState(
  state: FinalGardenState,
  usageIndex: CanonicalFormulaUsageIndex,
): string {
  const titleByPage = new Map<string, string>();
  for (const page of state.pages) {
    titleByPage.set(page.rel, page.title);
    titleByPage.set(page.rel.replace(/\.md$/i, ""), page.title);
  }
  const ledger = readJson<Array<Record<string, unknown>>>(ledgerPath(state.rootPath), []);
  const ledgerById = new Map(ledger.map((record) => [String(record.sourceVisualId ?? ""), record]));
  const usageByAnchor = new Map<string, FinalGardenState["sourceUsages"]>();
  for (const usage of state.sourceUsages) {
    const list = usageByAnchor.get(usage.anchorId) ?? [];
    list.push(usage);
    usageByAnchor.set(usage.anchorId, list);
  }
  const label = (id: string) => state.sourceAnchors[id]?.title ?? String(ledgerById.get(id)?.caption ?? id);
  const pagesFor = (id: string, kinds: string[]): string[] => [...new Set(
    (usageByAnchor.get(id) ?? []).filter((usage) => kinds.includes(usage.kind)).map((usage) => titleByPage.get(usage.pageRel) ?? usage.pageRel).filter(Boolean),
  )];
  const formulaPages = (id: string): string[] => [...new Set((usageIndex.byAnchorId[id] ?? [])
    .filter((usage) => usage.modes.includes("source_definition") || usage.modes.includes("source_derived_definition"))
    .map((usage) => titleByPage.get(usage.pagePath) ?? usage.pagePath))];
  const allIds = new Set([...Object.keys(state.sourceAnchors), ...usageByAnchor.keys(), ...Object.keys(usageIndex.byAnchorId)]);
  const buckets: Record<string, string[]> = Object.fromEntries([
    "reconciled", "embedded", "formula", "prose", "interactive", "referenced", "fallback", "omitted", "missing",
  ].map((key) => [key, []]));

  for (const id of [...allIds].sort()) {
    const anchor = state.sourceAnchors[id];
    const formulaUsages = usageIndex.byAnchorId[id] ?? [];
    const ledgerRecord = ledgerById.get(id);
    const cropPages = pagesFor(id, ["source_crop"]);
    const prosePages = pagesFor(id, ["page_prose", "text_concept"]);
    const visualPages = pagesFor(id, ["visual_grounding"]);
    const textFormulaPages = formulaPages(id);
    const allPages = [...new Set([...cropPages, ...prosePages, ...visualPages, ...textFormulaPages])];
    const used = allPages.length > 0 || formulaUsages.some((usage) => usage.modes.length > 0);
    buckets.reconciled.push(`- ${id} (${used ? "used" : "unused"}): ${label(id)}; used on: ${allPages.join("; ") || "none"}`);
    if (cropPages.length > 0) buckets.embedded.push(`- ${id}: ${label(id)}; used on ${cropPages.join("; ")}`);
    if (anchor?.kind === "formula") {
      const mode = derivedModeForAnchor(formulaUsages);
      if (mode === "explained_as_text_formula") buckets.formula.push(`- ${id}: ${label(id)}; used on ${textFormulaPages.join("; ") || "none"}`);
      // One formula can legitimately be both defined in text and consumed by
      // an interactive visual. The ledger stores the canonical primary mode,
      // while Source Coverage projects every supported final usage.
      if (formulaUsages.some((usage) => usage.modes.includes("interactive_grounding")) || visualPages.length > 0) {
        buckets.interactive.push(`- ${id}: ${label(id)}; used on ${visualPages.join("; ") || "none"}; visual source grounding`);
      }
      if (mode === "referenced_again") buckets.referenced.push(`- ${id}: ${label(id)}; referenced on ${prosePages.join("; ") || "none"}`);
      if (mode === "intentionally_omitted") buckets.omitted.push(`- ${id}: ${label(id)}; ${String(ledgerRecord?.skipReason ?? "explicitly justified omission")}`);
      if (mode === "missing") buckets.missing.push(`- ${id}: ${label(id)}; used on none`);
      if (String(ledgerRecord?.cropStatus ?? "") === "omitted_unreliable") {
        buckets.fallback.push(`- ${id}: ${label(id)}; used on ${textFormulaPages.join("; ") || "none"}; crop omitted with text/formula fallback`);
      }
      continue;
    }
    for (const pageTitle of prosePages) buckets.prose.push(`- ${id}: ${pageTitle}; ${label(id)}`);
    if (visualPages.length > 0) buckets.interactive.push(`- ${id}: ${label(id)}; used on ${visualPages.join("; ")}; visual source grounding`);
    if (!used && anchor) buckets.missing.push(`- ${id}: ${label(id)}; used on none`);
  }

  for (const assignment of state.learningUnitContract.assignments) {
    const unit = state.learningUnitContract.units.find((candidate) => candidate.id === assignment.assignedLearningUnitId);
    buckets.referenced.push(`- ${assignment.sourceArtifactId}: assigned to ${assignment.assignedLearningUnitId}${unit ? ` (${unit.title})` : ""}; placement=${assignment.placement}; ${assignment.requiredInterpretation || assignment.reason}`);
  }
  const section = (heading: string, items: string[]) => ["", `## ${heading}`, "", ...(items.length ? [...new Set(items)] : ["- None."])];
  return `${[
    "# Source Coverage", "",
    "Generated deterministically from canonical final pages, the Learning Unit Contract,",
    "canonical source evidence, final visual JSON, and the reconciled source ledger.",
    "Source Coverage is a pure projection and is never an authoritative input.", "",
    "## Reconciled Source Visual Usage", "", ...buckets.reconciled,
    ...section("Embedded Source Crops", buckets.embedded),
    ...section("Explained as Text Formulas", buckets.formula),
    ...section("Explained in Prose", buckets.prose),
    ...section("Used as Interactive Grounding", buckets.interactive),
    ...section("Referenced Again in Synthesis", buckets.referenced),
    ...section("Crop Omitted With Text Fallback", buckets.fallback),
    ...section("Intentionally Omitted", buckets.omitted),
    ...section("Missing or Misplaced", buckets.missing),
    "", "## Notes", "",
    "- Formula modes are derived from final page metadata/body and final visual usage; stale ledger modes are replaced.", "",
  ].join("\n")}\n`;
}

function stableFormulaUsageId(anchorId: string, unitId: string, pagePath = "unknown"): string {
  return `formula_assignment_family_mismatch:unit=${unitId}:page=${pagePath}:anchor=${anchorId}`;
}

export function stableWorkedExampleIdentity(pagePath: string, entry: FormulaMetadataEntry): string {
  const digest = crypto.createHash("sha1").update(normalizeFormulaText(entry.text)).digest("hex").slice(0, 12);
  return `formula_worked_example:${pagePath}:${digest}:${entry.kind || "worked_example"}`;
}

export function auditFormulaProjections(
  state: FinalGardenState,
  index = buildCanonicalFormulaUsageIndex(state.rootPath, state),
): FormulaProjectionAuditIssue[] {
  const issues = new Map<string, FormulaProjectionAuditIssue>();
  const add = (id: string, subproblem: string, details: Omit<FormulaProjectionAuditIssue, "id" | "subproblems">) => {
    const issue = issues.get(id) ?? { id, subproblems: [], ...details };
    if (!issue.subproblems.includes(subproblem)) issue.subproblems.push(subproblem);
    issues.set(id, issue);
  };
  const coverage = state.planningDocs.sourceCoverage ?? "";
  const formulaCoverage = coverageSection(coverage, "Explained as Text Formulas");
  const interactiveCoverage = coverageSection(coverage, "Used as Interactive Grounding");
  const referencedCoverage = coverageSection(coverage, "Referenced Again in Synthesis");
  const ledger = readJson<Array<Record<string, unknown>>>(ledgerPath(state.rootPath), []);
  const ledgerById = new Map(ledger.map((record) => [String(record.sourceVisualId ?? ""), record]));
  for (const identity of buildFormulaIdentityRegistry(state.sourceAnchors, state.rootPath)) {
    const usages = index.byAnchorId[identity.anchorId] ?? [];
    const representative = usages.find((usage) => usage.requiredByContract) ?? usages[0];
    if (!identity.verified) {
      add(
        `formula_identity:anchor=${identity.anchorId}`,
        "ambiguous_formula_identity",
        { pagePath: representative?.pagePath, unitId: representative?.unitId, anchorId: identity.anchorId },
      );
      continue;
    }
    const declared = normalizeFormulaSemanticFamily(state.sourceAnchors[identity.anchorId]?.formulaFamily);
    if (declared && declared !== identity.family) {
      add(
        `formula_identity:anchor=${identity.anchorId}`,
        "registry_identity_conflict",
        { pagePath: representative?.pagePath, unitId: representative?.unitId, anchorId: identity.anchorId },
      );
    }
  }
  for (const usages of Object.values(index.byAnchorId)) {
    for (const usage of usages) {
      if (!usage.requiredByContract) continue;
      const id = stableFormulaUsageId(usage.formulaAnchorId, usage.unitId, usage.pagePath);
      const page = state.pages.find((candidate) => candidate.rel === usage.pagePath);
      const unit = state.learningUnitContract.units.find((candidate) => candidate.id === usage.unitId);
      if (!page || !unit) {
        add(id, "missing_unit_page_assignment", { pagePath: usage.pagePath, unitId: usage.unitId, anchorId: usage.formulaAnchorId });
        continue;
      }
      if (!verifyContractFormulaCompatibility(usage.formulaAnchorId, unit, page, state).compatible) {
        add(id, "incompatible_contract_assignment", { pagePath: usage.pagePath, unitId: usage.unitId, anchorId: usage.formulaAnchorId });
      }
      if (!usage.definitionEntry && !usage.modes.includes("intentionally_omitted")) add(id, "missing_definition_metadata", { pagePath: usage.pagePath, unitId: usage.unitId, anchorId: usage.formulaAnchorId });
      if (!page.sourceFormulaAnchors.includes(usage.formulaAnchorId)) add(id, "missing_page_formula_anchor", { pagePath: usage.pagePath, unitId: usage.unitId, anchorId: usage.formulaAnchorId });
      const escapedAnchor = usage.formulaAnchorId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const escapedUnit = usage.unitId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!new RegExp(`\\b${escapedAnchor}\\b[^\\n]*assigned to ${escapedUnit}\\b`, "i").test(referencedCoverage)) {
        add(id, "contract_coverage_assignment_mismatch", { pagePath: usage.pagePath, unitId: usage.unitId, anchorId: usage.formulaAnchorId });
      }
    }
  }
  for (const [anchorId, usages] of Object.entries(index.byAnchorId)) {
    const mode = derivedModeForAnchor(usages);
    const ledgerMode = String(ledgerById.get(anchorId)?.conceptUsage ?? "");
    const representative = usages.find((usage) => usage.requiredByContract) ?? usages[0];
    const id = stableFormulaUsageId(anchorId, representative?.unitId ?? "unassigned", representative?.pagePath ?? "unknown");
    if (ledgerMode && ledgerMode !== mode) add(id, "stale_source_ledger_mode", { pagePath: representative?.pagePath, unitId: representative?.unitId, anchorId });
    if (mode === "explained_as_text_formula" && !new RegExp(`\\b${anchorId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(formulaCoverage)) {
      add(id, "ledger_coverage_mismatch", { pagePath: representative?.pagePath, unitId: representative?.unitId, anchorId });
    }
    if (usages.some((usage) => usage.modes.includes("interactive_grounding")) && !new RegExp(`\\b${anchorId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(interactiveCoverage)) {
      add(id, "interactive_coverage_mismatch", { pagePath: representative?.pagePath, unitId: representative?.unitId, anchorId });
    }
  }
  for (const page of state.pages) {
    for (const entry of parseFormulaMetadataEntries(page.rawFrontmatter)) {
      if (entry.kind !== "worked_example") continue;
      const family = entry.formulaFamily ?? semanticFamily(entry.text);
      const validAnchor = entry.basedOnFormula && state.sourceAnchors[entry.basedOnFormula]?.kind === "formula";
      if (!family && !validAnchor) {
        add(stableWorkedExampleIdentity(page.rel, entry), "missing_worked_example_lineage", { pagePath: page.rel, unitId: page.learningUnitId });
      }
    }
  }
  return [...issues.values()];
}

function toFinalRepairIssue(issue: FormulaProjectionAuditIssue): FinalRepairIssue {
  return {
    id: issue.id,
    type: "formula_usage_projection",
    severity: "blocking",
    pagePath: issue.pagePath,
    unitId: issue.unitId,
    anchorId: issue.anchorId,
    message: issue.subproblems.join(", "),
    evidence: { subproblems: issue.subproblems },
    repairMode: "deterministic_then_chatmock",
  };
}

function stateFingerprint(state: FinalGardenState): string {
  const files = [
    ...state.pages.map((page) => page.abs),
    path.join(state.rootPath, ".breadboard", "learning-unit-contract.json"),
    path.join(state.rootPath, ".breadboard", "planning", "learning-unit-contract.json"),
    ledgerPath(state.rootPath),
    path.join(state.rootPath, ".breadboard", "planning", "Source Coverage.md"),
  ];
  const values = files.filter((abs) => fs.existsSync(abs)).sort().map((abs) => `${path.relative(state.rootPath, abs)}:${fs.readFileSync(abs, "utf-8")}`);
  return crypto.createHash("sha256").update(values.join("\0")).digest("hex");
}

function contractPathFor(gardenDir: string): string | undefined {
  return [
    path.join(gardenDir, ".breadboard", "learning-unit-contract.json"),
    path.join(gardenDir, ".breadboard", "planning", "learning-unit-contract.json"),
  ].find((candidate) => fs.existsSync(candidate));
}

/** Minimal LearningUnitContract reconstructed from a raw contract JSON record,
 * enough for the formula-assignment pre-write guard to derive a requirement. */
function contractUnitFromRawRecord(record: Record<string, unknown>): LearningUnitContract {
  return {
    id: String(record.id ?? ""),
    title: String(record.title ?? ""),
    role: (typeof record.role === "string" ? record.role : "core_concept") as LearningUnitContract["role"],
    learningQuestion: String(record.learningQuestion ?? ""),
    prerequisiteConcepts: Array.isArray(record.prerequisiteConcepts) ? record.prerequisiteConcepts.map(String) : [],
    newConcepts: Array.isArray(record.newConcepts) ? record.newConcepts.map(String) : [],
    sourceAnchors: Array.isArray(record.sourceAnchors) ? record.sourceAnchors.map(String) : [],
    sourceFigures: [],
    sourceFormulas: [],
    sourceTables: [],
    zettelNotes: [],
    mustNotRepeat: [],
    expectedWordRange: [0, 0],
  };
}

/** Pre-write guard for contract mutations: the identity must be compatible
 * with the target unit's derived requirement, or the mutation is refused. */
function contractMutationAllowed(
  identity: CanonicalFormulaIdentity | undefined,
  targetRecord: Record<string, unknown>,
): boolean {
  if (!identity) return true; // callers without an identity already verified upstream
  const unit = contractUnitFromRawRecord(targetRecord);
  const requirement = deriveUnitFormulaRequirement(unit);
  return validateFormulaAssignment(identity, requirement, unit).hardRejectionReasons.length === 0;
}

function moveContractAssignment(
  gardenDir: string,
  anchorId: string,
  fromUnitId: string,
  targetUnitId: string,
  verifiedFamily?: string,
  identity?: CanonicalFormulaIdentity,
): string | undefined {
  const abs = contractPathFor(gardenDir);
  if (!abs) return undefined;
  const artifact = readJson<Record<string, unknown>>(abs, {});
  const unitsKey = Array.isArray(artifact.learningUnits) ? "learningUnits" : "units";
  const units = (Array.isArray(artifact[unitsKey]) ? artifact[unitsKey] : []) as Array<Record<string, unknown>>;
  const from = units.find((unit) => String(unit.id ?? "") === fromUnitId);
  const target = units.find((unit) => String(unit.id ?? "") === targetUnitId);
  if (!from || !target) return undefined;
  if (!contractMutationAllowed(identity, target)) return undefined;
  const formulas = (Array.isArray(from.sourceFormulas) ? from.sourceFormulas : []) as Array<Record<string, unknown>>;
  const formula = formulas.find((record) => String(record.id ?? record.formulaId ?? "") === anchorId);
  from.sourceFormulas = formulas.filter((record) => String(record.id ?? record.formulaId ?? "") !== anchorId);
  from.sourceAnchors = ((Array.isArray(from.sourceAnchors) ? from.sourceAnchors : []) as unknown[])
    .filter((value) => String(value) !== anchorId);
  const targetFormulas = (Array.isArray(target.sourceFormulas) ? target.sourceFormulas : []) as Array<Record<string, unknown>>;
  if (!targetFormulas.some((record) => String(record.id ?? record.formulaId ?? "") === anchorId)) targetFormulas.push(formula ?? { id: anchorId, teachingGoal: "", termsToDefine: [], placement: "before_example" });
  target.sourceFormulas = targetFormulas;
  const targetAnchors = ((Array.isArray(target.sourceAnchors) ? target.sourceAnchors : []) as unknown[]).map(String);
  if (!targetAnchors.includes(anchorId)) targetAnchors.push(anchorId);
  target.sourceAnchors = targetAnchors;
  const assignmentsKey = Array.isArray(artifact.sourceArtifactAssignments) ? "sourceArtifactAssignments" : "assignments";
  const assignments = (Array.isArray(artifact[assignmentsKey]) ? artifact[assignmentsKey] : []) as Array<Record<string, unknown>>;
  for (const assignment of assignments) {
    if (String(assignment.sourceArtifactId ?? assignment.id ?? "") === anchorId) assignment.assignedLearningUnitId = targetUnitId;
  }
  const provenance = (Array.isArray(artifact.formulaAssignmentProvenance)
    ? artifact.formulaAssignmentProvenance : []) as Array<Record<string, unknown>>;
  provenance.push({
    formulaAnchorId: anchorId,
    unitId: targetUnitId,
    status: "moved",
    verifiedFamily,
    previousUnitId: fromUnitId,
    reason: `Verified formula identity is incompatible with ${fromUnitId} and deterministically matches ${targetUnitId}.`,
  });
  artifact.formulaAssignmentProvenance = provenance;
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

function repairContractAnchorLeaksAndProvenance(
  gardenDir: string,
  state: FinalGardenState,
  identities: CanonicalFormulaIdentity[],
): { content?: string; leaksRemoved: number; provenance: ContractFormulaAssignmentProvenance[] } {
  const abs = contractPathFor(gardenDir);
  if (!abs) return { leaksRemoved: 0, provenance: [] };
  const artifact = readJson<Record<string, unknown>>(abs, {});
  const unitsKey = Array.isArray(artifact.learningUnits) ? "learningUnits" : "units";
  const rawUnits = (Array.isArray(artifact[unitsKey]) ? artifact[unitsKey] : []) as Array<Record<string, unknown>>;
  const identityById = new Map(identities.map((identity) => [identity.anchorId, identity]));
  const provenance: ContractFormulaAssignmentProvenance[] = [];
  const historicalProvenance = (Array.isArray(artifact.formulaAssignmentProvenance)
    ? artifact.formulaAssignmentProvenance : []) as Array<Record<string, unknown>>;
  let leaksRemoved = 0;

  for (const rawUnit of rawUnits) {
    const unitId = String(rawUnit.id ?? "");
    const unit = state.learningUnitContract.units.find((candidate) => candidate.id === unitId);
    const page = state.pages.find((candidate) => candidate.learningUnitId === unitId);
    if (!unit || !page) continue;
    const formal = new Set(contractFormulaIds(state, unit));
    const sourceAnchors = (Array.isArray(rawUnit.sourceAnchors) ? rawUnit.sourceAnchors : []).map(String);
    const nextAnchors: string[] = [];
    for (const anchorId of sourceAnchors) {
      const identity = identityById.get(anchorId);
      if (!identity || formal.has(anchorId)) {
        nextAnchors.push(anchorId);
        continue;
      }
      const projectedAsFormula = page.sourceFormulaAnchors.includes(anchorId)
        || page.formulas.some((formula) => formula.sourceAnchor === anchorId || formula.basedOnFormula === anchorId);
      if (!projectedAsFormula) {
        // Broad source evidence on synthesis/comparison pages is legitimate;
        // only sanitize a non-contract formula when it actually leaked into
        // formula metadata/lineage for this page.
        nextAnchors.push(anchorId);
        continue;
      }
      let compatible = true;
      try {
        assertFormulaAssignmentCompatible(identity, unit, page);
      } catch {
        compatible = false;
      }
      if (compatible) {
        nextAnchors.push(anchorId);
        continue;
      }
      leaksRemoved += 1;
      const replacement = findCompatibleFormulaAssignments(unit, page, identities)
        .find((candidate) => candidate.compatible && formal.has(candidate.anchorId));
      provenance.push({
        formulaAnchorId: anchorId,
        unitId,
        status: "repaired",
        verifiedFamily: identity.verified ? identity.family : undefined,
        replacementAnchorId: replacement?.anchorId,
        reason: `Removed an incompatible non-assignment formula anchor from unit evidence; verified ${identity.family} does not match the unit/page.`,
      });
    }
    rawUnit.sourceAnchors = [...new Set(nextAnchors)];

    for (const anchorId of formal) {
      const identity = identityById.get(anchorId);
      let compatible = false;
      if (identity) {
        try {
          assertFormulaAssignmentCompatible(identity, unit, page);
          compatible = true;
        } catch {
          compatible = false;
        }
      }
      provenance.push({
        formulaAnchorId: anchorId,
        unitId,
        status: compatible ? "verified" : identity?.verified ? "unsupported" : "ambiguous",
        verifiedFamily: identity?.verified ? identity.family : undefined,
        reason: compatible
          ? `Verified ${identity!.family} identity is compatible with the contract unit and final page.`
          : identity?.verified
            ? `Verified ${identity.family} identity is incompatible with this contract unit/page.`
            : "Formula identity is not sufficiently supported for an active assignment.",
      });
    }
  }
  const preservedHistory = historicalProvenance.filter((record) => ["repaired", "moved"].includes(String(record.status ?? "")));
  const combinedProvenance = [...preservedHistory, ...provenance].filter((record, index, all) =>
    all.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(record)) === index,
  );
  artifact.formulaAssignmentProvenance = combinedProvenance;
  const content = `${JSON.stringify(artifact, null, 2)}\n`;
  return { content: content === fs.readFileSync(abs, "utf-8") ? undefined : content, leaksRemoved, provenance };
}

function bestCompatibleTarget(
  anchorId: string,
  currentUnitId: string,
  state: FinalGardenState,
): { unit: LearningUnitContract; page: FinalGardenPage; score: number } | undefined {
  const anchor = state.sourceAnchors[anchorId];
  if (!anchor || anchor.kind !== "formula") return undefined;
  const identity = verifyCanonicalFormulaIdentity(anchor, state.rootPath);
  if (!identity.verified || !["high", "medium"].includes(identity.evidence.confidence)) return undefined;
  const scored = state.learningUnitContract.units.flatMap((unit) => {
    const pages = state.pages.filter((page) => page.learningUnitId === unit.id);
    if (pages.length !== 1) return [];
    const candidate = findCompatibleFormulaAssignments(unit, pages[0], [identity])[0];
    return candidate?.compatible ? [{ unit, page: pages[0], score: candidate.totalScore }] : [];
  }).sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1];
  if (!best || best.unit.id === currentUnitId || best.score < 0.8) return undefined;
  if (second && best.score - second.score < 0.15) return undefined;
  return best;
}

function bestReplacementForUnit(
  currentAnchorId: string,
  unit: LearningUnitContract,
  page: FinalGardenPage,
  state: FinalGardenState,
  identities: CanonicalFormulaIdentity[],
): { identity: CanonicalFormulaIdentity; score: number } | undefined {
  const scored = findCompatibleFormulaAssignments(unit, page, identities)
    .filter((candidate) => candidate.anchorId !== currentAnchorId && candidate.compatible);
  const best = scored[0];
  const second = scored[1];
  if (!best || best.totalScore < 0.8) return undefined;
  if (second && best.totalScore - second.totalScore < 0.15) return undefined;
  // Do not steal a verified formula from an unrelated active unit. Reuse in
  // the same unit is fine, and an assignment record may be absent for legacy
  // contracts that only populated sourceFormulas.
  const conflicting = state.learningUnitContract.assignments.some((assignment) =>
    assignment.sourceArtifactId === best.anchorId && assignment.assignedLearningUnitId !== unit.id,
  );
  if (conflicting) return undefined;
  return { identity: best.identity, score: best.totalScore };
}

function replaceContractFormulaAssignment(
  gardenDir: string,
  currentAnchorId: string,
  replacement: CanonicalFormulaIdentity,
  unitId: string,
  moveCurrentToUnitId?: string,
  currentIdentity?: CanonicalFormulaIdentity,
): string | undefined {
  const abs = contractPathFor(gardenDir);
  if (!abs) return undefined;
  const artifact = readJson<Record<string, unknown>>(abs, {});
  const unitsKey = Array.isArray(artifact.learningUnits) ? "learningUnits" : "units";
  const units = (Array.isArray(artifact[unitsKey]) ? artifact[unitsKey] : []) as Array<Record<string, unknown>>;
  const from = units.find((unit) => String(unit.id ?? "") === unitId);
  if (!from) return undefined;
  // Pre-write guard: the replacement must fit THIS unit, and a preserved
  // current formula must fit the unit it moves to.
  if (!contractMutationAllowed(replacement, from)) return undefined;
  if (moveCurrentToUnitId) {
    const moveTarget = units.find((unit) => String(unit.id ?? "") === moveCurrentToUnitId);
    if (!moveTarget || !contractMutationAllowed(currentIdentity, moveTarget)) return undefined;
  }
  const formulas = (Array.isArray(from.sourceFormulas) ? from.sourceFormulas : []) as Array<Record<string, unknown>>;
  const previous = formulas.find((formula) => String(formula.id ?? formula.formulaId ?? "") === currentAnchorId);
  from.sourceFormulas = [
    ...formulas.filter((formula) => String(formula.id ?? formula.formulaId ?? "") !== currentAnchorId),
    {
      id: replacement.anchorId,
      teachingGoal: `Teach the verified ${replacement.family} relationship represented by ${replacement.title}.`,
      termsToDefine: replacement.evidence.detectedTerms,
      placement: "before_example",
    },
  ];
  const fromAnchors = (Array.isArray(from.sourceAnchors) ? from.sourceAnchors : []).map(String)
    .filter((anchorId) => anchorId !== currentAnchorId);
  if (!fromAnchors.includes(replacement.anchorId)) fromAnchors.push(replacement.anchorId);
  from.sourceAnchors = fromAnchors;

  if (moveCurrentToUnitId) {
    const target = units.find((unit) => String(unit.id ?? "") === moveCurrentToUnitId);
    if (target) {
      const targetFormulas = (Array.isArray(target.sourceFormulas) ? target.sourceFormulas : []) as Array<Record<string, unknown>>;
      if (!targetFormulas.some((formula) => String(formula.id ?? formula.formulaId ?? "") === currentAnchorId)) {
        targetFormulas.push(previous ?? { id: currentAnchorId, teachingGoal: "Teach the verified source formula.", termsToDefine: [], placement: "before_example" });
      }
      target.sourceFormulas = targetFormulas;
      const targetAnchors = (Array.isArray(target.sourceAnchors) ? target.sourceAnchors : []).map(String);
      if (!targetAnchors.includes(currentAnchorId)) targetAnchors.push(currentAnchorId);
      target.sourceAnchors = targetAnchors;
    }
  }

  const assignmentsKey = Array.isArray(artifact.sourceArtifactAssignments) ? "sourceArtifactAssignments" : "assignments";
  const assignments = (Array.isArray(artifact[assignmentsKey]) ? artifact[assignmentsKey] : []) as Array<Record<string, unknown>>;
  const currentAssignment = assignments.find((assignment) =>
    String(assignment.sourceArtifactId ?? assignment.id ?? "") === currentAnchorId
    && String(assignment.assignedLearningUnitId ?? "") === unitId,
  );
  if (currentAssignment && moveCurrentToUnitId) currentAssignment.assignedLearningUnitId = moveCurrentToUnitId;
  else if (currentAssignment) currentAssignment.sourceArtifactId = replacement.anchorId;
  if (moveCurrentToUnitId && !assignments.some((assignment) =>
    String(assignment.sourceArtifactId ?? assignment.id ?? "") === replacement.anchorId,
  )) {
    assignments.push({
      sourceArtifactId: replacement.anchorId,
      assignedLearningUnitId: unitId,
      placement: "after_formula_introduction",
      reason: `Replaced incompatible ${currentAnchorId} with verified ${replacement.anchorId}.`,
      requiredInterpretation: `Teach the verified ${replacement.family} formula represented by ${replacement.title}.`,
    });
  }
  const provenance = (Array.isArray(artifact.formulaAssignmentProvenance)
    ? artifact.formulaAssignmentProvenance : []) as Array<Record<string, unknown>>;
  provenance.push({
    formulaAnchorId: currentAnchorId,
    unitId,
    status: "repaired",
    verifiedFamily: replacement.family,
    replacementAnchorId: replacement.anchorId,
    ...(moveCurrentToUnitId ? { previousUnitId: unitId } : {}),
    reason: `Atomically replaced a wrong-family contract formula with verified ${replacement.family} anchor ${replacement.anchorId}.`,
  });
  if (moveCurrentToUnitId) provenance.push({
    formulaAnchorId: currentAnchorId,
    unitId: moveCurrentToUnitId,
    status: "moved",
    previousUnitId: unitId,
    reason: `Preserved ${currentAnchorId} on its independently compatible unit instead of deleting its correct usage.`,
  });
  artifact.formulaAssignmentProvenance = provenance;
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

function normalizeAffectedFormulaMetadata(entries: FormulaMetadataEntry[]): FormulaMetadataEntry[] {
  const byText = new Map<string, FormulaMetadataEntry>();
  for (const entry of entries) {
    const key = normalizeFormulaText(entry.text) || entry.text;
    const current = byText.get(key);
    if (!current || (isDefinition(entry) && !isDefinition(current))) byText.set(key, entry);
  }
  return [...byText.values()];
}

function pageFormulaRepair(
  page: FinalGardenPage,
  requiredUsages: CanonicalFormulaUsage[],
  state: FinalGardenState,
  index: CanonicalFormulaUsageIndex,
  identities: CanonicalFormulaIdentity[],
  counts: FormulaProjectionReconciliationResult,
): string | undefined {
  const current = fs.readFileSync(page.abs, "utf-8");
  const parsed = parseMarkdown(current);
  let entries = parseFormulaMetadataEntries(parsed.rawFrontmatter);
  let changed = false;
  const unit = state.learningUnitContract.units.find((candidate) => candidate.id === page.learningUnitId);
  const identityById = new Map(identities.map((identity) => [identity.anchorId, identity]));
  const formalIds = new Set(unit ? contractFormulaIds(state, unit) : []);
  const sourceAnchorRemovals = new Set<string>();
  const sourceAnchorAdditions = new Set<string>();

  // Repair stale wrong-family projections before satisfying required coverage.
  // Learner prose/math is preserved: a numerical application becomes a worked
  // example of the verified on-page formula; unsupported metadata alone is
  // removed. This is the path that repairs an E2 spike-count label attached to
  // a latency calculation without deleting the useful latency calculation.
  for (const entry of entries) {
    const anchorId = String(entry.sourceAnchor ?? "");
    if (!FORMULA_ID_RE.test(anchorId) || !unit) continue;
    const identity = identityById.get(anchorId);
    if (!identity) continue;
    let assignmentCompatible = true;
    try {
      assertFormulaAssignmentCompatible(identity, unit, page);
    } catch {
      assignmentCompatible = false;
    }
    const entryFamily = normalizeFormulaSemanticFamily(entry.formulaFamily ?? semanticFamily(entry.text));
    if (assignmentCompatible && (!entryFamily || entryFamily === identity.family)) continue;
    const candidates = findCompatibleFormulaAssignments(unit, page, identities)
      .filter((candidate) => candidate.compatible && formalIds.has(candidate.anchorId));
    const best = candidates[0];
    sourceAnchorRemovals.add(anchorId);
    if (best) sourceAnchorAdditions.add(best.anchorId);
    if (formulaStructuralKind(entry.text) === "worked_example" && best) {
      entry.kind = "worked_example";
      entry.groundingStatus = "conceptual-helper";
      entry.basedOnFormula = best.anchorId;
      entry.formulaFamily = legacyFormulaFamily(best.identity.family);
      entry.matchReason = `repaired wrong-family source label; numerical example is based on verified ${best.anchorId}`;
      entry.justification = `Worked example retained, with lineage to the verified ${best.identity.family} definition ${best.anchorId}.`;
    } else {
      entry.kind = "conceptual_helper";
      entry.groundingStatus = "conceptual-helper";
      delete entry.basedOnFormula;
      entry.matchReason = "removed incompatible source-formula metadata after canonical identity verification";
      entry.justification = "Learner notation retained, but it no longer claims unsupported source-formula identity.";
    }
    delete entry.sourceAnchor;
    delete entry.sourceAnchorTitle;
    counts.wrongFamilyPageEntriesRepaired += 1;
    changed = true;
  }

  for (const usage of requiredUsages) {
    const decision = reconcileContractFormulaUsage(usage, state);
    if (decision.action === "already_present" || decision.action === "needs_chatmock" || decision.action === "unsupported" || decision.action === "moved_contract_assignment") continue;
    const anchor = state.sourceAnchors[usage.formulaAnchorId];
    if (decision.action === "linked_existing_definition") {
      const candidates = entries.filter((entry) => entry.kind !== "worked_example" && formulaStructuralKind(entry.text) === "definition" && (!entry.sourceAnchor || entry.sourceAnchor === usage.formulaAnchorId) && familiesCompatible(semanticFamily(entry.text), usage.formulaFamily));
      if (candidates.length !== 1) continue;
      const entry = candidates[0];
      entry.kind = "source_definition";
      entry.groundingStatus = "source-anchored";
      entry.sourceAnchor = usage.formulaAnchorId;
      entry.sourceAnchorTitle = anchor?.title ?? usage.formulaAnchorId;
      entry.formulaFamily = usage.formulaFamily;
      entry.matchReason = "linked existing symbolic definition after contract/page compatibility verification";
      entry.justification = `Canonical symbolic definition for ${usage.formulaAnchorId}; existing page notation was verified against source evidence and unit concepts.`;
      counts.definitionsLinked += 1;
      changed = true;
    } else if (decision.action === "added_existing_definition" && anchor?.exactText) {
      entries.unshift({
        kind: "source_definition",
        text: anchor.exactText,
        normalizedText: normalizeFormulaText(anchor.exactText),
        groundingStatus: "source-anchored",
        sourceAnchor: usage.formulaAnchorId,
        sourceAnchorTitle: anchor.title,
        formulaFamily: usage.formulaFamily,
        matchReason: "inserted verbatim from canonical source formula evidence",
        justification: `Canonical symbolic source definition for ${usage.formulaAnchorId}; no notation was invented.`,
      });
      counts.definitionsAdded += 1;
      changed = true;
    }
  }

  entries.forEach((entry, entryIndex) => {
    if (entry.kind !== "worked_example") return;
    if ((entry.basedOnFormula && state.sourceAnchors[entry.basedOnFormula]?.kind === "formula") || entry.formulaFamily) return;
    counts.orphanWorkedExamplesBefore += 1;
    const decision = resolveWorkedExampleLineage(entry, page, index, state);
    if (decision.action === "assign_lineage") {
      entry.basedOnFormula = decision.basedOnFormula;
      entry.formulaFamily = decision.formulaFamily;
      entry.groundingStatus = "conceptual-helper";
      delete entry.sourceAnchor;
      entry.matchReason = decision.reason;
      counts.workedExamplesRelined += 1;
      changed = true;
    } else if (decision.action === "reclassify_conceptual_helper") {
      entry.kind = "conceptual_helper";
      entry.groundingStatus = "conceptual-helper";
      delete entry.sourceAnchor;
      delete entry.basedOnFormula;
      entry.matchReason = decision.reason;
      entry.justification = "Illustrative notation retained in learner content but excluded from worked-example lineage requirements.";
      counts.workedExamplesReclassified += 1;
      changed = true;
    } else if (decision.action === "remove_metadata_only") {
      entries[entryIndex] = { ...entry, kind: "__remove__" };
      counts.metadataEntriesRemoved += 1;
      changed = true;
    }
  });
  entries = entries.filter((entry) => entry.kind !== "__remove__");
  entries = normalizeAffectedFormulaMetadata(entries);
  let rawFm = replaceFormulaMetadata(parsed.rawFrontmatter, entries);
  if (sourceAnchorRemovals.size > 0 || sourceAnchorAdditions.size > 0) {
    const previousSourceAnchors = fmArray(rawFm, "sourceAnchors");
    const nextSourceAnchors = [...new Set([
      ...previousSourceAnchors.filter((anchorId) => !sourceAnchorRemovals.has(anchorId)),
      ...sourceAnchorAdditions,
    ])].sort();
    if (previousSourceAnchors.slice().sort().join("\0") !== nextSourceAnchors.join("\0")) {
      rawFm = setFmArray(rawFm, "sourceAnchors", nextSourceAnchors);
      changed = true;
    }
  }
  const definitionAnchors = entries.filter(isDefinition).map((entry) => String(entry.sourceAnchor ?? "")).filter((id) => FORMULA_ID_RE.test(id));
  const previous = fmArray(rawFm, "sourceFormulaAnchors");
  const nextAnchors = [...new Set([...previous.filter((id) => definitionAnchors.includes(id)), ...definitionAnchors])].sort();
  if (previous.slice().sort().join("\0") !== nextAnchors.join("\0")) {
    rawFm = setFmArray(rawFm, "sourceFormulaAnchors", nextAnchors);
    counts.sourceFormulaAnchorArraysUpdated.push(page.rel);
    changed = true;
  }
  return changed ? joinMarkdown(rawFm, parsed.body) : undefined;
}

function preserveCoverageFrontmatter(existing: string, body: string): string {
  const parsed = parseMarkdown(existing);
  return parsed.hadFrontmatter ? joinMarkdown(parsed.rawFrontmatter, body) : body;
}

function snapshotFiles(files: Iterable<string>): Map<string, string | null> {
  const snapshot = new Map<string, string | null>();
  for (const abs of files) snapshot.set(abs, fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : null);
  return snapshot;
}

function restoreFiles(snapshot: Map<string, string | null>): void {
  for (const [abs, content] of snapshot) {
    if (content === null) {
      if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
    } else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, "utf-8");
    }
  }
}

function writeIfChanged(abs: string, content: string, changed: string[], gardenDir: string): boolean {
  const previous = fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : "";
  if (previous === content) return false;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
  const rel = path.relative(gardenDir, abs).replace(/\\/g, "/");
  if (!changed.includes(rel)) changed.push(rel);
  return true;
}

function emptyResult(before: string): FormulaProjectionReconciliationResult {
  return {
    passed: false,
    formulaIdentitiesVerified: 0,
    registryFamilyCorrections: 0,
    contractAssignmentsChecked: 0,
    contractAssignmentsRepaired: 0,
    contractAnchorLeaksRemoved: 0,
    assignmentsReplaced: 0,
    assignmentsMoved: 0,
    incompatibleAssignmentsFound: 0,
    ambiguousAssignmentsSentToChatMock: 0,
    identityConflicts: [],
    definitionsAdded: 0,
    definitionsLinked: 0,
    wrongFamilyPageEntriesRepaired: 0,
    workedExamplesRelined: 0,
    workedExamplesReclassified: 0,
    metadataEntriesRemoved: 0,
    orphanWorkedExamplesBefore: 0,
    chatMockCallsUsed: 0,
    sourceFormulaAnchorArraysUpdated: [],
    sourceLedgerRecordsUpdated: [],
    sourceCoverageRegenerated: false,
    unresolvedIssues: [],
    changedFiles: [],
    stateFingerprintBefore: before,
    stateFingerprintAfter: before,
    rolledBack: false,
    formulaLedgerModesChanged: 0,
    sourceCoverageEntriesRegenerated: 0,
    remainingFormulaFamilyMismatches: 0,
  };
}

/** Synchronous deterministic transaction used by the synchronous export
 * finalizer. The async public wrapper below adds the bounded ChatMock path. */
export function reconcileFinalFormulaProjectionsDeterministic(
  gardenDir: string,
  gardenSlug: string,
  options: { strictMode: boolean } = { strictMode: true },
): FormulaProjectionReconciliationResult {
  let state = buildFinalGardenState(gardenDir, gardenSlug);
  const beforeFingerprint = stateFingerprint(state);
  const result = emptyResult(beforeFingerprint);
  const beforeFormulaIssues = auditFormulaProjections(state);
  const beforeGlobal = auditFinalGardenState(state).problems;
  const coveragePath = path.join(gardenDir, ".breadboard", "planning", "Source Coverage.md");
  const contractPath = contractPathFor(gardenDir);
  const identityPath = formulaIdentityRegistryPath(gardenDir);
  const touchedCandidates = [
    ...state.pages.map((page) => page.abs), ledgerPath(gardenDir), coveragePath, identityPath,
    ...(contractPath ? [contractPath] : []),
  ];
  const snapshot = snapshotFiles(touchedCandidates);

  try {
    let identities = buildFormulaIdentityRegistry(state.sourceAnchors, gardenDir);
    result.formulaIdentitiesVerified = identities.filter((identity) => identity.verified).length;
    result.registryFamilyCorrections = identities.filter((identity) => {
      const declared = normalizeFormulaSemanticFamily(state.sourceAnchors[identity.anchorId]?.formulaFamily);
      return Boolean(identity.verified && declared && declared !== identity.family);
    }).length;
    result.identityConflicts = identities.flatMap((identity): FormulaIdentityConflict[] => {
      const declared = normalizeFormulaSemanticFamily(state.sourceAnchors[identity.anchorId]?.formulaFamily);
      if (!identity.verified) {
        return [{
          anchorId: identity.anchorId,
          declaredFamily: declared,
          conflict: "ambiguous_identity",
          affectedUnitIds: state.learningUnitContract.units.filter((unit) => contractFormulaIds(state, unit).includes(identity.anchorId)).map((unit) => unit.id),
          affectedPages: state.pages.filter((page) => page.sourceFormulaAnchors.includes(identity.anchorId)).map((page) => page.rel),
          repairAction: "needs_chatmock",
          reason: identity.evidence.reason,
        }];
      }
      if (declared && declared !== identity.family) {
        return [{
          anchorId: identity.anchorId,
          declaredFamily: declared,
          verifiedFamily: identity.family,
          conflict: "registry_family_wrong",
          affectedUnitIds: state.learningUnitContract.units.filter((unit) => contractFormulaIds(state, unit).includes(identity.anchorId)).map((unit) => unit.id),
          affectedPages: state.pages.filter((page) => page.sourceFormulaAnchors.includes(identity.anchorId)).map((page) => page.rel),
          repairAction: "update_formula_registry",
          reason: identity.problems.find((problem) => problem.includes("conflicts")) ?? identity.evidence.reason,
        }];
      }
      return [];
    });
    writeIfChanged(identityPath, renderFormulaIdentityRegistry(identities, result.identityConflicts), result.changedFiles, gardenDir);

    const contractRepair = repairContractAnchorLeaksAndProvenance(gardenDir, state, identities);
    if (contractRepair.content && contractPath) {
      writeIfChanged(contractPath, contractRepair.content, result.changedFiles, gardenDir);
      result.contractAnchorLeaksRemoved += contractRepair.leaksRemoved;
      result.contractAssignmentsRepaired += contractRepair.leaksRemoved;
      state = buildFinalGardenState(gardenDir, gardenSlug);
      identities = buildFormulaIdentityRegistry(state.sourceAnchors, gardenDir);
    }

    let index = buildCanonicalFormulaUsageIndex(gardenDir, state);
    const contractMoves: Array<{ anchorId: string; fromUnitId: string; targetUnitId: string }> = [];
    const contractReplacements: Array<{
      anchorId: string;
      fromUnitId: string;
      replacement: CanonicalFormulaIdentity;
      moveCurrentToUnitId?: string;
    }> = [];
    for (const unit of state.learningUnitContract.units) {
      const pages = state.pages.filter((page) => page.learningUnitId === unit.id);
      for (const anchorId of contractFormulaIds(state, unit)) {
        result.contractAssignmentsChecked += 1;
        if (pages.length !== 1) continue;
        const compatibility = verifyContractFormulaCompatibility(anchorId, unit, pages[0], state);
        if (compatibility.compatible) continue;
        result.incompatibleAssignmentsFound += 1;
        const replacement = bestReplacementForUnit(anchorId, unit, pages[0], state, identities);
        const target = bestCompatibleTarget(anchorId, unit.id, state);
        if (replacement) {
          contractReplacements.push({
            anchorId,
            fromUnitId: unit.id,
            replacement: replacement.identity,
            moveCurrentToUnitId: target?.unit.id,
          });
        } else if (target) {
          contractMoves.push({ anchorId, fromUnitId: unit.id, targetUnitId: target.unit.id });
        }
      }
    }
    for (const repair of contractReplacements) {
      const next = replaceContractFormulaAssignment(
        gardenDir,
        repair.anchorId,
        repair.replacement,
        repair.fromUnitId,
        repair.moveCurrentToUnitId,
        identities.find((candidate) => candidate.anchorId === repair.anchorId),
      );
      if (!next || !contractPath) continue;
      writeIfChanged(contractPath, next, result.changedFiles, gardenDir);
      result.contractAssignmentsRepaired += 1;
      result.assignmentsReplaced += 1;
      if (repair.moveCurrentToUnitId) result.assignmentsMoved += 1;
    }
    for (const move of contractMoves) {
      const identity = identities.find((candidate) => candidate.anchorId === move.anchorId);
      const next = moveContractAssignment(gardenDir, move.anchorId, move.fromUnitId, move.targetUnitId, identity?.verified ? identity.family : undefined, identity);
      if (!next || !contractPath) continue;
      writeIfChanged(contractPath, next, result.changedFiles, gardenDir);
      result.contractAssignmentsRepaired += 1;
      result.assignmentsMoved += 1;
    }
    if (contractMoves.length > 0 || contractReplacements.length > 0) {
      state = buildFinalGardenState(gardenDir, gardenSlug);
      index = buildCanonicalFormulaUsageIndex(gardenDir, state);
    }

    for (const page of state.pages) {
      const required = (index.byPagePath[page.rel] ?? []).filter((usage) => usage.requiredByContract);
      const next = pageFormulaRepair(page, required, state, index, identities, result);
      if (next) writeIfChanged(page.abs, next, result.changedFiles, gardenDir);
    }

    // Rebuild before deriving the ledger. Page metadata, not a stale ledger or
    // stale Source Coverage file, determines each formula usage mode.
    state = buildFinalGardenState(gardenDir, gardenSlug);
    index = buildCanonicalFormulaUsageIndex(gardenDir, state);
    const ledger = readJson<Array<Record<string, unknown>>>(ledgerPath(gardenDir), []);
    let ledgerChanged = false;
    for (const record of ledger) {
      const anchorId = String(record.sourceVisualId ?? "");
      if (!FORMULA_ID_RE.test(anchorId)) continue;
      const usages = index.byAnchorId[anchorId] ?? [];
      const mode = derivedModeForAnchor(usages);
      if (String(record.conceptUsage ?? "") !== mode) {
        record.conceptUsage = mode;
        result.sourceLedgerRecordsUpdated.push(anchorId);
        result.formulaLedgerModesChanged += 1;
        ledgerChanged = true;
      }
      const desiredStatus = mode === "missing" ? "unassigned" : mode === "intentionally_omitted" ? "intentionally_skipped" : "assigned";
      if (String(record.usageStatus ?? "") !== desiredStatus) {
        record.usageStatus = desiredStatus;
        ledgerChanged = true;
      }
    }
    if (ledgerChanged) writeIfChanged(ledgerPath(gardenDir), `${JSON.stringify(ledger, null, 2)}\n`, result.changedFiles, gardenDir);

    state = buildFinalGardenState(gardenDir, gardenSlug);
    index = buildCanonicalFormulaUsageIndex(gardenDir, state);
    const coverageBody = renderSourceCoverageFromFinalState(state, index);
    const previousCoverage = fs.existsSync(coveragePath) ? fs.readFileSync(coveragePath, "utf-8") : "";
    const coverage = preserveCoverageFrontmatter(previousCoverage, coverageBody);
    result.sourceCoverageRegenerated = writeIfChanged(coveragePath, coverage, result.changedFiles, gardenDir);
    result.sourceCoverageEntriesRegenerated = Object.keys(index.byAnchorId).length;

    const finalState = buildFinalGardenState(gardenDir, gardenSlug);
    const afterFormulaIssues = auditFormulaProjections(finalState);
    const afterGlobal = auditFinalGardenState(finalState).problems;
    result.remainingFormulaFamilyMismatches = afterFormulaIssues.filter((issue) =>
      issue.subproblems.some((problem) => /incompatible|family|identity/i.test(problem)),
    ).length + afterGlobal.filter((problem) => /formula.*(?:incompatible|family)|source formula anchor.*no compatible/i.test(problem)).length;
    const newGlobal = afterGlobal.filter((problem) => !beforeGlobal.includes(problem));
    const changed = result.changedFiles.length > 0;
    const blockersDecreased = afterFormulaIssues.length < beforeFormulaIssues.length;
    const regression = newGlobal.length > 0 || (changed && !blockersDecreased && beforeFormulaIssues.length > 0);
    if (regression) {
      result.rollbackReason = newGlobal.length > 0
        ? `new global blocker(s): ${newGlobal.join("; ")}`
        : `formula blocker count did not decrease (${beforeFormulaIssues.length} -> ${afterFormulaIssues.length})`;
      restoreFiles(snapshot);
      result.rolledBack = true;
      result.changedFiles = [];
      result.sourceFormulaAnchorArraysUpdated = [];
      result.sourceLedgerRecordsUpdated = [];
      result.sourceCoverageRegenerated = false;
      const restored = buildFinalGardenState(gardenDir, gardenSlug);
      result.stateFingerprintAfter = stateFingerprint(restored);
      result.unresolvedIssues = auditFormulaProjections(restored).map(toFinalRepairIssue);
      result.passed = false;
      return result;
    }
    result.stateFingerprintAfter = stateFingerprint(finalState);
    result.unresolvedIssues = afterFormulaIssues.map(toFinalRepairIssue);
    result.passed = afterFormulaIssues.length === 0 && (options.strictMode ? afterGlobal.length === 0 : true);
    return result;
  } catch (error) {
    result.rollbackReason = error instanceof Error ? error.message : String(error);
    restoreFiles(snapshot);
    result.rolledBack = true;
    result.changedFiles = [];
    const restored = buildFinalGardenState(gardenDir, gardenSlug);
    result.stateFingerprintAfter = stateFingerprint(restored);
    result.unresolvedIssues = auditFormulaProjections(restored).map(toFinalRepairIssue);
    result.unresolvedIssues.push({
      id: "formula_usage_projection:transaction_failed",
      type: "formula_usage_projection",
      severity: "blocking",
      message: error instanceof Error ? error.message : String(error),
      evidence: { rolledBack: true },
      repairMode: "non_repairable",
    });
    return result;
  }
}

function bodyExcerpts(page: FinalGardenPage): string[] {
  return page.body.split(/\n{2,}/).map((paragraph) => paragraph.replace(/\s+/g, " ").trim()).filter((paragraph) => paragraph.length >= 30).slice(0, 6);
}

export function buildFormulaUsageRepairPacket(
  issue: FinalRepairIssue,
  state: FinalGardenState,
  index: CanonicalFormulaUsageIndex,
): FormulaUsageRepairPacket | null {
  const page = state.pages.find((candidate) => candidate.rel === issue.pagePath);
  const unit = state.learningUnitContract.units.find((candidate) => candidate.id === (issue.unitId ?? page?.learningUnitId));
  if (!page || !unit) return null;
  const requiredIds = contractFormulaIds(state, unit);
  const pageEntries = parseFormulaMetadataEntries(page.rawFrontmatter);
  const ambiguousWorkedExample = issue.id.startsWith("formula_worked_example:");
  const candidateIds = ambiguousWorkedExample
    ? [...new Set(index.byPagePath[page.rel]?.map((usage) => usage.formulaAnchorId) ?? [])]
    : requiredIds;
  return {
    pagePath: page.rel,
    pageTitle: page.title,
    unitId: unit.id,
    issue: ambiguousWorkedExample
      ? "ambiguous_worked_example_lineage"
      : issue.message.includes("incompatible_contract_assignment")
        ? "contract_formula_compatibility"
        : "missing_source_definition",
    pageFormulaEntries: pageEntries,
    relevantBodyExcerpts: bodyExcerpts(page),
    contractRequiredFormulas: requiredIds.map((anchorId) => {
      const anchor = state.sourceAnchors[anchorId];
      return { anchorId, title: anchor?.title ?? anchorId, exactText: anchor?.exactText, semanticSummary: anchor?.semanticSummary, formulaFamily: anchor?.formulaFamily };
    }),
    candidateDefinitions: candidateIds.flatMap((anchorId) => {
      const anchor = state.sourceAnchors[anchorId];
      if (!anchor?.exactText) return [];
      return [{ anchorId, text: anchor.exactText, formulaFamily: anchor.formulaFamily, compatibilityReason: "existing canonical source-formula record" }];
    }),
    allowedActions: ambiguousWorkedExample
      ? ["assign_worked_example_lineage", "reclassify_as_conceptual_helper", "remove_metadata_entry"]
      : ["attach_existing_formula", "move_contract_assignment", "reject_formula_usage"],
  };
}

export function verifyFormulaUsageRepairDecision(
  packet: FormulaUsageRepairPacket,
  decision: FormulaUsageRepairDecision,
  state: FinalGardenState,
): { accepted: boolean; reason: string } {
  if (!packet.allowedActions.includes(decision.action)) return { accepted: false, reason: "action was not offered in the packet" };
  if (!decision.reason?.trim()) return { accepted: false, reason: "decision has no reason" };
  const offeredAnchors = new Set([
    ...packet.contractRequiredFormulas.map((formula) => formula.anchorId),
    ...packet.candidateDefinitions.map((formula) => formula.anchorId),
  ]);
  if (decision.formulaAnchorId && !offeredAnchors.has(decision.formulaAnchorId)) return { accepted: false, reason: "decision invented or selected an unoffered formula anchor" };
  if ((decision.action === "assign_worked_example_lineage" || decision.action === "attach_existing_formula") && !decision.formulaAnchorId) return { accepted: false, reason: "formula action lacks formulaAnchorId" };
  if (typeof decision.entryIndex === "number" && !packet.pageFormulaEntries[decision.entryIndex]) return { accepted: false, reason: "entryIndex does not resolve in the packet" };
  if (decision.formulaAnchorId && (decision.action === "attach_existing_formula" || decision.action === "assign_worked_example_lineage")) {
    const page = state.pages.find((candidate) => candidate.rel === packet.pagePath);
    const unit = state.learningUnitContract.units.find((candidate) => candidate.id === packet.unitId);
    const anchor = state.sourceAnchors[decision.formulaAnchorId];
    if (!page || !unit || !anchor) return { accepted: false, reason: "formula assignment target does not resolve" };
    try {
      assertFormulaAssignmentCompatible(verifyCanonicalFormulaIdentity(anchor, state.rootPath), unit, page);
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : "formula compatibility guard rejected the decision" };
    }
  }
  if (decision.action === "move_contract_assignment") {
    if (!decision.targetUnitId || !state.learningUnitContract.units.some((unit) => unit.id === decision.targetUnitId)) return { accepted: false, reason: "target unit does not exist" };
    const anchorId = decision.formulaAnchorId ?? packet.contractRequiredFormulas[0]?.anchorId;
    const unit = state.learningUnitContract.units.find((candidate) => candidate.id === decision.targetUnitId);
    const pages = state.pages.filter((page) => page.learningUnitId === decision.targetUnitId);
    if (!anchorId || !unit || pages.length !== 1 || !verifyContractFormulaCompatibility(anchorId, unit, pages[0], state).compatible) {
      return { accepted: false, reason: "target unit/page is not independently compatible with the formula" };
    }
  }
  if (decision.action === "attach_existing_formula") {
    const entry = typeof decision.entryIndex === "number" ? packet.pageFormulaEntries[decision.entryIndex] : undefined;
    const candidates = entry ? [entry] : packet.pageFormulaEntries.filter((candidate) => formulaStructuralKind(candidate.text) === "definition" && !candidate.sourceAnchor);
    if (candidates.length !== 1 || formulaStructuralKind(candidates[0].text) !== "definition") {
      return { accepted: false, reason: "attach decision does not identify exactly one existing symbolic definition" };
    }
  }
  if (decision.action === "assign_worked_example_lineage") {
    const entry = typeof decision.entryIndex === "number" ? packet.pageFormulaEntries[decision.entryIndex] : undefined;
    const anchor = decision.formulaAnchorId ? state.sourceAnchors[decision.formulaAnchorId] : undefined;
    if (!entry || entry.kind !== "worked_example" || !anchor || !familiesCompatible(entry.formulaFamily ?? semanticFamily(entry.text), anchor.formulaFamily ?? semanticFamily(anchor.title))) {
      return { accepted: false, reason: "worked example and selected definition are not independently lineage-compatible" };
    }
  }
  return { accepted: true, reason: "decision uses only packet evidence and allowed actions" };
}

function applyVerifiedFormulaDecision(
  gardenDir: string,
  packet: FormulaUsageRepairPacket,
  decision: FormulaUsageRepairDecision,
  state: FinalGardenState,
): string[] {
  const changed: string[] = [];
  const page = state.pages.find((candidate) => candidate.rel === packet.pagePath);
  if (decision.action === "move_contract_assignment") {
    const anchorId = decision.formulaAnchorId ?? packet.contractRequiredFormulas[0]?.anchorId;
    if (!anchorId || !decision.targetUnitId) return changed;
    const abs = contractPathFor(gardenDir);
    const anchor = state.sourceAnchors[anchorId];
    const identity = anchor?.kind === "formula"
      ? verifyCanonicalFormulaIdentity(anchor, state.rootPath)
      : undefined;
    const next = moveContractAssignment(gardenDir, anchorId, packet.unitId, decision.targetUnitId, identity?.verified ? identity.family : undefined, identity);
    if (abs && next) writeIfChanged(abs, next, changed, gardenDir);
    return changed;
  }
  if (!page || decision.action === "reject_formula_usage") return changed;
  const content = fs.readFileSync(page.abs, "utf-8");
  const parsed = parseMarkdown(content);
  const entries = parseFormulaMetadataEntries(parsed.rawFrontmatter);
  const entryIndex = typeof decision.entryIndex === "number"
    ? decision.entryIndex
    : entries.findIndex((entry) => formulaStructuralKind(entry.text) === "definition" && !entry.sourceAnchor);
  const entry = entries[entryIndex];
  if (!entry) return changed;
  if (decision.action === "attach_existing_formula" && decision.formulaAnchorId) {
    const anchor = state.sourceAnchors[decision.formulaAnchorId];
    entry.kind = "source_definition";
    entry.groundingStatus = "source-anchored";
    entry.sourceAnchor = decision.formulaAnchorId;
    entry.sourceAnchorTitle = anchor?.title ?? decision.formulaAnchorId;
    entry.formulaFamily = anchor?.formulaFamily ?? semanticFamily(`${anchor?.title ?? ""} ${entry.text}`);
    entry.matchReason = `verified ChatMock selection: ${decision.reason}`;
  } else if (decision.action === "assign_worked_example_lineage" && decision.formulaAnchorId) {
    const anchor = state.sourceAnchors[decision.formulaAnchorId];
    entry.kind = "worked_example";
    entry.groundingStatus = "conceptual-helper";
    entry.basedOnFormula = decision.formulaAnchorId;
    entry.formulaFamily = anchor?.formulaFamily ?? semanticFamily(entry.text);
    delete entry.sourceAnchor;
    entry.matchReason = `verified ChatMock lineage: ${decision.reason}`;
  } else if (decision.action === "reclassify_as_conceptual_helper") {
    entry.kind = "conceptual_helper";
    entry.groundingStatus = "conceptual-helper";
    delete entry.sourceAnchor;
    delete entry.basedOnFormula;
    entry.matchReason = `verified ChatMock classification: ${decision.reason}`;
  } else if (decision.action === "remove_metadata_entry") {
    entries.splice(entryIndex, 1);
  } else {
    return changed;
  }
  let rawFm = replaceFormulaMetadata(parsed.rawFrontmatter, entries);
  const anchors = entries.filter(isDefinition).map((candidate) => candidate.sourceAnchor ?? "").filter((id) => FORMULA_ID_RE.test(id));
  rawFm = setFmArray(rawFm, "sourceFormulaAnchors", anchors);
  writeIfChanged(page.abs, joinMarkdown(rawFm, parsed.body), changed, gardenDir);
  return changed;
}

function mergeReconciliationResults(
  base: FormulaProjectionReconciliationResult,
  next: FormulaProjectionReconciliationResult,
): FormulaProjectionReconciliationResult {
  const numeric = [
    "formulaIdentitiesVerified", "registryFamilyCorrections", "contractAssignmentsChecked",
    "contractAssignmentsRepaired", "contractAnchorLeaksRemoved", "assignmentsReplaced", "assignmentsMoved",
    "incompatibleAssignmentsFound", "ambiguousAssignmentsSentToChatMock", "definitionsAdded",
    "definitionsLinked", "wrongFamilyPageEntriesRepaired", "workedExamplesRelined", "workedExamplesReclassified",
    "metadataEntriesRemoved", "orphanWorkedExamplesBefore", "formulaLedgerModesChanged",
  ] as const;
  for (const key of numeric) base[key] += next[key];
  base.passed = next.passed;
  base.rolledBack ||= next.rolledBack;
  base.unresolvedIssues = next.unresolvedIssues;
  base.stateFingerprintAfter = next.stateFingerprintAfter;
  base.sourceCoverageRegenerated ||= next.sourceCoverageRegenerated;
  base.sourceCoverageEntriesRegenerated = next.sourceCoverageEntriesRegenerated;
  base.remainingFormulaFamilyMismatches = next.remainingFormulaFamilyMismatches;
  base.identityConflicts = [...base.identityConflicts, ...next.identityConflicts];
  base.changedFiles = [...new Set([...base.changedFiles, ...next.changedFiles])];
  base.sourceFormulaAnchorArraysUpdated = [...new Set([...base.sourceFormulaAnchorArraysUpdated, ...next.sourceFormulaAnchorArraysUpdated])];
  base.sourceLedgerRecordsUpdated = [...new Set([...base.sourceLedgerRecordsUpdated, ...next.sourceLedgerRecordsUpdated])];
  return base;
}

/** Public bounded reconciliation entry point. Deterministic reconciliation runs
 * first. ChatMock is invoked only for residual ambiguity, and every structured
 * decision is independently checked before any later repair path may apply it.
 * Unsupported/invalid decisions remain blockers. */
export async function reconcileFinalFormulaProjections(
  gardenDir: string,
  gardenSlug: string,
  options: {
    maxChatMockCalls: number;
    strictMode: boolean;
    formulaRepairModel?: FormulaUsageRepairModel;
    formulaIdentityRepairModel?: FormulaIdentityRepairModel;
  },
): Promise<FormulaProjectionReconciliationResult> {
  const result = reconcileFinalFormulaProjectionsDeterministic(gardenDir, gardenSlug, { strictMode: options.strictMode });
  if (result.unresolvedIssues.length === 0 || (!options.formulaRepairModel && !options.formulaIdentityRepairModel) || options.maxChatMockCalls <= 0) return result;
  let state = buildFinalGardenState(gardenDir, gardenSlug);
  let index = buildCanonicalFormulaUsageIndex(gardenDir, state);
  const chatSnapshot = snapshotFiles([
    ...state.pages.map((page) => page.abs),
    ...(contractPathFor(gardenDir) ? [contractPathFor(gardenDir)!] : []),
    ledgerPath(gardenDir),
    formulaIdentityRegistryPath(gardenDir),
    path.join(gardenDir, ".breadboard", "planning", "Source Coverage.md"),
  ]);
  const issuesBeforeChat = result.unresolvedIssues.length;
  const modelChanged: string[] = [];
  for (const issue of result.unresolvedIssues.slice(0, options.maxChatMockCalls)) {
    if (options.formulaIdentityRepairModel && issue.anchorId) {
      const page = state.pages.find((candidate) => candidate.rel === issue.pagePath);
      const unit = state.learningUnitContract.units.find((candidate) => candidate.id === (issue.unitId ?? page?.learningUnitId));
      const anchor = state.sourceAnchors[issue.anchorId];
      if (page && unit && anchor?.kind === "formula") {
        const identities = buildFormulaIdentityRegistry(state.sourceAnchors, gardenDir);
        const currentIdentity = identities.find((identity) => identity.anchorId === issue.anchorId);
        if (currentIdentity) {
          const candidates = findCompatibleFormulaAssignments(unit, page, identities);
          const identityPacket = buildFormulaIdentityRepairPacket({
            issueId: issue.id,
            currentIdentity,
            declaredFamily: anchor.formulaFamily,
            unit,
            page,
            candidates,
          });
          result.chatMockCallsUsed += 1;
          result.ambiguousAssignmentsSentToChatMock += 1;
          let identityDecision: FormulaIdentityRepairDecision | null = null;
          try { identityDecision = await options.formulaIdentityRepairModel(identityPacket); } catch { identityDecision = null; }
          if (identityDecision) {
            const verified = verifyFormulaIdentityRepairDecision(identityPacket, identityDecision, identities);
            if (verified.accepted && identityDecision.action === "replace_contract_assignment" && identityDecision.replacementAnchorId) {
              const replacement = identities.find((identity) => identity.anchorId === identityDecision!.replacementAnchorId);
              const target = bestCompatibleTarget(issue.anchorId, unit.id, state);
              if (replacement) {
                const next = replaceContractFormulaAssignment(gardenDir, issue.anchorId, replacement, unit.id, target?.unit.id, currentIdentity);
                const abs = contractPathFor(gardenDir);
                if (next && abs) writeIfChanged(abs, next, modelChanged, gardenDir);
              }
            }
          }
          state = buildFinalGardenState(gardenDir, gardenSlug);
          index = buildCanonicalFormulaUsageIndex(gardenDir, state);
          if (result.chatMockCallsUsed >= options.maxChatMockCalls) break;
          continue;
        }
      }
    }
    if (!options.formulaRepairModel || result.chatMockCallsUsed >= options.maxChatMockCalls) continue;
    const packet = buildFormulaUsageRepairPacket(issue, state, index);
    if (!packet) continue;
    result.chatMockCallsUsed += 1;
    let decision: FormulaUsageRepairDecision | null = null;
    try { decision = await options.formulaRepairModel(packet); } catch { decision = null; }
    if (!decision) continue;
    const verified = verifyFormulaUsageRepairDecision(packet, decision, state);
    if (!verified.accepted) continue;
    modelChanged.push(...applyVerifiedFormulaDecision(gardenDir, packet, decision, state));
    state = buildFinalGardenState(gardenDir, gardenSlug);
  }
  if (modelChanged.length === 0) return result;
  const afterModel = reconcileFinalFormulaProjectionsDeterministic(gardenDir, gardenSlug, { strictMode: options.strictMode });
  if (afterModel.unresolvedIssues.length >= issuesBeforeChat || afterModel.rolledBack) {
    restoreFiles(chatSnapshot);
    result.stateFingerprintAfter = stateFingerprint(buildFinalGardenState(gardenDir, gardenSlug));
    return result;
  }
  mergeReconciliationResults(result, afterModel);
  result.changedFiles = [...new Set([...result.changedFiles, ...modelChanged])];
  return result;
}
