/**
 * Mandatory repair capability — the supported SH1 write path.
 *
 * Week 1 proved `evaluateRepairGate` is correct when it is called. Its weakness
 * (B-2) was that calling it was optional: a controller could reason its way to a
 * diagnosis and then simply write to the file. This module closes that by making
 * the gate the *issuer of the only writer*.
 *
 *   diagnose (read-only)
 *        ↓
 *   issueRepairCapability(finding, worktree, allowedPaths)   ← full gate runs here
 *        ↓
 *   applyGatedMutation(capability, path, edit)               ← the only supported write
 *        ↓
 *   finalizeRepairCapability(capability)                     ← post-diff validation
 *        ↓
 *   capability is consumed and cannot be used again
 *
 * The teeth are in `finalize`. It compares the worktree's actual diff against
 * the set of files this capability wrote. Any file changed by some other means —
 * a direct `fs.writeFileSync`, a shell redirect, a patch tool — appears as an
 * unauthorised mutation and the finalize fails. A repair therefore cannot
 * produce a valid receipt while bypassing the gate, which is the property Week 1
 * lacked.
 *
 * This is a correctness boundary inside the QA controller, not a sandbox. It
 * does not try to stop arbitrary processes on the machine from editing files;
 * it makes an ungated edit impossible to certify.
 */

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { reviewAssertionIntegrity } from "./assertion-integrity.mjs";
import {
  classifyPath,
  enforceChangedFiles,
  evaluateRepairGate,
  normalizeRepoPath,
  PATH_KIND,
} from "./repair-gate.mjs";
import { captureDiff, changedFiles, verifyRepairWorktree } from "./repair-worktree.mjs";
import { manifestDelta, sourceManifest } from "./source-snapshot.mjs";

export const CAPABILITY_VERSION = 1;

/** A repair is a bounded operation; a capability outliving it is a liability. */
export const DEFAULT_CAPABILITY_TTL_MS = 30 * 60_000;

export const CAPABILITY_STATE = Object.freeze({
  ACTIVE: "active",
  CONSUMED: "consumed",
  REVOKED: "revoked",
});

/**
 * Per-process signing key. Capabilities are not meant to survive the controller
 * that issued them: a persisted, replayable grant is exactly the thing this
 * module exists to prevent.
 */
const SIGNING_KEY = randomBytes(32);

/** id -> internal record. Never exported; callers only hold the sealed grant. */
const REGISTRY = new Map();

export class RepairCapabilityError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "RepairCapabilityError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new RepairCapabilityError(message, code);
}

function sign(payload) {
  return createHmac("sha256", SIGNING_KEY).update(JSON.stringify(payload)).digest("hex");
}

function verifySignature(capability) {
  const { signature, ...payload } = capability ?? {};
  if (typeof signature !== "string") fail("unsigned", "capability carries no signature");
  const expected = sign(payload);
  const left = Buffer.from(signature, "hex");
  const right = Buffer.from(expected, "hex");
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    fail("bad-signature", "capability signature does not match its contents");
  }
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function withinAllowed(repoRelative, allowedPaths) {
  return allowedPaths.some((allowed) => {
    const prefix = normalizeRepoPath(allowed).replace(/\/+$/, "");
    return repoRelative === prefix || repoRelative.startsWith(`${prefix}/`);
  });
}

/**
 * Run the full gate and, only if every check passes, mint a capability bound to
 * one finding, one worktree, one revision, and one path set.
 */
export function issueRepairCapability({
  repoRoot,
  finding,
  worktree,
  allowedPaths = [],
  regressionTestPaths = [],
  ttlMs = DEFAULT_CAPABILITY_TTL_MS,
  now = Date.now(),
}) {
  if (!finding || typeof finding !== "object") fail("no-finding", "a finding is required");
  const findingId = finding.id ?? finding.finding_id;
  if (typeof findingId !== "string" || findingId.trim() === "") {
    fail("no-finding-id", "the finding must carry an id");
  }
  const scenarioId = finding.scenario ?? finding.scenario_id;
  if (typeof scenarioId !== "string" || scenarioId.trim() === "") {
    fail("no-scenario", "the finding must name the scenario it came from");
  }

  // 1. Classification, reproduction, and root cause. Denials come from the
  //    Week 1 gate verbatim so the two can never drift apart.
  const gate = evaluateRepairGate(finding);
  if (!gate.productionSourceMutationAllowed) {
    fail(
      "gate-denied",
      `repair gate denied production mutation: ${gate.blockingReasons.join("; ")}`,
    );
  }

  // 2. Worktree identity and isolation.
  if (!worktree || typeof worktree.worktreePath !== "string") {
    fail("no-worktree", "an isolated repair worktree is required");
  }
  const resolvedRepo = path.resolve(repoRoot ?? worktree.repoRoot);
  const resolvedWorktree = path.resolve(worktree.worktreePath);
  if (samePath(resolvedWorktree, resolvedRepo)) {
    fail("main-tree", "the main working tree can never receive a repair capability");
  }
  if (!isInside(path.join(resolvedRepo, ".qa-worktrees"), resolvedWorktree)) {
    fail("foreign-worktree", `worktree ${resolvedWorktree} is not a disposable QA worktree`);
  }
  const verification = verifyRepairWorktree(worktree);
  if (!verification.verified) {
    fail("worktree-unverified", `worktree isolation failed: ${verification.problems.join("; ")}`);
  }

  // 3. Staleness: the finding must describe the revision actually checked out.
  const findingRevision = finding.revision ?? finding.environment?.repositoryRevision;
  if (typeof findingRevision !== "string" || findingRevision.trim() === "") {
    fail("no-revision", "the finding must record the revision it was reproduced against");
  }
  if (findingRevision !== worktree.sourceRevision || findingRevision !== verification.worktreeHead) {
    fail(
      "stale-finding",
      `finding revision ${findingRevision} does not match worktree head ${verification.worktreeHead}`,
    );
  }

  // W2-2: the commit is not the product. A finding made against a dirty working
  // tree must be repaired against that exact source, so the snapshot
  // fingerprint — not the commit — is the binding identity.
  const findingFingerprint = finding.sourceSnapshotFingerprint ?? null;
  const worktreeFingerprint = worktree.sourceFingerprint ?? null;
  if (findingFingerprint !== null || worktreeFingerprint !== null) {
    if (findingFingerprint === null) {
      fail(
        "no-source-fingerprint",
        "the worktree carries a source snapshot but the finding records no sourceSnapshotFingerprint",
      );
    }
    if (worktreeFingerprint === null) {
      fail(
        "worktree-not-snapshotted",
        `the finding was reproduced against source snapshot ${String(findingFingerprint).slice(0, 16)} but the worktree carries no snapshot`,
      );
    }
    if (findingFingerprint !== worktreeFingerprint) {
      fail(
        "stale-source-snapshot",
        `the finding was reproduced against source ${String(findingFingerprint).slice(0, 16)} but the worktree carries ${String(worktreeFingerprint).slice(0, 16)}`,
      );
    }
  }

  // 4. Path scope. Product paths must be product; regression tests must be new
  //    oracle files. A product capability may never edit an existing oracle.
  if (allowedPaths.length === 0) fail("no-allowed-paths", "allowedPaths must not be empty");
  const normalizedAllowed = [];
  for (const entry of allowedPaths) {
    const normalized = normalizeRepoPath(entry).replace(/\/+$/, "");
    const kind = classifyPath(normalized).kind;
    if (kind !== PATH_KIND.PRODUCT) {
      fail("bad-allowed-path", `allowed path ${normalized} is ${kind}, not production source`);
    }
    normalizedAllowed.push(normalized);
  }

  const normalizedRegression = [];
  for (const entry of regressionTestPaths) {
    const normalized = normalizeRepoPath(entry);
    const kind = classifyPath(normalized).kind;
    if (kind !== PATH_KIND.QA_ORACLE) {
      fail("bad-regression-path", `regression test ${normalized} is ${kind}, not a QA oracle`);
    }
    if (fs.existsSync(path.join(resolvedWorktree, normalized))) {
      fail(
        "existing-oracle",
        `${normalized} already exists; a product repair may add a regression test but never rewrite an existing oracle`,
      );
    }
    normalizedRegression.push(normalized);
  }

  const id = randomUUID();
  const payload = {
    version: CAPABILITY_VERSION,
    id,
    findingId,
    scenarioId,
    revision: findingRevision,
    worktreePath: resolvedWorktree,
    repoRoot: resolvedRepo,
    allowedPaths: normalizedAllowed,
    regressionTestPaths: normalizedRegression,
    sourceFingerprint: worktreeFingerprint,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
  };
  const capability = { ...payload, signature: sign(payload) };
  REGISTRY.set(id, {
    state: CAPABILITY_STATE.ACTIVE,
    expiresAtMs: now + ttlMs,
    findingId,
    writes: new Map(),
    gate,
    // On a snapshot worktree `git status` reports the user's in-flight work as
    // well, so the pre-repair content manifest is what makes "changed by this
    // repair" answerable.
    baselineManifest: worktree.carriesSnapshot
      ? sourceManifest({ repoRoot: resolvedWorktree })
      : null,
    sourceFingerprint: worktreeFingerprint,
  });
  return capability;
}

function activeRecord(capability, now) {
  verifySignature(capability);
  const record = REGISTRY.get(capability.id);
  if (!record) fail("unknown-capability", "capability is not registered in this process");
  if (record.findingId !== capability.findingId) {
    fail("finding-mismatch", "capability id and finding do not correspond");
  }
  if (record.state !== CAPABILITY_STATE.ACTIVE) {
    fail("capability-spent", `capability is ${record.state} and cannot be used again`);
  }
  if (now > record.expiresAtMs) {
    record.state = CAPABILITY_STATE.REVOKED;
    fail("expired", "capability has expired");
  }
  return record;
}

/**
 * The only supported way to change a file during a repair.
 *
 * `edit` receives the current contents (null when creating) and returns the new
 * contents. Returning the same string is treated as a no-op write and still
 * recorded, so the audit trail reflects what the repair touched.
 */
export function applyGatedMutation({ capability, targetPath, edit, now = Date.now() }) {
  const record = activeRecord(capability, now);
  const normalized = normalizeRepoPath(targetPath);
  const absolute = path.resolve(capability.worktreePath, normalized);

  if (!isInside(capability.worktreePath, absolute)) {
    fail("escapes-worktree", `${normalized} resolves outside the repair worktree`);
  }

  // A snapshot worktree junctions the gitignored vendored roots back into the
  // user's tree so the product can run. Writing through one of those links would
  // edit the user's files while looking like a worktree-local path, so resolve
  // real paths before believing the containment check above.
  const realWorktree = fs.realpathSync(capability.worktreePath);
  let realParent = path.dirname(absolute);
  while (!fs.existsSync(realParent) && realParent !== path.dirname(realParent)) {
    realParent = path.dirname(realParent);
  }
  const resolvedParent = fs.realpathSync(realParent);
  if (resolvedParent !== realWorktree && !isInside(realWorktree, resolvedParent)) {
    fail(
      "escapes-worktree",
      `${normalized} resolves through a link to ${resolvedParent}, outside the repair worktree`,
    );
  }
  const classification = classifyPath(normalized);
  if (classification.kind === PATH_KIND.FORBIDDEN) {
    fail("forbidden-path", `${normalized} is a forbidden trust boundary (${classification.reason})`);
  }

  const isRegressionTarget = capability.regressionTestPaths.includes(normalized);
  const isProductTarget =
    classification.kind === PATH_KIND.PRODUCT &&
    withinAllowed(normalized, capability.allowedPaths);

  if (!isRegressionTarget && !isProductTarget) {
    if (classification.kind === PATH_KIND.QA_ORACLE) {
      fail(
        "oracle-not-writable",
        `${normalized} is a QA oracle; a product repair capability may only create the regression tests it declared`,
      );
    }
    fail("outside-scope", `${normalized} is outside this capability's allowed paths`);
  }

  const exists = fs.existsSync(absolute);
  if (isRegressionTarget && exists && !record.writes.has(normalized)) {
    fail("existing-oracle", `${normalized} already exists and may not be rewritten`);
  }

  const before = exists ? fs.readFileSync(absolute, "utf8") : null;
  const after = edit(before);
  if (typeof after !== "string") {
    fail("bad-edit", `the edit for ${normalized} did not return file contents`);
  }
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, after, "utf8");
  record.writes.set(normalized, {
    path: normalized,
    created: !exists,
    at: new Date(now).toISOString(),
  });
  return { path: normalized, created: !exists, bytes: Buffer.byteLength(after) };
}

/**
 * Close out the capability.
 *
 * Verifies that the worktree's real diff contains nothing this capability did
 * not write, re-runs the scope guard and the assertion-integrity guard over the
 * final diff, and consumes the capability either way.
 */
export function finalizeRepairCapability({ capability, worktree, now = Date.now() }) {
  const record = activeRecord(capability, now);
  const problems = [];

  const authorised = new Set(record.writes.keys());
  const actual = record.baselineManifest
    ? manifestDelta(record.baselineManifest, sourceManifest({ repoRoot: capability.worktreePath })).all.map(
        (entry) => normalizeRepoPath(entry),
      )
    : changedFiles(worktree).map((entry) => normalizeRepoPath(entry));
  const unauthorised = actual.filter((file) => !authorised.has(file));
  const declaredButUnwritten = [...authorised].filter((file) => !actual.includes(file));

  if (unauthorised.length > 0) {
    problems.push(
      `worktree contains changes this capability never authorised: ${unauthorised.join(", ")}`,
    );
  }

  const diff = captureDiff(worktree);
  const scope = enforceChangedFiles({
    gate: record.gate,
    changedFiles: actual,
    allowedPaths: [...capability.allowedPaths, ...capability.regressionTestPaths],
  });
  if (!scope.allowed) {
    problems.push(`scope guard rejected the final diff: ${JSON.stringify(scope.violations)}`);
  }

  const integrity = reviewAssertionIntegrity(diff, { classification: record.gate.classification });
  if (integrity.verdict === "REJECTED") {
    problems.push(
      `assertion-integrity guard rejected the final diff: ${integrity.rejections
        .map((entry) => entry.rule)
        .join(", ")}`,
    );
  }

  record.state = CAPABILITY_STATE.CONSUMED;

  return {
    capabilityId: capability.id,
    findingId: capability.findingId,
    sourceFingerprint: capability.sourceFingerprint ?? null,
    baselineMode: record.baselineManifest ? "source-snapshot-manifest" : "git-status-vs-head",
    finalized: problems.length === 0,
    authorisedWrites: [...record.writes.values()],
    unauthorisedChanges: unauthorised,
    declaredButUnwritten,
    scope,
    assertionIntegrity: { verdict: integrity.verdict, rejections: integrity.rejections },
    problems,
  };
}

/** Explicitly revoke an unused capability (an abandoned or failed repair). */
export function revokeRepairCapability(capability) {
  verifySignature(capability);
  const record = REGISTRY.get(capability.id);
  if (!record) return { revoked: false, reason: "not registered" };
  const previous = record.state;
  record.state = CAPABILITY_STATE.REVOKED;
  return { revoked: previous === CAPABILITY_STATE.ACTIVE, previousState: previous };
}

/** Inspect a capability's state without granting any authority. */
export function capabilityState(capability) {
  try {
    verifySignature(capability);
  } catch {
    return "invalid";
  }
  return REGISTRY.get(capability.id)?.state ?? "unknown";
}

/** Test-only: forget every capability this process minted. */
export function resetCapabilityRegistryForTests() {
  REGISTRY.clear();
}
