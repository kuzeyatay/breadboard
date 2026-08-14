import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { installResource2Skill, setupStatus } from "@/lib/resource2skill/setup.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUserId();
    return NextResponse.json({ ok: true, status: setupStatus() });
  } catch (error) {
    if (error instanceof RouteError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireUserId();
    const body = await request.json() as { action?: unknown };
    if (body.action !== "install-runtime" && body.action !== "install-web" && body.action !== "install-blender") {
      return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
    }
    const result = await installResource2Skill(body.action);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    if (error instanceof RouteError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
