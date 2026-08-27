import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { readRunDeliverable } from "@/lib/openscience/runtime-run-manager.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Download one file the run produced. The path arrives as a query parameter
 * rather than a path segment because a deliverable is nested
 * (`figures/decay.png`) and the run manager, not the router, is what decides
 * whether a path is one this run reported.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { runId } = await params;
    const requested = new URL(request.url).searchParams.get("path") ?? "";
    if (!requested) {
      return NextResponse.json({ ok: false, error: "path_required" }, { status: 400 });
    }
    const deliverable = await readRunDeliverable(userId, runId, requested);
    const body = Readable.toWeb(
      fs.createReadStream(deliverable.absolutePath, { highWaterMark: 1024 * 1024 }),
    ) as ReadableStream<Uint8Array>;
    return new Response(body, {
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(deliverable.byteSize),
        "content-disposition": `attachment; filename="${deliverable.filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "";
    const status = message === "run_not_found" || message === "deliverable_not_found" ? 404 : 500;
    return NextResponse.json(
      { ok: false, error: status === 404 ? message : "internal_error" },
      { status },
    );
  }
}
