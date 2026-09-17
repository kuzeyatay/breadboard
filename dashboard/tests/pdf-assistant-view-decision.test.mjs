import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as core from "../src/lib/hermes/route-core.ts";
import * as models from "../src/lib/ai-models.ts";
import * as decision from "../src/lib/pdf-assistant-view-decision.ts";

const source = readFileSync(
  new URL(
    "../src/app/api/pdf-assistant/view-decision/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
function route({ raw = '{"captureView":false}', authError, modelError } = {}) {
  const calls = [];
  const modules = {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/server-auth": {
      requireUserId: async () => {
        if (authError) throw authError;
        return 1;
      },
    },
    "@/lib/request-origin": {
      requireSameOrigin(request) {
        if (request.headers.get("origin") !== "http://localhost")
          throw new core.ApiError(403, "wrong_origin", "Wrong origin");
      },
    },
    "@/lib/hermes/route-helpers.ts": {
      ...core,
      apiErrorResponse(error) {
        const result = core.describeError(error);
        return Response.json(result.body, { status: result.status });
      },
    },
    "@/lib/ai-models.ts": models,
    "@/lib/pdf-assistant-view-decision.ts": decision,
    "@/lib/chatmock-client.ts": {
      createChatmockClient: () => ({
        chat: {
          completions: {
            create: async (...args) => {
              calls.push(args);
              if (modelError) throw modelError;
              return { choices: [{ message: { content: raw } }] };
            },
          },
        },
      }),
    },
  };
  const exports = {};
  new Function("require", "exports", compiled)((name) => {
    assert.ok(name in modules, `unexpected dependency ${name}`);
    return modules[name];
  }, exports);
  return {
    calls,
    post: (body = {}, origin = "http://localhost") =>
      exports.POST(
        new Request("http://localhost/api/pdf-assistant/view-decision", {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
  };
}

test("PDF screenshot planning asks the selected model and honors either decision", async () => {
  for (const captureView of [true, false]) {
    const endpoint = route({ raw: JSON.stringify({ captureView }) });
    const result = await endpoint.post({
      question: "Explain this",
      model: "gpt-5.6-sol",
      pageNumber: 3,
      pageText: "Figure caption",
    });
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { captureView });
    assert.equal(endpoint.calls.length, 1);
    assert.equal(endpoint.calls[0][0].model, "gpt-5.6-sol");
    assert.equal(
      JSON.parse(endpoint.calls[0][0].messages[1].content).currentPage,
      3,
    );
    assert.equal(endpoint.calls[0][1].maxRetries, 0);
    assert.ok(endpoint.calls[0][1].signal instanceof AbortSignal);
  }
});

test("failed screenshot planning returns a retryable error instead of guessing", async () => {
  for (const options of [
    { raw: "not JSON" },
    { modelError: new Error("private backend credentials") },
  ]) {
    const endpoint = route(options);
    const result = await endpoint.post({ question: "Explain this" });
    assert.equal(result.status, 502);
    assert.match((await result.json()).error, /Try your question again/);
  }
});

test("PDF context decisions reject unauthenticated, cross-origin and invalid requests before model use", async () => {
  const unauthorized = route({
    authError: new core.ApiError(401, "unauthorized", "Unauthorized"),
  });
  assert.equal((await unauthorized.post({ question: "Explain" })).status, 401);
  assert.equal(unauthorized.calls.length, 0);
  const endpoint = route();
  assert.equal(
    (await endpoint.post({ question: "Explain" }, "https://elsewhere.test"))
      .status,
    403,
  );
  assert.equal((await endpoint.post({ question: "" })).status, 400);
  assert.equal(endpoint.calls.length, 0);
});
