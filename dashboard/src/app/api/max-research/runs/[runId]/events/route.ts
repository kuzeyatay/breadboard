import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { getEventsSince, getRun } from "@/lib/max-research/run-manager.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TERMINAL = new Set(["run.completed", "run.failed", "run.aborted"]);

// A Max Research run is measured in tens of minutes, so a client that reloads
// mid-run has to rejoin rather than start over: `since` and `Last-Event-ID`
// both resume from a sequence number. A run the manager has already evicted is
// answered with a closed stream rather than an open one, so the browser stops
// reconnecting to something that no longer exists.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const userId = await requireUserId();
  const { runId } = await params;
  const url = new URL(request.url);
  const since =
    Number(
      request.headers.get("last-event-id") ?? url.searchParams.get("since") ?? 0,
    ) || 0;

  if (!(request.headers.get("accept") ?? "").includes("text/event-stream")) {
    return NextResponse.json({
      ok: true,
      events: getEventsSince(userId, runId, since),
    });
  }

  if (!getRun(userId, runId)) {
    return NextResponse.json({ ok: false, error: "run_not_found" }, { status: 404 });
  }

  const encoder = new TextEncoder();
  let cursor = since;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const pump = (): boolean => {
        let done = false;
        for (const event of getEventsSince(userId, runId, cursor)) {
          controller.enqueue(
            encoder.encode(
              `id: ${event.sequenceNumber}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            ),
          );
          cursor = event.sequenceNumber;
          if (TERMINAL.has(event.type)) done = true;
        }
        return done;
      };

      if (pump()) {
        controller.close();
        return;
      }
      // Slower than the other cards on purpose: this run's events arrive minutes
      // apart, so a one-second tick would be a heartbeat and nothing else.
      const interval = setInterval(() => {
        if (closed) return;
        try {
          const done = pump();
          controller.enqueue(encoder.encode(": ping\n\n"));
          if (done) {
            clearInterval(interval);
            controller.close();
          }
        } catch {
          clearInterval(interval);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }, 3_000);

      request.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
