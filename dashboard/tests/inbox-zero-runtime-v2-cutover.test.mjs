import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS,
  expectedRuntimeV2OuterAgentInputCount,
  validateRuntimeV2InboxZeroRequest,
  validateRuntimeV2OuterAgentRequest,
} from "../scripts/runtime-v2-outer-agent-adapters.mjs";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(relativePath) {
  return readFileSync(path.join(dashboardRoot, ...relativePath.split("/")), "utf8");
}

function validRequest(overrides = {}) {
  return {
    task: "Find the newsletters I have not read and summarize them.",
    conversationKey: "conversation:conv_abcdefghijklmnopqrstuvwx",
    runtimeChatId: "123e4567-e89b-42d3-a456-426614174000",
    preferredEmail: null,
    allowActions: false,
    chatmockBaseUrl: "http://127.0.0.1:3000",
    model: "openai/gpt-5",
    conversationPublicId: "conv_abcdefghijklmnopqrstuvwx",
    conversationContext: "User: Check the newsletters from this week.",
    ...overrides,
  };
}

test("Inbox Zero has one sealed zero-input Runtime V2 worker adapter", () => {
  assert.deepEqual(RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS["inbox-zero"], {
    id: "inbox-zero",
    workerKind: "outer-inbox-zero-node",
    jobType: "inbox-zero-run",
    scopePrefix: "oa_inbox_zero_",
    maximumInputs: 0,
  });
  assert.equal(expectedRuntimeV2OuterAgentInputCount("inbox-zero", validRequest()), 0);
  assert.equal(validateRuntimeV2OuterAgentRequest("inbox-zero", validRequest()).task, validRequest().task);
});

test("Inbox Zero Runtime request is exact, bounded, and contains no caller-selected secret", () => {
  assert.doesNotThrow(() => validateRuntimeV2InboxZeroRequest(validRequest()));
  assert.doesNotThrow(() => validateRuntimeV2InboxZeroRequest(validRequest({
    preferredEmail: "mailbox@example.com",
    conversationPublicId: null,
    conversationContext: "",
  })));
  for (const request of [
    { ...validRequest(), chatmockApiKey: "forged" },
    validRequest({ runtimeChatId: "not-a-runtime-chat-id" }),
    validRequest({ chatmockBaseUrl: "http://user:secret@127.0.0.1:3000" }),
    validRequest({ preferredEmail: "mailbox@example.com\nforged" }),
    validRequest({ conversationPublicId: "conv_wrong" }),
    validRequest({ task: "x".repeat(20_001) }),
    validRequest({ conversationContext: "x".repeat(15_001) }),
  ]) {
    assert.throws(
      () => validateRuntimeV2InboxZeroRequest(request),
      /canonical Inbox Zero Runtime request is invalid/u,
    );
  }
});

test("Inbox Zero compatibility routes only address durable Runtime authority", () => {
  const launch = source("src/app/api/inbox-zero/runs/route.ts");
  const events = source("src/app/api/inbox-zero/runs/[runId]/events/route.ts");
  const abort = source("src/app/api/inbox-zero/runs/[runId]/abort/route.ts");
  const cancellation = source("src/lib/conversations/external-agent-cancel.ts");

  assert.match(launch, /from "@\/lib\/inbox-zero\/runtime-run-manager\.ts"/u);
  assert.match(launch, /const run = await startRun\(/u);
  assert.doesNotMatch(launch, /inbox-zero\/run-manager|chatmockApiKeyValue|CHATMOCK_API_KEY/u);
  assert.match(events, /outerAgentEventsResponse/u);
  assert.match(events, /readOuterAgentRunView\("inbox-zero"/u);
  assert.doesNotMatch(events, /setInterval|inbox-zero\/run-manager/u);
  assert.match(abort, /await abortRun\(userId, runId\)/u);
  assert.match(cancellation, /inbox-zero\/runtime-run-manager\.ts/u);
});

test("Inbox Zero facade persists follow-up correlation and submits no credential", () => {
  const facade = source("src/lib/inbox-zero/runtime-run-manager.ts");
  assert.match(facade, /CREATE TABLE IF NOT EXISTS runtime_v2_inbox_zero_chats/u);
  assert.match(facade, /PRIMARY KEY \(owner_user_id, conversation_key\)/u);
  assert.match(facade, /LIMIT -1 OFFSET 1024/u);
  assert.match(facade, /const runtimeChatId = chatIdFor/u);
  assert.match(facade, /kind: "inbox-zero"/u);
  assert.doesNotMatch(facade, /chatmockApiKey|CHATMOCK_API_KEY/u);
});

test("Inbox Zero mailbox logic is worker-only and the worker injects the trusted credential", () => {
  const manager = source("src/lib/inbox-zero/run-manager.ts");
  const adapters = source("scripts/runtime-v2-outer-agent-adapters.mjs");
  const worker = source("scripts/runtime-v2-inbox-zero-worker.mjs");
  const store = source("src/lib/runtime-v2/outer-agent-run-store.ts");

  assert.match(manager, /runtimeJobId\?: string/u);
  assert.match(manager, /runtimeChatId\?: string/u);
  assert.match(manager, /export function startRuntimeWorkerRun/u);
  assert.match(manager, /getRuntimeWorkerEventsSince/u);
  assert.match(manager, /isRuntimeWorkerTerminal/u);
  assert.match(manager, /abortRuntimeWorkerRun/u);
  assert.match(adapters, /adapterId === "inbox-zero"[\s\S]*trustedSecret\("CHATMOCK_API_KEY"\)/u);
  assert.match(worker, /runRuntimeV2OuterAgentWorker\("inbox-zero"\)/u);
  assert.match(store, /\| "inbox-zero"/u);
});
