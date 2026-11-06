import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as core from "../src/lib/hermes/route-core.ts";
import * as models from "../src/lib/ai-models.ts";
import * as decision from "../src/lib/pdf-assistant-view-decision.ts";
import * as gardenReading from "../src/lib/pdf-garden-reading.ts";

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
function route({ raw = '{"captureView":false}', authError, modelError, gardenError, savedPages } = {}) {
  const calls = [];
  const modules = {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/server-auth": {
      requireReadableCluster: (userId, slug) => {
        assert.equal(userId, 1);
        if (gardenError) throw gardenError;
        return { slug };
      },
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
    "@/lib/pdf-garden-reading.ts": savedPages ? {
      ...gardenReading,
      readGardenPdfPages: ({ clusterSlug, documentSlug }) => {
        assert.equal(clusterSlug, "circuits"); assert.equal(documentSlug, "notes");
        return savedPages;
      },
    } : gardenReading,
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

test("unavailable or invalid planning includes the visible page and lets the answer proceed", async () => {
  for (const options of [
    { raw: "not JSON" },
    { modelError: new Error("private backend credentials") },
  ]) {
    const endpoint = route(options);
    const result = await endpoint.post({ question: "Explain this" });
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { captureView: true, readWholeDocument: false });
  }
});

test("a stalled planner is bounded even when the provider ignores cancellation", async () => {
  let providerSignal;
  const result = await decision.resolvePdfViewDecision({
    signal: new AbortController().signal,
    timeoutMs: 10,
    requestDecision: async signal => {
      providerSignal = signal;
      return new Promise(() => {});
    },
  });
  assert.deepEqual(result, { captureView: true, readWholeDocument: false });
  assert.equal(providerSignal.aborted, true);
});

test("canceling a turn stops context planning instead of falling back and sending it", async () => {
  const controller = new AbortController();
  const result = decision.resolvePdfViewDecision({
    signal: controller.signal,
    requestDecision: async signal => {
      controller.abort(new Error("Turn canceled"));
      assert.equal(signal.aborted, true);
      return new Promise(() => {});
    },
  });
  await assert.rejects(result, /Turn canceled/);
});

const browserContext = {
  question: "What are Chebyshev filters?", title: "Filters", pageNumber: 20,
  pageText: "Chebyshev filters", model: "gpt-5.6-sol",
  sourceUrl: "/api/documents/filters/source-pdf?clusterSlug=circuits",
};

test("browser planning preserves the request context and a valid model decision", async t => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/api/pdf-assistant/view-decision");
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), browserContext);
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ captureView: false, readWholeDocument: true });
  });
  assert.deepEqual(await decision.requestPdfViewDecision({
    signal: new AbortController().signal, context: browserContext,
  }), { captureView: false, readWholeDocument: true });
});

test("browser planning falls back when headers or the response body stall", async t => {
  for (const stalledBody of [false, true]) {
    let providerSignal;
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    t.mock.method(globalThis, "fetch", async (_url, { signal }) => {
      providerSignal = signal;
      return stalledBody ? { ok: true, text: () => pending } : pending;
    });
    assert.deepEqual(await decision.requestPdfViewDecision({
      signal: new AbortController().signal, context: browserContext, timeoutMs: 10,
    }), { captureView: true, readWholeDocument: false });
    assert.equal(providerSignal.aborted, true);
    finish(stalledBody ? '{"captureView":false,"readWholeDocument":true}' :
      Response.json({ captureView: false, readWholeDocument: true }));
  }
});

test("browser planning recovers from service, network and malformed responses", async t => {
  for (const response of [
    () => Response.json({ error: "Planner busy" }, { status: 500 }),
    () => new Response("Bad gateway", { status: 502 }),
    () => new Response("Request timeout", { status: 408 }),
    () => new Response("Too many requests", { status: 429 }),
    () => { throw new TypeError("Failed to fetch"); },
    () => new Response("Invalid JSON"),
    () => Response.json({ captureView: "false" }),
    () => Response.json({ captureView: false, readWholeDocument: "true" }),
  ]) {
    t.mock.method(globalThis, "fetch", async () => response());
    assert.deepEqual(await decision.requestPdfViewDecision({
      signal: new AbortController().signal, context: browserContext,
    }), { captureView: true, readWholeDocument: false });
  }
});

test("browser planning preserves validation and access errors, even with a stalled body", async t => {
  for (const status of [400, 401, 403, 422]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Access denied" }, { status }));
    await assert.rejects(decision.requestPdfViewDecision({
      signal: new AbortController().signal, context: browserContext,
    }), /Access denied/);
  }
  t.mock.method(globalThis, "fetch", async () => ({
    ok: false, status: 403, json: () => new Promise(() => {}),
  }));
  await assert.rejects(decision.requestPdfViewDecision({
    signal: new AbortController().signal, context: browserContext, timeoutMs: 10,
  }), /could not prepare the PDF context/);
});

test("Stop cancels a stalled browser request without returning fallback context", async t => {
  const controller = new AbortController();
  let requestSignal;
  t.mock.method(globalThis, "fetch", async (_url, { signal }) => {
    requestSignal = signal;
    controller.abort(new Error("Turn canceled"));
    return new Promise(() => {});
  });
  await assert.rejects(decision.requestPdfViewDecision({
    signal: controller.signal, context: browserContext,
  }), /Turn canceled/);
  assert.equal(requestSignal.aborted, true);
});

test("screenshot planning sees authorized Garden OCR when the PDF text layer is empty", async t => {
  const previous = process.env.QUARTZ_CONTENT_PATH;
  process.env.QUARTZ_CONTENT_PATH = "test-content";
  t.after(() => {
    if (previous === undefined) delete process.env.QUARTZ_CONTENT_PATH;
    else process.env.QUARTZ_CONTENT_PATH = previous;
  });
  const savedPages = { 39: "The transient state is the transition between steady states." };
  const body = { question: "What does transient state mean?", pageNumber: 39, pageText: "",
    sourceUrl: "/api/documents/notes/source-pdf?clusterSlug=circuits" };
  const endpoint = route({ savedPages });
  assert.equal((await endpoint.post(body)).status, 200);
  const context = JSON.parse(endpoint.calls[0][0].messages[1].content);
  assert.equal(context.currentPageText, "");
  assert.equal(context.originalGardenPageText, savedPages[39]);
  const denied = route({ savedPages, gardenError: new core.ApiError(403, "forbidden", "Garden access denied") });
  assert.equal((await denied.post(body)).status, 403);
  assert.equal(denied.calls.length, 0, "Private Garden OCR must not reach the model");
});

test("a missing OCR layer can request a screenshot independently of whole-document reading", async () => {
  for (const readWholeDocument of [false, true]) {
    const endpoint = route({ raw: JSON.stringify({ captureView: true, readWholeDocument }) });
    const response = await endpoint.post({ question: "What does transient state mean?", pageNumber: 39, pageText: "" });
    assert.deepEqual(await response.json(), { captureView: true, readWholeDocument });
    const prompt = endpoint.calls[0][0].messages[0].content;
    assert.match(prompt, /no usable text layer/);
    assert.match(prompt, /screenshot.*does not require whole-document OCR/);
  }
  assert.equal(decision.parsePdfViewDecision('{"captureView":true,"readWholeDocument":"false"}'), null);
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
