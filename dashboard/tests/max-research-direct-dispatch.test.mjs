// Exercise the real routing callbacks and launcher with transport stubbed. A
// model's willingness to delegate must not decide an explicit user selection.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import {
  MAX_RESEARCH_COMMAND,
  maxResearchInvocation,
  maxResearchUserMessage,
} from "../src/lib/max-research/identity.ts";

const prompt = "I want you to do max research on how to improve... cognitive ability of one";
const question = "how to improve... cognitive ability of one";
const read = (file) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
function compile(code, scope, result) {
  const compiled = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function("exports", ...Object.keys(scope), `${compiled}\nreturn ${result};`)(
    {}, ...Object.values(scope),
  );
}
function declaration(file, name) {
  const tree = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name?.getText(tree) === name) {
      found = ts.isVariableDeclaration(node) ? `const ${node.getText(tree)};` : node.getText(tree);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(found, `${file}: ${name}`);
  return found;
}

for (const file of ["garden-agent-chat.tsx", "dashboard-agent-terminal.tsx"]) {
  for (const superAgent of [false, true]) {
    test(`${file}: natural-language requests stay private in Super Agent mode`, async () => {
      const launches = [];
      const capture = async (input) => { launches.push(input); };
      const route = compile(declaration(`app/components/hermes/${file}`, "routeMaxResearchCommand"), {
        useCallback: (callback) => callback,
        maxResearchInvocation,
        isSuperAgentEnabled: () => superAgent,
        maxResearchDispatchingRef: { current: false },
        launchMaxResearchTurn: capture,
        launchMaxResearchRun: async (task, options) => capture({ question: task, ...options }),
        session: {}, model: "test-model", reasoningEffort: "high",
        setAttachmentStatus: () => {}, setResearchNotice: () => {},
      }, "routeMaxResearchCommand");
      assert.equal(
        route(prompt),
        !superAgent,
        superAgent
          ? "Super Agent must receive natural-language research requests"
          : "the ordinary model dispatcher must not receive this request",
      );
      await Promise.resolve();
      assert.equal(launches.length, superAgent ? 0 : 1);
      if (!superAgent) {
        assert.equal(launches[0].question, question);
        assert.equal(launches[0].userContent, prompt);
      }
      assert.equal(route("was max research called on this prompt, if not, why"), false);
      assert.equal(
        launches.length,
        superAgent ? 0 : 1,
        "a question about the feature must not launch another run",
      );

      if (superAgent) {
        assert.equal(
          route(`${MAX_RESEARCH_COMMAND} ${question}`),
          true,
          "the typed slash command remains an explicit visible launch",
        );
        await Promise.resolve();
        assert.equal(launches.length, 1);
        assert.equal(launches[0].question, question);
      }
    });
  }
}

test("a fresh explicit request gets a new run identity after an earlier launch failure", async () => {
  const requests = [];
  const turns = [];
  const launcher = compile(declaration("app/components/hermes/launch-max-research.ts", "launchMaxResearchTurn"), {
    maxResearchUserMessage,
    fetch: async (url, options) => {
      requests.push({ url, ...options, body: JSON.parse(options.body) });
      return requests.length === 1
        ? new Response(JSON.stringify({ error: "checkpoint unavailable" }), { status: 500 })
        : new Response(JSON.stringify({ run: { runId: "new-research-job" } }));
    },
  }, "launchMaxResearchTurn");
  const session = {
    previewExternalAgentTurn: ({ clientMessageId }) => clientMessageId,
    ensureConversation: async () => "conv_existing_failed_research",
    appendExternalAgentTurn: async (turn) => { turns.push(turn); },
  };
  const input = { session, question, userContent: prompt, model: "test-model", reasoningEffort: "high" };
  await launcher(input);
  assert.equal(turns[0].outcome, "failed");
  assert.equal(requests.length, 1, "a failure must not silently relaunch or substitute another workflow");
  await launcher(input);
  assert.equal(requests.length, 2);
  assert.notEqual(requests[0].body.clientMessageId, requests[1].body.clientMessageId);
  assert.deepEqual(turns[1].run, { kind: "max_research", runId: "new-research-job", query: question });
  for (const request of requests) {
    assert.equal(request.url, "/api/max-research/runs");
    assert.equal(request.keepalive, true);
    assert.equal(request.body.conversationId, "conv_existing_failed_research");
    assert.equal(request.body.userContent, prompt);
  }
});

test("the main Garden send exits through Max Research before ordinary model dispatch", async () => {
  const file = "app/gardens/[clusterSlug]/workspace-client.tsx";
  const tree = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let routing;
  function visit(node) {
    if (ts.isBlock(node)) {
      const index = node.statements.findIndex((statement) => ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some((item) => item.name.getText(tree) === "maxResearch"));
      if (index >= 0) routing = node.statements.slice(index, index + 2).map((statement) => statement.getText(tree)).join("\n");
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(routing);
  const launches = [];
  const route = compile(`async function route(text, superAgentEnabled) { ${routing}\nreturn "model"; }`, {
    maxResearchInvocation,
    setInput: () => {}, setChatAttachments: () => {},
    launchMaxResearch: async (...args) => { launches.push(args); },
  }, "route");
  assert.equal(await route(prompt, false), undefined);
  assert.deepEqual(launches.at(-1), [question, prompt]);
  assert.equal(await route(prompt, true), "model");
  assert.equal(launches.length, 1);
  for (const enabled of [false, true]) {
    assert.equal(await route("what is max research?", enabled), "model");
  }
  assert.equal(launches.length, 1);
});
