if (typeof window !== "undefined") {
  throw new Error("Runtime V2 ingestion request validation is server-only.");
}

const MAX_REQUEST_ID_BYTES = 200;

export function runtimeIngestIdempotencyKey(requestId: string): string {
  if (
    new TextEncoder().encode(requestId).byteLength > MAX_REQUEST_ID_BYTES ||
    !/^[A-Za-z0-9_-]+$/u.test(requestId)
  ) {
    throw new TypeError("The ingestion request identity is invalid");
  }
  return `ingest-${requestId}`;
}
