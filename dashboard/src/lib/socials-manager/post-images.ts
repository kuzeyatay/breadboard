// Resolving the image artifact a post carries.
//
// A post stores only an artifact id. Everything the rest of the system needs
// from that id — a preview URL for the chat card, raw bytes for the upload to
// the real Postiz stack — is derived here so the artifact store is reached from
// exactly one place and always through the owning user.
//
// A missing or foreign artifact resolves to null rather than throwing: an image
// can be deleted from the Artifacts panel long after a post was written, and
// that must degrade the card, not break scheduling.

import fs from "node:fs";
import type Database from "better-sqlite3";

import {
  artifactFile,
  getArtifactById,
  listImageArtifactsForUser,
  type ArtifactRow,
} from "../hermes/artifact-store.ts";
import type { SocialsManagerPost, PresentedSocialsManagerPost } from "./types.ts";
import { findSocialsManagerProvider } from "./providers.ts";

/** Formats a social network will accept, and that Postiz's own validator allows. */
const PUBLISHABLE_IMAGE_TYPES = /^image\/(?:png|jpeg|webp|gif)$/i;

function ownedImageArtifact(
  userId: number,
  artifactId: string | null,
): ArtifactRow | null {
  if (!artifactId) return null;
  try {
    const artifact = getArtifactById(artifactId);
    if (!artifact || artifact.user_id !== userId) return null;
    if (artifact.kind !== "image" && artifact.kind !== "diagram") return null;
    if (artifact.status !== "ready") return null;
    return artifact;
  } catch {
    return null;
  }
}

function previewUrlFor(artifact: ArtifactRow): string | null {
  if (!artifact.preview_location || !artifact.conversation_public_id) return null;
  const query = new URLSearchParams({
    conversationId: artifact.conversation_public_id,
    version: String(artifact.current_version),
  });
  return `/api/hermes/artifacts/${encodeURIComponent(artifact.id)}/preview?${query}`;
}

/** Auth-scoped preview URL for a post's image, or null when there is none. */
export function postImagePreviewUrl(
  userId: number,
  artifactId: string | null,
): string | null {
  const artifact = ownedImageArtifact(userId, artifactId);
  return artifact ? previewUrlFor(artifact) : null;
}

/** The post as the chat card consumes it. */
export function presentSocialsManagerPost(
  userId: number,
  post: SocialsManagerPost,
): PresentedSocialsManagerPost {
  const provider = findSocialsManagerProvider(post.providerId);
  return {
    ...post,
    providerName: provider?.name ?? post.providerId,
    characterCount: post.content.length,
    characterLimit: provider?.maxCharacters ?? null,
    imagePreviewUrl: postImagePreviewUrl(userId, post.imageArtifactId),
  };
}

export interface AttachablePostImage {
  id: string;
  title: string;
  /** Auth-scoped preview URL, so the picker can show the picture itself. */
  previewUrl: string;
  /** The Garden the image was made in, when it was made in one. */
  gardenSlug: string | null;
  createdAt: string;
}

/**
 * The user's own pictures, offered as candidates for a post's media object.
 *
 * Every entry is put through the same test `readPostImage` applies when the
 * choice is submitted — it exists on disk and is a format a social network
 * takes — so nothing offered here can be refused at attach time. A picture that
 * fails the test is left out silently rather than shown as a broken option.
 */
export function listAttachablePostImages(
  userId: number,
  options: {
    database?: Database.Database;
    storageRoot?: string;
    limit?: number;
  } = {},
): AttachablePostImage[] {
  const artifacts = listImageArtifactsForUser({
    userId,
    limit: options.limit,
    database: options.database,
  });
  const attachable: AttachablePostImage[] = [];
  for (const artifact of artifacts) {
    const previewUrl = previewUrlFor(artifact);
    if (!previewUrl) continue;
    try {
      // `artifactFile` resolves and stats the stored file without reading it,
      // so a long archive costs a stat each rather than a picture each.
      const file = artifactFile({
        artifact,
        version: artifact.current_version,
        purpose: "download",
        database: options.database,
        storageRoot: options.storageRoot,
      });
      if (!PUBLISHABLE_IMAGE_TYPES.test(file.mimeType)) continue;
    } catch {
      continue;
    }
    attachable.push({
      id: artifact.id,
      title: artifact.title,
      previewUrl,
      gardenSlug: artifact.garden_slug ?? null,
      createdAt: artifact.created_at,
    });
  }
  return attachable;
}

export interface PostImageFile {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

/**
 * Read a post's image off disk for upload. Returns null when the artifact is
 * gone, is not the user's, or is not a format a social network takes.
 */
export function readPostImage(
  userId: number,
  artifactId: string | null,
): PostImageFile | null {
  const artifact = ownedImageArtifact(userId, artifactId);
  if (!artifact) return null;
  try {
    const file = artifactFile({
      artifact,
      version: artifact.current_version,
      purpose: "download",
    });
    if (!PUBLISHABLE_IMAGE_TYPES.test(file.mimeType)) return null;
    return {
      buffer: fs.readFileSync(file.path),
      filename: file.filename || "image.png",
      mimeType: file.mimeType,
    };
  } catch {
    return null;
  }
}
