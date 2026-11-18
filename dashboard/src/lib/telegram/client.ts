// The Telegram Bot API, reduced to the four calls Breadboard makes.
//
// Nothing here talks to Breadboard's conversation pipeline — that is inbound.ts.
// The one rule this module enforces on itself: the token is part of every request
// URL, so no URL, and no raw response, ever reaches a thrown message or a log
// line. Errors carry Telegram's own `description` field and nothing else.

import { telegramApiBase, telegramTimings } from "./config.ts";
import { applyOutboundGuardrails } from "../guardrails/service.ts";
import { openAsBlob } from "node:fs";
import path from "node:path";
import { formatTelegramText, splitTelegramText } from "./format.ts";
export { splitForTelegram, TELEGRAM_MESSAGE_LIMIT } from "./format.ts";

export class TelegramApiError extends Error {
  /** HTTP status, or 0 when the request never got an answer. */
  status: number;
  /** Telegram's own `error_code`, when it sent one. */
  code: number | null;

  constructor(status: number, message: string, code: number | null = null) {
    super(message);
    this.name = "TelegramApiError";
    this.status = status;
    this.code = code;
  }

  /** A bad token: retrying will never help, so the gateway stops instead of looping. */
  get isAuthFailure(): boolean {
    return this.status === 401 || this.code === 401;
  }

  /** Another poller (or a webhook) owns this bot's update stream. */
  get isConflict(): boolean {
    return this.status === 409 || this.code === 409;
  }
}

interface TelegramEnvelope<T> {
  ok?: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

async function callTelegram<T>(
  token: string,
  method: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortOuter = () => controller.abort();
  signal?.addEventListener("abort", abortOuter, { once: true });

  try {
    const response = await fetch(`${telegramApiBase()}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: "no-store",
    });

    const envelope = (await response.json().catch(() => null)) as TelegramEnvelope<T> | null;
    if (!response.ok || !envelope?.ok) {
      const description = envelope?.description?.trim();
      throw new TelegramApiError(
        response.status,
        description || `Telegram refused ${method} (HTTP ${response.status}).`,
        typeof envelope?.error_code === "number" ? envelope.error_code : null,
      );
    }
    return envelope.result as T;
  } catch (cause) {
    if (cause instanceof TelegramApiError) throw cause;
    if (signal?.aborted) throw new TelegramApiError(0, "The Telegram poll was stopped.");
    if (cause instanceof Error && cause.name === "AbortError") {
      throw new TelegramApiError(0, `Telegram did not answer ${method} in time.`);
    }
    // A DNS/TLS/offline failure. `cause.message` is ours to show; it never
    // contains the request URL.
    throw new TelegramApiError(
      0,
      cause instanceof Error && cause.message
        ? `Breadboard could not reach Telegram: ${cause.message}`
        : "Breadboard could not reach Telegram.",
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortOuter);
  }
}

export interface TelegramBotIdentity {
  id: string;
  username: string;
  name: string;
}

/** Validate a token and learn which bot it belongs to. */
export async function getMe(token: string, signal?: AbortSignal): Promise<TelegramBotIdentity> {
  const me = await callTelegram<{ id?: number; username?: string; first_name?: string }>(
    token,
    "getMe",
    {},
    telegramTimings().requestTimeoutMs,
    signal,
  );
  return {
    id: me.id === undefined ? "" : String(me.id),
    username: me.username ?? "",
    name: me.first_name ?? me.username ?? "Telegram bot",
  };
}

/** Fetch bytes without ever exposing a token-bearing download URL in errors. */
export async function downloadTelegramFile(token: string, fileId: string): Promise<{
  body: ReadableStream<Uint8Array>;
  dispose: () => void;
}> {
  let file: { file_path?: string };
  try {
    file = await callTelegram(token, "getFile", { file_id: fileId }, telegramTimings().requestTimeoutMs);
  } catch (cause) {
    if (cause instanceof TelegramApiError && /too big|too large/i.test(cause.message)) {
      throw new Error("Telegram's hosted Bot API cannot download this file (20 MB limit). Send a smaller file or use a local Bot API server.");
    }
    throw new Error("Telegram could not retrieve the attachment. Please send it again.");
  }
  const filePath = file?.file_path;
  if (typeof filePath !== "string" || !filePath) throw new Error("Telegram did not provide the attachment file.");
  const base = telegramApiBase();
  // --local Bot API servers return absolute files on the same host.
  if (path.isAbsolute(filePath) && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname)) {
    try {
      const blob = await openAsBlob(filePath);
      return { body: blob.stream(), dispose: () => undefined };
    } catch { throw new Error("The local Telegram attachment is no longer available."); }
  }
  const parts = filePath.split("/");
  if (parts.some((part) => !part || part === "." || part === "..") || /[\\:?#\x00-\x1f]/.test(filePath)) {
    throw new Error("Telegram returned an invalid attachment path.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5 * 60_000);
  const dispose = () => { clearTimeout(timer); controller.abort(); };
  try {
    const response = await fetch(`${base}/file/bot${token}/${parts.map(encodeURIComponent).join("/")}`, {
      signal: controller.signal, cache: "no-store", redirect: "error",
    });
    if (!response.ok || !response.body) throw new Error("download failed");
    return { body: response.body, dispose };
  } catch {
    dispose();
    throw new Error("Telegram could not download the attachment. Please send it again.");
  }
}

/**
 * Long-poll for updates. `offset` is the first id Breadboard has not consumed;
 * passing it is what acknowledges everything before it.
 */
export async function getUpdates(
  token: string,
  offset: number,
  signal?: AbortSignal,
): Promise<unknown[]> {
  const timings = telegramTimings();
  const updates = await callTelegram<unknown[]>(
    token,
    "getUpdates",
    {
      offset: offset > 0 ? offset : undefined,
      timeout: timings.longPollSeconds,
      // Only what Breadboard can act on. Edits and reactions would otherwise
      // arrive as updates that consume an offset and produce nothing.
      allowed_updates: ["message"],
    },
    timings.longPollTimeoutMs,
    signal,
  );
  return Array.isArray(updates) ? updates : [];
}

/**
 * Drop a webhook if one is registered. A bot cannot be webhook-driven and
 * long-polled at the same time; without this, connecting a bot that was once
 * wired to something else fails with a 409 nobody can explain.
 */
export async function deleteWebhook(token: string, signal?: AbortSignal): Promise<void> {
  await callTelegram<boolean>(
    token,
    "deleteWebhook",
    { drop_pending_updates: false },
    telegramTimings().requestTimeoutMs,
    signal,
  );
}

export async function sendChatAction(
  token: string,
  chatId: string,
  action = "typing",
): Promise<void> {
  await callTelegram<boolean>(
    token,
    "sendChatAction",
    { chat_id: chatId, action },
    telegramTimings().requestTimeoutMs,
  );
}

/**
 * Send one reply, split across messages when it exceeds Telegram's limit.
 * Render Markdown locally and send explicit formatting entities, so Telegram
 * never has to parse an agent's Markdown (including incomplete delimiters).
 */
export async function sendMessage(token: string, chatId: string, text: string): Promise<void> {
  // Masked BEFORE splitting: a token like <EMAIL_ADDRESS> must never straddle
  // a chunk boundary, and detection needs the full message for context anyway.
  const message = formatTelegramText(applyOutboundGuardrails(text));
  for (const chunk of splitTelegramText(message)) {
    const payload = { chat_id: chatId, text: chunk.text, disable_web_page_preview: true };
    try {
      await callTelegram<unknown>(token, "sendMessage", {
        ...payload,
        ...(chunk.entities.length ? { entities: chunk.entities } : {}),
      }, telegramTimings().requestTimeoutMs);
    } catch (error) {
      // Only an explicit formatting rejection is safe to retry. Timeouts may
      // already have delivered the message, so retrying those would duplicate it.
      if (!(error instanceof TelegramApiError) || error.status !== 400 || !chunk.entities.length ||
          !/can't parse entities|entity (?:bounds|offset|length)|entities.*invalid/i.test(error.message)) throw error;
      await callTelegram<unknown>(token, "sendMessage", payload, telegramTimings().requestTimeoutMs);
    }
  }
}

export interface TelegramOutboundFile {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
}

/** Telegram's per-method upload ceilings for bots; anything bigger goes as a document. */
const PHOTO_LIMIT = 10 * 1024 * 1024;
const MEDIA_LIMIT = 50 * 1024 * 1024;

/** Which Bot API method shows this file the way a person would send it. */
export function telegramMediaMethod(mimeType: string, byteSize: number): {
  method: string;
  field: string;
} {
  const mime = mimeType.toLowerCase().split(";")[0].trim();
  if (byteSize <= PHOTO_LIMIT && ["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(mime)) return { method: "sendPhoto", field: "photo" };
  if (byteSize <= MEDIA_LIMIT && mime === "image/gif") return { method: "sendAnimation", field: "animation" };
  if (byteSize <= MEDIA_LIMIT && ["video/mp4", "video/quicktime", "video/webm"].includes(mime)) return { method: "sendVideo", field: "video" };
  if (byteSize <= MEDIA_LIMIT && ["audio/mpeg", "audio/mp3", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac", "audio/ogg", "audio/wav", "audio/x-wav"].includes(mime)) return { method: "sendAudio", field: "audio" };
  return { method: "sendDocument", field: "document" };
}

async function uploadTelegram(token: string, method: string, form: FormData): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${telegramApiBase()}/bot${token}/${method}`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(telegramTimings().requestTimeoutMs * 4),
      cache: "no-store",
    });
  } catch (cause) {
    throw new TelegramApiError(
      0,
      cause instanceof Error && cause.name === "TimeoutError"
        ? "Telegram did not accept the upload in time."
        : "Breadboard could not reach Telegram to upload the file.",
    );
  }
  const envelope = (await response.json().catch(() => null)) as TelegramEnvelope<unknown> | null;
  if (!response.ok || !envelope?.ok) {
    const description = envelope?.description?.trim();
    throw new TelegramApiError(
      response.status,
      description || `Telegram refused the upload (HTTP ${response.status}).`,
      typeof envelope?.error_code === "number" ? envelope.error_code : null,
    );
  }
}

function captionFields(caption?: string): Record<string, string> {
  if (!caption?.trim()) return {};
  // Rendered like a message, so a caption never shows raw Markdown either.
  const formatted = formatTelegramText(applyOutboundGuardrails(caption.trim()));
  const [first] = splitTelegramText(formatted, 1_024);
  if (!first) return {};
  return {
    caption: first.text,
    ...(first.entities.length ? { caption_entities: JSON.stringify(first.entities) } : {}),
  };
}

/**
 * Send a file the way a person would: photos as photos, videos as playable
 * videos, everything else as a document. Upload is multipart, so it cannot go
 * through `callTelegram`; the token discipline is the same.
 */
export async function sendMedia(
  token: string,
  chatId: string,
  file: TelegramOutboundFile,
  caption?: string,
): Promise<void> {
  const { method, field } = telegramMediaMethod(file.mimeType, file.bytes.byteLength);
  const form = new FormData();
  form.append("chat_id", chatId);
  for (const [key, value] of Object.entries(captionFields(caption))) form.append(key, value);
  if (method === "sendVideo") form.append("supports_streaming", "true");
  // Copied into a plain ArrayBuffer-backed view: a Node `Buffer` is backed by a
  // shared pool, which is not a `BlobPart`.
  const bytes = new Uint8Array(file.bytes.byteLength);
  bytes.set(file.bytes);
  form.append(field, new Blob([bytes], { type: file.mimeType || "application/octet-stream" }), file.filename);
  await uploadTelegram(token, method, form);
}

/** Send a web image by URL; Telegram fetches it itself. */
export async function sendPhotoUrl(token: string, chatId: string, url: string): Promise<void> {
  await callTelegram<unknown>(token, "sendPhoto", { chat_id: chatId, photo: url }, telegramTimings().requestTimeoutMs * 2);
}

/** Send a file as a document (owner-initiated sends keep the original file). */
export async function sendDocument(
  token: string,
  chatId: string,
  file: TelegramOutboundFile,
  caption?: string,
): Promise<void> {
  const form = new FormData();
  form.append("chat_id", chatId);
  for (const [key, value] of Object.entries(captionFields(caption))) form.append(key, value);
  const bytes = new Uint8Array(file.bytes.byteLength);
  bytes.set(file.bytes);
  form.append("document", new Blob([bytes], { type: file.mimeType || "application/octet-stream" }), file.filename);
  await uploadTelegram(token, "sendDocument", form);
}
