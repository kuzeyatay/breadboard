import assert from "node:assert/strict";
import test from "node:test";

import {
  createChatmockClient,
  createLongHeaderTimeoutFetch,
  longHeaderTimeoutFetch,
} from "../src/lib/chatmock-client.ts";

test("native ESM ChatMock clients always use the long-header undici dispatcher", async () => {
  assert.equal(typeof require, "undefined", "the regression must execute in native ESM");

  const dispatcher = { identity: "long-header-dispatcher" };
  let dispatcherOptions;
  let fetchInit;
  const customFetch = createLongHeaderTimeoutFetch({
    timeoutMs: 15 * 60 * 1000,
    dispatcherFactory(options) {
      dispatcherOptions = options;
      return dispatcher;
    },
    async fetchImplementation(_input, init) {
      fetchInit = init;
      return new Response("ok", { status: 200 });
    },
  });

  const response = await customFetch("http://127.0.0.1/transport-test");
  assert.equal(await response.text(), "ok");
  assert.deepEqual(dispatcherOptions, {
    headersTimeout: 15 * 60 * 1000,
    bodyTimeout: 15 * 60 * 1000,
  });
  assert.equal(fetchInit.dispatcher, dispatcher);

  const productionFetch = longHeaderTimeoutFetch();
  const priorApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = priorApiKey || "transport-test-key";
  const client = createChatmockClient("http://127.0.0.1:8765/v1");
  if (priorApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = priorApiKey;
  assert.equal(typeof productionFetch, "function");
  assert.equal(client.fetch, productionFetch);
  assert.notEqual(client.fetch, globalThis.fetch);
});

test("a caller can outwait a deep reasoning model and forbid the SDK's own retries", () => {
  const priorApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = priorApiKey || "transport-test-key";
  try {
    const plain = createChatmockClient("http://127.0.0.1:8765/v1");
    // The SDK defaults: ten minutes and two silent retries.
    assert.equal(plain.timeout, 600_000);
    assert.equal(plain.maxRetries, 2);
    const patient = createChatmockClient("http://127.0.0.1:8765/v1", {
      timeout: 62 * 60 * 1000,
      maxRetries: 0,
    });
    assert.equal(patient.timeout, 62 * 60 * 1000);
    assert.equal(patient.maxRetries, 0);
  } finally {
    if (priorApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = priorApiKey;
  }
});
