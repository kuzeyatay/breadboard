// SQLite-backed persistence for the Socials Manager's channels and posts.
//
// A plain class over an injected database handle (matching
// src/lib/calendar/store.ts and src/lib/schedules/store.ts) so it can be unit
// tested against an in-memory database. It deliberately knows nothing about the
// calendar: the `calendarEventId` column is written by ./calendar-bridge.ts,
// which owns the two-store transaction. Keeping the join out of here is what
// lets the store be tested without standing up the calendar schema.

import type DatabaseType from "better-sqlite3";

import { ensureSocialsManagerSchema } from "./schema.ts";
import { findSocialsManagerProvider } from "./providers.ts";
import { parseStamp } from "../calendar/wallclock.ts";
import {
  isSocialsManagerPostStatus,
  type SocialsManagerChannel,
  type SocialsManagerChannelInput,
  type SocialsManagerPost,
  type SocialsManagerPostInput,
  type SocialsManagerPostPatch,
  type SocialsManagerPostStatus,
} from "./types.ts";

type Db = DatabaseType.Database;

export const MAX_CHANNELS_PER_USER = 50;
export const MAX_POSTS_PER_USER = 5_000;
export const MAX_HANDLE_LENGTH = 120;
export const MAX_DISPLAY_NAME_LENGTH = 120;

export class SocialsManagerError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "SocialsManagerError";
    this.status = status;
  }
}

interface ChannelRow {
  id: number;
  provider_id: string;
  handle: string;
  display_name: string;
  enabled: number;
  created_at: string;
}

interface PostRow {
  id: number;
  run_id: string | null;
  provider_id: string;
  channel_id: number | null;
  content: string;
  status: string;
  scheduled_at: string | null;
  published_at: string | null;
  calendar_event_id: number | null;
  artifact_id: string | null;
  image_artifact_id: string | null;
  remote_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function presentChannel(row: ChannelRow): SocialsManagerChannel {
  return {
    id: row.id,
    providerId: row.provider_id,
    handle: row.handle,
    displayName: row.display_name,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  };
}

function presentPost(row: PostRow): SocialsManagerPost {
  return {
    id: row.id,
    runId: row.run_id,
    providerId: row.provider_id,
    channelId: row.channel_id,
    content: row.content,
    status: isSocialsManagerPostStatus(row.status) ? row.status : "draft",
    scheduledAt: row.scheduled_at,
    publishedAt: row.published_at,
    calendarEventId: row.calendar_event_id,
    artifactId: row.artifact_id,
    imageArtifactId: row.image_artifact_id,
    remoteId: row.remote_id,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireText(value: unknown, field: string, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new SocialsManagerError(400, `${field} is required.`);
  if (text.length > max) {
    throw new SocialsManagerError(400, `${field} must be ${max} characters or fewer.`);
  }
  return text;
}

/**
 * Content is validated against the network's real ceiling rather than a generic
 * one, so a 280-character X post cannot be saved as a 3000-character LinkedIn
 * draft by passing the wrong provider.
 */
function requireContent(providerId: string, value: unknown): string {
  const provider = findSocialsManagerProvider(providerId);
  if (!provider) throw new SocialsManagerError(400, `Unknown network "${providerId}".`);
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new SocialsManagerError(400, "Post content is required.");
  if (text.length > provider.maxCharacters) {
    throw new SocialsManagerError(
      400,
      `${provider.name} allows ${provider.maxCharacters} characters; this post is ${text.length}.`,
    );
  }
  return text;
}

function requireProviderId(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  const provider = findSocialsManagerProvider(raw);
  if (!provider) throw new SocialsManagerError(400, `Unknown network "${raw}".`);
  return provider.id;
}

function optionalStamp(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !parseStamp(value)) {
    throw new SocialsManagerError(400, `${field} must look like "YYYY-MM-DDTHH:MM".`);
  }
  return value.trim();
}

export class SocialsManagerStore {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
    ensureSocialsManagerSchema(db);
  }

  // ----------------------------------------------------------------- channels

  listChannels(userId: number): SocialsManagerChannel[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM socials_manager_channels WHERE user_id = ? ORDER BY provider_id ASC, id ASC`,
      )
      .all(userId) as ChannelRow[];
    return rows.map(presentChannel);
  }

  getChannel(userId: number, channelId: number): SocialsManagerChannel {
    const row = this.db
      .prepare(`SELECT * FROM socials_manager_channels WHERE id = ? AND user_id = ?`)
      .get(channelId, userId) as ChannelRow | undefined;
    if (!row) throw new SocialsManagerError(404, "That channel does not exist.");
    return presentChannel(row);
  }

  createChannel(userId: number, input: SocialsManagerChannelInput): SocialsManagerChannel {
    const total = this.db
      .prepare(`SELECT COUNT(*) AS total FROM socials_manager_channels WHERE user_id = ?`)
      .get(userId) as { total: number };
    if (total.total >= MAX_CHANNELS_PER_USER) {
      throw new SocialsManagerError(409, `You can register up to ${MAX_CHANNELS_PER_USER} channels.`);
    }

    const providerId = requireProviderId(input.providerId);
    const handle = requireText(input.handle, "Handle", MAX_HANDLE_LENGTH);
    const displayName =
      typeof input.displayName === "string" && input.displayName.trim()
        ? input.displayName.trim().slice(0, MAX_DISPLAY_NAME_LENGTH)
        : handle;

    const existing = this.db
      .prepare(
        `SELECT id FROM socials_manager_channels
          WHERE user_id = ? AND provider_id = ? AND handle = ?`,
      )
      .get(userId, providerId, handle) as { id: number } | undefined;
    if (existing) throw new SocialsManagerError(409, `${handle} is already registered for that network.`);

    const result = this.db
      .prepare(
        `INSERT INTO socials_manager_channels (user_id, provider_id, handle, display_name, enabled)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(userId, providerId, handle, displayName, input.enabled === false ? 0 : 1);

    return this.getChannel(userId, Number(result.lastInsertRowid));
  }

  deleteChannel(userId: number, channelId: number): void {
    const result = this.db
      .prepare(`DELETE FROM socials_manager_channels WHERE id = ? AND user_id = ?`)
      .run(channelId, userId);
    if (result.changes === 0) throw new SocialsManagerError(404, "That channel does not exist.");
  }

  // -------------------------------------------------------------------- posts

  getPost(userId: number, postId: number): SocialsManagerPost {
    const row = this.db
      .prepare(`SELECT * FROM socials_manager_posts WHERE id = ? AND user_id = ?`)
      .get(postId, userId) as PostRow | undefined;
    if (!row) throw new SocialsManagerError(404, "That post does not exist.");
    return presentPost(row);
  }

  listPosts(userId: number): SocialsManagerPost[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM socials_manager_posts WHERE user_id = ?
          ORDER BY COALESCE(scheduled_at, created_at) DESC, id DESC`,
      )
      .all(userId) as PostRow[];
    return rows.map(presentPost);
  }

  listPostsByRun(userId: number, runId: string): SocialsManagerPost[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM socials_manager_posts WHERE user_id = ? AND run_id = ?
          ORDER BY id ASC`,
      )
      .all(userId, runId) as PostRow[];
    return rows.map(presentPost);
  }

  createPost(userId: number, input: SocialsManagerPostInput): SocialsManagerPost {
    const total = this.db
      .prepare(`SELECT COUNT(*) AS total FROM socials_manager_posts WHERE user_id = ?`)
      .get(userId) as { total: number };
    if (total.total >= MAX_POSTS_PER_USER) {
      throw new SocialsManagerError(409, `You can keep up to ${MAX_POSTS_PER_USER} posts.`);
    }

    const providerId = requireProviderId(input.providerId);
    const content = requireContent(providerId, input.content);
    const scheduledAt = optionalStamp(input.scheduledAt, "Schedule time");
    if (input.channelId !== null && input.channelId !== undefined) {
      const channel = this.getChannel(userId, input.channelId);
      if (channel.providerId !== providerId) {
        throw new SocialsManagerError(400, `That channel does not belong to ${providerId}.`);
      }
    }

    const result = this.db
      .prepare(
        `INSERT INTO socials_manager_posts (
           user_id, run_id, provider_id, channel_id, content, status,
           scheduled_at, artifact_id, image_artifact_id, remote_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        userId,
        input.runId ?? null,
        providerId,
        input.channelId ?? null,
        content,
        scheduledAt ? "scheduled" : "draft",
        scheduledAt,
        input.artifactId ?? null,
        input.imageArtifactId ?? null,
        input.remoteId ?? null,
      );

    return this.getPost(userId, Number(result.lastInsertRowid));
  }

  updatePost(userId: number, postId: number, patch: SocialsManagerPostPatch): SocialsManagerPost {
    const current = this.getPost(userId, postId);

    const content =
      patch.content === undefined
        ? current.content
        : requireContent(current.providerId, patch.content);
    const scheduledAt =
      patch.scheduledAt === undefined
        ? current.scheduledAt
        : optionalStamp(patch.scheduledAt, "Schedule time");
    if (patch.channelId !== undefined && patch.channelId !== null) {
      const channel = this.getChannel(userId, patch.channelId);
      if (channel.providerId !== current.providerId) {
        throw new SocialsManagerError(400, `That channel does not belong to ${current.providerId}.`);
      }
    }
    const status: SocialsManagerPostStatus =
      patch.status ??
      (patch.scheduledAt === undefined
        ? current.status
        : scheduledAt
          ? "scheduled"
          : "draft");
    if (!isSocialsManagerPostStatus(status)) {
      throw new SocialsManagerError(400, `Unknown post status "${status}".`);
    }

    this.db
      .prepare(
        `UPDATE socials_manager_posts
            SET content = ?, scheduled_at = ?, channel_id = ?, artifact_id = ?,
                image_artifact_id = ?, remote_id = ?, status = ?, error = ?,
                updated_at = datetime('now')
          WHERE id = ? AND user_id = ?`,
      )
      .run(
        content,
        scheduledAt,
        patch.channelId === undefined ? current.channelId : patch.channelId,
        patch.artifactId === undefined ? current.artifactId : patch.artifactId,
        patch.imageArtifactId === undefined
          ? current.imageArtifactId
          : patch.imageArtifactId,
        patch.remoteId === undefined ? current.remoteId : patch.remoteId,
        status,
        patch.error === undefined ? current.error : patch.error,
        postId,
        userId,
      );

    return this.getPost(userId, postId);
  }

  /**
   * Written only by ./calendar-bridge.ts. Separated from updatePost so the
   * bridge cannot accidentally rewrite content while re-pointing the event.
   */
  setCalendarEventId(userId: number, postId: number, eventId: number | null): SocialsManagerPost {
    this.db
      .prepare(
        `UPDATE socials_manager_posts SET calendar_event_id = ?, updated_at = datetime('now')
          WHERE id = ? AND user_id = ?`,
      )
      .run(eventId, postId, userId);
    return this.getPost(userId, postId);
  }

  /**
   * Posts still marked scheduled whose calendar event has gone. Deleting the
   * event nulls `calendar_event_id` through the foreign key before any code can
   * observe it, so this is the only way to find a post whose slot vanished.
   */
  listOrphanedScheduledPosts(userId: number): SocialsManagerPost[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM socials_manager_posts
          WHERE user_id = ? AND status = 'scheduled' AND calendar_event_id IS NULL
          ORDER BY id ASC`,
      )
      .all(userId) as PostRow[];
    return rows.map(presentPost);
  }

  /** The post occupying a calendar event, used to reconcile calendar-side edits. */
  findByCalendarEventId(userId: number, eventId: number): SocialsManagerPost | null {
    const row = this.db
      .prepare(`SELECT * FROM socials_manager_posts WHERE user_id = ? AND calendar_event_id = ?`)
      .get(userId, eventId) as PostRow | undefined;
    return row ? presentPost(row) : null;
  }

  markPublished(userId: number, postId: number, at: string): SocialsManagerPost {
    this.db
      .prepare(
        `UPDATE socials_manager_posts
            SET status = 'published', published_at = ?, error = NULL,
                updated_at = datetime('now')
          WHERE id = ? AND user_id = ?`,
      )
      .run(at, postId, userId);
    return this.getPost(userId, postId);
  }

  markFailed(userId: number, postId: number, error: string): SocialsManagerPost {
    this.db
      .prepare(
        `UPDATE socials_manager_posts
            SET status = 'failed', error = ?, updated_at = datetime('now')
          WHERE id = ? AND user_id = ?`,
      )
      .run(error.slice(0, 2_000), postId, userId);
    return this.getPost(userId, postId);
  }

  deletePost(userId: number, postId: number): void {
    const result = this.db
      .prepare(`DELETE FROM socials_manager_posts WHERE id = ? AND user_id = ?`)
      .run(postId, userId);
    if (result.changes === 0) throw new SocialsManagerError(404, "That post does not exist.");
  }
}
