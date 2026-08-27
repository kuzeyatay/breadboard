import { NextResponse } from "next/server";
import db from "@/lib/db.ts";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { health } from "@/lib/deep-tutor/runtime.ts";
import { resolveScope } from "@/lib/deep-tutor/materials.ts";
import { embeddingsHealth } from "@/lib/deep-tutor/embeddings.ts";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import {
  deepTutorIndexStatus,
  runDeepTutorProbeJob,
} from "@/lib/runtime-v2/deep-tutor-maintenance-job.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ClusterRow {
  slug: string;
  name: string;
  user_id: number;
}

function requireOwnGarden(userId: number, slug: string): ClusterRow {
  const row = db
    .prepare("SELECT slug, name, user_id FROM clusters WHERE slug = ?")
    .get(slug) as ClusterRow | undefined;
  if (!row) throw new RouteError(404, "garden_not_found");
  if (row.user_id !== userId) throw new RouteError(403, "garden_not_yours");
  return row;
}

/**
 * Whether the tutor can run, and what it would be able to read if it did.
 *
 * The scope half matters as much as the runtime half: a Garden whose directory
 * does not exist yet produces a tutor that can talk but has nothing to teach
 * from, and the composer should be able to say so before the first question
 * rather than after a disappointing answer.
 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const gardenSlug = url.searchParams.get("gardenSlug")?.trim() ?? "";
    const garden = gardenSlug ? requireOwnGarden(userId, gardenSlug) : null;
    const scope = resolveScope({
      userId,
      surface: garden ? "garden_chat" : "dashboard_terminal",
      clusterSlug: garden?.slug ?? null,
      gardenName: garden?.name ?? null,
    });
    const { baseURL } = resolveChatmockBaseUrl(request);
    const [state, index, embeddings] = await Promise.all([
      health({
        force: url.searchParams.get("force") === "1",
        probeEnvironment: () => runDeepTutorProbeJob({ userId, signal: request.signal }),
      }),
      deepTutorIndexStatus(userId, scope),
      embeddingsHealth(baseURL),
    ]);
    return NextResponse.json({
      ok: true,
      ...state,
      scope: {
        kind: scope.kind,
        label: scope.label,
        rootCount: scope.roots.length,
      },
      // Retrieval is reported separately from the runtime because it fails
      // separately: a tutor with no embedder still teaches, it just reads
      // rather than retrieves.
      index,
      embeddings,
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
