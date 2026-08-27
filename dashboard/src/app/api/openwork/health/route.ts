import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { readOpenworkRuntimeStatus } from "@/lib/openwork/runtime-service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await requireUserId();
    const { availability, setup, service } = await readOpenworkRuntimeStatus({ userId });
    return NextResponse.json({
      ok: true,
      available: availability.available,
      reason: availability.reason ?? null,
      missing: availability.missing,
      setup,
      // Runtime may start its small authenticated adapter to inspect setup;
      // `service` still reports only the heavyweight OpenWork child tree.
      service: service
        ? {
            running: true,
            workspaceId: service.workspaceId,
            workspacePath: service.workspacePath,
            startedAt: new Date(service.startedAt).toISOString(),
          }
        : { running: false },
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
