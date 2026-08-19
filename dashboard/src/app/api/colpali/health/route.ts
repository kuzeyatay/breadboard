import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { colpaliMode, colpaliModel, colpaliTopK } from "@/lib/colpali/config.ts";
import { colpaliHealth } from "@/lib/colpali/service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Whether attached documents are being searched by page, or inlined whole.
 *
 * Passive: reading this never loads the model. The service answers from a torch
 * import and a directory count, so a machine that never ran `setup:colpali`
 * answers as quickly as one that did — it just answers "unreachable", which is
 * a supported state and not an error.
 */
export async function GET() {
  try {
    await requireUserId();
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const health = await colpaliHealth();
  return NextResponse.json({
    mode: colpaliMode(),
    // What the *dashboard* expects to be running. A mismatch with
    // `health.modelId` means every existing index is unreadable, which is worth
    // seeing side by side rather than discovering one failed search at a time.
    expectedModel: colpaliModel(),
    topK: colpaliTopK(),
    service: health,
    // The one sentence that answers "is this doing anything right now".
    summary:
      health.status === "ok"
        ? `Searching document pages with ${health.modelId} on ${health.device}.`
        : health.status === "degraded"
          ? `ColPali is installed but not usable: ${health.detail || "unknown reason"}. Documents are being inlined whole.`
          : "ColPali is not running. Documents are being inlined whole, as they were before it existed.",
  });
}
