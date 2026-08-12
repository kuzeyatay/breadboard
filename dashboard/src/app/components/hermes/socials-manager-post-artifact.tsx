"use client";

// What a social post artifact opens as.
//
// A post is not finished when it is drafted — the copy gets tightened, the
// picture gets chosen, the slot gets moved — so opening one puts the post studio
// on screen rather than the text of the caption. The artifact and the card that
// drafted it are the same editor over the same post.
//
// The artifact carries a snapshot of the post; the post's row is what the studio
// edits. So this fetches the live post by the id the snapshot names, and falls
// back to the snapshot only when that post is gone — a deleted post still opens
// as what it said, where it was going and when, just with nothing left to save.

import { useCallback, useEffect, useState } from "react";
import SocialsManagerPostStudio, {
  formatPostSlot,
  type SocialsManagerStudioPatch,
  type SocialsManagerStudioPost,
} from "./socials-manager-post-studio";
import type { PresentedArtifact } from "@/lib/hermes/artifact-types";
import type { SocialsPostDocument } from "@/lib/socials-manager/post-artifact";
import type { PresentedSocialsManagerPost } from "@/lib/socials-manager/types";

interface Props {
  /** The post as the artifact stored it. */
  stored: SocialsPostDocument;
  /** The artifact itself, which is where new artwork is filed. */
  artifact: PresentedArtifact;
}

type LivePost =
  | { status: "loading" }
  | { status: "ready"; post: SocialsManagerStudioPost }
  | { status: "gone" }
  | { status: "error"; message: string };

function studioPost(
  post: PresentedSocialsManagerPost,
  artifactId: string,
): SocialsManagerStudioPost {
  return {
    id: post.id,
    providerName: post.providerName,
    content: post.content,
    scheduledAt: post.scheduledAt,
    calendarEventId: post.calendarEventId,
    artifactId: post.artifactId ?? artifactId,
    imageArtifactId: post.imageArtifactId,
    imagePreviewUrl: post.imagePreviewUrl,
    remoteId: post.remoteId,
    characterLimit: post.characterLimit,
  };
}

export default function SocialsManagerPostArtifact({ stored, artifact }: Props) {
  const [live, setLive] = useState<LivePost>({ status: "loading" });
  // Every save re-seeds the editor from the post the server wrote, so what is on
  // screen after a save is what was actually stored — not what was typed.
  const [generation, setGeneration] = useState(0);
  const postId = stored.postId;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (postId === null) {
        setLive({ status: "gone" });
        return;
      }
      try {
        const response = await fetch(
          `/api/socials-manager/posts/${encodeURIComponent(String(postId))}`,
          { cache: "no-store", ...(signal ? { signal } : {}) },
        );
        if (response.status === 404) {
          setLive({ status: "gone" });
          return;
        }
        const body = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          post?: PresentedSocialsManagerPost;
          error?: string;
        };
        if (!response.ok || !body.ok || !body.post) {
          throw new Error(body.error ?? "This post could not be opened.");
        }
        setLive({ status: "ready", post: studioPost(body.post, artifact.id) });
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setLive({
          status: "error",
          message: cause instanceof Error ? cause.message : "This post could not be opened.",
        });
      }
    },
    [artifact.id, postId],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLive({ status: "loading" });
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function save(post: SocialsManagerStudioPost, patch: SocialsManagerStudioPatch) {
    const response = await fetch(
      `/api/socials-manager/posts/${encodeURIComponent(String(post.id))}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      post?: PresentedSocialsManagerPost;
      error?: string;
    };
    if (!response.ok || !body.ok || !body.post) return false;
    setLive({ status: "ready", post: studioPost(body.post, artifact.id) });
    setGeneration((current) => current + 1);
    return true;
  }

  if (live.status === "loading") {
    return <p className="text-sm text-[var(--ink-muted)]">Opening the post…</p>;
  }

  if (live.status === "error") {
    return (
      <div className="space-y-3">
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {live.message}
        </p>
        <button
          type="button"
          className="neu-button rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] px-3 py-2 text-xs font-medium text-[var(--ink-heading)]"
          onClick={() => void load()}
        >
          Try again
        </button>
      </div>
    );
  }

  if (live.status === "gone") {
    return <StoredPost stored={stored} />;
  }

  return (
    <SocialsManagerPostStudio
      key={generation}
      post={live.post}
      variant="inline"
      conversationId={artifact.conversationId || null}
      gardenSlug={artifact.gardenId}
      sourceSurface={artifact.gardenId ? "garden_chat" : "dashboard_terminal"}
      formatSlot={formatPostSlot}
      onSave={(patch) => save(live.post, patch)}
    />
  );
}

/**
 * The post as the artifact kept it, for a post that is no longer in the Socials
 * Manager. Read-only on purpose: there is no row left to write to, and an editor
 * whose Save could not work would be a worse answer than plainly saying so.
 */
function StoredPost({ stored }: { stored: SocialsPostDocument }) {
  return (
    <div className="mx-auto w-full max-w-xl space-y-3">
      <p className="rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] px-3 py-2 text-xs text-[var(--ink-muted)]">
        This post is no longer in your Socials Manager, so it is shown as the
        artifact kept it.
      </p>
      <article className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)]">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
          <span className="text-sm font-medium text-[var(--ink-heading)]">
            {stored.providerName}
          </span>
          <span className="text-xs text-[var(--ink-muted)]">
            {stored.scheduledAt ? formatPostSlot(stored.scheduledAt) : "Draft"}
          </span>
        </div>
        <p className="whitespace-pre-wrap break-words px-4 py-3 text-[13px] leading-[1.618] text-[var(--ink)]">
          {stored.content}
        </p>
        <p className="border-t border-[var(--line)] px-4 py-2.5 text-xs tabular-nums text-[var(--ink-muted)]">
          {stored.content.length}
          {stored.characterLimit === null ? "" : ` / ${stored.characterLimit}`}
        </p>
      </article>
    </div>
  );
}
