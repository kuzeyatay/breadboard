import { test, expect, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// These tests exercise the HTTP trust boundary and use the deterministic FAKE
// backend explicitly (the production default is the real vendored GBrain engine).
process.env.GBRAIN_BACKEND = "fake";
process.env.GBRAIN_TEST_MODE = "1";
import { startAdapter } from "../src/server.ts";
import { GBrainStore } from "../src/store.ts";

const SECRET = "test-secret-12345";
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gbrain-adapter-"));

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Port 0 asks the OS for a free port and every caller reads `s.port` back, so
// these tests can never collide with a Breadboard service that happens to be
// running (7731 is the CAD service; the adapter itself owns 7717).
async function boot(pgDir: string) {
  return startAdapter({ port: 0, secret: SECRET, pgDir, host: "127.0.0.1", embeddingProvider: "hash" });
}

test("adapter refuses to start without a secret", async () => {
  await expect(startAdapter({ port: 0, secret: "", pgDir: ":memory:" })).rejects.toThrow(/secret/i);
});

test("health is reachable and never leaks the secret or a path", async () => {
  const s = await boot(":memory:");
  const res = await fetch(`http://127.0.0.1:${s.port}/health`);
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.status).toBe("healthy");
  expect(JSON.stringify(body)).not.toContain(SECRET);
  expect(JSON.stringify(body)).not.toContain(tmpDir);
  await s.stop();
});

test("requests without the secret are rejected", async () => {
  const s = await boot(":memory:");
  const res = await fetch(`http://127.0.0.1:${s.port}/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scope: { userId: "1", authorizedSourceIds: ["x"] }, query: "y" }),
  });
  expect(res.status).toBe(401);
  const body = await res.json();
  expect(body.error).toBe("unauthorized");
  await s.stop();
});

test("missing scope fails closed at the HTTP boundary", async () => {
  const s = await boot(":memory:");
  const res = await fetch(`http://127.0.0.1:${s.port}/search`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
    body: JSON.stringify({ query: "y" }),
  });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("missing_scope");
  await s.stop();
});

test("errors never contain a stack, path, or secret", async () => {
  const s = await boot(":memory:");
  const res = await fetch(`http://127.0.0.1:${s.port}/search`, {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}` },
    body: "not json",
  });
  const text = await res.text();
  expect(text).not.toContain("Error");
  expect(text).not.toContain(SECRET);
  expect(JSON.parse(text).error).toBe("invalid_json");
  await s.stop();
});

test("end-to-end: register -> durable persistence across restart -> scoped query -> citation", async () => {
  const pgDir = path.join(tmpDir, "e2e-pglite");
  const s1 = await boot(pgDir);
  const reg = await fetch(`http://127.0.0.1:${s1.port}/register-source`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
    body: JSON.stringify({
      sourceId: "src-e2e",
      label: "garden/e2e",
      pages: [
        {
          pageId: "ohms-law",
          title: "Ohm's Law",
          path: "e2e/ohms-law.md",
          content: "Ohm's law states that voltage equals current times resistance across a resistor.",
        },
      ],
    }),
  });
  expect((await reg.json()).data.pagesIndexed).toBe(1);
  await s1.stop(); // flush + close the PGLite dir

  // Reopen the SAME directory in a fresh process-like store: data must survive.
  const s2 = await boot(pgDir);
  const search = await fetch(`http://127.0.0.1:${s2.port}/search`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
    body: JSON.stringify({ scope: { userId: "1", authorizedSourceIds: ["src-e2e"] }, query: "voltage resistance" }),
  });
  const body = await search.json();
  expect(body.data.results.length).toBeGreaterThan(0);
  expect(body.data.results[0].citation.sourceId).toBe("src-e2e");
  expect(body.data.results[0].citation.pageId).toBe("ohms-law");
  expect(body.data.results[0].citation.path).toBe("e2e/ohms-law.md");
  await s2.stop();
});
