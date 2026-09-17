import assert from "node:assert/strict";
import test from "node:test";
import {
  invalidateAssistantPreferences,
  loadAssistantPreferences,
  patchAssistantPreferences,
  resetAssistantPreferencesForTest,
} from "../src/lib/assistant-bootstrap-client.ts";

test("saving a model returns the account copy and replaces the cached default", async (t) => {
  resetAssistantPreferencesForTest();
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; resetAssistantPreferencesForTest(); });
  const saved = { model: "cliproxy/claude-opus-5", userPreference: true };
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url, ...init });
    return Response.json(init.method === "PATCH" ? saved : { model: "gpt-5.6-sol" });
  };
  await loadAssistantPreferences();
  assert.deepEqual(await patchAssistantPreferences({ model: saved.model }), saved);
  assert.deepEqual(await loadAssistantPreferences(), saved);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, "/api/assistant-preferences");
  assert.deepEqual(JSON.parse(requests[1].body), { model: saved.model });
});

test("a rejected save reports the server error and preserves the confirmed default", async (t) => {
  resetAssistantPreferencesForTest();
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; resetAssistantPreferencesForTest(); });
  const saved = { model: "gpt-5.6-sol" };
  globalThis.fetch = async (_url, init = {}) => init.method === "PATCH"
    ? Response.json({ error: "This provider is not connected." }, { status: 400 })
    : Response.json(saved);
  await loadAssistantPreferences();
  await assert.rejects(patchAssistantPreferences({ model: "google/gemini-3.7-pro" }), /not connected/);
  assert.deepEqual(await loadAssistantPreferences(), saved);
});

test("a slow initial read cannot overwrite a newly saved default", async (t) => {
  resetAssistantPreferencesForTest();
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; resetAssistantPreferencesForTest(); });
  let release;
  const saved = { model: "gpt-6-astra", userPreference: true };
  globalThis.fetch = async (_url, init = {}) => init.method === "PATCH"
    ? Response.json(saved)
    : new Promise((resolve) => { release = () => resolve(Response.json({ model: "gpt-5.6-sol" })); });
  const loading = loadAssistantPreferences();
  await patchAssistantPreferences({ model: saved.model });
  release();
  assert.deepEqual(await loading, saved);
  assert.deepEqual(await loadAssistantPreferences(), saved);
});


test("a profile update in another tab invalidates both cached and in-flight defaults", async (t) => {
  resetAssistantPreferencesForTest();
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; resetAssistantPreferencesForTest(); });
  let release;
  globalThis.fetch = async () => new Promise(resolve => {release=()=>resolve(Response.json({model:'gpt-5.6-sol'}));});
  const pending = loadAssistantPreferences();
  invalidateAssistantPreferences();
  release();
  assert.equal(await pending, null);
  globalThis.fetch = async () => Response.json({model:'gpt-6-astra'});
  assert.equal((await loadAssistantPreferences()).model, 'gpt-6-astra');
  globalThis.fetch = async () => Response.json({model:'cliproxy/claude-opus-5'});
  invalidateAssistantPreferences();
  assert.equal((await loadAssistantPreferences()).model, 'cliproxy/claude-opus-5');
});
