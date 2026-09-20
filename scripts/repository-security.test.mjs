import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { unsafeTrackedPath } from "./check-repository-security.mjs";

test("runtime state and generated builds cannot enter the index", () => {
  for (const file of ["dashboard/undefined/cliproxy.key", "dashboard/db/brain.db", "gbrain/pglite/base/1/123",
    "DeepTutor/web/.next-deeptutor/server/server-reference-manifest.json", "dashboard/.env.local",
    "cliproxy/api-key", "cliproxy/config.yaml", "cliproxy/auth/account.json", "dashboard/postiz/credentials.json",
    ".claude/settings.local.json", "quartz/content/private.md", "new-package/.env.production",
    "audits/local-account-data.json", "qa/answer-quality/candidates.json"]) {
    assert.equal(unsafeTrackedPath(file), true, file);
  }
  for (const file of [".env.example", "dashboard/.env.example", "dashboard/src/app/api/build/route.ts",
    "stirling-pdf/frontend/editor/.env", "codex/codex-rs/http-client/tests/fixtures/test-ca.pem"]) {
    assert.equal(unsafeTrackedPath(file), false, file);
  }
});

test("both Openverse copies search without exposing or sending credentials", async () => {
  const files = ["../dashboard/public/vvveb-editor/libs/media/openverse.js", "../Vvvebjs/libs/media/openverse.js"];
  const sources = files.map(file => fs.readFileSync(new URL(file, import.meta.url), "utf8"));
  assert.equal(sources[0], sources[1]);
  for (const source of sources) {
    const requests = [];
    const response = { results: [{ title: "Public image" }] };
    const context = vm.createContext({
      window: { addEventListener() {} },
      fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => response }; },
      console, displayToast() { assert.fail("search failed"); },
    });
    vm.runInContext(source + "\nglobalThis.searchClient = new OpenVerse();", context);
    let received;
    await context.searchClient.getResults(data => { received = data; });
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /^https:\/\/api\.openverse\.org\/v1\/images\//);
    assert.equal(requests[0].options.headers.Authorization, undefined);
    assert.equal(context.searchClient.key, undefined);
    assert.equal(context.searchClient.accessToken, undefined);
    assert.equal(received, response);
  }
});
