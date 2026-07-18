// Typed, server-only HTTP client for the local Scriberr service.
//
// Endpoints used (Scriberr API v1, verified against the local checkout):
//   GET  /health                                  — no-auth liveness probe
//   POST /api/v1/auth/login                       — JWT login (optional auth mode)
//   POST /api/v1/transcription/upload-video       — multipart video upload
//   POST /api/v1/transcription/youtube            — server-side yt-dlp ingestion
//   POST /api/v1/transcription/:id/start          — start transcription (params)
//   GET  /api/v1/transcription/:id/status         — poll job status
//   GET  /api/v1/transcription/:id/transcript     — fetch structured transcript
//   POST /api/v1/transcription/:id/kill           — cancel a running job
//   DELETE /api/v1/transcription/:id              — delete job + media (cleanup)
//
// Authentication: X-API-Key header when SCRIBERR_API_TOKEN is set, otherwise a
// JWT obtained via /auth/login using SCRIBERR_USERNAME/SCRIBERR_PASSWORD.
// Credentials never leave the server.

import fs from "fs";
import { openAsBlob } from "fs";
import path from "path";

import { VideoTranscriptionError } from "./errors.ts";
import type {
  ScriberrJobSnapshot,
  ScriberrJobStatus,
  ScriberrTranscript,
  ScriberrTranscriptSegment,
} from "./types.ts";

type FetchLike = typeof fetch;

export interface ScriberrClientOptions {
  baseUrl: string;
  apiToken?: string | null;
  username?: string | null;
  password?: string | null;
  requestTimeoutMs?: number;
  fetchImpl?: FetchLike;
}

const SCRIBERR_STATUSES: ReadonlySet<string> = new Set([
  "uploaded",
  "pending",
  "processing",
  "completed",
  "failed",
]);

/** Pure normalizer for Scriberr's TranscriptionJob JSON (unit-tested). */
export function normalizeScriberrJob(raw: unknown): ScriberrJobSnapshot {
  if (!raw || typeof raw !== "object") {
    throw new VideoTranscriptionError("scriberr_rejected", {
      detail: "Scriberr returned a non-object job payload",
    });
  }
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";
  const status = typeof record.status === "string" ? record.status : "";
  if (!id || !SCRIBERR_STATUSES.has(status)) {
    throw new VideoTranscriptionError("scriberr_rejected", {
      detail: `Scriberr job payload missing id/status (status=${status})`,
    });
  }
  const parameters =
    record.parameters && typeof record.parameters === "object"
      ? (record.parameters as Record<string, unknown>)
      : {};
  return {
    id,
    status: status as ScriberrJobStatus,
    title: typeof record.title === "string" ? record.title : null,
    errorMessage:
      typeof record.error_message === "string" && record.error_message.trim()
        ? record.error_message
        : null,
    diarization: record.diarization === true,
    model: typeof parameters.model === "string" ? parameters.model : null,
    modelFamily:
      typeof parameters.model_family === "string" ? parameters.model_family : null,
  };
}

/** Pure normalizer for the transcript endpoint payload (unit-tested). */
export function normalizeScriberrTranscriptPayload(raw: unknown): {
  available: boolean;
  transcript: ScriberrTranscript | null;
} {
  if (!raw || typeof raw !== "object") {
    throw new VideoTranscriptionError("transcript_malformed", {
      detail: "transcript payload was not an object",
    });
  }
  const record = raw as Record<string, unknown>;
  if (record.available !== true || record.transcript == null) {
    return { available: false, transcript: null };
  }
  const body = record.transcript;
  if (typeof body !== "object") {
    throw new VideoTranscriptionError("transcript_malformed", {
      detail: "transcript body was not an object",
    });
  }
  const data = body as Record<string, unknown>;
  const rawSegments = Array.isArray(data.segments) ? data.segments : [];
  const segments: ScriberrTranscriptSegment[] = [];
  for (const entry of rawSegments) {
    if (!entry || typeof entry !== "object") continue;
    const seg = entry as Record<string, unknown>;
    segments.push({
      start: Number(seg.start),
      end: Number(seg.end),
      text: typeof seg.text === "string" ? seg.text : "",
      speaker:
        typeof seg.speaker === "string" && seg.speaker.trim()
          ? seg.speaker.trim()
          : null,
    });
  }
  return {
    available: true,
    transcript: {
      segments,
      text: typeof data.text === "string" ? data.text : null,
      language:
        typeof data.language === "string" && data.language.trim()
          ? data.language.trim()
          : null,
      modelUsed:
        typeof data.model_used === "string" && data.model_used.trim()
          ? data.model_used.trim()
          : null,
    },
  };
}

export interface ScriberrStartParams {
  modelFamily?: string;
  model?: string;
  language?: string | null;
  diarize?: boolean;
}

export class ScriberrClient {
  private baseUrl: string;
  private apiToken: string | null;
  private username: string | null;
  private password: string | null;
  private requestTimeoutMs: number;
  private fetchImpl: FetchLike;
  private jwtToken: string | null = null;

  constructor(options: ScriberrClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiToken = options.apiToken ?? null;
    this.username = options.username ?? null;
    this.password = options.password ?? null;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private url(pathname: string): string {
    return `${this.baseUrl}${pathname}`;
  }

  private async login(): Promise<string> {
    if (!this.username || !this.password) {
      throw new VideoTranscriptionError("scriberr_auth_failed", {
        detail: "no API token and no username/password configured",
      });
    }
    const response = await this.rawRequest("POST", "/api/v1/auth/login", {
      json: { username: this.username, password: this.password },
      auth: false,
    });
    if (!response.ok) {
      throw new VideoTranscriptionError("scriberr_auth_failed", {
        detail: `login returned HTTP ${response.status}`,
      });
    }
    const data = (await response.json().catch(() => null)) as
      | { token?: unknown }
      | null;
    if (!data || typeof data.token !== "string" || !data.token) {
      throw new VideoTranscriptionError("scriberr_auth_failed", {
        detail: "login response did not include a token",
      });
    }
    this.jwtToken = data.token;
    return this.jwtToken;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    if (this.apiToken) return { "X-API-Key": this.apiToken };
    const token = this.jwtToken ?? (await this.login());
    return { Authorization: `Bearer ${token}` };
  }

  private async rawRequest(
    method: string,
    pathname: string,
    {
      json,
      body,
      timeoutMs,
      auth = true,
    }: {
      json?: unknown;
      body?: BodyInit;
      timeoutMs?: number;
      auth?: boolean;
    } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    if (auth) Object.assign(headers, await this.authHeaders());
    let requestBody: BodyInit | undefined = body;
    if (json !== undefined) {
      headers["Content-Type"] = "application/json";
      requestBody = JSON.stringify(json);
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      timeoutMs ?? this.requestTimeoutMs,
    );
    try {
      let response = await this.fetchImpl(this.url(pathname), {
        method,
        headers,
        body: requestBody,
        signal: controller.signal,
      });
      // A JWT can expire mid-job; retry exactly once with a fresh login.
      if (auth && response.status === 401 && !this.apiToken && this.jwtToken) {
        this.jwtToken = null;
        const retryHeaders = { ...headers, ...(await this.authHeaders()) };
        response = await this.fetchImpl(this.url(pathname), {
          method,
          headers: retryHeaders,
          body: requestBody,
          signal: controller.signal,
        });
      }
      return response;
    } catch (error) {
      if (error instanceof VideoTranscriptionError) throw error;
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new VideoTranscriptionError("scriberr_unavailable", {
        detail: aborted
          ? `request to Scriberr timed out (${pathname})`
          : `request to Scriberr failed (${pathname})`,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async expectJson(response: Response, context: string): Promise<unknown> {
    if (response.status === 401 || response.status === 403) {
      throw new VideoTranscriptionError("scriberr_auth_failed", {
        detail: `${context}: HTTP ${response.status}`,
      });
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
          ? ((data as { error: string }).error)
          : `HTTP ${response.status}`;
      throw new VideoTranscriptionError("scriberr_rejected", {
        detail: `${context}: ${message.slice(0, 300)}`,
      });
    }
    return data;
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const response = await this.rawRequest("GET", "/health", {
        auth: false,
        timeoutMs: Math.min(this.requestTimeoutMs, 10_000),
      });
      if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` };
      return { ok: true };
    } catch {
      return { ok: false, detail: "unreachable" };
    }
  }

  async uploadVideo({
    filePath,
    filename,
    title,
    timeoutMs,
  }: {
    filePath: string;
    /** Display filename (sanitized) sent to Scriberr; not a disk path. */
    filename: string;
    title?: string | null;
    timeoutMs?: number;
  }): Promise<ScriberrJobSnapshot> {
    if (!fs.existsSync(filePath)) {
      throw new VideoTranscriptionError("media_missing");
    }
    // Stream-backed Blob so large uploads are not buffered in memory.
    const blob = await openAsBlob(filePath);
    const form = new FormData();
    const safeName = filename || `video${path.extname(filePath)}`;
    form.append("video", blob, safeName);
    if (title) form.append("title", title);

    const response = await this.rawRequest("POST", "/api/v1/transcription/upload-video", {
      body: form,
      timeoutMs: timeoutMs ?? Math.max(this.requestTimeoutMs, 600_000),
    });
    return normalizeScriberrJob(await this.expectJson(response, "upload-video"));
  }

  async downloadYouTube({
    url,
    title,
    timeoutMs,
  }: {
    url: string;
    title?: string | null;
    timeoutMs: number;
  }): Promise<ScriberrJobSnapshot> {
    const response = await this.rawRequest("POST", "/api/v1/transcription/youtube", {
      json: title ? { url, title } : { url },
      timeoutMs,
    });
    if (!response.ok && response.status >= 500) {
      // Scriberr wraps yt-dlp failures in a 500 with an error + stderr details.
      const data = (await response.json().catch(() => null)) as
        | { error?: unknown }
        | null;
      const message =
        data && typeof data.error === "string" ? data.error : `HTTP ${response.status}`;
      throw new VideoTranscriptionError("youtube_download_failed", {
        detail: `scriberr youtube: ${message.slice(0, 300)}`,
      });
    }
    return normalizeScriberrJob(await this.expectJson(response, "youtube"));
  }

  async startTranscription(
    scriberrJobId: string,
    params: ScriberrStartParams,
  ): Promise<ScriberrJobSnapshot> {
    const body: Record<string, unknown> = {
      model_family: params.modelFamily ?? "whisper",
      model: params.model ?? "small",
      diarize: params.diarize ?? false,
    };
    if (params.language) body.language = params.language;
    const response = await this.rawRequest(
      "POST",
      `/api/v1/transcription/${encodeURIComponent(scriberrJobId)}/start`,
      { json: body },
    );
    return normalizeScriberrJob(await this.expectJson(response, "start"));
  }

  async getJobStatus(scriberrJobId: string): Promise<ScriberrJobSnapshot> {
    const response = await this.rawRequest(
      "GET",
      `/api/v1/transcription/${encodeURIComponent(scriberrJobId)}/status`,
    );
    return normalizeScriberrJob(await this.expectJson(response, "status"));
  }

  async getTranscript(scriberrJobId: string): Promise<{
    available: boolean;
    transcript: ScriberrTranscript | null;
  }> {
    const response = await this.rawRequest(
      "GET",
      `/api/v1/transcription/${encodeURIComponent(scriberrJobId)}/transcript`,
    );
    return normalizeScriberrTranscriptPayload(
      await this.expectJson(response, "transcript"),
    );
  }

  /** Cancel a running Scriberr job. 400 "not running" is treated as success. */
  async killJob(scriberrJobId: string): Promise<void> {
    const response = await this.rawRequest(
      "POST",
      `/api/v1/transcription/${encodeURIComponent(scriberrJobId)}/kill`,
    );
    if (response.ok || response.status === 400 || response.status === 404) return;
    await this.expectJson(response, "kill");
  }

  /** Delete the Scriberr job and its media (supported cleanup endpoint). */
  async deleteJob(scriberrJobId: string): Promise<void> {
    const response = await this.rawRequest(
      "DELETE",
      `/api/v1/transcription/${encodeURIComponent(scriberrJobId)}`,
    );
    if (response.ok || response.status === 404) return;
    await this.expectJson(response, "delete");
  }
}
