// Shared helpers for end-to-end tests that run against the REAL generated garden
// (quartz/content/test-2). The garden is regenerated periodically and its
// section/page names change, so fixtures must DISCOVER their target pages from
// the on-disk contract + frontmatter instead of hardcoding paths.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repairLearningUnitsFromContract, finalizeGardenExport } from "../../src/lib/garden-finalize.ts";

export const REAL_GARDEN = fileURLToPath(new URL("../../../quartz/content/test-2", import.meta.url));
export const GARDEN_AVAILABLE = fs.existsSync(path.join(REAL_GARDEN, ".breadboard", "learning-unit-contract.json"));
export const skipReason = GARDEN_AVAILABLE ? false : "real generated garden quartz/content/test-2 is not present";

// Files that legitimately change every run (the reports/logs themselves).
export const VOLATILE = /^\.breadboard\/(validation-report\.md|repair-report\.md|repair-log\.json)$/;

export const read = (dir, rel) => fs.readFileSync(path.join(dir, ...rel.split("/")), "utf-8");
export const write = (dir, rel, s) => fs.writeFileSync(path.join(dir, ...rel.split("/")), s, "utf-8");

/** Copy the real garden into a temp dir, drop regenerable noise, and NORMALIZE
 * it to an idempotent baseline by running the deterministic pipeline once.
 *
 * The on-disk garden can carry pre-fix state from an earlier run (stale
 * source-map caveats, orphaned semantic-repair provenance whose repair-log entry
 * no longer exists). The pipeline reconciles that on the next run, so without
 * normalization a "no defect" baseline would still show changes. After one
 * repair+finalize pass a second pass changes nothing, giving fixtures a clean
 * diff surface. */
export async function freshGarden() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-e2e-"));
  const dir = path.join(root, "test-2");
  fs.cpSync(REAL_GARDEN, dir, { recursive: true });
  for (const noise of ["backups", "debug", "events.jsonl", "repair-log.json", "repair-report.md"]) {
    fs.rmSync(path.join(dir, ".breadboard", noise), { recursive: true, force: true });
  }
  await repairLearningUnitsFromContract({ gardenDir: dir, gardenSlug: "test-2" });
  finalizeGardenExport({ gardenDir: dir, gardenSlug: "test-2" });
  return { root, dir };
}

export function snapshot(dir) {
  const out = new Map();
  const walk = (d, rel) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(d, entry.name), r);
      else out.set(r, fs.readFileSync(path.join(d, entry.name)));
    }
  };
  walk(dir, "");
  return out;
}

/** Repo-relative posix paths whose bytes differ from `baseline`, minus volatile
 * report/log files. */
export function changedSince(baseline, dir) {
  const after = snapshot(dir);
  const changed = [];
  for (const [rel, buf] of after) {
    if (VOLATILE.test(rel)) continue;
    if (!baseline.has(rel) || !baseline.get(rel).equals(buf)) changed.push(rel);
  }
  for (const rel of baseline.keys()) {
    if (VOLATILE.test(rel) || after.has(rel)) continue;
    changed.push(`(deleted) ${rel}`);
  }
  return changed.sort();
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

function fmScalar(text, key) {
  return (text.match(new RegExp(`^${key}: "([^"]*)"`, "m")) ?? [])[1] ?? "";
}
function fmArray(text, key) {
  const raw = (text.match(new RegExp(`^${key}: \\[([^\\]]*)\\]`, "m")) ?? [])[1] ?? "";
  return raw.split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
}

/** All learner pages (section subpages), sorted by path. */
export function listLearnerPages(dir) {
  const learningDir = path.join(dir, "learning");
  const pages = [];
  const walk = (d, rel) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(d, entry.name), r);
      else if (entry.name.endsWith(".md") && entry.name !== "_index.md") {
        const text = fs.readFileSync(path.join(d, entry.name), "utf-8");
        pages.push({
          rel: `learning/${r}`,
          title: fmScalar(text, "title"),
          unitId: fmScalar(text, "learningUnitId"),
          sourceFormulaAnchors: fmArray(text, "sourceFormulaAnchors"),
          hasMetricCalculator: /"type": "metric_calculator"/.test(text),
          section: Number.parseInt(r.split("/")[0] ?? "0", 10) || 0,
          text,
        });
      }
    }
  };
  walk(learningDir, "");
  return pages.sort((a, b) => a.rel.localeCompare(b.rel));
}

export function readContract(dir) {
  return JSON.parse(read(dir, ".breadboard/learning-unit-contract.json"));
}

const FORMULA_FAMILY = { E1: "accuracy", E2: "latency", E3: "spike-count", E4: "energy", E5: "efficiency", E6: "convergence" };

/** A learner page grounded to exactly one metric formula, plus a wrong-family
 * anchor to remap it to (for the formula-grounding defect). */
export function findFormulaPage(dir) {
  for (const page of listLearnerPages(dir)) {
    if (page.sourceFormulaAnchors.length < 1) continue;
    const anchor = page.sourceFormulaAnchors.find((candidate) => {
      const code = (candidate.match(/\.(E\d)$/) ?? [])[1];
      return Boolean(code && FORMULA_FAMILY[code]);
    });
    if (!anchor) continue;
    const code = (anchor.match(/\.(E\d)$/) ?? [])[1];
    if (!code || !FORMULA_FAMILY[code]) continue;
    // Pick a wrong anchor from a clearly different family.
    const wrong = code === "E1" ? "S1.P6.E6" : "S1.P6.E1";
    return { rel: page.rel, anchor, wrongAnchor: wrong };
  }
  throw new Error("no formula learner page found");
}

/** A learner page that embeds a metric_calculator visual. */
export function findMetricCalculatorPage(dir) {
  const page = listLearnerPages(dir).find((p) => p.hasMetricCalculator);
  if (!page) throw new Error("no metric_calculator learner page found");
  return { rel: page.rel };
}

/** The section folder whose units are all result_interpretation, plus its
 * _index rel — the target for the section-title/role mismatch defect. */
export function findResultSection(dir) {
  const contract = readContract(dir);
  const roleById = new Map(contract.learningUnits.map((u) => [u.id, u.role]));
  const bySection = new Map();
  for (const page of listLearnerPages(dir)) {
    const section = page.rel.split("/").slice(0, 2).join("/");
    const entry = bySection.get(section) ?? [];
    entry.push(roleById.get(page.unitId));
    bySection.set(section, entry);
  }
  for (const [section, roles] of bySection) {
    const resultCount = roles.filter((r) => r === "result_interpretation").length;
    if (resultCount >= 2 && resultCount >= Math.ceil(roles.length / 2)) {
      return { sectionRel: section, indexRel: `${section}/_index.md`, title: read(dir, `${section}/_index.md`).match(/^title: "([^"]*)"/m)?.[1] ?? "" };
    }
  }
  throw new Error("no result_interpretation-dominant section found");
}

// Minimal replica of garden-finalize's pageRole, used only to pick later pages
// whose deterministic repeated-opening transitions will differ (so the fix does
// not accidentally create a NEW 3x-identical opening).
function pageRole(title) {
  const t = title.toLowerCase();
  if (/open challenge|unresolved|limitation|future work|what remains/.test(t)) return "challenges";
  if (/comparative|results across|models and metrics|model comparison/.test(t)) return "comparison";
  if (/application|hardware|deployment|neuromorphic|tradeoffs suggest/.test(t)) return "application";
  if (/multi-metric|evaluation|metric|accuracy|latency/.test(t)) return "metric";
  if (/neuron model|leaky|\blif\b/.test(t)) return "lif";
  if (/training|paradigm|surrogate|plasticity/.test(t)) return "training";
  if (/what spiking neural networks are|what .*networks are|spiking neural networks are/.test(t)) return "basic_def";
  if (/from conventional|conventional neural networks|introduction|why spiking|to snns/.test(t)) return "intro";
  return "generic";
}

/** `n` later learner pages (section >= 3) with DISTINCT page roles, so injecting
 * the same opening motif and repairing it yields distinct rewritten openings. */
export function findLaterLearnerPages(dir, n) {
  const seenRole = new Set();
  const picked = [];
  for (const page of listLearnerPages(dir).filter((p) => p.section >= 3)) {
    const role = pageRole(page.title);
    if (seenRole.has(role)) continue;
    seenRole.add(role);
    picked.push(page.rel);
    if (picked.length === n) break;
  }
  if (picked.length < n) throw new Error(`could not find ${n} distinct-role later pages`);
  return picked;
}

/** The first body prose paragraph replaced by `transition` (a fake model's
 * minimal single-page rewrite). */
export function rewriteFirstProse(markdown, transition) {
  const fmMatch = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  const fm = fmMatch ? fmMatch[0] : "";
  const body = fmMatch ? markdown.slice(fmMatch[0].length) : markdown;
  const paras = body.replace(/^\n+/, "").split(/\n{2,}/);
  let idx = paras.findIndex((p) => {
    const s = p.trim();
    return s && !s.startsWith("#") && !s.startsWith("!") && !s.startsWith("```");
  });
  if (idx < 0) idx = 0;
  paras[idx] = transition;
  return fm + paras.join("\n\n");
}

/** Inject the same opening motif as a new first body paragraph. Handles pages
 * that carry an H1 in the body AND pages whose title lives only in frontmatter
 * (no body heading) — the latter is the current learner-page format. */
export function injectOpeningMotif(markdown, motif) {
  if (/\n#{1,3} [^\n]+\n\n/.test(markdown)) {
    return markdown.replace(/(\n#{1,3} [^\n]+\n\n)/, `$1${motif}\n\n`);
  }
  const fm = markdown.match(/^---\n[\s\S]*?\n---\n\n?/);
  if (fm) return fm[0] + motif + "\n\n" + markdown.slice(fm[0].length);
  return `${motif}\n\n${markdown}`;
}

export const OPENING_MOTIF =
  "Picture a battery-powered robot moving through a quiet hallway: a dense ANN keeps recomputing every frame while a silent SNN waits for events before doing any work.";
