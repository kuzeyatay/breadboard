import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { searchRecall } from "@/lib/recall/service";
import { readRecallBody, recallErrorResponse } from "@/lib/recall/route-helpers";
import { RecallError } from "@/lib/recall/errors";
import { getRecallSettings } from "@/lib/recall/settings";
import { recallDatabaseQuarantined } from "@/lib/recall/install";
import { readRecallRuntimeStatus, recallRuntimeManaged } from "@/lib/recall/runtime-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const userId = await requireUserId(), body = await readRecallBody(request);
    const start = typeof body.start === "number" ? body.start : NaN;
    const end = typeof body.end === "number" ? body.end : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= start || end - start > 32 * 86400000)
      throw new RouteError(400, "Choose an activity to revisit.");
    const result = await searchRecall(userId, { contentType: "screen", limit: 10,
      startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString(),
      appName: typeof body.app === "string" ? body.app.slice(0, 300) : undefined,
      windowName: typeof body.title === "string" ? body.title.slice(0, 300) : undefined });
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return recallErrorResponse(await explainUnavailable(error)); }
}

/** "Not running" says nothing about why. Name the cause the user can act on. */
async function explainUnavailable(error: unknown): Promise<unknown> {
  if (!(error instanceof RecallError) || error.code !== "engine_unavailable") return error;
  try {
    const userId = await requireUserId();
    if (!getRecallSettings(userId).captureEnabled) return new RecallError("capture_disabled", { userMessage: "Recall capture is switched off, so there is no history to show. Turn it on in Recall settings." });
    if (recallDatabaseQuarantined()) return new RecallError("engine_unavailable", { userMessage: "Recall paused itself after the disk filled up and is checking its history. This can take a few minutes." });
    if (!recallRuntimeManaged()) return error;
    const status = await readRecallRuntimeStatus(userId);
    if (!status) return error;
    if (status.serviceState === "resource-blocked" || status.serviceState === "failed")
      return new RecallError("engine_unavailable", { userMessage: "Recall stopped because the computer is low on memory. It starts again by itself once memory frees up; closing a few apps helps." });
    if (status.serviceState === "starting" || status.serviceState === "pending")
      return new RecallError("engine_unavailable", { userMessage: "Recall is still starting. Try again in a moment." });
  } catch { /* fall back to the generic message */ }
  return error;
}
