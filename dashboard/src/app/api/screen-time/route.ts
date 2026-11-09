import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { readScreenTime, updateScreenTimeSettings } from "@/lib/screen-time/store";
import { invalidateRecommendations } from "@/lib/recommendations/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof RouteError ? error.message : "Screen Time could not read its local data. Try again." },
    { status: error instanceof RouteError ? error.status : 500, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const params = new URL(request.url).searchParams;
    const boundaries = (params.get("boundaries") ?? "").split(",").map(Number);
    const start = boundaries[0], end = boundaries.at(-1) ?? 0;
    const previousStart = Number(params.get("previousStart")), previousEnd = start;
    if (boundaries.length < 2 || boundaries.length > 32 || boundaries.some((time, i) => !Number.isSafeInteger(time) || time <= 0 || (i > 0 && time <= boundaries[i - 1])) ||
        end - start > 32 * 86400000 || !Number.isSafeInteger(previousStart) || previousStart <= 0 || previousStart >= start || start - previousStart > 32 * 86400000 ||
        start > Date.now() + 86400000) throw new RouteError(400, "Choose a valid day, week or month.");
    return NextResponse.json(await readScreenTime(userId, { start, end, boundaries, previousStart, previousEnd }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireUserId();
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) throw new RouteError(403, "Use Screen Time in Breadboard to change tracking.");
    const raw = await request.text();
    if (raw.length > 22000) throw new RouteError(400, "Too many exclusions.");
    let body: { enabled?: unknown; excluded?: unknown; useForSuggestions?: unknown };
    try { body = JSON.parse(raw); } catch { throw new RouteError(400, "Invalid settings."); }
    if (!body || typeof body !== "object" || (body.enabled !== undefined && typeof body.enabled !== "boolean") ||
      (body.useForSuggestions !== undefined && typeof body.useForSuggestions !== "boolean") ||
      (body.excluded !== undefined && (!Array.isArray(body.excluded) || body.excluded.length > 100 || body.excluded.some(item => typeof item !== "string" || item.length > 200))))
      throw new RouteError(400, "Invalid settings.");
    const settings = await updateScreenTimeSettings(userId, body as { enabled?: boolean; excluded?: string[]; useForSuggestions?: boolean });
    invalidateRecommendations(userId);
    return NextResponse.json({ settings });
  } catch (error) { return failure(error); }
}
