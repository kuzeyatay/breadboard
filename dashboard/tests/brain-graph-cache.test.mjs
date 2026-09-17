import assert from "node:assert/strict";
import test from "node:test";

import {
  BrainGraphCache,
  brainGraphCacheKey,
  brainGraphSourceFingerprint,
} from "../src/lib/profile/brain-graph-cache.ts";

function garden(slug, extra = {}) {
  return {
    id: slug.length,
    ownerUserId: 1,
    name: slug,
    slug,
    description: null,
    visibility: "private",
    organizationId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastViewedAt: null,
    viewCount: 0,
    ...extra,
  };
}

function context(gardens) {
  return {
    database: null,
    userId: 1,
    username: "kuzey",
    organizations: [],
    readableGardens: gardens,
    writableGardens: gardens,
  };
}

function response(revision) {
  return {
    revision,
    layoutKey: "layout",
    generatedAt: "2026-01-01T00:00:00.000Z",
    scope: { kind: "all" },
    nodes: [],
    edges: [],
    counts: {},
    truncated: false,
    warnings: [],
    scopeOptions: [],
    capabilities: {},
  };
}

function statTable(files) {
  return (filePath) => {
    const normalized = filePath.replaceAll("\\", "/");
    for (const [suffix, stats] of Object.entries(files)) {
      if (normalized.endsWith(suffix)) return stats;
    }
    return null;
  };
}

test.beforeEach(() => {
  process.env.QUARTZ_CONTENT_PATH = "/content";
});

test("the fingerprint covers every scoped Garden's artifact and cache file", () => {
  const files = {
    "telecom-1/.breadboard/thought-topology.json": { size: 10, mtimeMs: 1000 },
    "telecom-1/.breadboard/thought-topology-cache.json": { size: 20, mtimeMs: 2000 },
  };
  const ctx = context([garden("telecom-1"), garden("math-1")]);
  const before = brainGraphSourceFingerprint(ctx, { kind: "all" }, statTable(files));
  assert.match(before, /telecom-1 10:1000 20:2000 math-1 - -/);

  files["math-1/.breadboard/thought-topology.json"] = { size: 5, mtimeMs: 3000 };
  const after = brainGraphSourceFingerprint(ctx, { kind: "all" }, statTable(files));
  assert.notEqual(before, after, "a Garden gaining its first topology changes the identity");

  files["telecom-1/.breadboard/thought-topology-cache.json"].mtimeMs = 2001;
  assert.notEqual(after, brainGraphSourceFingerprint(ctx, { kind: "all" }, statTable(files)));
});

test("scope and mode keep separate entries", () => {
  assert.notEqual(
    brainGraphCacheKey({ userId: 1 }, { kind: "all" }, "full"),
    brainGraphCacheKey({ userId: 1 }, { kind: "all" }, "overview"),
  );
  assert.notEqual(
    brainGraphCacheKey({ userId: 1 }, { kind: "organization", organizationId: 4 }, "full"),
    brainGraphCacheKey({ userId: 1 }, { kind: "organization", organizationId: 5 }, "full"),
  );
  assert.notEqual(
    brainGraphCacheKey({ userId: 1 }, { kind: "all" }, "full"),
    brainGraphCacheKey({ userId: 2 }, { kind: "all" }, "full"),
  );
});

test("an unchanged topology is served from cache and one build is shared", async () => {
  const files = {
    "telecom-1/.breadboard/thought-topology.json": { size: 10, mtimeMs: 1000 },
  };
  let now = 1_000_000;
  const cache = new BrainGraphCache({ now: () => now, stat: statTable(files) });
  const ctx = context([garden("telecom-1")]);
  let builds = 0;
  const builder = () => {
    builds += 1;
    return new Promise((resolve) => setTimeout(() => resolve(response(`rev_${builds}`)), 5));
  };

  const [first, second] = await Promise.all([
    cache.build(ctx, { kind: "all" }, "full", builder),
    cache.build(ctx, { kind: "all" }, "full", builder),
  ]);
  assert.equal(builds, 1, "concurrent requests share the in-flight build");
  assert.equal(first.revision, "rev_1");
  assert.equal(second, first);

  now += 30_000;
  const third = await cache.build(ctx, { kind: "all" }, "full", builder);
  assert.equal(builds, 1, "a 30 s poll with unchanged files does not rebuild");
  assert.equal(third, first);
  assert.equal(cache.peek(ctx, { kind: "all" }, "full"), first);

  files["telecom-1/.breadboard/thought-topology.json"].mtimeMs = 1001;
  assert.equal(cache.peek(ctx, { kind: "all" }, "full"), null);
  const fourth = await cache.build(ctx, { kind: "all" }, "full", builder);
  assert.equal(builds, 2, "a republished topology rebuilds");
  assert.equal(fourth.revision, "rev_2");
});

test("database-backed sources are never older than the max age", async () => {
  let now = 0;
  const cache = new BrainGraphCache({ now: () => now, stat: () => null, maxAgeMs: 60_000 });
  const ctx = context([garden("telecom-1")]);
  let builds = 0;
  const builder = async () => response(`rev_${(builds += 1)}`);

  await cache.build(ctx, { kind: "all" }, "overview", builder);
  now = 59_000;
  await cache.build(ctx, { kind: "all" }, "overview", builder);
  assert.equal(builds, 1);
  now = 61_000;
  await cache.build(ctx, { kind: "all" }, "overview", builder);
  assert.equal(builds, 2);
});

test("a failed build leaves nothing cached and releases the in-flight slot", async () => {
  const cache = new BrainGraphCache({ now: () => 0, stat: () => null });
  const ctx = context([garden("telecom-1")]);
  await assert.rejects(
    cache.build(ctx, { kind: "all" }, "full", async () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(cache.peek(ctx, { kind: "all" }, "full"), null);
  const recovered = await cache.build(ctx, { kind: "all" }, "full", async () => response("ok"));
  assert.equal(recovered.revision, "ok");
});
