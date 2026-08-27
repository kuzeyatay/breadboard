import { NextResponse } from "next/server";
import type { OuterAgentRunView } from "./outer-agent-run.ts";

/** Shared, overlap-free SSE projection for fixed Runtime V2 outer-agent jobs. */
export async function outerAgentEventsResponse(input: {
  readonly request: Request;
  readonly runId: string;
  readonly readView: (since: number) => Promise<OuterAgentRunView>;
  readonly pollMs: number;
}): Promise<Response> {
  const url = new URL(input.request.url);
  const rawCursor =
    input.request.headers.get("last-event-id") ?? url.searchParams.get("since") ?? "0";
  const parsedCursor = Number(rawCursor);
  const since = Number.isSafeInteger(parsedCursor) && parsedCursor >= 0 ? parsedCursor : 0;
  if (!(input.request.headers.get("accept") ?? "").includes("text/event-stream")) {
    const view = await input.readView(since);
    return NextResponse.json({ ok: true, events: view.events });
  }

  const encoder = new TextEncoder();
  let cursor = since;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let detachAbort: () => void = () => undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        timer = null;
        detachAbort();
        try {
          controller.close();
        } catch {
          // The request or reader already closed the stream.
        }
      };
      const flush = async () => {
        if (closed) return;
        try {
          const view = await input.readView(cursor);
          if (closed) return;
          for (const event of view.events) {
            controller.enqueue(
              encoder.encode(
                `id: ${event.sequenceNumber}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
              ),
            );
            cursor = event.sequenceNumber;
          }
          if (view.terminal) {
            close();
            return;
          }
          controller.enqueue(encoder.encode(": ping\n\n"));
          timer = setTimeout(() => void flush(), input.pollMs);
        } catch {
          close();
        }
      };
      detachAbort = () => input.request.signal.removeEventListener("abort", close);
      input.request.signal.addEventListener("abort", close, { once: true });
      if (input.request.signal.aborted) {
        close();
        return;
      }
      void flush();
    },
    cancel() {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      detachAbort();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
