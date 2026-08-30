import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const servicePath = path.join(
  dashboardRoot,
  "scripts",
  "runtime-v2-quartz-static-service.mjs",
);

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(origin) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/__health`);
      if (response.ok) return await response.json();
    } catch {
      // The Runtime readiness loop has the same bounded startup race.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Quartz static service did not become ready");
}

test("Quartz Runtime service serves only prebuilt output and exits cleanly", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-quartz-static-"));
  const publicRoot = path.join(temporaryRoot, "quartz", "public");
  fs.mkdirSync(path.join(publicRoot, "garden"), { recursive: true });
  fs.writeFileSync(path.join(publicRoot, "index.html"), "<h1>Breadboard</h1>", "utf8");
  fs.writeFileSync(path.join(publicRoot, "garden", "index.html"), "<p>Garden</p>", "utf8");
  fs.mkdirSync(path.join(publicRoot, "garden", "sources"), { recursive: true });
  fs.writeFileSync(
    path.join(publicRoot, "garden", "sources", "firefly-brief.html"),
    "<p>FIREFLY-COPPER-17</p>",
    "utf8",
  );
  fs.writeFileSync(
    path.join(publicRoot, "garden", "sources", "1.1-numbered-lesson.html"),
    "<p>NUMBERED-LESSON-19</p>",
    "utf8",
  );
  fs.writeFileSync(path.join(temporaryRoot, "secret.txt"), "secret", "utf8");
  const port = await freePort();
  const child = spawn(process.execPath, [servicePath, "--port", String(port)], {
    env: {
      ...(process.platform === "win32"
        ? { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" }
        : {}),
      BREADBOARD_QUARTZ_PUBLIC_ROOT: publicRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-16 * 1024);
  });
  try {
    const origin = `http://127.0.0.1:${port}`;
    assert.deepEqual(await waitForHealth(origin), {
      ready: true,
      service: "quartz-static",
      published: true,
    });
    const index = await fetch(`${origin}/`);
    assert.equal(index.status, 200);
    assert.equal(await index.text(), "<h1>Breadboard</h1>");
    const garden = await fetch(`${origin}/garden/`);
    assert.equal(garden.status, 200);
    assert.equal(await garden.text(), "<p>Garden</p>");
    const cleanUrlRedirect = await fetch(
      `${origin}/garden/sources/firefly-brief/?refresh=x`,
      { redirect: "manual" },
    );
    assert.equal(cleanUrlRedirect.status, 302);
    assert.equal(
      cleanUrlRedirect.headers.get("location"),
      "/garden/sources/firefly-brief?refresh=x",
    );
    const article = await fetch(`${origin}${cleanUrlRedirect.headers.get("location")}`);
    assert.equal(article.status, 200);
    assert.equal(await article.text(), "<p>FIREFLY-COPPER-17</p>");
    const numberedLesson = await fetch(
      `${origin}/garden/sources/1.1-numbered-lesson`,
    );
    assert.equal(numberedLesson.status, 200);
    assert.equal(await numberedLesson.text(), "<p>NUMBERED-LESSON-19</p>");
    const numberedLessonRedirect = await fetch(
      `${origin}/garden/sources/1.1-numbered-lesson/?refresh=x`,
      { redirect: "manual" },
    );
    assert.equal(numberedLessonRedirect.status, 302);
    assert.equal(
      numberedLessonRedirect.headers.get("location"),
      "/garden/sources/1.1-numbered-lesson?refresh=x",
    );
    const traversal = await fetch(`${origin}/%2e%2e/secret.txt`);
    assert.equal(traversal.status, 404);
    const source = fs.readFileSync(servicePath, "utf8");
    assert.doesNotMatch(source, /node:child_process|\bspawn\s*\(|bootstrap-cli|esbuild/u);
  } finally {
    child.kill("SIGTERM");
    const exit = await new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
    assert.ok(exit.code === 0 || exit.signal === "SIGTERM", stderr);
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
