import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";

const dashboard = path.resolve(import.meta.dirname, "..");

// Exercise the HTTP tool handler, two persisted chat sessions, session-scoped
// decisions, SQLite connection registry, production broker and actual stdio
// process. The service lease fixture replaces the native supervisor only.
async function harness() {
  const fixture = {
    "next/server": "export const NextResponse = Response; export const after = () => {};",
    "next/cache": "export const revalidatePath = () => {};",
    "server-only": "",
    "../office/quartz-mirror.ts": "export const scheduleOfficeMirrors = () => {};",
    "@/lib/server-auth": "export const requireUserId = async () => 81; export const requireReadableCluster = () => { throw Error('Unexpected PDF lookup'); }; export const routeErrorResponse = () => Response.error();",
    "hook-target": "export const dispatchHook=(hook, payload)=>globalThis.__sentStars.push({ id: hook.id, payload });",
    "../composio/client.ts": "export const composioConfigured = () => false",
    "../api-anything/service.ts": "export const API_ANYTHING_CONNECTION='api-anything'; export const apiAnythingRegistry=()=>({tools:{},toolCount:0,connectionNames:[],systemContext:''});",
  };
  const bundle = await build({
    stdin: { contents: `
      export { POST } from './src/app/api/hermes/tools/mcp/route.ts';
      export { POST as manageBot } from './src/app/api/hermes/tools/bot-manage/route.ts';
      export { GET as botsPage, POST as startBotChat } from './src/app/api/bots/route.ts';
      export { botTurnPersona } from './src/lib/bots/team.ts';
      export { connectedAppRegistryForTurn } from './src/lib/hermes/unified-tool-registry.ts';
      export { composeHermesSystemPrompt } from './src/lib/hermes/system-prompts.ts';
      export * as proxy from './src/lib/agent-runtime/mcp-proxy.ts';
      export { default as db } from './src/lib/db.ts';
      export { createConversation, appendConversationAssistantMessage } from './src/lib/conversations/store.ts';
      export { PUT as starMessage } from './src/app/api/starred-messages/route.ts';
      export { createHook } from './src/lib/hooks/store.ts';
      export { gadgetBindingHandler } from './src/lib/hermes/gadget-bindings.ts';
      export { pendingAuthoredSkills, requireAuthoredSkillOwner } from './src/lib/hermes/stage-authored-skill.ts';
      export { POST as reviewSkill } from './src/app/api/hermes/skills/promote/route.ts';
      export { getSkillsCatalogStore } from './src/lib/hermes/skills-catalog-store.ts';
      export { gardenFiles } from './src/lib/garden-files/repository.ts';
      export { listSpaceTemplates, createFromSpaceTemplate } from './src/lib/office/templates.ts';
      export { decideCapabilityMode } from './src/lib/hermes/capability-policy.ts';
      export { createRuntimeSession, persistCapabilityDecision } from './src/lib/hermes/runtime-store.ts';
      export { beginRuntimeRun, finishRuntimeRun } from './src/lib/hermes/run-store.ts';
      export { listMcpConnections } from './src/lib/hermes/mcp-connections.ts';`, resolveDir: dashboard },
    bundle: true, packages: "external", platform: "node", format: "cjs", write: false,
    logOverride: { "empty-import-meta": "silent" },
    plugins: [{ name: "isolated-services", setup(builder) {
      builder.onResolve({ filter: /.*/ }, a => {
        const source = a.importer.replaceAll("\\", "/");
        if (a.path === "@/lib/server-auth" && !/\/api\/(bots|starred-messages|hermes\/skills\/promote)\/route\.ts$/.test(source)) return;
        if (a.path === "./dispatch.ts" && source.endsWith("/hooks/lifecycle.ts")) return { path: "hook-target", namespace: "fixture" };
        if (a.path === "../supervisor-control.ts" && a.importer.endsWith("local-mcp-broker.ts")) return { path: "lease", namespace: "fixture" };
        if (Object.hasOwn(fixture, a.path) && (a.path !== "../composio/client.ts" && a.path !== "../api-anything/service.ts" || a.importer.endsWith("unified-tool-registry.ts"))) return { path: a.path, namespace: "fixture" };
      });
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path === "lease" ?
        `export class SupervisorResourceExhaustedError extends Error {}
         export const acquireServiceLease=()=>null, releaseSupervisorLease=()=>{}, isRuntimeV2ServiceControlConfigured=()=>true, readSupervisedServiceSnapshot=()=>({state:"ready"});` : fixture[a.path] }));
    } }],
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", bundle.outputFiles[0].text)(mod, mod.exports, createRequire(import.meta.url));
  return mod.exports;
}

test("chat authors and uses a custom server, a new chat rediscovers it after disconnect", { timeout: process.env.BREADBOARD_QA_MODEL_BASE_URL ? 600_000 : 90_000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-authored-mcp-"));
  fs.mkdirSync(path.join(root, "registry"));
  const token = "test-only-local-broker-000000000000000000000000";
  const socket = net.createServer().listen(0, "127.0.0.1");
  await once(socket, "listening");
  const origin = "http://127.0.0.1:" + socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const packaged = path.join(root, "resources");
  fs.cpSync(path.join(dashboard, "../hermes-config/system"), path.join(packaged, "hermes-config/system"), { recursive: true });
  await build({ entryPoints: [path.join(dashboard, "scripts/authored-mcp-server.cjs")],
    outfile: path.join(packaged, "dashboard/scripts/authored-mcp-server.cjs"), bundle: true, platform: "node", format: "cjs", target: "node22" });
  Object.assign(process.env, { BREADBOARD_DATA_DIR: path.toNamespacedPath(root), BREADBOARD_REPO_ROOT: path.toNamespacedPath(packaged), QUARTZ_CONTENT_PATH: path.join(root, "content"),
    HERMES_SKILLS_APPROVED: path.join(packaged, ".agents/skills"), HERMES_SKILLS_CONDITIONAL: path.join(packaged, "hermes-skills/conditional"),
    HERMES_SKILLS_QUARANTINE: path.join(packaged, "hermes-skills/quarantine"), SKILLS_CATALOG_DB: path.join(root, "database/skills-catalog.db"),
    BREADBOARD_LOCAL_MCP_REGISTRY_ROOT: path.toNamespacedPath(path.join(root, "registry")), BREADBOARD_LOCAL_MCP_BROKER_URL: origin,
    BREADBOARD_LOCAL_MCP_BROKER_TOKEN: token, BREADBOARD_HERMES_TOOL_SECRET: token, HERMES_DASHBOARD_SESSION_TOKEN: token });
  const broker = spawn(process.execPath, [path.join(dashboard, "scripts/runtime-v2-local-mcp-broker-service.mjs"), "--port", new URL(origin).port],
    { env: process.env, stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
  let api;
  let diagnostics = "";
  broker.stderr.on("data", chunk => { diagnostics = (diagnostics + chunk).slice(-1500); });
  const closed = once(broker, "close");
  t.after(async () => {
    try { await api?.proxy.disposeProxyMcpConnections(); } finally {
      broker.stdin.end(); if (broker.exitCode === null) broker.kill(); await closed;
      api?.db.close(); fs.rmSync(root, { recursive: true, force: true });
    }
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(broker.exitCode, null, diagnostics);
    if (await fetch(origin + "/health").then(r => r.ok, () => false)) break;
    await delay(50);
  }
  assert.ok((await fetch(origin + "/health")).ok, diagnostics);
  api = await harness();
  api.db.exec("INSERT INTO users(id,username,email,password_hash) VALUES (81,'mcp-a','a@test.invalid','x'),(82,'mcp-b','b@test.invalid','x')");
  async function chat(userId, prompt, existing, dispatch = {}) {
    const conversation = existing ?? api.createConversation({ userId, title: prompt });
    const external = "chat-" + conversation.id;
    const session = api.createRuntimeSession({ conversationId: conversation.id, userId, surface: "dashboard_terminal",
      chatSessionId: null, clusterId: null, gardenId: null, pageSlug: null, agentName: "bread",
      workspaceKey: external, activeDirectory: root, filesystemMode: "restricted", hermesSessionId: external });
    const decision = api.decideCapabilityMode({ requestedOutcome: prompt, surface: "dashboard_terminal", authorizedRoot: root });
    const registry = await api.connectedAppRegistryForTurn({ runtime: {
      listCapabilities: () => api.proxy.proxyMcpDiscovery(userId),
      addMcpConnection: (_directory, slug, config) => api.proxy.addProxyMcpConnection(userId, slug, config),
    }, directory: root, userId, mode: decision.mode });
    decision.selectedConnections = registry.connectionNames;
    api.persistCapabilityDecision(session.id, decision);
    const run = api.beginRuntimeRun({ runtimeSessionId: session.id, instruction: prompt, dispatch });
    return { registry, run, conversation, decision, external, call: async (connection, tool, args, approved = false) => {
      const res = await api.POST(new Request("http://localhost/api/hermes/tools/mcp", { method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + token, "x-hermes-session-id": external },
        body: JSON.stringify({ connection, tool, args, permissionGranted: approved }) }));
      return { status: res.status, body: await res.json() };
    } };
  }
  const first = await chat(81, "Code a custom MCP for recording batches and calculating their mean.");
  const system = api.composeHermesSystemPrompt({ userId: 81, surface: "garden_chat", decision: first.decision,
    userText: first.conversation.title, stableAdditional: first.registry.systemContext });
  const policy = system.split("<!-- breadboard:turn-context -->").at(-1);
  assert.ok(policy.includes('tool="author"') && policy.includes('"code":"state.count'), "The current Garden turn should get the executable author contract.");
  const spec = { name: "Batch statistics", tools: [
    { name: "record_batch", parameters: [{ name: "values", type: "array", required: true }], readOnly: false,
      description: "Store a batch of measurements.", code: "state.values = args.values; return state.values.length;" },
    { name: "mean", parameters: [], readOnly: true, description: "Calculate the stored batch mean.",
      code: "const v = state.values || []; return v.length ? v.reduce((a,b)=>a+b,0)/v.length : null;" },
    { name: "preview", parameters: [], readOnly: true, description: "Preview an alternate value.",
      code: "state.values = [700]; return state.values;" },
    { name: "fail", parameters: [], readOnly: false, description: "Reject an invalid batch.",
      code: "state.values = [900]; throw Error('Invalid batch');" },
  ], test: { tool: "record_batch", args: { values: [3, 4] }, expected: 2 } };
  assert.equal((await first.call("mcp-installer", "author", spec)).status, 428);
  const bad = await first.call("mcp-installer", "author", { ...spec, test: { ...spec.test, expected: 99 } }, true);
  assert.equal(bad.status, 400, JSON.stringify(bad));
  assert.equal(api.listMcpConnections(81).length, 0);
  const made = await first.call("mcp-installer", "author", spec, true);
  assert.equal(made.status, 200, JSON.stringify(made));
  const slug = made.body.data.connection;
  assert.equal(api.listMcpConnections(81, true)[0].slug, slug);
  const retried = await first.call("mcp-installer", "author", spec, true);
  assert.equal(retried.body.data?.connection, slug);
  const conflict = await first.call("mcp-installer", "author", { ...spec, tools: [
    spec.tools[0], { ...spec.tools[1], code: "return 999;" },
  ] }, true);
  assert.equal(conflict.status, 409);
  assert.equal(api.listMcpConnections(81, true).length, 1);
  const empty = await first.call(slug, "mean", {});
  assert.equal(empty.body.data?.content[0].text, "null", JSON.stringify(empty));
  assert.equal((await first.call(slug, "record_batch", { values: [12, 18, 24] })).status, 428);
  const recorded = await first.call(slug, "record_batch", { values: [12, 18, 24] }, true);
  assert.equal(recorded.body.data?.content[0].text, "3", JSON.stringify(recorded));
  const preview = await first.call(slug, "preview", {});
  assert.deepEqual(JSON.parse(preview.body.data.content[0].text), [700]);
  const failedWrite = await first.call(slug, "fail", {}, true);
  assert.equal(failedWrite.body.data?.isError, true);
  assert.equal(api.db.prepare("SELECT json_extract(payload,'$.success') AS ok FROM hermes_audit_events WHERE event_type='mcp.tool_completed' AND json_extract(payload,'$.tool')='fail'").get().ok, 0);
  api.finishRuntimeRun(first.run.id, "completed");
  await api.proxy.disposeProxyMcpConnections(81);
  const second = await chat(81, "Use my saved Batch statistics server to calculate the mean.");
  assert.ok(second.registry.connectionNames.includes(slug));
  const listed = await second.call(slug, "__breadboard_list_tools", {});
  assert.ok(listed.body.data?.tools.some(tool => tool.name === "mean"), JSON.stringify(listed));
  assert.ok(listed.body.data.tools.some(tool => tool.name === "record_batch"));
  const actual = await second.call(slug, "mean", {});
  assert.equal(actual.body.data?.content[0].text, "18", JSON.stringify(actual));
  const other = await chat(82, "Use Batch statistics.");
  assert.ok(!other.registry.connectionNames.includes(slug));
  assert.equal((await other.call(slug, "mean", {})).status, 403);
  const workspace = "breadboard-workspace";
  assert.ok(second.registry.connectionNames.includes(workspace));
  for (const name of ["Lab notes", "Finished batches"]) {
    const reply = await second.call(workspace, "create_garden", { name });
    assert.equal(reply.body.data?.garden.name, name, JSON.stringify(reply));
  }
  const destination = "finished-batches";
  const firstMove = await second.call(workspace, "move_chat", { chatId: first.conversation.public_id, garden: "lab-notes" });
  assert.equal(firstMove.body.data?.garden, "lab-notes", JSON.stringify(firstMove));
  const search = await second.call(workspace, "find_chats", { garden: "lab-notes", title: "recording batches" });
  assert.equal(search.body.data?.chats[0]?.chatId, first.conversation.public_id);
  const moved = await second.call(workspace, "move_chat", { chatId: first.conversation.public_id, garden: destination });
  assert.equal(moved.body.data?.garden, destination, JSON.stringify(moved));
  assert.equal((await second.call(workspace, "find_chats", { garden: "lab-notes" })).body.data.total, 0);
  assert.equal((await other.call(workspace, "list_gardens", {})).body.data.gardens.length, 0);
  assert.equal((await other.call(workspace, "move_chat", { chatId: "current", garden: destination })).status, 404);
  const bot = await api.manageBot(new Request("http://localhost/api/hermes/tools/bot-manage", { method: "POST",
    headers: { authorization: "Bearer " + token, "x-hermes-session-id": second.external },
    body: JSON.stringify({ args: { action: "create", name: "Batch Analyst", description: "Report the mean of saved batches.",
      personality: "You are Batch Analyst, the laboratory's statistics assistant. Read the values from the user's saved Batch statistics connection using its mean tool. Report the result with the units provided and check the sample count before suggesting a follow-up measurement." } }) }));
  assert.equal(bot.status, 200, await bot.text());
  const roster = await (await api.botsPage(new Request("http://localhost/api/bots"))).json();
  const analyst = roster.bots.find(bot => bot.name === "Batch Analyst");
  assert.ok(analyst);
  const opened = await (await api.startBotChat(new Request("http://localhost/api/bots", {
    method: "POST", body: JSON.stringify({ action: "chat", id: analyst.id }),
  }))).json();
  const conversation = api.db.prepare("SELECT * FROM conversations WHERE public_id=?").get(opened.conversationId);
  const botChat = await chat(81, "Calculate the latest batch mean", conversation);
  const answer = await botChat.call(slug, "mean", {});
  assert.equal(answer.body.data?.content[0]?.text, "18", JSON.stringify(answer));
  const notes = path.join(root, "content");
  process.env.QUARTZ_CONTENT_PATH = notes;
  const file = path.join(notes, "lab-notes", "sources", "batch.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const binding = api.gadgetBindingHandler("garden");
  const { id: clusterId } = api.db.prepare("SELECT id FROM clusters WHERE slug='lab-notes'").get();
  const context = { userId: 81, clusterId, conversationId: first.conversation.id, surface: "garden_chat", hermesSessionId: first.external, binding: { name: "notes" } };
  const read = () => binding.observations.read({ context, payload: { slug: "sources/batch.md" } });
  for (const value of ["Batch planned", "Batch completed"]) {
    fs.writeFileSync(file, "# Measurements\n\n" + value);
    assert.ok((await read()).result.content.includes(value));
  }
  await assert.rejects(binding.observations.list({ context: { ...context, userId: 82 }, payload: {} }), /Garden you own/);
  assert.deepEqual(binding.actions, {});
  const code = "def total(values):\n    return sum(values)\n";
  const skill = await second.call(workspace, "draft_skill", { name: "tally-batches", description: "Use when tallying lab batches.",
    instructions: "Use scripts/tally.py to total the measurements.", scripts: [{ filename: "tally.py", contents: code }] });
  assert.equal(skill.body.data?.status, "awaiting_review", JSON.stringify(skill));
  const [pending] = api.pendingAuthoredSkills(81);
  assert.ok(pending.files.includes("scripts/tally.py"));
  assert.equal(fs.readFileSync(path.join(packaged, "hermes-skills", "quarantine", pending.name, "scripts/tally.py"), "utf8"), code);
  assert.deepEqual(api.pendingAuthoredSkills(82), []);
  api.requireAuthoredSkillOwner(81, pending.name);
  assert.throws(() => api.requireAuthoredSkillOwner(82, pending.name), /draft not found/);
  await t.test("review promotes the exact Python helper from chat into the installed skill", async () => {
    const review = (expectedHash) => api.reviewSkill(new Request("http://localhost/api/hermes/skills/promote", {
      method: "POST", body: JSON.stringify({ name: pending.name, decision: "promote", expectedHash,
        approvedPermissions: ["shell"], classificationOverride: "eligible_general" }),
    }));
    assert.deepEqual(pending.requestedPermissions, ["shell"]);
    assert.equal((await review("stale review")).status, 409);
    const response = await review(pending.localHash);
    assert.equal(response.status, 200, await response.text());
    assert.deepEqual(api.pendingAuthoredSkills(81), []);
    assert.equal(fs.readFileSync(path.join(packaged, ".agents", "skills", pending.name, "scripts/tally.py"), "utf8"), code);
    api.getSkillsCatalogStore().close();
  });
  const store = api.gardenFiles();
  const ownerScope = { gardenId: "lab-notes", clusterId, userId: 81, ownerId: 81 };
  const fileBody = "# Shift handover\n\n## Measurements\n";
  const staged = await store.stage(new Blob([fileBody]).stream());
  const source = store.import(ownerScope, "Spaces/Handover.md", staged);
  const named = await second.call(workspace, "find_space_files", { title: "Handover" });
  assert.equal(named.body.data?.files[0]?.fileId, source.id);
  const savedTile = await second.call(workspace, "save_space_template", { name: "Lab handover", fileId: source.id });
  const [tile] = api.listSpaceTemplates(store, 81);
  assert.equal(savedTile.body.data?.template.id, tile.id);
  assert.deepEqual(api.listSpaceTemplates(store, 82), []);
  const targetId = api.db.prepare("SELECT id FROM clusters WHERE slug=?").get(destination).id;
  const target = { ...ownerScope, gardenId: destination, clusterId: targetId };
  const copy = await api.createFromSpaceTemplate(store, target, tile.id, "Morning shift");
  assert.notEqual(copy.id, source.id);
  assert.equal(copy.name, "Morning shift.md");
  assert.equal(fs.readFileSync(store.content(target, copy.id).path, "utf8"), fileBody);
  await t.test("starring an answer dispatches the matching Garden hook once", async () => {
    const input = { name: "Starred lab answers", provider: "message_starred", mode: "chat", chatInstructions: "Summarize the saved answer.", gardenSlug: destination };
    const hook = api.createHook(81, input, api.db);
    api.createHook(82, input, api.db);
    api.createHook(81, { ...input, gardenSlug: "lab-notes" }, api.db);
    const content = "The average was 18.";
    const message = api.appendConversationAssistantMessage({ conversation: first.conversation, clientMessageId: "starred-mean", surface: "garden_chat", content });
    globalThis.__sentStars = [];
    try {
      for (const starred of [true, true, false]) {
        const response = await api.starMessage(new Request("http://localhost/api/starred-messages", {
          method: "PUT", body: JSON.stringify({ conversationId: first.conversation.public_id, messageId: "msg_" + message.id, starred }),
        }));
        assert.equal(response.status, 200);
      }
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(globalThis.__sentStars.map(({ id, payload }) => [id, payload.event, payload.answer, payload.conversation.gardenSlug]),
        [[hook.id, "message.starred", content, destination]]);
    } finally { delete globalThis.__sentStars; }
  });
  if (process.env.BREADBOARD_QA_MODEL_BASE_URL) {
    await t.test("live Bread chats author the MCP, retrieve its value, move a chat and create a bot that uses it", async () => {
      const trace = [];
      const server = http.createServer(async (req, res) => {
        const handler = req.url === "/api/hermes/tools/mcp" ? api.POST
          : req.url === "/api/hermes/tools/bot-manage" ? api.manageBot : null;
        if (!handler || req.method !== "POST") { res.writeHead(404).end(); return; }
        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const { connection, tool } = JSON.parse(Buffer.concat(chunks).toString());
          const reply = await handler(new Request("http://localhost" + req.url, {
            method: "POST", headers: req.headers, body: Buffer.concat(chunks),
          }));
          trace.push([req.headers["x-agent-session-id"], connection, tool, reply.status]);
          res.writeHead(reply.status, { "content-type": "application/json" }).end(await reply.text());
        } catch { res.writeHead(500).end(); }
      });
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      const base = "http://127.0.0.1:" + server.address().port;
      const model = process.env.BREADBOARD_QA_MODEL ?? "gpt-5.6-sol";
      const repo = path.dirname(dashboard);
      const python = process.env.BREADBOARD_QA_HERMES_PYTHON ?? path.join(repo, "hermes-agent/.venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
      async function promptBread(prompt, conversation) {
        const turn = await chat(81, prompt, conversation, { teamApproval: true });
        const persona = api.botTurnPersona({ userId: 81, conversationPublicId: turn.conversation.public_id, text: prompt });
        const worker = spawn(python, [path.join(dashboard, "tests/fixtures/authored-mcp-live.py")], {
          cwd: root, windowsHide: true, timeout: 220_000,
          env: { ...process.env, HERMES_HOME: path.join(root, turn.external), PYTHONIOENCODING: "utf-8",
            BREADBOARD_INTERNAL_URL: base },
        });
        const closed = once(worker, "close");
        let output = "", errors = "";
        worker.stdout.on("data", bytes => { output = (output + bytes).slice(-8000); });
        worker.stderr.on("data", bytes => { errors = (errors + bytes).slice(-1200); });
        worker.stdin.end(JSON.stringify({ prompt, context: [persona, turn.registry.systemContext].join("\n"), model, session: turn.external }));
        const [status] = await closed;
        assert.equal(status, 0, errors);
        api.finishRuntimeRun(turn.run.id, "completed");
        return JSON.parse(output.trim().split("\n").at(-1)).answer;
      }
      try {
        const marker = "batch-" + crypto.randomUUID();
        const created = await promptBread(`Code a custom MCP called Sample Ledger, with put and get tools to store and retrieve a sample by name. Install it. Use it to save "${marker}" as sample A and read it back.`);
        assert.ok(api.listMcpConnections(81, true).some(row => row.slug === "custom-sample-ledger"), created);
        await api.proxy.disposeProxyMcpConnections(81);
        const answer = await promptBread("Use my saved Sample Ledger MCP to look up sample A. Reply with its value.");
        assert.ok(answer?.includes(marker), JSON.stringify({ answer, trace }));
        const calls = api.db.prepare(`SELECT DISTINCT runtime_session_id FROM hermes_audit_events WHERE event_type='mcp.tool_completed'
          AND json_extract(payload, '$.slug')='custom-sample-ledger' AND json_extract(payload, '$.success')=1`).all();
        assert.equal(calls.length, 2);
        const requested = await promptBread("Create a private Garden called Sample Reports and move this chat into it. Then create a bot named Sample Clerk on my Bots page whose job is to look up samples by name using my Sample Ledger MCP and report their stored values.");
        const moved = api.db.prepare("SELECT c.id FROM conversations c JOIN clusters g ON g.id=c.default_garden_id WHERE c.user_id=? AND g.slug=?").all(81, "sample-reports");
        assert.equal(moved.length, 1, requested);
        const roster = await (await api.botsPage(new Request("http://localhost/api/bots"))).json();
        const clerk = roster.bots.find(entry => entry.name === "Sample Clerk");
        assert.ok(clerk, requested);
        const opened = await (await api.startBotChat(new Request("http://localhost/api/bots", {
          method: "POST", body: JSON.stringify({ action: "chat", id: clerk.id }),
        }))).json();
        const dedicated = api.db.prepare("SELECT * FROM conversations WHERE public_id=?").get(opened.conversationId);
        assert.ok(dedicated);
        const report = await promptBread("Please look up sample A and give me its stored value.", dedicated);
        assert.ok(report?.includes(marker), JSON.stringify({ report, trace }));
        assert.ok(trace.some(([id, connection, , status]) => id === "chat-" + dedicated.id && connection === "custom-sample-ledger" && status === 200));
      } finally { await new Promise(resolve => server.close(resolve)); }
    });
  }
});
