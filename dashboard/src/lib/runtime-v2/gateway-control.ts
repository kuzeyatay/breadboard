import { ApiError } from "../hermes/route-core.ts";
import { runtimeControlTransports } from "../runtime-control-transport.ts";

export type RuntimeGateway = "telegram" | "whatsapp";
export type RuntimeGatewayDesiredState = "running" | "stopped";

const LOOPBACK = new Set(["127.0.0.1", "[::1]"]);
const MIN_TOKEN_BYTES = 32;
const MAX_TOKEN_BYTES = 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const STATUS_TIMEOUT_MS = 5_000;
const ACTION_TIMEOUT_MS = 2 * 60_000;
const RECONCILE_TIMEOUT_MS = 2 * 60_000;

interface Endpoint {
  origin: string;
  token: string;
}

interface GatewayEnvelope<T> {
  ok: true;
  result: T;
}

function endpoint(urlName: string, tokenName: string): Endpoint | null {
  const raw = process.env[urlName]?.trim();
  const token = process.env[tokenName]?.trim();
  if (!raw && !token) return null;
  if (!raw || !token) throw new Error("Runtime gateway configuration is incomplete.");
  const tokenBytes = Buffer.byteLength(token, "utf8");
  if (
    tokenBytes < MIN_TOKEN_BYTES ||
    tokenBytes > MAX_TOKEN_BYTES ||
    !/^[\x21-\x7e]+$/u.test(token)
  ) {
    throw new Error("Runtime gateway capability is invalid.");
  }
  const url = new URL(raw);
  if (url.protocol !== "http:" || !LOOPBACK.has(url.hostname) || url.pathname !== "/") {
    throw new Error("Runtime gateway URL must be a loopback origin.");
  }
  return { origin: url.origin, token };
}

function gatewayEndpoint(gateway: RuntimeGateway): Endpoint | null {
  return gateway === "telegram"
    ? endpoint("BREADBOARD_TELEGRAM_GATEWAY_URL", "BREADBOARD_TELEGRAM_GATEWAY_TOKEN")
    : endpoint("BREADBOARD_WHATSAPP_GATEWAY_URL", "BREADBOARD_WHATSAPP_GATEWAY_TOKEN");
}

function runtimeEndpoint(): Endpoint | null {
  return endpoint("BREADBOARD_SUPERVISOR_CONTROL_URL", "BREADBOARD_SUPERVISOR_CONTROL_TOKEN");
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    throw new Error("Runtime gateway returned an oversized response.");
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Runtime gateway returned an oversized response.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Runtime gateway returned invalid JSON.");
  }
}

function remoteError(value: unknown, fallbackStatus: number): ApiError {
  const envelope = value as {
    error?: { code?: unknown; message?: unknown };
  } | null;
  const code = typeof envelope?.error?.code === "string"
    ? envelope.error.code
    : "gateway_request_failed";
  const message = typeof envelope?.error?.message === "string"
    ? envelope.error.message
    : "The messaging gateway could not complete that request.";
  return new ApiError(fallbackStatus, code, message);
}

async function post<T>(
  target: Endpoint,
  route: string,
  body: unknown,
  timeoutMs: number,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const response = await runtimeControlTransports().service(`${target.origin}${route}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${target.token}`,
      "content-type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const value = await boundedJson(response);
  if (!response.ok) throw remoteError(value, response.status);
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as { ok?: unknown }).ok !== true ||
    !("result" in value)
  ) {
    throw new Error("Runtime gateway returned an invalid response envelope.");
  }
  return (value as GatewayEnvelope<T>).result;
}

export async function reconcileRuntimeGateway(
  gateway: RuntimeGateway,
  desiredState: RuntimeGatewayDesiredState,
  userId: number,
): Promise<void> {
  const target = runtimeEndpoint();
  if (!target) throw new ApiError(503, "runtime_unavailable", "The native Runtime is unavailable.");
  const result = await post<Record<string, unknown>>(
    target,
    `/v1/gateways/${gateway}/reconcile`,
    { desiredState },
    RECONCILE_TIMEOUT_MS,
    { "x-breadboard-user-id": String(userId) },
  );
  if (
    result.gateway !== gateway ||
    result.desiredState !== desiredState ||
    (desiredState === "running" && result.serviceState !== "healthy") ||
    (desiredState === "stopped" && result.serviceState !== "stopped")
  ) {
    throw new Error("The native Runtime did not apply the requested gateway state.");
  }
}

export async function reconcileRuntimeSchedule(
  scheduleId: "email-poll",
  desiredState: RuntimeGatewayDesiredState,
  userId: number,
): Promise<void> {
  const target = runtimeEndpoint();
  if (!target) throw new ApiError(503, "runtime_unavailable", "The native Runtime is unavailable.");
  const result = await post<Record<string, unknown>>(
    target,
    `/v1/schedules/${scheduleId}/reconcile`,
    { desiredState },
    RECONCILE_TIMEOUT_MS,
    { "x-breadboard-user-id": String(userId) },
  );
  if (
    result.scheduleId !== scheduleId ||
    result.desiredState !== desiredState ||
    result.scheduleState !== (desiredState === "running" ? "enabled" : "disabled")
  ) {
    throw new Error("The native Runtime did not apply the requested schedule state.");
  }
}

export async function runtimeScheduleEnabled(
  scheduleId: "email-poll",
  userId: number,
): Promise<boolean> {
  const target = runtimeEndpoint();
  if (!target) return false;
  try {
    const result = await post<Record<string, unknown>>(
      target,
      `/v1/schedules/${scheduleId}/status`,
      {},
      STATUS_TIMEOUT_MS,
      { "x-breadboard-user-id": String(userId) },
    );
    if (result.scheduleId !== scheduleId || typeof result.enabled !== "boolean") {
      throw new Error("The native Runtime returned an invalid schedule status.");
    }
    return result.enabled;
  } catch (error) {
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) throw error;
    return false;
  }
}

export async function runtimeGatewayStatus<T>(
  gateway: RuntimeGateway,
  userId: number,
): Promise<T | null> {
  const target = gatewayEndpoint(gateway);
  if (!target) return null;
  try {
    return await post<T>(target, "/v1/status", { userId }, STATUS_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) throw error;
    return null;
  }
}

export async function runtimeGatewayAction<T>(
  gateway: RuntimeGateway,
  input: Record<string, unknown>,
): Promise<T> {
  const target = gatewayEndpoint(gateway);
  if (!target) throw new ApiError(503, "gateway_unavailable", "The messaging gateway is unavailable.");
  return post<T>(target, "/v1/action", input, ACTION_TIMEOUT_MS);
}

export async function updateRuntimeWhatsAppSettings<T>(
  userId: number,
  settings: Record<string, unknown>,
): Promise<T | null> {
  const target = gatewayEndpoint("whatsapp");
  if (!target) return null;
  try {
    return await post<T>(target, "/v1/settings", { userId, settings }, ACTION_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) throw error;
    return null;
  }
}

export async function sendRuntimeWhatsAppMessage(
  userId: number,
  chatId: string,
  text: string,
): Promise<void> {
  const target = gatewayEndpoint("whatsapp");
  if (!target) throw new Error("WhatsApp is not connected.");
  await post(target, "/v1/send", { userId, chatId, text }, ACTION_TIMEOUT_MS);
}

export async function sendRuntimeWhatsAppMedia(
  userId: number,
  chatId: string,
  file: {
    filePath: string;
    fileName?: string;
    caption?: string;
    mediaType?: string;
  },
): Promise<void> {
  const target = gatewayEndpoint("whatsapp");
  if (!target) throw new Error("WhatsApp is not connected.");
  await post(
    target,
    "/v1/send-media",
    {
      userId,
      chatId,
      file: {
        filePath: file.filePath,
        fileName: file.fileName ?? null,
        caption: file.caption ?? null,
        mediaType: file.mediaType ?? null,
      },
    },
    ACTION_TIMEOUT_MS,
  );
}
