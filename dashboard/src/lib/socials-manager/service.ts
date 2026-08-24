// Deciding, per run, whether the real Postiz stack can own the posts.
//
// The contract with the user is that typing the command never blocks on Docker:
// Breadboard starts the stack in the background and, if it is not ready inside
// the run's budget, drafts locally instead. A local draft is not a dead end —
// `syncPendingPosts` pushes it into Postiz once the stack answers.

import { resolveSocialsManagerConfig, type SocialsManagerConfig } from "./config.ts";
import { ensureApiKey } from "./bootstrap.ts";
import {
  PostizApiClient,
  type PostizIntegration,
  type PostizMedia,
  isoToWallClock,
} from "./api-client.ts";
import { readPostImage } from "./post-images.ts";
import { activateStack, releaseActivation, type ActivationOutcome } from "./activation.ts";
import type { ActivationReason } from "./coordinator-core.ts";
import { reachable, type StackStatus } from "./stack.ts";
import type { SocialsManagerStore } from "./store.ts";
import type { SocialsManagerPost } from "./types.ts";

export interface PostizSession {
  client: PostizApiClient;
  integrations: PostizIntegration[];
  config: SocialsManagerConfig;
}

export interface PostizAvailability {
  session: PostizSession | null;
  /** Why the real stack is not in play, for the run to report honestly. */
  reason?: string;
  state: StackStatus["state"] | "unauthenticated" | "adapter" | "disabled";
  /**
   * A hold on the stack, when one was requested. Release it once the operation
   * that needed Postiz is finished, or idle shutdown will never fire.
   */
  leaseId?: string;
}

export interface OpenSessionInput {
  /** Why Postiz is wanted. A closed category; it is logged, never executed. */
  reason?: ActivationReason;
  /** Pin the stack until `closePostizSession` releases it. */
  hold?: boolean;
  /** The caller's next scheduled publish, so idle shutdown can see it. */
  nextScheduledAt?: string | null;
}

/**
 * Try to get a usable Postiz session. Kicks off the stack when it is down and
 * waits only for the configured budget, so a cold Docker start degrades to
 * local drafting rather than a long stall.
 */
export async function openPostizSession(
  input: OpenSessionInput = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<PostizAvailability> {
  const config = resolveSocialsManagerConfig(env);
  if (config.mode === "disabled") return { session: null, state: "disabled" };
  if (config.mode === "adapter") {
    return { session: null, state: "adapter", reason: "Local drafting mode." };
  }

  let outcome: ActivationOutcome | null = null;
  if (!(await reachable(config))) {
    // This is the activation seam: the lifecycle owner starts Docker and the
    // containers, and this caller waits only for the run's own budget. When the
    // budget runs out the activation keeps going in the coordinator, so the
    // next run finds it healthy and `syncPendingPosts` pushes today's drafts.
    outcome = await activateStack(
      config,
      {
        reason: input.reason ?? "run",
        timeoutMs: config.readyTimeoutMs,
        ...(input.hold ? { hold: true } : {}),
        ...(input.nextScheduledAt ? { nextScheduledAt: input.nextScheduledAt } : {}),
      },
      env,
    );
    if (!outcome.ready) {
      return {
        session: null,
        state: outcome.state === "starting" ? "starting" : "stopped",
        reason: outcome.reason ?? "Postiz is still starting; drafting locally for now.",
      };
    }
  } else if (input.hold) {
    // Already up, but this operation still wants a hold so idle shutdown does
    // not pull the stack out from under it mid-run.
    outcome = await activateStack(
      config,
      {
        reason: input.reason ?? "run",
        timeoutMs: config.readyTimeoutMs,
        hold: true,
        ...(input.nextScheduledAt ? { nextScheduledAt: input.nextScheduledAt } : {}),
      },
      env,
    );
  }
  const lease = outcome?.leaseId ? { leaseId: outcome.leaseId } : {};

  const apiKey = await ensureApiKey(config);
  if (!apiKey) {
    await releaseActivation(outcome?.leaseId, env);
    return {
      session: null,
      state: "unauthenticated",
      reason: "Postiz is running but Breadboard could not obtain an API key.",
    };
  }

  const client = new PostizApiClient(config, apiKey);
  let integrations: PostizIntegration[];
  try {
    integrations = await client.listIntegrations();
  } catch {
    await releaseActivation(outcome?.leaseId, env);
    return {
      session: null,
      state: "unauthenticated",
      reason: "Postiz rejected Breadboard's API key.",
    };
  }
  return { session: { client, integrations, config }, state: "running", ...lease };
}

/**
 * Release whatever `openPostizSession` took out. Safe to call with an
 * availability that never held anything, which is what makes it usable from a
 * plain `finally`.
 */
export async function closePostizSession(
  availability: Pick<PostizAvailability, "leaseId">,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await releaseActivation(availability.leaseId, env);
}

/**
 * A session only if Postiz is already up. Used by interactive edits — attaching
 * an image to a post must not block on a cold Docker start, and the next run's
 * `syncPendingPosts` picks up anything this skips.
 */
export async function openPostizSessionIfRunning(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PostizSession | null> {
  const config = resolveSocialsManagerConfig(env);
  if (config.mode !== "stack") return null;
  if (!(await reachable(config))) return null;

  const apiKey = await ensureApiKey(config);
  if (!apiKey) return null;
  const client = new PostizApiClient(config, apiKey);
  try {
    return { client, integrations: await client.listIntegrations(), config };
  } catch {
    return null;
  }
}

/** The Postiz channel to publish a given network's copy through, if connected. */
export function integrationFor(
  session: PostizSession,
  providerId: string,
): PostizIntegration | null {
  return (
    session.integrations.find(
      (integration) =>
        !integration.disabled &&
        integration.identifier.toLowerCase() === providerId.toLowerCase(),
    ) ?? null
  );
}

export interface PublishOutcome {
  remoteId: string | null;
  /** Set when Postiz could not take the post; the local draft still stands. */
  reason?: string;
}

/**
 * Push a Breadboard image artifact into Postiz's media library.
 *
 * Best-effort by the same rule as everything else here: copy that Postiz
 * accepted without its artwork still beats copy Postiz refused.
 */
export async function uploadPostImage(
  session: PostizSession,
  userId: number,
  imageArtifactId: string | null,
): Promise<PostizMedia | null> {
  const image = readPostImage(userId, imageArtifactId);
  if (!image) return null;
  try {
    return await session.client.uploadMedia({
      buffer: image.buffer,
      filename: image.filename,
      mimeType: image.mimeType,
    });
  } catch {
    return null;
  }
}

/**
 * Hand one drafted post to Postiz. A network with no connected channel is the
 * common case on a fresh install and is reported, not thrown.
 */
export async function publishToPostiz(
  session: PostizSession,
  input: {
    providerId: string;
    content: string;
    scheduledAt: string;
    type?: "draft" | "schedule";
    image?: PostizMedia[];
  },
): Promise<PublishOutcome> {
  const integration = integrationFor(session, input.providerId);
  if (!integration) {
    return {
      remoteId: null,
      reason: `No ${input.providerId} channel is connected in Postiz.`,
    };
  }
  try {
    const created = await session.client.createPost({
      integrationId: integration.id,
      content: input.content,
      scheduledAt: input.scheduledAt,
      type: input.type,
      ...(input.image?.length ? { image: input.image } : {}),
    });
    const record = created as Record<string, unknown>;
    const id =
      typeof record.id === "string"
        ? record.id
        : typeof record.postId === "string"
          ? record.postId
          : null;
    return { remoteId: id };
  } catch (error) {
    return {
      remoteId: null,
      reason: error instanceof Error ? error.message : "Postiz rejected the post.",
    };
  }
}

/**
 * Push drafts that were made while the stack was down. Called when a later run
 * finds Postiz healthy, so nothing drafted offline is stranded.
 */
export async function syncPendingPosts(
  session: PostizSession,
  store: SocialsManagerStore,
  userId: number,
): Promise<number> {
  const pending = store
    .listPosts(userId)
    .filter(
      (post) =>
        post.remoteId === null &&
        post.scheduledAt !== null &&
        (post.status === "scheduled" || post.status === "draft"),
    );

  let pushed = 0;
  for (const post of pending) {
    const media = await uploadPostImage(session, userId, post.imageArtifactId);
    const outcome = await publishToPostiz(session, {
      providerId: post.providerId,
      content: post.content,
      scheduledAt: post.scheduledAt!,
      ...(media ? { image: [media] } : {}),
    });
    if (outcome.remoteId) {
      store.updatePost(userId, post.id, { remoteId: outcome.remoteId });
      pushed += 1;
    }
  }
  return pushed;
}

/**
 * Re-send a post that Postiz already owns so its artwork travels with it.
 *
 * Postiz's public API has no "edit the media on this post" route, so the
 * honest move is to replace the remote post: create the new one first, and only
 * then drop the old, so a failure mid-way leaves the user with a post rather
 * than a hole. A post Postiz does not own yet needs nothing here — the ordinary
 * publish path already reads the image.
 */
export async function republishWithImage(
  session: PostizSession,
  store: SocialsManagerStore,
  userId: number,
  post: SocialsManagerPost,
): Promise<PublishOutcome> {
  if (!post.remoteId) return { remoteId: null, reason: "not_published_yet" };
  const media = await uploadPostImage(session, userId, post.imageArtifactId);
  if (post.imageArtifactId && !media) {
    return { remoteId: post.remoteId, reason: "Postiz would not accept the image." };
  }

  const outcome = await publishToPostiz(session, {
    providerId: post.providerId,
    content: post.content,
    scheduledAt: post.scheduledAt ?? nowScheduleFallback(),
    type: post.status === "scheduled" ? "schedule" : "draft",
    ...(media ? { image: [media] } : {}),
  });
  if (!outcome.remoteId) return outcome;

  try {
    await session.client.deletePost(post.remoteId);
  } catch {
    // The replacement is live; a stale sibling is better than losing the post.
  }
  store.updatePost(userId, post.id, { remoteId: outcome.remoteId });
  return outcome;
}

/** Postiz requires a date even on a draft; this one never reaches the calendar. */
function nowScheduleFallback(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}`
  );
}

/** Postiz's own schedule for a post, as a wall-clock stamp. */
export function remoteScheduleOf(publishDate: string): string | null {
  return isoToWallClock(publishDate);
}
