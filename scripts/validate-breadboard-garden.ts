// Breadboard learning-garden validator.
//
// Checks a generated garden against the pipeline acceptance rules (learner
// voice, hidden sources/planning, source-visual coverage, interactive-visual
// enforcement + ID consistency, page-specific zettel tags, lesson quality).
// Zero dependencies; the type annotations are erasable so it runs on
// Node >= 22 via:
//
//   node --experimental-strip-types scripts/validate-breadboard-garden.ts <garden> [more...]
//   node --experimental-strip-types scripts/validate-breadboard-garden.ts --all
//   node --experimental-strip-types scripts/validate-breadboard-garden.ts ../quartz/content/<garden>
//
// or from dashboard/: npm run validate:garden -- <garden-or-path>
//
// Exit code 0 = all checks pass, 1 = at least one failure.

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractQuartzMath } from "../dashboard/src/lib/quartz-markdown.ts";
import {
  assignSourceArtifacts,
  dedupeSourceArtifactAssignments,
  figurePlacementProblems,
  interactiveVisualGroundingProblems,
  isAtomicZettelHandle,
  normalizeLearningUnits,
  normalizedSectionTitleKey,
  scaffoldLikeZettelHandle,
  sectionSemanticProfiles,
  sectionTitleUniquenessProblems,
  sectionTitleGrammarProblems,
  sectionTitleNaturalnessProblems,
  validateLearningUnitContracts,
  visualTypeCompatibleWithUnit,
  zettelHandleQualityProblems,
  zettelHandlesForUnit,
  type LearningUnitContract,
  type SourceArtifactAssignment,
  type SourceFigurePlacement,
} from "../dashboard/src/lib/learning-unit-contract.ts";
import { formulaMeaningMatch, formulaMetricFamily, isFormulaExpression, isGroundableFormula, isTrivialFormulaFragment, isWorkedExampleFormula } from "../dashboard/src/lib/learn-utils.ts";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_ROOT = path.resolve(SCRIPT_DIR, "..", "quartz", "content");
const require = createRequire(path.resolve(SCRIPT_DIR, "..", "dashboard", "package.json"));
const katex = require("katex") as {
  renderToString: (formula: string, options: { displayMode: boolean; throwOnError: boolean; strict?: "warn" }) => string;
};

// ---------------------------------------------------------------------------
// Shared rule mirrors (keep in sync with dashboard/src/lib/learn-utils.ts,
// dashboard/src/lib/learning-garden.ts and quartz/quartz/plugins/filters/draft.ts)
// ---------------------------------------------------------------------------

const SOURCE_COMMENTARY_PATTERNS: RegExp[] = [
  /\bthe paper\b/i,
  /\bthis paper\b/i,
  /\bthe source\b/i,
  /\bthe uploaded source\b/i,
  /\bsource-derived\b/i,
  /\bsource-central\b/i,
  /\baccording to the source\b/i,
  /\bthe source material\b/i,
];

const FALLBACK_FINGERPRINTS: RegExp[] = [
  /The durable concept/i,
  /Relevant details:/i,
  /Read these details as a sequence/i,
  /When no figure is attached/i,
  /Minimal learner-facing fallback/i,
  /Introduce .* from uploaded sources/i,
  /This section is part of the confirmed Breadboard learning map/i,
  /The confirmed learning map did not provide enough local detail/i,
  // Half-written scaffold verbs / placeholders (mirror of PLACEHOLDER_PATTERNS).
  /\binsert (?:explanation|the |your |text|content|details?|example|figure|analogy)\b/i,
  /\b(?:add|write|fill in) (?:the |your |an? )?(?:explanation|example|analogy|content|details?) here\b/i,
  /\bsource says\b/i,
  /\bTODO\b/,
  /\bplaceholder\b/i,
];

/** Two or more empty/ellipsis bullet items ("- ", "- ...", "- TBD"). */
function hasEmptyBulletScaffold(body: string): boolean {
  let empties = 0;
  for (const line of body.replace(/```[\s\S]*?```/g, " ").split(/\r?\n/)) {
    if (/^\s*[-*+]\s*(?:\.{2,}|…|TBD|N\/A|-{2,})?\s*$/i.test(line)) empties += 1;
  }
  return empties >= 2;
}

const RAW_REFERENCE_DUMP_RE = /\[\d+\]\s+[A-Z][^"\n]+,\s*["“].+["”]/;

const MIN_LESSON_WORDS = 700;

const BANNED_TAG_SEGMENTS = new Set([
  "paper", "source", "sources", "what", "model", "models", "test", "tests",
  "overview", "coverage", "visual", "visuals", "context", "contract", "scope",
  "abstract", "abstract-spiking", "accepted-october", "access-article",
  "garden", "note", "notes", "page", "pages", "section", "sections", "misc",
  "general", "document", "documents", "pdf", "file", "files", "upload",
  "uploads", "learning", "textbook", "introduction", "conclusion", "summary",
  "content", "material", "materials", "topic", "topics", "concept", "concepts",
  "idea", "ideas", "motivation", "against-figures", "input", "inputs", "output",
  "outputs", "potential", "energy", "accuracy", "continuous", "important",
  "example", "examples", "detail", "details", "point", "points", "thing",
  "things", "approach", "approaches", "method", "methods", "system", "systems",
  "figure", "figures", "table", "tables", "data", "value", "values", "result",
  "results", "comparison", "analysis", "study", "work", "field", "area",
]);

const INTERNAL_KNOWLEDGE_TYPES = new Set([
  "internal-concept", "source-document", "source-map", "scope-contract",
  "source-coverage",
]);

const NO_TAG_KNOWLEDGE_TYPES = new Set([
  ...INTERNAL_KNOWLEDGE_TYPES, "learning-map", "topic-overview", "cluster-index",
  "garden-overview", "learning-section", "textbook-section",
]);

// Interactive or nothing: only these types have a real interactive renderer.
const INTERACTIVE_VISUAL_TYPES = new Set([
  "function_plot", "linked_time_plots", "mass_spring", "energy_exchange",
  "resonance_curve", "lif_neuron", "neural_coding", "stdp_window",
  "metric_calculator", "training_curve", "tradeoff_explorer",
]);

// Hard dynamic concepts: a lesson that teaches one must ship an interactive
// visual. Mirrors HARD_CONCEPTS in learn.ts.
const HARD_CONCEPT_PATTERNS: Array<{ label: string; test: RegExp }> = [
  { label: "LIF dynamics", test: /\bleaky integrate[- ]and[- ]fire\b|\blif neuron\b|\bmembrane potential\b|\bfiring threshold\b|\brefractory\b/i },
  { label: "spike coding", test: /\brate coding\b|\btemporal coding\b|\bfirst[- ]spike latency\b/i },
  { label: "STDP", test: /\bspike[- ]timing[- ]dependent plasticity\b|\bstdp\b/i },
  { label: "metric calculator", test: /\baccuracy\b|\blatency\b|\benergy\b|\bspike count\b|\bnormalized efficiency\b/i },
  { label: "training curve", test: /\btraining loss\b|\baccuracy curve\b|\bconvergence\b|\bepoch\b/i },
  { label: "metric tradeoff", test: /\btrade[- ]?off\b|\benergy per inference\b|\bspike count\b/i },
];

// Concept tag → the evidence a page must show to legitimately carry it.
const TAG_RELEVANCE_RULES: Array<{ appliesTo: RegExp; evidence: RegExp; minBody?: number }> = [
  { appliesTo: /lif-neuron|leaky/i, evidence: /\blif\b|leaky[- ]integrate|membrane potential|threshold/i },
  { appliesTo: /stdp/i, evidence: /\bstdp\b|spike[- ]?timing|synaptic plasticity/i },
  { appliesTo: /surrogate/i, evidence: /surrogate[- ]gradient|surrogate[- ]trained|surrogate training/i },
  { appliesTo: /ann-to-snn-conversion/i, evidence: /\bann[- ]to[- ]snn\b|conversion|firing[- ]rate approximation/i },
  { appliesTo: /(?:^|[/-])latency(?:$|[/-])/i, evidence: /\blatency\b|\bresponse time\b/i, minBody: 2 },
  { appliesTo: /convergence/i, evidence: /\bconverg\w*\b|\btraining loss\b|\bepochs?\b/i, minBody: 2 },
];

// ---------------------------------------------------------------------------
// Tiny frontmatter + fs helpers
// ---------------------------------------------------------------------------

interface PageFile {
  absPath: string;
  relPath: string; // garden-relative, posix separators
  frontmatter: Record<string, string | string[]>;
  rawFrontmatter: string;
  body: string;
  published: boolean;
}

function parseYamlValue(value: string): string | string[] {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return trimmed.replace(/^["']|["']$/g, "");
}

function splitFrontmatter(content: string): {
  frontmatter: Record<string, string | string[]>;
  rawFrontmatter: string;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, rawFrontmatter: "", body: content };
  const frontmatter: Record<string, string | string[]> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    frontmatter[line.slice(0, index).trim()] = parseYamlValue(line.slice(index + 1));
  }
  return { frontmatter, rawFrontmatter: match[1] ?? "", body: match[2] ?? "" };
}

function fmString(fm: Record<string, string | string[]>, key: string): string {
  const value = fm[key];
  return typeof value === "string" ? value : "";
}

function fmArray(fm: Record<string, string | string[]>, key: string): string[] {
  const value = fm[key];
  if (Array.isArray(value)) return value;
  return typeof value === "string" && value ? [value] : [];
}

function slugifyLoose(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Raw uploaded source notes publish under a visible Sources folder (mirror of
// quartz draft.ts isSourceDocument).
function isSourceDocument(knowledgeType: string, breadboardType: string, relPath: string): boolean {
  if (knowledgeType === "source-document" || breadboardType === "source_document") return true;
  return relPath.split("/").some((part) => part.toLowerCase() === "sources");
}

// Mirror of quartz RemoveDrafts.shouldPublish (draft.ts).
function isPublished(relPath: string, fm: Record<string, string | string[]>): boolean {
  const parts = relPath.split("/");
  const lowerParts = parts.map((part) => part.toLowerCase());
  if (
    lowerParts.some(
      (part) =>
        part === "internal" || part === ".breadboard" ||
        part === "generated" || part === "generated subtopics" || part === "subtopics" ||
        part === "ai topics" || part === "topic cards" ||
        /^\d+\.\s*source-snapshots$/.test(part),
    )
  ) {
    return false;
  }
  const lowerRel = relPath.toLowerCase();
  if (
    lowerRel.endsWith("learning/source map.md") ||
    lowerRel.endsWith("learning/scope contract.md") ||
    lowerRel.endsWith("learning/source coverage.md")
  ) {
    return false;
  }
  if (fmString(fm, "legacy_subtopic_page") === "true") return false;
  if (fmString(fm, "draft") === "true" || fm["draft"] === "true") return false;
  const knowledgeType = fmString(fm, "knowledge_type");
  const breadboardType = fmString(fm, "breadboardType") || fmString(fm, "breadboard_type");
  // Source documents publish even though older sources carry internal:true.
  if (isSourceDocument(knowledgeType, breadboardType, relPath)) return true;
  if (fmString(fm, "internal") === "true") return false;
  if (INTERNAL_KNOWLEDGE_TYPES.has(knowledgeType)) return false;
  if (INTERNAL_KNOWLEDGE_TYPES.has(breadboardType.replace(/_/g, "-"))) return false;

  // Ingest lesson sections/pages not authored by the Learn pipeline are internal.
  const lessonType =
    /^(learning|textbook)-(page|section)$/.test(knowledgeType) ||
    /^(learning|textbook)_(page|section)$/.test(breadboardType);
  const learnAuthored =
    fmString(fm, "generated_by") === "learn_button" ||
    fmString(fm, "generatedBy") === "learn_button";
  if (lessonType && !learnAuthored) return false;

  const title = fmString(fm, "title").replace(/^\d+(?:\.\d+)*\.?\s*/, "");
  const sourceFile = fmString(fm, "source_file").replace(
    /\.(pdf|docx?|pptx?|xlsx?|txt|md|csv|zip|png|jpe?g|webp)$/i,
    "",
  );
  if (title && sourceFile && slugifyLoose(title) === slugifyLoose(sourceFile)) return false;

  return true;
}

function walkMarkdown(dir: string, relDir: string, output: PageFile[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue; // .breadboard internals/backups
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      walkMarkdown(path.join(dir, entry.name), rel, output);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const absPath = path.join(dir, entry.name);
    const content = fs.readFileSync(absPath, "utf-8");
    const { frontmatter, rawFrontmatter, body } = splitFrontmatter(content);
    output.push({
      absPath,
      relPath: rel,
      frontmatter,
      rawFrontmatter,
      body,
      published: isPublished(rel, frontmatter),
    });
  }
}

/** Prose with code fences, image embeds, and compact provenance captions
 * removed — used so figure captions are not judged as teaching voice. */
function teachingProse(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/^\s*\*[^*\n]+\*(?:\s*\*\([^)\n]*\)\*)?\s*$/gm, " ");
}

function proseWordCount(body: string): number {
  const text = teachingProse(body).replace(/[#>*_`|-]+/g, " ");
  return text.split(/\s+/).filter((word) => /[a-z0-9]/i.test(word)).length;
}

function countPattern(text: string, pattern: RegExp): number {
  const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  return (text.match(global) ?? []).length;
}

function withoutCodeFences(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, (match) => " ".repeat(match.length));
}

function sectionBody(markdown: string, heading: string): string {
  const re = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im");
  const match = re.exec(markdown);
  if (!match || match.index === undefined) return "";
  const start = match.index + match[0].length;
  const next = markdown.slice(start).search(/\n##\s+/);
  return next >= 0 ? markdown.slice(start, start + next) : markdown.slice(start);
}

function readIfExists(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function assetPathForUrl(gardenDir: string, gardenSlug: string, assetUrl: string): string | null {
  const normalized = assetUrl.replace(/\\/g, "/").trim();
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

function cropQualityProblems(gardenDir: string, gardenSlug: string, visual: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const id = String(visual.sourceVisualId ?? "(unknown)");
  const type = String(visual.type ?? "");
  const cropped = String(visual.croppedImagePath ?? "");
  const conceptUsage = String(visual.conceptUsage ?? "");
  const cropStatus = String(visual.cropStatus ?? "");
  const requiresEmbeddedCrop = !conceptUsage || /^(?:embedded_as_crop|embedded_and_explained)$/i.test(conceptUsage);
  if (String(visual.usageStatus ?? "") === "assigned" && requiresEmbeddedCrop && !cropped && cropStatus !== "omitted_unreliable") {
    problems.push(`${id}: assigned ${type || "visual"} has no croppedImagePath`);
    return problems;
  }
  if (!cropped) return problems;
  if (/-page-\d{2,}(?:-\d+)?\.(?:png|jpe?g|webp)$/i.test(cropped)) {
    problems.push(`${id}: croppedImagePath looks like a full-page snapshot`);
  }
  const filePath = assetPathForUrl(gardenDir, gardenSlug, cropped);
  const dims = filePath ? imageDimensions(filePath) : null;
  if (!dims) {
    problems.push(`${id}: cannot read crop dimensions for ${cropped}`);
  } else {
    const minWidth = type === "equation" ? 180 : type === "table" ? 260 : 160;
    const minHeight = type === "equation" ? 48 : type === "table" ? 120 : 90;
    if (dims.width < minWidth || dims.height < minHeight) {
      problems.push(`${id}: crop too small (${dims.width}x${dims.height}, expected at least ${minWidth}x${minHeight})`);
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
    const placement = SOURCE_FIGURE_PLACEMENTS.has(rawPlacement) ? rawPlacement : "inside_concept_explanation";
    assignments.push({
      sourceArtifactId,
      assignedLearningUnitId,
      placement,
      reason: stringField(row.reason),
      requiredInterpretation: stringField(row.requiredInterpretation ?? row.interpretationGoal ?? row.goal),
      forbiddenSections: Array.isArray(row.forbiddenSections)
        ? row.forbiddenSections.map((value) => stringField(value)).filter(Boolean)
        : undefined,
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
      // try the next location
    }
  }
  return { units: [], assignments: [] };
}

function visualAnchorIds(spec: Record<string, unknown>): string[] {
  const raw = spec.sourceAnchors;
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    for (const key of ["figureId", "tableId", "equationId", "questionId", "textAnchorId"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) ids.push(value.trim());
    }
  }
  return [...new Set(ids)];
}

function visualAnchorRecords(spec: Record<string, unknown>): Array<Record<string, unknown>> {
  const raw = spec.sourceAnchors;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
}

function embeddedVisualSpecsFromBody(body: string): Array<Record<string, unknown>> {
  const specs: Array<Record<string, unknown>> = [];
  const blockRe = /```breadboard-visual\r?\n([\s\S]*?)\r?\n```/g;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(body)) !== null) {
    try {
      const parsed = JSON.parse(match[1] ?? "{}");
      if (parsed && typeof parsed === "object") specs.push(parsed as Record<string, unknown>);
    } catch {
      // Invalid visual JSON is reported by the main visual validity check.
    }
  }
  return specs;
}

function pageSourceIds(page: PageFile): Set<string> {
  return new Set([
    ...fmArray(page.frontmatter, "sourceAnchors"),
    ...fmArray(page.frontmatter, "sourceVisualIds"),
    ...fmArray(page.frontmatter, "sourceFormulaAnchors"),
    fmString(page.frontmatter, "sourceFormulaAnchor"),
  ].filter(Boolean));
}

function sectionSemanticInputs(
  gardenDir: string,
  lessonPages: PageFile[],
  unitsById: Map<string, LearningUnitContract>,
): Array<{ rel: string; sectionTitle: string; units: LearningUnitContract[]; subsectionTitles: string[] }> {
  const bySection = new Map<string, { pages: PageFile[]; units: LearningUnitContract[] }>();
  for (const page of lessonPages) {
    const parts = page.relPath.split("/");
    if (parts.length < 3) continue;
    const rel = parts.slice(0, 2).join("/");
    const entry = bySection.get(rel) ?? { pages: [], units: [] };
    entry.pages.push(page);
    const unit = unitsById.get(fmString(page.frontmatter, "learningUnitId"));
    if (unit) entry.units.push(unit);
    bySection.set(rel, entry);
  }
  const inputs: Array<{ rel: string; sectionTitle: string; units: LearningUnitContract[]; subsectionTitles: string[] }> = [];
  for (const [rel, entry] of bySection) {
    const indexPath = path.join(gardenDir, ...rel.split("/"), "_index.md");
    const title = readIfExists(indexPath)
      ? fmString(splitFrontmatter(readIfExists(indexPath)).frontmatter, "title")
      : rel.split("/").pop() ?? rel;
    inputs.push({
      rel,
      sectionTitle: title || rel,
      units: entry.units,
      subsectionTitles: entry.pages.map((page) => fmString(page.frontmatter, "title")).filter(Boolean),
    });
  }
  return inputs;
}

function idsUsedByLearners(lessonPages: PageFile[]): Set<string> {
  const ids = new Set<string>();
  for (const page of lessonPages) {
    for (const id of fmArray(page.frontmatter, "sourceVisualIds")) ids.add(id);
    for (const id of fmArray(page.frontmatter, "sourceAnchors")) ids.add(id);
    for (const entry of formulaEntriesFromFrontmatter(page.rawFrontmatter)) {
      if (entry.sourceAnchor) ids.add(entry.sourceAnchor);
    }
    for (const id of fmArray(page.frontmatter, "sourceFormulaAnchors")) ids.add(id);
    for (const spec of embeddedVisualSpecsFromBody(page.body)) {
      for (const id of visualAnchorIds(spec)) ids.add(id);
    }
  }
  return ids;
}

function anchorTextForVisualIds(
  ledger: Array<Record<string, unknown>>,
  ids: string[],
  spec: Record<string, unknown>,
): string {
  const ledgerText = ids
    .map((id) => ledger.find((visual) => String(visual.sourceVisualId ?? "") === id))
    .filter((visual): visual is Record<string, unknown> => Boolean(visual))
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

function sourceMapCaveatProblems(gardenDir: string, ledger: Array<Record<string, unknown>>): string[] {
  const problems: string[] = [];
  const docs: Array<[string, string]> = [];
  const addDoc = (rel: string): void => docs.push([rel, path.join(gardenDir, ...rel.split("/"))]);
  for (const rel of [".breadboard/planning/Source Map.md", ".breadboard/planning/Source Coverage.md", "learning/Learning Map.md", "learning/Topic Overview.md"]) addDoc(rel);
  const planningPages: PageFile[] = [];
  walkMarkdown(path.join(gardenDir, ".breadboard", "planning"), ".breadboard/planning", planningPages);
  for (const page of planningPages) {
    if (!docs.some(([rel]) => rel === page.relPath)) docs.push([page.relPath, page.absPath]);
  }
  const learningPages: PageFile[] = [];
  walkMarkdown(path.join(gardenDir, "learning"), "learning", learningPages);
  for (const page of learningPages) {
    if (!docs.some(([rel]) => rel === page.relPath)) docs.push([page.relPath, page.absPath]);
  }
  const hasFormulaAnchors = ledger.some(isFormulaVisual);
  const hasFormulaExactText = ledger.some((visual) => isFormulaVisual(visual) && String(visual.exactText ?? visual.ocrText ?? "").trim());
  const hasFormulaCrops = ledger.some((visual) => isFormulaVisual(visual) && String(visual.croppedImagePath ?? "").trim());
  const sourceDocs: PageFile[] = [];
  walkMarkdown(path.join(gardenDir, "sources"), "sources", sourceDocs);
  const hasFormulaMarkdown = sourceDocs.some((page) =>
    /(?:\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\frac|\\sum|\\min|\\max|\\geq|\\leq|[A-Za-z][A-Za-z0-9_{}\\]*\s*=)/.test(page.body),
  );
  const hasTables = ledger.some((visual) => String(visual.type ?? "") === "table" || /\.T\d+$/i.test(String(visual.sourceVisualId ?? "")));
  const hasFigures = ledger.some((visual) => !isFormulaVisual(visual) && String(visual.type ?? "") !== "table" && !/\.T\d+$/i.test(String(visual.sourceVisualId ?? "")));
  const latestPageNumberWithText = Math.max(
    0,
    ...sourceDocs.flatMap((page) => [...page.body.matchAll(/^\s*#{1,3}\s*Page\s+(\d+)\b/gim)].map((match) => Number.parseInt(match[1] ?? "0", 10))),
  );
  const hasLaterPages = latestPageNumberWithText > 2 || ledger.some((visual) => Number(visual.page ?? visual.pageNumber ?? 0) > 2);
  for (const [label, filePath] of docs) {
    const text = readIfExists(filePath);
    if (!text) continue;
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
    if (hasLaterPages && /only pages?\s*1\s*[-–]\s*2\s+(?:are|is)\s+(?:available|present)|truncated after page\s*2|source map is truncated|later (?:page|pages|section|sections)[^.\n]*(?:not available|unavailable|captions?|anchored to captions)|must (?:remain )?anchored to extracted .*captions|must not be inferred beyond/i.test(text)) {
      problems.push(`${label}: stale caveat says later pages are unavailable despite later anchors/pages`);
    }
  }
  return [...new Set(problems)];
}

function sourceAnchorUsageVsCropStatusProblems(
  ledger: Array<Record<string, unknown>>,
  lessonPages: PageFile[],
): string[] {
  const usedIds = idsUsedByLearners(lessonPages);
  const problems: string[] = [];
  for (const visual of ledger) {
    const id = String(visual.sourceVisualId ?? "");
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

function cropFallbackProblems(ledger: Array<Record<string, unknown>>, lessonPages: PageFile[]): string[] {
  const usedIds = idsUsedByLearners(lessonPages);
  const problems: string[] = [];
  for (const visual of ledger) {
    const id = String(visual.sourceVisualId ?? "");
    const cropStatus = String(visual.cropStatus ?? "");
    const conceptUsage = String(visual.conceptUsage ?? "");
    if (cropStatus === "omitted_unreliable" && !/explained_|used_as_interactive_grounding|referenced_again/.test(conceptUsage)) {
      problems.push(`${id}: crop omitted as unreliable without text/formula/interactive fallback`);
    }
    if (!String(visual.croppedImagePath ?? "") && usedIds.has(id) && !isFormulaVisual(visual) && cropStatus !== "omitted_unreliable") {
      problems.push(`${id}: non-formula anchor is used without a crop or explicit omitted_unreliable fallback`);
    }
  }
  return problems;
}

function isFormulaVisual(visual: Record<string, unknown>): boolean {
  return String(visual.type ?? "") === "equation" || /^S\d+\.P\d+\.E\d+$/i.test(String(visual.sourceVisualId ?? ""));
}

function formulaAnchorSemanticText(visual: Record<string, unknown> | undefined): string {
  if (!visual) return "";
  return [
    visual.sourceVisualId,
    visual.title,
    visual.caption,
    visual.exactText,
    visual.ocrText,
    visual.semanticSummary,
    visual.description,
  ].filter(Boolean).join(" ");
}

function unquoteYamlScalar(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

interface FormulaFrontmatterEntry {
  kind?: string;
  text?: string;
  groundingStatus?: string;
  justification?: string;
  sourceAnchor?: string;
  sourceAnchorTitle?: string;
}

function formulaEntriesFromFrontmatter(rawFrontmatter: string): FormulaFrontmatterEntry[] {
  const lines = rawFrontmatter.split(/\r?\n/);
  const entries: FormulaFrontmatterEntry[] = [];
  let inFormulas = false;
  let current: FormulaFrontmatterEntry | null = null;
  for (const line of lines) {
    if (!inFormulas) {
      const start = line.match(/^formulas:\s*(.*)$/);
      if (!start) continue;
      inFormulas = true;
      const inline = (start[1] ?? "").trim();
      if (inline.startsWith("[") && inline.endsWith("]")) {
        const objectMatches = [...inline.matchAll(/\{([^{}]+)\}/g)];
        for (const objectMatch of objectMatches) {
          const entry: FormulaFrontmatterEntry = {};
          for (const pair of (objectMatch[1] ?? "").split(/,\s*/)) {
            const index = pair.indexOf(":");
            if (index <= 0) continue;
            const key = pair.slice(0, index).trim() as keyof FormulaFrontmatterEntry;
            entry[key] = unquoteYamlScalar(pair.slice(index + 1));
          }
          entries.push(entry);
        }
      }
      continue;
    }
    if (/^\S[^:]*:\s*/.test(line)) break;
    const first = line.match(/^\s*-\s*([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (first) {
      current = {};
      current[first[1] as keyof FormulaFrontmatterEntry] = unquoteYamlScalar(first[2] ?? "");
      entries.push(current);
      continue;
    }
    const nested = line.match(/^\s{4,}([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (nested && current) {
      current[nested[1] as keyof FormulaFrontmatterEntry] = unquoteYamlScalar(nested[2] ?? "");
    }
  }
  return entries.filter((entry) => Object.values(entry).some((value) => String(value ?? "").trim()));
}

function formulaEntryKind(entry: FormulaFrontmatterEntry): string {
  const explicit = String(entry.kind ?? "").trim();
  if (explicit) return explicit;
  if (isWorkedExampleFormula(String(entry.text ?? ""))) return "worked_example";
  if (entry.groundingStatus === "source-anchored") return "source_definition";
  if (entry.groundingStatus === "source-derived") return "source_derived_definition";
  return "conceptual_helper";
}

function visualText(visual: Record<string, unknown>): string {
  return [
    visual.sourceVisualId,
    visual.type,
    visual.caption,
    visual.description,
    visual.pageNumber,
  ].map((value) => String(value ?? "")).join(" ");
}

function sectionFolderTitleConsistencyProblems(gardenDir: string): string[] {
  const problems: string[] = [];
  const learningDir = path.join(gardenDir, "learning");
  if (!fs.existsSync(learningDir)) return problems;
  const sectionTitleByKey = new Map<string, string>();
  const sectionFolderByKey = new Map<string, string>();
  for (const entry of fs.readdirSync(learningDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+\.\s+/.test(entry.name)) continue;
    const rel = `learning/${entry.name}`;
    const indexPath = path.join(learningDir, entry.name, "_index.md");
    if (!fs.existsSync(indexPath)) {
      problems.push(`${rel}/: section folder is missing _index.md`);
      continue;
    }
    const parsed = splitFrontmatter(fs.readFileSync(indexPath, "utf-8"));
    const fmTitle = fmString(parsed.frontmatter, "title") || entry.name;
    const h1 = parsed.body.match(/^\s*#\s+(.+?)\s*$/m)?.[1]?.trim() ?? "";
    const folderKey = normalizedSectionTitleKey(entry.name);
    const titleKey = normalizedSectionTitleKey(fmTitle);
    sectionTitleByKey.set(titleKey, fmTitle);
    sectionFolderByKey.set(folderKey, entry.name);
    if (folderKey !== titleKey) {
      problems.push(`${rel}/: folder name "${entry.name}" does not match _index title "${fmTitle}"`);
    }
    if (h1 && normalizedSectionTitleKey(h1) !== titleKey) {
      problems.push(`${rel}/_index.md: H1 "${h1}" does not match frontmatter title "${fmTitle}"`);
    }
  }
  const learningIndex = readIfExists(path.join(learningDir, "_index.md"));
  if (learningIndex) {
    for (const ref of wikilinkRefs(splitFrontmatter(learningIndex).body)) {
      const section = sectionFolderInfo(ref.target);
      if (!section) continue;
      const folderKey = normalizedSectionTitleKey(section.title);
      const title = sectionTitleByKey.get(folderKey);
      if (!title) {
        problems.push(`learning/_index.md: section link "${ref.label}" targets "${section.folder}" but no matching section title exists`);
        continue;
      }
      if (normalizedSectionTitleKey(ref.label) !== normalizedSectionTitleKey(title)) {
        problems.push(`learning/_index.md: link label "${ref.label}" does not match target section title "${title}"`);
      }
    }
  }
  const map = readIfExists(path.join(learningDir, "Learning Map.md"));
  if (map) {
    for (const line of splitFrontmatter(map).body.split(/\r?\n/)) {
      const bullet = line.match(/^\s*-\s*(?:\[\[[^\]]+\|)?(.+?)(?:\]\])?\s*$/);
      if (!bullet) continue;
      const label = cleanMapNode(bullet[1]);
      if (!/^\d+\.\s+/.test(label)) continue;
      const key = normalizedSectionTitleKey(label);
      if (!sectionTitleByKey.has(key) || !sectionFolderByKey.has(key)) {
        problems.push(`learning/Learning Map.md: section label "${label}" does not map to one matching section folder and title`);
      }
    }
  }
  return [...new Set(problems)];
}

function sectionTitleNaturalnessAllProblems(gardenDir: string, lessonPages: PageFile[], learningUnitsById: Map<string, LearningUnitContract>): string[] {
  const problems: string[] = [];
  for (const section of sectionSemanticInputs(gardenDir, lessonPages, learningUnitsById)) {
    for (const problem of sectionTitleNaturalnessProblems(section.sectionTitle, section.subsectionTitles)) {
      problems.push(`${section.rel}: ${problem}`);
    }
  }
  return [...new Set(problems)];
}

function formulaMetadataNoiseProblems(lessonPages: PageFile[]): string[] {
  const problems: string[] = [];
  for (const page of lessonPages) {
    const entries = formulaEntriesFromFrontmatter(page.rawFrontmatter);
    if (entries.length === 0) continue;
    const displayCount = extractQuartzMath(page.body).filter((expr) => expr.display && isGroundableFormula(expr.formula)).length;
    const sourceDefinitionCount = entries.filter((entry) => {
      const kind = formulaEntryKind(entry);
      return kind === "source_definition" || kind === "source_derived_definition";
    }).length;
    const workedExampleCount = entries.filter((entry) => formulaEntryKind(entry) === "worked_example").length;
    const trivial = entries.filter((entry) => isTrivialFormulaFragment(String(entry.text ?? "")) || !isFormulaExpression(String(entry.text ?? "")));
    if (entries.length > 10) {
      problems.push(`${page.relPath}: formulas: contains ${entries.length} entries; expected focused metric/source relationships, not inline-fragment harvesting`);
    }
    if (entries.length > Math.max(6, displayCount + sourceDefinitionCount + 4)) {
      problems.push(`${page.relPath}: formulas: has ${entries.length} entries but only ${displayCount} display formula(s) and ${sourceDefinitionCount} source definition formula(s)`);
    }
    if (workedExampleCount > Math.max(2, sourceDefinitionCount * 2 + 1)) {
      problems.push(`${page.relPath}: formulas: has ${workedExampleCount} worked example(s) but only ${sourceDefinitionCount} source definition formula(s)`);
    }
    if (trivial.length > 0 && trivial.length / entries.length > 0.3) {
      problems.push(`${page.relPath}: ${trivial.length}/${entries.length} formulas: entries are trivial fragments`);
    }
    for (const [index, entry] of entries.entries()) {
      const text = String(entry.text ?? "");
      const kind = formulaEntryKind(entry);
      if (isTrivialFormulaFragment(text) && /^(source-anchored|source-derived)$/.test(String(entry.groundingStatus ?? ""))) {
        problems.push(`${page.relPath}: formulas[${index}] source-anchors trivial fragment "${text}"`);
      }
      if ((kind === "source_definition" || kind === "source_derived_definition") && isWorkedExampleFormula(text)) {
        problems.push(`${page.relPath}: formulas[${index}] stores worked-example arithmetic as ${kind}`);
      }
    }
  }
  return [...new Set(problems)];
}

type FormulaFamily = NonNullable<ReturnType<typeof formulaMetricFamily>>;

function formulaFamilyForAnchor(id: string, ledger: Array<Record<string, unknown>>): FormulaFamily | null {
  const visual = ledger.find((item) => String(item.sourceVisualId ?? "") === id);
  return formulaMetricFamily(formulaAnchorSemanticText(visual));
}

function visualSpecFamilyText(spec: Record<string, unknown>): string {
  return [
    spec.title,
    spec.learningGoal,
    spec.pedagogicalPurpose,
    spec.caption,
    Array.isArray(spec.conceptTargets) ? spec.conceptTargets.join(" ") : "",
    Array.isArray(spec.inputs) ? spec.inputs.join(" ") : "",
    Array.isArray(spec.outputs) ? spec.outputs.join(" ") : "",
    Array.isArray(spec.controls)
      ? spec.controls.map((control) => typeof control === "object" && control ? Object.values(control as Record<string, unknown>).join(" ") : "").join(" ")
      : "",
  ].join(" ");
}

function familiesFromVisualContext(spec: Record<string, unknown>, page: PageFile, includePageContext: boolean): Set<FormulaFamily> {
  const text = [
    includePageContext ? page.relPath : "",
    includePageContext ? fmString(page.frontmatter, "title") : "",
    visualSpecFamilyText(spec),
  ].join(" ");
  const families = new Set<FormulaFamily>();
  for (const chunk of text.split(/[;,|]/)) {
    const family = formulaMetricFamily(chunk);
    if (family) families.add(family);
  }
  const whole = formulaMetricFamily(text);
  if (whole) families.add(whole);
  return families;
}

function allowedVisualAnchorFamilies(expected: Set<FormulaFamily>): Set<FormulaFamily> {
  const allowed = new Set(expected);
  if (expected.has("efficiency")) {
    allowed.add("accuracy");
    allowed.add("energy");
    allowed.add("spike-count");
  }
  if (expected.has("energy")) {
    allowed.add("spike-count");
  }
  return allowed;
}

function visualAnchorPrecisionProblems(
  ledger: Array<Record<string, unknown>>,
  embedded: Array<{ page: PageFile; spec: Record<string, unknown> }>,
): string[] {
  const problems: string[] = [];
  for (const { page, spec } of embedded) {
    const type = String(spec.type ?? "");
    if (type !== "metric_calculator" && type !== "tradeoff_explorer") continue;
    const ids = visualAnchorIds(spec).filter((id) => /^S\d+\.P\d+\.E\d+$/i.test(id));
    if (ids.length === 0) continue;
    const formulaAnchorRecords = visualAnchorRecords(spec).filter((anchor) => {
      const id = String(anchor.equationId ?? "").trim();
      return /^S\d+\.P\d+\.E\d+$/i.test(id);
    });
    if (formulaAnchorRecords.length > 1) {
      for (const anchor of formulaAnchorRecords) {
        const id = String(anchor.equationId ?? "").trim();
        const role = String(anchor.role ?? "").trim();
        const reason = String(anchor.reason ?? "").trim();
        if (!/^(input|output_formula|comparison_basis|context)$/.test(role)) {
          problems.push(`${page.relPath}: visual ${String(spec.id ?? "(missing id)")} anchor ${id} lacks a valid role`);
        }
        if (reason.length < 12) {
          problems.push(`${page.relPath}: visual ${String(spec.id ?? "(missing id)")} anchor ${id} lacks a specific role reason`);
        }
      }
    }
    const includePageContext = type !== "metric_calculator";
    const expected = familiesFromVisualContext(spec, page, includePageContext);
    const anchorFamilies = ids
      .map((id) => ({ id, family: formulaFamilyForAnchor(id, ledger) }))
      .filter((entry): entry is { id: string; family: FormulaFamily } => Boolean(entry.family));
    if (expected.size === 0 || anchorFamilies.length === 0) continue;
    const explicitText = [
      visualSpecFamilyText(spec),
      includePageContext ? fmString(page.frontmatter, "title") : "",
    ].join(" ");
    const isExplicitMultiMetric =
      /\bmulti[- ]?metric\b|\btrade[- ]?off\b|accuracy.*latency.*energy|latency.*energy.*accuracy/i.test(explicitText);
    const allowed = allowedVisualAnchorFamilies(expected);
    const extras = anchorFamilies.filter(({ family }) => !allowed.has(family));
    const missing = [...expected].filter((family) => !anchorFamilies.some((entry) => entry.family === family));
    if (!isExplicitMultiMetric && expected.size <= 2 && extras.length > 0) {
      problems.push(
        `${page.relPath}: visual ${String(spec.id ?? "(missing id)")} has unrelated formula anchor families [${extras.map((entry) => `${entry.id}:${entry.family}`).join(", ")}]; expected [${[...expected].join(", ")}]`,
      );
    }
    if (missing.length > 0 && !isExplicitMultiMetric) {
      problems.push(`${page.relPath}: visual ${String(spec.id ?? "(missing id)")} is missing expected formula family anchor(s) [${missing.join(", ")}]`);
    }
  }
  return [...new Set(problems)];
}

function repairLogConsistencyProblems(gardenDir: string, lessonPages: PageFile[]): string[] {
  const logPath = path.join(gardenDir, ".breadboard", "repair-log.json");
  const repairedPagesWithFm = lessonPages.filter((page) => fmString(page.frontmatter, "lastSemanticRepairAt"));
  if (!fs.existsSync(logPath)) {
    return repairedPagesWithFm.map((page) => `${page.relPath}: has semantic repair provenance but .breadboard/repair-log.json is missing`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(logPath, "utf-8"));
  } catch {
    return [".breadboard/repair-log.json is not valid JSON"];
  }
  const record = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const repairs = Array.isArray(record.repairs) ? record.repairs as Array<Record<string, unknown>> : [];
  const problems: string[] = [];
  for (const repair of repairs) {
    const pagePath = String(repair.pagePath ?? "(unknown page)");
    const result = String(repair.result ?? "");
    if (result === "unresolved") problems.push(`${pagePath}: repair log result is unresolved`);
    const unresolved = Array.isArray(repair.unresolvedValidationErrors) ? repair.unresolvedValidationErrors : [];
    for (const error of unresolved) problems.push(`${pagePath}: unresolved repair validation error: ${String(error)}`);
  }
  const repairedPages = new Set(repairs.map((repair) => String(repair.pagePath ?? "")));
  for (const page of repairedPagesWithFm) {
    if (!repairedPages.has(page.relPath)) problems.push(`${page.relPath}: has lastSemanticRepairAt but no matching repair-log entry`);
    if (!fmString(page.frontmatter, "generatedFromUnitId")) problems.push(`${page.relPath}: semantic repair provenance missing generatedFromUnitId`);
    if (!fmString(page.frontmatter, "semanticRepairReason")) problems.push(`${page.relPath}: semantic repair provenance missing semanticRepairReason`);
  }
  return [...new Set(problems)];
}

// ---------------------------------------------------------------------------
// Check machinery
// ---------------------------------------------------------------------------

export type ValidationSeverity = "pass" | "warn" | "fail" | "skip";

export interface CheckResult {
  id: number;
  name: string;
  status: "PASS" | "WARN" | "FAIL" | "SKIP";
  severity?: ValidationSeverity;
  problems: string[];
  reason?: string;
  acceptanceBlocking?: boolean;
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

function statusFromSeverity(severity: ValidationSeverity): CheckResult["status"] {
  switch (severity) {
    case "pass":
      return "PASS";
    case "warn":
      return "WARN";
    case "fail":
      return "FAIL";
    case "skip":
      return "SKIP";
  }
}

function severityFromStatus(status: CheckResult["status"] | undefined, problems: string[]): ValidationSeverity {
  if (status === "WARN") return "warn";
  if (status === "FAIL") return "fail";
  if (status === "SKIP") return "skip";
  if (status === "PASS") return "pass";
  return problems.length > 0 ? "fail" : "pass";
}

function normalizeCheckResult(result: CheckResult): CheckResult {
  const problems = [...(result.problems ?? [])];
  let severity = result.severity ?? severityFromStatus(result.status, problems);
  let status = result.status ?? statusFromSeverity(severity);
  if (severity === "skip" && problems.length > 0) {
    severity = "fail";
    status = "FAIL";
    problems.unshift(`internal validator error: check "${result.name}" was marked SKIP but found ${problems.length} problem(s)`);
  } else if (severity === "pass" && problems.length > 0) {
    severity = "fail";
    status = "FAIL";
    problems.unshift(`internal validator error: check "${result.name}" was marked PASS but found ${problems.length} problem(s)`);
  } else {
    status = statusFromSeverity(severity);
  }
  return {
    ...result,
    status,
    severity,
    problems,
    acceptanceBlocking: severity === "fail" ? true : Boolean(result.acceptanceBlocking),
  };
}

export function validationAccepted(results: CheckResult[]): boolean {
  return results.map(normalizeCheckResult).every((result) => {
    if (result.severity === "fail") return false;
    if (result.severity === "warn" && result.acceptanceBlocking) return false;
    if (result.severity === "skip" && result.problems.length > 0) return false;
    return true;
  });
}

export function runChecks(gardenDir: string, gardenSlug: string): CheckResult[] {
  if (!fs.existsSync(gardenDir)) {
    return [{ id: 0, name: "garden exists", status: "FAIL", problems: [`No such garden: ${gardenDir}`] }];
  }

  const pages: PageFile[] = [];
  walkMarkdown(gardenDir, "", pages);
  const published = pages.filter((page) => page.published);
  const lessonPages = published.filter((page) => {
    const kt = fmString(page.frontmatter, "knowledge_type");
    const bt = fmString(page.frontmatter, "breadboardType");
    const isLesson =
      kt === "learning-page" || kt === "textbook-page" ||
      bt === "learning_page" || bt === "textbook_page";
    const learnAuthored =
      fmString(page.frontmatter, "generated_by") === "learn_button" ||
      fmString(page.frontmatter, "generatedBy") === "learn_button";
    return isLesson && learnAuthored;
  });

  const results: CheckResult[] = [];
  const check = (
    id: number,
    name: string,
    problems: string[],
    skip = false,
    options: { severity?: ValidationSeverity; reason?: string; acceptanceBlocking?: boolean } = {},
  ) => {
    let severity: ValidationSeverity;
    if (skip) severity = "skip";
    else if (options.severity) severity = options.severity;
    else severity = problems.length === 0 ? "pass" : "fail";
    results.push(normalizeCheckResult({
      id,
      name,
      status: statusFromSeverity(severity),
      severity,
      problems,
      reason: options.reason ?? (skip ? "not applicable" : undefined),
      acceptanceBlocking: options.acceptanceBlocking,
    }));
  };

  // Ledger.
  const ledgerPath = path.join(gardenDir, ".breadboard", "source-visuals.json");
  let ledger: Array<Record<string, unknown>> = [];
  let ledgerExists = false;
  try {
    const parsed = JSON.parse(fs.readFileSync(ledgerPath, "utf-8"));
    if (Array.isArray(parsed)) {
      ledger = parsed;
      ledgerExists = true;
    }
  } catch {
    ledgerExists = false;
  }
  const realFigures = ledger.filter((v) => String(v.type ?? "") !== "full_page_fallback");
  const learningUnitContract = readLearningUnitContract(gardenDir);
  const learningUnits = learningUnitContract.units;
  const contractAssignments = learningUnitContract.assignments;
  const learningUnitsById = new Map(learningUnits.map((unit) => [unit.id, unit]));

  // Is this a visual-rich garden? A source note carries page snapshots and
  // references figures/tables.
  const sourceNotes = pages.filter(
    (page) => fmString(page.frontmatter, "knowledge_type") === "source-document",
  );
  const visualRich = sourceNotes.some((note) => {
    const hasImages = fmArray(note.frontmatter, "source_images").length > 0;
    const mentions = /\b(?:Fig\.|Figure|Table)\s*\d+/i.test(note.body) ||
      /\b(?:graph|chart|diagram|architecture|curve|comparison)\b/i.test(note.body);
    return hasImages && mentions;
  });

  // Is this an SNN garden? (enables SNN-specific thresholds)
  const gardenText = [gardenSlug, ...lessonPages.map((p) => `${fmString(p.frontmatter, "title")} ${p.body}`)]
    .join("\n")
    .toLowerCase();
  const isSnnGarden = /\bspiking neural network|\bsnn\b|leaky integrate/.test(gardenText);

  // 1. No "textbook" anywhere learner-facing.
  {
    const problems: string[] = [];
    for (const page of published) {
      // Raw uploaded sources are grounding material, not pipeline-generated
      // branding: their body may legitimately use the word (e.g. an academic
      // paper). Only the Learn pipeline's own output is held to this rule.
      const kt = fmString(page.frontmatter, "knowledge_type");
      const bt = fmString(page.frontmatter, "breadboardType");
      if (kt === "source-document" || bt === "source_document") continue;
      const surfaces: Array<[string, string]> = [
        ["path", page.relPath],
        ["title", fmString(page.frontmatter, "title")],
        ["version", fmString(page.frontmatter, "learningVersion") + " " + fmString(page.frontmatter, "learningVersionId")],
        ["tags", fmArray(page.frontmatter, "tags").join(" ")],
        ["body", page.body],
      ];
      for (const [surface, text] of surfaces) {
        if (/textbook/i.test(text)) {
          problems.push(`${page.relPath} (${surface})`);
          break;
        }
      }
    }
    check(1, 'no "textbook" in visible output', problems);
  }

  // 2. Learner prose teaches directly — no source-commentary phrasing, clean titles.
  {
    const problems: string[] = [];
    for (const page of lessonPages) {
      const prose = teachingProse(page.body);
      let count = 0;
      for (const pattern of SOURCE_COMMENTARY_PATTERNS) count += countPattern(prose, pattern);
      if (count > 0) problems.push(`${page.relPath}: ${count} source-commentary phrase(s) in teaching prose`);
      const title = fmString(page.frontmatter, "title");
      if (/\b(paper|source|textbook|evidence)\b/i.test(title)) {
        problems.push(`${page.relPath}: title reads as source commentary ("${title}")`);
      }
    }
    check(2, "learner prose teaches directly (no source commentary)", problems, lessonPages.length === 0);
  }

  // 3. No fallback-template / scaffold prose in learner pages.
  {
    const problems: string[] = [];
    for (const page of lessonPages) {
      const hit = FALLBACK_FINGERPRINTS.find((pattern) => pattern.test(page.body));
      if (hit) problems.push(`${page.relPath}: matches ${hit}`);
      if (hasEmptyBulletScaffold(page.body)) {
        problems.push(`${page.relPath}: contains empty/placeholder bullet scaffolds`);
      }
    }
    check(3, "no fallback-template prose in learner pages", problems, lessonPages.length === 0);
  }

  // 4. No bibliography/reference-list chunks used as teaching content.
  {
    const problems = lessonPages
      .filter((page) => RAW_REFERENCE_DUMP_RE.test(page.body))
      .map((page) => page.relPath);
    check(4, "no raw reference-list dumps in learner pages", problems, lessonPages.length === 0);
  }

  // 5. Every learner subsection is at least 700 words.
  {
    const problems: string[] = [];
    for (const page of lessonPages) {
      const words = proseWordCount(page.body);
      if (words < MIN_LESSON_WORDS) problems.push(`${page.relPath}: ${words} words (< ${MIN_LESSON_WORDS})`);
    }
    check(5, "learner subsections are fully written (>= 700 words)", problems, lessonPages.length === 0);
  }

  // 6. Every learner subsection has a concrete example and a Q&A pair.
  {
    const problems: string[] = [];
    for (const page of lessonPages) {
      if (!/\b(for example|for instance|imagine|consider|suppose|think of|picture)\b/i.test(page.body)) {
        problems.push(`${page.relPath}: no concrete example / analogy cue`);
      }
      if (!(/\*\*Question\.\*\*/.test(page.body) && /\*\*Answer\.\*\*/.test(page.body))) {
        problems.push(`${page.relPath}: missing **Question.** / **Answer.** pair`);
      }
    }
    check(6, "learner subsections have an example and a Q&A pair", problems, lessonPages.length === 0);
  }

  // 7. Strict exported filesystem: only _index.md, learning/, sources/,
  //    assets/, and .breadboard/ may exist at the root. Sources publish under
  //    a visible sources/ folder and are allowed.
  {
    const problems: string[] = [];
    const allowedTopLevel = new Set(["_index.md", "learning", "sources", "assets", ".breadboard"]);
    try {
      for (const entry of fs.readdirSync(gardenDir, { withFileTypes: true })) {
        if (!allowedTopLevel.has(entry.name)) {
          problems.push(`top-level entry is not exportable: ${entry.name}${entry.isDirectory() ? "/" : ""}`);
        }
        if (entry.name === "Learning") problems.push("uppercase Learning/ folder is not allowed; export must use learning/");
        if (entry.name === "Internal") problems.push("Internal/ folder is not allowed in the exported garden root");
        if (entry.isDirectory() && /^\d+\.\s+/.test(entry.name)) {
          problems.push(`root-level numbered source-conversion folder is not allowed: ${entry.name}/`);
        }
      }
    } catch (error) {
      problems.push(`cannot read garden root: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!fs.existsSync(path.join(gardenDir, "sources", "_index.md"))) {
      problems.push("sources/_index.md missing");
    }
    for (const page of published) {
      const rel = page.relPath;
      const lower = rel.toLowerCase();
      if (/(^|\/)internal\//i.test(rel)) problems.push(`internal folder visible: ${rel}`);
      if (/(^|\/)\d+\.\s*source-snapshots\//i.test(rel)) problems.push(`snapshot folder visible: ${rel}`);
      if (lower.endsWith("learning/source map.md") || lower.endsWith("learning/scope contract.md") ||
          lower.endsWith("learning/source coverage.md")) {
        problems.push(`planning artifact visible: ${rel}`);
      }
      if (rel.startsWith("Learning/")) problems.push(`uppercase Learning/ page path is not allowed: ${rel}`);
      // Top-level content outside _index.md, learning/, sources/, assets/.
      const top = rel.split("/")[0];
      if (rel !== "_index.md" && top !== "learning" && top !== "sources" && top !== "assets") {
        problems.push(`top-level page outside learning/: ${rel}`);
      }
    }
    // Numbered folder named after the raw upload.
    const sourceFileBases = new Set(
      pages
        .map((page) => fmString(page.frontmatter, "source_file"))
        .filter(Boolean)
        .map((file) => slugifyLoose(file.replace(/\.(pdf|docx?|pptx?|xlsx?|txt|md|csv|zip)$/i, ""))),
    );
    for (const page of published) {
      const top = page.relPath.split("/")[0];
      const numbered = top.match(/^\d+\.\s*(.+)$/);
      if (numbered && sourceFileBases.has(slugifyLoose(numbered[1]))) {
        problems.push(`folder named after raw upload: ${top}/`);
      }
    }
    check(7, "exported tree is only _index.md, learning/, sources/, assets/, .breadboard/", [...new Set(problems)]);
  }

  // 8. Learner lesson pages carry exactly the Learning Unit Contract's
  //    zettel handles; no fallback/source/topic tags and no conceptTags.
  {
    const problems: string[] = [];
    const tagCounts = new Map<string, number>();
    const knownContractHandles = new Set(learningUnits.flatMap((unit) => zettelHandlesForUnit(unit)));
    for (const page of lessonPages) {
      if (fmArray(page.frontmatter, "conceptTags").length > 0 || "conceptTags" in page.frontmatter) {
        problems.push(`${page.relPath}: has conceptTags (banned on learner pages)`);
      }
      const tags = fmArray(page.frontmatter, "tags");
      for (const tag of tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      const unitId = fmString(page.frontmatter, "learningUnitId");
      const unit = unitId ? learningUnitsById.get(unitId) : undefined;
      if (unit) {
        const expected = zettelHandlesForUnit(unit);
        const missing = expected.filter((tag) => !tags.includes(tag));
        const extra = tags.filter((tag) => !expected.includes(tag));
        if (expected.length === 0) problems.push(`${page.relPath}: learning unit ${unit.id} has no contract zettel handles`);
        if (missing.length > 0 || extra.length > 0) {
          problems.push(
            `${page.relPath}: tags must equal Learning Unit Contract handles for ${unit.id}; missing [${missing.join(", ")}], extra [${extra.join(", ")}]`,
          );
        }
      } else if (learningUnits.length > 0) {
        problems.push(`${page.relPath}: cannot verify tags because learningUnitId is missing or unknown`);
      } else if (tags.length < 1) {
        problems.push(`${page.relPath}: no tags and no Learning Unit Contract available`);
      }
      const haystack = `${fmString(page.frontmatter, "title")}\n${teachingProse(page.body)}`.toLowerCase();
      const titleSlug = slugifyLoose(fmString(page.frontmatter, "title").replace(/^\d+(?:\.\d+)*\.?\s*/, ""));
      for (const tag of tags) {
        if (learningUnits.length > 0 && !knownContractHandles.has(tag)) {
          problems.push(`${page.relPath}: tag "${tag}" is not present in the Learning Unit Contract`);
        }
        if (!isAtomicZettelHandle(tag)) {
          problems.push(`${page.relPath}: tag "${tag}" is not an atomic lower-kebab-case Zettelkasten handle`);
          continue;
        }
        if (tag.includes("/")) {
          problems.push(`${page.relPath}: tag "${tag}" uses slash-category structure`);
        }
        if (tag === titleSlug) {
          problems.push(`${page.relPath}: tag "${tag}" copies the page title slug`);
        }
        if (/\.(pdf|docx?|pptx?|xlsx?|txt|md|csv|zip)$/i.test(tag) || /\d{4,5}-\d{3,}/.test(tag)) {
          problems.push(`${page.relPath}: tag "${tag}" looks like a source filename/id`);
        }
        const words = tag.split("-").filter(Boolean);
        const leaf = tag;
        if (BANNED_TAG_SEGMENTS.has(tag.toLowerCase()) || words.every((word) => BANNED_TAG_SEGMENTS.has(word.toLowerCase()))) {
          problems.push(`${page.relPath}: tag "${tag}" contains a banned generic segment`);
        }
        if (!leaf.includes("-") && BANNED_TAG_SEGMENTS.has(leaf.toLowerCase())) {
          problems.push(`${page.relPath}: tag "${tag}" has a broad one-word leaf`);
        }
        if (/^sn-/.test(tag)) problems.push(`${page.relPath}: tag "${tag}" uses typo root "sn"`);
        for (const rule of TAG_RELEVANCE_RULES) {
          if (!rule.appliesTo.test(tag)) continue;
          const bodyHits = countPattern(teachingProse(page.body), rule.evidence);
          const titleHit = rule.evidence.test(fmString(page.frontmatter, "title"));
          if (!titleHit && bodyHits < (rule.minBody ?? 1)) {
            problems.push(`${page.relPath}: tag "${tag}" is not supported by the page content`);
          }
        }
      }
    }
    if (lessonPages.length >= 4) {
      const maxAllowed = Math.ceil(lessonPages.length * 0.4);
      for (const [tag, count] of tagCounts) {
        if (count > maxAllowed) problems.push(`tag "${tag}" appears on ${count}/${lessonPages.length} learner pages (too broad/reused)`);
      }
    }
    check(8, "learner tags exactly match Learning Unit Contract zettel handles", problems, lessonPages.length === 0);
  }

  // 9. Internal/source/planning pages carry no public tags.
  {
    const problems: string[] = [];
    for (const page of pages) {
      const knowledgeType = fmString(page.frontmatter, "knowledge_type");
      const internalByType = NO_TAG_KNOWLEDGE_TYPES.has(knowledgeType);
      const internalByPath = /(^|\/)(sources|internal)\//i.test(page.relPath) ||
        fmString(page.frontmatter, "internal") === "true";
      if (!internalByType && !internalByPath) continue;
      const tags = fmArray(page.frontmatter, "tags");
      if (tags.length > 0) problems.push(`${page.relPath}: has tags [${tags.join(", ")}]`);
    }
    check(9, "internal/source/planning pages have no public tags", problems);
  }

  // 10. Visual-rich source ⇒ non-empty ledger with real figures; learner pages embed them.
  {
    const problems: string[] = [];
    if (visualRich) {
      if (!ledgerExists || ledger.length === 0) {
        problems.push(".breadboard/source-visuals.json is empty for a visual-rich garden");
      } else if (realFigures.length === 0) {
        problems.push("ledger has only full-page fallbacks — no figures/tables were extracted");
      }
      const anyImageEmbed = lessonPages.some((page) => /!\[[^\]]*\]\([^)]*source-visuals[^)]*\)/i.test(page.body));
      if (lessonPages.length > 0 && !anyImageEmbed) {
        problems.push("no learner page embeds any cropped source figure");
      }
    }
    check(10, "visual-rich source produces embedded figures", problems, !visualRich);
  }

  // 11. Every extracted source visual is assigned or intentionally skipped, and
  //     assigned visuals really appear in their pages.
  {
    const problems: string[] = [];
    if (!ledgerExists && lessonPages.length > 0 && visualRich) {
      problems.push(".breadboard/source-visuals.json missing (Stage 2 never ran)");
    }
    const pageByRel = new Map(pages.map((page) => [page.relPath.replace(/\.md$/i, ""), page]));
    for (const visual of ledger) {
      const status = String(visual.usageStatus ?? "");
      if (status !== "assigned" && status !== "intentionally_skipped") {
        problems.push(`${String(visual.sourceVisualId)}: usageStatus "${status || "missing"}"`);
      }
      if (status === "intentionally_skipped" && !String(visual.skipReason ?? "").trim()) {
        problems.push(`${String(visual.sourceVisualId)}: skipped without a reason`);
      }
      if (status === "assigned") {
        const conceptUsage = String(visual.conceptUsage ?? "");
        const cropStatus = String(visual.cropStatus ?? "");
        const textFormulaFallback = isFormulaVisual(visual) && conceptUsage === "explained_as_text_formula" && cropStatus === "omitted_unreliable";
        const page = pageByRel.get(String(visual.assignedPageId ?? ""));
        const url = String(visual.croppedImagePath ?? visual.pageImagePath ?? "");
        if (textFormulaFallback) {
          continue;
        } else if (!page) {
          problems.push(`${String(visual.sourceVisualId)}: assigned page "${String(visual.assignedPageId)}" not found`);
        } else if (!url || !page.body.includes(url)) {
          problems.push(`${String(visual.sourceVisualId)}: image not embedded in its page`);
        }
      }
    }
    check(11, "source visuals assigned/skipped and embedded", problems, !ledgerExists);
  }

  // 12. Full-page screenshots are never counted as figures.
  {
    const problems: string[] = [];
    const pageSnapshotRe = /-page-\d{2,}(?:-\d+)?\.(?:png|jpe?g|webp)$/i;
    for (const visual of ledger) {
      const type = String(visual.type ?? "");
      const cropped = String(visual.croppedImagePath ?? "");
      if (type === "full_page_fallback") continue;
      if (isFormulaVisual(visual) && String(visual.conceptUsage ?? "") === "explained_as_text_formula" && String(visual.cropStatus ?? "") === "omitted_unreliable") {
        continue;
      }
      if (cropped && pageSnapshotRe.test(cropped)) {
        problems.push(`${String(visual.sourceVisualId)}: full-page snapshot used as ${type}`);
      }
      if (!cropped && String(visual.usageStatus) === "assigned") {
        problems.push(`${String(visual.sourceVisualId)}: assigned as ${type} but embeds the uncropped page`);
      }
    }
    check(12, "full-page snapshots only used as explicit fallbacks", problems, !ledgerExists);
  }

  // Run-level accumulators shared with the stale-index check (#18).
  const embeddedVisualIds = new Set<string>();
  const embeddedVisualSpecs: Array<{ page: PageFile; spec: Record<string, unknown> }> = [];
  let visualIndexKeys: string[] = [];

  // 13 + 14. Interactive visual consistency, content, and hard-concept coverage.
  {
    const idProblems: string[] = [];
    const contentProblems: string[] = [];
    const visualsDir = path.join(gardenDir, ".breadboard", "visuals");
    let index: Record<string, unknown> = {};
    try {
      index = JSON.parse(fs.readFileSync(path.join(gardenDir, ".breadboard", "visual-index.json"), "utf-8"));
    } catch {
      index = {};
    }
    visualIndexKeys = Object.keys(index);

    let interactiveCount = 0;
    const blockRe = /```breadboard-visual\r?\n([\s\S]*?)\r?\n```/g;
    for (const page of published) {
      const declared = fmArray(page.frontmatter, "visualIds");
      const embedded: string[] = [];
      let match: RegExpExecArray | null;
      const re = new RegExp(blockRe.source, blockRe.flags);
      while ((match = re.exec(page.body)) !== null) {
        let spec: Record<string, unknown> | null = null;
        try {
          spec = JSON.parse(match[1]);
        } catch {
          spec = null;
        }
        if (!spec || typeof spec.id !== "string") {
          contentProblems.push(`${page.relPath}: embedded visual block is not valid JSON with an id`);
          continue;
        }
        embedded.push(spec.id);
        embeddedVisualSpecs.push({ page, spec });
        embeddedVisualIds.add(spec.id);
        interactiveCount += 1;
        const type = String(spec.type ?? "");
        if (!INTERACTIVE_VISUAL_TYPES.has(type)) {
          contentProblems.push(`${page.relPath}: visual ${spec.id} has non-interactive type "${type}"`);
        }
        const props = spec.props;
        const propsEmpty =
          !props || typeof props !== "object" ||
          Object.keys(props as Record<string, unknown>).length === 0 ||
          Object.entries(props as Record<string, unknown>).every(
            ([, value]) => Array.isArray(value) && value.length === 0,
          );
        if (propsEmpty) contentProblems.push(`${page.relPath}: visual ${spec.id} has empty props`);
        if (!String(spec.regenerationPrompt ?? "").trim()) {
          contentProblems.push(`${page.relPath}: visual ${spec.id} lacks regenerationPrompt`);
        }
        if (!fs.existsSync(path.join(visualsDir, `${spec.id}.json`))) {
          idProblems.push(`${page.relPath}: visual ${spec.id} has no .breadboard/visuals/${spec.id}.json`);
        }
        if (!(spec.id in index)) {
          idProblems.push(`${page.relPath}: visual ${spec.id} missing from visual-index.json`);
        }
      }
      const declaredSet = new Set(declared);
      const embeddedSet = new Set(embedded);
      for (const id of declaredSet) {
        if (!embeddedSet.has(id)) idProblems.push(`${page.relPath}: frontmatter visualId ${id} has no embedded block`);
      }
      for (const id of embeddedSet) {
        if (!declaredSet.has(id)) idProblems.push(`${page.relPath}: embedded visual ${id} missing from frontmatter visualIds`);
      }
      if (/\[(?:Interactive visual|Visual|Generated visual)\s*:/i.test(page.body)) {
        contentProblems.push(`${page.relPath}: raw visual placeholder left in body`);
      }
    }

    check(13, "interactive visual IDs consistent (frontmatter = block = spec file = index)", idProblems);
    check(14, "interactive visuals are valid when present", contentProblems);

    // 15. Regenerate button rendered by the Quartz component for every block.
    const rendererPath = path.resolve(
      SCRIPT_DIR, "..", "quartz", "quartz", "components", "scripts", "breadboardVisual.inline.ts",
    );
    const rendererProblems: string[] = [];
    try {
      const renderer = fs.readFileSync(rendererPath, "utf-8");
      if (!renderer.includes("bv-regenerate")) {
        rendererProblems.push("Quartz renderer no longer renders the regenerate button (bv-regenerate)");
      }
    } catch {
      rendererProblems.push(`Cannot read renderer at ${rendererPath}`);
    }
    check(15, "regenerate button rendered below every interactive visual", rendererProblems);

    // 16. Interactive visuals are optional, but duplicate signatures are not.
    {
      const problems: string[] = [];
      const bySignature = new Map<string, string[]>();
      for (const { page, spec } of embeddedVisualSpecs) {
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
        const anchors = visualAnchorIds(spec).sort();
        const concepts = Array.isArray(spec.conceptTargets)
          ? spec.conceptTargets.map((item) => String(item).toLowerCase()).sort()
          : [];
        const inputs = Array.isArray(spec.inputs)
          ? spec.inputs.map((item) => String(item).toLowerCase()).sort()
          : [];
        const outputs = Array.isArray(spec.outputs)
          ? spec.outputs.map((item) => String(item).toLowerCase()).sort()
          : [];
        const key = [
          String(spec.type ?? "").toLowerCase(),
          controls.join("|"),
          inputs.join("|"),
          outputs.join("|"),
          anchors.join("|"),
          concepts.join("|"),
          String(spec.pedagogicalPurpose ?? spec.caption ?? "").toLowerCase().replace(/\s+/g, " ").trim(),
        ].join("::");
        const pagesForKey = bySignature.get(key) ?? [];
        pagesForKey.push(`${page.relPath}:${String(spec.id ?? "")}`);
        bySignature.set(key, pagesForKey);
      }
      for (const [signature, pagesForKey] of bySignature) {
        if (pagesForKey.length > 1) {
          problems.push(`duplicate interactive visual signature "${signature}" on ${pagesForKey.join(", ")}`);
        }
      }
      check(16, "final interactive visual signatures are unique", problems, embeddedVisualSpecs.length === 0);
    }
  }

  // 17. Every internal wikilink resolves to a real page (or a real heading).
  {
    const problems = validateInternalWikilinks(pages, published);
    check(17, "internal wikilinks resolve to existing pages/headings", problems);
  }

  // 18. No stale visual-index entries: every id in visual-index.json must be
  //     embedded by some current page. Stale entries from earlier runs mean the
  //     post-generation prune did not run.
  {
    const problems: string[] = [];
    for (const id of visualIndexKeys) {
      if (!embeddedVisualIds.has(id)) {
        problems.push(`visual-index.json lists "${id}" but no current page embeds it (stale)`);
      }
    }
    check(18, "visual index only lists visuals referenced by current pages", problems, visualIndexKeys.length === 0);
  }

  // 19. Quartz/KaTeX math is normalized and renderable. Source documents are
  //     included: raw converted sources still ship through Quartz.
  {
    const problems: string[] = [];
    for (const page of published) {
      const bodyNoCode = withoutCodeFences(page.body);
      if (/\\\(|\\\[/.test(bodyNoCode)) {
        problems.push(`${page.relPath}: raw \\(...\\) or \\[...\\] math delimiter remains`);
      }
      for (const expr of extractQuartzMath(page.body)) {
        if (/\\tag\{[^}]+\}/.test(expr.formula)) {
          problems.push(`${page.relPath}:${expr.line}: KaTeX-hostile \\tag{} remains in formula "${expr.excerpt}"`);
        }
        try {
          katex.renderToString(expr.formula, {
            displayMode: expr.display,
            throwOnError: true,
            strict: "warn",
          });
        } catch (error) {
          problems.push(
            `${page.relPath}:${expr.line}: KaTeX cannot render "${expr.excerpt}" (${error instanceof Error ? error.message : String(error)})`,
          );
        }
      }
    }
    check(19, "Quartz math delimiters are normalized and KaTeX-renderable", problems);
  }

  // 20. Root index is a live learning path, not stale source-conversion pages.
  {
    const problems: string[] = [];
    const rootPage = pages.find((page) => page.relPath === "_index.md");
    if (!rootPage) {
      problems.push("_index.md missing");
    } else {
      if (!/^##\s+Learning\s*$/im.test(rootPage.body)) {
        problems.push("_index.md missing ## Learning section");
      }
      if (!/\[\[learning\/Topic Overview\|Topic Overview\]\]/.test(rootPage.body)) {
        problems.push("_index.md missing [[learning/Topic Overview|Topic Overview]]");
      }
      if (!/^##\s+Sources\s*$/im.test(rootPage.body)) {
        problems.push("_index.md missing ## Sources section");
      }
      if (!/\[\[sources\/_index\|Sources\]\]/.test(rootPage.body)) {
        problems.push("_index.md missing [[sources/_index|Sources]]");
      }
      const reading = sectionBody(rootPage.body, "Reading Path");
      if (lessonPages.length > 0 && !reading.trim()) {
        problems.push("_index.md has no ## Reading Path section");
      }
      if (lessonPages.length > 0 && /No lessons yet/i.test(reading)) {
        problems.push("_index.md says \"No lessons yet\" even though learner pages exist");
      }
      const linkedTargets: string[] = [];
      const numberedLinkLines = reading
        .split(/\r?\n/)
        .filter((line) => /\[\[/.test(line))
        .filter((line) => /^\s*\d+\.\s+\[\[/.test(line));
      let match: RegExpExecArray | null;
      const re = new RegExp(WIKILINK_RE.source, WIKILINK_RE.flags);
      while ((match = re.exec(reading)) !== null) {
        const inner = match[2];
        const rawTarget = (inner.includes("|") ? inner.slice(0, inner.indexOf("|")) : inner).trim();
        const base = rawTarget.split("#")[0].replace(/^\//, "").replace(/\.md$/i, "");
        if (!base) continue;
        linkedTargets.push(base);
        if (!base.startsWith("learning/")) {
          problems.push(`_index.md Reading Path links outside learning/: [[${rawTarget}]]`);
        }
        if (/^sources\//i.test(base) || /2510-27379|future-of-brain-inspired-computing/i.test(base)) {
          problems.push(`_index.md Reading Path contains stale source-conversion target: [[${rawTarget}]]`);
        }
      }
      if (lessonPages.length > 0 && numberedLinkLines.length !== linkedTargets.length) {
        problems.push("_index.md Reading Path must use numbered links (1. [[...]])");
      }
      if (lessonPages.length > 0 && linkedTargets.length !== lessonPages.length) {
        problems.push(`_index.md Reading Path links ${linkedTargets.length} lesson(s), but ${lessonPages.length} learn-authored lesson page(s) exist`);
      }
    }
    for (const page of pages) {
      const kt = fmString(page.frontmatter, "knowledge_type");
      const bt = fmString(page.frontmatter, "breadboardType") || fmString(page.frontmatter, "breadboard_type");
      const isLesson =
        kt === "learning-page" || kt === "textbook-page" ||
        bt === "learning_page" || bt === "textbook_page";
      if (!isLesson) continue;
      if (fmString(page.frontmatter, "internal") === "true") {
        problems.push(`${page.relPath}: internal:true page is still typed as a learning page`);
      }
      const top = page.relPath.split("/")[0];
      if (page.relPath !== "_index.md" && top !== "learning") {
        problems.push(`${page.relPath}: learning page exists outside learning/`);
      }
    }
    check(20, "root index exposes live learning/sources navigation", [...new Set(problems)]);
  }

  // 21. Source Map must not contradict extracted anchors.
  {
    const problems: string[] = [];
    const formulaVisuals = ledger.filter(isFormulaVisual);
    const tableVisuals = ledger.filter((visual) => String(visual.type ?? "") === "table" || /^S\d+\.P\d+\.T\d+$/i.test(String(visual.sourceVisualId ?? "")));
    const figureVisuals = realFigures.filter((visual) => !isFormulaVisual(visual) && String(visual.type ?? "") !== "table");
    const sourceDocs: PageFile[] = [];
    walkMarkdown(path.join(gardenDir, "sources"), "sources", sourceDocs);
    const laterTextExists = sourceDocs.some((page) => /^#{1,3}\s*Page\s+(?:[3-9]|\d{2,})\b/im.test(page.body));
    const laterPagesExist = laterTextExists || realFigures.some((visual) => Number(visual.page ?? visual.pageNumber ?? 0) > 2);
    if (formulaVisuals.length > 0 || tableVisuals.length > 0 || figureVisuals.length > 0 || laterPagesExist) {
      const sourceMap = readIfExists(path.join(gardenDir, ".breadboard", "planning", "Source Map.md"));
      if (!sourceMap) {
        problems.push(".breadboard/planning/Source Map.md missing despite extracted anchors");
      } else {
        if (/explicit mathematical definitions are not present|formulas? (?:are|is) not present|caption-only/i.test(sourceMap)) {
          problems.push("Source Map says formulas are absent/caption-only even though formula anchors exist");
        }
        if (tableVisuals.length > 0 && /tables? (?:are|is) not (?:present|available|detected)/i.test(sourceMap)) {
          problems.push("Source Map says tables are absent even though table anchors exist");
        }
        if (figureVisuals.length > 0 && /figures? (?:are|is) not (?:present|available|detected)/i.test(sourceMap)) {
          problems.push("Source Map says figures are absent even though figure anchors exist");
        }
        if (laterPagesExist && /only pages?\s*1\s*[-–]\s*2\s+(?:are|is)\s+(?:available|present)|truncated after page\s*2|source map is truncated|later (?:page|pages|section|sections)[^.\n]*(?:not available|unavailable|captions?|anchored to captions)/i.test(sourceMap)) {
          problems.push("Source Map contains stale caveats about later source pages");
        }
        if (formulaVisuals.length > 0 && !/Formula Coverage|explicit metric formulas|formula anchors? (?:are )?present/i.test(sourceMap)) {
          problems.push("Source Map does not explicitly acknowledge formula coverage");
        }
      }
    }
    check(21, "Source Map is consistent with extracted anchors", problems, formulaVisuals.length === 0 && tableVisuals.length === 0 && figureVisuals.length === 0 && !laterPagesExist);
  }

  // 22. Source Coverage must be derived from contract assignments, not metric
  //     title heuristics.
  {
    const problems: string[] = [];
    const formulaVisuals = ledger.filter(isFormulaVisual);
    const requiresCoverage = formulaVisuals.length > 0 || contractAssignments.length > 0 || realFigures.length > 0;
    if (requiresCoverage) {
      const coverage = readIfExists(path.join(gardenDir, ".breadboard", "planning", "Source Coverage.md"));
      if (!coverage) {
        problems.push(".breadboard/planning/Source Coverage.md missing despite source anchors or contract assignments");
      } else {
        if (/central to\s+\[\[/i.test(coverage)) {
          problems.push("Source Coverage still uses heuristic 'central to [[page]]' formula assignments");
        }
        problems.push(...sourceCoverageModePrecisionProblems(gardenDir, ledger));
        for (const visual of formulaVisuals) {
          const id = String(visual.sourceVisualId ?? "");
          if (!id) continue;
          const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const assignments = contractAssignments.filter((assignment) => assignment.sourceArtifactId === id);
          if (assignments.length === 0) continue;
          for (const assignment of assignments) {
            const lineRe = new RegExp(`${escaped}[^\\n]*assigned to ${assignment.assignedLearningUnitId}\\b`, "i");
            if (!lineRe.test(coverage)) {
              problems.push(`${id}: Source Coverage does not assign formula to contract unit ${assignment.assignedLearningUnitId}`);
            }
          }
          const lines = coverage.split(/\r?\n/).filter((line) => line.includes(id));
          for (const line of lines) {
            const unitMatches = [...line.matchAll(/\bU\d+[A-Za-z0-9_.-]*\b/g)].map((match) => match[0]);
            for (const unitId of unitMatches) {
              if (!assignments.some((assignment) => assignment.assignedLearningUnitId === unitId)) {
                problems.push(`${id}: Source Coverage line conflicts with contract by mentioning ${unitId}: ${line}`);
              }
            }
          }
        }
      }
    }
    check(22, "Source Coverage follows Learning Unit Contract assignments and usage modes", problems, !requiresCoverage);
  }

  // 23. Embedded interactive visuals must be grounded, page-specific, and not
  //     generic mismatches.
  {
    const problems: string[] = [];
    const specsByUnit = new Map<string, Array<{ page: PageFile; spec: Record<string, unknown> }>>();
    const visualsDir = path.join(gardenDir, ".breadboard", "visuals");
    try {
      for (const file of fs.readdirSync(visualsDir).filter((name) => name.endsWith(".json"))) {
        const id = file.replace(/\.json$/i, "");
        if (!embeddedVisualIds.has(id)) problems.push(`.breadboard/visuals/${file}: spec file is orphaned (not embedded by any page)`);
      }
    } catch {
      // A garden with no visuals may have no directory; existing checks cover missing specs for embedded blocks.
    }

    for (const { page, spec } of embeddedVisualSpecs) {
      const id = String(spec.id ?? "(missing id)");
      const type = String(spec.type ?? "");
      const anchors = Array.isArray(spec.sourceAnchors) ? spec.sourceAnchors : [];
      const grounding = String(spec.sourceGroundingStatus ?? "");
      const justification = String(spec.justification ?? "").trim();
      if (anchors.length === 0 && !(grounding === "conceptual-no-direct-source-figure" && justification)) {
        problems.push(`${page.relPath}: visual ${id} has no sourceAnchors and no conceptual grounding justification`);
      }
      for (const field of ["pagePath", "learningGoal", "regenerationPrompt"]) {
        if (!String(spec[field] ?? "").trim()) problems.push(`${page.relPath}: visual ${id} lacks ${field}`);
      }
      for (const field of ["inputs", "outputs"]) {
        if (!Array.isArray(spec[field]) || (spec[field] as unknown[]).length === 0) {
          problems.push(`${page.relPath}: visual ${id} lacks ${field}`);
        }
      }
      const anchorIds = visualAnchorIds(spec);
      if (anchorIds.length > 0) {
        const idsOnPage = pageSourceIds(page);
        if (!anchorIds.some((anchorId) => idsOnPage.has(anchorId))) {
          problems.push(`${page.relPath}: visual ${id} sourceAnchors [${anchorIds.join(", ")}] do not overlap page sourceAnchors/sourceVisualIds`);
        }
      }
      const unitId = fmString(page.frontmatter, "learningUnitId");
      const unit = unitId ? learningUnitsById.get(unitId) : undefined;
      if (unitId) {
        const list = specsByUnit.get(unitId) ?? [];
        list.push({ page, spec });
        specsByUnit.set(unitId, list);
      }
      if (unit) {
        if (!unit.interactiveVisual) {
          problems.push(`${page.relPath}: embeds visual ${id}, but learning unit ${unit.id} has no interactiveVisual contract`);
        } else {
          if (String(unit.interactiveVisual.visualType ?? "").toLowerCase() !== type.toLowerCase()) {
            problems.push(
              `${page.relPath}: visual ${id} type ${type} does not match learning unit ${unit.id} contract type ${unit.interactiveVisual.visualType}`,
            );
          }
          const compat = visualTypeCompatibleWithUnit(type, unit);
          if (!compat.ok) problems.push(`${page.relPath}: visual ${id} incompatible with unit ${unit.id}: ${compat.reason}`);
        }
      }
      const pageText = `${page.relPath} ${fmString(page.frontmatter, "title")}`.toLowerCase();
      if (/open challenges|unresolved|limitations|future work/.test(pageText)) {
        problems.push(`${page.relPath}: open-challenges page embeds visual ${id}; no generic interactive visual should be forced here`);
      }
      const anchorText = JSON.stringify(anchors).toLowerCase();
      const specText = `${pageText} ${anchorText} ${String(spec.regenerationPrompt ?? "").toLowerCase()}`;
      if (type === "lif_neuron") {
        if (!/lif|leaky|membrane|threshold|what spiking neural networks are/.test(specText)) {
          problems.push(`${page.relPath}: lif_neuron visual is not tied to a LIF/membrane/threshold objective`);
        }
        if (/training loss|accuracy|latency|energy|comparison|convergence/.test(anchorText)) {
          problems.push(`${page.relPath}: lif_neuron visual is anchored to evaluation/training-result material`);
        }
      }
      if (type === "stdp_window" && !/stdp|spike[- ]?timing|plasticity|training/.test(specText)) {
        problems.push(`${page.relPath}: stdp_window visual is not tied to STDP/training timing`);
      }
      if (
        type === "tradeoff_explorer" &&
        !/metric|evaluation|comparative|results|application|hardware|energy|latency|spike count|tradeoff/.test(specText)
      ) {
        problems.push(`${page.relPath}: tradeoff_explorer visual is not tied to metric/result/application tradeoffs`);
      }
    }
    const pageByUnit = new Map<string, PageFile>();
    for (const page of lessonPages) {
      const unitId = fmString(page.frontmatter, "learningUnitId");
      if (unitId) pageByUnit.set(unitId, page);
    }
    for (const unit of learningUnits) {
      if (!unit.interactiveVisual) continue;
      const page = pageByUnit.get(unit.id);
      if (!page) continue;
      const specs = specsByUnit.get(unit.id) ?? [];
      const omissionReason =
        fmString(page.frontmatter, "interactiveVisualOmissionReason") ||
        (/interactive visual intentionally omitted/i.test(page.body) ? "body notes intentional omission" : "");
      if (specs.length === 0 && !omissionReason) {
        problems.push(`${page.relPath}: learning unit ${unit.id} planned ${unit.interactiveVisual.visualType}, but no interactive visual was embedded`);
      }
    }
    const plannedInteractiveCount = learningUnits.filter((unit) => unit.interactiveVisual).length;
    check(23, "interactive visuals fulfill the Learning Unit Contract", problems, embeddedVisualSpecs.length === 0 && plannedInteractiveCount === 0);
  }

  // 24. Atomic Zettelkasten handles are specific and not broadly reused.
  {
    const problems: string[] = [];
    const counts = new Map<string, number>();
    const knownContractHandles = new Set(learningUnits.flatMap((unit) => zettelHandlesForUnit(unit)));
    for (const page of lessonPages) {
      for (const tag of fmArray(page.frontmatter, "tags")) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
        if (learningUnits.length > 0 && !knownContractHandles.has(tag)) {
          problems.push(`${page.relPath}: tag "${tag}" does not originate from the Learning Unit Contract`);
        }
        if (tag.includes("/")) problems.push(`${page.relPath}: slash-category tag "${tag}"`);
        if (!isAtomicZettelHandle(tag)) problems.push(`${page.relPath}: non-atomic tag "${tag}"`);
        if (scaffoldLikeZettelHandle(tag)) {
          problems.push(`${page.relPath}: scaffold-like tag "${tag}"`);
        }
        if (!tag.includes("-") && BANNED_TAG_SEGMENTS.has(tag.toLowerCase())) {
          problems.push(`${page.relPath}: broad tag "${tag}"`);
        }
      }
    }
    if (lessonPages.length >= 4) {
      const maxAllowed = Math.ceil(lessonPages.length * 0.4);
      for (const [tag, count] of counts) {
        if (count > maxAllowed) problems.push(`tag "${tag}" appears on ${count}/${lessonPages.length} learner pages`);
      }
    }
    check(24, "learner tags are atomic and specific", [...new Set(problems)], lessonPages.length === 0);
  }

  // 25. Learner formulas must be explicitly grounded per formula, never with a
  //     broad page-level escape hatch.
  {
    const problems: string[] = [];
    const formulaVisuals = ledger.filter(isFormulaVisual);
    for (const page of lessonPages) {
      const math = extractQuartzMath(page.body).filter((expr) =>
        isGroundableFormula(expr.formula) && !isTrivialFormulaFragment(expr.formula),
      );
      const entries = formulaEntriesFromFrontmatter(page.rawFrontmatter);
      for (const [index, entry] of entries.entries()) {
        const label = `${page.relPath}: formulas[${index}]`;
        const kind = formulaEntryKind(entry);
        if (entry.text && !isGroundableFormula(String(entry.text))) {
          problems.push(`${page.relPath}: formulas[${index}] tracks trivial math "${entry.text}" instead of a meaningful formula`);
        }
        if (kind === "worked_example" && /^(source-anchored|source-derived)$/.test(String(entry.groundingStatus ?? ""))) {
          problems.push(`${label} is a worked example but is marked ${entry.groundingStatus}; worked examples may reference source formulas but cannot satisfy source definitions`);
        }
        if ((kind === "source_definition" || kind === "source_derived_definition") && isWorkedExampleFormula(String(entry.text ?? ""))) {
          problems.push(`${label} is numeric worked-example arithmetic but is marked ${kind}`);
        }
      }
      if ("formulaGroundingStatus" in page.frontmatter || "formulaJustification" in page.frontmatter) {
        problems.push(`${page.relPath}: uses broad formulaGroundingStatus/formulaJustification instead of per-formula formulas: entries`);
      }
      const declaredFormulaAnchors = [
        ...fmArray(page.frontmatter, "sourceFormulaAnchors"),
        fmString(page.frontmatter, "sourceFormulaAnchor"),
      ].filter(Boolean);
      const declaredSourceAnchoredEntries = entries.filter((entry) => {
        const kind = formulaEntryKind(entry);
        return kind === "source_definition" || kind === "source_derived_definition";
      });
      if (declaredFormulaAnchors.length > 0 && declaredSourceAnchoredEntries.length === 0) {
        problems.push(`${page.relPath}: has sourceFormulaAnchors but no source definition formula entry`);
      }
      for (const anchor of declaredFormulaAnchors) {
        if (!declaredSourceAnchoredEntries.some((entry) => entry.sourceAnchor === anchor)) {
          problems.push(`${page.relPath}: sourceFormulaAnchors includes ${anchor}, but no source definition formulas: entry is grounded to it`);
        }
      }
      if (math.length > 0) {
        if (entries.length === 0) {
          problems.push(`${page.relPath}: contains math but has no per-formula formulas: frontmatter entries`);
        }
        for (const [index, entry] of entries.entries()) {
          const label = `${page.relPath}: formulas[${index}]`;
          const kind = formulaEntryKind(entry);
          if (!String(entry.text ?? "").trim()) problems.push(`${label} missing text`);
          if (!/^(source-anchored|source-derived|conceptual-helper|unmatched)$/.test(String(entry.groundingStatus ?? ""))) {
            problems.push(`${label} has invalid groundingStatus "${entry.groundingStatus ?? ""}"`);
          }
          if (!/^(source_definition|source_derived_definition|worked_example|conceptual_helper)$/.test(kind)) {
            problems.push(`${label} has invalid kind "${kind || "(missing)"}"`);
          }
          if (!String(entry.justification ?? "").trim()) problems.push(`${label} missing justification`);
          if (kind === "worked_example" && /^(source-anchored|source-derived)$/.test(String(entry.groundingStatus ?? ""))) {
            problems.push(`${label} is a worked example but is marked ${entry.groundingStatus}; worked examples may reference source formulas but cannot satisfy source definitions`);
          }
          if ((kind === "source_definition" || kind === "source_derived_definition") && isWorkedExampleFormula(String(entry.text ?? ""))) {
            problems.push(`${label} is numeric worked-example arithmetic but is marked ${kind}`);
          }
          if ((entry.groundingStatus === "source-anchored" || entry.groundingStatus === "source-derived") && !String(entry.sourceAnchor ?? "").trim()) {
            problems.push(`${label} is ${entry.groundingStatus} but lacks sourceAnchor`);
          }
          // Content-based grounding: a source-anchored formula's symbols/metric
          // must actually match the caption of the anchor it claims. This
          // catches index-based mapping (e.g. an energy symbol anchored to the
          // normalized-efficiency equation).
          if ((entry.groundingStatus === "source-anchored" || entry.groundingStatus === "source-derived") && entry.sourceAnchor) {
            const anchorVisual = ledger.find((visual) => String(visual.sourceVisualId ?? "") === entry.sourceAnchor);
            const sourceText = formulaAnchorSemanticText(anchorVisual);
            const meaning = formulaMeaningMatch(String(entry.text ?? ""), sourceText);
            if (sourceText && !meaning.ok) {
              problems.push(
                `${label} is anchored to ${entry.sourceAnchor} but its content does not match that source formula (${meaning.reason})`,
              );
            }
          }
        }
      }
      if (
        formulaVisuals.length > 0 &&
        /formulas? (?:are|is) not present|does not derive .* formulas|formal .* formulas.*outside|outside the supported scope/i.test(page.body)
      ) {
        problems.push(`${page.relPath}: says formulas are absent/out of scope despite extracted source formula anchors`);
      }
    }
    check(25, "learner formulas have per-formula grounding metadata", problems, lessonPages.length === 0);
  }

  // 26. Source visual assignment metadata must agree across the ledger,
  //     learner frontmatter, embedded image URLs, and Source Coverage.
  {
    const problems: string[] = [];
    const ledgerById = new Map(ledger.map((visual) => [String(visual.sourceVisualId ?? ""), visual]));
    const ledgerByUrl = new Map<string, Record<string, unknown>>();
    for (const visual of ledger) {
      for (const key of ["croppedImagePath", "pageImagePath"]) {
        const url = String(visual[key] ?? "");
        if (url) ledgerByUrl.set(url, visual);
      }
    }
    const coverage = readIfExists(path.join(gardenDir, ".breadboard", "planning", "Source Coverage.md"));
    for (const page of lessonPages) {
      const pageId = page.relPath.replace(/\.md$/i, "");
      const declaredIds = new Set(fmArray(page.frontmatter, "sourceVisualIds"));
      for (const id of declaredIds) {
        const visual = ledgerById.get(id);
        if (!visual) {
          problems.push(`${page.relPath}: sourceVisualIds includes ${id}, but it is missing from .breadboard/source-visuals.json`);
          continue;
        }
        if (String(visual.usageStatus ?? "") !== "assigned") {
          problems.push(`${page.relPath}: sourceVisualIds includes ${id}, but ledger status is ${String(visual.usageStatus ?? "missing")}`);
        }
        if (String(visual.assignedPageId ?? "") !== pageId) {
          problems.push(`${page.relPath}: sourceVisualIds includes ${id}, but ledger assigns it to ${String(visual.assignedPageId ?? "nowhere")}`);
        }
      }
      for (const match of page.body.matchAll(/!\[[^\]]*\]\(([^)]*source-visuals[^)]*)\)/gi)) {
        const url = match[1] ?? "";
        const visual = ledgerByUrl.get(url);
        if (!visual) {
          problems.push(`${page.relPath}: embeds ${url}, but no ledger visual has that path`);
          continue;
        }
        const id = String(visual.sourceVisualId ?? "");
        if (id && !declaredIds.has(id)) {
          problems.push(`${page.relPath}: embeds ${id} image but frontmatter sourceVisualIds omits it`);
        }
        if (String(visual.usageStatus ?? "") !== "assigned") {
          problems.push(`${page.relPath}: embeds ${id}, but ledger status is ${String(visual.usageStatus ?? "missing")}`);
        }
      }
    }
    if (coverage) {
      for (const visual of ledger) {
        const id = String(visual.sourceVisualId ?? "");
        if (!id || String(visual.usageStatus ?? "") !== "assigned") continue;
        const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (new RegExp(`${escaped}[^\\n]*(?:Not central|intentionally skipped|unassigned)`, "i").test(coverage)) {
          problems.push(`${id}: Source Coverage contradicts assigned ledger status`);
        }
      }
    }
    check(26, "source visual metadata agrees across ledger/frontmatter/body/coverage", [...new Set(problems)], !ledgerExists);
  }

  // 27. Source visual placement must match the learner page's semantic role.
  {
    const problems: string[] = [];
    const pageById = new Map(lessonPages.map((page) => [page.relPath.replace(/\.md$/i, ""), page]));
    const pageUnitById = new Map(lessonPages.map((page) => [page.relPath.replace(/\.md$/i, ""), fmString(page.frontmatter, "learningUnitId")]));
    if (learningUnits.length > 0) {
      const contractUnitByArtifact = new Map<string, string>();
      for (const assignment of contractAssignments) {
        if (assignment.sourceArtifactId) contractUnitByArtifact.set(assignment.sourceArtifactId, assignment.assignedLearningUnitId);
      }
      for (const visual of ledger) {
        if (String(visual.usageStatus ?? "") !== "assigned") continue;
        const id = String(visual.sourceVisualId ?? "");
        const assignedPageId = String(visual.assignedPageId ?? "");
        if (!id || !assignedPageId) continue;
        const expectedUnit = contractUnitByArtifact.get(id);
        if (!expectedUnit) continue;
        const actualUnit = pageUnitById.get(assignedPageId);
        if (actualUnit && actualUnit !== expectedUnit) {
          problems.push(`${id}: ledger assigns to ${assignedPageId} (${actualUnit}), but Learning Unit Contract assigns it to ${expectedUnit}`);
        }
      }
      check(27, "source visuals match page semantics", [...new Set(problems)], !isSnnGarden || !ledgerExists);
    } else {
    const idsForPage = (page: PageFile): Set<string> =>
      new Set([
        ...fmArray(page.frontmatter, "sourceVisualIds"),
        ...fmArray(page.frontmatter, "sourceFormulaAnchors"),
      ].filter(Boolean));
    const comparisonPage = lessonPages.find((page) =>
      /comparative|results|models and metrics|models-and-metrics/i.test(`${page.relPath} ${fmString(page.frontmatter, "title")}`),
    );
    const metricPage = lessonPages.find((page) => {
      const text = `${page.relPath} ${fmString(page.frontmatter, "title")}`;
      return /metric|evaluation|accuracy|latency|energy|spike count|convergence/i.test(text) &&
        !/comparative|results|models and metrics|models-and-metrics/i.test(text);
    });
    const applicationPage = lessonPages.find((page) =>
      /application|hardware|neuromorphic|deployment/i.test(`${page.relPath} ${fmString(page.frontmatter, "title")}`),
    );
    const resultVisualIds = ledger
      .filter((visual) => /S\d+\.P(?:7|8|9|10|11)\.(?:T|G|F)\d+/i.test(String(visual.sourceVisualId ?? "")))
      .map((visual) => String(visual.sourceVisualId ?? ""));
    const metricFormulaIds = ledger
      .filter((visual) => /S\d+\.P6\.E[1-6]$/i.test(String(visual.sourceVisualId ?? "")))
      .map((visual) => String(visual.sourceVisualId ?? ""));

    for (const visual of ledger) {
      if (String(visual.usageStatus ?? "") !== "assigned") continue;
      const page = pageById.get(String(visual.assignedPageId ?? ""));
      if (!page) continue;
      const pageText = `${page.relPath} ${fmString(page.frontmatter, "title")}`.toLowerCase();
      const vText = visualText(visual).toLowerCase();
      const id = String(visual.sourceVisualId ?? "");
      if (/what spiking neural networks are/.test(pageText) && !/^S\d+\.P4\.(?:G|F)\d+$/i.test(id)) {
        problems.push(`${id}: basic SNN page may only use page-4 LIF/membrane visuals, not ${vText}`);
      }
      if (/what spiking neural networks are|from conventional neural networks to snns/.test(pageText) &&
          /S\d+\.P(?:7|8|9|10|11)\.|latency|energy|convergence|performance|accuracy|training loss|results?/i.test(vText)) {
        problems.push(`${id}: evaluation/result visual assigned to an introductory SNN page`);
      }
      const comparisonRole = /comparative|results|models and metrics|models-and-metrics/.test(pageText);
      if (!comparisonRole &&
          /metric|evaluation|accuracy|latency|energy|spike count|convergence/.test(pageText) &&
          /S\d+\.P(?:7|8|9|10|11)\.(?:T|G|F)\d+/i.test(id)) {
        problems.push(`${id}: result table/graph belongs on the comparison page, not the metric-definition page`);
      }
      if (/comparative|results|models and metrics|models-and-metrics/.test(pageText) && /S\d+\.P6\.E\d+/i.test(id)) {
        problems.push(`${id}: metric formula belongs on the metric page, not the comparison/results page`);
      }
      if (/open challenges|unresolved|limitations|future work/.test(pageText) && /lif|leaky|membrane|threshold|S\d+\.P4\./i.test(vText)) {
        problems.push(`${id}: open-challenges page is using a LIF/basic-neuron visual`);
      }
    }

    if (metricPage && metricFormulaIds.length > 0) {
      const ids = idsForPage(metricPage);
      for (const id of metricFormulaIds) {
        if (!ids.has(id)) problems.push(`${metricPage.relPath}: missing metric formula anchor ${id}`);
      }
    }
    if (comparisonPage && resultVisualIds.length > 0) {
      const ids = idsForPage(comparisonPage);
      for (const id of resultVisualIds) {
        if (!ids.has(id)) problems.push(`${comparisonPage.relPath}: missing comparison result visual ${id}`);
      }
    }
    if (applicationPage) {
      const haystack = `${applicationPage.body} ${fmArray(applicationPage.frontmatter, "sourceAnchors").join(" ")}`.toLowerCase();
      if (!/deployment|hardware|neuromorphic|loihi|edge|application/.test(haystack)) {
        problems.push(`${applicationPage.relPath}: application page lacks deployment/hardware anchors`);
      }
    }
    check(
      27,
      "source visuals match page semantics",
      [...new Set(problems)],
      !isSnnGarden || !ledgerExists,
    );
    }
  }

  // 28. Legacy semantic tag lint. Contract-backed gardens already enforce the
  // exact zettel handles in checks 8 and 24; do not reintroduce text-mined
  // centrality heuristics after the Learning Unit Contract has spoken.
  {
    const problems: string[] = [];
    if (learningUnits.length > 0 || lessonPages.length === 0) {
      check(28, "learner tags are central to their pages", [], true, {
        reason: learningUnits.length > 0
          ? "contract-backed gardens enforce exact Zettelkasten handles in checks 8, 24, 45, 51, and 57"
          : "no learner pages",
      });
    } else {
    for (const page of lessonPages) {
      const haystack = `${fmString(page.frontmatter, "title")} ${teachingProse(page.body)}`.toLowerCase();
      const pageText = `${page.relPath} ${fmString(page.frontmatter, "title")}`.toLowerCase();
      for (const tag of fmArray(page.frontmatter, "tags")) {
        const leaf = (tag.split("/").pop() ?? tag).toLowerCase();
        const distinctive = leaf
          .split("-")
          .filter((word) => word.length >= 4 && !BANNED_TAG_SEGMENTS.has(word));
        if (distinctive.length > 0 && !distinctive.some((word) => haystack.includes(word))) {
          problems.push(`${page.relPath}: tag "${tag}" is syntactically valid but not semantically central to the page`);
        }
        if (/metric\/convergence-time-target-epoch/.test(tag) && !/metric|evaluation|convergence|training|results/.test(pageText)) {
          problems.push(`${page.relPath}: convergence-time tag belongs on metric/training/result pages`);
        }
        if (/snn\/lif-neuron-threshold-reset/.test(tag) && !/lif|leaky|neuron model|what spiking neural networks are/.test(pageText)) {
          problems.push(`${page.relPath}: LIF tag is not central to this page`);
        }
        if (/open challenges|unresolved|limitations|future work/.test(pageText) && /lif|leaky|threshold-reset/.test(tag)) {
          problems.push(`${page.relPath}: open-challenges page carries a LIF/basic-neuron tag`);
        }
      }
    }
    check(
      28,
      "learner tags are central to their pages",
      [...new Set(problems)],
      false,
    );
    }
  }

  // 29. Repeated learner-page openings must be callbacks, not restarted
  // motivation frames. A Learning Unit Contract gives us better context; it is
  // not an exemption.
  {
    const problems: string[] = [];
    const introByFingerprint = new Map<string, string[]>();
    const motifPages: string[] = [];
    for (const page of lessonPages) {
      const intro = teachingProse(page.body)
        .replace(/^#.*$/gm, " ")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 80)
        .join(" ")
        .toLowerCase();
      if (/battery-powered robot|quiet hallway|dense ann|silent snn/.test(intro)) {
        motifPages.push(page.relPath);
      }
      const fingerprint = intro
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 16)
        .join(" ");
      if (fingerprint.split(" ").length >= 12) {
        const pagesForFingerprint = introByFingerprint.get(fingerprint) ?? [];
        pagesForFingerprint.push(page.relPath);
        introByFingerprint.set(fingerprint, pagesForFingerprint);
      }
    }
    if (motifPages.length > 1) {
      problems.push(`repeated battery/quiet-hallway/dense-ANN intro motif on ${motifPages.join(", ")}`);
    }
    for (const [fingerprint, rels] of introByFingerprint) {
      if (rels.length >= 3) {
        problems.push(`repeated opening phrase "${fingerprint}" on ${rels.join(", ")}`);
      }
    }
    check(
      29,
      "learner page openings are not repeated across pages",
      problems,
      lessonPages.length < 3,
      { reason: "fewer than three learner pages" },
    );
  }

  // 30. Exported artifact includes the machine-readable validation report.
  {
    const problems: string[] = [];
    const reportPath = path.join(gardenDir, ".breadboard", "validation-report.md");
    const report = readIfExists(reportPath);
    if (!report) {
      problems.push(".breadboard/validation-report.md missing");
    } else {
      if (!/^Generated:\s+/m.test(report)) problems.push("validation report missing timestamp");
      if (!/^Root:\s+/m.test(report)) problems.push("validation report missing root");
      if (!/^Page counts:\s+/m.test(report)) problems.push("validation report missing page counts");
      if (!/\[(?:PASS|WARN|FAIL|SKIP)\]/.test(report)) problems.push("validation report missing check statuses");
      if (!/^Accepted:\s+(?:yes|no)$/im.test(report)) problems.push("validation report missing accepted yes/no");
      for (const section of REQUIRED_VALIDATION_REPORT_SECTIONS) {
        const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (!new RegExp(`^##\\s+${escaped}\\s*$`, "m").test(report)) {
          problems.push(`validation report missing section "${section}"`);
        }
      }
    }
    check(30, "validation report is exported", problems);
  }

  // 31. Every generated learner page must come from a persisted Learning Unit
  //     Contract, and source artifact assignments must be decided there.
  {
    const problems: string[] = [];
    if (lessonPages.length > 0 && learningUnits.length === 0) {
      problems.push(".breadboard/learning-unit-contract.json missing or empty");
    }
    if (learningUnits.length > 0) {
      if (!learningUnitContract.foundPath) problems.push("Learning Unit Contract path was not recorded");
      problems.push(...validateLearningUnitContracts(learningUnits, { artifactCount: realFigures.length }));

      const pageUnitIds = new Map<string, string[]>();
      for (const page of lessonPages) {
        const unitId = fmString(page.frontmatter, "learningUnitId");
        if (!unitId) {
          problems.push(`${page.relPath}: missing learningUnitId frontmatter`);
          continue;
        }
        if (!learningUnitsById.has(unitId)) {
          problems.push(`${page.relPath}: learningUnitId "${unitId}" is not in the Learning Unit Contract`);
          continue;
        }
        const pagesForUnit = pageUnitIds.get(unitId) ?? [];
        pagesForUnit.push(page.relPath);
        pageUnitIds.set(unitId, pagesForUnit);
      }
      for (const [unitId, pagesForUnit] of pageUnitIds) {
        if (pagesForUnit.length > 1) {
          problems.push(`learning unit ${unitId} generated multiple learner pages: ${pagesForUnit.join(", ")}`);
        }
      }

      const expectedAssignments = assignSourceArtifacts(learningUnits);
      const contractAssignmentKeys = new Set(
        contractAssignments.map((assignment) =>
          `${assignment.sourceArtifactId}::${assignment.assignedLearningUnitId}::${assignment.placement}`,
        ),
      );
      if (expectedAssignments.length > 0 && contractAssignments.length === 0) {
        problems.push("Learning Unit Contract has source artifacts but no sourceArtifactAssignments ledger");
      }
      for (const assignment of expectedAssignments) {
        const key = `${assignment.sourceArtifactId}::${assignment.assignedLearningUnitId}::${assignment.placement}`;
        if (!contractAssignmentKeys.has(key)) {
          problems.push(
            `${assignment.sourceArtifactId}: sourceArtifactAssignments missing ${assignment.assignedLearningUnitId} / ${assignment.placement}`,
          );
        }
      }
      for (const assignment of contractAssignments) {
        if (!learningUnitsById.has(assignment.assignedLearningUnitId)) {
          problems.push(`${assignment.sourceArtifactId}: assigned to unknown learning unit ${assignment.assignedLearningUnitId}`);
        }
        if (!assignment.requiredInterpretation.trim()) {
          problems.push(`${assignment.sourceArtifactId}: assignment lacks requiredInterpretation`);
        }
        if (!assignment.reason.trim()) {
          problems.push(`${assignment.sourceArtifactId}: assignment lacks reason`);
        }
      }

      const assignedContractIds = new Set(contractAssignments.map((assignment) => assignment.sourceArtifactId));
      for (const visual of realFigures) {
        if (String(visual.usageStatus ?? "") !== "assigned") continue;
        const id = String(visual.sourceVisualId ?? "");
        if (id && !assignedContractIds.has(id)) {
          problems.push(`${id}: ledger assigns source artifact, but Learning Unit Contract has no assignment`);
        }
      }
    }
    check(31, "Learning Unit Contract exists and owns source assignments", [...new Set(problems)], lessonPages.length === 0);
  }

  // 32. Source figures are inline teaching material, never end-of-page dumps.
  {
    const problems: string[] = [];
    for (const page of lessonPages) {
      for (const problem of figurePlacementProblems(page.body)) {
        problems.push(`${page.relPath}: ${problem}`);
      }
    }
    check(32, "source figures are placed inline with interpretation", problems, lessonPages.length === 0);
  }

  // 33. A cropped source figure may appear on only one learner page unless a
  //     future contract field explicitly marks the reuse as intentional.
  {
    const problems: string[] = [];
    const ledgerByUrl = new Map<string, string>();
    for (const visual of realFigures) {
      const id = String(visual.sourceVisualId ?? "");
      if (!id) continue;
      for (const key of ["croppedImagePath", "pageImagePath"]) {
        const url = String(visual[key] ?? "");
        if (url) ledgerByUrl.set(url, id);
      }
    }
    const pagesByArtifact = new Map<string, Set<string>>();
    const addUse = (id: string, relPath: string) => {
      if (!id) return;
      const pagesForId = pagesByArtifact.get(id) ?? new Set<string>();
      pagesForId.add(relPath);
      pagesByArtifact.set(id, pagesForId);
    };
    for (const page of lessonPages) {
      for (const id of fmArray(page.frontmatter, "sourceVisualIds")) addUse(id, page.relPath);
      for (const match of page.body.matchAll(/!\[[^\]]*\]\(([^)]*source-visuals[^)]*)\)/gi)) {
        const id = ledgerByUrl.get(match[1] ?? "");
        if (id) addUse(id, page.relPath);
      }
    }
    for (const [id, pagesForId] of pagesByArtifact) {
      if (pagesForId.size <= 1) continue;
      const assignments = contractAssignments.filter((assignment) => assignment.sourceArtifactId === id);
      const explicitReuse = assignments.some((assignment) =>
        /\breuse|revisit|shared intentionally\b/i.test(`${assignment.reason} ${assignment.requiredInterpretation}`),
      );
      if (!explicitReuse) {
        problems.push(`${id}: reused on ${[...pagesForId].join(", ")} without explicit reuse metadata`);
      }
    }
    check(33, "source figures are not reused without explicit policy", problems, lessonPages.length === 0);
  }

  // 34. Learner-facing section titles must not expose internal clustering
  //     scaffold labels.
  {
    const problems: string[] = [];
    const subsectionTitles = new Set(lessonPages.map((page) => fmString(page.frontmatter, "title")).filter(Boolean));
    for (const page of published) {
      if (!/^learning\/[^/]+\/_index\.md$/i.test(page.relPath)) continue;
      const title = fmString(page.frontmatter, "title") || page.relPath;
      if (/This Topic/i.test(title)) problems.push(`${page.relPath}: section title contains "This Topic"`);
      if (/and the Mechanism Works|and it Is Measured|How It Learns or Changes|The Formal Description/i.test(title)) {
        problems.push(`${page.relPath}: section title exposes internal scaffold phrase "${title}"`);
      }
      const stripped = title.replace(/^\d+(?:\.\d+)*\.?\s*/, "");
      if (subsectionTitles.has(stripped)) {
        problems.push(`${page.relPath}: section title duplicates a subsection title "${stripped}"`);
      }
    }
    problems.push(...sectionTitleNaturalnessAllProblems(gardenDir, lessonPages, learningUnitsById));
    check(34, "section titles are learner-facing, not planning scaffolds", problems, lessonPages.length === 0);
  }

  // 35. Source crop quality: conservative dimensions + edge heuristics.
  {
    const problems: string[] = [];
    for (const visual of ledger) {
      problems.push(...cropQualityProblems(gardenDir, gardenSlug, visual));
    }
    check(35, "source crop quality is acceptable", problems, !ledgerExists);
  }

  // 36. Semantic navigation: learning navigation stays in learning/, source
  // navigation stays in sources/.
  {
    check(36, "semantic navigation links point to the expected page family", semanticNavigationProblems(gardenDir));
  }

  // 37. Section title/unit semantic coherence.
  {
    const problems: string[] = [];
    const sectionInputs = sectionSemanticInputs(gardenDir, lessonPages, learningUnitsById);
    const profiles = sectionSemanticProfiles(sectionInputs.map((section) => ({
      sectionTitle: section.sectionTitle,
      units: section.units,
      subsectionTitles: section.subsectionTitles,
    })));
    for (const [index, profile] of profiles.entries()) {
      for (const problem of profile.problems) {
        problems.push(`${sectionInputs[index]?.rel ?? profile.sectionTitle}: ${problem}`);
      }
    }
    check(37, "section titles semantically match contained learning units", problems, lessonPages.length === 0 || learningUnits.length === 0);
  }

  // 38. Section/subsection title grammar.
  {
    const problems: string[] = [];
    const sectionInputs = sectionSemanticInputs(gardenDir, lessonPages, learningUnitsById);
    for (const section of sectionInputs) {
      for (const problem of sectionTitleGrammarProblems(section.sectionTitle, section.subsectionTitles)) {
        problems.push(`${section.rel}: ${problem}`);
      }
    }
    for (const page of lessonPages) {
      for (const problem of sectionTitleGrammarProblems(fmString(page.frontmatter, "title"))) {
        problems.push(`${page.relPath}: ${problem}`);
      }
    }
    check(38, "section and subsection title grammar is polished", problems, lessonPages.length === 0);
  }

  // 39. Interactive visual source grounding is semantically compatible.
  {
    const problems: string[] = [];
    for (const { page, spec } of embeddedVisualSpecs) {
      const ids = visualAnchorIds(spec);
      for (const problem of interactiveVisualGroundingProblems({
        visualType: String(spec.type ?? ""),
        sourceAnchors: ids,
        sourceAnchorText: anchorTextForVisualIds(ledger, ids, spec),
        status: String(spec.sourceGroundingStatus ?? ""),
        justification: String(spec.justification ?? ""),
        conceptText: [fmString(page.frontmatter, "title"), spec.title, spec.caption, spec.pedagogicalPurpose, spec.learningGoal].filter(Boolean).join(" "),
      })) {
        problems.push(`${page.relPath}: ${problem}`);
      }
    }
    check(39, "interactive visual grounding is semantically real", problems, embeddedVisualSpecs.length === 0);
  }

  // 40. Formula frontmatter contains formulas, not prose teaching goals.
  {
    const problems: string[] = [];
    for (const page of lessonPages) {
      for (const [index, entry] of formulaEntriesFromFrontmatter(page.rawFrontmatter).entries()) {
        const text = String(entry.text ?? "");
        const kind = formulaEntryKind(entry);
        if (!text.trim()) {
          problems.push(`${page.relPath}: formulas[${index}] missing text`);
        } else if (!isFormulaExpression(text)) {
          problems.push(`${page.relPath}: formulas[${index}] is prose/keyword bundle, not a mathematical expression: "${text}"`);
        }
        if (!/^(source-anchored|source-derived|conceptual-helper|unmatched)$/.test(String(entry.groundingStatus ?? ""))) {
          problems.push(`${page.relPath}: formulas[${index}] has invalid groundingStatus "${entry.groundingStatus ?? ""}"`);
        }
        if (!/^(source_definition|source_derived_definition|worked_example|conceptual_helper)$/.test(kind)) {
          problems.push(`${page.relPath}: formulas[${index}] has invalid kind "${kind || "(missing)"}"`);
        }
      }
    }
    check(40, "formula expression validation rejects prose", problems, lessonPages.length === 0);
  }

  // 41. Source-derived/source-anchored formulas match their source anchors.
  {
    const problems: string[] = [];
    const sources = ledger.filter(isFormulaVisual).map((visual) => ({
      id: String(visual.sourceVisualId ?? ""),
      text: formulaAnchorSemanticText(visual),
    }));
    for (const page of lessonPages) {
      for (const [index, entry] of formulaEntriesFromFrontmatter(page.rawFrontmatter).entries()) {
        const text = String(entry.text ?? "");
        const status = String(entry.groundingStatus ?? "");
        const kind = formulaEntryKind(entry);
        if (!isFormulaExpression(text)) continue;
        if (kind === "worked_example") {
          if (/^(source-anchored|source-derived)$/.test(status)) {
            problems.push(`${page.relPath}: formulas[${index}] is a worked example but is marked ${status}`);
          }
          continue;
        }
        const matchingSource = sources.find((source) => source.text && formulaMeaningMatch(text, source.text).ok);
        if ((status === "conceptual-helper" || status === "unmatched") && matchingSource) {
          problems.push(`${page.relPath}: formulas[${index}] matches source formula ${matchingSource.id} but is marked ${status}`);
        }
        if ((status === "source-anchored" || status === "source-derived") && !String(entry.sourceAnchor ?? "").trim()) {
          problems.push(`${page.relPath}: formulas[${index}] is ${status} but lacks sourceAnchor`);
        }
        if ((status === "source-anchored" || status === "source-derived") && entry.sourceAnchor) {
          const anchor = sources.find((source) => source.id === entry.sourceAnchor);
          const meaning = formulaMeaningMatch(text, anchor?.text ?? "");
          if (anchor?.text && !meaning.ok) {
            problems.push(`${page.relPath}: formulas[${index}] is grounded to ${entry.sourceAnchor}, but content does not match (${meaning.reason})`);
          }
        }
      }
    }
    check(41, "formula source matching is semantic", problems, lessonPages.length === 0);
  }

  // 42. Stale source-map/learning-map caveats are reconciled against evidence.
  {
    check(42, "source map caveats are reconciled with extracted evidence", sourceMapCaveatProblems(gardenDir, ledger), !ledgerExists);
  }

  // 43. Source usage is distinct from crop status.
  {
    check(43, "source anchor usage is split from crop status", sourceAnchorUsageVsCropStatusProblems(ledger, lessonPages), !ledgerExists);
  }

  // 44. Crop omissions have honest fallback reporting.
  {
    check(44, "crop quality and fallbacks are honestly reported", cropFallbackProblems(ledger, lessonPages), !ledgerExists);
  }

  // 45. Substantial learner pages have enough contract-backed Zettelkasten handles.
  {
    const problems: string[] = [];
    for (const page of lessonPages) {
      const words = proseWordCount(page.body);
      if (words < MIN_LESSON_WORDS) continue;
      const tags = fmArray(page.frontmatter, "tags");
      if (tags.length < 3) problems.push(`${page.relPath}: substantial page has ${tags.length} tag(s), expected 3-6 contract-backed handles`);
      if (tags.length > 6) problems.push(`${page.relPath}: substantial page has ${tags.length} tags, expected no more than 6`);
      const unit = learningUnitsById.get(fmString(page.frontmatter, "learningUnitId"));
      const handles = unit ? zettelHandlesForUnit(unit) : [];
      if (unit && handles.length < 3) problems.push(`${page.relPath}: learning unit ${unit.id} has only ${handles.length} contract zettel handle(s)`);
      for (const tag of tags) {
        if (scaffoldLikeZettelHandle(tag)) problems.push(`${page.relPath}: scaffold-like tag "${tag}"`);
      }
    }
    check(45, "Zettelkasten tag density is useful", problems, lessonPages.length === 0);
  }

  // 46. Top-level learning section titles must be unique after normalization.
  {
    const sectionInputs = sectionSemanticInputs(gardenDir, lessonPages, learningUnitsById);
    check(
      46,
      "Section Title Uniqueness",
      sectionTitleUniquenessProblems(sectionInputs.map((section) => ({ rel: section.rel, title: section.sectionTitle }))),
      sectionInputs.length === 0,
    );
  }

  // 47. Numbered section labels must point to the matching numbered folder.
  {
    check(47, "Semantic Navigation Number Matching", semanticNavigationNumberProblems(gardenDir));
  }

  // 48. Learning Map section references must be unambiguous.
  {
    const sectionInputs = sectionSemanticInputs(gardenDir, lessonPages, learningUnitsById);
    check(48, "Learning Map Ambiguity", learningMapAmbiguityProblems(gardenDir, sectionInputs), sectionInputs.length === 0);
  }

  // 49. Source Coverage must distinguish concept usage from crop embedding.
  {
    check(49, "Source Coverage Mode Precision", sourceCoverageModePrecisionProblems(gardenDir, ledger), !ledgerExists);
  }

  // 50. Conceptual visuals should use source prose anchors when relevant prose exists.
  {
    check(
      50,
      "Source Text Concept Anchors",
      [
        ...sourceTextConceptAnchorProblems(gardenDir, embeddedVisualSpecs),
        ...sourceTextBodyAnchorProblems(gardenDir, lessonPages, learningUnitsById),
      ],
      embeddedVisualSpecs.length === 0 && lessonPages.length === 0,
    );
  }

  // 51. Zettelkasten handles must be concrete concept claims, not planner scaffolds.
  {
    const problems = learningUnits.flatMap((unit) => zettelHandleQualityProblems(unit));
    for (const page of lessonPages) {
      for (const tag of fmArray(page.frontmatter, "tags")) {
        if (scaffoldLikeZettelHandle(tag)) problems.push(`${page.relPath}: scaffold-like tag "${tag}"`);
      }
    }
    check(51, "Zettelkasten Handle Quality", [...new Set(problems)], lessonPages.length === 0 && learningUnits.length === 0);
  }

  // 52. Section folder names, section frontmatter titles, H1 headings, and map
  // labels must describe the same section.
  {
    check(52, "Section Folder/Title Consistency", sectionFolderTitleConsistencyProblems(gardenDir));
  }

  // 53. Formula family matching reports exact family contradictions.
  {
    const problems: string[] = [];
    for (const page of lessonPages) {
      for (const [index, entry] of formulaEntriesFromFrontmatter(page.rawFrontmatter).entries()) {
        const text = String(entry.text ?? "");
        const status = String(entry.groundingStatus ?? "");
        const kind = formulaEntryKind(entry);
        if (kind === "worked_example") {
          if (/^(?:source-anchored|source-derived)$/.test(status)) {
            problems.push(`${page.relPath}: formulas[${index}] worked example is marked ${status}; source definition anchors need kind=source_definition/source_derived_definition`);
          }
          continue;
        }
        if (!/^(?:source-anchored|source-derived)$/.test(status) || !entry.sourceAnchor) continue;
        const anchorVisual = ledger.find((visual) => String(visual.sourceVisualId ?? "") === entry.sourceAnchor);
        const sourceText = formulaAnchorSemanticText(anchorVisual);
        const formulaFamily = formulaMetricFamily(text);
        const sourceFamily = formulaMetricFamily(sourceText);
        if (isTrivialFormulaFragment(text)) {
          problems.push(`${page.relPath}: formulas[${index}] source-anchors trivial formula "${text}" to ${entry.sourceAnchor}`);
          continue;
        }
        if (sourceFamily && formulaFamily && sourceFamily !== formulaFamily) {
          problems.push(`${page.relPath}: formulas[${index}] formula text="${text}" inferred=${formulaFamily} sourceAnchor=${entry.sourceAnchor} sourceFamily=${sourceFamily} reason=family mismatch`);
        }
        if (sourceFamily && !formulaFamily) {
          problems.push(`${page.relPath}: formulas[${index}] formula text="${text}" inferred=unknown sourceAnchor=${entry.sourceAnchor} sourceFamily=${sourceFamily} reason=no recognizable generated formula family`);
        }
      }
    }
    check(53, "Formula Family Match", problems, lessonPages.length === 0);
  }

  // 54. Formula frontmatter should not be dominated by inline fragments.
  {
    check(54, "Formula Metadata Noise", formulaMetadataNoiseProblems(lessonPages), lessonPages.length === 0);
  }

  // 55. Metric visuals should carry the minimal formula anchors needed by the
  // controls and outputs they actually show.
  {
    check(55, "Visual Anchor Precision", visualAnchorPrecisionProblems(ledger, embeddedVisualSpecs), embeddedVisualSpecs.length === 0);
  }

  // 56. Keep a separate acceptance row for title naturalness so a PASS report
  // cannot hide source-anchor-derived section titles behind grammar checks.
  {
    check(56, "Section Title Naturalness", sectionTitleNaturalnessAllProblems(gardenDir, lessonPages, learningUnitsById), lessonPages.length === 0);
  }

  // 57. Explicit naturalness row for Zettelkasten handles.
  {
    const problems = learningUnits.flatMap((unit) => zettelHandleQualityProblems(unit));
    check(57, "Zettelkasten Handle Naturalness", [...new Set(problems)], learningUnits.length === 0);
  }

  // 58. Semantic repairs must be traceable and resolved.
  {
    check(58, "Repair Provenance", repairLogConsistencyProblems(gardenDir, lessonPages), lessonPages.length === 0);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Wikilink resolution
// ---------------------------------------------------------------------------

const HEADING_RE = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm;
const WIKILINK_RE = /(!?)\[\[([^\]]+?)\]\]/g;

function headingSlugs(body: string): Set<string> {
  const slugs = new Set<string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(HEADING_RE.source, HEADING_RE.flags);
  while ((match = re.exec(body)) !== null) {
    slugs.add(slugifyLoose(match[1]));
  }
  return slugs;
}

/** Scan published pages for `[[wikilinks]]` and verify each resolves to an
 * existing markdown file (by canonical vault path or unique basename) and, when
 * a `#fragment` is present, to a real heading in that file. Broken links are
 * reported with the nearest resolvable suggestion so navigation is never
 * silently broken. */
function validateInternalWikilinks(pages: PageFile[], published: PageFile[]): string[] {
  const problems: string[] = [];

  // Existence indexes over ALL pages (a link may point at a section _index).
  const byTarget = new Map<string, PageFile>();
  const byBasenameSlug = new Map<string, PageFile[]>();
  // Number-stripped "concept slug": a generated file is "2.1 The LIF Neuron.md"
  // but the LLM links "[[The LIF Neuron]]". Index both so we can suggest the
  // real numbered file for a loose title link.
  const byConceptSlug = new Map<string, PageFile[]>();
  const conceptSlug = (name: string): string =>
    slugifyLoose(name.replace(/^\d+(?:\.\d+)*\.?\s*/, ""));
  for (const page of pages) {
    const target = page.relPath.replace(/\.md$/i, "");
    byTarget.set(target.toLowerCase(), page);
    const segments = target.split("/");
    const base = segments.pop() ?? target;
    // A section _index page is best addressed by its FOLDER name, not "_index".
    const names = base.toLowerCase() === "_index" && segments.length > 0 ? [segments[segments.length - 1]] : [base];
    for (const name of names) {
      for (const [map, slug] of [
        [byBasenameSlug, slugifyLoose(name)],
        [byConceptSlug, conceptSlug(name)],
      ] as Array<[Map<string, PageFile[]>, string]>) {
        if (!slug) continue;
        const list = map.get(slug) ?? [];
        list.push(page);
        map.set(slug, list);
      }
    }
  }

  const suggestFor = (base: string): string | undefined => {
    const leaf = base.split("/").pop() ?? base;
    for (const matches of [byBasenameSlug.get(slugifyLoose(leaf)), byConceptSlug.get(conceptSlug(leaf))]) {
      if (matches && matches.length === 1) return matches[0].relPath.replace(/\.md$/i, "");
    }
    return undefined;
  };

  for (const page of published) {
    let match: RegExpExecArray | null;
    const re = new RegExp(WIKILINK_RE.source, WIKILINK_RE.flags);
    while ((match = re.exec(page.body)) !== null) {
      const isEmbed = match[1] === "!";
      const inner = match[2];
      const rawTarget = (inner.includes("|") ? inner.slice(0, inner.indexOf("|")) : inner).trim();
      if (!rawTarget || /^[a-z][a-z\d+.-]*:/i.test(rawTarget)) continue; // URL/scheme
      if (isEmbed) continue; // image/transclusion embeds are not navigation

      const hashIndex = rawTarget.indexOf("#");
      const base = (hashIndex >= 0 ? rawTarget.slice(0, hashIndex) : rawTarget)
        .replace(/^\//, "")
        .replace(/\.md$/i, "")
        .trim();
      const fragment = hashIndex >= 0 ? rawTarget.slice(hashIndex + 1).trim() : "";

      // Same-page heading link (`[[#Heading]]`).
      if (!base) {
        if (fragment && !headingSlugs(page.body).has(slugifyLoose(fragment))) {
          problems.push(`${page.relPath}: heading link "#${fragment}" not found on the page`);
        }
        continue;
      }

      let targetPage = byTarget.get(base.toLowerCase());
      if (!targetPage) {
        const byBase = byBasenameSlug.get(slugifyLoose(base.split("/").pop() ?? base));
        if (byBase && byBase.length === 1) targetPage = byBase[0];
      }

      if (!targetPage) {
        // For `[[Section#Subsection]]`, the subsection is its own file — prefer
        // suggesting that over the (missing) section.
        const suggestion = (fragment ? suggestFor(fragment) : undefined) ?? suggestFor(base);
        problems.push(
          `${page.relPath}: broken link [[${rawTarget}]] -> no page "${base}"` +
            (suggestion ? ` (did you mean [[${suggestion}]]?)` : ""),
        );
        continue;
      }

      if (fragment && !headingSlugs(targetPage.body).has(slugifyLoose(fragment))) {
        // A title-based fragment almost always means the LLM linked a
        // subsection as a heading of its section; suggest the real file.
        const suggestion = suggestFor(fragment);
        problems.push(
          `${page.relPath}: link [[${rawTarget}]] -> heading "${fragment}" missing in ${targetPage.relPath}` +
            (suggestion ? ` (did you mean [[${suggestion}]]?)` : ""),
        );
      }
    }
  }

  return [...new Set(problems)];
}

function wikilinkTargets(markdown: string): string[] {
  const targets: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(WIKILINK_RE.source, WIKILINK_RE.flags);
  while ((match = re.exec(markdown)) !== null) {
    if (match[1] === "!") continue;
    const inner = match[2];
    const rawTarget = (inner.includes("|") ? inner.slice(0, inner.indexOf("|")) : inner).trim();
    const base = rawTarget.split("#")[0].replace(/^\//, "").replace(/\.md$/i, "").trim();
    if (base) targets.push(base);
  }
  return targets;
}

function markdownSection(markdown: string, heading: string): string {
  const re = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im");
  const match = re.exec(markdown);
  if (!match) return "";
  const rest = markdown.slice((match.index ?? 0) + match[0].length);
  const next = rest.search(/^##\s+/m);
  return next >= 0 ? rest.slice(0, next) : rest;
}

function semanticNavigationProblems(gardenDir: string): string[] {
  const problems: string[] = [];
  const readBody = (relPath: string): string => {
    const abs = path.join(gardenDir, ...relPath.split("/"));
    if (!fs.existsSync(abs)) return "";
    return splitFrontmatter(fs.readFileSync(abs, "utf-8")).body;
  };
  const root = readBody("_index.md");
  for (const target of wikilinkTargets(markdownSection(root, "Learning"))) {
    if (!target.startsWith("learning/")) problems.push(`_index.md Learning section links outside learning/: [[${target}]]`);
  }
  for (const target of wikilinkTargets(markdownSection(root, "Sources"))) {
    if (!target.startsWith("sources/")) problems.push(`_index.md Sources section links outside sources/: [[${target}]]`);
  }
  for (const rel of ["learning/_index.md", "learning/Learning Map.md", "learning/Topic Overview.md"]) {
    const body = readBody(rel);
    if (!body) continue;
    for (const target of wikilinkTargets(body)) {
      if (target.startsWith("sources/")) problems.push(`${rel}: learner navigation links directly to source document [[${target}]]`);
      if (!target.startsWith("learning/")) problems.push(`${rel}: learner navigation link leaves learning/: [[${target}]]`);
    }
  }
  const sourceIndex = readBody("sources/_index.md");
  for (const target of wikilinkTargets(sourceIndex)) {
    if (!target.startsWith("sources/")) problems.push(`sources/_index.md links outside sources/: [[${target}]]`);
  }
  return [...new Set(problems)];
}

interface WikilinkRef {
  target: string;
  label: string;
  raw: string;
  line: string;
  indent: number;
}

function wikilinkRefs(markdown: string): WikilinkRef[] {
  const refs: WikilinkRef[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    for (const match of line.matchAll(/(!?)\[\[([^\]]+?)\]\]/g)) {
      if (match[1] === "!") continue;
      const inner = match[2] ?? "";
      const pipe = inner.indexOf("|");
      const rawTarget = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
      const label = (pipe >= 0 ? inner.slice(pipe + 1) : rawTarget.split("/").pop() ?? rawTarget).trim();
      const target = rawTarget.split("#")[0].replace(/^\//, "").replace(/\.md$/i, "").trim();
      refs.push({ target, label, raw: inner, line, indent });
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
  const markdown = readIfExists(filePath);
  if (!markdown) return problems;
  let currentSection: { number: number; title: string; folder: string; label: string } | null = null;
  for (const ref of wikilinkRefs(splitFrontmatter(markdown).body)) {
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
      currentSection = { ...sectionInfo, label: ref.label };
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
  const problems: string[] = [];
  const markdown = readIfExists(path.join(gardenDir, "learning", "Learning Map.md"));
  if (!markdown) return problems;
  const sectionCounts = new Map<string, number>();
  for (const section of sections) {
    const key = normalizedSectionTitleKey(section.sectionTitle);
    sectionCounts.set(key, (sectionCounts.get(key) ?? 0) + 1);
  }
  const mapNodeCounts = new Map<string, number>();
  for (const line of splitFrontmatter(markdown).body.split(/\r?\n/)) {
    const sectionOrder = line.match(/^\s*-\s*\d+\.\s+(.+)$/);
    const trunk = line.match(/^\s*-\s*Trunk:\s*(.+)$/i);
    for (const raw of [sectionOrder?.[1], trunk?.[1]].filter(Boolean) as string[]) {
      const key = normalizedSectionTitleKey(cleanMapNode(raw));
      if (key) mapNodeCounts.set(key, (mapNodeCounts.get(key) ?? 0) + 1);
    }
    const edge = line.match(/^\s*-\s*(.+?)\s*->\s*(.+?)\s*$/);
    if (edge) {
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
  }
  for (const [key, count] of mapNodeCounts) {
    if (count > 1 && (sectionCounts.get(key) ?? 0) > 1) {
      problems.push(`LEARNING_MAP_AMBIGUITY node="${key}" problem="duplicate section node is ambiguous"`);
    }
  }
  return [...new Set(problems)];
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
  const re = coverageHeadingRe(heading);
  const match = re.exec(markdown);
  if (!match) return "";
  const start = (match.index ?? 0) + match[0].length;
  const rest = markdown.slice(start);
  const next = rest.search(/^#{2,3}\s+/m);
  return next >= 0 ? rest.slice(0, next) : rest;
}

function sourceCoverageModePrecisionProblems(gardenDir: string, ledger: Array<Record<string, unknown>>): string[] {
  const problems: string[] = [];
  const coverage = readIfExists(path.join(gardenDir, ".breadboard", "planning", "Source Coverage.md"));
  if (!coverage) return problems;
  if (/^##\s+Figures,\s*Graphs,\s*Tables,\s*And\s*Formula\s*Displays\s*Used\s*$/im.test(coverage)) {
    problems.push('Source Coverage overclaims embedded/display use with legacy heading "Figures, Graphs, Tables, And Formula Displays Used"');
  }
  for (const heading of PRECISE_SOURCE_COVERAGE_HEADINGS) {
    if (!coverageHeadingRe(heading).test(coverage)) {
      problems.push(`Source Coverage missing precise mode heading "${heading}"`);
    }
  }
  const embedded = coverageModeSection(coverage, "Embedded Source Crops");
  const textFormulas = coverageModeSection(coverage, "Explained as Text Formulas");
  const cropFallback = coverageModeSection(coverage, "Crop Omitted With Text Fallback");
  for (const visual of ledger) {
    const id = String(visual.sourceVisualId ?? "");
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
  switch (String(type ?? "")) {
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
  const sourceFiles: PageFile[] = [];
  walkMarkdown(path.join(gardenDir, "sources"), "sources", sourceFiles);
  return sourceFiles
    .map((page) => page.body)
    .join("\n\n");
}

function sourceTextConceptAnchorProblems(
  gardenDir: string,
  embedded: Array<{ page: PageFile; spec: Record<string, unknown> }>,
): string[] {
  const problems: string[] = [];
  if (embedded.length === 0) return problems;
  const corpus = sourceCorpusText(gardenDir);
  if (!corpus.trim()) return problems;
  for (const { page, spec } of embedded) {
    const type = String(spec.type ?? "");
    const concept = proseConceptForVisualType(type);
    if (!concept || !concept.pattern.test(corpus)) continue;
    const status = String(spec.sourceGroundingStatus ?? "");
    const anchors = Array.isArray(spec.sourceAnchors) ? spec.sourceAnchors : [];
    const hasTextAnchor = anchors.some((anchor) =>
      anchor && typeof anchor === "object" && typeof (anchor as Record<string, unknown>).textAnchorId === "string",
    );
    if (status === "conceptual-no-direct-source-figure" && !hasTextAnchor) {
      problems.push(`${page.relPath}: ${type} visual is fully unanchored even though source prose contains ${concept.label}`);
    }
    if (status === "source-derived-conceptual" && !hasTextAnchor) {
      problems.push(`${page.relPath}: ${type} visual is source-derived-conceptual but lacks a textAnchorId`);
    }
  }
  return [...new Set(problems)];
}

function pageNumberedSourceParagraphs(gardenDir: string): Array<{ page: number; text: string }> {
  const sourceFiles: PageFile[] = [];
  walkMarkdown(path.join(gardenDir, "sources"), "sources", sourceFiles);
  const out: Array<{ page: number; text: string }> = [];
  for (const source of sourceFiles) {
    let currentPage = 0;
    let buffer: string[] = [];
    const flush = (): void => {
      const text = buffer.join("\n").trim();
      if (currentPage > 0 && text) out.push({ page: currentPage, text });
      buffer = [];
    };
    for (const line of source.body.split(/\r?\n/)) {
      const heading = line.match(/^\s*#{1,3}\s*Page\s+(\d+)\b/i);
      if (heading) {
        flush();
        currentPage = Number.parseInt(heading[1] ?? "0", 10);
      } else {
        buffer.push(line);
      }
    }
    flush();
  }
  return out;
}

function conceptKeywordsForUnit(unit: LearningUnitContract, page: PageFile): string[] {
  const text = [
    unit.title,
    unit.learningQuestion,
    ...(unit.newConcepts ?? []),
    fmString(page.frontmatter, "title"),
  ].join(" ");
  return [...new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .map((word) => word.replace(/^-+|-+$/g, ""))
      .filter((word) => word.length >= 4 && !BANNED_TAG_SEGMENTS.has(word) && !/^(what|when|where|which|with|from|that|this|into|does|spiking|neural|networks?)$/.test(word)),
  )].slice(0, 8);
}

function sourceTextBodyAnchorProblems(
  gardenDir: string,
  lessonPages: PageFile[],
  learningUnitsById: Map<string, LearningUnitContract>,
): string[] {
  const problems: string[] = [];
  const paragraphs = pageNumberedSourceParagraphs(gardenDir).filter((paragraph) => paragraph.page > 2);
  if (paragraphs.length === 0) return problems;
  for (const page of lessonPages) {
    const unit = learningUnitsById.get(fmString(page.frontmatter, "learningUnitId"));
    if (!unit || !/^(?:training_method|core_concept|mechanism|application|limitation)$/.test(unit.role)) continue;
    const keywords = conceptKeywordsForUnit(unit, page);
    if (keywords.length === 0) continue;
    const matching = paragraphs.find((paragraph) => {
      const lower = paragraph.text.toLowerCase();
      const hits = keywords.filter((keyword) => lower.includes(keyword));
      return hits.length >= Math.min(2, keywords.length);
    });
    if (!matching) continue;
    const anchors = [
      ...fmArray(page.frontmatter, "sourceAnchors"),
      ...fmArray(page.frontmatter, "sourceVisualIds"),
      ...fmArray(page.frontmatter, "sourceFormulaAnchors"),
    ];
    const hasSpecificLaterAnchor = anchors.some((anchor) => {
      if (anchor.startsWith("text-")) return true;
      const pageMatch = anchor.match(/\.P(\d+)\b/i);
      return pageMatch ? Number.parseInt(pageMatch[1] ?? "0", 10) > 2 : false;
    });
    const abstractOnly = anchors.some((anchor) => /abstract|guidance|researchgap/i.test(anchor)) && !hasSpecificLaterAnchor;
    if (!hasSpecificLaterAnchor && abstractOnly) {
      problems.push(`${page.relPath}: ${unit.role} unit is grounded only in abstract/guidance anchors even though page ${matching.page} source prose matches [${keywords.join(", ")}]`);
    }
  }
  return [...new Set(problems)];
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function listGardens(): string[] {
  return fs
    .readdirSync(CONTENT_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name);
}

function pageCountsForReport(gardenDir: string): {
  total: number;
  published: number;
  learner: number;
  sources: number;
} {
  const pages: PageFile[] = [];
  walkMarkdown(gardenDir, "", pages);
  const published = pages.filter((page) => page.published);
  return {
    total: pages.length,
    published: published.length,
    learner: published.filter((page) => {
      const kt = fmString(page.frontmatter, "knowledge_type");
      const bt = fmString(page.frontmatter, "breadboardType");
      return (
        (kt === "learning-page" || kt === "textbook-page" || bt === "learning_page" || bt === "textbook_page") &&
        (fmString(page.frontmatter, "generated_by") === "learn_button" ||
          fmString(page.frontmatter, "generatedBy") === "learn_button")
      );
    }).length,
    sources: published.filter((page) => page.relPath.toLowerCase().startsWith("sources/")).length,
  };
}

export function writeValidationReport(
  gardenDir: string,
  gardenSlug: string,
  results: CheckResult[],
): void {
  const reportDir = path.join(gardenDir, ".breadboard");
  fs.mkdirSync(reportDir, { recursive: true });
  const counts = pageCountsForReport(gardenDir);
  const normalizedResults = results.map(normalizeCheckResult);
  const accepted = validationAccepted(normalizedResults);
  const sourceFiles: string[] = [];
  {
    const allPages: PageFile[] = [];
    walkMarkdown(gardenDir, "", allPages);
    for (const page of allPages) {
      const file = fmString(page.frontmatter, "source_file");
      if (file && !sourceFiles.includes(file)) sourceFiles.push(file);
    }
  }
  const passCount = normalizedResults.filter((r) => r.status === "PASS").length;
  const warnCount = normalizedResults.filter((r) => r.status === "WARN").length;
  const failCount = normalizedResults.filter((r) => r.status === "FAIL").length;
  const skipCount = normalizedResults.filter((r) => r.status === "SKIP").length;
  const blockingFailures = normalizedResults.filter((r) => r.status === "FAIL");
  const blockingWarnings = normalizedResults.filter((r) => r.status === "WARN" && r.acceptanceBlocking);
  const nonBlockingWarnings = normalizedResults.filter((r) => r.status === "WARN" && !r.acceptanceBlocking);
  const skipped = normalizedResults.filter((r) => r.status === "SKIP");
  const lines = [
    "# Breadboard Validation Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Root: ${path.resolve(gardenDir)}`,
    `Garden: ${gardenSlug}`,
    `Source files: ${sourceFiles.length > 0 ? sourceFiles.join(", ") : "(none detected)"}`,
    `Page counts: total=${counts.total}, published=${counts.published}, learner=${counts.learner}, sources=${counts.sources}`,
    `Check results: ${passCount} PASS, ${warnCount} WARN, ${failCount} FAIL, ${skipCount} SKIP`,
    `Accepted: ${accepted ? "yes" : "no"}`,
    `Produced by: scripts/validate-breadboard-garden.ts (runChecks + writeValidationReport), also run as the pipeline's export gate via dashboard/src/lib/garden-finalize.ts`,
    "",
    accepted
      ? "Summary: artifact is acceptable - all critical checks pass."
      : "Summary: artifact is NOT acceptable - see failing checks and file paths below.",
    "",
    "## Export Tree",
    "",
    "See checks 7, 9, 11, 12, 18, 26, and 30.",
    "",
    "## Link Resolution",
    "",
    "See check 17.",
    "",
    "## Semantic Navigation",
    "",
    "See checks 20, 36, and 47.",
    "",
    "## Section Title Uniqueness",
    "",
    "See check 46.",
    "",
    "## Section Folder/Title Consistency",
    "",
    "See check 52.",
    "",
    "## Section Title Naturalness",
    "",
    "See checks 34 and 56.",
    "",
    "## Semantic Navigation Number Matching",
    "",
    "See check 47.",
    "",
    "## Learning Map Ambiguity",
    "",
    "See check 48.",
    "",
    "## Learning Unit Contract Fulfillment",
    "",
    "See checks 8, 23, 31, 32, 33, and 37.",
    "",
    "## Section Semantic Coherence",
    "",
    "See check 37.",
    "",
    "## Section Title Grammar",
    "",
    "See checks 34 and 38.",
    "",
    "## Interactive Visual Grounding",
    "",
    "See checks 23 and 39.",
    "",
    "## Source Map Consistency",
    "",
    "See check 21.",
    "",
    "## Source Map Caveat Reconciliation",
    "",
    "See check 42.",
    "",
    "## Source Coverage Modes",
    "",
    "See checks 22, 26, 43, and 49.",
    "",
    "## Source Anchor Usage vs Crop Status",
    "",
    "See check 43.",
    "",
    "## Formula Grounding",
    "",
    "See checks 25, 40, and 41.",
    "",
    "## Formula Expression Validation",
    "",
    "See check 40.",
    "",
    "## Formula Meaning Match",
    "",
    "See check 41.",
    "",
    "## Formula Family Match",
    "",
    "See check 53.",
    "",
    "## Formula Metadata Noise",
    "",
    "See check 54.",
    "",
    "## Interactive Visual Fulfillment",
    "",
    "See check 23.",
    "",
    "## Final Interactive Visual Uniqueness",
    "",
    "See checks 13, 14, 18, 23, and 31.",
    "",
    "## Visual Anchor Precision",
    "",
    "See check 55.",
    "",
    "## Repetition and Opening Flow",
    "",
    "See check 29.",
    "",
    "## Source Crop Quality",
    "",
    "See checks 12, 35, and 44.",
    "",
    "## Crop Quality and Fallbacks",
    "",
    "See check 44.",
    "",
    "## Source Coverage Mode Precision",
    "",
    "See check 49.",
    "",
    "## Source Text Concept Anchors",
    "",
    "See check 50.",
    "",
    "## Zettelkasten Tags",
    "",
    "See checks 8, 24, and 45.",
    "",
    "## Zettelkasten Tag Density",
    "",
    "See check 45.",
    "",
    "## Zettelkasten Handle Quality",
    "",
    "See checks 31 and 51.",
    "",
    "## Zettelkasten Handle Naturalness",
    "",
    "See check 57.",
    "",
    "## Repair Provenance",
    "",
    "See check 58.",
    "",
    "## Section Title Quality",
    "",
    "See check 34.",
    "",
    "## Acceptance Decision",
    "",
    `Accepted: ${accepted ? "yes" : "no"}`,
    "",
    "Blocking failures:",
    ...(blockingFailures.length > 0
      ? blockingFailures.map((result) => `- ${result.id}. ${result.name}: ${result.problems[0] ?? "failed"}`)
      : ["- None."]),
    "",
    "Blocking warnings:",
    ...(blockingWarnings.length > 0
      ? blockingWarnings.map((result) => `- ${result.id}. ${result.name}: ${result.problems[0] ?? "warning"}`)
      : ["- None."]),
    "",
    "Non-blocking warnings:",
    ...(nonBlockingWarnings.length > 0
      ? nonBlockingWarnings.map((result) => `- ${result.id}. ${result.name}: ${result.problems[0] ?? "warning"}`)
      : ["- None."]),
    "",
    "Skipped as not applicable:",
    ...(skipped.length > 0
      ? skipped.map((result) => `- ${result.id}. ${result.name}${result.reason ? ` (${result.reason})` : ""}`)
      : ["- None."]),
    "",
    "## Final Acceptance",
    "",
    `Accepted: ${accepted ? "yes" : "no"}`,
    "",
    "## Checks",
    "",
  ];
  for (const result of normalizedResults) {
    lines.push(`- [${result.status}] ${result.id}. ${result.name}`);
    if (result.status === "SKIP" && result.reason) lines.push(`  - Reason: ${result.reason}`);
    if (result.status === "WARN" && result.acceptanceBlocking) lines.push("  - Acceptance blocking: yes");
    for (const problem of result.problems) lines.push(`  - ${problem}`);
  }
  fs.writeFileSync(path.join(reportDir, "validation-report.md"), `${lines.join("\n")}\n`, "utf-8");
}

/** Resolve an argument that is either a bare garden slug (under quartz/content)
 * or a path to a garden directory. */
function resolveGarden(arg: string): { dir: string; slug: string } {
  if (arg.includes("/") || arg.includes("\\") || fs.existsSync(arg)) {
    const dir = path.resolve(arg);
    return { dir, slug: path.basename(dir) };
  }
  return { dir: path.join(CONTENT_ROOT, arg), slug: arg };
}

function main(): void {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const targets = args.includes("--all")
    ? listGardens().map((slug) => ({ dir: path.join(CONTENT_ROOT, slug), slug }))
    : args.map(resolveGarden);

  if (targets.length === 0) {
    console.error("Usage: node --experimental-strip-types scripts/validate-breadboard-garden.ts <garden-slug|path> | --all");
    console.error(`Available gardens: ${listGardens().join(", ")}`);
    process.exit(1);
  }

  let anyFailure = false;
  for (const { dir, slug } of targets) {
    console.log(`\n=== ${slug} ===`);
    let results = runChecks(dir, slug);
    writeValidationReport(dir, slug, results);
    results = runChecks(dir, slug);
    writeValidationReport(dir, slug, results);
    const normalized = results.map(normalizeCheckResult);
    for (const result of normalized) {
      const badge = result.status;
      console.log(`[${badge}] ${result.id}. ${result.name}`);
      for (const problem of result.problems.slice(0, 12)) {
        console.log(`       - ${problem}`);
      }
      if (result.problems.length > 12) {
        console.log(`       ... and ${result.problems.length - 12} more`);
      }
    }
    if (!validationAccepted(normalized)) anyFailure = true;
  }

  process.exit(anyFailure ? 1 : 0);
}

// Run the CLI only when invoked directly, not when imported by a test.
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
