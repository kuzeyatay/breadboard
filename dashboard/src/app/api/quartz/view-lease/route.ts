import { NextResponse } from "next/server";
import {
  releaseQuartzViewLease,
  renewQuartzViewLease,
} from "@/lib/quartz-view-lease";
import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 256;
const VIEW_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function readViewId(request: Request): Promise<string> {
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    throw new RouteError(413, "Quartz view lease request is too large.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new RouteError(400, "A valid Quartz view lease request is required.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RouteError(400, "A valid Quartz view lease request is required.");
  }
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !VIEW_ID_PATTERN.test(String(record.viewId ?? ""))) {
    throw new RouteError(400, "A valid Quartz view identifier is required.");
  }
  return String(record.viewId);
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const viewId = await readViewId(request);
    const lease = await renewQuartzViewLease(userId, viewId);
    return NextResponse.json(
      { ok: true, expiresInMs: lease.expiresInMs },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId();
    const viewId = await readViewId(request);
    await releaseQuartzViewLease(userId, viewId);
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error);
  }
}
