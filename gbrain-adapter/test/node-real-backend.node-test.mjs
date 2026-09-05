import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GBRAIN_BACKEND = "gbrain";
process.env.GBRAIN_TEST_MODE = "1";
process.env.GBRAIN_EMBEDDING_PROVIDER = "none";

const { startNodeAdapter } = await import("../src/node-server.ts");
const { MIGRATIONS } = await import("../../gbrain/src/core/migrate.ts");

const SECRET = "node-real-secret-12345";

async function request(origin, pathname, body) {
  return fetch(`${origin}${pathname}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${SECRET}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

test("Node initializes, serves, and reopens the real vendored GBrain backend", async () => {
  const pgDir = fs.mkdtempSync(path.join(os.tmpdir(), "gbrain-node-real-"));
  let server = null;
  try {
    server = await startNodeAdapter({
      host: "127.0.0.1",
      port: 0,
      secret: SECRET,
      pgDir,
      embeddingProvider: "none",
    });
    let origin = `http://127.0.0.1:${server.port}`;
    const health = await (await fetch(`${origin}/health`)).json();
    assert.equal(health.ready, true);
    assert.equal(health.backend, "gbrain");

    const latestVersion = Math.max(...MIGRATIONS.map(({ version }) => version));
    const appliedVersion = Number(await server.store.engine.getConfig("version"));
    assert.equal(appliedVersion, latestVersion);

    const registered = await request(origin, "/register-source", {
      sourceId: "node-real",
      label: "Node real backend",
      pages: [
        {
          pageId: "migration-probe.ts",
          title: "Migration probe",
          content:
            "export function migrationProbe(value: number): number { return value + 123; }",
        },
      ],
    });
    assert.equal(registered.status, 200);
    assert.equal((await registered.json()).data.pagesIndexed, 1);

    const searched = await request(origin, "/search", {
      scope: { userId: "node-real-user", authorizedSourceIds: ["node-real"] },
      query: "migration probe",
    });
    assert.equal(searched.status, 200);
    assert.ok((await searched.json()).data.results.length > 0);

    await server.stop();
    server = null;

    server = await startNodeAdapter({
      host: "127.0.0.1",
      port: 0,
      secret: SECRET,
      pgDir,
      embeddingProvider: "none",
    });
    origin = `http://127.0.0.1:${server.port}`;
    const reopened = await (await fetch(`${origin}/health`)).json();
    assert.equal(reopened.backend, "gbrain");
    assert.equal(reopened.pages, 1);
    assert.ok(reopened.chunks > 0);

    const removed = await request(origin, "/remove-source", {
      sourceId: "node-real",
    });
    assert.equal(removed.status, 200);
    assert.deepEqual((await removed.json()).data, {
      sourceId: "node-real",
      removed: true,
      pagesDeleted: 1,
    });
    const empty = await (await fetch(`${origin}/health`)).json();
    assert.equal(empty.sources, health.sources);
    assert.equal(empty.pages, 0);
    assert.equal(empty.chunks, 0);

    const removedAgain = await request(origin, "/remove-source", {
      sourceId: "node-real",
    });
    assert.equal((await removedAgain.json()).data.removed, false);
  } finally {
    if (server) await server.stop();
    fs.rmSync(pgDir, { recursive: true, force: true });
  }
});
