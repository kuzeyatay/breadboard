import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after, beforeEach } from "node:test";
import { build } from "esbuild";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-flow-connection-"));
const state = { root, records: new Map(), calls: [], replies: new Map(), discovered: true };
globalThis.__flowConnectionTest = state;
const requiredTools = ["flow_help", "flow_list_accounts", "flow_inspect_account", "flow_generate_video", "flow_job_status", "flow_download_job"];
const stubs = {
  "node:util": `export const promisify = value => value;`,
  "node:child_process": `export async function execFile(executable, args, options) {
    const s = globalThis.__flowConnectionTest; s.calls.push({kind:'verify',executable,args,options});
    if(s.verifyError) throw Object.assign(new Error('process failed'), {stdout:JSON.stringify({error:s.verifyError})});
    return {stdout:JSON.stringify({connected:true})};
  }`,
  "../runtime-paths.ts": `export const repositoryRoot = () => globalThis.__flowConnectionTest.root; export const dashboardDataDir = repositoryRoot;`,
  "./route-core.ts": `export class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }`,
  "./mcp-connections.ts": `
    const state = () => globalThis.__flowConnectionTest;
    export const getMcpConnectionBySlug = user => state().records.get(user);
    export const parseMcpConfig = value => value;
    export const runtimeMcpConfig = value => value;
    export function saveMcpConnection(user, config) { const record = { ...config, id: user, enabled: true }; state().records.set(user, record); return record; }
    export function setMcpConnectionEnabled(user, id, enabled) { state().records.get(user).enabled = enabled; }
  `,
  "../agent-runtime/mcp-proxy.ts": `
    const state = () => globalThis.__flowConnectionTest;
    export async function addProxyMcpConnection(userId, slug, config) { state().calls.push({ kind: 'add', userId, slug, config }); return { [slug]: { status: 'connected' } }; }
    export function proxyMcpTools() { return state().discovered ? ${JSON.stringify(requiredTools)}.map(name => ({ name })) : []; }
    export async function setProxyMcpConnectionConnected(userId, slug, connected) { state().calls.push({kind:'disconnect', userId, slug, connected}); }
    export async function callProxyMcpTool(input) { state().calls.push(input); return state().replies.get(input.tool) ?? {content:[{type:'text',text:'{}'}]}; }
  `,
};
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/hermes/google-flow-connection.ts", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
  plugins: [{ name: "isolated-flow-connection", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: "fixture" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path] }));
  } }],
});
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { googleFlowPaths, googleFlowConnectionStatus, googleFlowAccountStatus, updateGoogleFlowConnection, parseGoogleFlowResult } = module.exports;
const reply = value => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const paths = googleFlowPaths(1);
for (const file of [paths.entry, paths.launcher, paths.connector, paths.browserAdapter]) {
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "{}");
}
beforeEach(() => {
  state.records.clear(); state.calls.length = 0; state.replies.clear(); state.discovered = true;
  state.verifyError = null;
});
after(async () => { await updateGoogleFlowConnection(1, {action:'disable'}); delete globalThis.__flowConnectionTest; fs.rmSync(root, { recursive: true, force: true }); });

test("status is observational and account data stays scoped and private", () => {
  assert.notEqual(googleFlowPaths(1).data, googleFlowPaths(2).data);
  assert.throws(() => googleFlowPaths(-1));
  assert.equal(googleFlowConnectionStatus(1).connected, false);
  assert.equal(state.calls.length, 0);
  const status = googleFlowAccountStatus({ defaultAccountId: "unverified", accounts: [
    { id: "unverified", label: "Not ready", connectionStatus: "unverified" },
    { id: "personal", label: "Personal", connectionStatus: "connected", cdpUrl: "private", cookies: ["secret"] },
  ] });
  assert.deepEqual(status, { connected: true, accountLabel: "Personal", lastValidatedAt: null });
});

test("connect seals only the native command and never generates", async () => {
  const result = await updateGoogleFlowConnection(1, {action:"connect", executable:"untrusted.exe", args:["secret"], cdpUrl:"http://untrusted"});
  assert.equal(result.connected, false);
  assert.equal(result.background, true);
  const config = state.records.get(1);
  assert.equal(config.executable, process.execPath);
  assert.deepEqual(config.args, ["--import", pathToFileURL(paths.launcher).href, paths.entry, paths.data]);
  assert.equal(config.timeout, 120_000);
  assert.deepEqual(config.environmentNames, []);
  const verify = state.calls.find(call => call.kind === 'verify');
  assert.equal(verify.executable, process.execPath);
  assert.deepEqual(verify.args, [paths.connector, paths.data]);
  assert.equal(verify.options.windowsHide, true);
  assert.deepEqual(state.calls.filter(call => call.tool).map(call => call.tool), ["flow_list_accounts"]);
});

test("old extension actions cannot start an external browser", async () => {
  for(const action of ["begin","complete"]) await assert.rejects(updateGoogleFlowConnection(1,{action}), error=>error.code==='flow_invalid_action');
  assert.deepEqual(state.calls, []);
});

test("a native verifier failure is not reported as connected", async () => {
  state.verifyError = "Sign in to Google in Breadboard's browser.";
  await assert.rejects(updateGoogleFlowConnection(1,{action:"connect"}), /Sign in to Google/);
  assert.equal(state.calls.some(call=>call.tool==='flow_generate_video'), false);
});

test("a verified workspace uses the discovered default account", async () => {
  state.replies.set("flow_list_accounts", reply({readyForGeneration:true,defaultAccountId:"breadboard",accounts:[
    {id:"breadboard",label:"Breadboard browser",connectionStatus:"connected"}
  ]}));
  const result=await updateGoogleFlowConnection(1,{action:"connect"});
  assert.equal(result.connected,true);
  assert.equal(result.accountLabel,"Breadboard browser");
});

test("disable closes the connection and refresh never silently enables it", async () => {
  await updateGoogleFlowConnection(1, { action: "connect" });
  await updateGoogleFlowConnection(1, { action: "disable" });
  state.calls.length = 0;
  const result = await updateGoogleFlowConnection(1, { action: "refresh" });
  assert.equal(result.enabled, false);
  assert.deepEqual(state.calls, []);
});

test("missing tool discovery and upstream errors never become connection success", async () => {
  state.discovered = false;
  await assert.rejects(updateGoogleFlowConnection(1, { action: "connect" }), error => error.code === "flow_tools_missing");
  assert.equal(state.calls.filter(call => call.tool).length, 0);
  assert.throws(() => parseGoogleFlowResult({ isError: true, content: [{ type: "text", text: "session_not_sent" }] }), /session_not_sent/);
  assert.throws(() => parseGoogleFlowResult(reply([])), /invalid connection response/);
});
