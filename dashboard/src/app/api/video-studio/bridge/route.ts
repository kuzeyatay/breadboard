import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, ApiError, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { completeCall, takeCalls } from "@/lib/timeline-studio/bridge.ts";
import { markStudioSeen } from "@/lib/timeline-studio/context.ts";
import { ownedMediaArtifact } from "@/lib/timeline-studio/tools.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The Video Studio page's long poll for Bread's editor calls. */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const params = new URL(request.url).searchParams;
    const artifactId = params.get("artifact");
    let source = null;
    if (artifactId) {
      try {
        const artifact = ownedMediaArtifact(userId, artifactId);
        source = { artifactId: artifact.id, conversationId: params.get("conversation") ?? "", title: artifact.title };
      } catch { /* a deleted source leaves the studio on a plain project */ }
    }
    markStudioSeen(userId, source);
    return NextResponse.json({ calls: await takeCalls(userId, 25_000, request.signal) });
  } catch (error) {
    if (error instanceof ApiError) return apiErrorResponse(error);
    return NextResponse.json({ error: "Video Studio bridge failed." }, { status: 500 });
  }
}

/** One call's answer from the editor frame. Results are capped: review media is the largest. */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request, 24 * 1024 * 1024);
    const id = String(body.id ?? "");
    const known = completeCall(userId, id, typeof body.error === "string" ? { error: body.error.slice(0, 4000) } : { result: body.result });
    return NextResponse.json({ ok: known });
  } catch (error) {
    if (error instanceof ApiError) return apiErrorResponse(error);
    return NextResponse.json({ error: "Video Studio bridge failed." }, { status: 500 });
  }
}
