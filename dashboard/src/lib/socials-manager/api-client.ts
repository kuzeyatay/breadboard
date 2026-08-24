// Client for Postiz's public API v1.
//
// Shapes are taken from the vendored clone rather than guessed:
//   auth      — a raw `Authorization: <orgApiKey>` header, not a Bearer token
//               (apps/backend/src/services/auth/public.auth.middleware.ts)
//   routes    — mounted at /public/v1 (public.integrations.controller.ts)
//   post body — CreatePostDto (libraries/nestjs-libraries/src/dtos/posts/)
//
// The one real impedance mismatch is time. Breadboard stores wall-clock stamps
// ("YYYY-MM-DDTHH:MM", no zone) because that is what a calendar means; Postiz
// wants an absolute ISO instant. The conversion happens here and nowhere else.

import type { SocialsManagerConfig } from "./config.ts";

export interface PostizIntegration {
  id: string;
  name: string;
  /** Postiz's provider identifier — matches our provider registry ids. */
  identifier: string;
  picture?: string;
  disabled?: boolean;
  profile?: string;
}

export interface PostizProviderField {
  key: string;
  label: string;
  type: "text" | "password";
  defaultValue?: string;
  hint?: string;
}

export interface PostizProviderConnection {
  identifier: string;
  name: string;
  toolTip?: string;
  isExternal: boolean;
  isWeb3: boolean;
  isChromeExtension: boolean;
  customFields: PostizProviderField[];
}

export interface PostizRemotePost {
  id: string;
  content: string;
  publishDate: string;
  state?: string;
  integration?: string;
}

/**
 * A file in Postiz's media library. `id` and `path` are the two fields
 * CreatePostDto's MediaDto requires when attaching it to a post.
 */
export interface PostizMedia {
  id: string;
  path: string;
}

export class PostizApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PostizApiError";
    this.status = status;
  }
}

/** Local wall-clock ("2026-08-05T09:00") → absolute ISO instant. */
export function wallClockToIso(stamp: string, reference = new Date()): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(stamp.trim());
  if (!match) return reference.toISOString();
  const [, year, month, day, hour, minute] = match.map(Number) as unknown as number[];
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
}

/** Absolute ISO instant → local wall-clock, for the calendar and the UI. */
export function isoToWallClock(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export class PostizApiClient {
  private config: SocialsManagerConfig;
  private apiKey: string;

  constructor(config: SocialsManagerConfig, apiKey: string) {
    this.config = config;
    this.apiKey = apiKey;
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    route: string,
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(`${this.config.publicApiUrl}${route}`, {
        method,
        headers: {
          authorization: this.apiKey,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new PostizApiError(
          response.status,
          text.slice(0, 400) || `Postiz returned ${response.status}`,
        );
      }
      return (text ? JSON.parse(text) : {}) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private async appRequest<T>(
    method: "GET" | "POST",
    route: string,
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(`${this.config.appApiUrl}${route}`, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        let message = text.slice(0, 400);
        try {
          const parsed = JSON.parse(text) as { message?: unknown; msg?: unknown };
          const candidate = parsed.message ?? parsed.msg;
          if (typeof candidate === "string") message = candidate;
        } catch {
          // Preserve the bounded response text.
        }
        throw new PostizApiError(
          response.status,
          message || `Postiz returned ${response.status}`,
        );
      }
      return (text ? JSON.parse(text) : {}) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** The social accounts actually connected in Postiz. */
  async listIntegrations(): Promise<PostizIntegration[]> {
    const result = await this.request<PostizIntegration[]>("GET", "/integrations");
    return Array.isArray(result) ? result : [];
  }

  /** Provider connection metadata used by Breadboard's native settings UI. */
  async listProviderConnections(): Promise<PostizProviderConnection[]> {
    const result = await this.appRequest<{
      social?: Array<Partial<PostizProviderConnection>>;
    }>("GET", "/integrations");
    if (!Array.isArray(result.social)) return [];
    return result.social.flatMap((candidate) => {
      if (
        typeof candidate.identifier !== "string" ||
        typeof candidate.name !== "string"
      ) {
        return [];
      }
      const customFields = Array.isArray(candidate.customFields)
        ? candidate.customFields.flatMap((field) =>
            field &&
            typeof field.key === "string" &&
            typeof field.label === "string" &&
            (field.type === "text" || field.type === "password")
              ? [{
                  key: field.key,
                  label: field.label,
                  type: field.type,
                  ...(typeof field.defaultValue === "string"
                    ? { defaultValue: field.defaultValue }
                    : {}),
                  ...(typeof field.hint === "string" ? { hint: field.hint } : {}),
                }]
              : [],
          )
        : [];
      return [{
        identifier: candidate.identifier,
        name: candidate.name,
        ...(typeof candidate.toolTip === "string" ? { toolTip: candidate.toolTip } : {}),
        isExternal: candidate.isExternal === true,
        isWeb3: candidate.isWeb3 === true,
        isChromeExtension: candidate.isChromeExtension === true,
        customFields,
      }];
    });
  }

  /** Begin a provider flow. OAuth providers return an external consent URL. */
  async createConnectionUrl(providerId: string): Promise<string> {
    const result = await this.request<{ url?: unknown }>(
      "GET",
      `/social/${encodeURIComponent(providerId)}`,
    );
    if (typeof result.url !== "string" || !result.url.trim()) {
      throw new PostizApiError(502, "Postiz did not return a connection URL.");
    }
    return result.url;
  }

  /** Complete a credential-backed provider flow entirely over loopback. */
  async completeConnection(input: {
    providerId: string;
    state: string;
    code: string;
    timezone: number;
  }): Promise<void> {
    await this.appRequest(
      "POST",
      `/integrations/social-connect/${encodeURIComponent(input.providerId)}`,
      {
        state: input.state,
        code: input.code,
        timezone: String(input.timezone),
      },
    );
  }

  async deleteIntegration(id: string): Promise<void> {
    await this.request("DELETE", `/integrations/${encodeURIComponent(id)}`);
  }

  /**
   * Put an image in Postiz's media library so a post can reference it.
   *
   * Postiz rejects media a post did not upload through this route
   * (`RESTRICT_UPLOAD_DOMAINS` in public.integrations.controller.ts), so a
   * Breadboard artifact has to be pushed as bytes — a link to our own
   * loopback-only artifact route would never resolve from the container.
   */
  async uploadMedia(input: {
    buffer: Uint8Array;
    filename: string;
    mimeType: string;
  }): Promise<PostizMedia> {
    const form = new FormData();
    form.set(
      "file",
      new Blob([new Uint8Array(input.buffer)], { type: input.mimeType }),
      input.filename,
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await fetch(`${this.config.publicApiUrl}/upload`, {
        method: "POST",
        // No content-type: fetch sets the multipart boundary itself.
        headers: { authorization: this.apiKey },
        body: form,
        cache: "no-store",
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new PostizApiError(
          response.status,
          text.slice(0, 400) || `Postiz returned ${response.status}`,
        );
      }
      const media = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
      if (typeof media.id !== "string" || typeof media.path !== "string") {
        throw new PostizApiError(502, "Postiz did not return an uploaded media record.");
      }
      return { id: media.id, path: media.path };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * The posts Postiz holds for a window.
   *
   * Current builds want an ISO `startDate`/`endDate` pair and reject anything
   * else with a 400; older ones took `week`/`year`. Both spellings are passed
   * through so a caller can try the current one and fall back, rather than
   * having "the API said no" quietly mean "there is nothing scheduled".
   */
  async listPosts(
    range: { week?: number; year?: number; startDate?: string; endDate?: string } = {},
  ): Promise<PostizRemotePost[]> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(range)) {
      if (value !== undefined) query.set(key, String(value));
    }
    const suffix = query.toString() ? `?${query}` : "";
    const result = await this.request<{ posts?: PostizRemotePost[] } | PostizRemotePost[]>(
      "GET",
      `/posts${suffix}`,
    );
    // The route has answered with both a bare array and a `{ posts }` envelope
    // across Postiz versions.
    if (Array.isArray(result)) return result;
    return Array.isArray(result.posts) ? result.posts : [];
  }

  /**
   * Schedule one post on one integration. Postiz models a submission as a group
   * of per-channel posts; Breadboard writes one channel at a time so a single
   * network failing cannot reject the whole batch.
   */
  async createPost(input: {
    integrationId: string;
    content: string;
    /** Wall-clock stamp; converted to an instant here. */
    scheduledAt: string;
    type?: "draft" | "schedule" | "now";
    /** Media already uploaded through `uploadMedia`. */
    image?: PostizMedia[];
  }): Promise<{ id?: string; postId?: string } | Record<string, unknown>> {
    return this.request("POST", "/posts", {
      type: input.type ?? "schedule",
      shortLink: false,
      date: wallClockToIso(input.scheduledAt),
      tags: [],
      posts: [
        {
          integration: { id: input.integrationId },
          value: [{ content: input.content, image: input.image ?? [] }],
          settings: {},
        },
      ],
    });
  }

  async deletePost(id: string): Promise<void> {
    await this.request("DELETE", `/posts/${encodeURIComponent(id)}`);
  }

  /** Cheap authenticated probe used to decide whether the stack is usable. */
  async healthy(): Promise<boolean> {
    try {
      await this.listIntegrations();
      return true;
    } catch {
      return false;
    }
  }
}
