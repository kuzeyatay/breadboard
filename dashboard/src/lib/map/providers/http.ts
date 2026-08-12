// One place where a map provider request is actually made.
//
// Every provider goes through here so timeouts, the contact User-Agent that
// Nominatim's usage policy requires, response-size limits and failure
// translation are identical across them. A provider that fails throws a
// MapServiceError with the provider named, because the caller has to be able to
// say *which* service could not verify the answer.

import { MapServiceError, type MapErrorCode } from "../errors.ts";

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export interface ProviderRequest {
  url: string;
  provider: string;
  failureCode: MapErrorCode;
  failureMessage: string;
  timeoutMs: number;
  userAgent: string;
  method?: "GET" | "POST";
  body?: string;
  contentType?: string;
  signal?: AbortSignal;
}

export async function requestProviderJson<T>(
  request: ProviderRequest,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  const abort = () => controller.abort();
  request.signal?.addEventListener("abort", abort);
  try {
    const response = await fetch(request.url, {
      method: request.method ?? "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": request.userAgent,
        ...(request.body
          ? {
              "Content-Type":
                request.contentType ?? "application/x-www-form-urlencoded",
            }
          : {}),
      },
      ...(request.body ? { body: request.body } : {}),
      cache: "no-store",
    });
    if (!response.ok) {
      throw new MapServiceError(
        request.failureCode,
        `${request.failureMessage} (${request.provider} returned HTTP ${response.status}.)`,
        { provider: request.provider },
      );
    }
    const raw = await response.text();
    if (raw.length > MAX_RESPONSE_BYTES) {
      throw new MapServiceError(
        request.failureCode,
        `${request.failureMessage} (${request.provider} returned more data than Breadboard accepts.)`,
        { provider: request.provider },
      );
    }
    try {
      return JSON.parse(raw) as T;
    } catch (cause) {
      throw new MapServiceError(
        request.failureCode,
        `${request.failureMessage} (${request.provider} returned a response Breadboard could not read.)`,
        { provider: request.provider, cause },
      );
    }
  } catch (error) {
    if (error instanceof MapServiceError) throw error;
    const reason =
      error instanceof Error && error.name === "AbortError"
        ? "the request timed out"
        : error instanceof Error
          ? error.message
          : "the request failed";
    throw new MapServiceError(
      request.failureCode,
      `${request.failureMessage} (${request.provider}: ${reason}.)`,
      { provider: request.provider, cause: error },
    );
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", abort);
  }
}
