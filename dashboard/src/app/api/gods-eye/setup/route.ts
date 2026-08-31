import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { clearGoogleMapsKey, storeGoogleMapsKey } from "@/lib/gods-eye/credentials.ts";
import { setupStatus, startGodsEyeSetup } from "@/lib/gods-eye/setup.ts";
import { stopService } from "@/lib/gods-eye/service.ts";

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

// Setup actions run only because a person pressed a button in the settings
// dialog. Nothing a model produces reaches this route, and the install argv is
// fixed. The key is stored one-way: status reports whether it is set, never
// its value.
export async function POST(request: Request) {
  try {
    await requireUserId();
    const text = await request.text();
    if (text.length > 8 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as { action?: unknown; key?: unknown }) : {};
    if (body.action === "stop") {
      stopService();
      return NextResponse.json({
        ok: true,
        message: "The God's Eye server was stopped.",
        status: setupStatus(),
      });
    }
    if (body.action === "set-key") {
      if (typeof body.key !== "string" || !body.key.trim()) {
        return NextResponse.json({ ok: false, error: "empty_key" }, { status: 400 });
      }
      storeGoogleMapsKey(body.key);
      // The dev server reads the key at boot, so a changed key means a restart
      // the next time a view is opened.
      stopService();
      return NextResponse.json({
        ok: true,
        message: "Google Maps key saved.",
        status: setupStatus(),
      });
    }
    if (body.action === "clear-key") {
      clearGoogleMapsKey();
      stopService();
      return NextResponse.json({
        ok: true,
        message: "Stored Google Maps key removed.",
        status: setupStatus(),
      });
    }
    if (body.action !== "install") {
      return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
    }
    const progress = startGodsEyeSetup();
    return NextResponse.json(
      {
        ok: true,
        message: progress.running
          ? "Installing the clone's dependencies — a few minutes the first time."
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
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
