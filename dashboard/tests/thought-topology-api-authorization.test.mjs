import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { registerHooks } from "node:module";

const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-topology-api-"));
process.env.BREADBOARD_DATA_DIR = path.join(isolatedRoot, "data");
process.env.QUARTZ_CONTENT_PATH = path.join(isolatedRoot, "content");
fs.mkdirSync(process.env.QUARTZ_CONTENT_PATH, { recursive: true });

await import("../scripts/learn-worker-import-hook.mjs");
const db = (await import("../src/lib/db.ts")).default;
const auth = await import("../src/lib/server-auth.ts");
const route = await import("../src/app/api/thought-topology/route.ts");

function insertUser(username) {
  return Number(db.prepare("INSERT INTO users (username, email, password_hash) VALUES (?, ?, 'x')").run(username, `${username}@example.test`).lastInsertRowid);
}

const owner = insertUser("topology-owner");
const member = insertUser("topology-member");
const stranger = insertUser("topology-stranger");
const organizationId = Number(db.prepare("INSERT INTO organizations (name, created_by_user_id) VALUES ('Topology Org', ?)").run(owner).lastInsertRowid);
db.prepare("INSERT INTO organization_members (organization_id, user_id, role) VALUES (?, ?, 'owner')").run(organizationId, owner);
db.prepare("INSERT INTO organization_members (organization_id, user_id, role) VALUES (?, ?, 'member')").run(organizationId, member);

function insertGarden(slug, visibility, organization = null, enabled = 0) {
  const gardenId = Number(db.prepare(`INSERT INTO clusters (
    user_id, name, slug, visibility, organization_id,
    thought_topology_enabled, thought_topology_revision
  ) VALUES (?, ?, ?, ?, ?, ?, 0)`).run(
    owner,
    slug,
    slug,
    visibility,
    organization,
    enabled,
  ).lastInsertRowid);
  // The production insert trigger enables topology for new Gardens. Tests
  // that exercise the legacy disabled read path must override that default.
  db.prepare("UPDATE clusters SET thought_topology_enabled = ? WHERE id = ?").run(
    enabled,
    gardenId,
  );
}

insertGarden("owner-private", "private");
insertGarden("org-readable", "organization", organizationId);
insertGarden("public-readable", "public");
insertGarden("public-enabled", "public", null, 1);
insertGarden("public-incomplete", "public", null, 1);

test("read authorization covers owner, organization member, public, and rejects private strangers", () => {
  assert.equal(auth.requireReadableCluster(owner, "owner-private").slug, "owner-private");
  assert.equal(auth.requireReadableCluster(member, "org-readable").slug, "org-readable");
  assert.equal(auth.requireReadableCluster(stranger, "public-readable").slug, "public-readable");
  assert.throws(() => auth.requireReadableCluster(stranger, "owner-private"), /Cluster not found/);
});

test("unauthenticated public disabled GET is bounded legacy data and creates no work", async () => {
  const before = db.prepare("SELECT count(*) AS count FROM thought_topology_jobs").get().count;
  const response = await route.GET(new Request("http://dashboard.local/api/thought-topology?clusterSlug=public-readable", {
    headers: { origin: "http://localhost:8081" },
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:8081");
  assert.deepEqual(await response.json(), { enabled: false, mode: "links" });
  assert.equal(db.prepare("SELECT count(*) AS count FROM thought_topology_jobs").get().count, before);
  assert.equal(fs.existsSync(path.join(process.env.QUARTZ_CONTENT_PATH, "public-readable", ".breadboard")), false);
});

test("public enabled reads return only the sanitized renderer artifact", async () => {
  const derived = path.join(process.env.QUARTZ_CONTENT_PATH, "public-enabled", ".breadboard");
  fs.mkdirSync(derived, { recursive: true });
  const topology = {
    schemaVersion: 1,
    scoringVersion: "thought-topology-affinity-v1",
    sourceRevision: "public-fixture",
    garden: { id: 4, slug: "public-enabled", title: "Public enabled", summary: { state: "ready", text: "Public summary." } },
    folders: [],
    nodes: [],
    edges: [],
    build: { state: "ready", generatedAt: "2026-01-01T00:00:00.000Z", embeddingModel: "local/bge-small-en-v1.5", embeddingDimension: 3, summaryModel: "test", nodePromptVersion: "v1", edgePromptVersion: "v1", retrievalMode: "semantic-vector", threshold: 0.68 },
  };
  fs.writeFileSync(path.join(derived, "thought-topology.json"), JSON.stringify(topology));
  fs.writeFileSync(path.join(derived, "thought-topology-cache.json"), JSON.stringify({ secretMarker: "PRIVATE_VECTOR_MARKER", nodes: { note: { embedding: [1, 2, 3] } } }));
  const clusterId = db.prepare("SELECT id FROM clusters WHERE slug = 'public-enabled'").get().id;
  // A historical row can remain `running` if the dashboard missed Runtime's
  // terminal event. It must not make a newer terminal revision look active.
  db.prepare("INSERT INTO thought_topology_jobs (cluster_id, revision, reason, status, runtime_job_id) VALUES (?, 0, 'orphan', 'running', 'job_orphan')").run(clusterId);
  db.prepare("INSERT INTO thought_topology_jobs (cluster_id, revision, reason, status, last_error) VALUES (?, 1, 'fixture', 'failed', 'private worker detail')").run(clusterId);
  const response = await route.GET(new Request("http://dashboard.local/api/thought-topology?clusterSlug=public-enabled"));
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.doesNotMatch(body, /PRIVATE_VECTOR_MARKER|\[1,2,3\]/);
  assert.doesNotMatch(body, /private worker detail/);
  const payload = JSON.parse(body);
  assert.equal(payload.topology.sourceRevision, "public-fixture");
  assert.deepEqual(payload.status, { state: "failed", message: "Showing the last available topology; the latest update failed." });
  assert.equal(payload.stale, true);
});

test("saved maps missing source connections rebuild once; current and newer maps stay idle", async () => {
  const { gardenContentFingerprint } = await import("../src/lib/thought-topology/projection.ts");
  for (const version of [3, 4, 9]) {
    const slug = `public-connections-v${version}`;
    insertGarden(slug, "public", null, 1);
    const gardenDir = path.join(process.env.QUARTZ_CONTENT_PATH, slug);
    const derived = path.join(gardenDir, ".breadboard");
    fs.mkdirSync(derived, { recursive: true });
    fs.writeFileSync(path.join(derived, "thought-topology.json"), JSON.stringify({
      schemaVersion: 1, scoringVersion: `thought-topology-affinity-v${version}`,
      sourceRevision: slug,
      garden: { id: 1, slug, title: slug, summary: { state: "ready", text: "Summary." } },
      folders: [], nodes: [], edges: [],
      build: { state: "ready", contentFingerprint: gardenContentFingerprint(gardenDir) },
    }));
    for (let read = 0; read < 2; read += 1) {
      const response = await route.GET(new Request(`http://dashboard.local/api/thought-topology?clusterSlug=${slug}`));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).topology.sourceRevision, slug, "keep the map visible during repair");
    }
    const clusterId = db.prepare("SELECT id FROM clusters WHERE slug = ?").get(slug).id;
    const jobs = db.prepare("SELECT reason FROM thought_topology_jobs WHERE cluster_id = ?").all(clusterId);
    assert.equal(jobs.length, version < 4 ? 1 : 0);
    if (version < 4) assert.match(jobs[0].reason, /source-anchor connections/);
  }
});

test("an incomplete stored topology is hidden and queued for atomic repair", async () => {
  const derived = path.join(process.env.QUARTZ_CONTENT_PATH, "public-incomplete", ".breadboard");
  fs.mkdirSync(derived, { recursive: true });
  fs.writeFileSync(path.join(derived, "thought-topology.json"), JSON.stringify({
    schemaVersion: 1,
    scoringVersion: "thought-topology-affinity-v1",
    sourceRevision: "partial-fixture",
    garden: { id: 5, slug: "public-incomplete", title: "Public incomplete", summary: { state: "ready", text: "Summary." } },
    folders: [],
    nodes: [],
    edges: [{
      id: "edge:partial",
      source: "page:a",
      target: "page:b",
      origin: "inferred",
      score: 0.9,
      components: { embedding: 0.9, concept: 0, lexical: 0 },
      relationType: "related",
      direction: "undirected",
      explanation: { state: "pending", text: "This connection will be explained on the next update." },
      evidence: [],
      pairHash: "partial",
      visual: { width: 1, opacity: 1, distance: 1, strength: 1 },
    }],
    build: { state: "degraded", generatedAt: "2026-01-01T00:00:00.000Z", embeddingModel: "local/bge-small-en-v1.5", embeddingDimension: 3, summaryModel: "test", nodePromptVersion: "v1", edgePromptVersion: "v1", retrievalMode: "semantic-vector", threshold: 0.68 },
  }));

  const response = await route.GET(new Request("http://dashboard.local/api/thought-topology?clusterSlug=public-incomplete"));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.topology.sourceRevision, "pending", "the partial artifact never reaches Quartz");
  assert.deepEqual(payload.topology.edges, []);
  assert.equal(payload.status.state, "building");
  assert.equal(payload.stale, true);
  const clusterId = db.prepare("SELECT id FROM clusters WHERE slug = 'public-incomplete'").get().id;
  const queued = db.prepare("SELECT reason FROM thought_topology_jobs WHERE cluster_id = ? ORDER BY id DESC LIMIT 1").get(clusterId);
  assert.match(queued.reason, /incomplete connection explanations/);
});

test("published Quartz receives a credentialed, allowlisted read transport", async () => {
  const response = await route.OPTIONS(new Request("http://dashboard.local/api/thought-topology", {
    method: "OPTIONS",
    headers: { origin: "http://localhost:8081" },
  }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:8081");
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
});

test("the saved account switch keeps missing, outdated, failed, and stranded maps idle until re-enabled", async () => {
  const { setHermesUserSettings, getHermesUserSettings } = await import("../src/lib/hermes/runtime-store.ts");
  const { gardenContentFingerprint } = await import("../src/lib/thought-topology/projection.ts");
  const { thoughtTopologyAutoUpdateEnabled } = await import("../src/lib/thought-topology/preferences.ts");
  setHermesUserSettings(owner, { composerSwitches: { thoughtTopologyAutoUpdate: false } });
  setHermesUserSettings(owner, { composerSwitches: { currentLocation: true } });
  assert.equal(thoughtTopologyAutoUpdateEnabled(owner), false);
  assert.equal(getHermesUserSettings(owner).composerSwitches.currentLocation, true);
  try {
    for (const kind of ['missing', 'outdated', 'failed', 'stranded', 'interrupted-submission', 'current']) {
      const slug = `paused-${kind}`;
      insertGarden(slug, 'public', null, 1);
      const clusterId = db.prepare("SELECT id FROM clusters WHERE slug = ?").get(slug).id;
      const gardenDir = path.join(process.env.QUARTZ_CONTENT_PATH, slug);
      const derived = path.join(gardenDir, '.breadboard');
      fs.mkdirSync(derived, { recursive: true });
      if (kind !== 'missing') {
        fs.writeFileSync(path.join(derived, 'thought-topology.json'), JSON.stringify({
          schemaVersion: 1, scoringVersion: 'thought-topology-affinity-v4', sourceRevision: slug,
          garden: { id: clusterId, slug, title: slug, summary: { state: 'ready', text: 'Saved map.' } },
          folders: [], nodes: [], edges: [],
          build: { state: 'ready', contentFingerprint: gardenContentFingerprint(gardenDir) },
        }));
        if (kind === 'outdated') fs.writeFileSync(path.join(gardenDir, 'new.md'), '# New idea');
      }
      if (kind === 'failed' || kind === 'stranded' || kind === 'interrupted-submission') {
        db.prepare("INSERT INTO thought_topology_jobs (cluster_id, revision, reason, status, updated_at) VALUES (?, 0, 'fixture', ?, '2026-01-01 00:00:00')")
          .run(clusterId, kind === 'failed' ? 'failed' : 'queued');
        if (kind === 'interrupted-submission') {
          db.prepare("UPDATE thought_topology_jobs SET runtime_job_id = 'submitting:1:1' WHERE cluster_id = ?").run(clusterId);
        }
      }
      const before = db.prepare("SELECT * FROM thought_topology_jobs WHERE cluster_id = ?").all(clusterId);
      for (let read = 0; read < 2; read++) {
        const result = await route.GET(new Request(`http://dashboard.local/api/thought-topology?clusterSlug=${slug}`));
        assert.equal(result.status, 200);
        const payload = await result.json();
        assert.equal(payload.autoUpdate, false);
        assert.equal(payload.retryAvailable, kind !== 'current');
        assert.notEqual(payload.status?.state, 'building');
        assert.notEqual(payload.topology.build.state, 'building');
        assert.equal(payload.topology.sourceRevision, kind === 'missing' ? 'pending' : slug);
        assert.deepEqual(db.prepare("SELECT * FROM thought_topology_jobs WHERE cluster_id = ?").all(clusterId), before);
      }
    }
    setHermesUserSettings(owner, { composerSwitches: { thoughtTopologyAutoUpdate: true } });
    assert.equal(thoughtTopologyAutoUpdateEnabled(owner), true);
    const result = await route.GET(new Request('http://dashboard.local/api/thought-topology?clusterSlug=paused-missing'));
    assert.equal((await result.json()).status.state, 'building');
  } finally {
    setHermesUserSettings(owner, { composerSwitches: { thoughtTopologyAutoUpdate: true } });
  }
});

test("manual update is owner-only and repeated requests share one queued build while automatic updates stay off", async () => {
  const state = await import("../src/lib/thought-topology/state.ts");
  const { setHermesUserSettings } = await import("../src/lib/hermes/runtime-store.ts");
  const slug = 'manual-owner-only';
  insertGarden(slug, 'public', null, 1);
  setHermesUserSettings(owner, { composerSwitches: { thoughtTopologyAutoUpdate: false } });
  let viewer = stranger;
  const submissions = [];
  globalThis.__topologyRetryTest = {
    ...auth,
    async requireOwnedClusterFromSlug(slug) {
      if (viewer === null) throw new auth.RouteError(401, 'Unauthorized');
      return { userId: viewer, cluster: auth.requireOwnedCluster(viewer, slug) };
    },
    ...state,
    invalidateThoughtTopologyAfterMutation: (slug, reason, options) => state.invalidateThoughtTopologyAfterMutation(slug, reason, {
      ...options,
      submit: async (job) => { submissions.push(job); return { snapshot: { jobId: 'job_manual_api' } }; },
    }),
  };
  // Only substitute session lookup and Runtime admission; execute the real route,
  // access policy, preference, database queue and response/status code together.
  const authModule = `data:text/javascript,${encodeURIComponent('export const {requireReadableClusterFromSlugOrPublic, requireOwnedClusterFromSlug, routeErrorResponse} = globalThis.__topologyRetryTest;')}`;
  const stateModule = `data:text/javascript,${encodeURIComponent('export const {invalidateThoughtTopologyAfterMutation, readPathRepairDelayMs, resubmitQueuedThoughtTopologyJob, reconcileThoughtTopologyRuntimeJob} = globalThis.__topologyRetryTest;')}`;
  const hook = registerHooks({
    resolve(specifier, context, next) {
      if (context.parentURL?.includes('manual-retry-test')) {
        if (specifier === '@/lib/server-auth') return { url: authModule, shortCircuit: true };
        if (specifier === '@/lib/thought-topology/state') return { url: stateModule, shortCircuit: true };
      }
      return next(specifier, context);
    },
  });
  try {
    const manualRoute = await import('../src/app/api/thought-topology/route.ts?manual-retry-test');
    const request = () => new Request(`http://dashboard.local/api/thought-topology?clusterSlug=${slug}`, { method: 'POST' });
    assert.equal((await manualRoute.POST(request())).status, 404);
    viewer = null;
    assert.equal((await manualRoute.POST(request())).status, 401);
    assert.equal(submissions.length, 0);
    viewer = owner;
    for (let retry = 0; retry < 2; retry++) {
      const response = await manualRoute.POST(request());
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.autoUpdate, false);
      assert.equal(payload.retryAvailable, false);
      assert.equal(payload.status.state, 'building');
    }
    assert.equal(submissions.length, 1);
  } finally {
    hook.deregister();
    delete globalThis.__topologyRetryTest;
    setHermesUserSettings(owner, { composerSwitches: { thoughtTopologyAutoUpdate: true } });
  }
});

test("a worker that failed at 12% releases its coalesced queue entry and starts a fresh build", async () => {
  const slug = "public-stranded";
  insertGarden(slug, "public", null, 1);
  const clusterId = db.prepare("SELECT id FROM clusters WHERE slug = ?").get(slug).id;
  db.prepare("UPDATE clusters SET thought_topology_revision = 9 WHERE id = ?").run(clusterId);
  db.prepare("INSERT INTO thought_topology_jobs (cluster_id, revision, reason, status, runtime_job_id) VALUES (?, 9, 'Learn changed content', 'queued', 'job_dead')").run(clusterId);
  const submissions = [];
  let inspectCount = 0;
  let runtimeUnavailable = false;
  const snapshot = (jobId, state) => ({
    jobId, jobType: "thought-topology", workerKind: "thought-topology-node",
    resourceClass: "document-processing", state, stage: "processing", attempt: 1,
    workerInstanceId: "worker_test", gardenId: slug, conversationId: null,
    createdAt: 100, startedAt: 100, updatedAt: 101, finishedAt: state === "failed" ? 101 : null,
    lastHeartbeatAt: 101, lastWorkerSequence: 5, progressCurrent: 12, progressTotal: 100,
    failureCode: state === "failed" ? "WORKER_FAILED" : null,
    failureMessage: state === "failed" ? "Runtime job execution failed." : null,
    resourceExhaustion: null, cancellationRequested: false,
  });
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.setHeader("content-type", "application/json");
    if (runtimeUnavailable) {
      response.writeHead(503);
      response.end("{}");
      return;
    }
    if (request.method === "POST") {
      submissions.push(JSON.parse(Buffer.concat(chunks).toString()));
      response.end(JSON.stringify({ type: "runtime-job", protocolVersion: 1, job: snapshot("job_recovered", "queued") }));
    } else {
      inspectCount += 1;
      const jobId = request.url.split("/").at(-1);
      response.end(JSON.stringify({ type: "runtime-job", protocolVersion: 1, job: snapshot(jobId, jobId === "job_dead" ? "failed" : "running") }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.BREADBOARD_SUPERVISOR_CONTROL_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN = "0123456789abcdef0123456789abcdef";
  try {
    const get = () => route.GET(new Request(`http://dashboard.local/api/thought-topology?clusterSlug=${slug}`));
    const first = await (await get()).json();
    // Dispatch persists asynchronously, just as it does for real mutations.
    for (let attempt = 0; attempt < 100 && !db.prepare("SELECT id FROM thought_topology_jobs WHERE runtime_job_id = 'job_recovered'").get(); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const old = db.prepare("SELECT status FROM thought_topology_jobs WHERE runtime_job_id = 'job_dead'").get();
    assert.equal(old.status, "failed");
    assert.equal(first.status.state, "building");
    assert.notEqual(first.status.progress, 12, "the dead worker's percentage must not carry into its replacement");
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].requestPayload.revision, 10);
    assert.notEqual(submissions[0].requestPayload.queueJobId, db.prepare("SELECT id FROM thought_topology_jobs WHERE runtime_job_id = 'job_dead'").get().id);
    const next = await (await get()).json();
    assert.equal(next.status.progress, 12);
    assert.equal(inspectCount, 2, "reuse each read's Runtime observation for renderer progress");
    assert.equal(submissions.length, 1, "live workers are never duplicated");
    assert.doesNotMatch(JSON.stringify(next), /WORKER_FAILED|Runtime job execution failed/);
    runtimeUnavailable = true;
    await get();
    assert.equal(db.prepare("SELECT status FROM thought_topology_jobs WHERE runtime_job_id = 'job_recovered'").get().status, "queued");
    assert.equal(submissions.length, 1, "inspection outages must not be mistaken for terminal workers");
    db.prepare("UPDATE thought_topology_jobs SET status = 'failed' WHERE runtime_job_id = 'job_recovered'").run();
    const failed = await (await get()).json();
    assert.equal(failed.status.state, "failed", "a throttled retry without an artifact must not say it is building");
    assert.equal(failed.status.progress, undefined);
  } finally {
    delete process.env.BREADBOARD_SUPERVISOR_CONTROL_URL;
    delete process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
