import { NextResponse } from "next/server";
import path from "node:path";
import { requireOwnedClusterFromSlug, routeErrorResponse } from "@/lib/server-auth";
import { getArtifactForUser, ArtifactStoreError } from "@/lib/hermes/artifact-store.ts";
import { snapshotArtifactForLearn } from "@/lib/hermes/learn-artifact-snapshot.ts";
import { learnArtifactKey, readLearnArtifacts, writeLearnArtifactSelection } from "@/lib/learn-artifacts.ts";
import { acquireGardenMutationLease, isGardenMutationBusyError } from "@/lib/garden-mutation-lease.ts";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ gardenId: string }> };

async function scope(context: Context) {
  const { gardenId } = await context.params;
  const { userId, cluster } = await requireOwnedClusterFromSlug(gardenId);
  const root = process.env.QUARTZ_CONTENT_PATH;
  if (!root) throw new Error("QUARTZ_CONTENT_PATH not configured");
  return { userId, slug: cluster.slug, gardenDir: path.join(root, cluster.slug) };
}

function summary(artifacts: ReturnType<typeof readLearnArtifacts>) {
  return artifacts.map(({ content: _content, ...artifact }) => artifact);
}

export async function GET(_request: Request, context: Context) {
  try {
    const { gardenDir } = await scope(context);
    return NextResponse.json({ artifacts: summary(readLearnArtifacts(gardenDir)) });
  } catch (error) { return routeErrorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const { userId, slug, gardenDir } = await scope(context);
    const body = await request.json().catch(() => null);
    if (!body || typeof body.artifactId !== "string" || typeof body.conversationId !== "string" ||
        !Number.isSafeInteger(body.version) || body.version < 1 || typeof body.included !== "boolean") {
      return NextResponse.json({ error: "Choose an artifact version and whether to include it in Learn." }, { status: 400 });
    }
    const key = learnArtifactKey({ id: body.artifactId, version: body.version });
    let snapshot = null;
    if (body.included) {
      const artifact = getArtifactForUser({ userId, artifactId: body.artifactId, conversationPublicId: body.conversationId });
      if (artifact.garden_slug !== slug) return NextResponse.json({ error: "Artifact does not belong to this garden." }, { status: 404 });
      snapshot = await snapshotArtifactForLearn(artifact, body.version);
    }
    const lease = acquireGardenMutationLease(gardenDir, "select-learn-artifact");
    try {
      return NextResponse.json({ artifacts: summary(writeLearnArtifactSelection(gardenDir, key, snapshot)) });
    } finally { lease.release(); }
  } catch (error) {
    if (isGardenMutationBusyError(error)) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof ArtifactStoreError) return NextResponse.json({ error: error.message }, { status: error.status });
    return routeErrorResponse(error);
  }
}
