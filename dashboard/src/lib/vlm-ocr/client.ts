// OpenAI-compatible client for the local HunyuanOCR llama-server.
//
// Written against `fetch` rather than the OpenAI SDK for two reasons: the
// sampling knobs the model needs (`top_k`, `repeat_penalty`) are not part of
// the OpenAI schema, and the streaming loop has to be able to stop generation
// early when the model falls into the repetition degeneration that greedy
// decoding on long pages is prone to.

import type { VlmOcrConfig } from "./config.ts";
import { VlmOcrRequestError } from "./errors.ts";
import { hasTailRepetition } from "./repetition.ts";

export interface VlmOcrPageResult {
  text: string;
  /** True when generation was cut short because the tail started repeating. */
  earlyStopped: boolean;
}

const REPETITION_FIRST_CHECK_CHARS = 4_000;
const REPETITION_CHECK_STEP_CHARS = 1_000;
const REPETITION_WINDOW_CHARS = 8_000;

let cachedModelId: { baseUrl: string; id: string } | null = null;

/**
 * Undici normally rejects a response-body read when its fetch signal aborts,
 * but a server that leaves an SSE connection half-open can strand the reader
 * after the response headers have arrived. Race the read against the signal
 * ourselves so the page deadline remains authoritative in that state too.
 */
function readWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(
      signal.reason instanceof Error
        ? signal.reason
        : new DOMException("The operation was aborted.", "AbortError"),
    );
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException("The operation was aborted.", "AbortError"),
      );
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/** Resolve the model id to send, falling back to whatever the server serves. */
export async function resolveVlmOcrModelId(
  config: VlmOcrConfig,
  signal?: AbortSignal,
): Promise<string> {
  if (config.model) return config.model;
  if (cachedModelId?.baseUrl === config.baseUrl) return cachedModelId.id;

  const response = await fetch(`${config.baseUrl}/models`, {
    method: "GET",
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal,
  });
  if (!response.ok) {
    throw new VlmOcrRequestError(
      `The OCR model server rejected the model listing (HTTP ${response.status}).`,
      response.status,
    );
  }
  const payload = (await response.json()) as { data?: Array<{ id?: unknown }> };
  const id = payload?.data?.find((entry) => typeof entry?.id === "string")?.id;
  if (typeof id !== "string" || !id) {
    throw new VlmOcrRequestError("The OCR model server reported no models.");
  }
  cachedModelId = { baseUrl: config.baseUrl, id };
  return id;
}

export function resetVlmOcrModelCache(): void {
  cachedModelId = null;
}

/** Extract the text delta from one `data:` payload of an SSE stream. */
export function streamDeltaText(payload: string): string {
  if (!payload || payload === "[DONE]") return "";
  try {
    const event = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: unknown } }>;
    };
    const content = event?.choices?.[0]?.delta?.content;
    return typeof content === "string" ? content : "";
  } catch {
    return "";
  }
}

/**
 * Run one image through the model. `dataUrl` is a `data:image/...;base64,...`
 * URL; `prompt` must be one of the official task prompts.
 */
export async function runVlmOcrPage({
  config,
  dataUrl,
  prompt,
  signal,
}: {
  config: VlmOcrConfig;
  dataUrl: string;
  prompt: string;
  signal?: AbortSignal;
}): Promise<VlmOcrPageResult> {
  const model = await resolveVlmOcrModelId(config, signal);

  const controller = new AbortController();
  const abortOuter = () => controller.abort();
  signal?.addEventListener("abort", abortOuter, { once: true });
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: true,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        top_p: config.topP,
        // llama-server reads `top_k`/`repeat_penalty`; the upstream HunyuanOCR
        // client sends `repetition_penalty`. Send both spellings and let the
        // server ignore the one it does not know.
        top_k: config.topK,
        repeat_penalty: config.repeatPenalty,
        repetition_penalty: config.repeatPenalty,
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: dataUrl } },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });

    if (!response.ok || !response.body) {
      let detail = "";
      try {
        detail = (await response.text()).slice(0, 400);
      } catch {
        // Body already consumed or unavailable.
      }
      throw new VlmOcrRequestError(
        `The OCR model server returned HTTP ${response.status}${detail ? `: ${detail}` : ""}.`,
        response.status,
      );
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parts: string[] = [];
    let buffer = "";
    let accumulated = 0;
    let nextCheckAt = REPETITION_FIRST_CHECK_CHARS;
    let earlyStopped = false;

    while (true) {
      const { done, value } = await readWithAbort(reader.read(), controller.signal);
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const piece = streamDeltaText(trimmed.slice(5).trim());
        if (!piece) continue;
        parts.push(piece);
        accumulated += piece.length;
      }

      if (accumulated >= nextCheckAt) {
        nextCheckAt = accumulated + REPETITION_CHECK_STEP_CHARS;
        const tail = parts.join("").slice(-REPETITION_WINDOW_CHARS);
        if (hasTailRepetition(tail)) {
          earlyStopped = true;
          await reader.cancel().catch(() => {});
          break;
        }
      }
    }

    return { text: parts.join(""), earlyStopped };
  } catch (error) {
    if (reader) void reader.cancel().catch(() => {});
    if (error instanceof VlmOcrRequestError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      if (signal?.aborted) throw error;
      throw new VlmOcrRequestError(
        `The OCR model did not answer within ${Math.round(config.requestTimeoutMs / 1000)}s.`,
      );
    }
    throw new VlmOcrRequestError(
      error instanceof Error ? error.message : "The OCR request failed.",
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortOuter);
  }
}
