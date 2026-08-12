import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { listAttachablePostImages } from "@/lib/socials-manager/post-images.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The pictures a post can carry.
 *
 * This is the archive as the post studio sees it: the user's own ready images,
 * newest first, each already proven attachable. It is deliberately not the
 * conversation-scoped `/api/hermes/artifacts` listing — a post is rarely
 * written in the chat that happens to hold the artwork the user wants on it.
 */
export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ images: listAttachablePostImages(userId) });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
