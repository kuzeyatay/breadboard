import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { toolchainStatus } from "@/lib/openmontage/setup.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUserId();
    const status = toolchainStatus();
    return NextResponse.json({
      ok: true,
      available: status.ready,
      reason: status.reason || null,
      status,
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
