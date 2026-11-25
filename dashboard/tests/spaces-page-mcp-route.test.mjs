// Bread's real mcp_call route, with a real capability token, reaches the AFFiNE page open in Spaces.
// Only storage is stubbed; the editor's long poll is played by the bridge's own functions.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { issueCapabilityToken } from "../src/lib/hermes/capability-token.ts";
import { completePageCall, takePageCalls } from "../src/lib/spaces/page-bridge.ts";

const root = path.resolve(import.meta.dirname, "..");
const unexpected = names => names.map(name => `export const ${name} = () => { throw new Error("Unexpected: ${name}"); };`).join("\n");

test("mcp_call on spaces-page runs in the open page and answers Bread", async t => {
  const state = globalThis.__spacesPageRoute = {
    token: null, session: { id: 61, user_id: 9, conversation_id: 70 },
    run: { id: "run-page" }, decision: { selectedConnections: ["spaces-page"] }, events: [],
  };
  t.after(() => { delete globalThis.__spacesPageRoute; });
  const stubs = {
    "next/server": "export const NextResponse = Response;",
    "server-only": "",
    "@/lib/hermes/tool-service-auth.ts": "export const capabilityForInternalToolRequest = () => globalThis.__spacesPageRoute.token;",
    "@/lib/hermes/runtime-store.ts": `export const getRuntimeSessionById = () => globalThis.__spacesPageRoute.session;
      export const runtimeExternalSessionId = () => "runtime";
      export const getActiveCapabilityDecision = () => globalThis.__spacesPageRoute.decision;
      export const persistCapabilityDecision = () => {};
      export const recordAuditEvent = event => globalThis.__spacesPageRoute.events.push(event);`,
    "@/lib/hermes/run-store.ts": "export const getActiveRuntimeRun = () => globalThis.__spacesPageRoute.run; export const parseRuntimeRunDispatch = run => run.dispatch ?? {};",
    "@/lib/hermes/route-helpers.ts": `export class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
      export const requireEnabled = () => {};
      export const readJsonBody = req => req.json();
      export const apiErrorResponse = error => Response.json({ error: error.message, code: error.code }, { status: error.status || 500 });`,
    "@/lib/agent-runtime/mcp-proxy.ts": unexpected(["addProxyMcpConnection", "callProxyMcpTool", "proxyMcpTools"]) + "export class LocalMcpBrokerError extends Error {}",
    "@/lib/hermes/mcp-connections.ts": unexpected(["getMcpConnection", "listMcpConnections", "runtimeMcpConfig"]),
    "@/lib/conversations/store.ts": unexpected(["getConversationById"]),
    "@/lib/hermes/workspace-tools.ts": unexpected(["callWorkspaceTool"]),
  };
  const bundle = await build({
    entryPoints: [path.join(root, "src/app/api/hermes/tools/mcp/route.ts")], absWorkingDir: root,
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    logOverride: { "empty-import-meta": "silent" },
    plugins: [{ name: "route-fixtures", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => args.path in stubs ? { path: args.path, namespace: "fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "js" }));
    } }],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const call = (tool, args = {}) => module.exports.POST(new Request("http://localhost/api/hermes/tools/mcp", {
    method: "POST", body: JSON.stringify({ connection: "spaces-page", tool, args }),
  }));

  assert.equal((await call("page_read")).status, 403, "no capability token, no call");
  state.token = issueCapabilityToken({ userId: 9, conversationId: 70, surface: "dashboard_terminal",
    breadboardSessionId: "61", hermesSessionId: "runtime", allowedTools: ["mcp_call"] });

  const closed = await (await call("page_read")).json();
  assert.equal(closed.data.error, "spaces_page_closed");

  const page = { gardenId: "notes", fileId: "gf_9", title: "Lab plan", mode: "page" };
  await takePageCalls(9, page, 1);
  const pending = call("page_append", { markdown: "## Results" });
  const [taken] = await takePageCalls(9, page, 2000);
  assert.deepEqual([taken.name, taken.args], ["page_append", { markdown: "## Results" }]);
  completePageCall(9, taken.id, { result: { version: 4, title: "Lab plan" } });
  const answered = await (await pending).json();
  assert.deepEqual(answered, { ok: true, data: { version: 4, title: "Lab plan" } });
  assert.ok(state.events.some(event => event.payload.provider === "spaces-page" && event.payload.success));

  state.decision.selectedConnections = [];
  assert.equal((await call("page_read")).status, 403, "a turn that did not select the connection cannot call it");
});
