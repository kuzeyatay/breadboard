import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { getSocialsManagerStore } from "@/lib/socials-manager/instance.ts";
import { getCalendarStore } from "@/lib/calendar/instance.ts";
import {
  deletePostWithEvent,
  schedulePost,
  unschedulePost,
} from "@/lib/socials-manager/calendar-bridge.ts";
import { SocialsManagerError } from "@/lib/socials-manager/store.ts";
import {
  presentSocialsManagerPost,
  readPostImage,
} from "@/lib/socials-manager/post-images.ts";
import {
  openPostizSessionIfRunning,
  republishWithImage,
} from "@/lib/socials-manager/service.ts";
import { syncPostArtifact } from "@/lib/socials-manager/artifacts.ts";
import type { SocialsManagerPost } from "@/lib/socials-manager/types.ts";

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

function requirePostId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new SocialsManagerError(400, "That post id is not valid.");
  }
  return id;
}

/**
 * `null` detaches; a string must name a ready image artifact this user owns, so
 * a post can never point at someone else's file or at a document.
 */
function requireImageArtifactId(value: unknown, userId: number): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 200) {
    throw new SocialsManagerError(400, "That image reference is not valid.");
  }
  if (!readPostImage(userId, value)) {
    throw new SocialsManagerError(404, "That image is not available to attach.");
  }
  return value;
}

/**
 * Mirror a newly attached image into the real Postiz stack, but only when it is
 * already running. Starting Docker to satisfy a UI edit would stall the request
 * for as long as a cold boot takes; a skipped post keeps its local image and is
 * pushed with it by the next run's `syncPendingPosts`.
 */
async function mirrorImageToStack(userId: number, post: SocialsManagerPost): Promise<void> {
  if (!post.remoteId) return;
  try {
    const session = await openPostizSessionIfRunning({ userId });
    if (!session) return;
    await republishWithImage(session, getSocialsManagerStore(), userId, post);
  } catch {
    // The local post is the product; the remote copy catches up on the next run.
  }
}

/**
 * One post, by id. The post artifact's viewer is the studio, so opening an
 * artifact has to reach the live row behind it: the document the artifact
 * carries is a snapshot, and editing a snapshot would silently undo whatever
 * changed since it was written.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ postId: string }> },
) {
  try {
    const userId = await requireUserId();
    const postId = requirePostId((await params).postId);
    const post = getSocialsManagerStore().getPost(userId, postId);
    return NextResponse.json({ ok: true, post: presentSocialsManagerPost(userId, post) });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ postId: string }> },
) {
  try {
    const userId = await requireUserId();
    const postId = requirePostId((await params).postId);
    const text = await request.text();
    if (text.length > 512 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};

    const store = getSocialsManagerStore();
    const stores = { socialsManager: store, calendar: getCalendarStore() };

    let post = store.getPost(userId, postId);
    let imageChanged = false;

    if (typeof body.content === "string") {
      post = store.updatePost(userId, postId, { content: body.content });
    }

    if ("imageArtifactId" in body) {
      const imageArtifactId = requireImageArtifactId(body.imageArtifactId, userId);
      imageChanged = imageArtifactId !== post.imageArtifactId;
      post = store.updatePost(userId, postId, { imageArtifactId });
    }

    // A schedule change is a calendar change: `null` unschedules and removes the
    // event, a stamp creates or moves it.
    if ("scheduledAt" in body) {
      post =
        body.scheduledAt === null || body.scheduledAt === ""
          ? unschedulePost(stores, userId, postId)
          : typeof body.scheduledAt === "string"
            ? schedulePost(stores, userId, postId, body.scheduledAt)
            : post;
    }

    // Re-title the calendar event when the copy changed but the slot did not.
    if (typeof body.content === "string" && !("scheduledAt" in body) && post.scheduledAt) {
      post = schedulePost(stores, userId, postId, post.scheduledAt);
    }

    if (imageChanged) {
      await mirrorImageToStack(userId, post);
      post = store.getPost(userId, postId);
    }

    // The artifact is a view of this post, so it follows every edit — including
    // an edit made from inside the artifact itself.
    await syncPostArtifact(userId, post);

    return NextResponse.json({ ok: true, post: presentSocialsManagerPost(userId, post) });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ postId: string }> },
) {
  try {
    const userId = await requireUserId();
    const postId = requirePostId((await params).postId);
    deletePostWithEvent(
      { socialsManager: getSocialsManagerStore(), calendar: getCalendarStore() },
      userId,
      postId,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
