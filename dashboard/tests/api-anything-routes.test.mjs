import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { issueCapabilityToken } from "../src/lib/hermes/capability-token.ts";

const root = path.resolve(import.meta.dirname, "..");

async function compileApiRoute(entry, stubs) {
  const bundle = await build({
    entryPoints: [path.join(root, entry)], absWorkingDir: root,
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    logOverride: { "empty-import-meta": "silent" },
    plugins: [{ name: "route-fixtures", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => args.path in stubs ? { path: args.path, namespace: "fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "js" }));
    } }],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return module.exports;
}

test("every shared chat registry includes website APIs even when other connectors are offline", async () => {
  const stubs = {
    "../composio/client.ts": "export const composioConfigured = () => false;",
    "./connected-app-context.ts": "export const connectedAppUsageInstructions = () => [];",
    "../bambu/mcp-guard.ts": "export const isUnguardedBambuConnection = () => false;",
    "../nango/actions.ts": "export const nangoActionSummariesForConnections = () => [];",
    "../composio/service.ts": 'export const COMPOSIO_RUNTIME_NAME = "composio"; export const composioConnectedIntegrationSlugs = async () => [];',
    "./capability-policy.ts": "export const connectionToolAllowed = () => true;",
    "./mcp-connections.ts": 'export const listMcpConnections = () => [{slug:"api-anything"}]; export const runtimeMcpConfig = () => ({});',
  };
  const { connectedAppRegistryForTurn } = await compileApiRoute("src/lib/hermes/unified-tool-registry.ts", stubs);
  const runtime = {
    addMcpConnection: async () => assert.fail("Built-in API Anything must not start a user-configured server"),
    listCapabilities: async () => { throw new Error("Optional server is offline"); },
  };
  for (const deferMcpConnections of [false, true]) {
    const registry = await connectedAppRegistryForTurn({ runtime, userId: 7, directory: root, mode: "research", deferMcpConnections });
    assert.deepEqual(registry.connectionNames, ["api-anything"]);
    assert.equal(registry.tools.mcp_call, true);
    assert.equal(registry.toolCount, 4);
    assert.match(registry.systemContext, /prefer Breadboard's embedded API Anything/);
    assert.match(registry.systemContext, /existing browser tools/);
  }
});

test("chat API tools enforce capability, account, active run, connection and native write approval", async t => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "api-anything-routes-"));
  const previous = { ...process.env };
  process.env.BREADBOARD_REPO_ROOT = path.resolve(root, "..");
  process.env.BREADBOARD_DATA_DIR = dataRoot;
  process.env.API_ANYTHING_KEY = "route-test-key-only";
  const state = globalThis.__apiAnythingRoute = {
    token: null, session: { id: 33, user_id: 7, conversation_id: 44 },
    run: { id: "run-one" }, decision: { selectedConnections: ["api-anything"] }, events: [],
  };
  t.after(() => {
    for (const key of ["BREADBOARD_REPO_ROOT", "BREADBOARD_DATA_DIR", "API_ANYTHING_KEY"]) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
    delete globalThis.__apiAnythingRoute;
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });
  const unexpected = names => names.map(name => `export const ${name} = () => { throw new Error("Unexpected connector: ${name}"); };`).join("\n");
  const stubs = {
    "next/server": "export const NextResponse = Response;",
    "@/lib/hermes/tool-service-auth.ts": "export const capabilityForInternalToolRequest = () => globalThis.__apiAnythingRoute.token;",
    "@/lib/hermes/runtime-store.ts": `export const getRuntimeSessionById = () => globalThis.__apiAnythingRoute.session;
      export const runtimeExternalSessionId = () => "runtime";
      export const getActiveCapabilityDecision = () => globalThis.__apiAnythingRoute.decision;
      export const recordAuditEvent = event => globalThis.__apiAnythingRoute.events.push(event);`,
    "@/lib/hermes/run-store.ts": "export const getActiveRuntimeRun = () => globalThis.__apiAnythingRoute.run; export const parseRuntimeRunDispatch = () => ({});",
    "@/lib/hermes/route-helpers.ts": `export class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
      export const requireEnabled = () => {};
      export const readJsonBody = req => req.json();
      export const apiErrorResponse = error => Response.json({ error: error.message, code: error.code }, { status: error.status || 500 });`,
    "@/lib/bambu/mcp-guard.ts": unexpected(["assertGuardedPrinterMcp"]),
    "@/lib/agent-runtime/mcp-proxy.ts": unexpected(["addProxyMcpConnection", "callProxyMcpTool", "proxyMcpTools"]) + "export class LocalMcpBrokerError extends Error {}",
    "@/lib/nango/actions.ts": unexpected(["nangoActionFor", "nangoActionSummariesForConnections"]),
    "@/lib/composio/service.ts": 'export const COMPOSIO_RUNTIME_NAME = "composio";' + unexpected(["listComposioConnections"]),
    "@/lib/hermes/connected-app-context.ts": unexpected(["connectedAppUsageInstructions"]),
    "@/lib/composio/executor.ts": unexpected(["executeComposioAction"]),
    "@/lib/composio/app-tools.ts": unexpected(["connectedAppTool", "connectedAppToolSummaries", "executeConnectedAppTool"]),
    "@/lib/hermes/mcp-connections.ts": unexpected(["getMcpConnection", "listMcpConnections", "runtimeMcpConfig"]),
    "@/lib/goal-mode.ts": 'export const GOAL_MODE_CONNECTION = "goal";' + unexpected(["callGoalModeTool"]),
    "@/lib/hermes/capability-policy.ts": unexpected(["connectionToolAllowed"]),
    "@/lib/code-index/chat-turn.ts": unexpected(["codeIndexConnectionForSession"]),
    "@/lib/code-index/repository-digest.ts": unexpected(["isCodeIndexConnectionSlug"]),
    "@/lib/conversations/store.ts": unexpected(["getConversationById"]),
    "@/lib/hermes/artifact-completion.ts": unexpected(["missingRunArtifact"]),
  };
  const { POST } = await compileApiRoute("src/app/api/hermes/tools/mcp/route.ts", stubs);
  const call = (tool = "status", args = {}, extra = {}) => POST(new Request("http://localhost/api/hermes/tools/mcp", {
    method: "POST", body: JSON.stringify({ connection: "api-anything", tool, args, ...extra }),
  }));
  assert.equal((await call()).status, 403);
  state.token = issueCapabilityToken({ userId: 7, conversationId: 44, surface: "dashboard_terminal",
    breadboardSessionId: "33", hermesSessionId: "runtime", allowedTools: ["mcp_call"] });
  state.session.user_id = 8; assert.equal((await call()).status, 403);
  state.session.user_id = 7;
  state.run = null; assert.equal((await call()).status, 409);
  state.run = { id: "run-one" };
  state.decision.selectedConnections = []; assert.equal((await call()).status, 403);
  state.decision.selectedConnections = ["api-anything"];
  const discovered = await (await call("__breadboard_list_tools")).json();
  assert.equal(discovered.data.tools.length, 4);
  const status = await (await call()).json();
  assert.ok(status.data.sites >= 114);

  const writes = [];
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    if (req.method === "POST") writes.push(JSON.parse(body));
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ writes }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const sites = path.join(dataRoot, "runtime-v2/api-anything/user-7/sites");
  fs.mkdirSync(sites, { recursive: true });
  fs.writeFileSync(path.join(sites, "route-write.json"), JSON.stringify({ name: "route-write", baseUrl: origin, operations: [
    { name: "list", readOnly: true, request: { method: "GET", url: origin, headers: {} }, params: [], slots: [], trigger: { url: origin }, response: { extract: "writes" } },
    { name: "add", readOnly: false, request: { method: "POST", url: origin, headers: { "content-type": "application/json" }, body: '{"title":"example"}' },
      params: [{ name: "title", required: true }], slots: [{ param: "title", at: ["body", "json:/title"] }],
      trigger: { url: `${origin}/{title}` }, readback: { op: "list", args: {}, find: { field: "title", equals: "{title}" } } },
  ] }));
  const args = { site: "route-write", operation: "add", args: { title: "native approval" } };
  const permission = await call("call_operation", args);
  const permissionBody = await permission.json();
  assert.equal(permission.status, 428, JSON.stringify(permissionBody));
  assert.equal(permissionBody.code, "connected_app_permission_required");
  assert.equal(writes.length, 0);
  // A run switch cannot reuse another run's approved preview.
  state.run = { id: "run-two" };
  assert.equal((await call("call_operation", args, { permissionGranted: true })).status, 428);
  assert.equal(writes.length, 0);
  state.run = { id: "run-one" };
  const approved = await (await call("call_operation", args, { permissionGranted: true })).json();
  assert.equal(approved.data.write, "applied", JSON.stringify(approved));
  assert.deepEqual(writes, [{ title: "native approval" }]);
  assert.ok(state.events.some(event => event.payload.provider === "api-anything"));
  assert.ok(state.events.every(event => !JSON.stringify(event.payload).includes("native approval")), "audit events exclude action payloads");
});
