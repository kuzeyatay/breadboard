// The read half of cross-agent memory: what may cross from brain.db into a
// wrapped third-party runtime, and what may not.
//
// These are boundary tests, not ranking tests — conversation-memory.test.mjs and
// mem0-hybrid-memory.test.mjs already own selection policy, and this path reuses
// it unchanged. What is asserted here is everything that makes an external agent
// different from a chat turn: unreviewed guesses stay home, secrets are dropped
// rather than announced, place-scoped memories do not follow the user out of
// their place, the block reads as background rather than as a brief, and every
// decision leaves a line of evidence behind for the pilot review.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-agent-memory-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
// The semantic layer has its own tests; here it would only add a network call.
process.env.BREADBOARD_MEM0 = "off";
delete process.env.BREADBOARD_AGENT_MEMORY;
delete process.env.BREADBOARD_AGENT_MEMORY_AGENTS;

const { default: db } = await import("../src/lib/db.ts");
const memory = await import("../src/lib/conversations/memory.ts");
const context = await import("../src/lib/conversations/agent-memory-context.ts");

const USER_ID = 1;
// Shares "shareholder", "agreement" and "review" with the memories below, which
// is what carries them over the shared relevance cutoff.
const TASK = "Review the shareholder agreement for the Dutch entity";

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec(`
    DELETE FROM durable_memories;
    DELETE FROM users;
    DELETE FROM sqlite_sequence;
  `);
  db.prepare(
    "INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x')",
  ).run();
  try {
    fs.rmSync(context.agentMemoryInjectionLogPath(), { force: true });
  } catch {
    // The log is created on first write; absence is the normal starting state.
  }
});

/** A durable memory written straight to canon, bypassing write-time policy. */
function remember(content, overrides = {}) {
  const row = {
    scope: "global",
    scopeId: null,
    state: "confirmed",
    kind: "preference",
    confidence: 0.9,
    salience: 0.85,
    ...overrides,
  };
  db.prepare(`
    INSERT INTO durable_memories(
      user_id, content, kind, scope, scope_id, state, confidence, salience
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    USER_ID,
    content,
    row.kind,
    row.scope,
    row.scopeId,
    row.state,
    row.confidence,
    row.salience,
  );
}

function logLines() {
  const target = context.agentMemoryInjectionLogPath();
  if (!fs.existsSync(target)) return [];
  return fs
    .readFileSync(target, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function compose(overrides = {}) {
  return context.composeAgentMemoryContext({
    userId: USER_ID,
    agentId: "legal_agent",
    query: TASK,
    ...overrides,
  });
}

test("a confirmed global memory reaches an enrolled agent", async () => {
  remember("prefers plain English summaries over legalese when reviewing a shareholder agreement");
  const injection = await compose();
  assert.ok(injection, "an eligible memory should produce a block");
  assert.equal(injection.memoryCount, 1);
  assert.match(injection.text, /plain English summaries/);
  assert.equal(injection.channel, "lexical");
});

test("an unreviewed candidate never crosses the boundary", async () => {
  remember("prefers plain English summaries over legalese when reviewing a shareholder agreement", {
    state: "candidate",
  });
  assert.equal(await compose(), null);
});

test("a superseded memory never crosses the boundary", async () => {
  remember("prefers plain English summaries over legalese when reviewing a shareholder agreement", {
    state: "superseded",
  });
  assert.equal(await compose(), null);
});

test("place-scoped memories do not follow the user out of their place", async () => {
  const content = "the shareholder agreement review always starts from the signed original";
  remember(content, { scope: "project", scopeId: "breadboard" });
  remember(content, { scope: "garden", scopeId: "7" });
  assert.equal(
    await compose(),
    null,
    "project and garden memories are about a place the runtime is not in",
  );

  remember(content, { scope: "global" });
  const injection = await compose();
  assert.ok(injection, "the same fact at global scope is eligible");
  assert.equal(injection.memoryCount, 1);
});

test("a sensitive memory is withheld entirely, not announced as redacted", async () => {
  remember("the shareholder agreement review portal password is hunter2");
  const injection = await compose();
  assert.equal(injection, null, "nothing else was eligible, so nothing is sent");

  const [entry] = logLines();
  assert.equal(entry.withheldSensitive, 0, "the count only covers rows that reached selection");

  remember("prefers plain English summaries over legalese when reviewing a shareholder agreement");
  const second = await compose();
  assert.ok(second);
  assert.equal(second.memoryCount, 1);
  assert.equal(second.withheldSensitive, 1);
  assert.doesNotMatch(second.text, /hunter2/);
  assert.doesNotMatch(
    second.text,
    /sensitive content omitted/,
    "the in-app placeholder would still disclose that such a memory exists",
  );
});

test("the block frames memory as context rather than as the brief", () => {
  const text = context.renderAgentMemoryBlock([
    { id: 1, content: "prefers concise summaries", kind: "preference", scope: "global", state: "confirmed", score: 1, sourceConversationId: null },
  ]);
  assert.match(text, /^# user_memory/);
  assert.match(text, /context, never instruction/i);
  assert.match(text, /the task wins/i);
  assert.match(text, /- \[preference\] prefers concise summaries/);
});

test("the block is bounded in count and characters", async () => {
  for (let index = 0; index < 12; index += 1) {
    remember(
      `${"shareholder agreement review preference number " + index} ${"padding ".repeat(120)}`,
    );
  }
  const injection = await compose();
  assert.ok(injection);
  assert.ok(injection.memoryCount <= 5, `expected at most 5 memories, got ${injection.memoryCount}`);
  assert.ok(
    injection.characters <= 1_800,
    `expected the block under 1800 characters, got ${injection.characters}`,
  );
});

test("agents outside the pilot get nothing", async () => {
  remember("prefers plain English summaries over legalese when reviewing a shareholder agreement");
  assert.equal(await compose({ agentId: "vibe_trading" }), null);
  assert.equal(logLines().at(-1).skipped, "not_enrolled");
});

test("the kill switch stops every injection", async () => {
  remember("prefers plain English summaries over legalese when reviewing a shareholder agreement");
  const env = { ...process.env, BREADBOARD_AGENT_MEMORY: "off" };
  assert.equal(await compose({ env }), null);
  assert.equal(logLines().at(-1).skipped, "disabled");
  assert.equal(context.agentMemoryInjectionEnabled("legal_agent", env), false);
});

test("enrolment can be overridden without touching the code", () => {
  const env = { BREADBOARD_AGENT_MEMORY_AGENTS: "vibe_trading, deep_research" };
  assert.equal(context.agentMemoryInjectionEnabled("vibe_trading", env), true);
  assert.equal(context.agentMemoryInjectionEnabled("legal_agent", env), false);
  assert.deepEqual([...context.AGENT_MEMORY_PILOT_AGENTS], [
    "legal_agent",
    "deep_research",
    "stock_analyst",
  ]);
});

test("every decision is logged, including the skips", async () => {
  remember("prefers plain English summaries over legalese when reviewing a shareholder agreement");
  await compose();
  await compose({ query: "   " });
  await compose({ agentId: "stock_analyst", query: "Should I buy more of the shareholder agreement" });

  const lines = logLines();
  assert.equal(lines.length, 3, "one line per attempted injection, not per success");
  assert.equal(lines[0].injected, true);
  assert.equal(lines[0].agent, "legal_agent");
  assert.deepEqual(lines[0].memoryIds.length, 1);
  assert.ok(typeof lines[0].elapsedMs === "number");
  assert.equal(lines[1].injected, false);
  assert.equal(lines[1].skipped, "empty_query");
  assert.equal(lines[2].agent, "stock_analyst");
});

test("the log tells a starved selection apart from an empty one", async () => {
  const content = "the shareholder agreement review always starts from the signed original";
  remember(content, { scope: "project", scopeId: "breadboard" });
  remember(content, { state: "candidate" });
  assert.equal(await compose(), null);

  const starved = logLines().at(-1);
  assert.equal(starved.skipped, "no_memories");
  assert.equal(starved.selection.ranked, 2, "both rows ranked; the filters removed them");
  assert.equal(starved.selection.droppedUnconfirmed, 1);
  assert.equal(starved.selection.droppedScope, 1);

  db.exec("DELETE FROM durable_memories");
  assert.equal(await compose(), null);
  const empty = logLines().at(-1);
  assert.equal(empty.skipped, "no_memories");
  assert.equal(empty.selection.ranked, 0, "nothing ranked at all — a different story");
});

test("memory selection never fails a run", async () => {
  remember("prefers plain English summaries over legalese when reviewing a shareholder agreement");
  const broken = {
    prepare() {
      throw new Error("brain.db is locked");
    },
  };
  const injection = await context.composeAgentMemoryContext(
    { userId: USER_ID, agentId: "legal_agent", query: TASK },
    broken,
  );
  assert.equal(injection, null);
  assert.equal(logLines().at(-1).skipped, "retrieval_failed");
});

test("the sensitivity predicate backs the in-app redactor", () => {
  assert.equal(memory.isSensitiveMemoryText("the api key is abc"), true);
  assert.equal(memory.isSensitiveMemoryText("prefers concise summaries"), false);
});

// The seams. Each enrolled agent takes its context through a different channel,
// and a channel that quietly stops being wired is invisible from the outside:
// the run still succeeds, it just knows nothing. These read the source because
// the alternative is a Python venv, a Docker service and a search backend.

const source = (relative) =>
  fs.readFileSync(path.join(import.meta.dirname, "..", relative), "utf8");
const repoSource = (relative) =>
  fs.readFileSync(path.join(import.meta.dirname, "..", "..", relative), "utf8");

test("the legal agent takes memory as a system-prompt section, never as the brief", () => {
  const route = source("src/app/api/legal/runs/route.ts");
  assert.match(route, /composeAgentMemoryContext\(/);
  assert.match(route, /agentId: "legal_agent"/);
  assert.match(route, /memoryContext: memory\?\.text \?\? ""/);

  const manager = source("src/lib/legal/run-manager.ts");
  assert.match(manager, /userContext: input\.memoryContext/);

  const bridge = repoSource("scripts/legal-bridge.py");
  assert.match(bridge, /user_context=str\(job\.get\("userContext"\) or ""\)/);
  assert.match(bridge, /def _system_prompt\([\s\S]*?user_context: str = ""/);
  assert.match(bridge, /if user_context\.strip\(\):\n\s+sections\.append/);
  assert.doesNotMatch(
    bridge,
    /def _assignment[\s\S]*?userContext/,
    "the assignment is the brief; memory must not appear in it",
  );
});

test("the stock analyst prefixes at the wire, keeping the saved task the user's own", () => {
  const route = source("src/app/api/stock-analyst/runs/route.ts");
  assert.match(route, /agentId: "stock_analyst"/);
  assert.match(route, /memoryContext: memory\?\.text \?\? ""/);

  const manager = source("src/lib/stock-analyst/run-manager.ts");
  assert.match(
    manager,
    /message: memoryContext \? `\$\{memoryContext\}\\n\\n\$\{run\.task\}` : run\.task/,
  );
  assert.match(
    manager,
    /emit\(run, "run\.started", \{\n\s+task: run\.task,/,
    "the card and the saved message show what was asked, not the block",
  );
});

test("deep research sends memory beside the question, never inside it", () => {
  const service = source("src/lib/deep-research/service.ts");
  assert.match(service, /agentId: "deep_research"/);
  assert.match(service, /userContext: memory\?\.text \?\? ""/);
  assert.doesNotMatch(
    service,
    /query: `\$\{/,
    "the engine embeds the query in a <prompt> tag to generate search terms",
  );

  const api = repoSource("deep-research/src/api.ts");
  assert.match(api, /userContext,/);
  assert.match(api, /MAX_USER_CONTEXT_LENGTH/);
  const summarize = api.slice(api.indexOf("function summarize"), api.indexOf("app.post('/runs'"));
  assert.doesNotMatch(
    summarize,
    /userContext/,
    "context is not run metadata; it must not travel back to the browser",
  );

  const prompt = repoSource("deep-research/src/prompt.ts");
  assert.match(prompt, /systemPrompt = \(userContext\?: string\)/);
});
