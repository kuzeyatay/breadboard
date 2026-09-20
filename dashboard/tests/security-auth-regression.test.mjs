import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { createHash } from "node:crypto";

async function bundle(entry, stubs) {
  const output = await build({
    entryPoints: [entry], bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "isolated-auth-fixtures", setup(builder) {
      builder.onResolve({ filter: /./ }, args => {
        const name = stubs[args.path] ? args.path : args.path.split("/").at(-1);
        return stubs[name] ? { path: name, namespace: "fixture" } : undefined;
      });
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "js" }));
    } }],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return module.exports;
}

test("tool authentication fails closed and accepts only the configured shared secret", async t => {
  const names = ["BREADBOARD_HERMES_TOOL_SECRET", "HERMES_TOOL_SECRET", "HERMES_PASSWORD"];
  const before = names.map(name => process.env[name]);
  t.after(() => names.forEach((name, i) => { if (before[i] === undefined) delete process.env[name]; else process.env[name] = before[i]; }));
  names.forEach(name => delete process.env[name]);
  const api = await bundle("src/lib/hermes/tool-service-auth.ts", {
    "runtime-store.ts": `export const getRuntimeSessionByExternalId = () => ({ id: 1, user_id: 7, surface: "garden_chat", allowed_garden_ids: "[9]" });
      export const getRuntimeSessionByHermesId = getRuntimeSessionByExternalId;
      export const runtimeExternalSessionId = () => "fixture-session";`,
    "capability-token.ts": "export const issueCapabilityToken = payload => payload;",
    "tool-scopes.ts": "export const allowedToolsForSurface = () => ['garden'];",
    "browser-terminal-context.ts": "export const getBrowserTerminalContext = () => null;",
  });
  const request = value => new Request("http://localhost/api/hermes/tools/garden", {
    headers: { "x-agent-session-id": "fixture-session", authorization: `Bearer ${value}` },
  });
  process.env.HERMES_PASSWORD = "old-shared-default";
  assert.throws(() => api.capabilityForInternalToolRequest(request("old-shared-default")), error => error.status === 503);
  process.env.BREADBOARD_HERMES_TOOL_SECRET = "   ";
  assert.throws(() => api.capabilityForInternalToolRequest(request("old-shared-default")), error => error.status === 503);
  process.env.HERMES_TOOL_SECRET = "configured-fixture-value";
  assert.equal(api.capabilityForInternalToolRequest(request("configured-fixture-value")).userId, 7);
  process.env.BREADBOARD_HERMES_TOOL_SECRET = "preferred-fixture-value";
  assert.throws(() => api.capabilityForInternalToolRequest(request("configured-fixture-value")), error => error.status === 401);
  assert.equal(api.capabilityForInternalToolRequest(request("preferred-fixture-value")).userId, 7);
  assert.equal(api.capabilityForInternalToolRequest(new Request("http://localhost")), null);
});

test("password changes revoke existing JWT sessions without changing the encryption secret", async t => {
  globalThis.__securityAuthUser = { password_hash: "first-fixture-password-hash" };
  t.after(() => delete globalThis.__securityAuthUser);
  const { authOptions } = await bundle("src/lib/auth-options.ts", {
    "@/lib/db": "export default { prepare: () => ({ get: () => globalThis.__securityAuthUser }) };",
  });
  const jwt = authOptions.callbacks.jwt;
  const signedInUser = () => ({ id: "7", name: "Fixture user", passwordVersion:
    createHash("sha256").update(globalThis.__securityAuthUser.password_hash).digest("hex") });
  const verifiedUser = signedInUser();
  const token = await jwt({ token: {}, user: verifiedUser });
  assert.equal((await jwt({ token })).id, "7");
  assert.notEqual(token.passwordVersion, globalThis.__securityAuthUser.password_hash);
  await assert.rejects(() => jwt({ token: { id: "7" } }), /Session expired/);
  globalThis.__securityAuthUser.password_hash = "replacement-fixture-password-hash";
  await assert.rejects(() => jwt({ token }), /Session expired/);
  await assert.rejects(() => jwt({ token: {}, user: verifiedUser }), /Session expired/);
  const fresh = await jwt({ token: {}, user: signedInUser() });
  assert.equal((await jwt({ token: fresh })).id, "7");
  globalThis.__securityAuthUser = undefined;
  await assert.rejects(() => jwt({ token: fresh }), /Session expired/);
});
