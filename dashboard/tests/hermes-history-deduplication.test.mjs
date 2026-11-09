import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { composeRecentConversationContext, RECENT_CONTEXT_LIMIT } from "../src/lib/conversations/recent-context.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const python = process.env.HERMES_PYTHON || path.join(root, "hermes-agent", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const driver = [
  "import importlib.util,json,sys",
  "spec=importlib.util.spec_from_file_location('history_context',sys.argv[1])",
  "module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)",
  "requests=json.load(sys.stdin)",
  "print(json.dumps([(module.deduplicate_history(r) or {'request':r})['request'] for r in requests]))",
].join("\n");

function project(requests) {
  assert.ok(fs.existsSync(python), `Hermes Python must be available: ${python}`);
  return JSON.parse(execFileSync(python, ["-X", "utf8", "-c", driver, path.join(root, "hermes-agent/plugins/breadboard/history_context.py")], {
    input: JSON.stringify(requests), encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 8_000_000,
  }));
}

const answer = "The blue valve opens at 42 kPa. Keep the red valve closed. 🙂\n".repeat(100);
const canonical = [
  { role: "user", surface: "garden_chat", content: "Use the manual; do not guess missing values.", status: "complete" },
  { role: "assistant", surface: "garden_chat", content: answer, status: "complete" },
];
function wire(history, framed = true) {
  const context = composeRecentConversationContext(canonical, text => text, RECENT_CONTEXT_LIMIT, framed);
  return { model: "selected-model", reasoning_effort: "high", tools: [{ name: "garden_get_source_excerpt" }],
    messages: [{ role: "system", content: "Standing permissions.\n# recent_exact_conversation_messages\n" + context + "\nArtifact delivery rules." },
      ...history, { role: "user", content: "Explain that pressure threshold and keep its units." }] };
}

test("real TypeScript context reaches Python middleware without losing source, authority or tools", () => {
  const history = canonical.map(({ role, content }) => ({ role, content }));
  const original = wire(history);
  const [deduplicated] = project([original]);
  assert.deepEqual(deduplicated.messages.slice(1), original.messages.slice(1));
  assert.deepEqual(deduplicated.tools, original.tools);
  assert.equal(deduplicated.reasoning_effort, original.reasoning_effort);
  assert.ok(!deduplicated.messages[0].content.includes(answer));
  assert.ok(deduplicated.messages[2].content.includes(answer));
  assert.match(deduplicated.messages[0].content, /Standing permissions/);
  assert.match(deduplicated.messages[0].content, /Artifact delivery rules/);
  assert.ok(JSON.stringify(deduplicated).length < JSON.stringify(wire(history, false)).length - 5_000);
});

test("restart, compression, edited answer and wrong branch retain the exact published answer", () => {
  const variants = [[], [{ role: "user", content: "Compacted summary: discussed a valve." }],
    [{ role: "assistant", content: answer.replaceAll("42", "24") }],
    [{ role: "assistant", content: "This is a different branch." }]];
  for (const result of project(variants.map(history => wire(history)))) {
    assert.ok(result.messages[0].content.includes(answer));
    assert.doesNotMatch(result.messages[0].content, /breadboard:recent-history|<!-- message /);
  }
});

test("framed context stays within the same budget and malformed truncation keeps all available bytes", () => {
  const large = Array.from({ length: 15 }, (_, n) => ({ role: "assistant", surface: "garden_chat", content: `${n} ` + "🙂".repeat(40_000) }));
  const context = composeRecentConversationContext(large, text => text, RECENT_CONTEXT_LIMIT, true);
  assert.ok(context.length <= RECENT_CONTEXT_LIMIT);
  assert.equal(context.isWellFormed(), true);
  const broken = { messages: [{ role: "system", content: context.slice(0, 500) }, { role: "user", content: "Continue." }] };
  assert.deepEqual(project([broken])[0], broken);
});

test("inline scope notes and unsynthesized worker results survive projection", () => {
  const messages = [
    ...canonical,
    { role: "user", surface: "garden_chat", content: "Why?", metadata: JSON.stringify({ inlineSelection: { requestId: "inline", highlightId: "selection" }, selectedText: "42 kPa" }) },
    { role: "assistant", surface: "garden_chat", content: "Worker findings remain needed. ".repeat(40), metadata: JSON.stringify({ delegatedAgentRun: true, externalAgentResult: "Original source findings." }) },
  ];
  const context = composeRecentConversationContext(messages, text => text, RECENT_CONTEXT_LIMIT, true);
  const request = wire(canonical.map(({ role, content }) => ({ role, content })));
  request.messages[0].content = context;
  const [result] = project([request]);
  assert.match(result.messages[0].content, /Ask here: a side question/);
  assert.match(result.messages[0].content, /42 kPa/);
  assert.match(result.messages[0].content, /Worker findings remain needed/);
});
