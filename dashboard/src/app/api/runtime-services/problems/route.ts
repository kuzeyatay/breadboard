import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { readServiceProblems } from "@/lib/supervisor-control.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Local services the Runtime holds failed, so the UI can offer an explicit Retry. */
export async function GET() {
  try {
    await requireUserId();
    const problems = await readServiceProblems();
    return NextResponse.json({ ok: true, desktop: problems !== null, problems: problems ?? [] });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "Could not read local service status." }, { status: 503 });
  }
}
