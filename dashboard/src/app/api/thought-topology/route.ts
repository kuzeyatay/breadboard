import { NextResponse } from "next/server";
import { externalRuntimePath as path } from "@/lib/external-runtime-path";
import {
  requireReadableClusterFromSlugOrPublic,
  requireOwnedClusterFromSlug,
  routeErrorResponse,
} from "@/lib/server-auth";
import {
  readThoughtTopology,
  rendererArtifactContainsVector,
  thoughtTopologyHasCompleteConnections,
} from "@/lib/thought-topology/storage";
import {
  THOUGHT_TOPOLOGY_SCHEMA_VERSION,
  type ThoughtTopology,
  type ThoughtTopologyApiResponse,
} from "@/lib/thought-topology/types";
import { gardenContentFingerprint } from "@/lib/thought-topology/projection";
import { scoringVersionOrdinal, THOUGHT_TOPOLOGY_SCORING } from "@/lib/thought-topology/scoring";
import {
  invalidateThoughtTopologyAfterMutation,
  readPathRepairDelayMs,
  resubmitQueuedThoughtTopologyJob,
  reconcileThoughtTopologyRuntimeJob,
} from "@/lib/thought-topology/state";
import { inspectRuntimeJobForStatus, type RuntimeJobSnapshot } from "@/lib/supervisor-control";
import { corsHeaders } from "@/lib/hermes/quartz-support";
import db from "@/lib/db";
import { thoughtTopologyAutoUpdateEnabled } from "@/lib/thought-topology/preferences";

export const dynamic = "force-dynamic";

// Learn promotions, ingest workers and external editors can change a Garden
// without passing through a mutation route that queues a Thought Topology
// build. Reads compare the Markdown tree with the build-time fingerprint and
// also repair historical incomplete artifacts, at most once per interval.
const DRIFT_CHECK_INTERVAL_MS = 15_000;
const lastDriftCheckAt = new Map<number, number>();

// Every repair queued here reproduces its own trigger until a build succeeds,
// so a Garden whose builds keep failing (embeddings unavailable, a worker that
// cannot start) is retried on a backoff rather than on every drift check.
function readPathRepairDue(cluster: { id: number }, now: number): boolean {
  if (now - (lastDriftCheckAt.get(cluster.id) ?? 0) < DRIFT_CHECK_INTERVAL_MS) return false;
  if (readPathRepairDelayMs(cluster.id, undefined, now) > 0) return false;
  lastDriftCheckAt.set(cluster.id, now);
  return true;
}

async function queueRebuildForStoredTopology(
  cluster: { id: number; slug: string },
  gardenDir: string,
  topology: ThoughtTopology,
): Promise<boolean> {
  if (!readPathRepairDue(cluster, Date.now())) return false;
  // Old builds could publish budget-deferred connection explanations. Repair
  // those snapshots from the read path because they are deliberately hidden
  // from the renderer. Also repair maps built before source-anchor provenance
  // and endpoint-independent connection selection were supported.
  const reason = topologyRebuildReason(cluster, gardenDir, topology);
  if (!reason) return false;
  try {
    const queued = await invalidateThoughtTopologyAfterMutation(cluster.slug, reason);
    return queued.enabled && queued.queueJobId > 0;
  } catch {
    return false;
  }
}

function topologyRebuildReason(
  cluster: { slug: string },
  gardenDir: string,
  topology: ThoughtTopology,
): string | null {
  return !thoughtTopologyHasCompleteConnections(topology)
    ? `Thought Topology for ${cluster.slug} has incomplete connection explanations`
    : scoringVersionOrdinal(topology.scoringVersion) < 4
      ? `Thought Topology for ${cluster.slug} is missing source-anchor connections`
    : topology.build.contentFingerprint !== gardenContentFingerprint(gardenDir)
      ? `Garden content changed since the last Thought Topology build of ${cluster.slug}`
      : null;
}

function buildingTopology(cluster: { id: number; slug: string; name: string }): ThoughtTopology {
  return {
    schemaVersion: THOUGHT_TOPOLOGY_SCHEMA_VERSION,
    scoringVersion: THOUGHT_TOPOLOGY_SCORING.version,
    sourceRevision: "pending",
    garden: {
      id: cluster.id,
      slug: cluster.slug,
      title: cluster.name,
      summary: { state: "pending", text: "Thought Topology is being prepared." },
    },
    folders: [{
      id: "folder:$root",
      path: "",
      parentId: null,
      title: "Garden root",
      depth: 0,
      nodeCount: 0,
      summary: { state: "pending", text: "Pages at the Garden root." },
      x: 0,
      y: 0,
    }],
    nodes: [],
    edges: [],
    build: {
      state: "building",
      generatedAt: new Date(0).toISOString(),
      embeddingModel: "pending",
      embeddingDimension: 0,
      summaryModel: "pending",
      nodePromptVersion: "thought-topology-node-summary-v2",
      edgePromptVersion: "thought-topology-edge-explanation-v1",
      retrievalMode: "concept-lexical",
      threshold: 0.68,
    },
  };
}

function response(body: ThoughtTopologyApiResponse, request: Request): NextResponse {
  return NextResponse.json(body, {
    headers: {
      ...corsHeaders(request.headers.get("origin")),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

interface LatestQueueRow {
  id: number;
  revision: number;
  status: string;
  runtime_job_id: string | null;
  updated_at: string;
}

function hasInspectableRuntimeJob(row: LatestQueueRow | undefined): row is LatestQueueRow & { runtime_job_id: string } {
  return Boolean(row?.runtime_job_id && !row.runtime_job_id.startsWith("submitting:"));
}

function latestQueueRow(clusterId: number): LatestQueueRow | undefined {
  return db.prepare(
    `SELECT id, revision, status, runtime_job_id, updated_at
       FROM thought_topology_jobs
      WHERE cluster_id = ?
      ORDER BY revision DESC, id DESC
      LIMIT 1`,
  ).get(clusterId) as LatestQueueRow | undefined;
}

function activeQueueRow(clusterId: number): LatestQueueRow | undefined {
  return db.prepare(
    `SELECT id, revision, status, runtime_job_id, updated_at
       FROM thought_topology_jobs
      WHERE cluster_id = ? AND status = 'running'
        AND runtime_job_id IS NOT NULL
        AND runtime_job_id NOT LIKE 'submitting:%'
      ORDER BY revision DESC, id DESC
      LIMIT 1`,
  ).get(clusterId) as LatestQueueRow | undefined;
}

// A queued row that never reached the Runtime (submission failed while the
// Runtime restarted or a Learn operation held the Garden) is resubmitted from
// the read path, throttled like the drift check.
const lastResubmitAt = new Map<number, number>();

interface RuntimeProgressHighWater {
  progress: number;
  observedAt: number;
}

// Runtime inspection can briefly race admission or a supervisor restart. A
// transient 0 must not make the public status move backwards for the same job.
const runtimeProgressHighWater = new Map<string, RuntimeProgressHighWater>();
const RUNTIME_PROGRESS_RETENTION_MS = 60 * 60 * 1_000;

function monotonicRuntimeProgress(runtimeJobId: string, candidate: number): number {
  const now = Date.now();
  const previous = runtimeProgressHighWater.get(runtimeJobId)?.progress ?? 0;
  const progress = Math.max(previous, Math.max(0, Math.min(99, Math.floor(candidate))));
  runtimeProgressHighWater.set(runtimeJobId, { progress, observedAt: now });
  if (runtimeProgressHighWater.size > 256) {
    for (const [jobId, state] of runtimeProgressHighWater) {
      if (now - state.observedAt > RUNTIME_PROGRESS_RETENTION_MS) {
        runtimeProgressHighWater.delete(jobId);
      }
    }
    while (runtimeProgressHighWater.size > 256) {
      const oldestJobId = runtimeProgressHighWater.keys().next().value as string | undefined;
      if (!oldestJobId) break;
      runtimeProgressHighWater.delete(oldestJobId);
    }
  }
  return progress;
}

async function resubmitStrandedQueueRow(cluster: { id: number; slug: string }, latest: LatestQueueRow | undefined): Promise<void> {
  if (!latest || !["queued", "running"].includes(latest.status) || hasInspectableRuntimeJob(latest)) return;
  const now = Date.now();
  if (now - (lastResubmitAt.get(cluster.id) ?? 0) < DRIFT_CHECK_INTERVAL_MS) return;
  lastResubmitAt.set(cluster.id, now);
  await resubmitQueuedThoughtTopologyJob(cluster.slug).catch(() => false);
}

async function queueFirstBuild(cluster: { id: number; slug: string }): Promise<void> {
  if (!readPathRepairDue(cluster, Date.now())) return;
  await invalidateThoughtTopologyAfterMutation(
    cluster.slug,
    `Thought Topology enabled for ${cluster.slug} without a built map`,
  ).catch(() => undefined);
}

interface RuntimeProgressObservation {
  progress: number;
  executing: boolean;
}

async function runtimeBuildProgress(
  cluster: { user_id: number; slug: string },
  latest: LatestQueueRow | undefined,
  observations: Map<string, RuntimeJobSnapshot | null>,
): Promise<RuntimeProgressObservation> {
  if (!hasInspectableRuntimeJob(latest)) {
    return {
      progress: latest?.status === "running" ? 10 : 0,
      executing: latest?.status === "running",
    };
  }
  const remembered = () => monotonicRuntimeProgress(
    latest.runtime_job_id!,
    latest.status === "running" ? 10 : 0,
  );
  try {
    const snapshot = observations.has(latest.runtime_job_id)
      ? observations.get(latest.runtime_job_id)
      : await inspectRuntimeJobForStatus(
      { userId: cluster.user_id, gardenId: cluster.slug, conversationId: null },
      latest.runtime_job_id,
    );
    if (!snapshot || snapshot.jobType !== "thought-topology" || snapshot.workerKind !== "thought-topology-node") {
      return { progress: remembered(), executing: latest.status === "running" };
    }
    const executing = ["starting", "running", "checkpointing", "cancelling"].includes(snapshot.state);
    if (snapshot.progressTotal > 0) {
      return {
        progress: monotonicRuntimeProgress(
          latest.runtime_job_id,
          (snapshot.progressCurrent / snapshot.progressTotal) * 100,
        ),
        executing,
      };
    }
    return {
      progress: monotonicRuntimeProgress(
        latest.runtime_job_id,
        executing ? 10 : 0,
      ),
      executing,
    };
  } catch {
    // Runtime restarts and submission races must not turn a read-only status
    // projection into a failed topology response. The next poll tries again.
    return { progress: remembered(), executing: latest.status === "running" };
  }
}

async function rendererStatus(
  cluster: { id: number; user_id: number; slug: string },
  latest: LatestQueueRow | undefined,
  active: LatestQueueRow | undefined,
  hasTopology: boolean,
  observations: Map<string, RuntimeJobSnapshot | null>,
  automatic = true,
): Promise<Extract<ThoughtTopologyApiResponse, { enabled: true }>["status"]> {
  if (latest?.status === "failed") {
    return { state: "failed", message: hasTopology
      ? "Showing the last available topology; the latest update failed."
      : automatic
        ? "Thought Topology could not be prepared. It will be retried automatically."
        : "Thought Topology could not be prepared. Retry to update it." };
  }
  const submitting = latest?.runtime_job_id?.startsWith("submitting:") &&
    Date.now() - Date.parse(`${latest.updated_at.replace(" ", "T")}Z`) < 30_000;
  const latestIsLive = (latest?.status === "queued" || latest?.status === "running") &&
    (automatic || hasInspectableRuntimeJob(latest) || submitting);
  if (latestIsLive || (!hasTopology && automatic)) {
    // A newer coalesced revision may be waiting while the previous revision is
    // still doing useful work. Follow the actual worker instead of replacing
    // its percentage with the queued follow-up row's synthetic zero.
    let observed = await runtimeBuildProgress(cluster, latest, observations);
    if (!observed.executing && active && active.id !== latest?.id) {
      const activeObservation = await runtimeBuildProgress(cluster, active, observations);
      if (activeObservation.executing) observed = activeObservation;
    }
    const progress = observed.progress;
    const action = hasTopology ? "Updating" : "Preparing";
    return {
      state: "building",
      progress,
      message: `${action} Thought Topology · ${progress}%`,
    };
  }
  if (latest?.status === "stale") {
    return { state: "stale", message: "Showing the last available topology while newer Garden changes are processed." };
  }
  return undefined;
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

export async function GET(request: Request) {
  try {
    const slug = new URL(request.url).searchParams.get("clusterSlug")?.trim();
    if (!slug) return NextResponse.json({ error: "clusterSlug is required" }, { status: 400 });
    const { cluster } = await requireReadableClusterFromSlugOrPublic(slug);

    // This is intentionally the first feature-state branch. Disabled reads do
    // no filesystem work and cannot create a queue row or Runtime job.
    if (cluster.thought_topology_enabled !== 1) {
      return response({ enabled: false, mode: "links" }, request);
    }
    const automatic = thoughtTopologyAutoUpdateEnabled(cluster.user_id);

    const contentRoot = process.env.QUARTZ_CONTENT_PATH;
    if (!contentRoot) throw new Error("QUARTZ_CONTENT_PATH not configured");
    const gardenDir = path.join(contentRoot, cluster.slug);
    const storedTopology = readThoughtTopology(gardenDir);
    // Never send a partially enriched snapshot to Quartz. The placeholder is
    // the only topology visible until the worker has generated every
    // connection explanation and atomically committed the complete artifact.
    const topology = storedTopology && thoughtTopologyHasCompleteConnections(storedTopology)
      ? storedTopology
      : null;
    const renderer = topology ?? buildingTopology(cluster);
    let latest = latestQueueRow(cluster.id);
    if (automatic) await resubmitStrandedQueueRow(cluster, latest);
    // Submission persists the Runtime identity immediately. Refresh so this
    // response can inspect progress without waiting for another browser poll.
    latest = latestQueueRow(cluster.id);
    const observations = new Map<string, RuntimeJobSnapshot | null>();
    if (hasInspectableRuntimeJob(latest) && ["queued", "running"].includes(latest.status)) {
      const snapshot = await inspectRuntimeJobForStatus(
        { userId: cluster.user_id, gardenId: cluster.slug, conversationId: null },
        latest.runtime_job_id,
      ).catch(() => null);
      observations.set(latest.runtime_job_id, snapshot);
      if (snapshot && reconcileThoughtTopologyRuntimeJob(cluster.id, snapshot)) {
        runtimeProgressHighWater.delete(latest.runtime_job_id);
        latest = latestQueueRow(cluster.id);
      }
    }
    // A historical partial artifact is not a last-known-good topology. Queue
    // its repair before deriving status so this response immediately enters
    // the normal build-and-poll flow.
    if (automatic && !topology && storedTopology && (latest === undefined || ["done", "failed", "stale"].includes(latest.status))) {
      await queueRebuildForStoredTopology(cluster, gardenDir, storedTopology);
      latest = latestQueueRow(cluster.id);
    }
    // An enabled Garden with no map and no live queue row (switched on after
    // its creation, or its artifact removed) would otherwise show "Preparing"
    // forever; queue its first build from the read path, throttled as above.
    if (automatic && !storedTopology && (latest === undefined || ["done", "failed", "stale"].includes(latest.status))) {
      await queueFirstBuild(cluster);
      latest = latestQueueRow(cluster.id);
    }
    const active = activeQueueRow(cluster.id);
    let status = await rendererStatus(cluster, latest, active, Boolean(topology), observations, automatic);
    // A build that ended stale or failed is terminal: nothing else will run
    // for this Garden. When the content that made it stale arrived through a
    // path that never queued a job (an ingest worker writing a new source),
    // only this read-path check can queue the build that catches up.
    const terminal = status === undefined || status.state === "stale" || status.state === "failed";
    if (automatic && topology && terminal && await queueRebuildForStoredTopology(cluster, gardenDir, topology)) {
      status = { state: "building", progress: 0, message: "Updating Thought Topology · 0%" };
    }
    if (!automatic && status?.state !== "building") {
      if (!topology || status || (latest && ["queued", "running"].includes(latest.status)) ||
          topologyRebuildReason(cluster, gardenDir, topology) ||
          (latest && latest.revision < cluster.thought_topology_revision)) {
        status = status?.state === "failed" ? status : {
          state: "stale",
          message: topology ? "Thought Topology is out of date." : "Thought Topology has not been prepared yet.",
        };
      }
      // A paused empty map must not start the renderer's build-and-poll loop.
      if (!topology) renderer.build.state = "degraded";
    }
    if (rendererArtifactContainsVector(renderer)) {
      throw new Error("Thought Topology renderer payload failed its privacy boundary.");
    }
    return response({
      enabled: true,
      mode: "thought-topology",
      topology: renderer,
      autoUpdate: automatic,
      retryAvailable: !automatic && (status?.state === "stale" || status?.state === "failed"),
      ...(!topology || status?.state === "failed" || status?.state === "stale" ? { stale: true } : {}),
      ...(status ? { status } : {}),
    }, request);
  } catch (error) {
    const errorResponse = routeErrorResponse(error);
    for (const [key, value] of Object.entries(corsHeaders(request.headers.get("origin")))) {
      errorResponse.headers.set(key, value);
    }
    return errorResponse;
  }
}

/** Manual rebuilds require the same ownership as Garden edits. */
export async function POST(request: Request) {
  try {
    const slug = new URL(request.url).searchParams.get("clusterSlug")?.trim();
    if (!slug) return NextResponse.json({ error: "clusterSlug is required" }, { status: 400 });
    const { cluster } = await requireOwnedClusterFromSlug(slug);
    if (cluster.thought_topology_enabled !== 1) {
      return response({ enabled: false, mode: "links" }, request);
    }
    const latest = latestQueueRow(cluster.id);
    if (latest && ["queued", "running"].includes(latest.status)) {
      await resubmitQueuedThoughtTopologyJob(slug, { manual: true, minimumAgeMs: 0 });
    } else {
      await invalidateThoughtTopologyAfterMutation(slug, "Manual Thought Topology update", { manual: true });
    }
    return GET(request);
  } catch (error) {
    const result = routeErrorResponse(error);
    for (const [key, value] of Object.entries(corsHeaders(request.headers.get("origin")))) {
      result.headers.set(key, value);
    }
    return result;
  }
}
