import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseIngestUpload,
  StagedIngestUpload,
  uploadLimitBytes,
} from "../src/lib/ingest-upload.ts";

function multipartRequest({ boundary, size, chunkSize = 64 * 1024 }) {
  const header = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="clusterSlug"\r\n\r\nstream-test\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="large.bin"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`,
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  let phase = 0;
  let remaining = size;
  let pulls = 0;
  const body = new ReadableStream({
    pull(controller) {
      pulls += 1;
      if (phase === 0) {
        phase = 1;
        controller.enqueue(header);
        return;
      }
      if (phase === 1 && remaining > 0) {
        const count = Math.min(chunkSize, remaining);
        remaining -= count;
        controller.enqueue(Buffer.alloc(count, 0x61));
        return;
      }
      if (phase === 1) {
        phase = 2;
        controller.enqueue(footer);
        return;
      }
      controller.close();
    },
  });
  const request = new Request("http://127.0.0.1/api/ingest", {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body,
    duplex: "half",
  });
  return { request, pulls: () => pulls };
}

test("multipart ingestion streams a large upload to a private staging file", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-ingest-stream-"));
  const previous = process.env.BREADBOARD_DATA_DIR;
  process.env.BREADBOARD_DATA_DIR = dataRoot;
  const size = 6 * 1024 * 1024 + 17;
  const source = multipartRequest({ boundary: "breadboard-stream-boundary", size });
  let parsed;
  try {
    parsed = await parseIngestUpload(source.request);
    assert.equal(parsed.fields.get("clusterSlug"), "stream-test");
    assert.ok(parsed.file instanceof StagedIngestUpload);
    assert.equal(parsed.file.size, size);
    assert.equal(fs.statSync(parsed.file.path).size, size);
    assert.ok(source.pulls() > 50, "the request body should be consumed as bounded chunks");

    const first = await parsed.file.readBuffer();
    const second = await parsed.file.readBuffer();
    assert.equal(parsed.file.sha256, createHash("sha256").update(first).digest("hex"));
    assert.equal(first, second, "random-access parsers share one cached Buffer");
    assert.equal(first.byteLength, size);
    await parsed.cleanup();
    assert.equal(fs.existsSync(path.dirname(parsed.file.path)), false);
  } finally {
    if (parsed && fs.existsSync(path.dirname(parsed.file?.path ?? dataRoot))) {
      await parsed.cleanup();
    }
    process.env.BREADBOARD_DATA_DIR = previous;
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("configured Runtime V2 ingestion streams Busboy file bytes straight into one reservation", async () => {
  const size = 5 * 1024 * 1024 + 7;
  const observed = { uploaded: Buffer.alloc(0), uploadChunks: 0, abandoned: 0 };
  const server = http.createServer(async (request, response) => {
    if (request.url === "/v1/job-inputs" && request.method === "POST") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const reservation = JSON.parse(body);
      assert.equal(reservation.gardenId, "stream-test");
      assert.equal(reservation.declaredSizeBytes, size);
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({
        uploadId: "upload_stream_1",
        expiresAt: Date.now() + 60_000,
        maximumBytes: 2 * 1024 * 1024 * 1024,
      }));
      return;
    }
    if (request.url === "/v1/job-inputs/upload_stream_1" && request.method === "PUT") {
      const chunks = [];
      for await (const chunk of request) {
        observed.uploadChunks += 1;
        chunks.push(Buffer.from(chunk));
      }
      observed.uploaded = Buffer.concat(chunks);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        type: "runtime-job-input",
        protocolVersion: 1,
        uploadId: "upload_stream_1",
        state: "sealed",
        sizeBytes: observed.uploaded.byteLength,
        sha256: createHash("sha256").update(observed.uploaded).digest("hex"),
      }));
      return;
    }
    if (request.url === "/v1/job-inputs/upload_stream_1/abandon") {
      observed.abandoned += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const previous = {
    url: process.env.BREADBOARD_SUPERVISOR_CONTROL_URL,
    token: process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN,
  };
  process.env.BREADBOARD_SUPERVISOR_CONTROL_URL = `http://127.0.0.1:${address.port}`;
  process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN = "0123456789abcdef0123456789abcdef";
  const source = multipartRequest({ boundary: "breadboard-runtime-stream", size });
  let parsed;
  try {
    parsed = await parseIngestUpload(source.request, {
      authority: { userId: 42, gardenId: "stream-test", conversationId: null },
      declaredSizeBytes: size,
    });
    assert.equal(parsed.file.size, size);
    assert.equal(observed.uploaded.byteLength, size);
    assert.ok(observed.uploadChunks > 1);
    assert.equal(source.pulls() > 50, true);
    await parsed.cleanup();
    assert.equal(observed.abandoned, 1);
  } finally {
    await parsed?.cleanup();
    if (previous.url === undefined) delete process.env.BREADBOARD_SUPERVISOR_CONTROL_URL;
    else process.env.BREADBOARD_SUPERVISOR_CONTROL_URL = previous.url;
    if (previous.token === undefined) delete process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN;
    else process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN = previous.token;
    await new Promise((resolve) => server.close(resolve));
  }
});

test("ingestion upload limits are strict and bounded", () => {
  assert.equal(uploadLimitBytes({}), 512 * 1024 * 1024);
  assert.equal(uploadLimitBytes({ BREADBOARD_INGEST_MAX_UPLOAD_MB: "16" }), 16 * 1024 * 1024);
  for (const value of ["15", "2049", "16.5", "lots"]) {
    assert.throws(
      () => uploadLimitBytes({ BREADBOARD_INGEST_MAX_UPLOAD_MB: value }),
      /BREADBOARD_INGEST_MAX_UPLOAD_MB/,
    );
  }
});
