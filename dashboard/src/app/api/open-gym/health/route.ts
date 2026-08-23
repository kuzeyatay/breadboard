import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { openGymCatalogHealth } from "@/lib/open-gym/catalog.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUserId();
    return NextResponse.json({ ok: true, ...(await openGymCatalogHealth()) });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
