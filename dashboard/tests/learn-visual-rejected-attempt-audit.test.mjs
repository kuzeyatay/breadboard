import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LEARN_VISUAL_REJECTED_ATTEMPT_RECEIPT_MAX_BYTES,
  LEARN_VISUAL_REJECTED_ATTEMPT_SOURCE_MAX_BYTES,
  persistLearnVisualRejectedAttemptAudit,
  removeAllLearnVisualRejectedAttemptAudits,
  removeLearnVisualRejectedAttemptAudit,
} from "../src/lib/learn-visual-rejected-attempt-audit.ts";
import {
  createLearnBuildWorkspace,
  disposeLearnBuildWorkspace,
} from "../src/lib/learn-build-workspace.ts";

const roots = [];
test.after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  roots.push(root);
  return root;
}

function createSnapshot(gardenDir, gardenId, jobId) {
  const snapshotDir = path.join(
    gardenDir,
    ".breadboard",
    "learn-run-snapshots",
    jobId,
  );
  fs.mkdirSync(snapshotDir, { recursive: true });
  fs.writeFileSync(
    path.join(snapshotDir, "manifest.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      gardenId,
      jobId,
      createdAt: new Date().toISOString(),
    }, null, 2)}\n`,
  );
  return snapshotDir;
}

function rejectedAttempt(overrides = {}) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    visualizationId: "visual-audit-fixture",
    runId: "20260824-run-42",
    attempt: 1,
    category: "runtime",
    rejectedAt: now,
    errors: [
      "runtime failed under C:\\Users\\person\\profile\\edge.exe",
      "workspace /root/private/build and \\\\server\\share\\profile unavailable",
    ],
    candidate: {
      title: "Excluded title",
      explanation: "Excluded explanation",
      sourceCode:
        'const localEvidence = "file:///root/private/source.tsx";\n' +
        'const profile = "C:\\\\Users\\\\person\\\\profile";\n' +
        "é".repeat(12_000),
      testCases: [{ name: "excluded candidate test", inputs: {}, expected: {} }],
      accessibilityDescription: "Excluded accessibility prose",
      pedagogicalClaims: ["Excluded claim"],
    },
    lifecycle: [{
      status: "tested",
      at: now,
      attempt: 1,
      detail: "browser profile /home/person/private-profile failed",
    }],
    evidence: {
      validation: {
        valid: true,
        checkedAt: now,
        astNodeCount: 100,
        sourceBytes: 24_000,
        imports: ["@breadboard/visual-sdk"],
        errors: [],
        warnings: ["warning at /tmp/private/build/source.tsx"],
      },
      tests: {
        passed: false,
        checkedAt: now,
        staticTests: [{ name: "static", passed: true }],
        semanticTests: [{ name: "semantic", passed: true }],
        runtimeTests: [{
          name: "runtime",
          passed: false,
          detail: "failed in C:\\private\\profile\\Default",
        }],
        browser: {
          executable: "C:\\Program Files\\Browser\\browser.exe",
          viewports: ["375x667 light"],
          screenshotCreated: true,
          previewCount: 1,
          previewMatrixComplete: true,
          previewMatrixReceipt: {
            expectedCount: 1,
            capturedCount: 1,
            cells: [{
              id: "mobile-light-default",
              viewport: { width: 375, height: 667 },
              theme: "light",
              selectState: [],
              defaultState: true,
              selectStateCoverageTruncated: false,
              captured: true,
              attempts: [{
                attempt: 1,
                status: 0,
                signal: null,
                screenshotCreated: true,
                screenshotBytes: 321,
                stderr: "secret stderr C:\\private\\profile",
                stdoutTail: "secret DOM serialization",
                detail: "screenshot at /tmp/private/preview.png",
                cleanupConfirmed: true,
                completion: "/workspace/forged-completion",
                cleanupMethod: "\\\\server\\share\\forged-cleanup",
              }],
            }],
          },
          mountReceipts: [{
            scenario: "mobile light",
            viewport: "375x667",
            theme: "light",
            mounted: true,
            attempts: [{
              attempt: 1,
              status: 0,
              signal: null,
              mounted: true,
              stderr: "secret mount stderr",
              stdoutTail: "secret mount DOM",
              detail: "/home/person/profile",
              cleanupConfirmed: true,
            }],
          }],
        },
      },
      critic: {
        approved: false,
        checkedAt: now,
        reason: "Selected branch did not change.",
        requestedChanges: ["Highlight the selected branch."],
        scores: {
          pedagogicalValue: 0.8,
          sourceFidelity: 0.9,
          usability: 0.7,
          accessibility: 0.8,
        },
      },
    },
    ...overrides,
  };
}

test("durable receipts are bounded, allowlisted, atomic, and survive workspace disposal", () => {
  const root = temporaryRoot("breadboard-rejected-attempt-audit");
  const gardenDir = path.join(root, "garden");
  const gardenId = "audit-garden";
  const jobId = "learn-job-audit-1";
  fs.mkdirSync(gardenDir, { recursive: true });
  createSnapshot(gardenDir, gardenId, jobId);
  const raw = rejectedAttempt();
  const result = persistLearnVisualRejectedAttemptAudit({
    gardenDir,
    gardenId,
    jobId,
    rejectedAttempt: raw,
  });

  const expectedPath = path.join(
    gardenDir,
    ".breadboard",
    "learn-run-snapshots",
    jobId,
    "failed-generated-visuals",
    raw.visualizationId,
    raw.runId,
    "attempt-1.json",
  );
  assert.equal(result.filePath, expectedPath);
  assert.ok(fs.statSync(expectedPath).size <= LEARN_VISUAL_REJECTED_ATTEMPT_RECEIPT_MAX_BYTES);
  const persisted = JSON.parse(fs.readFileSync(expectedPath, "utf8"));
  assert.equal(
    Buffer.byteLength(persisted.candidateSource.source, "utf8") <=
      LEARN_VISUAL_REJECTED_ATTEMPT_SOURCE_MAX_BYTES,
    true,
  );
  assert.equal(persisted.candidateSource.truncated, true);
  assert.equal(persisted.candidateSource.redacted, true);
  assert.equal(persisted.candidateSource.fullByteLength, Buffer.byteLength(raw.candidate.sourceCode));
  assert.equal(
    persisted.candidateSource.sha256,
    crypto.createHash("sha256").update(raw.candidate.sourceCode).digest("hex"),
  );
  const serialized = JSON.stringify(persisted);
  assert.doesNotMatch(serialized, /Excluded title|candidate test|Excluded claim/);
  assert.doesNotMatch(serialized, /executable|stderr|stdoutTail|secret DOM|private-profile/);
  assert.doesNotMatch(
    serialized,
    /[A-Za-z]:\\|\\\\server\\|\/(?:home|tmp|root|workspace)\//,
  );
  assert.doesNotMatch(serialized, /forged-completion|forged-cleanup/);
  assert.doesNotMatch(serialized, /file:\/\//i);
  assert.equal(
    fs.readdirSync(path.dirname(expectedPath)).some((name) => name.endsWith(".tmp")),
    false,
  );

  const workspace = createLearnBuildWorkspace({
    gardenSlug: gardenId,
    jobId,
    mode: "generate",
    repositoryGardenDir: gardenDir,
    contractFingerprint: "contract-audit",
    sourceSetFingerprint: "sources-audit",
    workspaceRoot: path.join(root, "workspace"),
  });
  assert.equal(
    fs.existsSync(path.join(workspace.stagingGardenDir, ".breadboard", "learn-run-snapshots")),
    false,
    "build workspaces must not seed rejected-attempt audits",
  );
  disposeLearnBuildWorkspace(workspace);
  assert.equal(fs.existsSync(expectedPath), true, "workspace disposal must not erase durable evidence");

  removeLearnVisualRejectedAttemptAudit({
    gardenDir,
    jobId,
    visualizationId: raw.visualizationId,
  });
  assert.equal(fs.existsSync(path.dirname(path.dirname(expectedPath))), false);
  assert.equal(
    fs.existsSync(path.join(gardenDir, ".breadboard", "learn-run-snapshots", jobId, "manifest.json")),
    true,
    "visual success cleanup must preserve rollback metadata",
  );
});

test("path grammar rejects traversal and attempt values outside the semantic budget", () => {
  const root = temporaryRoot("breadboard-rejected-attempt-traversal");
  const gardenDir = path.join(root, "garden");
  const gardenId = "audit-garden";
  fs.mkdirSync(gardenDir, { recursive: true });
  createSnapshot(gardenDir, gardenId, "safe-job");
  const base = { gardenDir, gardenId, jobId: "safe-job" };

  assert.throws(
    () => persistLearnVisualRejectedAttemptAudit({ ...base, jobId: "../escape", rejectedAttempt: rejectedAttempt() }),
    /Unsafe job id/,
  );
  assert.throws(
    () => persistLearnVisualRejectedAttemptAudit({
      ...base,
      rejectedAttempt: rejectedAttempt({ visualizationId: "../escape" }),
    }),
    /Unsafe visualization id/,
  );
  assert.throws(
    () => persistLearnVisualRejectedAttemptAudit({
      ...base,
      rejectedAttempt: rejectedAttempt({ runId: "..\\escape" }),
    }),
    /Unsafe run id/,
  );
  assert.throws(
    () => persistLearnVisualRejectedAttemptAudit({
      ...base,
      rejectedAttempt: rejectedAttempt({ attempt: 9 }),
    }),
    /integer from 1 through 8/,
  );
  assert.throws(
    () => persistLearnVisualRejectedAttemptAudit({
      ...base,
      rejectedAttempt: rejectedAttempt({ category: "unbounded" }),
    }),
    /category is not allowlisted/,
  );
  assert.equal(fs.existsSync(path.join(root, "escape")), false);
});

test("persistence refuses a missing snapshot without creating orphan audit directories", () => {
  const root = temporaryRoot("breadboard-rejected-attempt-no-snapshot");
  const gardenDir = path.join(root, "garden");
  fs.mkdirSync(gardenDir, { recursive: true });
  assert.throws(
    () => persistLearnVisualRejectedAttemptAudit({
      gardenDir,
      gardenId: "audit-garden",
      jobId: "missing-job",
      rejectedAttempt: rejectedAttempt(),
    }),
    /snapshot root does not exist/,
  );
  assert.equal(fs.existsSync(path.join(gardenDir, ".breadboard")), false);

  const snapshotRoot = path.join(gardenDir, ".breadboard", "learn-run-snapshots");
  fs.mkdirSync(snapshotRoot, { recursive: true });
  assert.throws(
    () => persistLearnVisualRejectedAttemptAudit({
      gardenDir,
      gardenId: "audit-garden",
      jobId: "missing-job",
      rejectedAttempt: rejectedAttempt(),
    }),
    /Learn job snapshot does not exist/,
  );
  assert.equal(fs.existsSync(path.join(snapshotRoot, "missing-job")), false);
});

test("terminal cleanup removes sibling-job audit trees without deleting snapshot manifests", () => {
  const root = temporaryRoot("breadboard-rejected-attempt-siblings");
  const gardenDir = path.join(root, "garden");
  const gardenId = "audit-garden";
  fs.mkdirSync(gardenDir, { recursive: true });
  for (const [index, jobId] of ["learn-job-old", "learn-job-retry"].entries()) {
    createSnapshot(gardenDir, gardenId, jobId);
    persistLearnVisualRejectedAttemptAudit({
      gardenDir,
      gardenId,
      jobId,
      rejectedAttempt: rejectedAttempt({
        runId: `20260824-run-${index + 1}`,
      }),
    });
  }

  assert.equal(removeAllLearnVisualRejectedAttemptAudits(gardenDir), 2);
  for (const jobId of ["learn-job-old", "learn-job-retry"]) {
    const snapshotDir = path.join(
      gardenDir,
      ".breadboard",
      "learn-run-snapshots",
      jobId,
    );
    assert.equal(fs.existsSync(path.join(snapshotDir, "failed-generated-visuals")), false);
    assert.equal(fs.existsSync(path.join(snapshotDir, "manifest.json")), true);
  }
});
