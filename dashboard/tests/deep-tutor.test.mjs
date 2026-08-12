import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const identity = await import("../src/lib/deep-tutor/identity.ts");
const runtime = await import("../src/lib/deep-tutor/runtime.ts");
const materials = await import("../src/lib/deep-tutor/materials.ts");
const home = await import("../src/lib/deep-tutor/home.ts");
const knowledgeBase = await import("../src/lib/deep-tutor/knowledge-base.ts");
const defaults = await import("../src/lib/agent-settings/defaults.ts");
const catalog = await import("../src/lib/agent-settings/catalog.ts");
const combinations = await import("../src/lib/hermes/capability-combinations.ts");
const externalRuns = await import("../src/lib/conversations/external-agent-runs.ts");

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(dashboardRoot, "..");
const source = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
const repoSource = (relative) => fs.readFileSync(path.join(repositoryRoot, relative), "utf8");

function scratch(name) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `deep-tutor-${name}-`));
  return fs.realpathSync(directory);
}

// ---------------------------------------------------------------- identity --

test("Deep Tutor has one canonical slash command", () => {
  assert.equal(identity.DEEP_TUTOR_COMMAND, "/agents:deep-tutor");
  assert.equal(
    identity.deepTutorUserMessage("explain the convolution sum"),
    "/agents:deep-tutor explain the convolution sum",
  );
  assert.equal(
    identity.taskFromDeepTutorCommand("  /AGENTS:DEEP-TUTOR  what is aliasing"),
    "what is aliasing",
  );
  assert.equal(identity.taskFromDeepTutorCommand("/agents:deep-tutor"), "");
  assert.equal(identity.taskFromDeepTutorCommand("/agents:deep-research something"), null);
});

test("inline flags choose the capability and never leak into the question", () => {
  const request = identity.parseTutorRequest("solve 3x + 2 = 11 --solve --web --count 8 --lang nl");
  assert.equal(request.message, "solve 3x + 2 = 11");
  assert.equal(request.capability, "deep_solve");
  assert.deepEqual(request.tools, ["web_search"]);
  assert.equal(request.questionCount, 8);
  assert.equal(request.language, "nl");
});

test("every capability is reachable, by word and by --cap", () => {
  const byWord = {
    "--quiz": "deep_question",
    "--research": "deep_research",
    "--visualize": "visualize",
    "--animate": "math_animator",
    "--mastery": "mastery_path",
    "--explain": "chat",
  };
  for (const [flag, capability] of Object.entries(byWord)) {
    assert.equal(identity.parseTutorRequest(`fourier ${flag}`).capability, capability, flag);
  }
  assert.equal(
    identity.parseTutorRequest("fourier --cap math_animator").capability,
    "math_animator",
  );
  // An unknown capability is ignored rather than passed to the clone, which
  // would fail the turn at the far end of a subprocess.
  assert.equal(identity.parseTutorRequest("fourier --cap teleport").capability, "chat");
  assert.equal(identity.parseTutorRequest("fourier --cap teleport").message, "fourier");
});

test("a flag in the message beats the stored default", () => {
  const stored = { capability: "deep_question", useMaterial: true, questionCount: 5 };
  assert.equal(identity.parseTutorRequest("integrals", stored).capability, "deep_question");
  assert.equal(identity.parseTutorRequest("integrals --solve", stored).capability, "deep_solve");
  assert.equal(identity.parseTutorRequest("integrals", stored).useMaterial, true);
  assert.equal(identity.parseTutorRequest("integrals --no-material", stored).useMaterial, false);
});

test("question count is clamped rather than trusted", () => {
  assert.equal(identity.parseTutorRequest("x --count 99").questionCount, 20);
  assert.equal(identity.parseTutorRequest("x --count 0").questionCount, 1);
});

test("the run label names the mode and the subject", () => {
  const request = identity.parseTutorRequest("explain the discrete convolution sum --solve");
  assert.equal(identity.tutorRunLabel(request), "Deep solve · explain the discrete convolution sum");
});

// ----------------------------------------------------------------- settings --

test("stored settings translate into a tutoring request", () => {
  const values = {
    capability: "deep_question",
    material: false,
    questions: 9,
    web: true,
    papers: true,
    language: "de",
  };
  const result = defaults.deepTutorDefaults(values);
  assert.equal(result.capability, "deep_question");
  assert.equal(result.useMaterial, false);
  assert.equal(result.questionCount, 9);
  assert.deepEqual(result.tools, ["web_search", "paper_search"]);
  assert.equal(result.language, "de");
  // An empty language box means English, not "no language".
  assert.equal(defaults.deepTutorDefaults({}).language, "en");
});

test("the settings catalog lists Deep Tutor with the flags that override it", () => {
  const agent = catalog.findConfigurableAgent("deep-tutor");
  assert.ok(agent, "Deep Tutor should be configurable");
  assert.equal(agent.command, identity.DEEP_TUTOR_COMMAND);
  const keys = agent.fields.map((field) => field.key).sort();
  assert.deepEqual(keys, ["capability", "language", "material", "papers", "questions", "web"]);
  for (const field of agent.fields) {
    assert.ok(field.flag, `${field.key} should document its overriding flag`);
  }
  // Every capability offered in the settings must be one the clone accepts.
  const offered = agent.fields.find((field) => field.key === "capability");
  for (const option of offered.options) {
    assert.ok(
      identity.TUTOR_CAPABILITIES.includes(option.value),
      `${option.value} is not a DeepTutor capability`,
    );
  }
});

// ------------------------------------------------------------- combinations --

test("Deep Tutor runs on both chat surfaces and takes the turn alone", () => {
  const profile = combinations.runtimeAgentById("deep-tutor");
  assert.ok(profile);
  assert.deepEqual([...profile.surfaces].sort(), ["dashboard_terminal", "garden_chat"]);
  assert.equal(
    combinations.findCapabilityConflict({
      text: "/agents:deep-tutor explain aliasing",
      surface: "garden_chat",
    }),
    null,
  );
  const clash = combinations.findCapabilityConflict({
    text: "/agents:deep-tutor /agents:get-doc explain aliasing",
    surface: "garden_chat",
  });
  assert.equal(clash?.code, "conflicting_runtime_agents");
});

// ------------------------------------------------------------- persistence --

test("a Deep Tutor turn survives a reload", () => {
  assert.ok(externalRuns.EXTERNAL_AGENT_RUN_KINDS.includes("deep_tutor"));
  assert.equal(externalRuns.EXTERNAL_AGENT_RUN_FIELD_BY_KIND.deep_tutor, "deepTutorRun");
  const parsed = externalRuns.parseExternalAgentRun({
    kind: "deep_tutor",
    runId: "dtrun_1",
    task: "explain aliasing",
    capability: "chat",
  });
  assert.deepEqual(parsed, {
    kind: "deep_tutor",
    runId: "dtrun_1",
    task: "explain aliasing",
    capability: "chat",
  });
  // A descriptor missing its capability is refused rather than half-restored.
  assert.equal(
    externalRuns.parseExternalAgentRun({ kind: "deep_tutor", runId: "r", task: "t" }),
    null,
  );
  const fields = externalRuns.externalAgentMessageFields({
    externalAgent: true,
    externalAgentRun: parsed,
    externalAgentOutcome: "completed",
  });
  assert.deepEqual(fields.deepTutorRun, {
    runId: "dtrun_1",
    task: "explain aliasing",
    capability: "chat",
  });
  assert.equal(
    externalRuns.assistantExternalAgentRunId({
      role: "assistant",
      deepTutorRun: { runId: "dtrun_1" },
    }),
    "dtrun_1",
  );
});

// ---------------------------------------------------------------- materials --

test("a Garden scope reaches that Garden and nothing else", (t) => {
  const content = scratch("content");
  fs.mkdirSync(path.join(content, "signals", "notes"), { recursive: true });
  fs.writeFileSync(path.join(content, "signals", "aliasing.md"), "# Aliasing\n", "utf8");
  fs.mkdirSync(path.join(content, "other-garden"), { recursive: true });
  const previous = process.env.QUARTZ_CONTENT_PATH;
  process.env.QUARTZ_CONTENT_PATH = content;
  t.after(() => {
    if (previous === undefined) delete process.env.QUARTZ_CONTENT_PATH;
    else process.env.QUARTZ_CONTENT_PATH = previous;
    fs.rmSync(content, { recursive: true, force: true });
  });

  const scope = materials.resolveScope({
    userId: 1,
    surface: "garden_chat",
    clusterSlug: "signals",
    gardenName: "Signals",
  });
  assert.equal(scope.kind, "garden");
  assert.equal(scope.id, "garden-signals");
  assert.deepEqual(scope.roots, [path.join(content, "signals")]);
  assert.match(scope.summary, /Signals/);

  // A slug that tries to climb out of the content root resolves to nothing.
  const escaped = materials.resolveScope({
    userId: 1,
    surface: "garden_chat",
    clusterSlug: "../..",
  });
  assert.deepEqual(escaped.roots, []);
  assert.match(escaped.summary, /no files on disk/);
});

test("a Garden with no directory yet keeps its own scope instead of widening", (t) => {
  const content = scratch("empty-content");
  const previous = process.env.QUARTZ_CONTENT_PATH;
  process.env.QUARTZ_CONTENT_PATH = content;
  t.after(() => {
    if (previous === undefined) delete process.env.QUARTZ_CONTENT_PATH;
    else process.env.QUARTZ_CONTENT_PATH = previous;
    fs.rmSync(content, { recursive: true, force: true });
  });
  const scope = materials.resolveScope({
    userId: 1,
    surface: "garden_chat",
    clusterSlug: "brand-new",
  });
  assert.equal(scope.kind, "garden");
  assert.deepEqual(scope.roots, []);
});

test("the Terminal scope is the whole workspace", () => {
  const scope = materials.resolveScope({ userId: 1, surface: "dashboard_terminal" });
  assert.equal(scope.kind, "workspace");
  assert.equal(scope.id, "workspace");
  assert.ok(scope.roots.length >= 1);
  assert.equal(scope.roots[0], fs.realpathSync(repositoryRoot));
});

test("eager material favours files the question names, and stays inside the budget", (t) => {
  const content = scratch("eager");
  const garden = path.join(content, "signals");
  fs.mkdirSync(path.join(garden, "notes"), { recursive: true });
  fs.writeFileSync(path.join(garden, "aliasing-and-folding.md"), "# Aliasing\nfolding\n", "utf8");
  fs.writeFileSync(path.join(garden, "notes", "fourier-series.md"), "# Fourier\n", "utf8");
  fs.writeFileSync(path.join(garden, "unrelated-topic.md"), "# Something else\n", "utf8");
  fs.writeFileSync(path.join(garden, "binary.png"), "not text", "utf8");
  const previous = process.env.QUARTZ_CONTENT_PATH;
  process.env.QUARTZ_CONTENT_PATH = content;
  t.after(() => {
    if (previous === undefined) delete process.env.QUARTZ_CONTENT_PATH;
    else process.env.QUARTZ_CONTENT_PATH = previous;
    fs.rmSync(content, { recursive: true, force: true });
  });

  const scope = materials.resolveScope({
    userId: 1,
    surface: "garden_chat",
    clusterSlug: "signals",
  });
  const picked = materials.selectEagerMaterial(scope, "explain aliasing to me");
  assert.ok(picked.length > 0);
  assert.equal(picked[0].filename, "aliasing-and-folding.md");
  // An image is not something the extractor can read as text.
  assert.ok(!picked.some((item) => item.filename.endsWith(".png")));
  // Paths are absolute for the bridge, names are relative for the reader.
  assert.ok(path.isAbsolute(picked[0].path));

  const capped = materials.selectEagerMaterial(scope, "explain aliasing to me", { maxFiles: 1 });
  assert.equal(capped.length, 1);
});

test("the Terminal never eagerly loads the workspace", () => {
  const scope = materials.resolveScope({ userId: 1, surface: "dashboard_terminal" });
  assert.deepEqual(materials.selectEagerMaterial(scope, "explain this repository"), []);
});

// ------------------------------------------------------------------ runtime --

test("the clone and both Breadboard-owned scripts are where the runtime looks", () => {
  const resolved = runtime.resolveDeepTutorRoot();
  assert.ok(resolved, "the DeepTutor clone should be found next to the dashboard");
  assert.ok(runtime.isClone(resolved.root));
  assert.ok(runtime.bridgeScriptPath(), "the turn bridge should be in scripts/");
  assert.ok(runtime.fileServerScriptPath(), "the file server should be in scripts/");
  assert.equal(runtime.isClone(repositoryRoot), false);
});

test("spawned processes get a UTF-8 Python and behave as Node under Electron", () => {
  const env = runtime.deepTutorEnv({ DEEPTUTOR_HOME: "/tmp/home" }, { PATH: "/usr/bin" });
  assert.equal(env.PYTHONUTF8, "1");
  assert.equal(env.PYTHONIOENCODING, "utf-8");
  assert.equal(env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(env.DEEPTUTOR_HOME, "/tmp/home");
});

// ------------------------------------------------------- the file server ----

test("the MCP file server refuses to leave its roots", () => {
  const server = repoSource("scripts/deeptutor-files-mcp.mjs");
  // Containment is compared on the real path, so a symlink cannot be used to
  // step outside a root.
  assert.match(server, /realpathSync/);
  assert.match(server, /That path is outside/);
  // Read-only: there is no tool that writes.
  assert.ok(!/writeFileSync|rmSync|unlinkSync|mkdirSync/.test(server));
  for (const tool of ["list_materials", "read_material", "search_materials"]) {
    assert.match(server, new RegExp(`name: "${tool}"`));
  }
});

test("the bridge never invents a scope of its own", () => {
  const bridge = repoSource("scripts/deeptutor-bridge.py");
  // Roots reach the tutor through the generated mcp.json, never through the
  // job payload — a message must not be able to widen what it may read.
  assert.ok(!/job\.get\(\s*["']roots/.test(bridge));
  assert.ok(!/BREADBOARD_TUTOR_ROOTS/.test(bridge));
  assert.match(bridge, /DEEPTUTOR_HOME/);
  // ask_user is answered rather than left hanging: nobody is at the keyboard.
  assert.match(bridge, /submit_user_reply/);
});

// ------------------------------------------------------------------ wiring --

test("both chat surfaces can launch and render a tutoring turn", () => {
  const terminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");
  assert.match(terminal, /taskFromDeepTutorCommand/);
  assert.match(terminal, /\/api\/deep-tutor\/runs/);
  // The Terminal deliberately sends no gardenSlug: that is what scopes it to
  // the workspace rather than to one Garden.
  assert.ok(!/deep-tutor\/runs[\s\S]{0,400}gardenSlug/.test(terminal));

  const garden = source("src/app/gardens/[clusterSlug]/workspace-client.tsx");
  assert.match(garden, /taskFromDeepTutorCommand/);
  assert.match(garden, /gardenSlug: clusterSlug/);
  assert.match(garden, /InlineDeepTutorRun/);

  const panel = source("src/app/components/hermes/agent-runtime-panel.tsx");
  assert.match(panel, /InlineDeepTutorRun/);

  const hub = source("src/app/components/hermes/command-hub.tsx");
  assert.match(hub, /deep-tutor-entry/);
  assert.match(hub, /DEEP_TUTOR_COMMAND/);
});

test("the run route refuses a Garden the user does not own", () => {
  const route = source("src/app/api/deep-tutor/runs/route.ts");
  assert.match(route, /garden_not_yours/);
  assert.match(route, /garden_not_found/);
  // Ownership is checked server-side, from the slug, before any scope resolves.
  assert.match(route, /requireOwnGarden/);
});

// ------------------------------------------------------ knowledge bases ----

test("only a Garden gets a knowledge base", (t) => {
  const content = scratch("kb-scope");
  fs.mkdirSync(path.join(content, "signals"), { recursive: true });
  const previous = process.env.QUARTZ_CONTENT_PATH;
  process.env.QUARTZ_CONTENT_PATH = content;
  t.after(() => {
    if (previous === undefined) delete process.env.QUARTZ_CONTENT_PATH;
    else process.env.QUARTZ_CONTENT_PATH = previous;
    fs.rmSync(content, { recursive: true, force: true });
  });

  const garden = materials.resolveScope({
    userId: 1,
    surface: "garden_chat",
    clusterSlug: "signals",
  });
  assert.equal(knowledgeBase.knowledgeBaseName(garden), "garden-signals");

  // The Terminal's scope is a whole workspace of mostly code: indexing it would
  // cost a great deal and retrieve mostly noise, so there is no KB at all.
  const workspace = materials.resolveScope({ userId: 1, surface: "dashboard_terminal" });
  assert.equal(knowledgeBase.knowledgeBaseName(workspace), null);
  assert.equal(knowledgeBase.indexState(1, workspace).phase, "unsupported");
  assert.equal(knowledgeBase.knowledgeBaseForTurn(1, workspace), null);
});

test("an index is only used when it matches the files on disk", (t) => {
  const content = scratch("kb-fresh");
  const garden = path.join(content, "signals");
  fs.mkdirSync(garden, { recursive: true });
  const note = path.join(garden, "aliasing.md");
  fs.writeFileSync(note, "# Aliasing\n", "utf8");
  const homes = scratch("kb-home");
  const previousContent = process.env.QUARTZ_CONTENT_PATH;
  const previousHome = process.env.DEEP_TUTOR_HOME_ROOT;
  process.env.QUARTZ_CONTENT_PATH = content;
  process.env.DEEP_TUTOR_HOME_ROOT = homes;
  t.after(() => {
    if (previousContent === undefined) delete process.env.QUARTZ_CONTENT_PATH;
    else process.env.QUARTZ_CONTENT_PATH = previousContent;
    if (previousHome === undefined) delete process.env.DEEP_TUTOR_HOME_ROOT;
    else process.env.DEEP_TUTOR_HOME_ROOT = previousHome;
    fs.rmSync(content, { recursive: true, force: true });
    fs.rmSync(homes, { recursive: true, force: true });
  });

  const scope = materials.resolveScope({
    userId: 5,
    surface: "garden_chat",
    clusterSlug: "signals",
  });
  assert.equal(knowledgeBase.indexState(5, scope).phase, "missing");
  assert.equal(knowledgeBase.knowledgeBaseForTurn(5, scope), null);

  // Stand in for a finished build by writing the manifest a build would write.
  const documents = knowledgeBase.indexableDocuments(scope);
  assert.equal(documents.length, 1);
  const manifestFile = path.join(home.deepTutorHome(5, scope.id), "breadboard-index.json");
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
  const manifest = {
    kb: "garden-signals",
    fingerprint: home.embeddingFingerprint(),
    builtAt: new Date().toISOString(),
    documents,
    documentCount: 1,
    chunkCount: 12,
  };
  fs.writeFileSync(manifestFile, JSON.stringify(manifest), "utf8");
  assert.equal(knowledgeBase.indexState(5, scope).phase, "ready");
  assert.equal(knowledgeBase.knowledgeBaseForTurn(5, scope), "garden-signals");

  // Editing a note makes the index stale, and a stale index is never used: a
  // tutor retrieving confidently from what a note no longer says is worse than
  // one that reads the file.
  fs.writeFileSync(note, "# Aliasing\n\nMore words.\n", "utf8");
  assert.equal(knowledgeBase.indexState(5, scope).phase, "stale");
  assert.equal(knowledgeBase.knowledgeBaseForTurn(5, scope), null);

  // A different embedding model invalidates it too — vectors from two models
  // are not comparable, so the old index is meaningless rather than merely old.
  fs.writeFileSync(
    manifestFile,
    JSON.stringify({
      ...manifest,
      fingerprint: "some-other-model@1536",
      documents: knowledgeBase.indexableDocuments(scope),
    }),
    "utf8",
  );
  assert.equal(knowledgeBase.indexState(5, scope).phase, "stale");
});

test("indexing takes the file kinds DeepTutor can parse, and skips the rest", (t) => {
  const content = scratch("kb-kinds");
  const garden = path.join(content, "signals");
  fs.mkdirSync(path.join(garden, "assets"), { recursive: true });
  fs.writeFileSync(path.join(garden, "note.md"), "# Note\n", "utf8");
  fs.writeFileSync(path.join(garden, "paper.pdf"), "%PDF-1.4 stub", "utf8");
  fs.writeFileSync(path.join(garden, "assets", "diagram.png"), "not text", "utf8");
  fs.writeFileSync(path.join(garden, "empty.md"), "", "utf8");
  const previous = process.env.QUARTZ_CONTENT_PATH;
  process.env.QUARTZ_CONTENT_PATH = content;
  t.after(() => {
    if (previous === undefined) delete process.env.QUARTZ_CONTENT_PATH;
    else process.env.QUARTZ_CONTENT_PATH = previous;
    fs.rmSync(content, { recursive: true, force: true });
  });

  const scope = materials.resolveScope({
    userId: 1,
    surface: "garden_chat",
    clusterSlug: "signals",
  });
  const names = knowledgeBase.indexableDocuments(scope).map((item) => path.basename(item.path));
  assert.deepEqual(names.sort(), ["note.md", "paper.pdf"]);
});

test("the indexer rebuilds rather than appending", () => {
  const indexer = repoSource("scripts/deeptutor-index.py");
  // DeepTutor can add documents to a live KB but cannot remove one, so an
  // incremental index would keep citing notes the learner deleted.
  assert.match(indexer, /delete_knowledge_base/);
  assert.match(indexer, /initialize_knowledge_base/);
  assert.match(indexer, /DEEPTUTOR_HOME/);
});

// ----------------------------------------------------------- embeddings ----

test("the tutor's embedding service points at ChatMock's own endpoint", (t) => {
  const homes = scratch("embed-home");
  const previousHome = process.env.DEEP_TUTOR_HOME_ROOT;
  process.env.DEEP_TUTOR_HOME_ROOT = homes;
  t.after(() => {
    if (previousHome === undefined) delete process.env.DEEP_TUTOR_HOME_ROOT;
    else process.env.DEEP_TUTOR_HOME_ROOT = previousHome;
    fs.rmSync(homes, { recursive: true, force: true });
  });

  const scope = { kind: "garden", id: "garden-test", label: "Test", roots: [], summary: "" };
  const provisioned = home.provisionHome({
    userId: 3,
    scope,
    baseUrl: "http://127.0.0.1:8765/v1",
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
    apiKey: "local",
    language: "en",
  });
  const catalog = JSON.parse(
    fs.readFileSync(path.join(provisioned.settingsDirectory, "model_catalog.json"), "utf8"),
  );
  const profile = catalog.services.embedding.profiles[0];
  // The adapter posts to this URL verbatim — no path is appended — so it has
  // to be the whole endpoint rather than a base.
  assert.equal(profile.base_url, "http://127.0.0.1:8765/v1/embeddings");
  assert.equal(profile.binding, "custom");
  assert.equal(profile.models[0].model, home.EMBEDDING_MODEL);
  assert.equal(profile.models[0].dimension, String(home.EMBEDDING_DIMENSION));
  // Writing the embedding service must not lose the chat one.
  assert.equal(catalog.services.llm.profiles[0].models[0].model, "gpt-5.6-sol");
});

test("ChatMock embeds without a key and never offers a vector model as a chat model", () => {
  const engine = repoSource("chatmock/chatmock/embeddings.py");
  const routes = repoSource("chatmock/chatmock/routes_embeddings.py");
  const app = repoSource("chatmock/chatmock/app.py");
  // The local backend is what makes this work with no provider configured.
  assert.match(engine, /def embed_local/);
  assert.match(engine, /def embed_remote/);
  assert.match(engine, /bge-small-en-v1\.5/);
  // The ChatGPT upstream has no embeddings endpoint; saying so beats a 404.
  assert.match(engine, /has no embeddings endpoint/);
  assert.match(routes, /\/v1\/embeddings/);
  assert.match(app, /register_blueprint\(embeddings_bp\)/);
  // Embedding models must stay out of /v1/models, which feeds the chat pickers.
  assert.ok(!/embedding/i.test(repoSource("chatmock/chatmock/routes_openai.py")));
});

test("a tutoring turn puts the learner's question before any preamble", () => {
  const manager = source("src/lib/deep-tutor/run-manager.ts");
  // DeepTutor retrieves over the whole user message before the model gets a
  // turn, so a preamble on top makes the opening query mostly boilerplate.
  assert.match(manager, /return `\$\{run\.request\.message\}\\n\\n---/);
  // Only a genuinely current index is ever named on a turn.
  assert.match(manager, /knowledgeBaseForTurn/);
  assert.match(manager, /ensureIndex/);
});
