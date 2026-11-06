import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { spawn } from "node:child_process";

test("gateway completes cleanup and exits while the native stop pipe remains open", { timeout: 15000 }, async () => {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const helper = new URL("../scripts/runtime-v2-gateway-http.mjs", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", `
    import {startRuntimeV2GatewayHttpService} from ${JSON.stringify(helper)};
    await startRuntimeV2GatewayHttpService({
      name:'isolated-stop-test',tokenEnvironmentName:'FIXTURE_SERVICE_TOKEN',argv:['--port','${port}'],
      route:async()=>({}),onStop:async()=>{
        await new Promise(resolve=>setTimeout(resolve,100));
        process.stdout.write('cleanup-complete\\n');
      }
    });
    process.stdout.write('ready\\n');
  `], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: {
    SystemRoot: process.env.SystemRoot,
    FIXTURE_SERVICE_TOKEN: "synthetic-gateway-test-token-0123456789",
  }});
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const exited = new Promise(resolve => child.once("exit", (code, signal) => resolve({code, signal})));
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    for (let n = 0; n < 100 && !stdout.includes("ready"); n++) await sleep(25);
    assert.match(stdout, /ready/u, stderr);
    const stopAt = Date.now();
    // Keep the parent end open exactly as the native supervisor does. EOF must
    // not be needed, and the child must not exit before its async cleanup.
    child.stdin.write('{"type":"stop","force":false}\n');
    const result = await Promise.race([exited, sleep(2500).then(() => null)]);
    assert.notEqual(result, null, `gateway retained its native control pipe: ${stderr}`);
    assert.deepEqual(result, {code: 0, signal: null});
    assert.match(stdout, /cleanup-complete/u);
    assert.ok(Date.now() - stopAt >= 90, "cleanup must finish before natural process exit");
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
});
