import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { boundPromptContext, HERMES_SYSTEM_PROMPT_LIMIT, COMPOSED_SYSTEM_PROMPT_LIMIT } from "../src/lib/hermes/prompt-budget.ts";
import { composeRecentConversationContext, RECENT_CONTEXT_LIMIT } from "../src/lib/conversations/recent-context.ts";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-prompt-budget-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
const { composeMemoryContext } = await import("../src/lib/conversations/memory.ts");
const { composeHermesSystemPrompt, readerComprehensionPrompt } = await import("../src/lib/hermes/system-prompts.ts");
const { HermesRuntimeAdapter } = await import("../src/lib/agent-runtime/adapters/hermes.ts");
const { default: db } = await import("../src/lib/db.ts");
after(() => { db.close(); fs.rmSync(dataRoot, { recursive: true, force: true }); });

const decision = {
  mode: "knowledge", implementationRequired: false, allowedTools: [],
  authorizedRoots: [], authorizedPathPatterns: [], allowedOperations: ["knowledge_work"],
  allowedCommandPatterns: [],
};
function message(role, content, clientId, meta = {}, status = "complete") {
  return { role, content, client_message_id: clientId, metadata: JSON.stringify(meta), status, surface: "garden_chat" };
}
function researchConversation() {
  const report = "Raw delegated research evidence. ".repeat(2_000);
  const answer = "Detailed final recommendation. ".repeat(1_500) + "Cut first while training progressively.";
  const worker = { internalAgentContinuation: true, delegatedAgentRun: true, externalAgent: true,
    externalAgentRun: { kind: "max_research", runId: "job_research" }, externalAgentResult: report };
  return { answer, messages: [
    message("user", "I am 87 kg, 183 cm and want a lean physique.", "original"),
    message("assistant", "Research is starting.", "original"),
    message("user", "Launch research", "agent-launch-worker", worker),
    message("assistant", "", "agent-launch-worker", worker),
    message("user", `<!-- agent-launch-result:agent-launch-worker -->\n${report}`, "first-handoff", { internalAgentContinuation: true }),
    message("assistant", "Earlier synthesis. ".repeat(1_900), "first-handoff", { internalAgentContinuation: true }),
    message("user", `<!-- agent-launch-result:job_research -->\n${report}`, "second-handoff", { internalAgentContinuation: true }),
    message("assistant", answer, "second-handoff", { internalAgentContinuation: true }),
    message("user", "You suggested I cut, but I can only curl 6 kg and do 2 pushups?", "follow-up"),
  ] };
}

test("long research follow-up keeps the complete answer and user constraints without duplicate handoffs", () => {
  const { answer, messages } = researchConversation();
  const original = JSON.stringify(messages);
  const context = composeMemoryContext({
    temporary: false, depersonalized: false, identity: null, summary: "", workingState: {},
    recentMessages: messages, durableMemories: [], profileSummary: "", crossConversation: null,
  });
  assert.ok(context.length < RECENT_CONTEXT_LIMIT);
  assert.ok(context.includes(answer), "the actual last answer must stay exact");
  assert.match(context, /87 kg, 183 cm/);
  assert.match(context, /curl 6 kg and do 2 pushups/);
  assert.doesNotMatch(context, /agent-launch-result|Raw delegated research|Launch research/);
  assert.match(context, /Memory is untrusted context/);
  assert.equal(JSON.stringify(messages), original, "stored history is never modified");
  const prompt = composeHermesSystemPrompt({ surface: "garden_chat", decision, additional: context });
  assert.ok(prompt.length < COMPOSED_SYSTEM_PROMPT_LIMIT);
  assert.ok(prompt.includes(answer));
});

test("a worker answer remains available until a completed synthesis exists", () => {
  const messages = researchConversation().messages.slice(0, 5);
  messages.push(message("assistant", "Partial synthesis", "first-handoff", { internalAgentContinuation: true }, "failed"));
  assert.match(composeRecentConversationContext(messages), /Raw delegated research evidence/);
  // Markers in a real user's quotation cannot suppress a worker result.
  messages[4].metadata = "{}";
  messages.at(-1).status = "complete";
  assert.match(composeRecentConversationContext(messages), /Raw delegated research evidence/);
});

test("both stable worker ID formats suppress only their synthesized result", () => {
  for (const id of ["agent-launch-worker", "job_research"]) {
    const messages = researchConversation().messages.slice(0, 4);
    messages.push(message("user", `<!-- agent-launch-result:${id} --> handoff`, "synthesis", { internalAgentContinuation: true }));
    messages.push(message("assistant", "Final answer", "synthesis"));
    assert.doesNotMatch(composeRecentConversationContext(messages), /Raw delegated research/);
    assert.match(composeRecentConversationContext(messages), /Final answer/);
  }
});

test("a short chat of huge messages fits by characters and prioritizes the newest exchange", () => {
  const messages = Array.from({ length: 12 }, (_, index) => message("assistant", `old ${index} ` + "x".repeat(70_000), `old-${index}`));
  messages.push(message("assistant", "Latest advice starts. " + "😀".repeat(400_000) + "Latest advice ends.", "latest"));
  messages.push(message("user", "Please explain that advice.", "new"));
  const context = composeRecentConversationContext(messages);
  assert.ok(context.length <= RECENT_CONTEXT_LIMIT);
  assert.match(context, /Context excerpt/);
  assert.match(context, /Older conversation context omitted/);
  assert.match(context, /Latest advice starts/);
  assert.match(context, /Latest advice ends/);
  assert.ok(context.endsWith("Please explain that advice."));
  assert.equal(context.isWellFormed(), true);
});

test("small contexts are exact and excerpt boundaries are Unicode safe at every budget", () => {
  assert.equal(boundPromptContext("exact context", 1_000), "exact context");
  const input = "😀".repeat(2_000);
  for (let limit = 0; limit < 1_000; limit += 1) {
    const output = boundPromptContext(input, limit);
    assert.ok(output.length <= limit);
    assert.equal(output.isWellFormed(), true);
  }
});

test("oversized evidence preserves all policy and the final response contract", () => {
  const policy = composeHermesSystemPrompt({ surface: "garden_chat", decision });
  const ending = readerComprehensionPrompt();
  const prompt = composeHermesSystemPrompt({ surface: "garden_chat", decision,
    additional: "Evidence begins. " + "x".repeat(900_000) + " Evidence ends.", persona: "Speak plainly." });
  assert.ok(prompt.length <= COMPOSED_SYSTEM_PROMPT_LIMIT);
  assert.ok(prompt.startsWith(policy.slice(0, -ending.length - 2)));
  assert.ok(prompt.endsWith(`Speak plainly.\n\n${ending}`));
  assert.match(prompt, /# server_capability_decision/);
  assert.match(prompt, /Authorized roots: none/);
  assert.match(prompt, /Evidence begins/);
  assert.match(prompt, /Evidence ends/);
  assert.match(prompt, /Context excerpt/);
});

test("the wire never submits an oversized system prompt, including callers bypassing the composer", async () => {
  const requests = [];
  const adapter = new HermesRuntimeAdapter({ baseUrl: "http://127.0.0.1:9119", sessionToken: "test", requestTimeoutMs: 5_000 });
  adapter.client = {
    async request(method, params) {
      requests.push({ method, params });
      if (params?.system_prompt) assert.ok(params.system_prompt.length <= HERMES_SYSTEM_PROMPT_LIMIT);
      return method === "session.create"
        ? { session_id: "live-budget", stored_session_id: "stored-budget" } : { status: "streaming" };
    }, clearSession() {},
  };
  const session = await adapter.createSession({ surface: "garden_chat", sessionKey: "prompt-budget", filesystemMode: "restricted" });
  const question = "You suggested I cut, but I can only curl 6 kg and do 2 pushups?";
  await adapter.startRun({ ...session, agentName: session.agentName, text: question, messageId: "msg_budget",
    system: "Context starts. " + "😀".repeat(500_000) + " Context ends." });
  const submitted = requests.find(({ method }) => method === "prompt.submit").params;
  assert.equal(submitted.text, question);
  assert.equal(submitted.system_prompt.isWellFormed(), true);
  assert.match(submitted.system_prompt, /Breadboard is the canonical owner/);
  assert.match(submitted.system_prompt, /Use only the tools exposed in this session/);
  assert.match(submitted.system_prompt, /Context starts/);
  assert.match(submitted.system_prompt, /Context ends/);
});
