// The Telegram long-poll loop, driven against a stand-in Bot API on loopback.
//
// Everything else about Telegram is asserted on source or on a store; this is the
// one place the actual connection runs: it polls, queues, acknowledges, sends,
// and stops.

import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { TelegramGateway } from "../src/lib/telegram/gateway.ts";

const TOKEN = "1234567890:AAdummy-token-for-tests-0123456789abcd";

/**
 * A Bot API stand-in. `plan` decides what each `getUpdates` call answers;
 * `options.deleteWebhookStatus` fails the pre-flight call instead.
 */
async function startFakeTelegram(plan, options = {}) {
  const sent = [];
  let updateCalls = 0;

  const server = http.createServer((request, response) => {
    const method = request.url.split("/").pop();
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = body ? JSON.parse(body) : {};
      const reply = (status, json) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(json));
      };

      if (method === "deleteWebhook") {
        return options.deleteWebhookStatus
          ? reply(options.deleteWebhookStatus, {
              ok: false,
              error_code: options.deleteWebhookStatus,
              description: "Unauthorized",
            })
          : reply(200, { ok: true, result: true });
      }
      if (method === "sendChatAction") return reply(200, { ok: true, result: true });
      if (method === "sendMessage") {
        sent.push(payload);
        return reply(200, { ok: true, result: { message_id: sent.length } });
      }
      if (method === "getUpdates") {
        const answer = plan(updateCalls++, payload);
        if (answer.status && answer.status !== 200) {
          return reply(answer.status, {
            ok: false,
            error_code: answer.status,
            description: answer.description ?? "nope",
          });
        }
        // Keep the loop from spinning once the plan runs dry.
        return setTimeout(() => reply(200, { ok: true, result: answer.result ?? [] }), answer.delayMs ?? 0);
      }
      return reply(404, { ok: false, description: `unexpected ${method}` });
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.BREADBOARD_TELEGRAM_API_BASE = base;
  return {
    sent,
    updateCalls: () => updateCalls,
    lastOffsetAsked: () => lastOffset,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

let lastOffset = null;

async function waitFor(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

test("the loop polls, queues, acknowledges, sends, and stops", async (t) => {
  const message = {
    update_id: 41,
    message: {
      message_id: 5,
      date: 1_800_000_000,
      text: "are you there?",
      from: { id: 123456789, username: "kuzey", first_name: "Kuzey" },
      chat: { id: 123456789, type: "private" },
    },
  };

  const fake = await startFakeTelegram((call, payload) => {
    lastOffset = payload.offset ?? null;
    if (call === 0) return { result: [message] };
    return { result: [], delayMs: 50 };
  });
  t.after(async () => {
    await fake.close();
    delete process.env.BREADBOARD_TELEGRAM_API_BASE;
  });

  const gateway = new TelegramGateway();
  const offsets = [];
  await gateway.start({ token: TOKEN, offset: 0, onOffset: (next) => offsets.push(next) });

  assert.ok(await waitFor(() => gateway.currentState() === "connected"), "never connected");
  assert.ok(await waitFor(() => gateway.snapshot().offset === 42), "offset never advanced");
  // The offset is handed out as it advances, not held until shutdown.
  assert.deepEqual(offsets, [42]);
  // And it is what the next poll acknowledges, so Telegram stops replaying.
  assert.ok(await waitFor(() => lastOffset === 42), "the next poll did not acknowledge");

  const drained = gateway.drainMessages();
  assert.equal(drained.length, 1);
  assert.equal(drained[0].body, "are you there?");
  assert.equal(drained[0].messageId, "123456789:5");
  // Draining is destructive: the same message must not be handled twice.
  assert.deepEqual(gateway.drainMessages(), []);

  await gateway.sendMessage("123456789", "yes");
  assert.equal(fake.sent.length, 1);
  assert.equal(fake.sent[0].chat_id, "123456789");
  assert.equal(fake.sent[0].text, "yes");
  // Plain text on purpose: Telegram rejects the Markdown an agent tends to write.
  assert.equal(fake.sent[0].parse_mode, undefined);

  const stoppedAt = Date.now();
  await gateway.stop();
  assert.equal(gateway.currentState(), "disconnected");
  // Stopping must not wait out a 25-second long poll.
  assert.ok(Date.now() - stoppedAt < 2_000, "stop waited on the in-flight poll");

  const callsAtStop = fake.updateCalls();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(fake.updateCalls(), callsAtStop, "the loop kept polling after stop");
});

test("a stolen update stream stops the loop instead of hammering Telegram", async (t) => {
  const fake = await startFakeTelegram(() => ({
    status: 409,
    description: "Conflict: terminated by other getUpdates request",
  }));
  t.after(async () => {
    await fake.close();
    delete process.env.BREADBOARD_TELEGRAM_API_BASE;
  });

  const gateway = new TelegramGateway();
  await gateway.start({ token: TOKEN, offset: 0 });

  assert.ok(await waitFor(() => gateway.currentState() === "error"), "never reported the conflict");
  assert.match(gateway.snapshot().error, /Another program/);
  assert.equal(gateway.isRunning(), false);

  const callsAtGiveUp = fake.updateCalls();
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(fake.updateCalls(), callsAtGiveUp, "kept retrying a hopeless poll");
  await gateway.stop();
});

test("a token rejected mid-poll stops the loop instead of retrying forever", async (t) => {
  const fake = await startFakeTelegram(() => ({ status: 401, description: "Unauthorized" }));
  t.after(async () => {
    await fake.close();
    delete process.env.BREADBOARD_TELEGRAM_API_BASE;
  });

  const gateway = new TelegramGateway();
  await gateway.start({ token: TOKEN, offset: 0 });
  assert.ok(await waitFor(() => gateway.currentState() === "error"), "never reported the token");
  assert.match(gateway.snapshot().error, /rejected the bot token/);
  assert.equal(gateway.isRunning(), false);

  const callsAtGiveUp = fake.updateCalls();
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(fake.updateCalls(), callsAtGiveUp, "kept retrying a rejected token");
  await gateway.stop();
});

test("a token rejected up front fails the connect itself", async (t) => {
  // deleteWebhook runs before the first poll, so a bad token is known before any
  // loop starts — the Connect button has to report that, not spin.
  const fake = await startFakeTelegram(() => ({ result: [] }), { deleteWebhookStatus: 401 });
  t.after(async () => {
    await fake.close();
    delete process.env.BREADBOARD_TELEGRAM_API_BASE;
  });

  const gateway = new TelegramGateway();
  await assert.rejects(() => gateway.start({ token: TOKEN, offset: 0 }), /Unauthorized/);
  assert.equal(gateway.currentState(), "error");
  assert.match(gateway.snapshot().error, /rejected the bot token/);
  assert.equal(gateway.isRunning(), false);
  assert.equal(fake.updateCalls(), 0, "polled anyway after a rejected token");
});
