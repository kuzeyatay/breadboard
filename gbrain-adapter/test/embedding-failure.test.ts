import { test, expect, afterAll } from "bun:test";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { GBrainEngineBackend, isEmbeddingFailure } from "../src/backends/gbrain-backend.ts";

// The packaged app's embedding provider is ChatMock's local model. When it
// answers 503 (model not provisioned) or is unreachable, indexing used to throw
// and the adapter returned a bare internal_error: no garden got an index at
// all. It now stores the pages for keyword search and says so.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gbrain-embed-fail-"));

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

test("a failing embedding provider still indexes pages for keyword search", async () => {
  const port = await closedPort();
  const backend = new GBrainEngineBackend({
    pgDir: path.join(tmpDir, "pglite"),
    embeddingEnv: {
      provider: "openai-compatible",
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: "local",
      model: "local/bge-small-en-v1.5",
      dimensions: 384,
      testMode: false,
    },
  });
  await backend.init();
  try {
    expect(backend.embeddingsAvailable).toBe(true);
    const result = await backend.registerSource("embed-fail-src", "smoke/fixture", [
      { pageId: "ohms", title: "Ohm's Law", path: "ohms.md", content: "Voltage equals current times resistance across a resistor." },
    ]);
    expect(result.pagesIndexed).toBe(1);
    expect(result.embedded).toBe(false);
    expect(result.warnings.some((warning) => warning.includes("keyword search only"))).toBe(true);

    const found = await backend.search(
      { userId: "1", authorizedSourceIds: ["embed-fail-src"] },
      "voltage current resistance",
    );
    expect(found.results.some((row) => row.citation?.pageId === "ohms")).toBe(true);
  } finally {
    await backend.close();
  }
}, 180_000);

test("only provider failures fall back; other errors still surface", () => {
  const transient = new Error("[embed(openai:local/bge-small-en-v1.5)] Failed after 3 attempts.");
  transient.name = "AITransientError";
  expect(isEmbeddingFailure(transient)).toBe(true);
  const config = new Error("bad endpoint");
  config.name = "AIConfigError";
  expect(isEmbeddingFailure(config)).toBe(true);
  expect(isEmbeddingFailure(new Error("disk full"))).toBe(false);
  expect(isEmbeddingFailure("nope")).toBe(false);
});
