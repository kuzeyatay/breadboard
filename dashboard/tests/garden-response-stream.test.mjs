import assert from "node:assert/strict";
import test from "node:test";
import { gardenTurnCompletedOnServer, readGardenResponseData } from "../src/lib/hermes/garden-response-stream.ts";
import { isRecoverableAgentStreamDisconnect } from "../src/app/components/hermes/agent-stream-watchdog.ts";

const encoder = new TextEncoder();

test("a terminal frame completes an open response without waiting for transport cleanup", { timeout: 1000 }, async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode('data: {"type":"replace","text":"Finished"}\n\ndata: [DONE]\n\ndata: ignored\n\n')); },
    cancel() { cancelled = true; return new Promise(() => {}); },
  });
  assert.deepEqual(await Array.fromAsync(readGardenResponseData(body)), ['{"type":"replace","text":"Finished"}', '[DONE]']);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test("UTF-8, CRLF and the terminal marker can span arbitrary chunks, including the final buffer", async () => {
  const bytes = encoder.encode(': heartbeat\r\ndata: {"text":"café"}\r\n\r\ndata:[DONE]');
  const body = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  assert.deepEqual(await Array.fromAsync(readGardenResponseData(body)), ['{"text":"café"}', '[DONE]']);
});

test("EOF without the terminal marker is recoverable, never successful completion", async () => {
  const body = new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('data: {"text":"partial"}\n')); controller.close(); } });
  await assert.rejects(Array.fromAsync(readGardenResponseData(body)), isRecoverableAgentStreamDisconnect);
  assert.equal(body.locked, false);
});

test("durable recovery can retire a reader with a pending network read", { timeout: 1000 }, async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const controller = new AbortController();
  const reading = Array.fromAsync(readGardenResponseData(body, controller.signal));
  controller.abort();
  await assert.rejects(reading, { name: "AbortError" });
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test("a recovered viewer cannot publish buffered events after retirement", async () => {
  const controller = new AbortController();
  const body = new ReadableStream({ start(stream) { stream.enqueue(encoder.encode('data: first\ndata: stale\n')); } });
  const reader = readGardenResponseData(body, controller.signal);
  assert.equal((await reader.next()).value, "first");
  controller.abort();
  await assert.rejects(reader.next(), { name: "AbortError" });
});

test("only the matching finished turn can retire a live viewer", () => {
  const last = { role: "assistant", clientMessageId: "current", responseCompletedAt: "2026-09-07T19:55:42.301Z" };
  const session = { active: false, messages: [last] };
  assert.equal(gardenTurnCompletedOnServer(session, "current"), true);
  assert.equal(gardenTurnCompletedOnServer(session, "newer-turn"), false);
  for (const active of [true, undefined]) assert.equal(gardenTurnCompletedOnServer({ ...session, active }, "current"), true);
  for (const responseCompletedAt of [undefined, "invalid"]) assert.equal(gardenTurnCompletedOnServer({ ...session, messages: [{ ...last, responseCompletedAt }] }, "current"), false);
  assert.equal(gardenTurnCompletedOnServer({ ...session, messages: [last, { role: "user", clientMessageId: "next" }] }, "current"), false);
  assert.equal(gardenTurnCompletedOnServer({ ...session, messages: [] }, "current"), false);
  const inline = { role: "assistant", clientMessageId: "side", pending: true, textSelection: { mode: "inline" } };
  assert.equal(gardenTurnCompletedOnServer({ active: true, messages: [last, inline] }, "current"), true);
  assert.equal(gardenTurnCompletedOnServer({ active: true, messages: [last, inline, { role: "user", clientMessageId: "next" }] }, "current"), false);
});
