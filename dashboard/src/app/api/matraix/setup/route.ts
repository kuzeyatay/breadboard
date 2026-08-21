import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { installEnvironment, setupStatus } from "@/lib/matraix/setup.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUserId();
    return NextResponse.json({ ok: true, status: setupStatus() });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}

// An install runs only because a person pressed the button in the setup dialog.
// Nothing a model produces reaches this route, and the argv it runs is fixed.
export async function POST(request: Request) {
  try {
    await requireUserId();
    const body = (await request.json()) as { action?: unknown };
    if (body.action !== "install-runtime") {
      return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
    }
    return NextResponse.json(await installEnvironment());
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
