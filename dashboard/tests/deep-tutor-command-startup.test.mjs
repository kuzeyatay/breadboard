import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import * as identity from "../src/lib/deep-tutor/identity.ts";

// Execute the actual selection, submit branch, and launch handlers. Replace
// React state and the HTTP/persistence boundary, not the command behavior.
function handlers(surface) {
  const file = surface === "terminal"
    ? "../src/app/components/hermes/dashboard-agent-terminal.tsx"
    : "../src/app/gardens/[clusterSlug]/workspace-client.tsx";
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const launch = surface === "terminal" ? "launchDeepTutorRun" : "launchDeepTutor";
  const found = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && ["selectDeepTutor", launch].includes(node.name?.text)) {
      found.set(node.name.text, node.getText(tree));
    }
    if (ts.isVariableDeclaration(node) && ["selectDeepTutor", launch].includes(node.name.getText(tree))) {
      found.set(node.name.getText(tree), `const ${node.getText(tree)};`);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(found.size, 2);
  const start = source.indexOf("const deepTutorTask = taskFromDeepTutorCommand(text);");
  const end = source.indexOf("const meetingNotesTask =", start);
  assert.ok(start > 0 && end > start);
  return `${[...found.values()].join("\n")}
    async function submit(text) { ${source.slice(start, end)} }
    return { submit, selectDeepTutor };`;
}

function fixture(surface, options = {}) {
  const code = handlers(surface);
  const state = { draft: options.draft ?? "/agents:deep-tutor explain convolution", status: "", rows: [], calls: [], attachments: ["existing"] };
  const userContent = identity.deepTutorUserMessage("explain convolution");
  const preview = content => { state.rows = [{ role: "user", content }, { role: "assistant", content: "" }]; };
  const context = {
    ...identity,
    useCallback: callback => callback,
    crypto: { randomUUID },
    deepTutorAgent: null,
    launchingDeepTutorRun: false,
    externalAgentLaunchRef: { current: null },
    model: "test-model",
    reasoningEffort: "medium",
    clusterSlug: "signals",
    clusterName: "Signals",
    textareaRef: { current: { focus() {} } },
    setInput: value => { state.draft = typeof value === "function" ? value(state.draft) : value; },
    setChatAttachments: value => { state.attachments = value; },
    session: {
      previewExternalAgentTurn: turn => { preview(turn.userContent); return turn.clientMessageId; },
      ensureConversation: async () => "conversation-17",
      appendExternalAgentTurn: async turn => {
        state.rows = [{ role: "user", content: turn.userContent }, {
          role: "assistant", content: turn.assistantContent ?? "", outcome: turn.outcome, run: turn.run,
        }];
      },
    },
    prepareExternalAgentSession: async content => {
      preview(content);
      return { session: { id: 17 }, title: "Convolution" };
    },
    commitExternalAgentTurn: async (_session, content, assistant) => {
      state.rows = [{ role: "user", content }, { ...assistant, outcome: assistant.externalAgentOutcome }];
    },
    fetch: async (url, init) => {
      state.calls.push({ url, body: init?.body && JSON.parse(init.body) });
      if (url.includes("/health")) {
        if (options.healthGate) await options.healthGate;
        return { ok: true, json: async () => ({ available: options.available ?? false, reason: "Environment unavailable", scope: { rootCount: 1 } }) };
      }
      assert.equal(url, "/api/deep-tutor/runs");
      assert.equal(state.rows[0]?.content, userContent, "question is visible before requesting the run");
      if (options.runGate) await options.runGate;
      if (options.networkError) throw new Error("Network connection failed");
      return { ok: !options.error, json: async () => options.error
        ? { error: options.error }
        : { run: { runId: "dtrun_test" }, request: { capability: "chat" } } };
    },
  };
  for (const [, name] of code.matchAll(/\b((?:set|clear)[A-Z]\w*)\(/g)) {
    context[name] ??= () => {};
  }
  context.setAttachmentStatus = context.setExternalAgentStatus = value => { state.status = value; };
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const api = new Function(...Object.keys(context), compiled)(...Object.values(context));
  return { ...api, state };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

for (const surface of ["terminal", "garden"]) {
  test(`${surface}: a tutor question appears while startup is pending, even if preflight is unavailable`, async () => {
    let finishRun;
    const runGate = new Promise(resolve => { finishRun = resolve; });
    const app = fixture(surface, { runGate });
    await app.submit(app.state.draft);
    await settle();
    assert.equal(app.state.draft, "");
    assert.equal(app.state.rows[0].content, "/agents:deep-tutor explain convolution");
    assert.deepEqual(app.state.calls.map(call => call.url), ["/api/deep-tutor/runs"]);
    assert.equal(app.state.calls[0].body.task, "explain convolution");
    if (surface === "garden") assert.equal(app.state.calls[0].body.gardenSlug, "signals");
    else assert.equal(app.state.calls[0].body.conversationPublicId, "conversation-17");
    finishRun();
    await settle();
    assert.equal((app.state.rows[1].run ?? app.state.rows[1].deepTutorRun).runId, "dtrun_test");
  });

  for (const failure of [{ error: "Deep Tutor has no Python environment yet." }, { networkError: true }]) {
    test(`${surface}: ${failure.error ? "startup refusal" : "network failure"} keeps the question and a failed response`, async () => {
      const app = fixture(surface, failure);
      await app.submit(app.state.draft);
      await settle();
      assert.equal(app.state.rows[0].content, "/agents:deep-tutor explain convolution");
      assert.equal(app.state.rows[1].outcome, "failed");
      assert.match(app.state.rows[1].content, /The tutoring turn could not start:/);
      assert.match(app.state.rows[1].content, failure.error ? /no Python environment/ : /Network connection failed/);
    });
  }

  test(`${surface}: a bare command that cannot select the tutor remains editable`, async () => {
    const app = fixture(surface, { draft: "/agents:deep-tutor" });
    await app.submit(app.state.draft);
    await settle();
    assert.equal(app.state.draft, "/agents:deep-tutor");
    assert.equal(app.state.status, "Environment unavailable");
    assert.equal(app.state.rows.length, 0);
    assert.equal(app.state.calls.length, 1);
    assert.match(app.state.calls[0].url, /\/health/);
    assert.deepEqual(app.state.attachments, ["existing"]);
  });

  test(`${surface}: successful bare selection preserves text typed during the health check`, async () => {
    let finishHealth;
    const healthGate = new Promise(resolve => { finishHealth = resolve; });
    const app = fixture(surface, { draft: "/agents:deep-tutor", available: true, healthGate });
    await app.submit(app.state.draft);
    app.state.draft = "My next question";
    finishHealth();
    await settle();
    assert.equal(app.state.draft, "My next question");
    assert.equal(app.state.rows.length, 0);
  });
}
