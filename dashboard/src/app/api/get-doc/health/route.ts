import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { sourceAvailability } from "@/lib/get-doc/runtime-run-manager.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Get Doc has nothing to install: its catalogs are public APIs. So health is
 * about what is configured rather than what is present — which sources will
 * answer, and whether a contact address is set, without which Unpaywall cannot
 * be asked and some downloads are lost.
 */
export async function GET() {
  try {
    await requireUserId();
    const availability = sourceAvailability();
    return NextResponse.json({
      ok: true,
      available: availability.ready.length > 0,
      sources: availability.ready,
      unavailable: availability.unavailable,
      contactConfigured: availability.contactConfigured,
      reason: availability.ready.length ? null : "No document catalogs are available.",
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
