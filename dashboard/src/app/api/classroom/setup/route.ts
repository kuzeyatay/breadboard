import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { setupStatus, startClassroomSetup } from "@/lib/classroom/setup.ts";
import { stopService } from "@/lib/classroom/service.ts";

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

// An install runs only because a person pressed the button in the setup
// dialog. Nothing a model produces reaches this route, and the argv it runs is
// fixed. It returns at once: copying, installing and building OpenMAIC takes
// minutes, and the dialog polls GET for progress.
export async function POST(request: Request) {
  try {
    await requireUserId();
    const text = await request.text();
    if (text.length > 8 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as { action?: unknown }) : {};
    if (body.action === "stop") {
      stopService();
      return NextResponse.json({ ok: true, message: "The OpenMAIC server was stopped.", status: setupStatus() });
    }
    if (body.action !== "install") {
      return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
    }
    const progress = startClassroomSetup();
    return NextResponse.json(
      {
        ok: true,
        message: progress.running
          ? "Setting up OpenMAIC. This copies the clone, installs its dependencies and builds it — several minutes the first time."
          : progress.error || "Setup finished.",
        status: setupStatus(),
      },
      { status: 202 },
    );
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
