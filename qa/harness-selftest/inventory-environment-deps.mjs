#!/usr/bin/env node

/**
 * Which dashboard tests depend on inputs a source snapshot cannot carry?
 *
 * This answers it statically, before any run, so the answer can then be *checked*
 * against an actual reconstruction rather than inferred from one. For every test
 * file it follows the local modules the test imports (bounded depth) and looks
 * for references to root-level gitignored directories — the vendored clones and
 * local runtimes git deliberately excludes.
 *
 * Static analysis is the right tool here precisely because the empirical signal
 * is unreliable: the developer's tree changes during a run, so "failed in the
 * reconstruction" conflates environment escape with ordinary drift.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverIgnoredRoots } from "../autonomous/lib/execution-snapshot.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outPath = path.resolve(arg("--out", path.join(repoRoot, "environment-dependencies.json")));
const testsDir = path.join(repoRoot, "dashboard", "tests");
const MAX_DEPTH = 2;

const ignoredRoots = discoverIgnoredRoots(repoRoot);
const ignoredNames = ignoredRoots.map((root) => root.name);
// `node_modules` is an ignored root but is supplied to every worktree by
// design, so it is not an environment *escape*.
const escapeNames = ignoredNames.filter((name) => name !== "node_modules");

function readIfPresent(absolute) {
  try {
    return fs.readFileSync(absolute, "utf8");
  } catch {
    return null;
  }
}

/** Local relative imports only; package imports resolve from node_modules. */
function localImports(source, fromFile) {
  const specifiers = [
    ...source.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g),
    ...source.matchAll(/new URL\(\s*["'](\.[^"']+)["']/g),
    ...source.matchAll(/readFileSync\(\s*["'](\.[^"']+)["']/g),
  ].map((match) => match[1]);

  const resolved = [];
  for (const specifier of new Set(specifiers)) {
    const base = path.resolve(path.dirname(fromFile), specifier);
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.mjs`,
      `${base}.js`,
      path.join(base, "index.ts"),
      path.join(base, "index.tsx"),
    ];
    const hit = candidates.find((candidate) => {
      try {
        return fs.statSync(candidate).isFile();
      } catch {
        return false;
      }
    });
    if (hit) resolved.push(hit);
  }
  return resolved;
}

/**
 * Ignored-root names used as a *filesystem path*, not merely mentioned.
 *
 * A first pass matched any quoted occurrence and flagged 264 of 421 test files,
 * because source is full of string constants naming these integrations
 * (`"opencode"`, `".runtime"`) that never touch the directory. The signal that
 * actually matters is a path being built or read, so the name must appear on a
 * line that also performs path construction or a filesystem/process call.
 */
const FS_CONTEXT =
  /(path\.(join|resolve)|new URL|readFileSync|existsSync|readdirSync|statSync|lstatSync|realpathSync|spawn|execFile|cwd\(\)|__dirname|repoRoot|repositoryRoot)/;

function referencedRoots(source) {
  const found = new Set();
  const lines = source.split(/\r?\n/);
  for (const name of escapeNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // The name must sit inside a path segment: quoted-and-slashed, or adjacent
    // to a separator, on a line that is doing filesystem work.
    const asPathSegment = new RegExp(`["'\`/\\\\]${escaped}(["'\`/\\\\])`);
    for (const line of lines) {
      if (!FS_CONTEXT.test(line)) continue;
      if (asPathSegment.test(line)) {
        found.add(name);
        break;
      }
    }
  }
  return [...found];
}

function walk(entry, depth, seen, hits) {
  if (depth > MAX_DEPTH || seen.has(entry)) return;
  seen.add(entry);
  const source = readIfPresent(entry);
  if (source === null) return;
  for (const name of referencedRoots(source)) {
    const list = hits.get(name) ?? [];
    list.push(path.relative(repoRoot, entry).replaceAll("\\", "/"));
    hits.set(name, list);
  }
  for (const next of localImports(source, entry)) walk(next, depth + 1, seen, hits);
}

const rows = [];
for (const name of fs.readdirSync(testsDir)) {
  if (!/\.(test|spec)\.mjs$/.test(name)) continue;
  const absolute = path.join(testsDir, name);
  const hits = new Map();
  walk(absolute, 0, new Set(), hits);
  if (hits.size === 0) continue;

  for (const [rootName, viaFiles] of hits) {
    const root = ignoredRoots.find((entry) => entry.name === rootName);
    const present = Boolean(root?.present);
    rows.push({
      testFile: `dashboard/tests/${name}`,
      requiredExternalPath: rootName,
      pathType: root?.isGitRepository ? "GITIGNORED_REPO_DEPENDENCY" : "GITIGNORED_LOCAL_DIRECTORY",
      whyRequired: `referenced by ${viaFiles.join(", ")}`,
      referencedVia: viaFiles,
      gitTracked: false,
      gitIgnored: true,
      generated: false,
      repositoryOwned: false,
      mutable: true,
      safeToSnapshot: false,
      safeToCopy: false,
      safeToExecute: true,
      currentAvailability: present ? "PRESENT_IN_DEVELOPER_TREE" : "ABSENT",
      missingBehavior: "absent in any git worktree, because git never carries ignored content",
      failureSignature: null,
    });
  }
}

const byRoot = {};
for (const row of rows) {
  byRoot[row.requiredExternalPath] = (byRoot[row.requiredExternalPath] ?? 0) + 1;
}
const affectedTestFiles = [...new Set(rows.map((row) => row.testFile))];

const summary = {
  generatedAt: new Date().toISOString(),
  method:
    "Static: each dashboard test file was followed through its local relative imports to depth 2, and each module was scanned for path-context references to root-level gitignored directories.",
  ignoredRootCount: ignoredRoots.length,
  escapeCandidateRoots: escapeNames.length,
  affectedTestFileCount: affectedTestFiles.length,
  dependencyRowCount: rows.length,
  byRoot: Object.fromEntries(Object.entries(byRoot).sort((a, b) => b[1] - a[1])),
  affectedTestFiles: affectedTestFiles.sort(),
  dependencies: rows,
  classificationLegend: {
    TRACKED_SOURCE: "carried by the source snapshot",
    UNTRACKED_SOURCE: "carried by the source snapshot",
    GITIGNORED_REPO_DEPENDENCY: "a vendored clone git excludes; no worktree can carry it",
    GITIGNORED_LOCAL_DIRECTORY: "an ignored local directory; no worktree can carry it",
    GENERATED_DETERMINISTIC_INPUT: "reproducible by running a generator",
    LOCAL_PACKAGE_DEPENDENCY: "supplied by node_modules linkage",
    MACHINE_ENVIRONMENT: "host state",
    EXTERNAL_DEPENDENCY: "network or provider",
  },
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(`[env-deps] ${ignoredRoots.length} gitignored roots, ${escapeNames.length} escape candidates`);
console.log(`[env-deps] ${affectedTestFiles.length} test file(s) reference one, ${rows.length} dependency edge(s)`);
for (const [name, count] of Object.entries(summary.byRoot).slice(0, 12)) {
  console.log(`  ${String(count).padStart(3)}  ${name}`);
}
console.log(`[env-deps] wrote ${path.relative(repoRoot, outPath).replaceAll("\\", "/")}`);
