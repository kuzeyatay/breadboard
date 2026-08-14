import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  SETTINGS_OVERVIEW_URLS,
  fetchCachedSettings,
  invalidateSettingsCache,
  preloadSettingsOverview,
} from "../src/lib/settings-client-cache.ts";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("settings responses are deduplicated, cached, and explicitly invalidated", async () => {
  const originalFetch = globalThis.fetch;
  const calls = new Map();
  globalThis.fetch = async (url) => {
    const key = String(url);
    const count = (calls.get(key) ?? 0) + 1;
    calls.set(key, count);
    return Response.json({ key, count });
  };

  try {
    invalidateSettingsCache();
    const [first, concurrent] = await Promise.all([
      fetchCachedSettings("/api/example"),
      fetchCachedSettings("/api/example"),
    ]);
    assert.deepEqual(await first.json(), { key: "/api/example", count: 1 });
    assert.deepEqual(await concurrent.json(), { key: "/api/example", count: 1 });
    assert.equal(calls.get("/api/example"), 1);

    const cached = await fetchCachedSettings("/api/example");
    assert.deepEqual(await cached.json(), { key: "/api/example", count: 1 });
    assert.equal(calls.get("/api/example"), 1);

    invalidateSettingsCache("/api/example");
    await fetchCachedSettings("/api/example");
    assert.equal(calls.get("/api/example"), 2);

    await fetchCachedSettings("/api/example", { force: true });
    assert.equal(calls.get("/api/example"), 3);

    await preloadSettingsOverview();
    await preloadSettingsOverview();
    for (const url of SETTINGS_OVERVIEW_URLS) {
      assert.equal(calls.get(url), 1, `${url} should be warmed once`);
    }
  } finally {
    invalidateSettingsCache();
    globalThis.fetch = originalFetch;
  }
});

test("settings service failures are never cached", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json(
      { error: calls === 1 ? "not ready" : undefined },
      { status: calls === 1 ? 503 : 200 },
    );
  };

  try {
    invalidateSettingsCache();
    assert.equal((await fetchCachedSettings("/api/flaky")).status, 503);
    assert.equal((await fetchCachedSettings("/api/flaky")).status, 200);
    assert.equal(calls, 2);
  } finally {
    invalidateSettingsCache();
    globalThis.fetch = originalFetch;
  }
});

test("an invalidated in-flight response cannot overwrite newer settings", async () => {
  const originalFetch = globalThis.fetch;
  let releaseOld;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Promise((resolve) => {
        releaseOld = () => resolve(Response.json({ version: "old" }));
      });
    }
    return Response.json({ version: "new" });
  };

  try {
    invalidateSettingsCache();
    const oldRequest = fetchCachedSettings("/api/race");
    const newResponse = await fetchCachedSettings("/api/race", { force: true });
    assert.deepEqual(await newResponse.json(), { version: "new" });
    releaseOld();
    assert.deepEqual(await (await oldRequest).json(), { version: "old" });
    assert.deepEqual(await (await fetchCachedSettings("/api/race")).json(), {
      version: "new",
    });
    assert.equal(calls, 2);
  } finally {
    invalidateSettingsCache();
    globalThis.fetch = originalFetch;
  }
});

test("the settings overview prewarms and visited panels stay mounted", () => {
  const composer = source("../src/app/components/assistant-composer.tsx");
  const dialog = source("../src/app/components/settings-dialog.tsx");
  const accounts = source("../src/app/components/settings-accounts.tsx");
  const providers = source("../src/app/components/settings-providers.tsx");

  assert.match(composer, /window\.setTimeout\(\(\) => \{\s*void preloadSettingsOverview\(\)/);
  assert.match(composer, /settingsMounted \? \(/);
  assert.match(composer, /open=\{intelligencePanel === 'settings'\}/);
  assert.match(dialog, /visitedTabs\.has\("memory"\)/);
  assert.match(dialog, /hidden=\{tab !== "memory"\}/);
  assert.match(accounts, /fetchCachedSettings\("\/api\/chatmock\/account"/);
  assert.match(providers, /fetchCachedSettings\("\/api\/chatmock\/providers"/);
  // The proxy status is read by the account list now, not a card of its own.
  assert.match(accounts, /fetchCachedSettings\("\/api\/cliproxy\/status"/);
});
