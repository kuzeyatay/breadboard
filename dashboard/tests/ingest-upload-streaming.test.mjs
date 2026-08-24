import assert from "node:assert/strict";
import fs from "node:fs";
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
