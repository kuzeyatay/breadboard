import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { unexpectedErrorDiagnostic } from "../src/lib/hermes/error-diagnostic.ts";
import { ApiError, describeError } from "../src/lib/hermes/route-core.ts";

test("stack diagnostics retain compiled code positions without the payload or private paths", () => {
  const error = new RangeError("private PDF text and bearer token");
  error.stack = [
    "RangeError: private PDF text and bearer token",
    "    at decode (C:\\Users\\private-user\\app\\chunks\\src_lib_0.qu-ao._.js:1:245)",
    "    at async startConversationTurn (file:///private/workspace/turn-service.ts:1680:15)",
    "    at https://private.example/request?token=private-token:1:2",
  ].join("\n");
  assert.deepEqual(unexpectedErrorDiagnostic(error), {
    kind: "RangeError",
    frames: [
      { file: "src_lib_0.qu-ao._.js", line: 1, column: 245 },
      { file: "turn-service.ts", line: 1680, column: 15 },
    ],
  });
});

test("broken stack getters and long recursion traces do not break failure handling", () => {
  const error = new Error("private");
  Object.defineProperty(error, "stack", { get() { throw new Error("formatter failure"); } });
  assert.deepEqual(unexpectedErrorDiagnostic(error), { kind: "Error", frames: [] });
  const recursive = new RangeError();
  recursive.stack = "RangeError\n" + "    at recurse (/app/loop.js:2:3)\n".repeat(2000);
  assert.equal(unexpectedErrorDiagnostic(recursive).frames.length, 20);
});

function messageRoute(scope) {
  const source = fs.readFileSync(new URL("../src/app/api/hermes/sessions/[sessionId]/messages/route.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
  const functions = tree.statements.filter(ts.isFunctionDeclaration).map(node => node.getText(tree)).join("\n");
  const code = ts.transpileModule(functions, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function("exports", ...Object.keys(scope), `${code}\nreturn POST;`)({}, ...Object.values(scope));
}

test("a PDF preparation crash is recorded and the same attachment can be retried", async () => {
  const audits = [], failures = [], dispatched = [];
  const screenshot = { type: "image", name: "Current PDF view.png", context: "pdf", dataUrl: `data:image/png;base64,${"A".repeat(5_575_872)}` };
  let crash = true, auditUnavailable = false;
  const POST = messageRoute({
    NextResponse: Response, ApiError, describeError, unexpectedErrorDiagnostic,
    MAX_MESSAGE_REQUEST_BYTES: 16 * 1024 * 1024,
    HERMES_SURFACES: ["dashboard_terminal"],
    requireUserId: async () => 1, requireEnabled() {},
    getConversationForUser: () => ({ id: 7, public_id: "conv_pdf", user_id: 1 }),
    readJsonBody: request => request.json(), requireString: value => value,
    conversationRequestSurface: (_conversation, surface) => surface,
    conversationRequestContext: (_conversation, _surface, context) => context,
    parseConversationBranchHistory: () => undefined,
    normalizeChatTextSelectionReference: () => null,
    parseChatAttachments: value => value,
    hydrateDocumentAttachments: async (_user, attachments) => attachments,
    retrieveDocumentAttachments: async (_user, attachments) => attachments,
    parseCurrentLocationPayload: () => null, parseBrowserTerminalAccess: () => undefined,
    scheduledChatReceiptForUser: () => undefined,
    SupervisorResourceExhaustedError: class extends Error {},
    apiErrorResponse: error => { const result = describeError(error); return Response.json(result.body, { status: result.status }); },
    recordAuditEvent: event => { if (auditUnavailable) throw new Error("unavailable"); audits.push(event); },
    failAssistantMessage: input => failures.push(input),
    startConversationTurn: async input => {
      dispatched.push(input);
      if (crash) throw new RangeError("Maximum call stack size exceeded");
      return { accepted: true, run: { id: "run_retry" }, replayed: true, capability: {} };
    },
  });
  const send = retry => POST(new Request("http://local/messages", {
    method: "POST", body: JSON.stringify({ text: "what if R(s) is zero?", clientMessageId: "original-turn", attachments: [screenshot], retry }),
  }), { params: Promise.resolve({ sessionId: "conv_pdf" }) });
  const failed = await send(false);
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: "Internal server error" });
  assert.equal(audits[0].eventType, "conversation.turn_failed");
  assert.equal(audits[0].payload.kind, "RangeError");
  assert.equal(audits[0].payload.clientMessageId, "original-turn");
  assert.ok(audits[0].payload.frames.length > 0);
  assert.ok(JSON.stringify(audits[0]).length < 5000);
  assert.equal(failures[0].status, "failed");
  auditUnavailable = true;
  assert.equal((await send(true)).status, 500);
  assert.equal(failures.length, 2, "an unavailable audit store must not strand the assistant placeholder");
  crash = false;
  const retried = await send(true);
  assert.equal(retried.status, 200);
  assert.equal((await retried.json()).accepted, true);
  assert.deepEqual(dispatched.at(-1).attachments, [screenshot]);
  assert.equal(dispatched.at(-1).retry, true);
});
