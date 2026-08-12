// Turning drafted posts into durable Breadboard artifacts.
//
// A social post is a reusable product, so it belongs in the artifact store —
// the same place documents and visualizations land — rather than only in the
// chat transcript. That store is scoped to a runtime run, so a drafting run opens
// a short-lived `hermes_runs` row to own the artifacts it produces.
//
// The artifact carries the post itself (see ./post-artifact.ts), not a rendering
// of its copy, so opening one opens the post studio. That makes the artifact a
// second view of a living row rather than a snapshot of a moment, which is what
// `syncPostArtifact` is for: every write to a post rewrites its artifact.
//
// Artifacts are best-effort by design: a chat without a runtime session (a drafting
// run dispatched before the runtime attached) still produces posts on the
// calendar. Losing the artifact must never lose the post.

import {
  createArtifact,
  getArtifactById,
  readArtifactSource,
  renderArtifact,
  updateArtifactContent,
  type ArtifactRow,
} from "../hermes/artifact-store.ts";
import {
  generateArtifactImage,
  importArtifactImage,
} from "../hermes/artifact-image-service.ts";
import { beginRuntimeRun, finishRuntimeRun } from "../hermes/run-store.ts";
import {
  getRuntimeSessionByConversation,
  runtimeExternalSessionId,
} from "../hermes/runtime-store.ts";
import { getConversationForUser } from "../conversations/store.ts";
import { findSocialsManagerProvider } from "./providers.ts";
import {
  socialsPostArtifactMetadata,
  socialsPostArtifactTitle,
  socialsPostDocument,
  SOCIALS_MANAGER_POST_RENDERER,
  SOCIALS_MANAGER_POST_TOOL,
} from "./post-artifact.ts";
import type { SocialsManagerPost } from "./types.ts";

export interface ArtifactContext {
  userId: number;
  conversationPublicId: string;
  runtimeSessionId: number;
  hermesSessionId: string;
  conversationId: number;
  clusterId: number | null;
  surface: "dashboard_terminal" | "garden_chat";
  /** The hermes_runs row the artifacts hang off. */
  runId: string;
}

/**
 * Resolve everything the artifact store needs from the conversation the run was
 * dispatched in, and open a run to own the artifacts. Returns null when the
 * conversation has no runtime session yet — the caller then skips artifacts.
 */
export function openArtifactContext(input: {
  userId: number;
  conversationPublicId: string;
  brief: string;
}): ArtifactContext | null {
  try {
    const conversation = getConversationForUser(input.conversationPublicId, input.userId);
    if (
      conversation.surface !== "dashboard_terminal" &&
      conversation.surface !== "garden_chat"
    ) {
      return null;
    }

    const session = getRuntimeSessionByConversation(conversation.id);
    if (!session) return null;
    const hermesSessionId = runtimeExternalSessionId(session);
    if (!hermesSessionId) return null;

    const run = beginRuntimeRun({
      runtimeSessionId: session.id,
      instruction: input.brief.slice(0, 4_000),
      dispatch: {
        conversationPublicId: input.conversationPublicId,
        runtimeText: input.brief.slice(0, 4_000),
      },
    });

    return {
      userId: input.userId,
      conversationPublicId: input.conversationPublicId,
      runtimeSessionId: session.id,
      hermesSessionId,
      conversationId: conversation.id,
      clusterId:
        conversation.surface === "garden_chat" ? conversation.default_garden_id : null,
      surface: conversation.surface,
      runId: run.id,
    };
  } catch {
    return null;
  }
}

export function closeArtifactContext(
  context: ArtifactContext | null,
  status: "completed" | "failed" | "aborted",
): void {
  if (!context) return;
  try {
    finishRuntimeRun(
      context.runId,
      status === "completed" ? "completed" : status === "aborted" ? "cancelled" : "error",
    );
  } catch {
    // A run that was already closed is not an error worth surfacing.
  }
}

/**
 * One artifact per drafted post, carrying the post rather than a rendering of
 * its copy. The network's editor is recorded in the document instead of picking
 * a text renderer from it: a Telegram post is an HTML fragment and a Dev.to post
 * is Markdown, but both are posts, and the studio is what edits either.
 */
export async function createPostArtifact(
  context: ArtifactContext,
  post: SocialsManagerPost,
): Promise<ArtifactRow | null> {
  const provider = findSocialsManagerProvider(post.providerId);
  if (!provider) return null;

  const document = socialsPostDocument(post);
  try {
    const artifact = createArtifact({
      userId: context.userId,
      runtimeSessionId: context.runtimeSessionId,
      hermesSessionId: context.hermesSessionId,
      conversationId: context.conversationId,
      clusterId: context.clusterId,
      runId: context.runId,
      assistantMessageId: null,
      surface: context.surface,
      kind: "data",
      rendererId: SOCIALS_MANAGER_POST_RENDERER,
      title: socialsPostArtifactTitle(document),
      filename: `${provider.id}-post.json`,
      content: `${JSON.stringify(document, null, 2)}\n`,
      metadata: socialsPostArtifactMetadata(document),
      sourceHermesTool: SOCIALS_MANAGER_POST_TOOL,
    });

    return await renderArtifact({
      artifact,
      runId: context.runId,
      assistantMessageId: null,
    });
  } catch {
    // The post itself is already persisted; an artifact failure is not fatal.
    return null;
  }
}

/**
 * Rewrite a post's artifact from the post as it now stands.
 *
 * Called after every write to a post — the run's own later steps (artwork, the
 * Postiz id, the calendar slot) as much as an edit in the studio — because the
 * artifact is a view of the post, and a view that lags is worse than no view:
 * it is the copy the user would send if they opened the artifact instead of the
 * card.
 *
 * Never throws, and never touches an artifact it did not write: posts drafted
 * before this renderer existed are .txt and .md documents, and rewriting one
 * with JSON would leave a text artifact that no longer reads as text.
 */
export async function syncPostArtifact(
  userId: number,
  post: SocialsManagerPost,
): Promise<ArtifactRow | null> {
  if (!post.artifactId) return null;
  try {
    const artifact = getArtifactById(post.artifactId);
    if (!artifact || artifact.user_id !== userId) return null;
    if (artifact.renderer_id !== SOCIALS_MANAGER_POST_RENDERER) return null;
    if (artifact.status === "archived") return null;

    const document = socialsPostDocument(post);
    const content = `${JSON.stringify(document, null, 2)}\n`;
    // A write that changed nothing this document carries — a republished remote
    // id, a status the document already had — must not fork a new version.
    if (readArtifactSource(artifact) === content) return artifact;

    const updated = updateArtifactContent({
      artifact,
      content,
      mode: "replace",
      runId: artifact.originating_run_id,
      assistantMessageId: artifact.originating_message_id,
      metadata: socialsPostArtifactMetadata(document),
    });
    return await renderArtifact({
      artifact: updated,
      runId: artifact.originating_run_id,
      assistantMessageId: artifact.originating_message_id,
    });
  } catch {
    // The post is the product; an artifact that could not follow it is not
    // worth failing the edit that succeeded.
    return null;
  }
}

/**
 * The prompt the image studio and the `--image` run both start from, so artwork
 * asked for during a run and artwork asked for afterwards read the same way.
 */
export function postImagePrompt(input: {
  networkName: string;
  caption: string;
}): string {
  const caption = input.caption.trim();
  return (
    `Create a polished image to accompany this ${input.networkName} post. ` +
    "Match its mood and message, use a strong social-media composition, and do not place the full caption in the image." +
    (caption ? `\n\nPost copy:\n${caption}` : "")
  ).slice(0, 4_000);
}

/**
 * Draw the artwork for one post and store it as an image artifact hanging off
 * the post's copy. Returns null on any failure — a run that could not draw a
 * picture still delivers the post.
 */
export async function createPostImageArtifact(
  context: ArtifactContext,
  input: {
    baseUrl: string;
    providerId: string;
    content: string;
    parentArtifactId: string | null;
    /** Drawing spends tokens too, so the run counts them with the drafting. */
    onUsage?: (usage: unknown) => void;
  },
): Promise<ArtifactRow | null> {
  const provider = findSocialsManagerProvider(input.providerId);
  const networkName = provider?.name ?? input.providerId;
  try {
    const generated = await generateArtifactImage({
      baseURL: input.baseUrl,
      prompt: postImagePrompt({ networkName, caption: input.content }),
    });
    if (generated.usage) input.onUsage?.(generated.usage);
    return importArtifactImage({
      context,
      buffer: generated.buffer,
      title: `${networkName} image`,
      filename: `${provider?.id ?? "post"}-image.png`,
      parentArtifactId: input.parentArtifactId,
      sourceTool: "artifact_image_generate",
      metadata: {
        imageStudio: true,
        imageOperation: "generate",
        socialsManagerNetwork: provider?.id ?? input.providerId,
        socialsManagerNetworkName: networkName,
        ...(generated.providerItemId ? { providerItemId: generated.providerItemId } : {}),
      },
    });
  } catch {
    return null;
  }
}
