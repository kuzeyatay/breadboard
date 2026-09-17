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
 * Deliberately plain text: the agent writes Markdown that Telegram's own parser
 * rejects on the first unbalanced `*`, and a rejected reply is worse than an
 * unstyled one.
 */
export async function sendMessage(token: string, chatId: string, text: string): Promise<void> {
  // Masked BEFORE splitting: a token like <EMAIL_ADDRESS> must never straddle
  // a chunk boundary, and detection needs the full message for context anyway.
  for (const chunk of splitForTelegram(applyOutboundGuardrails(text))) {
    await callTelegram<unknown>(
      token,
      "sendMessage",
      { chat_id: chatId, text: chunk, disable_web_page_preview: true },
      telegramTimings().requestTimeoutMs,
    );
  }
}

/**
 * Send a file as a document.
 *
 * This is the one call that cannot go through `callTelegram`: Telegram takes an
 * upload as `multipart/form-data`, not JSON. The token discipline is the same —
 * the URL is built here and never appears in a thrown message — and the caption
 * is capped at Telegram's 1024-character limit for captions, which is much
 * shorter than the message limit above.
 */
export async function sendDocument(
  token: string,
  chatId: string,
  file: { bytes: Uint8Array; filename: string; mimeType: string },
  caption?: string,
): Promise<void> {
  const form = new FormData();
  form.append("chat_id", chatId);
  if (caption?.trim()) form.append("caption", applyOutboundGuardrails(caption.trim()).slice(0, 1_024));
  // Copied into a plain ArrayBuffer-backed view: a Node `Buffer` is backed by a
  // shared pool, which is not a `BlobPart`.
  const bytes = new Uint8Array(file.bytes.byteLength);
  bytes.set(file.bytes);
  form.append(
    "document",
    new Blob([bytes], { type: file.mimeType || "application/octet-stream" }),
    file.filename,
  );

  let response: Response;
  try {
    response = await fetch(`${telegramApiBase()}/bot${token}/sendDocument`, {
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

/** Telegram's hard ceiling is 4096 characters; leave room rather than court it. */
export const TELEGRAM_MESSAGE_LIMIT = 3_800;

/** Split on paragraph, then line, then character boundaries — in that order. */
export function splitForTelegram(text: string, limit = TELEGRAM_MESSAGE_LIMIT): string[] {
  const body = text.trim();
  if (!body) return [];
  if (body.length <= limit) return [body];

  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const paragraph of body.split(/\n{2,}/)) {
    const piece = paragraph.trim();
    if (!piece) continue;
    if (current && current.length + piece.length + 2 > limit) flush();
    if (piece.length <= limit) {
      current = current ? `${current}\n\n${piece}` : piece;
      continue;
    }
    flush();
    for (const line of piece.split("\n")) {
      if (current && current.length + line.length + 1 > limit) flush();
      if (line.length <= limit) {
        current = current ? `${current}\n${line}` : line;
        continue;
      }
      flush();
      for (let index = 0; index < line.length; index += limit) {
        chunks.push(line.slice(index, index + limit));
      }
    }
  }
  flush();
  return chunks;
}
