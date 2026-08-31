import { NextResponse } from "next/server";
import { externalRuntimePath as path } from "@/lib/external-runtime-path";
import {
  requireReadableClusterFromSlugOrPublic,
  routeErrorResponse,
} from "@/lib/server-auth";
import {
  readThoughtTopology,
  rendererArtifactContainsVector,
} from "@/lib/thought-topology/storage";
import {
  THOUGHT_TOPOLOGY_SCHEMA_VERSION,
  type ThoughtTopology,
  type ThoughtTopologyApiResponse,
} from "@/lib/thought-topology/types";
import { corsHeaders } from "@/lib/hermes/quartz-support";
import db from "@/lib/db";

export const dynamic = "force-dynamic";

function buildingTopology(cluster: { id: number; slug: string; name: string }): ThoughtTopology {
  return {
    schemaVersion: THOUGHT_TOPOLOGY_SCHEMA_VERSION,
    scoringVersion: "thought-topology-affinity-v1",
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
      nodePromptVersion: "thought-topology-node-summary-v1",
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

function rendererStatus(clusterId: number, hasTopology: boolean): Extract<ThoughtTopologyApiResponse, { enabled: true }>["status"] {
  const latest = db.prepare(
    `SELECT status
       FROM thought_topology_jobs
      WHERE cluster_id = ?
      ORDER BY revision DESC, id DESC
      LIMIT 1`,
  ).get(clusterId) as { status: string } | undefined;
  if (latest?.status === "queued" || latest?.status === "running" || !hasTopology) {
    return { state: "building", message: hasTopology ? "Updating Thought Topology…" : "Preparing Thought Topology…" };
  }
  if (latest?.status === "failed") {
    return { state: "failed", message: "Showing the last available topology; the latest update failed." };
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

    const contentRoot = process.env.QUARTZ_CONTENT_PATH;
    if (!contentRoot) throw new Error("QUARTZ_CONTENT_PATH not configured");
    const topology = readThoughtTopology(path.join(contentRoot, cluster.slug));
    const renderer = topology ?? buildingTopology(cluster);
    const status = rendererStatus(cluster.id, Boolean(topology));
    if (rendererArtifactContainsVector(renderer)) {
      throw new Error("Thought Topology renderer payload failed its privacy boundary.");
    }
    return response({
      enabled: true,
      mode: "thought-topology",
      topology: renderer,
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
