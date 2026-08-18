#!/usr/bin/env node

/**
 * W2-3F / Part A — the authorised SH1 repair for W23E-001.
 *
 * The defect: the reviewed-artifact pin authenticates checkout bytes rather
 * than reviewed content, so two of three shipped skills are disabled for every
 * user and no checkout policy exists under which all three work.
 *
 * The authorised trust contract: for declared UTF-8 textual reviewed artifacts,
 * decode strictly as UTF-8 (invalid UTF-8 fails closed), fold CRLF and lone CR
 * to LF, and hash that. Nothing else is normalised. Everything else stays
 * identity-bearing, and non-text artifacts stay byte-exact.
 *
 * Two changes carry that contract, and no more:
 *
 *   1. `dashboard/src/lib/hermes/skills.ts` learns one canonicalisation
 *      function and a versioned pin scheme, so a pin says which identity
 *      contract it uses instead of that meaning changing silently underneath
 *      the audit trail.
 *
 *   2. `.agents/skills/registry.json` migrates its three pins — but only where
 *      the EXISTING pin proves the current content is the reviewed content.
 *      Nothing is recomputed from disk and called reviewed.
 *
 * The repair runs inside a snapshot worktree under a capability that refuses
 * writes outside its declared paths. The main working tree is never touched.
 *
 * Run from the repository root:
 *   node qa/autonomous/run-w23e001-repair.mjs <evidence-dir>
 */

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  applyGatedMutation,
  finalizeRepairCapability,
  issueRepairCapability,
  revokeRepairCapability,
} from "./lib/repair-capability.mjs";
import { evaluateRepairGate } from "./lib/repair-gate.mjs";
import {
  createSnapshotWorktree,
  captureDiff,
  changedFiles,
  diffStat,
  mainTreeFileFingerprint,
  removeRepairWorktree,
  rollbackInstructions,
} from "./lib/repair-worktree.mjs";
import { captureSourceSnapshot } from "./lib/source-snapshot.mjs";
import { reviewAssertionIntegrity } from "./lib/assertion-integrity.mjs";

const repoRoot = process.cwd();
const evidenceDir = path.resolve(process.argv[2] ?? ".qa-results/week2-w23e001-repair/adhoc");
fs.mkdirSync(evidenceDir, { recursive: true });

const FINDING_ID = "W23E-001";
const TEXT_PIN_PREFIX = "text-v1:";
const sha = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const utf8 = (text) => Buffer.from(text, "utf8");
const log = [];
const note = (event, detail) => {
  log.push({ at: new Date().toISOString(), event, detail });
  console.log("[" + event + "] " + (typeof detail === "string" ? detail : JSON.stringify(detail)));
};

/** The authorised canonicalisation, recomputed here so the migration proof is independent of the patch. */
function canonicalDigest(bytes) {
  const text = bytes.toString("utf8");
  if (!utf8(text).equals(bytes)) return null;
  return sha(utf8(text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")));
}

function git(args, cwd = repoRoot, encoding = "utf8") {
  const run = spawnSync("git", args, { cwd, encoding, maxBuffer: 128 * 1024 * 1024 });
  return { status: run.status ?? 1, stdout: run.stdout, stderr: run.stderr };
}

// ============================================================ A1: snapshot
const snapshot = captureSourceSnapshot({ repoRoot, label: "w23e001-repair" });
note("snapshot-frozen", {
  baseCommit: snapshot.baseCommit,
  sourceFingerprint: snapshot.sourceFingerprint.slice(0, 16),
});

// ============================================================ the finding
const finding = {
  id: FINDING_ID,
  scenario: "week2-behavioural-contract-arbitration/skill-integrity-pin",
  status: "failed",
  classification: "PRODUCT_BUG",
  severity: "P1",
  revision: snapshot.baseCommit,
  environment: { repositoryRevision: snapshot.baseCommit },
  sourceSnapshotFingerprint: snapshot.sourceFingerprint,
  reproduction: {
    reproduced: true,
    attempts: 3,
    method:
      "Executed the real skill list and command resolver: premortem and bullshit-detector report enabled=false, healthy=false and refuse dispatch. Independently reproduced from fresh checkouts under core.autocrlf true, false and input.",
  },
  diagnosis: {
    rootCause:
      "Reviewed-artifact integrity is verified by hashing raw file bytes, but the reviewed root is a committed directory whose bytes git rewrites at checkout. The three pins were each taken in a different byte form, so no checkout of the reviewed commit satisfies all of them.",
    responsibleCodePath: "dashboard/src/lib/hermes/skills.ts",
  },
  humanAuthorization: {
    granted: true,
    action: "adopt canonical-text pin (Model B) + derive the three pins by proof",
    scope:
      "canonical text verification logic; proof-based migration of existing reviewed pins; necessary regression tests; minimum supporting code",
    excludes: [
      "weakening the skill gate",
      "bypassing review",
      "accepting arbitrary regenerated artifacts",
      "repository-wide line-ending policy changes",
      "unrelated security changes",
      "broad skill registry redesign",
    ],
  },
};

const gate = evaluateRepairGate(finding);
note("repair-gate", {
  productionSourceMutationAllowed: gate.productionSourceMutationAllowed,
  scope: gate.allowedMutationScope,
  blockingReasons: gate.blockingReasons,
});
if (!gate.productionSourceMutationAllowed) {
  fs.writeFileSync(path.join(evidenceDir, "repair-receipt.json"), JSON.stringify({ blocked: true, gate, log }, null, 2));
  throw new Error("repair gate denied the mutation");
}

// ===================================================== isolated worktree
// Worktree directory names are lowercase-slug only; the finding keeps its id.
const handle = createSnapshotWorktree({ repoRoot, findingId: "w23e-001", snapshot });
note("worktree", { path: handle.worktreePath, linkedRoots: handle.linkedRoots.length });

const PRODUCT_PATH = "dashboard/src/lib/hermes/skills.ts";
const REGISTRY_PATH = ".agents/skills/registry.json";
const REGRESSION_PATH = "dashboard/tests/reviewed-skill-pin-canonicalisation.test.mjs";

/** The main tree must be byte-identical afterwards; captured before anything runs. */
const mainTreeBefore = [PRODUCT_PATH, REGISTRY_PATH].map((relative) => ({
  path: relative,
  fingerprint: mainTreeFileFingerprint(repoRoot, relative),
}));

let capability = null;
let verdict = null;
let migration = null;

try {
  capability = issueRepairCapability({
    repoRoot,
    finding,
    worktree: handle,
    allowedPaths: [PRODUCT_PATH, REGISTRY_PATH],
    regressionTestPaths: [REGRESSION_PATH],
  });
  note("capability-issued", { allowedPaths: capability.allowedPaths, expiresAt: capability.expiresAt });

  // ============================================ A3/A4: canonical hashing
  const preImages = new Map();
  const readWorktree = (relative) => {
    const text = fs.readFileSync(path.join(handle.worktreePath, relative), "utf8");
    if (!preImages.has(relative)) preImages.set(relative, text);
    return text;
  };
  const productSource = readWorktree(PRODUCT_PATH);

  const anchorHelpers = `function sha256(value: Buffer): string {`;
  if (!productSource.includes(anchorHelpers)) throw new Error("sha256 helper anchor not found");

  const canonicalisationBlock = `/**
 * Reviewed text artifacts are authenticated by their reviewed CONTENT, not by
 * the byte form a checkout happened to write.
 *
 * The reviewed root is a committed directory, so git rewrites its line endings
 * on checkout under core.autocrlf. Hashing raw bytes therefore made a pin mean
 * "these bytes were written on that machine" rather than "this text was
 * reviewed", and the three shipped pins ended up in three different byte forms
 * with no checkout satisfying all of them (W23E-001).
 *
 * The canonicalisation is deliberately the smallest rule that covers every
 * conversion git can perform, and nothing else. Whitespace, indentation, a
 * trailing newline, a BOM, Unicode normalisation, frontmatter, punctuation and
 * casing all remain identity-bearing, because a checkout never changes them and
 * a reviewer can see every one of them.
 */
const REVIEWED_TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml"]);

/** Pins carry their scheme so future code can tell which contract they assert. */
const TEXT_PIN_PREFIX = "text-v1:";

function isReviewedTextPath(relativePath: string): boolean {
  return REVIEWED_TEXT_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

/**
 * Strict UTF-8 decode, then CRLF and lone CR folded to LF. Returns null when the
 * bytes are not valid UTF-8: a lossy decode would turn an invalid sequence into
 * U+FFFD and could then verify, so this fails closed instead.
 */
export function canonicalizeReviewedText(bytes: Buffer): Buffer | null {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) return null;
  return Buffer.from(text.replace(/\\r\\n/g, "\\n").replace(/\\r/g, "\\n"), "utf8");
}

/** The canonical identity of a reviewed text artifact, in its pinned form. */
export function reviewedTextPin(bytes: Buffer): string | null {
  const canonical = canonicalizeReviewedText(bytes);
  return canonical === null ? null : \`\${TEXT_PIN_PREFIX}\${sha256(canonical)}\`;
}

/**
 * Verify one reviewed file against its pin, in whichever scheme the pin declares.
 * A bare hex pin keeps its original raw-byte meaning exactly, so no historical
 * pin is silently reinterpreted.
 */
function reviewedFileMatchesPin(
  absolutePath: string,
  relativePath: string,
  pin: string,
): boolean {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(absolutePath);
  } catch {
    return false;
  }
  if (pin.startsWith(TEXT_PIN_PREFIX)) {
    // A text pin may only ever authenticate a declared text artifact.
    if (!isReviewedTextPath(relativePath)) return false;
    return reviewedTextPin(bytes) === pin;
  }
  return sha256(bytes) === pin;
}

/**
 * The reviewed tree matches its pins when the pinned file set is exactly the set
 * on disk and every file matches under its own scheme. An added or removed file
 * is a mismatch, as it always was.
 */
function reviewedTreeMatchesPins(
  directory: string,
  pinned: Record<string, string>,
): boolean {
  const present = listFilesRecursive(directory)
    .map((file) => path.relative(directory, file).replace(/\\\\/g, "/"))
    .sort();
  const expected = Object.keys(pinned).sort();
  if (present.length !== expected.length) return false;
  if (present.some((name, index) => name !== expected[index])) return false;
  return present.every((name) =>
    reviewedFileMatchesPin(path.join(directory, name), name, pinned[name]),
  );
}

`;

  const patchedProduct = productSource.replace(anchorHelpers, canonicalisationBlock + anchorHelpers);

  const oldVerification = `      let integrityVerified = pinnedHashes.length === 0;
      if (pinnedHashes.length) {
        try {
          const directory = path.join(root, entry.name);
          const currentHashes = Object.fromEntries(
            listFilesRecursive(directory).map((file) => [
              path.relative(directory, file),
              crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
            ]),
          );
          integrityVerified = sameHashes(
            Object.fromEntries(pinnedHashes),
            currentHashes,
          );
        } catch {
          integrityVerified = false;
        }
      }`;
  const newVerification = `      let integrityVerified = pinnedHashes.length === 0;
      if (pinnedHashes.length) {
        try {
          integrityVerified = reviewedTreeMatchesPins(
            path.join(root, entry.name),
            Object.fromEntries(pinnedHashes),
          );
        } catch {
          integrityVerified = false;
        }
      }`;
  if (!patchedProduct.includes(oldVerification)) {
    throw new Error("verification anchor not found; refusing to patch blind");
  }
  const finalProduct = patchedProduct.replace(oldVerification, newVerification);

  applyGatedMutation({
    capability,
    targetPath: PRODUCT_PATH,
    edit: () => finalProduct,
  });
  note("product-patched", { path: PRODUCT_PATH, bytesDelta: finalProduct.length - productSource.length });

  // =============================================== A5: migrate by proof
  const registryAbsolute = path.join(handle.worktreePath, REGISTRY_PATH);
  const registryText = readWorktree(REGISTRY_PATH);
  const registry = JSON.parse(registryText);

  const proofs = [];
  const migratedRegistry = JSON.parse(registryText);

  for (const slug of Object.keys(registry.skills)) {
    const entry = registry.skills[slug];
    for (const file of entry.files ?? []) {
      const relative = ".agents/skills/" + slug + "/" + file;
      const existingPin = entry.fileHashes ? entry.fileHashes[file] : null;
      const committed = git(["cat-file", "blob", "HEAD:" + relative], repoRoot, "buffer").stdout;

      // Only historically justified renderings. Not "whatever hashes to the pin".
      const lf = committed === null ? null : committed.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const renderings = lf === null
        ? {}
        : {
            LF: utf8(lf),
            CRLF: utf8(lf.replace(/\n/g, "\r\n")),
            CR: utf8(lf.replace(/\n/g, "\r")),
          };

      let proofMethod = null;
      let historicalRendering = null;
      for (const [name, bytes] of Object.entries(renderings)) {
        if (sha(bytes) === existingPin) {
          proofMethod = "line-ending-rendering";
          historicalRendering = name;
          break;
        }
      }

      // The generator route: a deterministic build whose raw output reproduces
      // the existing pin is the reviewed artifact, whatever git later wrote.
      let generatorEvidence = null;
      if (!proofMethod && slug === "bullshit-detector") {
        try {
          const { buildSkill } = await import(
            "file://" + path.join(repoRoot, "scripts/build-bullshit-detector-skill.mjs").replace(/\\/g, "/"),
          );
          const clone = fs.readFileSync(
            path.join(repoRoot, "bullshit-detector/skills/analysis/bullshit-detector/SKILL.md"),
            "utf8",
          );
          const built = utf8(buildSkill(clone));
          const rawMatches = sha(built) === existingPin;
          const canonicalAgrees = canonicalDigest(built) === canonicalDigest(committed);
          generatorEvidence = {
            generator: "scripts/build-bullshit-detector-skill.mjs :: buildSkill",
            rawOutputMatchesExistingPin: rawMatches,
            canonicalFormEqualsCommittedContent: canonicalAgrees,
          };
          if (rawMatches && canonicalAgrees) {
            proofMethod = "deterministic-generator-output";
            historicalRendering = "generator raw output (mixed line endings)";
          }
        } catch (error) {
          generatorEvidence = { error: error instanceof Error ? error.message : String(error) };
        }
      }

      const canonical = committed === null ? null : canonicalDigest(committed);
      const proof = {
        skill: slug,
        file,
        existingPin,
        existingPinScheme: "bare-hex (raw sha256)",
        historicalRendering,
        proofMethod,
        rawHashMatched: proofMethod !== null,
        generatorEvidence,
        canonicalHash: canonical,
        canonicalizationVersion: "text-v1",
        canonicalPin: canonical === null ? null : TEXT_PIN_PREFIX + canonical,
        reviewProvenancePreserved: proofMethod !== null,
        migrated: proofMethod !== null,
        verdict: proofMethod !== null ? "MIGRATED_BY_PROOF" : "HUMAN_REVIEW_REQUIRED",
        reviewState: entry.reviewState ?? null,
      };
      proofs.push(proof);

      if (proof.migrated) {
        migratedRegistry.skills[slug].fileHashes[file] = proof.canonicalPin;
        if (migratedRegistry.skills[slug].localHash === existingPin) {
          migratedRegistry.skills[slug].localHash = proof.canonicalPin;
        }
      }
    }
  }

  migration = {
    generatedAt: new Date().toISOString(),
    rule:
      "A canonical pin is derived only where the EXISTING reviewed pin is satisfied by an already-established rendering of the same current reviewed content, or by a deterministic generator whose raw output reproduces it. Otherwise the artifact stops at HUMAN_REVIEW_REQUIRED. No pin is recomputed from disk content and called reviewed.",
    proofs,
    totals: {
      artifacts: proofs.length,
      migratedByProof: proofs.filter((entry) => entry.migrated).length,
      humanReviewRequired: proofs.filter((entry) => !entry.migrated).length,
      blindRePins: 0,
    },
  };
  fs.writeFileSync(
    path.join(evidenceDir, "trust-migration-proofs.json"),
    JSON.stringify(migration, null, 2) + "\n",
    "utf8",
  );
  note("migration", migration.totals);

  if (migration.totals.humanReviewRequired > 0) {
    note("migration-partial", "at least one artifact could not be proven; its pin is left untouched");
  }

  applyGatedMutation({
    capability,
    targetPath: REGISTRY_PATH,
    edit: () => JSON.stringify(migratedRegistry, null, 2) + "\n",
  });
  note("registry-migrated", { path: REGISTRY_PATH });

  // ================================================= the regression test
  const regression = fs.readFileSync(path.join(repoRoot, "qa/autonomous/fixtures/w23e001-regression.test.mjs"), "utf8");
  applyGatedMutation({
    capability,
    targetPath: REGRESSION_PATH,
    edit: () => regression,
  });
  note("regression-added", { path: REGRESSION_PATH });

  // ============================================ assertion-integrity guard
  // A snapshot worktree is intentionally dirty: it carries the developer's whole
  // in-flight tree, so `git diff` against the base commit describes their work,
  // not the repair. Showing that to the assertion-integrity guard would have it
  // adjudicate somebody else's edits -- and it did, rejecting on an
  // `assertions-removed` finding in a file this repair never touched. The guard
  // must be shown exactly the authorised delta and nothing else.
  const repairPaths = [PRODUCT_PATH, REGISTRY_PATH, REGRESSION_PATH];
  const diff = captureDiff(handle, repairPaths);
  const integrity = reviewAssertionIntegrity(diff, { classification: finding.classification });
  note("assertion-integrity", {
    verdict: integrity.verdict,
    inspectedFiles: integrity.inspectedFiles,
    findings: integrity.findings.map((entry) => entry.rule),
    rejections: integrity.rejections.map((entry) => entry.rule),
  });
  if (integrity.rejections.length > 0) {
    throw new Error("assertion integrity guard rejected the diff: " + integrity.rejections.map((entry) => entry.rule).join(", "));
  }

  verdict = finalizeRepairCapability({ capability, worktree: handle });
  note("capability-finalized", {
    finalized: verdict.finalized,
    authorisedWrites: verdict.authorisedWrites.map((entry) => entry.path),
    unauthorisedChanges: verdict.unauthorisedChanges,
  });

  fs.writeFileSync(
    path.join(evidenceDir, "repair-diff.patch"),
    typeof diff === "string" ? diff : String(diff),
    "utf8",
  );
  fs.writeFileSync(
    path.join(evidenceDir, "repair-state.json"),
    JSON.stringify(
      {
        findingId: FINDING_ID,
        worktreePath: handle.worktreePath,
        baseCommit: snapshot.baseCommit,
        sourceFingerprint: snapshot.sourceFingerprint,
        changedFiles: changedFiles(handle),
        diffStat: diffStat(handle),
        assertionIntegrity: integrity,
        capability: {
          capabilityId: verdict.capabilityId,
          findingId: verdict.findingId,
          allowedPaths: capability.allowedPaths,
          regressionTestPaths: capability.regressionTestPaths,
          finalized: verdict.finalized,
          unauthorisedChanges: verdict.unauthorisedChanges,
          declaredButUnwritten: verdict.declaredButUnwritten,
          unauthorisedChanges: verdict.unauthorisedChanges,
        },
        mainTreeBefore,
        mainTreeAfter: [PRODUCT_PATH, REGISTRY_PATH].map((relative) => ({
          path: relative,
          fingerprint: mainTreeFileFingerprint(repoRoot, relative),
        })),
        rollback: rollbackInstructions(handle),
        log,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  note("worktree-retained", handle.worktreePath);
  console.log("\nWORKTREE=" + handle.worktreePath);
} catch (error) {
  if (capability && !verdict) revokeRepairCapability(capability);
  removeRepairWorktree(handle);
  fs.writeFileSync(
    path.join(evidenceDir, "repair-failure.json"),
    JSON.stringify({ error: error instanceof Error ? error.message : String(error), log }, null, 2) + "\n",
    "utf8",
  );
  throw error;
}
