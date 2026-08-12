import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { CadServiceError } from "@/lib/cad/errors.ts";
import { cadServiceConfigured, cadServiceHealth } from "@/lib/cad/service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Setup diagnostics for the local CAD runtime. Authenticated, because it names
 * the interpreter and library versions installed on the machine — but it never
 * returns the service address or its shared secret.
 */
export async function GET() {
  try {
    await requireUserId();
    if (!cadServiceConfigured()) {
      return NextResponse.json({
        ok: false,
        configured: false,
        status: "unconfigured",
        message:
          "The CAD service is not configured. Run `npm run setup:cad` once, then `npm run dev:cad` " +
          "alongside the dashboard — or start the desktop app, which supervises it.",
      });
    }
    const health = await cadServiceHealth();
    return NextResponse.json({
      ok: health.status === "ok",
      configured: true,
      status: health.status,
      serviceVersion: health.serviceVersion,
      pythonVersion: health.pythonVersion,
      cadqueryVersion: health.cadqueryVersion,
      ocpVersion: health.ocpVersion,
      exportFormats: health.exportFormats,
      engines: health.engines,
      ...(health.detail ? { detail: health.detail } : {}),
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof CadServiceError) {
      return NextResponse.json(
        {
          ok: false,
          configured: true,
          status: "unavailable",
          error: error.code,
          message: error.message,
        },
        { status: 200 },
      );
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
