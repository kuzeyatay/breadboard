import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import {
  install,
  removeIdentityPhoto,
  saveIdentityPhoto,
  setupStatus,
} from "@/lib/wardrobe/setup.ts";
import { stopService } from "@/lib/wardrobe/service.ts";
import { closeImagesBridge } from "@/lib/wardrobe/bridge.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The actions only a person may authorize. Nothing a model says reaches this
 * route: it is called by the buttons in the settings dialog, and a run never
 * installs anything or writes an identity photo.
 */
export async function POST(request: Request) {
  try {
    await requireUserId();
    const text = await request.text();
    if (text.length > 24 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const action = typeof body.action === "string" ? body.action : "install";

    if (action === "restart") {
      // The clone reads its settings once, at config time, so a person who has
      // changed a model or a quality wants the next run on a fresh server.
      stopService();
      closeImagesBridge();
      return NextResponse.json({
        ok: true,
        message: "Stopped. The next import starts a fresh server.",
        status: setupStatus(),
      });
    }

    if (action === "identity") {
      const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
      if (!dataUrl) {
        return NextResponse.json({ ok: false, error: "missing_photo" }, { status: 400 });
      }
      const result = await saveIdentityPhoto(dataUrl);
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }

    if (action === "identity-remove") {
      return NextResponse.json(await removeIdentityPhoto());
    }

    if (action !== "install") {
      return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
    }

    const result = await install();
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
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
