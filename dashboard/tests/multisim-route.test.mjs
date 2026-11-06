import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { registerHooks } from "node:module";
import { prepareTurn } from "../src/lib/hermes/dispatch-core.ts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMultisim } from "../src/lib/hermes/multisim-service.ts";
import http from "node:http";
import { spawn } from "node:child_process";

const state = globalThis.__multisimRouteTest = {};
const modules = {
  "next/server": "export const NextResponse = { json: (data) => Response.json(data) };",
  "@/lib/conversations/store.ts": "export const getConversationById = () => globalThis.__multisimRouteTest.conversation;",
  "@/lib/hermes/tool-service-auth.ts": "export const capabilityForInternalToolRequest = request => request.headers.get('x-capability');",
  "@/lib/hermes/capability-token.ts": `
    export const verifyCapabilityToken = token => token === 'test-token' ? globalThis.__multisimRouteTest.verified : {ok:false};
    export const tokenAllows = (token, {tool}) => token.tools.includes(tool);`,
  "@/lib/hermes/runtime-store.ts": `
    export const getActiveCapabilityDecision = () => globalThis.__multisimRouteTest.decision;
    export const getRuntimeSessionById = () => globalThis.__multisimRouteTest.session;
    export const runtimeExternalSessionId = session => session.external;
    export const recordAuditEvent = event => globalThis.__multisimRouteTest.audit.push(event);`,
  "@/lib/hermes/route-helpers.ts": `
    export class ApiError extends Error { constructor(status,code,message) {super(message);this.status=status;this.code=code;} }
    export const apiErrorResponse = error => Response.json({code:error.code,error:error.message},{status:error.status ?? 500});
    export const readJsonBody = request => request.json();
    export const requireEnabled = () => {};`,
  "@/lib/hermes/config.ts": "export const readHermesConfig = () => ({workspaceRoot:globalThis.__multisimRouteTest.workspaceRoot});",
  "@/lib/hermes/workspace.ts": `export const directoryForWorkspaceKey = (config,key) => config.workspaceRoot + '/' + key;`,
  "@/lib/hermes/multisim-service.ts": `
    export const runMultisim = async (workspace,args,options) => {
      const state = globalThis.__multisimRouteTest;
      state.calls.push({workspace,args,options});
      if (state.error) throw new Error(state.error);
      if (state.runWorker) return state.runWorker(workspace,args,options);
      return { success:true, run_id:'verified-run' };
    };`,
};
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (modules[specifier]) return { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { POST } = await import("../src/app/api/hermes/tools/multisim/route.ts");
hooks.deregister();

beforeEach(() => {
  Object.assign(state, {
    verified: { ok: true, token: { tools: ["multisim"], breadboardSessionId: "1", hermesSessionId: "external-1", conversationId: 10 } },
    session: { id: 1, user_id: 3, conversation_id: 10, surface: "garden_chat", external: "external-1", garden_id: 2, workspace_key: "conversation-10" },
    conversation: { id: 10, user_id: 3 },
    decision: prepareTurn({ request: "Design and simulate a voltage divider", surface: "garden_chat",
      userId: 3, grants: [], workspaceRoot: "/operator/workspaces/conversation-10", superAgent: true }).decision,
    calls: [], audit: [], error: null, workspaceRoot: "/operator/workspaces", runWorker: null,
  });
});
const request = (body = { tool: "multisim", args: { action: "runtime_status" } }, token = "test-token") => new Request("http://localhost/api/hermes/tools/multisim", {
  method: "POST", headers: { "x-capability": token, "content-type": "application/json" }, body: JSON.stringify(body),
});

test("authorized calls resolve the workspace from the owning session, forward cancellation and audit completion", async () => {
  const input = request();
  const response = await POST(input);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.run_id, "verified-run");
  assert.equal(state.calls[0].workspace, "/operator/workspaces/conversation-10");
  assert.deepEqual(state.calls[0].args, { action: "runtime_status" });
  assert.equal(state.calls[0].options.signal, input.signal);
  assert.equal(state.audit[0].userId, 3);
});

test("missing capability or a token without the exact tool cannot start a circuit worker", async () => {
  assert.equal((await POST(request(undefined, "invalid"))).status, 403);
  state.verified.token.tools = ["terminal"];
  assert.equal((await POST(request())).status, 403);
  assert.equal(state.calls.length, 0);
});

test("session, conversation and surface mismatches are denied", async () => {
  for (const patch of [{ external: "different" }, { conversation_id: 99 }, { surface: "quartz_ai" }, { user_id: null }]) {
    const original = state.session;
    state.session = { ...original, ...patch };
    assert.equal((await POST(request())).status, 403);
    state.session = original;
  }
  assert.equal(state.calls.length, 0);
});

test("revoked or missing active grants fail closed", async () => {
  for (const decision of [null, { allowedTools: [] }]) {
    state.decision = decision;
    assert.equal((await POST(request())).status, 403);
  }
  assert.equal(state.calls.length, 0);
});

test("another account cannot use a conversation's circuit workspace", async () => {
  state.conversation.user_id = 77;
  assert.equal((await POST(request())).status, 403);
  assert.equal(state.calls.length, 0);
});

test("unknown tools cannot reach the worker", async () => {
  assert.equal((await POST(request({ tool: "multisim_shell", args: {} }))).status, 400);
  assert.equal(state.calls.length, 0);
});

test("worker failures return an error and never record successful completion", async () => {
  state.error = "ngspice executable unavailable";
  const response = await POST(request());
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /ngspice/);
  assert.equal(state.audit.length, 0);
});

test("a Super Agent turn calls the route and measures a real ngspice divider", async (t) => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const configPath = path.join(root, ".runtime/multisim.json");
  if (!fs.existsSync(configPath)) return t.skip("Run npm run setup:multisim first");
  fs.mkdirSync(path.join(root, ".tmp"), { recursive: true });
  state.workspaceRoot = fs.mkdtempSync(path.join(root, ".tmp/multisim-super-agent-route-"));
  state.runWorker = (workspace, args, options) => runMultisim(workspace, args, { ...options, configPath });
  const server = http.createServer(async (incoming, outgoing) => {
    try {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      assert.equal(incoming.url, "/api/hermes/tools/multisim");
      assert.equal(incoming.headers["x-agent-session-id"], "external-1");
      assert.equal(incoming.headers.authorization, "Bearer test-secret");
      const response = await POST(request(JSON.parse(Buffer.concat(chunks).toString())));
      outgoing.writeHead(response.status, { "content-type": "application/json" });
      outgoing.end(await response.text());
    } catch (error) {
      outgoing.writeHead(500); outgoing.end(JSON.stringify({ error: String(error) }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const call = (action, args = {}) => new Promise((resolve, reject) => {
    const child = spawn(config.python, [path.join(root, "dashboard/tests/fixtures/multisim-plugin-call.py")], {
      cwd: root, windowsHide: true,
      env: { ...process.env, BREADBOARD_INTERNAL_URL: `http://127.0.0.1:${server.address().port}`,
        BREADBOARD_HERMES_TOOL_SECRET: "test-secret", HERMES_HOME: path.join(state.workspaceRoot, "hermes") },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "", errors = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        assert.equal(code, 0, errors);
        const result = JSON.parse(output);
        assert.equal(result.error, undefined, output);
        resolve(result);
      } catch (error) { reject(error); }
    });
    child.stdin.end(JSON.stringify({ session_id: "external-1", args: { action, arguments: args } }));
  });
  const status = await call("runtime_status");
  assert.equal(status.backend.available, true, "installed native runtime must provide a real solver");
  const circuit = JSON.parse(fs.readFileSync(path.join(root, "skills/multisim-agent/examples/divider.json"), "utf8"));
  const created = await call("create_circuit", { circuit });
  const result = await call("run_circuit_experiment", { circuit_id: created.circuit_id, analysis: { kind: "op" }, render: false });
  assert.equal(result.success, true);
  const voltage = await call("measure_voltage", { run_id: result.run_id, node: "vout" });
  assert.equal(voltage.status, "measured");
  assert(Math.abs(voltage.value - 2.5) < 1e-8);
  assert.equal(state.audit.length, 4);
});
