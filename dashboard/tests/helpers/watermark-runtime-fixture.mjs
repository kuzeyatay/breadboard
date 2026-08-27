import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  executeRuntimeV2WatermarkOperation,
} from "../../scripts/runtime-v2-watermark-worker.mjs";
import { scriptsDir } from "../../src/lib/watermarks/scripts.ts";

function pythonExecutable() {
  const configured = process.env.WATERMARKS_REMOVER_PYTHON?.trim();
  const candidates = [
    ...(configured ? [configured] : []),
    ...(process.platform === "win32" ? ["python.exe", "python", "python3"] : ["python3", "python"]),
  ];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["-c", "import sys; print(sys.executable)"], {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    });
    const resolved = probe.status === 0 ? probe.stdout.trim() : "";
    if (resolved && path.isAbsolute(resolved) && fs.existsSync(resolved)) return resolved;
  }
  throw new Error("Python 3 is required for the watermark Runtime fixture.");
}

function closedPythonEnvironment(root) {
  const home = path.join(root, "python-home");
  const temp = path.join(root, "python-temp");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(temp, { recursive: true });
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || process.env.WINDIR;
  return {
    PATH: "",
    HOME: home,
    USERPROFILE: home,
    TEMP: temp,
    TMP: temp,
    TMPDIR: temp,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    PYTHONNOUSERSITE: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    ...(systemRoot ? { SystemRoot: systemRoot, SYSTEMROOT: systemRoot, WINDIR: systemRoot } : {}),
  };
}

function digest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function createWatermarkRuntimeFixture() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "watermark-runtime-fixture-"));
  const priorDataRoot = process.env.BREADBOARD_DATA_DIR;
  process.env.BREADBOARD_DATA_DIR = dataRoot;
  const python = pythonExecutable();
  const reservations = new Map();
  const jobs = new Map();
  const calls = { reserves: [], uploads: [], submissions: [] };
  let serial = 0;
  const control = {
    async reserve(authority, request) {
      calls.reserves.push({ authority, request });
      const uploadId = `upload_${++serial}`;
      const staged = path.join(dataRoot, `${uploadId}.pending`);
      reservations.set(uploadId, { authority, request, staged });
      return { uploadId, expiresAt: Date.now() + 60_000, maximumBytes: request.declaredSizeBytes };
    },
    async upload(authority, reservation, body) {
      calls.uploads.push({ authority, uploadId: reservation.uploadId });
      const record = reservations.get(reservation.uploadId);
      if (!record || record.authority.userId !== authority.userId) throw new Error("Unknown upload.");
      const descriptor = fs.openSync(record.staged, "wx");
      let sizeBytes = 0;
      try {
        const reader = body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const bytes = Buffer.from(value);
          fs.writeSync(descriptor, bytes);
          sizeBytes += bytes.byteLength;
        }
      } finally {
        fs.closeSync(descriptor);
      }
      if (sizeBytes !== record.request.declaredSizeBytes) throw new Error("Upload size mismatch.");
      record.sizeBytes = sizeBytes;
      record.sha256 = digest(record.staged);
      return { uploadId: reservation.uploadId };
    },
    async abandon(_authority, uploadId) {
      const record = reservations.get(uploadId);
      if (record) fs.rmSync(record.staged, { force: true });
      reservations.delete(uploadId);
    },
    async submit(authority, submission) {
      calls.submissions.push({ authority, submission });
      const upload = reservations.get(submission.inputUploads?.[0]?.uploadId);
      if (!upload || upload.sizeBytes === undefined || !upload.sha256) throw new Error("No sealed upload.");
      const jobId = `job_${++serial}`;
      const workerInstanceId = `worker_${serial}`;
      const blobId = `blob_${serial}`;
      const workspace = path.join(
        dataRoot, "runtime", "jobs", jobId, "attempts", "1", workerInstanceId, "workspace",
      );
      const payload = path.join(dataRoot, "runtime", "jobs", jobId, "inputs", blobId, "payload");
      fs.mkdirSync(workspace, { recursive: true });
      fs.mkdirSync(path.dirname(payload), { recursive: true });
      fs.copyFileSync(upload.staged, payload);
      fs.rmSync(upload.staged, { force: true });
      reservations.delete(submission.inputUploads[0].uploadId);
      const snapshot = {
        jobId,
        jobType: "watermark-operation",
        workerKind: "watermark-operation-node",
        resourceClass: "document-processing",
        gardenId: authority.gardenId,
        conversationId: authority.conversationId,
        state: "running",
        attempt: 1,
        workerInstanceId,
        lastWorkerSequence: 17,
        failureMessage: null,
      };
      const launch = {
        dataRoot,
        identity: { jobId, attempt: 1, workerInstanceId },
        executionScope: authority,
        request: submission.requestPayload,
        inputBlobs: [{
          blobId,
          relativePath: `runtime/jobs/${jobId}/inputs/${blobId}/payload`,
          sizeBytes: upload.sizeBytes,
          sha256: upload.sha256,
          displayName: upload.request.displayName,
          mediaType: upload.request.mediaType,
        }],
        workspacePath: workspace,
      };
      try {
        const result = await executeRuntimeV2WatermarkOperation(
          launch,
          new AbortController().signal,
          { checkpoint() {} },
          {
            layout: () => ({
              python,
              scripts: scriptsDir(),
              env: closedPythonEnvironment(workspace),
            }),
          },
        );
        snapshot.state = "succeeded";
        jobs.set(jobId, {
          snapshot,
          content: {
            protocolVersion: 1,
            identity: launch.identity,
            completionSequence: snapshot.lastWorkerSequence,
            result,
          },
        });
      } catch (error) {
        snapshot.state = "failed";
        snapshot.failureMessage = error instanceof Error ? error.message : String(error);
        jobs.set(jobId, { snapshot, content: null });
      }
      return snapshot;
    },
    async inspect(_authority, jobId) {
      return jobs.get(jobId).snapshot;
    },
    async readOutput(_authority, jobId) {
      return { kind: "result", content: jobs.get(jobId).content };
    },
    async cancel(_authority, jobId) {
      const record = jobs.get(jobId);
      record.snapshot.state = "cancelled";
      return record.snapshot;
    },
  };
  return {
    dataRoot,
    calls,
    control,
    scope: { userId: 1, gardenId: null, conversationId: "1" },
    execution: {
      scope: { userId: 1, gardenId: null, conversationId: "1" },
      control,
    },
    cleanup() {
      if (priorDataRoot === undefined) delete process.env.BREADBOARD_DATA_DIR;
      else process.env.BREADBOARD_DATA_DIR = priorDataRoot;
      fs.rmSync(dataRoot, { recursive: true, force: true });
    },
  };
}
