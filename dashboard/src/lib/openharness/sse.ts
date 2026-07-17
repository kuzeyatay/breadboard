// Minimal SSE frame parser for consuming OpenHarness's `text/event-stream`.
//
// Kept dependency-free and pure over an async byte iterator so it can be unit
// tested with a hand-rolled stream and reused by the gateway. Each yielded value
// is the parsed JSON `data:` payload of one SSE event.

export async function* parseSseStream(
  stream: AsyncIterable<Uint8Array>,
): AsyncGenerator<Record<string, unknown>> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const payload = extractData(frame);
      if (payload !== null) {
        const parsed = tryParse(payload);
        if (parsed) yield parsed;
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
  // Flush any trailing frame not terminated by a blank line.
  const payload = extractData(buffer);
  if (payload !== null) {
    const parsed = tryParse(payload);
    if (parsed) yield parsed;
  }
}

function extractData(frame: string): string | null {
  const lines = frame.split("\n");
  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""));
  if (dataLines.length === 0) return null;
  return dataLines.join("\n").trim();
}

function tryParse(payload: string): Record<string, unknown> | null {
  if (!payload || payload === "[DONE]") return null;
  try {
    const value = JSON.parse(payload);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Adapt a WHATWG ReadableStream (Response.body) to an async byte iterator. */
export async function* readableToIterable(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
