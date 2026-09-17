import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { registerHooks } from "node:module";

const state = globalThis.__feynmanRouteTest = {};
const modules = {
  "next/server": "export const NextResponse = { json: (data) => Response.json(data) };",
  "@/lib/conversations/store.ts": "export const getConversationById = () => globalThis.__feynmanRouteTest.conversation;",
  "@/lib/hermes/tool-service-auth.ts": "export const capabilityForInternalToolRequest = request => request.headers.get('x-capability');",
  "@/lib/hermes/capability-token.ts": `
    export const verifyCapabilityToken = token => token === 'test-token' ? globalThis.__feynmanRouteTest.verified : {ok:false};
    export const tokenAllows = (token, {tool}) => token.tools.includes(tool);`,
  "@/lib/hermes/runtime-store.ts": `
    export const getActiveCapabilityDecision = () => globalThis.__feynmanRouteTest.decision;
    export const getRuntimeSessionById = () => globalThis.__feynmanRouteTest.session;
    export const runtimeExternalSessionId = session => session.external;
    export const recordAuditEvent = event => globalThis.__feynmanRouteTest.audit.push(event);`,
  "@/lib/hermes/route-helpers.ts": `
    export class ApiError extends Error { constructor(status,code,message) {super(message);this.status=status;this.code=code;} }
    export const apiErrorResponse = error => Response.json({code:error.code,error:error.message},{status:error.status ?? 500});
    export const readJsonBody = request => request.json();
    export const requireEnabled = () => {};`,
  "@/lib/feynman/service.ts": `
    export const FEYNMAN_TOOL = 'feynman_research';
    export class FeynmanError extends Error {}
    export const researchFeynman = async (args,options) => {
      const state = globalThis.__feynmanRouteTest;
      state.calls.push({args,options});
      return { papers:[{title:'Paper'}], sources:[{source:'Crossref',status:'ok'}] };
    };`,
};
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (modules[specifier]) return { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { POST } = await import("../src/app/api/hermes/tools/feynman/route.ts");
hooks.deregister();

beforeEach(() => {
  Object.assign(state, {
    verified: { ok: true, token: { tools: ["feynman_research"], breadboardSessionId: "1", hermesSessionId: "external-1", conversationId: 10 } },
    session: { id: 1, user_id: 3, conversation_id: 10, surface: "garden_chat", external: "external-1", garden_id: 2 },
    conversation: { id: 10, user_id: 3 }, decision: { allowedTools: ["feynman_research"] }, calls: [], audit: [],
  });
});
const request = (body = { tool: "feynman_research", args: { query: "CRISPR" } }, token = "test-token") => new Request("http://localhost/api/hermes/tools/feynman", {
  method: "POST", headers: { "x-capability": token, "content-type": "application/json" }, body: JSON.stringify(body),
});

test("an authorized owning conversation can use the tool and its abort signal", async () => {
  const input = request();
  const response = await POST(input);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.papers[0].title, "Paper");
  assert.deepEqual(state.calls[0].args, { query: "CRISPR" });
  assert.equal(state.calls[0].options.signal, input.signal);
  assert.equal(state.audit[0].userId, 3);
});

test("missing capability fails before any research", async () => {
  assert.equal((await POST(request(undefined, "invalid"))).status, 403);
  assert.equal(state.calls.length, 0);
});

test("capability without the exact tool fails before any research", async () => {
  state.verified.token.tools = ["research_begin"];
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

test("a revoked or missing active decision fails closed", async () => {
  for (const decision of [null, { allowedTools: [] }]) {
    state.decision = decision;
    assert.equal((await POST(request())).status, 403);
  }
  assert.equal(state.calls.length, 0);
});

test("a conversation owned by another account cannot use the tool", async () => {
  state.conversation.user_id = 77;
  assert.equal((await POST(request())).status, 403);
  assert.equal(state.calls.length, 0);
});

test("unknown operations cannot reach the engine", async () => {
  assert.equal((await POST(request({ tool: "feynman_shell", args: {} }))).status, 400);
  assert.equal(state.calls.length, 0);
});
