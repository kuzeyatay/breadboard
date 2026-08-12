import assert from "node:assert/strict";
import test from "node:test";

import {
  localChatmockBaseUrl,
  normalizeChatmockBaseUrl,
  resolveChatmockBaseUrl,
} from "../src/lib/chatmock-server.ts";

const CHATMOCK_ENV_KEYS = [
  "OPENAI_HOST_BASE_URL",
  "OPENAI_LOCAL_BASE_URL",
  "OPENAI_BASE_URL",
  "CHATMOCK_HOST_PROTOCOL",
  "CHATMOCK_HOST_PORT",
];

async function withChatmockEnv(values, callback) {
  const previous = Object.fromEntries(
    CHATMOCK_ENV_KEYS.map((key) => [key, process.env[key]]),
  );

  try {
    for (const key of CHATMOCK_ENV_KEYS) delete process.env[key];
    for (const [key, value] of Object.entries(values)) {
      process.env[key] = value;
    }
    await callback();
  } finally {
    for (const key of CHATMOCK_ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("ChatMock URL normalization removes request-only URL components", () => {
  assert.equal(
    normalizeChatmockBaseUrl("chatmock.internal:8765/api/?token=secret#fragment"),
    "http://chatmock.internal:8765/api/v1",
  );
  assert.equal(normalizeChatmockBaseUrl("not a valid host"), null);
});

test("invalid local override falls through to the trusted base configuration", async () => {
  await withChatmockEnv(
    {
      OPENAI_LOCAL_BASE_URL: "not a valid host",
      OPENAI_BASE_URL: "http://127.0.0.1:41876/v1",
    },
    () => {
      assert.equal(localChatmockBaseUrl(), "http://127.0.0.1:41876/v1");
    },
  );
});

test("host target never derives its model destination from request host headers", async () => {
  await withChatmockEnv(
    {
      OPENAI_BASE_URL: "http://127.0.0.1:42876/v1",
      // These legacy knobs must not make an attacker-selected hostname usable.
      CHATMOCK_HOST_PROTOCOL: "https",
      CHATMOCK_HOST_PORT: "9443",
    },
    () => {
      const request = new Request("http://dashboard.local/api/models", {
        headers: {
          cookie: "sb_chatmock_target=host",
          host: "attacker.example",
          "x-forwarded-host": "key-collector.example, dashboard.local",
        },
      });

      assert.deepEqual(resolveChatmockBaseUrl(request), {
        target: "host",
        baseURL: "http://127.0.0.1:42876/v1",
      });
    },
  );
});

test("explicit host configuration safely preserves remote-host and desktop routing", async () => {
  await withChatmockEnv(
    {
      OPENAI_HOST_BASE_URL: "https://models.internal.example/gateway",
      OPENAI_BASE_URL: "http://127.0.0.1:43876/v1",
    },
    () => {
      const request = new Request("http://127.0.0.1:3000/api/models", {
        headers: {
          cookie: "unrelated=1; sb_chatmock_target=host",
          "x-forwarded-host": "attacker.example",
        },
      });

      assert.deepEqual(resolveChatmockBaseUrl(request), {
        target: "host",
        baseURL: "https://models.internal.example/gateway/v1",
      });
    },
  );
});

test("ChatMock falls back to its loopback endpoint without configuration", async () => {
  await withChatmockEnv({}, () => {
    const request = new Request("https://attacker.example/api/models", {
      headers: { cookie: "sb_chatmock_target=host" },
    });
    assert.equal(
      resolveChatmockBaseUrl(request).baseURL,
      "http://127.0.0.1:8765/v1",
    );
  });
});
