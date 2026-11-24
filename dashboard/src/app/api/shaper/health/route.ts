import { NextResponse } from "next/server";
import { SupervisorControlError } from "@/lib/supervisor-control.ts";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { shapeRHealth } from "@/lib/shaper/runtime.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const health = await shapeRHealth({ userId, force: refresh });
    return NextResponse.json({ ok: true, ...health });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    // A service that could not start says which one and why (no paths or secrets).
    if (error instanceof SupervisorControlError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
