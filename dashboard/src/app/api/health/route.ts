import { NextResponse } from "next/server";
import db from "@/lib/db";

export const dynamic = "force-dynamic";

// Liveness/readiness probe for the desktop supervisor (and local tooling).
// Verifies the process is serving requests and the SQLite database is
// reachable. Never exposes configuration or secrets.
export async function GET() {
  try {
    db.prepare("SELECT 1").get();
    return NextResponse.json({ status: "ok", sourceReleaseId: process.env.BREADBOARD_SOURCE_RELEASE_ID || null });
  } catch {
    return NextResponse.json({ status: "degraded", database: "unavailable" }, { status: 503 });
  }
}
