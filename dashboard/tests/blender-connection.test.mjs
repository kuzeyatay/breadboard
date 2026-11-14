import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test, { after, beforeEach } from "node:test";
import { build } from "esbuild";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-blender-connection-"));
const state = { root, records: new Map(), calls: [], discovered: true, result: null };
globalThis.__blenderConnectionTest = state;
const stubs = {
  "../external-runtime-filesystem.ts": `export { default as externalRuntimeFilesystem } from 'node:fs';`,
  "../external-runtime-path.ts": `export { default as externalRuntimePath } from 'node:path';`,
  "../runtime-paths.ts": `export const repositoryRoot = () => globalThis.__blenderConnectionTest.root; export const dashboardDataDir = () => repositoryRoot() + '/data';`,
  "./route-core.ts": `export class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }`,
  "./mcp-connections.ts": `
    const state = () => globalThis.__blenderConnectionTest;
    export const getMcpConnectionBySlug = user => state().records.get(user);
    export const parseMcpConfig = value => value;
    export const runtimeMcpConfig = value => value;
    export function saveMcpConnection(user, config) { state().calls.push({kind:'save',user,config}); const record = { ...config, id: user, enabled: true }; state().records.set(user, record); return record; }
    export function setMcpConnectionEnabled(user, id, enabled) { state().records.get(user).enabled = enabled; }
  `,
  "../agent-runtime/mcp-proxy.ts": `
    const state = () => globalThis.__blenderConnectionTest;
    export async function addProxyMcpConnection(userId, slug, config) { state().calls.push({ kind: 'add', userId, slug, config }); return { [slug]: { status: 'connected' } }; }
    export function proxyMcpTools() { return state().discovered ? ['get_addon_status', 'get_scene_info', 'execute_blender_code', 'look'].map(name => ({ name })) : []; }
    export async function setProxyMcpConnectionConnected(userId, slug, connected) { state().calls.push({kind:'disconnect', userId, slug, connected}); }
    export async function callProxyMcpTool(input) { state().calls.push(input); return state().result; }
  `,
};
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/hermes/blender-connection.ts", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
  plugins: [{ name: "isolated-blender-connection", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: "fixture" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path] }));
  } }],
});
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { blenderPaths, blenderConnectionStatus, updateBlenderConnection, verifyBlenderSceneResult } = module.exports;
const paths = blenderPaths();
for (const file of [paths.python, paths.launcher, paths.addon]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "test installation");
}
const reply = text => ({ content: [{ type: "text", text }] });
beforeEach(() => {
  state.records.clear(); state.calls.length = 0; state.discovered = true;
  state.result = reply("Scene | 3 objects | active Cube\nuntitled | engine BLENDER_EEVEE_NEXT");
  fs.writeFileSync(paths.receipt, JSON.stringify({ package: "mcp-for-blender", version: "2.2.9" }));
});
after(() => { delete globalThis.__blenderConnectionTest; fs.rmSync(root, { recursive: true, force: true }); });

test("status is passive, uses writable data, and distinguishes installation from a live connection", () => {
  const status = blenderConnectionStatus(1);
  assert.equal(status.installed, true);
  assert.equal(status.enabled, false);
  assert.equal(status.connected, undefined);
  assert.ok(paths.python.startsWith(path.join(root, "data", "runtime-v2")));
  assert.deepEqual(state.calls, []);
  fs.writeFileSync(paths.receipt, JSON.stringify({ package: "mcp-for-blender", version: "0.0.0" }));
  assert.equal(blenderConnectionStatus(1).installed, false);
});

test("connect discovers real tools then checks the scene with a fixed approved launch", async () => {
  const status = await updateBlenderConnection(7, { action: "connect" });
  assert.equal(status.connected, true);
  const saved = state.records.get(7);
  assert.equal(saved.slug, "blender");
  assert.equal(saved.executable, paths.python);
  assert.deepEqual(saved.args, ["-X", "utf8", paths.launcher]);
  assert.deepEqual(saved.environmentNames, []);
  assert.equal(saved.approved, true);
  assert.equal(state.calls.at(-1).tool, "get_scene_info");
  assert.equal(state.calls.at(-1).userId, 7);
  assert.equal(blenderConnectionStatus(8).enabled, false);
});

test("refresh preserves approval and disable only disconnects the selected user's MCP", async () => {
  await updateBlenderConnection(7, { action: "connect" });
  await updateBlenderConnection(8, { action: "connect" });
  state.calls.length = 0;
  await updateBlenderConnection(7, { action: "refresh" });
  assert.equal(state.calls.some(call => call.kind === "save"), false);
  const disabled = await updateBlenderConnection(7, { action: "disable" });
  assert.equal(disabled.enabled, false);
  assert.equal(state.records.get(8).enabled, true);
  assert.deepEqual(state.calls.at(-1), { kind: "disconnect", userId: 7, slug: "blender", connected: false });
  state.calls.length = 0;
  await updateBlenderConnection(7, { action: "refresh" });
  assert.deepEqual(state.calls, []);
});

test("plain-text upstream failures and incomplete discovery never mark a first connection ready", async () => {
  for (const result of [{ isError: true, ...reply("failed") }, reply("Error getting scene info: connection refused"), reply("Could not determine addon status."), reply("  "), {}]) {
    assert.throws(() => verifyBlenderSceneResult(result), /Blender did not respond/);
  }
  state.result = reply("Error getting scene info: connection refused");
  await assert.rejects(updateBlenderConnection(7, { action: "connect" }), /Blender did not respond/);
  assert.equal(state.records.get(7).enabled, false);
  state.discovered = false;
  await assert.rejects(updateBlenderConnection(8, { action: "connect" }), /do not match/);
  assert.equal(state.records.get(8).enabled, false);
});

test("missing setup and arbitrary launch options fail before starting a process", async () => {
  await assert.rejects(updateBlenderConnection(7, { action: "connect", executable: "other" }), /valid Blender/);
  await assert.rejects(updateBlenderConnection(7, { action: "execute" }), /valid Blender/);
  fs.unlinkSync(paths.receipt);
  await assert.rejects(updateBlenderConnection(7, { action: "connect" }), /Install the Blender tools/);
  assert.deepEqual(state.calls, []);
});
