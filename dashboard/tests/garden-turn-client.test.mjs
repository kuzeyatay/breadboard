import assert from "node:assert/strict";
import test from "node:test";
import { fetchGardenChat, reserveGardenTurnCheckpoint, saveGardenChatSession } from "../src/lib/conversations/garden-turn-client.ts";

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

test("question checkpoints recover a runtime outage using the same turn identity", async (t) => {
  t.mock.method(globalThis, "setTimeout", callback => { queueMicrotask(callback); return 0; });
  const requests = [];
  const message = { role: "user", content: "Explain this equation" };
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url, init });
    if (requests.length === 1) {
      message.content = "Later draft";
      throw new TypeError("Failed to fetch");
    }
    if (requests.length === 2) return new Response("Restarting", { status: 503 });
    return Response.json({ userMessage: { id: "msg_40" }, assistantMessage: { id: "msg_41" } });
  });
  const result = await reserveGardenTurnCheckpoint(878, "same-question", message);
  assert.equal(result.assistantMessageId, "msg_41");
  assert.equal(requests.length, 3);
  assert.ok(requests.every(({ url, init }) => url === "/api/chat-sessions/878/turns" && init.method === "POST"));
  assert.equal(new Set(requests.map(r => r.init.body)).size, 1);
  assert.equal(JSON.parse(requests[2].init.body).content, "Explain this equation");
});

test("checkpoint recovery is bounded and preserves permanent rejections", async (t) => {
  t.mock.method(globalThis, "setTimeout", callback => { queueMicrotask(callback); return 0; });
  let count = 0;
  let status = 503;
  t.mock.method(globalThis, "fetch", async () => {
    count++;
    return Response.json({ error: { message: "Storage unavailable" } }, { status });
  });
  await assert.rejects(reserveGardenTurnCheckpoint(878, "unavailable", { role: "user", content: "Question" }), /Storage unavailable/);
  assert.equal(count, 3);
  status = 409;
  await assert.rejects(reserveGardenTurnCheckpoint(878, "rejected", { role: "user", content: "Question" }), /Storage unavailable/);
  assert.equal(count, 4, "a rejected edit must not be retried");
});

test("Stop during a failed checkpoint prevents recovery from submitting it again", async (t) => {
  const controller = new AbortController();
  let count = 0;
  t.mock.method(globalThis, "fetch", async () => {
    count++;
    controller.abort();
    throw new TypeError("Connection reset");
  });
  await assert.rejects(reserveGardenTurnCheckpoint(878, "stopped", { role: "user", content: "Question" }, controller.signal), { name: "AbortError" });
  assert.equal(count, 1);
});

test("chat saves recover a lost acknowledgement and a temporary storage error without dispatching again", async (t) => {
  t.mock.method(globalThis, "setTimeout", callback => { queueMicrotask(callback); return 0; });
  const requests = [];
  const snapshot = { messages: [{ id: "msg_12", role: "assistant", content: "Saved answer" }] };
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url, init });
    if (requests.length === 1) {
      snapshot.messages[0].content = "Later edit";
      throw new TypeError("Failed to fetch");
    }
    if (requests.length === 2) return Response.json({ error: "Temporarily unavailable" }, { status: 503 });
    return Response.json({ success: true });
  });
  await saveGardenChatSession(872, snapshot);
  assert.equal(requests.length, 3);
  assert.ok(requests.every(({ url, init }) => url === "/api/chat-sessions/872" && init.method === "PATCH"));
  assert.equal(new Set(requests.map(r => r.init.body)).size, 1);
  assert.equal(JSON.parse(requests[2].init.body).messages[0].content, "Saved answer");
});

test("rejected chat saves keep the server's reason and are not retried", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url, init });
    return Response.json({ error: "These messages belong to another chat. Reload this chat before saving." }, { status: 409 });
  });
  await assert.rejects(saveGardenChatSession(873, { messages: [] }), /Reload this chat before saving/);
  assert.equal(requests.length, 1);
});

test("persistent save failures stop after three attempts", async (t) => {
  t.mock.method(globalThis, "setTimeout", callback => { queueMicrotask(callback); return 0; });
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return new Response("Unavailable", { status: 502 });
  });
  await assert.rejects(saveGardenChatSession(874, { messages: [] }), /502/);
  assert.equal(requests, 3);
});

test("the next question waits for its chat's save retry while other chats remain usable", async (t) => {
  t.mock.method(globalThis, "setTimeout", callback => { queueMicrotask(callback); return 0; });
  const requests = [];
  let acknowledgeSave;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url, init });
    if (init.method === "PATCH") return new Promise(resolve => { acknowledgeSave = resolve; });
    const { clientMessageId } = JSON.parse(init.body);
    return Response.json({ userMessage: { id: "msg_20", clientMessageId }, assistantMessage: { id: "msg_21" } });
  });
  const save = saveGardenChatSession(875, { messages: [] });
  const nextTurn = reserveGardenTurnCheckpoint(875, "next-turn", { role: "user", content: "Follow-up" });
  await reserveGardenTurnCheckpoint(876, "other-turn", { role: "user", content: "Other chat" });
  assert.deepEqual(requests.map(r => r.url), ["/api/chat-sessions/875", "/api/chat-sessions/876/turns"]);
  acknowledgeSave(Response.json({ success: true }));
  await Promise.all([save, nextTurn]);
  assert.equal(requests.at(-1).url, "/api/chat-sessions/875/turns");
});

test("an exhausted save releases the next question instead of leaving the chat stuck", async (t) => {
  t.mock.method(globalThis, "setTimeout", callback => { queueMicrotask(callback); return 0; });
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (init.method === "PATCH") throw new TypeError("Failed to fetch");
    return Response.json({ userMessage: { id: "msg_30" }, assistantMessage: { id: "msg_31" } });
  });
  const save = saveGardenChatSession(877, { messages: [] });
  const nextTurn = reserveGardenTurnCheckpoint(877, "next-turn", { role: "user", content: "Follow-up" });
  await assert.rejects(save, /Could not reach chat storage/);
  assert.equal((await nextTurn).assistantMessageId, "msg_31");
});

test("slow chat startup renews only the pending checkpoint and hands off at response headers", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const requests = [];
  let acceptChat;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("answer")); controller.close(); } });
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url, init });
    if (url === "/api/chat") return await new Promise(resolve => { acceptChat = resolve; });
    return Response.json({ renewed: true });
  });
  const responsePromise = fetchGardenChat(872, "selected-text-turn", { method: "POST", body: "request" });
  await flush();
  for (let i = 0; i < 7; i++) { t.mock.timers.tick(10_000); await flush(); }
  assert.equal(requests.filter(r => r.url === "/api/chat").length, 1, "never duplicate the model dispatch");
  const heartbeats = requests.filter(r => r.init.method === "PATCH");
  assert.equal(heartbeats.length, 8, "a wait longer than the stale threshold remains owned");
  assert.ok(heartbeats.every(r => r.url === "/api/chat-sessions/872/turns" && JSON.parse(r.init.body).clientMessageId === "selected-text-turn"));
  acceptChat(new Response(stream));
  const response = await responsePromise;
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(requests.length, 9, "viewer heartbeat ends when server takes ownership");
  assert.equal(await response.text(), "answer", "handoff must not abort the answer stream");
});

test("Stop cancels the dispatch and its pending heartbeat without a late renewal", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const controller = new AbortController();
  const requests = [];
  t.mock.method(globalThis, "fetch", (url, init) => {
    requests.push({ url, init });
    return new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
  });
  const response = fetchGardenChat(872, "stopped-turn", { signal: controller.signal });
  controller.abort();
  await assert.rejects(response, { name: "AbortError" });
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(requests.length, 2);
  assert.ok(requests.every(r => r.init.signal.aborted));
});

test("heartbeat failures do not replace the actual dispatch error or leak timers", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const failure = new TypeError("Failed to fetch");
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; throw failure; });
  await assert.rejects(fetchGardenChat(872, "disconnected-turn", {}), error => error === failure);
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(requests, 2);
});

test("Stop answers at once during a slow checkpoint, seals what it committed, and holds the next turn", async (t) => {
  const requests = [];
  let landSlowSave;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push(`${init.method} ${JSON.parse(init.body).clientMessageId}`);
    if (requests.length === 1) await new Promise(resolve => { landSlowSave = resolve; });
    return Response.json({ userMessage: { id: "msg_1" }, assistantMessage: { id: "msg_2" } });
  });
  const stop = new AbortController();
  const stopped = reserveGardenTurnCheckpoint(901, "stopped-turn", { role: "user", content: "First" }, stop.signal);
  await flush();
  stop.abort();
  await assert.rejects(stopped, { name: "AbortError" }, "Stop must not wait for the save");

  const next = reserveGardenTurnCheckpoint(901, "next-turn", { role: "user", content: "Second" });
  await flush();
  assert.deepEqual(requests, ["POST stopped-turn"], "the next turn waits for the stopped one to be sealed");
  landSlowSave();
  assert.equal((await next).assistantMessageId, "msg_2");
  assert.deepEqual(requests, ["POST stopped-turn", "DELETE stopped-turn", "POST next-turn"]);
});
