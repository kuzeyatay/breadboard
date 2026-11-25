import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileContentResponse } from "../src/lib/file-content-response.ts";

test("large file previews serve only the requested bytes and preserve the caller's response policy", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-range-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "document.pdf");
  const size = 4 * 1024 * 1024;
  fs.writeFileSync(file, Buffer.alloc(size, 42));
  const headers = { "Content-Type": "application/pdf", "Cache-Control": "private, no-store", ETag: '"v1"' };
  const open = (options, length = size) => fileContentResponse(
    new Request("http://localhost/preview", options), file, length, headers,
  );
  const read = t.mock.method(fs, "createReadStream");
  const slice = open({ headers: { Range: "bytes=-65536" } });
  assert.equal(slice.status, 206);
  assert.equal(slice.headers.get("cache-control"), "private, no-store");
  assert.equal(slice.headers.get("content-range"), `bytes ${size - 65536}-${size - 1}/${size}`);
  assert.equal(slice.headers.get("content-length"), "65536");
  assert.equal(read.mock.calls[0].arguments[1].start, size - 65536);
  assert.equal((await slice.arrayBuffer()).byteLength, 65536);

  const unchanged = open({ headers: { "If-None-Match": '"v1"' } });
  assert.equal(unchanged.status, 304);
  assert.equal(open({ headers: { Range: `bytes=${size}-` } }).status, 416);
  assert.equal(open({ method: "HEAD" }).body, null);
  assert.equal(open({}, 0).body, null);
  assert.equal(read.mock.callCount(), 1, "bodyless responses never open the file");

  const whole = open({ headers: { Range: "bytes=1-9", "If-Range": '"old"' } });
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get("content-length"), String(size));
  const stream = read.mock.calls[1].result;
  const closed = new Promise(resolve => stream.once("close", resolve));
  await whole.body.cancel();
  await closed;
  assert.equal(stream.destroyed, true);
});
