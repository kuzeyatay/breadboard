// A social post as a durable artifact document.
//
// A post is not prose in a file. It is copy written for one network, against
// that network's character ceiling, usually with a picture, and often with a
// slot on the calendar. Stored as a .txt none of that survived: the artifact
// opened as a wall of text, the picture was a separate file with no visible
// relationship to it, and the studio that actually edits a post was reachable
// only from the run card that drafted it. So a post is stored as itself — the
// same way a ViMax film stores its production — and its viewer is the studio.
//
// The post's row in SQLite stays the source of truth for editing; this document
// is the snapshot the artifact keeps, rewritten by `syncPostArtifact` whenever
// the post changes. A post deleted from the Socials Manager therefore still
// opens from the archive: what it said, where it was going, and when.

import { z } from "zod";
import { findSocialsManagerProvider } from "./providers.ts";
import type { SocialsManagerPost } from "./types.ts";

export const SOCIALS_MANAGER_POST_RENDERER = "socials-manager-post";
export const SOCIALS_MANAGER_POST_TOOL = "socials_manager_draft";
export const SOCIALS_MANAGER_POST_SCHEMA_VERSION = 1;

export const socialsPostDocumentSchema = z.object({
  schemaVersion: z.number().int().positive(),
  /**
   * The post this document was written from. Null once the post has been
   * deleted from a copy of this document held elsewhere — the artifact keeps
   * the id it was written with, and the viewer treats a post it cannot find as
   * gone rather than as an error.
   */
  postId: z.number().int().positive().nullable().default(null),
  providerId: z.string().trim().min(1).max(60),
  providerName: z.string().trim().min(1).max(120),
  editor: z.enum(["normal", "markdown", "html"]).default("normal"),
  /** Empty is tolerated on the way out: an empty post still opens for editing. */
  content: z.string().max(400_000),
  characterLimit: z.number().int().positive().nullable().default(null),
  status: z.string().trim().max(40).default("draft"),
  /** Wall-clock stamp ("YYYY-MM-DDTHH:MM"), or null while it is a draft. */
  scheduledAt: z.string().trim().max(40).nullable().default(null),
  imageArtifactId: z.string().trim().max(200).nullable().default(null),
  remoteId: z.string().trim().max(200).nullable().default(null),
});

export type SocialsPostDocument = z.infer<typeof socialsPostDocumentSchema>;

export type SocialsPostParseResult =
  | { ok: true; value: SocialsPostDocument }
  | { ok: false; error: string; issues: string[] };

/**
 * Validate a stored post on the way back out of the artifact store. A document
 * from a build that stored more than this one understands is refused outright
 * rather than opened with half its fields missing — an editor over a partial
 * post would save that partial post back.
 */
export function parseStoredSocialsPost(value: unknown): SocialsPostParseResult {
  const version = (value as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (typeof version === "number" && version > SOCIALS_MANAGER_POST_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Unsupported post schema version ${version}.`,
      issues: [],
    };
  }
  const result = socialsPostDocumentSchema.safeParse(value);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    error: "This post's stored data did not match its schema.",
    issues: result.error.issues.slice(0, 8).map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    }),
  };
}

/** The post as the artifact stores it. */
export function socialsPostDocument(post: SocialsManagerPost): SocialsPostDocument {
  const provider = findSocialsManagerProvider(post.providerId);
  return {
    schemaVersion: SOCIALS_MANAGER_POST_SCHEMA_VERSION,
    postId: post.id,
    providerId: post.providerId,
    providerName: provider?.name ?? post.providerId,
    editor: provider?.editor ?? "normal",
    content: post.content,
    characterLimit: provider?.maxCharacters ?? null,
    status: post.status,
    scheduledAt: post.scheduledAt,
    imageArtifactId: post.imageArtifactId,
    remoteId: post.remoteId,
  };
}

/**
 * Metadata is what every surface that never opens the artifact still reads: the
 * card's one-line description, the archive's filters, and the image studio's
 * heading. It repeats the document rather than replacing it.
 */
export function socialsPostArtifactMetadata(
  document: SocialsPostDocument,
): Record<string, unknown> {
  return {
    socialsManagerPost: true,
    socialsManagerPostId: document.postId,
    socialsManagerNetwork: document.providerId,
    socialsManagerNetworkName: document.providerName,
    socialsManagerEditor: document.editor,
    socialsManagerScheduledAt: document.scheduledAt,
    socialsManagerStatus: document.status,
    socialsManagerImageArtifactId: document.imageArtifactId,
    characterCount: document.content.length,
    characterLimit: document.characterLimit,
  };
}

/** "X — Ship day is here" — the network, then as much of the copy as fits. */
export function socialsPostArtifactTitle(document: SocialsPostDocument): string {
  const firstLine = document.content.split("\n").find((line) => line.trim()) ?? "";
  const summary = firstLine.trim().slice(0, 60);
  return summary ? `${document.providerName} — ${summary}` : `${document.providerName} post`;
}
