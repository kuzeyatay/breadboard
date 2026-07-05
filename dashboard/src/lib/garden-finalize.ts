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
import path from "node:path";
import {
  dedupeSourceArtifactAssignments,
  isAtomicZettelHandle,
  normalizeLearningUnits,
  zettelHandlesForUnit,
  type LearningUnitContract,
  type SourceArtifactAssignment,
  type SourceFigurePlacement,
} from "./learning-unit-contract.ts";
import { isGroundableFormula } from "./learn-utils.ts";

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
  text: string;
  groundingStatus: "source-anchored" | "conceptual-helper";
  justification: string;
  sourceAnchor?: string;
}

/** Serialize a per-formula grounding block matching yamlFrontmatter()'s shape so
 * the validator's formulaEntriesFromFrontmatter() reads it back cleanly. */
function serializeFormulas(entries: FinalizeFormulaEntry[]): string {
  const lines: string[] = ["formulas:"];
  for (const entry of entries) {
    lines.push(`  - text: ${jsonScalar(entry.text)}`);
    lines.push(`    groundingStatus: ${jsonScalar(entry.groundingStatus)}`);
    lines.push(`    justification: ${jsonScalar(entry.justification)}`);
    if (entry.sourceAnchor) lines.push(`    sourceAnchor: ${jsonScalar(entry.sourceAnchor)}`);
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

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface FinalizeReport {
  changed: string[];
  removed: string[];
  notes: string[];
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
  const pagesByRole = groupByRole(learnerPages);

  // --- Pass C: source wikilink normalization ---------------------------------
  normalizeSourceWikilinks(gardenDir, report);

  // --- Pass D: stale caveat sanitation (visible + planning) ------------------
  sanitizeStaleCaveatFiles(gardenDir, { laterPagesExist, formulaAnchorsExist }, report);

  // Semantic decisions are made by the Learning Unit Contract before page
  // writing. The finalizer no longer assigns source figures, chooses
  // interactive visual types, rewrites learner tags, regrounds formulas, or
  // repairs repeated motivation after the fact. Those cases are validation
  // failures, not hidden finalizer patches.

  // --- Persist learner-page edits --------------------------------------------
  for (const page of learnerPages) {
    if (page.dirty) {
      fs.writeFileSync(page.abs, joinFrontmatter(page.rawFm, page.body), "utf-8");
      if (!report.changed.includes(page.rel)) report.changed.push(page.rel);
    }
  }

  // --- Pass K: validation report + critical gate -----------------------------
  writeFinalizeValidationReport({ gardenDir, gardenSlug, report });
  runCriticalGate({ gardenDir, ledgerPath, report });

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

function groupByRole(pages: LearnerPage[]): Map<PageRole, LearnerPage> {
  const byRole = new Map<PageRole, LearnerPage>();
  for (const page of pages) {
    if (!byRole.has(page.role)) byRole.set(page.role, page);
  }
  return byRole;
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
    const staleFormula = facts.formulaAnchorsExist && /(?:formal|explicit) mathematical definitions are not present|formulas? (?:are|is) not present|governing equations.*not (?:present|included)|does not include its governing equations|remain qualitative unless more verified/i.test(line);
    const staleTruncation = facts.laterPagesExist && /truncated after page\s*2|later-paper details must not be inferred|later sections? (?:are|is)? ?(?:not available|unavailable)|not available in full (?:text|prose)/i.test(line);
    if ((staleFormula || staleTruncation) && isBullet) {
      continue; // drop the whole stale bullet
    }
    let out = line;
    if (facts.formulaAnchorsExist) {
      out = out
        .replace(/(?:formal|explicit) mathematical definitions are not present[^.\n]*/gi, "explicit metric formulas are present in the extracted source anchors")
        .replace(/formulas? (?:are|is) not present/gi, "formula anchors are present")
        .replace(/the (?:supplied|provided) (?:material|source|text) does not include its governing equations/gi, "the extracted source anchors include the governing metric formulas");
    }
    if (facts.laterPagesExist) {
      out = out
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
    return pool;
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
        spec.sourceGroundingStatus = "source-anchored";
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
  const normalized = normalizeFormulaText(formulaText);
  const hasPercent = /%|\\%/.test(formulaText);
  const isFraction = /\\frac|\//.test(formulaText);
  // Accuracy: a fraction that resolves to a percentage / "correct over total".
  if (hasPercent && isFraction) {
    const accuracy = sources.find((source) => source.keywords.includes("accuracy"));
    if (accuracy) return accuracy;
  }
  // Otherwise require lexical overlap between the formula text and a source
  // formula's metric keywords (e.g. "energy", "accuracy").
  let best: { source: SourceFormula; score: number } | null = null;
  for (const source of sources) {
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
      caption: String(visual.caption ?? ""),
      keywords: sourceFormulaKeywords(String(visual.caption ?? "")),
    }));

  for (const page of learnerPages) {
    const formulas = extractBodyFormulas(page.body);
    if (formulas.length === 0) {
      // No math -> no formulas block; also drop any dangling metric anchors.
      const hadBlock = /^formulas:/m.test(page.rawFm);
      page.rawFm = fmSetFormulas(page.rawFm, []);
      if (hadBlock) page.dirty = true;
      continue;
    }
    const entries: FinalizeFormulaEntry[] = [];
    const anchoredIds = new Set<string>();
    for (const text of formulas) {
      const match = page.role === "metric" || page.role === "comparison" ? matchFormulaToSource(text, sources) : null;
      if (match) {
        entries.push({
          text,
          groundingStatus: "source-anchored",
          justification: `Content matches source metric formula ${match.id} (${match.caption}).`,
          sourceAnchor: match.id,
        });
        anchoredIds.add(match.id);
      } else {
        entries.push({
          text,
          groundingStatus: "conceptual-helper",
          justification:
            "Introduced as a compact helper to explain the mechanism on this page; not claimed as a verbatim source formula.",
        });
      }
    }
    page.rawFm = fmSetFormulas(page.rawFm, entries);
    // Keep sourceFormulaAnchors honest: the metric page lists the taught metric
    // anchors; other pages keep only anchors they actually reference.
    if (page.role === "metric") {
      const allEquationIds = sources.map((source) => source.id);
      page.rawFm = fmSetArray(page.rawFm, "sourceFormulaAnchors", allEquationIds);
    }
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
  { appliesTo: /surrogate/i, evidence: /surrogate gradient/i, minBody: 1 },
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

const ROLE_TRANSITION: Partial<Record<PageRole, string>> = {
  lif: "Event-driven sparsity explains why spiking networks can be efficient. The next question is mechanical: what does a single spiking neuron actually do to turn incoming current into a spike? Consider the membrane of one neuron as it integrates input, leaks charge, and fires when it crosses a threshold.",
  training: "Now that event-driven sparsity is established, efficiency only pays off if the network can be trained to fire useful spikes at useful times. Consider a network whose connection weights must be adjusted so that input spike patterns lead to correct decisions.",
  metric: "Now that event-driven sparsity has been established, the next question is how to measure whether it actually helps. A single accuracy number hides the costs that make spiking networks worthwhile, so evaluation has to weigh several quantities at once. Consider comparing two models that reach similar accuracy at very different energy and latency costs.",
  comparison: "With the individual metrics defined, the models can finally be compared side by side. Consider the same families of spiking networks measured together across accuracy, latency, energy, and spike count rather than one metric at a time.",
  application: "The measured tradeoffs only matter when they meet a real deployment. Consider an edge device that must hit an accuracy target inside a fixed energy and latency budget, and how that constraint selects one spiking approach over another.",
  challenges: "The tradeoffs so far assume clean measurements and stable hardware. Consider what is still unresolved once spiking networks leave controlled benchmarks: hardware standardization, scalable training, and reproducible evaluation.",
  basic_def: "Building on the motivation for sparse, event-driven computation, consider what a spiking neural network actually is: a network whose neurons communicate with discrete spikes in time rather than continuous activations.",
};

function removeRepeatedMotivation(pages: LearnerPage[], report: FinalizeReport): void {
  let motifSeen = false;
  for (const page of pages) {
    const intro = page.body.replace(/^#.*$/gm, " ").split(/\s+/).filter(Boolean).slice(0, 80).join(" ");
    const hasMotif = MOTIF_RE.test(intro);
    if (!hasMotif) continue;
    if (!motifSeen && page.sectionNumber <= 2) {
      // Allow the first early page to establish the framing.
      motifSeen = true;
      continue;
    }
    motifSeen = true;
    const transition = ROLE_TRANSITION[page.role];
    if (!transition) continue;
    // Replace the first prose paragraph (which carries the motif) with a
    // forward transition that builds on prior pages.
    const paragraphs = page.body.replace(/^\n+/, "").split(/\n{2,}/);
    let firstProse = paragraphs.findIndex((paragraph) => {
      const trimmed = paragraph.trim();
      return trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("!") && !trimmed.startsWith("```");
    });
    if (firstProse < 0) firstProse = 0;
    if (MOTIF_RE.test(paragraphs[firstProse] ?? "")) {
      paragraphs[firstProse] = transition;
      page.body = paragraphs.join("\n\n");
      page.dirty = true;
      report.notes.push(`replaced repeated first-page motivation on ${page.rel}`);
    }
  }
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
    const lines = [
      "# Breadboard Validation Report",
      "",
      `Generated: ${new Date().toISOString()}`,
      `Root: ${path.resolve(gardenDir)}`,
      `Garden: ${gardenSlug}`,
      `Source files: ${countSourcePages(gardenDir)}`,
      `Page counts: learner=${countLearnerPages(gardenDir)}, sources=${countSourcePages(gardenDir)}`,
      `Accepted: ${accepted ? "yes" : "no"}`,
      "Produced by: dashboard/src/lib/garden-finalize.ts (finalizeGardenExport) + scripts/validate-breadboard-garden.ts",
      "",
      "## Export Tree",
      "",
      "See checks: exported tree, no source page typed as learner page.",
      "",
      "## Link Validation",
      "",
      "See the standalone validator's wikilink checks.",
      "",
      "## Learning Unit Contract Fulfillment",
      "",
      "See check: Learning Unit Contract fulfillment.",
      "",
      "## Zettelkasten Tags",
      "",
      "Tags must exactly match the unit contract's zettelNotes handles.",
      "",
      "## Source Coverage From Contract",
      "",
      "See check: Source Coverage follows the Learning Unit Contract.",
      "",
      "## Interactive Visual Fulfillment",
      "",
      "Planned interactive visuals must be embedded or intentionally omitted with a reason.",
      "",
      "## Interactive Visual Uniqueness",
      "",
      "See Learning Unit Contract validation and visual-index checks.",
      "",
      "## Formula Grounding",
      "",
      "Only meaningful formulas are grounded; trivial numbers and standalone percentages are rejected in formulas: metadata.",
      "",
      "## Source Crop Quality",
      "",
      "See check: source crop quality is acceptable.",
      "",
      "## Section Title Quality",
      "",
      "See check: section titles are learner-facing.",
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
  if (visual.usageStatus === "assigned" && !cropped) {
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

  // Export tree.
  const allowed = new Set(["_index.md", "learning", "sources", "assets", ".breadboard"]);
  const treeProblems: string[] = [];
  for (const entry of fs.readdirSync(gardenDir)) {
    if (!allowed.has(entry)) treeProblems.push(`unexpected top-level: ${entry}`);
  }
  if (!fs.existsSync(path.join(gardenDir, "sources", "_index.md"))) treeProblems.push("sources/_index.md missing");
  push("exported tree only _index.md/learning/sources/assets/.breadboard", treeProblems);

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

  // Source Coverage from contract.
  const coverageProblems: string[] = [];
  const coverage = fs.existsSync(path.join(gardenDir, ".breadboard", "planning", "Source Coverage.md"))
    ? fs.readFileSync(path.join(gardenDir, ".breadboard", "planning", "Source Coverage.md"), "utf-8")
    : "";
  if (!coverage && contract.assignments.length > 0) coverageProblems.push(".breadboard/planning/Source Coverage.md missing");
  if (/central to\s+\[\[/i.test(coverage)) coverageProblems.push("Source Coverage still uses heuristic 'central to [[page]]' assignments");
  for (const assignment of contract.assignments) {
    const escaped = assignment.sourceArtifactId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (coverage && !new RegExp(`${escaped}[^\\n]*assigned to ${assignment.assignedLearningUnitId}\\b`, "i").test(coverage)) {
      coverageProblems.push(`${assignment.sourceArtifactId}: Source Coverage does not assign to contract unit ${assignment.assignedLearningUnitId}`);
    }
  }
  push("Source Coverage follows the Learning Unit Contract", [...new Set(coverageProblems)]);

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
  push("section titles are learner-facing", titleProblems);

  // Source crop quality.
  const ledger = readJson<LedgerVisual[]>(path.join(gardenDir, ".breadboard", "source-visuals.json"), []);
  const cropProblems = ledger.flatMap((visual) => cropQualityProblems(gardenDir, visual));
  push("source crop quality is acceptable", cropProblems);

  if (includeReportSelfCheck) {
    push("validation report present", fs.existsSync(path.join(gardenDir, ".breadboard", "validation-report.md")) ? [] : ["missing"]);
  }

  return checks;
}

function runCriticalGate({
  gardenDir,
  ledgerPath,
  report,
}: {
  gardenDir: string;
  ledgerPath: string;
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
