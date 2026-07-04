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
  "tradeoff_explorer",
]);

// Hard dynamic concepts: a lesson that teaches one must ship an interactive
// visual. Mirrors HARD_CONCEPTS in learn.ts.
const HARD_CONCEPT_PATTERNS: Array<{ label: string; test: RegExp }> = [
  { label: "LIF dynamics", test: /\bleaky integrate[- ]and[- ]fire\b|\blif neuron\b|\bmembrane potential\b|\bfiring threshold\b|\brefractory\b/i },
  { label: "spike coding", test: /\brate coding\b|\btemporal coding\b|\bfirst[- ]spike latency\b/i },
  { label: "STDP", test: /\bspike[- ]timing[- ]dependent plasticity\b|\bstdp\b/i },
  { label: "metric tradeoff", test: /\btrade[- ]?off\b|\benergy per inference\b|\bspike count\b/i },
];

// Concept tag → the evidence a page must show to legitimately carry it.
const TAG_RELEVANCE_RULES: Array<{ appliesTo: RegExp; evidence: RegExp; minBody?: number }> = [
  { appliesTo: /lif-neuron|leaky/i, evidence: /\blif\b|leaky[- ]integrate|membrane potential|threshold/i },
  { appliesTo: /stdp/i, evidence: /\bstdp\b|spike[- ]?timing|synaptic plasticity/i },
  { appliesTo: /surrogate/i, evidence: /surrogate gradient/i },
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

function visualAnchorIds(spec: Record<string, unknown>): string[] {
  const raw = spec.sourceAnchors;
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    for (const key of ["figureId", "tableId", "equationId", "questionId"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) ids.push(value.trim());
    }
  }
  return [...new Set(ids)];
}

function pageSourceIds(page: PageFile): Set<string> {
  return new Set([
    ...fmArray(page.frontmatter, "sourceAnchors"),
    ...fmArray(page.frontmatter, "sourceVisualIds"),
    ...fmArray(page.frontmatter, "sourceFormulaAnchors"),
    fmString(page.frontmatter, "sourceFormulaAnchor"),
  ].filter(Boolean));
}

function isFormulaVisual(visual: Record<string, unknown>): boolean {
  return String(visual.type ?? "") === "equation" || /^S\d+\.P\d+\.E\d+$/i.test(String(visual.sourceVisualId ?? ""));
}

// Metric keyword families shared by a formula's rendered text and a source
// formula caption. Content-based, never positional (mirror of garden-finalize).
const METRIC_KEYWORD_FAMILIES: Array<[string, string[]]> = [
  ["accuracy", ["accuracy", "correct prediction", "correct", "%"]],
  ["latency", ["latency", "decision time", "response time"]],
  ["spike-count", ["spike count", "total spike", "n_{\\text{events}}", "number of spikes"]],
  ["energy", ["energy", "e_{\\text{total}}", "e_{\\text{event}}", "joule", "millijoule"]],
  ["efficiency", ["efficiency", "accuracy over energy", "normalized energy"]],
  ["convergence", ["convergence", "epoch", "target accuracy"]],
];

function metricFamilies(text: string): Set<string> {
  const lower = text.toLowerCase();
  const families = new Set<string>();
  for (const [family, aliases] of METRIC_KEYWORD_FAMILIES) {
    if (aliases.some((alias) => lower.includes(alias))) families.add(family);
  }
  return families;
}

/** A source-anchored formula's rendered text must share at least one metric
 * family with the source formula caption it claims. Accuracy-as-percentage
 * fractions are recognized even without the word "accuracy". */
function formulaMatchesCaption(formulaText: string, caption: string): boolean {
  const captionFamilies = metricFamilies(caption);
  if (captionFamilies.size === 0) return true; // unknown caption: don't over-flag
  const formulaFamilies = metricFamilies(formulaText);
  if (/%|\\%/.test(formulaText) && /\\frac|\//.test(formulaText) && captionFamilies.has("accuracy")) return true;
  for (const family of formulaFamilies) if (captionFamilies.has(family)) return true;
  return false;
}

function unquoteYamlScalar(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

interface FormulaFrontmatterEntry {
  text?: string;
  groundingStatus?: string;
  justification?: string;
  sourceAnchor?: string;
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

function visualText(visual: Record<string, unknown>): string {
  return [
    visual.sourceVisualId,
    visual.type,
    visual.caption,
    visual.description,
    visual.pageNumber,
  ].map((value) => String(value ?? "")).join(" ");
}

// ---------------------------------------------------------------------------
// Check machinery
// ---------------------------------------------------------------------------

interface CheckResult {
  id: number;
  name: string;
  status: "PASS" | "FAIL" | "SKIP";
  problems: string[];
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
  const check = (id: number, name: string, problems: string[], skip = false) => {
    results.push({
      id,
      name,
      status: skip ? "SKIP" : problems.length === 0 ? "PASS" : "FAIL",
      problems,
    });
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

  // 8. Learner lesson pages carry 3-7 page-relevant, namespaced Zettelkasten concept handles; no conceptTags.
  {
    const problems: string[] = [];
    const tagCounts = new Map<string, number>();
    for (const page of lessonPages) {
      if (fmArray(page.frontmatter, "conceptTags").length > 0 || "conceptTags" in page.frontmatter) {
        problems.push(`${page.relPath}: has conceptTags (banned on learner pages)`);
      }
      const tags = fmArray(page.frontmatter, "tags");
      for (const tag of tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      if (tags.length < 3 || tags.length > 7) {
        problems.push(`${page.relPath}: ${tags.length} tags (need 3-7)`);
        continue;
      }
      const haystack = `${fmString(page.frontmatter, "title")}\n${teachingProse(page.body)}`.toLowerCase();
      const titleSlug = slugifyLoose(fmString(page.frontmatter, "title").replace(/^\d+(?:\.\d+)*\.?\s*/, ""));
      for (const tag of tags) {
        if (!/^[a-z0-9][a-z0-9/-]{1,78}[a-z0-9]$/.test(tag)) {
          problems.push(`${page.relPath}: tag "${tag}" is not lower-case kebab-case`);
          continue;
        }
        if (!tag.includes("/")) {
          problems.push(`${page.relPath}: tag "${tag}" is not namespaced (expected namespace/concept-handle)`);
        }
        if (tag === titleSlug || tag.split("/").pop() === titleSlug) {
          problems.push(`${page.relPath}: tag "${tag}" copies the page title slug`);
        }
        if (/\.(pdf|docx?|pptx?|xlsx?|txt|md|csv|zip)$/i.test(tag) || /\d{4,5}-\d{3,}/.test(tag)) {
          problems.push(`${page.relPath}: tag "${tag}" looks like a source filename/id`);
        }
        const words = tag.split(/[/-]/).filter(Boolean);
        const leaf = tag.split("/").pop() ?? tag;
        if (BANNED_TAG_SEGMENTS.has(tag.toLowerCase()) || words.every((word) => BANNED_TAG_SEGMENTS.has(word.toLowerCase()))) {
          problems.push(`${page.relPath}: tag "${tag}" contains a banned generic segment`);
        }
        if (!leaf.includes("-") && BANNED_TAG_SEGMENTS.has(leaf.toLowerCase())) {
          problems.push(`${page.relPath}: tag "${tag}" has a broad one-word leaf`);
        }
        if (/^sn\//.test(tag)) problems.push(`${page.relPath}: tag "${tag}" uses typo root "sn/"`);
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
      const maxAllowed = Math.ceil(lessonPages.length * 0.6);
      for (const [tag, count] of tagCounts) {
        if (count > maxAllowed) problems.push(`tag "${tag}" appears on ${count}/${lessonPages.length} learner pages (too broad/reused)`);
      }
    }
    check(8, "learner pages have 3-7 namespaced zettel concept tags", problems, lessonPages.length === 0);
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
        const page = pageByRel.get(String(visual.assignedPageId ?? ""));
        const url = String(visual.croppedImagePath ?? visual.pageImagePath ?? "");
        if (!page) {
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
    const hardConceptProblems: string[] = [];

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

      // Hard-concept coverage: a lesson teaching a hard dynamic concept must
      // ship an interactive visual (or record an explicit skip reason).
      if (lessonPages.includes(page)) {
        const pageText = `${fmString(page.frontmatter, "title")}\n${page.body}`;
        const hard = HARD_CONCEPT_PATTERNS.find((c) => c.test.test(pageText));
        const skipReason = fmString(page.frontmatter, "visualSkipReason");
        const openChallengePage = /open challenges?|unresolved|limitations?|future work/i.test(pageText);
        if (hard && embedded.length === 0 && !skipReason && !openChallengePage) {
          hardConceptProblems.push(`${page.relPath}: teaches ${hard.label} but has no interactive visual`);
        }
      }
    }

    check(13, "interactive visual IDs consistent (frontmatter = block = spec file = index)", idProblems);
    check(14, "interactive visuals are valid + hard concepts covered", [...contentProblems, ...hardConceptProblems]);

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

    // 16. SNN gardens ship at least four interactive visuals.
    {
      const problems: string[] = [];
      if (isSnnGarden && interactiveCount < 4) {
        problems.push(`only ${interactiveCount} interactive visual(s); an SNN garden needs at least 4`);
      }
      check(16, "SNN garden has >= 4 interactive visuals", problems, !isSnnGarden);
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
        if (/source|conversion|2510-27379|future-of-brain-inspired-computing/i.test(base)) {
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

  // 21. Source Map must not contradict extracted formula anchors.
  {
    const problems: string[] = [];
    const formulaVisuals = ledger.filter(isFormulaVisual);
    if (formulaVisuals.length > 0) {
      const sourceMap = readIfExists(path.join(gardenDir, ".breadboard", "planning", "Source Map.md"));
      if (!sourceMap) {
        problems.push(".breadboard/planning/Source Map.md missing despite formula anchors");
      } else {
        if (/explicit mathematical definitions are not present|formulas? (?:are|is) not present|caption-only/i.test(sourceMap)) {
          problems.push("Source Map says formulas are absent/caption-only even though formula anchors exist");
        }
        if (!/Formula Coverage|explicit metric formulas|formula anchors? (?:are )?present/i.test(sourceMap)) {
          problems.push("Source Map does not explicitly acknowledge formula coverage");
        }
      }
    }
    check(21, "Source Map is consistent with extracted formula anchors", problems, formulaVisuals.length === 0);
  }

  // 22. Source Coverage must treat metric formulas as central when a metric page exists.
  {
    const problems: string[] = [];
    const formulaVisuals = ledger.filter(isFormulaVisual);
    const hasMetricLesson = lessonPages.some((page) =>
      /metric|evaluation|accuracy|latency|energy|spike count|total spike|convergence/i.test(`${fmString(page.frontmatter, "title")} ${page.relPath}`),
    );
    if (formulaVisuals.length > 0 && hasMetricLesson) {
      const coverage = readIfExists(path.join(gardenDir, ".breadboard", "planning", "Source Coverage.md"));
      if (!coverage) {
        problems.push(".breadboard/planning/Source Coverage.md missing despite formula anchors");
      } else {
        for (const visual of formulaVisuals) {
          const id = String(visual.sourceVisualId ?? "");
          if (id && new RegExp(`${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*Not central`, "i").test(coverage)) {
            problems.push(`${id}: Source Coverage marks metric formula as Not central`);
          }
        }
        if (!/Formula Anchor Assignments|central to/i.test(coverage)) {
          problems.push("Source Coverage lacks formula anchor assignments to the metric lesson");
        }
      }
    }
    check(22, "Source Coverage assigns metric formulas centrally", problems, formulaVisuals.length === 0 || !hasMetricLesson);
  }

  // 23. Embedded interactive visuals must be grounded, page-specific, and not
  //     generic mismatches.
  {
    const problems: string[] = [];
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
      const pageText = `${page.relPath} ${fmString(page.frontmatter, "title")}`.toLowerCase();
      if (/metric|evaluation|accuracy|latency|energy|spike count|total spike|convergence/.test(pageText) && type !== "tradeoff_explorer") {
        problems.push(`${page.relPath}: metric/evaluation page uses ${type}; expected tradeoff_explorer`);
      }
      if (/comparative|results|model comparison|models-and-metrics/.test(pageText) && type !== "tradeoff_explorer") {
        problems.push(`${page.relPath}: comparative/results page uses ${type}; expected tradeoff_explorer`);
      }
      if (/application|hardware|neuromorphic|deployment/.test(pageText) && type !== "tradeoff_explorer") {
        problems.push(`${page.relPath}: application/hardware page uses ${type}; expected tradeoff_explorer`);
      }
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
    check(23, "interactive visuals are source-grounded and page-specific", problems, embeddedVisualSpecs.length === 0);
  }

  // 24. Tag namespaces are specific and not broadly reused.
  {
    const problems: string[] = [];
    const counts = new Map<string, number>();
    for (const page of lessonPages) {
      for (const tag of fmArray(page.frontmatter, "tags")) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
        const leaf = tag.split("/").pop() ?? tag;
        if (!tag.includes("/")) problems.push(`${page.relPath}: unnamespaced tag "${tag}"`);
        if (!leaf.includes("-") && BANNED_TAG_SEGMENTS.has(leaf.toLowerCase())) {
          problems.push(`${page.relPath}: broad tag leaf "${tag}"`);
        }
      }
    }
    if (lessonPages.length >= 4) {
      const maxAllowed = Math.ceil(lessonPages.length * 0.6);
      for (const [tag, count] of counts) {
        if (count > maxAllowed) problems.push(`tag "${tag}" appears on ${count}/${lessonPages.length} learner pages`);
      }
    }
    check(24, "learner tags are namespaced and specific", [...new Set(problems)], lessonPages.length === 0);
  }

  // 25. Learner formulas must be explicitly grounded per formula, never with a
  //     broad page-level escape hatch.
  {
    const problems: string[] = [];
    const formulaVisuals = ledger.filter(isFormulaVisual);
    for (const page of lessonPages) {
      const math = extractQuartzMath(page.body);
      if ("formulaGroundingStatus" in page.frontmatter || "formulaJustification" in page.frontmatter) {
        problems.push(`${page.relPath}: uses broad formulaGroundingStatus/formulaJustification instead of per-formula formulas: entries`);
      }
      if (math.length > 0) {
        const formulaAnchors = [
          ...fmArray(page.frontmatter, "sourceFormulaAnchors"),
          fmString(page.frontmatter, "sourceFormulaAnchor"),
        ].filter(Boolean);
        const entries = formulaEntriesFromFrontmatter(page.rawFrontmatter);
        if (entries.length === 0) {
          problems.push(`${page.relPath}: contains math but has no per-formula formulas: frontmatter entries`);
        }
        if (entries.length > 0 && entries.length < math.length) {
          problems.push(`${page.relPath}: has ${math.length} math expression(s) but only ${entries.length} formulas: entr${entries.length === 1 ? "y" : "ies"}`);
        }
        const sourceAnchoredEntries = entries.filter((entry) => entry.groundingStatus === "source-anchored");
        for (const [index, entry] of entries.entries()) {
          const label = `${page.relPath}: formulas[${index}]`;
          if (!String(entry.text ?? "").trim()) problems.push(`${label} missing text`);
          if (!/^(source-anchored|conceptual-helper)$/.test(String(entry.groundingStatus ?? ""))) {
            problems.push(`${label} has invalid groundingStatus "${entry.groundingStatus ?? ""}"`);
          }
          if (!String(entry.justification ?? "").trim()) problems.push(`${label} missing justification`);
          if (entry.groundingStatus === "source-anchored" && !String(entry.sourceAnchor ?? "").trim()) {
            problems.push(`${label} is source-anchored but lacks sourceAnchor`);
          }
          // Content-based grounding: a source-anchored formula's symbols/metric
          // must actually match the caption of the anchor it claims. This
          // catches index-based mapping (e.g. an energy symbol anchored to the
          // normalized-efficiency equation).
          if (entry.groundingStatus === "source-anchored" && entry.sourceAnchor) {
            const anchorVisual = ledger.find((visual) => String(visual.sourceVisualId ?? "") === entry.sourceAnchor);
            const caption = String(anchorVisual?.caption ?? "");
            if (caption && !formulaMatchesCaption(String(entry.text ?? ""), caption)) {
              problems.push(
                `${label} is anchored to ${entry.sourceAnchor} but its content does not match that source formula ("${caption}")`,
              );
            }
          }
        }
        if (formulaAnchors.length > 0 && sourceAnchoredEntries.length === 0) {
          problems.push(`${page.relPath}: has sourceFormulaAnchors but no source-anchored formula entry`);
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
    check(27, "source visuals match page semantics", [...new Set(problems)], !isSnnGarden || !ledgerExists);
  }

  // 28. Tags must be central to the page, not only namespaced.
  {
    const problems: string[] = [];
    for (const page of lessonPages) {
      const haystack = `${fmString(page.frontmatter, "title")} ${teachingProse(page.body)}`.toLowerCase();
      const pageText = `${page.relPath} ${fmString(page.frontmatter, "title")}`.toLowerCase();
      for (const tag of fmArray(page.frontmatter, "tags")) {
        const leaf = (tag.split("/").pop() ?? tag).toLowerCase();
        const distinctive = leaf
          .split("-")
          .filter((word) => word.length >= 4 && !BANNED_TAG_SEGMENTS.has(word));
        if (distinctive.length > 0 && !distinctive.some((word) => haystack.includes(word))) {
          problems.push(`${page.relPath}: tag "${tag}" is namespaced but not semantically central to the page`);
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
    check(28, "learner tags are central to their pages", [...new Set(problems)], lessonPages.length === 0);
  }

  // 29. Repeated learner-page openings are rejected, including the known
  //     battery-robot / quiet-hallway / dense-ANN / silent-SNN motif.
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
    check(29, "learner page openings are not repeated across pages", problems, lessonPages.length < 3);
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
      if (!/\[(?:PASS|FAIL|SKIP)\]/.test(report)) problems.push("validation report missing check statuses");
      if (!/^Accepted:\s+(?:yes|no)$/im.test(report)) problems.push("validation report missing accepted yes/no");
    }
    check(30, "validation report is exported", problems);
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
  const accepted = results.every((result) => result.status !== "FAIL");
  const sourceFiles: string[] = [];
  {
    const allPages: PageFile[] = [];
    walkMarkdown(gardenDir, "", allPages);
    for (const page of allPages) {
      const file = fmString(page.frontmatter, "source_file");
      if (file && !sourceFiles.includes(file)) sourceFiles.push(file);
    }
  }
  const passCount = results.filter((r) => r.status === "PASS").length;
  const failCount = results.filter((r) => r.status === "FAIL").length;
  const skipCount = results.filter((r) => r.status === "SKIP").length;
  const lines = [
    "# Breadboard Validation Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Root: ${path.resolve(gardenDir)}`,
    `Garden: ${gardenSlug}`,
    `Source files: ${sourceFiles.length > 0 ? sourceFiles.join(", ") : "(none detected)"}`,
    `Page counts: total=${counts.total}, published=${counts.published}, learner=${counts.learner}, sources=${counts.sources}`,
    `Check results: ${passCount} PASS, ${failCount} FAIL, ${skipCount} SKIP`,
    `Accepted: ${accepted ? "yes" : "no"}`,
    `Produced by: scripts/validate-breadboard-garden.ts (runChecks + writeValidationReport), also run as the pipeline's export gate via dashboard/src/lib/garden-finalize.ts`,
    "",
    accepted
      ? "Summary: artifact is acceptable — all critical checks pass."
      : "Summary: artifact is NOT acceptable — see failing checks and file paths below.",
    "",
    "## Checks",
    "",
  ];
  for (const result of results) {
    lines.push(`- [${result.status}] ${result.id}. ${result.name}`);
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
    for (const result of results) {
      const badge = result.status === "PASS" ? "PASS" : result.status === "SKIP" ? "SKIP" : "FAIL";
      console.log(`[${badge}] ${result.id}. ${result.name}`);
      for (const problem of result.problems.slice(0, 12)) {
        console.log(`       - ${problem}`);
      }
      if (result.problems.length > 12) {
        console.log(`       ... and ${result.problems.length - 12} more`);
      }
      if (result.status === "FAIL") anyFailure = true;
    }
  }

  process.exit(anyFailure ? 1 : 0);
}

// Run the CLI only when invoked directly, not when imported by a test.
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
