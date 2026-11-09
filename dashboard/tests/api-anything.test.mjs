import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { fileURLToPath } from "node:url";
import test, { before, after } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { callApiAnythingTool, callApiAnythingAgentTool, apiAnythingPaths } from "../scripts/api-anything-client.mjs";
import { apiAnythingResult } from "../scripts/api-anything-contract.mjs";
import { buildApiAnything, stageApiAnything } from "../scripts/build-api-anything.mjs";
import { apiAnythingMcpServer, withApiAnythingMcp } from "../src/lib/api-anything/agents.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-api-anything-"));
const previousKey = process.env.API_ANYTHING_KEY;
let server, origin;
const calls = [];
const todos = [];

before(async () => {
  process.env.API_ANYTHING_KEY = "breadboard-api-anything-test-key-only";
  await buildApiAnything();
  server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const url = new URL(req.url, "http://localhost");
    calls.push({ path: url.pathname, method: req.method, body });
    if (url.pathname === "/slow") return;
    const status = url.pathname === "/blocked" ? 403 : url.pathname === "/auth" ? 401 : url.pathname === "/rate" ? 429 : 200;
    if (req.method === "POST") todos.push(JSON.parse(body));
    res.writeHead(status, { "content-type": "application/json", ...(status === 429 ? { "retry-after": "30" } : {}) });
    res.end(JSON.stringify(url.pathname === "/todos" ? { todos } : { value: url.searchParams.get("q") ?? url.pathname }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  if (previousKey === undefined) delete process.env.API_ANYTHING_KEY; else process.env.API_ANYTHING_KEY = previousKey;
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

function install(userId, site, pathname = "/read", extra = {}) {
  const directory = path.join(apiAnythingPaths({ repoRoot, dataRoot, userId }).home, "sites");
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${site}.json`);
  const spec = { name: site, baseUrl: origin, operations: [{ name: "read", readOnly: true,
    request: { method: "GET", url: `${origin}${pathname}?q=example`, headers: {} },
    slots: [{ param: "q", at: ["query:q"] }], params: [{ name: "q", required: true }],
    trigger: { url: `${origin}/?q={q}` }, response: { extract: "value" }, ...extra }] };
  fs.writeFileSync(file, JSON.stringify(spec));
  return { file, spec };
}

const call = (tool, args = {}, options = {}) => callApiAnythingTool({ repoRoot, dataRoot, userId: 11, tool, args, ...options });

test("embedded runtime discovers bundled sites and exact parameter schemas without network", async () => {
  const status = await call("status");
  assert.equal(status.ok, true);
  assert.ok(status.sites >= 114);
  assert.ok(status.operations >= 323);
  const found = await call("find_sites", { query: "https://news.ycombinator.com/item?id=1" });
  assert.equal(found.sites[0].name, "hacker-news");
  const description = await call("describe_site", { site: "hacker-news" });
  assert.ok(description.operations.find(op => op.op === "search").params.properties.query);
  assert.equal(calls.length, 0);
});

test("real upstream host sends HTTP, extracts data and requires no browser", async () => {
  install(11, "http-fixture");
  const result = await call("call_operation", { site: "http-fixture", operation: "read", args: { q: "bread & board" } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.tier, 1);
  assert.equal(result.data, "bread & board");
  assert.equal(result.fallback.recommended, false);
  assert.ok(!fs.existsSync(path.join(apiAnythingPaths({ repoRoot, dataRoot, userId: 11 }).home, "browser")));
});

test("unknown sites, operations and a missing runtime explicitly fall back", async () => {
  for (const result of [
    await call("find_sites", { query: "zzzz-no-such-website-zzzz" }),
    await call("call_operation", { site: "does-not-exist", operation: "read" }),
    await call("call_operation", { site: "hacker-news", operation: "doesNotExist" }),
    await call("status", {}, { repoRoot: path.join(dataRoot, "missing-program") }),
  ]) assert.equal(result.fallback.recommended, true);
});

test("blocked HTTP and authentication failure fall back; rate limits and invalid args do not", async () => {
  for (const endpoint of ["blocked", "auth", "rate"]) {
    const site = `failure-${endpoint}`;
    install(11, site, `/${endpoint}`);
    const result = await call("call_operation", { site, operation: "read", args: { q: "example" } });
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.fallback.recommended, endpoint !== "rate", JSON.stringify(result));
  }
  const invalid = await call("call_operation", { site: "http-fixture", operation: "read", args: {} });
  assert.equal(invalid.class, "input");
  assert.equal(invalid.fallback.recommended, false);
});

test("API Anything never starts its own browser for an operation requiring tier 2", async () => {
  install(11, "browser-required", "/read", { minTier: 2 });
  const before = calls.length;
  const result = await call("call_operation", { site: "browser-required", operation: "read", args: { q: "test" } });
  assert.equal(result.ok, false);
  assert.equal(result.fallback.recommended, true);
  assert.equal(calls.length, before);
});

test("accounts are isolated while requests execute concurrently", async () => {
  install(21, "private-fixture");
  install(22, "private-fixture");
  const [a, b] = await Promise.all([21, 22].map(userId => call("call_operation", {
    site: "private-fixture", operation: "read", args: { q: `account-${userId}` },
  }, { userId })));
  assert.equal(a.data, "account-21"); assert.equal(b.data, "account-22");
  const other = await call("describe_site", { site: "private-fixture" });
  assert.equal(other.class, "not_found");
  await assert.rejects(call("status", {}, { userId: 0 }), /authenticated/);
});

test("timeouts are bounded and cancellation never becomes permission to browse", async () => {
  install(11, "slow-fixture", "/slow");
  const started = Date.now();
  const result = await call("call_operation", { site: "slow-fixture", operation: "read", args: { q: "slow" } }, { timeoutMs: 700 });
  assert.equal(result.fallback.recommended, true);
  assert.ok(Date.now() - started < 5000);
  const controller = new AbortController();
  const pending = call("call_operation", { site: "slow-fixture", operation: "read", args: { q: "cancel" } }, { signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(pending, error => error.name === "AbortError");
});

test("write approval is bound to account, run, arguments and unchanged upstream plan", async () => {
  const { file, spec } = install(11, "write-fixture", "/todos", { response: { extract: "todos" } });
  spec.operations.push({ name: "add", readOnly: false, request: { method: "POST", url: `${origin}/todos`, headers: { "content-type": "application/json" }, body: '{"title":"example"}' },
    slots: [{ param: "title", at: ["body", "json:/title"] }], params: [{ name: "title", required: true }],
    trigger: { url: `${origin}/todos/{title}` }, readback: { op: "read", args: { q: "unused" }, find: { field: "title", equals: "{title}" } } });
  fs.writeFileSync(file, JSON.stringify(spec));
  const args = { site: spec.name, operation: "add", args: { title: "approved task" } };
  const planned = await call("call_operation", args, { scopeId: "run-1" });
  assert.equal(planned.approvalRequired, true, JSON.stringify(planned));
  assert.equal("pendingPlan" in planned, false);
  assert.equal(todos.length, 0);
  const wrongRun = await call("call_operation", args, { scopeId: "run-2", permissionGranted: true });
  assert.equal(wrongRun.approvalRequired, true);
  assert.equal(todos.length, 0);
  const applied = await call("call_operation", args, { scopeId: "run-1", permissionGranted: true });
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.equal(applied.write, "applied");
  assert.equal(todos.length, 1);
  assert.equal(applied.fallback.recommended, false);
  const changedArgs = { ...args, args: { title: "changed spec" } };
  await call("call_operation", changedArgs, { scopeId: "run-3" });
  spec.operations[1].description = "Changed after approval";
  fs.writeFileSync(file, JSON.stringify(spec));
  const refused = await call("call_operation", changedArgs, { scopeId: "run-3", permissionGranted: true });
  assert.equal(refused.class, "refused", JSON.stringify(refused));
  assert.equal(refused.write, "not_sent");
  assert.equal(todos.length, 1);
});

test("uncertain writes require verification before any browser retry", () => {
  for (const write of ["may_have_applied", "accepted", "applied", undefined]) {
    const result = apiAnythingResult({ ok: false, class: "error", write }, false);
    assert.equal(result.fallback.recommended, false);
    assert.equal(result.verifyBeforeRetry, true);
  }
});

test("standalone agent MCP uses the same real host and account scope", async () => {
  const oldData = process.env.BREADBOARD_DATA_DIR;
  process.env.BREADBOARD_DATA_DIR = dataRoot;
  const configured = apiAnythingMcpServer(11);
  const config = withApiAnythingMcp({ mcp: { existing: { enabled: true } } }, 11);
  assert.equal(config.mcp.existing.enabled, true);
  assert.equal(config.mcp.api_anything.environment.ELECTRON_RUN_AS_NODE, "1");
  const client = new Client({ name: "breadboard-api-test", version: "1" });
  const transport = new StdioClientTransport({ ...configured,
    env: { ...process.env, ...configured.env }, stderr: "pipe" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(tool => tool.name), ["find_sites", "describe_site", "call_operation", "status"]);
    const response = await client.callTool({ name: "call_operation", arguments: { site: "http-fixture", operation: "read", args: { q: "via MCP" } } });
    const result = JSON.parse(response.content[0].text);
    assert.equal(result.data, "via MCP", JSON.stringify(result));
  } finally {
    await client.close();
    if (oldData === undefined) delete process.env.BREADBOARD_DATA_DIR; else process.env.BREADBOARD_DATA_DIR = oldData;
  }
});

test("packaged source closure works without upstream node_modules", async () => {
  const staged = path.join(dataRoot, "staged-app");
  await stageApiAnything(staged);
  fs.mkdirSync(path.join(staged, "dashboard/scripts"), { recursive: true });
  for (const name of ["contract", "client", "dispatch", "worker"]) fs.copyFileSync(
    path.join(repoRoot, `dashboard/scripts/api-anything-${name}.mjs`), path.join(staged, `dashboard/scripts/api-anything-${name}.mjs`));
  const result = await call("call_operation", { site: "http-fixture", operation: "read", args: { q: "packaged" } }, { repoRoot: staged });
  assert.equal(result.data, "packaged", JSON.stringify(result));
  assert.equal(fs.existsSync(path.join(staged, "api-anything/node_modules")), false);
  assert.ok(fs.readFileSync(path.join(staged, "api-anything/breadboard/THIRD_PARTY_NOTICES.txt"), "utf8").includes("node-html-parser@"));
});

test("shared upstream agents get public APIs without accessing any user's private sites", async () => {
  install(1, "private-public-boundary");
  const client = new Client({ name: "public-api-test", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [path.join(repoRoot, "dashboard/scripts/api-anything-mcp.mjs"), "public", repoRoot, dataRoot],
    env: { ...process.env }, stderr: "pipe" });
  try {
    await client.connect(transport);
    const call = async (name, args) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
    assert.equal((await call("describe_site", { site: "private-public-boundary" })).class, "not_found");
    assert.equal((await call("status", {})).sites, 114);
  } finally { await client.close(); }
});

test("specialist tool wrapper rejects malformed arguments and executes real operations", async () => {
  const invalid = await callApiAnythingAgentTool({ userId: 11, input: null, repoRoot, dataRoot });
  assert.equal(invalid.class, "input");
  const result = await callApiAnythingAgentTool({ userId: 11, repoRoot, dataRoot,
    input: { action: "call_operation", site: "http-fixture", operation: "read", args: { q: "specialist" } } });
  assert.equal(result.data, "specialist");
});
