// Shared Socials Manager types. Imported by the SQLite store, the route handlers and the
// inline chat UI alike, so nothing here may reach for node or next APIs.

export const SOCIALS_MANAGER_POST_STATUSES = [
  "draft",
  "scheduled",
  "published",
  "failed",
  "cancelled",
] as const;

export type SocialsManagerPostStatus = (typeof SOCIALS_MANAGER_POST_STATUSES)[number];

export function isSocialsManagerPostStatus(value: unknown): value is SocialsManagerPostStatus {
  return (
    typeof value === "string" &&
    (SOCIALS_MANAGER_POST_STATUSES as readonly string[]).includes(value)
  );
}

/** A social account the user has registered for a network. */
export interface SocialsManagerChannel {
  id: number;
  providerId: string;
  handle: string;
  displayName: string;
  enabled: boolean;
  createdAt: string;
}

export interface SocialsManagerPost {
  id: number;
  runId: string | null;
  providerId: string;
  channelId: number | null;
  content: string;
  status: SocialsManagerPostStatus;
  /** Wall-clock stamp ("YYYY-MM-DDTHH:MM"), or null while it is still a draft. */
  scheduledAt: string | null;
  publishedAt: string | null;
  /** The Breadboard calendar event this post occupies, once scheduled. */
  calendarEventId: number | null;
  /** The durable artifact carrying this post's copy. */
  artifactId: string | null;
  /** The image artifact published alongside the copy, once one is attached. */
  imageArtifactId: string | null;
  /**
   * The post's id inside the real Postiz stack. Null means it is a local-only
   * draft, made while the stack was still starting.
   */
  remoteId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SocialsManagerChannelInput {
  providerId: string;
  handle: string;
  displayName?: string;
  enabled?: boolean;
}

export interface SocialsManagerPostInput {
  providerId: string;
  content: string;
  runId?: string | null;
  channelId?: number | null;
  scheduledAt?: string | null;
  artifactId?: string | null;
  imageArtifactId?: string | null;
  remoteId?: string | null;
}

export type SocialsManagerPostPatch = Partial<
  Pick<
    SocialsManagerPostInput,
    | "content"
    | "scheduledAt"
    | "channelId"
    | "artifactId"
    | "imageArtifactId"
    | "remoteId"
  >
> & { status?: SocialsManagerPostStatus; error?: string | null };

/**
 * A post as the chat card sees it: the stored row plus the presentation the UI
 * cannot derive on its own — the network's display name, its character ceiling,
 * and an auth-scoped URL for the attached image.
 */
export interface PresentedSocialsManagerPost extends SocialsManagerPost {
  providerName: string;
  characterCount: number;
  characterLimit: number | null;
  /** Preview URL for `imageArtifactId`, or null when nothing is attached. */
  imagePreviewUrl: string | null;
}
