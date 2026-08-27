import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  executeRuntimeV2OfficeOperation,
} from "../../scripts/runtime-v2-office-artifact-worker.mjs";

const MUTATED_ENVIRONMENT_KEYS = [
  "BREADBOARD_DATA_DIR",
  "BREADBOARD_DEVELOPMENT_DASHBOARD_DIR",
  "BREADBOARD_REPO_ROOT",
  "QUARTZ_CONTENT_PATH",
  "BOOK_TO_SKILL_ROOT",
  "NODE_ENV",
  "OFFICECLI_NO_AUTO_RESIDENT",
  "OFFICECLI_RESIDENT_FLUSH",
  "OFFICECLI_SKIP_UPDATE",
];

function sameAuthority(left, right) {
  return left?.userId === right?.userId &&
    left?.gardenId === right?.gardenId &&
    left?.conversationId === right?.conversationId;
}

function fileDigest(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function jobSnapshot(identity, authority, state = "succeeded") {
  const now = Date.now();
  return {
    jobId: identity.jobId,
    jobType: "office-artifact",
    workerKind: "office-artifact-node",
    resourceClass: "document-processing",
    state,
    stage: null,
    attempt: identity.attempt,
    workerInstanceId: identity.workerInstanceId,
    gardenId: authority.gardenId,
    conversationId: authority.conversationId,
    createdAt: now,
    startedAt: now,
    updatedAt: now,
    finishedAt: state === "succeeded" ? now : null,
    lastHeartbeatAt: now,
    lastWorkerSequence: 3,
    progressCurrent: state === "succeeded" ? 3 : 0,
    progressTotal: 3,
    failureCode: null,
    failureMessage: null,
    resourceExhaustion: null,
    cancellationRequested: false,
  };
}

/**
 * Test-only Runtime adapter. It retains the product protocol boundary: callers
 * reserve and stream sealed blobs, submit a bounded fixed job, and consume a
 * fenced result. The actual fixed Office worker operation produces the files.
 */
export function createOfficeRuntimeFixture() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "office-runtime-fixture-"));
  const priorEnvironment = new Map(
    MUTATED_ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]),
  );
  process.env.BREADBOARD_DATA_DIR = dataRoot;

  const reservations = new Map();
  const jobs = new Map();
  let sequence = 0;

  function reservationFor(authority, uploadId) {
    const reservation = reservations.get(uploadId);
    if (!reservation || !sameAuthority(reservation.authority, authority)) {
      throw new Error("The Office Runtime test upload is unavailable.");
    }
    return reservation;
  }

  const control = {
    async reserve(authority, request) {
      const uploadId = `office_test_upload_${++sequence}`;
      const stagedPath = path.join(dataRoot, "pending-inputs", uploadId);
      fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
      reservations.set(uploadId, {
        authority: structuredClone(authority),
        request: structuredClone(request),
        stagedPath,
        sealed: false,
      });
      return {
        uploadId,
        expiresAt: Date.now() + 60_000,
        maximumBytes: request.declaredSizeBytes,
        displayName: request.displayName,
        mediaType: request.mediaType,
        declaredSizeBytes: request.declaredSizeBytes,
      };
    },

    async upload(authority, reservation, body, signal) {
      const record = reservationFor(authority, reservation.uploadId);
      if (record.sealed) throw new Error("The Office Runtime test upload is already sealed.");
      const descriptor = fs.openSync(record.stagedPath, "wx", 0o600);
      const hash = createHash("sha256");
      let sizeBytes = 0;
      try {
        const reader = body.getReader();
        for (;;) {
          if (signal?.aborted) {
            throw signal.reason ?? new DOMException("Aborted", "AbortError");
          }
          const { done, value } = await reader.read();
          if (done) break;
          const bytes = Buffer.from(value);
          fs.writeSync(descriptor, bytes);
          hash.update(bytes);
          sizeBytes += bytes.byteLength;
          if (sizeBytes > record.request.declaredSizeBytes) {
            throw new Error("The Office Runtime test upload exceeded its declaration.");
          }
        }
      } finally {
        fs.closeSync(descriptor);
      }
      if (sizeBytes !== record.request.declaredSizeBytes) {
        throw new Error("The Office Runtime test upload size changed.");
      }
      record.sealed = true;
      record.sizeBytes = sizeBytes;
      record.sha256 = hash.digest("hex");
      return {
        uploadId: reservation.uploadId,
        sizeBytes,
        sha256: record.sha256,
        displayName: record.request.displayName,
        mediaType: record.request.mediaType,
      };
    },

    async abandon(authority, uploadId) {
      const record = reservationFor(authority, uploadId);
      fs.rmSync(record.stagedPath, { force: true });
      reservations.delete(uploadId);
    },

    async submit(authority, submission) {
      if (submission.jobType !== "office-artifact") {
        throw new Error("The Office Runtime test adapter accepts only the fixed Office job.");
      }
      const identity = {
        jobId: `office_test_job_${++sequence}`,
        attempt: 1,
        workerInstanceId: `office_test_worker_${sequence}`,
      };
      const workspacePath = path.join(
        dataRoot,
        "runtime",
        "jobs",
        identity.jobId,
        "attempts",
        "1",
        identity.workerInstanceId,
        "workspace",
      );
      fs.mkdirSync(workspacePath, { recursive: true });
      const inputBlobs = (submission.inputUploads ?? []).map(({ uploadId }) => {
        const record = reservationFor(authority, uploadId);
        if (!record.sealed || !record.sha256 || !record.sizeBytes) {
          throw new Error("The Office Runtime test input is not sealed.");
        }
        const relativePath = `runtime/jobs/${identity.jobId}/inputs/${uploadId}/payload`;
        const payloadPath = path.join(dataRoot, ...relativePath.split("/"));
        fs.mkdirSync(path.dirname(payloadPath), { recursive: true });
        fs.copyFileSync(record.stagedPath, payloadPath, fs.constants.COPYFILE_EXCL);
        if (fileDigest(payloadPath) !== record.sha256) {
          throw new Error("The Office Runtime test input changed while staged.");
        }
        fs.rmSync(record.stagedPath, { force: true });
        reservations.delete(uploadId);
        return {
          blobId: uploadId,
          relativePath,
          sizeBytes: record.sizeBytes,
          sha256: record.sha256,
          displayName: record.request.displayName,
          mediaType: record.request.mediaType,
        };
      });
      const launch = {
        dataRoot,
        identity,
        executionScope: structuredClone(authority),
        request: structuredClone(submission.requestPayload),
        inputBlobs,
        inputBlob: inputBlobs[0] ?? null,
        workspacePath,
      };
      const abort = new AbortController();
      const snapshot = jobSnapshot(identity, authority, "running");
      jobs.set(identity.jobId, { authority: structuredClone(authority), snapshot, abort });
      try {
        const result = await executeRuntimeV2OfficeOperation(launch, abort.signal);
        const completed = {
          ...jobSnapshot(identity, authority),
          lastWorkerSequence: snapshot.lastWorkerSequence,
        };
        jobs.set(identity.jobId, {
          authority: structuredClone(authority),
          snapshot: completed,
          abort,
          output: {
            protocolVersion: 1,
            identity,
            completionSequence: completed.lastWorkerSequence,
            result,
          },
        });
        return structuredClone(completed);
      } catch (error) {
        jobs.delete(identity.jobId);
        throw new Error(
          `The fixed Office Runtime test worker failed: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    },

    async inspect(authority, jobId) {
      const job = jobs.get(jobId);
      if (!job || !sameAuthority(job.authority, authority)) {
        throw new Error("The Office Runtime test job is unavailable.");
      }
      return structuredClone(job.snapshot);
    },

    async readOutput(authority, jobId, kind) {
      const job = jobs.get(jobId);
      if (!job || !sameAuthority(job.authority, authority) || kind !== "result" || !job.output) {
        throw new Error("The Office Runtime test result is unavailable.");
      }
      return { jobId, kind, content: structuredClone(job.output) };
    },

    async cancel(authority, jobId) {
      const job = jobs.get(jobId);
      if (!job || !sameAuthority(job.authority, authority)) {
        throw new Error("The Office Runtime test job is unavailable.");
      }
      job.abort.abort(new DOMException("Aborted", "AbortError"));
      job.snapshot = {
        ...job.snapshot,
        state: "cancelled",
        stage: null,
        finishedAt: Date.now(),
        updatedAt: Date.now(),
        cancellationRequested: true,
      };
      return structuredClone(job.snapshot);
    },
  };

  return {
    dataRoot,
    control,
    cleanup() {
      for (const [key, value] of priorEnvironment) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(dataRoot, {
        recursive: true,
        force: true,
        maxRetries: process.platform === "win32" ? 10 : 0,
        retryDelay: 100,
      });
    },
  };
}
