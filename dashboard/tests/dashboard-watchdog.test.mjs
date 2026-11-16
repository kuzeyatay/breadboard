import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appendDiagnostic } from "../scripts/runtime-v2-dashboard-diagnostics.mjs";

const data = fs.mkdtempSync(path.join(os.tmpdir(), "watchdog-"));
fs.mkdirSync(path.join(data, "logs"));
test.after(() => fs.rmSync(data, { recursive: true, force: true }));
const manifestPath = path.join(data, "routes-manifest.json");
fs.writeFileSync(manifestPath, JSON.stringify({ staticRoutes: [{ page: "/api/earlier" }],
  dynamicRoutes: [{ page: "/api/culprit/[id]", regex: "^/api/culprit/([^/]+)$" }] }));

const watchdogUrl = new URL("../scripts/runtime-v2-dashboard-watchdog.mjs", import.meta.url).href;

function fixture(behavior, env = {}) {
  const source = `
    import http from 'node:http';
    import { startDashboardWatchdog } from ${JSON.stringify(watchdogUrl)};
    const server = http.createServer((req, res) => { res.statusCode = 503; res.end('dependency unavailable'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    startDashboardWatchdog({port, intervalMs: 50, timeoutMs: 100, failureLimit: 4, manifestPath: ${JSON.stringify(manifestPath)}});
    // No startup kill before the first response, even after several probes.
    await new Promise(resolve => setTimeout(resolve, 600));
    await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
    await new Promise(resolve => setTimeout(resolve, 300));
    ${behavior}
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, BREADBOARD_DATA_DIR: data, ...env } });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`Watchdog fixture timed out: ${output}`)); }, 15_000);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal, output }); });
  });
}

test("dashboard watchdog tolerates cold startup, HTTP errors and a transient outage", async () => {
  const result = await fixture(`
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => setTimeout(resolve, 70));
    await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
    await new Promise(resolve => setTimeout(resolve, 600));
    console.log('responsive'); process.exit(0);
  `);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /responsive/);
});

test("dashboard watchdog ends a service whose main event loop stops accepting requests", async () => {
  const result = await fixture(`
    console.log('stalling');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60_000);
    console.log('missed-stall'); process.exit(0);
  `);
  assert.match(result.output, /stalling/);
  assert.doesNotMatch(result.output, /missed-stall/);
  assert.ok(result.code !== 0 || result.signal, result.output);
});

test("dashboard watchdog ends a service stuck in native code, where no stack can be taken", async () => {
  // A synchronous database query looks like this: the thread never returns to JavaScript, so the inspector gets no answer.
  const result = await fixture(`
    await fetch('http://127.0.0.1:' + port + '/api/earlier');
    // The handler of this request is where the server gets stuck.
    server.prependListener('request', request => { if (request.url.startsWith('/api/culprit')) { console.log('stalling'); spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']); } });
    const { spawnSync } = await import('node:child_process');
    await fetch('http://127.0.0.1:' + port + '/api/culprit/private-id?view=private-search');
    console.log('missed-stall'); process.exit(0);
  `, { BREADBOARD_DATA_DIR: data });
  assert.match(result.output, /stalling/);
  assert.doesNotMatch(result.output, /missed-stall/);
  assert.ok(result.code !== 0 || result.signal, result.output);
  const log = fs.readFileSync(path.join(data, 'logs', 'dashboard-watchdog.log'), 'utf8');
  assert.match(log, /GET \/api\/earlier\n.*GET \/api\/culprit\/\[id\]\n/, log);
  assert.doesNotMatch(log, /api\/health/, 'the probe does not list itself');
  const diagnostics = fs.readFileSync(path.join(data, "logs", "dashboard-diagnostics.jsonl"), "utf8");
  assert.doesNotMatch(log + diagnostics, /private-id|private-search/);
  const samples = diagnostics.trim().split("\n").map(line => JSON.parse(line));
  const exit = samples.filter(row => row.event === "watchdog-restart").at(-1);
  assert.ok(exit.mainMemory.heapUsed > 0 && exit.mainMemory.heapLimit > exit.mainMemory.heapUsed);
  assert.ok(exit.rssBytes > 0 && exit.failedProbes === 4 && exit.sampleAgeMs > 0);
  assert.equal(exit.recentRequests.at(-1).route, "/api/culprit/[id]");
  assert.equal(exit.recentRequests.at(-1).outcome, "in-flight");
  assert.equal(exit.recentRequests.at(-2).status, 503);
  assert.ok(samples.some(row => row.pid === exit.pid && row.event === "ready"));
});

test("the exception observer preserves the fatal exit and its stack", async () => {
  const result = await fixture(`setImmediate(() => { const error = new Error("fixture"); error.code = "ERR_FIXTURE"; throw error; });`);
  assert.equal(result.code, 1, result.output);
  const line = result.output.split("\n").find(line => line.startsWith("[dashboard-exception] "));
  const crash = JSON.parse(line.slice("[dashboard-exception] ".length));
  assert.equal(crash.code, "ERR_FIXTURE");
  assert.ok(crash.frames.length && crash.memory.heapUsed);
});

test("diagnostic rotation retains the previous complete segment", () => {
  const file = path.join(data, "logs", "rotation.jsonl");
  for (const line of ["aaa\n", "bbb\n", "ccc\n", "ddd\n", "eee\n"]) appendDiagnostic(file, line, 8);
  assert.equal(fs.readFileSync(file, "utf8"), "eee\n");
  assert.equal(fs.readFileSync(file + ".1", "utf8"), "ccc\nddd\n");
});
