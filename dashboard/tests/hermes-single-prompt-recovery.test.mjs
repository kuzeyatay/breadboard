import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {WebSocketServer} from "ws";
import {HermesRuntimeAdapter} from "../src/lib/agent-runtime/adapters/hermes.ts";
import {executeTerminalCommand} from "../scripts/runtime-v2-terminal-command-worker.mjs";
import {activateGoalMode, callGoalModeTool, readGoalModeState} from "../src/lib/goal-mode.ts";

// Scripted gateway, real loopback WebSocket, terminal worker and durable goal.
// This verifies transport recovery without a paid model or the user's lab.
test("one submitted prompt survives lost transport and delivers its completed work once", {timeout: 15000}, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-one-prompt-"));
  const env = {...process.env, BREADBOARD_GOAL_HOME: path.join(root, "goals")};
  const conversationPublicId = "conv_one_prompt_test";
  activateGoalMode({env, conversationPublicId, objective: "Produce and verify the experiment result"});
  const server = new WebSocketServer({host: "127.0.0.1", port: 0});
  await new Promise(resolve => server.once("listening", resolve));
  let submits = 0, executions = 0, recovered = 0;
  let result = {state: "running", turn_id: "msg_new"};
  let job;
  server.on("connection", socket => socket.on("message", data => {
    const {id, method, params} = JSON.parse(data.toString());
    const reply = value => socket.send(JSON.stringify({jsonrpc: "2.0", id, result: value}));
    if (method === "session.create") return reply({session_id: "live", stored_session_id: "stored"});
    if (method === "prompt.submit") {
      submits++;
      assert.equal(params.client_turn_id, "msg_new");
      reply({status: "streaming"});
      job = (async () => {
        executions++;
        const command = process.platform === "win32" ? "Write-Output 'verified experiment'" : "printf 'verified experiment\\n'";
        const output = await executeTerminalCommand({identity: {jobId: "single-prompt"}, request: {command, workspaceRoot: root, maxRuntimeMs: 5000}}, new AbortController().signal, {checkpoint() {}});
        assert.equal(output.exitCode, 0, output.stderr);
        fs.writeFileSync(path.join(root, "result.txt"), output.stdout);
        assert.match(fs.readFileSync(path.join(root, "result.txt"), "utf8"), /verified experiment/);
        callGoalModeTool({env, conversationPublicId, tool: "update_goal", args: {status: "complete"}});
        result = {state: "completed", turn_id: "msg_new", payload: {status: "complete", text: "Verified result.txt is ready.", completed_tools: [{tool_id: "tool-command", name: "terminal_execute_command", success: true, result: output}]}};
      })();
      socket.close(); // Lose all live progress and completion frames.
      return;
    }
    if (method === "session.turn_result") { recovered++; assert.equal(params.turn_id, "msg_new"); return reply(result); }
    reply({});
  }));
  const adapter = new HermesRuntimeAdapter({baseUrl: `http://127.0.0.1:${server.address().port}`, sessionToken: "fixture", requestTimeoutMs: 2000});
  t.after(async () => {
    adapter.dispose();
    for (const socket of server.clients) socket.terminate();
    await new Promise(resolve => server.close(resolve));
    await job;
    fs.rmSync(root, {recursive: true, force: true});
  });
  const session = await adapter.createSession({surface: "garden_chat", sessionKey: "single-prompt-integration", previousDirectory: root});
  // A viewer attaches before the new POST after the previous turn was stopped.
  session.activeTurnId = "msg_abandoned";
  session.submittedTurnId = "msg_abandoned";
  let durable = {};
  let connected;
  const ready = new Promise(resolve => {connected = resolve;});
  const stream = adapter.streamSession({...session, messageId: undefined, resolveActiveTurn: () => durable}, undefined, connected);
  const events = [];
  const drain = (async () => { for await (const event of stream) events.push(event); })();
  await ready;
  durable = {messageId: "msg_new", instruction: "Produce the experiment result", submitted: false};
  await adapter.startRun({...session, text: durable.instruction, messageId: "msg_new", yoloMode: true});
  durable.submitted = true;
  await drain;
  await job;
  assert.equal(submits, 1);
  assert.equal(executions, 1);
  assert.ok(recovered > 0);
  assert.equal(events.filter(e => e.type === "assistant.completed").length, 1);
  assert.equal(events.filter(e => e.type === "tool.completed").length, 1);
  assert.equal(events.some(e => e.type === "error"), false);
  assert.equal(readGoalModeState(conversationPublicId, env).status, "complete");
});
