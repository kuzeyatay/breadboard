// The ChatMock drafting call: what it asks for, and how defensively it reads
// the model's answer back. The model is stubbed — this is about the contract,
// not about generation quality.

import assert from "node:assert/strict";
import test from "node:test";

import { draftPosts } from "../src/lib/socials-manager/client.ts";
import { findSocialsManagerProvider } from "../src/lib/socials-manager/providers.ts";

const x = findSocialsManagerProvider("x");
const linkedin = findSocialsManagerProvider("linkedin");
const threads = findSocialsManagerProvider("threads");

/** Stub /v1/chat/completions with one forced tool call carrying `posts`. */
function stubModel(posts, { capture } = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    capture?.({ url: String(url), body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          choices: [
            {
              message: {
                tool_calls: [
                  { function: { arguments: JSON.stringify({ posts }) } },
                ],
              },
            },
          ],
        };
      },
    };
  };
  return () => {
    globalThis.fetch = original;
  };
}

function request(overrides = {}) {
  return {
    baseUrl: "http://127.0.0.1:8765",
    model: "default",
    brief: "we shipped the calendar",
    providers: [x, linkedin],
    scheduleAt: null,
    ...overrides,
  };
}

test("each requested network gets its own draft", async () => {
  const restore = stubModel([
    { network: "x", content: "short one" },
    { network: "linkedin", content: "longer one" },
  ]);
  try {
    const drafts = await draftPosts(request());
    assert.deepEqual(
      drafts.map((draft) => draft.providerId),
      ["x", "linkedin"],
    );
  } finally {
    restore();
  }
});

test("a network that was not requested is dropped", async () => {
  const restore = stubModel([
    { network: "x", content: "fine" },
    { network: "tiktok", content: "not asked for" },
  ]);
  try {
    const drafts = await draftPosts(request());
    assert.deepEqual(
      drafts.map((draft) => draft.providerId),
      ["x"],
    );
  } finally {
    restore();
  }
});

test("a duplicated network keeps only the first draft", async () => {
  const restore = stubModel([
    { network: "x", content: "first" },
    { network: "x", content: "second" },
  ]);
  try {
    const drafts = await draftPosts(request());
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].content, "first");
  } finally {
    restore();
  }
});

test("an over-long draft is truncated to the network's limit, not rejected", async () => {
  const restore = stubModel([
    { network: "threads", content: "a".repeat(threads.maxCharacters + 200) },
  ]);
  try {
    const drafts = await draftPosts(request({ providers: [threads] }));
    assert.equal(drafts[0].content.length, threads.maxCharacters);
  } finally {
    restore();
  }
});

test("a pinned time overrides whatever the model proposed", async () => {
  const restore = stubModel([
    { network: "x", content: "hi", scheduledAt: "2026-09-09T09:00" },
  ]);
  try {
    const drafts = await draftPosts(
      request({ providers: [x], scheduleAt: "2026-08-05T09:00" }),
    );
    assert.equal(drafts[0].scheduledAt, "2026-08-05T09:00");
  } finally {
    restore();
  }
});

test("a malformed proposed time is discarded rather than stored", async () => {
  const restore = stubModel([
    { network: "x", content: "hi", scheduledAt: "next tuesday" },
  ]);
  try {
    const drafts = await draftPosts(request({ providers: [x] }));
    assert.equal(drafts[0].scheduledAt, null);
  } finally {
    restore();
  }
});

test("empty content is skipped", async () => {
  const restore = stubModel([
    { network: "x", content: "   " },
    { network: "linkedin", content: "real" },
  ]);
  try {
    const drafts = await draftPosts(request());
    assert.deepEqual(
      drafts.map((draft) => draft.providerId),
      ["linkedin"],
    );
  } finally {
    restore();
  }
});

test("a response with no usable draft is an error, not an empty success", async () => {
  const restore = stubModel([{ network: "myspace", content: "nope" }]);
  try {
    await assert.rejects(() => draftPosts(request()), /no usable drafts/);
  } finally {
    restore();
  }
});

test("the model is forced to answer through the drafting tool", async () => {
  let seen = null;
  const restore = stubModel([{ network: "x", content: "hi" }], {
    capture: (value) => {
      seen = value;
    },
  });
  try {
    await draftPosts(request({ providers: [x] }));
  } finally {
    restore();
  }
  assert.match(seen.url, /\/v1\/chat\/completions$/);
  assert.equal(seen.body.tool_choice.function.name, "publish_drafts");
  assert.deepEqual(
    seen.body.tools[0].function.parameters.properties.posts.items.properties.network.enum,
    ["x"],
  );
});

test("a base url that already ends in /v1 is not doubled", async () => {
  let seen = null;
  const restore = stubModel([{ network: "x", content: "hi" }], {
    capture: (value) => {
      seen = value;
    },
  });
  try {
    await draftPosts(request({ providers: [x], baseUrl: "http://127.0.0.1:8765/v1" }));
  } finally {
    restore();
  }
  assert.equal(seen.url, "http://127.0.0.1:8765/v1/chat/completions");
});

test("each network's real limit reaches the system prompt", async () => {
  let seen = null;
  const restore = stubModel([{ network: "threads", content: "hi" }], {
    capture: (value) => {
      seen = value;
    },
  });
  try {
    await draftPosts(request({ providers: [threads] }));
  } finally {
    restore();
  }
  assert.match(seen.body.messages[0].content, /at most 500 characters/);
});

test("no networks means no model call at all", async () => {
  let called = false;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("should not be called");
  };
  try {
    assert.deepEqual(await draftPosts(request({ providers: [] })), []);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("an upstream failure surfaces its status", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 502, async json() { return {}; } });
  try {
    await assert.rejects(() => draftPosts(request()), /502/);
  } finally {
    globalThis.fetch = original;
  }
});

test("a response carrying no tool call is an error", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return { choices: [{ message: { content: "here you go" } }] };
    },
  });
  try {
    await assert.rejects(() => draftPosts(request()), /no drafts/);
  } finally {
    globalThis.fetch = original;
  }
});
