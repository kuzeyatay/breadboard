import assert from "node:assert/strict";
import test from "node:test";

import {
  hookMatcherError,
  hookMatcherMatches,
  parseExplicitHookRequest,
  parseHookRequest,
  resolveWorkflowByName,
} from "../src/lib/hooks/natural-language.ts";
import {
  describeHookCommandResult,
  runHookCommand,
} from "../src/lib/hooks/command.ts";

for (const [sentence, provider, instructions] of [
  ["When a GitHub issue is opened, triage it and tell me what needs attention.", "github", "triage it and tell me what needs attention."],
  ["whenever a merge request is opened then review the diff", "gitlab", "review the diff"],
  ["When a Stripe payment fails, draft a note to the customer", "stripe", "draft a note to the customer"],
  ["Summarize the thread whenever someone posts in Slack", "slack", "Summarize the thread"],
  ["when my deploy script sends a webhook, check the logs", "generic", "check the logs"],
  ["After a chat finishes, save the key decisions to my notes", "chat_completed", "save the key decisions to my notes"],
  ["When a new chat starts, remind me of my open tasks", "session_started", "remind me of my open tasks"],
  ["Whenever I send a message, note the time", "prompt_submitted", "note the time"],
  ["After any tool finishes, summarize what it did", "tool_used", "summarize what it did"],
  ["Before a tool runs, tell me which one", "tool_started", "tell me which one"],
]) {
  test(`reads the trigger and the instruction: ${sentence}`, () => {
    const parsed = parseHookRequest(sentence);
    assert.equal(parsed.provider, provider);
    assert.equal(parsed.mode, "chat");
    assert.equal(parsed.instructions, instructions);
    assert.equal(parsed.recognized, true);
    assert.ok(parsed.name);
  });
}

test("a topic in a chat-completed sentence becomes the matcher", () => {
  const parsed = parseHookRequest(
    "Whenever a chat about invoices or receipts finishes, file a summary under Finance",
  );
  assert.equal(parsed.provider, "chat_completed");
  assert.equal(parsed.matcher, "invoices|receipts");
  assert.equal(parsed.instructions, "file a summary under Finance");
});

test("a topic with pattern characters is matched literally", () => {
  const parsed = parseHookRequest("when a chat mentioning C++ finishes, log it");
  assert.equal(parsed.matcher, "C\\+\\+");
  assert.equal(hookMatcherMatches(parsed.matcher, "I asked about c++ templates"), true);
  assert.equal(hookMatcherMatches(parsed.matcher, "I asked about C templates"), false);
});

test("a named tool becomes the matcher, as in Codex", () => {
  const parsed = parseHookRequest(
    "Whenever the web_search or web_extract tool finishes, run `node log.mjs`",
  );
  assert.equal(parsed.provider, "tool_used");
  assert.equal(parsed.matcher, "web_search|web_extract");
  assert.equal(hookMatcherMatches(parsed.matcher, "web_extract"), true);
  assert.equal(hookMatcherMatches(parsed.matcher, "terminal_execute_command"), false);
  assert.equal(parseHookRequest("after any tool finishes, log it").matcher, null);
});

test("only backticked text becomes a command", () => {
  const parsed = parseHookRequest("When a chat finishes, run `npm test -- --quiet`");
  assert.equal(parsed.mode, "command");
  assert.equal(parsed.command, "npm test -- --quiet");
  assert.equal(parsed.instructions, "");
  const prose = parseHookRequest("When a chat finishes, run npm test");
  assert.equal(prose.mode, "chat");
  assert.equal(prose.command, null);
});

test("a named workflow is read and resolved without guessing", () => {
  const workflows = [
    { id: "w1", name: "Weekly digest" },
    { id: "w2", name: "Digest archive" },
    { id: "w3", name: "Triage" },
  ];
  const parsed = parseHookRequest("When a GitHub issue is opened, run the Triage workflow");
  assert.equal(parsed.mode, "workflow");
  assert.equal(parsed.workflowName, "Triage");
  assert.equal(resolveWorkflowByName(parsed.workflowName, workflows)?.id, "w3");
  assert.equal(parseHookRequest("after a chat finishes, run workflow called Weekly digest").workflowName, "Weekly digest");
  assert.equal(resolveWorkflowByName("weekly digest", workflows)?.id, "w1");
  assert.equal(resolveWorkflowByName("digest", workflows), null, "ambiguous");
  assert.equal(resolveWorkflowByName("missing", workflows), null);
});

test("an unrecognized sentence falls back to a visible generic draft", () => {
  const parsed = parseHookRequest("keep an eye on things");
  assert.equal(parsed.provider, "generic");
  assert.equal(parsed.recognized, false);
});

for (const message of [
  "When you finish, summarize the answer for me",
  "After the chat finishes, what should I do?",
  "If a tool fails, tell me why",
  "Whenever a GitHub issue is opened, triage it",
  "Whenever I mention invoices, be extra careful",
  "Whenever a chat finishes",
  "Explain what happens whenever a tool runs",
  "Whenever a chat finishes, what gets saved?",
]) {
  test(`ordinary message stays in chat: ${message}`, () => {
    assert.equal(parseExplicitHookRequest(message), null);
  });
}

for (const [message, provider, mode] of [
  ["Whenever a chat finishes, save the key decisions to my notes", "chat_completed", "chat"],
  ["Every time the terminal_execute_command tool finishes, run `node audit.mjs`", "tool_used", "command"],
  ["Create a hook that when a new chat starts, run the Briefing workflow", "session_started", "workflow"],
]) {
  test(`standing instruction becomes a hook: ${message}`, () => {
    const parsed = parseExplicitHookRequest(message);
    assert.ok(parsed);
    assert.equal(parsed.provider, provider);
    assert.equal(parsed.mode, mode);
  });
}

test("matcher: empty and * match everything, a broken pattern matches nothing", () => {
  assert.equal(hookMatcherMatches(undefined, "anything"), true);
  assert.equal(hookMatcherMatches("", "anything"), true);
  assert.equal(hookMatcherMatches("*", "anything"), true);
  assert.equal(hookMatcherMatches("invoice|receipt", "Here is your RECEIPT"), true);
  assert.equal(hookMatcherMatches("invoice|receipt", "nothing relevant"), false);
  assert.equal(hookMatcherMatches("(", "("), false);
  assert.equal(hookMatcherMatches(42, "42"), false);
  assert.equal(hookMatcherError("("), "This hook matcher is not a valid pattern.");
  assert.equal(hookMatcherError("x".repeat(201)), "This hook matcher is too long.");
  assert.equal(hookMatcherError("invoice|receipt"), null);
});

const node = JSON.stringify(process.execPath);

test("a hook command receives the event on stdin and its environment", async () => {
  const script =
    "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).event+':'+process.env.BREADBOARD_HOOK_EVENT))";
  const result = await runHookCommand(`${node} -e "${script}"`, { event: "tool.used" }, {
    env: { BREADBOARD_HOOK_EVENT: "tool_used" },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.output.trim(), "tool.used:tool_used");
  assert.equal(describeHookCommandResult(result), "Exit 0");
});

test("a failing hook command reports its exit code and last output", async () => {
  const result = await runHookCommand(
    `${node} -e "console.error('boom');process.exit(3)"`,
    {},
  );
  assert.equal(result.exitCode, 3);
  assert.equal(describeHookCommandResult(result), "Exit 3: boom");
});

test("a hook command that never ends is stopped at its timeout", async () => {
  const result = await runHookCommand(`${node} -e "setInterval(()=>{},1000)"`, {}, {
    timeoutMs: 1_000,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, null);
  assert.equal(describeHookCommandResult(result), "Timed out");
});
