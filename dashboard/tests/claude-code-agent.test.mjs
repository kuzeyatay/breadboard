import test from "node:test";
import assert from "node:assert/strict";
import { ingestClaudeEvent, permissionArgs } from "../src/lib/claude-code-agent/run-manager.ts";
import { taskFromClaudeCodeCommand } from "../src/lib/claude-code-agent/identity.ts";

test("the command token is stripped and other tokens stay", () => {
  assert.equal(taskFromClaudeCodeCommand("/agents:claude-code fix the build"), "fix the build");
  assert.equal(taskFromClaudeCodeCommand("/study-guide /agents:claude-code x"), "/study-guide x");
  assert.equal(taskFromClaudeCodeCommand("/agents:codex x"), null);
});

test("Breadboard permissions become Claude Code permissions", () => {
  assert.deepEqual(permissionArgs(true, "autonomous").args, ["--permission-mode", "bypassPermissions"]);
  const ask = permissionArgs(false, "autonomous").args;
  assert.ok(ask.includes("default") && ask.join(" ").includes("Bash Edit Write"));
  assert.ok(!permissionArgs(true, "supervised").args.includes("bypassPermissions"));
  assert.ok(permissionArgs(false, "supervised").args.join(" ").includes("mcp__breadboard"));
});

test("stream-json maps to the run card's events", () => {
  const events = [];
  const run = { sequence: 0, events, toolNames: new Map(), toolCount: 0, lastText: "", answer: "", stderr: "" };
  ingestClaudeEvent(run, { type: "assistant", message: { content: [
    { type: "text", text: "Looking at notes." },
    { type: "tool_use", id: "t1", name: "mcp__breadboard__garden_search", input: { query: "ohm" } },
  ] } });
  ingestClaudeEvent(run, { type: "user", message: { content: [
    { type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "3 notes" }] },
  ] } });
  ingestClaudeEvent(run, { type: "assistant", message: { content: [{ type: "text", text: "Done." }] } });
  ingestClaudeEvent(run, { type: "result", result: "Done.", usage: { input_tokens: 10, output_tokens: 4 } });
  assert.deepEqual(events.map((e) => e.type), ["reasoning.completed", "tool.completed", "agent.usage"]);
  assert.equal(events[1].payload.tool, "garden_search");
  assert.equal(events[1].payload.title, "ohm");
  assert.equal(events[1].payload.summary, "3 notes");
  assert.equal(run.answer, "Done.");
  assert.equal(run.usage.totalTokens, 14);
});

test("images ride in the same user turn as the instruction", async () => {
  const { userMessage } = await import("../src/lib/claude-code-agent/run-manager.ts");
  const message = userMessage("/goal tests pass", ["data:image/png;base64,AAAA", "data:text/plain;base64,AAAA"]);
  assert.deepEqual(message.message.content.map((block) => block.type), ["image", "text"]);
  assert.equal(message.message.content[0].source.media_type, "image/png");
  assert.equal(message.message.content[1].text, "/goal tests pass");
});

test("a stacked /goal is carried by Claude Code, other skills are not", async () => {
  const { findCapabilityConflict } = await import("../src/lib/hermes/capability-combinations.ts");
  assert.equal(findCapabilityConflict({ text: "/goal /agents:claude-code ship it", surface: "garden_chat" }), null);
  assert.equal(findCapabilityConflict({ text: "/study-guide /agents:claude-code x", surface: "garden_chat" })?.code, "runtime_agent_capability_conflict");
  assert.equal(taskFromClaudeCodeCommand("/goal /agents:claude-code ship it"), "/goal ship it");
});
