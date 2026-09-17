import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { taskFromMusicProducerCommand, musicProducerUserMessage } from "../src/lib/music-producer/identity.ts";

const file = new URL("../src/app/components/hermes/dashboard-agent-terminal.tsx", import.meta.url);
const source = ts.createSourceFile(file.pathname, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(source) === "useCallback") {
    callbacks.set(node.name.getText(source), node.initializer.arguments[0].getText(source));
  }
  ts.forEachChild(node, visit);
}
visit(source);
function callback(name, scope) {
  assert.ok(callbacks.has(name));
  const code = ts.transpile(`const callback = ${callbacks.get(name)};`, { target: ts.ScriptTarget.ES2022 });
  return new Function(...Object.keys(scope), `${code}; return callback;`)(...Object.values(scope));
}

function fixture({ selected = false, fail = false, launching = false } = {}) {
  const calls = { requests: [], previews: [], saved: [], sent: [], selected: 0 };
  const agent = { id: "music-producer", name: "Music Producer" };
  const scope = {
    crypto, taskFromMusicProducerCommand, musicProducerUserMessage,
    musicProducerAgent: selected ? agent : null,
    launchingMusicProducerRun: launching,
    runtimeUnavailable: false, model: "test-model", reasoningEffort: "medium",
    setLaunchingMusicProducerRun() {}, setAttachmentStatus() {},
    selectMusicProducer: async () => { calls.selected++; return agent; },
    reusableChatAttachments: attachments => attachments,
    videoUseTarget: () => null,
    session: {
      messages: [{ role: "user", content: "/agents:music-producer create me a symphony" }],
      previewExternalAgentTurn: input => { calls.previews.push(input); return input.clientMessageId; },
      ensureConversation: async () => "conv_original",
      appendExternalAgentTurn: async input => { calls.saved.push(input); },
      send: async (...input) => { calls.sent.push(input); },
    },
    fetch: async (url, init) => {
      calls.requests.push({ url, body: JSON.parse(init.body) });
      return fail ? Response.json({ error: "Provider unavailable" }, { status: 503 })
        : Response.json({ run: { runId: "music_new" } }, { status: 201 });
    },
  };
  for (const name of callbacks.keys()) if (name.startsWith("route")) scope[name] = () => false;
  scope.launchMusicProducerRun = callback("launchMusicProducerRun", scope);
  scope.routeMusicProducerCommand = callback("routeMusicProducerCommand", scope);
  return { calls, scope, retry: callback("retryMessage", scope), edit: callback("editMessage", scope) };
}

for (const selected of [false, true]) {
  test(`regenerating a music command uses its runner and original branch (selected=${selected})`, async () => {
    const f = fixture({ selected });
    f.retry(0, "original-branch");
    await new Promise(setImmediate);
    assert.equal(f.calls.sent.length, 0, "Music Producer must never reach ordinary chat dispatch");
    assert.equal(f.calls.requests.length, 1);
    assert.equal(f.calls.selected, selected ? 0 : 1);
    const { url, body } = f.calls.requests[0];
    assert.equal(url, "/api/music-producer/runs");
    assert.equal(body.task, "create me a symphony");
    assert.equal(body.conversationPublicId, "conv_original");
    assert.equal(body.branchGroupId, "original-branch");
    assert.equal(f.calls.previews[0].branchGroupId, body.branchGroupId);
    assert.equal(f.calls.saved[0].branchGroupId, body.branchGroupId);
    assert.equal(f.calls.saved[0].clientMessageId, body.clientMessageId);
    assert.equal(f.calls.saved[0].run.kind, "music_producer");
  });
}

test("editing a music command uses its runner and failed launches retain branch identity", async () => {
  const f = fixture({ fail: true });
  f.edit(0, "/agents:music-producer create a piano sonata", "edited-branch");
  await new Promise(setImmediate);
  assert.equal(f.calls.sent.length, 0);
  assert.equal(f.calls.requests[0].body.task, "create a piano sonata");
  assert.equal(f.calls.saved[0].outcome, "failed");
  assert.equal(f.calls.saved[0].branchGroupId, "edited-branch");
  assert.match(f.calls.saved[0].assistantContent, /Provider unavailable/);
});

test("busy music launchers do not fall through to chat and ordinary retries still use chat", async () => {
  const busy = fixture({ launching: true });
  busy.retry(0, "branch");
  await new Promise(setImmediate);
  assert.equal(busy.calls.sent.length, 0);
  assert.equal(busy.calls.requests.length, 0);
  const ordinary = fixture();
  ordinary.scope.session.messages[0].content = "Explain harmony";
  ordinary.retry(0, "ordinary-branch");
  assert.equal(ordinary.calls.requests.length, 0);
  assert.equal(ordinary.calls.sent[0][0], "Explain harmony");
  assert.equal(ordinary.calls.sent[0][1].branchGroupId, "ordinary-branch");
});
