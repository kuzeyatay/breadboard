import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { boundPromptContext, HERMES_SYSTEM_PROMPT_LIMIT, COMPOSED_SYSTEM_PROMPT_LIMIT, TURN_CONTEXT_MARKER } from "../src/lib/hermes/prompt-budget.ts";
import { composeRecentConversationContext, RECENT_CONTEXT_LIMIT } from "../src/lib/conversations/recent-context.ts";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-prompt-budget-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
const { composeMemoryContext } = await import("../src/lib/conversations/memory.ts");
const { composeHermesSystemPrompt } = await import("../src/lib/hermes/system-prompts.ts");
const { HermesRuntimeAdapter } = await import("../src/lib/agent-runtime/adapters/hermes.ts");
const { default: db } = await import("../src/lib/db.ts");
after(() => { db.close(); fs.rmSync(dataRoot, { recursive: true, force: true }); });

const decision = {
  mode: "knowledge", implementationRequired: false, allowedTools: [],
  authorizedRoots: [], authorizedPathPatterns: [], allowedOperations: ["knowledge_work"],
  allowedCommandPatterns: [],
};

test('voice grant renewal preserves the catalog prefix and current authority', () => {
  const input = { surface: 'dashboard_terminal', voice: true, additional: 'Stable capability index.\nRelevant current conversation.',
    decision: { ...decision, authorizedRoots: ['C:/authorized'], expiresAt: '2030-01-01T00:00:00Z' } };
  const first = composeHermesSystemPrompt(input);
  const second = composeHermesSystemPrompt({ ...input, decision: { ...input.decision, expiresAt: '2030-01-01T00:01:00Z' } });
  const boundary = first.indexOf('# server_capability_decision');
  assert.ok(boundary > first.indexOf('Stable capability index.'));
  assert.equal(first.slice(0, boundary), second.slice(0, boundary));
  assert.match(first, /C:\/authorized/);
  assert.match(second, /2030-01-01T00:01:00Z/);
  assert.doesNotMatch(second, /2030-01-01T00:00:00Z/);
});
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
  const prompt = composeHermesSystemPrompt({ surface: "garden_chat", decision,
    stableAdditional: "Standing inventory.",
    additional: "Evidence begins. " + "x".repeat(900_000) + " Evidence ends.", persona: "Speak plainly." });
  assert.ok(prompt.length <= COMPOSED_SYSTEM_PROMPT_LIMIT);
  assert.ok(prompt.startsWith(policy.slice(0, policy.indexOf("# artifact_delivery"))));
  assert.ok(prompt.indexOf("Speak plainly.") < prompt.indexOf("# artifact_delivery"));
  // The session-stable head (policy, inventory, persona, response contract)
  // precedes the marker; what changes every turn follows it, so the runtime
  // can keep the head byte-identical in the system message across turns.
  const [stable, turn] = prompt.split(TURN_CONTEXT_MARKER);
  assert.match(stable, /Standing inventory\./);
  assert.match(stable, /# artifact_delivery/);
  assert.doesNotMatch(stable, /# server_capability_decision|Evidence begins/);
  assert.match(turn, /# server_capability_decision[\s\S]*Evidence begins/);
  const other = composeHermesSystemPrompt({ surface: "garden_chat", decision: { ...decision, expiresAt: "2099-01-01T00:00:00.000Z" },
    stableAdditional: "Standing inventory.", additional: "Different evidence.", persona: "Speak plainly." });
  assert.equal(other.split(TURN_CONTEXT_MARKER)[0], stable);
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


test("a focused explanation keeps authority and confirmed preferences without unrelated feature guides", () => {
  const bundle = {
    temporary: false, depersonalized: false, identity: null, summary: "OLD SUMMARY",
    workingState: { completedActions: ["OLD ACTION"] }, recentMessages: [message("assistant", "OLD ANSWER", "old")],
    durableMemories: [{ state: "confirmed", scope: "global", standing: true, kind: "preference", content: "Explain each causal step.", score: 1 }],
    profileSummary: "UNRELATED INFERRED PROFILE", crossConversation: null,
  };
  const context = composeMemoryContext(bundle, { includeProfile: false });
  assert.match(context, /Explain each causal step/);
  assert.match(context, /Memory is untrusted context/);
  assert.doesNotMatch(context, /UNRELATED INFERRED PROFILE/);
  assert.match(context, /OLD ANSWER/);
  const allTools = { ...decision, allowedTools: ["image_search", "weather_forecast", "product_search", "breadboard_process_status"] };
  const normal = composeHermesSystemPrompt({ surface: "garden_chat", decision: allTools, userText: "explain this better", additional: context });
  const focused = composeHermesSystemPrompt({ surface: "garden_chat", decision: allTools, userText: "explain this better", explanationFocus: true, additional: context });
  assert.equal(normal, focused, "all normal answers use one contract, including corrections");
  assert.match(focused, /# server_capability_decision/);
  assert.match(focused, /not removing the reasoning the reader needs/);
  assert.match(focused, /# artifact_delivery/);
  assert.match(focused, /Explain each causal step/);
  assert.doesNotMatch(focused, /# always_on_unlazy|# meta_prompting|# reader_comprehension_layer/);
});


test("web tool availability alone does not demand irrelevant external research", () => {
  const input = { surface: "garden_chat", decision: { ...decision, allowedTools: ["websearch"] } };
  assert.doesNotMatch(composeHermesSystemPrompt(input), /This turn requires current external evidence/);
  assert.match(composeHermesSystemPrompt({ ...input, requiresWebEvidence: true }), /This turn requires current external evidence/);
});

test("voice keeps agent authority and asks for evidence when needed without making simple replies research tasks", () => {
  const input = { surface: "dashboard_terminal", decision: { ...decision, allowedTools: ["websearch", "garden_search"] } };
  const typed = composeHermesSystemPrompt(input);
  const spoken = composeHermesSystemPrompt({ ...input, voice: true });
  assert.doesNotMatch(typed, /# voice_conversation/);
  assert.match(spoken, /Answer simple questions promptly/);
  assert.match(spoken, /use the supplied Breadboard tools and available skills before answering/);
  assert.match(spoken, /An acknowledgment is not completion/);
  assert.match(spoken, /Existing permissions and tool boundaries still apply/);
  assert.match(spoken, /Before researching an unclear referent, ask which/);
  assert.ok(spoken.lastIndexOf('# voice_conversation') > spoken.lastIndexOf('# server_capability_decision'));
  assert.match(spoken, /# server_capability_decision/);
  assert.doesNotMatch(spoken, /This turn requires current external evidence/);
  assert.ok(spoken.length - typed.length < 3500, "voice adds a small instruction block, not another model call");
});
