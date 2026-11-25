import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test, { after, beforeEach } from "node:test";
import { build } from "esbuild";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-mcp-installer-"));
const state = { root, saved: [], status: "connected", disabled: [] };
globalThis.__mcpInstallerTest = state;
const stubs = {
  "../external-runtime-filesystem.ts": `export { default as externalRuntimeFilesystem } from 'node:fs';`,
  "../external-runtime-path.ts": `export { default as externalRuntimePath } from 'node:path';`,
  "../runtime-paths.ts": `export const dashboardDataDir = () => globalThis.__mcpInstallerTest.root; export const repositoryRoot = dashboardDataDir;`,
  "./route-core.ts": `export class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }`,
  "./mcp-connections.ts": `
    const state = () => globalThis.__mcpInstallerTest;
    export const listMcpConnections = () => state().saved;
    export const mcpSlug = value => value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    export const parseMcpConfig = value => value;
    export const runtimeMcpConfig = value => value;
    export function saveMcpConnection(user, config) { state().saved.push(config); return { ...config, id: 7 }; }
    export function createVerifiedMcpConnection() { throw new Error("Use the authored server integration test."); }
    export function setMcpConnectionEnabled(user, id, enabled) { state().disabled.push({ id, enabled }); }
  `,
  "../agent-runtime/mcp-proxy.ts": `
    const state = () => globalThis.__mcpInstallerTest;
    export async function addProxyMcpConnection(userId, slug) { return { [slug]: { status: state().status, error: 'spawn failed' } }; }
    export function proxyMcpTools() { return [{ name: 'run_case', description: 'Run a case' }]; }
    export async function setProxyMcpConnectionConnected() {}
  `,
};
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/hermes/mcp-installer.ts", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
  plugins: [{ name: "isolated-mcp-installer", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: "fixture" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path] }));
  } }],
});
const module = { exports: {} };
new Function("module", "exports", "require", bundle.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
const { callMcpInstaller } = module.exports;

beforeEach(() => { state.saved = []; state.disabled = []; state.status = "connected"; });
after(() => fs.rmSync(root, { recursive: true, force: true }));

test("install asks for approval with the exact command before running anything", async () => {
  await assert.rejects(
    callMcpInstaller({ userId: 1, tool: "install", args: { repo: "acme/powerworld-mcp", name: "PowerWorld", launch: "npx", package: "powerworld-mcp" }, permissionGranted: false }),
    error => error.status === 428 && error.code === "connected_app_permission_required" && error.message.includes("npx -y powerworld-mcp"),
  );
  assert.equal(state.saved.length, 0);
});

test("an approved install saves a connection every later turn discovers and reports its tools", async () => {
  const result = await callMcpInstaller({ userId: 1, tool: "install", args: { repo: "acme/kicad-mcp", name: "KiCad", launch: "uvx", command: "kicad-mcp" }, permissionGranted: true });
  assert.equal(result.installedSlug, "kicad");
  assert.deepEqual(state.saved[0].args, ["--from", "git+https://github.com/acme/kicad-mcp", "kicad-mcp"]);
  assert.equal(state.saved[0].transport, "local");
  assert.equal(state.saved[0].approved, true);
  assert.deepEqual(result.data.tools.map(tool => tool.name), ["run_case"]);
});

test("a server that does not start is disabled rather than advertised", async () => {
  state.status = "failed";
  await assert.rejects(
    callMcpInstaller({ userId: 1, tool: "install", args: { repo: "acme/x", launch: "remote", url: "https://example.com/mcp" }, permissionGranted: true }),
    error => error.code === "mcp_install_not_connected" && error.message.includes("spawn failed"),
  );
  assert.deepEqual(state.disabled, [{ id: 7, enabled: false }]);
});

test("invalid repositories and launches are refused", async () => {
  await assert.rejects(callMcpInstaller({ userId: 1, tool: "install", args: { repo: "../../etc", launch: "npx" }, permissionGranted: true }), /owner\/name/);
  await assert.rejects(callMcpInstaller({ userId: 1, tool: "install", args: { repo: "a/b", launch: "curl" }, permissionGranted: true }), /launch must be/);
  await assert.rejects(callMcpInstaller({ userId: 1, tool: "install", args: { repo: "a/b", launch: "clone" }, permissionGranted: true }), /clone needs command/);
});

test("install_app asks before winget runs and refuses anything but an exact package Id", async () => {
  await assert.rejects(
    callMcpInstaller({ userId: 1, tool: "install_app", args: { wingetId: "FreeCAD.FreeCAD" }, permissionGranted: false }),
    error => error.status === 428 && error.message.includes("winget install --id FreeCAD.FreeCAD --exact --silent"),
  );
  await assert.rejects(
    callMcpInstaller({ userId: 1, tool: "install_app", args: { wingetId: "x & calc" }, permissionGranted: true }),
    error => error.code === "invalid_winget_id",
  );
});

test("a whole command written into launch is read as launcher plus package", async () => {
  await assert.rejects(
    callMcpInstaller({ userId: 1, tool: "install", args: { repo: "neka-nat/freecad-mcp", name: "FreeCAD", launch: "uvx freecad-mcp" }, permissionGranted: false }),
    error => error.status === 428 && error.message.endsWith("uvx freecad-mcp"),
  );
});
