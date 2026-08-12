import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { health } from "@/lib/deep-tutor/runtime.ts";
import { resolveScope } from "@/lib/deep-tutor/materials.ts";
import { buildProgress, indexState } from "@/lib/deep-tutor/knowledge-base.ts";
import { embeddingsHealth } from "@/lib/deep-tutor/embeddings.ts";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    const state = await health({ force: url.searchParams.get("force") === "1" });
    const scope = resolveScope({
      userId,
      surface: gardenSlug ? "garden_chat" : "dashboard_terminal",
      clusterSlug: gardenSlug || null,
    });
    const { baseURL } = resolveChatmockBaseUrl(request);
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
      index: { ...indexState(userId, scope), progress: buildProgress(userId, scope) },
      embeddings: await embeddingsHealth(baseURL),
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
