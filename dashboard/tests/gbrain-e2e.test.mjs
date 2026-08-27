import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// True end-to-end: canonical markdown pages -> durable GBrain indexing (real Node
// adapter over PGLite) -> authenticated scoped query through the dashboard trust
// boundary -> mapped Breadboard citation. Opt-in because it starts the real engine.
//   BREADBOARD_TEST_GBRAIN_E2E=1 node --test --experimental-strip-types tests/gbrain-e2e.test.mjs
const ENABLED = process.env.BREADBOARD_TEST_GBRAIN_E2E === "1";

const repoRoot = path.resolve(process.cwd(), "..");
const PORT = 7799;
const SECRET = crypto.randomBytes(16).toString("hex");

process.env.QUARTZ_CONTENT_PATH = process.env.QUARTZ_CONTENT_PATH || path.join(os.tmpdir(), "gbrain-e2e-content");
process.env.GBRAIN_MODE = "preferred";
process.env.GBRAIN_ADAPTER_URL = `http://127.0.0.1:${PORT}`;
process.env.GBRAIN_ADAPTER_SECRET = SECRET;

async function waitForHealth(url, child, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return false;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const forceTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    forceTimer.unref();
    child.once("exit", () => {
      clearTimeout(forceTimer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

test("end-to-end: canonical markdown -> durable index -> scoped query -> mapped citation", { skip: !ENABLED }, async () => {
  const pgDir = fs.mkdtempSync(path.join(os.tmpdir(), "gbrain-e2e-"));
  const adapter = spawn(process.execPath, [
    "--no-warnings",
    "--experimental-transform-types",
    path.join(repoRoot, "gbrain-adapter", "src", "node-entrypoint.mjs"),
  ], {
    env: {
      ...process.env,
      GBRAIN_ADAPTER_HOST: "127.0.0.1",
      GBRAIN_ADAPTER_PORT: String(PORT),
      GBRAIN_ADAPTER_SECRET: SECRET,
      GBRAIN_PG_DIR: pgDir,
      GBRAIN_EMBEDDING_PROVIDER: "none",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let adapterOutput = "";
  const capture = (chunk) => {
    adapterOutput = `${adapterOutput}${chunk}`.slice(-8_000);
  };
  adapter.stdout.setEncoding("utf8");
  adapter.stderr.setEncoding("utf8");
  adapter.stdout.on("data", capture);
  adapter.stderr.on("data", capture);

  try {
    assert.ok(
      await waitForHealth(`http://127.0.0.1:${PORT}/health`, adapter),
      `adapter did not become healthy\n${adapterOutput}`,
    );

    const dbMod = await import("../src/lib/db.ts");
    const db = dbMod.default;
    const { getOrCreateSourceMapping } = await import("../src/lib/gbrain/mapping.ts");
    const { GBrainClient } = await import("../src/lib/gbrain/client.ts");
    const { issueCapabilityToken } = await import("../src/lib/hermes/capability-token.ts");
    const { executeGBrainTool, GBRAIN_TOOLS } = await import("../src/lib/hermes/gbrain-tools.ts");

    const suffix = crypto.randomBytes(3).toString("hex");
    const slug = `gbrain-e2e-${suffix}`;
    const userId = Number(
      db.prepare("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)").run(`u-${suffix}`, `u-${suffix}@x.com`, "h").lastInsertRowid,
    );
    const clusterId = Number(
      db.prepare("INSERT INTO clusters (user_id, name, slug) VALUES (?, ?, ?)").run(userId, "E2E Garden", slug).lastInsertRowid,
    );

    try {
      // Simulate canonical content already scanned into index pages, then index
      // it durably through the real adapter (what syncGarden does internally).
      const mapping = getOrCreateSourceMapping(clusterId, slug);
      const client = new GBrainClient();
      const reg = await client.registerSource(mapping.sourceId, slug, [
        {
          pageId: "kirchhoff",
          title: "Kirchhoff's Laws",
          path: "circuits/kirchhoff.md",
          content: "Kirchhoff's current law says the sum of currents into a node is zero on a breadboard circuit.",
          links: [],
        },
      ]);
      assert.equal(reg.pagesIndexed, 1);

      // Authenticated scoped query through the full trust boundary.
      const token = issueCapabilityToken({
        userId,
        surface: "garden_chat",
        hermesSessionId: `oh-${suffix}`,
        allowedGardenIds: [clusterId],
        activeGardenId: clusterId,
        allowedTools: [...GBRAIN_TOOLS],
      });
      const res = await executeGBrainTool({
        rawToken: token,
        tool: "gbrain_search",
        args: { gardenId: slug, query: "current law node" },
      });
      assert.equal(res.ok, true);
      assert.ok(res.data.results.length > 0, "expected at least one grounded result");
      const citation = res.data.results[0].citation;
      assert.equal(citation.gardenId, slug);
      assert.equal(citation.pageSlug, "kirchhoff");
      assert.equal(citation.path, `/${slug}/kirchhoff`);
      // Internal source id must never surface.
      assert.ok(!JSON.stringify(res.data).includes(mapping.sourceId));
    } finally {
      db.prepare("DELETE FROM clusters WHERE id = ?").run(clusterId);
      db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    }
  } finally {
    await stopChild(adapter);
    fs.rmSync(pgDir, { recursive: true, force: true });
  }
});
