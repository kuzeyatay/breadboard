import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { CadServiceError } from "@/lib/cad/errors.ts";
import { cadServiceConfigured, cadServiceHealth } from "@/lib/cad/service.ts";
import {
  describeSolidWorksAvailability,
  solidworksAvailability,
} from "@/lib/cad/solidworks/availability.ts";
import { solidworksBridge } from "@/lib/cad/solidworks/bridge.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The state of every CAD backend, per backend rather than as one flag.
 *
 * Passive throughout: reading it never starts the CadQuery service, never
 * starts the SolidWorks bridge, and never starts SolidWorks. The SolidWorks
 * half is a filesystem check plus a process listing, so a machine with no
 * SolidWorks on it answers as quickly as one with it.
 */
async function backends() {
  const solidworks = await solidworksAvailability();
  const bridge = solidworksBridge().status();
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
