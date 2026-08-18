#!/usr/bin/env node

/**
 * W2-3F / Part B — a PER-ASSERTION inventory of the source-oriented tests.
 *
 * The test-level inventory was insufficient, and the previous pass proved it:
 * correcting the one assertion the inventory recorded for
 * `hermes-live-routing :: terminal session hook restores…` left the test red,
 * because it carried three independent source-shape assertions. A test-level row
 * cannot predict a test flip.
 *
 * A test run cannot fix this either. `assert` throws on the first failure, so
 * running the suite reveals exactly one failing assertion per test no matter how
 * many are broken. The only way to see all of them is to evaluate each assertion
 * independently — which, for a source-shape assertion, is possible without
 * running the test at all: resolve the subject to the file it reads, then apply
 * the matcher.
 *
 * That is what this does. It extracts every assertion in the target files,
 * resolves the ones whose subject is a source file, and evaluates each on its
 * own. Assertions it cannot resolve are reported as UNRESOLVED rather than
 * guessed at.
 *
 * Run from the repository root.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = process.cwd();
const outPath = path.resolve(process.argv[2] ?? "source-assertion-inventory-v2.json");
const targetsArg = process.argv[3];

/** Tests whose failures are source-oriented, from the W23F policy results and the last full run. */
function defaultTargets() {
  const files = new Set();
  const policy = JSON.parse(
    fs.readFileSync(
      ".qa-results/week2-source-assertion-policy/w23f-20260818T063445Z/source-assertion-policy-results.json",
      "utf8",
    ),
  );
  for (const row of policy.rows) {
    const testFile = row.testId.split(" :: ")[0].replace(/^tests\//, "dashboard/tests/");
    files.add(testFile);
  }
  return [...files].sort();
}

const targetFiles = targetsArg ? targetsArg.split(",") : defaultTargets();

// ---------------------------------------------------------------- helpers

/** Balanced-paren argument split at depth 0, respecting strings and regex literals. */
function splitArguments(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  let quote = null;
  let inRegex = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const previous = text[index - 1];
    if (quote) {
      current += char;
      if (char === quote && previous !== "\\") quote = null;
      continue;
    }
    if (inRegex) {
      current += char;
      if (char === "/" && previous !== "\\") inRegex = false;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "/" && /[(,=:[\s]/.test(previous ?? "(")) {
      inRegex = true;
      current += char;
      continue;
    }
    if ("([{".includes(char)) depth += 1;
    if (")]}".includes(char)) depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Every assert.* call in a file, with its line and full argument list. */
function extractAssertions(text) {
  const found = [];
  const pattern = /\bassert\.([a-zA-Z]+)\s*\(/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    let end = open;
    let quote = null;
    for (let index = open; index < text.length; index += 1) {
      const char = text[index];
      const previous = text[index - 1];
      if (quote) {
        if (char === quote && previous !== "\\") quote = null;
        continue;
      }
      if (char === '"' || char === "'" || char === "`") {
        quote = char;
        continue;
      }
      if (char === "(") depth += 1;
      if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    const inner = text.slice(open + 1, end);
    found.push({
      matcher: match[1],
      line: text.slice(0, match.index).split("\n").length,
      args: splitArguments(inner),
      raw: text.slice(match.index, end + 1),
    });
  }
  return found;
}

/** The enclosing `test("…")` for a line. */
function testNameAt(text, line) {
  const upto = text.split("\n").slice(0, line).join("\n");
  const matches = [...upto.matchAll(/\btest\(\s*(["'`])((?:\\.|(?!\1).)*)\1/g)];
  return matches.length ? matches[matches.length - 1][2] : null;
}

/**
 * Resolve a test-local variable to the repository file it holds, following the
 * three shapes this suite uses to read source.
 */
function buildSubjectMap(testText, testFile) {
  const map = new Map();
  const testDir = path.dirname(path.join(repoRoot, testFile));

  const resolveRelative = (relative) => {
    const cleaned = relative.replace(/^\.\//, "");
    for (const base of [testDir, path.join(testDir, "..")]) {
      const candidate = path.resolve(base, cleaned);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return path.relative(repoRoot, candidate).split(path.sep).join("/");
      }
    }
    const fromRoot = path.resolve(repoRoot, cleaned);
    if (fs.existsSync(fromRoot) && fs.statSync(fromRoot).isFile()) {
      return path.relative(repoRoot, fromRoot).split(path.sep).join("/");
    }
    return null;
  };

  // const NAME = read("path") / source("path"). The argument is frequently
  // wrapped onto its own line, so whitespace and a trailing comma between the
  // paren and the string have to be allowed, or half the suite resolves to
  // nothing and lands in UNRESOLVED for no real reason.
  for (const match of testText.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*\w+\(\s*["'`]([^"'`]+)["'`]\s*,?\s*\)/g)) {
    const resolved = resolveRelative(match[2]);
    if (resolved) map.set(match[1], resolved);
  }
  // const NAME = fs.readFileSync(new URL("path", import.meta.url), "utf8")
  for (const match of testText.matchAll(
    /\b(?:const|let)\s+(\w+)\s*=\s*(?:fs\.)?readFileSync\(\s*new URL\(\s*["'`]([^"'`]+)["'`]/g,
  )) {
    const resolved = resolveRelative(match[2]);
    if (resolved) map.set(match[1], resolved);
  }
  return map;
}

/** Turn a source-literal regex argument into a live RegExp. */
function parseRegexLiteral(argument) {
  const match = /^\/((?:\\.|\[(?:\\.|[^\]])*\]|[^/\\])+)\/([a-z]*)$/.exec(argument.trim());
  if (!match) return null;
  try {
    return new RegExp(match[1], match[2]);
  } catch {
    return null;
  }
}

const SOURCE_MATCHERS = new Set(["match", "doesNotMatch"]);

const rows = [];
for (const testFile of targetFiles) {
  const absolute = path.join(repoRoot, testFile);
  if (!fs.existsSync(absolute)) continue;
  const testText = fs.readFileSync(absolute, "utf8");
  const subjects = buildSubjectMap(testText, testFile);
  const assertions = extractAssertions(testText);

  assertions.forEach((assertion, index) => {
    const testName = testNameAt(testText, assertion.line);
    const subjectExpression = assertion.args[0] ?? "";
    const subjectVariable = /^[A-Za-z_$][\w$]*$/.test(subjectExpression) ? subjectExpression : null;
    const sourceFile = subjectVariable ? subjects.get(subjectVariable) ?? null : null;

    let status = "UNRESOLVED";
    let holds = null;
    let assertionKind = "OTHER";
    let pattern = null;

    if (SOURCE_MATCHERS.has(assertion.matcher)) {
      pattern = assertion.args[1] ?? null;
      const regex = pattern ? parseRegexLiteral(pattern) : null;
      assertionKind = assertion.matcher === "doesNotMatch" ? "SOURCE_ABSENCE" : "SOURCE_REGEX";
      if (sourceFile && regex) {
        const content = fs.readFileSync(path.join(repoRoot, sourceFile), "utf8");
        const matched = regex.test(content);
        holds = assertion.matcher === "doesNotMatch" ? !matched : matched;
        status = holds ? "PASSING" : "FAILING";
      } else {
        status = "UNRESOLVED";
      }
    } else if (assertion.matcher === "equal" && /\.match\(/.test(subjectExpression)) {
      assertionKind = "SOURCE_COUNT";
    } else if (assertion.matcher === "ok" && /\.includes\(/.test(subjectExpression)) {
      assertionKind = "SOURCE_LITERAL";
    } else {
      assertionKind = "RUNTIME_BEHAVIOR";
    }

    rows.push({
      assertionId: `${testFile.split("/").pop().replace(/\.test\.mjs$/, "")}#${assertion.line}`,
      testId: `${testFile.replace(/^dashboard\//, "")} :: ${testName ?? "(module scope)"}`,
      testFile,
      line: assertion.line,
      matcher: assertion.matcher,
      assertionKind,
      subject: subjectExpression.slice(0, 80),
      sourceFileInspected: sourceFile,
      pattern: pattern ? pattern.slice(0, 200) : null,
      status,
      holds,
      ordinalInTest: index,
    });
  });
}

// -------------------------------------------------- per-test aggregation
const byTest = new Map();
for (const row of rows) {
  if (!byTest.has(row.testId)) byTest.set(row.testId, []);
  byTest.get(row.testId).push(row);
}

const tests = [...byTest.entries()].map(([testId, entries]) => {
  const failing = entries.filter((entry) => entry.status === "FAILING");
  const unresolved = entries.filter((entry) => entry.status === "UNRESOLVED");
  return {
    testId,
    testFile: entries[0].testFile,
    totalAssertions: entries.length,
    sourceAssertions: entries.filter((entry) => entry.assertionKind.startsWith("SOURCE")).length,
    failingAssertions: failing.length,
    failingAssertionIds: failing.map((entry) => entry.assertionId),
    unresolvedAssertions: unresolved.length,
    // The rule the previous pass got wrong: a test can only be predicted to flip
    // when EVERY failing assertion in it is resolved, not just the recorded one.
    flippablePrediction:
      failing.length === 0
        ? "already-green-on-resolvable-assertions"
        : `requires ${failing.length} assertion correction(s)`,
  };
});

const multiFailure = tests.filter((entry) => entry.failingAssertions > 1);

const summary = {
  generatedAt: new Date().toISOString(),
  method:
    "Every assert.* call in each target file was extracted, its subject resolved to the source file it reads, and the matcher evaluated independently. A test run cannot produce this: assert throws on the first failure, so at most one failing assertion per test is ever observable from a run.",
  targetFiles: targetFiles.length,
  totals: {
    assertions: rows.length,
    sourceAssertions: rows.filter((row) => row.assertionKind.startsWith("SOURCE")).length,
    failing: rows.filter((row) => row.status === "FAILING").length,
    passing: rows.filter((row) => row.status === "PASSING").length,
    unresolved: rows.filter((row) => row.status === "UNRESOLVED").length,
  },
  byAssertionKind: rows.reduce((accumulator, row) => {
    accumulator[row.assertionKind] = (accumulator[row.assertionKind] ?? 0) + 1;
    return accumulator;
  }, {}),
  testsWithMultipleFailingAssertions: multiFailure.length,
  multiFailureTests: multiFailure,
  tests,
  rows,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(summary, null, 2) + "\n", "utf8");

console.log(`target files: ${targetFiles.length}`);
console.log(`assertions extracted: ${summary.totals.assertions}`);
console.log(`  failing: ${summary.totals.failing}  passing: ${summary.totals.passing}  unresolved: ${summary.totals.unresolved}`);
console.log(`tests with MORE THAN ONE failing assertion: ${multiFailure.length}`);
for (const entry of multiFailure) {
  console.log(`  ${entry.failingAssertions}x  ${entry.testId}`);
}
