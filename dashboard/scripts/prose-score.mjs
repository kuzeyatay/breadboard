#!/usr/bin/env node
/**
 * Score generated prose for AI writing patterns.
 *
 *   node dashboard/scripts/prose-score.mjs quartz/content/physics-for-ee
 *   node dashboard/scripts/prose-score.mjs page.md --findings
 *   node dashboard/scripts/prose-score.mjs quartz/content/test-2 --json
 *   cat draft.md | node dashboard/scripts/prose-score.mjs
 *
 * By default a garden scan looks only at reader-facing pages: `.breadboard`
 * internals, backups, run snapshots and ingested `sources/` are skipped,
 * because scoring the source PDF's own prose or a critic report says nothing
 * about how the pipeline writes. Pass --all to score everything.
 */

import fs from "node:fs";
import path from "node:path";

const { scoreProse, PROSE_SCORE_TARGET } = await import(
  new URL("../src/lib/prose-score/index.ts", import.meta.url).href
);

const HELP = `prose-score: score generated prose for AI writing patterns

Usage:
  prose-score.mjs <file|dir> [options]
  prose-score.mjs               (reads stdin)

Options:
  --findings         List every finding with line numbers (single file)
  --both             Show the plain upstream score beside the tuned one
  --upstream         Score with the untuned upstream pack and no garden masking
  --json             JSON output
  --all              Include .breadboard internals, backups and sources/
  --min-words <n>    Skip files shorter than n words (default 80)
  --fail-above <n>   Exit 2 if any file scores at or above n
  --limit <n>        Show at most n rows (default 40)

Target is ${PROSE_SCORE_TARGET} or under.
`;

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(HELP);
  process.exit(0);
}

const VALUE_FLAGS = new Set(["--min-words", "--fail-above", "--limit"]);

const flags = new Set();
const values = new Map();
const positionals = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg.startsWith("--")) {
    positionals.push(arg);
  } else if (VALUE_FLAGS.has(arg)) {
    values.set(arg, argv[++i]);
  } else {
    flags.add(arg);
  }
}

const flag = (name) => flags.has(name);
const value = (name, fallback) =>
  values.has(name) ? values.get(name) : fallback;

const target = positionals[0];
const asJson = flag("--json");
const showBoth = flag("--both");
const upstreamOnly = flag("--upstream");
const includeAll = flag("--all");
const minWords = Number(value("--min-words", 80));
const failAbove = values.has("--fail-above") ? Number(value("--fail-above")) : null;
const limit = Number(value("--limit", 40));

const SKIP_DIRS = new Set([
  ".git", "node_modules", ".next", "assets", "dist", "build",
]);
const GARDEN_INTERNAL_DIRS = new Set([
  ".breadboard", "backups", "learn-run-snapshots", "sources", "private-library", "public-library",
]);
const EXTS = new Set([".md", ".mdx", ".markdown", ".txt"]);

const upstreamOpts = {
  profile: null,
  maskGardenStructures: false,
  ignoreQuotes: false,
};

function score(text) {
  if (upstreamOnly) return scoreProse(text, upstreamOpts);
  return scoreProse(text);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (!includeAll && GARDEN_INTERNAL_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (EXTS.has(path.extname(entry.name).toLowerCase())) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function row(file, result, upstream) {
  const base = {
    file,
    score: result.score,
    band: result.band,
    words: result.stats.wordCount,
    burstiness: result.stats.burstiness,
    top: result.topPatterns.map((p) => `${p.id} x${p.count}`),
  };
  if (upstream) base.upstreamScore = upstream.score;
  return base;
}

const results = [];

if (!target) {
  const text = await readStdin();
  if (!text.trim()) {
    process.stdout.write(HELP);
    process.exit(1);
  }
  results.push(row("<stdin>", score(text), showBoth ? scoreProse(text, upstreamOpts) : null));
} else {
  const stat = fs.statSync(target);
  const files = stat.isDirectory() ? walk(target) : [target];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const result = score(text);
    if (result.stats.wordCount < minWords) continue;
    results.push(row(file, result, showBoth ? scoreProse(text, upstreamOpts) : null));
  }
  results.sort((a, b) => b.score - a.score);
}

if (flag("--findings")) {
  const file = target && fs.statSync(target).isDirectory() ? null : target;
  const text = file ? fs.readFileSync(file, "utf8") : await readStdin();
  const result = score(text);
  console.log(
    `score: ${result.score}/100  ${result.band}  [${result.profile}]  ` +
      `pattern ${result.patternScore} / uniformity ${result.uniformityScore}  ` +
      `confidence ${result.confidence}`,
  );
  for (const f of result.findings) {
    console.log(
      `  L${String(f.line).padStart(4)}  [${f.category}/${f.id}] ${JSON.stringify(f.match)}` +
        (f.note ? `  (${f.note})` : ""),
    );
  }
} else if (asJson) {
  console.log(JSON.stringify(results, null, 2));
} else if (results.length === 0) {
  console.log("no files matched");
} else {
  const mean = results.reduce((a, r) => a + r.score, 0) / results.length;
  const over = results.filter((r) => r.score > PROSE_SCORE_TARGET).length;
  for (const r of results.slice(0, limit)) {
    const upstreamCol = r.upstreamScore !== undefined ? ` (upstream ${String(r.upstreamScore).padStart(3)})` : "";
    console.log(
      `${String(r.score).padStart(3)}${upstreamCol}  ${r.file}  (${r.words}w)` +
        (r.top.length ? `  top: ${r.top.slice(0, 3).join(", ")}` : ""),
    );
  }
  if (results.length > limit) console.log(`... ${results.length - limit} more`);
  console.log(
    `\n${results.length} files  mean ${mean.toFixed(1)}  ` +
      `over target(${PROSE_SCORE_TARGET}): ${over}/${results.length}`,
  );
}

if (failAbove !== null && results.some((r) => r.score >= failAbove)) {
  process.exit(2);
}
