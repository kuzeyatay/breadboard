import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

const watchdogUrl = new URL("../scripts/runtime-v2-dashboard-watchdog.mjs", import.meta.url).href;

function fixture(behavior) {
  const source = `
    import http from 'node:http';
    import { startDashboardWatchdog } from ${JSON.stringify(watchdogUrl)};
    const server = http.createServer((req, res) => { res.statusCode = 503; res.end('dependency unavailable'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    startDashboardWatchdog({port, intervalMs: 50, timeoutMs: 100, failureLimit: 4});
    // No startup kill before the first response, even after several probes.
    await new Promise(resolve => setTimeout(resolve, 600));
    await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
    await new Promise(resolve => setTimeout(resolve, 300));
    ${behavior}
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`Watchdog fixture timed out: ${output}`)); }, 8_000);
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
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5_000);
    console.log('missed-stall'); process.exit(0);
  `);
  assert.match(result.output, /stalling/);
  assert.doesNotMatch(result.output, /missed-stall/);
  assert.ok(result.code !== 0 || result.signal, result.output);
});
