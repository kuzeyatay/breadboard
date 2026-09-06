import fs from "node:fs";
import { openAsBlob } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { providerPayload } from "./capabilities.ts";
import type { MusicRequest } from "../music-producer/request.ts";
export interface AceStepConnection {
  baseUrl: string;
  apiKey: string;
  model: string;
}
export const MAX_AUDIO_BYTES = 256 * 1024 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
export function approvedOrigin(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("Choose a credential-free HTTP(S) origin without a path.");
  return url.origin;
}
export function audioUrl(baseUrl: string, value: unknown): string {
  if (typeof value !== "string" || value.length > 4096)
    throw new Error("invalid_audio_url");
  const origin = approvedOrigin(baseUrl);
  const url = new URL(value, origin);
  if (url.origin !== origin || url.username || url.password || url.hash || url.pathname !== "/v1/audio")
    throw new Error("unapproved_audio_origin");
  return url.href;
}
export async function boundedJson(response: Response, maximum = MAX_JSON_BYTES): Promise<unknown> {
  if (!response.body)
    throw new Error("empty_provider_response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (; ;) {
      const next = await reader.read();
      if (next.done)
        break;
      size += next.value.byteLength;
      if (size > maximum)
        throw new Error("provider_response_too_large");
      chunks.push(next.value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  }
  finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_provider_response");
  return value as Record<string, unknown>;
}
export function unwrapEnvelope(value: unknown): unknown {
  const envelope = record(value);
  if (envelope.code !== 200 || (envelope.error !== null && envelope.error !== "" && envelope.error !== undefined))
    throw new Error("provider_application_error");
  if (!("data" in envelope))
    throw new Error("invalid_provider_envelope");
  return envelope.data;
}
function headers(connection: AceStepConnection): Record<string, string> {
  return connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {};
}
export async function api(connection: AceStepConnection, endpoint: string, options: RequestInit = {}) {
  const response = await fetch(`${approvedOrigin(connection.baseUrl)}${endpoint}`, {
    ...options, headers: { ...headers(connection), ...options.headers }, redirect: "error",
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`provider_http_${response.status}`);
  }
  return unwrapEnvelope(await boundedJson(response));
}
export async function discoverModels(connection: AceStepConnection): Promise<string[]> {
  const data = record(await api(connection, "/v1/models"));
  if (!Array.isArray(data.models) || data.models.length > 32)
    throw new Error("invalid_model_discovery");
  return data.models.map((item) => {
    const value = record(item);
    if (typeof value.name !== "string" || value.name.length > 128)
      throw new Error("invalid_model_discovery");
    return value.name;
  });
}
export async function submitMusic(connection: AceStepConnection, request: MusicRequest, sourceFile: string | null, signal: AbortSignal): Promise<string> {
  const payload = providerPayload(request, connection.model);
  let options: RequestInit;
  if (sourceFile && request.operation !== "variation") {
    const form = new FormData();
    for (const [key, value] of Object.entries(payload))
      form.set(key, String(value));
    // File-backed Blob streams bytes; no local path is sent to the provider.
    form.set(request.operation === "reference" ? "reference_audio" : "src_audio", await openAsBlob(sourceFile), "source.wav");
    options = { method: "POST", body: form, signal };
  }
  else
    options = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal };
  const result = record(await api(connection, "/release_task", options));
  if (typeof result.task_id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(result.task_id))
    throw new Error("missing_provider_receipt");
  return result.task_id;
}
export type ProviderResult = {
  state: "running";
} | {
  state: "failed";
  code?: "provider_out_of_memory";
} | {
  state: "succeeded";
  file: string;
  seed: number | null;
};
export function parseTaskResult(data: unknown, taskId: string, baseUrl: string): ProviderResult {
  if (!Array.isArray(data) || data.length !== 1)
    throw new Error("invalid_task_result");
  const task = record(data[0]);
  if (task.task_id !== taskId)
    throw new Error("provider_receipt_mismatch");
  if (task.status === 0)
    return { state: "running" };
  if (task.status === 2)
    return { state: "failed", ...(/out of memory|cuda.{0,20}oom/i.test(JSON.stringify(task).slice(0, MAX_JSON_BYTES)) ? { code: "provider_out_of_memory" as const } : {}) };
  if (task.status !== 1)
    throw new Error("invalid_task_state");
  if (typeof task.result === "string" && Buffer.byteLength(task.result) > MAX_JSON_BYTES)
    throw new Error("provider_result_too_large");
  const decoded: unknown = typeof task.result === "string" ? JSON.parse(task.result) : task.result;
  if (!Array.isArray(decoded) || decoded.length !== 1)
    throw new Error("expected_one_audio_result");
  const item = record(decoded[0]);
  if (item.status !== 1)
    throw new Error("failed_audio_result");
  const seed = item.seed_value === null || item.seed_value === undefined || item.seed_value === "" ? NaN : Number(item.seed_value);
  return { state: "succeeded", file: audioUrl(baseUrl, item.file), seed: Number.isSafeInteger(seed) && seed >= 0 ? seed : null };
}
export async function queryMusic(connection: AceStepConnection, taskId: string, signal: AbortSignal) {
  return parseTaskResult(await api(connection, "/query_result", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task_id_list: [taskId] }), signal }), taskId, connection.baseUrl);
}
export async function fetchAudio(connection: AceStepConnection, url: string, destination: string, signal: AbortSignal): Promise<void> {
  const response = await fetch(audioUrl(connection.baseUrl, url), { headers: headers(connection), redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]) });
  if (!response.ok || !response.body)
    throw new Error("audio_fetch_failed");
  let size = 0;
  const cap = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > MAX_AUDIO_BYTES)
        throw new Error("audio_too_large");
      controller.enqueue(chunk);
    }
  });
  try {
    await pipeline(Readable.fromWeb(response.body.pipeThrough(cap) as Parameters<typeof Readable.fromWeb>[0]), fs.createWriteStream(destination, { flags: "wx" }), { signal });
    if (!size)
      throw new Error("empty_audio");
  }
  catch (error) {
    await fs.promises.rm(destination, { force: true });
    throw error;
  }
}
