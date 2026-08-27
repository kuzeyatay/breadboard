import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  expectedRuntimeV2OuterAgentInputCount,
  RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS,
  validateRuntimeV2WardrobeRequest,
} from "../scripts/runtime-v2-outer-agent-adapters.mjs";

const dashboardRoot = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
const workerPath = path.join(
  dashboardRoot,
  "scripts",
  "runtime-v2-wardrobe-worker.mjs",
);
const source = (relativePath) =>
  fs.readFileSync(path.join(dashboardRoot, relativePath), "utf8");
const PHOTO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
  "base64",
);
const SERVICE_TOKEN = "wardrobe-runtime-test-capability-0000000001";

function canonicalRequest(overrides = {}) {
  return {
    request: {
      direction: "Treat this as outerwear.",
      maxItemsPerPhoto: 6,
      quality: "high",
    },
    model: "test-model",
    baseUrl: "http://127.0.0.1:8765/v1",
    conversationPublicId: `conv_${"w".repeat(24)}`,
    conversationContext: "User: Add the coat from this photo.",
    photos: [
      { name: "coat.png", mediaType: "image/png", sizeBytes: PHOTO.byteLength },
    ],
    ...overrides,
  };
}

function runtimeFixture(request, blobOverrides = {}) {
  const dataRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "breadboard-wardrobe-runtime-"),
  );
  const jobId = "job_wardrobe_1";
  const workerInstanceId = "worker_wardrobe_1";
  const jobRoot = path.join(dataRoot, "runtime", "jobs", jobId);
  const attemptRoot = path.join(jobRoot, "attempts", "1", workerInstanceId);
  const blobId = "blob_wardrobe_1";
  const inputPath = path.join(jobRoot, "inputs", blobId, "payload");
  fs.mkdirSync(path.dirname(inputPath), { recursive: true });
  fs.mkdirSync(path.join(attemptRoot, "workspace"), { recursive: true });
  fs.writeFileSync(inputPath, PHOTO);
  fs.writeFileSync(
    path.join(jobRoot, "input.json"),
    `${JSON.stringify(request)}\n`,
  );
  const blob = {
    blobId,
    relativePath: `runtime/jobs/${jobId}/inputs/${blobId}/payload`,
    sizeBytes: PHOTO.byteLength,
    sha256: crypto.createHash("sha256").update(PHOTO).digest("hex"),
    displayName: "coat.png",
    mediaType: "image/png",
    ...blobOverrides,
  };
  fs.writeFileSync(
    path.join(attemptRoot, "start.json"),
    `${JSON.stringify({
      protocolVersion: 1,
      identity: { jobId, attempt: 1, workerInstanceId },
      executionScope: {
        userId: 7,
        gardenId: null,
        conversationId: `oa_wardrobe_${"a".repeat(32)}`,
      },
      inputManifestPath: `runtime/jobs/${jobId}/input.json`,
      inputBlobs: [blob],
      workspacePath: `runtime/jobs/${jobId}/attempts/1/${workerInstanceId}/workspace`,
      checkpointPath: `runtime/jobs/${jobId}/checkpoint.json`,
      resultPath: `runtime/jobs/${jobId}/result.json`,
    })}\n`,
  );
  return { dataRoot, jobRoot, attemptRoot };
}

function wardrobeServer({ hangDetection = false } = {}) {
  const pending = new Set();
  let origin = "";
  let ensureRequest = null;
  let ensureAuthorization = "";
  let detectionRequest = null;
  let detectionStartedResolve;
  const detectionStarted = new Promise((resolve) => {
    detectionStartedResolve = resolve;
  });
  const server = http.createServer((request, response) => {
    pending.add(response);
    response.on("close", () => pending.delete(response));
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      if (request.url === "/v1/ensure") {
        ensureAuthorization = request.headers.authorization ?? "";
        ensureRequest = JSON.parse(body);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            ok: true,
            result: { baseUrl: origin, root: "test", startedAt: Date.now() },
          }),
        );
        return;
      }
      if (request.url === "/api/import/jobs") {
        detectionRequest = JSON.parse(body);
        detectionStartedResolve();
        if (hangDetection) return;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ jobs: [], noClothingDetected: true }));
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
    });
  });
  return {
    detectionStarted,
    get ensureRequest() {
      return ensureRequest;
    },
    get ensureAuthorization() {
      return ensureAuthorization;
    },
    get detectionRequest() {
      return detectionRequest;
    },
    async listen() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("test server unavailable");
      origin = `http://127.0.0.1:${address.port}`;
      return origin;
    },
    async close() {
      for (const response of pending) response.destroy();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function runWorker(fixture, serviceUrl, { stopWhen } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath, "start.json"], {
      cwd: fixture.attemptRoot,
      env: {
        ...process.env,
        BREADBOARD_WARDROBE_SERVICE_URL: `${serviceUrl}/`,
        BREADBOARD_WARDROBE_SERVICE_TOKEN: SERVICE_TOKEN,
        NODE_NO_WARNINGS: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let stopSent = false;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Wardrobe Runtime worker timed out.\n${stderr}`));
    }, 25_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    if (stopWhen) {
      void stopWhen.then(() => {
        if (stopSent || child.exitCode !== null) return;
        stopSent = true;
        child.stdin.write('{"type":"stop","force":false}\n');
      });
    }
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

test("Wardrobe has one exact sealed one-to-ten-photo Runtime contract", () => {
  const request = canonicalRequest();
  assert.equal(validateRuntimeV2WardrobeRequest(request), request);
  assert.equal(expectedRuntimeV2OuterAgentInputCount("wardrobe", request), 1);
  assert.deepEqual(RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS.wardrobe, {
    id: "wardrobe",
    workerKind: "outer-wardrobe-node",
    jobType: "wardrobe-run",
    scopePrefix: "oa_wardrobe_",
    maximumInputs: 10,
  });
  for (const invalid of [
    { ...request, serviceToken: "renderer-selected" },
    canonicalRequest({
      request: { ...request.request, direction: "x".repeat(1_201) },
    }),
    canonicalRequest({ baseUrl: "http://user:secret@127.0.0.1:8765/v1" }),
    canonicalRequest({ photos: [] }),
    canonicalRequest({
      photos: [{ ...request.photos[0], name: "../coat.png" }],
    }),
    canonicalRequest({
      photos: [{ ...request.photos[0], mediaType: "image/svg+xml" }],
    }),
    canonicalRequest({
      photos: [{ ...request.photos[0], sizeBytes: 10 * 1024 * 1024 + 1 }],
    }),
  ]) {
    assert.throws(
      () => validateRuntimeV2WardrobeRequest(invalid),
      /canonical Wardrobe Runtime request is invalid/u,
    );
  }
});

test("Wardrobe compatibility routes only submit, replay, and cancel durable Runtime jobs", () => {
  const facade = source("src/lib/wardrobe/runtime-run-manager.ts");
  const manager = source("src/lib/wardrobe/run-manager.ts");
  const launch = source("src/app/api/wardrobe/runs/route.ts");
  const events = source("src/app/api/wardrobe/runs/[runId]/events/route.ts");
  const abort = source("src/app/api/wardrobe/runs/[runId]/abort/route.ts");
  const cancellation = source("src/lib/conversations/external-agent-cancel.ts");

  assert.match(facade, /kind: "wardrobe"/u);
  assert.match(facade, /inputBlobs: photos\.map/u);
  assert.match(manager, /export function startRuntimeWorkerRun/u);
  assert.match(manager, /runtimePhotos\?:/u);
  assert.match(launch, /from "@\/lib\/wardrobe\/runtime-run-manager\.ts"/u);
  assert.match(launch, /const run = await startRun\(/u);
  assert.doesNotMatch(
    launch,
    /wardrobe\/run-manager|node:child_process|\bspawn\s*\(/u,
  );
  assert.match(events, /outerAgentEventsResponse/u);
  assert.match(events, /readOuterAgentRunView\("wardrobe"/u);
  assert.doesNotMatch(events, /setInterval|wardrobe\/run-manager/u);
  assert.match(abort, /await abortRun\(userId, runId\)/u);
  assert.match(cancellation, /wardrobe\/runtime-run-manager\.ts/u);
  assert.match(
    source("scripts/runtime-v2-wardrobe-worker.mjs"),
    /runRuntimeV2OuterAgentWorker\("wardrobe"\)/u,
  );
});

test("the real disposable Wardrobe worker streams one sealed photo and persists completion", async () => {
  const service = wardrobeServer();
  const serviceUrl = await service.listen();
  const request = canonicalRequest();
  const fixture = runtimeFixture(request);
  try {
    const child = await runWorker(fixture, serviceUrl);
    assert.equal(child.code, 0, child.stderr);
    assert.equal(service.ensureAuthorization, `Bearer ${SERVICE_TOKEN}`);
    assert.equal(service.ensureRequest.scope.userId, 7);
    assert.equal(service.ensureRequest.options.upstreamUrl, request.baseUrl);
    assert.match(
      service.detectionRequest.imageDataUrl,
      /^data:image\/png;base64,/u,
    );
    assert.equal(
      Buffer.from(
        service.detectionRequest.imageDataUrl.split(",")[1],
        "base64",
      ).equals(PHOTO),
      true,
    );
    const result = JSON.parse(
      fs.readFileSync(path.join(fixture.jobRoot, "result.json"), "utf8"),
    );
    assert.equal(result.run.adapterId, "wardrobe");
    assert.equal(result.run.status, "completed");
    const terminal = result.run.events.find(
      (event) => event.type === "run.completed",
    );
    assert.match(terminal.payload.summary, /No clothing was found/u);
    assert.match(child.stdout, /"type":"ready"/u);
    assert.match(child.stdout, /"type":"complete"/u);
  } finally {
    await service.close();
    fs.rmSync(fixture.dataRoot, { recursive: true, force: true });
  }
});

test("a Runtime stop aborts a hung Wardrobe request without publishing a result", async () => {
  const service = wardrobeServer({ hangDetection: true });
  const serviceUrl = await service.listen();
  const fixture = runtimeFixture(canonicalRequest());
  try {
    const child = await runWorker(fixture, serviceUrl, {
      stopWhen: service.detectionStarted,
    });
    assert.equal(child.code, 0, child.stderr);
    assert.equal(
      fs.existsSync(path.join(fixture.jobRoot, "result.json")),
      false,
    );
    const checkpoint = JSON.parse(
      fs.readFileSync(path.join(fixture.jobRoot, "checkpoint.json"), "utf8"),
    );
    assert.equal(checkpoint.status, "aborted");
    assert.ok(checkpoint.events.some((event) => event.type === "run.aborted"));
    assert.match(child.stdout, /"type":"cancellation-acknowledged"/u);
  } finally {
    await service.close();
    fs.rmSync(fixture.dataRoot, { recursive: true, force: true });
  }
});
