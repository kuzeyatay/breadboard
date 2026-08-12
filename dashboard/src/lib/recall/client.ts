// Typed client for the screenpipe engine's loopback HTTP API.
//
// Only the read endpoints Recall actually exposes are modelled here, plus the
// two audio-capture controls. Everything that can act on the computer — UI
// element automation, pipe execution, the enterprise gateway — is deliberately
// absent: a capability Breadboard does not call is a capability that cannot
// leak through a prompt.

import { resolveRecallApiKey } from "./api-key.ts";
import { getRecallConfig, type RecallConfig } from "./config.ts";
import { RecallError } from "./errors.ts";

export interface RecallHealth {
  status: string;
  statusCode?: number;
  message?: string;
  frameStatus?: string;
  audioStatus?: string;
  lastFrameTimestamp?: string | null;
  lastAudioTimestamp?: string | null;
  monitors?: string[];
}

export interface RecallSearchHit {
  type: string;
  timestamp: string | null;
  appName: string | null;
  windowName: string | null;
  text: string;
  frameId: number | null;
  speaker: string | null;
  /** "a11y" when the text came from the accessibility tree, "ocr" otherwise. */
  textSource: string | null;
}

export interface RecallSearchPage {
  hits: RecallSearchHit[];
  total: number | null;
  /** True when the engine reported more rows past this page. */
  hasMore: boolean;
}

export interface RecallSearchQuery {
  query?: string;
  contentType?: "all" | "ocr" | "audio";
  limit?: number;
  offset?: number;
  startTime?: string;
  endTime?: string;
  appName?: string;
  windowName?: string;
}

export interface RecallMeeting {
  id: number;
  title: string | null;
  app: string | null;
  attendees: string[];
  startedAt: string | null;
  endedAt: string | null;
  note: string | null;
}

export interface RecallTranscriptSegment {
  speaker: string | null;
  text: string;
  timestamp: string | null;
}

export interface RecallDevice {
  name: string;
  isDefault: boolean;
}

/**
 * Time expressions the engine understands, plus the everyday words a model
 * reaches for that it does not. Normalizing here keeps a natural phrasing from
 * turning into a 400 the model then "explains" as an empty history.
 */
export function normalizeTimeExpression(input: string | undefined | null): string | undefined {
  if (input === undefined || input === null) return undefined;
  const value = String(input).trim();
  if (!value) return undefined;
  const lower = value.toLowerCase();
  if (lower === "yesterday") return "1d ago";
  if (lower === "today") return "0d ago";
  if (lower === "now") return "now";
  // Bare calendar date → start of that day, UTC, which is what the engine's
  // flexible datetime parser accepts.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00Z`;
  return value;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => asString(item)).filter((item): item is string => item !== null);
  }
  const single = asString(value);
  if (!single) return [];
  return single
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export class RecallClient {
  private readonly config: RecallConfig;
  /** Resolved lazily and remembered: the key outlives any one request. */
  private apiKey: string | null | undefined;

  constructor(config: RecallConfig = getRecallConfig()) {
    this.config = config;
  }

  /**
   * Every endpoint but /health needs this. A client built before the engine
   * was ever started has no key to find, so it is resolved per instance rather
   * than at construction — by the time a read happens, the launcher has
   * written one.
   */
  private authorization(): Record<string, string> {
    if (this.apiKey === undefined) this.apiKey = resolveRecallApiKey(this.config);
    return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
  }

  private async request(
    endpoint: string,
    {
      method = "GET",
      body,
      timeoutMs,
    }: { method?: string; body?: unknown; timeoutMs?: number } = {},
  ): Promise<unknown> {
    const url = `${this.config.baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      timeoutMs ?? this.config.requestTimeoutMs,
    );
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...this.authorization(),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new RecallError("engine_unavailable", {
        detail: `${method} ${endpoint}`,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) {
      throw new RecallError("engine_auth_failed", { detail: `${method} ${endpoint}` });
    }
    if (!response.ok) {
      // The engine's body can carry the user's own screen text; keep it out of
      // the error surface entirely and report only the shape of the failure.
      throw new RecallError("engine_rejected", {
        detail: `${method} ${endpoint} → HTTP ${response.status}`,
      });
    }
    const text = await response.text();
    if (!text.trim()) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new RecallError("engine_rejected", {
        detail: `${method} ${endpoint} → non-JSON body`,
      });
    }
  }

  /** Liveness + what the engine is currently capturing. */
  async health(): Promise<RecallHealth> {
    const raw = (await this.request("/health", {
      timeoutMs: this.config.healthTimeoutMs,
    })) as Record<string, unknown>;
    return {
      status: asString(raw.status) ?? "unknown",
      statusCode: asNumber(raw.status_code) ?? undefined,
      message: asString(raw.message) ?? undefined,
      frameStatus: asString(raw.frame_status) ?? undefined,
      audioStatus: asString(raw.audio_status) ?? undefined,
      lastFrameTimestamp: asString(raw.last_frame_timestamp),
      lastAudioTimestamp: asString(raw.last_audio_timestamp),
      monitors: asStringList(raw.monitors),
    };
  }

  async search(query: RecallSearchQuery): Promise<RecallSearchPage> {
    const params = new URLSearchParams();
    if (query.query) params.set("q", query.query);
    params.set("content_type", query.contentType ?? "all");
    params.set("limit", String(query.limit ?? 10));
    params.set("offset", String(query.offset ?? 0));
    const startTime = normalizeTimeExpression(query.startTime);
    const endTime = normalizeTimeExpression(query.endTime);
    if (startTime) params.set("start_time", startTime);
    if (endTime) params.set("end_time", endTime);
    if (query.appName) params.set("app_name", query.appName);
    if (query.windowName) params.set("window_name", query.windowName);

    const raw = (await this.request(`/search?${params.toString()}`)) as Record<string, unknown>;
    const rows = Array.isArray(raw.data) ? raw.data : [];
    const pagination = (raw.pagination ?? {}) as Record<string, unknown>;
    const total = asNumber(pagination.total);
    const limit = query.limit ?? 10;
    const offset = query.offset ?? 0;

    return {
      hits: rows.map((row) => this.toHit(row as Record<string, unknown>)),
      total,
      hasMore: total !== null ? offset + rows.length < total : rows.length >= limit,
    };
  }

  private toHit(row: Record<string, unknown>): RecallSearchHit {
    const content = (row.content ?? {}) as Record<string, unknown>;
    return {
      type: asString(row.type) ?? "unknown",
      timestamp: asString(content.timestamp),
      appName: asString(content.app_name),
      windowName: asString(content.window_name),
      text: asString(content.text) ?? asString(content.transcription) ?? "",
      frameId: asNumber(content.frame_id),
      speaker:
        asString(content.speaker_name) ??
        asString((content.speaker as Record<string, unknown> | undefined)?.name),
      textSource: asString(content.text_source),
    };
  }

  /**
   * The engine's own summary of a period: apps, windows, time spent, key text.
   * Returned as an opaque record because its shape is the engine's to define
   * and Recall only ever hands it onward as compact text.
   */
  async activitySummary(input: {
    startTime: string;
    endTime: string;
    appName?: string;
  }): Promise<Record<string, unknown>> {
    const params = new URLSearchParams();
    const startTime = normalizeTimeExpression(input.startTime);
    const endTime = normalizeTimeExpression(input.endTime);
    if (!startTime || !endTime) {
      throw new RecallError("invalid_input", { detail: "activity summary needs a time range" });
    }
    params.set("start_time", startTime);
    params.set("end_time", endTime);
    if (input.appName) params.set("app_name", input.appName);
    const raw = (await this.request(`/activity-summary?${params.toString()}`)) as Record<
      string,
      unknown
    >;
    return raw;
  }

  async meetings(input: {
    query?: string;
    startTime?: string;
    endTime?: string;
    limit?: number;
    offset?: number;
  }): Promise<RecallMeeting[]> {
    const params = new URLSearchParams();
    if (input.query) params.set("q", input.query);
    const startTime = normalizeTimeExpression(input.startTime);
    const endTime = normalizeTimeExpression(input.endTime);
    if (startTime) params.set("start_time", startTime);
    if (endTime) params.set("end_time", endTime);
    params.set("limit", String(input.limit ?? 10));
    params.set("offset", String(input.offset ?? 0));

    const raw = (await this.request(`/meetings?${params.toString()}`)) as Record<string, unknown>;
    const rows = Array.isArray(raw.data)
      ? raw.data
      : Array.isArray(raw.meetings)
        ? raw.meetings
        : [];
    return rows.map((row) => this.toMeeting(row as Record<string, unknown>));
  }

  async meeting(id: number): Promise<RecallMeeting> {
    const raw = (await this.request(`/meetings/${encodeURIComponent(String(id))}`)) as Record<
      string,
      unknown
    >;
    const row = (raw.data ?? raw.meeting ?? raw) as Record<string, unknown>;
    return this.toMeeting(row);
  }

  async meetingTranscript(id: number): Promise<RecallTranscriptSegment[]> {
    const raw = (await this.request(
      `/meetings/${encodeURIComponent(String(id))}/transcript`,
    )) as Record<string, unknown>;
    const rows = Array.isArray(raw.data)
      ? raw.data
      : Array.isArray(raw.segments)
        ? raw.segments
        : [];
    return rows.map((entry) => {
      const row = entry as Record<string, unknown>;
      return {
        speaker: asString(row.speaker) ?? asString(row.speaker_name),
        text: asString(row.text) ?? asString(row.transcription) ?? "",
        timestamp: asString(row.timestamp) ?? asString(row.start_time),
      };
    });
  }

  private toMeeting(row: Record<string, unknown>): RecallMeeting {
    return {
      id: asNumber(row.id) ?? 0,
      title: asString(row.title),
      app: asString(row.meeting_app) ?? asString(row.app),
      attendees: asStringList(row.attendees),
      startedAt: asString(row.meeting_start) ?? asString(row.start_time),
      endedAt: asString(row.meeting_end) ?? asString(row.end_time),
      note: asString(row.note),
    };
  }

  /** Full accessibility text and URLs for one captured moment. */
  async frameContext(frameId: number): Promise<Record<string, unknown>> {
    return (await this.request(
      `/frames/${encodeURIComponent(String(frameId))}/context`,
    )) as Record<string, unknown>;
  }

  async audioDevices(): Promise<RecallDevice[]> {
    const raw = (await this.request("/audio/list")) as unknown;
    const rows = Array.isArray(raw) ? raw : Array.isArray((raw as { data?: unknown }).data)
      ? ((raw as { data: unknown[] }).data)
      : [];
    return rows.map((entry) => {
      const row = entry as Record<string, unknown>;
      return {
        name: asString(row.name) ?? asString(row.device) ?? "unknown device",
        isDefault: row.is_default === true || row.default === true,
      };
    });
  }

  async monitors(): Promise<RecallDevice[]> {
    const raw = (await this.request("/vision/list")) as unknown;
    const rows = Array.isArray(raw) ? raw : Array.isArray((raw as { data?: unknown }).data)
      ? ((raw as { data: unknown[] }).data)
      : [];
    return rows.map((entry) => {
      const row = entry as Record<string, unknown>;
      return {
        name:
          asString(row.name) ??
          asString(row.id) ??
          (asNumber(row.id) !== null ? `monitor ${asNumber(row.id)}` : "unknown monitor"),
        isDefault: row.is_default === true || row.default === true,
      };
    });
  }

  /** Start or stop microphone capture. Screen capture is not affected. */
  async setAudioCapture(enabled: boolean): Promise<void> {
    await this.request(enabled ? "/audio/start" : "/audio/stop", { method: "POST" });
  }
}

export function recallClient(config?: RecallConfig): RecallClient {
  return new RecallClient(config ?? getRecallConfig());
}
