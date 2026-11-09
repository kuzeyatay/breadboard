// Full integration: real SQLite, turn service, Hermes server/AIAgent, plugin
// HTTP callback, auth, mailbox and detached event pump. Only inference is a
// deterministic OpenAI-compatible fixture by default; no production module is
// mocked. Set BREADBOARD_TEST_MODEL_BASE_URL to exercise a real model instead.
// Run from dashboard: node --experimental-strip-types scripts/chat-coordination-smoke.mjs
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scratch = fs.mkdtempSync(path.join(root, ".tmp-chat-coordination-"));
const token = crypto.randomUUID();
const toolSecret = crypto.randomUUID();
const nonce = `answer-${crypto.randomUUID()}`;
const liveModelBase = process.env.BREADBOARD_TEST_MODEL_BASE_URL;
const model = process.env.BREADBOARD_TEST_MODEL || "gpt-6.1-sol";
let route;
let child;
let recoveryChild;
let db;
const toolRequests = [];
const toolResponses = [];
const modelCalls = [];
const logs = [];
let releaseBusy;
const busyGate = new Promise(resolve => { releaseBusy = resolve; });
let markBusyReady;
const busyReady = new Promise(resolve => { markBusyReady = resolve; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = http.createServer(async (req, res) => {
  try {
    let body = "";
    for await (const part of req) body += part;
    if (req.url === "/api/hermes/tools/chat-coordination") {
      toolRequests.push(JSON.parse(body).tool);
      const response = await route.POST(new Request(`http://127.0.0.1${req.url}`, {
        method: "POST", headers: req.headers, body,
      }));
      const responseText = await response.text();
      const payload = JSON.parse(responseText);
      toolResponses.push(payload);
      if (payload.data?.timedOut === true) releaseBusy();
      res.writeHead(response.status, { "Content-Type": "application/json" });
      res.end(responseText);
      return;
    }
    if (req.url?.includes("/settings/")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ chatModel: model, servingModel: model }));
      return;
    }
    if (req.url?.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "gpt-6.1-sol", object: "model", owned_by: "smoke-fixture" }] }));
      return;
    }
    if (!req.url?.endsWith("/chat/completions")) { res.writeHead(404); res.end("{}"); return; }
    const request = JSON.parse(body);
    const messages = request.messages ?? [];
    const lastUserIndex = messages.findLastIndex(m => m.role === "user");
    const lastUser = JSON.stringify(messages[lastUserIndex]?.content ?? "");
    const turn = messages.slice(lastUserIndex + 1);
    const available = (request.tools ?? []).map(t => t.function?.name);
    const toolResults = turn.filter(m => m.role === "tool").map(m => {
      try { return JSON.parse(m.content); } catch { return {}; }
    });
    let content = "Acknowledged.";
    let call;
    if (lastUser.includes("BUSY_RECEIVER")) {
      markBusyReady();
      await busyGate;
      content = "The earlier turn has finished.";
    } else if (lastUser.includes("Message from chat")) {
      // This value is present only in the receiving chat's earlier history.
      assert.ok(JSON.stringify(messages).includes(nonce), "Receiver lost its own history");
      content = `The saved answer is ${nonce}.`;
    } else if (lastUser.includes("COORDINATION_")) {
      const phase = lastUser.includes("COORDINATION_BUSY") ? "busy" : lastUser.includes("COORDINATION_RESTORED") ? "restored" : "roundtrip";
      const answer = toolResults.find(item => item.status === "complete" && item.answer);
      const receipt = toolResults.find(item => item.messageId);
      const list = toolResults.find(item => item.chats);
      if (answer) content = `Chat two answered: ${answer.answer}`;
      else if (receipt) call = ["chat_wait", { message_id: receipt.messageId,
        timeout_ms: phase === "busy" && !toolResults.some(item => item.timedOut === true) ? 0 : 30000 }];
      else if (list) {
        const target = list.chats.find(chat => chat.title === "Coordination receiver");
        assert.ok(target, "Receiver not discoverable");
        call = ["chat_send_message", { chat_id: target.chatId, message: "What is the saved answer in your history?", request_id: `${phase}-1` }];
      } else call = ["chat_list", { query: "Coordination receiver" }];
      if (call) assert.ok(available.includes(call[0]), `Agent did not receive ${call[0]}`);
    }
    const tool_calls = call ? [{ id: `call_${crypto.randomUUID()}`, type: "function", function: { name: call[0], arguments: JSON.stringify(call[1]) } }] : undefined;
    modelCalls.push({ kind: lastUser.includes("Message from chat") ? "receiver" : lastUser.includes("COORDINATION_") ? "sender" : "seed", tool: call?.[0] ?? null });
    const message = { role: "assistant", content: call ? null : content, ...(tool_calls ? { tool_calls } : {}) };
    if (request.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const delta = { ...message, ...(tool_calls ? { tool_calls: tool_calls.map((c, index) => ({ ...c, index })) } : {}) };
      res.write(`data: ${JSON.stringify({ id: "smoke", object: "chat.completion.chunk", model: request.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: "smoke", object: "chat.completion.chunk", model: request.model, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })}\n\n`);
      res.end("data: [DONE]\n\n");
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "smoke", object: "chat.completion", model: request.model, choices: [{ index: 0, message, finish_reason: call ? "tool_calls" : "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }));
    }
  } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); logs.push(error.stack); }
});

try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const modelBase = liveModelBase || `${base}/v1`;
  const portServer = http.createServer();
  await new Promise(resolve => portServer.listen(0, "127.0.0.1", resolve));
  const port = portServer.address().port;
  await new Promise(resolve => portServer.close(resolve));
  Object.assign(process.env, {
    BREADBOARD_DATA_DIR: path.join(scratch, "data"), BREADBOARD_REPO_ROOT: root,
    HERMES_ROOT: path.join(scratch, "workspaces"), HERMES_BASE_URL: `http://127.0.0.1:${port}`,
    HERMES_DASHBOARD_SESSION_TOKEN: token, BREADBOARD_INTERNAL_URL: base,
    BREADBOARD_HERMES_TOOL_SECRET: toolSecret, CHATMOCK_BASE_URL: modelBase,
    NEXTAUTH_SECRET: crypto.randomUUID(), HERMES_FIRST_PARTY_SKILLS_ROOT: path.join(scratch, "skills"),
  });
  const home = path.join(scratch, "hermes-home");
  fs.mkdirSync(home, { recursive: true });
  if (process.env.BREADBOARD_TEST_PLUGIN_DIR) {
    fs.cpSync(process.env.BREADBOARD_TEST_PLUGIN_DIR, path.join(home, "plugins/breadboard"), { recursive: true });
  }
  fs.mkdirSync(path.join(scratch, "skills"));
  fs.writeFileSync(path.join(home, "config.yaml"), [
    "model:", `  default: ${model}`, "  provider: custom", `  base_url: ${modelBase}`, "  context_length: 256000",
    "plugins:", "  enabled: [breadboard]",
    "toolsets: [breadboard]", "auxiliary:", "  title_generation:", "    enabled: false",
    "memory:", "  memory_enabled: false", "  user_profile_enabled: false",
    "tools:", "  tool_search:", "    enabled: on", "    always_visible: [chat_list, chat_send_message, chat_wait]", "",
  ].join("\n"));
  const python = process.env.BREADBOARD_TEST_PYTHON || path.join(root, "desktop/build-resources/runtimes/python/python.exe");
  child = spawn(python, [path.join(root, "hermes-agent/breadboard_runtime.py"), "serve", "--isolated", "--host", "127.0.0.1", "--port", String(port), "--no-open"], {
    cwd: path.join(root, "hermes-agent"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, HERMES_HOME: home, HERMES_DESKTOP: "1", HERMES_SERVE_HEADLESS: "1", OPENAI_BASE_URL: modelBase, OPENAI_API_KEY: process.env.BREADBOARD_TEST_MODEL_API_KEY || "local-smoke-fixture" },
  });
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { logs.push(String(chunk)); });
  const deadline = Date.now() + 120000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`Hermes exited: ${child.exitCode}`);
    try { if ((await fetch(`${process.env.HERMES_BASE_URL}/api/status`, { signal: AbortSignal.timeout(1000) })).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error("Hermes startup timed out");
    await pause(250);
  }
  console.log("Hermes ready; importing the actual Breadboard turn pipeline.");
  await import("./learn-worker-import-hook.mjs");
  ({ default: db } = await import("../src/lib/db.ts"));
  route = await import("../src/app/api/hermes/tools/chat-coordination/route.ts");
  const { createConversation, listConversationMessages, renameConversation } = await import("../src/lib/conversations/store.ts");
  const { startConversationTurn } = await import("../src/lib/conversations/turn-service.ts");
  const { waitForSessionEventPump } = await import("../src/lib/hermes/event-stream.ts");
  const { coordinationStore } = await import("../src/lib/conversations/coordination.ts");
  db.prepare("INSERT INTO users(username,email,password_hash) VALUES ('coordination-smoke','coordination@example.invalid','unused')").run();
  const receiver = createConversation({ userId: 1, title: "Coordination receiver" });
  const sender = createConversation({ userId: 1, title: "Coordination sender" });
  const sendTurn = async (conversation, clientMessageId, text) => {
    const result = await startConversationTurn({ conversation, clientMessageId, text, surface: "dashboard_terminal", model, personalize: false });
    assert.equal(result.accepted, true, JSON.stringify(result));
    await Promise.race([waitForSessionEventPump(result.session), pause(liveModelBase ? 300000 : 120000).then(() => { throw new Error("Turn timed out"); })]);
    const answer = listConversationMessages(conversation.id).find(m => m.client_message_id === clientMessageId && m.role === "assistant");
    assert.equal(answer?.status, "complete", JSON.stringify(answer));
    return answer;
  };
  console.log("Seeding receiver-only context in a live agent session.");
  await sendTurn(receiver, "seed-context", `Context for this chat: the saved answer is ${nonce}. No tools needed. Just acknowledge.`);
  renameConversation(receiver, "Coordination receiver");
  console.log("Asking the sender agent to discover, message and wait for the other chat.");
  const requestText = "Ask the Coordination receiver chat for its saved answer and report it here. Use chat_list to find it, chat_send_message to ask it, and chat_wait to receive its actual answer. If the wait times out, wait again for that same message.";
  const final = await sendTurn(sender, "ask-receiver", `COORDINATION_ROUNDTRIP: ${requestText}`);
  assert.ok(final.content.includes(nonce), `Sender never received receiver's answer: ${final.content}`);
  for (const tool of ["chat_list", "chat_send_message", "chat_wait"]) assert.ok(toolRequests.includes(tool), `Agent did not use ${tool}`);
  const envelopes = db.prepare("SELECT * FROM chat_agent_messages").all();
  assert.equal(envelopes.length, 1);
  assert.equal(coordinationStore().receipt(1, sender.id, envelopes[0].id).status, "complete");
  const receiverMessages = listConversationMessages(receiver.id);
  assert.ok(receiverMessages.some(m => m.role === "user" && m.content.includes("Message from chat")));
  assert.ok(receiverMessages.some(m => JSON.parse(m.metadata ?? "{}").chatCoordination?.sourceChatId === sender.public_id));
  let busyAnswer;
  if (!liveModelBase) {
  console.log("Verifying busy-chat queueing and non-cancelling wait timeouts.");
  const busyTurn = sendTurn(receiver, "busy-receiver", "BUSY_RECEIVER: finish the current turn before answering other requests.");
  await Promise.race([busyReady, pause(30000).then(() => { throw new Error("Busy turn did not reach inference"); })]);
  busyAnswer = await sendTurn(sender, "ask-busy-receiver", "COORDINATION_BUSY: ask the Coordination receiver chat for its saved answer and report it here.");
  await busyTurn;
  assert.ok(busyAnswer.content.includes(nonce));
  assert.ok(toolResponses.some(item => item.data?.timedOut === true && item.data?.status === "queued"));
  assert.equal(db.prepare("SELECT count(*) AS n FROM chat_agent_messages").get().n, 2);
  }
  console.log("Restoring the receiver from durable history and repeating the round trip.");
  const { resolveConversationRuntime } = await import("../src/lib/hermes/session-service.ts");
  await resolveConversationRuntime({ conversation: receiver, surface: "dashboard_terminal", forceRecreate: true });
  const restoredSender = createConversation({ userId: 1, title: "Restoration sender" });
  const restoredAnswer = await sendTurn(restoredSender, "ask-restored-receiver", `COORDINATION_RESTORED: ${requestText}`);
  assert.ok(restoredAnswer.content.includes(nonce));
  assert.equal(db.prepare("SELECT count(*) AS n FROM chat_agent_messages").get().n, liveModelBase ? 2 : 3);
  let recoveredAnswer;
  if (!liveModelBase) {
    console.log("Recovering a queued message from a fresh dashboard process.");
    const envelope = coordinationStore().enqueue({ userId: 1, sourceId: restoredSender.id,
      targetId: receiver.public_id, sourceRunId: "restart-test", requestId: "restart-test",
      message: "What is the saved answer in your history?" });
    recoveryChild = spawn(process.execPath, [...process.execArgv, "--input-type=module", "-e", `
      await import('./scripts/learn-worker-import-hook.mjs');
      const { default: db } = await import('./src/lib/db.ts');
      const { recoverPendingChatMessages } = await import('./src/lib/conversations/coordination-recovery.ts');
      const { waitForDetachedEventPumps } = await import('./src/lib/hermes/detached-event-pump.ts');
      const { createServer } = await import('node:http');
      const { POST } = await import('./src/app/api/internal/chat-coordination-recovery/route.ts');
      const recoveryServer = createServer(async (req, res) => {
        const response = await POST(new Request('http://127.0.0.1/api/internal/chat-coordination-recovery', {
          method: 'POST', headers: req.headers,
        }));
        res.writeHead(response.status, { 'Content-Type': 'application/json' });
        res.end(await response.text());
      });
      await new Promise(resolve => recoveryServer.listen(0, '127.0.0.1', resolve));
      process.env.BREADBOARD_INTERNAL_URL = 'http://127.0.0.1:' + recoveryServer.address().port;
      await recoverPendingChatMessages(db);
      await waitForDetachedEventPumps();
      recoveryServer.closeAllConnections();
      await new Promise(resolve => recoveryServer.close(resolve));
      process.exit(0);
    `], { cwd: path.join(root, "dashboard"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    for (const stream of [recoveryChild.stdout, recoveryChild.stderr]) stream.on("data", chunk => logs.push(String(chunk)));
    const exitCode = await Promise.race([
      new Promise((resolve, reject) => { recoveryChild.once("error", reject); recoveryChild.once("exit", resolve); }),
      pause(120000).then(() => { throw new Error("Recovery process timed out"); }),
    ]);
    assert.equal(exitCode, 0, logs.join("").slice(-3000));
    recoveredAnswer = coordinationStore().receipt(1, restoredSender.id, envelope.id);
    assert.equal(recoveredAnswer.status, "complete");
    assert.ok(recoveredAnswer.answer.includes(nonce));
    console.log("Verifying that the receiving chat resumes its own goal after answering a peer.");
    const goalReceiver = createConversation({ userId: 1, title: "Goal receiver" });
    await sendTurn(goalReceiver, "goal-seed-context", `Context for this chat: the saved answer is ${nonce}. No tools needed. Just acknowledge.`);
    const { activateGoalMode, readGoalModeState } = await import("../src/lib/goal-mode.ts");
    const { getRuntimeSessionByConversation } = await import("../src/lib/hermes/runtime-store.ts");
    const { getLatestRuntimeRun } = await import("../src/lib/hermes/run-store.ts");
    const goal = activateGoalMode({ conversationPublicId: goalReceiver.public_id, objective: "Acknowledge that the saved context is ready." });
    const goalRun = getLatestRuntimeRun(getRuntimeSessionByConversation(goalReceiver.id).id);
    db.prepare("UPDATE hermes_runs SET dispatch_json=json_set(dispatch_json, '$.goalMode', json(?)) WHERE id=?")
      .run(JSON.stringify({ enabled: true, goalId: goal.goal_id }), goalRun.id);
    const goalQuestion = coordinationStore().enqueue({ userId: 1, sourceId: restoredSender.id,
      targetId: goalReceiver.public_id, sourceRunId: "goal-yield-test", requestId: "goal-yield-test",
      message: "What is the saved answer in your history?" });
    const { deliverChatMessages } = await import("../src/lib/conversations/coordination.ts");
    await deliverChatMessages(goalReceiver.id);
    const { waitForDetachedEventPumps } = await import("../src/lib/hermes/detached-event-pump.ts");
    await waitForDetachedEventPumps();
    assert.equal(coordinationStore().receipt(1, restoredSender.id, goalQuestion.id).status, "complete");
    assert.ok(listConversationMessages(goalReceiver.id).some(message => message.client_message_id.startsWith(`goal:${goal.goal_id}:`) && message.role === "assistant" && message.status === "complete"));
    assert.equal(readGoalModeState(goalReceiver.public_id).goal_id, goal.goal_id);
  }
  const report = { passed: true, inference: liveModelBase ? `live ${model}` : "deterministic fixture", actualRuntime: "Hermes AIAgent", toolRequests, modelCalls,
    senderAnswer: final.content, ...(busyAnswer ? { busyAnswer: busyAnswer.content } : {}), restoredAnswer: restoredAnswer.content,
    ...(recoveredAnswer ? { recoveredAnswer: recoveredAnswer.answer } : {}),
    envelopeStatus: envelopes[0].status, receiverTurns: listConversationMessages(receiver.id).length / 2,
    verified: ["agent tool discovery", "authenticated plugin callback", "receiver history", "closed-tab delivery", ...(!liveModelBase ? ["busy-chat queue", "non-cancelling timeout", "fresh-process queue recovery", "receiving goal resumes after peer answer"] : []), "receiver runtime restoration"] };
  const reportDir = process.env.BREADBOARD_TEST_REPORT_DIR || path.join(root, "qa/chat-coordination", liveModelBase ? path.basename(scratch) : "");
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, liveModelBase ? "live-result.json" : "smoke-result.json"), JSON.stringify(report, null, 2), { flag: liveModelBase ? "wx" : "w" });
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(logs.join("").split(token).join("[redacted]").split(toolSecret).join("[redacted]").slice(-9000));
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const process of [recoveryChild, child]) {
    if (process?.pid && process.exitCode === null) spawnSync("taskkill.exe", ["/PID", String(process.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  }
  server.closeAllConnections();
  server.close();
  db?.close();
  // Keep isolated state for diagnosing failures; never touch the user's data.
  console.log(`Smoke workspace: ${scratch}`);
  // The normal runtime adapter owns a persistent WebSocket. This standalone
  // test has ended and explicitly terminates after closing its child server.
  process.exit(process.exitCode ?? 0);
}
