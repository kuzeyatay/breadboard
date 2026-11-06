import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import {
  parseAntigravityTranscriptTail,
  parseClaudeTranscriptTail,
  readClaudeNotchActivity,
  readCodexNotchActivity,
} from "../src/lib/notch-agent-activity.ts";

const now = Date.parse("2026-09-21T10:00:00Z");

test("Claude transcript states match the current Codenotch four-state engine", () => {
  const line = (record) => `${JSON.stringify(record)}\n`;
  assert.deepEqual(parseClaudeTranscriptTail(line({
    type: "assistant", timestamp: "2026-09-21T09:59:55Z",
    message: { stop_reason: "tool_use", content: [{ type: "tool_use", name: "Bash" }] },
  }), now - 5_000, now), { state: "working", since: now - 5_000 });
  assert.deepEqual(parseClaudeTranscriptTail(line({
    type: "assistant", timestamp: "2026-09-21T09:59:30Z",
    message: { stop_reason: "tool_use", content: [{ type: "tool_use", name: "Bash" }] },
  }), now - 30_000, now), { state: "waiting", waitingFor: "Bash approval", since: now - 30_000 });
  assert.deepEqual(parseClaudeTranscriptTail(line({
    type: "assistant", timestamp: "2026-09-21T09:59:58Z",
    message: { stop_reason: "end_turn", content: [{ type: "text", text: "Done" }] },
  }), now - 2_000, now), { state: "complete", since: now - 2_000 });
  assert.equal(parseClaudeTranscriptTail(line({
    type: "user", timestamp: "2026-09-21T09:59:59Z", message: { content: "Continue" },
  }), now - 1_000, now)?.state, "working");
});

test("Claude registry keeps exact waiting state and falls back to transcripts for new status words", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "breadboard-notch-"));
  try {
    const registry = path.join(home, ".claude", "sessions");
    const projects = path.join(home, ".claude", "projects", "fixture");
    await mkdir(registry, { recursive: true });
    await mkdir(projects, { recursive: true });
    await writeFile(path.join(registry, "1.json"), JSON.stringify({
      pid: 1, sessionId: "waiting", cwd: "C:\\work\\alpha", status: "waiting",
      waitingFor: "your answer", statusUpdatedAt: now - 10_000,
    }));
    await writeFile(path.join(registry, "2.json"), JSON.stringify({
      pid: 2, sessionId: "finished", cwd: "C:\\work\\beta", status: "shell",
      updatedAt: now - 2_000,
    }));
    await writeFile(path.join(projects, "finished.jsonl"), JSON.stringify({
      type: "assistant", timestamp: "2026-09-21T09:59:58Z",
      message: { stop_reason: "end_turn", content: [{ type: "text", text: "Done" }] },
    }) + "\n");

    const sessions = await readClaudeNotchActivity({ home, now, isProcessAlive: () => true });
    assert.deepEqual(sessions.map(({ state }) => state).sort(), ["complete", "waiting"]);
    assert.equal(sessions.find(({ state }) => state === "waiting")?.waiting_for, "your answer");
    assert.equal(sessions.find(({ state }) => state === "complete")?.name, "beta");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("Codex desktop turn state supplies working, waiting and recent completion rows", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "breadboard-codex-notch-"));
  try {
    const root = path.join(home, ".codex");
    await mkdir(root, { recursive: true });
    const history = new Database(path.join(root, "thread_history_1.sqlite"));
    history.exec(`
      CREATE TABLE thread_turns (thread_id TEXT, turn_id TEXT, status TEXT, started_at INTEGER, completed_at INTEGER);
      CREATE TABLE thread_items (thread_id TEXT, turn_id TEXT, item_id TEXT, rollout_ordinal INTEGER, created_at_ms INTEGER, item_type TEXT);
    `);
    const turn = history.prepare("INSERT INTO thread_turns VALUES (?, ?, ?, ?, ?)");
    const item = history.prepare("INSERT INTO thread_items VALUES (?, ?, ?, ?, ?, ?)");
    turn.run("working", "a", "inProgress", now / 1000 - 30, null);
    item.run("working", "a", "1", 1, now - 1_000, "reasoning");
    turn.run("waiting", "b", "inProgress", now / 1000 - 40, null);
    item.run("waiting", "b", "2", 1, now - 500, "approval_request");
    turn.run("complete", "c", "completed", now / 1000 - 8, now / 1000 - 2);
    item.run("complete", "c", "3", 1, now - 2_000, "agent_message");
    history.close();

    const names = new Database(path.join(root, "state_5.sqlite"));
    names.exec("CREATE TABLE threads (id TEXT, title TEXT, first_user_message TEXT, agent_nickname TEXT, cwd TEXT)");
    const named = names.prepare("INSERT INTO threads VALUES (?, ?, '', '', 'C:/work/project')");
    named.run("working", "Working turn"); named.run("waiting", "Waiting turn"); named.run("complete", "Complete turn");
    names.close();

    const sessions = readCodexNotchActivity({ home, now });
    assert.deepEqual(new Set(sessions.map(({ state }) => state)), new Set(["working", "waiting", "complete"]));
    assert.equal(sessions.find(({ state }) => state === "waiting")?.waiting_for, "needs your input");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("Antigravity asks and approvals become waiting instead of generic work", () => {
  assert.deepEqual(parseAntigravityTranscriptTail(JSON.stringify({
    type: "PLANNER_RESPONSE", tool_calls: [{ name: "ask_question" }],
  })), { state: "waiting", waitingFor: "Question" });
  assert.deepEqual(parseAntigravityTranscriptTail(JSON.stringify({
    type: "PLANNER_RESPONSE", tool_calls: [{ name: "write_to_file", arguments: { ArtifactMetadata: { RequestFeedback: true } } }],
  })), { state: "waiting", waitingFor: "Approval" });
});
