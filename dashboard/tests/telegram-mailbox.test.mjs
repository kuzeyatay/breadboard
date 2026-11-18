// The per-chat mailbox in service.ts, driven for real with the agent turn
// stubbed: a burst becomes one turn, a mid-answer text steers the live run,
// and a text the run refuses is answered right after it, never dropped.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mock, test } from "node:test";

// Module mocks need a flag the shared runner does not pass; re-run this file
// with it so the real mailbox still runs under `npm test`.
if (typeof mock.module !== "function") {
  test("double texting feels like texting a person", { timeout: 60_000 }, () => {
    const run = spawnSync(process.execPath, [
      "--experimental-test-module-mocks", "--experimental-strip-types", "--test", fileURLToPath(import.meta.url),
    ], { encoding: "utf8", env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
    assert.equal(run.status, 0, run.stdout + run.stderr);
  });
} else {

const routed = [];
const steered = [];
const sent = [];
let finishTurn = () => {};

mock.module("../src/lib/telegram/instance.ts", {
  namedExports: {
    getTelegramStore: () => ({
      claimMessage: () => true,
      settings: () => ({ ownerUserId: null }),
    }),
  },
});
mock.module("../src/lib/telegram/inbound.ts", {
  namedExports: {
    routeTelegramMessage: async (message, deps) => {
      routed.push(message.body);
      if (message.body === "boom") throw new Error("module failed to load");
      deps.onTurnStarted?.({ id: 1, public_id: "conv_1", user_id: 1 });
      await new Promise((resolve) => { finishTurn = resolve; });
      return { status: "replied", reply: `answer to ${message.body}`, conversationId: "conv_1" };
    },
    steerTelegramTurn: async (_conversation, message) => {
      steered.push(message.body);
      return message.body !== "refused";
    },
    telegramTurnMedia: () => ({ files: [], imageUrls: [] }),
    deliverTelegramFollowUps: async () => {},
    deliverTelegramLateReply: async () => {},
  },
});

const { getTelegramGateway } = await import("../src/lib/telegram/gateway.ts");
const { startTelegramDrainLoop } = await import("../src/lib/telegram/service.ts");

const gateway = getTelegramGateway();
let inbox = [];
gateway.currentState = () => "connected";
gateway.drainMessages = () => { const out = inbox; inbox = []; return out; };
gateway.sendTyping = async () => {};
gateway.sendMessage = async (_chatId, text) => { sent.push(text); };

let nextId = 1;
const text = (body) => ({
  messageId: `9:${nextId}`, updateId: nextId++, chatId: "9", chatType: "private", chatTitle: "",
  senderId: "9", senderUsername: "", senderName: "Me", isGroup: false, body,
  hasMedia: false, mediaType: "", fileName: "", timestamp: 0, attachments: [],
});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, ms = 8_000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await wait(50);
  }
}

test("double texting feels like texting a person", { timeout: 30_000 }, async () => {
  startTelegramDrainLoop();

  inbox.push(text("hey"), text("can you help with my essay"));
  await until(() => routed.length === 1);
  assert.deepEqual(routed, ["hey\ncan you help with my essay"]);

  // Mid-answer: steered into the running turn, no second turn opened.
  inbox.push(text("make it short"));
  await until(() => steered.length === 1);
  await wait(2_000);
  assert.deepEqual(routed.length, 1);

  // Refused by the run: queued, then answered once the current turn ends.
  inbox.push(text("refused"));
  await until(() => steered.length === 2);
  await wait(300);
  finishTurn();
  await until(() => routed.length === 2);
  assert.equal(routed[1], "refused");
  finishTurn();
  await until(() => sent.length === 2);
  assert.deepEqual(sent, ["answer to hey\ncan you help with my essay", "answer to refused"]);

  // A turn that throws gets an apology, and the chat keeps working after it.
  inbox.push(text("boom"));
  await until(() => sent.length === 3);
  assert.match(sent[2], /could not answer that/);
  inbox.push(text("still there?"));
  await until(() => routed.length === 4);
  finishTurn();
  await until(() => sent.length === 4);
  assert.equal(sent[3], "answer to still there?");
});
}
