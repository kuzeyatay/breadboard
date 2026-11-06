import assert from "node:assert/strict";
import test from "node:test";
import { distillGardenDocumentSkill } from "../src/lib/document-skills/client.ts";
import { createDocumentSkillProgressStream } from "../src/lib/document-skills/progress-stream.ts";

const done = { type: "done", cached: true, skill: { slug: "lecture-skill" } };
const ndjson = (text) => new Response(text, { headers: { "Content-Type": "application/x-ndjson" } });
const result = { record: { slug: "lecture-skill", title: "Lecture", status: "ready", chapterCount: 2, sourceTokens: 11000 }, cached: false, warnings: [] };
const selected = (options) => distillGardenDocumentSkill("em-1", "lecture-1", "lecture.pdf", options);
const decode = (value) => JSON.parse(new TextDecoder().decode(value).trim());

function mockFetch(t, fetch) {
  const original = globalThis.fetch;
  globalThis.fetch = fetch;
  t.after(() => { globalThis.fetch = original; });
}

test("a selected PDF reconnects after its progress stream drops and uses the cached result", async (t) => {
  const requests = [];
  const statuses = [];
  mockFetch(t, async (_url, init) => {
    requests.push(JSON.parse(init.body));
    if (requests.length === 1) {
      let sent = false;
      return ndjson(new ReadableStream({ pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(new TextEncoder().encode('{"type":"progress","phase":"chapters","completed":1,"total":2}\n'));
        } else controller.error(new TypeError("network error"));
      } }));
    }
    return ndjson(`${JSON.stringify(done)}\n`);
  });
  assert.deepEqual(await selected({ onStatus: (status) => statuses.push(status) }), {
    slug: "lecture-skill", skipped: false, error: null,
  });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(requests[0].documentSlug, "lecture-1");
  assert.ok(statuses.some((status) => status.startsWith("Reconnecting")));
});

test("a clean EOF without completion reconnects instead of claiming success", async (t) => {
  let calls = 0;
  mockFetch(t, async () => ++calls === 1 ? ndjson('{"type":"heartbeat"}\n') : ndjson(JSON.stringify(done)));
  assert.equal((await selected()).slug, "lecture-skill");
  assert.equal(calls, 2);
});

test("completion is accepted before a connection closes and releases the reader", async (t) => {
  let canceled = false;
  mockFetch(t, async () => ndjson(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(`${JSON.stringify(done)}\n`)); },
    cancel() { canceled = true; },
  })));
  assert.equal((await selected()).slug, "lecture-skill");
  assert.equal(canceled, true);
});

test("connection attempts are bounded and the final message explains that the document remains available", async (t) => {
  let calls = 0;
  mockFetch(t, async () => { calls++; throw new TypeError("network error"); });
  const response = await selected();
  assert.equal(calls, 3);
  assert.equal(response.slug, null);
  assert.match(response.error, /document is still available/);
  assert.match(response.error, /select it again/);
});

test("an explicit build failure is reported without retrying expensive work", async (t) => {
  let calls = 0;
  mockFetch(t, async () => {
    calls++;
    return ndjson('{"type":"error","error":"Reader unavailable"}\n');
  });
  assert.equal((await selected()).error, "Reader unavailable");
  assert.equal(calls, 1);
});

test("cancel during reconnection stops without another request or failure toast", async (t) => {
  const controller = new AbortController();
  let calls = 0;
  mockFetch(t, async () => { calls++; throw new TypeError("network error"); });
  assert.deepEqual(await selected({ signal: controller.signal, onStatus: () => controller.abort() }), {
    slug: null, skipped: true, error: null,
  });
  assert.equal(calls, 1);
});

test("a temporary gateway failure can reconnect but authentication errors remain visible", async (t) => {
  let calls = 0;
  mockFetch(t, async () => ++calls === 1 ? new Response(null, { status: 503 }) : Response.json({ skipped: true }));
  assert.equal((await selected()).skipped, true);
  assert.equal(calls, 2);
  calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ error: "Sign in required" }, { status: 401 }); };
  assert.equal((await selected()).error, "Sign in required");
  assert.equal(calls, 1);
});

test("a quiet document build sends immediate and periodic keepalives before completion", async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const reader = createDocumentSkillProgressStream(() => pending, 5).getReader();
  assert.equal(decode((await reader.read()).value).type, "heartbeat");
  assert.equal(decode((await reader.read()).value).type, "heartbeat");
  finish(result);
  assert.equal(decode((await reader.read()).value).type, "done");
  assert.equal((await reader.read()).done, true);
  reader.releaseLock();
});

test("closing the viewer does not abort the build or write to a closed stream", async () => {
  let finish;
  let report;
  const pending = new Promise((resolve) => { finish = resolve; });
  const reader = createDocumentSkillProgressStream((progress) => { report = progress; return pending; }, 5).getReader();
  await reader.read();
  await reader.cancel();
  report({ phase: "chapters", completed: 1, total: 2, message: "Reading" });
  finish(result);
  await pending;
  assert.equal((await reader.read()).done, true);
  reader.releaseLock();
});
