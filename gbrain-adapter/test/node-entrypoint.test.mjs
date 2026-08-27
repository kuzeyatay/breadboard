import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const adapterRoot = fileURLToPath(new URL("..", import.meta.url));

async function reserveLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

function waitForListening(child, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    let output = "";
    const expected = `[gbrain-adapter] listening on 127.0.0.1:${port}`;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`entrypoint readiness timed out: ${output}`));
    }, timeoutMs);
    const onData = (chunk) => {
      output += chunk.toString();
      if (output.includes(expected)) {
        cleanup();
        resolve(output);
      }
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(
        new Error(
          `entrypoint exited before readiness (code=${code}, signal=${signal}): ${output}`,
        ),
      );
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      child.off("exit", onExit);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", onExit);
  });
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("entrypoint did not terminate"));
    }, timeoutMs);
    const onExit = (code, signal) => {
      cleanup();
      resolve({ code, signal });
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("exit", onExit);
    };
    child.once("exit", onExit);
  });
}

test("production Node entrypoint reaches readiness and leaves no child process", {
  timeout: 20_000,
}, async () => {
  const port = await reserveLoopbackPort();
  const child = spawn(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-transform-types",
      "./src/node-entrypoint.mjs",
    ],
    {
      cwd: adapterRoot,
      env: {
        ...process.env,
        NODE_OPTIONS: "",
        GBRAIN_ADAPTER_HOST: "127.0.0.1",
        GBRAIN_ADAPTER_PORT: String(port),
        GBRAIN_ADAPTER_SECRET: "entrypoint-test-secret-12345",
        GBRAIN_ADAPTER_MEMORY: "1",
        GBRAIN_BACKEND: "fake",
        GBRAIN_TEST_MODE: "1",
        GBRAIN_EMBEDDING_PROVIDER: "none",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  try {
    await waitForListening(child, port, 10_000);
    const ready = await fetch(`http://127.0.0.1:${port}/ready`);
    const body = await ready.json();
    assert.equal(ready.status, 200);
    assert.equal(body.ready, true);
    assert.equal(body.backend, "fake");

    assert.equal(child.kill("SIGTERM"), true);
    const exited = await waitForExit(child, 5_000);
    if (process.platform !== "win32") assert.equal(exited.code, 0);
    assert.ok(child.exitCode !== null || child.signalCode !== null);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await waitForExit(child, 5_000).catch(() => {});
    }
  }
});
