import test from "node:test";
import assert from "node:assert/strict";
import { parseSseStream } from "../src/lib/hermes/sse.ts";

async function* bytes(chunks) {
  const encoder = new TextEncoder();
  for (const chunk of chunks) yield encoder.encode(chunk);
}

test("parses complete SSE frames", async () => {
  const events = [];
  for await (const e of parseSseStream(bytes([
    'data: {"type":"a","properties":{"x":1}}\n\n',
    'data: {"type":"b"}\n\n',
  ]))) {
    events.push(e);
  }
  assert.equal(events.length, 2);
  assert.equal(events[0].type, "a");
  assert.equal(events[1].type, "b");
});

test("handles frames split across chunks", async () => {
  const events = [];
  for await (const e of parseSseStream(bytes(['data: {"ty', 'pe":"split"}\n', "\n"]))) {
    events.push(e);
  }
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "split");
});

test("ignores [DONE] and malformed payloads", async () => {
  const events = [];
  for await (const e of parseSseStream(bytes(["data: [DONE]\n\n", "data: not json\n\n", 'data: {"type":"ok"}\n\n']))) {
    events.push(e);
  }
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "ok");
});
