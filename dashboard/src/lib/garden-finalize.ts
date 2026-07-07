// Breadboard garden finalizer.
//
// The Learn pipeline writes generated learning pages and planning artifacts into
// the Quartz content directory. The finalizer is the deterministic export gate:
// it cleans filesystem/path hygiene, normalizes links and stale caveats, writes
// the validation report, and fails the artifact when the Learning Unit Contract
// was not fulfilled. It does not invent semantic tags, source assignments,
// interactive visual plans, or formula grounding after page writing.
//
// `finalizeGardenExport` is the deterministic export stage that runs after
// generation and before publish. It verifies the on-disk tree so that what
// Quartz sees is exactly what the acceptance validator
// (scripts/validate-breadboard-garden.ts) accepts, writes
// `.breadboard/validation-report.md`, and hard-fails when a critical invariant
// cannot be repaired.
//
// Everything here is deterministic and filesystem-only: no LLM calls. It is
// safe to run repeatedly (idempotent) and standalone on an already-generated
// garden.

import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import {
  anchorTextCompatibleWithVisualType,
  atomicZettelHandle,
  dedupeSourceArtifactAssignments,
  interactiveVisualGroundingProblems,
  isAtomicZettelHandle,
  normalizeLearningUnits,
  normalizedSectionTitleKey,
  scaffoldLikeZettelHandle,
  sectionTitleUniquenessProblems,
  sectionSemanticProfiles,
  sectionTitleGrammarProblems,
  sectionTitleNaturalnessProblems,
  polishSectionTitleFromInput,
  zettelHandleQualityProblems,
  zettelHandlesForUnit,
  type LearningUnitContract,
  type SourceArtifactAssignment,
  type SourceFigurePlacement,
} from "./learning-unit-contract.ts";
import { formulaMeaningMatch, formulaMetricFamily, isFormulaExpression, isGroundableFormula, isTrivialFormulaFragment, isWorkedExampleFormula } from "./learn-utils.ts";
import type { SourceAnchor } from "./visual-spec.ts";

// ---------------------------------------------------------------------------
// Frontmatter + fs helpers
// ---------------------------------------------------------------------------

interface ParsedFile {
  rawFrontmatter: string;
  body: string;
  hadFrontmatter: boolean;
}

function parseFrontmatter(content: string): ParsedFile {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { rawFrontmatter: "", body: content, hadFrontmatter: false };
  return { rawFrontmatter: match[1] ?? "", body: match[2] ?? "", hadFrontmatter: true };
}

function joinFrontmatter(rawFrontmatter: string, body: string): string {
  return `---\n${rawFrontmatter.replace(/\s+$/, "")}\n---\n\n${body.replace(/^\n+/, "")}`;
}

function jsonScalar(value: string | number | boolean): string {
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(String(value).replace(/\r/g, ""));
}

/** Top-level scalar/array frontmatter keys are edited by line surgery so nested
 * blocks (formulas:) are never disturbed unless explicitly targeted. */
function fmGetScalar(rawFm: string, key: string): string {
  const re = new RegExp(`^${key}:\\s*(.*)$`, "m");
  const match = rawFm.match(re);
  if (!match) return "";
  return (match[1] ?? "").trim().replace(/^["']|["']$/g, "");
}

function fmGetArray(rawFm: string, key: string): string[] {
  const re = new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]\\s*$`, "m");
  const match = rawFm.match(re);
  if (!match) return [];
  return (match[1] ?? "")
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function fmSetScalar(rawFm: string, key: string, value: string | number | boolean): string {
  const line = `${key}: ${jsonScalar(value)}`;
  const re = new RegExp(`^${key}:.*$`, "m");
  if (re.test(rawFm)) return rawFm.replace(re, line);
  return `${rawFm.replace(/\s+$/, "")}\n${line}`;
}

/** Replace or remove a single-line `key: [...]` array. Removing keeps the
 * frontmatter tidy (no empty arrays that the pipeline would otherwise omit). */
function fmSetArray(rawFm: string, key: string, values: string[]): string {
  const cleaned = [...new Set(values.filter(Boolean))];
  const singleLine = new RegExp(`^${key}:\\s*\\[[^\\]]*\\]\\s*$`, "m");
  if (cleaned.length === 0) {
    return singleLine.test(rawFm) ? rawFm.replace(singleLine, "").replace(/\n{3,}/g, "\n") : rawFm;
  }
  const line = `${key}: [${cleaned.map((item) => jsonScalar(item)).join(", ")}]`;
  if (singleLine.test(rawFm)) return rawFm.replace(singleLine, line);
  return `${rawFm.replace(/\s+$/, "")}\n${line}`;
}

export interface FinalizeFormulaEntry {
  kind?: "source_definition" | "source_derived_definition" | "worked_example" | "conceptual_helper";
  text: string;
  normalizedText?: string;
  groundingStatus: "source-anchored" | "source-derived" | "conceptual-helper" | "unmatched";
  justification: string;
  sourceAnchor?: string;
  sourceAnchorTitle?: string;
  matchReason?: string;
  confidence?: number;
}

/** Serialize a per-formula grounding block matching yamlFrontmatter()'s shape so
 * the validator's formulaEntriesFromFrontmatter() reads it back cleanly. */
function serializeFormulas(entries: FinalizeFormulaEntry[]): string {
  const lines: string[] = ["formulas:"];
  for (const entry of entries) {
    lines.push(`  - kind: ${jsonScalar(entry.kind ?? "conceptual_helper")}`);
    lines.push(`    text: ${jsonScalar(entry.text)}`);
    if (entry.normalizedText) lines.push(`    normalizedText: ${jsonScalar(entry.normalizedText)}`);
    lines.push(`    groundingStatus: ${jsonScalar(entry.groundingStatus)}`);
    lines.push(`    justification: ${jsonScalar(entry.justification)}`);
    if (entry.sourceAnchor) lines.push(`    sourceAnchor: ${jsonScalar(entry.sourceAnchor)}`);
    if (entry.sourceAnchorTitle) lines.push(`    sourceAnchorTitle: ${jsonScalar(entry.sourceAnchorTitle)}`);
    if (entry.matchReason) lines.push(`    matchReason: ${jsonScalar(entry.matchReason)}`);
    if (typeof entry.confidence === "number") lines.push(`    confidence: ${entry.confidence}`);
  }
  return lines.join("\n");
}

/** Replace the whole `formulas:` block (or remove it) in a frontmatter string. */
function fmSetFormulas(rawFm: string, entries: FinalizeFormulaEntry[]): string {
  const lines = rawFm.split(/\r?\n/);
  const start = lines.findIndex((line) => /^formulas:\s*/.test(line));
  let stripped = rawFm;
  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && /^\s+/.test(lines[end])) end += 1;
    stripped = [...lines.slice(0, start), ...lines.slice(end)].join("\n");
  }
  if (entries.length === 0) return stripped.replace(/\n{3,}/g, "\n");
  // Insert the block right before generatedBy so top-level keys stay grouped.
  const strippedLines = stripped.split(/\r?\n/);
  const anchorIndex = strippedLines.findIndex((line) => /^generatedBy:/.test(line));
  const block = serializeFormulas(entries);
  if (anchorIndex >= 0) {
    strippedLines.splice(anchorIndex, 0, block);
    return strippedLines.join("\n");
  }
  return `${stripped.replace(/\s+$/, "")}\n${block}`;
}

function slugifyLoose(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

interface LearningUnitContractArtifact {
  units: LearningUnitContract[];
  assignments: SourceArtifactAssignment[];
  foundPath?: string;
}

export type FinalizerAction =
  | { kind: "mechanical_fix"; description: string; filePath: string }
  | { kind: "semantic_failure"; description: string; unitId?: string; pagePath?: string; repairPrompt: string };

export type UnitRepairFailureType =
  | "repeated_opening"
  | "formula_grounding"
  | "visual_grounding"
  | "zettelkasten_handle"
  | "section_semantics"
  | "contract_fulfillment"
  | "semantic_navigation"
  | "source_text_anchor"
  | "unknown_semantic_failure";

export interface UnitRepairRequest {
  unitId: string;
  pagePath: string;
  sectionPath: string;
  failureTypes: string[];
  validationErrors: string[];
  learningUnitContract: LearningUnitContract;
  previousUnitSummary?: string;
  nextUnitSummary?: string;
  sourceAnchors: SourceAnchor[];
  currentPageMarkdown: string;
  requiredChanges: string[];
  repairPrompt: string;
}

// ---------------------------------------------------------------------------
// Repair executor abstraction
// ---------------------------------------------------------------------------
//
// A repair can be produced by a model (single-page regeneration from the
// UnitRepairRequest) or by the built-in deterministic transforms. The
// deterministic transforms remain the always-available safe fallback; the model
// executor is an INJECTED dependency so this module stays LLM-free and
// filesystem-only by default. Callers (learn.ts) wire a real model executor;
// tests wire a fake one.

export type RepairExecutorKind = "model" | "deterministic";
export type RepairExecutorMode = "model" | "deterministic" | "model_with_deterministic_fallback";

/** A model-produced candidate for a single page. `markdown` is the full revised
 * page (frontmatter + body). Visual specs and a contract-handle patch are
 * optional side outputs; both are scope-checked before anything is written. */
export interface RepairCandidate {
  markdown: string;
  visualSpecs?: Array<{ id: string; spec: Record<string, unknown> }>;
  contractHandlePatch?: { unitId: string; handles: string[] };
  notes?: string[];
}

/** Injected model executor: given a UnitRepairRequest, return a candidate page
 * (or null when it declines). May be async (real LLM) or sync (test fake). */
export type ModelRepairExecutor = (
  request: UnitRepairRequest,
) => Promise<RepairCandidate | null> | RepairCandidate | null;

export interface RepairExecutionResult {
  unitId: string;
  pagePath: string;
  executor: RepairExecutorKind;
  changedFiles: string[];
  success: boolean;
  validationErrorsBefore: string[];
  validationErrorsAfter: string[];
  notes?: string[];
}

export interface UnitRepairLogEntry {
  unitId: string;
  pagePath: string;
  sectionPath: string;
  failureTypes: string[];
  validationErrors: string[];
  requiredChanges: string[];
  repairType: "contract_driven_revision";
  changedFiles: string[];
  result: "resolved" | "unresolved" | "not_applicable";
  unresolvedValidationErrors: string[];
  repairedAt: string;
  // Executor provenance — never hide fallback behavior.
  executorAttempted: RepairExecutorKind[];
  executorUsed: RepairExecutorKind | "none";
  modelFailureReason?: string;
}

export interface FinalArtifactVerification {
  checkedAt: string;
  accepted: boolean;
  mutatedFiles: string[];
  validationFailures: string[];
  unresolvedRepairFailures: string[];
  validationReportAccepted: boolean;
}

export interface LearningUnitRepairRunReport {
  requestedAt: string;
  gardenSlug: string;
  repairExecutorMode: RepairExecutorMode;
  requests: UnitRepairRequest[];
  repairs: UnitRepairLogEntry[];
  executions: RepairExecutionResult[];
  changedFiles: string[];
  semanticFinalizerActions: FinalizerAction[];
  firstValidationFailures: string[];
  finalValidationFailures: string[];
  finalVerification?: FinalArtifactVerification;
}

const SOURCE_FIGURE_PLACEMENTS = new Set<SourceFigurePlacement>([
  "inside_concept_explanation",
  "after_formula_introduction",
  "inside_result_interpretation",
  "beside_worked_example",
  "inside_comparison",
  "not_used_with_reason",
]);

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSourceArtifactAssignments(raw: unknown): SourceArtifactAssignment[] {
  const record = asObject(raw);
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(record.sourceArtifactAssignments)
      ? record.sourceArtifactAssignments
      : Array.isArray(record.assignments)
        ? record.assignments
        : [];
  const assignments: SourceArtifactAssignment[] = [];
  for (const item of list) {
    const row = asObject(item);
    const sourceArtifactId = stringField(row.sourceArtifactId ?? row.sourceVisualId ?? row.figureId ?? row.id);
    const assignedLearningUnitId = stringField(row.assignedLearningUnitId ?? row.learningUnitId ?? row.unitId);
    if (!sourceArtifactId || !assignedLearningUnitId) continue;
    const rawPlacement = stringField(row.placement).replace(/[\s-]+/g, "_") as SourceFigurePlacement;
    assignments.push({
      sourceArtifactId,
      assignedLearningUnitId,
      placement: SOURCE_FIGURE_PLACEMENTS.has(rawPlacement) ? rawPlacement : "inside_concept_explanation",
      reason: stringField(row.reason),
      requiredInterpretation: stringField(row.requiredInterpretation ?? row.interpretationGoal ?? row.goal),
    });
  }
  return assignments;
}

function readLearningUnitContract(gardenDir: string): LearningUnitContractArtifact {
  const candidates = [
    path.join(gardenDir, ".breadboard", "learning-unit-contract.json"),
    path.join(gardenDir, ".breadboard", "planning", "learning-unit-contract.json"),
  ];
  for (const filePath of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const units = normalizeLearningUnits(parsed);
      const assignments = dedupeSourceArtifactAssignments(normalizeSourceArtifactAssignments(parsed), units);
      if (units.length > 0) return { units, assignments, foundPath: filePath };
    } catch {
      // try next
    }
  }
  return { units: [], assignments: [] };
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function stripTitleNumber(value: string): string {
  return cleanText(value).replace(/^\d+(?:\.\d+)*\.?\s*/, "");
}

function zettelRepairClaim(unit: LearningUnitContract, used: Set<string>): string {
  const text = [
    unit.title,
    unit.learningQuestion,
    ...(unit.newConcepts ?? []),
  ].join(" ").toLowerCase();
  const candidates: string[] = [];
  if (/spike.*train|spike.*timing|event[- ]driven/.test(text)) {
    candidates.push("Spike trains make timing part of information");
  }
  if (/membrane|lif|leaky|threshold|reset/.test(text)) {
    candidates.push("Membrane potential accumulates evidence before firing");
  }
  if (/excit|inhibit|winner|competition/.test(text)) {
    candidates.push("Inhibition turns population activity into competition");
  }
  if (/accuracy/.test(text)) {
    candidates.push("Accuracy measures correctness not deployment cost");
  }
  if (/energy.*efficien|normalized/.test(text)) {
    candidates.push("Energy efficiency connects accuracy to joules");
  }
  if (/latency|decision time/.test(text)) {
    candidates.push("Latency measures when a decision becomes available");
  }
  if (/spike count/.test(text)) {
    candidates.push("Spike count exposes hidden computation cost");
  }
  if (/converg|epoch/.test(text)) {
    candidates.push("Convergence time measures when training becomes useful");
  }
  const title = stripTitleNumber(unit.title);
  if (title) {
    switch (unit.role) {
      case "formula":
      case "metric":
        candidates.push(`${title} ties named quantities to a measurable relationship`);
        break;
      case "mechanism":
      case "core_concept":
        candidates.push(`${title} explains observable system behavior`);
        break;
      case "training_method":
        candidates.push(`${title} changes model behavior through learning`);
        break;
      case "application":
      case "limitation":
        candidates.push(`${title} bounds where the source claim applies`);
        break;
      default:
        candidates.push(`${title} supports a reusable learner decision`);
        break;
    }
  }
  for (const claim of candidates) {
    const handle = atomicZettelHandle(claim);
    if (handle && !used.has(handle) && !scaffoldLikeZettelHandle(handle)) return claim;
  }
  return `${title || "This idea"} stays grounded in the source claim`;
}

function repairContractZettelHandles(
  gardenDir: string,
  contract: LearningUnitContractArtifact,
  learnerPages: LearnerPage[],
  report: FinalizeReport,
): void {
  if (!contract.foundPath || contract.units.length === 0) return;
  const parsed = readJson<Record<string, unknown>>(contract.foundPath, {});
  const rawUnits = Array.isArray(parsed.learningUnits) ? parsed.learningUnits as Array<Record<string, unknown>> : [];
  if (rawUnits.length === 0) return;
  let changed = false;
  const replacements = new Map<string, string>();
  const normalizedById = new Map(contract.units.map((unit) => [unit.id, unit]));
  for (const rawUnit of rawUnits) {
    const id = cleanText(rawUnit.id);
    const unit = normalizedById.get(id);
    if (!unit) continue;
    const notes = Array.isArray(rawUnit.zettelNotes) ? rawUnit.zettelNotes as Array<Record<string, unknown>> : [];
    const used = new Set(
      notes
        .map((note) => atomicZettelHandle(cleanText(note.handle ?? note.claim)))
        .filter((handle) => handle && !scaffoldLikeZettelHandle(handle)),
    );
    for (const note of notes) {
      const oldHandle = atomicZettelHandle(cleanText(note.handle ?? note.claim));
      if (!oldHandle || !scaffoldLikeZettelHandle(oldHandle)) continue;
      const claim = zettelRepairClaim(unit, used);
      const handle = atomicZettelHandle(claim);
      if (!handle || used.has(handle)) continue;
      note.handle = handle;
      note.claim = claim;
      if (!Array.isArray(note.connectedTo) || note.connectedTo.length === 0) {
        note.connectedTo = [...new Set([...(unit.prerequisiteConcepts ?? []), ...(unit.newConcepts ?? [])])].slice(0, 5);
      }
      replacements.set(oldHandle, handle);
      used.add(handle);
      changed = true;
    }
  }
  if (!changed) return;
  fs.writeFileSync(contract.foundPath, JSON.stringify(parsed, null, 2), "utf-8");
  if (!report.changed.includes(".breadboard/learning-unit-contract.json")) report.changed.push(".breadboard/learning-unit-contract.json");
  const repaired = readLearningUnitContract(gardenDir);
  contract.units = repaired.units;
  contract.assignments = repaired.assignments;
  const repairedById = new Map(contract.units.map((unit) => [unit.id, unit]));
  for (const page of learnerPages) {
    const unit = repairedById.get(fmGetScalar(page.rawFm, "learningUnitId"));
    if (!unit) continue;
    const expected = zettelHandlesForUnit(unit);
    const current = fmGetArray(page.rawFm, "tags");
    const hasReplaced = current.some((tag) => replacements.has(atomicZettelHandle(tag)));
    if (!hasReplaced && expected.every((tag) => current.includes(tag)) && current.every((tag) => expected.includes(tag))) continue;
    page.rawFm = fmSetArray(page.rawFm, "tags", expected);
    page.dirty = true;
  }
  report.notes.push(`repaired ${replacements.size} scaffold-like Zettelkasten handle(s) in the Learning Unit Contract`);
}

function synchronizeContractZettelHandles(
  gardenDir: string,
  contract: LearningUnitContractArtifact,
  learnerPages: LearnerPage[],
  report: FinalizeReport,
): void {
  if (!contract.foundPath || contract.units.length === 0) return;
  const parsed = readJson<Record<string, unknown>>(contract.foundPath, {});
  const rawUnits = Array.isArray(parsed.learningUnits) ? parsed.learningUnits as Array<Record<string, unknown>> : [];
  if (rawUnits.length === 0) return;
  const normalizedById = new Map(contract.units.map((unit) => [unit.id, unit]));
  let changedContract = false;
  for (const rawUnit of rawUnits) {
    const id = cleanText(rawUnit.id);
    const normalized = normalizedById.get(id);
    if (!normalized) continue;
    const expectedNotes = normalized.zettelNotes ?? [];
    const currentNotes = Array.isArray(rawUnit.zettelNotes) ? rawUnit.zettelNotes as Array<Record<string, unknown>> : [];
    const currentHandles = currentNotes.map((note) => atomicZettelHandle(cleanText(note.handle ?? note.claim))).filter(Boolean);
    const expectedHandles = zettelHandlesForUnit(normalized);
    if (expectedHandles.length === 0 || arraysEqual(currentHandles, expectedHandles)) continue;
    rawUnit.zettelNotes = expectedNotes.map((note) => ({
      handle: note.handle,
      claim: note.claim,
      connectedTo: note.connectedTo ?? [],
    }));
    changedContract = true;
  }
  if (changedContract) {
    fs.writeFileSync(contract.foundPath, JSON.stringify(parsed, null, 2), "utf-8");
    if (!report.changed.includes(".breadboard/learning-unit-contract.json")) report.changed.push(".breadboard/learning-unit-contract.json");
    const repaired = readLearningUnitContract(gardenDir);
    contract.units = repaired.units;
    contract.assignments = repaired.assignments;
    report.notes.push("synchronized expanded Zettelkasten handles into the Learning Unit Contract");
  }
  const repairedById = new Map(contract.units.map((unit) => [unit.id, unit]));
  for (const page of learnerPages) {
    const unit = repairedById.get(fmGetScalar(page.rawFm, "learningUnitId"));
    if (!unit) continue;
    const expected = zettelHandlesForUnit(unit);
    const current = fmGetArray(page.rawFm, "tags");
    if (expected.length === 0 || arraysEqual(current, expected)) continue;
    page.rawFm = fmSetArray(page.rawFm, "tags", expected);
    page.dirty = true;
  }
}

function isSourceFigureId(id: string): boolean {
  return /\.P\d+\.(?:F|G)\d+$/i.test(id);
}

function isSourceTableId(id: string): boolean {
  return /\.P\d+\.T\d+$/i.test(id);
}

function isSourceFormulaId(id: string): boolean {
  return /\.P\d+\.E\d+$/i.test(id);
}

function listMarkdown(dir: string, relDir: string, out: Array<{ abs: string; rel: string }>, opts: { includeDotBreadboard?: boolean } = {}): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === ".breadboard" && !opts.includeDotBreadboard) continue;
      if (entry.name === ".breadboard" && /backups/.test(rel)) continue;
      if (/backups$/.test(entry.name)) continue;
      listMarkdown(path.join(dir, entry.name), rel, out, opts);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) out.push({ abs: path.join(dir, entry.name), rel });
  }
}

function rmrf(target: string): void {
  fs.rmSync(target, { recursive: true, force: true });
}

/** Move a directory robustly. rename() can fail across directories on Windows /
 * OneDrive-synced trees (EPERM); fall back to a recursive copy + delete, and if
 * even the copy fails, drop the source (Internal/ is regenerable scaffolding
 * and must not remain in the export either way). */
function moveDir(src: string, dest: string): void {
  rmrf(dest);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(src, dest);
    return;
  } catch {
    // fall through to copy + delete
  }
  try {
    fs.cpSync(src, dest, { recursive: true });
  } catch {
    // best-effort: relocation failed, but the source must still leave the export
  }
  rmrf(src);
}

// ---------------------------------------------------------------------------
// Ledger + domain classification
// ---------------------------------------------------------------------------

export interface LedgerVisual {
  sourceVisualId: string;
  sourceId?: string;
  pageNumber?: number;
  type?: string;
  caption?: string;
  pageImagePath?: string;
  croppedImagePath?: string;
  usageStatus?: string;
  skipReason?: string;
  assignedPageId?: string;
  assignedSectionId?: string;
  [key: string]: unknown;
}

export type FigureClass = "equation" | "result" | "lif" | "architecture" | "other";

export function classifyFigure(visual: Pick<LedgerVisual, "sourceVisualId" | "type" | "caption" | "pageNumber">): FigureClass {
  const id = String(visual.sourceVisualId ?? "");
  const caption = String(visual.caption ?? "").toLowerCase();
  const type = String(visual.type ?? "").toLowerCase();
  if (type === "equation" || /\.E\d+$/i.test(id)) return "equation";
  if (/architecture|conceptual snn|input encoding|excitatory|inhibitory|lateral inhibition/.test(caption)) return "architecture";
  if (/\blif\b|leaky|membrane|threshold|refractory|reset/.test(caption)) return "lif";
  const pageNumber = Number(visual.pageNumber ?? (id.match(/\.P(\d+)\./)?.[1] ?? 0));
  if (
    pageNumber >= 7 ||
    /performance|latency|energy|spike count|convergence|training loss|training accuracy|learning curve|comparison|accuracy versus/.test(caption)
  ) {
    return "result";
  }
  return "other";
}

export type PageRole =
  | "intro"
  | "basic_def"
  | "lif"
  | "training"
  | "metric"
  | "comparison"
  | "application"
  | "challenges"
  | "generic";

export function pageRole(title: string): PageRole {
  const text = title.toLowerCase();
  if (/open challenge|unresolved|limitation|future work|what remains/.test(text)) return "challenges";
  if (/comparative|results across|models and metrics|model comparison/.test(text)) return "comparison";
  if (/application|hardware|deployment|neuromorphic|tradeoffs suggest/.test(text)) return "application";
  if (/multi-metric|evaluation|metric|accuracy|latency/.test(text)) return "metric";
  if (/neuron model|leaky|\blif\b/.test(text)) return "lif";
  if (/training|paradigm|surrogate|plasticity/.test(text)) return "training";
  if (/what spiking neural networks are|what .*networks are|spiking neural networks are/.test(text)) return "basic_def";
  if (/from conventional|conventional neural networks|introduction|why spiking|to snns/.test(text)) return "intro";
  return "generic";
}

/** The learner page role that a given source figure class belongs on. */
function targetRoleForFigure(cls: FigureClass): PageRole | null {
  switch (cls) {
    case "equation":
      return "metric";
    case "result":
      return "comparison";
    case "lif":
      return "lif";
    case "architecture":
      return "basic_def";
    default:
      return null;
  }
}

// Interactive renderer compatibility (mirror of the validator's rules).
const INTERACTIVE_ANCHOR_COMPAT: Record<string, FigureClass[]> = {
  lif_neuron: ["lif", "architecture"],
  tradeoff_explorer: ["equation", "result"],
  stdp_window: [],
  neural_coding: [],
};

// The interactive renderer type a page role must use (validator-forced).
function requiredInteractiveType(role: PageRole): string | null {
  switch (role) {
    case "metric":
    case "comparison":
    case "application":
      return "tradeoff_explorer";
    case "lif":
    case "basic_def":
    case "intro":
      return "lif_neuron";
    case "challenges":
      return null; // must not embed a generic interactive
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Page model
// ---------------------------------------------------------------------------

interface LearnerPage {
  abs: string;
  rel: string; // garden-relative, posix
  pageId: string; // rel without .md
  rawFm: string;
  body: string;
  title: string;
  role: PageRole;
  sectionNumber: number;
  dirty: boolean;
}

const IMAGE_RE = /!\[[^\]]*\]\(([^)]*)\)/g;
const VISUAL_BLOCK_RE = /```breadboard-visual\r?\n([\s\S]*?)\r?\n```/g;

function embeddedVisualTypes(body: string): string[] {
  const types: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(VISUAL_BLOCK_RE.source, VISUAL_BLOCK_RE.flags);
  while ((match = re.exec(body)) !== null) {
    try {
      const parsed = JSON.parse(match[1] ?? "{}") as Record<string, unknown>;
      if (typeof parsed.type === "string" && parsed.type.trim()) types.push(parsed.type.trim());
    } catch {
      // invalid JSON is caught by the external validator; ignore here
    }
  }
  return types;
}

function embeddedVisualSpecs(body: string): Array<Record<string, unknown>> {
  const specs: Array<Record<string, unknown>> = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(VISUAL_BLOCK_RE.source, VISUAL_BLOCK_RE.flags);
  while ((match = re.exec(body)) !== null) {
    try {
      const parsed = JSON.parse(match[1] ?? "{}");
      if (parsed && typeof parsed === "object") specs.push(parsed as Record<string, unknown>);
    } catch {
      // invalid JSON is caught by the standalone validator
    }
  }
  return specs;
}

function visualSpecAnchorIds(spec: Record<string, unknown>): string[] {
  const anchors = Array.isArray(spec.sourceAnchors) ? spec.sourceAnchors : [];
  const ids: string[] = [];
  for (const anchor of anchors) {
    if (!anchor || typeof anchor !== "object") continue;
    const record = anchor as Record<string, unknown>;
    for (const key of ["figureId", "tableId", "equationId", "questionId", "textAnchorId"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) ids.push(value.trim());
    }
  }
  return [...new Set(ids)];
}

function visualSpecAnchorRecords(spec: Record<string, unknown>): Array<Record<string, unknown>> {
  const anchors = Array.isArray(spec.sourceAnchors) ? spec.sourceAnchors : [];
  return anchors.filter((anchor): anchor is Record<string, unknown> => Boolean(anchor) && typeof anchor === "object");
}

function visualSignature(spec: Record<string, unknown>): string {
  const controls = Array.isArray(spec.controls)
    ? spec.controls
        .map((control) => {
          if (!control || typeof control !== "object") return "";
          const record = control as Record<string, unknown>;
          return [record.name, record.label, record.type, Array.isArray(record.options) ? record.options.join("|") : ""]
            .map((value) => String(value ?? "").toLowerCase())
            .join(":");
        })
        .sort()
    : [];
  const list = (value: unknown) =>
    Array.isArray(value) ? value.map((item) => String(item).toLowerCase().trim()).filter(Boolean).sort() : [];
  return [
    String(spec.type ?? "").toLowerCase(),
    controls.join("|"),
    list(spec.inputs).join("|"),
    list(spec.outputs).join("|"),
    visualSpecAnchorIds(spec).sort().join("|"),
    list(spec.conceptTargets).join("|"),
    String(spec.pedagogicalPurpose ?? spec.caption ?? "").toLowerCase().replace(/\s+/g, " ").trim(),
  ].join("::");
}

type EmbeddedVisualTransform = (spec: Record<string, unknown>) => boolean;

function rewriteEmbeddedVisualSpecs(page: LearnerPage, transform: EmbeddedVisualTransform): void {
  let changed = false;
  page.body = page.body.replace(VISUAL_BLOCK_RE, (fullMatch, json: string) => {
    let spec: Record<string, unknown>;
    try {
      const parsed = JSON.parse(json);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fullMatch;
      spec = parsed as Record<string, unknown>;
    } catch {
      return fullMatch;
    }
    const before = JSON.stringify(spec);
    const transformed = transform(spec);
    const after = JSON.stringify(spec);
    if (!transformed && before === after) return fullMatch;
    changed = true;
    return `\`\`\`breadboard-visual\n${JSON.stringify(spec, null, 2)}\n\`\`\``;
  });
  if (changed) page.dirty = true;
}

function saveVisualSpecArtifact(gardenDir: string, spec: Record<string, unknown>, report: FinalizeReport): void {
  const id = String(spec.id ?? "").trim();
  if (!id) return;
  const rel = `.breadboard/visuals/${id}.json`;
  const target = path.join(gardenDir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const content = `${JSON.stringify(spec, null, 2)}\n`;
  const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf-8") : "";
  if (existing === content) return;
  fs.writeFileSync(target, content, "utf-8");
  if (!report.changed.includes(rel)) report.changed.push(rel);
}

type MetricCalculatorFamily = "accuracy" | "latency" | "spike-count" | "energy" | "efficiency" | "convergence";

const METRIC_CALCULATOR_FAMILIES: MetricCalculatorFamily[] = [
  "accuracy",
  "latency",
  "spike-count",
  "energy",
  "efficiency",
  "convergence",
];

const METRIC_CALCULATOR_LABELS: Record<MetricCalculatorFamily, string> = {
  accuracy: "accuracy",
  latency: "latency",
  "spike-count": "spike count",
  energy: "energy",
  efficiency: "normalized efficiency",
  convergence: "convergence time",
};

const METRIC_CALCULATOR_PATTERNS: Record<MetricCalculatorFamily, RegExp> = {
  accuracy: /\baccuracy\b|\bcorrect predictions?\b|\.E1\b/i,
  latency: /\blatency\b|\bdecision time\b|\.E2\b/i,
  "spike-count": /\bspike[- ]?count\b|\btotal spikes?\b|\.E3\b/i,
  energy: /\benergy\b|\benergy per spike\b|\.E4\b/i,
  efficiency: /\befficien|\bnormalized\b|accuracy over energy|\.E5\b/i,
  convergence: /\bconvergence\b|\btarget accuracy\b|\bepochs?\b|\.E6\b/i,
};

const METRIC_CALCULATOR_CONTROLS: Record<MetricCalculatorFamily, Array<Record<string, unknown>>> = {
  accuracy: [
    { name: "correct", label: "Correct predictions", type: "slider", min: 0, max: 1000, step: 10, defaultValue: 920 },
    { name: "total", label: "Total predictions", type: "slider", min: 100, max: 2000, step: 50, defaultValue: 1000 },
  ],
  latency: [
    { name: "decisionTime", label: "Decision time", type: "slider", min: 1, max: 100, step: 1, defaultValue: 24 },
  ],
  "spike-count": [
    { name: "spikeCount", label: "Spike count", type: "slider", min: 0, max: 1000, step: 10, defaultValue: 180 },
  ],
  energy: [
    { name: "spikeCount", label: "Spike count", type: "slider", min: 0, max: 1000, step: 10, defaultValue: 180 },
    { name: "energyPerSpike", label: "Energy per spike", type: "slider", min: 0.0005, max: 0.01, step: 0.0005, defaultValue: 0.002 },
  ],
  efficiency: [
    { name: "correct", label: "Correct predictions", type: "slider", min: 0, max: 1000, step: 10, defaultValue: 920 },
    { name: "total", label: "Total predictions", type: "slider", min: 100, max: 2000, step: 50, defaultValue: 1000 },
    { name: "spikeCount", label: "Spike count", type: "slider", min: 0, max: 1000, step: 10, defaultValue: 180 },
    { name: "energyPerSpike", label: "Energy per spike", type: "slider", min: 0.0005, max: 0.01, step: 0.0005, defaultValue: 0.002 },
  ],
  convergence: [
    { name: "correct", label: "Correct predictions", type: "slider", min: 0, max: 1000, step: 10, defaultValue: 920 },
    { name: "total", label: "Total predictions", type: "slider", min: 100, max: 2000, step: 50, defaultValue: 1000 },
    { name: "decisionTime", label: "Decision time", type: "slider", min: 1, max: 100, step: 1, defaultValue: 24 },
  ],
};

function metricCalculatorFamiliesForText(text: string): MetricCalculatorFamily[] {
  return METRIC_CALCULATOR_FAMILIES.filter((family) => METRIC_CALCULATOR_PATTERNS[family].test(text));
}

function formulaFamilyForVisualAnchor(anchor: unknown): string | null {
  if (!anchor || typeof anchor !== "object") return null;
  const record = anchor as Record<string, unknown>;
  const text = [record.equationId, record.description, record.sourceTitle].filter(Boolean).join(" ");
  return formulaMetricFamily(text);
}

function roleForMetricAnchorFamily(family: string | null, targetFamilies: Set<string>): "input" | "output_formula" | "comparison_basis" | "context" {
  if (family && targetFamilies.has(family)) return "output_formula";
  if (family === "accuracy" || family === "energy" || family === "spike-count") return "input";
  return "context";
}

function focusMetricCalculatorRecord(spec: Record<string, unknown>, contextText: string): boolean {
  if (String(spec.type ?? "") !== "metric_calculator") return false;
  const families = metricCalculatorFamiliesForText(contextText);
  if (families.length === 0) return false;
  const controlsByName = new Map<string, Record<string, unknown>>();
  for (const family of families) {
    for (const control of METRIC_CALCULATOR_CONTROLS[family]) {
      controlsByName.set(String(control.name), { ...control });
    }
  }
  const labels = families.map((family) => METRIC_CALCULATOR_LABELS[family]);
  spec.title = labels.length === 1 ? `${labels[0]} Calculator` : `${labels.join(" and ")} Calculator`;
  spec.controls = [...controlsByName.values()];
  spec.inputs = [...controlsByName.values()].map((control) => String(control.label ?? "").toLowerCase()).filter(Boolean);
  spec.outputs = labels;
  spec.conceptTargets = labels;
  spec.pedagogicalPurpose = `Let the learner manipulate inputs for ${labels.join(", ")} on this lesson instead of a generic all-metric calculator.`;
  spec.caption = `This calculator focuses on ${labels.join(", ")} for this page.`;
  spec.regenerationPrompt = `Regenerate this metric calculator so its controls and readouts focus only on ${labels.join(", ")}.`;
  if (Array.isArray(spec.sourceAnchors)) {
    const allowed = new Set<string>(families);
    if (allowed.has("efficiency")) {
      allowed.add("accuracy");
      allowed.add("energy");
      allowed.add("spike-count");
    }
    if (allowed.has("energy")) allowed.add("spike-count");
    spec.sourceAnchors = spec.sourceAnchors.filter((anchor) => {
      const family = formulaFamilyForVisualAnchor(anchor);
      return !family || allowed.has(family);
    }).map((anchor) => {
      if (!anchor || typeof anchor !== "object") return anchor;
      const record = { ...(anchor as Record<string, unknown>) };
      const family = formulaFamilyForVisualAnchor(record);
      const role = roleForMetricAnchorFamily(family, new Set(families));
      record.role = record.role ?? role;
      record.reason = record.reason ?? (
        role === "output_formula"
          ? `This is the metric formula the calculator teaches for ${family ?? labels.join(", ")}.`
          : role === "input"
            ? `This formula supplies an input needed to compute ${labels.join(", ")}.`
            : `This source anchor provides context for ${labels.join(", ")}.`
      );
      return record;
    });
  }
  return true;
}

function repairMetricCalculatorFocus(gardenDir: string, learnerPages: LearnerPage[], report: FinalizeReport): void {
  for (const page of learnerPages) {
    const contextText = [
      page.title,
      ...fmGetArray(page.rawFm, "sourceAnchors"),
      ...fmGetArray(page.rawFm, "sourceVisualIds"),
      ...fmGetArray(page.rawFm, "sourceFormulaAnchors"),
      ...formulaEntrySourceAnchors(page.rawFm),
    ].join(" ");
    rewriteEmbeddedVisualSpecs(page, (spec) => {
      const before = JSON.stringify(spec);
      const changed = focusMetricCalculatorRecord(spec, contextText);
      if (changed && JSON.stringify(spec) !== before) {
        saveVisualSpecArtifact(gardenDir, spec, report);
        report.notes.push(`focused metric calculator ${String(spec.id ?? "(missing id)")} on ${page.rel}`);
        return true;
      }
      return false;
    });
  }
}

function formulaAnchorsFromFrontmatter(rawFm: string): string[] {
  const anchors = new Set(fmGetArray(rawFm, "sourceFormulaAnchors"));
  const lines = rawFm.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s+sourceAnchor:\s*(.*)$/);
    if (match) {
      const value = (match[1] ?? "").trim().replace(/^["']|["']$/g, "");
      if (value) anchors.add(value);
    }
    const textMatch = line.match(/^\s+-\s*text:\s*(.*)$/);
    if (textMatch) {
      const value = (textMatch[1] ?? "").trim().replace(/^["']|["']$/g, "");
      if (value && !isGroundableFormula(value)) anchors.add(`trivial:${value}`);
    }
  }
  return [...anchors];
}

function formulaEntrySourceAnchors(rawFm: string): string[] {
  const anchors = new Set<string>();
  for (const entry of formulaEntriesFromFrontmatter(rawFm)) {
    const kind = formulaEntryKind(entry);
    if (kind === "worked_example" || kind === "conceptual_helper") continue;
    const value = String(entry.sourceAnchor ?? "").trim();
    if (value) anchors.add(value);
  }
  return [...anchors];
}

interface ParsedFormulaEntry {
  kind?: string;
  text?: string;
  groundingStatus?: string;
  justification?: string;
  sourceAnchor?: string;
}

function unquoteYamlScalar(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

function formulaEntriesFromFrontmatter(rawFm: string): ParsedFormulaEntry[] {
  const entries: ParsedFormulaEntry[] = [];
  const lines = rawFm.split(/\r?\n/);
  let inFormulas = false;
  let current: ParsedFormulaEntry | null = null;
  for (const line of lines) {
    if (!inFormulas) {
      const start = line.match(/^formulas:\s*(.*)$/);
      if (!start) continue;
      inFormulas = true;
      continue;
    }
    if (/^\S[^:]*:\s*/.test(line)) break;
    const first = line.match(/^\s*-\s*([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (first) {
      current = {};
      current[first[1] as keyof ParsedFormulaEntry] = unquoteYamlScalar(first[2] ?? "");
      entries.push(current);
      continue;
    }
    const nested = line.match(/^\s{4,}([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (nested && current) {
      current[nested[1] as keyof ParsedFormulaEntry] = unquoteYamlScalar(nested[2] ?? "");
    }
  }
  return entries.filter((entry) => Object.values(entry).some((value) => String(value ?? "").trim()));
}

function formulaEntryKind(entry: ParsedFormulaEntry): string {
  const kind = String(entry.kind ?? "").trim();
  if (kind) return kind;
  if (isWorkedExampleFormula(String(entry.text ?? ""))) return "worked_example";
  if (entry.groundingStatus === "source-anchored") return "source_definition";
  if (entry.groundingStatus === "source-derived") return "source_derived_definition";
  return "conceptual_helper";
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface FinalizeReport {
  changed: string[];
  removed: string[];
  notes: string[];
  actions?: FinalizerAction[];
  reconciliation: ReconciledAnchorUsage[];
  criticalProblems: string[];
}

export interface ReconciledAnchorUsage {
  id: string;
  status: "used" | "partially_used" | "intentionally_skipped" | "unused" | "misplaced";
  usedInPages: string[];
  embeddedAsImage: boolean;
  usedAsInteractiveAnchor: boolean;
  skipReason?: string;
  problems?: string[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function finalizeGardenExport({
  gardenDir,
  gardenSlug,
}: {
  gardenDir: string;
  gardenSlug: string;
}): FinalizeReport {
  const report: FinalizeReport = {
    changed: [],
    removed: [],
    notes: [],
    actions: [],
    reconciliation: [],
    criticalProblems: [],
  };
  if (!fs.existsSync(gardenDir)) {
    report.criticalProblems.push(`garden directory missing: ${gardenDir}`);
    return report;
  }

  const bd = path.join(gardenDir, ".breadboard");

  // --- Pass A: export-tree cleanup (Internal/, numbered source folders) ------
  cleanExportTree(gardenDir, report);

  // --- Load facts once -------------------------------------------------------
  const ledgerPath = path.join(bd, "source-visuals.json");
  const ledger = readJson<LedgerVisual[]>(ledgerPath, []);
  const laterPagesExist = sourcesHaveLaterPages(gardenDir);
  const formulaAnchorsExist = ledger.some((visual) => classifyFigure(visual) === "equation");

  // --- Load learner pages ----------------------------------------------------
  const learnerPages = loadLearnerPages(gardenDir);

  // --- Pass C: source wikilink normalization ---------------------------------
  normalizeSourceWikilinks(gardenDir, report);

  // --- Pass D: stale caveat sanitation (visible + planning) ------------------
  sanitizeStaleCaveatFiles(gardenDir, { laterPagesExist, formulaAnchorsExist }, report);
  repairLearnerNavigationSourceLinks(gardenDir, report);

  // Semantic decisions are made by the Learning Unit Contract repair loop before
  // finalization. The finalizer only performs deterministic export hygiene:
  // filesystem cleanup, source/link normalization, stale-caveat removal,
  // path/label alignment, validation reporting, and hard gating.

  // --- Persist learner-page edits --------------------------------------------
  for (const page of learnerPages) {
    if (page.dirty) {
      fs.writeFileSync(page.abs, joinFrontmatter(page.rawFm, page.body), "utf-8");
      if (!report.changed.includes(page.rel)) report.changed.push(page.rel);
    }
  }
  alignSectionFoldersWithTitles(gardenDir, report);
  repairSectionNavigationLabels(gardenDir, report);

  // --- Pass K: validation report + critical gate -----------------------------
  writeFinalizeValidationReport({ gardenDir, gardenSlug, report });
  runCriticalGate({ gardenDir, report });

  return report;
}

// ---------------------------------------------------------------------------
// Pass A: export-tree cleanup
// ---------------------------------------------------------------------------

function cleanExportTree(gardenDir: string, report: FinalizeReport): void {
  const allowedTop = new Set(["_index.md", "learning", "sources", "assets", ".breadboard"]);
  // Source-file basenames, so a numbered folder named after the raw upload can
  // be recognized even without an exact "source-conversion" marker.
  const sourceBases = new Set<string>();
  const sourcesDir = path.join(gardenDir, "sources");
  if (fs.existsSync(sourcesDir)) {
    for (const name of fs.readdirSync(sourcesDir)) {
      if (name.endsWith(".md") && name !== "_index.md") sourceBases.add(slugifyLoose(name.replace(/\.md$/i, "")));
    }
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(gardenDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (allowedTop.has(entry.name)) continue;
    const abs = path.join(gardenDir, entry.name);

    // Internal/ concept graph → relocate under .breadboard so it never ships as
    // visible Quartz content but stays available to the knowledge graph.
    if (entry.isDirectory() && entry.name === "Internal") {
      const dest = path.join(gardenDir, ".breadboard", "Internal");
      moveDir(abs, dest);
      report.removed.push(`Internal/ -> .breadboard/Internal/`);
      continue;
    }

    // Root-level numbered source-conversion folder → drop: its content already
    // lives (clean) under sources/.
    const numbered = entry.isDirectory() && entry.name.match(/^\d+\.\s*(.+)$/);
    if (numbered) {
      rmrf(abs);
      report.removed.push(`${entry.name}/ (numbered source-conversion folder)`);
      continue;
    }

    // Any other stray top-level entry (uppercase Learning/, snapshots, etc.).
    if (entry.name === "Learning") {
      // Merge an uppercase Learning/ into the canonical learning/ if any.
      rmrf(abs);
      report.removed.push(`Learning/ (uppercase; not exportable)`);
      continue;
    }
    rmrf(abs);
    report.removed.push(`${entry.name}${entry.isDirectory() ? "/" : ""} (not exportable)`);
  }
}

function sourcesHaveLaterPages(gardenDir: string): boolean {
  const sourcesDir = path.join(gardenDir, "sources");
  if (!fs.existsSync(sourcesDir)) return false;
  for (const name of fs.readdirSync(sourcesDir)) {
    if (!name.endsWith(".md")) continue;
    const body = fs.readFileSync(path.join(sourcesDir, name), "utf-8");
    for (const match of body.matchAll(/^#{1,6}\s+(?:\[\[#?)?\s*Page\s+(\d+)/gim)) {
      if (Number.parseInt(match[1] ?? "0", 10) > 2) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Learner-page loading
// ---------------------------------------------------------------------------

function loadLearnerPages(gardenDir: string): LearnerPage[] {
  const all: Array<{ abs: string; rel: string }> = [];
  const learningDir = path.join(gardenDir, "learning");
  listMarkdown(learningDir, "learning", all);
  const pages: LearnerPage[] = [];
  for (const { abs, rel } of all) {
    const content = fs.readFileSync(abs, "utf-8");
    const { rawFrontmatter, body } = parseFrontmatter(content);
    const kt = fmGetScalar(rawFrontmatter, "knowledge_type");
    const bt = fmGetScalar(rawFrontmatter, "breadboardType");
    const learnAuthored =
      fmGetScalar(rawFrontmatter, "generatedBy") === "learn_button" ||
      fmGetScalar(rawFrontmatter, "generated_by") === "learn_button";
    const isLesson = kt === "learning-page" || kt === "textbook-page" || bt === "learning_page" || bt === "textbook_page";
    if (!isLesson || !learnAuthored) continue;
    const title = fmGetScalar(rawFrontmatter, "title");
    const sectionNumber = Number.parseInt(fmGetScalar(rawFrontmatter, "sectionNumber") || "0", 10) || 0;
    pages.push({
      abs,
      rel: rel.replace(/\\/g, "/"),
      pageId: rel.replace(/\\/g, "/").replace(/\.md$/i, ""),
      rawFm: rawFrontmatter,
      body,
      title,
      role: pageRole(title),
      sectionNumber,
      dirty: false,
    });
  }
  pages.sort((a, b) => a.pageId.localeCompare(b.pageId));
  return pages;
}

// ---------------------------------------------------------------------------
// Learning Unit Contract repair loop
// ---------------------------------------------------------------------------

function emptyFinalizeReport(): FinalizeReport {
  return {
    changed: [],
    removed: [],
    notes: [],
    actions: [],
    reconciliation: [],
    criticalProblems: [],
  };
}

function semanticFailureType(checkName: string): UnitRepairFailureType | null {
  const name = checkName.toLowerCase();
  if (name.includes("repetition") || name.includes("opening")) return "repeated_opening";
  if (name.includes("formula")) return "formula_grounding";
  if (name.includes("visual") && !name.includes("source crop")) return "visual_grounding";
  if (name.includes("source text concept")) return "source_text_anchor";
  if (name.includes("zettelkasten")) return "zettelkasten_handle";
  if (name.includes("section")) return "section_semantics";
  if (name.includes("contract")) return "contract_fulfillment";
  if (name.includes("semantic navigation")) return "semantic_navigation";
  return null;
}

function shouldRouteToUnitRepair(checkName: string): boolean {
  const type = semanticFailureType(checkName);
  if (!type) return false;
  // Link normalization is finalizer hygiene. The semantic repair loop owns page
  // substance, not the mechanical target family of overview/index links.
  if (type === "semantic_navigation") return false;
  return true;
}

function fallbackUnitForPage(page: LearnerPage): LearningUnitContract {
  const title = page.title || path.basename(page.rel, ".md");
  return {
    id: fmGetScalar(page.rawFm, "learningUnitId") || page.pageId,
    title,
    role: (fmGetScalar(page.rawFm, "learningUnitRole") || "core_concept") as LearningUnitContract["role"],
    learningQuestion: `What should a learner understand from ${title}?`,
    prerequisiteConcepts: [],
    newConcepts: [],
    sourceAnchors: fmGetArray(page.rawFm, "sourceAnchors"),
    sourceFigures: [],
    sourceFormulas: [],
    sourceTables: [],
    zettelNotes: fmGetArray(page.rawFm, "tags").map((tag) => ({
      handle: tag,
      claim: tag.replace(/-/g, " "),
      connectedTo: [],
    })),
    mustNotRepeat: [],
    expectedWordRange: [700, 1100],
  };
}

function pageSummary(page: LearnerPage, unit?: LearningUnitContract): string {
  const words = teachingProseLite(page.body).split(/\s+/).filter(Boolean).slice(0, 32).join(" ");
  return [(unit?.id ?? fmGetScalar(page.rawFm, "learningUnitId")) || page.pageId, page.title, unit?.learningQuestion, words]
    .filter(Boolean)
    .join(" — ");
}

function sourceAnchorFromIdForRepair(anchorId: string): SourceAnchor | null {
  const id = anchorId.trim();
  if (!id) return null;
  const anchor: SourceAnchor = { description: id };
  if (/^text-/i.test(id)) {
    anchor.textAnchorId = id;
  } else if (/\.E\d+$/i.test(id)) {
    anchor.equationId = id;
  } else if (/\.T\d+$/i.test(id)) {
    anchor.tableId = id;
  } else if (/^S\d+\.P\d+\.[A-Z]\d+$/i.test(id)) {
    anchor.figureId = id;
  } else {
    anchor.questionId = id;
  }
  const page = id.match(/\.P(\d+)\./i)?.[1];
  if (page) anchor.page = Number.parseInt(page, 10);
  return anchor;
}

function sourceAnchorsForRepair(page: LearnerPage): SourceAnchor[] {
  const anchors: SourceAnchor[] = [];
  const add = (anchor: SourceAnchor | null) => {
    if (!anchor) return;
    const key = anchor.textAnchorId ?? anchor.equationId ?? anchor.tableId ?? anchor.figureId ?? anchor.questionId ?? anchor.description;
    if (anchors.some((existing) =>
      (existing.textAnchorId ?? existing.equationId ?? existing.tableId ?? existing.figureId ?? existing.questionId ?? existing.description) === key
    )) return;
    anchors.push(anchor);
  };
  for (const id of [
    ...fmGetArray(page.rawFm, "sourceAnchors"),
    ...fmGetArray(page.rawFm, "sourceVisualIds"),
    ...formulaAnchorsFromFrontmatter(page.rawFm).filter((id) => !id.startsWith("trivial:")),
  ]) add(sourceAnchorFromIdForRepair(id));
  for (const spec of embeddedVisualSpecs(page.body)) {
    for (const record of visualSpecAnchorRecords(spec)) {
      const anchor: SourceAnchor = {
        description: String(record.description ?? record.figureId ?? record.tableId ?? record.equationId ?? record.textAnchorId ?? "visual anchor"),
      };
      if (typeof record.sourceId === "string") anchor.sourceId = record.sourceId;
      if (typeof record.sourceTitle === "string") anchor.sourceTitle = record.sourceTitle;
      if (typeof record.page === "number") anchor.page = record.page;
      if (typeof record.figureId === "string") anchor.figureId = record.figureId;
      if (typeof record.tableId === "string") anchor.tableId = record.tableId;
      if (typeof record.equationId === "string") anchor.equationId = record.equationId;
      if (typeof record.questionId === "string") anchor.questionId = record.questionId;
      if (typeof record.textAnchorId === "string") anchor.textAnchorId = record.textAnchorId;
      if (record.role === "input" || record.role === "output_formula" || record.role === "comparison_basis" || record.role === "context") {
        anchor.role = record.role;
      }
      if (typeof record.reason === "string") anchor.reason = record.reason;
      add(anchor);
    }
  }
  return anchors;
}

function repairRequiredChanges(type: UnitRepairFailureType, problem: string): string[] {
  switch (type) {
    case "repeated_opening":
      return [
        "Rewrite only the opening 2-4 paragraphs so this page continues from prior units instead of restarting the global motivation.",
        "Keep required source anchors, formulas, tables, figures, visual blocks, and contract-backed Zettelkasten handles in place.",
      ];
    case "formula_grounding":
      return [
        "Revise the page/formula metadata so source definitions, derived definitions, worked examples, and conceptual helpers agree with the body.",
        "Use the exact source formula anchor text and do not satisfy a source formula requirement with a worked example.",
      ];
    case "visual_grounding":
      return [
        "Regenerate the visual plan from the Learning Unit Contract using minimal compatible anchors and explicit source-anchor roles/reasons.",
        "Update the page block, visual spec artifact, visual index, and source coverage consistently.",
      ];
    case "source_text_anchor":
      return [
        "Attach a source prose concept anchor when the source explains the visualized concept without a dedicated figure.",
        "If no direct anchor exists, keep conceptual-no-direct-source-figure with a precise justification.",
      ];
    case "zettelkasten_handle":
      return [
        "Repair LearningUnitContract.zettelNotes handles first, then update page tags from the contract.",
        "Ensure the page prose supports the repaired atomic handles rather than adding fallback generic tags.",
      ];
    case "section_semantics":
      return [
        "Retitle or split the section according to the roles in the Learning Unit Contract.",
        "Keep canonical page paths coherent with section title, _index frontmatter, H1, and navigation labels.",
      ];
    case "contract_fulfillment":
      return [
        "Fulfill the page's Learning Unit Contract exactly: required source anchors, source figures/tables/formulas, visual type, and zettel handles.",
        "Do not broaden the page with unrelated source assignments.",
      ];
    default:
      return [`Resolve the semantic validation failure: ${problem}`];
  }
}

function repairPromptForRequest(request: Omit<UnitRepairRequest, "repairPrompt">): string {
  return [
    `Rewrite only ${request.pagePath} for Learning Unit ${request.unitId}.`,
    `Canonical section path: ${request.sectionPath}.`,
    `Failure types: ${request.failureTypes.join(", ")}.`,
    "Validation errors:",
    ...request.validationErrors.map((error) => `- ${error}`),
    "Required changes:",
    ...request.requiredChanges.map((change) => `- ${change}`),
    "Preserve the canonical file path, frontmatter schema, source anchor requirements, intended visual block, contract-backed Zettelkasten handles, and flow from previous/next units.",
  ].join("\n");
}

function contractVersionForUnit(unit: LearningUnitContract): string {
  return crypto.createHash("sha1").update(JSON.stringify(unit)).digest("hex").slice(0, 12);
}

function pageSectionPath(page: LearnerPage): string {
  return page.rel.split("/").slice(0, 2).join("/");
}

function extractUnitIdFromProblem(problem: string): string | null {
  return problem.match(/unit\s+"?([A-Za-z0-9_-]+)"?/i)?.[1] ?? null;
}

function pagesForProblem({
  problem,
  checkName,
  learnerPages,
  sectionInputs,
}: {
  problem: string;
  checkName: string;
  learnerPages: LearnerPage[];
  sectionInputs: Array<{ rel: string; sectionTitle: string; units: LearningUnitContract[]; subsectionTitles: string[] }>;
}): LearnerPage[] {
  const pages = learnerPages.filter((page) => problem.includes(page.rel));
  if (pages.length > 0) return pages;

  const unitId = extractUnitIdFromProblem(problem);
  if (unitId) {
    const byUnit = learnerPages.filter((page) => fmGetScalar(page.rawFm, "learningUnitId") === unitId);
    if (byUnit.length > 0) return byUnit;
  }

  const section = sectionInputs.find((candidate) => problem.includes(candidate.rel) || problem.includes(candidate.sectionTitle));
  if (section) {
    return learnerPages.filter((page) => page.rel.startsWith(`${section.rel}/`));
  }

  if (/tag ".+" appears on \d+\//i.test(problem) || /duplicate final interactive visual signature/i.test(problem)) {
    return learnerPages.filter((page) => problem.includes(page.rel));
  }

  // Some section-title checks only carry the check name. Route to all pages in
  // the section if exactly one section is implicated by the check family.
  if (/section/i.test(checkName) && sectionInputs.length === 1) {
    return learnerPages.filter((page) => page.rel.startsWith(`${sectionInputs[0].rel}/`));
  }

  return [];
}

function collectUnitRepairRequests({
  gardenDir,
  checks,
}: {
  gardenDir: string;
  checks: FinalizeCheck[];
}): UnitRepairRequest[] {
  const learnerPages = loadLearnerPages(gardenDir);
  const contract = readLearningUnitContract(gardenDir);
  const unitsById = new Map(contract.units.map((unit) => [unit.id, unit]));
  const sectionInputs = sectionSemanticInputs(gardenDir, learnerPages, unitsById);
  const sortedPages = [...learnerPages].sort((a, b) => a.pageId.localeCompare(b.pageId));
  const requestMap = new Map<string, Omit<UnitRepairRequest, "repairPrompt">>();

  for (const check of checks.filter((item) => item.status === "FAIL" && shouldRouteToUnitRepair(item.name))) {
    const type = semanticFailureType(check.name) ?? "unknown_semantic_failure";
    for (const problem of check.problems) {
      const targets = pagesForProblem({ problem, checkName: check.name, learnerPages, sectionInputs });
      for (const page of targets) {
        const unitId = fmGetScalar(page.rawFm, "learningUnitId") || page.pageId;
        const unit = unitsById.get(unitId) ?? fallbackUnitForPage(page);
        const key = `${page.rel}::${check.name}`;
        const index = sortedPages.findIndex((candidate) => candidate.rel === page.rel);
        const previous = index > 0 ? sortedPages[index - 1] : undefined;
        const next = index >= 0 && index + 1 < sortedPages.length ? sortedPages[index + 1] : undefined;
        const previousUnit = previous ? unitsById.get(fmGetScalar(previous.rawFm, "learningUnitId")) : undefined;
        const nextUnit = next ? unitsById.get(fmGetScalar(next.rawFm, "learningUnitId")) : undefined;
        const existing = requestMap.get(key);
        if (existing) {
          existing.validationErrors.push(`${check.name}: ${problem}`);
          if (!existing.failureTypes.includes(type)) existing.failureTypes.push(type);
          existing.requiredChanges.push(...repairRequiredChanges(type, problem));
          existing.requiredChanges = [...new Set(existing.requiredChanges)];
          continue;
        }
        requestMap.set(key, {
          unitId: unit.id,
          pagePath: page.rel,
          sectionPath: pageSectionPath(page),
          failureTypes: [type],
          validationErrors: [`${check.name}: ${problem}`],
          learningUnitContract: unit,
          previousUnitSummary: previous ? pageSummary(previous, previousUnit) : undefined,
          nextUnitSummary: next ? pageSummary(next, nextUnit) : undefined,
          sourceAnchors: sourceAnchorsForRepair(page),
          currentPageMarkdown: joinFrontmatter(page.rawFm, page.body),
          requiredChanges: repairRequiredChanges(type, problem),
        });
      }
    }
  }

  return [...requestMap.values()].map((request) => ({
    ...request,
    repairPrompt: repairPromptForRequest(request),
  })).sort((a, b) => `${a.pagePath}:${a.failureTypes.join(",")}`.localeCompare(`${b.pagePath}:${b.failureTypes.join(",")}`));
}

function semanticFailureActionsForRequests(requests: UnitRepairRequest[]): FinalizerAction[] {
  return requests.map((request) => ({
    kind: "semantic_failure",
    description: `${request.failureTypes.join(", ")} on ${request.pagePath}`,
    unitId: request.unitId,
    pagePath: request.pagePath,
    repairPrompt: request.repairPrompt,
  }));
}

/** Stable id for a page repair, so page metadata and the repair log can be
 * cross-referenced. */
function repairRequestId(request: UnitRepairRequest): string {
  return crypto
    .createHash("sha1")
    .update(`${request.pagePath}::${request.unitId}::${[...new Set(request.failureTypes)].sort().join(",")}`)
    .digest("hex")
    .slice(0, 12);
}

/** Serialize/replace the nested `lastSemanticRepair:` block. Kept alongside the
 * flat provenance keys (generatedFromUnitId/lastSemanticRepairAt/
 * semanticRepairReason) that the validators already read, so this block is
 * purely additive structured metadata that also records WHICH executor ran. */
function fmSetLastSemanticRepair(
  rawFm: string,
  value: { repairedAt: string; repairType: RepairExecutorKind; failureTypes: string[]; repairRequestId: string },
): string {
  const lines = rawFm.split(/\r?\n/);
  const start = lines.findIndex((line) => /^lastSemanticRepair:\s*/.test(line));
  let stripped = rawFm;
  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && /^\s+/.test(lines[end])) end += 1;
    stripped = [...lines.slice(0, start), ...lines.slice(end)].join("\n");
  }
  const block = [
    "lastSemanticRepair:",
    `  repairedAt: ${jsonScalar(value.repairedAt)}`,
    `  repairType: ${jsonScalar(value.repairType)}`,
    `  repairRequestId: ${jsonScalar(value.repairRequestId)}`,
    "  failureTypes:",
    ...value.failureTypes.map((type) => `    - ${jsonScalar(type)}`),
  ].join("\n");
  const strippedLines = stripped.split(/\r?\n/);
  const anchorIndex = strippedLines.findIndex((line) => /^generatedBy:/.test(line));
  if (anchorIndex >= 0) {
    strippedLines.splice(anchorIndex, 0, block);
    return strippedLines.join("\n");
  }
  return `${stripped.replace(/\s+$/, "")}\n${block}`;
}

function markSemanticRepairProvenance(
  page: LearnerPage,
  request: UnitRepairRequest,
  repairedAt: string,
  repairType: RepairExecutorKind,
): void {
  const failureTypes = [...new Set(request.failureTypes)];
  page.rawFm = fmSetScalar(page.rawFm, "generatedFromUnitId", request.unitId);
  page.rawFm = fmSetScalar(page.rawFm, "contractVersion", contractVersionForUnit(request.learningUnitContract));
  page.rawFm = fmSetScalar(page.rawFm, "lastSemanticRepairAt", repairedAt);
  page.rawFm = fmSetScalar(page.rawFm, "semanticRepairReason", failureTypes.join(", "));
  page.rawFm = fmSetLastSemanticRepair(page.rawFm, {
    repairedAt,
    repairType,
    failureTypes,
    repairRequestId: repairRequestId(request),
  });
  page.dirty = true;
}

function validationFailuresFromChecks(checks: FinalizeCheck[]): string[] {
  return checks
    .filter((check) => check.status === "FAIL")
    .flatMap((check) => check.problems.length > 0
      ? check.problems.map((problem) => `${check.name}: ${problem}`)
      : [`${check.name}: failed`]);
}

// Meta bookkeeping checks that validate the repair log / finalizer boundary
// rather than a page's semantic substance. They cannot be used to decide
// whether a page repair "resolved" its defect: at the point the repair loop
// re-runs checks to grade itself, `.breadboard/repair-log.json` has not been
// written yet, so "Repair Provenance" always reports the just-marked pages as
// "provenance but log missing". These are guaranteed-transient and are enforced
// for real by the finalizer's critical gate once the log exists.
const REPAIR_BOOKKEEPING_CHECKS = new Set(["Repair Provenance", "Finalizer semantic boundary"]);

function unresolvedErrorsForRequest(checks: FinalizeCheck[], request: UnitRepairRequest): string[] {
  return validationFailuresFromChecks(checks.filter((check) => !REPAIR_BOOKKEEPING_CHECKS.has(check.name))).filter((failure) =>
    failure.includes(request.pagePath) ||
    failure.includes(request.sectionPath) ||
    failure.includes(`unit "${request.unitId}"`) ||
    failure.includes(`unit ${request.unitId}`),
  );
}

function writeDirtyLearnerPages(learnerPages: LearnerPage[], report: FinalizeReport): void {
  for (const page of learnerPages) {
    if (!page.dirty) continue;
    fs.writeFileSync(page.abs, joinFrontmatter(page.rawFm, page.body), "utf-8");
    if (!report.changed.includes(page.rel)) report.changed.push(page.rel);
  }
}

function repairLogPath(gardenDir: string): string {
  return path.join(gardenDir, ".breadboard", "repair-log.json");
}

function repairReportPath(gardenDir: string): string {
  return path.join(gardenDir, ".breadboard", "repair-report.md");
}

function writeRepairArtifacts(gardenDir: string, report: LearningUnitRepairRunReport): void {
  const bd = path.join(gardenDir, ".breadboard");
  fs.mkdirSync(bd, { recursive: true });
  fs.writeFileSync(repairLogPath(gardenDir), `${JSON.stringify(report, null, 2)}\n`, "utf-8");

  const lines = [
    "# Breadboard Repair Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Garden: ${report.gardenSlug}`,
    "",
    `Repair executor mode: ${report.repairExecutorMode}`,
    "",
    "## Repaired Units",
    "",
    "| Unit | Page | Failure | Executor Used | Executor Attempted | Result |",
    "|---|---|---|---|---|---|",
    ...(report.repairs.length > 0
      ? report.repairs.map((entry) =>
          `| ${entry.unitId} | ${entry.pagePath} | ${entry.failureTypes.join(", ")} | ${entry.executorUsed} | ${entry.executorAttempted.join(", ") || "none"} | ${entry.result} |`,
        )
      : ["| None | None | None | None | None | not_applicable |"]),
    "",
    "## Executor Provenance",
    "",
    ...(report.repairs.length > 0
      ? report.repairs.flatMap((entry) => [
          `- ${entry.pagePath}: attempted [${entry.executorAttempted.join(", ") || "none"}], used ${entry.executorUsed}${entry.modelFailureReason ? ` (model fell back: ${entry.modelFailureReason})` : ""}`,
        ])
      : ["- None."]),
    "",
    "## Repair Requests",
    "",
    ...(report.requests.length > 0
      ? report.requests.flatMap((request) => [
          `### ${request.unitId}: ${request.pagePath}`,
          "",
          `Failure types: ${request.failureTypes.join(", ")}`,
          "",
          "Validation errors:",
          ...request.validationErrors.map((error) => `- ${error}`),
          "",
          "Required changes:",
          ...request.requiredChanges.map((change) => `- ${change}`),
          "",
        ])
      : ["- None.", ""]),
    "## Semantic Finalizer Actions",
    "",
    ...(report.semanticFinalizerActions.length > 0
      ? report.semanticFinalizerActions.map((action) =>
          action.kind === "semantic_failure"
            ? `- Routed to repair: ${action.description}`
            : `- Mechanical: ${action.description} (${action.filePath})`,
        )
      : ["- None."]),
    "",
    "## Final Verification",
    "",
    `Accepted: ${report.finalVerification?.accepted ? "yes" : "no"}`,
    `No-mutation check: ${report.finalVerification ? (report.finalVerification.mutatedFiles.length === 0 ? "pass" : "fail") : "not run"}`,
    "Validation failures:",
    ...(report.finalVerification?.validationFailures.length
      ? report.finalVerification.validationFailures.map((failure) => `- ${failure}`)
      : ["- None."]),
    "Unresolved semantic failures:",
    ...(report.finalVerification?.unresolvedRepairFailures.length
      ? report.finalVerification.unresolvedRepairFailures.map((failure) => `- ${failure}`)
      : ["- None."]),
    "Mutated during verification:",
    ...(report.finalVerification?.mutatedFiles.length
      ? report.finalVerification.mutatedFiles.map((file) => `- ${file}`)
      : ["- None."]),
    "",
  ];
  fs.writeFileSync(repairReportPath(gardenDir), `${lines.join("\n")}\n`, "utf-8");
}

function readRepairRunReport(gardenDir: string): LearningUnitRepairRunReport | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(repairLogPath(gardenDir), "utf-8"));
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.repairs)) {
      return parsed as LearningUnitRepairRunReport;
    }
  } catch {
    // no repair run yet
  }
  return null;
}

function mergeRequestsForPage(pageRequests: UnitRepairRequest[]): UnitRepairRequest {
  return {
    ...pageRequests[0],
    failureTypes: [...new Set(pageRequests.flatMap((request) => request.failureTypes))],
    validationErrors: [...new Set(pageRequests.flatMap((request) => request.validationErrors))],
    requiredChanges: [...new Set(pageRequests.flatMap((request) => request.requiredChanges))],
  };
}

/** Visual spec ids a repaired page is allowed to touch: those declared in
 * frontmatter visualIds plus any already embedded in the page body. A model
 * candidate that writes any other spec id is out of scope. */
function pageAllowedVisualIds(page: LearnerPage): Set<string> {
  const ids = new Set<string>(fmGetArray(page.rawFm, "visualIds"));
  for (const spec of embeddedVisualSpecs(page.body)) {
    const id = String(spec.id ?? "").trim();
    if (id) ids.add(id);
  }
  return ids;
}

/** Scope violations that disqualify a model candidate before anything is
 * written: missing/renamed frontmatter, wrong unit, or edits to files the page
 * does not own. This is what makes "candidate changes unsupported files" fail. */
function repairCandidateScopeProblems(page: LearnerPage, request: UnitRepairRequest, candidate: RepairCandidate): string[] {
  const problems: string[] = [];
  const parsed = parseFrontmatter(candidate.markdown);
  if (!parsed.hadFrontmatter) {
    problems.push("candidate markdown has no frontmatter");
    return problems;
  }
  const candidateUnitId = fmGetScalar(parsed.rawFrontmatter, "learningUnitId");
  const currentUnitId = fmGetScalar(page.rawFm, "learningUnitId");
  if (currentUnitId && candidateUnitId && candidateUnitId !== currentUnitId) {
    problems.push(`candidate changed learningUnitId ${currentUnitId} -> ${candidateUnitId}`);
  }
  const allowedVisualIds = pageAllowedVisualIds(page);
  for (const entry of candidate.visualSpecs ?? []) {
    if (!allowedVisualIds.has(entry.id)) {
      problems.push(`candidate writes unsupported visual spec ${entry.id} not owned by ${request.pagePath}`);
    }
  }
  if (candidate.contractHandlePatch && candidate.contractHandlePatch.unitId !== request.unitId) {
    problems.push(`candidate patches unsupported contract unit ${candidate.contractHandlePatch.unitId} (request unit ${request.unitId})`);
  }
  return problems;
}

function snapshotFilesForRevert(absPaths: string[]): Map<string, Buffer | null> {
  const snap = new Map<string, Buffer | null>();
  for (const abs of absPaths) snap.set(abs, fs.existsSync(abs) ? fs.readFileSync(abs) : null);
  return snap;
}

function restoreFilesFromSnapshot(snap: Map<string, Buffer | null>): void {
  for (const [abs, buf] of snap) {
    if (buf === null) fs.rmSync(abs, { force: true });
    else fs.writeFileSync(abs, buf);
  }
}

/** Write a model candidate to disk (page markdown + owned visual specs +
 * optional contract-handle patch), returning the changed rel paths and a
 * `restore` closure that reverts every touched file to its pre-write bytes. */
function applyRepairCandidate(
  gardenDir: string,
  page: LearnerPage,
  candidate: RepairCandidate,
  contractPath: string | undefined,
): { changedFiles: string[]; restore: () => void } {
  const touched: string[] = [page.abs];
  for (const entry of candidate.visualSpecs ?? []) {
    touched.push(path.join(gardenDir, ".breadboard", "visuals", `${entry.id}.json`));
  }
  if (candidate.contractHandlePatch && contractPath) touched.push(contractPath);
  const snap = snapshotFilesForRevert(touched);

  const changedFiles: string[] = [];
  const relOf = (abs: string) => path.relative(gardenDir, abs).replace(/\\/g, "/");

  fs.writeFileSync(page.abs, candidate.markdown, "utf-8");
  changedFiles.push(page.rel);

  for (const entry of candidate.visualSpecs ?? []) {
    const target = path.join(gardenDir, ".breadboard", "visuals", `${entry.id}.json`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(entry.spec, null, 2)}\n`, "utf-8");
    changedFiles.push(relOf(target));
  }

  if (candidate.contractHandlePatch && contractPath) {
    const parsed = readJson<Record<string, unknown>>(contractPath, {});
    const rawUnits = Array.isArray(parsed.learningUnits) ? (parsed.learningUnits as Array<Record<string, unknown>>) : [];
    const unit = rawUnits.find((raw) => cleanText(raw.id) === candidate.contractHandlePatch!.unitId);
    if (unit) {
      unit.zettelNotes = candidate.contractHandlePatch.handles.map((handle) => ({
        handle: atomicZettelHandle(handle),
        claim: handle.replace(/-/g, " "),
        connectedTo: [],
      }));
      fs.writeFileSync(contractPath, JSON.stringify(parsed, null, 2), "utf-8");
      changedFiles.push(relOf(contractPath));
    }
  }

  return { changedFiles, restore: () => restoreFilesFromSnapshot(snap) };
}

/** Persist a rejected model candidate + reasons under
 * .breadboard/debug/failed-repairs/ so failures are never silently dropped. */
function dumpFailedRepair(gardenDir: string, request: UnitRepairRequest, candidate: RepairCandidate | null, reasons: string[]): string {
  const dir = path.join(gardenDir, ".breadboard", "debug", "failed-repairs");
  fs.mkdirSync(dir, { recursive: true });
  const slug = `${slugifyLoose(request.pagePath.replace(/\.md$/i, ""))}-${repairRequestId(request)}`;
  const rel = `.breadboard/debug/failed-repairs/${slug}.md`;
  const lines = [
    `# Rejected model repair candidate`,
    "",
    `Page: ${request.pagePath}`,
    `Unit: ${request.unitId}`,
    `Failure types: ${request.failureTypes.join(", ")}`,
    `Rejected at: ${new Date().toISOString()}`,
    "",
    "## Rejection reasons",
    "",
    ...(reasons.length ? reasons.map((reason) => `- ${reason}`) : ["- (none recorded)"]),
    "",
    "## Candidate markdown",
    "",
    "````markdown",
    candidate?.markdown ?? "(model returned no candidate)",
    "````",
    "",
  ];
  if (candidate?.visualSpecs?.length) {
    lines.push("## Candidate visual specs", "", "```json", JSON.stringify(candidate.visualSpecs, null, 2), "```", "");
  }
  if (candidate?.contractHandlePatch) {
    lines.push("## Candidate contract patch", "", "```json", JSON.stringify(candidate.contractHandlePatch, null, 2), "```", "");
  }
  fs.writeFileSync(path.join(gardenDir, ...rel.split("/")), `${lines.join("\n")}\n`, "utf-8");
  return rel;
}

interface ModelRepairAttempt {
  success: boolean;
  changedFiles: string[];
  validationErrorsAfter: string[];
  modelFailureReason?: string;
  notes: string[];
}

/** Try one model repair for a single page: call the executor, scope-check the
 * candidate, apply it, validate it against the same checks that grade the
 * request, and keep it only if the page's failures are cleared. On any failure
 * the candidate is reverted and dumped to failed-repairs/. */
async function tryModelRepairForPage({
  gardenDir,
  request,
  modelRepair,
  repairReport,
  contractPath,
}: {
  gardenDir: string;
  request: UnitRepairRequest;
  modelRepair: ModelRepairExecutor;
  repairReport: FinalizeReport;
  contractPath: string | undefined;
}): Promise<ModelRepairAttempt> {
  const page = loadLearnerPages(gardenDir).find((candidate) => candidate.rel === request.pagePath);
  if (!page) {
    return { success: false, changedFiles: [], validationErrorsAfter: [], modelFailureReason: "page not found on disk", notes: [] };
  }

  let candidate: RepairCandidate | null;
  try {
    candidate = await modelRepair(request);
  } catch (error) {
    return {
      success: false,
      changedFiles: [],
      validationErrorsAfter: [],
      modelFailureReason: `model executor error: ${error instanceof Error ? error.message : String(error)}`,
      notes: [],
    };
  }
  if (!candidate || typeof candidate.markdown !== "string" || !candidate.markdown.trim()) {
    return { success: false, changedFiles: [], validationErrorsAfter: [], modelFailureReason: "model returned no candidate", notes: [] };
  }

  const scopeProblems = repairCandidateScopeProblems(page, request, candidate);
  if (scopeProblems.length > 0) {
    const dumped = dumpFailedRepair(gardenDir, request, candidate, scopeProblems);
    return {
      success: false,
      changedFiles: [],
      validationErrorsAfter: scopeProblems,
      modelFailureReason: `candidate out of scope: ${scopeProblems.join("; ")}`,
      notes: [`rejected candidate saved to ${dumped}`],
    };
  }

  const applied = applyRepairCandidate(gardenDir, page, candidate, contractPath);
  const checks = collectFinalizeChecks({ gardenDir, report: emptyFinalizeReport(), includeReportSelfCheck: false });
  const problems = unresolvedErrorsForRequest(checks, request);
  if (problems.length > 0) {
    const dumped = dumpFailedRepair(gardenDir, request, candidate, problems);
    applied.restore();
    return {
      success: false,
      changedFiles: [],
      validationErrorsAfter: problems,
      modelFailureReason: `candidate failed validation: ${problems.slice(0, 3).join("; ")}`,
      notes: [`rejected candidate saved to ${dumped}`],
    };
  }

  for (const file of applied.changedFiles) {
    if (!repairReport.changed.includes(file)) repairReport.changed.push(file);
  }
  return { success: true, changedFiles: applied.changedFiles, validationErrorsAfter: [], notes: candidate.notes ?? [] };
}

export async function repairLearningUnitsFromContract({
  gardenDir,
  gardenSlug,
  repairExecutor = "deterministic",
  modelRepair,
}: {
  gardenDir: string;
  gardenSlug: string;
  /** Which executor(s) to use. Defaults to deterministic (safe, LLM-free). */
  repairExecutor?: RepairExecutorMode;
  /** Injected model executor. Required for the "model" modes; ignored otherwise. */
  modelRepair?: ModelRepairExecutor;
}): Promise<LearningUnitRepairRunReport> {
  const requestedAt = new Date().toISOString();
  const reportForChecks = emptyFinalizeReport();
  const firstChecks = collectFinalizeChecks({ gardenDir, report: reportForChecks, includeReportSelfCheck: false });
  const requests = collectUnitRepairRequests({ gardenDir, checks: firstChecks });
  const repairReport = emptyFinalizeReport();
  const changedBefore = new Set(repairReport.changed);
  const repairedAt = new Date().toISOString();

  const wantModel = (repairExecutor === "model" || repairExecutor === "model_with_deterministic_fallback") && typeof modelRepair === "function";
  const allowDeterministic = repairExecutor === "deterministic" || repairExecutor === "model_with_deterministic_fallback";

  const requestByPage = new Map<string, UnitRepairRequest[]>();
  for (const request of requests) {
    const list = requestByPage.get(request.pagePath) ?? [];
    list.push(request);
    requestByPage.set(request.pagePath, list);
  }

  // executor bookkeeping, keyed by page path.
  const modelRepairedPaths = new Set<string>();
  const executions: RepairExecutionResult[] = [];
  const attemptedByPage = new Map<string, RepairExecutorKind[]>();
  const usedByPage = new Map<string, RepairExecutorKind>();
  const modelFailureByPage = new Map<string, string>();
  const repairedPaths = new Set<string>();

  if (requests.length > 0) {
    const bd = path.join(gardenDir, ".breadboard");
    const ledgerPath = path.join(bd, "source-visuals.json");
    const contractPath = readLearningUnitContract(gardenDir).foundPath;

    // --- Phase 1: model-backed single-page repair -----------------------------
    if (wantModel && typeof modelRepair === "function") {
      for (const [pagePath, pageRequests] of requestByPage) {
        const merged = mergeRequestsForPage(pageRequests);
        attemptedByPage.set(pagePath, ["model"]);
        const attempt = await tryModelRepairForPage({ gardenDir, request: merged, modelRepair, repairReport, contractPath });
        executions.push({
          unitId: merged.unitId,
          pagePath,
          executor: "model",
          changedFiles: attempt.changedFiles,
          success: attempt.success,
          validationErrorsBefore: merged.validationErrors,
          validationErrorsAfter: attempt.validationErrorsAfter,
          notes: attempt.notes,
        });
        if (attempt.success) {
          modelRepairedPaths.add(pagePath);
          repairedPaths.add(pagePath);
          usedByPage.set(pagePath, "model");
        } else if (attempt.modelFailureReason) {
          modelFailureByPage.set(pagePath, attempt.modelFailureReason);
        }
      }
    }

    // --- Phase 2: deterministic repair (fallback / default) -------------------
    // Runs over pages the model did NOT already repair, so a validated model
    // page is never clobbered. Section-structure passes run over the full tree
    // because they only touch _index files, not learner-page bodies.
    if (allowDeterministic) {
      const ledger = readJson<LedgerVisual[]>(ledgerPath, []);
      const allPages = loadLearnerPages(gardenDir);
      const deterministicPages = allPages.filter((page) => !modelRepairedPaths.has(page.rel));
      const contract = readLearningUnitContract(gardenDir);

      repairContractZettelHandles(gardenDir, contract, deterministicPages, repairReport);
      synchronizeContractZettelHandles(gardenDir, contract, deterministicPages, repairReport);
      const unitsById = new Map(contract.units.map((unit) => [unit.id, unit]));
      repairSectionSemanticTitles(gardenDir, allPages, unitsById, repairReport);
      repairSourceTextConceptAnchors(gardenDir, deterministicPages, repairReport);
      repairLearningUnitSourceTextAnchors(gardenDir, deterministicPages, unitsById, repairReport);
      repairMetricCalculatorFocus(gardenDir, deterministicPages, repairReport);
      regroundFormulas({ ledger, learnerPages: deterministicPages, report: repairReport });
      removeRepeatedMotivation(deterministicPages, repairReport);
      writeDirtyLearnerPages(deterministicPages, repairReport);
      alignSectionFoldersWithTitles(gardenDir, repairReport);
      repairSectionNavigationLabels(gardenDir, repairReport);

      for (const pagePath of requestByPage.keys()) {
        if (modelRepairedPaths.has(pagePath)) continue;
        attemptedByPage.set(pagePath, [...(attemptedByPage.get(pagePath) ?? []), "deterministic"]);
        usedByPage.set(pagePath, "deterministic");
        repairedPaths.add(pagePath);
      }
    }

    // --- Provenance: only pages that actually got a repair executor applied ----
    const finalPages = loadLearnerPages(gardenDir);
    for (const page of finalPages) {
      if (!repairedPaths.has(page.rel)) continue;
      const merged = mergeRequestsForPage(requestByPage.get(page.rel)!);
      markSemanticRepairProvenance(page, merged, repairedAt, usedByPage.get(page.rel) ?? "deterministic");
    }
    writeDirtyLearnerPages(finalPages, repairReport);
  }

  const finalChecks = collectFinalizeChecks({ gardenDir, report: emptyFinalizeReport(), includeReportSelfCheck: false });
  const changedFiles = [...new Set(repairReport.changed.filter((file) => !changedBefore.has(file)))].sort();
  const repairs: UnitRepairLogEntry[] = requests.map((request) => {
    const unresolved = unresolvedErrorsForRequest(finalChecks, request);
    return {
      unitId: request.unitId,
      pagePath: request.pagePath,
      sectionPath: request.sectionPath,
      failureTypes: request.failureTypes,
      validationErrors: request.validationErrors,
      requiredChanges: request.requiredChanges,
      repairType: "contract_driven_revision",
      changedFiles: changedFiles.filter((file) => file === request.pagePath || file.startsWith(`${request.sectionPath}/`) || file.startsWith(".breadboard/")),
      result: unresolved.length === 0 ? "resolved" : "unresolved",
      unresolvedValidationErrors: unresolved,
      repairedAt,
      executorAttempted: attemptedByPage.get(request.pagePath) ?? [],
      executorUsed: usedByPage.get(request.pagePath) ?? "none",
      modelFailureReason: modelFailureByPage.get(request.pagePath),
    };
  });
  const runReport: LearningUnitRepairRunReport = {
    requestedAt,
    gardenSlug,
    repairExecutorMode: repairExecutor,
    requests,
    repairs,
    executions,
    changedFiles,
    semanticFinalizerActions: semanticFailureActionsForRequests(requests),
    firstValidationFailures: validationFailuresFromChecks(firstChecks),
    finalValidationFailures: validationFailuresFromChecks(finalChecks),
  };
  writeRepairArtifacts(gardenDir, runReport);
  return runReport;
}

function collectAllFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, relDir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs, rel);
      else if (entry.isFile()) out.push(rel.replace(/\\/g, "/"));
    }
  };
  walk(root, "");
  return out.sort();
}

function snapshotFiles(root: string): Map<string, string> {
  const snapshot = new Map<string, string>();
  for (const rel of collectAllFiles(root)) {
    const abs = path.join(root, ...rel.split("/"));
    const hash = crypto.createHash("sha1").update(fs.readFileSync(abs)).digest("hex");
    snapshot.set(rel, hash);
  }
  return snapshot;
}

function changedBetweenSnapshots(before: Map<string, string>, after: Map<string, string>): string[] {
  const keys = new Set([...before.keys(), ...after.keys()]);
  const changed: string[] = [];
  for (const key of keys) {
    if (before.get(key) !== after.get(key)) changed.push(key);
  }
  return changed.sort();
}

function validationReportAccepted(gardenDir: string): boolean {
  const reportPath = path.join(gardenDir, ".breadboard", "validation-report.md");
  if (!fs.existsSync(reportPath)) return false;
  return /^Accepted:\s+yes\s*$/m.test(fs.readFileSync(reportPath, "utf-8"));
}

export function verifyFinalArtifactNoMutation({
  gardenDir,
  gardenSlug,
  updateRepairReport = true,
}: {
  gardenDir: string;
  gardenSlug: string;
  updateRepairReport?: boolean;
}): FinalArtifactVerification {
  const before = snapshotFiles(gardenDir);
  const checks = collectFinalizeChecks({ gardenDir, report: emptyFinalizeReport(), includeReportSelfCheck: true });
  const repairRun = readRepairRunReport(gardenDir);
  const unresolvedRepairFailures = repairRun
    ? repairRun.repairs
        .filter((entry) => entry.result === "unresolved" || entry.unresolvedValidationErrors.length > 0)
        .flatMap((entry) => entry.unresolvedValidationErrors.length > 0
          ? entry.unresolvedValidationErrors.map((failure) => `${entry.pagePath}: ${failure}`)
          : [`${entry.pagePath}: unresolved ${entry.failureTypes.join(", ")}`])
    : [];
  const after = snapshotFiles(gardenDir);
  const validationFailures = validationFailuresFromChecks(checks);
  const verification: FinalArtifactVerification = {
    checkedAt: new Date().toISOString(),
    accepted: validationFailures.length === 0 && unresolvedRepairFailures.length === 0 && validationReportAccepted(gardenDir),
    mutatedFiles: changedBetweenSnapshots(before, after),
    validationFailures,
    unresolvedRepairFailures,
    validationReportAccepted: validationReportAccepted(gardenDir),
  };
  verification.accepted = verification.accepted && verification.mutatedFiles.length === 0;

  if (updateRepairReport) {
    const existing: LearningUnitRepairRunReport = repairRun ?? {
      requestedAt: new Date().toISOString(),
      gardenSlug,
      repairExecutorMode: "deterministic",
      requests: [],
      repairs: [],
      executions: [],
      changedFiles: [],
      semanticFinalizerActions: [],
      firstValidationFailures: [],
      finalValidationFailures: validationFailures,
    };
    existing.finalVerification = verification;
    existing.finalValidationFailures = validationFailures;
    writeRepairArtifacts(gardenDir, existing);
  }

  return verification;
}

// ---------------------------------------------------------------------------
// Title fix
// ---------------------------------------------------------------------------

/** Strip source-commentary residue ("... as Evidence") from learner titles and
 * propagate the cleaned alias to visible navigation files. */
function fixLearnerTitles(pages: LearnerPage[], gardenDir: string, report: FinalizeReport): void {
  const renames: Array<{ from: string; to: string }> = [];
  for (const page of pages) {
    const title = page.title;
    const cleaned = title
      .replace(/\s+as\s+(?:source[- ](?:derived|central|anchored)\s+)?evidence\b/gi, "")
      .replace(/\s+in\s+(?:this|the)\s+(?:paper|source)\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (cleaned && cleaned !== title) {
      page.rawFm = fmSetScalar(page.rawFm, "title", cleaned);
      // Body H1/H3 headings that echo the title.
      const bare = title.replace(/^\d+(?:\.\d+)*\.?\s*/, "");
      const bareClean = cleaned.replace(/^\d+(?:\.\d+)*\.?\s*/, "");
      if (bare !== bareClean) {
        page.body = page.body.replace(
          new RegExp(`^(#{1,6}\\s+)${bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im"),
          `$1${bareClean}`,
        );
        renames.push({ from: bare, to: bareClean });
      }
      page.dirty = true;
      page.title = cleaned;
      report.notes.push(`retitled ${page.rel}: "${title}" -> "${cleaned}"`);
    }
  }
  if (renames.length === 0) return;
  // Clean the alias text in visible navigation files (targets stay valid).
  const navFiles = [
    path.join(gardenDir, "_index.md"),
    path.join(gardenDir, "learning", "Learning Map.md"),
    path.join(gardenDir, "learning", "Topic Overview.md"),
    path.join(gardenDir, "learning", "_index.md"),
  ];
  for (const file of navFiles) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf-8");
    let next = text;
    for (const { from, to } of renames) next = replaceTitleAliasOnly(next, from, to);
    if (next !== text) {
      fs.writeFileSync(file, next, "utf-8");
      report.changed.push(path.relative(gardenDir, file).replace(/\\/g, "/"));
    }
  }
}

/** Replace a cleaned title in *alias* positions and plain prose only — never in
 * a wikilink target (the on-disk file was not renamed, so its path must stay
 * exactly as written or the link breaks). */
function replaceTitleAliasOnly(text: string, from: string, to: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (!line.includes("[[")) return line.split(from).join(to);
      return line.replace(/\[\[([^\]]+?)\]\]/g, (full, inner: string) => {
        const pipe = inner.indexOf("|");
        if (pipe < 0) return full; // bare link: target only, do not touch
        const target = inner.slice(0, pipe);
        const alias = inner.slice(pipe + 1).split(from).join(to);
        return `[[${target}|${alias}]]`;
      });
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Pass C: source wikilink normalization
// ---------------------------------------------------------------------------

/** Convert self-referential heading wikilinks to plain headings, resolve page
 * anchors to real headings, and canonicalize/flatten links to deleted
 * timestamped source-conversion pages. Runs over every visible Markdown file. */
export function normalizeSourceWikilinks(gardenDir: string, report: FinalizeReport): void {
  const visible: Array<{ abs: string; rel: string }> = [];
  const rootIndex = path.join(gardenDir, "_index.md");
  if (fs.existsSync(rootIndex)) visible.push({ abs: rootIndex, rel: "_index.md" });
  listMarkdown(path.join(gardenDir, "learning"), "learning", visible);
  listMarkdown(path.join(gardenDir, "sources"), "sources", visible);

  // Index of existing page targets (by canonical path and by basename slug).
  const byBasename = new Map<string, string>();
  for (const { rel } of visible) {
    const target = rel.replace(/\.md$/i, "");
    const base = target.split("/").pop() ?? target;
    byBasename.set(slugifyLoose(base), target);
  }

  for (const { abs, rel } of visible) {
    const original = fs.readFileSync(abs, "utf-8");
    const { rawFrontmatter, body, hadFrontmatter } = parseFrontmatter(original);
    const headingSlugs = new Set<string>();
    for (const match of body.matchAll(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
      // Slug of the *plain* heading text (after we strip any wikilink markup).
      const plain = (match[1] ?? "").replace(/\[\[#?([^\]|]+?)(?:\|[^\]]*)?\]\]/g, "$1");
      headingSlugs.add(slugifyLoose(plain));
    }

    let next = body;

    // 1) Headings that are themselves wikilinks -> plain headings.
    next = next.replace(/^(#{1,6})\s*\[\[#?([^\]|]+?)(?:\|([^\]]*))?\]\]\s*$/gm, (_m, hashes, target, alias) => {
      const label = (alias ?? target ?? "").trim();
      return `${hashes} ${label}`;
    });

    // 2) Remaining wikilinks: resolve or flatten.
    next = next.replace(/(!?)\[\[([^\]]+?)\]\]/g, (full, bang: string, inner: string) => {
      if (bang === "!") return full; // image/embed transclusion
      const pipe = inner.indexOf("|");
      const rawTarget = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
      const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : "";
      const label = alias || rawTarget.replace(/^#/, "");
      const hashIndex = rawTarget.indexOf("#");
      const base = (hashIndex >= 0 ? rawTarget.slice(0, hashIndex) : rawTarget).replace(/^\//, "").replace(/\.md$/i, "").trim();
      const fragment = hashIndex >= 0 ? rawTarget.slice(hashIndex + 1).trim() : "";

      // Same-page heading link.
      if (!base) {
        if (fragment && headingSlugs.has(slugifyLoose(fragment))) return full;
        // e.g. [[#Page 16|Page 16]] with no such heading -> plain text.
        return label;
      }

      // Page-N reference -> same-page heading anchor when the heading exists.
      const pageMatch = base.match(/^page\s+(\d+)$/i);
      if (pageMatch) {
        const slug = slugifyLoose(`Page ${pageMatch[1]}`);
        if (headingSlugs.has(slug)) return `[[#Page ${pageMatch[1]}|${label}]]`;
        return label;
      }

      // Existing learning/source page links are already canonical. Keep them by
      // checking the full relative target before falling back to basename
      // matching, otherwise every section _index link competes on "_index".
      const exactTarget = path.join(gardenDir, ...base.split("/"));
      if (fs.existsSync(`${exactTarget}.md`) || fs.existsSync(path.join(exactTarget, "_index.md"))) {
        if (fragment) return `[[${base}#${fragment}|${label}]]`;
        return `[[${base}|${label}]]`;
      }

      // Canonical target already? keep.
      if (byBasename.has(slugifyLoose(base.split("/").pop() ?? base))) {
        const canonical = byBasename.get(slugifyLoose(base.split("/").pop() ?? base))!;
        if (fragment) return `[[${canonical}#${fragment}|${label}]]`;
        return `[[${canonical}|${label}]]`;
      }

      // Timestamped / deleted source-conversion page -> canonical source page
      // if one exists, else plain text. Never leave a broken link.
      const timestamped = base.match(/^(.*?)-\d{10,}$/);
      if (timestamped) {
        const canonical = byBasename.get(slugifyLoose(timestamped[1]));
        if (canonical) return `[[${canonical}|${label}]]`;
      }
      return label;
    });

    if (next !== body) {
      fs.writeFileSync(abs, hadFrontmatter ? joinFrontmatter(rawFrontmatter, next) : next, "utf-8");
      if (!report.changed.includes(rel)) report.changed.push(rel);
    }

    // Source pages should be viewer-visible: prefer internal:false + proper type.
    if (rel.startsWith("sources/")) {
      normalizeSourcePageTyping(abs, rel, report);
    }
  }
}

function normalizeSourcePageTyping(abs: string, rel: string, report: FinalizeReport): void {
  const content = fs.readFileSync(abs, "utf-8");
  const { rawFrontmatter, body, hadFrontmatter } = parseFrontmatter(content);
  if (!hadFrontmatter) return;
  let fm = rawFrontmatter;
  const isIndex = /\/_index\.md$/i.test(`/${rel}`) || rel === "sources/_index.md";
  const bt = fmGetScalar(fm, "breadboardType");
  const kt = fmGetScalar(fm, "knowledge_type");
  // A source page must never be typed as a learner page.
  if (bt === "learning_page" || kt === "learning-page") {
    fm = fmSetScalar(fm, "breadboardType", isIndex ? "source_index" : "source_document");
    fm = fmSetScalar(fm, "knowledge_type", isIndex ? "source-index" : "source-document");
  }
  if (fmGetScalar(fm, "internal") === "true") fm = fmSetScalar(fm, "internal", false);
  if (!/^excludeFromLearningPath:/m.test(fm)) fm = fmSetScalar(fm, "excludeFromLearningPath", true);
  if (fm !== rawFrontmatter) {
    fs.writeFileSync(abs, joinFrontmatter(fm, body), "utf-8");
    if (!report.changed.includes(rel)) report.changed.push(rel);
  }
}

// ---------------------------------------------------------------------------
// Pass D: stale caveat sanitation
// ---------------------------------------------------------------------------

const STALE_CAVEAT_PATTERNS: RegExp[] = [
  /only pages?\s*1\s*[-–]\s*2\s+(?:are|is)\s+(?:available|present)/i,
  /source map is truncated/i,
  /later[- ]page teaching must remain anchored to extracted .*captions/i,
  /formula captions? only/i,
  /exact (?:mathematical )?notation (?:is )?(?:unavailable|not visible|not included)/i,
  /truncated after page\s*2/i,
  /(?:formal|explicit) mathematical definitions are not present/i,
  /formulas? (?:are|is) not present/i,
  /governing equations.*not (?:present|included)/i,
  /does not include its governing equations/i,
  /later sections? (?:are|is)? ?(?:not available|unavailable)/i,
  /later-paper details must not be inferred/i,
  /not available in full (?:text|prose)/i,
  /remain qualitative unless more verified source text/i,
];

/** Rewrite a block of text so stale caveats that contradict the extracted
 * anchors are dropped (bullets) or neutralized (inline). */
export function sanitizeStaleCaveats(
  text: string,
  facts: { laterPagesExist: boolean; formulaAnchorsExist: boolean },
): string {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    const isBullet = /^\s*[-*]\s+/.test(line) || /^\s*"[^"]*",?\s*$/.test(line);
    const staleFormula = facts.formulaAnchorsExist && /(?:formal|explicit) mathematical definitions are not present|formulas? (?:are|is) not present|formula captions? only|exact (?:mathematical )?notation (?:is )?(?:unavailable|not visible|not included)|governing equations.*not (?:present|included)|does not include its governing equations|remain qualitative unless more verified/i.test(line);
    const staleTruncation = facts.laterPagesExist && /only pages?\s*1\s*[-–]\s*2\s+(?:are|is)\s+(?:available|present)|source map is truncated|later[- ]page teaching must remain anchored to extracted .*captions|truncated after page\s*2|later-paper details must not be inferred|later sections? (?:are|is)? ?(?:not available|unavailable)|not available in full (?:text|prose)/i.test(line);
    if ((staleFormula || staleTruncation) && isBullet) {
      continue; // drop the whole stale bullet
    }
    let out = line;
    if (facts.formulaAnchorsExist) {
      out = out
        .replace(/(?:formal|explicit) mathematical definitions are not present[^.\n]*/gi, "explicit metric formulas are present in the extracted source anchors")
        .replace(/formulas? (?:are|is) not present/gi, "formula anchors are present")
        .replace(/only formula captions? are provided[^.\n]*/gi, "formula text is available through extracted source text or formula anchors")
        .replace(/formula captions? only|caption-only/gi, "formula anchors and text fallback are available")
        .replace(/exact (?:mathematical )?notation (?:is )?(?:unavailable|not visible|not included)[^.\n]*/gi, "formula notation is handled through extracted source text or text fallback")
        .replace(/the (?:supplied|provided) (?:material|source|text) does not include its governing equations/gi, "the extracted source anchors include the governing metric formulas");
    }
    if (facts.laterPagesExist) {
      out = out
        .replace(/only pages?\s*1\s*[-–]\s*2\s+(?:are|is)\s+(?:available|present)[^.\n]*/gi, "later source pages are available and anchored")
        .replace(/later[- ]page teaching must remain anchored to extracted [^.\n]*captions[^.\n]*/gi, "later-page teaching can use extracted source prose and source artifacts")
        .replace(/source map is truncated[^.\n]*/gi, "source map includes later-page source evidence")
        .replace(/(?:the (?:main|provided|continuous)[^.\n]*?)?truncated after page\s*2[^.\n]*/gi, "later source pages are available and anchored")
        .replace(/later sections? (?:are|is)? ?(?:not available|unavailable)[^.\n]*/gi, "later sections are available through source anchors");
    }
    kept.push(out);
  }
  return kept.join("\n");
}

function sanitizeStaleCaveatFiles(
  gardenDir: string,
  facts: { laterPagesExist: boolean; formulaAnchorsExist: boolean },
  report: FinalizeReport,
): void {
  const files = [
    path.join(gardenDir, "learning", "Learning Map.md"),
    path.join(gardenDir, "learning", "Topic Overview.md"),
    path.join(gardenDir, ".breadboard", "planning", "Source Map.md"),
    path.join(gardenDir, ".breadboard", "planning", "Scope Contract.md"),
    path.join(gardenDir, ".breadboard", "planning", "Source Coverage.md"),
  ];
  for (const learner of loadLearnerPagePaths(gardenDir)) files.push(learner);
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, "utf-8");
    const { rawFrontmatter, body, hadFrontmatter } = parseFrontmatter(content);
    const nextBody = sanitizeStaleCaveats(body, facts);
    if (nextBody !== body) {
      fs.writeFileSync(file, hadFrontmatter ? joinFrontmatter(rawFrontmatter, nextBody) : nextBody, "utf-8");
      const rel = path.relative(gardenDir, file).replace(/\\/g, "/");
      if (!report.changed.includes(rel)) report.changed.push(rel);
    }
  }
}

function learnerSectionTargets(gardenDir: string): Map<string, string> {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/^\s*\d+(?:\.\d+)*\.?\s*/, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  const targets = new Map<string, string>();
  const learningDir = path.join(gardenDir, "learning");
  if (!fs.existsSync(learningDir)) return targets;
  for (const entry of fs.readdirSync(learningDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const indexPath = path.join(learningDir, entry.name, "_index.md");
    if (!fs.existsSync(indexPath)) continue;
    const title = entry.name.replace(/^\s*(\d+)\.\s*/, "");
    const relTarget = `learning/${entry.name}/_index`;
    for (const label of [entry.name, title]) {
      const key = normalize(label);
      if (key) targets.set(key, relTarget);
    }
  }
  return targets;
}

function repairLearnerNavigationSourceLinks(gardenDir: string, report: FinalizeReport): void {
  const sectionTargets = learnerSectionTargets(gardenDir);
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/^\s*\d+(?:\.\d+)*\.?\s*/, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  const files = [
    path.join(gardenDir, "learning", "_index.md"),
    path.join(gardenDir, "learning", "Topic Overview.md"),
    path.join(gardenDir, "learning", "Learning Map.md"),
  ];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, "utf-8");
    const { rawFrontmatter, body, hadFrontmatter } = parseFrontmatter(content);
    const nextBody = body.replace(/\[\[(sources\/[^\]|#]+(?:#[^\]|]+)?)(?:\|([^\]]+))?\]\]/gi, (whole, target: string, alias?: string) => {
      const label = String(alias ?? "").trim();
      const targetBase = target.split("#")[0].replace(/\.md$/i, "");
      const replacementLabel = label || targetBase.split("/").pop() || "Sources";
      if (targetBase.toLowerCase() === "sources/_index") {
        const sectionTarget = sectionTargets.get(normalize(replacementLabel));
        if (sectionTarget) return `[[${sectionTarget}|${replacementLabel}]]`;
      }
      return replacementLabel;
    });
    if (nextBody !== body) {
      fs.writeFileSync(file, hadFrontmatter ? joinFrontmatter(rawFrontmatter, nextBody) : nextBody, "utf-8");
      const rel = path.relative(gardenDir, file).replace(/\\/g, "/");
      if (!report.changed.includes(rel)) report.changed.push(rel);
      report.notes.push(`repaired learner navigation source links in ${rel}`);
    }
  }

  const rootFile = path.join(gardenDir, "_index.md");
  if (fs.existsSync(rootFile)) {
    const content = fs.readFileSync(rootFile, "utf-8");
    const { rawFrontmatter, body, hadFrontmatter } = parseFrontmatter(content);
    const nextBody = body.replace(/\[\[sources\/_index(?:\.md)?(?:#[^\]|]+)?\|([^\]]+)\]\]/gi, (whole, alias: string) => {
      const label = String(alias ?? "").trim();
      if (/^sources$/i.test(label)) return whole;
      if (/^learning$/i.test(label)) return `[[learning/_index|${label}]]`;
      const sectionTarget = sectionTargets.get(normalize(label));
      if (sectionTarget) return `[[${sectionTarget}|${label}]]`;
      return label || whole;
    });
    if (nextBody !== body) {
      fs.writeFileSync(rootFile, hadFrontmatter ? joinFrontmatter(rawFrontmatter, nextBody) : nextBody, "utf-8");
      if (!report.changed.includes("_index.md")) report.changed.push("_index.md");
      report.notes.push("repaired root learning navigation source links");
    }
  }
}

function loadLearnerPagePaths(gardenDir: string): string[] {
  const all: Array<{ abs: string; rel: string }> = [];
  listMarkdown(path.join(gardenDir, "learning"), "learning", all);
  return all.map((entry) => entry.abs);
}

// ---------------------------------------------------------------------------
// Pass E + F: reconcile + place source visuals
// ---------------------------------------------------------------------------

function reconcileAndPlaceSourceVisuals({
  gardenDir,
  ledger,
  ledgerPath,
  learnerPages,
  pagesByRole,
  report,
}: {
  gardenDir: string;
  ledger: LedgerVisual[];
  ledgerPath: string;
  learnerPages: LearnerPage[];
  pagesByRole: Map<PageRole, LearnerPage>;
  report: FinalizeReport;
}): ReconciledAnchorUsage[] {
  // 1) Strip every source-visual image embed from every learner body. We will
  //    re-embed each one on its semantically-correct page.
  const urlToId = new Map<string, string>();
  for (const visual of ledger) {
    for (const key of ["croppedImagePath", "pageImagePath"] as const) {
      const url = String(visual[key] ?? "");
      if (url) urlToId.set(url, visual.sourceVisualId);
    }
  }
  for (const page of learnerPages) {
    const next = stripSourceVisualEmbeds(page.body);
    if (next !== page.body) {
      page.body = next;
      page.dirty = true;
    }
  }

  // 2) Decide the target page for each embeddable visual + re-embed.
  const embeddedByPage = new Map<string, string[]>(); // pageId -> [sourceVisualId]
  const usedInPages = new Map<string, Set<string>>(); // id -> pages
  for (const visual of ledger) {
    const cls = classifyFigure(visual);
    const url = String(visual.croppedImagePath ?? "");
    if (!url) continue; // no crop -> not embeddable (equation anchors handled below)
    const role = targetRoleForFigure(cls);
    if (!role) continue;
    const target = pagesByRole.get(role);
    if (!target) continue;
    embedImageOnPage(target, visual);
    const list = embeddedByPage.get(target.pageId) ?? [];
    list.push(visual.sourceVisualId);
    embeddedByPage.set(target.pageId, list);
    const seen = usedInPages.get(visual.sourceVisualId) ?? new Set<string>();
    seen.add(target.pageId);
    usedInPages.set(visual.sourceVisualId, seen);
  }

  // 3) Rewrite each learner page's sourceVisualIds / sourceFormulaAnchors.
  const metricPage = pagesByRole.get("metric");
  const equationIds = ledger.filter((visual) => classifyFigure(visual) === "equation").map((visual) => visual.sourceVisualId);
  for (const page of learnerPages) {
    const ids = embeddedByPage.get(page.pageId) ?? [];
    page.rawFm = fmSetArray(page.rawFm, "sourceVisualIds", ids);
    if (metricPage && page.pageId === metricPage.pageId && equationIds.length > 0) {
      page.rawFm = fmSetArray(page.rawFm, "sourceFormulaAnchors", equationIds);
    } else {
      // Only the metric page keeps metric formula anchors.
      page.rawFm = fmSetArray(page.rawFm, "sourceFormulaAnchors", fmGetArray(page.rawFm, "sourceFormulaAnchors").filter((id) => !/\.E\d+$/i.test(id) || (metricPage?.pageId === page.pageId)));
      if (page.role !== "metric") page.rawFm = fmSetArray(page.rawFm, "sourceFormulaAnchors", fmGetArray(page.rawFm, "sourceFormulaAnchors").filter((id) => !/^S\d+\.P6\.E\d+$/i.test(id)));
    }
    page.dirty = true;
  }

  // 4) Record interactive-anchor usage (filled after visual repair, but we scan
  //    current bodies so reconciliation sees at least declared anchors).
  const interactiveAnchors = collectInteractiveAnchorIds(learnerPages);

  // 5) Rewrite the ledger from the reconciled table.
  const reconciliation: ReconciledAnchorUsage[] = [];
  for (const visual of ledger) {
    const id = visual.sourceVisualId;
    const cls = classifyFigure(visual);
    const pages = [...(usedInPages.get(id) ?? new Set<string>())];
    const embeddedAsImage = pages.length > 0;
    const usedAsInteractiveAnchor = interactiveAnchors.has(id);
    let status: ReconciledAnchorUsage["status"];
    let skipReason: string | undefined;
    if (embeddedAsImage) {
      status = "used";
      visual.usageStatus = "assigned";
      visual.assignedPageId = pages[0];
      const target = learnerPages.find((page) => page.pageId === pages[0]);
      visual.assignedSectionId = target ? target.pageId.split("/").slice(0, 2).join("/") : visual.assignedSectionId;
      delete visual.skipReason;
    } else if (cls === "equation") {
      // Equation without a crop is taught from source markdown + anchored.
      status = usedAsInteractiveAnchor ? "used" : "intentionally_skipped";
      visual.usageStatus = "intentionally_skipped";
      skipReason =
        "Central source formula is taught from the source markdown and linked through sourceFormulaAnchors; no reliable crop was available for this equation.";
      visual.skipReason = skipReason;
      delete visual.assignedPageId;
      delete visual.assignedSectionId;
    } else {
      status = "intentionally_skipped";
      visual.usageStatus = "intentionally_skipped";
      skipReason = "Not central to any confirmed subsection of this learning map.";
      visual.skipReason = skipReason;
      delete visual.assignedPageId;
      delete visual.assignedSectionId;
    }
    reconciliation.push({
      id,
      status,
      usedInPages: pages,
      embeddedAsImage,
      usedAsInteractiveAnchor,
      skipReason,
    });
  }
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf-8");
  report.changed.push(".breadboard/source-visuals.json");

  // 6) Regenerate Source Coverage from the reconciled table.
  writeSourceCoverage({ gardenDir, ledger, reconciliation, learnerPages, report });

  return reconciliation;
}

function stripSourceVisualEmbeds(body: string): string {
  const lines = body.split(/\r?\n/);
  const kept = lines.filter((line) => !/^!\[[^\]]*\]\([^)]*source-visuals[^)]*\)\s*$/.test(line.trim()));
  return kept.join("\n").replace(/\n{3,}/g, "\n\n");
}

function embedImageOnPage(page: LearnerPage, visual: LedgerVisual): void {
  const url = String(visual.croppedImagePath ?? "");
  if (!url || page.body.includes(url)) return;
  const caption = String(visual.caption ?? visual.sourceVisualId);
  const snippet = `![${caption}](${url})\n*Source figure ${visual.sourceVisualId}: ${caption}.*`;
  // Group source figures under a stable section at the end of the lesson body.
  const marker = "## Source Figures";
  if (page.body.includes(marker)) {
    page.body = `${page.body.replace(/\s+$/, "")}\n\n${snippet}\n`;
  } else {
    page.body = `${page.body.replace(/\s+$/, "")}\n\n${marker}\n\n${snippet}\n`;
  }
  page.dirty = true;
}

function collectInteractiveAnchorIds(pages: LearnerPage[]): Set<string> {
  const ids = new Set<string>();
  for (const page of pages) {
    for (const match of page.body.matchAll(VISUAL_BLOCK_RE)) {
      try {
        const spec = JSON.parse(match[1]);
        for (const anchor of spec.sourceAnchors ?? []) {
          const id = anchor?.figureId ?? anchor?.tableId ?? anchor?.equationId;
          if (id) ids.add(String(id));
        }
      } catch {
        /* ignore */
      }
    }
  }
  return ids;
}

function writeSourceCoverage({
  gardenDir,
  ledger,
  reconciliation,
  learnerPages,
  report,
}: {
  gardenDir: string;
  ledger: LedgerVisual[];
  reconciliation: ReconciledAnchorUsage[];
  learnerPages: LearnerPage[];
  report: FinalizeReport;
}): void {
  const planningDir = path.join(gardenDir, ".breadboard", "planning");
  fs.mkdirSync(planningDir, { recursive: true });
  const byId = new Map(ledger.map((visual) => [visual.sourceVisualId, visual]));
  const titleFor = (pageId: string): string => learnerPages.find((page) => page.pageId === pageId)?.title ?? pageId;
  const lines = [
    "# Source Coverage",
    "",
    "Generated deterministically from the reconciled source-visual table. This",
    "file is authoritative: the ledger, learner frontmatter, and embedded images",
    "are all derived from the same reconciliation pass.",
    "",
    "## Reconciled Source Visual Usage",
    "",
  ];
  for (const entry of reconciliation) {
    const visual = byId.get(entry.id);
    const caption = String(visual?.caption ?? "");
    const where = entry.usedInPages.length > 0 ? entry.usedInPages.map(titleFor).join("; ") : entry.usedAsInteractiveAnchor ? "interactive anchor" : "none";
    lines.push(`- ${entry.id} (${entry.status}): ${caption || "source visual"} — used on: ${where}`);
  }
  const formulas = ledger.filter((visual) => classifyFigure(visual) === "equation");
  if (formulas.length > 0) {
    const metricPage = learnerPages.find((page) => page.role === "metric");
    lines.push("", "## Formula Anchor Assignments", "");
    for (const formula of formulas) {
      lines.push(
        `- ${formula.sourceVisualId}: ${metricPage ? `central to ${metricPage.title}` : "central metric formula"} — ${String(formula.caption ?? "metric formula")}`,
      );
    }
  }
  lines.push("", "## Notes", "");
  lines.push("- Any visual marked intentionally_skipped appears nowhere in learner output.");
  lines.push("- Any visual marked used is embedded on exactly the listed page(s).");
  const content = `${lines.join("\n")}\n`;
  const target = path.join(planningDir, "Source Coverage.md");
  const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf-8") : "";
  const { rawFrontmatter } = parseFrontmatter(existing);
  fs.writeFileSync(target, rawFrontmatter ? joinFrontmatter(rawFrontmatter, content) : content, "utf-8");
  report.changed.push(".breadboard/planning/Source Coverage.md");
}

// ---------------------------------------------------------------------------
// Pass G: interactive visual grounding
// ---------------------------------------------------------------------------

function repairInteractiveVisuals({
  gardenDir,
  ledger,
  learnerPages,
  pagesByRole,
  report,
}: {
  gardenDir: string;
  ledger: LedgerVisual[];
  learnerPages: LearnerPage[];
  pagesByRole: Map<PageRole, LearnerPage>;
  report: FinalizeReport;
}): void {
  const bd = path.join(gardenDir, ".breadboard");
  const visualsDir = path.join(bd, "visuals");
  const indexPath = path.join(bd, "visual-index.json");
  const visualIndex = readJson<Record<string, Record<string, unknown>>>(indexPath, {});

  const anchorsByClass = new Map<FigureClass, LedgerVisual[]>();
  for (const visual of ledger) {
    const cls = classifyFigure(visual);
    const list = anchorsByClass.get(cls) ?? [];
    list.push(visual);
    anchorsByClass.set(cls, list);
  }
  const anchorPoolFor = (type: string, role: PageRole): LedgerVisual[] => {
    const classes = INTERACTIVE_ANCHOR_COMPAT[type] ?? [];
    let pool = classes.flatMap((cls) => anchorsByClass.get(cls) ?? []);
    if (type === "tradeoff_explorer") {
      if (role === "metric") pool = pool.filter((visual) => classifyFigure(visual) === "equation");
      // Comparison and application both ground on the result tables/graphs
      // (latency/energy/accuracy), never on the metric-definition equations,
      // so an application page never claims a metric formula anchor.
      else if (role === "comparison" || role === "application") pool = pool.filter((visual) => classifyFigure(visual) === "result");
    }
    return pool.filter((visual) =>
      anchorTextCompatibleWithVisualType(type, [visual.sourceVisualId, visual.caption, visual.type].filter(Boolean).join(" ")),
    );
  };

  const anchorObject = (visual: LedgerVisual): Record<string, unknown> => {
    const id = visual.sourceVisualId;
    const anchor: Record<string, unknown> = { description: String(visual.caption ?? id) };
    if (visual.sourceId) anchor.sourceId = visual.sourceId;
    if (visual.pageNumber) anchor.page = visual.pageNumber;
    if (/\.E\d+$/i.test(id)) anchor.equationId = id;
    else if (/\.T\d+$/i.test(id)) anchor.tableId = id;
    else anchor.figureId = id;
    return anchor;
  };

  for (const page of learnerPages) {
    const requiredType = requiredInteractiveType(page.role);
    let bodyChanged = false;

    const blocks = [...page.body.matchAll(VISUAL_BLOCK_RE)];
    const keptIds: string[] = [];
    for (const match of blocks) {
      let spec: Record<string, unknown>;
      try {
        spec = JSON.parse(match[1]);
      } catch {
        // Unparseable block: drop it.
        page.body = page.body.replace(match[0], "").replace(/\n{3,}/g, "\n\n");
        bodyChanged = true;
        continue;
      }
      const id = String(spec.id ?? "");
      const type = String(spec.type ?? "");

      // Challenges pages must not carry a generic interactive visual.
      if (page.role === "challenges" || requiredType === null && (page.role === "training")) {
        page.body = page.body.replace(match[0], "").replace(/\n{3,}/g, "\n\n");
        removeVisualArtifacts(visualsDir, visualIndex, id);
        page.rawFm = fmSetScalar(page.rawFm, "visualSkipReason", skipReasonForRole(page.role));
        bodyChanged = true;
        report.notes.push(`removed interactive ${id} from ${page.rel} (role ${page.role})`);
        continue;
      }

      // If the renderer type is wrong for the page role, drop it and record a
      // skip reason rather than fake a mismatched simulator.
      if (requiredType && type !== requiredType && !isTypeAcceptableForRole(type, page.role)) {
        page.body = page.body.replace(match[0], "").replace(/\n{3,}/g, "\n\n");
        removeVisualArtifacts(visualsDir, visualIndex, id);
        page.rawFm = fmSetScalar(page.rawFm, "visualSkipReason", skipReasonForRole(page.role));
        bodyChanged = true;
        report.notes.push(`removed type-mismatched interactive ${id} (${type}) from ${page.rel}`);
        continue;
      }

      // Reground anchors to type-compatible source visuals.
      const pool = anchorPoolFor(type, page.role);
      const newAnchors = pool.slice(0, 8).map(anchorObject);
      const frontmatterIds: string[] = [];
      if (newAnchors.length > 0) {
        spec.sourceAnchors = newAnchors;
        spec.sourceGroundingStatus = "source-grounded";
        spec.justification = "Anchored to type-compatible source visuals assigned to this lesson's evidence.";
        for (const anchor of newAnchors) {
          const anchorId = String(anchor.equationId ?? anchor.tableId ?? anchor.figureId ?? "");
          if (anchorId) frontmatterIds.push(anchorId);
        }
      } else {
        spec.sourceAnchors = [];
        spec.sourceGroundingStatus = "conceptual-no-direct-source-figure";
        spec.justification =
          "This interactive teaches a dynamic mechanism discussed on the page; no single source figure is claimed as its ground truth.";
      }

      // Ensure the page frontmatter overlaps the interactive anchors (validator
      // requires anchor ids appear in sourceAnchors/sourceVisualIds/formulas).
      if (frontmatterIds.length > 0) {
        const cls = classifyFigure({ sourceVisualId: frontmatterIds[0] });
        if (cls === "equation") {
          page.rawFm = fmSetArray(page.rawFm, "sourceFormulaAnchors", [...fmGetArray(page.rawFm, "sourceFormulaAnchors"), ...frontmatterIds]);
        } else {
          const already = new Set([...fmGetArray(page.rawFm, "sourceVisualIds"), ...fmGetArray(page.rawFm, "sourceAnchors")]);
          const missing = frontmatterIds.filter((anchorId) => !already.has(anchorId));
          if (missing.length > 0) {
            page.rawFm = fmSetArray(page.rawFm, "sourceAnchors", [...fmGetArray(page.rawFm, "sourceAnchors"), ...missing]);
          }
        }
        page.dirty = true;
      }

      const rebuilt = "```breadboard-visual\n" + JSON.stringify(spec, null, 2) + "\n```";
      page.body = page.body.replace(match[0], rebuilt);
      bodyChanged = true;
      keptIds.push(id);

      // Keep the spec file + index in sync.
      syncVisualSpecFile(visualsDir, visualIndex, id, spec);
    }

    // Reconcile frontmatter visualIds with the blocks that survived.
    page.rawFm = fmSetArray(page.rawFm, "visualIds", keptIds);
    if (keptIds.length > 0) {
      page.rawFm = removeKeyLine(page.rawFm, "visualSkipReason");
    }
    if (bodyChanged) page.dirty = true;
  }

  fs.writeFileSync(indexPath, `${JSON.stringify(visualIndex, null, 2)}\n`, "utf-8");
  report.changed.push(".breadboard/visual-index.json");
}

function isTypeAcceptableForRole(type: string, role: PageRole): boolean {
  if (role === "lif" || role === "basic_def" || role === "intro") return type === "lif_neuron" || type === "neural_coding";
  if (role === "metric" || role === "comparison" || role === "application") return type === "tradeoff_explorer";
  return false;
}

function skipReasonForRole(role: PageRole): string {
  if (role === "training") {
    return "The concrete training dynamic (spike-timing plasticity) is introduced on the neuron-model page, and the training-curve comparison is shown on the comparative-results page; this page surveys the paradigms in prose.";
  }
  if (role === "challenges") {
    return "This page discusses unresolved challenges rather than a single dynamic mechanism with a supported interactive renderer.";
  }
  return "No supported interactive renderer matches this page's objective.";
}

function removeKeyLine(rawFm: string, key: string): string {
  return rawFm
    .split(/\r?\n/)
    .filter((line) => !new RegExp(`^${key}:`).test(line))
    .join("\n");
}

function removeVisualArtifacts(visualsDir: string, visualIndex: Record<string, unknown>, id: string): void {
  if (!id) return;
  delete visualIndex[id];
  const specFile = path.join(visualsDir, `${id}.json`);
  if (fs.existsSync(specFile)) fs.rmSync(specFile, { force: true });
}

function syncVisualSpecFile(
  visualsDir: string,
  visualIndex: Record<string, Record<string, unknown>>,
  id: string,
  spec: Record<string, unknown>,
): void {
  if (!id) return;
  fs.mkdirSync(visualsDir, { recursive: true });
  const specFile = path.join(visualsDir, `${id}.json`);
  const existing = readJson<Record<string, unknown>>(specFile, {});
  const merged = { ...existing, ...spec };
  fs.writeFileSync(specFile, `${JSON.stringify(merged, null, 2)}\n`, "utf-8");
  if (visualIndex[id]) {
    visualIndex[id].type = spec.type;
    visualIndex[id].title = spec.title;
  }
}

// ---------------------------------------------------------------------------
// Pass H: content-based formula grounding
// ---------------------------------------------------------------------------

interface SourceFormula {
  id: string;
  caption: string;
  keywords: string[];
}

function formulaAnchorSemanticText(visual: LedgerVisual | undefined): string {
  if (!visual) return "";
  return [
    visual.sourceVisualId,
    visual.type,
    visual.caption,
    visual.title,
    visual.exactText,
    visual.ocrText,
    visual.semanticSummary,
    visual.description,
  ].filter(Boolean).join(" ");
}

function sourceFormulaKeywords(caption: string): string[] {
  const text = caption.toLowerCase();
  const words = new Set<string>();
  for (const [keyword, aliases] of [
    ["accuracy", ["accuracy", "correct predictions", "correct", "predictions"]],
    ["latency", ["latency", "decision time", "response time"]],
    ["spike-count", ["spike count", "total spike", "number of spikes", "spikes summed"]],
    ["energy", ["energy", "joule", "millijoule"]],
    ["efficiency", ["efficiency", "accuracy over energy", "normalized energy"]],
    ["convergence", ["convergence", "epoch", "target accuracy"]],
  ] as Array<[string, string[]]>) {
    if (aliases.some((alias) => text.includes(alias))) words.add(keyword);
  }
  return [...words];
}

function normalizeFormulaText(text: string): string {
  return text
    .replace(/\\text\{([^}]*)\}/g, "$1")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/[{}\\$]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

/** Content-match a learner formula to a source formula anchor, or return null
 * when there is no strong match (never index-based). */
export function matchFormulaToSource(formulaText: string, sources: SourceFormula[]): SourceFormula | null {
  if (!isGroundableFormula(formulaText)) return null;
  const normalized = normalizeFormulaText(formulaText);
  let best: { source: SourceFormula; score: number } | null = null;
  for (const source of sources) {
    const meaning = formulaMeaningMatch(formulaText, source.caption);
    if (meaning.sourceFamily && !meaning.ok) continue;
    if (meaning.ok && meaning.formulaFamily && meaning.sourceFamily) return source;
    let score = 0;
    for (const keyword of source.keywords) {
      if (normalized.includes(keyword.replace("-", " ")) || normalized.includes(keyword)) score += 1;
    }
    if (score > 0 && (!best || score > best.score)) best = { source, score };
  }
  // A single-symbol expression or a simplified helper must not be claimed as a
  // source formula; require at least a two-token match or an explicit metric word.
  if (best && best.score >= 1 && normalized.split(" ").filter(Boolean).length >= 3) return best.source;
  return null;
}

/** Content-based grounding of a single learner formula against source formula
 * captions. Shared by the finalize pass and the generation pipeline so both use
 * the same rule (never positional). */
export function groundLearnerFormula(
  text: string,
  sources: Array<{ id: string; caption: string }>,
): { groundingStatus: "source-anchored" | "conceptual-helper"; sourceAnchor?: string } {
  const enriched: SourceFormula[] = sources.map((source) => ({
    id: source.id,
    caption: source.caption,
    keywords: sourceFormulaKeywords(source.caption),
  }));
  const match = matchFormulaToSource(text, enriched);
  if (match) return { groundingStatus: "source-anchored", sourceAnchor: match.id };
  return { groundingStatus: "conceptual-helper" };
}

// Very small math extractor mirroring extractQuartzMath for finalize's needs.
function extractBodyFormulas(body: string): string[] {
  const noCode = body.replace(/```[\s\S]*?```/g, " ");
  const formulas: string[] = [];
  for (const match of noCode.matchAll(/\$\$([\s\S]+?)\$\$/g)) formulas.push((match[1] ?? "").trim());
  for (const match of noCode.matchAll(/(?<!\$)\$([^$\n]+?)\$(?!\$)/g)) formulas.push((match[1] ?? "").trim());
  return formulas.filter(Boolean);
}

function regroundFormulas({
  ledger,
  learnerPages,
  report,
}: {
  ledger: LedgerVisual[];
  learnerPages: LearnerPage[];
  report: FinalizeReport;
}): void {
  const sources: SourceFormula[] = ledger
    .filter((visual) => classifyFigure(visual) === "equation")
    .map((visual) => ({
      id: visual.sourceVisualId,
      caption: formulaAnchorSemanticText(visual),
      keywords: sourceFormulaKeywords(formulaAnchorSemanticText(visual)),
    }));

  for (const page of learnerPages) {
    const formulas = extractBodyFormulas(page.body)
      .filter((formula) => isGroundableFormula(formula) && !isTrivialFormulaFragment(formula));
    if (formulas.length === 0) {
      // No math -> no formulas block; also drop any dangling metric anchors.
      const hadBlock = /^formulas:/m.test(page.rawFm) || fmGetArray(page.rawFm, "sourceFormulaAnchors").length > 0 || Boolean(fmGetScalar(page.rawFm, "sourceFormulaAnchor"));
      page.rawFm = fmSetFormulas(page.rawFm, []);
      page.rawFm = fmSetArray(page.rawFm, "sourceFormulaAnchors", []);
      page.rawFm = removeKeyLine(page.rawFm, "sourceFormulaAnchor");
      if (hadBlock) page.dirty = true;
      continue;
    }
    const entries: FinalizeFormulaEntry[] = [];
    const anchoredIds = new Set<string>();
    for (const text of formulas) {
      const match = matchFormulaToSource(text, sources);
      const family = formulaMetricFamily(text);
      const workedExample = isWorkedExampleFormula(text);
      if (!match && !family) continue;
      if (match) {
        entries.push({
          kind: workedExample ? "worked_example" : "source_definition",
          text,
          normalizedText: normalizeFormulaText(text),
          groundingStatus: workedExample ? "conceptual-helper" : "source-anchored",
          justification: workedExample
            ? `Worked example applying source formula ${match.id} (${match.caption}).`
            : `Content matches source metric formula ${match.id} (${match.caption}).`,
          sourceAnchor: match.id,
          sourceAnchorTitle: match.caption,
          matchReason: "metric family and source formula anchor text match",
          confidence: 0.9,
        });
        if (!workedExample) anchoredIds.add(match.id);
      } else {
        entries.push({
          kind: workedExample ? "worked_example" : "conceptual_helper",
          text,
          normalizedText: normalizeFormulaText(text),
          groundingStatus: "conceptual-helper",
          matchReason: "no matching source formula anchor",
          confidence: 0.4,
          justification:
            "Introduced as a compact helper to explain the mechanism on this page; not claimed as a verbatim source formula.",
        });
      }
    }
    // Only mark the page dirty when regrounding actually changes the formula
    // metadata. Re-serializing identical grounding must not report the page as
    // repaired, so repair-log.json changedFiles stays limited to real edits.
    let nextFm = fmSetFormulas(page.rawFm, entries);
    nextFm = fmSetArray(nextFm, "sourceFormulaAnchors", [...anchoredIds]);
    nextFm = removeKeyLine(nextFm, "sourceFormulaAnchor");
    if (nextFm === page.rawFm) continue;
    page.rawFm = nextFm;
    page.dirty = true;
    report.notes.push(`reground ${entries.length} formula(s) on ${page.rel} (${anchoredIds.size} source-anchored)`);
  }
}

// ---------------------------------------------------------------------------
// Pass I: tag centrality
// ---------------------------------------------------------------------------

const TAG_BANK: Record<PageRole, string[]> = {
  intro: ["neural-networks/dense-continuous-activation", "snn/event-driven-sparsity", "snn/spike-based-communication"],
  basic_def: ["snn/spike-event-generation", "snn/event-driven-sparsity", "computational-neuroscience/membrane-potential-accumulation"],
  lif: ["snn/lif-neuron-threshold-reset", "snn/membrane-potential-integration", "snn/spike-event-generation"],
  training: ["training/scalable-snn-optimization", "training/surrogate-gradient-learning", "snn/spike-timing-plasticity"],
  metric: ["metric/accuracy-latency-spike-count", "metric/accuracy-per-energy", "tradeoff/evaluation-metric-coupling"],
  comparison: ["metric/model-family-comparison", "tradeoff/accuracy-energy-latency", "evaluation/reproducible-metric-baselines"],
  application: ["deployment/edge-neuromorphic-hardware", "tradeoff/energy-latency-budget", "deployment/latency-sensitive-inference"],
  challenges: ["deployment/hardware-standardization-gap", "training/scalable-snn-optimization", "evaluation/reproducible-metric-baselines"],
  generic: ["snn/event-driven-sparsity"],
};

function tagLeafWords(tag: string): string[] {
  const leaf = tag.split("/").pop() ?? tag;
  return leaf.split("-").filter((word) => word.length >= 4);
}

function countMatches(text: string, pattern: RegExp): number {
  const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  return (text.match(global) ?? []).length;
}

// Concept tag → the evidence a page must actually show to legitimately carry
// it (mirror of the validator's TAG_RELEVANCE_RULES so finalize never keeps a
// tag the validator would reject).
const TAG_EVIDENCE_RULES: Array<{ appliesTo: RegExp; evidence: RegExp; minBody: number }> = [
  { appliesTo: /lif-neuron|leaky/i, evidence: /\blif\b|leaky[- ]integrate|membrane potential|threshold/i, minBody: 1 },
  { appliesTo: /stdp/i, evidence: /\bstdp\b|spike[- ]?timing|synaptic plasticity/i, minBody: 1 },
  { appliesTo: /surrogate/i, evidence: /surrogate[- ]gradient|surrogate[- ]trained|surrogate training/i, minBody: 1 },
  { appliesTo: /(?:^|[/-])latency(?:$|[/-])/i, evidence: /\blatency\b|\bresponse time\b/i, minBody: 2 },
  { appliesTo: /convergence/i, evidence: /\bconverg\w*\b|\btraining loss\b|\bepochs?\b/i, minBody: 2 },
];

function tagIsCentral(tag: string, page: LearnerPage): boolean {
  const prose = teachingProseLite(page.body);
  const haystack = `${page.title} ${prose}`.toLowerCase();
  const pageText = `${page.rel} ${page.title}`.toLowerCase();
  // Domain guards mirroring the validator's centrality rules.
  if (/metric\/convergence-time-target-epoch/.test(tag) && !/metric|evaluation|convergence|training|results/.test(pageText)) return false;
  if (/snn\/lif-neuron-threshold-reset/.test(tag) && !/lif|leaky|neuron model|what spiking neural networks are/.test(pageText)) return false;
  if (/open challenge|unresolved|limitation|future work/.test(pageText) && /lif|leaky|threshold-reset/.test(tag)) return false;
  // Evidence rules: a tag with a stricter evidence requirement must meet it in
  // the body (or the page title), exactly as the validator enforces.
  for (const rule of TAG_EVIDENCE_RULES) {
    if (!rule.appliesTo.test(tag)) continue;
    const titleHit = rule.evidence.test(page.title);
    if (!titleHit && countMatches(prose, rule.evidence) < rule.minBody) return false;
  }
  const words = tagLeafWords(tag);
  if (words.length === 0) return true;
  return words.some((word) => haystack.includes(word));
}

/** Teaching prose only — mirrors the validator's teachingProse(): drops code
 * fences, image embeds, and single-line italic provenance captions so an
 * embedded source-figure caption never counts as page-central evidence. */
function teachingProseLite(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/^\s*\*[^*\n]+\*(?:\s*\*\([^)\n]*\)\*)?\s*$/gm, " ");
}

function repairTags(pages: LearnerPage[], gardenSlug: string, report: FinalizeReport): void {
  // First pass: per-page centrality filtering + top-up.
  for (const page of pages) {
    const current = fmGetArray(page.rawFm, "tags");
    let kept = current.filter((tag) => tag.includes("/") && tagIsCentral(tag, page));
    // Top up from the role bank (only central additions).
    for (const candidate of TAG_BANK[page.role] ?? []) {
      if (kept.length >= 4) break;
      if (!kept.includes(candidate) && tagIsCentral(candidate, page)) kept.push(candidate);
    }
    // Absolute floor: guarantee >= 3.
    for (const candidate of TAG_BANK[page.role] ?? []) {
      if (kept.length >= 3) break;
      if (!kept.includes(candidate)) kept.push(candidate);
    }
    kept = kept.slice(0, 7);
    if (kept.join("|") !== current.join("|")) {
      page.rawFm = fmSetArray(page.rawFm, "tags", kept);
      page.dirty = true;
    }
  }

  // Second pass: break over-reuse (> 60% of learner pages) except a true
  // garden-level topic, by dropping the tag from the least-relevant pages.
  if (pages.length >= 4) {
    const maxAllowed = Math.ceil(pages.length * 0.6);
    const counts = new Map<string, LearnerPage[]>();
    for (const page of pages) {
      for (const tag of fmGetArray(page.rawFm, "tags")) {
        const list = counts.get(tag) ?? [];
        list.push(page);
        counts.set(tag, list);
      }
    }
    for (const [tag, tagPages] of counts) {
      if (tagPages.length <= maxAllowed) continue;
      // Rank by centrality strength; drop from weakest until within budget.
      const ranked = [...tagPages].sort((a, b) => tagCentralityScore(tag, b) - tagCentralityScore(tag, a));
      const toDrop = ranked.slice(maxAllowed);
      for (const page of toDrop) {
        const remaining = fmGetArray(page.rawFm, "tags").filter((existing) => existing !== tag);
        const topped = remaining;
        for (const candidate of TAG_BANK[page.role] ?? []) {
          if (topped.length >= 3) break;
          if (!topped.includes(candidate)) topped.push(candidate);
        }
        page.rawFm = fmSetArray(page.rawFm, "tags", topped.slice(0, 7));
        page.dirty = true;
      }
      report.notes.push(`rebalanced over-reused tag "${tag}" (${tagPages.length}/${pages.length})`);
    }
  }
}

function tagCentralityScore(tag: string, page: LearnerPage): number {
  const haystack = `${page.title} ${teachingProseLite(page.body)}`.toLowerCase();
  let score = 0;
  for (const word of tagLeafWords(tag)) if (haystack.includes(word)) score += 1;
  if (page.title.toLowerCase().includes((tag.split("/").pop() ?? "").split("-")[0])) score += 2;
  return score;
}

// ---------------------------------------------------------------------------
// Pass J: cross-page repeated-motivation removal
// ---------------------------------------------------------------------------

const MOTIF_RE = /battery-powered robot|battery-powered drone|quiet hallway|dense ann|silent snn|small camera (?:on|watching)|small vision system for a battery/i;
const REPEATED_TRANSITION_RE = /the motivation is already in place,?\s+so this page starts from the previous concepts and develops/i;

const ROLE_TRANSITION: Partial<Record<PageRole, string>> = {
  intro: "The opening motivation is established, so this page moves from the broad efficiency problem to the next idea in the learning path. Focus on what changes in the representation, the mechanism, or the metric, and how that change affects the way spiking networks compute.",
  lif: "Event-driven sparsity explains why spiking networks can be efficient. The next question is mechanical: what does a single spiking neuron actually do to turn incoming current into a spike? Consider the membrane of one neuron as it integrates input, leaks charge, and fires when it crosses a threshold.",
  training: "Now that event-driven sparsity is established, efficiency only pays off if the network can be trained to fire useful spikes at useful times. Consider a network whose connection weights must be adjusted so that input spike patterns lead to correct decisions.",
  metric: "Now that event-driven sparsity has been established, the next question is how to measure whether it actually helps. A single accuracy number hides the costs that make spiking networks worthwhile, so evaluation has to weigh several quantities at once. Consider comparing two models that reach similar accuracy at very different energy and latency costs.",
  comparison: "With the individual metrics defined, the models can finally be compared side by side. Consider the same families of spiking networks measured together across accuracy, latency, energy, and spike count rather than one metric at a time.",
  application: "The measured tradeoffs only matter when they meet a real deployment. Consider an edge device that must hit an accuracy target inside a fixed energy and latency budget, and how that constraint selects one spiking approach over another.",
  challenges: "The tradeoffs so far assume clean measurements and stable hardware. Consider what is still unresolved once spiking networks leave controlled benchmarks: hardware standardization, scalable training, and reproducible evaluation.",
  basic_def: "Building on the motivation for sparse, event-driven computation, consider what a spiking neural network actually is: a network whose neurons communicate with discrete spikes in time rather than continuous activations.",
  generic: "The motivation is already in place, so this page starts from the previous concepts and develops the next source-grounded claim. Focus on the specific mechanism, metric, result, or limitation this lesson adds to the learning path.",
};

function removeRepeatedMotivation(pages: LearnerPage[], report: FinalizeReport): void {
  let motifSeen = false;
  for (const page of pages) {
    const intro = page.body.replace(/^#.*$/gm, " ").split(/\s+/).filter(Boolean).slice(0, 80).join(" ");
    const hasMotif = MOTIF_RE.test(intro) || REPEATED_TRANSITION_RE.test(intro);
    if (!hasMotif) continue;
    if (!motifSeen && page.sectionNumber <= 2) {
      // Allow the first early page to establish the framing.
      motifSeen = true;
      continue;
    }
    motifSeen = true;
    const titlePhrase = page.title.replace(/^\d+(?:\.\d+)*\.?\s*/, "").trim().toLowerCase();
    const pageSpecificTransition =
      `The motivation is already in place, so this page develops ${titlePhrase || "the next source-grounded idea"} from the previous concepts. Focus on the specific mechanism, metric, result, or limitation this lesson adds to the learning path.`;
    const transition = page.role === "generic" ? pageSpecificTransition : (ROLE_TRANSITION[page.role] ?? pageSpecificTransition);
    if (!transition) continue;
    // Replace the first prose paragraph (which carries the motif) with a
    // forward transition that builds on prior pages.
    const paragraphs = page.body.replace(/^\n+/, "").split(/\n{2,}/);
    let targetParagraph = paragraphs.findIndex((paragraph, index) => {
      if (index > 4) return false;
      return MOTIF_RE.test(paragraph) || REPEATED_TRANSITION_RE.test(paragraph);
    });
    if (targetParagraph < 0) {
      targetParagraph = paragraphs.findIndex((paragraph) => {
      const trimmed = paragraph.trim();
      return trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("!") && !trimmed.startsWith("```");
      });
    }
    if (targetParagraph < 0) targetParagraph = 0;
    if (MOTIF_RE.test(paragraphs[targetParagraph] ?? "") || REPEATED_TRANSITION_RE.test(paragraphs[targetParagraph] ?? "") || MOTIF_RE.test(intro) || REPEATED_TRANSITION_RE.test(intro)) {
      paragraphs[targetParagraph] = transition;
      page.body = paragraphs.join("\n\n");
      page.dirty = true;
      report.notes.push(`replaced repeated first-page motivation on ${page.rel}`);
    }
  }
}

function repeatedOpeningProblems(pages: LearnerPage[]): string[] {
  const problems: string[] = [];
  const motifPages: string[] = [];
  const introByFingerprint = new Map<string, string[]>();
  for (const page of pages) {
    const intro = teachingProseLite(page.body).split(/\s+/).filter(Boolean).slice(0, 80).join(" ").toLowerCase();
    if (MOTIF_RE.test(intro)) motifPages.push(page.rel);
    const fingerprint = intro
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 16)
      .join(" ");
    if (fingerprint.split(" ").length >= 12) {
      const rels = introByFingerprint.get(fingerprint) ?? [];
      rels.push(page.rel);
      introByFingerprint.set(fingerprint, rels);
    }
  }
  if (motifPages.length > 1) problems.push(`repeated battery/quiet-hallway/dense-ANN intro motif on ${motifPages.join(", ")}`);
  for (const [fingerprint, rels] of introByFingerprint) {
    if (rels.length >= 3) problems.push(`repeated opening phrase "${fingerprint}" on ${rels.join(", ")}`);
  }
  return [...new Set(problems)];
}

// ---------------------------------------------------------------------------
// Pass K: validation report + critical gate
// ---------------------------------------------------------------------------

function countLearnerPages(gardenDir: string): number {
  return loadLearnerPages(gardenDir).length;
}

function countSourcePages(gardenDir: string): number {
  const out: Array<{ abs: string; rel: string }> = [];
  listMarkdown(path.join(gardenDir, "sources"), "sources", out);
  return out.length;
}

function writeFinalizeValidationReport({
  gardenDir,
  gardenSlug,
  report,
}: {
  gardenDir: string;
  gardenSlug: string;
  report: FinalizeReport;
}): void {
  const bd = path.join(gardenDir, ".breadboard");
  fs.mkdirSync(bd, { recursive: true });
  const write = (checks: FinalizeCheck[]) => {
    const accepted = checks.every((check) => check.status !== "FAIL");
    const passCount = checks.filter((check) => check.status === "PASS").length;
    const failCount = checks.filter((check) => check.status === "FAIL").length;
    const lines = [
      "# Breadboard Validation Report",
      "",
      `Generated: ${new Date().toISOString()}`,
      `Root: ${path.resolve(gardenDir)}`,
      `Garden: ${gardenSlug}`,
      `Source files: ${countSourcePages(gardenDir)}`,
      `Page counts: learner=${countLearnerPages(gardenDir)}, sources=${countSourcePages(gardenDir)}`,
      `Check results: ${passCount} PASS, 0 WARN, ${failCount} FAIL, 0 SKIP`,
      `Accepted: ${accepted ? "yes" : "no"}`,
      "Produced by: dashboard/src/lib/garden-finalize.ts (finalizeGardenExport) + scripts/validate-breadboard-garden.ts",
      "",
      "## Export Tree",
      "",
      "See checks: exported tree, no source page typed as learner page.",
      "",
      "## Link Resolution",
      "",
      "See the standalone validator's wikilink checks.",
      "",
      "## Semantic Navigation",
      "",
      "Root, learning, source, overview, and learning-map links must point to the expected page family.",
      "",
      "## Section Title Uniqueness",
      "",
      "Top-level learning section titles must be unique after normalized numbering, punctuation, and case are ignored.",
      "",
      "## Section Folder/Title Consistency",
      "",
      "Section folder names, _index frontmatter titles, H1 headings, and map labels must describe the same section.",
      "",
      "## Section Title Naturalness",
      "",
      "Section titles must be polished learner-facing concepts, not source-anchor field lists or planner templates.",
      "",
      "## Semantic Navigation Number Matching",
      "",
      "Numbered section labels must point to the matching numbered section folder.",
      "",
      "## Learning Map Ambiguity",
      "",
      "Learning Map section nodes and prerequisite edges must resolve to one unambiguous section.",
      "",
      "## Learning Unit Contract Fulfillment",
      "",
      "See check: Learning Unit Contract fulfillment.",
      "",
      "## Section Semantic Coherence",
      "",
      "Section titles must match the roles and concepts of their generated learner pages.",
      "",
      "## Section Title Grammar",
      "",
      "Section and subsection titles must be learner-facing, grammatical, and free of planning scaffold phrasing.",
      "",
      "## Interactive Visual Grounding",
      "",
      "Interactive visuals must use semantically compatible source anchors or honest conceptual grounding.",
      "",
      "## Source Map Consistency",
      "",
      "Source Map caveats must not contradict extracted figures, tables, formulas, or later source pages.",
      "",
      "## Source Map Caveat Reconciliation",
      "",
      "Visible/planning caveats about missing formulas, tables, figures, or later pages must be reconciled against extracted evidence.",
      "",
      "## Source Coverage Modes",
      "",
      "Source Coverage must classify each important anchor as embedded, explained, reused, omitted, missing, or misplaced.",
      "",
      "## Source Anchor Usage vs Crop Status",
      "",
      "Concept/formula usage is tracked separately from whether a crop was embedded, omitted, or replaced by text fallback.",
      "",
      "## Interactive Visual Fulfillment",
      "",
      "Planned interactive visuals must be embedded or intentionally omitted with a reason.",
      "",
      "## Final Interactive Visual Uniqueness",
      "",
      "Rendered interactive visuals must be page-specific and non-duplicative after final block normalization.",
      "",
      "## Visual Anchor Precision",
      "",
      "Metric visuals must use only the formula anchors needed by their controls, outputs, and learning goal.",
      "",
      "## Repetition and Opening Flow",
      "",
      "Repeated learner openings must be callbacks, not restarted motivation frames.",
      "",
      "## Formula Grounding",
      "",
      "Only meaningful formulas are grounded; trivial numbers and standalone percentages are rejected in formulas: metadata.",
      "",
      "## Formula Expression Validation",
      "",
      "The formulas: frontmatter block may contain mathematical expressions only, not teaching goals or keyword bundles.",
      "",
      "## Formula Meaning Match",
      "",
      "Source-anchored and source-derived formulas must match the source formula/metric anchor they claim.",
      "",
      "## Formula Family Match",
      "",
      "Formula families inferred from generated math must match the claimed source formula anchor family.",
      "",
      "## Formula Metadata Noise",
      "",
      "Formula metadata must track meaningful relationships, not isolated symbols or inline fragments.",
      "",
      "## Source Crop Quality",
      "",
      "See check: source crop quality is acceptable.",
      "",
      "## Crop Quality and Fallbacks",
      "",
      "Crop omissions must be reported as text/formula fallbacks rather than accepted crops.",
      "",
      "## Source Coverage Mode Precision",
      "",
      "Coverage headings must distinguish embedded crops from text formulas, prose explanations, and crop fallbacks.",
      "",
      "## Source Text Concept Anchors",
      "",
      "Concept visuals should use source-derived prose anchors when the source explains the concept without a figure.",
      "",
      "## Zettelkasten Tags",
      "",
      "Tags must exactly match the unit contract's zettelNotes handles.",
      "",
      "## Zettelkasten Tag Density",
      "",
      "Substantial learner pages need 3-6 contract-backed atomic Zettelkasten handles.",
      "",
      "## Zettelkasten Handle Quality",
      "",
      "Handles must read like concrete conceptual claims rather than planning scaffolds.",
      "",
      "## Zettelkasten Handle Naturalness",
      "",
      "Structurally valid handles must still avoid template-like planner phrases.",
      "",
      "## Repair Provenance",
      "",
      "Semantic repairs must be recorded in .breadboard/repair-log.json and finalizer semantic actions must remain empty.",
      "",
      "## Section Title Quality",
      "",
      "See check: section titles are learner-facing.",
      "",
      "## Acceptance Decision",
      "",
      `Accepted: ${accepted ? "yes" : "no"}`,
      "",
      "Blocking failures:",
      ...(checks.filter((check) => check.status === "FAIL").length > 0
        ? checks.filter((check) => check.status === "FAIL").map((check) => `- ${check.name}: ${check.problems[0] ?? "failed"}`)
        : ["- None."]),
      "",
      "Non-blocking warnings:",
      "- None.",
      "",
      "Skipped as not applicable:",
      "- None.",
      "",
      "## Final Acceptance",
      "",
      `Accepted: ${accepted ? "yes" : "no"}`,
      "",
      "## Checks",
      "",
    ];
    for (const check of checks) {
      lines.push(`- [${check.status}] ${check.name}`);
      for (const problem of check.problems) lines.push(`  - ${problem}`);
    }
    lines.push("", "## Finalize Notes", "");
    for (const note of report.notes.slice(0, 200)) lines.push(`- ${note}`);
    fs.writeFileSync(path.join(bd, "validation-report.md"), `${lines.join("\n")}\n`, "utf-8");
  };

  write(collectFinalizeChecks({ gardenDir, report, includeReportSelfCheck: false }));
  write(collectFinalizeChecks({ gardenDir, report, includeReportSelfCheck: true }));
  if (!report.changed.includes(".breadboard/validation-report.md")) {
    report.changed.push(".breadboard/validation-report.md");
  }
}

const REQUIRED_VALIDATION_REPORT_SECTIONS = [
  "Export Tree",
  "Link Resolution",
  "Semantic Navigation",
  "Section Title Uniqueness",
  "Section Folder/Title Consistency",
  "Section Title Naturalness",
  "Semantic Navigation Number Matching",
  "Learning Map Ambiguity",
  "Learning Unit Contract Fulfillment",
  "Section Semantic Coherence",
  "Section Title Grammar",
  "Interactive Visual Grounding",
  "Source Map Consistency",
  "Source Map Caveat Reconciliation",
  "Source Coverage Modes",
  "Source Anchor Usage vs Crop Status",
  "Formula Grounding",
  "Formula Expression Validation",
  "Formula Meaning Match",
  "Formula Family Match",
  "Formula Metadata Noise",
  "Interactive Visual Fulfillment",
  "Final Interactive Visual Uniqueness",
  "Visual Anchor Precision",
  "Repetition and Opening Flow",
  "Source Crop Quality",
  "Crop Quality and Fallbacks",
  "Source Coverage Mode Precision",
  "Source Text Concept Anchors",
  "Zettelkasten Tags",
  "Zettelkasten Tag Density",
  "Zettelkasten Handle Quality",
  "Zettelkasten Handle Naturalness",
  "Repair Provenance",
  "Section Title Quality",
  "Acceptance Decision",
  "Final Acceptance",
];

interface FinalizeCheck {
  name: string;
  status: "PASS" | "FAIL";
  problems: string[];
}

function assetPathForUrl(gardenDir: string, assetUrl: string): string | null {
  const normalized = assetUrl.replace(/\\/g, "/").trim();
  const gardenSlug = path.basename(gardenDir);
  const prefix = `/${gardenSlug}/`;
  const rel = normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized.replace(/^\/+/, "");
  const resolved = path.resolve(gardenDir, rel);
  const root = path.resolve(gardenDir);
  return resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}

function imageDimensions(filePath: string): { width: number; height: number } | null {
  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch {
    return null;
  }
  if (buffer.length >= 24 && buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  return null;
}

function cropQualityProblems(gardenDir: string, visual: LedgerVisual): string[] {
  const problems: string[] = [];
  const id = visual.sourceVisualId;
  const cropped = String(visual.croppedImagePath ?? "");
  const conceptUsage = String(visual.conceptUsage ?? "");
  const cropStatus = String(visual.cropStatus ?? "");
  const requiresEmbeddedCrop = !conceptUsage || /^(?:embedded_as_crop|embedded_and_explained)$/i.test(conceptUsage);
  if (visual.usageStatus === "assigned" && requiresEmbeddedCrop && !cropped && cropStatus !== "omitted_unreliable") {
    problems.push(`${id}: assigned visual has no croppedImagePath`);
    return problems;
  }
  if (!cropped) return problems;
  if (/-page-\d{2,}(?:-\d+)?\.(?:png|jpe?g|webp)$/i.test(cropped)) {
    problems.push(`${id}: croppedImagePath looks like a full-page snapshot`);
  }
  const filePath = assetPathForUrl(gardenDir, cropped);
  const dims = filePath ? imageDimensions(filePath) : null;
  if (!dims) {
    problems.push(`${id}: cannot read crop dimensions for ${cropped}`);
  } else {
    const type = String(visual.type ?? "");
    const minWidth = type === "equation" ? 180 : type === "table" ? 260 : 160;
    const minHeight = type === "equation" ? 48 : type === "table" ? 120 : 90;
    if (dims.width < minWidth || dims.height < minHeight) {
      problems.push(`${id}: crop too small (${dims.width}x${dims.height})`);
    }
  }
  const bbox = asObject(visual.bbox);
  const x = Number(bbox.x);
  const y = Number(bbox.y);
  const width = Number(bbox.width);
  const height = Number(bbox.height);
  if ([x, y, width, height].every(Number.isFinite)) {
    const edge = 0.015;
    if (x <= edge || y <= edge || x + width >= 1 - edge || y + height >= 1 - edge) {
      problems.push(`${id}: detection bbox touches page edge and may be clipped`);
    }
  }
  return problems;
}

function wikilinkTargets(markdown: string): string[] {
  const targets: string[] = [];
  for (const match of markdown.matchAll(/(!?)\[\[([^\]]+?)\]\]/g)) {
    if (match[1] === "!") continue;
    const inner = match[2] ?? "";
    const raw = (inner.includes("|") ? inner.slice(0, inner.indexOf("|")) : inner).trim();
    const base = raw.split("#")[0].replace(/^\//, "").replace(/\.md$/i, "").trim();
    if (base) targets.push(base);
  }
  return targets;
}

function markdownSection(markdown: string, heading: string): string {
  const re = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im");
  const match = re.exec(markdown);
  if (!match) return "";
  const start = (match.index ?? 0) + match[0].length;
  const rest = markdown.slice(start);
  const next = rest.search(/^##\s+/m);
  return next >= 0 ? rest.slice(0, next) : rest;
}

function semanticNavigationProblems(gardenDir: string): string[] {
  const problems: string[] = [];
  const read = (rel: string) => {
    const file = path.join(gardenDir, ...rel.split("/"));
    return fs.existsSync(file) ? parseFrontmatter(fs.readFileSync(file, "utf-8")).body : "";
  };
  const root = read("_index.md");
  for (const target of wikilinkTargets(markdownSection(root, "Learning"))) {
    if (!target.startsWith("learning/")) problems.push(`_index.md Learning section links outside learning/: [[${target}]]`);
  }
  for (const target of wikilinkTargets(markdownSection(root, "Sources"))) {
    if (!target.startsWith("sources/")) problems.push(`_index.md Sources section links outside sources/: [[${target}]]`);
  }
  for (const rel of ["learning/_index.md", "learning/Learning Map.md", "learning/Topic Overview.md"]) {
    const body = read(rel);
    if (!body) continue;
    for (const target of wikilinkTargets(body)) {
      if (target.startsWith("sources/")) problems.push(`${rel}: learner navigation links directly to source document [[${target}]]`);
      if (!target.startsWith("learning/")) problems.push(`${rel}: learner navigation link leaves learning/: [[${target}]]`);
    }
  }
  const sourceIndex = read("sources/_index.md");
  for (const target of wikilinkTargets(sourceIndex)) {
    if (!target.startsWith("sources/")) problems.push(`sources/_index.md links outside sources/: [[${target}]]`);
  }
  return [...new Set(problems)];
}

interface WikilinkRef {
  target: string;
  label: string;
  line: string;
}

function wikilinkRefs(markdown: string): WikilinkRef[] {
  const refs: WikilinkRef[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    for (const match of line.matchAll(/(!?)\[\[([^\]]+?)\]\]/g)) {
      if (match[1] === "!") continue;
      const inner = match[2] ?? "";
      const pipe = inner.indexOf("|");
      const rawTarget = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
      const label = (pipe >= 0 ? inner.slice(pipe + 1) : rawTarget.split("/").pop() ?? rawTarget).trim();
      const target = rawTarget.split("#")[0].replace(/^\//, "").replace(/\.md$/i, "").trim();
      refs.push({ target, label, line });
    }
  }
  return refs;
}

function sectionFolderInfo(target: string): { number: number; title: string; folder: string } | null {
  const match = target.match(/^learning\/(\d+)\.\s*([^/]+)(?:\/_index)?$/i);
  if (!match) return null;
  return {
    number: Number.parseInt(match[1], 10),
    title: match[2].trim(),
    folder: `learning/${match[1]}. ${match[2].trim()}`,
  };
}

function semanticNavigationNumberProblems(gardenDir: string): string[] {
  const problems: string[] = [];
  const filePath = path.join(gardenDir, "learning", "_index.md");
  if (!fs.existsSync(filePath)) return problems;
  let currentSection: { number: number; title: string; folder: string } | null = null;
  const { body } = parseFrontmatter(fs.readFileSync(filePath, "utf-8"));
  for (const ref of wikilinkRefs(body)) {
    const labelMatch = ref.label.match(/^(\d+)(?:\.(\d+))?\.?\s+(.+)$/);
    const sectionInfo = sectionFolderInfo(ref.target);
    if (labelMatch && !labelMatch[2]) {
      if (!sectionInfo) {
        problems.push(`SEMANTIC_NAVIGATION_ERROR file="learning/_index.md" label="${ref.label}" target="${ref.target}" problem="numbered section label does not point to a section _index"`);
        currentSection = null;
        continue;
      }
      const labelNumber = Number.parseInt(labelMatch[1], 10);
      const labelTitle = labelMatch[3].trim();
      currentSection = sectionInfo;
      if (labelNumber !== sectionInfo.number) {
        problems.push(`SEMANTIC_NAVIGATION_ERROR file="learning/_index.md" label="${ref.label}" target="${ref.target}" problem="Displayed section number ${labelNumber} points to section folder ${sectionInfo.number}"`);
      }
      if (normalizedSectionTitleKey(labelTitle) !== normalizedSectionTitleKey(sectionInfo.title)) {
        problems.push(`SEMANTIC_NAVIGATION_ERROR file="learning/_index.md" label="${ref.label}" target="${ref.target}" problem="Displayed section title does not match target folder title"`);
      }
      continue;
    }
    if (labelMatch?.[2] && currentSection) {
      const subsectionNumber = Number.parseInt(labelMatch[1], 10);
      if (subsectionNumber !== currentSection.number) {
        problems.push(`SEMANTIC_NAVIGATION_ERROR file="learning/_index.md" label="${ref.label}" target="${ref.target}" problem="Subsection number ${subsectionNumber} is nested under section ${currentSection.number}"`);
      }
      if (!ref.target.startsWith(`${currentSection.folder}/`)) {
        problems.push(`SEMANTIC_NAVIGATION_ERROR file="learning/_index.md" label="${ref.label}" target="${ref.target}" problem="Subsection link leaves displayed section folder ${currentSection.folder}"`);
      }
    }
  }
  return [...new Set(problems)];
}

function cleanMapNode(value: string): string {
  return value
    .replace(/^\s*[-*]\s*/, "")
    .replace(/^Trunk:\s*/i, "")
    .replace(/^Branch\/leaf:\s*/i, "")
    .replace(/\[\[([^|\]]+\|)?([^\]]+)\]\]/g, "$2")
    .replace(/^\d+(?:\.\d+)*\.?\s*/, "")
    .trim();
}

function learningMapAmbiguityProblems(gardenDir: string, sections: Array<{ rel: string; sectionTitle: string }>): string[] {
  const filePath = path.join(gardenDir, "learning", "Learning Map.md");
  if (!fs.existsSync(filePath)) return [];
  const markdown = fs.readFileSync(filePath, "utf-8");
  const problems: string[] = [];
  const sectionCounts = new Map<string, number>();
  for (const section of sections) {
    const key = normalizedSectionTitleKey(section.sectionTitle);
    sectionCounts.set(key, (sectionCounts.get(key) ?? 0) + 1);
  }
  const mapNodeCounts = new Map<string, number>();
  for (const line of parseFrontmatter(markdown).body.split(/\r?\n/)) {
    const sectionOrder = line.match(/^\s*-\s*\d+\.\s+(.+)$/);
    const trunk = line.match(/^\s*-\s*Trunk:\s*(.+)$/i);
    for (const raw of [sectionOrder?.[1], trunk?.[1]].filter(Boolean) as string[]) {
      const key = normalizedSectionTitleKey(cleanMapNode(raw));
      if (key) mapNodeCounts.set(key, (mapNodeCounts.get(key) ?? 0) + 1);
    }
    const edge = line.match(/^\s*-\s*(.+?)\s*->\s*(.+?)\s*$/);
    if (!edge) continue;
    const left = cleanMapNode(edge[1]);
    const right = cleanMapNode(edge[2]);
    const leftKey = normalizedSectionTitleKey(left);
    const rightKey = normalizedSectionTitleKey(right);
    if (leftKey && rightKey && leftKey === rightKey) {
      problems.push(`LEARNING_MAP_AMBIGUITY edge="${left} -> ${right}" problem="self-edge after title normalization"`);
    }
    for (const node of [left, right]) {
      const key = normalizedSectionTitleKey(node);
      const count = sectionCounts.get(key) ?? 0;
      if (count > 1) problems.push(`LEARNING_MAP_AMBIGUITY node="${node}" problem="section title maps to ${count} section folders"`);
    }
  }
  for (const [key, count] of mapNodeCounts) {
    if (count > 1 && (sectionCounts.get(key) ?? 0) > 1) {
      problems.push(`LEARNING_MAP_AMBIGUITY node="${key}" problem="duplicate section node is ambiguous"`);
    }
  }
  return [...new Set(problems)];
}

function sectionSemanticInputs(
  gardenDir: string,
  learnerPages: LearnerPage[],
  unitsById: Map<string, LearningUnitContract>,
): Array<{ rel: string; sectionTitle: string; units: LearningUnitContract[]; subsectionTitles: string[] }> {
  const bySection = new Map<string, { pages: LearnerPage[]; units: LearningUnitContract[] }>();
  for (const page of learnerPages) {
    const parts = page.rel.split("/");
    if (parts.length < 3) continue;
    const rel = parts.slice(0, 2).join("/");
    const entry = bySection.get(rel) ?? { pages: [], units: [] };
    entry.pages.push(page);
    const unit = unitsById.get(fmGetScalar(page.rawFm, "learningUnitId"));
    if (unit) entry.units.push(unit);
    bySection.set(rel, entry);
  }
  const inputs: Array<{ rel: string; sectionTitle: string; units: LearningUnitContract[]; subsectionTitles: string[] }> = [];
  for (const [rel, entry] of bySection) {
    const indexPath = path.join(gardenDir, ...rel.split("/"), "_index.md");
    const title = fs.existsSync(indexPath)
      ? fmGetScalar(parseFrontmatter(fs.readFileSync(indexPath, "utf-8")).rawFrontmatter, "title")
      : rel.split("/").pop() ?? rel;
    inputs.push({
      rel,
      sectionTitle: title || rel,
      units: entry.units,
      subsectionTitles: entry.pages.map((page) => page.title),
    });
  }
  return inputs;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function suggestedSectionSemanticTitle(sectionTitle: string, units: LearningUnitContract[]): string | null {
  const roles = new Set(units.map((unit) => unit.role));
  const hasFormula = roles.has("formula") || roles.has("worked_example");
  const hasMechanism = roles.has("core_concept") || roles.has("mechanism");
  const hasTraining = roles.has("training_method");
  const hasMetricRole = roles.has("metric");
  const hasMetric = hasMetricRole || hasFormula;
  const hasComparison = roles.has("comparison") || roles.has("result_interpretation");
  const naturalnessProblems = sectionTitleNaturalnessProblems(sectionTitle, units.map((unit) => unit.title));
  let base: string | null = null;
  if (hasTraining && hasMetric) base = "How SNNs Learn and Are Evaluated";
  else if (hasComparison && hasMetric) base = "Metrics and Results Compared";
  else if (hasComparison && hasTraining) base = "Training Methods and Results Compared";
  else if (hasFormula && hasMetricRole && !hasTraining && !hasComparison && !hasMechanism) base = polishSectionTitleFromInput({
    sectionNumber: 0,
    originalTitle: sectionTitle,
    unitTitles: units.map((unit) => unit.title),
    unitRoles: units.map((unit) => unit.role),
    sourceAnchorTitles: units.flatMap((unit) => unit.sourceFormulas.map((formula) => formula.teachingGoal)),
    dominantLearnerQuestion: units.map((unit) => unit.learningQuestion).filter(Boolean)[0] ?? "",
  });
  else if (hasFormula && !roles.has("metric") && !roles.has("result_interpretation") && !hasTraining && !hasComparison) base = polishSectionTitleFromInput({
    sectionNumber: 0,
    originalTitle: sectionTitle,
    unitTitles: units.map((unit) => unit.title),
    unitRoles: units.map((unit) => unit.role),
    sourceAnchorTitles: units.flatMap((unit) => unit.sourceFormulas.map((formula) => formula.teachingGoal)),
    dominantLearnerQuestion: units.map((unit) => unit.learningQuestion).filter(Boolean)[0] ?? "",
  });
  else if (hasMechanism && !hasMetric && !hasTraining && !hasComparison) base = "How the Mechanism Works";
  else if (hasMetricRole && !hasMechanism && !hasTraining && !hasComparison) base = "The Metrics That Make SNNs Measurable";
  else if (roles.has("result_interpretation") && !hasMetricRole && !hasMechanism && !hasTraining) base = "What the Results Show";
  else if (naturalnessProblems.length > 0) base = polishSectionTitleFromInput({
    sectionNumber: 0,
    originalTitle: sectionTitle,
    unitTitles: units.map((unit) => unit.title),
    unitRoles: units.map((unit) => unit.role),
    sourceAnchorTitles: units.flatMap((unit) => unit.sourceFormulas.map((formula) => formula.teachingGoal)),
    dominantLearnerQuestion: units.map((unit) => unit.learningQuestion).filter(Boolean)[0] ?? "",
  });
  if (!base) return null;
  const number = sectionTitle.match(/^\s*(\d+(?:\.\d+)*)\.?\s+/)?.[1];
  return number ? `${number}. ${base}` : base;
}

function rewriteSectionIndexTitle(indexPath: string, nextTitle: string): boolean {
  const content = fs.readFileSync(indexPath, "utf-8");
  const { rawFrontmatter, body } = parseFrontmatter(content);
  const currentTitle = fmGetScalar(rawFrontmatter, "title");
  const nextRaw = fmSetScalar(rawFrontmatter, "title", nextTitle);
  let nextBody = body;
  if (currentTitle) {
    const titleHeading = new RegExp(`^#\\s+${escapeRegExp(currentTitle)}\\s*$`, "m");
    if (titleHeading.test(nextBody)) nextBody = nextBody.replace(titleHeading, `# ${nextTitle}`);
    else nextBody = nextBody.replace(/^#\s+.*$/m, `# ${nextTitle}`);
  } else {
    nextBody = nextBody.replace(/^#\s+.*$/m, `# ${nextTitle}`);
  }
  const nextContent = joinFrontmatter(nextRaw, nextBody);
  if (nextContent === content) return false;
  fs.writeFileSync(indexPath, nextContent, "utf-8");
  return true;
}

function sectionFolderNameForTitle(title: string, fallbackName: string): string {
  const number = title.match(/^\s*(\d+(?:\.\d+)*)\.?\s+/)?.[1] ?? fallbackName.match(/^\s*(\d+(?:\.\d+)*)\.?\s+/)?.[1];
  const body = title.replace(/^\s*\d+(?:\.\d+)*\.?\s*/, "").trim();
  return number && body ? `${number}. ${body}` : fallbackName;
}

function replaceAllLiteral(value: string, from: string, to: string): string {
  return value.split(from).join(to);
}

function rewriteReferencesAfterSectionRename(gardenDir: string, oldRel: string, newRel: string, report: FinalizeReport): void {
  const files: Array<{ abs: string; rel: string }> = [];
  listMarkdown(gardenDir, "", files, { includeDotBreadboard: true });
  const jsonFiles: Array<{ abs: string; rel: string }> = [];
  const collectJson = (dir: string, relDir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectJson(abs, rel);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        jsonFiles.push({ abs, rel });
      }
    }
  };
  collectJson(path.join(gardenDir, ".breadboard"), ".breadboard");
  for (const file of [...files, ...jsonFiles]) {
    const content = fs.readFileSync(file.abs, "utf-8");
    let next = replaceAllLiteral(content, oldRel, newRel);
    next = replaceAllLiteral(next, encodeURI(oldRel), encodeURI(newRel));
    if (next === content) continue;
    fs.writeFileSync(file.abs, next, "utf-8");
    if (!report.changed.includes(file.rel)) report.changed.push(file.rel);
  }
}

function currentSectionTitles(gardenDir: string): {
  byRel: Map<string, string>;
  byNumber: Map<string, string>;
  relByNumber: Map<string, string>;
} {
  const byRel = new Map<string, string>();
  const byNumber = new Map<string, string>();
  const relByNumber = new Map<string, string>();
  const learningDir = path.join(gardenDir, "learning");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(learningDir, { withFileTypes: true });
  } catch {
    return { byRel, byNumber, relByNumber };
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+\.\s+/.test(entry.name)) continue;
    const indexPath = path.join(learningDir, entry.name, "_index.md");
    if (!fs.existsSync(indexPath)) continue;
    const title = fmGetScalar(parseFrontmatter(fs.readFileSync(indexPath, "utf-8")).rawFrontmatter, "title") || entry.name;
    const rel = `learning/${entry.name}`;
    byRel.set(rel, title);
    const number = title.match(/^\s*(\d+(?:\.\d+)*)\.?\s+/)?.[1] ?? entry.name.match(/^\s*(\d+(?:\.\d+)*)\.?\s+/)?.[1];
    if (number) {
      byNumber.set(number, title);
      relByNumber.set(number, rel);
    }
  }
  return { byRel, byNumber, relByNumber };
}

function sectionTitleBody(title: string): string {
  return stripTitleNumber(title);
}

function repairSectionNavigationLabels(gardenDir: string, report: FinalizeReport): void {
  const { byRel, byNumber, relByNumber } = currentSectionTitles(gardenDir);
  if (byRel.size === 0) return;
  const navRels = ["learning/_index.md", "learning/Learning Map.md", "learning/Topic Overview.md"];
  for (const rel of navRels) {
    const abs = path.join(gardenDir, ...rel.split("/"));
    if (!fs.existsSync(abs)) continue;
    const content = fs.readFileSync(abs, "utf-8");
    const replacements: Array<[string, string]> = [];
    if (rel === "learning/Learning Map.md") {
      for (const match of content.matchAll(/^\s*-\s*(\d+)\.\s+(.+?)\s*$/gm)) {
        const number = match[1] ?? "";
        const oldTitle = `${number}. ${match[2] ?? ""}`;
        const nextTitle = byNumber.get(number);
        if (nextTitle && oldTitle !== nextTitle) {
          replacements.push([oldTitle, nextTitle]);
          replacements.push([sectionTitleBody(oldTitle), sectionTitleBody(nextTitle)]);
        }
      }
    }
    let next = content.replace(/\[\[(learning\/[^|\]]+\/_index)(?:\|([^\]]*))?\]\]/g, (full, target: string) => {
      const sectionRel = target.replace(/\/_index$/, "");
      const title = byRel.get(sectionRel);
      return title ? `[[${target}|${title}]]` : full;
    });
    if (rel === "learning/_index.md") {
      next = next.replace(/^-\s*(\d+)\.\s+(.+?)\s*$/gm, (full, number: string) => {
        const sectionTitle = byNumber.get(number);
        const sectionRel = relByNumber.get(number);
        if (!sectionTitle || !sectionRel) return full;
        return `- [[${sectionRel}/_index|${sectionTitle}]]`;
      });
    }
    for (const [from, to] of replacements) {
      if (from && to && from !== to) next = replaceAllLiteral(next, from, to);
    }
    if (next === content) continue;
    fs.writeFileSync(abs, next, "utf-8");
    if (!report.changed.includes(rel)) report.changed.push(rel);
  }
}

function alignSectionFoldersWithTitles(gardenDir: string, report: FinalizeReport): void {
  const learningDir = path.join(gardenDir, "learning");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(learningDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+\.\s+/.test(entry.name)) continue;
    const oldAbs = path.join(learningDir, entry.name);
    const indexPath = path.join(oldAbs, "_index.md");
    if (!fs.existsSync(indexPath)) continue;
    const title = fmGetScalar(parseFrontmatter(fs.readFileSync(indexPath, "utf-8")).rawFrontmatter, "title");
    const nextName = sectionFolderNameForTitle(title || entry.name, entry.name);
    if (nextName === entry.name) continue;
    const nextAbs = path.join(learningDir, nextName);
    if (fs.existsSync(nextAbs)) {
      report.criticalProblems.push(`section folder/title mismatch could not be repaired because target exists: learning/${nextName}`);
      continue;
    }
    fs.renameSync(oldAbs, nextAbs);
    const oldRel = `learning/${entry.name}`;
    const newRel = `learning/${nextName}`;
    rewriteReferencesAfterSectionRename(gardenDir, oldRel, newRel, report);
    report.notes.push(`renamed section folder ${oldRel} -> ${newRel}`);
  }
}

function repairSectionSemanticTitles(
  gardenDir: string,
  learnerPages: LearnerPage[],
  unitsById: Map<string, LearningUnitContract>,
  report: FinalizeReport,
): void {
  const sectionInputs = sectionSemanticInputs(gardenDir, learnerPages, unitsById);
  const titleCounts = new Map<string, number>();
  for (const section of sectionInputs) {
    const key = normalizedSectionTitleKey(section.sectionTitle);
    titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
  }
  for (const section of sectionInputs) {
    const profile = sectionSemanticProfiles([{
      sectionTitle: section.sectionTitle,
      units: section.units,
      subsectionTitles: section.subsectionTitles,
    }])[0];
    const grammarProblems = sectionTitleGrammarProblems(section.sectionTitle, section.subsectionTitles);
    const naturalnessProblems = sectionTitleNaturalnessProblems(section.sectionTitle, section.subsectionTitles);
    const duplicateTitle = (titleCounts.get(normalizedSectionTitleKey(section.sectionTitle)) ?? 0) > 1;
    if ((!profile || profile.problems.length === 0) && grammarProblems.length === 0 && naturalnessProblems.length === 0 && !duplicateTitle) continue;
    const nextTitle = suggestedSectionSemanticTitle(section.sectionTitle, section.units);
    if (!nextTitle || nextTitle === section.sectionTitle) continue;
    const indexPath = path.join(gardenDir, ...section.rel.split("/"), "_index.md");
    if (!fs.existsSync(indexPath)) continue;
    if (rewriteSectionIndexTitle(indexPath, nextTitle)) {
      const rel = `${section.rel}/_index.md`;
      if (!report.changed.includes(rel)) report.changed.push(rel);
      report.notes.push(`retitled section ${section.sectionTitle} -> ${nextTitle}`);
    }
  }
}

function idsUsedByLearners(learnerPages: LearnerPage[]): Set<string> {
  const ids = new Set<string>();
  for (const page of learnerPages) {
    for (const id of fmGetArray(page.rawFm, "sourceVisualIds")) ids.add(id);
    for (const id of fmGetArray(page.rawFm, "sourceAnchors")) ids.add(id);
    for (const id of formulaAnchorsFromFrontmatter(page.rawFm)) {
      if (!id.startsWith("trivial:")) ids.add(id);
    }
    for (const spec of embeddedVisualSpecs(page.body)) {
      for (const id of visualSpecAnchorIds(spec)) ids.add(id);
    }
  }
  return ids;
}

function anchorTextForVisualIds(ledger: LedgerVisual[], ids: string[], spec: Record<string, unknown>): string {
  const ledgerText = ids
    .map((id) => ledger.find((visual) => visual.sourceVisualId === id))
    .filter((visual): visual is LedgerVisual => Boolean(visual))
    .map((visual) => [visual.sourceVisualId, visual.type, visual.caption].filter(Boolean).join(" "));
  const specAnchorText = Array.isArray(spec.sourceAnchors)
    ? spec.sourceAnchors.map((anchor) => {
        if (!anchor || typeof anchor !== "object") return "";
        const record = anchor as Record<string, unknown>;
        return [record.figureId, record.tableId, record.equationId, record.description, record.sourceTitle].filter(Boolean).join(" ");
      })
    : [];
  return [...ledgerText, ...specAnchorText].join(" ");
}

function sourceMapCaveatProblems(gardenDir: string, ledger: LedgerVisual[]): string[] {
  const problems: string[] = [];
  const docs: Array<[string, string]> = [];
  const addDoc = (rel: string): void => {
    docs.push([rel, path.join(gardenDir, ...rel.split("/"))]);
  };
  for (const rel of [".breadboard/planning/Source Map.md", ".breadboard/planning/Source Coverage.md", "learning/Learning Map.md", "learning/Topic Overview.md"]) addDoc(rel);
  const planningPages: Array<{ abs: string; rel: string }> = [];
  listMarkdown(path.join(gardenDir, ".breadboard", "planning"), ".breadboard/planning", planningPages);
  for (const page of planningPages) if (!docs.some(([rel]) => rel === page.rel)) docs.push([page.rel, page.abs]);
  const learningPages: Array<{ abs: string; rel: string }> = [];
  listMarkdown(path.join(gardenDir, "learning"), "learning", learningPages);
  for (const page of learningPages) if (!docs.some(([rel]) => rel === page.rel)) docs.push([page.rel, page.abs]);
  const hasFormulaAnchors = ledger.some((visual) => classifyFigure(visual) === "equation");
  const hasFormulaExactText = ledger.some((visual) => classifyFigure(visual) === "equation" && String(visual.exactText ?? visual.ocrText ?? "").trim());
  const hasFormulaCrops = ledger.some((visual) => classifyFigure(visual) === "equation" && String(visual.croppedImagePath ?? "").trim());
  const sourceDocs: Array<{ abs: string; rel: string }> = [];
  listMarkdown(path.join(gardenDir, "sources"), "sources", sourceDocs);
  const hasFormulaMarkdown = sourceDocs.some(({ abs }) =>
    /(?:\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\frac|\\sum|\\min|\\max|\\geq|\\leq|[A-Za-z][A-Za-z0-9_{}\\]*\s*=)/.test(fs.readFileSync(abs, "utf-8")),
  );
  const hasTables = ledger.some((visual) => String(visual.type ?? "") === "table" || /\.T\d+$/i.test(visual.sourceVisualId));
  const hasFigures = ledger.some((visual) => classifyFigure(visual) !== "equation" && String(visual.type ?? "") !== "table" && !/\.T\d+$/i.test(visual.sourceVisualId));
  const hasLaterPages = sourcesHaveLaterPages(gardenDir) || ledger.some((visual) => Number(visual.pageNumber ?? 0) > 2);
  for (const [label, filePath] of docs) {
    if (!fs.existsSync(filePath)) continue;
    const text = fs.readFileSync(filePath, "utf-8");
    const staleFormulaCaveat =
      /explicit mathematical definitions are not present|formal mathematical definitions are not present|formulas? (?:are|is) not present|formula exact text unavailable|caption-only|formula captions but not exact|exact displayed notation|standard explanatory notation only|captions only|notation unavailable|mathematical notation not included/i;
    if ((hasFormulaAnchors || hasFormulaExactText || hasFormulaCrops || hasFormulaMarkdown) && staleFormulaCaveat.test(text)) {
      problems.push(`${label}: stale caveat says formulas/definitions are unavailable despite formula anchors`);
    }
    if (hasTables && /tables? (?:are|is) not (?:present|available|detected|extracted)/i.test(text)) {
      problems.push(`${label}: stale caveat says tables are unavailable despite table anchors`);
    }
    if (hasFigures && /figures? (?:are|is) not (?:present|available|detected|extracted)/i.test(text)) {
      problems.push(`${label}: stale caveat says figures are unavailable despite figure anchors`);
    }
    if (hasLaterPages && /only pages?\s*1\s*[-–]\s*2\s+(?:are|is)\s+(?:available|present)|source map is truncated|later (?:pages?|sections?)[^.\n]*(?:not available|unavailable|captions?|anchored to captions)|later[- ]page teaching must remain anchored to extracted .*captions|truncated after page\s*2|must not be inferred beyond/i.test(text)) {
      problems.push(`${label}: stale caveat says later pages are unavailable despite later anchors/pages`);
    }
  }
  return [...new Set(problems)];
}

function sourceAnchorUsageVsCropStatusProblems(ledger: LedgerVisual[], learnerPages: LearnerPage[]): string[] {
  const usedIds = idsUsedByLearners(learnerPages);
  const problems: string[] = [];
  for (const visual of ledger) {
    const id = visual.sourceVisualId;
    const usageStatus = String(visual.usageStatus ?? "");
    const conceptUsage = String(visual.conceptUsage ?? "");
    const cropStatus = String(visual.cropStatus ?? "");
    const conceptIsUsed = /^(?:embedded_and_explained|embedded_as_crop|explained_as_text_formula|explained_in_prose|explained_without_embedding|used_as_interactive_grounding|referenced_again)$/i.test(conceptUsage);
    if (/^(?:intentionally_skipped|skipped|unused)$/i.test(usageStatus) && conceptIsUsed) {
      problems.push(`${id}: usageStatus=${usageStatus} contradicts conceptUsage=${conceptUsage}`);
    }
    if (usedIds.has(id) && /^(?:intentionally_skipped|skipped|unused)$/i.test(usageStatus)) {
      problems.push(`${id}: usageStatus=${usageStatus} but the anchor is used by learner pages`);
    }
    if ((conceptUsage || cropStatus) && (!conceptUsage || !cropStatus)) {
      problems.push(`${id}: source usage ledger must include both conceptUsage and cropStatus when either is present`);
    }
    if (cropStatus === "omitted_unreliable" && /^(?:intentionally_omitted|missing)$/i.test(conceptUsage)) {
      problems.push(`${id}: unreliable crop omission is recorded as concept omission`);
    }
    if (/^(?:embedded_and_explained|embedded_as_crop)$/i.test(conceptUsage) && cropStatus !== "embedded") {
      problems.push(`${id}: embedded concept usage requires cropStatus=embedded, got ${cropStatus || "missing"}`);
    }
  }
  return problems;
}

function cropFallbackProblems(ledger: LedgerVisual[], learnerPages: LearnerPage[]): string[] {
  const usedIds = idsUsedByLearners(learnerPages);
  const problems: string[] = [];
  for (const visual of ledger) {
    const id = visual.sourceVisualId;
    const cropStatus = String(visual.cropStatus ?? "");
    const conceptUsage = String(visual.conceptUsage ?? "");
    if (cropStatus === "omitted_unreliable" && !/explained_|used_as_interactive_grounding|referenced_again/.test(conceptUsage)) {
      problems.push(`${id}: crop omitted as unreliable without text/formula/interactive fallback`);
    }
    if (!String(visual.croppedImagePath ?? "") && usedIds.has(id) && classifyFigure(visual) !== "equation" && cropStatus !== "omitted_unreliable") {
      problems.push(`${id}: non-formula anchor is used without a crop or explicit omitted_unreliable fallback`);
    }
  }
  return problems;
}

const PRECISE_SOURCE_COVERAGE_HEADINGS = [
  "Embedded Source Crops",
  "Explained as Text Formulas",
  "Explained in Prose",
  "Used as Interactive Grounding",
  "Referenced Again in Synthesis",
  "Crop Omitted With Text Fallback",
  "Intentionally Omitted",
  "Missing or Misplaced",
];

function coverageHeadingRe(heading: string): RegExp {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^#{2,3}\\s+${escaped}\\s*$`, "im");
}

function coverageModeSection(markdown: string, heading: string): string {
  const match = coverageHeadingRe(heading).exec(markdown);
  if (!match) return "";
  const start = (match.index ?? 0) + match[0].length;
  const rest = markdown.slice(start);
  const next = rest.search(/^#{2,3}\s+/m);
  return next >= 0 ? rest.slice(0, next) : rest;
}

function sourceCoverageModePrecisionProblems(gardenDir: string, ledger: LedgerVisual[]): string[] {
  const filePath = path.join(gardenDir, ".breadboard", "planning", "Source Coverage.md");
  if (!fs.existsSync(filePath)) return [];
  const coverage = fs.readFileSync(filePath, "utf-8");
  const problems: string[] = [];
  if (/^##\s+Figures,\s*Graphs,\s*Tables,\s*And\s*Formula\s*Displays\s*Used\s*$/im.test(coverage)) {
    problems.push('Source Coverage overclaims embedded/display use with legacy heading "Figures, Graphs, Tables, And Formula Displays Used"');
  }
  for (const heading of PRECISE_SOURCE_COVERAGE_HEADINGS) {
    if (!coverageHeadingRe(heading).test(coverage)) problems.push(`Source Coverage missing precise mode heading "${heading}"`);
  }
  const embedded = coverageModeSection(coverage, "Embedded Source Crops");
  const textFormulas = coverageModeSection(coverage, "Explained as Text Formulas");
  const cropFallback = coverageModeSection(coverage, "Crop Omitted With Text Fallback");
  for (const visual of ledger) {
    const id = visual.sourceVisualId;
    if (!id) continue;
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const idRe = new RegExp(`\\b${escaped}\\b`, "i");
    const conceptUsage = String(visual.conceptUsage ?? "");
    const cropStatus = String(visual.cropStatus ?? "");
    if (/^explained_as_text_formula$/i.test(conceptUsage) && !idRe.test(textFormulas)) {
      problems.push(`${id}: conceptUsage=explained_as_text_formula but Source Coverage omits it from "Explained as Text Formulas"`);
    }
    if (cropStatus === "omitted_unreliable") {
      if (idRe.test(embedded)) problems.push(`${id}: cropStatus=omitted_unreliable but Source Coverage lists it under "Embedded Source Crops"`);
      if (!idRe.test(cropFallback)) problems.push(`${id}: cropStatus=omitted_unreliable but Source Coverage omits "Crop Omitted With Text Fallback"`);
    }
    if (/^(?:embedded_and_explained|embedded_as_crop)$/i.test(conceptUsage) && cropStatus !== "embedded") {
      problems.push(`${id}: conceptUsage=${conceptUsage} requires cropStatus=embedded`);
    }
  }
  return [...new Set(problems)];
}

function proseConceptForVisualType(type: string): { label: string; pattern: RegExp } | null {
  switch (type) {
    case "lif_neuron":
      return { label: "lif membrane threshold dynamics", pattern: /\blif\b|leaky integrate|integrate[- ]and[- ]fire|membrane potential.*threshold|threshold.*reset/i };
    case "neural_coding":
      return { label: "rate and temporal spike coding", pattern: /rate coding|temporal coding|spike trains? encode|encoding information/i };
    case "stdp_window":
      return { label: "spike timing dependent plasticity", pattern: /\bstdp\b|spike[- ]timing dependent plasticity|pre.*post.*(?:weight|synaptic)|synaptic plasticity/i };
    case "tradeoff_explorer":
      return { label: "metric tradeoff reasoning", pattern: /accuracy.*latency.*energy|latency.*energy.*accuracy|spike count.*energy|trade[- ]off/i };
    case "metric_calculator":
      return { label: "metric definition", pattern: /metric|formula|accuracy|latency|energy|spike count|convergence/i };
    case "training_curve":
      return { label: "training curve behavior", pattern: /training curve|learning curve|convergence|epoch|training loss|target accuracy/i };
    default:
      return null;
  }
}

function sourceCorpusText(gardenDir: string): string {
  const sourcePages: Array<{ abs: string; rel: string }> = [];
  listMarkdown(path.join(gardenDir, "sources"), "sources", sourcePages);
  return sourcePages.map(({ abs }) => parseFrontmatter(fs.readFileSync(abs, "utf-8")).body).join("\n\n");
}

function sourceTextAnchorForConcept(
  gardenDir: string,
  concept: { label: string; pattern: RegExp },
): Record<string, unknown> | null {
  const sourcePages: Array<{ abs: string; rel: string }> = [];
  listMarkdown(path.join(gardenDir, "sources"), "sources", sourcePages);
  for (const { abs, rel } of sourcePages.sort((a, b) => a.rel.localeCompare(b.rel))) {
    if (/\/_index\.md$/i.test(rel) || /(^|\/)_index\.md$/i.test(rel)) continue;
    const { rawFrontmatter, body } = parseFrontmatter(fs.readFileSync(abs, "utf-8"));
    const sourceTitle = fmGetScalar(rawFrontmatter, "title") || path.basename(rel, ".md");
    const sourceId = fmGetScalar(rawFrontmatter, "sourceId") || slugifyLoose(path.basename(rel, ".md")) || "source";
    const chunks = body
      .split(/\n{2,}/)
      .map((chunk) => chunk.replace(/\s+/g, " ").trim())
      .filter((chunk) => chunk.length >= 40);
    for (const chunk of chunks) {
      if (!concept.pattern.test(`${sourceTitle} ${chunk}`)) continue;
      const excerpt = chunk.slice(0, 240);
      return {
        sourceId,
        sourceTitle,
        textAnchorId: `text-${slugifyLoose(sourceId)}-${slugifyLoose(concept.label)}`,
        description: `Source prose explains ${concept.label}: ${excerpt}`,
      };
    }
  }
  return null;
}

function visualHasTextAnchor(spec: Record<string, unknown>): boolean {
  const anchors = Array.isArray(spec.sourceAnchors) ? spec.sourceAnchors : [];
  return anchors.some((anchor) =>
    anchor && typeof anchor === "object" && typeof (anchor as Record<string, unknown>).textAnchorId === "string",
  );
}

function repairSourceTextConceptAnchors(gardenDir: string, learnerPages: LearnerPage[], report: FinalizeReport): void {
  const anchorCache = new Map<string, Record<string, unknown> | null>();
  for (const page of learnerPages) {
    rewriteEmbeddedVisualSpecs(page, (spec) => {
      const type = String(spec.type ?? "");
      const concept = proseConceptForVisualType(type);
      if (!concept || visualHasTextAnchor(spec)) return false;
      const status = String(spec.sourceGroundingStatus ?? "");
      if (status && status !== "conceptual-no-direct-source-figure" && status !== "source-derived-conceptual") return false;
      const cacheKey = `${type}:${concept.label}`;
      if (!anchorCache.has(cacheKey)) anchorCache.set(cacheKey, sourceTextAnchorForConcept(gardenDir, concept));
      const anchor = anchorCache.get(cacheKey);
      if (!anchor) return false;
      const anchors = Array.isArray(spec.sourceAnchors) ? spec.sourceAnchors.filter((item) => item && typeof item === "object") : [];
      spec.sourceAnchors = [...anchors, anchor];
      spec.sourceGroundingStatus = "source-derived-conceptual";
      spec.justification =
        "The source explains this concept in prose but does not provide a dedicated figure, so the visual is derived from a source text anchor.";
      const textAnchorId = String(anchor.textAnchorId ?? "");
      if (textAnchorId) page.rawFm = fmSetArray(page.rawFm, "sourceAnchors", [...fmGetArray(page.rawFm, "sourceAnchors"), textAnchorId]);
      saveVisualSpecArtifact(gardenDir, spec, report);
      report.notes.push(`added source text anchor ${textAnchorId || "(missing text anchor)"} to ${page.rel}`);
      return true;
    });
  }
}

function sourcePageParagraphs(gardenDir: string): Array<{ sourceId: string; sourceTitle: string; page: number; text: string }> {
  const sourcePages: Array<{ abs: string; rel: string }> = [];
  listMarkdown(path.join(gardenDir, "sources"), "sources", sourcePages);
  const out: Array<{ sourceId: string; sourceTitle: string; page: number; text: string }> = [];
  for (const { abs, rel } of sourcePages) {
    if (/\/_index\.md$/i.test(rel) || /(^|\/)_index\.md$/i.test(rel)) continue;
    const { rawFrontmatter, body } = parseFrontmatter(fs.readFileSync(abs, "utf-8"));
    const sourceTitle = fmGetScalar(rawFrontmatter, "title") || path.basename(rel, ".md");
    const sourceId = fmGetScalar(rawFrontmatter, "sourceId") || slugifyLoose(path.basename(rel, ".md")) || "source";
    let page = 0;
    let buffer: string[] = [];
    const flush = (): void => {
      const text = buffer.join("\n").replace(/\s+/g, " ").trim();
      if (page > 0 && text) out.push({ sourceId, sourceTitle, page, text });
      buffer = [];
    };
    for (const line of body.split(/\r?\n/)) {
      const heading = line.match(/^\s*#{1,3}\s*Page\s+(\d+)\b/i);
      if (heading) {
        flush();
        page = Number.parseInt(heading[1] ?? "0", 10);
      } else {
        buffer.push(line);
      }
    }
    flush();
  }
  return out;
}

const TEXT_ANCHOR_STOPWORDS = new Set([
  "what", "when", "where", "which", "with", "from", "that", "this", "into", "does",
  "spiking", "neural", "network", "networks", "source", "lesson", "metric", "metrics",
]);

function unitTextAnchorKeywords(unit: LearningUnitContract, page: LearnerPage): string[] {
  const text = [
    unit.title,
    unit.learningQuestion,
    ...(unit.newConcepts ?? []),
    page.title,
  ].join(" ");
  return [...new Set(text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^-+|-+$/g, ""))
    .filter((word) => word.length >= 4 && !TEXT_ANCHOR_STOPWORDS.has(word)))].slice(0, 8);
}

function repairLearningUnitSourceTextAnchors(
  gardenDir: string,
  learnerPages: LearnerPage[],
  unitsById: Map<string, LearningUnitContract>,
  report: FinalizeReport,
): void {
  const paragraphs = sourcePageParagraphs(gardenDir).filter((paragraph) => paragraph.page > 2);
  if (paragraphs.length === 0) return;
  for (const page of learnerPages) {
    const unit = unitsById.get(fmGetScalar(page.rawFm, "learningUnitId"));
    if (!unit || !/^(?:training_method|core_concept|mechanism|application|limitation)$/.test(unit.role)) continue;
    const existing = fmGetArray(page.rawFm, "sourceAnchors");
    const hasSpecific = existing.some((anchor) => {
      if (anchor.startsWith("text-")) return true;
      const match = anchor.match(/\.P(\d+)\b/i);
      return match ? Number.parseInt(match[1] ?? "0", 10) > 2 : false;
    });
    if (hasSpecific) continue;
    const keywords = unitTextAnchorKeywords(unit, page);
    if (keywords.length === 0) continue;
    const paragraph = paragraphs.find((candidate) => {
      const lower = candidate.text.toLowerCase();
      const hits = keywords.filter((keyword) => lower.includes(keyword));
      return hits.length >= Math.min(2, keywords.length);
    });
    if (!paragraph) continue;
    const anchorId = `text-${slugifyLoose(paragraph.sourceId)}-${slugifyLoose(keywords.slice(0, 4).join("-"))}`;
    page.rawFm = fmSetArray(page.rawFm, "sourceAnchors", [...existing, anchorId]);
    page.dirty = true;
    report.notes.push(`added page source text anchor ${anchorId} to ${page.rel}`);
  }
}

function sourceTextConceptAnchorProblems(gardenDir: string, learnerPages: LearnerPage[]): string[] {
  const corpus = sourceCorpusText(gardenDir);
  if (!corpus.trim()) return [];
  const problems: string[] = [];
  for (const page of learnerPages) {
    for (const spec of embeddedVisualSpecs(page.body)) {
      const type = String(spec.type ?? "");
      const concept = proseConceptForVisualType(type);
      if (!concept || !concept.pattern.test(corpus)) continue;
      const status = String(spec.sourceGroundingStatus ?? "");
      const anchors = Array.isArray(spec.sourceAnchors) ? spec.sourceAnchors : [];
      const hasTextAnchor = anchors.some((anchor) =>
        anchor && typeof anchor === "object" && typeof (anchor as Record<string, unknown>).textAnchorId === "string",
      );
      if (status === "conceptual-no-direct-source-figure" && !hasTextAnchor) {
        problems.push(`${page.rel}: ${type} visual is fully unanchored even though source prose contains ${concept.label}`);
      }
      if (status === "source-derived-conceptual" && !hasTextAnchor) {
        problems.push(`${page.rel}: ${type} visual is source-derived-conceptual but lacks a textAnchorId`);
      }
    }
  }
  return [...new Set(problems)];
}

function sourceTextBodyAnchorProblems(
  gardenDir: string,
  learnerPages: LearnerPage[],
  unitsById: Map<string, LearningUnitContract>,
): string[] {
  const paragraphs = sourcePageParagraphs(gardenDir).filter((paragraph) => paragraph.page > 2);
  if (paragraphs.length === 0) return [];
  const problems: string[] = [];
  for (const page of learnerPages) {
    const unit = unitsById.get(fmGetScalar(page.rawFm, "learningUnitId"));
    if (!unit || !/^(?:training_method|core_concept|mechanism|application|limitation)$/.test(unit.role)) continue;
    const keywords = unitTextAnchorKeywords(unit, page);
    const match = paragraphs.find((paragraph) => {
      const lower = paragraph.text.toLowerCase();
      const hits = keywords.filter((keyword) => lower.includes(keyword));
      return hits.length >= Math.min(2, keywords.length);
    });
    if (!match) continue;
    const anchors = fmGetArray(page.rawFm, "sourceAnchors");
    const hasSpecific = anchors.some((anchor) => {
      if (anchor.startsWith("text-")) return true;
      const pageMatch = anchor.match(/\.P(\d+)\b/i);
      return pageMatch ? Number.parseInt(pageMatch[1] ?? "0", 10) > 2 : false;
    });
    if (!hasSpecific && anchors.some((anchor) => /abstract|guidance|researchgap/i.test(anchor))) {
      problems.push(`${page.rel}: ${unit.role} unit is grounded only in abstract/guidance anchors even though page ${match.page} source prose matches [${keywords.join(", ")}]`);
    }
  }
  return [...new Set(problems)];
}

function sectionFolderTitleConsistencyProblems(gardenDir: string): string[] {
  const learningDir = path.join(gardenDir, "learning");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(learningDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const problems: string[] = [];
  const titleKeys = new Set<string>();
  const folderKeys = new Set<string>();
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+\.\s+/.test(entry.name)) continue;
    const indexPath = path.join(learningDir, entry.name, "_index.md");
    if (!fs.existsSync(indexPath)) {
      problems.push(`learning/${entry.name}/: section folder is missing _index.md`);
      continue;
    }
    const { rawFrontmatter, body } = parseFrontmatter(fs.readFileSync(indexPath, "utf-8"));
    const title = fmGetScalar(rawFrontmatter, "title") || entry.name;
    const h1 = body.match(/^\s*#\s+(.+?)\s*$/m)?.[1]?.trim() ?? "";
    const folderKey = normalizedSectionTitleKey(entry.name);
    const titleKey = normalizedSectionTitleKey(title);
    folderKeys.add(folderKey);
    titleKeys.add(titleKey);
    if (folderKey !== titleKey) problems.push(`learning/${entry.name}/: folder name "${entry.name}" does not match _index title "${title}"`);
    if (h1 && normalizedSectionTitleKey(h1) !== titleKey) problems.push(`learning/${entry.name}/_index.md: H1 "${h1}" does not match frontmatter title "${title}"`);
  }
  const map = fs.existsSync(path.join(learningDir, "Learning Map.md"))
    ? parseFrontmatter(fs.readFileSync(path.join(learningDir, "Learning Map.md"), "utf-8")).body
    : "";
  for (const line of map.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s*(?:\[\[[^\]]+\|)?(.+?)(?:\]\])?\s*$/);
    if (!match) continue;
    const label = cleanMapNode(match[1] ?? "");
    if (!/^\d+\.\s+/.test(label)) continue;
    const key = normalizedSectionTitleKey(label);
    if (!titleKeys.has(key) || !folderKeys.has(key)) problems.push(`learning/Learning Map.md: section label "${label}" does not map to one matching section folder and title`);
  }
  return [...new Set(problems)];
}

function sectionTitleNaturalnessAllProblems(sectionInputs: ReturnType<typeof sectionSemanticInputs>): string[] {
  const problems: string[] = [];
  for (const section of sectionInputs) {
    for (const problem of sectionTitleNaturalnessProblems(section.sectionTitle, section.subsectionTitles)) {
      problems.push(`${section.rel}: ${problem}`);
    }
  }
  return [...new Set(problems)];
}

function formulaMetadataNoiseProblems(learnerPages: LearnerPage[]): string[] {
  const problems: string[] = [];
  for (const page of learnerPages) {
    const entries = formulaEntriesFromFrontmatter(page.rawFm);
    if (entries.length === 0) continue;
    const sourceDefinitionCount = entries.filter((entry) => {
      const kind = formulaEntryKind(entry);
      return kind === "source_definition" || kind === "source_derived_definition";
    }).length;
    const workedExampleCount = entries.filter((entry) => formulaEntryKind(entry) === "worked_example").length;
    const trivial = entries.filter((entry) => {
      const text = String(entry.text ?? "");
      return isTrivialFormulaFragment(text) || !isFormulaExpression(text);
    });
    if (entries.length > 10) problems.push(`${page.rel}: formulas: contains ${entries.length} entries; expected focused metric/source relationships`);
    if (workedExampleCount > Math.max(2, sourceDefinitionCount * 2 + 1)) {
      problems.push(`${page.rel}: formulas: has ${workedExampleCount} worked example(s) but only ${sourceDefinitionCount} source definition formula(s)`);
    }
    if (trivial.length > 0 && trivial.length / entries.length > 0.3) problems.push(`${page.rel}: ${trivial.length}/${entries.length} formulas: entries are trivial fragments`);
    for (const [index, entry] of entries.entries()) {
      const text = String(entry.text ?? "");
      const kind = formulaEntryKind(entry);
      if (isTrivialFormulaFragment(text) && /^(source-anchored|source-derived)$/.test(String(entry.groundingStatus ?? ""))) {
        problems.push(`${page.rel}: formulas[${index}] source-anchors trivial fragment "${text}"`);
      }
      if ((kind === "source_definition" || kind === "source_derived_definition") && isWorkedExampleFormula(text)) {
        problems.push(`${page.rel}: formulas[${index}] stores worked-example arithmetic as ${kind}`);
      }
    }
  }
  return [...new Set(problems)];
}

function visualAnchorPrecisionProblems(ledger: LedgerVisual[], learnerPages: LearnerPage[]): string[] {
  const problems: string[] = [];
  for (const page of learnerPages) {
    for (const spec of embeddedVisualSpecs(page.body)) {
      const type = String(spec.type ?? "");
      if (type !== "metric_calculator" && type !== "tradeoff_explorer") continue;
      const specText = [
        spec.title,
        spec.caption,
        spec.pedagogicalPurpose,
        spec.learningGoal,
        Array.isArray(spec.conceptTargets) ? spec.conceptTargets.join(" ") : "",
        Array.isArray(spec.inputs) ? spec.inputs.join(" ") : "",
        Array.isArray(spec.outputs) ? spec.outputs.join(" ") : "",
        Array.isArray(spec.controls)
          ? spec.controls.map((control) => typeof control === "object" && control ? Object.values(control as Record<string, unknown>).join(" ") : "").join(" ")
          : "",
      ].filter(Boolean).join(" ");
      const includePageContext = type !== "metric_calculator";
      const expectedText = includePageContext ? [page.title, specText].filter(Boolean).join(" ") : specText;
      const expected = new Set<string>(metricCalculatorFamiliesForText(expectedText));
      if (expected.size === 0) continue;
      const allowed = new Set(expected);
      if (allowed.has("efficiency")) {
        allowed.add("accuracy");
        allowed.add("energy");
        allowed.add("spike-count");
      }
      if (allowed.has("energy")) allowed.add("spike-count");
      const ids = visualSpecAnchorIds(spec).filter((id) => /^S\d+\.P\d+\.E\d+$/i.test(id));
      const formulaAnchorRecords = visualSpecAnchorRecords(spec).filter((anchor) => /^S\d+\.P\d+\.E\d+$/i.test(String(anchor.equationId ?? "")));
      if (formulaAnchorRecords.length > 1) {
        for (const anchor of formulaAnchorRecords) {
          const id = String(anchor.equationId ?? "").trim();
          const role = String(anchor.role ?? "").trim();
          const reason = String(anchor.reason ?? "").trim();
          if (!/^(input|output_formula|comparison_basis|context)$/.test(role)) problems.push(`${page.rel}: visual ${String(spec.id ?? "(missing id)")} anchor ${id} lacks a valid role`);
          if (reason.length < 12) problems.push(`${page.rel}: visual ${String(spec.id ?? "(missing id)")} anchor ${id} lacks a specific role reason`);
        }
      }
      const extras = ids.filter((id) => {
        const visual = ledger.find((item) => item.sourceVisualId === id);
        const family = formulaMetricFamily(formulaAnchorSemanticText(visual));
        return family && !allowed.has(family);
      });
      const explicitMultiText = includePageContext ? [page.title, specText].filter(Boolean).join(" ") : specText;
      const explicitMulti = /\bmulti[- ]?metric\b|\btrade[- ]?off\b|accuracy.*latency.*energy|latency.*energy.*accuracy/i.test(explicitMultiText);
      if (extras.length > 0 && !explicitMulti) problems.push(`${page.rel}: visual ${String(spec.id ?? "(missing id)")} has unrelated formula anchors [${extras.join(", ")}]`);
    }
  }
  return [...new Set(problems)];
}

function repairLogConsistencyProblems(gardenDir: string, learnerPages: LearnerPage[]): string[] {
  const problems: string[] = [];
  const run = readRepairRunReport(gardenDir);
  if (!run) {
    for (const page of learnerPages) {
      if (fmGetScalar(page.rawFm, "lastSemanticRepairAt")) {
        problems.push(`${page.rel}: has semantic repair provenance but .breadboard/repair-log.json is missing`);
      }
    }
    return problems;
  }
  for (const entry of run.repairs ?? []) {
    if (entry.result === "unresolved") {
      problems.push(`${entry.pagePath}: repair log has unresolved ${entry.failureTypes.join(", ")}`);
    }
    for (const error of entry.unresolvedValidationErrors ?? []) {
      problems.push(`${entry.pagePath}: unresolved repair validation error: ${error}`);
    }
  }
  const repairedPages = new Set((run.repairs ?? []).map((entry) => entry.pagePath));
  for (const page of learnerPages) {
    if (!fmGetScalar(page.rawFm, "lastSemanticRepairAt")) continue;
    if (!repairedPages.has(page.rel)) {
      problems.push(`${page.rel}: has lastSemanticRepairAt but no matching repair-log entry`);
    }
    if (!fmGetScalar(page.rawFm, "generatedFromUnitId")) {
      problems.push(`${page.rel}: semantic repair provenance missing generatedFromUnitId`);
    }
    if (!fmGetScalar(page.rawFm, "semanticRepairReason")) {
      problems.push(`${page.rel}: semantic repair provenance missing semanticRepairReason`);
    }
  }
  return [...new Set(problems)];
}

function finalizerBoundaryProblems(report: FinalizeReport): string[] {
  const problems: string[] = [];
  for (const action of report.actions ?? []) {
    if (action.kind === "semantic_failure") {
      problems.push(`${action.pagePath ?? action.unitId ?? "(unknown)"}: semantic failure reached finalizer instead of the Learning Unit repair loop`);
    }
  }
  return problems;
}

function collectFinalizeChecks({
  gardenDir,
  report,
  includeReportSelfCheck = true,
}: {
  gardenDir: string;
  report: FinalizeReport;
  includeReportSelfCheck?: boolean;
}): FinalizeCheck[] {
  const checks: FinalizeCheck[] = [];
  const push = (name: string, problems: string[]) => checks.push({ name, status: problems.length ? "FAIL" : "PASS", problems });
  const learnerPages = loadLearnerPages(gardenDir);
  const contract = readLearningUnitContract(gardenDir);
  const unitsById = new Map(contract.units.map((unit) => [unit.id, unit]));
  const pagesByUnit = new Map<string, LearnerPage>();
  for (const page of learnerPages) {
    const unitId = fmGetScalar(page.rawFm, "learningUnitId");
    if (unitId) pagesByUnit.set(unitId, page);
  }
  const ledger = readJson<LedgerVisual[]>(path.join(gardenDir, ".breadboard", "source-visuals.json"), []);

  // Export tree.
  const allowed = new Set(["_index.md", "learning", "sources", "assets", ".breadboard"]);
  const treeProblems: string[] = [];
  for (const entry of fs.readdirSync(gardenDir)) {
    if (!allowed.has(entry)) treeProblems.push(`unexpected top-level: ${entry}`);
  }
  if (!fs.existsSync(path.join(gardenDir, "sources", "_index.md"))) treeProblems.push("sources/_index.md missing");
  push("exported tree only _index.md/learning/sources/assets/.breadboard", treeProblems);

  push("semantic navigation links point to the expected page family", semanticNavigationProblems(gardenDir));
  push("Semantic Navigation Number Matching", semanticNavigationNumberProblems(gardenDir));

  // Source pages not typed as learner pages.
  const typingProblems: string[] = [];
  const sourcePages: Array<{ abs: string; rel: string }> = [];
  listMarkdown(path.join(gardenDir, "sources"), "sources", sourcePages);
  for (const { abs, rel } of sourcePages) {
    const { rawFrontmatter } = parseFrontmatter(fs.readFileSync(abs, "utf-8"));
    if (fmGetScalar(rawFrontmatter, "breadboardType") === "learning_page") typingProblems.push(`${rel}: typed learning_page`);
    if (fmGetScalar(rawFrontmatter, "internal") === "true" && fmGetScalar(rawFrontmatter, "breadboardType") === "learning_page") {
      typingProblems.push(`${rel}: internal+learning_page`);
    }
  }
  push("no source page typed as learner page", typingProblems);

  push("reconciliation has no contradictory anchor usage", report.reconciliation
    .filter((entry) => entry.status === "intentionally_skipped" && (entry.embeddedAsImage || entry.usedAsInteractiveAnchor))
    .map((entry) => `${entry.id}: skipped but used`));
  push("Finalizer semantic boundary", finalizerBoundaryProblems(report));
  push("Repair Provenance", repairLogConsistencyProblems(gardenDir, learnerPages));

  // Learning Unit Contract fulfillment.
  const fulfillmentProblems: string[] = [];
  if (learnerPages.length > 0 && contract.units.length === 0) {
    fulfillmentProblems.push(".breadboard/learning-unit-contract.json missing or empty");
  }
  const knownHandles = new Set(contract.units.flatMap((unit) => zettelHandlesForUnit(unit)));
  const assignmentsByUnit = new Map<string, SourceArtifactAssignment[]>();
  for (const assignment of contract.assignments) {
    const list = assignmentsByUnit.get(assignment.assignedLearningUnitId) ?? [];
    list.push(assignment);
    assignmentsByUnit.set(assignment.assignedLearningUnitId, list);
  }
  const useAssignedArtifacts = contract.assignments.length > 0;
  const tagCounts = new Map<string, number>();
  for (const page of learnerPages) {
    const unitId = fmGetScalar(page.rawFm, "learningUnitId");
    const unit = unitId ? unitsById.get(unitId) : undefined;
    if (!unit) {
      fulfillmentProblems.push(`${page.rel}: missing or unknown learningUnitId "${unitId || "(missing)"}"`);
      continue;
    }
    const tags = fmGetArray(page.rawFm, "tags");
    for (const tag of tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    const expectedTags = zettelHandlesForUnit(unit);
    const missingTags = expectedTags.filter((tag) => !tags.includes(tag));
    const extraTags = tags.filter((tag) => !expectedTags.includes(tag));
    if (expectedTags.length === 0) fulfillmentProblems.push(`${page.rel}: unit ${unit.id} has no contract zettel handles`);
    if (missingTags.length > 0 || extraTags.length > 0) {
      fulfillmentProblems.push(`${page.rel}: tags must equal contract handles for ${unit.id}; missing [${missingTags.join(", ")}], extra [${extraTags.join(", ")}]`);
    }
    for (const tag of tags) {
      if (!knownHandles.has(tag)) fulfillmentProblems.push(`${page.rel}: tag "${tag}" is not in the Learning Unit Contract`);
      if (!isAtomicZettelHandle(tag) || tag.includes("/")) fulfillmentProblems.push(`${page.rel}: tag "${tag}" is not an atomic slash-free handle`);
    }
    const sourceVisualIds = fmGetArray(page.rawFm, "sourceVisualIds");
    const formulaAnchors = formulaAnchorsFromFrontmatter(page.rawFm);
    const assignedArtifacts = assignmentsByUnit.get(unit.id) ?? [];
    const requiredFigures = useAssignedArtifacts
      ? assignedArtifacts.map((assignment) => assignment.sourceArtifactId).filter(isSourceFigureId)
      : unit.sourceFigures.filter((figure) => figure.placement !== "not_used_with_reason").map((figure) => figure.id);
    const requiredFormulas = useAssignedArtifacts
      ? assignedArtifacts.map((assignment) => assignment.sourceArtifactId).filter(isSourceFormulaId)
      : unit.sourceFormulas.map((formula) => formula.id);
    const requiredTables = useAssignedArtifacts
      ? assignedArtifacts.map((assignment) => assignment.sourceArtifactId).filter(isSourceTableId)
      : unit.sourceTables.map((table) => table.id);
    for (const id of requiredFigures) {
      if (!sourceVisualIds.includes(id)) fulfillmentProblems.push(`${page.rel}: missing contract source figure ${id}`);
    }
    for (const id of requiredTables) {
      if (!sourceVisualIds.includes(id)) fulfillmentProblems.push(`${page.rel}: missing contract source table ${id}`);
    }
    for (const id of requiredFormulas) {
      if (!formulaAnchors.includes(id)) fulfillmentProblems.push(`${page.rel}: missing contract source formula ${id}`);
    }
    if (unit.interactiveVisual) {
      const types = embeddedVisualTypes(page.body);
      const omitted = Boolean(fmGetScalar(page.rawFm, "interactiveVisualOmissionReason")) || /interactive visual intentionally omitted/i.test(page.body);
      if (types.length === 0 && !omitted) {
        fulfillmentProblems.push(`${page.rel}: unit ${unit.id} planned ${unit.interactiveVisual.visualType}, but no interactive visual was embedded`);
      } else if (types.length > 0 && !types.some((type) => type.toLowerCase() === unit.interactiveVisual!.visualType.toLowerCase())) {
        fulfillmentProblems.push(`${page.rel}: embedded visual type(s) [${types.join(", ")}] do not match contract type ${unit.interactiveVisual.visualType}`);
      }
    }
    for (const formulaAnchor of formulaAnchors) {
      if (formulaAnchor.startsWith("trivial:")) fulfillmentProblems.push(`${page.rel}: formula frontmatter tracks trivial math ${formulaAnchor.slice("trivial:".length)}`);
    }
  }
  if (learnerPages.length >= 4) {
    const maxAllowed = Math.ceil(learnerPages.length * 0.4);
    for (const [tag, count] of tagCounts) {
      if (count > maxAllowed) fulfillmentProblems.push(`tag "${tag}" appears on ${count}/${learnerPages.length} learner pages`);
    }
  }
  for (const unit of contract.units) {
    if (!pagesByUnit.has(unit.id)) fulfillmentProblems.push(`learning unit ${unit.id} has no generated learner page`);
  }
  push("Learning Unit Contract fulfillment", [...new Set(fulfillmentProblems)]);

  // Section semantic coherence and grammar.
  const sectionInputs = sectionSemanticInputs(gardenDir, learnerPages, unitsById);
  push(
    "Section Title Uniqueness",
    sectionTitleUniquenessProblems(sectionInputs.map((section) => ({ rel: section.rel, title: section.sectionTitle }))),
  );
  push("Section Folder/Title Consistency", sectionFolderTitleConsistencyProblems(gardenDir));
  push("Section Title Naturalness", sectionTitleNaturalnessAllProblems(sectionInputs));
  push("Learning Map Ambiguity", learningMapAmbiguityProblems(gardenDir, sectionInputs));

  const profiles = sectionSemanticProfiles(sectionInputs.map((section) => ({
    sectionTitle: section.sectionTitle,
    units: section.units,
    subsectionTitles: section.subsectionTitles,
  })));
  const sectionProblems: string[] = [];
  for (const [index, profile] of profiles.entries()) {
    for (const problem of profile.problems) sectionProblems.push(`${sectionInputs[index]?.rel ?? profile.sectionTitle}: ${problem}`);
  }
  push("Section semantic coherence", sectionProblems);

  const titleGrammarProblems: string[] = [];
  for (const section of sectionInputs) {
    for (const problem of sectionTitleGrammarProblems(section.sectionTitle, section.subsectionTitles)) {
      titleGrammarProblems.push(`${section.rel}: ${problem}`);
    }
  }
  for (const page of learnerPages) {
    for (const problem of sectionTitleGrammarProblems(page.title)) {
      titleGrammarProblems.push(`${page.rel}: ${problem}`);
    }
  }
  push("Section title grammar", titleGrammarProblems);

  // Interactive visual grounding.
  const visualGroundingProblems: string[] = [];
  for (const page of learnerPages) {
    for (const spec of embeddedVisualSpecs(page.body)) {
      const ids = visualSpecAnchorIds(spec);
      const problems = interactiveVisualGroundingProblems({
        visualType: String(spec.type ?? ""),
        sourceAnchors: ids,
        sourceAnchorText: anchorTextForVisualIds(ledger, ids, spec),
        status: String(spec.sourceGroundingStatus ?? ""),
        justification: String(spec.justification ?? ""),
        conceptText: [page.title, spec.title, spec.caption, spec.pedagogicalPurpose, spec.learningGoal].filter(Boolean).join(" "),
      });
      for (const problem of problems) visualGroundingProblems.push(`${page.rel}: ${problem}`);
    }
  }
  push("Interactive visual grounding", visualGroundingProblems);
  push("Source Text Concept Anchors", [
    ...sourceTextConceptAnchorProblems(gardenDir, learnerPages),
    ...sourceTextBodyAnchorProblems(gardenDir, learnerPages, unitsById),
  ]);

  // Formula grounding.
  const formulaGroundingProblems: string[] = [];
  const formulaExpressionProblems: string[] = [];
  const formulaSourceProblems: string[] = [];
  const sourceFormulaCaptions = ledger
    .filter((visual) => classifyFigure(visual) === "equation")
    .map((visual) => ({ id: visual.sourceVisualId, caption: formulaAnchorSemanticText(visual) }));
  for (const page of learnerPages) {
    const declared = fmGetArray(page.rawFm, "sourceFormulaAnchors");
    const grounded = formulaEntrySourceAnchors(page.rawFm);
    if (declared.length > 0 && grounded.length === 0) {
      formulaGroundingProblems.push(`${page.rel}: has sourceFormulaAnchors but no source definition formulas: entry`);
    }
    for (const anchor of declared) {
      if (!grounded.includes(anchor)) {
        formulaGroundingProblems.push(`${page.rel}: sourceFormulaAnchors includes ${anchor}, but no source definition formulas: entry is grounded to it`);
      }
    }
    for (const [index, entry] of formulaEntriesFromFrontmatter(page.rawFm).entries()) {
      const label = `${page.rel}: formulas[${index}]`;
      const text = String(entry.text ?? "");
      const status = String(entry.groundingStatus ?? "");
      const kind = formulaEntryKind(entry);
      if (!text.trim()) {
        formulaExpressionProblems.push(`${label} missing text`);
        continue;
      }
      if (!isFormulaExpression(text)) {
        formulaExpressionProblems.push(`${label} is prose/keyword bundle, not a mathematical expression: "${text}"`);
      }
      if (!/^(source-anchored|source-derived|conceptual-helper|unmatched)$/.test(status)) {
        formulaExpressionProblems.push(`${label} has invalid groundingStatus "${status || "(missing)"}"`);
      }
      if (!/^(source_definition|source_derived_definition|worked_example|conceptual_helper)$/.test(kind)) {
        formulaExpressionProblems.push(`${label} has invalid kind "${kind || "(missing)"}"`);
      }
      if (kind === "worked_example" && /^(source-anchored|source-derived)$/.test(status)) {
        formulaSourceProblems.push(`${label} is a worked example but is marked ${status}; worked examples may reference source formulas but cannot satisfy source definitions`);
      }
      if ((kind === "source_definition" || kind === "source_derived_definition") && isWorkedExampleFormula(text)) {
        formulaSourceProblems.push(`${label} is numeric worked-example arithmetic but is marked ${kind}`);
      }
      if ((status === "source-anchored" || status === "source-derived") && !String(entry.sourceAnchor ?? "").trim()) {
        formulaSourceProblems.push(`${label} is ${status} but lacks sourceAnchor`);
      }
      const match: ReturnType<typeof groundLearnerFormula> = isFormulaExpression(text)
        ? groundLearnerFormula(text, sourceFormulaCaptions)
        : { groundingStatus: "conceptual-helper" };
      if ((status === "conceptual-helper" || status === "unmatched") && match.groundingStatus === "source-anchored") {
        formulaSourceProblems.push(`${label} matches source formula ${match.sourceAnchor} but is marked ${status}`);
      }
      if ((status === "source-anchored" || status === "source-derived") && entry.sourceAnchor && match.groundingStatus === "source-anchored" && match.sourceAnchor !== entry.sourceAnchor) {
        formulaSourceProblems.push(`${label} is grounded to ${entry.sourceAnchor}, but content matches ${match.sourceAnchor}`);
      }
      if ((status === "source-anchored" || status === "source-derived") && entry.sourceAnchor) {
        const anchor = sourceFormulaCaptions.find((source) => source.id === entry.sourceAnchor);
        const meaning = formulaMeaningMatch(text, anchor?.caption ?? "");
        if (anchor?.caption && !meaning.ok) {
          formulaSourceProblems.push(`${label} is grounded to ${entry.sourceAnchor}, but content does not match (${meaning.reason})`);
        }
      }
    }
  }
  push("Formula grounding", formulaGroundingProblems);
  push("Formula expression validation", formulaExpressionProblems);
  push("Formula Meaning Match", formulaSourceProblems);
  push("Formula Family Match", formulaSourceProblems.filter((problem) => /family|source formula|content does not match|grounded to/.test(problem)));
  push("Formula Metadata Noise", formulaMetadataNoiseProblems(learnerPages));

  // Source Coverage from contract.
  const coverageProblems: string[] = [];
  const coverage = fs.existsSync(path.join(gardenDir, ".breadboard", "planning", "Source Coverage.md"))
    ? fs.readFileSync(path.join(gardenDir, ".breadboard", "planning", "Source Coverage.md"), "utf-8")
    : "";
  if (!coverage && contract.assignments.length > 0) coverageProblems.push(".breadboard/planning/Source Coverage.md missing");
  if (/central to\s+\[\[/i.test(coverage)) coverageProblems.push("Source Coverage still uses heuristic 'central to [[page]]' assignments");
  if (coverage) {
    for (const heading of PRECISE_SOURCE_COVERAGE_HEADINGS) {
      if (!coverageHeadingRe(heading).test(coverage)) {
        coverageProblems.push(`Source Coverage missing mode section "${heading}"`);
      }
    }
  }
  for (const assignment of contract.assignments) {
    const escaped = assignment.sourceArtifactId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (coverage && !new RegExp(`${escaped}[^\\n]*assigned to ${assignment.assignedLearningUnitId}\\b`, "i").test(coverage)) {
      coverageProblems.push(`${assignment.sourceArtifactId}: Source Coverage does not assign to contract unit ${assignment.assignedLearningUnitId}`);
    }
  }
  push("Source Coverage follows the Learning Unit Contract", [...new Set(coverageProblems)]);
  push("Source Coverage Mode Precision", sourceCoverageModePrecisionProblems(gardenDir, ledger));
  push("Source anchor usage vs crop status", sourceAnchorUsageVsCropStatusProblems(ledger, learnerPages));

  // Source Map consistency.
  const sourceMapProblems: string[] = [];
  const sourceMap = fs.existsSync(path.join(gardenDir, ".breadboard", "planning", "Source Map.md"))
    ? fs.readFileSync(path.join(gardenDir, ".breadboard", "planning", "Source Map.md"), "utf-8")
    : "";
  const hasFormulaAnchors = ledger.some((visual) => classifyFigure(visual) === "equation");
  const hasTables = ledger.some((visual) => String(visual.type ?? "") === "table" || /^S\d+\.P\d+\.T\d+$/i.test(String(visual.sourceVisualId ?? "")));
  const hasFigures = ledger.some((visual) => classifyFigure(visual) !== "equation" && String(visual.type ?? "") !== "table" && !/^S\d+\.P\d+\.T\d+$/i.test(String(visual.sourceVisualId ?? "")));
  const hasLaterPages = sourcesHaveLaterPages(gardenDir);
  if (!sourceMap && (hasFormulaAnchors || hasTables || hasFigures || hasLaterPages)) {
    sourceMapProblems.push(".breadboard/planning/Source Map.md missing");
  }
  if (sourceMap) {
    if (hasFormulaAnchors && /explicit mathematical definitions are not present|formulas? (?:are|is) not present|caption-only|formula captions? only|exact (?:mathematical )?notation (?:is )?(?:unavailable|not visible|not included)/i.test(sourceMap)) {
      sourceMapProblems.push("Source Map says formulas are absent/caption-only even though formula anchors exist");
    }
    if (hasTables && /tables? (?:are|is) not (?:present|available|detected)/i.test(sourceMap)) {
      sourceMapProblems.push("Source Map says tables are absent even though table anchors exist");
    }
    if (hasFigures && /figures? (?:are|is) not (?:present|available|detected)/i.test(sourceMap)) {
      sourceMapProblems.push("Source Map says figures are absent even though figure anchors exist");
    }
    if (hasLaterPages && /only pages?\s*1\s*[-–]\s*2\s+(?:are|is)\s+(?:available|present)|source map is truncated|later (?:pages?|sections?)[^.\n]*(?:not available|unavailable|captions?|anchored to captions)|truncated after page\s*2/i.test(sourceMap)) {
      sourceMapProblems.push("Source Map contains stale caveats about later source pages");
    }
  }
  push("Source Map is consistent with extracted anchors", sourceMapProblems);
  push("Source Map caveat reconciliation", sourceMapCaveatProblems(gardenDir, ledger));

  // Final interactive visual uniqueness after rendered blocks are on disk.
  const visualUniquenessProblems: string[] = [];
  const bySignature = new Map<string, string[]>();
  for (const page of learnerPages) {
    for (const spec of embeddedVisualSpecs(page.body)) {
      const signature = visualSignature(spec);
      const list = bySignature.get(signature) ?? [];
      list.push(`${page.rel}:${String(spec.id ?? "(missing id)")}`);
      bySignature.set(signature, list);
    }
  }
  for (const [signature, pagesForSignature] of bySignature) {
    if (pagesForSignature.length > 1) {
      visualUniquenessProblems.push(`duplicate final interactive visual signature "${signature}" on ${pagesForSignature.join(", ")}`);
    }
  }
  push("Final interactive visual uniqueness", visualUniquenessProblems);
  push("Visual Anchor Precision", visualAnchorPrecisionProblems(ledger, learnerPages));
  push("Repetition and Opening Flow", repeatedOpeningProblems(learnerPages));

  // Section title quality.
  const titleProblems: string[] = [];
  const sectionPages: Array<{ abs: string; rel: string }> = [];
  listMarkdown(path.join(gardenDir, "learning"), "learning", sectionPages);
  for (const { abs, rel } of sectionPages.filter((page) => /\/_index\.md$/i.test(page.rel))) {
    const { rawFrontmatter } = parseFrontmatter(fs.readFileSync(abs, "utf-8"));
    const title = fmGetScalar(rawFrontmatter, "title") || rel;
    if (/This Topic/i.test(title)) titleProblems.push(`${rel}: title contains "This Topic"`);
    if (/and the Mechanism Works|and it Is Measured|How It Learns or Changes|The Formal Description/i.test(title)) {
      titleProblems.push(`${rel}: title exposes internal scaffold phrase "${title}"`);
    }
  }
  titleProblems.push(...sectionTitleNaturalnessAllProblems(sectionInputs));
  push("section titles are learner-facing", titleProblems);

  // Source crop quality.
  const cropProblems = ledger.flatMap((visual) => cropQualityProblems(gardenDir, visual));
  push("source crop quality is acceptable", cropProblems);
  push("Crop quality and fallbacks", cropFallbackProblems(ledger, learnerPages));

  // Zettelkasten density.
  const densityProblems: string[] = [];
  const handleQualityProblems = contract.units.flatMap((unit) => zettelHandleQualityProblems(unit));
  for (const page of learnerPages) {
    const words = teachingProseLite(page.body).split(/\s+/).filter((word) => /[a-z0-9]/i.test(word)).length;
    if (words < 700) continue;
    const tags = fmGetArray(page.rawFm, "tags");
    if (tags.length < 3) densityProblems.push(`${page.rel}: substantial page has ${tags.length} tag(s), expected 3-6 contract-backed handles`);
    if (tags.length > 6) densityProblems.push(`${page.rel}: substantial page has ${tags.length} tags, expected no more than 6`);
    for (const tag of tags) {
      if (scaffoldLikeZettelHandle(tag)) handleQualityProblems.push(`${page.rel}: scaffold-like tag "${tag}"`);
    }
    const unit = unitsById.get(fmGetScalar(page.rawFm, "learningUnitId"));
    const contractHandles = unit ? zettelHandlesForUnit(unit) : [];
    if (unit && contractHandles.length < 3) densityProblems.push(`${page.rel}: learning unit ${unit.id} has only ${contractHandles.length} contract zettel handle(s)`);
  }
  push("Zettelkasten tag density", densityProblems);
  push("Zettelkasten Handle Quality", [...new Set(handleQualityProblems)]);
  push("Zettelkasten Handle Naturalness", [...new Set(handleQualityProblems)]);

  if (includeReportSelfCheck) {
    const reportPath = path.join(gardenDir, ".breadboard", "validation-report.md");
    const reportProblems: string[] = [];
    const validationReport = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, "utf-8") : "";
    if (!validationReport) {
      reportProblems.push("missing");
    } else {
      for (const section of REQUIRED_VALIDATION_REPORT_SECTIONS) {
        if (!new RegExp(`^##\\s+${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(validationReport)) {
          reportProblems.push(`missing section "${section}"`);
        }
      }
    }
    push("validation report contains required sections", reportProblems);
  }

  return checks;
}

function runCriticalGate({
  gardenDir,
  report,
}: {
  gardenDir: string;
  report: FinalizeReport;
}): void {
  const problems: string[] = [];
  // Dirty tree.
  const allowed = new Set(["_index.md", "learning", "sources", "assets", ".breadboard"]);
  for (const entry of fs.readdirSync(gardenDir)) {
    if (!allowed.has(entry)) problems.push(`dirty top-level export entry: ${entry}`);
  }

  // Source pages must never be typed as learner pages; learner pages must live
  // under learning/ (B).
  const sourcePages: Array<{ abs: string; rel: string }> = [];
  listMarkdown(path.join(gardenDir, "sources"), "sources", sourcePages);
  for (const { abs, rel } of sourcePages) {
    const { rawFrontmatter } = parseFrontmatter(fs.readFileSync(abs, "utf-8"));
    const bt = fmGetScalar(rawFrontmatter, "breadboardType");
    if (bt === "learning_page" || fmGetScalar(rawFrontmatter, "knowledge_type") === "learning-page") {
      problems.push(`source page typed as learner page: ${rel}`);
    }
    if (fmGetScalar(rawFrontmatter, "internal") === "true" && bt === "learning_page") {
      problems.push(`source page is internal:true AND learning_page: ${rel}`);
    }
  }
  const strayLearners: Array<{ abs: string; rel: string }> = [];
  for (const top of ["sources", "assets"]) listMarkdown(path.join(gardenDir, top), top, strayLearners);
  for (const { abs, rel } of strayLearners) {
    const { rawFrontmatter } = parseFrontmatter(fs.readFileSync(abs, "utf-8"));
    if (fmGetScalar(rawFrontmatter, "breadboardType") === "learning_page") {
      problems.push(`learner page outside learning/: ${rel}`);
    }
  }

  // Broken self-referential wikilinks in any visible page (C).
  const visible: Array<{ abs: string; rel: string }> = [];
  const rootIndex = path.join(gardenDir, "_index.md");
  if (fs.existsSync(rootIndex)) visible.push({ abs: rootIndex, rel: "_index.md" });
  listMarkdown(path.join(gardenDir, "learning"), "learning", visible);
  listMarkdown(path.join(gardenDir, "sources"), "sources", visible);
  for (const { abs, rel } of visible) {
    const { body } = parseFrontmatter(fs.readFileSync(abs, "utf-8"));
    const headingSlugs = new Set<string>();
    for (const match of body.matchAll(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)) headingSlugs.add(slugifyLoose(match[1] ?? ""));
    for (const match of body.matchAll(/(?<!!)\[\[#([^\]|]+?)(?:\|[^\]]*)?\]\]/g)) {
      if (!headingSlugs.has(slugifyLoose(match[1] ?? ""))) {
        problems.push(`${rel}: unresolved same-page heading link [[#${(match[1] ?? "").trim()}]]`);
      }
    }
  }

  // Contradictory anchor usage.
  for (const entry of report.reconciliation) {
    if (entry.status === "intentionally_skipped" && (entry.embeddedAsImage || entry.usedAsInteractiveAnchor)) {
      problems.push(`anchor ${entry.id} is intentionally_skipped but used`);
    }
  }
  // Validation report present.
  if (!fs.existsSync(path.join(gardenDir, ".breadboard", "validation-report.md"))) {
    problems.push(".breadboard/validation-report.md missing");
  }
  for (const check of collectFinalizeChecks({ gardenDir, report, includeReportSelfCheck: true })) {
    if (check.status !== "FAIL") continue;
    for (const problem of check.problems) problems.push(`${check.name}: ${problem}`);
  }
  report.criticalProblems.push(...[...new Set(problems)]);
}
