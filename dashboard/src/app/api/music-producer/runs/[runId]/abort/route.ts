import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { abortRun } from "@/lib/music-producer/run-manager.ts";
import { musicRouteError } from "@/lib/music-producer/route-error.ts";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(_request: Request, context: {
  params: Promise<{
    runId: string;
  }>;
}) {
  try {
    const userId = await requireUserId(), { runId } = await context.params;
    return NextResponse.json({ ok: true, cancellationRequested: await abortRun(userId, runId), message: "Collection is stopping. Provider computation may continue until it drains or Runtime stops the service." });
  }
  catch (error) {
    return musicRouteError(error);
  }
}
