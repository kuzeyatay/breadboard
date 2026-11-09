import assert from "node:assert/strict";
import test, { after } from "node:test";
import { registerHooks } from "node:module";
import fs from "node:fs";

globalThis.__chatRecoveryRouteCalls = 0;
globalThis.__teamRecoveryRouteCalls = 0;
let imports = 0;
let teamImports = 0;
const hooks = registerHooks({ resolve(specifier, context, next) {
  // Next's `next/server` has no package export for plain Node; point at its file.
  if (specifier === "next/server") return next("next/server.js", context);
  if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
  if (specifier.startsWith("@/")) {
    const candidate = new URL(`../src/${specifier.slice(2)}${specifier.includes(".") ? "" : ".ts"}`, import.meta.url);
    if (fs.existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
  }
  return next(specifier, context);
}, load(url, context, next) {
  if (url.endsWith("/swarm/pump.ts")) {
    teamImports++;
    return { format: "module", shortCircuit: true,
      source: "export function recoverSwarms() { globalThis.__teamRecoveryRouteCalls++; }" };
  }
  if (url.endsWith("/conversations/coordination.ts")) {
    imports++;
    return { format: "module", shortCircuit: true,
      source: "export function recoverChatMessages() { globalThis.__chatRecoveryRouteCalls++; return new Promise(() => {}); }" };
  }
  return next(url, context);
} });
const { POST } = await import("../src/app/api/internal/chat-coordination-recovery/route.ts");
const original = [process.env.BREADBOARD_HERMES_TOOL_SECRET, process.env.HERMES_TOOL_SECRET];
after(() => {
  for (const [index, key] of ["BREADBOARD_HERMES_TOOL_SECRET", "HERMES_TOOL_SECRET"].entries()) {
    if (original[index] === undefined) delete process.env[key]; else process.env[key] = original[index];
  }
  hooks.deregister(); delete globalThis.__chatRecoveryRouteCalls; delete globalThis.__teamRecoveryRouteCalls;
});
const call = (authorization, body, search = "") => POST(new Request(`http://127.0.0.1/api/internal/chat-coordination-recovery${search}`,
  { method: "POST", headers: { ...(authorization ? { authorization } : {}), "content-length": String(body === undefined ? 0 : Buffer.byteLength(body)) },
    ...(body === undefined ? {} : { body }) }));

test("only an authenticated empty recovery signal can load dispatch, without waiting for model work", { timeout: 1000 }, async () => {
  delete process.env.BREADBOARD_HERMES_TOOL_SECRET;
  delete process.env.HERMES_TOOL_SECRET;
  assert.equal((await call()).status, 404);
  process.env.BREADBOARD_HERMES_TOOL_SECRET = "recovery-route-test-key";
  for (const token of [undefined, "Bearer wrong", "Bearer recovery-route-test-keY", "Basic recovery-route-test-key"]) {
    assert.equal((await call(token)).status, 401);
  }
  const valid = "Bearer recovery-route-test-key";
  assert.equal((await call(valid, '{"message":"unauthorized instruction"}')).status, 400);
  assert.equal((await call(valid, undefined, "?target=other")).status, 400);
  assert.equal(imports, 0);
  assert.equal(teamImports, 0);
  const accepted = await call(valid);
  assert.equal(accepted.status, 202);
  assert.deepEqual(await accepted.json(), { accepted: true });
  assert.equal(globalThis.__chatRecoveryRouteCalls, 1);
  assert.equal(imports, 1);
  assert.equal(globalThis.__teamRecoveryRouteCalls, 1);
  assert.equal(teamImports, 1);
});
