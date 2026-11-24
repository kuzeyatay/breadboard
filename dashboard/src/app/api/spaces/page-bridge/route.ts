import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, ApiError, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { completePageCall, takePageCalls } from "@/lib/spaces/page-bridge.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The open AFFiNE page editor's long poll for Bread's calls. */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const params = new URL(request.url).searchParams;
    const gardenId = params.get("garden") ?? "", fileId = params.get("file") ?? "";
    if (!gardenId || !fileId) return NextResponse.json({ error: "Name the open page." }, { status: 400 });
    const page = { gardenId, fileId, title: (params.get("title") || "Page").slice(0, 200), mode: params.get("mode") === "edgeless" ? "edgeless" : "page" };
    return NextResponse.json({ calls: await takePageCalls(userId, page, 25_000, request.signal) });
  } catch (error) {
    if (error instanceof ApiError) return apiErrorResponse(error);
    return NextResponse.json({ error: "The page bridge failed." }, { status: 500 });
  }
}

/** One call's answer from the editor. */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request, 2 * 1024 * 1024);
    const known = completePageCall(userId, String(body.id ?? ""), typeof body.error === "string" ? { error: body.error.slice(0, 4000) } : { result: body.result });
    return NextResponse.json({ ok: known });
  } catch (error) {
    if (error instanceof ApiError) return apiErrorResponse(error);
    return NextResponse.json({ error: "The page bridge failed." }, { status: 500 });
  }
}
