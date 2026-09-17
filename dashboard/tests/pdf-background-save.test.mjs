import assert from "node:assert/strict";
import test from "node:test";
import { PdfSaveQueue, PdfSaveSession } from "../src/lib/pdf-save-client.ts";

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const ok = () => new Response("{}", { status: 200 });
const document = () => ({
  value: 0,
  get annotationStorage() { return { serializable: { hash: String(this.value) } }; },
  async saveDocument() { return new Uint8Array([this.value]); },
});

test("leaving during serialization keeps the save alive through upload", async () => {
  const capture = deferred(), upload = deferred();
  const bodies = [];
  const queue = new PdfSaveQueue("/pdf", "Paper", async (_url, init) => {
    bodies.push([...new Uint8Array(init.body)]);
    return upload.promise;
  });
  const unsubscribe = queue.subscribe(() => {});
  const saving = queue.enqueue(() => capture.promise);
  let destroyed = false;
  const release = queue.whenIdle().then(() => { destroyed = true; });
  unsubscribe(); // viewer unmounts before the worker has produced the bytes
  await tick();
  assert.equal(destroyed, false);
  capture.resolve(new Uint8Array([1, 2, 3]));
  await tick();
  assert.deepEqual(bodies, [[1, 2, 3]]);
  assert.equal(destroyed, false);
  upload.resolve(ok());
  assert.equal(await saving, true);
  await release;
  assert.equal(destroyed, true);
});

test("final edits made during an upload are saved in order after leaving", async () => {
  const upload = deferred(), bodies = [];
  const queue = new PdfSaveQueue("/pdf", "Paper", async (_url, init) => {
    bodies.push([...new Uint8Array(init.body)]);
    return bodies.length === 1 ? upload.promise : ok();
  });
  const pdf = document(), session = new PdfSaveSession(pdf, queue);
  pdf.value = 1;
  const saving = session.save();
  await tick();
  pdf.value = 2;
  void session.save(); // final capture during teardown, without waiting on upload
  pdf.value = 3; // queued bytes must already be a snapshot
  const pending = await queue.pendingBytes();
  assert.deepEqual([...pending], [2]);
  pending[0] = 99; // reopening/worker transfer cannot mutate the upload
  upload.resolve(ok());
  assert.equal(await saving, true);
  assert.deepEqual(bodies, [[1], [2]]);
});

test("busy Garden retries survive viewer unsubscribe and retain newer edits", async () => {
  const bodies = [];
  const queue = new PdfSaveQueue("/pdf", "Paper", async (_url, init) => {
    bodies.push([...new Uint8Array(init.body)]);
    return bodies.length === 1
      ? Response.json({ code: "GARDEN_MUTATION_BUSY", retryable: true, retryAfterMs: 10 }, { status: 409 })
      : ok();
  });
  const unsubscribe = queue.subscribe(() => {});
  const saving = queue.enqueue(async () => new Uint8Array([1]));
  void queue.enqueue(async () => new Uint8Array([2]));
  unsubscribe();
  assert.equal(await saving, true);
  assert.deepEqual(bodies, [[1], [1], [2]]);
  assert.equal(queue.snapshot.state, "saved");
});

test("failed uploads retain bytes and can be retried from outside the PDF", async () => {
  let offline = true;
  const bodies = [];
  const queue = new PdfSaveQueue("/pdf", "Paper", async (_url, init) => {
    bodies.push([...new Uint8Array(init.body)]);
    if (offline) throw new Error("Offline");
    return ok();
  });
  assert.equal(await queue.enqueue(async () => new Uint8Array([7])), false);
  assert.equal(queue.snapshot.state, "error");
  assert.deepEqual([...(await queue.pendingBytes())], [7]);
  let released = false;
  const release = queue.whenIdle().then(() => { released = true; });
  await tick();
  assert.equal(released, false);
  offline = false;
  assert.equal(await queue.flush(), true);
  await release;
  assert.deepEqual(bodies, [[7], [7]]);
  assert.equal(queue.pendingBytes(), null);
});

test("a worker serialization failure can retry without destroying the document", async () => {
  let attempts = 0;
  const queue = new PdfSaveQueue("/pdf", "Paper", async () => ok());
  assert.equal(await queue.enqueue(async () => {
    if (++attempts === 1) throw new Error("Serialization failed");
    return new Uint8Array([8]);
  }), false);
  assert.equal(await queue.flush(), true);
  assert.equal(attempts, 2);
});

test("unchanged pointer events do not save; edits and undo on the same ID do", async () => {
  const bodies = [];
  const queue = new PdfSaveQueue("/pdf", "Paper", async (_url, init) => {
    bodies.push([...new Uint8Array(init.body)]);
    return ok();
  });
  const pdf = document(), session = new PdfSaveSession(pdf, queue);
  await session.save();
  assert.deepEqual(bodies, []);
  for (const value of [1, 1, 2, 0, 0]) { pdf.value = value; await session.save(); }
  assert.deepEqual(bodies, [[1], [2], [0]]);
});

test("independent PDFs do not wait for another document's upload", async () => {
  const held = deferred();
  const first = new PdfSaveQueue("/a", "A", () => held.promise);
  const second = new PdfSaveQueue("/b", "B", async () => ok());
  const saving = first.enqueue(async () => new Uint8Array([1]));
  assert.equal(await second.enqueue(async () => new Uint8Array([2])), true);
  assert.equal(first.snapshot.state, "saving");
  held.resolve(ok());
  await saving;
});
