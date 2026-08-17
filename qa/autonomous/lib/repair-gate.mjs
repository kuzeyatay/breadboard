/**
 * Machine-enforced repair gate.
 *
 * The QA loop's most important safety property is that a failure which is not a
 * reproduced product defect can never cause a production source edit. That
 * property is enforced here, structurally, rather than by instructing a model to
 * behave. Every repair invocation must pass its finding through
 * `evaluateRepairGate` and its candidate diff through `enforceChangedFiles`.
 *
 * This module is intentionally dependency-free and synchronous so it can be
 * unit-tested exhaustively without a repository, a worktree, or Electron.
 */

export const GATE_VERSION = 1;

/** The only classification that can authorise a production source mutation. */
export const REPAIR_ELIGIBLE_CLASSIFICATIONS = Object.freeze(["PRODUCT_BUG"]);

/**
 * Every classification the scenario recorder can emit that is *not* repair
 * eligible. Listed explicitly so a newly introduced classification fails closed
 * (unknown values are blocked) instead of silently inheriting permission.
 */
export const NON_REPAIR_CLASSIFICATIONS = Object.freeze([
  "TEST_ENVIRONMENT",
  "EXTERNAL_DEPENDENCY",
  "EXPECTED_BEHAVIOR",
  "FLAKY",
  "MISSING_FEATURE",
  "QA_FIXTURE_MISSING",
  "QA_HARNESS_LIMITATION",
  "OPTIONAL_DEPENDENCY_NOT_CONFIGURED",
  "PRODUCT_PREREQUISITE_MISSING",
  "INTENTIONALLY_UNSUPPORTED",
]);

/**
 * Classifications that describe a defect in the harness itself. A repair may
 * touch QA harness code for these, never production source.
 */
export const HARNESS_REPAIR_CLASSIFICATIONS = Object.freeze([
  "TEST_ENVIRONMENT",
  "QA_FIXTURE_MISSING",
  "QA_HARNESS_LIMITATION",
]);

/** Classifications that always require a human decision before any edit. */
export const HUMAN_GATE_CLASSIFICATIONS = Object.freeze(["MISSING_FEATURE"]);

export const MUTATION_SCOPE = Object.freeze({
  NONE: "none",
  QA_HARNESS_ONLY: "qa-harness-only",
  PRODUCTION_SOURCE: "production-source",
});

export const PATH_KIND = Object.freeze({
  PRODUCT: "product",
  QA_HARNESS: "qa-harness",
  QA_ORACLE: "qa-oracle",
  QA_EVIDENCE: "qa-evidence",
  INFRASTRUCTURE: "infrastructure",
  FORBIDDEN: "forbidden",
});

/**
 * Paths a bounded autonomous repair may never touch, and in which a controlled
 * experiment may never seed a defect. These are the trust boundaries: getting
 * one wrong is a security incident, not a failed test.
 */
const FORBIDDEN_PATTERNS = Object.freeze([
  { pattern: /(^|\/)\.git(\/|$)/, reason: "git internals" },
  { pattern: /(^|\/)node_modules(\/|$)/, reason: "installed dependencies" },
  { pattern: /(^|\/)\.env(\.|$)/, reason: "environment/credential file" },
  { pattern: /(^|\/)(secrets?|credentials?)[^/]*$/i, reason: "credential store" },
  { pattern: /(^|\/)auth[^/]*\.(ts|tsx|mjs|cjs|js|jsx)$/i, reason: "authentication code" },
  { pattern: /(^|\/)server-auth\.(ts|tsx|mjs|js)$/i, reason: "server authentication" },
  { pattern: /(^|\/)better-auth(\/|[^/]*\.)/i, reason: "authentication library wiring" },
  { pattern: /(^|\/)api\/auth(\/|$)/i, reason: "authentication route" },
  { pattern: /capabilit(y|ies)/i, reason: "capability-token boundary" },
  { pattern: /(^|\/)permissions?(\/|[-.])/i, reason: "permission gate" },
  { pattern: /(^|\/)preload[^/]*\.(ts|js|mjs|cjs)$/i, reason: "Electron preload bridge" },
  { pattern: /(^|\/)(sandbox|security)[^/]*\.(ts|js|mjs|cjs)$/i, reason: "Electron sandbox/security" },
  { pattern: /(^|\/)migrations?(\/|$)/i, reason: "database migration" },
  { pattern: /(^|\/)migrate[^/]*\.(ts|js|mjs|sql)$/i, reason: "database migration" },
  { pattern: /(^|\/)(installer|updater)[^/]*/i, reason: "installer/update path" },
  { pattern: /electron-builder/i, reason: "packaging/installer configuration" },
  { pattern: /(^|\/)package-lock\.json$/, reason: "dependency lockfile" },
  { pattern: /(^|\/)(bun\.lockb?|pnpm-lock\.yaml|yarn\.lock)$/, reason: "dependency lockfile" },
]);

/** QA files that encode what "correct" means: the oracle. */
const QA_ORACLE_PATTERNS = Object.freeze([
  /^qa\/electron\/specs\//,
  /^qa\/autonomous\/scenarios\.json$/,
  /^qa\/fixtures\//,
  /^qa\/harness-selftest\//,
  /^dashboard\/tests\//,
  /^desktop\/tests\//,
  /(^|\/)[^/]+\.(test|spec)\.(ts|tsx|mjs|cjs|js|jsx)$/,
]);

const QA_HARNESS_PATTERNS = Object.freeze([/^qa\//]);
const QA_EVIDENCE_PATTERNS = Object.freeze([/^\.qa-results\//, /^\.qa-worktrees\//, /^\.qa-runtime\//]);
const INFRASTRUCTURE_PATTERNS = Object.freeze([
  /^package\.json$/,
  /(^|\/)package\.json$/,
  /^\.github\//,
  /^\.gitignore$/,
]);

/** Normalise a path to repo-relative POSIX form for pattern matching. */
export function normalizeRepoPath(filePath) {
  return String(filePath).replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/**
 * Decide what kind of file a repo-relative path is. Forbidden wins over every
 * other kind, and the QA oracle wins over generic QA harness, so a spec file
 * under `qa/` is never silently treated as ordinary harness plumbing.
 */
/**
 * Match a path against a pattern set, testing the directory form too.
 *
 * Patterns are written against files (`^dashboard/tests/`), so a bare directory
 * would otherwise fall through to "production source" — which would let a repair
 * scope itself to a directory full of oracles. Testing `${path}/` as well closes
 * that without loosening any pattern.
 */
function matchesAny(patterns, normalized) {
  const asDirectory = `${normalized}/`;
  return patterns.some((pattern) => pattern.test(normalized) || pattern.test(asDirectory));
}

export function classifyPath(filePath) {
  const normalized = normalizeRepoPath(filePath);
  for (const entry of FORBIDDEN_PATTERNS) {
    if (entry.pattern.test(normalized) || entry.pattern.test(`${normalized}/`)) {
      return { path: normalized, kind: PATH_KIND.FORBIDDEN, reason: entry.reason };
    }
  }
  if (matchesAny(QA_EVIDENCE_PATTERNS, normalized)) {
    return { path: normalized, kind: PATH_KIND.QA_EVIDENCE, reason: "disposable QA evidence" };
  }
  if (matchesAny(QA_ORACLE_PATTERNS, normalized)) {
    return { path: normalized, kind: PATH_KIND.QA_ORACLE, reason: "QA oracle / assertions" };
  }
  if (matchesAny(QA_HARNESS_PATTERNS, normalized)) {
    return { path: normalized, kind: PATH_KIND.QA_HARNESS, reason: "QA harness" };
  }
  if (matchesAny(INFRASTRUCTURE_PATTERNS, normalized)) {
    return { path: normalized, kind: PATH_KIND.INFRASTRUCTURE, reason: "build/infrastructure metadata" };
  }
  return { path: normalized, kind: PATH_KIND.PRODUCT, reason: "production source" };
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * The single structural decision point: given a finding, may a repair edit
 * production source? Fails closed on anything unrecognised or incomplete.
 */
export function evaluateRepairGate(finding, options = {}) {
  const blockingReasons = [];
  const classification = finding?.classification ?? null;
  const status = finding?.status ?? null;
  const reproduction = finding?.reproduction ?? {};
  const diagnosis = finding?.diagnosis ?? {};

  const known =
    REPAIR_ELIGIBLE_CLASSIFICATIONS.includes(classification) ||
    NON_REPAIR_CLASSIFICATIONS.includes(classification);
  if (!known) {
    blockingReasons.push(
      `classification ${JSON.stringify(classification)} is not a known QA classification; failing closed`,
    );
  }

  if (status !== "failed") {
    blockingReasons.push(
      `finding status is ${JSON.stringify(status)}; only a failed scenario can authorise a repair`,
    );
  }

  const repairEligibleClassification =
    REPAIR_ELIGIBLE_CLASSIFICATIONS.includes(classification);
  if (!repairEligibleClassification) {
    blockingReasons.push(
      `classification ${String(classification)} is not repair eligible; production source mutation is denied`,
    );
  } else {
    if (reproduction.reproduced !== true) {
      blockingReasons.push("failure was not reproduced; a repair requires one confirmed reproduction");
    }
    if (!Number.isInteger(reproduction.attempts) || reproduction.attempts < 1) {
      blockingReasons.push("reproduction.attempts must be a positive integer");
    }
    if (!nonEmptyString(diagnosis.rootCause)) {
      blockingReasons.push("diagnosis.rootCause is required before a production source mutation");
    }
    if (!nonEmptyString(diagnosis.responsibleCodePath)) {
      blockingReasons.push(
        "diagnosis.responsibleCodePath is required before a production source mutation",
      );
    }
  }

  const requiresHumanGate =
    HUMAN_GATE_CLASSIFICATIONS.includes(classification) || options.humanGateRequested === true;
  if (HUMAN_GATE_CLASSIFICATIONS.includes(classification)) {
    blockingReasons.push(
      `classification ${String(classification)} requires an explicit human decision before any edit`,
    );
  }

  const productionSourceMutationAllowed =
    repairEligibleClassification && blockingReasons.length === 0;

  // A harness fix still needs a failure to justify it. A passing or blocked
  // finding authorises no edit at all, in either scope.
  const qaHarnessMutationAllowed =
    productionSourceMutationAllowed ||
    (HARNESS_REPAIR_CLASSIFICATIONS.includes(classification) &&
      !requiresHumanGate &&
      status === "failed");

  const allowedMutationScope = productionSourceMutationAllowed
    ? MUTATION_SCOPE.PRODUCTION_SOURCE
    : qaHarnessMutationAllowed
      ? MUTATION_SCOPE.QA_HARNESS_ONLY
      : MUTATION_SCOPE.NONE;

  return {
    gateVersion: GATE_VERSION,
    classification,
    status,
    productionSourceMutationAllowed,
    qaHarnessMutationAllowed,
    allowedMutationScope,
    requiresHumanGate,
    blockingReasons,
  };
}

function isInsideAllowedPath(normalized, allowedPaths) {
  return allowedPaths.some((allowed) => {
    const prefix = normalizeRepoPath(allowed).replace(/\/+$/, "");
    if (prefix === "") return false;
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  });
}

/**
 * Check a concrete candidate change set against a gate decision. Returns a
 * verdict rather than throwing so the caller can persist it in a receipt.
 */
export function enforceChangedFiles({ gate, changedFiles = [], allowedPaths = [] }) {
  const violations = [];
  const reviewRequired = [];
  const classified = changedFiles.map((file) => classifyPath(file));

  for (const entry of classified) {
    if (entry.kind === PATH_KIND.FORBIDDEN) {
      violations.push({
        path: entry.path,
        rule: "forbidden-path",
        detail: `${entry.path} is a forbidden trust boundary (${entry.reason})`,
      });
      continue;
    }
    if (allowedPaths.length > 0 && !isInsideAllowedPath(entry.path, allowedPaths)) {
      violations.push({
        path: entry.path,
        rule: "outside-allowed-paths",
        detail: `${entry.path} is outside the explicitly allowed paths for this repair`,
      });
    }
    if (entry.kind === PATH_KIND.PRODUCT && !gate.productionSourceMutationAllowed) {
      violations.push({
        path: entry.path,
        rule: "production-mutation-denied",
        detail:
          `${entry.path} is production source but the gate scope is ` +
          `${gate.allowedMutationScope} (classification ${String(gate.classification)})`,
      });
    }
    if (entry.kind === PATH_KIND.INFRASTRUCTURE) {
      violations.push({
        path: entry.path,
        rule: "infrastructure-mutation-denied",
        detail: `${entry.path} is build/infrastructure metadata and is out of scope for a bounded repair`,
      });
    }
    if (entry.kind === PATH_KIND.QA_ORACLE) {
      reviewRequired.push({
        path: entry.path,
        rule: "qa-oracle-modified",
        detail: `${entry.path} is a QA oracle; assertion-integrity review is mandatory`,
      });
    }
    if (entry.kind === PATH_KIND.QA_HARNESS && !gate.qaHarnessMutationAllowed) {
      violations.push({
        path: entry.path,
        rule: "harness-mutation-denied",
        detail: `${entry.path} is QA harness code but the gate scope is ${gate.allowedMutationScope}`,
      });
    }
  }

  return {
    gateVersion: GATE_VERSION,
    allowed: violations.length === 0,
    verdict: violations.length > 0 ? "REJECTED" : reviewRequired.length > 0 ? "REVIEW_REQUIRED" : "ALLOWED",
    classifiedFiles: classified,
    violations,
    reviewRequired,
  };
}

/**
 * Convenience for experiment scripts: refuse to seed a defect in a path that
 * the contract declares off limits.
 */
export function assertSeedablePath(filePath) {
  const entry = classifyPath(filePath);
  if (entry.kind !== PATH_KIND.PRODUCT) {
    throw new Error(
      `Refusing to seed a controlled defect in ${entry.path}: expected production source, got ${entry.kind} (${entry.reason})`,
    );
  }
  return entry;
}
