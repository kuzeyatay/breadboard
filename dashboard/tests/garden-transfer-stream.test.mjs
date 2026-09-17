import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { createInflateRaw } from "node:zlib";
import test, { after } from "node:test";
import AdmZip from "adm-zip";
import { StreamingArchive } from "../src/lib/garden-transfer/stream-archive.ts";
import { packDirectory, createBudget } from "../src/lib/garden-transfer/archive.ts";
import { gardenExportSkipReason } from "../src/lib/garden-transfer/format.ts";
import { transferDownloadResponse } from "../src/lib/garden-transfer/response.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-stream-export-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

test("a file over 512 MiB exports and decompresses intact through bounded reads", async () => {
  const filename = path.join(root, "large.bin");
  const size = 513 * 1024 * 1024;
  const tail = Buffer.from("garden-export-end");
  const fd = fs.openSync(filename, "w");
  fs.ftruncateSync(fd, size);
  fs.writeSync(fd, tail, 0, tail.length, size - tail.length);
  fs.closeSync(fd);

  const writer = new StreamingArchive();
  const summary = packDirectory(writer, root, "content/", createBudget(), gardenExportSkipReason);
  assert.equal(summary.bytes, size);
  assert.equal(summary.files, 1);
  const zip = new AdmZip(await buffer(writer.stream()));
  const entry = zip.getEntry("content/large.bin");
  assert.equal(entry.header.size, size);
  let readBytes = 0;
  let last;
  for await (const chunk of Readable.from([entry.getCompressedData()]).pipe(createInflateRaw())) {
    readBytes += chunk.length;
    last = chunk;
  }
  assert.equal(readBytes, size);
  assert.deepEqual(last.subarray(-tail.length), tail);
});

test("HEAD validates export metadata without opening or reading its sources", async () => {
  const writer = new StreamingArchive();
  writer.addSourceFile("content/missing.bin", path.join(root, "missing.bin"), 100);
  const stream = writer.stream();
  const response = transferDownloadResponse({ stream, filename: "em1.garden", mimeType: "application/zip", summary: {} }, true);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("Content-Length"), null);
  assert.equal(stream.destroyed, true);
});

test("a source disappearing after planning fails the stream", async () => {
  const writer = new StreamingArchive();
  writer.addSourceFile("content/missing.bin", path.join(root, "missing.bin"), 100);
  await assert.rejects(buffer(writer.stream()), /ENOENT/);
});

test("cancelling the HTTP body stops the archive and leaves later files unopened", async () => {
  const writer = new StreamingArchive();
  writer.addSourceFile("content/large.bin", path.join(root, "large.bin"), 513 * 1024 * 1024);
  writer.addSourceFile("content/missing.bin", path.join(root, "missing.bin"), 100);
  const stream = writer.stream();
  const response = transferDownloadResponse({ stream, filename: "em1.garden", mimeType: "application/zip", summary: {} });
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel();
  assert.equal(stream.destroyed, true);
});
