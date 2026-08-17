/**
 * Assertion-integrity guard.
 *
 * A self-healing loop's characteristic failure mode is not a bad patch: it is a
 * *green* test that was made green by weakening the thing that was supposed to
 * catch the bug. This guard reads the candidate unified diff and rejects the
 * obvious forms of that, flags the ambiguous ones for a human, and stays quiet
 * about ordinary product edits.
 *
 * It is deliberately conservative in both directions. It does not attempt to
 * understand arbitrary semantic changes to a test; it understands the small set
 * of syntactic moves that reliably mean "the oracle was softened".
 */

import { classifyPath, PATH_KIND } from "./repair-gate.mjs";

export const GUARD_VERSION = 1;

export const VERDICT = Object.freeze({
  CLEAN: "CLEAN",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  REJECTED: "REJECTED",
});

/** Matchers that pin an exact observable value. */
const EXACT_MATCHER = /\b(?:toBe|toEqual|toStrictEqual|toHaveText|toHaveValue|toHaveCount|toHaveURL|toMatchObject|strictEqual|deepStrictEqual)\s*\(/g;
/** Matchers that accept almost anything and are the classic weakening target. */
const VAGUE_MATCHER = /\b(?:toBeTruthy|toBeFalsy|toBeDefined|toBeNull|toBeUndefined|ok)\s*\(/g;
const ASSERTION = /\b(?:expect|assert)\s*[.(]/g;
const SKIP_INTRODUCTION = /\b(?:test|it|describe|suite)\s*\.\s*(?:skip|fixme|todo)\s*\(/;
const ONLY_INTRODUCTION = /\b(?:test|it|describe|suite)\s*\.\s*only\s*\(/;
const EMPTY_CATCH = /catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\/[^\n]*)?\s*\}/;
const SWALLOWING_CATCH = /\.catch\s*\(\s*\(\s*[^)]*\)\s*=>\s*(?:undefined|null|\{\s*\})\s*\)/;
const EXPECTED_THROW = /\b(?:rejects\s*\.\s*toThrow|toThrow(?:Error)?\s*\(|assert\s*\.\s*(?:throws|rejects))/;
const TIMEOUT_ASSIGNMENT = /\b(?:timeout|timeoutMs|actionTimeout|navigationTimeout)\s*[:=]\s*([0-9_]+)/g;
const TIMEOUT_ARGUMENT = /\{\s*timeout\s*:\s*([0-9_]+)\s*\}/g;
const RETRIES_ASSIGNMENT = /\bretries\s*[:=]\s*([0-9_]+)/g;

/** A timeout may grow this much before the guard demands a proven timing defect. */
const TIMEOUT_GROWTH_LIMIT = 3;
/** A first-ever bound above this is flagged for a human, not auto-rejected. */
const NEW_TIMEOUT_REVIEW_CEILING_MS = 120_000;

/**
 * Parse a unified diff into per-file added/removed line lists. Only the
 * information the guard needs is retained; the diff itself is never rewritten.
 */
export function parseUnifiedDiff(diffText) {
  const files = new Map();
  let current = null;
  for (const rawLine of String(diffText ?? "").split(/\r?\n/)) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(rawLine);
    if (header) {
      const filePath = header[2];
      current = files.get(filePath) ?? { path: filePath, added: [], removed: [] };
      files.set(filePath, current);
      continue;
    }
    if (!current) continue;
    if (rawLine.startsWith("+++") || rawLine.startsWith("---") || rawLine.startsWith("@@")) continue;
    if (rawLine.startsWith("+")) current.added.push(rawLine.slice(1));
    else if (rawLine.startsWith("-")) current.removed.push(rawLine.slice(1));
  }
  return [...files.values()];
}

function countMatches(lines, pattern) {
  let total = 0;
  for (const line of lines) {
    pattern.lastIndex = 0;
    total += (line.match(pattern) ?? []).length;
  }
  return total;
}

function maxNumeric(lines, pattern) {
  let max = 0;
  for (const line of lines) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      const value = Number(String(match[1]).replaceAll("_", ""));
      if (Number.isFinite(value) && value > max) max = value;
    }
  }
  return max;
}

function anyLineMatches(lines, pattern) {
  return lines.some((line) => pattern.test(line));
}

function scenarioCriteriaCount(lines) {
  // scenarios.json success criteria are one JSON string per line inside a
  // successCriteria array; counting quoted strings on changed lines is enough
  // to notice that criteria were dropped rather than reworded.
  return lines.filter((line) => /^\s*"/.test(line) && !/^\s*"[a-zA-Z]+"\s*:/.test(line)).length;
}

/**
 * Inspect one candidate diff.
 *
 * @param {string} diffText unified diff produced by `git diff`
 * @param {object} [options]
 * @param {string} [options.classification] finding classification, if known
 * @param {boolean} [options.harnessDefectDeclared] the repair was explicitly
 *   declared a harness/TEST_ENVIRONMENT fix, which permits oracle edits that
 *   are still not weakening
 */
export function reviewAssertionIntegrity(diffText, options = {}) {
  const files = parseUnifiedDiff(diffText);
  const findings = [];
  const harnessFixDeclared =
    options.harnessDefectDeclared === true ||
    ["TEST_ENVIRONMENT", "QA_FIXTURE_MISSING", "QA_HARNESS_LIMITATION"].includes(
      options.classification,
    );

  for (const file of files) {
    const kind = classifyPath(file.path).kind;
    const isOracle = kind === PATH_KIND.QA_ORACLE;

    // `.only` is never acceptable anywhere: it silently deselects every other
    // test in the project and would make a partial run look like a full one.
    if (anyLineMatches(file.added, ONLY_INTRODUCTION) && !anyLineMatches(file.removed, ONLY_INTRODUCTION)) {
      findings.push({
        path: file.path,
        rule: "only-introduced",
        severity: "reject",
        detail: "a .only() focus was introduced, which silently deselects the rest of the suite",
      });
    }

    if (!isOracle) continue;

    if (anyLineMatches(file.added, SKIP_INTRODUCTION) && !anyLineMatches(file.removed, SKIP_INTRODUCTION)) {
      findings.push({
        path: file.path,
        rule: "skip-introduced",
        severity: "reject",
        detail: "test.skip/fixme/todo was introduced in a QA oracle during repair",
      });
    }

    const assertionsRemoved = countMatches(file.removed, ASSERTION);
    const assertionsAdded = countMatches(file.added, ASSERTION);
    if (assertionsRemoved > assertionsAdded) {
      findings.push({
        path: file.path,
        rule: "assertions-removed",
        severity: "reject",
        detail: `net removal of ${assertionsRemoved - assertionsAdded} assertion(s) from a QA oracle`,
      });
    }

    const exactRemoved = countMatches(file.removed, EXACT_MATCHER);
    const exactAdded = countMatches(file.added, EXACT_MATCHER);
    const vagueRemoved = countMatches(file.removed, VAGUE_MATCHER);
    const vagueAdded = countMatches(file.added, VAGUE_MATCHER);
    if (exactRemoved > exactAdded && vagueAdded > vagueRemoved) {
      findings.push({
        path: file.path,
        rule: "exact-comparison-weakened",
        severity: "reject",
        detail:
          `${exactRemoved - exactAdded} exact matcher(s) replaced by ` +
          `${vagueAdded - vagueRemoved} truthiness-style matcher(s)`,
      });
    }

    const timeoutRemoved = Math.max(
      maxNumeric(file.removed, TIMEOUT_ASSIGNMENT),
      maxNumeric(file.removed, TIMEOUT_ARGUMENT),
    );
    const timeoutAdded = Math.max(
      maxNumeric(file.added, TIMEOUT_ASSIGNMENT),
      maxNumeric(file.added, TIMEOUT_ARGUMENT),
    );
    // Inflation needs something to inflate. A brand-new regression test that
    // sets its own bound is establishing one, not weakening an existing one, so
    // only an unusually large first bound is worth a human's attention.
    if (timeoutRemoved > 0 && timeoutAdded > timeoutRemoved * TIMEOUT_GROWTH_LIMIT) {
      findings.push({
        path: file.path,
        rule: "timeout-inflated",
        severity: "reject",
        detail:
          `a timeout grew from ${timeoutRemoved} to ${timeoutAdded}ms ` +
          `(more than ${TIMEOUT_GROWTH_LIMIT}x) without a proven timing defect`,
      });
    } else if (timeoutRemoved === 0 && timeoutAdded > NEW_TIMEOUT_REVIEW_CEILING_MS) {
      findings.push({
        path: file.path,
        rule: "large-timeout-introduced",
        severity: "flag",
        detail: `a new bound of ${timeoutAdded}ms was introduced; confirm it is not masking a hang`,
      });
    }

    const retriesRemoved = maxNumeric(file.removed, RETRIES_ASSIGNMENT);
    const retriesAdded = maxNumeric(file.added, RETRIES_ASSIGNMENT);
    if (retriesAdded > retriesRemoved) {
      findings.push({
        path: file.path,
        rule: "retries-increased",
        severity: "reject",
        detail: `retries increased from ${retriesRemoved} to ${retriesAdded}; a retry hides a defect rather than fixing it`,
      });
    }

    const expectedThrowRemoved = countMatches(file.removed, new RegExp(EXPECTED_THROW.source, "g"));
    const expectedThrowAdded = countMatches(file.added, new RegExp(EXPECTED_THROW.source, "g"));
    const swallowAdded =
      anyLineMatches(file.added, EMPTY_CATCH) || anyLineMatches(file.added, SWALLOWING_CATCH);
    const swallowRemoved =
      anyLineMatches(file.removed, EMPTY_CATCH) || anyLineMatches(file.removed, SWALLOWING_CATCH);
    if (expectedThrowRemoved > expectedThrowAdded) {
      findings.push({
        path: file.path,
        rule: "expected-error-dropped",
        severity: "reject",
        detail: "an expected-error assertion was removed from a QA oracle",
      });
    }
    if (swallowAdded && !swallowRemoved) {
      findings.push({
        path: file.path,
        rule: "exception-swallowed",
        severity: "reject",
        detail: "a broad empty/ignoring catch was introduced in a QA oracle",
      });
    }

    if (/^qa\/autonomous\/scenarios\.json$/.test(classifyPath(file.path).path)) {
      const criteriaRemoved = scenarioCriteriaCount(file.removed);
      const criteriaAdded = scenarioCriteriaCount(file.added);
      if (criteriaRemoved > criteriaAdded) {
        findings.push({
          path: file.path,
          rule: "success-criteria-weakened",
          severity: "reject",
          detail: `scenario manifest lost ${criteriaRemoved - criteriaAdded} success criterion/criteria`,
        });
      }
    }

    // Anything else touching an oracle is legitimate only when the repair was
    // explicitly classified as a harness defect, and even then a human reads it.
    if (!findings.some((finding) => finding.path === file.path && finding.severity === "reject")) {
      findings.push({
        path: file.path,
        rule: harnessFixDeclared ? "declared-harness-oracle-change" : "undeclared-oracle-change",
        severity: "flag",
        detail: harnessFixDeclared
          ? "QA oracle changed under a declared harness/TEST_ENVIRONMENT fix; human review required"
          : "QA oracle changed during a repair that was not declared a harness fix; human review required",
      });
    }
  }

  const rejected = findings.filter((finding) => finding.severity === "reject");
  return {
    guardVersion: GUARD_VERSION,
    verdict:
      rejected.length > 0
        ? VERDICT.REJECTED
        : findings.length > 0
          ? VERDICT.REVIEW_REQUIRED
          : VERDICT.CLEAN,
    inspectedFiles: files.map((file) => file.path),
    findings,
    rejections: rejected,
  };
}
