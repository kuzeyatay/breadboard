import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  SKILLS_SH_MAX_PAGE_SIZE,
  SkillsCatalogProxyError,
  SkillsShClient,
  SkillsCatalogConfigurationError,
  normalizeCatalogProxyUrl,
} from "../src/lib/hermes/skills-sh-client.ts";
import {
  collisionCommands,
  SkillsCatalogStore,
} from "../src/lib/hermes/skills-catalog-store.ts";
import { synchronizeSkillsCatalog } from "../src/lib/hermes/skills-catalog-sync.ts";
import {
  SCIENTIFIC_SKILLS_SOURCE,
  getLocalScientificSkill,
  readLocalScientificSkillFiles,
  synchronizeLocalScientificSkillsCatalog,
} from "../src/lib/hermes/scientific-skills-source.ts";

const rateLimit = { limit: 600, remaining: 599, resetAt: null, retryAfterSeconds: null };
const proxyBaseUrl = "https://catalog.example/api/v1";

function skill(id, slug = id.split("/").at(-1), installs = 1) {
  const source = id.split("/").slice(0, -1).join("/");
  return {
    id,
    source,
    slug,
    name: slug,
    installs,
    sourceType: "community",
    installUrl: `https://github.com/${source}`,
    url: `https://skills.sh/${id}`,
    duplicate: false,
  };
}

function page(data, pageNumber, hasMore) {
  return {
    data,
    pagination: { page: pageNumber, perPage: 500, total: data.length, hasMore },
    cacheMaxAgeSeconds: 300,
    rateLimit,
  };
}

function tempStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-skills-catalog-"));
  const store = new SkillsCatalogStore(path.join(root, "catalog.db"));
  return {
    store,
    root,
    cleanup() {
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function mockClient(allTimePages, hooks = {}) {
  return {
    calls: [],
    async listSkills(input) {
      this.calls.push({ ...input });
      hooks.beforePage?.(input);
      if (input.view === "all-time") return allTimePages[input.page];
      return page(allTimePages.flatMap((value) => value.data).slice(0, input.view === "hot" ? 1 : 2), 0, false);
    },
    async curated() {
      return new Set(hooks.curated ?? []);
    },
  };
}

test("shared instrumentation isolates the Node-only catalog scheduler", () => {
  const shared = fs.readFileSync(new URL("../src/instrumentation.ts", import.meta.url), "utf8");
  const nodeOnly = fs.readFileSync(new URL("../src/instrumentation-node.ts", import.meta.url), "utf8");
  assert.match(shared, /NEXT_RUNTIME === ["']nodejs["']/);
  assert.match(shared, /import\(["']\.\/instrumentation-node\.ts["']\)/);
  assert.doesNotMatch(shared, /skills-catalog-(?:store|sync)/);
  assert.match(nodeOnly, /import ["']server-only["']/);
  assert.match(nodeOnly, /skills-catalog-store\.ts/);
  assert.match(nodeOnly, /skills-catalog-sync\.ts/);
});

test("official client clamps per_page and validates one-page catalog", async () => {
  let requestedUrl = "";
  let requestedHeaders = new Headers();
  const client = new SkillsShClient({
    baseUrl: proxyBaseUrl,
    retries: 0,
    fetchImpl: async (url, init) => {
      requestedUrl = String(url);
      requestedHeaders = new Headers(init.headers);
      return Response.json({
        data: [{ id: "owner/repo/demo", source: "owner/repo", slug: "demo", name: "Demo", installs: 2, sourceType: "community", installUrl: "https://github.com/owner/repo", url: "https://skills.sh/owner/repo/demo" }],
        pagination: { page: 0, perPage: 500, total: 1, hasMore: false },
      });
    },
  });
  const result = await client.listSkills({ page: 0, perPage: 50_000 });
  assert.equal(new URL(requestedUrl).searchParams.get("per_page"), String(SKILLS_SH_MAX_PAGE_SIZE));
  assert.equal(new URL(requestedUrl).origin, "https://catalog.example");
  assert.equal(requestedHeaders.get("authorization"), null);
  assert.equal(result.data[0].id, "owner/repo/demo");
});

test("proxy URL configuration rejects missing, malformed, credentialed, and direct skills.sh URLs", () => {
  assert.throws(() => normalizeCatalogProxyUrl(undefined), SkillsCatalogConfigurationError);
  assert.throws(() => normalizeCatalogProxyUrl("not a URL"), SkillsCatalogConfigurationError);
  assert.throws(() => normalizeCatalogProxyUrl("https://user:pass@catalog.example/api/v1"), SkillsCatalogConfigurationError);
  assert.throws(() => normalizeCatalogProxyUrl("https://catalog.example/wrong"), SkillsCatalogConfigurationError);
  assert.throws(() => normalizeCatalogProxyUrl("http://catalog.example/api/v1"), SkillsCatalogConfigurationError);
  assert.throws(() => normalizeCatalogProxyUrl("https://skills.sh/api/v1"), /cannot connect directly/i);
  assert.equal(normalizeCatalogProxyUrl("http://127.0.0.1:4555/api/v1/"), "http://127.0.0.1:4555/api/v1");
});

test("429 exposes Retry-After and rate-limit state", async () => {
  const client = new SkillsShClient({
    baseUrl: proxyBaseUrl,
    retries: 0,
    fetchImpl: async () => Response.json({ message: "slow down" }, {
      status: 429,
      headers: { "Retry-After": "7", "X-RateLimit-Limit": "600", "X-RateLimit-Remaining": "0" },
    }),
  });
  await assert.rejects(
    () => client.listSkills({ page: 0 }),
    (error) => error instanceof SkillsCatalogProxyError && error.status === 429 && error.retryAfterSeconds === 7 && error.rateLimit.remaining === 0,
  );
});

test("503 and request timeouts fail after bounded retries", async () => {
  const unavailable = new SkillsShClient({
    baseUrl: proxyBaseUrl,
    retries: 0,
    fetchImpl: async () => Response.json({ message: "maintenance" }, { status: 503 }),
  });
  await assert.rejects(
    () => unavailable.listSkills({ page: 0 }),
    (error) => error instanceof SkillsCatalogProxyError && error.status === 503,
  );
  const timedOut = new SkillsShClient({
    baseUrl: proxyBaseUrl,
    retries: 0,
    timeoutMs: 5,
    fetchImpl: async (_url, init) => await new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    }),
  });
  await assert.rejects(() => timedOut.listSkills({ page: 0 }), /timeout|aborted/i);
});

test("malformed upstream records abort synchronization before snapshot replacement", async () => {
  const client = new SkillsShClient({
    baseUrl: proxyBaseUrl,
    retries: 0,
    fetchImpl: async () => Response.json({ data: [{ id: "missing-source" }], pagination: { page: 0, perPage: 500, total: 1, hasMore: false } }),
  });
  await assert.rejects(() => client.listSkills({ page: 0 }), /malformed skill source/);
});

test("full synchronization exhausts multiple pages and commits one durable snapshot", async () => {
  const fixture = tempStore();
  try {
    const client = mockClient([
      page([skill("one/repo/alpha"), skill("two/repo/beta")], 0, true),
      page([skill("three/repo/gamma")], 1, false),
    ], { curated: ["one/repo/alpha"] });
    const stats = await synchronizeSkillsCatalog({ client, store: fixture.store, force: true });
    assert.equal(stats.pagesFetched, 4); // two all-time + one trending + one hot
    assert.equal(fixture.store.status().totalAvailable, 3);
    assert.equal(fixture.store.get("one/repo/alpha").curated, true);
    assert.deepEqual(client.calls.filter((call) => call.view === "all-time").map((call) => call.page), [0, 1]);
    const reopened = new SkillsCatalogStore(path.join(fixture.root, "catalog.db"));
    assert.equal(reopened.status().totalAvailable, 3);
    reopened.close();
  } finally {
    fixture.cleanup();
  }
});

test("duplicate ids are deduplicated and duplicate slugs receive deterministic qualified commands", async () => {
  const fixture = tempStore();
  try {
    const first = skill("owner-a/repo/shared", "shared", 10);
    const second = skill("owner-b/repo/shared", "shared", 8);
    const client = mockClient([page([first, first, second], 0, false)]);
    await synchronizeSkillsCatalog({ client, store: fixture.store, force: true });
    assert.equal(fixture.store.status().totalAvailable, 2);
    assert.equal(fixture.store.get(first.id).slashCommand, "owner-a:shared");
    assert.equal(fixture.store.get(second.id).slashCommand, "owner-b:shared");
    assert.deepEqual(collisionCommands([first, second]), new Map([
      [first.id, "owner-a:shared"],
      [second.id, "owner-b:shared"],
    ]));
  } finally {
    fixture.cleanup();
  }
});

test("reconciliation adds, changes, reranks, and safely unlists missing records", async () => {
  const fixture = tempStore();
  try {
    await synchronizeSkillsCatalog({ client: mockClient([page([
      skill("one/repo/alpha", "alpha", 1),
      skill("two/repo/beta", "beta", 2),
    ], 0, false)]), store: fixture.store, force: true });
    const changed = skill("one/repo/alpha", "alpha", 99);
    changed.duplicate = true;
    const stats = await synchronizeSkillsCatalog({ client: mockClient([page([
      skill("three/repo/gamma", "gamma", 3),
      changed,
    ], 0, false)]), store: fixture.store, force: true });
    assert.equal(stats.recordsAdded, 1);
    assert.ok(stats.recordsChanged >= 1);
    assert.equal(stats.recordsUnlisted, 1);
    assert.equal(fixture.store.get("two/repo/beta").upstreamStatus, "unlisted_upstream");
    assert.equal(fixture.store.get("one/repo/alpha").duplicate, true);
    assert.equal(fixture.store.get("one/repo/alpha").installs, 99);
  } finally {
    fixture.cleanup();
  }
});

test("a partial synchronization failure leaves the prior snapshot atomically intact", async () => {
  const fixture = tempStore();
  try {
    await synchronizeSkillsCatalog({ client: mockClient([page([
      skill("one/repo/alpha"), skill("two/repo/beta"),
    ], 0, false)]), store: fixture.store, force: true });
    const broken = mockClient([
      page([skill("one/repo/alpha")], 0, true),
      page([], 1, false),
    ], { beforePage(input) { if (input.view === "all-time" && input.page === 1) throw new Error("upstream 503"); } });
    await assert.rejects(() => synchronizeSkillsCatalog({ client: broken, store: fixture.store, force: true }), /503/);
    assert.equal(fixture.store.status().totalAvailable, 2);
    assert.equal(fixture.store.get("two/repo/beta").upstreamStatus, "available");
    assert.match(fixture.store.status().lastFailure, /503/);
  } finally {
    fixture.cleanup();
  }
});

test("an interrupted full sync is safely resumed by a later complete run", async () => {
  const fixture = tempStore();
  try {
    const interrupted = mockClient([
      page([skill("one/repo/alpha")], 0, true),
      page([], 1, false),
    ], { beforePage(input) { if (input.view === "all-time" && input.page === 1) throw new Error("connection lost"); } });
    await assert.rejects(() => synchronizeSkillsCatalog({ client: interrupted, store: fixture.store, force: true }), /connection lost/);
    assert.equal(fixture.store.status().hasSnapshot, false);
    const completed = await synchronizeSkillsCatalog({ client: mockClient([
      page([skill("one/repo/alpha")], 0, true),
      page([skill("two/repo/beta")], 1, false),
    ]), store: fixture.store, force: true });
    assert.equal(fixture.store.status().totalAvailable, 2);
    assert.equal(completed.pagesFetched, 4);
    assert.deepEqual(fixture.store.syncRuns(2).map((run) => run.status), ["succeeded", "failed"]);
  } finally {
    fixture.cleanup();
  }
});

test("concurrent refreshes coalesce into one upstream traversal", async () => {
  const fixture = tempStore();
  try {
    let calls = 0;
    const client = mockClient([page([skill("one/repo/alpha")], 0, false)], {
      beforePage() { calls += 1; },
    });
    const [left, right] = await Promise.all([
      synchronizeSkillsCatalog({ client, store: fixture.store, force: true }),
      synchronizeSkillsCatalog({ client, store: fixture.store, force: true }),
    ]);
    assert.equal(left.syncId, right.syncId);
    assert.equal(calls, 3);
  } finally {
    fixture.cleanup();
  }
});

test("detail hash changes require a fresh review and do not overwrite approval", () => {
  const fixture = tempStore();
  try {
    const startedAt = new Date().toISOString();
    fixture.store.beginSync({ syncId: "seed", startedAt, provider: "test" });
    fixture.store.replaceSnapshot({
      syncId: "seed",
      startedAt,
      records: [{ ...skill("one/repo/alpha"), ranks: { "all-time": 1 }, curated: false, slashCommand: "alpha" }],
      pagesFetched: 1,
      recordsReceived: 1,
      cacheMaxAgeSeconds: 300,
      rateLimit,
    });
    fixture.store.saveDetail("one/repo/alpha", { id: "one/repo/alpha", source: "one/repo", slug: "alpha", installs: 1, hash: "hash-one", files: [{ path: "SKILL.md", contents: "---\nname: alpha\ndescription: Alpha\n---\n" }] }, []);
    fixture.store.markInstalled({ upstreamId: "one/repo/alpha", approvedHash: "hash-one", localHash: "local-one", installedPath: "C:/approved/alpha" });
    fixture.store.saveDetail("one/repo/alpha", { id: "one/repo/alpha", source: "one/repo", slug: "alpha", installs: 1, hash: "hash-two", files: [{ path: "SKILL.md", contents: "---\nname: alpha\ndescription: Changed\n---\n" }] }, []);
    const changed = fixture.store.get("one/repo/alpha");
    assert.equal(changed.updateStatus, "update_available");
    assert.equal(changed.approvedHash, "hash-one");
    fixture.store.markQuarantined({
      upstreamId: "one/repo/alpha",
      upstreamHash: "hash-two",
      localHash: "local-two",
      catalogRevision: "hash-two",
      revisionKey: "alpha-revision",
    });
    const reviewing = fixture.store.get("one/repo/alpha");
    assert.equal(reviewing.updateStatus, "reviewing_update");
    assert.equal(reviewing.approvedHash, "hash-one");
    assert.equal(reviewing.quarantineLocalHash, "local-two");
    assert.equal(reviewing.catalogRevision, "hash-two");
    fixture.store.markQuarantineRejected("one/repo/alpha");
    const rejected = fixture.store.get("one/repo/alpha");
    assert.equal(rejected.reviewStatus, "approved");
    assert.equal(rejected.updateStatus, "update_available");
    assert.equal(rejected.approvedHash, "hash-one");
    assert.equal(rejected.quarantineLocalHash, null);
    assert.equal(rejected.catalogRevision, "hash-one");
    fixture.store.markQuarantined({
      upstreamId: "one/repo/alpha",
      upstreamHash: "hash-two",
      localHash: "local-two",
      catalogRevision: "hash-two",
      revisionKey: "alpha-revision",
    });
    fixture.store.markInstalled({
      upstreamId: "one/repo/alpha",
      approvedHash: "hash-two",
      localHash: "local-two",
      installedPath: "C:/approved/alpha",
    });
    const approvedUpdate = fixture.store.get("one/repo/alpha");
    assert.equal(approvedUpdate.catalogRevision, "hash-two");
    assert.equal(approvedUpdate.localHash, "local-two");
    assert.equal(approvedUpdate.quarantineLocalHash, null);
  } finally {
    fixture.cleanup();
  }
});

test("description hydration caches manifest metadata without caching an installable snapshot", () => {
  const fixture = tempStore();
  try {
    const startedAt = new Date().toISOString();
    fixture.store.beginSync({ syncId: "description-seed", startedAt, provider: "test" });
    fixture.store.replaceSnapshot({
      syncId: "description-seed",
      startedAt,
      records: [{ ...skill("one/repo/summary"), ranks: { "all-time": 1 }, curated: false, slashCommand: "summary" }],
      pagesFetched: 1,
      recordsReceived: 1,
      cacheMaxAgeSeconds: 300,
      rateLimit,
    });
    const hydrated = fixture.store.saveDescription("one/repo/summary", {
      id: "one/repo/summary",
      source: "one/repo",
      slug: "summary",
      installs: 1,
      hash: "upstream-hash",
      files: [{ path: "SKILL.md", contents: "---\nname: summary\ndescription: A useful catalog summary.\n---\n" }],
    });
    assert.equal(hydrated.description, "A useful catalog summary.");
    assert.ok(hydrated.detailCheckedAt);
    assert.equal(hydrated.files, null);
    assert.equal(hydrated.upstreamHash, null);
  } finally {
    fixture.cleanup();
  }
});

test("a cloned scientific skills repository overlays complete local metadata and files", () => {
  const fixture = tempStore();
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-scientific-skills-"));
  const previousRoot = process.env.SCIENTIFIC_AGENT_SKILLS_ROOT;
  try {
    const alpha = path.join(clone, "skills", "alpha");
    const beta = path.join(clone, "skills", "beta");
    fs.mkdirSync(path.join(alpha, "references"), { recursive: true });
    fs.mkdirSync(beta, { recursive: true });
    fs.writeFileSync(path.join(alpha, "SKILL.md"), "---\nname: Alpha Science\ndescription: >\n  Analyze alpha measurements\n  with provenance.\n---\n\n# Alpha\n", "utf8");
    fs.writeFileSync(path.join(alpha, "references", "data.bin"), Buffer.from([0, 255, 1, 2]));
    fs.writeFileSync(path.join(beta, "SKILL.md"), "---\nname: beta\ndescription: Beta analysis\n---\n", "utf8");
    process.env.SCIENTIFIC_AGENT_SKILLS_ROOT = clone;

    const result = synchronizeLocalScientificSkillsCatalog({ store: fixture.store, force: true });
    assert.equal(result.total, 2);
    assert.equal(fixture.store.status().totalAvailable, 2);
    const stored = fixture.store.get("k-dense-ai/scientific-agent-skills/alpha");
    assert.equal(stored.name, "Alpha Science");
    assert.equal(stored.description, "Analyze alpha measurements with provenance.");
    assert.equal(stored.sourceType, "local-git");
    assert.ok(stored.files.some((file) => file.path === "references/data.bin"));
    const scientificView = fixture.store.list({ source: SCIENTIFIC_SKILLS_SOURCE });
    assert.equal(scientificView.total, 2);
    assert.deepEqual(scientificView.skills.map((skill) => skill.slug).sort(), ["alpha", "beta"]);
    assert.equal(fixture.store.list({ source: "vercel-labs/skills" }).total, 0);

    const detail = getLocalScientificSkill(stored.upstreamId);
    assert.deepEqual(detail.binaryPaths, ["references/data.bin"]);
    const files = readLocalScientificSkillFiles(stored.upstreamId);
    assert.deepEqual([...files.files["references/data.bin"]], [0, 255, 1, 2]);
    assert.equal(files.hash, stored.upstreamHash);

    const second = synchronizeLocalScientificSkillsCatalog({ store: fixture.store });
    assert.equal(second.skipped, true);
  } finally {
    if (previousRoot === undefined) delete process.env.SCIENTIFIC_AGENT_SKILLS_ROOT;
    else process.env.SCIENTIFIC_AGENT_SKILLS_ROOT = previousRoot;
    fs.rmSync(clone, { recursive: true, force: true });
    fixture.cleanup();
  }
});

test("live catalog proxy integration exhausts pages, searches, reads detail/audit, and quarantines snapshots", {
  skip: process.env.RUN_SKILLS_SH_INTEGRATION !== "1",
  timeout: 180_000,
}, async () => {
  const fixture = tempStore();
  const liveRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-skills-proxy-live-"));
  try {
    const client = new SkillsShClient({ timeoutMs: 20_000, retries: 3 });
    const stats = await synchronizeSkillsCatalog({ client, store: fixture.store, force: true });
    assert.ok(stats.pagesFetched > 3, `expected multi-page traversal, got ${stats.pagesFetched} total view pages`);
    assert.ok(fixture.store.status().totalAvailable > 500);
    const results = await client.search("grill-me", 20);
    const grill = results.find((value) => value.slug === "grill-me");
    assert.ok(grill, "grill-me must be discovered through the generic API search");
    const detail = await client.detail(grill.source, grill.slug);
    assert.equal(detail.id, grill.id);
    assert.ok(detail.hash);
    assert.ok(detail.files?.some((file) => /^SKILL\.md$/i.test(file.path)));
    try {
      const audits = await client.audits(grill.source, grill.slug);
      assert.ok(Array.isArray(audits));
    } catch (error) {
      assert.ok(error instanceof SkillsCatalogProxyError && error.status === 404, "audit endpoint may only fail with documented no-audits 404");
    }

    const previousRoots = {
      quarantine: process.env.HERMES_SKILLS_QUARANTINE,
      approved: process.env.HERMES_SKILLS_APPROVED,
      conditional: process.env.HERMES_SKILLS_CONDITIONAL,
    };
    process.env.HERMES_SKILLS_QUARANTINE = path.join(liveRoot, "quarantine");
    process.env.HERMES_SKILLS_APPROVED = path.join(liveRoot, "approved");
    process.env.HERMES_SKILLS_CONDITIONAL = path.join(liveRoot, "conditional");
    try {
      const {
        classifySkill,
        promoteSkill,
        quarantineSkill,
        skillStorageKey,
      } = await import("../src/lib/hermes/skills.ts");
      const { resolveCommandMessage } = await import("../src/lib/hermes/commands.ts");
      for (const example of [
        { query: "grill-me", preferred: grill, classificationOverride: "eligible_general" },
        { query: "pdf document", classificationOverride: "eligible_general" },
        { query: "react frontend", classificationOverride: "eligible_coding_conditional" },
      ]) {
        const result = example.preferred ?? (await client.search(example.query, 20))[0];
        assert.ok(result, `expected a live ${example.query} result`);
        const current = result.id === grill.id ? detail : await client.detail(result.source, result.slug);
        assert.ok(current.hash && current.files?.length, `${result.id} needs an upstream snapshot`);
        const markdown = current.files.find((file) => /^SKILL\.md$/i.test(file.path))?.contents ?? "";
        const mirrored = fixture.store.get(result.id);
        const command = mirrored?.slashCommand ?? result.slug;
        const storageKey = skillStorageKey(result.id, result.slug);
        quarantineSkill({
          candidate: {
            id: result.id,
            upstreamId: result.id,
            name: result.slug,
            package: `${result.source}@${result.slug}`,
            publisher: result.source.split("/")[0],
            repository: result.source,
            source: result.installUrl ?? result.source,
            detailsUrl: result.url ?? `https://skills.sh/${result.id}`,
            installs: String(result.installs),
            description: "",
            version: current.hash,
            installCommand: "Catalog snapshot via Breadboard proxy",
            requestedPermissions: [],
            provider: "api",
            classification: classifySkill({ name: result.name, repository: result.source, manifest: markdown }),
            slashCommand: command,
            storageKey,
          },
          files: Object.fromEntries(current.files.map((file) => [file.path, file.contents])),
        });
        promoteSkill(storageKey, { classificationOverride: example.classificationOverride, reviewer: 1 });
        const resolved = await resolveCommandMessage(
          1,
          `/${command} help with this task`,
          liveRoot,
          { mode: "knowledge", surface: "dashboard_terminal" },
        );
        assert.equal(resolved.invocations[0].id, result.id);
        assert.equal(resolved.invocations[0].contentHash?.length, 64);
        assert.match(resolved.text, /Reviewed skill guidance/);
      }
    } finally {
      restoreEnvironment("HERMES_SKILLS_QUARANTINE", previousRoots.quarantine);
      restoreEnvironment("HERMES_SKILLS_APPROVED", previousRoots.approved);
      restoreEnvironment("HERMES_SKILLS_CONDITIONAL", previousRoots.conditional);
    }
  } finally {
    fixture.cleanup();
    fs.rmSync(liveRoot, { recursive: true, force: true });
  }
});

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
