// The Postiz run: brief in, editable drafts out.
//
// One run drafts copy for every requested network, persists each draft, and
// emits each as a durable artifact. Calendar entries are opt-in: an ordinary
// run leaves every post off the calendar, while an explicit `--at` flag is
// treated as the user's scheduling instruction.
// Runs live in memory and stream NDJSON-shaped events to the inline chat UI,
// matching the OpenPlanter and Agent Browser run managers.
//
// The ordering matters and is deliberate: persist first, optional calendar, then
// artifact. Each later step is allowed to fail without losing the earlier one,
// because the post is the product and the rest is presentation.

import { randomUUID } from "node:crypto";

import {
  normalizeChatTokenUsage,
  sumChatTokenUsage,
  type ChatTokenUsage,
} from "../chat-token-usage.ts";
import { getCalendarStore } from "../calendar/instance.ts";
import { addDays, nowStamp } from "../calendar/wallclock.ts";
import {
  closeArtifactContext,
  createPostArtifact,
  createPostImageArtifact,
  openArtifactContext,
  syncPostArtifact,
  type ArtifactContext,
} from "./artifacts.ts";
import { draftPosts, type DraftedPost } from "./client.ts";
import { schedulePost } from "./calendar-bridge.ts";
import { getSocialsManagerStore } from "./instance.ts";
import { postImagePreviewUrl } from "./post-images.ts";
import {
  openPostizSession,
  publishToPostiz,
  syncPendingPosts,
  uploadPostImage,
  type PostizSession,
} from "./service.ts";
import { parseSocialsManagerRequest } from "./identity.ts";
import { agentSettingsFor } from "../agent-settings/store.ts";
import { socialsManagerDefaults } from "../agent-settings/defaults.ts";
import {
  findSocialsManagerProvider,
  OFFLINE_DRAFT_PROVIDER_IDS,
  type SocialsManagerProvider,
} from "./providers.ts";
import type { SocialsManagerPost } from "./types.ts";

export interface SocialsManagerEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

export type SocialsManagerRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "aborted";

interface RunState {
  runId: string;
  userId: number;
  brief: string;
  status: SocialsManagerRunStatus;
  sequence: number;
  events: SocialsManagerEvent[];
  controller: AbortController;
  postIds: number[];
  /** Start of the run's own clock, for the elapsed time reported with usage. */
  createdAt: number;
  /** Every model call this run has paid for: drafting, plus any artwork. */
  spent: ChatTokenUsage[];
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardSocialsManagerRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardSocialsManagerRuns ?? new Map<string, RunState>();
globalRuns.__breadboardSocialsManagerRuns = runs;

const MAX_EVENTS = 2_000;
const MAX_RUNS_RETAINED = 100;

function emit(
  run: RunState,
  type: string,
  payload: Record<string, unknown> = {},
): void {
  run.sequence += 1;
  run.events.push({
    sequenceNumber: run.sequence,
    type,
    payload,
    at: new Date().toISOString(),
  });
  if (run.events.length > MAX_EVENTS) {
    run.events.splice(0, run.events.length - MAX_EVENTS);
  }
}

/**
 * `abortRun` mutates `status` from another task, so TypeScript's narrowing after
 * an assignment inside `execute` would wrongly rule the aborted state out. The
 * indirection is what keeps the checks honest.
 */
function isAborted(run: RunState): boolean {
  return (run.status as SocialsManagerRunStatus) === "aborted";
}

/**
 * Token accounting for one model call. The running total is emitted as each
 * call lands so the card counts up during the run instead of only at the end.
 */
function recordUsage(run: RunState, usage: unknown): void {
  const normalized = normalizeChatTokenUsage(usage);
  if (!normalized) return;
  run.spent.push(normalized);
  emit(run, "run.usage", { ...sumChatTokenUsage(run.spent) });
}

function requireRun(userId: number, runId: string): RunState {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) throw new Error("run_not_found");
  return run;
}

function forget(): void {
  if (runs.size <= MAX_RUNS_RETAINED) return;
  const terminal = [...runs.entries()].filter(
    ([, run]) => run.status !== "running" && run.status !== "queued",
  );
  for (const [id] of terminal.slice(0, runs.size - MAX_RUNS_RETAINED)) {
    runs.delete(id);
  }
}

/** Postiz requires a date even for a remote draft. This fallback is metadata
 * only; it never creates a Breadboard calendar entry. */
function defaultSlot(index: number): string {
  const tomorrow = addDays(nowStamp(), 1).slice(0, 10);
  return shiftMinutes(`${tomorrow}T09:00`, index * 30);
}

function shiftMinutes(stamp: string, minutes: number): string {
  const [date, time] = stamp.split("T");
  const [hour, minute] = time.split(":").map(Number);
  const total = hour * 60 + minute + minutes;
  const dayOffset = Math.floor(total / (24 * 60));
  const within = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const shiftedDate = dayOffset ? addDays(`${date}T00:00`, dayOffset).slice(0, 10) : date;
  const hh = String(Math.floor(within / 60)).padStart(2, "0");
  const mm = String(within % 60).padStart(2, "0");
  return `${shiftedDate}T${hh}:${mm}`;
}

function presentPost(
  post: SocialsManagerPost,
  provider: SocialsManagerProvider | null,
  userId: number,
) {
  return {
    id: post.id,
    providerId: post.providerId,
    providerName: provider?.name ?? post.providerId,
    content: post.content,
    status: post.status,
    scheduledAt: post.scheduledAt,
    calendarEventId: post.calendarEventId,
    artifactId: post.artifactId,
    imageArtifactId: post.imageArtifactId,
    imagePreviewUrl: postImagePreviewUrl(userId, post.imageArtifactId),
    remoteId: post.remoteId,
    characterCount: post.content.length,
    characterLimit: provider?.maxCharacters ?? null,
  };
}

/** The post's artwork, uploaded to Postiz's media library, if it has any. */
async function mediaFor(
  session: PostizSession,
  userId: number,
  post: SocialsManagerPost,
) {
  if (!post.imageArtifactId) return null;
  return uploadPostImage(session, userId, post.imageArtifactId);
}

async function execute(
  run: RunState,
  input: { model: string; baseUrl: string; conversationPublicId: string | null },
): Promise<void> {
  // The user's default networks and artwork preference, with anything named in
  // the message taking precedence over both.
  const request = parseSocialsManagerRequest(
    run.brief,
    socialsManagerDefaults(agentSettingsFor(run.userId, "socials-manager")),
  );
  const availability = await openPostizSession();
  const connectedProviderIds = [
    ...new Set(
      availability.session?.integrations
        .filter((integration) => !integration.disabled)
        .map((integration) => integration.identifier.toLowerCase()) ?? [],
    ),
  ];
  const automaticProviderIds = connectedProviderIds.length
    ? connectedProviderIds
    : [...OFFLINE_DRAFT_PROVIDER_IDS];
  const selectedProviderIds = request.providerIds.length
    ? request.providerIds
    : automaticProviderIds;
  const providers = selectedProviderIds
    .map((id) => findSocialsManagerProvider(id))
    .filter((provider): provider is SocialsManagerProvider => provider !== null);

  if (!providers.length) {
    run.status = "failed";
    emit(run, "run.failed", {
      error: "No known social network was requested.",
    });
    return;
  }

  run.status = "running";
  emit(run, "run.started", {
    brief: request.brief,
    networks: providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      characterLimit: provider.maxCharacters,
    })),
    scheduleAt: request.scheduleAt,
  });
  emit(run, "stack.status", {
    state: availability.state,
    reason: availability.reason ?? null,
    connectedNetworks: connectedProviderIds,
    draftingLocally: connectedProviderIds.length === 0,
  });

  let drafts: DraftedPost[];
  try {
    emit(run, "drafting.started", { count: providers.length });
    drafts = await draftPosts({
      baseUrl: input.baseUrl,
      model: input.model,
      brief: request.brief,
      providers,
      scheduleAt: request.scheduleAt,
      signal: run.controller.signal,
      onUsage: (usage) => recordUsage(run, usage),
    });
  } catch (error) {
    if (isAborted(run)) return;
    run.status = "failed";
    emit(run, "run.failed", {
      error: error instanceof Error ? error.message : "drafting_failed",
    });
    return;
  }

  if (isAborted(run)) return;
  emit(run, "drafting.completed", { count: drafts.length });

  const store = getSocialsManagerStore();
  const stores = request.scheduleAt
    ? { socialsManager: store, calendar: getCalendarStore() }
    : null;

  if (availability.session) {
    const pushed = await syncPendingPosts(availability.session, store, run.userId);
    if (pushed > 0) emit(run, "stack.synced", { pushed });
  }
  const artifactContext: ArtifactContext | null = input.conversationPublicId
    ? openArtifactContext({
        userId: run.userId,
        conversationPublicId: input.conversationPublicId,
        brief: request.brief,
      })
    : null;

  const presented: ReturnType<typeof presentPost>[] = [];

  for (const [index, draft] of drafts.entries()) {
    if (isAborted(run)) break;
    const provider = findSocialsManagerProvider(draft.providerId);

    let post: SocialsManagerPost;
    try {
      post = store.createPost(run.userId, {
        providerId: draft.providerId,
        content: draft.content,
        runId: run.runId,
      });
    } catch (error) {
      emit(run, "post.failed", {
        providerId: draft.providerId,
        error: error instanceof Error ? error.message : "persist_failed",
      });
      continue;
    }
    run.postIds.push(post.id);
    emit(run, "post.drafted", { post: presentPost(post, provider, run.userId) });

    const remoteDate = request.scheduleAt ?? draft.scheduledAt ?? defaultSlot(index);

    // Artifact: the post as a durable, reusable product. It comes before the
    // hand-off to Postiz so any artwork can hang off it, and so the remote post
    // carries the image on its first write instead of needing a replacement.
    // Everything that lands after this — artwork, the Postiz id, the calendar
    // slot — is written back into it by the sync at the end of this iteration.
    if (artifactContext) {
      const artifact = await createPostArtifact(artifactContext, post);
      if (artifact) {
        post = store.updatePost(run.userId, post.id, { artifactId: artifact.id });
        emit(run, "post.artifact_ready", {
          postId: post.id,
          artifactId: artifact.id,
          title: artifact.title,
          kind: artifact.kind,
        });
      }

      if (request.withImages) {
        emit(run, "post.image_started", { postId: post.id });
        const image = await createPostImageArtifact(artifactContext, {
          baseUrl: input.baseUrl,
          providerId: draft.providerId,
          content: draft.content,
          parentArtifactId: artifact?.id ?? null,
          onUsage: (usage) => recordUsage(run, usage),
        });
        if (image) {
          post = store.updatePost(run.userId, post.id, { imageArtifactId: image.id });
          emit(run, "post.image_ready", {
            postId: post.id,
            imageArtifactId: image.id,
            imagePreviewUrl: postImagePreviewUrl(run.userId, image.id),
          });
        } else {
          emit(run, "post.image_failed", { postId: post.id });
        }
      }
    }

    // Postiz owns the post whenever the stack is up and the network is
    // connected there. Failing that, the local row stands and a later run
    // pushes it — so this never costs the user the draft.
    if (availability.session) {
      const media = await mediaFor(availability.session, run.userId, post);
      const outcome = await publishToPostiz(availability.session, {
        providerId: draft.providerId,
        content: draft.content,
        scheduledAt: remoteDate,
        type: request.scheduleAt ? "schedule" : "draft",
        ...(media ? { image: [media] } : {}),
      });
      if (outcome.remoteId) {
        post = store.updatePost(run.userId, post.id, { remoteId: outcome.remoteId });
        emit(run, "post.published_to_stack", {
          postId: post.id,
          remoteId: outcome.remoteId,
        });
      } else if (outcome.reason) {
        emit(run, "post.stack_skipped", { postId: post.id, reason: outcome.reason });
      }
    }

    // Calendar entries are never inferred from the model or invented defaults.
    // Only the user's explicit `--at` instruction schedules during generation;
    // otherwise the inline card owns the opt-in action.
    if (request.scheduleAt && stores) {
      try {
        post = schedulePost(stores, run.userId, post.id, request.scheduleAt);
        emit(run, "post.scheduled", {
          postId: post.id,
          scheduledAt: post.scheduledAt,
          calendarEventId: post.calendarEventId,
        });
      } catch (error) {
        emit(run, "post.schedule_failed", {
          postId: post.id,
          error: error instanceof Error ? error.message : "schedule_failed",
        });
      }
    }

    // The artifact was written before the artwork, the hand-off to Postiz and
    // the calendar slot; it is the post, so it ends the run holding all three.
    if (post.artifactId) await syncPostArtifact(run.userId, post);

    presented.push(presentPost(post, provider, run.userId));
  }

  if (isAborted(run)) {
    closeArtifactContext(artifactContext, "aborted");
    return;
  }

  run.status = presented.length ? "completed" : "failed";
  closeArtifactContext(artifactContext, run.status === "completed" ? "completed" : "failed");

  if (run.status === "completed") {
    const elapsedMs = Date.now() - run.createdAt;
    emit(run, "run.completed", {
      posts: presented,
      summary: `Drafted ${presented.length} post${presented.length === 1 ? "" : "s"}.`,
      usage: { ...sumChatTokenUsage(run.spent), responseDurationMs: elapsedMs },
    });
  } else {
    emit(run, "run.failed", { error: "No post could be saved." });
  }
}

export function startRun(input: {
  userId: number;
  brief: string;
  model: string;
  baseUrl: string;
  conversationPublicId?: string | null;
}): { runId: string; status: SocialsManagerRunStatus } {
  const runId = `pzrun_${randomUUID().replaceAll("-", "")}`;
  const run: RunState = {
    runId,
    userId: input.userId,
    brief: input.brief,
    status: "queued",
    sequence: 0,
    events: [],
    controller: new AbortController(),
    postIds: [],
    createdAt: Date.now(),
    spent: [],
  };
  runs.set(runId, run);
  forget();

  void execute(run, {
    model: input.model,
    baseUrl: input.baseUrl,
    conversationPublicId: input.conversationPublicId ?? null,
  }).catch((error: unknown) => {
    if (isAborted(run)) return;
    run.status = "failed";
    emit(run, "run.failed", {
      error: error instanceof Error ? error.message : "run_error",
    });
  });

  return { runId, status: "queued" };
}

export function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): SocialsManagerEvent[] {
  return requireRun(userId, runId).events.filter(
    (event) => event.sequenceNumber > since,
  );
}

export function isTerminal(userId: number, runId: string): boolean {
  return ["completed", "failed", "aborted"].includes(
    requireRun(userId, runId).status,
  );
}

export function abortRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (["completed", "failed", "aborted"].includes(run.status)) return false;
  run.status = "aborted";
  run.controller.abort();
  emit(run, "run.aborted", { summary: "Postiz drafting stopped." });
  return true;
}
