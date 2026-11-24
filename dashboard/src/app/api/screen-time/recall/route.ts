import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { searchRecall } from "@/lib/recall/service";
import { readRecallBody, recallErrorResponse } from "@/lib/recall/route-helpers";
import { RecallError, recallStorageMessage } from "@/lib/recall/errors";
import { getRecallSettings } from "@/lib/recall/settings";
import { recallDatabaseQuarantined } from "@/lib/recall/install";
import { readRecallRuntimeStatus, recallRuntimeManaged } from "@/lib/recall/runtime-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readRecallBody(request);
    const start = typeof body.start === "number" ? body.start : NaN;
    const end = typeof body.end === "number" ? body.end : NaN;
    if (!Number.isFinite(new Date(start).getTime()) || !Number.isFinite(new Date(end).getTime())
      || start <= 0 || end <= start || end - start > 32 * 86400000)
      throw new RouteError(400, "Choose an activity to revisit.");
    try {
      const result = await searchRecall(userId, { contentType: "screen", limit: 10,
        startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString(),
        appName: typeof body.app === "string" ? body.app.slice(0, 300) : undefined,
        windowName: typeof body.title === "string" ? body.title.slice(0, 300) : undefined,
      }, { allowStoredScreenHistory: true });
      return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return recallErrorResponse(await explainUnavailable(userId, error));
    }
  } catch (error) { return recallErrorResponse(error); }
}

async function explainUnavailable(userId: number, error: unknown): Promise<unknown> {
  if (!(error instanceof RecallError) || error.code !== "engine_unavailable") return error;
  try {
    if (!recallRuntimeManaged()) return error;
    const status = await readRecallRuntimeStatus(userId).catch(() => null);
    const issue = (status?.desiredState === "running" ? status.storageIssue : null)
      ?? (recallDatabaseQuarantined() ? "history-needs-repair" : null);
    if (issue) return new RecallError("engine_unavailable", { userMessage: recallStorageMessage[issue] });
    if (!getRecallSettings(userId).captureEnabled) return new RecallError("capture_disabled");
    if (!status) return error;
    if (status.serviceState === "resource-blocked")
      return new RecallError("engine_unavailable", { userMessage: "Recall is waiting for system resources. Try again in a moment or check Recall settings." });
    if (status.serviceState === "starting" || status.serviceState === "pending")
      return new RecallError("engine_unavailable", { userMessage: "Recall is still starting. Try again in a moment." });
  } catch { /* fall back to the generic message */ }
  return error;
}
