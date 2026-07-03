// Breadboard learning-garden validator.
//
// Checks a generated garden under quartz/content/<garden> against the pipeline
// acceptance rules (learner voice, hidden sources, source-visual coverage,
// interactive-visual ID consistency, zettel tags). Zero dependencies; the type
// annotations are erasable so it runs on Node >= 22 via:
//
//   node --experimental-strip-types scripts/validate-breadboard-garden.ts <garden> [more gardens...]
//   node --experimental-strip-types scripts/validate-breadboard-garden.ts --all
//
// or from dashboard/: npm run validate:garden -- <garden>
//
// Exit code 0 = all checks pass, 1 = at least one failure.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_ROOT = path.resolve(SCRIPT_DIR, "..", "quartz", "content");

// ---------------------------------------------------------------------------
// Shared rule mirrors (keep in sync with dashboard/src/lib/learn-utils.ts and
// quartz/quartz/plugins/filters/draft.ts)
// ---------------------------------------------------------------------------

const SOURCE_COMMENTARY_PHRASES = [
  "the paper says",
  "the paper argues",
  "the paper opens",
  "the paper frames",
  "the source frames",
  "the source argues",
  "the source material explains",
  "in this paper",
  "in the paper",
  "in the source's framing",
  "source-derived",
  "source-central",
  "according to the paper",
  "according to the source",
];

const BANNED_TAG_SEGMENTS = new Set([
  "paper", "source", "sources", "what", "model", "models", "test", "tests",
  "overview", "coverage", "visual", "visuals", "context", "contract", "scope",
  "abstract", "abstract-spiking", "accepted-october", "access-article",
  "garden", "note", "notes", "page", "pages", "section", "sections", "misc",
  "general", "document", "documents", "pdf", "file", "files", "upload",
  "uploads", "learning", "textbook", "introduction", "conclusion", "summary",
  "content", "material", "materials", "topic", "topics", "concept", "concepts",
]);

const INTERNAL_KNOWLEDGE_TYPES = new Set([
  "internal-concept", "source-document", "source-map", "scope-contract",
  "source-coverage", "learning-map",
]);

const NO_TAG_KNOWLEDGE_TYPES = new Set([
  ...INTERNAL_KNOWLEDGE_TYPES, "topic-overview", "cluster-index", "garden-overview",
]);

// Interactive or nothing: only these types have a real interactive renderer.
// Anything else embedded in a page would render as nothing, so it is a failure.
const INTERACTIVE_VISUAL_TYPES = new Set([
  "function_plot", "linked_time_plots", "mass_spring", "energy_exchange",
  "resonance_curve",
]);

// ---------------------------------------------------------------------------
// Tiny frontmatter + fs helpers
// ---------------------------------------------------------------------------

interface PageFile {
  absPath: string;
  relPath: string; // garden-relative, posix separators
  frontmatter: Record<string, string | string[]>;
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
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  const frontmatter: Record<string, string | string[]> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    frontmatter[line.slice(0, index).trim()] = parseYamlValue(line.slice(index + 1));
  }
  return { frontmatter, body: match[2] ?? "" };
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

// Mirror of quartz RemoveDrafts.shouldPublish.
function isPublished(relPath: string, fm: Record<string, string | string[]>): boolean {
  const parts = relPath.split("/");
  const lowerParts = parts.map((part) => part.toLowerCase());
  if (
    lowerParts.some(
      (part) =>
        part === "sources" || part === "internal" || part === ".breadboard" ||
        part === "generated" || part === "generated subtopics" || part === "subtopics" ||
        part === "ai topics" || part === "topic cards",
    )
  ) {
    return false;
  }
  if (fmString(fm, "legacy_subtopic_page") === "true") return false;
  if (fmString(fm, "draft") === "true" || fm["draft"] === "true") return false;
  if (fmString(fm, "internal") === "true") return false;
  const knowledgeType = fmString(fm, "knowledge_type");
  const breadboardType = fmString(fm, "breadboardType") || fmString(fm, "breadboard_type");
  if (INTERNAL_KNOWLEDGE_TYPES.has(knowledgeType)) return false;
  if (INTERNAL_KNOWLEDGE_TYPES.has(breadboardType.replace(/_/g, "-"))) return false;

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
    const { frontmatter, body } = splitFrontmatter(content);
    output.push({
      absPath,
      relPath: rel,
      frontmatter,
      body,
      published: isPublished(rel, frontmatter),
    });
  }
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

function runChecks(gardenSlug: string): CheckResult[] {
  const gardenDir = path.join(CONTENT_ROOT, gardenSlug);
  if (!fs.existsSync(gardenDir)) {
    return [{ id: 0, name: "garden exists", status: "FAIL", problems: [`No such garden: ${gardenDir}`] }];
  }

  const pages: PageFile[] = [];
  walkMarkdown(gardenDir, "", pages);
  const published = pages.filter((page) => page.published);
  const lessonPages = published.filter(
    (page) =>
      fmString(page.frontmatter, "knowledge_type") === "textbook-page" &&
      (fmString(page.frontmatter, "generated_by") === "learn_button" ||
        fmString(page.frontmatter, "generatedBy") === "learn_button"),
  );

  const results: CheckResult[] = [];
  const check = (id: number, name: string, problems: string[], skip = false) => {
    results.push({
      id,
      name,
      status: skip ? "SKIP" : problems.length === 0 ? "PASS" : "FAIL",
      problems,
    });
  };

  // 1. No "textbook" anywhere learner-facing.
  {
    const problems: string[] = [];
    for (const page of published) {
      const surfaces: Array<[string, string]> = [
        ["path", page.relPath],
        ["title", fmString(page.frontmatter, "title")],
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

  // 2. Near-zero source-commentary phrasing in learner prose + clean titles.
  {
    const problems: string[] = [];
    let total = 0;
    for (const page of published) {
      const text = page.body.toLowerCase();
      let count = 0;
      for (const phrase of SOURCE_COMMENTARY_PHRASES) {
        count += text.split(phrase).length - 1;
      }
      total += count;
      if (count > 2) problems.push(`${page.relPath}: ${count} commentary phrases`);
      const title = fmString(page.frontmatter, "title");
      if (/\b(paper|source|textbook)\b/i.test(title)) {
        problems.push(`${page.relPath}: title reads as source commentary ("${title}")`);
      }
    }
    if (total > 5) problems.push(`garden total: ${total} commentary phrases (max 5)`);
    check(2, "learner prose teaches directly (no paper commentary)", problems);
  }

  // 3. No visible sources/ folder.
  {
    const problems = pages
      .filter((page) => /(^|\/)sources\//i.test(`${page.relPath}`) && page.published)
      .map((page) => page.relPath);
    check(3, "raw sources are not learner-visible", problems);
  }

  // 4. No visible numbered folder named after the uploaded file.
  {
    const sourceFileBases = new Set(
      pages
        .map((page) => fmString(page.frontmatter, "source_file"))
        .filter(Boolean)
        .map((file) => slugifyLoose(file.replace(/\.(pdf|docx?|pptx?|xlsx?|txt|md|csv|zip)$/i, ""))),
    );
    const problems: string[] = [];
    for (const page of published) {
      const top = page.relPath.split("/")[0];
      const numbered = top.match(/^\d+\.\s*(.+)$/);
      if (!numbered) continue;
      if (sourceFileBases.has(slugifyLoose(numbered[1]))) {
        problems.push(`${top}/ (contains published ${page.relPath})`);
      }
    }
    check(4, "no visible folder named after the raw upload", [...new Set(problems)]);
  }

  // 5. Learner lesson pages carry 3-6 useful hierarchical tags.
  {
    const problems: string[] = [];
    for (const page of lessonPages) {
      const tags = fmArray(page.frontmatter, "tags");
      if (tags.length < 3 || tags.length > 6) {
        problems.push(`${page.relPath}: ${tags.length} tags (need 3-6)`);
        continue;
      }
      for (const tag of tags) {
        const segments = tag.split("/").filter(Boolean);
        if (segments.length < 2) {
          problems.push(`${page.relPath}: tag "${tag}" is not hierarchical (domain/concept)`);
        } else if (segments.some((segment) => BANNED_TAG_SEGMENTS.has(segment.toLowerCase()))) {
          problems.push(`${page.relPath}: tag "${tag}" contains a banned generic segment`);
        }
      }
    }
    check(5, "lesson pages have 3-6 hierarchical zettel tags", problems, lessonPages.length === 0);
  }

  // 6. Internal/source/planning pages carry no public tags.
  {
    const problems: string[] = [];
    for (const page of pages) {
      const knowledgeType = fmString(page.frontmatter, "knowledge_type");
      const internalByType = NO_TAG_KNOWLEDGE_TYPES.has(knowledgeType);
      const internalByPath = /(^|\/)(sources|internal|learning)\//i.test(`${page.relPath}`) ||
        /^(sources|internal|learning)\//i.test(page.relPath);
      if (!internalByType && !internalByPath) continue;
      const tags = fmArray(page.frontmatter, "tags");
      if (tags.length > 0) problems.push(`${page.relPath}: has tags [${tags.join(", ")}]`);
    }
    check(6, "internal/source/planning pages have no tags", problems);
  }

  // Ledger-backed checks (7, 8, 12).
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

  // 7. Every extracted source visual is assigned or intentionally skipped.
  {
    const problems: string[] = [];
    if (!ledgerExists && lessonPages.length > 0) {
      problems.push(".breadboard/source-visuals.json missing (Stage 2 never ran for this garden)");
    }
    for (const visual of ledger) {
      const status = String(visual.usageStatus ?? "");
      if (status !== "assigned" && status !== "intentionally_skipped") {
        problems.push(`${String(visual.sourceVisualId)}: usageStatus "${status || "missing"}"`);
      }
      if (status === "intentionally_skipped" && !String(visual.skipReason ?? "").trim()) {
        problems.push(`${String(visual.sourceVisualId)}: skipped without a reason`);
      }
    }
    check(7, "every source visual assigned or skipped with reason", problems, !ledgerExists && lessonPages.length === 0);
  }

  // 8. Every assigned visual really appears in its assigned page body.
  {
    const problems: string[] = [];
    const pageByRel = new Map(pages.map((page) => [page.relPath.replace(/\.md$/i, ""), page]));
    for (const visual of ledger) {
      if (String(visual.usageStatus) !== "assigned") continue;
      const pageId = String(visual.assignedPageId ?? "");
      const page = pageByRel.get(pageId);
      if (!page) {
        problems.push(`${String(visual.sourceVisualId)}: assigned page "${pageId}" not found`);
        continue;
      }
      const url = String(visual.croppedImagePath ?? visual.pageImagePath ?? "");
      if (!url || !page.body.includes(url)) {
        problems.push(`${String(visual.sourceVisualId)}: image not embedded in ${pageId}`);
      }
    }
    check(8, "assigned source visuals are embedded in their pages", problems, !ledgerExists);
  }

  // 9 + 10 + 11. Interactive visual consistency and content.
  {
    const idProblems: string[] = [];
    const contentProblems: string[] = [];
    const visualsDir = path.join(gardenDir, ".breadboard", "visuals");
    let index: Record<string, unknown> = {};
    try {
      index = JSON.parse(
        fs.readFileSync(path.join(gardenDir, ".breadboard", "visual-index.json"), "utf-8"),
      );
    } catch {
      index = {};
    }

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
        const type = String(spec.type ?? "");
        if (!INTERACTIVE_VISUAL_TYPES.has(type)) {
          contentProblems.push(
            `${page.relPath}: visual ${spec.id} has non-interactive type "${type}" (would render as nothing)`,
          );
        }
        const props = spec.props;
        const propsEmpty =
          !props || typeof props !== "object" ||
          Object.entries(props as Record<string, unknown>).every(
            ([, value]) => Array.isArray(value) && value.length === 0,
          );
        if (propsEmpty) {
          contentProblems.push(`${page.relPath}: visual ${spec.id} has empty placeholder props`);
        }
        const caption = String(spec.caption ?? "");
        if (/^source-anchored explainer/i.test(caption) || /^conceptual checkpoint/i.test(caption)) {
          contentProblems.push(`${page.relPath}: visual ${spec.id} has a generic placeholder caption`);
        }
        if (!String(spec.regenerationPrompt ?? "").trim()) {
          contentProblems.push(`${page.relPath}: visual ${spec.id} lacks regenerationPrompt (regenerate button context)`);
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
    check(9, "interactive visual IDs consistent (frontmatter = block = spec file = index)", idProblems);
    check(10, "no empty/placeholder interactive visuals", contentProblems);

    // 11. Regenerate button: rendered by the Quartz component for every valid
    // block. Verify the renderer still has the button and that no page embeds
    // a block the renderer would reject (covered above), so every rendered
    // visual gets the button.
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
    check(11, "regenerate button rendered below every interactive visual", [
      ...rendererProblems,
      ...contentProblems.filter((problem) => problem.includes("not valid JSON")),
    ]);
  }

  // 12. Full-page screenshots are never counted as figures.
  {
    const problems: string[] = [];
    const pageSnapshotRe = /-page-\d{3,}(?:-\d+)?\.(?:png|jpe?g|webp)$/i;
    for (const visual of ledger) {
      const type = String(visual.type ?? "");
      const cropped = String(visual.croppedImagePath ?? "");
      if (type === "full_page_fallback") continue;
      if (cropped && pageSnapshotRe.test(cropped)) {
        problems.push(`${String(visual.sourceVisualId)}: full-page snapshot used as ${type}`);
      }
      if (!cropped && String(visual.usageStatus) === "assigned") {
        problems.push(
          `${String(visual.sourceVisualId)}: assigned as ${type} but embeds the uncropped page (mark full_page_fallback)`,
        );
      }
    }
    // Legacy figure ids that were page snapshots ("S1.P17.F1: ... Page 17").
    for (const page of lessonPages) {
      for (const id of fmArray(page.frontmatter, "sourceVisualIds")) {
        const inLedger = ledger.some((visual) => String(visual.sourceVisualId) === id);
        if (!inLedger) problems.push(`${page.relPath}: sourceVisualId ${id} not in ledger`);
      }
    }
    check(12, "full-page snapshots only ever used as explicit fallbacks", problems, !ledgerExists);
  }

  return results;
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

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const gardens = args.includes("--all") ? listGardens() : args;

if (gardens.length === 0) {
  console.error("Usage: node --experimental-strip-types scripts/validate-breadboard-garden.ts <garden-slug> | --all");
  console.error(`Available gardens: ${listGardens().join(", ")}`);
  process.exit(1);
}

let anyFailure = false;
for (const garden of gardens) {
  console.log(`\n=== ${garden} ===`);
  const results = runChecks(garden);
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
