// Downloading one deliverable from a live run.
//
// A file the artifact store kept is already a card of its own in the chat; this
// is the copy the run still holds, which is all there is for one the store
// would not take, and all there is before the artifact panel has caught up.
// The run's retention window is what bounds it — once the workspace is cleaned
// up, the artifact is the only copy, which is the intended end state.

import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { readDeliverable } from "@/lib/legal/run-manager.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string; path: string[] }> },
) {
  try {
    const userId = await requireUserId();
    const { runId, path } = await params;
    // The run only serves paths it recorded as its own output, so a traversal
    // fails the lookup rather than the containment check — which also runs.
    const relativePath = (path ?? []).map((segment) => decodeURIComponent(segment)).join("/");
    const file = readDeliverable(userId, runId, relativePath);
    if (!file) {
      return NextResponse.json({ ok: false, error: "file_not_found" }, { status: 404 });
    }
    return new Response(new Uint8Array(file.buffer), {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${file.filename.replace(/"/g, "")}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const status = error instanceof Error && error.message === "run_not_found" ? 404 : 500;
    return NextResponse.json(
      { ok: false, error: status === 404 ? "run_not_found" : "internal_error" },
      { status },
    );
  }
}
