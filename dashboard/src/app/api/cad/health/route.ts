import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { CadServiceError } from "@/lib/cad/errors.ts";
import { cadServiceConfigured, cadServiceHealth } from "@/lib/cad/service.ts";
import { readSolidWorksRuntimeStatus } from "@/lib/cad/solidworks/runtime-service.ts";
import { describeSolidWorksAvailability } from "@/lib/cad/solidworks/status.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The state of every CAD backend, per backend rather than as one flag.
 *
 * Passive throughout: reading it never starts the CadQuery service, never
 * starts the SolidWorks bridge, and never starts SolidWorks. The SolidWorks
 * half reads the native lifecycle projection and process-free installation
 * markers. It asks the private bridge for detail only when that service is
 * already healthy; it never acquires a lease or wakes Python/SolidWorks.
 */
async function backends() {
  const { availability: solidworks, bridge } = await readSolidWorksRuntimeStatus();
  return {
    solidworks: {
      available: solidworks.available,
      code: solidworks.code,
      status: describeSolidWorksAvailability(solidworks),
      // Whether the application is up, not whether Breadboard is talking to it.
      running: solidworks.running,
      // Whether Breadboard's own bridge process is up, which is a separate
      // question and never implies the first.
      connected: bridge.running,
      ...(solidworks.version ? { version: solidworks.version } : {}),
      message: solidworks.message,
    },
  };
}

export async function GET() {
  try {
    await requireUserId();
    const extra = await backends();
    if (!cadServiceConfigured()) {
      return NextResponse.json({
        ok: false,
        configured: false,
        status: "unconfigured",
        engines: { cadquery: { available: false }, ...extra },
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
      engines: {
        cadquery: {
          available: health.engines.includes("cadquery"),
          version: health.cadqueryVersion,
        },
        ...extra,
      },
      ...(health.detail ? { detail: health.detail } : {}),
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof CadServiceError) {
      // The CadQuery service being down says nothing about SolidWorks, so the
      // per-backend report is still worth returning.
      const extra = await backends().catch(() => ({}));
      return NextResponse.json(
        {
          ok: false,
          configured: true,
          status: "unavailable",
          error: error.code,
          message: error.message,
          engines: { cadquery: { available: false }, ...extra },
        },
        { status: 200 },
      );
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
