import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { getSocialsManagerStore } from "@/lib/socials-manager/instance.ts";
import { getCalendarStore } from "@/lib/calendar/instance.ts";
import { schedulePost } from "@/lib/socials-manager/calendar-bridge.ts";
import { SocialsManagerError } from "@/lib/socials-manager/store.ts";
import { presentSocialsManagerPost } from "@/lib/socials-manager/post-images.ts";
import { SOCIALS_MANAGER_PROVIDERS } from "@/lib/socials-manager/providers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function failure(error: unknown) {
  if (error instanceof RouteError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  if (error instanceof SocialsManagerError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const runId = new URL(request.url).searchParams.get("runId");
    const store = getSocialsManagerStore();
    const posts = (
      runId ? store.listPostsByRun(userId, runId) : store.listPosts(userId)
    ).map((post) => presentSocialsManagerPost(userId, post));
    return NextResponse.json({ ok: true, posts, networks: SOCIALS_MANAGER_PROVIDERS });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    if (text.length > 512 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};

    const store = getSocialsManagerStore();
    const post = store.createPost(userId, {
      providerId: typeof body.providerId === "string" ? body.providerId : "",
      content: typeof body.content === "string" ? body.content : "",
      channelId: typeof body.channelId === "number" ? body.channelId : null,
    });

    // Scheduling goes through the bridge so the post lands on the calendar
    // rather than only carrying a timestamp of its own.
    const scheduledAt = typeof body.scheduledAt === "string" ? body.scheduledAt : null;
    const finished = scheduledAt
      ? schedulePost(
          { socialsManager: store, calendar: getCalendarStore() },
          userId,
          post.id,
          scheduledAt,
        )
      : post;

    return NextResponse.json(
      { ok: true, post: presentSocialsManagerPost(userId, finished) },
      { status: 201 },
    );
  } catch (error) {
    return failure(error);
  }
}
