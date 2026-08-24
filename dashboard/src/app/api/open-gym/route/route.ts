import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { resolveOpenGymSuperAgentRoute } from "@/lib/open-gym/routing.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireUserId();
    const text = await request.text();
    if (text.length > 16 * 1024) {
      return NextResponse.json({ route: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? JSON.parse(text) as Record<string, unknown> : {};
    const task = typeof body.task === "string" ? body.task.trim() : "";
    if (!task) {
      return NextResponse.json({ route: false, reason: null });
    }
    return NextResponse.json(await resolveOpenGymSuperAgentRoute(task));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ route: false, error: "invalid_json" }, { status: 400 });
    }
    if (error instanceof RouteError) {
      return NextResponse.json({ route: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ route: false, error: "internal_error" }, { status: 500 });
  }
}
