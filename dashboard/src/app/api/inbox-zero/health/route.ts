import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { readInboxZeroStatus } from "@/lib/inbox-zero/runtime-service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await requireUserId();
    // Health never starts containers: opening a settings panel must not cost a
    // four-image pull. The Runtime-owned controller observes; only a run or an
    // explicit setup action may issue Compose commands.
    return NextResponse.json({ ok: true, ...(await readInboxZeroStatus({ userId })) });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
