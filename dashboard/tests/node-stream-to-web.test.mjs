import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { nodeStreamToWeb } from "../src/lib/node-stream-to-web.ts";

function bigFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-stream-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "video.bin");
  const bytes = Buffer.alloc(8 * 1024 * 1024);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
  fs.writeFileSync(file, bytes);
  return { file, bytes };
}

async function cancelEarly(body) {
  const uncaught = [];
  const onError = (error) => uncaught.push(error);
  process.on("uncaughtException", onError);
  try {
    const reader = body.getReader();
    await reader.read();
    await reader.cancel();
    // Give a flowing file stream time to emit into the closed controller.
    await new Promise((resolve) => setTimeout(resolve, 200));
  } finally {
    process.off("uncaughtException", onError);
  }
  return uncaught;
}

test("a full read is byte-identical", async (t) => {
  const { file, bytes } = bigFile(t);
  const received = Buffer.from(await new Response(nodeStreamToWeb(fs.createReadStream(file))).arrayBuffer());
  assert.equal(Buffer.compare(received, bytes), 0);
});

test("a client that goes away mid-response raises nothing uncaught and frees the file", async (t) => {
  const { file } = bigFile(t);
  const stream = fs.createReadStream(file);
  assert.deepEqual(await cancelEarly(nodeStreamToWeb(stream)), []);
  assert.equal(stream.destroyed, true);
});

test("ranges and in-memory streams still work", async (t) => {
  const { file, bytes } = bigFile(t);
  const ranged = Buffer.from(await new Response(nodeStreamToWeb(fs.createReadStream(file, { start: 10, end: 19 }))).arrayBuffer());
  assert.deepEqual([...ranged], [...bytes.subarray(10, 20)]);
  const text = await new Response(nodeStreamToWeb(Readable.from(["a", "b"]))).text();
  assert.equal(text, "ab");
});

test("a read error reaches the consumer instead of crashing the process", async () => {
  const failing = new Readable({ read() { this.destroy(new Error("disk went away")); } });
  await assert.rejects(new Response(nodeStreamToWeb(failing)).arrayBuffer(), /disk went away/);
});
