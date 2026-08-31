import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { isClassroomId } from "@/lib/classroom/identity.ts";
import { reopenService } from "@/lib/classroom/service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Where a classroom link lands. The OpenMAIC server's port is chosen when it
 * starts, so a saved link points here and is redirected to wherever the server
 * is now — started again on its last settings if it is not running. The run
 * card frames this URL, and the saved summary links to it.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ classroomId: string }> },
) {
  try {
    await requireUserId();
    const { classroomId } = await params;
    if (!isClassroomId(classroomId)) {
      return NextResponse.json({ ok: false, error: "invalid_classroom_id" }, { status: 400 });
    }
    const pending = reopenService();
    if (!pending) {
      return NextResponse.json(
        {
          ok: false,
          error: "classroom_service_unavailable",
          message: "The OpenMAIC server has not run yet. Generate a classroom first.",
        },
        { status: 503 },
      );
    }
    const service = await pending;
    return NextResponse.redirect(`${service.baseUrl}/classroom/${encodeURIComponent(classroomId)}`, 302);
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      {
        ok: false,
        error: "classroom_service_unavailable",
        message: error instanceof Error ? error.message : "The OpenMAIC server could not be started.",
      },
      { status: 503 },
    );
  }
}
