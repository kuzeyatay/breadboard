import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveSmallTalkReply,
  smallTalkEventStream,
} from "../src/lib/chat-small-talk.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const source = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("non-greeting small-talk turns still use the fast path", () => {
  for (const [message, intent] of [
    ["How's it going?", "wellbeing"],
    ["Thank you very much!", "gratitude"],
    ["See you later", "farewell"],
  ]) {
    assert.equal(resolveSmallTalkReply(message)?.intent, intent, message);
  }
});

test("greetings do not produce the canned automatic reply", () => {
  for (const message of [
    "Hi!",
    "hello there",
    "Good morning, Bread",
    "hey assistant",
  ]) {
    assert.equal(resolveSmallTalkReply(message), null, message);
  }
});

test("small-talk detection fails closed when the turn also contains a task", () => {
  for (const message of [
    "hi, summarize chapter 2",
    "thanks, now explain Maxwell's equations",
    "good morning, search the web for today's news",
    "what's up with Ampere's law?",
    "hey /image draw a field",
    "are you there and can you edit this page",
  ]) {
    assert.equal(resolveSmallTalkReply(message), null, message);
  }
});

test("the fast path returns Garden SSE with honest zero-cost usage and no thinking", async () => {
  const reply = resolveSmallTalkReply("how are you?");
  assert.ok(reply);
  const response = smallTalkEventStream(reply);
  const body = await response.text();

  assert.equal(response.headers.get("X-Breadboard-AI-Backend"), "breadboard-fast-path");
  assert.match(body, /"type":"runtime"/);
  assert.match(body, /"type":"sources","sources":\[\]/);
  assert.match(body, /"type":"delta"/);
  assert.match(body, /data: \[DONE\]/);
  assert.doesNotMatch(body, /"type":"thinking"/);
  const usageEvent = body
    .split("\n\n")
    .map((line) => line.replace(/^data: /, ""))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .find((event) => event?.type === "usage");
  assert.deepEqual(usageEvent?.usage, {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    scope: "turn",
    apiCalls: 0,
    contextUsedTokens: 0,
  });
});

test("both Garden backends gate small talk before retrieval and runtime planning", () => {
  const adapter = source("src/lib/hermes/garden-chat-adapter.ts");
  const adapterGate = adapter.indexOf("const smallTalkReply =");
  assert.ok(adapterGate > 0);
  assert.ok(adapterGate < adapter.indexOf("prepareTurn({"));
  assert.ok(adapterGate < adapter.indexOf("loadConversationMemoryBundleHybrid({"));
  assert.ok(adapterGate < adapter.indexOf("prepareDocumentContext({"));
  assert.match(
    adapter.slice(adapterGate, adapter.indexOf("const engine =", adapterGate)),
    /attachments\.length === 0 && !conversation\.active_agency_agent_slug/,
  );

  const legacy = source("src/app/api/chat/route.ts");
  const legacyGate = legacy.indexOf("const smallTalkReply =");
  assert.ok(legacyGate > 0);
  assert.ok(legacyGate < legacy.indexOf("scanClusterKnowledge("));
  assert.ok(legacyGate < legacy.indexOf("retrieveGraphRag({"));
  assert.match(
    legacy.slice(legacyGate, legacy.indexOf("const contentPath", legacyGate)),
    /chatAttachments\.length === 0/,
  );
});
