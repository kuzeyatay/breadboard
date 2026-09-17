import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  canonicalRuntimeV2IngestBlobPath,
  ingestRecoveryRoot,
  retainIngestRecovery,
  retireIngestRecovery,
} from "../scripts/runtime-v2-document-ingestion-worker.mjs";

const dashboardRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function storeModule() {
  process.env.BREADBOARD_LEARN_SOURCE_ROOT = path.join(dashboardRoot, "src");
  await import("../scripts/learn-worker-import-hook.mjs");
  return import("../src/lib/runtime-v2/ingest-recovery-store.ts");
}

/** A failed job's launch record, the way the worker sees it. */
function failedLaunch({ dataRoot, jobId = "job_ingest_failed", content = "Feynman, volume II" }) {
  const bytes = Buffer.from(content, "utf8");
  const blobId = "blob_0123456789abcdef0123456789abcdef";
  const identity = { jobId, attempt: 1, workerInstanceId: "worker_ingest_failed" };
  const inputBlob = {
    blobId,
    relativePath: `runtime/jobs/${jobId}/inputs/${blobId}/payload`,
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    displayName: "The_Feynman_Lectures_on_Physics_Vol_II_E.pdf",
    mediaType: "application/pdf",
  };
  const blobPath = canonicalRuntimeV2IngestBlobPath(dataRoot, inputBlob);
  fs.mkdirSync(path.dirname(blobPath), { recursive: true });
  fs.writeFileSync(blobPath, bytes);
  return {
    blobPath,
    launch: {
      dataRoot,
      identity,
      executionScope: { userId: 1, gardenId: "electromagnetism-1", conversationId: null },
      inputBlob,
      request: {
        sourceLabel: null,
        isHandwriting: false,
        parseWithVlm: true,
        parseWithAnydoc: true,
        vlmTask: "doc_parse",
        generateMap: true,
        model: "openrouter/stealth/union-alpha",
        chatmockBaseUrl: "http://127.0.0.1:59114/v1",
        maximumUploadBytes: 512 * 1024 * 1024,
      },
    },
  };
}

test("a failed upload is retained with its bytes and request, and the dashboard lists it", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-recovery-"));
  try {
    const { launch, blobPath } = failedLaunch({ dataRoot });
    const quotaMessage =
      "The selected model and its fallbacks were rate-limited or out of credits, so the document could not be processed. Add provider credits or wait for the usage limit to reset, or choose another model, then retry the upload.";
    const recoveryId = retainIngestRecovery({
      launch,
      blobPath,
      publicMessage: quotaMessage,
      failureKind: "provider-quota",
      lastStep: "Retrying concept extraction for section 1 of 42 after a temporary upstream error (3/3)…",
      nowMs: 1_789_634_293_514,
    });
    assert.match(recoveryId, /^rec_[0-9a-f]{32}$/u);
    const directory = path.join(ingestRecoveryRoot(dataRoot, "electromagnetism-1"), recoveryId);
    assert.equal(
      fs.readFileSync(path.join(directory, "source")).equals(fs.readFileSync(blobPath)),
      true,
    );
    assert.equal(fs.existsSync(path.join(directory, "source.pending")), false);

    const store = await storeModule();
    const listed = store.listIngestRecoveries({
      gardenId: "electromagnetism-1",
      dataRoot,
      nowMs: 1_789_634_293_514 + 1000,
    });
    assert.equal(listed.length, 1);
    const [record] = listed;
    assert.equal(record.recoveryId, recoveryId);
    assert.equal(record.filename, launch.inputBlob.displayName);
    assert.equal(record.sha256, launch.inputBlob.sha256);
    assert.equal(record.sizeBytes, launch.inputBlob.sizeBytes);
    assert.equal(record.userId, 1);
    assert.equal(record.failedJobId, "job_ingest_failed");
    assert.deepEqual(record.failure, { message: quotaMessage, kind: "provider-quota" });
    assert.deepEqual(record.request, {
      sourceLabel: null,
      isHandwriting: false,
      parseWithVlm: true,
      parseWithAnydoc: true,
      vlmTask: "doc_parse",
      generateMap: true,
      model: "openrouter/stealth/union-alpha",
    });
    // The ChatMock endpoint is recomputed on resume, never replayed.
    assert.equal("chatmockBaseUrl" in record.request, false);

    const stored = store.readIngestRecovery({
      gardenId: "electromagnetism-1",
      recoveryId,
      dataRoot,
    });
    assert.equal(stored?.sourcePath, path.join(directory, "source"));

    const shown = store.publicIngestRecovery(record);
    assert.equal("userId" in shown, false);
    assert.equal("sha256" in shown, false);
    assert.equal(shown.request.model, "openrouter/stealth/union-alpha");
    assert.equal(shown.resumedJobId, null);

    // Marking a resume and clearing it round-trips through the manifest.
    const resumed = store.markIngestRecoveryResumed({
      gardenId: "electromagnetism-1",
      recoveryId,
      jobId: "job_ingest_resumed",
      nowMs: 5,
      dataRoot,
    });
    assert.equal(resumed?.resumedJobId, "job_ingest_resumed");
    assert.equal(resumed?.resumedAt, 5);
    const cleared = store.markIngestRecoveryResumed({
      gardenId: "electromagnetism-1",
      recoveryId,
      jobId: null,
      dataRoot,
    });
    assert.equal(cleared?.resumedJobId, null);
    assert.equal(cleared?.resumedAt, null);

    assert.equal(
      store.discardIngestRecovery({ gardenId: "electromagnetism-1", recoveryId, dataRoot }),
      true,
    );
    assert.equal(fs.existsSync(directory), false);
    assert.deepEqual(
      store.listIngestRecoveries({ gardenId: "electromagnetism-1", dataRoot }),
      [],
    );
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("one record per document: a newer failure replaces the older copy", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-recovery-"));
  try {
    const first = failedLaunch({ dataRoot, jobId: "job_ingest_first" });
    const firstId = retainIngestRecovery({
      launch: first.launch,
      blobPath: first.blobPath,
      publicMessage: "Runtime job execution failed.",
      failureKind: "runtime",
      lastStep: "",
      nowMs: 1000,
    });
    const second = failedLaunch({ dataRoot, jobId: "job_ingest_second" });
    const secondId = retainIngestRecovery({
      launch: second.launch,
      blobPath: second.blobPath,
      publicMessage: "Runtime job execution failed.",
      failureKind: "runtime",
      lastStep: "",
      nowMs: 2000,
    });
    const other = failedLaunch({ dataRoot, jobId: "job_ingest_other", content: "another book" });
    retainIngestRecovery({
      launch: other.launch,
      blobPath: other.blobPath,
      publicMessage: "Runtime job execution failed.",
      failureKind: "runtime",
      lastStep: "",
      nowMs: 3000,
    });
    const store = await storeModule();
    const listed = store.listIngestRecoveries({ gardenId: "electromagnetism-1", dataRoot, nowMs: 4000 });
    assert.deepEqual(
      listed.map((record) => record.failedJobId),
      ["job_ingest_other", "job_ingest_second"],
    );
    assert.equal(listed.some((record) => record.recoveryId === firstId), false);
    assert.equal(listed.some((record) => record.recoveryId === secondId), true);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("expired, tampered, and truncated records are pruned rather than offered", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-recovery-"));
  try {
    const store = await storeModule();
    const { launch, blobPath } = failedLaunch({ dataRoot });
    const expiredId = retainIngestRecovery({
      launch,
      blobPath,
      publicMessage: "Runtime job execution failed.",
      failureKind: "runtime",
      lastStep: "",
      nowMs: 1000,
    });
    const root = ingestRecoveryRoot(dataRoot, "electromagnetism-1");
    assert.deepEqual(
      store.listIngestRecoveries({
        gardenId: "electromagnetism-1",
        dataRoot,
        nowMs: 1000 + store.INGEST_RECOVERY_RETENTION_MS + 1,
      }),
      [],
    );
    assert.equal(fs.existsSync(path.join(root, expiredId)), false);

    const truncated = failedLaunch({ dataRoot, jobId: "job_ingest_truncated", content: "truncated copy" });
    const truncatedId = retainIngestRecovery({
      launch: truncated.launch,
      blobPath: truncated.blobPath,
      publicMessage: "Runtime job execution failed.",
      failureKind: "runtime",
      lastStep: "",
      nowMs: 1000,
    });
    fs.truncateSync(path.join(root, truncatedId, "source"), 3);

    const tampered = failedLaunch({ dataRoot, jobId: "job_ingest_tampered", content: "tampered manifest" });
    const tamperedId = retainIngestRecovery({
      launch: tampered.launch,
      blobPath: tampered.blobPath,
      publicMessage: "Runtime job execution failed.",
      failureKind: "runtime",
      lastStep: "",
      nowMs: 1000,
    });
    const manifestPath = path.join(root, tamperedId, "recovery.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.failure.message = "C:\\private\\path.pdf failed";
    manifest.request.model = { evil: true };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    // Old directories only: a record the worker is mid-write on is left alone.
    const past = new Date(Date.now() - 120_000);
    fs.utimesSync(path.join(root, truncatedId), past, past);
    fs.utimesSync(path.join(root, tamperedId), past, past);
    assert.deepEqual(
      store.listIngestRecoveries({ gardenId: "electromagnetism-1", dataRoot, nowMs: Date.now() }),
      [],
    );
    assert.equal(fs.existsSync(path.join(root, truncatedId)), false);
    assert.equal(fs.existsSync(path.join(root, tamperedId)), false);
    assert.equal(
      store.readIngestRecovery({ gardenId: "electromagnetism-1", recoveryId: "rec_not-an-id", dataRoot }),
      null,
    );
    assert.throws(
      () => store.ingestRecoveryRoot("../escape", dataRoot),
      /garden is invalid/u,
    );
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("a successful ingestion of the same document retires its retained copy", async () => {
  // The document can land either by pressing Resume or by uploading the file
  // again. Retention is keyed by digest, so both paths must clear the record;
  // otherwise the garden keeps offering to resume work that already finished.
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-recovery-"));
  try {
    const failed = failedLaunch({ dataRoot, jobId: "job_ingest_failed_once" });
    const recoveryId = retainIngestRecovery({
      launch: failed.launch,
      blobPath: failed.blobPath,
      publicMessage: "Runtime job execution failed.",
      failureKind: "runtime",
      lastStep: "Extracting concepts from section 33 of 42…",
      nowMs: 1000,
    });
    const root = ingestRecoveryRoot(dataRoot, "electromagnetism-1");
    assert.equal(fs.existsSync(path.join(root, recoveryId)), true);

    // A different document's record is untouched by this one's success.
    const other = failedLaunch({ dataRoot, jobId: "job_other", content: "a different book" });
    const otherId = retainIngestRecovery({
      launch: other.launch,
      blobPath: other.blobPath,
      publicMessage: "Runtime job execution failed.",
      failureKind: "runtime",
      lastStep: "",
      nowMs: 1000,
    });

    // A fresh job for the same bytes succeeds.
    const rerun = failedLaunch({ dataRoot, jobId: "job_ingest_rerun" });
    retireIngestRecovery({ launch: rerun.launch });

    assert.equal(fs.existsSync(path.join(root, recoveryId)), false);
    assert.equal(fs.existsSync(path.join(root, otherId)), true);
    const store = await storeModule();
    assert.deepEqual(
      store
        .listIngestRecoveries({ gardenId: "electromagnetism-1", dataRoot, nowMs: 2000 })
        .map((record) => record.recoveryId),
      [otherId],
    );

    // Retiring when nothing is retained is a no-op, not an error.
    retireIngestRecovery({ launch: rerun.launch });
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});
